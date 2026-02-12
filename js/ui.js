import { store } from './store.js';
import { getCalendarEvents } from './calendar.js';
import {
  countBusinessDays,
  countWeekdaysInPeriod,
  formatDate,
  checkTimeConflict,
  parseTime,
  addBusinessDays
} from './utils.js';

// Elementos Globais
const gridContainer = document.getElementById('weekly-grid');
const selCurso = document.getElementById('sel-curso');
const selTurma = document.getElementById('sel-turma');
const listDisciplinas = document.getElementById('list-disciplinas');
const listDocentes = document.getElementById('list-docentes');
const selViewDocente = document.getElementById('sel-view-docente');

// Configurações persistentes (sidebar)
const inpTermStart = document.getElementById('term-start');
const inpTermEnd = document.getElementById('term-end');
const selTurnoOferta =
  document.getElementById('sel-turno_oferta') ||
  document.getElementById('sel-turno-oferta'); // tolera id antigo

// Controles de período (tabs)
const calStart = document.getElementById('cal-start');
const calEnd = document.getElementById('cal-end');

// Inputs Config
const inputConfig = {
  disciplina: document.getElementById('inp-disciplina'),
  docente: document.getElementById('inp-docente'),
  tipo: document.getElementById('sel-tipo'),
  inicio: document.getElementById('inp-data-inicio'),
  fim: document.getElementById('inp-data-fim')
};

// Variável temporária para importação
let tempImportData = null;

/**
 * ======= Helpers (fallback robusto para horários) =======
 */
function normalizeTurnoLabel(s) {
  return (s || '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function asHorariosArray(val, horariosObj) {
  if (!val) return [];

  // 1) Se já é um array de strings
  if (Array.isArray(val)) {
    const arr = val.filter(x => typeof x === 'string');

    // Caso especial: array veio com "chaves/labels" em vez de horários
    // Ex.: ["MANHA_EXTENDIDO"] ou ["manha_extendido"]
    if (arr.length > 0) {
      const first = arr[0];
      const firstNorm = normalizeTurnoLabel(first);
      const looksLikeKey =
        firstNorm.includes('extendido') ||
        firstNorm === 'manha' ||
        firstNorm === 'tarde' ||
        firstNorm === 'noite';

      if (looksLikeKey && horariosObj && typeof horariosObj === 'object') {
        const resolved = horariosObj[first] ?? horariosObj[firstNorm];
        if (Array.isArray(resolved)) return resolved.filter(x => typeof x === 'string');
      }
    }

    return arr;
  }

  // 2) Se é uma string apontando para uma chave dentro de horariosObj
  if (typeof val === 'string') {
    const k = val;
    if (horariosObj && typeof horariosObj === 'object') {
      const resolved = horariosObj[k] ?? horariosObj[normalizeTurnoLabel(k)];
      if (Array.isArray(resolved)) return resolved.filter(x => typeof x === 'string');
    }
    return [];
  }

  return [];
}

function getHorariosFromRawDataByTurno(turnoLabel) {
  if (!store.rawData || !store.rawData.horarios) return [];

  const h = store.rawData.horarios;

  // Se rawData.horarios já for um array direto
  if (Array.isArray(h)) return h.filter(x => typeof x === 'string');

  const t = normalizeTurnoLabel(turnoLabel);

  const candidates = [];
  if (t.includes('manha')) candidates.push('manha_extendido', 'manha', 'matutino');
  if (t.includes('tarde')) candidates.push('tarde_extendido', 'tarde', 'vespertino');
  if (t.includes('noite')) candidates.push('noite_extendido', 'noite', 'noturno');

  // Se não reconheceu, tenta em ordem de prioridade
  if (candidates.length === 0)
    candidates.push('tarde_extendido', 'manha_extendido', 'noite_extendido', 'tarde', 'manha', 'noite');

  for (const key of candidates) {
    if (h && typeof h === 'object' && key in h) {
      const arr = asHorariosArray(h[key], h);
      if (arr.length > 0) return arr;
    }
  }

  // fallback: qualquer lista válida dentro de h
  if (h && typeof h === 'object') {
    for (const v of Object.values(h)) {
      const arr = asHorariosArray(v, h);
      if (arr.length > 0) return arr;
    }
  }

  return [];
}

function getHorariosTurmaSafe() {
  // 1) tenta a implementação original do store
  try {
    const base = store.getHorariosTurma ? store.getHorariosTurma() : [];
    if (Array.isArray(base) && base.length > 0) return base.filter(x => typeof x === 'string');
  } catch (e) {
    console.warn('store.getHorariosTurma() falhou:', e);
  }

  // 2) fallback por turno (preferência do usuário) ou turno_padrao da turma
  let turno = store.settings?.turnoOferta || '';

  if (!turno && store.rawData?.turmas && store.selectedTurma) {
    const turmaObj = store.rawData.turmas.find(t => String(t.turma_id) === String(store.selectedTurma));
    if (turmaObj && turmaObj.turno_padrao) turno = turmaObj.turno_padrao;
  }

  const horarios = getHorariosFromRawDataByTurno(turno);
  if (horarios.length > 0) return horarios;

  // 3) fallback final: tenta qualquer array em rawData.horarios
  const h = store.rawData?.horarios;
  if (h && typeof h === 'object') {
    const firstNonEmpty = Object.values(h)
      .map(v => asHorariosArray(v, h))
      .find(arr => Array.isArray(arr) && arr.length > 0);
    if (firstNonEmpty) return firstNonEmpty;
  }

  return [];
}

function cleanHorarioLabel(s) {
  const str = (s ?? '').toString();

  // tenta extrair "HH:MM - HH:MM" ou "HH:MM–HH:MM"
  const m = str.match(/\b\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}\b/);
  if (m) return m[0];

  // remove lixo tipo "MANHA_EXTENDIDO"
  const n = normalizeTurnoLabel(str);
  if (n.includes('extendido') || n === 'manha' || n === 'tarde' || n === 'noite') return '';

  return str;
}

/**
 * ======= Período letivo + turno =======
 */
function initPeriodoLetivoETurno() {
  if (!store.settings) return;

  const defaultStart = calStart && calStart.value ? calStart.value : '';
  const defaultEnd = calEnd && calEnd.value ? calEnd.value : '';

  if (!store.settings.termStart && defaultStart) store.settings.termStart = defaultStart;
  if (!store.settings.termEnd && defaultEnd) store.settings.termEnd = defaultEnd;
  if (!store.settings.turnoOferta) store.settings.turnoOferta = 'Tarde';

  if (typeof store.saveSettings === 'function') store.saveSettings();

  // Store -> UI
  if (inpTermStart && store.settings.termStart) inpTermStart.value = store.settings.termStart;
  if (inpTermEnd && store.settings.termEnd) inpTermEnd.value = store.settings.termEnd;
  if (selTurnoOferta) selTurnoOferta.value = store.settings.turnoOferta || 'Tarde';

  if (calStart && store.settings.termStart) calStart.value = store.settings.termStart;
  if (calEnd && store.settings.termEnd) calEnd.value = store.settings.termEnd;

  // Sidebar -> Tabs / Store
  if (inpTermStart) {
    inpTermStart.addEventListener('change', () => {
      store.setTermDates(inpTermStart.value, store.settings.termEnd);
      if (calStart) calStart.value = inpTermStart.value;

      if (inputConfig.inicio && !inputConfig.inicio.value) {
        inputConfig.inicio.value = inpTermStart.value;
      }
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

  // Tabs -> Sidebar / Store
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

  if (inputConfig.tipo) {
    inputConfig.tipo.addEventListener('change', e => {
      const div = document.getElementById('datas-intensiva');
      if (!div) return;

      if (e.target.value === 'intensiva') {
        div.classList.remove('hidden');

        if (store.settings && store.settings.termStart && inputConfig.inicio && !inputConfig.inicio.value) {
          inputConfig.inicio.value = store.settings.termStart;
        }

        if (store.settings && inputConfig.inicio) {
          if (store.settings.termStart) inputConfig.inicio.min = store.settings.termStart;
          if (store.settings.termEnd) inputConfig.inicio.max = store.settings.termEnd;
        }
      } else {
        div.classList.add('hidden');
      }
    });
  }

  const btnAdd = document.getElementById('btn-add-oferta');
  if (btnAdd) btnAdd.addEventListener('click', handleAddManual);

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  const btnGerarCal = document.getElementById('btn-gerar-cal');
  if (btnGerarCal) btnGerarCal.addEventListener('click', renderMonthlyCalendar);

  if (selViewDocente) selViewDocente.addEventListener('change', renderTeacherCalendar);

  // --- Importação (Modal) ---
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
      const json = JSON.parse(e.target.result);
      tempImportData = json;
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
 * ======= Populate / Selects =======
 */
function populateCursos() {
  if (!store.rawData || !selCurso) return;

  selCurso.innerHTML = '<option value="">Selecione...</option>';
  if (store.rawData.cursos) {
    store.rawData.cursos.forEach(c => {
      selCurso.innerHTML += `<option value="${c.sigla}">${c.nome}</option>`;
    });
  }
}

function onCursoChange() {
  const cursoSigla = selCurso.value;
  store.selectedCurso = cursoSigla;

  selTurma.disabled = !cursoSigla;
  selTurma.innerHTML = '<option value="">Selecione...</option>';

  if (cursoSigla && store.rawData.turmas) {
    const turmas = store.rawData.turmas.filter(t => t.curso_sigla === cursoSigla);
    turmas.forEach(t => {
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
  if (!store.selectedCurso || !store.rawData.disciplinas) return;

  const disciplinasDoCurso = store.rawData.disciplinas.filter(d => d.curso_sigla === store.selectedCurso);

  disciplinasDoCurso.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.nome;
    opt.setAttribute('data-ch', d.ch);
    opt.setAttribute('data-abrev', d.abreviacao || d.nome);
    listDisciplinas.appendChild(opt);
  });
}

function populateDocentes() {
  if (!listDocentes || !selViewDocente || !store.rawData.docentes) return;

  listDocentes.innerHTML = '';
  selViewDocente.innerHTML = '<option value="">Selecione...</option>';

  const nomes = [...new Set(store.rawData.docentes.map(d => d.nome))].sort();
  nomes.forEach(nome => {
    listDocentes.appendChild(new Option(nome));
    selViewDocente.add(new Option(nome, nome));
  });
}

function onTurmaChange() {
  store.selectedTurma = selTurma.value;

  // Se o turno ainda não foi definido pelo usuário, usa o turno padrão da turma selecionada
  if (store.rawData && store.rawData.turmas && store.selectedTurma && (!store.settings || !store.settings.turnoOferta)) {
    const turmaObj = store.rawData.turmas.find(t => String(t.turma_id) === String(store.selectedTurma));
    if (turmaObj && turmaObj.turno_padrao) {
      store.setTurnoOferta(turmaObj.turno_padrao);
      if (selTurnoOferta) selTurnoOferta.value = turmaObj.turno_padrao;
    }
  }

  renderWeeklyGrid();
  renderOfertasList();
}

/**
 * ======= Disciplina info =======
 */
function getDisciplinaInfo(nome) {
  if (!store.rawData) return { abrev: nome, ch: 0 };

  let d = store.rawData.disciplinas.find(x => x.nome === nome && x.curso_sigla === store.selectedCurso);
  if (!d) d = store.rawData.disciplinas.find(x => x.nome === nome);

  if (d) return { abrev: d.abreviacao || d.nome, ch: d.ch || 0 };
  return { abrev: nome, ch: 0 };
}

/**
 * ======= Weekly Grid =======
 */
function renderWeeklyGrid() {
  if (!gridContainer) return;
  gridContainer.innerHTML = '';

  const horariosRaw = getHorariosTurmaSafe();
  const horariosClean = horariosRaw
    .map(cleanHorarioLabel)
    .filter(s => s && s.trim().length > 0);

  const dias = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

  if (!store.selectedTurma || horariosClean.length === 0) {
    gridContainer.innerHTML = `
      <p style="grid-column: 1/-1; padding: 20px;">
        Selecione uma turma válida.
        <br><small style="color:#666;">
          (Depuração: turma=${store.selectedTurma || '(vazio)'} | turno=${store.settings?.turnoOferta || '(vazio)'})
        </small>
      </p>`;
    return;
  }

  gridContainer.appendChild(createCell('header', ''));
  dias.forEach(d => gridContainer.appendChild(createCell('header', d)));

  horariosClean.forEach(horarioStr => {
    const isIntervalo = horarioStr.toUpperCase().includes('INTERVALO');

    const hDiv = createCell('header', horarioStr);
    if (isIntervalo) hDiv.style.background = '#e0e0e0';
    gridContainer.appendChild(hDiv);

    if (isIntervalo) {
      const intDiv = createCell('header', 'INTERVALO');
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

        const alloc = store.allocations.find(a =>
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
}

function createCell(type, text) {
  const div = document.createElement('div');
  div.className = type;
  div.textContent = text;
  return div;
}

function renderSlotContent(cell, alloc) {
  cell.style.backgroundColor = alloc.cor;
  const info = getDisciplinaInfo(alloc.disciplina);

  cell.innerHTML = `
    <div style="font-size:0.85em; font-weight:bold; line-height:1.2; margin-bottom:2px;">${info.abrev}</div>
    <div style="font-size:0.75em; color:#444;">${alloc.docente.split(' ')[0]}</div>
    <span class="remove-btn" style="color:red; font-weight:bold; font-size:0.8em; position:absolute; top:2px; right:2px;">×</span>
  `;

  cell.querySelector('.remove-btn').onclick = e => {
    e.stopPropagation();
    if (confirm('Remover esta aula?')) {
      store.removeAllocation(alloc.id);
      renderWeeklyGrid();
      renderOfertasList();
    }
  };
}

function handleSlotClick(dia, horario) {
  if (!store.selectedTurma) return alert('Selecione uma turma.');

  const { disciplina, docente, tipo } = getInputValues();
  if (!disciplina || !docente) return alert('Preencha Disciplina e Docente na lateral.');
  if (tipo === 'intensiva') return alert('Para intensivas, configure as datas no menu e clique em "Adicionar à Grade".');

  const conflito = checkTimeConflict ? checkTeacherConflict(docente, dia, horario) : false;
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

/**
 * ======= Manual Add =======
 */
function handleAddManual() {
  if (!store.selectedTurma) return alert('Selecione uma turma.');
  const vals = getInputValues();

  if (!vals.disciplina || !vals.docente) return alert('Preencha todos os campos.');

  if (vals.tipo === 'intensiva') {
    if (!vals.inicio) return alert('Defina a data de início.');

    const info = getDisciplinaInfo(vals.disciplina);
    const ch = info.ch || 0;

    if (ch === 0) return alert(`A disciplina "${vals.disciplina}" tem Carga Horária 0 ou não foi encontrada no cadastro.`);

    const diasNecessarios = Math.ceil(ch / 5);
    const feriados = store.rawData.feriados || [];

    const dataFimCalculada = addBusinessDays(vals.inicio, diasNecessarios, feriados);

    const slotsTurma = getHorariosTurmaSafe();
    const slotsReais = slotsTurma
      .map(cleanHorarioLabel)
      .filter(h => h && !h.toUpperCase().includes('INTERVALO'));

    const slotsIntensiva = slotsReais.slice(0, 5);

    if (slotsIntensiva.length === 0) return alert('Erro: Não há horários configurados para esta turma.');

    if (
      !confirm(
        `Disciplina: ${vals.disciplina} (${ch}h)\n` +
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
    disciplina: inputConfig.disciplina?.value ?? '',
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

  const list = store.allocations.filter(a => String(a.turmaId) === String(store.selectedTurma));

  const feriados = store.rawData.feriados ? store.rawData.feriados.map(f => f.data) : [];
  const calStartEl = document.getElementById('cal-start');
  const calEndEl = document.getElementById('cal-end');
  const semestreInicio = calStartEl ? calStartEl.value : '2025-01-01';
  const semestreFim = calEndEl ? calEndEl.value : '2025-12-31';

  const regular = list.filter(a => a.tipo === 'regular');
  const intensivas = list.filter(a => a.tipo !== 'regular');

  intensivas.sort((a, b) => (a.dataInicio || '').localeCompare(b.dataInicio || ''));
  regular.sort((a, b) => (a.disciplina || '').localeCompare(b.disciplina || ''));

  const appendSeparator = label => {
    const tr = document.createElement('tr');
    tr.className = 'month-sep';
    tr.innerHTML = `<td colspan="6">${label}</td>`;
    tbody.appendChild(tr);
  };

  const appendMonthSeparator = monthKey => {
    const [y, m] = monthKey.split('-').map(n => parseInt(n, 10));
    const nomeMes = new Date(y, m - 1, 2).toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
    appendSeparator(nomeMes.toUpperCase());
  };

  const appendRow = a => {
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

  // Intensivas agrupadas por mês
  let currentMonth = null;
  intensivas.forEach(a => {
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

  // Regulares no final
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
  if (store.rawData && store.rawData.turmas) {
    const t = store.rawData.turmas.find(x => String(x.turma_id) === String(store.selectedTurma));
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

  let conflictCount = 0;
  Object.values(eventsByDate).forEach(events => {
    events.forEach(e => {
      if (e.isConflict) conflictCount++;
    });
  });
  conflictCount = Math.ceil(conflictCount / 2);

  if (conflictCount > 0) {
    const alertDiv = document.createElement('div');
    alertDiv.className = 'no-print';
    alertDiv.style.cssText =
      'background: #c0392b; color: white; padding: 10px; text-align: center; margin-bottom: 20px; border-radius: 4px; font-weight: bold;';
    alertDiv.innerHTML = `⚠️ Atenção: ${conflictCount} conflitos de horário detectados nesta visualização. Verifique os blocos em cinza.`;
    container.appendChild(alertDiv);
  }

  let slotsToRender = [];
  if (turmaId) {
    slotsToRender = getHorariosTurmaSafe().map(cleanHorarioLabel).filter(s => s && s.trim().length > 0);
  } else if (docenteName) {
    const h = store.rawData?.horarios || {};
    const m = Array.isArray(h['manha_extendido']) ? h['manha_extendido'] : [];
    const t = Array.isArray(h['tarde_extendido']) ? h['tarde_extendido'] : [];
    slotsToRender = [...m, ...t].map(cleanHorarioLabel).filter(s => s && s.trim().length > 0);
  }

  const months = {};
  Object.keys(eventsByDate)
    .sort()
    .forEach(dateStr => {
      const k = dateStr.substring(0, 7);
      if (!months[k]) months[k] = [];
      months[k].push({ date: dateStr, events: eventsByDate[dateStr] });
    });

  Object.keys(months).forEach(monthKey => {
    const monthDiv = document.createElement('div');
    monthDiv.className = 'calendar-month';

    const [y, m] = monthKey.split('-');
    const nomeMes = new Date(y, m - 1, 2).toLocaleString('pt-BR', { month: 'long', year: 'numeric' });

    monthDiv.innerHTML = `<h3>${nomeMes.toUpperCase()}</h3>`;

    const grid = document.createElement('div');
    grid.className = 'month-grid';
    ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].forEach(d => (grid.innerHTML += `<div class="day-header">${d}</div>`));

    const firstDate = months[monthKey][0].date;
    const startDow = new Date(firstDate + 'T12:00:00').getDay();
    for (let i = 0; i < startDow; i++) grid.innerHTML += `<div class="day-cell empty"></div>`;

    months[monthKey].forEach(dayData => {
      const cell = document.createElement('div');
      cell.className = 'day-cell';
      const dt = new Date(dayData.date + 'T12:00:00');

      if (dt.getDay() === 0 || dt.getDay() === 6) cell.classList.add('weekend');

      let html = `<span class="day-number">${dayData.date.split('-')[2]}</span>`;
      const holidayEvent = dayData.events.find(e => e.type === 'holiday');

      if (holidayEvent) {
        cell.style.background = '#f1f2f6';
        html += `<div style="text-align:center; color:#7f8c8d; font-style:italic; padding-top:10px; font-weight:bold; font-size:0.9em;">
                  ${holidayEvent.title}
                 </div>`;
      } else {
        if (slotsToRender.length > 0) {
          slotsToRender.forEach((slotTime, index) => {
            const isIntervalo = slotTime.toUpperCase().includes('INTERVALO');
            const timeMatch = slotTime.match(/\d{2}:\d{2}/);
            const timeLabel = timeMatch ? timeMatch[0] : '';
            const currentHour = timeLabel ? parseInt(timeLabel.split(':')[0], 10) : 0;

            let rowExtraStyle = '';
            if (index > 0 && currentHour >= 13) {
              const prevMatch = slotsToRender[index - 1].match(/\d{2}:\d{2}/);
              const prevHour = prevMatch ? parseInt(prevMatch[0].split(':')[0], 10) : 0;
              if (prevHour <= 12) rowExtraStyle = 'border-top: 1px solid var(--primary);';
            }

            const eventsInSlot = dayData.events.filter(
              e => e.horario === slotTime || (e.horariosOcupados && e.horariosOcupados.includes(slotTime))
            );

            let content = '';
            let style = '';

            if (isIntervalo) {
              content = '<span style="color:#95a5a6; font-style:italic; font-size:0.85em;">Intervalo</span>';
              style = 'background:#f4f6f7;';
            } else if (eventsInSlot.length > 0) {
              const isConflict = eventsInSlot.some(e => e.isConflict);
              if (isConflict) {
                style = 'background: #7f8c8d; color: white; border: 2px solid #c0392b;';
                content =
                  `⚠️ CHOQUE! <br>` +
                  eventsInSlot
                    .map(e => {
                      const info = getDisciplinaInfo(e.disciplina);
                      return `<small>[${e.turmaId}] ${info.abrev}</small>`;
                    })
                    .join('<br>');
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
              <div class="cal-slot-row" style="${rowExtraStyle} ${style}">
                <div class="cal-slot-time">${timeLabel}</div>
                <div class="cal-slot-content" title="${content.replace(/<[^>]*>?/gm, '')}">${content}</div>
              </div>`;
          });
        } else {
          dayData.events.forEach(ev => {
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

function checkTeacherConflict(docente, dia, horario) {
  return store.allocations.find(a => a.docente === docente && a.diaSemana == dia && a.horario === horario);
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

  const tabEl = document.getElementById(`tab-${tabId}`);
  if (tabEl) tabEl.classList.add('active');

  const btn = document.querySelector(`button[data-tab="${tabId}"]`);
  if (btn) btn.classList.add('active');
}

export {
  renderWeeklyGrid,
  renderOfertasList,
  renderMonthlyCalendar,
  renderTeacherCalendar
};
