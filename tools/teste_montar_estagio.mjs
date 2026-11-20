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
  // CH do orientador (19/11/2026): vazia avisa; digitada, a nota muda.
  confere('CH do orientador vazia avisa', /Não informada/.test(await evaluate("__t.q('#me-orientador-nota').textContent")));
  await evaluate("(() => { const i = __t.q('#me-ch-orientador'); i.value = '45'; __t.fire(i, 'input'); })()");
  const notaOri = await evaluate("__t.q('#me-orientador-nota').textContent");
  confere('CH do orientador 45 h na janela', /conta 45 h/.test(notaOri), notaOri);
  await foto('1-etapas');


  // Passo 1 (20/11/2026): a soma tem que fechar para ir as Datas; opcoes em cartoes.
  await evaluate(`(async () => { const i = __t.q('[data-etapa="1"] [data-campo="horasDia"]'); i.value = '4'; __t.fire(i, 'input'); await __t.wait(300); })()`);
  const soma = await evaluate("__t.q('.me-soma').textContent");
  confere('passo 1 sem fechar: soma em vermelho e Proximo travado', /faltam|passou/.test(soma) && await evaluate("__t.q('[data-ir=\"2\"]').disabled"), soma);
  const cartoes = await evaluate("__t.qa('.me-opcao').length");
  confere('passo 1 mostra cartoes com opcoes que fecham', cartoes > 0, cartoes + ' cartoes');
  console.log('  1a opcao: ' + await evaluate("__t.q('.me-opcao').textContent.replace(/\\s+/g, ' ').trim()"));
  await foto('1b-opcoes');
  await evaluate("__t.q('.me-opcao').click()"); await sleep(300);
  const soma2 = await evaluate("__t.q('.me-soma').textContent");
  confere('clique na opcao fecha a soma', /fecha exato/.test(soma2) && !(await evaluate("__t.q('[data-ir=\"2\"]').disabled")), soma2);

  // Passo 3 antes de marcar os dias: diz exatamente o que falta
  await evaluate("__t.clicar('[data-passo=\"3\"]')");
  const pend = await evaluate("__t.qa('.me-pendencias li').map(li => li.textContent).join(' | ')");
  confere('passo 3 lista o que falta resolver', /marque os dias do encontro/.test(pend), pend);

  // Passo 2: meses um abaixo do outro, sem regua e sem placar
  await evaluate("__t.clicar('[data-ir=\"2\"]')");
  const meses = await evaluate("__t.qa('.me-cal-linha').length");
  confere('datas: um mes por linha, sem regua nem placar', meses >= 4 && !(await evaluate("!!__t.q('.me-regua') || !!__t.q('.me-placar')")), meses + ' meses');
  confere('datas: sem campos de dias e horas (so no passo 1)', !(await evaluate("!!__t.q('.me-painel [data-campo=\"diasPlanejados\"], .me-painel [data-campo=\"horasDia\"]')")));
  const ndias1 = await evaluate("Number(document.querySelector('#montar-estagio-modal [data-aba=\"0\"] small').textContent.match(/(\\d+) dias/)[1])");
  console.log('  etapa 1: ' + await evaluate(`__t.marcarDiasSeguidos(${ndias1})`));
  await evaluate("__t.clicar('[data-aba=\"2\"]')");
  const ndias3 = await evaluate("Number(document.querySelector('#montar-estagio-modal [data-aba=\"2\"] small').textContent.match(/(\\d+) dias/)[1])");
  console.log('  etapa 3: ' + await evaluate(`__t.marcarDiasSeguidos(${ndias3}, true)`));
  console.log('  abas: ' + await evaluate('__t.abas()'));
  confere('a CH fecha exata', await evaluate('__t.fechou()'), await evaluate('__t.placar()'));
  // O campo comeca 3 semanas depois do encontro: a data digitada fica e a CH ainda fecha
  await evaluate("__t.clicar('[data-aba=\"1\"]')");
  const comeco = await evaluate(`(async () => {
    const inp = __t.q('[data-campo="inicio"]');
    const ini = new Date(inp.min + 'T12:00:00'); ini.setDate(ini.getDate() + 21);
    const iso = ini.toISOString().slice(0, 10);
    inp.value = iso; __t.fire(inp, 'input', 'change'); await __t.wait(400);
    return iso + ' | campo fica: ' + __t.q('[data-campo="inicio"]').value + ' | termina ' + __t.q('.me-termina').textContent;
  })()`);
  console.log('  ' + comeco);
  const [quis] = comeco.split(' ');
  confere('a data de comeco digitada nao volta sozinha', comeco.includes('campo fica: ' + quis), comeco);
  // Tambem pelo clique: clica num dia livre depois do minimo
  const clique = await evaluate(`(async () => {
    const minimo = __t.q('[data-campo="inicio"]').min;
    const livre = __t.qa('.me-dia:not(:disabled)').map(b => b.dataset.dia).find(d => d > minimo);
    if (!livre) return 'sem dia livre';
    __t.q('[data-dia="' + livre + '"]').click(); await __t.wait(400);
    return livre + ' -> ' + __t.q('[data-campo="inicio"]').value;
  })()`);
  const [diaClicado, , ficouClique] = clique.split(' ');
  confere('clique num dia define o Comeca do campo', diaClicado === ficouClique, clique);
  confere('aba do campo: faltam 0 h', /Faltam ?0 h/.test(await evaluate('__t.abas()')), await evaluate('__t.abas()'));
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
  const caixa = await evaluate("document.getElementById('inp-ch-orientador').value + ' | visivel ' + !document.getElementById('box-ch-orientador').classList.contains('hidden')");
  confere('caixinha Orientador no cartao com 45', caixa === '45 | visivel true', caixa);

  // Salva com um docente e confere o campo gravado na alocacao.
  await evaluate(`(async () => { __t.setVal('inp-docente', 'Ana Garcês'); await __t.wait(500); document.getElementById('btn-add-oferta').click(); await __t.wait(2500); })()`);
  const gravado = await evaluate(`(() => {
    for (const key of Object.keys(localStorage).filter(k => k.startsWith('academic_plan_v1::'))) {
      const lista = JSON.parse(localStorage.getItem(key) || '[]');
      const a = lista.find(x => x.modo === 'faixas' && /EST[AÁ]GIO/i.test(x.disciplina) && x.docente === 'Ana Garcês');
      if (a) return 'chOrientador=' + a.chOrientador + ' ch=' + a.ch + ' docente=' + a.docente;
    }
    return 'nao achei | ' + (document.getElementById('status-msg')?.textContent || '') + ' | ' + [...document.querySelectorAll('.toast, .toast-warning, [class*=toast]')].map(t => t.textContent.trim()).join(' / ').slice(0, 300);
  })()`);
  confere('alocacao salva com chOrientador 45', /chOrientador=45 /.test(gravado), gravado);
  // Trocar de componente esvazia a caixinha (o valor e so da componente aberta).
  await evaluate(`(async () => { __t.setVal('inp-disciplina', ''); await __t.wait(600); })()`);
  confere('caixinha some sem componente', await evaluate("document.getElementById('box-ch-orientador').classList.contains('hidden')"));

  if (errors.length) { falhas++; console.log('Erros no navegador:', errors.join(' | ')); }
  console.log(`\nFotos em ${FOTOS}`);
  console.log(falhas ? `Ha ${falhas} FALHA(s).` : 'Tudo certo: a janela Montar estagio funciona.');
  process.exitCode = falhas ? 1 : 0;
} finally {
  ws.close(); proc.kill(); server.close();
}
