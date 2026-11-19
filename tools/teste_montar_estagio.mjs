// Teste de ponta a ponta da janela MONTAR ESTAGIO (usa a tela como o usuario):
//  - acha uma turma com componente de estagio e confere o botao no cartao de faixas;
//  - abre a janela, marca os dias dos encontros, ajusta o estagio em campo ate a CH
//    fechar exata, aplica, confere as faixas no cartao e salva;
//  - tira uma foto de cada passo (pasta indicada em FOTOS, ou a pasta temporaria).
// Nada e gravado no projeto.
//
// Uso (na raiz do projeto):   node tools/teste_montar_estagio.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sleep, startServer, findBrowser, openBrowser, cdp, loadPublishedData, seedScript } from './smoke_test.mjs';

const FOTOS = process.env.FOTOS || fs.mkdtempSync(path.join(os.tmpdir(), 'cardume-estagio-fotos-'));
const data = loadPublishedData();
const server = await startServer();
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardume-estagio-'));
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
  async marcarDiasSeguidos(n) {
    const livres = this.qa('.me-dia:not(:disabled)');
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
  placar() { return this.qa('.me-placar b').map(b => b.textContent).join(' | '); },
  fechou() { return !!this.q('.me-placar--ok'); },
  faixas() {
    return [1, 2, 3, 4].map(i => {
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

  // Turma com componente de estagio (prefere CB2024, da manha).
  const achado = JSON.parse(await evaluate(`(async () => {
    const curso = document.getElementById('sel-curso'), turma = document.getElementById('sel-turma');
    const estagios = () => [...document.querySelectorAll('#list-disciplinas option')].map(o => o.value).filter(v => /EST[AÁ]GIO/i.test(v));
    const cursos = [...curso.options].filter(o => o.value).sort((a, b) => /bio/i.test(b.textContent) - /bio/i.test(a.textContent));
    for (const c of cursos) {
      curso.value = c.value; __t.fire(curso, 'change'); await __t.wait(600);
      const turmas = [...turma.options].filter(o => o.value).sort((a, b) => b.value.startsWith('CB2024') - a.value.startsWith('CB2024'));
      for (const t of turmas) {
        turma.value = t.value; __t.fire(turma, 'change'); await __t.wait(700);
        const lista = estagios();
        if (lista.length) return JSON.stringify({ turma: t.textContent.trim(), componente: lista[0] });
      }
    }
    return JSON.stringify({});
  })()`));
  console.log('Turma/componente:', achado);
  confere('achou turma com estagio', !!achado.componente);

  confere('botao escondido sem componente', await evaluate("document.getElementById('btn-montar-estagio').classList.contains('hidden')"));
  await evaluate(`(async () => { __t.setVal('inp-disciplina', ${JSON.stringify(achado.componente)}); await __t.wait(900); })()`);
  confere('botao aparece com componente de estagio', !(await evaluate("document.getElementById('btn-montar-estagio').classList.contains('hidden')")));
  await foto('0-cartao-com-botao');

  await evaluate("document.getElementById('btn-montar-estagio').click()");
  confere('janela abre', await waitFor('!!document.getElementById("montar-estagio-modal")', 3000));
  console.log('  ' + await evaluate("__t.q('.me-sub').textContent"));
  await foto('1-etapas');

  // Sugestao: campo da Etapa 2 em Manha e Tarde, 8 h -> botao "Usar so Manha, 6 h"
  await evaluate(`(async () => {
    const linha = __t.q('[data-etapa="1"]');
    const turno = linha.querySelector('[data-campo="turno"]'); turno.value = 'Manhã+Tarde'; __t.fire(turno, 'change'); await __t.wait(300);
    const h = __t.q('[data-etapa="1"] [data-campo="horasDia"]'); h.value = '8'; __t.fire(h, 'input'); await __t.wait(300);
  })()`);
  confere('sugestao aparece (campo na Manha e Tarde, 8 h)', await evaluate("!!__t.q('[data-sugestao=\"1\"]')"));
  await foto('1b-sugestao');
  await evaluate("__t.clicar('[data-sugestao=\"1\"]')");
  const depoisSug = await evaluate(`(() => { const l = __t.q('[data-etapa="1"]'); return l.querySelector('[data-campo="turno"]').value + ' ' + l.querySelector('[data-campo="horasDia"]').value; })()`);
  const maxManha = await evaluate("Math.min(6, Number(__t.q('[data-etapa=\"1\"] [data-campo=\"horasDia\"]').max))");
  confere('botao da sugestao troca para so a Manha, ate 6 h', depoisSug === 'Manhã ' + maxManha, depoisSug);
  // volta ao contraturno para o resto do teste
  await evaluate(`(async () => {
    const turno = __t.q('[data-etapa="1"] [data-campo="turno"]'); turno.value = 'Noite'; __t.fire(turno, 'change'); await __t.wait(300);
    const h = __t.q('[data-etapa="1"] [data-campo="horasDia"]'); h.value = '3'; __t.fire(h, 'input'); await __t.wait(300);
  })()`);

  // Passo 2: encontro 1 (3 dias no 1o mes) e encontro 3 (3 dias no ultimo mes)
  await evaluate("__t.clicar('[data-ir=\"2\"]')");
  console.log('  etapa 1:', await evaluate('__t.marcarDiasSeguidos(3)'));
  await evaluate("__t.clicar('[data-aba=\"2\"]')");
  // ultimo mes pode ser curto (PL acaba no meio): volta um mes se nao der
  let r3 = await evaluate('__t.marcarDiasSeguidos(3)');
  if (r3.startsWith('sem')) { await evaluate("__t.clicar('[data-mes-delta=\"-1\"]')"); r3 = await evaluate('__t.marcarDiasSeguidos(3)'); }
  console.log('  etapa 3:', r3);
  // Campo (etapa 2): procura dias da semana e horas que fechem a CH exata
  await evaluate("__t.clicar('[data-aba=\"1\"]')");
  const ajuste = await evaluate(`(async () => {
    const combos = [[1, 3], [2, 4], [1, 3, 5], [1, 2, 3, 4, 5]];
    for (const dias of combos) {
      for (const x of [1, 2, 3, 4, 5, 6]) {
        const chip = __t.q('[data-semana="' + x + '"]');
        if ((chip.getAttribute('aria-pressed') === 'true') !== dias.includes(x)) { chip.click(); await __t.wait(150); }
      }
      const inp = __t.q('.me-campos input[type=number]');
      for (let h = Number(inp.max); h >= 1; h--) {
        inp.value = String(h); __t.fire(inp, 'input'); await __t.wait(120);
        if (__t.fechou()) return 'fechou com ' + dias.join('/') + ' x ' + h + ' h';
      }
    }
    return 'nao fechou: ' + __t.placar();
  })()`);
  console.log('  campo:', ajuste);
  confere('a CH fecha exata', await evaluate('__t.fechou()'), await evaluate('__t.placar()'));
  // O campo comeca 3 semanas depois do encontro: a data digitada fica e a CH ainda fecha
  await evaluate("__t.clicar('[data-aba=\"1\"]')");
  const comeco = await evaluate(`(async () => {
    const inp = __t.q('[data-campo="inicio"]');
    const ini = new Date(inp.min + 'T12:00:00'); ini.setDate(ini.getDate() + 21);
    const iso = ini.toISOString().slice(0, 10);
    inp.value = iso; __t.fire(inp, 'input', 'change'); await __t.wait(400);
    return iso + ' | campo fica: ' + __t.q('[data-campo="inicio"]').value + ' | ' + __t.q('.me-resumo').textContent.trim();
  })()`);
  console.log('  ' + comeco);
  const [quis] = comeco.split(' ');
  confere('a data de comeco digitada nao volta sozinha', comeco.includes('campo fica: ' + quis), comeco);
  await foto('2-datas');

  await evaluate("__t.clicar('[data-ir=\"3\"]')");
  await foto('3-faixas');
  confere('Aplicar habilitado', await evaluate("!__t.q('[data-aplicar]').disabled"));
  const linhas = await evaluate("__t.qa('.me-tabela tbody tr:not(.me-pausa)').map(tr => tr.textContent.replace(/\\s+/g, ' ').trim()).join(' || ')");
  console.log('  ' + linhas);

  await evaluate("__t.clicar('[data-aplicar]')");
  await sleep(1500);
  confere('janela fecha ao aplicar', !(await evaluate('!!__t.modal()')));
  const cartao = await evaluate('__t.faixas()');
  const m = cartao.match(/total (\d+)\/(\d+)/);
  confere('cartao com as faixas e a CH completa', m && m[1] === m[2], cartao);
  console.log('  turno da barra lateral: ' + await evaluate("document.getElementById('sel-turno-oferta').selectedOptions[0]?.textContent"));
  await foto('4-cartao-depois');

  if (errors.length) { falhas++; console.log('Erros no navegador:', errors.join(' | ')); }
  console.log(`\nFotos em ${FOTOS}`);
  console.log(falhas ? `Ha ${falhas} FALHA(s).` : 'Tudo certo: a janela Montar estagio funciona.');
  process.exitCode = falhas ? 1 : 0;
} finally {
  ws.close(); proc.kill(); server.close();
}
