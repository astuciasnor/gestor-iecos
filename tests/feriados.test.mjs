// Feriado comum x bloqueio por turma (ex.: Recepcao Calouros).
import assert from 'node:assert/strict';
import test from 'node:test';
import { datasFeriadoDaTurma, feriadoValeParaTurma, feriadosDaTurma } from '../js/feriados.mjs';

const lista = [
  { data: '2027-02-08', feriado: 'Carnaval' },
  '2027-04-21',
  { data: '2027-03-15', feriado: 'Recepção Calouros', turmas: ['EP2027', 'CB2027'] }
];

test('feriado sem turmas vale para todas, como antes', () => {
  assert.equal(feriadoValeParaTurma(lista[0], 'EP2026'), true);
  assert.equal(feriadoValeParaTurma(lista[1], 'EP2026'), true);
  assert.equal(feriadoValeParaTurma(lista[0], ''), true);
});

test('bloqueio por turma vale so para as turmas listadas', () => {
  assert.equal(feriadoValeParaTurma(lista[2], 'EP2027'), true);
  assert.equal(feriadoValeParaTurma(lista[2], 'CB2027'), true);
  assert.equal(feriadoValeParaTurma(lista[2], 'EP2027C'), false);
  assert.equal(feriadoValeParaTurma(lista[2], 'CN2026'), false);
});

test('tela sem turma (agenda geral) ve so os feriados comuns', () => {
  assert.deepEqual([...datasFeriadoDaTurma(lista, '')], ['2027-02-08', '2027-04-21']);
});

test('turma do bloqueio ve os comuns + o bloqueio; outra turma nao', () => {
  assert.deepEqual([...datasFeriadoDaTurma(lista, 'EP2027')], ['2027-02-08', '2027-04-21', '2027-03-15']);
  assert.equal(feriadosDaTurma(lista, 'EP2026').length, 2);
});

test('lista vazia ou ausente nao quebra', () => {
  assert.equal(datasFeriadoDaTurma(undefined, 'EP2027').size, 0);
  assert.equal(datasFeriadoDaTurma([], '').size, 0);
});
