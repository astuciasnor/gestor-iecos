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

  // --- Recupera TUDO para cálculo de bloqueios, independente de filtro ---
  const allAllocations = store.allocations; 
  const allIntensives = allAllocations.filter(a => a.tipo === 'intensiva');

  // --- Filtros para EXIBIÇÃO ---
  // AQUI: Filtramos o que será *mostrado*, mas precisamos dos dados globais para saber o que bloqueia o que.
  let myAllocations = store.allocations.filter(a => {
      // 1. Filtro de Turma (Visão Turma)
      if (turmaId && a.turmaId !== turmaId) return false;

      // 2. Filtro de Docente (Visão Professor)
      if (docenteFilter) {
          // Verifica nome principal
          if (a.docente === docenteFilter) return true;
          // Verifica lista de múltiplos
          if (a.docentes && Array.isArray(a.docentes)) {
              return a.docentes.some(d => d.nome === docenteFilter);
          }
          return false;
      }
      return true;
  });

  const myIntensives = myAllocations.filter(a => a.tipo === 'intensiva');
  const myRegulars = myAllocations.filter(a => a.tipo === 'regular');
  
  const feriadosList = store.rawData?.feriados || [];

  // Função auxiliar de normalização (remove zeros à esquerda e espaços)
  const normalizeTime = (t) => {
      const match = (t || '').match(/\d{1,2}:\d{2}/);
      if (!match) return (t || '').replace(/[^0-9:]/g, '');
      // Garante "07:30" virar "7:30" para comparação segura, ou mantém padrão
      return match[0];
  };

  // --- Helper para checar dia útil localmente ---
  function isBusinessDay(dStr) {
      const d = new Date(dStr + 'T12:00:00');
      const day = d.getDay();
      if (day === 0 || day === 6) return false;
      if (feriadosList.some(f => f.data === dStr)) return false;
      return true;
  }

  // --- Loop ---
  days.forEach(date => {
    const dateStr = toLocalDateString(date);
    const dayOfWeek = date.getDay();

    if (dayOfWeek === 0 || dayOfWeek === 6) {
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
    // 1. MAPA DE BLOQUEIOS GLOBAIS (A ESTRATÉGIA SOBERANA)
    // Identifica QUAIS turmas e QUAIS horários estão tomados por intensivas HOJE no sistema todo.
    // =========================================================================================
    const blockedSlotsByTurma = {}; // { 'TURMA_A': ['07:30', '08:20'], ... }

    // Intensivas que ocorrem hoje (qualquer turma, qualquer professor)
    const activeGlobalIntensives = allIntensives.filter(
      i => dateStr >= i.dataInicio && dateStr <= i.dataFim
    );

    activeGlobalIntensives.forEach(intensiva => {
        const tId = String(intensiva.turmaId);
        if (!blockedSlotsByTurma[tId]) blockedSlotsByTurma[tId] = [];
        
        if (intensiva.horariosOcupados && Array.isArray(intensiva.horariosOcupados)) {
            intensiva.horariosOcupados.forEach(slot => {
                blockedSlotsByTurma[tId].push(normalizeTime(slot));
            });
        }
    });

    // =========================================================================================
    // 2. Renderizar Minhas Intensivas
    // =========================================================================================
    const myActiveIntensives = myIntensives.filter(
      i => dateStr >= i.dataInicio && dateStr <= i.dataFim
    );

    myActiveIntensives.forEach(intense => {
      const slots = intense.horariosOcupados || [];
      const slotsPerDay = slots.length;
      
      // Contagem de horas anteriores (para saber qual professor assume o slot)
      let hoursBeforeToday = 0;
      let cursor = new Date(intense.dataInicio + 'T12:00:00');
      const targetDate = new Date(dateStr + 'T12:00:00');
      
      while (cursor < targetDate) {
          const cStr = cursor.toISOString().split('T')[0];
          if (isBusinessDay(cStr)) hoursBeforeToday += slotsPerDay;
          cursor.setDate(cursor.getDate() + 1);
      }

      slots.forEach((slotTime, slotIndex) => {
          const currentHourNum = hoursBeforeToday + slotIndex + 1;
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

          events.push({ 
              ...intense, 
              priority: 2, 
              title: `(I) ${intense.disciplina}`, 
              docente: slotDocente,
              horario: slotTime,
              horariosOcupados: null 
          });
      });
    });

    // =========================================================================================
    // 3. Renderizar Regulares (COM FILTRAGEM DE BLOQUEIO)
    // =========================================================================================
    myRegulars.forEach(reg => {
      if (store.settings.termEnd && dateStr > store.settings.termEnd) return;

      if (reg.diaSemana == dayOfWeek) {
        
        // --- AQUI ESTÁ A CORREÇÃO FINAL ---
        // Verifica se a SALA desta regular está bloqueada neste HORÁRIO específico.
        // Se estiver, a aula regular NÃO EXISTE fisicamente.
        
        const tId = String(reg.turmaId);
        const hReg = normalizeTime(reg.horario);
        
        if (blockedSlotsByTurma[tId] && blockedSlotsByTurma[tId].includes(hReg)) {
            // A regular foi "atropelada" por uma intensiva na mesma sala.
            // Se estamos vendo a agenda do PROFESSOR dessa regular, ela deve sumir (ele está livre),
            // a menos que ele seja O MESMO professor da intensiva (aí a intensiva já foi desenhada acima).
            
            // Portanto: NÃO ADICIONAMOS A REGULAR.
            // O espaço fica livre (ou ocupado pela intensiva se for o mesmo prof).
            return; 
        }

        // Se chegou aqui, a sala está livre (para regulares)
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
                    if ( (currentCount + 1) <= acc ) {
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

    // --- Detecção de Choques (Agora limpa, pois regulares bloqueadas nem entraram) ---
    const slotMap = {};

    events.forEach(e => {
      // Normalização extra de slots para garantir match
      const h = normalizeTime(e.horario || (e.horariosOcupados ? e.horariosOcupados[0] : ''));
      if (!h) return;
      
      if (!slotMap[h]) slotMap[h] = [];
      slotMap[h].push(e);
    });

    Object.entries(slotMap).forEach(([timeKey, eventList]) => {
      if (eventList.length > 1) {
        eventList.forEach(ev => {
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