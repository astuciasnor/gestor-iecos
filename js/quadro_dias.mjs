import { escapeHtml as esc } from './texto.mjs?v=202611281337';
import { vividHexColor, hexToRgb, rgbToHsl, hslToRgb } from './color_utils.js?v=202611281337';
import { diasDoDocente } from './dias_docente.mjs?v=202611281337';
import { chOrientadorDaOferta } from './estagio.mjs?v=202611281337';
// Desenho do quadro "Dias do docente": uma coluna por dia do PL, a linha
// "Sobrecarga diaria" (verde = 1 componente, vermelho = 2 ou mais) e uma linha por
// componente. Usado em Indicadores > Dias do docente e na agenda publica
// (Consulta Docente, vista Dias, so no computador); sem store e sem DOM global.
// A regra (quais dias, quais componentes) esta em dias_docente.mjs; aqui so o HTML.
// Testado em tests/quadro_dias.test.mjs.

const SEMANA_CURTA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const LETRA_DIA = ['', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export const DICA_MOUSE = 'Passe o mouse num dia para ver as aulas.';

// "3 dias com sobrecarga" / "nenhum dia com sobrecarga" (cabecalho do PL e resumo).
export function textoSobrecarga(n) {
    return n ? `${n} dia${n === 1 ? '' : 's'} com sobrecarga` : 'nenhum dia com sobrecarga';
}

// Carga horaria: inteiro com separador de milhar; fracao com 1 casa. Zero = ''.
export function fmtCH(n) {
    if (!n) return '';
    return Number.isInteger(n) ? n.toLocaleString('pt-BR') : n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

// PL sem aulas do docente: so o cabecalho.
export function quadroVazioHtml(titulo, datas, aviso = 'Sem aulas neste período') {
    return `<section class="dd-quadro is-vazio"><div class="dd-head"><b class="dd-pl">${esc(titulo)}</b><span class="dd-datas">${esc(datas)}</span><span class="dd-sem">${esc(aviso)}</span></div></section>`;
}

// No quadro Dias do docente o vermelho e o alerta de "2 ou mais componentes".
// Componente de cor vermelha (ex.: Bioquimica rosa #ffc2c2 vira #ff4f4f no tom
// forte) e desenhada em rosa aqui, para nao parecer alerta (20/11/2026).
// So neste quadro: a cor da componente nas outras telas nao muda.
export function semVermelhoDeAlerta(hex) {
    const { r, g, b } = hexToRgb(hex);
    const { h, s, l } = rgbToHsl(r, g, b);
    if (s < 0.08 || (h >= 0.04 && h <= 0.96)) return hex;
    const out = hslToRgb(0.94, s, l);
    return `#${[out.r, out.g, out.b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}

// Cor da componente no quadro (forte, sem o vermelho de alerta). A tabela da
// sub-aba Turma usa a mesma, na bolinha ao lado do nome.
export function corDoQuadro(cor) {
    return semVermelhoDeAlerta(vividHexColor(cor || '', '#7fa892'));
}

// Uma coluna por dia do PL (domingo e uma coluna fina); linha 1 = meses,
// 2 = numero das segundas, 3 = letra do dia, 4 = "Sobrecarga diaria", depois as componentes.
// indice: posicao do quadro na lista guardada por quem desenha (ver focarDiaDoQuadro).
// aulas: horas de aula (difere de ch no estagio com CH do orientador); outroPL(key):
// nome do PL de origem quando a componente e de outro PL; dica: texto inicial da
// caixa do dia, no cabecalho do PL (vazia = escondida; o Indicadores poe a dica
// uma vez so, na linha do docente). Sem legenda: as cores estao na Ajuda (21/11/2026).
// chComp(comp): { docente, total } = CH do docente na componente e CH da componente
// (sem ela: as horas de aula do quadro, sem total).
// Quadro da turma (Indicadores > Componente, 26/11/2026): semSobrecarga tira a
// linha "Sobrecarga diaria" e o aviso do cabecalho; destaque = key da componente
// buscada (as outras ficam mais claras); rotuloCH = dica da CH do cabecalho.
// Sub-aba Turma (26/11/2026): detalhe(comp) = linhas (HTML ja escapado) que
// substituem a linha curta embaixo do nome; classe = classe extra do quadro;
// aposNome(comp) = HTML logo depois do nome (atalho para a sub-aba Componente).
export function quadroDiasHtml(indice, titulo, datas, r, rotulos, ch, { aulas = ch, outroPL = () => '', dica = '', chComp = (comp) => ({ docente: comp.aulas, total: 0 }), semSobrecarga = false, destaque = '', rotuloCH = 'Carga horária do docente neste PL', detalhe = null, classe = '', aposNome = null } = {}) {
    const col = (k) => k + 2;
    const colunas = r.datas.map((d) => (d.weekday === 0 ? '4.75px' : 'minmax(5.7px, 1fr)')).join(' ');
    const pos = (k, linha) => `grid-column:${col(k)};grid-row:${linha}`;
    const corDe = (comp) => corDoQuadro(comp?.cor);
    let html = '';

    // Meses
    html += '<span class="dd-rot" style="grid-row:1"></span>';
    for (let i = 0; i < r.datas.length;) {
        const mes = r.datas[i].date.slice(0, 7);
        let j = i;
        while (j + 1 < r.datas.length && r.datas[j + 1].date.slice(0, 7) === mes) j += 1;
        html += `<span class="dd-mes" style="grid-column:${col(i)} / ${col(j) + 1};grid-row:1">${MES_CURTO[Number(mes.slice(5, 7)) - 1]}</span>`;
        i = j + 1;
    }
    // Segundas e letras
    html += '<span class="dd-rot dd-rot-sub" style="grid-row:2">segunda-feira, dia</span>';
    r.datas.forEach((d, k) => {
        html += `<span class="dd-num" style="${pos(k, 2)}" data-dd-h="${d.date}">${d.weekday === 1 ? Number(d.date.slice(8, 10)) : ''}</span>`;
    });
    html += '<span class="dd-rot" style="grid-row:3"></span>';
    r.datas.forEach((d, k) => {
        html += `<span class="dd-letra" style="${pos(k, 3)}" data-dd-h="${d.date}">${LETRA_DIA[d.weekday]}</span>`;
    });

    const celula = (d, k, linha, classe, cor) => {
        if (d.weekday === 0) return `<span class="dd-d dd-dom" style="${pos(k, linha)}"></span>`;
        // Primeiro dia do mes (2 se o dia 1 cai no domingo): linha mais forte a
        // esquerda separa os meses (antes era fundo cinza nos meses pares - confundia).
        const iniMes = k > 0 && (d.date.endsWith('-01') || (d.date.endsWith('-02') && d.weekday === 1)) ? ' dd-mes-ini' : '';
        const fer = d.feriado && !classe.includes('dd-on') && !classe.includes('dd-n2') ? ' dd-fer' : '';
        return `<span class="dd-d${iniMes}${fer}${classe}" data-dd-date="${d.date}" style="${pos(k, linha)}${cor ? `;--dd-c:${cor}` : ''}"></span>`;
    };

    // Sobrecarga diaria (todas as componentes juntas), com a legenda curta ao lado
    // do nome: vermelho = sim, verde = nao (pedido de 24/11/2026; antes "Dia a dia").
    if (!semSobrecarga) html += '<span class="dd-rot dd-rot-resumo" style="grid-row:4" title="Sobrecarga = 2 ou mais componentes no mesmo dia (não é choque)"><span class="dd-rot-nome">Sobrecarga diária</span><span class="dd-rot-leg"><i class="dd-leg dd-leg-sim"></i>sim<i class="dd-leg dd-leg-nao"></i>não</span></span>';
    if (!semSobrecarga) r.datas.forEach((d, k) => {
        if (d.carregado) html += celula(d, k, 4, ' dd-resumo dd-n2', '');
        // Um verde so (nao a cor da componente): uma componente vermelha nao parece dia carregado.
        else if (d.componentes.length === 1) html += celula(d, k, 4, ' dd-resumo dd-um', '');
        else if (d.emCampo.length) html += celula(d, k, 4, ' dd-resumo dd-campo', '');
        else html += celula(d, k, 4, ' dd-resumo', '');
    });
    html += '<span class="dd-sep" style="grid-row:5"></span>';

    // Embaixo do nome: CH, turma, horario e dias (ou as linhas de detalhe).
    const linhasDoRotulo = (comp, chTxt, sub) => {
        const extra = detalhe ? detalhe(comp) : null;
        if (Array.isArray(extra) && extra.length) return extra.map((t) => `<span class="dd-rot-sub">${t}</span>`).join('');
        return `<span class="dd-rot-sub"><b class="dd-rot-ch">${chTxt}</b> · ${esc(sub)}</span>`;
    };

    // Uma linha por componente
    const carregado = new Set(r.datas.filter((d) => d.carregado).map((d) => d.date));
    r.componentes.forEach((comp, n) => {
        const linha = 6 + n;
        const turma = rotulos.get(comp.key) || comp.turmaId;
        // CH primeiro (nao some nas reticencias): do docente / da componente (21/11/2026).
        const c = chComp(comp);
        const chTxt = c.total && c.total !== c.docente ? `${fmtCH(c.docente) || 0}/${fmtCH(c.total)}h` : `${fmtCH(c.docente) || 0}h`;
        const sub = [turma, `${comp.turnos} ${comp.horario}`.trim(), comp.weekdays].filter(Boolean).join(' · ');
        // Componente de outro PL: cor fraca e listrada (nome tambem mais apagado).
        const pl = outroPL(comp.key);
        const chDica = c.total ? `CH do docente: ${fmtCH(c.docente) || 0} h de ${fmtCH(c.total)} h da componente` : `CH do docente: ${fmtCH(c.docente) || 0} h`;
        const dica = `${comp.disciplina}${pl ? ` (componente do ${pl})` : ''}\n${chDica}\n${sub}`;
        // Quadro da turma: a componente buscada em destaque, as outras mais claras.
        const apagada = destaque && comp.key !== destaque;
        html += `<span class="dd-rot${pl ? ' dd-rot-outro' : ''}${destaque && !apagada ? ' dd-rot-destaque' : ''}${apagada ? ' dd-rot-apagada' : ''}" style="grid-row:${linha}" title="${esc(dica)}" data-dd-comp="${esc(comp.key)}"><span class="dd-rot-nome">${esc(comp.disciplina)}${aposNome ? aposNome(comp) : ''}</span>${linhasDoRotulo(comp, chTxt, sub)}</span>`;
        const cor = corDe(comp);
        r.datas.forEach((d, k) => {
            if (!comp.porData[d.date]) { html += celula(d, k, linha, '', ''); return; }
            // Estagio em campo: os alunos no campo, sem o docente (cinza, nao pesa o dia).
            if (comp.porData[d.date].campo) { html += celula(d, k, linha, ' dd-campo', ''); return; }
            html += celula(d, k, linha, ` dd-on${pl ? ' dd-outro' : ''}${apagada ? ' dd-apagada' : ''}${carregado.has(d.date) ? ' dd-dupla' : ''}`, cor);
        });
    });

    return `
        <section class="dd-quadro${Number(ch) > 0 ? ' tem-aula' : ''}${classe ? ` ${esc(classe)}` : ''}" data-dd-quadro="${indice}">
            <div class="dd-head">
                <b class="dd-pl">${esc(titulo)}</b>
                <span class="dd-datas">${esc(datas)}</span>
                ${ch === aulas
                    ? `<span class="dd-ch" title="${esc(rotuloCH)}">${fmtCH(ch) || 0}h</span>`
                    : `<span class="dd-ch dd-ch-orientador" title="Carga horária do docente neste PL: ${fmtCH(ch)} h (o estágio conta a CH do orientador). Horas de aula no calendário: ${fmtCH(aulas)} h.">${fmtCH(ch) || 0}/${fmtCH(aulas) || 0}h</span>`}
                <span class="dd-info" aria-live="polite">${esc(dica)}</span>
                ${semSobrecarga ? '' : r.carregados ? `<span class="dd-alerta" title="Dias com 2 ou mais componentes (vermelho na linha Sobrecarga diária)">${textoSobrecarga(r.carregados)}</span>` : `<span class="dd-sem">${textoSobrecarga(0)}</span>`}
            </div>
            <div class="dd-rolagem"><div class="dd-grade" style="grid-template-columns:var(--dd-col-nome, minmax(198px, 270px)) ${colunas}">${html}</div></div>
        </section>`;
}

export function textoDoDia(quadro, date) {
    const { r, rotulos, nomeFeriado } = quadro;
    const dia = r.datas.find((d) => d.date === date);
    if (!dia) return '';
    const nome = `${SEMANA_CURTA[dia.weekday]} ${ddmm(date)}`;
    if (dia.feriado && !dia.componentes.length && !dia.emCampo.length) return `${esc(nome)}: feriado (${esc(nomeFeriado.get(date) || 'Feriado')}).`;
    if (!dia.componentes.length && !dia.emCampo.length) return `${esc(nome)}: sem aula.`;
    const item = (key, campo) => {
        const comp = r.componentes.find((c) => c.key === key);
        const d = comp.porData[date];
        // Curto (cabe na caixa do cabecalho): o horario ja diz o turno.
        return `${campo ? 'estágio em campo, ' : ''}${esc(d.horario || d.turnos)} ${esc(comp.disciplina)} (${esc(rotulos.get(key) || comp.turmaId)})`;
    };
    const lista = [...dia.componentes.map((key) => item(key, false)), ...dia.emCampo.map((key) => item(key, true))].join(' · ');
    return dia.carregado
        ? `${esc(nome)} · <b>${dia.componentes.length} componentes</b> · ${lista}`
        : `${esc(nome)} · ${lista}`;
}

// quadros: a lista guardada por quem desenhou ({ r, rotulos, nomeFeriado } por indice).
export function focarDiaDoQuadro(cel, quadros) {
    const secao = cel.closest('[data-dd-quadro]');
    const quadro = quadros[Number(secao?.dataset.ddQuadro)];
    if (!secao || !quadro) return;
    const date = cel.dataset.ddDate;
    secao.querySelectorAll('.is-foco').forEach((el) => el.classList.remove('is-foco'));
    secao.querySelectorAll(`[data-dd-date="${date}"], [data-dd-h="${date}"]`).forEach((el) => el.classList.add('is-foco'));
    const info = secao.querySelector('.dd-info');
    if (info) { info.innerHTML = textoDoDia(quadro, date); info.title = info.textContent; }
}

// Uma aula do docente (evento do calendario) no formato que diasDoDocente e
// montarQuadrosDias esperam. Mesma chave nas duas telas: turma|COMPONENTE|subturma.
// plano: de qual PL veio a aula; aulas: horas da aula (Indicadores conta 1 por
// evento; a agenda publica usa a conta dela, igual as horas-aula do resumo).
export function entradaDias(ev, date, plano, { chComponente = 0, aulas = 1, horario = ev.horario } = {}) {
    const disciplina = String(ev.disciplina || ev.title || '').trim();
    return {
        date,
        key: `${ev.turmaId || ''}|${disciplina.toLocaleUpperCase('pt-BR')}|${ev.subGrupo || ''}`,
        disciplina, turmaId: ev.turmaId, subGrupo: ev.subGrupo, cor: ev.cor, aulas, horario, plano,
        campo: !!ev.estagioCampo,
        chComponente,
        // Estagio com CH do orientador (Montar estagio): e essa CH que conta
        // para o docente, nao as horas de aula. Docente unico apenas.
        chOrientador: chOrientadorDaOferta([ev], chComponente, Array.isArray(ev.docentes) && ev.docentes.length > 1)
    };
}

// Todos os quadros de um docente (um por PL), para Indicadores e agenda publica.
// planos: [{ key, periodo, termStart, termEnd }] de onde vieram as aulas (todas
// entram: os PLs se sobrepoem, a sobrecarga do dia olha todos juntos);
// mostrar: os PLs desenhados (padrao: todos); entries: de entradaDias;
// rotulos: Map key -> rotulo da turma; fmtData(iso) -> 'dd/mm/aaaa';
// avisoVazio(meta): texto do PL sem aulas (undefined = o padrao).
// Devolve { html, quadros (para focarDiaDoQuadro), carregados, chDoPL(key) }.
export function montarQuadrosDias({ planos, mostrar = planos, entries, rotulos, feriados = [], nomeFeriado = new Map(), fmtData = (iso) => iso, avisoVazio = () => undefined }) {
    const quadros = [];
    // CH = aulas do docente em cada PL (componente dividida: so a parte dele).
    const aulasDoPL = (key) => entries.reduce((n, e) => n + (e.plano === key ? e.aulas : 0), 0);
    // CH do docente: as aulas, mas o estagio com CH do orientador conta essa CH
    // (ex.: 90 h de aula, 60 h para o docente) - pedido de 20/11/2026.
    const chDoPL = (key) => {
        const porComp = new Map();
        entries.forEach((e) => {
            if (e.plano !== key) return;
            const c = porComp.get(e.key) || { aulas: 0, orientador: 0 };
            c.aulas += e.aulas;
            c.orientador = c.orientador || e.chOrientador || 0;
            porComp.set(e.key, c);
        });
        return [...porComp.values()].reduce((n, c) => n + (c.orientador || c.aulas), 0);
    };
    // De qual PL e cada componente: os PLs se sobrepoem (PL3 comeca antes do fim
    // do PL2 e o PL4 antes do fim do PL3), entao o quadro de um PL pode mostrar
    // componentes de outro - essa linha fica fraca e listrada (20/11/2026).
    const plDaKey = new Map();
    entries.forEach((e) => { if (!plDaKey.has(e.key)) plDaKey.set(e.key, e.plano); });
    const periodoDoPlano = new Map(planos.map((meta) => [meta.key, meta.periodo]));
    // CH ao lado de cada componente (21/11/2026): do docente (todas as aulas dele
    // nela, ou a CH do orientador no estagio) / da componente.
    const chPorKey = new Map();
    entries.forEach((e) => {
        const c = chPorKey.get(e.key) || { aulas: 0, orientador: 0, total: 0 };
        c.aulas += e.aulas;
        c.orientador = c.orientador || e.chOrientador || 0;
        c.total = c.total || e.chComponente || 0;
        chPorKey.set(e.key, c);
    });
    const chComp = (comp) => {
        const c = chPorKey.get(comp.key) || { aulas: comp.aulas, orientador: 0, total: 0 };
        return { docente: c.orientador || c.aulas, total: c.total };
    };
    let carregados = 0;
    const html = mostrar.map((meta) => {
        const titulo = `${String(meta.termStart).slice(0, 4)} - ${meta.periodo}`;
        const datas = `${fmtData(meta.termStart)} a ${fmtData(meta.termEnd)}`;
        const r = diasDoDocente({ termStart: meta.termStart, termEnd: meta.termEnd, entries, feriados });
        carregados += r.carregados;
        if (!r.componentes.length) return quadroVazioHtml(titulo, datas, avisoVazio(meta));
        const indice = quadros.push({ r, rotulos, nomeFeriado, plano: meta.key }) - 1;
        const outroPL = (key) => {
            const plano = plDaKey.get(key);
            return plano && plano !== meta.key ? (periodoDoPlano.get(plano) || '') : '';
        };
        return quadroDiasHtml(indice, titulo, datas, r, rotulos, chDoPL(meta.key), { aulas: aulasDoPL(meta.key), outroPL, chComp });
    }).join('');
    return { html, quadros, carregados, chDoPL };
}

// Quadro de uma turma num PL (Indicadores > Componente, 26/11/2026): o mesmo
// desenho, uma linha por componente da turma, na ordem de inicio. Duas
// componentes no mesmo dia e normal numa turma: sem "Sobrecarga diaria".
// entries: de entradaDias (todas as aulas da turma no PL); rotulos: key -> texto
// ao lado (docente); destaque: key da componente buscada.
// Devolve { html, quadro (para focarDiaDoQuadro) } ou html vazio sem aulas.
// detalhe/classe: como em quadroDiasHtml (a sub-aba Turma poe docentes e datas).
export function quadroTurmaHtml({ indice = 0, titulo, datas, termStart, termEnd, entries = [], rotulos = new Map(), feriados = [], nomeFeriado = new Map(), destaque = '', dica = '', detalhe = null, classe = '', aposNome = null }) {
    // O quadro vai ate a ultima aula, se alguma passa do fim do PL.
    const ultima = entries.reduce((m, e) => (e.date > m ? e.date : m), termEnd);
    const base = diasDoDocente({ termStart, termEnd: ultima, entries, feriados });
    if (!base.componentes.length) return { html: quadroVazioHtml(titulo, datas, 'Sem aulas desta turma neste período'), quadro: null };
    const r = { ...base, carregados: 0, datas: base.datas.map((d) => ({ ...d, carregado: false })) };
    const chPorKey = new Map();
    entries.forEach((e) => { if (!chPorKey.has(e.key) && e.chComponente) chPorKey.set(e.key, e.chComponente); });
    const aulas = entries.reduce((n, e) => n + (Number(e.aulas) || 0), 0);
    const html = quadroDiasHtml(indice, titulo, datas, r, rotulos, aulas, {
        dica,
        semSobrecarga: true,
        destaque,
        rotuloCH: 'Horas de aula da turma neste PL',
        detalhe,
        classe,
        aposNome,
        chComp: (comp) => ({ docente: chPorKey.get(comp.key) || comp.aulas, total: 0 })
    });
    return { html, quadro: { r, rotulos, nomeFeriado } };
}
