'use strict';

const db = require('../db');
const config = require('../config');
const schedule = require('./schedule');
const audit = require('../audit');
const notify = require('../notify');

function lessonStudents(lessonId) {
  return db
    .get()
    .prepare(
      `SELECT s.id, s.name, s.instrument, s.individual_only FROM lesson_students ls
       JOIN students s ON s.id = ls.student_id WHERE ls.lesson_id = ? ORDER BY s.name`
    )
    .all(lessonId);
}

function attachStudents(lessons) {
  for (const l of lessons) l.students = lessonStudents(l.id);
  return lessons;
}

/** Grade semanal de um professor: mapa "weekday:slot" -> aula com alunos. */
function weekGridForTeacher(teacherId) {
  const lessons = attachStudents(
    db.get().prepare('SELECT * FROM lessons WHERE teacher_id = ? ORDER BY weekday, slot_index').all(teacherId)
  );
  const map = new Map();
  for (const l of lessons) map.set(`${l.weekday}:${l.slot_index}`, l);
  return { lessons, map };
}

function lessonAt(teacherId, weekday, slotIndex) {
  const l = db
    .get()
    .prepare('SELECT * FROM lessons WHERE teacher_id = ? AND weekday = ? AND slot_index = ?')
    .get(teacherId, weekday, slotIndex);
  if (l) l.students = lessonStudents(l.id);
  return l || null;
}

function lessonById(id) {
  const l = db.get().prepare('SELECT l.*, t.name AS teacher_name FROM lessons l LEFT JOIN users t ON t.id = l.teacher_id WHERE l.id = ?').get(id);
  if (l) l.students = lessonStudents(l.id);
  return l || null;
}

/** Aulas de todos os professores (agenda geral), com contagem de alunos. */
function allLessons({ teacherId } = {}) {
  const rows = db
    .get()
    .prepare(
      `SELECT l.*, t.name AS teacher_name FROM lessons l JOIN users t ON t.id = l.teacher_id
       ${teacherId ? 'WHERE l.teacher_id = ?' : ''} ORDER BY l.weekday, l.slot_index, t.name`
    )
    .all(...(teacherId ? [teacherId] : []));
  return attachStudents(rows);
}

/** Conflitos: alunos que já estão em outra aula no mesmo dia/horário. */
function findConflicts(studentIds, weekday, slotIndex, excludeLessonId) {
  if (!studentIds.length) return [];
  const placeholders = studentIds.map(() => '?').join(',');
  return db
    .get()
    .prepare(
      `SELECT ls.student_id, s.name AS student_name, l.id AS lesson_id, l.weekday, l.slot_index
       FROM lesson_students ls JOIN lessons l ON l.id = ls.lesson_id JOIN students s ON s.id = ls.student_id
       WHERE ls.student_id IN (${placeholders}) AND l.weekday = ? AND l.slot_index = ? AND l.id <> ?`
    )
    .all(...studentIds, weekday, slotIndex, excludeLessonId || 0);
}

function validateSlot(weekday, slotIndex) {
  if (!config.WEEKDAYS.includes(Number(weekday))) throw new Error('Dia da semana inválido.');
  if (!schedule.getSlot(slotIndex)) throw new Error('Horário inválido.');
}

/**
 * Cria ou atualiza a aula de um professor num dia/horário, definindo os alunos.
 * @param {object} actor usuário que está fazendo a alteração (professor ou gestão)
 */
function saveLesson({ actor, teacherId, weekday, slotIndex, individual, room, studentIds }) {
  validateSlot(weekday, slotIndex);
  weekday = Number(weekday);
  slotIndex = Number(slotIndex);
  const ids = [...new Set(studentIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))];

  // Somente alunos do próprio professor podem ser colocados na aula.
  const students = ids.length
    ? db
        .get()
        .prepare(
          `SELECT id, name, individual_only FROM students WHERE id IN (${ids.map(() => '?').join(',')})
           AND teacher_id = ? AND status = 'ATIVO'`
        )
        .all(...ids, teacherId)
    : [];
  if (students.length !== ids.length) {
    throw new Error('Um ou mais alunos selecionados não pertencem a este professor ou estão inativos.');
  }

  const existing = lessonAt(teacherId, weekday, slotIndex);
  const conflicts = findConflicts(ids, weekday, slotIndex, existing ? existing.id : null);
  const check = schedule.validateLessonComposition({
    individual: !!individual,
    students,
    maxGroupSize: db.maxGroupSize(),
    conflicts,
  });
  if (!check.ok) {
    const err = new Error(check.errors.join(' '));
    err.errors = check.errors;
    throw err;
  }

  const before = existing ? existing.students.map((s) => s.id).sort() : [];
  const lessonId = db.transaction((d) => {
    let id;
    if (existing) {
      d.prepare("UPDATE lessons SET individual = ?, room = ?, updated_at = datetime('now') WHERE id = ?").run(
        individual ? 1 : 0,
        room || null,
        existing.id
      );
      d.prepare('DELETE FROM lesson_students WHERE lesson_id = ?').run(existing.id);
      id = existing.id;
    } else {
      const r = d
        .prepare('INSERT INTO lessons(teacher_id, weekday, slot_index, individual, room) VALUES (?, ?, ?, ?, ?)')
        .run(teacherId, weekday, slotIndex, individual ? 1 : 0, room || null);
      id = Number(r.lastInsertRowid);
    }
    const ins = d.prepare('INSERT INTO lesson_students(lesson_id, student_id) VALUES (?, ?)');
    for (const sid of ids) ins.run(id, sid);
    return id;
  });

  const after = [...ids].sort();
  const label = `${schedule.weekdayName(weekday)} ${schedule.slotLabel(slotIndex)}`;
  audit.log(
    actor.id,
    existing ? 'AULA_ALTERADA' : 'AULA_CRIADA',
    'lesson',
    lessonId,
    `${label} (${individual ? 'individual' : 'grupo'}) — alunos: ${students.map((s) => s.name).join(', ') || 'nenhum'}` +
      (actor.id !== teacherId ? ` [feito pela gestão em nome do professor #${teacherId}]` : '')
  );

  // Notifica responsáveis dos alunos que entraram, saíram ou permaneceram (se algo mudou).
  const added = after.filter((id) => !before.includes(id));
  const removed = before.filter((id) => !after.includes(id));
  const changed = existing ? existing.individual !== (individual ? 1 : 0) : false;
  for (const sid of added) {
    notify.notifyGuardiansOfStudent(
      sid,
      'HORARIO',
      'Novo horário de aula',
      `A aula foi marcada para ${label}.`,
      `/responsavel/alunos/${sid}`
    );
  }
  for (const sid of removed) {
    notify.notifyGuardiansOfStudent(
      sid,
      'HORARIO',
      'Alteração no horário de aula',
      `O aluno foi retirado da aula de ${label}. Confira o novo horário.`,
      `/responsavel/alunos/${sid}`
    );
  }
  if (changed) {
    for (const sid of after.filter((id) => before.includes(id))) {
      notify.notifyGuardiansOfStudent(
        sid,
        'HORARIO',
        'Alteração na aula',
        `A aula de ${label} passou a ser ${individual ? 'individual' : 'em grupo'}.`,
        `/responsavel/alunos/${sid}`
      );
    }
  }

  return lessonId;
}

function deleteLesson({ actor, teacherId, weekday, slotIndex }) {
  const existing = lessonAt(teacherId, weekday, slotIndex);
  if (!existing) return false;
  const label = `${schedule.weekdayName(weekday)} ${schedule.slotLabel(slotIndex)}`;
  db.get().prepare('DELETE FROM lessons WHERE id = ?').run(existing.id);
  audit.log(
    actor.id,
    'AULA_REMOVIDA',
    'lesson',
    existing.id,
    `${label} — alunos: ${existing.students.map((s) => s.name).join(', ') || 'nenhum'}`
  );
  for (const s of existing.students) {
    notify.notifyGuardiansOfStudent(
      s.id,
      'HORARIO',
      'Aula cancelada no horário',
      `A aula de ${label} foi removida da grade. Confira o horário atualizado.`,
      `/responsavel/alunos/${s.id}`
    );
  }
  return true;
}

/** Aulas de um professor num determinado dia da semana (para o registro de presença). */
function lessonsForTeacherOnWeekday(teacherId, weekday) {
  return attachStudents(
    db
      .get()
      .prepare('SELECT * FROM lessons WHERE teacher_id = ? AND weekday = ? ORDER BY slot_index')
      .all(teacherId, weekday)
  );
}

/** Visão de ocupação por dia/horário (gestão): contagem de alunos, aulas e vagas. */
function occupancy() {
  const max = db.maxGroupSize();
  const lessons = allLessons();
  const teachers = db.get().prepare("SELECT id, name FROM users WHERE role = 'PROFESSOR' AND active = 1 ORDER BY name").all();
  const cells = {};
  for (const wd of config.WEEKDAYS) {
    for (const s of schedule.SLOTS) {
      cells[`${wd}:${s.index}`] = { weekday: wd, slot: s, lessons: [], students: 0, free: teachers.length * max };
    }
  }
  for (const l of lessons) {
    const c = cells[`${l.weekday}:${l.slot_index}`];
    if (!c) continue;
    c.lessons.push(l);
    c.students += l.students.length;
    const v = schedule.vacancyFor(l, max);
    // Um professor com aula ocupa "max" da capacidade teórica; sobra o que a própria aula ainda comporta.
    c.free -= max - v.free;
  }
  return { cells, teachers, max };
}

module.exports = {
  weekGridForTeacher,
  lessonAt,
  lessonById,
  allLessons,
  findConflicts,
  saveLesson,
  deleteLesson,
  lessonsForTeacherOnWeekday,
  lessonStudents,
  occupancy,
};
