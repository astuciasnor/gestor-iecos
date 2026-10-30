// Conversa com o Supabase (modo 'supabase'). Mesma interface de remoto_ufpa.js;
// a logica da sincronizacao fica em sync_remoto.js.
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_JS_URL } from './backend_config.js';

const PAGE_SIZE = 1000;

let client = null;

// Usuario no formato comum aos dois servidores.
function toUser(user) {
  if (!user) return null;
  return { id: user.id, email: user.email || '', senhaDefinida: !!user.user_metadata?.senha_definida };
}

export async function connect() {
  if (client) return;
  const { createClient } = await import(SUPABASE_JS_URL);
  client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
}

export async function getSessionUser() {
  const { data } = await client.auth.getSession();
  return toUser(data?.session?.user);
}

export async function signIn(email, password) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return toUser(data.user);
}

// A marca de senha definida fica nos dados da propria conta de login.
export async function changePassword(password) {
  const { data, error } = await client.auth.updateUser({ password, data: { senha_definida: true } });
  if (error) throw error;
  return toUser(data.user);
}

export async function signOut() {
  await client.removeAllChannels();
  await client.auth.signOut();
}

export function watchSessionChange(startedAs, onChange) {
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

export async function loadPerfil(user) {
  const { data, error } = await client
    .from('perfis')
    .select('nome, curso, papel')
    .eq('usuario', user.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchPlan(key) {
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

// rows: [{ id, plano, curso, turma, dados }]
export async function upsert(rows) {
  const { error } = await client.from('alocacoes').upsert(rows);
  if (error) throw error;
}

export async function remove(ids) {
  const { error } = await client.from('alocacoes').delete().in('id', ids);
  if (error) throw error;
}

// Tempo real do Supabase. handlers: { onUpsert(row), onDelete(id), onState('ok' | 'offline') }.
// Devolve a funcao que encerra a escuta.
export function subscribe(key, { onUpsert, onDelete, onState }) {
  const handle = (payload) => {
    if (payload.eventType === 'DELETE') {
      if (payload.old?.id) onDelete(payload.old.id);
    } else if (payload.new) {
      onUpsert(payload.new);
    }
  };
  const channel = client
    .channel(`alocacoes:${key}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'alocacoes', filter: `plano=eq.${key}` }, handle)
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'alocacoes' }, handle)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') onState('ok');
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') onState('offline');
    });
  return async () => {
    try { await client.removeChannel(channel); } catch (e) { /* ignora */ }
  };
}
