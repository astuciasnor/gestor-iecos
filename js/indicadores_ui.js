// Menu Indicadores (so leitura: nada e gravado).
// Sub-aba "Carga por docente": tabela com a CH de cada docente por curso e por PL,
// do ano inteiro ou de um PL. As contas estao em indicadores.mjs.
// Sub-aba "Dias do docente": quadro de um docente, uma linha por componente e um
// quadradinho por dia do PL, com os dias de 2+ componentes (dias_docente.mjs).
// Sub-aba "Componente" (26/11/2026): em qual PL e turma uma componente e dada,
// com qual docente, de quando a quando e em que dias/horario.
// Sub-aba "Turma" (26/11/2026): escolhe a turma e ve, por PL, o quadro dos dias
// (o mesmo do Componente) com docentes, horario e datas embaixo de cada nome.
// Navegacao (Etapa 1 da integracao, 26/11/2026): turma, componente e docente
// levam a sub-aba deles, com "Voltar". O Indicadores so le; mudar e na Lista de ofertas.
import { UNIDADE_PADRAO, unidadeDoCurso } from './unidades.mjs?v=202611262205';
import { escapeHtml as esc } from './texto.mjs?v=202611262205';
import { store } from './store.js?v=202611262205';
import { getCursoSiglaDaTurma, getDisciplinaCHGlobal, getTurmaLabel, getTurmaBaseLabel } from './curso_turma_helpers.js?v=202611262205';
import { formatDateBR } from './date_utils_ui.js?v=202611262205';
import { UNIDADES } from './docente_nomes.mjs?v=202611262205';
import { cargaPorDocente, ordenarLinhas, SEM_DOCENTE, ofertasDoPlano, chaveComponente, chaveSubturma, nomesDasComponentes, resumoDasAulas, semSufixoCH } from './indicadores.mjs?v=202611262205';
import { getCalendarEvents } from './calendar.js?v=202611262205';
import { withPlanContext } from './calendarios_ui.js?v=202611262205';
import { feriadosDaTurma } from './feriados.mjs?v=202611262205';
import { fmtCH, focarDiaDoQuadro, DICA_MOUSE, entradaDias, montarQuadrosDias, quadroTurmaHtml, textoSobrecarga, corDoQuadro } from './quadro_dias.mjs?v=202611262205';
import { numeroDaSubturma } from './subturmas.mjs?v=202611262205';

const VALIDADE_MS = 2 * 60 * 1000; // depois disso, abrir o menu busca de novo

let carregarPlanos = null;   // (metas) => Promise<[{ meta, allocations }]>, vem do ui.js
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
    subaba: 'carga',         // 'carga' (tabela de CH), 'dias' (dias do docente), 'componente' ou 'turma'
    docente: '',             // docente escolhido em "Dias do docente"
    componente: '',          // componente escolhida em "Componente" (texto digitado)
    compAberta: '',          // linha com o quadro da turma aberto (chave de chaveDaLinha)
    turmaCurso: '',          // sub-aba Turma: faculdade (sigla do curso); '' = todas
    turma: '',               // sub-aba Turma: turmaId escolhida
    turmaDestaque: ''        // sub-aba Turma: 'planKey|key' da componente destacada no quadro
};

// Quadros desenhados em "Dias do docente" (para o texto do dia ao passar o mouse).
let quadrosDias = [];

export function setIndicadoresLigacoes({ carregar, erro, ajustarNomeDocente, irParaOferta: ir, plNaBarra: naBarra } = {}) {
    if (typeof ir === 'function') irParaOferta = ir;
    if (typeof naBarra === 'function') plNaBarra = naBarra;
    if (typeof carregar === 'function') carregarPlanos = carregar;
    if (typeof ajustarNomeDocente === 'function') ajustarNome = ajustarNomeDocente;
    if (typeof erro === 'function') avisarErro = erro;
}

// Unidade do curso (cursos[].unidade no dados_app.json; sem ela, UNIDADE_PADRAO).
function unidadeDe(sigla) {
    return unidadeDoCurso((store.rawData?.cursos || []).find((c) => c.sigla === sigla));
}

function nomeUnidade(sigla) {
    return UNIDADES.find((u) => u.sigla === sigla)?.nome || sigla;
}

function nomeDoCurso(sigla) {
    return (store.rawData?.cursos || []).find((c) => c.sigla === sigla)?.curso || sigla;
}

// Posicao do curso na ordem do cadastro (para ordenar tabelas e turmas).
function posicaoDoCurso(sigla) {
    const ordem = (store.rawData?.cursos || []).map((c) => c.sigla);
    const i = ordem.indexOf(sigla);
    return i < 0 ? ordem.length : i;
}

// O PL aberto na barra lateral usa a copia da tela (mudancas de agora mesmo).
function alocacoesDoPlano(meta, allocations) {
    return meta.key === (store.getActivePlanMeta()?.key || '') ? store.allocations : (allocations || []);
}

// "IECOS · Ano inteiro de 2027" ou "IECOS · 2027 - PL2" (sem a unidade: comUnidade false).
function rotuloDoPeriodo({ comUnidade = true } = {}) {
    const pl = metasDoAno(estado.ano).find((m) => m.key === estado.periodo)?.periodo || '';
    const periodo = estado.periodo === 'ano' ? `Ano inteiro de ${estado.ano}` : `${estado.ano} - ${pl}`;
    return comUnidade ? `${nomeUnidade(estado.unidade)} · ${periodo}` : periodo;
}

// Feriados para o quadro dos dias: as datas e o nome de cada uma (turmaId '' = gerais).
function feriadosDoQuadro(turmaId = '') {
    const lista = feriadosDaTurma(store.rawData?.feriados || [], turmaId);
    const data = (f) => String(f?.data || f || '').trim();
    return {
        feriados: lista.map(data),
        nomeFeriado: new Map(lista.map((f) => [data(f), String(f?.feriado || f?.nome || 'Feriado')]))
    };
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
        historico.length = 0;
        estado.ano = selAno.value;
        estado.periodo = 'ano';
        montarBotoesPL();
        renderIndicadores({ recarregar: true });
    });
    btnAtualizar?.addEventListener('click', () => renderIndicadores({ recarregar: true }));
    ligarVoltar();

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
    // Caixas de busca (Docente, Componente): o x limpa para buscar outro.
    document.querySelectorAll('#tab-indicadores .ind-busca-limpar[data-limpar]').forEach((btn) => {
        const campo = document.getElementById(btn.dataset.limpar);
        if (!campo) return;
        campo.addEventListener('input', atualizarLimpar);
        btn.addEventListener('click', () => {
            campo.value = '';
            campo.dispatchEvent(new Event('input', { bubbles: true }));
            campo.focus();
        });
    });
    // Turma: a faculdade filtra as turmas; clicar numa turma mostra os quadros dela.
    document.getElementById('sel-curso-ind')?.addEventListener('change', (ev) => {
        estado.turmaCurso = ev.target.value;
        desenhar();
    });
    document.getElementById('ind-turmas')?.addEventListener('click', (ev) => {
        const btn = ev.target.closest('button[data-turma]');
        if (!btn) return;
        estado.turma = btn.dataset.turma;
        estado.turmaDestaque = '';
        desenhar();
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
            const lista = ir.dataset.irLista === 'turma' ? linhasTurma : linhasComponente;
            const linha = lista[Number(ir.dataset.irOferta)];
            if (linha) irParaOferta({ planKey: linha.meta.key, turmaId: linha.oferta.turmaId, componente: chaveComponente(linha.oferta.disciplina), subturma: linha.oferta.subturma });
            return;
        }
        // Atalhos entre as sub-abas (Etapa 1): turma, docente e componente.
        const verTurma = ev.target.closest('button[data-ver-turma]');
        if (verTurma) {
            const linha = linhasComponente[Number(verTurma.dataset.verTurma)];
            if (linha) {
                const plano = estado.dados && planosDaUnidade().find((p) => p.meta.key === linha.meta.key);
                const key = plano ? aulasDaTurma(plano, linha.oferta.turmaId).porOferta.get(`${chaveComponente(linha.oferta.disciplina)}|${linha.oferta.subturma}`)?.key : '';
                irParaTurma({ turmaId: linha.oferta.turmaId, planKey: linha.meta.key, key });
            }
            return;
        }
        const verDocente = ev.target.closest('button[data-ver-docente]');
        if (verDocente) { irParaDocente(verDocente.dataset.verDocente); return; }
        const verComp = ev.target.closest('button[data-ver-componente]');
        if (verComp) { irParaComponente(verComp.dataset.verComponente); return; }
        // Dias do docente: clicar na componente abre a turma dela, com a componente em destaque.
        const rotDias = estado.subaba === 'dias' && ev.target.closest('.dd-rot[data-dd-comp]');
        if (rotDias) {
            const key = rotDias.dataset.ddComp;
            const quadro = quadrosDias[Number(rotDias.closest('[data-dd-quadro]')?.dataset.ddQuadro)];
            irParaTurma({ turmaId: key.split('|')[0], planKey: diasPlanoDaKey.get(key) || quadro?.plano || '', key });
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
            return;
        }
        // Turma: clicar no nome da componente destaca a linha dela (de novo: tira).
        const rot = ev.target.closest('.dd-quadro--turma [data-dd-comp]');
        const bloco = rot?.closest('[data-plan-key]');
        if (rot && bloco && !ev.target.closest('button, a')) {
            const chave = `${bloco.dataset.planKey}|${rot.dataset.ddComp}`;
            estado.turmaDestaque = estado.turmaDestaque === chave ? '' : chave;
            desenhar();
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
    atualizarVoltar();
    atualizarLimpar();
    const alvo = document.getElementById('ind-tabela');
    if (alvo) alvo.dataset.subaba = estado.subaba;
    const resumo = document.getElementById('ind-resumo');
    if (!alvo) return;

    document.getElementById('btn-ano-inteiro-indicadores')?.classList.toggle('is-active', estado.periodo === 'ano');
    document.querySelectorAll('#ind-pl-buttons button[data-plan-key]').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.planKey === estado.periodo);
    });
    const emDias = estado.subaba === 'dias';
    const emComponente = estado.subaba === 'componente';
    const emTurma = estado.subaba === 'turma';
    document.querySelectorAll('#tab-indicadores .ind-subaba[data-subaba]').forEach((btn) => {
        const ativa = btn.dataset.subaba === estado.subaba;
        btn.classList.toggle('is-ativa', ativa);
        btn.setAttribute('aria-selected', String(ativa));
    });
    document.getElementById('ind-docente-box')?.classList.toggle('hidden', !emDias);
    document.getElementById('ind-componente-box')?.classList.toggle('hidden', !emComponente);
    document.getElementById('ind-faculdade-box')?.classList.toggle('hidden', !emTurma);
    document.getElementById('ind-turmas-box')?.classList.toggle('hidden', !emTurma);
    document.getElementById('ind-docente-quebra')?.classList.toggle('hidden', !emDias && !emComponente && !emTurma);
    document.getElementById('ind-nota-carga')?.classList.toggle('hidden', emDias || emComponente || emTurma);
    document.getElementById('ind-nota-turma')?.classList.toggle('hidden', !emTurma);
    document.getElementById('ind-nota-dias')?.classList.toggle('hidden', !emDias);
    document.getElementById('ind-nota-componente')?.classList.toggle('hidden', !emComponente);

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
    if (emTurma) { desenharTurma(alvo, resumo); return; }

    const planos = estado.dados.planos
        .filter(({ meta }) => estado.periodo === 'ano' || meta.key === estado.periodo)
        .map(({ meta, allocations }) => ({
            periodo: meta.periodo,
            allocations: alocacoesDoPlano(meta, allocations)
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
    const rotuloPeriodo = rotuloDoPeriodo();
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
        ...cursos.map((c, i) => th(`curso:${c}`, c, `CH no curso ${nomeDoCurso(c)} (${nomeUnidade(unidadeDe(c))})`, abreGrupo(i) ? 'ind-grupo' : '')),
        ...colunasPL.map((p, i) => th(`pl:${p}`, p, `CH no ${p}`, i === 0 ? 'ind-grupo ind-pl' : 'ind-pl'))
    ].join('');

    const linhaHtml = (l, pos) => {
        const nome = l.semDocente
            ? `<span class="ind-sem-docente" title="Componentes alocadas sem docente ou com docente &quot;${SEM_DOCENTE}&quot;">${esc(SEM_DOCENTE)} (sem docente)</span>`
            : `<button type="button" class="ind-docente" data-ver-docente="${esc(l.nome)}" title="${esc(`Ver os dias de ${l.nome} (sub-aba Dias do docente)`)}">${esc(l.nome)}</button>${l.improvisado
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
    const planos = estado.dados.planos.map(({ meta, allocations }) => ({ meta, allocations: alocacoesDoPlano(meta, allocations) }));
    quadrosDias = [];

    // Dias do docente olha todas as unidades: o periodo vai sem a unidade.
    const rotuloPeriodo = rotuloDoPeriodo({ comUnidade: false });
    if (!estado.docente) {
        if (resumo) resumo.innerHTML = `<b>${esc(rotuloPeriodo)}</b>`;
        alvo.innerHTML = '<p class="ind-vazio">Digite o nome do docente no alto e escolha na lista.</p>';
        return;
    }

    const { entries, rotulos } = aulasDoDocente(estado.docente, planos);
    diasPlanoDaKey = new Map();
    entries.forEach((e) => { if (!diasPlanoDaKey.has(e.key)) diasPlanoDaKey.set(e.key, e.plano); });
    const { feriados, nomeFeriado } = feriadosDoQuadro('');

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


// ===== Comum a Componente e Turma =====

// As aulas podem passar do fim do PL (aviso na Lista de ofertas): a busca olha
// ate 4 meses depois, para o "Fim" sair certo.
const FOLGA_FIM_DIAS = 120;

// Linhas desenhadas (o botao "Ir para a oferta" e a linha guardam o indice).
let linhasComponente = [];
let linhasTurma = [];

// Docente(s) da oferta; dividida: a parte de cada um. O nome abre a sub-aba
// Dias do docente (pedido de 26/11/2026; antes abria a agenda do docente).
function docentesHtml(oferta) {
    if (!oferta.docentes.length) {
        return `<span class="ind-sem-docente" title="Componente sem docente">${esc(SEM_DOCENTE)} (sem docente)</span>`;
    }
    const dividida = oferta.docentes.length > 1;
    return oferta.docentes.map((d) => `<button type="button" class="ind-docente" data-ver-docente="${esc(d.nome)}" title="${esc(`Ver os dias de ${d.nome} (sub-aba Dias do docente)`)}">${esc(d.nome)}</button>${dividida ? ` <span class="ind-comp-parte">(${fmtCH(d.ch) || 0}h)</span>` : ''}`).join('<br>');
}

// Atalho para a Lista de ofertas. PL encerrado nao aparece na barra lateral:
// sem atalho (decidido em 24/11/2026). lista: 'componente' ou 'turma'.
function irParaOfertaHtml(l, i, lista) {
    return plNaBarra(l.meta.key)
        ? `<button type="button" class="ind-ir-oferta" data-ir-oferta="${i}" data-ir-lista="${lista}" title="Abrir ${esc(l.turma)} no ${esc(l.meta.periodo)} e mostrar a componente na Lista de ofertas">✎ Ir para a oferta</button>`
        : '<span class="ind-pl-encerrado" title="Este PL já terminou e não aparece mais na barra lateral">PL encerrado</span>';
}

// Identifica a linha da tabela (para lembrar qual quadro esta aberto).
const chaveDaLinha = (l) => [chaveComponente(l.oferta.disciplina), l.meta.key, l.oferta.turmaId, l.oferta.subturma].join('|');

// Aulas de uma turma num PL (o calendario ja tira feriados e pausas): as
// entradas do quadro e, por oferta ('COMPONENTE|subturma'), as aulas, a cor e as
// keys do quadro. rotuloTurma: nome da turma naquele PL (ex.: EP2024_BL7).
function aulasDaTurma(plano, turmaId) {
    const { meta } = plano;
    const entries = [];
    const porOferta = new Map();
    let rotuloTurma = '';
    withPlanContext(meta, plano.allocations, () => {
        rotuloTurma = getTurmaLabel(turmaId, '') || turmaId;
        const porData = getCalendarEvents(turmaId, meta.termStart, somarDias(meta.termEnd, FOLGA_FIM_DIAS)) || {};
        Object.entries(porData).forEach(([date, eventos]) => (eventos || []).forEach((ev) => {
            if (!ev || ev.type === 'holiday') return;
            const disciplina = String(ev.disciplina || ev.title || '').trim();
            const chComponente = Number(getDisciplinaCHGlobal(disciplina, turmaId)) || Number(ev.ch) || 0;
            const entry = entradaDias(ev, date, meta.key, { chComponente });
            entries.push(entry);
            const k = `${chaveComponente(disciplina)}|${chaveSubturma(ev.subGrupo)}`;
            let o = porOferta.get(k);
            if (!o) {
                o = { key: entry.key, keys: new Set(), cor: ev.cor, subGrupo: ev.subGrupo || '', aulas: [] };
                porOferta.set(k, o);
            }
            o.keys.add(entry.key);
            o.aulas.push({ date, horario: ev.horario });
        }));
    });
    return { entries, porOferta, rotuloTurma };
}

const nomesDosDocentes = (oferta) => oferta.docentes.map((d) => d.nome).join(' / ') || SEM_DOCENTE;
const rotuloSubturma = (subGrupo) => {
    const num = numeroDaSubturma(subGrupo);
    return num ? `T${String(num).padStart(2, '0')}` : '';
};

// Quadro de uma turma num PL: uma linha por componente e, ao lado de cada uma,
// T0n e o(s) docente(s). destaque = key da componente em destaque (as outras
// ficam mais claras). aulas: de aulasDaTurma. Devolve { html, quadro }.
function quadroTurmaDoPlano({ plano, turmaId, aulas, titulo, destaque = '', indice = 0, detalhe = null, classe = '', aposNome = null }) {
    const { meta } = plano;
    const { entries, porOferta } = aulas;
    const docentesDe = new Map(plano.ofertas.filter((o) => o.turmaId === turmaId)
        .map((o) => [`${chaveComponente(o.disciplina)}|${o.subturma}`, nomesDosDocentes(o)]));
    const rotulos = new Map();
    porOferta.forEach((o, k) => {
        const texto = [rotuloSubturma(o.subGrupo), docentesDe.get(k) || ''].filter(Boolean).join(' · ');
        o.keys.forEach((key) => rotulos.set(key, texto));
    });
    const { feriados, nomeFeriado } = feriadosDoQuadro(turmaId);
    return quadroTurmaHtml({
        indice,
        titulo: `${titulo || aulas.rotuloTurma} · ${estado.ano} - ${meta.periodo}`,
        datas: `${formatDateBR(meta.termStart)} a ${formatDateBR(meta.termEnd)}`,
        termStart: meta.termStart,
        termEnd: meta.termEnd,
        entries,
        rotulos,
        feriados,
        nomeFeriado,
        destaque,
        dica: DICA_MOUSE,
        detalhe,
        classe,
        aposNome
    });
}

// Componente: quadro da turma da linha no PL dela, a componente buscada em
// destaque; o titulo usa o nome da linha (com a subturma, ex.: EP2024_BL7_T01).
function quadroDaTurma(linha, planos) {
    const plano = planos.find((p) => p.meta.key === linha.meta.key);
    if (!plano) return { html: '', quadro: null };
    const turmaId = linha.oferta.turmaId;
    const aulas = aulasDaTurma(plano, turmaId);
    const destaque = aulas.porOferta.get(`${chaveComponente(linha.oferta.disciplina)}|${linha.oferta.subturma}`)?.key || '';
    return quadroTurmaDoPlano({ plano, turmaId, aulas, titulo: linha.turma, destaque });
}

function somarDias(iso, n) {
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Planos do periodo escolhido (ano ou um PL), so a unidade escolhida, com as ofertas.
function planosDaUnidade() {
    return estado.dados.planos
        .filter(({ meta }) => estado.periodo === 'ano' || meta.key === estado.periodo)
        .map(({ meta, allocations }) => {
            const allocs = alocacoesDoPlano(meta, allocations)
                .filter((a) => unidadeDe(getCursoSiglaDaTurma(a?.turmaId)) === estado.unidade);
            const ofertas = ofertasDoPlano(allocs, { cursoDaTurma: getCursoSiglaDaTurma, chDaComponente: getDisciplinaCHGlobal });
            return { meta, allocations: allocs, ofertas };
        });
}

// ===== Componente =====

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
    return linhas.sort((a, b) => ordemPL.indexOf(a.meta.key) - ordemPL.indexOf(b.meta.key)
        || posicaoDoCurso(a.oferta.curso) - posicaoDoCurso(b.oferta.curso)
        || a.turma.localeCompare(b.turma, 'pt-BR', { numeric: true }));
}

function desenharComponente(alvo, resumo) {
    const planos = planosDaUnidade();
    const rotuloPeriodo = rotuloDoPeriodo();

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

    const corpo = linhas.map((l, i) => {
        const horario = [l.dias, `${l.turnos} ${l.horario}`.trim()].filter(Boolean).join(' · ');
        const aberta = chaveDaLinha(l) === estado.compAberta;
        return `<tr class="ind-comp-linha${aberta ? ' is-aberta' : ''}" data-comp-linha="${i}" title="${esc(`Clique para ${aberta ? 'fechar' : 'ver'} o quadro da turma ${l.turma} no ${l.meta.periodo}`)}">
            <td class="ind-comp-pl" title="${esc(`${estado.ano} - ${l.meta.periodo}: ${formatDateBR(l.meta.termStart)} a ${formatDateBR(l.meta.termEnd)}`)}">${esc(l.meta.periodo)}</td>
            <td title="${esc(nomeDoCurso(l.oferta.curso))}">${esc(l.oferta.curso)}</td>
            <td class="ind-comp-turma"><button type="button" class="ind-link" data-ver-turma="${i}" title="${esc(`Ver a turma ${l.turma} inteira (sub-aba Turma)`)}">${esc(l.turma)}</button></td>
            <td class="ind-nome">${docentesHtml(l.oferta)}</td>
            <td class="ind-num">${fmtCH(l.oferta.ch) || '—'}</td>
            <td>${l.inicio ? formatDateBR(l.inicio) : '—'}</td>
            <td>${l.fim ? formatDateBR(l.fim) : '—'}</td>
            <td>${esc(horario) || '—'}</td>
            <td class="ind-comp-ir">${irParaOfertaHtml(l, i, 'componente')}</td>
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


// ===== Turma =====

// Faculdades (cursos) da unidade escolhida, para o filtro da sub-aba Turma.
function montarFaculdades() {
    const sel = document.getElementById('sel-curso-ind');
    if (!sel) return;
    const cursos = (store.rawData?.cursos || []).filter((c) => unidadeDe(c.sigla) === estado.unidade);
    if (!cursos.some((c) => c.sigla === estado.turmaCurso)) estado.turmaCurso = '';
    const html = `<option value="">Todas</option>${cursos.map((c) => `<option value="${esc(c.sigla)}">${esc(`${c.curso} (${c.sigla})`)}</option>`).join('')}`;
    if (sel.dataset.unidade !== estado.unidade) {
        sel.innerHTML = html;
        sel.dataset.unidade = estado.unidade;
    }
    sel.value = estado.turmaCurso;
}

// Turmas com horario no periodo, na unidade e na faculdade escolhidas, na ordem
// dos cursos do cadastro e depois pelo nome (EP2023, EP2024...).
function turmasDosPlanos(planos) {
    const ids = new Set();
    planos.forEach((p) => p.ofertas.forEach((o) => {
        if (!estado.turmaCurso || o.curso === estado.turmaCurso) ids.add(o.turmaId);
    }));
    return [...ids].map((id) => {
        const t = (store.rawData?.turmas || []).find((x) => String(x.turma_id) === String(id));
        return { id, rotulo: getTurmaBaseLabel(id), curso: getCursoSiglaDaTurma(id), turno: t?.turno || '', campus: t?.campus || '' };
    }).sort((a, b) => posicaoDoCurso(a.curso) - posicaoDoCurso(b.curso) || a.rotulo.localeCompare(b.rotulo, 'pt-BR', { numeric: true }));
}

// Uma linha por componente da turma no PL (T01 e T02 separadas), com as keys do
// quadro (para as linhas de detalhe e o destaque).
function linhasDaTurma(plano, turmaId, aulas) {
    return plano.ofertas.filter((o) => o.turmaId === turmaId).map((oferta) => {
        const o = aulas.porOferta.get(`${chaveComponente(oferta.disciplina)}|${oferta.subturma}`);
        return {
            meta: plano.meta,
            oferta,
            key: o?.key || '',
            keys: o ? [...o.keys] : [],
            sub: rotuloSubturma(o?.subGrupo || oferta.subturma),
            turma: [aulas.rotuloTurma, rotuloSubturma(o?.subGrupo || oferta.subturma)].filter(Boolean).join(' '),
            ...resumoDasAulas(o?.aulas || [])
        };
    });
}

// Embaixo do nome da componente no quadro da Turma (pedido de 26/11/2026):
// 1) o(s) docente(s), um por linha (dividida: a parte de cada um);
// 2) T01 (subturma) · CH · dias · horario · inicio-fim.
function detalheDaLinha(l) {
    const docentes = l.oferta.docentes;
    const dividida = docentes.length > 1;
    const quem = docentes.length
        ? docentes.map((d) => `<button type="button" class="dd-rot-docente ind-link" data-ver-docente="${esc(d.nome)}" title="${esc(`Ver os dias de ${d.nome} (sub-aba Dias do docente)`)}">${esc(d.nome)}</button>${dividida ? ` <span class="dd-rot-parte">(${fmtCH(d.ch) || 0}h)</span>` : ''}`)
        : [`<span class="ind-sem-docente">${esc(SEM_DOCENTE)} (sem docente)</span>`];
    const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
    const quando = [
        l.sub ? `<b class="dd-rot-subturma">${esc(l.sub)}</b>` : '',
        `<b class="dd-rot-ch">${fmtCH(l.oferta.ch) || 0}h</b>`,
        esc(l.dias),
        esc(`${l.turnos} ${l.horario}`.trim()),
        l.inicio ? `${dm(l.inicio)}–${dm(l.fim)}` : ''
    ].filter(Boolean).join(' · ');
    return [...quem, quando];
}

function desenharTurma(alvo, resumo) {
    montarFaculdades();
    const planos = planosDaUnidade();
    const rotuloPeriodo = rotuloDoPeriodo();

    // Botoes das turmas (2a linha dos filtros).
    const turmas = turmasDosPlanos(planos);
    if (!turmas.some((t) => t.id === estado.turma)) { estado.turma = ''; estado.turmaDestaque = ''; }
    const box = document.getElementById('ind-turmas');
    if (box) {
        box.innerHTML = turmas.length
            ? turmas.map((t) => `<button type="button" class="ind-turma-chip${t.id === estado.turma ? ' is-active' : ''}" data-turma="${esc(t.id)}" aria-pressed="${t.id === estado.turma}"
                title="${esc([t.rotulo, t.turno, t.campus].filter(Boolean).join(' · '))}">${esc(t.rotulo)}</button>`).join('')
            : '<span class="ind-turmas-vazio">nenhuma turma com horário neste período</span>';
    }

    linhasTurma = [];
    quadrosDias = [];
    if (!estado.turma) {
        if (resumo) resumo.innerHTML = `<b>${esc(rotuloPeriodo)}</b> &nbsp;|&nbsp; ${turmas.length} turma${turmas.length === 1 ? '' : 's'} com horário`;
        alvo.innerHTML = turmas.length ? '<p class="ind-vazio">Clique numa turma, no alto.</p>' : '';
        return;
    }

    const turmaId = estado.turma;
    const sigla = getCursoSiglaDaTurma(turmaId);
    const nomeCurso = sigla ? nomeDoCurso(sigla) : '';
    const [plDestaque, ...resto] = estado.turmaDestaque.split('|');
    let chTotal = 0;
    let nComp = 0;
    const blocos = planos.filter((p) => p.ofertas.some((o) => o.turmaId === turmaId)).map((plano) => {
        const aulas = aulasDaTurma(plano, turmaId);
        const linhas = linhasDaTurma(plano, turmaId, aulas);
        nComp += linhas.length;
        chTotal += linhas.reduce((n, l) => n + (Number(l.oferta.ch) || 0), 0);
        linhasTurma.push(...linhas);
        const porKey = new Map();
        linhas.forEach((l) => l.keys.forEach((k) => porKey.set(k, l)));
        const destaque = plDestaque === plano.meta.key ? resto.join('|') : '';
        const { html, quadro } = quadroTurmaDoPlano({
            plano, turmaId, aulas, destaque,
            indice: quadrosDias.length,
            classe: 'dd-quadro--turma',
            // ↗ = onde mais a componente e dada; ✎ = Lista de ofertas (editar/trocar la).
            aposNome: (comp) => {
                const l = porKey.get(comp.key);
                if (!l) return '';
                const ir = plNaBarra(l.meta.key)
                    ? ` <button type="button" class="dd-rot-ir" data-ir-oferta="${linhasTurma.indexOf(l)}" data-ir-lista="turma" title="${esc(`Abrir ${l.turma} no ${l.meta.periodo} e mostrar a componente na Lista de ofertas (Editar, Trocar...)`)}">✎</button>`
                    : '';
                return ` <button type="button" class="dd-rot-ir" data-ver-componente="${esc(l.oferta.disciplina)}" title="Em quais turmas e PLs esta componente é dada (sub-aba Componente)">↗</button>${ir}`;
            },
            detalhe: (comp) => (porKey.has(comp.key) ? detalheDaLinha(porKey.get(comp.key)) : null)
        });
        if (quadro) quadrosDias.push(quadro);
        return `<div class="ind-turma-pl" data-plan-key="${esc(plano.meta.key)}">${html}</div>`;
    }).join('');

    if (resumo) {
        resumo.innerHTML = [
            `<b>${esc(getTurmaBaseLabel(turmaId))}</b>${nomeCurso ? ` · ${esc(nomeCurso)}` : ''}`,
            esc(rotuloPeriodo),
            `${nComp} componente${nComp === 1 ? '' : 's'} · ${fmtCH(chTotal) || 0} h`,
            ...(estado.carregando ? ['atualizando…'] : []),
            '<span class="ind-dica-mouse">Clique no nome de uma componente para destacá-la.</span>'
        ].join(' &nbsp;|&nbsp; ');
    }
    alvo.innerHTML = blocos || '<p class="ind-vazio">Sem aulas desta turma neste período.</p>';
}


// ===== Navegacao entre as sub-abas (Etapa 1 da integracao, 26/11/2026) =====
// Turma, componente e docente se entrelacam: cada atalho guarda a tela de antes
// e o botao "Voltar" volta para ela (como o voltar do navegador, so aqui dentro).

// Dias do docente: de qual PL e cada componente desenhada (key -> planKey).
let diasPlanoDaKey = new Map();

const CAMPOS_NAV = ['subaba', 'unidade', 'periodo', 'docente', 'componente', 'compAberta', 'turmaCurso', 'turma', 'turmaDestaque'];
const historico = []; // [{ foto, rolagem }], o ultimo e a tela de antes
const MAX_HISTORICO = 20;

const abaIndicadores = () => document.getElementById('tab-indicadores');

// Nome curto da tela guardada, para o texto do botao Voltar.
function nomeDaTela(foto) {
    if (foto.subaba === 'turma' && foto.turma) return `Turma ${getTurmaBaseLabel(foto.turma)}`;
    if (foto.subaba === 'componente' && foto.componente) return foto.componente;
    if (foto.subaba === 'dias' && foto.docente) return foto.docente;
    return { carga: 'Carga por docente', dias: 'Dias do docente', componente: 'Componente', turma: 'Turma' }[foto.subaba] || 'tela anterior';
}

function atualizarVoltar() {
    const btn = document.getElementById('btn-ind-voltar');
    if (!btn) return;
    const ultimo = historico[historico.length - 1];
    btn.classList.toggle('hidden', !ultimo);
    if (!ultimo) return;
    const nome = nomeDaTela(ultimo.foto);
    btn.textContent = `← Voltar: ${nome}`;
    btn.title = `Voltar para ${nome}`;
}

// Campos digitaveis e selects seguem o estado (depois de um atalho ou do Voltar).
// O cursor sai da caixa de busca: a lista de sugestoes fecha e nao fica solta.
function sincronizarCampos() {
    if (document.activeElement?.closest?.('#tab-indicadores')) document.activeElement.blur();
    const selUnidade = document.getElementById('sel-unidade-indicadores');
    if (selUnidade) selUnidade.value = estado.unidade;
    const inpDocente = document.getElementById('inp-docente-dias');
    if (inpDocente) inpDocente.value = estado.docente;
    const inpComp = document.getElementById('inp-componente-ind');
    if (inpComp) inpComp.value = estado.componente;
}

// Vai para outra tela guardando a atual. muda: os campos do estado que mudam.
function navegar(muda) {
    historico.push({ foto: Object.fromEntries(CAMPOS_NAV.map((k) => [k, estado[k]])), rolagem: abaIndicadores()?.scrollTop || 0 });
    if (historico.length > MAX_HISTORICO) historico.shift();
    Object.assign(estado, muda);
    sincronizarCampos();
    desenhar();
    // Leva o olho ao que foi destacado; sem destaque, ao alto da sub-aba.
    const alvo = document.querySelector('#ind-tabela .dd-rot-destaque');
    if (alvo) alvo.scrollIntoView({ block: 'center' });
    else if (abaIndicadores()) abaIndicadores().scrollTop = 0;
}

function voltar() {
    const ultimo = historico.pop();
    if (!ultimo) return;
    Object.assign(estado, ultimo.foto);
    sincronizarCampos();
    desenhar();
    if (abaIndicadores()) abaIndicadores().scrollTop = ultimo.rolagem;
}

// Turma (no PL da componente, que fica em destaque). O periodo so muda se o PL
// escolhido nao e o da componente; a unidade passa a ser a da turma.
function irParaTurma({ turmaId, planKey = '', key = '' }) {
    if (!turmaId) return;
    const curso = getCursoSiglaDaTurma(turmaId);
    navegar({
        subaba: 'turma',
        unidade: unidadeDe(curso),
        turma: turmaId,
        turmaCurso: estado.turmaCurso && estado.turmaCurso !== curso ? '' : estado.turmaCurso,
        turmaDestaque: key && planKey ? `${planKey}|${key}` : '',
        periodo: estado.periodo === 'ano' || !planKey || estado.periodo === planKey ? estado.periodo : planKey
    });
}

function irParaDocente(nome) {
    if (nome) navegar({ subaba: 'dias', docente: nome });
}

function irParaComponente(disciplina) {
    const nome = semSufixoCH(disciplina);
    if (nome) navegar({ subaba: 'componente', componente: nome, compAberta: '' });
}

// Liga o botao Voltar (chamado uma vez, no setup).
function ligarVoltar() {
    document.getElementById('btn-ind-voltar')?.addEventListener('click', voltar);
}

// O x so aparece com algo escrito na caixa.
function atualizarLimpar() {
    document.querySelectorAll('#tab-indicadores .ind-busca-limpar[data-limpar]').forEach((btn) => {
        btn.classList.toggle('hidden', !document.getElementById(btn.dataset.limpar)?.value);
    });
}
