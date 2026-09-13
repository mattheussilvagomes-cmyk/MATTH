'use strict';

const db = require('./db');

/**
 * Registra uma ação no histórico de alterações, para que a gestão acompanhe
 * tudo o que professores (e a própria gestão) fazem na plataforma.
 */
function log(userId, action, entity, entityId, details) {
  db.get()
    .prepare('INSERT INTO audit_log(user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)')
    .run(userId || null, action, entity, entityId || null, details ? String(details) : null);
}

function recent(limit = 50, filters = {}) {
  const where = [];
  const args = [];
  if (filters.userId) {
    where.push('a.user_id = ?');
    args.push(filters.userId);
  }
  if (filters.entity) {
    where.push('a.entity = ?');
    args.push(filters.entity);
  }
  // Acessos (login) só aparecem quando pedidos explicitamente.
  if (!filters.includeLogins && filters.entity !== 'login') where.push("a.action <> 'LOGIN'");
  if (filters.entity === 'login') {
    where.pop();
    where.push("a.action = 'LOGIN'");
    args.pop();
  }
  const sql = `SELECT a.*, u.name AS user_name, u.role AS user_role
    FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY a.id DESC LIMIT ?`;
  return db.get().prepare(sql).all(...args, limit);
}

module.exports = { log, recent };
