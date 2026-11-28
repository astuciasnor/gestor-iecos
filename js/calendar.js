import { addDaysISO } from './datas.mjs?v=202611281702';
import { timeToMinutesSafe, normalizeDayList, normalizeSlotList, normalizeDrawnSlotsByDay, buildDrawnSlotsByDay } from './horarios.mjs?v=202611281702';
import { normalizeKeyPart, normalizeKeyPart as normalizeTeacherKey } from './texto.mjs?v=202611281702';
import { getNativeTurnoValueForAllocation, getQuadroTodosRegimes } from './turno_helpers.js?v=202611281702';
import { store } from './store.js?v=202611281702';
import { getDaysArray, toLocalDateString } from './utils.js?v=202611281702';
import { mapSlotToTurno, turnoDaTurmaInclui } from './turns.js?v=202611281702';
import { slotLabelsOverlap } from './academic_rules.mjs?v=202611281702';
import { mesmoDocente } from './docente_nomes.mjs?v=202611281702';
import { datasFeriadoDaTurma, feriadosDaTurma } from './feriados.mjs?v=202611281702';
import { estagioContaChoque, ehEstagio } from './estagio.mjs?v=202611281702';

function normalizeCalendarSlotKey(value) {
  const match = String(value || '').match(/\d{1,2}:\d{2}/);
  if (match) return match[0];
  return String(value || '').replace(/[^0-9:]/g, '');
}

function applyExceptionalSaturdayShift(allocation = {}, dayOfWeek = 0, slots = []) {
  const normalizedSlots = normalizeSlotList(slots);
  if (!allocation?.sabadoManha || dayOfWeek !== 6 || normalizedSlots.length === 0) return normalizedSlots;

  const nativeTurno = getNativeTurnoValueForAllocation(allocation);
  // Turma que ja tem aula de manha (Manha, Manha+Tarde, Integral): o sabado fica
  // no horario desenhado.
  if (turnoDaTurmaInclui(nativeTurno, 'manha')) return normalizedSlots;

  // Horarios do regime do curso DA TURMA, nao o da tela: a agenda publica nao
  // escolhe curso e ficava no regime padrao (13:30), sem achar o 14:00 do
  // regime 2; o sabado aparecia a tarde (28/11/2026).
  const turma = (store.rawData?.turmas || []).find((t) => String(t?.turma_id) === String(allocation?.turmaId || ''));
  const horarios = store.getHorariosPorTurnoDoCurso(turma?.sigla || store.selectedCurso);
  return normalizeSlotList(
    normalizedSlots.map((slot) => mapSlotToTurno(slot, nativeTurno, 'Manha', horarios))
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

function markEventConflict({ event, slotKey }, other) {
  if (!event.conflictsAt) event.conflictsAt = [];
  if (!event.conflictsAt.includes(slotKey)) event.conflictsAt.push(slotKey);
  event.isConflict = true;

  // Com quem choca: a outra aula pode estar em outro quadro de horario e nao
  // aparecer na mesma linha do calendario.
  if (!event.conflictPartners) event.conflictPartners = [];
  const partner = { turmaId: other?.turmaId, disciplina: other?.disciplina };
  if (!event.conflictPartners.some((p) => p.turmaId === partner.turmaId && p.disciplina === partner.disciplina)) {
    event.conflictPartners.push(partner);
  }
}

function markCalendarVisualConflicts(events = [], doDocente = false) {
  const items = [];

  (events || []).forEach((event) => {
    const slotKey = normalizeCalendarSlotKey(event?.horario || '');
    if (!slotKey) return;
    // Estagio que nao gera choque (js/estagio.mjs): na agenda do docente vale a regra do docente.
    if (doDocente ? event?.semChoqueDocente : event?.semChoque) return;

    const identity = getCalendarConflictIdentity(event, slotKey);
    if (!items.some((item) => item.identity === identity)) {
      items.push({ identity, event, slotKey });
    }
  });

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (!slotLabelsOverlap(a.event?.horario || a.slotKey, b.event?.horario || b.slotKey)) continue;
      markEventConflict(a, b.event);
      markEventConflict(b, a.event);
    }
  }
}

function buildOfferKey(allocation) {
  return [
    normalizeKeyPart(allocation?.turmaId),
    normalizeKeyPart(allocation?.disciplina),
    normalizeKeyPart(allocation?.subGrupo)
  ].join('|');
}

// Mesmo professor com ou sem acento ("Zelia" = "Zélia", ver mesmoDocente):
// uma grafia diferente nao pode esconder aulas do calendario nem um choque.
function allocationMatchesTeacherFilter(allocation, docenteFilter = '') {
  if (!String(docenteFilter || '').trim()) return true;
  if (typeof allocation?.docente === 'string' && mesmoDocente(allocation.docente, docenteFilter)) return true;
  if (allocation?.docente?.nome && mesmoDocente(allocation.docente.nome, docenteFilter)) return true;
  if (Array.isArray(allocation?.docentes)) {
    return allocation.docentes.some((docente) => mesmoDocente(docente?.nome || docente, docenteFilter));
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
      drawnSlotsByDay,
      ...(['campo', 'encontro'].includes(faixa?.estagio) ? { estagio: faixa.estagio } : {})
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

// Faixa que vale no dia (mesma busca de resolveSlotsForDate). Serve para saber
// se a aula de estagio e de campo ou de encontro (20/11/2026).
function faixaNoDia(faixas = [], dateStr = '') {
  for (let index = faixas.length - 1; index >= 0; index -= 1) {
    const faixa = faixas[index];
    if (!faixa || dateStr < faixa.inicio) continue;
    if (faixa.fim && dateStr > faixa.fim) continue;
    return faixa;
  }
  return null;
}

// Choque das aulas de estagio no dia: para a turma e para o docente.
// faixas: as faixas normalizadas da alocacao (com a marca campo/encontro).
// Unica fonte da regra: o calendario e a componente em edicao
// (candidatoSemChoque, js/faixa_utils.js) usam esta mesma funcao.
export function regrasDoEstagioNoDia(allocation, faixas, dateStr, horario) {
  const disciplina = allocation?.disciplina;
  if (!ehEstagio(disciplina)) return { semChoque: false, semChoqueDocente: false, estagioCampo: false };
  const faixa = faixaNoDia(faixas, dateStr);
  const base = {
    disciplina,
    horario,
    tipo: faixa?.estagio || '',
    slotsDaFaixa: faixa?.slots || [],
    turnoDaTurma: getNativeTurnoValueForAllocation(allocation),
    horariosPorTurno: getQuadroTodosRegimes()
  };
  return {
    semChoque: !estagioContaChoque(base, 'turma'),
    semChoqueDocente: !estagioContaChoque(base, 'docente'),
    estagioCampo: base.tipo === 'campo'
  };
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

function buildAllocationDescriptors(allocations = [], computationDays = [], feriadosList = [], defaultStart = '', defaultEnd = '') {
  const turmaToCurso = buildTurmaToCursoMap();
  const cursoRules = buildCursoComponentCHMap();
  // Cada alocacao pula os feriados comuns + os bloqueios da propria turma.
  const feriadosPorTurma = new Map();
  const feriadosDaAlocacao = (allocation) => {
    const turmaId = String(allocation?.turmaId || '');
    if (!feriadosPorTurma.has(turmaId)) feriadosPorTurma.set(turmaId, datasFeriadoDaTurma(feriadosList, turmaId));
    return feriadosPorTurma.get(turmaId);
  };

  return allocations.map((allocation) => {
    const { faixas, byDate } = buildCandidateSlotsByDate(allocation, computationDays, feriadosDaAlocacao(allocation), defaultStart, defaultEnd);
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
  // So os feriados comuns (de todas as turmas); bloqueios por turma ficam por alocacao.
  const feriadosSet = datasFeriadoDaTurma(feriadosList, '');
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
    feriadosList,
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

    const feriadoObj = feriadosDaTurma(feriadosList, turmaId || '').find((feriado) => (feriado?.data || feriado) === dateStr);
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
        occurrenceIndex: occurrence.occurrenceIndex,
        // Estagio (js/estagio.mjs, regras de 20/11/2026): semChoque vale para a
        // turma, semChoqueDocente para o professor. Campo nunca pesa o docente.
        ...regrasDoEstagioNoDia(allocation, descriptor.faixas, dateStr, occurrence.horario)
      });
    });

    markCalendarVisualConflicts(events, !!docenteFilter);
    events.sort((left, right) => normalizeCalendarSlotKey(left?.horario || '').localeCompare(normalizeCalendarSlotKey(right?.horario || '')));
    calendarData[dateStr] = events;
  });

  return calendarData;
}
