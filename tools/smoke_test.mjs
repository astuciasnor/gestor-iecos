// Teste de fumaca: abre o app num Chrome/Edge invisivel, com os dados publicados
// (alocacoes_publicas.json), passa pelas telas principais e avisa se algo quebrou.
// Pega o que os testes de unidade nao pegam: tela em branco, erro no console,
// modulo carregado em dobro, etc.
//
// Uso (na raiz do projeto):   npm run smoke
// Navegador: acha Chrome ou Edge sozinho; para outro, defina CHROME_PATH.
// Nada e gravado no projeto; o perfil do navegador e temporario.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, scanReferences, findProblems } from './bump_version.mjs';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- servidor local
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp'
};

export function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (urlPath === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ---------------------------------------------------------------- navegador
export function findBrowser() {
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(local, 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
  ];
  return candidates.find((p) => p && fs.existsSync(p));
}

export async function openBrowser(browserPath, profileDir) {
  const proc = spawn(browserPath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, 'about:blank'
  ], { stdio: 'ignore' });
  // Com a porta 0 o navegador escolhe uma livre e a escreve neste arquivo.
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  let page;
  for (let i = 0; i < 150 && !page; i++) {
    await sleep(200);
    try {
      const port = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      page = targets.find((t) => t.type === 'page');
    } catch { /* ainda subindo */ }
  }
  if (!page) { proc.kill(); throw new Error('o navegador nao respondeu'); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
  return { proc, ws };
}

export function cdp(ws, errors) {
  let seq = 0;
  const pending = new Map();
  const send = (method, params = {}) => {
    const id = ++seq;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve) => pending.set(id, resolve));
  };
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    const p = msg.params || {};
    if (msg.method === 'Runtime.exceptionThrown') {
      const e = p.exceptionDetails;
      errors.push(`excecao: ${e.exception?.description || e.text} (${e.url || ''}:${e.lineNumber})`);
    } else if (msg.method === 'Runtime.consoleAPICalled' && p.type === 'error') {
      errors.push(`console.error: ${p.args.map((a) => a.value ?? a.description).join(' ')}`);
    } else if (msg.method === 'Log.entryAdded' && p.entry.level === 'error') {
      errors.push(`navegador: ${p.entry.text} ${p.entry.url || ''}`);
    } else if (msg.method === 'Page.javascriptDialogOpening') {
      send('Page.handleJavaScriptDialog', { accept: true });
    }
  });
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.exception?.description || 'erro ao avaliar');
    return res.result?.result?.value;
  };
  const waitFor = async (expression, timeoutMs = 10000) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      try { if (await evaluate(expression)) return true; } catch { /* pagina ainda carregando */ }
      await sleep(200);
    }
    return false;
  };
  return { send, evaluate, waitFor };
}

// ---------------------------------------------------------------- dados
export function loadPublishedData() {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'alocacoes_publicas.json'), 'utf8'));
  const pubs = (data.publications || []).filter((p) => p?.plan?.key && Array.isArray(p.allocations));
  if (!pubs.length) throw new Error('alocacoes_publicas.json sem publicacoes');
  const main = [...pubs].sort((a, b) => b.allocations.length - a.allocations.length)[0];
  // Professor com mais ofertas no plano (nome individual, nao "A definir" nem combinado).
  const count = {};
  main.allocations.forEach((a) => {
    const nome = String(a.docente || '').trim();
    if (nome && !/^a definir$/i.test(nome) && !/\s\/\s|\(m[uú]ltiplos\)/i.test(nome)) count[nome] = (count[nome] || 0) + 1;
  });
  const teacher = Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0];
  return { pubs, main, teacher };
}

export function seedScript({ pubs, main }) {
  const settings = { periodo: main.plan.periodo, termStart: main.plan.termStart, termEnd: main.plan.termEnd };
  const plans = pubs.map((p) => `localStorage.setItem(${JSON.stringify(`academic_plan_v1::${p.plan.key}`)}, ${JSON.stringify(JSON.stringify(p.allocations))});`).join('\n');
  return `sessionStorage.setItem('auth', 'true');
if (!localStorage.getItem('smoke_seeded')) {
  localStorage.setItem('smoke_seeded', '1');
  localStorage.setItem('academic_settings', ${JSON.stringify(JSON.stringify(settings))});
  ${plans}
}`;
}

// ---------------------------------------------------------------- roteiro
async function run() {
  const results = [];
  const errors = [];
  const check = async (name, fn) => {
    const before = errors.length;
    let detail = '';
    let ok;
    try { detail = (await fn()) ?? ''; ok = true; } catch (err) { ok = false; detail = err.message; }
    const novos = errors.slice(before);
    if (ok && novos.length) { ok = false; detail = novos.join(' | '); }
    results.push({ name, ok });
    console.log(`${ok ? 'OK   ' : 'FALHA'} ${name}${detail ? ` - ${String(detail).slice(0, 400)}` : ''}`);
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

  await check('versoes dos arquivos (?v=)', () => {
    const problems = findProblems(scanReferences());
    assert(!problems.length, `${problems.join('; ')} (rode: node tools/bump_version.mjs)`);
  });

  const browserPath = findBrowser();
  if (!browserPath) {
    console.log('FALHA navegador nao encontrado: instale o Chrome/Edge ou defina CHROME_PATH');
    return false;
  }
  const data = loadPublishedData();
  const server = await startServer();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardume-smoke-'));
  const { proc, ws } = await openBrowser(browserPath, profileDir);
  const { send, evaluate, waitFor } = cdp(ws, errors);

  try {
    await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: seedScript(data) });
    console.log(`Plano ${data.main.plan.label || data.main.plan.key} (${data.main.allocations.length} ofertas); professor: ${data.teacher}`);
    await send('Page.navigate', { url: `${baseUrl}/index.html?backend=local` });

    await check('app abre', async () => {
      assert(await waitFor("document.querySelectorAll('#sel-curso option').length > 0", 15000), 'seletor de curso vazio');
      // Espera a lista de periodos de verdade (a fonte do Google pode atrasar a abertura).
      assert(await waitFor("document.querySelectorAll('#sel-periodo-letivo option').length > 1", 40000), 'periodos nao carregaram');
      await sleep(1000);
    });

    await check('todas as abas abrem', async () => {
      const abas = await evaluate(`(async () => {
        const out = [];
        for (const b of document.querySelectorAll('.tab-btn[data-tab]')) {
          b.click(); await new Promise(r => setTimeout(r, 400));
          const painel = document.getElementById(b.getAttribute('aria-controls'));
          if (!painel || !painel.classList.contains('active')) out.push(b.textContent.trim());
        }
        return out;
      })()`);
      assert(!abas.length, `nao abriram: ${abas.join(', ')}`);
    });

    await check('Lista de Ofertas e Trocar', async () => {
      await evaluate("document.querySelector('.tab-btn[data-tab=\"list\"]').click()");
      // A lista so mostra ofertas depois de escolher curso e turma: procura a primeira que tenha.
      const turma = await evaluate(`(async () => {
        const wait = (ms) => new Promise(r => setTimeout(r, ms));
        const pick = async (sel, value) => { sel.value = value; sel.dispatchEvent(new Event('change', { bubbles: true })); await wait(500); };
        const temLinhas = () => document.querySelectorAll('#ofertas-table .btn-swap-row').length > 0;
        const curso = document.getElementById('sel-curso'), turma = document.getElementById('sel-turma');
        for (const c of [...curso.options].filter(o => o.value)) {
          await pick(curso, c.value);
          for (const t of [...turma.options].filter(o => o.value)) {
            await pick(turma, t.value);
            if (temLinhas()) return c.textContent.trim() + ' / ' + t.textContent.trim();
          }
        }
        return '';
      })()`);
      assert(turma, 'nenhuma turma com ofertas e botao Trocar');
      await evaluate("document.querySelector('#ofertas-table .btn-swap-row').click()");
      assert(await waitFor("!!document.getElementById('troca-ordem-modal')", 3000), 'janela do Trocar nao abriu');
      const opcoes = await evaluate("document.querySelectorAll('#troca-ordem-modal .troca-opcao').length");
      await evaluate("document.querySelector('#troca-ordem-modal .troca-cancelar').click()");
      assert(await waitFor("!document.getElementById('troca-ordem-modal')", 3000), 'Cancelar nao fechou a janela');
      return `${turma}: ${opcoes} opcao(oes) na janela`;
    });

    await check('busca de docentes so com nomes individuais', async () => {
      await evaluate("document.querySelector('.tab-btn[data-tab=\"teacher\"]').click()");
      assert(await waitFor("document.querySelectorAll('#list-view-docentes option').length > 0"), 'lista de docentes vazia');
      const ruins = await evaluate("[...document.querySelectorAll('#list-view-docentes option')].map(o => o.value).filter(v => /\\s\\/\\s|\\(m[uú]ltiplos\\)|^a definir$/i.test(v))");
      assert(!ruins.length, `nomes combinados: ${ruins.join('; ')}`);
    });

    // Nome fora da lista: aviso ao sair do campo, janela de cadastro com conferencia.
    // Nada e salvo (so cadastra na memoria da pagina e limpa o campo no fim).
    await check('docente novo: aviso e janela de cadastro', async () => {
      await evaluate(`(() => {
        document.querySelector('.tab-btn[data-tab="weekly"]').click();
        const chk = document.getElementById('chk-multi-docente');
        if (chk.checked) { chk.checked = false; chk.dispatchEvent(new Event('change')); }
        const i = document.getElementById('inp-docente');
        i.value = 'Fulano Smoke de Teste';
        i.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      assert(await evaluate("!document.getElementById('aviso-docente-novo') || document.getElementById('aviso-docente-novo').classList.contains('hidden')"), 'aviso apareceu durante a digitacao');
      await evaluate("document.getElementById('inp-docente').dispatchEvent(new Event('change', { bubbles: true }))");
      assert(await waitFor("!!document.querySelector('#aviso-docente-novo:not(.hidden) .btn-cadastrar-docente')", 3000), 'aviso sem o botao Cadastrar');
      await evaluate("document.querySelector('.btn-cadastrar-docente').click()");
      assert(await waitFor("!!document.getElementById('cadastro-docente-modal')", 3000), 'janela de cadastro nao abriu');
      assert(await evaluate("document.querySelector('#cadastro-docente-modal .cad-ok').disabled"), 'Cadastrar liberado sem preencher');
      await evaluate(`(() => {
        const m = document.getElementById('cadastro-docente-modal');
        const fire = (el) => el.dispatchEvent(new Event('change', { bubbles: true }));
        const radio = m.querySelector('input[name="cad-vinculo"][value="Substituto"]'); radio.checked = true; fire(radio);
        const u = m.querySelector('#cad-unidade'); u.value = 'IECOS'; fire(u);
        const s = m.querySelector('#cad-subunidade'); s.value = 'FEPESCA'; fire(s);
        const n = m.querySelector('#cad-nome'); n.value = 'Fulano Smoke de Teste'; n.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      assert(await evaluate("document.querySelector('#cadastro-docente-modal .cad-ok').disabled"), 'Cadastrar liberado sem a caixa Conferi');
      await evaluate(`(() => {
        const c = document.querySelector('#cad-conferi'); c.checked = true;
        c.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      assert(!(await evaluate("document.querySelector('#cadastro-docente-modal .cad-ok').disabled")), 'Cadastrar nao liberou com tudo preenchido');
      await evaluate("document.querySelector('#cadastro-docente-modal .cad-ok').click()");
      assert(await waitFor("!document.getElementById('cadastro-docente-modal') && document.querySelector('#aviso-docente-novo .is-ok')", 3000), 'cadastro nao marcou o nome como cadastrado');
      await evaluate(`(() => {
        const i = document.getElementById('inp-docente');
        i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      assert(await evaluate("document.getElementById('aviso-docente-novo').classList.contains('hidden')"), 'aviso nao sumiu ao limpar o campo');

      // Vaga: nome improvisado leva ao "Cadastrar Vaga…", que gera "VagaN FACIN".
      await evaluate(`(() => {
        const i = document.getElementById('inp-docente');
        i.value = 'n.n. (substituto)';
        i.dispatchEvent(new Event('input', { bubbles: true }));
        i.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      assert(await waitFor("!!document.querySelector('#aviso-docente-novo .btn-cadastrar-docente[data-vaga=\"1\"]')", 3000), 'nome improvisado sem o botao Cadastrar Vaga');
      await evaluate("document.querySelector('.btn-cadastrar-docente[data-vaga=\"1\"]').click()");
      assert(await waitFor("!!document.querySelector('#cadastro-docente-modal input[name=\"cad-tipo\"][value=\"vaga\"]:checked')", 3000), 'janela nao abriu em Vaga');
      assert(await evaluate("document.querySelector('#cad-conferi').closest('.cad-conferi').classList.contains('hidden')"), 'caixa Conferi SIGAA aparece na vaga');
      await evaluate(`(() => {
        const m = document.getElementById('cadastro-docente-modal');
        const fire = (el) => el.dispatchEvent(new Event('change', { bubbles: true }));
        const radio = m.querySelector('input[name="cad-vinculo"][value="Substituto"]'); radio.checked = true; fire(radio);
        const u = m.querySelector('#cad-unidade'); u.value = 'IECOS'; fire(u);
        const s = m.querySelector('#cad-subunidade'); s.value = 'FACIN'; fire(s);
      })()`);
      assert(/^Vaga\d+ FACIN$/.test(await evaluate("document.getElementById('cad-vaga-preview').textContent")), 'nome da vaga nao foi gerado');
      await evaluate("document.querySelector('#cadastro-docente-modal .cad-ok').click()");
      assert(await waitFor("!document.getElementById('cadastro-docente-modal') && /^Vaga\\d+ FACIN$/.test(document.getElementById('inp-docente').value) && !!document.querySelector('#aviso-docente-novo .is-ok')", 3000), 'vaga nao entrou no campo Docente');
      await evaluate(`(() => {
        const i = document.getElementById('inp-docente');
        i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);

      // Lista de docentes: primeira linha "A definir (vaga)..." abre a vaga direto.
      await evaluate("document.getElementById('inp-docente').blur(); document.getElementById('inp-docente').focus()");
      assert(await waitFor("!!document.querySelector('.sug-docente:not([hidden]) li:first-child.sug-acao')", 3000), 'lista sem a linha A definir (vaga) no alto');
      await evaluate("document.querySelector('.sug-docente li.sug-acao').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))");
      assert(await waitFor("!!document.querySelector('#cadastro-docente-modal .cad-corpo.hidden')", 3000), 'janela pela lista nao pediu o caso primeiro');
      assert(await evaluate("document.getElementById('inp-docente').value === ''"), 'a linha da lista escreveu no campo');
      // Caso "Docente com nome": nome que ja esta na lista oferece "Usar este".
      const conhecido = await evaluate("document.querySelector('.sug-docente') && [...document.querySelectorAll('#list-view-docentes option')].map(o => o.value)[0] || ''");
      await evaluate(`(() => {
        const m = document.getElementById('cadastro-docente-modal');
        const r = m.querySelector('input[name="cad-tipo"][value="nome"]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      assert(await evaluate("!document.querySelector('#cadastro-docente-modal .cad-corpo').classList.contains('hidden')"), 'escolher o caso nao mostrou o formulario');
      if (conhecido) {
        await evaluate(`(() => {
          const n = document.getElementById('cad-nome'); n.value = ${JSON.stringify(conhecido)};
          n.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);
        assert(await waitFor("!!document.querySelector('#cad-parecidos-vivos:not(.hidden) .cad-usar')", 3000), 'nome da lista sem o Usar este');
      }
      await evaluate(`(() => {
        const m = document.getElementById('cadastro-docente-modal');
        const fire = (el) => el.dispatchEvent(new Event('change', { bubbles: true }));
        const t = m.querySelector('input[name="cad-tipo"][value="vaga"]'); t.checked = true; fire(t);
        const radio = m.querySelector('input[name="cad-vinculo"][value="Visitante"]'); radio.checked = true; fire(radio);
        const u = m.querySelector('#cad-unidade'); u.value = 'IECOS'; fire(u);
        const s = m.querySelector('#cad-subunidade'); s.value = 'FEPESCA'; fire(s);
      })()`);
      await evaluate("document.querySelector('#cadastro-docente-modal .cad-ok').click()");
      assert(await waitFor("!document.getElementById('cadastro-docente-modal') && /^Vaga\\d+ FEPESCA$/.test(document.getElementById('inp-docente').value)", 3000), 'vaga da lista nao entrou no campo');
      await evaluate(`(() => {
        const i = document.getElementById('inp-docente');
        i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await evaluate("document.querySelector('.tab-btn[data-tab=\"teacher\"]').click()");
    });

    // Abre e fecha o "Como resolver?" da primeira linha do alerta (so le: nada muda).
    await check('Como resolver? no alerta de choque', async () => {
      const temBotao = await waitFor("!!document.querySelector('.btn-como-resolver')", 5000);
      if (!temBotao) return 'sem choque com o botao nos dados (nada a testar)';
      await evaluate("document.querySelector('.btn-como-resolver').click()");
      const abriu = await waitFor("[...document.querySelectorAll('.btn-como-resolver')].some((b) => b.getAttribute('aria-expanded') === 'true')", 8000);
      assert(abriu, 'a linha nao abriu');
      const textos = await evaluate("[...document.querySelectorAll('.btn-como-resolver[aria-expanded=\"true\"]')].map((b) => b.closest('tr').nextElementSibling?.innerText || '').join(' / ')");
      assert(/Depende/.test(textos), `sem sugestao: ${textos}`);
      assert(!/Não foi possível calcular/.test(textos), `falha no calculo: ${textos}`);
      await evaluate("document.querySelector('.btn-como-resolver[aria-expanded=\"true\"]').click()");
      assert(await waitFor("![...document.querySelectorAll('.btn-como-resolver')].some((b) => b.getAttribute('aria-expanded') === 'true')", 5000), 'Fechar nao fechou');
      return textos.replace(/\s+/g, ' ').slice(0, 300);
    });

    await check('Calendario do docente: Ano inteiro e PL1..PL4', async () => {
      await evaluate(`(() => {
        const i = document.getElementById('sel-view-docente'); i.value = ${JSON.stringify(data.teacher)};
        i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true }));
        document.getElementById('btn-ano-inteiro-teacher').click();
      })()`);
      const box = "document.getElementById('teacher-calendar-container')";
      const anoOk = await waitFor(`/Ano \\d{4} inteiro/.test(${box}.innerText) && /Docente:/.test(${box}.innerText) && ${box}.querySelectorAll('.calendar-month').length === 12`, 8000);
      const visto = await evaluate(`${box}.querySelectorAll('.calendar-month').length + ' meses | ' + ${box}.innerText.slice(0, 160).split(String.fromCharCode(10)).join(' / ')`);
      assert(anoOk, `ano inteiro sem o selo do ano, o nome do docente ou os 12 meses: ${visto}`);
      const pls = await evaluate("[...document.querySelectorAll('#docente-pl-buttons [data-plan-key]')].map((b) => b.textContent).join(',')");
      assert(pls.split(',').length >= 1, 'sem botoes de PL');
      await evaluate("document.querySelector('#docente-pl-buttons [data-plan-key]').click()");
      const plOk = await waitFor("document.querySelector('#docente-pl-buttons .is-active') && !document.getElementById('btn-ano-inteiro-teacher').classList.contains('is-active')", 5000);
      assert(plOk, 'o botao do PL nao ficou marcado');
      return `PLs: ${pls}`;
    });

    await check('Menu Agenda Publica (agenda publica em tela larga)', async () => {
      await evaluate("document.querySelector('.tab-btn[data-tab=\"publica\"]').click()");
      assert(await waitFor("(document.getElementById('agenda-publica-frame')?.getAttribute('src') || '').includes('source=public')", 3000), 'menu sem a agenda publicada (source=public)');
      const ok = await waitFor(`(() => {
        const d = document.getElementById('agenda-publica-frame').contentDocument;
        return d && d.readyState === 'complete' && d.getElementById('inp-docente-publico') && /Agenda/.test(d.body.innerText);
      })()`, 10000);
      assert(ok, 'a agenda publica nao abriu no menu');
      const largura = await evaluate("document.getElementById('agenda-publica-frame').getBoundingClientRect().width");
      assert(largura > 300, `agenda publica estreita demais: ${largura}px`);
      return `largura ${Math.round(largura)}px`;
    });

    await check('Menu Indicadores: carga por docente (ano inteiro, PL, clique no nome)', async () => {
      await evaluate("document.querySelector('.tab-btn[data-tab=\"indicadores\"]').click()");
      assert(await waitFor("document.querySelectorAll('#ind-tabela tbody .ind-docente').length > 0", 10000), 'tabela sem docentes');
      const ano = await evaluate(`(() => {
        const t = document.querySelector('#ind-tabela table');
        const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent.replace(/[▲▼]/g, '').trim());
        const totais = [...t.querySelectorAll('tbody tr')].filter((tr) => tr.querySelector('.ind-docente'))
          .map((tr) => Number((tr.querySelector('.ind-total')?.textContent || '0').replace(/\\./g, '').replace(',', '.')) || 0);
        return { heads, n: totais.length, ordenado: totais.every((v, i) => i === 0 || v <= totais[i - 1]) };
      })()`);
      assert(ano.heads.includes('Total') && ano.heads.some((h) => /^PL\d$/.test(h)), `colunas do ano: ${ano.heads.join(',')}`);
      assert(ano.ordenado, 'docentes fora da ordem do total (maior primeiro)');
      await evaluate("document.querySelector('#ind-pl-buttons [data-plan-key]').click()");
      assert(await waitFor("!document.querySelector('#ind-tabela thead .ind-pl') && document.querySelector('#ind-pl-buttons .is-active')", 3000), 'o PL nao trocou a tabela');
      const nome = await evaluate("document.querySelector('#ind-tabela .ind-docente').dataset.verDocente");
      await evaluate("document.querySelector('#ind-tabela .ind-docente').click()");
      assert(await waitFor(`document.querySelector('#tab-indicadores .ind-subaba.is-ativa')?.dataset.subaba === 'dias' && document.getElementById('inp-docente-dias').value === ${JSON.stringify(nome)} && !!document.querySelector('#ind-tabela .dd-quadro')`, 5000), 'o clique no nome nao abriu Dias do docente');
      // O x da caixa limpa o docente; o Voltar volta para a Carga.
      const limpou = await evaluate(`(() => {
        const x = document.querySelector('[data-limpar="inp-docente-dias"]');
        if (x.classList.contains('hidden')) return 'x escondido com nome na caixa';
        x.click();
        if (document.getElementById('inp-docente-dias').value || !x.classList.contains('hidden')) return 'x nao limpou';
        if (!/Digite o nome do docente/.test(document.getElementById('ind-tabela').textContent)) return 'nao voltou para Escolha o docente';
        document.getElementById('btn-ind-voltar').click();
        return document.querySelector('#tab-indicadores .ind-subaba.is-ativa')?.dataset.subaba === 'carga' ? '' : 'Voltar nao voltou para a Carga';
      })()`);
      assert(!limpou, limpou);
      return `${ano.n} docentes; colunas ${ano.heads.slice(2).join(' ')}`;
    });

    await check('Menu Indicadores: Componente (busca e tabela das ofertas)', async () => {
      await evaluate("document.querySelector('.tab-btn[data-tab=\"indicadores\"]').click()");
      await evaluate("document.querySelector('#tab-indicadores .ind-subaba[data-subaba=\"componente\"]').click()");
      await evaluate("document.getElementById('btn-ano-inteiro-indicadores').click()");
      assert(await waitFor("document.querySelectorAll('#list-componentes-ind option').length > 0", 10000), 'lista de componentes vazia');
      // Escolhe a 1a componente da lista, como quem clica na sugestao.
      const nome = await evaluate(`(() => {
        const nome = document.querySelector('#list-componentes-ind option').value;
        const inp = document.getElementById('inp-componente-ind');
        inp.value = nome;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        return nome;
      })()`);
      assert(await waitFor("document.querySelectorAll('#ind-tabela .ind-tabela-comp tbody tr').length > 0", 5000), `sem ofertas de ${nome}`);
      // Toda componente da lista acha ao menos uma oferta (o desenho e sincrono).
      const r = await evaluate(`(() => {
        const inp = document.getElementById('inp-componente-ind');
        const nomes = [...document.querySelectorAll('#list-componentes-ind option')].map((o) => o.value);
        const vazias = [];
        let maior = { nome: '', linhas: [] };
        nomes.forEach((nome) => {
          inp.value = nome;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          const linhas = [...document.querySelectorAll('#ind-tabela .ind-tabela-comp tbody tr')]
            .map((tr) => [...tr.cells].map((td) => td.textContent.replace(/\\s+/g, ' ').trim()).join(' | '));
          if (!linhas.length) vazias.push(nome);
          if (linhas.length > maior.linhas.length) maior = { nome, linhas };
        });
        return { n: nomes.length, vazias, maior };
      })()`);
      assert(!r.vazias.length, `componentes da lista sem oferta: ${r.vazias.slice(0, 5).join(', ')}`);
      assert(r.maior.linhas.every((l) => /^PL\d/.test(l)), `linha sem PL: ${r.maior.linhas[0]}`);
      // Atalho: abre a Lista de ofertas da turma com a linha da componente destacada.
      const ir = await evaluate(`(() => {
        const inp = document.getElementById('inp-componente-ind');
        inp.value = ${JSON.stringify(r.maior.nome)};
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        const btns = [...document.querySelectorAll('#ind-tabela button[data-ir-oferta]')];
        const btn = btns[btns.length - 1];
        if (!btn) return null;
        const turma = btn.closest('tr').querySelector('.ind-comp-turma').textContent.trim();
        btn.click();
        return { turma, botoes: btns.length };
      })()`);
      assert(ir, 'nenhum botao Ir para a oferta');
      assert(await waitFor("document.getElementById('tab-list').classList.contains('active') && !!document.querySelector('#ofertas-table tr.oferta-destaque')", 5000), 'o atalho nao abriu a Lista de ofertas com a linha destacada');
      const destaque = await evaluate(`(() => {
        const sem = (t) => t.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toUpperCase();
        const trs = [...document.querySelectorAll('#ofertas-table tr.oferta-destaque')];
        return { n: trs.length, ok: trs.every((tr) => sem(tr.cells[0].textContent).includes(sem(${JSON.stringify(r.maior.nome)}))), turma: document.getElementById('sel-turma').selectedOptions[0]?.textContent || '' };
      })()`);
      assert(destaque.ok, 'a linha destacada nao e da componente buscada');
      // Oferta de outro PL: a barra lateral troca de PL.
      await evaluate("document.querySelector('.tab-btn[data-tab=\"indicadores\"]').click()");
      const outro = await evaluate(`(() => {
        const ativo = document.getElementById('sel-periodo-letivo').selectedOptions[0]?.dataset.periodo || '';
        const inp = document.getElementById('inp-componente-ind');
        for (const opt of document.querySelectorAll('#list-componentes-ind option')) {
          inp.value = opt.value;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          const btn = [...document.querySelectorAll('#ind-tabela button[data-ir-oferta]')]
            .find((b) => b.closest('tr').cells[0].textContent.trim() !== ativo);
          if (btn) {
            const pl = btn.closest('tr').cells[0].textContent.trim();
            btn.click();
            return { de: ativo, para: pl, nome: opt.value };
          }
        }
        return null;
      })()`);
      if (outro) {
        assert(await waitFor(`document.getElementById('sel-periodo-letivo').selectedOptions[0]?.dataset.periodo === ${JSON.stringify(outro.para)} && !!document.querySelector('#ofertas-table tr.oferta-destaque')`, 5000), `o atalho nao trocou de ${outro.de} para ${outro.para}`);
      }
      // Clicar na linha abre o quadro da turma, com a componente em destaque.
      await evaluate("document.querySelector('.tab-btn[data-tab=\"indicadores\"]').click()");
      const quadroTurma = await evaluate(`(() => {
        const inp = document.getElementById('inp-componente-ind');
        inp.value = ${JSON.stringify(r.maior.nome)};
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#ind-tabela tr[data-comp-linha] .ind-comp-turma').click();
        const q = document.querySelector('#ind-tabela .ind-comp-quadro .dd-quadro');
        if (!q) return null;
        return {
          titulo: q.querySelector('.dd-pl').textContent,
          linhas: q.querySelectorAll('.dd-rot-nome').length,
          destaque: q.querySelectorAll('.dd-rot-destaque').length,
          sobrecarga: /Sobrecarga/.test(q.textContent)
        };
      })()`);
      assert(quadroTurma, 'clicar na linha nao abriu o quadro da turma');
      assert(quadroTurma.destaque === 1 && !quadroTurma.sobrecarga, `quadro da turma: ${JSON.stringify(quadroTurma)}`);
      if (process.env.CARDUME_PRINT_QUADRO) {
        await evaluate("document.querySelector('#ind-tabela .ind-comp-quadro').scrollIntoView({ block: 'end' })");
        await sleep(400);
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(process.env.CARDUME_PRINT_QUADRO, Buffer.from(shot.result.data, 'base64'));
      }
      const fechou = await evaluate("document.querySelector('#ind-tabela tr[data-comp-linha] .ind-comp-turma').click(), !document.querySelector('#ind-tabela .ind-comp-quadro')");
      assert(fechou, 'clicar de novo na linha nao fechou o quadro');
      return `${r.n} componentes, todas com oferta; mais ofertas: ${r.maior.nome} (${r.maior.linhas.length}); atalho -> ${ir.turma} (barra lateral: ${destaque.turma}), ${destaque.n} linha(s) destacada(s); ${outro ? `outro PL: ${outro.nome} ${outro.de} -> ${outro.para} OK` : 'sem oferta em outro PL para testar a troca'}; quadro da turma ${quadroTurma.titulo}: ${quadroTurma.linhas} componentes, 1 em destaque`;
    });

    await check('Menu Indicadores: Turma (turmas e quadro por PL)', async () => {
      await evaluate("document.querySelector('.tab-btn[data-tab=\"indicadores\"]').click()");
      await evaluate("document.querySelector('#tab-indicadores .ind-subaba[data-subaba=\"turma\"]').click()");
      await evaluate("document.getElementById('btn-ano-inteiro-indicadores').click()");
      assert(await waitFor("document.querySelectorAll('#ind-turmas button[data-turma]').length > 0", 10000), 'nenhuma turma');
      assert(await evaluate("!document.getElementById('ind-faculdade-box').classList.contains('hidden')"), 'Faculdade escondida');
      // Toda turma da lista mostra o quadro; cada componente com docente e horario embaixo do nome.
      const r = await evaluate(`(() => {
        const ids = [...document.querySelectorAll('#ind-turmas button[data-turma]')].map((b) => b.dataset.turma);
        const ruins = [];
        let maior = { id: '', pls: 0, linhas: 0 };
        ids.forEach((id) => {
          document.querySelector('#ind-turmas button[data-turma="' + id + '"]').click();
          const blocos = [...document.querySelectorAll('#ind-tabela .ind-turma-pl')];
          if (!blocos.length) { ruins.push(id + ': sem quadro'); return; }
          if (document.querySelector('#ind-tabela table')) ruins.push(id + ': ainda tem tabela');
          let linhas = 0;
          blocos.forEach((b) => {
            const rots = [...b.querySelectorAll('.dd-quadro--turma .dd-rot[data-dd-comp]')];
            linhas += rots.length;
            if (!rots.length) ruins.push(id + ' ' + b.dataset.planKey + ': quadro vazio');
            rots.forEach((rot) => {
              const subs = [...rot.querySelectorAll('.dd-rot-sub')].map((x) => x.textContent);
              if (subs.length < 2 || !/[0-9]+h/.test(subs[subs.length - 1])) ruins.push(id + ' ' + rot.querySelector('.dd-rot-nome').textContent + ': detalhe ' + JSON.stringify(subs));
            });
          });
          if (blocos.length > maior.pls || (blocos.length === maior.pls && linhas > maior.linhas)) maior = { id, pls: blocos.length, linhas };
        });
        return { n: ids.length, ruins, maior };
      })()`);
      assert(!r.ruins.length, r.ruins.slice(0, 4).join('; '));
      // Clicar no nome destaca a componente no quadro do mesmo PL; de novo tira.
      const d = await evaluate(`(() => {
        document.querySelector('#ind-turmas button[data-turma="${r.maior.id}"]').click();
        const rots = document.querySelectorAll('#ind-tabela .dd-rot[data-dd-comp]');
        const alvo = rots[rots.length - 1];
        const nome = alvo.querySelector('.dd-rot-nome').textContent;
        alvo.querySelector('.dd-rot-nome').click();
        const marcados = [...document.querySelectorAll('#ind-tabela .dd-rot-destaque')];
        return { destaques: marcados.length, mesmo: marcados[0]?.querySelector('.dd-rot-nome').textContent === nome };
      })()`);
      assert(d.destaques === 1 && d.mesmo, `destaque: ${JSON.stringify(d)}`);
      if (process.env.CARDUME_PRINT_TURMA) {
        await evaluate("window.scrollTo(0, 0)");
        await sleep(400);
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
        fs.writeFileSync(process.env.CARDUME_PRINT_TURMA, Buffer.from(shot.result.data, 'base64'));
      }
      const tirou = await evaluate("document.querySelector('#ind-tabela .dd-rot-destaque .dd-rot-nome').click(), !document.querySelector('#ind-tabela .dd-rot-destaque')");
      assert(tirou, 'clicar de novo nao tirou o destaque');
      // Faculdade: so as turmas do curso escolhido.
      const f = await evaluate(`(() => {
        const sel = document.getElementById('sel-curso-ind');
        const sigla = sel.options[1]?.value;
        if (!sigla) return null;
        sel.value = sigla;
        sel.dispatchEvent(new Event('change'));
        const rot = [...document.querySelectorAll('#ind-turmas button[data-turma]')].map((b) => b.textContent.trim());
        sel.value = '';
        sel.dispatchEvent(new Event('change'));
        return { sigla, rot };
      })()`);
      assert(!f || f.rot.every((t) => t.startsWith(f.sigla)), `filtro da faculdade: ${JSON.stringify(f)}`);
      return `${r.n} turmas, todas com quadro e detalhe; maior: ${r.maior.id} (${r.maior.pls} PLs, ${r.maior.linhas} componentes); destaque OK; ${f ? `faculdade ${f.sigla}: ${f.rot.join(' ')}` : 'uma faculdade so'}`;
    });

    await check('Menu Indicadores: atalhos entre as sub-abas e Voltar', async () => {
      await evaluate("document.querySelector('.tab-btn[data-tab=\"indicadores\"]').click()");
      await evaluate("document.querySelector('#tab-indicadores .ind-subaba[data-subaba=\"componente\"]').click()");
      await evaluate("document.getElementById('btn-ano-inteiro-indicadores').click()");
      assert(await waitFor("document.querySelectorAll('#list-componentes-ind option').length > 0", 10000), 'lista de componentes vazia');
      const r = await evaluate(`(() => {
        const passos = [];
        const ativa = () => document.querySelector('#tab-indicadores .ind-subaba.is-ativa')?.dataset.subaba;
        const voltar = document.getElementById('btn-ind-voltar');
        // 1) Componente: escolhe a 1a e clica na turma da 1a linha.
        const inp = document.getElementById('inp-componente-ind');
        inp.value = document.querySelector('#list-componentes-ind option').value;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        const comp = inp.value;
        if (!voltar.classList.contains('hidden')) passos.push('Voltar aparece sem atalho');
        const bt = document.querySelector('#ind-tabela button[data-ver-turma]');
        if (!bt) return { erro: 'sem atalho de turma no Componente' };
        bt.click();
        if (ativa() !== 'turma') return { erro: 'Componente > turma nao abriu a sub-aba Turma' };
        const destaque = document.querySelectorAll('#ind-tabela .dd-rot-destaque').length;
        const turma = document.querySelector('#ind-turmas .is-active')?.textContent.trim();
        if (destaque !== 1) passos.push('turma sem a componente em destaque (' + destaque + ')');
        if (!voltar.textContent.includes(comp)) passos.push('Voltar sem o nome da componente: ' + voltar.textContent);
        // 2) Turma: docente > Dias do docente.
        const bd = document.querySelector('#ind-tabela button[data-ver-docente]');
        if (!bd) return { erro: 'sem atalho de docente na Turma' };
        const docente = bd.dataset.verDocente;
        bd.click();
        if (ativa() !== 'dias' || document.getElementById('inp-docente-dias').value !== docente) return { erro: 'Turma > docente nao abriu Dias do docente' };
        if (!document.querySelector('#ind-tabela .dd-quadro .dd-rot[data-dd-comp]')) return { erro: 'Dias do docente sem quadro' };
        // 3) Dias: componente > Turma dela, em destaque.
        document.querySelector('#ind-tabela .dd-rot[data-dd-comp] .dd-rot-nome').click();
        if (ativa() !== 'turma' || document.querySelectorAll('#ind-tabela .dd-rot-destaque').length !== 1) return { erro: 'Dias > componente nao abriu a turma com destaque' };
        // 4) Turma: componente > Componente.
        const bc = document.querySelector('#ind-tabela button[data-ver-componente]');
        const nomeC = bc.dataset.verComponente;
        bc.click();
        if (ativa() !== 'componente' || !document.querySelector('#ind-tabela tr[data-comp-linha]')) return { erro: 'Turma > componente nao abriu o Componente: ' + nomeC };
        // Voltar 4 vezes: Turma, Dias, Turma, Componente do inicio.
        const volta = [];
        for (let i = 0; i < 4; i++) { voltar.click(); volta.push(ativa()); }
        if (volta.join(',') !== 'turma,dias,turma,componente') passos.push('voltar: ' + volta.join(','));
        if (inp.value !== comp) passos.push('voltou com outra componente: ' + inp.value);
        if (!voltar.classList.contains('hidden')) passos.push('Voltar ainda aparece no fim');
        return { passos, comp, turma, docente, nomeC };
      })()`);
      assert(!r.erro, r.erro);
      assert(!r.passos.length, r.passos.join('; '));
      // Componente: docente > Dias do docente; Turma: ✎ > Lista de ofertas com a linha destacada.
      const extra = await evaluate(`(() => {
        const ativa = () => document.querySelector('#tab-indicadores .ind-subaba.is-ativa')?.dataset.subaba;
        const bd = document.querySelector('#ind-tabela .ind-tabela-comp button[data-ver-docente]');
        if (!bd) return { erro: 'Componente sem atalho de docente' };
        const nome = bd.dataset.verDocente;
        bd.click();
        if (ativa() !== 'dias' || document.getElementById('inp-docente-dias').value !== nome) return { erro: 'Componente > docente nao abriu Dias do docente' };
        document.getElementById('btn-ind-voltar').click();
        document.querySelector('#ind-tabela button[data-ver-turma]').click();
        const lapis = document.querySelector('#ind-tabela button[data-ir-oferta][data-ir-lista="turma"]');
        if (!lapis) return { erro: 'Turma sem o atalho ✎' };
        const nomeComp = lapis.closest('.dd-rot').querySelector('.dd-rot-nome').firstChild.textContent.trim();
        lapis.click();
        return { nome, nomeComp };
      })()`);
      assert(!extra.erro, extra.erro);
      assert(await waitFor("document.getElementById('tab-list').classList.contains('active') && !!document.querySelector('#ofertas-table tr.oferta-destaque')", 5000), 'o ✎ da Turma nao abriu a Lista de ofertas com a linha destacada');
      await evaluate("document.querySelector('.tab-btn[data-tab=\"indicadores\"]').click()");
      await evaluate("document.getElementById('btn-ind-voltar')?.click()");
      if (process.env.CARDUME_PRINT_BUSCA) {
        // Caixa da componente com o x (sub-aba Componente, no alto).
        await evaluate("document.querySelector('#tab-indicadores .ind-subaba[data-subaba=\"componente\"]').click(); document.getElementById('tab-indicadores').scrollTop = 0");
        await sleep(300);
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(process.env.CARDUME_PRINT_BUSCA, Buffer.from(shot.result.data, 'base64'));
      }
      if (process.env.CARDUME_PRINT_NAV) {
        // Turma aberta pelo atalho do Componente (com o Voltar); depois volta.
        await evaluate("document.querySelector('#ind-tabela button[data-ver-turma]').click()");
        await sleep(400);
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(process.env.CARDUME_PRINT_NAV, Buffer.from(shot.result.data, 'base64'));
        await evaluate("document.getElementById('btn-ind-voltar').click()");
      }
      return `${r.comp} > ${r.turma} > ${r.docente} > turma > ${r.nomeC}; Voltar x4 OK; Componente > docente ${extra.nome} OK; Turma ✎ ${extra.nomeComp} > Lista de ofertas OK`;
    });
  } finally {
    const falhou = results.some((r) => !r.ok);
    if (falhou) {
      try {
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        const file = path.join(os.tmpdir(), 'cardume-smoke-falha.png');
        fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
        console.log(`Tela no momento da falha: ${file}`);
      } catch { /* sem captura */ }
    }
    ws.close();
    proc.kill();
    server.close();
    await sleep(500);
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* o navegador ainda segura algum arquivo */ }
  }
  return results.every((r) => r.ok);
}

// So roda o roteiro quando chamado direto (npm run smoke); outros scripts
// (ex.: tools/prints_instrucoes.mjs) importam as funcoes acima.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ok = await run().catch((err) => { console.log(`FALHA ${err.message}`); return false; });
  console.log(ok ? '\nTudo certo.' : '\nHa falhas: veja as linhas FALHA acima.');
  process.exit(ok ? 0 : 1);
}
