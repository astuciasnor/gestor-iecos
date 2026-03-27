import { store } from './store.js';
import { getCalendarEvents } from './calendar.js';

export function getUnifiedExecutionSnapshot(turmaId, termStart, termEnd) {
    const datesByAlloc = new Map();
    const allocs = store.allocations.filter(a => String(a.turmaId) === String(turmaId));

    allocs.forEach(a => datesByAlloc.set(a.id, new Set()));

    const calendarData = getCalendarEvents(turmaId, termStart, termEnd, null);

    Object.entries(calendarData).forEach(([dateStr, events]) => {
        if (!Array.isArray(events)) return;
        events.forEach(ev => {
            if (ev.id && datesByAlloc.has(ev.id) && ev.type !== 'holiday') {
                datesByAlloc.get(ev.id).add(dateStr);
            }
        });
    });

    return {
        datesByAlloc
    };
}

export function getAllocationExecutionRangeMap() {
    return new Map();
}

export function getUnifiedSignatureRangeMap() {
    return new Map();
}

export function buildUnifiedExecutionSignature() {
    return '';
}
