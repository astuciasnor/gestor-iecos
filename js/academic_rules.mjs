import { normalizePlanMeta as normalizeStoredPlanMeta } from './plan_storage.js';
import { ALLOCATION_MODES, inferAllocationModo } from './allocation_mode.mjs';

function toMiddayDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || '').trim())) return null;
  const date = new Date(`${dateStr}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toISODate(date) {
  return date instanceof Date && !Number.isNaN(date.getTime())
    ? date.toISOString().split('T')[0]
    : '';
}

function normalizePlanMeta(meta = {}) {
  return normalizeStoredPlanMeta(meta);
}

export function sortUniqueIsoDates(dates = []) {
  return [...new Set((Array.isArray(dates) ? dates : []).map((value) => String(value || '').trim()))]
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort((a, b) => a.localeCompare(b));
}

function normalizeSlotList(slots = []) {
  return [...new Set((Array.isArray(slots) ? slots : []).filter(Boolean).map(String))];
}

export function normalizeShiftKey(value = '') {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  if (normalized.includes('manh')) return 'manha';
  if (normalized.includes('tard')) return 'tarde';
  if (normalized.includes('noit')) return 'noite';
  return normalized;
}

function buildShiftLabelMap(order = []) {
  const labels = new Map();
  (Array.isArray(order) ? order : []).forEach((value) => {
    const normalized = normalizeShiftKey(value);
    if (!normalized) return;
    labels.set(normalized, String(value));
  });
  return labels;
}


export function addDaysISO(dateStr, days) {
  const date = toMiddayDate(dateStr);
  if (!date) return '';
  date.setDate(date.getDate() + Number(days || 0));
  return toISODate(date);
}

export function getWeekStartISO(dateStr) {
  const date = toMiddayDate(dateStr);
  if (!date) return '';
  const dow = date.getDay();
  const delta = dow === 0 ? -6 : (1 - dow);
  date.setDate(date.getDate() + delta);
  return toISODate(date);
}

export function resolveActiveAcademicPeriod({ plans = [], preferredMeta = null, fallbackMeta = null, today = '' } = {}) {
  const officialPlans = (Array.isArray(plans) ? plans : [])
    .map((plan) => ({
      ...normalizePlanMeta(plan),
      ano: plan?.ano
    }))
    .filter((plan) => plan.periodo && plan.termStart && plan.termEnd);

  const preferred = normalizePlanMeta(preferredMeta || fallbackMeta || {});
  if (!officialPlans.length) return preferred;

  const todayIso = /^\d{4}-\d{2}-\d{2}$/.test(String(today || '').trim())
    ? String(today).trim()
    : toISODate(new Date());
  const preferredYear = String(preferred.termStart || '').slice(0, 4);
  const activeNow = officialPlans.find((plan) => plan.termStart <= todayIso && plan.termEnd >= todayIso);
  const nextPlan = officialPlans.find((plan) => plan.termStart >= todayIso);
  const exactDateMatch = officialPlans.find(
    (plan) => plan.termStart === preferred.termStart && plan.termEnd === preferred.termEnd
  );

  return officialPlans.find((plan) => plan.key === preferred.key)
    || officialPlans.find((plan) => plan.periodo === preferred.periodo && plan.termStart === preferred.termStart && plan.termEnd === preferred.termEnd)
    || exactDateMatch
    || officialPlans.find((plan) => String(plan.ano || '') === preferredYear && plan.periodo === preferred.periodo)
    || officialPlans.find((plan) => plan.periodo === preferred.periodo)
    || activeNow
    || nextPlan
    || officialPlans[officialPlans.length - 1];
}

export function reconcileTurmaSelectionAfterPLChange({
  selectedCurso = '',
  selectedTurma = '',
  lastTurma = '',
  turmas = []
} = {}) {
  const validTurmas = (Array.isArray(turmas) ? turmas : []).filter((turma) => {
    if (!selectedCurso) return false;
    return String(turma?.sigla || '') === String(selectedCurso);
  });

  const validIds = new Set(validTurmas.map((turma) => String(turma?.turma_id || '').trim()).filter(Boolean));
  const current = String(selectedTurma || '').trim();
  const previous = String(lastTurma || '').trim();
  const resolvedTurma = validIds.has(current)
    ? current
    : (validIds.has(previous) ? previous : '');

  return {
    validTurmas,
    selectedTurma: resolvedTurma,
    wasCleared: !resolvedTurma && !!current,
    wasRecoveredFromLastContext: !validIds.has(current) && !!resolvedTurma && resolvedTurma === previous
  };
}

export function initializeWeeklyScheduleForTurma({
  termStart = '',
  turmaLastStart = '',
  latestAllocationEnd = '',
  preferredStart = ''
} = {}) {
  const resolvedStart = String(preferredStart || '').trim()
    || (String(latestAllocationEnd || '').trim() ? (addDaysISO(latestAllocationEnd, 1) || String(latestAllocationEnd || '').trim()) : '')
    || String(turmaLastStart || '').trim()
    || String(termStart || '').trim();

  return {
    firstFaixaStart: resolvedStart,
    weekStartISO: getWeekStartISO(resolvedStart || termStart || '')
  };
}

export function resetWeeklyViewOnTurmaChange({
  termStart = '',
  turmaFirstFaixaStart = '',
  fallbackDate = ''
} = {}) {
  const firstFaixaStart = String(termStart || '').trim()
    || String(turmaFirstFaixaStart || '').trim()
    || String(fallbackDate || '').trim();

  return {
    firstFaixaStart,
    weekStartISO: getWeekStartISO(firstFaixaStart || fallbackDate || '')
  };
}

export function computeRemainingFractionalHours(totalWorkload = 0, accumulatedAllocatedHours = 0) {
  const total = Number(totalWorkload || 0);
  const allocated = Number(accumulatedAllocatedHours || 0);
  if (!Number.isFinite(total) || total <= 0) return 0;
  if (!Number.isFinite(allocated) || allocated <= 0) return total;
  return Math.max(0, total - allocated);
}

export function validateOccurrenceWithinSemesterBounds({
  occurrenceDate = '',
  semesterEndDate = ''
} = {}) {
  const date = String(occurrenceDate || '').trim();
  const end = String(semesterEndDate || '').trim();
  if (!date || !end) return true;
  return date <= end;
}

export function generateAllocationOccurrences({
  totalWorkload = 0,
  weeklyPlannedWorkload = 0,
  accumulatedAllocatedHours = 0,
  nextValidDate = '',
  semesterEndDate = '',
  scheduleDates = [],
  slotsByDate = {}
} = {}) {
  const orderedDates = sortUniqueIsoDates(scheduleDates)
    .filter((dateStr) => !nextValidDate || dateStr >= String(nextValidDate).trim());
  const byDate = {};
  let allocatedHours = Number(accumulatedAllocatedHours || 0);
  let lastDate = '';
  let lastDaySlots = [];
  let lastOccurrenceHours = 0;
  let stopReason = '';
  let partialFinalDay = false;

  for (const dateStr of orderedDates) {
    if (!validateOccurrenceWithinSemesterBounds({ occurrenceDate: dateStr, semesterEndDate })) {
      stopReason = 'semester-bound';
      break;
    }

    const slots = normalizeSlotList(slotsByDate?.[dateStr]);
    if (slots.length === 0) continue;

    const remaining = computeRemainingFractionalHours(totalWorkload, allocatedHours);
    if (Number(totalWorkload || 0) > 0 && remaining <= 0) {
      stopReason = 'workload-complete';
      break;
    }

    const take = Number(totalWorkload || 0) > 0
      ? Math.min(remaining, slots.length)
      : (Number(weeklyPlannedWorkload || 0) > 0 ? Math.min(Number(weeklyPlannedWorkload || 0), slots.length) : slots.length);

    if (take <= 0) continue;

    const usedSlots = slots.slice(0, take);
    byDate[dateStr] = usedSlots;
    allocatedHours += usedSlots.length;
    lastDate = dateStr;
    lastDaySlots = usedSlots.slice();
    lastOccurrenceHours = usedSlots.length;

    if (usedSlots.length < slots.length) {
      partialFinalDay = true;
      stopReason = 'fractional-final';
    }

    if (Number(totalWorkload || 0) > 0 && computeRemainingFractionalHours(totalWorkload, allocatedHours) <= 0) {
      stopReason = stopReason || 'workload-complete';
      break;
    }
  }

  const remainingHours = computeRemainingFractionalHours(totalWorkload, allocatedHours);

  return {
    byDate,
    totalAllocatedHours: Math.max(0, allocatedHours - Number(accumulatedAllocatedHours || 0)),
    accumulatedAllocatedHours: allocatedHours,
    remainingHours,
    lastDate,
    lastDaySlots,
    lastOccurrenceHours,
    partialFinalDay,
    wasClippedToSemesterEnd: stopReason === 'semester-bound',
    stopReason
  };
}

export function getTeacherActiveShifts({
  eventsByDate = {},
  resolveShift = null,
  preferredOrder = []
} = {}) {
  const counts = new Map();
  const labelMap = buildShiftLabelMap(preferredOrder);

  Object.values(eventsByDate || {}).forEach((events) => {
    (Array.isArray(events) ? events : []).forEach((event) => {
      const shiftValue = typeof resolveShift === 'function'
        ? String(resolveShift(event?.horario || '', event) || '').trim()
        : '';
      const normalized = normalizeShiftKey(shiftValue);
      if (!normalized) return;
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
      if (!labelMap.has(normalized)) labelMap.set(normalized, shiftValue);
    });
  });

  const preferredNormalized = (Array.isArray(preferredOrder) ? preferredOrder : [])
    .map((value) => normalizeShiftKey(value))
    .filter(Boolean);

  return [...counts.entries()]
    .map(([normalized, count]) => ({
      normalized,
      value: labelMap.get(normalized) || normalized,
      label: labelMap.get(normalized) || normalized,
      count
    }))
    .sort((a, b) => {
      const idxA = preferredNormalized.indexOf(a.normalized);
      const idxB = preferredNormalized.indexOf(b.normalized);
      if (idxA >= 0 || idxB >= 0) {
        if (idxA < 0) return 1;
        if (idxB < 0) return -1;
        if (idxA !== idxB) return idxA - idxB;
      }
      return String(a.label || '').localeCompare(String(b.label || ''), 'pt-BR', { sensitivity: 'base' });
    });
}


export function filterExportableAllocations(allocations = []) {
  return (Array.isArray(allocations) ? allocations : []).filter((allocation) =>
    inferAllocationModo(allocation) !== ALLOCATION_MODES.PENDING
  );
}

export function buildSigaaExportPayload({
  generatedAt = '',
  plan = null,
  cursoSigla = '',
  turmaId = '',
  turmaLabel = '',
  periodoLetivo = '',
  termStart = '',
  termEnd = '',
  ofertas = []
} = {}) {
  return {
    generatedAt: generatedAt || new Date().toISOString(),
    plan,
    cursoSigla: String(cursoSigla || '').trim(),
    turmaId: String(turmaId || '').trim(),
    turmaLabel: String(turmaLabel || '').trim(),
    periodoLetivo: String(periodoLetivo || '').trim(),
    termStart: String(termStart || '').trim(),
    termEnd: String(termEnd || '').trim(),
    ofertas: Array.isArray(ofertas) ? ofertas.filter(Boolean) : []
  };
}
