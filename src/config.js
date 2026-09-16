'use strict';

// Configurações da escola. Os horários seguem a grade informada pela escola:
// manhã 9h–11h40 e tarde 13h30–16h10, aulas de 40 minutos.
const LESSON_MINUTES = 40;

const PERIODS = [
  { key: 'MANHA', label: 'Manhã', start: '09:00', end: '11:40' },
  { key: 'TARDE', label: 'Tarde', start: '13:30', end: '16:10' },
];

// Dias letivos (1 = segunda ... 6 = sábado). A escola funciona de segunda a sexta.
const WEEKDAYS = [1, 2, 3, 4, 5];

const WEEKDAY_NAMES = {
  0: 'Domingo',
  1: 'Segunda-feira',
  2: 'Terça-feira',
  3: 'Quarta-feira',
  4: 'Quinta-feira',
  5: 'Sexta-feira',
  6: 'Sábado',
};

const WEEKDAY_SHORT = { 0: 'Dom', 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sáb' };

// Quantidade máxima de alunos por aula em grupo (pode ser ajustada pela gestão).
const DEFAULT_MAX_GROUP_SIZE = 4;

const INSTRUMENTS = [
  'Violão',
  'Violino',
  'Viola',
  'Violoncelo',
  'Flauta',
  'Clarinete',
  'Saxofone',
  'Trompete',
  'Piano / Teclado',
  'Percussão',
  'Canto / Coral',
  'Musicalização infantil',
  'Teoria musical',
];

const ROLES = {
  GESTAO: 'GESTAO',
  PROFESSOR: 'PROFESSOR',
  RESPONSAVEL: 'RESPONSAVEL',
};

const ROLE_LABELS = {
  GESTAO: 'Gestão',
  PROFESSOR: 'Professor(a)',
  RESPONSAVEL: 'Responsável',
};

module.exports = {
  LESSON_MINUTES,
  PERIODS,
  WEEKDAYS,
  WEEKDAY_NAMES,
  WEEKDAY_SHORT,
  DEFAULT_MAX_GROUP_SIZE,
  INSTRUMENTS,
  ROLES,
  ROLE_LABELS,
  SCHOOL_NAME: process.env.SCHOOL_NAME || 'Orquestra Cidadã',
  PORT: Number(process.env.PORT || 3000),
  DATABASE_PATH: process.env.DATABASE_PATH || './data/escola.db',
  SESSION_SECRET: process.env.SESSION_SECRET || 'dev-secret-troque-em-producao',
  SESSION_DAYS: 14,
};
