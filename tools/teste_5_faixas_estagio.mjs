// Teste de ponta a ponta: 5 ETAPAS no Montar estagio viram 5 FAIXAS (21/11/2026).
//  - componente comum: a linha da Faixa 5 nao aparece (limite 4);
//  - estagio: escolhe 5 etapas (E C E C E), fecha a CH, marca as datas, aplica,
//    confere a linha da Faixa 5 no cartao e salva com 5 faixas.
// Nada e gravado no projeto.
//
// Uso (na raiz do projeto):   node tools/teste_5_faixas_estagio.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sleep, startServer, findBrowser, openBrowser, cdp, loadPublishedData, seedScript } from './smoke_test.mjs';

const FOTOS = process.env.FOTOS || fs.mkdtempSync(path.join(os.tmpdir(), 'cardume-5faixas-fotos-'));
const data = loadPublishedData();
const server = await startServer();
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardume-5faixas-'));
const { proc, ws } = await openBrowser(findBrowser(), profileDir);
const errors = [];
const { send, evaluate, waitFor } = cdp(ws, errors);

let falhas = 0;
const confere = (nome, ok, detalhe = '') => {
  if (!ok) falhas++;
  console.log(`  ${ok ? 'OK   ' : 'FALHA'} ${nome}${detalhe ? ' - ' + String(detalhe).slice(0, 300) : ''}`);
};
const foto = async (nome) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const arq = path.join(FOTOS, `${nome}.png`);
  fs.writeFileSync(arq, Buffer.from(r.result.data, 'base64'));
  console.log(`  foto: ${arq}`);
};
const HELPERS = `
window.__t = {
  wait: (ms) => new Promise(r => setTimeout(r, ms)),
  fire: (el, ...evs) => evs.forEach(e => el.dispatchEvent(new Event(e, { bubbles: true }))),
  setVal(id, v) { const el = document.getElementById(id); el.value = v; this.fire(el, 'input', 'change'); },
  modal() { return document.getElementById('montar-estagio-modal'); },
  q(sel) { return this.modal()?.querySelector(sel); },
  qa(sel) { return [...(this.modal()?.querySelectorAll(sel) || [])]; },
  async clicar(sel) { const b = this.q(sel); if (!b) return false; b.click(); await this.wait(250); return true; },
  // Marca n dias seguidos (seg, ter, qua...) a partir da primeira segunda livre do mes visto.
  async marcarDiasSeguidos(n, doFim = false) {
    let livres = this.qa('.me-dia:not(:disabled)');
    if (doFim) livres = livres.slice(-40);
    const iniIdx = livres.findIndex((b, i) => {
      const d = new Date(b.dataset.dia + 'T12:00:00');
      if (d.getDay() !== 1) return false;
      for (let k = 0; k < n; k++) {
        const x = livres[i + k]; if (!x) return false;
        const dx = new Date(x.dataset.dia + 'T12:00:00');
        if ((dx - d) / 864e5 !== k) return false;
      }
      return true;
    });
    if (iniIdx < 0) return 'sem ' + n + ' dias seguidos';
    const dias = livres.slice(iniIdx, iniIdx + n).map(b => b.dataset.dia);
    for (const d of dias) { this.q('[data-dia="' + d + '"]').click(); await this.wait(200); }
    return dias.join(', ');
  },
  placar() { return this.q('.me-totais tfoot')?.textContent.replace(/\\s+/g, ' ').trim() || ''; },
  fechou() { return !!this.q('.me-totais tfoot .me-ok'); },
  abas() { return this.qa('.me-aba').map(b => b.textContent.replace(/\\s+/g, ' ').trim()).join(' || '); },
  faixas() {
    return [1, 2, 3, 4, 5].map(i => {
      const ini = document.getElementById('inp-data-inicio-f' + i).value || '-';
      const fim = document.getElementById('inp-data-fim-f' + i).value || '-';
      const ch = document.getElementById('faixa-ch-f' + i).textContent.trim();
      return 'F' + i + ' ' + ini + '..' + fim + ' ' + ch;
    }).join(' | ') + ' | total ' + document.getElementById('weekly-faixa-total-ch').textContent + '/' + document.getElementById('weekly-faixa-target-ch').textContent;
  }
};
'ok'`;

try {
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: seedScript(data) });
  await send('Page.navigate', { url: `${baseUrl}/index.html?backend=local` });
  await waitFor("document.querySelectorAll('#sel-curso option').length > 0", 15000);
  await sleep(1500);
  await evaluate(HELPERS);

  // Turma com componente de estagio e outra componente comum na mesma turma.
  const achado = JSON.parse(await evaluate(`(async () => {
    const curso = document.getElementById('sel-curso'), turma = document.getElementById('sel-turma');
    const lista = () => [...document.querySelectorAll('#list-disciplinas option')].map(o => o.value);
    for (const c of [...curso.options].filter(o => o.value)) {
      curso.value = c.value; __t.fire(curso, 'change'); await __t.wait(600);
      for (const t of [...turma.options].filter(o => o.value)) {
        turma.value = t.value; __t.fire(turma, 'change'); await __t.wait(700);
        const est = lista().find(v => /EST[AÁ]GIO/i.test(v));
        const comum = lista().find(v => !/EST[AÁ]GIO/i.test(v));
        if (est && comum) return JSON.stringify({ turma: t.textContent.trim(), estagio: est, comum });
      }
    }
    return JSON.stringify({});
  })()`));
  console.log('Turma/componentes:', achado);
  confere('achou turma com estagio', !!achado.estagio);

  // ---- Componente comum: a linha da Faixa 5 nao aparece
  await evaluate(`(async () => { __t.setVal('inp-disciplina', ${JSON.stringify(achado.comum)}); await __t.wait(900); })()`);
  const comum = await evaluate(`(async () => {
    const vis = (i) => !document.getElementById('faixa-' + i).classList.contains('hidden');
    const datas = ['2027-03-15', '2027-03-22', '2027-03-29', '2027-04-05'];
    for (let k = 0; k < datas.length; k++) { __t.setVal('inp-data-inicio-f' + (k + 1), datas[k]); await __t.wait(300); }
    await __t.wait(600);
    return 'F4 visivel ' + vis(4) + ' | F5 visivel ' + vis(5);
  })()`);
  confere('componente comum: Faixa 5 nao aparece com a F4 iniciada', /F4 visivel true \| F5 visivel false/.test(comum), comum);
  await evaluate("document.getElementById('btn-limpar-faixas')?.click()"); await sleep(600);
  await evaluate(`(async () => { __t.setVal('inp-disciplina', ''); await __t.wait(600); })()`);

  // ---- Estagio com 5 etapas
  await evaluate(`(async () => { __t.setVal('inp-disciplina', ${JSON.stringify(achado.estagio)}); await __t.wait(900); })()`);
  await evaluate("document.getElementById('btn-montar-estagio').click()");
  confere('janela abre', await waitFor('!!document.getElementById("montar-estagio-modal")', 3000));
  const botoes = await evaluate("__t.qa('.me-seg [data-n]').map(b => b.dataset.n).join(',')");
  confere('botoes de etapas 1 a 5', botoes === '1,2,3,4,5', botoes);
  await evaluate("__t.clicar('.me-seg [data-n=\"5\"]')");
  const tipos = await evaluate("__t.qa('.me-etapa:not(.me-etapa--cab) [data-campo=\"tipo\"]').map(s => s.value).join(',')");
  confere('5 etapas: encontro, campo, encontro, campo, encontro', tipos === 'encontro,campo,encontro,campo,encontro', tipos);

  // Meses: E1/C2 no 1o mes, E3/C4 no 3o, E5 no ultimo. Encontros 2 dias x 5 h; campos 3 h/dia.
  const ch = Number(await evaluate("__t.q('.me-sub b').textContent.match(/\\d+/)[0]"));
  const plano = await evaluate(`(async () => {
    const meses = [...__t.q('[data-etapa="0"] [data-campo="mes"]').options].map(o => o.value);
    const por = async (k, campo, v) => {
      const el = __t.q('[data-etapa="' + k + '"] [data-campo="' + campo + '"]');
      el.value = v; __t.fire(el, campo === 'mes' ? 'change' : 'input'); await __t.wait(250);
    };
    await por(2, 'mes', meses[2]); await por(3, 'mes', meses[2]); await por(4, 'mes', meses[meses.length - 1]);
    for (const k of [0, 2, 4]) { await por(k, 'diasPlanejados', 2); await por(k, 'horasDia', 5); }
    const resto = ${ch} - 30;
    const c2 = resto / 6, c4 = resto / 6;
    await por(1, 'horasDia', 3); await por(1, 'diasPlanejados', c2);
    await por(3, 'horasDia', 3); await por(3, 'diasPlanejados', c4);
    return meses.join(',') + ' | campos ' + c2 + '+' + c4 + ' | ' + __t.q('.me-soma').textContent.replace(/\\s+/g, ' ').trim();
  })()`);
  console.log('  ' + plano);
  confere('passo 1 fecha exato com 5 etapas', /fecha exato/.test(plano), plano);
  await foto('5-etapas');

  await evaluate("__t.clicar('[data-ir=\"2\"]')");
  // Encontro: 2 dias seguidos (seg e ter) no mes escolhido da etapa.
  for (const [k, mes] of [[0, 0], [2, 2], [4, -1]]) {
    await evaluate(`__t.clicar('[data-aba="${k}"]')`);
    const r = await evaluate(`(async () => {
      const todos = __t.qa('.me-dia:not(:disabled)').map(b => b.dataset.dia);
      const meses = [...new Set(todos.map(d => d.slice(0, 7)))].sort();
      const m = meses[${mes} < 0 ? meses.length - 1 : ${mes}];
      const seg = todos.find(d => d.startsWith(m) && new Date(d + 'T12:00:00').getDay() === 1 && todos.includes(new Date(new Date(d + 'T12:00:00').getTime() + 864e5).toISOString().slice(0, 10)));
      if (!seg) return 'sem segunda livre em ' + m;
      const ter = new Date(new Date(seg + 'T12:00:00').getTime() + 864e5).toISOString().slice(0, 10);
      for (const d of [seg, ter]) { __t.q('[data-dia="' + d + '"]').click(); await __t.wait(250); }
      return seg + ', ' + ter;
    })()`);
    console.log(`  etapa ${k + 1}: ` + r);
  }
  for (const k of [1, 3]) {
    await evaluate(`__t.clicar('[data-aba="${k}"]')`);
    const r = await evaluate(`(async () => {
      const minimo = __t.q('[data-campo="inicio"]').min;
      const livre = __t.qa('.me-dia:not(:disabled)').map(b => b.dataset.dia).find(d => d >= minimo);
      if (!livre) return 'sem dia livre';
      __t.q('[data-dia="' + livre + '"]').click(); await __t.wait(400);
      return livre;
    })()`);
    console.log(`  etapa ${k + 1} (campo) comeca: ` + r);
  }
  console.log('  abas: ' + await evaluate('__t.abas()'));
  confere('a CH fecha exata nas datas', await evaluate('__t.fechou()'), await evaluate('__t.placar()'));
  await foto('5-datas');

  await evaluate("__t.clicar('[data-ir=\"3\"]')");
  await foto('5-faixas');
  const nlinhas = await evaluate("__t.qa('.me-tabela tbody tr:not(.me-pausa)').length");
  confere('passo 3 mostra 5 faixas', nlinhas === 5, nlinhas);
  const pend = await evaluate("__t.qa('.me-pendencias li').map(li => li.textContent).join(' | ')");
  confere('Aplicar habilitado', await evaluate("!!__t.q('[data-aplicar]') && !__t.q('[data-aplicar]').disabled"), pend);
  await evaluate("__t.clicar('[data-aplicar]')");
  await sleep(1500);
  const cartao = await evaluate('__t.faixas()');
  const m = cartao.match(/total (\d+)\/(\d+)/);
  confere('cartao com 5 faixas e a CH completa', !!m && m[1] === m[2] && /F5 \d{4}-/.test(cartao), cartao);
  confere('linha da Faixa 5 visivel', await evaluate("!document.getElementById('faixa-5').classList.contains('hidden')"));
  await foto('5-cartao');

  await evaluate(`(async () => { __t.setVal('inp-docente', 'Ana Garcês'); await __t.wait(500); document.getElementById('btn-add-oferta').click(); await __t.wait(2500); })()`);
  const gravado = await evaluate(`(() => {
    for (const key of Object.keys(localStorage).filter(k => k.startsWith('academic_plan_v1::'))) {
      const lista = JSON.parse(localStorage.getItem(key) || '[]');
      const a = lista.find(x => x.modo === 'faixas' && /EST[AÁ]GIO/i.test(x.disciplina) && x.docente === 'Ana Garcês');
      if (a) return 'ch=' + a.ch + ' faixas=' + (a.faixas || []).map(f => f.estagio || 'sem marca').join(',');
    }
    return 'nao achei';
  })()`);
  confere('alocacao salva com 5 faixas', /faixas=encontro,campo,encontro,campo,encontro$/.test(gravado), gravado);

  if (errors.length) { falhas++; console.log('Erros no navegador:', errors.join(' | ')); }
  console.log(`\nFotos em ${FOTOS}`);
  console.log(falhas ? `Ha ${falhas} FALHA(s).` : 'Tudo certo: 5 faixas no estagio funcionam.');
  process.exitCode = falhas ? 1 : 0;
} finally {
  ws.close(); proc.kill(); server.close();
}
