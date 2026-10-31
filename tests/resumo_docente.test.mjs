// Resumo do ano do docente na agenda publica.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTermWeeks,
  formatWeekdays,
  summarizeHorarios,
  summarizeTeacherPeriod
} from '../js/resumo_docente.mjs';

test('semanas vao de segunda a domingo e sao cortadas no inicio e fim do PL', () => {
  // 24/08/2026 e segunda; 23/12/2026 e quarta.
  const weeks = buildTermWeeks('2026-08-24', '2026-12-23');
  assert.equal(weeks.length, 18);
  assert.deepEqual(weeks[0], { index: 1, start: '2026-08-24', end: '2026-08-30' });
  assert.deepEqual(weeks[17], { index: 18, start: '2026-12-21', end: '2026-12-23' });
  // PL comecando numa quinta: a primeira semana e curta.
  const curto = buildTermWeeks('2027-06-03', '2027-06-16');
  assert.deepEqual(curto.map((w) => [w.start, w.end]), [
    ['2027-06-03', '2027-06-06'], ['2027-06-07', '2027-06-13'], ['2027-06-14', '2027-06-16']
  ]);
});

test('dias da semana viram texto curto', () => {
  assert.equal(formatWeekdays([1, 2, 3, 4, 5, 5, 1]), 'seg a sex');
  assert.equal(formatWeekdays([2, 4]), 'ter e qui');
  assert.equal(formatWeekdays([1, 3, 5]), 'seg, qua e sex');
  assert.equal(formatWeekdays([6]), 'sab');
});

test('horarios viram faixa e turno', () => {
  assert.deepEqual(summarizeHorarios(['08:00 - 08:50', '09:40 - 10:30', '08:50 - 09:40']), { range: '08:00–10:30', turnos: 'manhã' });
  assert.deepEqual(summarizeHorarios(['10:50 - 11:40', '14:00 - 14:50']), { range: '10:50–14:50', turnos: 'manhã e tarde' });
});

test('agrupa as aulas por componente e por semana do PL', () => {
  const base = { key: 'EP2026|BIO', disciplina: 'BIOQUIMICA', turmaId: 'EP2026', cor: '#e0bbe4', chTotal: 90, aulas: 1 };
  const entries = [
    // semana 1 (24-30/08): dois dias, 3 aulas por dia
    ...['2026-08-24', '2026-08-25'].flatMap((date) =>
      ['08:00 - 08:50', '08:50 - 09:40', '09:40 - 10:30'].map((horario) => ({ ...base, date, horario }))),
    // semana 3 (07-13/09): um dia
    { ...base, date: '2026-09-08', horario: '08:00 - 08:50' },
    // outra componente
    { key: 'EP2024|EST', disciplina: 'ESTATISTICA', turmaId: 'EP2024', date: '2026-08-31', horario: '14:00 - 14:50', aulas: 1, chTotal: 45 },
    // fora do PL: ignorada
    { ...base, date: '2027-01-10', horario: '08:00 - 08:50' }
  ];
  const resumo = summarizeTeacherPeriod({ termStart: '2026-08-24', termEnd: '2026-12-23', entries });

  assert.equal(resumo.totalAulas, 8);
  assert.deepEqual(resumo.components.map((c) => c.disciplina), ['BIOQUIMICA', 'ESTATISTICA']);
  const bio = resumo.components[0];
  assert.equal(bio.aulas, 7);
  assert.equal(bio.firstDate, '2026-08-24');
  assert.equal(bio.lastDate, '2026-09-08');
  assert.equal(bio.weekdays, 'seg e ter');
  assert.equal(bio.horario, '08:00–10:30');
  assert.equal(bio.weekly.length, 18);
  assert.deepEqual(bio.weekly.slice(0, 3), [
    { dias: 2, aulas: 6, inicio: '2026-08-24' },
    { dias: 0, aulas: 0, inicio: '' },
    { dias: 1, aulas: 1, inicio: '2026-09-08' }
  ]);
});
