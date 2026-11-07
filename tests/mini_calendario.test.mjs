// Mini calendario das faixas: atalhos de mes e grade.
import assert from 'node:assert/strict';
import test from 'node:test';
import { atalhosDeMes, gradeDoMes, rotuloDoMes, somarMeses } from '../js/mini_calendario.mjs';

test('somarMeses atravessa o ano', () => {
  assert.deepEqual(somarMeses(2027, 0, -1), { ano: 2026, mes: 11 });
  assert.deepEqual(somarMeses(2027, 10, 3), { ano: 2028, mes: 1 });
});

test('atalhos: so os meses do periodo letivo', () => {
  assert.deepEqual(atalhosDeMes(2027, 3, '2027-03-15', '2027-07-14').map((m) => m.rotulo), ['Mar', 'Abr', 'Mai', 'Jun', 'Jul'], 'PL2/2027');
  assert.deepEqual(atalhosDeMes(2027, 0, '2027-01-04', '2027-03-05').map((m) => m.rotulo), ['Jan', 'Fev', 'Mar'], 'PL1/2027');
  const virada = atalhosDeMes(2026, 10, '2026-11-20', '2027-02-10');
  assert.deepEqual(virada.map((m) => `${m.rotulo}/${m.ano}`), ['Nov/2026', 'Dez/2026', 'Jan/2027', 'Fev/2027'], 'atravessa o ano');
});

test('atalhos sem periodo: o mes da data e os 3 seguintes', () => {
  assert.deepEqual(atalhosDeMes(2027, 10).map((m) => `${m.rotulo}/${m.ano}`), ['Nov/2027', 'Dez/2027', 'Jan/2028', 'Fev/2028']);
  assert.equal(atalhosDeMes(2027, 3, '2027-07-01', '2027-03-01').length, 4, 'periodo invertido cai no padrao');
});

test('grade de abril/2027 comeca no domingo 28/03 e tem 42 dias', () => {
  const g = gradeDoMes(2027, 3);
  assert.equal(g.length, 42);
  assert.equal(g[0].iso, '2027-03-28');
  assert.equal(g[0].doMes, false);
  assert.equal(g[0].dow, 0);
  const dia13 = g.find((c) => c.iso === '2027-04-13');
  assert.equal(dia13.doMes, true);
  assert.equal(dia13.dow, 2, '13/04/2027 e terca');
  assert.equal(g.filter((c) => c.doMes).length, 30);
});

test('rotulo do mes em portugues', () => {
  assert.equal(rotuloDoMes(2027, 3), 'abril de 2027');
  assert.equal(rotuloDoMes(2027, 2), 'março de 2027');
});
