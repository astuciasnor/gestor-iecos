// Inicio da Faixa 1 pelo clique, em turma de dois turnos (EP2027C, Cameta) e de
// um turno (EP2027, tarde). Confere as regras combinadas em 09/11/2026:
//  - a sugestao vem depois da ultima componente (sabado no meio de outra nao conta;
//    sabado so entra se estiver totalmente livre);
//  - antes da sugestao o clique vale (aproveitamento: Fim na vespera da componente
//    que vem pela frente nesse horario, como pausa; o numero 2 retoma na sugestao);
//  - o primeiro clique, na semana sugerida ou depois, define o inicio;
//  - na mesma semana, um dia mais cedo recua o inicio; desmarcar tudo volta a sugestao;
//  - caminho manual: Inicio e Fim digitados antes da sugestao + retomada pela
//    Faixa 2 = pausa, gravada certa; depois de salvar a tabela mostra as datas
//    gravadas e so limpa se essa componente for excluida ou desfeita.
// Uso: node tools/teste_inicio_clique.mjs   (dados de teste no navegador; nao toca o servidor)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sleep, startServer, findBrowser, openBrowser, cdp } from './smoke_test.mjs';

const M = ['08:00 - 08:50', '08:50 - 09:40', '09:40 - 10:30', '10:50 - 11:40', '11:40 - 12:30'];
const T = ['14:00 - 14:50', '14:50 - 15:40', '15:40 - 16:30', '16:50 - 17:40', '17:40 - 18:30'];
const aloc = (id, turmaId, disciplina, ch, cor, docente, inicio, fim, byDay) => ({
  id, ch, cor, modo: 'faixas', modelo: 'Automatico', turmaId, subGrupo: null, importado: false,
  docente, docentes: null, disciplina, dataInicio: inicio, dataFim: fim,
  usaSabado: Object.keys(byDay).includes('6'), sabadoManha: false,
  diasMarcados: Object.keys(byDay).map(Number), horariosOcupados: [...new Set(Object.values(byDay).flat())],
  faixas: [{ inicio, fim, dias: Object.keys(byDay).map(Number), slots: [...new Set(Object.values(byDay).flat())], drawnSlotsByDay: byDay }],
  executionByDate: {}
});

const CENARIOS = {
  doisTurnos: {
    turma: 'EP2027C', periodo: /PL3/, termStart: '2027-06-28', termEnd: '2027-08-24', periodoNome: 'PL3',
    hora: '08:00', hora2: '08:50',
    allocs: [
      aloc('a2', 'EP2027C', 'QUIMICA GERAL E ANALITICA', 90, '#bdb2ff', 'Carlos Alberto Martins Cordeiro', '2027-07-05', '2027-07-13',
        { 1: [...M, ...T], 2: [...M, ...T], 3: [...M, ...T], 4: [...M, ...T], 5: [...M, ...T], 6: [...M] }),
      aloc('a3', 'EP2027C', 'INGLES TECNICO', 60, '#ffadad', 'Lorena', '2027-07-16', '2027-07-23',
        { 1: [...M, ...T], 2: [...M, ...T], 3: [...M, ...T], 4: [...M, ...T], 5: [...M, ...T] })
    ],
    sugestao: '2027-07-24',
    semanaAntes: '2027-07-12', diaAntes: 3,             // qua 14/07 (livre, antes da sugestao)
    semanaDepois: '2027-07-26', diaDepois: 3, diaRecuo: 1, // qua 28 -> seg 26
    manual: { ini: '2027-07-14', fim: '2027-07-15', dias: [3, 4], volta: '2027-07-26' }
  },
  umTurno: {
    turma: 'EP2027', periodo: /PL4/, termStart: '2027-08-23', termEnd: '2027-12-23', periodoNome: 'PL4',
    hora: '14:00', hora2: '14:50',
    allocs: [
      aloc('b1', 'EP2027', 'QUIMICA GERAL E ANALITICA', 90, '#bdb2ff', 'Carlos Alberto Martins Cordeiro', '2027-08-23', '2027-08-27',
        { 1: [...T], 2: [...T], 3: [...T], 4: [...T], 5: [...T] }),
      aloc('b2', 'EP2027', 'INGLES TECNICO', 60, '#ffadad', 'Lorena', '2027-09-02', '2027-09-08',
        { 1: [...T], 2: [...T], 3: [...T], 4: [...T], 5: [...T] })
    ],
    sugestao: '2027-09-09',
    semanaAntes: '2027-08-30', diaAntes: 1,             // seg 30/08 (livre, antes da sugestao)
    semanaDepois: '2027-09-13', diaDepois: 3, diaRecuo: 1, // qua 15 -> seg 13
    manual: { ini: '2027-08-30', fim: '2027-09-01', dias: [1, 2, 3], volta: '2027-09-13' }
  },
  // Caso do print (09/11/2026): Economia seg-qua; qui-sex com 3 aulas de outra
  // componente (as 2 ultimas livres); Informatica comeca no sabado de MANHA.
  // Clicar 16:50 da quinta: a parceira de 3 aulas nao para a faixa; o Fim e a
  // vespera do sabado da Informatica (sexta 27/08).
  aproveitamento: {
    fluxo: 'aproveitamento',
    turma: 'EP2027', periodo: /PL4/, termStart: '2027-08-23', termEnd: '2027-12-23', periodoNome: 'PL4',
    sugestao: '2027-09-11',   // sabado livre depois da Informatica (termina sex 10/09)
    allocs: [
      aloc('c1', 'EP2027', 'ECONOMIA PESQUEIRA', 15, '#4dabf7', 'Colin', '2027-08-23', '2027-08-25',
        { 1: [...T], 2: [...T], 3: [...T] }),
      aloc('c2', 'EP2027', 'DESENHO TECNICO', 6, '#ffd6a5', 'Lorena', '2027-08-26', '2027-08-27',
        { 4: T.slice(0, 3), 5: T.slice(0, 3) }),
      { ...aloc('c3', 'EP2027', 'INFORMATICA BASICA', 60, '#3bf0e0', 'Dhemersson', '2027-08-28', '2027-09-10',
        { 1: [...T], 2: [...T], 3: [...T], 4: [...T], 5: [...T], 6: [...M] }), sabadoManha: true }
    ]
  }
};

let falhasTotais = 0;
async function rodar(CENARIO) {
const CFG = CENARIOS[CENARIO];
const KEY = `academic_plan_v1::${CFG.periodoNome}__${CFG.termStart}__${CFG.termEnd}`;
const seed = `sessionStorage.setItem('auth','true');
if (!localStorage.getItem('smoke_seeded')) {
  localStorage.setItem('smoke_seeded','1');
  localStorage.setItem('academic_settings', ${JSON.stringify(JSON.stringify({ periodo: CFG.periodoNome, termStart: CFG.termStart, termEnd: CFG.termEnd }))});
  localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(CFG.allocs))});
}`;

const server = await startServer();
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardume-clique-'));
const { proc, ws } = await openBrowser(findBrowser(), profileDir);
const errors = [];
const { send, evaluate, waitFor } = cdp(ws, errors);
let falhas = 0;
const confere = (rotulo, obtido, esperado) => {
  const ok = String(obtido) === String(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${rotulo}: ${obtido}${ok ? '' : `  (esperado ${esperado})`}`);
};
const f1 = () => evaluate("document.getElementById('inp-data-inicio-f1').value");
const campo = (id) => evaluate(`document.getElementById('${id}').value`);
const aviso = () => evaluate("(document.getElementById('cd-aviso')?.textContent || '').replace(/\\s+/g, ' ').trim()");
const pausa = () => evaluate("[...document.querySelectorAll('.faixa-pausa-row')].filter(r => !r.classList.contains('hidden')).map(r => r.textContent.replace(/\\s+/g, ' ').trim()).join(';')");
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
const celula = (dia, hora) => `[...document.querySelectorAll('#weekly-grid .slot[data-dia="${dia}"]')].find(x => (x.dataset.horario || '').startsWith('${hora}'))`;
const podeClicar = (dia, hora) => evaluate(`${celula(dia, hora)}?.dataset.canEdit === '1'`);
const clicar = async (dia, hora) => {
  await evaluate(`(() => { const c = ${celula(dia, hora)}; c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); })()`);
  await sleep(500);
};
const setVal = async (id, v) => {
  await evaluate(`(() => { const el = document.getElementById('${id}'); el.value = '${v}'; ['input', 'change'].forEach(e => el.dispatchEvent(new Event(e, { bubbles: true }))); })()`);
  await sleep(800);
};
const novaComponente = async () => {
  await evaluate(`(async () => {
    const w = (ms) => new Promise(r => setTimeout(r, ms));
    const d = document.getElementById('inp-disciplina'); d.value = 'MATEMATICA BASICA (90h)';
    ['input', 'change'].forEach(e => d.dispatchEvent(new Event(e, { bubbles: true }))); await w(900);
    const p = document.getElementById('inp-docente'); p.value = 'Marcos Ferreira Brabo';
    ['input', 'change'].forEach(e => p.dispatchEvent(new Event(e, { bubbles: true }))); await w(700);
  })()`);
};

try {
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: seed });
  await send('Page.navigate', { url: `${baseUrl}/index.html?backend=local` });
  await waitFor("document.querySelectorAll('#sel-curso option').length > 0", 15000);
  await sleep(1200);
  await evaluate(`(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const pick = async (id, pred) => { const s = document.getElementById(id); const o = [...s.options].find(pred); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); await wait(700); };
    await pick('sel-periodo-letivo', o => ${CFG.periodo}.test(o.textContent) && /2027/.test(o.textContent + o.value));
    await pick('sel-curso', o => /Pesca/i.test(o.textContent));
    await pick('sel-turma', o => o.value === '${CFG.turma}');
  })()`);
  console.log(`== ${CENARIO}: turma ${CFG.turma}, turno ${await campo('sel-turno-oferta')} ==`);

  // 1) Sugestao
  await novaComponente();
  confere('1. sugestao', await f1(), CFG.sugestao);

  if (CFG.fluxo === 'aproveitamento') { await aproveitamento(CFG, KEY, { f1, campo, aviso, pausa, semana, celula, podeClicar, clicar, confere, evaluate, novaComponente }); } else {

  // 2) Antes da sugestao: o clique vale (aproveitamento); aqui so confere
  await semana(CFG.semanaAntes);
  confere('2. dia livre antes da sugestao aceita clique?', await podeClicar(CFG.diaAntes, CFG.hora), true);

  // 3) Clique numa semana depois: inicio vai para o dia
  await semana(CFG.semanaDepois);
  await clicar(CFG.diaDepois, CFG.hora);
  const diaDepois = await evaluate(`${celula(CFG.diaDepois, CFG.hora)}.dataset.date`);
  confere('3. clique adiante -> inicio', await f1(), diaDepois);

  // 4) Recuo na mesma semana
  confere('4a. dia anterior da mesma semana aceita clique?', await podeClicar(CFG.diaRecuo, CFG.hora), true);
  await clicar(CFG.diaRecuo, CFG.hora);
  const diaRecuo = await evaluate(`${celula(CFG.diaRecuo, CFG.hora)}.dataset.date`);
  confere('4b. recuo na semana -> inicio', await f1(), diaRecuo);

  // 5) Semana anterior a do inicio (mas depois da sugestao) nao recua
  // 6) Desmarcar tudo volta a sugestao
  await clicar(CFG.diaRecuo, CFG.hora);
  await clicar(CFG.diaDepois, CFG.hora);
  confere('6. desmarcou tudo -> volta a sugestao', await f1(), CFG.sugestao);

  // 7) Caminho manual: Inicio/Fim digitados antes da sugestao + retomada pela Faixa 2
  const mn = CFG.manual;
  await setVal('inp-data-inicio-f1', mn.ini);
  await setVal('inp-data-fim-f1', mn.fim);
  confere('7a. mensagem do Fim', /Para retomar, clique no número da Faixa 2/.test(await aviso()), true);
  await semana(CFG.semanaAntes);
  for (const d of mn.dias) {
    confere(`7b. dia ${d} digitado aceita clique?`, await podeClicar(d, CFG.hora), true);
    await clicar(d, CFG.hora); await clicar(d, CFG.hora2);
  }
  confere('7c. inicio digitado nao muda com o clique', await f1(), mn.ini);
  await evaluate("document.querySelector('#faixa-2 .faixa-num .faixa-num-value').click()"); await sleep(600);
  await semana(mn.volta);
  await evaluate(`${celula(1, CFG.hora)}.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))`); await sleep(800);
  confere('7d. inicio da Faixa 2', await campo('inp-data-inicio-f2'), mn.volta);
  confere('7e. linha da pausa', /Pausa sem aula/.test(await pausa()), true);
  confere('7f. mensagem da pausa', /A aula volta na Faixa 2/.test(await aviso()), true);
  confere('7g. horario clicado ja fica marcado na Faixa 2', await evaluate(`${celula(1, CFG.hora)}.classList.contains('selected-slot')`), true);
  confere('7h. Faixa 2 tem horario', /a definir/i.test(await evaluate("document.getElementById('faixa-padrao-f2').textContent")), false);
  await clicar(1, CFG.hora2);
  await evaluate("window.confirm = () => true; document.getElementById('btn-add-oferta').click()"); await sleep(2000);
  const gravado = await evaluate(`(() => { const a = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})); const m = a.find(x => /MATEM/.test(x.disciplina)); return m ? JSON.stringify((m.faixas || []).map(f => [f.inicio, f.fim, f.dias])) : 'nao gravou'; })()`);
  console.log('      gravado:', gravado);
  confere('7i. gravou com pausa', /"\d{4}-\d\d-\d\d","\d{4}-\d\d-\d\d"/.test(gravado) && gravado.includes(mn.volta), true);
  confere('8a. depois de salvar, a tabela mostra o inicio da Faixa 1', await f1(), mn.ini);
  confere('8b. depois de salvar, a tabela mostra o inicio da Faixa 2', await campo('inp-data-inicio-f2'), mn.volta);
  confere('8c. depois de salvar, a pausa continua visivel', /Pausa sem aula/.test(await pausa()), true);
  if (CENARIO === 'doisTurnos') {
    const linha = "[...document.querySelectorAll('tr')].find(t => /MATEMATICA BASICA/.test(t.textContent) && t.querySelector('.btn-delete-row'))";
    await evaluate(`window.confirm = () => true; ${linha}.querySelector('.btn-delete-row').click()`); await sleep(1200);
    confere('9. excluiu pela Lista -> tabela limpa', await f1() + '|' + await campo('inp-data-inicio-f2') + '|' + await pausa(), '||');
  } else {
    await evaluate("window.confirm = () => true; document.getElementById('btn-undo-alloc').click()"); await sleep(1200);
    confere('9. Desfazer Alocacao -> tabela limpa', await f1() + '|' + await campo('inp-data-inicio-f2') + '|' + await pausa(), '||');

    // 10) Turma da tarde com sabado passado para a manha: a proxima componente
    //     nao comeca na tarde desse sabado (fica escondida); vai para segunda.
    await evaluate(`(async () => {
      const w = (ms) => new Promise(r => setTimeout(r, ms));
      const d = document.getElementById('inp-disciplina');
      d.value = [...document.querySelectorAll('#list-disciplinas option')].map(o => o.value).find(v => /INTRODUCAO A ENGENHARIA DE PESCA/.test(v));
      ['input', 'change'].forEach(e => d.dispatchEvent(new Event(e, { bubbles: true }))); await w(900);
      const p = document.getElementById('inp-docente'); p.value = 'Marcos Ferreira Brabo';
      ['input', 'change'].forEach(e => p.dispatchEvent(new Event(e, { bubbles: true }))); await w(700);
    })()`);
    await semana('2027-09-13');
    for (const dia of [1, 2, 3, 4, 5, 6]) {
      for (const h of T) {
        await clicar(dia, h.slice(0, 5));
        if (await evaluate("!!document.getElementById('sabado-modal')")) {
          await evaluate("document.querySelector('#sabado-modal .sab-opcao--manha').click()"); await sleep(500);
        }
      }
    }
    await evaluate("window.confirm = () => true; document.getElementById('btn-add-oferta').click()"); await sleep(2000);
    await novaComponente();
    confere('10. sabado com aula de manha -> proxima comeca na segunda', await f1(), '2027-09-20');
  }
  }
  if (errors.length) { falhas++; console.log('erros:', errors.join(' | ')); }
  falhasTotais += falhas;
} finally { ws.close(); proc.kill(); server.close(); await sleep(400); try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {} }
}

// Aproveitamento: clique antes da sugestao -> Faixa 1 ate a vespera da proxima,
// numero 2 -> Faixa 2 na sugestao, vazia; salvar grava as duas com a pausa.
async function aproveitamento(CFG, KEY, h) {
  const { f1, campo, aviso, pausa, semana, celula, podeClicar, clicar, confere, evaluate, novaComponente } = h;
  const sugestao = await f1();
  console.log('      sugestao:', sugestao);
  await semana('2027-08-23');
  confere('A1. 14:00 da quinta (ocupado pela de 3 aulas) aceita clique?', await podeClicar(4, '14:00'), false);
  confere('A2. 16:50 da quinta (livre) aceita clique?', await podeClicar(4, '16:50'), true);
  await clicar(4, '16:50');
  confere('A3. inicio da Faixa 1', await f1(), '2027-08-26');
  confere('A4. Fim da Faixa 1 = vespera do sabado da Informatica', await campo('inp-data-fim-f1'), '2027-08-27');
  confere('A5. mensagem do aproveitamento', /Aproveitando dias livres/.test(await aviso()), true);
  confere('A6. sabado 28 fica fora da Faixa 1', await podeClicar(6, '14:00'), false);
  await clicar(4, '17:40'); await clicar(5, '16:50'); await clicar(5, '17:40');
  await evaluate("document.querySelector('#faixa-2 .faixa-num .faixa-num-value').click()"); await sleep(900);
  confere('A7. numero 2 -> Faixa 2 na sugestao', await campo('inp-data-inicio-f2'), sugestao);
  confere('A8. Faixa 2 comeca vazia', /a definir/i.test(await evaluate("document.getElementById('faixa-padrao-f2').textContent")), true);
  confere('A9. linha da pausa', /Pausa sem aula/.test(await pausa()), true);
  confere('A10. mensagem da volta', /A Faixa 2 começa em/.test(await aviso()), true);
  confere('A11. Fim da Faixa 1 mantido', await campo('inp-data-fim-f1'), '2027-08-27');
  const semanaVolta = await evaluate(`(() => { const d = new Date('${sugestao}T12:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); })()`);
  confere('A12. grade foi para a semana da volta', await semana(semanaVolta), true);
  const diaVolta = await evaluate(`new Date('${sugestao}T12:00:00').getDay()`);
  for (const hh of ['14:00', '14:50', '15:40', '16:50', '17:40']) await clicar(diaVolta, hh);
  await evaluate("window.confirm = () => true; document.getElementById('btn-add-oferta').click()"); await sleep(2000);
  const gravado = await evaluate(`(() => { const a = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})); const m = a.find(x => /MATEM/.test(x.disciplina)); return m ? JSON.stringify((m.faixas || []).map(f => [f.inicio, f.fim, f.dias])) : 'nao gravou'; })()`);
  console.log('      gravado:', gravado);
  confere('A13. gravou Faixa 1 26-27/08 e Faixa 2 na sugestao', gravado.startsWith('[["2027-08-26","2027-08-27"') && gravado.includes(`["${sugestao}"`), true);

  // Edicao: a componente salva so na volta; Editar -> o dia antes avisa o caminho;
  // Limpar Faixas -> o mesmo aproveitamento; salvar substitui (nao duplica).
  await evaluate("window.confirm = () => true; document.getElementById('btn-undo-alloc').click()"); await sleep(1200);
  await novaComponente();
  await semana('2027-09-13');
  for (const d of [1, 2, 3, 4, 5]) for (const hh of ['14:00', '14:50', '15:40', '16:50', '17:40']) await clicar(d, hh);
  await evaluate("window.confirm = () => true; document.getElementById('btn-add-oferta').click()"); await sleep(2000);
  await evaluate(`(() => { const tr = [...document.querySelectorAll('tr')].find(t => /MATEMATICA BASICA/.test(t.textContent) && t.querySelector('.btn-edit-row')); tr.querySelector('.btn-edit-row').click(); })()`);
  await sleep(1500);
  await semana('2027-08-23');
  confere('E1. em edicao, dia antes do inicio nao comeca sozinho', await podeClicar(4, '16:50'), false);
  confere('E2. ... e explica o caminho', /Limpar Faixas/.test(await evaluate(`${celula(4, '16:50')}.title`)), true);
  await evaluate("window.confirm = () => true; document.getElementById('btn-limpar-faixas').click()"); await sleep(1200);
  confere('E2b. Limpar Faixas na edicao fica na semana vista', /23\/08\/2027/.test(await evaluate("document.getElementById('weekly-week-label').textContent")), true);
  confere('E2c. ... e o dia livre ja aceita clique', await podeClicar(4, '16:50'), true);
  await clicar(4, '16:50');
  confere('E3. depois de Limpar Faixas: aproveitamento', await f1() + ' a ' + await campo('inp-data-fim-f1'), '2027-08-26 a 2027-08-27');
  await clicar(4, '17:40'); await clicar(5, '16:50'); await clicar(5, '17:40');
  await evaluate("document.querySelector('#faixa-2 .faixa-num .faixa-num-value').click()"); await sleep(900);
  confere('E4. numero 2 -> Faixa 2 na sugestao', await campo('inp-data-inicio-f2'), sugestao);
  await semana('2027-09-13');
  for (const d of [1, 2, 3, 4, 5]) for (const hh of ['14:00', '14:50', '15:40', '16:50', '17:40']) await clicar(d, hh);
  await evaluate("window.confirm = () => true; document.getElementById('btn-add-oferta').click()"); await sleep(2000);
  const editada = await evaluate(`(() => { const a = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})); return JSON.stringify(a.filter(x => /MATEM/.test(x.disciplina)).map(m => (m.faixas || []).map(f => [f.inicio, f.fim]))); })()`);
  console.log('      editada:', editada);
  confere('E5. edicao salva com a pausa, uma componente so', /^\[\[\["2027-08-26","2027-08-27"\],\["2027-09-11"/.test(editada), true);
}
for (const nome of Object.keys(CENARIOS)) await rodar(nome);
console.log(falhasTotais ? `${falhasTotais} falha(s)` : 'Tudo certo: o inicio pelo clique funciona.');
process.exitCode = falhasTotais ? 1 : 0;
