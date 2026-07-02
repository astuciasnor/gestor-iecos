import { store } from './store.js??v=20260625v';
import { getCalendarEvents } from './calendar.js';
import { detectTeacherConflicts } from './conflicts.js';
import { filterExportableAllocations, getTeacherActiveShifts } from './academic_rules.mjs';

function ensureExecutionEntry(maps, allocId) {
    if (!allocId) return;
    if (!maps.datesByAlloc.has(allocId)) maps.datesByAlloc.set(allocId, new Set());
    if (!maps.hoursByAlloc.has(allocId)) maps.hoursByAlloc.set(allocId, 0);
    if (!maps.dateHoursByAlloc.has(allocId)) maps.dateHoursByAlloc.set(allocId, new Map());
}

function createEmptyExecutionMaps() {
    return {
        datesByAlloc: new Map(),
        hoursByAlloc: new Map(),
        dateHoursByAlloc: new Map()
    };
}

function buildExecutionMapsFromEvents(eventsByDate = {}, allowedAllocIds = null) {
    const maps = createEmptyExecutionMaps();

    Object.entries(eventsByDate || {}).forEach(([dateStr, events]) => {
        if (!Array.isArray(events)) return;

        events.forEach((ev) => {
            const allocId = ev?.id;
            if (!allocId || ev?.type === 'holiday') return;
            if (allowedAllocIds instanceof Set && !allowedAllocIds.has(allocId)) return;

            ensureExecutionEntry(maps, allocId);
            maps.datesByAlloc.get(allocId).add(dateStr);
            maps.hoursByAlloc.set(allocId, (maps.hoursByAlloc.get(allocId) || 0) + 1);

            const dhMap = maps.dateHoursByAlloc.get(allocId);
            dhMap.set(dateStr, (dhMap.get(dateStr) || 0) + 1);
        });
    });

    return maps;
}

function mergeExecutionMaps(targetMaps, sourceMaps) {
    sourceMaps.datesByAlloc.forEach((datesSet, allocId) => {
        ensureExecutionEntry(targetMaps, allocId);
        const targetDates = targetMaps.datesByAlloc.get(allocId);
        datesSet.forEach((dateStr) => targetDates.add(dateStr));
    });

    sourceMaps.hoursByAlloc.forEach((hours, allocId) => {
        ensureExecutionEntry(targetMaps, allocId);
        targetMaps.hoursByAlloc.set(allocId, (targetMaps.hoursByAlloc.get(allocId) || 0) + (hours || 0));
    });

    sourceMaps.dateHoursByAlloc.forEach((dateHoursMap, allocId) => {
        ensureExecutionEntry(targetMaps, allocId);
        const targetDateHours = targetMaps.dateHoursByAlloc.get(allocId);
        dateHoursMap.forEach((hours, dateStr) => {
            targetDateHours.set(dateStr, (targetDateHours.get(dateStr) || 0) + (hours || 0));
        });
    });
}

function buildRangeMapFromDates(datesByAlloc = new Map(), fallbackStart = '', fallbackEnd = '') {
    const rangeMap = new Map();

    datesByAlloc.forEach((datesSet, allocId) => {
        const dates = [...datesSet].sort((a, b) => a.localeCompare(b));
        rangeMap.set(allocId, {
            start: dates[0] || fallbackStart || '',
            end: dates[dates.length - 1] || fallbackEnd || dates[0] || fallbackStart || ''
        });
    });

    return rangeMap;
}

function normalizeKeyPart(value) {
    return String(value || '').trim().toUpperCase();
}

function normalizeTeacherKey(value) {
    return String(value || '').trim().toUpperCase();
}

function sortUniqueIsoDates(dates = []) {
    return [...new Set((Array.isArray(dates) ? dates : []).map((value) => String(value || '').trim()))]
        .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
        .sort((a, b) => a.localeCompare(b));
}

function timeToMinutesSafe(value) {
    const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
    if (!match) return Number.MAX_SAFE_INTEGER;
    return (Number.parseInt(match[1], 10) * 60) + Number.parseInt(match[2], 10);
}

function getAllocationDocentesList(alloc, fallbackHours = 0) {
    if (Array.isArray(alloc?.docentes) && alloc.docentes.length > 0) {
        return alloc.docentes
            .map((docente) => ({
                nome: String(docente?.nome || '').trim(),
                ch: Number.parseFloat(docente?.ch) || 0
            }))
            .filter((docente) => docente.nome);
    }

    const singleName = typeof alloc?.docente === 'string'
        ? String(alloc.docente || '').trim()
        : String(alloc?.docente?.nome || '').trim();

    if (!singleName) return [];
    return [{
        nome: singleName,
        ch: Number.parseFloat(alloc?.ch) || Number.parseFloat(fallbackHours) || 0
    }];
}

function mergeDocentesLists(currentList = [], nextList = []) {
    const merged = new Map();

    [...(Array.isArray(currentList) ? currentList : []), ...(Array.isArray(nextList) ? nextList : [])]
        .forEach((docente) => {
            const nome = String(docente?.nome || '').trim();
            if (!nome) return;
            const key = normalizeTeacherKey(nome);
            const current = merged.get(key);
            const nextCH = Number.parseFloat(docente?.ch) || 0;

            if (!current) {
                merged.set(key, { nome, ch: nextCH });
                return;
            }

            merged.set(key, {
                nome: current.nome || nome,
                ch: Math.max(Number.parseFloat(current.ch) || 0, nextCH)
            });
        });

    return [...merged.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
}

function buildDocenteDisplayLabel(allocations = [], docentes = []) {
    const preferredComposite = (Array.isArray(allocations) ? allocations : [])
        .map((allocation) => {
            if (typeof allocation?.docente === 'string') return allocation.docente.trim();
            return String(allocation?.docente?.nome || '').trim();
        })
        .find((label) => label && (label.includes('/') || label.includes('(M')));

    if (preferredComposite) return preferredComposite;
    if (docentes.length === 1) return docentes[0].nome;
    if (docentes.length > 1) return docentes.map((docente) => docente.nome).join(' / ');

    const fallback = (Array.isArray(allocations) ? allocations : [])
        .map((allocation) => {
            if (typeof allocation?.docente === 'string') return allocation.docente.trim();
            return String(allocation?.docente?.nome || '').trim();
        })
        .find(Boolean);

    return fallback || '';
}

function sortRegularAllocations(allocations = []) {
    return allocations.slice().sort((left, right) => {
        const dayDiff = (Number.parseInt(left?.diaSemana, 10) || 0) - (Number.parseInt(right?.diaSemana, 10) || 0);
        if (dayDiff !== 0) return dayDiff;
        return timeToMinutesSafe(left?.horario) - timeToMinutesSafe(right?.horario);
    });
}

function shiftISODate(dateStr, days = 0) {
    const source = String(dateStr || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(source)) return '';
    const date = new Date(`${source}T12:00:00`);
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

function buildDrawnSlotsMap(days = [], slots = []) {
    const normalizedDays = normalizeDayList(days);
    const normalizedSlots = normalizeSlotList(slots);
    const map = {};

    normalizedDays.forEach((day) => {
        map[day] = normalizedSlots.slice();
    });

    return map;
}

function normalizeLegacyFaixaRecord(rawFaixa = null, fallback = {}) {
    const inicio = String(rawFaixa?.inicio || fallback.inicio || '').trim();
    if (!inicio) return null;

    let drawnSlotsByDay = normalizeDrawnSlotsByDay(rawFaixa?.drawnSlotsByDay || {});
    let dias = normalizeDayList(rawFaixa?.dias || rawFaixa?.diasMarcados || fallback.dias || []);
    let slots = normalizeSlotList(rawFaixa?.slots || rawFaixa?.horariosOcupados || fallback.slots || []);

    if (Object.keys(drawnSlotsByDay).length > 0) {
        dias = normalizeDayList(Object.keys(drawnSlotsByDay));
        slots = normalizeSlotList(Object.values(drawnSlotsByDay).flat());
    } else if (dias.length > 0 && slots.length > 0) {
        drawnSlotsByDay = buildDrawnSlotsMap(dias, slots);
    }

    if (dias.length === 0 || slots.length === 0) return null;

    const fim = String(rawFaixa?.fim || fallback.fim || '').trim();
    return {
        inicio,
        fim: fim || '',
        dias,
        slots,
        drawnSlotsByDay
    };
}

function buildCanonicalOfferKey(alloc) {
    return [
        'offer',
        normalizeKeyPart(alloc?.turmaId),
        normalizeKeyPart(alloc?.disciplina),
        normalizeKeyPart(alloc?.subGrupo)
    ].join('|');
}

function collectDeclaredFaixasForGroup(group, termStart = '', termEnd = '') {
    const declaredFaixas = [];

    (Array.isArray(group?.allocations) ? group.allocations : []).forEach((allocation) => {
        const fallbackStart = String(allocation?.dataInicio || group?.start || termStart || '').trim();
        const fallbackEnd = String(allocation?.dataFim || group?.end || termEnd || fallbackStart || '').trim();
        const fallbackDays = Array.isArray(allocation?.diasMarcados) && allocation.diasMarcados.length > 0
            ? allocation.diasMarcados
            : (allocation?.usaSabado ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5]);
        const fallbackSlots = Array.isArray(allocation?.horariosOcupados) ? allocation.horariosOcupados : [];
        const rawFaixas = Array.isArray(allocation?.faixas) ? allocation.faixas : [];

        if (rawFaixas.length > 0) {
            rawFaixas.forEach((faixa) => {
                const normalized = normalizeLegacyFaixaRecord(faixa, {
                    inicio: fallbackStart,
                    fim: fallbackEnd,
                    dias: fallbackDays,
                    slots: fallbackSlots
                });
                if (normalized) declaredFaixas.push(normalized);
            });
            return;
        }

        if (!fallbackStart || fallbackSlots.length === 0) return;
        const normalized = normalizeLegacyFaixaRecord({
            inicio: fallbackStart,
            fim: fallbackEnd,
            dias: fallbackDays,
            slots: fallbackSlots
        });
        if (normalized) declaredFaixas.push(normalized);
    });

    const deduped = new Map();
    declaredFaixas.forEach((faixa) => {
        const key = [
            faixa.inicio,
            faixa.fim || '',
            faixa.dias.join(','),
            JSON.stringify(faixa.drawnSlotsByDay)
        ].join('|');
        if (!deduped.has(key)) deduped.set(key, faixa);
    });

    const sorted = [...deduped.values()].sort((left, right) => {
        const startDiff = String(left.inicio || '').localeCompare(String(right.inicio || ''));
        if (startDiff !== 0) return startDiff;
        return String(left.fim || '').localeCompare(String(right.fim || ''));
    });

    const fallbackFinalEnd = String(group?.end || termEnd || group?.start || termStart || '').trim();
    return sorted.map((faixa, index) => {
        const nextFaixa = sorted[index + 1];
        let resolvedEnd = String(faixa?.fim || '').trim();

        if (!resolvedEnd && nextFaixa?.inicio) resolvedEnd = shiftISODate(nextFaixa.inicio, -1);
        if (!resolvedEnd) resolvedEnd = fallbackFinalEnd || faixa.inicio;
        if (resolvedEnd < faixa.inicio) resolvedEnd = faixa.inicio;

        return {
            ...faixa,
            fim: resolvedEnd
        };
    });
}

function buildFallbackFaixaFromSchedule(group, termStart = '', termEnd = '') {
    const drawnSlotsByDay = normalizeDrawnSlotsByDay(group?.timeRangesByDay || {});
    const dias = normalizeDayList(Object.keys(drawnSlotsByDay));
    const slots = normalizeSlotList(Object.values(drawnSlotsByDay).flat());
    const inicio = String(group?.start || group?.baseAlloc?.dataInicio || termStart || '').trim();
    const fim = String(group?.end || group?.baseAlloc?.dataFim || termEnd || inicio || '').trim();

    if (!inicio || dias.length === 0 || slots.length === 0) return null;
    return {
        inicio,
        fim: fim || inicio,
        dias,
        slots,
        drawnSlotsByDay
    };
}

function collectFaixaExecutionStats(group, faixa, dateHoursByAlloc = new Map()) {
    const faixaStart = String(faixa?.inicio || '').trim();
    const faixaEnd = String(faixa?.fim || faixaStart || '').trim();
    const activeDates = new Set();
    let executedHours = 0;

    (Array.isArray(group?.allocationIds) ? group.allocationIds : []).forEach((allocationId) => {
        const dateHoursMap = dateHoursByAlloc.get(allocationId);
        if (!(dateHoursMap instanceof Map)) return;

        dateHoursMap.forEach((hours, dateStr) => {
            if (faixaStart && dateStr < faixaStart) return;
            if (faixaEnd && dateStr > faixaEnd) return;
            executedHours += Number(hours || 0);
            if (Number(hours || 0) > 0) activeDates.add(dateStr);
        });
    });

    return {
        executedHours,
        executionDays: activeDates.size,
        activeDates: sortUniqueIsoDates([...activeDates])
    };
}

function buildCanonicalFaixasForGroup(group, maps, termStart = '', termEnd = '') {
    const declaredFaixas = collectDeclaredFaixasForGroup(group, termStart, termEnd);
    const fallbackFaixa = buildFallbackFaixaFromSchedule(group, termStart, termEnd);
    const faixasBase = declaredFaixas.length > 0
        ? declaredFaixas
        : (fallbackFaixa ? [fallbackFaixa] : []);

    return faixasBase.map((faixa, index) => {
        const stats = collectFaixaExecutionStats(group, faixa, maps?.dateHoursByAlloc);
        return {
            faixaId: `${group.offerKey}|${index + 1}`,
            index: index + 1,
            inicio: faixa.inicio,
            fim: faixa.fim || faixa.inicio,
            dias: faixa.dias,
            slots: faixa.slots,
            drawnSlotsByDay: faixa.drawnSlotsByDay,
            executedHours: stats.executedHours,
            executionDays: stats.executionDays,
            activeDates: stats.activeDates
        };
    });
}

function buildExecutionContextForAllocations(allocations = [], termStart = '', termEnd = '', docenteFilter = null) {
    const maps = createEmptyExecutionMaps();
    const calendarByTurma = new Map();
    const byTurma = new Map();

    (Array.isArray(allocations) ? allocations : []).forEach((allocation) => {
        const turmaId = String(allocation?.turmaId || '').trim();
        if (!turmaId) return;
        if (!byTurma.has(turmaId)) byTurma.set(turmaId, []);
        byTurma.get(turmaId).push(allocation);
    });

    byTurma.forEach((turmaAllocations, turmaId) => {
        const allowedAllocIds = new Set(
            turmaAllocations.map((allocation) => allocation?.id).filter(Boolean)
        );
        const calendarData = getCalendarEvents(turmaId, termStart, termEnd, docenteFilter);
        const turmaMaps = buildExecutionMapsFromEvents(calendarData, allowedAllocIds);

        calendarByTurma.set(turmaId, calendarData);
        mergeExecutionMaps(maps, turmaMaps);
    });

    (Array.isArray(allocations) ? allocations : []).forEach((allocation) => ensureExecutionEntry(maps, allocation?.id));
    return { maps, calendarByTurma };
}

function collectTeacherSegmentsForGroup(group, calendarByTurma) {
    const teacherDates = new Map();
    const teacherHours = new Map();
    const teacherNames = new Map();
    const declaredTeacherMap = new Map();
    const allocationIdSet = new Set(group.allocationIds);
    const turmaCalendar = calendarByTurma.get(String(group.turmaId || '').trim());

    group.docentes.forEach((docente) => {
        const key = normalizeTeacherKey(docente?.nome);
        if (!key) return;
        declaredTeacherMap.set(key, docente);
        teacherNames.set(key, docente.nome);
    });

    Object.entries(turmaCalendar || {}).forEach(([dateStr, events]) => {
        (Array.isArray(events) ? events : []).forEach((event) => {
            if (!allocationIdSet.has(event?.id)) return;

            const teacherName = String(event?.docente || '').trim();
            const teacherKey = normalizeTeacherKey(teacherName);
            if (!teacherKey) return;

            if (!teacherDates.has(teacherKey)) teacherDates.set(teacherKey, new Set());
            teacherDates.get(teacherKey).add(dateStr);
            teacherHours.set(teacherKey, (teacherHours.get(teacherKey) || 0) + 1);
            if (!teacherNames.has(teacherKey)) teacherNames.set(teacherKey, teacherName);
        });
    });

    if (teacherNames.size === 0 && group.docenteLabel) {
        const fallbackKey = normalizeTeacherKey(group.docenteLabel);
        if (fallbackKey) teacherNames.set(fallbackKey, group.docenteLabel);
    }

    const hasObservedDates = teacherDates.size > 0;
    const segments = [];

    teacherNames.forEach((teacherName, teacherKey) => {
        const dates = sortUniqueIsoDates([...(teacherDates.get(teacherKey) || [])]);
        const declared = declaredTeacherMap.get(teacherKey);

        if (hasObservedDates && dates.length === 0) return;

        segments.push({
            nome: teacherName,
            ch: Number.parseFloat(declared?.ch) || 0,
            hours: teacherHours.get(teacherKey) || 0,
            start: dates[0] || group.start,
            end: dates[dates.length - 1] || group.end
        });
    });

    return segments.sort((left, right) => {
        const startDiff = String(left.start || '').localeCompare(String(right.start || ''));
        if (startDiff !== 0) return startDiff;
        const endDiff = String(left.end || '').localeCompare(String(right.end || ''));
        if (endDiff !== 0) return endDiff;
        return String(left.nome || '').localeCompare(String(right.nome || ''), 'pt-BR', { sensitivity: 'base' });
    });
}

export function buildExecutionSnapshotForAllocations(allocations = [], termStart = '', termEnd = '', docenteFilter = null) {
    return buildExecutionContextForAllocations(allocations, termStart, termEnd, docenteFilter);
}

export function getUnifiedExecutionSnapshot(turmaId, termStart, termEnd) {
    const allocations = filterExportableAllocations(
        store.allocations.filter((allocation) => String(allocation?.turmaId || '') === String(turmaId || ''))
    );
    const { maps } = buildExecutionContextForAllocations(allocations, termStart, termEnd, null);
    return maps;
}

export function getAllocationExecutionRangeMap(allocs, termStart, termEnd) {
    const rangeMap = new Map();
    const allocations = Array.isArray(allocs) ? allocs.filter(Boolean) : [];
    if (allocations.length === 0) return rangeMap;

    const { maps } = buildExecutionContextForAllocations(allocations, termStart, termEnd, null);
    const builtRangeMap = buildRangeMapFromDates(maps.datesByAlloc, termStart, termEnd);

    allocations.forEach((alloc) => {
        if (!alloc?.id) return;
        rangeMap.set(alloc.id, builtRangeMap.get(alloc.id) || {
            start: termStart || '',
            end: termEnd || termStart || ''
        });
    });

    return rangeMap;
}

export function getNonIntensiveExecutionRangeMap(allocs, termStart, termEnd) {
    return getAllocationExecutionRangeMap(allocs, termStart, termEnd);
}

export function buildCanonicalOfferProjection({
    allocations = null,
    startDate = '',
    endDate = ''
} = {}) {
    const sourceAllocations = Array.isArray(allocations) ? allocations : store.allocations;
    const exportableAllocations = filterExportableAllocations(sourceAllocations);
    const termStart = String(startDate || '').trim();
    const termEnd = String(endDate || termStart || '').trim();
    const { maps, calendarByTurma } = buildExecutionContextForAllocations(exportableAllocations, termStart, termEnd, null);
    const offerGroupsByKey = new Map();
    const offerKeyByAllocationId = new Map();

    exportableAllocations.forEach((allocation) => {
        const offerKey = buildCanonicalOfferKey(allocation);

        if (!offerGroupsByKey.has(offerKey)) {
            offerGroupsByKey.set(offerKey, {
                offerKey,
                turmaId: allocation?.turmaId || '',
                disciplina: allocation?.disciplina || '',
                subGrupo: allocation?.subGrupo || '',
                baseAlloc: allocation,
                allocations: [],
                allocationIds: [],
                componentKey: normalizeKeyPart(allocation?.disciplina),
                docentes: [],
                docenteLabel: '',
                activeDates: [],
                executedHours: 0,
                start: '',
                end: '',
                maxExecutionDays: 0,
                faixas: [],
                scheduleEntries: [],
                timeRangesByDay: {},
                teacherSegments: []
            });
        }

        const group = offerGroupsByKey.get(offerKey);
        group.allocations.push(allocation);
        group.allocationIds.push(allocation?.id);
        offerKeyByAllocationId.set(allocation?.id, offerKey);
    });

    offerGroupsByKey.forEach((group) => {
        group.allocations = group.allocations.slice().sort((left, right) => {
            const startDiff = String(left?.dataInicio || '').localeCompare(String(right?.dataInicio || ''));
            if (startDiff !== 0) return startDiff;
            const dayDiff = (Number.parseInt(left?.diaSemana, 10) || 0) - (Number.parseInt(right?.diaSemana, 10) || 0);
            if (dayDiff !== 0) return dayDiff;
            return timeToMinutesSafe(left?.horario) - timeToMinutesSafe(right?.horario);
        });

        group.baseAlloc = group.allocations[0] || group.baseAlloc;
        group.docentes = group.allocations.reduce((merged, allocation) => (
            mergeDocentesLists(merged, getAllocationDocentesList(allocation, allocation?.ch || 0))
        ), []);
        group.docenteLabel = buildDocenteDisplayLabel(group.allocations, group.docentes);

        const fallbackStarts = group.allocations
            .map((allocation) => String(allocation?.dataInicio || termStart || '').trim())
            .filter(Boolean)
            .sort((left, right) => left.localeCompare(right));
        const fallbackEnds = group.allocations
            .map((allocation) => String(allocation?.dataFim || termEnd || allocation?.dataInicio || termStart || '').trim())
            .filter(Boolean)
            .sort((left, right) => left.localeCompare(right));

        const activeDatesSet = new Set();
        let executedHours = 0;
        let maxExecutionDays = 0;

        group.allocationIds.forEach((allocationId) => {
            const datesSet = maps.datesByAlloc.get(allocationId);
            const hours = maps.hoursByAlloc.get(allocationId) || 0;

            executedHours += hours;
            maxExecutionDays = Math.max(maxExecutionDays, datesSet ? datesSet.size : 0);
            if (!datesSet) return;
            datesSet.forEach((dateStr) => activeDatesSet.add(dateStr));
        });

        group.activeDates = sortUniqueIsoDates([...activeDatesSet]);
        group.executedHours = executedHours;
        group.maxExecutionDays = maxExecutionDays;
        group.start = group.activeDates[0] || fallbackStarts[0] || termStart || '';
        group.end = group.activeDates[group.activeDates.length - 1] || fallbackEnds[fallbackEnds.length - 1] || group.start || '';
        const timeRangesByDay = {};
        group.scheduleEntries = group.allocations
            .map((allocation) => ({
                allocationId: allocation?.id,
                diaSemana: Number.parseInt(allocation?.diaSemana, 10) || 0,
                horario: String(allocation?.horario || '').trim()
            }))
            .filter((entry) => entry.diaSemana && entry.horario);

        group.scheduleEntries.forEach((entry) => {
            if (!Array.isArray(timeRangesByDay[entry.diaSemana])) timeRangesByDay[entry.diaSemana] = [];
            if (!timeRangesByDay[entry.diaSemana].includes(entry.horario)) {
                timeRangesByDay[entry.diaSemana].push(entry.horario);
            }
            timeRangesByDay[entry.diaSemana].sort((left, right) => timeToMinutesSafe(left) - timeToMinutesSafe(right));
        });

        group.timeRangesByDay = timeRangesByDay;
        group.faixas = buildCanonicalFaixasForGroup(group, maps, termStart, termEnd);

        group.teacherSegments = collectTeacherSegmentsForGroup(group, calendarByTurma);
    });

    const offerGroups = [...offerGroupsByKey.values()].sort((left, right) => {
        const componentDiff = String(left.componentKey || '').localeCompare(String(right.componentKey || ''));
        if (componentDiff !== 0) return componentDiff;
        const startDiff = String(left.start || '').localeCompare(String(right.start || ''));
        if (startDiff !== 0) return startDiff;
        const endDiff = String(left.end || '').localeCompare(String(right.end || ''));
        if (endDiff !== 0) return endDiff;
        return String(left.docenteLabel || '').localeCompare(String(right.docenteLabel || ''), 'pt-BR', { sensitivity: 'base' });
    });

    const offerGroupsByAllocationId = new Map();
    offerKeyByAllocationId.forEach((offerKey, allocationId) => {
        const group = offerGroupsByKey.get(offerKey);
        if (group) offerGroupsByAllocationId.set(allocationId, group);
    });

    return {
        startDate: termStart,
        endDate: termEnd,
        allocations: exportableAllocations,
        offerGroups,
        offerGroupsByKey,
        offerKeyByAllocationId,
        offerGroupsByAllocationId,
        calendarByTurma,
        datesByAlloc: maps.datesByAlloc,
        hoursByAlloc: maps.hoursByAlloc,
        dateHoursByAlloc: maps.dateHoursByAlloc,
        rangesByAllocation: buildRangeMapFromDates(maps.datesByAlloc, termStart, termEnd)
    };
}

export function buildTeacherExecutionSnapshot({
    docenteName = '',
    startDate = '',
    endDate = '',
    resolveShift = null,
    preferredShiftOrder = [],
    formatTurmaLabel = null
} = {}) {
    const teacherName = String(docenteName || '').trim();
    if (!teacherName) {
        return {
            docenteName: '',
            startDate: String(startDate || '').trim(),
            endDate: String(endDate || '').trim(),
            eventsByDate: {},
            activeShiftData: [],
            conflictRows: [],
            allocations: [],
            allocationsById: new Map(),
            datesByAlloc: new Map(),
            hoursByAlloc: new Map(),
            dateHoursByAlloc: new Map(),
            rangesByAllocation: new Map(),
            totalEvents: 0
        };
    }

    const eventsByDate = getCalendarEvents(null, startDate, endDate, teacherName);
    const maps = buildExecutionMapsFromEvents(eventsByDate);
    const rangesByAllocation = buildRangeMapFromDates(maps.datesByAlloc, startDate, endDate);
    const allocationsById = new Map();
    let totalEvents = 0;

    Object.entries(eventsByDate).forEach(([dateStr, events]) => {
        if (!Array.isArray(events)) return;

        events.forEach((event) => {
            if (!event?.id || event?.type === 'holiday') return;
            totalEvents += 1;

            if (!allocationsById.has(event.id)) {
                const range = rangesByAllocation.get(event.id);
                allocationsById.set(event.id, {
                    ...event,
                    dataInicio: range?.start || dateStr,
                    dataFim: range?.end || dateStr
                });
            }
        });
    });

    return {
        docenteName: teacherName,
        startDate: String(startDate || '').trim(),
        endDate: String(endDate || '').trim(),
        eventsByDate,
        activeShiftData: getTeacherActiveShifts({
            eventsByDate,
            resolveShift,
            preferredOrder: preferredShiftOrder
        }),
        conflictRows: detectTeacherConflicts({
            eventsByDate,
            resolveShift,
            formatTurmaLabel
        }),
        allocations: [...allocationsById.values()],
        allocationsById,
        datesByAlloc: maps.datesByAlloc,
        hoursByAlloc: maps.hoursByAlloc,
        dateHoursByAlloc: maps.dateHoursByAlloc,
        rangesByAllocation,
        totalEvents
    };
}
