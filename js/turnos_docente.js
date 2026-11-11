// Turnos (Manha, Tarde, Noite) do quadro de horarios ativo, para o calendario
// do docente saber em que turno cai cada aula. Sobrou do antigo Gantt do
// docente (gantt_ui.js), que saiu do app junto com a sub-aba Gantt em 07/11/2026.
import { store } from './store.js?v=202611102308';
import { timeToMinutes } from './date_utils_ui.js?v=202611102308';
import {
    normalizeConflictSlotLabel,
    getAvailableTurnoOfertaOptions,
    getGanttTurnoCode
} from './turno_helpers.js?v=202611102308';

export function resolveTeacherShiftForSlot(slot) {
    const config = resolveGanttTurnoForSlot(slot, getGanttTurnoConfigs());
    return config?.value || '';
}

export function getGanttTurnoConfigs() {
    const hp = store.getActiveHorariosPorTurno();
    return getAvailableTurnoOfertaOptions().map((option) => {
        const rawSlots = Array.isArray(hp?.[option.value]) ? hp[option.value] : [];
        const normalizedSlots = rawSlots
            .filter((slot) => !String(slot || '').toUpperCase().includes('INTERVALO'))
            .map((slot) => normalizeConflictSlotLabel(slot))
            .filter(Boolean);
        const timeEntries = normalizedSlots
            .map((slot) => {
                const match = String(slot).match(/\d{1,2}:\d{2}/);
                return match ? match[0] : '';
            })
            .filter(Boolean);
        const minuteEntries = timeEntries
            .map((time) => timeToMinutes(time))
            .filter((mins) => Number.isFinite(mins) && mins < 99999)
            .sort((a, b) => a - b);

        return {
            value: option.value,
            label: option.label,
            normalized: option.normalized,
            shortCode: getGanttTurnoCode(option.value),
            slotSet: new Set(normalizedSlots),
            timeSet: new Set(timeEntries),
            minMinutes: minuteEntries.length ? minuteEntries[0] : null,
            maxMinutes: minuteEntries.length ? minuteEntries[minuteEntries.length - 1] : null
        };
    });
}

export function resolveGanttTurnoForSlot(slot, turnoConfigs = getGanttTurnoConfigs()) {
    const normalizedSlot = normalizeConflictSlotLabel(slot);
    if (!normalizedSlot) return null;

    const timeMatch = normalizedSlot.match(/\d{1,2}:\d{2}/);
    const firstTime = timeMatch ? timeMatch[0] : '';

    const exact = turnoConfigs.find((config) =>
        config.slotSet.has(normalizedSlot) || (firstTime && config.timeSet.has(firstTime))
    );
    if (exact) return exact;

    const mins = timeToMinutes(normalizedSlot);
    if (!Number.isFinite(mins) || mins >= 99999) return null;

    return turnoConfigs.find((config) =>
        Number.isFinite(config.minMinutes)
        && Number.isFinite(config.maxMinutes)
        && mins >= (config.minMinutes - 10)
        && mins <= (config.maxMinutes + 50)
    ) || null;
}
