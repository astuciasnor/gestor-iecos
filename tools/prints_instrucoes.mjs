// Gera os prints da Ajuda: os 8 passos de Alocacao e os de Casos especiais (o antigo
// menu "Instrucoes de preenchimento" da aba Alocar Componentes saiu em 08/11/2026).
// Abre o app num Chrome/Edge invisivel com os dados publicados (como o teste de
// fumaca), monta cada situacao e recorta so a parte da tela daquele passo.
//
// Uso (na raiz do projeto):   node tools/prints_instrucoes.mjs
// Rode de novo sempre que a aparencia dessas partes mudar.
// Saida: img/instrucoes/passo-1.png ... passo-8.png, estagio-turno.png e
// aproveitamento.png (nada mais e gravado). passo-7 (pausa) aparece em Casos especiais.
// Na Ajuda (index.html) cada imagem aparece no tamanho do recorte (o print sai em escala 2, fica nitido):
// ao gerar de novo, ajuste width/height das <img class="aj-print"> se o recorte mudar.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './bump_version.mjs';
import { sleep, startServer, findBrowser, openBrowser, cdp, loadPublishedData, seedScript } from './smoke_test.mjs';

const SAIDA = path.join(ROOT, 'img', 'instrucoes');
const FOLGA = 6; // px de margem em volta de cada recorte

// Retangulo (em px da tela) que cobre todos os seletores, com folga.
// Antes de medir, rola o primeiro elemento para o meio da tela (ex.: o campo
// Docente fica abaixo da dobra na barra lateral). O recorte usa coordenadas da
// pagina, por isso soma a rolagem da janela.
const uniao = (seletores) => `(() => {
  document.querySelector(${JSON.stringify(seletores[0])})?.scrollIntoView({ block: 'center', inline: 'nearest' });
  const rs = ${JSON.stringify(seletores)}.map((s) => document.querySelector(s)?.getBoundingClientRect()).filter(Boolean);
  if (!rs.length) return null;
  const x = Math.min(...rs.map((r) => r.left)) - ${FOLGA} + window.scrollX, y = Math.min(...rs.map((r) => r.top)) - ${FOLGA} + window.scrollY;
  const w = Math.max(...rs.map((r) => r.right)) + ${FOLGA} + window.scrollX - x, h = Math.max(...rs.map((r) => r.bottom)) + ${FOLGA} + window.scrollY - y;
  return { x: Math.max(0, x), y: Math.max(0, y), width: w, height: h };
})()`;

async function main() {
  const browserPath = findBrowser();
  if (!browserPath) throw new Error('navegador nao encontrado: instale o Chrome/Edge ou defina CHROME_PATH');
  fs.mkdirSync(SAIDA, { recursive: true });
  const data = loadPublishedData();
  const server = await startServer();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardume-prints-'));
  const { proc, ws } = await openBrowser(browserPath, profileDir);
  const errors = [];
  const { send, evaluate, waitFor } = cdp(ws, errors);

  // Recorta a uniao dos seletores e grava em img/instrucoes/<nome>.png
  const recortar = async (nome, seletores) => {
    await evaluate("(() => { const f = document.getElementById('feedback-msg'); if (f) f.style.display = 'none'; })()");
    await sleep(150);
    const clip = await evaluate(uniao(seletores));
    if (!clip) throw new Error(`${nome}: nada encontrado para ${seletores.join(', ')}`);
    const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } });
    fs.writeFileSync(path.join(SAIDA, `${nome}.png`), Buffer.from(r.result.data, 'base64'));
    console.log(`ok  ${nome}.png  (${Math.round(clip.width)} x ${Math.round(clip.height)} px)`);
  };

  try {
    await send('Runtime.enable'); await send('Page.enable');
    // Escala 2: o print fica nitido quando o navegador reduz a imagem no menu
    await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1000, deviceScaleFactor: 2, mobile: false });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: seedScript(data) });
    await send('Page.navigate', { url: `${baseUrl}/index.html?backend=local` });
    if (!(await waitFor("document.querySelectorAll('#sel-curso option').length > 0", 15000))) throw new Error('o app nao abriu');
    await sleep(1200);

    // Escolhe a primeira turma que ja tem ofertas na grade
    const turma = await evaluate(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      const pick = async (sel, v) => { sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })); await wait(600); };
      const curso = document.getElementById('sel-curso'), turma = document.getElementById('sel-turma');
      for (const c of [...curso.options].filter(o => o.value)) {
        await pick(curso, c.value);
        for (const t of [...turma.options].filter(o => o.value)) {
          await pick(turma, t.value);
          if (document.querySelectorAll('#weekly-grid .mini-card').length > 3) return t.textContent.trim();
        }
      }
      return '';
    })()`);
    if (!turma) throw new Error('nenhuma turma com ofertas nos dados publicados');

    // 1 e 2: barra lateral (periodo letivo; curso, turma e turno)
    await recortar('passo-1', ['.periodo-letivo-title', '.periodo-letivo-control']);
    await recortar('passo-2', ['.sidebar-section-title:nth-of-type(2)', '#sel-turno-oferta']);

    // Casos especiais > Estagio: campo Turno com a combinacao Manha e Noite (volta ao turno de antes)
    const turnoAntes = await evaluate(`(() => {
      const s = document.getElementById('sel-turno-oferta'), antes = s.value;
      const op = [...s.options].find((o) => o.value === 'Manhã+Noite');
      if (!op) return null;
      s.value = op.value; s.dispatchEvent(new Event('change', { bubbles: true }));
      return antes;
    })()`);
    if (turnoAntes === null) console.log('aviso: a turma nao tem Manhã e Noite; estagio-turno.png nao foi gerado');
    else {
      await sleep(800);
      await recortar('estagio-turno', ['label[for="sel-turno-oferta"]', '#sel-turno-oferta']);
      await evaluate(`(() => { const s = document.getElementById('sel-turno-oferta'); s.value = ${JSON.stringify(turnoAntes)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await sleep(800);
    }

    // Abre uma oferta para edicao (duplo clique num bloco da grade)
    await evaluate("document.querySelector('#weekly-grid .mini-card').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))");
    await sleep(1500);

    // 3: campo da componente (com o circulo da cor e o codigo/curso/CH embaixo) e o campo Docente
    await recortar('passo-3', ['label[for="inp-disciplina"]', '#inp-docente']);
    // 4: colunas Faixa e Inicio (cabecalho + Faixa 1): estreito para caber no menu
    await recortar('passo-4', ['.weekly-faixas-table thead th:first-child', '#faixa-1 td:nth-child(2)']);
    // 5: comeco da grade com o horario desenhado (2 dias, 2 aulas)
    await recortar('passo-5', ['#weekly-grid .header.top-header', '#weekly-grid .slot[data-dia="2"]:nth-child(n+16)']);

    // Faixa 2 comecando 10 dias depois do fim da Faixa 1: aparece a linha de pausa
    await evaluate(`(() => {
      const fire = (el) => { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
      const fimEl = document.getElementById('inp-data-fim-f1');
      const fim1 = fimEl.value;
      const d = new Date(fim1 + 'T12:00:00'); d.setDate(d.getDate() + 10);
      const ini2 = document.getElementById('inp-data-inicio-f2');
      ini2.value = d.toISOString().slice(0, 10);
      fire(ini2);
      // o app estende o Fim da Faixa 1 ate a vespera da Faixa 2; volta ao fim original = pausa
      fimEl.value = fim1;
      fire(fimEl);
    })()`);
    await sleep(1200);

    // 6: semana em edicao e botoes de faixa (semana anterior/proxima viraram setas na grade)
    await recortar('passo-6', ['#btn-faixa-prev', '#btn-faixa-next']);
    // 7: Faixa 1, a linha de pausa e a Faixa 2
    const temPausa = await evaluate("!document.getElementById('faixa-pausa-1').classList.contains('hidden')");
    if (!temPausa) console.log('aviso: a linha de pausa nao apareceu; o passo 7 mostra so as faixas');
    // colunas Faixa, Inicio e Fim, da Faixa 1 ate a Faixa 2 (a pausa fica no meio)
    await recortar('passo-7', ['#faixa-1 td:first-child', '#faixa-2 td:nth-child(3)']);
    // 8: Total CH, Meta CH e o botao Salvar
    await recortar('passo-8', ['.weekly-faixas-metric-total', '.weekly-faixas-metric-target']);
    await recortar('passo-8-salvar', ['#btn-add-oferta']);

    // Casos especiais > Dias livres: o aviso verde com o mapa das faixas. Montar um
    // aproveitamento de verdade depende dos dados; aqui o aviso real (mesmo HTML e CSS)
    // recebe o texto do exemplo da Ajuda (28 e 29/01) e a largura e reduzida para caber.
    await evaluate(`(() => {
      const $ = (id) => document.getElementById(id);
      $('cd-aproveitamento-texto').innerHTML = 'Aproveitando os dias livres antes de <b>Ecologia Aquática</b> (começa em 30/01/27). Preencha os horários de cada faixa:';
      $('cd-aprov-f1').innerHTML = '<b>Faixa 1:</b> 28/01/27 a 29/01/27 · 8h marcadas';
      $('cd-aprov-f2').innerHTML = '<b>Faixa 2:</b> a partir de 08/03/27 · faltam 52h';
      $('btn-aprov-f1').innerHTML = '<span class="cd-aprov-longo">Preenchendo a Faixa 1</span><span class="cd-aprov-curto">Preenchendo</span>';
      $('btn-aprov-f1').classList.add('is-ativa');
      $('btn-aprov-f2').innerHTML = '<span class="cd-aprov-longo">Preencher a Faixa 2</span><span class="cd-aprov-curto">Preencher</span>';
      $('btn-aprov-f2').classList.remove('hidden', 'is-ativa'); $('btn-aprov-f2').disabled = false;
      const barra = $('weekly-status-bar');
      barra.classList.add('tem-aproveitamento');
      barra.style.maxWidth = '1000px';
      barra.style.minHeight = '62px';
      $('cd-aviso')?.classList.add('hidden');
      // O app esconde o aviso de novo (nao ha aproveitamento de verdade): fica a mostra so para o recorte
      $('cd-aproveitamento').classList.remove('hidden');
      $('cd-aproveitamento').style.setProperty('display', 'flex', 'important');
    })()`);
    await sleep(300);
    await recortar('aproveitamento', ['#cd-aproveitamento']);

    if (errors.length) console.log(`erros no navegador: ${errors.join(' | ')}`);
  } finally {
    ws.close();
    proc.kill();
    server.close();
    await sleep(500);
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* navegador ainda segura algum arquivo */ }
  }
}

await main().catch((err) => { console.log(`FALHA ${err.message}`); process.exitCode = 1; });
