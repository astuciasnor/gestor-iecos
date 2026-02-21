export function formatDate(dateStr) {
    if(!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}

export function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

export function isDateOverlap(startA, endA, startB, endB) {
    return (startA <= endB) && (endA >= startB);
}

// --- FUNÇÕES DE TEMPO E CONFLITO ---
export function parseTime(timeStr) {
    // "08:00" -> 480 minutes
    if(!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

export function checkTimeConflict(startA, endA, startB, endB) {
    const sA = parseTime(startA);
    const eA = parseTime(endA);
    const sB = parseTime(startB);
    const eB = parseTime(endB);
    return (sA < eB) && (eA > sB);
}

// --- CORE: CORREÇÃO DE DATA ---
export function parseLocalDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
}

export function getDaysArray(start, end) {
    let arr = [];
    let dt = parseLocalDate(start);
    const finalDt = parseLocalDate(end);

    while (dt <= finalDt) {
        arr.push(new Date(dt));
        dt.setDate(dt.getDate() + 1);
    }
    return arr;
}

export function toLocalDateString(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// --- FUNÇÕES DE CONTAGEM ---

/**
 * Conta dias úteis, excluindo finais de semana, feriados E dias bloqueados (Prioritária).
 * ATUALIZAÇÃO: Aceita Sábados através da flag includeSaturdays
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @param {Array} feriados - Lista de objetos ou strings de feriados
 * @param {Array} blockedWeekdays - Array de inteiros (0-6) que devem ser pulados (ex: [1] para pular segundas)
 * @param {boolean} includeSaturdays - Se verdadeiro, contabiliza o sábado como dia útil
 */
export function countBusinessDays(startDate, endDate, feriados = [], blockedWeekdays = [], includeSaturdays = false) {
    let count = 0;
    let curDate = parseLocalDate(startDate);
    const end = parseLocalDate(endDate);
    
    while (curDate <= end) {
        const dayOfWeek = curDate.getDay();
        const dateStr = toLocalDateString(curDate);
        
        // Verifica feriado
        const isHoliday = feriados.some(f => (f.data || f) === dateStr);
        // Verifica bloqueio por dia da semana (Prioritária)
        const isBlocked = blockedWeekdays.includes(dayOfWeek);

        // O Domingo (0) é sempre ignorado. O Sábado (6) depende da caixa de seleção.
        const isWeekend = dayOfWeek === 0 || (dayOfWeek === 6 && !includeSaturdays);

        if (!isWeekend && !isHoliday && !isBlocked) { 
             count++;
        }
        curDate.setDate(curDate.getDate() + 1);
    }
    return count;
}

// ATUALIZAÇÃO: Motor de Simulação passa a enxergar "Dias Suspensos" e não conta
export function countWeekdaysInPeriod(startDate, endDate, targetDayOfWeek, feriados = [], suspendedDates = []) {
    let count = 0;
    let curDate = parseLocalDate(startDate);
    const end = parseLocalDate(endDate);
    
    // Simplificação para Set ganha muita performance
    const feriadosSet = new Set(feriados.map(f => (f.data || f)));
    const suspendedSet = new Set(suspendedDates || []);

    while (curDate <= end) {
        if (curDate.getDay() === parseInt(targetDayOfWeek)) {
            const dateStr = toLocalDateString(curDate);
            // Conta a aula se NÃO for feriado e NÃO estiver suspensa por intensiva
            if (!feriadosSet.has(dateStr) && !suspendedSet.has(dateStr)) {
                count++;
            }
        }
        curDate.setDate(curDate.getDate() + 1);
    }
    return count;
}

// --- NOVA FUNÇÃO: Adiciona dias úteis a uma data ---
// ATUALIZAÇÃO: Aceita Sábados através da flag includeSaturdays
export function addBusinessDays(startDateStr, daysNeeded, feriados = [], blockedWeekdays = [], includeSaturdays = false) {
    let currentDate = new Date(startDateStr + "T12:00:00");
    let daysFound = 0;
    let lastValidDate = new Date(currentDate);

    if (daysNeeded <= 0) return startDateStr;

    while (daysFound < daysNeeded) {
        const dayOfWeek = currentDate.getDay(); // 0=Dom, 6=Sab
        const dateStr = currentDate.toISOString().split('T')[0];
        
        // Verifica feriado (seja string ou objeto)
        const isHoliday = feriados.some(f => (f.data || f) === dateStr);
        
        // Verifica bloqueio por dia da semana (ex: Prioritária na segunda [1])
        const isBlocked = blockedWeekdays.includes(dayOfWeek);

        // O Domingo (0) é sempre ignorado. O Sábado (6) depende da caixa de seleção.
        const isWeekend = dayOfWeek === 0 || (dayOfWeek === 6 && !includeSaturdays);

        if (!isWeekend && !isHoliday && !isBlocked) {
            daysFound++;
            lastValidDate = new Date(currentDate);
        }
        currentDate.setDate(currentDate.getDate() + 1);
    }

    return lastValidDate.toISOString().split('T')[0];
}

// --- NOVA FUNÇÃO: Calcula data fim para aulas regulares modulares com bloqueios ---
export function calculateEndDateByWeekday(startDateStr, classesNeeded, targetDayOfWeek, feriados = [], suspendedDates = []) {
    if (classesNeeded <= 0) return startDateStr;
    
    let currentDate = new Date(startDateStr + "T12:00:00");
    let classesFound = 0;
    let lastValidDate = new Date(currentDate);
    
    const feriadosSet = new Set(feriados.map(f => (f.data || f)));
    const suspendedSet = new Set(suspendedDates || []);

    // Limite de segurança para não rodar infinito caso haja algum erro de dados
    let safetyMax = 400; 
    let loops = 0;

    // MOTOR: Só para de andar pra frente quando bate a meta exata de classesNeeded
    while (classesFound < classesNeeded && loops < safetyMax) {
        if (currentDate.getDay() === parseInt(targetDayOfWeek)) {
            const dateStr = currentDate.toISOString().split('T')[0];
            
            // Só conta se NÃO for feriado e NÃO for suspensa
            if (!feriadosSet.has(dateStr) && !suspendedSet.has(dateStr)) {
                classesFound++;
                lastValidDate = new Date(currentDate);
            }
        }
        currentDate.setDate(currentDate.getDate() + 1);
        loops++;
    }

    return lastValidDate.toISOString().split('T')[0];
}