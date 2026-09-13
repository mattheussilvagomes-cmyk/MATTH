'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const schedule = require('../src/services/schedule');

test('grade de horários segue manhã 9h–11h40 e tarde 13h30–16h10 com aulas de 40 min', () => {
  const slots = schedule.SLOTS;
  assert.equal(slots.length, 8);
  assert.deepEqual(
    slots.map((s) => s.start),
    ['09:00', '09:40', '10:20', '11:00', '13:30', '14:10', '14:50', '15:30']
  );
  assert.equal(slots[3].end, '11:40');
  assert.equal(slots[7].end, '16:10');
  assert.equal(slots[0].period, 'MANHA');
  assert.equal(slots[4].period, 'TARDE');
});

test('aula individual aceita apenas um aluno', () => {
  const r = schedule.validateLessonComposition({
    individual: true,
    students: [
      { id: 1, name: 'A', individual_only: 0 },
      { id: 2, name: 'B', individual_only: 0 },
    ],
    maxGroupSize: 4,
  });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /individual/);
});

test('aluno marcado como individual não pode dividir aula em grupo', () => {
  const r = schedule.validateLessonComposition({
    individual: false,
    students: [
      { id: 1, name: 'Maria', individual_only: 1 },
      { id: 2, name: 'B', individual_only: 0 },
    ],
    maxGroupSize: 4,
  });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /Maria/);
  // Sozinho numa aula em grupo é permitido.
  const ok = schedule.validateLessonComposition({ individual: false, students: [{ id: 1, name: 'Maria', individual_only: 1 }], maxGroupSize: 4 });
  assert.equal(ok.ok, true);
});

test('respeita o máximo de alunos por aula em grupo e detecta conflitos', () => {
  const students = [1, 2, 3, 4, 5].map((i) => ({ id: i, name: `S${i}`, individual_only: 0 }));
  assert.equal(schedule.validateLessonComposition({ individual: false, students, maxGroupSize: 4 }).ok, false);
  assert.equal(schedule.validateLessonComposition({ individual: false, students: students.slice(0, 4), maxGroupSize: 4 }).ok, true);
  const c = schedule.validateLessonComposition({
    individual: false,
    students: students.slice(0, 2),
    maxGroupSize: 4,
    conflicts: [{ student_id: 1, student_name: 'S1' }],
  });
  assert.equal(c.ok, false);
  assert.match(c.errors[0], /S1 já está em outra aula/);
});

test('vagas de um horário', () => {
  assert.deepEqual(schedule.vacancyFor(null, 4), { capacity: 4, used: 0, free: 4, individual: false, empty: true });
  assert.equal(schedule.vacancyFor({ individual: 1, students: [{}] }, 4).free, 0);
  assert.equal(schedule.vacancyFor({ individual: 0, students: [{}, {}] }, 4).free, 2);
});
