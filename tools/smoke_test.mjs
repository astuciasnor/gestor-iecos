// Teste de fumaca: abre o app num Chrome/Edge invisivel, com os dados publicados
// (alocacoes_publicas.json), passa pelas telas principais e avisa se algo quebrou.
// Pega o que os testes de unidade nao pegam: tela em branco, erro no console,
// Gantt vazio, modulo carregado em dobro, etc.
//
// Uso (na raiz do projeto):   npm run smoke
// Navegador: acha Chrome ou Edge sozinho; para outro, defina CHROME_PATH.
// Nada e gravado no projeto; o perfil do navegador e temporario.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { ROOT, scanReferences, findProblems } from './bump_version.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- servidor local
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp'
};

function startServer() {
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
function findBrowser() {
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

async function openBrowser(browserPath, profileDir) {
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

function cdp(ws, errors) {
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
function loadPublishedData() {
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

function seedScript({ pubs, main }) {
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
      await evaluate("document.querySelector('.tab-btn[data-tab=\"teacher\"]').click()");
    });

    await check('Gantt do docente', async () => {
      await evaluate(`(() => {
        const i = document.getElementById('sel-view-docente'); i.value = ${JSON.stringify(data.teacher)};
        i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector('.subtab-btn[data-subtab="docente-gantt"]').click();
      })()`);
      // Cabecalho com o nome do professor e ao menos uma barra ("60h (TURMA)").
      const ok = await waitFor(`(() => {
        const t = (document.getElementById('gantt-container-docente')?.innerText || '').toUpperCase();
        return t.includes(${JSON.stringify(data.teacher.toUpperCase())}) && /\\d+H\\s*\\(/.test(t);
      })()`, 8000);
      const texto = await evaluate("(document.getElementById('gantt-container-docente')?.innerText || '').slice(0, 120).replace(/\\s+/g, ' ')");
      assert(ok, `Gantt sem as componentes do professor: "${texto}"`);
    });

    await check('Celular (agenda publica na moldura)', async () => {
      await evaluate("document.querySelector('.subtab-btn[data-subtab=\"docente-celular\"]').click()");
      assert(await waitFor("(document.getElementById('celular-docente-frame')?.getAttribute('src') || '').includes('docente=')", 3000), 'moldura sem professor');
      const ok = await waitFor(`(() => {
        const d = document.getElementById('celular-docente-frame').contentDocument;
        return d && d.getElementById('inp-docente-publico')?.value && d.querySelectorAll('.pub-result-badge').length > 0;
      })()`, 10000);
      assert(ok, 'a agenda publica nao mostrou o resumo do professor');
      return await evaluate("[...document.getElementById('celular-docente-frame').contentDocument.querySelectorAll('.pub-result-badge')].map(b => b.textContent.trim()).join(' / ')");
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

const ok = await run().catch((err) => { console.log(`FALHA ${err.message}`); return false; });
console.log(ok ? '\nTudo certo.' : '\nHa falhas: veja as linhas FALHA acima.');
process.exit(ok ? 0 : 1);
