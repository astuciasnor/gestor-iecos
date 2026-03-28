import { store } from './store.js';
import { getTurnoLetter } from './turns.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_META = [
  { id: 1, short: 'Seg', full: 'Segunda' },
  { id: 2, short: 'Ter', full: 'Terca' },
  { id: 3, short: 'Qua', full: 'Quarta' },
  { id: 4, short: 'Qui', full: 'Quinta' },
  { id: 5, short: 'Sex', full: 'Sexta' },
  { id: 6, short: 'Sab', full: 'Sabado' }
];
const TURNO_LABELS = {
  M: 'Manha',
  T: 'Tarde',
  N: 'Noite'
};
const STYLE_ID = 'gantt-bidimensional-style';
const LENS_ID = 'gantt-bidimensional-lens';

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function teacherNamesMatch(left, right) {
  return normalizeKey(left) === normalizeKey(right);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toDate(dateStr) {
  const raw = String(dateStr || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toISODate(date) {
  return date.toISOString().split('T')[0];
}

function addDaysISO(dateStr, days = 0) {
  const date = toDate(dateStr);
  if (!date) return '';
  date.setDate(date.getDate() + Number(days || 0));
  return toISODate(date);
}

function daysBetween(startDate, endDate) {
  const start = toDate(startDate);
  const end = toDate(endDate);
  if (!start || !end) return 0;
  return Math.round((end.getTime() - start.getTime()) / DAY_MS);
}

function timeToMinutes(value) {
  const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return (Number.parseInt(match[1], 10) * 60) + Number.parseInt(match[2], 10);
}

function formatDateBR(dateStr) {
  if (!dateStr) return '';
  return String(dateStr).split('-').reverse().join('/');
}

function formatCompactDate(dateStr) {
  const formatted = formatDateBR(dateStr || '');
  const parts = formatted.split('/');
  if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  return formatted || '--/--';
}

function formatHoverTimeLabel(slot = '') {
  const raw = String(slot || '').trim();
  const parts = raw.split('-').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]} - ${parts[1]}`;

  const match = raw.match(/(\d{1,2}):(\d{2})/);
  if (!match) return raw;
  return `${Number.parseInt(match[1], 10)}h${match[2]}`;
}

function formatMonthYearLabel(dateStr) {
  const date = toDate(dateStr);
  if (!date) return '';
  const month = date.toLocaleString('pt-BR', { month: 'short' }).replace('.', '');
  return `${month.charAt(0).toUpperCase()}${month.slice(1)}/${String(date.getFullYear()).slice(-2)}`;
}

function normalizeHexColor(hexColor = '') {
  const raw = String(hexColor || '').trim();
  const shortMatch = raw.match(/^#([0-9a-f]{3})$/i);
  if (shortMatch) {
    return `#${shortMatch[1].split('').map((part) => part + part).join('')}`.toUpperCase();
  }
  const longMatch = raw.match(/^#([0-9a-f]{6})$/i);
  if (longMatch) return `#${longMatch[1]}`.toUpperCase();
  return '#2563EB';
}

function hexToRgba(hexColor = '', alpha = 1) {
  const normalized = normalizeHexColor(hexColor);
  const value = normalized.replace('#', '');
  const intValue = Number.parseInt(value, 16);
  const red = (intValue >> 16) & 255;
  const green = (intValue >> 8) & 255;
  const blue = intValue & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function getTextColorForHex(hexColor = '') {
  const normalized = normalizeHexColor(hexColor);
  const value = normalized.replace('#', '');
  const intValue = Number.parseInt(value, 16);
  const red = (intValue >> 16) & 255;
  const green = (intValue >> 8) & 255;
  const blue = intValue & 255;
  const luminance = ((red * 299) + (green * 587) + (blue * 114)) / 1000;
  return luminance >= 150 ? '#0F172A' : '#F8FAFC';
}

function getComponentMeta(disciplina = '', turmaId = '') {
  const turma = (Array.isArray(store.rawData?.turmas) ? store.rawData.turmas : [])
    .find((entry) => String(entry?.turma_id) === String(turmaId || ''));
  const cursoSigla = String(turma?.sigla || '').trim();
  const componentes = Array.isArray(store.rawData?.componentes) ? store.rawData.componentes : [];
  const component = componentes.find((entry) => (
    entry?.componente === disciplina
    && (!cursoSigla || String(entry?.sigla || '').trim() === cursoSigla)
  )) || componentes.find((entry) => entry?.componente === disciplina);

  return {
    abreviacao: String(component?.abreviacao || component?.componente || disciplina || '').trim(),
    cor: normalizeHexColor(component?.cor || store.getDisciplinaColor?.(disciplina) || '#2563EB')
  };
}

function resolveTurnoLabelFromSlots(slots = []) {
  const letters = [...new Set((Array.isArray(slots) ? slots : [])
    .map((slot) => getTurnoLetter(slot))
    .filter(Boolean))]
    .sort((left, right) => ['M', 'T', 'N'].indexOf(left) - ['M', 'T', 'N'].indexOf(right));

  if (letters.length === 0) return 'Turno nao informado';
  return letters.map((letter) => TURNO_LABELS[letter] || letter).join(' / ');
}

function resolveTeacherHoursForGroup(group, docenteName = '') {
  const docente = (Array.isArray(group?.docentes) ? group.docentes : [])
    .find((entry) => teacherNamesMatch(entry?.nome, docenteName));
  const hours = Number.parseFloat(docente?.ch);
  if (Number.isFinite(hours) && hours > 0) return hours;
  const fallback = Number.parseFloat(group?.executedHours);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
}

function buildTeacherEventsByOfferKey(teacherSnapshot, offerProjection) {
  const bucket = new Map();

  Object.entries(teacherSnapshot?.eventsByDate || {}).forEach(([dateStr, events]) => {
    if (!Array.isArray(events)) return;

    events.forEach((event) => {
      if (!event?.id || event?.type === 'holiday') return;
      const group = offerProjection?.offerGroupsByAllocationId?.get(event.id);
      if (!group) return;

      if (!bucket.has(group.offerKey)) bucket.set(group.offerKey, new Map());
      const byDate = bucket.get(group.offerKey);
      if (!byDate.has(dateStr)) byDate.set(dateStr, []);
      byDate.get(dateStr).push(event);
    });
  });

  return bucket;
}

function intersectRanges(startA = '', endA = '', startB = '', endB = '') {
  const start = [startA, startB].filter(Boolean).sort((left, right) => right.localeCompare(left))[0] || '';
  const end = [endA, endB].filter(Boolean).sort((left, right) => left.localeCompare(right))[0] || '';
  if (!start || !end || start > end) return null;
  return { start, end };
}

function resolveFaixaTeacherSegments(group, faixa, docenteName = '') {
  const faixaStart = String(faixa?.inicio || '').trim();
  const faixaEnd = String(faixa?.fim || faixaStart || '').trim();
  const matchingSegments = (Array.isArray(group?.teacherSegments) ? group.teacherSegments : [])
    .filter((segment) => teacherNamesMatch(segment?.nome, docenteName))
    .map((segment) => intersectRanges(
      faixaStart,
      faixaEnd,
      String(segment?.start || faixaStart || '').trim(),
      String(segment?.end || segment?.start || faixaEnd || '').trim()
    ))
    .filter(Boolean);

  if (matchingSegments.length === 0) {
    return [{ start: faixaStart, end: faixaEnd }];
  }

  return matchingSegments.sort((left, right) => {
    const startDiff = String(left.start || '').localeCompare(String(right.start || ''));
    if (startDiff !== 0) return startDiff;
    return String(left.end || '').localeCompare(String(right.end || ''));
  });
}

function resolveDayWidth(totalDays = 0) {
  if (totalDays > 180) return 14;
  if (totalDays > 140) return 16;
  if (totalDays > 100) return 20;
  if (totalDays > 75) return 24;
  return 28;
}

function buildBidimensionalRows({
  docenteName = '',
  offerProjection,
  teacherSnapshot
}) {
  const rows = [];
  const eventsByOfferKey = buildTeacherEventsByOfferKey(teacherSnapshot, offerProjection);

  (Array.isArray(offerProjection?.offerGroups) ? offerProjection.offerGroups : []).forEach((group) => {
    const dateMap = eventsByOfferKey.get(group.offerKey);
    if (!(dateMap instanceof Map) || dateMap.size === 0) return;

    const componentMeta = getComponentMeta(group.disciplina, group.turmaId);
    const baseColor = normalizeHexColor(group?.baseAlloc?.cor || componentMeta.cor || '#2563EB');
    const textColor = getTextColorForHex(baseColor);
    const teacherHours = resolveTeacherHoursForGroup(group, docenteName);
    const faixas = Array.isArray(group?.faixas) && group.faixas.length > 0
      ? group.faixas
      : [{
          faixaId: `${group.offerKey}|1`,
          index: 1,
          inicio: group.start,
          fim: group.end,
          dias: Object.keys(group?.timeRangesByDay || {}).map((value) => Number.parseInt(value, 10)).filter((value) => value >= 1 && value <= 6),
          slots: Object.values(group?.timeRangesByDay || {}).flat()
        }];

    faixas.forEach((faixa) => {
      resolveFaixaTeacherSegments(group, faixa, docenteName).forEach((segment, segmentIdx) => {
        const faixaDates = [...dateMap.keys()]
          .filter((dateStr) => dateStr >= segment.start && dateStr <= segment.end)
          .sort((left, right) => left.localeCompare(right));

        if (faixaDates.length === 0) return;

        const activeDayIds = new Set();
        const slotSet = new Set();
        const slotsByDayMap = new Map();
        const occurrenceCountByDayMap = new Map();

        faixaDates.forEach((dateStr) => {
          const dayOfWeek = toDate(dateStr)?.getDay() || 0;
          if (dayOfWeek >= 1 && dayOfWeek <= 6) activeDayIds.add(dayOfWeek);
          if (dayOfWeek >= 1 && dayOfWeek <= 6 && !slotsByDayMap.has(dayOfWeek)) {
            slotsByDayMap.set(dayOfWeek, new Set());
          }
          if (dayOfWeek >= 1 && dayOfWeek <= 6) {
            occurrenceCountByDayMap.set(dayOfWeek, (occurrenceCountByDayMap.get(dayOfWeek) || 0) + 1);
          }

          (dateMap.get(dateStr) || []).forEach((event) => {
            const slot = String(event?.horario || '').trim();
            if (!slot) return;
            slotSet.add(slot);
            if (dayOfWeek >= 1 && dayOfWeek <= 6) slotsByDayMap.get(dayOfWeek)?.add(slot);
          });
        });

        const sortedDayIds = DAY_META.map((day) => day.id).filter((dayId) => activeDayIds.has(dayId));
        if (sortedDayIds.length === 0) return;

        const sortedSlots = [...slotSet].sort((left, right) => timeToMinutes(left) - timeToMinutes(right));
        const faixaLabel = faixas.length > 1 ? `Faixa ${faixa.index || 1}` : '';
        const faixaBadge = segmentIdx > 0 ? `${faixaLabel || 'Faixa'} - Segmento ${segmentIdx + 1}` : faixaLabel;

        rows.push({
          key: `${group.offerKey}|${faixa.faixaId || faixa.index || 1}|${segment.start}|${segment.end}|${segmentIdx + 1}`,
          offerKey: group.offerKey,
          groupStart: String(group.start || faixaDates[0] || '').trim(),
          groupEnd: String(group.end || faixaDates[faixaDates.length - 1] || '').trim(),
          faixaOrder: Number.parseInt(faixa?.index, 10) || 1,
          segmentOrder: segmentIdx + 1,
          nome: group.disciplina,
          turmaId: String(group.turmaId || '').trim(),
          chLabel: teacherHours > 0
            ? (Number.isInteger(teacherHours)
              ? `${teacherHours}h`
              : `${teacherHours.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}h`)
            : '-',
          turnoLabel: resolveTurnoLabelFromSlots(sortedSlots),
          faixaBadge,
          activeDayIds: sortedDayIds,
          slots: sortedSlots,
          slotsByDay: Object.fromEntries(
            sortedDayIds.map((dayId) => [
              dayId,
              [...(slotsByDayMap.get(dayId) || new Set())].sort((left, right) => timeToMinutes(left) - timeToMinutes(right))
            ])
          ),
          occurrenceCountByDay: Object.fromEntries(
            sortedDayIds.map((dayId) => [dayId, occurrenceCountByDayMap.get(dayId) || 0])
          ),
          startDate: faixaDates[0],
          endDate: faixaDates[faixaDates.length - 1],
          color: baseColor,
          textColor,
          tooltip: `${group.disciplina}\n${formatDateBR(faixaDates[0])} a ${formatDateBR(faixaDates[faixaDates.length - 1])}\nDias: ${sortedDayIds.map((dayId) => DAY_META.find((day) => day.id === dayId)?.full || '').join(', ')}\nTurma: ${group.turmaId}\nTurno: ${resolveTurnoLabelFromSlots(sortedSlots)}`
        });
      });
    });
  });

  return rows.sort((left, right) => {
    const groupStartDiff = String(left.groupStart || '').localeCompare(String(right.groupStart || ''));
    if (groupStartDiff !== 0) return groupStartDiff;
    const turmaDiff = String(left.turmaId || '').localeCompare(String(right.turmaId || ''));
    if (turmaDiff !== 0) return turmaDiff;
    const nameDiff = String(left.nome || '').localeCompare(String(right.nome || ''), 'pt-BR', { sensitivity: 'base' });
    if (nameDiff !== 0) return nameDiff;
    const offerDiff = String(left.offerKey || '').localeCompare(String(right.offerKey || ''));
    if (offerDiff !== 0) return offerDiff;
    const faixaDiff = (Number(left.faixaOrder) || 0) - (Number(right.faixaOrder) || 0);
    if (faixaDiff !== 0) return faixaDiff;
    const segmentDiff = (Number(left.segmentOrder) || 0) - (Number(right.segmentOrder) || 0);
    if (segmentDiff !== 0) return segmentDiff;
    const startDiff = String(left.startDate || '').localeCompare(String(right.startDate || ''));
    if (startDiff !== 0) return startDiff;
    return String(left.endDate || '').localeCompare(String(right.endDate || ''));
  });
}

function buildMonthCells(startDate = '', endDate = '', dayWidth = 24) {
  const cells = [];
  const start = toDate(startDate);
  const end = toDate(endDate);
  if (!start || !end) return cells;

  let cursor = new Date(start.getFullYear(), start.getMonth(), 1, 12, 0, 0);
  while (cursor.getTime() <= end.getTime()) {
    const monthStart = toISODate(cursor);
    const nextMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1, 12, 0, 0);
    const monthEnd = addDaysISO(toISODate(nextMonth), -1);
    const visibleStart = monthStart < startDate ? startDate : monthStart;
    const visibleEnd = monthEnd > endDate ? endDate : monthEnd;

    if (visibleStart <= visibleEnd) {
      cells.push({
        label: formatMonthYearLabel(visibleStart),
        left: Math.max(0, daysBetween(startDate, visibleStart)) * dayWidth,
        width: (Math.max(0, daysBetween(visibleStart, visibleEnd)) + 1) * dayWidth
      });
    }

    cursor = nextMonth;
  }

  return cells;
}

function buildVerticalLines(startDate = '', endDate = '', dayWidth = 24) {
  const dailyLines = [];
  const weekLines = [];
  const monthLines = [];
  const start = toDate(startDate);
  const end = toDate(endDate);
  if (!start || !end) return { dailyLines, weekLines, monthLines };

  let cursor = new Date(start);
  let index = 0;
  while (cursor.getTime() <= end.getTime()) {
    const left = index * dayWidth;
    dailyLines.push(left);
    if (cursor.getDay() === 1) weekLines.push(left);
    if (cursor.getDate() === 1 && index > 0) monthLines.push(left);
    cursor.setDate(cursor.getDate() + 1);
    index += 1;
  }

  return { dailyLines, weekLines, monthLines };
}

function ensureBidimensionalGanttStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .gantt-bi {
      --gantt-label-width: 320px;
      --gantt-day-width: 24px;
      --gantt-segment-height: 30px;
      color: #0f172a;
    }
    .gantt-bi__title {
      margin: 0 0 18px;
      text-align: center;
      color: var(--primary, #0b5d3b);
      font-size: 1.5rem;
      font-weight: 800;
      letter-spacing: 0.03em;
      text-transform: uppercase;
    }
    .gantt-bi__scroll {
      overflow: auto;
      scrollbar-gutter: stable both-edges;
      scrollbar-width: auto;
      scrollbar-color: rgba(11, 93, 59, 0.7) rgba(203, 213, 225, 0.85);
      -webkit-overflow-scrolling: touch;
      border: 1px solid #cbd5e1;
      border-radius: 18px;
      background:
        radial-gradient(circle at top left, rgba(255,255,255,0.95), rgba(255,255,255,0.78)),
        linear-gradient(180deg, #f8fbff, #eef3f8);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.6), 0 10px 24px rgba(15, 23, 42, 0.08);
    }
    .gantt-bi__scroll::-webkit-scrollbar {
      width: 14px;
      height: 14px;
    }
    .gantt-bi__scroll::-webkit-scrollbar-track {
      background: rgba(226, 232, 240, 0.9);
      border-radius: 999px;
      box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.2);
    }
    .gantt-bi__scroll::-webkit-scrollbar-thumb {
      background: linear-gradient(180deg, rgba(11, 93, 59, 0.88), rgba(19, 78, 74, 0.82));
      border-radius: 999px;
      border: 3px solid rgba(226, 232, 240, 0.95);
    }
    .gantt-bi__scroll::-webkit-scrollbar-thumb:hover {
      background: linear-gradient(180deg, rgba(11, 93, 59, 0.96), rgba(15, 118, 110, 0.9));
    }
    .gantt-bi__canvas {
      min-width: max-content;
    }
    .gantt-bi__header,
    .gantt-bi__row {
      display: flex;
      min-width: max-content;
    }
    .gantt-bi__header {
      position: sticky;
      top: 0;
      z-index: 18;
      background: linear-gradient(180deg, #dfe7ef, #e7edf4);
      border-bottom: 2px solid rgba(11, 93, 59, 0.9);
    }
    .gantt-bi__header-label,
    .gantt-bi__label {
      position: sticky;
      left: 0;
      z-index: 12;
      width: var(--gantt-label-width);
      min-width: var(--gantt-label-width);
      max-width: var(--gantt-label-width);
      box-sizing: border-box;
      border-right: 1px solid #cbd5e1;
    }
    .gantt-bi__header-label {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 12px 16px;
      font-size: 0.78rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      color: #334155;
      text-transform: uppercase;
      background: linear-gradient(180deg, #dfe7ef, #e7edf4);
    }
    .gantt-bi__header-timeline {
      position: relative;
      height: 72px;
      background: linear-gradient(180deg, rgba(255,255,255,0.65), rgba(255,255,255,0.32));
    }
    .gantt-bi__month-cell {
      position: absolute;
      top: 0;
      bottom: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      color: var(--primary, #0b5d3b);
      font-size: 1.1rem;
      letter-spacing: 0.02em;
      border-left: 1px solid rgba(51, 65, 85, 0.18);
    }
    .gantt-bi__row {
      border-bottom: 1px solid #dbe4ec;
    }
    .gantt-bi__label {
      display: flex;
      align-items: center;
      padding: 10px 12px;
      background: linear-gradient(180deg, rgba(248,250,252,0.98), rgba(241,245,249,0.96));
    }
    .gantt-bi__label-card {
      width: 100%;
      border-left: 6px solid var(--accent, #2563eb);
      background: rgba(255,255,255,0.72);
      border-radius: 12px;
      padding: 12px 14px;
      box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.16);
      display: flex;
      flex-direction: column;
    }
    .gantt-bi__label-name {
      font-size: 1.02rem;
      font-weight: 850;
      color: #0f172a;
      line-height: 1.16;
      letter-spacing: -0.01em;
      margin-bottom: 8px;
    }
    .gantt-bi__label-meta {
      font-size: 0.78rem;
      color: #475569;
      line-height: 1.32;
      font-weight: 650;
    }
    .gantt-bi__label-turno-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 6px;
    }
    .gantt-bi__label-turno {
      font-size: 0.84rem;
      color: #0f172a;
      line-height: 1.3;
      font-weight: 800;
    }
    .gantt-bi__label-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      color: #0f172a;
      font-size: 0.72rem;
      font-weight: 900;
      letter-spacing: 0.01em;
      text-transform: none;
    }
    .gantt-bi__track {
      position: relative;
      flex: 0 0 auto;
      background:
        linear-gradient(180deg, rgba(248,250,252,0.45), rgba(255,255,255,0.72)),
        repeating-linear-gradient(
          to right,
          rgba(148, 163, 184, 0.18) 0,
          rgba(148, 163, 184, 0.18) 1px,
          transparent 1px,
          transparent var(--gantt-day-width)
        ),
        repeating-linear-gradient(
          to bottom,
          rgba(148, 163, 184, 0.16) 0,
          rgba(148, 163, 184, 0.16) 1px,
          transparent 1px,
          transparent var(--gantt-segment-height)
        );
    }
    .gantt-bi__line {
      position: absolute;
      top: 0;
      bottom: 0;
      pointer-events: none;
    }
    .gantt-bi__line--week {
      border-left: 1px dashed rgba(71, 85, 105, 0.32);
    }
    .gantt-bi__line--month {
      border-left: 2px solid rgba(15, 23, 42, 0.6);
    }
    .gantt-bi__date {
      position: absolute;
      z-index: 6;
      box-sizing: border-box;
      padding: 3px 6px;
      border-radius: 999px;
      font-size: 0.72rem;
      font-weight: 800;
      line-height: 1;
      letter-spacing: 0.01em;
      white-space: nowrap;
      text-align: center;
      pointer-events: none;
      box-shadow: 0 2px 6px rgba(15, 23, 42, 0.08);
    }
    .gantt-bi__date--internal {
      min-width: 44px;
    }
    .gantt-bi__date--external,
    .gantt-bi__date--compact {
      backdrop-filter: blur(3px);
    }
    .gantt-bi__block {
      position: absolute;
      border-radius: 14px;
      overflow: hidden;
      box-shadow: 0 10px 20px rgba(15, 23, 42, 0.14);
      border: 1px solid rgba(15, 23, 42, 0.18);
    }
    .gantt-bi__block-inner {
      display: grid;
      height: 100%;
    }
    .gantt-bi__segment {
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      font-size: 0.88rem;
      font-weight: 800;
      letter-spacing: 0.03em;
      padding: 0 8px;
      border-top: 1px solid rgba(255,255,255,0.36);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .gantt-bi__segment--interactive {
      cursor: pointer;
      transition: filter 120ms ease, transform 120ms ease;
    }
    .gantt-bi__segment--interactive:hover,
    .gantt-bi__segment--interactive:focus-visible {
      filter: brightness(1.04) saturate(1.04);
      transform: scale(0.985);
      outline: none;
    }
    .gantt-bi__segment:first-child {
      border-top: none;
    }
    .gantt-bi__lens {
      position: fixed;
      z-index: 1200;
      width: 132px;
      max-width: min(132px, calc(100vw - 24px));
      pointer-events: auto;
      opacity: 0;
      transform: translateY(4px);
      transition: opacity 120ms ease, transform 120ms ease;
    }
    .gantt-bi__lens.is-visible {
      opacity: 1;
      transform: translateY(0);
    }
    .gantt-bi__lens-card {
      position: relative;
      border-radius: 12px;
      background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.98));
      border: 1px solid rgba(148, 163, 184, 0.42);
      box-shadow: 0 16px 30px rgba(15, 23, 42, 0.18);
      padding: 9px 10px 10px;
      color: #0f172a;
    }
    .gantt-bi__lens-title {
      margin: 0 0 6px;
      font-size: 0.72rem;
      font-weight: 900;
      letter-spacing: 0.04em;
      text-transform: none;
      color: #334155;
    }
    .gantt-bi__lens-list {
      margin: 0;
      padding-left: 14px;
      font-size: 0.78rem;
      line-height: 1.36;
      font-weight: 700;
      color: #1e293b;
    }
    .gantt-bi__lens-list li + li {
      margin-top: 2px;
    }
    .gantt-bi__lens-arrow {
      position: absolute;
      width: 12px;
      height: 12px;
      background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.98));
      border-left: 1px solid rgba(148, 163, 184, 0.42);
      border-top: 1px solid rgba(148, 163, 184, 0.42);
      transform: rotate(45deg);
      left: calc(var(--gantt-lens-arrow-left, 50%) - 6px);
    }
    .gantt-bi__lens--above .gantt-bi__lens-arrow {
      bottom: -7px;
    }
    .gantt-bi__lens--below .gantt-bi__lens-arrow {
      top: -7px;
      transform: rotate(225deg);
    }
    .gantt-bi__empty {
      text-align: center;
      color: #64748b;
      padding: 48px 20px;
      font-size: 1rem;
      font-weight: 600;
    }
    @media (max-width: 960px) {
      .gantt-bi {
        --gantt-label-width: 250px;
        --gantt-segment-height: 28px;
      }
      .gantt-bi__label-name {
        font-size: 0.9rem;
      }
      .gantt-bi__month-cell {
        font-size: 0.98rem;
      }
      .gantt-bi__segment {
        font-size: 0.78rem;
      }
    }
  `;

  document.head.appendChild(style);
}

function renderMonthCells(monthCells = []) {
  return monthCells.map((month) => `
    <div class="gantt-bi__month-cell" style="left:${month.left}px; width:${month.width}px;">
      ${escapeHtml(month.label)}
    </div>
  `).join('');
}

function renderVerticalLines(linePositions = [], className = '') {
  return linePositions.map((left) => `
    <div class="gantt-bi__line ${className}" style="left:${left}px;"></div>
  `).join('');
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildSegmentDetailPayload(row, dayId) {
  const day = DAY_META.find((entry) => entry.id === dayId);
  const slots = Array.isArray(row?.slotsByDay?.[dayId]) ? row.slotsByDay[dayId] : [];
  if (!day || slots.length === 0) return '';

  return encodeURIComponent(JSON.stringify({
    dayId,
    dayShort: day.short,
    occurrenceCount: Number.parseInt(row?.occurrenceCountByDay?.[dayId], 10) || 0,
    times: slots.map((slot) => formatHoverTimeLabel(slot)).filter(Boolean)
  }));
}

function ensureBidimensionalLens() {
  let lens = document.getElementById(LENS_ID);
  if (lens) return lens;

  lens = document.createElement('div');
  lens.id = LENS_ID;
  lens.className = 'gantt-bi__lens gantt-bi__lens--above';
  lens.hidden = true;
  lens.innerHTML = `
    <div class="gantt-bi__lens-card">
      <div class="gantt-bi__lens-title">Horarios</div>
      <ul class="gantt-bi__lens-list"></ul>
      <div class="gantt-bi__lens-arrow"></div>
    </div>
  `;
  document.body.appendChild(lens);
  return lens;
}

function parseSegmentDetail(rawValue = '') {
  try {
    const parsed = JSON.parse(decodeURIComponent(String(rawValue || '')));
    if (!Array.isArray(parsed?.times) || parsed.times.length === 0) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function fillBidimensionalLens(lens, detail) {
  const title = lens.querySelector('.gantt-bi__lens-title');
  const list = lens.querySelector('.gantt-bi__lens-list');
  if (title) {
    const countLabel = detail.occurrenceCount > 0 ? ` (${detail.occurrenceCount}x)` : '';
    title.textContent = `${detail.dayShort}${countLabel}`;
  }
  if (!list) return;
  list.innerHTML = detail.times.map((timeLabel) => `<li>${escapeHtml(timeLabel)}</li>`).join('');
}

function positionBidimensionalLens(lens, anchor) {
  const anchorRect = anchor.getBoundingClientRect();
  const lensRect = lens.getBoundingClientRect();
  const margin = 10;
  const spaceAbove = anchorRect.top;
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const placeAbove = spaceAbove >= lensRect.height + 16 || spaceAbove >= spaceBelow;
  const maxLeft = Math.max(margin, window.innerWidth - lensRect.width - margin);
  const centeredLeft = clampNumber(
    Math.round(anchorRect.left + (anchorRect.width / 2) - (lensRect.width / 2)),
    margin,
    maxLeft
  );
  const top = placeAbove
    ? Math.max(margin, Math.round(anchorRect.top - lensRect.height - 12))
    : Math.min(window.innerHeight - lensRect.height - margin, Math.round(anchorRect.bottom + 12));
  const anchorCenter = anchorRect.left + (anchorRect.width / 2);
  const arrowLeft = clampNumber(
    Math.round(anchorCenter - centeredLeft),
    14,
    Math.max(14, lensRect.width - 14)
  );

  lens.classList.toggle('gantt-bi__lens--above', placeAbove);
  lens.classList.toggle('gantt-bi__lens--below', !placeAbove);
  lens.style.left = `${centeredLeft}px`;
  lens.style.top = `${top}px`;
  lens.style.setProperty('--gantt-lens-arrow-left', `${arrowLeft}px`);
}

function hideBidimensionalLens(lens) {
  if (!lens) return;
  lens.classList.remove('is-visible');
  window.setTimeout(() => {
    if (!lens.classList.contains('is-visible')) lens.hidden = true;
  }, 120);
}

function showBidimensionalLens(lens, anchor) {
  const detail = parseSegmentDetail(anchor?.dataset?.ganttBiDetail || '');
  if (!detail || !lens) {
    hideBidimensionalLens(lens);
    return;
  }

  fillBidimensionalLens(lens, detail);
  lens.hidden = false;
  lens.dataset.anchorKey = String(anchor.dataset.ganttBiAnchor || '');
  positionBidimensionalLens(lens, anchor);
  requestAnimationFrame(() => lens.classList.add('is-visible'));
}

function bindBidimensionalLensInteractions(container) {
  if (!container) return;
  const lens = ensureBidimensionalLens();
  const state = lens._ganttBiState || { hideTimer: 0, activeAnchor: null };
  lens._ganttBiState = state;
  const scrollHost = container.querySelector('.gantt-bi__scroll');

  const clearHideTimer = () => {
    if (state.hideTimer) {
      window.clearTimeout(state.hideTimer);
      state.hideTimer = 0;
    }
  };

  const scheduleHide = () => {
    clearHideTimer();
    state.hideTimer = window.setTimeout(() => {
      state.activeAnchor = null;
      hideBidimensionalLens(lens);
    }, 120);
  };

  const activate = (target) => {
    if (!(target instanceof HTMLElement)) return;
    clearHideTimer();
    state.activeAnchor = target;
    showBidimensionalLens(lens, target);
  };

  container.querySelectorAll('[data-gantt-bi-detail]').forEach((segment) => {
    segment.addEventListener('mouseenter', () => activate(segment));
    segment.addEventListener('focus', () => activate(segment));
    segment.addEventListener('mouseleave', scheduleHide);
    segment.addEventListener('blur', scheduleHide);
  });

  scrollHost?.addEventListener('scroll', () => {
    if (state.activeAnchor && lens.classList.contains('is-visible')) positionBidimensionalLens(lens, state.activeAnchor);
  }, { passive: true });

  lens.addEventListener('mouseenter', clearHideTimer);
  lens.addEventListener('mouseleave', scheduleHide);

  if (!lens.dataset.globalBound) {
    window.addEventListener('scroll', () => {
      const activeAnchor = lens._ganttBiState?.activeAnchor;
      if (activeAnchor && lens.classList.contains('is-visible')) positionBidimensionalLens(lens, activeAnchor);
    }, { passive: true });
    window.addEventListener('resize', () => {
      const activeAnchor = lens._ganttBiState?.activeAnchor;
      if (activeAnchor && lens.classList.contains('is-visible')) positionBidimensionalLens(lens, activeAnchor);
    });
    lens.dataset.globalBound = '1';
  }
}

function buildBarDateDecorations({
  row,
  left,
  width,
  blockTop,
  blockHeight,
  rowHeight,
  timelineWidth,
  baseColor,
  textColor
}) {
  const startLabel = formatCompactDate(row?.startDate || '');
  const endLabel = formatCompactDate(row?.endDate || '');
  const isSingleDay = String(row?.startDate || '') === String(row?.endDate || '');
  const internalBg = textColor === '#F8FAFC' ? 'rgba(15,23,42,0.24)' : 'rgba(255,255,255,0.46)';
  const internalBorder = textColor === '#F8FAFC' ? 'rgba(255,255,255,0.18)' : 'rgba(15,23,42,0.12)';
  const externalBg = 'rgba(255,255,255,0.96)';
  const externalColor = '#0f172a';
  const externalBorder = hexToRgba(baseColor, 0.26);
  const internalTop = Math.max(6, Math.round(blockTop + (blockHeight / 2) - 11));
  const externalTop = clampNumber(Math.round(blockTop - 24), 4, Math.max(4, rowHeight - 28));

  if (width >= 220) {
    return `
      <div class="gantt-bi__date gantt-bi__date--internal" style="left:${left + 8}px; top:${internalTop}px; background:${internalBg}; color:${textColor}; border:1px solid ${internalBorder};">${escapeHtml(startLabel)}</div>
      ${isSingleDay ? '' : `<div class="gantt-bi__date gantt-bi__date--internal" style="left:${Math.max(left + 8, left + width - 52)}px; top:${internalTop}px; background:${internalBg}; color:${textColor}; border:1px solid ${internalBorder};">${escapeHtml(endLabel)}</div>`}
    `;
  }

  if (width >= 110 && !isSingleDay) {
    const startWidth = 50;
    const endWidth = 50;
    const startLeft = clampNumber(left, 4, Math.max(4, timelineWidth - startWidth - 4));
    const endLeft = clampNumber(left + width - endWidth, 4, Math.max(4, timelineWidth - endWidth - 4));
    return `
      <div class="gantt-bi__date gantt-bi__date--external" style="left:${startLeft}px; top:${externalTop}px; width:${startWidth}px; background:${externalBg}; color:${externalColor}; border:1px solid ${externalBorder};">${escapeHtml(startLabel)}</div>
      <div class="gantt-bi__date gantt-bi__date--external" style="left:${endLeft}px; top:${externalTop}px; width:${endWidth}px; background:${externalBg}; color:${externalColor}; border:1px solid ${externalBorder};">${escapeHtml(endLabel)}</div>
    `;
  }

  const compactDisplayLabel = isSingleDay ? startLabel : `${startLabel} - ${endLabel}`;
  const compactWidth = isSingleDay ? 56 : 96;
  const compactLeft = clampNumber(
    Math.round(left + (width / 2) - (compactWidth / 2)),
    4,
    Math.max(4, timelineWidth - compactWidth - 4)
  );

  return `
    <div class="gantt-bi__date gantt-bi__date--compact" style="left:${compactLeft}px; top:${externalTop}px; width:${compactWidth}px; background:${externalBg}; color:${externalColor}; border:1px solid ${externalBorder};">${escapeHtml(compactDisplayLabel)}</div>
  `;
}

function estimateLabelMinHeight(row) {
  const titleLength = String(row?.nome || '').trim().length;
  let minHeight = 96;

  if (titleLength > 26) minHeight += 14;
  if (titleLength > 42) minHeight += 14;
  if (String(row?.turnoLabel || '').trim().length > 18) minHeight += 8;
  if (String(row?.faixaBadge || '').trim()) minHeight += 4;

  return minHeight;
}

function renderRow(row, layout) {
  const blockHeight = row.activeDayIds.length * layout.segmentHeight;
  const blockDrivenHeight = blockHeight + (layout.rowPadding * 2);
  const rowHeight = Math.max(blockDrivenHeight, estimateLabelMinHeight(row));
  const blockTop = Math.max(layout.rowPadding, Math.round((rowHeight - blockHeight) / 2));
  const left = Math.max(0, daysBetween(layout.startDate, row.startDate)) * layout.dayWidth;
  const width = (Math.max(0, daysBetween(row.startDate, row.endDate)) + 1) * layout.dayWidth;
  const textColor = row.textColor;
  const baseColor = row.color;
  const segmentBgEven = hexToRgba(baseColor, textColor === '#F8FAFC' ? 0.94 : 0.88);
  const segmentBgOdd = hexToRgba(baseColor, textColor === '#F8FAFC' ? 0.82 : 0.72);
  const showSegmentFrequency = width >= 112;
  const dateDecorations = buildBarDateDecorations({
    row,
    left,
    width,
    blockTop,
    blockHeight,
    rowHeight,
    timelineWidth: layout.timelineWidth,
    baseColor,
    textColor
  });

  return `
    <div class="gantt-bi__row" style="height:${rowHeight}px;">
      <div class="gantt-bi__label">
        <div class="gantt-bi__label-card" style="--accent:${baseColor};" title="${escapeHtml(row.tooltip)}">
          <div class="gantt-bi__label-name">${escapeHtml(row.nome)}</div>
          <div class="gantt-bi__label-meta">CH ${escapeHtml(row.chLabel)} &middot; Turma ${escapeHtml(row.turmaId)}</div>
          <div class="gantt-bi__label-turno-row">
            <div class="gantt-bi__label-turno"><span style="opacity:0.68; font-weight:700; margin-right:6px;">Turno</span>${escapeHtml(row.turnoLabel)}</div>
            ${row.faixaBadge ? `<div class="gantt-bi__label-badge" style="background:${hexToRgba(baseColor, 0.14)}; color:${baseColor}; box-shadow:inset 0 0 0 1px ${hexToRgba(baseColor, 0.22)};">${escapeHtml(row.faixaBadge)}</div>` : ''}
          </div>
        </div>
      </div>
      <div class="gantt-bi__track" style="width:${layout.timelineWidth}px; height:${rowHeight}px;">
        ${renderVerticalLines(layout.weekLines, 'gantt-bi__line--week')}
        ${renderVerticalLines(layout.monthLines, 'gantt-bi__line--month')}
        ${dateDecorations}
        <div class="gantt-bi__block"
             style="left:${left}px; width:${width}px; top:${blockTop}px; height:${blockHeight}px; background:${hexToRgba(baseColor, 0.18)}; color:${textColor};"
             aria-label="${escapeHtml(row.tooltip)}">
          <div class="gantt-bi__block-inner" style="grid-template-rows: repeat(${row.activeDayIds.length}, 1fr);">
            ${row.activeDayIds.map((dayId, index) => {
              const day = DAY_META.find((entry) => entry.id === dayId);
              const segmentBg = index % 2 === 0 ? segmentBgEven : segmentBgOdd;
              const occurrenceCount = Number.parseInt(row?.occurrenceCountByDay?.[dayId], 10) || 0;
              const segmentLabel = showSegmentFrequency && occurrenceCount > 0
                ? `${day?.short || ''} (${occurrenceCount}x)`
                : (day?.short || '');
              const detailPayload = buildSegmentDetailPayload(row, dayId);
              const interactiveClass = detailPayload ? ' gantt-bi__segment--interactive' : '';
              const interactionAttrs = detailPayload
                ? ` data-gantt-bi-detail="${detailPayload}" data-gantt-bi-anchor="${escapeHtml(`${row.key}|${dayId}`)}" tabindex="0" role="button" aria-label="Horarios de ${escapeHtml(day?.short || '')}"`
                : '';
              return `
                <div class="gantt-bi__segment${interactiveClass}"${interactionAttrs} style="background:${segmentBg}; color:${textColor};">
                  ${escapeHtml(segmentLabel)}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
}

export function renderBidimensionalTeacherGantt(container, {
  docenteName = '',
  totalCH = 0,
  offerProjection = null,
  teacherSnapshot = null,
  startDate = '',
  endDate = ''
} = {}) {
  if (!container) return;

  hideBidimensionalLens(document.getElementById(LENS_ID));

  const teacherName = String(docenteName || '').trim();
  if (!teacherName) {
    container.innerHTML = '<div class="gantt-bi__empty">Digite o nome de um professor para montar o cronograma bidimensional.</div>';
    return;
  }

  ensureBidimensionalGanttStyles();

  const rows = buildBidimensionalRows({
    docenteName: teacherName,
    offerProjection,
    teacherSnapshot
  });

  if (rows.length === 0) {
    container.innerHTML = `<div class="gantt-bi__empty">Nenhuma faixa visivel encontrada para <b>${escapeHtml(teacherName)}</b> no intervalo selecionado.</div>`;
    return;
  }

  const rangeStart = String(startDate || rows[0]?.startDate || '').trim() || rows[0].startDate;
  const rangeEnd = String(endDate || rows[rows.length - 1]?.endDate || '').trim() || rows[rows.length - 1].endDate;
  const totalDays = Math.max(1, daysBetween(rangeStart, rangeEnd) + 1);
  const dayWidth = resolveDayWidth(totalDays);
  const segmentHeight = 30;
  const rowPadding = 14;
  const timelineWidth = totalDays * dayWidth;
  const monthCells = buildMonthCells(rangeStart, rangeEnd, dayWidth);
  const { weekLines, monthLines } = buildVerticalLines(rangeStart, rangeEnd, dayWidth);
  const titleHours = Number.isFinite(Number(totalCH)) && Number(totalCH) > 0
    ? `${Number(totalCH)}h`
    : '-';

  const layout = {
    startDate: rangeStart,
    endDate: rangeEnd,
    dayWidth,
    segmentHeight,
    rowPadding,
    timelineWidth,
    weekLines,
    monthLines
  };

  container.innerHTML = `
    <div class="gantt-bi" style="--gantt-day-width:${dayWidth}px; --gantt-segment-height:${segmentHeight}px;">
      <h3 class="gantt-bi__title">Cronograma: ${escapeHtml(teacherName)} (${escapeHtml(titleHours)})</h3>
      <div class="gantt-bi__scroll">
        <div class="gantt-bi__canvas" style="width:${timelineWidth + 320}px;">
          <div class="gantt-bi__header">
            <div class="gantt-bi__header-label">Componente / Faixa</div>
            <div class="gantt-bi__header-timeline" style="width:${timelineWidth}px;">
              ${renderMonthCells(monthCells)}
              ${renderVerticalLines(monthLines, 'gantt-bi__line--month')}
            </div>
          </div>
          ${rows.map((row) => renderRow(row, layout)).join('')}
        </div>
      </div>
    </div>
  `;

  bindBidimensionalLensInteractions(container);
}

export function hideBidimensionalTeacherGanttLens() {
  hideBidimensionalLens(document.getElementById(LENS_ID));
}
