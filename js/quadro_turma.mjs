// Quadro de uma turma num PL: uma linha por componente e, ao lado de cada uma,
// T0n e o(s) docente(s). Usado em Indicadores > Turma (com atalhos) e na Agenda
// do Docente > Dia a dia da Turma (so consulta). Saiu de indicadores_ui.js em
// 28/11/2026, sem mudar a tela dos Indicadores.
//
// plano: { meta: { key, periodo, termStart, termEnd }, allocations, ofertas }
// (ofertas: de ofertasDoPlano). comPlano(meta, allocations, fn): roda fn com o
// PL no store (o motor do calendario le o store); cada tela passa o seu.
import { escapeHtml as esc } from './texto.mjs?v=202611281759';
import { store } from './store.js?v=202611281759';
import { getCalendarEvents } from './calendar.js?v=202611281759';
import { getCursoSiglaDaTurma, getDisciplinaCHGlobal, getTurmaBaseLabel, getTurmaLabel } from './curso_turma_helpers.js?v=202611281759';
import { formatDateBR } from './date_utils_ui.js?v=202611281759';
import { feriadosDaTurma } from './feriados.mjs?v=202611281759';
import { chaveComponente, chaveSubturma, ofertasDoPlano, resumoDasAulas, SEM_DOCENTE } from './indicadores.mjs?v=202611281759';
import { DICA_MOUSE, entradaDias, fmtCH, quadroTurmaHtml } from './quadro_dias.mjs?v=202611281759';
import { numeroDaSubturma } from './subturmas.mjs?v=202611281759';
import { UNIDADES, unidadeDoCurso } from './unidades.mjs?v=202611281759';

// ===== Unidade, curso e turmas (os filtros da Turma) =====

// Unidade do curso (cursos[].unidade no dados_app.json; sem ela, UNIDADE_PADRAO).
export function unidadeDe(sigla) {
    return unidadeDoCurso((store.rawData?.cursos || []).find((c) => c.sigla === sigla));
}

export function nomeUnidade(sigla) {
    return UNIDADES.find((u) => u.sigla === sigla)?.nome || sigla;
}

export function nomeDoCurso(sigla) {
    return (store.rawData?.cursos || []).find((c) => c.sigla === sigla)?.curso || sigla;
}

// Posicao do curso na ordem do cadastro (para ordenar tabelas e turmas).
export function posicaoDoCurso(sigla) {
    const ordem = (store.rawData?.cursos || []).map((c) => c.sigla);
    const i = ordem.indexOf(sigla);
    return i < 0 ? ordem.length : i;
}

// Cursos (faculdades) de uma unidade, na ordem do cadastro.
export function cursosDaUnidade(unidade) {
    return (store.rawData?.cursos || []).filter((c) => unidadeDe(c.sigla) === unidade);
}

// Plano de um PL so com as alocacoes da unidade, e as ofertas dele.
export function planoDaUnidade(meta, allocations, unidade) {
    const allocs = (allocations || []).filter((a) => unidadeDe(getCursoSiglaDaTurma(a?.turmaId)) === unidade);
    const ofertas = ofertasDoPlano(allocs, { cursoDaTurma: getCursoSiglaDaTurma, chDaComponente: getDisciplinaCHGlobal });
    return { meta, allocations: allocs, ofertas };
}

// Turmas com horario nos planos (curso '' = todos), na ordem dos cursos do
// cadastro e depois pelo nome (EP2023, EP2024...).
export function turmasDosPlanos(planos, curso = '') {
    const ids = new Set();
    planos.forEach((p) => p.ofertas.forEach((o) => {
        if (!curso || o.curso === curso) ids.add(o.turmaId);
    }));
    return [...ids].map((id) => {
        const t = (store.rawData?.turmas || []).find((x) => String(x.turma_id) === String(id));
        return { id, rotulo: getTurmaBaseLabel(id), curso: getCursoSiglaDaTurma(id), turno: t?.turno || '', campus: t?.campus || '' };
    }).sort((a, b) => posicaoDoCurso(a.curso) - posicaoDoCurso(b.curso) || a.rotulo.localeCompare(b.rotulo, 'pt-BR', { numeric: true }));
}

// ===== Quadro da turma =====

// As aulas podem passar do fim do PL (aviso na Lista de ofertas): a busca olha
// ate 4 meses depois, para o "Fim" sair certo.
export const FOLGA_FIM_DIAS = 120;

export function somarDias(iso, n) {
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Feriados para o quadro dos dias: as datas e o nome de cada uma (turmaId '' = gerais).
export function feriadosDoQuadro(turmaId = '') {
    const lista = feriadosDaTurma(store.rawData?.feriados || [], turmaId);
    const data = (f) => String(f?.data || f || '').trim();
    return {
        feriados: lista.map(data),
        nomeFeriado: new Map(lista.map((f) => [data(f), String(f?.feriado || f?.nome || 'Feriado')]))
    };
}

// Aulas de uma turma num PL (o calendario ja tira feriados e pausas): as
// entradas do quadro e, por oferta ('COMPONENTE|subturma'), as aulas, a cor e as
// keys do quadro. rotuloTurma: nome da turma naquele PL (ex.: EP2024_BL7).
export function aulasDaTurma(plano, turmaId, comPlano) {
    const { meta } = plano;
    const entries = [];
    const porOferta = new Map();
    let rotuloTurma = '';
    comPlano(meta, plano.allocations, () => {
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

export const nomesDosDocentes = (oferta) => oferta.docentes.map((d) => d.nome).join(' / ') || SEM_DOCENTE;
export const rotuloSubturma = (subGrupo) => {
    const num = numeroDaSubturma(subGrupo);
    return num ? `T${String(num).padStart(2, '0')}` : '';
};

// Quadro de uma turma num PL. destaque = key da componente em destaque (as outras
// ficam mais claras). aulas: de aulasDaTurma. ano: o do titulo. Devolve { html, quadro }.
export function quadroTurmaDoPlano({ plano, turmaId, aulas, titulo, ano, destaque = '', indice = 0, detalhe = null, classe = '', aposNome = null }) {
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
        titulo: `${titulo || aulas.rotuloTurma} · ${ano} - ${meta.periodo}`,
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

// Uma linha por componente da turma no PL (T01 e T02 separadas), com as keys do
// quadro (para as linhas de detalhe e o destaque).
export function linhasDaTurma(plano, turmaId, aulas) {
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

// ===== Busca componente =====

// Uma linha por oferta da componente (chave: chaveComponente do nome): PL, turma,
// docentes, CH e as datas das aulas. ordemPL: keys dos PLs na ordem de mostrar.
// Ordem: PL, depois o curso (ordem do cadastro), depois a turma.
export function linhasDaComponente(chave, planos, comPlano, ordemPL = planos.map((p) => p.meta.key)) {
    const linhas = [];
    planos.forEach(({ meta, allocations, ofertas }) => {
        const daComponente = ofertas.filter((o) => chaveComponente(o.disciplina) === chave);
        if (!daComponente.length) return;
        comPlano(meta, allocations, () => {
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
    return linhas.sort((a, b) => ordemPL.indexOf(a.meta.key) - ordemPL.indexOf(b.meta.key)
        || posicaoDoCurso(a.oferta.curso) - posicaoDoCurso(b.oferta.curso)
        || a.turma.localeCompare(b.turma, 'pt-BR', { numeric: true }));
}

// Embaixo do nome da componente no quadro da Turma (pedido de 26/11/2026):
// 1) o(s) docente(s), um por linha (dividida: a parte de cada um);
// 2) T01 (subturma) · CH · dias · horario · inicio-fim.
// nomeDocente(d): como mostrar o nome (Indicadores: botao que abre os dias dele;
// padrao: so o texto).
export function detalheDaLinha(l, nomeDocente = (d) => `<span class="dd-rot-docente">${esc(d.nome)}</span>`) {
    const docentes = l.oferta.docentes;
    const dividida = docentes.length > 1;
    const quem = docentes.length
        ? docentes.map((d) => `${nomeDocente(d)}${dividida ? ` <span class="dd-rot-parte">(${fmtCH(d.ch) || 0}h)</span>` : ''}`)
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
