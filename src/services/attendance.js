'use strict';

const db = require('../db');
const audit = require('../audit');
const notify = require('../notify');
const schedule = require('./schedule');

const STATUSES = ['PRESENTE', 'FALTA', 'JUSTIFICADA'];
const STATUS_LABELS = { PRESENTE: 'Presente', FALTA: 'Falta', JUSTIFICADA: 'Falta justificada' };

function isoDate(d = new Date()) {
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return tz.toISOString().slice(0, 10);
}

/** Dia da semana (1-7, domingo = 0) de uma data "YYYY-MM-DD" sem depender de fuso horário. */
function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function validDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

/** Registros existentes de um professor numa data: mapa "student:slot" -> registro. */
function recordsFor(teacherId, date) {
  const rows = db
    .get()
    .prepare('SELECT * FROM attendance WHERE teacher_id = ? AND date = ?')
    .all(teacherId, date);
  const map = new Map();
  for (const r of rows) map.set(`${r.student_id}:${r.slot_index}`, r);
  return map;
}

/**
 * Salva a presença de vários alunos de uma aula. `entries` = [{studentId, status, note}].
 */
function saveAttendance({ actor, teacherId, lesson, date, entries }) {
  if (!validDate(date)) throw new Error('Data inválida.');
  if (weekdayOf(date) !== lesson.weekday) {
    throw new Error('A data informada não corresponde ao dia da semana desta aula.');
  }
  const allowed = new Set(lesson.students.map((s) => s.id));
  const results = [];
  db.transaction((d) => {
    const upsert = d.prepare(
      `INSERT INTO attendance(student_id, lesson_id, teacher_id, date, slot_index, status, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(student_id, date, slot_index) DO UPDATE SET
         status = excluded.status, note = excluded.note, lesson_id = excluded.lesson_id,
         teacher_id = excluded.teacher_id, updated_at = datetime('now')`
    );
    const prev = d.prepare('SELECT status FROM attendance WHERE student_id = ? AND date = ? AND slot_index = ?');
    for (const e of entries) {
      const sid = Number(e.studentId);
      if (!allowed.has(sid)) continue;
      if (!STATUSES.includes(e.status)) continue;
      const before = prev.get(sid, date, lesson.slot_index);
      upsert.run(sid, lesson.id, teacherId, date, lesson.slot_index, e.status, e.note || null);
      results.push({ studentId: sid, status: e.status, previous: before ? before.status : null });
    }
  });

  const label = `${date.split('-').reverse().join('/')} ${schedule.slotLabel(lesson.slot_index)}`;
  const names = new Map(lesson.students.map((s) => [s.id, s.name]));
  audit.log(
    actor.id,
    'PRESENCA_REGISTRADA',
    'attendance',
    lesson.id,
    `${label}: ` + results.map((r) => `${names.get(r.studentId)} = ${STATUS_LABELS[r.status]}`).join('; ')
  );
  for (const r of results) {
    if ((r.status === 'FALTA' || r.status === 'JUSTIFICADA') && r.previous !== r.status) {
      notify.notifyGuardiansOfStudent(
        r.studentId,
        'FALTA',
        `${STATUS_LABELS[r.status]} registrada`,
        `${names.get(r.studentId)} — aula de ${label}.`,
        `/responsavel/alunos/${r.studentId}?aba=presenca`
      );
    }
  }
  return results;
}

function addEvaluation({ actor, teacherId, studentId, title, grade, comment, date }) {
  if (!title || !title.trim()) throw new Error('Informe o título da avaliação.');
  if (!validDate(date)) throw new Error('Data inválida.');
  let g = null;
  if (grade !== undefined && grade !== null && String(grade).trim() !== '') {
    g = Number(String(grade).replace(',', '.'));
    if (Number.isNaN(g) || g < 0 || g > 10) throw new Error('A nota deve estar entre 0 e 10.');
  }
  const r = db
    .get()
    .prepare('INSERT INTO evaluations(student_id, teacher_id, title, grade, comment, date) VALUES (?, ?, ?, ?, ?, ?)')
    .run(studentId, teacherId, title.trim(), g, comment ? comment.trim() : null, date);
  const id = Number(r.lastInsertRowid);
  audit.log(actor.id, 'AVALIACAO_LANCADA', 'evaluation', id, `Aluno #${studentId}: ${title.trim()}${g !== null ? ` (nota ${g})` : ''}`);
  notify.notifyGuardiansOfStudent(
    studentId,
    'AVALIACAO',
    'Nova avaliação lançada',
    `${title.trim()}${g !== null ? ` — nota ${g}` : ''}`,
    `/responsavel/alunos/${studentId}?aba=avaliacoes`
  );
  return id;
}

function deleteEvaluation({ actor, id }) {
  const e = db.get().prepare('SELECT * FROM evaluations WHERE id = ?').get(id);
  if (!e) return false;
  db.get().prepare('DELETE FROM evaluations WHERE id = ?').run(id);
  audit.log(actor.id, 'AVALIACAO_REMOVIDA', 'evaluation', id, `Aluno #${e.student_id}: ${e.title}`);
  return true;
}

function addObservation({ actor, teacherId, studentId, text, visibleToGuardian = true }) {
  if (!text || !text.trim()) throw new Error('Escreva a observação.');
  const r = db
    .get()
    .prepare('INSERT INTO observations(student_id, teacher_id, text, visible_to_guardian) VALUES (?, ?, ?, ?)')
    .run(studentId, teacherId, text.trim(), visibleToGuardian ? 1 : 0);
  const id = Number(r.lastInsertRowid);
  audit.log(actor.id, 'OBSERVACAO_REGISTRADA', 'observation', id, `Aluno #${studentId}: ${text.trim().slice(0, 80)}`);
  if (visibleToGuardian) {
    notify.notifyGuardiansOfStudent(
      studentId,
      'OBSERVACAO',
      'Nova observação do professor',
      text.trim().slice(0, 120),
      `/responsavel/alunos/${studentId}?aba=observacoes`
    );
  }
  return id;
}

function deleteObservation({ actor, id }) {
  const o = db.get().prepare('SELECT * FROM observations WHERE id = ?').get(id);
  if (!o) return false;
  db.get().prepare('DELETE FROM observations WHERE id = ?').run(id);
  audit.log(actor.id, 'OBSERVACAO_REMOVIDA', 'observation', id, `Aluno #${o.student_id}`);
  return true;
}

/** Relatório de presenças para a gestão. */
function report({ from, to, teacherId, status } = {}) {
  const where = [];
  const args = [];
  if (from) {
    where.push('a.date >= ?');
    args.push(from);
  }
  if (to) {
    where.push('a.date <= ?');
    args.push(to);
  }
  if (teacherId) {
    where.push('a.teacher_id = ?');
    args.push(teacherId);
  }
  if (status) {
    where.push('a.status = ?');
    args.push(status);
  }
  return db
    .get()
    .prepare(
      `SELECT a.*, s.name AS student_name, t.name AS teacher_name FROM attendance a
       JOIN students s ON s.id = a.student_id LEFT JOIN users t ON t.id = a.teacher_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY a.date DESC, a.slot_index, s.name LIMIT 500`
    )
    .all(...args);
}

module.exports = {
  STATUSES,
  STATUS_LABELS,
  isoDate,
  weekdayOf,
  validDate,
  recordsFor,
  saveAttendance,
  addEvaluation,
  deleteEvaluation,
  addObservation,
  deleteObservation,
  report,
};
