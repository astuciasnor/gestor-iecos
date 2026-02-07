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
// Transforma string "YYYY-MM-DD" em Objeto Date Local 00:00:00
export function parseLocalDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
}

// Retorna array de datas garantindo hora local
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

// Formata Date -> "YYYY-MM-DD" Local
export function toLocalDateString(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// --- FUNÇÕES DE CONTAGEM ---

// Conta dias úteis (Seg-Sex), IGNORANDO Sábado (6) e Domingo (0)
export function countBusinessDays(startDate, endDate) {
    let count = 0;
    let curDate = parseLocalDate(startDate);
    const end = parseLocalDate(endDate);
    
    while (curDate <= end) {
        const dayOfWeek = curDate.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) { 
             count++;
        }
        curDate.setDate(curDate.getDate() + 1);
    }
    return count;
}

// Conta ocorrências de um dia da semana (ex: Segunda) descontando feriados
export function countWeekdaysInPeriod(startDate, endDate, targetDayOfWeek, feriados = []) {
    let count = 0;
    let curDate = parseLocalDate(startDate);
    const end = parseLocalDate(endDate);
    const feriadosSet = new Set(feriados);

    while (curDate <= end) {
        // 0=Dom, 1=Seg, ... 6=Sab
        if (curDate.getDay() === targetDayOfWeek) {
            const dateStr = toLocalDateString(curDate);
            if (!feriadosSet.has(dateStr)) {
                count++;
            }
        }
        curDate.setDate(curDate.getDate() + 1);
    }
    return count;
}