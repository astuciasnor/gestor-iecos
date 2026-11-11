import test from 'node:test';
import assert from 'node:assert/strict';
import {
  numeroDaSubturma,
  isTurmaInteira,
  codigoDaSubturma,
  proximaSubturma,
  codigoT01Como,
  saoSubturmasDiferentes
} from '../js/subturmas.mjs';

test('numero da subturma em varios formatos', () => {
  assert.equal(numeroDaSubturma('BL1_T02'), 2);
  assert.equal(numeroDaSubturma('T02'), 2);
  assert.equal(numeroDaSubturma('T2'), 2);
  assert.equal(numeroDaSubturma('t10'), 10);
  assert.equal(numeroDaSubturma('BL1'), null);
  assert.equal(numeroDaSubturma(null), null);
  assert.equal(numeroDaSubturma(''), null);
});

test('turma inteira: vazio ou so o bloco', () => {
  assert.equal(isTurmaInteira(null), true);
  assert.equal(isTurmaInteira('BL6'), true);
  assert.equal(isTurmaInteira('BL1_T01'), false);
  assert.equal(isTurmaInteira('T02'), false);
});

test('codigo e so T + dois digitos', () => {
  assert.equal(codigoDaSubturma(2), 'T02');
  assert.equal(codigoDaSubturma(12), 'T12');
});

test('primeira oferta: nao ha subturma', () => {
  assert.equal(proximaSubturma([]), null);
});

test('segunda oferta vira T02 (a primeira conta como T01)', () => {
  assert.deepEqual(proximaSubturma([null]), { numero: 2, rotulo: 'T02', codigo: 'T02' });
  assert.deepEqual(proximaSubturma(['BL1']), { numero: 2, rotulo: 'T02', codigo: 'T02' });
});

test('terceira oferta segue a numeracao, mesmo com formatos antigos', () => {
  assert.equal(proximaSubturma(['BL1_T01', 'BL1_T02']).codigo, 'T03');
  assert.equal(proximaSubturma([null, 'T2']).codigo, 'T03');
  assert.equal(proximaSubturma(['T01', 'T02', 'T03']).codigo, 'T04');
});

test('usa a vaga livre: sobrou so a T02, a nova e a T01', () => {
  assert.equal(proximaSubturma(['T02']).codigo, 'T01');
  assert.equal(proximaSubturma(['T2']).codigo, 'T01');
  assert.equal(proximaSubturma(['T01', 'T03']).codigo, 'T02');
});

test('T01 no mesmo formato da subturma salva', () => {
  assert.equal(codigoT01Como('BL1_T02'), 'BL1_T01');
  assert.equal(codigoT01Como('T02'), 'T01');
  assert.equal(codigoT01Como('T2'), 'T01');
});

test('subturmas diferentes: so T01 x T02; turma inteira nunca', () => {
  assert.equal(saoSubturmasDiferentes('T01', 'T02'), true);
  assert.equal(saoSubturmasDiferentes('BL1_T02', 'T02'), false);
  assert.equal(saoSubturmasDiferentes('T2', 'T02'), false);
  assert.equal(saoSubturmasDiferentes('BL9', 'T02'), false);
  assert.equal(saoSubturmasDiferentes('', 'T01'), false);
  assert.equal(saoSubturmasDiferentes(null, null), false);
});
