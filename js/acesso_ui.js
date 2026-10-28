// Tela de acesso e barra de status da sincronizacao.
// Modo local: senha unica, como antes. Modo supabase: e-mail e senha de cada
// coordenador, e as alocacoes passam a ser compartilhadas pelo servidor.
import { resolveBackendMode } from './backend_config.js';
import * as remoto from './sync_remoto.js??v=20261028a';

const LOCAL_PASSWORD = 'ufpa2026';

const STATUS_LABELS = {
  carregando: 'Carregando do servidor...',
  enviando: 'Salvando no servidor...',
  ok: 'Sincronizado',
  offline: 'Sem conexao em tempo real',
  erro: 'Erro de sincronizacao'
};

export function isOnlineMode() {
  return resolveBackendMode() === 'supabase';
}

// callbacks: { onRemoteChange, showToast }
export async function iniciarAcesso(callbacks = {}) {
  if (isOnlineMode()) {
    await iniciarOnline(callbacks);
  } else {
    await iniciarLocal();
  }
}

function el(id) {
  return document.getElementById(id);
}

function showApp() {
  el('login-screen').style.display = 'none';
  document.querySelector('.app-container').style.display = 'flex';
}

function setLoginMessage(text, isError = false) {
  const msg = el('msg-erro');
  if (!msg) return;
  msg.textContent = text;
  msg.style.color = isError ? '#c0392b' : '#555';
  msg.style.display = text ? 'block' : 'none';
}

// Resolve quando o formulario e enviado; "tentar" decide se aceita.
function aguardarLogin(tentar) {
  return new Promise((resolve) => {
    const form = el('login-form');
    form.onsubmit = async (event) => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        const result = await tentar(el('inp-email')?.value.trim() || '', el('inp-senha').value);
        if (result) {
          form.onsubmit = null;
          resolve(result);
        }
      } finally {
        button.disabled = false;
      }
    };
  });
}

async function iniciarLocal() {
  if (sessionStorage.getItem('auth') === 'true') {
    showApp();
    return;
  }
  el('inp-email').style.display = 'none';
  el('login-screen').style.display = 'flex';
  el('inp-senha').focus();
  await aguardarLogin(async (_email, senha) => {
    if (senha !== LOCAL_PASSWORD) {
      setLoginMessage('Senha incorreta!', true);
      return false;
    }
    sessionStorage.setItem('auth', 'true');
    return true;
  });
  showApp();
}

async function iniciarOnline({ onRemoteChange, showToast }) {
  el('login-screen').style.display = 'flex';
  el('inp-email').style.display = 'block';
  el('login-modo').textContent = 'Modo online: use o e-mail e a senha cadastrados para voce.';
  setLoginMessage('Conectando ao servidor...');

  try {
    await remoto.connect();
  } catch (error) {
    console.error(error);
    setLoginMessage('Nao foi possivel conectar ao servidor. Verifique a internet e recarregue a pagina.', true);
    return;
  }

  let user = await remoto.getSessionUser();
  if (!user) {
    setLoginMessage('');
    el('inp-email').focus();
    user = await aguardarLogin(async (email, senha) => {
      if (!email || !senha) {
        setLoginMessage('Informe e-mail e senha.', true);
        return null;
      }
      try {
        return await remoto.signIn(email, senha);
      } catch (error) {
        const invalid = /invalid login credentials/i.test(error?.message || '');
        setLoginMessage(invalid ? 'E-mail ou senha incorretos.' : `Falha no login: ${error?.message || error}`, true);
        return null;
      }
    });
  }

  let perfil = null;
  try {
    perfil = await remoto.loadPerfil();
  } catch (error) {
    console.error('Falha ao ler o perfil', error);
  }

  setLoginMessage('');
  showApp();
  montarBarraStatus(perfil, user);
  ajustarControlesOnline(showToast);

  if (!perfil) {
    showToast('Seu usuario ainda nao tem curso definido. Voce pode consultar, mas nao salvar. Fale com o administrador.', 'warning', 8000);
  }

  await remoto.startSync({
    onRemoteChange,
    onStatus: atualizarStatus,
    onBlocked: (curso) => showToast(
      `As turmas de ${curso} estao em modo leitura para voce. A alteracao nao foi salva no servidor.`,
      'warning',
      6000
    )
  });
}

function montarBarraStatus(perfil, user) {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar || el('sync-bar')) return;

  const bar = document.createElement('div');
  bar.id = 'sync-bar';
  bar.className = 'sync-bar';
  const nome = perfil?.nome || user?.email || '';
  const papel = perfil?.papel === 'admin' ? 'administrador' : (perfil?.curso || 'sem curso');
  bar.innerHTML = `
    <div class="sync-bar-user" title="${escapeHtml(user?.email || '')}">
      <strong>${escapeHtml(nome)}</strong> <span>(${escapeHtml(papel)})</span>
    </div>
    <div class="sync-bar-row">
      <span id="sync-bar-status" class="sync-bar-status" data-state="carregando" role="status" aria-live="polite">
        ${STATUS_LABELS.carregando}
      </span>
      <button type="button" id="btn-sync-sair" class="sync-bar-sair">Sair</button>
    </div>
  `;
  sidebar.insertBefore(bar, sidebar.firstChild);

  el('btn-sync-sair').onclick = async () => {
    await remoto.signOut();
    window.location.reload();
  };
}

function atualizarStatus(state, detail) {
  const status = el('sync-bar-status');
  if (!status) return;
  status.dataset.state = state;
  status.textContent = STATUS_LABELS[state] || state;
  status.title = detail || '';
  if (detail && state === 'erro') status.textContent += `: ${detail}`;
}

function ajustarControlesOnline(showToast) {
  // "Limpar dados" apagaria do servidor as ofertas de todo o curso.
  const btnClear = el('btn-clear');
  if (btnClear) btnClear.style.display = 'none';

  const selCurso = el('sel-curso');
  if (selCurso) {
    selCurso.addEventListener('change', () => {
      const curso = selCurso.value;
      if (curso && !remoto.canEditCurso(curso)) {
        showToast(`Curso ${curso} em modo leitura: voce pode consultar, mas as alteracoes nao serao salvas.`, 'warning', 5000);
      }
    });
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}
