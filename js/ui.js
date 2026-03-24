import { store } from './store.js';
import { normalizePeriodo as normalizePeriodoLetivoCode } from './plan_storage.js';
import { getCalendarEvents } from './calendar.js';
import { countBusinessDays, countWeekdaysInPeriod, addBusinessDays, isDateOverlap, calculateEndDateByWeekday } from './utils.js';
import {
    buildSigaaExportPayload,
    computeRemainingFractionalHours,
    detectTeacherConflicts,
    filterExportableAllocations,
    generateAllocationOccurrences,
    getTeacherActiveShifts,
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
    inicio: document.getElementById('inp-data-inicio'),
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

function getAllocationTipo(alloc) {
    return String(alloc?.tipo || '').trim().toLowerCase();
}

function isFaixaAllocation(alloc) {
    return getAllocationTipo(alloc) === 'intensiva';
}

function isPriorityRegularAllocation(alloc) {
    return getAllocationTipo(alloc) === 'regular_prioritaria';
}

function isRegularAllocation(alloc) {
    return getAllocationTipo(alloc) === 'regular';
}

function isScheduledRegularAllocation(alloc) {
    return isRegularAllocation(alloc) || isPriorityRegularAllocation(alloc);
}

function isPendingAllocation(alloc) {
    return getAllocationTipo(alloc) === 'pendente';
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
                if (feedback) feedback.textContent = 'Nao foi possivel copiar. Copie manualmente.';
                showToastWarning('Nao foi possivel copiar o conteudo. Copie manualmente.', 'warning', 2600);
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
        || inputConfig.inicio?.value
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
            tipo: 'intensiva',
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

    const persistedCount = normalizeFaixaPattern(faixasPatterns[idx]).length;
    const currentCount = normalizeFaixaPattern(currentPattern).length;
    const firstMarking = persistedCount === 0 && currentCount === 0;

    if (!force && !firstMarking && iniEl.value) return false;
    if ((iniEl.value || '').trim() === dateStr) return false;

    iniEl.value = dateStr;
    if (idx === 1 && inputConfig.inicio) inputConfig.inicio.value = dateStr;
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
    const {
        preferredStart: explicitPreferredStart,
        useCurrentUI = true
    } = options;
    const preferredStart = explicitPreferredStart !== undefined
        ? explicitPreferredStart
        : getPreferredStartDateForCurrentTurma({ useCurrentUI });

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

        if (!isValidISODateValue(inicio)) continue;
        if (i > 1 && patternCount === 0 && !isValidISODateValue(rawFim) && !isValidISODateValue(nextInicio)) continue;

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

function getPreferredStartDateForCurrentTurma(options = {}) {
    const { useCurrentUI = false } = options;
    const termStart = store.settings.termStart || inpTermStart?.value || calStart?.value || '';

    if (useCurrentUI) {
        const lastUiFaixa = getLastValidFaixaFromUI();
        if (lastUiFaixa?.fim) {
            return shiftISODate(lastUiFaixa.fim, 1) || lastUiFaixa.fim;
        }
    }

    const latestAllocationEnd = getLastValidAllocationEndForCurrentTurma();
    const turmaPreferred = store.selectedTurma ? store.getTurmaLastStart(store.selectedTurma) : '';
    return initializeWeeklyScheduleForTurma({
        termStart,
        turmaLastStart: turmaPreferred,
        latestAllocationEnd
    }).firstFaixaStart || termStart;
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

function syncComponentStartInputFromFaixa1() {
    if (!inputConfig.inicio) return;
    const faixa1Start = document.getElementById('inp-data-inicio-f1')?.value || '';
    inputConfig.inicio.value = faixa1Start;
}

function formatCompactFaixaDate(value) {
    const raw = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return 'dd/mm/aa';
    return `${raw.slice(8, 10)}/${raw.slice(5, 7)}/${raw.slice(2, 4)}`;
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

function restoreComponentStartPickerValueIfNeeded() {
    if (!inputConfig.inicio) return;
    const restoreValue = inputConfig.inicio.dataset.restorePickerValue || '';
    const anchorValue = inputConfig.inicio.dataset.pickerAnchorValue || '';
    if (restoreValue && inputConfig.inicio.value === anchorValue) {
        inputConfig.inicio.value = restoreValue;
    }
    delete inputConfig.inicio.dataset.restorePickerValue;
    delete inputConfig.inicio.dataset.pickerAnchorValue;
}

function primeComponentStartPickerAnchor() {
    if (!inputConfig.inicio || !store.selectedTurma) return;

    const anchorValue = store.getTurmaLastStart(store.selectedTurma);
    const currentValue = String(inputConfig.inicio.value || '').trim();
    if (!anchorValue || !currentValue || anchorValue === currentValue) return;

    inputConfig.inicio.dataset.restorePickerValue = currentValue;
    inputConfig.inicio.dataset.pickerAnchorValue = anchorValue;
    inputConfig.inicio.value = anchorValue;
}

function setupComponentStartControl() {
    if (!inputConfig.inicio || inputConfig.inicio.dataset.bound === '1') return;
    inputConfig.inicio.dataset.bound = '1';
    syncComponentStartInputFromFaixa1();

    inputConfig.inicio.addEventListener('pointerdown', () => {
        primeComponentStartPickerAnchor();
    });

    inputConfig.inicio.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
            primeComponentStartPickerAnchor();
        }
    });

    inputConfig.inicio.addEventListener('change', () => {
        const value = String(inputConfig.inicio.value || '').trim();
        const faixa1StartEl = document.getElementById('inp-data-inicio-f1');
        if (!faixa1StartEl) return;

        delete inputConfig.inicio.dataset.restorePickerValue;
        delete inputConfig.inicio.dataset.pickerAnchorValue;
        faixa1StartEl.value = value;
        if (value && store.selectedTurma) {
            store.setTurmaLastStart(store.selectedTurma, value);
        }

        applyFaixaDateAutofill({ forceSingleBounds: true, preferredStart: value });
        setFaixaStatus(1, getFaixaSlotsAndDays(1).pattern.length);
        setFaixaStatus(2, getFaixaSlotsAndDays(2).pattern.length);
        setFaixaStatus(3, getFaixaSlotsAndDays(3).pattern.length);

        if (value) {
            activeFaixaIndex = 1;
            autoEnterWeeklyEditingForFaixa(1);
        } else if (store.selectedTurma) {
            renderWeeklyGrid();
        }
    });

    inputConfig.inicio.addEventListener('blur', () => {
        restoreComponentStartPickerValueIfNeeded();
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

    syncComponentStartInputFromFaixa1();
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

    const preferredStart = getPreferredStartDateForCurrentTurma();
    if (preferredStart && inputConfig.inicio) {
        inputConfig.inicio.value = preferredStart;
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
                    if (i === 3 && iniEl.value && !document.getElementById('inp-data-inicio-f2')?.value) {
                        showToastWarning('Defina primeiro o inicio da Faixa 2.', 'warning', 2200);
                        iniEl.value = '';
                        return;
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
        labelEl.textContent = 'Semana nao definida';
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
            ? 'Faixa = regime de funcionamento em um intervalo de datas. Defina o inicio da Faixa 1 para alinhar a alocacao com a semana real.'
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
                daySlots = [...new Set(daySlots.map(s => store.mapSlotToTurno(s, turmaTurno, 'Manha')))];
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

function buildGanttFaixaDaySnapshots(faixaAlloc, rangeStart, rangeEnd) {
    const fallbackStart = String(rangeStart || faixaAlloc?.dataInicio || store.settings.termStart || '').trim();
    const fallbackEnd = String(rangeEnd || faixaAlloc?.dataFim || store.settings.termEnd || fallbackStart).trim();
    const storedExecution = buildStoredExecutionSnapshot(faixaAlloc);

    if (storedExecution?.byDate && Object.keys(storedExecution.byDate).length > 0) {
        const grouped = new Map();

        Object.keys(storedExecution.byDate)
            .sort()
            .forEach((dateStr) => {
                if (fallbackStart && dateStr < fallbackStart) return;
                if (fallbackEnd && dateStr > fallbackEnd) return;

                const dow = new Date(`${dateStr}T12:00:00`).getDay();
                if (dow < 1 || dow > 6) return;

                const slots = Array.isArray(storedExecution.byDate[dateStr])
                    ? storedExecution.byDate[dateStr].filter(Boolean).map(String)
                    : [];
                if (slots.length === 0) return;

                if (!grouped.has(dow)) {
                    grouped.set(dow, {
                        dow,
                        inicio: dateStr,
                        fim: dateStr,
                        slotsSet: new Set()
                    });
                }

                const entry = grouped.get(dow);
                if (!entry.inicio || dateStr < entry.inicio) entry.inicio = dateStr;
                if (!entry.fim || dateStr > entry.fim) entry.fim = dateStr;
                slots.forEach((slot) => entry.slotsSet.add(slot));
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

    const faixas = buildIntensiveConflictFaixas(faixaAlloc, fallbackStart, fallbackEnd);
    const grouped = new Map();

    faixas.forEach((faixa) => {
        if (!faixa?.inicio || !faixa?.fim || !faixa.byDay) return;

        Object.keys(faixa.byDay).forEach((dayKey) => {
            const dow = parseInt(dayKey, 10);
            if (Number.isNaN(dow) || dow < 1 || dow > 6) return;

            const slots = Array.isArray(faixa.byDay[dow])
                ? faixa.byDay[dow].filter(Boolean).map(String)
                : [];
            if (slots.length === 0) return;

            if (!grouped.has(dow)) {
                grouped.set(dow, {
                    dow,
                    inicio: faixa.inicio,
                    fim: faixa.fim,
                    slotsSet: new Set()
                });
            }

            const entry = grouped.get(dow);
            if (faixa.inicio < entry.inicio) entry.inicio = faixa.inicio;
            if (faixa.fim > entry.fim) entry.fim = faixa.fim;
            slots.forEach((slot) => entry.slotsSet.add(slot));
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
            ? `Criamos automaticamente a Faixa 2 cobrindo ${rangeLabel}, do penultimo ao ultimo dia real de aula. Como os dois dias caem no mesmo dia da semana, refine manualmente se precisar diferenciar o fechamento final.`
            : 'Criamos automaticamente a Faixa 2 do penultimo ao ultimo dia real de aula. Como os dois dias caem no mesmo dia da semana, refine manualmente se precisar diferenciar o fechamento final.';
    }

    if (suggestion?.reason === 'tail-regime-change') {
        return rangeLabel
            ? `Criamos automaticamente a Faixa 2 cobrindo ${rangeLabel}, porque os dois ultimos dias reais de aula ja nao seguem o regime principal da faixa anterior. Ajuste os slots finais se quiser refinar a distribuicao e a exportacao.`
            : 'Criamos automaticamente a Faixa 2 porque os dois ultimos dias reais de aula ja nao seguem o regime principal da faixa anterior. Ajuste os slots finais se quiser refinar a distribuicao e a exportacao.';
    }

    return rangeLabel
        ? `Criamos automaticamente a Faixa 2 cobrindo ${rangeLabel}, do penultimo ao ultimo dia real de aula. Ajuste os slots finais se quiser refinar a distribuicao.`
        : 'Criamos automaticamente a Faixa 2 do penultimo ao ultimo dia real de aula. Ajuste os slots finais se quiser refinar a distribuicao.';
}

function applyFinalAdjustmentFaixaSuggestion(suggestion, options = {}) {
    const { showToast = true } = options;
    if (!suggestion?.faixas || suggestion.faixas.length === 0) return;

    const previewAlloc = {
        tipo: 'intensiva',
        faixas: suggestion.faixas
    };

    if (inputConfig.inicio) {
        inputConfig.inicio.value = suggestion.faixas[0]?.inicio || '';
    }

    hydrateFaixasFromComponente(previewAlloc);
    activeFaixaIndex = suggestion.adjustmentFaixaIndex || suggestion.faixas.length;
    autoEnterWeeklyEditingForFaixa(activeFaixaIndex);
    updateWeeklyContextNote();
    updateWeeklyFaixaHoursDisplay();
    renderWeeklyGrid();
    switchTab('weekly');

    if (showToast) {
        showToastWarning(buildFinalAdjustmentSuggestionMessage(suggestion), 'warning', 9000);
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

function getSigaaCode(allocsForClass) {
    const slotsMap = [
        { m: 450, s: 'M', sl: 1 }, { m: 500, s: 'M', sl: 2 }, { m: 550, s: 'M', sl: 3 },
        { m: 620, s: 'M', sl: 4 }, { m: 670, s: 'M', sl: 5 }, { m: 720, s: 'M', sl: 6 },
        { m: 810, s: 'T', sl: 1 }, { m: 860, s: 'T', sl: 2 }, { m: 910, s: 'T', sl: 3 },
        { m: 980, s: 'T', sl: 4 }, { m: 1030, s: 'T', sl: 5 }, { m: 1080, s: 'T', sl: 6 }
    ];

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
    if (!meta?.key) return 'Plano letivo ainda nao definido.';
    return `${meta.periodo} | ${formatDateBR(meta.termStart)} a ${formatDateBR(meta.termEnd)}`;
}

function updateActivePlanStatus() {
    if (!activePlanStatus) return;
    const activeMeta = store.getActivePlanMeta();
    if (!activeMeta?.key) {
        activePlanStatus.textContent = 'Plano ativo ainda nao definido.';
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

    syncPlanInputsFromStore(result.meta);
    updateActivePlanStatus();

    if (options.resetDraftOnChange !== false && didChangePlan) {
        resetWeeklyDraftStateForPlanSwitch(planStart);
    }

    const selectionState = syncCursoTurmaSelectionAfterPlanChange();

    const preferredStart = didChangePlan
        ? planStart
        : getPreferredStartDateForCurrentTurma();
    if (inputConfig.inicio && preferredStart) {
        inputConfig.inicio.value = preferredStart;
    }

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

    if (inputConfig.inicio && store.settings.termStart && !inputConfig.inicio.value) {
        inputConfig.inicio.value = store.settings.termStart;
    }

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
            tipo: 'pendente',
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
    setupComponentStartControl();
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
            const termStartEl = document.getElementById('term-start');
            if (inputConfig.inicio && !inputConfig.inicio.value && termStartEl && termStartEl.value) {
                inputConfig.inicio.value = termStartEl.value;
            }

            const discNome = normalizeDisciplinaInputValue(inputConfig.disciplina.value || '');
            const isEditingSameDisc = editingDisciplinaDraft && discNome === editingDisciplinaDraft;
            if (discNome && discNome !== lastDisciplinaInputNormalized && !isEditingSameDisc) {
                collapseFaixasForNewComponent();
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
            if (discNome && !isEditingSameDisc) {
                collapseFaixasForNewComponent();
                editingDisciplinaDraft = '';
            }
            lastDisciplinaInputNormalized = discNome;
            updateWeeklyFaixasTitleDisciplina();
            updateWeeklyFaixaHoursDisplay();
            if (store.selectedTurma) {
                applyWeekAutoPositionForComponentChange({ render: false });
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

function extractImportPlanMeta(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;

    const rawPlan = payload.plan && typeof payload.plan === 'object'
        ? payload.plan
        : (payload.settings && typeof payload.settings === 'object'
            ? {
                termStart: payload.settings.termStart,
                termEnd: payload.settings.termEnd,
                periodo: payload.settings.periodo || payload.periodoLetivo || store.settings.periodo
            }
            : null);

    if (!rawPlan) return null;

    const normalized = resolveOfficialPeriodoLetivoPlan(rawPlan);
    return normalized?.key ? normalized : null;
}

function handleFileSelect(event) {
    if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
    }
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const parsed = JSON.parse(e.target.result);
            const normalized = Array.isArray(parsed)
                ? parsed
                : (Array.isArray(parsed?.allocations) ? parsed.allocations : null);

            if (!normalized) {
                showToastWarning('Arquivo inválido. O formato não é suportado.', 'error', 3000);
                tempImportData = null;
                tempImportPlanMeta = null;
                event.target.value = '';
                return;
            }

            tempImportData = normalized;
            tempImportPlanMeta = extractImportPlanMeta(parsed);
            if (tempImportPlanMeta?.key) {
                showToastWarning(`Arquivo reconhecido para o plano ${getPlanDisplayLabel(tempImportPlanMeta)}.`, 'success', 2400);
            }
            const modal = document.getElementById('import-modal');
            if (modal) modal.style.display = 'flex';
        } catch (err) {
            tempImportData = null;
            tempImportPlanMeta = null;
            showToastWarning('Erro ao ler arquivo JSON. Verifique o formato.', 'error', 3000);
        }
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

    if (inputConfig.inicio) {
        inputConfig.inicio.value = initialized.firstFaixaStart || resetState.firstFaixaStart || termStart;
    }

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
        const hora = parseInt(slotRef.split(':')[0], 10);
        if (hora < 13) store.setTurnoOferta(resolveTurnoOfertaValue('Manhã'));
        else if (hora < 18) store.setTurnoOferta(resolveTurnoOfertaValue('Tarde'));
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
                if (e.sabadoManha && dayNumber === 6 && eTurno !== 'Manha' && eTurno !== 'Manhã') {
                    eventHorario = store.mapSlotToTurno(e.horario, 'Manha', eTurno);
                }
                const eventKey = slotKey(eventHorario);

                const listKey = Array.isArray(e.horariosOcupados)
                    ? e.horariosOcupados.some((h) => {
                        let hObj = h;
                        if (e.sabadoManha && dayNumber === 6 && eTurno !== 'Manha' && eTurno !== 'Manhã') {
                            hObj = store.mapSlotToTurno(h, 'Manha', eTurno);
                        }
                        return slotKey(hObj) === key;
                    })
                    : false;

                if (eventKey !== key && !listKey) return;

                const dedupe = `${e.id ?? ''}|${e.disciplina ?? ''}|${e.tipo ?? ''}|${eventKey || key}|${e.subGrupo ?? ''}`;
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

            const dedupe = `${a.id ?? ''}|${a.disciplina ?? ''}|${a.tipo ?? ''}|${key}|${a.subGrupo ?? ''}`;
            if (seen.has(dedupe)) return;
            seen.add(dedupe);
            out.push(a);
        });

        return out;
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
                    const canPickStartDate = waitingStartPick && !isHoliday && !!cellDate;
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
                        } else if (!isInsideFaixa) {
                            cell.classList.add('slot-week-disabled');
                            cell.title = 'Fora do intervalo da faixa ativa nesta semana. Ajuste inicio/fim ou navegue para outra semana.';
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
            ? (store.getTurnoLetter(alloc.horario) || 'M')
            : '';
        const allocTurnoNorm = String(allocTurno).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const isNative = allocTurnoNorm.includes('manh') && turnoLetter === 'M';
        const badgeHTML = (turnoLetter && !isNative)
            ? `<span style="display:inline-block; font-size:0.65em; background:#e67e22; color:#fff; padding:1px 4px; border-radius:3px; margin-left:2px; font-weight:bold;" title="Aula excepcionalmente no turno ${turnoLetter === 'M' ? 'da Manhã' : turnoLetter === 'T' ? 'da Tarde' : 'da Noite'}">(${turnoLetter})</span>` : '';

        card.innerHTML = `
            <div class="card-title" title="${alloc.disciplina}${docenteNome ? ` - ${docenteNome}` : ''}">
                <span class="card-comp">${info.abrev}${badgeHTML}</span>
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

    if (isFaixaAllocation(a)) {
        if (inputConfig.inicio && a.dataInicio) inputConfig.inicio.value = a.dataInicio;
        const hydrated = hydrateFaixasFromComponente(a, { useStoredExecution: true }) || {};
        editorFaixasAdjusted = !!hydrated.wasAdjusted;
    } else {
        collapseFaixasForNewComponent();
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
    idsToRemove.forEach((id) => store.removeAllocation(id));
    syncAllRegularDates();
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
    const tipo = 'intensiva';
    const inicioFaixa1 = document.getElementById('inp-data-inicio-f1')?.value ?? '';
    const inicioLegacy = inputConfig.inicio?.value ?? '';
    const inicio = inicioFaixa1 || inicioLegacy;
    const subGrupo = (document.getElementById('inp-sub-turma')?.value ?? '').trim();

    if (!disciplina) {
        showToastWarning('Preencha o componente.', 'warning', 2200);
        return;
    }

    if (String(tipo || '').trim().toLowerCase() === 'intensiva') {
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
                tipo: 'intensiva',
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
            finalAdjustmentNotice = `${buildFinalAdjustmentSuggestionMessage(finalAdjustmentSuggestion)} A componente sera salva com essa Faixa 2 automatica; se voce fizer novos ajustes depois, sera preciso salvar novamente.`;
        }

        let nonBlockingDistributionNotice = '';
        if (finalAdjustmentNotice) {
            nonBlockingDistributionNotice = finalAdjustmentNotice;
        }
        if (execution.wasTruncatedByCH) {
            const truncatedMsg = 'A componente foi inserida, mas a ultima semana ficou parcial. Se desejar, voce pode criar uma segunda faixa para ajustar melhor a distribuicao final.';
            nonBlockingDistributionNotice = nonBlockingDistributionNotice
                ? `${nonBlockingDistributionNotice} ${truncatedMsg}`
                : truncatedMsg;
        }

        if (execution.totalHours !== effectiveCH) {
            const diff = execution.totalHours - effectiveCH;
            const diffMsg = diff < 0
                ? `A carga alocada ficou em ${execution.totalHours}h para uma meta de ${effectiveCH}h. Voce pode manter assim agora e ajustar depois, se desejar.`
                : `A carga alocada ficou em ${execution.totalHours}h para uma meta de ${effectiveCH}h. Voce pode visualizar assim primeiro e ajustar depois, se desejar.`;

            nonBlockingDistributionNotice = nonBlockingDistributionNotice
                ? `${nonBlockingDistributionNotice} ${diffMsg}`
                : diffMsg;
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
            tipo: 'intensiva',
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
        editingDisciplinaDraft = normalizeDisciplinaInputValue(disciplina);
        updateWeeklyFaixasTitleDisciplina();
        refreshPendingFaixaStartPickUI();
        updateWeeklyContextNote();
        updateWeeklyFaixaHoursDisplay();
        renderWeeklyGrid();
        renderOfertasList();

        if (nonBlockingDistributionNotice) {
            showToastWarning(nonBlockingDistributionNotice, 'warning', 6200);
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
    const regularExec = getRegularExecutionSnapshot(String(store.selectedTurma), semesterStart, semesterEnd);
    const intensiveExec = getIntensiveExecutionSnapshot(String(store.selectedTurma), semesterStart, semesterEnd);

    const list = store.allocations.filter((a) => String(a.turmaId) === String(store.selectedTurma));
    const regular = list.filter((a) => isScheduledRegularAllocation(a));
    const intensivas = list.filter((a) => isFaixaAllocation(a));
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
        const grouped = new Map();
        regular.forEach((a) => {
            const key = [a.disciplina, a.docente, a.tipo, a.subGrupo || ''].join('|');
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key).push(a);
        });

        const rows = [];
        grouped.forEach((allocs) => {
            const sorted = allocs.slice().sort((x, y) => {
                const byDay = parseInt(x.diaSemana, 10) - parseInt(y.diaSemana, 10);
                if (byDay !== 0) return byDay;
                return timeToMinutes(x.horario) - timeToMinutes(y.horario);
            });
            const fallbackStart = sorted.map((a) => a.dataInicio || semesterStart).sort()[0];
            const fallbackEnd = sorted.map((a) => a.dataFim || semesterEnd).sort().slice(-1)[0];
            let totalHoras = 0;
            let maxSemanas = 0;
            let start = null;
            let end = null;
            sorted.forEach((a) => {
                const horas = regularExec.hoursByAlloc.get(a.id) || 0;
                totalHoras += horas;

                const datesSet = regularExec.datesByAlloc.get(a.id);
                const semanas = datesSet ? datesSet.size : 0;
                if (semanas > maxSemanas) maxSemanas = semanas;

                if (datesSet && datesSet.size > 0) {
                    datesSet.forEach((d) => {
                        if (!start || d < start) start = d;
                        if (!end || d > end) end = d;
                    });
                }
            });
            if (!start) start = fallbackStart;
            if (!end) end = fallbackEnd;

            const first = sorted[0];
            const info = getDisciplinaInfo(first.disciplina);
            const horariosResumo = sorted.map((a) => `${dayLabels[a.diaSemana] || 'Dia'} ${a.horario}`).join(', ');

            rows.push({
                rowType: 'regular_group',
                baseAlloc: first,
                groupIds: sorted.map((a) => a.id),
                disciplina: first.disciplina,
                componentKey: String(first.disciplina || '').trim().toLocaleUpperCase('pt-BR'),
                codigo: info.codigo || '-',
                docente: first.docente,
                tipoLabel: 'componente',
                start,
                end,
                horarioTxt: `${formatDateBR(start)} a ${ensureWarningEndDate(end)}<br><small>${horariosResumo}</small>`,
                totalHoras,
                chMax: first.ch || info.ch,
                details: `${maxSemanas} semanas`,
                sigaaCode: getSigaaCode(sorted),
                faixaIndex: 0
            });
        });

        rows.sort((a, b) => (a.componentKey || '').localeCompare(b.componentKey || ''));
        return rows;
    };

    const buildIntensiveRows = () => {
        const rows = [];
        intensivas
            .slice()
            .sort((a, b) => (a.dataInicio || '').localeCompare(b.dataInicio || ''))
            .forEach((base) => {
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
                    const dateHours = intensiveExec.dateHoursByAlloc.get(base.id) || new Map();
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
                        groupIds: [base.id],
                        disciplina: base.disciplina,
                        componentKey: String(base.disciplina || '').trim().toLocaleUpperCase('pt-BR'),
                        codigo: info.codigo || '-',
                        docente: base.docente,
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
                    <button class="btn-sigaa-copy" data-code="${row.sigaaCode}" title="Copiar Código" style="background:transparent; color:var(--primary); border:1px solid #ccc; border-radius:4px; cursor:pointer; padding:2px 6px; font-size:0.9em; transition: all 0.2s;">Copiar</button>
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

    const regularRows = buildRegularRows();
    const intensiveRows = buildIntensiveRows();
    const pendenteRows = buildPendenteRows();
    const canonicalRows = [...regularRows, ...intensiveRows].sort((a, b) => {
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
        appendSeparator('AGUARDANDO ALOCAÇÃO NA GRADE (PENDENTES)');
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

function buildSigaaHorarioResumo(faixas = []) {
    return (Array.isArray(faixas) ? faixas : [])
        .map((faixa) => `${faixa.sigaa} (${formatDateBR(faixa.inicio)} - ${formatDateBR(faixa.fim)})`)
        .join(', ');
}

function buildSigaaOfertaBase(allocation, info = {}) {
    return {
        componente: allocation?.disciplina || '',
        codigo: info.codigo || '',
        tipo: allocation?.tipo || '',
        cargaHoraria: allocation?.ch || info.ch || 0,
        docente: allocation?.docente || '',
        subGrupo: allocation?.subGrupo || ''
    };
}

function buildSigaaRegularOferta(allocs, regularExec, planContext) {
    const base = allocs[0];
    const info = getDisciplinaInfo(base.disciplina);
    const activeDates = new Set();

    allocs.forEach((alloc) => {
        const datesSet = regularExec.datesByAlloc.get(alloc.id);
        if (datesSet && datesSet.size > 0) datesSet.forEach((dateStr) => activeDates.add(dateStr));
    });

    let faixas = [];
    if (activeDates.size > 0) {
        const orderedDates = [...activeDates].sort();
        faixas = [{
            inicio: orderedDates[0],
            fim: orderedDates[orderedDates.length - 1],
            sigaa: getSigaaCode(allocs)
        }];
    } else {
        const byInterval = new Map();
        allocs.forEach((alloc) => {
            const start = alloc.dataInicio || planContext.termStart;
            const end = alloc.dataFim || planContext.termEnd;
            const intervalKey = `${start}|${end}`;
            if (!byInterval.has(intervalKey)) byInterval.set(intervalKey, []);
            byInterval.get(intervalKey).push(alloc);
        });

        byInterval.forEach((slice, intervalKey) => {
            const [start, end] = intervalKey.split('|');
            faixas.push({
                inicio: start,
                fim: end,
                sigaa: getSigaaCode(slice)
            });
        });
    }

    return {
        ...buildSigaaOfertaBase(base, info),
        horarioSigaa: buildSigaaHorarioResumo(faixas),
        faixas
    };
}

function buildSigaaFaixaOferta(allocation, planContext) {
    const info = getDisciplinaInfo(allocation.disciplina);
    const normalizedFaixas = alignFaixasToExecutionEnd(getNormalizedIntensiveFaixas(allocation), allocation.dataFim || planContext.termEnd);
    const fallbackDias = Array.isArray(allocation.diasMarcados) && allocation.diasMarcados.length > 0
        ? allocation.diasMarcados
        : (allocation.usaSabado ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5]);
    const fallbackSlots = Array.isArray(allocation.horariosOcupados) ? allocation.horariosOcupados : [];

    const faixas = (normalizedFaixas.length > 0 ? normalizedFaixas : [{
        inicio: allocation.dataInicio || planContext.termStart,
        fim: allocation.dataFim || planContext.termEnd,
        dias: fallbackDias,
        slots: fallbackSlots
    }]).map((faixa) => {
        const scoped = {
            ...allocation,
            ch: 0,
            dataInicio: faixa.inicio || allocation.dataInicio || planContext.termStart,
            dataFim: faixa.fim || allocation.dataFim || planContext.termEnd,
            diasMarcados: faixa.dias || fallbackDias,
            horariosOcupados: faixa.slots || fallbackSlots,
            usaSabado: (faixa.dias || fallbackDias).includes(6),
            faixas: [faixa]
        };

        return {
            inicio: scoped.dataInicio,
            fim: scoped.dataFim,
            sigaa: getSigaaCode([scoped])
        };
    });

    return {
        ...buildSigaaOfertaBase(allocation, info),
        horarioSigaa: buildSigaaHorarioResumo(faixas),
        faixas
    };
}

function buildSigaaPendingOferta(allocation) {
    const info = getDisciplinaInfo(allocation.disciplina);
    return {
        ...buildSigaaOfertaBase(allocation, info),
        horarioSigaa: '',
        faixas: []
    };
}

function validateSigaaMetadataPayload(payload) {
    const issues = [];
    if (!payload || typeof payload !== 'object') return ['Payload invalido para exportacao SIGAA.'];
    if (!payload.turmaId) issues.push('Turma ausente no payload SIGAA.');
    if (!payload.periodoLetivo) issues.push('Periodo letivo ausente no payload SIGAA.');
    if (!payload.termStart || !payload.termEnd) issues.push('Intervalo do plano letivo ausente no payload SIGAA.');
    if (payload.termStart && payload.termEnd && payload.termStart > payload.termEnd) {
        issues.push('Intervalo do plano letivo invalido no payload SIGAA.');
    }
    if (!Array.isArray(payload.ofertas)) issues.push('Ofertas ausentes no payload SIGAA.');
    else if (!payload.ofertas.length) issues.push('Nenhuma oferta encontrada para exportar ao SIGAA.');
    return issues;
}

function buildSigaaMetadataPayload() {
    if (!store.selectedTurma) return null;

    const turmaId = String(store.selectedTurma);
    const planContext = getActiveExportPlanContext();
    const list = filterExportableAllocations(
        store.allocations.filter((alloc) => String(alloc.turmaId) === turmaId)
    );
    const scheduledRegulars = list.filter((alloc) => isScheduledRegularAllocation(alloc));
    const faixaAllocations = list.filter((alloc) => isFaixaAllocation(alloc));
    const regularExec = getRegularExecutionSnapshot(turmaId, planContext.termStart, planContext.termEnd);
    const regularGroups = new Map();

    scheduledRegulars.forEach((alloc) => {
        const key = [alloc.disciplina, alloc.docente, alloc.tipo, alloc.subGrupo || ''].join('|');
        if (!regularGroups.has(key)) regularGroups.set(key, []);
        regularGroups.get(key).push(alloc);
    });

    const ofertas = [];
    regularGroups.forEach((allocs) => {
        ofertas.push(buildSigaaRegularOferta(allocs, regularExec, planContext));
    });
    faixaAllocations.forEach((alloc) => {
        ofertas.push(buildSigaaFaixaOferta(alloc, planContext));
    });

    let turmaLabel = turmaId;
    if (store.rawData?.turmas) {
        const turma = store.rawData.turmas.find((entry) => String(entry.turma_id) === turmaId);
        if (turma?.turma_label) turmaLabel = turma.turma_label;
    }

    return buildSigaaExportPayload({
        generatedAt: new Date().toISOString(),
        plan: planContext.plan,
        cursoSigla: store.selectedCurso || '',
        turmaId,
        turmaLabel,
        periodoLetivo: planContext.periodoLetivo,
        termStart: planContext.termStart,
        termEnd: planContext.termEnd,
        ofertas
    });
}

export function exportSigaaMetadataJSON() {
    const payload = buildSigaaMetadataPayload();
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
function getRegularExecutionSnapshot(turmaId, startDate, endDate) {
    const hoursByAlloc = new Map();
    const datesByAlloc = new Map();
    if (!turmaId || !startDate || !endDate) {
        return { hoursByAlloc, datesByAlloc };
    }

    const eventsByDate = getCalendarEvents(turmaId, startDate, endDate);
    Object.keys(eventsByDate).forEach((dateStr) => {
        const events = eventsByDate[dateStr] || [];
        events.forEach((e) => {
            if (!isScheduledRegularAllocation(e)) return;
            if (e.id === undefined || e.id === null) return;

            const id = e.id;
            hoursByAlloc.set(id, (hoursByAlloc.get(id) || 0) + 1);
            if (!datesByAlloc.has(id)) datesByAlloc.set(id, new Set());
            datesByAlloc.get(id).add(dateStr);
        });
    });

    return { hoursByAlloc, datesByAlloc };
}

function getAllocationExecutionRangeMap(allocations, startDate, endDate) {
    const rangeByAlloc = new Map();
    if (!Array.isArray(allocations) || allocations.length === 0 || !startDate || !endDate) {
        return rangeByAlloc;
    }

    const allocIds = new Set(
        allocations
            .map((a) => a?.id)
            .filter((id) => id !== undefined && id !== null)
    );
    if (allocIds.size === 0) return rangeByAlloc;

    const turmaIds = [...new Set(
        allocations
            .map((a) => String(a?.turmaId || '').trim())
            .filter(Boolean)
    )];

    turmaIds.forEach((turmaId) => {
        const eventsByDate = getCalendarEvents(turmaId, startDate, endDate);
        Object.keys(eventsByDate).forEach((dateStr) => {
            const events = eventsByDate[dateStr] || [];
            events.forEach((event) => {
                const id = event?.id;
                if (!allocIds.has(id)) return;

                const current = rangeByAlloc.get(id);
                if (!current) {
                    rangeByAlloc.set(id, { firstDate: dateStr, lastDate: dateStr });
                    return;
                }

                if (dateStr < current.firstDate) current.firstDate = dateStr;
                if (dateStr > current.lastDate) current.lastDate = dateStr;
            });
        });
    });

    return rangeByAlloc;
}

function buildNonIntensiveExecutionSignature(entry) {
    if (!entry) return '';
    const tipo = String(entry.tipo || '').trim();
    if (!isScheduledRegularAllocation({ tipo })) return '';

    const turmaId = String(entry.turmaId || '').trim();
    const disciplina = String(entry.disciplina || '').trim();
    const subGrupo = String(entry.subGrupo || '').trim();
    const diaSemana = String(parseInt(entry.diaSemana, 10));
    const horario = String(entry.horario || '').trim();

    if (!turmaId || !disciplina || !horario || diaSemana === 'NaN') return '';
    return [turmaId, disciplina, tipo, subGrupo, diaSemana, horario].join('|');
}

function getNonIntensiveExecutionRangeMap(allocations, startDate, endDate) {
    const rangeBySignature = new Map();
    if (!Array.isArray(allocations) || allocations.length === 0 || !startDate || !endDate) {
        return rangeBySignature;
    }

    const signatures = new Set(
        allocations
            .map((a) => buildNonIntensiveExecutionSignature(a))
            .filter(Boolean)
    );
    if (signatures.size === 0) return rangeBySignature;

    const turmaIds = [...new Set(
        allocations
            .map((a) => String(a?.turmaId || '').trim())
            .filter(Boolean)
    )];

    turmaIds.forEach((turmaId) => {
        const eventsByDate = getCalendarEvents(turmaId, startDate, endDate);
        Object.keys(eventsByDate).forEach((dateStr) => {
            const events = eventsByDate[dateStr] || [];
            events.forEach((event) => {
                const signature = buildNonIntensiveExecutionSignature(event);
                if (!signatures.has(signature)) return;

                const current = rangeBySignature.get(signature);
                if (!current) {
                    rangeBySignature.set(signature, { firstDate: dateStr, lastDate: dateStr });
                    return;
                }

                if (dateStr < current.firstDate) current.firstDate = dateStr;
                if (dateStr > current.lastDate) current.lastDate = dateStr;
            });
        });
    });

    return rangeBySignature;
}

function getIntensiveExecutionSnapshot(turmaId, startDate, endDate) {
    const dateHoursByAlloc = new Map();
    if (!turmaId || !startDate || !endDate) {
        return { dateHoursByAlloc };
    }

    const eventsByDate = getCalendarEvents(turmaId, startDate, endDate);
    Object.keys(eventsByDate).forEach((dateStr) => {
        const events = eventsByDate[dateStr] || [];
        events.forEach((e) => {
            if (!isFaixaAllocation(e)) return;
            if (e.id === undefined || e.id === null) return;

            const id = e.id;
            if (!dateHoursByAlloc.has(id)) dateHoursByAlloc.set(id, new Map());
            const byDate = dateHoursByAlloc.get(id);
            byDate.set(dateStr, (byDate.get(dateStr) || 0) + 1);
        });
    });

    return { dateHoursByAlloc };
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

    const eventsByDate = getCalendarEvents(null, start, end, docente);
    const turnoConfigs = getTeacherCalendarTurnoConfigs();
    const activeShiftData = getTeacherActiveShifts({
        eventsByDate,
        resolveShift: (slot) => resolveTeacherShiftForSlot(slot),
        preferredOrder: turnoConfigs.map((config) => config.value)
    });
    const activeShiftValues = activeShiftData.map((shift) => shift.value);
    const conflictRows = detectTeacherConflicts({
        eventsByDate,
        resolveShift: (slot) => {
            const turnoValue = resolveTeacherShiftForSlot(slot);
            const config = turnoConfigs.find((entry) => entry.value === turnoValue);
            return config?.label || turnoValue;
        },
        formatTurmaLabel: (event) => getTurmaLabel(event?.turmaId, event?.subGrupo)
    });
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

function getGanttVisibleTurnos(allocs = [], minDateStr = '', maxDateStr = '', turnoConfigs = getGanttTurnoConfigs()) {
    const used = new Set();

    (Array.isArray(allocs) ? allocs : []).forEach((alloc) => {
        if (isScheduledRegularAllocation(alloc)) {
            resolveGanttTurnosForSlots([alloc.horario], turnoConfigs).forEach((config) => used.add(config.value));
            return;
        }

        if (!isFaixaAllocation(alloc)) return;

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

function collectGanttDayItems({
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
        const executionRange = executionRangeByAlloc.get(alloc.id);
        const executionSignature = buildNonIntensiveExecutionSignature(alloc);
        const scheduledRange = executionSignature ? scheduledExecutionRangeByAlloc.get(executionSignature) : null;

        if (isScheduledRegularAllocation(alloc)) {
            if (parseInt(alloc.diaSemana, 10) !== dayId) return;
            const turnos = resolveGanttTurnosForSlots([alloc.horario], ganttTurnoConfigs);
            const safeTurnos = turnos.length > 0 ? turnos : (visibleTurnos[0] ? [visibleTurnos[0]] : []);
            const dayRangeStart = scheduledRange?.firstDate || executionRange?.firstDate || alloc.dataInicio || minDateStr;
            const dayRangeEnd = scheduledRange?.lastDate || executionRange?.lastDate || alloc.dataFim || maxDateStr;

            safeTurnos.forEach((turnoConfig) => {
                snapshots.push({
                    turno: turnoConfig.value,
                    dataInicio: dayRangeStart,
                    dataFim: dayRangeEnd,
                    slotCount: 1,
                    timeRanges: [alloc.horario],
                    regimeLabel: 'Regular'
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
                alloc.tipo,
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
        const compactLabel = getGanttCompactDisciplinaLabel(item);
        const compactRangeLabel = getGanttCompactRangeLabel(item);
        const startShort = formatDateBR(item.dataInicio || '').slice(0, 5) || '--/--';
        const endShort = formatDateBR(item.dataFim || '').slice(0, 5) || '--/--';
        const anchorId = `gantt-${String(dayConfig?.name || 'dia').toLowerCase()}-${String(turnoConfig.value || 'turno').toLowerCase()}-${startT}-${currentTop}`
            .replace(/[^a-z0-9_-]+/gi, '-');
        const showExternalLabel = widthPct < 15;
        const freeSpaceLeft = leftPct;
        const freeSpaceRight = 100 - (leftPct + widthPct);
        const placeExternalRight = freeSpaceRight >= freeSpaceLeft;
        const externalLabelOffsetPx = 42;
        const externalLabelPosition = placeExternalRight
            ? `left:calc(${Math.min(92, leftPct + widthPct)}% + ${externalLabelOffsetPx}px);`
            : `right:calc(${Math.min(92, 100 - leftPct)}% + ${externalLabelOffsetPx}px);`;
        const defaultInsideLabelHtml = showExternalLabel
            ? ''
            : `
                <div style="position:absolute; inset:0; pointer-events:none; z-index:5;">
                    <div style="position:absolute; top:50%; left:8px; right:8px; transform:translateY(-50%); min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:center; font-size:0.78em; font-weight:800; color:#0f172a; text-shadow:0 1px 0 rgba(255,255,255,0.35);">
                        ${compactLabel}
                    </div>
                </div>
            `;
        const externalLabelHtml = showExternalLabel
            ? `
                <button type="button"
                        class="gantt-external-detail"
                        data-gantt-anchor="${anchorId}"
                        data-gantt-detail="${encodeURIComponent(JSON.stringify({
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
                            regime: item.regimeLabel || '',
                            cargaHoraria: item.chTotal || 0,
                            docente: docenteName || '',
                            detalhesDocentes: ((item.docentes && item.docentes.length > 0) ? item.docentes : [{ nome: item.docente, ch: item.chTotal }]).map((docente) => ({
                                nome: docente?.nome || '',
                                ch: docente?.ch || ''
                            }))
                        }))}"
                        aria-label="Abrir detalhes de ${compactRangeLabel}"
                        style="position:absolute; ${externalLabelPosition} top:${currentTop + 8}px; border:none; background:transparent; box-shadow:none; padding:0; display:block; box-sizing:border-box; font-size:0.79em; font-weight:800; color:#1f2937; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer; z-index:6; text-shadow:0 1px 0 rgba(255,255,255,0.92);">
                    ${compactLabel}
                </button>
            `
            : '';

        let segmentsHtml = '';
        const docentesList = (item.docentes && item.docentes.length > 0) ? item.docentes : [{ nome: item.docente, ch: item.chTotal }];
        const flexUnitsList = docentesList.map((docente) => {
            const segCH = parseFloat(docente?.ch) || 0;
            return segCH > 0 ? segCH : 1;
        });
        const totalFlexUnits = flexUnitsList.reduce((sum, value) => sum + value, 0) || 1;
        let currentFlexOffset = 0;
        let targetSegmentStartPct = leftPct;
        let targetSegmentWidthPct = widthPct;
        let targetSegmentFound = false;
        let currentSegmentT = startT;
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
            regime: item.regimeLabel || '',
            cargaHoraria: item.chTotal || 0,
            docente: docenteName || '',
            detalhesDocentes: docentesList.map((docente) => ({
                nome: docente?.nome || '',
                ch: docente?.ch || ''
            }))
        }));

        docentesList.forEach((docente, idx) => {
            const isTarget = teacherNamesMatch(docente.nome, docenteName);
            const segCH = parseFloat(docente.ch) || 0;
            const totalCH = parseFloat(item.chTotal) || 0;
            const rawShare = totalCH > 0 ? (segCH / totalCH) : 1;
            const safeShare = rawShare > 0 ? rawShare : (totalCH > 0 ? (1 / totalCH) : 1);
            const flexUnits = flexUnitsList[idx];

            const segEndT = currentSegmentT + (timeSpan * safeShare);
            const segStartPct = leftPct + ((currentFlexOffset / totalFlexUnits) * widthPct);
            const segWidthPct = (flexUnits / totalFlexUnits) * widthPct;

            const bgColor = isTarget ? (item.cor || '#3498db') : '#ffffff';
            const txtColor = isTarget ? '#000000' : '#666666';
            const borderStyle = isTarget ? 'none' : `1px dashed ${item.cor || '#ccc'}`;
            const zIndex = isTarget ? '2' : '1';

            if (isTarget && !targetSegmentFound) {
                targetSegmentStartPct = segStartPct;
                targetSegmentWidthPct = segWidthPct;
                targetSegmentFound = true;
            }

            segmentsHtml += `
                    <div class="${isTarget ? 'gantt-bar-anchor-segment' : ''}"
                         data-gantt-anchor="${isTarget ? anchorId : ''}"
                         style="flex: ${flexUnits}; background-color: ${bgColor}; color: ${txtColor}; border-right: ${borderStyle}; border-left: ${borderStyle}; height: 100%; display: flex; align-items: center; justify-content: center; overflow: hidden; min-width: 0; box-sizing: border-box; z-index: ${zIndex};">
                    </div>
                `;
            currentFlexOffset += flexUnits;
            currentSegmentT = segEndT;
        });

        const showOutsideDates = targetSegmentWidthPct > 0;
        const targetSegmentEndPct = targetSegmentStartPct + targetSegmentWidthPct;
        const targetStartWithinBarPct = widthPct > 0
            ? Math.max(0, Math.min(100, ((targetSegmentStartPct - leftPct) / widthPct) * 100))
            : 0;
        const targetEndWithinBarPct = widthPct > 0
            ? Math.max(0, Math.min(100, ((targetSegmentEndPct - leftPct) / widthPct) * 100))
            : 100;
        const spaceLeftWithinBarPct = targetStartWithinBarPct;
        const spaceRightWithinBarPct = 100 - targetEndWithinBarPct;
        const sharedTargetSegment = targetSegmentFound && targetSegmentWidthPct < (widthPct - 0.4);
        const canPlaceLabelRight = spaceRightWithinBarPct >= 14;
        const canPlaceLabelLeft = spaceLeftWithinBarPct >= 14;
        const placeLabelRight = canPlaceLabelRight && (!canPlaceLabelLeft || spaceRightWithinBarPct >= spaceLeftWithinBarPct);
        const insideLabelHtml = !showExternalLabel && sharedTargetSegment && (canPlaceLabelRight || canPlaceLabelLeft)
            ? `
                <div style="position:absolute; inset:0; pointer-events:none; z-index:5;">
                    <div style="position:absolute; top:50%; left:${placeLabelRight ? `calc(${targetEndWithinBarPct}% + 40px)` : '8px'}; right:${placeLabelRight ? '8px' : `calc(${100 - targetStartWithinBarPct}% + 40px)`}; transform:translateY(-50%); min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:${placeLabelRight ? 'left' : 'right'}; font-size:0.78em; font-weight:800; color:#0f172a; text-shadow:0 1px 0 rgba(255,255,255,0.35);">
                        ${placeLabelRight ? `- ${compactLabel}` : `${compactLabel} -`}
                    </div>
                </div>
            `
            : defaultInsideLabelHtml;
        const outsideDateLabelsHtml = showOutsideDates
            ? `
                <span style="position:absolute; left:${targetSegmentStartPct}%; top:${currentTop + (barHeight / 2)}px; transform:translate(calc(-100% - 6px), -50%); font-size:0.64em; font-weight:900; color:#0f172a; text-shadow:0 1px 0 rgba(255,255,255,0.72); white-space:nowrap; pointer-events:none; z-index:6;">${startShort}</span>
                <span style="position:absolute; left:${targetSegmentEndPct}%; top:${currentTop + (barHeight / 2)}px; transform:translate(6px, -50%); font-size:0.64em; font-weight:900; color:#0f172a; text-shadow:0 1px 0 rgba(255,255,255,0.72); white-space:nowrap; pointer-events:none; z-index:6;">${endShort}</span>
            `
            : '';

        barsHtml += `
                    <div class="gantt-bar"
                         data-gantt-anchor="${anchorId}"
                         data-gantt-detail="${detailPayload}"
                         tabindex="0"
                         role="button"
                         style="left: ${leftPct}%; width: ${widthPct}%; top: ${currentTop}px; height: ${barHeight}px; padding: 0; display: flex; flex-direction: row; ${boxBorder} cursor: pointer; z-index:3;"
                         aria-label="${item.disciplina} | CH docente: ${item.chProf || item.chTotal || 0}h | Turma: ${turmaNome} | Turno: ${turnoConfig.label}${timeRangeStr} | Regime: ${item.regimeLabel} | Periodo efetivo: ${formatDateBR(item.dataInicio)} a ${formatDateBR(item.dataFim)} | Aulas no dia: ${item.slotCount}">
                        ${segmentsHtml}
                        ${insideLabelHtml}
                    </div>
                    ${outsideDateLabelsHtml}
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
    const compactLayout = window.innerWidth <= 640;
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
    const headerLayout = compactLayout
        ? 'display:flex; flex-direction:column; align-items:flex-start; gap:10px;'
        : 'display:flex; align-items:center; justify-content:space-between; gap:12px;';
    const upperGrid = compactLayout
        ? 'grid-template-columns:1fr;'
        : 'grid-template-columns:1fr 1fr;';
    const lowerGrid = compactLayout
        ? 'grid-template-columns:1fr 1fr;'
        : 'grid-template-columns:1fr 1fr 1fr;';
    const timingSummary = [detail?.turno || '', detail?.horaInicio && detail?.horaFim ? `${detail.horaInicio} - ${detail.horaFim}` : '']
        .filter(Boolean)
        .join(' | ');

    return `
        <div style="position:absolute; inset:0; border-radius:18px; border:1px solid ${accentMid}; background:linear-gradient(180deg, rgba(255,255,255,0.99), rgba(246,248,251,0.98)); box-shadow:0 18px 34px rgba(15,23,42,0.18), 0 0 0 1px ${hexToRgba(accent, 0.05)};"></div>
        <div style="position:absolute; left:0; right:0; ${placement === 'below' ? 'top:0;' : 'bottom:0;'} height:18px; background:linear-gradient(90deg, ${hexToRgba(accent, 0)}, ${accentSoft} 20%, ${accentMid} 50%, ${accentSoft} 80%, ${hexToRgba(accent, 0)}); border-radius:${placement === 'below' ? '18px 18px 0 0' : '0 0 18px 18px'};"></div>
        <div style="position:absolute; ${dockStyle} left:calc(var(--gantt-lens-anchor-x, 50%) - 42px); width:84px; height:10px; background:${accentStrong}; box-shadow:0 0 0 3px ${hexToRgba(accent, 0.12)};"></div>
        <div style="position:absolute; ${pointerStyle} left:var(--gantt-lens-anchor-x, 50%); width:16px; height:16px; background:linear-gradient(135deg, ${accentStrong}, ${accent}); transform:translateX(-50%) rotate(45deg); box-shadow:0 6px 14px ${hexToRgba(accent, 0.28)};"></div>
        <div style="position:relative; padding:${compactLayout ? '14px 14px 12px 14px' : '16px 18px 14px 18px'};">
            ${pinned ? `<button type="button" data-gantt-lens-close="1" aria-label="Fechar lupa" style="position:absolute; top:10px; right:10px; width:28px; height:28px; border:none; border-radius:999px; background:${hexToRgba(accent, 0.1)}; color:#334155; font-size:18px; line-height:1; cursor:pointer; display:inline-flex; align-items:center; justify-content:center;">&times;</button>` : ''}
            <div style="${headerLayout} margin-bottom:10px; ${pinned ? 'padding-right:34px;' : ''}">
                <div style="min-width:0;">
                    <div style="font-size:0.76em; font-weight:800; color:#64748b; text-transform:uppercase; letter-spacing:0.05em;">Lupa da Oferta</div>
                    <div style="margin-top:4px; font-size:1em; font-weight:800; color:#0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(detail?.disciplina || '-')}</div>
                    ${timingSummary ? `<div style="margin-top:5px; font-size:0.8em; font-weight:700; color:#64748b;">${escapeHtml(timingSummary)}</div>` : ''}
                </div>
                <span style="display:inline-flex; align-items:center; border-radius:999px; background:${accent}; color:#0b1722; padding:5px 10px; font-size:0.76em; font-weight:800; white-space:nowrap; box-shadow:0 6px 14px ${hexToRgba(accent, 0.18)};">${escapeHtml(detail?.turmaBase || detail?.turma || '-')}</span>
            </div>
            <div style="display:grid; ${upperGrid} gap:10px; margin-bottom:10px;">
                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:10px 12px;">
                    <div style="font-size:0.72em; font-weight:800; color:#64748b; text-transform:uppercase;">Inicio</div>
                    <div style="margin-top:4px; font-size:0.95em; font-weight:700; color:#0f172a;">${escapeHtml(detail?.inicio || '-')}</div>
                </div>
                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:10px 12px;">
                    <div style="font-size:0.72em; font-weight:800; color:#64748b; text-transform:uppercase;">Fim</div>
                    <div style="margin-top:4px; font-size:0.95em; font-weight:700; color:#0f172a;">${escapeHtml(detail?.fim || '-')}</div>
                </div>
            </div>
            <div style="display:grid; ${lowerGrid} gap:10px;">
                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:10px 12px;">
                    <div style="font-size:0.72em; font-weight:800; color:#64748b; text-transform:uppercase;">Hora Inicio</div>
                    <div style="margin-top:4px; font-size:0.92em; font-weight:700; color:#0f172a;">${escapeHtml(detail?.horaInicio || '-')}</div>
                </div>
                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:10px 12px;">
                    <div style="font-size:0.72em; font-weight:800; color:#64748b; text-transform:uppercase;">Hora Fim</div>
                    <div style="margin-top:4px; font-size:0.92em; font-weight:700; color:#0f172a;">${escapeHtml(detail?.horaFim || '-')}</div>
                </div>
                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:10px 12px;">
                    <div style="font-size:0.72em; font-weight:800; color:#64748b; text-transform:uppercase;">Dia</div>
                    <div style="margin-top:4px; font-size:0.92em; font-weight:700; color:#0f172a;">${escapeHtml(detail?.dia || '-')}</div>
                </div>
            </div>
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
    const placement = spaceAbove >= (lensHeight + 18) || spaceAbove >= spaceBelow ? 'above' : 'below';
    const rawTop = placement === 'above' ? topAbove : topBelow;
    const top = Math.max(12, Math.min(hostRect.height - lensHeight - 12, rawTop));
    const left = Math.max(horizontalPadding, Math.min(hostRect.width - lensWidth - horizontalPadding, anchorCenter - (lensWidth / 2)));
    const anchorPercent = Math.max(14, Math.min(86, ((anchorCenter - left) / lensWidth) * 100));

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
    `;

    overlay.style.display = 'flex';
}

function bindGanttDetailInteractions(container) {
    if (!container) return;

    const lens = ensureGanttDetailLens(container);
    let hideTimer = 0;
    let pinnedKey = '';
    let pinnedAnchor = '';

    const targets = () => container.querySelectorAll('.gantt-bar[data-gantt-detail], .gantt-external-detail[data-gantt-detail]');
    const getAnchorElements = (anchorId) => anchorId
        ? Array.from(container.querySelectorAll(`[data-gantt-anchor="${anchorId}"]`))
        : [];
    const getAnchorTarget = (target) => {
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
    };

    const hideLens = (force = false) => {
        if (!lens) return;
        if (!force && pinnedKey) return;
        clearHideTimer();
        if (force) {
            pinnedKey = '';
            pinnedAnchor = '';
        }
        lens.style.opacity = '0';
        lens.style.transform = 'translateY(8px) scale(0.98)';
        window.setTimeout(() => {
            if (!pinnedKey) {
                lens.style.display = 'none';
                clearActiveStates();
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
        const anchorTarget = getAnchorTarget(target);
        if (pinned) {
            pinnedKey = target.dataset.ganttDetail || '';
            pinnedAnchor = anchorId;
        }
        clearActiveStates();
        applyActiveState(anchorId, pinned);
        lens.style.display = 'block';
        lens.innerHTML = buildGanttLensHtml(detail, 'above', pinned);
        const placement = positionGanttDetailLens(container, anchorTarget);
        lens.innerHTML = buildGanttLensHtml(detail, placement, pinned);
        positionGanttDetailLens(container, anchorTarget);
        requestAnimationFrame(() => {
            lens.style.opacity = '1';
            lens.style.transform = 'translateY(0) scale(1)';
        });
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
        let minDateStr = store.settings.termStart || '2025-01-01';
        let maxDateStr = store.settings.termEnd || '2025-12-31';

        allocs.forEach((alloc) => {
            if (alloc.dataInicio && alloc.dataInicio < minDateStr) minDateStr = alloc.dataInicio;
            if (alloc.dataFim && alloc.dataFim > maxDateStr) maxDateStr = alloc.dataFim;
        });

        const executionRangeByAlloc = getAllocationExecutionRangeMap(allocs, minDateStr, maxDateStr);
        const scheduledExecutionRangeByAlloc = getNonIntensiveExecutionRangeMap(allocs, minDateStr, maxDateStr);
        const ganttTurnoConfigs = getGanttTurnoConfigs();
        const visibleTurnos = getGanttVisibleTurnos(allocs, minDateStr, maxDateStr, ganttTurnoConfigs);
        const minTime = new Date(minDateStr + 'T12:00:00').getTime();
        const maxTime = new Date(maxDateStr + 'T12:00:00').getTime();
        const totalTime = maxTime - minTime || 1;

        const weekDays = [
            { id: 1, name: 'SEG' },
            { id: 2, name: 'TER' },
            { id: 3, name: 'QUA' },
            { id: 4, name: 'QUI' },
            { id: 5, name: 'SEX' },
            { id: 6, name: 'SAB' }
        ];

        let html = `
        <div style="margin-bottom: 20px; text-align: center;">
            <h3 style="color: var(--primary); margin: 0; font-size: 1.4em; text-transform: uppercase;">Cronograma: ${teacherName} (${totalCH}h)</h3>
        </div>

        <div class="gantt-container" style="position: relative; border: 1px solid #ddd; border-radius: 6px; overflow: hidden; background: #f0f3f5;">
            <div style="position: absolute; top: 0; bottom: 0; left: 80px; right: 0; pointer-events: none; z-index: 0;">
                ${buildGanttTimelineLinesHtml(minTime, maxTime, totalTime)}
            </div>

            <div style="position: absolute; top: 0; bottom: 0; left: 80px; right: 0; pointer-events: none; z-index: 10;">
                ${buildGanttMonthOverlaysHtml(minTime, maxTime, totalTime)}
            </div>

            ${buildGanttMonthHeaderColumnsHtml(minTime, maxTime, totalTime)}
        `;

        weekDays.forEach((dayConfig) => {
            const dayItems = collectGanttDayItems({
                dayId: dayConfig.id,
                allocs,
                docenteName: teacherName,
                minDateStr,
                maxDateStr,
                ganttTurnoConfigs,
                visibleTurnos,
                executionRangeByAlloc,
                scheduledExecutionRangeByAlloc
            });

            const laneRenders = visibleTurnos.map((turnoConfig, idx) => renderGanttTurnoLane({
                turnoConfig,
                dayItems,
                docenteName: teacherName,
                dayConfig,
                minTime,
                totalTime,
                ganttTurnoConfigs,
                isLastLane: idx === visibleTurnos.length - 1
            }));

            html += renderGanttDayRow(dayConfig, laneRenders);
        });

        html += '</div>';
        container.innerHTML = html;
        bindGanttDetailInteractions(container);
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

            if (String(a.turmaId) === String(b.turmaId) && a.disciplina === b.disciplina && a.tipo === b.tipo) continue;

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
            String(event?.tipo || ''),
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
                            String(eventA?.tipo || '') === String(eventB?.tipo || '')
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

    let slotsToRender = [];

    if (Array.isArray(options.slotsToRenderOverride) && options.slotsToRenderOverride.length > 0) {
        slotsToRender = options.slotsToRenderOverride.slice();
    }
    else if (turmaId) {
        slotsToRender = buildHorariosForUI();
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
                                if (eHorario) eHorario = store.mapSlotToTurno(eHorario, 'Manha', eTurno);
                                if (Array.isArray(eHorariosUltimoDia)) eHorariosUltimoDia = eHorariosUltimoDia.map(h => store.mapSlotToTurno(h, 'Manha', eTurno));
                                if (Array.isArray(eHorariosOcupados)) eHorariosOcupados = eHorariosOcupados.map(h => store.mapSlotToTurno(h, 'Manha', eTurno));
                            }

                            if (eHorario && normalizeTime(eHorario) === slotTimeNorm) return true;

                            // NOVO: RESPEITA OS SLOTS LIMITADOS NO ÚLTIMO DIA DA INTENSIVA
                            if (isFaixaAllocation(e) && e.dataFim === dayData.date && eHorariosUltimoDia) {
                                return eHorariosUltimoDia.some(h => normalizeTime(h) === slotTimeNorm);
                            }

                            if (eHorariosOcupados && eHorariosOcupados.some(h => normalizeTime(h) === slotTimeNorm)) return true;
                            return false;
                        });
                        const dedupeEventKey = (e) => `${e.turmaId || ''}|${e.disciplina || ''}|${e.tipo || ''}|${e.subGrupo || ''}|${slotTimeNorm}`;
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
                                    content = `${info.abrev} - ${event.turmaId}`;
                                    style = `background:${event.cor || '#bdc3c7'}; color:black;`;
                                }
                            } else {
                                const event = uniqueEventsInSlot[0];
                                if (event) {
                                    const info = getDisciplinaInfo(event.disciplina);
                                    const docenteFirst = String(event.docente || '').trim().split(/\s+/)[0] || '';
                                    const docenteLabel = (docenteFirst && !/^a$/i.test(docenteFirst)) ? docenteFirst.toUpperCase() : '';
                                    const eTurno = event.turno ||
                                         store.rawData?.turmas?.find(t => String(t.turma_id) === String(event.turmaId))?.turno || 'Tarde';
                                     const tLetter = (event.sabadoManha && dayOfWeek === 6)
                                         ? (store.getTurnoLetter(event.horario) || 'M') : '';
                                     const eTurnoNorm = String(eTurno).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
                                     const isNativeM = eTurnoNorm.includes('manh') && tLetter === 'M';
                                     const eBadge = (tLetter && !isNativeM)
                                         ? `<span style="font-size:0.65em; background:#e67e22; color:#fff; padding:1px 4px; border-radius:3px; margin-left:2px; font-weight:bold;" title="Aula no turno ${tLetter === 'M' ? 'da Manhã' : tLetter === 'T' ? 'da Tarde' : 'da Noite'}">(${tLetter})</span>`
                                         : '';
                                     content = docenteLabel
                                         ? `<div>${info.abrev}${eBadge} <span style="font-size:0.82em; font-weight:600; opacity:0.92;">- ${docenteLabel}</span></div>`
                                         : `${info.abrev}${eBadge}`;
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
                        if (isTurnoDividerSlot(slotTime)) {
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
