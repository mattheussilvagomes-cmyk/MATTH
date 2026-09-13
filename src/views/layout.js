'use strict';

const config = require('../config');
const { esc, attr, flashHtml } = require('./ui');

const NAV = {
  GESTAO: [
    ['/gestao', 'Visão geral'],
    ['/gestao/agenda', 'Agenda geral'],
    ['/gestao/alunos', 'Alunos'],
    ['/gestao/usuarios', 'Professores e usuários'],
    ['/gestao/presencas', 'Presenças'],
    ['/gestao/avaliacoes', 'Avaliações'],
    ['/gestao/comunicados', 'Comunicados'],
    ['/gestao/eventos', 'Eventos'],
    ['/gestao/rematricula', 'Rematrícula'],
    ['/gestao/auditoria', 'Alterações'],
  ],
  PROFESSOR: [
    ['/professor', 'Início'],
    ['/professor/agenda', 'Minha agenda'],
    ['/professor/alunos', 'Meus alunos'],
    ['/professor/presenca', 'Presença'],
    ['/professor/comunicados', 'Comunicados'],
  ],
  RESPONSAVEL: [
    ['/responsavel', 'Meus dependentes'],
    ['/responsavel/comunicados', 'Comunicados'],
    ['/responsavel/eventos', 'Eventos'],
    ['/responsavel/rematricula', 'Rematrícula'],
  ],
};

function page({ title, user, path = '', flash, unread = 0, body, actingAs = null }) {
  const nav = user ? NAV[user.role] || [] : [];
  const navHtml = nav
    .map(([href, label]) => {
      const active = path === href || (href !== '/gestao' && href !== '/professor' && href !== '/responsavel' && path.startsWith(href));
      return `<a href="${attr(href)}" class="nav-link${active ? ' active' : ''}">${esc(label)}</a>`;
    })
    .join('');
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title ? `${title} · ${config.SCHOOL_NAME}` : config.SCHOOL_NAME)}</title>
<link rel="stylesheet" href="/public/style.css">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%8E%B5%3C/text%3E%3C/svg%3E">
</head>
<body>
<header class="topbar">
  <a href="/" class="brand">🎵 ${esc(config.SCHOOL_NAME)}</a>
  ${
    user
      ? `<button class="nav-toggle" type="button" aria-label="Menu" data-nav-toggle>☰</button>
  <nav class="nav" data-nav>${navHtml}</nav>
  <div class="topbar-right">
    <a href="/notificacoes" class="bell" title="Notificações">🔔${unread ? `<span class="bell-count">${unread}</span>` : ''}</a>
    <a href="/perfil" class="user-chip"><span class="user-name">${esc(user.name)}</span><span class="user-role">${esc(config.ROLE_LABELS[user.role] || user.role)}</span></a>
    <form method="post" action="/logout" class="inline"><button class="btn btn-ghost" type="submit">Sair</button></form>
  </div>`
      : ''
  }
</header>
${
  actingAs
    ? `<div class="acting-as">Você está vendo e editando como a gestão em nome de <strong>${esc(actingAs.name)}</strong>. <a href="/gestao/usuarios/${actingAs.id}">Voltar ao cadastro</a></div>`
    : ''
}
<main class="container">
${flashHtml(flash)}
${body}
</main>
<footer class="footer">${esc(config.SCHOOL_NAME)} · plataforma de gestão escolar</footer>
<script src="/public/app.js" defer></script>
</body>
</html>`;
}

module.exports = { page, NAV };
