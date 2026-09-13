'use strict';

/**
 * Popula o banco com dados de demonstração: gestão, professores, responsáveis,
 * alunos, horários, presenças, avaliações e comunicados.
 *
 *   npm run seed            → cria os dados se o banco estiver vazio
 *   npm run seed -- --reset → apaga o banco e recria tudo
 */
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

const reset = process.argv.includes('--reset');
if (reset && config.DATABASE_PATH !== ':memory:') {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const f = path.resolve(config.DATABASE_PATH + suffix);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

const db = require('./db');
const auth = require('./auth');
const lessons = require('./services/lessons');
const attendance = require('./services/attendance');
const reenrollment = require('./services/reenrollment');

function seed(database = db.get()) {
  const d = database;
  const count = d.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) {
    console.log('Banco já possui usuários; nada foi alterado. Use --reset para recriar.');
    return;
  }
  const PASS = auth.hashPassword('123456');
  const insUser = d.prepare('INSERT INTO users(name, email, password_hash, role, phone, instruments) VALUES (?, ?, ?, ?, ?, ?)');
  const uid = (name, email, role, phone, instruments) => Number(insUser.run(name, email, PASS, role, phone || null, instruments || null).lastInsertRowid);

  const gestao = uid('Marina Souza', 'gestao@escola.org', 'GESTAO', '(11) 99999-0001');
  const ana = uid('Ana Ribeiro', 'ana@escola.org', 'PROFESSOR', '(11) 99999-0002', 'Violão, Teoria musical');
  const bruno = uid('Bruno Lima', 'bruno@escola.org', 'PROFESSOR', '(11) 99999-0003', 'Violino, Viola');
  const celia = uid('Célia Martins', 'celia@escola.org', 'PROFESSOR', '(11) 99999-0004', 'Flauta, Musicalização infantil');

  const carla = uid('Carla Nogueira', 'carla@familia.com', 'RESPONSAVEL', '(11) 98888-0001');
  const daniel = uid('Daniel Ferreira', 'daniel@familia.com', 'RESPONSAVEL', '(11) 98888-0002');
  const elaine = uid('Elaine Costa', 'elaine@familia.com', 'RESPONSAVEL', '(11) 98888-0003');
  const fabio = uid('Fábio Santos', 'fabio@familia.com', 'RESPONSAVEL', '(11) 98888-0004');
  const gilda = uid('Gilda Pereira', 'gilda@familia.com', 'RESPONSAVEL', '(11) 98888-0005');

  const insStudent = d.prepare('INSERT INTO students(name, birth_date, instrument, teacher_id, individual_only, notes, enrolled_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const sid = (name, birth, instrument, teacher, individual, notes) => Number(insStudent.run(name, birth, instrument, teacher, individual ? 1 : 0, notes || null, '2025-02-10').lastInsertRowid);
  const link = d.prepare('INSERT INTO student_guardians(student_id, guardian_id, relationship) VALUES (?, ?, ?)');

  const lucas = sid('Lucas Nogueira', '2014-03-12', 'Violão', ana, false);
  const julia = sid('Júlia Nogueira', '2016-08-25', 'Flauta', celia, false);
  link.run(lucas, carla, 'Mãe');
  link.run(julia, carla, 'Mãe');

  const pedro = sid('Pedro Ferreira', '2013-11-02', 'Violão', ana, false);
  link.run(pedro, daniel, 'Pai');

  const maria = sid('Maria Costa', '2012-05-19', 'Violino', bruno, true, 'Apresenta dificuldade de concentração em grupo; atendimento individual recomendado.');
  link.run(maria, elaine, 'Mãe');

  const rafael = sid('Rafael Santos', '2015-01-30', 'Violão', ana, false);
  const bia = sid('Beatriz Santos', '2011-09-14', 'Violino', bruno, false);
  link.run(rafael, fabio, 'Pai');
  link.run(bia, fabio, 'Pai');

  const gabriel = sid('Gabriel Pereira', '2014-07-07', 'Flauta', celia, false);
  const sofia = sid('Sofia Pereira', '2017-12-01', 'Musicalização infantil', celia, false);
  link.run(gabriel, gilda, 'Avó');
  link.run(sofia, gilda, 'Avó');

  const tiago = sid('Tiago Almeida', '2013-04-22', 'Violino', bruno, false);
  link.run(tiago, elaine, 'Tia');

  const actor = { id: gestao, name: 'Seed' };
  // Grade da Ana (violão): segunda 9h grupo, quarta 13h30 grupo
  lessons.saveLesson({ actor, teacherId: ana, weekday: 1, slotIndex: 0, individual: false, room: '1', studentIds: [lucas, pedro, rafael] });
  lessons.saveLesson({ actor, teacherId: ana, weekday: 3, slotIndex: 4, individual: false, room: '1', studentIds: [lucas, pedro] });
  lessons.saveLesson({ actor, teacherId: ana, weekday: 5, slotIndex: 1, individual: false, room: '1', studentIds: [rafael] });
  // Grade do Bruno (violino): Maria individual terça 10h20; Bia e Tiago grupo quinta 14h10
  lessons.saveLesson({ actor, teacherId: bruno, weekday: 2, slotIndex: 2, individual: true, room: '2', studentIds: [maria] });
  lessons.saveLesson({ actor, teacherId: bruno, weekday: 4, slotIndex: 5, individual: false, room: '2', studentIds: [bia, tiago] });
  // Grade da Célia (flauta / musicalização)
  lessons.saveLesson({ actor, teacherId: celia, weekday: 1, slotIndex: 5, individual: false, room: '3', studentIds: [julia, gabriel] });
  lessons.saveLesson({ actor, teacherId: celia, weekday: 3, slotIndex: 0, individual: false, room: '3', studentIds: [sofia] });

  // Presenças das últimas semanas
  const today = new Date();
  const dates = [];
  for (let i = 1; i <= 28; i++) {
    const dt = new Date(today);
    dt.setDate(today.getDate() - i);
    dates.push(attendance.isoDate(dt));
  }
  const all = lessons.allLessons();
  let k = 0;
  for (const date of dates) {
    const wd = attendance.weekdayOf(date);
    for (const l of all.filter((x) => x.weekday === wd)) {
      const entries = l.students.map((s) => {
        k += 1;
        const status = k % 9 === 0 ? 'FALTA' : k % 13 === 0 ? 'JUSTIFICADA' : 'PRESENTE';
        return { studentId: s.id, status, note: status === 'JUSTIFICADA' ? 'Consulta médica' : '' };
      });
      attendance.saveAttendance({ actor: { id: l.teacher_id }, teacherId: l.teacher_id, lesson: l, date, entries });
    }
  }

  // Avaliações e observações
  attendance.addEvaluation({ actor: { id: ana }, teacherId: ana, studentId: lucas, title: 'Acordes básicos (C, G, D, Em)', grade: 8.5, comment: 'Troca de acordes fluente. Trabalhar ritmo com palheta.', date: dates[10] });
  attendance.addEvaluation({ actor: { id: ana }, teacherId: ana, studentId: pedro, title: 'Acordes básicos (C, G, D, Em)', grade: 7, comment: 'Precisa praticar a pestana.', date: dates[10] });
  attendance.addEvaluation({ actor: { id: bruno }, teacherId: bruno, studentId: maria, title: 'Postura e arco', grade: 9, comment: 'Excelente evolução no controle do arco.', date: dates[6] });
  attendance.addEvaluation({ actor: { id: celia }, teacherId: celia, studentId: julia, title: 'Escala de Sol maior', grade: 8, comment: null, date: dates[4] });
  attendance.addObservation({ actor: { id: ana }, teacherId: ana, studentId: lucas, text: 'Lucas tem se dedicado bastante e já consegue tocar a primeira música completa. Sugiro 15 minutos de prática diária em casa.' });
  attendance.addObservation({ actor: { id: bruno }, teacherId: bruno, studentId: maria, text: 'Maria rende muito melhor na aula individual. Manter esse formato neste semestre.' });
  attendance.addObservation({ actor: { id: bruno }, teacherId: bruno, studentId: tiago, text: 'Conversar com a família sobre o instrumento emprestado (cordas precisam de troca).', visibleToGuardian: false });

  // Comunicados e eventos
  const insAnn = d.prepare('INSERT INTO announcements(author_id, title, body, scope, teacher_id) VALUES (?, ?, ?, ?, ?)');
  insAnn.run(gestao, 'Bem-vindos ao aplicativo da escola!', 'A partir de agora os horários, presenças, avaliações e comunicados ficam disponíveis aqui. Qualquer dúvida, procure a secretaria.', 'TODOS', null);
  insAnn.run(ana, 'Trazer o violão na próxima aula', 'Pessoal, na próxima aula vamos afinar os instrumentos juntos. Quem tiver violão em casa, por favor, traga.', 'MEUS_ALUNOS', ana);
  const insEvent = d.prepare('INSERT INTO events(title, description, starts_at, location, created_by) VALUES (?, ?, ?, ?, ?)');
  const ev = new Date(today);
  ev.setDate(today.getDate() + 20);
  insEvent.run('Recital de fim de semestre', 'Apresentação de todos os alunos para as famílias. Chegar com 30 minutos de antecedência.', attendance.isoDate(ev) + 'T19:00', 'Auditório da escola', gestao);
  const ev2 = new Date(today);
  ev2.setDate(today.getDate() + 6);
  insEvent.run('Reunião de responsáveis', 'Conversa sobre o próximo semestre e o processo de rematrícula pelo aplicativo.', attendance.isoDate(ev2) + 'T18:30', 'Sala 1', gestao);

  // Período de rematrícula aberto
  const closes = new Date(today);
  closes.setDate(today.getDate() + 30);
  reenrollment.openPeriod({
    actor,
    name: `Rematrícula ${today.getFullYear() + 1}`,
    year: today.getFullYear() + 1,
    opensAt: attendance.isoDate(today),
    closesAt: attendance.isoDate(closes),
    terms: 'Ao confirmar a rematrícula, o responsável declara estar ciente de que:\n1. As aulas acontecem nos horários definidos pela escola, com duração de 40 minutos.\n2. Faltas devem ser comunicadas com antecedência.\n3. O aluno deve zelar pelos instrumentos e materiais da escola.\n4. A escola poderá utilizar imagens do aluno em apresentações e divulgação do projeto social.',
  });

  // Limpa notificações geradas pelo seed para os responsáveis, deixando só algumas recentes.
  d.exec('DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY id DESC LIMIT 40)');
  db.setSetting('demo_mode', '1');

  console.log('Dados de demonstração criados. Senha de todos os usuários: 123456');
  console.log('  Gestão:       gestao@escola.org');
  console.log('  Professores:  ana@escola.org, bruno@escola.org, celia@escola.org');
  console.log('  Responsáveis: carla@familia.com, daniel@familia.com, elaine@familia.com, fabio@familia.com, gilda@familia.com');
}

if (require.main === module) seed();

module.exports = { seed };
