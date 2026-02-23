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

// ATUALIZAÇÃO: Suporte a alertas verdes amigáveis
function showToastWarning(message, type = 'error') {
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

    const duration = type === 'success' ? 4500 : 7000;
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
        btn.style.right = '10px';
        btn.style.top = inputEl.id === 'inp-gantt-docente' ? '50%' : '70%'; 
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

    if(containerMulti.querySelector('.teacher-row') === null) { 
        addTeacherRow(); 
    }

    chk.addEventListener('change', () => {
        if(chk.checked) {
            containerSingle.classList.add('hidden');
            containerMulti.classList.remove('hidden');
        } else {
            containerSingle.classList.remove('hidden');
            containerMulti.classList.add('hidden');
        }
    });

    btnAddRow.addEventListener('click', () => {
        const rows = containerMulti.querySelectorAll('.teacher-row');
        if(rows.length >= 4) { 
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
        if(list.querySelectorAll('.teacher-row').length > 1) {
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
            if(nome && ch > 0) { 
                list.push({ nome, ch }); 
                totalCH += ch; 
            }
        });
        
        if(list.length === 0) return { isValid: false };
        
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

// =====================================================================
// ATUALIZAÇÃO MÁGICA: Suspensão de Bloco no Cálculo Matemático
// =====================================================================
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
            
            // Pega TODOS os slots que essa Regular tem nesse dia
            const slotsToday = group.filter(a => parseInt(a.diaSemana) === dow);
            
            if (slotsToday.length > 0 && !feriadosSet.has(dStr)) {
                
                // MÁGICA: Se UMA intensiva trombar com QUALQUER slot de hoje, suspende o BLOCO TODO.
                const dayIsSuspended = store.allocations.some(other => {
                    if (String(other.turmaId) !== String(turmaId)) return false;
                    
                    const oStart = other.dataInicio || termStart;
                    const oEnd = other.dataFim || termEnd;
                    
                    if (dStr >= oStart && dStr <= oEnd) {
                        if (other.tipo === 'intensiva' && other.horariosOcupados) {
                            return slotsToday.some(slot => other.horariosOcupados.includes(slot.horario));
                        }
                        if (other.tipo === 'regular_prioritaria' && parseInt(other.diaSemana) === dow && other.disciplina !== disciplina) {
                            return slotsToday.some(slot => other.horario === slot.horario);
                        }
                    }
                    return false;
                });
                
                if (!dayIsSuspended) { 
                    // Soma TODOS os horários juntos, já que o bloco do dia inteiro está livre
                    classesFound += slotsToday.length; 
                    lastValidDate = new Date(currentDate); 
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

// =====================================================================
// ATUALIZAÇÃO MÁGICA: getSuspendedDates agora suporta a Suspensão em Bloco
// =====================================================================
function getSuspendedDates(allocs, turmaId, diaSemana, disciplina, startDate) {
    if (!startDate) return [];
    const suspended = [];
    
    // Lista todos os horários dessa mesma regular no dia da semana
    const mySlots = allocs
        .filter(a => String(a.turmaId) === String(turmaId) && a.disciplina === disciplina && parseInt(a.diaSemana) === parseInt(diaSemana) && (a.tipo === 'regular' || a.tipo === 'regular_prioritaria'))
        .map(a => a.horario);

    if (mySlots.length === 0) return [];
    
    let curDt = new Date(startDate + "T12:00:00");
    for (let i = 0; i < 365; i++) {
        if (curDt.getDay() === parseInt(diaSemana)) {
            const dStr = curDt.toISOString().split('T')[0];
            
            // Suspende se esbarrar em QUALQUER um dos meus slots
            const isBlocked = allocs.some(b => {
                if (String(b.turmaId) !== String(turmaId)) return false;
                const bStart = b.dataInicio || store.settings.termStart;
                const bEnd = b.dataFim || store.settings.termEnd;
                
                if (dStr >= bStart && dStr <= bEnd) {
                    if (b.tipo === 'intensiva' && b.horariosOcupados) {
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
        {m: 450, s: 'M', sl: 1}, {m: 500, s: 'M', sl: 2}, {m: 550, s: 'M', sl: 3},
        {m: 620, s: 'M', sl: 4}, {m: 670, s: 'M', sl: 5}, {m: 720, s: 'M', sl: 6},
        {m: 810, s: 'T', sl: 1}, {m: 860, s: 'T', sl: 2}, {m: 910, s: 'T', sl: 3},
        {m: 980, s: 'T', sl: 4}, {m: 1030, s: 'T', sl: 5}, {m: 1080, s: 'T', sl: 6}
    ];
    
    function getSlot(horario) {
        if(!horario) return null;
        const min = timeToMinutes(horario);
        for(let i = slotsMap.length - 1; i >= 0; i--) {
            if(min >= slotsMap[i].m - 10 && min <= slotsMap[i].m + 40) return slotsMap[i];
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
            while(curDt <= endDt) {
                const dSigaa = curDt.getDay() + 1; 
                
                // INCLUI SÁBADO NO CÁLCULO SE ESTIVER SALVO NA ALOCAÇÃO COMO TRUE
                const aceitaDia = (dSigaa >= 2 && dSigaa <= 6) || (dSigaa === 7 && a.usaSabado);
                
                if (aceitaDia) { 
                    (a.horariosOcupados || []).forEach(h => {
                        const sInfo = getSlot(h);
                        if(sInfo) slotsList.push({ day: dSigaa, shift: sInfo.s, slot: sInfo.sl });
                    });
                }
                curDt.setDate(curDt.getDate() + 1);
            }
        }
    });

    if(slotsList.length === 0) return '-';

    const unique = [];
    const seen = new Set();
    slotsList.forEach(s => {
        const key = `${s.day}-${s.shift}-${s.slot}`;
        if(!seen.has(key)) { 
            seen.add(key); 
            unique.push(s); 
        }
    });

    const dayShiftMap = {};
    unique.forEach(s => {
        const k = `${s.day}${s.shift}`;
        if(!dayShiftMap[k]) dayShiftMap[k] = [];
        dayShiftMap[k].push(s.slot);
    });

    const shiftSlotsMap = {};
    for(const k in dayShiftMap) {
        dayShiftMap[k].sort((a,b)=>a-b);
        const day = k.charAt(0);
        const shift = k.charAt(1);
        const slotsStr = dayShiftMap[k].join('');
        const comboKey = `${shift}${slotsStr}`;
        if(!shiftSlotsMap[comboKey]) shiftSlotsMap[comboKey] = [];
        shiftSlotsMap[comboKey].push(day);
    }

    const parts = [];
    for(const combo in shiftSlotsMap) {
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

export function initUI() {
    if (selCurso) selCurso.addEventListener('change', onCursoChange);
    if (selTurma) selTurma.addEventListener('change', onTurmaChange);

    initPeriodoLetivoETurno();
    setupClearButtonsSidebar();
    setupMultiDocenteUI(); 

    // INJEÇÃO DA CAIXINHA DE SÁBADO AUTOMATICAMENTE NO MENU
    const divData = document.getElementById('datas-intensiva');
    if (divData && !document.getElementById('container-include-saturday')) {
        const wrap = document.createElement('div');
        wrap.className = 'form-group';
        wrap.id = 'container-include-saturday';
        wrap.style.marginTop = '15px';
        wrap.innerHTML = `
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:#2c3e50; font-weight:bold; font-size:0.95em; background:#f8f9fa; padding:10px; border-radius:6px; border:1px solid #bdc3c7;">
                <input type="checkbox" id="chk-include-saturday" style="width:18px; height:18px; cursor:pointer; accent-color:#c0392b; margin:0;">
                Permitir Sábados (Cálculo Intensiva)
            </label>
        `;
        divData.appendChild(wrap);
    }

    if (inputConfig.tipo) {
        inputConfig.tipo.addEventListener('change', (e) => {
            const divDataEl = document.getElementById('datas-intensiva');
            const divSlots = document.getElementById('container-slots-selection');
            const isIntensive = (e.target.value === 'intensiva');
            
            divDataEl.classList.remove('hidden');
            
            if (isIntensive) {
                divSlots.classList.remove('hidden');
                renderIntensiveSlots();
                const chk = document.getElementById('chk-include-saturday');
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

    const inpGanttDocente = document.getElementById('inp-gantt-docente');
    if (inpGanttDocente) {
        if (!inpGanttDocente.parentNode.classList.contains('input-wrapper-gantt')) {
            const wrapper = document.createElement('div');
            wrapper.className = 'input-wrapper-gantt';
            wrapper.style.position = 'relative';
            wrapper.style.display = 'inline-block';
            wrapper.style.width = '100%';
            inpGanttDocente.parentNode.insertBefore(wrapper, inpGanttDocente);
            wrapper.appendChild(inpGanttDocente);
        }
        addClearXToField(inpGanttDocente, 'inp-gantt-docente');
    }

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
                
                const allocs = store.allocations.filter((a) => 
                    String(a.turmaId) === String(store.selectedTurma) && 
                    (a.tipo === 'regular' || a.tipo === 'regular_prioritaria') && 
                    a.diaSemana == i && 
                    a.horario === horarioStr
                );
                
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

    const mainProf = docData.mode === 'single' ? docData.docente : docData.docentesList[0].nome;
    const conflitoDocente = store.allocations.find((a) => {
        if (a.docente !== mainProf || a.diaSemana != dia || a.horario !== horario) return false;
        const startA = a.dataInicio || store.settings.termStart;
        const endA = a.dataFim || store.settings.termEnd;
        const tempEnd = new Date(dataInicio + "T12:00:00"); 
        tempEnd.setDate(tempEnd.getDate() + 7);
        return isDateOverlap(dataInicio, tempEnd.toISOString().split('T')[0], startA, endA);
    });

    if (conflitoDocente) { 
        if (!confirm(`O professor ${mainProf} já está ocupado nesta faixa de datas. Continuar?`)) return; 
    }

    // Identifica se há intensivas que irão suspender essa nova aula regular
    const blockingIntensivas = store.allocations.filter(a => {
        if (String(a.turmaId) !== String(store.selectedTurma)) return false;
        if (a.tipo !== 'intensiva') return false;
        
        // Verifica overlap das datas gerais (nova regular é semestral)
        const aStart = a.dataInicio || store.settings.termStart;
        const aEnd = a.dataFim || store.settings.termEnd;
        const rStart = dataInicio;
        const rEnd = store.settings.termEnd || '2099-12-31'; 
        
        if (!isDateOverlap(rStart, rEnd, aStart, aEnd)) return false;
        return a.horariosOcupados && a.horariosOcupados.includes(horario);
    });

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
    renderWeeklyGrid(); 
    renderOfertasList();

    // NOTIFICAÇÃO 1: Avisa se uma intensiva engoliu essa nova regular
    if (blockingIntensivas.length > 0) {
        const nomes = [...new Set(blockingIntensivas.map(i => i.disciplina))].join(', ');
        showToastWarning(`💡 <b>Ajuste Automático:</b> A disciplina <b>${info.abrev}</b> iniciará com aulas suspensas nos dias da Intensiva de <b>${nomes}</b>. A data final foi compensada!`, 'success');
    } else if (store.settings.termEnd) {
        // Alerta padrão de fora de semestre (mantido)
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
        
        let effectiveCH = ch === 45 && slotsIntensiva.length === 2 ? 46 : ch;
        const diasNecessarios = Math.ceil(effectiveCH / slotsIntensiva.length);
        const feriados = store.rawData?.feriados || [];
        const blockedWeekdays = getBlockedWeekdaysForTurma(store.selectedTurma);
        
        // RECUPERA A CHAVE DO SÁBADO
        const chkSabado = document.getElementById('chk-include-saturday');
        const usaSabado = chkSabado ? chkSabado.checked : false;

        // CÁLCULO MÁGICO
        const dataFimCalculada = addBusinessDays(inicio, diasNecessarios, feriados, blockedWeekdays, usaSabado);

        // NOVA REGRA (TOLERÂNCIA ZERO PARA INTENSIVA X INTENSIVA)
        const intensiveConflict = store.allocations.find(a => {
            if (String(a.turmaId) !== String(store.selectedTurma)) return false;
            if (a.tipo !== 'intensiva' || a.disciplina === disciplina) return false; 
            return hasIntensiveSlotConflict(inicio, dataFimCalculada, slotsIntensiva, a.dataInicio || store.settings.termStart, a.dataFim || store.settings.termEnd, a.horariosOcupados);
        });

        if (intensiveConflict) {
            return alert(`❌ CHOQUE DE HORÁRIO!\n\nA Intensiva de "${intensiveConflict.disciplina}" já está utilizando este(s) horário(s) no mesmo período. A ação foi bloqueada.`);
        }

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

        // VERIFICA QUAIS REGULARES SERÃO AFETADAS PELA NOVA INTENSIVA
        const affectedRegulars = [];
        store.allocations.forEach(a => {
            if (String(a.turmaId) !== String(store.selectedTurma)) return;
            if (a.tipo !== 'regular' && a.tipo !== 'regular_prioritaria') return;
            
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
            dataInicio: inicio, 
            dataFim: dataFimCalculada, 
            modelo: 'Automático', 
            horariosOcupados: slotsIntensiva,
            usaSabado: usaSabado, 
            cor: inputConfig.cor ? inputConfig.cor.value : store.getDisciplinaColor(disciplina) 
        });
        
        syncAllRegularDates(); 
        renderOfertasList();

        // NOTIFICAÇÃO 2: Avisa se esta nova intensiva empurrou aulas regulares
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
        const chMax = info.ch;
        let totalHoras = 0, details = '';
        const start = a.dataInicio || semestreInicio;
        const end = a.dataFim || semestreFim;

        if (a.tipo === 'regular' || a.tipo === 'regular_prioritaria') {
            const suspended = getSuspendedDates(store.allocations, a.turmaId, a.diaSemana, a.disciplina, start);
            const numAulas = countWeekdaysInPeriod(start, end, parseInt(a.diaSemana), feriados, suspended);
            totalHoras = numAulas * 1; 
            details = `${numAulas} aulas`;
        } else {
            // RECUPERA A CHAVE DO SÁBADO PARA RECALCULAR A CARGA HORÁRIA EXIBIDA
            const diasUteis = countBusinessDays(start, end, feriados, blockedWeekdays, a.usaSabado || false);
            const slotsPorDia = a.horariosOcupados ? a.horariosOcupados.length : 5;
            totalHoras = diasUteis * slotsPorDia; 
            details = `${diasUteis} dias`;
        }

        let color = '#2c3e50';
        if (chMax > 0) {
            if (totalHoras < chMax) color = '#d35400';
            if (totalHoras === chMax) color = '#27ae60';
            if (totalHoras > chMax) color = '#c0392b';
        }

        const allocsDaDisciplina = store.allocations.filter(x => String(x.turmaId) === String(a.turmaId) && x.disciplina === a.disciplina);
        const sigaaCode = getSigaaCode(allocsDaDisciplina);
        
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
        const chInfo = `<b style="color:${color}">${totalHoras}</b> / ${chMax}h <small>(${details})</small>${sabadoLabel}`;
        const labelTipo = a.tipo === 'regular_prioritaria' ? '<b>Regular (Prioritária)</b>' : a.tipo;
        
        let endFmt = formatDateBR(end);
        if (store.settings.termEnd && end > store.settings.termEnd) { 
            endFmt = `<span style="color:#c0392b; font-weight:bold; font-size:1.1em;" title="Atenção: Esta data ultrapassa o fim oficial do semestre!">⚠️ ${endFmt}</span>`; 
        }
        
        const horarioTxt = `${formatDateBR(start)} a ${endFmt}<br><small>${['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'][a.diaSemana] || 'Int.'} ${a.horario || ''}</small>`;
        
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
        
        // --- NOVO BOTÃO VERDE DE COPIAR (ANTI-FALHA) ---
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
                    // Estratégia dupla de cópia
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
                    
                    // Feedback Visual Forte (Verde)
                    btn.innerHTML = '✅ Copiado';
                    btn.style.backgroundColor = '#27ae60';
                    btn.style.color = '#ffffff';
                    btn.style.borderColor = '#27ae60';

                    // Volta ao normal
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
                renderWeeklyGrid(); 
                renderOfertasList(); 
            } 
        };
        
        const btnEdit = tr.querySelector('.btn-edit-row');
        if (btnEdit) {
            btnEdit.onclick = () => {
                if (confirm('Carregar para edição? A oferta antiga será removida.')) {
                    if (inputConfig.tipo) { 
                        inputConfig.tipo.value = a.tipo; 
                        inputConfig.tipo.dispatchEvent(new Event('change')); 
                    }
                    if (inputConfig.disciplina) { 
                        inputConfig.disciplina.value = `${a.disciplina} (${info.ch}h)`; 
                        inputConfig.disciplina.dispatchEvent(new Event('input')); 
                    }
                    if (inputConfig.cor && a.cor) { 
                        inputConfig.cor.value = a.cor; 
                        setTimeout(() => { inputConfig.cor.value = a.cor; }, 50); 
                    }
                    if (inputConfig.inicio && a.dataInicio) {
                        inputConfig.inicio.value = a.dataInicio;
                    }

                    // RESTAURA A CHAVE NA CAIXINHA DE SÁBADO
                    if (a.tipo === 'intensiva') {
                        const chkSabado = document.getElementById('chk-include-saturday');
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
                            inputConfig.docente.value = a.docente || ''; 
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
    
    if (intensivas.length === 0 && regular.length === 0) {
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
    
    filteredTimes.sort((a,b) => timeToMinutes(a) - timeToMinutes(b));
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
        if(leftPct >= 0 && leftPct <= 100) { 
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
            // Só adiciona a linha se não for o início absoluto (evita linha sumindo na borda esquerda)
            if (leftPct > 0.1) {
                monthLines.push(leftPct);
            }
        }
        curMonthWalker = new Date(curMonthWalker.getFullYear(), curMonthWalker.getMonth() + 1, 1, 12, 0, 0);
    }
    
    // --- LINHAS VERTICAIS QUE SOBEM ATÉ O CABEÇALHO ---
    // Aumentamos o z-index para 10 e a espessura para garantir que a linha cubra o cabeçalho perfeitamente
    const monthOverlaysHtml = monthLines.map(pct => `
        <div style="position: absolute; left: ${pct}%; top: 0; bottom: 0; border-left: 2px solid #2c3e50; z-index: 10; pointer-events: none;"></div>
    `).join('');
    // ---------------------------------------------------------------

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

    // --- CABEÇALHO DOS MESES ---
    html += '<div class="gantt-header-row" style="display: flex; border-bottom: 2px solid var(--primary); padding: 10px 0; background: #e2e8f0; margin: 0; position: relative; z-index: 6;">'; 
    html += '<div style="width: 80px; flex-shrink: 0;"></div>'; 
    
    // ENVELOPE FLEX PARA ALINHAR A LARGURA EXATAMENTE COM AS LINHAS (100% - 80px) E CENTRALIZAR O TEXTO
    html += '<div style="flex: 1; display: flex; position: relative;">';
    
    let cur = new Date(minTime);
    cur.setDate(1); 
    
    while (cur.getTime() <= maxTime || (cur.getFullYear() === new Date(maxTime).getFullYear() && cur.getMonth() === new Date(maxTime).getMonth())) {
        // --- FORMATAÇÃO ELEGANTE: Mar/26 ---
        let nomeCurto = cur.toLocaleString('pt-BR', { month: 'short' }).replace('.', '');
        const mesNome = nomeCurto.charAt(0).toUpperCase() + nomeCurto.slice(1) + '/' + String(cur.getFullYear()).slice(-2);
        // -------------------------------------
        
        let startOfMonth = Math.max(cur.getTime(), minTime);
        let nextM = new Date(cur.getFullYear(), cur.getMonth() + 1, 1, 12, 0, 0);
        let endOfMonth = Math.min(nextM.getTime() - 1, maxTime);
        let wPct = ((endOfMonth - startOfMonth) / totalTime) * 100;
        
        if (wPct > 0) { 
            // Centraliza o texto do cabeçalho
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
                
                while(curDt <= endDt) {
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

            // MÁGICA 4D: Barras de intensivas são finas (24px fixo). Regulares crescem conforme as horas.
            let barHeight = 24;
            if (item.tipo !== 'intensiva') {
                let cappedSlots = Math.min(item.slotCount, 5);
                barHeight = 24 + ((cappedSlots - 1) * 8); 
            }
            
            const timeRangeStr = getShiftTimeRangeStr(item.timeRanges, 'M');

            let segmentsHtml = '';
            let externalLabelsHtml = ''; // Variável para o texto flutuante
            let currentSegmentT = startT;
            const docentesList = (item.docentes && item.docentes.length > 0) ? item.docentes : [{nome: item.docente, ch: item.chTotal}];

            docentesList.forEach((d, idx) => {
                const isTarget = d.nome === docenteName;
                let segStartT = currentSegmentT;
                let segEndT = currentSegmentT + (timeSpan * (d.ch / item.chTotal));
                let sDate = new Date(segStartT).toISOString().split('T')[0];
                let eDate = new Date(segEndT).toISOString().split('T')[0];
                
                if (idx === 0) sDate = item.dataInicio;
                if (idx === docentesList.length - 1) eDate = item.dataFim;
                
                const fmtStart = sDate.split('-').reverse().slice(0,2).join('/'); 
                const fmtEnd = eDate.split('-').reverse().slice(0,2).join('/');
                
                const bgColor = isTarget ? (item.cor || '#3498db') : '#ffffff';
                const txtColor = isTarget ? '#000000' : '#666666'; 
                const borderStyle = isTarget ? 'none' : `1px dashed ${item.cor || '#ccc'}`;
                const zIndex = isTarget ? '2' : '1';
                
                let content = '';
                
                if (item.tipo === 'intensiva') {
                    // DESIGN INTENSIVA: Texto Fora da Barra
                    if (isTarget) {
                        content = `<span style="font-size:0.75em; font-weight:800; letter-spacing:-0.5px; padding:0 2px;">${fmtStart} - ${fmtEnd}</span>`;
                        
                        // Joga pra esquerda ou pra direita baseado no espaço disponível na tela
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
                        content = `<span style="font-size:0.85em; font-weight:normal; opacity:0.8">${d.nome.split(' ')[0]}</span>`;
                    }
                } else {
                    // DESIGN REGULAR: Ajuste de padding, font-size e letter-spacing para caber melhor na barra
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

            // MÁGICA 4D: Barras de intensivas são finas (24px fixo). Regulares crescem conforme as horas.
            let barHeight = 24;
            if (item.tipo !== 'intensiva') {
                let cappedSlots = Math.min(item.slotCount, 5);
                barHeight = 24 + ((cappedSlots - 1) * 8); 
            }
            
            const timeRangeStr = getShiftTimeRangeStr(item.timeRanges, 'T');

            let segmentsHtml = '';
            let externalLabelsHtml = '';
            let currentSegmentT = startT;
            const docentesList = (item.docentes && item.docentes.length > 0) ? item.docentes : [{nome: item.docente, ch: item.chTotal}];

            docentesList.forEach((d, idx) => {
                const isTarget = d.nome === docenteName;
                let segStartT = currentSegmentT;
                let segEndT = currentSegmentT + (timeSpan * (d.ch / item.chTotal));
                let sDate = new Date(segStartT).toISOString().split('T')[0];
                let eDate = new Date(segEndT).toISOString().split('T')[0];
                
                if (idx === 0) sDate = item.dataInicio;
                if (idx === docentesList.length - 1) eDate = item.dataFim;
                
                const fmtStart = sDate.split('-').reverse().slice(0,2).join('/'); 
                const fmtEnd = eDate.split('-').reverse().slice(0,2).join('/');
                
                const bgColor = isTarget ? (item.cor || '#3498db') : '#ffffff';
                const txtColor = isTarget ? '#000000' : '#666666'; 
                const borderStyle = isTarget ? 'none' : `1px dashed ${item.cor || '#ccc'}`;
                const zIndex = isTarget ? '2' : '1';
                
                let content = '';
                
                if (item.tipo === 'intensiva') {
                    // DESIGN INTENSIVA: Texto Fora da Barra
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
                    // DESIGN REGULAR: Ajuste de padding, font-size e letter-spacing para caber melhor na barra
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

        // --- LINHA HORIZONTAL ENTRE OS DIAS (1px) ---
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

// ============================================================================
// NOVO MOTOR DE CALENDÁRIO: RENDERIZAÇÃO SEM DOMINGOS (GANHO DE ESPAÇO)
// ============================================================================
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

  // ------------------------------------------------------------------------
  // CHAVE MESTRA: ALterne para 'true' se um dia quiser o Domingo de volta.
  const EXIBIR_DOMINGO = false; 
  // ------------------------------------------------------------------------

  Object.keys(months).forEach((monthKey) => {
    const monthDiv = document.createElement('div');
    monthDiv.className = 'calendar-month';

    const [y, m] = monthKey.split('-');
    const nomeMes = new Date(y, m - 1, 2).toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
    monthDiv.innerHTML = `<h3>${nomeMes.toUpperCase()}</h3>`;

    const grid = document.createElement('div');
    grid.className = 'month-grid';
    
    // Ajusta o CSS Grid para 6 colunas se o Domingo for ocultado
    if (!EXIBIR_DOMINGO) {
        grid.style.gridTemplateColumns = 'repeat(6, 1fr)';
    }

    // Desenha o Cabeçalho da Semana
    const diasCabecalho = EXIBIR_DOMINGO ? ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'] : ['S', 'T', 'Q', 'Q', 'S', 'S'];
    diasCabecalho.forEach((d) => (grid.innerHTML += `<div class="day-header">${d}</div>`));

    const firstDate = months[monthKey][0].date;
    const startDow = new Date(firstDate + 'T12:00:00').getDay();
    
    // Calcula quantas células vazias precisamos colocar no início do mês
    let prefixEmptyCells = 0;
    if (EXIBIR_DOMINGO) {
        prefixEmptyCells = startDow;
    } else {
        // Como o calendário começa na Segunda (1), se o dia 1 cair no Domingo (0),
        // ele será pulado pelo loop, e a Segunda (dia 2) precisa ficar na coluna 0.
        prefixEmptyCells = startDow === 0 ? 0 : startDow - 1;
    }

    for (let i = 0; i < prefixEmptyCells; i++) {
        grid.innerHTML += `<div class="day-cell empty"></div>`;
    }

    months[monthKey].forEach((dayData) => {
      const dt = new Date(dayData.date + 'T12:00:00');
      const dayOfWeek = dt.getDay();

      // MÁGICA: Se não for para exibir domingo e hoje for domingo, ignora completamente!
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
    
    // Completa a última linha do grid para manter as bordas bonitas
    let emptySuffix = 0;
    if (EXIBIR_DOMINGO) {
        emptySuffix = 6 - lastDow;
    } else {
        if (lastDow === 0) emptySuffix = 0; // Se o último dia do mês for Domingo, já foi pulado, parou no sábado.
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
}

export { renderWeeklyGrid, renderOfertasList, renderMonthlyCalendar, renderTeacherCalendar };