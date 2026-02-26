import { store } from './store.js';
import { getDaysArray, toLocalDateString, countBusinessDays } from './utils.js';

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

  // --- Recupera TUDO para cálculo de bloqueios ---
  const allAllocations = store.allocations;
  const allIntensives = allAllocations.filter(a => a.tipo === 'intensiva');
  const allPriorityRegulars = allAllocations.filter(a => a.tipo === 'regular_prioritaria');

  // --- Filtros para EXIBIÇÃO ---
  let myAllocations = store.allocations.filter(a => {
    if (turmaId && a.turmaId !== turmaId) return false;
    if (docenteFilter) {
      if (a.docente === docenteFilter) return true;
      if (a.docentes && Array.isArray(a.docentes)) {
        return a.docentes.some(d => d.nome === docenteFilter);
      }
      return false;
    }
    return true;
  });

  const myIntensives = myAllocations.filter(a => a.tipo === 'intensiva');
  const myRegulars = myAllocations.filter(a => a.tipo === 'regular');
  const myPriorityRegulars = myAllocations.filter(a => a.tipo === 'regular_prioritaria');

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
    // 1. PASSO A: RENDERIZAR E BLOQUEAR COM "REGULAR (PRIORITÁRIA)" - Agora Modular
    // =========================================================================================

    // Identifica quais turmas têm prioritária HOJE (Contexto Global para Bloqueio)
    const activeGlobalPriority = allPriorityRegulars.filter(a => {
      if (a.diaSemana != dayOfWeek) return false;
      const start = a.dataInicio || store.settings.termStart;
      const end = a.dataFim || store.settings.termEnd;
      return dateStr >= start && dateStr <= end;
    });

    const turmasWithPriorityToday = new Set(activeGlobalPriority.map(a => String(a.turmaId)));

    // Mapa de slots bloqueados (para regulares comuns depois)
    const blockedSlotsByTurma = {};

    // Renderiza Minhas Prioritárias (Respeitando datas modulares)
    const myActivePriority = myPriorityRegulars.filter(a => {
      if (a.diaSemana != dayOfWeek) return false;
      const start = a.dataInicio || store.settings.termStart;
      const end = a.dataFim || store.settings.termEnd;
      return dateStr >= start && dateStr <= end;
    });

    myActivePriority.forEach(reg => {
      // Bloqueio extra pelo fim de semestre global caso a disciplina não tenha fim próprio
      if (!reg.dataFim && store.settings.termEnd && dateStr > store.settings.termEnd) return;

      // Adiciona aos slots bloqueados
      const tId = String(reg.turmaId);
      if (!blockedSlotsByTurma[tId]) blockedSlotsByTurma[tId] = [];
      blockedSlotsByTurma[tId].push(normalizeTime(reg.horario));

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
        if (docenteFilter && slotDocente !== docenteFilter) return;

        events.push({
          ...reg,
          priority: 3, // Prioridade visual ALTA
          title: reg.disciplina,
          docente: slotDocente,
          isPriority: true // Flag para UI
        });
      }
    });

    // Adiciona slots das prioritárias GLOBAIS ao mapa de bloqueio (para bloquear regulares comuns)
    activeGlobalPriority.forEach(reg => {
      const tId = String(reg.turmaId);
      if (!blockedSlotsByTurma[tId]) blockedSlotsByTurma[tId] = [];
      blockedSlotsByTurma[tId].push(normalizeTime(reg.horario));
    });


    // =========================================================================================
    // 2. PASSO B: RENDERIZAR INTENSIVAS
    // =========================================================================================

    // Globais para bloqueio de regulares comuns
    const activeGlobalIntensives = allIntensives.filter(
      i => dateStr >= i.dataInicio && dateStr <= i.dataFim
    );

    activeGlobalIntensives.forEach(intensiva => {
      // ATUALIZAÇÃO 4D: Se for sábado e essa intensiva não usa sábado, não processa bloqueios!
      if (dayOfWeek === 6 && !intensiva.usaSabado) return;

      // Se a turma desta intensiva tem uma prioritária hoje, a intensiva é SUSPENSA.
      if (turmasWithPriorityToday.has(String(intensiva.turmaId))) return;

      // Se não suspensa, bloqueia slots
      const tId = String(intensiva.turmaId);
      if (!blockedSlotsByTurma[tId]) blockedSlotsByTurma[tId] = [];

      if (intensiva.horariosOcupados && Array.isArray(intensiva.horariosOcupados)) {
        intensiva.horariosOcupados.forEach(slot => {
          blockedSlotsByTurma[tId].push(normalizeTime(slot));
        });
      }
    });

    // Minhas Intensivas
    const myActiveIntensives = myIntensives.filter(
      i => dateStr >= i.dataInicio && dateStr <= i.dataFim
    );

    // PREPARAR MAPA DE REGULARES DESTA TURMA PARA HOJE (Para borda visual de sobreposição)
    const myRegularsTodaySlots = new Set();
    const allRegularsOfTurma = store.allocations.filter(a => {
      if (a.tipo !== 'regular' || a.diaSemana != dayOfWeek) return false;
      if (String(a.turmaId) !== String(turmaId || (myActiveIntensives[0]?.turmaId))) return false;
      const start = a.dataInicio || store.settings.termStart;
      const end = a.dataFim || store.settings.termEnd;
      return dateStr >= start && dateStr <= end;
    });
    allRegularsOfTurma.forEach(r => myRegularsTodaySlots.add(normalizeTime(r.horario)));


    myActiveIntensives.forEach(intense => {
      // ATUALIZAÇÃO 4D: Se for sábado e a intensiva NÃO permite sábado, pula!
      if (dayOfWeek === 6 && !intense.usaSabado) return;

      // ** CHECK SUPRESSÃO VISUAL (HOJE) **
      if (turmasWithPriorityToday.has(String(intense.turmaId))) {
        return;
      }

      const slots = intense.horariosOcupados || [];
      const slotsPerDay = slots.length;

      // === CÁLCULO DE HORAS ACUMULADAS ===
      const blockedDaysForTurma = new Set(
        allPriorityRegulars
          .filter(p => String(p.turmaId) === String(intense.turmaId))
          .map(p => parseInt(p.diaSemana))
      );

      let hoursBeforeToday = 0;
      let cursor = new Date(intense.dataInicio + 'T12:00:00');
      const targetDate = new Date(dateStr + 'T12:00:00');

      while (cursor < targetDate) {
        const cStr = cursor.toISOString().split('T')[0];
        const dow = cursor.getDay();

        if (isBusinessDay(cStr, intense.usaSabado)) {
          // Verifica quais Prioritárias estavam ativas NESTE dia específico
          const activePrioOnDay = allPriorityRegulars.filter(p =>
            String(p.turmaId) === String(intense.turmaId) &&
            parseInt(p.diaSemana) === dow &&
            cStr >= (p.dataInicio || '') &&
            cStr <= (p.dataFim || '')
          );

          // Filtra slots da intensiva que não foram tomados por Prioritárias
          const availableSlots = slots.filter(s =>
            !activePrioOnDay.some(p => normalizeTime(p.horario) === normalizeTime(s))
          );

          hoursBeforeToday += availableSlots.length;
        }
        cursor.setDate(cursor.getDate() + 1);
      }

      slots.forEach((slotTime, slotIndex) => {
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

        if (docenteFilter && slotDocente !== docenteFilter) return;

        const isOverriding = myRegularsTodaySlots.has(normalizeTime(slotTime));

        events.push({
          ...intense,
          priority: 2,
          title: `(I) ${intense.disciplina}`,
          docente: slotDocente,
          horario: slotTime,
          horariosOcupados: null,
          isOverriding: isOverriding
        });
      });
    });


    // =========================================================================================
    // PRÉ-PASSO C: DETECTAR QUAIS REGULARES SERÃO TOTALMENTE SUSPENSAS HOJE (TUDO OU NADA)
    // =========================================================================================
    const suspendedRegularDisciplinasInfo = {};

    myRegulars.forEach(reg => {
      // Verifica validade temporal modular
      const start = reg.dataInicio || store.settings.termStart;
      const end = reg.dataFim || store.settings.termEnd;
      if (dateStr < start || dateStr > end) return;

      if (reg.diaSemana == dayOfWeek) {
        const tId = String(reg.turmaId);
        const hReg = normalizeTime(reg.horario);

        // Se este slot específico encostou num bloqueio...
        if (blockedSlotsByTurma[tId] && blockedSlotsByTurma[tId].includes(hReg)) {
          if (!suspendedRegularDisciplinasInfo[tId]) suspendedRegularDisciplinasInfo[tId] = {};

          if (!suspendedRegularDisciplinasInfo[tId][reg.disciplina]) {
            let blockerName = "Intensiva";

            const blockerPrio = activeGlobalPriority.find(p => String(p.turmaId) === tId && normalizeTime(p.horario) === hReg);
            if (blockerPrio) {
              blockerName = blockerPrio.disciplina;
            } else {
              const blockerInt = activeGlobalIntensives.find(i => {
                if (String(i.turmaId) !== tId) return false;
                return (i.horariosOcupados || []).map(normalizeTime).includes(hReg);
              });
              if (blockerInt) blockerName = blockerInt.disciplina;
            }

            suspendedRegularDisciplinasInfo[tId][reg.disciplina] = blockerName;
          }
        }
      }
    });

    // =========================================================================================
    // 3. PASSO C: RENDERIZAR REGULARES COMUNS (Respeitando a Suspensão em Bloco e Modularização)
    // =========================================================================================
    myRegulars.forEach(reg => {
      // Verifica validade temporal modular
      const start = reg.dataInicio || store.settings.termStart;
      const end = reg.dataFim || store.settings.termEnd;
      if (dateStr < start || dateStr > end) return;

      if (reg.diaSemana == dayOfWeek) {

        const tId = String(reg.turmaId);
        const blockerName = suspendedRegularDisciplinasInfo[tId]?.[reg.disciplina];

        if (blockerName) {

          let isOwner = true;
          if (docenteFilter) {
            isOwner = (reg.docente === docenteFilter);
            if (!isOwner && reg.docentes) {
              isOwner = reg.docentes.some(d => d.nome === docenteFilter);
            }
          }

          if (isOwner) {
            events.push({
              ...reg,
              type: 'suspended',
              title: `⛔ Suspensa (${blockerName})`,
              blockingReason: `Aula regular totalmente suspensa neste dia devido a choque com a disciplina "${blockerName}".`,
              priority: 0
            });
          }

          return;
        }

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

          if (docenteFilter && slotDocente !== docenteFilter) return;

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

    Object.entries(slotMap).forEach(([timeKey, eventList]) => {
      const activeEvents = eventList.filter(ev => ev.type !== 'suspended');

      if (activeEvents.length > 1) {
        activeEvents.forEach(ev => {
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