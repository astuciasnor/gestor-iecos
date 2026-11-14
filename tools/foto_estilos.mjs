// Foto dos estilos calculados da aba Alocar (e da pagina), para comparar CSS antes/depois.
// Larguras: 860, 1200, 1400, 1700. Estados: turma escolhida; componente em edicao com horarios.
// Uso (na raiz): node tools/foto_estilos.mjs antes.json   ...muda o CSS...   node tools/foto_estilos.mjs depois.json --comparar antes.json
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sleep, startServer, findBrowser, openBrowser, cdp } from './smoke_test.mjs';
import { ROOT } from './bump_version.mjs';

const saida = process.argv[2] || 'estilos.json';
const agenda = JSON.parse(fs.readFileSync(process.env.DADOS || path.join(ROOT, 'alocacoes_publicas.json'), 'utf8'));
const pubs = agenda.publications.filter((p) => p?.plan?.key && Array.isArray(p.allocations));
const main = pubs.find((p) => p.plan.key.startsWith('PL2__2027'));
const seed = `sessionStorage.setItem('auth', 'true');
if (!localStorage.getItem('foto_seeded')) {
  localStorage.setItem('foto_seeded', '1');
  localStorage.setItem('academic_settings', ${JSON.stringify(JSON.stringify({ periodo: main.plan.periodo, termStart: main.plan.termStart, termEnd: main.plan.termEnd }))});
  ${pubs.map((p) => `localStorage.setItem(${JSON.stringify('academic_plan_v1::' + p.plan.key)}, ${JSON.stringify(JSON.stringify(p.allocations))});`).join('\n  ')}
}`;

const PROPS = ['display', 'position', 'top', 'left', 'width', 'height', 'min-width', 'max-width', 'min-height', 'margin', 'padding', 'gap',
  'grid-template-columns', 'grid-column', 'grid-row', 'flex', 'flex-wrap', 'flex-direction', 'align-items', 'justify-content', 'text-align',
  'font-size', 'font-weight', 'line-height', 'color', 'background-color', 'background-image', 'border', 'border-radius', 'box-shadow',
  'opacity', 'white-space', 'overflow', 'cursor', 'visibility', 'z-index', 'letter-spacing', 'text-transform', 'outline', 'vertical-align'];

const coletar = `(() => {
  const props = ${JSON.stringify(PROPS)};
  const out = [];
  // Sem animacoes (o pulso da celula sugerida mudaria a foto a cada instante).
  if (!document.getElementById('foto-sem-animacao')) {
    const st = document.createElement('style');
    st.id = 'foto-sem-animacao';
    st.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }';
    document.head.appendChild(st);
  }
  const raiz = document.getElementById('tab-weekly');
  const els = [raiz, ...raiz.querySelectorAll('*')];
  els.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const id = el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + [...el.classList].join('.');
    out.push(id + ' ' + props.map(p => cs.getPropertyValue(p)).join('|'));
  });
  return out;
})()`;

const errors = [];
const server = await startServer();
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardume-estilos-'));
const { proc, ws } = await openBrowser(findBrowser(), profileDir);
const { send, evaluate, waitFor } = cdp(ws, errors);
const foto = {};
try {
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: seed });
  await send('Page.navigate', { url: `${baseUrl}/index.html?backend=local` });
  await waitFor("document.querySelectorAll('#sel-periodo-letivo option').length > 1", 40000);
  await sleep(1500);
  await evaluate(`(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const pick = async (id, pred) => { const s = document.getElementById(id); const o = [...s.options].find(pred); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); await wait(700); };
    await pick('sel-curso', o => /Pesca/i.test(o.textContent));
    await pick('sel-turma', o => o.value === 'EP2025');
  })()`);
  const larguras = [860, 1200, 1400, 1700];
  for (const w of larguras) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 1000, deviceScaleFactor: 1, mobile: false });
    await sleep(700);
    foto[`turma@${w}`] = await evaluate(coletar);
  }
  // Componente em edicao: escolhe disciplina e docente; marca 3 horarios
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  await evaluate(`(async () => {
    const w = (ms) => new Promise(r => setTimeout(r, ms));
    const d = document.getElementById('inp-disciplina'); d.value = 'ECOLOGIA (60h)';
    ['input', 'change'].forEach(e => d.dispatchEvent(new Event(e, { bubbles: true }))); await w(900);
    const p = document.getElementById('inp-docente'); p.value = 'Marcos Ferreira Brabo';
    ['input', 'change'].forEach(e => p.dispatchEvent(new Event(e, { bubbles: true }))); await w(700);
    const livres = [...document.querySelectorAll('#weekly-grid .slot[data-can-edit="1"]')].slice(0, 3);
    for (const c of livres) { c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); await w(200); }
  })()`);
  await sleep(800);
  for (const w of larguras) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 1000, deviceScaleFactor: 1, mobile: false });
    await sleep(700);
    foto[`edicao@${w}`] = await evaluate(coletar);
  }
  foto.erros = errors;
  fs.writeFileSync(saida, JSON.stringify(foto, null, 1));
  console.log('estilos gravados:', saida, Object.entries(foto).filter(([k]) => k !== 'erros').map(([k, v]) => `${k}:${v.length}`).join(' '), 'erros:', errors.length);
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
