// Exportacao do arquivo de metadados SIGAA da turma (botao "Exportar JSON SIGAA",
// js/main.js). Saiu do ui.js em 20/11/2026 sem mudar nada. O payload e a
// validacao estao em sigaa_metadata.js; aqui so o plano ativo e o download.
import { store } from './store.js?v=202611281736';
import { buildCanonicalOfferProjection } from './execution_engine.js?v=202611281736';
import { buildSigaaMetadataPayload, validateSigaaMetadataPayload } from './sigaa_metadata.js?v=202611281736';
import { getDisciplinaInfo } from './curso_turma_helpers.js?v=202611281736';
import { formatDateBR } from './date_utils_ui.js?v=202611281736';
import { showToastWarning } from './ui_feedback.js?v=202611281736';

// Datas do calendario da barra lateral (reserva quando o plano nao tem datas).
const calStart = () => document.getElementById('cal-start');
const calEnd = () => document.getElementById('cal-end');

function getActiveExportPlanContext() {
    const activePlan = store.getActivePlanMeta();
    const plan = activePlan?.key ? activePlan : null;
    const termStart = plan?.termStart || store.settings.termStart || (calStart() ? calStart().value : '2025-01-01');
    const termEnd = plan?.termEnd || store.settings.termEnd || (calEnd() ? calEnd().value : '2025-12-31');
    const periodoLetivo = plan?.periodo || store.settings.periodo || '';
    return { plan, termStart, termEnd, periodoLetivo };
}

export function exportSigaaMetadataJSON() {
    const planContext = getActiveExportPlanContext();
    const turmaAllocations = store.allocations.filter((alloc) => String(alloc?.turmaId || '') === String(store.selectedTurma || ''));
    const offerProjection = buildCanonicalOfferProjection({
        allocations: turmaAllocations,
        startDate: planContext.termStart,
        endDate: planContext.termEnd
    });
    
    const dataContext = {
        store,
        planContext,
        turmaId: String(store.selectedTurma || ''),
        unifiedExec: offerProjection,
        offerProjection
    };
    
    const contextMap = {
        getDisciplinaInfo,
        formatDateBR
    };

    const payload = buildSigaaMetadataPayload(dataContext, contextMap);
    if (!payload) {
        showToastWarning('Selecione uma turma antes de exportar os metadados SIGAA.', 'warning', 2600);
        return;
    }

    const issues = validateSigaaMetadataPayload(payload);
    if (issues.length) {
        showToastWarning(
            'Exportacao SIGAA cancelada por inconsistencias:<br>- ' + issues.join('<br>- '),
            'error',
            5600
        );
        return;
    }

    const ano = (payload.termStart || '').split('-')[0] || '0000';
    const periodo = payload.periodoLetivo || 'P';
    const fileName = `sigaa_metadata_${payload.cursoSigla || 'CURSO'}_${payload.turmaId}_${ano}_${periodo}.json`;
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(payload, null, 2));
    const a = document.createElement('a');
    a.setAttribute('href', dataStr);
    a.setAttribute('download', fileName);
    document.body.appendChild(a);
    a.click();
    a.remove();
}
