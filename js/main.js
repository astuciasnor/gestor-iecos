import { store } from './store.js??v=20260625v';
import { initUI, exportSigaaMetadataJSON, showToastWarning } from './ui.js??v=20260627v44';
import { filterExportableAllocations, resolveActiveAcademicPeriod } from './academic_rules.mjs';
import {
  buildPlanScopedPayload,
  buildTurmaParaCursoMap,
  collectAllocationsByCurso,
  buildTodosCursosExportSnapshot,
  buildPublicExportPayload
} from './serialization.js';

const EXPORT_CURSOS_UNIDADE = ['EP', 'CB', 'CN'];

function isValidIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validatePublicExportData(exportData) {
  const issues = [];
  if (!exportData || typeof exportData !== 'object') {
    issues.push('Payload inválido para exportação pública.');
    return issues;
  }

  const { allocations, settings } = exportData;
  if (!Array.isArray(allocations)) {
    issues.push('Campo allocations ausente ou inválido.');
  } else if (!allocations.length) {
    issues.push('Nenhuma alocação encontrada para publicar.');
  }

  if (!settings || typeof settings !== 'object') {
    issues.push('Configurações do semestre ausentes.');
    return issues;
  }

  if (!isValidIsoDate(settings.termStart)) {
    issues.push('Data inicial do semestre inválida.');
  }
  if (!isValidIsoDate(settings.termEnd)) {
    issues.push('Data final do semestre inválida.');
  }
  if (
    isValidIsoDate(settings.termStart) &&
    isValidIsoDate(settings.termEnd) &&
    settings.termStart > settings.termEnd
  ) {
    issues.push('Data inicial do semestre maior que a data final.');
  }

  if (exportData.meta && typeof exportData.meta !== 'object') {
    issues.push('Campo meta inválido para exportação pública.');
  }

  return issues;
}

function formatTimestampForFileName(date = new Date()) {
  const pad = (v) => String(v).padStart(2, '0');
  const yyyy = String(date.getFullYear());
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  return `${yyyy}-${mm}-${dd}_${hh}-${mi}`;
}

function sanitizeFilePart(value) {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildPlanFileFragment(planMeta = store.getActivePlanMeta()) {
  if (!planMeta?.key) return '';
  const parts = [
    sanitizeFilePart(planMeta.periodo || 'P'),
    sanitizeFilePart(planMeta.termStart || ''),
    sanitizeFilePart(planMeta.termEnd || '')
  ].filter(Boolean);
  return parts.length ? `${parts.join('_')}_` : '';
}

function buildBackupFilename(scope = 'TODOS') {
  const stamp = formatTimestampForFileName(new Date());
  const planPart = buildPlanFileFragment();
  if (scope === 'TODOS') return `backup_iecos_${planPart}${stamp}.json`;
  return `backup_iecos_${scope}_${planPart}${stamp}.json`;
}



function getOfficialPlanCandidates() {
  return (Array.isArray(store.rawData?.periodos_letivos) ? store.rawData.periodos_letivos : []).map((item) => ({
    periodo: item?.periodo_letivo || item?.periodo || '',
    termStart: item?.inicio || '',
    termEnd: item?.fim || '',
    ano: item?.ano || ''
  }));
}





function downloadJSONFile(payload, fileName) {
  const dataStr =
    'data:text/json;charset=utf-8,' +
    encodeURIComponent(JSON.stringify(payload, null, 2));

  const a = document.createElement('a');
  a.setAttribute('href', dataStr);
  a.setAttribute('download', fileName);
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function exportarJSONTodosCursos(snapshot = null) {
  const effective = snapshot || buildTodosCursosExportSnapshot(store.allocations, store.rawData?.turmas, EXPORT_CURSOS_UNIDADE);
  const fileName = buildBackupFilename('TODOS');
  downloadJSONFile(
    buildPlanScopedPayload('TODOS', effective.allocations, store.getActivePlanMeta(), store.settings, {
      porCurso: effective.porCurso,
      total: effective.total
    }),
    fileName
  );
}

function exportarJSONCurso(sigla) {
  const cursoSigla = String(sigla || '').trim().toUpperCase();
  if (!EXPORT_CURSOS_UNIDADE.includes(cursoSigla)) {
    showToastWarning('Selecione um curso para exportar.', 'warning', 2200);
    return;
  }

  const turmaParaCurso = buildTurmaParaCursoMap(store.rawData?.turmas);
  const dadosExportar = collectAllocationsByCurso(cursoSigla, turmaParaCurso, store.allocations);
  const fileName = buildBackupFilename(cursoSigla);
  downloadJSONFile(
    buildPlanScopedPayload(cursoSigla, dadosExportar, store.getActivePlanMeta(), store.settings, {
      turmaCount: Object.keys(turmaParaCurso).length
    }),
    fileName
  );
}

// Executar imediatamente (scripts type="module" já são diferidos e o DOM já deve estar pronto)
(async () => {
  await store.loadData();
  initUI();

  const btnExport = document.getElementById('btn-export');
  const exportScopeModal = document.getElementById('export-scope-modal');
  const btnExportScopeAll = document.getElementById('btn-export-scope-all');
  const btnExportScopeOne = document.getElementById('btn-export-scope-one');
  const exportScopeCourseArea = document.getElementById('export-scope-course-area');
  const selExportScopeCourse = document.getElementById('sel-export-scope-course');
  const btnExportScopeCourse = document.getElementById('btn-export-scope-course');
  const btnExportScopeCancel = document.getElementById('btn-export-scope-cancel');
  const exportScopeAllSummary = document.getElementById('export-scope-all-summary');
  const exportScopeAllSummaryBody = document.getElementById('export-scope-all-summary-body');
  const btnExportScopeAllDownload = document.getElementById('btn-export-scope-all-download');
  let pendingAllExportSnapshot = null;

  const updateExportCourseActionState = () => {
    if (!btnExportScopeCourse || !selExportScopeCourse) return;
    btnExportScopeCourse.disabled = !selExportScopeCourse.value;
  };

  const hideAllSummary = () => {
    pendingAllExportSnapshot = null;
    if (exportScopeAllSummary) exportScopeAllSummary.classList.add('hidden');
    if (exportScopeAllSummaryBody) exportScopeAllSummaryBody.innerHTML = '';
    if (btnExportScopeAllDownload) btnExportScopeAllDownload.disabled = true;
  };

  const renderAllSummary = (snapshot) => {
    if (!exportScopeAllSummary || !exportScopeAllSummaryBody || !btnExportScopeAllDownload) return;
    exportScopeAllSummaryBody.innerHTML =
      `EP: <b>${snapshot.porCurso.EP || 0}</b> ofertas<br>` +
      `CB: <b>${snapshot.porCurso.CB || 0}</b> ofertas<br>` +
      `CN: <b>${snapshot.porCurso.CN || 0}</b> ofertas<br>` +
      `Total: <b>${snapshot.total || 0}</b>`;
    exportScopeAllSummary.classList.remove('hidden');
    btnExportScopeAllDownload.disabled = false;
  };

  const closeExportScopeModal = () => {
    if (!exportScopeModal) return;
    exportScopeModal.classList.remove('is-open');
    exportScopeModal.setAttribute('aria-hidden', 'true');
    if (exportScopeCourseArea) exportScopeCourseArea.classList.add('hidden');
    if (selExportScopeCourse) selExportScopeCourse.value = '';
    hideAllSummary();
    updateExportCourseActionState();
  };

  const openExportScopeModal = () => {
    if (!exportScopeModal) return;
    exportScopeModal.classList.add('is-open');
    exportScopeModal.setAttribute('aria-hidden', 'false');
    if (exportScopeCourseArea) exportScopeCourseArea.classList.add('hidden');
    if (selExportScopeCourse) selExportScopeCourse.value = '';
    hideAllSummary();
    updateExportCourseActionState();
  };

  if (btnExport) {
    btnExport.onclick = () => {
      openExportScopeModal();
    };
  }

  if (btnExportScopeAll) {
    btnExportScopeAll.addEventListener('click', () => {
      if (exportScopeCourseArea) exportScopeCourseArea.classList.add('hidden');
      pendingAllExportSnapshot = buildTodosCursosExportSnapshot();
      renderAllSummary(pendingAllExportSnapshot);
    });
  }

  if (btnExportScopeOne) {
    btnExportScopeOne.addEventListener('click', () => {
      if (exportScopeCourseArea) exportScopeCourseArea.classList.remove('hidden');
      hideAllSummary();
      updateExportCourseActionState();
      if (selExportScopeCourse) selExportScopeCourse.focus();
    });
  }

  if (selExportScopeCourse) {
    selExportScopeCourse.addEventListener('change', updateExportCourseActionState);
  }

  if (btnExportScopeCourse) {
    btnExportScopeCourse.addEventListener('click', () => {
      if (!selExportScopeCourse || !selExportScopeCourse.value) return;
      exportarJSONCurso(selExportScopeCourse.value);
      closeExportScopeModal();
    });
  }

  if (btnExportScopeAllDownload) {
    btnExportScopeAllDownload.addEventListener('click', () => {
      if (!pendingAllExportSnapshot) return;
      exportarJSONTodosCursos(pendingAllExportSnapshot);
      closeExportScopeModal();
    });
  }

  if (btnExportScopeCancel) {
    btnExportScopeCancel.addEventListener('click', () => {
      closeExportScopeModal();
    });
  }

  if (exportScopeModal) {
    exportScopeModal.addEventListener('click', (e) => {
      if (e.target === exportScopeModal) closeExportScopeModal();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && exportScopeModal?.classList.contains('is-open')) {
      closeExportScopeModal();
    }
  });


  // NOVO: Exportar para o Portal Público (Nome Fixo + Datas do Semestre)
  const btnExportPublic = document.getElementById('btn-export-public');
  if (btnExportPublic) {
    btnExportPublic.onclick = () => {
      const fileName = 'alocacoes_publicas.json';
      const exportableAllocations = filterExportableAllocations(store.allocations);
      const exportData = buildPublicExportPayload(
        exportableAllocations,
        store.getActivePlanMeta(),
        store.settings,
        getOfficialPlanCandidates()
      );

      const issues = validatePublicExportData(exportData);
      if (issues.length) {
        showToastWarning(
          'Publicação cancelada por inconsistências:<br>- ' +
          issues.join('<br>- '),
          'error',
          5600
        );
        return;
      }

      const shouldExport = confirm(
        `Confirmar publicação online?\n\n` +
        `Alocações: ${exportData.allocations.length}\n` +
        `Plano: ${exportData.settings.periodo || 'P'} | ${exportData.settings.termStart} a ${exportData.settings.termEnd}\n\n` +
        `Clique em OK para gerar o arquivo público.`
      );
      if (!shouldExport) return;

      const dataStr =
        "data:text/json;charset=utf-8," +
        encodeURIComponent(JSON.stringify(exportData, null, 2));

      const a = document.createElement('a');
      a.setAttribute('href', dataStr);
      a.setAttribute('download', fileName);
      document.body.appendChild(a);
      a.click();
      a.remove();

      showToastWarning(
        "Arquivo '" + fileName + "' gerado com sucesso.<br>" +
        "Publicação automática recomendada na raiz do projeto:<br>" +
        "<code>python tools/publish_online.py --push</code>",
        'success',
        7000
      );
    };
  }

  const btnExportSigaa = document.getElementById('btn-export-sigaa-json');
  if (btnExportSigaa) {
    btnExportSigaa.onclick = () => exportSigaaMetadataJSON();
  }

  document.getElementById('btn-clear').onclick = () => store.clearData();
})();
