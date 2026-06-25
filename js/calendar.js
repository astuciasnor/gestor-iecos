import { store } from './store.js??v=20260625v';
import { getDaysArray, toLocalDateString } from './utils.js';
import { mapSlotToTurno, normalizeTurnoKey } from './turns.js';

function normalizeKeyPart(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeTeacherKey(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeCalendarSlotKey(value) {
  const match = String(value || '').match(/\d{1,2}:\d{2}/);
  if (match) return match[0];
  return String(value || '').replace(/[^0-9:]/g, '');
}

function timeToMinutesSafe(value) {
  const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return (Number.parseInt(match[1], 10) * 60) + Number.parseInt(match[2], 10);
}

function addDaysISO(dateStr, days = 0) {
  const raw = String(dateStr || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const date = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString().split('T')[0];
}

function normalizeDayList(days = []) {
  return [...new Set((Array.isArray(days) ? days : [])
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => value >= 1 && value <= 6))]
    .sort((left, right) => left - right);
}

function normalizeSlotList(slots = []) {
  return [...new Set((Array.isArray(slots) ? slots : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))]
    .sort((left, right) => timeToMinutesSafe(left) - timeToMinutesSafe(right));
}

function normalizeDrawnSlotsByDay(raw = {}) {
  const normalized = {};

  Object.entries(raw || {}).forEach(([day, slots]) => {
    const dayNumber = Number.parseInt(day, 10);
    if (dayNumber < 1 || dayNumber > 6) return;
    const normalizedSlots = normalizeSlotList(slots);
    if (normalizedSlots.length > 0) normalized[dayNumber] = normalizedSlots;
  });

  return normalized;
}

function buildDrawnSlotsByDay(days = [], slots = []) {
  const map = {};
  const normalizedDays = normalizeDayList(days);
  const normalizedSlots = normalizeSlotList(slots);

  normalizedDays.forEach((day) => {
    map[day] = normalizedSlots.slice();
  });

  return map;
}

function getNativeTurnoValueForAllocation(allocation = {}) {
  return store.rawData?.turmas?.find((turma) => String(turma?.turma_id) === String(allocation?.turmaId))?.turno
    || allocation?.turno
    || 'Tarde';
}

function applyExceptionalSaturdayShift(allocation = {}, dayOfWeek = 0, slots = []) {
  const normalizedSlots = normalizeSlotList(slots);
  if (!allocation?.sabadoManha || dayOfWeek !== 6 || normalizedSlots.length === 0) return normalizedSlots;

  const nativeTurno = getNativeTurnoValueForAllocation(allocation);
  if (normalizeTurnoKey(nativeTurno) === 'manha') return normalizedSlots;

  return normalizeSlotList(
    normalizedSlots.map((slot) => mapSlotToTurno(
      slot,
      nativeTurno,
      'Manha',
      store.getActiveHorariosPorTurno()
    ))
  );
}

function getCalendarConflictIdentity(event, slotKey) {
  return [
    String(event?.id || ''),
    String(event?.turmaId || ''),
    String(event?.disciplina || ''),
    String(event?.subGrupo || ''),
    normalizeCalendarSlotKey(event?.horario || slotKey || '')
  ].join('|');
}

function markCalendarVisualConflicts(events = []) {
  const slotMap = new Map();

  (events || []).forEach((event) => {
    const slotKey = normalizeCalendarSlotKey(event?.horario || '');
    if (!slotKey) return;

    if (!slotMap.has(slotKey)) slotMap.set(slotKey, []);
    const items = slotMap.get(slotKey);
    const identity = getCalendarConflictIdentity(event, slotKey);
    if (!items.some((item) => item.identity === identity)) {
      items.push({ identity, event });
    }
  });

  slotMap.forEach((items, slotKey) => {
    if (items.length < 2) return;
    items.forEach(({ event }) => {
      if (!event.conflictsAt) event.conflictsAt = [];
      if (!event.conflictsAt.includes(slotKey)) event.conflictsAt.push(slotKey);
      event.isConflict = true;
    });
  });
}

function buildOfferKey(allocation) {
  return [
    normalizeKeyPart(allocation?.turmaId),
    normalizeKeyPart(allocation?.disciplina),
    normalizeKeyPart(allocation?.subGrupo)
  ].join('|');
}

function allocationMatchesTeacherFilter(allocation, docenteFilter = '') {
  const filter = String(docenteFilter || '').trim();
  if (!filter) return true;

  if (typeof allocation?.docente === 'string' && allocation.docente.trim() === filter) return true;
  if (allocation?.docente?.nome && String(allocation.docente.nome).trim() === filter) return true;

  if (Array.isArray(allocation?.docentes)) {
    return allocation.docentes.some((docente) => {
      const nome = docente?.nome || docente;
      return String(nome || '').trim() === filter;
    });
  }

  return false;
}

function normalizeDeclaredFaixas(allocation, defaultStart = '', defaultEnd = '') {
  const fallbackStart = String(allocation?.dataInicio || defaultStart || '').trim();
  const fallbackEnd = String(allocation?.dataFim || defaultEnd || fallbackStart || '').trim();
  const fallbackDays = Array.isArray(allocation?.diasMarcados) && allocation.diasMarcados.length > 0
    ? allocation.diasMarcados
    : (allocation?.usaSabado ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5]);
  const fallbackSlots = Array.isArray(allocation?.horariosOcupados) ? allocation.horariosOcupados : [];
  const declaredFaixas = Array.isArray(allocation?.faixas) ? allocation.faixas : [];
  const normalized = [];

  declaredFaixas.forEach((faixa) => {
    const inicio = String(faixa?.inicio || fallbackStart || '').trim();
    if (!inicio) return;

    let drawnSlotsByDay = normalizeDrawnSlotsByDay(faixa?.drawnSlotsByDay || {});
    let dias = normalizeDayList(faixa?.dias || faixa?.diasMarcados || fallbackDays);
    let slots = normalizeSlotList(faixa?.slots || faixa?.horariosOcupados || fallbackSlots);

    if (Object.keys(drawnSlotsByDay).length > 0) {
      dias = normalizeDayList(Object.keys(drawnSlotsByDay));
      slots = normalizeSlotList(Object.values(drawnSlotsByDay).flat());
    } else if (dias.length > 0 && slots.length > 0) {
      drawnSlotsByDay = buildDrawnSlotsByDay(dias, slots);
    }

    if (dias.length === 0 || slots.length === 0) return;

    normalized.push({
      inicio,
      fim: String(faixa?.fim || '').trim(),
      dias,
      slots,
      drawnSlotsByDay
    });
  });

  normalized.sort((left, right) => {
    const startDiff = String(left.inicio || '').localeCompare(String(right.inicio || ''));
    if (startDiff !== 0) return startDiff;
    return String(left.fim || '').localeCompare(String(right.fim || ''));
  });

  return normalized.map((faixa, index) => {
    const nextFaixa = normalized[index + 1];
    let resolvedEnd = String(faixa?.fim || '').trim();

    if (!resolvedEnd && nextFaixa?.inicio) resolvedEnd = addDaysISO(nextFaixa.inicio, -1);
    if (!resolvedEnd) resolvedEnd = fallbackEnd || faixa.inicio;
    if (resolvedEnd < faixa.inicio) resolvedEnd = faixa.inicio;

    return {
      ...faixa,
      fim: resolvedEnd
    };
  });
}

function buildCanonicalFaixasForAllocation(allocation, defaultStart = '', defaultEnd = '') {
  const declaredFaixas = normalizeDeclaredFaixas(allocation, defaultStart, defaultEnd);
  if (declaredFaixas.length > 0) return declaredFaixas;

  const weeklyDay = Number.parseInt(allocation?.diaSemana, 10) || 0;
  const weeklySlot = String(allocation?.horario || '').trim();
  if (weeklyDay >= 1 && weeklyDay <= 6 && weeklySlot) {
    const inicio = String(allocation?.dataInicio || defaultStart || '').trim();
    const fim = String(allocation?.dataFim || defaultEnd || inicio || '').trim();
    return [{
      inicio,
      fim: fim || inicio,
      dias: [weeklyDay],
      slots: [weeklySlot],
      drawnSlotsByDay: {
        [weeklyDay]: [weeklySlot]
      }
    }];
  }

  const dias = Array.isArray(allocation?.diasMarcados) && allocation.diasMarcados.length > 0
    ? allocation.diasMarcados
    : (allocation?.usaSabado ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5]);
  const slots = Array.isArray(allocation?.horariosOcupados) ? allocation.horariosOcupados : [];
  const inicio = String(allocation?.dataInicio || defaultStart || '').trim();
  const fim = String(allocation?.dataFim || defaultEnd || inicio || '').trim();

  if (!inicio || slots.length === 0) return [];
  return [{
    inicio,
    fim: fim || inicio,
    dias: normalizeDayList(dias),
    slots: normalizeSlotList(slots),
    drawnSlotsByDay: buildDrawnSlotsByDay(dias, slots)
  }];
}

function resolveSlotsForDate(faixas = [], dateStr = '', dayOfWeek = 0) {
  if (!dateStr || dayOfWeek < 1 || dayOfWeek > 6) return [];

  for (let index = faixas.length - 1; index >= 0; index -= 1) {
    const faixa = faixas[index];
    if (!faixa) continue;
    if (dateStr < faixa.inicio) continue;
    if (faixa.fim && dateStr > faixa.fim) continue;
    if (!Array.isArray(faixa.dias) || !faixa.dias.includes(dayOfWeek)) return [];

    const daySlots = faixa?.drawnSlotsByDay?.[dayOfWeek];
    return normalizeSlotList(Array.isArray(daySlots) && daySlots.length > 0 ? daySlots : faixa.slots);
  }

  return [];
}

function buildCandidateSlotsByDate(allocation, computationDays = [], feriadosSet = new Set(), defaultStart = '', defaultEnd = '') {
  const faixas = buildCanonicalFaixasForAllocation(allocation, defaultStart, defaultEnd);
  const byDate = {};

  computationDays.forEach((date) => {
    const dateStr = toLocalDateString(date);
    const dayOfWeek = date.getDay();

    if (dayOfWeek === 0) return;
    if (feriadosSet.has(dateStr)) return;

    const slots = applyExceptionalSaturdayShift(
      allocation,
      dayOfWeek,
      resolveSlotsForDate(faixas, dateStr, dayOfWeek)
    );
    if (slots.length > 0) byDate[dateStr] = slots;
  });

  return { faixas, byDate };
}

function buildBaseSlotsFromFaixas(faixas = []) {
  return normalizeSlotList((faixas || []).flatMap((faixa) => faixa?.slots || []));
}

function buildTurmaToCursoMap() {
  const map = {};
  (Array.isArray(store.rawData?.turmas) ? store.rawData.turmas : []).forEach((turma) => {
    if (turma?.turma_id && turma?.sigla) map[String(turma.turma_id)] = turma.sigla;
  });
  return map;
}

function buildCursoComponentCHMap() {
  const map = {};
  (Array.isArray(store.rawData?.componentes) ? store.rawData.componentes : []).forEach((component) => {
    if (!component?.sigla || !component?.componente) return;
    if (!map[component.sigla]) map[component.sigla] = {};
    map[component.sigla][component.componente] = Number(component.ch || 0);
  });
  return map;
}

function resolveOfferWorkloadLimit(allocation, turmaToCurso = {}, cursoRules = {}) {
  const cursoSigla = turmaToCurso[String(allocation?.turmaId || '')];
  const courseCH = cursoSigla && cursoRules[cursoSigla]
    ? Number(cursoRules[cursoSigla][allocation?.disciplina] || 0)
    : 0;
  const allocationCH = Number(allocation?.ch || 0);
  const resolved = Math.max(courseCH, allocationCH);
  return Number.isFinite(resolved) && resolved > 0 ? resolved : 0;
}

function resolveAllocationTeacherForHour(allocation, currentHourNum) {
  let slotDocente = allocation?.docente;
  if (Array.isArray(allocation?.docentes) && allocation.docentes.length > 0) {
    let accumulated = 0;
    for (const docente of allocation.docentes) {
      accumulated += Number.parseInt(docente?.ch, 10) || 0;
      if (currentHourNum <= accumulated) {
        slotDocente = docente?.nome || docente;
        break;
      }
    }
  }
  return slotDocente;
}

function buildAllocationDescriptors(allocations = [], computationDays = [], feriadosSet = new Set(), defaultStart = '', defaultEnd = '') {
  const turmaToCurso = buildTurmaToCursoMap();
  const cursoRules = buildCursoComponentCHMap();

  return allocations.map((allocation) => {
    const { faixas, byDate } = buildCandidateSlotsByDate(allocation, computationDays, feriadosSet, defaultStart, defaultEnd);
    return {
      allocation,
      allocationId: allocation?.id,
      offerKey: buildOfferKey(allocation),
      maxCH: resolveOfferWorkloadLimit(allocation, turmaToCurso, cursoRules),
      faixas,
      candidateSlotsByDate: byDate,
      baseSlots: buildBaseSlotsFromFaixas(faixas)
    };
  }).filter((descriptor) => descriptor.allocationId);
}

function buildActualOccurrences(descriptors = [], computationDays = [], visibleDateSet = new Set(), feriadosSet = new Set()) {
  const executionCountByOffer = new Map();
  const actualExecutionByAlloc = new Map();
  const visibleOccurrencesByDate = {};
  const descriptorsByAllocationId = new Map();
  const maxCHByOffer = new Map();

  descriptors.forEach((descriptor) => {
    descriptorsByAllocationId.set(descriptor.allocationId, descriptor);
    const current = maxCHByOffer.get(descriptor.offerKey) || 0;
    const next = Number(descriptor.maxCH || 0);
    maxCHByOffer.set(descriptor.offerKey, Math.max(current, next));
  });

  computationDays.forEach((date) => {
    const dateStr = toLocalDateString(date);
    const dayOfWeek = date.getDay();

    if (dayOfWeek === 0 || feriadosSet.has(dateStr)) {
      if (visibleDateSet.has(dateStr)) visibleOccurrencesByDate[dateStr] = [];
      return;
    }

    const candidates = [];
    descriptors.forEach((descriptor) => {
      const slots = descriptor.candidateSlotsByDate[dateStr] || [];
      slots.forEach((slotTime) => {
        candidates.push({ descriptor, slotTime });
      });
    });

    candidates.sort((left, right) => {
      const slotDiff = timeToMinutesSafe(left.slotTime) - timeToMinutesSafe(right.slotTime);
      if (slotDiff !== 0) return slotDiff;
      const disciplinaDiff = String(left.descriptor?.allocation?.disciplina || '').localeCompare(String(right.descriptor?.allocation?.disciplina || ''));
      if (disciplinaDiff !== 0) return disciplinaDiff;
      return String(left.descriptor?.allocationId || '').localeCompare(String(right.descriptor?.allocationId || ''));
    });

    const visibleOccurrences = [];
    candidates.forEach(({ descriptor, slotTime }) => {
      const currentCount = executionCountByOffer.get(descriptor.offerKey) || 0;
      const maxCH = maxCHByOffer.get(descriptor.offerKey) || 0;
      if (maxCH > 0 && currentCount >= maxCH) return;

      const occurrenceIndex = currentCount + 1;
      executionCountByOffer.set(descriptor.offerKey, occurrenceIndex);

      if (!actualExecutionByAlloc.has(descriptor.allocationId)) actualExecutionByAlloc.set(descriptor.allocationId, {});
      const byDate = actualExecutionByAlloc.get(descriptor.allocationId);
      if (!Array.isArray(byDate[dateStr])) byDate[dateStr] = [];
      byDate[dateStr].push(slotTime);

      if (visibleDateSet.has(dateStr)) {
        visibleOccurrences.push({
          allocationId: descriptor.allocationId,
          horario: slotTime,
          docente: resolveAllocationTeacherForHour(descriptor.allocation, occurrenceIndex),
          occurrenceIndex
        });
      }
    });

    if (visibleDateSet.has(dateStr)) visibleOccurrencesByDate[dateStr] = visibleOccurrences;
  });

  return {
    descriptorsByAllocationId,
    actualExecutionByAlloc,
    visibleOccurrencesByDate
  };
}

function buildDerivedAllocationMeta(actualExecutionByAlloc = new Map(), descriptorsByAllocationId = new Map()) {
  const metaByAllocationId = new Map();

  descriptorsByAllocationId.forEach((descriptor, allocationId) => {
    const executionByDate = actualExecutionByAlloc.get(allocationId) || {};
    const activeDates = Object.keys(executionByDate).sort((left, right) => left.localeCompare(right));
    const lastDate = activeDates[activeDates.length - 1] || '';

    metaByAllocationId.set(allocationId, {
      executionByDate,
      horariosBase: descriptor.baseSlots,
      dataInicio: activeDates[0] || descriptor.allocation?.dataInicio || '',
      dataFim: lastDate || descriptor.allocation?.dataFim || descriptor.allocation?.dataInicio || '',
      horariosUltimoDia: lastDate ? (executionByDate[lastDate] || []).slice() : []
    });
  });

  return metaByAllocationId;
}

export function getCalendarEvents(turmaId, startDate, endDate, docenteFilter = null) {
  const visibleDays = getDaysArray(startDate, endDate);
  const visibleDateSet = new Set(visibleDays.map((date) => toLocalDateString(date)));
  const feriadosList = Array.isArray(store.rawData?.feriados) ? store.rawData.feriados : [];
  const feriadosSet = new Set(feriadosList.map((feriado) => feriado?.data || feriado).filter(Boolean));
  const computationStart = String(store.settings.termStart || startDate || '').trim();
  const computationDays = getDaysArray(computationStart || startDate, endDate);

  const filteredAllocations = store.allocations.filter((allocation) => {
    if (turmaId && String(allocation?.turmaId || '') !== String(turmaId)) return false;
    if (docenteFilter) return allocationMatchesTeacherFilter(allocation, docenteFilter);
    return !!turmaId;
  });

  const descriptors = buildAllocationDescriptors(
    filteredAllocations,
    computationDays,
    feriadosSet,
    computationStart || startDate,
    endDate
  );

  const {
    descriptorsByAllocationId,
    actualExecutionByAlloc,
    visibleOccurrencesByDate
  } = buildActualOccurrences(descriptors, computationDays, visibleDateSet, feriadosSet);
  const derivedMetaByAllocationId = buildDerivedAllocationMeta(actualExecutionByAlloc, descriptorsByAllocationId);
  const calendarData = {};

  visibleDays.forEach((date) => {
    const dateStr = toLocalDateString(date);
    const dayOfWeek = date.getDay();

    if (dayOfWeek === 0) {
      calendarData[dateStr] = [];
      return;
    }

    const feriadoObj = feriadosList.find((feriado) => (feriado?.data || feriado) === dateStr);
    if (feriadoObj) {
      calendarData[dateStr] = [{ type: 'holiday', title: feriadoObj?.feriado || 'Feriado' }];
      return;
    }

    const events = [];
    (visibleOccurrencesByDate[dateStr] || []).forEach((occurrence) => {
      const descriptor = descriptorsByAllocationId.get(occurrence.allocationId);
      if (!descriptor) return;
      if (docenteFilter && normalizeTeacherKey(occurrence.docente) !== normalizeTeacherKey(docenteFilter)) return;

      const allocation = descriptor.allocation;
      const derivedMeta = derivedMetaByAllocationId.get(occurrence.allocationId) || {};

      events.push({
        ...allocation,
        title: allocation?.disciplina,
        docente: occurrence.docente,
        horario: occurrence.horario,
        horariosBase: Array.isArray(derivedMeta.horariosBase) ? derivedMeta.horariosBase.slice() : [],
        horariosOcupados: null,
        executionByDate: derivedMeta.executionByDate || {},
        dataInicio: derivedMeta.dataInicio || allocation?.dataInicio || '',
        dataFim: derivedMeta.dataFim || allocation?.dataFim || allocation?.dataInicio || '',
        horariosUltimoDia: Array.isArray(derivedMeta.horariosUltimoDia) ? derivedMeta.horariosUltimoDia.slice() : [],
        offerKey: descriptor.offerKey,
        occurrenceIndex: occurrence.occurrenceIndex
      });
    });

    markCalendarVisualConflicts(events);
    events.sort((left, right) => normalizeCalendarSlotKey(left?.horario || '').localeCompare(normalizeCalendarSlotKey(right?.horario || '')));
    calendarData[dateStr] = events;
  });

  return calendarData;
}
