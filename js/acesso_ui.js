import { escapeHtml } from './texto.mjs?v=202611281744';
// Tela de acesso e barra de status da sincronizacao.
// Modo local: senha unica, como antes. Modos supabase e ufpa: e-mail e senha de
// cada coordenador, e as alocacoes passam a ser compartilhadas pelo servidor.
import { resolveBackendMode } from './backend_config.js?v=202611281744';
import * as remoto from './sync_remoto.js?v=202611281744';

const LOCAL_PASSWORD = 'ufpa2026';

const STATUS_LABELS = {
  carregando: 'Carregando do servidor...',
  enviando: 'Salvando no servidor...',
  ok: 'Sincronizado',
  offline: 'Sem conexao em tempo real',
  erro: 'Erro de sincronizacao'
};

export function isOnlineMode() {
  return resolveBackendMode() !== 'local';
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
        const invalid = error?.code === 'credenciais_invalidas' || /invalid login credentials/i.test(error?.message || '');
        const limite = error?.status === 429;
        setLoginMessage(
          invalid ? 'E-mail ou senha incorretos.' : (limite ? error.message : `Falha no login: ${error?.message || error}`),
          true
        );
        return null;
      }
    });
  }

  if (!remoto.senhaDefinida()) {
    await definirSenha({ obrigatoria: true });
  }

  let perfil = null;
  try {
    perfil = await remoto.loadPerfil();
  } catch (error) {
    console.error('Falha ao ler o perfil', error);
  }

  setLoginMessage('');
  showApp();
  remoto.watchSessionChange(() => window.location.reload());
  montarBarraStatus(perfil, user, showToast);
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

  if (remoto.getAdminTools()) {
    avisarDocentesNovos(showToast);
    vigiarPublicacao(remoto.getAdminTools());
  }
}

// Administrador: uma linha "publique" na barra quando alguem mudou alocacoes
// depois da ultima publicacao da agenda. Confere ao entrar, a cada 2 minutos e
// logo depois do Publicar Online.
let vigiandoPublicacao = false;
function vigiarPublicacao(admin) {
  if (vigiandoPublicacao || typeof admin?.pendentePublicar !== 'function') return;
  vigiandoPublicacao = true;
  const conferir = async () => {
    try {
      mostrarAvisoPublicar(await admin.pendentePublicar());
    } catch (error) {
      console.warn('Nao foi possivel conferir mudancas para publicar', error);
    }
  };
  conferir();
  setInterval(conferir, 2 * 60 * 1000);
  window.addEventListener('cardume:agenda-publicada', conferir);
}

// Ultima publicacao feita por coordenador ja vista pelo administrador (por navegador).
const CHAVE_PUBLICACAO_VISTA = 'cardume:publicacao-coordenador-vista';
function lerPublicacaoVista() {
  try { return localStorage.getItem(CHAVE_PUBLICACAO_VISTA) || ''; } catch { return ''; }
}

function mostrarAvisoPublicar(resp) {
  el('sync-aviso-publicar')?.remove();
  el('sync-aviso-publicou')?.remove();
  const lista = el('sync-mensagens-lista');
  const pub = resp?.publicado_por_coordenador;
  if (lista && pub?.id && String(pub.id) !== lerPublicacaoVista()) {
    const nome = String(pub.quem || 'Um coordenador').trim().split(/\s+/)[0];
    const em = String(pub.em || '').replace(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}).*$/, '$3/$2 às $4:$5');
    lista.insertAdjacentHTML('afterbegin', `<div id="sync-aviso-publicou" class="sync-bar-aviso sync-msg" role="button" tabindex="0"
      title="Clique para esconder este aviso">● ${escapeHtml(nome)}${pub.curso ? ` (${escapeHtml(pub.curso)})` : ''} publicou a agenda dos alunos em ${escapeHtml(em)}. <u>Ok</u></div>`);
    const linha = el('sync-aviso-publicou');
    const esconder = () => {
      try { localStorage.setItem(CHAVE_PUBLICACAO_VISTA, String(pub.id)); } catch { /* sem armazenamento: some so agora */ }
      linha.remove();
      marcarBotaoMensagens();
    };
    linha.addEventListener('click', esconder);
    linha.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); esconder(); } });
  }
  if (lista && resp?.mudancas) {
    const nomes = (resp.quem || []).map((n) => String(n).trim().split(/\s+/)[0]).filter(Boolean);
    const quem = nomes.length ? `${nomes.join(', ')} ${nomes.length > 1 ? 'alteraram' : 'alterou'}` : 'Há alterações';
    lista.insertAdjacentHTML('afterbegin', `<div id="sync-aviso-publicar" class="sync-bar-aviso sync-msg"
      title="${resp.mudancas} mudança(s) nas alocações desde a última publicação da agenda">● ${escapeHtml(quem)} depois da última publicação: clique em <b>Publicar Online</b>.</div>`);
  }
  marcarBotaoMensagens();
}

// Administrador: ao entrar, avisa se ha docentes novos cadastrados pelos
// coordenadores esperando conferencia (a lista fica em "Usuarios e backup").
async function avisarDocentesNovos(showToast) {
  try {
    const { buscarDocentesParaConferir } = await import('./admin_ui.js?v=202611281744');
    // Conta a lista inteira do painel (vaga revisada tambem, ate virar nome).
    const total = (await buscarDocentesParaConferir()).length;
    marcarDocentesNovos(total);
    if (total) {
      showToast(`${total} docente(s) novo(s) para conferir: veja em Mensagens › "Ver Usuários e Backup".`, 'warning', 7000);
    }
  } catch (error) {
    console.warn('Nao foi possivel contar os docentes novos', error);
  }
}

// Linha "N docente(s) novo(s)" na caixa de Mensagens (tambem chamada pelo
// painel do administrador quando a lista muda).
function marcarDocentesNovos(total) {
  el('sync-msg-docentes')?.remove();
  const lista = el('sync-mensagens-lista');
  if (lista && total) {
    lista.insertAdjacentHTML('beforeend', `<div id="sync-msg-docentes" class="sync-bar-aviso sync-msg">● <b>${total}</b> docente(s) novo(s) para conferir em <b>Ver Usuários e Backup</b>.</div>`);
  }
  marcarBotaoMensagens();
}

// Botao Mensagens amarelo quando ha aviso na caixa.
function marcarBotaoMensagens() {
  const botao = el('btn-sync-mensagens');
  if (!botao) return;
  const total = el('sync-mensagens-lista')?.querySelectorAll('.sync-msg').length || 0;
  botao.classList.toggle('tem-mensagens', total > 0);
  botao.title = total ? `${total} aviso(s): clique para ver` : 'Sem avisos novos';
  const contador = botao.querySelector('.sync-bar-contador');
  if (contador) {
    contador.textContent = total ? String(total) : '';
    contador.hidden = !total;
  }
  botao.setAttribute('aria-label', total ? `Mensagens, ${total} aviso(s)` : 'Mensagens');
  const vazia = el('sync-mensagens')?.querySelector('.sync-mensagens-vazia');
  if (vazia) vazia.hidden = total > 0;
}

const MIN_SENHA = 8;

function descreverErroSenha(error) {
  const msg = String(error?.message || error || '');
  if (/different from the old|diferente da atual/i.test(msg)) return 'A nova senha precisa ser diferente da atual.';
  if (/weak|at least|characters/i.test(msg)) return 'Senha fraca: use mais caracteres, misturando letras e numeros.';
  if (/reauthenticat|recent/i.test(msg)) return 'Por seguranca, saia, entre de novo e troque a senha em seguida.';
  return `Nao foi possivel trocar a senha: ${msg || 'erro desconhecido'}`;
}

// Usa a caixa da tela de login. Obrigatoria no primeiro acesso (sem Cancelar).
// Resolve true se a senha foi trocada.
function definirSenha({ obrigatoria }) {
  const tela = el('login-screen');
  const titulo = el('login-titulo');
  const loginForm = el('login-form');
  const modo = el('login-modo');
  const form = el('senha-form');
  const cancelar = el('btn-senha-cancelar');
  const tituloAntes = titulo.textContent;

  titulo.textContent = obrigatoria ? 'Crie sua senha' : 'Trocar senha';
  el('senha-instrucao').textContent = obrigatoria
    ? 'Primeiro acesso: troque a senha inicial por uma senha so sua.'
    : 'Escolha a nova senha.';
  loginForm.style.display = 'none';
  modo.style.display = 'none';
  form.style.display = 'block';
  cancelar.style.display = obrigatoria ? 'none' : 'block';
  el('inp-senha-usuario').value = remoto.getSessionEmail();
  el('inp-senha-nova').value = '';
  el('inp-senha-conf').value = '';
  setLoginMessage('');
  tela.style.display = 'flex';
  el('inp-senha-nova').focus();

  return new Promise((resolve) => {
    const fechar = (trocou) => {
      form.onsubmit = null;
      cancelar.onclick = null;
      form.style.display = 'none';
      loginForm.style.display = '';
      modo.style.display = '';
      titulo.textContent = tituloAntes;
      setLoginMessage('');
      tela.style.display = 'none';
      resolve(trocou);
    };
    cancelar.onclick = () => fechar(false);
    form.onsubmit = async (event) => {
      event.preventDefault();
      const nova = el('inp-senha-nova').value;
      if (nova.length < MIN_SENHA) {
        setLoginMessage(`A senha precisa ter pelo menos ${MIN_SENHA} caracteres.`, true);
        return;
      }
      if (nova !== el('inp-senha-conf').value) {
        setLoginMessage('As duas senhas nao conferem.', true);
        return;
      }
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        await remoto.changePassword(nova);
        fechar(true);
      } catch (error) {
        setLoginMessage(descreverErroSenha(error), true);
      } finally {
        button.disabled = false;
      }
    };
  });
}

function montarBarraStatus(perfil, user, showToast) {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar || el('sync-bar')) return;

  const admin = remoto.getAdminTools();
  const bar = document.createElement('div');
  bar.id = 'sync-bar';
  bar.className = 'sync-bar';
  const nome = perfil?.nome || user?.email || '';
  // Faixa de uma linha: bolinha do estado + perfil + Senha, Sair (e Mensagens).
  // O nome (e curso, e-mail) e o estado ficam na dica do perfil (mouse ou Tab).
  const papel = perfil?.papel === 'admin' ? 'Administrador' : 'Coordenador';
  const quem = [nome, perfil?.papel !== 'admin' ? perfil?.curso : '', user?.email && user.email !== nome ? user.email : '']
    .filter(Boolean).join(' – ');
  bar.innerHTML = `
    <span id="sync-bar-status" class="sync-bar-status" data-state="carregando" role="status" aria-live="polite"
      title="${STATUS_LABELS.carregando}"><span class="sr-only">${STATUS_LABELS.carregando}</span></span>
    <span class="sync-bar-user" tabindex="0" aria-describedby="sync-bar-dica">
      <strong>${papel}</strong>
      <span id="sync-bar-dica" class="sync-bar-dica" role="tooltip">
        <span class="sync-bar-dica-nome">${escapeHtml(quem)}</span>
        <span id="sync-bar-dica-estado" class="sync-bar-dica-estado">${STATUS_LABELS.carregando}</span>
      </span>
    </span>
    <span class="sync-bar-acoes">
      <button type="button" id="btn-sync-senha" class="sync-bar-sair" title="Trocar senha" aria-label="Trocar senha">Senha</button>
      <button type="button" id="btn-sync-sair" class="sync-bar-sair">Sair</button>
      ${admin ? '<button type="button" id="btn-sync-mensagens" class="sync-bar-sair sync-bar-mensagens" aria-expanded="false" aria-controls="sync-mensagens">Mensagens<span class="sync-bar-contador" hidden></span></button>' : ''}
    </span>
    ${admin ? `<div id="sync-mensagens" class="sync-mensagens" hidden>
      <div id="sync-mensagens-lista" class="sync-mensagens-lista"></div>
      <p class="sync-mensagens-vazia">Nenhuma mensagem nova.</p>
      <button type="button" id="btn-sync-admin" class="sync-bar-admin">Ver Usuários e Backup</button>
    </div>` : ''}
  `;
  sidebar.insertBefore(bar, sidebar.firstChild);

  if (admin) {
    // Administrador: avisos (publicar, docentes novos) e "Usuarios e backup"
    // ficam numa caixa que abre no botao Mensagens (amarelo quando ha aviso).
    el('btn-sync-mensagens').onclick = () => {
      const caixa = el('sync-mensagens');
      caixa.hidden = !caixa.hidden;
      el('btn-sync-mensagens').setAttribute('aria-expanded', String(!caixa.hidden));
    };
    el('btn-sync-admin').onclick = async () => {
      const { abrirAdministracao } = await import('./admin_ui.js?v=202611281744');
      abrirAdministracao({ tools: admin, meuId: user?.id || '', showToast, aoContarDocentes: marcarDocentesNovos });
    };
  }

  el('btn-sync-senha').onclick = async () => {
    if (await definirSenha({ obrigatoria: false })) showToast('Senha alterada.', 'success', 3000);
  };

  el('btn-sync-sair').onclick = async () => {
    await remoto.signOut();
    window.location.reload();
  };
}

function atualizarStatus(state, detail) {
  const status = el('sync-bar-status');
  if (!status) return;
  // A faixa mostra so a bolinha (cor pelo data-state); o texto fica para leitor
  // de tela, na dica da bolinha e na dica do perfil.
  const rotulo = STATUS_LABELS[state] || state;
  const texto = detail ? `${rotulo}: ${detail}` : rotulo;
  status.dataset.state = state;
  status.title = texto;
  const leitor = status.querySelector('.sr-only');
  if (leitor) leitor.textContent = state === 'erro' ? texto : rotulo;
  else status.textContent = texto;
  const naDica = el('sync-bar-dica-estado');
  if (naDica) naDica.textContent = texto;
}

function ajustarControlesOnline(showToast) {
  // "Limpar dados" apagaria do servidor as ofertas de todo o curso.
  const btnClear = el('btn-clear');
  if (btnClear) btnClear.style.display = 'none';

  const selCurso = el('sel-curso');
  if (selCurso) {
    const avisarSeLeitura = () => {
      const curso = selCurso.value;
      if (curso && !remoto.canEditCurso(curso)) {
        showToast(`Curso ${curso} em modo leitura: voce pode consultar, mas nao alterar.`, 'warning', 5000);
      }
    };
    selCurso.addEventListener('change', avisarSeLeitura);
    avisarSeLeitura(); // a pagina pode ja abrir num curso de outra coordenacao
  }
}

