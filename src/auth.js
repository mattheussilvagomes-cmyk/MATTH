'use strict';

const crypto = require('node:crypto');
const db = require('./db');
const config = require('./config');

const SCRYPT_KEYLEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [algo, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const candidate = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

function sign(value) {
  return crypto.createHmac('sha256', config.SESSION_SECRET).update(value).digest('base64url');
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.SESSION_DAYS * 24 * 60 * 60 * 1000);
  db.get()
    .prepare('INSERT INTO sessions(token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, expires.toISOString());
  return `${token}.${sign(token)}`;
}

function destroySession(cookieValue) {
  const token = parseCookieToken(cookieValue);
  if (token) db.get().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function parseCookieToken(cookieValue) {
  if (!cookieValue) return null;
  const idx = cookieValue.lastIndexOf('.');
  if (idx <= 0) return null;
  const token = cookieValue.slice(0, idx);
  const sig = cookieValue.slice(idx + 1);
  const expected = sign(token);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return token;
}

function userFromCookie(cookieValue) {
  const token = parseCookieToken(cookieValue);
  if (!token) return null;
  const row = db
    .get()
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`
    )
    .get(token, new Date().toISOString());
  if (!row) return null;
  delete row.password_hash;
  return row;
}

function authenticate(email, password) {
  const user = db
    .get()
    .prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE')
    .get(String(email || '').trim());
  if (!user || !user.active) return null;
  if (!verifyPassword(password, user.password_hash)) return null;
  delete user.password_hash;
  return user;
}

function cleanupExpiredSessions() {
  db.get().prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  userFromCookie,
  authenticate,
  cleanupExpiredSessions,
};
