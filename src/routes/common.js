'use strict';

const auth = require('../auth');
const db = require('../db');
const notify = require('../notify');
const audit = require('../audit');
const config = require('../config');
const { HttpError } = require('../http');
const { esc, attr, card, fmtDateTime, field, input, postButton } = require('../views/ui');

const HOME = { GESTAO: '/gestao', PROFESSOR: '/professor', RESPONSAVEL: '/responsavel' };

/** Middlewares de autorização. */
function requireLogin(ctx) {
  if (!ctx.user) {
    ctx.redirect(`/login?next=${encodeURIComponent(ctx.path)}`);
    return false;
  }
  return true;
}

function requireRole(...roles) {
  return (ctx) => {
    if (!requireLogin(ctx)) return false;
    if (!roles.includes(ctx.user.role)) throw new HttpError(403, 'Você não tem permissão para acessar esta área.');
    return true;
  };
}

function loginPage(ctx, error) {
  const demo = db.getSetting('demo_mode', '0') === '1';
  const body = `<div class="login-box">${card(
    'Entrar',
    `<p class="muted">Use o e-mail cadastrado pela escola.</p>
    ${error ? `<div class="flash flash-error">${esc(error)}</div>` : ''}
    <form method="post" action="/login" class="form">
      <input type="hidden" name="next" value="${attr(ctx.query.next || '')}">
      ${field('E-mail', input('email', ctx.body.email || '', { type: 'email', required: true, placeholder: 'nome@escola.org' }))}
      ${field('Senha', input('senha', '', { type: 'password', required: true }))}
      <button class="btn" type="submit">Entrar</button>
    </form>
    ${
      demo
        ? `<hr><p class="demo"><strong>Contas de demonstração</strong> (senha <code>123456</code>):<br>
      gestão: gestao@escola.org · professor: ana@escola.org · responsável: carla@familia.com</p>`
        : ''
    }`
  )}</div>`;
  ctx.html(error ? 401 : 200, require('../views/layout').page({ title: 'Entrar', user: null, flash: ctx.flash, body }));
}

module.exports = function register(router) {
  router.get('/', (ctx) => {
    if (!ctx.user) return ctx.redirect('/login');
    ctx.redirect(HOME[ctx.user.role] || '/login');
  });

  router.get('/login', (ctx) => {
    if (ctx.user) return ctx.redirect(HOME[ctx.user.role]);
    loginPage(ctx);
  });

  router.post('/login', (ctx) => {
    const user = auth.authenticate(ctx.body.email, ctx.body.senha);
    if (!user) return loginPage(ctx, 'E-mail ou senha incorretos.');
    const cookie = auth.createSession(user.id);
    ctx.setCookie('sessao', cookie, { maxAge: config.SESSION_DAYS * 86400, secure: ctx.req.headers['x-forwarded-proto'] === 'https' });
    audit.log(user.id, 'LOGIN', 'user', user.id);
    const next = ctx.body.next && String(ctx.body.next).startsWith('/') ? String(ctx.body.next) : HOME[user.role];
    if (user.must_change_password) {
      ctx.setFlash('info', 'Por segurança, defina uma nova senha antes de continuar.');
      return ctx.redirect('/perfil');
    }
    ctx.redirect(next);
  });

  router.post('/logout', (ctx) => {
    auth.destroySession(ctx.cookies.sessao);
    ctx.setCookie('sessao', '', { maxAge: 0 });
    ctx.redirect('/login');
  });

  router.get('/notificacoes', requireLogin, (ctx) => {
    const items = notify.listForUser(ctx.user.id);
    const body = `<div class="page-head"><h1>Notificações</h1>${
      items.some((n) => !n.read) ? postButton('/notificacoes/lidas', 'Marcar todas como lidas', { cls: 'btn btn-secondary' }) : ''
    }</div>${card(
      '',
      items.length
        ? `<ul class="list">${items
            .map(
              (n) => `<li class="notification${n.read ? '' : ' unread'}"><div style="flex:1">
              <div class="title">${esc(n.title)}</div>
              ${n.body ? `<div>${esc(n.body)}</div>` : ''}
              <div class="meta">${fmtDateTime(n.created_at)}</div></div>
              ${n.link ? `<a class="btn btn-secondary btn-sm" href="/notificacoes/${n.id}/abrir">Abrir</a>` : ''}</li>`
            )
            .join('')}</ul>`
        : '<p class="empty">Você não tem notificações.</p>'
    )}`;
    ctx.render('Notificações', body);
  });

  router.post('/notificacoes/lidas', requireLogin, (ctx) => {
    notify.markAllRead(ctx.user.id);
    ctx.redirect('/notificacoes');
  });

  router.get('/notificacoes/:id/abrir', requireLogin, (ctx) => {
    const n = db.get().prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?').get(ctx.params.id, ctx.user.id);
    if (!n) throw new HttpError(404, 'Notificação não encontrada.');
    notify.markRead(ctx.user.id, n.id);
    ctx.redirect(n.link || '/notificacoes');
  });

  router.get('/perfil', requireLogin, (ctx) => {
    const u = ctx.user;
    const body = `<h1>Meu perfil</h1><div class="grid grid-2">${card(
      'Dados',
      `<dl class="kv"><dt>Nome</dt><dd>${esc(u.name)}</dd><dt>E-mail</dt><dd>${esc(u.email)}</dd><dt>Perfil</dt><dd>${esc(
        config.ROLE_LABELS[u.role]
      )}</dd><dt>Telefone</dt><dd>${esc(u.phone || '—')}</dd></dl>
      <form method="post" action="/perfil" class="form" style="margin-top:1rem">
        ${field('Telefone', input('telefone', u.phone || '', { type: 'tel', placeholder: '(11) 99999-9999' }))}
        <div><button class="btn btn-secondary" type="submit">Salvar telefone</button></div>
      </form>`
    )}${card(
      'Alterar senha',
      `<form method="post" action="/perfil/senha" class="form">
        ${field('Senha atual', input('atual', '', { type: 'password', required: true }))}
        ${field('Nova senha', input('nova', '', { type: 'password', required: true }), 'Mínimo de 6 caracteres.')}
        ${field('Confirmar nova senha', input('confirmar', '', { type: 'password', required: true }))}
        <div><button class="btn" type="submit">Alterar senha</button></div>
      </form>`
    )}</div>`;
    ctx.render('Meu perfil', body);
  });

  router.post('/perfil', requireLogin, (ctx) => {
    db.get().prepare('UPDATE users SET phone = ? WHERE id = ?').run(String(ctx.body.telefone || '').trim() || null, ctx.user.id);
    ctx.setFlash('success', 'Telefone atualizado.');
    ctx.redirect('/perfil');
  });

  router.post('/perfil/senha', requireLogin, (ctx) => {
    const row = db.get().prepare('SELECT password_hash FROM users WHERE id = ?').get(ctx.user.id);
    if (!auth.verifyPassword(ctx.body.atual, row.password_hash)) {
      ctx.setFlash('error', 'Senha atual incorreta.');
      return ctx.redirect('/perfil');
    }
    const nova = String(ctx.body.nova || '');
    if (nova.length < 6) {
      ctx.setFlash('error', 'A nova senha deve ter pelo menos 6 caracteres.');
      return ctx.redirect('/perfil');
    }
    if (nova !== ctx.body.confirmar) {
      ctx.setFlash('error', 'A confirmação não confere com a nova senha.');
      return ctx.redirect('/perfil');
    }
    db.get().prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(auth.hashPassword(nova), ctx.user.id);
    audit.log(ctx.user.id, 'SENHA_ALTERADA', 'user', ctx.user.id);
    ctx.setFlash('success', 'Senha alterada com sucesso.');
    ctx.redirect(HOME[ctx.user.role]);
  });
};

module.exports.requireLogin = requireLogin;
module.exports.requireRole = requireRole;
module.exports.HOME = HOME;
