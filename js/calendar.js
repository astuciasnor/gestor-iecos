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

  const executionCount = {}; // Mantido para regulares

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
  const myIntensives = myAllocations.filter(a => a.tipo === 'intensiva');
  const myRegulars = myAllocations.filter(a => a.tipo === 'regular');
  const allIntensives = store.allocations.filter(a => a.tipo === 'intensiva');

  const feriadosList = store.rawData?.feriados || [];

  // Função auxiliar MELHORADA: Extrai apenas o horário de início (ex: "07:30" de "07:30 - 08:20")
  // Isso evita falhas de bloqueio se os formatos de string forem diferentes
  const normalizeTime = (t) => {
      const match = (t || '').match(/\d{1,2}:\d{2}/);
      return match ? match[0] : (t || '').replace(/[^0-9:]/g, '');
  };

  // --- Helper para checar dia útil localmente ---
  function isBusinessDay(dStr) {
      // 1. Fim de semana (criação de data segura)
      const d = new Date(dStr + 'T12:00:00');
      const day = d.getDay();
      if (day === 0 || day === 6) return false;

      // 2. Feriado
      if (feriadosList.some(f => f.data === dStr)) return false;

      return true;
  }

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

    // Intensivas ativas no sistema todo nesta data (para bloqueio)
    const globalActiveIntensives = allIntensives.filter(
      i => dateStr >= i.dataInicio && dateStr <= i.dataFim
    );

    // Minhas intensivas (do professor ou turma filtrada)
    const myActiveIntensives = myIntensives.filter(
      i => dateStr >= i.dataInicio && dateStr <= i.dataFim
    );

    // --- Renderizar Minhas Intensivas (Lógica ITERATIVA EXATA) ---
    myActiveIntensives.forEach(intense => {
      // Lista de slots usados no dia (ex: 3 slots se Hibrido, 5 se Full)
      const slots = intense.horariosOcupados || [];
      const slotsPerDay = slots.length;
      
      // 1. Calcular horas acumuladas exatas desde o início até ONTEM
      let hoursBeforeToday = 0;
      
      // Itera do inicio até ontem para contar slots "consumidos"
      let cursor = new Date(intense.dataInicio + 'T12:00:00');
      const targetDate = new Date(dateStr + 'T12:00:00');
      
      while (cursor < targetDate) {
          const cStr = cursor.toISOString().split('T')[0];
          if (isBusinessDay(cStr)) {
             hoursBeforeToday += slotsPerDay;
          }
          cursor.setDate(cursor.getDate() + 1);
      }

      // 3. Itera sobre CADA SLOT desta disciplina para HOJE
      slots.forEach((slotTime, slotIndex) => {
          
          // Qual é o número sequencial desta hora no total do curso?
          const currentHourNum = hoursBeforeToday + slotIndex + 1; // 1-based

          // Determina o professor dono desta hora específica
          let slotDocente = intense.docente; // Default
          
          if (intense.docentes && intense.docentes.length > 0) {
              let acc = 0;
              for (const d of intense.docentes) {
                  acc += parseInt(d.ch);
                  // Se o acumulado de horas cobrir o início do dia de hoje (currentHourNum), é este o professor.
                  if (currentHourNum <= acc) {
                      slotDocente = d.nome;
                      break;
                  }
              }
          }

          // Se estivermos na Visão do Professor, só mostra se for ELE o dono deste slot
          if (docenteFilter && slotDocente !== docenteFilter) return;

          events.push({ 
              ...intense, 
              priority: 2, 
              title: `(I) ${intense.disciplina}`, 
              docente: slotDocente, // Professor específico deste horário
              horario: slotTime, // Amarra ao horário específico para exibição correta
              // Removemos horariosOcupados aqui para o renderizador tratar como evento único de slot
              horariosOcupados: null 
          });
      });
    });

    // --- Renderizar Regulares ---
    myRegulars.forEach(reg => {
      // TRAVA DE SEGURANÇA:
      if (store.settings.termEnd && dateStr > store.settings.termEnd) return;

      if (reg.diaSemana == dayOfWeek) {
        
        // CORREÇÃO: Bloqueio agora verifica colisão de Turma OU de Professor
        // E usa normalizeTime melhorado para garantir match de horário
        const blockingIntensive = globalActiveIntensives.find(intensive => {
            // 1. Validação de horário (slot precisa bater)
            if (!intensive.horariosOcupados || !Array.isArray(intensive.horariosOcupados)) return false;
            const regHorarioNorm = normalizeTime(reg.horario);
            const timeMatch = intensive.horariosOcupados.some(h => normalizeTime(h) === regHorarioNorm);
            if (!timeMatch) return false;

            // 2. Colisão de Turma (Sala ocupada)
            if (intensive.turmaId === reg.turmaId) return true;

            // 3. Colisão de Professor (O mesmo professor está dando intensiva em outra turma?)
            const getNames = (a) => a.docentes ? a.docentes.map(d => d.nome) : [a.docente];
            const regTeachers = getNames(reg);
            const intTeachers = getNames(intensive);
            
            // Se houver interseção de professores, a intensiva tem prioridade -> Bloqueia a regular
            const hasTeacherCollision = regTeachers.some(t => intTeachers.includes(t));
            return hasTeacherCollision;
        });

        if (blockingIntensive) {
          // *** AULA SUSPENSA POR INTENSIVA ***
          if (docenteFilter) {
             let slotDocente = reg.docente;
             const isOwner = (reg.docente === docenteFilter) || (reg.docentes && reg.docentes.some(d => d.nome === docenteFilter));
             
             if (isOwner) {
                 events.push({
                   ...reg,
                   type: 'suspension',
                   title: `Ocupado: Intensiva`,
                   cor: '#ecf0f1',
                   isSuspended: true,
                   horario: reg.horario // Garante que apareça no slot certo
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

    Object.entries(slotMap).forEach(([timeKey, eventList]) => {
      // CORREÇÃO CRÍTICA: Filtra apenas eventos ATIVOS (não suspensos) para detectar choques.
      // Se a aula B foi suspensa (type='suspension'), ela NÃO deve contar como conflito contra a aula C.
      const activeEvents = eventList.filter(ev => ev.type !== 'suspension');
      
      // Só marca choque se houver MAIS DE UM evento ATIVO no mesmo horário
      if (activeEvents.length > 1) {
        activeEvents.forEach(ev => {
           if (!ev.conflictsAt) ev.conflictsAt = [];
           if (!ev.conflictsAt.includes(timeKey)) {
               ev.conflictsAt.push(timeKey);
           }
           ev.isConflict = true;
        });
      }
    });

    events.sort((a, b) => {
      const hA = a.horario || (a.horariosOcupados ? a.horariosOcupados[0] : '') || '';
      const hB = b.horario || (b.horariosOcupados ? b.horariosOcupados[0] : '') || '';
      return hA.localeCompare(hB);
    });

    calendarData[dateStr] = events;
  });

  return calendarData;
}