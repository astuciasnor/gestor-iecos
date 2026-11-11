import { store } from './store.js?v=202611102224';
import { getCalendarEvents } from './calendar.js?v=202611102224';
import { buildTeacherExecutionSnapshot, buildCanonicalOfferProjection } from './execution_engine.js?v=202611102224';
import { detectTeacherConflicts } from './conflicts.js?v=202611102224';
import { getHorariosByTurno, normalizeTurnoKey, getTurnoLetter, mapSlotToTurno } from './turns.js?v=202611102224';
import { vividHexColor } from './color_utils.js?v=202611102224';
import { formatDateBR, timeToMinutes, shortDayName } from './date_utils_ui.js?v=202611102224';
import {
    isFaixaAllocation,
    isScheduledRegularAllocation,
    allocationHasTeacherMatch,
    teacherNamesMatch,
    getDocenteShortLabel,
    calculateTeacherTotalCH
} from './allocation_helpers.js?v=202611102224';
import {
    normalizeTurnoOfertaKey,
    formatTurnoOfertaLabel,
    cleanHorarioLabel,
    formatIntervaloLabel,
    isTurnoDividerSlot,
    buildHorariosForUI,
    getShiftChangeMeta,
    getCalendarShiftBadgeHTML
} from './turno_helpers.js?v=202611102224';
import {
    getDisciplinaCHGlobal,
    getTurmaLabel,
    getTurmaBaseLabel,
    getDisciplinaInfo,
    getCursoSiglaDaTurma,
    getPrintAcademicMetaLine
} from './curso_turma_helpers.js?v=202611102224';
import {
    getGanttTurnoConfigs,
    resolveTeacherShiftForSlot
} from './turnos_docente.js?v=202611102224';

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

// Linhas de horario do calendario do docente. O quadro de horarios depende do
// curso (regime); sem isto ele vinha do curso escolhido na barra lateral (ou do
// regime padrao, sem curso escolhido) e as aulas de outro quadro sumiam da grade.
// Usa os cursos das turmas em que o docente da aula.
export function getTeacherSlotsForEvents(activeShiftKeys = [], eventsByDate = {}) {
    const cursoPorTurma = new Map((store.rawData?.turmas || []).map((t) => [String(t.turma_id), String(t.sigla || '')]));
    const cursos = new Set();
    Object.values(eventsByDate || {}).forEach((events) => (Array.isArray(events) ? events : []).forEach((event) => {
        if (!event || event.type === 'holiday') return;
        const curso = cursoPorTurma.get(String(event.turmaId || ''));
        if (curso) cursos.add(curso);
    }));
    if (!cursos.size) return getSlotsForTeacherShifts(activeShiftKeys);

    const savedCurso = store.selectedCurso;
    const slots = new Set();
    try {
        cursos.forEach((curso) => {
            store.selectedCurso = curso;
            getSlotsForTeacherShifts(activeShiftKeys).forEach((slot) => slots.add(slot));
        });
    } finally {
        store.selectedCurso = savedCurso;
    }
    return [...slots].sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
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

// Conflitos so aparecem quando existem: selo vermelho no topo (e a tabela de
// conflitos logo abaixo). Sem conflito, nada.
function conflictPillHtml(total) {
    return total > 0
        ? `<div style="background:#fdecea; color:#a61b1b; border:1px solid #f5c2c0; border-radius:999px; padding:8px 14px; font-weight:800;">⚠️ Conflitos de horário: ${total}</div>`
        : '';
}

export function renderTeacherConflictRows(conflicts = []) {
    if (!Array.isArray(conflicts) || conflicts.length === 0) return '';

    // Sem o antigo selo "IMPORTADO": o salvar barra o choque de qualquer
    // componente (inclusive as da Insercao por Bloco), entao o selo ja nao
    // significava "sobreposicao permitida".
    const rows = conflicts.map((conflict) => {
        return `
        <tr>
            <td style="padding:8px 10px; border-bottom:1px solid #dfe6e9;">${formatConflictDateRange(conflict.startDate, conflict.endDate)}</td>
            <td style="padding:8px 10px; border-bottom:1px solid #dfe6e9;">${conflict.shift || '-'}</td>
            <td style="padding:8px 10px; border-bottom:1px solid #dfe6e9;">${conflict.turmas.join(', ') || '-'}</td>
            <td style="padding:8px 10px; border-bottom:1px solid #dfe6e9;">${conflict.componentes.join(', ') || '-'}</td>
            <td style="padding:8px 10px; border-bottom:1px solid #dfe6e9;">${conflict.description}</td>
        </tr>
    `;
    }).join('');

    return `
        <div style="margin-bottom:18px;">
            <h4 style="margin:0 0 10px 0; color:var(--primary); text-transform:uppercase; letter-spacing:0.6px;">Tabela de Conflitos</h4>
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

    // Periodo escolhido nos botoes do docente (Ano inteiro, PL1..PL4). Sem
    // escolha, ou com o PL aberto na barra lateral, e o calendario de sempre.
    const periodo = resolveTeacherPeriod();
    updatePeriodButtons();
    const start = periodo.start || (calStart ? calStart.value : '');
    let end = periodo.end || (calEnd ? calEnd.value : '');

    // Ano inteiro ou outro PL: junta os PLs pedidos. Enquanto eles chegam do
    // servidor, mostra o PL aberto.
    const carregandoOutrosPLs = periodo.multi && !!teacherRangeLoader;
    if (carregandoOutrosPLs) {
        if (teacherRangeView && teacherRangeView.key === periodo.key) {
            renderTeacherRangeCalendar(container, docente, teacherRangeView);
            return;
        }
        requestTeacherRange(periodo);
    }
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
    const visibleSlots = getTeacherSlotsForEvents(activeShiftKeys, eventsByDate);
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
            ${carregandoOutrosPLs ? `<div class="no-print" style="background:#fff7e6; color:#7a4b00; border:1px solid #f3d9a4; border-radius:8px; padding:10px 14px; font-weight:700;">${
                teacherRangeFailed === periodo.key
                    ? 'Não foi possível ler os outros períodos letivos do servidor: aparece só o PL aberto na barra lateral. Clique em ⟳ ao lado do docente para tentar de novo.'
                    : 'Buscando os períodos letivos escolhidos... (por enquanto aparece o PL aberto na barra lateral)'
            }</div>` : ''}
            <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center; border-top:2px solid #94a3b8; padding-top:14px;">
                <div style="background:#eef6f0; color:#1f5d3a; border:1px solid #cfe8d7; border-radius:999px; padding:8px 14px; font-weight:700;">Turnos ativos: ${shiftSummary}</div>
                ${conflictPillHtml(conflictRows.length)}
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

/// ===== Ano inteiro ou outro PL no Calendario Docente =====
// O periodo do docente e escolhido pelos botoes (ano + "Ano inteiro" ou
// PL1..PL4) e nao mexe nas datas do Calendario da Turma. Ano inteiro junta
// PL1..PL4: tabela por PL (com subtotal) e um calendario so. Os PLs que nao
// estao abertos vem do teacherRangeLoader (ui.js: servidor ou navegador); o PL
// aberto usa sempre store.allocations, para refletir na hora o que se edita
// nele. Nada e gravado.
let teacherPeriod = null;          // null | { tipo: 'ano', ano } | { tipo: 'pl', meta }
let teacherRangeView = null;       // { key, start, end, only, plans: [{ meta, allocations }] }
let teacherRangeLoader = null;     // async (start, end) => [{ meta, allocations }]
let teacherRangeLoading = '';
let teacherRangeFailed = '';

export function setTeacherRangeLoader(loader) {
    teacherRangeLoader = typeof loader === 'function' ? loader : null;
}

export function setTeacherPeriod(period) {
    teacherPeriod = period && (period.tipo === 'ano' || period.tipo === 'pl') ? period : null;
}

export function getTeacherPeriod() {
    return teacherPeriod;
}

// Botao de atualizar do docente: busca de novo os outros PLs.
export function clearTeacherRangeCache() {
    teacherRangeView = null;
    teacherRangeFailed = '';
}

function activePlanKey() {
    return store.activePlanMeta?.key || '';
}

// { multi, key, start, end, only }: multi = precisa juntar PLs que nao estao abertos.
function resolveTeacherPeriod() {
    if (teacherPeriod?.tipo === 'ano') {
        const ano = String(teacherPeriod.ano);
        return { multi: true, key: `ano|${ano}`, start: `${ano}-01-01`, end: `${ano}-12-31`, only: '' };
    }
    const meta = teacherPeriod?.tipo === 'pl' ? teacherPeriod.meta : null;
    if (meta?.key && meta.key !== activePlanKey()) {
        return { multi: true, key: `pl|${meta.key}`, start: meta.termStart, end: meta.termEnd, only: meta.key };
    }
    return {
        multi: false,
        key: '',
        start: String(store.settings?.termStart || ''),
        end: String(store.settings?.termEnd || '')
    };
}

function isFullYear(start, end) {
    const year = String(start || '').slice(0, 4);
    return !!year && start === `${year}-01-01` && end === `${year}-12-31`;
}

// Marca o botao do periodo exibido: "Ano inteiro" ou o PL (sem escolha, o PL
// aberto na barra lateral, se for do ano escolhido).
function updatePeriodButtons() {
    const anoAtivo = teacherPeriod?.tipo === 'ano';
    const btnAno = document.getElementById('btn-ano-inteiro-teacher');
    if (btnAno) {
        btnAno.classList.toggle('is-active', anoAtivo);
        btnAno.setAttribute('aria-pressed', anoAtivo ? 'true' : 'false');
    }
    const plKey = anoAtivo ? '' : (teacherPeriod?.tipo === 'pl' ? teacherPeriod.meta?.key : activePlanKey());
    document.querySelectorAll('#docente-pl-buttons [data-plan-key]').forEach((btn) => {
        const ativo = !!plKey && btn.dataset.planKey === plKey;
        btn.classList.toggle('is-active', ativo);
        btn.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    });
}

function requestTeacherRange(periodo) {
    const { key, start, end, only } = periodo;
    if (teacherRangeLoading === key || teacherRangeFailed === key) return;
    teacherRangeLoading = key;
    Promise.resolve()
        .then(() => teacherRangeLoader(start, end))
        .then((plans) => {
            if (teacherRangeLoading !== key) return;
            teacherRangeLoading = '';
            const lista = Array.isArray(plans) ? plans : [];
            teacherRangeView = { key, start, end, only, plans: only ? lista.filter((p) => p.meta?.key === only) : lista };
            if (resolveTeacherPeriod().key === key) renderTeacherCalendar();
        })
        .catch((error) => {
            if (teacherRangeLoading === key) teacherRangeLoading = '';
            teacherRangeFailed = key; // nao insiste a cada redesenho; o botao de atualizar tenta de novo
            console.error('Falha ao ler os periodos letivos do servidor', error);
            if (resolveTeacherPeriod().key === key) renderTeacherCalendar();
        });
}

// Roda fn com o store apontando para o periodo letivo meta (mesma troca
// temporaria usada ao publicar a agenda) e devolve o store como estava.
export function withPlanContext(meta, allocations, fn) {
    const saved = { settings: store.settings, allocations: store.allocations, activePlanMeta: store.activePlanMeta };
    try {
        store.settings = { ...saved.settings, periodo: meta.periodo, termStart: meta.termStart, termEnd: meta.termEnd };
        store.allocations = allocations;
        store.activePlanMeta = meta;
        return fn();
    } finally {
        store.settings = saved.settings;
        store.allocations = saved.allocations;
        store.activePlanMeta = saved.activePlanMeta;
    }
}

// Junta os eventos de cada PL num so mapa por data. Uma componente nunca passa
// de um PL para outro, entao basta somar as aulas de cada dia (o feriado entra uma vez).
function mergeEventsByDate(target, source) {
    Object.entries(source || {}).forEach(([date, events]) => {
        const list = target[date] || (target[date] = []);
        (Array.isArray(events) ? events : []).forEach((event) => {
            if (event?.type === 'holiday') {
                if (!list.some((e) => e?.type === 'holiday')) list.push(event);
                return;
            }
            list.push(event);
        });
    });
    return target;
}

function renderTeacherRangeCalendar(container, docente, view) {
    const rangeStart = view.start;
    const rangeEnd = view.end;
    const fullYear = isFullYear(rangeStart, rangeEnd);
    const umPL = !!view.only; // um PL que nao e o aberto na barra lateral
    const year = rangeStart.slice(0, 4);
    // Como no calendario de um PL: o ultimo mes aparece inteiro.
    const endDt = new Date(rangeEnd + 'T12:00:00');
    const gridEnd = new Date(endDt.getFullYear(), endDt.getMonth() + 1, 0).toISOString().split('T')[0];
    const activeKey = store.activePlanMeta?.key || '';
    const turnoConfigs = getTeacherCalendarTurnoConfigs();

    const sections = [];
    const conflictRows = [];
    const shiftKeys = new Set();
    const slotSet = new Set();
    const eventsByDate = {};

    (view.plans || []).forEach(({ meta, allocations }) => {
        const planAllocations = meta.key === activeKey ? store.allocations : (allocations || []);
        // Parte do PL que cai no intervalo (o ano inteiro pega o PL todo).
        const planStart = meta.termStart > rangeStart ? meta.termStart : rangeStart;
        const planEnd = meta.termEnd < rangeEnd ? meta.termEnd : rangeEnd;
        withPlanContext(meta, planAllocations, () => {
            const snapshot = buildTeacherExecutionSnapshot({
                docenteName: docente,
                startDate: planStart,
                endDate: planEnd,
                resolveShift: (slot) => resolveTeacherShiftForSlot(slot),
                preferredShiftOrder: turnoConfigs.map((config) => config.value),
                formatTurmaLabel: (event) => getTurmaLabel(event?.turmaId, event?.subGrupo)
            });
            const planShiftKeys = snapshot.activeShiftData.map((shift) => shift.normalized).filter(Boolean);
            planShiftKeys.forEach((key) => shiftKeys.add(key));
            // O quadro de horarios pode mudar de um PL para outro (regime): cada PL
            // contribui com as suas linhas de horario.
            getTeacherSlotsForEvents(planShiftKeys, snapshot.eventsByDate).forEach((slot) => slotSet.add(slot));

            const planYear = String(meta.termStart || '').slice(0, 4);
            sections.push({
                titulo: umPL ? '' : `${planYear} - ${meta.periodo} (${formatPeriodo(meta.termStart, meta.termEnd)})`,
                rotulo: `${planYear} - ${meta.periodo} (${formatPeriodo(meta.termStart, meta.termEnd)})`,
                periodo: fullYear ? meta.periodo : `${meta.periodo}/${planYear}`,
                components: collectDocenteResumeComponents(docente, planStart, planEnd)
            });
            mergeEventsByDate(eventsByDate, getCalendarEvents(null, rangeStart, gridEnd, docente));
        });
    });

    // Conflitos no calendario ja juntado: pega os de dentro de cada PL e tambem os
    // entre PLs que se sobrepoem nas datas (ex.: PL2 ate julho e PL3 desde junho).
    conflictRows.push(...detectTeacherConflicts({
        eventsByDate,
        resolveShift: (slot) => resolveTeacherShiftForSlot(slot),
        formatTurmaLabel: (event) => getTurmaLabel(event?.turmaId, event?.subGrupo)
    }));

    const totalAno = sumComponentsCH(sections.flatMap((section) => section.components)).alocada;
    const porPL = sections
        .map((section) => `${section.periodo}: ${formatCH(sumComponentsCH(section.components).alocada) || '0'}h`)
        .join(' · ');
    const rangeLabel = umPL ? (sections[0]?.rotulo || '') : (fullYear ? year : formatPeriodo(rangeStart, rangeEnd));
    const onde = umPL ? 'no PL' : (fullYear ? 'no ano' : 'no intervalo');
    const docenteTitle = totalAno > 0 ? `${docente} - ${rangeLabel} (${formatCH(totalAno)}h)` : `${docente} - ${rangeLabel}`;
    const headline = umPL
        ? (sections[0]?.rotulo || formatPeriodo(rangeStart, rangeEnd))
        : fullYear
        ? `Ano ${year} inteiro (${sections.map((s) => s.periodo).join(', ') || 'nenhum PL'})`
        : `De ${formatPeriodo(rangeStart, rangeEnd)} (${sections.map((s) => s.periodo).join(', ') || 'nenhum PL'})`;
    const shiftSummary = shiftKeys.size > 0
        ? [...shiftKeys].map((key) => formatTurnoOfertaLabel(key)).join(', ')
        : 'Sem turnos ativos no intervalo';
    const visibleSlots = [...slotSet].sort((a, b) => timeToMinutes(a) - timeToMinutes(b));

    container.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:16px;">
            <div class="print-only print-header-container">
                <span class="print-title-main">Vistoria de Conflitos Horarios</span><br>
                <span class="print-title-sub">${escapeHtml(docenteTitle)}</span>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center; border-top:2px solid #94a3b8; padding-top:14px;">
                <div style="background:#e3eef8; color:#0f4f7d; border:1px solid #c5d8e8; border-radius:999px; padding:8px 14px; font-weight:800;">${escapeHtml(headline)}</div>
                <div style="background:#fff7e6; color:#7a4b00; border:1px solid #f3d9a4; border-radius:999px; padding:8px 14px; font-weight:800;">CH alocada ${onde}: ${formatCH(totalAno) || '0'}h${umPL ? '' : ` <span style="font-weight:600;">(${escapeHtml(porPL || 'nenhum PL')})</span>`}</div>
                <div style="background:#eef6f0; color:#1f5d3a; border:1px solid #cfe8d7; border-radius:999px; padding:8px 14px; font-weight:700;">Turnos ativos: ${shiftSummary}</div>
                ${conflictPillHtml(conflictRows.length)}
            </div>
            ${renderTeacherConflictRows(conflictRows)}
            <div id="teacher-calendar-inspection-grid"></div>
        </div>
    `;

    const calendarContainer = document.getElementById('teacher-calendar-inspection-grid');
    const title = `<span class="print-title-main">Vistoria de Conflitos Horarios</span><br><span class="print-title-sub">${escapeHtml(docenteTitle)}</span>`;
    const cabecalho = {
        docente,
        subtitulo: `${headline} · CH alocada ${onde}: ${formatCH(totalAno) || '0'}h`
    };
    generateCalendarGrid(calendarContainer, null, docente, rangeStart, gridEnd, title, {
        slotsToRenderOverride: visibleSlots,
        eventsByDate,
        resumeTableHtml: buildDocenteResumeTableHtml(sections, umPL ? 'Total' : (fullYear ? 'Total do ano' : 'Total do intervalo'), cabecalho),
        termEndLimit: gridEnd
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
                        // Horas executadas por este docente nesta oferta (coluna "CH alocada").
                        horas: segments.length === 1 ? toCH(group?.executedHours) : toCH(segment?.hours),
                        dataInicio: String(segment?.start || fallbackStart || '').trim(),
                        dataFim: String(segment?.end || fallbackEnd || '').trim()
                    };
                });
        }

        if (declaredDocentes.length > 0) {
            return declaredDocentes.map((docente) => ({
                nome: String(docente?.nome || '').trim() || '-',
                ch: toCH(docente?.ch),
                horas: declaredDocentes.length === 1 ? toCH(group?.executedHours) : 0,
                dataInicio: fallbackStart,
                dataFim: fallbackEnd
            }));
        }

        const fallbackDocente = String(group?.baseAlloc?.docente || group?.docenteLabel || '').trim();
        return [{
            nome: fallbackDocente || '-',
            ch: 0,
            horas: toCH(group?.executedHours),
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
            const info = getDisciplinaInfo(disciplina, turmaId);
            const totalCH = toCH(getDisciplinaCHGlobal(disciplina, turmaId)) || toCH(info?.ch) || toCH(baseAlloc?.ch);
            disciplinasMap.set(disciplina, {
                disciplina,
                codigo: String(info?.codigo || baseAlloc?.componenteCode || '').trim(),
                cor: baseAlloc?.cor || store.getDisciplinaColor(disciplina, getCursoSiglaDaTurma(turmaId)) || '#f39c12',
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
                const info = getDisciplinaInfo(disciplina, turmaId);
                const totalCH = toCH(getDisciplinaCHGlobal(disciplina, turmaId)) || toCH(info?.ch);
                disciplinasMap.set(disciplina, {
                    disciplina,
                    codigo: String(info?.codigo || alloc?.componenteCode || '').trim(),
                    cor: alloc?.cor || store.getDisciplinaColor(disciplina, getCursoSiglaDaTurma(turmaId)) || '#f39c12',
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
                disciplinaEntry.rows.push({ nome: '-', ch: 0, horas: 0, dataInicio, dataFim });
                return;
            }

            docentes.forEach((docente) => {
                disciplinaEntry.rows.push({
                    nome: docente.nome,
                    ch: toCH(docente.ch),
                    horas: toCH(docente.ch),
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
                ch: Math.max(toCH(current?.ch), toCH(row?.ch)),
                horas: toCH(current?.horas) + toCH(row?.horas)
            });
        });

        const rows = [...merged.values()]
            .sort((a, b) => {
                const startCmp = String(a.dataInicio || '').localeCompare(String(b.dataInicio || ''));
                if (startCmp !== 0) return startCmp;
                return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', { sensitivity: 'base' });
            });

        const totalFromRows = rows.reduce((sum, row) => sum + toCH(row.horas), 0);
        // CH alocada = horas efetivamente executadas (projecao canonica). No
        // caminho de fallback (sem projecao) usa a soma das linhas para nao
        // sinalizar divergencia falsa.
        const allocatedCH = (disciplina.allocatedCH === null || disciplina.allocatedCH === undefined)
            ? totalFromRows
            : toCH(disciplina.allocatedCH);
        // Cada linha mostra as suas horas. Se as linhas nao fecham com o total
        // (ex.: docente sem aula observada), mostra o total so na primeira linha.
        const rowsFecham = rows.length === 1 || Math.abs(totalFromRows - allocatedCH) <= 0.01;
        rows.forEach((row, idx) => {
            row.horas = rowsFecham && rows.length > 1 ? toCH(row.horas) : (idx === 0 ? allocatedCH : null);
        });
        const totalChRows = rows.reduce((sum, row) => sum + toCH(row.ch), 0);
        return {
            ...disciplina,
            rows,
            allocatedCH,
            totalCH: toCH(disciplina.totalCH) > 0 ? toCH(disciplina.totalCH) : (totalChRows || totalFromRows)
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
        const safeRows = disc.rows.length > 0 ? disc.rows : [{ nome: '-', ch: 0, horas: disc.allocatedCH, dataInicio: '', dataFim: '' }];
        const allocatedMismatch = Math.abs(toCH(disc.allocatedCH) - toCH(disc.totalCH)) > 0.01;
        const allocatedCellStyle = allocatedMismatch
            ? 'color: #c0392b; font-weight: 800;'
            : 'color: #1f2937; font-weight: 700;';
        // Com divergencia, o aviso diz a soma alocada contra a CH da componente.
        const allocatedTitle = allocatedMismatch
            ? ` title="Alocado ${formatCH(disc.allocatedCH) || '0'}h para CH de ${formatCH(disc.totalCH) || '0'}h"`
            : '';

        safeRows.forEach((row, idx) => {
            const isFirst = idx === 0;
            const horasDisplay = row.horas === null || row.horas === undefined ? '' : (formatCH(row.horas) || '0');
            tableHtml += `
                <tr style="border-bottom: 1px solid #ddd; background-color: ${disc.cor}22;">
                    <td style="padding: 8px; border-right: 1px solid #ddd; font-weight: bold;">${isFirst ? disc.numero : ''}</td>
                    <td style="padding: 8px; border-right: 2px solid #2d34c6;">${isFirst ? escapeHtml(disc.codigo || '-') : ''}</td>
                    <td style="padding: 8px; text-align: center; border-right: 1px solid #ddd; font-weight: 700; color: #1f2937;">${isFirst ? formatCH(disc.totalCH) : ''}</td>
                    <td style="padding: 8px; text-align: center; border-right: 2px solid #2d34c6; ${allocatedCellStyle}"${allocatedTitle}>${horasDisplay}</td>
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

// Tabela resumo do Calendario Docente (espelha buildCalendarTurmaResumeTable,
// mas com o docente fixo). Lista cada componente que o professor leciona, em
// qual turma, com a CH sob sua responsabilidade, a CH efetivamente alocada
// (horas executadas do professor) e o periodo em que ele atua na componente.
export function buildCalendarDocenteResumeTable(docenteName, start, end) {
    const components = collectDocenteResumeComponents(docenteName, start, end);
    if (!components.length) return null;
    const termStart = String(store.settings?.termStart || '');
    const termEnd = String(store.settings?.termEnd || '');
    const plano = store.settings?.periodo && termStart
        ? `${termStart.slice(0, 4)} - ${store.settings.periodo} (${formatPeriodo(termStart, termEnd)})`
        : formatPeriodo(start, end);
    const totalAlocado = sumComponentsCH(components).alocada;
    return buildDocenteResumeTableHtml([{ components }], 'Total', {
        docente: String(docenteName || '').trim(),
        subtitulo: `${plano} · CH alocada: ${formatCH(totalAlocado) || '0'}h`
    });
}

// Aulas DESTE docente por alocacao, ja como o calendario as calcula (feriados
// e divisao entre docentes de componente compartilhada aplicados).
function collectTeacherClassesByAllocation(docente, start, end) {
    const porAlocacao = new Map();
    const events = getCalendarEvents(null, start, end, docente);
    Object.entries(events || {}).forEach(([date, list]) => {
        (Array.isArray(list) ? list : []).forEach((event) => {
            if (!event || event.type === 'holiday' || !event.id) return;
            const horario = String(event.horario || '').trim();
            if (!horario) return;
            if (!porAlocacao.has(event.id)) porAlocacao.set(event.id, new Map());
            porAlocacao.get(event.id).set(`${date}|${horario}`, { date, horario });
        });
    });
    return porAlocacao;
}

function horarioToMinutes(hhmm) {
    const match = String(hhmm || '').match(/(\d{1,2}):(\d{2})/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
}

function minutesToHorario(total) {
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// "14:00 - 14:50", "14:50 - 15:40" ... -> "14:00–17:40". Intervalos curtos
// (ate 30 min) ficam no mesmo bloco; manha e tarde no mesmo dia viram dois blocos.
function blocosDeHorario(horarios = []) {
    const slots = [...new Set(horarios)]
        .map((horario) => {
            const times = String(horario).match(/\d{1,2}:\d{2}/g) || [];
            const ini = horarioToMinutes(times[0]);
            const fim = times[1] ? horarioToMinutes(times[1]) : ini + 50;
            return [ini, fim];
        })
        .filter(([ini, fim]) => Number.isFinite(ini) && Number.isFinite(fim))
        .sort((x, y) => x[0] - y[0]);
    const blocos = [];
    slots.forEach(([ini, fim]) => {
        const ultimo = blocos[blocos.length - 1];
        if (ultimo && ini <= ultimo[1] + 30) ultimo[1] = Math.max(ultimo[1], fim);
        else blocos.push([ini, fim]);
    });
    return blocos.map(([ini, fim]) => `${minutesToHorario(ini)}–${minutesToHorario(fim)}`).join(' e ');
}

// Horario das aulas de uma faixa: um so horario quando todos os dias sao
// iguais; senao, um por grupo de dias (ex.: "Seg, Ter: 14:00–17:40").
function formatHorarioDasAulas(aulas = []) {
    const porDia = new Map();
    aulas.forEach(({ date, horario }) => {
        const dow = new Date(`${date}T12:00:00`).getDay();
        if (!porDia.has(dow)) porDia.set(dow, []);
        porDia.get(dow).push(horario);
    });
    const grupos = new Map();
    [...porDia.keys()].sort((x, y) => x - y).forEach((dow) => {
        const faixa = blocosDeHorario(porDia.get(dow));
        if (!faixa) return;
        if (!grupos.has(faixa)) grupos.set(faixa, []);
        grupos.get(faixa).push(dow);
    });
    if (grupos.size <= 1) return [...grupos.keys()];
    return [...grupos.entries()].map(([faixa, dias]) => `${dias.map((d) => shortDayName(d)).join(', ')}: ${faixa}`);
}

// Componentes do docente no periodo letivo carregado no store.
//   chDocente: parte da CH que cabe ao docente (componente compartilhada) ou a CH toda;
//   chAlocada: horas que o coordenador ja alocou para ele (aulas no calendario).
function collectDocenteResumeComponents(docenteName, start, end) {
    const docente = String(docenteName || '').trim();
    if (!docente) return [];

    const allocations = store.allocations.filter((a) => (
        (isScheduledRegularAllocation(a) || isFaixaAllocation(a))
        && allocationHasTeacherMatch(a, docente)
    ));
    if (allocations.length === 0) return [];

    const offerProjection = buildCanonicalOfferProjection({
        allocations,
        startDate: start,
        endDate: end
    });
    const aulasPorAlocacao = collectTeacherClassesByAllocation(docente, start, end);

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

        const docentesOferta = Array.isArray(offerGroup?.docentes) ? offerGroup.docentes : [];
        const declaredDocente = docentesOferta.find((d) => teacherNamesMatch(d?.nome, docente));

        const turmaId = String(offerGroup?.turmaId || baseAlloc?.turmaId || '').trim();
        const info = getDisciplinaInfo(disciplina, turmaId);

        // CH curricular total da componente.
        const curricularCH = toCH(getDisciplinaCHGlobal(disciplina, turmaId))
            || toCH(info?.ch) || toCH(baseAlloc?.ch);
        // Parte deste docente: componente compartilhada usa a CH declarada para
        // ele; docente unico responde pela CH toda.
        const compartilhada = docentesOferta.length > 1;
        const chDocente = compartilhada
            ? (toCH(declaredDocente?.ch) || toCH(segment?.ch))
            : curricularCH;

        const aulas = (Array.isArray(offerGroup?.allocationIds) ? offerGroup.allocationIds : [])
            .flatMap((id) => [...(aulasPorAlocacao.get(id)?.values() || [])])
            .sort((x, y) => x.date.localeCompare(y.date) || horarioToMinutes(x.horario) - horarioToMinutes(y.horario));
        const chAlocada = aulas.length;

        // Uma linha por faixa em que o docente tem aula, com o horario dela.
        const faixaRows = [];
        (Array.isArray(offerGroup?.faixas) ? offerGroup.faixas : []).forEach((faixa) => {
            const inicio = String(faixa?.inicio || '').trim();
            const fim = String(faixa?.fim || faixa?.inicio || '').trim();
            const aulasFaixa = aulas.filter((aula) => (!inicio || aula.date >= inicio) && (!fim || aula.date <= fim));
            if (!aulasFaixa.length) return;
            const diaNums = [...new Set(
                (Array.isArray(faixa?.dias) ? faixa.dias : [])
                    .map((d) => Number.parseInt(d, 10))
                    .filter((n) => Number.isFinite(n) && n >= 1)
            )].sort((x, y) => x - y);
            faixaRows.push({
                diasLabel: diaNums.map((n) => shortDayName(n)).join(', '),
                dataInicio: inicio,
                dataFim: fim,
                horarios: formatHorarioDasAulas(aulasFaixa)
            });
        });

        // Fallback (sem faixas com aula deste docente): usa o segmento do docente
        // e os dias derivados da grade horaria da oferta.
        if (faixaRows.length === 0) {
            const diaNums = [...new Set(
                (Array.isArray(offerGroup?.scheduleEntries) ? offerGroup.scheduleEntries : [])
                    .map((entry) => Number.parseInt(entry?.diaSemana, 10))
                    .filter((n) => Number.isFinite(n) && n >= 1)
            )].sort((x, y) => x - y);
            faixaRows.push({
                diasLabel: diaNums.map((n) => shortDayName(n)).join(', '),
                dataInicio: String(segment?.start || offerGroup?.start || start || '').trim(),
                dataFim: String(segment?.end || offerGroup?.end || end || '').trim(),
                horarios: formatHorarioDasAulas(aulas)
            });
        }

        faixaRows.sort((x, y) => String(x.dataInicio || '').localeCompare(String(y.dataInicio || '')));

        components.push({
            disciplina,
            codigo: String(info?.codigo || baseAlloc?.componenteCode || '').trim(),
            cor: baseAlloc?.cor || store.getDisciplinaColor(disciplina, getCursoSiglaDaTurma(turmaId)) || '#f39c12',
            turmaLabel: getTurmaLabel(turmaId, offerGroup?.subGrupo || baseAlloc?.subGrupo),
            curricularCH,
            compartilhada,
            chDocente,
            chAlocada,
            faixaRows,
            sortStart: faixaRows[0]?.dataInicio || String(offerGroup?.start || start || '').trim()
        });
    });

    components.sort((x, y) => {
        const startCmp = String(x.sortStart || '').localeCompare(String(y.sortStart || ''));
        if (startCmp !== 0) return startCmp;
        return String(x.disciplina || '').localeCompare(String(y.disciplina || ''), 'pt-BR', { sensitivity: 'base' });
    });
    return components;
}

function sumComponentsCH(components = []) {
    return {
        ch: components.reduce((sum, comp) => sum + toCH(comp.chDocente), 0),
        alocada: components.reduce((sum, comp) => sum + toCH(comp.chAlocada), 0)
    };
}

const COR_CH_OK = '#15803d';
const COR_CH_FALTA = '#c0392b';

// Verde quando o alocado bate com a parte do docente; vermelho quando nao.
function corDaAlocada(chDocente, chAlocada) {
    if (!toCH(chDocente)) return '#1f2937';
    return Math.abs(toCH(chAlocada) - toCH(chDocente)) > 0.01 ? COR_CH_FALTA : COR_CH_OK;
}

// CH do docente: "60" quando ele da a componente toda; "30/90" quando divide
// com outros (parte dele / CH da componente).
function formatCHDocente(comp) {
    if (!comp.compartilhada) return formatCH(comp.chDocente) || formatCH(comp.curricularCH) || '-';
    return `${formatCH(comp.chDocente) || '?'}/${formatCH(comp.curricularCH) || '?'}`;
}

// sections: [{ titulo?, components }]. Sem titulo (um so periodo) sai uma tabela
// so; com titulo (varios PLs) cada PL ganha um cabecalho e um subtotal, e a
// ultima linha (totalLabel) soma todos.
function buildDocenteResumeTableHtml(sections = [], totalLabel = 'Total', cabecalho = null) {
    const comTitulos = sections.some((section) => section.titulo);
    const COLS = 9;
    let numero = 0;
    sections.forEach((section) => section.components.forEach((comp) => { numero += 1; comp.numero = numero; }));

    // Nome do docente no alto da tabela (dentro dela, como legenda), para a
    // tabela poder ser enviada sozinha ao professor.
    const legenda = cabecalho?.docente
        ? `<caption style="caption-side: top; text-align: left; padding: 0 0 12px;">
                <div>
                    <div style="font-size: 17px; font-weight: 800; color: #0f4f7d;">Docente: ${escapeHtml(cabecalho.docente)}</div>
                    ${cabecalho.subtitulo ? `<div style="margin-top: 3px; font-size: 13px; font-weight: 600; color: #4b5563;">${escapeHtml(cabecalho.subtitulo)}</div>` : ''}
                </div>
           </caption>`
        : '';

    let tableHtml = `
        <table class="calendar-turma-resume-table" style="width: 100%; border-collapse: collapse; margin: 0 0 20px; font-size: 12px;">
            ${legenda}
            <thead>
                <tr style="background: #f5f5f5; border-top: 2px solid #2d34c6; border-bottom: 2px solid #333;">
                    <th style="padding: 8px 8px 16px 8px; text-align: left; border-right: 1px solid #ddd; width: 4%;">#</th>
                    <th style="padding: 8px 8px 16px 8px; text-align: left; border-right: 2px solid #2d34c6; width: 9%;">Código</th>
                    <th style="padding: 8px 8px 16px 8px; text-align: center; border-right: 1px solid #ddd; width: 8%; color: #2d34c6;" title="CH que cabe a este docente. Componente dividida com outros docentes: parte dele / CH da componente.">CH docente</th>
                    <th style="padding: 8px 8px 16px 8px; text-align: center; border-right: 2px solid #2d34c6; width: 8%; color: #2d34c6;" title="Horas já alocadas para este docente no calendário. Verde: bate com a CH docente. Vermelho: não bate.">CH alocada</th>
                    <th style="padding: 8px 8px 16px 8px; text-align: left; border-right: 1px solid #ddd; width: 21%;">Disciplina</th>
                    <th style="padding: 8px 8px 16px 8px; text-align: left; border-right: 1px solid #ddd; width: 11%;">Turma</th>
                    <th style="padding: 8px 8px 16px 8px; text-align: left; border-right: 1px solid #ddd; width: 11%;">Dia</th>
                    <th style="padding: 8px 8px 16px 8px; text-align: left; border-right: 1px solid #ddd; width: 15%;">Período</th>
                    <th style="padding: 8px 8px 16px 8px; text-align: left; width: 13%;">Horário</th>
                </tr>
            </thead>
            <tbody>
    `;

    const linhaSoma = (rotulo, soma, forte) => {
        const pad = forte ? '8px' : '6px 8px';
        const peso = forte ? 800 : 700;
        const borda = forte ? 'border-top: 2px solid #2d34c6; border-bottom: 2px solid #2d34c6;' : 'border-bottom: 1px solid #c7d2fe;';
        return `
                <tr style="background: #f8fafc; ${borda}">
                    <td colspan="2" style="padding: ${pad}; border-right: 1px solid #ddd; text-align: right; font-weight: ${peso}; color: #1e3a8a;">${escapeHtml(rotulo)}</td>
                    <td style="padding: ${pad}; text-align: center; border-right: 1px solid #ddd; font-weight: ${peso}; color: #1e3a8a;">${formatCH(soma.ch) || '0'}</td>
                    <td style="padding: ${pad}; text-align: center; border-right: 2px solid #2d34c6; font-weight: ${peso}; color: ${corDaAlocada(soma.ch, soma.alocada)};">${formatCH(soma.alocada) || '0'}</td>
                    <td colspan="${COLS - 4}" style="padding: ${pad};"></td>
                </tr>
            `;
    };

    sections.forEach((section) => {
        if (comTitulos) {
            tableHtml += `
                <tr class="docente-resumo-pl">
                    <td colspan="${COLS}" style="padding: 8px; background: #e3eef8; color: #0f4f7d; font-weight: 800; border-top: 2px solid #2d34c6;">${escapeHtml(section.titulo)}</td>
                </tr>
            `;
            if (!section.components.length) {
                tableHtml += `
                <tr style="border-bottom: 1px solid #ddd;">
                    <td colspan="${COLS}" style="padding: 8px; color: #6b7280; font-style: italic;">Nenhuma componente deste docente neste PL.</td>
                </tr>
            `;
            }
        }
        tableHtml += buildDocenteResumeRows(section.components);
        if (comTitulos && section.components.length) tableHtml += linhaSoma('Subtotal', sumComponentsCH(section.components), false);
    });

    tableHtml += linhaSoma(totalLabel, sumComponentsCH(sections.flatMap((section) => section.components)), true);
    tableHtml += `
            </tbody>
        </table>
    `;
    return tableHtml;
}

// Uma linha por faixa; numero, codigo, CHs, disciplina e turma so na primeira.
// Cada componente comeca com uma linha mais forte, para as faixas ficarem juntas.
function buildDocenteResumeRows(components = []) {
    let tableHtml = '';
    components.forEach((comp) => {
        const corAlocada = corDaAlocada(comp.chDocente, comp.chAlocada);
        comp.faixaRows.forEach((faixaRow, idx) => {
            const isFirst = idx === 0;
            const bordaTopo = isFirst ? 'border-top: 2px solid #94a3b8;' : '';
            const horarios = (faixaRow.horarios || []).map((h) => escapeHtml(h)).join('<br>') || '-';
            tableHtml += `
                <tr style="${bordaTopo} border-bottom: 1px solid #ddd; background-color: ${comp.cor}22;">
                    <td style="padding: 8px; border-right: 1px solid #ddd; font-weight: bold;">${isFirst ? comp.numero : ''}</td>
                    <td style="padding: 8px; border-right: 2px solid #2d34c6;">${isFirst ? escapeHtml(comp.codigo || '-') : ''}</td>
                    <td style="padding: 8px; text-align: center; border-right: 1px solid #ddd; font-weight: 700; color: #1f2937; white-space: nowrap;">${isFirst ? escapeHtml(formatCHDocente(comp)) : ''}</td>
                    <td style="padding: 8px; text-align: center; border-right: 2px solid #2d34c6; font-weight: 800; color: ${corAlocada};">${isFirst ? (formatCH(comp.chAlocada) || '0') : ''}</td>
                    <td style="padding: 8px; border-right: 1px solid #ddd; font-weight: 700; color: #333;">${isFirst ? escapeHtml(comp.disciplina) : ''}</td>
                    <td style="padding: 8px; border-right: 1px solid #ddd; color: #333;">${isFirst ? escapeHtml(comp.turmaLabel || '-') : ''}</td>
                    <td style="padding: 8px; border-right: 1px solid #ddd; color: #333;">${escapeHtml(faixaRow.diasLabel || '-')}</td>
                    <td style="padding: 8px; border-right: 1px solid #ddd; color: #4b5563;">${escapeHtml(formatPeriodo(faixaRow.dataInicio, faixaRow.dataFim))}</td>
                    <td style="padding: 8px; color: #1f2937; font-weight: 600;">${horarios}</td>
                </tr>
            `;
        });
    });
    return tableHtml;
}

export function generateCalendarGrid(container, turmaId, docenteName, start, end, titleHTML, options = {}) {
    container.innerHTML = '';

    const header = document.createElement('div');
    header.className = turmaId ? 'print-header-container' : 'print-only print-header-container';
    header.innerHTML = titleHTML;
    container.appendChild(header);

    // Docente com varios PLs (ex.: ano inteiro): a tabela (por PL) e os eventos ja chegam prontos.
    if (typeof options.resumeTableHtml === 'string') {
        if (options.resumeTableHtml) {
            const tableDiv = document.createElement('div');
            tableDiv.className = 'calendar-turma-resume-container';
            tableDiv.innerHTML = options.resumeTableHtml;
            container.appendChild(tableDiv);
        }
    } else if (turmaId) {
        // Adiciona tabela resumo de disciplinas para turmas
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

    const eventsByDate = options.eventsByDate || getCalendarEvents(turmaId, start, end, docenteName);
    // Fim do periodo letivo (dia depois dele fica vermelho). Com varios PLs cada
    // aula ja esta dentro do seu PL, entao o limite e o fim do intervalo.
    const termEndLimit = options.termEndLimit !== undefined ? options.termEndLimit : store.settings.termEnd;
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

            const isOutOfBounds = termEndLimit && dayData.date > termEndLimit;
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
                                    const conflictEntries = [...uniqueEventsInSlot];
                                    uniqueEventsInSlot.forEach((e) => (e.conflictPartners || []).forEach((p) => {
                                        if (!conflictEntries.some((c) => c.turmaId === p.turmaId && c.disciplina === p.disciplina)) conflictEntries.push(p);
                                    }));
                                    const conflictNames = conflictEntries.map((e) => `${getDisciplinaInfo(e.disciplina, e.turmaId).abrev} - ${e.turmaId}`).join(' <b style="color:#fff">x</b> ');
                                    content = `<span title="Choque: ${conflictNames.replace(/<[^>]+>/g, '')}">⚠️ ${conflictNames}</span>`;
                                } else {
                                    const event = uniqueEventsInSlot[0];
                                    const info = getDisciplinaInfo(event.disciplina, event.turmaId);
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
                                    const info = getDisciplinaInfo(event.disciplina, event.turmaId);
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
                        const info = getDisciplinaInfo(ev.disciplina, ev.turmaId);
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
