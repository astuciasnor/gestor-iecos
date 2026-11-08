import test from 'node:test';
import assert from 'node:assert/strict';
import {
  numeroDaSubturma,
  isTurmaInteira,
  codigoDaSubturma,
  proximaSubturma,
  codigoT01Como
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

test('codigo com e sem bloco', () => {
  assert.equal(codigoDaSubturma(2, 'BL1'), 'BL1_T02');
  assert.equal(codigoDaSubturma(3, ''), 'T03');
});

test('primeira oferta: nao ha subturma', () => {
  assert.equal(proximaSubturma([], 'BL1'), null);
});

test('segunda oferta vira T02 (a primeira conta como T01)', () => {
  assert.deepEqual(proximaSubturma([null], 'BL1'), { numero: 2, rotulo: 'T02', codigo: 'BL1_T02' });
  assert.deepEqual(proximaSubturma(['BL1'], ''), { numero: 2, rotulo: 'T02', codigo: 'T02' });
});

test('terceira oferta segue a numeracao, mesmo com formatos antigos', () => {
  assert.equal(proximaSubturma(['BL1_T01', 'BL1_T02'], 'BL1').codigo, 'BL1_T03');
  assert.equal(proximaSubturma([null, 'T2'], '').codigo, 'T03');
  assert.equal(proximaSubturma(['T01', 'T05'], '').codigo, 'T06');
});

test('T01 no mesmo formato da subturma salva', () => {
  assert.equal(codigoT01Como('BL1_T02'), 'BL1_T01');
  assert.equal(codigoT01Como('T02'), 'T01');
  assert.equal(codigoT01Como('T2'), 'T01');
});
