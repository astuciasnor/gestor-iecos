// ---------------------------------------------------------------------------
// REDE DE TESTES "GOLDEN" DO MOTOR DE ALOCACAO DE COMPONENTES
// ---------------------------------------------------------------------------
// Objetivo: tornar o motor RASTREAVEL e PREVISIVEL. Cada teste fixa (pin) o
// comportamento observavel das 3 funcoes puras que decidem o que uma componente
// aloca ao longo do periodo letivo e como ela interage com as demais:
//
//   1) generateAllocationOccurrences (academic_rules.mjs)
//      -> dado o padrao das faixas (dias/horarios), datas validas do periodo,
//         data de inicio e carga horaria, produz EXATAMENTE quais slots caem em
//         quais dias. E o coracao da fidelidade "faixa -> calendario".
//
//   2) getTeacherActiveShifts (academic_rules.mjs)
//      -> quais turnos ficam ativos na agenda do docente (inclui a regra do
//         sabado de manha que ativa a Manha mesmo em aula de outro turno).
//
//   3) detectTeacherConflicts (conflicts.js)
//      -> sobreposicao do docente: mesmo horario/dia em componentes distintas.
//
// Estes testes sao CARACTERIZACAO: refletem o comportamento ATUAL. Se um deles
// quebrar apos uma mudanca, e um alerta de que o motor mudou de forma observavel
// por algum consumidor (calendario turma/docente, gantt, lista, SIGAA, agenda
// publica) — o ponto cego que queremos evitar.
// ---------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateAllocationOccurrences,
  getTeacherActiveShifts
} from '../js/academic_rules.mjs';
import { detectTeacherConflicts } from '../js/conflicts.js';

// Helper: dias uteis consecutivos (segunda a sexta ficticios) para cenarios.
const DIAS = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09'];
const QUATRO_SLOTS = ['M1', 'M2', 'M3', 'M4'];

function slotsPorDia(dias, slots) {
  const map = {};
  dias.forEach((d) => { map[d] = slots.slice(); });
  return map;
}

// =====================================================================
// GRUPO 1 — generateAllocationOccurrences: alocacao ao longo do periodo
// =====================================================================

test('componente para quando a carga horaria total e atingida (ultimo dia parcial)', () => {
  const res = generateAllocationOccurrences({
    totalWorkload: 6,
    nextValidDate: DIAS[0],
    semesterEndDate: '2026-12-31',
    scheduleDates: DIAS.slice(0, 4),
    slotsByDate: slotsPorDia(DIAS.slice(0, 4), QUATRO_SLOTS)
  });

  // Dia 1 consome 4h; dia 2 consome so as 2h restantes (parcial).
  assert.deepEqual(res.byDate, {
    '2026-01-05': ['M1', 'M2', 'M3', 'M4'],
    '2026-01-06': ['M1', 'M2']
  });
  assert.equal(res.totalAllocatedHours, 6);
  assert.equal(res.remainingHours, 0);
  assert.equal(res.lastDate, '2026-01-06');
  assert.equal(res.lastOccurrenceHours, 2);
  assert.equal(res.partialFinalDay, true);
  assert.equal(res.stopReason, 'fractional-final');
});

test('encaixe exato da carga horaria nao marca dia final como parcial', () => {
  const res = generateAllocationOccurrences({
    totalWorkload: 8,
    nextValidDate: DIAS[0],
    semesterEndDate: '2026-12-31',
    scheduleDates: DIAS.slice(0, 3),
    slotsByDate: slotsPorDia(DIAS.slice(0, 3), QUATRO_SLOTS)
  });

  assert.deepEqual(res.byDate, {
    '2026-01-05': ['M1', 'M2', 'M3', 'M4'],
    '2026-01-06': ['M1', 'M2', 'M3', 'M4']
  });
  assert.equal(res.totalAllocatedHours, 8);
  assert.equal(res.remainingHours, 0);
  assert.equal(res.partialFinalDay, false);
  assert.equal(res.stopReason, 'workload-complete');
});

test('alocacao e cortada no fim do periodo letivo (clip por semester-bound)', () => {
  const res = generateAllocationOccurrences({
    totalWorkload: 40, // muito alta de proposito
    nextValidDate: DIAS[0],
    semesterEndDate: '2026-01-06', // corta apos o 2o dia
    scheduleDates: DIAS.slice(0, 4),
    slotsByDate: slotsPorDia(DIAS.slice(0, 4), QUATRO_SLOTS)
  });

  assert.deepEqual(res.byDate, {
    '2026-01-05': ['M1', 'M2', 'M3', 'M4'],
    '2026-01-06': ['M1', 'M2', 'M3', 'M4']
  });
  assert.equal(res.totalAllocatedHours, 8);
  assert.equal(res.remainingHours, 32); // ficou faltando CH
  assert.equal(res.wasClippedToSemesterEnd, true);
  assert.equal(res.stopReason, 'semester-bound');
});

test('modo "planejado por semana" (sem CH total) limita slots por dia', () => {
  const res = generateAllocationOccurrences({
    totalWorkload: 0,
    weeklyPlannedWorkload: 2,
    nextValidDate: DIAS[0],
    semesterEndDate: '2026-12-31',
    scheduleDates: DIAS.slice(0, 2),
    slotsByDate: slotsPorDia(DIAS.slice(0, 2), QUATRO_SLOTS)
  });

  // Cada dia usa no maximo 2 slots (o planejado), mesmo havendo 4 disponiveis.
  assert.deepEqual(res.byDate, {
    '2026-01-05': ['M1', 'M2'],
    '2026-01-06': ['M1', 'M2']
  });
  assert.equal(res.totalAllocatedHours, 4);
});

test('nextValidDate (inicio da faixa) descarta dias anteriores', () => {
  const res = generateAllocationOccurrences({
    totalWorkload: 4,
    nextValidDate: DIAS[2], // comeca so no 3o dia
    semesterEndDate: '2026-12-31',
    scheduleDates: DIAS,
    slotsByDate: slotsPorDia(DIAS, QUATRO_SLOTS)
  });

  assert.deepEqual(Object.keys(res.byDate), ['2026-01-07']);
  assert.deepEqual(res.byDate['2026-01-07'], ['M1', 'M2', 'M3', 'M4']);
});

test('slots de INTERVALO nao contam carga horaria', () => {
  const comIntervalo = ['M1', 'M2', 'INTERVALO', 'M3'];
  const res = generateAllocationOccurrences({
    totalWorkload: 3,
    nextValidDate: DIAS[0],
    semesterEndDate: '2026-12-31',
    scheduleDates: DIAS.slice(0, 1),
    slotsByDate: { [DIAS[0]]: comIntervalo }
  });

  // As 3h consomem M1, M2, M3 (o INTERVALO e ignorado na contagem).
  assert.deepEqual(res.byDate[DIAS[0]], ['M1', 'M2', 'M3']);
  assert.equal(res.totalAllocatedHours, 3);
  assert.equal(res.remainingHours, 0);
});

test('dias sem slots de aula sao pulados sem consumir CH', () => {
  const res = generateAllocationOccurrences({
    totalWorkload: 4,
    nextValidDate: DIAS[0],
    semesterEndDate: '2026-12-31',
    scheduleDates: DIAS.slice(0, 3),
    slotsByDate: {
      [DIAS[0]]: [],                 // sem aula
      [DIAS[1]]: ['INTERVALO'],      // so intervalo -> sem CH
      [DIAS[2]]: QUATRO_SLOTS
    }
  });

  assert.deepEqual(Object.keys(res.byDate), ['2026-01-07']);
  assert.equal(res.totalAllocatedHours, 4);
});

// =====================================================================
// GRUPO 2 — getTeacherActiveShifts: turnos ativos na agenda do docente
// =====================================================================

const resolveShift = (horario) => {
  const first = String(horario || '').charAt(0).toUpperCase();
  if (first === 'M') return 'Manhã';
  if (first === 'T') return 'Tarde';
  return 'Noite';
};
const ORDEM_TURNOS = ['Manhã', 'Tarde', 'Noite'];

test('turno unico: agenda so de Noite ativa apenas Noite', () => {
  const shifts = getTeacherActiveShifts({
    eventsByDate: {
      '2026-01-05': [{ horario: 'N1' }],
      '2026-01-06': [{ horario: 'N2' }]
    },
    resolveShift,
    preferredOrder: ORDEM_TURNOS
  });

  assert.equal(shifts.length, 1);
  assert.equal(shifts[0].normalized, 'noite');
  assert.equal(shifts[0].count, 2);
});

test('sabado de manha ativa o turno da Manha mesmo em aula da Noite', () => {
  const shifts = getTeacherActiveShifts({
    eventsByDate: {
      '2026-01-10': [{ horario: 'N1', sabadoManha: true }]
    },
    resolveShift,
    preferredOrder: ORDEM_TURNOS
  });

  const chaves = shifts.map((s) => s.normalized);
  assert.deepEqual(chaves, ['manha', 'noite']); // Manha vem 1o pela ordem preferida
});

test('turnos sao ordenados pela ordem preferida (Manha, Tarde, Noite)', () => {
  const shifts = getTeacherActiveShifts({
    eventsByDate: {
      '2026-01-05': [{ horario: 'N1' }, { horario: 'M1' }, { horario: 'T1' }]
    },
    resolveShift,
    preferredOrder: ORDEM_TURNOS
  });

  assert.deepEqual(shifts.map((s) => s.normalized), ['manha', 'tarde', 'noite']);
});

// =====================================================================
// GRUPO 3 — detectTeacherConflicts: sobreposicao do docente
// =====================================================================

test('duas componentes no mesmo horario/dia geram um conflito', () => {
  const conflitos = detectTeacherConflicts({
    eventsByDate: {
      '2026-01-05': [
        { horario: 'M1', turmaId: 'EP2026', disciplina: 'BIOQUIMICA', subGrupo: '' },
        { horario: 'M1', turmaId: 'CB2026', disciplina: 'CALCULO', subGrupo: '' }
      ]
    }
  });

  assert.equal(conflitos.length, 1);
  assert.equal(conflitos[0].slot, 'M1');
  assert.deepEqual(conflitos[0].turmas, ['CB2026', 'EP2026']);
  assert.deepEqual(conflitos[0].componentes, ['BIOQUIMICA', 'CALCULO']);
  assert.equal(conflitos[0].startDate, '2026-01-05');
  assert.equal(conflitos[0].endDate, '2026-01-05');
});

test('mesma componente (mesma turma/disciplina/subgrupo) NAO e conflito', () => {
  const conflitos = detectTeacherConflicts({
    eventsByDate: {
      '2026-01-05': [
        { horario: 'M1', turmaId: 'EP2026', disciplina: 'BIOQUIMICA', subGrupo: '' },
        { horario: 'M1', turmaId: 'EP2026', disciplina: 'BIOQUIMICA', subGrupo: '' }
      ]
    }
  });

  assert.deepEqual(conflitos, []);
});

test('conflito propaga flag "importado" quando qualquer lado veio de importacao', () => {
  const conflitos = detectTeacherConflicts({
    eventsByDate: {
      '2026-01-05': [
        { horario: 'T1', turmaId: 'EP2026', disciplina: 'ECOLOGIA', subGrupo: '', importado: true },
        { horario: 'T1', turmaId: 'CN2026', disciplina: 'FISICA', subGrupo: '' }
      ]
    }
  });

  assert.equal(conflitos.length, 1);
  assert.equal(conflitos[0].importado, true);
});

test('conflito recorrente agrega o intervalo de datas (inicio ao fim)', () => {
  const par = [
    { horario: 'N1', turmaId: 'EP2026', disciplina: 'ESTATISTICA', subGrupo: '' },
    { horario: 'N1', turmaId: 'CB2026', disciplina: 'GENETICA', subGrupo: '' }
  ];
  const conflitos = detectTeacherConflicts({
    eventsByDate: {
      '2026-01-05': par.map((e) => ({ ...e })),
      '2026-01-07': par.map((e) => ({ ...e })),
      '2026-01-06': par.map((e) => ({ ...e }))
    }
  });

  assert.equal(conflitos.length, 1);
  assert.equal(conflitos[0].startDate, '2026-01-05');
  assert.equal(conflitos[0].endDate, '2026-01-07');
});

test('horarios diferentes no mesmo dia NAO conflitam', () => {
  const conflitos = detectTeacherConflicts({
    eventsByDate: {
      '2026-01-05': [
        { horario: 'M1', turmaId: 'EP2026', disciplina: 'BIOQUIMICA', subGrupo: '' },
        { horario: 'M2', turmaId: 'CB2026', disciplina: 'CALCULO', subGrupo: '' }
      ]
    }
  });

  assert.deepEqual(conflitos, []);
});
