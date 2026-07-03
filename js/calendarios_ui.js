import { store } from './store.js??v=20260625v';
import { getCalendarEvents } from './calendar.js??v=20260625v';
import { buildTeacherExecutionSnapshot, buildCanonicalOfferProjection } from './execution_engine.js';
import { getHorariosByTurno, normalizeTurnoKey, getTurnoLetter, mapSlotToTurno } from './turns.js';
import { vividHexColor } from './color_utils.js';
import { formatDateBR, timeToMinutes, shortDayName } from './date_utils_ui.js';
import {
    isFaixaAllocation,
    isScheduledRegularAllocation,
    allocationHasTeacherMatch,
    teacherNamesMatch,
    getDocenteShortLabel,
    calculateTeacherTotalCH
} from './allocation_helpers.js';
import {
    normalizeTurnoOfertaKey,
    formatTurnoOfertaLabel,
    cleanHorarioLabel,
    formatIntervaloLabel,
    isTurnoDividerSlot,
    buildHorariosForUI,
    getShiftChangeMeta,
    getCalendarShiftBadgeHTML
} from './turno_helpers.js';
import {
    getDisciplinaCHGlobal,
    getTurmaLabel,
    getTurmaBaseLabel,
    getDisciplinaInfo,
    getPrintAcademicMetaLine
} from './curso_turma_helpers.js';
import {
    getGanttTurnoConfigs,
    resolveTeacherShiftForSlot
} from './gantt_ui.js';

// Referencias DOM de nivel de modulo (espelham as de ui.js; modulo deferred, DOM pronto).
const selViewDocente = document.getElementById('sel-view-docente');
const calStart = document.getElementById('cal-start');
const calEnd = document.getElementById('cal-end');

export function renderMonthlyCalendar() {
    const container = document.getElementById('monthly-container');
    if (!container) return;
    if (!store.selectedTurma) return (container.innerHTML = '<p>Selecione uma turma.</p>');

    const start = calStart ? calStart.value : '2025-01-01';
    let end = calEnd ? calEnd.value : '2025-12-31';

    if (end) {
        const dt = new Date(end + 'T12:00:00');
        const lastDay = new Date(dt.getFullYear(), dt.getMonth() + 1, 0);
        end = lastDay.toISOString().split('T')[0];
    }

    const turmaLabel = getTurmaBaseLabel(store.selectedTurma);
    const metaLine = getPrintAcademicMetaLine(store.selectedTurma);
    const title = `<span class="print-title-line">CALEND\u00c1RIO ACAD\u00caMICO (${metaLine})</span>`;
    generateCalendarGrid(container, store.selectedTurma, null, start, end, title);
}

export function getTeacherCalendarTurnoConfigs() {
    return getGanttTurnoConfigs().map((config) => ({
        value: config.value,
        label: config.label,
        normalized: config.normalized
    }));
}


export function collectSlotsForTurnoValues(turnoValues = []) {
    const normalizedWanted = [...new Set((Array.isArray(turnoValues) ? turnoValues : [])
        .map((value) => normalizeTurnoOfertaKey(value))
        .filter(Boolean))];
    if (normalizedWanted.length === 0) return [];

    const hp = store.getActiveHorariosPorTurno();
    const slots = [];

    normalizedWanted.forEach((wantedTurno) => {
        const matchedKey = Object.keys(hp).find((turno) => normalizeTurnoOfertaKey(turno) === wantedTurno);
        if (!matchedKey || !Array.isArray(hp[matchedKey])) return;
        hp[matchedKey].forEach((slot) => slots.push(slot));
    });

    return [...new Set(slots)]
        .map((slot) => {
            const raw = String(slot ?? '');
            if (raw.toUpperCase().includes('INTERVALO')) return formatIntervaloLabel(raw);
            return cleanHorarioLabel(raw);
        })
        .filter((slot) => slot && slot.trim().length > 0)
        .sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
}

export function getSlotsForTeacherShifts(activeShiftKeys = []) {
    // Usa as chaves normalizadas (manha/tarde/noite) com getHorariosByTurno, que
    // resolve o turno pela normalizeTurnoKey (turns.js) e injeta o esqueleto
    // completo do turno. Isso é robusto para aulas deslocadas ao sábado de manhã,
    // ao contrário de resolver pelo valor bruto do turno (ex.: "Manhã+Noite"),
    // que não casa com nenhuma chave de horarios_por_turno.
    const hp = store.getActiveHorariosPorTurno();
    const slotMap = new Map();

    [...new Set((Array.isArray(activeShiftKeys) ? activeShiftKeys : []).filter(Boolean))]
        .forEach((shiftKey) => {
            const slots = getHorariosByTurno(shiftKey, hp);
            if (!Array.isArray(slots)) return;
            slots.forEach((slot) => {
                const raw = String(slot ?? '');
                const label = raw.toUpperCase().includes('INTERVALO')
                    ? formatIntervaloLabel(raw)
                    : cleanHorarioLabel(raw);
                if (label && label.trim() && !slotMap.has(label)) slotMap.set(label, label);
            });
        });

    return [...slotMap.values()]
        .filter((slot) => slot && slot.trim().length > 0)
        .sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
}

export function buildTurmaCalendarSlots(eventsByDate = {}, turmaId = '') {
    const nativeSlots = buildHorariosForUI();
    const slotMap = new Map();

    // Normaliza preservando o rotulo de intervalo (senao cleanHorarioLabel removeria
    // a palavra "INTERVALO" e o calendario nao reconheceria a linha como intervalo).
    const normSlotLabel = (s) => {
        const str = String(s || '').trim();
        if (str.toUpperCase().includes('INTERVALO')) return formatIntervaloLabel(str);
        return cleanHorarioLabel(str);
    };

    nativeSlots.forEach((slot) => {
        const key = normSlotLabel(slot);
        if (!key) return;
        slotMap.set(key, key);
    });

    const activeShifts = new Set();
    const letterToShiftKey = { M: 'manha', T: 'tarde', N: 'noite' };

    Object.values(eventsByDate || {}).forEach((events) => {
        (Array.isArray(events) ? events : []).forEach((event) => {
            if (!event || event.type === 'holiday') return;
            if (turmaId && String(event?.turmaId || '') !== String(turmaId)) return;

            const tKey = event.turno || store.rawData?.turmas?.find(t => String(t.turma_id) === String(event.turmaId))?.turno;
            // Usamos a normalização do turns.js que é a fonte definitiva
            if (tKey) activeShifts.add(normalizeTurnoKey(tKey));

            // Aula deslocada para o sábado de manhã ativa o turno da manhã.
            if (event.sabadoManha) activeShifts.add('manha');

            // Reúne todos os horários usados pelo evento e detecta o turno real de
            // cada slot pelo horário, garantindo a injeção do esqueleto completo
            // do turno (inclusive os slots vagos) quando houver mudança de turno.
            const eventSlots = [
                event.horario,
                ...(Array.isArray(event.horariosOcupados) ? event.horariosOcupados : []),
                ...(Array.isArray(event.horariosUltimoDia) ? event.horariosUltimoDia : [])
            ];
            eventSlots.forEach((rawSlot) => {
                const normalizedSlot = normSlotLabel(rawSlot);
                if (!normalizedSlot) return;
                if (!slotMap.has(normalizedSlot)) slotMap.set(normalizedSlot, normalizedSlot);
                const shiftKey = letterToShiftKey[getTurnoLetter(normalizedSlot)];
                if (shiftKey) activeShifts.add(shiftKey);
            });
        });
    });

    // Injeção de turnos completos se houver ao menos um evento neles
    const hp = store.getActiveHorariosPorTurno();
    activeShifts.forEach(shiftKey => {
        const fullShifter = getHorariosByTurno(shiftKey, hp);
        if (Array.isArray(fullShifter)) {
            fullShifter.forEach(s => {
                const ks = normSlotLabel(s);
                if (ks && !slotMap.has(ks)) {
                    slotMap.set(ks, ks);
                }
            });
        }
    });

    return [...slotMap.values()]
        .filter((slot) => String(slot || '').trim().length > 0)
        .sort((left, right) => timeToMinutes(left) - timeToMinutes(right));
}

export function formatConflictDateRange(startDate, endDate) {
    if (!startDate) return '-';
    if (!endDate || endDate === startDate) return formatDateBR(startDate);
    return `${formatDateBR(startDate)} a ${formatDateBR(endDate)}`;
}

export function renderTeacherConflictRows(conflicts = []) {
    if (!Array.isArray(conflicts) || conflicts.length === 0) {
        return `
            <div style="background:#ecfdf3; border:1px solid #b7ebc6; color:#1e7e34; border-radius:8px; padding:12px 14px; margin-bottom:18px; font-weight:700;">
                Nenhum conflito horario identificado para o docente no intervalo exibido.
            </div>
        `;
    }

    const rows = conflicts.map((conflict) => {
        const imported = !!conflict.importado;
        const rowStyle = imported ? ' style="background:#fff4d6;"' : '';
        const badge = imported
            ? ' <span style="display:inline-block; background:#e0a200; color:#3a2a00; font-weight:700; font-size:0.72rem; padding:1px 8px; border-radius:10px; margin-left:6px; vertical-align:middle;">IMPORTADO</span>'
            : '';
        return `
        <tr${rowStyle}>
            <td style="padding:8px 10px; border-bottom:1px solid #dfe6e9;">${formatConflictDateRange(conflict.startDate, conflict.endDate)}</td>
            <td style="padding:8px 10px; border-bottom:1px solid #dfe6e9;">${conflict.shift || '-'}</td>
            <td style="padding:8px 10px; border-bottom:1px solid #dfe6e9;">${conflict.turmas.join(', ') || '-'}</td>
            <td style="padding:8px 10px; border-bottom:1px solid #dfe6e9;">${conflict.componentes.join(', ') || '-'}</td>
            <td style="padding:8px 10px; border-bottom:1px solid #dfe6e9;">${conflict.description}${badge}</td>
        </tr>
    `;
    }).join('');

    const hasImported = conflicts.some((conflict) => conflict.importado);
    const importedLegend = hasImported
        ? `<div style="margin:0 0 10px 0; font-size:0.86rem; color:#7a5b00; background:#fff4d6; border:1px solid #f0d486; border-radius:6px; padding:8px 12px;">
                <strong>IMPORTADO</strong>: sobreposicao permitida porque a disciplina foi carregada via importacao.
           </div>`
        : '';

    return `
        <div style="margin-bottom:18px;">
            <h4 style="margin:0 0 10px 0; color:var(--primary); text-transform:uppercase; letter-spacing:0.6px;">Tabela de Conflitos</h4>
            ${importedLegend}
            <div style="overflow:auto; border:1px solid #dfe6e9; border-radius:8px; background:#fff;">
                <table style="width:100%; border-collapse:collapse; min-width:760px;">
                    <thead>
                        <tr style="background:#f4f6f8; color:#2c3e50; text-align:left;">
                            <th style="padding:10px; border-bottom:1px solid #dfe6e9;">Intervalo</th>
                            <th style="padding:10px; border-bottom:1px solid #dfe6e9;">Turno</th>
                            <th style="padding:10px; border-bottom:1px solid #dfe6e9;">Turma(s)</th>
                            <th style="padding:10px; border-bottom:1px solid #dfe6e9;">Componente(s)</th>
                            <th style="padding:10px; border-bottom:1px solid #dfe6e9;">Descricao</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>
    `;
}

export function renderTeacherCalendar() {
    const container = document.getElementById('teacher-calendar-container');
    if (!container || !selViewDocente) return;

    const docente = selViewDocente.value;
    if (!docente) return (container.innerHTML = '<p>Selecione um professor.</p>');

    const start = calStart ? calStart.value : '2025-01-01';
    let end = calEnd ? calEnd.value : '2025-12-31';

    if (end) {
        const dt = new Date(end + 'T12:00:00');
        const lastDay = new Date(dt.getFullYear(), dt.getMonth() + 1, 0);
        end = lastDay.toISOString().split('T')[0];
    }

    const turnoConfigs = getTeacherCalendarTurnoConfigs();
    const teacherSnapshot = buildTeacherExecutionSnapshot({
        docenteName: docente,
        startDate: start,
        endDate: end,
        resolveShift: (slot) => resolveTeacherShiftForSlot(slot),
        preferredShiftOrder: turnoConfigs.map((config) => config.value),
        formatTurmaLabel: (event) => getTurmaLabel(event?.turmaId, event?.subGrupo)
    });
    const eventsByDate = teacherSnapshot.eventsByDate;
    const activeShiftData = teacherSnapshot.activeShiftData;
    const activeShiftKeys = activeShiftData.map((shift) => shift.normalized).filter(Boolean);
    const conflictRows = teacherSnapshot.conflictRows;
    const visibleSlots = getSlotsForTeacherShifts(activeShiftKeys);
    const totalCH = calculateTeacherTotalCH(docente);
    const docenteTitle = totalCH > 0 ? `${docente} (${totalCH}h)` : docente;
    const shiftSummary = activeShiftData.length > 0
        ? activeShiftData.map((shift) => formatTurnoOfertaLabel(shift.normalized)).join(', ')
        : 'Sem turnos ativos no intervalo';

    container.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:16px;">
            <div class="print-only print-header-container">
                <span class="print-title-main">Vistoria de Conflitos Horarios</span><br>
                <span class="print-title-sub">${docenteTitle}</span>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center;">
                <div style="background:#eef6f0; color:#1f5d3a; border:1px solid #cfe8d7; border-radius:999px; padding:8px 14px; font-weight:700;">Turnos ativos: ${shiftSummary}</div>
                <div style="background:#f4f6f8; color:#2c3e50; border:1px solid #dfe6e9; border-radius:999px; padding:8px 14px; font-weight:700;">Conflitos detectados: ${conflictRows.length}</div>
            </div>
            ${renderTeacherConflictRows(conflictRows)}
            <div id="teacher-calendar-inspection-grid"></div>
        </div>
    `;

    const calendarContainer = document.getElementById('teacher-calendar-inspection-grid');
    const title = `<span class="print-title-main">Vistoria de Conflitos Horarios</span><br><span class="print-title-sub">${docenteTitle}</span>`;
    generateCalendarGrid(calendarContainer, null, docente, start, end, title, {
        slotsToRenderOverride: visibleSlots
    });
}

export function buildCalendarTurmaResumeTable(turmaId, start, end) {
    if (!turmaId) return null;

    const allocations = store.allocations.filter((a) => (
        String(a.turmaId) === String(turmaId)
        && (isScheduledRegularAllocation(a) || isFaixaAllocation(a))
    ));
    if (allocations.length === 0) return null;

    function toCH(value) {
        const num = Number.parseFloat(value);
        return Number.isFinite(num) && num > 0 ? num : 0;
    }

    function formatCH(value) {
        const num = Number.parseFloat(value);
        if (!Number.isFinite(num) || num <= 0) return '';
        return Number.isInteger(num)
            ? String(num)
            : num.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
    }

    function formatPeriodo(dataInicio, dataFim) {
        if (!dataInicio || !dataFim) return '-';
        return `${formatDateBR(dataInicio)} a ${formatDateBR(dataFim)}`;
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function extractDocentes(alloc, fallbackCH = 0) {
        if (Array.isArray(alloc?.docentes) && alloc.docentes.length > 0) {
            return alloc.docentes
                .map((docente) => ({
                    nome: String(docente?.nome || '').trim(),
                    ch: toCH(docente?.ch)
                }))
                .filter((docente) => docente.nome);
        }

        const nome = String(alloc?.docente || '').trim();
        if (!nome) return [];
        return [{
            nome,
            ch: toCH(alloc?.ch) || toCH(fallbackCH)
        }];
    }

    function buildRowsFromOfferGroup(group) {
        const declaredDocentes = Array.isArray(group?.docentes) ? group.docentes : [];
        const fallbackStart = String(group?.start || start || '').trim();
        const fallbackEnd = String(group?.end || end || fallbackStart || '').trim();
        const segments = Array.isArray(group?.teacherSegments) ? group.teacherSegments : [];

        if (segments.length > 0) {
            return segments
                .slice()
                .sort((left, right) => {
                    const startDiff = String(left?.start || '').localeCompare(String(right?.start || ''));
                    if (startDiff !== 0) return startDiff;
                    return String(left?.nome || '').localeCompare(String(right?.nome || ''), 'pt-BR', { sensitivity: 'base' });
                })
                .map((segment) => {
                    const nome = String(segment?.nome || '').trim();
                    const declared = declaredDocentes.find((docente) => teacherNamesMatch(docente?.nome, nome));
                    return {
                        nome: nome || '-',
                        ch: toCH(segment?.ch) || toCH(declared?.ch),
                        dataInicio: String(segment?.start || fallbackStart || '').trim(),
                        dataFim: String(segment?.end || fallbackEnd || '').trim()
                    };
                });
        }

        if (declaredDocentes.length > 0) {
            return declaredDocentes.map((docente) => ({
                nome: String(docente?.nome || '').trim() || '-',
                ch: toCH(docente?.ch),
                dataInicio: fallbackStart,
                dataFim: fallbackEnd
            }));
        }

        const fallbackDocente = String(group?.baseAlloc?.docente || group?.docenteLabel || '').trim();
        return [{
            nome: fallbackDocente || '-',
            ch: 0,
            dataInicio: fallbackStart,
            dataFim: fallbackEnd
        }];
    }

    const offerProjection = buildCanonicalOfferProjection({
        allocations,
        startDate: start,
        endDate: end
    });

    const disciplinasMap = new Map();
    (offerProjection?.offerGroups || []).forEach((offerGroup) => {
        const baseAlloc = offerGroup?.baseAlloc || {};
        const disciplina = String(offerGroup?.disciplina || baseAlloc?.disciplina || '').trim();
        if (!disciplina) return;

        if (!disciplinasMap.has(disciplina)) {
            const info = getDisciplinaInfo(disciplina);
            const totalCH = toCH(getDisciplinaCHGlobal(disciplina, turmaId)) || toCH(info?.ch) || toCH(baseAlloc?.ch);
            disciplinasMap.set(disciplina, {
                disciplina,
                codigo: String(info?.codigo || baseAlloc?.componenteCode || '').trim(),
                cor: baseAlloc?.cor || store.getDisciplinaColor(disciplina) || '#f39c12',
                totalCH,
                allocatedCH: null,
                rows: []
            });
        }

        const disciplinaEntry = disciplinasMap.get(disciplina);
        disciplinaEntry.allocatedCH = (disciplinaEntry.allocatedCH || 0) + toCH(offerGroup?.executedHours);
        const rows = buildRowsFromOfferGroup(offerGroup);
        rows.forEach((row) => disciplinaEntry.rows.push(row));
    });

    if (disciplinasMap.size === 0) {
        allocations.forEach((alloc) => {
            const disciplina = String(alloc?.disciplina || '').trim();
            if (!disciplina) return;

            if (!disciplinasMap.has(disciplina)) {
                const info = getDisciplinaInfo(disciplina);
                const totalCH = toCH(getDisciplinaCHGlobal(disciplina, turmaId)) || toCH(info?.ch);
                disciplinasMap.set(disciplina, {
                    disciplina,
                    codigo: String(info?.codigo || alloc?.componenteCode || '').trim(),
                    cor: alloc?.cor || store.getDisciplinaColor(disciplina) || '#f39c12',
                    totalCH,
                    allocatedCH: null,
                    rows: []
                });
            }

            const disciplinaEntry = disciplinasMap.get(disciplina);
            const dataInicio = String(alloc?.dataInicio || start || '').trim();
            const dataFim = String(alloc?.dataFim || end || '').trim();
            const docentes = extractDocentes(alloc, disciplinaEntry.totalCH);

            if (docentes.length === 0) {
                disciplinaEntry.rows.push({ nome: '-', ch: 0, dataInicio, dataFim });
                return;
            }

            docentes.forEach((docente) => {
                disciplinaEntry.rows.push({
                    nome: docente.nome,
                    ch: toCH(docente.ch),
                    dataInicio,
                    dataFim
                });
            });
        });
    }

    const disciplinas = [...disciplinasMap.values()].map((disciplina) => {
        const merged = new Map();

        disciplina.rows.forEach((row) => {
            const rowKey = `${row.nome}|${row.dataInicio}|${row.dataFim}`;
            if (!merged.has(rowKey)) {
                merged.set(rowKey, { ...row });
                return;
            }
            const current = merged.get(rowKey);
            merged.set(rowKey, {
                ...current,
                ch: Math.max(toCH(current?.ch), toCH(row?.ch))
            });
        });

        const rows = [...merged.values()]
            .sort((a, b) => {
                const startCmp = String(a.dataInicio || '').localeCompare(String(b.dataInicio || ''));
                if (startCmp !== 0) return startCmp;
                return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', { sensitivity: 'base' });
            })
            .map((row, rowIndex, arr) => {
                const fallbackCH = (arr.length === 1 && toCH(row.ch) <= 0)
                    ? toCH(disciplina.totalCH)
                    : toCH(row.ch);
                return {
                    ...row,
                    ch: fallbackCH
                };
            });

        const totalFromRows = rows.reduce((sum, row) => sum + toCH(row.ch), 0);
        // CH alocada = horas efetivamente executadas (projecao canonica). No
        // caminho de fallback (sem projecao) usa a soma das linhas para nao
        // sinalizar divergencia falsa.
        const allocatedCH = (disciplina.allocatedCH === null || disciplina.allocatedCH === undefined)
            ? totalFromRows
            : toCH(disciplina.allocatedCH);
        return {
            ...disciplina,
            rows,
            allocatedCH,
            totalCH: toCH(disciplina.totalCH) > 0 ? toCH(disciplina.totalCH) : totalFromRows
        };
    });

    // Ordena as disciplinas pela ordem cronologica de oferta (data de inicio mais
    // antiga) e renumera (#1, #2, ...), em vez de ordem alfabetica/insercao.
    disciplinas.sort((a, b) => {
        const aStart = String(a.rows?.[0]?.dataInicio || '').trim();
        const bStart = String(b.rows?.[0]?.dataInicio || '').trim();
        const startCmp = aStart.localeCompare(bStart);
        if (startCmp !== 0) return startCmp;
        return String(a.disciplina || '').localeCompare(String(b.disciplina || ''), 'pt-BR', { sensitivity: 'base' });
    });
    disciplinas.forEach((disc, idx) => { disc.numero = idx + 1; });

    const totalGeralCH = disciplinas.reduce((sum, disc) => sum + toCH(disc.totalCH), 0);
    const totalGeralAlocada = disciplinas.reduce((sum, disc) => sum + toCH(disc.allocatedCH), 0);
    const totalAlocadaMismatch = Math.abs(totalGeralAlocada - totalGeralCH) > 0.01;

    let tableHtml = `
        <table class="calendar-turma-resume-table" style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px;">
            <thead>
                <tr style="background: #f5f5f5; border-bottom: 2px solid #333;">
                    <th style="padding: 8px 8px 16px 8px; text-align: left; border-right: 1px solid #ddd; width: 5%;">#</th>
                    <th style="padding: 8px 8px 16px 8px; text-align: left; border-right: 2px solid #2d34c6; width: 12%;">Código</th>
                    <th style="padding: 8px 8px 16px 8px; text-align: center; border-right: 1px solid #ddd; width: 8%; color: #2d34c6;">CH</th>
                    <th style="padding: 8px 8px 16px 8px; text-align: center; border-right: 2px solid #2d34c6; width: 9%; color: #2d34c6;">CH alocada</th>
                    <th style="padding: 8px 8px 16px 8px; text-align: left; border-right: 1px solid #ddd; width: 28%;">Disciplina</th>
                    <th style="padding: 8px 8px 16px 8px; text-align: left; border-right: 1px solid #ddd; width: 18%;">Docente</th>
                    <th style="padding: 8px 8px 16px 8px; text-align: left; width: 20%;">Período</th>
                </tr>
            </thead>
            <tbody>
    `;

    disciplinas.forEach((disc) => {
        const safeRows = disc.rows.length > 0 ? disc.rows : [{ nome: '-', ch: 0, dataInicio: '', dataFim: '' }];
        const allocatedMismatch = Math.abs(toCH(disc.allocatedCH) - toCH(disc.totalCH)) > 0.01;
        const allocatedCellStyle = allocatedMismatch
            ? 'color: #c0392b; font-weight: 800;'
            : 'color: #1f2937; font-weight: 700;';
        const allocatedDisplay = formatCH(disc.allocatedCH);

        safeRows.forEach((row, idx) => {
            const isFirst = idx === 0;
            tableHtml += `
                <tr style="border-bottom: 1px solid #ddd; background-color: ${disc.cor}22;">
                    <td style="padding: 8px; border-right: 1px solid #ddd; font-weight: bold;">${isFirst ? disc.numero : ''}</td>
                    <td style="padding: 8px; border-right: 2px solid #2d34c6;">${isFirst ? escapeHtml(disc.codigo || '-') : ''}</td>
                    <td style="padding: 8px; text-align: center; border-right: 1px solid #ddd; font-weight: 700; color: #1f2937;">${formatCH(row.ch)}</td>
                    <td style="padding: 8px; text-align: center; border-right: 2px solid #2d34c6; ${allocatedCellStyle}">${isFirst ? (allocatedDisplay || '0') : ''}</td>
                    <td style="padding: 8px; border-right: 1px solid #ddd; font-weight: ${isFirst ? '700' : '500'}; color: #333;">${isFirst ? escapeHtml(disc.disciplina) : ''}</td>
                    <td style="padding: 8px; border-right: 1px solid #ddd; color: #333;">${escapeHtml(row.nome || '-')}</td>
                    <td style="padding: 8px; color: #4b5563;">${escapeHtml(formatPeriodo(row.dataInicio, row.dataFim))}</td>
                </tr>
            `;
        });
    });

    tableHtml += `
                <tr style="background: #f8fafc; border-top: 2px solid #2d34c6; border-bottom: 2px solid #2d34c6;">
                    <td colspan="2" style="padding: 8px; border-right: 1px solid #ddd; text-align: right; font-weight: 800; color: #1e3a8a;">Total</td>
                    <td style="padding: 8px; text-align: center; border-right: 1px solid #ddd; font-weight: 800; color: #1e3a8a;">${formatCH(totalGeralCH)}</td>
                    <td style="padding: 8px; text-align: center; border-right: 2px solid #2d34c6; font-weight: 800; color: ${totalAlocadaMismatch ? '#c0392b' : '#1e3a8a'};">${formatCH(totalGeralAlocada) || '0'}</td>
                    <td colspan="3" style="padding: 8px;"></td>
                </tr>
            </tbody>
        </table>
    `;

    return tableHtml;
}

// Tabela resumo do Calendario Docente (espelha buildCalendarTurmaResumeTable,
// mas com o docente fixo). Lista cada componente que o professor leciona, em
// qual turma, com a CH sob sua responsabilidade, a CH efetivamente alocada
// (horas executadas do professor) e o periodo em que ele atua na componente.
export function buildCalendarDocenteResumeTable(docenteName, start, end) {
    const docente = String(docenteName || '').trim();
    if (!docente) return null;

    const allocations = store.allocations.filter((a) => (
        (isScheduledRegularAllocation(a) || isFaixaAllocation(a))
        && allocationHasTeacherMatch(a, docente)
    ));
    if (allocations.length === 0) return null;

    function toCH(value) {
        const num = Number.parseFloat(value);
        return Number.isFinite(num) && num > 0 ? num : 0;
    }

    function formatCH(value) {
        const num = Number.parseFloat(value);
        if (!Number.isFinite(num) || num <= 0) return '';
        return Number.isInteger(num)
            ? String(num)
            : num.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
    }

    function formatPeriodo(dataInicio, dataFim) {
        if (!dataInicio || !dataFim) return '-';
        return `${formatDateBR(dataInicio)} a ${formatDateBR(dataFim)}`;
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    const offerProjection = buildCanonicalOfferProjection({
        allocations,
        startDate: start,
        endDate: end
    });

    const components = [];
    (offerProjection?.offerGroups || []).forEach((offerGroup) => {
        const baseAlloc = offerGroup?.baseAlloc || {};
        const disciplina = String(offerGroup?.disciplina || baseAlloc?.disciplina || '').trim();
        if (!disciplina) return;

        const segments = Array.isArray(offerGroup?.teacherSegments) ? offerGroup.teacherSegments : [];
        const segment = segments.find((seg) => teacherNamesMatch(seg?.nome, docente));

        // Confirma que este professor realmente atua na oferta. Sem segmento
        // (nenhuma aula observada) pula para nao listar oferta de outro docente.
        if (segments.length > 0 && !segment) return;

        const declaredDocente = (Array.isArray(offerGroup?.docentes) ? offerGroup.docentes : [])
            .find((d) => teacherNamesMatch(d?.nome, docente));

        const info = getDisciplinaInfo(disciplina);
        const turmaId = String(offerGroup?.turmaId || baseAlloc?.turmaId || '').trim();

        // CH curricular total da componente (coluna "CH").
        const curricularCH = toCH(getDisciplinaCHGlobal(disciplina, turmaId))
            || toCH(info?.ch) || toCH(baseAlloc?.ch);

        // Parcela da CH atribuida a ESTE docente (coluna "CH alocada"). Quando o
        // docente e o unico responsavel, assume a CH curricular inteira.
        const allocatedDocenteCH = toCH(segment?.ch) || toCH(declaredDocente?.ch)
            || (Array.isArray(offerGroup?.docentes) && offerGroup.docentes.length <= 1
                ? curricularCH
                : 0);

        // Uma linha por faixa em que o docente ministra aula. Como as alocacoes
        // ja foram filtradas para este docente, as faixas e as horas executadas
        // refletem apenas a atuacao dele na componente.
        const faixaRows = [];
        (Array.isArray(offerGroup?.faixas) ? offerGroup.faixas : [])
            .filter((faixa) => toCH(faixa?.executedHours) > 0
                || (Array.isArray(faixa?.activeDates) && faixa.activeDates.length > 0))
            .forEach((faixa) => {
                const diaNums = [...new Set(
                    (Array.isArray(faixa?.dias) ? faixa.dias : [])
                        .map((d) => Number.parseInt(d, 10))
                        .filter((n) => Number.isFinite(n) && n >= 1)
                )].sort((a, b) => a - b);
                faixaRows.push({
                    allocatedCH: toCH(faixa?.executedHours),
                    diasLabel: diaNums.map((n) => shortDayName(n)).join(', '),
                    dataInicio: String(faixa?.inicio || '').trim(),
                    dataFim: String(faixa?.fim || faixa?.inicio || '').trim()
                });
            });

        // Fallback (sem faixas canonicas executadas): usa o segmento do docente e
        // os dias derivados da grade horaria da oferta.
        if (faixaRows.length === 0) {
            const diaNums = [...new Set(
                (Array.isArray(offerGroup?.scheduleEntries) ? offerGroup.scheduleEntries : [])
                    .map((entry) => Number.parseInt(entry?.diaSemana, 10))
                    .filter((n) => Number.isFinite(n) && n >= 1)
            )].sort((a, b) => a - b);
            faixaRows.push({
                allocatedCH: toCH(segment?.hours),
                diasLabel: diaNums.map((n) => shortDayName(n)).join(', '),
                dataInicio: String(segment?.start || offerGroup?.start || start || '').trim(),
                dataFim: String(segment?.end || offerGroup?.end || end || '').trim()
            });
        }

        faixaRows.sort((a, b) => String(a.dataInicio || '').localeCompare(String(b.dataInicio || '')));

        components.push({
            disciplina,
            codigo: String(info?.codigo || baseAlloc?.componenteCode || '').trim(),
            cor: baseAlloc?.cor || store.getDisciplinaColor(disciplina) || '#f39c12',
            turmaLabel: getTurmaLabel(turmaId, offerGroup?.subGrupo || baseAlloc?.subGrupo),
            curricularCH,
            allocatedDocenteCH,
            faixaRows,
            sortStart: faixaRows[0]?.dataInicio || String(offerGroup?.start || start || '').trim()
        });
    });

    if (components.length === 0) return null;

    components.sort((a, b) => {
        const startCmp = String(a.sortStart || '').localeCompare(String(b.sortStart || ''));
        if (startCmp !== 0) return startCmp;
        return String(a.disciplina || '').localeCompare(String(b.disciplina || ''), 'pt-BR', { sensitivity: 'base' });
    });
    components.forEach((comp, idx) => { comp.numero = idx + 1; });

    const totalGeralCH = components.reduce((sum, comp) => sum + toCH(comp.curricularCH), 0);
    const totalGeralAlocada = components.reduce((sum, comp) => sum + toCH(comp.allocatedDocenteCH), 0);
    const totalAlocadaMismatch = Math.abs(totalGeralAlocada - totalGeralCH) > 0.01;

    let tableHtml = `
        <table class="calendar-turma-resume-table" style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px;">
            <thead>
                <tr style="background: #f5f5f5; border-bottom: 2px solid #333;">
                    <th style="padding: 8px 8px 16px 8px; text-align: left; border-right: 1px solid #ddd; width: 5%;">#</th>
                    <th style="padding: 8px 8px 16px 8px; text-align: left; border-right: 2px solid #2d34c6; width: 12%;">Código</th>
                    <th style="padding: 8px 8px 16px 8px; text-align: center; border-right: 1px solid #ddd; width: 8%; color: #2d34c6;">CH</th>
                    <th style="padding: 8px 8px 16px 8px; text-align: center; border-right: 2px solid #2d34c6; width: 9%; color: #2d34c6;">CH alocada</th>
                    <th style="padding: 8px 8px 16px 8px; text-align: left; border-right: 1px solid #ddd; width: 24%;">Disciplina</th>
                    <th style="padding: 8px 8px 16px 8px; text-align: left; border-right: 1px solid #ddd; width: 13%;">Turma</th>
                    <th style="padding: 8px 8px 16px 8px; text-align: left; border-right: 1px solid #ddd; width: 10%;">Dia</th>
                    <th style="padding: 8px 8px 16px 8px; text-align: left; width: 19%;">Período</th>
                </tr>
            </thead>
            <tbody>
    `;

    components.forEach((comp) => {
        const allocatedMismatch = Math.abs(toCH(comp.allocatedDocenteCH) - toCH(comp.curricularCH)) > 0.01;
        const allocatedCellStyle = allocatedMismatch
            ? 'color: #c0392b; font-weight: 800;'
            : 'color: #1f2937; font-weight: 700;';

        comp.faixaRows.forEach((faixaRow, idx) => {
            const isFirst = idx === 0;
            tableHtml += `
                <tr style="border-bottom: 1px solid #ddd; background-color: ${comp.cor}22;">
                    <td style="padding: 8px; border-right: 1px solid #ddd; font-weight: bold;">${isFirst ? comp.numero : ''}</td>
                    <td style="padding: 8px; border-right: 2px solid #2d34c6;">${isFirst ? escapeHtml(comp.codigo || '-') : ''}</td>
                    <td style="padding: 8px; text-align: center; border-right: 1px solid #ddd; font-weight: 700; color: #1f2937;">${formatCH(comp.curricularCH)}</td>
                    <td style="padding: 8px; text-align: center; border-right: 2px solid #2d34c6; ${allocatedCellStyle}">${isFirst ? (formatCH(comp.allocatedDocenteCH) || '0') : ''}</td>
                    <td style="padding: 8px; border-right: 1px solid #ddd; font-weight: 700; color: #333;">${isFirst ? escapeHtml(comp.disciplina) : ''}</td>
                    <td style="padding: 8px; border-right: 1px solid #ddd; color: #333;">${isFirst ? escapeHtml(comp.turmaLabel || '-') : ''}</td>
                    <td style="padding: 8px; border-right: 1px solid #ddd; color: #333;">${escapeHtml(faixaRow.diasLabel || '-')}</td>
                    <td style="padding: 8px; color: #4b5563;">${escapeHtml(formatPeriodo(faixaRow.dataInicio, faixaRow.dataFim))}</td>
                </tr>
            `;
        });
    });

    tableHtml += `
                <tr style="background: #f8fafc; border-top: 2px solid #2d34c6; border-bottom: 2px solid #2d34c6;">
                    <td colspan="2" style="padding: 8px; border-right: 1px solid #ddd; text-align: right; font-weight: 800; color: #1e3a8a;">Total</td>
                    <td style="padding: 8px; text-align: center; border-right: 1px solid #ddd; font-weight: 800; color: #1e3a8a;">${formatCH(totalGeralCH)}</td>
                    <td style="padding: 8px; text-align: center; border-right: 2px solid #2d34c6; font-weight: 800; color: ${totalAlocadaMismatch ? '#c0392b' : '#1e3a8a'};">${formatCH(totalGeralAlocada) || '0'}</td>
                    <td colspan="4" style="padding: 8px;"></td>
                </tr>
            </tbody>
        </table>
    `;

    return tableHtml;
}

export function generateCalendarGrid(container, turmaId, docenteName, start, end, titleHTML, options = {}) {
    container.innerHTML = '';

    const header = document.createElement('div');
    header.className = turmaId ? 'print-header-container' : 'print-only print-header-container';
    header.innerHTML = titleHTML;
    container.appendChild(header);

    // Adiciona tabela resumo de disciplinas para turmas
    if (turmaId) {
        const resumeTable = buildCalendarTurmaResumeTable(turmaId, start, end);
        if (resumeTable) {
            const tableDiv = document.createElement('div');
            tableDiv.className = 'calendar-turma-resume-container';
            tableDiv.innerHTML = resumeTable;
            container.appendChild(tableDiv);
        }
    } else if (docenteName) {
        // Tabela resumo das componentes lecionadas pelo docente (Calendario Docente)
        const resumeTable = buildCalendarDocenteResumeTable(docenteName, start, end);
        if (resumeTable) {
            const tableDiv = document.createElement('div');
            tableDiv.className = 'calendar-turma-resume-container';
            tableDiv.innerHTML = resumeTable;
            container.appendChild(tableDiv);
        }
    }

    const eventsByDate = getCalendarEvents(turmaId, start, end, docenteName);
    const useNativeShiftMapping = !!options.useNativeShiftMapping;

    let slotsToRender = [];

    if (Array.isArray(options.slotsToRenderOverride) && options.slotsToRenderOverride.length > 0) {
        slotsToRender = options.slotsToRenderOverride.slice();
    }
    else if (turmaId) {
        slotsToRender = buildTurmaCalendarSlots(eventsByDate, turmaId);
    }
    else if (docenteName) {
        const normalizedSkeleton = collectSlotsForTurnoValues(
            getTeacherCalendarTurnoConfigs().map((config) => config.value)
        );
        if (normalizedSkeleton.length > 0) {
            slotsToRender = normalizedSkeleton.slice();
        } else {
        const hp = store.getActiveHorariosPorTurno();
        const skeleton = [];

        if (hp['Manhã']) skeleton.push(...hp['Manhã']);
        if (hp['Tarde']) skeleton.push(...hp['Tarde']);
        if (hp['Noite']) skeleton.push(...hp['Noite']);

        if (skeleton.length === 0) {
            if (store.allocations) {
                store.allocations.forEach(a => {
                    if (a.horario) skeleton.push(a.horario);
                    if (a.horariosOcupados) a.horariosOcupados.forEach(h => skeleton.push(h));
                });
            }
        }

        slotsToRender = [...new Set(skeleton)]
            .map(h => {
                const s = String(h ?? '');
                if (s.toUpperCase().includes('INTERVALO')) return formatIntervaloLabel(s);
                return cleanHorarioLabel(s);
            })
            .filter(s => s && s.trim().length > 0)
            .sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
        }
    }

    const months = {};
    Object.keys(eventsByDate)
        .sort()
        .forEach((dateStr) => {
            const k = dateStr.substring(0, 7);
            if (!months[k]) months[k] = [];
            months[k].push({ date: dateStr, events: eventsByDate[dateStr] });
        });

    const EXIBIR_DOMINGO = false;

    Object.keys(months).forEach((monthKey) => {
        const monthDiv = document.createElement('div');
        monthDiv.className = 'calendar-month';

        const [y, m] = monthKey.split('-');
        const nomeMes = new Date(y, m - 1, 2).toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
        monthDiv.innerHTML = `<h3>${nomeMes.toUpperCase()}</h3>`;

        const grid = document.createElement('div');
        grid.className = 'month-grid';

        if (!EXIBIR_DOMINGO) {
            grid.style.gridTemplateColumns = 'repeat(6, 1fr)';
        }

        const diasCabecalho = EXIBIR_DOMINGO ? ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'] : ['S', 'T', 'Q', 'Q', 'S', 'S'];
        diasCabecalho.forEach((d) => (grid.innerHTML += `<div class="day-header">${d}</div>`));

        const firstDate = months[monthKey][0].date;
        const startDow = new Date(firstDate + 'T12:00:00').getDay();

        let prefixEmptyCells = 0;
        if (EXIBIR_DOMINGO) {
            prefixEmptyCells = startDow;
        } else {
            prefixEmptyCells = startDow === 0 ? 0 : startDow - 1;
        }

        const turnoBoundarySlots = new Set();
        let previousShiftLetter = '';
        slotsToRender.forEach((slot) => {
            const rawSlot = String(slot || '').trim();
            if (!rawSlot || rawSlot.toUpperCase().includes('INTERVALO')) return;
            const currentShiftLetter = getTurnoLetter(rawSlot);
            if (!currentShiftLetter) return;
            if (previousShiftLetter && currentShiftLetter !== previousShiftLetter) {
                turnoBoundarySlots.add(rawSlot);
            }
            previousShiftLetter = currentShiftLetter;
        });

        for (let i = 0; i < prefixEmptyCells; i++) {
            grid.innerHTML += `<div class="day-cell empty"></div>`;
        }

        months[monthKey].forEach((dayData) => {
            const dt = new Date(dayData.date + 'T12:00:00');
            const dayOfWeek = dt.getDay();

            if (!EXIBIR_DOMINGO && dayOfWeek === 0) return;

            const cell = document.createElement('div');
            cell.className = 'day-cell';

            if (dayOfWeek === 0 || dayOfWeek === 6) cell.classList.add('weekend');

            const isOutOfBounds = store.settings.termEnd && dayData.date > store.settings.termEnd;
            if (isOutOfBounds) {
                cell.style.cssText += 'background-color: #ffebee !important; border-color: #ffcdd2 !important;';
            }

            let html = `<span class="day-number">${dayData.date.split('-')[2]}</span>`;
            const holidayEvent = dayData.events.find((e) => e.type === 'holiday');

            if (holidayEvent) {
                cell.style.cssText += 'background-color: #f1f2f6 !important;';
                html += `<div style="text-align:center; color:#7f8c8d; font-style:italic; padding-top:10px; font-weight:bold; font-size:0.9em;">
          ${holidayEvent.title}
        </div>`;
            } else {
                if (slotsToRender.length > 0) {
                    slotsToRender.forEach((slotTime) => {
                        const isIntervalo = slotTime.toUpperCase().includes('INTERVALO');
                        const timeMatch = slotTime.match(/\d{2}:\d{2}/);
                        const timeLabel = timeMatch ? timeMatch[0] : '';

                        const normalizeTime = (t) => (t || '').replace(/\s/g, '');
                        const slotTimeNorm = normalizeTime(slotTime);

                        const eventsInSlot = dayData.events.filter(e => {
                            const eTurno = e.turno ||
                                store.rawData?.turmas?.find(t => String(t.turma_id) === String(e.turmaId))?.turno || 'Tarde';
                            let eHorario = e.horario;
                            let eHorariosUltimoDia = e.horariosUltimoDia;
                            let eHorariosOcupados = e.horariosOcupados;

                            if (e.sabadoManha && dayOfWeek === 6 && eTurno !== 'Manha' && eTurno !== 'Manhã') {
                                if (eHorario) eHorario = mapSlotToTurno(eHorario, 'Manha', eTurno, store.getActiveHorariosPorTurno());
                                if (Array.isArray(eHorariosUltimoDia)) eHorariosUltimoDia = eHorariosUltimoDia.map(h => mapSlotToTurno(h, 'Manha', eTurno, store.getActiveHorariosPorTurno()));
                                if (Array.isArray(eHorariosOcupados)) eHorariosOcupados = eHorariosOcupados.map(h => mapSlotToTurno(h, 'Manha', eTurno, store.getActiveHorariosPorTurno()));
                            }

                            if (eHorario) eHorario = getShiftChangeMeta(e, eHorario, dayOfWeek, dayData.date).mappedSlot || eHorario;
                            if (Array.isArray(eHorariosUltimoDia)) {
                                eHorariosUltimoDia = eHorariosUltimoDia.map((h) => getShiftChangeMeta(e, h, dayOfWeek, dayData.date).mappedSlot || h);
                            }
                            if (Array.isArray(eHorariosOcupados)) {
                                eHorariosOcupados = eHorariosOcupados.map((h) => getShiftChangeMeta(e, h, dayOfWeek, dayData.date).mappedSlot || h);
                            }
                            if (!useNativeShiftMapping) {
                                eHorario = e.horario;
                                eHorariosUltimoDia = e.horariosUltimoDia;
                                eHorariosOcupados = e.horariosOcupados;
                            }

                            if (eHorario && normalizeTime(eHorario) === slotTimeNorm) return true;

                            // NOVO: RESPEITA OS SLOTS LIMITADOS NO ÚLTIMO DIA DA INTENSIVA
                            // Removida check isFaixaAllocation
                            if (e.dataFim === dayData.date && eHorariosUltimoDia) {
                                return eHorariosUltimoDia.some(h => normalizeTime(h) === slotTimeNorm);
                            }

                            if (eHorariosOcupados && eHorariosOcupados.some(h => normalizeTime(h) === slotTimeNorm)) return true;
                            return false;
                        });
                        const dedupeEventKey = (e) => `${e.turmaId || ''}|${e.disciplina || ''}|${e.modo || ''}|${e.subGrupo || ''}|${slotTimeNorm}`;
                        const seenSlotEvents = new Set();
                        const uniqueEventsInSlot = eventsInSlot.filter((e) => {
                            const key = dedupeEventKey(e);
                            if (seenSlotEvents.has(key)) return false;
                            seenSlotEvents.add(key);
                            return true;
                        });

                        let content = '';
                        let style = '';

                        if (isIntervalo) {
                            content = '<span style="color:#7f8c8d; font-style:italic; font-size:0.85em;">Intervalo</span>';
                            style = 'background:#e0e0e0;';
                        } else if (uniqueEventsInSlot.length > 0) {
                            const hasSpecificConflict = uniqueEventsInSlot.some(e => e.conflictsAt && e.conflictsAt.includes(slotTimeNorm));
                            const implicitConflict = uniqueEventsInSlot.length > 1;

                            if (docenteName) {
                                if (hasSpecificConflict || implicitConflict) {
                                    style = 'background: #c0392b; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight:bold;';
                                    const conflictNames = uniqueEventsInSlot.map((e) => `${getDisciplinaInfo(e.disciplina).abrev} - ${e.turmaId}`).join(' <b style="color:#fff">x</b> ');
                                    content = `<span title="Choque: ${conflictNames.replace(/<[^>]+>/g, '')}">⚠️ ${conflictNames}</span>`;
                                } else {
                                    const event = uniqueEventsInSlot[0];
                                    const info = getDisciplinaInfo(event.disciplina);
                                    const shiftBadgeDisplay = getCalendarShiftBadgeHTML(
                                        event,
                                        slotTime,
                                        dayOfWeek,
                                        dayData.date
                                    );
                                    content = `${info.abrev}${shiftBadgeDisplay} - ${event.turmaId}`;
                                    style = `background:${vividHexColor(event.cor || '#bdc3c7')}; color:black;`;
                                }
                            } else {
                                const event = uniqueEventsInSlot[0];
                                if (event) {
                                    const info = getDisciplinaInfo(event.disciplina);
                                    const docenteFirst = getDocenteShortLabel(event.docente) || '';
                                    const docenteLabel = (docenteFirst && !/^a$/i.test(docenteFirst)) ? docenteFirst.toUpperCase() : '';
                                    const eBadgeDisplay = getCalendarShiftBadgeHTML(
                                        event,
                                        slotTime,
                                        dayOfWeek,
                                        dayData.date
                                    );
                                    content = docenteLabel
                                        ? `<div>${info.abrev}${eBadgeDisplay} <span style="font-size:0.82em; font-weight:600; opacity:0.92;">- ${docenteLabel}</span></div>`
                                        : `${info.abrev}${eBadgeDisplay}`;
                                    style = `background:${vividHexColor(event.cor || '#bdc3c7')}; color:black;`;
                                } else {
                                    content = '&nbsp;';
                                    style = 'background: #ecf0f1;';
                                }
                            }

                            if (isOutOfBounds) {
                                style = 'background: #c0392b !important; color: white !important; font-weight: bold; border: 1px solid #900 !important;';
                                if (!content.includes('⚠️')) {
                                    content = `⚠️ ${content}`;
                                }
                            }

                        } else {
                            content = '&nbsp;';
                            style = 'background: #ecf0f1;';
                        }

                        const hasOverriding = uniqueEventsInSlot.some(e => (e.isIntensive || e.isPriority) && !docenteName);

                        let className = 'cal-slot-content';
                        if (hasOverriding) className += ' overriding-event';

                        let tooltip = '';
                        if (isOutOfBounds && uniqueEventsInSlot.length > 0) {
                            tooltip = `title="ALERTA: Aula marcada fora do semestre letivo!"`;
                        }

                        let rowStyle = '';
                        if (isTurnoDividerSlot(slotTime) || (typeof turnoBoundarySlots !== 'undefined' && turnoBoundarySlots.has(slotTime))) {
                            const isIntervaloManha = slotTime.includes('10:20');
                            const borderStyle = isIntervaloManha ? '2px dashed #ced4da' : '3px dashed #bdc3c7';
                            rowStyle = `border-top: ${borderStyle}; margin-top: 2px; padding-top: 2px;`;
                        }

                        let turnoClass = '';
                        const tLetter = getTurnoLetter(slotTime);
                        if (tLetter === 'M') turnoClass = 'turno-manha';
                        else if (tLetter === 'T') turnoClass = 'turno-tarde';
                        else if (tLetter === 'N') turnoClass = 'turno-noite';

                        html += `
              <div class="cal-slot-row ${turnoClass}${isIntervalo ? ' cal-slot-interval' : ''}" style="${rowStyle}">
                <div class="cal-slot-time">${timeLabel}</div>
                <div class="${className}" style="${style}" ${tooltip}>${content}</div>
              </div>`;
                    });
                } else {
                    dayData.events.forEach((ev) => {
                        const info = getDisciplinaInfo(ev.disciplina);
                        let style = `background:${vividHexColor(ev.cor || '#bdc3c7')}`;
                        let displayLabel = docenteName ? `${info.abrev} - ${ev.turmaId}` : info.abrev;

                        if (isOutOfBounds) {
                            style = `background: #c0392b !important; color: white !important; font-weight: bold; border: 1px solid #900 !important;`;
                            displayLabel = `⚠️ ${displayLabel}`;
                        }

                        html += `<div class="event-chip" style="${style}" title="${isOutOfBounds ? 'FORA DO SEMESTRE!' : ''}">${displayLabel}</div>`;
                    });
                }
            }

            cell.innerHTML = html;
            grid.appendChild(cell);
        });

        const lastDateObj = new Date(months[monthKey][months[monthKey].length - 1].date + 'T12:00:00');
        const lastDow = lastDateObj.getDay();

        let emptySuffix = 0;
        if (EXIBIR_DOMINGO) {
            emptySuffix = 6 - lastDow;
        } else {
            if (lastDow === 0) emptySuffix = 0;
            else emptySuffix = 6 - lastDow;
        }

        for (let i = 0; i < emptySuffix; i++) {
            grid.innerHTML += `<div class="day-cell empty" style="border-bottom: 2px solid #bdc3c7;"></div>`;
        }

        monthDiv.appendChild(grid);
        container.appendChild(monthDiv);
    });
}
