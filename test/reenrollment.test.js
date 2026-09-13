'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { freshDb } = require('./helpers');
const reenrollment = require('../src/services/reenrollment');
const notify = require('../src/notify');

const today = new Date().toISOString().slice(0, 10);
const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

test('abrir período cria pendências para alunos ativos e notifica responsáveis', () => {
  const { gestao, resp } = freshDb();
  const id = reenrollment.openPeriod({ actor: { id: gestao }, name: 'Rematrícula 2027', year: 2027, opensAt: today, closesAt: nextMonth, terms: 'Termos.' });
  const list = reenrollment.listForPeriod(id);
  assert.equal(list.length, 4);
  assert.ok(list.every((r) => r.status === 'PENDENTE'));
  assert.equal(notify.unreadCount(resp), 2);
  assert.equal(reenrollment.activePeriod().id, id);
});

test('responsável confirma rematrícula com aceite dos termos e atualiza cadastro', () => {
  const { gestao, resp, s1, d } = freshDb();
  const id = reenrollment.openPeriod({ actor: { id: gestao }, name: 'R', year: 2027, opensAt: today, closesAt: nextMonth, terms: 'Termos.' });
  const period = reenrollment.periodById(id);
  const actor = { id: resp, name: 'Resp Carla' };
  assert.throws(() => reenrollment.submit({ actor, period, studentId: s1, form: { decisao: 'CONFIRMADA', instrumento: 'Violão' } }), /aceitar os termos/);
  const decision = reenrollment.submit({
    actor,
    period,
    studentId: s1,
    form: { decisao: 'CONFIRMADA', instrumento: 'Violino', horario: 'ALTERAR', pedido_horario: 'Tardes', nome_responsavel: 'Carla N.', telefone_responsavel: '1199', nascimento: '2014-01-01', aceite: '1' },
  });
  assert.equal(decision, 'CONFIRMADA');
  const r = reenrollment.forStudent(id, s1);
  assert.equal(r.status, 'CONFIRMADA');
  assert.equal(r.keep_schedule, 0);
  assert.equal(r.schedule_request, 'Tardes');
  assert.equal(r.terms_accepted, 1);
  assert.equal(d.prepare('SELECT phone FROM users WHERE id = ?').get(resp).phone, '1199');
  assert.equal(d.prepare('SELECT birth_date FROM students WHERE id = ?').get(s1).birth_date, '2014-01-01');
  assert.equal(notify.unreadCount(gestao), 1);
  // Não renovar
  reenrollment.submit({ actor, period, studentId: s1, form: { decisao: 'NAO_RENOVAR' } });
  assert.equal(reenrollment.forStudent(id, s1).status, 'NAO_RENOVAR');
  const csv = reenrollment.toCsv(reenrollment.listForPeriod(id));
  assert.match(csv, /Lucas;Prof Ana;Não vai renovar/);
});

test('período encerrado não aceita respostas', () => {
  const { gestao, resp, s1 } = freshDb();
  const id = reenrollment.openPeriod({ actor: { id: gestao }, name: 'R', year: 2027, opensAt: today, closesAt: nextMonth, terms: 'T' });
  reenrollment.closePeriod({ actor: { id: gestao }, id });
  assert.equal(reenrollment.activePeriod(), null);
  const period = reenrollment.periodById(id);
  assert.throws(() => reenrollment.submit({ actor: { id: resp, name: 'x' }, period, studentId: s1, form: { decisao: 'NAO_RENOVAR' } }), /não está aberto/);
});
