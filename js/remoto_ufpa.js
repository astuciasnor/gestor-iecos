// Conversa com a API PHP do servidor da UFPA (modo 'ufpa', api/index.php).
// Mesma interface de remoto_supabase.js. Sem tempo real no servidor: o
// navegador pergunta as mudancas a cada poucos segundos.
import { UFPA_API_URL } from './backend_config.js';

const POLL_MS = 5000;           // aba visivel
const POLL_HIDDEN_MS = 30000;   // aba em segundo plano
const MAX_MUDANCAS = 1000;      // igual a api/index.php
const SESSION_KEY = 'cardume_ufpa_usuario';

let perfilAtual = null;
const cursors = new Map();      // plano -> ultimo seq do historico ja aplicado
let sessionCheck = () => {};

async function chamar(acao, { params = {}, corpo } = {}) {
  const url = new URL(UFPA_API_URL, window.location.href);
  url.searchParams.set('acao', acao);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const options = { method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: {} };
  if (corpo !== undefined) {
    options.method = 'POST';
    options.headers = { 'Content-Type': 'application/json', 'X-Cardume': '1' };
    options.body = JSON.stringify(corpo);
  }
  const resp = await fetch(url, options);
  let data = null;
  try { data = await resp.json(); } catch (e) { /* resposta sem JSON */ }
  if (!resp.ok) {
    const error = new Error(data?.erro || `erro ${resp.status} no servidor`);
    error.code = data?.codigo || '';
    error.status = resp.status;
    throw error;
  }
  return data;
}

function aplicarSessao(data) {
  perfilAtual = data?.perfil || null;
  const u = data?.usuario;
  return u ? { id: u.id, email: u.email || '', senhaDefinida: !!u.senha_definida } : null;
}

// Avisa as outras abas deste navegador (evento 'storage') de que o login mudou.
function anunciarSessao(id) {
  try {
    if (id) localStorage.setItem(SESSION_KEY, id);
    else localStorage.removeItem(SESSION_KEY);
  } catch (e) { /* storage indisponivel */ }
}

export async function connect() {}

export async function getSessionUser() {
  return aplicarSessao(await chamar('sessao'));
}

export async function signIn(email, password) {
  const user = aplicarSessao(await chamar('entrar', { corpo: { email, senha: password } }));
  anunciarSessao(user.id);
  return user;
}

export async function changePassword(password) {
  return aplicarSessao(await chamar('senha', { corpo: { senha: password } }));
}

export async function signOut() {
  try { await chamar('sair', { corpo: {} }); } finally { anunciarSessao(null); }
}

export function watchSessionChange(startedAs, onChange) {
  sessionCheck = (id) => {
    if (id !== startedAs) onChange();
  };
  window.addEventListener('storage', (event) => {
    if (event.key === SESSION_KEY) sessionCheck(event.newValue || null);
  });
}

export async function loadPerfil() {
  return perfilAtual;
}

export async function fetchPlan(key) {
  const data = await chamar('plano', { params: { plano: key } });
  cursors.set(key, data.cursor);
  return (data.alocacoes || []).filter((dados) => dados?.id);
}

// rows: [{ id, plano, curso, turma, dados }]
export async function upsert(rows) {
  await chamar('salvar', { corpo: { linhas: rows } });
}

export async function remove(ids) {
  await chamar('excluir', { corpo: { ids } });
}

// Consulta periodica das mudancas. handlers: { onUpsert(row), onDelete(id), onState('ok' | 'offline') }.
// Devolve a funcao que encerra a consulta.
export function subscribe(key, { onUpsert, onDelete, onState }) {
  let active = true;
  let failed = false;
  let running = false;
  let timer = null;

  const schedule = (ms) => {
    clearTimeout(timer);
    if (active) timer = setTimeout(poll, ms);
  };

  async function poll() {
    if (running) return; // a consulta em andamento agenda a proxima ao terminar
    running = true;
    try {
      for (;;) {
        const data = await chamar('mudancas', { params: { plano: key, desde: cursors.get(key) ?? 0 } });
        if (!active) return;
        sessionCheck(data.usuario || null);
        (data.mudancas || []).forEach((m) => {
          if (m.acao === 'DELETE') onDelete(m.id);
          else if (m.dados?.id) onUpsert({ plano: key, dados: m.dados });
        });
        cursors.set(key, data.cursor);
        if ((data.mudancas || []).length < MAX_MUDANCAS) break;
      }
      if (failed) {
        failed = false;
        onState('ok');
      }
    } catch (error) {
      if (!active) return;
      if (error.status === 401) sessionCheck(null); // sessao expirou: volta ao login
      if (!failed) {
        failed = true;
        onState('offline');
      }
    } finally {
      running = false;
    }
    schedule(document.hidden ? POLL_HIDDEN_MS : POLL_MS);
  }

  const onVisible = () => {
    if (!document.hidden) schedule(0);
  };
  document.addEventListener('visibilitychange', onVisible);
  schedule(POLL_MS);

  return async () => {
    active = false;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
