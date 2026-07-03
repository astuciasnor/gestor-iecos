import { store } from './store.js??v=20260625v';
import { getCalendarEvents } from './calendar.js??v=20260625v';
import { mapSlotToTurno } from './turns.js';
import { addDaysISO, timeToMinutes, toISODate } from './date_utils_ui.js';
import { normalizeConflictSlotLabel } from './turno_helpers.js';
import { isPriorityRegularAllocation } from './allocation_helpers.js';
import { computeRemainingFractionalHours, generateAllocationOccurrences, validateOccurrenceWithinSemesterBounds } from './academic_rules.mjs';

export function shouldIgnoreTurmaEventForCandidate(event, candidateAlloc) {
    if (!event || !candidateAlloc) return false;
    if (candidateAlloc.id !== undefined && candidateAlloc.id !== null && event.id !== undefined && event.id !== null) {
        if (String(event.id) === String(candidateAlloc.id)) return true;
    }

    const sameTurma = String(event.turmaId || '') === String(candidateAlloc.turmaId || '');
    if (!sameTurma) return false;

    const candidateDisciplina = String(candidateAlloc.disciplina || '').trim();
    const eventDisciplina = String(event.disciplina || '').trim();
    const candidateSubGrupo = String(candidateAlloc.subGrupo || '').trim();
    const eventSubGrupo = String(event.subGrupo || '').trim();

    return !!candidateDisciplina && eventDisciplina === candidateDisciplina && eventSubGrupo === candidateSubGrupo;
}

export function buildTurmaOccupiedSlotsByDate(candidateAlloc, startDate, endDate) {
    const occupiedByDate = new Map();
    if (!candidateAlloc?.turmaId || !startDate || !endDate) return occupiedByDate;

    const eventsByDate = getCalendarEvents(String(candidateAlloc.turmaId), startDate, endDate);
    Object.entries(eventsByDate || {}).forEach(([dateStr, events]) => {
        (events || []).forEach((event) => {
            const slot = normalizeConflictSlotLabel(event?.horario || '');
            if (!slot) return;
            if (shouldIgnoreTurmaEventForCandidate(event, candidateAlloc)) return;

            if (!occupiedByDate.has(dateStr)) occupiedByDate.set(dateStr, new Set());
            occupiedByDate.get(dateStr).add(slot);
        });
    });

    return occupiedByDate;
}

export function normalizeDrawnSlotsByDay(raw) {
    const map = {};
    if (!raw || typeof raw !== 'object') return map;
    Object.keys(raw).forEach((k) => {
        const day = parseInt(k, 10);
        if (Number.isNaN(day) || day < 1 || day > 6) return;
        const arr = Array.isArray(raw[k]) ? raw[k] : [];
        const slots = [...new Set(arr.filter(Boolean).map(String))].sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
        if (slots.length > 0) map[day] = slots;
    });
    return map;
}

export function normalizeFaixaEntry(faixa) {
    if (!faixa || !faixa.inicio) return null;
    const drawn = normalizeDrawnSlotsByDay(faixa.drawnSlotsByDay || {});
    let dias = Array.isArray(faixa.dias) ? faixa.dias.map((d) => parseInt(d, 10)).filter((d) => d >= 1 && d <= 6) : [];
    let slots = Array.isArray(faixa.slots) ? faixa.slots.filter(Boolean).map(String) : [];

    if (Object.keys(drawn).length > 0) {
        dias = Object.keys(drawn).map((d) => parseInt(d, 10)).sort((a, b) => a - b);
        slots = [...new Set(Object.values(drawn).flat())].sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
    } else {
        dias = [...new Set(dias)].sort((a, b) => a - b);
        slots = [...new Set(slots)].sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
        dias.forEach((d) => { drawn[d] = slots.slice(); });
    }

    if (dias.length === 0 || slots.length === 0) return null;
    return {
        inicio: faixa.inicio,
        fim: faixa.fim || null,
        dias,
        slots,
        drawnSlotsByDay: drawn
    };
}

export function getNormalizedIntensiveFaixas(intense) {
    if (!intense) return [];

    let faixas = [];
    if (Array.isArray(intense.faixas) && intense.faixas.length > 0) {
        faixas = intense.faixas
            .map(normalizeFaixaEntry)
            .filter(Boolean)
            .sort((a, b) => a.inicio.localeCompare(b.inicio));
    }

    if (faixas.length === 0 && intense.dataInicio) {
        const diasLegacy = Array.isArray(intense.diasMarcados) && intense.diasMarcados.length > 0
            ? intense.diasMarcados
            : (intense.usaSabado ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5]);
        const slotsLegacy = Array.isArray(intense.horariosOcupados) ? intense.horariosOcupados : [];
        const drawn = {};
        diasLegacy.forEach((d) => { drawn[d] = slotsLegacy.slice(); });
        const legacy = normalizeFaixaEntry({
            inicio: intense.dataInicio,
            fim: intense.dataFim || null,
            dias: diasLegacy,
            slots: slotsLegacy,
            drawnSlotsByDay: drawn
        });
        if (legacy) faixas = [legacy];
    }

    for (let i = 0; i < faixas.length; i++) {
        if (!faixas[i].fim && i < faixas.length - 1) {
            faixas[i].fim = addDaysISO(faixas[i + 1].inicio, -1);
        }
    }

    return faixas;
}

export function getActiveFaixaForDate(faixas, dStr) {
    if (!Array.isArray(faixas) || faixas.length === 0) return null;
    for (let i = faixas.length - 1; i >= 0; i--) {
        const f = faixas[i];
        if (dStr < f.inicio) continue;
        if (f.fim && dStr > f.fim) continue;
        return f;
    }
    return null;
}

export function getIntensiveSlotsForDate(intense, dStr, opts = {}) {
    const dow = opts.dayOfWeek ?? new Date(dStr + 'T12:00:00').getDay();
    if (dow === 0) return [];
    if (intense?.executionByDate && typeof intense.executionByDate === 'object') {
        return Array.isArray(intense.executionByDate[dStr]) ? intense.executionByDate[dStr].slice() : [];
    }

    const faixas = getNormalizedIntensiveFaixas(intense);
    const faixa = getActiveFaixaForDate(faixas, dStr);
    if (!faixa) return [];
    if (!faixa.dias.includes(dow)) return [];

    const byDay = faixa.drawnSlotsByDay || {};
    return (byDay[dow] || faixa.slots || []).slice();
}

export function computeIntensiveExecution(intense, options = {}) {
    const result = {
        totalHours: 0,
        dataInicio: intense?.dataInicio || '',
        dataFim: intense?.dataInicio || '',
        horariosUltimoDia: [],
        byDate: {},
        unionSlots: [],
        unionDias: [],
        wasTruncatedByCH: false,
        truncationDate: '',
        truncationDaySlots: 0,
        truncationUsedSlots: 0,
        truncationType: ''
    };
    if (!intense) return result;

    const faixas = getNormalizedIntensiveFaixas(intense);
    if (faixas.length === 0) return result;

    const totalCH = parseInt(intense.ch || 0, 10);
    const feriadosSet = new Set((store.rawData?.feriados || []).map((f) => f.data || f));
    const priorityRegulars = options.respectPriority
        ? store.allocations.filter((a) =>
            String(a.turmaId) === String(intense.turmaId) &&
            isPriorityRegularAllocation(a) &&
            a.disciplina !== intense.disciplina)
        : [];

    result.dataInicio = faixas[0].inicio;
    let cursor = new Date(faixas[0].inicio + 'T12:00:00');
    let loops = 0;
    const maxLoops = options.maxLoops || 800;
    const explicitFaixaEnd = String(faixas[faixas.length - 1]?.fim || '').trim();
    const semesterEnd = String(store.settings.termEnd || faixas[faixas.length - 1]?.inicio || faixas[0].inicio).trim();
    const executionBoundary = explicitFaixaEnd && semesterEnd
        ? (explicitFaixaEnd < semesterEnd ? explicitFaixaEnd : semesterEnd)
        : (explicitFaixaEnd || semesterEnd || faixas[faixas.length - 1]?.inicio || faixas[0].inicio);
    const occupancyEnd = executionBoundary || faixas[faixas.length - 1]?.inicio || faixas[0].inicio;
    const occupiedSlotsByDate = options.respectTurmaOccupancy
        ? buildTurmaOccupiedSlotsByDate(intense, result.dataInicio, occupancyEnd)
        : new Map();
    const candidateDates = [];
    const slotsByDate = {};

    const filterFreeSlotsForDate = (dateStr, daySlots = [], dayOfWeek = 0) => {
        let freeSlots = Array.isArray(daySlots) ? daySlots.slice() : [];

        if (options.respectPriority) {
            freeSlots = freeSlots.filter((slot) => !priorityRegulars.some((p) => {
                const pStart = p.dataInicio || store.settings.termStart;
                const pEnd = p.dataFim || store.settings.termEnd;
                return parseInt(p.diaSemana, 10) === dayOfWeek && dateStr >= pStart && dateStr <= pEnd && p.horario === slot;
            }));
        }

        const occupied = occupiedSlotsByDate.get(dateStr);
        if (occupied && occupied.size > 0) {
            freeSlots = freeSlots.filter((slot) => !occupied.has(normalizeConflictSlotLabel(slot)));
        }

        return freeSlots;
    };

    while (loops < maxLoops) {
        const dStr = toISODate(cursor);
        if (executionBoundary && !validateOccurrenceWithinSemesterBounds({
            occurrenceDate: dStr,
            semesterEndDate: executionBoundary
        })) {
            break;
        }
        const dow = cursor.getDay();

        const faixa = getActiveFaixaForDate(faixas, dStr);
        if (!faixa) {
            if (executionBoundary && dStr > executionBoundary) break;
            cursor.setDate(cursor.getDate() + 1);
            loops++;
            continue;
        }

        if (!feriadosSet.has(dStr) && dow !== 0 && faixa.dias.includes(dow)) {
            let daySlots = (faixa.drawnSlotsByDay?.[dow] || faixa.slots || []).slice();

            if (dow === 6 && intense.sabadoManha) {
                const turmaTurno = store.rawData?.turmas?.find(t => String(t.turma_id) === String(intense.turmaId))?.turno || 'Tarde';
                // Remove duplicatas e garante que o mapeamento respeite a ordem das aulas (pulando intervalos)
                daySlots = [...new Set(daySlots.map(s => mapSlotToTurno(s, turmaTurno, 'Manha', store.getActiveHorariosPorTurno())))];
            }

            const freeSlots = filterFreeSlotsForDate(dStr, daySlots, dow);

            if (freeSlots.length > 0) {
                candidateDates.push(dStr);
                slotsByDate[dStr] = freeSlots;
            }
        }

        cursor.setDate(cursor.getDate() + 1);
        loops++;
    }

    const occurrences = generateAllocationOccurrences({
        totalWorkload: totalCH,
        accumulatedAllocatedHours: 0,
        nextValidDate: faixas[0].inicio,
        semesterEndDate: executionBoundary,
        scheduleDates: candidateDates,
        slotsByDate
    });

    result.byDate = occurrences.byDate || {};
    result.totalHours = occurrences.totalAllocatedHours || 0;
    result.dataFim = occurrences.lastDate || result.dataInicio;
    result.horariosUltimoDia = occurrences.lastDaySlots || [];

    if (occurrences.partialFinalDay) {
        result.wasTruncatedByCH = true;
        result.truncationDate = occurrences.lastDate || '';
        result.truncationDaySlots = [...new Set((Array.isArray(slotsByDate?.[occurrences.lastDate]) ? slotsByDate[occurrences.lastDate] : []).filter(Boolean).map(String))].length;
        result.truncationUsedSlots = occurrences.lastOccurrenceHours || 0;
        result.truncationType = 'partial-day';
    } else if (occurrences.wasClippedToSemesterEnd) {
        result.wasTruncatedByCH = true;
        result.truncationDate = executionBoundary || '';
        result.truncationDaySlots = 0;
        result.truncationUsedSlots = 0;
        result.truncationType = 'semester-boundary';
    } else if (computeRemainingFractionalHours(totalCH, result.totalHours) > 0 && executionBoundary) {
        result.truncationDate = executionBoundary;
    }

    const allSlots = new Set();
    const allDays = new Set();
    Object.keys(result.byDate).forEach((dStr) => {
        const dow = new Date(dStr + 'T12:00:00').getDay();
        if (dow >= 1 && dow <= 6) allDays.add(dow);
        result.byDate[dStr].forEach((h) => allSlots.add(h));
    });
    result.unionSlots = [...allSlots].sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
    result.unionDias = [...allDays].sort((a, b) => a - b);

    return result;
}

export function buildFaixaHoursSummaryFromExecution(faixas = [], executionByDate = {}) {
    const list = Array.isArray(faixas) ? faixas : [];
    const byDate = executionByDate && typeof executionByDate === "object" ? executionByDate : {};

    return list.map((faixa, idx) => {
        const inicio = String(faixa?.inicio || "").trim();
        const fim = String(faixa?.fim || "").trim() || inicio;
        let total = 0;

        Object.keys(byDate).forEach((dStr) => {
            if (!inicio) return;
            if (dStr < inicio) return;
            if (fim && dStr > fim) return;
            const slots = Array.isArray(byDate[dStr]) ? byDate[dStr] : [];
            total += slots.length;
        });

        return {
            faixa: idx + 1,
            inicio,
            fim,
            horas: total
        };
    });
}

export function getExecutionUsedDates(execution = {}) {
    return Object.keys(execution?.byDate || {})
        .filter((dateStr) => /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || '').trim()))
        .sort();
}

export function getExecutionSlotsForDate(execution = {}, dateStr = '') {
    return Array.isArray(execution?.byDate?.[dateStr]) ? execution.byDate[dateStr].slice() : [];
}

export function buildSortedSlotSignature(slots = []) {
    return (Array.isArray(slots) ? slots : [])
        .filter(Boolean)
        .map(String)
        .sort((a, b) => timeToMinutes(a) - timeToMinutes(b))
        .join('|');
}

export function getFaixaSlotsForDay(faixa, dow) {
    const day = parseInt(dow, 10);
    if (Number.isNaN(day) || day < 1 || day > 6) return [];

    const rawSlots = Array.isArray(faixa?.drawnSlotsByDay?.[day])
        ? faixa.drawnSlotsByDay[day]
        : [];

    return [...new Set(rawSlots.filter(Boolean).map(String))]
        .sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
}

export function buildStoredExecutionSnapshot(intense) {
    const raw = intense?.executionByDate && typeof intense.executionByDate === 'object'
        ? intense.executionByDate
        : null;
    if (!raw) return null;

    const byDate = {};
    Object.keys(raw)
        .sort()
        .forEach((dateStr) => {
            const slots = Array.isArray(raw[dateStr])
                ? raw[dateStr].filter(Boolean).map(String).sort((a, b) => timeToMinutes(a) - timeToMinutes(b))
                : [];
            if (slots.length > 0) byDate[dateStr] = slots;
        });

    const usedDates = Object.keys(byDate).sort();
    if (usedDates.length === 0) return null;

    let totalHours = 0;
    usedDates.forEach((dateStr) => {
        totalHours += byDate[dateStr].length;
    });

    const dataInicio = String(intense?.dataInicio || usedDates[0] || '').trim() || usedDates[0];
    const dataFim = String(intense?.dataFim || usedDates[usedDates.length - 1] || '').trim() || usedDates[usedDates.length - 1];
    const horariosUltimoDia = Array.isArray(intense?.horariosUltimoDia) && intense.horariosUltimoDia.length > 0
        ? intense.horariosUltimoDia.slice()
        : (Array.isArray(byDate[dataFim]) ? byDate[dataFim].slice() : []);

    return {
        totalHours,
        dataInicio,
        dataFim,
        horariosUltimoDia,
        byDate
    };
}

export function buildComparableFaixasSignature(faixas = []) {
    const normalized = (Array.isArray(faixas) ? faixas : [])
        .map(normalizeFaixaEntry)
        .filter(Boolean)
        .sort((a, b) => a.inicio.localeCompare(b.inicio));

    return JSON.stringify(normalized.map((faixa) => ({
        inicio: faixa.inicio,
        fim: faixa.fim || '',
        drawnSlotsByDay: normalizeDrawnSlotsByDay(faixa.drawnSlotsByDay || {})
    })));
}

export function resolveEditableFaixasFromStoredExecution(intense) {
    const normalized = getNormalizedIntensiveFaixas(intense);
    const execution = buildStoredExecutionSnapshot(intense);
    const aligned = alignFaixasToExecutionEnd(normalized, execution?.dataFim || intense?.dataFim || '');

    if (!execution) {
        return {
            faixas: aligned,
            wasAdjusted: buildComparableFaixasSignature(aligned) !== buildComparableFaixasSignature(normalized),
            adjustmentReason: ''
        };
    }

    const suggestion = buildFinalAdjustmentFaixaSuggestion(aligned, execution);
    const resolved = suggestion?.faixas?.length
        ? suggestion.faixas.map(normalizeFaixaEntry).filter(Boolean)
        : aligned;

    return {
        faixas: resolved,
        wasAdjusted: buildComparableFaixasSignature(resolved) !== buildComparableFaixasSignature(normalized),
        adjustmentReason: suggestion?.reason || ''
    };
}

export function alignFaixasToExecutionEnd(faixasInput, executionEnd) {
    const end = String(executionEnd || '').trim();
    const normalized = Array.isArray(faixasInput)
        ? faixasInput.map(normalizeFaixaEntry).filter(Boolean).sort((a, b) => a.inicio.localeCompare(b.inicio))
        : [];
    if (normalized.length === 0 || !end) return normalized;

    const clipped = normalized
        .filter((f) => f.inicio <= end)
        .map((f) => {
            const faixaEnd = f.fim && f.fim < end ? f.fim : end;
            return { ...f, fim: faixaEnd };
        })
        .filter((f) => f.fim >= f.inicio);

    if (clipped.length === 0) return normalized;

    for (let i = 0; i < clipped.length - 1; i++) {
        const maxEnd = addDaysISO(clipped[i + 1].inicio, -1);
        if (!clipped[i].fim || clipped[i].fim > maxEnd) clipped[i].fim = maxEnd;
        if (clipped[i].fim < clipped[i].inicio) clipped[i].fim = clipped[i].inicio;
    }

    clipped[clipped.length - 1].fim = end;
    return clipped;
}

export function buildFinalAdjustmentFaixaSuggestion(faixasConfig = [], execution = {}) {
    const normalized = Array.isArray(faixasConfig)
        ? faixasConfig.map(normalizeFaixaEntry).filter(Boolean).sort((a, b) => a.inicio.localeCompare(b.inicio))
        : [];

    if (normalized.length !== 1) return null;

    const finalDate = String(execution?.dataFim || '').trim();
    if (!finalDate) return null;

    const aligned = alignFaixasToExecutionEnd(normalized, finalDate);
    const baseFaixa = aligned[0];
    if (!baseFaixa?.inicio || finalDate <= baseFaixa.inicio) return null;

    const usedDates = getExecutionUsedDates(execution);
    if (usedDates.length < 2) return null;

    const adjustmentStart = usedDates[usedDates.length - 2];
    if (!adjustmentStart || adjustmentStart <= baseFaixa.inicio) return null;

    const tailDates = usedDates.filter((dateStr) => dateStr >= adjustmentStart && dateStr <= finalDate);
    if (tailDates.length < 2) return null;

    const finalDow = new Date(`${finalDate}T12:00:00`).getDay();
    if (finalDow < 1 || finalDow > 6) return null;

    const usedSlots = getExecutionSlotsForDate(execution, finalDate);
    const fullDaySlots = getFaixaSlotsForDay(baseFaixa, finalDow);
    if (usedSlots.length === 0) return null;

    const mainFaixaEnd = addDaysISO(adjustmentStart, -1);
    if (!mainFaixaEnd || mainFaixaEnd < baseFaixa.inicio) return null;

    const mainFaixa = {
        ...baseFaixa,
        fim: mainFaixaEnd
    };

    const tailEntries = tailDates
        .map((dateStr) => {
            const slots = getExecutionSlotsForDate(execution, dateStr);
            if (slots.length === 0) return null;
            const dow = new Date(`${dateStr}T12:00:00`).getDay();
            if (dow < 1 || dow > 6) return null;
            const expectedSlots = getFaixaSlotsForDay(baseFaixa, dow);
            return {
                date: dateStr,
                dow,
                slots,
                signature: buildSortedSlotSignature(slots),
                expectedSlots,
                expectedSignature: buildSortedSlotSignature(expectedSlots)
            };
        })
        .filter(Boolean);

    if (tailEntries.length < 2) return null;

    const partialFinalDay = fullDaySlots.length > 0 && usedSlots.length < fullDaySlots.length;
    const tailDiffersFromBase = tailEntries.some((entry) => entry.signature !== entry.expectedSignature);
    const isCanonicalPartialDay = execution?.wasTruncatedByCH
        && execution?.truncationType === 'partial-day'
        && (!execution?.truncationDate || String(execution.truncationDate).trim() === finalDate);

    if (!partialFinalDay && !tailDiffersFromBase && !isCanonicalPartialDay) return null;

    const drawnSlotsByDay = {};
    tailEntries.forEach((entry) => {
        if (!drawnSlotsByDay[entry.dow]) drawnSlotsByDay[entry.dow] = [];
        drawnSlotsByDay[entry.dow].push(...entry.slots);
    });
    Object.keys(drawnSlotsByDay).forEach((dayKey) => {
        drawnSlotsByDay[dayKey] = [...new Set(drawnSlotsByDay[dayKey])]
            .sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
    });

    const adjustmentFaixa = normalizeFaixaEntry({
        inicio: adjustmentStart,
        fim: finalDate,
        drawnSlotsByDay
    });

    if (!adjustmentFaixa) return null;

    return {
        faixas: [mainFaixa, adjustmentFaixa],
        adjustmentFaixaIndex: 2,
        reason: tailEntries.some((entry, idx, arr) => idx > 0 && entry.dow === arr[idx - 1].dow)
            ? 'partial-day-same-dow'
            : (tailDiffersFromBase && !isCanonicalPartialDay ? 'tail-regime-change' : 'partial-day'),
        adjustmentStart,
        adjustmentEnd: finalDate,
        adjustmentDates: tailDates
    };
}
