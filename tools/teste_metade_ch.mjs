// Defeito "salvar guarda so parte da CH" (achado em 10/11/2026).
// Cenario: EP2024, PL1 2027. ECOLOGIA com pausa (F1 04-05/01, F2 11-22/01).
// Componente nova com o Inicio DIGITADO em 06/01 (dentro da pausa da ECOLOGIA)
// e aulas de quarta a sexta de manha. No salvar ha conflito e o Cardume empilha
// a componente depois das outras ("Havia conflito ... posicionada em sequencia").
// Antes da correcao, o Fim antigo ia junto e cortava aulas: ficava menos que a CH.
// Depois da correcao: ou salva com a CH inteira, ou (se nao cabe inteira ate o
// fim do periodo) nao salva e explica. Dois casos:
//   METODOLOGIA CIENTIFICA (45h): cabe depois da ECOLOGIA -> salva com 45h;
//   MATEMATICA BASICA (90h): nao cabe (o Carnaval come 5h) -> barra e explica.
// Uso: node tools/teste_metade_ch.mjs   (dados de teste no navegador; nao toca o servidor)
// Um caso so: DISCIPLINA="MATEMATICA BASICA" ESPERA=barra node tools/teste_metade_ch.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sleep, startServer, findBrowser, openBrowser, cdp } from './smoke_test.mjs';

const M = ['08:00 - 08:50', '08:50 - 09:40', '09:40 - 10:30', '10:50 - 11:40', '11:40 - 12:30'];
const ECO = ['2027-01-04', '2027-01-05', '2027-01-11', '2027-01-12', '2027-01-13', '2027-01-14', '2027-01-15', '2027-01-18', '2027-01-19', '2027-01-20', '2027-01-21', '2027-01-22'];
const ECOLOGIA = {
  id: 'p1', ch: 60, cor: '#bdb2ff', modo: 'faixas', modelo: 'Automatico', turmaId: 'EP2024', subGrupo: null, importado: false,
  docente: 'Ana Garcês', docentes: null, disciplina: 'ECOLOGIA', dataInicio: '2027-01-04', dataFim: '2027-01-22',
  usaSabado: false, sabadoManha: false, diasMarcados: [1, 2, 3, 4, 5], horariosOcupados: [...M],
  faixas: [
    { inicio: '2027-01-04', fim: '2027-01-05', dias: [1, 2], slots: [...M], drawnSlotsByDay: { 1: [...M], 2: [...M] } },
    { inicio: '2027-01-11', fim: '2027-01-22', dias: [1, 2, 3, 4, 5], slots: [...M], drawnSlotsByDay: { 1: [...M], 2: [...M], 3: [...M], 4: [...M], 5: [...M] } }
  ],
  executionByDate: Object.fromEntries(ECO.map((d) => [d, [...M]]))
};
const PLANO = { periodoNome: 'PL1', termStart: '2027-01-04', termEnd: '2027-03-05' };
const KEY = `academic_plan_v1::${PLANO.periodoNome}__${PLANO.termStart}__${PLANO.termEnd}`;
const DISCIPLINA = process.env.DISCIPLINA;
const ESPERA = process.env.ESPERA;   // 'salva' ou 'barra'
if (!DISCIPLINA) {
  // Roda os dois casos, cada um num navegador limpo.
  const { execFileSync } = await import('node:child_process');
  let erro = 0;
  for (const [disc, espera] of [['METODOLOGIA CIENTIFICA', 'salva'], ['MATEMATICA BASICA', 'barra']]) {
    console.log(`\n== ${disc} (espera: ${espera}) ==`);
    try {
      process.stdout.write(execFileSync(process.execPath, [process.argv[1]], { env: { ...process.env, DISCIPLINA: disc, ESPERA: espera }, encoding: 'utf8' }));
    } catch (e) { process.stdout.write(e.stdout || ''); erro = 1; }
  }
  console.log(erro ? '\nHa falhas.' : '\nTodos os casos certos.');
  process.exit(erro);
}

const seed = `sessionStorage.setItem('auth','true');
if (!localStorage.getItem('smoke_seeded')) {
  localStorage.setItem('smoke_seeded','1');
  localStorage.setItem('academic_settings', ${JSON.stringify(JSON.stringify({ periodo: PLANO.periodoNome, termStart: PLANO.termStart, termEnd: PLANO.termEnd }))});
  localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify([ECOLOGIA]))});
}`;

const server = await startServer();
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardume-metade-'));
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
    await pick('sel-periodo-letivo', o => /PL1/.test(o.textContent) && /2027/.test(o.textContent + o.value));
    await pick('sel-curso', o => /Pesca/i.test(o.textContent));
    await pick('sel-turma', o => o.value === 'EP2024');
  })()`);

  // Componente nova e Inicio digitado em 06/01 (dentro da pausa da ECOLOGIA).
  const ch = await evaluate(`(async () => {
    const w = (ms) => new Promise(r => setTimeout(r, ms));
    const d = document.getElementById('inp-disciplina');
    const opt = [...document.querySelectorAll('#list-disciplinas option, datalist option')].find(o => o.value.startsWith(${JSON.stringify(DISCIPLINA)} + ' ('));
    d.value = opt ? opt.value : ${JSON.stringify(DISCIPLINA)};
    ['input', 'change'].forEach(e => d.dispatchEvent(new Event(e, { bubbles: true }))); await w(900);
    const p = document.getElementById('inp-docente'); p.value = 'Marcos Ferreira Brabo';
    ['input', 'change'].forEach(e => p.dispatchEvent(new Event(e, { bubbles: true }))); await w(700);
    const ini = document.getElementById('inp-data-inicio-f1'); ini.value = '2027-01-06';
    ['input', 'change'].forEach(e => ini.dispatchEvent(new Event(e, { bubbles: true }))); await w(900);
    return (d.value.match(/\\((\\d+)h\\)/) || [])[1] || '';
  })()`);
  console.log(`Componente: ${DISCIPLINA} (${ch}h), inicio digitado ${await evaluate("document.getElementById('inp-data-inicio-f1').value")}`);

  // Semana de 04/01: marca quarta a sexta, as 5 aulas da manha.
  for (let i = 0; i < 10; i++) {
    const l = await evaluate("document.getElementById('weekly-week-label').textContent");
    if (/04\/01\/2027/.test(l)) break;
    await evaluate("document.getElementById('btn-week-prev').click()");
    await sleep(400);
  }
  for (const dia of [3, 4, 5]) {
    for (const h of M) {
      await evaluate(`(() => { const c = ${celula(dia, h.slice(0, 5))}; if (!c) return; c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); })()`);
      await sleep(120);
    }
  }
  await sleep(600);

  // Salvar
  await evaluate("document.getElementById('btn-add-oferta').click()");
  await sleep(1500);
  const toast = await evaluate("(document.getElementById('feedback-msg')?.textContent || '') + ' | ' + (document.getElementById('cd-aviso')?.textContent || '')");
  console.log(`Aviso: ${toast.replace(/\s+/g, ' ').trim().slice(0, 300)}`);
  const salva = await evaluate(`(() => {
    const lista = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}) || '[]');
    const a = lista.find(x => x.disciplina === ${JSON.stringify(DISCIPLINA)});
    if (!a) return null;
    const horas = Object.values(a.executionByDate || {}).reduce((s, v) => s + (Array.isArray(v) ? v.length : 0), 0);
    return { horas, ch: a.ch, inicio: a.dataInicio, fim: a.dataFim, faixas: (a.faixas || []).map(f => f.inicio + '..' + (f.fim || '')) };
  })()`);
  if (ESPERA === 'barra') {
    confere('nao salvou (nao cabe inteira)', salva === null, true);
    confere('explica que nao cabe inteira', /nao cabe inteira/i.test(toast), true);
  } else if (!salva) {
    falhas++;
    console.log('FALHA componente nao foi salva');
  } else {
    console.log(`Salva: ${salva.inicio} a ${salva.fim}, faixas ${salva.faixas.join(', ')}`);
    confere('horas gravadas = CH da componente', salva.horas, salva.ch);
    const ecoChoca = await evaluate(`(() => {
      const lista = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}) || '[]');
      const a = lista.find(x => x.disciplina === ${JSON.stringify(DISCIPLINA)});
      const e = lista.find(x => x.disciplina === 'ECOLOGIA');
      return Object.entries(a.executionByDate || {}).some(([d, s]) => (e.executionByDate[d] || []).some(h => s.includes(h)));
    })()`);
    confere('sem choque com a ECOLOGIA', ecoChoca, false);
  }
  if (errors.length) { falhas++; console.log('FALHA erros no navegador:', errors.join(' | ')); }
} finally {
  ws.close(); proc.kill(); server.close();
  await sleep(300);
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* */ }
}
console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
