import { store } from './store.js';
import { getCalendarEvents } from './calendar.js';
import { countBusinessDays, countWeekdaysInPeriod, addBusinessDays } from './utils.js';

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
  docente: document.getElementById('inp-docente'),
  tipo: document.getElementById('sel-tipo'),
  inicio: document.getElementById('inp-data-inicio'),
  fim: document.getElementById('inp-data-fim')
};

let tempImportData = null;

/**
 * ======= Auxiliar de Tempo =======
 * Converte "07:30" para minutos (450) para ordenar a grade corretamente.
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
  // Adiciona o botão de limpar também na visão do professor
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
  btn.setAttribute('aria-label', `Limpar ${inputId}`);
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
    // Dispara eventos para atualizar a UI
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    inputEl.focus();
    toggleVisibility();
  });

  inputEl.addEventListener('input', toggleVisibility);
  inputEl.addEventListener('change', toggleVisibility);

  // Posicionamento relativo ao container do input
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
 * Extrai apenas "HH:MM - HH:MM" se existir.
 */
function cleanHorarioLabel(s) {
  const str = (s ?? '').toString();
  const m = str.match(/\b\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}\b/);
  if (m) return m[0];
  return str;
}

/**
 * Garante "Intervalo" com capitalização consistente.
 */
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

/**
 * Monta a lista final de horários que a UI vai renderizar.
 * MODO ESTRITO: Retorna apenas o que está no turno configurado na sidebar.
 */
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

  if (inputConfig.tipo) {
    inputConfig.tipo.addEventListener('change', (e) => {
      const div = document.getElementById('datas-intensiva');
      if (!div) return;

      if (e.target.value === 'intensiva') {
        div.classList.remove('hidden');
        if (store.settings.termStart && inputConfig.inicio && !inputConfig.inicio.value) {
          inputConfig.inicio.value = store.settings.termStart;
        }
      } else {
        div.classList.add('hidden');
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

  // ======= Visão do Professor =======
  if (selViewDocente) {
    // 1. Ao selecionar/mudar o nome, renderiza o calendário
    selViewDocente.addEventListener('change', () => {
        renderTeacherCalendar();
        selViewDocente.blur(); // Tira o foco para melhorar UX em mobile
    });

    // 2. Se apagar o texto manualmente, limpa o calendário
    selViewDocente.addEventListener('input', () => {
        if (!selViewDocente.value) {
            document.getElementById('teacher-calendar-container').innerHTML = '';
        }
    });
  }

  // Import modal
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
}

function onCursoChange() {
  const cursoSigla = selCurso.value;
  store.selectedCurso = cursoSigla;

  selTurma.disabled = !cursoSigla;
  selTurma.innerHTML = '<option value="">Selecione...</option>';

  if (cursoSigla && store.rawData?.turmas) {
    const turmas = store.rawData.turmas.filter((t) => t.sigla === cursoSigla);
    turmas.forEach((t) => {
      selTurma.innerHTML += `<option value="${t.turma_id}">${t.turma_label}</option>`;
    });
    updateDisciplinaDatalist();
  }

  store.selectedTurma = '';
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

  // 1. Pega nomes únicos e ordena
  const nomes = [...new Set(store.rawData.docentes.map((d) => d.docente))].sort();

  // 2. Preenche lista da Sidebar
  if (listDocentes) {
    listDocentes.innerHTML = '';
    nomes.forEach((nome) => {
      listDocentes.appendChild(new Option(nome, nome));
    });
  }

  // 3. Preenche lista da Visão do Professor
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

  // Detecção Automática de Turno (Manhã vs Tarde):
  const alocacoesTurma = store.allocations.filter(a => String(a.turmaId) === String(store.selectedTurma));
  const primeiraAula = alocacoesTurma.find(a => a.tipo === 'regular' && a.horario);
  
  if (primeiraAula) {
      const hora = parseInt(primeiraAula.horario.split(':')[0]);
      if (hora < 12) store.setTurnoOferta('Manhã');
      else store.setTurnoOferta('Tarde'); // Sem noturno
  } 
  else if (store.rawData?.turmas && store.selectedTurma) {
    const t = store.rawData.turmas.find(x => String(x.turma_id) === String(store.selectedTurma));
    if (t?.turno) store.setTurnoOferta(t.turno);
  }

  // Ajuste de Datas
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

/**
 * ======= Disciplina info =======
 */
function getDisciplinaInfo(nomeComponente) {
  if (!store.rawData?.componentes) return { abrev: nomeComponente, ch: 0 };

  const c =
    store.rawData.componentes.find(
      (x) => x.componente === nomeComponente && x.sigla === store.selectedCurso
    ) || store.rawData.componentes.find((x) => x.componente === nomeComponente);

  if (c) return { abrev: c.abreviacao || c.componente, ch: c.ch || 0 };
  return { abrev: nomeComponente, ch: 0 };
}

/**
 * ======= Weekly Grid =======
 */
function renderWeeklyGrid() {
  if (!gridContainer) return;
  gridContainer.innerHTML = '';

  // Grade da Turma é ESTRITA (só mostra o turno selecionado)
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

  const { disciplina, docente, tipo } = getInputValues();
  if (!disciplina || !docente) return alert('Preencha Componente e Docente na lateral.');
  if (tipo === 'intensiva') return alert('Para intensivas, configure as datas no menu e clique em "Adicionar à Grade".');

  const conflito = checkTeacherConflict(docente, dia, horario);
  if (conflito) {
    if (!confirm(`O professor ${docente} já ministra aula na turma ${conflito.turmaId} neste horário. Continuar?`)) return;
  }

  store.addAllocation({
    turmaId: store.selectedTurma,
    disciplina,
    docente,
    tipo,
    diaSemana: dia,
    horario,
    cor: store.getDisciplinaColor(disciplina)
  });

  renderWeeklyGrid();
  renderOfertasList();
}

function handleAddManual() {
  if (!store.selectedTurma) return alert('Selecione uma turma.');
  const vals = getInputValues();
  if (!vals.disciplina || !vals.docente) return alert('Preencha todos os campos.');

  if (vals.tipo === 'intensiva') {
    if (!vals.inicio) return alert('Defina a data de início.');

    const info = getDisciplinaInfo(vals.disciplina);
    const ch = info.ch || 0;
    if (ch === 0) return alert(`O componente "${vals.disciplina}" tem CH 0 ou não foi encontrado.`);

    const diasNecessarios = Math.ceil(ch / 5);
    const feriados = store.rawData?.feriados || [];
    const dataFimCalculada = addBusinessDays(vals.inicio, diasNecessarios, feriados);

    const slotsTurmaRaw = store.getHorariosTurma() || [];
    const slotsOrdenados = slotsTurmaRaw
      .map((h) => cleanHorarioLabel(h))
      .filter((h) => h && String(h).trim().length > 0);

    if (slotsOrdenados.length < 6) {
      return alert(
        'Erro: para intensivas com regra "ordem 4 = intervalo", o turno precisa ter pelo menos 6 linhas (ordem 1..6).\n' +
          `Encontradas: ${slotsOrdenados.length}.`
      );
    }

    const slotsIntensiva = [slotsOrdenados[0], slotsOrdenados[1], slotsOrdenados[2], slotsOrdenados[4], slotsOrdenados[5]].filter(Boolean);

    if (slotsIntensiva.length !== 5) {
      return alert('Erro: não consegui montar 5 horários para intensiva.\n' + `Montados: ${slotsIntensiva.length}`);
    }

    // --- NOVA VALIDAÇÃO: Choque de Intensivas (Mesma Turma e Horário) ---
    const normalize = s => (s || '').replace(/\s/g, '');
    
    const conflitoIntensiva = store.allocations.find(a => {
        // Filtra: Mesma Turma e Tipo Intensiva
        if (a.turmaId !== store.selectedTurma) return false;
        if (a.tipo !== 'intensiva') return false; 
        
        // 1. Verifica Sobreposição de Datas
        const overlapData = (vals.inicio <= a.dataFim && dataFimCalculada >= a.dataInicio);
        if (!overlapData) return false;

        // 2. Verifica Sobreposição de Horários (Slots)
        // Se a intensiva existente não tiver horarios definidos (erro de dados), bloqueia por segurança
        if (!a.horariosOcupados || !Array.isArray(a.horariosOcupados)) return true;
        
        // Compara se algum horário da nova intensiva já está ocupado pela existente
        const overlapHorario = a.horariosOcupados.some(savedSlot => 
            slotsIntensiva.some(newSlot => normalize(savedSlot) === normalize(newSlot))
        );
        return overlapHorario;
    });

    if (conflitoIntensiva) {
        alert("Outra disciplina vem sendo ministrada. Verifique o horário e dia de início dessa componente intensiva que está tentando alocar.");
        return;
    }
    // --------------------------------------------------------------------

    if (
      !confirm(
        `Componente: ${vals.disciplina} (${ch}h)\n` +
          `Duração calculada: ${diasNecessarios} dias úteis.\n\n` +
          `De: ${formatDateBR(vals.inicio)}\nAté: ${formatDateBR(dataFimCalculada)}\n\nConfirmar alocação?`
      )
    )
      return;

    store.addAllocation({
      turmaId: store.selectedTurma,
      disciplina: vals.disciplina,
      docente: vals.docente,
      tipo: 'intensiva',
      dataInicio: vals.inicio,
      dataFim: dataFimCalculada,
      modelo: 'Automático',
      horariosOcupados: slotsIntensiva,
      cor: store.getDisciplinaColor(vals.disciplina)
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
  const end = calEnd ? calEnd.value : '2025-12-31';

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
  const end = calEnd ? calEnd.value : '2025-12-31';

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
    // CASO 1: TURMA (ESTRITO)
    // Mostra APENAS o turno selecionado na sidebar.
    slotsToRender = buildHorariosForUI();
  } 
  else if (docenteName) {
    // CASO 2: PROFESSOR (ESQUELETO PADRÃO: MANHÃ + TARDE)
    // Buscamos a estrutura oficial "Manhã" e "Tarde" em rawData.
    const hp = store.rawData?.horarios_por_turno || {};
    const skeleton = [];

    // Adiciona Manhã e Tarde na ordem
    if (hp['Manhã']) skeleton.push(...hp['Manhã']);
    if (hp['Tarde']) skeleton.push(...hp['Tarde']);

    // Fallback: se não tiver config, varre alocações
    if (skeleton.length === 0) {
        if (store.allocations) {
            store.allocations.forEach(a => {
                if (a.horario) skeleton.push(a.horario);
                if (a.horariosOcupados) a.horariosOcupados.forEach(h => skeleton.push(h));
            });
        }
    }

    // Limpa, padroniza e ordena
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

            // --- FILTRO ROBUSTO (SEM ESPAÇOS) ---
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
              const isConflict = eventsInSlot.some((e) => e.isConflict);
              
              // SÓ MOSTRA CHOQUE SE FOR VISÃO DO PROFESSOR (docenteName existe)
              if (isConflict && docenteName) {
                 // Estilo LINHA ÚNICA (Altura Normal)
                 // ALERTA VERMELHO para o conflito
                 style = 'background: #c0392b; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight:bold;';
                 
                 const conflictNames = eventsInSlot
                  .map((e) => getDisciplinaInfo(e.disciplina).abrev)
                  .join(' <b style="color:#fff">x</b> ');

                 content = `<span title="Choque: ${conflictNames.replace(/<[^>]+>/g, '')}">⚠️ ${conflictNames}</span>`;
              } else {
                const event = eventsInSlot[0];
                const info = getDisciplinaInfo(event.disciplina);
                content = info.abrev;
                style = `background:${event.cor || '#bdc3c7'}; color:black;`;
              }
            } else {
              content = '&nbsp;';
            }

            html += `
              <div class="cal-slot-row" style="${style}">
                <div class="cal-slot-time">${timeLabel}</div>
                <div class="cal-slot-content">${content}</div>
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