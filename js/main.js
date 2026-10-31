import { store } from './store.js??v=20261028a';
import { initUI, exportSigaaMetadataJSON, showToastWarning, refreshAfterRemoteChange } from './ui.js??v=20261031c';
import { iniciarAcesso, isOnlineMode } from './acesso_ui.js??v=20261030a';
import { fetchAllocationsForPlans } from './sync_remoto.js??v=20261030a';
import { filterExportableAllocations } from './academic_rules.mjs';
import {
  buildPlanScopedPayload,
  buildTurmaParaCursoMap,
  collectAllocationsByCurso,
  buildTodosCursosExportSnapshot,
  buildPublicExportPayload
} from './serialization.js';

// Cursos exportaveis: os cadastrados na aba cursos da planilha (dados_app.json).
function getExportCursosUnidade() {
  const siglas = (store.rawData?.cursos || [])
    .map((curso) => String(curso?.sigla || '').trim().toUpperCase())
    .filter(Boolean);
  return siglas.length ? [...new Set(siglas)] : ['EP', 'CB', 'CN'];
}

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

const MAX_FUTURE_PUBLIC_PLANS = 4;

function getLocalTodayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// Planos candidatos a publicacao: o ativo e os oficiais em curso ou futuros.
function getPublicationTargets() {
  const today = getLocalTodayIso();
  const activeMeta = store.getActivePlanMeta();
  const officialPlans = getOfficialPlanCandidates();

  const targets = [];
  const seen = new Set();
  const addTarget = (meta) => {
    const normalized = store.getPlanMetaFromSettings({
      periodo: meta.periodo,
      termStart: meta.termStart,
      termEnd: meta.termEnd
    });
    if (!normalized?.key || seen.has(normalized.key)) return;
    seen.add(normalized.key);
    targets.push(normalized);
  };

  if (activeMeta?.key) addTarget(activeMeta);
  officialPlans
    .filter((plan) => plan.termEnd && plan.termEnd >= today)
    .forEach(addTarget);
  return targets;
}

// Monta uma publicacao por periodo letivo em curso ou futuro que tenha ao menos
// uma alocacao (o plano ativo entra sempre). O store e trocado temporariamente
// para cada plano, porque a projecao de ofertas le datas e alocacoes dele.
// allocationsByKey: alocacoes ja trazidas do servidor (modo online).
function buildPublicPublicationsForExport(allocationsByKey = null) {
  const today = getLocalTodayIso();
  const activeMeta = store.getActivePlanMeta();
  const officialPlans = getOfficialPlanCandidates();
  const targets = getPublicationTargets();

  const saved = {
    settings: store.settings,
    allocations: store.allocations,
    activePlanMeta: store.activePlanMeta
  };

  const publications = [];
  const issues = [];
  try {
    targets.forEach((meta) => {
      const isActive = meta.key === activeMeta?.key;
      const planAllocations = isActive
        ? saved.allocations
        : (allocationsByKey?.[meta.key] || store.readPlanAllocations(meta));
      const exportableAllocations = filterExportableAllocations(planAllocations);
      if (!exportableAllocations.length) return;

      store.settings = { ...saved.settings, periodo: meta.periodo, termStart: meta.termStart, termEnd: meta.termEnd };
      store.allocations = planAllocations;
      store.activePlanMeta = meta;

      const payload = buildPublicExportPayload(exportableAllocations, meta, store.settings, officialPlans);
      const payloadIssues = validatePublicExportData(payload);
      if (payloadIssues.length) {
        issues.push(...payloadIssues.map((msg) => `${meta.periodo} (${meta.termStart}): ${msg}`));
        return;
      }
      publications.push(payload);
    });
  } finally {
    store.settings = saved.settings;
    store.allocations = saved.allocations;
    store.activePlanMeta = saved.activePlanMeta;
  }

  // Mesma janela do publish_online.py: periodo(s) em curso + ate 4 futuros.
  publications.sort((a, b) => String(a.settings.termStart).localeCompare(String(b.settings.termStart)));
  let futureCount = 0;
  const windowed = publications.filter((pub) => {
    if (String(pub.settings.termStart) <= today) return true;
    futureCount += 1;
    return futureCount <= MAX_FUTURE_PUBLIC_PLANS;
  });
  return { publications: windowed, issues };
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
  const effective = snapshot || buildTodosCursosExportSnapshot(store.allocations, store.rawData?.turmas, getExportCursosUnidade());
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
  if (!getExportCursosUnidade().includes(cursoSigla)) {
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

  // Preenche o seletor de curso e os textos do modal a partir dos cursos cadastrados.
  const exportCursos = getExportCursosUnidade();
  if (selExportScopeCourse) {
    selExportScopeCourse.innerHTML = '<option value="">Selecione...</option>' +
      exportCursos.map((sigla) => `<option value="${sigla}">${sigla}</option>`).join('');
  }
  const scopeAllHelp = btnExportScopeAll?.querySelector('.export-scope-choice-help');
  if (scopeAllHelp) scopeAllHelp.textContent = `Exporta ${exportCursos.join(' + ')}`;
  const scopeOneTitle = btnExportScopeOne?.querySelector('.export-scope-choice-title');
  if (scopeOneTitle) scopeOneTitle.textContent = `🎓 Um Curso (${exportCursos.join(', ')})`;

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
      getExportCursosUnidade()
        .map((sigla) => `${sigla}: <b>${snapshot.porCurso[sigla] || 0}</b> ofertas<br>`)
        .join('') +
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
      pendingAllExportSnapshot = buildTodosCursosExportSnapshot(store.allocations, store.rawData?.turmas, getExportCursosUnidade());
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
    btnExportPublic.onclick = async () => {
      const fileName = 'alocacoes_publicas.json';
      let allocationsByKey = null;
      if (isOnlineMode()) {
        try {
          allocationsByKey = await fetchAllocationsForPlans(getPublicationTargets().map((meta) => meta.key));
        } catch (error) {
          showToastWarning(`Nao foi possivel ler os periodos do servidor: ${error?.message || error}`, 'error', 6000);
          return;
        }
      }
      const { publications, issues } = buildPublicPublicationsForExport(allocationsByKey);

      if (issues.length) {
        showToastWarning(
          'Publicação cancelada por inconsistências:<br>- ' +
          issues.join('<br>- '),
          'error',
          5600
        );
        return;
      }

      if (!publications.length) {
        showToastWarning('Nenhum período em curso ou futuro tem alocações para publicar.', 'warning', 4200);
        return;
      }

      const resumo = publications
        .map((pub) => `- ${String(pub.settings.termStart || '').slice(0, 4)} - ${pub.settings.periodo}: ${pub.allocations.length} alocação(ões)`)
        .join('\n');
      const shouldExport = confirm(
        `Confirmar publicação online?\n\n` +
        `Períodos em curso e futuros com turmas cadastradas:\n${resumo}\n\n` +
        `Clique em OK para gerar o arquivo público.`
      );
      if (!shouldExport) return;

      const exportData = {
        version: 3,
        exportedAt: new Date().toISOString(),
        layoutMode: 'single_file_multi_plan',
        publications
      };

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

  await iniciarAcesso({ onRemoteChange: refreshAfterRemoteChange, showToast: showToastWarning });
})();
