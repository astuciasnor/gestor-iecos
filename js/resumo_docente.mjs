// Resumo do ano do docente (agenda publica): para cada periodo letivo, as
// componentes do professor e em quais semanas do PL ele tem aula.
// Funcoes puras (sem DOM nem store), testadas em tests/resumo_docente.test.mjs.
// As aulas chegam ja calculadas pelo calendario (feriados e divisao entre
// docentes de componente compartilhada ja aplicados).

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

function isoToUtc(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

function utcToIso(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function weekdayOf(iso) {
  return new Date(isoToUtc(iso)).getUTCDay();
}

// Semanas do PL, de segunda a domingo, cortadas no inicio e no fim do PL.
export function buildTermWeeks(termStart, termEnd) {
  if (!termStart || !termEnd || termStart > termEnd) return [];
  const endMs = isoToUtc(termEnd);
  const weeks = [];
  let cursor = isoToUtc(termStart);
  while (cursor <= endMs) {
    const dow = new Date(cursor).getUTCDay();
    const toSunday = dow === 0 ? 0 : 7 - dow;
    const weekEnd = Math.min(cursor + toSunday * DAY_MS, endMs);
    weeks.push({ index: weeks.length + 1, start: utcToIso(cursor), end: utcToIso(weekEnd) });
    cursor = weekEnd + DAY_MS;
  }
  return weeks;
}

export function findWeekIndex(weeks, iso) {
  return weeks.findIndex((week) => week.start <= iso && iso <= week.end);
}

// Onde cai o dia 1o de cada mes na faixa de semanas: semana e fracao dela
// (0 = no comeco da semana, 0.5 = no meio). O mes em que o PL comeca nao tem
// marca: o PL ja comeca no meio dele.
export function buildMonthMarkers(weeks = []) {
  if (!weeks.length) return [];
  const first = weeks[0].start;
  const last = weeks[weeks.length - 1].end;
  const markers = [];
  let [year, month] = first.split('-').map(Number);
  for (;;) {
    month += 1;
    if (month > 12) { month = 1; year += 1; }
    const iso = `${year}-${String(month).padStart(2, '0')}-01`;
    if (iso > last) break;
    const weekIndex = findWeekIndex(weeks, iso);
    if (weekIndex < 0) continue;
    const week = weeks[weekIndex];
    const span = (isoToUtc(week.end) - isoToUtc(week.start)) / DAY_MS + 1;
    const fraction = (isoToUtc(iso) - isoToUtc(week.start)) / DAY_MS / span;
    markers.push({ weekIndex, fraction, month: iso.slice(0, 7) });
  }
  return markers;
}

// [1,2,3,4,5] -> "seg a sex"; [2,4] -> "ter e qui"; [1,3,5] -> "seg, qua e sex".
export function formatWeekdays(days = []) {
  const sorted = [...new Set(days)].filter((d) => d >= 1 && d <= 6).sort((a, b) => a - b);
  if (!sorted.length) return '';
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (contiguous && sorted.length >= 3) {
    return `${WEEKDAY_SHORT[sorted[0]]} a ${WEEKDAY_SHORT[sorted[sorted.length - 1]]}`;
  }
  const names = sorted.map((d) => WEEKDAY_SHORT[d]);
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

function toMinutes(hhmm) {
  const match = String(hhmm || '').match(/(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
}

function formatMinutes(total) {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function turnoOf(minutes) {
  if (minutes < 12 * 60) return 'manha';
  if (minutes < 18 * 60) return 'tarde';
  return 'noite';
}

const TURNO_LABEL = { manha: 'manhã', tarde: 'tarde', noite: 'noite' };

// "08:00 - 08:50" ... "09:40 - 10:30" -> { range: "08:00–10:30", turnos: "manhã" }
export function summarizeHorarios(horarios = []) {
  let first = Infinity;
  let last = -Infinity;
  const turnos = new Set();
  horarios.forEach((horario) => {
    const times = String(horario || '').match(/\d{1,2}:\d{2}/g) || [];
    if (!times.length) return;
    const start = toMinutes(times[0]);
    const end = times[1] ? toMinutes(times[1]) : start + 50;
    if (!Number.isFinite(start)) return;
    first = Math.min(first, start);
    last = Math.max(last, end);
    turnos.add(turnoOf(start));
  });
  if (!Number.isFinite(first)) return { range: '', turnos: '' };
  const ordem = ['manha', 'tarde', 'noite'].filter((t) => turnos.has(t)).map((t) => TURNO_LABEL[t]);
  return {
    range: `${formatMinutes(first)}–${formatMinutes(last)}`,
    turnos: ordem.length > 1 ? `${ordem.slice(0, -1).join(', ')} e ${ordem[ordem.length - 1]}` : (ordem[0] || '')
  };
}

// entries: uma por aula do docente no PL:
//   { date, key, disciplina, turmaId, subGrupo, cor, aulas, horario, chTotal, coDocentes }
// key identifica a oferta (mesma componente na mesma turma/sub-turma).
export function summarizeTeacherPeriod({ termStart, termEnd, entries = [] }) {
  const weeks = buildTermWeeks(termStart, termEnd);
  const byKey = new Map();
  const aulasPorAno = {};

  entries.forEach((entry) => {
    if (!entry?.date || !entry.key) return;
    const weekIndex = findWeekIndex(weeks, entry.date);
    if (weekIndex < 0) return;
    if (!byKey.has(entry.key)) {
      byKey.set(entry.key, {
        key: entry.key,
        disciplina: entry.disciplina || '',
        turmaId: entry.turmaId || '',
        subGrupo: entry.subGrupo || '',
        cor: entry.cor || '',
        chTotal: Number(entry.chTotal) || 0,
        coDocentes: Array.isArray(entry.coDocentes) ? entry.coDocentes : [],
        aulas: 0,
        dates: new Set(),
        horarios: [],
        weekly: weeks.map(() => ({ dates: new Set(), aulas: 0 }))
      });
    }
    const comp = byKey.get(entry.key);
    const aulas = Number(entry.aulas) || 1;
    const ano = entry.date.slice(0, 4);
    aulasPorAno[ano] = (aulasPorAno[ano] || 0) + aulas;
    comp.aulas += aulas;
    comp.dates.add(entry.date);
    if (entry.horario) comp.horarios.push(entry.horario);
    comp.weekly[weekIndex].dates.add(entry.date);
    comp.weekly[weekIndex].aulas += aulas;
  });

  const components = [...byKey.values()].map((comp) => {
    const dates = [...comp.dates].sort();
    const horario = summarizeHorarios(comp.horarios);
    return {
      key: comp.key,
      disciplina: comp.disciplina,
      turmaId: comp.turmaId,
      subGrupo: comp.subGrupo,
      cor: comp.cor,
      chTotal: comp.chTotal,
      coDocentes: comp.coDocentes,
      aulas: comp.aulas,
      firstDate: dates[0],
      lastDate: dates[dates.length - 1],
      weekdays: formatWeekdays(dates.map(weekdayOf)),
      horario: horario.range,
      turnos: horario.turnos,
      // inicio: 1o dia de aula da semana (define o mes do calendario ao clicar).
      weekly: comp.weekly.map((w) => ({ dias: w.dates.size, aulas: w.aulas, inicio: [...w.dates].sort()[0] || '' }))
    };
  }).sort((a, b) => a.firstDate.localeCompare(b.firstDate) || a.disciplina.localeCompare(b.disciplina, 'pt-BR'));

  return {
    weeks,
    components,
    totalAulas: components.reduce((sum, comp) => sum + comp.aulas, 0),
    // Pelo ano da data da aula: um PL que vira o ano soma nos dois.
    aulasPorAno
  };
}
