// Shift+clique na grade semanal (como no Excel): clique numa aula e Shift+clique
// em outra marca o retangulo entre as duas; se a primeira foi desmarcada, o
// retangulo apaga. Pula horario ocupado. Ancora de outra semana = clique normal.
// Uso: node tools/teste_shift_retangulo.mjs   (dados de teste no navegador; nao toca o servidor)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sleep, startServer, findBrowser, openBrowser, cdp } from './smoke_test.mjs';

const T = ['14:00 - 14:50', '14:50 - 15:40', '15:40 - 16:30', '16:50 - 17:40', '17:40 - 18:30'];
const termStart = '2027-08-23', termEnd = '2027-12-23', periodoNome = 'PL4';
// Uma componente curta ocupa a quarta 25/08 das 14:50 as 15:40 (para testar o "pula ocupado").
const allocs = [{
  id: 'o1', ch: 1, cor: '#ffadad', modo: 'faixas', modelo: 'Automatico', turmaId: 'EP2027', subGrupo: null, importado: false,
  docente: 'Lorena', docentes: null, disciplina: 'INGLES TECNICO', dataInicio: '2027-08-25', dataFim: '2027-08-25',
  usaSabado: false, sabadoManha: false, diasMarcados: [3], horariosOcupados: [T[1]],
  faixas: [{ inicio: '2027-08-25', fim: '2027-08-25', dias: [3], slots: [T[1]], drawnSlotsByDay: { 3: [T[1]] } }],
  executionByDate: {}
}];
const KEY = `academic_plan_v1::${periodoNome}__${termStart}__${termEnd}`;
const seed = `sessionStorage.setItem('auth','true');
if (!localStorage.getItem('smoke_seeded')) {
  localStorage.setItem('smoke_seeded','1');
  localStorage.setItem('academic_settings', ${JSON.stringify(JSON.stringify({ periodo: periodoNome, termStart, termEnd }))});
  localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(allocs))});
}`;

const server = await startServer();
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardume-shift-'));
const { proc, ws } = await openBrowser(findBrowser(), profileDir);
const errors = [];
const { send, evaluate, waitFor } = cdp(ws, errors);
let falhas = 0;
const confere = (rotulo, obtido, esperado) => {
  const ok = String(obtido) === String(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${rotulo}: ${obtido}${ok ? '' : `  (esperado ${esperado})`}`);
};
const celula = (dia, hora) => `[...document.querySelectorAll('#weekly-grid .slot[data-dia="${dia}"]')].find(x => (x.dataset.horario || '').startsWith('${hora}'))`;
// Clique de mouse de verdade (Input do navegador), com Shift apertado se pedido.
const clicar = async (dia, hora, shift = false) => {
  const pos = JSON.parse(await evaluate(`(() => { const c = ${celula(dia, hora)}; c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`));
  const modifiers = shift ? 8 : 0;
  if (shift) await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, modifiers });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y, modifiers });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1, modifiers });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1, modifiers });
  if (shift) await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
  await sleep(600);
};
const marcadas = () => evaluate("[...document.querySelectorAll('#weekly-grid .slot.selected-slot')].map(c => c.dataset.dia + '@' + c.dataset.horario.slice(0, 5)).sort().join(' ')");
const semana = async (alvo) => {
  for (let i = 0; i < 14; i++) {
    const l = await evaluate("document.getElementById('weekly-week-label').textContent");
    const m = l.match(/(\d\d)\/(\d\d)\/(\d{4})/);
    const seg = m ? `${m[3]}-${m[2]}-${m[1]}` : '';
    if (seg === alvo) return true;
    await evaluate(`document.getElementById('btn-week-${seg > alvo ? 'prev' : 'next'}').click()`);
    await sleep(450);
  }
  return false;
};

try {
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: seed });
  await send('Page.navigate', { url: `${baseUrl}/index.html?backend=local` });
  await waitFor("document.querySelectorAll('#sel-periodo-letivo option').length > 1", 40000);
  await sleep(800);
  await evaluate(`(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const pick = async (id, pred) => { const s = document.getElementById(id); const o = [...s.options].find(pred); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); await wait(700); };
    await pick('sel-periodo-letivo', o => /PL4/.test(o.textContent) && /2027/.test(o.textContent + o.value));
    await pick('sel-curso', o => /Pesca/i.test(o.textContent));
    await pick('sel-turma', o => o.value === 'EP2027');
  })()`);
  await evaluate(`(async () => {
    const w = (ms) => new Promise(r => setTimeout(r, ms));
    const d = document.getElementById('inp-disciplina'); d.value = 'MATEMATICA BASICA (90h)';
    ['input', 'change'].forEach(e => d.dispatchEvent(new Event(e, { bubbles: true }))); await w(900);
    const p = document.getElementById('inp-docente'); p.value = 'Marcos Ferreira Brabo';
    ['input', 'change'].forEach(e => p.dispatchEvent(new Event(e, { bubbles: true }))); await w(700);
  })()`);
  await semana('2027-08-23');

  // 1) Clique seg 14:00 + Shift+clique qua 15:40 = 3 dias x 3 aulas, menos qua 14:50 (ocupada)
  await clicar(1, '14:00');
  confere('1a. ancora com contorno', await evaluate(`${celula(1, '14:00')}.classList.contains('slot-ancora')`), true);
  await clicar(3, '15:40', true);
  confere('1b. retangulo marcado (sem a ocupada)', await marcadas(),
    '1@14:00 1@14:50 1@15:40 2@14:00 2@14:50 2@15:40 3@14:00 3@15:40');
  confere('1c. inicio da Faixa 1', await evaluate("document.getElementById('inp-data-inicio-f1').value"), '2027-08-23');

  // 2) Desmarca ter 14:00 (ancora apaga) + Shift+clique seg 14:50 = apaga 2x2
  await clicar(2, '14:00');
  await clicar(1, '14:50', true);
  confere('2. retangulo apagado', await marcadas(), '1@15:40 2@15:40 3@14:00 3@15:40');

  // 3) Sem ancora nesta semana: Shift+clique vira clique normal
  await semana('2027-08-30');
  await clicar(4, '16:50', true);
  confere('3. ancora de outra semana -> clique normal', await marcadas(), '1@15:40 2@15:40 3@14:00 3@15:40 4@16:50');

  // 4) Arrastar continua como antes
  await evaluate(`(() => { ${celula(5, '14:00')}.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); ${celula(5, '14:50')}.dispatchEvent(new MouseEvent('mouseenter')); document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); })()`);
  await sleep(600);
  confere('4. arrasto pinta 2', /5@14:00 5@14:50/.test(await marcadas()), true);

  if (errors.length) { falhas++; console.log('erros:', errors.join(' | ')); }
} finally { ws.close(); proc.kill(); server.close(); await sleep(400); try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {} }
console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
