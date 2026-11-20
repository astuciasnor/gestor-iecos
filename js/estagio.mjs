// Regras proprias das componentes de ESTAGIO (funcoes puras, sem tela).
//
// Choque no estagio (decidido com a coordenacao em 18/11/2026):
// - Aula de estagio DENTRO do turno da turma (encontro com o orientador) conta
//   como choque, como qualquer aula: para o docente e para a turma.
// - Aula de estagio FORA do turno da turma (estagio em campo: escola, laboratorio,
//   empresa, fazenda) NAO gera choque com nada. Os alunos estao em outro lugar e o
//   professor fica livre para dar outras aulas nesse horario.
// As demais componentes nao mudam: sempre contam como choque.

import { normalizeTurnoKey, turnoDaTurmaInclui } from './turns.js?v=202611201529';
import { addDaysISO, weekdayOf } from './datas.mjs?v=202611201529';

// "CBBR049 ESTAGIO III", "Estágio Supervisionado I" -> true.
export function ehEstagio(nomeComponente) {
    const nome = String(nomeComponente || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toUpperCase();
    return /\bESTAGIO\b/.test(nome);
}

// CH DO ORIENTADOR (reuniao com as coordenacoes, 19/11/2026): o estagio pode ter,
// por exemplo, 90 h, mas so 45 h contam para o docente orientador. O coordenador
// informa esse numero na janela "Montar estagio" e ele fica na alocacao
// (alloc.chOrientador). So muda a SOMA de CH do docente (Indicadores e tabela da
// agenda do docente). Aulas, choques, faixas e SIGAA continuam com a CH toda.
// Devolve as horas validas (1 a chTotal) ou 0 quando nao ha (vale a CH toda).
export function chDoOrientador(alloc, chTotal = 0) {
    if (!ehEstagio(alloc?.disciplina)) return 0;
    const v = Math.round(Number(alloc?.chOrientador));
    if (!Number.isFinite(v) || v <= 0) return 0;
    const total = Number(chTotal) || 0;
    return total > 0 && v > total ? 0 : v;
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

// Regras de choque do estagio (decididas em 20/11/2026). A faixa feita pela
// janela Montar estagio diz o tipo; faixa feita a mao nao diz (tipo '').
//   encontro: sempre conta, para a turma e para o docente, em qualquer turno;
//   campo:    nunca conta para o docente (os alunos estao no campo, sem ele);
//             para a turma, se a faixa usa o turno da turma, conta em todas as
//             aulas dela (a turma fica impedida o dia inteiro); se e so no
//             contraturno, nao conta (a turma pode ter aula no turno dela);
//   sem tipo: a regra de antes, pelo turno (aulaContaComoChoque).
// quem: 'turma' ou 'docente'. Componente que nao e estagio: sempre conta.
export function estagioContaChoque({ disciplina, horario, tipo = '', slotsDaFaixa = [], turnoDaTurma = '', horariosPorTurno = null } = {}, quem = 'turma') {
    if (!ehEstagio(disciplina)) return true;
    if (tipo === 'encontro') return true;
    if (tipo === 'campo') {
        if (quem === 'docente') return false;
        if (!String(turnoDaTurma || '').trim()) return true;
        const slots = slotsDaFaixa.length ? slotsDaFaixa : [horario];
        return slots.some((s) => {
            const turno = turnoDoHorario(s, horariosPorTurno);
            return !turno || turnoDaTurmaInclui(turnoDaTurma, turno);
        });
    }
    return aulaContaComoChoque({ disciplina, horario }, turnoDaTurma, horariosPorTurno);
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
// primeiroTurno (19/11/2026): horas do 1o turno escolhidas pelo coordenador
// (ex.: 6 h = 4 de manha + 2 a tarde), iguais em todos os dias da etapa; o 2o
// turno fica com o resto. Sem ele, divide ao meio.
export function horasPorTurno(turnoEtapa, horasDia, maxPorLetra, primeiroTurno = null) {
    const letras = letrasDoTurno(turnoEtapa);
    const h = Math.max(0, Number(horasDia) || 0);
    if (letras.length === 1) return [[letras[0], Math.min(h, maxPorLetra[letras[0]] || h)]];
    const [a, b] = letras;
    const minimo = Math.max(0, h - (maxPorLetra[b] || 0));
    const maximo = Math.min(maxPorLetra[a] || h, h);
    const pedido = Number(primeiroTurno);
    const primeira = Number.isFinite(pedido) && primeiroTurno !== null && primeiroTurno !== ''
        ? Math.max(minimo, Math.min(maximo, Math.round(pedido)))
        : Math.min(maximo, Math.max(minimo, Math.ceil(h / 2)));
    return [[a, primeira], [b, Math.min(h - primeira, maxPorLetra[b] || 0)]].filter((p) => p[1] > 0);
}

// Soma do que foi planejado no passo 1: dias x horas/dia de todas as etapas.
export function somaPlanejada(etapas = []) {
    return etapas.reduce((s, e) => s + (Number(e.diasPlanejados) || 0) * (Number(e.horasDia) || 0), 0);
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

// OPCOES DO ESTAGIO EM CAMPO (pedido de 19/11/2026). No passo 1 da janela, com
// os encontros planejados (dias x horas/dia), diz quanto falta para o ULTIMO
// estagio em campo e quais combinacoes de horas/dia x dias fecham a CH exata.
// Usa o PLANEJADO (coluna Dias), nao os dias ja marcados; sabado e feriado so
// entram no passo 2 (por isso a tela mostra "cerca de").
// Se todos os encontros tem as mesmas horas/dia, tambem sugere mudar essas horas
// (ex.: encontros de 4 h -> 5 h) quando so assim a conta fecha.
// Devolve null sem estagio em campo. Senao:
//   { etapa, precisa, horasDia, dias, exato,
//     opcoes: [{ horasDia, dias, horasEncontro (null = nao muda os encontros) }] }
export function opcoesDoCampo({ etapas = [], ch = 0, maxPorLetra = {}, limite = 4 }) {
    let k = -1;
    etapas.forEach((e, i) => { if (e.tipo === 'campo') k = i; });
    if (k < 0 || !(ch > 0)) return null;
    const num = (v) => Number(v) || 0;
    const encontros = etapas.filter((e) => e.tipo === 'encontro');
    const outrosCampos = etapas.reduce((s, e, i) => s + (e.tipo === 'campo' && i !== k ? num(e.diasPlanejados) * num(e.horasDia) : 0), 0);
    const diasEncontro = encontros.reduce((s, e) => s + num(e.diasPlanejados), 0);
    const horasEncontros = encontros.reduce((s, e) => s + num(e.diasPlanejados) * num(e.horasDia), 0);
    const campo = etapas[k];
    const c0 = num(campo.horasDia);
    const precisa = ch - horasEncontros - outrosCampos;
    const e0 = encontros.length ? num(encontros[0].horasDia) : 0;
    const mesmaHora = encontros.length > 0 && encontros.every((e) => num(e.horasDia) === e0);
    const maxCampo = maxHorasDia(campo.turno, maxPorLetra);
    const maxEncontro = encontros.length ? Math.min(...encontros.map((e) => maxHorasDia(e.turno, maxPorLetra))) : 0;

    const candidatas = [];
    const horasDosEncontros = mesmaHora ? Array.from({ length: maxEncontro }, (_, i) => i + 1) : [e0];
    horasDosEncontros.forEach((e) => {
        const p = mesmaHora ? ch - diasEncontro * e - outrosCampos : precisa;
        if (p <= 0) return;
        for (let c = 1; c <= maxCampo; c++) {
            if (p % c || p / c > 120) continue;
            const muda = mesmaHora && e !== e0;
            // Mais perto do que o coordenador ja escolheu; mexer nos encontros pesa mais.
            const distancia = Math.abs(c - c0) + (muda ? 1.5 * Math.abs(e - e0) : 0) + (c === 1 ? 5 : 0);
            candidatas.push({ horasDia: c, dias: p / c, horasEncontro: muda ? e : null, distancia });
        }
    });
    const exato = precisa > 0 && c0 > 0 && precisa % c0 === 0;
    const opcoes = candidatas
        .filter((o) => !(o.horasEncontro === null && o.horasDia === c0 && o.dias === num(campo.diasPlanejados)))
        .sort((a, b) => a.distancia - b.distancia || a.dias - b.dias)
        .slice(0, limite)
        .map(({ horasDia, dias, horasEncontro }) => ({ horasDia, dias, horasEncontro }));
    return {
        etapa: k,
        precisa,
        horasDia: c0,
        dias: precisa > 0 && c0 > 0 ? Math.ceil(precisa / c0) : 0,
        exato,
        opcoes
    };
}

// QUANTO FALTA NA ETAPA (passo 2, pedido de 19/11/2026): um aviso curto ao lado
// de Dias/Horas: vermelho enquanto falta, verde com "Falta 0 dias".
// etapa: uma etapa ja calculada por calcularEstagio (com aulas, calculado, precisa).
// Devolve { ok, texto }.
export function faltaDaEtapa(etapa, maxPorLetra = null) {
    const n = (v) => Number(v) || 0;
    const dias = (q) => `${q} ${q === 1 ? 'dia' : 'dias'}`;
    const marcados = (etapa?.aulas || []).length;
    if (etapa?.tipo === 'campo') {
        if (!(etapa.diasSemana || []).length) return { ok: false, texto: 'Escolha os dias da semana' };
        if (etapa.calculado) {
            const tem = horasDaEtapa(etapa, maxPorLetra);
            if (n(etapa.precisa) <= 0) return { ok: false, texto: 'Os encontros já somam a CH toda' };
            if (tem < etapa.precisa) return { ok: false, texto: `Faltam ${etapa.precisa - tem} h: não cabe antes da próxima etapa` };
            if (tem > etapa.precisa) return { ok: false, texto: `Sobra ${tem - etapa.precisa} h no último dia` };
            return { ok: true, texto: 'Falta 0 dias ✔' };
        }
        const falta = n(etapa.diasPlanejados) - marcados;
        return falta > 0
            ? { ok: false, texto: `Faltam ${dias(falta)}: não cabem antes da próxima etapa` }
            : { ok: true, texto: 'Falta 0 dias ✔' };
    }
    const falta = n(etapa?.diasPlanejados) - marcados;
    if (falta > 0) return { ok: false, texto: `Falta selecionar ${dias(falta)}` };
    if (falta < 0) return { ok: false, texto: `Passou ${dias(-falta)}: desmarque` };
    return { ok: true, texto: 'Falta 0 dias ✔' };
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
// Devolve { etapas: [{ ...etapa, aulas: [iso], calculado }], alocada, avisos: [{ tipo, texto }] }.
// tipo do aviso: 'erro' (impede Aplicar), 'ok' ou 'info'.
// diasFixos (19/11/2026): a janela fixa os dias de TODAS as etapas no passo 1
// (inclusive do ultimo campo); sem ele, o ultimo campo tem os dias calculados.
export function calcularEstagio({ etapas = [], ch = 0, termStart, termEnd, feriados = new Set(), turnoDaTurma = '', maxPorLetra = null, diasFixos = false }) {
    const R = etapas.map((e) => ({
        ...e,
        aulas: e.tipo === 'encontro'
            ? [...new Set(e.dias || [])].filter((d) => d >= termStart && d <= termEnd).sort()
            : [],
        calculado: false
    }));
    const horas = (r) => horasDaEtapa(r, maxPorLetra);
    let ultimoCampo = -1;
    if (!diasFixos) R.forEach((r, k) => { if (r.tipo === 'campo') ultimoCampo = k; });

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
    return { etapas: R, alocada, avisos };
}

// Expressao SIGAA de uma etapa: dias '2'..'7' + letra + aulas ('24N123').
// Sabado a parte, so de manha: '7M12345'.
export function expressaoSigaaDaEtapa(etapa, maxPorLetra) {
    const semana = [...new Set((etapa.aulas || []).map(weekdayOf))].sort();
    const aulasDe = (h) => Array.from({ length: h }, (_, i) => i + 1).join('');
    const dias = semana.filter((d) => d !== 6).map((d) => d + 1).join('');
    const partes = dias
        ? horasPorTurno(etapa.turno, etapa.horasDia, maxPorLetra, etapa.horasPrimeiroTurno).map(([l, h]) => dias + l + aulasDe(h))
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
        const slots = horasPorTurno(e.turno, e.horasDia, maxPorLetra, e.horasPrimeiroTurno)
            .flatMap(([l, h]) => (slotsPorLetra[l] || []).slice(0, h));
        const diasSemana = [...new Set(e.aulas.map(weekdayOf))].sort();
        // Sabado: as primeiras aulas da manha (ver HORAS_SABADO).
        const slotsSabado = (slotsPorLetra.M || []).slice(0, horasNoSabado(e.horasDia, maxPorLetra));
        const pattern = diasSemana.flatMap((dia) => (dia === 6 ? slotsSabado : slots).map((slot) => ({ dia, slot })));
        const inicio = e.aulas[0];
        const ultimaAula = e.aulas[e.aulas.length - 1];
        const proxima = comAula[idx + 1];
        const estagio = e.tipo === 'campo' ? 'campo' : 'encontro'; // marca da faixa (regras de choque)
        if (!proxima) return { inicio, fim: '', pausa: false, pattern, estagio };
        const vespera = addDaysISO(proxima.aulas[0], -1);
        let temDiaVazio = false;
        for (let d = addDaysISO(ultimaAula, 1); d && d <= vespera; d = addDaysISO(d, 1)) {
            if (diasSemana.includes(weekdayOf(d)) && diaLetivo(d, feriados)) { temDiaVazio = true; break; }
        }
        return temDiaVazio
            ? { inicio, fim: ultimaAula, pausa: true, pattern, estagio }
            : { inicio, fim: vespera, pausa: false, pattern, estagio };
    });
}
