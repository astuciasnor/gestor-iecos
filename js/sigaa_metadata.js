import { buildSigaaExportPayload, filterExportableAllocations } from './academic_rules.mjs';

export function buildSigaaOfertaBase(allocation, info = {}) {
    return {
        componente: allocation?.disciplina || '',
        codigo: info.codigo || '',
        modo: allocation?.modo || '',
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

export function buildSigaaRegularOferta(allocs, unifiedExec, planContext, contextMap) {
    const { getDisciplinaInfo, getSigaaCode } = contextMap;
    const base = allocs[0];
    const info = getDisciplinaInfo(base.disciplina);
    const activeDates = new Set();

    allocs.forEach((alloc) => {
        const datesSet = unifiedExec.datesByAlloc.get(alloc.id);
        if (datesSet && datesSet.size > 0) datesSet.forEach((dateStr) => activeDates.add(dateStr));
    });

    let faixas = [];
    if (activeDates.size > 0) {
        const orderedDates = [...activeDates].sort();
        faixas = [{
            inicio: orderedDates[0],
            fim: orderedDates[orderedDates.length - 1],
            sigaa: getSigaaCode(allocs)
        }];
    } else {
        const byInterval = new Map();
        allocs.forEach((alloc) => {
            const start = alloc.dataInicio || planContext.termStart;
            const end = alloc.dataFim || planContext.termEnd;
            const intervalKey = `${start}|${end}`;
            if (!byInterval.has(intervalKey)) byInterval.set(intervalKey, []);
            byInterval.get(intervalKey).push(alloc);
        });

        byInterval.forEach((slice, intervalKey) => {
            const [start, end] = intervalKey.split('|');
            faixas.push({
                inicio: start,
                fim: end,
                sigaa: getSigaaCode(slice)
            });
        });
    }

    return {
        ...buildSigaaOfertaBase(base, info),
        horarioSigaa: buildSigaaHorarioResumo(faixas, contextMap.formatDateBR),
        faixas
    };
}

export function buildSigaaFaixaOferta(allocation, planContext, contextMap) {
    const { getDisciplinaInfo, getSigaaCode, getNormalizedIntensiveFaixas, alignFaixasToExecutionEnd } = contextMap;
    const info = getDisciplinaInfo(allocation.disciplina);
    const normalizedFaixas = alignFaixasToExecutionEnd(getNormalizedIntensiveFaixas(allocation), allocation.dataFim || planContext.termEnd);
    const fallbackDias = Array.isArray(allocation.diasMarcados) && allocation.diasMarcados.length > 0
        ? allocation.diasMarcados
        : (allocation.usaSabado ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5]);
    const fallbackSlots = Array.isArray(allocation.horariosOcupados) ? allocation.horariosOcupados : [];

    const faixas = (normalizedFaixas.length > 0 ? normalizedFaixas : [{
        inicio: allocation.dataInicio || planContext.termStart,
        fim: allocation.dataFim || planContext.termEnd,
        dias: fallbackDias,
        slots: fallbackSlots
    }]).map((faixa) => {
        const scoped = {
            ...allocation,
            ch: 0,
            dataInicio: faixa.inicio || allocation.dataInicio || planContext.termStart,
            dataFim: faixa.fim || allocation.dataFim || planContext.termEnd,
            diasMarcados: faixa.dias || fallbackDias,
            horariosOcupados: faixa.slots || fallbackSlots,
            usaSabado: (faixa.dias || fallbackDias).includes(6),
            faixas: [faixa]
        };

        return {
            inicio: scoped.dataInicio,
            fim: scoped.dataFim,
            sigaa: getSigaaCode([scoped])
        };
    });

    return {
        ...buildSigaaOfertaBase(allocation, info),
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
    const { store, planContext, turmaId, unifiedExec } = dataContext;
    const { isScheduledRegularAllocation, isFaixaAllocation } = contextMap;
    
    if (!turmaId) return null;

    const list = filterExportableAllocations(
        store.allocations.filter((alloc) => String(alloc.turmaId) === String(turmaId))
    );
    const scheduledRegulars = list.filter((alloc) => isScheduledRegularAllocation(alloc));
    const faixaAllocations = list.filter((alloc) => isFaixaAllocation(alloc));
    const regularGroups = new Map();

    scheduledRegulars.forEach((alloc) => {
        const key = [alloc.disciplina, alloc.docente, alloc.modo, alloc.subGrupo || ''].join('|');
        if (!regularGroups.has(key)) regularGroups.set(key, []);
        regularGroups.get(key).push(alloc);
    });

    const ofertas = [];
    regularGroups.forEach((allocs) => {
        ofertas.push(buildSigaaRegularOferta(allocs, unifiedExec, planContext, contextMap));
    });
    faixaAllocations.forEach((alloc) => {
        ofertas.push(buildSigaaFaixaOferta(alloc, planContext, contextMap));
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
