import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALLOCATION_MODES,
  canonicalizeAllocationModo,
  getAllocationModoLabel,
  inferAllocationModo
} from '../js/allocation_mode.mjs';
import {
  buildSigaaExportPayload,
  filterExportableAllocations,
  generateAllocationOccurrences,
  getTeacherActiveShifts,
  initializeWeeklyScheduleForTurma,
  reconcileTurmaSelectionAfterPLChange,
  resetWeeklyViewOnTurmaChange,
  resolveActiveAcademicPeriod
} from '../js/academic_rules.mjs';
import { detectTeacherConflicts } from '../js/conflicts.js';

test('inferAllocationModo traduz o legado e canonicalizeAllocationModo limpa o payload', () => {
  assert.equal(inferAllocationModo({ tipo: 'regular_prioritaria' }), ALLOCATION_MODES.WEEKLY);
  assert.equal(inferAllocationModo({ tipo: 'intensiva' }), ALLOCATION_MODES.FAIXAS);

  const normalized = canonicalizeAllocationModo({
    tipo: 'intensiva',
    faixas: [{ inicio: '2026-03-09', fim: '2026-03-30' }]
  });

  assert.equal(normalized.modo, ALLOCATION_MODES.FAIXAS);
  assert.equal(Object.hasOwn(normalized, 'tipo'), false);
});

test('getAllocationModoLabel usa a linguagem canônica para modos novos e legados', () => {
  assert.equal(getAllocationModoLabel('faixas'), 'Oferta por Faixas');
  assert.equal(getAllocationModoLabel('intensiva'), 'Oferta por Faixas');
  assert.equal(getAllocationModoLabel('pendente'), 'Pendente');
  assert.equal(getAllocationModoLabel('semanal'), 'Oferta');
});

test('resolveActiveAcademicPeriod preserva o plano preferido quando ele existe na lista oficial', () => {
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

test('reconcileTurmaSelectionAfterPLChange mantém a turma atual válida e limpa contexto inválido', () => {
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

  const cleared = reconcileTurmaSelectionAfterPLChange({
    selectedCurso: 'CB',
    selectedTurma: 'EP2026',
    lastTurma: 'EP2025',
    turmas
  });
  assert.equal(cleared.selectedTurma, '');
  assert.equal(cleared.wasCleared, true);
});

test('initializeWeeklyScheduleForTurma inicia turma nova na data inicial do PL', () => {
  const initialized = initializeWeeklyScheduleForTurma({
    termStart: '2026-03-09',
    turmaLastStart: '',
    latestAllocationEnd: ''
  });

  assert.equal(initialized.firstFaixaStart, '2026-03-09');
  assert.equal(initialized.weekStartISO, '2026-03-09');
});

test('generateAllocationOccurrences cria fechamento fracionário com a CH restante exata', () => {
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
});

test('generateAllocationOccurrences não gera ocorrências após o fim do semestre', () => {
  const occurrences = generateAllocationOccurrences({
    totalWorkload: 12,
    weeklyPlannedWorkload: 4,
    semesterEndDate: '2026-03-23',
    scheduleDates: ['2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30'],
    slotsByDate: {
      '2026-03-09': ['08:00', '08:50', '09:50', '10:40'],
      '2026-03-16': ['08:00', '08:50', '09:50', '10:40'],
      '2026-03-23': ['08:00', '08:50', '09:50', '10:40'],
      '2026-03-30': ['08:00', '08:50', '09:50', '10:40']
    }
  });

  assert.equal(occurrences.lastDate, '2026-03-23');
  assert.equal(Object.keys(occurrences.byDate).includes('2026-03-30'), false);
});

test('resetWeeklyViewOnTurmaChange reposiciona a grade para a primeira semana do PL', () => {
  const reset = resetWeeklyViewOnTurmaChange({
    termStart: '2026-03-09',
    turmaFirstFaixaStart: '2026-03-16'
  });

  assert.equal(reset.firstFaixaStart, '2026-03-09');
  assert.equal(reset.weekStartISO, '2026-03-09');
});

test('getTeacherActiveShifts detecta manhã, tarde e noite conforme os horários reais', () => {
  const shifts = getTeacherActiveShifts({
    eventsByDate: {
      '2026-03-10': [{ horario: '08:00 - 09:40' }, { horario: '19:00 - 20:40' }],
      '2026-03-11': [{ horario: '14:00 - 15:40' }]
    },
    resolveShift: (slot) => {
      if (slot.startsWith('08')) return 'Manhã';
      if (slot.startsWith('14')) return 'Tarde';
      return 'Noite';
    },
    preferredOrder: ['Manhã', 'Tarde', 'Noite']
  });

  assert.deepEqual(shifts.map((shift) => shift.label), ['Manhã', 'Tarde', 'Noite']);
});

test('detectTeacherConflicts gera linhas com turno, turmas e componentes conflitantes', () => {
  const conflicts = detectTeacherConflicts({
    eventsByDate: {
      '2026-03-10': [
        { horario: '08:00 - 09:40', turmaId: 'EP2026', disciplina: 'Algoritmos' },
        { horario: '08:00 - 09:40', turmaId: 'CB2026', disciplina: 'Ecologia' },
        { horario: '19:00 - 20:40', turmaId: 'EP2026', disciplina: 'Laboratório' }
      ]
    },
    resolveShift: (slot) => slot.startsWith('08') ? 'Manhã' : 'Noite',
    formatTurmaLabel: (event) => event.turmaId
  });

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].shift, 'Manhã');
  assert.deepEqual(conflicts[0].turmas, ['CB2026', 'EP2026']);
  assert.deepEqual(conflicts[0].componentes, ['Algoritmos', 'Ecologia']);
});

test('filterExportableAllocations e buildSigaaExportPayload excluem componentes pendentes', () => {
  const allocs = [
    { turmaId: 'EP2026', disciplina: 'Algoritmos', tipo: 'intensiva' },
    { turmaId: 'EP2026', disciplina: 'Estágio', tipo: 'pendente' }
  ];
  const exportable = filterExportableAllocations(allocs);
  const payload = buildSigaaExportPayload({
    cursoSigla: 'EP',
    turmaId: 'EP2026',
    turmaLabel: 'EP2026_BL1',
    periodoLetivo: 'PL2',
    termStart: '2026-03-09',
    termEnd: '2026-06-30',
    ofertas: exportable.map((alloc) => ({ componente: alloc.disciplina }))
  });

  assert.equal(exportable.length, 1);
  assert.deepEqual(payload.ofertas, [{ componente: 'Algoritmos' }]);
});
