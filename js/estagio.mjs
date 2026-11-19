// Regras proprias das componentes de ESTAGIO (funcoes puras, sem tela).
//
// Choque no estagio (decidido com a coordenacao em 18/11/2026):
// - Aula de estagio DENTRO do turno da turma (encontro com o orientador) conta
//   como choque, como qualquer aula: para o docente e para a turma.
// - Aula de estagio FORA do turno da turma (estagio em campo: escola, laboratorio,
//   empresa, fazenda) NAO gera choque com nada. Os alunos estao em outro lugar e o
//   professor fica livre para dar outras aulas nesse horario.
// As demais componentes nao mudam: sempre contam como choque.

import { normalizeTurnoKey, turnoDaTurmaInclui } from './turns.js?v=202611171437';
import { addDaysISO, weekdayOf } from './datas.mjs?v=202611171437';

// "CBBR049 ESTAGIO III", "Estágio Supervisionado I" -> true.
export function ehEstagio(nomeComponente) {
    const nome = String(nomeComponente || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toUpperCase();
    return /\bESTAGIO\b/.test(nome);
}

// "14:00 - 14:50" -> 840. Sem hora -> NaN.
function minutosDoInicio(horario) {
    const m = String(horario || '').match(/(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

// Turno de um horario: 'manha', 'tarde' ou 'noite' ('' se nao der para saber).
// 1o procura o rotulo no quadro de horarios (horariosPorTurno: { 'Manhã': [...],
// 'Tarde': [...], 'Noite': [...] }); se nao achar, decide pelo relogio.
export function turnoDoHorario(horario, horariosPorTurno = null) {
    const rotulo = String(horario || '').trim();
    if (!rotulo) return '';
    if (horariosPorTurno && typeof horariosPorTurno === 'object') {
        for (const [turno, lista] of Object.entries(horariosPorTurno)) {
            const chave = normalizeTurnoKey(turno);
            if (!['manha', 'tarde', 'noite'].includes(chave)) continue; // so turnos simples
            if (Array.isArray(lista) && lista.some((s) => String(s || '').trim() === rotulo)) return chave;
        }
    }
    const min = minutosDoInicio(rotulo);
    if (!Number.isFinite(min)) return '';
    if (min < 12 * 60 + 30) return 'manha';
    if (min < 18 * 60) return 'tarde';
    return 'noite';
}

// A aula pode gerar choque? So nao gera quando e estagio fora do turno da turma.
// aula: { disciplina, horario }; turnoDaTurma: turno proprio da turma ("Manhã",
// "Manhã+Tarde"...). Sem turno da turma ou sem horario reconhecido: conta (seguro).
export function aulaContaComoChoque(aula, turnoDaTurma, horariosPorTurno = null) {
    if (!ehEstagio(aula?.disciplina)) return true;
    if (!String(turnoDaTurma || '').trim()) return true;
    const turno = turnoDoHorario(aula?.horario, horariosPorTurno);
    if (!turno) return true;
    return turnoDaTurmaInclui(turnoDaTurma, turno);
}

// ===========================================================================
// MONTAR ESTAGIO (janela em js/montar_estagio_ui.js). O coordenador lanca o
// plano do orientador em ate 4 ETAPAS, na ordem das datas:
//   - encontro: dias marcados um a um (no horario da turma, em geral);
//   - campo: dias da semana entre um comeco e um fim; o ULTIMO campo tem o fim
//     calculado para a CH fechar exata.
// Cada etapa vira uma faixa do Cardume. Nada aqui mexe na tela.
// ===========================================================================

// Letras de um turno: "Manhã" -> ['M'], "Manhã+Noite" -> ['M', 'N'].
const LETRA_DO_TURNO = { manha: 'M', tarde: 'T', noite: 'N' };
export function letrasDoTurno(turno) {
    const chave = normalizeTurnoKey(turno);
    if (chave === 'integral') return ['M', 'T', 'N'];
    return chave.split('_').map((p) => LETRA_DO_TURNO[p]).filter(Boolean);
}

// Turno da barra lateral que mostra todas as letras: ['M','N'] -> "Manhã+Noite".
export function turnoQueMostra(letras = []) {
    const set = new Set(letras);
    const tem = (l) => set.has(l);
    if (tem('M') && tem('T') && tem('N')) return 'Integral';
    if (tem('M') && tem('T')) return 'Manhã+Tarde';
    if (tem('M') && tem('N')) return 'Manhã+Noite';
    if (tem('T') && tem('N')) return 'Tarde+Noite';
    if (tem('M')) return 'Manhã';
    if (tem('N')) return 'Noite';
    return 'Tarde';
}

// Choque da etapa: 'sim' (todo no turno da turma), 'nao' (todo fora) ou 'parte'.
export function choqueDaEtapa(turnoEtapa, turnoDaTurma) {
    const da = letrasDoTurno(turnoEtapa);
    const turma = letrasDoTurno(turnoDaTurma);
    const dentro = da.filter((l) => turma.includes(l)).length;
    if (dentro === 0) return 'nao';
    return dentro === da.length ? 'sim' : 'parte';
}

// Horas por dia divididas entre os turnos da etapa (ex.: Manhã+Tarde, 10 h -> 5 + 5).
// maxPorLetra: { M: 6, T: 6, N: 4 } (aulas de cada turno no quadro).
export function horasPorTurno(turnoEtapa, horasDia, maxPorLetra) {
    const letras = letrasDoTurno(turnoEtapa);
    const h = Math.max(0, Number(horasDia) || 0);
    if (letras.length === 1) return [[letras[0], Math.min(h, maxPorLetra[letras[0]] || h)]];
    const [a, b] = letras;
    const primeira = Math.min(maxPorLetra[a] || h, Math.max(h - (maxPorLetra[b] || 0), Math.ceil(h / 2)));
    return [[a, primeira], [b, Math.min(h - primeira, maxPorLetra[b] || 0)]].filter((p) => p[1] > 0);
}

// Maximo de horas por dia de um turno (ate 10).
export function maxHorasDia(turnoEtapa, maxPorLetra) {
    return Math.min(10, letrasDoTurno(turnoEtapa).reduce((s, l) => s + (maxPorLetra[l] || 0), 0));
}

const diaLetivo = (iso, feriados) => weekdayOf(iso) !== 0 && !feriados.has(iso);

// SABADO (18/11/2026): estagio no sabado e so de manha, a partir da 1a aula
// (8h), no maximo 5 aulas - escola e empresa raramente funcionam a tarde.
export const HORAS_SABADO = 5;
export function horasNoSabado(horasDia, maxPorLetra = null) {
    return Math.min(Number(horasDia) || 0, HORAS_SABADO, maxPorLetra?.M ?? HORAS_SABADO);
}
// Horas de um dia da etapa: no sabado, as aulas da manha; nos outros, as horas/dia.
export function horasNoDia(etapa, iso, maxPorLetra = null) {
    return weekdayOf(iso) === 6 ? horasNoSabado(etapa.horasDia, maxPorLetra) : (Number(etapa.horasDia) || 0);
}
// Horas de todas as aulas da etapa.
export function horasDaEtapa(etapa, maxPorLetra = null) {
    return (etapa.aulas || []).reduce((s, d) => s + horasNoDia(etapa, d, maxPorLetra), 0);
}

// Dias de um encontro que faltam para repetir o mesmo padrao semanal entre o
// primeiro e o ultimo dia (a faixa repete os dias da semana nesse intervalo).
export function diasQueFaltamNoPadrao(dias = [], feriados = new Set()) {
    const ordenados = [...new Set(dias)].sort();
    if (ordenados.length < 2) return [];
    const semana = new Set(ordenados.map(weekdayOf));
    const marcados = new Set(ordenados);
    const faltam = [];
    for (let d = ordenados[0]; d && d <= ordenados[ordenados.length - 1]; d = addDaysISO(d, 1)) {
        if (semana.has(weekdayOf(d)) && diaLetivo(d, feriados) && !marcados.has(d)) faltam.push(d);
    }
    return faltam;
}

// Primeiro e ultimo dia do mes 'AAAA-MM'.
export function limitesDoMes(mes) {
    const [y, m] = String(mes).split('-').map(Number);
    const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { primeiro: `${mes}-01`, ultimo: `${mes}-${String(ultimo).padStart(2, '0')}` };
}

const fmtBR = (iso) => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '';

// Calcula as aulas de cada etapa.
// etapas: [{ tipo: 'encontro'|'campo', turno, horasDia, mes: 'AAAA-MM', diasPlanejados,
//            dias: [iso] (encontro), diasSemana: [1..6], inicio, fim (campo) }]
// diasPlanejados: no encontro, quantos dias o coordenador quer marcar; no campo
// (menos o ultimo), quantos dias de aula a partir do comeco (o fim sai disso).
// Devolve { etapas: [{ ...etapa, aulas: [iso], calculado }], alocada, avisos: [{ tipo, texto, acao? }] }.
// tipo do aviso: 'erro' (impede Aplicar), 'ok' ou 'info'. acao: sugestao com botao
// ({ etapa, turno, horasDia }).
export function calcularEstagio({ etapas = [], ch = 0, termStart, termEnd, feriados = new Set(), turnoDaTurma = '', maxPorLetra = null }) {
    const R = etapas.map((e) => ({
        ...e,
        aulas: e.tipo === 'encontro'
            ? [...new Set(e.dias || [])].filter((d) => d >= termStart && d <= termEnd).sort()
            : [],
        calculado: false
    }));
    const horas = (r) => horasDaEtapa(r, maxPorLetra);
    let ultimoCampo = -1;
    R.forEach((r, k) => { if (r.tipo === 'campo') ultimoCampo = k; });

    const inicioDe = (k) => {
        const r = R[k];
        if (r.tipo === 'encontro') return r.aulas[0] || null;
        return r.inicio || (r.mes ? limitesDoMes(r.mes).primeiro : null);
    };
    // Primeiro dia da proxima etapa que ja tem data (limite, exclusivo).
    const proximoInicio = (k) => {
        for (let j = k + 1; j < R.length; j++) { const v = inicioDe(j); if (v) return v; }
        return addDaysISO(termEnd, 1);
    };

    let fimAnterior = '';
    R.forEach((r, k) => {
        if (r.tipo === 'encontro') {
            if (r.aulas.length) fimAnterior = r.aulas[r.aulas.length - 1];
            return;
        }
        const base = r.inicio || (r.mes ? limitesDoMes(r.mes).primeiro : termStart);
        // O campo comeca quando o coordenador quiser, mas nunca antes do dia
        // seguinte a etapa anterior (nem antes do periodo).
        const minimo = [termStart, fimAnterior ? addDaysISO(fimAnterior, 1) : ''].filter(Boolean).sort().pop();
        r.inicioMinimo = minimo;
        let ini = [base, minimo].filter(Boolean).sort().pop();
        const limite = proximoInicio(k);
        const semana = new Set((r.diasSemana || []).map(Number));
        const aulas = [];
        if (k === ultimoCampo) {
            r.calculado = true;
            const outras = R.reduce((s, o, j) => s + (j === k ? 0 : (j < k || o.tipo === 'encontro' ? horas(o) : 0)), 0);
            r.precisa = ch - outras;
            if (r.precisa > 0 && r.horasDia > 0) {
                let soma = 0;
                for (let d = ini; d && d < limite && d <= termEnd; d = addDaysISO(d, 1)) {
                    if (!semana.has(weekdayOf(d)) || !diaLetivo(d, feriados)) continue;
                    aulas.push(d);
                    soma += horasNoDia(r, d, maxPorLetra);
                    if (soma >= r.precisa) break;
                }
            }
        } else if (Number(r.diasPlanejados) > 0) {
            // N dias de aula a partir do comeco, ate a proxima etapa.
            for (let d = ini; d && d < limite && d <= termEnd; d = addDaysISO(d, 1)) {
                if (!semana.has(weekdayOf(d)) || !diaLetivo(d, feriados)) continue;
                aulas.push(d);
                if (aulas.length >= Number(r.diasPlanejados)) break;
            }
        } else {
            const fimMes = r.mes ? limitesDoMes(r.mes).ultimo : termEnd;
            const fim = [r.fim || fimMes, addDaysISO(limite, -1), termEnd].sort()[0];
            for (let d = ini; d && d <= fim; d = addDaysISO(d, 1)) {
                if (semana.has(weekdayOf(d)) && diaLetivo(d, feriados)) aulas.push(d);
            }
        }
        r.inicioUsado = ini;
        r.aulas = aulas;
        if (aulas.length) fimAnterior = aulas[aulas.length - 1];
    });

    const alocada = R.reduce((s, r) => s + horas(r), 0);
    const avisos = [];
    R.forEach((r, k) => {
        const planejados = Number(r.diasPlanejados) || 0;
        if (r.tipo === 'encontro') {
            if (!r.aulas.length) avisos.push({ tipo: 'erro', texto: `Etapa ${k + 1}: marque os dias do encontro.` });
            else if (planejados && r.aulas.length !== planejados) {
                avisos.push({ tipo: 'erro', texto: `Etapa ${k + 1}: ${r.aulas.length} de ${planejados} dias marcados. Marque os dias que faltam ou mude o número de dias.` });
            }
            const faltam = diasQueFaltamNoPadrao(r.aulas, feriados);
            if (faltam.length) {
                avisos.push({ tipo: 'erro', texto: `Etapa ${k + 1}: os dias não repetem o mesmo padrão toda semana. Marque também ${faltam.slice(0, 5).map(fmtBR).join(', ')}${faltam.length > 5 ? '…' : ''} ou desmarque o dia que sobra.` });
            }
        } else if (!(r.diasSemana || []).length) {
            avisos.push({ tipo: 'erro', texto: `Etapa ${k + 1}: escolha os dias da semana do estágio em campo.` });
        } else if (!r.calculado && planejados && r.aulas.length < planejados) {
            avisos.push({ tipo: 'erro', texto: `Etapa ${k + 1}: só cabem ${r.aulas.length} dos ${planejados} dias antes da próxima etapa. Diminua os dias ou escolha mais dias da semana.` });
        }
    });
    for (let k = 1; k < R.length; k++) {
        const a = R[k - 1].aulas, b = R[k].aulas;
        if (a.length && b.length && b[0] <= a[a.length - 1]) {
            avisos.push({ tipo: 'erro', texto: `A Etapa ${k + 1} começa antes do fim da Etapa ${k}. As etapas seguem a ordem das datas.` });
        }
    }
    if (ultimoCampo >= 0) {
        const r = R[ultimoCampo];
        const tem = horas(r);
        if (r.precisa <= 0) avisos.push({ tipo: 'erro', texto: `As outras etapas já somam a CH toda: a Etapa ${ultimoCampo + 1} ficaria sem aula.` });
        else if (tem < r.precisa) avisos.push({ tipo: 'erro', texto: `A Etapa ${ultimoCampo + 1} não cabe antes da próxima etapa (ou do fim do período): faltam ${r.precisa - tem} h. Escolha mais dias da semana ou mais horas por dia.` });
        else if (tem > r.precisa) avisos.push({ tipo: 'erro', texto: `Sobra ${tem - r.precisa} h na última aula da Etapa ${ultimoCampo + 1}. Para fechar exato, mude as horas por dia de alguma etapa.` });
    } else if (alocada !== ch) {
        avisos.push({ tipo: 'erro', texto: alocada < ch ? `Faltam ${ch - alocada} h. Marque mais dias ou acrescente um estágio em campo.` : `Passou ${alocada - ch} h da CH. Desmarque dias ou diminua as horas por dia.` });
    }
    if (!avisos.some((a) => a.tipo === 'erro') && alocada === ch) avisos.push({ tipo: 'ok', texto: 'Fecha exato. Pode conferir as faixas.' });
    if (R.some((r) => Number(r.horasDia) > 6)) {
        avisos.push({ tipo: 'info', texto: 'Acima de 6 h por dia: a Lei do Estágio (11.788/2008) fala em 6 h/dia e 30 h/semana no período de aulas. É só um lembrete.' });
    }
    // Sugestao: campo que ocupa o turno da turma e mais um turno (ou passa de 6 h)
    // pode ficar so no turno da turma, ate 6 h; o outro turno fica livre para
    // outra componente. So sugere: o coordenador decide pelo botao.
    const letrasTurma = letrasDoTurno(turnoDaTurma);
    if (letrasTurma.length === 1) {
        const [lt] = letrasTurma;
        const nomeTurma = { M: 'Manhã', T: 'Tarde', N: 'Noite' }[lt];
        // Ate 6 h (Lei do Estagio), ou menos se o turno tem menos aulas no quadro.
        const maxTurma = Math.min(6, maxPorLetra?.[lt] || (lt === 'N' ? 4 : 6));
        R.forEach((r, k) => {
            const letras = letrasDoTurno(r.turno);
            if (r.tipo !== 'campo' || !letras.includes(lt)) return;
            if (letras.length === 1 && Number(r.horasDia) <= maxTurma) return;
            avisos.push({
                tipo: 'info',
                texto: `Etapa ${k + 1}: com o estágio em campo só na ${nomeTurma} (até ${maxTurma} h), o outro turno fica livre para uma componente comum da turma.`,
                acao: { etapa: k, turno: nomeTurma, horasDia: Math.min(maxTurma, Number(r.horasDia) || maxTurma), rotulo: `Usar só ${nomeTurma}, ${Math.min(maxTurma, Number(r.horasDia) || maxTurma)} h` }
            });
        });
    }
    return { etapas: R, alocada, avisos };
}

// Expressao SIGAA de uma etapa: dias '2'..'7' + letra + aulas ('24N123').
// Sabado a parte, so de manha: '7M12345'.
export function expressaoSigaaDaEtapa(etapa, maxPorLetra) {
    const semana = [...new Set((etapa.aulas || []).map(weekdayOf))].sort();
    const aulasDe = (h) => Array.from({ length: h }, (_, i) => i + 1).join('');
    const dias = semana.filter((d) => d !== 6).map((d) => d + 1).join('');
    const partes = dias
        ? horasPorTurno(etapa.turno, etapa.horasDia, maxPorLetra).map(([l, h]) => dias + l + aulasDe(h))
        : [];
    if (semana.includes(6)) partes.push('7M' + aulasDe(horasNoSabado(etapa.horasDia, maxPorLetra)));
    return partes.join(' ');
}

// Etapas calculadas -> faixas do Cardume: [{ inicio, fim, pausa, pattern: [{ dia, slot }] }].
// slotsPorLetra: { M: ['08:00 - 08:50', ...], T: [...], N: [...] } (sem intervalos).
// O Fim de cada faixa e a vespera da seguinte; so fica antes (pausa) quando ha
// dias da semana dessa faixa sem aula ate a seguinte. A ultima fica sem Fim: o
// Cardume corta onde a CH fecha.
export function faixasDoEstagio(etapasCalculadas = [], slotsPorLetra = {}, feriados = new Set()) {
    const maxPorLetra = Object.fromEntries(Object.entries(slotsPorLetra).map(([l, lista]) => [l, (lista || []).length]));
    const comAula = etapasCalculadas.filter((e) => (e.aulas || []).length);
    return comAula.map((e, idx) => {
        const slots = horasPorTurno(e.turno, e.horasDia, maxPorLetra)
            .flatMap(([l, h]) => (slotsPorLetra[l] || []).slice(0, h));
        const diasSemana = [...new Set(e.aulas.map(weekdayOf))].sort();
        // Sabado: as primeiras aulas da manha (ver HORAS_SABADO).
        const slotsSabado = (slotsPorLetra.M || []).slice(0, horasNoSabado(e.horasDia, maxPorLetra));
        const pattern = diasSemana.flatMap((dia) => (dia === 6 ? slotsSabado : slots).map((slot) => ({ dia, slot })));
        const inicio = e.aulas[0];
        const ultimaAula = e.aulas[e.aulas.length - 1];
        const proxima = comAula[idx + 1];
        if (!proxima) return { inicio, fim: '', pausa: false, pattern };
        const vespera = addDaysISO(proxima.aulas[0], -1);
        let temDiaVazio = false;
        for (let d = addDaysISO(ultimaAula, 1); d && d <= vespera; d = addDaysISO(d, 1)) {
            if (diasSemana.includes(weekdayOf(d)) && diaLetivo(d, feriados)) { temDiaVazio = true; break; }
        }
        return temDiaVazio
            ? { inicio, fim: ultimaAula, pausa: true, pattern }
            : { inicio, fim: vespera, pausa: false, pattern };
    });
}
