// Aba Ajuda: mostra um tema por vez (Começar, Alocação, Revisão, Docentes,
// Publicação, Arquivos). Lembra o ultimo tema aberto neste navegador.
// Botoes .aj-ir[data-aj-ir="tema"] dentro do texto levam a outro tema.

const CHAVE_TEMA = 'cardume_ajuda_tema';

function lerTemaSalvo() {
  try { return localStorage.getItem(CHAVE_TEMA) || ''; } catch { return ''; }
}

function salvarTema(tema) {
  try { localStorage.setItem(CHAVE_TEMA, tema); } catch { /* sem armazenamento: tudo bem */ }
}

export function setupAjuda() {
  const raiz = document.querySelector('#tab-tutorial .aj');
  if (!raiz) return;
  const botoes = [...raiz.querySelectorAll('.aj-tema[data-aj-tema]')];
  const paineis = [...raiz.querySelectorAll('.aj-painel[data-aj-painel]')];
  if (!botoes.length) return;

  function abrir(tema, { foco = false } = {}) {
    const botao = botoes.find((b) => b.dataset.ajTema === tema) || botoes[0];
    const escolhido = botao.dataset.ajTema;
    botoes.forEach((b) => {
      const ativo = b === botao;
      b.classList.toggle('is-ativo', ativo);
      b.setAttribute('aria-selected', String(ativo));
      b.tabIndex = ativo ? 0 : -1;
    });
    paineis.forEach((p) => {
      const ativo = p.dataset.ajPainel === escolhido;
      p.classList.toggle('is-ativo', ativo);
      p.hidden = !ativo;
    });
    if (foco) botao.focus();
    salvarTema(escolhido);
  }

  botoes.forEach((b, i) => {
    b.addEventListener('click', () => abrir(b.dataset.ajTema));
    // Setas trocam de tema (padrao das abas acessiveis)
    b.addEventListener('keydown', (e) => {
      const passo = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!passo) return;
      e.preventDefault();
      const prox = botoes[(i + passo + botoes.length) % botoes.length];
      abrir(prox.dataset.ajTema, { foco: true });
    });
  });

  raiz.addEventListener('click', (e) => {
    const link = e.target.closest('.aj-ir[data-aj-ir]');
    if (!link) return;
    abrir(link.dataset.ajIr, { foco: true });
  });

  abrir(lerTemaSalvo() || botoes[0].dataset.ajTema);
}
