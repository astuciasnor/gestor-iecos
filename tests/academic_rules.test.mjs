import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSigaaExportPayload,
  computeRemainingFractionalHours,
  filterExportableAllocations,
  generateAllocationOccurrences,
  getTeacherActiveShifts,
  initializeWeeklyScheduleForTurma,
  reconcileTurmaSelectionAfterPLChange,
  resetWeeklyViewOnTurmaChange,
  resolveActiveAcademicPeriod,
  sortUniqueIsoDates,
  validateOccurrenceWithinSemesterBounds
} from '../js/academic_rules.mjs';

test('resolveActiveAcademicPeriod keeps the preferred official plan when it exists', () => {
  const resolved = resolveActiveAcademicPeriod({
    plans: [
      { periodo: 'PL1', termStart: '2026-01-05', termEnd: '2026-03-06', ano: 2026 },
      { periodo: 'PL2', termStart: '2026-03-09', termEnd: '2026-06-30', ano: 2026 }
    ],
    preferredMeta: { periodo: 'PL2', termStart: '2026-03-09', termEnd: '2026-06-30' }
  });

  assert.equal(resolved.periodo, 'PL2');
  assert.equal(resolved.termStart, '2026-03-09');
  assert.equal(resolved.termEnd, '2026-06-30');
});

test('resolveActiveAcademicPeriod falls back to the active plan when the preferred one is missing', () => {
  const resolved = resolveActiveAcademicPeriod({
    plans: [
      { periodo: 'PL1', termStart: '2026-01-05', termEnd: '2026-03-06', ano: 2026 },
      { periodo: 'PL2', termStart: '2026-03-09', termEnd: '2026-06-30', ano: 2026 },
      { periodo: 'PL3', termStart: '2026-07-20', termEnd: '2026-08-28', ano: 2026 }
    ],
    preferredMeta: { periodo: 'PL4', termStart: '2026-09-01', termEnd: '2026-12-10' },
    today: '2026-03-28'
  });

  assert.equal(resolved.periodo, 'PL2');
});

test('resolveActiveAcademicPeriod does not break when preferred metadata is partial', () => {
  const resolved = resolveActiveAcademicPeriod({
    plans: [
      { periodo: 'PL1', termStart: '2026-01-05', termEnd: '2026-03-06', ano: 2026 },
      { periodo: 'PL2', termStart: '2026-03-09', termEnd: '2026-06-30', ano: 2026 }
    ],
    preferredMeta: { periodo: 'PL4' },
    today: '2026-03-28'
  });

  assert.equal(resolved.periodo, 'PL2');
  assert.equal(resolved.termStart, '2026-03-09');
  assert.equal(resolved.termEnd, '2026-06-30');
});

test('reconcileTurmaSelectionAfterPLChange keeps a valid turma and clears an invalid one', () => {
  const turmas = [
    { turma_id: 'EP2026', sigla: 'EP' },
    { turma_id: 'EP2025', sigla: 'EP' },
    { turma_id: 'CB2026', sigla: 'CB' }
  ];

  const kept = reconcileTurmaSelectionAfterPLChange({
    selectedCurso: 'EP',
    selectedTurma: 'EP2026',
    lastTurma: 'EP2025',
    turmas
  });
  assert.equal(kept.selectedTurma, 'EP2026');
  assert.equal(kept.wasCleared, false);

  const recovered = reconcileTurmaSelectionAfterPLChange({
    selectedCurso: 'EP',
    selectedTurma: 'CB2026',
    lastTurma: 'EP2025',
    turmas
  });
  assert.equal(recovered.selectedTurma, 'EP2025');
  assert.equal(recovered.wasRecoveredFromLastContext, true);

  const cleared = reconcileTurmaSelectionAfterPLChange({
    selectedCurso: 'CB',
    selectedTurma: 'EP2026',
    lastTurma: 'EP2025',
    turmas
  });
  assert.equal(cleared.selectedTurma, '');
  assert.equal(cleared.wasCleared, true);
});

test('initializeWeeklyScheduleForTurma starts from the day after the latest allocation end', () => {
  const initialized = initializeWeeklyScheduleForTurma({
    termStart: '2026-03-09',
    turmaLastStart: '2026-03-09',
    latestAllocationEnd: '2026-03-27'
  });

  assert.equal(initialized.firstFaixaStart, '2026-03-28');
  assert.equal(initialized.weekStartISO, '2026-03-23');
});

test('initializeWeeklyScheduleForTurma honors an explicit preferred start first', () => {
  const initialized = initializeWeeklyScheduleForTurma({
    termStart: '2026-03-09',
    latestAllocationEnd: '2026-03-27',
    preferredStart: '2026-04-01'
  });

  assert.equal(initialized.firstFaixaStart, '2026-04-01');
  assert.equal(initialized.weekStartISO, '2026-03-30');
});

test('resetWeeklyViewOnTurmaChange repositions the weekly grid to the first week of the term', () => {
  const reset = resetWeeklyViewOnTurmaChange({
    termStart: '2026-03-09',
    turmaFirstFaixaStart: '2026-03-16',
    fallbackDate: '2026-03-23'
  });

  assert.equal(reset.firstFaixaStart, '2026-03-09');
  assert.equal(reset.weekStartISO, '2026-03-09');
});

test('computeRemainingFractionalHours returns the exact remaining workload', () => {
  assert.equal(computeRemainingFractionalHours(75, 72), 3);
  assert.equal(computeRemainingFractionalHours(75, 80), 0);
  assert.equal(computeRemainingFractionalHours(0, 10), 0);
});

test('validateOccurrenceWithinSemesterBounds blocks dates after the semester end', () => {
  assert.equal(
    validateOccurrenceWithinSemesterBounds({
      occurrenceDate: '2026-03-23',
      semesterEndDate: '2026-03-23'
    }),
    true
  );
  assert.equal(
    validateOccurrenceWithinSemesterBounds({
      occurrenceDate: '2026-03-30',
      semesterEndDate: '2026-03-23'
    }),
    false
  );
});

test('generateAllocationOccurrences creates a fractional final day with the exact remaining workload', () => {
  const occurrences = generateAllocationOccurrences({
    totalWorkload: 75,
    weeklyPlannedWorkload: 4,
    semesterEndDate: '2026-07-31',
    scheduleDates: [
      ...Array.from({ length: 18 }, (_, idx) => `2026-03-${String(9 + idx).padStart(2, '0')}`),
      '2026-07-31'
    ],
    slotsByDate: Object.fromEntries([
      ...Array.from({ length: 18 }, (_, idx) => [`2026-03-${String(9 + idx).padStart(2, '0')}`, ['08:00', '08:50', '09:50', '10:40']]),
      ['2026-07-31', ['08:00', '08:50', '09:50', '10:40']]
    ])
  });

  assert.equal(occurrences.lastDate, '2026-07-31');
  assert.deepEqual(occurrences.lastDaySlots, ['08:00', '08:50', '09:50']);
  assert.equal(occurrences.partialFinalDay, true);
  assert.equal(occurrences.remainingHours, 0);
  assert.equal(occurrences.stopReason, 'fractional-final');
});

test('generateAllocationOccurrences respects the next valid date and semester clipping', () => {
  const occurrences = generateAllocationOccurrences({
    totalWorkload: 12,
    weeklyPlannedWorkload: 4,
    nextValidDate: '2026-03-16',
    semesterEndDate: '2026-03-23',
    scheduleDates: ['2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30'],
    slotsByDate: {
      '2026-03-09': ['08:00', '08:50', '09:50', '10:40'],
      '2026-03-16': ['08:00', '08:50', '09:50', '10:40'],
      '2026-03-23': ['08:00', '08:50', '09:50', '10:40'],
      '2026-03-30': ['08:00', '08:50', '09:50', '10:40']
    }
  });

  assert.deepEqual(Object.keys(occurrences.byDate), ['2026-03-16', '2026-03-23']);
  assert.equal(occurrences.wasClippedToSemesterEnd, true);
  assert.equal(occurrences.lastDate, '2026-03-23');
});

test('getTeacherActiveShifts groups real slots by preferred shift order', () => {
  const shifts = getTeacherActiveShifts({
    eventsByDate: {
      '2026-03-10': [{ horario: '08:00 - 09:40' }, { horario: '19:00 - 20:40' }],
      '2026-03-11': [{ horario: '14:00 - 15:40' }]
    },
    resolveShift: (slot) => {
      if (slot.startsWith('08')) return 'Manha';
      if (slot.startsWith('14')) return 'Tarde';
      return 'Noite';
    },
    preferredOrder: ['Manha', 'Tarde', 'Noite']
  });

  assert.deepEqual(
    shifts.map((shift) => ({ normalized: shift.normalized, count: shift.count })),
    [
      { normalized: 'manha', count: 1 },
      { normalized: 'tarde', count: 1 },
      { normalized: 'noite', count: 1 }
    ]
  );
});

test('getTeacherActiveShifts activates the morning shift for sabadoManha events', () => {
  const shifts = getTeacherActiveShifts({
    eventsByDate: {
      // Aula de turma noturna deslocada para o sabado de manha (ultimo dia).
      '2026-03-28': [{ horario: '18:30 - 19:20', sabadoManha: true }]
    },
    resolveShift: () => 'Noite',
    preferredOrder: ['Manha', 'Tarde', 'Noite']
  });

  const normalizedShifts = shifts.map((shift) => shift.normalized);
  assert.ok(normalizedShifts.includes('manha'), 'turno da manha deve estar ativo');
  assert.ok(normalizedShifts.includes('noite'), 'turno da noite tambem deve estar ativo');
});

test('filterExportableAllocations excludes pending canonical allocations', () => {
  const allocs = [
    { turmaId: 'EP2026', disciplina: 'Algoritmos', modo: 'faixas' },
    { turmaId: 'EP2026', disciplina: 'Estagio', modo: 'pendente' },
    { turmaId: 'EP2026', disciplina: 'Calculo', modo: 'semanal' }
  ];

  const exportable = filterExportableAllocations(allocs);

  assert.deepEqual(
    exportable.map((alloc) => alloc.disciplina),
    ['Algoritmos', 'Calculo']
  );
});

test('buildSigaaExportPayload trims fields and drops internal metadata', () => {
  const payload = buildSigaaExportPayload({
    generatedAt: '2026-03-28T12:00:00.000Z',
    plan: { key: '2026-pl2', periodo: 'PL2' },
    cursoSigla: ' EP ',
    turmaId: ' EP2026 ',
    turmaLabel: ' EP2026_BL1 ',
    periodoLetivo: ' PL2 ',
    termStart: ' 2026-03-09 ',
    termEnd: ' 2026-06-30 ',
    ofertas: [{ componente: 'Algoritmos' }, null]
  });

  assert.equal(payload.generatedAt, undefined);
  assert.equal(payload.plan, undefined);
  assert.equal(payload.cursoSigla, 'EP');
  assert.equal(payload.turmaId, 'EP2026');
  assert.equal(payload.turmaLabel, 'EP2026_BL1');
  assert.equal(payload.periodoLetivo, 'PL2');
  assert.equal(payload.termStart, '2026-03-09');
  assert.equal(payload.termEnd, '2026-06-30');
  assert.deepEqual(payload.ofertas, [{ componente: 'Algoritmos' }]);
});

test('sortUniqueIsoDates removes duplicates and invalid dates before sorting', () => {
  assert.deepEqual(
    sortUniqueIsoDates(['2026-03-23', '2026-03-09', 'foo', '2026-03-23', '2026-03-16']),
    ['2026-03-09', '2026-03-16', '2026-03-23']
  );
});
