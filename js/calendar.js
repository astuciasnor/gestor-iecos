import { store } from './store.js';
import { getDaysArray, toLocalDateString } from './utils.js';

export function getCalendarEvents(turmaId, startDate, endDate, docenteFilter = null) {
    const days = getDaysArray(startDate, endDate);
    const calendarData = {}; 

    // --- Preparação de Dados ---
    const chMap = {};
    const turmaToCurso = {};

    if (store.rawData.turmas) {
        store.rawData.turmas.forEach(t => {
            turmaToCurso[t.turma_id] = t.curso_sigla;
        });
    }

    const cursoRules = {};
    if (store.rawData.disciplinas) {
        store.rawData.disciplinas.forEach(d => {
            if (!cursoRules[d.curso_sigla]) cursoRules[d.curso_sigla] = {};
            cursoRules[d.curso_sigla][d.nome] = d.ch;
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

    // --- LISTA DE FERIADOS ---
    const feriadosList = store.rawData.feriados || [];

    // --- Loop dos Dias ---
    days.forEach(date => {
        const dateStr = toLocalDateString(date);
        const dayOfWeek = date.getDay(); 
        
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            calendarData[dateStr] = []; 
            return;
        }

        const events = [];

        // 1. Verifica Feriado e PEGA O NOME
        const feriadoObj = feriadosList.find(f => f.data === dateStr);
        if (feriadoObj) {
            const nomeFeriado = feriadoObj.nome || feriadoObj.descricao || 'Feriado';
            events.push({ type: 'holiday', title: nomeFeriado });
            calendarData[dateStr] = events;
            return; 
        }

        // 2. Lógica Normal de Aulas
        const globalActiveIntensives = allIntensives.filter(i => 
            dateStr >= i.dataInicio && dateStr <= i.dataFim
        );

        const myActiveIntensives = myIntensives.filter(i => 
            dateStr >= i.dataInicio && dateStr <= i.dataFim
        );

        // Intensivas
        myActiveIntensives.forEach(intense => {
            const key = `${intense.turmaId}|${intense.disciplina}`;
            const slotsConsumed = intense.horariosOcupados ? intense.horariosOcupados.length : 5;
            executionCount[key] = (executionCount[key] || 0) + slotsConsumed;

            events.push({ ...intense, priority: 2, title: `(I) ${intense.disciplina}` });
        });

        // Regulares
        myRegulars.forEach(reg => {
            if (reg.diaSemana == dayOfWeek) {
                const isClassBusy = globalActiveIntensives.some(intensive => intensive.turmaId === reg.turmaId);

                if (!isClassBusy) {
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

        // Detector de Conflitos
        const timeMap = {};
        events.forEach(e => {
            if(!timeMap[e.horario]) timeMap[e.horario] = [];
            timeMap[e.horario].push(e);
        });

        Object.keys(timeMap).forEach(h => {
            if (timeMap[h].length > 1) {
                timeMap[h].forEach(ev => ev.isConflict = true);
            }
        });

        events.sort((a, b) => {
            if(!a.horario) return -1;
            if(!b.horario) return 1;
            return a.horario.localeCompare(b.horario);
        });

        calendarData[dateStr] = events;
    });

    return calendarData;
}