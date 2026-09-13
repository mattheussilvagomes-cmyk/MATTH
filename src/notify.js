'use strict';

const db = require('./db');

function notifyUser(userId, type, title, body, link) {
  db.get()
    .prepare('INSERT INTO notifications(user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?)')
    .run(userId, type, title, body || null, link || null);
}

/** Notifica todos os responsáveis vinculados a um aluno. */
function notifyGuardiansOfStudent(studentId, type, title, body, link) {
  const guardians = db
    .get()
    .prepare(
      `SELECT g.guardian_id FROM student_guardians g JOIN users u ON u.id = g.guardian_id
       WHERE g.student_id = ? AND u.active = 1`
    )
    .all(studentId);
  for (const g of guardians) notifyUser(g.guardian_id, type, title, body, link);
  return guardians.length;
}

/** Notifica os responsáveis de todos os alunos ativos de um professor. */
function notifyGuardiansOfTeacher(teacherId, type, title, body, link) {
  const guardians = db
    .get()
    .prepare(
      `SELECT DISTINCT g.guardian_id FROM student_guardians g
       JOIN students s ON s.id = g.student_id
       JOIN users u ON u.id = g.guardian_id
       WHERE s.teacher_id = ? AND s.status = 'ATIVO' AND u.active = 1`
    )
    .all(teacherId);
  for (const g of guardians) notifyUser(g.guardian_id, type, title, body, link);
  return guardians.length;
}

function notifyRole(role, type, title, body, link) {
  const users = db.get().prepare('SELECT id FROM users WHERE role = ? AND active = 1').all(role);
  for (const u of users) notifyUser(u.id, type, title, body, link);
  return users.length;
}

function unreadCount(userId) {
  const row = db.get().prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0').get(userId);
  return row ? row.n : 0;
}

function listForUser(userId, limit = 50) {
  return db
    .get()
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?')
    .all(userId, limit);
}

function markAllRead(userId) {
  db.get().prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0').run(userId);
}

function markRead(userId, id) {
  db.get().prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND id = ?').run(userId, id);
}

module.exports = {
  notifyUser,
  notifyGuardiansOfStudent,
  notifyGuardiansOfTeacher,
  notifyRole,
  unreadCount,
  listForUser,
  markAllRead,
  markRead,
};
