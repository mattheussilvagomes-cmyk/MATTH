'use strict';

const students = require('../services/students');
const schedule = require('../services/schedule');
const reenrollment = require('../services/reenrollment');
const { esc, attr, fmtDate, fmtDateTime, fmtGrade, nl2br, statusBadge, table, badge } = require('./ui');

/** Bloco de horário semanal do aluno. */
function scheduleBlock(studentId) {
  const rows = students.scheduleOf(studentId);
  if (!rows.length) return '<p class="empty">Este aluno ainda não está em nenhum horário.</p>';
  return `<ul class="list">${rows
    .map(
      (l) => `<li><span class="title">${esc(schedule.weekdayName(l.weekday))}, ${esc(schedule.slotLabel(l.slot_index))}</span>
      ${l.individual ? badge('Aula individual', 'warn') : badge(`Grupo · ${l.student_count} aluno(s)`, 'primary')}
      <div class="meta">Professor(a): ${esc(l.teacher_name || '—')}${l.room ? ` · Sala ${esc(l.room)}` : ''}</div></li>`
    )
    .join('')}</ul>`;
}

function attendanceBlock(studentId) {
  const summary = students.attendanceSummary(studentId);
  const rows = students.attendanceOf(studentId, 100);
  const stats = `<div class="stats">
    <div class="stat"><div class="stat-value">${summary.frequencia === null ? '—' : summary.frequencia + '%'}</div><div class="stat-label">Frequência</div></div>
    <div class="stat"><div class="stat-value">${summary.presentes}</div><div class="stat-label">Presenças</div></div>
    <div class="stat"><div class="stat-value">${summary.faltas}</div><div class="stat-label">Faltas</div></div>
    <div class="stat"><div class="stat-value">${summary.justificadas}</div><div class="stat-label">Justificadas</div></div>
  </div>`;
  return (
    stats +
    table(
      ['Data', 'Horário', 'Situação', 'Observação', 'Professor(a)'],
      rows.map((a) => [fmtDate(a.date), esc(schedule.slotLabel(a.slot_index)), statusBadge(a.status), esc(a.note || ''), esc(a.teacher_name || '')]),
      { empty: 'Nenhum registro de presença ainda.' }
    )
  );
}

function evaluationsBlock(studentId, { canDelete = false, deleteBase = '' } = {}) {
  const rows = students.evaluationsOf(studentId);
  const headers = ['Data', 'Avaliação', 'Nota', 'Comentário', 'Professor(a)'];
  if (canDelete) headers.push('');
  return table(
    headers,
    rows.map((e) => {
      const r = [fmtDate(e.date), esc(e.title), fmtGrade(e.grade), nl2br(e.comment || ''), esc(e.teacher_name || '')];
      if (canDelete) {
        r.push(
          `<form method="post" action="${attr(deleteBase)}/avaliacoes/${e.id}/excluir" class="inline" data-confirm="Excluir esta avaliação?"><button class="btn btn-danger btn-sm">Excluir</button></form>`
        );
      }
      return r;
    }),
    { empty: 'Nenhuma avaliação lançada ainda.' }
  );
}

function observationsBlock(studentId, { guardianView = false, canDelete = false, deleteBase = '' } = {}) {
  const rows = students.observationsOf(studentId, { guardianView });
  if (!rows.length) return '<p class="empty">Nenhuma observação registrada ainda.</p>';
  return `<ul class="list">${rows
    .map(
      (o) => `<li><div>${nl2br(o.text)}</div><div class="meta">${esc(o.teacher_name || '')} · ${fmtDateTime(o.created_at)}${
        !o.visible_to_guardian ? ' · ' + badge('Interna (não visível ao responsável)', 'neutral') : ''
      }${
        canDelete
          ? ` <form method="post" action="${attr(deleteBase)}/observacoes/${o.id}/excluir" class="inline" data-confirm="Excluir esta observação?"><button class="btn btn-ghost btn-sm">Excluir</button></form>`
          : ''
      }</div></li>`
    )
    .join('')}</ul>`;
}

function historyBlock(studentId, { guardianView = false } = {}) {
  const items = students.historyOf(studentId, { guardianView });
  if (!items.length) return '<p class="empty">Sem histórico ainda.</p>';
  const line = (i) => {
    switch (i.kind) {
      case 'presenca':
        return `${statusBadge(i.data.status)} aula das ${esc(schedule.slotLabel(i.data.slot_index))}${i.data.note ? ` — ${esc(i.data.note)}` : ''}`;
      case 'avaliacao':
        return `${badge('Avaliação', 'primary')} <strong>${esc(i.data.title)}</strong>${
          i.data.grade !== null ? ` — nota ${fmtGrade(i.data.grade)}` : ''
        }${i.data.comment ? `<div class="small muted">${nl2br(i.data.comment)}</div>` : ''}`;
      case 'observacao':
        return `${badge('Observação', 'neutral')} ${nl2br(i.data.text)}`;
      case 'rematricula':
        return `${badge('Rematrícula', 'ok')} ${esc(i.data.period_name)}: ${esc(reenrollment.STATUS_LABELS[i.data.status])}`;
      default:
        return '';
    }
  };
  return `<div class="timeline">${items.map((i) => `<div class="item"><div class="date">${fmtDate(i.date)}</div><div>${line(i)}</div></div>`).join('')}</div>`;
}

function tabs(base, current, list) {
  return `<div class="tabs">${list
    .map(([key, label]) => `<a class="tab${current === key ? ' active' : ''}" href="${attr(base)}${base.includes('?') ? '&' : '?'}aba=${key}">${esc(label)}</a>`)
    .join('')}</div>`;
}

module.exports = { scheduleBlock, attendanceBlock, evaluationsBlock, observationsBlock, historyBlock, tabs };
