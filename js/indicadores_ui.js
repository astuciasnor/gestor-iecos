// Menu Indicadores (so leitura: nada e gravado).
// Sub-aba "Carga por docente": tabela com a CH de cada docente por curso e por PL,
// do ano inteiro ou de um PL. As contas estao em indicadores.mjs.
import { store } from './store.js?v=202611141134';
import { getCursoSiglaDaTurma, getDisciplinaCHGlobal } from './curso_turma_helpers.js?v=202611141134';
import { formatDateBR } from './date_utils_ui.js?v=202611141134';
import { UNIDADES } from './docente_nomes.mjs?v=202611141134';
import { cargaPorDocente, ordenarLinhas, SEM_DOCENTE } from './indicadores.mjs?v=202611141134';

const VALIDADE_MS = 2 * 60 * 1000; // depois disso, abrir o menu busca de novo

let carregarPlanos = null;   // (metas) => Promise<[{ meta, allocations }]>, vem do ui.js
let abrirAgendaDocente = null; // (nome, periodo) => void, vem do ui.js
let avisarErro = (msg) => console.warn(msg);

const estado = {
    unidade: 'IECOS',        // so os cursos desta unidade (IECOS ou CBRAG)
    ano: '',
    periodo: 'ano',          // 'ano' ou a chave do PL
    ordem: { coluna: 'total', crescente: false },
    dados: null,             // { ano, planos: [{ meta, allocations }], em }
    carregando: false
};

export function setIndicadoresLigacoes({ carregar, abrirDocente, erro } = {}) {
    if (typeof carregar === 'function') carregarPlanos = carregar;
    if (typeof abrirDocente === 'function') abrirAgendaDocente = abrirDocente;
    if (typeof erro === 'function') avisarErro = erro;
}

function esc(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtCH(n) {
    if (!n) return '';
    return Number.isInteger(n) ? n.toLocaleString('pt-BR') : n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

// Unidade do curso (cursos[].unidade no dados_app.json; sem ela, IECOS).
function unidadeDe(sigla) {
    return String((store.rawData?.cursos || []).find((c) => c.sigla === sigla)?.unidade || 'IECOS').toUpperCase();
}

function nomeUnidade(sigla) {
    return UNIDADES.find((u) => u.sigla === sigla)?.nome || sigla;
}

function rawPlans() {
    return Array.isArray(store.rawData?.periodos_letivos) ? store.rawData.periodos_letivos : [];
}

const anoDe = (item) => String(item?.ano || String(item?.inicio || '').slice(0, 4));

// PL1..PL4 do ano, em ordem de inicio.
function metasDoAno(ano) {
    return rawPlans()
        .filter((item) => anoDe(item) === ano && item?.inicio && item?.fim)
        .sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)))
        .map((item) => store.getPlanMetaFromSettings({
            periodo: item.periodo_letivo || item.periodo || '',
            termStart: item.inicio,
            termEnd: item.fim
        }))
        .filter((meta) => meta?.key);
}

export function setupIndicadores() {
    const selAno = document.getElementById('sel-ano-indicadores');
    const btnAno = document.getElementById('btn-ano-inteiro-indicadores');
    const btnAtualizar = document.getElementById('btn-atualizar-indicadores');
    if (!selAno || !btnAno) return;

    // Unidade: IECOS marcada; as outras que tem cursos no Cardume (CBRAG).
    const selUnidade = document.getElementById('sel-unidade-indicadores');
    if (selUnidade) {
        const unidades = [...new Set((store.rawData?.cursos || []).map((c) => unidadeDe(c.sigla)))];
        if (!unidades.includes('IECOS')) unidades.unshift('IECOS');
        selUnidade.innerHTML = unidades.map((u) => `<option value="${esc(u)}">${esc(u === nomeUnidade(u) ? u : `${nomeUnidade(u)} (${u})`)}</option>`).join('');
        selUnidade.value = estado.unidade;
        selUnidade.addEventListener('change', () => { estado.unidade = selUnidade.value; desenhar(); });
    }

    const anos = [...new Set(rawPlans().map(anoDe).filter((a) => /^\d{4}$/.test(a)))].sort();
    selAno.innerHTML = anos.map((a) => `<option value="${a}">${a}</option>`).join('');
    const anoAtivo = String(store.settings?.termStart || '').slice(0, 4);
    estado.ano = anos.includes(anoAtivo) ? anoAtivo : (anos[anos.length - 1] || '');
    selAno.value = estado.ano;
    montarBotoesPL();

    btnAno.addEventListener('click', () => { estado.periodo = 'ano'; desenhar(); });
    selAno.addEventListener('change', () => {
        estado.ano = selAno.value;
        estado.periodo = 'ano';
        montarBotoesPL();
        renderIndicadores({ recarregar: true });
    });
    btnAtualizar?.addEventListener('click', () => renderIndicadores({ recarregar: true }));

    // Cabecalho clicavel (ordenar) e nome do docente (abrir a agenda dele).
    document.getElementById('ind-tabela')?.addEventListener('click', (ev) => {
        const th = ev.target.closest('th[data-coluna]');
        if (th) {
            const coluna = th.dataset.coluna;
            const mesma = estado.ordem.coluna === coluna;
            estado.ordem = { coluna, crescente: mesma ? !estado.ordem.crescente : coluna === 'nome' };
            desenhar();
            return;
        }
        const link = ev.target.closest('button[data-docente]');
        if (link && abrirAgendaDocente) {
            const meta = metasDoAno(estado.ano).find((m) => m.key === estado.periodo);
            abrirAgendaDocente(link.dataset.docente, meta ? { tipo: 'pl', meta, ano: estado.ano } : { tipo: 'ano', ano: estado.ano });
        }
    });
}

function montarBotoesPL() {
    const box = document.getElementById('ind-pl-buttons');
    if (!box) return;
    box.innerHTML = metasDoAno(estado.ano).map((meta) => `
        <button type="button" class="docente-periodo-btn" data-plan-key="${esc(meta.key)}"
            title="${esc(`${estado.ano} - ${meta.periodo}: ${formatDateBR(meta.termStart)} a ${formatDateBR(meta.termEnd)}`)}">${esc(meta.periodo)}</button>`).join('');
    box.querySelectorAll('button[data-plan-key]').forEach((btn) => {
        btn.addEventListener('click', () => { estado.periodo = btn.dataset.planKey; desenhar(); });
    });
}

// Abre o menu: busca os PLs do ano (de novo se os dados tem mais de 2 minutos).
export async function renderIndicadores({ recarregar = false } = {}) {
    if (!estado.ano) { desenhar(); return; }
    const velho = !estado.dados || estado.dados.ano !== estado.ano || Date.now() - estado.dados.em > VALIDADE_MS;
    if (!recarregar && !velho) { desenhar(); return; }
    if (!carregarPlanos) { desenhar(); return; }
    // Ja carregando este mesmo ano: espera. Outro ano: a leitura antiga e
    // descartada ao chegar (pedido abaixo) e este ano comeca a carregar ja.
    if (estado.carregando === estado.ano) { desenhar(); return; }

    const ano = estado.ano;
    estado.carregando = ano;
    desenhar();
    try {
        const planos = await carregarPlanos(metasDoAno(ano));
        if (ano === estado.ano) estado.dados = { ano, planos, em: Date.now() };
    } catch (error) {
        if (ano === estado.ano) avisarErro(`Não foi possível ler os períodos letivos do servidor: ${error?.message || error}`);
    } finally {
        // So a leitura do ano atual encerra o "carregando" (uma antiga nao).
        if (estado.carregando === ano) estado.carregando = false;
        desenhar();
    }
}

function desenhar() {
    const alvo = document.getElementById('ind-tabela');
    const resumo = document.getElementById('ind-resumo');
    if (!alvo) return;

    document.getElementById('btn-ano-inteiro-indicadores')?.classList.toggle('is-active', estado.periodo === 'ano');
    document.querySelectorAll('#ind-pl-buttons button[data-plan-key]').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.planKey === estado.periodo);
    });

    if (estado.carregando && (!estado.dados || estado.dados.ano !== estado.ano)) {
        alvo.innerHTML = '<p class="ind-vazio">Carregando os períodos letivos…</p>';
        if (resumo) resumo.textContent = '';
        return;
    }
    if (!estado.dados || estado.dados.ano !== estado.ano) {
        alvo.innerHTML = '<p class="ind-vazio">Sem dados para este ano.</p>';
        if (resumo) resumo.textContent = '';
        return;
    }

    // O PL aberto na barra lateral usa a copia da tela (mudancas de agora mesmo).
    const ativo = store.getActivePlanMeta()?.key || '';
    const planos = estado.dados.planos
        .filter(({ meta }) => estado.periodo === 'ano' || meta.key === estado.periodo)
        .map(({ meta, allocations }) => ({
            periodo: meta.periodo,
            allocations: (meta.key === ativo ? store.allocations : allocations)
                .filter((a) => unidadeDe(getCursoSiglaDaTurma(a?.turmaId)) === estado.unidade)
        }));
    const ordemCursos = (store.rawData?.cursos || []).map((c) => c.sigla);
    const { linhas, cursos: cursosAchados, periodos } = cargaPorDocente(planos, {
        cursoDaTurma: getCursoSiglaDaTurma,
        chDaComponente: getDisciplinaCHGlobal,
        ordemCursos
    });
    // Cursos agrupados pela unidade (IECOS: EP, CB, CN; Campus Braganca: MT), na
    // ordem em que as unidades aparecem no cadastro de cursos.
    const ordemUnidades = [...new Set((store.rawData?.cursos || []).map((c) => unidadeDe(c.sigla)))];
    const posUnidade = (sigla) => { const i = ordemUnidades.indexOf(unidadeDe(sigla)); return i < 0 ? ordemUnidades.length : i; };
    const cursos = cursosAchados.slice().sort((a, b) => posUnidade(a) - posUnidade(b));
    const abreGrupo = (i) => i === 0 || unidadeDe(cursos[i - 1]) !== unidadeDe(cursos[i]);
    const gruposUnidade = [];
    cursos.forEach((c, i) => {
        if (abreGrupo(i)) gruposUnidade.push({ unidade: unidadeDe(c), n: 0 });
        gruposUnidade[gruposUnidade.length - 1].n += 1;
    });
    const anoInteiro = estado.periodo === 'ano';
    const colunasPL = anoInteiro ? metasDoAno(estado.ano).map((m) => m.periodo).filter((p) => periodos.includes(p)) : [];

    const pessoas = linhas.filter((l) => !l.vaga && !l.semDocente && !l.improvisado);
    const vagas = linhas.filter((l) => l.vaga);
    const improvisados = linhas.filter((l) => l.improvisado);
    const semDocente = linhas.find((l) => l.semDocente);
    const somaDe = (lista) => lista.reduce((s, l) => s + l.total, 0);
    const rotuloPeriodo = `${nomeUnidade(estado.unidade)} · ${anoInteiro
        ? `Ano inteiro de ${estado.ano}`
        : `${estado.ano} - ${metasDoAno(estado.ano).find((m) => m.key === estado.periodo)?.periodo || ''}`}`;
    if (resumo) {
        const partes = [`<b>${esc(rotuloPeriodo)}</b>`, `${pessoas.length} docente${pessoas.length === 1 ? '' : 's'} · ${fmtCH(somaDe(pessoas)) || 0} h`];
        if (vagas.length) partes.push(`${vagas.length} vaga${vagas.length === 1 ? '' : 's'} · ${fmtCH(somaDe(vagas))} h`);
        if (improvisados.length) partes.push(`<span class="ind-resumo-alerta">⚠ ${improvisados.length} nome${improvisados.length === 1 ? '' : 's'} improvisado${improvisados.length === 1 ? '' : 's'} · ${fmtCH(somaDe(improvisados))} h</span>`);
        if (semDocente) partes.push(`<span class="ind-resumo-alerta">sem docente · ${fmtCH(semDocente.total)} h</span>`);
        if (estado.carregando) partes.push('atualizando…');
        resumo.innerHTML = partes.join(' &nbsp;|&nbsp; ');
    }

    if (!linhas.length) {
        alvo.innerHTML = '<p class="ind-vazio">Nenhuma componente alocada neste período.</p>';
        return;
    }

    const nomeCurso = (sigla) => (store.rawData?.cursos || []).find((c) => c.sigla === sigla)?.curso || sigla;
    const seta = (coluna) => (estado.ordem.coluna === coluna ? (estado.ordem.crescente ? ' ▲' : ' ▼') : '');
    const th = (coluna, texto, titulo, classe = '', extra = '') => `<th scope="col" data-coluna="${esc(coluna)}" class="${classe}" title="${esc(titulo)} (clique para ordenar)"${extra}>${esc(texto)}${seta(coluna)}</th>`;
    const cel = (n, classe = '') => `<td class="ind-num ${classe}">${n ? fmtCH(n) : '<span class="ind-zero">—</span>'}</td>`;

    // Duas linhas: a unidade (e "Períodos letivos") em cima; cursos e PLs embaixo.
    const cabecalhoUnidades = [
        '<th scope="col" class="ind-pos" rowspan="2">#</th>',
        th('nome', 'Docente', 'Nome do docente', 'ind-nome', ' rowspan="2"'),
        ...gruposUnidade.map((g) => `<th scope="colgroup" colspan="${g.n}" class="ind-unidade ind-grupo" title="Cursos da unidade ${esc(nomeUnidade(g.unidade))}">${esc(nomeUnidade(g.unidade))}</th>`),
        ...(colunasPL.length ? [`<th scope="colgroup" colspan="${colunasPL.length}" class="ind-unidade ind-grupo ind-pl">Períodos letivos</th>`] : []),
        th('total', 'Total', `CH total no período (só ${nomeUnidade(estado.unidade)})`, 'ind-grupo ind-total', ' rowspan="2"')
    ].join('');
    const cabecalho = [
        ...cursos.map((c, i) => th(`curso:${c}`, c, `CH no curso ${nomeCurso(c)} (${nomeUnidade(unidadeDe(c))})`, abreGrupo(i) ? 'ind-grupo' : '')),
        ...colunasPL.map((p, i) => th(`pl:${p}`, p, `CH no ${p}`, i === 0 ? 'ind-grupo ind-pl' : 'ind-pl'))
    ].join('');

    const linhaHtml = (l, pos) => {
        const nome = l.semDocente
            ? `<span class="ind-sem-docente" title="Componentes alocadas sem docente ou com docente &quot;${SEM_DOCENTE}&quot;">${esc(SEM_DOCENTE)} (sem docente)</span>`
            : `<button type="button" class="ind-docente" data-docente="${esc(l.nome)}" title="Ver a agenda de ${esc(l.nome)} neste período">${esc(l.nome)}</button>${l.improvisado
                ? ' <span class="ind-improvisado" title="Nome improvisado: troque por uma vaga (ex.: Vaga1 FACED) pelo Editar da componente. O administrador também pode trocar ou remover em Usuários e backup › Docentes para conferir.">⚠ nome improvisado: troque por uma vaga</span>'
                : ''}`;
        return `<tr class="${l.vaga || l.improvisado ? 'ind-linha-vaga' : ''}${l.semDocente ? 'ind-linha-sem' : ''}">
            <td class="ind-pos">${pos}</td>
            <td class="ind-nome">${nome}</td>
            ${cursos.map((c, i) => cel(l.porCurso[c], abreGrupo(i) ? 'ind-grupo' : '')).join('')}
            ${colunasPL.map((p, i) => cel(l.porPL[p], i === 0 ? 'ind-grupo ind-pl' : 'ind-pl')).join('')}
            ${cel(l.total, 'ind-grupo ind-total')}
        </tr>`;
    };

    const ordenadas = ordenarLinhas(linhas, estado.ordem);
    let pos = 0;
    let separou = false;
    const corpo = ordenadas.map((l) => {
        let extra = '';
        if ((l.vaga || l.improvisado || l.semDocente) && !separou) {
            separou = true;
            extra = `<tr class="ind-separador"><td colspan="${3 + cursos.length + colunasPL.length}">Vagas, nomes improvisados e componentes sem docente</td></tr>`;
        }
        return extra + linhaHtml(l, (l.vaga || l.improvisado || l.semDocente) ? '' : ++pos);
    }).join('');

    const somaCurso = (c) => linhas.reduce((s, l) => s + (l.porCurso[c] || 0), 0);
    const somaPL = (p) => linhas.reduce((s, l) => s + (l.porPL[p] || 0), 0);
    const rodape = `<tr>
        <td class="ind-pos"></td>
        <th scope="row" class="ind-nome">Total</th>
        ${cursos.map((c, i) => cel(somaCurso(c), abreGrupo(i) ? 'ind-grupo' : '')).join('')}
        ${colunasPL.map((p, i) => cel(somaPL(p), i === 0 ? 'ind-grupo ind-pl' : 'ind-pl')).join('')}
        ${cel(somaDe(linhas), 'ind-grupo ind-total')}
    </tr>`;

    alvo.innerHTML = `<div class="ind-tabela-rolagem"><table class="ind-tabela">
        <thead><tr>${cabecalhoUnidades}</tr><tr>${cabecalho}</tr></thead>
        <tbody>${corpo}</tbody>
        <tfoot>${rodape}</tfoot>
    </table></div>`;
}
