import { getCalendarEvents } from './calendar.js';

/**
 * Módulo de Execução Acadêmica (Engine)
 * Centraliza o cálculo de snapshots, horas alocadas e regras de negócio de alocação.
 */

export function getAllocationTipo(alloc) {
    return String(alloc?.tipo || '').trim().toLowerCase();
}

export function isFaixaAllocation(alloc) {
    return getAllocationTipo(alloc) === 'intensiva';
}

export function isPriorityRegularAllocation(alloc) {
    return getAllocationTipo(alloc) === 'regular_prioritaria';
}

export function isRegularAllocation(alloc) {
    return getAllocationTipo(alloc) === 'regular';
}

export function isScheduledRegularAllocation(alloc) {
    return isRegularAllocation(alloc) || isPriorityRegularAllocation(alloc);
}

export function isPendingAllocation(alloc) {
    return getAllocationTipo(alloc) === 'pendente';
}

export function getUnifiedExecutionSnapshot(turmaId, startDate, endDate) {
    const hoursByAlloc = new Map();
    const datesByAlloc = new Map();
    const dateHoursByAlloc = new Map();
    if (!turmaId || !startDate || !endDate) {
        return { hoursByAlloc, datesByAlloc, dateHoursByAlloc };
    }

    const eventsByDate = getCalendarEvents(turmaId, startDate, endDate);
    Object.keys(eventsByDate).forEach((dateStr) => {
        const events = eventsByDate[dateStr] || [];
        events.forEach((e) => {
            if (isPendingAllocation(e)) return; // Ignora apenas os pendentes
            if (e.id === undefined || e.id === null) return;

            const id = e.id;
            
            // Computa totais (estilo Regular)
            hoursByAlloc.set(id, (hoursByAlloc.get(id) || 0) + 1);
            if (!datesByAlloc.has(id)) datesByAlloc.set(id, new Set());
            datesByAlloc.get(id).add(dateStr);

            // Computa por data (estilo Intensiva)
            if (!dateHoursByAlloc.has(id)) dateHoursByAlloc.set(id, new Map());
            const byDate = dateHoursByAlloc.get(id);
            byDate.set(dateStr, (byDate.get(dateStr) || 0) + 1);
        });
    });

    return { hoursByAlloc, datesByAlloc, dateHoursByAlloc };
}

export function getAllocationExecutionRangeMap(allocations, startDate, endDate) {
    const rangeByAlloc = new Map();
    if (!Array.isArray(allocations) || allocations.length === 0 || !startDate || !endDate) {
        return rangeByAlloc;
    }

    const allocIds = new Set(
        allocations
            .map((a) => a?.id)
            .filter((id) => id !== undefined && id !== null)
    );
    if (allocIds.size === 0) return rangeByAlloc;

    const turmaIds = [...new Set(
        allocations
            .map((a) => String(a?.turmaId || '').trim())
            .filter(Boolean)
    )];

    turmaIds.forEach((turmaId) => {
        const eventsByDate = getCalendarEvents(turmaId, startDate, endDate);
        Object.keys(eventsByDate).forEach((dateStr) => {
            const events = eventsByDate[dateStr] || [];
            events.forEach((event) => {
                const id = event?.id;
                if (!allocIds.has(id)) return;

                const current = rangeByAlloc.get(id);
                if (!current) {
                    rangeByAlloc.set(id, { firstDate: dateStr, lastDate: dateStr });
                    return;
                }

                if (dateStr < current.firstDate) current.firstDate = dateStr;
                if (dateStr > current.lastDate) current.lastDate = dateStr;
            });
        });
    });

    return rangeByAlloc;
}

export function buildUnifiedExecutionSignature(entry) {
    if (!entry) return '';
    if (isPendingAllocation(entry)) return '';

    const turmaId = String(entry.turmaId || '').trim();
    const disciplina = String(entry.disciplina || '').trim();
    const subGrupo = String(entry.subGrupo || '').trim();
    const diaSemana = String(parseInt(entry.diaSemana, 10));
    const horario = String(entry.horario || '').trim();

    if (!turmaId || !disciplina || !horario || diaSemana === 'NaN') return '';
    return [turmaId, disciplina, subGrupo, diaSemana, horario].join('|');
}

export function getUnifiedSignatureRangeMap(allocations, startDate, endDate) {
    const rangeBySignature = new Map();
    if (!Array.isArray(allocations) || allocations.length === 0 || !startDate || !endDate) {
        return rangeBySignature;
    }

    const signatures = new Set(
        allocations
            .map((a) => buildUnifiedExecutionSignature(a))
            .filter(Boolean)
    );
    if (signatures.size === 0) return rangeBySignature;

    const turmaIds = [...new Set(
        allocations
            .map((a) => String(a?.turmaId || '').trim())
            .filter(Boolean)
    )];

    turmaIds.forEach((turmaId) => {
        const eventsByDate = getCalendarEvents(turmaId, startDate, endDate);
        Object.keys(eventsByDate).forEach((dateStr) => {
            const events = eventsByDate[dateStr] || [];
            events.forEach((event) => {
                const signature = buildUnifiedExecutionSignature(event);
                if (!signatures.has(signature)) return;

                const current = rangeBySignature.get(signature);
                if (!current) {
                    rangeBySignature.set(signature, { firstDate: dateStr, lastDate: dateStr });
                    return;
                }

                if (dateStr < current.firstDate) current.firstDate = dateStr;
                if (dateStr > current.lastDate) current.lastDate = dateStr;
            });
        });
    });

    return rangeBySignature;
}
