import { store } from './store.js';
import { getCalendarEvents } from './calendar.js';
import { countBusinessDays, countWeekdaysInPeriod, addBusinessDays, isDateOverlap, calculateEndDateByWeekday, hasIntensiveSlotConflict } from './utils.js';

const gridContainer = document.getElementById('weekly-grid');
const selCurso = document.getElementById('sel-curso');
const selTurma = document.getElementById('sel-turma');
const listDisciplinas = document.getElementById('list-disciplinas');
const listDocentes = document.getElementById('list-docentes');

const selViewDocente = document.getElementById('sel-view-docente');

const inpTermStart = document.getElementById('term-start');
const inpTermEnd = document.getElementById('term-end');
const selTurnoOferta = document.getElementById('sel-turno_oferta') || document.getElementById('sel-turno-oferta');

const calStart = document.getElementById('cal-start');
const calEnd = document.getElementById('cal-end');

const inputConfig = {
    disciplina: document.getElementById('inp-disciplina'),
    cor: document.getElementById('inp-color'),
    docente: document.getElementById('inp-docente'),
    tipo: document.getElementById('sel-tipo'),
    inicio: document.getElementById('inp-data-inicio'),
    fim: document.getElementById('inp-data-fim')
};

let tempImportData = null;

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
    if (btnAddIntensiva) {
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
        btnRefresh.title = 'Atualizar calendário deste professor';
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
                alert('Selecione um professor primeiro para atualizar a grade.');
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
                alert('Digite o nome de um professor primeiro para atualizar o gráfico.');
            }
        });
    }
}

// ATUALIZAÇÃO: Suporte a tempo customizado de tela para o balão
function showToastWarning(message, type = 'error', customDuration = null) {
    const fb = document.getElementById('feedback-msg');
    if (!fb) return;

    fb.classList.remove('hidden');
    fb.innerHTML = message;
    fb.style.display = 'block';
    fb.style.backgroundColor = type === 'success' ? '#27ae60' : '#e74c3c';
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

function applyWeeklyGridRowHeightScale(scaleNormal = 0.63, scaleHeaderAndInterval = 0.6) {
    if (!gridContainer) return;

    requestAnimationFrame(() => {
        const styleId = 'weekly-grid-rowheight-style';
        let styleEl = document.getElementById(styleId);

        const hadStyle = !!styleEl;
        if (styleEl) styleEl.disabled = true;

        const sample = gridContainer.querySelector('.slot') ||
            gridContainer.querySelector('.header.time') ||
            gridContainer.querySelector('.header');

        if (!sample) {
            if (hadStyle && styleEl) styleEl.disabled = false;
            return;
        }

        const rectH = sample.getBoundingClientRect().height;
        let base = rectH;

        if (!base || Number.isNaN(base)) {
            const cs = getComputedStyle(sample);
            base = parseFloat(cs.height);
        }

        if (!base || Number.isNaN(base)) {
            if (hadStyle && styleEl) styleEl.disabled = false;
            return;
        }

        if (hadStyle && styleEl) styleEl.disabled = false;

        const normalH = Math.max(24, Math.round(base * scaleNormal));
        const smallH = Math.max(16, Math.round(normalH * scaleHeaderAndInterval));

        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = styleId;
            document.head.appendChild(styleEl);
        }

        styleEl.textContent = `
          #weekly-grid .slot { height: auto !important; min-height: ${normalH}px !important; }
          #weekly-grid .header.time { height: ${normalH}px !important; min-height: ${normalH}px !important; }
          #weekly-grid .header.top-header { height: ${smallH}px !important; min-height: ${smallH}px !important; line-height: 1.1 !important; padding-top: 4px !important; padding-bottom: 4px !important; }
          #weekly-grid .header.interval-time, #weekly-grid .header.interval-merge { height: ${smallH}px !important; min-height: ${smallH}px !important; line-height: 1.1 !important; padding-top: 4px !important; padding-bottom: 4px !important; }
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
            alert("Máximo de 4 professores permitidos.");
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

function renderIntensiveSlots() {
    const container = document.getElementById('slots-checkboxes');
    if (!container) return;

    container.innerHTML = '';

    const slots = buildHorariosForUI();
    const validSlots = slots
        .filter(s => !s.toLowerCase().includes('intervalo'))
        .sort((a, b) => timeToMinutes(a) - timeToMinutes(b));

    validSlots.forEach((slotLabel) => {
        const wrapper = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = slotLabel;
        checkbox.checked = true;
        wrapper.appendChild(checkbox);
        wrapper.appendChild(document.createTextNode(slotLabel));
        container.appendChild(wrapper);
    });
}

function getCheckedSlots() {
    const container = document.getElementById('slots-checkboxes');
    if (!container) return [];

    const checked = [];
    container.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
        checked.push(cb.value);
    });

    return checked;
}

function getBlockedWeekdaysForTurma(turmaId) {
    if (!turmaId) return [];
    const prioritaria = store.allocations.filter(a =>
        String(a.turmaId) === String(turmaId) &&
        a.tipo === 'regular_prioritaria'
    );
    return [...new Set(prioritaria.map(a => parseInt(a.diaSemana)))];
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

function getTurmaLabel(turmaId) {
    if (store.rawData?.turmas) {
        const t = store.rawData.turmas.find(x => String(x.turma_id) === String(turmaId));
        if (t) return t.turma_label;
    }
    return turmaId;
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
                const tInfo = a.docentes.find(d => d.nome === teacherName);
                if (tInfo) {
                    teacherCH = parseInt(tInfo.ch) || 0;
                }
            } else if (a.docente === teacherName) {
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
        if (a.tipo === 'regular' || a.tipo === 'regular_prioritaria') {
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

            const slotsToday = group.filter(a => parseInt(a.diaSemana) === dow);

            if (slotsToday.length > 0 && !feriadosSet.has(dStr)) {

                const dayIsSuspended = store.allocations.some(other => {
                    if (String(other.turmaId) !== String(turmaId)) return false;

                    const oStart = other.dataInicio || termStart;
                    const oEnd = other.dataFim || termEnd;

                    if (dStr >= oStart && dStr <= oEnd) {
                        // Prioritárias ignoram bloqueios de Intensivas (a Intensiva é quem é suspensa)
                        if (other.tipo === 'intensiva' && other.horariosOcupados && group[0].tipo !== 'regular_prioritaria') {
                            if (dStr === other.dataFim && other.horariosUltimoDia) {
                                return slotsToday.some(slot => other.horariosUltimoDia.includes(slot.horario));
                            }
                            return slotsToday.some(slot => other.horariosOcupados.includes(slot.horario));
                        }
                        if (other.tipo === 'regular_prioritaria' && parseInt(other.diaSemana) === dow && other.disciplina !== disciplina) {
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
 * Sincroniza as datas de TODAS as Intensivas da turma atual.
 * Robusto e genérico para qualquer CH e combinação de horários.
 */
function syncAllIntensiveDates() {
    // Normaliza para "HH:MM" - resolve incompatibilidades de formato entre slots
    const normT = (t) => { const m = (t || '').match(/\d{1,2}:\d{2}/); return m ? m[0] : ''; };

    const feriadosSet = new Set((store.rawData?.feriados || []).map(f => f.data || f));

    // Filtra todas as intensivas da turma selecionada
    const intensivas = store.allocations.filter(a =>
        String(a.turmaId) === String(store.selectedTurma) && a.tipo === 'intensiva'
    );

    // Filtra as prioritárias (as "chefonas") que causam suspensão
    const priorityRegulars = store.allocations.filter(a =>
        String(a.turmaId) === String(store.selectedTurma) && a.tipo === 'regular_prioritaria'
    );

    intensivas.forEach(intense => {
        const totalCH = intense.ch || 0;
        if (totalCH === 0) return;

        const slots = (intense.horariosOcupados || []).map(normT); // Normaliza slots
        if (slots.length === 0) return;

        const usaSabado = intense.usaSabado || false;

        let classesFound = 0;
        let currentDate = new Date(intense.dataInicio + 'T12:00:00');
        let lastValidDate = new Date(currentDate);
        let loops = 0;

        // Limpa cache residual
        delete intense.horariosUltimoDia;

        while (classesFound < totalCH && loops < 500) {
            const dStr = currentDate.toISOString().split('T')[0];
            const dow = currentDate.getDay();

            // Dia útil?
            let isBusiness = true;
            if (dow === 0) isBusiness = false;
            if (dow === 6 && !usaSabado) isBusiness = false;
            if (feriadosSet.has(dStr)) isBusiness = false;
            if (isBusiness) {
                // Slots bloqueados pela Prioritária NESTE dia específico (normalizado)
                const prioSlotsToday = priorityRegulars
                    .filter(p =>
                        parseInt(p.diaSemana) === dow &&
                        dStr >= (p.dataInicio || '') &&
                        dStr <= (p.dataFim || '')
                    )
                    .map(p => normT(p.horario));

                // Slots livres = slots da intensiva menos os bloqueados pela Prioritária
                const freeSlots = slots.filter(s => !prioSlotsToday.includes(s));

                if (freeSlots.length > 0) {
                    const remaining = totalCH - classesFound;
                    if (freeSlots.length <= remaining) {
                        classesFound += freeSlots.length;
                    } else {
                        // Último dia parcial: mapeia de volta para o formato original
                        const origSlots = intense.horariosOcupados || [];
                        intense.horariosUltimoDia = origSlots
                            .filter(s => freeSlots.slice(0, remaining).includes(normT(s)));
                        classesFound += remaining;
                    }
                    lastValidDate = new Date(currentDate);
                }
            }

            if (classesFound >= totalCH) break;
            currentDate.setDate(currentDate.getDate() + 1);
            loops++;
        }

        intense.dataFim = lastValidDate.toISOString().split('T')[0];
    });

    // REAÇÃO EM CADEIA: Após ajustar as Intensivas, 
    // precisamos ajustar as Regulares que podem ter sido empurradas por elas.
    syncAllRegularDates();

    store.saveAllocations();
}

function getSuspendedDates(allocs, turmaId, diaSemana, disciplina, startDate) {
    if (!startDate) return [];
    const suspended = [];

    const mySlots = allocs
        .filter(a => String(a.turmaId) === String(turmaId) && a.disciplina === disciplina && parseInt(a.diaSemana) === parseInt(diaSemana) && (a.tipo === 'regular' || a.tipo === 'regular_prioritaria'))
        .map(a => a.horario);

    if (mySlots.length === 0) return [];

    let curDt = new Date(startDate + "T12:00:00");
    for (let i = 0; i < 365; i++) {
        if (curDt.getDay() === parseInt(diaSemana)) {
            const dStr = curDt.toISOString().split('T')[0];

            const isBlocked = allocs.some(b => {
                if (String(b.turmaId) !== String(turmaId)) return false;
                const bStart = b.dataInicio || store.settings.termStart;
                const bEnd = b.dataFim || store.settings.termEnd;

                if (dStr >= bStart && dStr <= bEnd) {
                    const originalIsPrio = allocs.some(a => a.disciplina === disciplina && String(a.turmaId) === String(turmaId) && a.tipo === 'regular_prioritaria');

                    if (b.tipo === 'intensiva' && b.horariosOcupados && !originalIsPrio) {
                        if (dStr === b.dataFim && b.horariosUltimoDia) {
                            return mySlots.some(s => b.horariosUltimoDia.includes(s));
                        }
                        return mySlots.some(s => b.horariosOcupados.includes(s));
                    }
                    if (b.tipo === 'regular_prioritaria' && parseInt(b.diaSemana) === parseInt(diaSemana)) {
                        return mySlots.some(s => b.horario === s && b.disciplina !== disciplina);
                    }
                }
                return false;
            });
            if (isBlocked) suspended.push(dStr);
        }
        curDt.setDate(curDt.getDate() + 1);
    }

    return suspended;
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
        if (a.tipo === 'regular' || a.tipo === 'regular_prioritaria') {
            const dSigaa = parseInt(a.diaSemana) + 1;
            const sInfo = getSlot(a.horario);
            if (sInfo) slotsList.push({ day: dSigaa, shift: sInfo.s, slot: sInfo.sl });
        } else if (a.tipo === 'intensiva') {
            const startDt = new Date((a.dataInicio || store.settings.termStart) + "T12:00:00");
            const endDt = new Date((a.dataFim || store.settings.termEnd) + "T12:00:00");
            let curDt = new Date(startDt);
            while (curDt <= endDt) {
                const dSigaa = curDt.getDay() + 1;
                const aceitaDia = (dSigaa >= 2 && dSigaa <= 6) || (dSigaa === 7 && a.usaSabado);

                if (aceitaDia) {
                    let slotsToUse = a.horariosOcupados || [];
                    if (curDt.toISOString().split('T')[0] === a.dataFim && a.horariosUltimoDia) {
                        slotsToUse = a.horariosUltimoDia;
                    }

                    slotsToUse.forEach(h => {
                        const sInfo = getSlot(h);
                        if (sInfo) slotsList.push({ day: dSigaa, shift: sInfo.s, slot: sInfo.sl });
                    });
                }
                curDt.setDate(curDt.getDate() + 1);
            }
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


function initPeriodoLetivoETurno() {
    const defaultStart = calStart && calStart.value ? calStart.value : '';
    const defaultEnd = calEnd && calEnd.value ? calEnd.value : '';
    const selPeriodo = document.getElementById('sel-periodo-letivo');

    if (!store.settings.termStart && defaultStart) store.settings.termStart = defaultStart;
    if (!store.settings.termEnd && defaultEnd) store.settings.termEnd = defaultEnd;
    if (!store.settings.turnoOferta) store.settings.turnoOferta = 'Tarde';
    store.saveSettings();

    if (inpTermStart && store.settings.termStart) inpTermStart.value = store.settings.termStart;
    if (inpTermEnd && store.settings.termEnd) inpTermEnd.value = store.settings.termEnd;
    if (selTurnoOferta) selTurnoOferta.value = store.settings.turnoOferta || 'Tarde';

    if (inputConfig.inicio && store.settings.termStart && !inputConfig.inicio.value) {
        inputConfig.inicio.value = store.settings.termStart;
    }

    if (selPeriodo) {
        if (store.settings.periodo) selPeriodo.value = store.settings.periodo;
        selPeriodo.addEventListener('change', () => {
            store.setPeriodo(selPeriodo.value);
        });
    }

    if (calStart && store.settings.termStart) calStart.value = store.settings.termStart;
    if (calEnd && store.settings.termEnd) calEnd.value = store.settings.termEnd;

    if (inpTermStart) {
        inpTermStart.addEventListener('change', () => {
            store.setTermDates(inpTermStart.value, store.settings.termEnd);
            if (calStart) calStart.value = inpTermStart.value;
            if (inputConfig.inicio) inputConfig.inicio.value = inpTermStart.value;
            renderOfertasList();
        });
    }
    if (inpTermEnd) {
        inpTermEnd.addEventListener('change', () => {
            store.setTermDates(store.settings.termStart, inpTermEnd.value);
            if (calEnd) calEnd.value = inpTermEnd.value;
            renderOfertasList();
        });
    }
    if (calStart) {
        calStart.addEventListener('change', () => {
            store.setTermDates(calStart.value, store.settings.termEnd || (calEnd ? calEnd.value : ''));
            if (inpTermStart) inpTermStart.value = calStart.value;
            renderOfertasList();
        });
    }
    if (calEnd) {
        calEnd.addEventListener('change', () => {
            store.setTermDates(store.settings.termStart || (calStart ? calStart.value : ''), calEnd.value);
            if (inpTermEnd) inpTermEnd.value = calEnd.value;
            renderOfertasList();
        });
    }
    if (selTurnoOferta) {
        selTurnoOferta.addEventListener('change', () => {
            store.setTurnoOferta(selTurnoOferta.value);
            renderWeeklyGrid();
            renderOfertasList();
            if (inputConfig.tipo && inputConfig.tipo.value === 'intensiva') {
                renderIntensiveSlots();
            }
        });
    }
}

// ==== IMPORTAÇÃO DE BLOCO ====
function handleImportBloco() {
    if (!store.selectedCurso || !store.selectedTurma) return alert('Selecione um Curso e uma Turma primeiro.');

    const comps = store.rawData?.componentes?.filter(c => c.sigla === store.selectedCurso) || [];
    if (comps.length === 0) return alert('Nenhum componente encontrado para este curso no arquivo mestre.');

    const periodos = [...new Set(comps.map(c => c.periodo).filter(Boolean))].sort();
    if (periodos.length === 0) return alert('Os componentes deste curso não possuem períodos cadastrados.');

    const p = prompt(`✨ INICIANDO IMPORTAÇÃO RÁPIDA\nTurma alvo: ${getTurmaLabel(store.selectedTurma)}\n\nDigite o NOME DO PERÍODO que deseja importar:\n(Opções disponíveis: ${periodos.join(', ')})`);

    if (!p) return;

    const periodoSelecionado = p.trim().toUpperCase();
    const compsToImport = comps.filter(c => String(c.periodo).toUpperCase() === periodoSelecionado);

    if (compsToImport.length === 0) return alert(`Nenhuma disciplina encontrada no período "${periodoSelecionado}".`);

    let addedCount = 0;
    compsToImport.forEach(c => {
        const exists = store.allocations.some(a => String(a.turmaId) === String(store.selectedTurma) && a.disciplina === c.componente);
        if (!exists) {
            store.addAllocation({
                turmaId: store.selectedTurma,
                disciplina: c.componente,
                docente: 'A definir',
                tipo: 'pendente', // Status Especial
                cor: c.cor || '#bdc3c7',
                dataInicio: store.settings.termStart,
                dataFim: store.settings.termEnd
            });
            addedCount++;
        }
    });

    if (addedCount > 0) {
        showToastWarning(`📥 Sucesso! ${addedCount} disciplinas do Período ${periodoSelecionado} foram importadas. Vá na aba "Lista de Ofertas" para alocá-las na grade.`, 'success');
        store.saveAllocations();
        renderOfertasList();
        switchTab('list'); // Já joga o usuário para a aba certa
    } else {
        alert('Todas as disciplinas deste bloco já estão na grade (ou pendentes) para esta turma.');
    }
}


export function initUI() {
    if (selCurso) selCurso.addEventListener('change', onCursoChange);
    if (selTurma) selTurma.addEventListener('change', onTurmaChange);

    initPeriodoLetivoETurno();

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

    if (inputConfig.tipo) {
        inputConfig.tipo.addEventListener('change', (e) => {
            const divDataEl = document.getElementById('datas-intensiva');
            const divSlots = document.getElementById('container-slots-selection');
            const isIntensive = (e.target.value === 'intensiva');

            divDataEl.classList.remove('hidden');

            if (isIntensive) {
                divSlots.classList.remove('hidden');
                renderIntensiveSlots();
                const chk = document.getElementById('chk-sabados');
                if (chk) chk.checked = false; // Reset padrão ao abrir
            } else {
                divSlots.classList.add('hidden');
            }

            if (store.settings.termStart && inputConfig.inicio) {
                inputConfig.inicio.value = store.settings.termStart;
            }
        });
    }

    if (inputConfig.disciplina) {
        inputConfig.disciplina.addEventListener('input', () => {
            const termStartEl = document.getElementById('term-start');
            if (inputConfig.inicio && !inputConfig.inicio.value && termStartEl && termStartEl.value) {
                inputConfig.inicio.value = termStartEl.value;
            }
        });
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
            const periodo = store.settings.periodo || '1P';
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
        });
    }

    const inpImport = document.getElementById('inp-import');
    if (inpImport) inpImport.addEventListener('change', handleFileSelect);

    const btnReplace = document.getElementById('btn-modal-replace');
    if (btnReplace) {
        btnReplace.addEventListener('click', () => {
            if (tempImportData) {
                store.allocations = tempImportData;
                syncAllRegularDates();
                alert('Dados importados com datas recalculadas com sucesso!');
                window.location.reload();
            }
            closeModal();
        });
    }

    const btnMerge = document.getElementById('btn-modal-merge');
    if (btnMerge) {
        btnMerge.addEventListener('click', () => {
            if (tempImportData) {
                const count = store.mergeAllocations(tempImportData);
                syncAllRegularDates();
                alert(`Mesclagem concluída! ${count} novas alocações adicionadas com datas corrigidas.`);
                renderWeeklyGrid();
                renderOfertasList();
            }
            closeModal();
        });
    }

    const btnCancel = document.getElementById('btn-modal-cancel');
    if (btnCancel) {
        btnCancel.addEventListener('click', () => {
            tempImportData = null;
            if (inpImport) inpImport.value = '';
            closeModal();
        });
    }

    populateCursos();
    populateDocentes();
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            tempImportData = JSON.parse(e.target.result);
            const modal = document.getElementById('import-modal');
            if (modal) modal.style.display = 'flex';
        } catch (err) {
            alert('Erro ao ler arquivo JSON. Verifique o formato.');
        }
    };
    reader.readAsText(file);
}

function closeModal() {
    const modal = document.getElementById('import-modal');
    if (modal) modal.style.display = 'none';
    tempImportData = null;
    const inp = document.getElementById('inp-import');
    if (inp) inp.value = '';
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
    store.setLastContext(cursoSigla, null);
    selTurma.disabled = !cursoSigla;
    selTurma.innerHTML = '<option value="">Selecione uma Turma</option>';

    if (cursoSigla && store.rawData?.turmas) {
        const turmas = store.rawData.turmas.filter((t) => t.sigla === cursoSigla);
        turmas.forEach((t) => {
            selTurma.innerHTML += `<option value="${t.turma_id}">${t.turma_label}</option>`;
        });

        if (store.settings.lastTurma) {
            if (turmas.some(t => t.turma_id === store.settings.lastTurma)) {
                selTurma.value = store.settings.lastTurma;
                onTurmaChange();
            }
        }
    } else {
        store.selectedTurma = '';
    }

    updateDisciplinaDatalist();

    if (inputConfig.inicio && store.settings.termStart) {
        inputConfig.inicio.value = store.settings.termStart;
    }

    // Recalcula datas ao carregar (corrige dados antigos do localStorage)
    syncAllRegularDates();
    syncAllIntensiveDates();

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
    if (!store.rawData?.docentes) return;
    const nomes = [...new Set(store.rawData.docentes.map((d) => d.docente))].sort();

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
    store.setLastContext(store.selectedCurso, store.selectedTurma);

    const btnImportBloco = document.getElementById('btn-import-bloco');
    if (btnImportBloco) {
        btnImportBloco.style.display = store.selectedTurma ? 'block' : 'none';
    }

    const alocacoesTurma = store.allocations.filter(a => String(a.turmaId) === String(store.selectedTurma));
    const primeiraAula = alocacoesTurma.find(a => a.tipo === 'regular' && a.horario);

    if (primeiraAula) {
        const hora = parseInt(primeiraAula.horario.split(':')[0]);
        if (hora < 13) store.setTurnoOferta('Manhã');
        else store.setTurnoOferta('Tarde');
    }
    else if (store.rawData?.turmas && store.selectedTurma) {
        const t = store.rawData.turmas.find(x => String(x.turma_id) === String(store.selectedTurma));
        if (t?.turno) store.setTurnoOferta(t.turno);
    }

    const intensivas = alocacoesTurma.filter(a => a.tipo === 'intensiva' && a.dataInicio);
    if (intensivas.length > 0) {
        const datas = intensivas.map(a => a.dataInicio).sort();
        if (calStart && datas[0] < calStart.value) {
            calStart.value = datas[0];
            calStart.dispatchEvent(new Event('change'));
        }
        const dataFim = intensivas.map(a => a.dataFim).sort().pop();
        if (calEnd && dataFim > calEnd.value) {
            calEnd.value = dataFim;
            calEnd.dispatchEvent(new Event('change'));
        }
    }

    if (selTurnoOferta) {
        selTurnoOferta.value = store.settings.turnoOferta || 'Tarde';
    }

    if (inputConfig.inicio && store.settings.termStart) {
        inputConfig.inicio.value = store.settings.termStart;
    }

    renderWeeklyGrid();
    renderOfertasList();
}

function getDisciplinaInfo(nomeComponente) {
    if (!store.rawData?.componentes) return { abrev: nomeComponente, ch: 0 };
    const c = store.rawData.componentes.find((x) => x.componente === nomeComponente && x.sigla === store.selectedCurso) ||
        store.rawData.componentes.find((x) => x.componente === nomeComponente);
    if (c) return { abrev: c.abreviacao || c.componente, ch: c.ch || 0 };
    return { abrev: nomeComponente, ch: 0 };
}

function renderWeeklyGrid() {
    if (!gridContainer) return;

    gridContainer.innerHTML = '';
    const horariosUI = buildHorariosForUI();
    const dias = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

    if (!store.selectedTurma || horariosUI.length === 0) {
        const turnoAtual = store.settings?.turnoOferta || "Manhã";
        gridContainer.innerHTML = `
            <div style="grid-column: 1/-1; padding: 22px; background:#bdc3c7; border-radius: 6px;">
                <ul style="margin:0; padding-left: 20px; color:#2c3e50; font-size: 1.05rem; line-height: 1.55; text-align:left; width:100%; display:block; margin-left:0;">
                    <li>Selecione um curso do IECOS</li>
                    <li>Selecione uma turma válida do seu curso</li>
                    <li>Insira data de início e fim do Período Letivo</li>
                    <li>Selecione um turno <span style="color:#34495e; font-size:0.95rem; opacity:0.9;">(Turno Atual: ${turnoAtual})</span></li>
                </ul>
            </div>
        `;
        return;
    }

    gridContainer.appendChild(createCell('header top-header', ''));
    dias.forEach((d) => gridContainer.appendChild(createCell('header top-header', d)));

    horariosUI.forEach((horarioStr) => {
        const isIntervalo = horarioStr.toUpperCase().includes('INTERVALO');
        const labelPrimeiraColuna = isIntervalo ? cleanHorarioLabel(horarioStr) : horarioStr;
        const hDiv = createCell(isIntervalo ? 'header interval-time' : 'header time', labelPrimeiraColuna);

        if (isIntervalo) hDiv.style.background = '#e0e0e0';
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
                cell.dataset.dia = i;
                cell.dataset.horario = horarioStr;

                const allocs = store.allocations.filter((a) => {
                    const isValidTypeAndSlot = String(a.turmaId) === String(store.selectedTurma) &&
                        (a.tipo === 'regular' || a.tipo === 'regular_prioritaria') &&
                        a.diaSemana == i &&
                        a.horario === horarioStr;

                    if (!isValidTypeAndSlot) return false;

                    return true;
                });

                if (allocs.length > 0) renderSlotContent(cell, allocs);

                cell.addEventListener('click', () => handleSlotClick(i, horarioStr));
                gridContainer.appendChild(cell);
            }
        }
    });

    applyWeeklyGridRowHeightScale(0.63, 0.6);
}

function createCell(classNames, text) {
    const div = document.createElement('div');
    div.className = classNames;
    div.textContent = text;
    return div;
}

function renderSlotContent(cell, allocs) {
    cell.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'mini-card-container';

    allocs.forEach(alloc => {
        const info = getDisciplinaInfo(alloc.disciplina);
        const card = document.createElement('div');
        const docenteNome = (alloc.docente || '').split(' ')[0] || '';

        card.className = 'mini-card';
        card.style.backgroundColor = alloc.cor;
        if (alloc.tipo === 'regular_prioritaria') {
            card.style.border = '2px dashed #000';
        }

        card.innerHTML = `
            <div class="card-title" title="${alloc.disciplina}" style="display:inline;">
                ${info.abrev} - <span class="card-docente" style="font-weight:normal;">${docenteNome}</span>
            </div>
            <span class="remove-btn" title="Remover">×</span>
        `;

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

        container.appendChild(card);
    });

    cell.appendChild(container);
}

function handleSlotClick(dia, horario) {
    if (!store.selectedTurma) return alert('Selecione uma turma.');

    const disciplina = (inputConfig.disciplina?.value ?? '').replace(/\s*\(\s*\d+\s*h\s*\)\s*$/i, '');
    if (!disciplina) return alert('Preencha a Disciplina.');

    const docData = getDocenteData();
    if (!docData.isValid) return alert('Preencha o(s) Docente(s).');

    const info = getDisciplinaInfo(disciplina);
    const maxCH = parseInt(info.ch) || 0;

    if (docData.mode === 'multi' && docData.totalCH > maxCH) {
        return alert(`A soma das horas (${docData.totalCH}h) ultrapassa a carga horária da disciplina (${maxCH}h).`);
    }

    const tipo = inputConfig.tipo?.value ?? 'regular';
    if (tipo === 'intensiva') return alert('Para intensivas, configure as datas no menu e clique em "Adicionar à Grade".');

    const existingInSlot = store.allocations.filter(a =>
        String(a.turmaId) === String(store.selectedTurma) &&
        a.diaSemana == dia &&
        a.horario === horario
    );

    let dataInicio = inputConfig.inicio?.value;

    if (!dataInicio || dataInicio === store.settings.termStart) {
        if (existingInSlot.length > 0) {
            const latestEnd = existingInSlot.reduce((max, a) => {
                const aEnd = a.dataFim || store.settings.termEnd;
                return aEnd > max ? aEnd : max;
            }, "2000-01-01");
            const nextDay = new Date(latestEnd + "T12:00:00");
            nextDay.setDate(nextDay.getDate() + 1);
            dataInicio = nextDay.toISOString().split('T')[0];
        } else {
            dataInicio = store.settings.termStart;
        }
    }

    const overlap = existingInSlot.find(a => {
        const startA = a.dataInicio || store.settings.termStart;
        const endA = a.dataFim || store.settings.termEnd;
        const tempEnd = new Date(dataInicio + "T12:00:00");
        tempEnd.setDate(tempEnd.getDate() + 7);
        return isDateOverlap(dataInicio, tempEnd.toISOString().split('T')[0], startA, endA);
    });

    if (overlap) {
        const msgInicio = overlap.dataInicio ? formatDateBR(overlap.dataInicio) : formatDateBR(store.settings.termStart);
        const msgFim = overlap.dataFim ? formatDateBR(overlap.dataFim) : formatDateBR(store.settings.termEnd);
        return alert(`Conflito de Datas!\n\nA disciplina "${overlap.disciplina}" já ocupa este slot no período de ${msgInicio} até ${msgFim}.`);
    }

    // ==== BARREIRA GLOBAL DO PROFESSOR (REGULAR) ====
    const teachersToCheck = (docData.mode === 'single' ? [docData.docente] : docData.docentesList.map(d => d.nome)).filter(n => n && n.trim().toUpperCase() !== 'A DEFINIR');

    if (teachersToCheck.length > 0) {
        const conflitoDocenteGlobal = store.allocations.find((a) => {
            if (String(a.turmaId) === String(store.selectedTurma)) return false;

            let hasTeacherConflict = false;
            if (a.docentes && a.docentes.length > 0) {
                hasTeacherConflict = a.docentes.some(d => teachersToCheck.includes(d.nome));
            } else {
                hasTeacherConflict = teachersToCheck.includes(a.docente);
            }
            if (!hasTeacherConflict) return false;

            const startA = a.dataInicio || store.settings.termStart;
            const endA = a.dataFim || store.settings.termEnd;
            const tempEnd = new Date(dataInicio + "T12:00:00");
            tempEnd.setDate(tempEnd.getDate() + 7);

            if (!isDateOverlap(dataInicio, tempEnd.toISOString().split('T')[0], startA, endA)) return false;

            if (a.tipo === 'intensiva') {
                if (a.horariosOcupados && a.horariosOcupados.includes(horario)) {
                    if (dia == 6 && !a.usaSabado) return false;
                    return true;
                }
                return false;
            } else {
                return parseInt(a.diaSemana) == dia && a.horario === horario;
            }
        });

        if (conflitoDocenteGlobal) {
            const turmaNomeConflito = getTurmaLabel(conflitoDocenteGlobal.turmaId);
            const profNomes = teachersToCheck.join(', ');
            showToastWarning(`⚠️ <b>Professor indisponível!</b><br><b>${profNomes}</b> já tem aula de <b>${conflitoDocenteGlobal.disciplina}</b> na turma <b>${turmaNomeConflito}</b> neste dia e horário.`, 'error', 3500);
            return;
        }
    }
    // ==================================================

    const blockingIntensivas = store.allocations.filter(a => {
        if (String(a.turmaId) !== String(store.selectedTurma)) return false;
        if (a.tipo !== 'intensiva') return false;

        const aStart = a.dataInicio || store.settings.termStart;
        const aEnd = a.dataFim || store.settings.termEnd;
        const rStart = dataInicio;
        const rEnd = store.settings.termEnd || '2099-12-31';

        if (!isDateOverlap(rStart, rEnd, aStart, aEnd)) return false;
        return a.horariosOcupados && a.horariosOcupados.includes(horario);
    });

    const intensivasAntes = store.allocations
        .filter(a => String(a.turmaId) === String(store.selectedTurma) && a.tipo === 'intensiva')
        .map(a => ({ id: a.id, end: a.dataFim }));

    store.addAllocation({
        turmaId: store.selectedTurma,
        disciplina,
        docente: docData.docente,
        docentes: docData.docentesList,
        tipo: tipo,
        diaSemana: dia,
        horario,
        dataInicio: dataInicio,
        dataFim: dataInicio,
        cor: inputConfig.cor ? inputConfig.cor.value : store.getDisciplinaColor(disciplina)
    });

    syncAllRegularDates();
    syncAllIntensiveDates();
    renderWeeklyGrid();
    renderOfertasList();

    // Notificação Reversa: Prioritária empurra Intensiva
    if (tipo === 'regular_prioritaria') {
        const intensivasDepois = store.allocations.filter(a => String(a.turmaId) === String(store.selectedTurma) && a.tipo === 'intensiva');
        const empurradas = intensivasDepois.filter(d => {
            const antes = intensivasAntes.find(ant => ant.id === d.id);
            return antes && d.dataFim > antes.end;
        });

        if (empurradas.length > 0) {
            const nomes = [...new Set(empurradas.map(e => e.disciplina))].join(', ');
            showToastWarning(`👑 <b>A Chefona chegou!</b><br>A Intensiva de <b>${nomes}</b> teve aulas suspensas e a data final foi empurrada para garantir a carga horária!`, 'success', 5000);
        }
    }

    if (blockingIntensivas.length > 0 && tipo !== 'regular_prioritaria') {
        const nomes = [...new Set(blockingIntensivas.map(i => i.disciplina))].join(', ');
        showToastWarning(`💡 <b>Ajuste Automático:</b> A disciplina <b>${info.abrev}</b> iniciará com aulas suspensas nos dias da Intensiva de <b>${nomes}</b>. A data final foi compensada!`, 'success');
    } else if (store.settings.termEnd) {
        if (window.overlapWarningTimeout) clearTimeout(window.overlapWarningTimeout);
        window.overlapWarningTimeout = setTimeout(() => {
            const slotsDesta = store.allocations.filter(a => a.disciplina === disciplina && String(a.turmaId) === String(store.selectedTurma));
            if (slotsDesta.length > 0 && slotsDesta[0].dataFim > store.settings.termEnd) {
                showToastWarning(`⚠️ ATENÇÃO: A disciplina <b>${info.abrev}</b> terminará em <b>${formatDateBR(slotsDesta[0].dataFim)}</b>.<br>Isso ultrapassa o fim do semestre (${formatDateBR(store.settings.termEnd)}).<br>Insira mais horários na grade para reduzir esta data!`, 'error');
            }
        }, 5000);
    }
}

function handleAddManual() {
    if (!store.selectedTurma) return alert('Selecione uma turma.');
    const docData = getDocenteData();
    if (!docData.isValid) return alert('Preencha o(s) Docente(s).');

    const disciplina = (inputConfig.disciplina?.value ?? '').replace(/\s*\(\s*\d+\s*h\s*\)\s*$/i, '');
    const tipo = inputConfig.tipo?.value ?? 'regular';
    const inicio = inputConfig.inicio?.value ?? '';

    if (!disciplina) return alert('Preencha o componente.');

    if (tipo === 'intensiva') {
        if (!inicio) return alert('Defina a data de início.');

        const info = getDisciplinaInfo(disciplina);
        const ch = info.ch || 0;
        if (ch === 0) return alert(`O componente "${disciplina}" tem CH 0.`);
        if (docData.mode === 'multi' && docData.totalCH > ch) {
            return alert(`A soma das cargas horárias excede a CH da disciplina.`);
        }

        let slotsIntensiva = getCheckedSlots();
        if (slotsIntensiva.length === 0) return alert('Selecione pelo menos um horário.');

        let effectiveCH = ch;
        const diasNecessarios = Math.ceil(effectiveCH / slotsIntensiva.length);
        const feriados = store.rawData?.feriados || [];
        const blockedWeekdays = getBlockedWeekdaysForTurma(store.selectedTurma);

        const chkSabado = document.getElementById('chk-sabados');
        const usaSabado = chkSabado ? chkSabado.checked : false;

        const dataFimCalculada = addBusinessDays(inicio, diasNecessarios, feriados, blockedWeekdays, usaSabado);

        // ==========================================
        // NOVO: CALCULA EXATAMENTE OS SLOTS DO ÚLTIMO DIA
        // ==========================================
        const slotsNoUltimoDia = effectiveCH % slotsIntensiva.length;
        let horariosUltimoDia = slotsIntensiva;
        if (slotsNoUltimoDia !== 0) {
            horariosUltimoDia = slotsIntensiva.slice(0, slotsNoUltimoDia);
        }
        // ==========================================

        const intensiveConflict = store.allocations.find(a => {
            if (String(a.turmaId) !== String(store.selectedTurma)) return false;
            if (a.tipo !== 'intensiva' || a.disciplina === disciplina) return false;
            return hasIntensiveSlotConflict(inicio, dataFimCalculada, slotsIntensiva, a.dataInicio || store.settings.termStart, a.dataFim || store.settings.termEnd, a.horariosOcupados);
        });

        if (intensiveConflict) {
            return alert(`❌ CHOQUE DE HORÁRIO!\n\nA Intensiva de "${intensiveConflict.disciplina}" já está utilizando este(s) horário(s) no mesmo período. A ação foi bloqueada.`);
        }

        // ==== BARREIRA GLOBAL DO PROFESSOR (INTENSIVA) ====
        const teachersToCheck = (docData.mode === 'single' ? [docData.docente] : docData.docentesList.map(d => d.nome)).filter(n => n && n.trim().toUpperCase() !== 'A DEFINIR');

        if (teachersToCheck.length > 0) {
            const teacherConflictGlobal = store.allocations.find(a => {
                if (String(a.turmaId) === String(store.selectedTurma)) return false;

                let hasTeacherConflict = false;
                if (a.docentes && a.docentes.length > 0) {
                    hasTeacherConflict = a.docentes.some(d => teachersToCheck.includes(d.nome));
                } else {
                    hasTeacherConflict = teachersToCheck.includes(a.docente);
                }
                if (!hasTeacherConflict) return false;

                const aStart = a.dataInicio || store.settings.termStart;
                const aEnd = a.dataFim || store.settings.termEnd;
                if (!isDateOverlap(inicio, dataFimCalculada, aStart, aEnd)) return false;

                if (a.tipo === 'intensiva') {
                    return hasIntensiveSlotConflict(inicio, dataFimCalculada, slotsIntensiva, aStart, aEnd, a.horariosOcupados);
                } else {
                    if (slotsIntensiva.includes(a.horario)) {
                        if (parseInt(a.diaSemana) === 6 && !usaSabado) return false;
                        return true;
                    }
                    return false;
                }
            });

            if (teacherConflictGlobal) {
                const turmaNomeConflito = getTurmaLabel(teacherConflictGlobal.turmaId);
                const profNomes = teachersToCheck.join(', ');
                showToastWarning(`⚠️ <b>Professor indisponível!</b><br><b>${profNomes}</b> já tem aula de <b>${teacherConflictGlobal.disciplina}</b> na turma <b>${turmaNomeConflito}</b> nestas datas.`, 'error', 3500);
                return;
            }
        }
        // ===================================================

        let idToRemove = null;
        const conflitoIntensiva = store.allocations.find(a => {
            if (String(a.turmaId) === String(store.selectedTurma) && a.disciplina === disciplina) {
                if (a.tipo === 'intensiva' && isDateOverlap(inicio, dataFimCalculada, a.dataInicio || store.settings.termStart, a.dataFim || store.settings.termEnd)) return true;
                return a.tipo !== 'intensiva';
            }
            return false;
        });

        if (conflitoIntensiva) idToRemove = conflitoIntensiva.id;

        const actionText = idToRemove ? "Atualizar alocação existente?" : "Confirmar alocação?";
        if (!confirm(`${disciplina} (${formatDateBR(inicio)} a ${formatDateBR(dataFimCalculada)})\n\n${actionText}`)) return;

        if (idToRemove) store.removeAllocation(idToRemove);

        const affectedRegulars = [];
        store.allocations.forEach(a => {
            if (String(a.turmaId) !== String(store.selectedTurma)) return;
            // A Intensiva NÃO afeta/empurra Disciplinas Prioritárias (Chefonas)
            if (a.tipo !== 'regular') return;

            const sReg = a.dataInicio || store.settings.termStart;
            const eReg = a.dataFim || store.settings.termEnd;

            if (isDateOverlap(inicio, dataFimCalculada, sReg, eReg)) {
                if (slotsIntensiva.includes(a.horario)) {
                    if (!affectedRegulars.includes(a.disciplina)) {
                        affectedRegulars.push(a.disciplina);
                    }
                }
            }
        });

        store.addAllocation({
            turmaId: store.selectedTurma,
            disciplina: disciplina,
            docente: docData.docente,
            docentes: docData.docentesList,
            tipo: 'intensiva',
            ch: effectiveCH,
            dataInicio: inicio,
            dataFim: dataFimCalculada,
            modelo: 'Automático',
            horariosOcupados: slotsIntensiva,
            horariosUltimoDia: horariosUltimoDia,
            usaSabado: usaSabado,
            cor: inputConfig.cor ? inputConfig.cor.value : store.getDisciplinaColor(disciplina)
        });

        syncAllRegularDates();
        syncAllIntensiveDates();
        renderOfertasList();

        if (affectedRegulars.length > 0) {
            const nomes = affectedRegulars.join(', ');
            showToastWarning(`💡 <b>Ajuste Automático:</b> A(s) disciplina(s) <b>${nomes}</b> teve/tiveram aulas suspensas e a data final foi empurrada para frente!`, 'success');
        }

    } else {
        alert('Para regular, clique na grade.');
    }
}

function renderOfertasList() {
    const tbody = document.querySelector('#ofertas-table tbody');
    if (!tbody) return;

    const theadTr = document.querySelector('#ofertas-table thead tr');
    if (theadTr && !document.getElementById('th-sigaa')) {
        const thSigaa = document.createElement('th');
        thSigaa.id = 'th-sigaa';
        thSigaa.textContent = 'SIGAA';
        thSigaa.style.textAlign = 'center';
        theadTr.insertBefore(thSigaa, theadTr.lastElementChild);
    }

    tbody.innerHTML = '';
    const list = store.allocations.filter((a) => String(a.turmaId) === String(store.selectedTurma));
    const feriados = store.rawData?.feriados ? store.rawData.feriados.map((f) => f.data) : [];
    const semestreInicio = calStart ? calStart.value : '2025-01-01';
    const semestreFim = calEnd ? calEnd.value : '2025-12-31';

    const regular = list.filter((a) => a.tipo === 'regular' || a.tipo === 'regular_prioritaria');
    const intensivas = list.filter((a) => a.tipo === 'intensiva');
    const pendentes = list.filter((a) => a.tipo === 'pendente');

    intensivas.sort((a, b) => (a.dataInicio || '').localeCompare(b.dataInicio || ''));
    regular.sort((a, b) => (a.disciplina || '').localeCompare(b.disciplina || ''));

    const appendSeparator = (label) => {
        const tr = document.createElement('tr');
        tr.className = 'month-sep';
        tr.innerHTML = `<td colspan="7">${label}</td>`;
        tbody.appendChild(tr);
    };

    const appendMonthSeparator = (monthKey) => {
        const [y, m] = monthKey.split('-').map((n) => parseInt(n, 10));
        const nomeMes = new Date(y, m - 1, 2).toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
        appendSeparator(nomeMes.toUpperCase());
    };

    const blockedWeekdays = getBlockedWeekdaysForTurma(store.selectedTurma);
    let currentMonth = null;

    const appendRow = (a) => {
        const tr = document.createElement('tr');
        const info = getDisciplinaInfo(a.disciplina);
        const chMax = a.ch || info.ch;
        let totalHoras = 0, details = '';
        const start = a.dataInicio || semestreInicio;
        const end = a.dataFim || semestreFim;

        if (a.tipo === 'pendente') {
            details = `Aguardando grade`;
        } else if (a.tipo === 'regular' || a.tipo === 'regular_prioritaria') {
            const suspended = getSuspendedDates(store.allocations, a.turmaId, a.diaSemana, a.disciplina, start);
            const numAulasBase = countWeekdaysInPeriod(start, end, parseInt(a.diaSemana), feriados, suspended);

            // Subtrair slots fantasmas do último dia se limitamos a carga matemática
            // Cada dia base na lista vale 1 slot. Precisamos achar quantos slots esse bloco tem hoje.
            const slotsDesseDia = store.allocations.filter(all => String(all.turmaId) === String(a.turmaId) && all.disciplina === a.disciplina && parseInt(all.diaSemana) === parseInt(a.diaSemana)).length;

            totalHoras = numAulasBase * 1;

            if (a.horariosUltimoDia && a.horariosUltimoDia.length > 0 && slotsDesseDia > 0) {
                // Se no último dia o sistema cortou slots pra não estourar, a gente compensa na UI visual subtraindo
                // o que não foi dado se for o loop responsável pelo fim do slot.
                const removedSlots = slotsDesseDia - a.horariosUltimoDia.length;
                // O ui.js chama na DOM 1 linha inteira por slot, então totalHoras de cada 'linha visual' 
                // representa 1 hora diária para numAulasBase. Se esse for o slot cortado, ele reduz sua cota.
                if (!a.horariosUltimoDia.includes(a.horario) && numAulasBase > 0) {
                    totalHoras -= 1;
                }
            }

            details = `${numAulasBase} semanas`;
        } else {
            // CÁLCULO DINÂMICO DE HORAS (INTENSIVA): 
            // Varre o período e soma slots reais, respeitando suspensões por Prioritárias.
            let totalHorasIntensiva = 0;
            let current = new Date(start + 'T12:00:00');
            const endObj = new Date(end + 'T12:00:00');
            const feriadosSet = new Set(feriados.map(f => (f.data || f)));
            const slots = a.horariosOcupados || [];
            const priorityRegulars = list.filter(p => p.tipo === 'regular_prioritaria');

            let dayCount = 0;
            while (current <= endObj) {
                const dStr = current.toISOString().split('T')[0];
                const dow = current.getDay();

                // Verifica utilidade básica do dia
                let isBus = true;
                if (dow === 0) isBus = false;
                if (dow === 6 && !a.usaSabado) isBus = false;
                if (feriadosSet.has(dStr)) isBus = false;

                if (isBus) {
                    const activePrioToday = priorityRegulars.filter(p => {
                        if (parseInt(p.diaSemana) !== dow) return false;
                        const pS = p.dataInicio || store.settings.termStart;
                        const pE = p.dataFim || store.settings.termEnd;
                        return dStr >= pS && dStr <= pE;
                    });

                    // Quais slots da intensiva estão livres hoje?
                    const availableSlots = slots.filter(s => !activePrioToday.some(p => p.horario === s));

                    if (availableSlots.length > 0 && totalHorasIntensiva < chMax) {
                        dayCount++;
                        const diff = chMax - totalHorasIntensiva;
                        if (dStr === end && a.horariosUltimoDia && a.horariosUltimoDia.length > 0) {
                            totalHorasIntensiva += Math.min(a.horariosUltimoDia.length, diff);
                        } else {
                            totalHorasIntensiva += Math.min(availableSlots.length, diff);
                        }
                    }
                }
                current.setDate(current.getDate() + 1);
            }

            totalHoras = totalHorasIntensiva;
            details = `${dayCount} dias`;
        }

        let color = '#2c3e50';
        if (chMax > 0) {
            if (totalHoras < chMax) color = '#d35400';
            if (totalHoras === chMax) color = '#27ae60';
            if (totalHoras > chMax) color = '#c0392b';
        }

        const allocsDaDisciplina = store.allocations.filter(x => String(x.turmaId) === String(a.turmaId) && x.disciplina === a.disciplina && x.tipo !== 'pendente');
        const sigaaCode = allocsDaDisciplina.length > 0 ? getSigaaCode(allocsDaDisciplina) : '-';

        let btnCopySigaa = '';
        if (sigaaCode !== '-') {
            btnCopySigaa = `
            <div style="display:flex; align-items:center; justify-content:center; gap:6px;">
                <span style="font-family:monospace; font-weight:bold; background:#ecf0f1; padding:2px 6px; border-radius:4px; font-size:0.9em; letter-spacing:1px;" id="sigaa-${a.id}">${sigaaCode}</span>
                <button class="btn-sigaa-copy" data-code="${sigaaCode}" title="Copiar Código" style="background:transparent; color:var(--primary); border:1px solid #ccc; border-radius:4px; cursor:pointer; padding:2px 6px; font-size:0.9em; transition: all 0.2s;">📋</button>
            </div>`;
        } else {
            btnCopySigaa = `<span style="color:#999;">-</span>`;
        }

        const sabadoLabel = a.usaSabado ? `<br><span style="color:#e67e22; font-weight:bold; font-size:0.8em;">(Inclui Sábados)</span>` : '';
        const chInfo = a.tipo === 'pendente' ? `<span style="color:#7f8c8d;">--- / ${chMax}h</span>` : `<b style="color:${color}">${totalHoras}</b> / ${chMax}h <small>(${details})</small>${sabadoLabel}`;

        let labelTipo = a.tipo;
        if (a.tipo === 'regular_prioritaria') labelTipo = '<b>Regular (Prioritária)</b>';
        if (a.tipo === 'pendente') labelTipo = '<span style="background:#f1c40f; color:#000; padding:2px 6px; border-radius:4px; font-size:0.85em; font-weight:bold;">Pendente</span>';

        let horarioTxt = '';
        if (a.tipo === 'pendente') {
            horarioTxt = '<span style="color:#e67e22; font-style:italic; font-weight:bold;">Sem horário definido</span>';
        } else {
            let endFmt = formatDateBR(end);
            if (store.settings.termEnd && end > store.settings.termEnd) {
                endFmt = `<span style="color:#c0392b; font-weight:bold; font-size:1.1em;" title="Atenção: Esta data ultrapassa o fim oficial do semestre!">⚠️ ${endFmt}</span>`;
            }
            horarioTxt = `${formatDateBR(start)} a ${endFmt}<br><small>${['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'][a.diaSemana] || 'Int.'} ${a.horario || ''}</small>`;
        }

        let btnHtml = `<button class="btn-danger btn-delete-row" style="padding:4px 8px; margin:0; font-size:0.85em; border-radius:3px; cursor:pointer;" title="Excluir">🗑️ Excluir</button>`;
        btnHtml = `<button class="btn-primary btn-edit-row" style="padding:4px 8px; margin:0; font-size:0.85em; background-color:#2980b9; border:none; color:white; border-radius:3px; cursor:pointer; margin-right:5px;" title="Editar">✏️ Editar</button>` + btnHtml;

        tr.innerHTML = `
            <td>${a.disciplina}</td>
            <td>${a.docente}</td>
            <td>${labelTipo}</td>
            <td>${horarioTxt}</td>
            <td style="text-align:center;">${chInfo}</td>
            <td style="text-align:center;">${btnCopySigaa}</td>
            <td style="white-space:nowrap;"><div style="display:flex; justify-content:center;">${btnHtml}</div></td>
        `;

        const copyBtn = tr.querySelector('.btn-sigaa-copy');
        if (copyBtn) {
            copyBtn.onclick = async (e) => {
                const btn = e.currentTarget;
                const textToCopy = btn.dataset.code;
                const origHtml = btn.innerHTML;
                const origBg = btn.style.backgroundColor;
                const origColor = btn.style.color;
                const origBorder = btn.style.borderColor;

                try {
                    if (navigator.clipboard && window.isSecureContext) {
                        await navigator.clipboard.writeText(textToCopy);
                    } else {
                        const textArea = document.createElement("textarea");
                        textArea.value = textToCopy;
                        textArea.style.position = "fixed";
                        textArea.style.opacity = "0";
                        document.body.appendChild(textArea);
                        textArea.select();
                        document.execCommand("copy");
                        document.body.removeChild(textArea);
                    }

                    btn.innerHTML = '✅ Copiado';
                    btn.style.backgroundColor = '#27ae60';
                    btn.style.color = '#ffffff';
                    btn.style.borderColor = '#27ae60';

                    setTimeout(() => {
                        btn.innerHTML = origHtml;
                        btn.style.backgroundColor = origBg;
                        btn.style.color = origColor;
                        btn.style.borderColor = origBorder;
                    }, 2000);
                } catch (err) {
                    console.error('Falha ao copiar', err);
                }
            };
        }

        tr.querySelector('.btn-delete-row').onclick = () => {
            if (confirm('Remover esta oferta?')) {
                store.removeAllocation(a.id);
                syncAllRegularDates();
                syncAllIntensiveDates();
                renderWeeklyGrid();
                renderOfertasList();
            }
        };

        const btnEdit = tr.querySelector('.btn-edit-row');
        if (btnEdit) {
            btnEdit.onclick = () => {
                if (confirm('Carregar para edição? A oferta antiga será removida e você deverá clicar na grade para posicioná-la.')) {
                    if (inputConfig.disciplina) {
                        inputConfig.disciplina.value = `${a.disciplina} (${info.ch}h)`;
                        inputConfig.disciplina.dispatchEvent(new Event('input'));
                    }
                    if (inputConfig.cor && a.cor) {
                        inputConfig.cor.value = a.cor;
                        setTimeout(() => { inputConfig.cor.value = a.cor; }, 50);
                    }
                    if (inputConfig.tipo) {
                        inputConfig.tipo.value = a.tipo === 'pendente' ? 'regular' : a.tipo;
                        inputConfig.tipo.dispatchEvent(new Event('change'));
                    }
                    if (inputConfig.inicio && a.dataInicio) {
                        inputConfig.inicio.value = a.dataInicio;
                    }

                    if (a.tipo === 'intensiva') {
                        const chkSabado = document.getElementById('chk-sabados');
                        if (chkSabado) chkSabado.checked = !!a.usaSabado;
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
                            a.docentes.forEach(d => {
                                addTeacherRow(d.nome, d.ch);
                            });
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

                    if (a.horariosOcupados) {
                        const containerSlots = document.getElementById('slots-checkboxes');
                        if (containerSlots) {
                            containerSlots.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                                cb.checked = a.horariosOcupados.includes(cb.value);
                            });
                        }
                    }

                    store.removeAllocation(a.id);
                    syncAllRegularDates();
                    renderWeeklyGrid();
                    renderOfertasList();
                    if (a.tipo !== 'intensiva') switchTab('weekly');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }
            };
        }
        tbody.appendChild(tr);
    };

    intensivas.forEach((a) => {
        const monthKey = a.dataInicio ? a.dataInicio.substring(0, 7) : '';
        if (monthKey && monthKey !== currentMonth) {
            appendMonthSeparator(monthKey);
            currentMonth = monthKey;
        }
        if (!monthKey && currentMonth !== 'SEM DATA') {
            appendSeparator('SEM DATA');
            currentMonth = 'SEM DATA';
        }
        appendRow(a);
    });

    if (regular.length > 0) {
        appendSeparator('AULAS REGULARES (E PRIORITÁRIAS)');
        regular.forEach(appendRow);
    }

    if (pendentes.length > 0) {
        appendSeparator('AGUARDANDO ALOCAÇÃO NA GRADE (PENDENTES)');
        pendentes.forEach(appendRow);
    }

    if (intensivas.length === 0 && regular.length === 0 && pendentes.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="7" style="text-align:center; color:#666;">Nenhuma oferta cadastrada.</td>`;
        tbody.appendChild(tr);
    }
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

    let turmaLabel = store.selectedTurma;
    if (store.rawData?.turmas) {
        const t = store.rawData.turmas.find((x) => String(x.turma_id) === String(store.selectedTurma));
        if (t) turmaLabel = t.turma_label;
    }

    const title = `<span class="print-title-main">Calendário Acadêmico</span><br><span class="print-title-sub">${turmaLabel}</span>`;
    generateCalendarGrid(container, store.selectedTurma, null, start, end, title);
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

    const totalCH = calculateTeacherTotalCH(docente);
    const docenteTitle = totalCH > 0 ? `${docente} (${totalCH}h)` : docente;
    const title = `<span class="print-title-main">Cronograma Docente</span><br><span class="print-title-sub">${docenteTitle}</span>`;
    generateCalendarGrid(container, null, docente, start, end, title);
}

function getShiftTimeRangeStr(timeRanges, shiftCode) {
    if (!timeRanges || timeRanges.length === 0) return '';
    const times = [];

    timeRanges.forEach(tr => {
        if (!tr) return;
        const matches = String(tr).match(/\d{1,2}:\d{2}/g);
        if (matches) times.push(...matches);
    });

    const filteredTimes = times.filter(t => {
        const m = timeToMinutes(t);
        return shiftCode === 'M' ? m < 780 : m >= 780;
    });

    if (filteredTimes.length === 0) return '';

    filteredTimes.sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
    return ` : ${filteredTimes[0]} - ${filteredTimes[filteredTimes.length - 1]}`;
}


function renderGanttChart() {
    const container = document.getElementById('gantt-container');
    const inputDocente = document.getElementById('inp-gantt-docente');
    if (!container || !inputDocente) return;

    const docenteName = inputDocente.value.trim();
    if (!docenteName) {
        container.innerHTML = '<div style="text-align: center; color: #7f8c8d; margin-top: 50px; font-size: 1.1em;">Por favor, digite o nome de um professor.</div>';
        return;
    }

    const allocs = store.allocations.filter(a => {
        if (a.docente === docenteName) return true;
        if (a.docentes && a.docentes.some(d => d.nome === docenteName)) return true;
        return false;
    });

    if (allocs.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: #7f8c8d; margin-top: 50px; font-size: 1.1em;">Nenhuma disciplina encontrada para <b>${docenteName}</b>.</div>`;
        return;
    }

    const totalCH = calculateTeacherTotalCH(docenteName);

    let minDateStr = store.settings.termStart || '2025-01-01';
    let maxDateStr = store.settings.termEnd || '2025-12-31';

    allocs.forEach(a => {
        if (a.dataInicio && a.dataInicio < minDateStr) minDateStr = a.dataInicio;
        if (a.dataFim && a.dataFim > maxDateStr) maxDateStr = a.dataFim;
    });

    const minTime = new Date(minDateStr + "T12:00:00").getTime();
    const maxTime = new Date(maxDateStr + "T12:00:00").getTime();
    const totalTime = maxTime - minTime || 1;

    const weekLines = [];
    let weekWalker = new Date(minTime);
    while (weekWalker.getDay() !== 1) {
        weekWalker.setDate(weekWalker.getDate() + 1);
    }

    while (weekWalker.getTime() <= maxTime) {
        let leftPct = ((weekWalker.getTime() - minTime) / totalTime) * 100;
        if (leftPct >= 0 && leftPct <= 100) {
            weekLines.push(leftPct);
        }
        weekWalker.setDate(weekWalker.getDate() + 7);
    }
    const timelineLinesHtml = weekLines.map(pct => `<div class="gantt-grid-line-week" style="left: ${pct}%;"></div>`).join('');

    const monthLines = [];
    let curMonthWalker = new Date(minTime);
    curMonthWalker.setDate(1);

    while (curMonthWalker.getTime() <= maxTime) {
        if (curMonthWalker.getTime() >= minTime) {
            let leftPct = ((curMonthWalker.getTime() - minTime) / totalTime) * 100;
            if (leftPct > 0.1) {
                monthLines.push(leftPct);
            }
        }
        curMonthWalker = new Date(curMonthWalker.getFullYear(), curMonthWalker.getMonth() + 1, 1, 12, 0, 0);
    }

    const monthOverlaysHtml = monthLines.map(pct => `
        <div style="position: absolute; left: ${pct}%; top: 0; bottom: 0; border-left: 2px solid #2c3e50; z-index: 10; pointer-events: none;"></div>
    `).join('');

    let html = `
        <div style="margin-bottom: 20px; text-align: center;">
            <h3 style="color: var(--primary); margin: 0; font-size: 1.4em; text-transform: uppercase;">Cronograma: ${docenteName} (${totalCH}h)</h3>
        </div>
        
        <div class="gantt-container" style="position: relative; border: 1px solid #ddd; border-radius: 6px; overflow: hidden; background: #f0f3f5;">
            
            <div style="position: absolute; top: 0; bottom: 0; left: 80px; right: 0; pointer-events: none; z-index: 0;">
                ${timelineLinesHtml}
            </div>

            <div style="position: absolute; top: 0; bottom: 0; left: 80px; right: 0; pointer-events: none; z-index: 10;">
                ${monthOverlaysHtml}
            </div>
    `;

    html += '<div class="gantt-header-row" style="display: flex; border-bottom: 2px solid var(--primary); padding: 10px 0; background: #e2e8f0; margin: 0; position: relative; z-index: 6;">';
    html += '<div style="width: 80px; flex-shrink: 0;"></div>';

    html += '<div style="flex: 1; display: flex; position: relative;">';

    let cur = new Date(minTime);
    cur.setDate(1);

    while (cur.getTime() <= maxTime || (cur.getFullYear() === new Date(maxTime).getFullYear() && cur.getMonth() === new Date(maxTime).getMonth())) {
        let nomeCurto = cur.toLocaleString('pt-BR', { month: 'short' }).replace('.', '');
        const mesNome = nomeCurto.charAt(0).toUpperCase() + nomeCurto.slice(1) + '/' + String(cur.getFullYear()).slice(-2);

        let startOfMonth = Math.max(cur.getTime(), minTime);
        let nextM = new Date(cur.getFullYear(), cur.getMonth() + 1, 1, 12, 0, 0);
        let endOfMonth = Math.min(nextM.getTime() - 1, maxTime);
        let wPct = ((endOfMonth - startOfMonth) / totalTime) * 100;

        if (wPct > 0) {
            html += `<div class="gantt-month-col" style="width: ${wPct}%; flex: none; background: transparent; text-align: center; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 1.1em; color: var(--primary); border: none;">${mesNome}</div>`;
        }
        cur = nextM;
    }
    html += '</div></div>';

    const weekDays = [
        { id: 1, name: 'SEG' },
        { id: 2, name: 'TER' },
        { id: 3, name: 'QUA' },
        { id: 4, name: 'QUI' },
        { id: 5, name: 'SEX' },
        { id: 6, name: 'SÁB' }
    ];

    weekDays.forEach(d => {
        let dayItemsMap = {};

        allocs.forEach(a => {
            let add = false;
            let shift = '';
            let slotsToAdd = 1;

            if (a.tipo === 'regular' || a.tipo === 'regular_prioritaria') {
                if (parseInt(a.diaSemana) === d.id) {
                    add = true;
                    shift = timeToMinutes(a.horario) < 780 ? 'M' : 'T';
                    slotsToAdd = 1;
                }
            }
            else if (a.tipo === 'intensiva') {
                let curDt = new Date((a.dataInicio || minDateStr) + "T12:00:00");
                const endDt = new Date((a.dataFim || maxDateStr) + "T12:00:00");
                let hasThisDay = false;

                while (curDt <= endDt) {
                    if (curDt.getDay() === d.id) {
                        hasThisDay = true;
                        break;
                    }
                    curDt.setDate(curDt.getDate() + 1);
                }

                if (hasThisDay) {
                    add = true;
                    const occs = a.horariosOcupados || [];
                    const isM = occs.some(h => timeToMinutes(h) < 780);
                    const isT = occs.some(h => timeToMinutes(h) >= 780);
                    shift = (isM && isT) ? 'M/T' : (isM ? 'M' : 'T');
                    slotsToAdd = occs.length > 0 ? occs.length : 5;
                }
            }

            if (add) {
                const key = `${a.turmaId}|${a.disciplina}|${shift}|${a.tipo}`;
                if (!dayItemsMap[key]) {
                    let chProf = 0;
                    const chTotal = getDisciplinaCHGlobal(a.disciplina, a.turmaId);
                    if (a.docentes && a.docentes.length > 0) {
                        const doc = a.docentes.find(doc => doc.nome === docenteName);
                        if (doc) chProf = parseInt(doc.ch) || 0;
                    } else {
                        chProf = chTotal;
                    }

                    dayItemsMap[key] = {
                        ...a,
                        shift: shift,
                        chTotal: chTotal,
                        chProf: chProf,
                        dataInicio: a.dataInicio || minDateStr,
                        dataFim: a.dataFim || maxDateStr,
                        slotCount: slotsToAdd,
                        timeRanges: a.tipo === 'intensiva' ? [...(a.horariosOcupados || [])] : [a.horario]
                    };
                } else {
                    if (a.tipo !== 'intensiva') {
                        dayItemsMap[key].slotCount += slotsToAdd;
                    }
                    if (a.dataInicio && a.dataInicio < dayItemsMap[key].dataInicio) {
                        dayItemsMap[key].dataInicio = a.dataInicio;
                    }
                    if (a.dataFim && a.dataFim > dayItemsMap[key].dataFim) {
                        dayItemsMap[key].dataFim = a.dataFim;
                    }

                    if (a.tipo === 'intensiva') {
                        dayItemsMap[key].timeRanges.push(...(a.horariosOcupados || []));
                    } else {
                        dayItemsMap[key].timeRanges.push(a.horario);
                    }
                }
            }
        });

        let dayItems = Object.values(dayItemsMap);

        let mItems = dayItems.filter(i => i.shift === 'M' || i.shift === 'M/T');
        let tItems = dayItems.filter(i => i.shift === 'T' || i.shift === 'M/T');

        let currentTopM = 4;
        let mBarsHtml = '';

        mItems.forEach((item) => {
            const startT = new Date(item.dataInicio + "T12:00:00").getTime();
            const endT = new Date(item.dataFim + "T12:00:00").getTime();
            const timeSpan = endT - startT;
            let leftPct = ((startT - minTime) / totalTime) * 100;
            let widthPct = (timeSpan / totalTime) * 100;
            if (leftPct < 0) leftPct = 0;
            if (widthPct < 1) widthPct = 1;

            const turmaNome = getTurmaLabel(item.turmaId);
            const info = getDisciplinaInfo(item.disciplina);
            const isOutOfBounds = store.settings.termEnd && item.dataFim > store.settings.termEnd;
            let boxBorder = isOutOfBounds ? 'border: 2px solid #900;' : `border: 1px solid ${item.cor || '#ccc'};`;

            let barHeight = 24;
            if (item.tipo !== 'intensiva') {
                let cappedSlots = Math.min(item.slotCount, 5);
                barHeight = 24 + ((cappedSlots - 1) * 8);
            }

            const timeRangeStr = getShiftTimeRangeStr(item.timeRanges, 'M');

            let segmentsHtml = '';
            let externalLabelsHtml = '';
            let currentSegmentT = startT;
            const docentesList = (item.docentes && item.docentes.length > 0) ? item.docentes : [{ nome: item.docente, ch: item.chTotal }];

            docentesList.forEach((d, idx) => {
                const isTarget = d.nome === docenteName;
                let segStartT = currentSegmentT;
                let segEndT = currentSegmentT + (timeSpan * (d.ch / item.chTotal));
                let sDate = new Date(segStartT).toISOString().split('T')[0];
                let eDate = new Date(segEndT).toISOString().split('T')[0];

                if (idx === 0) sDate = item.dataInicio;
                if (idx === docentesList.length - 1) eDate = item.dataFim;

                const fmtStart = sDate.split('-').reverse().slice(0, 2).join('/');
                const fmtEnd = eDate.split('-').reverse().slice(0, 2).join('/');

                const bgColor = isTarget ? (item.cor || '#3498db') : '#ffffff';
                const txtColor = isTarget ? '#000000' : '#666666';
                const borderStyle = isTarget ? 'none' : `1px dashed ${item.cor || '#ccc'}`;
                const zIndex = isTarget ? '2' : '1';

                let content = '';

                if (item.tipo === 'intensiva') {
                    if (isTarget) {
                        content = `<span style="font-size:0.75em; font-weight:800; letter-spacing:-0.5px; padding:0 2px;">${fmtStart} - ${fmtEnd}</span>`;

                        let textPos = (leftPct + widthPct > 75)
                            ? `right: calc(100% - ${leftPct}% + 6px);`
                            : `left: calc(${leftPct + widthPct}% + 6px);`;

                        let textColor = item.cor || '#3498db';
                        externalLabelsHtml += `
                            <div style="position: absolute; top: ${currentTopM}px; height: ${barHeight}px; display: flex; align-items: center; ${textPos} color: ${textColor}; font-weight: 900; font-size: 0.85em; white-space: nowrap; z-index: 10; text-shadow: 1px 1px 0px #fff, -1px -1px 0px #fff, 1px -1px 0px #fff, -1px 1px 0px #fff, 0px 2px 4px rgba(0,0,0,0.15);">
                                ${turmaNome} ${info.abrev} (${d.ch}h)
                            </div>
                        `;
                    } else {
                        content = `
                            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; gap:1px;">
                                <span style="font-size:1em; font-weight:900; color:${item.cor || '#aaa'}; opacity:0.6; line-height:1;">✕</span>
                                <span style="font-size:0.65em; font-weight:normal; opacity:0.6; letter-spacing:-0.3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:90%;">${d.nome.split(' ')[0]}</span>
                            </div>
                        `;
                    }
                } else {
                    if (isTarget) {
                        content = `
                            <div style="display:flex; justify-content:space-between; align-items:center; width:100%; padding:0 2px;">
                                <span style="font-size:0.7em; opacity:0.9; flex-shrink:0; letter-spacing: -0.5px;">${fmtStart}</span>
                                <span style="font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; padding:0 4px; font-size: 0.8em; letter-spacing: -0.4px;">
                                    ${turmaNome} ${info.abrev} (${d.ch}h)${timeRangeStr}
                                </span>
                                <span style="font-size:0.7em; opacity:0.9; flex-shrink:0; letter-spacing: -0.5px;">${fmtEnd}</span>
                            </div>
                        `;
                    } else {
                        content = `
                            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; gap:1px;">
                                <span style="font-size:1em; font-weight:900; color:${item.cor || '#aaa'}; opacity:0.6; line-height:1;">✕</span>
                                <span style="font-size:0.65em; font-weight:normal; opacity:0.6; letter-spacing:-0.3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:90%;">${d.nome.split(' ')[0]} (${d.ch}h)</span>
                            </div>
                        `;
                    }
                }

                segmentsHtml += `
                    <div style="flex: ${d.ch}; background-color: ${bgColor}; color: ${txtColor}; border-right: ${borderStyle}; border-left: ${borderStyle}; height: 100%; display: flex; align-items: center; justify-content: center; overflow: hidden; box-sizing: border-box; z-index: ${zIndex};">
                        ${content}
                    </div>
                `;
                currentSegmentT = segEndT;
            });

            mBarsHtml += `
                    <div class="gantt-bar" 
                         style="left: ${leftPct}%; width: ${widthPct}%; top: ${currentTopM}px; height: ${barHeight}px; padding: 0; display: flex; flex-direction: row; ${boxBorder}"
                         title="${item.disciplina}\nTurma: ${turmaNome}\nTurno: Manhã\nPeríodo Geral: ${formatDateBR(item.dataInicio)} a ${formatDateBR(item.dataFim)}\nAulas no Dia: ${item.slotCount}">
                        ${segmentsHtml}
                    </div>
                    ${externalLabelsHtml}
            `;
            currentTopM += barHeight + 6;
        });

        const laneMHeight = Math.max(30, currentTopM);

        let currentTopT = 4;
        let tBarsHtml = '';

        tItems.forEach((item) => {
            const startT = new Date(item.dataInicio + "T12:00:00").getTime();
            const endT = new Date(item.dataFim + "T12:00:00").getTime();
            const timeSpan = endT - startT;
            let leftPct = ((startT - minTime) / totalTime) * 100;
            let widthPct = (timeSpan / totalTime) * 100;
            if (leftPct < 0) leftPct = 0;
            if (widthPct < 1) widthPct = 1;

            const turmaNome = getTurmaLabel(item.turmaId);
            const info = getDisciplinaInfo(item.disciplina);
            const isOutOfBounds = store.settings.termEnd && item.dataFim > store.settings.termEnd;
            let boxBorder = isOutOfBounds ? 'border: 2px solid #900;' : `border: 1px solid ${item.cor || '#ccc'};`;

            let barHeight = 24;
            if (item.tipo !== 'intensiva') {
                let cappedSlots = Math.min(item.slotCount, 5);
                barHeight = 24 + ((cappedSlots - 1) * 8);
            }

            const timeRangeStr = getShiftTimeRangeStr(item.timeRanges, 'T');

            let segmentsHtml = '';
            let externalLabelsHtml = '';
            let currentSegmentT = startT;
            const docentesList = (item.docentes && item.docentes.length > 0) ? item.docentes : [{ nome: item.docente, ch: item.chTotal }];

            docentesList.forEach((d, idx) => {
                const isTarget = d.nome === docenteName;
                let segStartT = currentSegmentT;
                let segEndT = currentSegmentT + (timeSpan * (d.ch / item.chTotal));
                let sDate = new Date(segStartT).toISOString().split('T')[0];
                let eDate = new Date(segEndT).toISOString().split('T')[0];

                if (idx === 0) sDate = item.dataInicio;
                if (idx === docentesList.length - 1) eDate = item.dataFim;

                const fmtStart = sDate.split('-').reverse().slice(0, 2).join('/');
                const fmtEnd = eDate.split('-').reverse().slice(0, 2).join('/');

                const bgColor = isTarget ? (item.cor || '#3498db') : '#ffffff';
                const txtColor = isTarget ? '#000000' : '#666666';
                const borderStyle = isTarget ? 'none' : `1px dashed ${item.cor || '#ccc'}`;
                const zIndex = isTarget ? '2' : '1';

                let content = '';

                if (item.tipo === 'intensiva') {
                    if (isTarget) {
                        content = `<span style="font-size:0.75em; font-weight:800; letter-spacing:-0.5px; padding:0 2px;">${fmtStart} - ${fmtEnd}</span>`;

                        let textPos = (leftPct + widthPct > 75)
                            ? `right: calc(100% - ${leftPct}% + 6px);`
                            : `left: calc(${leftPct + widthPct}% + 6px);`;

                        let textColor = item.cor || '#3498db';
                        externalLabelsHtml += `
                            <div style="position: absolute; top: ${currentTopT}px; height: ${barHeight}px; display: flex; align-items: center; ${textPos} color: ${textColor}; font-weight: 900; font-size: 0.85em; white-space: nowrap; z-index: 10; text-shadow: 1px 1px 0px #fff, -1px -1px 0px #fff, 1px -1px 0px #fff, -1px 1px 0px #fff, 0px 2px 4px rgba(0,0,0,0.15);">
                                ${turmaNome} ${info.abrev} (${d.ch}h)
                            </div>
                        `;
                    } else {
                        content = `<span style="font-size:0.85em; font-weight:normal; opacity:0.8">${d.nome.split(' ')[0]}</span>`;
                    }
                } else {
                    if (isTarget) {
                        content = `
                            <div style="display:flex; justify-content:space-between; align-items:center; width:100%; padding:0 2px;">
                                <span style="font-size:0.7em; opacity:0.9; flex-shrink:0; letter-spacing: -0.5px;">${fmtStart}</span>
                                <span style="font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; padding:0 4px; font-size: 0.8em; letter-spacing: -0.4px;">
                                    ${turmaNome} ${info.abrev} (${d.ch}h)${timeRangeStr}
                                </span>
                                <span style="font-size:0.7em; opacity:0.9; flex-shrink:0; letter-spacing: -0.5px;">${fmtEnd}</span>
                            </div>
                        `;
                    } else {
                        content = `<span style="font-size:0.8em; font-weight:normal; opacity:0.8; letter-spacing: -0.3px;">${d.nome.split(' ')[0]} (${d.ch}h)</span>`;
                    }
                }

                segmentsHtml += `
                    <div style="flex: ${d.ch}; background-color: ${bgColor}; color: ${txtColor}; border-right: ${borderStyle}; border-left: ${borderStyle}; height: 100%; display: flex; align-items: center; justify-content: center; overflow: hidden; box-sizing: border-box; z-index: ${zIndex};">
                        ${content}
                    </div>
                `;
                currentSegmentT = segEndT;
            });

            tBarsHtml += `
                    <div class="gantt-bar" 
                         style="left: ${leftPct}%; width: ${widthPct}%; top: ${currentTopT}px; height: ${barHeight}px; padding: 0; display: flex; flex-direction: row; ${boxBorder}"
                         title="${item.disciplina}\nTurma: ${turmaNome}\nTurno: Tarde\nPeríodo Geral: ${formatDateBR(item.dataInicio)} a ${formatDateBR(item.dataFim)}\nAulas no Dia: ${item.slotCount}">
                        ${segmentsHtml}
                    </div>
                    ${externalLabelsHtml}
            `;
            currentTopT += barHeight + 6;
        });

        const laneTHeight = Math.max(30, currentTopT);
        const totalRowHeight = laneMHeight + laneTHeight;

        html += `
            <div class="gantt-row" style="display: flex; border-bottom: 1px solid #2c3e50; margin: 0; padding: 0; min-height: ${totalRowHeight}px; position: relative; z-index: 1;">
                <div style="width: 50px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.9em; color: var(--primary); background: #e2e8f0; border-right: 1px solid #cbd5e1; flex-shrink: 0;">
                    ${d.name}
                </div>
                <div style="flex: 1; display: flex; flex-direction: column;">
                    
                    <div style="display: flex; height: ${laneMHeight}px; border-bottom: 2px dashed #cbd5e1; position: relative;">
                        <div style="width: 30px; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 0.8em; color: #64748b; border-right: 1px solid #cbd5e1; background: #e2e8f0; flex-shrink: 0;">
                            M
                        </div>
                        <div class="gantt-timeline" style="flex: 1; position: relative; background: transparent; border: none;">
                            ${mBarsHtml}
                        </div>
                    </div>

                    <div style="display: flex; height: ${laneTHeight}px; position: relative;">
                        <div style="width: 30px; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 0.8em; color: #64748b; border-right: 1px solid #cbd5e1; background: #e2e8f0; flex-shrink: 0;">
                            T
                        </div>
                        <div class="gantt-timeline" style="flex: 1; position: relative; background: transparent; border: none;">
                            ${tBarsHtml}
                        </div>
                    </div>

                </div>
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;
}

// ==== NOVO MOTOR: AUDITORIA GLOBAL DE PROFESSORES ====
function detectGlobalTeacherConflicts() {
    const conflicts = new Set();
    const allocs = store.allocations;

    function getInvolvedTeachers(alloc) {
        if (alloc.docentes && alloc.docentes.length > 0) return alloc.docentes.map(d => d.nome).filter(n => n && n.toUpperCase() !== 'A DEFINIR');
        if (alloc.docente && alloc.docente.toUpperCase() !== 'A DEFINIR') return [alloc.docente];
        return [];
    }

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

            let isSlotConflict = false;

            if (a.tipo !== 'intensiva' && b.tipo !== 'intensiva') {
                if (parseInt(a.diaSemana) === parseInt(b.diaSemana) && a.horario === b.horario) isSlotConflict = true;
            } else if (a.tipo === 'intensiva' && b.tipo === 'intensiva') {
                if (a.horariosOcupados && b.horariosOcupados) {
                    isSlotConflict = a.horariosOcupados.some(h => b.horariosOcupados.includes(h));
                }
            } else {
                const intAlloc = a.tipo === 'intensiva' ? a : b;
                const regAlloc = a.tipo === 'intensiva' ? b : a;
                const regDay = parseInt(regAlloc.diaSemana);

                const isIntDayActive = (regDay >= 1 && regDay <= 5) || (regDay === 6 && intAlloc.usaSabado);

                if (isIntDayActive && intAlloc.horariosOcupados && intAlloc.horariosOcupados.includes(regAlloc.horario)) {
                    isSlotConflict = true;
                }
            }

            if (isSlotConflict) {
                sharedTeachers.forEach(t => conflicts.add(t));
            }
        }
    }
    return Array.from(conflicts);
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

    const conflictingTeachers = detectGlobalTeacherConflicts();

    if (conflictingTeachers.length > 0) {
        warningDiv.innerHTML = `
            <div style="background-color: #e74c3c; color: white; padding: 15px; border-radius: 6px; margin-bottom: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <h4 style="margin: 0 0 10px 0; display: flex; align-items: center; gap: 8px;">
                    ⚠️ ALERTA: CONFLITO GLOBAL NA GRADE
                </h4>
                <p style="margin: 0; font-size: 0.95em; line-height: 1.4;">
                    Foi detectado que o(s) seguinte(s) professor(es) está(ão) alocado(s) em mais de uma disciplina no mesmo dia e horário:<br>
                    <b>${conflictingTeachers.join(', ')}</b><br><br>
                    <small><i>Selecione o professor abaixo para visualizar a grade e identificar o choque (o slot ficará destacado em vermelho escuro).</i></small>
                </p>
            </div>
        `;
        warningDiv.style.display = 'block';
    } else {
        warningDiv.style.display = 'none';
    }
}
// ========================================================

function generateCalendarGrid(container, turmaId, docenteName, start, end, titleHTML) {
    container.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'print-only print-header-container';
    header.innerHTML = titleHTML;
    container.appendChild(header);

    const eventsByDate = getCalendarEvents(turmaId, start, end, docenteName);

    let slotsToRender = [];

    if (turmaId) {
        slotsToRender = buildHorariosForUI();
    }
    else if (docenteName) {
        const hp = store.rawData?.horarios_por_turno || {};
        const skeleton = [];

        if (hp['Manhã']) skeleton.push(...hp['Manhã']);
        if (hp['Tarde']) skeleton.push(...hp['Tarde']);

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
                            if (e.horario && normalizeTime(e.horario) === slotTimeNorm) return true;

                            // NOVO: RESPEITA OS SLOTS LIMITADOS NO ÚLTIMO DIA DA INTENSIVA
                            if (e.tipo === 'intensiva' && e.dataFim === dayData.date && e.horariosUltimoDia) {
                                return e.horariosUltimoDia.some(h => normalizeTime(h) === slotTimeNorm);
                            }

                            if (e.horariosOcupados && e.horariosOcupados.some(h => normalizeTime(h) === slotTimeNorm)) return true;
                            return false;
                        });

                        let content = '';
                        let style = '';

                        if (isIntervalo) {
                            content = '<span style="color:#7f8c8d; font-style:italic; font-size:0.85em;">Intervalo</span>';
                            style = 'background:#e0e0e0;';
                        } else if (eventsInSlot.length > 0) {
                            const hasSpecificConflict = eventsInSlot.some(e => e.conflictsAt && e.conflictsAt.includes(slotTimeNorm));
                            const implicitConflict = eventsInSlot.length > 1;
                            const isSuspended = eventsInSlot.some((e) => e.type === 'suspended');

                            if (docenteName) {
                                if (hasSpecificConflict || implicitConflict) {
                                    style = 'background: #c0392b; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight:bold;';
                                    const conflictNames = eventsInSlot.map((e) => `${getDisciplinaInfo(e.disciplina).abrev} - ${e.turmaId}`).join(' <b style="color:#fff">x</b> ');
                                    content = `<span title="Choque: ${conflictNames.replace(/<[^>]+>/g, '')}">⚠️ ${conflictNames}</span>`;
                                } else if (isSuspended) {
                                    const suspendedEvent = eventsInSlot.find(e => e.type === 'suspended');
                                    const info = getDisciplinaInfo(suspendedEvent.disciplina);
                                    content = `⛔ ${info.abrev} - ${suspendedEvent.turmaId} Suspensa`;
                                } else {
                                    const event = eventsInSlot[0];
                                    const info = getDisciplinaInfo(event.disciplina);
                                    content = `${info.abrev} - ${event.turmaId}`;
                                    style = `background:${event.cor || '#bdc3c7'}; color:black;`;
                                }
                            } else {
                                const activeEvent = eventsInSlot.find(e => e.type !== 'suspended');
                                if (activeEvent) {
                                    const info = getDisciplinaInfo(activeEvent.disciplina);
                                    content = info.abrev;
                                    style = `background:${activeEvent.cor || '#bdc3c7'}; color:black;`;
                                } else {
                                    content = '&nbsp;';
                                    style = 'background: #ecf0f1;';
                                }
                            }

                            if (isOutOfBounds && !isSuspended) {
                                style = 'background: #c0392b !important; color: white !important; font-weight: bold; border: 1px solid #900 !important;';
                                if (!content.includes('⚠️')) {
                                    content = `⚠️ ${content}`;
                                }
                            }

                        } else {
                            content = '&nbsp;';
                            style = 'background: #ecf0f1;';
                        }

                        const hasSuspended = eventsInSlot.some(e => e.type === 'suspended');
                        const hasOverriding = eventsInSlot.some(e => (e.isIntensive || e.isPriority) && !docenteName);

                        let className = 'cal-slot-content';
                        if (hasSuspended && docenteName) className += ' suspended-slot';
                        if (hasOverriding) className += ' overriding-event';

                        let tooltip = '';
                        if (hasSuspended && docenteName) {
                            const suspEvent = eventsInSlot.find(e => e.type === 'suspended');
                            tooltip = `title="${suspEvent.blockingReason || 'Suspenso'}"`;
                        } else if (isOutOfBounds && eventsInSlot.length > 0 && !hasSuspended) {
                            tooltip = `title="ALERTA: Aula marcada fora do semestre letivo!"`;
                        }

                        let rowStyle = '';
                        if (slotTime.includes('13:30')) {
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

    // Atualiza o auditor de professores toda vez que a aba "teacher" for aberta
    if (tabId === 'teacher') {
        updateGlobalConflictsUI();
    }
}

export { renderWeeklyGrid, renderOfertasList, renderMonthlyCalendar, renderTeacherCalendar };