'use strict';

const config = require('../config');
const db = require('../db');
const audit = require('../audit');
const notify = require('../notify');
const schedule = require('../services/schedule');
const lessons = require('../services/lessons');
const students = require('../services/students');
const attendance = require('../services/attendance');
const { HttpError, asArray } = require('../http');
const { requireRole } = require('./common');
const ui = require('../views/ui');
const sv = require('../views/student');
const { esc, attr, card, field, input, textarea, select, table, fmtDate, fmtDateTime, badge, statusBadge } = ui;

const roleOk = requireRole('PROFESSOR', 'GESTAO');

/**
 * Resolve em nome de qual professor a página está sendo exibida.
 * Professores só veem a si mesmos; a gestão pode agir em nome de qualquer professor (?professor=ID).
 */
function resolveTeacher(ctx) {
  if (ctx.user.role === 'PROFESSOR') {
    ctx.teacher = ctx.user;
    ctx.qs = '';
    return true;
  }
  const id = Number(ctx.query.professor || ctx.body.professor);
  if (!id) throw new HttpError(400, 'Selecione o professor (parâmetro "professor").');
  const t = db.get().prepare("SELECT id, name, email, role FROM users WHERE id = ? AND role = 'PROFESSOR'").get(id);
  if (!t) throw new HttpError(404, 'Professor não encontrado.');
  ctx.teacher = t;
  ctx.qs = `?professor=${t.id}`;
  ctx.actingAs = t;
  return true;
}

function link(ctx, path, extraQuery = '') {
  const parts = [];
  if (ctx.qs) parts.push(ctx.qs.slice(1));
  if (extraQuery) parts.push(extraQuery);
  return path + (parts.length ? '?' + parts.join('&') : '');
}

function hiddenTeacher(ctx) {
  return ctx.qs ? `<input type="hidden" name="professor" value="${ctx.teacher.id}">` : '';
}

function render(ctx, title, body) {
  ctx.render(title, body, { actingAs: ctx.actingAs || null });
}

/** Grade semanal (reutilizada pela gestão na agenda geral por professor). */
function weekGrid(ctx, grid, { editable = true } = {}) {
  const today = new Date().getDay();
  const cols = config.WEEKDAYS;
  let html = `<div class="table-wrap"><div class="schedule" style="--days:${cols.length}"><div></div>${cols
    .map((wd) => `<div class="sc-head">${esc(schedule.weekdayName(wd))}</div>`)
    .join('')}`;
  let lastPeriod = null;
  for (const slot of schedule.SLOTS) {
    if (slot.period !== lastPeriod) {
      html += `<div class="sc-period">${esc(slot.periodLabel)}</div>`;
      lastPeriod = slot.period;
    }
    html += `<div class="sc-time">${esc(slot.label)}</div>`;
    for (const wd of cols) {
      const l = grid.map.get(`${wd}:${slot.index}`);
      const href = editable ? link(ctx, `/professor/agenda/${wd}/${slot.index}`) : null;
      const cls = `sc-cell ${l ? (l.individual ? 'individual' : 'group') : 'free'}${wd === today ? ' today-col' : ''}`;
      const inner = l
        ? `<div class="sc-title"><span>${l.individual ? 'Individual' : `Grupo (${l.students.length})`}</span>${
            l.room ? `<span class="muted">Sala ${esc(l.room)}</span>` : ''
          }</div><ul>${l.students.map((s) => `<li>${esc(s.name)}</li>`).join('') || '<li class="muted">sem alunos</li>'}</ul>`
        : `<span>Livre</span>`;
      html += href ? `<a class="${cls}" href="${attr(href)}">${inner}</a>` : `<div class="${cls}">${inner}</div>`;
    }
  }
  html += `</div></div><div class="legend"><span class="l-group">Aula em grupo</span><span class="l-ind">Aula individual</span><span class="l-free">Horário livre${
    editable ? ' (clique para montar a aula)' : ''
  }</span></div>`;
  return html;
}

module.exports = function register(router) {
  // ---------- Início ----------
  router.get('/professor', roleOk, resolveTeacher, (ctx) => {
    const t = ctx.teacher;
    const today = new Date().getDay();
    const todays = lessons.lessonsForTeacherOnWeekday(t.id, today);
    const myStudents = students.listForTeacher(t.id);
    const grid = lessons.weekGridForTeacher(t.id);
    const unscheduled = myStudents.filter((s) => !s.lesson_count);
    const dateStr = attendance.isoDate();
    const records = attendance.recordsFor(t.id, dateStr);
    const recentNotes = db
      .get()
      .prepare(
        `SELECT a.*, u.name AS author FROM announcements a LEFT JOIN users u ON u.id = a.author_id
         WHERE a.scope IN ('TODOS','PROFESSORES') OR a.teacher_id = ? ORDER BY a.id DESC LIMIT 3`
      )
      .all(t.id);

    const todayHtml = todays.length
      ? `<ul class="list">${todays
          .map((l) => {
            const done = l.students.length > 0 && l.students.every((s) => records.has(`${s.id}:${l.slot_index}`));
            return `<li><span class="title">${esc(schedule.slotLabel(l.slot_index))}</span> ${
              l.individual ? badge('Individual', 'warn') : badge('Grupo', 'primary')
            } ${done ? badge('Presença registrada', 'ok') : ''}
            <div>${l.students.map((s) => esc(s.name)).join(', ') || '<span class="muted">sem alunos</span>'}</div>
            <div class="meta"><a href="${attr(link(ctx, '/professor/presenca', `data=${dateStr}`))}">Registrar presença</a></div></li>`;
          })
          .join('')}</ul>`
      : `<p class="empty">Você não tem aulas hoje (${esc(schedule.weekdayName(today))}).</p>`;

    const body = `<div class="page-head"><h1>Olá, ${esc(t.name.split(' ')[0])}</h1><div class="actions">
        <a class="btn" href="${attr(link(ctx, '/professor/presenca'))}">Registrar presença de hoje</a>
        <a class="btn btn-secondary" href="${attr(link(ctx, '/professor/agenda'))}">Organizar horários</a></div></div>
      <div class="stats">
        ${ui.stat('Alunos ativos', myStudents.length)}
        ${ui.stat('Aulas na semana', grid.lessons.length)}
        ${ui.stat('Aulas hoje', todays.length)}
        ${ui.stat('Alunos sem horário', unscheduled.length, unscheduled.length ? 'Precisam ser encaixados' : '')}
      </div>
      <div class="grid grid-2">
        ${card(`Aulas de hoje · ${esc(schedule.weekdayName(today))}`, todayHtml)}
        ${card(
          'Avisos recentes',
          recentNotes.length
            ? `<ul class="list">${recentNotes
                .map((a) => `<li><div class="title">${esc(a.title)}</div><div class="small">${ui.nl2br(a.body.slice(0, 200))}</div><div class="meta">${esc(a.author || 'Escola')} · ${fmtDateTime(a.created_at)}</div></li>`)
                .join('')}</ul>`
            : '<p class="empty">Nenhum aviso.</p>',
          { actions: `<a class="btn btn-secondary btn-sm" href="${attr(link(ctx, '/professor/comunicados'))}">Ver todos</a>` }
        )}
      </div>
      ${
        unscheduled.length
          ? `<div class="notice"><strong>Alunos sem horário definido:</strong> ${unscheduled.map((s) => esc(s.name)).join(', ')}. <a href="${attr(
              link(ctx, '/professor/agenda')
            )}">Montar horários</a></div>`
          : ''
      }
      ${card('Minha semana', weekGrid(ctx, grid))}`;
    render(ctx, 'Início', body);
  });

  // ---------- Agenda ----------
  router.get('/professor/agenda', roleOk, resolveTeacher, (ctx) => {
    const grid = lessons.weekGridForTeacher(ctx.teacher.id);
    const body = `<div class="page-head"><h1>Minha agenda</h1><span class="muted">Aulas de ${config.LESSON_MINUTES} min · manhã ${config.PERIODS[0].start}–${config.PERIODS[0].end} · tarde ${config.PERIODS[1].start}–${config.PERIODS[1].end}</span></div>
      ${card('', weekGrid(ctx, grid))}
      <p class="muted small">Clique em um horário para escolher os alunos daquela aula. Alunos com dificuldade podem ser marcados para aula individual no cadastro do aluno; nesse caso eles não podem dividir horário com outros.</p>`;
    render(ctx, 'Agenda', body);
  });

  router.get('/professor/agenda/:weekday/:slot', roleOk, resolveTeacher, (ctx) => {
    const weekday = Number(ctx.params.weekday);
    const slotIndex = Number(ctx.params.slot);
    const slot = schedule.getSlot(slotIndex);
    if (!config.WEEKDAYS.includes(weekday) || !slot) throw new HttpError(404, 'Horário inválido.');
    const lesson = lessons.lessonAt(ctx.teacher.id, weekday, slotIndex);
    const mine = students.listForTeacher(ctx.teacher.id);
    const selected = new Set(lesson ? lesson.students.map((s) => s.id) : []);
    // Alunos já ocupados neste dia/horário em outra aula.
    const busy = new Map(
      lessons.findConflicts(mine.map((s) => s.id), weekday, slotIndex, lesson ? lesson.id : null).map((c) => [c.student_id, c])
    );
    const max = db.maxGroupSize();
    const body = `<div class="page-head"><h1>${esc(schedule.weekdayName(weekday))}, ${esc(slot.label)}</h1><a class="btn btn-secondary" href="${attr(
      link(ctx, '/professor/agenda')
    )}">← Voltar à agenda</a></div>
    ${card(
      lesson ? 'Editar aula' : 'Montar aula neste horário',
      `<form method="post" action="${attr(`/professor/agenda/${weekday}/${slotIndex}`)}" class="form">${hiddenTeacher(ctx)}
        <label class="check"><input type="checkbox" name="individual" value="1" data-individual-toggle ${lesson && lesson.individual ? 'checked' : ''}>
          <span><strong>Aula individual</strong><br><span class="hint">Reserve este horário para um único aluno que precise de atendimento individual.</span></span></label>
        ${field('Sala (opcional)', input('sala', lesson ? lesson.room || '' : '', { placeholder: 'Ex.: Sala 2' }))}
        <div><div class="field-label">Alunos nesta aula <span class="muted">(máximo ${max} em grupo)</span></div>
        ${
          mine.length
            ? `<div class="checks">${mine
                .map((s) => {
                  const b = busy.get(s.id);
                  return `<label class="check"><input type="checkbox" name="alunos" value="${s.id}" data-student-check ${selected.has(s.id) ? 'checked' : ''} ${
                    b ? 'disabled' : ''
                  }><span>${esc(s.name)} <span class="muted small">${esc(s.instrument || '')}</span>${
                    s.individual_only ? ' ' + badge('Individual', 'warn') : ''
                  }${b ? ` <span class="muted small">(já tem aula neste horário)</span>` : ''}</span></label>`;
                })
                .join('')}</div>`
            : '<p class="empty">Você ainda não tem alunos vinculados. Peça à gestão para vincular os alunos ao seu cadastro.</p>'
        }</div>
        <div class="actions"><button class="btn" type="submit">Salvar aula</button>
        ${
          lesson
            ? `</form><form method="post" action="${attr(`/professor/agenda/${weekday}/${slotIndex}/excluir`)}" class="inline" data-confirm="Remover esta aula da grade? Os responsáveis serão avisados.">${hiddenTeacher(
                ctx
              )}<button class="btn btn-danger" type="submit">Remover aula</button>`
            : ''
        }</div>
      </form>
      <p class="hint" style="margin-top:1rem">Ao salvar, os responsáveis dos alunos incluídos ou retirados recebem uma notificação com o horário.</p>`
    )}`;
    render(ctx, 'Editar horário', body);
  });

  router.post('/professor/agenda/:weekday/:slot', roleOk, resolveTeacher, (ctx) => {
    const weekday = Number(ctx.params.weekday);
    const slotIndex = Number(ctx.params.slot);
    try {
      lessons.saveLesson({
        actor: ctx.user,
        teacherId: ctx.teacher.id,
        weekday,
        slotIndex,
        individual: ctx.body.individual === '1',
        room: String(ctx.body.sala || '').trim(),
        studentIds: asArray(ctx.body.alunos),
      });
      ctx.setFlash('success', 'Aula salva. Os responsáveis foram notificados sobre o horário.');
      ctx.redirect(link(ctx, '/professor/agenda'));
    } catch (err) {
      ctx.setFlash('error', err.message);
      ctx.redirect(link(ctx, `/professor/agenda/${weekday}/${slotIndex}`));
    }
  });

  router.post('/professor/agenda/:weekday/:slot/excluir', roleOk, resolveTeacher, (ctx) => {
    lessons.deleteLesson({ actor: ctx.user, teacherId: ctx.teacher.id, weekday: Number(ctx.params.weekday), slotIndex: Number(ctx.params.slot) });
    ctx.setFlash('success', 'Aula removida da grade.');
    ctx.redirect(link(ctx, '/professor/agenda'));
  });

  // ---------- Alunos ----------
  router.get('/professor/alunos', roleOk, resolveTeacher, (ctx) => {
    const list = students.listForTeacher(ctx.teacher.id, { includeInactive: ctx.query.inativos === '1' });
    const rows = list.map((s) => {
      const sum = students.attendanceSummary(s.id);
      return [
        `<a href="${attr(link(ctx, `/professor/alunos/${s.id}`))}"><strong>${esc(s.name)}</strong></a>${s.individual_only ? ' ' + badge('Individual', 'warn') : ''}`,
        esc(s.instrument || '—'),
        ui.age(s.birth_date) || '—',
        s.lesson_count ? `${s.lesson_count} aula(s)/semana` : badge('Sem horário', 'danger'),
        sum.frequencia === null ? '—' : `${sum.frequencia}%`,
        statusBadge(s.status),
      ];
    });
    const body = `<div class="page-head"><h1>Meus alunos</h1><a class="btn btn-secondary btn-sm" href="${attr(
      link(ctx, '/professor/alunos', ctx.query.inativos === '1' ? '' : 'inativos=1')
    )}">${ctx.query.inativos === '1' ? 'Ocultar inativos' : 'Mostrar inativos'}</a></div>
      ${card('', table(['Aluno', 'Instrumento', 'Idade', 'Horários', 'Frequência', 'Situação'], rows, { empty: 'Nenhum aluno vinculado a você.' }))}`;
    render(ctx, 'Meus alunos', body);
  });

  function loadStudent(ctx) {
    const s = students.byId(ctx.params.id);
    if (!s || s.teacher_id !== ctx.teacher.id) throw new HttpError(404, 'Aluno não encontrado entre os seus alunos.');
    ctx.student = s;
    return true;
  }

  router.get('/professor/alunos/:id', roleOk, resolveTeacher, loadStudent, (ctx) => {
    const s = ctx.student;
    const aba = ctx.query.aba || 'resumo';
    const base = link(ctx, `/professor/alunos/${s.id}`);
    const deleteBase = `/professor/alunos/${s.id}`;
    const guardians = students.guardiansOf(s.id);
    const today = attendance.isoDate();
    let content = '';
    if (aba === 'resumo') {
      const sum = students.attendanceSummary(s.id);
      const groupLessons = s.individual_only ? students.scheduleOf(s.id).filter((l) => !l.individual && l.student_count > 1) : [];
      if (groupLessons.length) {
        content += `<div class="notice">Este aluno está marcado para atendimento individual, mas ainda participa de aula(s) em grupo: ${groupLessons
          .map((l) => `${esc(schedule.weekdayName(l.weekday))} ${esc(schedule.slotLabel(l.slot_index))}`)
          .join('; ')}. <a href="${attr(link(ctx, '/professor/agenda'))}">Ajustar na agenda</a>.</div>`;
      }
      content += `<div class="grid grid-2">${card(
        'Dados do aluno',
        `<dl class="kv"><dt>Instrumento</dt><dd>${esc(s.instrument || '—')}</dd><dt>Nascimento</dt><dd>${fmtDate(s.birth_date) || '—'} ${
          ui.age(s.birth_date) ? `(${ui.age(s.birth_date)})` : ''
        }</dd><dt>Situação</dt><dd>${statusBadge(s.status)}</dd><dt>Frequência</dt><dd>${sum.frequencia === null ? '—' : sum.frequencia + '%'} (${sum.faltas} falta(s))</dd>
        <dt>Responsáveis</dt><dd>${guardians.map((g) => `${esc(g.name)}${g.relationship ? ` (${esc(g.relationship)})` : ''}${g.phone ? ` · ${esc(g.phone)}` : ''}`).join('<br>') || '—'}</dd>
        <dt>Anotações da escola</dt><dd>${ui.nl2br(s.notes || '—')}</dd></dl>
        <form method="post" action="${attr(`/professor/alunos/${s.id}/individual`)}" class="form" style="margin-top:1rem">${hiddenTeacher(ctx)}
          <label class="check"><input type="checkbox" name="individual_only" value="1" ${s.individual_only ? 'checked' : ''}><span><strong>Precisa de aula individual</strong><br><span class="hint">Quando marcado, este aluno não pode ser colocado em aulas em grupo.</span></span></label>
          <div><button class="btn btn-secondary btn-sm" type="submit">Salvar</button></div></form>`
      )}${card('Horário semanal', sv.scheduleBlock(s.id), {
        actions: `<a class="btn btn-secondary btn-sm" href="${attr(link(ctx, '/professor/agenda'))}">Alterar na agenda</a>`,
      })}</div>`;
    } else if (aba === 'presenca') {
      content = card('Presenças e faltas', sv.attendanceBlock(s.id), {
        actions: `<a class="btn btn-secondary btn-sm" href="${attr(link(ctx, '/professor/presenca'))}">Registrar presença</a>`,
      });
    } else if (aba === 'avaliacoes') {
      content = `${card(
        'Lançar avaliação',
        `<form method="post" action="${attr(`/professor/alunos/${s.id}/avaliacoes`)}" class="form">${hiddenTeacher(ctx)}
          <div class="form-row">${field('Título', input('titulo', '', { required: true, placeholder: 'Ex.: Avaliação bimestral, Escala de Dó maior' }))}
          ${field('Data', input('data', today, { type: 'date', required: true }))}
          ${field('Nota (0 a 10, opcional)', input('nota', '', { type: 'number', min: 0, max: 10, step: 0.5 }))}</div>
          ${field('Comentário', textarea('comentario', '', { rows: 3, placeholder: 'Pontos fortes, o que precisa melhorar...' }))}
          <div><button class="btn" type="submit">Lançar avaliação</button></div></form>`
      )}${card('Avaliações', sv.evaluationsBlock(s.id, { canDelete: true, deleteBase }))}`;
    } else if (aba === 'observacoes') {
      content = `${card(
        'Nova observação',
        `<form method="post" action="${attr(`/professor/alunos/${s.id}/observacoes`)}" class="form">${hiddenTeacher(ctx)}
          ${field('Observação sobre o desenvolvimento', textarea('texto', '', { rows: 4, required: true, placeholder: 'Ex.: Evoluiu bastante na leitura de partitura; precisa praticar mais o ritmo em casa.' }))}
          <label class="check"><input type="checkbox" name="visivel" value="1" checked><span>Visível para o responsável (envia notificação)</span></label>
          <div><button class="btn" type="submit">Registrar observação</button></div></form>`
      )}${card('Observações', sv.observationsBlock(s.id, { canDelete: true, deleteBase }))}`;
    } else if (aba === 'historico') {
      content = card('Histórico do aluno', sv.historyBlock(s.id));
    }
    const body = `<div class="page-head"><h1>${esc(s.name)} ${s.individual_only ? badge('Aula individual', 'warn') : ''}</h1><a class="btn btn-secondary btn-sm" href="${attr(
      link(ctx, '/professor/alunos')
    )}">← Meus alunos</a></div>
      ${sv.tabs(base, aba, [['resumo', 'Resumo'], ['presenca', 'Presença'], ['avaliacoes', 'Avaliações'], ['observacoes', 'Observações'], ['historico', 'Histórico']])}
      ${content}`;
    render(ctx, s.name, body);
  });

  router.post('/professor/alunos/:id/individual', roleOk, resolveTeacher, loadStudent, (ctx) => {
    const v = ctx.body.individual_only === '1' ? 1 : 0;
    db.get().prepare("UPDATE students SET individual_only = ?, updated_at = datetime('now') WHERE id = ?").run(v, ctx.student.id);
    audit.log(ctx.user.id, 'ALUNO_INDIVIDUAL', 'student', ctx.student.id, `${ctx.student.name}: ${v ? 'marcado para aula individual' : 'liberado para aula em grupo'}`);
    ctx.setFlash('success', 'Preferência de atendimento atualizada.');
    ctx.redirect(link(ctx, `/professor/alunos/${ctx.student.id}`));
  });

  router.post('/professor/alunos/:id/avaliacoes', roleOk, resolveTeacher, loadStudent, (ctx) => {
    try {
      attendance.addEvaluation({
        actor: ctx.user,
        teacherId: ctx.teacher.id,
        studentId: ctx.student.id,
        title: ctx.body.titulo,
        grade: ctx.body.nota,
        comment: ctx.body.comentario,
        date: ctx.body.data,
      });
      ctx.setFlash('success', 'Avaliação lançada e responsáveis notificados.');
    } catch (err) {
      ctx.setFlash('error', err.message);
    }
    ctx.redirect(link(ctx, `/professor/alunos/${ctx.student.id}`, 'aba=avaliacoes'));
  });

  router.post('/professor/alunos/:id/avaliacoes/:evalId/excluir', roleOk, resolveTeacher, loadStudent, (ctx) => {
    const e = db.get().prepare('SELECT * FROM evaluations WHERE id = ? AND student_id = ?').get(ctx.params.evalId, ctx.student.id);
    if (e) attendance.deleteEvaluation({ actor: ctx.user, id: e.id });
    ctx.setFlash('success', 'Avaliação excluída.');
    ctx.redirect(link(ctx, `/professor/alunos/${ctx.student.id}`, 'aba=avaliacoes'));
  });

  router.post('/professor/alunos/:id/observacoes', roleOk, resolveTeacher, loadStudent, (ctx) => {
    try {
      attendance.addObservation({
        actor: ctx.user,
        teacherId: ctx.teacher.id,
        studentId: ctx.student.id,
        text: ctx.body.texto,
        visibleToGuardian: ctx.body.visivel === '1',
      });
      ctx.setFlash('success', 'Observação registrada.');
    } catch (err) {
      ctx.setFlash('error', err.message);
    }
    ctx.redirect(link(ctx, `/professor/alunos/${ctx.student.id}`, 'aba=observacoes'));
  });

  router.post('/professor/alunos/:id/observacoes/:obsId/excluir', roleOk, resolveTeacher, loadStudent, (ctx) => {
    const o = db.get().prepare('SELECT * FROM observations WHERE id = ? AND student_id = ?').get(ctx.params.obsId, ctx.student.id);
    if (o) attendance.deleteObservation({ actor: ctx.user, id: o.id });
    ctx.setFlash('success', 'Observação excluída.');
    ctx.redirect(link(ctx, `/professor/alunos/${ctx.student.id}`, 'aba=observacoes'));
  });

  // ---------- Presença ----------
  router.get('/professor/presenca', roleOk, resolveTeacher, (ctx) => {
    const date = attendance.validDate(ctx.query.data) ? ctx.query.data : attendance.isoDate();
    const weekday = attendance.weekdayOf(date);
    const todays = lessons.lessonsForTeacherOnWeekday(ctx.teacher.id, weekday);
    const records = attendance.recordsFor(ctx.teacher.id, date);
    const forms = todays.length
      ? todays
          .map((l) => {
            if (!l.students.length) return card(`${esc(schedule.slotLabel(l.slot_index))}`, '<p class="empty">Esta aula não tem alunos.</p>');
            const rows = l.students
              .map((s) => {
                const r = records.get(`${s.id}:${l.slot_index}`);
                const cur = r ? r.status : 'PRESENTE';
                const seg = attendance.STATUSES.map(
                  (st) =>
                    `<label><input type="radio" name="status_${s.id}" value="${st}" ${cur === st ? 'checked' : ''}><span>${esc(attendance.STATUS_LABELS[st])}</span></label>`
                ).join('');
                return `<div class="att-row"><div><strong>${esc(s.name)}</strong> ${r ? badge('registrado', 'ok') : ''}<div style="margin-top:.3rem"><input type="text" name="obs_${s.id}" placeholder="Observação (opcional)" value="${attr(
                  r ? r.note || '' : ''
                )}"></div></div><div class="seg">${seg}</div></div>`;
              })
              .join('');
            return card(
              `${esc(schedule.slotLabel(l.slot_index))} · ${l.individual ? 'Individual' : 'Grupo'}`,
              `<form method="post" action="${attr(`/professor/presenca/${l.id}`)}">${hiddenTeacher(ctx)}<input type="hidden" name="data" value="${attr(date)}">${rows}
              <div class="actions"><button class="btn" type="submit">Salvar presença</button></div></form>`
            );
          })
          .join('')
      : `<p class="empty">Nenhuma aula na sua grade em ${esc(schedule.weekdayName(weekday))}.</p>`;
    const body = `<div class="page-head"><h1>Registro de presença</h1>
      <form method="get" action="/professor/presenca" class="filters">${hiddenTeacher(ctx)}${field('Data', input('data', date, { type: 'date' }))}<button class="btn btn-secondary" type="submit">Ver aulas</button></form></div>
      <p class="muted">${esc(schedule.weekdayName(weekday))}, ${fmtDate(date)}. Faltas e faltas justificadas geram notificação para os responsáveis.</p>${forms}`;
    render(ctx, 'Presença', body);
  });

  router.post('/professor/presenca/:lessonId', roleOk, resolveTeacher, (ctx) => {
    const lesson = lessons.lessonById(ctx.params.lessonId);
    if (!lesson || lesson.teacher_id !== ctx.teacher.id) throw new HttpError(404, 'Aula não encontrada.');
    const date = ctx.body.data;
    const entries = lesson.students.map((s) => ({ studentId: s.id, status: ctx.body[`status_${s.id}`], note: String(ctx.body[`obs_${s.id}`] || '').trim() }));
    try {
      attendance.saveAttendance({ actor: ctx.user, teacherId: ctx.teacher.id, lesson, date, entries });
      ctx.setFlash('success', `Presença de ${fmtDate(date)} salva.`);
    } catch (err) {
      ctx.setFlash('error', err.message);
    }
    ctx.redirect(link(ctx, '/professor/presenca', `data=${encodeURIComponent(date || '')}`));
  });

  // ---------- Comunicados ----------
  router.get('/professor/comunicados', roleOk, resolveTeacher, (ctx) => {
    const t = ctx.teacher;
    const mine = students.listForTeacher(t.id);
    const list = db
      .get()
      .prepare(
        `SELECT a.*, u.name AS author, s.name AS student_name FROM announcements a
         LEFT JOIN users u ON u.id = a.author_id LEFT JOIN students s ON s.id = a.student_id
         WHERE a.scope IN ('TODOS','PROFESSORES') OR a.teacher_id = ? ORDER BY a.id DESC LIMIT 100`
      )
      .all(t.id);
    const body = `<h1>Comunicados</h1><div class="grid grid-2">${card(
      'Enviar comunicado',
      `<form method="post" action="/professor/comunicados" class="form">${hiddenTeacher(ctx)}
        ${field('Destinatários', select('escopo', [{ value: 'MEUS_ALUNOS', label: 'Responsáveis de todos os meus alunos' }, ...mine.map((s) => ({ value: `ALUNO:${s.id}`, label: `Somente responsáveis de ${s.name}` }))], 'MEUS_ALUNOS'))}
        ${field('Título', input('titulo', '', { required: true }))}
        ${field('Mensagem', textarea('mensagem', '', { rows: 5, required: true }))}
        <div><button class="btn" type="submit">Enviar</button></div></form>`
    )}${card(
      'Enviados e recebidos',
      list.length
        ? `<ul class="list">${list
            .map(
              (a) => `<li><div class="title">${esc(a.title)} ${
                a.scope === 'TODOS' ? badge('Toda a escola', 'primary') : a.scope === 'PROFESSORES' ? badge('Para professores', 'neutral') : a.scope === 'ALUNO' ? badge(`Aluno: ${a.student_name || ''}`, 'warn') : badge('Meus alunos', 'ok')
              }</div><div class="small">${ui.nl2br(a.body)}</div><div class="meta">${esc(a.author || 'Escola')} · ${fmtDateTime(a.created_at)}</div></li>`
            )
            .join('')}</ul>`
        : '<p class="empty">Nenhum comunicado.</p>'
    )}</div>`;
    render(ctx, 'Comunicados', body);
  });

  router.post('/professor/comunicados', roleOk, resolveTeacher, (ctx) => {
    const t = ctx.teacher;
    const title = String(ctx.body.titulo || '').trim();
    const text = String(ctx.body.mensagem || '').trim();
    if (!title || !text) {
      ctx.setFlash('error', 'Informe título e mensagem.');
      return ctx.redirect(link(ctx, '/professor/comunicados'));
    }
    const escopo = String(ctx.body.escopo || 'MEUS_ALUNOS');
    let scope = 'MEUS_ALUNOS';
    let studentId = null;
    if (escopo.startsWith('ALUNO:')) {
      const s = students.byId(Number(escopo.slice(6)));
      if (!s || s.teacher_id !== t.id) throw new HttpError(400, 'Aluno inválido.');
      scope = 'ALUNO';
      studentId = s.id;
    }
    const r = db
      .get()
      .prepare('INSERT INTO announcements(author_id, title, body, scope, student_id, teacher_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(ctx.user.id, title, text, scope, studentId, t.id);
    const id = Number(r.lastInsertRowid);
    const n =
      scope === 'ALUNO'
        ? notify.notifyGuardiansOfStudent(studentId, 'COMUNICADO', `Comunicado: ${title}`, text.slice(0, 140), '/responsavel/comunicados')
        : notify.notifyGuardiansOfTeacher(t.id, 'COMUNICADO', `Comunicado: ${title}`, text.slice(0, 140), '/responsavel/comunicados');
    audit.log(ctx.user.id, 'COMUNICADO_ENVIADO', 'announcement', id, `${title} (${scope}${studentId ? ' #' + studentId : ''}) — ${n} responsável(is)`);
    ctx.setFlash('success', `Comunicado enviado para ${n} responsável(is).`);
    ctx.redirect(link(ctx, '/professor/comunicados'));
  });
};

module.exports.weekGrid = weekGrid;
