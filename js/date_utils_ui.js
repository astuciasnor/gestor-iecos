export function timeToMinutes(str) {
    if (!str) return 99999;
    const match = str.match(/(\d{1,2}):(\d{2})/);
    if (!match) return 99999;
    return parseInt(match[1]) * 60 + parseInt(match[2]);
}

export function shortDayName(dayNumber) {
    const map = { 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sab' };
    return map[dayNumber] || String(dayNumber);
}

export function shiftISODate(dateStr, days) {
    if (!dateStr) return '';
    const d = new Date(`${dateStr}T12:00:00`);
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
}

export function isValidISODateValue(value) {
    const text = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
    const date = new Date(`${text}T12:00:00`);
    return !Number.isNaN(date.getTime());
}

export function diffDaysISO(fromDate, toDate) {
    if (!fromDate || !toDate) return 0;
    const from = new Date(`${fromDate}T12:00:00`).getTime();
    const to = new Date(`${toDate}T12:00:00`).getTime();
    if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
    return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

export function formatCompactFaixaDate(value) {
    const raw = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return 'dd/mm/aaaa';
    return `${raw.slice(8, 10)}/${raw.slice(5, 7)}/${raw.slice(0, 4)}`;
}

export function toISODate(dateObj) {
    return dateObj.toISOString().split('T')[0];
}

export function addDaysISO(dateStr, days) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + days);
    return toISODate(d);
}

export function getWeekStartISO(dateStr) {
    if (!dateStr) return '';
    const d = new Date(`${dateStr}T12:00:00`);
    if (Number.isNaN(d.getTime())) return '';
    const dow = d.getDay();
    const delta = dow === 0 ? -6 : (1 - dow);
    d.setDate(d.getDate() + delta);
    return toISODate(d);
}

export function formatDayMonthShort(dateStr) {
    if (!dateStr) return '';
    const d = new Date(`${dateStr}T12:00:00`);
    if (Number.isNaN(d.getTime())) return '';
    const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const dd = String(d.getDate()).padStart(2, '0');
    return `${dd}/${meses[d.getMonth()]}`;
}

export function isDateInsideRange(dateStr, start, end) {
    if (!dateStr) return false;
    const s = start || dateStr;
    const e = end || s;
    return dateStr >= s && dateStr <= e;
}

export function formatDateBRShortYear(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return '';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const [yyyy, mm, dd] = parts;
    return `${dd}/${mm}/${yyyy.slice(-2)}`;
}

export function formatDateBR(dateStr) {
    if (!dateStr) return '';
    return dateStr.split('-').reverse().join('/');
}
