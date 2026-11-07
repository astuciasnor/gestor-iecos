// Mini calendario das datas das faixas (Inicio/Fim), no lugar do calendario do
// navegador. Igual ao do navegador (setas, Limpar, Hoje), mais uma fileira de
// atalhos com os meses do periodo letivo — um clique troca o mes.
//
// As funcoes puras (meses e grade) sao testadas em tests/mini_calendario.test.mjs;
// abrirMiniCalendario so mexe no DOM quando chamada.

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const DIAS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

const pad = (n) => String(n).padStart(2, '0');
export const isoDe = (ano, mes, dia) => `${ano}-${pad(mes + 1)}-${pad(dia)}`;

// Soma meses a {ano, mes} (mes de 0 a 11).
export function somarMeses(ano, mes, delta) {
  const total = ano * 12 + mes + delta;
  return { ano: Math.floor(total / 12), mes: ((total % 12) + 12) % 12 };
}

// Atalhos de mes: os meses do periodo letivo (do mes do inicio ao do fim, no
// maximo 12). Sem periodo valido, o mes da ancora e os 3 seguintes.
export function atalhosDeMes(ano, mes, minimo = '', maximo = '') {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const deltas = [];
  if (iso.test(minimo) && iso.test(maximo) && minimo <= maximo) {
    const ini = { ano: Number(minimo.slice(0, 4)), mes: Number(minimo.slice(5, 7)) - 1 };
    const fim = { ano: Number(maximo.slice(0, 4)), mes: Number(maximo.slice(5, 7)) - 1 };
    const total = Math.min(11, (fim.ano * 12 + fim.mes) - (ini.ano * 12 + ini.mes));
    for (let d = 0; d <= total; d++) deltas.push(somarMeses(ini.ano, ini.mes, d));
  } else {
    for (let d = 0; d <= 3; d++) deltas.push(somarMeses(ano, mes, d));
  }
  return deltas.map((m) => ({ ...m, rotulo: MESES_CURTOS[m.mes] }));
}

// Grade de 6 semanas (42 dias), domingo primeiro, com os dias vizinhos marcados.
export function gradeDoMes(ano, mes) {
  const primeiroDow = new Date(Date.UTC(ano, mes, 1)).getUTCDay();
  const inicio = Date.UTC(ano, mes, 1 - primeiroDow);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(inicio + i * 86400000);
    return {
      iso: d.toISOString().slice(0, 10),
      dia: d.getUTCDate(),
      doMes: d.getUTCMonth() === mes,
      dow: d.getUTCDay()
    };
  });
}

export function rotuloDoMes(ano, mes) {
  return `${MESES[mes]} de ${ano}`;
}

let aberto = null;

export function fecharMiniCalendario() {
  if (!aberto) return;
  aberto.el.remove();
  document.removeEventListener('pointerdown', aberto.foraHandler, true);
  document.removeEventListener('keydown', aberto.teclaHandler, true);
  window.removeEventListener('resize', aberto.fechar);
  window.removeEventListener('scroll', aberto.rolagemHandler, true);
  const { aoFechar } = aberto;
  aberto = null;
  if (typeof aoFechar === 'function') aoFechar();
}

// opcoes: { ancoraEl, valor ('AAAA-MM-DD' ou ''), mesInicial ('AAAA-MM-DD'),
//   minimo, maximo (fora disso o dia fica apagado), feriados (Map iso -> nome),
//   aoEscolher(iso), aoLimpar(), aoFechar() }
export function abrirMiniCalendario(opcoes = {}) {
  fecharMiniCalendario();
  const { ancoraEl, valor = '', mesInicial = '', minimo = '', maximo = '', feriados = new Map() } = opcoes;
  const base = /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor
    : (/^\d{4}-\d{2}-\d{2}$/.test(mesInicial) ? mesInicial : new Date().toISOString().slice(0, 10));
  const ancora = { ano: Number(base.slice(0, 4)), mes: Number(base.slice(5, 7)) - 1 };
  let vista = { ...ancora };
  const hoje = (() => { const d = new Date(); return isoDe(d.getFullYear(), d.getMonth(), d.getDate()); })();

  const el = document.createElement('div');
  el.className = 'mini-cal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Escolher data');

  const desenhar = () => {
    el.innerHTML = '';

    const topo = document.createElement('div');
    topo.className = 'mini-cal-topo';
    const titulo = document.createElement('span');
    titulo.className = 'mini-cal-titulo';
    titulo.textContent = rotuloDoMes(vista.ano, vista.mes);
    const setas = document.createElement('span');
    setas.className = 'mini-cal-setas';
    [['↑', -1, 'Mes anterior'], ['↓', 1, 'Proximo mes']].forEach(([txt, delta, rotulo]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mini-cal-seta';
      b.textContent = txt;
      b.setAttribute('aria-label', rotulo);
      b.addEventListener('click', () => { vista = somarMeses(vista.ano, vista.mes, delta); desenhar(); });
      setas.appendChild(b);
    });
    topo.append(titulo, setas);

    const atalhos = document.createElement('div');
    atalhos.className = 'mini-cal-atalhos';
    const meses = atalhosDeMes(ancora.ano, ancora.mes, minimo, maximo);
    atalhos.style.gridTemplateColumns = `repeat(${Math.min(meses.length, 6)}, 1fr)`;
    meses.forEach((m) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mini-cal-atalho';
      if (m.ano === vista.ano && m.mes === vista.mes) b.classList.add('is-atual');
      b.textContent = m.rotulo;
      b.title = rotuloDoMes(m.ano, m.mes);
      b.addEventListener('click', () => { vista = { ano: m.ano, mes: m.mes }; desenhar(); });
      atalhos.appendChild(b);
    });

    const grade = document.createElement('div');
    grade.className = 'mini-cal-grade';
    DIAS.forEach((d) => {
      const c = document.createElement('span');
      c.className = 'mini-cal-dow';
      c.textContent = d;
      grade.appendChild(c);
    });
    gradeDoMes(vista.ano, vista.mes).forEach((cel) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mini-cal-dia';
      b.textContent = String(cel.dia);
      if (!cel.doMes) b.classList.add('is-fora');
      if (cel.dow === 0) b.classList.add('is-domingo');
      if (cel.iso === valor) b.classList.add('is-escolhido');
      if (cel.iso === hoje) b.classList.add('is-hoje');
      const feriado = feriados.get(cel.iso);
      if (feriado) { b.classList.add('is-feriado'); b.title = feriado; }
      const foraDoPeriodo = (minimo && cel.iso < minimo) || (maximo && cel.iso > maximo);
      if (foraDoPeriodo) {
        b.disabled = true;
        b.title = 'Fora do periodo letivo';
      }
      b.addEventListener('click', () => {
        const pegar = opcoes.aoEscolher;
        fecharMiniCalendario();
        if (typeof pegar === 'function') pegar(cel.iso);
      });
      grade.appendChild(b);
    });

    const rodape = document.createElement('div');
    rodape.className = 'mini-cal-rodape';
    const limpar = document.createElement('button');
    limpar.type = 'button';
    limpar.className = 'mini-cal-link';
    limpar.textContent = 'Limpar';
    limpar.addEventListener('click', () => {
      const limparFn = opcoes.aoLimpar;
      fecharMiniCalendario();
      if (typeof limparFn === 'function') limparFn();
    });
    const irHoje = document.createElement('button');
    irHoje.type = 'button';
    irHoje.className = 'mini-cal-link';
    irHoje.textContent = 'Hoje';
    irHoje.title = 'Mostrar o mes de hoje';
    irHoje.addEventListener('click', () => {
      vista = { ano: Number(hoje.slice(0, 4)), mes: Number(hoje.slice(5, 7)) - 1 };
      desenhar();
    });
    rodape.append(limpar, irHoje);

    el.append(topo, atalhos, grade, rodape);
  };

  desenhar();
  document.body.appendChild(el);

  // Abre logo abaixo da data clicada, sem sair da tela.
  const r = ancoraEl?.getBoundingClientRect?.() || { left: 20, bottom: 20, top: 20 };
  const larg = el.offsetWidth;
  const alt = el.offsetHeight;
  let left = Math.min(Math.max(8, r.left), window.innerWidth - larg - 8);
  let top = r.bottom + 4;
  if (top + alt > window.innerHeight - 8) top = Math.max(8, r.top - alt - 4);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;

  const fechar = () => fecharMiniCalendario();
  const foraHandler = (e) => {
    if (el.contains(e.target) || ancoraEl?.contains?.(e.target)) return;
    fecharMiniCalendario();
  };
  const teclaHandler = (e) => { if (e.key === 'Escape') { e.preventDefault(); fecharMiniCalendario(); } };
  const rolagemHandler = (e) => { if (!el.contains(e.target)) fecharMiniCalendario(); };
  aberto = { el, foraHandler, teclaHandler, rolagemHandler, fechar, aoFechar: opcoes.aoFechar };
  document.addEventListener('pointerdown', foraHandler, true);
  document.addEventListener('keydown', teclaHandler, true);
  window.addEventListener('resize', fechar);
  window.addEventListener('scroll', rolagemHandler, true);
  (el.querySelector('.mini-cal-dia.is-escolhido') || el.querySelector('.mini-cal-atalho.is-atual'))?.focus({ preventScroll: true });
}

// Ha um mini calendario aberto agora? (para o clique de abrir/fechar.)
export function miniCalendarioAberto() {
  return !!aberto;
}
