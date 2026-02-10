import { generateUUID } from './utils.js';

class Store {
    constructor() {
        this.rawData = null;
        this.allocations = [];
        this.selectedCurso = null;
        this.selectedTurma = null;
    }

    async loadData() {
        try {
            const response = await fetch('dados_app.json');
            this.rawData = await response.json();
            this.loadAllocations();
        } catch (e) {
            console.error("Erro ao carregar dados_app.json", e);
            alert("Erro: dados_app.json não encontrado ou inválido. Verifique o console.");
        }
    }

    loadAllocations() {
        const saved = localStorage.getItem('academic_allocations');
        if (saved) {
            this.allocations = JSON.parse(saved);
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
        if(confirm("Tem certeza? Isso apagará todas as alocações deste navegador.")){
            localStorage.removeItem('academic_allocations');
            this.allocations = [];
            window.location.reload();
        }
    }

    getHorariosTurma() {
        if (!this.selectedTurma || !this.rawData) return [];
        const turmaObj = this.rawData.turmas.find(t => t.turma_id === this.selectedTurma);
        if (!turmaObj) return [];
        
        const turno = turmaObj.turno || 'Tarde'; 

        if (turno === 'Manhã') {
            return this.rawData.horarios['manha_extendido'] || [];
        } else {
            return this.rawData.horarios['tarde_extendido'] || [];
        }
    }

    getDisciplinaColor(nome) {
        if(!this.rawData) return '#ccc';
        const disc = this.rawData.disciplinas.find(d => d.nome === nome);
        return disc ? disc.cor_disciplina : '#e0e0e0';
    }
}

export const store = new Store();