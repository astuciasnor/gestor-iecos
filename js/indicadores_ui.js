import { UNIDADE_PADRAO, unidadeDoCurso } from './unidades.mjs?v=202611201727';
import { escapeHtml as esc } from './texto.mjs?v=202611201727';
// Menu Indicadores (so leitura: nada e gravado).
// Sub-aba "Carga por docente": tabela com a CH de cada docente por curso e por PL,
// do ano inteiro ou de um PL. As contas estao em indicadores.mjs.
// Sub-aba "Dias do docente": quadro de um docente, uma linha por componente e um
// quadradinho por dia do PL, com os dias de 2+ componentes (dias_docente.mjs).
import { store } from './store.js?v=202611201727';
import { getCursoSiglaDaTurma, getDisciplinaCHGlobal } from './curso_turma_helpers.js?v=202611201727';
import { formatDateBR } from './date_utils_ui.js?v=202611201727';
import { UNIDADES } from './docente_nomes.mjs?v=202611201727';
import { cargaPorDocente, ordenarLinhas, SEM_DOCENTE } from './indicadores.mjs?v=202611201727';
import { diasDoDocente } from './dias_docente.mjs?v=202611201727';
import { getCalendarEvents } from './calendar.js?v=202611201727';
import { withPlanContext } from './calendarios_ui.js?v=202611201727';
import { getTurmaLabel } from './curso_turma_helpers.js?v=202611201727';
import { feriadosDaTurma } from './feriados.mjs?v=202611201727';
import { vividHexColor, hexToRgb, rgbToHsl, hslToRgb } from './color_utils.js?v=202611201727';
import { chOrientadorDaOferta } from './estagio.mjs?v=202611201727';

const VALIDADE_MS = 2 * 60 * 1000; // depois disso, abrir o menu busca de novo

let carregarPlanos = null;   // (metas) => Promise<[{ meta, allocations }]>, vem do ui.js
let abrirAgendaDocente = null; // (nome, periodo) => void, vem do ui.js
let avisarErro = (msg) => console.warn(msg);
let ajustarNome = () => {}; // (campo) => troca "zelia" por "Zélia" (nome da lista), vem do ui.js

const estado = {
    unidade: UNIDADE_PADRAO, // so os cursos desta unidade (IECOS, CBRAG...)
    ano: '',
    periodo: 'ano',          // 'ano' ou a chave do PL
    ordem: { coluna: 'total', crescente: false },
    dados: null,             // { ano, planos: [{ meta, allocations }], em }
    carregando: false,
    subaba: 'carga',         // 'carga' (tabela de CH) ou 'dias' (dias do docente)
    docente: ''              // docente escolhido em "Dias do docente"
};

// Quadros desenhados em "Dias do docente" (para o texto do dia ao passar o mouse).
let quadrosDias = [];

export function setIndicadoresLigacoes({ carregar, abrirDocente, erro, ajustarNomeDocente } = {}) {
    if (typeof carregar === 'function') carregarPlanos = carregar;
    if (typeof ajustarNomeDocente === 'function') ajustarNome = ajustarNomeDocente;
    if (typeof abrirDocente === 'function') abrirAgendaDocente = abrirDocente;
    if (typeof erro === 'function') avisarErro = erro;
}

function fmtCH(n) {
    if (!n) return '';
    return Number.isInteger(n) ? n.toLocaleString('pt-BR') : n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
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
    // Passar o mouse (ou tocar) num dia do quadro: acende a coluna e diz o que ha no dia.
    const focarDia = (ev) => {
        const cel = ev.target.closest('[data-dd-date]');
        if (cel) focarDiaDoQuadro(cel);
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
    const emDias = estado.subaba === 'dias';
    document.querySelectorAll('#tab-indicadores .ind-subaba[data-subaba]').forEach((btn) => {
        const ativa = btn.dataset.subaba === estado.subaba;
        btn.classList.toggle('is-ativa', ativa);
        btn.setAttribute('aria-selected', String(ativa));
    });
    document.getElementById('ind-docente-box')?.classList.toggle('hidden', !emDias);
    document.getElementById('ind-docente-quebra')?.classList.toggle('hidden', !emDias);
    document.getElementById('ind-nota-carga')?.classList.toggle('hidden', emDias);
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

const SEMANA_CURTA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const LETRA_DIA = ['', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

// Aulas do docente em todos os PLs do ano: um PL pode passar das datas do outro
// (PL2 ate julho, PL3 desde junho), entao o dia carregado olha todos juntos.
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
                    const key = `${ev.turmaId || ''}|${disciplina.toLocaleUpperCase('pt-BR')}|${ev.subGrupo || ''}`;
                    // O rotulo da turma depende do PL (bloco): calcula dentro dele.
                    if (!rotulos.has(key)) rotulos.set(key, getTurmaLabel(ev.turmaId, ev.subGrupo));
                    // plano: de qual PL veio a aula (a CH de cada PL conta so as dele).
                    entries.push({ date, key, disciplina, turmaId: ev.turmaId, subGrupo: ev.subGrupo, cor: ev.cor, aulas: 1, horario: ev.horario, plano: meta.key, campo: !!ev.estagioCampo,
                        // Estagio com CH do orientador (Montar estagio): e essa CH que conta
                        // para o docente, nao as horas de aula. Docente unico apenas.
                        chOrientador: chOrientadorDaOferta([ev], Number(getDisciplinaCHGlobal(disciplina, ev.turmaId)) || Number(ev.ch) || 0,
                            Array.isArray(ev.docentes) && ev.docentes.length > 1) });
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

    const mostrar = planos.filter(({ meta }) => estado.periodo === 'ano' || meta.key === estado.periodo);
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
    const periodoDoPlano = new Map(planos.map(({ meta }) => [meta.key, meta.periodo]));
    let carregadosTotal = 0;
    const blocos = mostrar.map(({ meta }) => {
        const r = diasDoDocente({ termStart: meta.termStart, termEnd: meta.termEnd, entries, feriados });
        carregadosTotal += r.carregados;
        const titulo = `${String(meta.termStart).slice(0, 4)} - ${meta.periodo}`;
        const datas = `${formatDateBR(meta.termStart)} a ${formatDateBR(meta.termEnd)}`;
        if (!r.componentes.length) {
            return `<section class="dd-quadro is-vazio"><div class="dd-head"><b class="dd-pl">${esc(titulo)}</b><span class="dd-datas">${esc(datas)}</span><span class="dd-sem">Sem aulas neste período</span></div></section>`;
        }
        const indice = quadrosDias.push({ r, rotulos, nomeFeriado }) - 1;
        const outroPL = (key) => {
            const plano = plDaKey.get(key);
            return plano && plano !== meta.key ? (periodoDoPlano.get(plano) || '') : '';
        };
        return quadroDiasHtml(indice, titulo, datas, r, rotulos, chDoPL(meta.key), aulasDoPL(meta.key), outroPL);
    }).join('');

    if (resumo) {
        const carga = carregadosTotal
            ? `<span class="ind-resumo-alerta dd-alerta">${carregadosTotal} dia${carregadosTotal === 1 ? '' : 's'} com 2 ou mais componentes</span>`
            : 'nenhum dia com 2 componentes';
        // Carga horaria: no ano, o total e a de cada PL; num PL, so a dele.
        const ch = estado.periodo === 'ano'
            ? `<b class="dd-ch-total">${fmtCH(planos.reduce((n, { meta }) => n + chDoPL(meta.key), 0)) || 0}h no ano</b> <span class="dd-ch-pls">(${planos.map(({ meta }) => `${esc(meta.periodo)} ${fmtCH(chDoPL(meta.key)) || 0}h`).join(' · ')})</span>`
            : `<b class="dd-ch-total">${fmtCH(chDoPL(estado.periodo)) || 0}h no PL</b>`;
        resumo.innerHTML = `<b>${esc(estado.docente)}</b> &nbsp;|&nbsp; ${esc(rotuloPeriodo)} &nbsp;|&nbsp; ${ch} &nbsp;|&nbsp; ${carga}${estado.carregando ? ' &nbsp;|&nbsp; atualizando…' : ''}`;
    }
    alvo.innerHTML = blocos || '<p class="ind-vazio">Nenhum período letivo neste ano.</p>';
}

// No quadro Dias do docente o vermelho e o alerta de "2 ou mais componentes".
// Componente de cor vermelha (ex.: Bioquimica rosa #ffc2c2 vira #ff4f4f no tom
// forte) e desenhada em rosa aqui, para nao parecer alerta (20/11/2026).
// So neste quadro: a cor da componente nas outras telas nao muda.
function semVermelhoDeAlerta(hex) {
    const { r, g, b } = hexToRgb(hex);
    const { h, s, l } = rgbToHsl(r, g, b);
    if (s < 0.08 || (h >= 0.04 && h <= 0.96)) return hex;
    const out = hslToRgb(0.94, s, l);
    return `#${[out.r, out.g, out.b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}

// Uma coluna por dia do PL (domingo e uma coluna fina); linha 1 = meses,
// 2 = numero das segundas, 3 = letra do dia, 4 = "Dia a dia", depois as componentes.
function quadroDiasHtml(indice, titulo, datas, r, rotulos, ch, aulas = ch, outroPL = () => '') {
    const col = (k) => k + 2;
    const colunas = r.datas.map((d) => (d.weekday === 0 ? '4.75px' : 'minmax(5.7px, 1fr)')).join(' ');
    const pos = (k, linha) => `grid-column:${col(k)};grid-row:${linha}`;
    const corDe = (comp) => semVermelhoDeAlerta(vividHexColor(comp?.cor || '', '#7fa892'));
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

    // Dia a dia (todas as componentes juntas)
    html += '<span class="dd-rot dd-rot-resumo" style="grid-row:4"><span class="dd-rot-nome">Dia a dia</span><span class="dd-rot-sub">todas as componentes</span></span>';
    r.datas.forEach((d, k) => {
        if (d.carregado) html += celula(d, k, 4, ' dd-resumo dd-n2', '');
        // Um verde so (nao a cor da componente): uma componente vermelha nao parece dia carregado.
        else if (d.componentes.length === 1) html += celula(d, k, 4, ' dd-resumo dd-um', '');
        else if (d.emCampo.length) html += celula(d, k, 4, ' dd-resumo dd-campo', '');
        else html += celula(d, k, 4, ' dd-resumo', '');
    });
    html += '<span class="dd-sep" style="grid-row:5"></span>';

    // Uma linha por componente
    const carregado = new Set(r.datas.filter((d) => d.carregado).map((d) => d.date));
    r.componentes.forEach((comp, n) => {
        const linha = 6 + n;
        const turma = rotulos.get(comp.key) || comp.turmaId;
        const sub = [turma, `${comp.turnos} ${comp.horario}`.trim(), comp.weekdays, `${fmtCH(comp.aulas)}h`].filter(Boolean).join(' · ');
        // Componente de outro PL: cor fraca e listrada (nome tambem mais apagado).
        const pl = outroPL(comp.key);
        const dica = pl ? `${comp.disciplina} (componente do ${pl})\n${sub}` : `${comp.disciplina}\n${sub}`;
        html += `<span class="dd-rot${pl ? ' dd-rot-outro' : ''}" style="grid-row:${linha}" title="${esc(dica)}"><span class="dd-rot-nome">${esc(comp.disciplina)}</span><span class="dd-rot-sub">${esc(sub)}</span></span>`;
        const cor = corDe(comp);
        r.datas.forEach((d, k) => {
            if (!comp.porData[d.date]) { html += celula(d, k, linha, '', ''); return; }
            // Estagio em campo: os alunos no campo, sem o docente (cinza, nao pesa o dia).
            if (comp.porData[d.date].campo) { html += celula(d, k, linha, ' dd-campo', ''); return; }
            html += celula(d, k, linha, ` dd-on${pl ? ' dd-outro' : ''}${carregado.has(d.date) ? ' dd-dupla' : ''}`, cor);
        });
    });

    return `
        <section class="dd-quadro" data-dd-quadro="${indice}">
            <div class="dd-head">
                <b class="dd-pl">${esc(titulo)}</b>
                <span class="dd-datas">${esc(datas)}</span>
                ${ch === aulas
                    ? `<span class="dd-ch" title="Carga horária do docente neste PL">${fmtCH(ch) || 0}h</span>`
                    : `<span class="dd-ch dd-ch-orientador" title="Carga horária do docente neste PL: ${fmtCH(ch)} h (o estágio conta a CH do orientador). Horas de aula no calendário: ${fmtCH(aulas)} h.">${fmtCH(ch) || 0}/${fmtCH(aulas) || 0}h</span>`}
                ${r.carregados ? `<span class="dd-alerta">${r.carregados} dia${r.carregados === 1 ? '' : 's'} com 2 ou mais componentes</span>` : '<span class="dd-sem">nenhum dia com 2 componentes</span>'}
            </div>
            <div class="dd-legenda">
                <span><i class="dd-leg-baixo" style="background:#8fbfa2"></i>Dia a dia: 1 componente</span>
                <span><i class="dd-leg-baixo" style="background:#d61f1f;border-color:#d61f1f"></i>Dia a dia: 2 ou mais componentes</span>
                <span><i style="background:#6aaee8"></i>aula (cor da componente)</span>
                <span><i style="background:#6aaee8;box-shadow:inset 0 -4px 0 #d61f1f,inset 0 -5px 0 #fff"></i>aula num dia carregado</span>
                <span><i style="background:repeating-linear-gradient(135deg,#b9c6bd 0 2px,transparent 2px 4px)"></i>feriado</span>
                ${r.datas.some((d) => d.emCampo.length) ? '<span><i class="dd-leg-campo"></i>estágio em campo (alunos no campo; não pesa o dia do docente)</span>' : ''}
                ${r.componentes.some((c) => outroPL(c.key)) ? '<span><i class="dd-leg-outro" style="--dd-c:#6aaee8"></i>aula de outro PL (nas datas deste)</span>' : ''}
                <span>coluna fina = domingo</span>
            </div>
            <div class="dd-info" aria-live="polite">Passe o mouse num dia para ver as aulas dele.</div>
            <div class="dd-rolagem"><div class="dd-grade" style="grid-template-columns:minmax(152px, 208px) ${colunas}">${html}</div></div>
        </section>`;
}

function textoDoDia(quadro, date) {
    const { r, rotulos, nomeFeriado } = quadro;
    const dia = r.datas.find((d) => d.date === date);
    if (!dia) return '';
    const nome = `${SEMANA_CURTA[dia.weekday]} ${ddmm(date)}`;
    if (dia.feriado && !dia.componentes.length && !dia.emCampo.length) return `${esc(nome)}: feriado (${esc(nomeFeriado.get(date) || 'Feriado')}).`;
    if (!dia.componentes.length && !dia.emCampo.length) return `${esc(nome)}: sem aula.`;
    const item = (key, campo) => {
        const comp = r.componentes.find((c) => c.key === key);
        const d = comp.porData[date];
        return `${campo ? 'estágio em campo, ' : ''}${esc(`${d.turnos} ${d.horario}`.trim())}: ${esc(comp.disciplina)} (${esc(rotulos.get(key) || comp.turmaId)})`;
    };
    const lista = [...dia.componentes.map((key) => item(key, false)), ...dia.emCampo.map((key) => item(key, true))].join(' · ');
    return dia.carregado
        ? `${esc(nome)}: <b>${dia.componentes.length} componentes no mesmo dia</b> · ${lista}`
        : `${esc(nome)}: ${lista}`;
}

function focarDiaDoQuadro(cel) {
    const secao = cel.closest('[data-dd-quadro]');
    const quadro = quadrosDias[Number(secao?.dataset.ddQuadro)];
    if (!secao || !quadro) return;
    const date = cel.dataset.ddDate;
    secao.querySelectorAll('.is-foco').forEach((el) => el.classList.remove('is-foco'));
    secao.querySelectorAll(`[data-dd-date="${date}"], [data-dd-h="${date}"]`).forEach((el) => el.classList.add('is-foco'));
    const info = secao.querySelector('.dd-info');
    if (info) info.innerHTML = textoDoDia(quadro, date);
}
