import { store } from './store.js??v=20261028a';
import { buildTeacherExecutionSnapshot, buildCanonicalOfferProjection } from './execution_engine.js';
import { filterExportableAllocations } from './academic_rules.mjs';
import { normalizeHexColor, hexToRgba } from './color_utils.js';
import { formatDateBR, timeToMinutes } from './date_utils_ui.js';
import {
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

