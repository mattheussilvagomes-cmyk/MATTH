'use strict';

const db = require('../db');

function listForTeacher(teacherId, { includeInactive = false } = {}) {
  return db
    .get()
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM lesson_students ls JOIN lessons l ON l.id = ls.lesson_id
                   WHERE ls.student_id = s.id) AS lesson_count
       FROM students s WHERE s.teacher_id = ? ${includeInactive ? '' : "AND s.status = 'ATIVO'"}
       ORDER BY s.name`
    )
    .all(teacherId);
}

function listAll({ status, teacherId, search } = {}) {
  const where = [];
  const args = [];
  if (status) {
    where.push('s.status = ?');
    args.push(status);
  }
  if (teacherId) {
    where.push('s.teacher_id = ?');
    args.push(teacherId);
  }
  if (search) {
    where.push('s.name LIKE ?');
    args.push(`%${search}%`);
  }
  return db
    .get()
    .prepare(
      `SELECT s.*, t.name AS teacher_name,
        (SELECT GROUP_CONCAT(u.name, ', ') FROM student_guardians g JOIN users u ON u.id = g.guardian_id WHERE g.student_id = s.id) AS guardian_names
       FROM students s LEFT JOIN users t ON t.id = s.teacher_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY s.name`
    )
    .all(...args);
}

function listForGuardian(guardianId) {
  return db
    .get()
    .prepare(
      `SELECT s.*, t.name AS teacher_name, t.email AS teacher_email, g.relationship
       FROM student_guardians g JOIN students s ON s.id = g.student_id
       LEFT JOIN users t ON t.id = s.teacher_id
       WHERE g.guardian_id = ? ORDER BY s.name`
    )
    .all(guardianId);
}

function byId(id) {
  return db
    .get()
    .prepare(
      `SELECT s.*, t.name AS teacher_name, t.email AS teacher_email
       FROM students s LEFT JOIN users t ON t.id = s.teacher_id WHERE s.id = ?`
    )
    .get(id);
}

function guardiansOf(studentId) {
  return db
    .get()
    .prepare(
      `SELECT u.id, u.name, u.email, u.phone, u.active, g.relationship
       FROM student_guardians g JOIN users u ON u.id = g.guardian_id WHERE g.student_id = ? ORDER BY u.name`
    )
    .all(studentId);
}

function isGuardianOf(guardianId, studentId) {
  return !!db
    .get()
    .prepare('SELECT 1 FROM student_guardians WHERE guardian_id = ? AND student_id = ?')
    .get(guardianId, studentId);
}

/** Aulas semanais de um aluno (com professor e horário). */
function scheduleOf(studentId) {
  return db
    .get()
    .prepare(
      `SELECT l.*, t.name AS teacher_name,
         (SELECT COUNT(*) FROM lesson_students x WHERE x.lesson_id = l.id) AS student_count
       FROM lesson_students ls JOIN lessons l ON l.id = ls.lesson_id
       LEFT JOIN users t ON t.id = l.teacher_id
       WHERE ls.student_id = ? ORDER BY l.weekday, l.slot_index`
    )
    .all(studentId);
}

function attendanceOf(studentId, limit = 200) {
  return db
    .get()
    .prepare(
      `SELECT a.*, t.name AS teacher_name FROM attendance a LEFT JOIN users t ON t.id = a.teacher_id
       WHERE a.student_id = ? ORDER BY a.date DESC, a.slot_index DESC LIMIT ?`
    )
    .all(studentId, limit);
}

function attendanceSummary(studentId) {
  const row = db
    .get()
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'PRESENTE' THEN 1 ELSE 0 END) AS presentes,
         SUM(CASE WHEN status = 'FALTA' THEN 1 ELSE 0 END) AS faltas,
         SUM(CASE WHEN status = 'JUSTIFICADA' THEN 1 ELSE 0 END) AS justificadas,
         COUNT(*) AS total
       FROM attendance WHERE student_id = ?`
    )
    .get(studentId);
  const total = row.total || 0;
  return {
    presentes: row.presentes || 0,
    faltas: row.faltas || 0,
    justificadas: row.justificadas || 0,
    total,
    frequencia: total ? Math.round(((row.presentes || 0) / total) * 100) : null,
  };
}

function evaluationsOf(studentId) {
  return db
    .get()
    .prepare(
      `SELECT e.*, t.name AS teacher_name FROM evaluations e LEFT JOIN users t ON t.id = e.teacher_id
       WHERE e.student_id = ? ORDER BY e.date DESC, e.id DESC`
    )
    .all(studentId);
}

function observationsOf(studentId, { guardianView = false } = {}) {
  return db
    .get()
    .prepare(
      `SELECT o.*, t.name AS teacher_name FROM observations o LEFT JOIN users t ON t.id = o.teacher_id
       WHERE o.student_id = ? ${guardianView ? 'AND o.visible_to_guardian = 1' : ''} ORDER BY o.id DESC`
    )
    .all(studentId);
}

/** Linha do tempo unificada (histórico do aluno). */
function historyOf(studentId, { guardianView = false } = {}) {
  const items = [];
  for (const a of attendanceOf(studentId, 500)) {
    items.push({ kind: 'presenca', date: a.date, at: a.created_at, data: a });
  }
  for (const e of evaluationsOf(studentId)) items.push({ kind: 'avaliacao', date: e.date, at: e.created_at, data: e });
  for (const o of observationsOf(studentId, { guardianView })) {
    items.push({ kind: 'observacao', date: o.created_at.slice(0, 10), at: o.created_at, data: o });
  }
  const re = db
    .get()
    .prepare(
      `SELECT r.*, p.name AS period_name FROM reenrollments r JOIN reenrollment_periods p ON p.id = r.period_id
       WHERE r.student_id = ? AND r.status <> 'PENDENTE'`
    )
    .all(studentId);
  for (const r of re) items.push({ kind: 'rematricula', date: (r.completed_at || r.updated_at).slice(0, 10), at: r.updated_at, data: r });
  items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.at < b.at ? 1 : -1));
  return items;
}

module.exports = {
  listForTeacher,
  listAll,
  listForGuardian,
  byId,
  guardiansOf,
  isGuardianOf,
  scheduleOf,
  attendanceOf,
  attendanceSummary,
  evaluationsOf,
  observationsOf,
  historyOf,
};
