// Pausa de componente: dias sem aula entre duas faixas.
import assert from 'node:assert/strict';
import test from 'node:test';
import { closeFaixaEnds, hasFaixaPause, isPauseEnd, listFaixaPauses, shiftIso } from '../js/pausa_faixas.mjs';

test('shiftIso anda dias e vira o mes', () => {
  assert.equal(shiftIso('2027-03-31', 1), '2027-04-01');
  assert.equal(shiftIso('2027-04-13', -1), '2027-04-12');
});

test('isPauseEnd: so ha pausa quando sobra ao menos um dia livre', () => {
  assert.equal(isPauseEnd('2027-03-15', '2027-03-16', '2027-04-13'), true);
  assert.equal(isPauseEnd('2027-03-15', '2027-04-12', '2027-04-13'), false, 'vespera = faixas coladas');
  assert.equal(isPauseEnd('2027-03-15', '2027-04-11', '2027-04-13'), true, 'um dia livre ja e pausa');
  assert.equal(isPauseEnd('2027-03-15', '2027-04-20', '2027-04-13'), false, 'Fim depois do proximo inicio');
  assert.equal(isPauseEnd('2027-03-15', '2027-03-10', '2027-04-13'), false, 'Fim antes do inicio');
  assert.equal(isPauseEnd('2027-03-15', '', '2027-04-13'), false);
  assert.equal(isPauseEnd('2027-03-15', '2027-03-16', ''), false, 'sem faixa seguinte nao ha pausa');
});

test('caso Dioniso: TCC 15-16/03 e volta em 13/04', () => {
  const faixas = [
    { inicio: '2027-04-13', fim: '2027-04-16' },
    { inicio: '2027-03-15', fim: '2027-03-16' }
  ];
  assert.deepEqual(listFaixaPauses(faixas), [{ aposFaixa: 1, inicio: '2027-03-17', fim: '2027-04-12' }]);
  assert.equal(hasFaixaPause(faixas), true);
});

test('faixas coladas (o normal) nao tem pausa', () => {
  const faixas = [
    { inicio: '2026-09-05', fim: '2026-09-17' },
    { inicio: '2026-09-18', fim: '2026-09-22' }
  ];
  assert.deepEqual(listFaixaPauses(faixas), []);
  assert.equal(hasFaixaPause([{ inicio: '2027-03-15', fim: '2027-03-16' }]), false, 'uma faixa so');
  assert.equal(hasFaixaPause([]), false);
});

test('duas pausas em tres faixas', () => {
  const faixas = [
    { inicio: '2027-03-15', fim: '2027-03-16' },
    { inicio: '2027-04-13', fim: '2027-04-14' },
    { inicio: '2027-05-03', fim: '' }
  ];
  assert.deepEqual(listFaixaPauses(faixas), [
    { aposFaixa: 1, inicio: '2027-03-17', fim: '2027-04-12' },
    { aposFaixa: 2, inicio: '2027-04-15', fim: '2027-05-02' }
  ]);
});

test('closeFaixaEnds cola as faixas, menos a pausa marcada', () => {
  const faixas = [
    { inicio: '2027-03-15', fim: '2027-03-16' },
    { inicio: '2027-04-13', fim: '2027-04-30' }
  ];
  assert.deepEqual(closeFaixaEnds(faixas).map((f) => f.fim), ['2027-04-12', '2027-04-30'], 'sem marca: colada');
  assert.deepEqual(closeFaixaEnds(faixas, { 0: true }).map((f) => f.fim), ['2027-03-16', '2027-04-30'], 'marcada: pausa');
  assert.equal(faixas[0].fim, '2027-03-16', 'nao altera a lista original');
});

test('closeFaixaEnds ignora marca de pausa que nao deixa dia livre', () => {
  const faixas = [
    { inicio: '2027-03-15', fim: '2027-04-20' },
    { inicio: '2027-04-13', fim: null }
  ];
  assert.deepEqual(closeFaixaEnds(faixas, { 0: true }).map((f) => f.fim), ['2027-04-12', null]);
});
