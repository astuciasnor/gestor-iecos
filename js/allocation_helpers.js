import { store } from './store.js??v=20260625v';

export function getAllocationModo(alloc) {
    return String(alloc?.modo || '').trim().toLowerCase();
}

export function isFaixaAllocation(alloc) {
    return getAllocationModo(alloc) === 'faixas';
}

export function isPriorityRegularAllocation(alloc) {
    return false; // Deprecated
}

export function isRegularAllocation(alloc) {
    return getAllocationModo(alloc) === 'semanal';
}

export function isScheduledRegularAllocation(alloc) {
    return isRegularAllocation(alloc);
}

export function isPendingAllocation(alloc) {
    return getAllocationModo(alloc) === 'pendente';
}

export function normalizeTeacherNameForMatch(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function teacherNamesMatch(candidate, selected) {
    const cand = normalizeTeacherNameForMatch(candidate);
    const target = normalizeTeacherNameForMatch(selected);
    if (!cand || !target) return false;
    if (cand === target) return true;

    const shorter = cand.length <= target.length ? cand : target;
    const longer = cand.length <= target.length ? target : cand;

    // Permite alias nominais (ex.: "Neide Ramos" vs "Maria Neide Ramos"),
    // evitando matches muito curtos e ambiguos.
    if (shorter.length >= 6 && shorter.split(' ').length >= 2 && longer.includes(shorter)) {
        return true;
    }
    return false;
}

export function allocationHasTeacherMatch(alloc, teacherName) {
    if (!alloc || !teacherName) return false;
    if (teacherNamesMatch(alloc.docente, teacherName)) return true;
    if (alloc.docente && typeof alloc.docente === 'object' && teacherNamesMatch(alloc.docente.nome, teacherName)) return true;
    if (Array.isArray(alloc.docentes)) {
        return alloc.docentes.some((d) => teacherNamesMatch(d?.nome || d, teacherName));
    }
    return false;
}

// Retorna o rotulo curto preferido do docente para exibicao compacta (Gantt,
// calendario, etc.). Usa o "apelido" cadastrado em dados_app.json
// (docentes[].apelido) quando existir; caso contrario, cai no primeiro nome.
export function getDocenteShortLabel(fullName) {
    const raw = String(fullName || '').trim();
    if (!raw) return '';
    const docentes = Array.isArray(store.rawData?.docentes) ? store.rawData.docentes : [];
    const match = docentes.find((d) => teacherNamesMatch(d?.docente, raw));
    const apelido = String(match?.apelido || '').trim();
    if (apelido) return apelido;
    return raw.split(/\s+/)[0] || raw;
}
