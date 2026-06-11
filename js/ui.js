import { store } from './store.js';
import { getTurnoLetter, mapSlotToTurno } from './turns.js';
import { normalizePeriodo as normalizePeriodoLetivoCode } from './plan_storage.js';
import { getCalendarEvents } from './calendar.js';
import { countBusinessDays, countWeekdaysInPeriod, addBusinessDays, isDateOverlap, calculateEndDateByWeekday } from './utils.js';
import { buildTeacherExecutionSnapshot, buildCanonicalOfferProjection } from './execution_engine.js';
import { renderBidimensionalTeacherGantt } from './gantt_bidimensional.js';
import { buildSigaaMetadataPayload, validateSigaaMetadataPayload } from './sigaa_metadata.js';
import { parseBackupDataFile, extractImportPlanMeta } from './serialization.js';
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

const inputConfig = {
    disciplina: document.getElementById('inp-disciplina'),
    cor: document.getElementById('inp-color'),
    docente: document.getElementById('inp-docente'),
    fim: document.getElementById('inp-data-fim')
};

let tempImportData = null;
let tempImportPlanMeta = null;
let activeFaixaIndex = 1;
let faixasPatterns = {
    1: [],
    2: [],
    3: []
};
let editingDisciplinaDraft = '';
let lastDisciplinaInputNormalized = '';
let componentStartSelectionMode = 'auto';
window.isDrawingFaixa = null;
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

const weeklyViewState = {
    weekStartISO: '',
    followActiveFaixa: true
};

function getAllocationModo(alloc) {
    return String(alloc?.modo || '').trim().toLowerCase();
}

function isFaixaAllocation(alloc) {
    return getAllocationModo(alloc) === 'faixas';
}

function isPriorityRegularAllocation(alloc) {
    return false; // Deprecated
}

function isRegularAllocation(alloc) {
    return getAllocationModo(alloc) === 'semanal';
}

function isScheduledRegularAllocation(alloc) {
    return isRegularAllocation(alloc);
}

function isPendingAllocation(alloc) {
    return getAllocationModo(alloc) === 'pendente';
}

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

function wrapGanttInput() {
    const inpGanttDocente = document.getElementById('inp-gantt-docente');
    if (inpGanttDocente && !document.getElementById('btn-refresh-gantt')) {
        let inputWrapper = inpGanttDocente.parentNode;

        // Garantir o wrapper do Input + X
        if (!inputWrapper.classList.contains('input-wrapper-gantt')) {
            inputWrapper = document.createElement('div');
            inputWrapper.className = 'input-wrapper-gantt';
            inputWrapper.style.position = 'relative';
            inputWrapper.style.display = 'inline-block';
            inputWrapper.style.width = 'fit-content';

            inpGanttDocente.parentNode.insertBefore(inputWrapper, inpGanttDocente);
            inputWrapper.appendChild(inpGanttDocente);
            inpGanttDocente.style.margin = '0';
        }

        // Renderiza o X dentro do wrapper apertadinho
        addClearXToField(inpGanttDocente, 'inp-gantt-docente');

        // Cria o Flex Container para colocar o Botão Refresh ao lado
        const flexContainer = document.createElement('div');
        flexContainer.style.display = 'inline-flex';
        flexContainer.style.alignItems = 'center';
        flexContainer.style.gap = '8px';

        inputWrapper.parentNode.insertBefore(flexContainer, inputWrapper);
        flexContainer.appendChild(inputWrapper);

        // Move e estiliza o botão "Gerar Gantt" do HTML para bater lado a lado com o Refresh
        const btnGerarGantt = document.getElementById('btn-gerar-gantt');
        if (btnGerarGantt) {
            btnGerarGantt.style.display = 'inline-block';
            btnGerarGantt.style.background = '#27ae60';
            btnGerarGantt.style.color = '#fff';
            btnGerarGantt.style.border = 'none';
            btnGerarGantt.style.borderRadius = '4px';
            btnGerarGantt.style.padding = '6px 12px';
            btnGerarGantt.style.cursor = 'pointer';
            btnGerarGantt.style.fontWeight = 'bold';
            btnGerarGantt.style.fontSize = '0.95em';
            btnGerarGantt.style.transition = 'background 0.2s';
            btnGerarGantt.onmouseover = () => btnGerarGantt.style.background = '#219653';
            btnGerarGantt.onmouseout = () => btnGerarGantt.style.background = '#27ae60';
            flexContainer.appendChild(btnGerarGantt);
        }

        // Botão Refresh do Gantt
        const btnRefreshGantt = document.createElement('button');
        btnRefreshGantt.id = 'btn-refresh-gantt';
        btnRefreshGantt.innerHTML = '🔄';
        btnRefreshGantt.title = 'Atualizar Gráfico de Gantt';
        btnRefreshGantt.style.background = '#3498db';
        btnRefreshGantt.style.color = '#fff';
        btnRefreshGantt.style.border = 'none';
        btnRefreshGantt.style.borderRadius = '4px';
        btnRefreshGantt.style.padding = '6px 10px';
        btnRefreshGantt.style.cursor = 'pointer';
        btnRefreshGantt.style.fontSize = '1.1em';
        btnRefreshGantt.style.transition = 'transform 0.3s ease, background 0.2s';
        btnRefreshGantt.style.flexShrink = '0';

        btnRefreshGantt.onmouseover = () => btnRefreshGantt.style.background = '#2980b9';
        btnRefreshGantt.onmouseout = () => btnRefreshGantt.style.background = '#3498db';

        flexContainer.appendChild(btnRefreshGantt);

        btnRefreshGantt.addEventListener('click', (e) => {
            e.preventDefault();
            if (inpGanttDocente.value.trim()) {
                renderGanttChart();
                btnRefreshGantt.style.transform = `rotate(${btnRefreshGantt.dataset.rot || 360}deg)`;
                btnRefreshGantt.dataset.rot = parseInt(btnRefreshGantt.dataset.rot || 360) + 360;
            } else {
                showToastWarning('Digite o nome de um professor primeiro para atualizar o gráfico.', 'warning', 2200);
            }
        });
    }
}

// ATUALIZAÇÃO: Suporte a tempo customizado de tela para o balão
export function showToastWarning(message, type = 'error', customDuration = null) {
    const fb = document.getElementById('feedback-msg');
    if (!fb) return;

    fb.classList.remove('hidden');
    fb.innerHTML = message;
    fb.style.display = 'block';
    fb.style.backgroundColor = type === 'success' ? '#27ae60' : (type === 'warning' ? '#f39c12' : '#e74c3c');
    fb.style.color = '#fff';
    fb.style.padding = '15px 20px';
    fb.style.borderRadius = '6px';
    fb.style.marginBottom = '15px';
    fb.style.fontWeight = 'bold';
    fb.style.boxShadow = '0 4px 10px rgba(0,0,0,0.3)';
    fb.style.textAlign = 'center';
    fb.style.fontSize = '1.1em';
    fb.style.lineHeight = '1.4';

    const duration = customDuration || (type === 'success' ? 4500 : 7000);
    if (window.toastTimeout) clearTimeout(window.toastTimeout);
    window.toastTimeout = setTimeout(() => {
        fb.style.display = 'none';
        fb.classList.add('hidden');
    }, duration);
}

function showPersistentStatusMessage(message, type = 'success') {
    const fb = document.getElementById('feedback-msg');
    if (!fb) return;

    if (window.toastTimeout) {
        clearTimeout(window.toastTimeout);
        window.toastTimeout = null;
    }

    const backgroundColor = type === 'success'
        ? '#27ae60'
        : (type === 'warning' ? '#f39c12' : '#e74c3c');

    fb.classList.remove('hidden');
    fb.style.display = 'block';
    fb.style.backgroundColor = backgroundColor;
    fb.style.color = '#fff';
    fb.style.padding = '15px 20px';
    fb.style.borderRadius = '6px';
    fb.style.marginBottom = '15px';
    fb.style.fontWeight = 'bold';
    fb.style.boxShadow = '0 4px 10px rgba(0,0,0,0.3)';
    fb.style.textAlign = 'center';
    fb.style.fontSize = '1.05em';
    fb.style.lineHeight = '1.4';
    fb.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:center; gap:12px; flex-wrap:wrap;">
            <span>${message}</span>
            <button id="btn-feedback-persistent-ok" type="button" style="background:#ffffff; color:${backgroundColor}; border:none; border-radius:999px; padding:8px 16px; font-weight:800; cursor:pointer;">OK</button>
        </div>
    `;

    const btnOk = document.getElementById('btn-feedback-persistent-ok');
    if (btnOk) {
        btnOk.onclick = () => {
            fb.style.display = 'none';
            fb.classList.add('hidden');
            fb.innerHTML = '';
        };
    }
}

async function copyTextToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
}

function flashButtonCopyState(btn, label = 'Copiado', duration = 2000) {
    if (!btn) return;

    const origHtml = btn.innerHTML;
    const origBg = btn.style.backgroundColor;
    const origColor = btn.style.color;
    const origBorder = btn.style.borderColor;

    btn.innerHTML = label;
    btn.style.backgroundColor = '#27ae60';
    btn.style.color = '#ffffff';
    btn.style.borderColor = '#27ae60';

    setTimeout(() => {
        btn.innerHTML = origHtml;
        btn.style.backgroundColor = origBg;
        btn.style.color = origColor;
        btn.style.borderColor = origBorder;
    }, duration);
}

function setupCopyActionButtons() {
    document.querySelectorAll('[data-copy-text]').forEach((btn) => {
        if (btn.dataset.bound === '1') return;

        btn.dataset.bound = '1';
        btn.addEventListener('click', async () => {
            const text = btn.dataset.copyText || '';
            const successLabel = btn.dataset.copySuccessLabel || 'Copiado';
            const feedbackId = btn.dataset.copyFeedbackTarget || '';
            const feedback = feedbackId ? document.getElementById(feedbackId) : null;

            try {
                await copyTextToClipboard(text);
                flashButtonCopyState(btn, successLabel);
                if (feedback) {
                    feedback.textContent = `${successLabel}.`;
                    setTimeout(() => {
                        if (feedback.textContent === `${successLabel}.`) feedback.innerHTML = '&nbsp;';
                    }, 2200);
                }
            } catch (err) {
                console.error('Falha ao copiar texto', err);
                if (feedback) feedback.textContent = 'N\u00e3o foi poss\u00edvel copiar. Copie manualmente.';
                showToastWarning('N\u00e3o foi poss\u00edvel copiar o conte\u00fado. Copie manualmente.', 'warning', 2600);
            }
        });
    });
}

function timeToMinutes(str) {
    if (!str) return 99999;
    const match = str.match(/(\d{1,2}):(\d{2})/);
    if (!match) return 99999;
    return parseInt(match[1]) * 60 + parseInt(match[2]);
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

function cleanHorarioLabel(s) {
    const str = (s ?? '').toString();
    const m = str.match(/\b\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}\b/);
    if (m) return m[0];
    return str;
}

function formatIntervaloLabel(s) {
    const str = (s ?? '').toString().trim();
    if (!str) return str;
    if (str.toUpperCase().startsWith('INTERVALO')) {
        return 'Intervalo' + str.slice('INTERVALO'.length);
    }
    if (str.toLowerCase().startsWith('intervalo')) {
        return 'Intervalo' + str.slice('intervalo'.length);
    }
    return str;
}

function buildHorariosForUI() {
    const horariosRaw = store.getHorariosTurma() || [];
    return horariosRaw
        .map((h) => {
            const s = String(h ?? '');
            if (s.toUpperCase().includes('INTERVALO')) return formatIntervaloLabel(s);
            return cleanHorarioLabel(s);
        })
        .filter((s) => s && s.trim().length > 0);
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

        const intervaloH = Math.max(isCompactScreen ? 20 : 22, Math.round(uniformH * 0.6));

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
function shortDayName(dayNumber) {
    const map = { 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sab' };
    return map[dayNumber] || String(dayNumber);
}

function formatSlotLabel(slot) {
    const text = String(slot || '').trim();
    if (!text) return '';
    if (text.includes('-')) {
        return text.replace(/\s*-\s*/g, ' - ');
    }
    const match = text.match(/^(\d{1,2}):(\d{2})$/);
    if (match) {
        return `${match[1]}h:${match[2]}`;
    }
    return text;
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
                : `Clique para definir o inicio da Faixa ${i} pela grade semanal.`;
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

    const faixaIndex = parseInt(window.isDrawingFaixa, 10);
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
function resolveFaixaTurno(faixaIndex) {
    const { slots } = getFaixaSlotsAndDays(faixaIndex);
    if (slots.length === 0) return '-';
    let hasM = false;
    let hasT = false;
    slots.forEach((s) => {
        const mins = timeToMinutes(s);
        if (mins < 780) hasM = true;
        else hasT = true;
    });
    if (hasM && hasT) return 'M/T';
    if (hasM) return 'M';
    if (hasT) return 'T';
    return '-';
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

function normalizeHexColor(color, fallback = '#f39c12') {
    const src = String(color || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(src)) return src.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(src)) {
        return `#${src[1]}${src[1]}${src[2]}${src[2]}${src[3]}${src[3]}`.toLowerCase();
    }
    return fallback;
}

function hexToRgb(hexColor) {
    const hex = normalizeHexColor(hexColor);
    return {
        r: parseInt(hex.slice(1, 3), 16),
        g: parseInt(hex.slice(3, 5), 16),
        b: parseInt(hex.slice(5, 7), 16)
    };
}

function adjustHexColor(hexColor, delta) {
    const { r, g, b } = hexToRgb(hexColor);
    const clamp = (v) => Math.max(0, Math.min(255, v));
    const toHex = (v) => clamp(v).toString(16).padStart(2, '0');
    return `#${toHex(r + delta)}${toHex(g + delta)}${toHex(b + delta)}`;
}

function hexToRgba(hexColor, alpha = 1) {
    const { r, g, b } = hexToRgb(hexColor);
    const a = Math.max(0, Math.min(1, alpha));
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function getDrawingBaseColor() {
    const disciplina = (inputConfig.disciplina?.value ?? '').replace(/\s*\(\s*\d+\s*h\s*\)\s*$/i, '').trim();
    const fallbackColor = normalizeHexColor(disciplina ? store.getDisciplinaColor(disciplina) : '#f39c12');
    return normalizeHexColor(inputConfig.cor?.value, fallbackColor);
}

function getWeeklyFaixasTitleDisciplinaAtiva() {
    const selected = normalizeDisciplinaInputValue(inputConfig.disciplina?.value || '');
    if (selected) return selected;

    const editing = normalizeDisciplinaInputValue(editingDisciplinaDraft || '');
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
    const base = getDrawingBaseColor();
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
        cell.style.background = styles.background;
        cell.style.border = styles.border;
        cell.style.color = styles.color;
        cell.style.fontWeight = styles.fontWeight;
    } else {
        cell.classList.remove('selected-slot');
        if (cell.dataset.canEdit === '1') cell.classList.add('slot-free-draw');
        cell.style.background = '';
        cell.style.border = '';
        cell.style.color = '';
        cell.style.fontWeight = '';
    }
}

function endDrawingDrag() {
    const shouldPersist = !!window.isDrawingFaixa && drawingDragState.active && drawingDragState.touchedAnyCell;
    drawingDragState.active = false;
    drawingDragState.shouldSelect = true;
    drawingDragState.touchedAnyCell = false;
    if (document.body) document.body.style.userSelect = '';
    if (shouldPersist) persistActiveDrawingSelection();
}

function getDrawingSelectionFromDOM() {
    if (!window.isDrawingFaixa) return [];
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

    if (window.isDrawingFaixa) {
        const faixaIndex = parseInt(window.isDrawingFaixa, 10);
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
    if (!window.isDrawingFaixa) return 0;
    const faixaIndex = parseInt(window.isDrawingFaixa, 10);
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
    if (!window.isDrawingFaixa) return 0;
    const faixaIndex = window.isDrawingFaixa;
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

    const prevFaixa = parseInt(window.isDrawingFaixa, 10);
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
    window.isDrawingFaixa = faixaIndex;

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
    if (!silent) showToastWarning(`Edicao ativa para a Faixa ${faixaIndex}.`, 'success', 1800);
}

function deactivateDrawingMode() {
    endDrawingDrag();
    if (pendingFaixaStartPick) clearPendingFaixaStartPick();
    window.isDrawingFaixa = null;
    weeklyViewState.followActiveFaixa = false;
    updateWeeklySavePatternButton();
    const toolbar = document.getElementById('drawing-toolbar');
    if (toolbar) toolbar.classList.add('hidden');
    const reeditBadge = document.getElementById('reedit-badge');
    if (reeditBadge) reeditBadge.classList.add('hidden');
    renderWeeklyGrid();
}

function shiftISODate(dateStr, days) {
    if (!dateStr) return '';
    const d = new Date(`${dateStr}T12:00:00`);
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
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
    if (window.isDrawingFaixa) window.isDrawingFaixa = 1;

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
        window.isDrawingFaixa = null;
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
        if (window.isDrawingFaixa && parseInt(window.isDrawingFaixa, 10) > 1) window.isDrawingFaixa = 1;
    } else {
        clearFaixaState(3);
        if (window.isDrawingFaixa && parseInt(window.isDrawingFaixa, 10) === 3) window.isDrawingFaixa = 2;
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
    if (!window.isDrawingFaixa) return null;
    const idx = parseInt(window.isDrawingFaixa, 10);
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

function rangeOverlaps(rangeA, rangeB) {
    if (!rangeA?.start || !rangeA?.end || !rangeB?.start || !rangeB?.end) return true;
    return isDateOverlap(rangeA.start, rangeA.end, rangeB.start, rangeB.end);
}

function isValidISODateValue(value) {
    const text = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
    const date = new Date(`${text}T12:00:00`);
    return !Number.isNaN(date.getTime());
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

function getPreferredStartDateForCurrentTurma(options = {}) {
    const { useCurrentUI = false } = options;
    const termStart = String(store.settings.termStart || inpTermStart?.value || calStart?.value || '').trim();
    const termEnd = String(store.settings.termEnd || inpTermEnd?.value || calEnd?.value || termStart).trim();
    const latestAllocationEnd = getLastValidAllocationEndForCurrentTurma();
    // Varre sempre desde o início do semestre para encontrar o primeiro dia com
    // 1º slot OU 4º slot livre — não usa latestAllocationEnd para evitar pular gaps.
    const searchStart = termStart;

    if (useCurrentUI) {
        const lastUiFaixa = getLastValidFaixaFromUI();
        if (lastUiFaixa?.fim) {
            return lastUiFaixa.fim;
        }
    }

    const availableSlots = buildHorariosForUI()
        .map((slot) => normalizeConflictSlotLabel(slot))
        .filter((slot) => slot && !slot.toUpperCase().includes('INTERVALO'));
    const firstSlot = availableSlots[0] || '';
    const fourthSlot = availableSlots.length >= 4
        ? availableSlots[3]
        : (availableSlots[availableSlots.length - 1] || '');
    const targetSlots = [firstSlot, fourthSlot].filter(Boolean);
    const occupiedSlotsByDate = buildFaixaOccupiedSlotsByDateDirect(store.selectedTurma, termStart, termEnd);
    const holidays = (store.rawData?.feriados || []).map((item) => String(item?.data || item || '').trim()).filter(Boolean);
    const turmaUsaSabado = store.allocations.some((a) =>
        String(a?.turmaId) === String(store.selectedTurma) &&
        isFaixaAllocation(a) &&
        getNormalizedIntensiveFaixas(a).some((f) => Array.isArray(f.dias) && f.dias.includes(6))
    );
    const firstGapDate = findFirstDateWithAvailableSlot({
        termStart: searchStart,
        termEnd,
        availableSlots,
        requiredFreeSlots: targetSlots,
        occupiedSlotsByDate,
        holidays,
        requireAll: false,  // 1º slot livre OU 4º slot livre
        skipSaturday: !turmaUsaSabado
    });

    const turmaPreferred = store.selectedTurma ? store.getTurmaLastStart(store.selectedTurma) : '';
    return firstGapDate || initializeWeeklyScheduleForTurma({
        termStart,
        turmaLastStart: turmaPreferred,
        latestAllocationEnd
    }).firstFaixaStart || termStart;
}

// Lê a ocupação de slots diretamente das faixas das alocações, sem passar pelo
// limite de carga horária (CH) do getCalendarEvents. Isso garante que mesmo
// faixas extras (ex: Faixa 2 após CH esgotado na Faixa 1) sejam detectadas.
function buildFaixaOccupiedSlotsByDateDirect(turmaId, startDate, endDate) {
    const occupiedByDate = new Map();
    if (!turmaId || !startDate || !endDate) return occupiedByDate;
    const turmIdStr = String(turmaId);

    store.allocations.forEach((alloc) => {
        if (String(alloc?.turmaId) !== turmIdStr) return;
        if (!isFaixaAllocation(alloc)) return;

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
    const termStart = String(store.settings.termStart || inpTermStart?.value || calStart?.value || '').trim();
    const termEnd = String(store.settings.termEnd || inpTermEnd?.value || calEnd?.value || termStart).trim();
    // Sempre varre desde o início do semestre para encontrar o primeiro dia com
    // a 4ª aula livre — não usa latestAllocationEnd para evitar pular gaps.
    const searchStart = termStart;

    const availableSlots = buildHorariosForUI()
        .map((slot) => normalizeConflictSlotLabel(slot))
        .filter((slot) => slot && !slot.toUpperCase().includes('INTERVALO'));

    // Regra: primeiro dia em que a 1ª aula OU a 4ª aula esteja livre
    const firstSlot = availableSlots[0] || '';
    const fourthSlot = availableSlots.length >= 4
        ? availableSlots[3]
        : (availableSlots[availableSlots.length - 1] || '');

    if (!searchStart || !termEnd || (!firstSlot && !fourthSlot)) return searchStart || termStart;

    // Lê ocupação diretamente das faixas — sem limite de CH do calendário
    const occupiedByDate = buildFaixaOccupiedSlotsByDateDirect(store.selectedTurma, termStart, termEnd);
    const holidays = new Set(
        (store.rawData?.feriados || []).map((item) => String(item?.data || item || '').trim()).filter(Boolean)
    );

    // Verifica se a turma usa sábado (dia 6); caso contrário, sábado é pulado
    // para evitar retornar um sábado "vazio" que não é dia letivo real.
    const turmaUsaSabado = store.allocations.some((a) =>
        String(a?.turmaId) === String(store.selectedTurma) &&
        isFaixaAllocation(a) &&
        getNormalizedIntensiveFaixas(a).some((f) => Array.isArray(f.dias) && f.dias.includes(6))
    );

    let cursor = new Date(searchStart + 'T12:00:00');
    const endDateObj = new Date(termEnd + 'T12:00:00');
    let safety = 0;
    while (cursor <= endDateObj && safety < 500) {
        safety++;
        const dow = cursor.getDay();
        const dateStr = toISODate(cursor);
        cursor.setDate(cursor.getDate() + 1);
        if (dow === 0 || (!turmaUsaSabado && dow === 6) || holidays.has(dateStr)) continue;
        const occupied = occupiedByDate.get(dateStr) || new Set();
        const firstFree = firstSlot && !occupied.has(firstSlot);
        const fourthFree = fourthSlot && !occupied.has(fourthSlot);
        if (firstFree || fourthFree) return dateStr;
    }

    return searchStart || termStart;
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

function normalizeConflictSlotLabel(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/\s*[-–]\s*/g, ' - ');
}

function shouldIgnoreTurmaEventForCandidate(event, candidateAlloc) {
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

function buildTurmaOccupiedSlotsByDate(candidateAlloc, startDate, endDate) {
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

function getAllocationTeachersForConflict(alloc) {
    if (alloc?.docentes && Array.isArray(alloc.docentes) && alloc.docentes.length > 0) {
        return alloc.docentes
            .map((d) => String(d?.nome || d || '').trim())
            .filter((name) => name && name.toUpperCase() !== 'A DEFINIR');
    }

    const single = String(alloc?.docente || '').trim();
    return single && single.toUpperCase() !== 'A DEFINIR' ? [single] : [];
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

function getWeekAutoPositionMode() {
    const enabled = !!store.settings?.weekAutoPositionEnabled;
    if (!enabled) return 'inicio';

    const rawMode = String(store.settings?.weekAutoPositionMode || '').toLowerCase();
    if (rawMode === 'fim' || rawMode === 'intensiva') return 'fim';
    return 'inicio';
}

function getLatestAllocatedComponentForCurrentTurma() {
    if (!store.selectedTurma || !Array.isArray(store.allocations)) return null;

    for (let i = store.allocations.length - 1; i >= 0; i--) {
        const alloc = store.allocations[i];
        if (String(alloc?.turmaId) !== String(store.selectedTurma)) continue;
        if (isPendingAllocation(alloc)) continue;
        return alloc;
    }

    return null;
}

function getWeekAutoPositionAnchorDate() {
    const latestAlloc = getLatestAllocatedComponentForCurrentTurma();
    if (latestAlloc) {
        const mode = getWeekAutoPositionMode();
        if (mode === 'fim') {
            return latestAlloc.dataFim || latestAlloc.dataInicio || '';
        }
        return latestAlloc.dataInicio || latestAlloc.dataFim || '';
    }

    return getPreferredStartDateForCurrentTurma();
}

function applyWeekAutoPositionForComponentChange(options = {}) {
    const { render = false } = options;
    const anchorDate = getWeekAutoPositionAnchorDate();
    if (!anchorDate) return;
    setWeeklyViewByDate(anchorDate, { followFaixa: false, render });
}

function syncWeekAutoPositionControls() {
    const chk = document.getElementById('chk-auto-week-position');
    const modesWrap = document.getElementById('auto-week-position-modes');
    const radioStart = document.getElementById('radio-auto-week-start');
    const radioEnd = document.getElementById('radio-auto-week-end');
    if (!chk || !modesWrap || !radioStart || !radioEnd) return;

    const enabled = !!store.settings?.weekAutoPositionEnabled;
    const mode = getWeekAutoPositionMode();

    chk.checked = enabled;
    radioStart.checked = mode === 'inicio';
    radioEnd.checked = mode === 'fim';
    modesWrap.classList.toggle('hidden', !enabled);
}

function persistWeekAutoPositionSettings(enabled, mode) {
    store.settings.weekAutoPositionEnabled = !!enabled;
    store.settings.weekAutoPositionMode = mode === 'fim' ? 'fim' : 'inicio';
    store.saveSettings();
}

function setupWeekAutoPositionControls() {
    const chk = document.getElementById('chk-auto-week-position');
    const radioStart = document.getElementById('radio-auto-week-start');
    const radioEnd = document.getElementById('radio-auto-week-end');
    if (!chk || !radioStart || !radioEnd) return;
    if (chk.dataset.bound === '1') {
        syncWeekAutoPositionControls();
        return;
    }

    chk.dataset.bound = '1';

    if (typeof store.settings.weekAutoPositionEnabled !== 'boolean') {
        store.settings.weekAutoPositionEnabled = false;
    }
    if (!store.settings.weekAutoPositionMode) {
        store.settings.weekAutoPositionMode = 'inicio';
    }
    syncWeekAutoPositionControls();

    chk.addEventListener('change', () => {
        const selectedMode = radioEnd.checked ? 'fim' : 'inicio';
        persistWeekAutoPositionSettings(chk.checked, selectedMode);
        syncWeekAutoPositionControls();
    });

    [radioStart, radioEnd].forEach((radio) => {
        radio.addEventListener('change', () => {
            if (!radio.checked) return;
            persistWeekAutoPositionSettings(chk.checked, radio.value);
            syncWeekAutoPositionControls();
        });
    });
}

function formatCompactFaixaDate(value) {
    const raw = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return 'dd/mm/aaaa';
    return `${raw.slice(8, 10)}/${raw.slice(5, 7)}/${raw.slice(0, 4)}`;
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

function resolveInlineEditableFaixaIndex() {
    const disciplina = normalizeDisciplinaInputValue(inputConfig.disciplina?.value || '');
    if (!store.selectedTurma || !disciplina) return null;

    const hasStart = (idx) => !!document.getElementById(`inp-data-inicio-f${idx}`)?.value;

    const current = parseInt(window.isDrawingFaixa || activeFaixaIndex, 10);
    if (!Number.isNaN(current) && current >= 1 && current <= 3 && hasStart(current)) return current;

    if (hasStart(1)) return 1;
    if (hasStart(2)) return 2;
    if (hasStart(3)) return 3;
    return null;
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
                        if (window.isDrawingFaixa && parseInt(window.isDrawingFaixa, 10) > 1) window.isDrawingFaixa = 1;
                    }
                    if (i === 3 && !iniEl.value) {
                        clearFaixaState(3);
                        if (window.isDrawingFaixa && parseInt(window.isDrawingFaixa, 10) === 3) window.isDrawingFaixa = 2;
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
            if (window.isDrawingFaixa) renderWeeklyGrid();
        });
    }

    const btnSaveDraw = document.getElementById('btn-save-draw');
    if (btnSaveDraw) {
        btnSaveDraw.textContent = 'Salvar (Opcional)';
        btnSaveDraw.title = 'As selecoes sao aplicadas automaticamente ao clicar/arrastar.';
        btnSaveDraw.addEventListener('click', () => {
            if (!window.isDrawingFaixa) return;
            persistActiveDrawingSelection();
            deactivateDrawingMode();
        });
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

    faixasPatterns = { 1: [], 2: [], 3: [] };

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

function toISODate(dateObj) {
    return dateObj.toISOString().split('T')[0];
}

function addDaysISO(dateStr, days) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + days);
    return toISODate(d);
}

function getWeekStartISO(dateStr) {
    if (!dateStr) return '';
    const d = new Date(`${dateStr}T12:00:00`);
    if (Number.isNaN(d.getTime())) return '';
    const dow = d.getDay();
    const delta = dow === 0 ? -6 : (1 - dow);
    d.setDate(d.getDate() + delta);
    return toISODate(d);
}

function formatDayMonthShort(dateStr) {
    if (!dateStr) return '';
    const d = new Date(`${dateStr}T12:00:00`);
    if (Number.isNaN(d.getTime())) return '';
    const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const dd = String(d.getDate()).padStart(2, '0');
    return `${dd}/${meses[d.getMonth()]}`;
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
    const currentIdx = parseInt(window.isDrawingFaixa || activeFaixaIndex || 0, 10);
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

    if (window.isDrawingFaixa) {
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
    const activeStart = getActiveFaixaStartDate(window.isDrawingFaixa || activeFaixaIndex);
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
        setWeeklyViewByDate(getDefaultWeeklyAnchorDate(), { followFaixa: !!window.isDrawingFaixa, render: false });
    }
    return weeklyViewState.weekStartISO;
}

function moveWeeklyViewWeek(weekDelta = 0) {
    if (window.isDrawingFaixa) persistActiveDrawingSelection();
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

    if (window.isDrawingFaixa) {
        const idx = parseInt(window.isDrawingFaixa, 10);
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

function updateWeeklyContextNote() {
    const noteEl = document.getElementById('weekly-week-context-note');
    if (!noteEl) return;

    const weekStart = resolveWeeklyViewWeekStart();
    if (!weekStart) {
        noteEl.textContent = '';
        noteEl.style.display = 'none';
        noteEl.classList.remove('is-pending');
        return;
    }

    noteEl.style.display = 'block';

    if (pendingFaixaStartPick) {
        noteEl.classList.add('is-pending');
        const previousFaixa = pendingFaixaStartPick - 1;
        noteEl.textContent = `Clique em um slot da grade para definir o inicio da Faixa ${pendingFaixaStartPick}. Ela passara a substituir a Faixa ${previousFaixa} a partir desta data.`;
        return;
    }

    noteEl.classList.remove('is-pending');

    const idx = parseInt(window.isDrawingFaixa || activeFaixaIndex, 10);
    if (Number.isNaN(idx) || idx < 1 || idx > 3) {
        noteEl.textContent = '';
        noteEl.style.display = 'none';
        return;
    }
    const ini = document.getElementById(`inp-data-inicio-f${idx}`)?.value || '';

    if (!ini) {
        noteEl.textContent = idx === 1
            ? 'Faixa = regime de funcionamento em um intervalo de datas. Defina o início da Faixa 1 pelo calendário ao lado para alinhar a alocação com a semana real.'
            : `Defina o inicio da Faixa ${idx} para criar o novo regime que substituira a Faixa ${idx - 1}.`;
        return;
    }

    if (idx === 1) {
        noteEl.textContent = `Faixa 1 define o regime inicial da componente a partir de ${formatDateBR(ini)}.`;
        return;
    }

    const previousEnd = document.getElementById(`inp-data-fim-f${idx - 1}`)?.value || shiftISODate(ini, -1);
    noteEl.textContent = `Faixa ${idx} substitui a Faixa ${idx - 1} a partir de ${formatDateBR(ini)}. O fim da Faixa ${idx - 1} fica automaticamente em ${formatDateBR(previousEnd)}. Desenhe explicitamente o novo padrao desta faixa na grade.`;
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
            if (!window.isDrawingFaixa) {
                showToastWarning('Defina uma faixa ativa para salvar o padrao.', 'warning', 2200);
                return;
            }
            const qtd = persistActiveDrawingSelection();
            if (qtd <= 0) {
                showToastWarning('Marque ao menos um slot para salvar o padrao.', 'warning', 2200);
                updateWeeklySavePatternButton();
                return;
            }
            const idx = parseInt(window.isDrawingFaixa, 10);
            showToastWarning(`Padrao da Faixa ${idx} salvo (${qtd} slots).`, 'success', 1800);
            updateWeeklySavePatternButton();
        });
    }

    updateWeeklyNavigatorLabel();
    updateWeeklySavePatternButton();
    updateWeeklyFaixaNavButtons();
}

function isDateInsideRange(dateStr, start, end) {
    if (!dateStr) return false;
    const s = start || dateStr;
    const e = end || s;
    return dateStr >= s && dateStr <= e;
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
function normalizeDrawnSlotsByDay(raw) {
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

function normalizeFaixaEntry(faixa) {
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

function getNormalizedIntensiveFaixas(intense) {
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

function getActiveFaixaForDate(faixas, dStr) {
    if (!Array.isArray(faixas) || faixas.length === 0) return null;
    for (let i = faixas.length - 1; i >= 0; i--) {
        const f = faixas[i];
        if (dStr < f.inicio) continue;
        if (f.fim && dStr > f.fim) continue;
        return f;
    }
    return null;
}

function getIntensiveSlotsForDate(intense, dStr, opts = {}) {
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

function computeIntensiveExecution(intense, options = {}) {
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
                daySlots = [...new Set(daySlots.map(s => mapSlotToTurno(s, turmaTurno, 'Manha', store.rawData?.horarios_por_turno)))];
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

function buildFaixaHoursSummaryFromExecution(faixas = [], executionByDate = {}) {
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

function getExecutionUsedDates(execution = {}) {
    return Object.keys(execution?.byDate || {})
        .filter((dateStr) => /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || '').trim()))
        .sort();
}

function getExecutionSlotsForDate(execution = {}, dateStr = '') {
    return Array.isArray(execution?.byDate?.[dateStr]) ? execution.byDate[dateStr].slice() : [];
}

function buildSortedSlotSignature(slots = []) {
    return (Array.isArray(slots) ? slots : [])
        .filter(Boolean)
        .map(String)
        .sort((a, b) => timeToMinutes(a) - timeToMinutes(b))
        .join('|');
}

function getFaixaSlotsForDay(faixa, dow) {
    const day = parseInt(dow, 10);
    if (Number.isNaN(day) || day < 1 || day > 6) return [];

    const rawSlots = Array.isArray(faixa?.drawnSlotsByDay?.[day])
        ? faixa.drawnSlotsByDay[day]
        : [];

    return [...new Set(rawSlots.filter(Boolean).map(String))]
        .sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
}

function buildStoredExecutionSnapshot(intense) {
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

function buildGanttFaixaDaySnapshots(alloc, rangeStart, rangeEnd) {
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

function buildGanttFaixaTurnoSnapshots(faixaAlloc, rangeStart, rangeEnd, turnoConfigs = getGanttTurnoConfigs()) {
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
function buildComparableFaixasSignature(faixas = []) {
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

function resolveEditableFaixasFromStoredExecution(intense) {
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

function alignFaixasToExecutionEnd(faixasInput, executionEnd) {
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

function buildFinalAdjustmentFaixaSuggestion(faixasConfig = [], execution = {}) {
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

function hasSlotsIntersection(slotsA, slotsB) {
    if (!Array.isArray(slotsA) || !Array.isArray(slotsB) || slotsA.length === 0 || slotsB.length === 0) return false;
    const setB = new Set(slotsB);
    return slotsA.some((s) => setB.has(s));
}

function hasIntensiveConflictByDay(candidate, existing, candidateRange = {}, existingRange = {}) {
    const faixasA = buildIntensiveConflictFaixas(candidate, candidateRange.start, candidateRange.end);
    const faixasB = buildIntensiveConflictFaixas(existing, existingRange.start, existingRange.end);
    if (faixasA.length === 0 || faixasB.length === 0) return false;

    for (const faixaA of faixasA) {
        for (const faixaB of faixasB) {
            if (!isDateOverlap(faixaA.inicio, faixaA.fim, faixaB.inicio, faixaB.fim)) continue;

            const daysA = Object.keys(faixaA.byDay).map((d) => parseInt(d, 10)).filter((d) => d >= 1 && d <= 6);
            for (const day of daysA) {
                const slotsA = faixaA.byDay[day] || [];
                const slotsB = faixaB.byDay[day] || [];
                if (hasSlotsIntersection(slotsA, slotsB)) return true;
            }
        }
    }
    return false;
}


function getDisciplinaCHGlobal(disciplina, turmaId) {
    let sigla = '';
    if (store.rawData?.turmas) {
        const t = store.rawData.turmas.find(x => String(x.turma_id) === String(turmaId));
        if (t) sigla = t.sigla;
    }
    if (store.rawData?.componentes) {
        const comp = store.rawData.componentes.find(c => c.componente === disciplina && c.sigla === sigla) ||
            store.rawData.componentes.find(c => c.componente === disciplina);
        if (comp) return parseInt(comp.ch) || 0;
    }
    return 0;
}

/**
 * Deriva o bloco curricular automaticamente a partir do turmaId e do período letivo.
 * @param {string} turmaId - Ex: 'EP2026', 'CB2024'
 * @param {string} periodo - 'PL1', 'PL2', 'PL3' ou 'PL4'
 * @param {string} termStart - Data de início do semestre (YYYY-MM-DD), usada para obter o ano de referência
 * @returns {string} - Ex: 'BL1', 'BL5', ou '' para PL1/PL3
 */
function derivarBloco(turmaId, periodo, termStart) {
    const p = normalizePeriodoLetivoCode(periodo);
    if (p !== 'PL2' && p !== 'PL4') return '';

    const anoEntrada = parseInt(String(turmaId).slice(-4));
    const anoRef = parseInt((termStart || String(new Date().getFullYear())).slice(0, 4));
    if (Number.isNaN(anoEntrada) || Number.isNaN(anoRef)) return '';

    const anosDecorridos = anoRef - anoEntrada;
    if (anosDecorridos < 0) return '';

    const numBloco = p === 'PL2'
        ? 2 * anosDecorridos + 1
        : 2 * anosDecorridos + 2;

    return `BL${numBloco}`;
}


function getTurmaSelectLabel(turmaId) {
    let base = turmaId;
    if (store.rawData?.turmas) {
        const t = store.rawData.turmas.find(x => String(x.turma_id) === String(turmaId));
        if (t) base = t.turma_label;
    }

    const periodo = normalizePeriodoLetivoCode(store.settings?.periodo || 'PL1');
    const bloco = derivarBloco(turmaId, store.settings?.periodo, store.settings?.termStart);
    const blocoNum = String(bloco || '').match(/^BL(\d+)$/i)?.[1];
    return blocoNum ? (base + '-' + periodo + '-BL.' + blocoNum) : (base + '-' + periodo);
}

function getTurmaLabel(turmaId, subGrupo) {
    let base = turmaId;
    if (store.rawData?.turmas) {
        const t = store.rawData.turmas.find(x => String(x.turma_id) === String(turmaId));
        if (t) base = t.turma_label;
    }
    // Sub-grupo explícito tem prioridade (ex: BL1_T01 digitado pelo usuário)
    const sg = subGrupo && String(subGrupo).trim()
        ? String(subGrupo).trim()
        : derivarBloco(turmaId, store.settings?.periodo, store.settings?.termStart);

    return sg ? `${base}_${sg}` : base;
}

function getTurmaBaseLabel(turmaId) {
    if (!turmaId) return '-';
    let base = turmaId;
    if (store.rawData?.turmas) {
        const t = store.rawData.turmas.find(x => String(x.turma_id) === String(turmaId));
        if (t) base = t.turma_label;
    }
    return base;
}

function getPeriodoExtenso(periodo) {
    return normalizePeriodoLetivoCode(periodo) || '-';
}

function getBlocoPpcExtenso(turmaId) {
    const bloco = derivarBloco(turmaId, store.settings?.periodo, store.settings?.termStart);
    const n = String(bloco || '').match(/^BL(\d+)$/i)?.[1];
    return n ? n : '-';
}

function getPrintAcademicMetaLine(turmaId) {
    const turma = getTurmaBaseLabel(turmaId);
    const periodo = getPeriodoExtenso(store.settings?.periodo);
    const bloco = getBlocoPpcExtenso(turmaId);
    return 'Turma: ' + turma + '; Per\u00edodo: ' + periodo + '; Bloco PPC: ' + bloco;
}

function normalizeTeacherNameForMatch(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function teacherNamesMatch(candidate, selected) {
    const cand = normalizeTeacherNameForMatch(candidate);
    const target = normalizeTeacherNameForMatch(selected);
    if (!cand || !target) return false;
    if (cand === target) return true;

    const shorter = cand.length <= target.length ? cand : target;
    const longer = cand.length <= target.length ? target : cand;

    // Permite alias nominais (ex.: "Neide Ramos" vs "Maria Neide Ramos"),
    // evitando matches muito curtos e ambiguos.
    if (shorter.length >= 6 && shorter.split(' ').length >= 2 && longer.includes(shorter)) {
        return true;
    }
    return false;
}

function allocationHasTeacherMatch(alloc, teacherName) {
    if (!alloc || !teacherName) return false;
    if (teacherNamesMatch(alloc.docente, teacherName)) return true;
    if (alloc.docente && typeof alloc.docente === 'object' && teacherNamesMatch(alloc.docente.nome, teacherName)) return true;
    if (Array.isArray(alloc.docentes)) {
        return alloc.docentes.some((d) => teacherNamesMatch(d?.nome || d, teacherName));
    }
    return false;
}

function calculateTeacherTotalCH(teacherName) {
    if (!teacherName) return 0;

    let totalCH = 0;
    const handledGroups = new Set();

    store.allocations.forEach(a => {
        const groupKey = `${a.turmaId}|${a.disciplina}`;
        if (!handledGroups.has(groupKey)) {
            let teacherCH = 0;
            if (a.docentes && a.docentes.length > 0) {
                const tInfo = a.docentes.find(d => teacherNamesMatch(d?.nome, teacherName));
                if (tInfo) {
                    teacherCH = parseInt(tInfo.ch) || 0;
                }
            } else if (teacherNamesMatch(a.docente, teacherName)) {
                teacherCH = getDisciplinaCHGlobal(a.disciplina, a.turmaId);
            }

            if (teacherCH > 0) {
                totalCH += teacherCH;
                handledGroups.add(groupKey);
            }
        }
    });

    return totalCH;
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
        const hp = store.rawData?.horarios_por_turno || {};
        const dynamicSlots = [];

        Object.keys(hp).forEach((turnoValue) => {
            const shiftCode = getGanttTurnoCode(turnoValue);
            if (!['M', 'T', 'N'].includes(shiftCode)) return;

            let slotIndex = 0;
            (Array.isArray(hp[turnoValue]) ? hp[turnoValue] : []).forEach((rawSlot) => {
                const rawLabel = String(rawSlot || '');
                if (!rawLabel || rawLabel.toUpperCase().includes('INTERVALO')) return;
                const startMinutes = timeToMinutes(cleanHorarioLabel(rawLabel));
                if (!Number.isFinite(startMinutes) || startMinutes >= 99999) return;
                slotIndex += 1;
                dynamicSlots.push({ m: startMinutes, s: shiftCode, sl: slotIndex });
            });
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

function normalizeTurnoOfertaKey(value) {
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

function formatTurnoOfertaLabel(value) {
    const normalized = normalizeTurnoOfertaKey(value);
    if (normalized === 'manha') return 'Manhã';
    if (normalized === 'tarde') return 'Tarde';
    if (normalized === 'noite') return 'Noite';
    return String(value || '').trim() || 'Turno';
}

function getAvailableTurnoOfertaOptions() {
    const byTurnoMap = store.rawData?.horarios_por_turno;
    if (byTurnoMap && typeof byTurnoMap === 'object') {
        const options = Object.keys(byTurnoMap)
            .filter((key) => Array.isArray(byTurnoMap[key]) && byTurnoMap[key].length > 0)
            .map((value) => ({
                value,
                label: formatTurnoOfertaLabel(value),
                normalized: normalizeTurnoOfertaKey(value)
            }));

        if (options.length > 0) {
            const deduped = [];
            const seen = new Set();
            options.forEach((option) => {
                if (seen.has(option.normalized)) return;
                seen.add(option.normalized);
                deduped.push(option);
            });
            const order = { manha: 1, tarde: 2, noite: 3 };
            return deduped.sort((a, b) => {
                const orderA = order[a.normalized] || 99;
                const orderB = order[b.normalized] || 99;
                if (orderA !== orderB) return orderA - orderB;
                return a.label.localeCompare(b.label, 'pt-BR');
            });
        }
    }

    return ['Manhã', 'Tarde', 'Noite'].map((value) => ({
        value,
        label: value,
        normalized: normalizeTurnoOfertaKey(value)
    }));
}

function resolveTurnoOfertaValue(preferredValue = '') {
    const options = getAvailableTurnoOfertaOptions();
    const normalizedPreferred = normalizeTurnoOfertaKey(preferredValue);
    const matched = options.find((option) => option.normalized === normalizedPreferred);
    return matched?.value || preferredValue || options[0]?.value || '';
}

function getTurnoNormalizedFromLetter(letter = '') {
    if (letter === 'M') return 'manha';
    if (letter === 'T') return 'tarde';
    if (letter === 'N') return 'noite';
    return '';
}

function getTurnoValueFromLetter(letter = '') {
    if (letter === 'M') return resolveTurnoOfertaValue('Manha');
    if (letter === 'T') return resolveTurnoOfertaValue('Tarde');
    if (letter === 'N') return resolveTurnoOfertaValue('Noite');
    return '';
}

function getShiftChangeLabel(letter = '') {
    if (letter === 'M') return 'Manhã';
    if (letter === 'T') return 'Tarde';
    if (letter === 'N') return 'Noite';
    return '';
}

function getNativeTurnoValueForAllocation(allocLike = {}) {
    return store.rawData?.turmas?.find((turma) => String(turma?.turma_id) === String(allocLike?.turmaId))?.turno
        || allocLike?.turno
        || 'Tarde';
}

function getShiftChangeMeta(allocLike = {}, slotLabel = '', dayOfWeek = 0, dateStr = '') {
    const nativeTurnoValue = getNativeTurnoValueForAllocation(allocLike);
    const nativeTurnoNorm = normalizeTurnoOfertaKey(nativeTurnoValue);
    const currentLetter = getTurnoLetter(slotLabel);
    const currentTurnoNorm = getTurnoNormalizedFromLetter(currentLetter);
    const isShiftChange = !!(
        nativeTurnoNorm
        && currentTurnoNorm
        && nativeTurnoNorm !== currentTurnoNorm
    );
    let mappedSlot = slotLabel;
    if (isShiftChange && slotLabel) {
        const normalizedSlotKey = normalizeConflictSlotLabel(slotLabel);
        const actualDateSlots = dateStr
            && allocLike?.executionByDate
            && Array.isArray(allocLike.executionByDate[dateStr])
            ? allocLike.executionByDate[dateStr]
            : [];
        const baseSlots = Array.isArray(allocLike?.horariosBase) && allocLike.horariosBase.length > 0
            ? allocLike.horariosBase
            : [];

        if (baseSlots.length > 0 && actualDateSlots.length > 0) {
            const slotIndex = actualDateSlots.findIndex((entry) => normalizeConflictSlotLabel(entry) === normalizedSlotKey);
            if (slotIndex >= 0) {
                mappedSlot = cleanHorarioLabel(baseSlots[slotIndex] || baseSlots[baseSlots.length - 1] || slotLabel);
            }
        }

        if (mappedSlot === slotLabel) {
            mappedSlot = mapSlotToTurno(
                slotLabel,
                getTurnoValueFromLetter(currentLetter),
                nativeTurnoValue,
                store.rawData?.horarios_por_turno
            );
        }
    }
    const badgeLabel = isShiftChange ? getShiftChangeLabel(currentLetter) : '';
    const badgeHTML = badgeLabel
        ? `<span style="display:inline-block; font-size:0.65em; background:#e67e22; color:#fff; padding:1px 4px; border-radius:3px; margin-left:2px; font-weight:bold;" title="Mudou de turno: aula no turno ${badgeLabel}">&#9888; ${badgeLabel}</span>`
        : '';

    return {
        nativeTurnoValue,
        nativeTurnoNorm,
        currentLetter,
        currentTurnoNorm,
        isShiftChange,
        mappedSlot,
        badgeLabel,
        badgeHTML
    };
}


function getCalendarShiftBadgeHTML(allocLike = {}, slotLabel = '', dayOfWeek = 0, dateStr = '') {
    const effectiveSlot = String(
        slotLabel
        || allocLike?.horario
        || (Array.isArray(allocLike?.horariosOcupados) ? allocLike.horariosOcupados[0] : '')
        || ''
    ).trim();

    const shiftMeta = getShiftChangeMeta(allocLike, effectiveSlot, dayOfWeek, dateStr);
    if (shiftMeta.badgeHTML) return shiftMeta.badgeHTML;

    if (!(allocLike?.sabadoManha && dayOfWeek === 6)) return '';

    const fallbackLetter = getTurnoLetter(effectiveSlot);
    const fallbackLabel = getShiftChangeLabel(fallbackLetter);
    if (!fallbackLabel) return '';

    return `<span style="display:inline-block; font-size:0.65em; background:#e67e22; color:#fff; padding:1px 4px; border-radius:3px; margin-left:2px; font-weight:bold;" title="Mudou de turno: aula no turno ${fallbackLabel}">&#9888; ${fallbackLabel}</span>`;
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

function formatDateBRShortYear(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return '';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const [yyyy, mm, dd] = parts;
    return `${dd}/${mm}/${yyyy.slice(-2)}`;
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

function syncPlanInputsFromStore(preferredMeta = null) {
    const selPeriodo = document.getElementById('sel-periodo-letivo');
    if (inpTermStart) inpTermStart.value = store.settings.termStart || '';
    if (inpTermEnd) inpTermEnd.value = store.settings.termEnd || '';
    if (calStart) calStart.value = store.settings.termStart || '';
    if (calEnd) calEnd.value = store.settings.termEnd || '';
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
    editingDisciplinaDraft = '';
    lastDisciplinaInputNormalized = '';
    pendingFaixaStartPick = null;
    pendingFaixaQuickActionConfirm = null;
    faixasPatterns = { 1: [], 2: [], 3: [] };
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
        renderMonthlyCalendar();
    } else if (activeTab === 'teacher' && selViewDocente?.value) {
        renderTeacherCalendar();
    } else if (activeTab === 'gantt') {
        const inpGanttDocente = document.getElementById('inp-gantt-docente');
        if (inpGanttDocente?.value?.trim()) renderGanttChart();
    }
}

function applyPlanContextToUI(planMeta = {}, options = {}) {
    const previousKey = store.getActivePlanMeta().key;
    const result = store.applyPlanContext(planMeta);
    const didChangePlan = result.meta.key !== previousKey;
    const planStart = result.meta.termStart || store.settings.termStart || '';

    if (didChangePlan) setComponentStartSelectionMode('auto');

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
    setupWeeklyWeekNavigator();
    setWeeklyViewByDate(store.settings.termStart || calStart?.value || '', { followFaixa: false, render: false });
    if (selCurso) selCurso.addEventListener('change', onCursoChange);
    if (selTurma) selTurma.addEventListener('change', onTurmaChange);

    initPeriodoLetivoETurno();
    setupCopyActionButtons();

    // ORDEM IMPORTANTE: Primeiro conserta o layout e encapsula os selects
    applySidebarLayoutFixes();
    wrapTeacherSelect();
    wrapGanttInput();

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
            const isEditingSameDisc = editingDisciplinaDraft && discNome === editingDisciplinaDraft;
            const isNewDiscSelection = !!discNome && discNome !== lastDisciplinaInputNormalized && !isEditingSameDisc;
            if (isNewDiscSelection) {
                setComponentStartSelectionMode('auto');
                collapseFaixasForNewComponent({ useCurrentUI: false });
                editingDisciplinaDraft = '';
            }
            lastDisciplinaInputNormalized = discNome;
            updateWeeklyFaixasTitleDisciplina();
            updateWeeklyFaixaHoursDisplay();
            if (store.selectedTurma) renderWeeklyGrid();
        });

        // Detecção de duplicata: mostra o campo sub-grupo quando a mesma disciplina já existe na turma
        inputConfig.disciplina.addEventListener('change', () => {
            const discNome = normalizeDisciplinaInputValue(inputConfig.disciplina.value || '');
            const isEditingSameDisc = editingDisciplinaDraft && discNome === editingDisciplinaDraft;
            const isNewDiscSelection = !!discNome && discNome !== lastDisciplinaInputNormalized && !isEditingSameDisc;
            let pendingPreferredStart = '';
            if (isNewDiscSelection) {
                setComponentStartSelectionMode('auto');
                pendingPreferredStart = getPreferredStartDateForCurrentTurma();
                collapseFaixasForNewComponent({ preferredStart: pendingPreferredStart, useCurrentUI: false });
                editingDisciplinaDraft = '';
            }
            lastDisciplinaInputNormalized = discNome;
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
            if (!window.isDrawingFaixa) return;
            applyDrawingToolbarTheme();
            renderWeeklyGrid();
        };
        inputConfig.cor.addEventListener('input', repaintDrawing);
        inputConfig.cor.addEventListener('change', repaintDrawing);
    }

    const btnAdd = document.getElementById('btn-add-oferta');
    if (btnAdd) btnAdd.addEventListener('click', handleAddManual);

    document.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    const btnGerarCal = document.getElementById('btn-gerar-cal');
    if (btnGerarCal) btnGerarCal.addEventListener('click', renderMonthlyCalendar);

    const btnGantt = document.getElementById('btn-gerar-gantt');
    if (btnGantt) {
        btnGantt.addEventListener('click', renderGanttChart);
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
            } else if (activeTab === 'gantt') {
                const ganttProf = document.getElementById('inp-gantt-docente')?.value || 'Gantt';
                document.title = `Gantt_${ganttProf}_${periodo}_Gestor_IECOS`;
            } else {
                document.title = `${turmaLabel}_${periodo}_Gestor_IECOS_Coordenacoes(v2.0 Dev)`;
            }
            window.print();
            setTimeout(() => { document.title = originalTitle; }, 1000);
        });
    }

    if (selViewDocente) {
        selViewDocente.addEventListener('change', () => {
            renderTeacherCalendar();
            selViewDocente.blur();
        });
        selViewDocente.addEventListener('input', () => {
            if (!selViewDocente.value) {
                document.getElementById('teacher-calendar-container').innerHTML = '';
            }
        });
    }

    // A ligação do Gantt (input -> X e change -> select)
    const inpGanttDocente = document.getElementById('inp-gantt-docente');
    if (selViewDocente && inpGanttDocente) {
        selViewDocente.addEventListener('change', () => {
            inpGanttDocente.value = selViewDocente.value;
            // Dispara 'input' para que o botão X apareça quando o valor é copiado programaticamente
            inpGanttDocente.dispatchEvent(new Event('input', { bubbles: true }));
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
                store.replaceAllocations(tempImportData);
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
                const count = store.mergeAllocations(tempImportData);
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
    editingDisciplinaDraft = '';
    lastDisciplinaInputNormalized = '';
    updateWeeklyFaixasTitleDisciplina();
    updateWeeklyFaixaHoursDisplay();
    collapseFaixasForNewComponent({
        preferredStart: resetState.firstFaixaStart,
        useCurrentUI: false
    });

    faixasPatterns = { 1: [], 2: [], 3: [] };
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


function getDisciplinaInfo(nomeComponente) {
    if (!store.rawData?.componentes) return { abrev: nomeComponente, ch: 0, codigo: '' };
    const c = store.rawData.componentes.find((x) => x.componente === nomeComponente && x.sigla === store.selectedCurso) ||
        store.rawData.componentes.find((x) => x.componente === nomeComponente);
    if (c) return { abrev: c.abreviacao || c.componente, ch: c.ch || 0, codigo: c.codigo || '' };
    return { abrev: nomeComponente, ch: 0, codigo: '' };
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
    let isDrawing = !!window.isDrawingFaixa;
    if (!isDrawing) {
        const inlineFaixaIndex = resolveInlineEditableFaixaIndex();
        if (inlineFaixaIndex) {
            activeFaixaIndex = inlineFaixaIndex;
            window.isDrawingFaixa = inlineFaixaIndex;
            weeklyViewState.followActiveFaixa = true;
            isDrawing = true;
        }
    }

    const drawRange = isDrawing ? getActiveDrawingFaixaRange() : null;
    const drawingDisciplina = normalizeDisciplinaInputValue(inputConfig.disciplina?.value || '');
    const turmaAllocs = store.allocations.filter((a) => String(a.turmaId) === String(store.selectedTurma));
    const pattern = isDrawing ? normalizeFaixaPattern(faixasPatterns[window.isDrawingFaixa]) : [];
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

    if (weeklyViewState.followActiveFaixa && window.isDrawingFaixa) {
        const faixaStart = getActiveFaixaStartDate(window.isDrawingFaixa);
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
                    eventHorario = mapSlotToTurno(e.horario, 'Manha', currentViewTurno, store.rawData?.horarios_por_turno);
                }
                const eventKey = slotKey(eventHorario);

                const listKey = Array.isArray(e.horariosOcupados)
                    ? e.horariosOcupados.some((h) => {
                        let hObj = h;
                        if (e.sabadoManha && dayNumber === 6 && eTurno !== 'Manha' && eTurno !== 'Manhã') {
                            hObj = mapSlotToTurno(h, 'Manha', currentViewTurno, store.rawData?.horarios_por_turno);
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

        const activeFaixa = parseInt(window.isDrawingFaixa || activeFaixaIndex, 10) || 1;
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
        if (isTurnoDivider) hDiv.style.borderTop = '2px dashed #bdc3c7';
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
                const cellDate = weekDates[i - 1] || '';
                cell.dataset.dia = i;
                cell.dataset.horario = horarioStr;
                cell.dataset.date = cellDate;
                if (isTurnoDivider) cell.style.borderTop = '2px dashed #bdc3c7';

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
                                cell.classList.add('slot-week-disabled');
                                cell.title = 'Fora do intervalo da faixa ativa nesta semana. Ajuste inicio/fim ou navegue para outra semana.';
                            }
                        }
                    }
                }

                gridContainer.appendChild(cell);
            }
        }
    });

    applyWeeklyGridRowHeightScale();
    updateWeeklySavePatternButton();
    playWeeklyShiftAnimation();
}

function createCell(classNames, text) {
    const div = document.createElement('div');
    div.className = classNames;
    div.textContent = text;
    return div;
}

function isTurnoDividerSlot(slotLabel = '') {
    const normalized = String(slotLabel || '').trim();
    return normalized.includes('13:30') || normalized.includes('18:30');
}

function renderSlotContent(cell, allocs, dayOfWeek = 0) {
    cell.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'mini-card-container';

    allocs.forEach(alloc => {
        const info = getDisciplinaInfo(alloc.disciplina);
        const card = document.createElement('div');
        const docenteNome = (alloc.docente || '').split(' ')[0] || '';

        card.className = 'mini-card';
        card.style.backgroundColor = alloc.cor;
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

function handleSlotClick() {
    showToastWarning('Clique direto na Grade Semanal para montar o padrao da faixa ativa.', 'success', 2200);
}

function loadAllocationIntoEditor(allocation, idsToRemove = []) {
    const a = allocation;
    if (!a) return;

    const info = getDisciplinaInfo(a.disciplina);
    if (!confirm('Carregar para edicao? A oferta antiga sera removida e a Grade Semanal sera aberta para ajuste desta componente.')) return;

    editingDisciplinaDraft = normalizeDisciplinaInputValue(a.disciplina);
    setComponentStartSelectionMode('auto');
    updateWeeklyFaixasTitleDisciplina();
    let editorFaixasAdjusted = false;

    if (inputConfig.disciplina) {
        inputConfig.disciplina.value = `${a.disciplina} (${info.ch}h)`;
        inputConfig.disciplina.dispatchEvent(new Event('input'));
    }
    if (inputConfig.cor && a.cor) {
        inputConfig.cor.value = a.cor;
        setTimeout(() => { inputConfig.cor.value = a.cor; }, 50);
    }
    enforceCanonicalFaixaMode();

    // isReEdit: true = oferta já tinha faixas salvas (re-edição); false = pendente (1ª vez)
    const isReEdit = isFaixaAllocation(a);

    if (isFaixaAllocation(a)) {
        const hydrated = hydrateFaixasFromComponente(a, { useStoredExecution: true }) || {};
        editorFaixasAdjusted = !!hydrated.wasAdjusted;
    } else {
        const preferredStart = getPreferredPendingStartDateForCurrentTurma();
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
    idsToRemove.forEach((id) => store.removeAllocation(id));
    syncAllRegularDates();

    // Ativa explicitamente o modo de desenho na Faixa 1 (ou na faixa com padrão carregado)
    // para que a grade exiba os slots com o visual de "recém marcado" na cor original.
    const faixaToActivate = normalizeFaixaPattern(faixasPatterns[1]).length > 0
        ? 1
        : ([2, 3].find((fi) => normalizeFaixaPattern(faixasPatterns[fi]).length > 0) || activeFaixaIndex || 1);
    activeFaixaIndex = faixaToActivate;
    window.isDrawingFaixa = faixaToActivate;
    weeklyViewState.followActiveFaixa = true;
    const _drawNameEl = document.getElementById('drawing-faixa-name');
    if (_drawNameEl) _drawNameEl.textContent = `Faixa ${faixaToActivate}`;
    // Mostra o badge compacto diferenciado por tipo:
    // verde = re-edição de oferta já alocada | azul = pendente sendo alocada pela 1ª vez
    const _reeditBadge = document.getElementById('reedit-badge');
    const _reeditBadgeFaixa = document.getElementById('reedit-badge-faixa');
    if (_reeditBadge) {
        _reeditBadge.classList.remove('hidden');
        const _reeditBadgeText = document.getElementById('reedit-badge-text');
        if (isReEdit) {
            // Verde — re-editando oferta já salva
            _reeditBadge.style.background = '#f0faf4';
            _reeditBadge.style.border = '1px solid #27ae60';
            _reeditBadge.style.color = '#1e7e34';
            if (_reeditBadgeText) _reeditBadgeText.textContent = '\u270E Re-editando oferta \u2014 ';
            if (_reeditBadgeFaixa) _reeditBadgeFaixa.textContent = `Faixa ${faixaToActivate}`;
        } else {
            // Azul acinzentado — pendente, alocando pela 1ª vez
            _reeditBadge.style.background = '#eef4fb';
            _reeditBadge.style.border = '1px solid #2980b9';
            _reeditBadge.style.color = '#1a5276';
            if (_reeditBadgeText) _reeditBadgeText.textContent = '\u270E Alocando oferta pendente \u2014 ';
            if (_reeditBadgeFaixa) _reeditBadgeFaixa.textContent = `Faixa ${faixaToActivate}`;
        }
    }
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

function handleAddManual() {
    if (!store.selectedTurma) {
        showToastWarning('Selecione uma turma.', 'warning', 2200);
        return;
    }
    const docData = getDocenteData();
    if (!docData.isValid) {
        showToastWarning('Preencha o(s) Docente(s).', 'warning', 2200);
        return;
    }
    if (pendingFaixaStartPick) {
        showToastWarning(`Finalize a definicao de inicio da Faixa ${pendingFaixaStartPick} antes de salvar a componente.`, 'warning', 2600);
        return;
    }
    if (window.isDrawingFaixa) persistActiveDrawingSelection();

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

            execution = computeIntensiveExecution(previewIntensive, { respectPriority: true, respectTurmaOccupancy: true });
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

        if (intensiveConflict) {
            showToastWarning(`Conflito de horário: "${intensiveConflict.disciplina}" já usa esse horário no mesmo período.`, 'error', 3600);
            return;
        }

        const teachersToCheck = (docData.mode === 'single' ? [docData.docente] : docData.docentesList.map(d => d.nome)).filter(n => n && n.trim().toUpperCase() !== 'A DEFINIR');

        if (teachersToCheck.length > 0) {
            const confirmedTeacherConflict = findConfirmedTeacherConflictForCandidate(
                candidateIntensiveForConflict,
                teachersToCheck
            );

            if (confirmedTeacherConflict) {
                const turmaNomeConflito = getTurmaLabel(
                    confirmedTeacherConflict.event.turmaId,
                    confirmedTeacherConflict.event.subGrupo
                );
                const profNomes = confirmedTeacherConflict.teacherName;
                const forceImport = confirm(
                    `Conflito de professor detectado.\n\n` +
                    `${profNomes} ja tem aula de ${confirmedTeacherConflict.event.disciplina} na turma ${turmaNomeConflito} em ${formatDateBR(confirmedTeacherConflict.date)} no horario ${confirmedTeacherConflict.horario}.\n\n` +
                    `Deseja importar/alocar mesmo assim?`
                );
                if (!forceImport) return;
                showToastWarning(`Conflito permitido: ${profNomes} mantido(s) com choque para auditoria posterior.`, 'warning', 3500);
            }
        }

        const idsToRemove = store.allocations
            .filter((a) => {
                if (String(a.turmaId) !== String(store.selectedTurma)) return false;
                if (a.disciplina !== disciplina || !isFaixaAllocation(a)) return false;
                if (String(a.subGrupo || '') !== String(subGrupo || '')) return false;
                return isDateOverlap(
                    inicioCalculado,
                    dataFimCalculada,
                    a.dataInicio || store.settings.termStart,
                    a.dataFim || store.settings.termEnd
                );
            })
            .map((a) => a.id);

        const actionText = idsToRemove.length > 0 ? 'Atualizar alocacao existente?' : 'Confirmar alocacao?';
        if (!confirm(`${disciplina} (${formatDateBR(inicioCalculado)} a ${formatDateBR(dataFimCalculada)})\n\n${actionText}`)) return;

        idsToRemove.forEach((id) => store.removeAllocation(id));

        store.addAllocation({
            turmaId: store.selectedTurma,
            disciplina: disciplina,
            docente: docData.docente,
            docentes: docData.docentesList,
            modo: 'faixas',
            ch: effectiveCH,
            dataInicio: inicioCalculado,
            dataFim: dataFimCalculada,
            modelo: 'Automatico',
            executionByDate: execution.byDate || {},
            horariosOcupados: slotsIntensiva,
            horariosUltimoDia: horariosUltimoDia,
            diasMarcados: diasMarcados,
            usaSabado: usaSabado,
            sabadoManha: sabadoManha,
            faixas: faixasConfigAjustadas,
            subGrupo: subGrupo || null,
            cor: inputConfig.cor ? inputConfig.cor.value : store.getDisciplinaColor(disciplina)
        });

        if (inicioCalculado && store.selectedTurma) {
            store.setTurmaLastStart(store.selectedTurma, inicioCalculado);
        }

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
                allocAtualizada.dataFim || dataFimCalculada
            );
            applyFaixasConfigToSidebar(faixasSidebar);
        }
        setComponentStartSelectionMode('auto');
        editingDisciplinaDraft = normalizeDisciplinaInputValue(disciplina);
        updateWeeklyFaixasTitleDisciplina();
        refreshPendingFaixaStartPickUI();
        updateWeeklyContextNote();
        updateWeeklyFaixaHoursDisplay();
        renderWeeklyGrid();
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
    canonicalRows.sort((a, b) => {
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


function renderMonthlyCalendar() {
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

function getTeacherCalendarTurnoConfigs() {
    return getGanttTurnoConfigs().map((config) => ({
        value: config.value,
        label: config.label,
        normalized: config.normalized
    }));
}

function resolveTeacherShiftForSlot(slot) {
    const config = resolveGanttTurnoForSlot(slot, getGanttTurnoConfigs());
    return config?.value || '';
}

function collectSlotsForTurnoValues(turnoValues = []) {
    const normalizedWanted = [...new Set((Array.isArray(turnoValues) ? turnoValues : [])
        .map((value) => normalizeTurnoOfertaKey(value))
        .filter(Boolean))];
    if (normalizedWanted.length === 0) return [];

    const hp = store.rawData?.horarios_por_turno || {};
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

function getSlotsForTeacherShifts(activeShiftValues = []) {
    return collectSlotsForTurnoValues(activeShiftValues);
}

function buildTurmaCalendarSlots(eventsByDate = {}, turmaId = '') {
    const nativeSlots = buildHorariosForUI();
    const slotMap = new Map();

    nativeSlots.forEach((slot) => {
        const key = String(slot || '').trim();
        if (!key) return;
        slotMap.set(key, slot);
    });

    Object.values(eventsByDate || {}).forEach((events) => {
        (Array.isArray(events) ? events : []).forEach((event) => {
            if (!event || event.type === 'holiday') return;
            if (turmaId && String(event?.turmaId || '') !== String(turmaId)) return;

            const rawSlot = String(
                event?.horario
                || (Array.isArray(event?.horariosOcupados) ? event.horariosOcupados[0] : '')
                || ''
            ).trim();
            if (!rawSlot) return;

            const normalizedSlot = cleanHorarioLabel(rawSlot);
            if (!normalizedSlot) return;
            if (!slotMap.has(normalizedSlot)) slotMap.set(normalizedSlot, normalizedSlot);
        });
    });

    return [...slotMap.values()]
        .filter((slot) => String(slot || '').trim().length > 0)
        .sort((left, right) => timeToMinutes(left) - timeToMinutes(right));
}

function formatConflictDateRange(startDate, endDate) {
    if (!startDate) return '-';
    if (!endDate || endDate === startDate) return formatDateBR(startDate);
    return `${formatDateBR(startDate)} a ${formatDateBR(endDate)}`;
}

function renderTeacherConflictRows(conflicts = []) {
    if (!Array.isArray(conflicts) || conflicts.length === 0) {
        return `
            <div style="background:#ecfdf3; border:1px solid #b7ebc6; color:#1e7e34; border-radius:8px; padding:12px 14px; margin-bottom:18px; font-weight:700;">
                Nenhum conflito horario identificado para o docente no intervalo exibido.
            </div>
        `;
    }

    const rows = conflicts.map((conflict) => `
        <tr>
            <td style="padding:8px 10px; border-bottom:1px solid #dfe6e9;">${formatConflictDateRange(conflict.startDate, conflict.endDate)}</td>
            <td style="padding:8px 10px; border-bottom:1px solid #dfe6e9;">${conflict.shift || '-'}</td>
            <td style="padding:8px 10px; border-bottom:1px solid #dfe6e9;">${conflict.turmas.join(', ') || '-'}</td>
            <td style="padding:8px 10px; border-bottom:1px solid #dfe6e9;">${conflict.componentes.join(', ') || '-'}</td>
            <td style="padding:8px 10px; border-bottom:1px solid #dfe6e9;">${conflict.description}</td>
        </tr>
    `).join('');

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

function renderTeacherCalendar() {
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
    const activeShiftValues = activeShiftData.map((shift) => shift.value);
    const conflictRows = teacherSnapshot.conflictRows;
    const visibleSlots = getSlotsForTeacherShifts(activeShiftValues);
    const totalCH = calculateTeacherTotalCH(docente);
    const docenteTitle = totalCH > 0 ? `${docente} (${totalCH}h)` : docente;
    const shiftSummary = activeShiftData.length > 0
        ? activeShiftData.map((shift) => shift.label).join(', ')
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

function getGanttTurnoCode(turnoValue = '') {
    const normalized = normalizeTurnoOfertaKey(turnoValue);
    if (normalized === 'manha') return 'M';
    if (normalized === 'tarde') return 'T';
    if (normalized === 'noite') return 'N';
    const label = formatTurnoOfertaLabel(turnoValue).replace(/[^A-Za-zÀ-ÿ0-9]/g, '');
    return String(label || 'T').slice(0, 2).toUpperCase();
}

function getGanttTurnoConfigs() {
    const hp = store.rawData?.horarios_por_turno || {};
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

function resolveGanttTurnoForSlot(slot, turnoConfigs = getGanttTurnoConfigs()) {
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

function resolveGanttTurnosForSlots(slots = [], turnoConfigs = getGanttTurnoConfigs()) {
    const used = new Set();

    (Array.isArray(slots) ? slots : []).forEach((slot) => {
        const config = resolveGanttTurnoForSlot(slot, turnoConfigs);
        if (config?.value) used.add(config.value);
    });

    return turnoConfigs.filter((config) => used.has(config.value));
}

function getGanttVisibleTurnosLegacy(allocs = [], minDateStr = '', maxDateStr = '', turnoConfigs = getGanttTurnoConfigs()) {
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

function getShiftTimeRangeStr(timeRanges, turnoValue, turnoConfigs = getGanttTurnoConfigs()) {
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

function getShiftTimeRangeMeta(timeRanges, turnoValue, turnoConfigs = getGanttTurnoConfigs()) {
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

function buildGanttTimelineLinesHtml(minTime, maxTime, totalTime) {
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

function buildGanttMonthOverlaysHtml(minTime, maxTime, totalTime) {
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

function buildGanttMonthHeaderColumnsHtml(minTime, maxTime, totalTime) {
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
            html += `<div class="gantt-month-col" style="width: ${widthPct}%; flex: none; background: transparent; text-align: center; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 1.1em; color: var(--primary); border: none;">${mesNome}</div>`;
        }
        cur = nextMonth;
    }

    html += '</div></div>';
    return html;
}

function resolveExecutionRangeBounds(range, fallbackStart = '', fallbackEnd = '') {
    return {
        start: range?.firstDate || range?.start || fallbackStart,
        end: range?.lastDate || range?.end || fallbackEnd || range?.firstDate || range?.start || fallbackStart
    };
}

function collectLegacyGanttDayItems({
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

function getGanttCompactDisciplinaLabel(item) {
    const info = getDisciplinaInfo(item?.disciplina || '');
    const base = String(info?.abrev || item?.disciplina || '').trim();
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

function getGanttCompactRangeLabel(item) {
    const compactLabel = getGanttCompactDisciplinaLabel(item);
    const start = formatDateBR(item?.dataInicio || '').slice(0, 5) || '--/--';
    const end = formatDateBR(item?.dataFim || '').slice(0, 5) || '--/--';
    return `${compactLabel} (${start} - ${end})`;
}

function buildGanttDetailedScheduleRows(timeRanges = []) {
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

function clampGanttPercent(value, min = 0, max = 100) {
    return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function formatGanttShortDate(dateStr) {
    return formatDateBR(dateStr || '').slice(0, 5) || '--/--';
}

function buildGanttSegmentDescriptors({
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
            const docenteNameShort = String(segment?.nome || '').trim().split(/\s+/)[0] || 'Docente';
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
        const docenteNameShort = String(docente?.nome || '').trim().split(/\s+/)[0] || 'Docente';
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

function buildGanttSharedSegmentLabelsHtml({ segmentMeta, leftPct, widthPct, currentTop, barHeight }) {
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
                <div style="position:absolute; top:50%; left:${Math.max(1, innerLeftPct)}%; width:${innerWidthPct}%; transform:translateY(-50%); min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:center; font-size:0.78em; font-weight:800; color:#0f172a; text-shadow:0 1px 0 rgba(255,255,255,0.45); padding:0 12px; box-sizing:border-box;">
                    ${segment.label}
                </div>
            `
            : '';
        const seamDateHtml = nextSegment
            ? `<span style="position:absolute; left:${segment.endPct}%; top:${currentTop + (barHeight / 2)}px; transform:translate(-50%, -50%); font-size:0.64em; font-weight:900; color:#0f172a; text-shadow:0 1px 0 rgba(255,255,255,0.9), 0 0 4px rgba(255,255,255,0.72); white-space:nowrap; pointer-events:none; z-index:6;">${segment.endShort}</span>`
            : '';

        return `${labelHtml}${seamDateHtml}`;
    }).join('');
}

function buildGanttOuterDateLabelsHtml({ leftPct, widthPct, currentTop, barHeight, startShort, endShort }) {
    return `
        <span style="position:absolute; left:${leftPct}%; top:${currentTop + (barHeight / 2)}px; transform:translate(calc(-100% - 10px), -50%); font-size:0.64em; font-weight:900; color:#0f172a; text-shadow:0 1px 0 rgba(255,255,255,0.72); white-space:nowrap; pointer-events:none; z-index:6;">${startShort}</span>
        <span style="position:absolute; left:${leftPct + widthPct}%; top:${currentTop + (barHeight / 2)}px; transform:translate(10px, -50%); font-size:0.64em; font-weight:900; color:#0f172a; text-shadow:0 1px 0 rgba(255,255,255,0.72); white-space:nowrap; pointer-events:none; z-index:6;">${endShort}</span>
    `;
}

function buildGanttInnerDateLabelsHtml({ leftPct, widthPct, currentTop, barHeight, startShort, endShort }) {
    return `
        <span style="position:absolute; left:${leftPct}%; top:${currentTop + (barHeight / 2)}px; transform:translate(6px, -50%); font-size:0.64em; font-weight:900; color:#0f172a; text-shadow:0 1px 0 rgba(255,255,255,0.72); white-space:nowrap; pointer-events:none; z-index:6;">${startShort}</span>
        <span style="position:absolute; left:${leftPct + widthPct}%; top:${currentTop + (barHeight / 2)}px; transform:translate(calc(-100% - 6px), -50%); font-size:0.64em; font-weight:900; color:#0f172a; text-shadow:0 1px 0 rgba(255,255,255,0.72); white-space:nowrap; pointer-events:none; z-index:6;">${endShort}</span>
    `;
}

function renderGanttTurnoLane({ turnoConfig, dayItems, docenteName, dayConfig, minTime, totalTime, ganttTurnoConfigs, isLastLane }) {
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
        const barHeight = 36;
        const timeRangeStr = getShiftTimeRangeStr(item.timeRanges, turnoConfig.value, ganttTurnoConfigs);
        const timeRangeMeta = getShiftTimeRangeMeta(item.timeRanges, turnoConfig.value, ganttTurnoConfigs);
        const detailedScheduleRows = buildGanttDetailedScheduleRows(item.timeRanges);
        const compactLabel = getGanttCompactDisciplinaLabel(item);
        const compactRangeLabel = getGanttCompactRangeLabel(item);
        const startShort = formatDateBR(item.dataInicio || '').slice(0, 5) || '--/--';
        const endShort = formatDateBR(item.dataFim || '').slice(0, 5) || '--/--';
        const useInsideEdgeDates = widthPct >= 18;
        const insideLabelInsetPx = useInsideEdgeDates ? 44 : 8;
        const anchorId = `gantt-${String(dayConfig?.name || 'dia').toLowerCase()}-${String(turnoConfig.value || 'turno').toLowerCase()}-${startT}-${currentTop}`
            .replace(/[^a-z0-9_-]+/gi, '-');
        const defaultInsideLabelHtml = `
            <div style="position:absolute; inset:0; pointer-events:none; z-index:5;">
                <div style="position:absolute; top:50%; left:${insideLabelInsetPx}px; right:${insideLabelInsetPx}px; transform:translateY(-50%); min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:center; font-size:0.78em; font-weight:800; color:#0f172a; text-shadow:0 1px 0 rgba(255,255,255,0.35);">
                    ${compactLabel}
                </div>
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
        const sharedTargetSegment = targetSegmentFound && targetSegmentWidthPct < (widthPct - 0.4);
        const showExternalLabel = !sharedTargetSegment && targetSpanPct < 12;
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
                        style="position:absolute; ${externalLabelPosition} top:${currentTop + 8}px; border:none; background:transparent; box-shadow:none; padding:0; display:block; box-sizing:border-box; font-size:0.79em; font-weight:800; color:#1f2937; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer; z-index:6; text-shadow:0 1px 0 rgba(255,255,255,0.92);">
                    ${compactLabel}
                </button>
            `
            : '';
        const edgeDateLabelsHtml = showOutsideDates
            ? (useInsideEdgeDates
                ? buildGanttInnerDateLabelsHtml({ leftPct, widthPct, currentTop, barHeight, startShort, endShort })
                : buildGanttOuterDateLabelsHtml({ leftPct, widthPct, currentTop, barHeight, startShort, endShort }))
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
                        <div style="width: 30px; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 0.8em; color: #64748b; border-right: 1px solid #cbd5e1; background: #e2e8f0; flex-shrink: 0;" title="${turnoConfig.label}">
                            ${turnoConfig.shortCode}
                        </div>
                        <div class="gantt-timeline" style="flex: 1; position: relative; background: transparent; border: none;">
                            ${barsHtml}
                        </div>
                    </div>
                `
    };
}

function renderGanttDayRow(dayConfig, laneRenders) {
    const totalRowHeight = laneRenders.reduce((sum, lane) => sum + lane.height, 0);
    return `
            <div class="gantt-row" style="display: flex; border-bottom: 1px solid #2c3e50; margin: 0; padding: 0; min-height: ${totalRowHeight}px; position: relative; z-index: 1;">
                <div style="width: 50px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.9em; color: var(--primary); background: #e2e8f0; border-right: 1px solid #cbd5e1; flex-shrink: 0;">
                    ${dayConfig.name}
                </div>
                <div style="flex: 1; display: flex; flex-direction: column;">
                    ${laneRenders.map((lane) => lane.html).join('')}
                </div>
            </div>
        `;
}

function buildGanttLensHtml(detail, placement = 'above', pinned = false) {
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

function ensureGanttDetailLens(container) {
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

function positionGanttDetailLens(container, target) {
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

function ensureGanttDetailModal() {
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

function openGanttDetailModal(detail) {
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

function bindGanttDetailInteractions(container) {
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

function getGanttVisibleTurnos(snapshot = null, turnoConfigs = getGanttTurnoConfigs()) {
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

function collectGanttDayItems({
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

function renderTeacherGanttInto(container, docenteName) {
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
        renderBidimensionalTeacherGantt(container, {
            docenteName: teacherName,
            totalCH,
            offerProjection,
            teacherSnapshot,
            startDate: fallbackStart,
            endDate: fallbackEnd
        });
    } catch (err) {
        console.error('Erro renderGanttChart:', err);
        if (container) container.innerHTML = `<div style="color:red; margin-top:20px;"><b>Erro Inesperado no Grafico:</b><br>${err.message}</div>`;
    }
}

function renderGanttChart() {
    const container = document.getElementById('gantt-container');
    const inputDocente = document.getElementById('inp-gantt-docente');
    if (!container || !inputDocente) return;
    renderTeacherGanttInto(container, inputDocente.value);
}

export function renderPublicTeacherGantt(target, docenteName) {
    const container = typeof target === 'string' ? document.getElementById(target) : target;
    renderTeacherGanttInto(container, docenteName);
}
// ==== NOVO MOTOR: AUDITORIA GLOBAL DE PROFESSORES ====
function detectGlobalTeacherConflicts() {
    // Retorna Map<nomeDocente, [{dia, horario, dataInicio, discA, turmaA, discB, turmaB}]>
    const conflictMap = new Map();
    const allocs = store.allocations;

    function getInvolvedTeachers(alloc) {
        if (alloc.docentes && alloc.docentes.length > 0) return alloc.docentes.map(d => d.nome).filter(n => n && n.toUpperCase() !== 'A DEFINIR');
        if (alloc.docente && alloc.docente.toUpperCase() !== 'A DEFINIR') return [alloc.docente];
        return [];
    }

    const diasNomes = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

    for (let i = 0; i < allocs.length; i++) {
        for (let j = i + 1; j < allocs.length; j++) {
            const a = allocs[i];
            const b = allocs[j];

            if (String(a.turmaId) === String(b.turmaId) && a.disciplina === b.disciplina && a.modo === b.modo) continue;

            const teachersA = getInvolvedTeachers(a);
            const teachersB = getInvolvedTeachers(b);
            const sharedTeachers = teachersA.filter(t => teachersB.includes(t));

            if (sharedTeachers.length === 0) continue;

            const startA = a.dataInicio || store.settings.termStart;
            const endA = a.dataFim || store.settings.termEnd;
            const startB = b.dataInicio || store.settings.termStart;
            const endB = b.dataFim || store.settings.termEnd;

            if (!isDateOverlap(startA, endA, startB, endB)) continue;

            // Data em que o conflito começa = o maior dos dois starts
            const dataConflito = startA > startB ? startA : startB;

            let isSlotConflict = false;
            let diaConflito = '';
            let horarioConflito = '';

            if (!isFaixaAllocation(a) && !isFaixaAllocation(b)) {
                if (parseInt(a.diaSemana) === parseInt(b.diaSemana) && a.horario === b.horario) {
                    isSlotConflict = true;
                    diaConflito = diasNomes[parseInt(a.diaSemana)] || a.diaSemana;
                    horarioConflito = a.horario;
                }
            } else if (isFaixaAllocation(a) && isFaixaAllocation(b)) {
                if (a.horariosOcupados && b.horariosOcupados) {
                    const sharedSlots = a.horariosOcupados.filter(h => b.horariosOcupados.includes(h));
                    if (sharedSlots.length > 0) {
                        isSlotConflict = true;
                        diaConflito = 'Faixas';
                        horarioConflito = sharedSlots.slice(0, 2).join(', ');
                    }
                }
            } else {
                const intAlloc = isFaixaAllocation(a) ? a : b;
                const regAlloc = isFaixaAllocation(a) ? b : a;
                const regDay = parseInt(regAlloc.diaSemana);

                // Fallback de retrocompatibilidade
                const diasPermitidos = Array.isArray(intAlloc.diasMarcados) ? intAlloc.diasMarcados : (intAlloc.usaSabado ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5]);

                const isIntDayActive = diasPermitidos.includes(regDay);
                if (isIntDayActive && intAlloc.horariosOcupados && intAlloc.horariosOcupados.includes(regAlloc.horario)) {
                    isSlotConflict = true;
                    diaConflito = diasNomes[regDay] || regDay;
                    horarioConflito = regAlloc.horario;
                }
            }

            if (isSlotConflict) {
                const detail = {
                    dia: diaConflito,
                    horario: horarioConflito,
                    dataInicio: dataConflito,
                    discA: `${getTurmaLabel(a.turmaId)} – ${a.disciplina}`,
                    discB: `${getTurmaLabel(b.turmaId)} – ${b.disciplina}`,
                };
                sharedTeachers.forEach(t => {
                    if (!conflictMap.has(t)) conflictMap.set(t, []);
                    // Evitar duplicatas exatas
                    const existing = conflictMap.get(t);
                    const isDup = existing.some(e => e.dia === detail.dia && e.horario === detail.horario &&
                        ((e.discA === detail.discA && e.discB === detail.discB) ||
                            (e.discA === detail.discB && e.discB === detail.discA)));
                    if (!isDup) existing.push(detail);
                });
            }
        }
    }
    return conflictMap;
}

function detectGlobalTeacherConflictsStable() {
    const conflictMap = new Map();
    const allocs = (store.allocations || []).filter((alloc) => alloc && !isPendingAllocation(alloc));
    if (allocs.length === 0) return conflictMap;

    const diasNomes = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
    const allTeachers = [...new Set(allocs.flatMap((alloc) => getAllocationTeachersForConflict(alloc)))];
    if (allTeachers.length === 0) return conflictMap;

    const auditStart = allocs.reduce((minDate, alloc) => {
        const start = alloc.dataInicio || store.settings.termStart || '';
        if (!start) return minDate;
        return !minDate || start < minDate ? start : minDate;
    }, '');
    const auditEnd = allocs.reduce((maxDate, alloc) => {
        const end = alloc.dataFim || alloc.dataInicio || store.settings.termEnd || '';
        if (!end) return maxDate;
        return !maxDate || end > maxDate ? end : maxDate;
    }, '');

    if (!auditStart || !auditEnd) return conflictMap;

    function formatSlotSummary(slotSet) {
        const ordered = [...slotSet].sort((x, y) => timeToMinutes(x) - timeToMinutes(y));
        if (ordered.length <= 3) return ordered.join(', ');
        return `${ordered.slice(0, 3).join(', ')}...`;
    }

    function formatDaySummary(daySet) {
        const ordered = [...daySet].sort((a, b) => a - b);
        if (ordered.length === 0) return '';
        if (ordered.length <= 3) return ordered.map((d) => diasNomes[d] || String(d)).join(', ');
        return `${ordered.slice(0, 3).map((d) => diasNomes[d] || String(d)).join(', ')}...`;
    }

    function getTeacherEventIdentity(event, slotKey) {
        return [
            String(event?.id || ''),
            String(event?.turmaId || ''),
            String(event?.disciplina || ''),
            String(event?.modo || ''),
            String(event?.subGrupo || ''),
            slotKey
        ].join('|');
    }

    function getTeacherEventLabel(event) {
        return `${getTurmaLabel(event.turmaId, event.subGrupo)} - ${event.disciplina}`;
    }

    allTeachers.forEach((teacherName) => {
        const eventsByDate = getCalendarEvents(null, auditStart, auditEnd, teacherName);
        const pairAggregates = new Map();

        Object.entries(eventsByDate || {}).forEach(([dateStr, events]) => {
            const slotMap = new Map();

            (events || []).forEach((event) => {
                const slotKey = normalizeConflictSlotLabel(event?.horario || '');
                if (!slotKey) return;

                if (!slotMap.has(slotKey)) slotMap.set(slotKey, []);
                const items = slotMap.get(slotKey);
                const identity = getTeacherEventIdentity(event, slotKey);
                if (!items.some((item) => item.identity === identity)) {
                    items.push({ identity, event });
                }
            });

            slotMap.forEach((items, slotKey) => {
                if (items.length < 2) return;

                for (let i = 0; i < items.length; i++) {
                    for (let j = i + 1; j < items.length; j++) {
                        const eventA = items[i].event;
                        const eventB = items[j].event;

                        if (
                            String(eventA?.turmaId) === String(eventB?.turmaId) &&
                            String(eventA?.disciplina || '') === String(eventB?.disciplina || '') &&
                            String(eventA?.modo || '') === String(eventB?.modo || '')
                        ) {
                            continue;
                        }

                        const labelA = getTeacherEventLabel(eventA);
                        const labelB = getTeacherEventLabel(eventB);
                        const orderedLabels = [labelA, labelB].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
                        const pairKey = `${orderedLabels[0]}|||${orderedLabels[1]}`;
                        const dayOfWeek = new Date(dateStr + 'T12:00:00').getDay();

                        if (!pairAggregates.has(pairKey)) {
                            pairAggregates.set(pairKey, {
                                discA: orderedLabels[0],
                                discB: orderedLabels[1],
                                firstDate: dateStr,
                                daySet: new Set(),
                                slotSet: new Set()
                            });
                        }

                        const aggregate = pairAggregates.get(pairKey);
                        if (dateStr < aggregate.firstDate) aggregate.firstDate = dateStr;
                        if (dayOfWeek >= 1 && dayOfWeek <= 6) aggregate.daySet.add(dayOfWeek);
                        aggregate.slotSet.add(slotKey);
                    }
                }
            });
        });

        if (pairAggregates.size === 0) return;

        const details = [...pairAggregates.values()]
            .map((item) => ({
                dia: formatDaySummary(item.daySet),
                horario: formatSlotSummary(item.slotSet),
                dataInicio: item.firstDate,
                discA: item.discA,
                discB: item.discB
            }))
            .sort((a, b) => {
                if (a.dataInicio !== b.dataInicio) return a.dataInicio.localeCompare(b.dataInicio);
                if (a.discA !== b.discA) return a.discA.localeCompare(b.discA, 'pt-BR', { sensitivity: 'base' });
                return a.discB.localeCompare(b.discB, 'pt-BR', { sensitivity: 'base' });
            });

        if (details.length > 0) conflictMap.set(teacherName, details);
    });

    return conflictMap;
}

function updateGlobalConflictsUI() {
    const tabTeacher = document.getElementById('tab-teacher');
    if (!tabTeacher) return;

    let warningDiv = document.getElementById('global-conflict-warning');
    if (!warningDiv) {
        warningDiv = document.createElement('div');
        warningDiv.id = 'global-conflict-warning';
        tabTeacher.insertBefore(warningDiv, tabTeacher.firstChild);
    }

    const conflictMap = detectGlobalTeacherConflictsStable();

    if (conflictMap.size > 0) {
        const tdStyle = 'padding: 5px 10px; border: 1px solid rgba(255,255,255,0.3); font-size: 0.85em; white-space: nowrap;';
        const thStyle = 'padding: 5px 10px; border: 1px solid rgba(255,255,255,0.4); font-size: 0.8em; text-align:left; background: rgba(0,0,0,0.2); white-space: nowrap;';

        let blocksHtml = '';
        conflictMap.forEach((details, teacher) => {
            const rows = details.map(d => {
                const dataBR = d.dataInicio ? d.dataInicio.split('-').reverse().join('/') : '—';
                return `<tr>
                    <td style="${tdStyle}">${d.dia}</td>
                    <td style="${tdStyle}">${d.horario}</td>
                    <td style="${tdStyle}">${dataBR}</td>
                    <td style="${tdStyle}">${d.discA}</td>
                    <td style="${tdStyle}">${d.discB}</td>
                </tr>`;
            }).join('');

            blocksHtml += `
                <div style="margin-top: 10px;">
                    <b style="font-size:1em;">&#128274; ${teacher}</b>
                    <table style="border-collapse: collapse; margin-top: 6px; width: 100%;">
                        <thead><tr>
                            <th style="${thStyle}">Dia</th>
                            <th style="${thStyle}">Horário</th>
                            <th style="${thStyle}">A partir de</th>
                            <th style="${thStyle}">Componente A</th>
                            <th style="${thStyle}">Componente B</th>
                        </tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>`;
        });

        warningDiv.innerHTML = `
            <div style="background-color: #e74c3c; color: white; padding: 15px 18px; border-radius: 6px; margin-bottom: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.15);">
                <h4 style="margin: 0 0 6px 0; display: flex; align-items: center; gap: 8px; font-size: 1em; letter-spacing: 0.5px;">
                    ⚠️ ALERTA: CONFLITO GLOBAL NA GRADE
                </h4>
                <p style="margin: 0 0 4px 0; font-size: 0.92em;">Professor(es) alocado(s) em mais de uma disciplina no mesmo horário:</p>
                ${blocksHtml}
                <p style="margin: 12px 0 0 0; font-size: 0.8em; opacity: 0.85;"><i>Selecione o professor abaixo para visualizar a grade (o slot estará destacado em vermelho escuro).</i></p>
            </div>
        `;
        warningDiv.style.display = 'block';
    } else {
        warningDiv.style.display = 'none';
    }
}

function refreshTeacherConflictsUI() {
    updateGlobalConflictsUI();
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    if (activeTab === 'teacher' && selViewDocente && selViewDocente.value) {
        renderTeacherCalendar();
    }
}
// ========================================================

function generateCalendarGrid(container, turmaId, docenteName, start, end, titleHTML, options = {}) {
    container.innerHTML = '';

    const header = document.createElement('div');
    header.className = turmaId ? 'print-header-container' : 'print-only print-header-container';
    header.innerHTML = titleHTML;
    container.appendChild(header);

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
        const hp = store.rawData?.horarios_por_turno || {};
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
                                if (eHorario) eHorario = mapSlotToTurno(eHorario, 'Manha', eTurno, store.rawData?.horarios_por_turno);
                                if (Array.isArray(eHorariosUltimoDia)) eHorariosUltimoDia = eHorariosUltimoDia.map(h => mapSlotToTurno(h, 'Manha', eTurno, store.rawData?.horarios_por_turno));
                                if (Array.isArray(eHorariosOcupados)) eHorariosOcupados = eHorariosOcupados.map(h => mapSlotToTurno(h, 'Manha', eTurno, store.rawData?.horarios_por_turno));
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
                                        event.horario || (Array.isArray(event.horariosOcupados) ? event.horariosOcupados[0] : ''),
                                        dayOfWeek,
                                        dayData.date
                                    );
                                    content = `${info.abrev}${shiftBadgeDisplay} - ${event.turmaId}`;
                                    style = `background:${event.cor || '#bdc3c7'}; color:black;`;
                                }
                            } else {
                                const event = uniqueEventsInSlot[0];
                                if (event) {
                                    const info = getDisciplinaInfo(event.disciplina);
                                    const docenteFirst = String(event.docente || '').trim().split(/\s+/)[0] || '';
                                    const docenteLabel = (docenteFirst && !/^a$/i.test(docenteFirst)) ? docenteFirst.toUpperCase() : '';
                                    const eBadgeDisplay = getCalendarShiftBadgeHTML(
                                        event,
                                        event.horario || (Array.isArray(event.horariosOcupados) ? event.horariosOcupados[0] : ''),
                                        dayOfWeek,
                                        dayData.date
                                    );
                                    content = docenteLabel
                                        ? `<div>${info.abrev}${eBadgeDisplay} <span style="font-size:0.82em; font-weight:600; opacity:0.92;">- ${docenteLabel}</span></div>`
                                        : `${info.abrev}${eBadgeDisplay}`;
                                    style = `background:${event.cor || '#bdc3c7'}; color:black;`;
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
                        if (isTurnoDividerSlot(slotTime) || turnoBoundarySlots.has(slotTime)) {
                            rowStyle = 'border-top: 2px dashed #bdc3c7; margin-top: 2px; padding-top: 2px;';
                        }

                        html += `
              <div class="cal-slot-row" style="${rowStyle}">
                <div class="cal-slot-time">${timeLabel}</div>
                <div class="${className}" style="${style}" ${tooltip}>${content}</div>
              </div>`;
                    });
                } else {
                    dayData.events.forEach((ev) => {
                        const info = getDisciplinaInfo(ev.disciplina);
                        let style = `background:${ev.cor || '#bdc3c7'}`;
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

function formatDateBR(dateStr) {
    if (!dateStr) return '';
    return dateStr.split('-').reverse().join('/');
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));

    const tabEl = document.getElementById(`tab-${tabId}`);
    if (tabEl) tabEl.classList.add('active');

    const btn = document.querySelector(`button[data-tab="${tabId}"]`);
    if (btn) btn.classList.add('active');

    if (tabId === 'teacher') {
        refreshTeacherConflictsUI();
    }
    if (tabId === 'list') {
        renderOfertasList();
    }
    if (tabId === 'weekly') {
        updateWeeklyNavigatorLabel();
    }
}

export { renderWeeklyGrid, renderOfertasList, renderMonthlyCalendar, renderTeacherCalendar };
