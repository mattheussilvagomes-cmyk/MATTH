'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { freshDb } = require('./helpers');
const lessons = require('../src/services/lessons');
const attendance = require('../src/services/attendance');
const students = require('../src/services/students');
const notify = require('../src/notify');

test('registro de presença: falta gera notificação, presença não; nova falta na mesma data não duplica', () => {
  const { prof, resp, s1, s2 } = freshDb();
  const id = lessons.saveLesson({ actor: { id: prof }, teacherId: prof, weekday: 1, slotIndex: 0, individual: false, studentIds: [s1, s2] });
  const lesson = lessons.lessonById(id);
  notify.markAllRead(resp);
  // 2026-09-14 é uma segunda-feira
  attendance.saveAttendance({ actor: { id: prof }, teacherId: prof, lesson, date: '2026-09-14', entries: [{ studentId: s1, status: 'FALTA' }, { studentId: s2, status: 'PRESENTE' }] });
  assert.equal(notify.unreadCount(resp), 1);
  // Regravar a mesma falta não notifica de novo
  attendance.saveAttendance({ actor: { id: prof }, teacherId: prof, lesson, date: '2026-09-14', entries: [{ studentId: s1, status: 'FALTA', note: 'sem aviso' }] });
  assert.equal(notify.unreadCount(resp), 1);
  const sum = students.attendanceSummary(s1);
  assert.deepEqual(sum, { presentes: 0, faltas: 1, justificadas: 0, total: 1, frequencia: 0 });
  assert.equal(students.attendanceOf(s1)[0].note, 'sem aviso');
});

test('data precisa bater com o dia da semana da aula', () => {
  const { prof, s1 } = freshDb();
  const id = lessons.saveLesson({ actor: { id: prof }, teacherId: prof, weekday: 1, slotIndex: 0, individual: false, studentIds: [s1] });
  const lesson = lessons.lessonById(id);
  assert.throws(() => attendance.saveAttendance({ actor: { id: prof }, teacherId: prof, lesson, date: '2026-09-15', entries: [{ studentId: s1, status: 'PRESENTE' }] }), /dia da semana/);
});

test('avaliação e observação notificam responsáveis; observação interna não', () => {
  const { prof, resp, s1 } = freshDb();
  attendance.addEvaluation({ actor: { id: prof }, teacherId: prof, studentId: s1, title: 'Prova', grade: '8,5', comment: '', date: '2026-09-10' });
  assert.equal(notify.unreadCount(resp), 1);
  assert.equal(students.evaluationsOf(s1)[0].grade, 8.5);
  assert.throws(() => attendance.addEvaluation({ actor: { id: prof }, teacherId: prof, studentId: s1, title: 'X', grade: '11', date: '2026-09-10' }), /entre 0 e 10/);
  attendance.addObservation({ actor: { id: prof }, teacherId: prof, studentId: s1, text: 'Interna', visibleToGuardian: false });
  assert.equal(notify.unreadCount(resp), 1);
  attendance.addObservation({ actor: { id: prof }, teacherId: prof, studentId: s1, text: 'Visível' });
  assert.equal(notify.unreadCount(resp), 2);
  assert.equal(students.observationsOf(s1, { guardianView: true }).length, 1);
  assert.equal(students.observationsOf(s1).length, 2);
  assert.ok(students.historyOf(s1, { guardianView: true }).length >= 2);
});
