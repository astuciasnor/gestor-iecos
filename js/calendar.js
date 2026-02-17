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

  const executionCount = {}; // Rastreia horas acumuladas por (turma+disciplina)

  // --- Filtros ---
  // AQUI: Filtro deve considerar se o professor está na lista de "docentes" da alocação
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

  // Híbrido é tratado como Intensiva para fins de loop de data
  const myIntensives = myAllocations.filter(a => a.tipo === 'intensiva' || a.tipo === 'hibrido');
  const myRegulars = myAllocations.filter(a => a.tipo === 'regular');
  const allIntensives = store.allocations.filter(a => a.tipo === 'intensiva' || a.tipo === 'hibrido');

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

    // Renderizar Minhas Intensivas (e Híbridas)
    myActiveIntensives.forEach(intense => {
      const key = `${intense.turmaId}|${intense.disciplina}`;
      const slotsConsumed = intense.horariosOcupados ? intense.horariosOcupados.length : 5;
      
      const currentCount = executionCount[key] || 0;
      executionCount[key] = currentCount + slotsConsumed;

      // Lógica de Múltiplos Docentes (Quem assume HOJE?)
      let activeDocenteName = intense.docente; // Default (pode ser o nome composto)
      
      if (intense.docentes && intense.docentes.length > 0) {
          let acc = 0;
          for (const d of intense.docentes) {
              acc += parseInt(d.ch);
              // Se o acumulado cobrir o início deste dia (currentCount), é este professor
              // (Simplificação: block-based owner)
              if (currentCount < acc) {
                  activeDocenteName = d.nome;
                  break;
              }
          }
      }

      // Se estivermos na Visão do Professor, só mostra se for ELE o ativo naquele dia
      if (docenteFilter && activeDocenteName !== docenteFilter) return;

      events.push({ 
          ...intense, 
          priority: 2, 
          title: `(I) ${intense.disciplina}`, 
          docente: activeDocenteName // Sobrescreve para exibição correta no card
      });
    });

    // Renderizar Regulares (com lógica de Suspensão)
    myRegulars.forEach(reg => {
      // TRAVA DE SEGURANÇA:
      if (store.settings.termEnd && dateStr > store.settings.termEnd) return;

      if (reg.diaSemana == dayOfWeek) {
        
        // Verifica BLOQUEIO
        const blockingIntensive = globalActiveIntensives.find(intensive => {
            if (intensive.turmaId !== reg.turmaId) return false;
            // Bloqueio seguro: se intensiva não tem slots definidos (erro), bloqueia tudo.
            if (!intensive.horariosOcupados || !Array.isArray(intensive.horariosOcupados)) return true;

            const regHorarioNorm = normalizeTime(reg.horario);
            // Bate horário?
            return intensive.horariosOcupados.some(h => normalizeTime(h) === regHorarioNorm);
        });

        if (blockingIntensive) {
          // *** AULA SUSPENSA ***
          if (docenteFilter) {
             // Só mostra suspensão se o professor da regular for o ativo naquele momento
             let slotDocente = reg.docente;
             // (Verificação simplificada para suspensão: se o prof está na lista, mostra o aviso)
             const isOwner = (reg.docente === docenteFilter) || (reg.docentes && reg.docentes.some(d => d.nome === docenteFilter));
             
             if (isOwner) {
                 events.push({
                   ...reg,
                   type: 'suspension',
                   title: `Suspensão: ${blockingIntensive.disciplina}`,
                   cor: '#ecf0f1',
                   isSuspended: true
                 });
             }
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
            executionCount[key] = currentCount + 1; // 1 slot = 1 hora (aprox)

            // === QUEM É O PROFESSOR DESTE SLOT? ===
            let slotDocente = reg.docente;
            
            if (reg.docentes && reg.docentes.length > 0) {
                let acc = 0;
                for (const d of reg.docentes) {
                    acc += parseInt(d.ch);
                    // O slot atual é o (currentCount + 1)-ésimo
                    // Se a aula atual (currentCount + 1) estiver dentro do acumulado deste prof, é ele.
                    if ( (currentCount + 1) <= acc ) {
                        slotDocente = d.nome;
                        break;
                    }
                }
            }

            // Visão do Professor: só adiciona se for aula DELE
            if (docenteFilter && slotDocente !== docenteFilter) return;

            events.push({ 
                ...reg, 
                priority: 1, 
                title: reg.disciplina,
                docente: slotDocente // Importante para o UI saber quem pintar/mostrar
            });
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