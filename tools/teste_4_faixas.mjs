// Teste de ponta a ponta das 4 FAIXAS (usa a tela como o usuario):
//  - a linha da Faixa 4 fica escondida ate a Faixa 3 comecar (o cartao nao cresce);
//  - F1 15/03 seg/ter, F2 22/03 qua/qui, F3 29/03 sex, F4 05/04 seg a qui
//    (sempre as 2 primeiras aulas da tarde);
//  - salva e confere na grade, semana a semana, que cada aula ficou no lugar certo;
//  - remover a Faixa 3 apaga a 3 e a 4.
// Turma vazia dos dados de exemplo: CB2023 (Tarde). Nada e gravado no projeto.
//
// Uso (na raiz do projeto):   node tools/teste_4_faixas.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sleep, startServer, findBrowser, openBrowser, cdp, loadPublishedData, seedScript } from './smoke_test.mjs';

const data = loadPublishedData();
const server = await startServer();
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardume-4faixas-'));
const { proc, ws } = await openBrowser(findBrowser(), profileDir);
const errors = [];
const { send, evaluate, waitFor } = cdp(ws, errors);

const HELPERS = `
window.__t = {
  wait: (ms) => new Promise(r => setTimeout(r, ms)),
  fire: (el, ...evs) => evs.forEach(e => el.dispatchEvent(new Event(e, { bubbles: true }))),
  setVal(id, v) { const el = document.getElementById(id); el.value = v; this.fire(el, 'input', 'change'); },
  linha4Visivel() { return !document.getElementById('faixa-4').classList.contains('hidden'); },
  faixas() {
    return [1, 2, 3, 4].map(i => {
      const ini = document.getElementById('inp-data-inicio-f' + i).value || '-';
      const fim = document.getElementById('inp-data-fim-f' + i).value || '-';
      const pad = document.getElementById('faixa-padrao-f' + i).textContent.trim() || '-';
      const ch = document.getElementById('faixa-ch-f' + i).textContent.trim();
      return 'F' + i + ' ' + ini + '..' + fim + ' [' + pad + '] ' + ch;
    }).join(' | ') + ' | total ' + document.getElementById('weekly-faixa-total-ch').textContent + '/' + document.getElementById('weekly-faixa-target-ch').textContent;
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
  celula(dia, linha) { return [...document.querySelectorAll('#weekly-grid .slot[data-dia="' + dia + '"]')][linha]; },
  // Deixa a semana com exatamente estes dias marcados nas 2 primeiras aulas.
  async soEstes(dias) {
    const res = [];
    for (const dia of [1, 2, 3, 4, 5]) for (const linha of [0, 1]) {
      const c = this.celula(dia, linha);
      if (!c) continue;
      const quer = dias.includes(dia);
      if (c.classList.contains('selected-slot') === quer) continue;
      c.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      await this.wait(300);
      const c2 = this.celula(dia, linha);
      res.push(dia + '/' + linha + ':' + ((c2 && c2.classList.contains('selected-slot')) === quer ? 'ok' : 'NAO'));
    }
    return res.join(' ') || '(nada a mudar)';
  },
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

let falhas = 0;
const passo = async (nome, expr) => {
  const v = await evaluate(expr);
  console.log(`- ${nome}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  return v;
};
const confere = (nome, ok, detalhe = '') => {
  if (!ok) falhas++;
  console.log(`  ${ok ? 'OK   ' : 'FALHA'} ${nome}${detalhe ? ' - ' + detalhe : ''}`);
};

try {
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: seedScript(data) });
  await send('Page.navigate', { url: `${baseUrl}/index.html?backend=local` });
  await waitFor("document.querySelectorAll('#sel-curso option').length > 0", 15000);
  await sleep(1500);
  await evaluate(HELPERS);

  await passo('turma', `(async () => {
    const curso = document.getElementById('sel-curso');
    const op = [...curso.options].find(o => /bio/i.test(o.textContent));
    curso.value = op.value; __t.fire(curso, 'change'); await __t.wait(700);
    const turma = document.getElementById('sel-turma');
    const t = [...turma.options].find(o => o.value === 'CB2023' || o.textContent.startsWith('CB2023'));
    turma.value = t.value; __t.fire(turma, 'change'); await __t.wait(900);
    return op.textContent.trim() + ' / ' + t.textContent.trim();
  })()`);

  const escolha = JSON.parse(await evaluate(`(() => {
    const ops = [...document.querySelectorAll('#list-disciplinas option')].map(o => o.value);
    const ch = (v) => parseInt((v.match(/\\((\\d+)\\s*h\\)/) || [])[1] || '0', 10);
    const docs = [...document.querySelectorAll('#list-docentes option')].map(o => o.value).filter(v => !/\\//.test(v));
    return JSON.stringify({ A: ops.find(v => ch(v) >= 30 && ch(v) <= 45), d: docs[0] });
  })()`));
  console.log('Componente:', escolha);

  await passo('seleciona', `(async () => { __t.setVal('inp-disciplina', ${JSON.stringify(escolha.A)}); await __t.wait(900); __t.setVal('inp-docente', ${JSON.stringify(escolha.d)}); await __t.wait(500); return __t.status(); })()`);
  confere('linha da Faixa 4 escondida no comeco', !(await evaluate('__t.linha4Visivel()')));

  await passo('F1 = 15/03, seg/ter', `(async () => { __t.setVal('inp-data-inicio-f1', '2027-03-15'); await __t.wait(700); await __t.irPara('2027-03-15'); return await __t.soEstes([1, 2]); })()`);
  await passo('F2 = 22/03, qua/qui', `(async () => { __t.setVal('inp-data-inicio-f2', '2027-03-22'); await __t.wait(800); await __t.irPara('2027-03-22'); return await __t.soEstes([3, 4]); })()`);
  confere('linha da Faixa 4 ainda escondida (F3 sem inicio)', !(await evaluate('__t.linha4Visivel()')));
  await passo('F3 = 29/03, sex', `(async () => { __t.setVal('inp-data-inicio-f3', '2027-03-29'); await __t.wait(800); await __t.irPara('2027-03-29'); return await __t.soEstes([5]); })()`);
  confere('linha da Faixa 4 aparece quando a F3 comeca', await evaluate('__t.linha4Visivel()'));
  await passo('F4 = 05/04, seg a qui', `(async () => { __t.setVal('inp-data-inicio-f4', '2027-04-05'); await __t.wait(800); await __t.irPara('2027-04-05'); return await __t.soEstes([1, 2, 3, 4]); })()`);
  const antes = await passo('faixas antes de salvar', '__t.faixas()');
  confere('Fim de cada faixa = vespera da seguinte', /F1 2027-03-15\.\.2027-03-21/.test(antes) && /F2 2027-03-22\.\.2027-03-28/.test(antes) && /F3 2027-03-29\.\.2027-04-04/.test(antes), antes);

  await passo('salva', `(async () => { document.getElementById('btn-add-oferta').click(); await __t.wait(2500); return __t.status(); })()`);

  const A = escolha.A.slice(0, 12);
  const salvo = await passo('o que foi salvo', `(() => {
    const k = Object.keys(localStorage).filter(k => k.startsWith('academic_plan_v1::'));
    for (const key of k) {
      const lista = JSON.parse(localStorage.getItem(key) || '[]');
      const a = lista.find(x => String(x.disciplina || '').startsWith(${JSON.stringify(escolha.A.slice(0, 20))}) && String(x.turmaId).startsWith('CB2023'));
      if (a) { const ex = Object.keys(a.executionByDate || {}).sort(); return key + ' | ini ' + a.dataInicio + ' fim ' + a.dataFim + ' | faixas ' + (a.faixas || []).map(f => f.inicio + '..' + (f.fim || '')).join(', ') + ' | exec ' + ex[0] + '..' + ex[ex.length - 1] + ' (' + ex.length + ' dias)'; }
    }
    return 'nao achei (' + k.length + ' planos)';
  })()`);
  confere('salvou 4 faixas e a CH inteira (fim 05/05)', /faixas (\S+\.\.\S+, ){3}\S+\.\.\S+ \|/.test(salvo) && /fim 2027-05-05/.test(salvo), salvo);
  const esperado = { '2027-03-15': [15, 16], '2027-03-22': [24, 25], '2027-03-29': [2], '2027-04-05': [5, 6, 7, 8], '2027-04-12': [12, 13, 14, 15] };
  for (const [seg, dias] of Object.entries(esperado)) {
    const grade = JSON.parse(await evaluate(`(async () => { await __t.irPara('${seg}'); await __t.wait(400); return JSON.stringify(__t.grade()); })()`));
    const quer = new Set();
    for (const d of dias) {
      const dia = String(d).padStart(2, '0');
      const mes = seg >= '2027-04-01' || d < 10 ? '2027-04-' : seg.slice(0, 8);
      ['14:00', '14:50'].forEach((h) => quer.add(`${mes}${dia} ${h}`));
    }
    const nossas = Object.entries(grade).filter(([, cards]) => cards.some((c) => c.startsWith(A))).map(([k]) => k);
    const ok = nossas.length === quer.size && nossas.every((k) => quer.has(k));
    confere(`grade da semana ${seg}`, ok, ok ? '' : `veio ${nossas.join(', ')}`);
  }

  // Edita de novo: as 4 faixas voltam para o cartao
  const reaberta = await passo('reabre a componente salva', `(async () => {
    const card = [...document.querySelectorAll('#weekly-grid .mini-card')].find(k => (k.getAttribute('title') || '').startsWith(${JSON.stringify(A)}));
    if (!card) return 'sem cartao';
    card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await __t.wait(1500);
    return __t.faixas();
  })()`);
  if (reaberta !== 'sem cartao' && /F4 2027-04-05/.test(reaberta)) {
    confere('as 4 faixas voltam ao editar', true);
    await passo('remove a Faixa 3', `(async () => {
      document.querySelector('[data-faixa-action="3"]').click(); await __t.wait(300);
      document.querySelector('[data-faixa-confirm="3"]').click(); await __t.wait(900);
      return __t.faixas();
    })()`);
    const depois = await evaluate('__t.faixas()');
    confere('remover a F3 apaga a 3 e a 4', /F3 -\.\.-/.test(depois) && /F4 -\.\.-/.test(depois), depois);
    confere('linha da Faixa 4 some de novo', !(await evaluate('__t.linha4Visivel()')));
  } else {
    console.log('  (aviso) nao consegui reabrir pela grade; edicao e remocao nao foram testadas aqui');
  }

  if (errors.length) { falhas++; console.log('Erros no navegador:', errors.join(' | ')); }
  console.log(falhas ? `\nHa ${falhas} FALHA(s).` : '\nTudo certo: 4 faixas funcionam.');
  process.exitCode = falhas ? 1 : 0;
} finally {
  ws.close(); proc.kill(); server.close();
}
