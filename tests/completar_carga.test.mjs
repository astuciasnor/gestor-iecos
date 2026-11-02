// Botao "Completar" da Lista de Ofertas: pecas das alternativas.
import assert from 'node:assert/strict';
import test from 'node:test';
import { addToPatternBetween, adjacentSlot, candidateWindows, isMorningPattern } from '../js/completar_carga.mjs';

const manha = ['08:00 - 08:50', '08:50 - 09:40', '09:40 - 10:30'];
const quadroManha = ['08:00 - 08:50', '08:50 - 09:40', '09:40 - 10:30', 'INTERVALO', '10:50 - 11:40', '11:40 - 12:30'];

test('janelas: menor numero de semanas primeiro, da ultima para a primeira', () => {
  // 02/12/2026 e quarta; semanas: 02-06, 07-13, 14-20, 21-23.
  const janelas = candidateWindows('2026-12-02', '2026-12-23');
  assert.deepEqual(janelas.slice(0, 5), [
    ['2026-12-21', '2026-12-23'],
    ['2026-12-14', '2026-12-20'],
    ['2026-12-07', '2026-12-13'],
    ['2026-12-02', '2026-12-06'],
    ['2026-12-14', '2026-12-23']
  ]);
  assert.deepEqual(janelas[janelas.length - 1], ['2026-12-02', '2026-12-23']);
  assert.equal(janelas.length, 4 + 3 + 2 + 1);
  assert.deepEqual(candidateWindows('2026-12-23', '2026-12-02'), []);
});

test('acrescimo so dentro da janela, dividindo a faixa em tres', () => {
  const faixas = [{ inicio: '2026-11-30', fim: '2026-12-23', drawnSlotsByDay: { 1: manha, 5: manha } }];
  const r = addToPatternBetween(faixas, '2026-12-07', '2026-12-13', () => ({ 6: manha }));
  assert.deepEqual(r.map((f) => [f.inicio, f.fim, Object.keys(f.drawnSlotsByDay).join(',')]), [
    ['2026-11-30', '2026-12-06', '1,5'],
    ['2026-12-07', '2026-12-13', '1,5,6'],
    ['2026-12-14', '2026-12-23', '1,5']
  ]);
  // A faixa original nao e alterada.
  assert.deepEqual(Object.keys(faixas[0].drawnSlotsByDay), ['1', '5']);
});

test('faixas fora da janela ficam iguais; o pedaco depois da janela continua aberto', () => {
  const faixas = [
    { inicio: '2026-11-02', fim: '2026-11-30', drawnSlotsByDay: { 1: manha } },
    { inicio: '2026-12-01', fim: null, drawnSlotsByDay: { 2: manha } }
  ];
  const r = addToPatternBetween(faixas, '2026-12-01', '2026-12-13', (f) => Object.fromEntries(Object.keys(f.drawnSlotsByDay).map((d) => [d, ['10:50 - 11:40']])));
  assert.equal(r.length, 3);
  assert.deepEqual(r[0], faixas[0]);
  assert.deepEqual([r[1].inicio, r[1].fim], ['2026-12-01', '2026-12-13']);
  assert.deepEqual(r[1].drawnSlotsByDay, { 2: [...manha, '10:50 - 11:40'] });
  assert.deepEqual([r[2].inicio, r[2].fim, r[2].drawnSlotsByDay], ['2026-12-14', null, { 2: manha }]);
});

test('horario vizinho: o seguinte, pulando o intervalo, ou o anterior', () => {
  assert.equal(adjacentSlot(manha, quadroManha), '10:50 - 11:40');
  assert.equal(adjacentSlot(['10:50 - 11:40', '11:40 - 12:30'], quadroManha), '09:40 - 10:30');
  assert.equal(adjacentSlot(quadroManha.filter((s) => s !== 'INTERVALO'), quadroManha), null);
  assert.equal(adjacentSlot(['14:00 - 14:50'], quadroManha), null);
});

test('padrao de manha ou nao', () => {
  assert.equal(isMorningPattern(manha), true);
  assert.equal(isMorningPattern(['14:00 - 14:50', '14:50 - 15:40']), false);
  assert.equal(isMorningPattern([]), false);
});
