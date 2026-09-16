'use strict';

const config = require('../config');
const db = require('../db');
const auth = require('../auth');
const audit = require('../audit');
const notify = require('../notify');
const schedule = require('../services/schedule');
const lessons = require('../services/lessons');
const students = require('../services/students');
const attendance = require('../services/attendance');
const reenrollment = require('../services/reenrollment');
const { HttpError, asArray } = require('../http');
const { requireRole, saveLogo } = require('./common');
const ui = require('../views/ui');
const sv = require('../views/student');
const { esc, attr, card, field, input, textarea, select, table, fmtDate, fmtDateTime, fmtGrade, badge, statusBadge, postButton } = ui;

const roleOk = requireRole('GESTAO');

function teachersList() {
  return db.get().prepare("SELECT id, name, email, active FROM users WHERE role = 'PROFESSOR' ORDER BY active DESC, name").all();
}

function guardiansList() {
  return db.get().prepare("SELECT id, name, email, phone, active FROM users WHERE role = 'RESPONSAVEL' ORDER BY name").all();
}

function studentForm(s = {}, teachers) {
  return `<div class="form-row">
    ${field('Nome completo', input('nome', s.name || '', { required: true }))}
    ${field('Data de nascimento', input('nascimento', s.birth_date || '', { type: 'date' }))}
    ${field('Instrumento / modalidade', input('instrumento', s.instrument || '', { list: 'instrumentos' }))}${ui.instrumentDatalist()}
    ${field('Professor(a)', select('professor', teachers.filter((t) => t.active || t.id === s.teacher_id).map((t) => ({ value: t.id, label: t.name })), s.teacher_id || '', { placeholder: '— sem professor —' }))}
    ${field('Situação', select('status', [{ value: 'ATIVO', label: 'Ativo' }, { value: 'INATIVO', label: 'Inativo' }], s.status || 'ATIVO'))}
    ${field('Data de matrícula', input('matricula', s.enrolled_at || '', { type: 'date' }))}
  </div>
  <label class="check"><input type="checkbox" name="individual_only" value="1" ${s.individual_only ? 'checked' : ''}><span>Precisa de aula individual</span></label>
  ${field('Anotações internas', textarea('notas', s.notes || '', { rows: 3, placeholder: 'Informações relevantes para a equipe (não visíveis ao responsável).' }))}`;
}

function userForm(u = {}) {
  return `<div class="form-row">
    ${field('Nome', input('nome', u.name || '', { required: true }))}
    ${field('E-mail de acesso', input('email', u.email || '', { type: 'email', required: true }))}
    ${field('Perfil', select('perfil', [{ value: 'PROFESSOR', label: 'Professor(a)' }, { value: 'RESPONSAVEL', label: 'Responsável' }, { value: 'GESTAO', label: 'Gestão' }], u.role || 'PROFESSOR'))}
    ${field('Telefone', input('telefone', u.phone || '', { type: 'tel' }))}
    ${field('Instrumentos que leciona (professores)', input('instrumentos', u.instruments || '', { placeholder: 'Ex.: Violão, Teoria musical' }))}
  </div>`;
}

module.exports = function register(router) {
  // ---------- Visão geral ----------
  router.get('/gestao', roleOk, (ctx) => {
    const d = db.get();
    const n = (sql, ...a) => d.prepare(sql).get(...a).n;
    const activeStudents = n("SELECT COUNT(*) AS n FROM students WHERE status = 'ATIVO'");
    const teachers = n("SELECT COUNT(*) AS n FROM users WHERE role = 'PROFESSOR' AND active = 1");
    const guardians = n("SELECT COUNT(*) AS n FROM users WHERE role = 'RESPONSAVEL' AND active = 1");
    const lessonCount = n('SELECT COUNT(*) AS n FROM lessons');
    const unscheduled = d
      .prepare("SELECT s.id, s.name FROM students s WHERE s.status = 'ATIVO' AND NOT EXISTS (SELECT 1 FROM lesson_students ls WHERE ls.student_id = s.id) ORDER BY s.name")
      .all();
    const noTeacher = n("SELECT COUNT(*) AS n FROM students WHERE status = 'ATIVO' AND teacher_id IS NULL");
    const occ = lessons.occupancy();
    const totalCapacity = Object.keys(occ.cells).length * occ.teachers.length * occ.max;
    const totalFree = Object.values(occ.cells).reduce((acc, c) => acc + c.free, 0);
    const absencesWeek = n("SELECT COUNT(*) AS n FROM attendance WHERE status = 'FALTA' AND date >= date('now', '-7 days')");
    const period = reenrollment.activePeriod();
    const periods = reenrollment.listPeriods();
    const recent = audit.recent(12);
    const today = new Date().getDay();
    const todays = lessons.allLessons().filter((l) => l.weekday === today);

    const body = `<div class="page-head"><h1>Visão geral</h1><div class="actions"><a class="btn" href="/gestao/alunos/novo">Novo aluno</a><a class="btn btn-secondary" href="/gestao/usuarios/novo">Novo usuário</a></div></div>
      <div class="stats">
        ${ui.stat('Alunos ativos', activeStudents)}
        ${ui.stat('Professores', teachers)}
        ${ui.stat('Responsáveis', guardians)}
        ${ui.stat('Aulas na grade', lessonCount, 'por semana')}
        ${ui.stat('Vagas livres', totalFree, `de ${totalCapacity} na semana`)}
        ${ui.stat('Faltas (7 dias)', absencesWeek)}
      </div>
      ${
        unscheduled.length || noTeacher
          ? `<div class="notice">${noTeacher ? `<strong>${noTeacher} aluno(s) sem professor.</strong> ` : ''}${
              unscheduled.length ? `<strong>${unscheduled.length} aluno(s) ativo(s) sem horário:</strong> ${unscheduled.slice(0, 8).map((s) => `<a href="/gestao/alunos/${s.id}">${esc(s.name)}</a>`).join(', ')}${unscheduled.length > 8 ? '…' : ''}` : ''
            }</div>`
          : ''
      }
      <div class="grid grid-2">
        ${card(
          `Aulas de hoje · ${esc(schedule.weekdayName(today))}`,
          todays.length
            ? table(['Horário', 'Professor(a)', 'Alunos', 'Tipo'], todays.map((l) => [esc(schedule.slotLabel(l.slot_index)), esc(l.teacher_name), l.students.map((s) => esc(s.name)).join(', ') || '<span class="muted">—</span>', l.individual ? badge('Individual', 'warn') : badge('Grupo', 'primary')]))
            : '<p class="empty">Nenhuma aula hoje.</p>',
          { actions: '<a class="btn btn-secondary btn-sm" href="/gestao/agenda">Agenda geral</a>' }
        )}
        ${card(
          'Rematrícula',
          period
            ? (() => {
                const p = periods.find((x) => x.id === period.id);
                const pct = p.total ? Math.round(((p.confirmadas + p.recusadas) / p.total) * 100) : 0;
                return `<p><strong>${esc(period.name)}</strong> aberta até ${fmtDate(period.closes_at)}.</p><div class="progress"><span style="width:${pct}%"></span></div><p class="small muted" style="margin-top:.4rem">${p.confirmadas} confirmada(s), ${p.recusadas} não renovam, ${p.total - p.confirmadas - p.recusadas} pendente(s) de ${p.total} (${pct}% respondido)</p>`;
              })()
            : '<p class="empty">Nenhum período aberto.</p>',
          { actions: '<a class="btn btn-secondary btn-sm" href="/gestao/rematricula">Gerenciar</a>' }
        )}
      </div>
      ${card(
        'Últimas alterações na plataforma',
        table(['Quando', 'Quem', 'Ação', 'Detalhes'], recent.map((a) => [fmtDateTime(a.created_at), `${esc(a.user_name || 'Sistema')} <span class="muted small">${esc(config.ROLE_LABELS[a.user_role] || '')}</span>`, badge(a.action.replace(/_/g, ' '), 'neutral'), esc(a.details || '')]), { empty: 'Nenhuma alteração ainda.' }),
        { actions: '<a class="btn btn-secondary btn-sm" href="/gestao/auditoria">Ver tudo</a>' }
      )}`;
    ctx.render('Visão geral', body);
  });

  // ---------- Agenda geral ----------
  router.get('/gestao/agenda', roleOk, (ctx) => {
    const teachers = teachersList().filter((t) => t.active);
    const teacherId = Number(ctx.query.professor) || null;
    let body = `<div class="page-head"><h1>Agenda geral</h1>
      <form method="get" action="/gestao/agenda" class="filters">${field('Professor(a)', select('professor', teachers.map((t) => ({ value: t.id, label: t.name })), teacherId || '', { placeholder: 'Todos (ocupação por horário)' }).replace('<select', '<select data-autosubmit'))}</form></div>`;
    if (teacherId) {
      const t = teachers.find((x) => x.id === teacherId);
      if (!t) throw new HttpError(404, 'Professor não encontrado.');
      const grid = lessons.weekGridForTeacher(t.id);
      const { weekGrid } = require('./professor');
      const fakeCtx = { qs: `?professor=${t.id}`, teacher: t };
      body += card(`Grade de ${esc(t.name)}`, weekGrid(fakeCtx, grid, { editable: true }), {
        actions: `<a class="btn btn-secondary btn-sm" href="/professor?professor=${t.id}">Abrir área do professor</a>`,
      });
      body += '<p class="muted small">Clique em um horário para alterar a aula em nome do professor. Todas as alterações ficam registradas no histórico.</p>';
    } else {
      const occ = lessons.occupancy();
      let html = `<div class="table-wrap"><div class="schedule" style="--days:${config.WEEKDAYS.length}"><div></div>${config.WEEKDAYS.map((wd) => `<div class="sc-head">${esc(schedule.weekdayName(wd))}</div>`).join('')}`;
      let lastPeriod = null;
      for (const slot of schedule.SLOTS) {
        if (slot.period !== lastPeriod) {
          html += `<div class="sc-period">${esc(slot.periodLabel)}</div>`;
          lastPeriod = slot.period;
        }
        html += `<div class="sc-time">${esc(slot.label)}</div>`;
        for (const wd of config.WEEKDAYS) {
          const c = occ.cells[`${wd}:${slot.index}`];
          const inner = c.lessons.length
            ? `<div class="sc-title"><span>${c.students} aluno(s)</span><span class="muted">${c.free} vaga(s)</span></div>${c.lessons
                .map(
                  (l) => `<div class="sc-teacher"><a href="/professor/agenda/${wd}/${slot.index}?professor=${l.teacher_id}">${esc(l.teacher_name)}</a> ${
                    l.individual ? badge('ind.', 'warn') : badge(`${l.students.length}/${occ.max}`, 'primary')
                  }</div>`
                )
                .join('')}`
            : `<span>Livre</span><div class="muted small">${c.free} vaga(s)</div>`;
          html += `<div class="sc-cell ${c.lessons.length ? 'group' : 'free'}">${inner}</div>`;
        }
      }
      html += '</div></div>';
      body += card('Ocupação por horário (todos os professores)', html + `<p class="muted small" style="margin-top:.75rem">Vagas = capacidade teórica (${occ.teachers.length} professor(es) × ${occ.max} alunos por aula em grupo) menos alunos já alocados. Aulas individuais ocupam o horário inteiro do professor.</p>`);
      body += `<p class="muted small">O máximo de alunos por aula em grupo (hoje ${occ.max}) pode ser ajustado em <a href="/gestao/configuracoes">Configurações</a>.</p>`;
    }
    ctx.render('Agenda geral', body);
  });

  // ---------- Configurações da escola ----------
  router.get('/gestao/configuracoes', roleOk, (ctx) => {
    const hasLogo = !!db.getSetting('logo_type', null);
    const demo = db.getSetting('demo_mode', '0') === '1';
    const body = `<h1>Configurações</h1><div class="grid grid-2">${card(
      'Escola',
      `<form method="post" action="/gestao/configuracoes" class="form" enctype="multipart/form-data">
        ${field('Nome da escola', input('escola', db.schoolName(), { required: true }), 'Aparece no topo das páginas, na tela de login e nas notificações.')}
        ${field('Máximo de alunos por aula em grupo', input('max_group_size', db.maxGroupSize(), { type: 'number', min: 1, max: 20, required: true }))}
        ${field('Logo', '<input type="file" name="logo" accept="image/*">', 'PNG, JPG ou SVG, até 2 MB. Envie apenas se quiser trocar.')}
        ${hasLogo ? `<div><img src="/logo?v=${encodeURIComponent(db.getSetting('logo_version', '1'))}" alt="Logo atual" style="max-height:80px;max-width:220px"></div>` : '<p class="muted small">Nenhuma logo cadastrada.</p>'}
        <div class="actions"><button class="btn" type="submit">Salvar</button></div></form>
        ${hasLogo ? postButton('/gestao/configuracoes/logo/remover', 'Remover logo', { cls: 'btn btn-ghost btn-sm', confirm: 'Remover a logo atual?' }) : ''}`
    )}${card(
      'Acesso da gestão',
      `<p>Para trocar o <strong>seu</strong> e-mail de acesso ou a sua senha, use <a href="/perfil">Meu perfil</a> (clique no seu nome no topo).</p>
       <p>Para criar ou alterar o acesso de outras pessoas da gestão, de professores e de responsáveis, use <a href="/gestao/usuarios">Professores e usuários</a>.</p>
       ${
         demo
           ? `<hr><p><strong>Dados de exemplo ativos.</strong> A tela de login mostra as contas fictícias (senha 123456). Quando terminar de testar, remova-os para começar com a escola real.</p>
              ${postButton('/gestao/configuracoes/exemplo/remover', 'Remover dados de exemplo', { cls: 'btn btn-danger', confirm: 'Isso apaga TODOS os professores, alunos, responsáveis e registros de exemplo. Os usuários de gestão criados por você são mantidos. Continuar?' })}`
           : ''
       }`
    )}</div>`;
    ctx.render('Configurações', body);
  });

  router.post('/gestao/configuracoes', roleOk, (ctx) => {
    const v = Number(ctx.body.max_group_size);
    const escola = String(ctx.body.escola || '').trim();
    try {
      if (!escola) throw new Error('Informe o nome da escola.');
      if (!Number.isInteger(v) || v < 1 || v > 20) throw new Error('O máximo de alunos por aula deve ser um número entre 1 e 20.');
      db.setSetting('school_name', escola);
      db.setSetting('max_group_size', v);
      const logoChanged = saveLogo(ctx.body._files);
      audit.log(ctx.user.id, 'CONFIGURACAO_ALTERADA', 'settings', null, `escola = ${escola}; max_group_size = ${v}${logoChanged ? '; logo atualizada' : ''}`);
      ctx.setFlash('success', 'Configurações salvas.');
    } catch (err) {
      ctx.setFlash('error', err.message);
    }
    ctx.redirect('/gestao/configuracoes');
  });

  router.post('/gestao/configuracoes/logo/remover', roleOk, (ctx) => {
    db.get().prepare("DELETE FROM settings WHERE key IN ('logo_type','logo_data','logo_version')").run();
    audit.log(ctx.user.id, 'CONFIGURACAO_ALTERADA', 'settings', null, 'logo removida');
    ctx.setFlash('success', 'Logo removida.');
    ctx.redirect('/gestao/configuracoes');
  });

  router.post('/gestao/configuracoes/exemplo/remover', roleOk, (ctx) => {
    // Remove tudo que o seed criou, preservando os usuários de gestão e as configurações da escola.
    db.transaction((d) => {
      for (const t of ['attendance', 'evaluations', 'observations', 'lesson_students', 'lessons', 'student_guardians', 'reenrollments', 'reenrollment_periods', 'students', 'announcements', 'events', 'notifications']) {
        d.exec(`DELETE FROM ${t}`);
      }
      d.prepare("DELETE FROM users WHERE role <> 'GESTAO' OR email LIKE '%@escola.org' AND id <> ?").run(ctx.user.id);
      d.prepare("DELETE FROM settings WHERE key = 'demo_mode'").run();
    });
    audit.log(ctx.user.id, 'DADOS_EXEMPLO_REMOVIDOS', 'settings', null);
    ctx.setFlash('success', 'Dados de exemplo removidos. Agora cadastre os professores, alunos e responsáveis reais.');
    ctx.redirect('/gestao');
  });

  // ---------- Alunos ----------
  router.get('/gestao/alunos', roleOk, (ctx) => {
    const filters = { status: ctx.query.status || (ctx.query.status === '' ? undefined : 'ATIVO'), teacherId: Number(ctx.query.professor) || undefined, search: ctx.query.busca || undefined };
    if (ctx.query.status === 'TODOS') filters.status = undefined;
    const list = students.listAll(filters);
    const teachers = teachersList();
    const body = `<div class="page-head"><h1>Alunos</h1><a class="btn" href="/gestao/alunos/novo">Novo aluno</a></div>
      <form method="get" action="/gestao/alunos" class="filters">
        ${field('Buscar', input('busca', ctx.query.busca || '', { type: 'search', placeholder: 'Nome do aluno' }))}
        ${field('Professor(a)', select('professor', teachers.map((t) => ({ value: t.id, label: t.name })), ctx.query.professor || '', { placeholder: 'Todos' }))}
        ${field('Situação', select('status', [{ value: 'ATIVO', label: 'Ativos' }, { value: 'INATIVO', label: 'Inativos' }, { value: 'TODOS', label: 'Todos' }], ctx.query.status || 'ATIVO'))}
        <button class="btn btn-secondary" type="submit">Filtrar</button></form>
      ${card(
        `${list.length} aluno(s)`,
        table(
          ['Aluno', 'Instrumento', 'Professor(a)', 'Responsáveis', 'Situação'],
          list.map((s) => [
            `<a href="/gestao/alunos/${s.id}"><strong>${esc(s.name)}</strong></a>${s.individual_only ? ' ' + badge('Individual', 'warn') : ''}`,
            esc(s.instrument || '—'),
            esc(s.teacher_name || '—'),
            esc(s.guardian_names || '—'),
            statusBadge(s.status),
          ]),
          { empty: 'Nenhum aluno encontrado.' }
        )
      )}`;
    ctx.render('Alunos', body);
  });

  router.get('/gestao/alunos/novo', roleOk, (ctx) => {
    const body = `<div class="page-head"><h1>Novo aluno</h1><a class="btn btn-secondary btn-sm" href="/gestao/alunos">← Alunos</a></div>
      ${card('', `<form method="post" action="/gestao/alunos/novo" class="form">${studentForm({}, teachersList())}<div><button class="btn" type="submit">Cadastrar aluno</button></div></form>`)}`;
    ctx.render('Novo aluno', body);
  });

  function saveStudentFromBody(ctx, id) {
    const b = ctx.body;
    const name = String(b.nome || '').trim();
    if (!name) throw new Error('Informe o nome do aluno.');
    const teacherId = Number(b.professor) || null;
    const args = [name, b.nascimento || null, String(b.instrumento || '').trim() || null, teacherId, b.individual_only === '1' ? 1 : 0, String(b.notas || '').trim() || null, b.status === 'INATIVO' ? 'INATIVO' : 'ATIVO', b.matricula || null];
    if (id) {
      db.get()
        .prepare("UPDATE students SET name = ?, birth_date = ?, instrument = ?, teacher_id = ?, individual_only = ?, notes = ?, status = ?, enrolled_at = ?, updated_at = datetime('now') WHERE id = ?")
        .run(...args, id);
      // Aluno inativo ou com troca de professor sai das aulas atuais do professor anterior.
      db.get()
        .prepare('DELETE FROM lesson_students WHERE student_id = ? AND lesson_id IN (SELECT id FROM lessons WHERE teacher_id IS NOT ? )')
        .run(id, teacherId || -1);
      if (b.status === 'INATIVO') db.get().prepare('DELETE FROM lesson_students WHERE student_id = ?').run(id);
      audit.log(ctx.user.id, 'ALUNO_ALTERADO', 'student', id, name);
      return id;
    }
    const r = db.get().prepare('INSERT INTO students(name, birth_date, instrument, teacher_id, individual_only, notes, status, enrolled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(...args);
    const newId = Number(r.lastInsertRowid);
    audit.log(ctx.user.id, 'ALUNO_CADASTRADO', 'student', newId, name);
    return newId;
  }

  router.post('/gestao/alunos/novo', roleOk, (ctx) => {
    try {
      const id = saveStudentFromBody(ctx, null);
      ctx.setFlash('success', 'Aluno cadastrado. Agora vincule os responsáveis.');
      ctx.redirect(`/gestao/alunos/${id}`);
    } catch (err) {
      ctx.setFlash('error', err.message);
      ctx.redirect('/gestao/alunos/novo');
    }
  });

  router.get('/gestao/alunos/:id', roleOk, (ctx) => {
    const s = students.byId(ctx.params.id);
    if (!s) throw new HttpError(404, 'Aluno não encontrado.');
    const aba = ctx.query.aba || 'cadastro';
    const base = `/gestao/alunos/${s.id}`;
    const guardians = students.guardiansOf(s.id);
    const allGuardians = guardiansList().filter((g) => !guardians.some((x) => x.id === g.id));
    let content = '';
    if (aba === 'cadastro') {
      content = `<div class="grid grid-2">${card(
        'Dados do aluno',
        `<form method="post" action="${base}" class="form">${studentForm(s, teachersList())}<div class="actions"><button class="btn" type="submit">Salvar</button></div></form>`
      )}<div>${card(
        'Responsáveis',
        `${
          guardians.length
            ? `<ul class="list">${guardians
                .map(
                  (g) => `<li><span class="title">${esc(g.name)}</span> ${g.relationship ? `<span class="muted">(${esc(g.relationship)})</span>` : ''}<div class="meta">${esc(g.email)}${g.phone ? ` · ${esc(g.phone)}` : ''}</div>
                  ${postButton(`${base}/responsaveis/${g.id}/remover`, 'Desvincular', { cls: 'btn btn-ghost btn-sm', confirm: 'Desvincular este responsável?' })}</li>`
                )
                .join('')}</ul>`
            : '<p class="empty">Nenhum responsável vinculado.</p>'
        }
        <form method="post" action="${base}/responsaveis" class="form" style="margin-top:.75rem">
          <div class="form-row">${field('Vincular responsável', select('responsavel', allGuardians.map((g) => ({ value: g.id, label: `${g.name} (${g.email})` })), '', { placeholder: 'Selecione…', required: true }))}
          ${field('Parentesco', input('parentesco', '', { placeholder: 'Mãe, pai, avó…' }))}</div>
          <div><button class="btn btn-secondary btn-sm" type="submit">Vincular</button> <a class="small" href="/gestao/usuarios/novo?perfil=RESPONSAVEL&aluno=${s.id}">Cadastrar novo responsável</a></div></form>`
      )}${card('Horário semanal', sv.scheduleBlock(s.id), {
        actions: s.teacher_id ? `<a class="btn btn-secondary btn-sm" href="/gestao/agenda?professor=${s.teacher_id}">Alterar na agenda</a>` : '',
      })}</div></div>`;
    } else if (aba === 'presenca') content = card('Presenças e faltas', sv.attendanceBlock(s.id));
    else if (aba === 'avaliacoes') {
      content = card('Avaliações', sv.evaluationsBlock(s.id, { canDelete: true, deleteBase: base }), {
        actions: s.teacher_id ? `<a class="btn btn-secondary btn-sm" href="/professor/alunos/${s.id}?professor=${s.teacher_id}&aba=avaliacoes">Lançar em nome do professor</a>` : '',
      });
    } else if (aba === 'observacoes') {
      content = card('Observações', sv.observationsBlock(s.id, { canDelete: true, deleteBase: base }), {
        actions: s.teacher_id ? `<a class="btn btn-secondary btn-sm" href="/professor/alunos/${s.id}?professor=${s.teacher_id}&aba=observacoes">Registrar em nome do professor</a>` : '',
      });
    } else if (aba === 'historico') content = card('Histórico', sv.historyBlock(s.id));
    const body = `<div class="page-head"><h1>${esc(s.name)} ${statusBadge(s.status)}</h1><a class="btn btn-secondary btn-sm" href="/gestao/alunos">← Alunos</a></div>
      ${sv.tabs(base, aba, [['cadastro', 'Cadastro'], ['presenca', 'Presença'], ['avaliacoes', 'Avaliações'], ['observacoes', 'Observações'], ['historico', 'Histórico']])}${content}`;
    ctx.render(s.name, body);
  });

  router.post('/gestao/alunos/:id', roleOk, (ctx) => {
    const s = students.byId(ctx.params.id);
    if (!s) throw new HttpError(404, 'Aluno não encontrado.');
    try {
      saveStudentFromBody(ctx, s.id);
      ctx.setFlash('success', 'Dados do aluno salvos.');
    } catch (err) {
      ctx.setFlash('error', err.message);
    }
    ctx.redirect(`/gestao/alunos/${s.id}`);
  });

  router.post('/gestao/alunos/:id/responsaveis', roleOk, (ctx) => {
    const s = students.byId(ctx.params.id);
    const g = db.get().prepare("SELECT id, name FROM users WHERE id = ? AND role = 'RESPONSAVEL'").get(Number(ctx.body.responsavel));
    if (!s || !g) throw new HttpError(400, 'Aluno ou responsável inválido.');
    db.get().prepare('INSERT OR REPLACE INTO student_guardians(student_id, guardian_id, relationship) VALUES (?, ?, ?)').run(s.id, g.id, String(ctx.body.parentesco || '').trim() || null);
    audit.log(ctx.user.id, 'RESPONSAVEL_VINCULADO', 'student', s.id, `${g.name} → ${s.name}`);
    ctx.setFlash('success', `${g.name} vinculado(a) a ${s.name}.`);
    ctx.redirect(`/gestao/alunos/${s.id}`);
  });

  router.post('/gestao/alunos/:id/responsaveis/:gid/remover', roleOk, (ctx) => {
    db.get().prepare('DELETE FROM student_guardians WHERE student_id = ? AND guardian_id = ?').run(ctx.params.id, ctx.params.gid);
    audit.log(ctx.user.id, 'RESPONSAVEL_DESVINCULADO', 'student', Number(ctx.params.id), `responsável #${ctx.params.gid}`);
    ctx.setFlash('success', 'Responsável desvinculado.');
    ctx.redirect(`/gestao/alunos/${ctx.params.id}`);
  });

  router.post('/gestao/alunos/:id/avaliacoes/:evalId/excluir', roleOk, (ctx) => {
    attendance.deleteEvaluation({ actor: ctx.user, id: Number(ctx.params.evalId) });
    ctx.setFlash('success', 'Avaliação excluída.');
    ctx.redirect(`/gestao/alunos/${ctx.params.id}?aba=avaliacoes`);
  });

  router.post('/gestao/alunos/:id/observacoes/:obsId/excluir', roleOk, (ctx) => {
    attendance.deleteObservation({ actor: ctx.user, id: Number(ctx.params.obsId) });
    ctx.setFlash('success', 'Observação excluída.');
    ctx.redirect(`/gestao/alunos/${ctx.params.id}?aba=observacoes`);
  });

  // ---------- Usuários (professores, responsáveis, gestão) ----------
  router.get('/gestao/usuarios', roleOk, (ctx) => {
    const perfil = ctx.query.perfil || 'PROFESSOR';
    const list = db
      .get()
      .prepare(
        `SELECT u.*, (SELECT COUNT(*) FROM students s WHERE s.teacher_id = u.id AND s.status = 'ATIVO') AS student_count,
           (SELECT GROUP_CONCAT(s.name, ', ') FROM student_guardians g JOIN students s ON s.id = g.student_id WHERE g.guardian_id = u.id) AS dependents
         FROM users u WHERE u.role = ? ORDER BY u.active DESC, u.name`
      )
      .all(perfil);
    const body = `<div class="page-head"><h1>Professores e usuários</h1><a class="btn" href="/gestao/usuarios/novo?perfil=${perfil}">Novo usuário</a></div>
      <div class="subnav">${['PROFESSOR', 'RESPONSAVEL', 'GESTAO'].map((p) => `<a class="pill${perfil === p ? ' active' : ''}" href="/gestao/usuarios?perfil=${p}">${esc(config.ROLE_LABELS[p])}</a>`).join('')}</div>
      ${card(
        `${list.length} usuário(s)`,
        table(
          ['Nome', 'E-mail', perfil === 'PROFESSOR' ? 'Alunos ativos' : perfil === 'RESPONSAVEL' ? 'Dependentes' : 'Telefone', 'Acesso', ''],
          list.map((u) => [
            `<a href="/gestao/usuarios/${u.id}"><strong>${esc(u.name)}</strong></a>${u.instruments ? `<div class="small muted">${esc(u.instruments)}</div>` : ''}`,
            esc(u.email),
            perfil === 'PROFESSOR' ? String(u.student_count) : perfil === 'RESPONSAVEL' ? esc(u.dependents || '—') : esc(u.phone || '—'),
            u.active ? badge('Ativo', 'ok') : badge('Desativado', 'neutral'),
            perfil === 'PROFESSOR' && u.active ? `<a class="btn btn-secondary btn-sm" href="/gestao/agenda?professor=${u.id}">Agenda</a>` : '',
          ]),
          { empty: 'Nenhum usuário.' }
        )
      )}`;
    ctx.render('Usuários', body);
  });

  router.get('/gestao/usuarios/novo', roleOk, (ctx) => {
    const body = `<div class="page-head"><h1>Novo usuário</h1><a class="btn btn-secondary btn-sm" href="/gestao/usuarios">← Usuários</a></div>
      ${card(
        '',
        `<form method="post" action="/gestao/usuarios/novo" class="form"><input type="hidden" name="aluno" value="${attr(ctx.query.aluno || '')}">
        ${userForm({ role: ctx.query.perfil || 'PROFESSOR' })}
        ${field('Senha inicial', input('senha', '', { type: 'text', required: true, placeholder: 'Informe ao usuário; ele deverá trocar no primeiro acesso' }))}
        <div><button class="btn" type="submit">Cadastrar</button></div></form>`
      )}`;
    ctx.render('Novo usuário', body);
  });

  router.post('/gestao/usuarios/novo', roleOk, (ctx) => {
    const b = ctx.body;
    const name = String(b.nome || '').trim();
    const email = String(b.email || '').trim().toLowerCase();
    const role = ['PROFESSOR', 'RESPONSAVEL', 'GESTAO'].includes(b.perfil) ? b.perfil : 'PROFESSOR';
    const senha = String(b.senha || '');
    try {
      if (!name || !email) throw new Error('Nome e e-mail são obrigatórios.');
      if (senha.length < 6) throw new Error('A senha inicial deve ter pelo menos 6 caracteres.');
      if (db.get().prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new Error('Já existe um usuário com este e-mail.');
      const r = db
        .get()
        .prepare('INSERT INTO users(name, email, password_hash, role, phone, instruments, must_change_password) VALUES (?, ?, ?, ?, ?, ?, 1)')
        .run(name, email, auth.hashPassword(senha), role, String(b.telefone || '').trim() || null, String(b.instrumentos || '').trim() || null);
      const id = Number(r.lastInsertRowid);
      audit.log(ctx.user.id, 'USUARIO_CADASTRADO', 'user', id, `${name} (${config.ROLE_LABELS[role]})`);
      const alunoId = Number(b.aluno);
      if (role === 'RESPONSAVEL' && alunoId) {
        db.get().prepare('INSERT OR IGNORE INTO student_guardians(student_id, guardian_id) VALUES (?, ?)').run(alunoId, id);
        ctx.setFlash('success', 'Responsável cadastrado e vinculado ao aluno.');
        return ctx.redirect(`/gestao/alunos/${alunoId}`);
      }
      ctx.setFlash('success', `Usuário cadastrado. Informe o e-mail ${email} e a senha inicial.`);
      ctx.redirect(`/gestao/usuarios/${id}`);
    } catch (err) {
      ctx.setFlash('error', err.message);
      ctx.redirect(`/gestao/usuarios/novo?perfil=${role}${b.aluno ? `&aluno=${encodeURIComponent(b.aluno)}` : ''}`);
    }
  });

  router.get('/gestao/usuarios/:id', roleOk, (ctx) => {
    const u = db.get().prepare('SELECT * FROM users WHERE id = ?').get(ctx.params.id);
    if (!u) throw new HttpError(404, 'Usuário não encontrado.');
    let extra = '';
    if (u.role === 'PROFESSOR') {
      const list = students.listForTeacher(u.id, { includeInactive: true });
      extra = card(
        'Alunos deste professor',
        table(['Aluno', 'Instrumento', 'Situação'], list.map((s) => [`<a href="/gestao/alunos/${s.id}">${esc(s.name)}</a>`, esc(s.instrument || '—'), statusBadge(s.status)]), { empty: 'Nenhum aluno vinculado. Edite o cadastro do aluno para definir o professor.' }),
        { actions: `<a class="btn btn-secondary btn-sm" href="/gestao/agenda?professor=${u.id}">Agenda</a> <a class="btn btn-secondary btn-sm" href="/professor?professor=${u.id}">Área do professor</a>` }
      );
    } else if (u.role === 'RESPONSAVEL') {
      const list = students.listForGuardian(u.id);
      extra = card('Dependentes', table(['Aluno', 'Parentesco', 'Professor(a)'], list.map((s) => [`<a href="/gestao/alunos/${s.id}">${esc(s.name)}</a>`, esc(s.relationship || '—'), esc(s.teacher_name || '—')]), { empty: 'Nenhum dependente. Vincule pelo cadastro do aluno.' }));
    }
    const body = `<div class="page-head"><h1>${esc(u.name)} ${u.active ? '' : badge('Desativado', 'neutral')}</h1><a class="btn btn-secondary btn-sm" href="/gestao/usuarios?perfil=${u.role}">← Usuários</a></div>
      <div class="grid grid-2">${card(
        'Cadastro',
        `<form method="post" action="/gestao/usuarios/${u.id}" class="form">${userForm(u)}<div class="actions"><button class="btn" type="submit">Salvar</button></div></form>`
      )}${card(
        'Acesso',
        `<form method="post" action="/gestao/usuarios/${u.id}/senha" class="form">${field('Definir nova senha', input('senha', '', { type: 'text', required: true }), 'O usuário deverá trocá-la no próximo acesso.')}<div><button class="btn btn-secondary" type="submit">Redefinir senha</button></div></form>
        <hr>${
          u.id === ctx.user.id
            ? '<p class="muted small">Você não pode desativar o próprio acesso.</p>'
            : postButton(`/gestao/usuarios/${u.id}/ativo`, u.active ? 'Desativar acesso' : 'Reativar acesso', { cls: u.active ? 'btn btn-danger' : 'btn btn-ok', confirm: u.active ? 'Desativar o acesso deste usuário?' : undefined, hidden: { ativo: u.active ? '0' : '1' } })
        }`
      )}</div>${extra}`;
    ctx.render(u.name, body);
  });

  router.post('/gestao/usuarios/:id', roleOk, (ctx) => {
    const u = db.get().prepare('SELECT * FROM users WHERE id = ?').get(ctx.params.id);
    if (!u) throw new HttpError(404, 'Usuário não encontrado.');
    const b = ctx.body;
    const name = String(b.nome || '').trim();
    const email = String(b.email || '').trim().toLowerCase();
    const role = ['PROFESSOR', 'RESPONSAVEL', 'GESTAO'].includes(b.perfil) ? b.perfil : u.role;
    try {
      if (!name || !email) throw new Error('Nome e e-mail são obrigatórios.');
      if (u.id === ctx.user.id && role !== 'GESTAO') throw new Error('Você não pode remover seu próprio perfil de gestão.');
      const dup = db.get().prepare('SELECT id FROM users WHERE email = ? AND id <> ?').get(email, u.id);
      if (dup) throw new Error('Já existe outro usuário com este e-mail.');
      db.get().prepare('UPDATE users SET name = ?, email = ?, role = ?, phone = ?, instruments = ? WHERE id = ?').run(name, email, role, String(b.telefone || '').trim() || null, String(b.instrumentos || '').trim() || null, u.id);
      audit.log(ctx.user.id, 'USUARIO_ALTERADO', 'user', u.id, `${name} (${config.ROLE_LABELS[role]})`);
      ctx.setFlash('success', 'Cadastro salvo.');
    } catch (err) {
      ctx.setFlash('error', err.message);
    }
    ctx.redirect(`/gestao/usuarios/${u.id}`);
  });

  router.post('/gestao/usuarios/:id/senha', roleOk, (ctx) => {
    const senha = String(ctx.body.senha || '');
    if (senha.length < 6) {
      ctx.setFlash('error', 'A senha deve ter pelo menos 6 caracteres.');
    } else {
      db.get().prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(auth.hashPassword(senha), ctx.params.id);
      db.get().prepare('DELETE FROM sessions WHERE user_id = ?').run(ctx.params.id);
      audit.log(ctx.user.id, 'SENHA_REDEFINIDA', 'user', Number(ctx.params.id));
      ctx.setFlash('success', 'Senha redefinida. Informe a nova senha ao usuário.');
    }
    ctx.redirect(`/gestao/usuarios/${ctx.params.id}`);
  });

  router.post('/gestao/usuarios/:id/ativo', roleOk, (ctx) => {
    const id = Number(ctx.params.id);
    if (id === ctx.user.id) throw new HttpError(400, 'Você não pode desativar o próprio acesso.');
    const ativo = ctx.body.ativo === '1' ? 1 : 0;
    db.get().prepare('UPDATE users SET active = ? WHERE id = ?').run(ativo, id);
    if (!ativo) db.get().prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    audit.log(ctx.user.id, ativo ? 'USUARIO_REATIVADO' : 'USUARIO_DESATIVADO', 'user', id);
    ctx.setFlash('success', ativo ? 'Acesso reativado.' : 'Acesso desativado.');
    ctx.redirect(`/gestao/usuarios/${id}`);
  });

  // ---------- Presenças e avaliações (relatórios) ----------
  router.get('/gestao/presencas', roleOk, (ctx) => {
    const q = ctx.query;
    const from = attendance.validDate(q.de) ? q.de : attendance.isoDate(new Date(Date.now() - 30 * 86400000));
    const to = attendance.validDate(q.ate) ? q.ate : attendance.isoDate();
    const rows = attendance.report({ from, to, teacherId: Number(q.professor) || undefined, status: q.status || undefined });
    const totals = rows.reduce((acc, r) => ((acc[r.status] = (acc[r.status] || 0) + 1), acc), {});
    const body = `<h1>Presenças e faltas</h1>
      <form method="get" action="/gestao/presencas" class="filters">
        ${field('De', input('de', from, { type: 'date' }))}${field('Até', input('ate', to, { type: 'date' }))}
        ${field('Professor(a)', select('professor', teachersList().map((t) => ({ value: t.id, label: t.name })), q.professor || '', { placeholder: 'Todos' }))}
        ${field('Situação', select('status', attendance.STATUSES.map((s) => ({ value: s, label: attendance.STATUS_LABELS[s] })), q.status || '', { placeholder: 'Todas' }))}
        <button class="btn btn-secondary" type="submit">Filtrar</button></form>
      <div class="stats">${ui.stat('Presenças', totals.PRESENTE || 0)}${ui.stat('Faltas', totals.FALTA || 0)}${ui.stat('Justificadas', totals.JUSTIFICADA || 0)}</div>
      ${card('', table(['Data', 'Horário', 'Aluno', 'Professor(a)', 'Situação', 'Observação'], rows.map((r) => [fmtDate(r.date), esc(schedule.slotLabel(r.slot_index)), `<a href="/gestao/alunos/${r.student_id}?aba=presenca">${esc(r.student_name)}</a>`, esc(r.teacher_name || ''), statusBadge(r.status), esc(r.note || '')]), { empty: 'Nenhum registro no período.' }))}`;
    ctx.render('Presenças', body);
  });

  router.get('/gestao/avaliacoes', roleOk, (ctx) => {
    const teacherId = Number(ctx.query.professor) || null;
    const rows = db
      .get()
      .prepare(
        `SELECT e.*, s.name AS student_name, t.name AS teacher_name FROM evaluations e JOIN students s ON s.id = e.student_id
         LEFT JOIN users t ON t.id = e.teacher_id ${teacherId ? 'WHERE e.teacher_id = ?' : ''} ORDER BY e.date DESC, e.id DESC LIMIT 300`
      )
      .all(...(teacherId ? [teacherId] : []));
    const body = `<h1>Notas e avaliações</h1>
      <form method="get" action="/gestao/avaliacoes" class="filters">${field('Professor(a)', select('professor', teachersList().map((t) => ({ value: t.id, label: t.name })), ctx.query.professor || '', { placeholder: 'Todos' }))}<button class="btn btn-secondary" type="submit">Filtrar</button></form>
      ${card('', table(['Data', 'Aluno', 'Avaliação', 'Nota', 'Comentário', 'Professor(a)'], rows.map((e) => [fmtDate(e.date), `<a href="/gestao/alunos/${e.student_id}?aba=avaliacoes">${esc(e.student_name)}</a>`, esc(e.title), fmtGrade(e.grade), ui.nl2br(e.comment || ''), esc(e.teacher_name || '')]), { empty: 'Nenhuma avaliação lançada.' }))}`;
    ctx.render('Avaliações', body);
  });

  // ---------- Comunicados ----------
  router.get('/gestao/comunicados', roleOk, (ctx) => {
    const list = db
      .get()
      .prepare(
        `SELECT a.*, u.name AS author, s.name AS student_name, t.name AS teacher_name FROM announcements a
         LEFT JOIN users u ON u.id = a.author_id LEFT JOIN students s ON s.id = a.student_id LEFT JOIN users t ON t.id = a.teacher_id
         ORDER BY a.id DESC LIMIT 200`
      )
      .all();
    const scopeBadge = (a) =>
      a.scope === 'TODOS' ? badge('Todos os responsáveis', 'primary') : a.scope === 'PROFESSORES' ? badge('Professores', 'neutral') : a.scope === 'ALUNO' ? badge(`Aluno: ${a.student_name || ''}`, 'warn') : badge(`Alunos de ${a.teacher_name || ''}`, 'ok');
    const body = `<h1>Comunicados</h1><div class="grid grid-2">${card(
      'Novo comunicado',
      `<form method="post" action="/gestao/comunicados" class="form">
        ${field('Destinatários', select('escopo', [{ value: 'TODOS', label: 'Todos os responsáveis' }, { value: 'PROFESSORES', label: 'Todos os professores' }, { value: 'AMBOS', label: 'Responsáveis e professores' }], 'TODOS'))}
        ${field('Título', input('titulo', '', { required: true }))}
        ${field('Mensagem', textarea('mensagem', '', { rows: 6, required: true }))}
        <div><button class="btn" type="submit">Enviar comunicado</button></div></form>`
    )}${card(
      'Histórico (inclui os enviados por professores)',
      list.length
        ? `<ul class="list">${list
            .map((a) => `<li><div class="title">${esc(a.title)} ${scopeBadge(a)}</div><div class="small">${ui.nl2br(a.body)}</div><div class="meta">${esc(a.author || 'Escola')} · ${fmtDateTime(a.created_at)} ${postButton(`/gestao/comunicados/${a.id}/excluir`, 'Excluir', { cls: 'btn btn-ghost btn-sm', confirm: 'Excluir este comunicado?' })}</div></li>`)
            .join('')}</ul>`
        : '<p class="empty">Nenhum comunicado.</p>'
    )}</div>`;
    ctx.render('Comunicados', body);
  });

  router.post('/gestao/comunicados', roleOk, (ctx) => {
    const title = String(ctx.body.titulo || '').trim();
    const text = String(ctx.body.mensagem || '').trim();
    if (!title || !text) {
      ctx.setFlash('error', 'Informe título e mensagem.');
      return ctx.redirect('/gestao/comunicados');
    }
    const escopo = ['TODOS', 'PROFESSORES', 'AMBOS'].includes(ctx.body.escopo) ? ctx.body.escopo : 'TODOS';
    const scopes = escopo === 'AMBOS' ? ['TODOS', 'PROFESSORES'] : [escopo];
    let total = 0;
    for (const scope of scopes) {
      const r = db.get().prepare('INSERT INTO announcements(author_id, title, body, scope) VALUES (?, ?, ?, ?)').run(ctx.user.id, title, text, scope);
      total += notify.notifyRole(scope === 'TODOS' ? 'RESPONSAVEL' : 'PROFESSOR', 'COMUNICADO', `Comunicado: ${title}`, text.slice(0, 140), scope === 'TODOS' ? '/responsavel/comunicados' : '/professor/comunicados');
      audit.log(ctx.user.id, 'COMUNICADO_ENVIADO', 'announcement', Number(r.lastInsertRowid), `${title} (${scope})`);
    }
    ctx.setFlash('success', `Comunicado enviado para ${total} pessoa(s).`);
    ctx.redirect('/gestao/comunicados');
  });

  router.post('/gestao/comunicados/:id/excluir', roleOk, (ctx) => {
    db.get().prepare('DELETE FROM announcements WHERE id = ?').run(ctx.params.id);
    audit.log(ctx.user.id, 'COMUNICADO_EXCLUIDO', 'announcement', Number(ctx.params.id));
    ctx.setFlash('success', 'Comunicado excluído.');
    ctx.redirect('/gestao/comunicados');
  });

  // ---------- Eventos ----------
  router.get('/gestao/eventos', roleOk, (ctx) => {
    const events = db.get().prepare('SELECT e.*, u.name AS author FROM events e LEFT JOIN users u ON u.id = e.created_by ORDER BY e.starts_at DESC LIMIT 200').all();
    const body = `<h1>Atividades e eventos</h1><div class="grid grid-2">${card(
      'Novo evento',
      `<form method="post" action="/gestao/eventos" class="form">
        ${field('Título', input('titulo', '', { required: true, placeholder: 'Ex.: Recital de fim de ano' }))}
        <div class="form-row">${field('Data e hora', input('inicio', '', { type: 'datetime-local', required: true }))}${field('Local', input('local', '', { placeholder: 'Ex.: Auditório' }))}</div>
        ${field('Descrição', textarea('descricao', '', { rows: 4 }))}
        <label class="check"><input type="checkbox" name="notificar" value="1" checked><span>Notificar todos os responsáveis</span></label>
        <div><button class="btn" type="submit">Cadastrar evento</button></div></form>`
    )}${card(
      'Eventos',
      events.length
        ? `<ul class="list">${events
            .map((e) => `<li><div class="title">${esc(e.title)}</div><div class="meta">${fmtDateTime(e.starts_at)}${e.location ? ` · ${esc(e.location)}` : ''}</div>${e.description ? `<div class="small">${ui.nl2br(e.description)}</div>` : ''}<div class="meta">${postButton(`/gestao/eventos/${e.id}/excluir`, 'Excluir', { cls: 'btn btn-ghost btn-sm', confirm: 'Excluir este evento?' })}</div></li>`)
            .join('')}</ul>`
        : '<p class="empty">Nenhum evento cadastrado.</p>'
    )}</div>`;
    ctx.render('Eventos', body);
  });

  router.post('/gestao/eventos', roleOk, (ctx) => {
    const title = String(ctx.body.titulo || '').trim();
    const starts = String(ctx.body.inicio || '').trim();
    if (!title || !starts || Number.isNaN(Date.parse(starts))) {
      ctx.setFlash('error', 'Informe título e data válidos.');
      return ctx.redirect('/gestao/eventos');
    }
    const r = db.get().prepare('INSERT INTO events(title, description, starts_at, location, created_by) VALUES (?, ?, ?, ?, ?)').run(title, String(ctx.body.descricao || '').trim() || null, starts, String(ctx.body.local || '').trim() || null, ctx.user.id);
    audit.log(ctx.user.id, 'EVENTO_CADASTRADO', 'event', Number(r.lastInsertRowid), title);
    let n = 0;
    if (ctx.body.notificar === '1') n = notify.notifyRole('RESPONSAVEL', 'EVENTO', `Evento: ${title}`, `${fmtDateTime(starts)}${ctx.body.local ? ` · ${ctx.body.local}` : ''}`, '/responsavel/eventos');
    ctx.setFlash('success', `Evento cadastrado${n ? ` e ${n} responsável(is) notificado(s)` : ''}.`);
    ctx.redirect('/gestao/eventos');
  });

  router.post('/gestao/eventos/:id/excluir', roleOk, (ctx) => {
    db.get().prepare('DELETE FROM events WHERE id = ?').run(ctx.params.id);
    audit.log(ctx.user.id, 'EVENTO_EXCLUIDO', 'event', Number(ctx.params.id));
    ctx.setFlash('success', 'Evento excluído.');
    ctx.redirect('/gestao/eventos');
  });

  // ---------- Rematrícula ----------
  router.get('/gestao/rematricula', roleOk, (ctx) => {
    const periods = reenrollment.listPeriods();
    const nextYear = new Date().getFullYear() + 1;
    const defaultTerms = `Ao confirmar a rematrícula, o responsável declara estar ciente de que:
1. As aulas acontecem nos horários definidos pela escola, com duração de 40 minutos.
2. Faltas devem ser comunicadas com antecedência; três faltas consecutivas sem justificativa podem resultar na perda da vaga.
3. O aluno deve zelar pelos instrumentos e materiais da escola.
4. A escola poderá utilizar imagens do aluno em apresentações e divulgação do projeto social, salvo manifestação contrária por escrito.
5. Os dados informados são verdadeiros e serão usados apenas para fins escolares.`;
    const body = `<h1>Rematrícula</h1><div class="grid grid-2">${card(
      'Abrir novo período',
      `<form method="post" action="/gestao/rematricula" class="form">
        <div class="form-row">${field('Nome', input('nome', `Rematrícula ${nextYear}`, { required: true }))}${field('Ano letivo', input('ano', nextYear, { type: 'number', required: true }))}</div>
        <div class="form-row">${field('Abre em', input('abre', attendance.isoDate(), { type: 'date', required: true }))}${field('Encerra em', input('fecha', '', { type: 'date', required: true }))}</div>
        ${field('Termos que o responsável deve aceitar', textarea('termos', defaultTerms, { rows: 8, required: true }))}
        <div><button class="btn" type="submit">Abrir rematrícula e notificar responsáveis</button></div></form>`
    )}${card(
      'Períodos',
      periods.length
        ? table(
            ['Período', 'Prazo', 'Respostas', 'Situação', ''],
            periods.map((p) => [
              `<a href="/gestao/rematricula/${p.id}"><strong>${esc(p.name)}</strong></a><div class="small muted">ano ${p.year}</div>`,
              `${fmtDate(p.opens_at)} a ${fmtDate(p.closes_at)}`,
              `${p.confirmadas} confirmadas · ${p.recusadas} não renovam · ${p.total - p.confirmadas - p.recusadas} pendentes`,
              p.active ? badge('Aberto', 'ok') : badge('Encerrado', 'neutral'),
              p.active ? postButton(`/gestao/rematricula/${p.id}/encerrar`, 'Encerrar', { cls: 'btn btn-danger btn-sm', confirm: 'Encerrar este período de rematrícula?' }) : postButton(`/gestao/rematricula/${p.id}/reabrir`, 'Reabrir', { cls: 'btn btn-secondary btn-sm' }),
            ])
          )
        : '<p class="empty">Nenhum período criado.</p>'
    )}</div>`;
    ctx.render('Rematrícula', body);
  });

  router.post('/gestao/rematricula', roleOk, (ctx) => {
    try {
      const id = reenrollment.openPeriod({ actor: ctx.user, name: ctx.body.nome, year: ctx.body.ano, opensAt: ctx.body.abre, closesAt: ctx.body.fecha, terms: ctx.body.termos });
      ctx.setFlash('success', 'Período de rematrícula aberto. Os responsáveis foram notificados.');
      ctx.redirect(`/gestao/rematricula/${id}`);
    } catch (err) {
      ctx.setFlash('error', err.message);
      ctx.redirect('/gestao/rematricula');
    }
  });

  router.post('/gestao/rematricula/:id/encerrar', roleOk, (ctx) => {
    reenrollment.closePeriod({ actor: ctx.user, id: Number(ctx.params.id) });
    ctx.setFlash('success', 'Período encerrado.');
    ctx.redirect('/gestao/rematricula');
  });

  router.post('/gestao/rematricula/:id/reabrir', roleOk, (ctx) => {
    reenrollment.reopenPeriod({ actor: ctx.user, id: Number(ctx.params.id) });
    ctx.setFlash('success', 'Período reaberto.');
    ctx.redirect('/gestao/rematricula');
  });

  router.get('/gestao/rematricula/:id', roleOk, (ctx) => {
    const p = reenrollment.periodById(ctx.params.id);
    if (!p) throw new HttpError(404, 'Período não encontrado.');
    const status = ['PENDENTE', 'CONFIRMADA', 'NAO_RENOVAR'].includes(ctx.query.status) ? ctx.query.status : undefined;
    const rows = reenrollment.listForPeriod(p.id, { status });
    const body = `<div class="page-head"><h1>${esc(p.name)} ${p.active ? badge('Aberto', 'ok') : badge('Encerrado', 'neutral')}</h1><div class="actions"><a class="btn btn-secondary btn-sm" href="/gestao/rematricula/${p.id}/csv">Exportar CSV</a><a class="btn btn-secondary btn-sm" href="/gestao/rematricula">← Períodos</a></div></div>
      <div class="subnav">${[['', 'Todas'], ['PENDENTE', 'Pendentes'], ['CONFIRMADA', 'Confirmadas'], ['NAO_RENOVAR', 'Não renovam']].map(([k, l]) => `<a class="pill${(status || '') === k ? ' active' : ''}" href="/gestao/rematricula/${p.id}${k ? `?status=${k}` : ''}">${l}</a>`).join('')}</div>
      ${card(
        `${rows.length} aluno(s)`,
        table(
          ['Aluno', 'Professor(a)', 'Situação', 'Instrumento', 'Horário', 'Responsável', 'Respondido em'],
          rows.map((r) => [
            `<a href="/gestao/alunos/${r.student_id}">${esc(r.student_name)}</a>`,
            esc(r.teacher_name || '—'),
            statusBadge(r.status),
            r.instrument && r.instrument !== r.current_instrument ? `${esc(r.instrument)} <span class="small muted">(era ${esc(r.current_instrument || '—')})</span>` : esc(r.instrument || r.current_instrument || '—'),
            r.status === 'PENDENTE' ? '—' : r.keep_schedule ? badge('Manter', 'ok') : `${badge('Pede alteração', 'warn')}<div class="small">${esc(r.schedule_request || '')}</div>`,
            r.status === 'PENDENTE' ? '—' : `${esc(r.guardian_name || r.responded_by || '')}<div class="small muted">${esc(r.guardian_phone || '')}${r.guardian_email ? ` · ${esc(r.guardian_email)}` : ''}</div>${r.student_notes ? `<div class="small">${ui.nl2br(r.student_notes)}</div>` : ''}`,
            r.completed_at ? fmtDateTime(r.completed_at) : '—',
          ]),
          { empty: 'Nenhum registro.' }
        )
      )}`;
    ctx.render(p.name, body);
  });

  router.get('/gestao/rematricula/:id/csv', roleOk, (ctx) => {
    const p = reenrollment.periodById(ctx.params.id);
    if (!p) throw new HttpError(404, 'Período não encontrado.');
    const csv = reenrollment.toCsv(reenrollment.listForPeriod(p.id));
    ctx.text(200, csv, 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="rematricula-${p.year}.csv"` });
  });

  // ---------- Auditoria ----------
  router.get('/gestao/auditoria', roleOk, (ctx) => {
    const userId = Number(ctx.query.usuario) || undefined;
    const rows = audit.recent(300, { userId, entity: ctx.query.tipo || undefined });
    const users = db.get().prepare("SELECT id, name FROM users WHERE role IN ('PROFESSOR','GESTAO') ORDER BY name").all();
    const body = `<h1>Alterações realizadas na plataforma</h1>
      <form method="get" action="/gestao/auditoria" class="filters">${field('Usuário', select('usuario', users.map((u) => ({ value: u.id, label: u.name })), ctx.query.usuario || '', { placeholder: 'Todos' }))}
      ${field('Tipo', select('tipo', [{ value: 'lesson', label: 'Horários' }, { value: 'attendance', label: 'Presenças' }, { value: 'evaluation', label: 'Avaliações' }, { value: 'observation', label: 'Observações' }, { value: 'announcement', label: 'Comunicados' }, { value: 'student', label: 'Alunos' }, { value: 'user', label: 'Usuários' }, { value: 'reenrollment', label: 'Rematrícula' }, { value: 'login', label: 'Acessos (login)' }], ctx.query.tipo || '', { placeholder: 'Todos' }))}
      <button class="btn btn-secondary" type="submit">Filtrar</button></form>
      ${card('', table(['Quando', 'Quem', 'Ação', 'Detalhes'], rows.map((a) => [fmtDateTime(a.created_at), `${esc(a.user_name || 'Sistema')} <span class="muted small">${esc(config.ROLE_LABELS[a.user_role] || '')}</span>`, badge(a.action.replace(/_/g, ' '), 'neutral'), esc(a.details || '')]), { empty: 'Nenhum registro.' }))}`;
    ctx.render('Alterações', body);
  });
};
