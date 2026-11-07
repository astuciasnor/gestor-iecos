// O mesmo nome de componente existe em varios cursos com codigo, CH e cor
// diferentes. Codigo, CH e cor vem do curso da TURMA, nao do curso aberto na
// barra lateral (caso real: Rosigleyse, DIDATICA em CB2027 mostrava CNBR004).
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { getDisciplinaInfo, getDisciplinaCHGlobal, getCursoSiglaDaTurma } from '../js/curso_turma_helpers.js';

// O helper importa store.js com ?v=...; usa a mesma URL para pegar a mesma instancia.
const helperSrc = fs.readFileSync(new URL('../js/curso_turma_helpers.js', import.meta.url), 'utf8');
const storeRef = helperSrc.match(/from '(\.\/store\.js[^']*)'/)[1];
const { store } = await import(new URL(storeRef.replace('./', '../js/'), import.meta.url));

const DIDATICA = 'DIDATICA APLICADA A FORMACAO DOCENTE';
store.rawData = {
  cursos: [{ sigla: 'CB', curso: 'Ciencias Biologicas' }, { sigla: 'CN', curso: 'Ciencias Naturais' }],
  turmas: [
    { sigla: 'CB', turma_id: 'CB2027' },
    { sigla: 'CN', turma_id: 'CN2027' }
  ],
  componentes: [
    { sigla: 'CB', componente: DIDATICA, codigo: 'CBBR005', ch: 60, cor: '#111111' },
    { sigla: 'CN', componente: DIDATICA, codigo: 'CNBR004', ch: 45, cor: '#222222' }
  ]
};

test('codigo e CH seguem o curso da turma, qualquer que seja a barra lateral', () => {
  for (const barra of ['CN', 'CB', 'EP', '']) {
    store.selectedCurso = barra;
    assert.equal(getDisciplinaInfo(DIDATICA, 'CB2027').codigo, 'CBBR005', `barra=${barra}`);
    assert.equal(getDisciplinaInfo(DIDATICA, 'CN2027').codigo, 'CNBR004', `barra=${barra}`);
    assert.equal(getDisciplinaInfo(DIDATICA, 'CB2027').ch, 60);
    assert.equal(getDisciplinaCHGlobal(DIDATICA, 'CN2027'), 45);
  }
});

test('turma fora do cadastro: curso pelas letras do inicio do id', () => {
  assert.equal(getCursoSiglaDaTurma('CN2030'), 'CN');
  assert.equal(getCursoSiglaDaTurma('XX2030'), '');
  store.selectedCurso = 'CB';
  assert.equal(getDisciplinaInfo(DIDATICA, 'CN2030').codigo, 'CNBR004');
});

test('sem turma: usa o curso da barra lateral', () => {
  store.selectedCurso = 'CN';
  assert.equal(getDisciplinaInfo(DIDATICA).codigo, 'CNBR004');
  store.selectedCurso = 'CB';
  assert.equal(getDisciplinaInfo(DIDATICA).codigo, 'CBBR005');
});

test('cor segue o curso pedido', () => {
  store.selectedCurso = 'CB';
  assert.equal(store.getDisciplinaColor(DIDATICA, 'CN'), '#222222');
  assert.equal(store.getDisciplinaColor(DIDATICA), '#111111');
});
