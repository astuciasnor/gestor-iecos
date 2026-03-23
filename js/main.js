import { store } from './store.js';
import { initUI, exportSigaaMetadataJSON, showToastWarning } from './ui.js?v=20260323ab';
import { filterExportableAllocations, resolveActiveAcademicPeriod } from './academic_rules.mjs';

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

function buildPlanScopedPayload(scope, allocations, extra = {}) {
  const activePlan = store.getActivePlanMeta();
  return {
    version: 2,
    scope,
    exportedAt: new Date().toISOString(),
    plan: activePlan?.key ? activePlan : null,
    settings: {
      termStart: store.settings.termStart,
      termEnd: store.settings.termEnd,
      periodo: store.settings.periodo,
      turnoOferta: store.settings.turnoOferta || ''
    },
    allocations,
    ...extra
  };
}

function getOfficialPlanCandidates() {
  return (Array.isArray(store.rawData?.periodos_letivos) ? store.rawData.periodos_letivos : []).map((item) => ({
    periodo: item?.periodo_letivo || item?.periodo || '',
    termStart: item?.inicio || '',
    termEnd: item?.fim || '',
    ano: item?.ano || ''
  }));
}

function resolvePublicPlanMeta() {
  const activePlan = store.getActivePlanMeta();
  const preferredMeta = activePlan?.key
    ? activePlan
    : {
      periodo: store.settings.periodo,
      termStart: store.settings.termStart,
      termEnd: store.settings.termEnd
    };

  const resolved = resolveActiveAcademicPeriod({
    plans: getOfficialPlanCandidates(),
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

function buildPublicExportPayload() {
  const publicPlan = resolvePublicPlanMeta();
  const exportableAllocations = filterExportableAllocations(store.allocations);
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
      periodoLetivo: publicPlan?.periodo || store.settings.periodo || '',
      docenteCount: docentes.length,
      turmaCount: turmas.length,
      docentes,
      turmas
    },
    allocations: exportableAllocations,
    settings: {
      termStart: publicPlan?.termStart || store.settings.termStart,
      termEnd: publicPlan?.termEnd || store.settings.termEnd,
      periodo: publicPlan?.periodo || store.settings.periodo,
      turnoOferta: store.settings.turnoOferta || ''
    }
  };
}

function buildTurmaParaCursoMap() {
  const turmaParaCurso = {};
  (store.rawData?.turmas || []).forEach((t) => {
    if (t.turma_id && t.sigla) turmaParaCurso[String(t.turma_id)] = String(t.sigla);
  });
  return turmaParaCurso;
}

function collectAllocationsByCurso(sigla, turmaParaCurso) {
  const cursoSigla = String(sigla || '').trim().toUpperCase();
  return store.allocations.filter((a) => turmaParaCurso[String(a.turmaId)] === cursoSigla);
}

function buildTodosCursosExportSnapshot() {
  const turmaParaCurso = buildTurmaParaCursoMap();
  const porCurso = {};
  const allocations = [];

  EXPORT_CURSOS_UNIDADE.forEach((sigla) => {
    const list = collectAllocationsByCurso(sigla, turmaParaCurso);
    porCurso[sigla] = list.length;
    allocations.push(...list);
  });

  return {
    porCurso,
    total: allocations.length,
    allocations
  };
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
  const effective = snapshot || buildTodosCursosExportSnapshot();
  const fileName = buildBackupFilename('TODOS');
  downloadJSONFile(
    buildPlanScopedPayload('TODOS', effective.allocations, {
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

  const turmaParaCurso = buildTurmaParaCursoMap();
  const dadosExportar = collectAllocationsByCurso(cursoSigla, turmaParaCurso);
  const fileName = buildBackupFilename(cursoSigla);
  downloadJSONFile(
    buildPlanScopedPayload(cursoSigla, dadosExportar, {
      curso: cursoSigla,
      total: dadosExportar.length
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
      const exportData = buildPublicExportPayload();

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
