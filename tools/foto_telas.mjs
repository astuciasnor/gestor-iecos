// Foto das telas do Cardume (texto), para comparar antes/depois da refatoracao.
// Uso (na raiz): node tools/foto_telas.mjs antes.json   ...muda o codigo...   node tools/foto_telas.mjs depois.json --comparar antes.json
// Dados: alocacoes_publicas.json do repositorio (ou DADOS=arquivo.json), modo local, sem servidor.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sleep, startServer, findBrowser, openBrowser, cdp } from './smoke_test.mjs';
import { ROOT } from './bump_version.mjs';

const saida = process.argv[2] || 'foto.json';
const agenda = JSON.parse(fs.readFileSync(process.env.DADOS || path.join(ROOT, 'alocacoes_publicas.json'), 'utf8'));
const pubs = agenda.publications.filter((p) => p?.plan?.key && Array.isArray(p.allocations));
const main = pubs.find((p) => p.plan.key.startsWith('PL2__2027'));
const settings = { periodo: main.plan.periodo, termStart: main.plan.termStart, termEnd: main.plan.termEnd };
const seed = `sessionStorage.setItem('auth', 'true');
if (!localStorage.getItem('foto_seeded')) {
  localStorage.setItem('foto_seeded', '1');
  localStorage.setItem('academic_settings', ${JSON.stringify(JSON.stringify(settings))});
  ${pubs.map((p) => `localStorage.setItem(${JSON.stringify('academic_plan_v1::' + p.plan.key)}, ${JSON.stringify(JSON.stringify(p.allocations))});`).join('\n  ')}
}`;

const errors = [];
const server = await startServer();
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardume-foto-'));
const { proc, ws } = await openBrowser(findBrowser(), profileDir);
const { send, evaluate, waitFor } = cdp(ws, errors);
const foto = {};
try {
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: seed });
  await send('Page.navigate', { url: `${baseUrl}/index.html?backend=local` });
  if (!await waitFor("document.querySelectorAll('#sel-periodo-letivo option').length > 1", 40000)) throw new Error('app nao abriu');
  await sleep(1500);

  const periodos = await evaluate("[...document.querySelectorAll('#sel-periodo-letivo option')].map(o => ({ v: o.value, t: o.textContent.trim() }))");
  const alvo = periodos.filter((p) => /2027 - PL(2|4)/.test(p.t));
  for (const per of alvo) {
    await evaluate(`(() => { const s = document.getElementById('sel-periodo-letivo'); s.value = ${JSON.stringify(per.v)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await sleep(1500);
    const turmas = await evaluate(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      const pick = async (sel, value) => { sel.value = value; sel.dispatchEvent(new Event('change', { bubbles: true })); await wait(350); };
      const out = {};
      const curso = document.getElementById('sel-curso'), turma = document.getElementById('sel-turma');
      for (const c of [...curso.options].filter(o => o.value)) {
        await pick(curso, c.value);
        for (const t of [...turma.options].filter(o => o.value)) {
          await pick(turma, t.value);
          const chave = c.value + '/' + t.value;
          document.querySelector('.tab-btn[data-tab="list"]').click(); await wait(120);
          const lista = document.getElementById('tab-list').innerText;
          document.querySelector('.tab-btn[data-tab="monthly"]').click(); await wait(250);
          const mensal = document.getElementById('tab-monthly').innerText;
          document.querySelector('.tab-btn[data-tab="weekly"]').click(); await wait(250);
          const semanal = document.getElementById('tab-weekly').innerText;
          out[chave] = { lista, mensal, semanal };
        }
      }
      return out;
    })()`);
    foto[per.t] = { turmas };
    // Docentes: os 12 primeiros da lista
    await evaluate("document.querySelector('.tab-btn[data-tab=\"teacher\"]').click()");
    await sleep(600);
    const nomes = (await evaluate("[...document.querySelectorAll('#list-view-docentes option')].map(o => o.value)")).slice(0, 12);
    foto[per.t].docentes = {};
    for (const nome of nomes) {
      await evaluate(`(() => { const i = document.getElementById('sel-view-docente'); i.value = ${JSON.stringify(nome)}; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await sleep(500);
      foto[per.t].docentes[nome] = await evaluate("document.getElementById('tab-teacher').innerText");
    }
    await evaluate("document.querySelector('.tab-btn[data-tab=\"indicadores\"]').click()");
    await sleep(1500);
    foto[per.t].indicadores = await evaluate("document.getElementById('tab-indicadores').innerText");
  }
  foto.erros = errors;
  fs.writeFileSync(saida, JSON.stringify(foto, null, 1));
  const n = Object.values(foto).filter((v) => v.turmas).map((v) => Object.keys(v.turmas).length);
  console.log('foto gravada:', saida, 'turmas por PL:', n.join(','), 'erros:', errors.length);
} finally {
  ws.close(); proc.kill(); server.close();
  await sleep(300);
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* */ }
}

// --comparar antes.json: diz se a foto nova e igual a de antes (e onde muda).
const iComparar = process.argv.indexOf('--comparar');
if (iComparar > 0) {
  const antes = JSON.parse(fs.readFileSync(process.argv[iComparar + 1], 'utf8'));
  const depois = JSON.parse(fs.readFileSync(saida, 'utf8'));
  const diffs = [];
  const andar = (a, b, onde) => {
    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
      if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(onde);
      return;
    }
    new Set([...Object.keys(a), ...Object.keys(b)]).forEach((k) => andar(a[k], b[k], `${onde}/${k}`));
  };
  andar(antes, depois, '');
  console.log(diffs.length ? `DIFERENTE em ${diffs.length} ponto(s): ${diffs.slice(0, 20).join(' | ')}` : 'IGUAL a foto de antes.');
  process.exitCode = diffs.length ? 1 : 0;
}
