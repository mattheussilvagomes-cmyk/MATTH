'use strict';

const db = require('../db');
const config = require('../config');
const students = require('../services/students');
const reenrollment = require('../services/reenrollment');
const { HttpError } = require('../http');
const { requireRole } = require('./common');
const ui = require('../views/ui');
const sv = require('../views/student');
const { esc, attr, card, field, input, textarea, fmtDate, fmtDateTime, badge, statusBadge } = ui;

const roleOk = requireRole('RESPONSAVEL');

function loadDependent(ctx) {
  const s = students.byId(ctx.params.id);
  if (!s || !students.isGuardianOf(ctx.user.id, s.id)) throw new HttpError(404, 'Aluno não encontrado entre os seus dependentes.');
  ctx.student = s;
  return true;
}

module.exports = function register(router) {
  router.get('/responsavel', roleOk, (ctx) => {
    const deps = students.listForGuardian(ctx.user.id);
    const period = reenrollment.activePeriod();
    const cards = deps
      .map((s) => {
        const sum = students.attendanceSummary(s.id);
        const sched = students.scheduleOf(s.id);
        const re = period ? reenrollment.forStudent(period.id, s.id) : null;
        return card(
          esc(s.name),
          `<div class="student-card">
            <div class="muted">${esc(s.instrument || 'Instrumento não definido')} · Professor(a): ${esc(s.teacher_name || '—')}</div>
            <div class="kv" style="margin-top:.5rem"><dt>Frequência</dt><dd>${sum.frequencia === null ? '—' : sum.frequencia + '%'} <span class="muted small">(${sum.faltas} falta(s))</span></dd>
            <dt>Horários</dt><dd>${sched.length ? sched.map((l) => `${esc(require('../services/schedule').weekdayShort(l.weekday))} ${esc(require('../services/schedule').slotLabel(l.slot_index))}`).join('<br>') : '<span class="muted">a definir</span>'}</dd>
            <dt>Situação</dt><dd>${statusBadge(s.status)}</dd></div>
            ${
              period && s.status === 'ATIVO'
                ? `<div style="margin-top:.5rem">${
                    re && re.status !== 'PENDENTE'
                      ? `${badge('Rematrícula ' + reenrollment.STATUS_LABELS[re.status].toLowerCase(), re.status === 'CONFIRMADA' ? 'ok' : 'danger')}`
                      : `<a class="btn btn-sm" href="/responsavel/rematricula/${s.id}">Fazer rematrícula</a>`
                  }</div>`
                : ''
            }
          </div>`,
          { actions: `<a class="btn btn-secondary btn-sm" href="/responsavel/alunos/${s.id}">Acompanhar</a>` }
        );
      })
      .join('');
    const body = `<div class="page-head"><h1>Meus dependentes</h1></div>
      ${
        period
          ? `<div class="notice"><strong>Rematrícula aberta:</strong> ${esc(period.name)} — até ${fmtDate(period.closes_at)}. <a href="/responsavel/rematricula">Ver detalhes</a></div>`
          : ''
      }
      ${deps.length ? `<div class="grid grid-2">${cards}</div>` : '<p class="empty">Nenhum aluno vinculado ao seu cadastro. Procure a secretaria da escola.</p>'}`;
    ctx.render('Meus dependentes', body);
  });

  router.get('/responsavel/alunos/:id', roleOk, loadDependent, (ctx) => {
    const s = ctx.student;
    const aba = ctx.query.aba || 'horario';
    const base = `/responsavel/alunos/${s.id}`;
    let content = '';
    switch (aba) {
      case 'horario':
        content = `<div class="grid grid-2">${card('Horário das aulas', sv.scheduleBlock(s.id))}${card(
          'Dados',
          `<dl class="kv"><dt>Instrumento</dt><dd>${esc(s.instrument || '—')}</dd><dt>Professor(a)</dt><dd>${esc(s.teacher_name || '—')}</dd><dt>Nascimento</dt><dd>${
            fmtDate(s.birth_date) || '—'
          }</dd><dt>Situação</dt><dd>${statusBadge(s.status)}</dd></dl>`
        )}</div>`;
        break;
      case 'presenca':
        content = card('Presenças e faltas', sv.attendanceBlock(s.id));
        break;
      case 'avaliacoes':
        content = card('Notas e avaliações', sv.evaluationsBlock(s.id));
        break;
      case 'observacoes':
        content = card('Observações dos professores', sv.observationsBlock(s.id, { guardianView: true }));
        break;
      case 'historico':
        content = card('Histórico', sv.historyBlock(s.id, { guardianView: true }));
        break;
      default:
        content = '';
    }
    const body = `<div class="page-head"><h1>${esc(s.name)}</h1><a class="btn btn-secondary btn-sm" href="/responsavel">← Meus dependentes</a></div>
      ${sv.tabs(base, aba, [['horario', 'Horário'], ['presenca', 'Presença'], ['avaliacoes', 'Avaliações'], ['observacoes', 'Observações'], ['historico', 'Histórico']])}${content}`;
    ctx.render(s.name, body);
  });

  router.get('/responsavel/comunicados', roleOk, (ctx) => {
    const list = db
      .get()
      .prepare(
        `SELECT DISTINCT a.*, u.name AS author, s.name AS student_name FROM announcements a
         LEFT JOIN users u ON u.id = a.author_id LEFT JOIN students s ON s.id = a.student_id
         WHERE a.scope = 'TODOS'
            OR (a.scope = 'ALUNO' AND a.student_id IN (SELECT student_id FROM student_guardians WHERE guardian_id = ?))
            OR (a.scope = 'MEUS_ALUNOS' AND a.teacher_id IN (
                 SELECT st.teacher_id FROM students st JOIN student_guardians g ON g.student_id = st.id WHERE g.guardian_id = ? AND st.status = 'ATIVO'))
         ORDER BY a.id DESC LIMIT 100`
      )
      .all(ctx.user.id, ctx.user.id);
    const body = `<h1>Comunicados</h1>${card(
      '',
      list.length
        ? `<ul class="list">${list
            .map(
              (a) => `<li><div class="title">${esc(a.title)} ${
                a.scope === 'TODOS' ? badge('Escola', 'primary') : a.scope === 'ALUNO' ? badge(a.student_name || 'Aluno', 'warn') : badge('Turma', 'ok')
              }</div><div>${ui.nl2br(a.body)}</div><div class="meta">${esc(a.author || 'Escola')} · ${fmtDateTime(a.created_at)}</div></li>`
            )
            .join('')}</ul>`
        : '<p class="empty">Nenhum comunicado até o momento.</p>'
    )}`;
    ctx.render('Comunicados', body);
  });

  router.get('/responsavel/eventos', roleOk, (ctx) => {
    const now = new Date().toISOString().slice(0, 16);
    const events = db.get().prepare('SELECT * FROM events ORDER BY starts_at DESC LIMIT 100').all();
    const upcoming = events.filter((e) => e.starts_at >= now).reverse();
    const past = events.filter((e) => e.starts_at < now);
    const item = (e) => `<li><div class="title">${esc(e.title)}</div><div class="meta">${fmtDateTime(e.starts_at)}${e.location ? ` · ${esc(e.location)}` : ''}</div>${
      e.description ? `<div>${ui.nl2br(e.description)}</div>` : ''
    }</li>`;
    const body = `<h1>Atividades e eventos</h1><div class="grid grid-2">${card(
      'Próximos',
      upcoming.length ? `<ul class="list">${upcoming.map(item).join('')}</ul>` : '<p class="empty">Nenhum evento agendado.</p>'
    )}${card('Já realizados', past.length ? `<ul class="list">${past.map(item).join('')}</ul>` : '<p class="empty">Nenhum evento anterior.</p>')}</div>`;
    ctx.render('Eventos', body);
  });

  // ---------- Rematrícula ----------
  router.get('/responsavel/rematricula', roleOk, (ctx) => {
    const period = reenrollment.activePeriod();
    const deps = students.listForGuardian(ctx.user.id).filter((s) => s.status === 'ATIVO');
    let body = '<h1>Rematrícula</h1>';
    if (!period) {
      body += card('', '<p class="empty">Não há período de rematrícula aberto no momento. Você receberá uma notificação quando abrir.</p>');
    } else {
      const rows = deps.map((s) => {
        const re = reenrollment.forStudent(period.id, s.id);
        const st = re ? re.status : 'PENDENTE';
        return [
          `<strong>${esc(s.name)}</strong><div class="small muted">${esc(s.instrument || '')}</div>`,
          statusBadge(st),
          re && re.completed_at ? fmtDateTime(re.completed_at) : '—',
          `<a class="btn btn-sm ${st === 'PENDENTE' ? '' : 'btn-secondary'}" href="/responsavel/rematricula/${s.id}">${st === 'PENDENTE' ? 'Fazer rematrícula' : 'Rever resposta'}</a>`,
        ];
      });
      body += `<div class="notice"><strong>${esc(period.name)}</strong> — período aberto de ${fmtDate(period.opens_at)} a ${fmtDate(period.closes_at)}.</div>
        ${card('Seus dependentes', ui.table(['Aluno', 'Situação', 'Respondido em', ''], rows, { empty: 'Nenhum aluno ativo para rematricular.' }))}`;
    }
    ctx.render('Rematrícula', body);
  });

  router.get('/responsavel/rematricula/:id', roleOk, loadDependent, (ctx) => {
    const s = ctx.student;
    const period = reenrollment.activePeriod();
    if (!period) {
      ctx.setFlash('info', 'Não há período de rematrícula aberto.');
      return ctx.redirect('/responsavel/rematricula');
    }
    const re = reenrollment.forStudent(period.id, s.id) || {};
    const sched = students.scheduleOf(s.id);
    const schedule = require('../services/schedule');
    const g = ctx.user;
    const body = `<div class="page-head"><h1>Rematrícula · ${esc(s.name)}</h1><a class="btn btn-secondary btn-sm" href="/responsavel/rematricula">← Voltar</a></div>
      ${re.status && re.status !== 'PENDENTE' ? `<div class="flash flash-info">Você já respondeu (${esc(reenrollment.STATUS_LABELS[re.status])} em ${fmtDateTime(re.completed_at)}). Pode alterar a resposta enquanto o período estiver aberto.</div>` : ''}
      ${card(
        esc(period.name),
        `<form method="post" action="/responsavel/rematricula/${s.id}" class="form">
          <div><div class="field-label">1. O aluno vai continuar na escola?</div>
            <label class="check"><input type="radio" name="decisao" value="CONFIRMADA" data-toggle-decision ${re.status !== 'NAO_RENOVAR' ? 'checked' : ''}><span><strong>Sim, confirmo a permanência de ${esc(s.name)}</strong></span></label>
            <label class="check"><input type="radio" name="decisao" value="NAO_RENOVAR" data-toggle-decision ${re.status === 'NAO_RENOVAR' ? 'checked' : ''}><span>Não, o aluno não vai continuar</span></label></div>
          <div data-confirm-fields>
            <h3>2. Dados cadastrais</h3>
            <div class="form-row">
              ${field('Nome do responsável', input('nome_responsavel', re.guardian_name || g.name, { required: true }))}
              ${field('Telefone / WhatsApp', input('telefone_responsavel', re.guardian_phone || g.phone || '', { type: 'tel', required: true }))}
              ${field('E-mail', input('email_responsavel', re.guardian_email || g.email, { type: 'email' }))}
              ${field('Data de nascimento do aluno', input('nascimento', re.student_birth_date || s.birth_date || '', { type: 'date' }))}
            </div>
            <h3>3. Instrumento / modalidade</h3>
            ${field('Confirme ou altere', input('instrumento', re.instrument || s.instrument || '', { required: true, list: 'instrumentos' }))}${ui.instrumentDatalist()}
            <h3>4. Horário</h3>
            <p class="small muted">Horário atual: ${sched.length ? sched.map((l) => `${esc(schedule.weekdayName(l.weekday))} ${esc(schedule.slotLabel(l.slot_index))}`).join('; ') : 'a definir'}</p>
            <label class="check"><input type="radio" name="horario" value="MANTER" data-toggle-target="#pedido-horario" data-toggle-value="ALTERAR" ${re.keep_schedule === 0 ? '' : 'checked'}><span>Manter o horário atual</span></label>
            <label class="check"><input type="radio" name="horario" value="ALTERAR" data-toggle-target="#pedido-horario" data-toggle-value="ALTERAR" ${re.keep_schedule === 0 ? 'checked' : ''}><span>Solicitar alteração de horário</span></label>
            <div id="pedido-horario" hidden>${field('Qual horário seria melhor?', textarea('pedido_horario', re.schedule_request || '', { rows: 2, placeholder: 'Ex.: Terças à tarde, a partir das 14h' }))}</div>
            <h3>5. Observações</h3>
            ${field('Algo que a escola precise saber? (opcional)', textarea('observacoes', re.student_notes || '', { rows: 3 }))}
            <h3>6. Termos</h3>
            <div class="terms">${esc(period.terms)}</div>
            <label class="check"><input type="checkbox" name="aceite" value="1" ${re.terms_accepted ? 'checked' : ''}><span><strong>Li e aceito os termos acima.</strong></span></label>
          </div>
          <div class="actions"><button class="btn btn-ok" type="submit">Finalizar rematrícula</button></div>
        </form>`
      )}`;
    ctx.render('Rematrícula', body);
  });

  router.post('/responsavel/rematricula/:id', roleOk, loadDependent, (ctx) => {
    const period = reenrollment.activePeriod();
    try {
      const decision = reenrollment.submit({ actor: ctx.user, period, studentId: ctx.student.id, form: ctx.body });
      ctx.setFlash('success', decision === 'CONFIRMADA' ? `Rematrícula de ${ctx.student.name} finalizada com sucesso!` : 'Resposta registrada. Obrigado por avisar a escola.');
      ctx.redirect('/responsavel/rematricula');
    } catch (err) {
      ctx.setFlash('error', err.message);
      ctx.redirect(`/responsavel/rematricula/${ctx.student.id}`);
    }
  });
};
