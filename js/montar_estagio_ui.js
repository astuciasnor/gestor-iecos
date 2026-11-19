// Janela "Montar estagio" (botao no cartao de faixas, so em componente de estagio).
// O coordenador lanca o plano do orientador em 3 passos:
//   1. Etapas: ate 4 (encontro com o orientador ou estagio em campo), turno, mes, horas/dia;
//   2. Datas: encontro = clica nos dias; campo = dias da semana, comeco e fim
//      (o ultimo campo tem o fim calculado para a CH fechar exata);
//   3. Faixas: confere e aplica. Cada etapa vira uma faixa; depois tudo segue
//      editavel no cartao, como sempre.
// As contas ficam em js/estagio.mjs (testadas); aqui so a tela.
import {
    calcularEstagio, faixasDoEstagio, expressaoSigaaDaEtapa, letrasDoTurno, turnoQueMostra,
    choqueDaEtapa, maxHorasDia, limitesDoMes, horasDaEtapa, horasNoSabado
} from './estagio.mjs?v=202611182310';
import { addDaysISO, weekdayOf } from './datas.mjs?v=202611182310';
import { MAX_FAIXAS } from './faixas.mjs?v=202611182310';

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const SEMANA1 = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const NOME_LETRA = { M: 'Manhã', T: 'Tarde', N: 'Noite' };
const TURNOS = ['Manhã', 'Tarde', 'Noite', 'Manhã+Tarde', 'Manhã+Noite', 'Tarde+Noite'];
const rotuloTurno = (t) => t.replace('+', ' e ');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
const mesDe = (iso) => String(iso || '').slice(0, 7);

let estado = null; // a janela aberta (so uma por vez)

export function fecharMontarEstagio() {
    document.getElementById('montar-estagio-modal')?.remove();
    document.removeEventListener('keydown', aoTeclar);
    estado = null;
}

function aoTeclar(e) {
    if (e.key === 'Escape') fecharMontarEstagio();
}

// ctx: { componente, ch, turnoTurma, termStart, termEnd, feriados: Map(iso -> nome),
//        slotsPorLetra: { M: [...], T: [...], N: [...] }, aoAplicar({ faixas, turnoOferta }) }
export function abrirMontarEstagio(ctx) {
    fecharMontarEstagio();
    const maxPorLetra = Object.fromEntries(Object.entries(ctx.slotsPorLetra).map(([l, lista]) => [l, (lista || []).length]));
    const turnosPossiveis = TURNOS.filter((t) => letrasDoTurno(t).every((l) => maxPorLetra[l] > 0));
    const meses = [];
    for (let m = mesDe(ctx.termStart); m && m <= mesDe(ctx.termEnd); m = mesDe(addDaysISO(limitesDoMes(m).ultimo, 1))) meses.push(m);
    const letrasTurma = letrasDoTurno(ctx.turnoTurma);
    const turnoTurma = turnosPossiveis.find((t) => t === turnoQueMostra(letrasTurma)) || turnosPossiveis[0];
    const contraturno = ['Noite', 'Tarde', 'Manhã'].find((t) => !letrasTurma.includes(letrasDoTurno(t)[0]) && turnosPossiveis.includes(t)) || turnosPossiveis[0];
    const novaEtapa = (tipo, turno, mes) => ({
        tipo, turno, mes,
        horasDia: Math.min(tipo === 'encontro' ? 5 : 3, maxHorasDia(turno, maxPorLetra)),
        diasPlanejados: tipo === 'encontro' ? 3 : 10,
        dias: [], diasSemana: tipo === 'campo' ? [1, 3] : [], inicio: null, fim: null, ver: mes
    });
    // Ponto de partida comum (encontro, campo, encontro); tudo e editavel.
    const etapas = [
        novaEtapa('encontro', turnoTurma, meses[0]),
        novaEtapa('campo', contraturno, meses[0]),
        novaEtapa('encontro', turnoTurma, meses[meses.length - 1]),
        novaEtapa('campo', contraturno, meses[Math.min(1, meses.length - 1)])
    ];
    estado = { ctx, maxPorLetra, turnosPossiveis, meses, etapas, n: 3, passo: 1, ativo: 0, feriadosSet: new Set(ctx.feriados.keys()) };

    const overlay = document.createElement('div');
    overlay.id = 'montar-estagio-modal';
    overlay.className = 'me-modal no-print';
    overlay.innerHTML = `
        <div class="me-caixa" role="dialog" aria-modal="true" aria-labelledby="me-titulo">
            <div class="me-cab">
                <div><h3 id="me-titulo">Montar estágio</h3><span class="me-sub">${esc(ctx.componente)} · ${ctx.ch} h · turma ${esc(rotuloTurno(ctx.turnoTurma))}</span></div>
                <ol class="me-passos">
                    <li><button type="button" data-passo="1"><i>1</i>Etapas</button></li>
                    <li><button type="button" data-passo="2"><i>2</i>Datas</button></li>
                    <li><button type="button" data-passo="3"><i>3</i>Faixas</button></li>
                </ol>
                <button type="button" class="me-fechar" aria-label="Fechar">×</button>
            </div>
            <div class="me-corpo"></div>
            <div class="me-rodape"></div>
        </div>`;
    document.body.appendChild(overlay);
    document.addEventListener('keydown', aoTeclar);
    overlay.addEventListener('click', aoClicar);
    overlay.addEventListener('change', aoMudar);
    overlay.addEventListener('input', aoDigitar);
    desenhar();
    overlay.querySelector('.me-passos button')?.focus();
}

function calcular() {
    const { ctx, etapas, n, feriadosSet } = estado;
    return calcularEstagio({ etapas: etapas.slice(0, n), ch: ctx.ch, termStart: ctx.termStart, termEnd: ctx.termEnd, feriados: feriadosSet, turnoDaTurma: ctx.turnoTurma, maxPorLetra: estado.maxPorLetra });
}

function desenhar() {
    const modal = document.getElementById('montar-estagio-modal');
    if (!modal) return;
    const r = calcular();
    modal.querySelectorAll('.me-passos button').forEach((b) => {
        if (Number(b.dataset.passo) === estado.passo) b.setAttribute('aria-current', 'step');
        else b.removeAttribute('aria-current');
    });
    const corpo = modal.querySelector('.me-corpo');
    if (estado.passo === 1) corpo.innerHTML = htmlPasso1();
    else if (estado.passo === 2) { corpo.innerHTML = htmlPasso2(r); preencherInfoEtapa(r); }
    else corpo.innerHTML = htmlPasso3(r);
    const pronto = r.alocada === estado.ctx.ch && !r.avisos.some((a) => a.tipo === 'erro');
    modal.querySelector('.me-rodape').innerHTML = estado.passo === 1
        ? '<span class="me-nota">Prefere fazer à mão? Feche e use o cartão de faixas.</span><button type="button" class="me-btn me-btn--pri" data-ir="2">Próximo: datas ›</button>'
        : estado.passo === 2
            ? '<button type="button" class="me-btn" data-ir="1">‹ Etapas</button><button type="button" class="me-btn me-btn--pri" data-ir="3">Próximo: faixas ›</button>'
            : `<button type="button" class="me-btn" data-ir="2">‹ Datas</button><button type="button" class="me-btn me-btn--pri" data-aplicar ${pronto ? '' : 'disabled'}>Aplicar nas faixas</button>`;
}

// Atualiza so o que muda com numeros digitados (o campo nao perde o foco).
function atualizarResultados() {
    const r = calcular();
    const modal = document.getElementById('montar-estagio-modal');
    if (!modal) return;
    if (estado.passo === 2) {
        modal.querySelector('.me-abas').outerHTML = htmlAbas(r);
        modal.querySelector('.me-resumo').innerHTML = htmlResumo(r);
        modal.querySelector('.me-regua').outerHTML = htmlRegua(r);
        modal.querySelector('.me-placar-area').innerHTML = htmlPlacar(r);
        modal.querySelector('.me-dias').innerHTML = htmlQuadrados(r);
        preencherInfoEtapa(r);
    }
    if (estado.passo === 1) {
        modal.querySelectorAll('[data-etapa]').forEach((linha) => {
            const e = estado.etapas[Number(linha.dataset.etapa)];
            linha.querySelector('.me-choque-cel').innerHTML = htmlChoque(e.turno);
        });
    }
}

// Indice do ultimo estagio em campo (o que tem os dias calculados).
function ultimoCampo() {
    let k = -1;
    estado.etapas.slice(0, estado.n).forEach((e, i) => { if (e.tipo === 'campo') k = i; });
    return k;
}


// Tabela Etapa | Dias | Horas/dia | Total (a soma tem que dar a CH).
function htmlTotais(r) {
    const linhas = r.etapas.map((e, k) => `
        <tr><td><span class="me-pill me-cor-${k + 1}">${k + 1}</span> ${e.tipo === 'encontro' ? 'Encontro' : 'Campo'}</td>
            <td class="me-num">${e.aulas.length}${e.calculado ? '<small> calc.</small>' : ''}</td>
            <td class="me-num">${e.horasDia}${e.aulas.some((d) => weekdayOf(d) === 6) ? `<small> sáb. ${horasNoSabado(e.horasDia, estado.maxPorLetra)}</small>` : ''}</td>
            <td class="me-num">${horasDaEtapa(e, estado.maxPorLetra)} h</td></tr>`).join('');
    const ok = r.alocada === estado.ctx.ch;
    return `<table class="me-totais">
        <thead><tr><th>Etapa</th><th class="me-num">Dias</th><th class="me-num">Horas</th><th class="me-num">Total</th></tr></thead>
        <tbody>${linhas}</tbody>
        <tfoot><tr><td colspan="3">Total (CH ${estado.ctx.ch} h)</td><td class="me-num ${ok ? 'me-ok' : 'me-erro'}"><b>${r.alocada} h</b></td></tr></tfoot>
    </table>`;
}

// ---------------------------------------------------------------- passo 1
const htmlChoque = (turno) => {
    const c = choqueDaEtapa(turno, estado.ctx.turnoTurma);
    const texto = c === 'sim' ? 'conta choque' : c === 'nao' ? 'sem choque' : 'choque em parte';
    return `<span class="me-choque me-choque--${c}" title="Choque só no turno da turma (${esc(rotuloTurno(estado.ctx.turnoTurma))})">${texto}</span>`;
};
const opcoes = (lista, atual) => lista.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(atual) ? 'selected' : ''}>${esc(t)}</option>`).join('');

function htmlPasso1() {
    const { etapas, n, turnosPossiveis, meses, maxPorLetra } = estado;
    const calc = ultimoCampo();
    const linhas = etapas.slice(0, n).map((e, k) => `
        <div class="me-etapa me-cor-${k + 1}" data-etapa="${k}">
            <span class="me-etapa-nome">Etapa ${k + 1}</span>
            <select data-campo="tipo" aria-label="Etapa ${k + 1}: o que é">${opcoes([['encontro', 'Encontro com orientador'], ['campo', 'Estágio em campo']], e.tipo)}</select>
            <select data-campo="turno" aria-label="Etapa ${k + 1}: turno">${opcoes(turnosPossiveis.map((t) => [t, rotuloTurno(t)]), e.turno)}</select>
            <select data-campo="mes" aria-label="Etapa ${k + 1}: mês">${opcoes(meses.map((m) => [m, MESES[Number(m.slice(5, 7)) - 1]]), e.mes)}</select>
            ${k === calc
                ? '<span class="me-horas" title="O último estágio em campo tem os dias calculados para a CH fechar exata">calculado</span>'
                : `<span class="me-horas"><input type="number" data-campo="diasPlanejados" min="1" max="120" value="${e.diasPlanejados}" aria-label="Etapa ${k + 1}: número de dias"> dias</span>`}
            <span class="me-horas"><input type="number" data-campo="horasDia" min="1" max="${maxHorasDia(e.turno, maxPorLetra)}" value="${e.horasDia}" aria-label="Etapa ${k + 1}: horas por dia"> h/dia</span>
            <span class="me-choque-cel">${htmlChoque(e.turno)}</span>
        </div>`).join('');
    return `
        <div class="me-linha-topo">
            <span class="me-rotulo">Quantas etapas?</span>
            <span class="me-seg">${[1, 2, 3, 4].slice(0, MAX_FAIXAS).map((q) => `<button type="button" data-n="${q}" aria-pressed="${q === n}">${q}</button>`).join('')}</span>
            <span class="me-nota">Cada etapa vira uma faixa. Encontro: dias com a turma e o orientador. Campo: escola, laboratório, empresa, fazenda.</span>
        </div>
        <div class="me-etapas">
            <div class="me-etapa me-etapa--cab"><span></span><span>O que é</span><span>Turno</span><span>Mês</span><span>Dias</span><span>Horas</span><span>Choque</span></div>
            ${linhas}
        </div>`;
}

// ---------------------------------------------------------------- passo 2
function htmlAbas(r) {
    return `<div class="me-abas" role="tablist">${r.etapas.map((e, k) => `
        <button type="button" role="tab" class="me-aba me-cor-${k + 1}" data-aba="${k}" aria-selected="${k === estado.ativo}">
            Etapa ${k + 1}<small>${e.tipo === 'encontro' ? 'Encontro' : 'Campo'} · ${esc(rotuloTurno(e.turno))} · ${e.aulas.length} dia${e.aulas.length === 1 ? '' : 's'}</small>
        </button>`).join('')}</div>`;
}

function htmlResumo(r) {
    const e = r.etapas[estado.ativo];
    if (!e) return '';
    const periodo = e.aulas.length ? `${fmt(e.aulas[0])} a ${fmt(e.aulas[e.aulas.length - 1])}` : 'sem dias ainda';
    return `${e.aulas.length} dia${e.aulas.length === 1 ? '' : 's'} · ${horasDaEtapa(e, estado.maxPorLetra)} h · ${periodo}${e.calculado && e.aulas.length ? ' <span class="me-ok">· fim calculado para fechar a CH</span>' : ''}`;
}

// Quadradinhos dos dias do mes visto da etapa ativa.
function htmlQuadrados(r) {
    const k = estado.ativo;
    const e = estado.etapas[k];
    const { ctx } = estado;
    const dono = (iso) => r.etapas.findIndex((x) => x.aulas.includes(iso));
    const calcAtivo = r.etapas[k];
    const { primeiro, ultimo } = limitesDoMes(e.ver || e.mes);
    let quadrados = '';
    for (let d = primeiro; d <= ultimo; d = addDaysISO(d, 1)) {
        const dow = weekdayOf(d);
        const foraDoPL = d < ctx.termStart || d > ctx.termEnd;
        const feriado = ctx.feriados.get(d);
        let quem = dono(d);
        // Vendo um encontro, os dias do estagio em campo nao aparecem: o campo
        // se recalcula sozinho e passa a comecar depois do encontro.
        if (e.tipo === 'encontro' && quem !== -1 && quem !== k && r.etapas[quem].tipo === 'campo') quem = -1;
        const meu = quem === k;
        const outro = quem !== -1 && !meu;
        // Dia de outro ENCONTRO fica travado; dia de estagio em campo pode ser
        // marcado (o campo e recalculado e passa a comecar depois do encontro).
        const deOutroEncontro = outro && r.etapas[quem].tipo === 'encontro';
        // No campo, o clique escolhe o dia em que ele comeca: nao antes do dia
        // seguinte a etapa anterior.
        const campo = e.tipo === 'campo';
        const antesDoMinimo = campo && calcAtivo?.inicioMinimo && d < calcAtivo.inicioMinimo;
        const comecaAqui = campo && calcAtivo?.inicioUsado === d;
        const bloqueado = foraDoPL || dow === 0 || !!feriado || deOutroEncontro || antesDoMinimo;
        const cls = ['me-dia', dow === 1 ? 'me-dia--seg' : '', meu ? `me-dia--meu me-cor-${k + 1}` : '', outro ? `me-dia--outro me-cor-${quem + 1}` : '',
            feriado ? 'me-dia--feriado' : '', (dow === 0 || foraDoPL || antesDoMinimo) ? 'me-dia--apagado' : '',
            comecaAqui ? `me-dia--inicio me-cor-${k + 1}` : ''].join(' ');
        const acao = campo ? (antesDoMinimo ? ' · antes da etapa anterior terminar' : ' · clique: o estágio começa neste dia') : '';
        const titulo = `${SEMANA[dow]} ${fmt(d)}${feriado ? ' · ' + feriado : ''}${outro ? ' · Etapa ' + (quem + 1) : ''}${foraDoPL ? ' · fora do período' : ''}${bloqueado ? '' : acao}`;
        quadrados += `<button type="button" class="${cls}" data-dia="${d}" aria-pressed="${meu}" ${bloqueado ? 'disabled' : ''} title="${esc(titulo)}"><span>${SEMANA1[dow]}</span><b>${Number(d.slice(8, 10))}</b></button>`;
    }
    return quadrados;
}

// Textos da etapa ativa que mudam ao digitar (dias marcados, dias calculados, fim).
function preencherInfoEtapa(r) {
    const modal = document.getElementById('montar-estagio-modal');
    const e = estado.etapas[estado.ativo];
    const calc = r.etapas[estado.ativo];
    if (!modal || !e || !calc) return;
    const marcados = modal.querySelector('.me-marcados');
    if (marcados) {
        marcados.textContent = `${calc.aulas.length} de ${e.diasPlanejados}`;
        marcados.className = `me-marcados ${calc.aulas.length === Number(e.diasPlanejados) ? 'me-ok' : 'me-erro'}`;
    }
    const diasCalc = modal.querySelector('.me-dias-calc');
    if (diasCalc) diasCalc.textContent = `${calc.aulas.length} (calculado)`;
    const notaInicio = modal.querySelector('.me-inicio-nota');
    if (notaInicio) {
        notaInicio.textContent = e.inicio && calc.inicioMinimo && e.inicio < calc.inicioMinimo
            ? `Começa no mínimo em ${fmt(calc.inicioMinimo)}, depois da etapa anterior.`
            : '';
    }
    const termina = modal.querySelector('.me-termina');
    if (termina) termina.textContent = calc.aulas.length ? fmt(calc.aulas[calc.aulas.length - 1]) : '—';
}

function htmlPasso2(r) {
    const k = estado.ativo;
    const e = estado.etapas[k];
    const calc = r.etapas[k];
    const { ctx } = estado;
    const mesVisto = e.ver || e.mes;
    const idxMes = estado.meses.indexOf(mesVisto);
    const inputDias = `<label>Dias <input type="number" data-campo="diasPlanejados" min="1" max="120" value="${e.diasPlanejados}"></label>`;
    const inputHoras = `<label>Horas/dia <input type="number" data-campo="horasDia" min="1" max="${maxHorasDia(e.turno, estado.maxPorLetra)}" value="${e.horasDia}"></label>`;
    const campos = e.tipo === 'campo' ? `
        <div class="me-campos me-cor-${k + 1}">
            <span class="me-rotulo">Dias da semana</span>
            <span class="me-chips">${[1, 2, 3, 4, 5, 6].map((x) => `<button type="button" class="me-chip" data-semana="${x}" aria-pressed="${e.diasSemana.includes(x)}" ${x === 6 ? 'title="Sábado: só de manhã, a partir das 8h, até 5 aulas"' : ''}>${x === 6 ? 'Sáb (manhã)' : SEMANA[x]}</button>`).join('')}</span>
            <label>Começa <input type="date" data-campo="inicio" value="${esc(calc.inicioUsado || '')}" min="${esc(calc.inicioMinimo || ctx.termStart)}" max="${ctx.termEnd}"></label>
            <span class="me-nota me-inicio-nota"></span>
            ${calc.calculado
                ? '<span class="me-rotulo">Dias: <b class="me-ok me-dias-calc"></b></span>'
                : inputDias}
            ${inputHoras}
            <span class="me-rotulo">Termina: <b class="me-dado me-termina"></b></span>
        </div>` : `
        <div class="me-campos me-cor-${k + 1}">
            ${inputDias}
            <span class="me-rotulo">Marcados: <b class="me-marcados"></b></span>
            ${inputHoras}
        </div>`;
    return `
        ${htmlAbas(r)}
        <div class="me-painel me-cor-${k + 1}">
            <div class="me-mesbar">
                <button type="button" class="me-seta" data-mes-delta="-1" aria-label="Mês anterior" ${idxMes <= 0 ? 'disabled' : ''}>‹</button>
                <b>${MESES[Number(mesVisto.slice(5, 7)) - 1]} ${mesVisto.slice(0, 4)}</b>
                <button type="button" class="me-seta" data-mes-delta="1" aria-label="Mês seguinte" ${idxMes >= estado.meses.length - 1 ? 'disabled' : ''}>›</button>
                <span class="me-nota">${e.tipo === 'encontro' ? 'Clique nos dias do encontro.' : 'Clique no dia em que o estágio começa (use ‹ › para trocar o mês). Os dias saem dos dias da semana.'}</span>
                ${htmlChoque(e.turno)}
            </div>
            <div class="me-dias-rolagem"><div class="me-dias">${htmlQuadrados(r)}</div></div>
            ${campos}
            <div class="me-resumo">${htmlResumo(r)}</div>
        </div>
        ${htmlRegua(r)}
        <div class="me-placar-area">${htmlPlacar(r)}</div>`;
}

function htmlRegua(r) {
    const { ctx } = estado;
    const total = Math.round((Date.parse(ctx.termEnd) - Date.parse(ctx.termStart)) / 864e5) + 1;
    const pos = (iso) => ((Date.parse(iso) - Date.parse(ctx.termStart)) / 864e5) / total * 100;
    let marcasMes = '';
    let linhasMes = '';
    estado.meses.forEach((m, i) => {
        const ini = i === 0 ? ctx.termStart : limitesDoMes(m).primeiro;
        marcasMes += `<span style="left:${pos(ini).toFixed(2)}%">${MESES[Number(m.slice(5, 7)) - 1].slice(0, 3).toUpperCase()}</span>`;
        if (i) linhasMes += `<i class="me-mesl" style="left:${pos(ini).toFixed(2)}%"></i>`;
    });
    // Linha fina em cada segunda-feira: separa as semanas.
    for (let d = ctx.termStart; d <= ctx.termEnd; d = addDaysISO(d, 1)) {
        if (weekdayOf(d) === 1 && d !== ctx.termStart) linhasMes += `<i class="me-semanal" style="left:${pos(d).toFixed(2)}%"></i>`;
    }
    const turma = letrasDoTurno(ctx.turnoTurma);
    const faixas = ['M', 'T', 'N'].filter((l) => estado.maxPorLetra[l] > 0).map((l) => {
        let blocos = '';
        r.etapas.forEach((e, k) => {
            if (!e.aulas.length || !letrasDoTurno(e.turno).includes(l)) return;
            const a = e.aulas[0];
            const z = e.aulas[e.aulas.length - 1];
            blocos += `<div class="me-bloco me-cor-${k + 1}" style="left:${pos(a).toFixed(2)}%;width:max(${(pos(addDaysISO(z, 1)) - pos(a)).toFixed(2)}%,5px)"><span>E${k + 1}</span></div>`;
            e.aulas.forEach((d) => { blocos += `<i class="me-aula me-cor-${k + 1}" style="left:${(pos(d) + 50 / total).toFixed(2)}%" title="Etapa ${k + 1} · ${SEMANA[weekdayOf(d)]} ${fmt(d)}"></i>`; });
        });
        const daTurma = turma.includes(l);
        return `<div class="me-faixa-regua ${daTurma ? 'me-faixa-regua--turma' : ''}"><span class="me-faixa-rot">${NOME_LETRA[l]}${daTurma ? '<small>turno da turma</small>' : ''}</span><div class="me-trilho">${linhasMes}${blocos}</div></div>`;
    }).join('');
    return `<div class="me-regua"><div class="me-regua-int"><div class="me-meses">${marcasMes}</div>${faixas}
        <div class="me-regua-legenda">Cada risquinho é um dia de aula (passe o mouse para ver a data) · linhas finas separam as semanas</div></div></div>`;
}

function htmlPlacar(r) {
    const ch = estado.ctx.ch;
    const d = ch - r.alocada;
    return `<div class="me-placar-col">
            <div class="me-placar">
                <div><small>Prevista</small><b>${ch} h</b></div>
                <div><small>Alocada</small><b>${r.alocada} h</b></div>
                <div class="${d === 0 ? 'me-placar--ok' : 'me-placar--falta'}"><small>${d < 0 ? 'Sobra' : 'Falta'}</small><b>${Math.abs(d)} h${d === 0 ? ' ✔' : ''}</b></div>
            </div>
            <div class="me-avisos">${r.avisos.map((a) => `<div class="me-aviso me-aviso--${a.tipo}">${esc(a.texto)}</div>`).join('')}</div>
        </div>
        ${htmlTotais(r)}`;
}

// ---------------------------------------------------------------- passo 3
function htmlPasso3(r) {
    const faixas = faixasDoEstagio(r.etapas, estado.ctx.slotsPorLetra, estado.feriadosSet);
    const comAula = r.etapas.map((e, k) => ({ e, k })).filter(({ e }) => e.aulas.length);
    let linhas = '';
    comAula.forEach(({ e, k }, i) => {
        const f = faixas[i];
        const anterior = faixas[i - 1];
        if (anterior?.pausa) linhas += `<tr class="me-pausa"><td colspan="7">Pausa sem aula · ${fmt(addDaysISO(anterior.fim, 1))} a ${fmt(addDaysISO(f.inicio, -1))}</td></tr>`;
        linhas += `<tr>
            <td><span class="me-pill me-cor-${k + 1}">Faixa ${i + 1}</span></td>
            <td>${e.tipo === 'encontro' ? 'Encontro' : 'Campo'} · ${esc(rotuloTurno(e.turno))}</td>
            <td>${fmt(e.aulas[0])}</td><td>${fmt(e.aulas[e.aulas.length - 1])}</td>
            <td><code>${esc(expressaoSigaaDaEtapa(e, estado.maxPorLetra))}</code></td>
            <td class="me-num">${horasDaEtapa(e, estado.maxPorLetra)} h</td>
            <td>${htmlChoque(e.turno)}</td></tr>`;
    });
    const pronto = r.alocada === estado.ctx.ch && !r.avisos.some((a) => a.tipo === 'erro');
    return `
        <div class="me-tabela-rolagem"><table class="me-tabela">
            <thead><tr><th>Faixa</th><th>Etapa</th><th>Início</th><th>Fim</th><th>Horários (SIGAA)</th><th class="me-num">CH</th><th>Choque</th></tr></thead>
            <tbody>${linhas || '<tr><td colspan="7">Marque os dias nas Datas.</td></tr>'}</tbody>
            <tfoot><tr><td colspan="5"><b>Total</b></td><td class="me-num"><b>${r.alocada} h</b></td><td></td></tr></tfoot>
        </table></div>
        ${pronto
            ? '<p class="me-nota">Ao aplicar, as faixas vão para o cartão e o turno da barra lateral passa a mostrar todos os turnos usados. Depois, confira na grade e clique em Salvar Componente.</p>'
            : htmlPendencias(r)}`;
}

// O que ainda impede o Aplicar, com as palavras de cada aviso.
function htmlPendencias(r) {
    const itens = r.avisos.filter((a) => a.tipo === 'erro').map((a) => `<li>${esc(a.texto)}</li>`);
    if (r.alocada !== estado.ctx.ch && !itens.length) itens.push(`<li>A CH ainda não fecha: ${r.alocada} de ${estado.ctx.ch} h.</li>`);
    return `<div class="me-aviso me-aviso--erro"><b>Para aplicar, volte às Datas e resolva:</b><ul class="me-pendencias">${itens.join('')}</ul></div>`;
}

// ---------------------------------------------------------------- eventos
function aoClicar(e) {
    const alvo = e.target;
    if (alvo.id === 'montar-estagio-modal' || alvo.closest('.me-fechar')) { fecharMontarEstagio(); return; }
    const b = alvo.closest('button');
    if (!b || b.disabled) return;
    const s = estado;
    if (b.dataset.passo) { s.passo = Number(b.dataset.passo); desenhar(); return; }
    if (b.dataset.ir) { s.passo = Number(b.dataset.ir); desenhar(); return; }
    if (b.dataset.n) { s.n = Number(b.dataset.n); s.ativo = Math.min(s.ativo, s.n - 1); desenhar(); return; }
    if (b.dataset.aba) { s.ativo = Number(b.dataset.aba); desenhar(); return; }
    const etapa = s.etapas[s.ativo];
    if (b.dataset.mesDelta) {
        const i = s.meses.indexOf(etapa.ver || etapa.mes) + Number(b.dataset.mesDelta);
        if (i >= 0 && i < s.meses.length) etapa.ver = s.meses[i];
        desenhar();
        return;
    }
    if (b.dataset.dia && etapa.tipo === 'campo') {
        etapa.inicio = b.dataset.dia; // o campo comeca no dia clicado
        desenhar();
        document.querySelector(`#montar-estagio-modal [data-dia="${b.dataset.dia}"]`)?.focus();
        return;
    }
    if (b.dataset.dia) {
        const d = b.dataset.dia;
        etapa.dias = etapa.dias.includes(d) ? etapa.dias.filter((x) => x !== d) : [...etapa.dias, d].sort();
        desenhar();
        document.querySelector(`#montar-estagio-modal [data-dia="${d}"]`)?.focus();
        return;
    }
    if (b.dataset.semana) {
        const x = Number(b.dataset.semana);
        etapa.diasSemana = etapa.diasSemana.includes(x) ? etapa.diasSemana.filter((y) => y !== x) : [...etapa.diasSemana, x].sort();
        desenhar();
        return;
    }
    if (b.hasAttribute('data-aplicar')) aplicar();
}

function aoMudar(e) {
    const t = e.target;
    const campo = t.dataset.campo;
    if (!campo || t.type === 'number') return;
    const s = estado;
    const linha = t.closest('[data-etapa]');
    const etapa = s.etapas[linha ? Number(linha.dataset.etapa) : s.ativo];
    if (campo === 'tipo') {
        etapa.tipo = t.value;
        if (etapa.tipo === 'campo' && !etapa.diasSemana.length) etapa.diasSemana = [1, 3];
        if (!etapa.diasPlanejados) etapa.diasPlanejados = etapa.tipo === 'encontro' ? 3 : 10;
    } else if (campo === 'turno') {
        etapa.turno = t.value;
        etapa.horasDia = Math.min(etapa.horasDia, maxHorasDia(etapa.turno, s.maxPorLetra));
    } else if (campo === 'mes') {
        etapa.mes = t.value;
        etapa.ver = t.value;
        etapa.dias = etapa.dias.filter((d) => mesDe(d) === t.value); // dias de outro mes saem
        etapa.inicio = null;
        etapa.fim = null;
    } else if (campo === 'inicio' || campo === 'fim') {
        // Datas: so recalcula, sem redesenhar o campo (senao a data digitada
        // volta para o minimo a cada numero teclado).
        etapa[campo] = t.value || null;
        atualizarResultados();
        return;
    }
    desenhar();
}

function aoDigitar(e) {
    const t = e.target;
    const campo = t.dataset.campo;
    if (t.type !== 'number' || (campo !== 'horasDia' && campo !== 'diasPlanejados')) return;
    const linha = t.closest('[data-etapa]');
    const etapa = estado.etapas[linha ? Number(linha.dataset.etapa) : estado.ativo];
    const v = parseInt(t.value, 10);
    if (Number.isNaN(v)) return;
    if (campo === 'horasDia') etapa.horasDia = Math.max(1, Math.min(v, maxHorasDia(etapa.turno, estado.maxPorLetra)));
    else etapa.diasPlanejados = Math.max(1, Math.min(v, 120));
    atualizarResultados();
}

function aplicar() {
    const s = estado;
    const r = calcular();
    if (r.alocada !== s.ctx.ch || r.avisos.some((a) => a.tipo === 'erro')) return;
    const faixas = faixasDoEstagio(r.etapas, s.ctx.slotsPorLetra, s.feriadosSet);
    const letras = new Set(letrasDoTurno(s.ctx.turnoTurma));
    r.etapas.forEach((e) => {
        if (e.aulas.length) letrasDoTurno(e.turno).forEach((l) => letras.add(l));
        if (e.aulas.some((d) => weekdayOf(d) === 6)) letras.add('M'); // sabado e de manha
    });
    const aoAplicar = s.ctx.aoAplicar;
    fecharMontarEstagio();
    aoAplicar({ faixas, turnoOferta: turnoQueMostra([...letras]) });
}
