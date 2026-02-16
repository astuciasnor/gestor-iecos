import { store } from './store.js';
import { getDaysArray, toLocalDateString } from './utils.js';

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

  // --- Filtros ---
  let myAllocations = [];
  if (docenteFilter) {
    myAllocations = store.allocations.filter(a => a.docente === docenteFilter);
  } else {
    myAllocations = store.allocations.filter(a => a.turmaId === turmaId);
  }

  const myIntensives = myAllocations.filter(a => a.tipo === 'intensiva');
  const myRegulars = myAllocations.filter(a => a.tipo === 'regular');
  const allIntensives = store.allocations.filter(a => a.tipo === 'intensiva');

  const feriadosList = store.rawData?.feriados || [];

  // Função auxiliar para limpar espaços e comparar horários
  const normalizeTime = (t) => (t || '').replace(/\s/g, '');

  // --- Loop ---
  days.forEach(date => {
    const dateStr = toLocalDateString(date);
    const dayOfWeek = date.getDay();

    // fim de semana
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      calendarData[dateStr] = [];
      return;
    }

    const events = [];

    // Feriado
    const feriadoObj = feriadosList.find(f => f.data === dateStr);
    if (feriadoObj) {
      const nomeFeriado = feriadoObj.feriado || 'Feriado';
      events.push({ type: 'holiday', title: nomeFeriado });
      calendarData[dateStr] = events;
      return;
    }

    // Intensivas ativas no sistema todo nesta data
    const globalActiveIntensives = allIntensives.filter(
      i => dateStr >= i.dataInicio && dateStr <= i.dataFim
    );

    // Minhas intensivas (do professor ou turma filtrada)
    const myActiveIntensives = myIntensives.filter(
      i => dateStr >= i.dataInicio && dateStr <= i.dataFim
    );

    // Renderizar Minhas Intensivas
    myActiveIntensives.forEach(intense => {
      const key = `${intense.turmaId}|${intense.disciplina}`;
      const slotsConsumed = intense.horariosOcupados ? intense.horariosOcupados.length : 5;
      executionCount[key] = (executionCount[key] || 0) + slotsConsumed;

      events.push({ ...intense, priority: 2, title: `(I) ${intense.disciplina}` });
    });

    // Renderizar Regulares (com lógica de Suspensão)
    myRegulars.forEach(reg => {
      if (reg.diaSemana == dayOfWeek) {
        
        // Verifica BLOQUEIO
        const blockingIntensive = globalActiveIntensives.find(intensive => {
            if (intensive.turmaId !== reg.turmaId) return false;
            if (!intensive.horariosOcupados || !Array.isArray(intensive.horariosOcupados)) return true; // Segurança

            const regHorarioNorm = normalizeTime(reg.horario);
            // Bate horário?
            return intensive.horariosOcupados.some(h => normalizeTime(h) === regHorarioNorm);
        });

        if (blockingIntensive) {
          // *** AULA SUSPENSA ***
          if (docenteFilter) {
             events.push({
               ...reg,
               type: 'suspension',
               title: `Suspensão: ${blockingIntensive.disciplina}`,
               cor: '#ecf0f1',
               isSuspended: true
             });
          }
        } else {
          // *** AULA NORMAL ***
          const cursoSigla = turmaToCurso[reg.turmaId];
          let maxCH = 999;

          if (cursoSigla && cursoRules[cursoSigla] && cursoRules[cursoSigla][reg.disciplina]) {
            maxCH = cursoRules[cursoSigla][reg.disciplina];
          }

          const key = `${reg.turmaId}|${reg.disciplina}`;
          const currentCount = executionCount[key] || 0;

          if (currentCount < maxCH) {
            executionCount[key] = currentCount + 1;
            events.push({ ...reg, priority: 1, title: reg.disciplina });
          }
        }
      }
    });

    // --- Detecção de Conflitos Robusta (Por Slot) ---
    // Mapeia cada horário NORMALIZADO para uma lista de eventos
    const slotMap = {};

    events.forEach(e => {
      const slots = [];
      if (e.horario) slots.push(e.horario);
      if (e.horariosOcupados && Array.isArray(e.horariosOcupados)) {
        slots.push(...e.horariosOcupados);
      }

      slots.forEach(slotRaw => {
        const key = normalizeTime(slotRaw); 
        if (!key) return;
        if (!slotMap[key]) slotMap[key] = [];
        slotMap[key].push(e);
      });
    });

    // Analisa conflitos por horário específico
    Object.entries(slotMap).forEach(([timeKey, eventList]) => {
      // Se houver mais de 1 evento neste horário específico (e não forem suspensões)
      const activeEvents = eventList.filter(ev => ev.type !== 'suspension');
      
      if (activeEvents.length > 1) {
        activeEvents.forEach(ev => {
           // Inicializa o array de conflitos específicos se não existir
           if (!ev.conflictsAt) ev.conflictsAt = [];
           // Adiciona este horário à lista de conflitos deste evento
           if (!ev.conflictsAt.includes(timeKey)) {
               ev.conflictsAt.push(timeKey);
           }
           // Mantemos a flag global para compatibilidade, mas a UI usará conflictsAt
           ev.isConflict = true;
        });
      }
    });

    // Ordena por horário
    events.sort((a, b) => {
      const hA = a.horario || (a.horariosOcupados ? a.horariosOcupados[0] : '') || '';
      const hB = b.horario || (b.horariosOcupados ? b.horariosOcupados[0] : '') || '';
      return hA.localeCompare(hB);
    });

    calendarData[dateStr] = events;
  });

  return calendarData;
}