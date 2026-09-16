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
   O servidor liga e o navegador abre em http://localhost:3000.
4. Na primeira vez aparece a **Configuração inicial**: nome da escola, logo (opcional), seu nome,
   seu e-mail e senha de gestão. Marque "Incluir dados de exemplo" se quiser explorar com dados fictícios.
5. Depois, em **Configurações** (menu da gestão) você troca nome, logo e o máximo de alunos por aula;
   em **Meu perfil** (clique no seu nome) troca seu e-mail e senha; e pode remover os dados de exemplo.

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

Para começar do zero em produção, **não rode o seed**: ao abrir o sistema pela primeira vez sem usuários,
a tela de configuração inicial cria o acesso da gestão.

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
- Múltiplas escolas/unidades e configuração da grade de horários pela interface.

## Acesso pelo celular (professores e responsáveis)

Só **um** computador roda o sistema. Todo mundo acessa pelo navegador do celular, sem instalar nada.
Em **Configurações** a gestão vê o endereço para compartilhar e as instruções de "Adicionar à tela inicial",
que deixa um ícone com a logo da escola como se fosse um app.

- **Dentro da escola (mesma rede Wi-Fi):** deixe o computador ligado com o `iniciar` aberto e use o
  endereço `http://IP-do-computador:3000` mostrado na janela preta e em Configurações.
- **De qualquer lugar:** publique o sistema num servidor na internet. Ele é leve (sem dependências,
  banco SQLite em um arquivo), então roda em qualquer serviço que aceite Node.js 22 ou Docker.
  Há um `Dockerfile` pronto; monte um disco persistente em `/app/data` para o banco não se perder,
  defina `SESSION_SECRET` e use HTTPS (os serviços abaixo já fornecem).
  Opções simples: Render, Railway, Fly.io ou uma VPS pequena (Hetzner, DigitalOcean, Oracle Cloud gratuito).
