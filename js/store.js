import { generateUUID } from './utils.js';

class Store {
  constructor() {
    this.rawData = null;
    this.allocations = [];
    this.selectedCurso = null; // sigla do curso (ex.: "EP")
    this.selectedTurma = null; // turma_id (ex.: "EP2025")

    this.settings = {
      termStart: '',
      termEnd: '',
      turnoOferta: '', // "Manhã" | "Tarde" | ...
      lastCurso: '',   // PERSISTÊNCIA
      lastTurma: ''    // PERSISTÊNCIA
    };

    this.loadSettings();
  }

  // ===== Settings =====
  loadSettings() {
    try {
      const saved = localStorage.getItem('academic_settings');
      if (saved) {
        const obj = JSON.parse(saved);
        if (obj && typeof obj === 'object') {
          this.settings = { ...this.settings, ...obj };
        }
      }
    } catch (e) {
      console.warn('Falha ao carregar academic_settings:', e);
    }
  }

  saveSettings() {
    try {
      localStorage.setItem('academic_settings', JSON.stringify(this.settings));
    } catch (e) {
      console.warn('Falha ao salvar academic_settings:', e);
    }
  }

  setTermDates(start, end) {
    if (start) this.settings.termStart = start;
    if (end) this.settings.termEnd = end;
    this.saveSettings();
  }

  setTurnoOferta(turno) {
    if (turno) this.settings.turnoOferta = turno;
    this.saveSettings();
  }

  // NOVO: Persistência de contexto
  setLastContext(curso, turma) {
      if (curso) this.settings.lastCurso = curso;
      if (turma) this.settings.lastTurma = turma;
      this.saveSettings();
  }

  // ===== Data =====
  async loadData() {
    try {
      const response = await fetch('dados_app.json');
      this.rawData = await response.json();
      this.loadAllocations();
    } catch (e) {
      console.error('Erro ao carregar dados_app.json', e);
      alert('Erro: dados_app.json não encontrado ou inválido. Verifique o console.');
    }
  }

  loadAllocations() {
    const saved = localStorage.getItem('academic_allocations');
    if (saved) {
      try {
        this.allocations = JSON.parse(saved);
      } catch {
        this.allocations = [];
      }
    }
  }

  saveAllocations() {
    localStorage.setItem('academic_allocations', JSON.stringify(this.allocations));
  }

  addAllocation(alloc) {
    alloc.id = generateUUID();
    this.allocations.push(alloc);
    this.saveAllocations();
  }

  removeAllocation(id) {
    this.allocations = this.allocations.filter(a => a.id !== id);
    this.saveAllocations();
  }

  mergeAllocations(newAllocations) {
    let addedCount = 0;
    newAllocations.forEach(newAlloc => {
      const exists = this.allocations.some(a => a.id === newAlloc.id);
      if (!exists) {
        this.allocations.push(newAlloc);
        addedCount++;
      }
    });
    this.saveAllocations();
    return addedCount;
  }

  clearData() {
    if (confirm('Tem certeza? Isso apagará todas as alocações deste navegador.')) {
      localStorage.removeItem('academic_allocations');
      this.allocations = [];
      window.location.reload();
    }
  }

  // ===== Horários (NOVA FONTE: horarios_por_turno) =====
  getHorariosTurma() {
    if (!this.selectedTurma || !this.rawData) return [];

    const turmaObj = (this.rawData.turmas || []).find(t => String(t.turma_id) === String(this.selectedTurma));
    if (!turmaObj) return [];

    const turno = this.settings.turnoOferta || turmaObj.turno || 'Tarde';

    // 1) Preferencial: horarios_por_turno
    const hp = this.rawData.horarios_por_turno;
    if (hp && typeof hp === 'object') {
      if (Array.isArray(hp[turno])) return hp[turno];
      // fallback por normalização simples
      const key = Object.keys(hp).find(k => k.toLowerCase() === String(turno).toLowerCase());
      if (key && Array.isArray(hp[key])) return hp[key];
    }

    // 2) Fallback: filtra do array "horarios" (se existir)
    if (Array.isArray(this.rawData.horarios)) {
      return this.rawData.horarios
        .filter(h => String(h.turno) === String(turno))
        .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
        .map(h => h.faixa)
        .filter(x => typeof x === 'string');
    }

    return [];
  }

  // ===== Cor (NOVA FONTE: componentes.cor) =====
  getDisciplinaColor(nomeComponente) {
    if (!this.rawData) return '#e0e0e0';

    const comps = this.rawData.componentes || [];
    const c = comps.find(x => x.componente === nomeComponente);
    return c ? (c.cor || '#e0e0e0') : '#e0e0e0';
  }
}

export const store = new Store();