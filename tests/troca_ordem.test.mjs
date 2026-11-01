// Botao "Trocar" da Lista de Ofertas: quando duas componentes podem trocar de lugar.
import assert from 'node:assert/strict';
import test from 'node:test';
import { addDaysIso, areInSequence, classifySwap, hasSinglePattern } from '../js/troca_ordem.mjs';

const tresPrimeiros = ['08:00', '08:50', '09:40'];
const segASex = (slots) => Object.fromEntries([1, 2, 3, 4, 5].map((d) => [d, slots]));

function comp(disciplina, ch, dataInicio, dataFim, extra = {}) {
  return {
    disciplina, ch, dataInicio, dataFim, subGrupo: '', registros: 1,
    faixas: [{ inicio: dataInicio, fim: dataFim, drawnSlotsByDay: segASex(tresPrimeiros) }],
    ...extra
  };
}

test('soma dias em datas ISO', () => {
  assert.equal(addDaysIso('2026-12-31', 1), '2027-01-01');
  assert.equal(addDaysIso('2026-03-01', -1), '2026-02-28');
});

test('mesma carga troca mesmo afastadas', () => {
  const a = comp('BIOQUIMICA', 60, '2026-09-01', '2026-09-28');
  const b = comp('ZOOLOGIA', 60, '2026-11-02', '2026-11-27');
  assert.deepEqual(classifySwap(a, b), { ok: true, modo: 'mesma-ch' });
});

test('carga diferente so troca em sequencia', () => {
  // 25/09/2026 e sexta; 28/09 e segunda: so o fim de semana entre elas.
  const a = comp('BIOQUIMICA', 60, '2026-08-31', '2026-09-25');
  const b = comp('QUIMICA', 45, '2026-09-28', '2026-10-16');
  assert.deepEqual(classifySwap(a, b), { ok: true, modo: 'sequencia' });
  assert.deepEqual(classifySwap(b, a), { ok: true, modo: 'sequencia' });

  // Uma semana livre entre elas: nao estao em sequencia.
  const longe = comp('QUIMICA', 45, '2026-10-05', '2026-10-23');
  const r = classifySwap(a, longe);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /carga diferente \(45h x 60h\) e não estão em sequência/);
});

test('feriado e dias sem aula entre elas nao quebram a sequencia', () => {
  const a = comp('A', 60, '2026-08-31', '2026-09-25');
  // 28/09 feriado: a segunda comeca na terca 29/09.
  assert.equal(areInSequence(a, comp('B', 45, '2026-09-29', '2026-10-16'), { feriados: ['2026-09-28'] }), true);
  assert.equal(areInSequence(a, comp('B', 45, '2026-09-29', '2026-10-16')), false);
  // So tercas e quintas: de quinta 24/09 a terca 29/09 nao ha dia de aula livre.
  const terQui = { 2: tresPrimeiros, 4: tresPrimeiros };
  const t1 = comp('T1', 30, '2026-09-01', '2026-09-24', { faixas: [{ inicio: '2026-09-01', drawnSlotsByDay: terQui }] });
  const t2 = comp('T2', 20, '2026-09-29', '2026-10-15', { faixas: [{ inicio: '2026-09-29', drawnSlotsByDay: terQui }] });
  assert.equal(areInSequence(t1, t2), true);
  // Datas que se sobrepoem nao sao sequencia.
  assert.equal(areInSequence(a, comp('B', 45, '2026-09-20', '2026-10-16')), false);
});

test('sub-turma diferente e oferta dividida nao trocam', () => {
  const a = comp('A', 60, '2026-09-01', '2026-09-28');
  assert.match(classifySwap(a, comp('B', 60, '2026-11-02', '2026-11-27', { subGrupo: 'T1' })).motivo, /sub-turma diferente \(sub-turma T1 x turma inteira\)/);
  assert.match(classifySwap(a, comp('B', 60, '2026-11-02', '2026-11-27', { registros: 2 })).motivo, /mais de um registro/);
});

test('faixa de ajuste do ultimo dia conta como padrao unico; regime diferente nao', () => {
  const ajuste = [
    { inicio: '2026-08-31', fim: '2026-09-23', drawnSlotsByDay: segASex(tresPrimeiros) },
    { inicio: '2026-09-24', fim: '2026-09-25', drawnSlotsByDay: { 4: tresPrimeiros, 5: ['08:00'] } }
  ];
  assert.equal(hasSinglePattern(ajuste), true);
  const regimeNovo = [
    ajuste[0],
    { inicio: '2026-09-24', drawnSlotsByDay: { 4: ['14:00', '14:50'] } }
  ];
  assert.equal(hasSinglePattern(regimeNovo), false);

  const a = comp('BIOQUIMICA', 60, '2026-08-31', '2026-09-25', { faixas: regimeNovo });
  const b = comp('QUIMICA', 45, '2026-09-28', '2026-10-16');
  const r = classifySwap(a, b);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /BIOQUIMICA tem faixas com horários diferentes/);
  // Com a mesma carga, o regime diferente nao impede.
  assert.deepEqual(classifySwap(a, { ...b, ch: 60 }), { ok: true, modo: 'mesma-ch' });
});
