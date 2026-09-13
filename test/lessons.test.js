'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { freshDb } = require('./helpers');
const lessons = require('../src/services/lessons');
const notify = require('../src/notify');
const audit = require('../src/audit');

test('professor monta aula em grupo, responsáveis são notificados e alteração é auditada', () => {
  const { prof, resp, s1, s2 } = freshDb();
  const actor = { id: prof };
  const id = lessons.saveLesson({ actor, teacherId: prof, weekday: 1, slotIndex: 0, individual: false, studentIds: [s1, s2] });
  const l = lessons.lessonById(id);
  assert.equal(l.students.length, 2);
  assert.equal(notify.unreadCount(resp), 2);
  const log = audit.recent(5);
  assert.equal(log[0].action, 'AULA_CRIADA');
  assert.match(log[0].details, /Segunda-feira 09:00 – 09:40/);
});

test('não permite aluno de outro professor nem aluno individual em grupo', () => {
  const { prof, s1, s3, s4 } = freshDb();
  const actor = { id: prof };
  assert.throws(() => lessons.saveLesson({ actor, teacherId: prof, weekday: 1, slotIndex: 0, individual: false, studentIds: [s4] }), /não pertencem/);
  assert.throws(() => lessons.saveLesson({ actor, teacherId: prof, weekday: 1, slotIndex: 0, individual: false, studentIds: [s1, s3] }), /individual/);
  // Individual sozinha funciona
  const id = lessons.saveLesson({ actor, teacherId: prof, weekday: 1, slotIndex: 0, individual: true, studentIds: [s3] });
  assert.equal(lessons.lessonById(id).individual, 1);
});

test('aluno não pode estar em duas aulas no mesmo dia e horário', () => {
  const { prof, prof2, s1, d } = freshDb();
  lessons.saveLesson({ actor: { id: prof }, teacherId: prof, weekday: 2, slotIndex: 1, individual: false, studentIds: [s1] });
  // move o aluno para o professor 2 e tenta colocar no mesmo horário
  d.prepare('UPDATE students SET teacher_id = ? WHERE id = ?').run(prof2, s1);
  assert.throws(
    () => lessons.saveLesson({ actor: { id: prof2 }, teacherId: prof2, weekday: 2, slotIndex: 1, individual: false, studentIds: [s1] }),
    /já está em outra aula/
  );
});

test('remover aula notifica responsáveis e libera o horário', () => {
  const { prof, resp, s1 } = freshDb();
  lessons.saveLesson({ actor: { id: prof }, teacherId: prof, weekday: 3, slotIndex: 2, individual: false, studentIds: [s1] });
  notify.markAllRead(resp);
  assert.equal(lessons.deleteLesson({ actor: { id: prof }, teacherId: prof, weekday: 3, slotIndex: 2 }), true);
  assert.equal(lessons.lessonAt(prof, 3, 2), null);
  assert.equal(notify.unreadCount(resp), 1);
});

test('ocupação da agenda geral calcula vagas', () => {
  const { prof, s1, s2 } = freshDb();
  lessons.saveLesson({ actor: { id: prof }, teacherId: prof, weekday: 1, slotIndex: 0, individual: false, studentIds: [s1, s2] });
  const occ = lessons.occupancy();
  assert.equal(occ.teachers.length, 2);
  const cell = occ.cells['1:0'];
  assert.equal(cell.students, 2);
  // 2 professores × 4 vagas = 8; aula com 2 alunos deixa 2 vagas nela + 4 do outro professor = 6
  assert.equal(cell.free, 6);
  assert.equal(occ.cells['1:1'].free, 8);
});
