// Conversao de ofertas salvas num quadro de horario antigo (MT 13:30 -> 14:00).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildQuadroConversionMap, convertAllocationQuadro } from '../js/quadro_horario.mjs';

const dados = JSON.parse(readFileSync(new URL('../dados_app.json', import.meta.url), 'utf-8'));
const QUADROS = dados.horarios_por_regime;

test('aulas do quadro das 13:30 vao para o quadro das 14:00 pela ordem', () => {
  const mapa = buildQuadroConversionMap(QUADROS, '2');
  assert.equal(mapa.get('13:30 - 14:20'), '14:00 - 14:50');
  assert.equal(mapa.get('14:20 - 15:10'), '14:50 - 15:40');
  assert.equal(mapa.get('15:10 - 16:00'), '15:40 - 16:30');
  assert.equal(mapa.get('16:20 - 17:10'), '16:50 - 17:40');
  assert.equal(mapa.get('07:30 - 08:20'), '08:00 - 08:50');
});

test('aula sem correspondente e horario igual nos dois quadros nao mudam', () => {
  const mapa = buildQuadroConversionMap(QUADROS, '2');
  assert.equal(mapa.has('18:00 - 18:50'), false); // o quadro das 14:00 tem uma aula a menos
  assert.equal(mapa.has('18:30 - 19:20'), false); // noite igual nos dois
  assert.equal(mapa.has('14:00 - 14:50'), false); // ja e do quadro destino
});

test('converte todos os campos de horario da oferta', () => {
  const mapa = buildQuadroConversionMap(QUADROS, '2');
  const alloc = {
    turmaId: 'MT2026',
    disciplina: 'COMPUTACAO BASICA',
    horariosOcupados: ['13:30 - 14:20', '14:20 - 15:10'],
    horariosUltimoDia: ['13:30 - 14:20'],
    executionByDate: { '2027-01-18': ['13:30 - 14:20', '14:20 - 15:10'] },
    faixas: [{
      inicio: '2027-01-18',
      slots: ['13:30 - 14:20', '14:20 - 15:10'],
      drawnSlotsByDay: { 1: ['13:30-14:20'] }
    }]
  };

  assert.equal(convertAllocationQuadro(alloc, mapa), true);
  assert.deepEqual(alloc.horariosOcupados, ['14:00 - 14:50', '14:50 - 15:40']);
  assert.deepEqual(alloc.horariosUltimoDia, ['14:00 - 14:50']);
  assert.deepEqual(alloc.executionByDate, { '2027-01-18': ['14:00 - 14:50', '14:50 - 15:40'] });
  assert.deepEqual(alloc.faixas[0].slots, ['14:00 - 14:50', '14:50 - 15:40']);
  assert.deepEqual(alloc.faixas[0].drawnSlotsByDay, { 1: ['14:00 - 14:50'] });
  assert.equal(alloc.faixas[0].inicio, '2027-01-18');
  assert.equal(alloc.disciplina, 'COMPUTACAO BASICA');
});

test('oferta ja no quadro atual fica igual', () => {
  const mapa = buildQuadroConversionMap(QUADROS, '2');
  const alloc = { horariosOcupados: ['14:00 - 14:50'], executionByDate: { '2027-01-04': ['14:00 - 14:50'] } };
  const antes = JSON.stringify(alloc);
  assert.equal(convertAllocationQuadro(alloc, mapa), false);
  assert.equal(JSON.stringify(alloc), antes);
});

test('com o quadro das 13:30 como destino nada do proprio quadro muda', () => {
  const mapa = buildQuadroConversionMap(QUADROS, '1');
  assert.equal(mapa.has('13:30 - 14:20'), false);
  assert.equal(mapa.get('14:00 - 14:50'), '13:30 - 14:20');
});
