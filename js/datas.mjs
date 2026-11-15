// Datas no formato ISO (AAAA-MM-DD). Funcoes puras (sem tela), usadas pelo app
// inteiro e pelos testes (tests/datas_horarios.test.mjs). Contas de dia sempre
// ao meio-dia local, para a troca de horario de verao nunca pular um dia.
// Data invalida devolve '' (nunca lanca erro).

const ISO = /^\d{4}-\d{2}-\d{2}$/;

// Date ao meio-dia local, ou null se o texto nao for uma data ISO valida.
export function toMiddayDate(dateStr) {
    if (!ISO.test(String(dateStr || '').trim())) return null;
    const date = new Date(`${dateStr}T12:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
}

// Date -> 'AAAA-MM-DD' (pela data em UTC, como sempre foi no app); '' se invalida.
export function toISODate(date) {
    return date instanceof Date && !Number.isNaN(date.getTime())
        ? date.toISOString().split('T')[0]
        : '';
}

// Soma (ou subtrai) dias: addDaysISO('2027-03-15', 7) = '2027-03-22'.
export function addDaysISO(dateStr, days = 0) {
    const raw = String(dateStr || '').trim();
    const date = toMiddayDate(raw);
    if (!date) return '';
    date.setDate(date.getDate() + Number(days || 0));
    return toISODate(date);
}

// Segunda-feira da semana da data (domingo conta na semana que termina nele).
export function getWeekStartISO(dateStr) {
    const date = toMiddayDate(dateStr);
    if (!date) return '';
    const dow = date.getDay();
    const delta = dow === 0 ? -6 : (1 - dow);
    date.setDate(date.getDate() + delta);
    return toISODate(date);
}

// Datas sem repeticao, so as validas, em ordem.
export function sortUniqueIsoDates(dates = []) {
    return [...new Set((Array.isArray(dates) ? dates : []).map((value) => String(value || '').trim()))]
        .filter((value) => ISO.test(value))
        .sort((a, b) => a.localeCompare(b));
}

// Milissegundos (UTC) da data, para contar dias sem fuso horario.
export function isoToUtc(iso) {
    const [y, m, d] = String(iso || '').split('-').map(Number);
    return Date.UTC(y, (m || 1) - 1, d || 1);
}

// Dia da semana (0 = domingo ... 6 = sabado).
export function weekdayOf(iso) {
    return new Date(isoToUtc(iso)).getUTCDay();
}

// Hoje no relogio do computador, 'AAAA-MM-DD'.
export function getLocalTodayIso() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
