import { buildSigaaExportPayload, filterExportableAllocations } from './academic_rules.mjs?v=202611102335';
import { buildCanonicalOfferProjection } from './execution_engine.js?v=202611102335';
import { store } from './store.js?v=202611102335';
import { timeToMinutes } from './date_utils_ui.js?v=202611102335';
import { isFaixaAllocation, isScheduledRegularAllocation } from './allocation_helpers.js?v=202611102335';
import { cleanHorarioLabel, getGanttTurnoCode } from './turno_helpers.js?v=202611102335';
import { computeIntensiveExecution } from './faixa_utils.js?v=202611102335';

// Codigo de horario SIGAA (ex.: 246T12) de uma oferta. Saiu do ui.js em 05/11/2026.

export function buildScopedSigaaAllocationFromOfferFaixa(offerGroup, faixa, planContext = {}) {
    const base = offerGroup?.baseAlloc || (Array.isArray(offerGroup?.allocations) ? offerGroup.allocations[0] : null) || {};
    const rawDrawnSlotsByDay = faixa?.drawnSlotsByDay || offerGroup?.timeRangesByDay || {};
    const dias = [...new Set(
        (Array.isArray(faixa?.dias) ? faixa.dias : Object.keys(rawDrawnSlotsByDay))
            .map((value) => Number.parseInt(value, 10))
            .filter((value) => value >= 1 && value <= 6)
    )].sort((left, right) => left - right);
    const slots = [...new Set(
        (Array.isArray(faixa?.slots) && faixa.slots.length > 0 ? faixa.slots : Object.values(rawDrawnSlotsByDay).flat())
            .map((value) => String(value || '').trim())
            .filter(Boolean)
    )].sort((left, right) => timeToMinutes(left) - timeToMinutes(right));
    const drawnSlotsByDay = {};

    dias.forEach((day) => {
        const daySlots = Array.isArray(rawDrawnSlotsByDay?.[day]) && rawDrawnSlotsByDay[day].length > 0
            ? rawDrawnSlotsByDay[day]
            : slots;
        drawnSlotsByDay[day] = [...new Set(daySlots.map((value) => String(value || '').trim()).filter(Boolean))]
            .sort((left, right) => timeToMinutes(left) - timeToMinutes(right));
    });

    const inicio = String(faixa?.inicio || offerGroup?.start || base?.dataInicio || planContext.termStart || '').trim();
    const fim = String(faixa?.fim || offerGroup?.end || base?.dataFim || planContext.termEnd || inicio || '').trim();

    return {
        ...base,
        modo: 'faixas',
        ch: 0,
        dataInicio: inicio,
        dataFim: fim,
        diasMarcados: dias,
        horariosOcupados: slots,
        usaSabado: dias.includes(6),
        faixas: [{
            inicio,
            fim,
            dias,
            slots,
            drawnSlotsByDay
        }]
    };
}

export function getSigaaCode(allocsForClass) {
    function buildSigaaSlotsMap() {
        // Usa os numeros SIGAA explicitos do regime ativo (coluna `sigaa` da planilha).
        // O 4o horario (intervalo) nao tem numero e e ignorado.
        const entries = (typeof store.getActiveSigaaSlots === 'function') ? store.getActiveSigaaSlots() : [];
        const dynamicSlots = [];

        entries.forEach((entry) => {
            const shiftCode = getGanttTurnoCode(entry.turno);
            if (!['M', 'T', 'N'].includes(shiftCode)) return;
            const sigaaNum = parseInt(entry.sigaa, 10);
            if (!Number.isFinite(sigaaNum) || sigaaNum <= 0) return;
            const rawLabel = String(entry.faixa || '');
            if (!rawLabel || rawLabel.toUpperCase().includes('INTERVALO')) return;
            const startMinutes = timeToMinutes(cleanHorarioLabel(rawLabel));
            if (!Number.isFinite(startMinutes) || startMinutes >= 99999) return;
            dynamicSlots.push({ m: startMinutes, s: shiftCode, sl: sigaaNum });
        });

        if (dynamicSlots.length > 0) {
            return dynamicSlots.sort((a, b) => (a.m - b.m) || a.s.localeCompare(b.s) || (a.sl - b.sl));
        }

        return [
            { m: 450, s: 'M', sl: 1 }, { m: 500, s: 'M', sl: 2 }, { m: 550, s: 'M', sl: 3 },
            { m: 620, s: 'M', sl: 4 }, { m: 670, s: 'M', sl: 5 }, { m: 720, s: 'M', sl: 6 },
            { m: 810, s: 'T', sl: 1 }, { m: 860, s: 'T', sl: 2 }, { m: 910, s: 'T', sl: 3 },
            { m: 980, s: 'T', sl: 4 }, { m: 1030, s: 'T', sl: 5 }, { m: 1080, s: 'T', sl: 6 },
            { m: 1110, s: 'N', sl: 1 }, { m: 1160, s: 'N', sl: 2 }, { m: 1210, s: 'N', sl: 3 }, { m: 1260, s: 'N', sl: 4 }
        ];
    }

    const slotsMap = buildSigaaSlotsMap();

    function getSlot(horario) {
        if (!horario) return null;
        const min = timeToMinutes(horario);
        for (let i = slotsMap.length - 1; i >= 0; i--) {
            if (min >= slotsMap[i].m - 10 && min <= slotsMap[i].m + 40) return slotsMap[i];
        }
        return null;
    }

    const slotsList = [];
    allocsForClass.forEach(a => {
        if (isScheduledRegularAllocation(a)) {
            const dSigaa = parseInt(a.diaSemana) + 1;
            const sInfo = getSlot(a.horario);
            if (sInfo) slotsList.push({ day: dSigaa, shift: sInfo.s, slot: sInfo.sl });
        } else if (isFaixaAllocation(a)) {
            const execution = computeIntensiveExecution(a, { respectPriority: true, respectTurmaOccupancy: true });
            const byDate = execution.byDate || {};
            Object.keys(byDate).sort().forEach((dStr) => {
                const dSigaa = new Date(dStr + "T12:00:00").getDay() + 1;
                (byDate[dStr] || []).forEach((h) => {
                    const sInfo = getSlot(h);
                    if (sInfo) slotsList.push({ day: dSigaa, shift: sInfo.s, slot: sInfo.sl });
                });
            });
        }
    });

    if (slotsList.length === 0) return '-';

    const unique = [];
    const seen = new Set();
    slotsList.forEach(s => {
        const key = `${s.day}-${s.shift}-${s.slot}`;
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(s);
        }
    });

    const dayShiftMap = {};
    unique.forEach(s => {
        const k = `${s.day}${s.shift}`;
        if (!dayShiftMap[k]) dayShiftMap[k] = [];
        dayShiftMap[k].push(s.slot);
    });

    const shiftSlotsMap = {};
    for (const k in dayShiftMap) {
        dayShiftMap[k].sort((a, b) => a - b);
        const day = k.charAt(0);
        const shift = k.charAt(1);
        const slotsStr = dayShiftMap[k].join('');
        const comboKey = `${shift}${slotsStr}`;
        if (!shiftSlotsMap[comboKey]) shiftSlotsMap[comboKey] = [];
        shiftSlotsMap[comboKey].push(day);
    }

    const parts = [];
    for (const combo in shiftSlotsMap) {
        const shift = combo.charAt(0);
        const slotsStr = combo.substring(1);
        const daysStr = shiftSlotsMap[combo].sort().join('');
        parts.push(`${daysStr}${shift}${slotsStr}`);
    }

    parts.sort();
    return parts.join(' ');
}

export function buildSigaaOfertaBase(allocation, info = {}) {
    return {
        componente: allocation?.disciplina || '',
        codigo: info.codigo || '',
        cargaHoraria: allocation?.ch || info.ch || 0,
        docente: allocation?.docente || ''
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
    const { getDisciplinaInfo } = contextMap;
    const allocs = Array.isArray(offerGroup?.allocations) ? offerGroup.allocations : [];
    const base = offerGroup?.baseAlloc || allocs[0];
    if (!base) return null;

    const info = getDisciplinaInfo(base.disciplina, base.turmaId);
    const faixas = getCanonicalOfferFaixas(offerGroup, planContext).map((faixa) => {
        const scoped = buildScopedSigaaAllocationFromOfferFaixa(offerGroup, faixa, planContext);

        return {
            inicio: faixa?.inicio || offerGroup?.start || base.dataInicio || planContext.termStart,
            fim: faixa?.fim || offerGroup?.end || base.dataFim || planContext.termEnd,
            sigaa: scoped ? getSigaaCode([scoped]) : '-'
        };
    });

    return {
        ...buildSigaaOfertaBase(base, info),
        docente: offerGroup?.docenteLabel || base.docente || '',
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
        cursoSigla: store.selectedCurso || '',
        turmaId: String(turmaId),
        turmaLabel,
        periodoLetivo: planContext.periodoLetivo,
        termStart: planContext.termStart,
        termEnd: planContext.termEnd,
        ofertas
    });
}
