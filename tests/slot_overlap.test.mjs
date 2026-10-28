// Choque de docente entre cursos com quadros de horario diferentes.
// Desde 2026-08-24 cada curso pode usar o seu quadro (ex.: MT 13:30-14:20,
// EP 14:00-14:50). O choque e decidido pelo relogio, nao pelo rotulo.
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSlotRangeMinutes, slotLabelsOverlap } from '../js/academic_rules.mjs';
import { detectTeacherConflicts } from '../js/conflicts.js';

const TARDE_REGIME_1 = ['13:30 - 14:20', '14:20 - 15:10', '15:10 - 16:00'];
const TARDE_REGIME_2 = ['14:00 - 14:50', '14:50 - 15:40', '15:40 - 16:30'];

test('le o rotulo do horario em minutos do dia', () => {
  assert.deepEqual(parseSlotRangeMinutes('13:30 - 14:20'), { inicio: 810, fim: 860 });
  assert.deepEqual(parseSlotRangeMinutes('14:00'), { inicio: 840, fim: 890 });
  assert.equal(parseSlotRangeMinutes('INTERVALO (16:00 - 16:20)'), null);
  assert.equal(parseSlotRangeMinutes('M1'), null);
});

test('horarios de quadros diferentes que se sobrepoem chocam', () => {
  assert.equal(slotLabelsOverlap('13:30 - 14:20', '14:00 - 14:50'), true);
  assert.equal(slotLabelsOverlap('15:10 - 16:00', '15:40 - 16:30'), true);
  assert.equal(slotLabelsOverlap('16:20 - 17:10', '15:40 - 16:30'), true);
});

test('horarios encostados ou separados nao chocam', () => {
  assert.equal(slotLabelsOverlap('13:30 - 14:20', '14:20 - 15:10'), false);
  assert.equal(slotLabelsOverlap('12:00 - 12:50', '14:00 - 14:50'), false);
  assert.equal(slotLabelsOverlap('09:10 - 10:00', '10:50 - 11:40'), false);
});

test('mesmo rotulo continua chocando, inclusive sem hora', () => {
  assert.equal(slotLabelsOverlap('14:00 - 14:50', '14:00-14:50'), true);
  assert.equal(slotLabelsOverlap('M1', 'M1'), true);
  assert.equal(slotLabelsOverlap('M1', 'M2'), false);
  assert.equal(slotLabelsOverlap('', ''), false);
});

test('docente na MT as 13:30 e na EP as 14:00 gera conflito', () => {
  const conflitos = detectTeacherConflicts({
    eventsByDate: {
      '2027-01-04': [
        ...TARDE_REGIME_1.map((horario) => ({ horario, turmaId: 'MT2026', disciplina: 'VETORES', subGrupo: '' })),
        ...TARDE_REGIME_2.map((horario) => ({ horario, turmaId: 'EP2025', disciplina: 'INTRODUCAO', subGrupo: '' }))
      ]
    }
  });

  assert.ok(conflitos.length > 0);
  conflitos.forEach((conflito) => {
    assert.deepEqual(conflito.turmas, ['EP2025', 'MT2026']);
    assert.equal(conflito.startDate, '2027-01-04');
  });
  const primeiro = conflitos.find((c) => c.slot === '13:30 - 14:20 x 14:00 - 14:50');
  assert.ok(primeiro);
  assert.equal(primeiro.description, 'Choque de horario (13:30 - 14:20 x 14:00 - 14:50).');
});

test('docente de manha num curso e de tarde no outro nao gera conflito', () => {
  const conflitos = detectTeacherConflicts({
    eventsByDate: {
      '2027-01-04': [
        { horario: '08:00 - 08:50', turmaId: 'EP2025', disciplina: 'INTRODUCAO', subGrupo: '' },
        { horario: '13:30 - 14:20', turmaId: 'MT2026', disciplina: 'VETORES', subGrupo: '' }
      ]
    }
  });

  assert.deepEqual(conflitos, []);
});
