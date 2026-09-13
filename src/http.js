'use strict';

const { URL } = require('node:url');
const querystring = require('node:querystring');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'Corpo da requisição muito grande'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function parseForm(req) {
  const type = req.headers['content-type'] || '';
  const raw = await readBody(req);
  if (type.includes('application/json')) {
    try {
      return JSON.parse(raw || '{}');
    } catch {
      throw new HttpError(400, 'JSON inválido');
    }
  }
  const parsed = querystring.parse(raw);
  const out = {};
  for (const [k, v] of Object.entries(parsed)) {
    // Campos repetidos (ex.: checkboxes "alunos") viram arrays.
    out[k] = Array.isArray(v) ? v : v;
  }
  return out;
}

function asArray(v) {
  if (v === undefined || v === null || v === '') return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Roteador minimalista com parâmetros de caminho (":id").
 */
class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, ...handlers) {
    const keys = [];
    const regex = new RegExp(
      '^' +
        pattern
          .replace(/\//g, '\\/')
          .replace(/:(\w+)/g, (_, k) => {
            keys.push(k);
            return '([^\\/]+)';
          }) +
        '\\/?$'
    );
    this.routes.push({ method, regex, keys, handlers });
    return this;
  }

  get(pattern, ...handlers) {
    return this.add('GET', pattern, ...handlers);
  }

  post(pattern, ...handlers) {
    return this.add('POST', pattern, ...handlers);
  }

  match(method, pathname) {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const m = route.regex.exec(pathname);
      if (!m) continue;
      const params = {};
      route.keys.forEach((k, i) => {
        params[k] = decodeURIComponent(m[i + 1]);
      });
      return { route, params };
    }
    return null;
  }
}

function buildContext(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const query = {};
  for (const [k, v] of url.searchParams.entries()) query[k] = v;
  const ctx = {
    req,
    res,
    url,
    path: url.pathname,
    query,
    cookies: parseCookies(req.headers.cookie),
    params: {},
    body: {},
    user: null,
    setCookies: [],
    flash: null,
  };

  ctx.html = (status, body, headers = {}) => {
    res.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      ...(ctx.setCookies.length ? { 'Set-Cookie': ctx.setCookies } : {}),
      ...headers,
    });
    res.end(body);
  };

  ctx.json = (status, data) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      ...(ctx.setCookies.length ? { 'Set-Cookie': ctx.setCookies } : {}),
    });
    res.end(JSON.stringify(data));
  };

  ctx.text = (status, body, contentType = 'text/plain; charset=utf-8', headers = {}) => {
    res.writeHead(status, { 'Content-Type': contentType, ...headers });
    res.end(body);
  };

  ctx.redirect = (location, status = 303) => {
    res.writeHead(status, {
      Location: location,
      ...(ctx.setCookies.length ? { 'Set-Cookie': ctx.setCookies } : {}),
    });
    res.end();
  };

  ctx.setCookie = (name, value, opts = {}) => {
    const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
    if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
    if (opts.secure) parts.push('Secure');
    ctx.setCookies.push(parts.join('; '));
  };

  ctx.setFlash = (type, message) => {
    ctx.setCookie('flash', JSON.stringify({ type, message }), { maxAge: 60 });
  };

  ctx.clearFlash = () => {
    ctx.setCookie('flash', '', { maxAge: 0 });
  };

  if (ctx.cookies.flash) {
    try {
      ctx.flash = JSON.parse(ctx.cookies.flash);
    } catch {
      ctx.flash = null;
    }
    ctx.clearFlash();
  }

  return ctx;
}

/** Proteção simples contra CSRF: POST só é aceito se a origem for a própria aplicação. */
function checkSameOrigin(req) {
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return true; // clientes sem cabeçalho (ex.: curl) — cookie SameSite=Lax já protege navegadores
  try {
    const u = new URL(origin);
    return u.host === req.headers.host;
  } catch {
    return false;
  }
}

module.exports = { HttpError, Router, buildContext, parseForm, readBody, asArray, checkSameOrigin, parseCookies };
