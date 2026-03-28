import {
  LEGACY_ALLOCATIONS_KEY,
  LEGACY_MIGRATION_KEY,
  SETTINGS_KEY,
  getPlanStorageKey,
  isCompletePlanMeta,
  normalizePlanMeta,
  readJsonStorage,
  upsertPlanIndexEntry,
  writeJsonStorage
} from './plan_storage.js';
import { generateUUID } from './utils.js';

import { normalizeTurnoKey } from './turns.js';

function normalizeTurnoKeyLocal() { } // Dummy to prevent line mismatch but we just remove the real one
export function normalizeLoadedAllocation(alloc) {
  if (!alloc || typeof alloc !== 'object') return alloc;

  if (alloc.tipo !== undefined) {
    const tipo = String(alloc.tipo).trim().toLowerCase();

    if (tipo === 'intensiva') {
      alloc.modo = 'faixas';
    } else if (tipo === 'regular' || tipo === 'regular_prioritaria') {
      alloc.modo = 'semanal';
    } else if (tipo === 'pendente') {
      alloc.modo = 'pendente';
    } else {
      alloc.modo = 'semanal';
    }

    delete alloc.tipo;
  }

  if (!alloc.modo) {
    if (Array.isArray(alloc.faixas) && alloc.faixas.length > 0) {
      alloc.modo = 'faixas';
    } else {
      alloc.modo = 'semanal';
    }
  }

  return alloc;
}

class Store {
  constructor() {
    this.rawData = null;
    this.allocations = [];
    this.selectedCurso = null; // sigla do curso (ex.: "EP")
    this.selectedTurma = null; // turma_id (ex.: "EP2025")

    this.settings = {
      termStart: '',
      termEnd: '',
      turnoOferta: '', // "Manha" | "Tarde" | ...
      periodo: 'PL1',
      lastCurso: '',
      lastTurma: '',
      lastStartByTurma: {}
    };

    this.loadSettings();
    this.activePlanMeta = this.getPlanMetaFromSettings();
  }

  // ===== Settings =====
  loadSettings() {
    try {
      const obj = readJsonStorage(localStorage, SETTINGS_KEY, null);
      if (obj && typeof obj === 'object') {
        this.settings = { ...this.settings, ...obj };
      }
    } catch (e) {
      console.warn('Falha ao carregar academic_settings:', e);
    }
  }

  saveSettings() {
    try {
      writeJsonStorage(localStorage, SETTINGS_KEY, this.settings);
    } catch (e) {
      console.warn('Falha ao salvar academic_settings:', e);
    }
  }

  setTermDates(start, end) {
    if (start !== undefined) this.settings.termStart = start || '';
    if (end !== undefined) this.settings.termEnd = end || '';
    this.activePlanMeta = this.getPlanMetaFromSettings();
    this.saveSettings();
  }

  setTurnoOferta(turno) {
    if (turno !== undefined) this.settings.turnoOferta = turno || '';
    this.saveSettings();
  }

  setPeriodo(periodo) {
    if (periodo !== undefined) this.settings.periodo = periodo || '';
    this.activePlanMeta = this.getPlanMetaFromSettings();
    this.saveSettings();
  }

  setLastContext(curso, turma) {
    if (curso !== undefined) this.settings.lastCurso = curso || '';
    if (turma !== undefined) this.settings.lastTurma = turma || '';
    this.saveSettings();
  }

  getTurmaLastStartKey(turmaId) {
    if (!turmaId) return '';
    const planKey = this.activePlanMeta?.key || this.getPlanMetaFromSettings()?.key || '';
    return planKey ? `${planKey}::${String(turmaId)}` : String(turmaId);
  }

  getTurmaLastStart(turmaId) {
    if (!turmaId) return '';
    const map = this.settings?.lastStartByTurma;
    if (!map || typeof map !== 'object') return '';
    const scopedKey = this.getTurmaLastStartKey(turmaId);
    if (scopedKey && map[scopedKey]) return String(map[scopedKey] || '');
    if (!this.activePlanMeta?.key && map[String(turmaId)]) return String(map[String(turmaId)] || '');
    return '';
  }

  setTurmaLastStart(turmaId, startDate) {
    if (!turmaId || !startDate) return;
    if (!this.settings.lastStartByTurma || typeof this.settings.lastStartByTurma !== 'object') {
      this.settings.lastStartByTurma = {};
    }
    const scopedKey = this.getTurmaLastStartKey(turmaId);
    this.settings.lastStartByTurma[scopedKey || String(turmaId)] = String(startDate);
    this.saveSettings();
  }

  getPlanMetaFromSettings(overrides = {}) {
    return normalizePlanMeta({
      termStart: overrides.termStart !== undefined ? overrides.termStart : this.settings.termStart,
      termEnd: overrides.termEnd !== undefined ? overrides.termEnd : this.settings.termEnd,
      periodo: overrides.periodo !== undefined ? overrides.periodo : this.settings.periodo
    });
  }

  getActivePlanMeta() {
    return { ...this.activePlanMeta };
  }

  getPlanStorageKey(meta = this.activePlanMeta) {
    return getPlanStorageKey(meta);
  }

  // ===== Data =====
  async loadData() {
    try {
      const response = await fetch('dados_app.json');
      this.rawData = await response.json();
      this.loadAllocations();
    } catch (e) {
      console.error('Erro ao carregar dados_app.json', e);
      alert('Erro: dados_app.json nao encontrado ou invalido. Verifique o console.');
    }
  }

  readLegacyAllocations() {
    const saved = readJsonStorage(localStorage, LEGACY_ALLOCATIONS_KEY, []);
    return (Array.isArray(saved) ? saved : []).map(normalizeLoadedAllocation);
  }

  readPlanAllocations(meta = this.activePlanMeta) {
    const storageKey = this.getPlanStorageKey(meta);
    if (!storageKey) return [];
    const saved = readJsonStorage(localStorage, storageKey, []);
    return (Array.isArray(saved) ? saved : []).map(normalizeLoadedAllocation);
  }

  maybeMigrateLegacyAllocations(meta = this.activePlanMeta) {
    const normalized = normalizePlanMeta(meta);
    if (!isCompletePlanMeta(normalized)) return false;

    if (localStorage.getItem(LEGACY_MIGRATION_KEY) === '1') return false;

    const legacyAllocations = this.readLegacyAllocations();
    if (!legacyAllocations.length) return false;

    const storageKey = this.getPlanStorageKey(normalized);
    const existingPlanAllocations = readJsonStorage(localStorage, storageKey, null);
    if (Array.isArray(existingPlanAllocations)) {
      localStorage.setItem(LEGACY_MIGRATION_KEY, '1');
      upsertPlanIndexEntry(localStorage, normalized, {
        allocationCount: existingPlanAllocations.length
      });
      return false;
    }

    writeJsonStorage(localStorage, storageKey, legacyAllocations);
    upsertPlanIndexEntry(localStorage, normalized, {
      allocationCount: legacyAllocations.length
    });
    localStorage.setItem(LEGACY_MIGRATION_KEY, '1');
    return true;
  }

  registerCurrentPlan(allocationCount = this.allocations.length) {
    if (!isCompletePlanMeta(this.activePlanMeta)) return;
    upsertPlanIndexEntry(localStorage, this.activePlanMeta, { allocationCount });
  }

  loadAllocations(meta = null) {
    const planMeta = meta ? normalizePlanMeta(meta) : this.getPlanMetaFromSettings();
    this.activePlanMeta = planMeta;

    if (isCompletePlanMeta(planMeta)) {
      this.maybeMigrateLegacyAllocations(planMeta);
      this.allocations = this.readPlanAllocations(planMeta);
      this.registerCurrentPlan(this.allocations.length);
      return this.allocations;
    }

    this.allocations = this.readLegacyAllocations();
    return this.allocations;
  }

  saveAllocations() {
    if (isCompletePlanMeta(this.activePlanMeta)) {
      const storageKey = this.getPlanStorageKey(this.activePlanMeta);
      writeJsonStorage(localStorage, storageKey, this.allocations);
      this.registerCurrentPlan(this.allocations.length);
      return;
    }

    writeJsonStorage(localStorage, LEGACY_ALLOCATIONS_KEY, this.allocations);
  }

  applyPlanContext(meta = {}) {
    const normalized = this.getPlanMetaFromSettings(meta);

    if (meta.termStart !== undefined) this.settings.termStart = normalized.termStart;
    if (meta.termEnd !== undefined) this.settings.termEnd = normalized.termEnd;
    if (meta.periodo !== undefined) this.settings.periodo = normalized.periodo || this.settings.periodo;

    this.activePlanMeta = normalized;
    this.saveSettings();
    this.loadAllocations(normalized);

    return {
      meta: this.getActivePlanMeta(),
      allocationCount: this.allocations.length
    };
  }

  replaceAllocations(newAllocations = []) {
    this.allocations = Array.isArray(newAllocations) ? [...newAllocations] : [];
    this.saveAllocations();
    return this.allocations.length;
  }

  addAllocation(alloc) {
    alloc.id = generateUUID();
    this.allocations.push(alloc);
    this.saveAllocations();
  }

  removeAllocation(id) {
    this.allocations = this.allocations.filter((a) => a.id !== id);
    this.saveAllocations();
  }

  mergeAllocations(newAllocations) {
    let addedCount = 0;
    newAllocations.forEach((newAlloc) => {
      const exists = this.allocations.some((a) => a.id === newAlloc.id);
      if (!exists) {
        this.allocations.push(newAlloc);
        addedCount++;
      }
    });
    this.saveAllocations();
    return addedCount;
  }

  clearData() {
    const activePlan = this.getActivePlanMeta();
    const scopeLabel = isCompletePlanMeta(activePlan)
      ? `do plano letivo ativo (${activePlan.periodo}: ${activePlan.termStart} a ${activePlan.termEnd})`
      : 'deste navegador';

    if (confirm(`Tem certeza? Isso apagara todas as alocacoes ${scopeLabel}.`)) {
      if (isCompletePlanMeta(activePlan)) {
        const storageKey = this.getPlanStorageKey(activePlan);
        localStorage.removeItem(storageKey);
        this.registerCurrentPlan(0);
      } else {
        localStorage.removeItem(LEGACY_ALLOCATIONS_KEY);
      }
      this.allocations = [];
      window.location.reload();
    }
  }

  // ===== Horarios (NOVA FONTE: horarios_por_turno) =====
  getHorariosTurma() {
    if (!this.selectedTurma || !this.rawData) return [];

    const turmaObj = (this.rawData.turmas || []).find((t) => String(t.turma_id) === String(this.selectedTurma));
    if (!turmaObj) return [];

    const turno = this.settings.turnoOferta || turmaObj.turno || 'Tarde';

    const hp = this.rawData.horarios_por_turno;
    if (hp && typeof hp === 'object') {
      if (Array.isArray(hp[turno])) return hp[turno];
      const normalizedTurno = normalizeTurnoKey(turno);
      const key = Object.keys(hp).find((k) => normalizeTurnoKey(k) === normalizedTurno);
      if (key && Array.isArray(hp[key])) return hp[key];
    }

    if (Array.isArray(this.rawData.horarios)) {
      return this.rawData.horarios
        .filter((h) => normalizeTurnoKey(h.turno) === normalizeTurnoKey(turno))
        .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
        .map((h) => h.faixa)
        .filter((x) => typeof x === 'string');
    }

    return [];
  }

  // ===== Cor (NOVA FONTE: componentes.cor) =====
  getDisciplinaColor(nomeComponente) {
    if (!this.rawData) return '#e0e0e0';

    const comps = this.rawData.componentes || [];
    const c = comps.find((x) => x.componente === nomeComponente);
    return c ? (c.cor || '#e0e0e0') : '#e0e0e0';
  }

}

export const store = new Store();
