import { store } from './store.js??v=20260625v';
import { getCalendarEvents } from './calendar.js??v=20260625v';
import { buildTeacherExecutionSnapshot, buildCanonicalOfferProjection } from './execution_engine.js';
import { renderBidimensionalTeacherGantt, renderBidimensionalTurmaGantt } from './gantt_bidimensional.js??v=20260627v39';
import { filterExportableAllocations } from './academic_rules.mjs';
import { normalizePeriodo as normalizePeriodoLetivoCode } from './plan_storage.js';
import { normalizeHexColor, hexToRgba } from './color_utils.js';
import { formatDateBR, timeToMinutes } from './date_utils_ui.js';
import { showToastWarning } from './ui_feedback.js';
import {
    isFaixaAllocation,
    isPendingAllocation,
    isScheduledRegularAllocation,
    teacherNamesMatch,
    allocationHasTeacherMatch,
    getDocenteShortLabel,
    calculateTeacherTotalCH
} from './allocation_helpers.js';
import {
    normalizeConflictSlotLabel,
    normalizeTurnoOfertaKey,
    formatTurnoOfertaLabel,
    getAvailableTurnoOfertaOptions
} from './turno_helpers.js';
import {
    getDisciplinaCHGlobal,
    getTurmaLabel,
    getDisciplinaInfo
} from './curso_turma_helpers.js';

// Referencias DOM de nivel de modulo (espelham as de ui.js). O modulo e carregado
// como script deferred (via ui.js <- main.js), entao o DOM ja esta pronto aqui.
const calStart = document.getElementById('cal-start');
const calEnd = document.getElementById('cal-end');

export function resolveTeacherShiftForSlot(slot) {
    const config = resolveGanttTurnoForSlot(slot, getGanttTurnoConfigs());
    return config?.value || '';
}

export function buildGanttFaixaDaySnapshots(alloc, rangeStart, rangeEnd) {
    const fallbackStart = String(rangeStart || alloc?.dataInicio || store.settings.termStart || '').trim();
    const fallbackEnd = String(rangeEnd || alloc?.dataFim || store.settings.termEnd || fallbackStart).trim();

    const eventsByDate = getCalendarEvents(alloc.turmaId, fallbackStart, fallbackEnd);
    const grouped = new Map();

    Object.keys(eventsByDate).sort().forEach(dateStr => {
        const events = eventsByDate[dateStr] || [];
        const matched = events.filter(e => e.id === alloc.id);
        if (matched.length === 0) return;

        const dow = new Date(`${dateStr}T12:00:00`).getDay();
        if (dow < 1 || dow > 6) return;

        if (!grouped.has(dow)) {
            grouped.set(dow, {
                dow,
                inicio: dateStr,
                fim: dateStr,
                slotsSet: new Set()
            });
        }

        const entry = grouped.get(dow);
        if (dateStr < entry.inicio) entry.inicio = dateStr;
        if (dateStr > entry.fim) entry.fim = dateStr;

        matched.forEach(e => {
            if (e.horario) entry.slotsSet.add(e.horario);
        });
    });

    return Array.from(grouped.values())
        .map((entry) => ({
            dow: entry.dow,
            inicio: entry.inicio,
            fim: entry.fim,
            slots: [...entry.slotsSet].sort((a, b) => timeToMinutes(a) - timeToMinutes(b))
        }))
        .filter((entry) => entry.slots.length > 0)
        .sort((a, b) => a.dow - b.dow);
}

export function buildGanttFaixaTurnoSnapshots(faixaAlloc, rangeStart, rangeEnd, turnoConfigs = getGanttTurnoConfigs()) {
    const grouped = new Map();

    buildGanttFaixaDaySnapshots(faixaAlloc, rangeStart, rangeEnd).forEach((entry) => {
        const slotsByTurno = new Map();

        (Array.isArray(entry?.slots) ? entry.slots : []).forEach((slot) => {
            const turnoConfig = resolveGanttTurnoForSlot(slot, turnoConfigs);
            if (!turnoConfig?.value) return;
            if (!slotsByTurno.has(turnoConfig.value)) slotsByTurno.set(turnoConfig.value, []);
            slotsByTurno.get(turnoConfig.value).push(String(slot));
        });

        slotsByTurno.forEach((slots, turnoValue) => {
            const key = `${entry.dow}|${turnoValue}`;
            if (!grouped.has(key)) {
                grouped.set(key, {
                    dow: entry.dow,
                    turno: turnoValue,
                    inicio: entry.inicio,
                    fim: entry.fim,
                    slotsSet: new Set()
                });
            }

            const groupedEntry = grouped.get(key);
            if (entry.inicio < groupedEntry.inicio) groupedEntry.inicio = entry.inicio;
            if (entry.fim > groupedEntry.fim) groupedEntry.fim = entry.fim;
            slots.forEach((slot) => groupedEntry.slotsSet.add(slot));
        });
    });

    return Array.from(grouped.values())
        .map((entry) => ({
            dow: entry.dow,
            turno: entry.turno,
            inicio: entry.inicio,
            fim: entry.fim,
            slots: [...entry.slotsSet].sort((a, b) => timeToMinutes(a) - timeToMinutes(b))
        }))
        .filter((entry) => entry.slots.length > 0)
        .sort((a, b) => (a.dow - b.dow) || String(a.turno).localeCompare(String(b.turno)));
}

export function getGanttTurnoCode(turnoValue = '') {
    const normalized = normalizeTurnoOfertaKey(turnoValue);
    if (normalized === 'manha') return 'M';
    if (normalized === 'tarde') return 'T';
    if (normalized === 'noite') return 'N';
    const label = formatTurnoOfertaLabel(turnoValue).replace(/[^A-Za-zÀ-ÿ0-9]/g, '');
    return String(label || 'T').slice(0, 2).toUpperCase();
}

export function getGanttTurnoConfigs() {
    const hp = store.getActiveHorariosPorTurno();
    return getAvailableTurnoOfertaOptions().map((option) => {
        const rawSlots = Array.isArray(hp?.[option.value]) ? hp[option.value] : [];
        const normalizedSlots = rawSlots
            .filter((slot) => !String(slot || '').toUpperCase().includes('INTERVALO'))
            .map((slot) => normalizeConflictSlotLabel(slot))
            .filter(Boolean);
        const timeEntries = normalizedSlots
            .map((slot) => {
                const match = String(slot).match(/\d{1,2}:\d{2}/);
                return match ? match[0] : '';
            })
            .filter(Boolean);
        const minuteEntries = timeEntries
            .map((time) => timeToMinutes(time))
            .filter((mins) => Number.isFinite(mins) && mins < 99999)
            .sort((a, b) => a - b);

        return {
            value: option.value,
            label: option.label,
            normalized: option.normalized,
            shortCode: getGanttTurnoCode(option.value),
            slotSet: new Set(normalizedSlots),
            timeSet: new Set(timeEntries),
            minMinutes: minuteEntries.length ? minuteEntries[0] : null,
            maxMinutes: minuteEntries.length ? minuteEntries[minuteEntries.length - 1] : null
        };
    });
}

export function resolveGanttTurnoForSlot(slot, turnoConfigs = getGanttTurnoConfigs()) {
    const normalizedSlot = normalizeConflictSlotLabel(slot);
    if (!normalizedSlot) return null;

    const timeMatch = normalizedSlot.match(/\d{1,2}:\d{2}/);
    const firstTime = timeMatch ? timeMatch[0] : '';

    const exact = turnoConfigs.find((config) =>
        config.slotSet.has(normalizedSlot) || (firstTime && config.timeSet.has(firstTime))
    );
    if (exact) return exact;

    const mins = timeToMinutes(normalizedSlot);
    if (!Number.isFinite(mins) || mins >= 99999) return null;

    return turnoConfigs.find((config) =>
        Number.isFinite(config.minMinutes)
        && Number.isFinite(config.maxMinutes)
        && mins >= (config.minMinutes - 10)
        && mins <= (config.maxMinutes + 50)
    ) || null;
}

export function resolveGanttTurnosForSlots(slots = [], turnoConfigs = getGanttTurnoConfigs()) {
    const used = new Set();

    (Array.isArray(slots) ? slots : []).forEach((slot) => {
        const config = resolveGanttTurnoForSlot(slot, turnoConfigs);
        if (config?.value) used.add(config.value);
    });

    return turnoConfigs.filter((config) => used.has(config.value));
}

export function getGanttVisibleTurnosLegacy(allocs = [], minDateStr = '', maxDateStr = '', turnoConfigs = getGanttTurnoConfigs()) {
    const used = new Set();

    (Array.isArray(allocs) ? allocs : []).forEach((alloc) => {
        // Ignora allocations completamente pendentes e inválidas
        if (isPendingAllocation(alloc) || !alloc.id) return;

        const snapshots = buildGanttFaixaDaySnapshots(
            alloc,
            alloc.dataInicio || minDateStr,
            alloc.dataFim || maxDateStr
        );
        snapshots.forEach((entry) => {
            resolveGanttTurnosForSlots(entry.slots, turnoConfigs).forEach((config) => used.add(config.value));
        });
    });

    const visible = turnoConfigs.filter((config) => used.has(config.value));
    if (visible.length > 0) return visible;

    const preferred = turnoConfigs.filter((config) => ['manha', 'tarde'].includes(config.normalized));
    return preferred.length > 0 ? preferred : turnoConfigs.slice(0, 2);
}

export function getShiftTimeRangeStr(timeRanges, turnoValue, turnoConfigs = getGanttTurnoConfigs()) {
    if (!timeRanges || timeRanges.length === 0) return '';
    const times = [];

    timeRanges.forEach(tr => {
        if (!tr) return;
        const matches = String(tr).match(/\d{1,2}:\d{2}/g);
        if (matches) times.push(...matches);
    });

    const turnoConfig = turnoConfigs.find((config) => config.value === turnoValue)
        || turnoConfigs.find((config) => config.normalized === normalizeTurnoOfertaKey(turnoValue));
    if (!turnoConfig) return '';

    const filteredTimes = times.filter((time) => {
        const config = resolveGanttTurnoForSlot(time, turnoConfigs);
        return config?.value === turnoConfig.value;
    });

    if (filteredTimes.length === 0) return '';

    filteredTimes.sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
    return ` : ${filteredTimes[0]} - ${filteredTimes[filteredTimes.length - 1]}`;
}

export function getShiftTimeRangeMeta(timeRanges, turnoValue, turnoConfigs = getGanttTurnoConfigs()) {
    if (!timeRanges || timeRanges.length === 0) return { start: '', end: '' };
    const times = [];

    timeRanges.forEach((tr) => {
        if (!tr) return;
        const matches = String(tr).match(/\d{1,2}:\d{2}/g);
        if (matches) times.push(...matches);
    });

    const turnoConfig = turnoConfigs.find((config) => config.value === turnoValue)
        || turnoConfigs.find((config) => config.normalized === normalizeTurnoOfertaKey(turnoValue));
    if (!turnoConfig) return { start: '', end: '' };

    const filteredTimes = times.filter((time) => {
        const config = resolveGanttTurnoForSlot(time, turnoConfigs);
        return config?.value === turnoConfig.value;
    });
    if (filteredTimes.length === 0) return { start: '', end: '' };

    filteredTimes.sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
    return { start: filteredTimes[0], end: filteredTimes[filteredTimes.length - 1] };
}

export function buildGanttTimelineLinesHtml(minTime, maxTime, totalTime) {
    const weekLines = [];
    const weekWalker = new Date(minTime);
    while (weekWalker.getDay() !== 1) {
        weekWalker.setDate(weekWalker.getDate() + 1);
    }

    while (weekWalker.getTime() <= maxTime) {
        const leftPct = ((weekWalker.getTime() - minTime) / totalTime) * 100;
        if (leftPct >= 0 && leftPct <= 100) weekLines.push(leftPct);
        weekWalker.setDate(weekWalker.getDate() + 7);
    }

    return weekLines.map((pct) => `<div class="gantt-grid-line-week" style="left: ${pct}%;"></div>`).join('');
}

export function buildGanttMonthStartLinesHtml(minTime, maxTime, totalTime) {
    const monthStartLines = [];
    let monthWalker = new Date(minTime);
    monthWalker.setDate(1);
    monthWalker = new Date(monthWalker.getFullYear(), monthWalker.getMonth() + 1, 1, 12, 0, 0);

    while (monthWalker.getTime() <= maxTime) {
        const leftPct = ((monthWalker.getTime() - minTime) / totalTime) * 100;
        if (leftPct > 0.1 && leftPct < 100) monthStartLines.push(leftPct);
        monthWalker = new Date(monthWalker.getFullYear(), monthWalker.getMonth() + 1, 1, 12, 0, 0);
    }

    return monthStartLines
        .map((pct) => `<div style="position:absolute; left:${pct}%; top:0; bottom:0; border-left:2px dotted rgba(44,62,80,0.55); z-index:1; pointer-events:none;"></div>`)
        .join('');
}

export function buildGanttMonthOverlaysHtml(minTime, maxTime, totalTime) {
    const monthLines = [];
    let curMonthWalker = new Date(minTime);
    curMonthWalker.setDate(1);

    while (curMonthWalker.getTime() <= maxTime) {
        if (curMonthWalker.getTime() >= minTime) {
            const leftPct = ((curMonthWalker.getTime() - minTime) / totalTime) * 100;
            if (leftPct > 0.1) monthLines.push(leftPct);
        }
        curMonthWalker = new Date(curMonthWalker.getFullYear(), curMonthWalker.getMonth() + 1, 1, 12, 0, 0);
    }

    return monthLines.map((pct) => `
        <div style="position: absolute; left: ${pct}%; top: 0; bottom: 0; border-left: 2px solid #2c3e50; z-index: 10; pointer-events: none;"></div>
    `).join('');
}

export function buildGanttMonthHeaderColumnsHtml(minTime, maxTime, totalTime) {
    let html = '<div class="gantt-header-row" style="display: flex; border-bottom: 2px solid var(--primary); padding: 10px 0; background: #e2e8f0; margin: 0; position: relative; z-index: 6;">';
    html += '<div style="width: 80px; flex-shrink: 0;"></div>';
    html += '<div style="flex: 1; display: flex; position: relative;">';

    let cur = new Date(minTime);
    cur.setDate(1);

    while (cur.getTime() <= maxTime || (cur.getFullYear() === new Date(maxTime).getFullYear() && cur.getMonth() === new Date(maxTime).getMonth())) {
        const nomeCurto = cur.toLocaleString('pt-BR', { month: 'short' }).replace('.', '');
        const mesNome = nomeCurto.charAt(0).toUpperCase() + nomeCurto.slice(1) + '/' + String(cur.getFullYear()).slice(-2);
        const startOfMonth = Math.max(cur.getTime(), minTime);
        const nextMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 1, 12, 0, 0);
        const endOfMonth = Math.min(nextMonth.getTime() - 1, maxTime);
        const widthPct = ((endOfMonth - startOfMonth) / totalTime) * 100;

        if (widthPct > 0) {
            html += `<div class="gantt-month-col" style="width: ${widthPct}%; flex: none; background: transparent; text-align: center; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 0.95em; color: var(--primary); border: none;">${mesNome}</div>`;
        }
        cur = nextMonth;
    }

    html += '</div></div>';
    return html;
}

export function resolveExecutionRangeBounds(range, fallbackStart = '', fallbackEnd = '') {
    return {
        start: range?.firstDate || range?.start || fallbackStart,
        end: range?.lastDate || range?.end || fallbackEnd || range?.firstDate || range?.start || fallbackStart
    };
}

export function collectLegacyGanttDayItems({
    dayId,
    allocs,
    docenteName,
    minDateStr,
    maxDateStr,
    ganttTurnoConfigs,
    visibleTurnos,
    executionRangeByAlloc,
    scheduledExecutionRangeByAlloc
}) {
    const dayItemsMap = {};

    function mergeTimeRanges(currentRanges = [], nextRanges = []) {
        return [...new Set([
            ...(Array.isArray(currentRanges) ? currentRanges : []),
            ...(Array.isArray(nextRanges) ? nextRanges : [])
        ].filter(Boolean).map(String))].sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
    }

    function getProfessorCarga(alloc) {
        let chProf = 0;
        const chTotal = getDisciplinaCHGlobal(alloc.disciplina, alloc.turmaId);
        if (alloc.docentes && alloc.docentes.length > 0) {
            const doc = alloc.docentes.find((entry) => teacherNamesMatch(entry?.nome, docenteName));
            if (doc) chProf = parseInt(doc.ch, 10) || 0;
        } else if (teacherNamesMatch(alloc.docente, docenteName)) {
            chProf = chTotal;
        }
        return { chProf, chTotal };
    }

    allocs.forEach((alloc) => {
        const snapshots = [];
        const executionRange = resolveExecutionRangeBounds(
            executionRangeByAlloc.get(alloc.id),
            alloc.dataInicio || minDateStr,
            alloc.dataFim || maxDateStr
        );
        const scheduledRange = resolveExecutionRangeBounds(
            scheduledExecutionRangeByAlloc.get(alloc.id),
            executionRange.start,
            executionRange.end
        );

        if (isScheduledRegularAllocation(alloc)) {
            if (parseInt(alloc.diaSemana, 10) !== dayId) return;
            const turnos = resolveGanttTurnosForSlots([alloc.horario], ganttTurnoConfigs);
            const safeTurnos = turnos.length > 0 ? turnos : (visibleTurnos[0] ? [visibleTurnos[0]] : []);
            const dayRangeStart = scheduledRange.start;
            const dayRangeEnd = scheduledRange.end;

            safeTurnos.forEach((turnoConfig) => {
                snapshots.push({
                    turno: turnoConfig.value,
                    dataInicio: dayRangeStart,
                    dataFim: dayRangeEnd,
                    slotCount: 1,
                    timeRanges: [alloc.horario],
                    regimeLabel: 'Oferta'
                });
            });
        } else if (isFaixaAllocation(alloc)) {
            buildGanttFaixaTurnoSnapshots(
                alloc,
                alloc.dataInicio || minDateStr,
                alloc.dataFim || maxDateStr,
                ganttTurnoConfigs
            )
                .filter((entry) => entry.dow === dayId)
                .forEach((entry) => {
                    snapshots.push({
                        turno: entry.turno,
                        dataInicio: entry.inicio,
                        dataFim: entry.fim,
                        slotCount: entry.slots.length,
                        timeRanges: entry.slots.slice(),
                        regimeLabel: 'Por faixas'
                    });
                });
        }

        if (snapshots.length === 0) return;

        const { chProf, chTotal } = getProfessorCarga(alloc);

        snapshots.forEach((snapshot) => {
            const itemKey = [
                alloc.turmaId,
                alloc.disciplina,
                snapshot.turno,
                alloc.modo,
                snapshot.dataInicio,
                snapshot.dataFim
            ].join('|');

            if (!dayItemsMap[itemKey]) {
                dayItemsMap[itemKey] = {
                    ...alloc,
                    turno: snapshot.turno,
                    chTotal,
                    chProf,
                    dataInicio: snapshot.dataInicio,
                    dataFim: snapshot.dataFim,
                    slotCount: snapshot.slotCount,
                    timeRanges: mergeTimeRanges([], snapshot.timeRanges),
                    regimeLabel: snapshot.regimeLabel
                };
                return;
            }

            dayItemsMap[itemKey].dataInicio = snapshot.dataInicio && snapshot.dataInicio < dayItemsMap[itemKey].dataInicio
                ? snapshot.dataInicio
                : dayItemsMap[itemKey].dataInicio;
            dayItemsMap[itemKey].dataFim = snapshot.dataFim && snapshot.dataFim > dayItemsMap[itemKey].dataFim
                ? snapshot.dataFim
                : dayItemsMap[itemKey].dataFim;
            dayItemsMap[itemKey].timeRanges = mergeTimeRanges(dayItemsMap[itemKey].timeRanges, snapshot.timeRanges);
            dayItemsMap[itemKey].slotCount = dayItemsMap[itemKey].timeRanges.length;
        });
    });

    return Object.values(dayItemsMap).sort((a, b) => {
        const startCmp = String(a.dataInicio || '').localeCompare(String(b.dataInicio || ''));
        if (startCmp !== 0) return startCmp;
        const endCmp = String(a.dataFim || '').localeCompare(String(b.dataFim || ''));
        if (endCmp !== 0) return endCmp;
        return String(a.disciplina || '').localeCompare(String(b.disciplina || ''));
    });
}

export function getGanttCompactDisciplinaLabel(item) {
    const info = getDisciplinaInfo(item?.disciplina || '');
    const baseRaw = String(info?.abrev || item?.disciplina || '').trim();
    const baseLower = baseRaw ? baseRaw.toLocaleLowerCase('pt-BR') : '';
    const base = baseLower
        ? `${baseLower.charAt(0).toLocaleUpperCase('pt-BR')}${baseLower.slice(1)}`
        : '';
    const preferredHours = Number(item?.chProf);
    const fallbackHours = Number(item?.chTotal);
    const cargaHoraria = Number.isFinite(preferredHours) && preferredHours > 0
        ? preferredHours
        : (Number.isFinite(fallbackHours) && fallbackHours > 0 ? fallbackHours : 0);
    const hoursLabel = cargaHoraria > 0
        ? (Number.isInteger(cargaHoraria)
            ? `${cargaHoraria}h`
            : `${cargaHoraria.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}h`)
        : '';

    if (!base) return hoursLabel || 'Componente';
    return hoursLabel ? `${base} ${hoursLabel}` : base;
}

export function getGanttCompactRangeLabel(item) {
    const compactLabel = getGanttCompactDisciplinaLabel(item);
    const start = formatDateBR(item?.dataInicio || '').slice(0, 5) || '--/--';
    const end = formatDateBR(item?.dataFim || '').slice(0, 5) || '--/--';
    return `${compactLabel} (${start} - ${end})`;
}

export function buildGanttDetailedScheduleRows(timeRanges = []) {
    return [...new Set((Array.isArray(timeRanges) ? timeRanges : [])
        .filter(Boolean)
        .map((slot) => String(slot).trim()))]
        .sort((a, b) => timeToMinutes(a) - timeToMinutes(b))
        .map((slot, idx) => {
            const matches = String(slot).match(/\d{1,2}:\d{2}/g) || [];
            return {
                ordem: idx + 1,
                inicio: matches[0] || String(slot).trim() || '-',
                fim: matches[1] || '',
                label: String(slot).trim() || '-'
            };
        });
}

export function clampGanttPercent(value, min = 0, max = 100) {
    return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

export function formatGanttShortDate(dateStr) {
    return formatDateBR(dateStr || '').slice(0, 5) || '--/--';
}

export function buildGanttSegmentDescriptors({
    item,
    docentesList,
    docenteName,
    compactLabel,
    leftPct,
    widthPct,
    startT,
    endT,
    timeSpan
}) {
    const timelineSpan = timeSpan || 1;
    const explicitSegments = Array.isArray(item?.docenteSegments)
        ? item.docenteSegments.filter((segment) => segment?.nome)
        : [];
    const segmentDescriptors = [];

    if (explicitSegments.length > 0) {
        const sortedSegments = explicitSegments.slice().sort((left, right) => {
            const startDiff = String(left?.start || '').localeCompare(String(right?.start || ''));
            if (startDiff !== 0) return startDiff;
            return String(left?.nome || '').localeCompare(String(right?.nome || ''), 'pt-BR', { sensitivity: 'base' });
        });

        sortedSegments.forEach((segment, idx) => {
            const isTarget = teacherNamesMatch(segment.nome, docenteName);
            const segStartIso = idx === 0
                ? (item.dataInicio || segment.start || '')
                : (segment.start || item.dataInicio || '');
            const nextSegmentStart = String(sortedSegments[idx + 1]?.start || '').trim();
            const displayBoundaryIso = nextSegmentStart || segment.end || item.dataFim || segStartIso;
            let segEndIso = idx === (sortedSegments.length - 1)
                ? (item.dataFim || segment.end || displayBoundaryIso || segStartIso)
                : displayBoundaryIso;

            if (item.dataFim && segEndIso > item.dataFim) segEndIso = item.dataFim;
            if (!segEndIso || segEndIso < segStartIso) segEndIso = segStartIso;

            const segStartT = new Date(`${segStartIso}T12:00:00`).getTime();
            const rawEndT = idx === (sortedSegments.length - 1)
                ? endT
                : new Date(`${displayBoundaryIso || segEndIso}T12:00:00`).getTime();
            const segStartPct = leftPct + (Math.max(0, segStartT - startT) / timelineSpan) * widthPct;
            const rawEndPct = idx === (sortedSegments.length - 1)
                ? (leftPct + widthPct)
                : leftPct + (Math.max(0, rawEndT - startT) / timelineSpan) * widthPct;
            const segEndPct = Math.max(segStartPct + 0.6, Math.min(leftPct + widthPct, rawEndPct));
            const segWidthPct = segEndPct - segStartPct;
            const docenteNameShort = getDocenteShortLabel(segment?.nome) || 'Docente';
            const segCH = Number.parseFloat(segment?.ch) || 0;
            const docenteHoursLabel = Number.isFinite(segCH) && segCH > 0
                ? `${Number.isInteger(segCH) ? segCH : segCH.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}h`
                : '';

            segmentDescriptors.push({
                nome: segment.nome,
                ch: segment.ch,
                isTarget,
                label: isTarget ? compactLabel : `${docenteNameShort}${docenteHoursLabel ? ` (${docenteHoursLabel})` : ''}`,
                startIso: segStartIso,
                endIso: segEndIso,
                startPct: segStartPct,
                endPct: segEndPct,
                widthPct: segWidthPct,
                startShort: formatGanttShortDate(segStartIso),
                endShort: formatGanttShortDate(displayBoundaryIso || segEndIso)
            });
        });

        return segmentDescriptors;
    }

    const flexUnitsList = docentesList.map((docente) => {
        const segCH = parseFloat(docente?.ch) || 0;
        return segCH > 0 ? segCH : 1;
    });
    const totalFlexUnits = flexUnitsList.reduce((sum, value) => sum + value, 0) || 1;
    let currentFlexOffset = 0;
    let currentSegmentT = startT;

    docentesList.forEach((docente, idx) => {
        const segCH = parseFloat(docente?.ch) || 0;
        const totalCH = parseFloat(item?.chTotal) || 0;
        const rawShare = totalCH > 0 ? (segCH / totalCH) : 1;
        const safeShare = rawShare > 0 ? rawShare : (totalCH > 0 ? (1 / totalCH) : 1);
        const flexUnits = flexUnitsList[idx];
        const segEndT = currentSegmentT + (timeSpan * safeShare);
        const segStartPct = leftPct + ((currentFlexOffset / totalFlexUnits) * widthPct);
        const segWidthPct = (flexUnits / totalFlexUnits) * widthPct;
        const docenteNameShort = getDocenteShortLabel(docente?.nome) || 'Docente';
        const docenteHoursLabel = Number.isFinite(segCH) && segCH > 0
            ? `${Number.isInteger(segCH) ? segCH : segCH.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}h`
            : '';
        const isTarget = teacherNamesMatch(docente?.nome, docenteName);
        const segStartIso = new Date(currentSegmentT).toISOString().split('T')[0];
        const segEndIso = new Date(segEndT).toISOString().split('T')[0];

        segmentDescriptors.push({
            nome: docente?.nome || '',
            ch: docente?.ch || 0,
            isTarget,
            label: isTarget ? compactLabel : `${docenteNameShort}${docenteHoursLabel ? ` (${docenteHoursLabel})` : ''}`,
            startIso: segStartIso,
            endIso: segEndIso,
            startPct: segStartPct,
            endPct: segStartPct + segWidthPct,
            widthPct: segWidthPct,
            startShort: formatGanttShortDate(segStartIso),
            endShort: formatGanttShortDate(segEndIso)
        });

        currentFlexOffset += flexUnits;
        currentSegmentT = segEndT;
    });

    return segmentDescriptors;
}

export function buildGanttSharedSegmentLabelsHtml({ segmentMeta, leftPct, widthPct, currentTop, barHeight }) {
    return segmentMeta.map((segment, idx) => {
        const innerLeftPct = widthPct > 0
            ? clampGanttPercent(((segment.startPct - leftPct) / widthPct) * 100)
            : 0;
        const innerRightPct = widthPct > 0
            ? clampGanttPercent(((segment.endPct - leftPct) / widthPct) * 100)
            : 100;
        const innerWidthPct = Math.max(6, innerRightPct - innerLeftPct);
        const showSegmentLabel = innerWidthPct >= 12;
        const nextSegment = segmentMeta[idx + 1] || null;

        const labelHtml = showSegmentLabel
            ? `
                <div style="position:absolute; top:50%; left:${Math.max(1, innerLeftPct)}%; width:${innerWidthPct}%; transform:translateY(-50%); min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:center; font-size:0.68em; font-weight:800; color:#0f172a; text-shadow:0 1px 0 rgba(255,255,255,0.45); padding:0 12px; box-sizing:border-box;">
                    ${segment.label}
                </div>
            `
            : '';
        const seamDateHtml = nextSegment
            ? `<span style="position:absolute; left:${segment.endPct}%; top:${currentTop + (barHeight / 2)}px; transform:translate(-50%, -50%); font-size:0.34em; font-weight:900; color:#0f172a; text-shadow:0 1px 0 rgba(255,255,255,0.9), 0 0 4px rgba(255,255,255,0.72); white-space:nowrap; pointer-events:none; z-index:6;">${segment.endShort}</span>`
            : '';

        return `${labelHtml}${seamDateHtml}`;
    }).join('');
}

// Datas de inicio/fim de cada trecho (emendas) para componente compartilhada (mais de um docente).
// A data da emenda fica por dentro da barra quando o trecho a esquerda couber; senao vai logo acima da barra.
export function buildGanttSharedSeamDatesHtml({ segmentMeta, leftPct, widthPct, currentTop, barHeight }) {
    if (!Array.isArray(segmentMeta) || segmentMeta.length < 2) return '';
    return segmentMeta.map((segment, idx) => {
        const nextSegment = segmentMeta[idx + 1] || null;
        if (!nextSegment) return '';
        const innerLeftPct = widthPct > 0
            ? clampGanttPercent(((segment.startPct - leftPct) / widthPct) * 100)
            : 0;
        const innerRightPct = widthPct > 0
            ? clampGanttPercent(((segment.endPct - leftPct) / widthPct) * 100)
            : 100;
        const segInnerWidthPct = innerRightPct - innerLeftPct;
        const fitsInside = segInnerWidthPct >= 10;
        const verticalOffset = fitsInside
            ? `top:${currentTop + (barHeight / 2)}px; transform:translate(-50%, -50%);`
            : `top:${currentTop - 4}px; transform:translate(-50%, -100%);`;
        return `<span style="position:absolute; left:${segment.endPct}%; ${verticalOffset} font-size:0.34em; font-weight:900; color:#0f172a; text-shadow:0 1px 0 rgba(255,255,255,0.9), 0 0 4px rgba(255,255,255,0.72); white-space:nowrap; pointer-events:none; z-index:6;">${segment.endShort}</span>`;
    }).join('');
}

export function buildGanttOuterDateLabelsHtml({ leftPct, widthPct, currentTop, barHeight, startShort, endShort }) {
    const rightEdgePct = leftPct + widthPct;
    // Quando a ponta da barra encosta na borda do calendario, a data desenhada por fora
    // cairia fora do quadro (recortada pelo overflow). Nesses casos desenhamos por dentro,
    // colada na borda interna da barrinha.
    const startTouchesLeftEdge = leftPct <= 2;
    const endTouchesRightEdge = rightEdgePct >= 98;
    const verticalTop = currentTop + (barHeight / 2);
    const insideShadow = 'text-shadow:0 1px 0 rgba(255,255,255,0.9), 0 0 4px rgba(255,255,255,0.72);';
    const outsideShadow = 'text-shadow:0 1px 0 rgba(255,255,255,0.72);';
    const startLabel = startTouchesLeftEdge
        ? `<span style="position:absolute; left:${leftPct}%; top:${verticalTop}px; transform:translate(4px, -50%); font-size:0.34em; font-weight:900; color:#0f172a; ${insideShadow} white-space:nowrap; pointer-events:none; z-index:6;">${startShort}</span>`
        : `<span style="position:absolute; left:${leftPct}%; top:${verticalTop}px; transform:translate(calc(-100% - 10px), -50%); font-size:0.34em; font-weight:900; color:#0f172a; ${outsideShadow} white-space:nowrap; pointer-events:none; z-index:6;">${startShort}</span>`;
    const endLabel = endTouchesRightEdge
        ? `<span style="position:absolute; left:${rightEdgePct}%; top:${verticalTop}px; transform:translate(calc(-100% - 4px), -50%); font-size:0.34em; font-weight:900; color:#0f172a; ${insideShadow} white-space:nowrap; pointer-events:none; z-index:6;">${endShort}</span>`
        : `<span style="position:absolute; left:${rightEdgePct}%; top:${verticalTop}px; transform:translate(10px, -50%); font-size:0.34em; font-weight:900; color:#0f172a; ${outsideShadow} white-space:nowrap; pointer-events:none; z-index:6;">${endShort}</span>`;
    return `
        ${startLabel}
        ${endLabel}
    `;
}

export function buildGanttInnerDateLabelsHtml({ leftPct, widthPct, currentTop, barHeight, startShort, endShort }) {
    return `
        <span style="position:absolute; left:${leftPct}%; top:${currentTop + (barHeight / 2)}px; transform:translate(6px, -50%); font-size:0.34em; font-weight:900; color:#0f172a; text-shadow:0 1px 0 rgba(255,255,255,0.72); white-space:nowrap; pointer-events:none; z-index:6;">${startShort}</span>
        <span style="position:absolute; left:${leftPct + widthPct}%; top:${currentTop + (barHeight / 2)}px; transform:translate(calc(-100% - 6px), -50%); font-size:0.34em; font-weight:900; color:#0f172a; text-shadow:0 1px 0 rgba(255,255,255,0.72); white-space:nowrap; pointer-events:none; z-index:6;">${endShort}</span>
    `;
}

export function renderGanttTurnoLane({ turnoConfig, dayItems, docenteName, dayConfig, minTime, totalTime, ganttTurnoConfigs, isLastLane, monthStartLinesHtml = '' }) {
    const laneItems = dayItems.filter((item) => item.turno === turnoConfig.value);
    let currentTop = 4;
    let barsHtml = '';

    laneItems.forEach((item) => {
        const startT = new Date(item.dataInicio + 'T12:00:00').getTime();
        const endT = new Date(item.dataFim + 'T12:00:00').getTime();
        const timeSpan = endT - startT;
        let leftPct = ((startT - minTime) / totalTime) * 100;
        let widthPct = (timeSpan / totalTime) * 100;
        if (leftPct < 0) leftPct = 0;
        if (widthPct < 1) widthPct = 1;

        const turmaNome = getTurmaLabel(item.turmaId, item.subGrupo);
        const baseLabel = store.rawData?.turmas?.find((entry) => String(entry.turma_id) === String(item.turmaId))?.turma_label || item.turmaId;
        const isOutOfBounds = store.settings.termEnd && item.dataFim > store.settings.termEnd;
        const baseColor = normalizeHexColor(item.cor || '#3498db');
        const boxBorder = isOutOfBounds ? 'border: 2px solid #900;' : `border: 1px solid ${baseColor};`;
        const barHeight = 40;
        const timeRangeStr = getShiftTimeRangeStr(item.timeRanges, turnoConfig.value, ganttTurnoConfigs);
        const timeRangeMeta = getShiftTimeRangeMeta(item.timeRanges, turnoConfig.value, ganttTurnoConfigs);
        const detailedScheduleRows = buildGanttDetailedScheduleRows(item.timeRanges);
        const componentHours = Number.parseFloat(item.chProf) || Number.parseFloat(item.chTotal) || 0;
        const componentHoursLabel = componentHours > 0
            ? `${Number.isInteger(componentHours) ? componentHours : componentHours.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}h`
            : '';
        const compactLabel = getGanttCompactDisciplinaLabel(item);
        const compactTurmaLabel = String(item.turmaId || '').trim();
        const compactRangeLabel = getGanttCompactRangeLabel(item);
        const startShort = formatDateBR(item.dataInicio || '').slice(0, 5) || '--/--';
        const endShort = formatDateBR(item.dataFim || '').slice(0, 5) || '--/--';
        const useInsideEdgeDates = widthPct >= 18;
        const insideLabelInsetPx = useInsideEdgeDates ? 44 : 8;
        const anchorId = `gantt-${String(dayConfig?.name || 'dia').toLowerCase()}-${String(turnoConfig.value || 'turno').toLowerCase()}-${startT}-${currentTop}`
            .replace(/[^a-z0-9_-]+/gi, '-');
        const defaultInsideLabelHtml = `
            <div style="position:absolute; inset:0; pointer-events:none; z-index:5;">
                <div class="gantt-bar-label-2l" style="position:absolute; top:1px; left:${insideLabelInsetPx}px; right:${insideLabelInsetPx}px; min-width:0; overflow:hidden; text-align:center; font-size:0.58em; line-height:1.08; font-weight:800; color:#0f172a; text-shadow:0 1px 0 rgba(255,255,255,0.35); white-space:normal; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; line-clamp:2; word-break:break-word; overflow-wrap:anywhere;">
                    ${compactLabel}
                </div>
                ${compactTurmaLabel ? `<div style="position:absolute; bottom:1px; left:${insideLabelInsetPx}px; right:${insideLabelInsetPx}px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:center; font-size:0.52em; line-height:1.05; font-weight:700; opacity:0.92; color:#0f172a; text-shadow:0 1px 0 rgba(255,255,255,0.35);">(${compactTurmaLabel})</div>` : ''}
            </div>
        `;

        let segmentsHtml = '';
        const docentesList = (item.docentes && item.docentes.length > 0) ? item.docentes : [{ nome: item.docente, ch: item.chTotal }];
        let targetSegmentStartPct = leftPct;
        let targetSegmentWidthPct = widthPct;
        let targetSegmentFound = false;
        const detailPayload = encodeURIComponent(JSON.stringify({
            disciplina: item.disciplina || '',
            disciplinaAbrev: getGanttCompactDisciplinaLabel(item),
            codigo: getDisciplinaInfo(item.disciplina || '').codigo || '',
            cor: item.cor || '#3498db',
            turma: turmaNome || '',
            turmaBase: baseLabel || '',
            subGrupo: item.subGrupo || '',
            dia: dayConfig?.name || '',
            turno: turnoConfig.label || '',
            inicio: formatDateBR(item.dataInicio),
            fim: formatDateBR(item.dataFim),
            periodo: `${formatDateBR(item.dataInicio)} a ${formatDateBR(item.dataFim)}`,
            horario: timeRangeStr.replace(/^\s*:\s*/, '').trim() || '-',
            horaInicio: timeRangeMeta.start || '',
            horaFim: timeRangeMeta.end || '',
            horariosDetalhados: detailedScheduleRows,
            regime: item.regimeLabel || '',
            cargaHoraria: item.chTotal || 0,
            docente: docenteName || '',
            detalhesDocentes: docentesList.map((docente) => ({
                nome: docente?.nome || '',
                ch: docente?.ch || ''
            }))
        }));
        const segmentMeta = buildGanttSegmentDescriptors({
            item,
            docentesList,
            docenteName,
            compactLabel,
            leftPct,
            widthPct,
            startT,
            endT,
            timeSpan
        });

        segmentMeta.forEach((segment) => {
            const isTarget = !!segment.isTarget;
            const segStartPct = segment.startPct;
            const segWidthPct = segment.widthPct;
            const innerLeftPct = widthPct > 0
                ? clampGanttPercent(((segStartPct - leftPct) / widthPct) * 100)
                : 0;
            const innerWidthPct = widthPct > 0
                ? Math.max(0.8, Math.min(100 - innerLeftPct, (segWidthPct / widthPct) * 100))
                : 100;
            const segmentFill = isTarget
                ? `linear-gradient(90deg, ${hexToRgba(baseColor, 0.92)}, ${baseColor})`
                : 'linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.94))';
            const borderStyle = isTarget ? 'none' : `1px solid ${hexToRgba(baseColor, 0.55)}`;
            const zIndex = isTarget ? '2' : '1';

            if (isTarget && !targetSegmentFound) {
                targetSegmentStartPct = segStartPct;
                targetSegmentWidthPct = segWidthPct;
                targetSegmentFound = true;
            }

            segmentsHtml += `
                    <div class="${isTarget ? 'gantt-bar-anchor-segment' : ''}"
                         data-gantt-anchor="${isTarget ? anchorId : ''}"
                         data-gantt-detail="${isTarget ? detailPayload : ''}"
                         tabindex="${isTarget ? '0' : '-1'}"
                         role="${isTarget ? 'button' : 'presentation'}"
                         style="position:absolute; left:${innerLeftPct}%; width:${innerWidthPct}%; top:0; bottom:0; background:${segmentFill}; color:#000000; border-right:${borderStyle}; border-left:${borderStyle}; display:flex; align-items:center; justify-content:center; overflow:hidden; min-width:0; box-sizing:border-box; z-index:${zIndex};">
                    </div>
                `;
        });

        const showOutsideDates = targetSegmentWidthPct > 0;
        const targetSegmentEndPct = targetSegmentStartPct + targetSegmentWidthPct;
        const targetSpanPct = targetSegmentFound ? targetSegmentWidthPct : widthPct;
        const freeSpaceLeft = targetSegmentFound ? targetSegmentStartPct : leftPct;
        const freeSpaceRight = targetSegmentFound ? (100 - targetSegmentEndPct) : (100 - (leftPct + widthPct));
        const placeExternalRight = freeSpaceRight >= freeSpaceLeft;
        const externalLabelOffsetPx = 42;
        const externalLabelPosition = targetSegmentFound
            ? (placeExternalRight
                ? `left:calc(${Math.min(92, targetSegmentEndPct)}% + ${externalLabelOffsetPx}px);`
                : `right:calc(${Math.min(92, 100 - targetSegmentStartPct)}% + ${externalLabelOffsetPx}px);`)
            : (placeExternalRight
                ? `left:calc(${Math.min(92, leftPct + widthPct)}% + ${externalLabelOffsetPx}px);`
                : `right:calc(${Math.min(92, 100 - leftPct)}% + ${externalLabelOffsetPx}px);`);
        const sharedTargetSegment = false;
        const showExternalLabel = false;
        const sharedSegmentLabelsHtml = sharedTargetSegment
            ? buildGanttSharedSegmentLabelsHtml({ segmentMeta, leftPct, widthPct, currentTop, barHeight })
            : '';
        const insideLabelHtml = !showExternalLabel && sharedTargetSegment
            ? `
                <div style="position:absolute; inset:0; pointer-events:none; z-index:5;">
                    ${sharedSegmentLabelsHtml}
                </div>
            `
            : (!showExternalLabel ? defaultInsideLabelHtml : '');
        const externalLabelHtml = showExternalLabel
            ? `
                <button type="button"
                        class="gantt-external-detail"
                        data-gantt-anchor="${anchorId}"
                        data-gantt-detail="${detailPayload}"
                        aria-label="Abrir detalhes de ${compactRangeLabel}"
                        style="position:absolute; ${externalLabelPosition} top:${currentTop + 8}px; border:none; background:transparent; box-shadow:none; padding:0; display:block; box-sizing:border-box; font-size:0.7em; font-weight:800; color:#1f2937; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer; z-index:6; text-shadow:0 1px 0 rgba(255,255,255,0.92);">
                    ${compactLabel}
                </button>
            `
            : '';
        const edgeDateLabelsHtml = showOutsideDates
            ? (useInsideEdgeDates
                ? buildGanttInnerDateLabelsHtml({ leftPct, widthPct, currentTop, barHeight, startShort, endShort })
                : buildGanttOuterDateLabelsHtml({ leftPct, widthPct, currentTop, barHeight, startShort, endShort }))
            : '';
        const sharedSeamDatesHtml = (docentesList.length > 1)
            ? buildGanttSharedSeamDatesHtml({ segmentMeta, leftPct, widthPct, currentTop, barHeight })
            : '';
        const barDetailAttrs = sharedTargetSegment
            ? ''
            : `data-gantt-anchor="${anchorId}" data-gantt-detail="${detailPayload}" tabindex="0" role="button"`;
        const barCursor = sharedTargetSegment ? 'default' : 'pointer';

        barsHtml += `
                    <div class="gantt-bar"
                         ${barDetailAttrs}
                         style="left: ${leftPct}%; width: ${widthPct}%; top: ${currentTop}px; height: ${barHeight}px; padding: 0; display: flex; flex-direction: row; background:${sharedTargetSegment ? 'linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.94))' : `linear-gradient(90deg, ${hexToRgba(baseColor, 0.92)}, ${baseColor})`}; ${boxBorder} border-radius:6px; box-shadow:0 1px 3px rgba(15,23,42,0.12); overflow:hidden; cursor: ${barCursor}; z-index:3;"
                         aria-label="${item.disciplina} | CH docente: ${item.chProf || item.chTotal || 0}h | Turma: ${turmaNome} | Turno: ${turnoConfig.label}${timeRangeStr} | Regime: ${item.regimeLabel} | Periodo efetivo: ${formatDateBR(item.dataInicio)} a ${formatDateBR(item.dataFim)} | Aulas no dia: ${item.slotCount}">
                        ${segmentsHtml}
                        ${insideLabelHtml}
                    </div>
                    ${edgeDateLabelsHtml}
                    ${sharedSeamDatesHtml}
                    ${externalLabelHtml}
            `;
        currentTop += barHeight + 6;
    });

    const laneHeight = Math.max(30, currentTop);
    const laneBorder = isLastLane ? '' : 'border-bottom: 2px dashed #cbd5e1;';

    return {
        height: laneHeight,
        html: `
                    <div style="display: flex; height: ${laneHeight}px; ${laneBorder} position: relative;">
                        <div style="width: 30px; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 0.7em; color: #64748b; border-right: 1px solid #cbd5e1; background: #e2e8f0; flex-shrink: 0;" title="${turnoConfig.label}">
                            ${turnoConfig.shortCode}
                        </div>
                        <div class="gantt-timeline" style="flex: 1; position: relative; background: transparent; border: none;">
                            ${monthStartLinesHtml}
                            ${barsHtml}
                        </div>
                    </div>
                `
    };
}

export function renderTeacherClassicGantt(container, {
    docenteName = '',
    totalCH = 0,
    offerProjection = null,
    teacherSnapshot = null,
    startDate = '',
    endDate = '',
    ganttTurnoConfigs = []
} = {}) {
    const eventsByDate = teacherSnapshot?.eventsByDate || {};
    const allDates = Object.keys(eventsByDate).sort((a, b) => a.localeCompare(b));
    const minDateStr = String(startDate || allDates[0] || '').trim();
    const maxDateStr = String(endDate || allDates[allDates.length - 1] || minDateStr || '').trim();

    if (!minDateStr || !maxDateStr) {
        container.innerHTML = `<div style="text-align:center; color:#64748b; padding:26px;">Sem dados para o periodo selecionado.</div>`;
        return;
    }

    const minTime = new Date(`${minDateStr}T12:00:00`).getTime();
    const maxTimeRaw = new Date(`${maxDateStr}T12:00:00`).getTime();
    const maxTime = maxTimeRaw > minTime ? maxTimeRaw : (minTime + (24 * 60 * 60 * 1000));
    const totalTime = Math.max(1, maxTime - minTime);
    const monthStartLinesHtml = buildGanttMonthStartLinesHtml(minTime, maxTime, totalTime);
    const visibleTurnos = getGanttVisibleTurnos(teacherSnapshot, ganttTurnoConfigs);

    const dayConfigs = [
        { id: 1, name: 'SEG' },
        { id: 2, name: 'TER' },
        { id: 3, name: 'QUA' },
        { id: 4, name: 'QUI' },
        { id: 5, name: 'SEX' },
        { id: 6, name: 'SÁB' }
    ];

    const rowsHtml = dayConfigs.map((dayConfig) => {
        const dayItems = collectGanttDayItems({
            dayId: dayConfig.id,
            snapshot: teacherSnapshot,
            docenteName,
            offerProjection,
            ganttTurnoConfigs,
            visibleTurnos
        });

        const laneRenders = visibleTurnos.map((turnoConfig, index) => renderGanttTurnoLane({
            turnoConfig,
            dayItems,
            docenteName,
            dayConfig,
            minTime,
            totalTime,
            ganttTurnoConfigs,
            isLastLane: index === (visibleTurnos.length - 1),
            monthStartLinesHtml
        }));

        return renderGanttDayRow(dayConfig, laneRenders);
    }).join('');

    const titleHours = Number.isFinite(Number(totalCH)) && Number(totalCH) > 0
        ? `${Number(totalCH)}H`
        : '-';

    container.innerHTML = `
        <div class="gantt-container teacher-gantt-print" style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px; overflow:hidden; box-shadow:0 1px 3px rgba(15,23,42,0.08);">
            <h3 style="margin:16px 12px 12px 12px; text-align:center; color:var(--primary); font-size:1.55rem; font-weight:800; letter-spacing:0.3px; text-transform:uppercase;">CRONOGRAMA: ${String(docenteName || '').toUpperCase()} (${titleHours})</h3>
            ${buildGanttMonthHeaderColumnsHtml(minTime, maxTime, totalTime)}
            <div style="position:relative; background:#eef2f7; border-top:2px solid var(--primary);">
                ${rowsHtml}
            </div>
        </div>
    `;
}

export function renderGanttDayRow(dayConfig, laneRenders) {
    const totalRowHeight = laneRenders.reduce((sum, lane) => sum + lane.height, 0);
    return `
            <div class="gantt-row" style="display: flex; border-bottom: 1px solid #2c3e50; margin: 0; padding: 0; min-height: ${totalRowHeight}px; position: relative; z-index: 1;">
                <div style="width: 50px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.78em; color: var(--primary); background: #e2e8f0; border-right: 1px solid #cbd5e1; flex-shrink: 0;">
                    ${dayConfig.name}
                </div>
                <div style="flex: 1; display: flex; flex-direction: column;">
                    ${laneRenders.map((lane) => lane.html).join('')}
                </div>
            </div>
        `;
}

export function buildGanttLensHtml(detail, placement = 'above', pinned = false) {
    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    const accent = normalizeHexColor(detail?.cor || '#3498db');
    const accentSoft = hexToRgba(accent, 0.14);
    const accentMid = hexToRgba(accent, 0.24);
    const accentStrong = hexToRgba(accent, 0.92);
    const pointerStyle = placement === 'below'
        ? 'top:-8px;'
        : 'bottom:-8px;';
    const dockStyle = placement === 'below'
        ? 'top:-1px; border-radius:0 0 16px 16px;'
        : 'bottom:-1px; border-radius:16px 16px 0 0;';
    const detailedRows = Array.isArray(detail?.horariosDetalhados) ? detail.horariosDetalhados : [];
    const detailedRowsHtml = detailedRows.length > 0
        ? detailedRows.map((row) => `
            <tr>
                <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; font-weight:700; color:#475569; text-align:center;">${escapeHtml(row?.ordem || '-')}</td>
                <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; color:#0f172a; text-align:left;">${escapeHtml(row?.label || row?.inicio || '-')}</td>
            </tr>
        `).join('')
        : '';
    const turmaParts = [detail?.turmaBase || detail?.turma || '', detail?.subGrupo || '']
        .map((value) => String(value || '').trim())
        .filter(Boolean);
    const turmaInlineLabel = turmaParts.join(' ');

    return `
        <div style="position:absolute; inset:0; border-radius:18px; border:1px solid ${accentMid}; background:linear-gradient(180deg, rgba(255,255,255,0.99), rgba(246,248,251,0.98)); box-shadow:0 18px 34px rgba(15,23,42,0.18), 0 0 0 1px ${hexToRgba(accent, 0.05)};"></div>
        <div style="position:absolute; left:0; right:0; ${placement === 'below' ? 'top:0;' : 'bottom:0;'} height:18px; background:linear-gradient(90deg, ${hexToRgba(accent, 0)}, ${accentSoft} 20%, ${accentMid} 50%, ${accentSoft} 80%, ${hexToRgba(accent, 0)}); border-radius:${placement === 'below' ? '18px 18px 0 0' : '0 0 18px 18px'};"></div>
        <div style="position:absolute; ${dockStyle} left:calc(var(--gantt-lens-anchor-x, 50%) - 42px); width:84px; height:10px; background:${accentStrong}; box-shadow:0 0 0 3px ${hexToRgba(accent, 0.12)};"></div>
        <div style="position:absolute; ${pointerStyle} left:var(--gantt-lens-anchor-x, 50%); width:16px; height:16px; background:linear-gradient(135deg, ${accentStrong}, ${accent}); transform:translateX(-50%) rotate(45deg); box-shadow:0 6px 14px ${hexToRgba(accent, 0.28)};"></div>
        <div style="position:relative; padding:14px 14px 12px 14px;">
            ${pinned ? `<button type="button" data-gantt-lens-close="1" aria-label="Fechar lupa" style="position:absolute; top:10px; right:10px; width:28px; height:28px; border:none; border-radius:999px; background:${hexToRgba(accent, 0.1)}; color:#334155; font-size:18px; line-height:1; cursor:pointer; display:inline-flex; align-items:center; justify-content:center;">&times;</button>` : ''}
            <div style="min-width:0; margin-bottom:10px; ${pinned ? 'padding-right:34px;' : ''}">
                <div style="font-size:0.98em; font-weight:800; color:#0f172a; line-height:1.2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(detail?.disciplina || '-')}</div>
                ${turmaInlineLabel ? `<div style="margin-top:4px; font-size:0.8em; font-weight:700; color:#475569; line-height:1.25; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Turma: ${escapeHtml(turmaInlineLabel)}</div>` : ''}
            </div>
            ${detailedRowsHtml ? `
                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:10px 12px;">
                    <div style="font-size:0.72em; font-weight:800; color:#64748b; text-transform:uppercase; margin-bottom:8px;">Horarios do Componente</div>
                    <table style="width:100%; border-collapse:collapse; font-size:0.84em;">
                        <thead>
                            <tr>
                                <th style="padding:0 8px 6px 8px; text-align:center; color:#64748b; font-size:0.72em; text-transform:uppercase;">#</th>
                                <th style="padding:0 8px 6px 8px; text-align:left; color:#64748b; font-size:0.72em; text-transform:uppercase;">Horario</th>
                            </tr>
                        </thead>
                        <tbody>${detailedRowsHtml}</tbody>
                    </table>
                </div>
            ` : ''}
        </div>
    `;
}

export function ensureGanttDetailLens(container) {
    const host = container?.querySelector('.gantt-container');
    if (!host) return null;

    let lens = host.querySelector('#gantt-detail-lens');
    if (lens) return lens;

    lens = document.createElement('div');
    lens.id = 'gantt-detail-lens';
    lens.style.cssText = 'position:absolute; width:min(360px, calc(100% - 24px)); min-height:146px; display:none; opacity:0; transform:translateY(8px) scale(0.98); transform-origin:var(--gantt-lens-anchor-x, 50%) var(--gantt-lens-origin-y, 100%); transition:opacity 0.16s ease, transform 0.18s ease; z-index:40; pointer-events:auto;';
    host.appendChild(lens);
    return lens;
}

export function positionGanttDetailLens(container, target) {
    const host = container?.querySelector('.gantt-container');
    const lens = host?.querySelector('#gantt-detail-lens');
    if (!host || !lens || !target) return;

    const hostRect = host.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const mobileViewport = window.innerWidth <= 768;
    const horizontalPadding = mobileViewport ? 8 : 12;
    const maxAllowedWidth = Math.max(180, hostRect.width - (horizontalPadding * 2));
    const lensWidth = mobileViewport ? maxAllowedWidth : Math.min(360, maxAllowedWidth);
    const lensHeight = Math.max(146, lens.offsetHeight || 190);
    const anchorCenter = targetRect.left - hostRect.left + (targetRect.width / 2);
    const topAbove = targetRect.top - hostRect.top - lensHeight - 10;
    const topBelow = targetRect.bottom - hostRect.top + 10;
    const spaceAbove = targetRect.top - hostRect.top;
    const spaceBelow = hostRect.bottom - targetRect.bottom;
    const placement = spaceAbove >= (lensHeight + 18)
        ? 'above'
        : (spaceBelow >= (lensHeight + 18)
            ? 'below'
            : (spaceBelow >= spaceAbove ? 'below' : 'above'));
    const rawTop = placement === 'above' ? topAbove : topBelow;
    const top = Math.max(12, Math.min(hostRect.height - lensHeight - 12, rawTop));
    const left = Math.max(horizontalPadding, Math.min(hostRect.width - lensWidth - horizontalPadding, anchorCenter - (lensWidth / 2)));
    const anchorClampMin = mobileViewport ? 10 : 6;
    const anchorClampMax = mobileViewport ? 90 : 94;
    const anchorPercent = Math.max(anchorClampMin, Math.min(anchorClampMax, ((anchorCenter - left) / lensWidth) * 100));

    lens.style.width = `${lensWidth}px`;
    lens.style.left = `${left}px`;
    lens.style.top = `${top}px`;
    lens.style.setProperty('--gantt-lens-anchor-x', `${anchorPercent}%`);
    lens.style.setProperty('--gantt-lens-origin-y', placement === 'above' ? '100%' : '0%');
    return placement;
}

export function ensureGanttDetailModal() {
    let overlay = document.getElementById('gantt-detail-overlay');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'gantt-detail-overlay';
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(15,23,42,0.58); display:none; align-items:center; justify-content:center; z-index:5000; padding:20px;';
    overlay.innerHTML = `
        <div style="width:min(560px, 100%); background:#ffffff; border-radius:16px; box-shadow:0 22px 60px rgba(15,23,42,0.28); padding:22px; position:relative;">
            <button id="btn-gantt-detail-close" type="button" style="position:absolute; top:14px; right:14px; border:none; background:#eef2f7; color:#2c3e50; border-radius:999px; width:34px; height:34px; font-size:20px; cursor:pointer;">×</button>
            <div id="gantt-detail-body"></div>
        </div>
    `;
    document.body.appendChild(overlay);

    const closeModal = () => {
        overlay.style.display = 'none';
    };

    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) closeModal();
    });
    overlay.querySelector('#btn-gantt-detail-close')?.addEventListener('click', closeModal);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && overlay.style.display === 'flex') closeModal();
    });

    return overlay;
}

export function openGanttDetailModal(detail) {
    const overlay = ensureGanttDetailModal();
    const body = document.getElementById('gantt-detail-body');
    if (!overlay || !body) return;

    {
        const modalCard = overlay.firstElementChild;
        const closeButton = overlay.querySelector('#btn-gantt-detail-close');
        if (modalCard) {
            modalCard.style.cssText = 'width:min(640px, 100%); max-height:min(88vh, 760px); background:#ffffff; border-radius:18px; box-shadow:0 22px 60px rgba(15,23,42,0.28); position:relative; overflow:hidden;';
        }
        if (closeButton) {
            closeButton.innerHTML = '&times;';
            closeButton.style.cssText = 'position:absolute; top:14px; right:14px; border:none; background:#eef2f7; color:#2c3e50; border-radius:999px; width:34px; height:34px; font-size:20px; cursor:pointer; z-index:2;';
        }
        body.style.cssText = 'overflow:auto; max-height:min(88vh, 760px);';

        const escapeHtml = (value) => String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

        const accentColor = escapeHtml(detail?.cor || '#3498db');
        const turmaLabel = [detail?.turmaBase || detail?.turma || '-', detail?.subGrupo || '']
            .filter(Boolean)
            .join(' ')
            .trim();
        const docentesHtml = Array.isArray(detail?.detalhesDocentes) && detail.detalhesDocentes.length > 0
            ? detail.detalhesDocentes.map((docente) => `
                <li style="display:flex; justify-content:space-between; gap:12px; padding:8px 0; border-bottom:1px solid #e2e8f0;">
                    <span style="font-weight:600; color:#1f2937;">${escapeHtml(docente.nome || '-')}</span>
                    <span style="color:#52606d; white-space:nowrap;">${escapeHtml(docente.ch || 0)}h</span>
                </li>
            `).join('')
            : '<li style="padding:8px 0; color:#52606d;">-</li>';
        const horariosHtml = Array.isArray(detail?.horariosDetalhados) && detail.horariosDetalhados.length > 0
            ? `
                <table style="width:100%; border-collapse:collapse; margin-top:8px; font-size:0.92em;">
                    <thead>
                        <tr>
                            <th style="text-align:center; padding:0 8px 8px 8px; color:#64748b; font-size:0.72em; text-transform:uppercase;">#</th>
                            <th style="text-align:left; padding:0 8px 8px 8px; color:#64748b; font-size:0.72em; text-transform:uppercase;">Horario</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${detail.horariosDetalhados.map((row) => `
                            <tr>
                                <td style="padding:8px; border-top:1px solid #e2e8f0; text-align:center; font-weight:700; color:#475569;">${escapeHtml(row?.ordem || '-')}</td>
                                <td style="padding:8px; border-top:1px solid #e2e8f0; color:#0f172a;">${escapeHtml(row?.label || row?.inicio || '-')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `
            : `<div style="margin-top:8px; color:#0f172a;">${escapeHtml(detail?.horario || '-')}</div>`;

        body.innerHTML = `
            <div style="height:8px; background:${accentColor};"></div>
            <div style="padding:24px 24px 20px 24px;">
                <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom:12px; padding-right:40px;">
                    <span style="display:inline-flex; align-items:center; border-radius:999px; background:#eef6ff; color:#1d4ed8; padding:6px 12px; font-size:0.82em; font-weight:800; text-transform:uppercase; letter-spacing:0.04em;">${escapeHtml(detail?.turno || '-')}</span>
                    <span style="display:inline-flex; align-items:center; border-radius:999px; background:#f8fafc; color:#475569; padding:6px 12px; font-size:0.82em; font-weight:700;">${escapeHtml(detail?.regime || '-')} · ${escapeHtml(detail?.cargaHoraria || 0)}h</span>
                </div>

                <h3 style="margin:0; color:var(--primary); font-size:1.3em; line-height:1.25; text-transform:uppercase;">${escapeHtml(detail?.disciplina || '-')}</h3>
                <p style="margin:8px 0 0 0; color:#52606d; font-size:0.98em; font-weight:700;">${escapeHtml(turmaLabel || '-')}</p>

                <div style="margin-top:18px; display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px;">
                    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:14px;">
                        <div style="font-size:0.76em; font-weight:800; color:#64748b; text-transform:uppercase; letter-spacing:0.05em;">Periodo</div>
                        <div style="margin-top:6px; font-size:1em; font-weight:700; color:#0f172a;">${escapeHtml(detail?.periodo || '-')}</div>
                    </div>
                    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:14px;">
                        <div style="font-size:0.76em; font-weight:800; color:#64748b; text-transform:uppercase; letter-spacing:0.05em;">Horario</div>
                        <div style="margin-top:6px; font-size:1em; font-weight:700; color:#0f172a;">${escapeHtml(detail?.horario || '-')}</div>
                    </div>
                    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:14px;">
                        <div style="font-size:0.76em; font-weight:800; color:#64748b; text-transform:uppercase; letter-spacing:0.05em;">Dia</div>
                        <div style="margin-top:6px; font-size:1em; font-weight:700; color:#0f172a;">${escapeHtml(detail?.dia || '-')}</div>
                    </div>
                </div>

                <div style="margin-top:16px; background:#fffdf3; border:1px solid #efe2a8; border-radius:12px; padding:14px;">
                    <div style="font-size:0.76em; font-weight:800; color:#8a6d1d; text-transform:uppercase; letter-spacing:0.05em;">Resumo da barra curta</div>
                    <div style="margin-top:6px; font-size:0.98em; font-weight:700; color:#3f3b17;">${escapeHtml(detail?.disciplinaAbrev || detail?.disciplina || '-')}</div>
                    <div style="margin-top:8px; font-size:0.9em; color:#6b7280;">Inicio ${escapeHtml(detail?.inicio || '-')} · Fim ${escapeHtml(detail?.fim || '-')} · Codigo ${escapeHtml(detail?.codigo || '-')}</div>
                </div>

                <div style="margin-top:16px; border:1px solid #e2e8f0; border-radius:12px; padding:14px;">
                    <div style="font-size:0.76em; font-weight:800; color:#64748b; text-transform:uppercase; letter-spacing:0.05em;">Docentes e distribuicao</div>
                    <ul style="list-style:none; margin:10px 0 0 0; padding:0;">${docentesHtml}</ul>
                </div>

                <div style="margin-top:16px; border:1px solid #e2e8f0; border-radius:12px; padding:14px;">
                    <div style="font-size:0.76em; font-weight:800; color:#64748b; text-transform:uppercase; letter-spacing:0.05em;">Horarios da Barra</div>
                    ${horariosHtml}
                </div>

                <div style="margin-top:16px; font-size:0.86em; color:#64748b; line-height:1.45;">
                    Versao A para avaliacao: o modal mostra so o essencial da oferta para testar se o clique compensa a reducao do texto dentro da barra.
                </div>
            </div>
        `;

        overlay.style.display = 'flex';
        return;
    }

    const docentesHtml = Array.isArray(detail?.detalhesDocentes) && detail.detalhesDocentes.length > 0
        ? detail.detalhesDocentes.map((docente) => `<li><strong>${docente.nome || '-'}</strong> - ${docente.ch || 0}h</li>`).join('')
        : '<li>-</li>';
    const horariosHtml = Array.isArray(detail?.horariosDetalhados) && detail.horariosDetalhados.length > 0
        ? `
            <table style="width:100%; border-collapse:collapse; margin-top:8px; font-size:0.92em;">
                <thead>
                    <tr>
                        <th style="text-align:center; padding:0 8px 8px 8px; color:#64748b; font-size:0.72em; text-transform:uppercase;">#</th>
                        <th style="text-align:left; padding:0 8px 8px 8px; color:#64748b; font-size:0.72em; text-transform:uppercase;">Horario</th>
                    </tr>
                </thead>
                <tbody>
                    ${detail.horariosDetalhados.map((row) => `
                        <tr>
                            <td style="padding:8px; border-top:1px solid #e2e8f0; text-align:center; font-weight:700; color:#475569;">${row?.ordem || '-'}</td>
                            <td style="padding:8px; border-top:1px solid #e2e8f0; color:#0f172a;">${row?.label || row?.inicio || '-'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `
        : `<div style="margin-top:8px;">${detail?.horario || '-'}</div>`;

    body.innerHTML = `
        <h3 style="margin:0 0 6px 0; color:var(--primary); text-transform:uppercase; letter-spacing:0.6px;">Detalhes da Oferta no Gantt</h3>
        <p style="margin:0 0 18px 0; color:#52606d; font-weight:600;">Clique na barra para inspecionar quando o rótulo não couber.</p>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:12px;">
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px;"><strong>Componente</strong><br>${detail?.disciplina || '-'}</div>
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px;"><strong>Turma</strong><br>${detail?.turma || '-'}</div>
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px;"><strong>Turno</strong><br>${detail?.turno || '-'}</div>
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px;"><strong>Periodo</strong><br>${detail?.periodo || '-'}</div>
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px;"><strong>Horario</strong><br>${detail?.horario || '-'}</div>
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px;"><strong>Regime / CH</strong><br>${detail?.regime || '-'} · ${detail?.cargaHoraria || 0}h</div>
        </div>
        <div style="margin-top:12px; display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:12px;">
            <div style="background:#fffdf3; border:1px solid #efe2a8; border-radius:10px; padding:12px;"><strong>Resumo Compacto</strong><br>${detail?.disciplinaAbrev || detail?.disciplina || '-'}</div>
            <div style="background:#fffdf3; border:1px solid #efe2a8; border-radius:10px; padding:12px;"><strong>Dia</strong><br>${detail?.dia || '-'}</div>
            <div style="background:#fffdf3; border:1px solid #efe2a8; border-radius:10px; padding:12px;"><strong>Inicio / Fim</strong><br>${detail?.inicio || '-'} a ${detail?.fim || '-'}</div>
            <div style="background:#fffdf3; border:1px solid #efe2a8; border-radius:10px; padding:12px;"><strong>Codigo</strong><br>${detail?.codigo || '-'}</div>
        </div>
        <div style="margin-top:14px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px;">
            <strong>Docente(s) e distribuicao</strong>
            <ul style="margin:8px 0 0 18px;">${docentesHtml}</ul>
        </div>
        <div style="margin-top:14px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px;">
            <strong>Horarios da Barra</strong>
            ${horariosHtml}
        </div>
    `;

    overlay.style.display = 'flex';
}

export function bindGanttDetailInteractions(container) {
    if (!container) return;

    const lens = ensureGanttDetailLens(container);
    let hideTimer = 0;
    let hideCycle = 0;
    let pinnedKey = '';
    let pinnedAnchor = '';
    let visibleKey = '';
    let visibleAnchor = '';
    let visiblePinned = false;
    let visiblePlacement = 'above';

    const targets = () => container.querySelectorAll('.gantt-bar[data-gantt-detail], .gantt-bar-anchor-segment[data-gantt-detail], .gantt-external-detail[data-gantt-detail]');
    const getAnchorElements = (anchorId) => anchorId
        ? Array.from(container.querySelectorAll(`[data-gantt-anchor="${anchorId}"]`))
        : [];
    const getAnchorTarget = (target) => {
        if (target?.classList?.contains('gantt-bar-anchor-segment')) return target;
        const anchorId = target?.dataset?.ganttAnchor || '';
        const anchorElements = getAnchorElements(anchorId);
        return anchorElements.find((el) => el.classList.contains('gantt-bar-anchor-segment'))
            || anchorElements.find((el) => el.classList.contains('gantt-bar'))
            || target;
    };
    const resetTargetStyles = (el) => {
        el.style.outline = 'none';
        el.style.zIndex = el.classList.contains('gantt-external-detail') ? '6' : '3';
        if (el.classList.contains('gantt-external-detail')) {
            el.style.textDecoration = 'none';
            el.style.color = '#1f2937';
        }
    };
    const clearActiveStates = () => {
        targets().forEach((el) => resetTargetStyles(el));
    };
    const applyActiveState = (anchorId, pinned = false) => {
        getAnchorElements(anchorId).forEach((el) => {
            el.style.zIndex = el.classList.contains('gantt-external-detail') ? (pinned ? '12' : '8') : (pinned ? '20' : '10');
            if (el.classList.contains('gantt-external-detail')) {
                el.style.textDecoration = 'underline';
                el.style.textUnderlineOffset = '2px';
                el.style.color = '#0f172a';
                return;
            }
            el.style.outline = pinned ? '2px solid rgba(15,23,42,0.28)' : '1px solid rgba(15,23,42,0.18)';
        });
    };

    const clearHideTimer = () => {
        if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = 0;
        }
        hideCycle += 1;
    };

    const clearVisibleState = () => {
        visibleKey = '';
        visibleAnchor = '';
        visiblePinned = false;
        visiblePlacement = 'above';
    };

    const hideLens = (force = false) => {
        if (!lens) return;
        if (!force && pinnedKey) return;
        clearHideTimer();
        const cycleId = hideCycle;
        if (force) {
            pinnedKey = '';
            pinnedAnchor = '';
        }
        lens.style.opacity = '0';
        lens.style.transform = 'translateY(8px) scale(0.98)';
        window.setTimeout(() => {
            if (cycleId !== hideCycle) return;
            if (!pinnedKey) {
                lens.style.display = 'none';
                clearActiveStates();
                clearVisibleState();
            }
        }, 180);
    };

    const showLens = (target, detail, pinned = false) => {
        if (!lens) {
            openGanttDetailModal(detail);
            return;
        }

        clearHideTimer();
        const anchorId = target?.dataset?.ganttAnchor || '';
        const detailKey = target?.dataset?.ganttDetail || '';
        const anchorTarget = getAnchorTarget(target);
        const sameVisibleTarget = lens.style.display === 'block'
            && visibleKey === detailKey
            && visibleAnchor === anchorId
            && visiblePinned === pinned;
        if (pinned) {
            pinnedKey = detailKey;
            pinnedAnchor = anchorId;
        }
        clearActiveStates();
        applyActiveState(anchorId, pinned);
        lens.style.display = 'block';
        if (!sameVisibleTarget) {
            lens.innerHTML = buildGanttLensHtml(detail, visiblePlacement, pinned);
        }
        const measuredPlacement = positionGanttDetailLens(container, anchorTarget) || 'above';
        if (!sameVisibleTarget || measuredPlacement !== visiblePlacement) {
            lens.innerHTML = buildGanttLensHtml(detail, measuredPlacement, pinned);
            positionGanttDetailLens(container, anchorTarget);
        }
        visibleKey = detailKey;
        visibleAnchor = anchorId;
        visiblePinned = pinned;
        visiblePlacement = measuredPlacement;
        if (!sameVisibleTarget) {
            requestAnimationFrame(() => {
                lens.style.opacity = '1';
                lens.style.transform = 'translateY(0) scale(1)';
            });
            return;
        }
        lens.style.opacity = '1';
        lens.style.transform = 'translateY(0) scale(1)';
    };

    if (lens && lens.dataset.bound !== '1') {
        lens.dataset.bound = '1';
        lens.addEventListener('mouseenter', clearHideTimer);
        lens.addEventListener('mouseleave', () => {
            hideTimer = window.setTimeout(() => hideLens(false), 140);
        });
        lens.addEventListener('click', (event) => {
            const closeButton = event.target.closest('[data-gantt-lens-close="1"]');
            if (!closeButton) return;
            event.preventDefault();
            event.stopPropagation();
            hideLens(true);
        });
    }

    targets().forEach((target) => {
        if (target.dataset.detailBound === '1') return;
        target.dataset.detailBound = '1';
        target.addEventListener('mouseenter', () => {
            try {
                if (pinnedKey) return;
                const detail = JSON.parse(decodeURIComponent(target.dataset.ganttDetail || '%7B%7D'));
                showLens(target, detail, false);
            } catch (err) {
                console.error('Falha ao abrir lupa do Gantt', err);
            }
        });
        target.addEventListener('mouseleave', () => {
            if (pinnedKey) return;
            hideTimer = window.setTimeout(() => hideLens(false), 140);
        });
        target.addEventListener('click', () => {
            try {
                const detail = JSON.parse(decodeURIComponent(target.dataset.ganttDetail || '%7B%7D'));
                const clickedKey = target.dataset.ganttDetail || '';
                const clickedAnchor = target.dataset.ganttAnchor || '';
                if (pinnedKey && pinnedKey === clickedKey) {
                    hideLens(true);
                    return;
                }
                pinnedAnchor = clickedAnchor;
                showLens(target, detail, true);
            } catch (err) {
                console.error('Falha ao abrir detalhes do Gantt', err);
            }
        });
        target.addEventListener('focus', () => {
            try {
                if (pinnedKey) return;
                const detail = JSON.parse(decodeURIComponent(target.dataset.ganttDetail || '%7B%7D'));
                showLens(target, detail, false);
            } catch (err) {
                console.error('Falha ao focar lupa do Gantt', err);
            }
        });
        target.addEventListener('blur', () => {
            if (pinnedKey) return;
            hideTimer = window.setTimeout(() => hideLens(false), 140);
        });
        target.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            target.click();
        });
    });

    if (container.dataset.ganttLensDocBound !== '1') {
        container.dataset.ganttLensDocBound = '1';
        document.addEventListener('click', (event) => {
            if (!container.contains(event.target)) {
                pinnedKey = '';
                hideLens(true);
            }
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') hideLens(true);
        });
        window.addEventListener('scroll', () => {
            if (!pinnedKey || !pinnedAnchor) return;
            const target = getAnchorTarget({ dataset: { ganttAnchor: pinnedAnchor } });
            if (!target) {
                hideLens(true);
                return;
            }
            const detail = JSON.parse(decodeURIComponent(pinnedKey || '%7B%7D'));
            showLens(target, detail, true);
        }, true);
        window.addEventListener('resize', () => {
            if (!pinnedKey || !pinnedAnchor) {
                hideLens(true);
                return;
            }
            const target = getAnchorTarget({ dataset: { ganttAnchor: pinnedAnchor } });
            if (!target) {
                hideLens(true);
                return;
            }
            const detail = JSON.parse(decodeURIComponent(pinnedKey || '%7B%7D'));
            showLens(target, detail, true);
        });
    }
}

export function getGanttVisibleTurnos(snapshot = null, turnoConfigs = getGanttTurnoConfigs()) {
    const used = new Set(
        (Array.isArray(snapshot?.activeShiftData) ? snapshot.activeShiftData : [])
            .map((shift) => {
                const rawValue = String(shift?.value || '').trim();
                if (!rawValue) return '';
                const matchedConfig = turnoConfigs.find((config) =>
                    String(config?.value || '').trim() === rawValue
                    || String(config?.normalized || '').trim() === normalizeTurnoOfertaKey(rawValue)
                );
                return matchedConfig?.normalized || normalizeTurnoOfertaKey(rawValue);
            })
            .filter(Boolean)
    );

    const byNormalized = new Map();
    turnoConfigs.forEach((config) => {
        const normalized = String(config?.normalized || '').trim();
        if (!normalized || byNormalized.has(normalized)) return;
        byNormalized.set(normalized, config);
    });

    const visible = ['manha', 'tarde']
        .map((normalized) => byNormalized.get(normalized))
        .filter(Boolean);

    if (used.has('noite') && byNormalized.has('noite')) {
        visible.push(byNormalized.get('noite'));
    }

    return visible.length > 0 ? visible : turnoConfigs.slice(0, Math.min(2, turnoConfigs.length));
}

export function collectGanttDayItems({
    dayId,
    snapshot,
    docenteName,
    offerProjection,
    ganttTurnoConfigs,
    visibleTurnos
}) {
    const dayItemsMap = {};

    function mergeTimeRanges(currentRanges = [], nextRanges = []) {
        return [...new Set([
            ...(Array.isArray(currentRanges) ? currentRanges : []),
            ...(Array.isArray(nextRanges) ? nextRanges : [])
        ].filter(Boolean).map(String))].sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
    }

    function extractDocentesList(alloc, fallbackHours = 0) {
        if (Array.isArray(alloc?.docentes) && alloc.docentes.length > 0) {
            return alloc.docentes.map((docente) => ({
                nome: String(docente?.nome || '').trim(),
                ch: Number.parseFloat(docente?.ch) || 0
            })).filter((docente) => docente.nome);
        }

        const singleName = String(alloc?.docente || '').trim();
        if (!singleName) return [];
        return [{
            nome: singleName,
            ch: Number.parseFloat(alloc?.ch) || Number.parseFloat(fallbackHours) || 0
        }];
    }

    function mergeDocentesList(currentList = [], nextList = []) {
        const merged = new Map();

        [...(Array.isArray(currentList) ? currentList : []), ...(Array.isArray(nextList) ? nextList : [])]
            .forEach((docente) => {
                const nome = String(docente?.nome || '').trim();
                if (!nome) return;
                const current = merged.get(nome);
                const nextCH = Number.parseFloat(docente?.ch) || 0;
                if (!current) {
                    merged.set(nome, { nome, ch: nextCH });
                    return;
                }
                merged.set(nome, { nome, ch: Math.max(Number.parseFloat(current?.ch) || 0, nextCH) });
            });

        return [...merged.values()];
    }

    function getProfessorCarga(alloc) {
        let chProf = 0;
        const chTotal = getDisciplinaCHGlobal(alloc.disciplina, alloc.turmaId);
        if (alloc.docentes && alloc.docentes.length > 0) {
            const doc = alloc.docentes.find((entry) => teacherNamesMatch(entry?.nome, docenteName));
            if (doc) chProf = parseInt(doc.ch, 10) || 0;
        } else if (teacherNamesMatch(alloc.docente, docenteName)) {
            chProf = chTotal;
        }
        return { chProf, chTotal };
    }

    Object.entries(snapshot?.eventsByDate || {})
        .sort(([dateA], [dateB]) => String(dateA).localeCompare(String(dateB)))
        .forEach(([dateStr, events]) => {
            const dow = new Date(`${dateStr}T12:00:00`).getDay();
            if (dow !== dayId) return;

            (Array.isArray(events) ? events : []).forEach((alloc) => {
                if (!alloc?.id || alloc?.type === 'holiday') return;

                const turnos = resolveGanttTurnosForSlots([alloc.horario], ganttTurnoConfigs);
                const safeTurnos = turnos.length > 0 ? turnos : (visibleTurnos[0] ? [visibleTurnos[0]] : []);
                const { chProf, chTotal } = getProfessorCarga(alloc);
                const offerGroup = offerProjection?.offerGroupsByAllocationId?.get(alloc.id) || null;
                const docentesList = mergeDocentesList(
                    extractDocentesList(alloc, chTotal),
                    offerGroup?.docentes || []
                );
                const canonicalStart = String(offerGroup?.start || dateStr).trim();
                const canonicalEnd = String(offerGroup?.end || canonicalStart || dateStr).trim();

                safeTurnos.forEach((turnoConfig) => {
                    const itemKey = [
                        offerGroup?.offerKey || '',
                        turnoConfig.value,
                        String(dayId || ''),
                        canonicalStart,
                        canonicalEnd
                    ].join('|');
                    const nextTimeRanges = [alloc.horario];
                    const nextRegimeLabel = Array.isArray(offerGroup?.faixas) && offerGroup.faixas.length > 1
                        ? 'Por faixas'
                        : 'Oferta';

                    if (!dayItemsMap[itemKey]) {
                        dayItemsMap[itemKey] = {
                            ...alloc,
                            turno: turnoConfig.value,
                            chTotal,
                            chProf,
                            docentes: docentesList,
                            docenteLabel: offerGroup?.docenteLabel || alloc.docente || '',
                            docenteSegments: Array.isArray(offerGroup?.teacherSegments) ? offerGroup.teacherSegments : [],
                            offerKey: offerGroup?.offerKey || '',
                            dataInicio: canonicalStart,
                            dataFim: canonicalEnd,
                            slotCount: 1,
                            timeRanges: mergeTimeRanges([], nextTimeRanges),
                            regimeLabel: nextRegimeLabel
                        };
                        return;
                    }

                    dayItemsMap[itemKey].dataInicio = dateStr < dayItemsMap[itemKey].dataInicio
                        ? dateStr
                        : dayItemsMap[itemKey].dataInicio;
                    dayItemsMap[itemKey].dataFim = dateStr > dayItemsMap[itemKey].dataFim
                        ? dateStr
                        : dayItemsMap[itemKey].dataFim;
                    dayItemsMap[itemKey].docentes = mergeDocentesList(dayItemsMap[itemKey].docentes, docentesList);
                    dayItemsMap[itemKey].timeRanges = mergeTimeRanges(dayItemsMap[itemKey].timeRanges, nextTimeRanges);
                    dayItemsMap[itemKey].slotCount = dayItemsMap[itemKey].timeRanges.length;
                });
            });
        });

    return Object.values(dayItemsMap).sort((a, b) => {
        const startCmp = String(a.dataInicio || '').localeCompare(String(b.dataInicio || ''));
        if (startCmp !== 0) return startCmp;
        const endCmp = String(a.dataFim || '').localeCompare(String(b.dataFim || ''));
        if (endCmp !== 0) return endCmp;
        return String(a.disciplina || '').localeCompare(String(b.disciplina || ''));
    });
}

export function renderTeacherGanttInto(container, docenteName) {
    try {
        if (!container) return;

        const teacherName = String(docenteName || '').trim();
        if (!teacherName) {
            container.innerHTML = '<div style="text-align: center; color: #7f8c8d; margin-top: 50px; font-size: 1.1em;">Por favor, digite o nome de um professor.</div>';
            return;
        }

        const allocs = filterExportableAllocations(
            store.allocations.filter((alloc) => allocationHasTeacherMatch(alloc, teacherName))
        );
        if (allocs.length === 0) {
            container.innerHTML = `<div style="text-align: center; color: #7f8c8d; margin-top: 50px; font-size: 1.1em;">Nenhuma disciplina encontrada para <b>${teacherName}</b>.</div>`;
            return;
        }

        const totalCH = calculateTeacherTotalCH(teacherName);
        const fallbackStart = String(calStart?.value || store.settings.termStart || '2025-01-01').trim();
        const fallbackEnd = String(calEnd?.value || store.settings.termEnd || fallbackStart || '2025-12-31').trim();
        const ganttTurnoConfigs = getGanttTurnoConfigs();
        const offerProjection = buildCanonicalOfferProjection({
            allocations: allocs,
            startDate: fallbackStart,
            endDate: fallbackEnd
        });
        const teacherSnapshot = buildTeacherExecutionSnapshot({
            docenteName: teacherName,
            startDate: fallbackStart,
            endDate: fallbackEnd,
            resolveShift: (slot) => resolveTeacherShiftForSlot(slot),
            preferredShiftOrder: ganttTurnoConfigs.map((config) => config.value)
        });
        renderTeacherClassicGantt(container, {
            docenteName: teacherName,
            totalCH,
            offerProjection,
            teacherSnapshot,
            startDate: fallbackStart,
            endDate: fallbackEnd,
            ganttTurnoConfigs
        });
    } catch (err) {
        console.error('Erro renderGanttChart:', err);
        if (container) container.innerHTML = `<div style="color:red; margin-top:20px;"><b>Erro Inesperado no Grafico:</b><br>${err.message}</div>`;
    }
}

export function renderGanttChart() {
    const container = document.getElementById('gantt-container-docente');
    const inputDocente = document.getElementById('sel-view-docente');
    if (!container || !inputDocente) return;
    renderTeacherGanttInto(container, inputDocente.value);
}

export function renderTurmaGanttInto(container) {
    try {
        if (!container) return;

        const turmaId = store.selectedTurma;
        if (!turmaId) {
            container.innerHTML = '<div style="text-align: center; color: #7f8c8d; margin-top: 50px; font-size: 1.1em;">Selecione uma turma na barra lateral para visualizar o Gantt da turma.</div>';
            return;
        }

        let turmaLabel = String(turmaId);
        const turmaInfo = (store.rawData?.turmas || []).find((entry) => String(entry?.turma_id) === String(turmaId));
        if (turmaInfo?.turma_label) turmaLabel = turmaInfo.turma_label;

        const fallbackStart = String(calStart?.value || store.settings.termStart || '2025-01-01').trim();
        const fallbackEnd = String(calEnd?.value || store.settings.termEnd || fallbackStart || '2025-12-31').trim();
        const allocs = filterExportableAllocations(
            store.allocations.filter((alloc) => String(alloc?.turmaId) === String(turmaId))
        );
        const offerProjection = buildCanonicalOfferProjection({
            allocations: allocs,
            startDate: fallbackStart,
            endDate: fallbackEnd
        });
        renderBidimensionalTurmaGantt(container, {
            turmaId,
            turmaLabel,
            offerProjection,
            startDate: fallbackStart,
            endDate: fallbackEnd
        });
    } catch (err) {
        console.error('Erro renderTurmaGanttInto:', err);
        if (container) container.innerHTML = `<div style="color:red; margin-top:20px;"><b>Erro Inesperado no Grafico:</b><br>${err.message}</div>`;
    }
}

export function renderTurmaGantt() {
    const container = document.getElementById('gantt-container-turma');
    if (!container) return;
    renderTurmaGanttInto(container);
}

export function printGanttLandscape(mode = 'turma') {
    const isDocente = mode === 'docente';
    const containerId = isDocente ? 'gantt-container-docente' : 'gantt-container-turma';
    const container = document.getElementById(containerId);
    if (!container) return;
    const ganttHtml = container.innerHTML || '';
    const styleEl = document.getElementById('gantt-bidimensional-style');
    const styleText = styleEl ? styleEl.textContent : '';
    let turmaLabel = store.selectedTurma || 'GERAL';
    if (store.rawData?.turmas) {
        const t = store.rawData.turmas.find(x => String(x.turma_id) === String(store.selectedTurma));
        if (t) turmaLabel = t.turma_label;
    }
    const periodo = normalizePeriodoLetivoCode(store.settings.periodo || 'PL1');
    let printTitle;
    if (isDocente) {
        const ganttProf = document.getElementById('sel-view-docente')?.value || 'Gantt';
        printTitle = `Gantt_${ganttProf}_${periodo}_Gestor_IECOS`;
    } else {
        printTitle = `Gantt_${turmaLabel}_${periodo}_Gestor_IECOS`;
    }

    const printWindow = window.open('', '_blank', 'width=1280,height=800');
    if (!printWindow) {
        showToastWarning('Permita pop-ups para imprimir o Gantt.', 'warning', 2600);
        return;
    }
    printWindow.document.open();
    printWindow.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${printTitle}</title>
<style>
  @page { size: A4 landscape; margin: 0.4cm; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  html, body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background: #ffffff; }
  ${styleText}
  .gantt-bi__scroll { overflow: visible !important; border: none !important; box-shadow: none !important; }
  .gantt-bi__canvas { width: auto !important; min-width: 0 !important; }
  .gantt-bi__header, .gantt-bi__label { position: static !important; }
  #gp-outer { overflow: hidden; }
  #gp-inner { transform-origin: top left; display: inline-block; }
</style>
</head>
<body><div id="gp-outer"><div id="gp-inner">${ganttHtml}</div></div>
<script>
(function () {
  function fitAndPrint() {
    var inner = document.getElementById('gp-inner');
    var outer = document.getElementById('gp-outer');
    if (!inner || !outer) { window.print(); return; }
    // A4 paisagem a 96dpi (297x210mm) menos margem @page de 0.4cm em cada lado.
    var MARGIN = 0.4 * 37.795275591; // 0.4cm -> px
    var availW = (297 * 3.779527559) - (2 * MARGIN);
    var availH = (210 * 3.779527559) - (2 * MARGIN);
    var contentW = inner.scrollWidth;
    var contentH = inner.scrollHeight;
    var scale = Math.min(availW / contentW, availH / contentH, 1);
    if (!isFinite(scale) || scale <= 0) scale = 1;
    inner.style.transform = 'scale(' + scale + ')';
    outer.style.width = Math.ceil(contentW * scale) + 'px';
    outer.style.height = Math.ceil(contentH * scale) + 'px';
    setTimeout(function () { try { window.print(); } catch (e) {} }, 120);
  }
  if (document.readyState === 'complete') fitAndPrint();
  else window.addEventListener('load', fitAndPrint);
})();
<\/script>
</body>
</html>`);
    printWindow.document.close();
    printWindow.focus();
}

export function renderPublicTeacherGantt(target, docenteName) {
    const container = typeof target === 'string' ? document.getElementById(target) : target;
    renderTeacherGanttInto(container, docenteName);
}

