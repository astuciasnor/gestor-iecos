// Sincronizacao das alocacoes com o banco compartilhado (Supabase).
// O navegador continua guardando uma copia (cache) de cada plano; este modulo
// carrega o plano ativo do servidor, envia as alteracoes do curso do usuario e
// recebe em tempo real as alteracoes dos outros cursos.
import { store } from './store.js??v=20261028a';
import { buildTurmaParaCursoMap } from './serialization.js';
import { readJsonStorage, writeJsonStorage } from './plan_storage.js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_JS_URL } from './backend_config.js';
import {
  computePushPlan,
  reconcileAllocations,
  buildSyncedMap,
  getAllocationCurso
} from './sync_diff.mjs';

const SYNCED_PREFIX = 'cardume_sync_v1::';
const BACKUP_PREFIX = 'cardume_backup_v1::';
const PAGE_SIZE = 1000;
const WRITE_CHUNK = 200;
const PUSH_DEBOUNCE_MS = 600;
const RETRY_MS = 15000;
const FOCUS_REFRESH_MIN_MS = 30000;

let client = null;
let perfil = null;
let currentUser = null;

let activeKey = '';
let ready = false;
let loadToken = 0;
let synced = new Map();      // id -> { h, c } da ultima versao confirmada no servidor
let remoteById = new Map();  // id -> copia da versao do servidor (para desfazer bloqueios)
let channel = null;

let pushTimer = null;
let retryTimer = null;
let pushing = false;
let pushAgain = false;
let lastFocusRefresh = 0;
let lastBlockedNotice = 0;

let onRemoteChange = () => {};
let onBlocked = () => {};
let onStatus = () => {};

// ===== Conexao e login =====

export async function connect() {
  if (client) return client;
  const { createClient } = await import(SUPABASE_JS_URL);
  client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
  return client;
}

export async function getSessionUser() {
  const { data } = await client.auth.getSession();
  currentUser = data?.session?.user || null;
  return currentUser;
}

export async function signIn(email, password) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  currentUser = data.user;
  return currentUser;
}

export async function signOut() {
  if (channel) await client.removeChannel(channel);
  channel = null;
  await client.auth.signOut();
}

// Outra aba deste navegador entrou com outro usuario (ou saiu): esta pagina
// continuaria mostrando o nome antigo enquanto o servidor ja usa o login novo.
export function watchSessionChange(onChange) {
  const startedAs = currentUser?.id || null;
  const check = (id) => {
    if (id !== startedAs) onChange();
  };
  client.auth.onAuthStateChange((_event, session) => check(session?.user?.id || null));
  window.addEventListener('storage', (event) => {
    if (!/^sb-.+-auth-token$/.test(event.key || '')) return;
    let id = null;
    try { id = JSON.parse(event.newValue || 'null')?.user?.id || null; } catch (e) { return; }
    check(id);
  });
}

export async function loadPerfil() {
  if (!currentUser) return null;
  const { data, error } = await client
    .from('perfis')
    .select('nome, curso, papel')
    .eq('usuario', currentUser.id)
    .maybeSingle();
  if (error) throw error;
  perfil = data;
  return perfil;
}

export function getPerfil() {
  return perfil ? { ...perfil, email: currentUser?.email || '' } : null;
}

export function canEditCurso(curso) {
  if (!perfil) return false;
  if (perfil.papel === 'admin') return true;
  return String(perfil.curso || '').toUpperCase() === String(curso || '').toUpperCase();
}

export function getCursoOfTurma(turmaId) {
  return cursoOf({ turmaId });
}

function cursoOf(alloc) {
  return getAllocationCurso(alloc, buildTurmaParaCursoMap(store.rawData?.turmas || []));
}

// ===== Inicio da sincronizacao =====

export async function startSync(callbacks = {}) {
  onRemoteChange = callbacks.onRemoteChange || onRemoteChange;
  onBlocked = callbacks.onBlocked || onBlocked;
  onStatus = callbacks.onStatus || onStatus;

  store.onAllocationsSaved = schedulePush;
  store.onPlanLoaded = (meta) => { activatePlan(meta?.key); };

  window.addEventListener('focus', () => {
    if (Date.now() - lastFocusRefresh < FOCUS_REFRESH_MIN_MS) return;
    lastFocusRefresh = Date.now();
    activatePlan(activeKey, { force: true });
  });
  window.addEventListener('online', () => activatePlan(activeKey, { force: true }));

  await activatePlan(store.getActivePlanMeta().key);
}

async function activatePlan(key, { force = false } = {}) {
  if (!key || !client) return;
  if (key === activeKey && ready && !force) return;

  const switching = key !== activeKey;
  const token = ++loadToken;
  if (switching) {
    activeKey = key;
    ready = false;
    synced = new Map();
    remoteById = new Map();
    await unsubscribe();
  }
  setStatus('carregando');

  try {
    const remote = await fetchPlanAllocations(key);
    if (token !== loadToken || store.getActivePlanMeta().key !== key) return;
    applyRemoteSnapshot(key, remote);
    if (!channel) subscribe(key);
    ready = true;
    setStatus('ok');
    schedulePush();
  } catch (error) {
    if (token !== loadToken) return;
    console.error('Falha ao carregar o plano do servidor', error);
    setStatus('erro', describeError(error));
    scheduleRetry(() => activatePlan(key, { force: true }));
  }
}

async function fetchPlanAllocations(key) {
  const all = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from('alocacoes')
      .select('dados')
      .eq('plano', key)
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    (data || []).forEach((row) => { if (row?.dados?.id) all.push(row.dados); });
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

// Usado pela publicacao online, que precisa de varios periodos de uma vez.
export async function fetchAllocationsForPlans(keys = []) {
  const result = {};
  for (const key of keys) {
    result[key] = key === activeKey && ready ? store.allocations : await fetchPlanAllocations(key);
  }
  return result;
}

function applyRemoteSnapshot(key, remote) {
  const persisted = readSynced(key);
  let local = Array.isArray(store.allocations) ? store.allocations : [];
  local.forEach((alloc) => {
    if (alloc && typeof alloc === 'object' && !alloc.id) alloc.id = crypto.randomUUID();
  });

  // Copia de seguranca do que havia so neste navegador antes da primeira sincronizacao.
  if (!persisted && local.length && !localStorage.getItem(BACKUP_PREFIX + key)) {
    writeJsonStorage(localStorage, BACKUP_PREFIX + key, local);
  }

  if (!persisted) {
    const remoteIds = new Set(remote.map((a) => a.id));
    const localOnly = local.filter((a) => a?.id && !remoteIds.has(a.id) && canEditCurso(cursoOf(a)));
    if (localOnly.length) {
      const send = confirm(
        `Encontramos ${localOnly.length} oferta(s) do seu curso salvas apenas neste navegador ` +
        `(${store.getActivePlanMeta().periodo}) que ainda nao estao no servidor.\n\n` +
        `OK: enviar para o servidor (os outros coordenadores passam a ver).\n` +
        `Cancelar: descartar e usar so o que esta no servidor (uma copia fica guardada neste navegador).`
      );
      if (!send) {
        const discard = new Set(localOnly.map((a) => a.id));
        local = local.filter((a) => !discard.has(a?.id));
      }
    }
  }

  const merged = reconcileAllocations({
    local,
    remote,
    synced: persisted || new Map(),
    canEdit: canEditCurso,
    cursoOf
  });

  store.allocations = merged.map((alloc) => structuredClone(alloc));
  store.corrigirAlocacoes(store.allocations);
  store.writeAllocationsCache();
  synced = buildSyncedMap(remote, cursoOf);
  remoteById = new Map(remote.map((a) => [a.id, a]));
  persistSynced();
  onRemoteChange();
}

// ===== Envio =====

function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, PUSH_DEBOUNCE_MS);
}

async function push() {
  if (!ready || !client) return;
  if (store.getActivePlanMeta().key !== activeKey) return;
  if (pushing) {
    pushAgain = true;
    return;
  }
  pushing = true;
  // Referencias fixas: se o usuario trocar de periodo durante o envio, o
  // resultado nao pode cair no mapa do periodo novo.
  const key = activeKey;
  const syncedRef = synced;
  const remoteRef = remoteById;

  try {
    const plan = computePushPlan({
      allocations: store.allocations,
      synced: syncedRef,
      canEdit: canEditCurso,
      cursoOf
    });
    if (plan.blocked.length) revertBlocked(plan.blocked);
    if (!plan.upserts.length && !plan.deletes.length) {
      setStatus('ok');
      return;
    }

    setStatus('enviando');
    const rows = plan.upserts.map(({ alloc, curso, hash }) => ({
      row: { id: alloc.id, plano: key, curso, turma: String(alloc.turmaId || ''), dados: structuredClone(alloc) },
      hash
    }));

    for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
      const chunk = rows.slice(i, i + WRITE_CHUNK);
      const { error } = await client.from('alocacoes').upsert(chunk.map((r) => r.row));
      if (error) throw error;
      chunk.forEach(({ row, hash }) => {
        syncedRef.set(row.id, { h: hash, c: row.curso });
        remoteRef.set(row.id, row.dados);
      });
    }

    for (let i = 0; i < plan.deletes.length; i += WRITE_CHUNK) {
      const ids = plan.deletes.slice(i, i + WRITE_CHUNK);
      const { error } = await client.from('alocacoes').delete().in('id', ids);
      if (error) throw error;
      ids.forEach((id) => {
        syncedRef.delete(id);
        remoteRef.delete(id);
      });
    }

    if (key === activeKey) persistSynced();
    setStatus('ok');
  } catch (error) {
    console.error('Falha ao enviar alteracoes', error);
    if (key === activeKey) persistSynced();
    setStatus('erro', describeError(error));
    scheduleRetry(schedulePush);
  } finally {
    pushing = false;
    if (pushAgain) {
      pushAgain = false;
      schedulePush();
    }
  }
}

// Alteracoes em turmas de outro curso nao vao ao servidor: volta a versao dele.
function revertBlocked(blocked) {
  const selectedCurso = store.selectedTurma ? cursoOf({ turmaId: store.selectedTurma }) : '';
  let touchesSelected = false;

  blocked.forEach(({ id, curso }) => {
    const idx = store.allocations.findIndex((a) => a?.id === id);
    const server = remoteById.get(id);
    if (server) {
      const copy = structuredClone(server);
      if (idx >= 0) store.allocations[idx] = copy;
      else store.allocations.push(copy);
    } else if (idx >= 0) {
      store.allocations.splice(idx, 1);
    }
    if (curso && curso === selectedCurso) touchesSelected = true;
  });

  store.writeAllocationsCache();
  onRemoteChange();
  if (touchesSelected && Date.now() - lastBlockedNotice > 20000) {
    lastBlockedNotice = Date.now();
    onBlocked(selectedCurso);
  }
}

// ===== Tempo real =====

function subscribe(key) {
  const handle = (payload) => handleRealtime(key, payload);
  let hadError = false;
  channel = client
    .channel(`alocacoes:${key}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'alocacoes', filter: `plano=eq.${key}` }, handle)
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'alocacoes' }, handle)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        if (hadError) activatePlan(key, { force: true });
        hadError = false;
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        if (key === activeKey) {
          hadError = true;
          setStatus('offline');
        }
      }
    });
}

async function unsubscribe() {
  if (!channel) return;
  const old = channel;
  channel = null;
  try { await client.removeChannel(old); } catch (e) { /* ignora */ }
}

let remoteRenderTimer = null;

function handleRealtime(key, payload) {
  if (key !== activeKey || !ready || store.getActivePlanMeta().key !== key) return;

  if (payload.eventType === 'DELETE') {
    const id = payload.old?.id;
    if (!id || (!synced.has(id) && !remoteById.has(id))) return;
    synced.delete(id);
    remoteById.delete(id);
    store.allocations = store.allocations.filter((a) => a?.id !== id);
  } else {
    const row = payload.new;
    const alloc = row?.dados;
    if (!alloc?.id || row.plano !== key) return;
    const entry = buildSyncedMap([alloc], cursoOf).get(alloc.id);
    if (synced.get(alloc.id)?.h === entry.h) return; // eco do proprio envio
    synced.set(alloc.id, entry);
    remoteById.set(alloc.id, alloc);
    const copy = structuredClone(alloc);
    const idx = store.allocations.findIndex((a) => a?.id === alloc.id);
    if (idx >= 0) store.allocations[idx] = copy;
    else store.allocations.push(copy);
  }

  store.writeAllocationsCache();
  persistSynced();
  clearTimeout(remoteRenderTimer);
  remoteRenderTimer = setTimeout(() => onRemoteChange(), 250);
}

// ===== Utilitarios =====

function readSynced(key) {
  const raw = readJsonStorage(localStorage, SYNCED_PREFIX + key, null);
  if (!raw || typeof raw !== 'object') return null;
  return new Map(Object.entries(raw).map(([id, [h, c]]) => [id, { h, c }]));
}

function persistSynced() {
  if (!activeKey) return;
  const obj = {};
  synced.forEach((v, id) => { obj[id] = [v.h, v.c]; });
  writeJsonStorage(localStorage, SYNCED_PREFIX + activeKey, obj);
}

function scheduleRetry(fn) {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(fn, RETRY_MS);
}

function setStatus(state, detail = '') {
  try { onStatus(state, detail); } catch (e) { /* ignora */ }
}

function describeError(error) {
  const msg = String(error?.message || error || '');
  if (/row-level security/i.test(msg)) return 'sem permissao para alterar este curso';
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'sem conexao com o servidor';
  if (/JWT|token/i.test(msg)) return 'sessao expirada, entre novamente';
  return msg || 'erro desconhecido';
}
