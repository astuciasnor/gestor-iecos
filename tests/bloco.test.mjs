// Bloco curricular (derivarBloco): turmas regulares em PL2/PL4 e turmas de
// periodos impares (ex.: EP2027C) em PL3/PL1.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { derivarBloco } from '../js/curso_turma_helpers.js';

// O helper importa store.js com ?v=...; usa a mesma URL para pegar a mesma instancia.
const helperSrc = fs.readFileSync(new URL('../js/curso_turma_helpers.js', import.meta.url), 'utf8');
const storeRef = helperSrc.match(/from '(\.\/store\.js[^']*)'/)[1];
const { store } = await import(new URL(storeRef.replace('./', '../js/'), import.meta.url));

store.rawData = {
  turmas: [
    { sigla: 'EP', ano: 2027, turno: 'Tarde', turma_id: 'EP2027', periodos: 'pares' },
    { sigla: 'EP', ano: 2027, turno: 'Manhã+Tarde', turma_id: 'EP2027C', periodos: 'impares' }
  ]
};

test('turma regular: bloco em PL2/PL4, vazio em PL1/PL3', () => {
  assert.equal(derivarBloco('EP2027', 'PL2', '2027-03-15'), 'BL1');
  assert.equal(derivarBloco('EP2027', 'PL4', '2027-08-23'), 'BL2');
  assert.equal(derivarBloco('EP2027', 'PL2', '2028-03-15'), 'BL3');
  assert.equal(derivarBloco('EP2027', 'PL3', '2027-06-28'), '');
});

test('turma de periodos impares: PL3 de entrada = BL1, depois PL1/PL3 alternados', () => {
  assert.equal(derivarBloco('EP2027C', 'PL3', '2027-06-28'), 'BL1');
  assert.equal(derivarBloco('EP2027C', 'PL1', '2028-01-03'), 'BL2');
  assert.equal(derivarBloco('EP2027C', 'PL3', '2028-06-26'), 'BL3');
  assert.equal(derivarBloco('EP2027C', 'PL1', '2029-01-08'), 'BL4');
});

test('turma de periodos impares: sem bloco em PL2/PL4 nem antes da entrada', () => {
  assert.equal(derivarBloco('EP2027C', 'PL2', '2027-03-15'), '');
  assert.equal(derivarBloco('EP2027C', 'PL4', '2027-08-23'), '');
  assert.equal(derivarBloco('EP2027C', 'PL1', '2027-01-04'), '');
});
