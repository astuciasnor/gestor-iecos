import { resolveActiveAcademicPeriod } from './academic_rules.mjs';
import { buildCanonicalOfferProjection } from './execution_engine.js';

// ==========================================
// EXPORTAÇÃO JSON (BACKUP E OFERTAS)
// ==========================================

export function buildPlanScopedPayload(scope, allocations, activePlanMeta, settings, extra = {}) {
    return {
        version: 2,
        scope,
        exportedAt: new Date().toISOString(),
        plan: activePlanMeta?.key ? activePlanMeta : null,
        settings: {
            termStart: settings.termStart,
            termEnd: settings.termEnd,
            periodo: settings.periodo,
            turnoOferta: settings.turnoOferta || ''
        },
        allocations,
        ...extra
    };
}

export function buildTurmaParaCursoMap(turmasRaws = []) {
    const turmaParaCurso = {};
    turmasRaws.forEach((t) => {
        if (t.turma_id && t.sigla) turmaParaCurso[String(t.turma_id)] = String(t.sigla);
    });
    return turmaParaCurso;
}

export function collectAllocationsByCurso(sigla, turmaParaCurso, allocations = []) {
    const cursoSigla = String(sigla || '').trim().toUpperCase();
    return allocations.filter((a) => turmaParaCurso[String(a.turmaId)] === cursoSigla);
}

export function buildTodosCursosExportSnapshot(allocations = [], turmasRaws = [], cursosRequeridos = ['EP', 'CB', 'CN']) {
    const turmaParaCurso = buildTurmaParaCursoMap(turmasRaws);
    const porCurso = {};
    const filteredAllocations = [];

    cursosRequeridos.forEach((sigla) => {
        const list = collectAllocationsByCurso(sigla, turmaParaCurso, allocations);
        porCurso[sigla] = list.length;
        filteredAllocations.push(...list);
    });

    return {
        porCurso,
        total: filteredAllocations.length,
        allocations: filteredAllocations
    };
}

// ==========================================
// EXPORTAÇÃO PÚBLICA (AGENDA WEB)
// ==========================================

export function resolvePublicPlanMeta(activePlanMeta, settings, officialPlans = []) {
    const preferredMeta = activePlanMeta?.key
        ? activePlanMeta
        : {
            periodo: settings.periodo,
            termStart: settings.termStart,
            termEnd: settings.termEnd
        };

    const resolved = resolveActiveAcademicPeriod({
        plans: officialPlans,
        preferredMeta,
        fallbackMeta: preferredMeta
    });

    const hasExactDateMatch = (
        resolved?.termStart &&
        resolved.termStart === preferredMeta.termStart &&
        resolved?.termEnd === preferredMeta.termEnd
    );

    return hasExactDateMatch ? resolved : preferredMeta;
}

export function buildPublicExportPayload(exportableAllocations = [], activePlanMeta, settings, officialPlans = []) {
    const publicPlan = resolvePublicPlanMeta(activePlanMeta, settings, officialPlans);
    const offerProjection = buildCanonicalOfferProjection({
        allocations: exportableAllocations,
        startDate: publicPlan?.termStart || settings.termStart,
        endDate: publicPlan?.termEnd || settings.termEnd
    });
    
    const docentes = [...new Set(
        exportableAllocations.flatMap((alloc) => {
            const names = [];
            if (typeof alloc?.docente === 'string') names.push(alloc.docente.trim());
            else if (alloc?.docente?.nome) names.push(String(alloc.docente.nome).trim());
            if (Array.isArray(alloc?.docentes)) {
                alloc.docentes.forEach((entry) => {
                    const nome = entry?.nome || entry;
                    if (nome) names.push(String(nome).trim());
                });
            }
            return names.filter((name) => name && name.toUpperCase() !== 'A DEFINIR');
        })
    )].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));

    const turmas = [...new Set(
        exportableAllocations
            .map((alloc) => String(alloc?.turmaId || '').trim())
            .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));

    return {
        version: 2,
        exportedAt: new Date().toISOString(),
        plan: publicPlan?.key ? publicPlan : null,
        meta: {
            publicationTarget: 'web_public',
            periodoLetivo: publicPlan?.periodo || settings.periodo || '',
            docenteCount: docentes.length,
            turmaCount: turmas.length,
            offerCount: Array.isArray(offerProjection?.offerGroups) ? offerProjection.offerGroups.length : 0,
            docentes,
            turmas
        },
        allocations: exportableAllocations,
        offers: Array.isArray(offerProjection?.offerGroups) ? offerProjection.offerGroups : [],
        settings: {
            termStart: publicPlan?.termStart || settings.termStart,
            termEnd: publicPlan?.termEnd || settings.termEnd,
            periodo: publicPlan?.periodo || settings.periodo,
            turnoOferta: settings.turnoOferta || ''
        }
    };
}

// ==========================================
// IMPORTAÇÃO E RESTAURAÇÃO DE BACKUP
// ==========================================

export function parseBackupDataFile(fileContent) {
    try {
        const parsed = JSON.parse(fileContent);
        const allocations = Array.isArray(parsed)
            ? parsed
            : (Array.isArray(parsed?.allocations) ? parsed.allocations : null);

        if (!allocations) return { success: false, error: 'Formato de allocations invalido' };

        return { success: true, parsed, allocations };
    } catch (e) {
        return { success: false, error: 'Erro de sintaxe JSON' };
    }
}

export function extractImportPlanMeta(parsed, resolveOfficialFn) {
    const rawPlan = parsed?.plan || (parsed?.meta?.plan
        ? parsed.meta.plan
        : (parsed?.meta?.periodoLetivo && parsed?.meta?.termStart)
            ? {
                periodo: parsed.meta.periodoLetivo,
                termStart: parsed.meta.termStart,
                termEnd: parsed.meta.termEnd || ''
            }
            : null);

    if (!rawPlan) return null;

    const normalized = resolveOfficialFn ? resolveOfficialFn(rawPlan) : rawPlan;
    return normalized?.key ? normalized : null;
}
