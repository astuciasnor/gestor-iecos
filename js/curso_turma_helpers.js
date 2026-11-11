import { store } from './store.js?v=202611102339';
import { normalizePeriodo as normalizePeriodoLetivoCode } from './plan_storage.js?v=202611102339';

// Curso (sigla) de uma turma: pelo cadastro de turmas, ou pelas letras do
// inicio do id (CN2027 -> CN) quando a turma nao esta no cadastro.
export function getCursoSiglaDaTurma(turmaId) {
    const id = String(turmaId || '').trim();
    if (!id) return '';
    const t = (store.rawData?.turmas || []).find((x) => String(x.turma_id) === id);
    if (t?.sigla) return String(t.sigla);
    const prefixo = id.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() || '';
    return (store.rawData?.cursos || []).some((c) => c.sigla === prefixo) ? prefixo : '';
}

// O mesmo nome existe em varios cursos com codigo e CH diferentes (ex.:
// DIDATICA APLICADA A FORMACAO DOCENTE: CB = CBBR005 60h, CN = CNBR004 45h).
// Procura no curso da turma; sem turma, no curso aberto na barra lateral.
export function findComponente(nomeComponente, turmaId = '') {
    const comps = store.rawData?.componentes;
    if (!Array.isArray(comps) || !nomeComponente) return null;
    const sigla = getCursoSiglaDaTurma(turmaId) || store.selectedCurso || '';
    return (sigla && comps.find((x) => x.componente === nomeComponente && x.sigla === sigla)) ||
        comps.find((x) => x.componente === nomeComponente) || null;
}

export function getDisciplinaCHGlobal(disciplina, turmaId) {
    const comp = findComponente(disciplina, turmaId);
    return comp ? (parseInt(comp.ch) || 0) : 0;
}

/**
 * Deriva o bloco curricular automaticamente a partir do turmaId e do período letivo.
 * @param {string} turmaId - Ex: 'EP2026', 'CB2024'
 * @param {string} periodo - 'PL1', 'PL2', 'PL3' ou 'PL4'
 * @param {string} termStart - Data de início do semestre (YYYY-MM-DD), usada para obter o ano de referência
 * Turmas regulares tem bloco em PL2/PL4 (PL2 do ano de entrada = BL1).
 * Turmas de periodos impares (turma.periodos = 'impares', ex.: EP2027C) tem bloco
 * em PL3/PL1: PL3 do ano de entrada = BL1, PL1 do ano seguinte = BL2, e assim por diante.
 * @returns {string} - Ex: 'BL1', 'BL5', ou '' fora dos periodos da turma
 */
export function derivarBloco(turmaId, periodo, termStart) {
    const p = normalizePeriodoLetivoCode(periodo);

    // Ano de entrada vem do cadastro (turma.ano): o id pode ter sufixo (ex.: EP2027C).
    const turmaCad = (store.rawData?.turmas || []).find((t) => String(t.turma_id) === String(turmaId));
    const impares = String(turmaCad?.periodos || '').toLowerCase() === 'impares';
    if (impares ? (p !== 'PL3' && p !== 'PL1') : (p !== 'PL2' && p !== 'PL4')) return '';

    const anoEntrada = parseInt(turmaCad?.ano ?? String(turmaId).match(/\d{4}/)?.[0]);
    const anoRef = parseInt((termStart || String(new Date().getFullYear())).slice(0, 4));
    if (Number.isNaN(anoEntrada) || Number.isNaN(anoRef)) return '';

    const anosDecorridos = anoRef - anoEntrada;
    if (anosDecorridos < 0) return '';

    let numBloco;
    if (impares) numBloco = p === 'PL3' ? 2 * anosDecorridos + 1 : 2 * anosDecorridos;
    else numBloco = p === 'PL2' ? 2 * anosDecorridos + 1 : 2 * anosDecorridos + 2;

    return numBloco > 0 ? `BL${numBloco}` : '';
}

export function getTurmaSelectLabel(turmaId) {
    let base = turmaId;
    if (store.rawData?.turmas) {
        const t = store.rawData.turmas.find(x => String(x.turma_id) === String(turmaId));
        if (t) base = t.turma_label;
    }

    const periodo = normalizePeriodoLetivoCode(store.settings?.periodo || 'PL1');
    const bloco = derivarBloco(turmaId, store.settings?.periodo, store.settings?.termStart);
    const blocoNum = String(bloco || '').match(/^BL(\d+)$/i)?.[1];
    return blocoNum ? (base + '-' + periodo + '-BL.' + blocoNum) : (base + '-' + periodo);
}

export function getTurmaLabel(turmaId, subGrupo) {
    let base = turmaId;
    if (store.rawData?.turmas) {
        const t = store.rawData.turmas.find(x => String(x.turma_id) === String(turmaId));
        if (t) base = t.turma_label;
    }
    // Sub-grupo explícito tem prioridade (ex: BL1_T01 digitado pelo usuário)
    const sg = subGrupo && String(subGrupo).trim()
        ? String(subGrupo).trim()
        : derivarBloco(turmaId, store.settings?.periodo, store.settings?.termStart);

    return sg ? `${base}_${sg}` : base;
}

export function getTurmaBaseLabel(turmaId) {
    if (!turmaId) return '-';
    let base = turmaId;
    if (store.rawData?.turmas) {
        const t = store.rawData.turmas.find(x => String(x.turma_id) === String(turmaId));
        if (t) base = t.turma_label;
    }
    return base;
}

export function getDisciplinaInfo(nomeComponente, turmaId = '') {
    const c = findComponente(nomeComponente, turmaId);
    if (c) return { abrev: c.abreviacao || c.componente, ch: c.ch || 0, codigo: c.codigo || '' };
    return { abrev: nomeComponente, ch: 0, codigo: '' };
}


export function getPeriodoExtenso(periodo) {
    return normalizePeriodoLetivoCode(periodo) || '-';
}

export function getBlocoPpcExtenso(turmaId) {
    const bloco = derivarBloco(turmaId, store.settings?.periodo, store.settings?.termStart);
    const n = String(bloco || '').match(/^BL(\d+)$/i)?.[1];
    return n ? n : '-';
}

export function getPrintAcademicMetaLine(turmaId) {
    const turma = getTurmaBaseLabel(turmaId);
    const periodo = getPeriodoExtenso(store.settings?.periodo);
    const bloco = getBlocoPpcExtenso(turmaId);
    return 'Turma: ' + turma + '; Per\u00edodo: ' + periodo + '; Bloco PPC: ' + bloco;
}
