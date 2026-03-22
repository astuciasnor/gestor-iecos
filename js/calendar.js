import { store } from './store.js';
import { getDaysArray, toLocalDateString } from './utils.js';

function getAllocationTipo(alloc) {
  return String(alloc?.tipo || '').trim().toLowerCase();
}

function usesFaixaSchedule(alloc) {
  return getAllocationTipo(alloc) === 'intensiva';
}

function isPreferredRegularAllocation(alloc) {
  return getAllocationTipo(alloc) === 'regular_prioritaria';
}

function isStandardRegularAllocation(alloc) {
  return getAllocationTipo(alloc) === 'regular';
}
function getFaixaExecutionByDateMap(faixaAlloc) {
  const raw = faixaAlloc?.executionByDate;
  if (!raw || typeof raw !== 'object') return null;

  const normalized = {};
  Object.keys(raw)
    .sort()
    .forEach((dateStr) => {
      const slots = Array.isArray(raw[dateStr]) ? raw[dateStr].filter(Boolean).map(String) : [];
      if (slots.length > 0) normalized[dateStr] = slots;
    });

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function getFallbackFaixaConfigs(faixaAlloc) {
  const fallback = [{
    inicio: faixaAlloc.dataInicio,
    slots: faixaAlloc.horariosOcupados || [],
    dias: faixaAlloc.usaSabado ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5]
  }];

  if (Array.isArray(faixaAlloc?.faixas) && faixaAlloc.faixas.length > 0) {
    return [...faixaAlloc.faixas].sort((a, b) => a.inicio.localeCompare(b.inicio));
  }

  return fallback;
}

function getFallbackFaixaForDate(faixaAlloc, dateStr) {
  const faixasDataList = getFallbackFaixaConfigs(faixaAlloc);
  let activeFaixa = faixasDataList[0] || null;

  faixasDataList.forEach((faixa) => {
    if (dateStr >= faixa.inicio) activeFaixa = faixa;
  });

  return activeFaixa;
}

function getFaixaSlotsForCalendarDate(faixaAlloc, dateStr, feriadosList = []) {
  const executionByDate = getFaixaExecutionByDateMap(faixaAlloc);
  if (executionByDate) {
    return Array.isArray(executionByDate[dateStr]) ? executionByDate[dateStr].slice() : [];
  }

  const currentDow = new Date(dateStr + 'T12:00:00').getDay();
  const isHoliday = feriadosList.some((f) => (f.data || f) === dateStr);
  if (isHoliday) return [];

  const activeFaixa = getFallbackFaixaForDate(faixaAlloc, dateStr);
  if (!activeFaixa?.dias?.includes(currentDow)) return [];

  const slotsToday = activeFaixa.drawnSlotsByDay
    ? (activeFaixa.drawnSlotsByDay[currentDow] || [])
    : (activeFaixa.slots || []);

  if (Array.isArray(faixaAlloc?.horariosUltimoDia) && faixaAlloc.horariosUltimoDia.length > 0 && dateStr === faixaAlloc.dataFim) {
    return slotsToday.filter((slotTime) => faixaAlloc.horariosUltimoDia.includes(slotTime));
  }

  return slotsToday.slice();
}

function countFaixaHoursBeforeDate(faixaAlloc, targetDateStr, feriadosList = []) {
  const executionByDate = getFaixaExecutionByDateMap(faixaAlloc);
  if (executionByDate) {
    return Object.keys(executionByDate)
      .filter((dateStr) => dateStr < targetDateStr)
      .reduce((sum, dateStr) => sum + (Array.isArray(executionByDate[dateStr]) ? executionByDate[dateStr].length : 0), 0);
  }

  let total = 0;
  const cursor = new Date(faixaAlloc.dataInicio + 'T12:00:00');
  const targetDate = new Date(targetDateStr + 'T12:00:00');

  while (cursor < targetDate) {
    const dateStr = cursor.toISOString().split('T')[0];
    total += getFaixaSlotsForCalendarDate(faixaAlloc, dateStr, feriadosList).length;
    cursor.setDate(cursor.getDate() + 1);
  }

  return total;
}

function resolveAllocationTeacherForHour(allocation, currentHourNum) {
  let slotDocente = allocation.docente;
  if (allocation.docentes && allocation.docentes.length > 0) {
    let acc = 0;
    for (const docente of allocation.docentes) {
      acc += parseInt(docente.ch);
      if (currentHourNum <= acc) {
        slotDocente = docente.nome;
        break;
      }
    }
  }
  return slotDocente;
}

function normalizeCalendarSlotKey(value) {
  const match = String(value || '').match(/\d{1,2}:\d{2}/);
  if (match) return match[0];
  return String(value || '').replace(/[^0-9:]/g, '');
}

function getCalendarConflictIdentity(event, slotKey) {
  return [
    String(event?.id || ''),
    String(event?.turmaId || ''),
    String(event?.disciplina || ''),
    String(event?.tipo || ''),
    String(event?.subGrupo || ''),
    normalizeCalendarSlotKey(event?.horario || slotKey || '')
  ].join('|');
}

function markCalendarVisualConflicts(events = []) {
  const slotMap = new Map();

  (events || []).forEach((event) => {
    const slotKey = normalizeCalendarSlotKey(event?.horario || (event?.horariosOcupados ? event.horariosOcupados[0] : ''));
    if (!slotKey) return;

    if (!slotMap.has(slotKey)) slotMap.set(slotKey, []);
    const items = slotMap.get(slotKey);
    const identity = getCalendarConflictIdentity(event, slotKey);
    if (!items.some((item) => item.identity === identity)) {
      items.push({ identity, event });
    }
  });

  slotMap.forEach((items, slotKey) => {
    if (items.length < 2) return;
    items.forEach(({ event }) => {
      if (!event.conflictsAt) event.conflictsAt = [];
      if (!event.conflictsAt.includes(slotKey)) event.conflictsAt.push(slotKey);
      event.isConflict = true;
    });
  });
}


export function getCalendarEvents(turmaId, startDate, endDate, docenteFilter = null) {
  const days = getDaysArray(startDate, endDate);
  const calendarData = {};

  // --- Preparação ---
  const turmaToCurso = {};
  if (store.rawData?.turmas) {
    store.rawData.turmas.forEach(t => {
      // agora o curso é a própria sigla da turma (ex.: EP)
      turmaToCurso[t.turma_id] = t.sigla;
    });
  }

  const cursoRules = {};
  if (store.rawData?.componentes) {
    store.rawData.componentes.forEach(c => {
      if (!cursoRules[c.sigla]) cursoRules[c.sigla] = {};
      // regra por nome do componente
      cursoRules[c.sigla][c.componente] = c.ch;
    });
  }

  const executionCount = {};

  // --- Filtros para EXIBIÇÃO ---
  let myAllocations = store.allocations.filter(a => {
    // Se turmaId for passado, trava para aquela turma específica (Modo Aluno)
    if (turmaId && a.turmaId !== turmaId) return false;

    if (docenteFilter) {
      if (typeof a.docente === 'string' && a.docente.trim() === docenteFilter) return true;
      if (a.docente && a.docente.nome && a.docente.nome.trim() === docenteFilter) return true;
      if (a.docentes && Array.isArray(a.docentes)) {
        return a.docentes.some(d => {
          const nome = d.nome || d;
          return (nome || '').trim() === docenteFilter;
        });
      }
      return false;
    }

    // Se não passou docenteFilter e passou turmaId, exibe tudo daquela turma
    return turmaId ? true : false;
  });

  const myFaixaAllocations = myAllocations.filter(a => usesFaixaSchedule(a));
  const myStandardRegulars = myAllocations.filter(a => isStandardRegularAllocation(a));
  const myPreferredRegulars = myAllocations.filter(a => isPreferredRegularAllocation(a));

  const feriadosList = store.rawData?.feriados || [];

  const normalizeTime = (t) => {
    const match = (t || '').match(/\d{1,2}:\d{2}/);
    if (!match) return (t || '').replace(/[^0-9:]/g, '');
    return match[0];
  };

  // ATUALIZAÇÃO 4D: Recebe a flag de Sábado para contar corretamente o histórico de horas
  function isBusinessDay(dStr, includeSaturdays = false) {
    const d = new Date(dStr + 'T12:00:00');
    const day = d.getDay();
    if (day === 0) return false; // Domingo nunca é dia útil
    if (day === 6 && !includeSaturdays) return false; // Sábado só se a flag autorizar
    if (feriadosList.some(f => f.data === dStr)) return false;
    return true;
  }

  // ====================================================================
  // PRÉ-CÁLCULO: Acumula executionCount desde o início do semestre
  // até a véspera do range solicitado, para que a rotação de docentes
  // em disciplinas compartilhadas funcione corretamente em qualquer mês.
  // ====================================================================
  const termStartStr = store.settings.termStart || startDate;
  if (termStartStr < startDate) {
    let preCursor = new Date(termStartStr + 'T12:00:00');
    const preEnd = new Date(startDate + 'T12:00:00');

    while (preCursor < preEnd) {
      const preDateStr = preCursor.toISOString().split('T')[0];
      const preDow = preCursor.getDay();

      // Pula domingos e feriados
      if (preDow !== 0 && !feriadosList.some(f => f.data === preDateStr)) {
        // Simula contagem das ofertas regulares priorizadas
        myPreferredRegulars.forEach(reg => {
          if (reg.diaSemana != preDow) return;
          if (reg.dataInicio && preDateStr < reg.dataInicio) return;
          if (!reg.dataFim && store.settings.termEnd && preDateStr > store.settings.termEnd) return;
          if (reg.dataFim && preDateStr > reg.dataFim) return;

          const cursoSigla = turmaToCurso[reg.turmaId];
          let maxCH = 999;
          if (cursoSigla && cursoRules[cursoSigla] && cursoRules[cursoSigla][reg.disciplina]) {
            maxCH = cursoRules[cursoSigla][reg.disciplina];
          }
          const key = `${reg.turmaId}|${reg.disciplina}`;
          const currentCount = executionCount[key] || 0;
          if (currentCount < maxCH) {
            executionCount[key] = currentCount + 1;
          }
        });

        // Simula contagem das ofertas regulares padr�o
        myStandardRegulars.forEach(reg => {
          const regStart = reg.dataInicio || store.settings.termStart;
          const regEnd = reg.dataFim || store.settings.termEnd;
          if (preDateStr < regStart || preDateStr > regEnd) return;
          if (reg.diaSemana != preDow) return;

          // Observa a ocupacao por oferta em faixas neste dia
          const cursoSigla = turmaToCurso[reg.turmaId];
          let maxCH = 999;
          if (cursoSigla && cursoRules[cursoSigla] && cursoRules[cursoSigla][reg.disciplina]) {
            maxCH = cursoRules[cursoSigla][reg.disciplina];
          }
          const key = `${reg.turmaId}|${reg.disciplina}`;
          const currentCount = executionCount[key] || 0;
          if (currentCount < maxCH) {
            executionCount[key] = currentCount + 1;
          }
        });
      }
      preCursor.setDate(preCursor.getDate() + 1);
    }
  }

  // --- Loop ---
  days.forEach(date => {
    const dateStr = toLocalDateString(date);
    const dayOfWeek = date.getDay();

    // ATUALIZAÇÃO 4D: Libera o Sábado! Agora apenas o Domingo (0) é bloqueado incondicionalmente
    if (dayOfWeek === 0) {
      calendarData[dateStr] = [];
      return;
    }

    const events = [];

    // Feriado
    const feriadoObj = feriadosList.find(f => f.data === dateStr);
    if (feriadoObj) {
      events.push({ type: 'holiday', title: feriadoObj.feriado || 'Feriado' });
      calendarData[dateStr] = events;
      return;
    }

    // =========================================================================================
    // 1. PASSO A: RENDERIZAR OFERTAS REGULARES PRIORIZADAS
    // =========================================================================================

    // Renderiza minhas ofertas regulares priorizadas
    const myActivePriority = myPreferredRegulars.filter(a => {
      if (a.diaSemana != dayOfWeek) return false;
      const start = a.dataInicio || store.settings.termStart || '0000-00-00';
      const end = a.dataFim || store.settings.termEnd || '2099-12-31';
      return dateStr >= start && dateStr <= end;
    });

    myActivePriority.forEach(reg => {
      // Bloqueio extra pelo fim de semestre global caso a disciplina não tenha fim próprio
      if (!reg.dataFim && store.settings.termEnd && dateStr > store.settings.termEnd) return;

      // Lógica de CH e Renderização
      const cursoSigla = turmaToCurso[reg.turmaId];
      let maxCH = 999;
      if (cursoSigla && cursoRules[cursoSigla] && cursoRules[cursoSigla][reg.disciplina]) {
        maxCH = cursoRules[cursoSigla][reg.disciplina];
      }

      const key = `${reg.turmaId}|${reg.disciplina}`;
      const currentCount = executionCount[key] || 0;

      if (currentCount < maxCH) {
        executionCount[key] = currentCount + 1;
        let slotDocente = reg.docente;
        if (reg.docentes && reg.docentes.length > 0) {
          let acc = 0;
          for (const d of reg.docentes) {
            acc += parseInt(d.ch);
            if ((currentCount + 1) <= acc) {
              slotDocente = d.nome;
              break;
            }
          }
        }
        if (docenteFilter && (slotDocente || '').trim() !== docenteFilter) return;

        events.push({
          ...reg,
          priority: 3, // Prioridade visual ALTA
          title: reg.disciplina,
          docente: slotDocente,
          isPreferredSchedule: true // Flag visual para UI
        });
      }
    });
    // =========================================================================================
    // 2. PASSO B: RENDERIZAR OFERTAS POR FAIXAS
    // =========================================================================================

    // Minhas ofertas por faixas
    const myActiveFaixaAllocations = myFaixaAllocations.filter(
      i => dateStr >= i.dataInicio && dateStr <= i.dataFim
    );

    // PREPARAR MAPA DE REGULARES DESTA TURMA PARA HOJE (Para borda visual de sobreposição)
    const regularSlotsToday = new Set();
    const allRegularsOfTurma = store.allocations.filter(a => {
      if (!isStandardRegularAllocation(a) || a.diaSemana != dayOfWeek) return false;
      if (String(a.turmaId) !== String(turmaId || (myActiveFaixaAllocations[0]?.turmaId))) return false;
      const start = a.dataInicio || store.settings.termStart;
      const end = a.dataFim || store.settings.termEnd;
      return dateStr >= start && dateStr <= end;
    });
    allRegularsOfTurma.forEach(r => regularSlotsToday.add(normalizeTime(r.horario)));


    myActiveFaixaAllocations.forEach(faixaAlloc => {
      const slotsToday = getFaixaSlotsForCalendarDate(faixaAlloc, dateStr, feriadosList);
      if (slotsToday.length === 0) return;

      const hoursBeforeToday = countFaixaHoursBeforeDate(faixaAlloc, dateStr, feriadosList);

      slotsToday.forEach((slotTime, slotIndex) => {
        const currentHourNum = hoursBeforeToday + slotIndex + 1;
        if (faixaAlloc.ch && currentHourNum > faixaAlloc.ch) return;

        const slotDocente = resolveAllocationTeacherForHour(faixaAlloc, currentHourNum);
        if (docenteFilter && (slotDocente || '').trim() !== docenteFilter) return;

        const overlapsRegularSlot = regularSlotsToday.has(normalizeTime(slotTime));

        events.push({
          ...faixaAlloc,
          priority: 2,
          title: faixaAlloc.disciplina,
          docente: slotDocente,
          horario: slotTime,
          horariosOcupados: null,
          isOverriding: overlapsRegularSlot
        });
      });
    });
    // =========================================================================================
    // 3. PASSO C: RENDERIZAR OFERTAS REGULARES PADR�O (somente criterios canonicos de data/dia/CH)
    // =========================================================================================
    myStandardRegulars.forEach(reg => {
      // Verifica validade temporal modular
      const start = reg.dataInicio || store.settings.termStart;
      const end = reg.dataFim || store.settings.termEnd;
      if (dateStr < start || dateStr > end) return;

      if (reg.diaSemana == dayOfWeek) {

        const cursoSigla = turmaToCurso[reg.turmaId];
        let maxCH = 999;

        if (cursoSigla && cursoRules[cursoSigla] && cursoRules[cursoSigla][reg.disciplina]) {
          maxCH = cursoRules[cursoSigla][reg.disciplina];
        }

        const key = `${reg.turmaId}|${reg.disciplina}`;
        const currentCount = executionCount[key] || 0;

        if (currentCount < maxCH) {
          executionCount[key] = currentCount + 1;

          let slotDocente = reg.docente;
          if (reg.docentes && reg.docentes.length > 0) {
            let acc = 0;
            for (const d of reg.docentes) {
              acc += parseInt(d.ch);
              if ((currentCount + 1) <= acc) {
                slotDocente = d.nome;
                break;
              }
            }
          }

          if (docenteFilter && (slotDocente || '').trim() !== docenteFilter) return;

          events.push({
            ...reg,
            priority: 1,
            title: reg.disciplina,
            docente: slotDocente
          });
        }
      }
    });

    // --- Detecção de Choques (Apenas entre ativos no mesmo dia/hora) ---
    markCalendarVisualConflicts(events);
    events.sort((a, b) => {
      const hA = normalizeTime(a.horario || '');
      const hB = normalizeTime(b.horario || '');
      return hA.localeCompare(hB);
    });

    calendarData[dateStr] = events;
  });

  return calendarData;
}
