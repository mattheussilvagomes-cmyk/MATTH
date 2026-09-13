'use strict';

const db = require('../src/db');
const auth = require('../src/auth');

/** Cria um banco em memória e usuários básicos para os testes. */
function freshDb() {
  const d = db.use(db.open(':memory:'));
  const pass = auth.hashPassword('123456');
  const ins = d.prepare('INSERT INTO users(name, email, password_hash, role) VALUES (?, ?, ?, ?)');
  const gestao = Number(ins.run('Gestão', 'gestao@x.org', pass, 'GESTAO').lastInsertRowid);
  const prof = Number(ins.run('Prof Ana', 'ana@x.org', pass, 'PROFESSOR').lastInsertRowid);
  const prof2 = Number(ins.run('Prof Bruno', 'bruno@x.org', pass, 'PROFESSOR').lastInsertRowid);
  const resp = Number(ins.run('Resp Carla', 'carla@x.org', pass, 'RESPONSAVEL').lastInsertRowid);
  const insS = d.prepare('INSERT INTO students(name, instrument, teacher_id, individual_only) VALUES (?, ?, ?, ?)');
  const s1 = Number(insS.run('Lucas', 'Violão', prof, 0).lastInsertRowid);
  const s2 = Number(insS.run('Pedro', 'Violão', prof, 0).lastInsertRowid);
  const s3 = Number(insS.run('Maria', 'Violino', prof, 1).lastInsertRowid);
  const s4 = Number(insS.run('Outro', 'Violino', prof2, 0).lastInsertRowid);
  d.prepare('INSERT INTO student_guardians(student_id, guardian_id) VALUES (?, ?)').run(s1, resp);
  d.prepare('INSERT INTO student_guardians(student_id, guardian_id) VALUES (?, ?)').run(s2, resp);
  return { d, gestao, prof, prof2, resp, s1, s2, s3, s4 };
}

module.exports = { freshDb };
