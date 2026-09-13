'use strict';

const config = require('../config');

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function fromMinutes(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Gera a grade fixa de horários da escola a partir dos períodos configurados.
 * Cada horário tem um índice estável (slotIndex) usado no banco de dados.
 */
function buildSlots(periods = config.PERIODS, lessonMinutes = config.LESSON_MINUTES) {
  const slots = [];
  let index = 0;
  for (const period of periods) {
    const start = toMinutes(period.start);
    const end = toMinutes(period.end);
    for (let t = start; t + lessonMinutes <= end; t += lessonMinutes) {
      slots.push({
        index,
        period: period.key,
        periodLabel: period.label,
        start: fromMinutes(t),
        end: fromMinutes(t + lessonMinutes),
        label: `${fromMinutes(t)} – ${fromMinutes(t + lessonMinutes)}`,
      });
      index += 1;
    }
  }
  return slots;
}

const SLOTS = buildSlots();

function getSlot(index) {
  return SLOTS.find((s) => s.index === Number(index)) || null;
}

function slotLabel(index) {
  const s = getSlot(index);
  return s ? s.label : `Horário ${index}`;
}

function weekdayName(weekday) {
  return config.WEEKDAY_NAMES[weekday] || `Dia ${weekday}`;
}

function weekdayShort(weekday) {
  return config.WEEKDAY_SHORT[weekday] || String(weekday);
}

/**
 * Verifica se um conjunto de alunos pode ser colocado numa aula.
 * Retorna { ok, errors } sem tocar no banco (regra pura, testável).
 *
 * @param {object} params
 * @param {boolean} params.individual - aula individual
 * @param {Array<{id:number,name:string,individual_only:number}>} params.students
 * @param {number} params.maxGroupSize
 * @param {Array<{student_id:number, student_name:string, weekday:number, slot_index:number, lesson_id:number}>} params.conflicts
 *        aulas de outros professores/horários em que os alunos já estão no mesmo dia/horário
 */
function validateLessonComposition({ individual, students, maxGroupSize, conflicts = [] }) {
  const errors = [];
  if (individual && students.length > 1) {
    errors.push('Uma aula individual só pode ter um aluno.');
  }
  if (!individual && students.length > maxGroupSize) {
    errors.push(`Uma aula em grupo pode ter no máximo ${maxGroupSize} alunos.`);
  }
  if (!individual) {
    const needsIndividual = students.filter((s) => s.individual_only);
    if (needsIndividual.length > 0 && students.length > 1) {
      errors.push(
        `Os alunos ${needsIndividual.map((s) => s.name).join(', ')} estão marcados para atendimento individual e não podem dividir a aula com outros alunos.`
      );
    }
  }
  for (const c of conflicts) {
    errors.push(`${c.student_name} já está em outra aula neste dia e horário.`);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Calcula as vagas de um horário de um professor.
 */
function vacancyFor(lesson, maxGroupSize) {
  if (!lesson) return { capacity: maxGroupSize, used: 0, free: maxGroupSize, individual: false, empty: true };
  const used = lesson.students ? lesson.students.length : lesson.student_count || 0;
  if (lesson.individual) {
    return { capacity: 1, used, free: Math.max(0, 1 - used), individual: true, empty: false };
  }
  return { capacity: maxGroupSize, used, free: Math.max(0, maxGroupSize - used), individual: false, empty: false };
}

module.exports = {
  buildSlots,
  SLOTS,
  getSlot,
  slotLabel,
  weekdayName,
  weekdayShort,
  validateLessonComposition,
  vacancyFor,
  toMinutes,
  fromMinutes,
};
