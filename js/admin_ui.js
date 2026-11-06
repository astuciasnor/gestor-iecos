// Janela "Usuarios e backup" do administrador (so no servidor da UFPA).
// Cadastra, edita e exclui acessos, gera senha provisoria e baixa a copia do
// banco. Quem garante que so o administrador faz isso e a API (api/index.php).
import { store } from './store.js?v=202611061814';

let ctx = null;      // { tools, meuId, showToast }
let usuarios = [];

export function abrirAdministracao(opcoes) {
  ctx = opcoes;
  montarJanela();
  document.getElementById('admin-modal').classList.add('is-open');
  esconderFormulario();
  esconderSenha();
  carregar();
}

function fechar() {
  document.getElementById('admin-modal')?.classList.remove('is-open');
}

function el(id) {
  return document.getElementById(id);
}

function montarJanela() {
  if (el('admin-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'admin-modal';
  modal.className = 'admin-modal';
  modal.innerHTML = `
    <div class="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-titulo">
      <div class="admin-topo">
        <h3 id="admin-titulo">Usuários e backup</h3>
        <button type="button" class="admin-fechar" id="admin-fechar" aria-label="Fechar">✖</button>
      </div>
      <div class="admin-acoes">
        <button type="button" class="admin-btn admin-btn-primario" id="admin-novo">+ Novo usuário</button>
        <button type="button" class="admin-btn" id="admin-backup">⬇ Baixar backup</button>
      </div>

      <div class="admin-senha" id="admin-senha" hidden>
        <div id="admin-senha-texto"></div>
        <div class="admin-senha-linha">
          <code id="admin-senha-valor"></code>
          <button type="button" class="admin-btn" id="admin-senha-copiar">Copiar</button>
          <button type="button" class="admin-btn" id="admin-senha-ok">Pronto</button>
        </div>
        <label class="admin-msg-rotulo" for="admin-senha-msg">Mensagem pronta para enviar (pode ajustar o texto antes de copiar):</label>
        <textarea id="admin-senha-msg" class="admin-senha-msg" rows="14" spellcheck="false"></textarea>
        <div class="admin-senha-linha">
          <button type="button" class="admin-btn admin-btn-primario" id="admin-msg-copiar">Copiar mensagem</button>
        </div>
        <div class="admin-ajuda">Envie à pessoa por mensagem individual (e-mail ou WhatsApp privado, nunca em grupo).
          No primeiro acesso ela cria a própria senha. Esta senha não será mostrada de novo.</div>
      </div>

      <form class="admin-form" id="admin-form" hidden>
        <h4 id="admin-form-titulo">Novo usuário</h4>
        <div class="admin-form-grade">
          <label>Nome<input type="text" id="admin-f-nome" maxlength="120" required></label>
          <label>E-mail<input type="email" id="admin-f-email" maxlength="255" required></label>
          <label>Curso<select id="admin-f-curso"></select></label>
          <label>Papel<select id="admin-f-papel">
            <option value="coordenador">Coordenador (edita o seu curso)</option>
            <option value="admin">Administrador (edita tudo e publica)</option>
          </select></label>
        </div>
        <div class="admin-form-botoes">
          <button type="submit" class="admin-btn admin-btn-primario" id="admin-f-salvar">Salvar</button>
          <button type="button" class="admin-btn" id="admin-f-cancelar">Cancelar</button>
        </div>
      </form>

      <div class="admin-lista" id="admin-lista">Carregando...</div>
      <div class="admin-ajuda">Backup: guarde o arquivo em <strong>G:\\Meu Drive\\Cardume - Administração\\backups</strong>.
        Para restaurar: phpMyAdmin → cardume_iecos → Importar.</div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.addEventListener('click', (e) => { if (e.target === modal) fechar(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('is-open')) fechar();
  });
  el('admin-fechar').onclick = fechar;
  el('admin-novo').onclick = () => mostrarFormulario(null);
  el('admin-backup').onclick = baixarBackup;
  el('admin-f-cancelar').onclick = esconderFormulario;
  el('admin-form').onsubmit = salvar;
  el('admin-senha-ok').onclick = esconderSenha;
  el('admin-senha-copiar').onclick = (e) => copiar(el('admin-senha-valor').textContent, e.currentTarget);
  el('admin-msg-copiar').onclick = (e) => copiar(el('admin-senha-msg').value, e.currentTarget);
  el('admin-lista').addEventListener('click', aoClicarNaLista);
}

async function carregar() {
  el('admin-lista').textContent = 'Carregando...';
  try {
    usuarios = await ctx.tools.listarUsuarios();
    desenharLista();
  } catch (error) {
    el('admin-lista').textContent = `Não foi possível carregar os usuários: ${error?.message || error}`;
  }
}

function desenharLista() {
  const linhas = usuarios.map((u) => {
    const souEu = u.id === ctx.meuId;
    const situacao = u.senha_definida ? 'Ativo' : 'Aguardando 1º acesso';
    return `
      <tr>
        <td>${esc(u.nome)}${souEu ? ' <span class="admin-eu">(você)</span>' : ''}</td>
        <td>${esc(u.email)}</td>
        <td>${esc(u.curso || '—')}</td>
        <td>${u.papel === 'admin' ? 'Administrador' : 'Coordenador'}</td>
        <td class="${u.senha_definida ? '' : 'admin-pendente'}">${situacao}</td>
        <td>${formatarData(u.ultimo_acesso)}</td>
        <td class="admin-botoes-linha">
          <button type="button" class="admin-btn admin-btn-mini" data-acao="editar" data-id="${esc(u.id)}">Editar</button>
          ${souEu ? '' : `<button type="button" class="admin-btn admin-btn-mini" data-acao="senha" data-id="${esc(u.id)}">Nova senha</button>
          <button type="button" class="admin-btn admin-btn-mini admin-btn-perigo" data-acao="excluir" data-id="${esc(u.id)}">Excluir</button>`}
        </td>
      </tr>`;
  }).join('');
  el('admin-lista').innerHTML = `
    <table class="admin-tabela">
      <thead><tr><th>Nome</th><th>E-mail</th><th>Curso</th><th>Papel</th><th>Situação</th><th>Último acesso</th><th></th></tr></thead>
      <tbody>${linhas || '<tr><td colspan="7">Nenhum usuário.</td></tr>'}</tbody>
    </table>`;
}

async function aoClicarNaLista(event) {
  const botao = event.target.closest('button[data-acao]');
  if (!botao) return;
  const u = usuarios.find((x) => x.id === botao.dataset.id);
  if (!u) return;
  if (botao.dataset.acao === 'editar') {
    mostrarFormulario(u);
  } else if (botao.dataset.acao === 'senha') {
    if (!confirm(`Gerar uma senha provisória nova para ${u.nome}?\n\nA senha atual deixa de valer e a pessoa é desconectada.`)) return;
    await executar(botao, async () => {
      const r = await ctx.tools.novaSenhaUsuario(u.id);
      mostrarSenha(`Senha provisória de <strong>${esc(u.nome)}</strong> (${esc(u.email)}):`, r.senha_provisoria,
        montarMensagem({ ...u, senha: r.senha_provisoria, novo: false }));
      await carregar();
    });
  } else if (botao.dataset.acao === 'excluir') {
    if (!confirm(`Excluir o acesso de ${u.nome} (${u.email})?\n\nAs alocações feitas por essa pessoa continuam no Cardume.`)) return;
    await executar(botao, async () => {
      await ctx.tools.excluirUsuario(u.id);
      ctx.showToast(`Acesso de ${esc(u.nome)} excluído.`, 'success', 3000);
      await carregar();
    });
  }
}

function cursosDisponiveis(atual) {
  const siglas = (store.rawData?.cursos || []).map((c) => String(c.sigla || '').toUpperCase()).filter(Boolean);
  if (atual && !siglas.includes(atual)) siglas.push(atual);
  return siglas;
}

function mostrarFormulario(u) {
  esconderSenha();
  const form = el('admin-form');
  form.dataset.id = u?.id || '';
  el('admin-form-titulo').textContent = u ? `Editar: ${u.nome}` : 'Novo usuário';
  el('admin-f-nome').value = u?.nome || '';
  el('admin-f-email').value = u?.email || '';
  el('admin-f-curso').innerHTML = '<option value="">(nenhum)</option>' + cursosDisponiveis(u?.curso || '')
    .map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  el('admin-f-curso').value = u?.curso || '';
  el('admin-f-papel').value = u?.papel || 'coordenador';
  el('admin-f-papel').disabled = !!u && u.id === ctx.meuId; // ninguem tira o proprio papel de administrador
  form.hidden = false;
  el('admin-f-nome').focus();
}

function esconderFormulario() {
  const form = el('admin-form');
  if (form) form.hidden = true;
}

async function salvar(event) {
  event.preventDefault();
  const form = el('admin-form');
  const id = form.dataset.id || undefined;
  const dados = {
    id,
    nome: el('admin-f-nome').value.trim(),
    email: el('admin-f-email').value.trim(),
    curso: el('admin-f-curso').value,
    papel: el('admin-f-papel').value
  };
  await executar(el('admin-f-salvar'), async () => {
    const r = await ctx.tools.salvarUsuario(dados);
    esconderFormulario();
    if (r.senha_provisoria) {
      mostrarSenha(`Usuário <strong>${esc(dados.nome)}</strong> criado. Senha provisória para ${esc(dados.email)}:`, r.senha_provisoria,
        montarMensagem({ ...dados, senha: r.senha_provisoria, novo: true }));
    } else {
      ctx.showToast('Usuário atualizado.', 'success', 3000);
    }
    await carregar();
  });
}

function mostrarSenha(textoHtml, senha, mensagem) {
  el('admin-senha-texto').innerHTML = textoHtml;
  el('admin-senha-valor').textContent = senha;
  el('admin-senha-msg').value = mensagem;
  el('admin-senha').hidden = false;
}

function esconderSenha() {
  const caixa = el('admin-senha');
  if (!caixa) return;
  caixa.hidden = true;
  el('admin-senha-valor').textContent = '';
  el('admin-senha-msg').value = '';
}

// A confirmacao aparece no proprio botao: o aviso geral do app fica atras desta janela.
async function copiar(texto, botao) {
  let ok = false;
  try {
    await navigator.clipboard.writeText(texto);
    ok = true;
  } catch (e) {
    ok = copiarPorSelecao(texto); // navegador recusou a area de transferencia: plano B
  }
  if (!botao.dataset.rotulo) botao.dataset.rotulo = botao.textContent;
  botao.textContent = ok ? 'Copiado ✓' : 'Selecione e use Ctrl+C';
  clearTimeout(botao._timer);
  botao._timer = setTimeout(() => { botao.textContent = botao.dataset.rotulo; }, ok ? 2500 : 5000);
}

function copiarPorSelecao(texto) {
  const area = document.createElement('textarea');
  area.value = texto;
  area.setAttribute('readonly', '');
  area.className = 'admin-copia-oculta';
  el('admin-modal').appendChild(area);
  area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  area.remove();
  return ok;
}

// Mensagem para a pessoa: endereco, usuario, senha provisoria e dicas basicas.
// { nome, email, curso, papel, senha, novo }
function montarMensagem({ nome, email, curso, papel, senha, novo }) {
  const primeiroNome = String(nome || '').trim().split(/\s+/)[0] || '';
  const endereco = new URL('.', window.location.href).href;
  const nomeCurso = (store.rawData?.cursos || []).find((c) => String(c.sigla || '').toUpperCase() === curso)?.curso || curso;
  const eu = usuarios.find((x) => x.id === ctx.meuId);
  const permissao = papel === 'admin'
    ? 'Você é administrador: pode editar todos os cursos e publicar a agenda dos alunos.'
    : `Você edita as turmas de ${nomeCurso || 'seu curso'}; os outros cursos aparecem só para consulta.`;
  const abertura = novo
    ? 'Seu acesso ao Cardume (Planejador Acadêmico do IECOS) está pronto.'
    : 'Gerei uma senha provisória nova para o seu acesso ao Cardume (Planejador Acadêmico do IECOS). A senha anterior não vale mais.';
  return [
    `Olá, ${primeiroNome}!`,
    '',
    abertura,
    '',
    `Endereço: ${endereco}`,
    `Usuário: ${email}`,
    `Senha provisória: ${senha}`,
    '',
    novo ? 'No primeiro acesso:' : 'No próximo acesso:',
    '1. Entre com o seu e-mail e a senha provisória acima.',
    '2. O Cardume pede uma senha nova, só sua (mínimo de 8 caracteres).',
    novo ? '3. Salve o endereço nos favoritos do navegador.' : '3. Se o Cardume estiver aberto em outro computador, entre de novo lá também.',
    '',
    'Dicas:',
    `- ${permissao}`,
    '- Tudo é salvo sozinho no servidor da UFPA e aparece para os outros coordenadores em poucos segundos. Não é preciso exportar nem enviar arquivos.',
    '- Use sempre o endereço acima. O endereço antigo (GitHub) não grava mais alterações.',
    '- Para trocar a senha depois, use o botão "Senha", no menu à esquerda.',
    '- Se esquecer a senha, me avise que eu gero uma nova.',
    '- Não compartilhe a sua senha com ninguém.',
    '',
    eu?.nome ? `${eu.nome} (administrador do Cardume)` : 'Administrador do Cardume'
  ].join('\n');
}

async function baixarBackup() {
  await executar(el('admin-backup'), async () => {
    const { blob, nome } = await ctx.tools.baixarBackup();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    ctx.showToast(`Backup "${esc(nome)}" baixado na pasta Downloads.`, 'success', 5000);
  });
}

// Desabilita o botao durante a chamada e mostra o erro da API, se houver.
async function executar(botao, fn) {
  if (botao) botao.disabled = true;
  try {
    await fn();
  } catch (error) {
    ctx.showToast(esc(error?.message || String(error)), 'error', 6000);
  } finally {
    if (botao) botao.disabled = false;
  }
}

function formatarData(valor) {
  if (!valor) return 'nunca';
  const [data, hora = ''] = String(valor).split(' ');
  const [a, m, d] = data.split('-');
  return `${d}/${m}/${a} ${hora.slice(0, 5)}`.trim();
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}
