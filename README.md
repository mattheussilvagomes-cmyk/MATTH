# Escola de Música · plataforma de gestão

Aplicativo web para escolas de música de projetos sociais, com três áreas de acesso:
**gestão**, **professores** e **responsáveis**. Centraliza organização dos horários,
presença, avaliações, observações pedagógicas, comunicados, eventos e rematrícula.

Foi construído **sem nenhuma dependência externa**: basta o Node.js 22 (usa o SQLite
embutido do Node). Isso torna a hospedagem barata e simples, ideal para projetos sociais.

## Como rodar (jeito fácil)

1. Instale o Node.js LTS em https://nodejs.org (uma vez só).
2. Baixe e descompacte esta pasta.
3. Dê dois cliques em **`iniciar.bat`** (Windows) ou **`iniciar.command`** (Mac).
   O sistema cria os dados de demonstração, liga o servidor e abre o navegador em http://localhost:3000.
   Para desligar, feche a janela preta que abriu.

## Como rodar (terminal)

```bash
# 1. Requisito: Node.js 22.13 ou mais novo (node -v)
# 2. Crie dados de demonstração (opcional)
npm run seed
# 3. Inicie o servidor
npm start
# → http://localhost:3000
```

Contas de demonstração (senha `123456` para todas):

| Perfil      | E-mail                                              |
| ----------- | --------------------------------------------------- |
| Gestão      | gestao@escola.org                                   |
| Professores | ana@escola.org, bruno@escola.org, celia@escola.org  |
| Responsáveis| carla@familia.com, daniel@familia.com, elaine@familia.com, fabio@familia.com, gilda@familia.com |

Para começar do zero em produção, **não rode o seed**. Crie o primeiro usuário de gestão com:

```bash
node --no-warnings=ExperimentalWarning -e "
const db=require('./src/db');const auth=require('./src/auth');
db.get().prepare('INSERT INTO users(name,email,password_hash,role) VALUES (?,?,?,?)')
  .run('Nome da Gestão','gestao@suaescola.org',auth.hashPassword('senha-inicial'),'GESTAO');
console.log('ok')"
```

Configurações por variáveis de ambiente (veja `.env.example`): `PORT`, `DATABASE_PATH`,
`SESSION_SECRET` (troque em produção) e `SCHOOL_NAME`.

Outros comandos:

```bash
npm run dev            # reinicia automaticamente ao alterar arquivos
npm run seed -- --reset  # apaga o banco e recria os dados de demonstração
npm test               # testes automatizados (regras de horário, presença, rematrícula, permissões)
```

## O que cada perfil faz

### Professor(a)
- Vê **somente os próprios alunos** (vinculados pela gestão).
- **Agenda semanal** com a grade fixa da escola: manhã 9h00–11h40 e tarde 13h30–16h10, aulas de 40 min
  (9:00, 9:40, 10:20, 11:00 · 13:30, 14:10, 14:50, 15:30), de segunda a sexta.
- Clica num horário e escolhe os alunos da aula. Pode ser **aula em grupo** (até 4 alunos, ajustável pela
  gestão) ou **aula individual** para alunos com mais dificuldade. Um aluno marcado como "precisa de aula
  individual" não pode ser colocado em grupo, e nenhum aluno pode estar em duas aulas no mesmo horário.
- Ao salvar ou alterar uma aula, os **responsáveis são notificados automaticamente** com o horário.
- **Registra presença** (presente / falta / falta justificada) por aula e por data. Faltas notificam os responsáveis.
- **Lança avaliações** (título, nota opcional de 0 a 10, comentário) e **observações** sobre o desenvolvimento
  (podem ser internas, invisíveis ao responsável).
- Envia **comunicados** para os responsáveis de todos os seus alunos ou de um aluno específico.

### Responsável
- Vê apenas os próprios dependentes: horário, presenças e faltas, notas, observações, histórico completo.
- Recebe **notificações** (sininho no topo) de nova falta, avaliação, observação, comunicado, evento,
  alteração de horário e abertura de rematrícula.
- Lê comunicados da escola e dos professores, e a agenda de eventos.
- Faz a **rematrícula pelo aplicativo**: confirma a permanência, atualiza dados cadastrais, confirma o
  instrumento, mantém ou pede alteração de horário, aceita os termos e finaliza.

### Gestão
- **Visão geral**: totais, vagas livres, faltas recentes, andamento da rematrícula e últimas alterações.
- **Agenda geral**: ocupação por dia/horário de todos os professores, com alunos por horário e vagas
  disponíveis; ou a grade de um professor, editável em nome dele.
- Cadastro de **alunos** (professor responsável, instrumento, atendimento individual, situação) e
  vínculo com responsáveis.
- Cadastro de **usuários** (professores, responsáveis, gestão) por e-mail, senha inicial, redefinição de senha
  e desativação de acesso.
- Relatórios de **presenças** e **avaliações** com filtros; pode excluir lançamentos incorretos.
- **Comunicados** para todos os responsáveis e/ou professores; **eventos** com notificação.
- **Rematrícula**: abre o período (termos, prazo), acompanha respostas, exporta CSV.
- **Alterações**: trilha de auditoria de tudo que professores e gestão fizeram na plataforma.
- Pode abrir a área de qualquer professor ("agir em nome de") para ver e corrigir horários, presenças,
  avaliações e observações; essas ações ficam registradas como feitas pela gestão.

## Estrutura do código

```
src/
  server.js          servidor HTTP e tratamento de erros
  config.js          horários da escola, dias letivos, instrumentos, perfis
  db.js              esquema SQLite (criado automaticamente) e configurações
  auth.js            senhas (scrypt) e sessões por cookie
  http.js            roteador, formulários, cookies, proteção de origem (CSRF)
  audit.js           trilha de alterações
  notify.js          notificações internas
  services/          regras de negócio (horários, aulas, presença, alunos, rematrícula)
  routes/            páginas por perfil: common, professor, responsavel, gestao
  views/             layout e componentes HTML
  seed.js            dados de demonstração
public/              CSS e JavaScript do navegador
test/                testes (node --test)
data/                banco de dados SQLite (ignorado pelo git)
```

## Segurança e privacidade
- Senhas armazenadas com scrypt e sal; sessões em cookie `HttpOnly` assinado.
- Cada rota verifica o perfil e o vínculo (professor ↔ aluno, responsável ↔ dependente).
- Formulários só são aceitos vindos da própria aplicação (verificação de origem + `SameSite`).
- Em produção use HTTPS (por exemplo, atrás de um proxy como Caddy ou Nginx) e defina `SESSION_SECRET`.

## Próximos passos sugeridos
- Envio de e-mail ou WhatsApp junto às notificações internas.
- Recuperação de senha por e-mail.
- Múltiplas escolas/unidades e configuração de horários pela interface.
