import { UNIDADE_PADRAO, unidadeDoCurso } from './unidades.mjs?v=202611261735';
import { escapeHtml as esc } from './texto.mjs?v=202611261735';
// Menu Indicadores (so leitura: nada e gravado).
// Sub-aba "Carga por docente": tabela com a CH de cada docente por curso e por PL,
// do ano inteiro ou de um PL. As contas estao em indicadores.mjs.
// Sub-aba "Dias do docente": quadro de um docente, uma linha por componente e um
// quadradinho por dia do PL, com os dias de 2+ componentes (dias_docente.mjs).
// Sub-aba "Componente" (26/11/2026): em qual PL e turma uma componente e dada,
// com qual docente, de quando a quando e em que dias/horario.
import { store } from './store.js?v=202611261735';
import { getCursoSiglaDaTurma, getDisciplinaCHGlobal } from './curso_turma_helpers.js?v=202611261735';
import { formatDateBR } from './date_utils_ui.js?v=202611261735';
import { UNIDADES } from './docente_nomes.mjs?v=202611261735';
import { cargaPorDocente, ordenarLinhas, SEM_DOCENTE, ofertasDoPlano, chaveComponente, chaveSubturma, nomesDasComponentes, resumoDasAulas } from './indicadores.mjs?v=202611261735';
import { getCalendarEvents } from './calendar.js?v=202611261735';
import { withPlanContext } from './calendarios_ui.js?v=202611261735';
import { getTurmaLabel } from './curso_turma_helpers.js?v=202611261735';
import { feriadosDaTurma } from './feriados.mjs?v=202611261735';
import { fmtCH, focarDiaDoQuadro, DICA_MOUSE, entradaDias, montarQuadrosDias, quadroTurmaHtml, textoSobrecarga } from './quadro_dias.mjs?v=202611261735';
import { numeroDaSubturma } from './subturmas.mjs?v=202611261735';

const VALIDADE_MS = 2 * 60 * 1000; // depois disso, abrir o menu busca de novo

let carregarPlanos = null;   // (metas) => Promise<[{ meta, allocations }]>, vem do ui.js
let abrirAgendaDocente = null; // (nome, periodo) => void, vem do ui.js
let avisarErro = (msg) => console.warn(msg);
let ajustarNome = () => {}; // (campo) => troca "zelia" por "Zélia" (nome da lista), vem do ui.js
let irParaOferta = null;      // ({ planKey, turmaId, componente, subturma }) => abre a Lista de ofertas, vem do ui.js
let plNaBarra = () => false;  // (planKey) => o PL ainda aparece na barra lateral?

const estado = {
    unidade: UNIDADE_PADRAO, // so os cursos desta unidade (IECOS, CBRAG...)
    ano: '',
    periodo: 'ano',          // 'ano' ou a chave do PL
    ordem: { coluna: 'total', crescente: false },
    dados: null,             // { ano, planos: [{ meta, allocations }], em }
    carregando: false,
    subaba: 'carga',         // 'carga' (tabela de CH), 'dias' (dias do docente) ou 'componente'
    docente: '',             // docente escolhido em "Dias do docente"
    componente: '',          // componente escolhida em "Componente" (texto digitado)
    compAberta: ''           // linha com o quadro da turma aberto (chave de chaveDaLinha)
};

// Quadros desenhados em "Dias do docente" (para o texto do dia ao passar o mouse).
let quadrosDias = [];

export function setIndicadoresLigacoes({ carregar, abrirDocente, erro, ajustarNomeDocente, irParaOferta: ir, plNaBarra: naBarra } = {}) {
    if (typeof ir === 'function') irParaOferta = ir;
    if (typeof naBarra === 'function') plNaBarra = naBarra;
    if (typeof carregar === 'function') carregarPlanos = carregar;
    if (typeof ajustarNomeDocente === 'function') ajustarNome = ajustarNomeDocente;
    if (typeof abrirDocente === 'function') abrirAgendaDocente = abrirDocente;
    if (typeof erro === 'function') avisarErro = erro;
}

// Unidade do curso (cursos[].unidade no dados_app.json; sem ela, UNIDADE_PADRAO).
function unidadeDe(sigla) {
    return unidadeDoCurso((store.rawData?.cursos || []).find((c) => c.sigla === sigla));
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
        if (!unidades.includes(UNIDADE_PADRAO)) unidades.unshift(UNIDADE_PADRAO);
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

    // Sub-abas: Carga por docente | Dias do docente (mesmos filtros e dados).
    document.querySelectorAll('#tab-indicadores .ind-subaba[data-subaba]').forEach((btn) => {
        btn.addEventListener('click', () => {
            estado.subaba = btn.dataset.subaba;
            desenhar();
        });
    });
    // Docente: digita e escolhe na lista de sugestoes (todos os docentes do Cardume).
    const inpDocente = document.getElementById('inp-docente-dias');
    inpDocente?.addEventListener('change', () => {
        ajustarNome(inpDocente);
        estado.docente = inpDocente.value.trim();
        desenhar();
    });
    inpDocente?.addEventListener('input', () => {
        if (inpDocente.value.trim() || !estado.docente) return;
        estado.docente = ''; // apagou o nome: volta para "Escolha o docente"
        desenhar();
    });
    // Componente: digita e escolhe na lista (so as que tem horario no periodo).
    const inpComponente = document.getElementById('inp-componente-ind');
    inpComponente?.addEventListener('change', () => {
        estado.componente = inpComponente.value.trim();
        desenhar();
    });
    inpComponente?.addEventListener('input', () => {
        const texto = inpComponente.value.trim();
        if (!texto) {
            if (!estado.componente) return;
            estado.componente = ''; // apagou: volta para "Escolha a componente"
            desenhar();
            return;
        }
        // Escolheu um nome da lista: mostra ja, sem esperar sair do campo.
        const daLista = [...(document.getElementById('list-componentes-ind')?.options || [])]
            .some((opt) => opt.value === texto);
        if (daLista && texto !== estado.componente) {
            estado.componente = texto;
            desenhar();
        }
    });
    // Passar o mouse (ou tocar) num dia do quadro: acende a coluna e diz o que ha no dia.
    const focarDia = (ev) => {
        const cel = ev.target.closest('[data-dd-date]');
        if (cel) focarDiaDoQuadro(cel, quadrosDias);
    };
    document.getElementById('ind-tabela')?.addEventListener('mouseover', focarDia);
    document.getElementById('ind-tabela')?.addEventListener('click', focarDia);

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
        const ir = ev.target.closest('button[data-ir-oferta]');
        if (ir && irParaOferta) {
            const linha = linhasComponente[Number(ir.dataset.irOferta)];
            if (linha) irParaOferta({ planKey: linha.meta.key, turmaId: linha.oferta.turmaId, componente: chaveComponente(linha.oferta.disciplina), subturma: linha.oferta.subturma });
            return;
        }
        const link = ev.target.closest('button[data-docente]');
        if (link && abrirAgendaDocente) {
            const meta = metasDoAno(estado.ano).find((m) => m.key === estado.periodo);
            abrirAgendaDocente(link.dataset.docente, meta ? { tipo: 'pl', meta, ano: estado.ano } : { tipo: 'ano', ano: estado.ano });
            return;
        }
        // Componente: clicar na linha abre (ou fecha) o quadro da turma.
        const tr = ev.target.closest('tr[data-comp-linha]');
        if (tr && !ev.target.closest('button, a')) {
            const linha = linhasComponente[Number(tr.dataset.compLinha)];
            if (!linha) return;
            const chave = chaveDaLinha(linha);
            estado.compAberta = estado.compAberta === chave ? '' : chave;
            desenhar();
            if (estado.compAberta) document.querySelector('#ind-tabela .ind-comp-quadro')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
    const emDias = estado.subaba === 'dias';
    const emComponente = estado.subaba === 'componente';
    document.querySelectorAll('#tab-indicadores .ind-subaba[data-subaba]').forEach((btn) => {
        const ativa = btn.dataset.subaba === estado.subaba;
        btn.classList.toggle('is-ativa', ativa);
        btn.setAttribute('aria-selected', String(ativa));
    });
    document.getElementById('ind-docente-box')?.classList.toggle('hidden', !emDias);
    document.getElementById('ind-componente-box')?.classList.toggle('hidden', !emComponente);
    document.getElementById('ind-docente-quebra')?.classList.toggle('hidden', !emDias && !emComponente);
    document.getElementById('ind-nota-carga')?.classList.toggle('hidden', emDias || emComponente);
    document.getElementById('ind-nota-dias')?.classList.toggle('hidden', !emDias);

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

    if (emDias) { desenharDias(alvo, resumo); return; }
    if (emComponente) { desenharComponente(alvo, resumo); return; }

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

// ===== Dias do docente =====

// Aulas do docente em todos os PLs do ano: um PL pode passar das datas do outro
// (PL2 ate julho, PL3 desde junho), entao a sobrecarga do dia olha todos juntos.
function aulasDoDocente(nome, planos) {
    const entries = [];
    const rotulos = new Map();
    planos.forEach(({ meta, allocations }) => {
        withPlanContext(meta, allocations, () => {
            const porData = getCalendarEvents(null, meta.termStart, meta.termEnd, nome) || {};
            Object.entries(porData).forEach(([date, eventos]) => {
                (eventos || []).forEach((ev) => {
                    if (!ev || ev.type === 'holiday') return;
                    const disciplina = String(ev.disciplina || ev.title || '').trim();
                    const chComponente = Number(getDisciplinaCHGlobal(disciplina, ev.turmaId)) || Number(ev.ch) || 0;
                    const entry = entradaDias(ev, date, meta.key, { chComponente });
                    // O rotulo da turma depende do PL (bloco): calcula dentro dele.
                    if (!rotulos.has(entry.key)) rotulos.set(entry.key, getTurmaLabel(ev.turmaId, ev.subGrupo));
                    entries.push(entry);
                });
            });
        });
    });
    return { entries, rotulos };
}

function desenharDias(alvo, resumo) {
    const ativo = store.getActivePlanMeta()?.key || '';
    const planos = estado.dados.planos.map(({ meta, allocations }) => ({
        meta,
        allocations: meta.key === ativo ? store.allocations : (allocations || [])
    }));
    quadrosDias = [];

    const metaPL = metasDoAno(estado.ano).find((m) => m.key === estado.periodo);
    const rotuloPeriodo = estado.periodo === 'ano' ? `Ano inteiro de ${estado.ano}` : `${estado.ano} - ${metaPL?.periodo || ''}`;
    if (!estado.docente) {
        if (resumo) resumo.innerHTML = `<b>${esc(rotuloPeriodo)}</b>`;
        alvo.innerHTML = '<p class="ind-vazio">Digite o nome do docente no alto e escolha na lista.</p>';
        return;
    }

    const { entries, rotulos } = aulasDoDocente(estado.docente, planos);
    const feriadosLista = feriadosDaTurma(store.rawData?.feriados || [], '');
    const feriados = feriadosLista.map((f) => String(f?.data || f || '').trim());
    const nomeFeriado = new Map(feriadosLista.map((f) => [String(f?.data || f || '').trim(), String(f?.feriado || f?.nome || 'Feriado')]));

    const metas = planos.map(({ meta }) => meta);
    const mostrar = metas.filter((meta) => estado.periodo === 'ano' || meta.key === estado.periodo);
    const { html: blocos, quadros, carregados: carregadosTotal, chDoPL } = montarQuadrosDias({
        planos: metas, mostrar, entries, rotulos, feriados, nomeFeriado, fmtData: formatDateBR
    });
    quadrosDias = quadros;

    if (resumo) {
        const carga = carregadosTotal
            ? `<span class="ind-resumo-alerta dd-alerta">${textoSobrecarga(carregadosTotal)}</span>`
            : textoSobrecarga(0);
        // Carga horaria: no ano, o total e a de cada PL; num PL, so a dele.
        const ch = estado.periodo === 'ano'
            ? `<b class="dd-ch-total">${fmtCH(metas.reduce((n, meta) => n + chDoPL(meta.key), 0)) || 0}h no ano</b> <span class="dd-ch-pls">(${metas.map((meta) => `${esc(meta.periodo)} ${fmtCH(chDoPL(meta.key)) || 0}h`).join(' · ')})</span>`
            : `<b class="dd-ch-total">${fmtCH(chDoPL(estado.periodo)) || 0}h no PL</b>`;
        resumo.innerHTML = `<b>${esc(estado.docente)}</b> &nbsp;|&nbsp; ${esc(rotuloPeriodo)} &nbsp;|&nbsp; ${ch} &nbsp;|&nbsp; ${carga}${estado.carregando ? ' &nbsp;|&nbsp; atualizando…' : ''}${blocos.includes('data-dd-quadro') ? ` &nbsp;|&nbsp; <span class="ind-dica-mouse">${DICA_MOUSE}</span>` : ''}`;
    }
    alvo.innerHTML = blocos || '<p class="ind-vazio">Nenhum período letivo neste ano.</p>';
}


// ===== Componente =====

// As aulas podem passar do fim do PL (aviso na Lista de ofertas): a busca olha
// ate 4 meses depois, para o "Fim" sair certo.
const FOLGA_FIM_DIAS = 120;

// Linhas desenhadas (o botao "Ir para a oferta" e a linha guardam o indice).
let linhasComponente = [];

// Identifica a linha da tabela (para lembrar qual quadro esta aberto).
const chaveDaLinha = (l) => [chaveComponente(l.oferta.disciplina), l.meta.key, l.oferta.turmaId, l.oferta.subturma].join('|');

// Quadro da turma da linha no PL dela: todas as componentes da turma, a buscada
// em destaque, e ao lado de cada uma o(s) docente(s). Devolve { html, quadro }.
function quadroDaTurma(linha, planos) {
    const plano = planos.find((p) => p.meta.key === linha.meta.key);
    if (!plano) return { html: '', quadro: null };
    const { meta } = linha;
    const turmaId = linha.oferta.turmaId;
    const buscada = chaveComponente(linha.oferta.disciplina);
    const docentesDe = new Map(plano.ofertas.filter((o) => o.turmaId === turmaId).map((o) => [
        `${chaveComponente(o.disciplina)}|${o.subturma}`,
        o.docentes.map((d) => d.nome).join(' / ') || SEM_DOCENTE
    ]));
    const entries = [];
    const rotulos = new Map();
    let destaque = '';
    withPlanContext(meta, plano.allocations, () => {
        const porData = getCalendarEvents(turmaId, meta.termStart, somarDias(meta.termEnd, FOLGA_FIM_DIAS)) || {};
        Object.entries(porData).forEach(([date, eventos]) => (eventos || []).forEach((ev) => {
            if (!ev || ev.type === 'holiday') return;
            const disciplina = String(ev.disciplina || ev.title || '').trim();
            const chComponente = Number(getDisciplinaCHGlobal(disciplina, turmaId)) || Number(ev.ch) || 0;
            const entry = entradaDias(ev, date, meta.key, { chComponente });
            entries.push(entry);
            if (rotulos.has(entry.key)) return;
            const sub = chaveSubturma(ev.subGrupo);
            const num = numeroDaSubturma(ev.subGrupo);
            const quem = docentesDe.get(`${chaveComponente(disciplina)}|${sub}`) || '';
            rotulos.set(entry.key, [num ? `T${String(num).padStart(2, '0')}` : '', quem].filter(Boolean).join(' · '));
            if (!destaque && chaveComponente(disciplina) === buscada && sub === linha.oferta.subturma) destaque = entry.key;
        }));
    });
    const feriadosLista = feriadosDaTurma(store.rawData?.feriados || [], turmaId);
    return quadroTurmaHtml({
        titulo: `${linha.turma} · ${estado.ano} - ${meta.periodo}`,
        datas: `${formatDateBR(meta.termStart)} a ${formatDateBR(meta.termEnd)}`,
        termStart: meta.termStart,
        termEnd: meta.termEnd,
        entries,
        rotulos,
        feriados: feriadosLista.map((f) => String(f?.data || f || '').trim()),
        nomeFeriado: new Map(feriadosLista.map((f) => [String(f?.data || f || '').trim(), String(f?.feriado || f?.nome || 'Feriado')])),
        destaque,
        dica: DICA_MOUSE
    });
}

function somarDias(iso, n) {
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Planos do periodo escolhido (ano ou um PL), so a unidade escolhida, com as ofertas.
function planosDaUnidade() {
    const ativo = store.getActivePlanMeta()?.key || '';
    return estado.dados.planos
        .filter(({ meta }) => estado.periodo === 'ano' || meta.key === estado.periodo)
        .map(({ meta, allocations }) => {
            const allocs = (meta.key === ativo ? store.allocations : (allocations || []))
                .filter((a) => unidadeDe(getCursoSiglaDaTurma(a?.turmaId)) === estado.unidade);
            const ofertas = ofertasDoPlano(allocs, { cursoDaTurma: getCursoSiglaDaTurma, chDaComponente: getDisciplinaCHGlobal });
            return { meta, allocations: allocs, ofertas };
        });
}

// Uma linha por oferta da componente: PL, turma, docentes, CH e as datas das aulas.
function linhasDaComponente(chave, planos) {
    const linhas = [];
    planos.forEach(({ meta, allocations, ofertas }) => {
        const daComponente = ofertas.filter((o) => chaveComponente(o.disciplina) === chave);
        if (!daComponente.length) return;
        withPlanContext(meta, allocations, () => {
            // Aulas de cada turma (o calendario ja tira feriados e pausas).
            const aulasPorTurma = new Map();
            [...new Set(daComponente.map((o) => o.turmaId))].forEach((turmaId) => {
                const porData = getCalendarEvents(turmaId, meta.termStart, somarDias(meta.termEnd, FOLGA_FIM_DIAS)) || {};
                const aulas = [];
                Object.entries(porData).forEach(([date, eventos]) => (eventos || []).forEach((ev) => {
                    if (!ev || ev.type === 'holiday') return;
                    if (chaveComponente(ev.disciplina || ev.title) !== chave) return;
                    aulas.push({ date, horario: ev.horario, subturma: chaveSubturma(ev.subGrupo), subGrupo: ev.subGrupo || '' });
                }));
                aulasPorTurma.set(turmaId, aulas);
            });
            daComponente.forEach((oferta) => {
                const aulas = (aulasPorTurma.get(oferta.turmaId) || []).filter((a) => a.subturma === oferta.subturma);
                const subGrupo = aulas[0]?.subGrupo || oferta.subturma;
                linhas.push({
                    meta,
                    oferta,
                    turma: getTurmaLabel(oferta.turmaId, subGrupo) || oferta.turmaId,
                    ...resumoDasAulas(aulas)
                });
            });
        });
    });
    // Ordem: PL, depois o curso (ordem do cadastro), depois a turma.
    const ordemPL = metasDoAno(estado.ano).map((m) => m.key);
    const ordemCursos = (store.rawData?.cursos || []).map((c) => c.sigla);
    const pos = (lista, v) => { const i = lista.indexOf(v); return i < 0 ? lista.length : i; };
    return linhas.sort((a, b) => pos(ordemPL, a.meta.key) - pos(ordemPL, b.meta.key)
        || pos(ordemCursos, a.oferta.curso) - pos(ordemCursos, b.oferta.curso)
        || a.turma.localeCompare(b.turma, 'pt-BR', { numeric: true }));
}

function desenharComponente(alvo, resumo) {
    const planos = planosDaUnidade();
    const metaPL = metasDoAno(estado.ano).find((m) => m.key === estado.periodo);
    const rotuloPeriodo = `${nomeUnidade(estado.unidade)} · ${estado.periodo === 'ano' ? `Ano inteiro de ${estado.ano}` : `${estado.ano} - ${metaPL?.periodo || ''}`}`;

    // Sugestoes: so as componentes com horario neste periodo e unidade.
    const nomes = nomesDasComponentes(planos.flatMap((p) => p.ofertas));
    const lista = document.getElementById('list-componentes-ind');
    if (lista) lista.innerHTML = nomes.map((n) => `<option value="${esc(n)}"></option>`).join('');

    if (!estado.componente) {
        if (resumo) resumo.innerHTML = `<b>${esc(rotuloPeriodo)}</b> &nbsp;|&nbsp; ${nomes.length} componente${nomes.length === 1 ? '' : 's'} com horário`;
        alvo.innerHTML = '<p class="ind-vazio">Digite o nome da componente no alto e escolha na lista.</p>';
        return;
    }

    const chave = chaveComponente(estado.componente);
    const nome = nomes.find((n) => chaveComponente(n) === chave) || estado.componente;
    const linhas = linhasDaComponente(chave, planos);
    linhasComponente = linhas;
    quadrosDias = [];
    if (!linhas.length) {
        if (resumo) resumo.innerHTML = `<b>${esc(estado.componente)}</b> &nbsp;|&nbsp; ${esc(rotuloPeriodo)}`;
        alvo.innerHTML = `<p class="ind-vazio">Nenhuma oferta de “${esc(estado.componente)}” com horário neste período. Escolha um nome da lista.</p>`;
        return;
    }

    const turmas = new Set(linhas.map((l) => l.oferta.turmaId));
    const docentes = new Set(linhas.flatMap((l) => l.oferta.docentes.map((d) => d.nome)));
    if (resumo) {
        resumo.innerHTML = [
            `<b>${esc(nome)}</b>`,
            esc(rotuloPeriodo),
            `${linhas.length} oferta${linhas.length === 1 ? '' : 's'} · ${turmas.size} turma${turmas.size === 1 ? '' : 's'} · ${docentes.size} docente${docentes.size === 1 ? '' : 's'}`,
            ...(estado.carregando ? ['atualizando…'] : []),
            '<span class="ind-dica-mouse">Clique numa linha para ver o quadro da turma.</span>'
        ].join(' &nbsp;|&nbsp; ');
    }

    const nomeCurso = (sigla) => (store.rawData?.cursos || []).find((c) => c.sigla === sigla)?.curso || sigla;
    const docentesHtml = (oferta) => {
        if (!oferta.docentes.length) {
            return `<span class="ind-sem-docente" title="Componente sem docente">${esc(SEM_DOCENTE)} (sem docente)</span>`;
        }
        const dividida = oferta.docentes.length > 1;
        return oferta.docentes.map((d) => `<button type="button" class="ind-docente" data-docente="${esc(d.nome)}" title="Ver a agenda de ${esc(d.nome)} neste período">${esc(d.nome)}</button>${dividida ? ` <span class="ind-comp-parte">(${fmtCH(d.ch) || 0}h)</span>` : ''}`).join('<br>');
    };
    // PL encerrado nao aparece na barra lateral: sem atalho (decidido em 24/11/2026).
    const irHtml = (l, i) => (plNaBarra(l.meta.key)
        ? `<button type="button" class="ind-ir-oferta" data-ir-oferta="${i}" title="Abrir ${esc(l.turma)} no ${esc(l.meta.periodo)} e mostrar a componente na Lista de ofertas">✎ Ir para a oferta</button>`
        : '<span class="ind-pl-encerrado" title="Este PL já terminou e não aparece mais na barra lateral">PL encerrado</span>');
    const corpo = linhas.map((l, i) => {
        const horario = [l.dias, `${l.turnos} ${l.horario}`.trim()].filter(Boolean).join(' · ');
        const aberta = chaveDaLinha(l) === estado.compAberta;
        return `<tr class="ind-comp-linha${aberta ? ' is-aberta' : ''}" data-comp-linha="${i}" title="${esc(`Clique para ${aberta ? 'fechar' : 'ver'} o quadro da turma ${l.turma} no ${l.meta.periodo}`)}">
            <td class="ind-comp-pl" title="${esc(`${estado.ano} - ${l.meta.periodo}: ${formatDateBR(l.meta.termStart)} a ${formatDateBR(l.meta.termEnd)}`)}">${esc(l.meta.periodo)}</td>
            <td title="${esc(nomeCurso(l.oferta.curso))}">${esc(l.oferta.curso)}</td>
            <td class="ind-comp-turma">${esc(l.turma)}</td>
            <td class="ind-nome">${docentesHtml(l.oferta)}</td>
            <td class="ind-num">${fmtCH(l.oferta.ch) || '—'}</td>
            <td>${l.inicio ? formatDateBR(l.inicio) : '—'}</td>
            <td>${l.fim ? formatDateBR(l.fim) : '—'}</td>
            <td>${esc(horario) || '—'}</td>
            <td class="ind-comp-ir">${irHtml(l, i)}</td>
        </tr>`;
    }).join('');

    alvo.innerHTML = `<div class="ind-tabela-rolagem"><table class="ind-tabela ind-tabela-comp">
        <thead><tr>
            <th scope="col">PL</th>
            <th scope="col">Curso</th>
            <th scope="col">Turma</th>
            <th scope="col" class="ind-nome">Docente</th>
            <th scope="col" class="ind-num" title="CH da componente">CH</th>
            <th scope="col">Início</th>
            <th scope="col">Fim</th>
            <th scope="col">Dias e horário</th>
            <th scope="col"><span class="sr-only">Atalho</span></th>
        </tr></thead>
        <tbody>${corpo}</tbody>
    </table></div>${quadroAberto()}`;

    // Quadro da turma da linha aberta, embaixo da tabela, na largura toda.
    function quadroAberto() {
        const linha = linhas.find((l) => chaveDaLinha(l) === estado.compAberta);
        if (!linha) return '';
        const { html, quadro } = quadroDaTurma(linha, planos);
        if (quadro) quadrosDias = [quadro];
        return `<div class="ind-comp-quadro">${html}</div>`;
    }
}
