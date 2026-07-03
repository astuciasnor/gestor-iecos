import { store } from './store.js??v=20260625v';
import { normalizeTurnoKey, getTurnoLetter, mapSlotToTurno } from './turns.js';

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


export function cleanHorarioLabel(s) {
    const str = (s ?? '').toString();
    const m = str.match(/\b\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}\b/);
    if (m) return m[0];
    return str;
}

export function formatIntervaloLabel(s) {
    const str = (s ?? '').toString().trim();
    if (!str) return str;
    if (str.toUpperCase().startsWith('INTERVALO')) {
        return 'Intervalo' + str.slice('INTERVALO'.length);
    }
    if (str.toLowerCase().startsWith('intervalo')) {
        return 'Intervalo' + str.slice('intervalo'.length);
    }
    return str;
}

export function isTurnoDividerSlot(slotLabel = '') {
    const normalized = String(slotLabel || '').trim();
    // Considera apenas o horario de INICIO do slot. Caso contrario, uma faixa como
    // "17:40-18:30" casaria com "18:30" (fim) e desenharia uma divisoria indevida.
    const startMatch = normalized.match(/\d{1,2}:\d{2}/);
    const start = startMatch ? startMatch[0] : '';
    // 10:20 indica o início da aula após o intervalo da manhã (pós-10:00)
    // 13:30 inicia o turno da tarde e 18:30 o da noite
    return start === '10:20' || start === '13:30' || start === '18:30';
}

export function buildHorariosForUI() {
    const horariosRaw = store.getHorariosTurma() || [];
    return horariosRaw
        .map((h) => {
            const s = String(h ?? '');
            if (s.toUpperCase().includes('INTERVALO')) return formatIntervaloLabel(s);
            return cleanHorarioLabel(s);
        })
        .filter((s) => s && s.trim().length > 0);
}

export function getShiftChangeMeta(allocLike = {}, slotLabel = '', dayOfWeek = 0, dateStr = '') {
    const nativeTurnoValue = getNativeTurnoValueForAllocation(allocLike);
    const nativeTurnoNorm = normalizeTurnoOfertaKey(nativeTurnoValue);
    const currentLetter = getTurnoLetter(slotLabel);
    const currentTurnoNorm = getTurnoNormalizedFromLetter(currentLetter);
    const isShiftChange = !!(
        nativeTurnoNorm
        && currentTurnoNorm
        && nativeTurnoNorm !== currentTurnoNorm
    );
    let mappedSlot = slotLabel;
    if (isShiftChange && slotLabel) {
        const normalizedSlotKey = normalizeConflictSlotLabel(slotLabel);
        const actualDateSlots = dateStr
            && allocLike?.executionByDate
            && Array.isArray(allocLike.executionByDate[dateStr])
            ? allocLike.executionByDate[dateStr]
            : [];
        const baseSlots = Array.isArray(allocLike?.horariosBase) && allocLike.horariosBase.length > 0
            ? allocLike.horariosBase
            : [];

        if (baseSlots.length > 0 && actualDateSlots.length > 0) {
            const slotIndex = actualDateSlots.findIndex((entry) => normalizeConflictSlotLabel(entry) === normalizedSlotKey);
            if (slotIndex >= 0) {
                mappedSlot = cleanHorarioLabel(baseSlots[slotIndex] || baseSlots[baseSlots.length - 1] || slotLabel);
            }
        }

        if (mappedSlot === slotLabel) {
            mappedSlot = mapSlotToTurno(
                slotLabel,
                getTurnoValueFromLetter(currentLetter),
                nativeTurnoValue,
                store.getActiveHorariosPorTurno()
            );
        }
    }
    const badgeLabel = isShiftChange ? getShiftChangeLabel(currentLetter) : '';
    const badgeHTML = badgeLabel
        ? `<span style="display:inline-block; font-size:0.65em; background:#e67e22; color:#fff; padding:1px 4px; border-radius:3px; margin-left:2px; font-weight:bold;" title="Mudou de turno: aula no turno ${badgeLabel}">&#9888; ${badgeLabel}</span>`
        : '';

    return {
        nativeTurnoValue,
        nativeTurnoNorm,
        currentLetter,
        currentTurnoNorm,
        isShiftChange,
        mappedSlot,
        badgeLabel,
        badgeHTML
    };
}

export function getCalendarShiftBadgeHTML(allocLike = {}, slotLabel = '', dayOfWeek = 0, dateStr = '') {
    const effectiveSlot = String(
        slotLabel
        || allocLike?.horario
        || (Array.isArray(allocLike?.horariosOcupados) ? allocLike.horariosOcupados[0] : '')
        || ''
    ).trim();

    const shiftMeta = getShiftChangeMeta(allocLike, effectiveSlot, dayOfWeek, dateStr);
    if (shiftMeta.badgeHTML) return shiftMeta.badgeHTML;

    if (!(allocLike?.sabadoManha && dayOfWeek === 6)) return '';

    const fallbackLetter = getTurnoLetter(effectiveSlot);
    const fallbackLabel = getShiftChangeLabel(fallbackLetter);
    if (!fallbackLabel) return '';

    // Só é mudança de turno se o turno da aula de sábado difere do turno nativo da turma.
    // Turmas cujo turno padrão já é o mesmo (ex.: turma de Manhã com sábado de manhã) não recebem badge.
    const fallbackTurnoNorm = getTurnoNormalizedFromLetter(fallbackLetter);
    const nativeTurnoNorm = normalizeTurnoOfertaKey(getNativeTurnoValueForAllocation(allocLike));
    if (fallbackTurnoNorm && nativeTurnoNorm && fallbackTurnoNorm === nativeTurnoNorm) return '';

    return `<span style="display:inline-block; font-size:0.65em; background:#e67e22; color:#fff; padding:1px 4px; border-radius:3px; margin-left:2px; font-weight:bold;" title="Mudou de turno: aula no turno ${fallbackLabel}">&#9888; ${fallbackLabel}</span>`;
}
