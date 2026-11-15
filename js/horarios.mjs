// Horarios e dias da semana das aulas. Funcoes puras (sem tela), usadas pelo
// calendario (js/calendar.js), pelo motor de datas (js/execution_engine.js) e
// pelos testes (tests/datas_horarios.test.mjs).
// Dias: 1 = segunda ... 6 = sabado. Horario: texto como "14:00 - 14:50".

// "14:00 - 14:50" -> 840 (minutos do dia); sem hora vai para o fim da lista.
export function timeToMinutesSafe(value) {
    const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
    if (!match) return Number.MAX_SAFE_INTEGER;
    return (Number.parseInt(match[1], 10) * 60) + Number.parseInt(match[2], 10);
}

// Dias da semana validos (1..6), sem repeticao, em ordem.
export function normalizeDayList(days = []) {
    return [...new Set((Array.isArray(days) ? days : [])
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => value >= 1 && value <= 6))]
        .sort((left, right) => left - right);
}

// Horarios sem espacos nas pontas, sem repeticao, em ordem de hora.
export function normalizeSlotList(slots = []) {
    return [...new Set((Array.isArray(slots) ? slots : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean))]
        .sort((left, right) => timeToMinutesSafe(left) - timeToMinutesSafe(right));
}

// { dia: [horarios] } so com dias 1..6 que tenham horario.
export function normalizeDrawnSlotsByDay(raw = {}) {
    const normalized = {};

    Object.entries(raw || {}).forEach(([day, slots]) => {
        const dayNumber = Number.parseInt(day, 10);
        if (dayNumber < 1 || dayNumber > 6) return;
        const normalizedSlots = normalizeSlotList(slots);
        if (normalizedSlots.length > 0) normalized[dayNumber] = normalizedSlots;
    });

    return normalized;
}

// Os mesmos horarios em cada um dos dias: { dia: [horarios] }.
export function buildDrawnSlotsByDay(days = [], slots = []) {
    const map = {};
    const normalizedDays = normalizeDayList(days);
    const normalizedSlots = normalizeSlotList(slots);

    normalizedDays.forEach((day) => {
        map[day] = normalizedSlots.slice();
    });

    return map;
}

// Rotulo do horario para comparar: um espaco so e " - " entre as horas.
export function normalizeConflictSlotLabel(value = '') {
    return String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/\s*[-–]\s*/g, ' - ');
}
