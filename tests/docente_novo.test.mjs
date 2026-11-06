// Docente novo (Docente Temporario: Substituto, Visitante), fora do dados_app.json.
// O choque de horario depende so do nome escrito nas alocacoes: o mesmo nome
// (ignorando maiusculas e acentos) junta as aulas do docente; uma abreviacao nao.
// Por isso o Cardume pede para conferir o nome completo antes de salvar.
import test from 'node:test';
import assert from 'node:assert/strict';

import { detectTeacherConflicts } from '../js/conflicts.js';

// store.js le o localStorage ao carregar; no Node ele nao existe.
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { allocationHasTeacherMatch, teacherNamesMatch } = await import('../js/allocation_helpers.js');

const NOVO = 'Ana Beatriz Cardoso Lima';

const alocacoes = [
  { turmaId: 'EP2025', disciplina: 'BIOLOGIA PESQUEIRA', docente: NOVO, horario: '08:00 - 08:50' },
  { turmaId: 'MT2026', disciplina: 'CALCULO I', docente: 'ana beatriz cardoso lima', horario: '08:00 - 08:50' },
  { turmaId: 'EP2027C', disciplina: 'ECOLOGIA', docente: 'A. B. Cardoso Lima', horario: '08:00 - 08:50' }
];

function choquesDe(nome) {
  const eventos = alocacoes.filter((a) => allocationHasTeacherMatch(a, nome));
  return detectTeacherConflicts({ eventsByDate: { '2027-03-01': eventos } });
}

test('docente novo com o mesmo nome em duas turmas gera choque', () => {
  const choques = choquesDe(NOVO);
  assert.equal(choques.length, 1);
  assert.deepEqual(choques[0].turmas, ['EP2025', 'MT2026']);
});

test('maiusculas e acentos nao atrapalham', () => {
  assert.equal(teacherNamesMatch('Ána Beatriz Cardoso Lima', NOVO), true);
  assert.equal(teacherNamesMatch('ANA BEATRIZ CARDOSO LIMA', NOVO), true);
});

test('nome abreviado vira outra pessoa e o choque escapa', () => {
  assert.equal(teacherNamesMatch('A. B. Cardoso Lima', NOVO), false);
  const turmas = choquesDe(NOVO).flatMap((c) => c.turmas);
  assert.equal(turmas.includes('EP2027C'), false);
});
