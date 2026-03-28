export const SETTINGS_KEY = 'academic_settings';
export const LEGACY_ALLOCATIONS_KEY = 'academic_allocations';
export const PLAN_INDEX_KEY = 'academic_plan_index_v1';
export const PLAN_PREFIX = 'academic_plan_v1::';
export const LEGACY_MIGRATION_KEY = 'academic_plan_legacy_migrated_v1';

function normalizeIsoDate(value) {
  const raw = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

export function isValidIsoDate(value) {
  return !!normalizeIsoDate(value);
}

export function normalizePeriodo(value) {
  const raw = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!raw) return '';
  const plMatch = raw.match(/^PL(\d{1,2})$/);
  if (plMatch) return `PL${parseInt(plMatch[1], 10)}`;

  const legacyMatch = raw.match(/^(\d{1,2})P$/);
  if (legacyMatch) return `PL${parseInt(legacyMatch[1], 10)}`;

  const numericMatch = raw.match(/^\d{1,2}$/);
  if (numericMatch) return `PL${parseInt(numericMatch[0], 10)}`;

  const genericMatch = raw.match(/\d{1,2}/);
  if (!genericMatch) return raw;
  return `PL${parseInt(genericMatch[0], 10)}`;
}

export function buildPlanKey(meta = {}) {
  const termStart = normalizeIsoDate(meta.termStart);
  const termEnd = normalizeIsoDate(meta.termEnd);
  const periodo = normalizePeriodo(meta.periodo);
  if (!termStart || !termEnd || !periodo) return '';
  return `${periodo}__${termStart}__${termEnd}`;
}

export function buildPlanLabel(meta = {}) {
  const termStart = normalizeIsoDate(meta.termStart);
  const termEnd = normalizeIsoDate(meta.termEnd);
  const periodo = normalizePeriodo(meta.periodo);
  if (!periodo && !termStart && !termEnd) return 'Plano sem periodo definido';
  return `${periodo || 'Periodo'} | ${termStart || 'sem inicio'} a ${termEnd || 'sem fim'}`;
}

export function normalizePlanMeta(meta = {}) {
  const normalized = {
    periodo: normalizePeriodo(meta.periodo),
    termStart: normalizeIsoDate(meta.termStart),
    termEnd: normalizeIsoDate(meta.termEnd)
  };
  normalized.key = buildPlanKey(normalized);
  normalized.label = buildPlanLabel(normalized);
  return normalized;
}

export function isCompletePlanMeta(meta = {}) {
  const normalized = normalizePlanMeta(meta);
  return !!(normalized.key && normalized.termStart && normalized.termEnd && normalized.periodo);
}

export function getPlanStorageKey(metaOrKey) {
  const key = typeof metaOrKey === 'string' ? String(metaOrKey || '').trim() : buildPlanKey(metaOrKey);
  return key ? `${PLAN_PREFIX}${key}` : '';
}

export function readJsonStorage(storage, key, fallback) {
  if (!storage || !key) return fallback;
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJsonStorage(storage, key, value) {
  if (!storage || !key) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function comparePlanEntries(a, b) {
  const byStart = String(b.termStart || '').localeCompare(String(a.termStart || ''));
  if (byStart !== 0) return byStart;
  const byPeriodo = String(b.periodo || '').localeCompare(String(a.periodo || ''));
  if (byPeriodo !== 0) return byPeriodo;
  return String(b.termEnd || '').localeCompare(String(a.termEnd || ''));
}

export function readPlanIndex(storage = localStorage) {
  const raw = readJsonStorage(storage, PLAN_INDEX_KEY, []);
  if (!Array.isArray(raw)) return [];

  const deduped = new Map();
  raw.forEach((entry) => {
    const normalized = normalizePlanMeta(entry);
    if (!isCompletePlanMeta(normalized)) return;
    const previous = deduped.get(normalized.key) || {};
    deduped.set(normalized.key, {
      ...previous,
      ...entry,
      ...normalized,
      allocationCount: Number.isFinite(entry?.allocationCount) ? Number(entry.allocationCount) : (previous.allocationCount || 0)
    });
  });

  return [...deduped.values()].sort(comparePlanEntries);
}

export function writePlanIndex(storage = localStorage, entries = []) {
  const normalizedEntries = [];
  const seen = new Set();

  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const normalized = normalizePlanMeta(entry);
    if (!isCompletePlanMeta(normalized) || seen.has(normalized.key)) return;
    seen.add(normalized.key);
    normalizedEntries.push({
      key: normalized.key,
      label: normalized.label,
      periodo: normalized.periodo,
      termStart: normalized.termStart,
      termEnd: normalized.termEnd,
      allocationCount: Number.isFinite(entry?.allocationCount) ? Number(entry.allocationCount) : 0,
      updatedAt: entry?.updatedAt || new Date().toISOString()
    });
  });

  normalizedEntries.sort(comparePlanEntries);
  return writeJsonStorage(storage, PLAN_INDEX_KEY, normalizedEntries);
}

export function upsertPlanIndexEntry(storage = localStorage, meta = {}, extra = {}) {
  const normalized = normalizePlanMeta(meta);
  if (!isCompletePlanMeta(normalized)) return [];

  const current = readPlanIndex(storage);
  const previous = current.find((entry) => entry.key === normalized.key) || {};
  const nextEntry = {
    ...previous,
    ...normalized,
    allocationCount: Number.isFinite(extra?.allocationCount)
      ? Number(extra.allocationCount)
      : Number.isFinite(previous?.allocationCount)
        ? Number(previous.allocationCount)
        : 0,
    updatedAt: extra?.updatedAt || new Date().toISOString()
  };
  const next = current.filter((entry) => entry.key !== normalized.key);
  next.push(nextEntry);
  writePlanIndex(storage, next);
  return readPlanIndex(storage);
}
