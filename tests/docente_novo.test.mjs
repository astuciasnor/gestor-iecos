// Docente novo (Docente Temporario: Substituto, Visitante), fora do dados_app.json.
// O choque de horario depende so do nome escrito nas alocacoes: o mesmo nome
// (ignorando maiusculas e acentos) junta as aulas do docente; uma abreviacao nao.
// Por isso o Cardume pede para conferir o nome completo antes de salvar.
import test from 'node:test';
import assert from 'node:assert/strict';

import { detectTeacherConflicts } from '../js/conflicts.js';
import { findNewNames, findSimilarNames, problemaNoNome, UNIDADES, VINCULOS_TEMPORARIOS } from '../js/docente_nomes.mjs';

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

// ---- Regras do aviso e da janela "Cadastrar Docente Temporario" ----
const LISTA = ['Thiago Tomé Ferreira', 'Ana Beatriz Cardoso Lima', 'Evaldo Martins da Silva'];

test('nome novo: ignora maiusculas, acentos, espacos e "A definir"', () => {
  assert.deepEqual(findNewNames(['evaldo martins da silva', '  Ana  Beatriz Cardoso Lima ', 'A definir', ''], LISTA), []);
  assert.deepEqual(findNewNames(['Thiago Tomé', 'thiago tome'], LISTA), ['Thiago Tomé']);
});

test('nome parecido aponta a mesma pessoa provavel', () => {
  assert.deepEqual(findSimilarNames('Thiago Tomé', LISTA), ['Thiago Tomé Ferreira']);
  assert.deepEqual(findSimilarNames('Ana B. Lima', LISTA), ['Ana Beatriz Cardoso Lima']);
  assert.deepEqual(findSimilarNames('Ana Lima', LISTA), ['Ana Beatriz Cardoso Lima']);
  assert.deepEqual(findSimilarNames('Carlos Souza', LISTA), []);
  assert.deepEqual(findSimilarNames('Thiago', LISTA), []);
});

test('abreviacao, titulo ou nome sem sobrenome nao passam', () => {
  assert.equal(problemaNoNome('Thiago Tomé Ferreira'), '');
  assert.equal(problemaNoNome('Maria e Silva'), '');
  assert.match(problemaNoNome('Thiago'), /sobrenome/);
  assert.match(problemaNoNome('Ana B. Lima'), /abrevia/);
  assert.match(problemaNoNome('Ana B Lima'), /abrevia/);
  assert.match(problemaNoNome('Prof. João Silva'), /título/);
  assert.match(problemaNoNome('Dra Maria Souza'), /título/);
});

test('so Substituto e Visitante; subunidades por unidade', () => {
  assert.deepEqual(VINCULOS_TEMPORARIOS, ['Substituto', 'Visitante']);
  const porSigla = Object.fromEntries(UNIDADES.map((u) => [u.sigla, u.subunidades]));
  assert.deepEqual(porSigla.IECOS, ['FEPESCA', 'FACIN', 'FBIO']);
  assert.deepEqual(porSigla.CBRAG, ['FACED', 'FAHIST', 'FAMAT', 'FALE', 'FALEST']);
});
