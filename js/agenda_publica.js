import { store, normalizeLoadedAllocation } from './store.js??v=20260625v';
import { getTurnoLetter } from './turns.js';
import { getCalendarEvents } from './calendar.js';
import { resolveActiveAcademicPeriod } from './academic_rules.mjs';

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' });
const PUBLIC_ASSET_VERSION = '20260701h';
const PUBLIC_ROUTING_CONFIG_URL = 'publicacoes/publicacao_config.json';
const PUBLIC_ROUTING_CATALOG_FALLBACK_URL = 'publicacoes/catalogo_publicacoes.json';

const state = {
    activeTab: 'discente',
    publicCatalog: null,
    publicPublicationRoute: null,
    publicPublications: [],
    activePublicationKey: '',
    publicTurmaIds: null,
    componentInfoByName: new Map(),
    turmaById: new Map(),
    docentesDisponiveis: [],
    discente: {
        curso: '',
        turmaId: '',
        mes: ''
    },
    docente: {
        nome: '',
        mes: '',
        totalHoras: null
    }
};

const els = {};
let renderSequence = 0;
let suggestionActiveIndex = -1;
let activeLensChip = null;
let docenteViewportTimer = 0;

function isLocalPreviewEnvironment() {
    const protocol = String(window.location?.protocol || '').toLowerCase();
    const hostname = String(window.location?.hostname || '').toLowerCase();
    return protocol === 'file:' || hostname === 'localhost' || hostname === '127.0.0.1';
}

function shouldPreferLocalDraftSource(localAllocations = []) {
    if (!isLocalPreviewEnvironment()) return false;
    if (!Array.isArray(localAllocations) || !localAllocations.length) return false;

    const params = new URLSearchParams(window.location.search || '');
    const forcedSource = String(params.get('source') || '').trim().toLowerCase();
    if (forcedSource === 'public') return false;

    return true;
}

function appendPublicAssetVersion(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    return `${raw}${raw.includes('?') ? '&' : '?'}v=${PUBLIC_ASSET_VERSION}`;
}

async function fetchJsonIfAvailable(url) {
    const ref = appendPublicAssetVersion(url);
    if (!ref) return null;

    try {
        const response = await fetch(ref);
        if (!response.ok) return null;
        return await response.json();
    } catch (_) {
        return null;
    }
}

function normalizePublicationSelector(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function normalizePublicationEntry(entry = {}) {
    if (!entry || typeof entry !== 'object') return null;

    const planKey = String(entry.planKey || entry.key || '').trim();
    const periodo = String(entry.periodo || '').trim();
    const termStart = String(entry.termStart || '').trim();
    const year = String(entry.year || (termStart ? termStart.slice(0, 4) : '') || '').trim();
    const jsonPath = String(entry.jsonPath || '').trim();
    const periodSlug = normalizePublicationSelector(periodo);
    const yearPeriodSlug = normalizePublicationSelector([year, periodo].filter(Boolean).join('-'));
    const normalizedPlanKey = normalizePublicationSelector(planKey);

    return {
        ...entry,
        planKey,
        periodo,
        year,
        termStart,
        jsonPath,
        selectors: [...new Set([
            normalizedPlanKey,
            yearPeriodSlug,
            periodSlug,
            normalizePublicationSelector(entry.slug || ''),
            normalizePublicationSelector(entry.label || '')
        ].filter(Boolean))]
    };
}

function getDefaultPublicSourceDescriptor() {
    return {
        jsonPath: 'alocacoes_publicas.json',
        publication: null,
        routingConfig: null,
        routingCatalog: null
    };
}

function getCatalogPublications(catalog = {}) {
    const publications = Array.isArray(catalog.publications) ? catalog.publications : [];
    return publications
        .map((entry) => normalizePublicationEntry(entry))
        .filter((entry) => entry && entry.jsonPath);
}

function findPublicationEntry(catalog = {}, selector = '') {
    const normalizedSelector = normalizePublicationSelector(selector);
    if (!normalizedSelector) return null;
    return getCatalogPublications(catalog).find((entry) => entry.selectors.includes(normalizedSelector)) || null;
}

function getDefaultPublicationEntry(catalog = {}, fallbackJsonPath = 'alocacoes_publicas.json') {
    const explicitDefault = normalizePublicationEntry(catalog.defaultPublication || {});
    if (explicitDefault?.jsonPath) return explicitDefault;

    const publications = getCatalogPublications(catalog);
    if (publications.length === 1) return publications[0];

    return {
        planKey: '',
        periodo: '',
        year: '',
        termStart: '',
        jsonPath: fallbackJsonPath,
        selectors: []
    };
}

async function resolvePublicDataSourceDescriptor() {
    const fallback = getDefaultPublicSourceDescriptor();
    const routingConfig = await fetchJsonIfAvailable(PUBLIC_ROUTING_CONFIG_URL);
    if (!routingConfig || typeof routingConfig !== 'object') return fallback;

    const fallbackJsonPath = String(routingConfig.defaultJsonPath || fallback.jsonPath || '').trim() || fallback.jsonPath;
    const catalogPath = String(routingConfig.catalogPath || PUBLIC_ROUTING_CATALOG_FALLBACK_URL || '').trim() || PUBLIC_ROUTING_CATALOG_FALLBACK_URL;
    const routingCatalog = await fetchJsonIfAvailable(catalogPath);
    if (!routingCatalog || typeof routingCatalog !== 'object') {
        return {
            ...fallback,
            jsonPath: fallbackJsonPath,
            routingConfig
        };
    }

    const params = new URLSearchParams(window.location.search || '');
    const planQueryParam = String(routingConfig?.studentRouting?.planQueryParam || 'pl').trim() || 'pl';
    const requestedPublication = String(params.get(planQueryParam) || '').trim();

    const publication = requestedPublication
        ? (findPublicationEntry(routingCatalog, requestedPublication) || getDefaultPublicationEntry(routingCatalog, fallbackJsonPath))
        : getDefaultPublicationEntry(routingCatalog, fallbackJsonPath);

    return {
        jsonPath: publication?.jsonPath || fallbackJsonPath,
        publication,
        routingConfig,
        routingCatalog
    };
}

document.addEventListener('DOMContentLoaded', init);

async function init() {
    cacheElements();
    bindEvents();
    renderResultLoading('Carregando agenda publica...');

    await loadPublicData();
    buildLookups();
    state.publicTurmaIds = getPublishedTurmaIdsSet();
    state.docentesDisponiveis = collectPublishedTeachers();

    updateMetaChips();
    preencherCursos();
    syncDocenteInputState();
    syncTabUI();
    renderActiveEmptyState();
    setupPlanSwitcher();
}

function cacheElements() {
    els.periodoChip = document.getElementById('pub-periodo-chip');
    els.faixaChip = document.getElementById('pub-faixa-chip');
    els.tabDiscente = document.getElementById('tab-discente');
    els.tabDocente = document.getElementById('tab-docente');
    els.viewDiscente = document.getElementById('view-discente');
    els.viewDocente = document.getElementById('view-docente');
    els.selCurso = document.getElementById('public-sel-curso');
    els.selTurma = document.getElementById('public-sel-turma');
    els.containerTurmas = document.getElementById('container-turmas');
    els.containerMesesDiscente = document.getElementById('container-meses-discente');
    els.inpDocente = document.getElementById('inp-docente-publico');
    els.docenteAutocomplete = els.inpDocente?.closest('.pub-autocomplete') || null;
    els.btnLimparDocente = document.getElementById('btn-limpar-docente-publico');
    els.listaSugestoes = document.getElementById('lista-sugestoes-publico');
    els.containerMesesDocente = document.getElementById('container-meses-docente');
    els.docenteMonthGroup = document.getElementById('docente-month-group');
    els.resultadoAgenda = document.getElementById('resultado-agenda');
    els.btnTopo = document.getElementById('btn-topo');
    els.sheetOverlay = document.getElementById('sheet-overlay');
    els.bottomSheet = document.getElementById('bottom-sheet');
    els.sheetTitle = document.getElementById('sheet-title');
    els.sheetTipo = document.getElementById('sheet-tipo');
    els.sheetData = document.getElementById('sheet-data');
    els.sheetHorario = document.getElementById('sheet-horario');
    els.sheetDocente = document.getElementById('sheet-docente');
    els.sheetTurma = document.getElementById('sheet-turma');
    els.btnFecharSheet = document.getElementById('btn-fechar-sheet');
    els.slotLens = document.getElementById('slot-lens');
    els.dayLens = document.getElementById('day-lens');
}

function bindEvents() {
    els.tabDiscente?.addEventListener('click', () => switchTab('discente'));
    els.tabDocente?.addEventListener('click', () => switchTab('docente'));

    els.selCurso?.addEventListener('change', handleCursoChange);
    els.inpDocente?.addEventListener('input', handleDocenteInput);
    els.inpDocente?.addEventListener('focus', handleDocenteFocus);
    els.inpDocente?.addEventListener('blur', handleDocenteBlur);
    els.inpDocente?.addEventListener('keydown', handleDocenteKeydown);
    els.btnLimparDocente?.addEventListener('click', limparDocenteSelecionado);

    els.resultadoAgenda?.addEventListener('click', handleAgendaChipClick);
    els.resultadoAgenda?.addEventListener('keydown', handleAgendaChipKeydown);
    els.slotLens?.addEventListener('click', handleSlotLensClick);
    els.dayLens?.addEventListener('click', (e) => { if (e.target.closest('.day-lens-close')) fecharDayLens(true); });

    els.btnFecharSheet?.addEventListener('click', fecharBottomSheet);
    els.sheetOverlay?.addEventListener('click', fecharBottomSheet);
    document.addEventListener('click', (event) => {
        const clickedChip = event.target.closest('.mini-chip');
        if (clickedChip) return;
        if (els.slotLens?.contains(event.target)) return;
        fecharSlotLens();
        const clickedDay = event.target.closest('.month-cal-day');
        if (clickedDay) return;
        if (els.dayLens?.contains(event.target)) return;
        fecharDayLens();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            fecharBottomSheet();
            fecharSlotLens(true);
            fecharDayLens(true);
            esconderSugestoes();
        }
    });

    window.addEventListener('scroll', syncBackToTopButton);
    window.addEventListener('scroll', syncSuggestionViewportLayout, true);
    window.addEventListener('scroll', () => { fecharSlotLens(); fecharDayLens(); }, true);
    window.addEventListener('resize', syncSuggestionViewportLayout);
    window.addEventListener('resize', () => { fecharSlotLens(true); fecharDayLens(true); });
    window.visualViewport?.addEventListener('resize', handleVisualViewportChange);
    window.visualViewport?.addEventListener('scroll', syncSuggestionViewportLayout);
    els.btnTopo?.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

async function loadPublicData() {
    await store.loadData();
    const localDraftAllocations = Array.isArray(store.allocations)
        ? store.allocations.map((allocation) => normalizeLoadedAllocation({ ...allocation }))
        : [];
    const localDraftSettings = { ...store.settings };
    const useLocalDraft = shouldPreferLocalDraftSource(localDraftAllocations);

    if (useLocalDraft) {
        state.publicCatalog = null;
        state.publicPublicationRoute = null;
        store.allocations = localDraftAllocations;
        store.settings.termStart = localDraftSettings.termStart || store.settings.termStart;
        store.settings.termEnd = localDraftSettings.termEnd || store.settings.termEnd;
        store.settings.periodo = localDraftSettings.periodo || store.settings.periodo;
        console.info('Agenda pública em modo de pré-visualização local: usando allocations do plano atual.');
        applyFallbackTermDates();
        return;
    }

    const sourceDescriptor = await resolvePublicDataSourceDescriptor();
    state.publicPublicationRoute = sourceDescriptor;

    try {
        let response = await fetch(appendPublicAssetVersion(sourceDescriptor.jsonPath));
        if (!response.ok && sourceDescriptor.jsonPath !== 'alocacoes_publicas.json') {
            response = await fetch(appendPublicAssetVersion('alocacoes_publicas.json'));
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const dadosPublicos = await response.json();
        const publications = extractPublicationsFromPayload(dadosPublicos, sourceDescriptor);

        if (publications.length) {
            state.publicPublications = publications;
            const params = new URLSearchParams(window.location.search || '');
            const planQueryParam = String(sourceDescriptor.routingConfig?.studentRouting?.planQueryParam || 'pl').trim() || 'pl';
            const requestedSelector = String(
                params.get(planQueryParam)
                || sourceDescriptor.publication?.periodo
                || ''
            ).trim();
            const activePublication = pickActivePublication(publications, requestedSelector);
            state.activePublicationKey = activePublication?.key || '';
            applySelectedPublication(activePublication);
        } else {
            state.publicPublications = [];
            state.activePublicationKey = '';
            store.allocations = [];
            state.publicCatalog = sourceDescriptor.publication || null;
        }
    } catch (error) {
        console.warn('Falha ao carregar alocacoes_publicas.json. Usando dados locais.', error);
        store.loadAllocations();
        state.publicCatalog = null;
        state.publicPublicationRoute = null;
        state.publicPublications = [];
        state.activePublicationKey = '';
    }

    applyFallbackTermDates();
}

function applyFallbackTermDates() {
    if (store.settings.termStart && store.settings.termEnd) return;
    const today = new Date().toISOString().slice(0, 10);
    const periodos = Array.isArray(store.rawData?.periodos_letivos)
        ? store.rawData.periodos_letivos
        : [];
    const periodoAtual =
        periodos.find(p => p.inicio <= today && p.fim >= today) ||
        periodos.find(p => p.inicio >= today) ||
        periodos[periodos.length - 1];
    if (periodoAtual) {
        if (!store.settings.termStart) store.settings.termStart = periodoAtual.inicio;
        if (!store.settings.termEnd) store.settings.termEnd = periodoAtual.fim;
    }
}

function getOfficialPlanCandidates() {
    return (Array.isArray(store.rawData?.periodos_letivos) ? store.rawData.periodos_letivos : []).map((item) => ({
        periodo: item?.periodo_letivo || item?.periodo || '',
        termStart: item?.inicio || '',
        termEnd: item?.fim || '',
        ano: item?.ano || ''
    }));
}

function applyPublicPlanSettings(dadosPublicos = {}) {
    const settings = dadosPublicos.settings && typeof dadosPublicos.settings === 'object' ? dadosPublicos.settings : {};
    const plan = dadosPublicos.plan && typeof dadosPublicos.plan === 'object' ? dadosPublicos.plan : {};
    const meta = dadosPublicos.meta && typeof dadosPublicos.meta === 'object' ? dadosPublicos.meta : {};
    const preferredMeta = {
        periodo: settings.periodo || plan.periodo || meta.periodoLetivo || '',
        termStart: settings.termStart || plan.termStart || '',
        termEnd: settings.termEnd || plan.termEnd || ''
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
    const publicPlan = hasExactDateMatch ? resolved : preferredMeta;

    store.settings.termStart = publicPlan.termStart || store.settings.termStart;
    store.settings.termEnd = publicPlan.termEnd || store.settings.termEnd;
    store.settings.periodo = publicPlan.periodo || store.settings.periodo;

    if (state.publicCatalog && !state.publicCatalog.periodoLetivo && publicPlan.periodo) {
        state.publicCatalog.periodoLetivo = publicPlan.periodo;
    }
}

function normalizePublicationRecord(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;

    const allocations = Array.isArray(entry.allocations)
        ? entry.allocations.map((alloc) => normalizeLoadedAllocation({ ...alloc }))
        : [];
    const settings = entry.settings && typeof entry.settings === 'object' ? entry.settings : {};
    const plan = entry.plan && typeof entry.plan === 'object' ? entry.plan : {};
    const meta = entry.meta && typeof entry.meta === 'object' ? { ...entry.meta } : null;

    const periodo = String(meta?.periodoLetivo || plan.periodo || settings.periodo || '').trim();
    const termStart = String(plan.termStart || settings.termStart || '').trim();
    const termEnd = String(plan.termEnd || settings.termEnd || '').trim();
    const key = String(
        plan.key
        || [periodo, termStart, termEnd].filter(Boolean).join('__')
        || periodo
        || 'plano'
    ).trim();

    return {
        key,
        periodo,
        termStart,
        termEnd,
        label: buildPublicationLabel(periodo, termStart, plan),
        plan,
        meta,
        settings,
        allocations
    };
}

function extractPublicationsFromPayload(payload, sourceDescriptor = {}) {
    if (Array.isArray(payload)) {
        const record = normalizePublicationRecord({
            allocations: payload,
            meta: sourceDescriptor?.publication || null
        });
        return record ? [record] : [];
    }

    if (payload && typeof payload === 'object' && Array.isArray(payload.publications) && payload.publications.length) {
        return payload.publications
            .map((entry) => normalizePublicationRecord(entry))
            .filter(Boolean);
    }

    if (payload && typeof payload === 'object') {
        const record = normalizePublicationRecord(payload);
        return record ? [record] : [];
    }

    return [];
}

function buildPublicationLabel(periodo, termStart, plan = {}) {
    if (plan?.label) return String(plan.label);
    const year = String(termStart || '').slice(0, 4);
    const base = periodo || 'Per\u00edodo';
    return year ? `${base} \u00b7 ${year}` : base;
}

function publicationSelectors(publication) {
    if (!publication) return [];
    const year = String(publication.termStart || '').slice(0, 4);
    return [...new Set([
        normalizePublicationSelector(publication.periodo),
        normalizePublicationSelector(publication.key),
        normalizePublicationSelector([year, publication.periodo].filter(Boolean).join('-')),
        normalizePublicationSelector(publication.label)
    ].filter(Boolean))];
}

function getTodayIso() {
    return new Date().toISOString().slice(0, 10);
}

function isPastPublication(publication, today = getTodayIso()) {
    return !!(publication?.termEnd && publication.termEnd < today);
}

function getDisplayPublications(publications, activeKey = '') {
    const list = Array.isArray(publications) ? publications : [];
    const today = getTodayIso();
    const nonPast = list.filter((pub) => !isPastPublication(pub, today));
    let displayable = nonPast.length ? [...nonPast] : [...list];

    if (activeKey && !displayable.some((pub) => pub.key === activeKey)) {
        const active = list.find((pub) => pub.key === activeKey);
        if (active) displayable = [active, ...displayable];
    }

    return displayable.sort((a, b) => String(a.termStart || '').localeCompare(String(b.termStart || '')));
}

function pickActivePublication(publications, requestedSelector = '') {
    if (!Array.isArray(publications) || !publications.length) return null;

    const requested = normalizePublicationSelector(requestedSelector);
    if (requested) {
        const match = publications.find((pub) => publicationSelectors(pub).includes(requested));
        if (match) return match;
    }

    const today = getTodayIso();
    const vigente = publications.find((pub) =>
        pub.termStart && pub.termEnd && pub.termStart <= today && today <= pub.termEnd
    );
    if (vigente) return vigente;

    const upcoming = publications
        .filter((pub) => pub.termStart && pub.termStart > today)
        .sort((a, b) => String(a.termStart || '').localeCompare(String(b.termStart || '')));
    if (upcoming.length) return upcoming[0];

    return [...publications]
        .sort((a, b) => String(b.termStart || '').localeCompare(String(a.termStart || '')))[0];
}

function applySelectedPublication(publication) {
    if (!publication) return;

    store.allocations = Array.isArray(publication.allocations) ? publication.allocations : [];
    state.publicCatalog = publication.meta ? { ...publication.meta } : null;
    if (state.publicCatalog && publication.periodo && !state.publicCatalog.periodoLetivo) {
        state.publicCatalog.periodoLetivo = publication.periodo;
    }

    applyPublicPlanSettings({
        settings: publication.settings,
        plan: publication.plan,
        meta: publication.meta
    });
}

function buildPlanOptionLabel(publication) {
    const base = publication.periodo || publication.label || 'Per\u00edodo';
    if (publication.termStart && publication.termEnd) {
        return `${base} (${formatIsoDateBR(publication.termStart)} a ${formatIsoDateBR(publication.termEnd)})`;
    }
    return base;
}

function setupPlanSwitcher() {
    const wrap = document.getElementById('pub-plan-switch');
    const select = document.getElementById('pub-sel-plano');
    if (!wrap || !select) return;

    const publications = Array.isArray(state.publicPublications) ? state.publicPublications : [];
    const ordered = getDisplayPublications(publications, state.activePublicationKey);
    if (ordered.length <= 1) {
        wrap.hidden = true;
        select.innerHTML = '';
        return;
    }

    select.innerHTML = '';
    ordered.forEach((publication) => {
        const option = document.createElement('option');
        option.value = publication.key;
        option.textContent = buildPlanOptionLabel(publication);
        if (publication.key === state.activePublicationKey) option.selected = true;
        select.appendChild(option);
    });

    wrap.hidden = false;
    select.removeEventListener('change', handlePlanSwitchChange);
    select.addEventListener('change', handlePlanSwitchChange);
}

function handlePlanSwitchChange(event) {
    const key = String(event?.target?.value || '').trim();
    const publication = (state.publicPublications || []).find((pub) => pub.key === key);
    if (!publication || key === state.activePublicationKey) return;

    state.activePublicationKey = key;
    applySelectedPublication(publication);
    refreshAfterPlanSwitch(publication);
}

function refreshAfterPlanSwitch(publication) {
    buildLookups();
    state.publicTurmaIds = getPublishedTurmaIdsSet();
    state.docentesDisponiveis = collectPublishedTeachers();
    updateMetaChips();

    state.discente = { curso: '', turmaId: '', mes: '' };
    state.docente = { nome: '', mes: '', totalHoras: null, view: state.docente?.view || 'calendar' };
    if (els.selCurso) els.selCurso.value = '';
    if (els.inpDocente) els.inpDocente.value = '';

    preencherCursos();
    syncDocenteInputState();
    syncTabUI();
    renderActiveEmptyState();

    try {
        const url = new URL(window.location.href);
        url.searchParams.set('pl', normalizePublicationSelector(publication?.periodo) || publication?.key || '');
        window.history.replaceState({}, '', url);
    } catch (_) {
        // ignora ambientes sem history API
    }
}

function buildLookups() {
    state.componentInfoByName = new Map();
    state.turmaById = new Map();

    (store.rawData?.componentes || []).forEach((item) => {
        state.componentInfoByName.set(normalizeText(item?.componente), item);
    });

    (store.rawData?.turmas || []).forEach((item) => {
        state.turmaById.set(String(item?.turma_id || '').trim(), item);
    });
}

function getPublishedTurmaIdsSet() {
    const metaTurmas = Array.isArray(state.publicCatalog?.turmas)
        ? state.publicCatalog.turmas
            .map((item) => typeof item === 'string' ? item : item?.turmaId || item?.turma_id)
            .map((item) => String(item || '').trim())
            .filter(Boolean)
        : [];

    const allocationTurmas = (store.allocations || [])
        .map((item) => String(item?.turmaId || '').trim())
        .filter(Boolean);

    const ids = metaTurmas.length ? metaTurmas : allocationTurmas;
    return ids.length ? new Set(ids) : null;
}

function collectPublishedTeachers() {
    const names = new Set();

    if (Array.isArray(state.publicCatalog?.docentes)) {
        state.publicCatalog.docentes.forEach((entry) => {
            const raw = typeof entry === 'string' ? entry : entry?.nome || entry?.docente;
            const name = String(raw || '').trim();
            if (name && normalizeText(name) !== 'A DEFINIR') names.add(name);
        });
    }

    (store.allocations || []).forEach((alloc) => {
        extractTeacherNamesFromAllocation(alloc).forEach((name) => names.add(name));
    });

    return [...names].sort((a, b) => collator.compare(a, b));
}

function extractTeacherNamesFromAllocation(alloc) {
    const names = [];

    if (typeof alloc?.docente === 'string') names.push(alloc.docente.trim());
    else if (alloc?.docente?.nome) names.push(String(alloc.docente.nome).trim());

    if (Array.isArray(alloc?.docentes)) {
        alloc.docentes.forEach((entry) => {
            const raw = entry?.nome || entry;
            const name = String(raw || '').trim();
            if (name) names.push(name);
        });
    }

    return [...new Set(
        names.filter((name) => name && normalizeText(name) !== 'A DEFINIR')
    )];
}

function updateMetaChips() {
    if (els.periodoChip) {
        const periodo = state.publicCatalog?.periodoLetivo || store.settings.periodo || '--';
        els.periodoChip.textContent = `Per\u00edodo: ${periodo}`;
    }

    if (els.faixaChip) {
        els.faixaChip.textContent = buildSemesterChipLabel();
    }
}

function buildSemesterChipLabel() {
    const start = store.settings.termStart;
    const end = store.settings.termEnd;
    if (!start || !end) return '--';

    return `${formatIsoDateBR(start)} a ${formatIsoDateBR(end)}`;
}

function preencherCursos() {
    if (!els.selCurso) return;

    const allowedCourseSiglas = getPublishedCourseSiglas();
    els.selCurso.innerHTML = '<option value="">Selecione um curso...</option>';

    (store.rawData?.cursos || []).forEach((curso) => {
        const sigla = String(curso?.sigla || '').trim();
        if (!sigla) return;
        if (allowedCourseSiglas && !allowedCourseSiglas.has(sigla)) return;

        const option = document.createElement('option');
        option.value = sigla;
        option.textContent = curso?.curso || sigla;
        els.selCurso.appendChild(option);
    });
}

function getPublishedCourseSiglas() {
    if (!state.publicTurmaIds) return null;

    const siglas = new Set();
    (store.rawData?.turmas || []).forEach((turma) => {
        const turmaId = String(turma?.turma_id || '').trim();
        if (!state.publicTurmaIds.has(turmaId)) return;
        const sigla = String(turma?.sigla || '').trim();
        if (sigla) siglas.add(sigla);
    });

    return siglas.size ? siglas : null;
}

function handleCursoChange() {
    state.discente.curso = els.selCurso?.value || '';
    state.discente.turmaId = '';
    state.discente.mes = '';

    preencherTurmas(state.discente.curso);
    preencherMesesDiscente();
    renderActiveEmptyState();
}

function preencherTurmas(cursoSigla) {
    if (!els.containerTurmas) return;

    els.containerTurmas.innerHTML = '';
    syncHiddenTurmaSelect([]);

    if (!cursoSigla) {
        els.containerTurmas.innerHTML = '<span class="pub-empty">Aguardando curso...</span>';
        return;
    }

    const turmas = (store.rawData?.turmas || [])
        .filter((turma) => {
            if (String(turma?.sigla || '').trim() !== String(cursoSigla || '').trim()) return false;
            if (!state.publicTurmaIds) return true;
            return state.publicTurmaIds.has(String(turma?.turma_id || '').trim());
        })
        .sort((a, b) => collator.compare(String(a?.turma_label || ''), String(b?.turma_label || '')));

    if (!turmas.length) {
        els.containerTurmas.innerHTML = '<span class="pub-empty">Nenhuma turma publicada para este curso.</span>';
        return;
    }

    syncHiddenTurmaSelect(turmas);

    turmas.forEach((turma) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pub-pill';
        button.textContent = turma?.turma_label || turma?.turma_id || 'Turma';

        button.addEventListener('click', () => {
            state.discente.turmaId = String(turma?.turma_id || '').trim();
            state.discente.mes = '';
            highlightActiveButton(els.containerTurmas, button);
            preencherMesesDiscente();
            renderActiveEmptyState();
        });

        els.containerTurmas.appendChild(button);
    });
}

function syncHiddenTurmaSelect(turmas) {
    if (!els.selTurma) return;

    els.selTurma.innerHTML = '<option value="">Selecione uma turma...</option>';
    turmas.forEach((turma) => {
        const option = document.createElement('option');
        option.value = String(turma?.turma_id || '').trim();
        option.textContent = turma?.turma_label || turma?.turma_id || 'Turma';
        els.selTurma.appendChild(option);
    });

    els.selTurma.disabled = turmas.length === 0;
    els.selTurma.value = state.discente.turmaId || '';
}

function preencherMesesDiscente() {
    if (!els.containerMesesDiscente) return;

    renderMonthButtons({
        container: els.containerMesesDiscente,
        selectedMonth: state.discente.mes,
        emptyLabel: state.discente.turmaId ? 'Nenhum mes letivo configurado.' : 'Aguardando turma...',
        onSelect: (monthKey) => {
            state.discente.mes = monthKey;
            renderActiveView();
        },
        enabled: !!state.discente.turmaId
    });
}

function renderMonthButtons({ container, selectedMonth, emptyLabel, onSelect, enabled }) {
    container.innerHTML = '';

    if (!enabled) {
        container.innerHTML = `<span class="pub-empty">${emptyLabel}</span>`;
        return;
    }

    const months = getTermMonths();
    if (!months.length) {
        container.innerHTML = `<span class="pub-empty">${emptyLabel}</span>`;
        return;
    }

    months.forEach((month) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pub-pill';
        button.textContent = month.label;

        if (month.key === selectedMonth) button.classList.add('active');

        button.addEventListener('click', () => {
            highlightActiveButton(container, button);
            onSelect(month.key);
        });

        container.appendChild(button);
    });
}

function getTermMonths() {
    const start = store.settings.termStart;
    const end = store.settings.termEnd;
    if (!start || !end) return [];

    const startDate = new Date(`${start}T12:00:00`);
    const endDate = new Date(`${end}T12:00:00`);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return [];

    const months = [];
    // Itera pelo 1o dia de cada mes para nao pular o ultimo mes quando o dia
    // de inicio e maior que o dia de fim (ex.: 24/08 a 23/12 dropava dezembro).
    const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1, 12, 0, 0);
    const limit = new Date(endDate.getFullYear(), endDate.getMonth(), 1, 12, 0, 0);

    while (cursor <= limit) {
        const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
        const monthLabel = cursor.toLocaleString('pt-BR', { month: 'long' });
        months.push({ key, label: capitalizeWord(monthLabel) });
        cursor.setMonth(cursor.getMonth() + 1);
    }

    return months;
}

function handleDocenteInput(event) {
    const typedValue = String(event?.target?.value || '').trim();

    if (state.docente.nome && typedValue !== state.docente.nome) {
        resetDocenteState(false);
    }

    if (els.btnLimparDocente) {
        els.btnLimparDocente.style.display = typedValue ? 'flex' : 'none';
    }

    renderizarSugestoes(typedValue, false);
}

function handleDocenteFocus() {
    syncDocenteInputLift();
    queueDocenteViewportSync();
    renderizarSugestoes(els.inpDocente?.value.trim(), true);
}

function handleDocenteBlur() {
    window.setTimeout(() => {
        esconderSugestoes();
        syncDocenteInputLift();
    }, 120);
}

function handleDocenteKeydown(event) {
    const items = getSuggestionItems();

    if (event.key === 'ArrowDown') {
        if (!items.length) return;
        event.preventDefault();
        setActiveSuggestion(Math.min(items.length - 1, suggestionActiveIndex + 1));
        return;
    }

    if (event.key === 'ArrowUp') {
        if (!items.length) return;
        event.preventDefault();
        setActiveSuggestion(Math.max(0, suggestionActiveIndex - 1));
        return;
    }

    if (event.key === 'Escape') {
        esconderSugestoes();
        return;
    }

    if (event.key !== 'Enter') return;
    if (!items.length) return;

    event.preventDefault();
    const activeItem = items[Math.max(0, suggestionActiveIndex)] || items[0];
    selecionarDocente(activeItem.dataset.docente || activeItem.textContent || '');
}

function renderizarSugestoes(termo, allowAll) {
    if (!els.listaSugestoes) return;

    const rawTerm = String(termo || '').trim();
    const normalizedTerm = normalizeText(rawTerm);
    const source = allowAll && !normalizedTerm
        ? state.docentesDisponiveis.slice(0, 12)
        : state.docentesDisponiveis.filter((docente) => normalizeText(docente).includes(normalizedTerm)).slice(0, 12);

    els.listaSugestoes.innerHTML = '';

    if (!source.length || (!rawTerm && !allowAll)) {
        esconderSugestoes();
        return;
    }

    source.forEach((docente) => {
        const li = document.createElement('li');
        li.textContent = docente;
        li.dataset.docente = docente;
        li.addEventListener('mousedown', (event) => {
            event.preventDefault();
            selecionarDocente(docente);
        });
        els.listaSugestoes.appendChild(li);
    });

    els.listaSugestoes.style.display = 'block';
    setActiveSuggestion(0);
    positionSuggestionList();
}

function esconderSugestoes() {
    if (els.listaSugestoes) {
        els.listaSugestoes.style.display = 'none';
        els.listaSugestoes.innerHTML = '';
    }
    resetSuggestionListLayout();
    suggestionActiveIndex = -1;
}

function getSuggestionItems() {
    return Array.from(els.listaSugestoes?.querySelectorAll('li[data-docente]') || []);
}

function setActiveSuggestion(index) {
    const items = getSuggestionItems();
    if (!items.length) {
        suggestionActiveIndex = -1;
        return;
    }

    suggestionActiveIndex = Math.max(0, Math.min(index, items.length - 1));
    items.forEach((item, itemIndex) => {
        item.classList.toggle('active', itemIndex === suggestionActiveIndex);
    });
    items[suggestionActiveIndex]?.scrollIntoView({ block: 'nearest' });
}

function shouldUseFloatingSuggestions() {
    const visualViewport = window.visualViewport;
    if (window.innerWidth <= 720) return true;
    return !!(visualViewport && visualViewport.height < window.innerHeight - 120);
}

function syncDocenteInputLift() {
    if (!els.docenteAutocomplete) return;
    const shouldLift = document.activeElement === els.inpDocente && shouldUseFloatingSuggestions();
    els.docenteAutocomplete.classList.toggle('is-lifted', shouldLift);
}

function queueDocenteViewportSync() {
    window.clearTimeout(docenteViewportTimer);
    requestAnimationFrame(() => {
        syncDocenteInputLift();
        ensureDocenteInputVisible();
        positionSuggestionList();
    });
    docenteViewportTimer = window.setTimeout(() => {
        syncDocenteInputLift();
        ensureDocenteInputVisible();
        positionSuggestionList();
    }, 320);
}

function ensureDocenteInputVisible() {
    if (!els.inpDocente || document.activeElement !== els.inpDocente) return;
    if (!shouldUseFloatingSuggestions()) return;

    const visualViewport = window.visualViewport;
    const visibleHeight = visualViewport?.height || window.innerHeight;
    const rect = els.inpDocente.getBoundingClientRect();
    const keyboardLikelyOpen = !!(visualViewport && visualViewport.height < window.innerHeight - 120);
    const targetTop = keyboardLikelyOpen
        ? Math.max(0, Math.min(4, visibleHeight * 0.012))
        : Math.max(12, Math.min(64, visibleHeight * 0.14));
    const desiredBottom = keyboardLikelyOpen
        ? Math.max(targetTop + rect.height + 2, visibleHeight * 0.15)
        : Math.max(targetTop + rect.height + 12, visibleHeight * 0.42);

    if (keyboardLikelyOpen && rect.top > targetTop + 1) {
        window.scrollBy({ top: rect.top - targetTop - 34, behavior: 'smooth' });
        return;
    }

    if (rect.top < 6) {
        window.scrollBy({ top: rect.top - 6, behavior: 'smooth' });
        return;
    }

    if (rect.bottom > desiredBottom) {
        window.scrollBy({ top: rect.bottom - desiredBottom, behavior: 'smooth' });
    }
}

function positionSuggestionList() {
    if (!els.listaSugestoes || !els.inpDocente) return;
    if (els.listaSugestoes.style.display !== 'block') return;

    if (!shouldUseFloatingSuggestions()) {
        resetSuggestionListLayout();
        return;
    }

    const inputRect = els.inpDocente.getBoundingClientRect();
    const visualViewport = window.visualViewport;
    const viewportWidth = visualViewport?.width || window.innerWidth;
    const viewportHeight = visualViewport?.height || window.innerHeight;
    const keyboardLikelyOpen = !!(visualViewport && visualViewport.height < window.innerHeight - 120);

    if (keyboardLikelyOpen) {
        resetSuggestionListLayout();
        els.listaSugestoes.style.maxHeight = `${Math.round(Math.max(180, Math.min(320, viewportHeight * 0.38)))}px`;
        return;
    }

    const margin = keyboardLikelyOpen ? 2 : 8;
    const gap = keyboardLikelyOpen ? 2 : 8;
    const spaceBelow = Math.max(0, viewportHeight - inputRect.bottom - margin - gap);
    const spaceAbove = Math.max(0, inputRect.top - margin - gap);
    const placeBelow = keyboardLikelyOpen ? true : (spaceBelow >= 150 || spaceBelow >= spaceAbove);
    const availableHeight = placeBelow ? spaceBelow : spaceAbove;
    const maxHeight = Math.max(84, Math.min(keyboardLikelyOpen ? 360 : 300, availableHeight));
    const width = Math.min(inputRect.width, viewportWidth - (margin * 2));
    const left = Math.min(
        viewportWidth - width - margin,
        Math.max(margin, inputRect.left)
    );
    const top = placeBelow
        ? Math.max(margin, Math.min(viewportHeight - maxHeight - margin, inputRect.bottom + gap))
        : Math.max(margin, inputRect.top - maxHeight - gap);

    els.listaSugestoes.classList.add('is-floating');
    els.listaSugestoes.style.left = `${Math.round(left)}px`;
    els.listaSugestoes.style.top = `${Math.round(top)}px`;
    els.listaSugestoes.style.width = `${Math.round(width)}px`;
    els.listaSugestoes.style.maxHeight = `${Math.round(maxHeight)}px`;
}

function resetSuggestionListLayout() {
    if (!els.listaSugestoes) return;
    els.listaSugestoes.classList.remove('is-floating');
    els.listaSugestoes.style.removeProperty('left');
    els.listaSugestoes.style.removeProperty('top');
    els.listaSugestoes.style.removeProperty('width');
    els.listaSugestoes.style.removeProperty('max-height');
}

function syncSuggestionViewportLayout() {
    if (document.activeElement !== els.inpDocente) return;
    syncDocenteInputLift();
    positionSuggestionList();
}

function handleVisualViewportChange() {
    if (document.activeElement !== els.inpDocente) return;
    syncDocenteInputLift();
    queueDocenteViewportSync();
}

function selecionarDocente(nomeProfessor) {
    const teacherName = String(nomeProfessor || '').trim();
    if (!teacherName) return;

    state.docente.nome = teacherName;
    state.docente.mes = '';
    state.docente.totalHoras = null;

    if (els.inpDocente) els.inpDocente.value = teacherName;
    if (els.btnLimparDocente) els.btnLimparDocente.style.display = 'flex';

    esconderSugestoes();
    preencherMesesDocente();
    renderActiveView();
    els.inpDocente?.blur();
}

function limparDocenteSelecionado() {
    if (els.inpDocente) els.inpDocente.value = '';
    resetDocenteState(true);
    els.inpDocente?.focus();
}

function resetDocenteState(clearInput) {
    state.docente.nome = '';
    state.docente.mes = '';
    state.docente.totalHoras = null;

    if (clearInput && els.inpDocente) els.inpDocente.value = '';
    if (els.btnLimparDocente) els.btnLimparDocente.style.display = 'none';

    if (els.containerMesesDocente) els.containerMesesDocente.innerHTML = '<span class="pub-empty">Aguardando professor...</span>';
    renderActiveEmptyState();
}

function preencherMesesDocente() {
    if (!els.containerMesesDocente) return;

    renderMonthButtons({
        container: els.containerMesesDocente,
        selectedMonth: state.docente.mes,
        emptyLabel: state.docente.nome ? 'Nenhum mes letivo configurado.' : 'Aguardando professor...',
        onSelect: (monthKey) => {
            state.docente.mes = monthKey;
            renderActiveView();
        },
        enabled: !!state.docente.nome
    });
}

function switchTab(tabName) {
    state.activeTab = tabName === 'docente' ? 'docente' : 'discente';
    esconderSugestoes();
    fecharBottomSheet();
    syncTabUI();
    renderActiveView();
}

function syncTabUI() {
    const isDiscente = state.activeTab === 'discente';

    toggleTabButton(els.tabDiscente, isDiscente);
    toggleTabButton(els.tabDocente, !isDiscente);

    if (els.viewDiscente) els.viewDiscente.hidden = !isDiscente;
    if (els.viewDocente) els.viewDocente.hidden = isDiscente;
}

function toggleTabButton(button, active) {
    if (!button) return;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
}

function renderActiveView() {
    if (state.activeTab === 'discente') {
        if (els.resultadoAgenda) els.resultadoAgenda.hidden = false;
        if (!state.discente.turmaId || !state.discente.mes) {
            renderActiveEmptyState();
            return;
        }
        renderAgendaDiscente();
        return;
    }

    if (!state.docente.nome) {
        renderActiveEmptyState();
        return;
    }

    if (els.resultadoAgenda) els.resultadoAgenda.hidden = false;

    if (!state.docente.mes) {
        renderActiveEmptyState();
        return;
    }

    renderAgendaDocente();
}

function renderActiveEmptyState() {
    fecharSlotLens(true);

    if (state.activeTab === 'discente') {
        if (!state.discente.curso) {
            renderResultEmpty('Selecione um curso para liberar as turmas publicadas.');
            return;
        }
        if (!state.discente.turmaId) {
            renderResultEmpty('Escolha uma turma para consultar a agenda discente.');
            return;
        }
        if (!state.discente.mes) {
            renderResultEmpty('Escolha um mes para visualizar os slots da turma.');
            return;
        }
        return;
    }

    // Aba Docente
    if (!state.docente.nome) {
        if (els.resultadoAgenda) {
            els.resultadoAgenda.hidden = true;
            els.resultadoAgenda.innerHTML = '';
        }
        return;
    }
    if (!state.docente.mes) {
        if (els.resultadoAgenda) els.resultadoAgenda.hidden = false;
        renderResultEmpty('Escolha um mes para visualizar a agenda do professor.');
    }
}

function renderAgendaDiscente() {
    fecharSlotLens(true);
    const token = ++renderSequence;
    const [ano, mes] = state.discente.mes.split('-');
    const dataInicio = `${ano}-${mes}-01`;
    const ultimoDia = new Date(Number(ano), Number(mes), 0).getDate();
    const dataFim = `${ano}-${mes}-${String(ultimoDia).padStart(2, '0')}`;

    renderResultLoading('A desenhar a grade semanal...');

    window.setTimeout(() => {
        if (token !== renderSequence) return;
        const calendarData = getCalendarEvents(state.discente.turmaId, dataInicio, dataFim);
        const gridHtml = buildWeeklyGridHTML({
            calendarData,
            year: Number(ano),
            month: Number(mes),
            mode: 'discente'
        });
        els.resultadoAgenda.innerHTML = buildResultContextMarkup('discente') + gridHtml;
        scrollResultIntoView();
    }, 140);
}

function renderAgendaDocente() {
    fecharSlotLens(true);
    fecharDayLens(true);
    const token = ++renderSequence;
    const [ano, mes] = state.docente.mes.split('-');
    const dataInicio = `${ano}-${mes}-01`;
    const ultimoDia = new Date(Number(ano), Number(mes), 0).getDate();
    const dataFim = `${ano}-${mes}-${String(ultimoDia).padStart(2, '0')}`;

    renderResultLoading('A montar o calendário...');

    window.setTimeout(() => {
        if (token !== renderSequence) return;

        const calendarData = getCalendarEvents(null, dataInicio, dataFim, state.docente.nome);
        state.docente.totalHoras = calculateMonthlyTeacherHours(calendarData);
        lastDocenteCalendarData = calendarData;

        const gridHtml = buildMonthlyCalendarHTML({
            calendarData,
            year: Number(ano),
            month: Number(mes)
        });
        els.resultadoAgenda.innerHTML = buildResultContextMarkup('docente', { variant: 'calendar' }) + gridHtml;
        scrollResultIntoView();
    }, 140);
}

function buildResultContextMarkup(mode, options = {}) {
    const isDocente = mode === 'docente';
    const title = isDocente
        ? state.docente.nome
        : `${getCursoLabel(state.discente.curso)} - ${getTurmaLabel(state.discente.turmaId)}`;
    const eyebrow = isDocente
        ? 'Consulta Docente'
        : 'Consulta Discente';
    const badges = isDocente
        ? [
            getMonthLabel(state.docente.mes),
            Number.isFinite(state.docente.totalHoras) ? `${state.docente.totalHoras} horas-aula` : '',
            store.settings.periodo ? `Per\u00edodo ${store.settings.periodo}` : ''
        ]
        : [
            getMonthLabel(state.discente.mes),
            getTurmaLabel(state.discente.turmaId),
            store.settings.periodo ? `Per\u00edodo ${store.settings.periodo}` : ''
        ];

    return `
        <div class="pub-result-context">
            <div class="pub-result-eyebrow">${escapeHtml(eyebrow)}</div>
            <h2 class="pub-result-title">${escapeHtml(title)}</h2>
            <div class="pub-result-meta">
                ${badges.filter(Boolean).map((badge) => `<span class="pub-result-badge">${escapeHtml(badge)}</span>`).join('')}
            </div>
        </div>
    `;
}

function buildWeeklyGridHTML({ calendarData, year, month, mode }) {
    let html = '';
    let hasAnyEvent = false;

    const firstDayOfMonth = new Date(year, month - 1, 1, 12, 0, 0);
    const lastDayOfMonth = new Date(year, month, 0, 12, 0, 0);
    const termStart = new Date(`${store.settings.termStart}T12:00:00`);
    const termEnd = new Date(`${store.settings.termEnd}T12:00:00`);
    const dayNames = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];

    const cursor = new Date(firstDayOfMonth);
    const diff = cursor.getDay() === 0 ? -6 : 1 - cursor.getDay();
    cursor.setDate(cursor.getDate() + diff);

    while (cursor <= lastDayOfMonth || cursor.getDay() !== 1) {
        if (cursor > lastDayOfMonth && cursor.getDay() === 1) break;

        if (cursor.getDay() === 1) {
            const weekEnd = new Date(cursor);
            weekEnd.setDate(weekEnd.getDate() + 5);

            if (weekEnd < termStart) {
                cursor.setDate(cursor.getDate() + 7);
                continue;
            }

            if (cursor > termEnd) break;

            html += `
                <div class="semana-block">
                    <div class="semana-header">Semana de ${formatDateShort(cursor)} a ${formatDateShort(weekEnd)}</div>
                    <div class="grade-semana">
            `;
        }

        if (cursor.getDay() >= 1 && cursor.getDay() <= 6) {
            const dateStr = toIsoDate(cursor);
            const events = Array.isArray(calendarData?.[dateStr]) ? calendarData[dateStr] : [];
            const dayIndex = cursor.getDay() - 1;

            html += `
                <div class="grade-dia">
                    <div class="grade-dia-header">
                        <div class="nome-dia">${dayNames[dayIndex]}</div>
                        <div class="num-dia">${String(cursor.getDate()).padStart(2, '0')}</div>
                    </div>
                    <div class="grade-slots">
            `;

            if (events.length > 0) hasAnyEvent = true;

            const holiday = events.find((event) => event?.type === 'holiday');
            if (holiday) {
                const feriadoNome = holiday.title || 'Feriado';
                html += `<div class="feriado-chip" title="${escapeHtmlAttr(feriadoNome)}">${escapeHtml(formatHolidayLabel(feriadoNome, 26))}</div>`;
            } else {
                const renderedEvents = mode === 'discente'
                    ? events.slice().sort((a, b) => {
                        const aTime = getEventStartMinutes(a, dateStr);
                        const bTime = getEventStartMinutes(b, dateStr);
                        if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return aTime - bTime;
                        return String(a?.title || a?.disciplina || '').localeCompare(String(b?.title || b?.disciplina || ''), 'pt-BR');
                    })
                    : events;

                renderedEvents.forEach((event) => {
                    html += buildMiniChipMarkup(event, cursor, mode, events);
                });
            }

            html += `
                    </div>
                </div>
            `;
        }

        if (cursor.getDay() === 6) {
            html += '</div></div>';
        }

        cursor.setDate(cursor.getDate() + 1);
    }

    if (!hasAnyEvent) {
        const message = mode === 'docente'
            ? 'Nenhuma aula publicada para este professor no mes selecionado.'
            : 'Nenhuma aula publicada para esta turma no mes selecionado.';
        return `<div class="pub-empty-state">${message}</div>`;
    }

    return html;
}

function buildMiniChipMarkup(event, dateObj, mode, dailyEvents = []) {
    const dateStr = toIsoDate(dateObj);
    const horario = getEventHorario(event, dateStr);
    const intervalo = getEventDailyIntervalLabel(event, dailyEvents, dateStr);
    const titulo = String(event?.title || event?.disciplina || 'Componente').trim();
    const docente = getEventTeacherLabel(event);
    const turma = getTurmaLabel(event?.turmaId, event?.subGrupo);
    const local = getEventLocationLabel(event);
    const cor = String(event?.cor || '#355344').trim();
    const modo = String(event?.modo || 'semanal').trim();
    const data = formatDateFull(dateObj);
    const faixaLabel = getEventFaixaLabel(event, dateStr);
    const turnoLabel = getEventTurnoLabel(event, dateStr);
    const chipLabel = mode === 'docente'
        ? buildTeacherChipLabel(event)
        : getDisciplinaShortLabel(event?.disciplina || titulo, titulo);
    const wrapClass = chipLabel.length > 16 ? ' wrap' : '';
    const shiftMeta = getPublicShiftChangeMeta(event, dateStr);
    const badgeMarkup = buildPublicShiftBadgeMarkup(shiftMeta, true);

    return `
        <div
            class="mini-chip"
            role="button"
            tabindex="0"
            style="background-color:${escapeHtmlAttr(cor)}"
            data-titulo="${escapeHtmlAttr(titulo)}"
            data-docente="${escapeHtmlAttr(docente)}"
            data-turma="${escapeHtmlAttr(turma)}"
            data-horario="${escapeHtmlAttr(horario)}"
            data-intervalo="${escapeHtmlAttr(intervalo)}"
            data-data="${escapeHtmlAttr(data)}"
            data-local="${escapeHtmlAttr(local)}"
            data-modo="${escapeHtmlAttr(modo)}"
            data-faixa="${escapeHtmlAttr(faixaLabel)}"
            data-turno="${escapeHtmlAttr(turnoLabel)}"
            data-shift-label="${escapeHtmlAttr(shiftMeta.badgeLabel || '')}"
            data-cor="${escapeHtmlAttr(cor)}"
            data-excepcional="${shiftMeta.isShiftChange ? 'true' : 'false'}"
        >
            <div class="chip-hora">${escapeHtml(formatChipStartTime(horario))}</div>
            <div class="chip-sigla${wrapClass}">${escapeHtml(chipLabel)}</div>
            ${badgeMarkup ? `<div class="mini-chip-shift">${badgeMarkup}</div>` : ''}
        </div>
    `;
}

function buildTeacherChipLabel(event) {
    const shortLabel = getDisciplinaShortLabel(event?.disciplina, event?.title || event?.disciplina || '');
    const turma = getTurmaLabel(event?.turmaId, event?.subGrupo);
    return turma ? `${shortLabel} - ${turma}` : shortLabel;
}

function getDisciplinaShortLabel(componentName, fallbackTitle) {
    const normalized = normalizeText(componentName);
    const info = state.componentInfoByName.get(normalized);
    const raw = String(info?.abreviacao || fallbackTitle || componentName || '').trim();
    if (!raw) return 'Componente';
    if (raw.length <= 16) return raw;
    return raw.slice(0, 16);
}

function getTurmaLabel(turmaId, subGrupo) {
    const baseId = String(turmaId || '').trim();
    if (!baseId) return '--';

    const turmaInfo = state.turmaById.get(baseId);
    const baseLabel = turmaInfo?.turma_label || baseId;
    const grupo = String(subGrupo || '').trim();
    return grupo ? `${baseLabel} ${grupo}` : baseLabel;
}

function getEventTeacherLabel(event) {
    const names = [];

    if (typeof event?.docente === 'string') names.push(event.docente.trim());
    else if (event?.docente?.nome) names.push(String(event.docente.nome).trim());

    if (Array.isArray(event?.docentes)) {
        event.docentes.forEach((entry) => {
            const raw = entry?.nome || entry;
            const name = String(raw || '').trim();
            if (name) names.push(name);
        });
    }

    const uniqueNames = [...new Set(names.filter(Boolean))];
    return uniqueNames.length ? uniqueNames.join(' / ') : 'A definir';
}

function normalizePublicTurnoKey(value) {
    const normalized = String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();

    if (normalized.includes('manh') && normalized.includes('tard')) return 'manha_tarde';
    if (normalized.includes('tard') && normalized.includes('noit')) return 'tarde_noite';
    if (normalized.includes('manh') && normalized.includes('noit')) return 'integral';
    if (normalized.includes('manh')) return 'manha';
    if (normalized.includes('tard') || normalized.includes('vesp')) return 'tarde';
    if (normalized.includes('noit')) return 'noite';
    return normalized;
}

function getShiftChangeLabel(letter = '') {
    if (letter === 'M') return 'Manha';
    if (letter === 'T') return 'Tarde';
    if (letter === 'N') return 'Noturno';
    return '';
}

function shiftIsoDate(dateStr, days = 0) {
    const raw = String(dateStr || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
    const date = new Date(`${raw}T12:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    date.setDate(date.getDate() + Number(days || 0));
    return toIsoDate(date);
}

function getEventTurnoLabel(event, dateStr = '') {
    return getShiftChangeLabel(getTurnoLetter(getEventHorario(event, dateStr))) || '--';
}

function getEventFaixaLabel(event, dateStr = '') {
    const rawFaixas = Array.isArray(event?.faixas) ? event.faixas.filter(Boolean) : [];
    if (!rawFaixas.length) return '';

    const resolvedFaixas = rawFaixas.map((faixa, index) => {
        const inicio = String(faixa?.inicio || '').trim();
        let fim = String(faixa?.fim || '').trim();
        if (!fim && rawFaixas[index + 1]?.inicio) fim = shiftIsoDate(rawFaixas[index + 1].inicio, -1);
        if (!fim) fim = String(event?.dataFim || event?.dataInicio || inicio || '').trim();
        return { index: index + 1, inicio, fim };
    }).filter((faixa) => faixa.inicio);

    if (!resolvedFaixas.length) return '';
    if (resolvedFaixas.length === 1) return 'Faixa 1';

    const targetDate = String(dateStr || '').trim();
    const matched = resolvedFaixas.find((faixa) => (
        targetDate
        && targetDate >= faixa.inicio
        && (!faixa.fim || targetDate <= faixa.fim)
    ));

    return `Faixa ${(matched || resolvedFaixas[0]).index}`;
}

function buildPublicShiftWarningMarkup(shiftMeta, compact = false) {
    if (!shiftMeta?.isShiftChange || !shiftMeta?.badgeLabel) return '';
    const extraText = compact
        ? `Aula excepcional no turno ${shiftMeta.badgeLabel}.`
        : `Esta aula ocorre excepcionalmente em um turno diferente do habitual da turma: ${shiftMeta.badgeLabel}.`;
    return `<div class="pub-shift-warning"><strong>&#9888; Atenção:</strong> ${escapeHtml(extraText)}</div>`;
}

function buildPublicShiftBadgeMarkup(shiftMeta, compact = false) {
    if (!shiftMeta?.isShiftChange || !shiftMeta?.badgeLabel) return '';

    const className = compact ? 'pub-shift-badge is-compact' : 'pub-shift-badge';
    const badgeLabel = String(shiftMeta.badgeLabel || '').trim();
    const title = `Mudou de turno: aula no turno ${badgeLabel}.`;

    return `
        <span class="${className}" title="${escapeHtmlAttr(title)}">
            <span class="pub-shift-badge-symbol">&#9888;</span>
            <span>${escapeHtml(badgeLabel)}</span>
        </span>
    `;
}

function getNativeTurnoLetterForEvent(event) {
    const turmaInfo = state.turmaById.get(String(event?.turmaId || '').trim());
    const nativeKey = normalizePublicTurnoKey(turmaInfo?.turno || event?.turno || '');
    if (nativeKey === 'manha') return 'M';
    if (nativeKey === 'tarde') return 'T';
    if (nativeKey === 'noite') return 'N';
    // Para turnos combinados (ex: Manhã+Tarde), retornamos vazio para evitar alertas de mudança de turno desnecessários
    return '';
}

function getEventHorariosForDate(event, dateStr = '') {
    if (dateStr && event?.executionByDate && Array.isArray(event.executionByDate[dateStr]) && event.executionByDate[dateStr].length > 0) {
        return event.executionByDate[dateStr].map((slot) => String(slot || '').trim()).filter(Boolean);
    }

    if (dateStr && event?.dataFim === dateStr && Array.isArray(event?.horariosUltimoDia) && event.horariosUltimoDia.length > 0) {
        return event.horariosUltimoDia.map((slot) => String(slot || '').trim()).filter(Boolean);
    }

    if (Array.isArray(event?.horariosOcupados) && event.horariosOcupados.length > 0) {
        return event.horariosOcupados.map((slot) => String(slot || '').trim()).filter(Boolean);
    }

    if (event?.horario) return [String(event.horario).trim()];
    return [];
}

function getRawEventHorario(event) {
    if (event?.horario) return String(event.horario).trim();
    if (Array.isArray(event?.horariosOcupados) && event.horariosOcupados.length > 0) {
        return String(event.horariosOcupados[0] || '').trim() || '--:--';
    }
    return '--:--';
}

function getEventHorario(event, dateStr = '') {
    const rawHorario = getRawEventHorario(event);
    if (rawHorario && rawHorario !== '--:--') return rawHorario;
    const slots = getEventHorariosForDate(event, dateStr);
    return slots[0] || '--:--';
}

function getPublicShiftChangeMeta(event, dateStr = '') {
    const horario = getEventHorario(event, dateStr);
    const nativeLetter = getNativeTurnoLetterForEvent(event);
    // Deriva o turno pelo slot REAL daquele dia (executionByDate/horariosUltimoDia/ocupados),
    // permitindo detectar deslocamento de turno em qualquer dia da semana, não só no sábado.
    const daySlots = getEventHorariosForDate(event, dateStr);
    const currentLetter = getTurnoLetter(daySlots[0] || horario);
    // Sábado de manhã só é mudança de turno se o turno nativo da turma NÃO for a manhã.
    // Turmas cujo horário padrão já é a manhã não recebem a tag de atenção no sábado.
    const isSaturdayMorning = !!(
        event?.sabadoManha
        && dateStr
        && new Date(`${dateStr}T12:00:00`).getDay() === 6
        && nativeLetter !== 'M'
    );
    const isShiftChange = !!(
        (nativeLetter && currentLetter && nativeLetter !== currentLetter)
        || isSaturdayMorning
    );
    const effectiveLetter = currentLetter || (isSaturdayMorning ? 'M' : '');
    const badgeLabel = isShiftChange ? getShiftChangeLabel(effectiveLetter) : '';

    return {
        horario,
        nativeLetter,
        currentLetter,
        isShiftChange,
        badgeLabel
    };
}

function getEventStartMinutes(event, dateStr = '') {
    const horario = getEventHorario(event, dateStr);
    const match = String(horario || '').match(/\d{1,2}:\d{2}/);
    return match ? timeToMinutes(match[0]) : Number.POSITIVE_INFINITY;
}

function getPreferredGroupEvents(events = [], dateStr = '') {
    const groupEvents = Array.isArray(events) ? events.slice() : [];
    if (!groupEvents.length) return [];

    const shiftedEvents = groupEvents.filter((event) => getPublicShiftChangeMeta(event, dateStr).isShiftChange);
    return shiftedEvents.length > 0 ? shiftedEvents : groupEvents;
}

function selectRepresentativeGroupEvent(events = [], dateStr = '') {
    const candidates = getPreferredGroupEvents(events, dateStr);
    if (!candidates.length) return null;

    return candidates
        .slice()
        .sort((a, b) => {
            const shiftDiff = Number(getPublicShiftChangeMeta(b, dateStr).isShiftChange) - Number(getPublicShiftChangeMeta(a, dateStr).isShiftChange);
            if (shiftDiff !== 0) return shiftDiff;

            const startDiff = getEventStartMinutes(a, dateStr) - getEventStartMinutes(b, dateStr);
            if (Number.isFinite(startDiff) && startDiff !== 0) return startDiff;

            return String(a?.title || a?.disciplina || '').localeCompare(String(b?.title || b?.disciplina || ''), 'pt-BR');
        })[0];
}

function getEventDailyIntervalLabel(event, dailyEvents = [], dateStr = '') {
    const currentKey = buildEventGroupKey(event);
    const matchingEvents = (Array.isArray(dailyEvents) ? dailyEvents : []).filter((item) => {
        if (!item || item.type === 'holiday') return false;
        return buildEventGroupKey(item) === currentKey;
    });

    const bounds = matchingEvents
        .map((item) => parseHorarioBounds(getEventHorario(item, dateStr)))
        .filter(Boolean);

    if (!bounds.length) {
        return formatHorarioIntervalo(getEventHorario(event, dateStr));
    }

    const firstStart = bounds.reduce((min, item) => Math.min(min, item.startMinutes), Number.POSITIVE_INFINITY);
    const lastEnd = bounds.reduce((max, item) => Math.max(max, item.endMinutes), Number.NEGATIVE_INFINITY);

    if (!Number.isFinite(firstStart) || !Number.isFinite(lastEnd) || lastEnd <= firstStart) {
        return formatHorarioIntervalo(getEventHorario(event, dateStr));
    }

    return `de ${formatMinutesShort(firstStart)} a ${formatMinutesShort(lastEnd)}`;
}

function buildEventGroupKey(event) {
    return [
        normalizeText(event?.title || event?.disciplina || ''),
        normalizeText(event?.turmaId || ''),
        normalizeText(event?.subGrupo || ''),
        normalizeText(getEventTeacherLabel(event)),
        normalizeText(event?.modo || ''),
        normalizeText(getEventLocationLabel(event))
    ].join('|');
}

function parseHorarioBounds(horario) {
    const matches = String(horario || '').match(/\d{1,2}:\d{2}/g);
    if (!matches || matches.length < 2) return null;

    const startMinutes = timeToMinutes(matches[0]);
    const endMinutes = timeToMinutes(matches[1]);
    if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || endMinutes <= startMinutes) {
        return null;
    }

    return {
        startMinutes,
        endMinutes
    };
}

function formatMinutesShort(totalMinutes) {
    if (!Number.isFinite(totalMinutes)) return '--';
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h${String(minutes).padStart(2, '0')}`;
}

function getEventLocationLabel(event) {
    const directCandidates = [
        event?.local,
        event?.localizacao,
        event?.espaco,
        event?.ambiente,
        event?.laboratorio
    ];

    for (const candidate of directCandidates) {
        const value = String(candidate || '').trim();
        if (value) return value;
    }

    const sala = normalizeLocationSegment('Sala', event?.sala);
    const bloco = normalizeLocationSegment('Bloco', event?.bloco);
    if (sala && bloco) return `${sala}, ${bloco}`;
    if (sala) return sala;
    if (bloco) return bloco;

    return '--';
}

function normalizeLocationSegment(prefix, value) {
    const text = String(value || '').trim();
    if (!text) return '';

    const normalizedPrefix = normalizeText(prefix);
    const normalizedText = normalizeText(text);
    if (normalizedText.startsWith(normalizedPrefix)) return text;

    return `${prefix} ${text}`;
}

function handleAgendaChipClick(event) {
    const chip = event.target.closest('.mini-chip');
    if (chip) { abrirSlotLens(chip); return; }
    const mcdChip = event.target.closest('.mcd-event[data-disc-key]');
    if (mcdChip) { abrirDayLens(mcdChip); return; }
}

function handleAgendaChipKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const chip = event.target.closest('.mini-chip');
    if (chip) { event.preventDefault(); abrirSlotLens(chip); return; }
    const mcdChip = event.target.closest('.mcd-event[data-disc-key]');
    if (mcdChip) { event.preventDefault(); abrirDayLens(mcdChip); }
}

function handleSlotLensClick(event) {
    if (!event.target.closest('.slot-lens-close')) return;
    event.preventDefault();
    fecharSlotLens(true);
}

function abrirSlotLens(chip) {
    if (!chip || !els.slotLens) return;

    if (activeLensChip === chip && els.slotLens.classList.contains('active')) {
        fecharSlotLens(true);
        return;
    }

    activeLensChip = chip;
    els.slotLens.innerHTML = buildSlotLensMarkup(chip);
    els.slotLens.hidden = false;
    els.slotLens.classList.remove('active', 'is-below');
    els.slotLens.style.top = '0px';
    els.slotLens.style.left = '0px';

    requestAnimationFrame(() => {
        positionSlotLens(chip);
        els.slotLens?.classList.add('active');
    });
}

function buildSlotLensMarkup(chip) {
    const titulo = chip.getAttribute('data-titulo') || 'Componente';
    const data = chip.getAttribute('data-data') || '--';
    const horario = chip.getAttribute('data-horario') || '--';
    const intervalo = chip.getAttribute('data-intervalo') || formatHorarioIntervalo(horario);
    const docente = chip.getAttribute('data-docente') || '--';
    const turma = chip.getAttribute('data-turma') || '--';
    const local = chip.getAttribute('data-local') || '--';
    const faixa = chip.getAttribute('data-faixa') || '--';
    const turno = chip.getAttribute('data-turno') || '--';
    const shiftLabel = chip.getAttribute('data-shift-label') || '';
    const cor = chip.getAttribute('data-cor') || '#0b5a35';
    const shiftMeta = {
        isShiftChange: chip.getAttribute('data-excepcional') === 'true',
        badgeLabel: shiftLabel
    };

    return `
        <div class="slot-lens-card" style="--lens-accent:${escapeHtmlAttr(cor)}">
            <div class="slot-lens-arrow"></div>
            <div class="slot-lens-stem"></div>
            <div class="slot-lens-head">
                <h3 class="slot-lens-title">${escapeHtml(titulo)}</h3>
                <button type="button" class="slot-lens-close" aria-label="Fechar detalhe">&times;</button>
            </div>
            <div class="slot-lens-body">
                <div class="slot-lens-line">
                    <strong>Docente:</strong>
                    <span>${escapeHtml(docente)}</span>
                </div>
                <div class="slot-lens-inline">
                    <div class="slot-lens-line">
                        <strong>Turma:</strong>
                        <span>${escapeHtml(turma)}</span>
                    </div>
                    <div class="slot-lens-line">
                        <strong>Data:</strong>
                        <span>${escapeHtml(data)}</span>
                    </div>
                </div>
                <div class="slot-lens-inline">
                    <div class="slot-lens-line">
                        <strong>Faixa:</strong>
                        <span>${escapeHtml(faixa)}</span>
                    </div>
                    <div class="slot-lens-line">
                        <strong>Turno:</strong>
                        <span>${escapeHtml(turno)}</span>
                    </div>
                </div>
                <div class="slot-lens-line">
                    <strong>Hor\u00e1rio:</strong>
                    <span>${escapeHtml(intervalo)}</span>
                </div>
                <div class="slot-lens-line">
                    <strong>Local:</strong>
                    <span>${escapeHtml(local)}</span>
                </div>
                ${buildPublicShiftWarningMarkup(shiftMeta)}
            </div>
        </div>
    `;
}

function positionSlotLens(chip = activeLensChip) {
    if (!chip || !els.slotLens) return;

    const chipRect = chip.getBoundingClientRect();
    const lensRect = els.slotLens.getBoundingClientRect();
    const gap = 12;
    const viewportPadding = 8;
    const maxLeft = Math.max(viewportPadding, window.innerWidth - lensRect.width - viewportPadding);
    const left = Math.min(
        maxLeft,
        Math.max(viewportPadding, chipRect.left + (chipRect.width / 2) - (lensRect.width / 2))
    );

    let top = chipRect.top - lensRect.height - gap;
    let below = false;

    if (top < viewportPadding) {
        top = chipRect.bottom + gap;
        below = true;
    }

    const maxTop = Math.max(viewportPadding, window.innerHeight - lensRect.height - viewportPadding);
    top = Math.min(maxTop, Math.max(viewportPadding, top));

    const arrowLeft = Math.min(
        lensRect.width - 26,
        Math.max(20, chipRect.left + (chipRect.width / 2) - left - 7)
    );

    els.slotLens.style.left = `${Math.round(left)}px`;
    els.slotLens.style.top = `${Math.round(top)}px`;
    els.slotLens.style.setProperty('--lens-arrow-left', `${Math.round(arrowLeft)}px`);
    els.slotLens.classList.toggle('is-below', below);
}

function fecharSlotLens(immediate = false) {
    if (!els.slotLens) return;

    activeLensChip = null;
    els.slotLens.classList.remove('active', 'is-below');

    const finalize = () => {
        if (!els.slotLens || els.slotLens.classList.contains('active')) return;
        els.slotLens.hidden = true;
        els.slotLens.innerHTML = '';
        els.slotLens.style.removeProperty('top');
        els.slotLens.style.removeProperty('left');
        els.slotLens.style.removeProperty('--lens-arrow-left');
    };

    if (immediate) {
        finalize();
        return;
    }

    window.setTimeout(finalize, 180);
}

function abrirBottomSheet(chip) {
    if (!chip) return;

    if (els.sheetTitle) {
        els.sheetTitle.textContent = chip.getAttribute('data-titulo') || 'Componente';
        els.sheetTitle.style.color = chip.getAttribute('data-cor') || '#173728';
    }
    if (els.sheetTipo) els.sheetTipo.textContent = getAgendaModoTexto(chip.getAttribute('data-modo'));
    if (els.sheetData) els.sheetData.textContent = chip.getAttribute('data-data') || '--';
    if (els.sheetHorario) els.sheetHorario.textContent = chip.getAttribute('data-horario') || '--';
    if (els.sheetDocente) els.sheetDocente.textContent = chip.getAttribute('data-docente') || '--';
    if (els.sheetTurma) els.sheetTurma.textContent = chip.getAttribute('data-turma') || '--';

    els.sheetOverlay?.classList.add('active');
    els.bottomSheet?.classList.add('active');
}

function fecharBottomSheet() {
    els.sheetOverlay?.classList.remove('active');
    els.bottomSheet?.classList.remove('active');
}

function getAgendaModoTexto(modo) {
    const normalized = String(modo || '').trim().toLowerCase();
    if (normalized === 'intensiva') return 'Oferta por Faixas';
    return 'Oferta';
}

function formatHorarioIntervalo(horario) {
    const matches = String(horario || '').match(/\d{1,2}:\d{2}/g);
    if (!matches || matches.length < 2) return String(horario || '--');
    return `de ${formatHourShort(matches[0])} a ${formatHourShort(matches[1])}`;
}

function formatHourShort(value) {
    const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
    if (!match) return String(value || '--');
    return `${Number(match[1])}h${match[2]}`;
}

function calculateMonthlyTeacherHours(calendarData) {
    let total = 0;

    Object.values(calendarData || {}).forEach((events) => {
        (events || []).forEach((event) => {
            if (event?.type === 'holiday') return;
            total += calculateEventHours(event);
        });
    });

    return total;
}

function calculateEventHours(event) {
    const horario = getEventHorario(event);
    const matches = horario.match(/\d{1,2}:\d{2}/g);
    if (!matches || matches.length < 2) return 1;

    const start = timeToMinutes(matches[0]);
    const end = timeToMinutes(matches[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 1;

    return Math.max(1, Math.round((end - start) / 50));
}



function renderResultLoading(message) {
    if (!els.resultadoAgenda) return;
    els.resultadoAgenda.innerHTML = `<div class="pub-loading">${escapeHtml(message)}</div>`;
}

function renderResultEmpty(message) {
    if (!els.resultadoAgenda) return;
    els.resultadoAgenda.innerHTML = `<div class="pub-empty-state">${escapeHtml(message)}</div>`;
}

function syncDocenteInputState() {
    if (!els.inpDocente) return;

    if (!state.docentesDisponiveis.length) {
        els.inpDocente.placeholder = 'Nenhum professor publicado.';
        els.inpDocente.disabled = true;
        return;
    }

    els.inpDocente.placeholder = 'Digite o nome do professor...';
    els.inpDocente.disabled = false;
}

function syncBackToTopButton() {
    if (!els.btnTopo) return;
    els.btnTopo.style.display = window.scrollY > 320 ? 'flex' : 'none';
}

function scrollResultIntoView() {
    if (!els.resultadoAgenda) return;
    requestAnimationFrame(() => {
        els.resultadoAgenda.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
}

function highlightActiveButton(container, activeButton) {
    if (!container || !activeButton) return;
    Array.from(container.querySelectorAll('.pub-pill')).forEach((button) => {
        button.classList.toggle('active', button === activeButton);
    });
}

function normalizeText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toUpperCase();
}

function toIsoDate(date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');
}

function formatDateShort(date) {
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatDateFull(date) {
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

function formatIsoDateBR(value) {
    const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return String(value || '--');
    return `${match[3]}/${match[2]}/${match[1]}`;
}

function getMonthLabel(monthKey) {
    if (!monthKey) return '';
    const [year, month] = String(monthKey).split('-');
    if (!year || !month) return String(monthKey);
    const date = new Date(Number(year), Number(month) - 1, 1, 12, 0, 0);
    return `${capitalizeWord(date.toLocaleString('pt-BR', { month: 'long' }))} ${year}`;
}

function getCursoLabel(sigla) {
    const target = String(sigla || '').trim();
    if (!target) return 'Curso';
    const curso = (store.rawData?.cursos || []).find((item) => String(item?.sigla || '').trim() === target);
    return curso?.curso || target;
}

function formatChipStartTime(horario) {
    const match = String(horario || '').match(/(\d{1,2}):(\d{2})/);
    if (!match) return '--:--';
    return `${match[1].padStart(2, '0')}h${match[2]}`;
}

function timeToMinutes(value) {
    const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
    if (!match) return Number.NaN;
    return Number(match[1]) * 60 + Number(match[2]);
}

function capitalizeWord(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatHolidayLabel(value, maxLen = 24) {
    const text = String(value || '').trim();
    if (!text) return 'Feriado';
    if (text.length <= maxLen) return text;
    return `${text.slice(0, Math.max(1, maxLen - 1)).trimEnd()}\u2026`;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeHtmlAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
}


// ─── Monthly Calendar ────────────────────────────────────────────────────────
let lastDocenteCalendarData = null;
let activeDayCell = null;

function buildMonthlyCalendarHTML({ calendarData, year, month }) {
    const dayNames = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'S\u00e1b'];
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    // For Mon-Sat grid: offset = (dayOfWeek + 6) % 7; Sundays (0) get offset 0 (they're skipped)
    const firstDow = firstDay.getDay();
    const startOffset = firstDow === 0 ? 0 : (firstDow + 6) % 7;
    const todayStr = toIsoDate(new Date());
    let hasAnyEvent = false;

    let header = '<div class="month-cal-header">';
    dayNames.forEach(d => { header += `<div class="month-cal-hdcell">${d}</div>`; });
    header += '</div>';

    let grid = '<div class="month-cal-grid">';
    for (let i = 0; i < startOffset; i++) {
        grid += '<div class="month-cal-day is-empty" aria-hidden="true"></div>';
    }

    for (let d = 1; d <= lastDay.getDate(); d++) {
        const dateObj = new Date(year, month - 1, d);
        const dow = dateObj.getDay();
        if (dow === 0) continue; // Skip Sundays
        const dateStr = toIsoDate(dateObj);
        const events = Array.isArray(calendarData?.[dateStr]) ? calendarData[dateStr] : [];
        const isHoliday = events.some(e => e.type === 'holiday');
        const holidayEvent = events.find(e => e.type === 'holiday');
        const classEvents = events.filter(e => e.type !== 'holiday');
        const isToday = dateStr === todayStr;
        if (classEvents.length > 0) hasAnyEvent = true;

        let cls = 'month-cal-day';
        if (dow === 6) cls += ' is-weekend'; // Saturday only
        if (isToday) cls += ' is-today';
        const hasContent = isHoliday || classEvents.length > 0;

        grid += `<div class="${cls}" data-date="${dateStr}">`;
        grid += `<div class="mcd-num">${d}</div>`;

        if (isHoliday) {
            const feriadoNome = holidayEvent?.title || 'Feriado';
            grid += `<div class="mcd-feriado" title="${escapeHtmlAttr(feriadoNome)}">${escapeHtml(formatHolidayLabel(feriadoNome, 14))}</div>`;
        }

        // Group by discipline — one chip per component
        const discGroups = new Map();
        classEvents.forEach((ev) => {
            const key = `${normalizeText(ev.disciplina || ev.title || '')}|${ev.turmaId || ''}|${ev.subGrupo || ''}`;
            if (!discGroups.has(key)) discGroups.set(key, []);
            discGroups.get(key).push(ev);
        });
        const uniqueDiscs = Array.from(discGroups.entries()).map(([discKey, groupEvents]) => ({
            discKey,
            representative: selectRepresentativeGroupEvent(groupEvents, dateStr)
        })).filter((entry) => entry.representative);

        uniqueDiscs.slice(0, 2).forEach(({ discKey, representative: ev }) => {
            const cor = String(ev.cor || '#355344').trim();
            const hora = formatChipStartTime(getEventHorario(ev, dateStr));
            const sigla = getDisciplinaShortLabel(ev.disciplina, ev.title || ev.disciplina || '').slice(0, 10);
            const shiftMeta = getPublicShiftChangeMeta(ev, dateStr);
            const shiftBadgeMarkup = buildPublicShiftBadgeMarkup(shiftMeta, true);
            grid += `<div class="mcd-event" style="background:${escapeHtmlAttr(cor)}" data-date="${dateStr}" data-disc-key="${escapeHtmlAttr(discKey)}" tabindex="0" role="button">`;
            grid += `<span class="mcd-event-hora">${escapeHtml(hora)}</span>`;
            grid += `<span class="mcd-event-sigla">${escapeHtml(sigla)}</span>`;
            if (shiftBadgeMarkup) grid += `<span class="mcd-event-shift">${shiftBadgeMarkup}</span>`;
            grid += `</div>`;
        });

        if (uniqueDiscs.length > 2) grid += `<div class="mcd-more">+${uniqueDiscs.length - 2}</div>`;

        grid += '</div>';
    }

    const totalCells = startOffset + lastDay.getDate() - Array.from({length: lastDay.getDate()}, (_, i) => new Date(year, month - 1, i + 1).getDay() === 0 ? 1 : 0).reduce((a, b) => a + b, 0);
    const remainder = totalCells % 6;
    if (remainder !== 0) {
        for (let i = 0; i < 6 - remainder; i++) {
            grid += '<div class="month-cal-day is-empty" aria-hidden="true"></div>';
        }
    }
    grid += '</div>';

    if (!hasAnyEvent) {
        return '<div class="pub-empty-state">Nenhuma aula publicada para este professor no m\u00eas selecionado.</div>';
    }
    return `<div class="month-cal">${header}${grid}</div>`;
}

function buildDayLensMarkup(events, dateStr, filterKey = null) {
    const classEvents = events.filter(e => e.type !== 'holiday');
    if (!classEvents.length) return '';

    const groups = new Map();
    classEvents.forEach(ev => {
        const key = `${normalizeText(ev.disciplina || ev.title || '')}|${ev.turmaId || ''}|${ev.subGrupo || ''}`;
        if (filterKey && key !== filterKey) return;
        if (!groups.has(key)) {
            const comp = store.rawData?.componentes?.find(c => c.componente === ev.disciplina);
            const totalCh = comp?.ch || 0;
            groups.set(key, {
                title: ev.title || ev.disciplina || 'Componente',
                turmaId: ev.turmaId,
                subGrupo: ev.subGrupo,
                cor: ev.cor || '#355344',
                local: getEventLocationLabel(ev),
                events: [],
                ch: totalCh
            });
        }
        const g = groups.get(key);
        g.events.push(ev);
    });

    const groupList = Array.from(groups.values()).map((group) => {
        const preferredEvents = getPreferredGroupEvents(group.events, dateStr);
        const representative = selectRepresentativeGroupEvent(preferredEvents, dateStr) || selectRepresentativeGroupEvent(group.events, dateStr);
        const horarios = [];

        preferredEvents.forEach((event) => {
            getEventHorariosForDate(event, dateStr).forEach((slot) => {
                if (slot && !horarios.includes(slot)) horarios.push(slot);
            });
        });

        return {
            ...group,
            horarios,
            representative,
            faixa: representative ? getEventFaixaLabel(representative, dateStr) : '',
            turno: representative ? getEventTurnoLabel(representative, dateStr) : '--',
            shiftMeta: representative ? getPublicShiftChangeMeta(representative, dateStr) : { isShiftChange: false, badgeLabel: '' }
        };
    });
    const dateObj = new Date(`${dateStr}T12:00:00`);

    let html = `<div class="day-lens-card">`;
    html += `<button type="button" class="day-lens-close" aria-label="Fechar">&times;</button>`;
    html += `<div class="day-lens-date">${escapeHtml(formatDateFull(dateObj))}</div>`;
    html += `<div class="day-lens-groups is-single">`;

    groupList.forEach(g => {
        const turma = getTurmaLabel(g.turmaId, g.subGrupo);
        html += `<div class="day-lens-group" style="--dlg-cor:${escapeHtmlAttr(g.cor)}">`;
        html += `<div class="dlg-title">${escapeHtml(g.title)}${g.ch > 0 ? `<span class="dlg-ch">${g.ch}h</span>` : ''}</div>`;
        html += `<div class="dlg-row"><span class="dlg-label">Turma</span><span class="dlg-val">${escapeHtml(turma)}</span></div>`;
        if (g.faixa || g.turno) {
            html += `<div class="dlg-row"><span class="dlg-label">Faixa / Turno</span><span class="dlg-val">${escapeHtml(g.faixa || '--')} &middot; ${escapeHtml(g.turno || '--')}</span></div>`;
        }
        html += `<div class="dlg-row"><span class="dlg-label">Local</span><span class="dlg-val">${escapeHtml(g.local)}</span></div>`;
        html += `<div class="dlg-row"><span class="dlg-label">Hor\u00e1rio</span>`;
        html += `<div class="dlg-horarios">`;
        g.horarios.forEach(h => {
            const m = String(h || '').match(/\d{1,2}:\d{2}/g) || [];
            if (m.length >= 2) {
                html += `<div class="dlg-hrow"><span>${escapeHtml(m[0])}</span><span class="dlg-dash">\u2013</span><span>${escapeHtml(m[1])}</span></div>`;
            } else if (m.length === 1) {
                html += `<div class="dlg-hrow"><span>${escapeHtml(m[0])}</span></div>`;
            }
        });
        html += `</div></div>`; // dlg-horarios + dlg-row
        html += buildPublicShiftWarningMarkup(g.shiftMeta, true);
        html += `</div>`; // day-lens-group
    });

    html += `</div>`; // day-lens-groups
    html += `<div class="day-lens-arrow"></div>`;
    html += `</div>`; // day-lens-card
    return html;
}

function abrirDayLens(chipEl) {
    if (!chipEl || !els.dayLens) return;
    const dateStr = chipEl.dataset.date;
    const discKey = chipEl.dataset.discKey;
    if (!dateStr) return;

    if (activeDayCell === chipEl && els.dayLens.classList.contains('active')) {
        fecharDayLens(true);
        return;
    }

    activeDayCell = chipEl;
    const events = lastDocenteCalendarData?.[dateStr] || [];
    const markup = buildDayLensMarkup(events, dateStr, discKey || null);
    if (!markup) return;

    els.dayLens.innerHTML = markup;
    els.dayLens.hidden = false;
    els.dayLens.classList.remove('active', 'is-below');
    els.dayLens.style.top = '0px';
    els.dayLens.style.left = '0px';

    requestAnimationFrame(() => {
        positionDayLens(chipEl);
        els.dayLens?.classList.add('active');
    });
}

function fecharDayLens(immediate = false) {
    if (!els.dayLens) return;
    activeDayCell = null;
    els.dayLens.classList.remove('active', 'is-below');

    const finalize = () => {
        if (!els.dayLens || els.dayLens.classList.contains('active')) return;
        els.dayLens.hidden = true;
        els.dayLens.innerHTML = '';
        els.dayLens.style.removeProperty('top');
        els.dayLens.style.removeProperty('left');
    };

    if (immediate) { finalize(); return; }
    window.setTimeout(finalize, 180);
}

function positionDayLens(dayCell = activeDayCell) {
    if (!dayCell || !els.dayLens) return;

    const cellRect = dayCell.getBoundingClientRect();
    const lensRect = els.dayLens.getBoundingClientRect();
    const gap = 10;
    const vpad = 8;
    const hpad = 8;

    const spaceAbove = cellRect.top - vpad;
    const placeBelow = spaceAbove < lensRect.height + gap;

    const top = placeBelow
        ? Math.min(window.innerHeight - lensRect.height - vpad, cellRect.bottom + gap)
        : Math.max(vpad, cellRect.top - lensRect.height - gap);

    const centerX = cellRect.left + cellRect.width / 2;
    const left = Math.max(hpad, Math.min(window.innerWidth - lensRect.width - hpad, centerX - lensRect.width / 2));

    els.dayLens.style.top = `${Math.round(top)}px`;
    els.dayLens.style.left = `${Math.round(left)}px`;
    els.dayLens.classList.toggle('is-below', placeBelow);
}

