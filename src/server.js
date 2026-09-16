'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const db = require('./db');
const auth = require('./auth');
const notify = require('./notify');
const { Router, buildContext, parseForm, HttpError, checkSameOrigin } = require('./http');
const { page } = require('./views/layout');
const { esc } = require('./views/ui');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = { '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function createRouter() {
  const router = new Router();
  require('./routes/common')(router);
  require('./routes/professor')(router);
  require('./routes/responsavel')(router);
  require('./routes/gestao')(router);
  return router;
}

function serveStatic(ctx) {
  const rel = ctx.path.replace(/^\/public\//, '');
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) throw new HttpError(404, 'Não encontrado');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) throw new HttpError(404, 'Não encontrado');
  const ext = path.extname(file);
  ctx.res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=300' });
  fs.createReadStream(file).pipe(ctx.res);
}

function renderError(ctx, status, message) {
  const body = `<div class="card"><div class="card-body"><h1>${status === 404 ? 'Página não encontrada' : status === 403 ? 'Acesso negado' : 'Ocorreu um erro'}</h1><p>${esc(
    message
  )}</p><p><a href="/" class="btn btn-secondary">Voltar ao início</a></p></div></div>`;
  ctx.html(status, page({ title: `Erro ${status}`, user: ctx.user, flash: null, body }));
}

function createServer() {
  const router = createRouter();

  return http.createServer(async (req, res) => {
    const ctx = buildContext(req, res);
    try {
      if (ctx.path.startsWith('/public/')) return serveStatic(ctx);
      if (ctx.path === '/manifest.webmanifest') {
        const name = db.schoolName();
        const hasLogo = !!db.getSetting('logo_type', null);
        const icon = hasLogo ? `/logo?v=${encodeURIComponent(db.getSetting('logo_version', '1'))}` : '/icone.svg';
        return ctx.text(200, JSON.stringify({
          name, short_name: name.length > 12 ? name.slice(0, 12) : name, start_url: '/', display: 'standalone',
          background_color: '#f4f6fb', theme_color: '#3b5bdb', lang: 'pt-BR',
          icons: [{ src: icon, sizes: 'any', type: hasLogo ? db.getSetting('logo_type') : 'image/svg+xml', purpose: 'any' }],
        }), 'application/manifest+json; charset=utf-8');
      }
      if (ctx.path === '/icone.svg') {
        return ctx.text(200, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#3b5bdb"/><text x="256" y="330" font-size="260" text-anchor="middle">🎵</text></svg>`, 'image/svg+xml', { 'Cache-Control': 'public, max-age=86400' });
      }
      if (ctx.path === '/logo') {
        const logo = db.logo();
        if (!logo) throw new HttpError(404, 'Sem logo');
        res.writeHead(200, { 'Content-Type': logo.type, 'Cache-Control': 'public, max-age=3600' });
        return res.end(logo.data);
      }
      // Primeiro uso: enquanto não existir nenhum usuário, só a tela de configuração inicial é acessível.
      if (!db.hasUsers() && ctx.path !== '/configurar') return ctx.redirect('/configurar');
      ctx.user = auth.userFromCookie(ctx.cookies.sessao);
      ctx.unread = ctx.user ? notify.unreadCount(ctx.user.id) : 0;
      ctx.render = (title, body, extra = {}) =>
        ctx.html(200, page({ title, user: ctx.user, path: ctx.path, flash: ctx.flash, unread: ctx.unread, body, ...extra }));

      const method = req.method === 'HEAD' ? 'GET' : req.method;
      const match = router.match(method, ctx.path);
      if (!match) throw new HttpError(404, 'A página que você procura não existe.');
      ctx.params = match.params;
      if (method === 'POST') {
        if (!checkSameOrigin(req)) throw new HttpError(403, 'Requisição bloqueada por segurança (origem inválida).');
        ctx.body = await parseForm(req);
      }
      for (const handler of match.route.handlers) {
        // Handlers podem ser middlewares: retornam true para continuar.
        const result = await handler(ctx);
        if (result !== true) break;
      }
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error(err);
      if (res.headersSent) return res.end();
      renderError(ctx, status, status >= 500 ? 'Erro interno. Tente novamente em instantes.' : err.message);
    }
  });
}

/** Endereços IP locais (para acessar de celulares na mesma rede). */
function localAddresses() {
  const os = require('node:os');
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}

function start() {
  db.get();
  auth.cleanupExpiredSessions();
  const server = createServer();
  server.listen(config.PORT, () => {
    console.log(`${db.schoolName()} — servidor ligado.`);
    console.log(`  Neste computador:            http://localhost:${config.PORT}`);
    for (const ip of localAddresses()) console.log(`  Celulares na mesma rede Wi-Fi: http://${ip}:${config.PORT}`);
  });
  return server;
}

if (require.main === module) start();

module.exports = { createServer, start, localAddresses };
