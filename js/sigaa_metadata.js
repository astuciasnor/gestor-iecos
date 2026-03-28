import { buildSigaaExportPayload, filterExportableAllocations } from './academic_rules.mjs';
import { buildCanonicalOfferProjection } from './execution_engine.js';
import { inferAllocationModo } from './allocation_mode.mjs';

export function buildSigaaOfertaBase(allocation, info = {}) {
    return {
        componente: allocation?.disciplina || '',
        codigo: info.codigo || '',
        modo: inferAllocationModo(allocation),
        cargaHoraria: allocation?.ch || info.ch || 0,
        docente: allocation?.docente || '',
        subGrupo: allocation?.subGrupo || ''
    };
}

export function buildSigaaHorarioResumo(faixas = [], formatDateBRFn) {
    return (Array.isArray(faixas) ? faixas : [])
        .map((faixa) => `${faixa.sigaa} (${formatDateBRFn(faixa.inicio)} - ${formatDateBRFn(faixa.fim)})`)
        .join(', ');
}

function buildFallbackOfferFaixas(offerGroup, planContext) {
    const drawnSlotsByDay = offerGroup?.timeRangesByDay || {};
    const dias = Object.keys(drawnSlotsByDay)
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => value >= 1 && value <= 6)
        .sort((left, right) => left - right);
    const slots = [...new Set(Object.values(drawnSlotsByDay).flat().map(String).filter(Boolean))];
    const inicio = offerGroup?.start || offerGroup?.baseAlloc?.dataInicio || planContext.termStart || '';
    const fim = offerGroup?.end || offerGroup?.baseAlloc?.dataFim || planContext.termEnd || inicio;

    if (!inicio) return [];
    return [{
        faixaId: `${offerGroup?.offerKey || 'offer'}|1`,
        index: 1,
        inicio,
        fim: fim || inicio,
        dias,
        slots,
        drawnSlotsByDay
    }];
}

function getCanonicalOfferFaixas(offerGroup, planContext) {
    if (Array.isArray(offerGroup?.faixas) && offerGroup.faixas.length > 0) return offerGroup.faixas;
    return buildFallbackOfferFaixas(offerGroup, planContext);
}

export function buildSigaaOferta(offerGroup, planContext, contextMap) {
    const { getDisciplinaInfo, getSigaaCode, buildScopedSigaaAllocationFromOfferFaixa } = contextMap;
    const allocs = Array.isArray(offerGroup?.allocations) ? offerGroup.allocations : [];
    const base = offerGroup?.baseAlloc || allocs[0];
    if (!base) return null;

    const info = getDisciplinaInfo(base.disciplina);
    const faixas = getCanonicalOfferFaixas(offerGroup, planContext).map((faixa) => {
        const scoped = typeof buildScopedSigaaAllocationFromOfferFaixa === 'function'
            ? buildScopedSigaaAllocationFromOfferFaixa(offerGroup, faixa, planContext)
            : null;

        return {
            inicio: faixa?.inicio || offerGroup?.start || base.dataInicio || planContext.termStart,
            fim: faixa?.fim || offerGroup?.end || base.dataFim || planContext.termEnd,
            sigaa: scoped ? getSigaaCode([scoped]) : '-'
        };
    });

    return {
        ...buildSigaaOfertaBase(base, info),
        docente: offerGroup?.docenteLabel || base.docente || '',
        subGrupo: offerGroup?.subGrupo || base.subGrupo || '',
        horarioSigaa: buildSigaaHorarioResumo(faixas, contextMap.formatDateBR),
        faixas
    };
}

export function validateSigaaMetadataPayload(payload) {
    const issues = [];
    if (!payload || typeof payload !== 'object') return ['Payload invalido para exportacao SIGAA.'];
    if (!payload.turmaId) issues.push('Turma ausente no payload SIGAA.');
    if (!payload.periodoLetivo) issues.push('Periodo letivo ausente no payload SIGAA.');
    if (!payload.termStart || !payload.termEnd) issues.push('Intervalo do plano letivo ausente no payload SIGAA.');
    if (payload.termStart && payload.termEnd && payload.termStart > payload.termEnd) {
        issues.push('Intervalo do plano letivo invalido no payload SIGAA.');
    }
    if (!Array.isArray(payload.ofertas)) issues.push('Ofertas ausentes no payload SIGAA.');
    else if (!payload.ofertas.length) issues.push('Nenhuma oferta encontrada para exportar ao SIGAA.');
    return issues;
}

export function buildSigaaMetadataPayload(dataContext, contextMap) {
    const { store, planContext, turmaId } = dataContext;
    
    if (!turmaId) return null;

    const list = filterExportableAllocations(
        store.allocations.filter((alloc) => String(alloc.turmaId) === String(turmaId))
    );
    const offerProjection = dataContext.offerProjection || buildCanonicalOfferProjection({
        allocations: list,
        startDate: planContext.termStart,
        endDate: planContext.termEnd
    });

    const ofertas = [];
    offerProjection.offerGroups.forEach((offerGroup) => {
        const oferta = buildSigaaOferta(offerGroup, planContext, contextMap);
        if (oferta) ofertas.push(oferta);
    });

    let turmaLabel = turmaId;
    if (store.rawData?.turmas) {
        const turma = store.rawData.turmas.find((entry) => String(entry.turma_id) === String(turmaId));
        if (turma?.turma_label) turmaLabel = turma.turma_label;
    }

    return buildSigaaExportPayload({
        generatedAt: new Date().toISOString(),
        plan: planContext.plan,
        cursoSigla: store.selectedCurso || '',
        turmaId: String(turmaId),
        turmaLabel,
        periodoLetivo: planContext.periodoLetivo,
        termStart: planContext.termStart,
        termEnd: planContext.termEnd,
        ofertas
    });
}
