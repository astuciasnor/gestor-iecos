// ---------------------------------------------------------------------------
// TESTES DAS GUARDAS DE INVARIANTE DO weeklyState (js/weekly_state.js)
// ---------------------------------------------------------------------------
// weeklyState e um SINGLETON (export unico). Como os testes rodam no mesmo
// processo, cada teste RESTAURA o estado no inicio para ficar isolado.
// O modulo e neutro (nao importa nada) e o hook window.__weeklyStateDebug e
// guardado por `typeof window !== 'undefined'`, entao importa limpo no node.
// ---------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';

import { weeklyState } from '../js/weekly_state.js';

function restoreCleanState() {
  weeklyState.resetEditing();
  weeklyState.clearFaixasPatterns();
  weeklyState.view.weekStartISO = '';
  weeklyState.view.followActiveFaixa = true;
  weeklyState.setTrace(false);
}

test('estado limpo nao viola nenhum invariante', () => {
  restoreCleanState();
  assert.deepEqual(weeklyState.checkInvariants('teste'), []);
});

test('faixasPatterns com faixa nao-array e detectado', () => {
  restoreCleanState();
  weeklyState.faixasPatterns[2] = 'quebrado';
  const problems = weeklyState.checkInvariants('teste');
  assert.ok(problems.some((p) => p.includes('faixasPatterns[2]')));
  // limpa o estrago para nao vazar para outros testes
  weeklyState.clearFaixasPatterns();
});

test('faixasPatterns com chave inesperada e detectado', () => {
  restoreCleanState();
  weeklyState.faixasPatterns[4] = [];
  const problems = weeklyState.checkInvariants('teste');
  assert.ok(problems.some((p) => p.includes('chaves inesperadas')));
  delete weeklyState.faixasPatterns[4];
});

test('editingComponentOriginalStart sem IDs originais e detectado (desync)', () => {
  restoreCleanState();
  weeklyState.editingComponentOriginalStart = '2026-01-05';
  // editingOriginalAllocationIds continua vazio -> deve acusar
  const problems = weeklyState.checkInvariants('teste');
  assert.ok(problems.some((p) => p.includes('editingComponentOriginalStart')));
});

test('editingComponentOriginalStart COM IDs originais nao viola', () => {
  restoreCleanState();
  weeklyState.editingComponentOriginalStart = '2026-01-05';
  weeklyState.editingOriginalAllocationIds = ['id-1'];
  assert.deepEqual(weeklyState.checkInvariants('teste'), []);
});

test('weekStartISO invalido e detectado', () => {
  restoreCleanState();
  weeklyState.view.weekStartISO = '05/01/2026';
  const problems = weeklyState.checkInvariants('teste');
  assert.ok(problems.some((p) => p.includes('view.weekStartISO')));
});

test('editingImportadoDraft nao-boolean e detectado', () => {
  restoreCleanState();
  weeklyState.editingImportadoDraft = 'sim';
  const problems = weeklyState.checkInvariants('teste');
  assert.ok(problems.some((p) => p.includes('editingImportadoDraft')));
});

test('resetEditing zera os campos e mantem invariantes limpos', () => {
  restoreCleanState();
  weeklyState.editingDisciplinaDraft = 'ECOLOGIA';
  weeklyState.editingImportadoDraft = true;
  weeklyState.editingOriginalAllocationIds = ['a', 'b'];
  weeklyState.editingComponentOriginalStart = '2026-02-01';
  weeklyState.lastDisciplinaInputNormalized = 'ECOLOGIA';

  weeklyState.resetEditing();

  assert.equal(weeklyState.editingDisciplinaDraft, '');
  assert.equal(weeklyState.editingImportadoDraft, false);
  assert.deepEqual(weeklyState.editingOriginalAllocationIds, []);
  assert.equal(weeklyState.editingComponentOriginalStart, '');
  assert.equal(weeklyState.lastDisciplinaInputNormalized, '');
  assert.deepEqual(weeklyState.checkInvariants('teste'), []);
});

test('clearFaixasPatterns limpa as 3 faixas preservando o objeto', () => {
  restoreCleanState();
  const ref = weeklyState.faixasPatterns;
  weeklyState.faixasPatterns[1] = [{ dia: 1, slot: 'M1' }];
  weeklyState.faixasPatterns[2] = [{ dia: 2, slot: 'M2' }];

  weeklyState.clearFaixasPatterns();

  assert.deepEqual(weeklyState.faixasPatterns[1], []);
  assert.deepEqual(weeklyState.faixasPatterns[2], []);
  assert.deepEqual(weeklyState.faixasPatterns[3], []);
  // identidade do objeto preservada (alias em ui.js depende disso)
  assert.equal(weeklyState.faixasPatterns, ref);
});

test('snapshot resume faixasPatterns como contagem e copia arrays', () => {
  restoreCleanState();
  weeklyState.faixasPatterns[1] = [{ dia: 1, slot: 'M1' }, { dia: 2, slot: 'M1' }];
  weeklyState.editingOriginalAllocationIds = ['x'];

  const snap = weeklyState.snapshot();
  assert.equal(snap.faixasPatterns[1], 2);
  assert.equal(snap.faixasPatterns[2], 0);
  assert.deepEqual(snap.editingOriginalAllocationIds, ['x']);
  // a copia nao deve compartilhar a referencia do array original
  snap.editingOriginalAllocationIds.push('y');
  assert.deepEqual(weeklyState.editingOriginalAllocationIds, ['x']);

  restoreCleanState();
});

test('setTrace controla isTraceEnabled', () => {
  restoreCleanState();
  assert.equal(weeklyState.isTraceEnabled(), false);
  weeklyState.setTrace(true);
  assert.equal(weeklyState.isTraceEnabled(), true);
  weeklyState.setTrace(false);
  assert.equal(weeklyState.isTraceEnabled(), false);
});
