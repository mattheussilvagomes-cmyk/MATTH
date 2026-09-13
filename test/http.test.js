'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { freshDb } = require('./helpers');
const { createServer } = require('../src/server');

async function withServer(fn) {
  const server = createServer();
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

async function login(base, email) {
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, senha: '123456' }),
    redirect: 'manual',
  });
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return { status: res.status, location: res.headers.get('location'), cookie };
}

test('login redireciona cada perfil para sua área e bloqueia áreas alheias', async () => {
  freshDb();
  await withServer(async (base) => {
    const g = await login(base, 'gestao@x.org');
    assert.equal(g.status, 303);
    assert.equal(g.location, '/gestao');
    const p = await login(base, 'ana@x.org');
    assert.equal(p.location, '/professor');
    const r = await login(base, 'carla@x.org');
    assert.equal(r.location, '/responsavel');

    const forbidden = await fetch(`${base}/gestao`, { headers: { cookie: p.cookie } });
    assert.equal(forbidden.status, 403);
    const ok = await fetch(`${base}/professor/alunos`, { headers: { cookie: p.cookie } });
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /Lucas/);

    const anon = await fetch(`${base}/professor`, { redirect: 'manual' });
    assert.equal(anon.status, 303);
    assert.match(anon.headers.get('location'), /^\/login/);

    const bad = await login(base, 'ninguem@x.org');
    assert.equal(bad.status, 401);
  });
});

test('responsável só vê os próprios dependentes; professor só vê seus alunos', async () => {
  const { s1, s4 } = freshDb();
  await withServer(async (base) => {
    const r = await login(base, 'carla@x.org');
    assert.equal((await fetch(`${base}/responsavel/alunos/${s1}`, { headers: { cookie: r.cookie } })).status, 200);
    assert.equal((await fetch(`${base}/responsavel/alunos/${s4}`, { headers: { cookie: r.cookie } })).status, 404);
    const p = await login(base, 'ana@x.org');
    assert.equal((await fetch(`${base}/professor/alunos/${s4}`, { headers: { cookie: p.cookie } })).status, 404);
    // Gestão age em nome do professor
    const g = await login(base, 'gestao@x.org');
    const page = await fetch(`${base}/professor/agenda?professor=2`, { headers: { cookie: g.cookie } });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /em nome de/);
  });
});

test('professor salva aula pelo formulário e a agenda reflete', async () => {
  const { s1, s2 } = freshDb();
  await withServer(async (base) => {
    const p = await login(base, 'ana@x.org');
    const res = await fetch(`${base}/professor/agenda/1/0`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: p.cookie, origin: base },
      body: new URLSearchParams([['alunos', String(s1)], ['alunos', String(s2)], ['sala', '1']]),
      redirect: 'manual',
    });
    assert.equal(res.status, 303);
    const agenda = await fetch(`${base}/professor/agenda`, { headers: { cookie: p.cookie } });
    const html = await agenda.text();
    assert.match(html, /Grupo \(2\)/);
    // Origem estranha é bloqueada
    const csrf = await fetch(`${base}/professor/agenda/1/1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: p.cookie, origin: 'http://malicioso.example' },
      body: 'alunos=1',
      redirect: 'manual',
    });
    assert.equal(csrf.status, 403);
  });
});
