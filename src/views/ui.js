'use strict';

const config = require('../config');

function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function attr(value) {
  return esc(value);
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = String(iso).slice(0, 10);
  const [y, m, day] = d.split('-');
  if (!y || !m || !day) return esc(iso);
  return `${day}/${m}/${y}`;
}

function fmtDateTime(iso) {
  if (!iso) return '';
  const s = String(iso);
  // SQLite datetime('now') grava em UTC: "YYYY-MM-DD HH:MM:SS".
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return esc(iso);
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtGrade(g) {
  if (g === null || g === undefined) return '—';
  return Number(g).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function nl2br(text) {
  return esc(text).replace(/\r?\n/g, '<br>');
}

function badge(text, kind = 'neutral') {
  return `<span class="badge badge-${kind}">${esc(text)}</span>`;
}

function statusBadge(status) {
  const map = {
    PRESENTE: ['Presente', 'ok'],
    FALTA: ['Falta', 'danger'],
    JUSTIFICADA: ['Justificada', 'warn'],
    ATIVO: ['Ativo', 'ok'],
    INATIVO: ['Inativo', 'neutral'],
    PENDENTE: ['Pendente', 'warn'],
    CONFIRMADA: ['Confirmada', 'ok'],
    NAO_RENOVAR: ['Não renova', 'danger'],
  };
  const [label, kind] = map[status] || [status, 'neutral'];
  return badge(label, kind);
}

function flashHtml(flash) {
  if (!flash) return '';
  return `<div class="flash flash-${esc(flash.type)}" role="status">${esc(flash.message)}</div>`;
}

function select(name, options, selected, { placeholder, required, id, multiple } = {}) {
  const opts = options
    .map((o) => {
      const value = typeof o === 'object' ? o.value : o;
      const label = typeof o === 'object' ? o.label : o;
      const sel = Array.isArray(selected)
        ? selected.map(String).includes(String(value))
        : String(selected ?? '') === String(value);
      return `<option value="${attr(value)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
    })
    .join('');
  return `<select name="${attr(name)}"${id ? ` id="${attr(id)}"` : ''}${required ? ' required' : ''}${multiple ? ' multiple' : ''}>${
    placeholder ? `<option value="">${esc(placeholder)}</option>` : ''
  }${opts}</select>`;
}

function field(label, inputHtml, hint) {
  return `<label class="field"><span class="field-label">${esc(label)}</span>${inputHtml}${
    hint ? `<span class="hint">${esc(hint)}</span>` : ''
  }</label>`;
}

function input(name, value = '', { type = 'text', required, placeholder, min, max, step, list } = {}) {
  return `<input type="${type}" name="${attr(name)}" value="${attr(value)}"${required ? ' required' : ''}${
    placeholder ? ` placeholder="${attr(placeholder)}"` : ''
  }${min !== undefined ? ` min="${attr(min)}"` : ''}${max !== undefined ? ` max="${attr(max)}"` : ''}${
    step !== undefined ? ` step="${attr(step)}"` : ''
  }${list ? ` list="${attr(list)}"` : ''}>`;
}

function textarea(name, value = '', { rows = 4, required, placeholder } = {}) {
  return `<textarea name="${attr(name)}" rows="${rows}"${required ? ' required' : ''}${
    placeholder ? ` placeholder="${attr(placeholder)}"` : ''
  }>${esc(value)}</textarea>`;
}

function table(headers, rows, { empty = 'Nenhum registro.' } = {}) {
  if (!rows.length) return `<p class="empty">${esc(empty)}</p>`;
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}

function card(title, body, { actions = '', cls = '' } = {}) {
  return `<section class="card ${cls}">${
    title || actions ? `<header class="card-head"><h2>${title}</h2><div class="card-actions">${actions}</div></header>` : ''
  }<div class="card-body">${body}</div></section>`;
}

function stat(label, value, hint) {
  return `<div class="stat"><div class="stat-value">${value}</div><div class="stat-label">${esc(label)}</div>${
    hint ? `<div class="stat-hint">${esc(hint)}</div>` : ''
  }</div>`;
}

function postButton(action, label, { cls = 'btn', confirm, hidden = {} } = {}) {
  const hiddenInputs = Object.entries(hidden)
    .map(([k, v]) => `<input type="hidden" name="${attr(k)}" value="${attr(v)}">`)
    .join('');
  return `<form method="post" action="${attr(action)}" class="inline"${
    confirm ? ` data-confirm="${attr(confirm)}"` : ''
  }>${hiddenInputs}<button type="submit" class="${attr(cls)}">${esc(label)}</button></form>`;
}

function instrumentDatalist() {
  return `<datalist id="instrumentos">${config.INSTRUMENTS.map((i) => `<option value="${attr(i)}">`).join('')}</datalist>`;
}

function age(birth) {
  if (!birth) return '';
  const b = new Date(birth);
  if (Number.isNaN(b.getTime())) return '';
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a -= 1;
  return `${a} anos`;
}

module.exports = {
  esc,
  attr,
  fmtDate,
  fmtDateTime,
  fmtGrade,
  nl2br,
  badge,
  statusBadge,
  flashHtml,
  select,
  field,
  input,
  textarea,
  table,
  card,
  stat,
  postButton,
  instrumentDatalist,
  age,
};
