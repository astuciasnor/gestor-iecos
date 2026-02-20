import { store } from './store.js';
import { getCalendarEvents } from './calendar.js';
import { countBusinessDays, countWeekdaysInPeriod, addBusinessDays, isDateOverlap, calculateEndDateByWeekday } from './utils.js';

// Elementos Globais
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

// --- FUNÇÃO DE AVISO FLUTUANTE (NÃO TRAVA A TELA) ---
function showToastWarning(message) {
    const fb = document.getElementById('feedback-msg');
    if (!fb) return;
    fb.classList.remove('hidden');
    fb.innerHTML = message;
    fb.style.display = 'block';
    fb.style.backgroundColor = '#e74c3c'; 
    fb.style.color = '#fff';
    fb.style.padding = '15px 20px';
    fb.style.borderRadius = '6px';
    fb.style.marginBottom = '15px';
    fb.style.fontWeight = 'bold';
    fb.style.boxShadow = '0 4px 10px rgba(0,0,0,0.3)';
    fb.style.textAlign = 'center';
    fb.style.fontSize = '1.1em';
    fb.style.lineHeight = '1.4';

    if (window.toastTimeout) clearTimeout(window.toastTimeout);
    window.toastTimeout = setTimeout(() => {
        fb.style.display = 'none';
        fb.classList.add('hidden');
    }, 7000); 
}

// --- FUNÇÕES AUXILIARES DE UI (MANTIDAS) ---

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
    btn.style.top = '70%'; 
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

    const sample =
      gridContainer.querySelector('.slot') ||
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
      #weekly-grid .slot {
        height: auto !important;
        min-height: ${normalH}px !important;
      }
      #weekly-grid .header.time {
        height: ${normalH}px !important;
        min-height: ${normalH}px !important;
      }
      #weekly-grid .header.top-header {
        height: ${smallH}px !important;
        min-height: ${smallH}px !important;
        line-height: 1.1 !important;
        padding-top: 4px !important;
        padding-bottom: 4px !important;
      }
      #weekly-grid .header.interval-time,
      #weekly-grid .header.interval-merge {
        height: ${smallH}px !important;
        min-height: ${smallH}px !important;
        line-height: 1.1 !important;
        padding-top: 4px !important;
        padding-bottom: 4px !important;
      }
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

    validSlots.forEach((slotLabel, idx) => {
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

// MOTOR DE SINCRONIZAÇÃO TOTAL (Cura todas as datas para repor horas suspensas)
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
            
            const slotsToday = group.filter(a => parseInt(a.diaSemana) === dow);
            
            if (slotsToday.length > 0 && !feriadosSet.has(dStr)) {
                slotsToday.forEach(slot => {
                    const isSuspended = store.allocations.some(other => {
                        if (String(other.turmaId) !== String(turmaId)) return false;
                        
                        const oStart = other.dataInicio || termStart;
                        const oEnd = other.dataFim || termEnd;
                        if (dStr < oStart || dStr > oEnd) return false;
                        
                        if (other.tipo === 'intensiva' && other.horariosOcupados && other.horariosOcupados.includes(slot.horario)) return true;
                        if (other.tipo === 'regular_prioritaria' && parseInt(other.diaSemana) === dow && other.horario === slot.horario && other.id !== slot.id) return true;
                        
                        return false;
                    });
                    
                    if (!isSuspended) {
                        classesFound++;
                        lastValidDate = new Date(currentDate); 
                    }
                });
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

function getSuspendedDates(allocs, turmaId, diaSemana, horario, startDate) {
    if (!startDate) return [];
    const suspended = [];
    const blockers = allocs.filter(a => {
        if (String(a.turmaId) !== String(turmaId)) return false;
        if (a.tipo === 'intensiva' && a.horariosOcupados && a.horariosOcupados.includes(horario)) return true;
        if (a.tipo === 'regular_prioritaria' && parseInt(a.diaSemana) === parseInt(diaSemana) && a.horario === horario) return true;
        return false;
    });
    
    if (blockers.length === 0) return [];

    let curDt = new Date(startDate + "T12:00:00");
    for (let i = 0; i < 365; i++) {
        if (curDt.getDay() === parseInt(diaSemana)) {
            const dStr = curDt.toISOString().split('T')[0];
            const isBlocked = blockers.some(b => {
                const bStart = b.dataInicio || store.settings.termStart;
                const bEnd = b.dataFim || store.settings.termEnd;
                return dStr >= bStart && dStr <= bEnd;
            });
            if (isBlocked) suspended.push(dStr);
        }
        curDt.setDate(curDt.getDate() + 1);
    }
    return suspended;
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

  if (inputConfig.tipo) {
    inputConfig.tipo.addEventListener('change', (e) => {
      const divData = document.getElementById('datas-intensiva');
      const divSlots = document.getElementById('container-slots-selection');
      const isIntensive = (e.target.value === 'intensiva');

      divData.classList.remove('hidden');

      if (isIntensive) {
        divSlots.classList.remove('hidden');
        renderIntensiveSlots();
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
      console.error(err);
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
      if (hora < 12) store.setTurnoOferta('Manhã');
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
  const c =
    store.rawData.componentes.find(
      (x) => x.componente === nomeComponente && x.sigla === store.selectedCurso
    ) || store.rawData.componentes.find((x) => x.componente === nomeComponente);

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
    const isSeparadorTurno = horarioStr.includes('12:00'); 

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
        
        const allocs = store.allocations.filter(
          (a) =>
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

        // Layout horizontal para o texto
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

function checkTeacherConflict(docente, dia, horario) {
  return store.allocations.find((a) => a.docente === docente && a.diaSemana == dia && a.horario === horario);
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
    String(a.turmaId) === String(store.selectedTurma) && a.diaSemana == dia && a.horario === horario
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

  // Insere a alocação
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

  // AVISO FLUTUANTE COM PACIÊNCIA DE 5 SEGUNDOS
  if (window.overlapWarningTimeout) clearTimeout(window.overlapWarningTimeout);

  if (store.settings.termEnd) {
      window.overlapWarningTimeout = setTimeout(() => {
          const slotsDesta = store.allocations.filter(a => a.disciplina === disciplina && String(a.turmaId) === String(store.selectedTurma));
          if (slotsDesta.length > 0 && slotsDesta[0].dataFim > store.settings.termEnd) {
              showToastWarning(`⚠️ ATENÇÃO: A disciplina <b>${info.abrev}</b> terminará em <b>${formatDateBR(slotsDesta[0].dataFim)}</b>.<br>Isso ultrapassa o fim do semestre (${formatDateBR(store.settings.termEnd)}).<br>Insira mais horários na grade para reduzir esta data!`);
          }
      }, 5000); // 5000 milissegundos = 5 segundos de espera
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

    if(docData.mode === 'multi' && docData.totalCH > ch) {
        alert(`A soma das cargas horárias excede a CH da disciplina.`);
        return;
    }

    let slotsIntensiva = getCheckedSlots();
    if (slotsIntensiva.length === 0) return alert('Selecione pelo menos um horário.');
    
    let effectiveCH = ch === 45 && slotsIntensiva.length === 2 ? 46 : ch;
    const diasNecessarios = Math.ceil(effectiveCH / slotsIntensiva.length);
    const feriados = store.rawData?.feriados || [];
    const blockedWeekdays = getBlockedWeekdaysForTurma(store.selectedTurma);
    const dataFimCalculada = addBusinessDays(inicio, diasNecessarios, feriados, blockedWeekdays);

    const normalize = s => (s || '').split(/\s/)[0].replace(/[^0-9:]/g, '');

    const megaConflictInt = store.allocations.find(a => {
        if (String(a.turmaId) !== String(store.selectedTurma)) return false;
        if (a.tipo !== 'intensiva' || a.disciplina === disciplina) return false; 
        if (!isDateOverlap(inicio, dataFimCalculada, a.dataInicio || store.settings.termStart, a.dataFim || store.settings.termEnd)) return false;

        const newShifts = [...new Set(slotsIntensiva.map(s => timeToMinutes(s) < 12 * 60 ? 'Manhã' : 'Tarde'))];
        const existingShifts = [...new Set((a.horariosOcupados || []).map(s => timeToMinutes(s) < 12 * 60 ? 'Manhã' : 'Tarde'))];
        const hasOverlap = newShifts.some(shift => existingShifts.includes(shift));
        
        return hasOverlap && (slotsIntensiva.length >= 5 || (a.horariosOcupados || []).length >= 5);
    });

    if (megaConflictInt) {
        alert(`⚠️ TURNO BLOQUEADO por uma Intensiva de 5+ horas.`);
        return;
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
      cor: inputConfig.cor ? inputConfig.cor.value : store.getDisciplinaColor(disciplina)
    });

    syncAllRegularDates();
    renderOfertasList();
    
  } else {
    alert('Para regular, clique na grade.');
  }
}

function getInputValues() {
  return {
    disciplina: (inputConfig.disciplina?.value ?? '').replace(/\s*\(\s*\d+\s*h\s*\)\s*$/i, ''),
    docente: inputConfig.docente?.value ?? '',
    tipo: inputConfig.tipo?.value ?? 'regular',
    inicio: inputConfig.inicio?.value ?? '',
    fim: inputConfig.fim?.value ?? ''
  };
}

function renderOfertasList() {
  const tbody = document.querySelector('#ofertas-table tbody');
  if (!tbody) return;

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
    tr.innerHTML = `<td colspan="6">${label}</td>`;
    tbody.appendChild(tr);
  };

  const appendMonthSeparator = (monthKey) => {
    const [y, m] = monthKey.split('-').map((n) => parseInt(n, 10));
    const nomeMes = new Date(y, m - 1, 2).toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
    appendSeparator(nomeMes.toUpperCase());
  };

  const blockedWeekdays = getBlockedWeekdaysForTurma(store.selectedTurma);

  const appendRow = (a) => {
    const tr = document.createElement('tr');
    const info = getDisciplinaInfo(a.disciplina);
    const chMax = info.ch;
    let totalHoras = 0;
    let details = '';

    const start = a.dataInicio || semestreInicio;
    const end = a.dataFim || semestreFim;

    if (a.tipo === 'regular' || a.tipo === 'regular_prioritaria') {
      const suspended = getSuspendedDates(store.allocations, a.turmaId, a.diaSemana, a.horario, start);
      const numAulas = countWeekdaysInPeriod(start, end, parseInt(a.diaSemana), feriados, suspended);
      totalHoras = numAulas * 1;
      details = `${numAulas} aulas`;
    } else {
      const diasUteis = countBusinessDays(start, end, feriados, blockedWeekdays);
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

    const chInfo = `<b style="color:${color}">${totalHoras}</b> / ${chMax}h <small>(${details})</small>`;
    const labelTipo = a.tipo === 'regular_prioritaria' ? '<b>Regular (Prioritária)</b>' : a.tipo;
    
    // ALERTA VISUAL VERMELHO NA TABELA
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
      <td style="white-space:nowrap;"><div style="display:flex; justify-content:center;">${btnHtml}</div></td>
    `;

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
                if (inputConfig.cor) inputConfig.cor.value = a.cor;
                if (inputConfig.inicio && a.dataInicio) inputConfig.inicio.value = a.dataInicio;

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

  let currentMonth = null;
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
    tr.innerHTML = `<td colspan="6" style="text-align:center; color:#666;">Nenhuma oferta cadastrada.</td>`;
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

  const title = `<span class="print-title-main">Cronograma Docente</span><br><span class="print-title-sub">${docente}</span>`;
  generateCalendarGrid(container, null, docente, start, end, title);
}

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

  Object.keys(months).forEach((monthKey) => {
    const monthDiv = document.createElement('div');
    monthDiv.className = 'calendar-month';

    const [y, m] = monthKey.split('-');
    const nomeMes = new Date(y, m - 1, 2).toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
    monthDiv.innerHTML = `<h3>${nomeMes.toUpperCase()}</h3>`;

    const grid = document.createElement('div');
    grid.className = 'month-grid';
    ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].forEach((d) => (grid.innerHTML += `<div class="day-header">${d}</div>`));

    const firstDate = months[monthKey][0].date;
    const startDow = new Date(firstDate + 'T12:00:00').getDay();
    for (let i = 0; i < startDow; i++) grid.innerHTML += `<div class="day-cell empty"></div>`;

    months[monthKey].forEach((dayData) => {
      const cell = document.createElement('div');
      cell.className = 'day-cell';
      const dt = new Date(dayData.date + 'T12:00:00');
      if (dt.getDay() === 0 || dt.getDay() === 6) cell.classList.add('weekend');

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
    for (let i = lastDow + 1; i <= 6; i++) {
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