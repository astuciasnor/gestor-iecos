import { store } from './store.js??v=20260625v';
import { normalizeTurnoKey } from './turns.js';

export function normalizeConflictSlotLabel(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/\s*[-–]\s*/g, ' - ');
}

export function normalizeTurnoOfertaKey(value) {
    return normalizeTurnoKey(value);
}

export function formatTurnoOfertaLabel(value) {
    const normalized = normalizeTurnoOfertaKey(value);
    if (normalized === 'manha') return 'Manhã';
    if (normalized === 'tarde') return 'Tarde';
    if (normalized === 'noite') return 'Noite';
    if (normalized === 'manha_tarde') return 'Manhã e Tarde';
    if (normalized === 'tarde_noite') return 'Tarde e Noite';
    if (normalized === 'manha_noite') return 'Manhã e Noite';
    if (normalized === 'integral') return 'Integral (M+T+N)';
    return String(value || '').trim() || 'Turno';
}

export function getAvailableTurnoOfertaOptions() {
    const byTurnoMap = store.getActiveHorariosPorTurno();
    if (byTurnoMap && typeof byTurnoMap === 'object') {
        const options = Object.keys(byTurnoMap)
            .filter((key) => Array.isArray(byTurnoMap[key]) && byTurnoMap[key].length > 0)
            .map((value) => ({
                value,
                label: formatTurnoOfertaLabel(value),
                normalized: normalizeTurnoOfertaKey(value)
            }));

        // Adiciona turnos combinados para apoiar estágios e demandas multi-turno (ex: Eng. Pesca)
        if (options.some(o => o.normalized === 'manha') && options.some(o => o.normalized === 'tarde')) {
            options.push({ value: 'Manhã+Tarde', label: 'Manhã e Tarde', normalized: 'manha_tarde' });
        }
        if (options.some(o => o.normalized === 'tarde') && options.some(o => o.normalized === 'noite')) {
            options.push({ value: 'Tarde+Noite', label: 'Tarde e Noite', normalized: 'tarde_noite' });
        }
        if (options.some(o => o.normalized === 'manha') && options.some(o => o.normalized === 'noite')) {
            options.push({ value: 'Manhã+Noite', label: 'Manhã e Noite', normalized: 'manha_noite' });
        }
        if (options.length > 2) {
            options.push({ value: 'Integral', label: 'Integral (M+T+N)', normalized: 'integral' });
        }

        if (options.length > 0) {
            const deduped = [];
            const seen = new Set();
            options.forEach((option) => {
                if (seen.has(option.normalized)) return;
                seen.add(option.normalized);
                deduped.push(option);
            });
            const order = { manha: 1, tarde: 2, noite: 3, manha_tarde: 4, tarde_noite: 5, manha_noite: 6, integral: 7 };
            return deduped.sort((a, b) => {
                const orderA = order[a.normalized] || 99;
                const orderB = order[b.normalized] || 99;
                if (orderA !== orderB) return orderA - orderB;
                return a.label.localeCompare(b.label, 'pt-BR');
            });
        }
    }

    return ['Manhã', 'Tarde', 'Noite'].map((value) => ({
        value,
        label: value,
        normalized: normalizeTurnoOfertaKey(value)
    }));
}

export function resolveTurnoOfertaValue(preferredValue = '') {
    const options = getAvailableTurnoOfertaOptions();
    const normalizedPreferred = normalizeTurnoOfertaKey(preferredValue);
    const matched = options.find((option) => option.normalized === normalizedPreferred);
    return matched?.value || preferredValue || options[0]?.value || '';
}

export function getTurnoNormalizedFromLetter(letter = '') {
    if (letter === 'M') return 'manha';
    if (letter === 'T') return 'tarde';
    if (letter === 'N') return 'noite';
    return '';
}

export function getTurnoValueFromLetter(letter = '') {
    if (letter === 'M') return resolveTurnoOfertaValue('Manha');
    if (letter === 'T') return resolveTurnoOfertaValue('Tarde');
    if (letter === 'N') return resolveTurnoOfertaValue('Noite');
    return '';
}

export function getShiftChangeLabel(letter = '') {
    if (letter === 'M') return 'Manhã';
    if (letter === 'T') return 'Tarde';
    if (letter === 'N') return 'Noite';
    return '';
}

export function getNativeTurnoValueForAllocation(allocLike = {}) {
    return store.rawData?.turmas?.find((turma) => String(turma?.turma_id) === String(allocLike?.turmaId))?.turno
        || allocLike?.turno
        || 'Tarde';
}
