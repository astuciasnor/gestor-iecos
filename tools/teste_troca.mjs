// Trocar, Desfazer troca e "Como resolver?" no navegador (dados de teste; nao toca o servidor).
// 1. EP2025, PL2 2027, Lista de Ofertas: Trocar CARTOGRAFIA <-> LIMNOLOGIA (em sequencia).
//    Confere: LIMNOLOGIA passa a comecar onde a CARTOGRAFIA comecava, a CARTOGRAFIA
//    vem logo depois, nenhuma perde horas e o botao "Desfazer troca" aparece.
// 2. Desfazer troca: as ofertas do EP2025 voltam exatamente como eram.
// 3. Choque de professor criado nos dados (TECNOLOGIA DO PESCADO do EP2025 passa a
//    ser do Marcos, que tem aula no EP2027 no mesmo horario): Calendario Docente do
//    Marcos > "Como resolver?" tem de trazer sugestoes.
// Uso (na raiz): node tools/teste_troca.mjs [saida.json] [--comparar antes.json]
// A saida guarda datas e textos, para conferir que uma refatoracao nao mudou nada.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sleep, startServer, findBrowser, openBrowser, cdp } from './smoke_test.mjs';
import { ROOT } from './bump_version.mjs';

const saida = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(os.tmpdir(), 'cardume-teste-troca.json');
const agenda = JSON.parse(fs.readFileSync(process.env.DADOS || path.join(ROOT, 'alocacoes_publicas.json'), 'utf8'));
const pubs = agenda.publications.filter((p) => p?.plan?.key && Array.isArray(p.allocations));
const pl2 = pubs.find((p) => p.plan.key.startsWith('PL2__2027'));
const KEY = 'academic_plan_v1::' + pl2.plan.key;
const PROF = 'Marcos Ferreira Brabo';
// Choque de professor de proposito (so nesta copia dos dados).
const pl2Alocs = pl2.allocations.map((a) => (a.turmaId === 'EP2025' && a.disciplina === 'TECNOLOGIA DO PESCADO'
  ? { ...a, docente: PROF, docentes: null } : a));
const seed = `sessionStorage.setItem('auth', 'true');
if (!localStorage.getItem('troca_seeded')) {
  localStorage.setItem('troca_seeded', '1');
  localStorage.setItem('academic_settings', ${JSON.stringify(JSON.stringify({ periodo: pl2.plan.periodo, termStart: pl2.plan.termStart, termEnd: pl2.plan.termEnd }))});
  ${pubs.map((p) => `localStorage.setItem(${JSON.stringify('academic_plan_v1::' + p.plan.key)}, ${JSON.stringify(JSON.stringify(p === pl2 ? pl2Alocs : p.allocations))});`).join('\n  ')}
}`;

const lerEP2025 = `(() => {
  const lista = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}) || '[]').filter(a => a.turmaId === 'EP2025');
  const ordena = (o) => Array.isArray(o) ? o.map(ordena) : (o && typeof o === 'object') ? Object.fromEntries(Object.keys(o).sort().map(k => [k, ordena(o[k])])) : o;
  return lista.map(a => ({ id: a.id, disciplina: a.disciplina, inicio: a.dataInicio, fim: a.dataFim,
    horas: Object.values(a.executionByDate || {}).reduce((s, v) => s + (v || []).length, 0), json: JSON.stringify(ordena(a)) }))
    .sort((x, y) => String(x.id).localeCompare(String(y.id)));
})()`;

const errors = [];
let falhas = 0;
const confere = (rotulo, ok, detalhe = '') => {
  if (!ok) falhas++;
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${rotulo}${detalhe ? ': ' + detalhe : ''}`);
};
const server = await startServer();
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardume-troca-'));
const { proc, ws } = await openBrowser(findBrowser(), profileDir);
const { send, evaluate, waitFor } = cdp(ws, errors);
const foto = {};
try {
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: seed });
  await send('Page.navigate', { url: `${baseUrl}/index.html?backend=local` });
  await waitFor("document.querySelectorAll('#sel-periodo-letivo option').length > 1", 40000);
  await sleep(1200);
  await evaluate(`(async () => {
    window.confirm = () => true;   // as perguntas do Trocar e do Desfazer
    const w = (ms) => new Promise(r => setTimeout(r, ms));
    const pick = async (id, pred) => { const s = document.getElementById(id); const o = [...s.options].find(pred); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); await w(700); };
    await pick('sel-periodo-letivo', o => /PL2/.test(o.textContent) && /2027/.test(o.textContent + o.value));
    await pick('sel-curso', o => /Pesca/i.test(o.textContent));
    await pick('sel-turma', o => o.value === 'EP2025');
    document.getElementById('tabbtn-list').click(); await w(800);
  })()`);

  // 1. Trocar CARTOGRAFIA <-> LIMNOLOGIA
  const antes = await evaluate(lerEP2025);
  const carto0 = antes.find((a) => a.disciplina.startsWith('CARTOGRAFIA'));
  const limno0 = antes.find((a) => a.disciplina === 'LIMNOLOGIA');
  confere('dados: CARTOGRAFIA e LIMNOLOGIA no EP2025', !!carto0 && !!limno0);
  const janela = await evaluate(`(async () => {
    const w = (ms) => new Promise(r => setTimeout(r, ms));
    const tr = [...document.querySelectorAll('#tab-list tr')].find(t => /CARTOGRAFIA/.test(t.textContent) && t.querySelector('.btn-swap-row'));
    if (!tr) return null;
    tr.querySelector('.btn-swap-row').click(); await w(500);
    const modal = document.getElementById('troca-ordem-modal');
    if (!modal) return null;
    const texto = modal.innerText;
    const opcao = [...modal.querySelectorAll('.troca-opcao')].find(b => /^LIMNOLOGIA/.test(b.querySelector('strong')?.textContent || ''));
    if (!opcao || opcao.disabled) return { texto, clicou: false };
    opcao.click(); await w(1500);
    return { texto, clicou: true, fechou: !document.getElementById('troca-ordem-modal') };
  })()`);
  confere('janela Trocar abriu', !!janela);
  confere('LIMNOLOGIA pode trocar e a troca foi aplicada', !!janela?.clicou && !!janela?.fechou);
  foto.janela = janela?.texto || '';
  const depois = await evaluate(lerEP2025);
  const carto1 = depois.find((a) => a.id === carto0?.id);
  const limno1 = depois.find((a) => a.id === limno0?.id);
  foto.depoisDaTroca = depois.map(({ disciplina, inicio, fim, horas }) => ({ disciplina, inicio, fim, horas }));
  // Em sequencia: a que vinha depois passa a comecar onde a primeira comecava,
  // e a primeira vem logo depois dela (vale para qualquer ordem nos dados).
  const [primeira0, segunda0] = carto0.inicio <= limno0.inicio ? [carto0, limno0] : [limno0, carto0];
  const primeira1 = depois.find((a) => a.id === primeira0.id);
  const segunda1 = depois.find((a) => a.id === segunda0.id);
  confere(`${segunda0.disciplina} comeca onde ${primeira0.disciplina} comecava`, segunda1?.inicio === primeira0.inicio, `${segunda1?.inicio} (antes ${primeira0.inicio})`);
  confere(`${primeira0.disciplina} vem depois`, !!primeira1 && !!segunda1 && primeira1.inicio > segunda1.fim, `${primeira1?.inicio} > ${segunda1?.fim}`);
  confere('nenhuma perdeu horas', carto1?.horas === carto0?.horas && limno1?.horas === limno0?.horas, `${carto1?.horas}h e ${limno1?.horas}h`);
  const botaoVisivel = await evaluate("!document.getElementById('btn-undo-troca')?.classList.contains('hidden')");
  confere('botao "Desfazer troca" apareceu', botaoVisivel);

  // 2. Desfazer troca
  await evaluate("document.getElementById('btn-undo-troca').click()");
  await sleep(1500);
  const desfeito = await evaluate(lerEP2025);
  const iguais = JSON.stringify(desfeito.map((a) => a.json)) === JSON.stringify(antes.map((a) => a.json));
  confere('Desfazer troca: EP2025 igual ao de antes', iguais);
  confere('botao "Desfazer troca" sumiu', await evaluate("document.getElementById('btn-undo-troca')?.classList.contains('hidden')"));

  // 3. "Como resolver?" no Calendario Docente
  await evaluate("document.getElementById('tabbtn-teacher').click()");
  await sleep(1200);
  await evaluate(`(() => { const i = document.getElementById('sel-view-docente'); i.value = ${JSON.stringify(PROF)}; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(2500);
  const botoes = await evaluate("document.querySelectorAll('#tab-teacher .btn-como-resolver').length");
  confere('choque do Marcos com botao "Como resolver?"', botoes > 0, `${botoes} botao(oes)`);
  const sugestoes = await evaluate(`(async () => {
    const w = (ms) => new Promise(r => setTimeout(r, ms));
    const b = document.querySelector('#tab-teacher .btn-como-resolver');
    if (!b) return '';
    const antes = document.getElementById('tab-teacher').innerText;
    b.click(); await w(4000);
    const depois = document.getElementById('tab-teacher').innerText;
    return depois.length > antes.length ? depois.slice(depois.indexOf('Fechar')) : '';
  })()`);
  foto.comoResolver = sugestoes.replace(/\s+/g, ' ').trim().slice(0, 1500);
  confere('"Como resolver?" mostrou sugestoes', /Troque a ordem|comece|converse|Não achei/i.test(foto.comoResolver), foto.comoResolver.slice(0, 160));

  if (errors.length) { falhas++; console.log('FALHA erros no navegador:', errors.join(' | ')); }
  foto.erros = errors;
  fs.writeFileSync(saida, JSON.stringify(foto, null, 1));
  console.log('resultado gravado:', saida);
} finally {
  ws.close(); proc.kill(); server.close();
  await sleep(300);
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* */ }
}

// --comparar antes.json: o resultado tem de ser igual ao de antes.
const iComparar = process.argv.indexOf('--comparar');
if (iComparar > 0) {
  const a = fs.readFileSync(process.argv[iComparar + 1], 'utf8');
  const b = fs.readFileSync(saida, 'utf8');
  const igual = a === b;
  if (!igual) falhas++;
  console.log(igual ? 'IGUAL ao resultado de antes.' : 'DIFERENTE do resultado de antes.');
}
console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo certo: Trocar, Desfazer troca e Como resolver? funcionam.');
process.exit(falhas ? 1 : 0);
