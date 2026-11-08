// Conversa com a API PHP do servidor da UFPA (modo 'ufpa', api/index.php).
// Mesma interface de remoto_supabase.js. Sem tempo real no servidor: o
// navegador pergunta as mudancas a cada poucos segundos.
import { UFPA_API_URL } from './backend_config.js?v=202611080929';

const POLL_MS = 5000;           // aba visivel
const POLL_HIDDEN_MS = 30000;   // aba em segundo plano
const MAX_MUDANCAS = 1000;      // igual a api/index.php
const SESSION_KEY = 'cardume_ufpa_usuario';
// O servidor da UFPA recusa envios maiores que 128 KB (erro 413, antes de
// chegar a API). Envios maiores vao em partes de ate MAX_ENVIO bytes.
const MAX_ENVIO = 100 * 1024;

let perfilAtual = null;
const cursors = new Map();      // plano -> ultimo seq do historico ja aplicado
let sessionCheck = () => {};

// corpo: objeto enviado como JSON; bruto: bytes enviados como estao.
async function chamar(acao, { params = {}, corpo, bruto } = {}) {
  const url = new URL(UFPA_API_URL, window.location.href);
  url.searchParams.set('acao', acao);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const options = { method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: {} };
  if (corpo !== undefined) {
    options.method = 'POST';
    // JSON vai como texto: o firewall do servidor (ModSecurity) desmonta corpos
    // application/json e recusa (400) os que tem 1000 campos ou mais, o que
    // umas 20 alocacoes ja passam. A API le o corpo do mesmo jeito.
    options.headers = { 'Content-Type': 'text/plain;charset=UTF-8', 'X-Cardume': '1' };
    options.body = JSON.stringify(corpo);
  } else if (bruto !== undefined) {
    options.method = 'POST';
    options.headers = { 'Content-Type': 'application/octet-stream', 'X-Cardume': '1' };
    options.body = bruto;
  }
  const resp = await fetch(url, options);
  let data = null;
  try { data = await resp.json(); } catch (e) { /* resposta sem JSON */ }
  if (!resp.ok) {
    const fallback = resp.status === 413
      ? 'o servidor recusou um envio grande demais'
      : `erro ${resp.status} no servidor`;
    const error = new Error(data?.erro || fallback);
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
  for (const linhas of lotesPorTamanho(rows)) {
    await chamar('salvar', { corpo: { linhas } });
  }
}

// Agrupa as linhas em envios de ate MAX_ENVIO bytes (uma linha maior vai sozinha).
export function lotesPorTamanho(rows, max = MAX_ENVIO) {
  const encoder = new TextEncoder();
  const lotes = [];
  let atual = [];
  let tamanho = 0;
  for (const row of rows) {
    const bytes = encoder.encode(JSON.stringify(row)).length + 1;
    if (atual.length && tamanho + bytes > max) {
      lotes.push(atual);
      atual = [];
      tamanho = 0;
    }
    atual.push(row);
    tamanho += bytes;
  }
  if (atual.length) lotes.push(atual);
  return lotes;
}

export async function remove(ids) {
  await chamar('excluir', { corpo: { ids } });
}

// ===== Administracao: usuarios e backup (so o administrador) =====

export async function listarUsuarios() {
  return (await chamar('usuarios'))?.usuarios || [];
}

// usuario: { id?, email, nome, curso, papel }. Novo: devolve { senha_provisoria }.
export async function salvarUsuario(usuario) {
  return chamar('usuario_salvar', { corpo: usuario });
}

export async function novaSenhaUsuario(id) {
  return chamar('usuario_senha', { corpo: { id } });
}

export async function excluirUsuario(id) {
  return chamar('usuario_excluir', { corpo: { id } });
}

// Devolve { blob, nome } do arquivo .sql gerado pelo servidor.
export async function baixarBackup() {
  const url = new URL(UFPA_API_URL, window.location.href);
  url.searchParams.set('acao', 'backup');
  const resp = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  if (!resp.ok) {
    let data = null;
    try { data = await resp.json(); } catch (e) { /* resposta sem JSON */ }
    const error = new Error(data?.erro || `erro ${resp.status} no servidor`);
    error.status = resp.status;
    throw error;
  }
  const nome = /filename="([^"]+)"/.exec(resp.headers.get('Content-Disposition') || '')?.[1] || 'cardume_backup.sql';
  return { blob: await resp.blob(), nome };
}

// Agenda publica gravada no proprio servidor (so o administrador).
// Devolve { id, periodos: [{ periodo, alocacoes }] } do que ficou publicado.
export async function publicarAgenda(publications) {
  const bytes = new TextEncoder().encode(JSON.stringify({ publications }));
  if (bytes.length <= MAX_ENVIO) return chamar('publicar', { corpo: { publications } });
  // Maior que o limite do servidor: vai em pedacos e o servidor monta no fim.
  const lote = crypto.randomUUID();
  let partes = 0;
  for (let inicio = 0; inicio < bytes.length; inicio += MAX_ENVIO) {
    await chamar('publicar_parte', { params: { lote, parte: partes }, bruto: bytes.slice(inicio, inicio + MAX_ENVIO) });
    partes += 1;
  }
  return chamar('publicar', { corpo: { lote, partes } });
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
