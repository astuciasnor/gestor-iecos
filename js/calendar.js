import { store } from './store.js';
import { getDaysArray, toLocalDateString } from './utils.js';

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

  const myIntensives = myAllocations.filter(a => isFaixaAllocation(a));
  const myRegulars = myAllocations.filter(a => isRegularAllocation(a));
  const myPriorityRegulars = myAllocations.filter(a => isPriorityRegularAllocation(a));

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
        // Simula contagem de Prioritárias
        myPriorityRegulars.forEach(reg => {
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

        // Simula contagem de Regulares comuns
        myRegulars.forEach(reg => {
          const regStart = reg.dataInicio || store.settings.termStart;
          const regEnd = reg.dataFim || store.settings.termEnd;
          if (preDateStr < regStart || preDateStr > regEnd) return;
          if (reg.diaSemana != preDow) return;

          // Verifica se está bloqueada por intensiva neste dia
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
    // 1. PASSO A: RENDERIZAR REGULAR PRIORITARIA - Agora Modular
    // =========================================================================================

    // Renderiza Minhas Prioritárias (Respeitando datas modulares)
    const myActivePriority = myPriorityRegulars.filter(a => {
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
          isPriority: true // Flag para UI
        });
      }
    });
    // =========================================================================================
    // 2. PASSO B: RENDERIZAR INTENSIVAS
    // =========================================================================================

    // Minhas Intensivas
    const myActiveIntensives = myIntensives.filter(
      i => dateStr >= i.dataInicio && dateStr <= i.dataFim
    );

    // PREPARAR MAPA DE REGULARES DESTA TURMA PARA HOJE (Para borda visual de sobreposição)
    const myRegularsTodaySlots = new Set();
    const allRegularsOfTurma = store.allocations.filter(a => {
      if (!isRegularAllocation(a) || a.diaSemana != dayOfWeek) return false;
      if (String(a.turmaId) !== String(turmaId || (myActiveIntensives[0]?.turmaId))) return false;
      const start = a.dataInicio || store.settings.termStart;
      const end = a.dataFim || store.settings.termEnd;
      return dateStr >= start && dateStr <= end;
    });
    allRegularsOfTurma.forEach(r => myRegularsTodaySlots.add(normalizeTime(r.horario)));


    myActiveIntensives.forEach(intense => {
      // === CÁLCULO DE HORAS ACUMULADAS ===
      const storedExecutionByDate = intense.executionByDate && typeof intense.executionByDate === 'object'
        ? intense.executionByDate
        : null;
      const storedExecutionDates = storedExecutionByDate ? Object.keys(storedExecutionByDate).sort() : [];

      if (storedExecutionDates.length > 0) {
        if (!storedExecutionByDate[dateStr]) return;

        let hoursBeforeToday = 0;
        storedExecutionDates.forEach((execDate) => {
          if (execDate >= dateStr) return;
          hoursBeforeToday += Array.isArray(storedExecutionByDate[execDate]) ? storedExecutionByDate[execDate].length : 0;
        });

        const slotsToday = Array.isArray(storedExecutionByDate[dateStr]) ? storedExecutionByDate[dateStr].slice() : [];
        if (slotsToday.length === 0) return;

        slotsToday.forEach((slotTime, slotIndex) => {
          const currentHourNum = hoursBeforeToday + slotIndex + 1;
          if (intense.ch && currentHourNum > intense.ch) return;

          let slotDocente = intense.docente;
          if (intense.docentes && intense.docentes.length > 0) {
            let acc = 0;
            for (const d of intense.docentes) {
              acc += parseInt(d.ch);
              if (currentHourNum <= acc) {
                slotDocente = d.nome;
                break;
              }
            }
          }

          if (docenteFilter && (slotDocente || '').trim() !== docenteFilter) return;

          const isOverriding = myRegularsTodaySlots.has(normalizeTime(slotTime));

          events.push({
            ...intense,
            priority: 2,
            title: intense.disciplina,
            docente: slotDocente,
            horario: slotTime,
            horariosOcupados: null,
            isOverriding: isOverriding
          });
        });

        return;
      }

      let hoursBeforeToday = 0;
      let cursor = new Date(intense.dataInicio + 'T12:00:00');
      const targetDate = new Date(dateStr + 'T12:00:00');

      let faixasDataList = [{ inicio: intense.dataInicio, slots: intense.horariosOcupados || [], dias: intense.usaSabado ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5] }];
      if (intense.faixas && intense.faixas.length > 0) {
        faixasDataList = [...intense.faixas].sort((a, b) => a.inicio.localeCompare(b.inicio));
      }

      let currentFaixaIdxCal = 0;
      let activeFaixaCal = faixasDataList[0];

      while (cursor < targetDate) {
        const cStr = cursor.toISOString().split('T')[0];
        if (currentFaixaIdxCal + 1 < faixasDataList.length && cStr >= faixasDataList[currentFaixaIdxCal + 1].inicio) {
          currentFaixaIdxCal++;
          activeFaixaCal = faixasDataList[currentFaixaIdxCal];
        }
        const dow = cursor.getDay();
        const isHolidayObj = store.rawData?.feriados?.some(f => (f.data || f) === cStr);
        if (!isHolidayObj && activeFaixaCal.dias.includes(dow)) {
          const pastSlotsToday = activeFaixaCal.drawnSlotsByDay ? (activeFaixaCal.drawnSlotsByDay[dow] || []) : (activeFaixaCal.slots || []);
          hoursBeforeToday += pastSlotsToday.length;
        }
        cursor.setDate(cursor.getDate() + 1);
      }

      // Determinar a faixa ativa para HOJE (dateStr)
      let activeFaixaForToday = faixasDataList[0];
      for (const f of faixasDataList) {
        if (dateStr >= f.inicio) activeFaixaForToday = f;
      }

      const currentDow = new Date(dateStr + 'T12:00:00').getDay();
      const currentIsHoliday = store.rawData?.feriados?.some(f => (f.data || f) === dateStr);
      if (currentIsHoliday || !activeFaixaForToday.dias.includes(currentDow)) return;

      const slotsToday = activeFaixaForToday.drawnSlotsByDay ? (activeFaixaForToday.drawnSlotsByDay[currentDow] || []) : (activeFaixaForToday.slots || []);
      const slotsPerDay = slotsToday.length;

      slotsToday.forEach((slotTime, slotIndex) => {
        // SE ESTE SLOT NÃO PERTENCE À CARGA RESIDUAL ÍMPAR QUE SOBROU NO ÚLTIMO DIA, PULAR.
        if (intense.horariosUltimoDia && intense.horariosUltimoDia.length > 0 && dateStr === intense.dataFim) {
          if (!intense.horariosUltimoDia.includes(slotTime)) return;
        }

        const currentHourNum = hoursBeforeToday + slotIndex + 1;

        // CAP DE CARGA HORÁRIA: Não pintar slots além da CH real da disciplina
        if (intense.ch && currentHourNum > intense.ch) return;

        let slotDocente = intense.docente;

        if (intense.docentes && intense.docentes.length > 0) {
          let acc = 0;
          for (const d of intense.docentes) {
            acc += parseInt(d.ch);
            if (currentHourNum <= acc) {
              slotDocente = d.nome;
              break;
            }
          }
        }

        if (docenteFilter && (slotDocente || '').trim() !== docenteFilter) return;

        const isOverriding = myRegularsTodaySlots.has(normalizeTime(slotTime));

        events.push({
          ...intense,
          priority: 2,
          title: intense.disciplina,
          docente: slotDocente,
          horario: slotTime,
          horariosOcupados: null,
          isOverriding: isOverriding
        });
      });
    });
    // =========================================================================================
    // 3. PASSO C: RENDERIZAR REGULARES COMUNS (somente criterios canonicos de data/dia/CH)
    // =========================================================================================
    myRegulars.forEach(reg => {
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
    const slotMap = {};

    events.forEach(e => {
      const h = normalizeTime(e.horario || (e.horariosOcupados ? e.horariosOcupados[0] : ''));
      if (!h) return;
      if (!slotMap[h]) slotMap[h] = [];
      slotMap[h].push(e);
    });

    const getConflictIdentity = (ev, timeKey) => {
      const sg = String(ev.subGrupo || '');
      const disc = String(ev.disciplina || '');
      const turma = String(ev.turmaId || '');
      const tipo = String(ev.tipo || '');
      const horario = normalizeTime(ev.horario || timeKey || '');
      return `${turma}|${disc}|${tipo}|${sg}|${horario}`;
    };

    Object.entries(slotMap).forEach(([timeKey, eventList]) => {
      const seen = new Set();
      const uniqueActiveEvents = eventList.filter((ev) => {
        const key = getConflictIdentity(ev, timeKey);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      if (uniqueActiveEvents.length > 1) {
        uniqueActiveEvents.forEach(ev => {
          if (!ev.conflictsAt) ev.conflictsAt = [];
          if (!ev.conflictsAt.includes(timeKey)) ev.conflictsAt.push(timeKey);
          ev.isConflict = true;
        });
      }
    });

    events.sort((a, b) => {
      const hA = normalizeTime(a.horario || '');
      const hB = normalizeTime(b.horario || '');
      return hA.localeCompare(hB);
    });

    calendarData[dateStr] = events;
  });

  return calendarData;
}
