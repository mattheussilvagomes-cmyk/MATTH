'use strict';

const db = require('../db');
const audit = require('../audit');
const notify = require('../notify');
const students = require('./students');

const STATUS_LABELS = { PENDENTE: 'Pendente', CONFIRMADA: 'Confirmada', NAO_RENOVAR: 'Não vai renovar' };

function activePeriod(now = new Date()) {
  const iso = now.toISOString().slice(0, 10);
  return (
    db
      .get()
      .prepare(
        `SELECT * FROM reenrollment_periods WHERE active = 1 AND opens_at <= ? AND closes_at >= ?
         ORDER BY id DESC LIMIT 1`
      )
      .get(iso, iso) || null
  );
}

function listPeriods() {
  return db
    .get()
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM reenrollments r WHERE r.period_id = p.id) AS total,
        (SELECT COUNT(*) FROM reenrollments r WHERE r.period_id = p.id AND r.status = 'CONFIRMADA') AS confirmadas,
        (SELECT COUNT(*) FROM reenrollments r WHERE r.period_id = p.id AND r.status = 'NAO_RENOVAR') AS recusadas
       FROM reenrollment_periods p ORDER BY p.id DESC`
    )
    .all();
}

function periodById(id) {
  return db.get().prepare('SELECT * FROM reenrollment_periods WHERE id = ?').get(id) || null;
}

/**
 * Abre um período de rematrícula: cria um registro pendente para cada aluno ativo
 * e notifica todos os responsáveis.
 */
function openPeriod({ actor, name, year, opensAt, closesAt, terms }) {
  if (!name || !name.trim()) throw new Error('Informe o nome do período.');
  if (!opensAt || !closesAt || opensAt > closesAt) throw new Error('Datas de abertura e encerramento inválidas.');
  if (!terms || !terms.trim()) throw new Error('Informe os termos que o responsável deve aceitar.');
  const id = db.transaction((d) => {
    const r = d
      .prepare(
        'INSERT INTO reenrollment_periods(name, year, opens_at, closes_at, terms, active, created_by) VALUES (?, ?, ?, ?, ?, 1, ?)'
      )
      .run(name.trim(), Number(year) || new Date().getFullYear() + 1, opensAt, closesAt, terms.trim(), actor.id);
    const pid = Number(r.lastInsertRowid);
    const ins = d.prepare('INSERT OR IGNORE INTO reenrollments(period_id, student_id, instrument) VALUES (?, ?, ?)');
    for (const s of students.listAll({ status: 'ATIVO' })) ins.run(pid, s.id, s.instrument);
    return pid;
  });
  audit.log(actor.id, 'REMATRICULA_ABERTA', 'reenrollment_period', id, `${name} (${opensAt} a ${closesAt})`);
  for (const s of students.listAll({ status: 'ATIVO' })) {
    notify.notifyGuardiansOfStudent(
      s.id,
      'REMATRICULA',
      'Rematrícula aberta',
      `As rematrículas para ${name.trim()} estão abertas até ${closesAt.split('-').reverse().join('/')}. Confirme a permanência de ${s.name}.`,
      `/responsavel/rematricula/${s.id}`
    );
  }
  return id;
}

function closePeriod({ actor, id }) {
  db.get().prepare('UPDATE reenrollment_periods SET active = 0 WHERE id = ?').run(id);
  audit.log(actor.id, 'REMATRICULA_ENCERRADA', 'reenrollment_period', id);
}

function reopenPeriod({ actor, id }) {
  db.get().prepare('UPDATE reenrollment_periods SET active = 1 WHERE id = ?').run(id);
  audit.log(actor.id, 'REMATRICULA_REABERTA', 'reenrollment_period', id);
}

function forStudent(periodId, studentId) {
  return (
    db
      .get()
      .prepare('SELECT * FROM reenrollments WHERE period_id = ? AND student_id = ?')
      .get(periodId, studentId) || null
  );
}

function listForPeriod(periodId, { status } = {}) {
  return db
    .get()
    .prepare(
      `SELECT r.*, s.name AS student_name, s.instrument AS current_instrument, t.name AS teacher_name,
              g.name AS responded_by
       FROM reenrollments r JOIN students s ON s.id = r.student_id
       LEFT JOIN users t ON t.id = s.teacher_id LEFT JOIN users g ON g.id = r.guardian_id
       WHERE r.period_id = ? ${status ? 'AND r.status = ?' : ''}
       ORDER BY r.status, s.name`
    )
    .all(...(status ? [periodId, status] : [periodId]));
}

/**
 * Responsável finaliza a rematrícula de um aluno.
 */
function submit({ actor, period, studentId, form }) {
  if (!period || !period.active) throw new Error('O período de rematrícula não está aberto.');
  const today = new Date().toISOString().slice(0, 10);
  if (today < period.opens_at || today > period.closes_at) throw new Error('O período de rematrícula está fora do prazo.');
  const decision = form.decisao === 'NAO_RENOVAR' ? 'NAO_RENOVAR' : 'CONFIRMADA';
  if (decision === 'CONFIRMADA') {
    if (!form.instrumento || !String(form.instrumento).trim()) throw new Error('Confirme o instrumento/modalidade.');
    if (!form.aceite) throw new Error('É necessário aceitar os termos para finalizar a rematrícula.');
    if (!form.nome_responsavel || !form.telefone_responsavel) throw new Error('Informe o nome e o telefone do responsável.');
  }
  const keep = form.horario === 'MANTER' ? 1 : 0;
  const existing = forStudent(period.id, studentId);
  db.transaction((d) => {
    const sql = existing
      ? `UPDATE reenrollments SET guardian_id = ?, status = ?, instrument = ?, keep_schedule = ?, schedule_request = ?,
           guardian_name = ?, guardian_phone = ?, guardian_email = ?, student_birth_date = ?, student_notes = ?,
           terms_accepted = ?, completed_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`
      : `INSERT INTO reenrollments(guardian_id, status, instrument, keep_schedule, schedule_request, guardian_name,
           guardian_phone, guardian_email, student_birth_date, student_notes, terms_accepted, completed_at, period_id, student_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)`;
    const args = [
      actor.id,
      decision,
      form.instrumento ? String(form.instrumento).trim() : null,
      keep,
      keep ? null : form.pedido_horario ? String(form.pedido_horario).trim() : null,
      form.nome_responsavel ? String(form.nome_responsavel).trim() : null,
      form.telefone_responsavel ? String(form.telefone_responsavel).trim() : null,
      form.email_responsavel ? String(form.email_responsavel).trim() : null,
      form.nascimento || null,
      form.observacoes ? String(form.observacoes).trim() : null,
      form.aceite ? 1 : 0,
    ];
    if (existing) args.push(existing.id);
    else args.push(period.id, studentId);
    d.prepare(sql).run(...args);

    // Atualização cadastral: dados do responsável e do aluno são refletidos no cadastro.
    if (decision === 'CONFIRMADA') {
      d.prepare("UPDATE users SET name = ?, phone = ? WHERE id = ?").run(
        String(form.nome_responsavel).trim(),
        String(form.telefone_responsavel).trim(),
        actor.id
      );
      if (form.nascimento) d.prepare("UPDATE students SET birth_date = ?, updated_at = datetime('now') WHERE id = ?").run(form.nascimento, studentId);
    }
  });
  const student = students.byId(studentId);
  audit.log(
    actor.id,
    'REMATRICULA_RESPONDIDA',
    'reenrollment',
    studentId,
    `${student ? student.name : '#' + studentId}: ${STATUS_LABELS[decision]}${keep ? '' : ' — pede alteração de horário'}`
  );
  notify.notifyRole(
    'GESTAO',
    'REMATRICULA',
    `Rematrícula ${STATUS_LABELS[decision].toLowerCase()}`,
    `${student ? student.name : 'Aluno'} — respondido por ${actor.name}.` + (keep ? '' : ' Solicita alteração de horário.'),
    `/gestao/rematricula/${period.id}`
  );
  return decision;
}

function toCsv(rows) {
  const header = [
    'aluno',
    'professor',
    'status',
    'instrumento',
    'manter_horario',
    'pedido_horario',
    'responsavel',
    'telefone',
    'email',
    'nascimento',
    'observacoes',
    'termos_aceitos',
    'respondido_em',
  ];
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(';')];
  for (const r of rows) {
    lines.push(
      [
        r.student_name,
        r.teacher_name,
        STATUS_LABELS[r.status],
        r.instrument,
        r.keep_schedule === null ? '' : r.keep_schedule ? 'sim' : 'não',
        r.schedule_request,
        r.guardian_name,
        r.guardian_phone,
        r.guardian_email,
        r.student_birth_date,
        r.student_notes,
        r.terms_accepted ? 'sim' : 'não',
        r.completed_at,
      ]
        .map(esc)
        .join(';')
    );
  }
  return '﻿' + lines.join('\r\n');
}

module.exports = {
  STATUS_LABELS,
  activePeriod,
  listPeriods,
  periodById,
  openPeriod,
  closePeriod,
  reopenPeriod,
  forStudent,
  listForPeriod,
  submit,
  toCsv,
};
