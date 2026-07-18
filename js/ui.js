import { store } from './store.js??v=20260625v';
import { getTurnoLetter, mapSlotToTurno, normalizeTurnoKey, getHorariosByTurno } from './turns.js';
import { normalizePeriodo as normalizePeriodoLetivoCode } from './plan_storage.js';
import { getCalendarEvents } from './calendar.js??v=20260625v';
import { countBusinessDays, countWeekdaysInPeriod, addBusinessDays, isDateOverlap, calculateEndDateByWeekday } from './utils.js';
import { weeklyState } from './weekly_state.js';
import { buildTeacherExecutionSnapshot, buildCanonicalOfferProjection } from './execution_engine.js';
import { renderBidimensionalTeacherGantt, renderBidimensionalTurmaGantt } from './gantt_bidimensional.js??v=20260627v39';
import { buildSigaaMetadataPayload, validateSigaaMetadataPayload } from './sigaa_metadata.js';
import { parseBackupDataFile, extractImportPlanMeta } from './serialization.js';
import {
    showToastWarning,
    showPersistentStatusMessage,
    copyTextToClipboard,
    flashButtonCopyState,
    setupCopyActionButtons
} from './ui_feedback.js';
import {
    normalizeHexColor,
    hexToRgb,
    adjustHexColor,
    hexToRgba,
    rgbToHsl,
    hslToRgb,
    vividHexColor
} from './color_utils.js';
import {
    getAllocationModo,
    isFaixaAllocation,
    isPriorityRegularAllocation,
    isRegularAllocation,
    isScheduledRegularAllocation,
    isPendingAllocation,
    normalizeTeacherNameForMatch,
    teacherNamesMatch,
    allocationHasTeacherMatch,
    getDocenteShortLabel,
    calculateTeacherTotalCH,
    getAllocationTeachersForConflict
} from './allocation_helpers.js';
import {
    normalizeConflictSlotLabel,
    normalizeTurnoOfertaKey,
    formatTurnoOfertaLabel,
    getAvailableTurnoOfertaOptions,
    resolveTurnoOfertaValue,
    getTurnoNormalizedFromLetter,
    getTurnoValueFromLetter,
    getShiftChangeLabel,
    getNativeTurnoValueForAllocation,
    cleanHorarioLabel,
    formatIntervaloLabel,
    isTurnoDividerSlot,
    buildHorariosForUI,
    getShiftChangeMeta,
    getCalendarShiftBadgeHTML
} from './turno_helpers.js';
import {
    getDisciplinaCHGlobal,
    derivarBloco,
    getTurmaSelectLabel,
    getTurmaLabel,
    getTurmaBaseLabel,
    getDisciplinaInfo,
    getPrintAcademicMetaLine
} from './curso_turma_helpers.js';
import {
    resolveTeacherShiftForSlot,
    getGanttTurnoConfigs,
    getGanttTurnoCode,
    renderGanttChart,
    renderTurmaGantt,
    printGanttLandscape
} from './gantt_ui.js';
import {
    renderMonthlyCalendar,
    renderTeacherCalendar
} from './calendarios_ui.js';
import {
    refreshTeacherConflictsUI
} from './conflitos_ui.js';
import {
    shouldIgnoreTurmaEventForCandidate,
    buildTurmaOccupiedSlotsByDate,
    normalizeDrawnSlotsByDay,
    normalizeFaixaEntry,
    getNormalizedIntensiveFaixas,
    getActiveFaixaForDate,
    getIntensiveSlotsForDate,
    computeIntensiveExecution,
    buildFaixaHoursSummaryFromExecution,
    getExecutionUsedDates,
    getExecutionSlotsForDate,
    buildSortedSlotSignature,
    getFaixaSlotsForDay,
    buildStoredExecutionSnapshot,
    buildComparableFaixasSignature,
    resolveEditableFaixasFromStoredExecution,
    alignFaixasToExecutionEnd,
    buildFinalAdjustmentFaixaSuggestion
} from './faixa_utils.js';
import {
    timeToMinutes,
    shortDayName,
    shiftISODate,
    isValidISODateValue,
    diffDaysISO,
    formatCompactFaixaDate,
    toISODate,
    addDaysISO,
    getWeekStartISO,
    formatDayMonthShort,
    isDateInsideRange,
    formatDateBRShortYear,
    formatDateBR
} from './date_utils_ui.js';
import {
    buildSigaaExportPayload,
    computeRemainingFractionalHours,

    findFirstDateWithAvailableSlot,
    filterExportableAllocations,
    generateAllocationOccurrences,
    initializeWeeklyScheduleForTurma,
    reconcileTurmaSelectionAfterPLChange,
    resetWeeklyViewOnTurmaChange,
    resolveActiveAcademicPeriod,
    validateOccurrenceWithinSemesterBounds
} from './academic_rules.mjs';

const gridContainer = document.getElementById('weekly-grid');
const selCurso = document.getElementById('sel-curso');
const selTurma = document.getElementById('sel-turma');
const listDisciplinas = document.getElementById('list-disciplinas');
const listDocentes = document.getElementById('list-docentes');

const selViewDocente = document.getElementById('sel-view-docente');

const inpTermStart = document.getElementById('term-start');
const inpTermEnd = document.getElementById('term-end');
const selTurnoOferta = document.getElementById('sel-turno_oferta') || document.getElementById('sel-turno-oferta');
const activePlanStatus = document.getElementById('active-plan-status');

const calStart = document.getElementById('cal-start');
const calEnd = document.getElementById('cal-end');
// Espelho do viewport na aba Calendario Docente (mesma janela de visualizacao,
// controles duplicados para a direcao ajustar o periodo direto na aba do docente).
const calStartTeacher = document.getElementById('cal-start-teacher');
const calEndTeacher = document.getElementById('cal-end-teacher');

const inputConfig = {
    disciplina: document.getElementById('inp-disciplina'),
    cor: document.getElementById('inp-color'),
    docente: document.getElementById('inp-docente'),
    fim: document.getElementById('inp-data-fim')
};

let tempImportData = null;
let tempImportPlanMeta = null;
let activeFaixaIndex = 1;
// faixasPatterns agora vive em weeklyState (storage centralizado). Alias LOCAL
// para o mesmo objeto — mutacoes in-place (faixasPatterns[i]=...) valem no
// weeklyState. Para limpar os 3, use weeklyState.clearFaixasPatterns().
const faixasPatterns = weeklyState.faixasPatterns;
// Estado da SESSAO DE EDICAO (editingDisciplinaDraft, editingImportadoDraft,
// editingOriginalAllocationIds, editingComponentOriginalStart,
// lastDisciplinaInputNormalized) foi migrado para o objeto `weeklyState`
// (js/weekly_state.js) — dono unico, com reset atomico. Acesse via
// weeklyState.<campo>. Ver resetEditingComponentState() logo abaixo.

// Wrapper fino: mantem o nome usado nos 3 caminhos de reset completo (troca de
// plano, reset da turma, pos-salvamento) e delega para o reset atomico do
// weeklyState. Se um novo campo de edicao surgir, adicione-o em
// weeklyState.resetEditing() e todos os caminhos ficam sincronizados.
function resetEditingComponentState() {
    weeklyState.resetEditing();
    clearWeeklyBlock();
}

let componentStartSelectionMode = 'auto';
// Faixa em modo de DESENHO (1|2|3) ou null. Antes era window.isDrawingFaixa
// (global exposto). Agora e modulo-privado — nada externo o le/escreve (blindado).
let drawingFaixaIndex = null;
let drawingViewMode = 'context';
const drawingDragState = {
    active: false,
    shouldSelect: true,
    touchedAnyCell: false
};

let chLimitWarningLockUntil = 0;
let pendingFaixaStartPick = null;
let pendingFaixaQuickActionConfirm = null;
let pendingWeeklyShiftDirection = 0;
let weeklyShiftAnimationFrame = 0;
let weeklyShiftAnimationTimer = 0;
const WEEKLY_SHIFT_ANIMATION_MS = 360;

// Estado de visualizacao da grade: alias LOCAL para weeklyState.view (storage
// centralizado). weeklyViewState.<campo> muta o mesmo objeto no weeklyState.
const weeklyViewState = weeklyState.view;

// ==========================================
// AJUSTES VISUAIS DA BARRA LATERAL (SIDEBAR)
// ==========================================
function applySidebarLayoutFixes() {
    if (!document.getElementById('iecos-layout-fixes')) {
        const style = document.createElement('style');
        style.id = 'iecos-layout-fixes';
        style.textContent = `
            /* Compactação Global da Sidebar */
            .sidebar .form-group { margin-bottom: 6px !important; }
            .sidebar h2, .sidebar h3, .sidebar h4 { margin-top: 4px !important; margin-bottom: 4px !important; }
            
            hr { 
                border: none !important; 
                border-top: 3px solid #95a5a6 !important; 
                margin: 8px 0 !important; 
            }
            .custom-thick-hr {
                border: none !important;
                border-top: 3px solid #95a5a6 !important;
                margin: 8px 0 !important;
                width: 100%;
            }
            .custom-thick-hr.space-above {
                margin: 8px 0 20px 0 !important;
                border-top: 3px solid #7f8c8d !important;
            }
        `;
        document.head.appendChild(style);
    }

    const allNodes = Array.from(document.querySelectorAll('*'));
    for (let el of allNodes) {

        // PERÍODO LETIVO (Aproxima do título superior)
        if (el.textContent && el.textContent.trim().toUpperCase() === 'PERÍODO LETIVO' && el.children.length === 0) {
            el.style.marginTop = '2px';
        }

        // OFERTA DE DISCIPLINA
        if (el.textContent && el.textContent.trim().toUpperCase() === 'OFERTA DE DISCIPLINA' && el.children.length === 0) {
            el.style.marginTop = '12px';
            el.style.marginBottom = '6px';

            if (!el.previousElementSibling || el.previousElementSibling.tagName !== 'HR') {
                const hr = document.createElement('hr');
                hr.className = 'custom-thick-hr space-above';
                el.parentNode.insertBefore(hr, el);
            } else {
                el.previousElementSibling.className = 'custom-thick-hr space-above';
            }
        }

        // GERENCIANDO ARQUIVOS
        if (el.textContent && el.textContent.trim().toUpperCase() === 'GERENCIANDO ARQUIVOS' && el.children.length === 0) {
            el.style.marginTop = '12px';
            el.style.marginBottom = '6px';

            if (!el.previousElementSibling || el.previousElementSibling.tagName !== 'HR') {
                const hr = document.createElement('hr');
                hr.className = 'custom-thick-hr space-above';
                el.parentNode.insertBefore(hr, el);
            } else {
                el.previousElementSibling.className = 'custom-thick-hr space-above';
            }
        }
    }

    // Remove espaçamento inútil após o seletor de turno
    const selTurno = document.getElementById('sel-turno_oferta') || document.getElementById('sel-turno-oferta');
    if (selTurno) {
        const formGroup = selTurno.closest('div');
        if (formGroup) formGroup.style.marginBottom = '2px';
    }

    // Tira os espaços brancos (<br>) depois do botão Adicionar Intensiva
    const btnAddIntensiva = document.getElementById('btn-add-oferta');
    if (btnAddIntensiva && btnAddIntensiva.closest('.sidebar')) {
        btnAddIntensiva.style.marginBottom = '2px';
        let next = btnAddIntensiva.nextSibling;
        while (next && (next.tagName === 'BR' || (next.nodeType === 3 && next.textContent.trim() === ''))) {
            const toRemove = next;
            next = next.nextSibling;
            toRemove.remove();
        }
    }
}

// ==========================================
// EMBALAGEM SEGURA PARA O REFRESH DO PROFESSOR E GANTT
// ==========================================
function wrapTeacherSelect() {
    if (selViewDocente && !document.getElementById('btn-refresh-teacher')) {
        const wrapper = document.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.alignItems = 'center';
        wrapper.style.gap = '8px';
        wrapper.style.width = '100%';

        const selectContainer = document.createElement('div');
        selectContainer.style.position = 'relative';
        selectContainer.style.flex = '1';

        selViewDocente.parentNode.insertBefore(wrapper, selViewDocente);
        wrapper.appendChild(selectContainer);
        selectContainer.appendChild(selViewDocente);
        selViewDocente.style.width = '100%';
        selViewDocente.style.boxSizing = 'border-box';
        selViewDocente.style.margin = '0';

        const btnRefresh = document.createElement('button');
        btnRefresh.id = 'btn-refresh-teacher';
        btnRefresh.innerHTML = '🔄';
        btnRefresh.title = 'Atualizar vistoria deste professor';
        btnRefresh.style.background = '#3498db';
        btnRefresh.style.color = '#fff';
        btnRefresh.style.border = 'none';
        btnRefresh.style.borderRadius = '4px';
        btnRefresh.style.padding = '6px 10px';
        btnRefresh.style.cursor = 'pointer';
        btnRefresh.style.fontSize = '1.1em';
        btnRefresh.style.transition = 'transform 0.3s ease, background 0.2s';
        btnRefresh.style.flexShrink = '0';

        btnRefresh.onmouseover = () => btnRefresh.style.background = '#2980b9';
        btnRefresh.onmouseout = () => btnRefresh.style.background = '#3498db';

        wrapper.appendChild(btnRefresh);

        btnRefresh.addEventListener('click', (e) => {
            e.preventDefault();
            if (selViewDocente.value) {
                renderTeacherCalendar();
                btnRefresh.style.transform = `rotate(${btnRefresh.dataset.rot || 360}deg)`;
                btnRefresh.dataset.rot = parseInt(btnRefresh.dataset.rot || 360) + 360;
            } else {
                showToastWarning('Selecione um professor primeiro para atualizar a vistoria.', 'warning', 2200);
            }
        });
    }
}

function setupClearButtonsSidebar() {
    addClearXToField(inputConfig.disciplina, 'inp-disciplina');
    addClearXToField(inputConfig.docente, 'inp-docente');
    if (selViewDocente) {
        addClearXToField(selViewDocente, 'sel-view-docente');
    }
}

function addClearXToField(inputEl, inputId) {
    if (!inputEl) return;
    const existing = document.querySelector(`[data-clear-for="${inputId}"]`);
    if (existing) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '×';
    btn.title = 'Limpar';
    btn.dataset.clearFor = inputId;
    btn.style.border = 'none';
    btn.style.background = 'transparent';
    btn.style.cursor = 'pointer';
    btn.style.fontSize = '24px';
    btn.style.fontWeight = 'bold';
    btn.style.lineHeight = '1';
    btn.style.padding = '0';
    btn.style.margin = '0';
    btn.style.color = '#c0392b';
    btn.style.opacity = '0.9';
    btn.style.zIndex = '10';

    const toggleVisibility = () => {
        const hasValue = String(inputEl.value || '').trim().length > 0;
        btn.style.display = hasValue ? 'block' : 'none';
    };

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        inputEl.value = '';
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        inputEl.focus();
        toggleVisibility();
    });

    inputEl.addEventListener('input', toggleVisibility);
    inputEl.addEventListener('change', toggleVisibility);

    const parent = inputEl.parentElement;
    if (parent) {
        const parentStyle = window.getComputedStyle(parent);
        if (parentStyle.position === 'static') {
            parent.style.position = 'relative';
        }
        btn.style.position = 'absolute';
        btn.style.right = '8px'; // Distância segura e padronizada da borda
        btn.style.top = '50%'; // Centraliza perfeitamente no eixo Y
        btn.style.transform = 'translateY(-50%)';

        const currentPadding = parseInt(window.getComputedStyle(inputEl).paddingRight || '0', 10);
        if (currentPadding < 30) {
            inputEl.style.paddingRight = '35px';
        }
        parent.appendChild(btn);
    }
    toggleVisibility();
}

function applyWeeklyGridRowHeightScale() {
    if (!gridContainer) return;

    if (!window.__weeklyGridRowHeightResizeBound) {
        window.__weeklyGridRowHeightResizeBound = true;
        window.addEventListener('resize', () => {
            if (!store.selectedTurma) return;
            applyWeeklyGridRowHeightScale();
        });
    }

    requestAnimationFrame(() => {
        const styleId = 'weekly-grid-rowheight-style';
        let styleEl = document.getElementById(styleId);

        const horariosCount = buildHorariosForUI().length;
        const rowCount = Math.max(2, horariosCount + 1);

        const viewportH = window.innerHeight || document.documentElement.clientHeight || 900;
        const rect = gridContainer.getBoundingClientRect();
        const reserveBottom = 22;
        const available = Math.max(220, viewportH - rect.top - reserveBottom);

        const isCompactScreen = window.innerWidth < 900;
        const minH = isCompactScreen ? 32 : 38;
        const maxH = isCompactScreen ? 46 : 58;
        const ideal = Math.round(available / rowCount);
        const uniformH = Math.max(minH, Math.min(maxH, ideal));

        const intervaloH = Math.max(isCompactScreen ? 15 : 16, Math.round(uniformH * 0.42));

        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = styleId;
            document.head.appendChild(styleEl);
        }

        styleEl.textContent = `
          #weekly-grid .slot,
          #weekly-grid .header.time,
          #weekly-grid .header.top-header {
            height: ${uniformH}px !important;
            min-height: ${uniformH}px !important;
            max-height: ${uniformH}px !important;
            box-sizing: border-box !important;
          }
          #weekly-grid .header.interval-time,
          #weekly-grid .header.interval-merge {
            height: ${intervaloH}px !important;
            min-height: ${intervaloH}px !important;
            max-height: ${intervaloH}px !important;
            box-sizing: border-box !important;
          }
          #weekly-grid .header.interval-time {
            font-size: 0.66em !important;
            line-height: 1.05 !important;
            padding-top: 2px !important;
            padding-bottom: 2px !important;
          }
          #weekly-grid .slot { overflow: hidden !important; }
        `;
    });
}

function setupMultiDocenteUI() {
    const chk = document.getElementById('chk-multi-docente');
    const containerSingle = document.getElementById('container-single-docente');
    const containerMulti = document.getElementById('container-multi-docente');
    const btnAddRow = document.getElementById('btn-add-docente-row');

    if (containerMulti.querySelector('.teacher-row') === null) {
        addTeacherRow();
    }

    chk.addEventListener('change', () => {
        if (chk.checked) {
            containerSingle.classList.add('hidden');
            containerMulti.classList.remove('hidden');
        } else {
            containerSingle.classList.remove('hidden');
            containerMulti.classList.add('hidden');
        }
    });

    btnAddRow.addEventListener('click', () => {
        const rows = containerMulti.querySelectorAll('.teacher-row');
        if (rows.length >= 4) {
            showToastWarning('Máximo de 4 professores permitidos.', 'warning', 2200);
            return;
        }
        addTeacherRow();
    });
}

function addTeacherRow(nome = '', ch = '') {
    const list = document.getElementById('multi-docente-list');
    const div = document.createElement('div');
    div.className = 'teacher-row';

    div.innerHTML = `
        <input type="text" class="inp-multi-name" list="list-docentes" placeholder="Nome" value="${nome}">
        <input type="number" class="inp-multi-ch" placeholder="CH" min="1" value="${ch}">
        <button type="button" class="btn-remove-row" title="Remover">×</button>
    `;

    div.querySelector('.btn-remove-row').onclick = () => {
        if (list.querySelectorAll('.teacher-row').length > 1) {
            div.remove();
            updateTotalCHDisplay();
        } else {
            div.querySelector('.inp-multi-name').value = '';
            div.querySelector('.inp-multi-ch').value = '';
            updateTotalCHDisplay();
        }
    };

    div.querySelector('.inp-multi-ch').addEventListener('input', updateTotalCHDisplay);
    list.appendChild(div);
}

function updateTotalCHDisplay() {
    const inputs = document.querySelectorAll('.inp-multi-ch');
    let total = 0;
    inputs.forEach(inp => total += parseInt(inp.value || 0));
    document.getElementById('total-ch-display').textContent = `Total: ${total}h`;
}

function getDocenteData() {
    const isMulti = document.getElementById('chk-multi-docente').checked;

    if (!isMulti) {
        const nome = inputConfig.docente.value.trim();
        return {
            mode: 'single',
            isValid: !!nome,
            docente: nome,
            docentesList: null
        };
    } else {
        const rows = document.querySelectorAll('.teacher-row');
        const list = [];
        let totalCH = 0;

        rows.forEach(r => {
            const nome = r.querySelector('.inp-multi-name').value.trim();
            const ch = parseInt(r.querySelector('.inp-multi-ch').value || 0);
            if (nome && ch > 0) {
                list.push({ nome, ch });
                totalCH += ch;
            }
        });

        if (list.length === 0) return { isValid: false };

        const nomeComposto = list.map(d => d.nome.split(' ')[0]).join(' / ');

        return {
            mode: 'multi',
            isValid: true,
            docente: nomeComposto + ' (Múltiplos)',
            docentesList: list,
            totalCH: totalCH
        };
    }
}

function normalizeFaixaPattern(pattern) {
    if (!Array.isArray(pattern)) return [];
    return pattern
        .map((entry) => {
            if (typeof entry === 'string') {
                const idx = entry.indexOf('-');
                if (idx <= 0) return null;
                return {
                    dia: parseInt(entry.slice(0, idx), 10),
                    slot: entry.slice(idx + 1)
                };
            }
            if (entry && typeof entry === 'object') {
                const dia = parseInt(entry.dia, 10);
                const slot = entry.slot || entry.horario;
                if (Number.isNaN(dia) || !slot) return null;
                return { dia, slot };
            }
            return null;
        })
        .filter((x) => x && x.dia >= 1 && x.dia <= 6 && typeof x.slot === 'string');
}

function getFaixaSlotsAndDays(faixaIndex = 1) {
    const pattern = normalizeFaixaPattern(faixasPatterns[faixaIndex]);
    const slots = [...new Set(pattern.map((p) => p.slot))].sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
    const dias = [...new Set(pattern.map((p) => p.dia))].sort((a, b) => a - b);
    return { slots, dias, pattern };
}

function buildEffectiveFaixaPatternMap(overrideFaixaIndex = null, overridePattern = null) {
    const map = {};

    for (let i = 1; i <= 3; i++) {
        const pattern = (i === overrideFaixaIndex)
            ? normalizeFaixaPattern(overridePattern)
            : normalizeFaixaPattern(faixasPatterns[i]);

        map[i] = pattern;
    }

    return map;
}

function setFaixaStatus(faixaIndex, count) {
    const status = document.getElementById(`status-draw-f${faixaIndex}`);
    const effectivePatterns = buildEffectiveFaixaPatternMap();
    const slotCount = (effectivePatterns[faixaIndex] || []).length || count || 0;
    const preview = buildWeeklyFaixaExecutionPreview();
    if (status) {
        const summary = buildFaixaSummaryText(faixaIndex, slotCount, preview);
        status.textContent = summary;
        status.style.color = '#27ae60';
    }
    updateWeeklyFaixaHoursDisplay(preview);
}

function updateWeeklyFaixaHoursDisplay(previewData = null) {
    const preview = previewData || buildWeeklyFaixaExecutionPreview();
    const summaryHoursByFaixa = new Map(
        Array.isArray(preview?.summary)
            ? preview.summary.map((item) => [parseInt(item.faixa, 10), parseInt(item.horas, 10) || 0])
            : []
    );
    let total = preview?.execution ? (parseInt(preview.execution.totalHours, 10) || 0) : 0;
    for (let i = 1; i <= 3; i++) {
        const ch = summaryHoursByFaixa.has(i) ? summaryHoursByFaixa.get(i) : calcFaixaCH(i);
        const chEl = document.getElementById(`faixa-ch-f${i}`);
        if (chEl) chEl.textContent = String(ch);
        if (!preview?.execution) total += ch;
    }
    const totalEl = document.getElementById('weekly-faixa-total-ch');
    if (totalEl) totalEl.textContent = String(total);

    const disciplina = preview?.disciplina || getWeeklyFaixasTitleDisciplinaAtiva();
    const targetCH = parseInt(preview?.targetCH, 10) || 0;
    const targetEl = document.getElementById('weekly-faixa-target-ch');
    if (targetEl) targetEl.textContent = targetCH > 0 ? String(targetCH) : '-';
    const remainingWrapEl = document.getElementById('weekly-faixa-remaining-wrap');
    const remainingEl = document.getElementById('weekly-faixa-remaining-ch');
    if (remainingWrapEl && remainingEl) {
        remainingWrapEl.classList.remove('state-under', 'state-ok', 'state-over');
        if (targetCH > 0) {
            const remaining = targetCH - total;
            remainingEl.textContent = String(remaining);
            if (remaining > 0) remainingWrapEl.classList.add('state-under');
            else if (remaining < 0) remainingWrapEl.classList.add('state-over');
            else remainingWrapEl.classList.add('state-ok');
            remainingWrapEl.classList.remove('hidden');
        } else {
            remainingEl.textContent = '-';
            remainingWrapEl.classList.add('hidden');
        }
    }

    const consistencyEl = document.getElementById('weekly-faixa-consistency');
    if (!consistencyEl) return;

    const setConsistency = (text, state = '') => {
        consistencyEl.textContent = text;
        consistencyEl.classList.remove('state-ok', 'state-warn', 'state-error');
        if (state) consistencyEl.classList.add(state);
    };

    if (!disciplina) {
        setConsistency('Selecione uma componente para validar a CH.');
        return;
    }

    if (targetCH <= 0) {
        setConsistency('Componente sem CH cadastrada.', 'state-error');
        return;
    }

    if (preview?.error) {
        setConsistency(preview.error, 'state-warn');
        return;
    }

    if (total === targetCH && total > 0) {
        setConsistency('CH consistente com a meta da componente.', 'state-ok');
        return;
    }

    if (total === 0) {
        if (preview?.execution && preview.execution.totalHours === targetCH && preview.execution.dataFim) {
            setConsistency(`Padrao pronto. Fim previsto: ${formatDateBR(preview.execution.dataFim)}.`, 'state-ok');
        } else {
            setConsistency('Defina datas e marque slots para calcular a CH.', 'state-warn');
        }
        return;
    }

    if (total < targetCH) {
        const faltam = targetCH - total;
        setConsistency(`Faltam ${faltam}h para atingir a meta.`, 'state-warn');
        return;
    }

    const excede = total - targetCH;
    setConsistency(`A CH alocada excede a meta em ${excede}h. Isso nao bloqueia a insercao; se quiser, ajuste o padrao ou crie uma nova faixa depois.`, 'state-warn');
}
function calcFaixaCHFromPattern(faixaIndex, patternInput) {
    const start = document.getElementById(`inp-data-inicio-f${faixaIndex}`)?.value || '';
    const endRaw = document.getElementById(`inp-data-fim-f${faixaIndex}`)?.value || '';
    const nextStart = document.getElementById(`inp-data-inicio-f${faixaIndex + 1}`)?.value || '';
    let end = endRaw || '';
    if (!end && nextStart) end = shiftISODate(nextStart, -1);
    if (!start || !end) return 0;

    const pattern = normalizeFaixaPattern(patternInput);
    if (pattern.length === 0) return 0;

    const slotsByDay = {};
    pattern.forEach((p) => {
        if (!slotsByDay[p.dia]) slotsByDay[p.dia] = new Set();
        slotsByDay[p.dia].add(p.slot);
    });

    const feriadosSet = new Set((store.rawData?.feriados || []).map((f) => f.data || f));
    let total = 0;
    const cursor = new Date(`${start}T12:00:00`);
    const maxDate = new Date(`${end}T12:00:00`);

    while (cursor <= maxDate) {
        const dStr = cursor.toISOString().split('T')[0];
        const dow = cursor.getDay();
        if (dow >= 1 && dow <= 6 && !feriadosSet.has(dStr) && slotsByDay[dow]) {
            total += slotsByDay[dow].size;
        }
        cursor.setDate(cursor.getDate() + 1);
    }
    return total;
}

function calcFaixaCH(faixaIndex) {
    const patterns = buildEffectiveFaixaPatternMap();
    const pattern = patterns[faixaIndex] || [];
    return calcFaixaCHFromPattern(faixaIndex, pattern);
}

function calcTotalConfiguredCHWithOverride(faixaIndex, overridePattern) {
    const preview = buildWeeklyFaixaExecutionPreview({ overrideFaixaIndex: faixaIndex, overridePattern });
    if (preview.execution) return parseInt(preview.execution.totalHours, 10) || 0;

    const patterns = buildEffectiveFaixaPatternMap(faixaIndex, overridePattern);
    let total = 0;
    for (let i = 1; i <= 3; i++) {
        total += calcFaixaCHFromPattern(i, patterns[i] || []);
    }
    return total;
}

function getDisciplinaTargetCHForDrawing() {
    const disciplina = normalizeDisciplinaInputValue(inputConfig.disciplina?.value || '');
    if (!disciplina) return 0;
    const info = getDisciplinaInfo(disciplina);
    return parseInt(info?.ch, 10) || 0;
}

function buildWeeklyFaixaExecutionPreview(options = {}) {
    const { overrideFaixaIndex = null, overridePattern = null } = options || {};
    const disciplina = getWeeklyFaixasTitleDisciplinaAtiva();
    const targetCH = getDisciplinaTargetCHForDrawing();
    const fallbackInicio = document.getElementById('inp-data-inicio-f1')?.value
        || getPreferredStartDateForCurrentTurma()
        || '';

    const preview = {
        disciplina,
        targetCH,
        faixas: [],
        execution: null,
        summary: [],
        error: ''
    };

    if (!disciplina || targetCH <= 0) return preview;

    try {
        const patterns = buildEffectiveFaixaPatternMap(overrideFaixaIndex, overridePattern);
        const faixas = collectIntensiveFaixasFromPatternMap(patterns, fallbackInicio);
        preview.faixas = faixas;
        if (faixas.length === 0) return preview;

        const diasMarcados = [...new Set(faixas.flatMap((f) => f.dias || []))].sort((a, b) => a - b);
        const subGrupo = (document.getElementById('inp-sub-turma')?.value ?? '').trim();
        const execution = computeIntensiveExecution({
            turmaId: store.selectedTurma,
            disciplina,
            subGrupo: subGrupo || null,
            modo: 'faixas',
            ch: targetCH,
            dataInicio: faixas[0].inicio,
            dataFim: faixas[0].inicio,
            horariosOcupados: [],
            diasMarcados,
            usaSabado: diasMarcados.includes(6),
            faixas
        }, { respectPriority: true, respectTurmaOccupancy: true });

        preview.execution = execution;
        preview.summary = buildFaixaHoursSummaryFromExecution(faixas, execution.byDate);
        return preview;
    } catch (err) {
        preview.error = err?.message || 'Defina datas e marque slots para calcular a CH.';
        return preview;
    }
}

function canSelectSlotWithoutExceedingTarget(faixaIndex, candidatePattern) {
    const targetCH = getDisciplinaTargetCHForDrawing();
    if (targetCH <= 0) return { allowed: true, targetCH: 0, projectedCH: 0, exceededBy: 0 };

    const projectedCH = calcTotalConfiguredCHWithOverride(faixaIndex, candidatePattern);
    const exceededBy = projectedCH - targetCH;
    return {
        allowed: exceededBy <= 0,
        targetCH,
        projectedCH,
        exceededBy
    };
}

function warnCHLimitReached(limit) {
    const now = Date.now();
    if (now < chLimitWarningLockUntil) return;
    chLimitWarningLockUntil = now + 1200;

    if (limit.exceededBy > 0) {
        showToastWarning(
            `Limite de CH atingido: meta ${limit.targetCH}h. Esta marcacao levaria para ${limit.projectedCH}h (+${limit.exceededBy}h).`,
            'warning',
            2800
        );
        return;
    }

    showToastWarning(`Meta de CH (${limit.targetCH}h) ja atingida para a componente.`, 'warning', 2400);
}

function refreshPendingFaixaStartPickUI() {
    for (let i = 1; i <= 3; i++) {
        const row = document.getElementById(`faixa-${i}`);
        const numCell = row ? row.querySelector('.faixa-num') : null;
        if (!row || !numCell) continue;

        const selectable = i === 2 || i === 3;
        const waiting = pendingFaixaStartPick === i;
        numCell.classList.toggle('faixa-num-start-pick', selectable);
        row.classList.toggle('faixa-start-pick-waiting', waiting);

        if (selectable) {
            numCell.title = waiting
                ? `Aguardando clique na grade para definir inicio da Faixa ${i}.`
                : `Clique para definir o inicio da Faixa ${i} pela grade de alocacao.`;
        } else {
            numCell.title = '';
        }
    }
}

function clearPendingFaixaStartPick() {
    if (!pendingFaixaStartPick) return;
    pendingFaixaStartPick = null;
    refreshPendingFaixaStartPickUI();
    updateWeeklyContextNote();
}

function refreshActiveFaixaHighlight() {
    const activeIdx = drawingFaixaIndex
        ? parseInt(drawingFaixaIndex, 10)
        : (parseInt(activeFaixaIndex, 10) || null);
    for (let i = 1; i <= 3; i++) {
        const row = document.getElementById(`faixa-${i}`);
        const numCell = row ? row.querySelector('.faixa-num') : null;
        if (!numCell) continue;
        numCell.classList.toggle('faixa-num-active', activeIdx === i);
    }
}

function setPendingFaixaStartPick(faixaIndex, options = {}) {
    const { quiet = false } = options;
    const idx = parseInt(faixaIndex, 10);
    if (Number.isNaN(idx) || idx < 2 || idx > 3) return false;

    const f1Ini = document.getElementById('inp-data-inicio-f1')?.value || '';
    const f2Ini = document.getElementById('inp-data-inicio-f2')?.value || '';

    if (idx === 2 && !f1Ini) {
        showToastWarning('Defina primeiro o inicio da Faixa 1.', 'warning', 2200);
        return false;
    }

    if (idx === 3 && !f2Ini) {
        showToastWarning('Defina primeiro o inicio da Faixa 2.', 'warning', 2200);
        return false;
    }

    pendingFaixaStartPick = idx;
    activeFaixaIndex = idx;
    activateDrawingMode(idx, {
        silent: true,
        jumpToFaixaStart: false,
        switchToWeekly: true,
        showToolbar: false
    });

    refreshPendingFaixaStartPickUI();
    updateWeeklyContextNote();

    if (!quiet) {
        showToastWarning(`Clique em um slot da grade para definir o inicio da Faixa ${idx}.`, 'warning', 2500);
    }

    return true;
}

function applyPendingFaixaStartByDate(dateStr) {
    const idx = parseInt(pendingFaixaStartPick, 10);
    if (Number.isNaN(idx) || idx < 2 || idx > 3) return false;

    const applied = syncFaixaStartFromGridClick(idx, dateStr, [], { force: true });
    if (!applied) return false;

    clearPendingFaixaStartPick();
    activeFaixaIndex = idx;
    autoEnterWeeklyEditingForFaixa(idx);
    showToastWarning(`Inicio da Faixa ${idx} definido em ${formatDateBR(dateStr)}. A nova faixa passa a substituir a anterior a partir desta data.`, 'success', 2800);
    return true;
}

function syncFaixaStartFromGridClick(faixaIndex, cellDate, currentPattern = [], options = {}) {
    const { force = false } = options;
    const idx = parseInt(faixaIndex, 10);
    if (Number.isNaN(idx) || idx < 1 || idx > 3) return false;

    const dateStr = String(cellDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;

    if (idx === 2 && !document.getElementById('inp-data-inicio-f1')?.value) {
        showToastWarning('Defina primeiro o inicio da Faixa 1.', 'warning', 2200);
        return false;
    }
    if (idx === 3 && !document.getElementById('inp-data-inicio-f2')?.value) {
        showToastWarning('Defina primeiro o inicio da Faixa 2.', 'warning', 2200);
        return false;
    }

    const iniEl = document.getElementById(`inp-data-inicio-f${idx}`);
    if (!iniEl) return false;

    if (idx === 1) {
        // Para a Faixa 1, o clique na grade escolhe slots, mas não deve empurrar
        // o início oficial para depois do primeiro dia do período letivo.
        const lockedStart = String(iniEl.value || getCanonicalFirstFaixaStartDate() || '').trim();
        const resolvedStart = lockedStart || dateStr;
        if (!resolvedStart) return false;
        if ((iniEl.value || '').trim() === resolvedStart) return false;

        iniEl.value = resolvedStart;
        if (store.selectedTurma) store.setTurmaLastStart(store.selectedTurma, resolvedStart);

        applyFaixaDateAutofill({ forceSingleBounds: true, preferredStart: resolvedStart });
        setFaixaStatus(1, getFaixaSlotsAndDays(1).pattern.length);
        setFaixaStatus(2, getFaixaSlotsAndDays(2).pattern.length);
        setFaixaStatus(3, getFaixaSlotsAndDays(3).pattern.length);
        refreshPendingFaixaStartPickUI();
        updateWeeklyFaixaHoursDisplay();
        updateWeeklyNavigatorLabel();
        renderOfertasList();
        return true;
    }

    const validation = getFaixaStartDateValidation(idx, dateStr);
    if (!validation.isValid) {
        showToastWarning(validation.message, 'warning', 2600);
        return false;
    }

    const persistedCount = normalizeFaixaPattern(faixasPatterns[idx]).length;
    const currentCount = normalizeFaixaPattern(currentPattern).length;
    const firstMarking = persistedCount === 0 && currentCount === 0;

    if (!force && !firstMarking && iniEl.value) return false;
    if ((iniEl.value || '').trim() === dateStr) return false;

    iniEl.value = dateStr;
    if (idx === 1 && store.selectedTurma) store.setTurmaLastStart(store.selectedTurma, dateStr);

    applyFaixaDateAutofill();
    setFaixaStatus(1, getFaixaSlotsAndDays(1).pattern.length);
    setFaixaStatus(2, getFaixaSlotsAndDays(2).pattern.length);
    setFaixaStatus(3, getFaixaSlotsAndDays(3).pattern.length);
    refreshPendingFaixaStartPickUI();
    updateWeeklyFaixaHoursDisplay();
    updateWeeklyNavigatorLabel();
    renderOfertasList();
    return true;
}

function tryApplyDrawingSelection(cell, shouldSelect, styles) {
    if (!cell) return false;

    if (!shouldSelect) {
        setDrawingCellSelection(cell, false, styles);
        return true;
    }

    if (cell.classList.contains('selected-slot')) return true;

    const faixaIndex = parseInt(drawingFaixaIndex, 10);
    if (Number.isNaN(faixaIndex) || faixaIndex < 1 || faixaIndex > 3) {
        setDrawingCellSelection(cell, true, styles);
        return true;
    }

    const dia = parseInt(cell.dataset.dia, 10);
    const slot = String(cell.dataset.horario || '');
    if (Number.isNaN(dia) || !slot) return false;

    const currentPattern = getDrawingSelectionFromDOM();
    syncFaixaStartFromGridClick(faixaIndex, cell.dataset.date, currentPattern);
    if (currentPattern.some((p) => p.dia === dia && p.slot === slot)) return true;

    const candidatePattern = normalizeFaixaPattern([...currentPattern, { dia, slot }]);
    const limit = canSelectSlotWithoutExceedingTarget(faixaIndex, candidatePattern);
    if (!limit.allowed) {
        warnCHLimitReached(limit);
        return false;
    }

    setDrawingCellSelection(cell, true, styles);
    return true;
}
function buildFaixaSummaryText(faixaIndex, count, previewData = null) {
    const start = document.getElementById(`inp-data-inicio-f${faixaIndex}`)?.value || '';
    const end = document.getElementById(`inp-data-fim-f${faixaIndex}`)?.value || '';
    const preview = previewData || buildWeeklyFaixaExecutionPreview();
    const summaryEntry = Array.isArray(preview?.summary)
        ? preview.summary.find((item) => parseInt(item.faixa, 10) === faixaIndex)
        : null;
    const ch = summaryEntry ? (parseInt(summaryEntry.horas, 10) || 0) : calcFaixaCH(faixaIndex);
    if (!start) return 'Aguardando inicio';
    const endTxt = end ? formatDateBR(end) : 'fim automatico';
    return `${count} slots | ${formatDateBR(start)} a ${endTxt} | ${ch}h`;
}

function getDrawingBaseColor() {
    const disciplina = (inputConfig.disciplina?.value ?? '').replace(/\s*\(\s*\d+\s*h\s*\)\s*$/i, '').trim();
    const fallbackColor = normalizeHexColor(disciplina ? store.getDisciplinaColor(disciplina) : '#f39c12');
    return normalizeHexColor(inputConfig.cor?.value, fallbackColor);
}

function getWeeklyFaixasTitleDisciplinaAtiva() {
    const selected = normalizeDisciplinaInputValue(inputConfig.disciplina?.value || '');
    if (selected) return selected;

    const editing = normalizeDisciplinaInputValue(weeklyState.editingDisciplinaDraft || '');
    if (editing) return editing;

    return '';
}

function updateWeeklyFaixasTitleDisciplina() {
    const prefixEl = document.getElementById('weekly-faixas-title-prefix');
    const discEl = document.getElementById('weekly-faixas-title-disc');
    if (!prefixEl || !discEl) return;

    const disciplina = getWeeklyFaixasTitleDisciplinaAtiva();
    if (!disciplina) {
        prefixEl.textContent = 'Datas e CH das Faixas da Componente';
        discEl.textContent = '';
        discEl.classList.add('hidden');
        return;
    }

    prefixEl.textContent = 'Datas e CH das Faixas de';
    discEl.textContent = disciplina.toLocaleUpperCase('pt-BR');
    discEl.classList.remove('hidden');
}

function getDrawingSelectedStyles() {
    const base = vividHexColor(getDrawingBaseColor());
    return {
        background: base,
        border: `2px dashed ${adjustHexColor(base, -45)}`,
        color: '#fff',
        fontWeight: 'bold'
    };
}

function applyDrawingToolbarTheme() {
    const toolbar = document.getElementById('drawing-toolbar');
    if (!toolbar) return;
    const base = getDrawingBaseColor();
    const light = adjustHexColor(base, 24);
    const border = adjustHexColor(base, -22);
    toolbar.style.background = `linear-gradient(135deg, ${light}, ${base})`;
    toolbar.style.boxShadow = `0 4px 15px ${hexToRgba(base, 0.4)}`;
    toolbar.style.border = `2px solid ${border}`;
}

function updateDrawingViewToggleButton() {
    const btn = document.getElementById('btn-toggle-draw-view');
    if (!btn) return;
    if (drawingViewMode === 'clean') {
        btn.textContent = 'Mostrar Contexto';
        btn.style.background = '#16a085';
    } else {
        btn.textContent = 'Modo Limpo';
        btn.style.background = '#2c3e50';
    }
}

function setDrawingCellSelection(cell, selected, styles) {
    if (!cell) return;
    if (selected) {
        cell.classList.add('selected-slot');
        cell.classList.remove('slot-free-draw');
        // O background precisa de !important inline para vencer a regra de tint
        // por turno (.timetable .slot.turno-* { background-color: ... !important }),
        // senao a celula pintada fica com a cor do turno e so a borda aparece colorida.
        cell.style.setProperty('background', styles.background, 'important');
        cell.style.border = styles.border;
        cell.style.color = styles.color;
        cell.style.fontWeight = styles.fontWeight;
    } else {
        cell.classList.remove('selected-slot');
        if (cell.dataset.canEdit === '1') cell.classList.add('slot-free-draw');
        cell.style.removeProperty('background');
        cell.style.border = '';
        cell.style.color = '';
        cell.style.fontWeight = '';
    }
}

function endDrawingDrag() {
    const shouldPersist = !!drawingFaixaIndex && drawingDragState.active && drawingDragState.touchedAnyCell;
    drawingDragState.active = false;
    drawingDragState.shouldSelect = true;
    drawingDragState.touchedAnyCell = false;
    if (document.body) document.body.style.userSelect = '';
    if (shouldPersist) persistActiveDrawingSelection();
}

function getDrawingSelectionFromDOM() {
    if (!drawingFaixaIndex) return [];
    return normalizeFaixaPattern(
        Array.from(document.querySelectorAll('.slot.selected-slot')).map((el) => ({
            dia: parseInt(el.dataset.dia, 10),
            slot: el.dataset.horario
        }))
    );
}

function updateWeeklySavePatternButton() {
    const btn = document.getElementById('btn-week-save-pattern');
    if (!btn) return;

    let isActive = false;
    let hasSelection = false;

    if (drawingFaixaIndex) {
        const faixaIndex = parseInt(drawingFaixaIndex, 10);
        if (!Number.isNaN(faixaIndex) && faixaIndex >= 1 && faixaIndex <= 3) {
            isActive = true;
            hasSelection = normalizeFaixaPattern(faixasPatterns[faixaIndex]).length > 0;
        }
    }

    btn.classList.toggle('hidden', !isActive);
    btn.disabled = isActive ? !hasSelection : false;
    btn.classList.toggle('is-disabled', isActive && !hasSelection);
    if (!isActive) btn.title = '';
    else btn.title = hasSelection ? 'Salvar o padr?o da faixa ativa' : 'Clique em pelo menos um slot para salvar o padr?o';
}

function persistActiveDrawingSelection() {
    if (!drawingFaixaIndex) return 0;
    const faixaIndex = parseInt(drawingFaixaIndex, 10);
    if (Number.isNaN(faixaIndex) || faixaIndex < 1 || faixaIndex > 3) return 0;

    const selectedPattern = getDrawingSelectionFromDOM();
    const previousPattern = normalizeFaixaPattern(faixasPatterns[faixaIndex]);
    let finalPattern = normalizeFaixaPattern(selectedPattern);

    // Evita perda de slots do padrao em dias de feriado da semana visivel
    // (esses slots nao ficam selecionaveis no DOM e nao devem ser apagados ao persistir).
    const weekStartISO = resolveWeeklyViewWeekStart();
    const weekDates = getWeeklyWeekDates(weekStartISO);
    if (weekDates.length > 0 && previousPattern.length > 0) {
        const feriadosMap = getHolidayLabelMap();
        const holidayDays = new Set();

        for (let i = 1; i <= 6; i++) {
            const dStr = weekDates[i - 1] || '';
            if (dStr && feriadosMap.has(dStr)) holidayDays.add(i);
        }

        if (holidayDays.size > 0) {
            const keys = new Set(finalPattern.map((p) => (p.dia + '|' + p.slot)));
            previousPattern.forEach((p) => {
                if (!holidayDays.has(p.dia)) return;
                const k = p.dia + '|' + p.slot;
                if (keys.has(k)) return;
                finalPattern.push({ ...p });
                keys.add(k);
            });
            finalPattern = normalizeFaixaPattern(finalPattern);
        }
    }

    faixasPatterns[faixaIndex] = finalPattern;
    setFaixaStatus(faixaIndex, finalPattern.length);
    updateWeeklySavePatternButton();
    return finalPattern.length;
}
function clearActiveDrawingSelection() {
    if (!drawingFaixaIndex) return 0;
    const faixaIndex = drawingFaixaIndex;
    const domSelected = getDrawingSelectionFromDOM().length;
    const persisted = normalizeFaixaPattern(faixasPatterns[faixaIndex]).length;
    const clearedCount = Math.max(domSelected, persisted);
    faixasPatterns[faixaIndex] = [];
    setFaixaStatus(faixaIndex, 0);
    updateWeeklySavePatternButton();
    renderWeeklyGrid();
    return clearedCount;
}

function activateDrawingMode(faixaIndex, options = {}) {
    const { silent = false, jumpToFaixaStart = false, switchToWeekly = false, showToolbar = false } = options;
    const faixaEl = document.getElementById(`faixa-${faixaIndex}`);
    if (!faixaEl || faixaEl.classList.contains('hidden')) {
        if (!silent) showToastWarning(`Faixa ${faixaIndex} nao esta disponivel para edicao.`, 'warning', 2400);
        return;
    }

    const prevFaixa = parseInt(drawingFaixaIndex, 10);
    if (!Number.isNaN(prevFaixa) && prevFaixa >= 1 && prevFaixa <= 3 && prevFaixa !== faixaIndex) {
        if (drawingDragState.active) {
            endDrawingDrag();
        } else {
            persistActiveDrawingSelection();
        }
    } else {
        endDrawingDrag();
    }

    activeFaixaIndex = faixaIndex;
    drawingFaixaIndex = faixaIndex;

    if (jumpToFaixaStart) {
        const faixaStart = getActiveFaixaStartDate(faixaIndex);
        if (faixaStart) {
            setWeeklyViewByDate(faixaStart, { followFaixa: true, render: false });
        } else {
            weeklyViewState.followActiveFaixa = true;
        }
    } else {
        weeklyViewState.followActiveFaixa = true;
    }

    const nameEl = document.getElementById('drawing-faixa-name');
    if (nameEl) nameEl.textContent = `Faixa ${faixaIndex}`;
    const toolbar = document.getElementById('drawing-toolbar');
    if (toolbar) {
        if (showToolbar) {
            toolbar.classList.remove('hidden');
            applyDrawingToolbarTheme();
            updateDrawingViewToggleButton();
        } else {
            toolbar.classList.add('hidden');
        }
    }

    if (switchToWeekly) switchTab('weekly');
    renderWeeklyGrid();
    refreshActiveFaixaHighlight();
    if (!silent) showToastWarning(`Edicao ativa para a Faixa ${faixaIndex}.`, 'success', 1800);
}

function deactivateDrawingMode() {
    endDrawingDrag();
    if (pendingFaixaStartPick) clearPendingFaixaStartPick();
    drawingFaixaIndex = null;
    weeklyViewState.followActiveFaixa = false;
    updateWeeklySavePatternButton();
    const toolbar = document.getElementById('drawing-toolbar');
    if (toolbar) toolbar.classList.add('hidden');
    const reeditBadge = document.getElementById('reedit-badge');
    if (reeditBadge) reeditBadge.classList.add('hidden');
    refreshActiveFaixaHighlight();
    renderWeeklyGrid();
}

function normalizeDisciplinaInputValue(rawValue) {
    return String(rawValue || '').replace(/\s*\(\s*\d+\s*h\s*\)\s*$/i, '').trim();
}

function collapseFaixasForNewComponent(options = {}) {
    const preferredStart = resolvePreferredStartForNewComponent(options);

    ['inp-data-inicio-f1', 'inp-data-fim-f1', 'inp-data-inicio-f2', 'inp-data-fim-f2', 'inp-data-inicio-f3', 'inp-data-fim-f3'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });

    faixasPatterns[1] = [];
    faixasPatterns[2] = [];
    faixasPatterns[3] = [];
    activeFaixaIndex = 1;
    if (drawingFaixaIndex) drawingFaixaIndex = 1;

    setFaixaStatus(1, 0);
    setFaixaStatus(2, 0);
    setFaixaStatus(3, 0);

    applyFaixaDateAutofill({ forceSingleBounds: true, preferredStart });
    
    // Força o pulo da grade semanal para a data em que a disciplina vai iniciar
    const f1Ini = document.getElementById('inp-data-inicio-f1')?.value || preferredStart;
    if (f1Ini) {
        setWeeklyViewByDate(f1Ini, { followFaixa: false, render: false });
    }

    refreshPendingFaixaStartPickUI();
    updateWeeklyContextNote();
    if (store.selectedTurma) renderWeeklyGrid();
}

function clearFaixaState(faixaNum, options = {}) {
    const iniEl = document.getElementById(`inp-data-inicio-f${faixaNum}`);
    const fimEl = document.getElementById(`inp-data-fim-f${faixaNum}`);
    if (iniEl) iniEl.value = '';
    if (fimEl) fimEl.value = '';

    faixasPatterns[faixaNum] = [];
    if (pendingFaixaStartPick === faixaNum || (faixaNum === 2 && pendingFaixaStartPick === 3)) {
        clearPendingFaixaStartPick();
    }
    setFaixaStatus(faixaNum, 0);
}

function syncFaixaStartSnapshots() {
    for (let i = 1; i <= 3; i++) {
        const input = document.getElementById(`inp-data-inicio-f${i}`);
        if (!input) continue;
        input.dataset.lastValidValue = String(input.value || '').trim();
    }
}

function getFaixaQuickActionWarningText(faixaNum) {
    const idx = parseInt(faixaNum, 10);
    if (Number.isNaN(idx) || idx < 1 || idx > 3) return '';
    if (idx === 1) return 'Zerar faixa 1? (apaga tudo)';
    const preview = buildWeeklyFaixaExecutionPreview();
    const getFaixaHours = (faixaIndex) => {
        const summaryEntry = Array.isArray(preview?.summary)
            ? preview.summary.find((item) => parseInt(item.faixa, 10) === faixaIndex)
            : null;
        return summaryEntry ? (parseInt(summaryEntry.horas, 10) || 0) : calcFaixaCH(faixaIndex);
    };
    const affectedHours = idx === 2 ? (getFaixaHours(2) + getFaixaHours(3)) : getFaixaHours(3);
    return affectedHours > 0
        ? `Remover faixa ${idx}? (apaga ${affectedHours}h)`
        : `Remover faixa ${idx}?`;
}

function closeFaixaQuickActionConfirm() {
    if (!pendingFaixaQuickActionConfirm) return;
    const row = document.getElementById(`faixa-${pendingFaixaQuickActionConfirm}`);
    if (row) row.classList.remove('faixa-quick-action-open');
    pendingFaixaQuickActionConfirm = null;
}

function openFaixaQuickActionConfirm(faixaNum) {
    const idx = parseInt(faixaNum, 10);
    if (Number.isNaN(idx) || idx < 1 || idx > 3) return;
    if (pendingFaixaQuickActionConfirm && pendingFaixaQuickActionConfirm !== idx) {
        closeFaixaQuickActionConfirm();
    }

    const row = document.getElementById(`faixa-${idx}`);
    if (!row) return;
    row.classList.add('faixa-quick-action-open');
    pendingFaixaQuickActionConfirm = idx;

    const confirmBtn = row.querySelector('.faixa-quick-action-confirm');
    const warningText = getFaixaQuickActionWarningText(idx);
    if (confirmBtn && warningText) {
        confirmBtn.title = warningText;
        confirmBtn.setAttribute('aria-label', `${confirmBtn.textContent} - ${warningText}`);
    }
}

function executeFaixaQuickAction(faixaNum) {
    const idx = parseInt(faixaNum, 10);
    if (Number.isNaN(idx) || idx < 1 || idx > 3) return;

    closeFaixaQuickActionConfirm();

    if (idx === 1) {
        endDrawingDrag();
        if (pendingFaixaStartPick) clearPendingFaixaStartPick();
        drawingFaixaIndex = null;
        weeklyViewState.followActiveFaixa = false;
        setComponentStartSelectionMode('auto');

        ['inp-data-inicio-f1', 'inp-data-fim-f1', 'inp-data-inicio-f2', 'inp-data-fim-f2', 'inp-data-inicio-f3', 'inp-data-fim-f3']
            .forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });

        faixasPatterns[1] = [];
        faixasPatterns[2] = [];
        faixasPatterns[3] = [];
        activeFaixaIndex = 1;

        const termStart = String(store.settings.termStart || inpTermStart?.value || calStart?.value || '').trim();
        const f1Ini = document.getElementById('inp-data-inicio-f1');
        const f1Fim = document.getElementById('inp-data-fim-f1');
        if (f1Ini && termStart) f1Ini.value = termStart;
        if (f1Fim) f1Fim.value = '';

        setFaixaStatus(1, 0);
        setFaixaStatus(2, 0);
        setFaixaStatus(3, 0);

        applyFaixaDateAutofill({ forceSingleBounds: true, preferredStart: termStart });
        autoEnterWeeklyEditingForFaixa(1);
        updateWeeklySavePatternButton();
        refreshPendingFaixaStartPickUI();
        updateWeeklyContextNote();
        updateWeeklyFaixaHoursDisplay();
        if (store.selectedTurma) renderWeeklyGrid();
        showToastWarning('Faixa 1 reiniciada a partir do inicio do periodo letivo. Redesenhe os slots para essa componente.', 'warning', 2600);
        return;
    }

    if (idx === 2) {
        clearFaixaState(2);
        clearFaixaState(3);
        activeFaixaIndex = 1;
        if (drawingFaixaIndex && parseInt(drawingFaixaIndex, 10) > 1) drawingFaixaIndex = 1;
    } else {
        clearFaixaState(3);
        if (drawingFaixaIndex && parseInt(drawingFaixaIndex, 10) === 3) drawingFaixaIndex = 2;
        if (activeFaixaIndex === 3) activeFaixaIndex = 2;
    }

    applyFaixaDateAutofill();
    refreshPendingFaixaStartPickUI();
    updateWeeklyContextNote();
    updateWeeklySavePatternButton();
    if (store.selectedTurma) renderWeeklyGrid();
    showToastWarning(`Faixa ${idx} removida.`, 'success', 1800);
}

function setupFaixaQuickActions() {
    if (!document.body.dataset.faixaQuickActionOutsideBound) {
        document.body.dataset.faixaQuickActionOutsideBound = '1';
        document.addEventListener('pointerdown', (evt) => {
            if (!pendingFaixaQuickActionConfirm) return;
            const row = document.getElementById(`faixa-${pendingFaixaQuickActionConfirm}`);
            if (row && row.contains(evt.target)) return;
            closeFaixaQuickActionConfirm();
        });
        document.addEventListener('keydown', (evt) => {
            if (evt.key === 'Escape' && pendingFaixaQuickActionConfirm) {
                closeFaixaQuickActionConfirm();
            }
        });
    }

    for (let i = 1; i <= 3; i++) {
        const row = document.getElementById(`faixa-${i}`);
        if (!row) continue;
        const triggerBtn = row.querySelector('.faixa-quick-action-trigger');
        const confirmBtn = row.querySelector('.faixa-quick-action-confirm');
        if (!triggerBtn || !confirmBtn || triggerBtn.dataset.quickActionBound === '1') continue;

        triggerBtn.dataset.quickActionBound = '1';
        triggerBtn.addEventListener('click', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            if (pendingFaixaQuickActionConfirm === i) {
                closeFaixaQuickActionConfirm();
                return;
            }
            openFaixaQuickActionConfirm(i);
        });

        confirmBtn.addEventListener('click', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            executeFaixaQuickAction(i);
        });
    }
}

function applyFaixasConfigToSidebar(faixasConfig = []) {
    const sorted = Array.isArray(faixasConfig)
        ? faixasConfig.map(normalizeFaixaEntry).filter(Boolean).sort((a, b) => a.inicio.localeCompare(b.inicio))
        : [];

    for (let i = 1; i <= 3; i++) {
        const faixa = sorted[i - 1] || null;
        const iniEl = document.getElementById(`inp-data-inicio-f${i}`);
        const fimEl = document.getElementById(`inp-data-fim-f${i}`);
        if (faixa) {
            if (iniEl) iniEl.value = faixa.inicio || '';
            if (fimEl) fimEl.value = faixa.fim || '';
        } else {
            if (i > 1 && iniEl) iniEl.value = '';
            if (i > 1 && fimEl) fimEl.value = '';
            if (i > 1) faixasPatterns[i] = [];
        }
        setFaixaStatus(i, getFaixaSlotsAndDays(i).pattern.length);
    }

    applyFaixaDateAutofill();
}

function getActiveDrawingFaixaRange() {
    if (!drawingFaixaIndex) return null;
    const idx = parseInt(drawingFaixaIndex, 10);
    if (Number.isNaN(idx) || idx < 1 || idx > 3) return null;

    const iniEl = document.getElementById(`inp-data-inicio-f${idx}`);
    const fimEl = document.getElementById(`inp-data-fim-f${idx}`);
    const nextIniEl = document.getElementById(`inp-data-inicio-f${idx + 1}`);
    const termStart = store.settings.termStart || inpTermStart?.value || calStart?.value || '';
    const termEnd = store.settings.termEnd || inpTermEnd?.value || calEnd?.value || '';

    let start = (iniEl?.value || '').trim();
    if (!start && idx === 1) start = (termStart || '').trim();
    if (!start) return null;

    let end = (fimEl?.value || '').trim();
    if (!end && nextIniEl?.value) end = shiftISODate(nextIniEl.value, -1);
    if (!end) end = (termEnd || start || '').trim();
    if (!end) return null;
    if (end < start) end = start;

    return { start, end };
}

function getLastValidFaixaFromUI() {
    const faixas = [];

    for (let i = 1; i <= 3; i++) {
        const inicio = String(document.getElementById(`inp-data-inicio-f${i}`)?.value || '').trim();
        const rawFim = String(document.getElementById(`inp-data-fim-f${i}`)?.value || '').trim();
        const nextInicio = String(document.getElementById(`inp-data-inicio-f${i + 1}`)?.value || '').trim();
        const patternCount = normalizeFaixaPattern(faixasPatterns[i]).length;
        const hasExplicitBoundary = isValidISODateValue(rawFim) || isValidISODateValue(nextInicio);

        if (!isValidISODateValue(inicio)) continue;
        if (patternCount === 0 && !hasExplicitBoundary) continue;

        let fim = rawFim;
        if (!isValidISODateValue(fim) && isValidISODateValue(nextInicio)) {
            fim = shiftISODate(nextInicio, -1);
        }
        if (!isValidISODateValue(fim)) fim = inicio;
        if (fim < inicio) fim = inicio;

        faixas.push({ idx: i, inicio, fim });
    }

    faixas.sort((a, b) => {
        if (a.fim !== b.fim) return a.fim.localeCompare(b.fim);
        if (a.inicio !== b.inicio) return a.inicio.localeCompare(b.inicio);
        return a.idx - b.idx;
    });

    return faixas.length > 0 ? faixas[faixas.length - 1] : null;
}

function getLastValidAllocationEndForCurrentTurma() {
    if (!store.selectedTurma || !Array.isArray(store.allocations)) return '';

    let latestEnd = '';

    store.allocations.forEach((alloc) => {
        if (String(alloc?.turmaId) !== String(store.selectedTurma)) return;
        if (isPendingAllocation(alloc)) return;

        let candidateEnd = '';
        if (isFaixaAllocation(alloc)) {
            const faixas = getNormalizedIntensiveFaixas(alloc);
            const lastFaixa = faixas.length > 0 ? faixas[faixas.length - 1] : null;
            candidateEnd = String(lastFaixa?.fim || lastFaixa?.inicio || alloc?.dataFim || alloc?.dataInicio || '').trim();
        } else {
            candidateEnd = String(alloc?.dataFim || alloc?.dataInicio || '').trim();
        }

        if (!isValidISODateValue(candidateEnd)) return;
        if (!latestEnd || candidateEnd > latestEnd) latestEnd = candidateEnd;
    });

    return latestEnd;
}

function setComponentStartSelectionMode(mode = 'auto') {
    componentStartSelectionMode = mode === 'manual' ? 'manual' : 'auto';
}

function getCurrentComponentStartDateFromUI() {
    const raw = String(document.getElementById('inp-data-inicio-f1')?.value || '').trim();
    return isValidISODateValue(raw) ? raw : '';
}

function getManualComponentStartOverride() {
    if (componentStartSelectionMode !== 'manual') return '';
    return getCurrentComponentStartDateFromUI();
}

function getCanonicalFirstFaixaStartDate() {
    const termStart = String(store.settings.termStart || inpTermStart?.value || calStart?.value || '').trim();
    return isValidISODateValue(termStart) ? termStart : '';
}

function getFaixaStartDateValidation(faixaIndex, candidateDate) {
    const idx = parseInt(faixaIndex, 10);
    const dateStr = String(candidateDate || '').trim();
    if (Number.isNaN(idx) || idx < 1 || idx > 3) {
        return { isValid: false, message: 'Faixa inválida.' };
    }
    if (!isValidISODateValue(dateStr)) {
        return { isValid: false, message: `Data inválida para a Faixa ${idx}.` };
    }

    const termStart = String(store.settings.termStart || inpTermStart?.value || calStart?.value || '').trim();
    const termEnd = String(store.settings.termEnd || inpTermEnd?.value || calEnd?.value || '').trim();
    if (isValidISODateValue(termStart) && dateStr < termStart) {
        return {
            isValid: false,
            message: `A Faixa ${idx} precisa começar dentro do período letivo ativo.`
        };
    }
    if (isValidISODateValue(termEnd) && dateStr > termEnd) {
        return {
            isValid: false,
            message: `A Faixa ${idx} precisa terminar dentro do período letivo ativo.`
        };
    }

    const previousStart = idx > 1
        ? String(document.getElementById(`inp-data-inicio-f${idx - 1}`)?.value || '').trim()
        : '';
    if (idx > 1 && !isValidISODateValue(previousStart)) {
        return {
            isValid: false,
            message: `Defina primeiro o início da Faixa ${idx - 1}.`
        };
    }
    if (isValidISODateValue(previousStart) && dateStr <= previousStart) {
        return {
            isValid: false,
            message: `A Faixa ${idx} precisa começar depois da Faixa ${idx - 1}.`
        };
    }

    const nextStart = idx < 3
        ? String(document.getElementById(`inp-data-inicio-f${idx + 1}`)?.value || '').trim()
        : '';
    if (isValidISODateValue(nextStart) && dateStr >= nextStart) {
        return {
            isValid: false,
            message: `A Faixa ${idx} precisa começar antes da Faixa ${idx + 1}.`
        };
    }

    return { isValid: true, message: '' };
}

// Slots de "encaixe" onde uma nova componente pode INICIAR o dia, na ordem de
// exibicao da grade. O dia e candidato quando QUALQUER um destes slots estiver
// livre (regra do OU). Para CADA turno presente (unico ou combinado):
//  - 1a aula do turno (ex.: manha 08:00, tarde 14:00);
//  - 4a aula do turno (1a apos o intervalo, ex.: 10:50 / 16:50), quando o
//    turno tem 4+ aulas — e o encaixe do par 3+2 que subdivide o turno.
function getComponentStartCandidateSlots() {
    const slots = buildHorariosForUI()
        .map((slot) => normalizeConflictSlotLabel(slot))
        .filter((slot) => slot && !slot.toUpperCase().includes('INTERVALO'));
    if (slots.length === 0) return [];

    const byTurno = new Map();
    slots.forEach((slot) => {
        const turno = getTurnoLetter(slot);
        if (!byTurno.has(turno)) byTurno.set(turno, []);
        byTurno.get(turno).push(slot);
    });

    const candidates = [];
    byTurno.forEach((turnoSlots) => {
        candidates.push(turnoSlots[0]);
        if (turnoSlots.length >= 4) candidates.push(turnoSlots[3]);
    });
    return [...new Set(candidates)];
}

function getTurmaUsaSabadoForStartSearch() {
    return store.allocations.some((a) =>
        String(a?.turmaId) === String(store.selectedTurma) &&
        isFaixaAllocation(a) &&
        getNormalizedIntensiveFaixas(a).some((f) => Array.isArray(f.dias) && f.dias.includes(6))
    );
}

// Inicio da Faixa 1 de uma componente = menor "inicio" entre suas faixas.
function getComponentFaixa1Start(alloc) {
    const inicios = (getNormalizedIntensiveFaixas(alloc) || [])
        .map((f) => String(f?.inicio || '').trim())
        .filter(Boolean)
        .sort();
    return inicios[0] || '';
}

// "Ultima componente" do planejamento da turma = a de MAIOR inicio de Faixa 1
// (reflete o estado do planejamento, nao a ordem de insercao/cliques). Ignora
// pendentes e as componentes em edicao (editingOriginalAllocationIds), para a
// componente reeditada nao ancorar em si mesma.
function getLastPlannedComponentForCurrentTurma() {
    if (!store.selectedTurma) return null;
    const hiddenEditIds = new Set((weeklyState.editingOriginalAllocationIds || []).map((id) => String(id)));
    let best = null;
    let bestStart = '';
    (store.allocations || []).forEach((alloc) => {
        if (String(alloc?.turmaId) !== String(store.selectedTurma)) return;
        if (!isFaixaAllocation(alloc)) return;
        if (hiddenEditIds.has(String(alloc?.id))) return;
        const f1 = getComponentFaixa1Start(alloc);
        if (!f1) return;
        if (!best || f1 > bestStart) {
            best = alloc;
            bestStart = f1;
        }
    });
    return best;
}

// Ultima sugestao calculada {date, slot, gapBefore, exhausted, anchor} — usada
// pela nota de contexto e pelo destaque do slot sugerido na Grade Semanal.
let lastStartSuggestion = null;

// Sugestao inteligente de inicio {date, slot}: ancora a busca no inicio da
// FAIXA 1 da ultima componente planejada e varre adiante pelo primeiro slot de
// encaixe livre (1a/4a aula de cada turno). Essa unica varredura implementa o
// despacho pelas 3 regras acordadas:
//  - ultima INTENSIVA de MEIO TURNO (<=3 aulas): o encaixe complementar (4a ou
//    1a aula, tanto faz a ordem do par) esta livre no proprio dia da F1 dela
//    -> a sugestao forma o par 3+2 alinhado;
//  - ultima INTENSIVA de TURNO INTEIRO (4+ aulas) ou PAR COMPLETO: nenhum
//    encaixe livre durante o bloco -> a varredura para no primeiro dia util
//    apos o fim. Em turnos combinados, se ela lota so a manha, o 1o slot da
//    tarde do MESMO dia e encontrado antes;
//  - ultima NAO INTENSIVA: ocupa poucos slots por semana -> o primeiro encaixe
//    livre a partir do primeiro dia de aula dela (INCLUSIVE) e encontrado ali.
// Fallbacks: nada livre da ancora ate o fim do periodo -> re-varre desde o
// inicio do semestre; ainda nada -> exhausted:true (avisar). Se existir encaixe
// livre ANTES da ancora (gap deixado por remocao), vai em gapBefore para o
// sistema apenas AVISAR, sem posicionar la.
function resolveSmartComponentStartSuggestion() {
    const termStart = String(store.settings.termStart || inpTermStart?.value || calStart?.value || '').trim();
    const termEnd = String(store.settings.termEnd || inpTermEnd?.value || calEnd?.value || termStart).trim();
    const empty = { date: termStart, slot: '', gapBefore: null, exhausted: false, anchor: termStart };
    if (!termStart || !termEnd) return empty;

    const targetSlots = getComponentStartCandidateSlots();
    if (targetSlots.length === 0) return empty;

    const occupiedByDate = buildFaixaOccupiedSlotsByDateDirect(store.selectedTurma, termStart, termEnd);
    const holidays = new Set(
        (store.rawData?.feriados || []).map((item) => String(item?.data || item || '').trim()).filter(Boolean)
    );
    const skipSaturday = !getTurmaUsaSabadoForStartSearch();

    const scan = (fromDate, toDate) => {
        if (!fromDate || !toDate || fromDate > toDate) return null;
        let cursor = new Date(fromDate + 'T12:00:00');
        const endDateObj = new Date(toDate + 'T12:00:00');
        let safety = 0;
        while (cursor <= endDateObj && safety < 800) {
            safety++;
            const dow = cursor.getDay();
            const dateStr = toISODate(cursor);
            cursor.setDate(cursor.getDate() + 1);
            if (dow === 0 || (skipSaturday && dow === 6) || holidays.has(dateStr)) continue;
            const occupied = occupiedByDate.get(dateStr) || new Set();
            const freeSlot = targetSlots.find((slot) => !occupied.has(slot));
            if (freeSlot) return { date: dateStr, slot: freeSlot };
        }
        return null;
    };

    const last = getLastPlannedComponentForCurrentTurma();
    let anchor = last ? (getComponentFaixa1Start(last) || termStart) : termStart;
    if (anchor < termStart) anchor = termStart;

    let primary = scan(anchor, termEnd);
    let exhausted = false;
    if (!primary && anchor > termStart) primary = scan(termStart, termEnd);
    if (!primary) {
        exhausted = true;
        primary = { date: termStart, slot: '' };
    }

    const gapBefore = (!exhausted && anchor > termStart && primary.date >= anchor)
        ? scan(termStart, shiftISODate(anchor, -1))
        : null;

    return { ...primary, gapBefore, exhausted, anchor };
}

// Feedback nao bloqueante da sugestao: gap anterior existente (so avisa, nao
// posiciona) e esgotamento do periodo letivo.
function notifyStartSuggestionFeedback(suggestion = lastStartSuggestion) {
    if (!suggestion) return;
    if (suggestion.exhausted) {
        showToastWarning(
            'Nenhum slot de encaixe livre ate o fim do periodo letivo. A data inicial voltou para o inicio do periodo; ajuste manualmente ou libere espaco.',
            'warning',
            6200
        );
        return;
    }
    // O aviso de "gap livre antes da ultima componente" NAO e mais um toast
    // repetitivo: virou uma nota INLINE discreta (updateGapAdvisory), com botoes
    // "Ciente" (dispensa aquele gap) e "Nao avisar mais" (silencia de vez).
    updateGapAdvisory();
}

// --- Aviso INLINE de "dia livre antes" (gapBefore) ---------------------------
// Substitui o toast repetitivo por uma nota discreta e dispensavel.
const GAP_ADVISORY_MUTE_KEY = 'weekly_gap_advisory_muted';
let gapAdvisoryDismissedDate = '';

function isGapAdvisoryMuted() {
    try {
        return localStorage.getItem(GAP_ADVISORY_MUTE_KEY) === '1';
    } catch (e) {
        return false;
    }
}

function muteGapAdvisory() {
    try {
        localStorage.setItem(GAP_ADVISORY_MUTE_KEY, '1');
    } catch (e) { /* noop */ }
    updateGapAdvisory();
}

// Mostra/esconde a nota inline conforme a sugestao atual tem um gap antes, o
// usuario ainda nao dispensou ESSE gap e nao silenciou de vez.
function updateGapAdvisory() {
    const el = document.getElementById('weekly-gap-advisory');
    if (!el) return;
    const gap = lastStartSuggestion?.gapBefore;
    const shouldShow = !!(gap && gap.date)
        && !isGapAdvisoryMuted()
        && gapAdvisoryDismissedDate !== gap.date
        && !weeklyBlockMessage;
    if (!shouldShow) {
        el.classList.add('hidden');
        return;
    }
    const txt = document.getElementById('weekly-gap-advisory-text');
    if (txt) {
        const slotTxt = gap.slot ? ` (aula das ${gap.slot})` : '';
        txt.textContent = `Existe um horario livre antes, em ${formatDateBR(gap.date)}${slotTxt}. Mantive a sugestao em sequencia — se preferir esse dia, e so definir a data.`;
    }
    el.classList.remove('hidden');
}

function getPreferredStartDateForCurrentTurma(options = {}) {
    const { useCurrentUI = false } = options;

    if (useCurrentUI) {
        const lastUiFaixa = getLastValidFaixaFromUI();
        if (lastUiFaixa?.fim) {
            return lastUiFaixa.fim;
        }
    }

    // Despacho pelas regras da "ultima componente" (ver resolveSmartComponentStartSuggestion).
    const suggestion = resolveSmartComponentStartSuggestion();
    lastStartSuggestion = suggestion;
    return suggestion.date || getCanonicalFirstFaixaStartDate();
}

// Lê a ocupação de slots diretamente das faixas das alocações, sem passar pelo
// limite de carga horária (CH) do getCalendarEvents. Isso garante que mesmo
// faixas extras (ex: Faixa 2 após CH esgotado na Faixa 1) sejam detectadas.
function buildFaixaOccupiedSlotsByDateDirect(turmaId, startDate, endDate) {
    const occupiedByDate = new Map();
    if (!turmaId || !startDate || !endDate) return occupiedByDate;
    const turmIdStr = String(turmaId);

    // Edicao segura: ignora a ocupacao da propria componente em edicao (ainda
    // persistida no store ate o save) para que a busca da data inicial trate os
    // slots dela como livres — senao ela "empurra" o inicio para depois de si mesma.
    const hiddenEditIds = new Set(
        (weeklyState.editingOriginalAllocationIds || []).map((id) => String(id))
    );

    store.allocations.forEach((alloc) => {
        if (String(alloc?.turmaId) !== turmIdStr) return;
        if (!isFaixaAllocation(alloc)) return;
        if (hiddenEditIds.has(String(alloc?.id))) return;

        const faixas = getNormalizedIntensiveFaixas(alloc);
        faixas.forEach((faixa) => {
            const faixaEnd = faixa.fim || faixa.inicio;
            const rangeStart = faixa.inicio > startDate ? faixa.inicio : startDate;
            const rangeEnd = faixaEnd < endDate ? faixaEnd : endDate;
            if (rangeStart > rangeEnd) return;

            let cursor = new Date(rangeStart + 'T12:00:00');
            const limitDate = new Date(rangeEnd + 'T12:00:00');
            while (cursor <= limitDate) {
                const dow = cursor.getDay();
                const dateStr = toISODate(cursor);
                cursor.setDate(cursor.getDate() + 1);
                if (dow < 1 || dow > 6) continue;

                const byDay = faixa.drawnSlotsByDay || {};
                const daySlots = (Array.isArray(byDay[dow]) && byDay[dow].length > 0)
                    ? byDay[dow]
                    : (Array.isArray(faixa.dias) && faixa.dias.includes(dow) ? faixa.slots || [] : []);

                daySlots.forEach((rawSlot) => {
                    const slot = normalizeConflictSlotLabel(rawSlot);
                    if (!slot) return;
                    if (!occupiedByDate.has(dateStr)) occupiedByDate.set(dateStr, new Set());
                    occupiedByDate.get(dateStr).add(slot);
                });
            }
        });
    });

    return occupiedByDate;
}

function getPreferredPendingStartDateForCurrentTurma() {
    // Mesmo despacho da insercao individual (ver resolveSmartComponentStartSuggestion),
    // garantindo que Pendentes e insercao individual sugiram a MESMA data/slot.
    const suggestion = resolveSmartComponentStartSuggestion();
    lastStartSuggestion = suggestion;
    return suggestion.date || getCanonicalFirstFaixaStartDate();
}

function resolvePreferredStartForNewComponent(options = {}) {
    const {
        preferredStart: explicitPreferredStart,
        useCurrentUI = true
    } = options;

    if (explicitPreferredStart !== undefined) return String(explicitPreferredStart || '').trim();

    const manualOverride = getManualComponentStartOverride();
    if (manualOverride) return manualOverride;

    return getPreferredStartDateForCurrentTurma({ useCurrentUI });
}

function resolveTeacherForAllocationHour(alloc, hourIndex) {
    if (!Number.isFinite(hourIndex) || hourIndex <= 0) {
        return String(alloc?.docente || '').trim();
    }

    if (alloc?.docentes && Array.isArray(alloc.docentes) && alloc.docentes.length > 0) {
        let accumulatedHours = 0;
        for (const docente of alloc.docentes) {
            const docenteHours = parseFloat(String(docente?.ch ?? 0).replace(',', '.'));
            accumulatedHours += Number.isFinite(docenteHours) ? docenteHours : 0;
            if (hourIndex <= accumulatedHours) {
                return String(docente?.nome || '').trim();
            }
        }

        const lastTeacher = alloc.docentes[alloc.docentes.length - 1]?.nome;
        if (lastTeacher) return String(lastTeacher).trim();
    }

    return String(alloc?.docente || '').trim();
}

function buildIntensiveTeacherConflictEntries(intense, teacherName) {
    if (!intense?.dataInicio || !intense?.dataFim || !teacherName) return [];

    const normalizedTeacher = normalizeTeacherNameForMatch(teacherName);
    const storedExecutionByDate = intense?.executionByDate && typeof intense.executionByDate === 'object'
        ? intense.executionByDate
        : null;
    const storedExecutionDates = storedExecutionByDate ? Object.keys(storedExecutionByDate).sort() : [];
    const totalHours = parseFloat(String(intense.ch ?? 0).replace(',', '.'));
    const hasHourLimit = Number.isFinite(totalHours) && totalHours > 0;

    if (storedExecutionDates.length > 0) {
        const entries = [];
        let currentHour = 0;

        for (const currentDate of storedExecutionDates) {
            const slots = (storedExecutionByDate[currentDate] || [])
                .map((slot) => normalizeConflictSlotLabel(slot))
                .filter(Boolean);

            for (const slot of slots) {
                if (hasHourLimit && currentHour >= totalHours) break;
                currentHour += 1;

                const resolvedTeacher = resolveTeacherForAllocationHour(intense, currentHour);
                if (normalizeTeacherNameForMatch(resolvedTeacher) !== normalizedTeacher) continue;

                entries.push({
                    date: currentDate,
                    horario: slot,
                    docente: resolvedTeacher
                });
            }
        }

        return entries;
    }

    const faixas = buildIntensiveConflictFaixas(intense, intense.dataInicio, intense.dataFim);
    if (faixas.length === 0) return [];

    const feriados = new Set((store.rawData?.feriados || []).map((f) => String(f?.data || f || '')));
    const finalDaySlots = new Set(
        (Array.isArray(intense.horariosUltimoDia) ? intense.horariosUltimoDia : [])
            .map((slot) => normalizeConflictSlotLabel(slot))
            .filter(Boolean)
    );
    const entries = [];
    let currentHour = 0;

    for (let currentDate = intense.dataInicio; currentDate && currentDate <= intense.dataFim; currentDate = addDaysISO(currentDate, 1)) {
        if (feriados.has(currentDate)) continue;

        const dayOfWeek = new Date(currentDate + 'T12:00:00').getDay();
        if (dayOfWeek === 0) continue;

        const faixaAtiva = faixas.find((faixa) => currentDate >= faixa.inicio && currentDate <= faixa.fim);
        if (!faixaAtiva) continue;

        const rawSlots = faixaAtiva.byDay?.[dayOfWeek] || [];
        if (!Array.isArray(rawSlots) || rawSlots.length === 0) continue;

        for (const rawSlot of rawSlots) {
            const slot = normalizeConflictSlotLabel(rawSlot);
            if (!slot) continue;

            if (currentDate === intense.dataFim && finalDaySlots.size > 0 && !finalDaySlots.has(slot)) {
                continue;
            }

            if (hasHourLimit && currentHour >= totalHours) break;

            currentHour += 1;
            const resolvedTeacher = resolveTeacherForAllocationHour(intense, currentHour);
            if (normalizeTeacherNameForMatch(resolvedTeacher) !== normalizedTeacher) continue;

            entries.push({
                date: currentDate,
                horario: slot,
                docente: resolvedTeacher
            });
        }
    }

    return entries;
}

function findConfirmedTeacherConflictForCandidate(candidateAlloc, teacherNames = []) {
    if (!candidateAlloc?.dataInicio || !candidateAlloc?.dataFim || !Array.isArray(teacherNames) || teacherNames.length === 0) {
        return null;
    }

    for (const teacherName of teacherNames) {
        const candidateEntries = buildIntensiveTeacherConflictEntries(candidateAlloc, teacherName);
        if (candidateEntries.length === 0) continue;

        const existingEventsByDate = getCalendarEvents(null, candidateAlloc.dataInicio, candidateAlloc.dataFim, teacherName);
        const existingByKey = new Map();

        Object.entries(existingEventsByDate || {}).forEach(([dateStr, events]) => {
            (events || []).forEach((event) => {
                if (!event || String(event.turmaId) === String(store.selectedTurma)) return;
                const slot = normalizeConflictSlotLabel(event.horario || '');
                if (!slot) return;
                const key = `${dateStr}|${slot}`;
                if (!existingByKey.has(key)) existingByKey.set(key, event);
            });
        });

        for (const entry of candidateEntries) {
            const key = `${entry.date}|${entry.horario}`;
            const existingEvent = existingByKey.get(key);
            if (!existingEvent) continue;

            return {
                teacherName,
                date: entry.date,
                horario: entry.horario,
                event: existingEvent
            };
        }
    }

    return null;
}

function findTurmaConflictForCandidateExecution(candidateAlloc, execution = {}) {
    if (!candidateAlloc?.turmaId || !execution?.dataInicio || !execution?.dataFim) {
        return null;
    }

    const existingEventsByDate = getCalendarEvents(String(candidateAlloc.turmaId), execution.dataInicio, execution.dataFim);
    const existingByKey = new Map();

    Object.entries(existingEventsByDate || {}).forEach(([dateStr, events]) => {
        (events || []).forEach((event) => {
            if (shouldIgnoreTurmaEventForCandidate(event, candidateAlloc)) return;

            const slot = normalizeConflictSlotLabel(event?.horario || '');
            if (!slot) return;

            const key = `${dateStr}|${slot}`;
            if (!existingByKey.has(key)) existingByKey.set(key, event);
        });
    });

    const usedDates = getExecutionUsedDates(execution);
    for (const dateStr of usedDates) {
        const slots = getExecutionSlotsForDate(execution, dateStr);
        for (const slot of slots) {
            const key = `${dateStr}|${normalizeConflictSlotLabel(slot)}`;
            const event = existingByKey.get(key);
            if (!event) continue;

            return {
                date: dateStr,
                horario: slot,
                disciplina: event?.disciplina || '',
                event
            };
        }
    }

    return null;
}

function shiftFaixasByDays(faixas = [], deltaDays = 0) {
    return (Array.isArray(faixas) ? faixas : [])
        .map((faixa) => normalizeFaixaEntry(faixa))
        .filter(Boolean)
        .map((faixa) => ({
            ...faixa,
            inicio: shiftISODate(faixa.inicio, deltaDays),
            fim: faixa.fim ? shiftISODate(faixa.fim, deltaDays) : null
        }));
}

function buildCandidateIntensiveFromFaixas(baseAlloc, faixas) {
    const safeFaixas = Array.isArray(faixas) ? faixas.map(normalizeFaixaEntry).filter(Boolean) : [];
    if (!baseAlloc || safeFaixas.length === 0) return null;

    const allDays = [...new Set(safeFaixas.flatMap((f) => Array.isArray(f.dias) ? f.dias : []))]
        .filter((d) => d >= 1 && d <= 6)
        .sort((a, b) => a - b);
    const allSlots = [...new Set(safeFaixas.flatMap((f) => Array.isArray(f.slots) ? f.slots : []))]
        .filter(Boolean)
        .sort((a, b) => timeToMinutes(a) - timeToMinutes(b));

    return {
        ...baseAlloc,
        dataInicio: safeFaixas[0].inicio,
        dataFim: safeFaixas[safeFaixas.length - 1].fim || safeFaixas[safeFaixas.length - 1].inicio,
        faixas: safeFaixas,
        diasMarcados: allDays,
        horariosOcupados: allSlots,
        usaSabado: allDays.includes(6)
    };
}

// Uma componente e considerada "intensiva" quando suas aulas caem em dias
// CONSECUTIVOS da semana (sem buraco no meio). Ex.: seg-ter-qua e intensiva;
// seg-qua-sex NAO e (ha buraco em ter/qui). O numero de slots por dia nao importa.
function diasSemanaSaoConsecutivos(dias = []) {
    const lista = [...new Set((Array.isArray(dias) ? dias : [])
        .map((d) => parseInt(d, 10))
        .filter((d) => d >= 1 && d <= 6))]
        .sort((a, b) => a - b);
    if (lista.length === 0) return false;
    return (lista[lista.length - 1] - lista[0] + 1) === lista.length;
}

// A componente e intensiva se TODAS as faixas com carga tiverem dias consecutivos.
function isIntensiveComponentByFaixas(faixasInput = []) {
    const faixas = (Array.isArray(faixasInput) ? faixasInput : [])
        .map(normalizeFaixaEntry)
        .filter(Boolean);
    if (faixas.length === 0) return false;
    return faixas.every((faixa) => diasSemanaSaoConsecutivos(faixa.dias));
}

// Empilha uma componente intensiva EM SEQUENCIA: reposiciona-a como um bloco
// CONTINUO logo apos a ultima componente ja alocada da turma, sem dividir nem
// empurrar nenhuma outra (substitui o antigo empurrao com pausa/retoma, que
// intercalava as componentes). Ancora no dia seguinte ao maior "fim" entre as
// OUTRAS componentes da turma (ignora a propria, em caso de edicao) e procura
// adiante ate achar um inicio sem conflito de turma nem de professor. Usa
// respectTurmaOccupancy:false para manter o bloco continuo (nao desvia para
// buracos, o que reintroduziria intercalamento).
function stackIntensiveAfterAllocations(baseCandidate, turmaId, minStart = '') {
    const origFaixas = getNormalizedIntensiveFaixas(baseCandidate);
    if (!baseCandidate || origFaixas.length === 0) return null;

    const disc = normalizeDisciplinaInputValue(baseCandidate.disciplina || '');
    const sub = String(baseCandidate.subGrupo || '');

    let latestEnd = '';
    (store.allocations || []).forEach((a) => {
        if (String(a?.turmaId || '') !== String(turmaId)) return;
        if (isPendingAllocation(a)) return;
        // Ignora a propria componente (caso de edicao) para nao ancorar em si mesma.
        if (normalizeDisciplinaInputValue(a.disciplina || '') === disc && String(a.subGrupo || '') === sub) return;
        const end = String(a?.dataFim || a?.dataInicio || '').trim();
        if (end && (!latestEnd || end > latestEnd)) latestEnd = end;
    });

    let anchor = latestEnd ? shiftISODate(latestEnd, 1) : String(minStart || origFaixas[0].inicio || '').trim();
    if (minStart && anchor < minStart) anchor = minStart;
    if (!anchor) return null;

    const originalFirstStart = origFaixas[0].inicio;
    const maxShiftDays = 365;

    for (let offset = 0; offset <= maxShiftDays; offset++) {
        const candidateFirstStart = shiftISODate(anchor, offset);
        const delta = diffDaysISO(originalFirstStart, candidateFirstStart);
        const shiftedFaixas = shiftFaixasByDays(origFaixas, delta);
        const shiftedCandidate = buildCandidateIntensiveFromFaixas(baseCandidate, shiftedFaixas);
        if (!shiftedCandidate) continue;

        // respectTurmaOccupancy:false => bloco CONTINUO (nao desvia para buracos).
        const execution = computeIntensiveExecution(shiftedCandidate, {
            respectPriority: true,
            respectTurmaOccupancy: false
        });
        if (!execution || execution.totalHours <= 0 || !execution.dataInicio || !execution.dataFim) continue;

        const alignedFaixas = alignFaixasToExecutionEnd(shiftedFaixas, execution.dataFim);
        const finalCandidate = {
            ...shiftedCandidate,
            dataInicio: execution.dataInicio,
            dataFim: execution.dataFim,
            executionByDate: execution.byDate || {},
            horariosOcupados: execution.unionSlots || shiftedCandidate.horariosOcupados || [],
            horariosUltimoDia: execution.horariosUltimoDia || [],
            diasMarcados: execution.unionDias || shiftedCandidate.diasMarcados || [],
            usaSabado: (execution.unionDias || []).includes(6),
            faixas: alignedFaixas
        };

        const turmaConflict = findTurmaConflictForCandidateExecution(finalCandidate, execution);
        if (turmaConflict) continue;

        const teacherNames = getAllocationTeachersForConflict(finalCandidate);
        const teacherConflict = findConfirmedTeacherConflictForCandidate(finalCandidate, teacherNames);
        if (teacherConflict) continue;

        return { candidate: finalCandidate, execution };
    }

    return null;
}

function getWeekAutoPositionAnchorDate() {
    // A semana exibida segue o INICIO DA FAIXA 1 do editor — fonte unica de
    // "onde esta componente comeca": para NOVA componente e a DATA SUGERIDA (ja
    // escrita em inp-data-inicio-f1 por collapseFaixasForNewComponent); para
    // EDICAO e o inicio REAL da componente carregada (por hydrateFaixasFromComponente).
    // Isso UNIFICA a semana exibida com a data sugerida. Antes a semana usava a
    // ULTIMA componente inserida (ordem do array), que divergia da ancora
    // cronologica da sugestao (bug: ao reeditar uma oferta, a grade pulava para a
    // semana de OUTRA componente, a ultima inserida).
    const f1Start = String(document.getElementById('inp-data-inicio-f1')?.value || '').trim();
    if (f1Start) return f1Start;
    return getPreferredStartDateForCurrentTurma();
}

function applyWeekAutoPositionForComponentChange(options = {}) {
    const { render = false } = options;
    const anchorDate = getWeekAutoPositionAnchorDate();
    if (!anchorDate) return;
    setWeeklyViewByDate(anchorDate, { followFaixa: false, render });
}

function refreshCompactFaixaDateDisplay(input) {
    if (!input?.id) return;
    const display = document.querySelector(`[data-date-display-for="${input.id}"]`);
    if (!display) return;
    const hasValue = !!String(input.value || '').trim();
    display.textContent = formatCompactFaixaDate(input.value);
    display.classList.toggle('is-placeholder', !hasValue);
}

function refreshAllCompactFaixaDateDisplays() {
    [
        'inp-data-inicio-f1',
        'inp-data-fim-f1',
        'inp-data-inicio-f2',
        'inp-data-fim-f2',
        'inp-data-inicio-f3',
        'inp-data-fim-f3'
    ].forEach((id) => refreshCompactFaixaDateDisplay(document.getElementById(id)));
}

function resolveCompactFaixaPickerAnchor(input) {
    if (!input?.id) return '';

    const termStart = String(store.settings.termStart || inpTermStart?.value || calStart?.value || '').trim();
    if (!input.id.startsWith('inp-data-inicio-f')) return '';

    if (input.id === 'inp-data-inicio-f1') return termStart;
    if (input.id === 'inp-data-inicio-f2') {
        return String(document.getElementById('inp-data-inicio-f1')?.value || termStart || '').trim();
    }
    if (input.id === 'inp-data-inicio-f3') {
        return String(
            document.getElementById('inp-data-inicio-f2')?.value
            || document.getElementById('inp-data-inicio-f1')?.value
            || termStart
            || ''
        ).trim();
    }

    return '';
}

function primeCompactFaixaDatePickerAnchor(input) {
    if (!input?.id) return;
    if (!input.id.startsWith('inp-data-inicio-f')) return;

    const currentValue = String(input.value || '').trim();
    if (currentValue) return;

    const anchorValue = resolveCompactFaixaPickerAnchor(input);
    if (!anchorValue) return;

    input.dataset.restorePickerValue = currentValue;
    input.dataset.pickerAnchorValue = anchorValue;
    input.value = anchorValue;
    refreshCompactFaixaDateDisplay(input);
}

function restoreCompactFaixaDatePickerValueIfNeeded(input) {
    if (!input?.id) return;

    const restoreValue = input.dataset.restorePickerValue;
    const anchorValue = input.dataset.pickerAnchorValue;
    if (restoreValue === undefined && anchorValue === undefined) return;

    const currentValue = String(input.value || '').trim();
    const keepAnchorForFaixa1 = input.id === 'inp-data-inicio-f1';
    if (!keepAnchorForFaixa1 && anchorValue && currentValue === anchorValue) {
        input.value = restoreValue || '';
        refreshCompactFaixaDateDisplay(input);
    }

    delete input.dataset.restorePickerValue;
    delete input.dataset.pickerAnchorValue;
}

function openCompactFaixaDatePicker(input) {
    if (!input) return;
    primeCompactFaixaDatePickerAnchor(input);
    input.focus({ preventScroll: true });
    if (typeof input.showPicker === 'function') {
        try {
            input.showPicker();
            return;
        } catch (_) {
            // Fallback abaixo para navegadores sem suporte total.
        }
    }
    input.click();
}

function setupCompactFaixaDateFields() {
    const ids = [
        'inp-data-inicio-f1',
        'inp-data-fim-f1',
        'inp-data-inicio-f2',
        'inp-data-fim-f2',
        'inp-data-inicio-f3',
        'inp-data-fim-f3'
    ];

    ids.forEach((id) => {
        const input = document.getElementById(id);
        if (!input) return;

        refreshCompactFaixaDateDisplay(input);

        if (input.dataset.compactDateBound !== '1') {
            input.dataset.compactDateBound = '1';
            ['input', 'change'].forEach((evt) => {
                input.addEventListener(evt, () => {
                    refreshCompactFaixaDateDisplay(input);
                    if (evt === 'change') {
                        delete input.dataset.restorePickerValue;
                        delete input.dataset.pickerAnchorValue;
                    }
                });
            });
            input.addEventListener('pointerdown', () => {
                primeCompactFaixaDatePickerAnchor(input);
            });
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
                    primeCompactFaixaDatePickerAnchor(input);
                }
            });
            input.addEventListener('blur', () => {
                restoreCompactFaixaDatePickerValueIfNeeded(input);
            });
        }
    });

    document.querySelectorAll('.faixa-date-trigger').forEach((btn) => {
        if (btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const input = document.getElementById(btn.dataset.dateTarget || '');
            openCompactFaixaDatePicker(input);
        });
    });

    document.querySelectorAll('.faixa-date-display').forEach((display) => {
        if (display.dataset.bound === '1') return;
        display.dataset.bound = '1';
        display.addEventListener('click', () => {
            const input = document.getElementById(display.dataset.dateDisplayFor || '');
            openCompactFaixaDatePicker(input);
        });
    });

    document.querySelectorAll('.faixa-date-compact').forEach((wrapper) => {
        if (wrapper.dataset.bound === '1') return;
        wrapper.dataset.bound = '1';
        wrapper.addEventListener('click', (event) => {
            if (event.target.closest('.faixa-date-trigger')) return;
            const input = wrapper.querySelector('.faixa-date-native');
            openCompactFaixaDatePicker(input);
        });
    });
}

function applyFaixaDateAutofill(options = {}) {
    const { forceSingleBounds = false, preferredStart = '' } = options;

    const f1Ini = document.getElementById('inp-data-inicio-f1');
    const f1Fim = document.getElementById('inp-data-fim-f1');
    const f2Ini = document.getElementById('inp-data-inicio-f2');
    const f2Fim = document.getElementById('inp-data-fim-f2');
    const f3Ini = document.getElementById('inp-data-inicio-f3');
    const f3Fim = document.getElementById('inp-data-fim-f3');

    const resolvedPreferredStart = preferredStart || getPreferredStartDateForCurrentTurma();
    const isEditingF1Start = f1Ini && document.activeElement === f1Ini;
    if (resolvedPreferredStart && f1Ini && !f1Ini.value && !isEditingF1Start) f1Ini.value = resolvedPreferredStart;

    const hasF2 = !!(f2Ini && f2Ini.value);
    const hasF3 = !!(f3Ini && f3Ini.value);

    if (hasF2 && f1Fim) {
        const endF1 = shiftISODate(f2Ini.value, -1);
        if (endF1) f1Fim.value = endF1;
    } else if (forceSingleBounds && f1Fim) {
        f1Fim.value = '';
    }

    if (hasF3 && f2Fim) {
        const endF2 = shiftISODate(f3Ini.value, -1);
        if (endF2) f2Fim.value = endF2;
    } else if (f2Fim && !hasF2) {
        f2Fim.value = '';
    }

    if (!hasF3 && f3Fim) f3Fim.value = '';

    if (!hasF2) {
        clearFaixaState(2);
        clearFaixaState(3);
        if (f2Ini) f2Ini.value = '';
        if (f3Ini) f3Ini.value = '';
    } else if (!hasF3) {
        clearFaixaState(3);
        if (f3Ini) f3Ini.value = '';
    }

    syncFaixaStartSnapshots();
    refreshAllCompactFaixaDateDisplays();
    updateWeeklyFaixaHoursDisplay();
}

function enforceCanonicalFaixaMode() {
    const faixasContainer = document.getElementById('container-faixas-componente');
    if (faixasContainer) faixasContainer.classList.remove('hidden');

    const btnAddOferta = document.getElementById('btn-add-oferta');
    if (btnAddOferta) {
        btnAddOferta.innerHTML = '<span class="btn-label-two-line"><span>Salvar</span><span>Componente</span></span>';
    }

    applyFaixaDateAutofill({ forceSingleBounds: true });
    refreshPendingFaixaStartPickUI();
    updateWeeklyContextNote();
}

function autoEnterWeeklyEditingForFaixa(faixaIndex) {
    if (!store.selectedTurma) return;
    const faixaEl = document.getElementById(`faixa-${faixaIndex}`);
    if (!faixaEl) return;

    const ini = getActiveFaixaStartDate(faixaIndex);
    if (!ini) return;

    activateDrawingMode(faixaIndex, {
        silent: true,
        jumpToFaixaStart: true,
        switchToWeekly: false,
        showToolbar: false
    });
}

// Limpa as 3 faixas e reposiciona a Faixa 1 no primeiro dia com a 1ª OU a 4ª
// aula livre (busca via getPreferredStartDateForCurrentTurma), deixando o desenho
// pronto para recomeçar a inserção de faixas a partir dessa data.
function handleClearFaixasRestart() {
    if (!store.selectedTurma) {
        showToastWarning('Selecione uma turma antes de limpar as faixas.', 'warning', 2200);
        return;
    }

    const hasWork = [1, 2, 3].some((n) => (faixasPatterns[n]?.length || 0) > 0)
        || [1, 2, 3].some((n) => !!document.getElementById(`inp-data-inicio-f${n}`)?.value);
    if (hasWork && !confirm('Limpar todas as faixas e recomeçar? Os slots desenhados serão apagados e a data inicial voltará para o primeiro dia com a 1ª ou 4ª aula livre.')) {
        return;
    }

    endDrawingDrag();
    if (pendingFaixaStartPick) clearPendingFaixaStartPick();
    drawingFaixaIndex = null;
    weeklyViewState.followActiveFaixa = false;
    setComponentStartSelectionMode('auto');

    // useCurrentUI: false força a busca da data disponível ignorando as faixas atuais.
    // Em EDICAO, porem, reposiciona a Faixa 1 na data inicial original da
    // componente (onde ela ja estava) em vez do primeiro dia livre recalculado.
    const editingStart = (weeklyState.editingOriginalAllocationIds.length > 0)
        ? String(weeklyState.editingComponentOriginalStart || '').trim()
        : '';
    if (editingStart) {
        collapseFaixasForNewComponent({ preferredStart: editingStart, useCurrentUI: false });
    } else {
        collapseFaixasForNewComponent({ useCurrentUI: false });
    }
    autoEnterWeeklyEditingForFaixa(1);
    updateWeeklySavePatternButton();
    updateWeeklyFaixaHoursDisplay();

    const f1Ini = document.getElementById('inp-data-inicio-f1')?.value || '';
    const humanDate = f1Ini ? formatDateBR(f1Ini) : '';
    const posicaoTxt = editingStart
        ? '(data inicial original da componente)'
        : '(primeiro dia com a 1ª ou 4ª aula livre)';
    showToastWarning(humanDate
        ? `Faixas limpas. Data inicial posicionada em ${humanDate} ${posicaoTxt}. Redesenhe os slots.`
        : 'Faixas limpas. Redesenhe os slots para a componente.', 'warning', 2800);
}

function resolveInlineEditableFaixaIndex() {
    const disciplina = normalizeDisciplinaInputValue(inputConfig.disciplina?.value || '');
    if (!store.selectedTurma || !disciplina) return null;

    const hasStart = (idx) => !!document.getElementById(`inp-data-inicio-f${idx}`)?.value;

    const current = parseInt(drawingFaixaIndex || activeFaixaIndex, 10);
    if (!Number.isNaN(current) && current >= 1 && current <= 3 && hasStart(current)) return current;

    if (hasStart(1)) return 1;
    if (hasStart(2)) return 2;
    if (hasStart(3)) return 3;
    return null;
}

function setupWeeklyInstructionsToggle() {
    const card = document.getElementById('weekly-instructions-card');
    const toggle = document.getElementById('weekly-instructions-toggle');
    if (!card || !toggle) return;

    const STORAGE_KEY = 'weekly_instructions_collapsed';
    const body = document.getElementById('weekly-instructions-body');

    const positionBody = () => {
        if (!body) return;
        const r = toggle.getBoundingClientRect();
        body.style.top = `${Math.round(r.bottom + 8)}px`;
        body.style.right = `${Math.round(window.innerWidth - r.right)}px`;
        body.style.left = 'auto';
    };

    const applyState = (collapsed) => {
        card.classList.toggle('is-collapsed', collapsed);
        toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        if (!collapsed) positionBody();
    };

    let collapsed = true;
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        collapsed = stored === null ? true : stored === '1';
    } catch (_) {
        collapsed = true;
    }
    applyState(collapsed);

    toggle.addEventListener('click', () => {
        const nextCollapsed = !card.classList.contains('is-collapsed');
        applyState(nextCollapsed);
        try {
            localStorage.setItem(STORAGE_KEY, nextCollapsed ? '1' : '0');
        } catch (_) {
            /* persistencia opcional */
        }
    });

    // Popover: fecha ao clicar fora ou pressionar Esc (sem alterar a preferencia salva)
    document.addEventListener('click', (event) => {
        if (card.classList.contains('is-collapsed')) return;
        if (card.contains(event.target)) return;
        applyState(true);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (card.classList.contains('is-collapsed')) return;
        applyState(true);
        toggle.focus();
    });

    window.addEventListener('resize', () => {
        if (!card.classList.contains('is-collapsed')) positionBody();
    });
    window.addEventListener('scroll', () => {
        if (!card.classList.contains('is-collapsed')) positionBody();
    }, true);
}

function setupFaixaControls() {
    setupFaixaQuickActions();
    for (let i = 1; i <= 3; i++) {
        const iniEl = document.getElementById(`inp-data-inicio-f${i}`);
        const fimEl = document.getElementById(`inp-data-fim-f${i}`);

        if (iniEl) {
            ['change'].forEach((evt) => {
                iniEl.addEventListener(evt, () => {
                    const previousValue = String(iniEl.dataset.lastValidValue || '').trim();
                    if (i === 3 && iniEl.value && !document.getElementById('inp-data-inicio-f2')?.value) {
                        showToastWarning('Defina primeiro o inicio da Faixa 2.', 'warning', 2200);
                        iniEl.value = '';
                        refreshCompactFaixaDateDisplay(iniEl);
                        return;
                    }

                    if (iniEl.value) {
                        const validation = getFaixaStartDateValidation(i, iniEl.value);
                        if (!validation.isValid) {
                            iniEl.value = previousValue;
                            refreshCompactFaixaDateDisplay(iniEl);
                            showToastWarning(validation.message, 'warning', 2600);
                            return;
                        }
                    }

                    if (i === 2 && !iniEl.value) {
                        clearFaixaState(2);
                        clearFaixaState(3);
                        const f3Ini = document.getElementById('inp-data-inicio-f3');
                        if (f3Ini) f3Ini.value = '';
                        activeFaixaIndex = 1;
                        if (drawingFaixaIndex && parseInt(drawingFaixaIndex, 10) > 1) drawingFaixaIndex = 1;
                    }
                    if (i === 3 && !iniEl.value) {
                        clearFaixaState(3);
                        if (drawingFaixaIndex && parseInt(drawingFaixaIndex, 10) === 3) drawingFaixaIndex = 2;
                    }

                    if (pendingFaixaStartPick === i && iniEl.value) clearPendingFaixaStartPick();
                    if (i === 1 && iniEl.value && store.selectedTurma) {
                        store.setTurmaLastStart(store.selectedTurma, iniEl.value);
                    }
                    if (i === 1) {
                        setComponentStartSelectionMode(iniEl.value ? 'manual' : 'auto');
                    }
                    applyFaixaDateAutofill();
                    setFaixaStatus(1, getFaixaSlotsAndDays(1).pattern.length);
                    setFaixaStatus(2, getFaixaSlotsAndDays(2).pattern.length);
                    setFaixaStatus(3, getFaixaSlotsAndDays(3).pattern.length);

                    if (iniEl.value) {
                        activeFaixaIndex = i;
                        autoEnterWeeklyEditingForFaixa(i);
                        return;
                    }

                    if (store.selectedTurma) renderWeeklyGrid();
                });
            });

            iniEl.addEventListener('focus', () => {
                iniEl.dataset.lastValidValue = String(iniEl.value || '').trim();
                if (!iniEl.value) return;
                activeFaixaIndex = i;
                autoEnterWeeklyEditingForFaixa(i);
            });
        }

        if (fimEl) {
            ['change'].forEach((evt) => {
                fimEl.addEventListener(evt, () => {
                    setFaixaStatus(i, getFaixaSlotsAndDays(i).pattern.length);
                    updateWeeklyFaixaHoursDisplay();
                    if (store.selectedTurma) renderWeeklyGrid();
                });
            });
        }
    }

    for (let i = 2; i <= 3; i++) {
        const faixaNumValue = document.querySelector(`#faixa-${i} .faixa-num .faixa-num-value`);
        if (!faixaNumValue || faixaNumValue.dataset.startPickBound === '1') continue;

        faixaNumValue.dataset.startPickBound = '1';
        faixaNumValue.addEventListener('click', () => {
            closeFaixaQuickActionConfirm();
            if (pendingFaixaStartPick === i) {
                clearPendingFaixaStartPick();
                showToastWarning(`Selecao de inicio da Faixa ${i} cancelada.`, 'warning', 1800);
                return;
            }
            setPendingFaixaStartPick(i);
        });
    }
    const btnCancelDraw = document.getElementById('btn-cancel-draw');
    if (btnCancelDraw) {
        btnCancelDraw.textContent = 'Limpar Padrao';
        btnCancelDraw.addEventListener('click', () => {
            const cleared = clearActiveDrawingSelection();
            if (cleared > 0) showToastWarning('Slots limpos. Desenhe o novo padrao.', 'success', 1800);
            else showToastWarning('Nao ha slots marcados para limpar.', 'warning', 1600);
        });
    }

    const btnToggleDrawView = document.getElementById('btn-toggle-draw-view');
    if (btnToggleDrawView) {
        updateDrawingViewToggleButton();
        btnToggleDrawView.addEventListener('click', () => {
            drawingViewMode = drawingViewMode === 'clean' ? 'context' : 'clean';
            updateDrawingViewToggleButton();
            if (drawingFaixaIndex) renderWeeklyGrid();
        });
    }

    const btnSaveDraw = document.getElementById('btn-save-draw');
    if (btnSaveDraw) {
        btnSaveDraw.textContent = 'Salvar (Opcional)';
        btnSaveDraw.title = 'As selecoes sao aplicadas automaticamente ao clicar/arrastar.';
        btnSaveDraw.addEventListener('click', () => {
            if (!drawingFaixaIndex) return;
            persistActiveDrawingSelection();
            deactivateDrawingMode();
        });
    }

    const btnLimparFaixas = document.getElementById('btn-limpar-faixas');
    if (btnLimparFaixas && !btnLimparFaixas.dataset.bound) {
        btnLimparFaixas.dataset.bound = '1';
        btnLimparFaixas.addEventListener('click', handleClearFaixasRestart);
    }

    if (!window.__drawingDragListenersBound) {
        window.__drawingDragListenersBound = true;
        document.addEventListener('mouseup', endDrawingDrag);
        document.addEventListener('mouseleave', endDrawingDrag);
        window.addEventListener('blur', endDrawingDrag);
    }

    for (let i = 1; i <= 3; i++) {
        setFaixaStatus(i, getFaixaSlotsAndDays(i).pattern.length);
    }
    applyFaixaDateAutofill({ forceSingleBounds: true });
    refreshPendingFaixaStartPickUI();
    updateWeeklyContextNote();
}

function hydrateFaixa1FromComponente(allocation) {
    if (!allocation || !isFaixaAllocation(allocation)) return;

    const dias = Array.isArray(allocation.diasMarcados) && allocation.diasMarcados.length > 0
        ? allocation.diasMarcados
        : (allocation.usaSabado ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5]);
    const slots = Array.isArray(allocation.horariosOcupados) ? allocation.horariosOcupados : [];
    const pattern = [];
    dias.forEach((dia) => {
        slots.forEach((slot) => pattern.push({ dia: parseInt(dia, 10), slot }));
    });
    faixasPatterns[1] = normalizeFaixaPattern(pattern);

    const ini = document.getElementById('inp-data-inicio-f1');
    const fim = document.getElementById('inp-data-fim-f1');
    if (ini && allocation.dataInicio) ini.value = allocation.dataInicio;
    if (fim && allocation.dataFim) fim.value = allocation.dataFim;

    setFaixaStatus(1, faixasPatterns[1].length);
    applyFaixaDateAutofill();
}

function hydrateFaixasFromComponente(allocation, options = {}) {
    if (!allocation || !isFaixaAllocation(allocation)) return;
    const { useStoredExecution = false } = options || {};

    weeklyState.clearFaixasPatterns();

    const resolved = useStoredExecution
        ? resolveEditableFaixasFromStoredExecution(allocation)
        : { faixas: getNormalizedIntensiveFaixas(allocation), wasAdjusted: false, adjustmentReason: '' };
    const faixas = resolved.faixas;
    if (faixas.length === 0) {
        hydrateFaixa1FromComponente(allocation);
        return resolved;
    }

    for (let i = 1; i <= 3; i++) {
        const ini = document.getElementById(`inp-data-inicio-f${i}`);
        const fim = document.getElementById(`inp-data-fim-f${i}`);
        if (ini) ini.value = '';
        if (fim) fim.value = '';
    }

    faixas.slice(0, 3).forEach((faixa, idx) => {
        const i = idx + 1;
        const ini = document.getElementById(`inp-data-inicio-f${i}`);
        const fim = document.getElementById(`inp-data-fim-f${i}`);
        if (ini) ini.value = faixa.inicio || '';
        if (fim) fim.value = faixa.fim || '';

        const pattern = [];
        Object.keys(faixa.drawnSlotsByDay || {}).forEach((dayKey) => {
            const day = parseInt(dayKey, 10);
            (faixa.drawnSlotsByDay[day] || []).forEach((slot) => pattern.push({ dia: day, slot }));
        });
        faixasPatterns[i] = normalizeFaixaPattern(pattern);
        setFaixaStatus(i, faixasPatterns[i].length);
    });

    applyFaixaDateAutofill();
    return resolved;
}

function getHolidayLabelMap() {
    const map = new Map();
    const feriados = Array.isArray(store.rawData?.feriados) ? store.rawData.feriados : [];

    feriados.forEach((entry) => {
        let data = '';
        let nome = 'Feriado';

        if (typeof entry === 'string') {
            data = entry.trim();
        } else if (entry && typeof entry === 'object') {
            data = String(entry.data || entry.date || '').trim();
            nome = String(entry.feriado || entry.nome || entry.titulo || entry.descricao || 'Feriado').trim() || 'Feriado';
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return;

        const current = map.get(data);
        if (!current) {
            map.set(data, nome);
            return;
        }

        if (current !== nome) map.set(data, `${current} / ${nome}`);
    });

    return map;
}
function getWeeklyWeekDates(weekStartISO) {
    if (!weekStartISO) return [];
    const dates = [];
    for (let i = 0; i < 6; i++) {
        dates.push(addDaysISO(weekStartISO, i));
    }
    return dates;
}

function getActiveFaixaStartDate(faixaIndex) {
    const idx = parseInt(faixaIndex, 10);
    if (Number.isNaN(idx) || idx < 1 || idx > 3) return '';
    return document.getElementById(`inp-data-inicio-f${idx}`)?.value || '';
}

function getAvailableFaixasForNavigation() {
    const out = [];
    for (let i = 1; i <= 3; i++) {
        const ini = getActiveFaixaStartDate(i);
        if (ini) out.push({ idx: i, start: ini });
    }
    return out;
}

function getCurrentFaixaNavigationPosition(faixas) {
    if (!Array.isArray(faixas) || faixas.length === 0) return -1;
    const currentIdx = parseInt(drawingFaixaIndex || activeFaixaIndex || 0, 10);
    const byActive = faixas.findIndex((f) => f.idx === currentIdx);
    if (byActive >= 0) return byActive;
    return 0;
}

function updateWeeklyFaixaNavButtons() {
    const btnFaixaPrev = document.getElementById('btn-faixa-prev');
    const btnFaixaNext = document.getElementById('btn-faixa-next');
    if (!btnFaixaPrev || !btnFaixaNext) return;

    const faixas = getAvailableFaixasForNavigation();
    const hasMultiple = faixas.length >= 2;
    btnFaixaPrev.disabled = !hasMultiple;
    btnFaixaNext.disabled = !hasMultiple;
}

function navigateWeeklyFaixa(direction = 1) {
    const faixas = getAvailableFaixasForNavigation();
    if (faixas.length < 2) return;

    const currentPos = getCurrentFaixaNavigationPosition(faixas);
    if (currentPos < 0) return;

    const step = direction < 0 ? -1 : 1;
    const targetPos = (currentPos + step + faixas.length) % faixas.length;

    const target = faixas[targetPos];
    if (!target || !target.start) return;

    activeFaixaIndex = target.idx;

    if (drawingFaixaIndex) {
        activateDrawingMode(target.idx, {
            silent: true,
            jumpToFaixaStart: true,
            switchToWeekly: true,
            showToolbar: false
        });
        return;
    }

    setWeeklyViewByDate(target.start, { followFaixa: false, render: true });
    updateWeeklyNavigatorLabel();
}

function getDefaultWeeklyAnchorDate() {
    const activeStart = getActiveFaixaStartDate(drawingFaixaIndex || activeFaixaIndex);
    const termStart = store.settings.termStart || inpTermStart?.value || calStart?.value || '';
    if (activeStart) return activeStart;
    if (termStart) return termStart;
    return toISODate(new Date());
}

function setWeeklyViewByDate(dateStr, options = {}) {
    const { followFaixa = false, render = false } = options;
    const weekStart = getWeekStartISO(dateStr || getDefaultWeeklyAnchorDate());
    if (!weekStart) return;
    weeklyViewState.weekStartISO = weekStart;
    weeklyViewState.followActiveFaixa = !!followFaixa;
    if (render) renderWeeklyGrid();
}

function queueWeeklyShiftAnimation(direction = 0) {
    pendingWeeklyShiftDirection = direction < 0 ? -1 : direction > 0 ? 1 : 0;
}

function clearWeeklyShiftAnimation() {
    if (weeklyShiftAnimationFrame) {
        cancelAnimationFrame(weeklyShiftAnimationFrame);
        weeklyShiftAnimationFrame = 0;
    }
    if (weeklyShiftAnimationTimer) {
        clearTimeout(weeklyShiftAnimationTimer);
        weeklyShiftAnimationTimer = 0;
    }
    const labelEl = document.getElementById('weekly-week-label');
    if (!labelEl) return;
    labelEl.classList.remove('is-week-sliding', 'slide-forward', 'slide-backward');
}

function playWeeklyShiftAnimation() {
    const direction = pendingWeeklyShiftDirection;
    pendingWeeklyShiftDirection = 0;
    const labelEl = document.getElementById('weekly-week-label');
    if (!direction || !labelEl) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;

    clearWeeklyShiftAnimation();
    const directionClass = direction > 0 ? 'slide-forward' : 'slide-backward';
    void labelEl.offsetWidth;

    weeklyShiftAnimationFrame = requestAnimationFrame(() => {
        labelEl.classList.add('is-week-sliding', directionClass);

        weeklyShiftAnimationTimer = setTimeout(() => {
            clearWeeklyShiftAnimation();
        }, WEEKLY_SHIFT_ANIMATION_MS + 50);
        weeklyShiftAnimationFrame = 0;
    });
}

function resolveWeeklyViewWeekStart() {
    if (!weeklyViewState.weekStartISO) {
        setWeeklyViewByDate(getDefaultWeeklyAnchorDate(), { followFaixa: !!drawingFaixaIndex, render: false });
    }
    return weeklyViewState.weekStartISO;
}

function moveWeeklyViewWeek(weekDelta = 0) {
    if (drawingFaixaIndex) persistActiveDrawingSelection();
    const currentStart = resolveWeeklyViewWeekStart();
    if (!currentStart) return;
    const nextDate = addDaysISO(currentStart, weekDelta * 7);
    queueWeeklyShiftAnimation(weekDelta);
    setWeeklyViewByDate(nextDate, { followFaixa: false, render: true });
}

function updateWeeklyNavigatorLabel() {
    const labelEl = document.getElementById('weekly-week-label');
    if (!labelEl) return;

    const weekStart = resolveWeeklyViewWeekStart();
    if (!weekStart) {
        labelEl.textContent = 'Semana n\u00e3o definida';
        updateWeeklyContextNote();
        return;
    }

    const weekEnd = addDaysISO(weekStart, 5);
    let suffix = '';

    if (drawingFaixaIndex) {
        const idx = parseInt(drawingFaixaIndex, 10);
        const ini = document.getElementById(`inp-data-inicio-f${idx}`)?.value || '';
        const fim = document.getElementById(`inp-data-fim-f${idx}`)?.value || ini;
        if (ini) {
            suffix = ` | Faixa ${idx}: ${formatDateBR(ini)} a ${formatDateBR(fim)}`;
        }
    }

    labelEl.textContent = `Semana ${formatDateBR(weekStart)} a ${formatDateBR(weekEnd)}${suffix}`;
    updateWeeklyFaixaNavButtons();
    updateWeeklyContextNote();
}

// Mensagem de BLOQUEIO persistente (ex.: salvamento barrado). Enquanto setada,
// a barra de status mostra o aviso em tom vermelho ("bloqueado") ate o usuario
// corrigir e tentar de novo — NAO some como um toast. Limpa em: nova tentativa
// de salvar (inicio de handleAddManual), reset de edicao (sucesso/turma/plano)
// e nova selecao de disciplina.
let weeklyBlockMessage = null;
function setWeeklyBlock(title, hint) {
    weeklyBlockMessage = { title, hint };
    updateWeeklyContextNote();
}
function clearWeeklyBlock() {
    weeklyBlockMessage = null;
}

function updateWeeklyContextNote() {
    const bar = document.getElementById('weekly-status-bar');
    if (!bar) return;

    const status = computeWeeklyStatus();

    bar.classList.remove('tone-info', 'tone-action', 'tone-editing', 'tone-pending', 'tone-blocked');
    bar.classList.add(`tone-${status.tone}`);

    const iconEl = bar.querySelector('.weekly-status-icon');
    const titleEl = bar.querySelector('.weekly-status-title');
    const hintEl = bar.querySelector('.weekly-status-hint');
    if (iconEl) iconEl.textContent = status.icon;
    if (titleEl) titleEl.textContent = status.title;
    if (hintEl) hintEl.textContent = status.hint;

    // Chip do "encaixe sugerido" (transparencia do deslocamento automatico).
    const chipEl = document.getElementById('weekly-status-chip');
    if (chipEl) {
        if (status.chip) {
            chipEl.innerHTML = buildStatusChipHTML(status.chip);
            chipEl.classList.remove('hidden');
        } else {
            chipEl.classList.add('hidden');
            chipEl.textContent = '';
        }
    }

    // Primeiro uso guiado: destaca no Guia Rapido o passo correspondente ao
    // estado atual ("voce esta aqui"), conectando a instrucao ao momento.
    highlightGuideStep(status.step);

    // Nota inline discreta do "dia livre antes" (gapBefore), se aplicavel.
    updateGapAdvisory();
}

// Monta o HTML do chip de encaixe sugerido: 📍 data · horario · Nº horario [em paralelo].
// Os valores vem de dados internos (datas/horas/numeros) — sem texto do usuario.
function buildStatusChipHTML(chip) {
    const parts = ['<span class="wsc-pin" aria-hidden="true">\u{1F4CD}</span>'];
    parts.push(`<span class="wsc-date">${chip.dateBR}</span>`);
    if (chip.time) {
        parts.push('<span class="wsc-sep">\u00b7</span>');
        parts.push(`<span class="wsc-time">${chip.time}</span>`);
    }
    if (chip.ordinal) {
        parts.push('<span class="wsc-sep">\u00b7</span>');
        parts.push(`<span class="wsc-ord">${chip.ordinal}\u00ba hor\u00e1rio</span>`);
    }
    if (chip.parallel) {
        parts.push('<span class="wsc-par">em paralelo</span>');
    }
    return parts.join('');
}

// Ordem (1..N) e horario do slot dentro do SEU turno (aulas, sem intervalo).
function getSlotOrdinalInfo(slotLabel) {
    const norm = normalizeConflictSlotLabel(slotLabel || '');
    const time = (String(norm).match(/\d{1,2}:\d{2}/) || [''])[0];
    const classSlots = buildHorariosForUI()
        .map((s) => normalizeConflictSlotLabel(s))
        .filter((s) => s && !s.toUpperCase().includes('INTERVALO'));
    const turno = getTurnoLetter(norm);
    const turnoSlots = classSlots.filter((s) => getTurnoLetter(s) === turno);
    const idx = turnoSlots.indexOf(norm);
    return { ordinal: idx >= 0 ? idx + 1 : null, time };
}

// Constroi o chip da sugestao ATIVA (so p/ NOVA componente cuja Faixa 1 ainda
// esta na data sugerida; se o usuario mudou a data manualmente, some).
function buildSuggestionChip(iniDate, isEditing) {
    if (isEditing) return null;
    const sug = lastStartSuggestion;
    if (!sug || !sug.date || sug.exhausted || !sug.slot) return null;
    if (sug.date !== iniDate) return null;
    const info = getSlotOrdinalInfo(sug.slot);
    return {
        dateBR: formatDateBR(sug.date),
        time: info.time || '',
        ordinal: info.ordinal || null,
        parallel: !!info.ordinal && info.ordinal > 1
    };
}

// Destaca UM passo (1..7) do Guia Rapido do cabecalho como "passo atual".
// step 0/undefined = nenhum destaque. Casa por indice (Nesimo li = passo N).
function highlightGuideStep(step) {
    const steps = document.querySelectorAll('#weekly-instructions-body .wi-step');
    steps.forEach((el, i) => {
        el.classList.toggle('wi-step--current', (i + 1) === Number(step));
    });
}

// Deriva, a partir do estado atual da Alocacao de Componentes, uma unica
// mensagem de "onde estou / proximo passo". Consolida o que antes ficava
// espalhado (nota de contexto, badge de reedicao). Ordem = prioridade.
function computeWeeklyStatus() {
    // BLOQUEIO tem prioridade maxima: fica ate o usuario corrigir e re-tentar.
    if (weeklyBlockMessage) {
        return {
            tone: 'blocked', icon: '\u26D4', step: 0,
            title: weeklyBlockMessage.title,
            hint: weeklyBlockMessage.hint
        };
    }

    const disc = getWeeklyFaixasTitleDisciplinaAtiva();
    const isEditing = (weeklyState.editingOriginalAllocationIds?.length || 0) > 0;

    if (!store.selectedTurma) {
        return {
            tone: 'info', icon: '\u{1F3AF}', step: 2,
            title: 'Comece selecionando curso e turma',
            hint: 'Na barra lateral, escolha o curso do IECOS e uma turma valida.'
        };
    }

    if (pendingFaixaStartPick) {
        const prev = pendingFaixaStartPick - 1;
        return {
            tone: 'pending', icon: '\u{1F4CC}', step: 6,
            title: `Defina o inicio da Faixa ${pendingFaixaStartPick}`,
            hint: `Clique em um horario da grade. A Faixa ${pendingFaixaStartPick} passa a substituir a Faixa ${prev} a partir dessa data.`
        };
    }

    if (!disc) {
        return {
            tone: 'info', icon: '\u{1F4DA}', step: 3,
            title: 'Selecione a componente',
            hint: 'Escolha a disciplina que vai alocar no campo "Componente" da barra lateral.'
        };
    }

    const discUpper = disc.toLocaleUpperCase('pt-BR');
    const parsedIdx = parseInt(drawingFaixaIndex || activeFaixaIndex, 10);
    const idx = (!Number.isNaN(parsedIdx) && parsedIdx >= 1 && parsedIdx <= 3) ? parsedIdx : 1;
    const ini = document.getElementById(`inp-data-inicio-f${idx}`)?.value || '';

    if (idx === 1 && !ini) {
        return {
            tone: 'action', icon: '\u{1F5D3}\uFE0F', step: 4,
            title: 'Defina a data de inicio da Faixa 1',
            hint: `Escolha a data no calendario do painel e desenhe os horarios de ${discUpper} na grade.`
        };
    }

    if (idx >= 2 && !ini) {
        return {
            tone: 'action', icon: '\u2795', step: 6,
            title: `Defina o inicio da Faixa ${idx}`,
            hint: `A Faixa ${idx} cria um novo regime de horarios que substitui a Faixa ${idx - 1}.`
        };
    }

    if (idx === 1) {
        const chip = buildSuggestionChip(ini, isEditing);
        return {
            tone: isEditing ? 'editing' : 'action',
            icon: isEditing ? '\u270F\uFE0F' : '\u{1F58A}\uFE0F', step: 5,
            title: `${isEditing ? 'Editando' : 'Desenhando'} ${discUpper} \u2014 Faixa 1`,
            hint: chip
                ? 'Encaixe automatico para poupar cliques. Nao e a semana ideal? Ajuste a data de inicio ou navegue com \u25C0 Semana / Semana \u25B6.'
                : 'Clique/arraste nos horarios vagos e clique em "Salvar Componente". Faixas 2 e 3 sao opcionais, para mudancas de horario no periodo.',
            chip
        };
    }

    const previousEnd = document.getElementById(`inp-data-fim-f${idx - 1}`)?.value || shiftISODate(ini, -1);
    return {
        tone: 'action', icon: '\u{1F58A}\uFE0F', step: 6,
        title: `Desenhando a Faixa ${idx} de ${discUpper}`,
        hint: `Substitui a Faixa ${idx - 1} a partir de ${formatDateBR(ini)} (fim da Faixa ${idx - 1}: ${formatDateBR(previousEnd)}). Desenhe o novo padrao na grade.`
    };
}

function setupWeeklyWeekNavigator() {
    if (window.__weeklyNavigatorBound) {
        updateWeeklyNavigatorLabel();
        updateWeeklySavePatternButton();
        updateWeeklyFaixaNavButtons();
        return;
    }
    window.__weeklyNavigatorBound = true;

    const btnPrev = document.getElementById('btn-week-prev');
    const btnNext = document.getElementById('btn-week-next');
    const btnFaixaPrev = document.getElementById('btn-faixa-prev');
    const btnFaixaNext = document.getElementById('btn-faixa-next');
    const btnSave = document.getElementById('btn-week-save-pattern');

    if (btnPrev) {
        btnPrev.addEventListener('click', () => {
            moveWeeklyViewWeek(-1);
        });
    }
    if (btnFaixaPrev) {
        btnFaixaPrev.addEventListener('click', () => {
            navigateWeeklyFaixa(-1);
        });
    }
    if (btnFaixaNext) {
        btnFaixaNext.addEventListener('click', () => {
            navigateWeeklyFaixa(1);
        });
    }
    if (btnNext) {
        btnNext.addEventListener('click', () => {
            moveWeeklyViewWeek(1);
        });
    }
    if (btnSave) {
        btnSave.addEventListener('click', () => {
            if (!drawingFaixaIndex) {
                showToastWarning('Defina uma faixa ativa para salvar o padrao.', 'warning', 2200);
                return;
            }
            const qtd = persistActiveDrawingSelection();
            if (qtd <= 0) {
                showToastWarning('Marque ao menos um slot para salvar o padrao.', 'warning', 2200);
                updateWeeklySavePatternButton();
                return;
            }
            const idx = parseInt(drawingFaixaIndex, 10);
            showToastWarning(`Padrao da Faixa ${idx} salvo (${qtd} slots).`, 'success', 1800);
            updateWeeklySavePatternButton();
        });
    }

    updateWeeklyNavigatorLabel();
    updateWeeklySavePatternButton();
    updateWeeklyFaixaNavButtons();
}

function isAllocationActiveInWeeklyCell(alloc, dayNumber, dateStr, horarioStr) {
    if (!alloc || !dateStr || !horarioStr) return false;

    if (isFaixaAllocation(alloc)) {
        if (Array.isArray(alloc.faixas) && alloc.faixas.length > 0) {
            const slots = getIntensiveSlotsForDate(alloc, dateStr, { dayOfWeek: dayNumber });
            return Array.isArray(slots) && slots.includes(horarioStr);
        }

        const start = alloc.dataInicio || store.settings.termStart || dateStr;
        const end = alloc.dataFim || store.settings.termEnd || start;
        if (!isDateInsideRange(dateStr, start, end)) return false;

        const dias = Array.isArray(alloc.diasMarcados) && alloc.diasMarcados.length > 0
            ? alloc.diasMarcados
            : (alloc.usaSabado ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5]);
        const slots = Array.isArray(alloc.horariosOcupados) ? alloc.horariosOcupados : [];
        return dias.includes(dayNumber) && slots.includes(horarioStr);
    }

    if (isScheduledRegularAllocation(alloc)) {
        const start = alloc.dataInicio || store.settings.termStart || dateStr;
        const end = alloc.dataFim || store.settings.termEnd || start;
        if (!isDateInsideRange(dateStr, start, end)) return false;
        return parseInt(alloc.diaSemana, 10) === dayNumber && alloc.horario === horarioStr;
    }

    return false;
}
function collectIntensiveFaixasFromPatternMap(patternsMap = {}, fallbackInicio) {
    const faixas = [];

    for (let i = 1; i <= 3; i++) {
        const inicio = (document.getElementById(`inp-data-inicio-f${i}`)?.value || (i === 1 ? fallbackInicio : '')).trim();
        const fim = (document.getElementById(`inp-data-fim-f${i}`)?.value || '').trim() || null;
        const pattern = normalizeFaixaPattern(patternsMap?.[i]);

        if (!inicio) {
            if (i === 1) throw new Error('Defina a data de inicio da Faixa 1.');
            if (pattern.length > 0 || fim) throw new Error(`Defina a data de inicio da Faixa ${i}.`);
            continue;
        }

        let drawnSlotsByDay = {};
        pattern.forEach((p) => {
            if (!drawnSlotsByDay[p.dia]) drawnSlotsByDay[p.dia] = [];
            drawnSlotsByDay[p.dia].push(p.slot);
        });
        drawnSlotsByDay = normalizeDrawnSlotsByDay(drawnSlotsByDay);

        const normFaixa = normalizeFaixaEntry({ inicio, fim, drawnSlotsByDay });
        if (!normFaixa) {
            throw new Error(`Desenhe horarios validos para a Faixa ${i}.`);
        }

        faixas.push(normFaixa);
    }

    const sorted = faixas.sort((a, b) => a.inicio.localeCompare(b.inicio));
    for (let i = 0; i < sorted.length - 1; i++) {
        sorted[i].fim = addDaysISO(sorted[i + 1].inicio, -1);
    }
    return sorted;
}

function collectIntensiveFaixasFromUI(fallbackInicio) {
    return collectIntensiveFaixasFromPatternMap(buildEffectiveFaixaPatternMap(), fallbackInicio);
}

function buildFinalAdjustmentSuggestionMessage(suggestion) {
    const rangeLabel = suggestion?.adjustmentStart && suggestion?.adjustmentEnd
        ? `${formatDateBR(suggestion.adjustmentStart)} a ${formatDateBR(suggestion.adjustmentEnd)}`
        : '';

    if (suggestion?.reason === 'partial-day-same-dow') {
        return rangeLabel
            ? `Ok, 2ª faixa criada para ajuste final (${rangeLabel}). Dias finais no mesmo dia da semana — refine os slots se precisar.`
            : 'Ok, 2ª faixa criada para ajuste final. Dias finais no mesmo dia da semana — refine os slots se precisar.';
    }

    if (suggestion?.reason === 'tail-regime-change') {
        return rangeLabel
            ? `Ok, 2ª faixa criada para ajuste final (${rangeLabel}). Ultimos dias fora do regime principal — ajuste os slots se quiser refinar.`
            : 'Ok, 2ª faixa criada para ajuste final. Ultimos dias fora do regime principal — ajuste os slots se quiser refinar.';
    }

    return rangeLabel
        ? `Ok, 2ª faixa criada para ajuste final (${rangeLabel}). Ajuste os slots se quiser refinar.`
        : 'Ok, 2ª faixa criada para ajuste final. Ajuste os slots se quiser refinar.';
}

function applyFinalAdjustmentFaixaSuggestion(suggestion, options = {}) {
    const { showToast = true } = options;
    if (!suggestion?.faixas || suggestion.faixas.length === 0) return;

    const previewAlloc = {
        modo: 'faixas',
        faixas: suggestion.faixas
    };

    hydrateFaixasFromComponente(previewAlloc);
    activeFaixaIndex = suggestion.adjustmentFaixaIndex || suggestion.faixas.length;
    autoEnterWeeklyEditingForFaixa(activeFaixaIndex);
    updateWeeklyContextNote();
    updateWeeklyFaixaHoursDisplay();
    renderWeeklyGrid();
    switchTab('weekly');

    if (showToast) {
        showToastWarning(buildFinalAdjustmentSuggestionMessage(suggestion), 'success', 9000);
    }
}

function buildIntensiveConflictFaixas(intense, rangeStart, rangeEnd) {
    if (!intense) return [];

    const fallbackStart = rangeStart || intense.dataInicio || store.settings.termStart || '';
    const fallbackEnd = rangeEnd || intense.dataFim || store.settings.termEnd || fallbackStart;
    const normalized = getNormalizedIntensiveFaixas(intense);

    if (normalized.length === 0) {
        const dias = Array.isArray(intense.diasMarcados) && intense.diasMarcados.length > 0
            ? intense.diasMarcados
            : (intense.usaSabado ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5]);
        const slots = Array.isArray(intense.horariosOcupados) ? intense.horariosOcupados : [];
        if (!fallbackStart || !fallbackEnd || dias.length === 0 || slots.length === 0) return [];

        const byDay = {};
        dias.forEach((d) => { byDay[d] = [...slots]; });
        return [{ inicio: fallbackStart, fim: fallbackEnd, byDay }];
    }

    const faixas = normalized.map((faixa, idx) => {
        let inicio = faixa.inicio || fallbackStart;
        let fim = faixa.fim || '';

        if (!fim) {
            if (idx < normalized.length - 1) fim = addDaysISO(normalized[idx + 1].inicio, -1);
            else fim = fallbackEnd || inicio;
        }

        if (!inicio || !fim) return null;
        if (fallbackStart && inicio < fallbackStart) inicio = fallbackStart;
        if (fallbackEnd && fim > fallbackEnd) fim = fallbackEnd;
        if (inicio > fim) return null;

        const byDay = normalizeDrawnSlotsByDay(faixa.drawnSlotsByDay || {});
        if (Object.keys(byDay).length === 0) {
            const dias = Array.isArray(faixa.dias) ? faixa.dias : [];
            const slots = Array.isArray(faixa.slots) ? faixa.slots : [];
            dias.forEach((d) => { if (slots.length > 0) byDay[d] = [...slots]; });
        }

        if (Object.keys(byDay).length === 0) return null;
        return { inicio, fim, byDay };
    }).filter(Boolean);

    return faixas;
}

function syncAllRegularDates() {
    const termStart = store.settings.termStart || '2025-01-01';
    const termEnd = store.settings.termEnd || '2025-12-31';
    const feriadosSet = new Set((store.rawData?.feriados || []).map(f => f.data || f));

    const regularGroups = {};
    store.allocations.forEach(a => {
        if (isScheduledRegularAllocation(a)) {
            const key = `${a.turmaId}|${a.disciplina}`;
            if (!regularGroups[key]) regularGroups[key] = [];
            regularGroups[key].push(a);
        }
    });

    Object.keys(regularGroups).forEach(key => {
        const group = regularGroups[key];
        const turmaId = group[0].turmaId;
        const disciplina = group[0].disciplina;

        const maxCH = getDisciplinaCHGlobal(disciplina, turmaId);
        if (maxCH === 0) return;

        // Limpa resíduos de cálculos ímpares anteriores do último dia antes de recalcular a nova distribuição
        group.forEach(a => delete a.horariosUltimoDia);

        let startDate = group.reduce((min, a) => {
            const s = a.dataInicio || termStart;
            return s < min ? s : min;
        }, "2099-12-31");

        if (startDate === "2099-12-31") startDate = termStart;

        let classesFound = 0;
        let currentDate = new Date(startDate + "T12:00:00");
        let lastValidDate = new Date(currentDate);
        let loops = 0;

        while (classesFound < maxCH && loops < 365) {
            const dow = currentDate.getDay();
            const dStr = currentDate.toISOString().split('T')[0];
            if (termEnd && dStr > termEnd) break;

            const slotsToday = group.filter(a => parseInt(a.diaSemana) === dow);

            if (slotsToday.length > 0 && !feriadosSet.has(dStr)) {

                const dayIsSuspended = store.allocations.some(other => {
                    if (String(other.turmaId) !== String(turmaId)) return false;

                    const oStart = other.dataInicio || termStart;
                    const oEnd = other.dataFim || termEnd;

                    if (dStr >= oStart && dStr <= oEnd) {
                        // No modelo canônico atual, regular não é suspensa por intensiva.
                        if (isPriorityRegularAllocation(other) && parseInt(other.diaSemana) === dow && other.disciplina !== disciplina) {
                            return slotsToday.some(slot => other.horario === slot.horario);
                        }
                    }
                    return false;
                });

                if (!dayIsSuspended) {
                    const chRestante = maxCH - classesFound;

                    if (chRestante > 0 && slotsToday.length <= chRestante) {
                        classesFound += slotsToday.length;
                        lastValidDate = new Date(currentDate);
                    } else if (chRestante > 0 && slotsToday.length > chRestante) {
                        // É o último dia e sobra menos CH do que os slots mapeados.
                        classesFound += chRestante;
                        lastValidDate = new Date(currentDate);

                        // Separar os primeiros 'chRestante' slots para que eles sejam os válidos
                        // (Isso reflete diretamente a necessidade de não desenhar horas extras impares na UI)
                        const partialSlotsForLastDay = slotsToday.slice(0, chRestante).map(s => s.horario);
                        group.forEach(a => {
                            if (parseInt(a.diaSemana) === dow) {
                                a.horariosUltimoDia = partialSlotsForLastDay;
                            }
                        });
                    }
                }
            }

            if (classesFound >= maxCH) break;
            currentDate.setDate(currentDate.getDate() + 1);
            loops++;
        }

        const finalEndStr = lastValidDate.toISOString().split('T')[0];
        group.forEach(a => {
            a.dataFim = finalEndStr;
        });
    });

    store.saveAllocations();
}

/**
 * Sincroniza as datas de todas as ofertas por faixas da turma atual.
 * Robusto e genérico para qualquer CH e combinação de horários.
 */
function syncAllIntensiveDates() {
    const ofertasPorFaixa = store.allocations.filter((a) => isFaixaAllocation(a));

    ofertasPorFaixa.forEach(intense => {
        const execution = computeIntensiveExecution(intense, { respectPriority: true, respectTurmaOccupancy: true });
        if (execution.dataInicio) intense.dataInicio = execution.dataInicio;
        if (execution.dataFim) intense.dataFim = execution.dataFim;
        intense.horariosUltimoDia = execution.horariosUltimoDia || [];
        intense.executionByDate = execution.byDate || {};
        intense.horariosOcupados = execution.unionSlots || intense.horariosOcupados || [];
        intense.diasMarcados = execution.unionDias || intense.diasMarcados || [];
        intense.usaSabado = (intense.diasMarcados || []).includes(6);
        const sourceFaixas = (Array.isArray(intense.faixas) && intense.faixas.length > 0)
            ? intense.faixas
            : getNormalizedIntensiveFaixas(intense);
        intense.faixas = alignFaixasToExecutionEnd(sourceFaixas, intense.dataFim || execution.dataFim);
    });

    // REAÇÃO EM CADEIA: Após ajustar as Intensivas, 
    // precisamos ajustar as Regulares que podem ter sido empurradas por elas.
    syncAllRegularDates();

    store.saveAllocations();
}

function buildScopedSigaaAllocationFromOfferFaixa(offerGroup, faixa, planContext = {}) {
    const base = offerGroup?.baseAlloc || (Array.isArray(offerGroup?.allocations) ? offerGroup.allocations[0] : null) || {};
    const rawDrawnSlotsByDay = faixa?.drawnSlotsByDay || offerGroup?.timeRangesByDay || {};
    const dias = [...new Set(
        (Array.isArray(faixa?.dias) ? faixa.dias : Object.keys(rawDrawnSlotsByDay))
            .map((value) => Number.parseInt(value, 10))
            .filter((value) => value >= 1 && value <= 6)
    )].sort((left, right) => left - right);
    const slots = [...new Set(
        (Array.isArray(faixa?.slots) && faixa.slots.length > 0 ? faixa.slots : Object.values(rawDrawnSlotsByDay).flat())
            .map((value) => String(value || '').trim())
            .filter(Boolean)
    )].sort((left, right) => timeToMinutes(left) - timeToMinutes(right));
    const drawnSlotsByDay = {};

    dias.forEach((day) => {
        const daySlots = Array.isArray(rawDrawnSlotsByDay?.[day]) && rawDrawnSlotsByDay[day].length > 0
            ? rawDrawnSlotsByDay[day]
            : slots;
        drawnSlotsByDay[day] = [...new Set(daySlots.map((value) => String(value || '').trim()).filter(Boolean))]
            .sort((left, right) => timeToMinutes(left) - timeToMinutes(right));
    });

    const inicio = String(faixa?.inicio || offerGroup?.start || base?.dataInicio || planContext.termStart || '').trim();
    const fim = String(faixa?.fim || offerGroup?.end || base?.dataFim || planContext.termEnd || inicio || '').trim();

    return {
        ...base,
        modo: 'faixas',
        ch: 0,
        dataInicio: inicio,
        dataFim: fim,
        diasMarcados: dias,
        horariosOcupados: slots,
        usaSabado: dias.includes(6),
        faixas: [{
            inicio,
            fim,
            dias,
            slots,
            drawnSlotsByDay
        }]
    };
}

function getSigaaCode(allocsForClass) {
    function buildSigaaSlotsMap() {
        // Usa os numeros SIGAA explicitos do regime ativo (coluna `sigaa` da planilha).
        // O 4o horario (intervalo) nao tem numero e e ignorado.
        const entries = (typeof store.getActiveSigaaSlots === 'function') ? store.getActiveSigaaSlots() : [];
        const dynamicSlots = [];

        entries.forEach((entry) => {
            const shiftCode = getGanttTurnoCode(entry.turno);
            if (!['M', 'T', 'N'].includes(shiftCode)) return;
            const sigaaNum = parseInt(entry.sigaa, 10);
            if (!Number.isFinite(sigaaNum) || sigaaNum <= 0) return;
            const rawLabel = String(entry.faixa || '');
            if (!rawLabel || rawLabel.toUpperCase().includes('INTERVALO')) return;
            const startMinutes = timeToMinutes(cleanHorarioLabel(rawLabel));
            if (!Number.isFinite(startMinutes) || startMinutes >= 99999) return;
            dynamicSlots.push({ m: startMinutes, s: shiftCode, sl: sigaaNum });
        });

        if (dynamicSlots.length > 0) {
            return dynamicSlots.sort((a, b) => (a.m - b.m) || a.s.localeCompare(b.s) || (a.sl - b.sl));
        }

        return [
            { m: 450, s: 'M', sl: 1 }, { m: 500, s: 'M', sl: 2 }, { m: 550, s: 'M', sl: 3 },
            { m: 620, s: 'M', sl: 4 }, { m: 670, s: 'M', sl: 5 }, { m: 720, s: 'M', sl: 6 },
            { m: 810, s: 'T', sl: 1 }, { m: 860, s: 'T', sl: 2 }, { m: 910, s: 'T', sl: 3 },
            { m: 980, s: 'T', sl: 4 }, { m: 1030, s: 'T', sl: 5 }, { m: 1080, s: 'T', sl: 6 },
            { m: 1110, s: 'N', sl: 1 }, { m: 1160, s: 'N', sl: 2 }, { m: 1210, s: 'N', sl: 3 }, { m: 1260, s: 'N', sl: 4 }
        ];
    }

    const slotsMap = buildSigaaSlotsMap();

    function getSlot(horario) {
        if (!horario) return null;
        const min = timeToMinutes(horario);
        for (let i = slotsMap.length - 1; i >= 0; i--) {
            if (min >= slotsMap[i].m - 10 && min <= slotsMap[i].m + 40) return slotsMap[i];
        }
        return null;
    }

    const slotsList = [];
    allocsForClass.forEach(a => {
        if (isScheduledRegularAllocation(a)) {
            const dSigaa = parseInt(a.diaSemana) + 1;
            const sInfo = getSlot(a.horario);
            if (sInfo) slotsList.push({ day: dSigaa, shift: sInfo.s, slot: sInfo.sl });
        } else if (isFaixaAllocation(a)) {
            const execution = computeIntensiveExecution(a, { respectPriority: true, respectTurmaOccupancy: true });
            const byDate = execution.byDate || {};
            Object.keys(byDate).sort().forEach((dStr) => {
                const dSigaa = new Date(dStr + "T12:00:00").getDay() + 1;
                (byDate[dStr] || []).forEach((h) => {
                    const sInfo = getSlot(h);
                    if (sInfo) slotsList.push({ day: dSigaa, shift: sInfo.s, slot: sInfo.sl });
                });
            });
        }
    });

    if (slotsList.length === 0) return '-';

    const unique = [];
    const seen = new Set();
    slotsList.forEach(s => {
        const key = `${s.day}-${s.shift}-${s.slot}`;
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(s);
        }
    });

    const dayShiftMap = {};
    unique.forEach(s => {
        const k = `${s.day}${s.shift}`;
        if (!dayShiftMap[k]) dayShiftMap[k] = [];
        dayShiftMap[k].push(s.slot);
    });

    const shiftSlotsMap = {};
    for (const k in dayShiftMap) {
        dayShiftMap[k].sort((a, b) => a - b);
        const day = k.charAt(0);
        const shift = k.charAt(1);
        const slotsStr = dayShiftMap[k].join('');
        const comboKey = `${shift}${slotsStr}`;
        if (!shiftSlotsMap[comboKey]) shiftSlotsMap[comboKey] = [];
        shiftSlotsMap[comboKey].push(day);
    }

    const parts = [];
    for (const combo in shiftSlotsMap) {
        const shift = combo.charAt(0);
        const slotsStr = combo.substring(1);
        const daysStr = shiftSlotsMap[combo].sort().join('');
        parts.push(`${daysStr}${shift}${slotsStr}`);
    }

    parts.sort();
    return parts.join(' ');
}

function getOfficialPeriodoLetivoPlans() {
    const rawPlans = Array.isArray(store.rawData?.periodos_letivos) ? store.rawData.periodos_letivos : [];
    const plans = rawPlans
        .map((item) => {
            const periodo = normalizePeriodoLetivoCode(item?.periodo_letivo || item?.periodo || '');
            const termStart = String(item?.inicio || '').trim();
            const termEnd = String(item?.fim || '').trim();
            const ano = String(item?.ano || '').trim();
            const normalized = store.getPlanMetaFromSettings({ periodo, termStart, termEnd });
            if (!normalized?.key) return null;
            return {
                ...normalized,
                ano,
                label: item?.label || `${ano ? `${ano} - ` : ''}${normalized.periodo}`
            };
        })
        .filter(Boolean)
        .sort((a, b) => {
            const byStart = String(a.termStart || '').localeCompare(String(b.termStart || ''));
            if (byStart !== 0) return byStart;
            return String(a.periodo || '').localeCompare(String(b.periodo || ''));
        });

    return plans;
}


function populateTurnoOfertaOptions(preferredValue = store.settings.turnoOferta || '') {
    if (!selTurnoOferta) return;
    const options = getAvailableTurnoOfertaOptions();
    selTurnoOferta.innerHTML = '';

    options.forEach((option) => {
        const opt = document.createElement('option');
        opt.value = option.value;
        opt.textContent = option.label;
        selTurnoOferta.appendChild(opt);
    });

    selTurnoOferta.value = resolveTurnoOfertaValue(preferredValue);
}

function getSuggestedOfficialPeriodoLetivoPlan() {
    const plans = getOfficialPeriodoLetivoPlans();
    if (!plans.length) return null;

    const today = new Date().toISOString().slice(0, 10);
    const currentPlan = plans.find((plan) => plan.termStart <= today && plan.termEnd >= today);
    if (currentPlan) return currentPlan;

    const nextPlan = plans.find((plan) => plan.termStart >= today);
    return nextPlan || plans[plans.length - 1];
}

function resolveOfficialPeriodoLetivoPlan(preferredMeta = null) {
    const plans = getOfficialPeriodoLetivoPlans();
    const fallback = preferredMeta ? store.getPlanMetaFromSettings(preferredMeta) : store.getPlanMetaFromSettings();
    return resolveActiveAcademicPeriod({
        plans,
        preferredMeta: fallback,
        fallbackMeta: getSuggestedOfficialPeriodoLetivoPlan() || fallback
    });
}

function buildPeriodoLetivoOptionLabel(plan) {
    if (!plan) return 'Periodo letivo';
    const prefix = plan.ano ? `${plan.ano} - ` : '';
    return `${prefix}${plan.periodo} (${formatDateBRShortYear(plan.termStart)} a ${formatDateBRShortYear(plan.termEnd)})`;
}

function populatePeriodoLetivoOptions(preferredMeta = null) {
    const selPeriodo = document.getElementById('sel-periodo-letivo');
    if (!selPeriodo) return;

    const currentMeta = resolveOfficialPeriodoLetivoPlan(preferredMeta || store.getActivePlanMeta());
    const officialPlans = getOfficialPeriodoLetivoPlans();
    selPeriodo.innerHTML = '';

    if (officialPlans.length > 0) {
        officialPlans.forEach((plan) => {
            const opt = document.createElement('option');
            opt.value = plan.key;
            opt.textContent = buildPeriodoLetivoOptionLabel(plan);
            opt.dataset.periodo = plan.periodo;
            opt.dataset.termStart = plan.termStart;
            opt.dataset.termEnd = plan.termEnd;
            selPeriodo.appendChild(opt);
        });

        selPeriodo.value = currentMeta?.key || officialPlans[0].key;
        return;
    }

    ['PL1', 'PL2', 'PL3', 'PL4'].forEach((code) => {
        const opt = document.createElement('option');
        opt.value = code;
        opt.textContent = code;
        selPeriodo.appendChild(opt);
    });

    selPeriodo.value = currentMeta.periodo || 'PL1';
}

function getSelectedPeriodoLetivoMeta() {
    const selPeriodo = document.getElementById('sel-periodo-letivo');
    const option = selPeriodo?.selectedOptions?.[0];
    if (!option) return resolveOfficialPeriodoLetivoPlan();

    const periodo = normalizePeriodoLetivoCode(option.dataset.periodo || option.value || store.settings.periodo);
    const termStart = option.dataset.termStart || store.settings.termStart;
    const termEnd = option.dataset.termEnd || store.settings.termEnd;

    return resolveOfficialPeriodoLetivoPlan({
        periodo,
        termStart,
        termEnd
    });
}

// ---------------------------------------------------------------------------
// PERIODO DE VISUALIZACAO (viewport) — DESACOPLADO do termo do PL.
// Os inputs #cal-start / #cal-end passam a ser uma JANELA de visualizacao livre
// (a direcao pode olhar qualquer intervalo, inclusive fora do termo do PL). O
// viewport e persistido POR PLANO (chave do PL) no localStorage; sem override,
// usa o termo do PL como padrao. Editar o termo do PL continua sendo pelos
// campos "Inicio/Fim" da barra lateral (#inp-term-start / #inp-term-end).
// ---------------------------------------------------------------------------
const CALENDAR_VIEWPORT_STORAGE_KEY = 'calendar_viewport_v1';

function getCalendarViewportMap() {
    try {
        return JSON.parse(localStorage.getItem(CALENDAR_VIEWPORT_STORAGE_KEY)) || {};
    } catch (e) {
        return {};
    }
}

function getActivePlanKey() {
    return store.getActivePlanMeta()?.key || '';
}

function getStoredCalendarViewport(planKey = getActivePlanKey()) {
    if (!planKey) return null;
    const entry = getCalendarViewportMap()[planKey];
    if (entry && entry.start && entry.end) return { start: entry.start, end: entry.end };
    return null;
}

function saveCalendarViewport(start, end, planKey = getActivePlanKey()) {
    if (!planKey || !start || !end) return;
    const map = getCalendarViewportMap();
    map[planKey] = { start, end };
    try {
        localStorage.setItem(CALENDAR_VIEWPORT_STORAGE_KEY, JSON.stringify(map));
    } catch (e) { /* ignore */ }
}

function clearCalendarViewport(planKey = getActivePlanKey()) {
    if (!planKey) return;
    const map = getCalendarViewportMap();
    if (map[planKey]) {
        delete map[planKey];
        try {
            localStorage.setItem(CALENDAR_VIEWPORT_STORAGE_KEY, JSON.stringify(map));
        } catch (e) { /* ignore */ }
    }
}

// Re-renderiza o calendario/gantt da aba ativa (turma ou docente) com o
// intervalo atual dos inputs. Nao toca no termo do PL.
function refreshActiveCalendarView() {
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    if (activeTab === 'monthly') {
        renderActiveSubtab('tab-monthly', 'turma-calendar');
    } else if (activeTab === 'teacher') {
        renderActiveSubtab('tab-teacher', 'docente-calendar');
    }
}

// Mantem os inputs de viewport da aba Docente espelhando os da aba Turma
// (ambos apontam para a MESMA janela de visualizacao persistida por PL).
function syncTeacherViewportInputs() {
    if (calStartTeacher && calStart) calStartTeacher.value = calStart.value || '';
    if (calEndTeacher && calEnd) calEndTeacher.value = calEnd.value || '';
}

// Chamado quando o usuario altera as datas de visualizacao (change) ou clica em
// "Atualizar": valida, persiste por PL e redesenha a visao ativa.
function handleCalendarViewportChange() {
    const start = calStart?.value || '';
    const end = calEnd?.value || '';
    if (start && end && start > end) {
        showToastWarning('A data inicial e posterior a data final. Ajuste o intervalo de visualizacao.', 'warning', 2800);
        return;
    }
    saveCalendarViewport(start, end);
    syncTeacherViewportInputs();
    refreshActiveCalendarView();
}

// Versao para os inputs da aba Docente: copia os valores para os inputs
// canonicos (#cal-start/#cal-end, lidos pelo motor de render) e reaproveita o
// fluxo padrao de viewport.
function handleTeacherViewportChange() {
    if (calStart && calStartTeacher) calStart.value = calStartTeacher.value || '';
    if (calEnd && calEndTeacher) calEnd.value = calEndTeacher.value || '';
    handleCalendarViewportChange();
}

// Volta o viewport ao termo do PL vigente (limpa o override persistido).
function resetCalendarViewportToPlan() {
    clearCalendarViewport();
    if (calStart) calStart.value = store.settings.termStart || '';
    if (calEnd) calEnd.value = store.settings.termEnd || '';
    syncTeacherViewportInputs();
    refreshActiveCalendarView();
}

function syncPlanInputsFromStore(preferredMeta = null) {
    const selPeriodo = document.getElementById('sel-periodo-letivo');
    if (inpTermStart) inpTermStart.value = store.settings.termStart || '';
    if (inpTermEnd) inpTermEnd.value = store.settings.termEnd || '';
    // Viewport: usa o override persistido do PL, senao o termo do PL como padrao.
    const viewport = getStoredCalendarViewport((preferredMeta || store.getActivePlanMeta())?.key || '');
    if (calStart) calStart.value = (viewport?.start) || store.settings.termStart || '';
    if (calEnd) calEnd.value = (viewport?.end) || store.settings.termEnd || '';
    syncTeacherViewportInputs();
    populatePeriodoLetivoOptions(preferredMeta || store.getActivePlanMeta());
    populateTurnoOfertaOptions(store.settings.turnoOferta || 'Tarde');
    if (selPeriodo) {
        const currentMeta = resolveOfficialPeriodoLetivoPlan(preferredMeta || store.getActivePlanMeta());
        const optionValues = Array.from(selPeriodo.options).map((opt) => opt.value);
        const preferredValue =
            optionValues.find((value) => value === currentMeta.key) ||
            optionValues.find((value) => value === currentMeta.periodo) ||
            optionValues[0] ||
            '';
        selPeriodo.value = preferredValue;
    }
}

function getPlanDisplayLabel(meta) {
    if (!meta?.key) return 'Plano letivo ainda n\u00e3o definido.';
    return `${meta.periodo} | ${formatDateBR(meta.termStart)} a ${formatDateBR(meta.termEnd)}`;
}

function updateActivePlanStatus() {
    if (!activePlanStatus) return;
    const activeMeta = store.getActivePlanMeta();
    if (!activeMeta?.key) {
        activePlanStatus.textContent = 'Plano ativo ainda n\u00e3o definido.';
        return;
    }
    const total = Array.isArray(store.allocations) ? store.allocations.length : 0;
    activePlanStatus.textContent = `Plano ativo: ${getPlanDisplayLabel(activeMeta)} | ${total} oferta(s)`;
}

function resetWeeklyDraftStateForPlanSwitch(preferredStart = '') {
    deactivateDrawingMode();
    resetEditingComponentState();
    pendingFaixaStartPick = null;
    pendingFaixaQuickActionConfirm = null;
    weeklyState.clearFaixasPatterns();
    setFaixaStatus(1, 0);
    setFaixaStatus(2, 0);
    setFaixaStatus(3, 0);
    collapseFaixasForNewComponent({
        preferredStart,
        useCurrentUI: false
    });
    updateWeeklyFaixasTitleDisciplina();
    updateWeeklyFaixaHoursDisplay();
}

function rerenderPlanBoundViews() {
    renderWeeklyGrid();
    renderOfertasList();

    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    if (activeTab === 'monthly') {
        renderActiveSubtab('tab-monthly', 'turma-calendar');
    } else if (activeTab === 'teacher' && selViewDocente?.value) {
        renderActiveSubtab('tab-teacher', 'docente-calendar');
    }
}

function applyPlanContextToUI(planMeta = {}, options = {}) {
    const previousKey = store.getActivePlanMeta().key;
    const result = store.applyPlanContext(planMeta);
    const didChangePlan = result.meta.key !== previousKey;
    const planStart = result.meta.termStart || store.settings.termStart || '';

    if (didChangePlan) {
        setComponentStartSelectionMode('auto');
        clearAllocationUndoSnapshot();
    }

    syncPlanInputsFromStore(result.meta);
    updateActivePlanStatus();

    if (options.resetDraftOnChange !== false && didChangePlan) {
        resetWeeklyDraftStateForPlanSwitch(planStart);
    }

    const selectionState = syncCursoTurmaSelectionAfterPlanChange();

    const preferredStart = didChangePlan
        ? planStart
        : getPreferredStartDateForCurrentTurma();
    if (didChangePlan) {
        resetWeeklyEditorForTurma(selectionState.nextTurma, {
            preferredStart: planStart,
            resetWeekToPlanStart: true
        });
    }

    applyFaixaDateAutofill({ forceSingleBounds: true, preferredStart });
    refreshPendingFaixaStartPickUI();
    updateWeeklyContextNote();
    syncAllIntensiveDates();
    populateDocentes();
    updateDisciplinaDatalist();
    rerenderPlanBoundViews();

    return result;
}

function applyPlanContextFromInputs(overrides = {}) {
    const selectedMeta = resolveOfficialPeriodoLetivoPlan({
        periodo: overrides.periodo !== undefined
            ? normalizePeriodoLetivoCode(overrides.periodo)
            : (getSelectedPeriodoLetivoMeta()?.periodo || store.settings.periodo || 'PL1'),
        termStart: overrides.termStart !== undefined ? overrides.termStart : store.settings.termStart,
        termEnd: overrides.termEnd !== undefined ? overrides.termEnd : store.settings.termEnd
    });
    return applyPlanContextToUI(selectedMeta, overrides.options || {});
}


function initPeriodoLetivoETurno() {
    const suggestedOfficialPlan = resolveOfficialPeriodoLetivoPlan();
    const defaultStart = calStart && calStart.value ? calStart.value : '';
    const defaultEnd = calEnd && calEnd.value ? calEnd.value : '';
    const selPeriodo = document.getElementById('sel-periodo-letivo');

    if (!store.settings.termStart) store.settings.termStart = suggestedOfficialPlan?.termStart || defaultStart;
    if (!store.settings.termEnd) store.settings.termEnd = suggestedOfficialPlan?.termEnd || defaultEnd;
    if (!store.settings.periodo) store.settings.periodo = suggestedOfficialPlan?.periodo || 'PL1';
    if (!store.settings.turnoOferta) store.settings.turnoOferta = resolveTurnoOfertaValue('Tarde');
    store.saveSettings();

    syncPlanInputsFromStore();
    populateTurnoOfertaOptions(store.settings.turnoOferta || 'Tarde');

    if (selPeriodo) {
        selPeriodo.addEventListener('change', () => {
            const selectedMeta = getSelectedPeriodoLetivoMeta();
            applyPlanContextToUI(selectedMeta || { periodo: selPeriodo.value });
        });
    }

    if (inpTermStart) {
        inpTermStart.addEventListener('change', () => {
            applyPlanContextFromInputs({ termStart: inpTermStart.value });
        });
    }
    if (inpTermEnd) {
        inpTermEnd.addEventListener('change', () => {
            applyPlanContextFromInputs({ termEnd: inpTermEnd.value });
        });
    }

    // Datas de visualizacao (viewport) — NAO editam o termo do PL; apenas mudam
    // a janela exibida do calendario/gantt. O termo do PL segue nos campos
    // Inicio/Fim da barra lateral (#inp-term-start / #inp-term-end).
    if (calStart) {
        calStart.addEventListener('change', handleCalendarViewportChange);
    }
    if (calEnd) {
        calEnd.addEventListener('change', handleCalendarViewportChange);
    }
    if (calStartTeacher) {
        calStartTeacher.addEventListener('change', handleTeacherViewportChange);
    }
    if (calEndTeacher) {
        calEndTeacher.addEventListener('change', handleTeacherViewportChange);
    }

    applyPlanContextFromInputs({ options: { resetDraftOnChange: false } });
    if (selTurnoOferta) {
        selTurnoOferta.addEventListener('change', () => {
            store.setTurnoOferta(selTurnoOferta.value);
            renderWeeklyGrid();
            renderOfertasList();
        });
    }
}

// ==== IMPORTAÇÃO DE BLOCO ====
function normalizePeriodoToNumber(value) {
    const raw = String(value || '').trim().toUpperCase();
    if (!raw) return '';

    const numMatch = raw.match(/\d{1,2}/);
    if (numMatch) return String(parseInt(numMatch[0], 10));

    const romanMap = {
        I: '1',
        II: '2',
        III: '3',
        IV: '4',
        V: '5',
        VI: '6',
        VII: '7',
        VIII: '8',
        IX: '9',
        X: '10'
    };

    const romanOnly = raw.replace(/[^IVX]/g, '');
    if (romanOnly && romanMap[romanOnly]) return romanMap[romanOnly];

    return '';
}

function handleImportBloco() {
    if (!store.selectedCurso || !store.selectedTurma) {
        showToastWarning('Selecione um Curso e uma Turma primeiro.', 'warning', 2600);
        return;
    }

    const comps = store.rawData?.componentes?.filter(c => c.sigla === store.selectedCurso) || [];
    if (comps.length === 0) {
        showToastWarning('Nenhum componente encontrado para este curso no arquivo mestre.', 'warning', 2800);
        return;
    }

    const periodosDisponiveisNoCurso = [...new Set(comps
        .map(c => normalizePeriodoToNumber(c.periodo))
        .filter(Boolean))]
        .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

    if (periodosDisponiveisNoCurso.length === 0) {
        showToastWarning('Os componentes deste curso nao possuem periodos validos cadastrados.', 'warning', 3000);
        return;
    }

    const opcoesDisponiveis = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
    const p = prompt(
        'INICIANDO IMPORTACAO RAPIDA\n' +
        'Turma alvo: ' + getTurmaLabel(store.selectedTurma) + '\n\n' +
        'Digite o NUMERO DO PERIODO que deseja importar:\n' +
        '(Opcoes disponiveis: ' + opcoesDisponiveis.join(', ') + ')\n' +
        'Periodos encontrados neste curso: ' + periodosDisponiveisNoCurso.join(', ')
    );

    if (!p) return;

    const periodoSelecionadoNum = normalizePeriodoToNumber(p);
    if (!periodoSelecionadoNum || !opcoesDisponiveis.includes(periodoSelecionadoNum)) {
        showToastWarning('Periodo invalido. Use uma das opcoes: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10.', 'warning', 3200);
        return;
    }

    const compsToImport = comps.filter(c => normalizePeriodoToNumber(c.periodo) === periodoSelecionadoNum);
    if (compsToImport.length === 0) {
        showToastWarning(`Nenhuma disciplina encontrada no periodo "${periodoSelecionadoNum}".`, 'warning', 3000);
        return;
    }

    const blocoId = `BL${periodoSelecionadoNum}`;
    let addedCount = 0;

    compsToImport.forEach(c => {
        const exists = store.allocations.some(a =>
            String(a.turmaId) === String(store.selectedTurma) && a.disciplina === c.componente
        );
        if (exists) return;

        store.addAllocation({
            turmaId: store.selectedTurma,
            disciplina: c.componente,
            docente: 'A definir',
            modo: 'pendente',
            importado: true,
            cor: c.cor || '#bdc3c7',
            dataInicio: store.settings.termStart,
            dataFim: store.settings.termEnd,
            subGrupo: blocoId
        });
        addedCount++;
    });

    if (addedCount > 0) {
        const turmaNome = getTurmaLabel(store.selectedTurma, blocoId);
        showToastWarning(`Sucesso! ${addedCount} disciplinas importadas como ${turmaNome}. Va em "Lista de Ofertas" para alocar na grade.`, 'success');
        store.saveAllocations();
        renderOfertasList();
        switchTab('list');
    } else {
        showToastWarning('Todas as disciplinas deste bloco ja estao na grade (ou pendentes) para esta turma.', 'warning', 3200);
    }
}

function updateImportBlocoButtonState() {
    const btnImportBloco = document.getElementById('btn-import-bloco');
    if (!btnImportBloco) return;

    btnImportBloco.innerHTML = 'Inser&ccedil;&atilde;o por Bloco (PPC)';
    btnImportBloco.disabled = !(store.selectedCurso && store.selectedTurma);
}

export function initUI() {
    setupCompactFaixaDateFields();
    setupFaixaControls();
    setupWeeklyInstructionsToggle();
    setupWeeklyWeekNavigator();
    setWeeklyViewByDate(store.settings.termStart || calStart?.value || '', { followFaixa: false, render: false });
    if (selCurso) selCurso.addEventListener('change', onCursoChange);
    if (selTurma) selTurma.addEventListener('change', onTurmaChange);

    initPeriodoLetivoETurno();
    setupCopyActionButtons();

    // ORDEM IMPORTANTE: Primeiro conserta o layout e encapsula os selects
    applySidebarLayoutFixes();
    wrapTeacherSelect();

    // Depois aplica os botões X
    setupClearButtonsSidebar();
    setupMultiDocenteUI();

    // Botão de Importar Bloco
    const btnImportBloco = document.getElementById('btn-import-bloco');
    if (btnImportBloco) btnImportBloco.addEventListener('click', handleImportBloco);
    updateImportBlocoButtonState();

    enforceCanonicalFaixaMode();

    if (inputConfig.disciplina) {
        inputConfig.disciplina.addEventListener('input', () => {
            const discNome = normalizeDisciplinaInputValue(inputConfig.disciplina.value || '');
            const isEditingSameDisc = weeklyState.editingDisciplinaDraft && discNome === weeklyState.editingDisciplinaDraft;
            const isNewDiscSelection = !!discNome && discNome !== weeklyState.lastDisciplinaInputNormalized && !isEditingSameDisc;
            if (isNewDiscSelection) {
                clearWeeklyBlock();
                setComponentStartSelectionMode('auto');
                collapseFaixasForNewComponent({ useCurrentUI: false });
                weeklyState.editingDisciplinaDraft = '';
                weeklyState.editingImportadoDraft = false;
                weeklyState.editingOriginalAllocationIds = [];
                weeklyState.editingComponentOriginalStart = '';
            }
            weeklyState.lastDisciplinaInputNormalized = discNome;
            updateWeeklyFaixasTitleDisciplina();
            updateWeeklyFaixaHoursDisplay();
            if (store.selectedTurma) renderWeeklyGrid();
        });

        // Detecção de duplicata: mostra o campo sub-grupo quando a mesma disciplina já existe na turma
        inputConfig.disciplina.addEventListener('change', () => {
            const discNome = normalizeDisciplinaInputValue(inputConfig.disciplina.value || '');
            const isEditingSameDisc = weeklyState.editingDisciplinaDraft && discNome === weeklyState.editingDisciplinaDraft;
            const isNewDiscSelection = !!discNome && discNome !== weeklyState.lastDisciplinaInputNormalized && !isEditingSameDisc;
            let pendingPreferredStart = '';
            if (isNewDiscSelection) {
                clearWeeklyBlock();
                setComponentStartSelectionMode('auto');
                pendingPreferredStart = getPreferredStartDateForCurrentTurma();
                notifyStartSuggestionFeedback();
                collapseFaixasForNewComponent({ preferredStart: pendingPreferredStart, useCurrentUI: false });
                weeklyState.editingDisciplinaDraft = '';
                weeklyState.editingImportadoDraft = false;
                weeklyState.editingOriginalAllocationIds = [];
                weeklyState.editingComponentOriginalStart = '';
                
                // Aplica a cor automática (da paleta de 20 cores ou do JSON), com realce de croma
                if (inputConfig.cor) {
                    inputConfig.cor.value = vividHexColor(store.getDisciplinaColor(discNome));
                }
            }
            weeklyState.lastDisciplinaInputNormalized = discNome;
            updateWeeklyFaixasTitleDisciplina();
            updateWeeklyFaixaHoursDisplay();
            if (store.selectedTurma) {
                applyWeekAutoPositionForComponentChange({ render: false });
                // Reposiciona a grade no início da Faixa 1 — applyWeekAutoPositionForComponentChange
                // pode ter sobrescrito a posição definida por collapseFaixasForNewComponent.
                const f1Start = document.getElementById('inp-data-inicio-f1')?.value;
                if (f1Start) {
                    setWeeklyViewByDate(f1Start, { followFaixa: false, render: false });
                }
                renderWeeklyGrid();
            }
            const containerSub = document.getElementById('container-sub-turma');
            const inpSub = document.getElementById('inp-sub-turma');
            const preview = document.getElementById('preview-sub-turma');
            if (!containerSub || !inpSub) return;

            if (!discNome || !store.selectedTurma) {
                containerSub.classList.add('hidden');
                inpSub.value = '';
                return;
            }

            // Conta quantas vezes a disciplina já existe na turma atual
            const existing = store.allocations.filter(a =>
                String(a.turmaId) === String(store.selectedTurma) && a.disciplina === discNome
            );

            if (existing.length > 0) {
                const turmaNome = getTurmaLabel(store.selectedTurma);
                const confirmou = confirm(
                    `⚠️ Atenção!\n\n` +
                    `Você está criando uma SEGUNDA alocação de:\n` +
                    `📚 "${discNome}"\n` +
                    `👥 para a turma ${turmaNome}\n\n` +
                    `Isso indica que a turma será SUBDIVIDIDA em grupos (ex: laboratório).\n\n` +
                    `Deseja continuar e definir o sub-grupo?`
                );

                if (!confirmou) {
                    inputConfig.disciplina.value = '';
                    containerSub.classList.add('hidden');
                    inpSub.value = '';
                    return;
                }

                // Sugere próximo sub-grupo: se já existe BL1_T01, sugere BL1_T02; senão deixa vazio
                const ultimoSub = existing[existing.length - 1]?.subGrupo || '';
                const matchT = ultimoSub.match(/^(.+_T)(\d+)$/);
                if (matchT) {
                    inpSub.value = `${matchT[1]}${String(parseInt(matchT[2]) + 1).padStart(2, '0')}`;
                } else if (ultimoSub) {
                    inpSub.value = ultimoSub + '_T02';
                } else {
                    inpSub.value = '';
                    inpSub.placeholder = 'Ex: BL1 ou BL1_T01';
                }
                containerSub.classList.remove('hidden');
            } else {
                containerSub.classList.add('hidden');
                inpSub.value = '';
            }


            // Preview do rótulo gerado
            const updatePreview = () => {
                const sg = inpSub.value.trim();
                if (sg && store.selectedTurma) {
                    const label = getTurmaLabel(store.selectedTurma, sg);
                    preview.textContent = `→ Rótulo: ${label}`;
                } else {
                    preview.textContent = '';
                }
            };
            inpSub.removeEventListener('input', updatePreview);
            inpSub.addEventListener('input', updatePreview);
            updatePreview();
        });
    }

    if (inputConfig.cor) {
        const repaintDrawing = () => {
            if (!drawingFaixaIndex) return;
            applyDrawingToolbarTheme();
            renderWeeklyGrid();
        };
        inputConfig.cor.addEventListener('input', repaintDrawing);
        inputConfig.cor.addEventListener('change', repaintDrawing);
    }

    const btnAdd = document.getElementById('btn-add-oferta');
    if (btnAdd) btnAdd.addEventListener('click', handleAddManual);

    const btnUndoAlloc = document.getElementById('btn-undo-alloc');
    if (btnUndoAlloc) btnUndoAlloc.addEventListener('click', handleUndoLastAllocation);
    updateUndoAllocationButtonUI();

    document.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    setupSubtabs();

    const btnGerarCal = document.getElementById('btn-gerar-cal');
    if (btnGerarCal) btnGerarCal.addEventListener('click', handleCalendarViewportChange);

    const btnResetViewPeriod = document.getElementById('btn-reset-view-period');
    if (btnResetViewPeriod) btnResetViewPeriod.addEventListener('click', resetCalendarViewportToPlan);

    const btnGerarCalTeacher = document.getElementById('btn-gerar-cal-teacher');
    if (btnGerarCalTeacher) btnGerarCalTeacher.addEventListener('click', handleTeacherViewportChange);

    const btnResetViewPeriodTeacher = document.getElementById('btn-reset-view-period-teacher');
    if (btnResetViewPeriodTeacher) btnResetViewPeriodTeacher.addEventListener('click', resetCalendarViewportToPlan);

    const btnPrintGanttTurma = document.getElementById('btn-print-gantt-turma');
    if (btnPrintGanttTurma) {
        btnPrintGanttTurma.addEventListener('click', () => printGanttLandscape('turma'));
    }

    const btnPrintGanttDocente = document.getElementById('btn-print-gantt-docente');
    if (btnPrintGanttDocente) {
        btnPrintGanttDocente.addEventListener('click', () => printGanttLandscape('docente'));
    }

    const btnPrint = document.querySelector('.btn-print');
    if (btnPrint) {
        btnPrint.removeAttribute('onclick');
        btnPrint.addEventListener('click', () => {
            const originalTitle = document.title;
            let turmaLabel = store.selectedTurma || 'GERAL';
            if (store.rawData?.turmas) {
                const t = store.rawData.turmas.find(x => String(x.turma_id) === String(store.selectedTurma));
                if (t) turmaLabel = t.turma_label;
            }
            const periodo = normalizePeriodoLetivoCode(store.settings.periodo || 'PL1');
            const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;

            if (activeTab === 'teacher' && selViewDocente && selViewDocente.value) {
                document.title = `${selViewDocente.value}_${periodo}_Gestor_IECOS_Coordenacoes(v2.0 Dev)`;
            } else {
                document.title = `${turmaLabel}_${periodo}_Gestor_IECOS_Coordenacoes(v2.0 Dev)`;
            }
            window.print();
            setTimeout(() => { document.title = originalTitle; }, 1000);
        });
    }

    if (selViewDocente) {
        selViewDocente.addEventListener('change', () => {
            renderActiveSubtab('tab-teacher', 'docente-calendar');
            selViewDocente.blur();
        });
        selViewDocente.addEventListener('input', () => {
            if (!selViewDocente.value) {
                const cal = document.getElementById('teacher-calendar-container');
                if (cal) cal.innerHTML = '';
                const gantt = document.getElementById('gantt-container-docente');
                if (gantt) gantt.innerHTML = '';
            }
        });
    }

    const inpImport = sanitizeImportInputElement();
    if (inpImport) {
        // Neutraliza handlers legados e impede bind duplicado no input de importacao.
        inpImport.onchange = null;
        if (inpImport.dataset.importBound !== '1') {
            inpImport.dataset.importBound = '1';
            inpImport.addEventListener('change', handleFileSelect);
        }
    }

    const btnReplace = document.getElementById('btn-modal-replace');
    if (btnReplace) {
        btnReplace.addEventListener('click', () => {
            if (tempImportData) {
                if (tempImportPlanMeta?.key) {
                    applyPlanContextToUI(tempImportPlanMeta, { resetDraftOnChange: true });
                }
                store.replaceAllocations(markAllocationsAsImported(tempImportData));
                syncAllRegularDates();
                syncAllIntensiveDates();
                populateDocentes();
                rerenderPlanBoundViews();
                const planLabel = tempImportPlanMeta?.key ? ` no plano ${getPlanDisplayLabel(tempImportPlanMeta)}` : '';
                showToastWarning(`Dados importados${planLabel} com datas recalculadas com sucesso.`, 'success', 2200);
            }
            closeModal();
        });
    }

    const btnMerge = document.getElementById('btn-modal-merge');
    if (btnMerge) {
        btnMerge.addEventListener('click', () => {
            if (tempImportData) {
                if (tempImportPlanMeta?.key && tempImportPlanMeta.key !== store.getActivePlanMeta().key) {
                    const shouldSwitch = confirm(
                        `O arquivo pertence ao plano ${getPlanDisplayLabel(tempImportPlanMeta)}.\n\n` +
                        `Deseja trocar para esse plano antes de mesclar as alocacoes?`
                    );
                    if (!shouldSwitch) return;
                    applyPlanContextToUI(tempImportPlanMeta, { resetDraftOnChange: true });
                }
                const count = store.mergeAllocations(markAllocationsAsImported(tempImportData));
                syncAllRegularDates();
                syncAllIntensiveDates();
                populateDocentes();
                showToastWarning(`Mesclagem concluida! ${count} novas alocacoes adicionadas com datas corrigidas.`, 'success', 3000);
                rerenderPlanBoundViews();
            }
            closeModal();
        });
    }

    const btnCancel = document.getElementById('btn-modal-cancel');
    if (btnCancel) {
        btnCancel.addEventListener('click', () => {
            tempImportData = null;
            tempImportPlanMeta = null;
            if (inpImport) inpImport.value = '';
            closeModal();
        });
    }

    populateCursos();
    populateDocentes();
    renderOfertasList();
    updateWeeklyFaixasTitleDisciplina();
}

// Marca alocacoes vindas de arquivo importado para que sobreposicoes sejam
// permitidas e destacadas na aba Calendario Docente.
function markAllocationsAsImported(list) {
    if (!Array.isArray(list)) return [];
    return list.map((alloc) => (alloc && typeof alloc === 'object' ? { ...alloc, importado: true } : alloc));
}

function handleFileSelect(event) {
    if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
    }
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        const result = parseBackupDataFile(e.target.result);
        
        if (!result.success) {
            showToastWarning(result.error || 'Arquivo inválido. O formato não é suportado.', 'error', 3000);
            tempImportData = null;
            tempImportPlanMeta = null;
            event.target.value = '';
            return;
        }

        tempImportData = result.allocations;
        tempImportPlanMeta = extractImportPlanMeta(result.parsed, resolveOfficialPeriodoLetivoPlan);
        
        if (tempImportPlanMeta?.key) {
            showToastWarning(`Arquivo reconhecido para o plano ${getPlanDisplayLabel(tempImportPlanMeta)}.`, 'success', 2400);
        }
        
        const modal = document.getElementById('import-modal');
        if (modal) modal.style.display = 'flex';
    };
    reader.readAsText(file);
}

function closeModal() {
    const modal = document.getElementById('import-modal');
    if (modal) modal.style.display = 'none';
    tempImportData = null;
    tempImportPlanMeta = null;
    const inp = document.getElementById('inp-import');
    if (inp) inp.value = '';
}

function sanitizeImportInputElement() {
    const current = document.getElementById('inp-import');
    if (!current) return null;
    if (current.dataset.importSanitized === '1') return current;

    const clone = current.cloneNode(true);
    clone.value = '';
    clone.onchange = null;
    clone.dataset.importSanitized = '1';
    current.replaceWith(clone);
    return clone;
}

function getLatestAllocationEndForTurma(turmaId) {
    if (!turmaId || !Array.isArray(store.allocations)) return '';

    return store.allocations.reduce((latest, alloc) => {
        if (String(alloc?.turmaId || '') !== String(turmaId)) return latest;
        if (isPendingAllocation(alloc)) return latest;

        const candidate = String(alloc?.dataFim || alloc?.dataInicio || '').trim();
        if (!candidate) return latest;
        return !latest || candidate > latest ? candidate : latest;
    }, '');
}

function populateTurmaOptionsForCurso(cursoSigla, preferredTurma = '') {
    const reconciled = reconcileTurmaSelectionAfterPLChange({
        selectedCurso: cursoSigla,
        selectedTurma: preferredTurma,
        lastTurma: store.settings.lastTurma,
        turmas: store.rawData?.turmas || []
    });

    selTurma.disabled = !cursoSigla;
    selTurma.innerHTML = '<option value="">Selecione uma Turma</option>';

    reconciled.validTurmas.forEach((turma) => {
        const option = document.createElement('option');
        option.value = turma.turma_id;
        option.textContent = getTurmaSelectLabel(turma.turma_id);
        selTurma.appendChild(option);
    });

    selTurma.value = reconciled.selectedTurma || '';
    return reconciled;
}

function resetWeeklyEditorForTurma(turmaId, options = {}) {
    const {
        preferredStart = '',
        resetWeekToPlanStart = false
    } = options;
    setComponentStartSelectionMode('auto');
    const termStart = String(store.settings.termStart || inpTermStart?.value || calStart?.value || '').trim();
    const latestAllocationEnd = getLatestAllocationEndForTurma(turmaId);
    const initialized = initializeWeeklyScheduleForTurma({
        termStart,
        turmaLastStart: turmaId ? store.getTurmaLastStart(turmaId) : '',
        latestAllocationEnd,
        preferredStart
    });
    const resetState = resetWeeklyViewOnTurmaChange({
        termStart,
        turmaFirstFaixaStart: initialized.firstFaixaStart,
        fallbackDate: termStart
    });

    deactivateDrawingMode();
    resetEditingComponentState();
    updateWeeklyFaixasTitleDisciplina();
    updateWeeklyFaixaHoursDisplay();
    collapseFaixasForNewComponent({
        preferredStart: resetState.firstFaixaStart,
        useCurrentUI: false
    });

    weeklyState.clearFaixasPatterns();
    setFaixaStatus(1, 0);
    setFaixaStatus(2, 0);
    setFaixaStatus(3, 0);

    const anchorDate = resetWeekToPlanStart
        ? (resetState.firstFaixaStart || termStart)
        : (initialized.firstFaixaStart || resetState.firstFaixaStart || termStart);
    if (anchorDate) {
        setWeeklyViewByDate(anchorDate, { followFaixa: false, render: false });
    }

    applyFaixaDateAutofill({
        forceSingleBounds: true,
        preferredStart: resetState.firstFaixaStart || initialized.firstFaixaStart || termStart
    });
    refreshPendingFaixaStartPickUI();
    updateWeeklyContextNote();
}

// Encerra a sessao de edicao apos um salvamento bem-sucedido: sai do modo de
// desenho e limpa o editor (disciplina/faixas/sub-turma), fazendo a componente
// recem salva aparecer na Grade Semanal no estilo ALOCADA (cards fixos) em vez
// de permanecer no visual de edicao/desenho. Preserva a semana em exibicao para
// que o usuario veja a componente alocada exatamente onde estava desenhando.
// Para reeditar, o fluxo e pela aba Lista de Ofertas (duplo clique / botao editar).
function finalizeWeeklyEditorAfterSave() {
    const currentWeekStart = resolveWeeklyViewWeekStart();

    endDrawingDrag();
    if (pendingFaixaStartPick) clearPendingFaixaStartPick();
    drawingFaixaIndex = null;
    weeklyViewState.followActiveFaixa = false;
    setComponentStartSelectionMode('auto');

    resetEditingComponentState();

    weeklyState.clearFaixasPatterns();
    setFaixaStatus(1, 0);
    setFaixaStatus(2, 0);
    setFaixaStatus(3, 0);

    // Limpa o campo de disciplina para a proxima componente. Como o editor fica
    // sem disciplina, resolveInlineEditableFaixaIndex retorna null e a grade nao
    // reentra no modo de desenho -> a componente salva e exibida como alocada.
    if (inputConfig.disciplina) inputConfig.disciplina.value = '';
    const containerSub = document.getElementById('container-sub-turma');
    const inpSub = document.getElementById('inp-sub-turma');
    if (containerSub) containerSub.classList.add('hidden');
    if (inpSub) inpSub.value = '';

    const toolbar = document.getElementById('drawing-toolbar');
    if (toolbar) toolbar.classList.add('hidden');
    const reeditBadge = document.getElementById('reedit-badge');
    if (reeditBadge) reeditBadge.classList.add('hidden');

    updateWeeklyFaixasTitleDisciplina();
    updateWeeklyFaixaHoursDisplay();
    refreshActiveFaixaHighlight();
    refreshPendingFaixaStartPickUI();
    updateWeeklyContextNote();
    updateWeeklySavePatternButton();

    // Mantem a semana onde o usuario estava para que a componente recem salva
    // apareca alocada exatamente ali.
    if (currentWeekStart) setWeeklyViewByDate(currentWeekStart, { followFaixa: false, render: false });

    renderWeeklyGrid();
}

function syncCursoTurmaSelectionAfterPlanChange() {
    const cursoSigla = selCurso?.value || store.selectedCurso || store.settings.lastCurso || '';
    if (selCurso) selCurso.value = cursoSigla;
    store.selectedCurso = cursoSigla;

    const previousTurma = String(store.selectedTurma || selTurma?.value || '').trim();
    const reconciled = populateTurmaOptionsForCurso(cursoSigla, previousTurma || store.settings.lastTurma || '');
    const nextTurma = String(reconciled.selectedTurma || '').trim();

    store.selectedTurma = nextTurma;
    store.setLastContext(cursoSigla, nextTurma);
    updateImportBlocoButtonState();

    return {
        cursoSigla,
        previousTurma,
        nextTurma,
        didChangeTurma: nextTurma !== previousTurma,
        wasCleared: reconciled.wasCleared
    };
}

function populateCursos() {
    if (!store.rawData || !selCurso) return;
    selCurso.innerHTML = '<option value="">Selecione...</option>';
    (store.rawData.cursos || []).forEach((c) => {
        selCurso.innerHTML += `<option value="${c.sigla}">${c.curso}</option>`;
    });
    if (store.settings.lastCurso) {
        selCurso.value = store.settings.lastCurso;
        onCursoChange();
    }
}

function onCursoChange() {
    const cursoSigla = selCurso.value;
    store.selectedCurso = cursoSigla;
    store.setLastContext(cursoSigla, '');
    const reconciled = populateTurmaOptionsForCurso(cursoSigla, store.settings.lastTurma || '');
    store.selectedTurma = reconciled.selectedTurma || '';

    updateDisciplinaDatalist();

    // Recalcula datas ao carregar (corrige dados antigos do localStorage)
    syncAllRegularDates();
    syncAllIntensiveDates();

    updateImportBlocoButtonState();
    if (store.selectedTurma) {
        onTurmaChange();
        return;
    }

    resetWeeklyEditorForTurma('', {
        preferredStart: store.settings.termStart || '',
        resetWeekToPlanStart: true
    });
    renderWeeklyGrid();
    renderOfertasList();
}

function updateDisciplinaDatalist() {
    if (!listDisciplinas) return;
    listDisciplinas.innerHTML = '';
    if (!store.selectedCurso || !store.rawData?.componentes) return;

    const comps = store.rawData.componentes.filter((c) => c.sigla === store.selectedCurso);
    comps.forEach((c) => {
        const opt = document.createElement('option');
        opt.value = `${c.componente} (${c.ch ?? 0}h)`;
        opt.setAttribute('data-ch', c.ch ?? 0);
        opt.setAttribute('data-abrev', c.abreviacao || c.componente);
        listDisciplinas.appendChild(opt);
    });
}

function populateDocentes() {
    const nomesRaw = Array.isArray(store.rawData?.docentes)
        ? store.rawData.docentes.map((d) => String(d.docente || '').trim())
        : [];

    const nomesAlloc = [];
    (store.allocations || []).forEach((a) => {
        const single = String(a?.docente || '').trim();
        if (single && !/^a definir$/i.test(single) && !/\(multiplos\)/i.test(single)) {
            nomesAlloc.push(single);
        }
        if (Array.isArray(a?.docentes)) {
            a.docentes.forEach((d) => {
                const nome = String(d?.nome || d || '').trim();
                if (nome && !/^a definir$/i.test(nome)) nomesAlloc.push(nome);
            });
        }
    });

    const nomes = [...new Set([...nomesRaw, ...nomesAlloc].filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })
    );

    if (listDocentes) {
        listDocentes.innerHTML = '';
        nomes.forEach((nome) => {
            listDocentes.appendChild(new Option(nome, nome));
        });
    }

    const listView = document.getElementById('list-view-docentes');
    if (listView) {
        listView.innerHTML = '';
        nomes.forEach((nome) => {
            listView.appendChild(new Option(nome, nome));
        });
    }
}

function onTurmaChange() {
    store.selectedTurma = selTurma.value;
    clearAllocationUndoSnapshot();
    store.setLastContext(store.selectedCurso, store.selectedTurma || '');
    resetWeeklyEditorForTurma(store.selectedTurma, {
        preferredStart: store.settings.termStart || '',
        resetWeekToPlanStart: true
    });

    updateImportBlocoButtonState();

    const alocacoesTurma = store.allocations.filter(a => String(a.turmaId) === String(store.selectedTurma));
    const primeiraOfertaPorFaixa = alocacoesTurma.find(a => isFaixaAllocation(a) && Array.isArray(a.horariosOcupados) && a.horariosOcupados.length > 0);

    const turmaNativa = store.rawData?.turmas?.find(x => String(x.turma_id) === String(store.selectedTurma));
    if (turmaNativa?.turno) {
        store.setTurnoOferta(resolveTurnoOfertaValue(turmaNativa.turno));
    } else if (primeiraOfertaPorFaixa) {
        const slotRef = String(primeiraOfertaPorFaixa.horariosOcupados[0] || '');
        const letter = getTurnoLetter(slotRef);
        if (letter === 'M') store.setTurnoOferta(resolveTurnoOfertaValue('Manhã'));
        else if (letter === 'T') store.setTurnoOferta(resolveTurnoOfertaValue('Tarde'));
        else store.setTurnoOferta(resolveTurnoOfertaValue('Noite'));
    }

    if (selTurnoOferta) {
        populateTurnoOfertaOptions(store.settings.turnoOferta || 'Tarde');
    }

    renderWeeklyGrid();
    renderOfertasList();
}


function renderWeeklyGrid() {
    if (!gridContainer) return;

    updateWeeklyFaixasTitleDisciplina();
    gridContainer.innerHTML = '';
    const horariosUI = buildHorariosForUI();
    const diasSemana = [
        { id: 1, nome: 'Segunda' },
        { id: 2, nome: 'Terca' },
        { id: 3, nome: 'Quarta' },
        { id: 4, nome: 'Quinta' },
        { id: 5, nome: 'Sexta' },
        { id: 6, nome: 'Sabado' }
    ];
    let isDrawing = !!drawingFaixaIndex;
    if (!isDrawing) {
        const inlineFaixaIndex = resolveInlineEditableFaixaIndex();
        if (inlineFaixaIndex) {
            activeFaixaIndex = inlineFaixaIndex;
            drawingFaixaIndex = inlineFaixaIndex;
            weeklyViewState.followActiveFaixa = true;
            isDrawing = true;
        }
    }
    refreshActiveFaixaHighlight();

    const drawRange = isDrawing ? getActiveDrawingFaixaRange() : null;
    const drawingDisciplina = normalizeDisciplinaInputValue(inputConfig.disciplina?.value || '');
    const turmaAllocs = store.allocations.filter((a) => String(a.turmaId) === String(store.selectedTurma));
    const pattern = isDrawing ? normalizeFaixaPattern(faixasPatterns[drawingFaixaIndex]) : [];
    const hasAnyDraftPattern = isDrawing && [1, 2, 3].some((idx) => normalizeFaixaPattern(faixasPatterns[idx]).length > 0);
    const drawStyles = isDrawing ? getDrawingSelectedStyles() : null;
    const showContextWhileDrawing = !isDrawing || drawingViewMode === 'context';
    const feriadosMap = getHolidayLabelMap();
    const feriadosSet = new Set(feriadosMap.keys());

    if (!store.selectedTurma || horariosUI.length === 0) {
        gridContainer.innerHTML = `
            <div style="grid-column: 1/-1; padding: 22px; background:#bdc3c7; border-radius: 6px;">
                <ul style="margin:0; padding-left: 20px; color:#2c3e50; font-size: 1.05rem; line-height: 1.55; text-align:left; width:100%; display:block; margin-left:0;">
                    <li>Selecione um curso do IECOS</li>
                    <li>Selecione uma turma v&aacute;lida desse curso</li>
                    <li>Informe o Per&iacute;odo letivo, incluindo:
                        <ul style="margin:6px 0 0 0; padding-left:22px; list-style:disc;">
                            <li>Data de in&iacute;cio e data de fim</li>
                            <li>Per&iacute;odo: PL1, PL2, PL3 ou PL4</li>
                        </ul>
                    </li>
                    <li>Escolha a forma de oferta das componentes, com duas op&ccedil;&otilde;es:
                        <ul style="margin:6px 0 0 0; padding-left:22px; list-style:disc;">
                            <li>Inser&ccedil;&atilde;o por Bloco</li>
                            <li>Inser&ccedil;&atilde;o Individual</li>
                        </ul>
                    </li>
                </ul>
            </div>
        `;
        updateWeeklyNavigatorLabel();
        updateWeeklySavePatternButton();
        return;
    }

    if (weeklyViewState.followActiveFaixa && drawingFaixaIndex) {
        const faixaStart = getActiveFaixaStartDate(drawingFaixaIndex);
        if (faixaStart) setWeeklyViewByDate(faixaStart, { followFaixa: true, render: false });
    }
    const weekStartISO = resolveWeeklyViewWeekStart();
    const weekDates = getWeeklyWeekDates(weekStartISO);
    updateWeeklyNavigatorLabel();
    const firstClassSlot = horariosUI.find((h) => !h.toUpperCase().includes('INTERVALO')) || '';

    const weeklySnapshotStart = store.settings.termStart || calStart?.value || weekDates[0] || weekStartISO;
    const weeklySnapshotEnd = weekDates[weekDates.length - 1] || weekStartISO;
    const weeklyEventsFull = getCalendarEvents(
        String(store.selectedTurma),
        weeklySnapshotStart,
        weeklySnapshotEnd
    );
    const weeklyEventsByDate = {};
    weekDates.forEach((d) => {
        weeklyEventsByDate[d] = Array.isArray(weeklyEventsFull?.[d]) ? weeklyEventsFull[d] : [];
    });

    // Edicao segura: oculta da grade as ofertas originais em edicao (ainda
    // persistidas no store, removidas somente ao salvar), para que a edicao
    // mostre apenas o desenho atual, sem duplicar a componente.
    const hiddenEditIds = new Set(
        (weeklyState.editingOriginalAllocationIds || []).map((id) => String(id))
    );
    if (hiddenEditIds.size > 0) {
        weekDates.forEach((d) => {
            weeklyEventsByDate[d] = weeklyEventsByDate[d].filter(
                (ev) => !hiddenEditIds.has(String(ev?.id))
            );
        });
    }

    const allWeeklySlots = new Set();
    Object.values(weeklyEventsByDate).forEach(arr => {
        arr.forEach(ev => {
            if (ev.type !== 'holiday' && Array.isArray(ev.horariosOcupados)) {
                ev.horariosOcupados.forEach(h => allWeeklySlots.add(h));
            }
        });
    });

    const isSlotInUI = (slot) => horariosUI.some(uiSlot => {
        const t1 = String(uiSlot || '').trim().replace(/^Intervalo/i, 'INTERVALO');
        const t2 = String(slot || '').trim().replace(/^Intervalo/i, 'INTERVALO');
        return t1 === t2 || (t1.includes(t2) || t2.includes(t1));
    });

    const hiddenSlots = Array.from(allWeeklySlots).filter(s => !isSlotInUI(s));

    if (hiddenSlots.length > 0) {
        const warningBanner = document.createElement('div');
        warningBanner.className = 'turno-alternativo-warning';
        warningBanner.style = 'grid-column: 1/-1; background-color: #fff3cd; color: #856404; padding: 10px 15px; border-left: 5px solid #ffeeba; margin-bottom: 10px; font-size: 0.9em; border-radius: 4px; display: flex; align-items: center; gap: 10px;';
        warningBanner.innerHTML = `<span>⚠️</span> <span><b>Atenção:</b> Há aulas desta turma programadas para turnos diferentes (ex: Sábado Manhã) nesta semana. Mude a aba de Turno acima para visualizá-las e editá-las adequadamente.</span>`;
        if (gridContainer) gridContainer.appendChild(warningBanner);
    }

    const slotKey = (value) => {
        const text = String(value || '').trim();
        if (!text) return '';
        const m = text.match(/\d{1,2}:\d{2}/);
        return m ? m[0] : text.replace(/\s+/g, '');
    };

    const getWeeklySlotEvents = (dateStr, slotLabel, dayNumber) => {
        const dayEvents = Array.isArray(weeklyEventsByDate?.[dateStr]) ? weeklyEventsByDate[dateStr] : [];
        const key = slotKey(slotLabel);

        const seen = new Set();
        const out = [];

        if (key && dayEvents.length > 0) {
            dayEvents.forEach((e) => {
                if (!e || e.type === 'holiday') return;
                if (hasAnyDraftPattern && drawingDisciplina && normalizeDisciplinaInputValue(e.disciplina || '') === drawingDisciplina) return;

                let eventHorario = e.horario;
                const eTurno = e.turno ||
                    store.rawData?.turmas?.find(t => String(t.turma_id) === String(e.turmaId))?.turno || 'Tarde';
                
                const currentViewTurno = store.settings.turnoOferta || 
                    store.rawData?.turmas?.find(t => String(t.turma_id) === String(store.selectedTurma))?.turno || 'Tarde';

                if (e.sabadoManha && dayNumber === 6 && eTurno !== 'Manha' && eTurno !== 'Manhã') {
                    // Se estamos vendo a Noite, e a aula é de Sábado Manhã (vinculada), 
                    // mapeamos de volta para a visão da Noite para que o quadradinho apareça.
                    eventHorario = mapSlotToTurno(e.horario, 'Manha', currentViewTurno, store.getActiveHorariosPorTurno());
                }
                const eventKey = slotKey(eventHorario);

                const listKey = Array.isArray(e.horariosOcupados)
                    ? e.horariosOcupados.some((h) => {
                        let hObj = h;
                        if (e.sabadoManha && dayNumber === 6 && eTurno !== 'Manha' && eTurno !== 'Manhã') {
                            hObj = mapSlotToTurno(h, 'Manha', currentViewTurno, store.getActiveHorariosPorTurno());
                        }
                        return slotKey(hObj) === key;
                    })
                    : false;

                if (eventKey !== key && !listKey) return;

                const dedupe = `${e.id ?? ''}|${e.disciplina ?? ''}|${e.modo ?? ''}|${eventKey || key}|${e.subGrupo ?? ''}`;
                if (seen.has(dedupe)) return;
                seen.add(dedupe);
                out.push(e);
            });
        }

        if (out.length > 0 || !key) return out;

        // Fallback anti-brecha: evita sumico indevido de dia util anterior por janela de renderizacao
        turmaAllocs.forEach((a) => {
            // Edicao segura: nunca re-adicionar a propria componente em edicao
            // (mesmo sem padrao desenhado, ex.: apos "Limpar Faixas"), senao ela
            // reaparece como ocupada e bloqueia o redesenho dos proprios slots.
            if (hiddenEditIds.has(String(a?.id))) return;
            if (hasAnyDraftPattern && drawingDisciplina && normalizeDisciplinaInputValue(a.disciplina || '') === drawingDisciplina) return;
            if (!isAllocationActiveInWeeklyCell(a, dayNumber, dateStr, slotLabel)) return;

            if (isFaixaAllocation(a) && a.dataFim === dateStr && Array.isArray(a.horariosUltimoDia) && a.horariosUltimoDia.length > 0) {
                if (!a.horariosUltimoDia.some((h) => slotKey(h) === key)) return;
            }

            const dedupe = `${a.id ?? ''}|${a.disciplina ?? ''}|${a.modo ?? ''}|${key}|${a.subGrupo ?? ''}`;
            if (seen.has(dedupe)) return;
            seen.add(dedupe);
            out.push(a);
        });

        return out;
    };

    // Retorna um evento sintético para células de outras faixas da componente em edição,
    // permitindo exibir o fundo colorido mesmo após a alocação ter sido removida do store.
    // Lê diretamente faixasPatterns[] (já carregados em memória pelo hydrateFaixasFromComponente).
    const getSelfAllocsForCell = (dateStr, slotLabel, dayNumber) => {
        if (!hasAnyDraftPattern || !drawingDisciplina) return [];

        const activeFaixa = parseInt(drawingFaixaIndex || activeFaixaIndex, 10) || 1;
        const cor = inputConfig.cor?.value || '#cccccc';
        const docenteVal = inputConfig.docente?.value || '';

        for (let fi = 1; fi <= 3; fi++) {
            if (fi === activeFaixa) continue;

            const fPattern = normalizeFaixaPattern(faixasPatterns[fi]);
            if (fPattern.length === 0) continue;

            // Verifica se o slot/dia estão no padrão desta faixa
            const key = slotKey(slotLabel);
            const matchesPattern = fPattern.some(
                (p) => p.dia === dayNumber && slotKey(p.slot) === key
            );
            if (!matchesPattern) continue;

            // Verifica se a data está dentro do intervalo desta faixa
            const fIni = document.getElementById(`inp-data-inicio-f${fi}`)?.value || '';
            const fFim = document.getElementById(`inp-data-fim-f${fi}`)?.value || '';
            if (!fIni) continue;
            if (dateStr < fIni) continue;
            if (fFim && dateStr > fFim) continue;

            // Retorna evento sintético com a cor original da componente
            return [{
                id: `_edit_f${fi}`,
                disciplina: drawingDisciplina,
                cor,
                docente: docenteVal,
                modo: 'faixas',
                turmaId: store.selectedTurma,
                horario: slotLabel,
                _synthetic: true
            }];
        }

        return [];
    };

    gridContainer.appendChild(createCell('header top-header', ''));
    diasSemana.forEach((dia, idx) => {
        const dateStr = weekDates[idx] || '';
        const holidayLabel = dateStr ? (feriadosMap.get(dateStr) || '') : '';
        const h = createCell('header top-header week-day-header', '');

        const dayName = document.createElement('span');
        dayName.className = 'week-day-name';
        dayName.textContent = dia.nome;

        const dayDate = document.createElement('span');
        dayDate.className = 'week-day-date';
        dayDate.textContent = formatDayMonthShort(dateStr);

        h.appendChild(dayName);
        h.appendChild(dayDate);

        if (holidayLabel) {
            const holidayDay = document.createElement('span');
            holidayDay.className = 'week-day-holiday-number';
            holidayDay.textContent = String(parseInt((dateStr || '').slice(8, 10), 10) || '');
            h.appendChild(holidayDay);

            const holidayName = document.createElement('span');
            holidayName.className = 'week-day-holiday-name';
            holidayName.textContent = holidayLabel;
            h.appendChild(holidayName);
            h.classList.add('week-day-holiday');
            h.title = `Feriado: ${holidayLabel}`;
        }

        gridContainer.appendChild(h);
    });

    horariosUI.forEach((horarioStr) => {
        const isIntervalo = horarioStr.toUpperCase().includes('INTERVALO');
        const labelPrimeiraColuna = isIntervalo ? cleanHorarioLabel(horarioStr) : horarioStr;
        const hDiv = createCell(isIntervalo ? 'header interval-time' : 'header time', labelPrimeiraColuna);
        const isTurnoDivider = !isIntervalo && isTurnoDividerSlot(horarioStr);

        if (isIntervalo) hDiv.style.background = '#e0e0e0';
        if (isTurnoDivider) hDiv.style.borderTop = '3px dashed #bdc3c7';

        // Estreita o slot de tempo do intervalo (10:00)
        if (horarioStr.includes('10:00')) {
            hDiv.style.height = '12px';
            hDiv.style.minHeight = '12px';
            hDiv.style.lineHeight = '12px';
            hDiv.style.fontSize = '8px';
        }

        gridContainer.appendChild(hDiv);

        if (isIntervalo) {
            const intDiv = createCell('header interval-merge', 'Intervalo');
            intDiv.style.gridColumn = '2 / span 6';
            intDiv.style.background = '#e0e0e0';
            intDiv.style.color = '#7f8c8d';
            intDiv.style.letterSpacing = '2px';
            gridContainer.appendChild(intDiv);
        } else {
            for (let i = 1; i <= 6; i++) {
                const cell = createCell('slot', '');
                
                const tLetter = getTurnoLetter(horarioStr);
                if (tLetter === 'M') cell.classList.add('turno-manha');
                else if (tLetter === 'T') cell.classList.add('turno-tarde');
                else if (tLetter === 'N') cell.classList.add('turno-noite');

                const cellDate = weekDates[i - 1] || '';
                cell.dataset.dia = i;
                cell.dataset.horario = horarioStr;
                cell.dataset.date = cellDate;
                if (isTurnoDivider) cell.style.borderTop = '3px dashed #bdc3c7';

                // Se for o slot do intervalo (10:00), reduz a altura em 40% (aprox. 12px se o padrão for 20px)
                if (horarioStr.includes('10:00')) {
                    cell.style.height = '12px';
                    cell.style.minHeight = '12px';
                }

                const isHolidayColumn = !!cellDate && feriadosSet.has(cellDate);
                const holidayLabelForColumn = isHolidayColumn ? (feriadosMap.get(cellDate) || 'Feriado') : '';
                if (isHolidayColumn) {
                    cell.classList.add('slot-holiday-column');
                    cell.title = `Feriado: ${holidayLabelForColumn}`;
                }

                const allocsRaw = getWeeklySlotEvents(cellDate, horarioStr, i);
                const allocs = isHolidayColumn ? [] : allocsRaw;
                const selfAllocs = (isDrawing && !isHolidayColumn)
                    ? getSelfAllocsForCell(cellDate, horarioStr, i)
                    : [];

                if (allocs.length > 0 && showContextWhileDrawing) renderSlotContent(cell, allocs, i);

                if (isHolidayColumn && horarioStr === firstClassSlot) {
                    const holidayMarker = document.createElement('div');
                    holidayMarker.className = 'weekly-holiday-column-marker';

                    const holidayDay = document.createElement('span');
                    holidayDay.className = 'weekly-holiday-column-day';
                    holidayDay.textContent = String(parseInt((cellDate || '').slice(8, 10), 10) || '');

                    const holidayName = document.createElement('span');
                    holidayName.className = 'weekly-holiday-column-name';
                    holidayName.textContent = holidayLabelForColumn;

                    holidayMarker.appendChild(holidayDay);
                    holidayMarker.appendChild(holidayName);
                    cell.appendChild(holidayMarker);
                }

                if (isDrawing) {
                    const isSelected = !isHolidayColumn && pattern.some((p) => p.dia === i && p.slot === horarioStr);
                    setDrawingCellSelection(cell, isSelected, drawStyles);
                    cell.classList.remove('slot-free-draw', 'slot-week-disabled', 'slot-week-holiday');

                    const isInsideFaixa = drawRange ? isDateInsideRange(cellDate, drawRange.start, drawRange.end) : true;
                    const isHoliday = !!cellDate && feriadosSet.has(cellDate);
                    const holidayLabel = isHoliday ? (feriadosMap.get(cellDate) || 'Feriado') : '';
                    const waitingStartPick = !!pendingFaixaStartPick;
                    const startPickValidation = waitingStartPick
                        ? getFaixaStartDateValidation(pendingFaixaStartPick, cellDate)
                        : { isValid: false, message: '' };
                    const canPickStartDate = waitingStartPick && !isHoliday && !!cellDate && startPickValidation.isValid;
                    const canEdit = !waitingStartPick && isInsideFaixa && !isHoliday && allocs.length === 0;

                    if (canPickStartDate) {
                        cell.dataset.canEdit = '1';
                        if (!isSelected) cell.classList.add('slot-free-draw');
                        cell.style.cursor = 'copy';
                        cell.style.pointerEvents = 'auto';
                        cell.style.opacity = '1';
                        cell.title = 'Clique para definir o inicio da Faixa ' + String(pendingFaixaStartPick) + ' nesta data.';
                        cell.querySelectorAll('.remove-btn').forEach((btn) => { btn.style.pointerEvents = 'none'; });

                        const handleStartPick = (e) => {
                            if (typeof e.button === 'number' && e.button !== 0) return;
                            e.preventDefault();
                            e.stopPropagation();
                            endDrawingDrag();
                            applyPendingFaixaStartByDate(cellDate);
                        };
                        cell.addEventListener('pointerdown', handleStartPick);
                    } else if (canEdit) {
                        cell.dataset.canEdit = '1';
                        if (!isSelected) cell.classList.add('slot-free-draw');

                        cell.style.cursor = 'crosshair';
                        cell.addEventListener('mousedown', (e) => {
                            if (e.button !== 0) return;
                            e.preventDefault();
                            e.stopPropagation();
                            drawingDragState.active = true;
                            drawingDragState.shouldSelect = !cell.classList.contains('selected-slot');
                            drawingDragState.touchedAnyCell = false;
                            if (document.body) document.body.style.userSelect = 'none';

                            const applied = tryApplyDrawingSelection(cell, drawingDragState.shouldSelect, drawStyles);
                            if (!applied) {
                                drawingDragState.active = false;
                                if (document.body) document.body.style.userSelect = '';
                                return;
                            }
                            drawingDragState.touchedAnyCell = true;
                        });
                        cell.addEventListener('mouseenter', () => {
                            if (!drawingDragState.active) return;
                            const applied = tryApplyDrawingSelection(cell, drawingDragState.shouldSelect, drawStyles);
                            if (!applied) {
                                endDrawingDrag();
                                return;
                            }
                            drawingDragState.touchedAnyCell = true;
                        });
                    } else if (allocs.length > 0) {
                        delete cell.dataset.canEdit;
                        cell.style.opacity = '0.6';
                        cell.style.pointerEvents = 'auto';
                        if (!showContextWhileDrawing) {
                            cell.innerHTML = '';
                            cell.style.background = '#dfe6e9';
                        }
                        cell.style.cursor = 'not-allowed';
                        cell.querySelectorAll('.remove-btn').forEach((btn) => { btn.style.pointerEvents = 'none'; });
                        cell.title = 'Horario ocupado nesta semana (data real). Use outra semana ou ajuste inicio/faixa.';
                    } else {
                        delete cell.dataset.canEdit;
                        cell.style.pointerEvents = 'auto';
                        cell.style.cursor = 'not-allowed';
                        if (isHoliday) {
                            cell.classList.add('slot-week-holiday');
                            cell.title = holidayLabel ? `Feriado: ${holidayLabel}` : 'Feriado nesta data';
                        } else if (waitingStartPick && !!cellDate) {
                            cell.classList.add('slot-week-disabled');
                            cell.title = startPickValidation.message || `Data indisponível para o início da Faixa ${String(pendingFaixaStartPick)}.`;
                        } else if (!isInsideFaixa) {
                            if (selfAllocs.length > 0) {
                                // Mostra o fundo colorido da componente em edição em faixas diferentes da ativa
                                renderSlotContent(cell, selfAllocs, i);
                                cell.style.opacity = '0.55';
                                cell.style.cursor = 'default';
                                cell.style.pointerEvents = 'none';
                                cell.title = 'Alocação desta componente em outra faixa (somente leitura).';
                            } else {
                                cell.classList.add('slot-week-disabled', 'slot-out-of-faixa');
                                cell.style.pointerEvents = 'auto';
                                cell.style.cursor = 'not-allowed';
                                cell.title = 'Slot nao disponivel para esta faixa (fora do intervalo de datas). Ajuste a data da faixa ou navegue para outra semana.';
                                cell.addEventListener('click', (e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    showToastWarning('Slot nao disponivel. Ajuste a data da faixa.', 'warning', 2400);
                                });
                            }
                        }
                    }
                }

                gridContainer.appendChild(cell);
            }
        }
    });

    applyStartSuggestionHighlight();
    applyWeeklyGridRowHeightScale();
    updateWeeklySavePatternButton();
    playWeeklyShiftAnimation();
}

// Destaca na Grade Semanal a celula {data, slot} sugerida como encaixe da nova
// componente (borda pontilhada), enquanto a Faixa 1 ainda estiver na data
// sugerida e o slot continuar livre.
function applyStartSuggestionHighlight() {
    if (!gridContainer) return;
    gridContainer.querySelectorAll('.slot-start-suggestion').forEach((cell) => {
        cell.classList.remove('slot-start-suggestion');
        if (cell.dataset.startSuggestionTitle !== undefined) {
            if (cell.title === 'Encaixe sugerido para iniciar a componente') cell.title = cell.dataset.startSuggestionTitle;
            delete cell.dataset.startSuggestionTitle;
        }
    });

    if (!lastStartSuggestion?.date || !lastStartSuggestion.slot) return;
    const f1Ini = document.getElementById('inp-data-inicio-f1')?.value || '';
    if (f1Ini !== lastStartSuggestion.date) return;

    const targetSlot = normalizeConflictSlotLabel(lastStartSuggestion.slot);
    const cells = gridContainer.querySelectorAll(`[data-date="${lastStartSuggestion.date}"]`);
    for (const cell of cells) {
        if (normalizeConflictSlotLabel(cell.dataset.horario || '') !== targetSlot) continue;
        cell.classList.add('slot-start-suggestion');
        cell.dataset.startSuggestionTitle = cell.title || '';
        cell.title = 'Encaixe sugerido para iniciar a componente';
        break;
    }
}

function createCell(classNames, text) {
    const div = document.createElement('div');
    div.className = classNames;
    div.textContent = text;
    return div;
}

function renderSlotContent(cell, allocs, dayOfWeek = 0) {
    cell.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'mini-card-container';

    allocs.forEach(alloc => {
        const info = getDisciplinaInfo(alloc.disciplina);
        const card = document.createElement('div');
        const docenteNome = getDocenteShortLabel(alloc.docente) || '';

        card.className = 'mini-card';
        card.style.backgroundColor = vividHexColor(alloc.cor);
        card.style.cursor = 'pointer';
        if (isPriorityRegularAllocation(alloc)) {
            card.style.border = '2px dashed #000';
        }

        const allocTurno = alloc.turno ||
            store.rawData?.turmas?.find(t => String(t.turma_id) === String(alloc.turmaId))?.turno || 'Tarde';
        const turnoLetter = alloc.sabadoManha && dayOfWeek === 6
            ? (getTurnoLetter(alloc.horario) || 'M')
            : '';
        const allocTurnoNorm = String(allocTurno).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const isNative = allocTurnoNorm.includes('manh') && turnoLetter === 'M';
        const badgeHTML = (turnoLetter && !isNative)
            ? `<span style="display:inline-block; font-size:0.65em; background:#e67e22; color:#fff; padding:1px 4px; border-radius:3px; margin-left:2px; font-weight:bold;" title="Aula excepcionalmente no turno ${turnoLetter === 'M' ? 'da Manhã' : turnoLetter === 'T' ? 'da Tarde' : 'da Noite'}">(${turnoLetter})</span>` : '';

        card.innerHTML = `
            <div class="card-title" title="${alloc.disciplina}${docenteNome ? ` - ${docenteNome}` : ''}">
                <span class="card-comp">${info.abrev}${getShiftChangeMeta(alloc, alloc.horario, dayOfWeek).badgeHTML || badgeHTML}</span>
                ${docenteNome ? `<span class="card-docente">${docenteNome}</span>` : ''}
            </div>
            <span class="remove-btn" title="Remover">×</span>
        `;

        card.title = `${alloc.disciplina}${docenteNome ? ` - ${docenteNome}` : ''}\nDuplo clique para editar esta alocacao.`;

        card.querySelector('.remove-btn').onclick = (e) => {
            e.stopPropagation();
            if (confirm(`Remover alocação de ${alloc.disciplina}?`)) {
                store.removeAllocation(alloc.id);
                syncAllRegularDates();
                syncAllIntensiveDates();
                renderWeeklyGrid();
                renderOfertasList();
            }
        };

        card.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            loadAllocationIntoEditor(alloc, [alloc.id]);
        });

        container.appendChild(card);
    });

    cell.appendChild(container);
}

function loadAllocationIntoEditor(allocation, idsToRemove = []) {
    const a = allocation;
    if (!a) return;

    const info = getDisciplinaInfo(a.disciplina);
    if (!confirm('Carregar para edicao? A oferta antiga sera removida e a aba Alocar Componentes sera aberta para ajuste desta componente.')) return;

    weeklyState.editingDisciplinaDraft = normalizeDisciplinaInputValue(a.disciplina);
    weeklyState.editingImportadoDraft = !!a.importado;
    setComponentStartSelectionMode('auto');
    updateWeeklyFaixasTitleDisciplina();
    let editorFaixasAdjusted = false;

    if (inputConfig.disciplina) {
        inputConfig.disciplina.value = `${a.disciplina} (${info.ch}h)`;
        inputConfig.disciplina.dispatchEvent(new Event('input'));
    }
    if (inputConfig.cor && a.cor) {
        const vividCor = vividHexColor(a.cor);
        inputConfig.cor.value = vividCor;
        setTimeout(() => { inputConfig.cor.value = vividCor; }, 50);
    }
    enforceCanonicalFaixaMode();

    // isReEdit: true = oferta já tinha faixas salvas (re-edição); false = pendente (1ª vez)
    const isReEdit = isFaixaAllocation(a);

    if (isFaixaAllocation(a)) {
        const hydrated = hydrateFaixasFromComponente(a, { useStoredExecution: true }) || {};
        editorFaixasAdjusted = !!hydrated.wasAdjusted;
    } else {
        const preferredStart = getPreferredPendingStartDateForCurrentTurma();
        notifyStartSuggestionFeedback();
        collapseFaixasForNewComponent({ preferredStart, useCurrentUI: false });
        // Guarda preferredStart para reposicionar a grade após applyWeekAutoPositionForComponentChange
        a._pendingPreferredStart = preferredStart;
    }

    const chkMulti = document.getElementById('chk-multi-docente');
    if (a.docentes && a.docentes.length > 0) {
        if (chkMulti && !chkMulti.checked) {
            chkMulti.checked = true;
            chkMulti.dispatchEvent(new Event('change'));
        }
        const listMulti = document.getElementById('multi-docente-list');
        if (listMulti) {
            listMulti.innerHTML = '';
            a.docentes.forEach((d) => addTeacherRow(d.nome, d.ch));
            updateTotalCHDisplay();
        }
    } else {
        if (chkMulti && chkMulti.checked) {
            chkMulti.checked = false;
            chkMulti.dispatchEvent(new Event('change'));
        }
        if (inputConfig.docente) {
            inputConfig.docente.value = a.docente === 'A definir' ? '' : (a.docente || '');
            inputConfig.docente.dispatchEvent(new Event('input'));
        }
    }

    updateWeeklyContextNote();
    updateWeeklyFaixaHoursDisplay();
    applyWeekAutoPositionForComponentChange({ render: false });
    // Para pendentes: reposiciona a grade na data sugerida, que pode ter sido
    // sobrescrita por applyWeekAutoPositionForComponentChange acima.
    if (a._pendingPreferredStart) {
        setWeeklyViewByDate(a._pendingPreferredStart, { followFaixa: false, render: false });
        delete a._pendingPreferredStart;
    }
    // Edicao segura: NAO remove a oferta antiga agora. A remocao persiste no
    // localStorage e seria perdida num reload antes de salvar. Apenas rastreia
    // os IDs originais para remove-los no momento do salvar (ver handleAddManual).
    // A grade semanal oculta esses IDs durante a edicao (renderWeeklyGrid).
    weeklyState.editingOriginalAllocationIds = Array.isArray(idsToRemove) ? idsToRemove.slice() : [];
    // Guarda a data inicial original (menor inicio entre as faixas) para que o
    // "Limpar Faixas" reposicione a Faixa 1 onde a componente ja estava, em vez
    // de recalcular o primeiro dia livre.
    weeklyState.editingComponentOriginalStart = (() => {
        const inicios = (getNormalizedIntensiveFaixas(a) || [])
            .map((f) => String(f?.inicio || '').trim())
            .filter(Boolean)
            .sort();
        return inicios[0] || '';
    })();
    // Diagnostico: transicao "entrar em edicao" — traca e valida invariantes
    // (so faz algo quando __weeklyStateDebug.trace(true) esta ligado).
    weeklyState.trace('loadAllocation:enter', { disciplina: a?.disciplina });
    weeklyState.checkInvariants('loadAllocation');
    syncAllRegularDates();

    // Ativa explicitamente o modo de desenho na Faixa 1 (ou na faixa com padrão carregado)
    // para que a grade exiba os slots com o visual de "recém marcado" na cor original.
    const faixaToActivate = normalizeFaixaPattern(faixasPatterns[1]).length > 0
        ? 1
        : ([2, 3].find((fi) => normalizeFaixaPattern(faixasPatterns[fi]).length > 0) || activeFaixaIndex || 1);
    activeFaixaIndex = faixaToActivate;
    drawingFaixaIndex = faixaToActivate;
    weeklyViewState.followActiveFaixa = true;
    const _drawNameEl = document.getElementById('drawing-faixa-name');
    if (_drawNameEl) _drawNameEl.textContent = `Faixa ${faixaToActivate}`;
    // Badge textual removido: a faixa ativa passa a ser destacada na propria tabela de faixas.
    const _reeditBadge = document.getElementById('reedit-badge');
    if (_reeditBadge) _reeditBadge.classList.add('hidden');
    refreshActiveFaixaHighlight();
    const _toolbar = document.getElementById('drawing-toolbar');
    if (_toolbar) _toolbar.classList.add('hidden');

    renderWeeklyGrid();
    renderOfertasList();
    if (editorFaixasAdjusted) {
        showToastWarning('A oferta foi carregada com faixas ajustadas para refletir a execucao real ja salva.', 'success', 3200);
    }
    switchTab('weekly');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Desfazer a ultima insercao: guarda um snapshot do estado das alocacoes ANTES
// de cada save bem-sucedido (insercao individual, edicao de pendente ou de
// ofertada). Undo de um nivel: restaura o estado anterior. Importacoes em lote
// (handleImportBloco) nao passam por aqui, entao nao geram snapshot.
let lastAllocationUndoSnapshot = null;

function snapshotAllocationsForUndo() {
    try {
        return JSON.parse(JSON.stringify(store.allocations || []));
    } catch (err) {
        return null;
    }
}

function commitAllocationUndoSnapshot(snapshot) {
    lastAllocationUndoSnapshot = Array.isArray(snapshot) ? snapshot : null;
    updateUndoAllocationButtonUI();
}

function clearAllocationUndoSnapshot() {
    lastAllocationUndoSnapshot = null;
    updateUndoAllocationButtonUI();
}

function updateUndoAllocationButtonUI() {
    const btn = document.getElementById('btn-undo-alloc');
    if (!btn) return;
    const hasSnapshot = Array.isArray(lastAllocationUndoSnapshot);
    btn.classList.toggle('hidden', !hasSnapshot);
    btn.disabled = !hasSnapshot;
}

function handleUndoLastAllocation() {
    if (!Array.isArray(lastAllocationUndoSnapshot)) {
        showToastWarning('Nao ha insercao recente para desfazer.', 'warning', 2600);
        return;
    }
    if (!confirm('Desfazer a ultima insercao e voltar ao estado anterior das alocacoes?')) return;
    store.replaceAllocations(lastAllocationUndoSnapshot);
    clearAllocationUndoSnapshot();
    setComponentStartSelectionMode('auto');
    weeklyState.editingOriginalAllocationIds = [];
    updateWeeklyFaixasTitleDisciplina();
    refreshPendingFaixaStartPickUI();
    updateWeeklyContextNote();
    updateWeeklyFaixaHoursDisplay();
    renderWeeklyGrid();
    renderOfertasList();
    showToastWarning('Ultima insercao desfeita. Alocacoes voltaram ao estado anterior.', 'success', 3600);
}

function handleAddManual() {
    // Nova tentativa de salvar: limpa qualquer bloqueio anterior (sera re-setado
    // abaixo se ainda houver impedimento).
    clearWeeklyBlock();
    if (!store.selectedTurma) {
        setWeeklyBlock('Selecione uma turma', 'Escolha uma turma valida na barra lateral antes de salvar a componente.');
        showToastWarning('Selecione uma turma.', 'warning', 2200);
        return;
    }
    const docData = getDocenteData();
    if (!docData.isValid) {
        setWeeklyBlock('Preencha o(s) docente(s)', 'Informe ao menos um professor responsavel pela componente antes de salvar.');
        showToastWarning('Preencha o(s) Docente(s).', 'warning', 2200);
        return;
    }
    if (pendingFaixaStartPick) {
        setWeeklyBlock(`Finalize o inicio da Faixa ${pendingFaixaStartPick}`, 'Clique em um dia da grade para definir a data de inicio dessa faixa e depois salve.');
        showToastWarning(`Finalize a definicao de inicio da Faixa ${pendingFaixaStartPick} antes de salvar a componente.`, 'warning', 2600);
        return;
    }
    if (drawingFaixaIndex) persistActiveDrawingSelection();

    const disciplina = (inputConfig.disciplina?.value ?? '').replace(/\s*\(\s*\d+\s*h\s*\)\s*$/i, '');
    const tipo = 'faixas';
    const inicioFaixa1 = document.getElementById('inp-data-inicio-f1')?.value ?? '';
    const inicio = inicioFaixa1;
    const subGrupo = (document.getElementById('inp-sub-turma')?.value ?? '').trim();

    if (!disciplina) {
        showToastWarning('Preencha o componente.', 'warning', 2200);
        return;
    }

    if (String(tipo || '').trim().toLowerCase() === 'faixas') {
        if (!inicio) {
            showToastWarning('Defina a data de início.', 'warning', 2200);
            return;
        }

        const info = getDisciplinaInfo(disciplina);
        const ch = info.ch || 0;
        if (ch === 0) {
            showToastWarning(`O componente "${disciplina}" tem CH 0.`, 'error', 3000);
            return;
        }
        if (docData.mode === 'multi' && docData.totalCH > ch) {
            showToastWarning('A soma das cargas horárias excede a CH da disciplina.', 'error', 3200);
            return;
        }

        const effectiveCH = ch;

        let diasMarcados = [];

        let faixasConfig = [];
        try {
            faixasConfig = collectIntensiveFaixasFromUI(inicio);
        } catch (err) {
            showToastWarning(err.message || 'Erro ao ler as faixas da componente.', 'error', 3200);
            return;
        }
        if (faixasConfig.length === 0) {
            showToastWarning('Configure ao menos uma faixa da componente.', 'warning', 2600);
            return;
        }

        let previewIntensive = null;
        let execution = null;
        let finalAdjustmentNotice = '';

        // Estrategia B (automatica por tipo): a componente sendo salva so empurra as
        // demais quando e INTENSIVA (dias consecutivos). Nesse caso ela ocupa o bloco
        // "cheio" (sem desviar), expondo os conflitos reais. Componentes nao intensivas
        // continuam desviando para os buracos livres (respectTurmaOccupancy).
        const savingIsIntensive = isIntensiveComponentByFaixas(faixasConfig);
        const respectTurmaOccupancy = !savingIsIntensive;

        for (let attempt = 0; attempt < 2; attempt++) {
            diasMarcados = [...new Set(faixasConfig.flatMap((f) => f.dias || []))].sort((a, b) => a - b);
            if (diasMarcados.length === 0) diasMarcados = [1, 2, 3, 4, 5];

            const sabadoManhaCheckbox = document.getElementById('chk-sabado-manha');
            const sabadoManha = sabadoManhaCheckbox ? sabadoManhaCheckbox.checked : false;

            previewIntensive = {
                turmaId: store.selectedTurma,
                disciplina,
                subGrupo: subGrupo || null,
                modo: 'faixas',
                ch: effectiveCH,
                dataInicio: faixasConfig[0].inicio,
                dataFim: faixasConfig[0].inicio,
                horariosOcupados: [],
                diasMarcados,
                usaSabado: diasMarcados.includes(6),
                sabadoManha: sabadoManha,
                faixas: faixasConfig
            };

            execution = computeIntensiveExecution(previewIntensive, { respectPriority: true, respectTurmaOccupancy: respectTurmaOccupancy });
            if (execution.totalHours === 0) {
                showToastWarning('Nenhuma aula foi gerada com as faixas configuradas.', 'error', 3000);
                return;
            }

            const finalAdjustmentSuggestion = buildFinalAdjustmentFaixaSuggestion(faixasConfig, execution);
            if (!finalAdjustmentSuggestion || attempt > 0) {
                break;
            }

            applyFinalAdjustmentFaixaSuggestion(finalAdjustmentSuggestion, { showToast: false });
            faixasConfig = Array.isArray(finalAdjustmentSuggestion.faixas)
                ? finalAdjustmentSuggestion.faixas.map(normalizeFaixaEntry).filter(Boolean)
                : faixasConfig;
            finalAdjustmentNotice = buildFinalAdjustmentSuggestionMessage(finalAdjustmentSuggestion);
        }

        let nonBlockingDistributionNotice = '';
        let nonBlockingDistributionNoticeType = 'warning';
        if (finalAdjustmentNotice) {
            nonBlockingDistributionNotice = finalAdjustmentNotice;
            nonBlockingDistributionNoticeType = 'success';
        }
        if (execution.wasTruncatedByCH) {
            const truncatedMsg = 'A componente foi inserida, mas a ultima semana ficou parcial. Se desejar, voce pode criar uma segunda faixa para ajustar melhor a distribuicao final.';
            nonBlockingDistributionNotice = nonBlockingDistributionNotice
                ? `${nonBlockingDistributionNotice} ${truncatedMsg}`
                : truncatedMsg;
            nonBlockingDistributionNoticeType = 'warning';
        }

        if (execution.totalHours !== effectiveCH) {
            const diff = execution.totalHours - effectiveCH;
            const diffMsg = diff < 0
                ? `A carga alocada ficou em ${execution.totalHours}h para uma meta de ${effectiveCH}h. Voce pode manter assim agora e ajustar depois, se desejar.`
                : `A carga alocada ficou em ${execution.totalHours}h para uma meta de ${effectiveCH}h. Voce pode visualizar assim primeiro e ajustar depois, se desejar.`;

            nonBlockingDistributionNotice = nonBlockingDistributionNotice
                ? `${nonBlockingDistributionNotice} ${diffMsg}`
                : diffMsg;
            if (nonBlockingDistributionNoticeType !== 'warning') nonBlockingDistributionNoticeType = 'warning';
        }

        const faixaHoursSummary = buildFaixaHoursSummaryFromExecution(faixasConfig, execution.byDate);
        const faixasComCarga = faixaHoursSummary.filter((f) => f.horas > 0);

        if (faixasComCarga.length > 1) {
            const resumoFaixas = faixasComCarga
                .map((f) => 'Faixa ' + f.faixa + ': ' + f.horas + 'h')
                .join(' | ');

            const msgConfirm =
                'Distribuicao confirmada. A componente ficou organizada em ' + faixasComCarga.length + ' faixas: ' + resumoFaixas + '.\n\n' +
                'Esse ajuste foi reconhecido normalmente pelo sistema e ajuda a evitar uma alocacao final pouco pratica (como slot isolado).\n\n' +
                'Clique em OK para continuar.';

            if (!confirm(msgConfirm)) return;
        }

        const inicioCalculado = execution.dataInicio || inicio;
        const dataFimCalculada = execution.dataFim || inicioCalculado;
        const faixasConfigAjustadas = alignFaixasToExecutionEnd(faixasConfig, dataFimCalculada);
        const horariosUltimoDia = execution.horariosUltimoDia || [];
        const slotsIntensiva = execution.unionSlots || [];
        diasMarcados = execution.unionDias || diasMarcados;
        const usaSabado = diasMarcados.includes(6);
        const sabadoManhaCheckbox = document.getElementById('chk-sabado-manha');
        const sabadoManha = sabadoManhaCheckbox ? sabadoManhaCheckbox.checked : false;

        const candidateIntensiveForConflict = {
            ...previewIntensive,
            dataInicio: inicioCalculado,
            dataFim: dataFimCalculada,
            executionByDate: execution.byDate || {},
            horariosOcupados: slotsIntensiva,
            diasMarcados,
            usaSabado,
            sabadoManha,
            faixas: faixasConfigAjustadas
        };

        const intensiveConflict = findTurmaConflictForCandidateExecution(candidateIntensiveForConflict, execution);

        const isImportedSave = !!weeklyState.editingImportadoDraft;
        // Valores efetivos de posicionamento. Podem ser deslocados adiante quando
        // ha conflito: a componente intensiva e EMPILHADA em sequencia (bloco
        // continuo) logo apos as componentes ja alocadas, sem dividir nem empurrar
        // nenhuma outra. Isso evita intercalar uma intensiva ENTRE as faixas de
        // outra componente (comportamento antigo de "pausa e retoma", removido).
        let effInicio = inicioCalculado;
        let effFim = dataFimCalculada;
        let effExecutionByDate = execution.byDate || {};
        let effSlots = slotsIntensiva;
        let effUltimoDia = horariosUltimoDia;
        let effDias = diasMarcados;
        let effUsaSabado = usaSabado;
        let effFaixas = faixasConfigAjustadas;

        if (intensiveConflict) {
            if (savingIsIntensive) {
                // EMPILHAR EM SEQUENCIA: reposiciona ESTA componente para logo apos
                // as componentes ja alocadas da turma. Nenhuma outra e dividida nem
                // empurrada, entao nunca ha intercalamento entre faixas.
                const candidateForStacking = {
                    ...candidateIntensiveForConflict,
                    docente: docData.docente,
                    docentes: docData.docentesList
                };
                const stacked = stackIntensiveAfterAllocations(
                    candidateForStacking,
                    store.selectedTurma,
                    inicioCalculado
                );
                if (!stacked) {
                    setWeeklyBlock(
                        'Sem espaco no periodo letivo',
                        `Nao ha espaco livre para empilhar "${disciplina}" em sequencia. Ajuste as datas do periodo (barra lateral) ou remova alguma componente ja alocada.`
                    );
                    showToastWarning(
                        `Nao ha espaco livre para empilhar "${disciplina}" em sequencia dentro do periodo letivo. Ajuste as datas do periodo ou remova alguma componente.`,
                        'error',
                        6200
                    );
                    return;
                }
                effInicio = stacked.candidate.dataInicio;
                effFim = stacked.candidate.dataFim;
                effExecutionByDate = stacked.candidate.executionByDate || {};
                effSlots = stacked.candidate.horariosOcupados || [];
                effUltimoDia = stacked.candidate.horariosUltimoDia || [];
                effDias = stacked.candidate.diasMarcados || diasMarcados;
                effUsaSabado = (stacked.candidate.diasMarcados || []).includes(6);
                effFaixas = Array.isArray(stacked.candidate.faixas) ? stacked.candidate.faixas : faixasConfigAjustadas;

                showToastWarning(
                    `Havia conflito na data escolhida. "${disciplina}" foi posicionada em sequencia, de ${formatDateBR(effInicio)} a ${formatDateBR(effFim)}, logo apos as componentes ja alocadas.`,
                    'success',
                    5600
                );
            } else {
                // Componente NAO intensiva com conflito residual: bloqueia (ela ja
                // deveria ter desviado para os buracos livres). Nunca empurra nem
                // intercala outras componentes.
                setWeeklyBlock(
                    'Sobreposicao de horario',
                    `"${intensiveConflict.disciplina}" ja ocupa esse horario no mesmo periodo. Ajuste a data de inicio desta componente e salve de novo.`
                );
                showToastWarning(
                    `Sobreposicao detectada: "${intensiveConflict.disciplina}" ja ocupa esse horario no mesmo periodo. Ajuste a data de inicio desta componente.`,
                    'error',
                    5600
                );
                return;
            }
        }

        const teachersToCheck = (docData.mode === 'single' ? [docData.docente] : docData.docentesList.map(d => d.nome)).filter(n => n && n.trim().toUpperCase() !== 'A DEFINIR');

        if (teachersToCheck.length > 0) {
            // Checa o conflito de professor na posicao EFETIVA (apos eventual
            // empilhamento), nao na data originalmente escolhida.
            const candidateForTeacherCheck = {
                ...candidateIntensiveForConflict,
                dataInicio: effInicio,
                dataFim: effFim,
                executionByDate: effExecutionByDate,
                horariosOcupados: effSlots,
                diasMarcados: effDias,
                usaSabado: effUsaSabado,
                sabadoManha,
                faixas: effFaixas
            };
            const confirmedTeacherConflict = findConfirmedTeacherConflictForCandidate(
                candidateForTeacherCheck,
                teachersToCheck
            );

            if (confirmedTeacherConflict) {
                const turmaNomeConflito = getTurmaLabel(
                    confirmedTeacherConflict.event.turmaId,
                    confirmedTeacherConflict.event.subGrupo
                );
                const profNomes = confirmedTeacherConflict.teacherName;
                if (!isImportedSave) {
                    setWeeklyBlock(
                        'Sobreposicao de professor',
                        `${profNomes} ja tem ${confirmedTeacherConflict.event.disciplina} na turma ${turmaNomeConflito} em ${formatDateBR(confirmedTeacherConflict.date)} (${confirmedTeacherConflict.horario}). Salvamento cancelado — sobreposicao so e permitida via importacao.`
                    );
                    showToastWarning(
                        `Sobreposicao de professor detectada: ${profNomes} ja tem ${confirmedTeacherConflict.event.disciplina} na turma ${turmaNomeConflito} em ${formatDateBR(confirmedTeacherConflict.date)} (${confirmedTeacherConflict.horario}). Salvamento cancelado - sobreposicao so e permitida em disciplinas carregadas via importacao.`,
                        'error',
                        6200
                    );
                    return;
                }
                showToastWarning(
                    `Sobreposicao de professor permitida (disciplina importada): ${profNomes} em choque na turma ${turmaNomeConflito}. Sera destacada na aba Calendario Docente.`,
                    'warning',
                    5200
                );
            }
        }

        const idsToRemove = store.allocations
            .filter((a) => {
                if (String(a.turmaId) !== String(store.selectedTurma)) return false;
                if (a.disciplina !== disciplina || !isFaixaAllocation(a)) return false;
                if (String(a.subGrupo || '') !== String(subGrupo || '')) return false;
                return isDateOverlap(
                    effInicio,
                    effFim,
                    a.dataInicio || store.settings.termStart,
                    a.dataFim || store.settings.termEnd
                );
            })
            .map((a) => a.id);

        // Edicao segura: inclui os IDs originais rastreados mesmo que a componente
        // tenha sido movida para um periodo SEM sobreposicao (o filtro acima exige
        // overlap). Guardado por turma/disciplina/subGrupo para nunca remover algo
        // de outra componente caso o rastreio tenha ficado obsoleto.
        weeklyState.editingOriginalAllocationIds.forEach((id) => {
            if (idsToRemove.includes(id)) return;
            const al = store.allocations.find((a) => a.id === id);
            if (!al) return;
            if (String(al.turmaId) !== String(store.selectedTurma)) return;
            // Aceita tanto ofertas ja alocadas (faixas) quanto a oferta PENDENTE
            // original (modo 'pendente', vinda do Bloco do PPC): ao salvar a edicao
            // de uma pendente ela deve sair da lista de pendentes, entao seu id
            // rastreado precisa entrar em idsToRemove.
            const isPendingOriginal = isPendingAllocation(al);
            if (al.disciplina !== disciplina || !(isFaixaAllocation(al) || isPendingOriginal)) return;
            // A pendente importada do Bloco do PPC guarda subGrupo=blocoId (ex.: "BL1"),
            // mas o editor limpa o campo de sub-turma ao carregar a disciplina. Como o id
            // foi rastreado explicitamente da linha editada, nao exigimos igualdade de
            // subGrupo para pendentes (senao ela nunca sairia da lista). Para faixas
            // mantemos a checagem para nao remover outra componente por engano.
            if (!isPendingOriginal && String(al.subGrupo || '') !== String(subGrupo || '')) return;
            idsToRemove.push(id);
        });

        const actionText = idsToRemove.length > 0 ? 'Atualizar alocacao existente?' : 'Confirmar alocacao?';
        if (!confirm(`${disciplina} (${formatDateBR(effInicio)} a ${formatDateBR(effFim)})\n\n${actionText}`)) return;

        const undoSnapshot = snapshotAllocationsForUndo();
        idsToRemove.forEach((id) => store.removeAllocation(id));

        store.addAllocation({
            turmaId: store.selectedTurma,
            disciplina: disciplina,
            docente: docData.docente,
            docentes: docData.docentesList,
            modo: 'faixas',
            ch: effectiveCH,
            dataInicio: effInicio,
            dataFim: effFim,
            modelo: 'Automatico',
            executionByDate: effExecutionByDate,
            horariosOcupados: effSlots,
            horariosUltimoDia: effUltimoDia,
            diasMarcados: effDias,
            usaSabado: effUsaSabado,
            sabadoManha: sabadoManha,
            faixas: effFaixas,
            subGrupo: subGrupo || null,
            cor: inputConfig.cor ? inputConfig.cor.value : store.getDisciplinaColor(disciplina),
            importado: isImportedSave
        });

        if (effInicio && store.selectedTurma) {
            store.setTurmaLastStart(store.selectedTurma, effInicio);
        }

        commitAllocationUndoSnapshot(undoSnapshot);

        syncAllIntensiveDates();
        const allocAtualizada = [...store.allocations].reverse().find((a) =>
            String(a.turmaId) === String(store.selectedTurma) &&
            isFaixaAllocation(a) &&
            a.disciplina === disciplina &&
            String(a.subGrupo || '') === String(subGrupo || '')
        );
        if (allocAtualizada) {
            const faixasSidebar = alignFaixasToExecutionEnd(
                getNormalizedIntensiveFaixas(allocAtualizada),
                allocAtualizada.dataFim || effFim
            );
            applyFaixasConfigToSidebar(faixasSidebar);
        }
        // Encerra a edicao: a componente recem salva passa a aparecer alocada na
        // Grade Semanal (cards fixos) em vez de permanecer no visual de desenho.
        finalizeWeeklyEditorAfterSave();
        renderOfertasList();

        if (nonBlockingDistributionNotice) {
            showToastWarning(nonBlockingDistributionNotice, nonBlockingDistributionNoticeType, 6200);
        }

        if (execution.wasTruncatedByCH && execution.truncationType === 'partial-day') {
            showPersistentStatusMessage('Alocacao fracionada concluida com sucesso.', 'success');
        }

    }
}
function updateListPrintHeader() {
    const header = document.getElementById('print-header-list');
    if (!header) return;

    const turmaId = store.selectedTurma || '';
    const turmaLabel = getTurmaBaseLabel(turmaId);
    const meta = getPrintAcademicMetaLine(turmaId);
    header.innerHTML = `<span class="print-title-line">LISTA DE OFERTAS (${meta})</span>`;
}

function renderOfertasList() {
    const tbody = document.querySelector('#ofertas-table tbody');
    if (!tbody) return;
    updateActivePlanStatus();
    updateListPrintHeader();

    const theadTr = document.querySelector('#ofertas-table thead tr');
    if (theadTr && !document.getElementById('th-sigaa')) {
        const thSigaa = document.createElement('th');
        thSigaa.id = 'th-sigaa';
        thSigaa.textContent = 'SIGAA';
        thSigaa.style.textAlign = 'center';
        theadTr.insertBefore(thSigaa, theadTr.lastElementChild);
    }

    const getColCount = () => document.querySelectorAll('#ofertas-table thead th').length || 7;
    const dayLabels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
    const semesterStart = calStart ? calStart.value : '2025-01-01';
    const semesterEnd = calEnd ? calEnd.value : '2025-12-31';
    const list = store.allocations.filter((a) => String(a.turmaId) === String(store.selectedTurma));
    const offerProjection = buildCanonicalOfferProjection({
        allocations: list,
        startDate: semesterStart,
        endDate: semesterEnd
    });
    const pendentes = list.filter((a) => isPendingAllocation(a));

    const appendSeparator = (label) => {
        const tr = document.createElement('tr');
        tr.className = 'list-section-sep';
        tr.innerHTML = `<td colspan="${getColCount()}">${label}</td>`;
        tbody.appendChild(tr);
    };

    const ensureWarningEndDate = (end) => {
        let endFmt = formatDateBR(end);
        if (store.settings.termEnd && end > store.settings.termEnd) {
            endFmt = `<span style="color:#c0392b; font-weight:bold; font-size:1.1em;" title="Atenção: Esta data ultrapassa o fim oficial do semestre!">${endFmt}</span>`;
        }
        return endFmt;
    };

    const buildRegularRows = () => {
        return (offerProjection.regularOfferGroups || []).map((group) => {
            const first = group.baseAlloc;
            const info = getDisciplinaInfo(first.disciplina);
            const horariosResumo = (Array.isArray(group.scheduleEntries) ? group.scheduleEntries : [])
                .map((entry) => `${dayLabels[entry.diaSemana] || 'Dia'} ${entry.horario}`)
                .join(', ');

            return {
                rowType: 'regular_group',
                baseAlloc: first,
                groupIds: group.allocationIds,
                disciplina: group.disciplina,
                componentKey: group.componentKey,
                codigo: info.codigo || '-',
                docente: group.docenteLabel || first.docente,
                tipoLabel: 'componente',
                start: group.start,
                end: group.end,
                horarioTxt: `${formatDateBR(group.start)} a ${ensureWarningEndDate(group.end)}<br><small>${horariosResumo}</small>`,
                totalHoras: group.executedHours,
                chMax: first.ch || info.ch,
                details: `${group.maxExecutionDays} semanas`,
                sigaaCode: getSigaaCode(group.allocations),
                faixaIndex: 0
            };
        });
    };

    const buildIntensiveRows = () => {
        const rows = [];
        (offerProjection.faixaOfferGroups || [])
            .slice()
            .sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')))
            .forEach((group) => {
                const base = group.baseAlloc;
                const info = getDisciplinaInfo(base.disciplina);
                const faixas = getNormalizedIntensiveFaixas(base);
                const fallbackDias = Array.isArray(base.diasMarcados) && base.diasMarcados.length > 0
                    ? base.diasMarcados
                    : (base.usaSabado ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5]);
                const fallbackSlots = Array.isArray(base.horariosOcupados) ? base.horariosOcupados : [];

                const resolvedFaixas = faixas.length > 0
                    ? faixas
                    : [{
                        inicio: base.dataInicio || semesterStart,
                        fim: base.dataFim || semesterEnd,
                        dias: fallbackDias,
                        slots: fallbackSlots,
                        drawnSlotsByDay: fallbackDias.reduce((acc, d) => {
                            acc[d] = [...fallbackSlots];
                            return acc;
                        }, {})
                    }];

                resolvedFaixas.forEach((faixa, idx) => {
                    const faixaStart = faixa.inicio || base.dataInicio || semesterStart;
                    const faixaEnd = faixa.fim || base.dataFim || semesterEnd;
                    const faixaDias = Array.isArray(faixa.dias) && faixa.dias.length > 0 ? faixa.dias : fallbackDias;
                    const faixaSlots = Array.isArray(faixa.slots) && faixa.slots.length > 0 ? faixa.slots : fallbackSlots;
                    const dateHours = offerProjection.dateHoursByAlloc.get(base.id) || new Map();
                    let faixaTotalHoras = 0;
                    const faixaDaysSet = new Set();
                    dateHours.forEach((hours, dStr) => {
                        if (dStr >= faixaStart && dStr <= faixaEnd) {
                            faixaTotalHoras += hours;
                            if (hours > 0) faixaDaysSet.add(dStr);
                        }
                    });

                    const scoped = {
                        ...base,
                        ch: 0,
                        dataInicio: faixaStart,
                        dataFim: faixaEnd,
                        diasMarcados: faixaDias,
                        horariosOcupados: faixaSlots,
                        usaSabado: faixaDias.includes(6),
                        faixas: [{ ...faixa, inicio: faixaStart, fim: faixaEnd, dias: faixaDias, slots: faixaSlots }]
                    };
                    const sigaaCode = getSigaaCode([scoped]);
                    const sabadoLabel = faixaDias.includes(6)
                        ? `<br><span style="color:#e67e22; font-weight:bold; font-size:0.8em;">(Inclui Sábados)</span>`
                        : '';

                    rows.push({
                        rowType: 'intensiva_faixa',
                        baseAlloc: base,
                        groupIds: group.allocationIds,
                        disciplina: base.disciplina,
                        componentKey: String(base.disciplina || '').trim().toLocaleUpperCase('pt-BR'),
                        codigo: info.codigo || '-',
                        docente: group.docenteLabel || base.docente,
                        tipoLabel: resolvedFaixas.length > 1 ? `componente <small>(Faixa ${idx + 1})</small>` : 'componente',
                        start: faixaStart,
                        end: faixaEnd,
                        horarioTxt: `${formatDateBR(faixaStart)} a ${ensureWarningEndDate(faixaEnd)}<br><small>Faixa ${idx + 1}</small>`,
                        totalHoras: faixaTotalHoras,
                        chMax: base.ch || info.ch,
                        details: `${faixaDaysSet.size} dias`,
                        sigaaCode,
                        sabadoLabel,
                        faixaIndex: idx + 1
                    });
                });
            });

        rows.sort((a, b) => {
            const comp = (a.componentKey || '').localeCompare(b.componentKey || '');
            if (comp !== 0) return comp;
            const startA = a.start || '9999-12-31';
            const startB = b.start || '9999-12-31';
            if (startA !== startB) return startA.localeCompare(startB);
            return (a.faixaIndex || 0) - (b.faixaIndex || 0);
        });
        return rows;
    };

    const buildCanonicalRows = () => {
        const buildFaixaHorarioResumo = (faixa) => {
            const drawnSlotsByDay = faixa?.drawnSlotsByDay || {};
            return Object.entries(drawnSlotsByDay)
                .sort(([left], [right]) => Number(left) - Number(right))
                .map(([day, slots]) => {
                    const safeSlots = Array.isArray(slots) ? slots.filter(Boolean) : [];
                    if (safeSlots.length === 0) return '';
                    return `${dayLabels[Number(day)] || 'Dia'} ${safeSlots.join(', ')}`;
                })
                .filter(Boolean)
                .join(', ');
        };

        const getOfferFaixas = (group) => {
            if (Array.isArray(group?.faixas) && group.faixas.length > 0) return group.faixas;
            const drawnSlotsByDay = group?.timeRangesByDay || {};
            const dias = Object.keys(drawnSlotsByDay)
                .map((value) => Number.parseInt(value, 10))
                .filter((value) => value >= 1 && value <= 6)
                .sort((left, right) => left - right);
            const slots = [...new Set(Object.values(drawnSlotsByDay).flat().map(String).filter(Boolean))];
            return [{
                faixaId: `${group?.offerKey || 'offer'}|1`,
                index: 1,
                inicio: group?.start || group?.baseAlloc?.dataInicio || semesterStart,
                fim: group?.end || group?.baseAlloc?.dataFim || semesterEnd,
                dias,
                slots,
                drawnSlotsByDay,
                executedHours: group?.executedHours || 0,
                executionDays: group?.activeDates?.length || 0
            }];
        };

        const rows = [];
        offerProjection.offerGroups
            .slice()
            .sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')))
            .forEach((group) => {
                const base = group.baseAlloc || group.allocations?.[0];
                if (!base) return;
                const info = getDisciplinaInfo(base.disciplina);
                const resolvedFaixas = getOfferFaixas(group);

                resolvedFaixas.forEach((faixa, idx) => {
                    const faixaStart = faixa?.inicio || base.dataInicio || semesterStart;
                    const faixaEnd = faixa?.fim || base.dataFim || semesterEnd;
                    const scoped = buildScopedSigaaAllocationFromOfferFaixa(group, faixa, {
                        termStart: semesterStart,
                        termEnd: semesterEnd
                    });
                    const sigaaCode = getSigaaCode([scoped]);
                    const sabadoLabel = Array.isArray(faixa?.dias) && faixa.dias.includes(6)
                        ? `<br><span style="color:#e67e22; font-weight:bold; font-size:0.8em;">(Inclui S\u00e1bados)</span>`
                        : '';
                    const horariosResumo = buildFaixaHorarioResumo(faixa);
                    const faixaLabel = resolvedFaixas.length > 1 ? `Faixa ${idx + 1}` : 'Faixa \u00fanica';
                    const detailParts = [faixaLabel];
                    if (horariosResumo) detailParts.push(horariosResumo);

                    rows.push({
                        rowType: 'offer_faixa',
                        baseAlloc: base,
                        groupIds: group.allocationIds,
                        disciplina: group.disciplina,
                        componentKey: group.componentKey,
                        codigo: info.codigo || '-',
                        docente: group.docenteLabel || base.docente,
                        tipoLabel: resolvedFaixas.length > 1 ? `componente <small>(Faixa ${idx + 1})</small>` : 'componente',
                        start: faixaStart,
                        end: faixaEnd,
                        horarioTxt: `${formatDateBR(faixaStart)} a ${ensureWarningEndDate(faixaEnd)}<br><small>${detailParts.join(' \u2022 ')}</small>`,
                        totalHoras: faixa?.executedHours || 0,
                        chMax: base.ch || info.ch,
                        details: `${faixa?.executionDays || 0} ocorr\u00eancias`,
                        sigaaCode,
                        sabadoLabel,
                        faixaIndex: idx + 1
                    });
                });
            });

        rows.sort((a, b) => {
            const comp = (a.componentKey || '').localeCompare(b.componentKey || '');
            if (comp !== 0) return comp;
            const startA = a.start || '9999-12-31';
            const startB = b.start || '9999-12-31';
            if (startA !== startB) return startA.localeCompare(startB);
            return (a.faixaIndex || 0) - (b.faixaIndex || 0);
        });
        return rows;
    };

    const buildPendenteRows = () => {
        return pendentes.map((a) => {
            const info = getDisciplinaInfo(a.disciplina);
            return {
                rowType: 'pendente',
                baseAlloc: a,
                groupIds: [a.id],
                disciplina: a.disciplina,
                componentKey: String(a.disciplina || '').trim().toLocaleUpperCase('pt-BR'),
                codigo: info.codigo || '-',
                docente: a.docente,
                tipoLabel: '<span style="background:#f1c40f; color:#000; padding:2px 6px; border-radius:4px; font-size:0.85em; font-weight:bold;">Pendente</span>',
                start: a.dataInicio || semesterStart,
                end: a.dataFim || semesterEnd,
                horarioTxt: '<span style="color:#e67e22; font-style:italic; font-weight:bold;">Sem horário definido</span>',
                totalHoras: 0,
                chMax: a.ch || info.ch,
                details: 'Aguardando grade',
                sigaaCode: '-',
                faixaIndex: 0
            };
        }).sort((a, b) => (a.componentKey || '').localeCompare(b.componentKey || ''));
    };

    const handleCopySigaa = async (btn) => {
        const textToCopy = btn.dataset.code;
        try {
            await copyTextToClipboard(textToCopy);
            flashButtonCopyState(btn);
        } catch (err) {
            console.error('Falha ao copiar', err);
        }
    };

    const appendRow = (row, previousRow = null) => {
        const tr = document.createElement('tr');
        if (previousRow && previousRow.rowType !== 'pendente' && row.rowType !== 'pendente') {
            if ((previousRow.componentKey || '') === (row.componentKey || '')) {
                tr.classList.add('oferta-sep-faixa');
            } else {
                tr.classList.add('oferta-sep-component');
            }
        }
        let color = '#2c3e50';
        if (row.chMax > 0) {
            if (row.totalHoras < row.chMax) color = '#d35400';
            if (row.totalHoras === row.chMax) color = '#27ae60';
            if (row.totalHoras > row.chMax) color = '#c0392b';
        }
        const chInfo = row.rowType === 'pendente'
            ? `<span style="color:#7f8c8d;">--- / ${row.chMax}h</span>`
            : `<b style="color:${color}">${row.totalHoras}</b> / ${row.chMax}h <small>(${row.details})</small>${row.sabadoLabel || ''}`;

        const btnCopySigaa = row.sigaaCode && row.sigaaCode !== '-'
            ? `<div style="display:flex; align-items:center; justify-content:center; gap:6px;">
                    <span style="font-family:monospace; font-weight:bold; background:#ecf0f1; padding:2px 6px; border-radius:4px; font-size:0.9em; letter-spacing:1px;">${row.sigaaCode}</span>
                    <button class="btn-sigaa-copy" data-code="${row.sigaaCode}" title="Copiar C\u00f3digo" style="background:transparent; color:var(--primary); border:1px solid #ccc; border-radius:4px; cursor:pointer; padding:2px 6px; font-size:0.9em; transition: all 0.2s;">Copiar</button>
               </div>`
            : `<span style="color:#999;">-</span>`;

        const btnHtml = `
            <button class="btn-primary btn-edit-row" style="padding:4px 8px; margin:0; font-size:0.85em; background-color:#2980b9; border:none; color:white; border-radius:3px; cursor:pointer; margin-right:5px;" title="Editar">Editar</button>
            <button class="btn-danger btn-delete-row" style="padding:4px 8px; margin:0; font-size:0.85em; border-radius:3px; cursor:pointer;" title="Excluir">Excluir</button>
        `;

        tr.innerHTML = `
            <td>${row.disciplina}</td>
            <td style="text-align:center; font-family:monospace; font-weight:bold;">${row.codigo || '-'}</td>
            <td>${row.docente || '-'}</td>
            <td>${row.horarioTxt}</td>
            <td style="text-align:center;">${chInfo}</td>
            <td style="text-align:center;">${btnCopySigaa}</td>
            <td style="white-space:nowrap;"><div style="display:flex; justify-content:center;">${btnHtml}</div></td>
        `;

        const idsToRemove = Array.isArray(row.groupIds) && row.groupIds.length > 0 ? row.groupIds : [row.baseAlloc.id];

        const copyBtn = tr.querySelector('.btn-sigaa-copy');
        if (copyBtn) copyBtn.onclick = (e) => handleCopySigaa(e.currentTarget);

        const btnDelete = tr.querySelector('.btn-delete-row');
        if (btnDelete) {
            btnDelete.onclick = () => {
                const msg = idsToRemove.length > 1
                    ? 'Remover este bloco (todas as linhas associadas)?'
                    : 'Remover esta oferta?';
                if (!confirm(msg)) return;
                idsToRemove.forEach((id) => store.removeAllocation(id));
                syncAllRegularDates();
                syncAllIntensiveDates();
                renderWeeklyGrid();
                renderOfertasList();
            };
        }

        const btnEdit = tr.querySelector('.btn-edit-row');
        if (btnEdit) {
            btnEdit.onclick = () => {
                loadAllocationIntoEditor(row.baseAlloc, idsToRemove);
            };
        }

        tbody.appendChild(tr);
    };

    const canonicalRows = buildCanonicalRows();
    const pendenteRows = buildPendenteRows();
    // Ordena os COMPONENTES pela data de inicio alocada (cronologica), mantendo
    // as linhas (faixas/docentes) de um mesmo componente agrupadas. Espelha a
    // ordem da tabela resumo do calendario.
    const componentEarliestStart = new Map();
    canonicalRows.forEach((row) => {
        const key = row.componentKey || '';
        const start = row.start || '9999-12-31';
        const prev = componentEarliestStart.get(key);
        if (prev === undefined || start.localeCompare(prev) < 0) {
            componentEarliestStart.set(key, start);
        }
    });
    canonicalRows.sort((a, b) => {
        const aCompStart = componentEarliestStart.get(a.componentKey || '') || '9999-12-31';
        const bCompStart = componentEarliestStart.get(b.componentKey || '') || '9999-12-31';
        if (aCompStart !== bCompStart) return aCompStart.localeCompare(bCompStart);
        const comp = (a.componentKey || '').localeCompare(b.componentKey || '');
        if (comp !== 0) return comp;
        const startA = a.start || '9999-12-31';
        const startB = b.start || '9999-12-31';
        if (startA !== startB) return startA.localeCompare(startB);
        const endA = a.end || '9999-12-31';
        const endB = b.end || '9999-12-31';
        if (endA !== endB) return endA.localeCompare(endB);
        const faixaA = a.faixaIndex || 0;
        const faixaB = b.faixaIndex || 0;
        if (faixaA !== faixaB) return faixaA - faixaB;
        return String(a.docente || '').localeCompare(String(b.docente || ''));
    });

    tbody.innerHTML = '';
    let previousCanonicalRow = null;
    canonicalRows.forEach((row) => {
        appendRow(row, previousCanonicalRow);
        previousCanonicalRow = row;
    });

    if (pendenteRows.length > 0) {
        appendSeparator('AGUARDANDO ALOCA\u00c7\u00c3O NA GRADE (PENDENTES)');
        let previousPendingRow = null;
        pendenteRows.forEach((row) => {
            appendRow(row, previousPendingRow);
            previousPendingRow = row;
        });
    }

    if (canonicalRows.length === 0 && pendenteRows.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="${getColCount()}" style="text-align:center; color:#666;">Nenhuma oferta cadastrada.</td>`;
        tbody.appendChild(tr);
    }

    refreshTeacherConflictsUI();
}

function getActiveExportPlanContext() {
    const activePlan = store.getActivePlanMeta();
    const plan = activePlan?.key ? activePlan : null;
    const termStart = plan?.termStart || store.settings.termStart || (calStart ? calStart.value : '2025-01-01');
    const termEnd = plan?.termEnd || store.settings.termEnd || (calEnd ? calEnd.value : '2025-12-31');
    const periodoLetivo = plan?.periodo || store.settings.periodo || '';
    return { plan, termStart, termEnd, periodoLetivo };
}

export function exportSigaaMetadataJSON() {
    const planContext = getActiveExportPlanContext();
    const turmaAllocations = store.allocations.filter((alloc) => String(alloc?.turmaId || '') === String(store.selectedTurma || ''));
    const offerProjection = buildCanonicalOfferProjection({
        allocations: turmaAllocations,
        startDate: planContext.termStart,
        endDate: planContext.termEnd
    });
    
    const dataContext = {
        store,
        planContext,
        turmaId: String(store.selectedTurma || ''),
        unifiedExec: offerProjection,
        offerProjection
    };
    
    const contextMap = {
        getDisciplinaInfo,
        getSigaaCode,
        buildScopedSigaaAllocationFromOfferFaixa,
        formatDateBR
    };

    const payload = buildSigaaMetadataPayload(dataContext, contextMap);
    if (!payload) {
        showToastWarning('Selecione uma turma antes de exportar os metadados SIGAA.', 'warning', 2600);
        return;
    }

    const issues = validateSigaaMetadataPayload(payload);
    if (issues.length) {
        showToastWarning(
            'Exportacao SIGAA cancelada por inconsistencias:<br>- ' + issues.join('<br>- '),
            'error',
            5600
        );
        return;
    }

    const ano = (payload.termStart || '').split('-')[0] || '0000';
    const periodo = payload.periodoLetivo || 'P';
    const fileName = `sigaa_metadata_${payload.cursoSigla || 'CURSO'}_${payload.turmaId}_${ano}_${periodo}.json`;
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(payload, null, 2));
    const a = document.createElement('a');
    a.setAttribute('href', dataStr);
    a.setAttribute('download', fileName);
    document.body.appendChild(a);
    a.click();
    a.remove();
}


function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));

    const tabEl = document.getElementById(`tab-${tabId}`);
    if (tabEl) tabEl.classList.add('active');

    const btn = document.querySelector(`button[data-tab="${tabId}"]`);
    if (btn) btn.classList.add('active');

    if (tabId === 'monthly') {
        renderActiveSubtab('tab-monthly', 'turma-calendar');
    }
    if (tabId === 'teacher') {
        renderActiveSubtab('tab-teacher', 'docente-calendar');
    }
    if (tabId === 'list') {
        renderOfertasList();
    }
    if (tabId === 'weekly') {
        updateWeeklyNavigatorLabel();
    }
}

// Renderiza o conteudo da sub-aba (Calendario/Gantt) associada a uma aba de calendario.
function renderSubtabContent(subtabId) {
    switch (subtabId) {
        case 'turma-calendar':
            renderMonthlyCalendar();
            break;
        case 'turma-gantt':
            renderTurmaGantt();
            break;
        case 'docente-calendar':
            refreshTeacherConflictsUI();
            break;
        case 'docente-gantt':
            renderGanttChart();
            break;
        default:
            break;
    }
}

function renderActiveSubtab(tabContentId, fallbackSubtab) {
    const active = document.querySelector(`#${tabContentId} .subtab-btn.active`)?.dataset.subtab || fallbackSubtab;
    renderSubtabContent(active);
}

function activateSubtab(subtabId) {
    const btn = document.querySelector(`.subtab-btn[data-subtab="${subtabId}"]`);
    if (!btn) return;
    const tabContent = btn.closest('.tab-content');
    if (!tabContent) return;
    tabContent.querySelectorAll('.subtab-btn').forEach((b) => {
        const isActive = b === btn;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    tabContent.querySelectorAll('.subtab-view').forEach((view) => {
        view.classList.toggle('active', view.id === `subview-${subtabId}`);
    });
    renderSubtabContent(subtabId);
}

function setupSubtabs() {
    document.querySelectorAll('.subtab-btn').forEach((btn) => {
        btn.addEventListener('click', () => activateSubtab(btn.dataset.subtab));
    });
}

export { renderWeeklyGrid, renderOfertasList, renderMonthlyCalendar, renderTeacherCalendar };
export { showToastWarning };
