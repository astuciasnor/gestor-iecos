import { store } from './store.js';
import { getCalendarEvents } from './calendar.js';
import { countBusinessDays, countWeekdaysInPeriod, addBusinessDays, isDateOverlap } from './utils.js';

// Elementos Globais
const gridContainer = document.getElementById('weekly-grid');
const selCurso = document.getElementById('sel-curso');
const selTurma = document.getElementById('sel-turma');
const listDisciplinas = document.getElementById('list-disciplinas');
const listDocentes = document.getElementById('list-docentes');

// ATENÇÃO: No seu HTML, certifique-se que o input da aba professor tenha id="sel-view-docente"
const selViewDocente = document.getElementById('sel-view-docente');

// Configurações persistentes (sidebar)
const inpTermStart = document.getElementById('term-start');
const inpTermEnd = document.getElementById('term-end');
const selTurnoOferta =
  document.getElementById('sel-turno_oferta') ||
  document.getElementById('sel-turno-oferta');

// Controles de período (tabs)
const calStart = document.getElementById('cal-start');
const calEnd = document.getElementById('cal-end');

const inputConfig = {
  disciplina: document.getElementById('inp-disciplina'),
  cor: document.getElementById('inp-color'), // input de cor
  docente: document.getElementById('inp-docente'),
  tipo: document.getElementById('sel-tipo'),
  inicio: document.getElementById('inp-data-inicio'),
  fim: document.getElementById('inp-data-fim')
};

let tempImportData = null;

/**
 * ======= Auxiliar de Tempo =======
 */
function timeToMinutes(str) {
  if (!str) return 99999;
  const match = str.match(/(\d{1,2}):(\d{2})/);
  if (!match) return 99999;
  return parseInt(match[1]) * 60 + parseInt(match[2]);
}

/**
 * ======= Botão "×" para limpar inputs =======
 */
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

  // Estilo do botão X
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

/**
 * Normalização e labels
 */
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

/**
 * ======= Ajuste de altura das linhas (Grade Semanal) =======
 */
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
      #weekly-grid .slot,
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

/**
 * ======= LÓGICA DE MÚLTIPLOS DOCENTES =======
 */
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

/**
 * ======= LÓGICA DE SLOTS INTENSIVA =======
 */
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

/**
 * ======= Período letivo + turno =======
 */
function initPeriodoLetivoETurno() {
  const defaultStart = calStart && calStart.value ? calStart.value : '';
  const defaultEnd = calEnd && calEnd.value ? calEnd.value : '';

  if (!store.settings.termStart && defaultStart) store.settings.termStart = defaultStart;
  if (!store.settings.termEnd && defaultEnd) store.settings.termEnd = defaultEnd;
  if (!store.settings.turnoOferta) store.settings.turnoOferta = 'Tarde';
  store.saveSettings();

  if (inpTermStart && store.settings.termStart) inpTermStart.value = store.settings.termStart;
  if (inpTermEnd && store.settings.termEnd) inpTermEnd.value = store.settings.termEnd;
  if (selTurnoOferta) selTurnoOferta.value = store.settings.turnoOferta || 'Tarde';

  if (calStart && store.settings.termStart) calStart.value = store.settings.termStart;
  if (calEnd && store.settings.termEnd) calEnd.value = store.settings.termEnd;

  if (inpTermStart) {
    inpTermStart.addEventListener('change', () => {
      store.setTermDates(inpTermStart.value, store.settings.termEnd);
      if (calStart) calStart.value = inpTermStart.value;
      if (inputConfig.inicio && !inputConfig.inicio.value) inputConfig.inicio.value = inpTermStart.value;
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

/**
 * ======= Init UI =======
 */
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

      if (isIntensive) {
        divData.classList.remove('hidden');
        divSlots.classList.remove('hidden');
        renderIntensiveSlots();
        if (store.settings.termStart && inputConfig.inicio && !inputConfig.inicio.value) {
          inputConfig.inicio.value = store.settings.termStart;
        }
      } else {
        divData.classList.add('hidden');
        divSlots.classList.add('hidden');
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
        store.saveAllocations();
        alert('Dados substituídos com sucesso!');
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
        alert(`Mesclagem concluída! ${count} novas alocações adicionadas.`);
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

/**
 * ======= Import =======
 */
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

/**
 * ======= Populate =======
 */
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
  selTurma.innerHTML = '<option value="">Selecione...</option>';

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
    if (isSeparadorTurno) hDiv.style.borderBottom = '3px solid #000000'; 
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
        
        if (isSeparadorTurno) cell.style.borderBottom = '3px solid #000000';

        const alloc = store.allocations.find(
          (a) =>
            String(a.turmaId) === String(store.selectedTurma) &&
            a.tipo === 'regular' &&
            a.diaSemana == i &&
            a.horario === horarioStr
        );

        if (alloc) renderSlotContent(cell, alloc);

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

function renderSlotContent(cell, alloc) {
  cell.style.backgroundColor = alloc.cor;
  const info = getDisciplinaInfo(alloc.disciplina);

  cell.innerHTML = `
    <div style="font-size:0.85em; font-weight:bold; line-height:1.2; margin-bottom:2px;">${info.abrev}</div>
    <div style="font-size:0.75em; color:#444;">${(alloc.docente || '').split(' ')[0] || ''}</div>
    <span class="remove-btn" style="color:red; font-weight:bold; font-size:0.8em; position:absolute; top:2px; right:2px;">×</span>
  `;

  cell.querySelector('.remove-btn').onclick = (e) => {
    e.stopPropagation();
    if (confirm('Remover esta aula?')) {
      store.removeAllocation(alloc.id);
      renderWeeklyGrid();
      renderOfertasList();
    }
  };
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
  const maxCH = info.ch || 0;
  
  if (docData.mode === 'multi') {
      if (docData.totalCH > maxCH) {
          return alert(`A soma das horas (${docData.totalCH}h) ultrapassa a carga horária da disciplina (${maxCH}h).`);
      }
  }

  const tipo = inputConfig.tipo?.value ?? 'regular';
  if (tipo === 'intensiva') return alert('Para intensivas, configure as datas no menu e clique em "Adicionar à Grade".');

  const mainProf = docData.mode === 'single' ? docData.docente : docData.docentesList[0].nome;
  const conflito = checkTeacherConflict(mainProf, dia, horario);
  if (conflito) {
    if (!confirm(`O professor ${mainProf} já ministra aula na turma ${conflito.turmaId} neste horário. Continuar?`)) return;
  }

  const corSelecionada = inputConfig.cor ? inputConfig.cor.value : store.getDisciplinaColor(disciplina);

  store.addAllocation({
    turmaId: store.selectedTurma,
    disciplina,
    docente: docData.docente, 
    docentes: docData.docentesList, 
    tipo: 'regular',
    diaSemana: dia,
    horario,
    cor: corSelecionada 
  });

  renderWeeklyGrid();
  renderOfertasList();
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
    if (ch === 0) return alert(`O componente "${disciplina}" tem CH 0 ou não foi encontrado.`);

    if(docData.mode === 'multi' && docData.totalCH > ch) {
        alert(`Atenção: A soma das cargas horárias (${docData.totalCH}h) excede a CH da disciplina (${ch}h).`);
        return;
    }

    let slotsIntensiva = getCheckedSlots();
    if (slotsIntensiva.length === 0) return alert('Selecione pelo menos um horário para a intensiva.');
    
    let slotsCount = slotsIntensiva.length;
    let effectiveCH = ch;
    if (ch === 45 && slotsCount === 2) {
        effectiveCH = 46;
    }

    const diasNecessarios = Math.ceil(effectiveCH / slotsCount);
    const feriados = store.rawData?.feriados || [];
    const dataFimCalculada = addBusinessDays(inicio, diasNecessarios, feriados);

    // Helper de normalização
    const normalize = s => (s || '').split(/\s/)[0].replace(/[^0-9:]/g, '');

    // === VALIDAÇÃO DE CHOQUE COM LÓGICA DE SALA BLOQUEADA ===
    const conflitoIntensiva = store.allocations.find(a => {
        // Ignora a própria
        if (String(a.turmaId) === String(store.selectedTurma) && a.disciplina === disciplina) return false;

        // Verifica PROFESSOR em comum
        const newTeachers = docData.mode === 'single' ? [docData.docente] : docData.docentesList.map(d=>d.nome);
        const storedTeachers = a.docentes ? a.docentes.map(d=>d.nome) : [a.docente];
        const hasCommonTeacher = newTeachers.some(nt => storedTeachers.includes(nt));
        if (!hasCommonTeacher) return false;

        // Verifica DATA
        let isDateCollision = true;
        if (a.tipo === 'intensiva') {
            isDateCollision = isDateOverlap(inicio, dataFimCalculada, a.dataInicio, a.dataFim);
        }
        if (!isDateCollision) return false;

        // Verifica HORÁRIO
        let isTimeCollision = false;
        const newSlotsNorm = slotsIntensiva.map(normalize);
        let existingSlotsNorm = [];
        if (a.horariosOcupados) {
             existingSlotsNorm = a.horariosOcupados.map(normalize);
        } else if (a.horario) {
             existingSlotsNorm = [normalize(a.horario)];
        }
        isTimeCollision = newSlotsNorm.some(ns => existingSlotsNorm.includes(ns));
        if (!isTimeCollision) return false;

        // === SUPRESSÃO: A SALA DA REGULAR ESTÁ OCUPADA? ===
        if (a.tipo === 'regular') {
            // Se conflita com Regular X na Turma A...
            // Procuramos se existe ALGUMA intensiva na Turma A, nesses mesmos dias e horários.
            const intensivaBlockingRoom = store.allocations.find(i => {
                if (i.tipo !== 'intensiva') return false;
                if (String(i.turmaId) !== String(a.turmaId)) return false; // Deve ser na mesma turma da regular
                
                // Checa data da inserção X data da intensiva bloqueadora
                if (!isDateOverlap(inicio, dataFimCalculada, i.dataInicio, i.dataFim)) return false;

                // Checa horário da regular X horário da intensiva
                const intSlots = (i.horariosOcupados || []).map(normalize);
                return intSlots.includes(normalize(a.horario));
            });

            if (intensivaBlockingRoom) {
                // A sala da regular está tomada. O professor da regular está, portanto, livre (ou dando a intensiva).
                // Conflito Falso.
                return false;
            }
        }

        return true;
    });

    if (conflitoIntensiva) {
        if (String(conflitoIntensiva.turmaId) === String(store.selectedTurma) && conflitoIntensiva.disciplina === disciplina) {
            if(confirm(`Já existe uma alocação para ${disciplina} neste período. Deseja atualizar os horários/slots?`)) {
                store.removeAllocation(conflitoIntensiva.id);
            } else {
                return;
            }
        } else {
            const tipoConflito = conflitoIntensiva.tipo === 'regular' ? 'Regular (Semanal)' : 'Intensiva';
            alert(`Choque de Horário Detectado!\n\n` +
                  `O professor já está ocupado com:\n` +
                  `Disciplina: ${conflitoIntensiva.disciplina}\n` +
                  `Turma ID: ${conflitoIntensiva.turmaId}\n` +
                  `Tipo: ${tipoConflito}`);
            return;
        }
    }

    if (
      !confirm(
        `Componente: ${disciplina} (${ch}h)\n` +
          `Tipo: Intensiva (${slotsCount} slots/dia)\n` +
          `Duração: ${diasNecessarios} dias úteis.\n\n` +
          `De: ${formatDateBR(inicio)}\nAté: ${formatDateBR(dataFimCalculada)}\n\nConfirmar alocação?`
      )
    )
      return;

    const corSelecionada = inputConfig.cor ? inputConfig.cor.value : store.getDisciplinaColor(disciplina);

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
      cor: corSelecionada
    });

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

/**
 * ======= Ofertas List =======
 */
function renderOfertasList() {
  const tbody = document.querySelector('#ofertas-table tbody');
  if (!tbody) return;

  tbody.innerHTML = '';
  const list = store.allocations.filter((a) => String(a.turmaId) === String(store.selectedTurma));

  const feriados = store.rawData?.feriados ? store.rawData.feriados.map((f) => f.data) : [];
  const semestreInicio = calStart ? calStart.value : '2025-01-01';
  const semestreFim = calEnd ? calEnd.value : '2025-12-31';

  const regular = list.filter((a) => a.tipo === 'regular');
  const intensivas = list.filter((a) => a.tipo !== 'regular');

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

  const appendRow = (a) => {
    const tr = document.createElement('tr');
    const info = getDisciplinaInfo(a.disciplina);
    const chMax = info.ch;
    let totalHoras = 0;
    let details = '';

    if (a.tipo === 'regular') {
      const numAulas = countWeekdaysInPeriod(semestreInicio, semestreFim, parseInt(a.diaSemana), feriados);
      totalHoras = numAulas * 1;
      details = `${numAulas} aulas`;
    } else {
      const diasUteis = countBusinessDays(a.dataInicio, a.dataFim);
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
    const horarioTxt =
      a.tipo === 'regular'
        ? `${['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'][a.diaSemana]} ${a.horario}`
        : `${formatDateBR(a.dataInicio)} a ${formatDateBR(a.dataFim)}`;

    tr.innerHTML = `
      <td>${a.disciplina}</td>
      <td>${a.docente}</td>
      <td>${a.tipo}</td>
      <td>${horarioTxt}</td>
      <td style="text-align:center;">${chInfo}</td>
      <td><button class="btn-danger" style="padding:4px; margin:0;">Excluir</button></td>
    `;

    tr.querySelector('button').onclick = () => {
      store.removeAllocation(a.id);
      renderWeeklyGrid();
      renderOfertasList();
    };

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
    appendSeparator('AULAS REGULARES (SEM DATA)');
    regular.forEach(appendRow);
  }

  if (intensivas.length === 0 && regular.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="6" style="text-align:center; color:#666;">Nenhuma oferta cadastrada.</td>`;
    tbody.appendChild(tr);
  }
}

/**
 * ======= Monthly Calendar =======
 */
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

      let html = `<span class="day-number">${dayData.date.split('-')[2]}</span>`;
      const holidayEvent = dayData.events.find((e) => e.type === 'holiday');

      if (holidayEvent) {
        cell.style.background = '#f1f2f6';
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
              const isSuspended = eventsInSlot.some((e) => e.isSuspended);
              
              if (docenteName) {
                  if (hasSpecificConflict || implicitConflict) {
                    style = 'background: #c0392b; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight:bold;';
                    const conflictNames = eventsInSlot.map((e) => getDisciplinaInfo(e.disciplina).abrev).join(' <b style="color:#fff">x</b> ');
                    content = `<span title="Choque: ${conflictNames.replace(/<[^>]+>/g, '')}">⚠️ ${conflictNames}</span>`;
                  } else if (isSuspended) {
                    style = 'background: #f1f2f6; color: #95a5a6; font-style:italic; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border: 1px dashed #bdc3c7;';
                    const suspendedEvent = eventsInSlot.find(e => e.isSuspended);
                    content = `<span title="${suspendedEvent.title}">${suspendedEvent.title}</span>`;
                  } else {
                    const event = eventsInSlot[0];
                    const info = getDisciplinaInfo(event.disciplina);
                    content = info.abrev;
                    style = `background:${event.cor || '#bdc3c7'}; color:black;`;
                  }
              } else {
                  const event = eventsInSlot[0];
                  const info = getDisciplinaInfo(event.disciplina);
                  content = info.abrev;
                  style = `background:${event.cor || '#bdc3c7'}; color:black;`;
              }
            } else {
               content = '&nbsp;'; 
               style = 'background: #ecf0f1;'; 
            }

            html += `
              <div class="cal-slot-row">
                <div class="cal-slot-time">${timeLabel}</div>
                <div class="cal-slot-content" style="${style}">${content}</div>
              </div>`;
          });
        } else {
          dayData.events.forEach((ev) => {
            const info = getDisciplinaInfo(ev.disciplina);
            const style = `background:${ev.cor || '#bdc3c7'}`;
            html += `<div class="event-chip" style="${style}">${info.abrev}</div>`;
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

/**
 * ======= Utils =======
 */
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