// Teste de ponta a ponta da PAUSA INTERCALADA (usa a tela como o usuario):
//  - A: Faixa 1 de 15 a 19/03, pausa de 20/03 a 04/04, Faixa 2 a partir de 05/04
//    (seg/ter, 1a e 2a aulas da tarde);
//  - B: entra NA PAUSA de A, nos mesmos horarios (22 a 30/03), pausa e volta em
//    12/04 na qua/qui.
// Confere na grade, semana a semana, que cada aula ficou no lugar certo.
// Turma vazia dos dados de exemplo: CB2023 (Tarde). Nada e gravado no projeto.
//
// Uso (na raiz do projeto):   node tools/teste_pausa_intercalada.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sleep, startServer, findBrowser, openBrowser, cdp, loadPublishedData, seedScript } from './smoke_test.mjs';

const data = loadPublishedData();
const server = await startServer();
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardume-pausa-'));
const { proc, ws } = await openBrowser(findBrowser(), profileDir);
const errors = [];
const { send, evaluate, waitFor } = cdp(ws, errors);
const dialogs = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Page.javascriptDialogOpening') dialogs.push(m.params.message.slice(0, 160));
});

// Funcoes que rodam na pagina
const HELPERS = `
window.__t = {
  wait: (ms) => new Promise(r => setTimeout(r, ms)),
  fire: (el, ...evs) => evs.forEach(e => el.dispatchEvent(new Event(e, { bubbles: true }))),
  setVal(id, v) { const el = document.getElementById(id); el.value = v; this.fire(el, 'input', 'change'); },
  faixas() {
    return [1, 2, 3].map(i => {
      const ini = document.getElementById('inp-data-inicio-f' + i).value || '-';
      const fim = document.getElementById('inp-data-fim-f' + i).value || '-';
      const pad = document.getElementById('faixa-padrao-f' + i).textContent.trim() || '-';
      const ch = document.getElementById('faixa-ch-f' + i).textContent.trim();
      return 'F' + i + ' ' + ini + '..' + fim + ' [' + pad + '] ' + ch;
    }).join(' | ') + ' | pausas: ' + [...document.querySelectorAll('.faixa-pausa-row')].filter(r => !r.classList.contains('hidden')).map(r => r.textContent.replace(/\\s+/g, ' ').trim()).join(' ; ')
      + ' | total ' + document.getElementById('weekly-faixa-total-ch').textContent + '/' + document.getElementById('weekly-faixa-target-ch').textContent;
  },
  semana() { return document.getElementById('weekly-week-label').textContent; },
  async irPara(isoSegunda) {
    const br = isoSegunda.split('-').reverse().join('/');
    for (let i = 0; i < 40; i++) {
      const lab = this.semana();
      if (lab.includes('Semana ' + br)) return true;
      const m = lab.match(/Semana (\\d{2})\\/(\\d{2})\\/(\\d{4})/);
      const atual = m ? m[3] + '-' + m[2] + '-' + m[1] : '';
      document.getElementById(atual < isoSegunda ? 'btn-week-next' : 'btn-week-prev').click();
      await this.wait(350);
    }
    return false;
  },
  celula(dia, linha) {
    const cells = [...document.querySelectorAll('#weekly-grid .slot[data-dia="' + dia + '"]')];
    return cells[linha];
  },
  async desenhar(pares) {
    const res = [];
    for (const [dia, linha] of pares) {
      const c = this.celula(dia, linha);
      if (!c) { res.push(dia + '/' + linha + ':sem-celula'); continue; }
      const antes = c.classList.contains('selected-slot');
      c.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      await this.wait(300);
      const c2 = this.celula(dia, linha);
      res.push(dia + '/' + linha + ':' + (antes ? 'ja' : '') + (c2 && c2.classList.contains('selected-slot') ? 'ok' : 'NAO'));
    }
    return res.join(' ');
  },
  // Quem aparece na grade da semana atual: { 'data hora': [disciplinas] }
  grade() {
    const out = {};
    document.querySelectorAll('#weekly-grid .slot').forEach(c => {
      const cards = [...c.querySelectorAll('.mini-card')].map(k => (k.getAttribute('title') || '').split(' - ')[0].split('\\n')[0].slice(0, 22));
      if (cards.length) out[c.dataset.date + ' ' + c.dataset.horario.slice(0, 5)] = cards;
    });
    return out;
  },
  status() { return document.querySelector('.weekly-status-title').textContent + ' :: ' + document.querySelector('.weekly-status-hint').textContent; }
};
'ok'`;

const passo = async (nome, expr) => {
  const v = await evaluate(expr);
  console.log(`- ${nome}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  return v;
};

try {
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: seedScript(data) });
  await send('Page.navigate', { url: `${baseUrl}/index.html?backend=local` });
  await waitFor("document.querySelectorAll('#sel-curso option').length > 0", 15000);
  await sleep(1500);
  await evaluate(HELPERS);

  // Turma vazia: CB2023 (Tarde)
  await passo('turma', `(async () => {
    const curso = document.getElementById('sel-curso');
    const op = [...curso.options].find(o => /bio/i.test(o.textContent));
    curso.value = op.value; __t.fire(curso, 'change'); await __t.wait(700);
    const turma = document.getElementById('sel-turma');
    const t = [...turma.options].find(o => o.value === 'CB2023' || o.textContent.startsWith('CB2023'));
    turma.value = t.value; __t.fire(turma, 'change'); await __t.wait(900);
    return op.textContent.trim() + ' / ' + t.textContent.trim() + ' | blocos na grade: ' + document.querySelectorAll('#weekly-grid .mini-card').length;
  })()`);

  // Escolhe duas componentes de CH 45-60h e dois docentes da lista
  const escolha = JSON.parse(await evaluate(`(() => {
    const ops = [...document.querySelectorAll('#list-disciplinas option')].map(o => o.value);
    const ch = (v) => parseInt((v.match(/\\((\\d+)\\s*h\\)/) || [])[1] || '0', 10);
    const boas = ops.filter(v => ch(v) >= 30 && ch(v) <= 60);
    const docs = [...document.querySelectorAll('#list-docentes option')].map(o => o.value).filter(v => !/\\//.test(v));
    return JSON.stringify({ A: boas[0], B: boas[1], dA: docs[0], dB: docs[1] });
  })()`));
  console.log('Componentes:', escolha);

  // ---------------- A: Faixa 1 em 15-19/03, pausa, Faixa 2 a partir de 05/04 ----------------
  console.log('\n== Componente A ==');
  await passo('seleciona A', `(async () => { __t.setVal('inp-disciplina', ${JSON.stringify(escolha.A)}); await __t.wait(900); __t.setVal('inp-docente', ${JSON.stringify(escolha.dA)}); await __t.wait(500); return __t.status(); })()`);
  await passo('inicio F1 = 15/03', `(async () => { __t.setVal('inp-data-inicio-f1', '2027-03-15'); await __t.wait(700); await __t.irPara('2027-03-15'); return __t.semana(); })()`);
  await passo('desenha seg/ter 14:00 e 14:50', `__t.desenhar([[1,0],[1,1],[2,0],[2,1]])`);
  await passo('faixas', `__t.faixas()`);
  await passo('inicio F2 = 05/04', `(async () => { __t.setVal('inp-data-inicio-f2', '2027-04-05'); await __t.wait(800); return __t.faixas(); })()`);
  await passo('fim F1 = 19/03 (pausa)', `(async () => { __t.setVal('inp-data-fim-f1', '2027-03-19'); await __t.wait(800); return __t.faixas(); })()`);
  await passo('vai para semana de 05/04 e confere/desenha F2', `(async () => { await __t.irPara('2027-04-05'); const r = await __t.desenhar([[1,0],[1,1],[2,0],[2,1]]); return __t.semana() + ' | ' + r + ' | ' + __t.faixas(); })()`);
  await passo('salva A', `(async () => { document.getElementById('btn-add-oferta').click(); await __t.wait(2500); return __t.status(); })()`);

  // ---------------- B: dentro da pausa de A (22/03), pausa, volta em 12/04 em qua/qui ----------------
  console.log('\n== Componente B ==');
  await passo('seleciona B', `(async () => { __t.setVal('inp-disciplina', ${JSON.stringify(escolha.B)}); await __t.wait(900); __t.setVal('inp-docente', ${JSON.stringify(escolha.dB)}); await __t.wait(500); return __t.status(); })()`);
  await passo('inicio F1 = 22/03 (na pausa de A)', `(async () => { __t.setVal('inp-data-inicio-f1', '2027-03-22'); await __t.wait(700); await __t.irPara('2027-03-22'); return __t.semana() + ' | celulas seg 14:00 livres? ' + __t.celula(1,0).classList.contains('slot-free-draw') + ' | grade: ' + JSON.stringify(__t.grade()); })()`);
  await passo('desenha seg/ter 14:00 e 14:50 (os horarios de A)', `__t.desenhar([[1,0],[1,1],[2,0],[2,1]])`);
  await passo('inicio F2 = 12/04', `(async () => { __t.setVal('inp-data-inicio-f2', '2027-04-12'); await __t.wait(800); return __t.faixas(); })()`);
  await passo('fim F1 = 30/03 (B pausa antes de A voltar)', `(async () => { __t.setVal('inp-data-fim-f1', '2027-03-30'); await __t.wait(800); return __t.faixas(); })()`);
  await passo('semana 12/04: tira seg/ter e desenha qua/qui', `(async () => { await __t.irPara('2027-04-12'); const tira = await __t.desenhar([[1,0],[1,1],[2,0],[2,1]]); const poe = await __t.desenhar([[3,0],[3,1],[4,0],[4,1]]); return 'tira ' + tira + ' | poe ' + poe + ' | ' + __t.faixas(); })()`);
  await passo('salva B', `(async () => { document.getElementById('btn-add-oferta').click(); await __t.wait(2500); return __t.status(); })()`);

  // ---------------- Conferencia na grade, semana a semana ----------------
  console.log('\n== Grade depois de salvar ==');
  const A = escolha.A.slice(0, 12);
  const B = escolha.B.slice(0, 12);
  // Esperado por semana: [componente, dias do mes] nas aulas das 14:00 e 14:50
  const esperado = {
    '2027-03-15': [[A, [15, 16]]],          // A antes da pausa
    '2027-03-22': [[B, [22, 23]]],          // B dentro da pausa de A, nos horarios de A
    '2027-03-29': [[B, [29, 30]]],          // B ate a vespera da propria pausa
    '2027-04-05': [[A, [5, 6]]],            // A volta; B esta em pausa
    '2027-04-12': [[A, [12, 13]], [B, [14, 15]]] // A seg/ter e B volta qua/qui
  };
  let falhas = 0;
  for (const [seg, lista] of Object.entries(esperado)) {
    const grade = JSON.parse(await passo(`semana ${seg}`, `(async () => { await __t.irPara('${seg}'); await __t.wait(400); return JSON.stringify(__t.grade()); })()`));
    const mes = seg.slice(0, 8);
    const quer = {};
    for (const [nome, dias] of lista) {
      for (const d of dias) for (const h of ['14:00', '14:50']) quer[`${mes}${String(d).padStart(2, '0')} ${h}`] = nome;
    }
    const ok = Object.keys(grade).length === Object.keys(quer).length
      && Object.entries(quer).every(([k, nome]) => (grade[k] || []).length === 1 && grade[k][0].startsWith(nome));
    if (!ok) falhas++;
    console.log(`  ${ok ? 'OK   ' : 'FALHA'} semana ${seg}`);
  }
  if (errors.length) { falhas++; console.log('Erros no navegador:', errors.join(' | ')); }
  console.log(falhas ? `\nHa ${falhas} FALHA(s).` : '\nTudo certo: a pausa intercalada funciona.');
  process.exitCode = falhas ? 1 : 0;
} finally {
  ws.close(); proc.kill(); server.close();
}
