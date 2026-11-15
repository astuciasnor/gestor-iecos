// Aba Ajuda: mostra um tema por vez (Começar, Alocação, Casos especiais,
// Revisão, Docentes, Publicação, Arquivos). Lembra o ultimo tema aberto neste navegador.
// Botoes .aj-ir[data-aj-ir="tema"] dentro do texto levam a outro tema.
// Com data-aj-alvo="id" (no mesmo botao ou num .aj-caso), rola ate esse cartao.

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
    // O topo da Ajuda fica parado (.aj-fixo): o tema novo comeca do inicio
    const aba = document.getElementById('tab-tutorial');
    if (aba) aba.scrollTop = 0;
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

  // Rola ate o cartao, logo abaixo do topo parado (.aj-fixo), e pisca a borda
  function irAoCartao(id) {
    const alvo = document.getElementById(id);
    const aba = document.getElementById('tab-tutorial');
    if (!alvo || !aba) return;
    const fixo = raiz.querySelector('.aj-fixo');
    const cobre = fixo ? fixo.offsetHeight - 30 : 0;   // 30px: respiro que o .aj-fixo cobre (ajuda.css)
    const topo = alvo.getBoundingClientRect().top - aba.getBoundingClientRect().top + aba.scrollTop - cobre - 20;
    aba.scrollTo({ top: Math.max(0, topo), behavior: 'smooth' });
    alvo.classList.remove('aj-pisca');
    void alvo.offsetWidth;   // reinicia a animacao se clicar de novo
    alvo.classList.add('aj-pisca');
  }

  raiz.addEventListener('click', (e) => {
    const link = e.target.closest('[data-aj-ir], [data-aj-alvo]');
    if (!link || !raiz.contains(link)) return;
    const { ajIr: tema, ajAlvo: alvo } = link.dataset;
    if (tema) abrir(tema, { foco: !alvo });
    if (alvo) irAoCartao(alvo);
  });

  abrir(lerTemaSalvo() || botoes[0].dataset.ajTema);
}
