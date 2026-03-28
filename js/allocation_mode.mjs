export const ALLOCATION_MODES = Object.freeze({
  WEEKLY: 'semanal',
  FAIXAS: 'faixas',
  PENDING: 'pendente'
});

const VALID_ALLOCATION_MODES = new Set(Object.values(ALLOCATION_MODES));

const LEGACY_TIPO_TO_MODO = Object.freeze({
  intensiva: ALLOCATION_MODES.FAIXAS,
  regular: ALLOCATION_MODES.WEEKLY,
  regular_prioritaria: ALLOCATION_MODES.WEEKLY,
  pendente: ALLOCATION_MODES.PENDING
});

export function normalizeAllocationModo(value = '', fallback = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (VALID_ALLOCATION_MODES.has(normalized)) return normalized;

  const normalizedFallback = String(fallback || '').trim().toLowerCase();
  return VALID_ALLOCATION_MODES.has(normalizedFallback) ? normalizedFallback : '';
}

export function resolveLegacyTipoToModo(tipo = '') {
  const normalized = String(tipo || '').trim().toLowerCase();
  return LEGACY_TIPO_TO_MODO[normalized] || '';
}

export function inferAllocationModo(input = null) {
  if (typeof input === 'string') {
    return normalizeAllocationModo(input) || resolveLegacyTipoToModo(input) || '';
  }

  const allocation = input && typeof input === 'object' ? input : {};

  return normalizeAllocationModo(allocation?.modo)
    || resolveLegacyTipoToModo(allocation?.tipo)
    || (Array.isArray(allocation?.faixas) && allocation.faixas.length > 0 ? ALLOCATION_MODES.FAIXAS : '')
    || ALLOCATION_MODES.WEEKLY;
}

export function canonicalizeAllocationModo(allocation, { dropLegacyTipo = true } = {}) {
  if (!allocation || typeof allocation !== 'object') return allocation;

  allocation.modo = inferAllocationModo(allocation);

  if (dropLegacyTipo && Object.prototype.hasOwnProperty.call(allocation, 'tipo')) {
    delete allocation.tipo;
  }

  return allocation;
}

export function isAllocationModo(input, expectedModo = '') {
  const expected = normalizeAllocationModo(expectedModo) || resolveLegacyTipoToModo(expectedModo);
  if (!expected) return false;
  return inferAllocationModo(input) === expected;
}

export function getAllocationModoLabel(input, labels = {}) {
  const {
    defaultLabel = 'Oferta',
    weeklyLabel = defaultLabel,
    faixasLabel = 'Oferta por Faixas',
    pendingLabel = 'Pendente'
  } = labels || {};

  const modo = inferAllocationModo(input);
  if (modo === ALLOCATION_MODES.FAIXAS) return faixasLabel;
  if (modo === ALLOCATION_MODES.PENDING) return pendingLabel;
  if (modo === ALLOCATION_MODES.WEEKLY) return weeklyLabel;
  return defaultLabel;
}
