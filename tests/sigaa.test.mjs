// Codigo de horario SIGAA (ex.: 24M12 = segunda e quarta, manha, 1o e 2o horarios).
// Sem planilha carregada, o store nao tem o regime ativo e vale a tabela padrao
// de getSigaaCode (M 07:30, 08:20, 09:10...; T 13:30, 14:20...).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSigaaCode, buildScopedSigaaAllocationFromOfferFaixa } from '../js/sigaa_metadata.js';

// Aula semanal (modo 'semanal'). diaSemana: 1 = segunda ... 6 = sabado (no SIGAA, segunda = 2)
const semanal = (diaSemana, horario) => ({ modo: 'semanal', diaSemana, horario });

test('aulas semanais: mesmos horarios em dias diferentes viram um codigo so', () => {
  const aulas = [semanal(1, '07:30'), semanal(1, '08:20'), semanal(3, '07:30'), semanal(3, '08:20')];
  assert.equal(getSigaaCode(aulas), '24M12');
});

test('manha e tarde no mesmo dia saem em partes separadas e ordenadas', () => {
  assert.equal(getSigaaCode([semanal(2, '13:30'), semanal(2, '07:30')]), '3M1 3T1');
});

test('aula repetida nao duplica o horario', () => {
  assert.equal(getSigaaCode([semanal(5, '14:20'), semanal(5, '14:20')]), '6T2');
});

test('sem aulas com horario reconhecido, devolve "-"', () => {
  assert.equal(getSigaaCode([]), '-');
  assert.equal(getSigaaCode([semanal(1, '')]), '-');
});

test('faixa de uma oferta vira uma alocacao por faixas com dias e horarios limpos', () => {
  const oferta = { baseAlloc: { id: 'x', disciplina: 'Ecologia', docente: 'Fulana' } };
  const faixa = {
    inicio: '2027-03-15',
    fim: '2027-04-05',
    dias: [3, 1, 9, 1],
    slots: ['08:20', '07:30', '07:30'],
    drawnSlotsByDay: { 1: ['08:20', '07:30'] }
  };
  const alloc = buildScopedSigaaAllocationFromOfferFaixa(oferta, faixa);
  assert.equal(alloc.modo, 'faixas');
  assert.equal(alloc.disciplina, 'Ecologia');
  assert.deepEqual(alloc.diasMarcados, [1, 3]);
  assert.deepEqual(alloc.horariosOcupados, ['07:30', '08:20']);
  assert.deepEqual(alloc.faixas[0].drawnSlotsByDay, { 1: ['07:30', '08:20'], 3: ['07:30', '08:20'] });
  assert.equal(alloc.dataInicio, '2027-03-15');
  assert.equal(alloc.dataFim, '2027-04-05');
  assert.equal(alloc.usaSabado, false);
});
