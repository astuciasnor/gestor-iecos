import { addDaysISO, weekdayOf } from './datas.mjs?v=202611281554';
import { formatWeekdays, summarizeHorarios } from './resumo_docente.mjs?v=202611281554';
// Indicadores > Dias do docente: em quais dias do PL o professor tem aula e de
// quais componentes. "Dia carregado" = 2 ou mais componentes diferentes no mesmo
// dia (manha + tarde, manha + noite...). Nao e choque de horario: e um dia pesado.
// Componente = oferta: turma + componente + subturma. T01 e T02 da mesma
// componente sao duas componentes (o professor da duas aulas diferentes no dia).
// Funcoes puras (sem DOM nem store), testadas em tests/dias_docente.test.mjs.

// entries: uma por aula do docente, ja calculada pelo calendario (feriados e
// divisao entre docentes aplicados):
//   { date, key, disciplina, turmaId, subGrupo, cor, aulas, horario, campo }
// campo: aula de estagio em campo (20/11/2026). Os alunos estao no campo, sem o
// docente: aparece, mas nao conta para o dia carregado (vai em emCampo).
// feriados: datas (iso) sem aula para todas as turmas.
export function diasDoDocente({ termStart, termEnd, entries = [], feriados = [] }) {
    if (!termStart || !termEnd || termStart > termEnd) return { datas: [], componentes: [], carregados: 0 };
    const feriadoSet = new Set(feriados);
    const porKey = new Map();

    entries.forEach((entry) => {
        if (!entry?.date || !entry.key || entry.date < termStart || entry.date > termEnd) return;
        if (!porKey.has(entry.key)) {
            porKey.set(entry.key, {
                key: entry.key,
                disciplina: entry.disciplina || '',
                turmaId: entry.turmaId || '',
                subGrupo: entry.subGrupo || '',
                cor: entry.cor || '',
                aulas: 0,
                dias: new Map() // data -> { aulas, horarios }
            });
        }
        const comp = porKey.get(entry.key);
        const aulas = Number(entry.aulas) || 1;
        comp.aulas += aulas;
        const dia = comp.dias.get(entry.date) || { aulas: 0, horarios: [], campo: true };
        dia.aulas += aulas;
        dia.campo = dia.campo && !!entry.campo; // campo so se todas as aulas do dia sao de campo
        if (entry.horario) dia.horarios.push(entry.horario);
        comp.dias.set(entry.date, dia);
    });

    const componentes = [...porKey.values()].map((comp) => {
        const datasOrdenadas = [...comp.dias.keys()].sort();
        const porData = {};
        datasOrdenadas.forEach((date) => {
            const dia = comp.dias.get(date);
            const h = summarizeHorarios(dia.horarios);
            porData[date] = { aulas: dia.aulas, horario: h.range, turnos: h.turnos, ...(dia.campo ? { campo: true } : {}) };
        });
        const geral = summarizeHorarios([...comp.dias.values()].flatMap((d) => d.horarios));
        return {
            key: comp.key,
            disciplina: comp.disciplina,
            turmaId: comp.turmaId,
            subGrupo: comp.subGrupo,
            cor: comp.cor,
            aulas: comp.aulas,
            firstDate: datasOrdenadas[0],
            lastDate: datasOrdenadas[datasOrdenadas.length - 1],
            weekdays: formatWeekdays(datasOrdenadas.map(weekdayOf)),
            horario: geral.range,
            turnos: geral.turnos,
            porData
        };
    // Ordem de inicio; no mesmo dia, a do horario mais cedo vem antes (manha, tarde, noite).
    }).sort((a, b) => a.firstDate.localeCompare(b.firstDate)
        || a.horario.localeCompare(b.horario)
        || a.disciplina.localeCompare(b.disciplina, 'pt-BR'));

    const datas = [];
    let carregados = 0;
    for (let date = termStart; date <= termEnd; date = addDaysISO(date, 1)) {
        const keys = componentes.filter((c) => c.porData[date] && !c.porData[date].campo).map((c) => c.key);
        const emCampo = componentes.filter((c) => c.porData[date]?.campo).map((c) => c.key);
        const carregado = keys.length >= 2;
        if (carregado) carregados += 1;
        datas.push({ date, weekday: weekdayOf(date), feriado: feriadoSet.has(date), componentes: keys, emCampo, carregado });
    }

    return { datas, componentes, carregados };
}
