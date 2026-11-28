// Janela "Montar estagio" (botao no cartao de faixas, so em componente de estagio).
// O coordenador lanca o plano do orientador em 3 passos:
//   1. Etapas: ate 4 (encontro com o orientador ou estagio em campo), turno, mes,
//      DIAS e HORAS/DIA. A soma tem que fechar a CH exata para avancar; a janela
//      mostra opcoes que fecham (19/11/2026). Dias e horas so mudam aqui.
//   2. Datas: os meses do PL um abaixo do outro. Encontro = clica nos dias; campo =
//      dias da semana e dia de comeco. Em etapa de 2 turnos, as horas de cada turno.
//   3. Faixas: confere e aplica. Cada etapa vira uma faixa; depois tudo segue
//      editavel no cartao, como sempre.
// As contas ficam em js/estagio.mjs (testadas); aqui so a tela.
import {
    calcularEstagio, faixasDoEstagio, expressaoSigaaDaEtapa, letrasDoTurno, turnoQueMostra,
    choqueDaEtapa, maxHorasDia, limitesDoMes, horasDaEtapa, horasNoSabado, opcoesDoCampo, somaPlanejada, horasPorTurno
} from './estagio.mjs?v=202611281337';
import { addDaysISO, weekdayOf } from './datas.mjs?v=202611281337';
import { MAX_FAIXAS } from './faixas.mjs?v=202611281337';

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const SEMANA1 = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const NOME_LETRA = { M: 'Manhã', T: 'Tarde', N: 'Noite' };
const TURNOS = ['Manhã', 'Tarde', 'Noite', 'Manhã+Tarde', 'Manhã+Noite', 'Tarde+Noite'];
const rotuloTurno = (t) => t.replace('+', ' e ');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
const mesDe = (iso) => String(iso || '').slice(0, 7);
// Rotulo curto da etapa nas opcoes e nas abas: "Orient. (F1)", "Campo (F2)".
const rotuloEtapa = (e, k) => `${e.tipo === 'encontro' ? 'Orient.' : 'Campo'} (F${k + 1})`;

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
//        slotsPorLetra: { M: [...], T: [...], N: [...] }, chOrientador (0 = nao informada),
//        aoAplicar({ faixas, turnoOferta, chOrientador }) }
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
        dias: [], diasSemana: tipo === 'campo' ? [1, 3] : [], inicio: null, fim: null, ver: mes,
        horasPrimeiroTurno: null
    });
    // Ponto de partida das Regras para Estagio (20/11/2026): encontro no inicio,
    // campo, encontro no final (no horario da turma). Tudo e editavel.
    const etapas = [
        novaEtapa('encontro', turnoTurma, meses[0]),
        novaEtapa('campo', contraturno, meses[0]),
        novaEtapa('encontro', turnoTurma, meses[meses.length - 1]),
        novaEtapa('campo', contraturno, meses[Math.min(1, meses.length - 1)]),
        novaEtapa('encontro', turnoTurma, meses[meses.length - 1])
    ];
    estado = { ctx, maxPorLetra, turnosPossiveis, meses, etapas, n: 3, passo: 1, ativo: 0, feriadosSet: new Set(ctx.feriados.keys()), chOrientador: Number(ctx.chOrientador) || 0 };

    const overlay = document.createElement('div');
    overlay.id = 'montar-estagio-modal';
    overlay.className = 'me-modal no-print';
    overlay.innerHTML = `
        <div class="me-caixa" role="dialog" aria-modal="true" aria-labelledby="me-titulo">
            <div class="me-cab">
                <div><h3 id="me-titulo">Montar estágio</h3><span class="me-sub">${esc(ctx.componente)} · <b>${ctx.ch} h</b> · turma ${esc(rotuloTurno(ctx.turnoTurma))}</span></div>
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
    const r = calcularEstagio({ etapas: etapas.slice(0, n), ch: ctx.ch, termStart: ctx.termStart, termEnd: ctx.termEnd, feriados: feriadosSet, turnoDaTurma: ctx.turnoTurma, maxPorLetra: estado.maxPorLetra, diasFixos: true });
    // 20/11/2026: o estagio em campo so aparece marcado depois que o coordenador
    // escolhe o dia em que comeca (clique no dia ou "Comeca"). Antes disso as
    // contas internas continuam (o minimo das etapas seguintes), mas ele nao
    // tem dias nem horas na tela e o Aplicar espera.
    r.etapas.forEach((calc, k) => {
        if (!campoSemEscolha(k)) return;
        r.alocada -= horasDaEtapa(calc, estado.maxPorLetra);
        r.etapas[k] = { ...calc, aulas: [] };
        r.avisos.push({ tipo: 'erro', texto: `Etapa ${k + 1}: clique no dia em que o estágio em campo começa.` });
    });
    return r;
}

// Campo que ainda nao teve o dia de comeco escolhido pelo coordenador.
function campoSemEscolha(k) {
    const e = estado.etapas[k];
    return !!e && e.tipo === 'campo' && !e.inicio;
}

// Passo 1 fechado: dias x horas de todas as etapas = CH (so assim vai as Datas).
function somaDoPasso1() {
    return somaPlanejada(estado.etapas.slice(0, estado.n));
}
function passo1Fecha() {
    return somaDoPasso1() === estado.ctx.ch;
}

function desenhar() {
    const modal = document.getElementById('montar-estagio-modal');
    if (!modal) return;
    if (estado.passo > 1 && !passo1Fecha()) estado.passo = 1;
    const r = calcular();
    const corpo = modal.querySelector('.me-corpo');
    if (estado.passo === 1) corpo.innerHTML = htmlPasso1();
    else if (estado.passo === 2) { corpo.innerHTML = htmlPasso2(r); preencherInfoEtapa(r); }
    else corpo.innerHTML = htmlPasso3(r);
    atualizarRodape(r);
}

// Botoes dos passos e rodape. Datas e Faixas so abrem com o passo 1 fechado.
function atualizarRodape(r = calcular()) {
    const modal = document.getElementById('montar-estagio-modal');
    if (!modal) return;
    const fecha = passo1Fecha();
    modal.querySelectorAll('.me-passos button').forEach((b) => {
        if (Number(b.dataset.passo) === estado.passo) b.setAttribute('aria-current', 'step');
        else b.removeAttribute('aria-current');
        b.disabled = Number(b.dataset.passo) > 1 && !fecha;
    });
    const pronto = r.alocada === estado.ctx.ch && !r.avisos.some((a) => a.tipo === 'erro');
    const falta = estado.ctx.ch - somaDoPasso1();
    const notaPasso1 = fecha
        ? 'Prefere fazer à mão? Feche e use o cartão de faixas.'
        : `Para ir às datas, a soma das etapas precisa fechar ${estado.ctx.ch} h (${falta > 0 ? `faltam ${falta} h` : `passou ${-falta} h`}).`;
    modal.querySelector('.me-rodape').innerHTML = estado.passo === 1
        ? `<span class="me-nota">${notaPasso1}</span><button type="button" class="me-btn me-btn--pri" data-ir="2" ${fecha ? '' : 'disabled'}>Próximo: datas ›</button>`
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
        modal.querySelector('.me-cal').outerHTML = htmlCalendario(r);
        modal.querySelector('.me-totais-area').innerHTML = htmlTotais(r);
        modal.querySelector('.me-erros-etapa').innerHTML = htmlErrosDaEtapa(r);
        preencherInfoEtapa(r);
    }
    if (estado.passo === 1) {
        modal.querySelectorAll('[data-etapa]').forEach((linha) => {
            const e = estado.etapas[Number(linha.dataset.etapa)];
            linha.querySelector('.me-choque-cel').innerHTML = htmlChoque(e.turno);
        });
        const box = modal.querySelector('#me-opcoes');
        if (box) box.innerHTML = htmlOpcoesCampo();
        const aviso = modal.querySelector('#me-aviso-campo');
        if (aviso) aviso.innerHTML = htmlAvisoContraturno();
    }
    atualizarRodape(r);
}

// Tabela Etapa | Dias | Horas/dia | Total (a soma tem que dar a CH).
function htmlTotais(r) {
    const linhas = r.etapas.map((e, k) => `
        <tr><td><span class="me-pill me-cor-${k + 1}">${k + 1}</span> ${e.tipo === 'encontro' ? 'Encontro' : 'Campo'}</td>
            <td class="me-num">${e.aulas.length}</td>
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

// Aviso (pedido de 20/11/2026): estagio em campo com um turno da turma e um
// contraturno ("choque em parte") - o coordenador confirma que e isso mesmo.
function htmlAvisoContraturno() {
    const etapas = estado.etapas.slice(0, estado.n)
        .map((e, k) => (e.tipo === 'campo' && choqueDaEtapa(e.turno, estado.ctx.turnoTurma) === 'parte' ? k + 1 : 0))
        .filter(Boolean);
    if (!etapas.length) return '';
    const quais = etapas.length === 1 ? `ETAPA ${etapas[0]}` : `ETAPAS ${etapas.join(' E ')}`;
    return `<div class="me-aviso-contraturno" role="note">CONFIRME SE O ESTÁGIO DE CAMPO (${quais}) VAI SER EM DOIS TURNOS: TURNO + CONTRATURNO.</div>`;
}

function htmlPasso1() {
    const { etapas, n, turnosPossiveis, meses, maxPorLetra } = estado;
    const linhas = etapas.slice(0, n).map((e, k) => `
        <div class="me-etapa me-cor-${k + 1}" data-etapa="${k}">
            <span class="me-etapa-nome">Etapa ${k + 1}</span>
            <select data-campo="tipo" aria-label="Etapa ${k + 1}: o que é">${opcoes([['encontro', 'Encontro com orientador'], ['campo', 'Estágio em campo']], e.tipo)}</select>
            <select data-campo="turno" aria-label="Etapa ${k + 1}: turno">${opcoes(turnosPossiveis.map((t) => [t, rotuloTurno(t)]), e.turno)}</select>
            <select data-campo="mes" aria-label="Etapa ${k + 1}: mês">${opcoes(meses.map((m) => [m, MESES[Number(m.slice(5, 7)) - 1]]), e.mes)}</select>
            <span class="me-horas"><input type="number" data-campo="diasPlanejados" min="1" max="120" value="${e.diasPlanejados}" aria-label="Etapa ${k + 1}: número de dias"> dias</span>
            <span class="me-horas"><input type="number" data-campo="horasDia" min="1" max="${maxHorasDia(e.turno, maxPorLetra)}" value="${e.horasDia}" aria-label="Etapa ${k + 1}: horas por dia"> h/dia</span>
            <span class="me-choque-cel">${htmlChoque(e.turno)}</span>
        </div>`).join('');
    return `
        <div class="me-linha-topo">
            <span class="me-rotulo">Quantas etapas?</span>
            <span class="me-seg">${Array.from({ length: MAX_FAIXAS }, (_, i) => i + 1).map((q) => `<button type="button" data-n="${q}" aria-pressed="${q === n}">${q}</button>`).join('')}</span>
            <span class="me-nota">Cada etapa vira uma faixa. Encontro: dias com a turma e o orientador. Campo: escola, laboratório, empresa, fazenda.</span>
        </div>
        <div class="me-etapas">
            <div class="me-etapa me-etapa--cab"><span></span><span>O que é</span><span>Turno</span><span>Mês</span><span>Dias</span><span>Horas</span><span>Choque</span></div>
            ${linhas}
        </div>
        <div id="me-aviso-campo">${htmlAvisoContraturno()}</div>
        <div class="me-opcoes" id="me-opcoes">${htmlOpcoesCampo()}</div>
        <div class="me-linha-topo me-orientador">
            <label class="me-rotulo" for="me-ch-orientador">CH do orientador</label>
            <span class="me-horas"><input type="number" id="me-ch-orientador" data-campo="chOrientador" min="1" max="${estado.ctx.ch}" value="${estado.chOrientador || ''}" placeholder="—"> h de ${estado.ctx.ch} h</span>
            <span class="me-nota" id="me-orientador-nota">${htmlNotaOrientador()}</span>
        </div>`;
}

// Opcoes que fecham exato (pedido de 19/11/2026): a soma das etapas e, abaixo,
// cartoes com dias x horas de cada etapa. Um clique poe os numeros na tabela.
function calcularOpcoesCampo() {
    estado.opcoesCampo = opcoesDoCampo({ etapas: estado.etapas.slice(0, estado.n), ch: estado.ctx.ch, maxPorLetra: estado.maxPorLetra });
    return estado.opcoesCampo;
}

// Etapas como ficariam com a opcao escolhida.
function etapasComOpcao(op, etapaCampo) {
    return estado.etapas.slice(0, estado.n).map((e, k) => {
        if (k === etapaCampo) return { ...e, horasDia: op.horasDia, diasPlanejados: op.dias };
        if (e.tipo === 'encontro' && op.horasEncontro) return { ...e, horasDia: op.horasEncontro };
        return e;
    });
}

function htmlOpcoesCampo() {
    const ch = estado.ctx.ch;
    const soma = somaDoPasso1();
    const o = calcularOpcoesCampo();
    // Sem fechar: aviso em caixa alta (pedido de 20/11/2026); os numeros ficam no rodape.
    const temSugestoes = !!o?.opcoes.length;
    const status = soma === ch
        ? `<div class="me-soma me-soma--ok">Soma das etapas: <b>${soma} h</b> de ${ch} h · fecha exato ✔</div>`
        // Os dois numeros em destaque (pedido de 20/11/2026): a soma em vermelho, a CH prevista em verde.
        : `<div class="me-soma me-soma--erro me-soma--alerta">SOMA DAS ETAPAS <span class="me-soma-valor me-soma-valor--soma">${soma} h</span> NÃO BATE COM A CARGA HORÁRIA PREVISTA <span class="me-soma-valor me-soma-valor--ch">${ch} h</span>.${temSugestoes ? ' ESCOLHA UMA DAS SUGESTÕES ABAIXO:' : ''}</div>`;
    if (!o) return status;
    if (o.precisa <= 0 && !o.opcoes.length) return `${status}<div class="me-aviso me-aviso--erro">Os encontros já somam a CH toda: o estágio em campo ficaria sem horas. Diminua os dias ou as horas dos encontros.</div>`;
    if (!o.opcoes.length) return status;
    const cartoes = o.opcoes.map((op, i) => {
        // Uma grade: nomes, dias, horas e totais um abaixo do outro (numeros a direita).
        const linhas = etapasComOpcao(op, o.etapa).map((e, k) => {
            const total = (Number(e.diasPlanejados) || 0) * (Number(e.horasDia) || 0);
            return `<li><span class="me-op-nome">${e.tipo === 'encontro' ? 'Orientação' : 'Campo'}</span><span class="me-op-f">(F${k + 1}):</span>`
                + `<span class="me-op-num">${e.diasPlanejados} dias</span><span>×</span><span class="me-op-num">${e.horasDia} h/dia</span><span>=</span><b class="me-op-num">${total} h</b></li>`;
        }).join('');
        return `<button type="button" class="me-opcao" data-opcao="${i}"><ul>${linhas}<li class="me-op-soma"><b class="me-op-num">${ch} h</b></li></ul></button>`;
    }).join('');
    return `${status}
        <div class="me-opcoes-titulo">${soma === ch ? 'Outras opções que também fecham exato' : 'Opções que fecham exato a Carga Horária do Estágio'}:</div>
        <div class="me-opcoes-lista">${cartoes}</div>`;
}

// CH do orientador (reuniao de 19/11/2026): so muda a soma de CH do docente.
function htmlNotaOrientador() {
    const ch = estado.ctx.ch;
    const v = estado.chOrientador;
    if (!v) return `<span class="me-orientador-falta">Não informada: o docente conta as ${ch} h.</span> É a CH que vale para o docente (Indicadores). As aulas continuam somando ${ch} h.`;
    return `O docente conta ${v} h nos Indicadores. As aulas continuam somando ${ch} h (o resto é do aluno no campo).`;
}

// ---------------------------------------------------------------- passo 2
// Abas: uma por etapa, com as horas previstas (do passo 1) e as que faltam marcar.
function htmlAbas(r) {
    return `<div class="me-abas" role="tablist">${r.etapas.map((e, k) => {
        const previstas = (Number(e.diasPlanejados) || 0) * (Number(e.horasDia) || 0);
        const falta = previstas - horasDaEtapa(e, estado.maxPorLetra);
        const ok = falta === 0;
        return `
        <button type="button" role="tab" class="me-aba me-cor-${k + 1}" data-aba="${k}" aria-selected="${k === estado.ativo}">
            <span class="me-aba-nome">${rotuloEtapa(e, k)}<small>${esc(rotuloTurno(e.turno))} · ${e.diasPlanejados} dias</small></span>
            <span class="me-aba-horas">
                <span><small>Previstas</small><b>${previstas} h</b></span>
                <span class="${ok ? 'me-ok' : 'me-erro'}"><small>${falta < 0 ? 'Sobram' : 'Faltam'}</small><b>${Math.abs(falta)} h${ok ? ' ✔' : ''}</b></span>
            </span>
        </button>`;
    }).join('')}</div>`;
}

// Um dia (quadradinho) para a etapa ativa.
function htmlDia(d, r) {
    const k = estado.ativo;
    const e = estado.etapas[k];
    const { ctx } = estado;
    const calcAtivo = r.etapas[k];
    const dow = weekdayOf(d);
    const foraDoPL = d < ctx.termStart || d > ctx.termEnd;
    const feriado = ctx.feriados.get(d);
    // Os dias das outras etapas aparecem em tom claro (20/11/2026: o campo
    // tambem, vendo um encontro). O dia do campo continua livre para o encontro:
    // se o encontro pegar esse dia, o campo se recalcula e comeca depois.
    const quem = r.etapas.findIndex((x) => x.aulas.includes(d));
    const meu = quem === k;
    const outro = quem !== -1 && !meu;
    const deOutroEncontro = outro && r.etapas[quem].tipo === 'encontro';
    // No campo, o clique escolhe o dia em que ele comeca: nao antes do dia
    // seguinte a etapa anterior.
    const campo = e.tipo === 'campo';
    const antesDoMinimo = campo && calcAtivo?.inicioMinimo && d < calcAtivo.inicioMinimo;
    const comecaAqui = campo && !!e.inicio && calcAtivo?.inicioUsado === d;
    const bloqueado = foraDoPL || dow === 0 || !!feriado || deOutroEncontro || antesDoMinimo;
    const cls = ['me-dia', meu ? `me-dia--meu me-cor-${k + 1}` : '', outro ? `me-dia--outro me-cor-${quem + 1}` : '',
        feriado ? 'me-dia--feriado' : '', (dow === 0 || foraDoPL || antesDoMinimo) ? 'me-dia--apagado' : '',
        comecaAqui ? `me-dia--inicio me-cor-${k + 1}` : ''].join(' ');
    const acao = campo ? (antesDoMinimo ? ' · antes da etapa anterior terminar' : ' · clique: o estágio começa neste dia') : '';
    const titulo = `${SEMANA[dow]} ${fmt(d)}${feriado ? ' · ' + feriado : ''}${outro ? ' · ' + rotuloEtapa(r.etapas[quem], quem) : ''}${foraDoPL ? ' · fora do período' : ''}${bloqueado ? '' : acao}`;
    return `<button type="button" class="${cls}" data-dia="${d}" aria-pressed="${meu}" ${bloqueado ? 'disabled' : ''} title="${esc(titulo)}"><span>${SEMANA1[dow]}</span><b>${Number(d.slice(8, 10))}</b></button>`;
}

// Os meses do PL um abaixo do outro; o dia 1 de todos os meses na mesma coluna.
function htmlCalendario(r) {
    const linhas = estado.meses.map((m) => {
        const nDias = Number(limitesDoMes(m).ultimo.slice(8, 10));
        let dias = '';
        for (let i = 1; i <= 31; i++) dias += i <= nDias ? htmlDia(`${m}-${String(i).padStart(2, '0')}`, r) : '<span class="me-dia-vazio"></span>';
        return `<div class="me-cal-linha"><span class="me-cal-mes">${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}</span><div class="me-cal-dias">${dias}</div></div>`;
    }).join('');
    return `<div class="me-cal">${linhas}</div>`;
}

// Horas por turno. Etapa de 2 turnos: o coordenador escolhe as do 1o turno e o
// 2o fica com o resto, igual em todos os dias da etapa. Etapa de 1 turno: so mostra.
function htmlTurnos(e) {
    const letras = letrasDoTurno(e.turno);
    const partes = horasPorTurno(e.turno, e.horasDia, estado.maxPorLetra, e.horasPrimeiroTurno);
    const horas = (l) => (partes.find(([x]) => x === l) || [l, 0])[1];
    if (letras.length === 1) {
        return `<div class="me-turnos"><span class="me-rotulo">Horas por dia</span>
            <label>${NOME_LETRA[letras[0]]} <input type="number" value="${horas(letras[0])}" readonly tabindex="-1"></label>
            <span class="me-nota">(do passo 1, iguais em todos os dias)</span></div>`;
    }
    const [a, b] = letras;
    const h = Number(e.horasDia) || 0;
    const min = Math.max(0, h - (estado.maxPorLetra[b] || 0));
    const max = Math.min(estado.maxPorLetra[a] || h, h);
    return `<div class="me-turnos"><span class="me-rotulo">Horas por dia</span>
        <label>${NOME_LETRA[a]} <input type="number" data-campo="horasPrimeiroTurno" min="${min}" max="${max}" value="${horas(a)}" aria-label="Horas por dia no turno da ${NOME_LETRA[a]}"></label>
        <span>+</span>
        <label>${NOME_LETRA[b]} <input type="number" class="me-turno2" value="${horas(b)}" readonly tabindex="-1" aria-label="Horas por dia no turno da ${NOME_LETRA[b]}"></label>
        <span>= <b>${h} h</b></span>
        <span class="me-nota">(iguais em todos os dias da etapa)</span></div>`;
}

// Avisos da etapa ativa que nao sao a contagem (a contagem esta na aba).
function htmlErrosDaEtapa(r) {
    const k = estado.ativo;
    const prefixos = [`Etapa ${k + 1}:`, `A Etapa ${k + 1} `];
    return r.avisos
        .filter((a) => a.tipo === 'erro' && prefixos.some((p) => a.texto.startsWith(p)))
        .filter((a) => !/marque os dias do encontro|dias marcados|clique no dia em que/.test(a.texto))
        .map((a) => `<div class="me-aviso me-aviso--erro">${esc(a.texto)}</div>`).join('');
}

// Textos da etapa ativa que mudam ao digitar (comeco minimo, fim).
function preencherInfoEtapa(r) {
    const modal = document.getElementById('montar-estagio-modal');
    const e = estado.etapas[estado.ativo];
    const calc = r.etapas[estado.ativo];
    if (!modal || !e || !calc) return;
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
    const plano = `${e.diasPlanejados} dias × ${e.horasDia} h/dia`;
    const campo = e.tipo === 'campo' ? `
        <div class="me-campos">
            <span class="me-rotulo">Dias da semana</span>
            <span class="me-chips">${[1, 2, 3, 4, 5, 6].map((x) => `<button type="button" class="me-chip" data-semana="${x}" aria-pressed="${e.diasSemana.includes(x)}" ${x === 6 ? 'title="Sábado: só de manhã, a partir das 8h, até 5 aulas"' : ''}>${x === 6 ? 'Sáb (manhã)' : SEMANA[x]}</button>`).join('')}</span>
            <label>Começa <input type="date" data-campo="inicio" value="${esc(e.inicio ? calc.inicioUsado || '' : '')}" min="${esc(calc.inicioMinimo || ctx.termStart)}" max="${ctx.termEnd}"></label>
            <span class="me-rotulo">Termina: <b class="me-dado me-termina"></b></span>
            <span class="me-nota me-inicio-nota"></span>
        </div>` : '';
    const instrucao = e.tipo === 'encontro'
        ? `Clique nos <b>${e.diasPlanejados} dias</b> do encontro (${plano}, do passo 1).`
        : `Escolha os dias da semana e clique no dia em que o estágio começa: os <b>${e.diasPlanejados} dias</b> saem daí (${plano}, do passo 1).`;
    return `
        ${htmlAbas(r)}
        <div class="me-painel me-cor-${k + 1}">
            <div class="me-mesbar"><span class="me-instrucao">${instrucao}</span>${htmlChoque(e.turno)}</div>
            ${campo}
            ${htmlTurnos(e)}
            <div class="me-erros-etapa">${htmlErrosDaEtapa(r)}</div>
            ${htmlCalendario(r)}
        </div>
        <div class="me-totais-area">${htmlTotais(r)}</div>`;
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
            ? `<p class="me-nota">Ao aplicar, as faixas vão para o cartão e o turno da barra lateral passa a mostrar todos os turnos usados. Depois, confira na grade e clique em Salvar Componente.</p>
               <p class="me-nota">${htmlNotaOrientador()}</p>`
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
    if (b.dataset.opcao && s.opcoesCampo) {
        // Opcao que fecha exato: poe dias e horas do campo (e as horas dos encontros, se mudam).
        const op = s.opcoesCampo.opcoes[Number(b.dataset.opcao)];
        if (!op) return;
        s.etapas[s.opcoesCampo.etapa].horasDia = op.horasDia;
        s.etapas[s.opcoesCampo.etapa].diasPlanejados = op.dias;
        if (op.horasEncontro) s.etapas.slice(0, s.n).forEach((x) => { if (x.tipo === 'encontro') x.horasDia = op.horasEncontro; });
        desenhar();
        return;
    }
    const etapa = s.etapas[s.ativo];
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
        etapa.horasPrimeiroTurno = null;
    } else if (campo === 'mes') {
        // Os dias ja marcados ficam (os meses aparecem todos nas Datas).
        etapa.mes = t.value;
        etapa.ver = t.value;
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
    if (t.type === 'number' && campo === 'chOrientador') {
        const v = parseInt(t.value, 10);
        estado.chOrientador = Number.isFinite(v) && v > 0 && v <= estado.ctx.ch ? v : 0;
        const nota = document.getElementById('me-orientador-nota');
        if (nota) nota.innerHTML = htmlNotaOrientador();
        return;
    }
    if (t.type === 'number' && campo === 'horasPrimeiroTurno') {
        // Horas do 1o turno (etapa de 2 turnos); o 2o fica com o resto.
        const etapa = estado.etapas[estado.ativo];
        const v = parseInt(t.value, 10);
        if (Number.isNaN(v)) return;
        etapa.horasPrimeiroTurno = v;
        const partes = horasPorTurno(etapa.turno, etapa.horasDia, estado.maxPorLetra, v);
        const t2 = document.querySelector('#montar-estagio-modal .me-turno2');
        if (t2) t2.value = String(partes[1]?.[1] ?? 0);
        atualizarResultados();
        return;
    }
    if (t.type !== 'number' || (campo !== 'horasDia' && campo !== 'diasPlanejados')) return;
    const linha = t.closest('[data-etapa]');
    const etapa = estado.etapas[linha ? Number(linha.dataset.etapa) : estado.ativo];
    const v = parseInt(t.value, 10);
    if (Number.isNaN(v)) return;
    if (campo === 'horasDia') {
        etapa.horasDia = Math.max(1, Math.min(v, maxHorasDia(etapa.turno, estado.maxPorLetra)));
        etapa.horasPrimeiroTurno = null;
    } else etapa.diasPlanejados = Math.max(1, Math.min(v, 120));
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
    aoAplicar({ faixas, turnoOferta: turnoQueMostra([...letras]), chOrientador: s.chOrientador });
}
