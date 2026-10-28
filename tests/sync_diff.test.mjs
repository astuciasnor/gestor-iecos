// ---------------------------------------------------------------------------
// TESTES DAS REGRAS DE SINCRONIZACAO (js/sync_diff.mjs)
// ---------------------------------------------------------------------------
// Cenario: coordenador de EP; turmas EP* editaveis, CB* somente leitura.
// ---------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  stableStringify,
  hashAllocation,
  getAllocationCurso,
  computePushPlan,
  reconcileAllocations,
  buildSyncedMap
} from '../js/sync_diff.mjs';

const cursoOf = (a) => getAllocationCurso(a, { EP2025: 'EP', CB2025: 'CB' });
const canEdit = (curso) => curso === 'EP';

const ep = (id, extra = {}) => ({ id, turmaId: 'EP2025', disciplina: 'Calculo', ...extra });
const cb = (id, extra = {}) => ({ id, turmaId: 'CB2025', disciplina: 'Zoologia', ...extra });

test('stableStringify ignora a ordem das chaves', () => {
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: 3 } }), stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  assert.equal(hashAllocation({ b: 1, a: 2 }), hashAllocation({ a: 2, b: 1 }));
  assert.notEqual(hashAllocation({ a: 1 }), hashAllocation({ a: 2 }));
});

test('curso vem do mapa de turmas, com prefixo como reserva', () => {
  assert.equal(cursoOf(ep('1')), 'EP');
  assert.equal(getAllocationCurso({ turmaId: 'MT2027' }, {}), 'MT');
});

test('push envia so o que mudou no curso editavel', () => {
  const remote = [ep('1'), ep('2'), cb('3')];
  const synced = buildSyncedMap(remote, cursoOf);
  const allocations = [ep('1'), ep('2', { docente: 'Novo' }), cb('3'), ep('4')];

  const plan = computePushPlan({ allocations, synced, canEdit, cursoOf });
  assert.deepEqual(plan.upserts.map((u) => u.alloc.id).sort(), ['2', '4']);
  assert.deepEqual(plan.deletes, []);
  assert.deepEqual(plan.blocked, []);
});

test('push apaga removidas do curso editavel e bloqueia as de outro curso', () => {
  const remote = [ep('1'), cb('2'), cb('3')];
  const synced = buildSyncedMap(remote, cursoOf);
  const allocations = [cb('2', { docente: 'Mexido' })];

  const plan = computePushPlan({ allocations, synced, canEdit, cursoOf });
  assert.deepEqual(plan.deletes, ['1']);
  assert.deepEqual(plan.upserts, []);
  assert.deepEqual(plan.blocked.map((b) => b.id).sort(), ['2', '3']);
});

test('push bloqueia mover alocacao de outro curso para o meu', () => {
  const synced = buildSyncedMap([cb('1')], cursoOf);
  const plan = computePushPlan({ allocations: [ep('1')], synced, canEdit, cursoOf });
  assert.equal(plan.upserts.length, 0);
  assert.equal(plan.blocked.length, 1);
});

test('primeira carga: servidor prevalece sobre o cache local', () => {
  const local = [ep('1', { docente: 'Antigo' }), ep('9'), cb('8')];
  const remote = [ep('1', { docente: 'Atual' }), cb('2')];

  const result = reconcileAllocations({ local, remote, synced: new Map(), canEdit, cursoOf });
  const byId = Object.fromEntries(result.map((a) => [a.id, a]));
  assert.equal(byId['1'].docente, 'Atual');
  assert.ok(byId['9'], 'local nunca enviada do curso editavel fica');
  assert.ok(!byId['8'], 'local de outro curso que nao esta no servidor sai');
  assert.ok(byId['2']);
});

test('recarga: alteracao local pendente fica, as limpas recebem a versao do servidor', () => {
  const lastSent = [ep('1'), ep('2'), cb('3')];
  const synced = buildSyncedMap(lastSent, cursoOf);
  const local = [ep('1', { docente: 'Pendente' }), ep('2'), cb('3')];
  const remote = [ep('1', { docente: 'Colega' }), ep('2', { docente: 'Colega' }), cb('3', { docente: 'Outro' })];

  const result = reconcileAllocations({ local, remote, synced, canEdit, cursoOf });
  const byId = Object.fromEntries(result.map((a) => [a.id, a]));
  assert.equal(byId['1'].docente, 'Pendente');
  assert.equal(byId['2'].docente, 'Colega');
  assert.equal(byId['3'].docente, 'Outro');
});

test('recarga: exclusao local pendente nao ressuscita; exclusao no servidor remove', () => {
  const synced = buildSyncedMap([ep('1'), ep('2')], cursoOf);
  const local = [ep('2')];
  const remote = [ep('1')];

  const result = reconcileAllocations({ local, remote, synced, canEdit, cursoOf });
  assert.deepEqual(result.map((a) => a.id), []);

  const pushPlan = computePushPlan({
    allocations: result,
    synced: buildSyncedMap(remote, cursoOf),
    canEdit,
    cursoOf
  });
  assert.deepEqual(pushPlan.deletes, ['1']);
});
