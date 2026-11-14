// Caminhos do "Salvar Componente" no navegador (dados de teste; nao toca o servidor).
// Cada cenario roda num navegador limpo e guarda os avisos mostrados e as ofertas
// do plano depois do salvar (sem os ids, que sao sorteados):
//   editar_sem_mudar   EP2025/PL2: Editar CARTOGRAFIA e salvar sem mexer (atualiza a oferta)
//   choque_professor   EP2025/PL2: Editar TECNOLOGIA DO PESCADO com o Marcos (aula no EP2027): barra
//   docente_novo       EP2025/PL2: Editar MAQUINAS E MOTORES com um nome sem cadastro: barra
//   substituir         EP2025/PL2: Substituir SOCIOLOGIA por uma componente nao alocada (a original vira pendente)
//   nova_componente    EP2024/PL1 (vazio): METODOLOGIA CIENTIFICA nas manhas a partir de 04/01
//   turma_extra        EP2024/PL1: METODOLOGIA de novo (subturma T02) a partir de 01/02: a primeira vira T01
//   excluir_t02        turma_extra e depois Excluir a T02 na Lista: a T01 volta a turma toda
//   excluir_t01        o mesmo, excluindo a T01: a T02 volta a turma toda
//   nao_intensiva      EP2024/PL1: MATEMATICA BASICA so segunda e quarta (regra da nao intensiva)
// Os outros caminhos (empilhar, nao cabe inteira, pausa, inicio pelo clique) tem
// testes proprios: teste_metade_ch, teste_pausa_intercalada, teste_inicio_clique.
// Uso (na raiz): node tools/teste_salvar.mjs [saida.json] [--comparar antes.json]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sleep, startServer, findBrowser, openBrowser, cdp } from './smoke_test.mjs';
import { ROOT } from './bump_version.mjs';

const saida = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(os.tmpdir(), 'cardume-teste-salvar.json');
const agenda = JSON.parse(fs.readFileSync(process.env.DADOS || path.join(ROOT, 'alocacoes_publicas.json'), 'utf8'));
const pubs = agenda.publications.filter((p) => p?.plan?.key && Array.isArray(p.allocations));
const pl1 = pubs.find((p) => p.plan.key.startsWith('PL1__2027'));
const pl2 = pubs.find((p) => p.plan.key.startsWith('PL2__2027'));
const CHAVES = { PL1: 'academic_plan_v1::' + pl1.plan.key, PL2: 'academic_plan_v1::' + pl2.plan.key };
const seed = `sessionStorage.setItem('auth', 'true');
if (!localStorage.getItem('salvar_seeded')) {
  localStorage.setItem('salvar_seeded', '1');
  localStorage.setItem('academic_settings', ${JSON.stringify(JSON.stringify({ periodo: pl2.plan.periodo, termStart: pl2.plan.termStart, termEnd: pl2.plan.termEnd }))});
  ${pubs.map((p) => `localStorage.setItem(${JSON.stringify('academic_plan_v1::' + p.plan.key)}, ${JSON.stringify(JSON.stringify(p.allocations))});`).join('\n  ')}
}`;

// Funcoes que rodam na pagina (injetadas antes de cada cenario).
const AJUDA = String.raw`
  window.confirm = () => true;
  window.__w = (ms) => new Promise(r => setTimeout(r, ms));
  window.__linha = (re, cls) => [...document.querySelectorAll('#tab-list tr')].find(t => re.test(t.textContent) && t.querySelector(cls));
  window.__campo = async (id, valor) => { const e = document.getElementById(id); e.value = valor; ['input', 'change'].forEach(ev => e.dispatchEvent(new Event(ev, { bubbles: true }))); await window.__w(900); };
  window.__disc = (nome) => { const o = [...document.querySelectorAll('datalist option')].find(x => x.value.startsWith(nome + ' (')); return o ? o.value : nome; };
  window.__salvar = async () => { document.getElementById('btn-add-oferta').click(); await window.__w(2500); };
  window.__msgs = [];
  const anota = (el) => { const t = (el.textContent || '').replace(/\s+/g, ' ').trim(); if (t && window.__msgs[window.__msgs.length - 1] !== t) window.__msgs.push(t); };
  ['feedback-msg', 'cd-aviso'].forEach(id => { const el = document.getElementById(id); if (el) new MutationObserver(() => anota(el)).observe(el, { childList: true, subtree: true, characterData: true }); });
  window.__semana = async (iso) => {
    for (let i = 0; i < 40; i++) {
      const l = document.getElementById('weekly-week-label').textContent;
      const m = l.match(/(\d{2})\/(\d{2})\/(\d{4})/); const atual = m ? m[3] + '-' + m[2] + '-' + m[1] : '';
      const fimSemana = atual ? new Date(new Date(atual + 'T12:00:00').getTime() + 5 * 864e5).toISOString().slice(0, 10) : '';
      if (atual && atual <= iso && iso <= fimSemana) return true;
      document.getElementById(atual < iso ? 'btn-week-next' : 'btn-week-prev').click(); await window.__w(350);
    }
    return false;
  };
  window.__marca = async (dias, horas) => {
    for (const dia of dias) for (const h of horas) {
      const c = [...document.querySelectorAll('#weekly-grid .slot[data-dia="' + dia + '"]')].find(x => (x.dataset.horario || '').startsWith(h));
      if (!c) continue;
      c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); await window.__w(100);
    }
    await window.__w(500);
  };
`;
const MANHA = "['08:00', '08:50', '09:40', '10:50', '11:40']";
const novaMetodologia = (inicio) => `
    document.getElementById('tabbtn-weekly').click(); await __w(800);
    await __campo('inp-disciplina', __disc('METODOLOGIA CIENTIFICA'));
    await __campo('inp-docente', 'Ana Garcês');
    await __campo('inp-data-inicio-f1', '${inicio}');
    await __semana('${inicio}');
    await __marca([1, 2, 3, 4, 5], ${MANHA});
    await __salvar();`;

const CENARIOS = {
  editar_sem_mudar: { pl: 'PL2', turma: 'EP2025', acoes: `(async () => {
    __linha(/CARTOGRAFIA/, '.btn-edit-row').querySelector('.btn-edit-row').click(); await __w(1500);
    await __salvar();
  })()` },
  choque_professor: { pl: 'PL2', turma: 'EP2025', acoes: `(async () => {
    __linha(/TECNOLOGIA DO PESCADO/, '.btn-edit-row').querySelector('.btn-edit-row').click(); await __w(1500);
    await __campo('inp-docente', 'Marcos Ferreira Brabo');
    await __salvar();
  })()` },
  docente_novo: { pl: 'PL2', turma: 'EP2025', acoes: `(async () => {
    __linha(/MAQUINAS E MOTORES/, '.btn-edit-row').querySelector('.btn-edit-row').click(); await __w(1500);
    await __campo('inp-docente', 'Fulano de Teste Inventado');
    await __salvar();
  })()` },
  substituir: { pl: 'PL2', turma: 'EP2025', acoes: String.raw`(async () => {
    const naTurma = new Set(JSON.parse(localStorage.getItem(__chave)).filter(a => a.turmaId === 'EP2025').map(a => a.disciplina));
    __linha(/SOCIOLOGIA/, '.btn-replace-row').querySelector('.btn-replace-row').click(); await __w(1500);
    const outra = [...document.querySelectorAll('datalist option')].map(o => o.value).find(v => /\(45h\)$/.test(v) && !naTurma.has(v.replace(/\s*\(\d+h\)$/, '')));
    window.__escolhida = outra;
    await __campo('inp-disciplina', outra);
    await __campo('inp-docente', 'Cleide Marques');   // o mesmo da SOCIOLOGIA (trocar a componente limpa o campo)
    await __salvar();
  })()` },
  nova_componente: { pl: 'PL1', turma: 'EP2024', acoes: `(async () => {${novaMetodologia('2027-01-04')}
  })()` },
  turma_extra: { pl: 'PL1', turma: 'EP2024', acoes: `(async () => {${novaMetodologia('2027-01-04')}
    document.getElementById('tabbtn-list').click(); await __w(600);${novaMetodologia('2027-02-01')}
  })()` },
  // Excluir uma subturma: a que sobra perde o T01/T02 sem precisar de Editar + Salvar.
  excluir_t02: { pl: 'PL1', turma: 'EP2024', acoes: `(async () => {${novaMetodologia('2027-01-04')}
    document.getElementById('tabbtn-list').click(); await __w(600);${novaMetodologia('2027-02-01')}
    document.getElementById('tabbtn-list').click(); await __w(800);
    __linha(/METODOLOGIA CIENTIFICA.{0,3}T02/, '.btn-delete-row').querySelector('.btn-delete-row').click(); await __w(1500);
  })()` },
  excluir_t01: { pl: 'PL1', turma: 'EP2024', acoes: `(async () => {${novaMetodologia('2027-01-04')}
    document.getElementById('tabbtn-list').click(); await __w(600);${novaMetodologia('2027-02-01')}
    document.getElementById('tabbtn-list').click(); await __w(800);
    __linha(/METODOLOGIA CIENTIFICA.{0,3}T01/, '.btn-delete-row').querySelector('.btn-delete-row').click(); await __w(1500);
  })()` },
  // Segunda e quarta (dias nao seguidos): componente nao intensiva, que desvia das
  // aulas da turma em vez de empilhar; 90h nao cabem ate 05/03 (avisa as horas).
  nao_intensiva: { pl: 'PL1', turma: 'EP2024', acoes: `(async () => {${novaMetodologia('2027-01-04')}
    document.getElementById('tabbtn-list').click(); await __w(600);
    document.getElementById('tabbtn-weekly').click(); await __w(800);
    await __campo('inp-disciplina', __disc('MATEMATICA BASICA'));
    await __campo('inp-docente', 'Marcos Ferreira Brabo');
    await __campo('inp-data-inicio-f1', '2027-01-18');
    await __semana('2027-01-18');
    await __marca([1, 3], ${MANHA});
    await __salvar();
  })()` }
};

const lerPlano = (chave, turma) => `(() => {
  const ordena = (o) => Array.isArray(o) ? o.map(ordena) : (o && typeof o === 'object') ? Object.fromEntries(Object.keys(o).sort().filter(k => k !== 'id').map(k => [k, ordena(o[k])])) : o;
  const todas = JSON.parse(localStorage.getItem(${JSON.stringify(chave)}) || '[]').map(ordena);
  const chaveDe = (a) => [a.turmaId, a.disciplina, a.subGrupo || '', a.modo || '', a.dataInicio || ''].join('|');
  todas.sort((x, y) => chaveDe(x).localeCompare(chaveDe(y)));
  return {
    turma: todas.filter(a => a.turmaId === ${JSON.stringify(turma)}).map(a => ({ disciplina: a.disciplina, subGrupo: a.subGrupo || '', modo: a.modo, docente: a.docente, inicio: a.dataInicio, fim: a.dataFim,
      horas: Object.values(a.executionByDate || {}).reduce((s, v) => s + (v || []).length, 0) })),
    planoInteiro: JSON.stringify(todas)
  };
})()`;

async function rodar({ pl, turma, acoes }) {
  const errors = [];
  const server = await startServer();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardume-salvar-'));
  const { proc, ws } = await openBrowser(findBrowser(), profileDir);
  const { send, evaluate, waitFor } = cdp(ws, errors);
  try {
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: seed });
    await send('Page.navigate', { url: `${baseUrl}/index.html?backend=local` });
    await waitFor("document.querySelectorAll('#sel-periodo-letivo option').length > 1", 40000);
    await sleep(1200);
    await evaluate(`(async () => { ${AJUDA}
      window.__chave = ${JSON.stringify(CHAVES[pl])};
      const pick = async (id, pred) => { const s = document.getElementById(id); const o = [...s.options].find(pred); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); await __w(700); };
      await pick('sel-periodo-letivo', o => new RegExp(${JSON.stringify(pl)}).test(o.textContent) && /2027/.test(o.textContent + o.value));
      await pick('sel-curso', o => /Pesca/i.test(o.textContent));
      await pick('sel-turma', o => o.value === ${JSON.stringify(turma)});
      document.getElementById('tabbtn-list').click(); await __w(800);
      window.__msgs.length = 0;
    })()`);
    const antes = await evaluate(lerPlano(CHAVES[pl], turma));
    await evaluate(acoes);
    const avisos = await evaluate('({ todos: window.__msgs || [], escolhida: window.__escolhida || "" })');
    const depois = await evaluate(lerPlano(CHAVES[pl], turma));
    return { avisos, mudouPlano: antes.planoInteiro !== depois.planoInteiro, turma: depois.turma, planoInteiro: depois.planoInteiro, erros: errors };
  } finally {
    ws.close(); proc.kill(); server.close();
    await sleep(300);
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* */ }
  }
}

let falhas = 0;
const confere = (rotulo, ok, detalhe = '') => {
  if (!ok) falhas++;
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${rotulo}${detalhe ? ': ' + detalhe : ''}`);
};
const foto = {};
const so = process.env.CENARIO;
for (const [nome, cenario] of Object.entries(CENARIOS)) {
  if (so && so !== nome) continue;
  const r = await rodar(cenario);
  foto[nome] = r;
  const aviso = r.avisos.todos.join(' || ');
  console.log(`\n== ${nome}: ${aviso.slice(0, 300)}`);
  if (r.erros.length) confere('sem erros no navegador', false, r.erros.join(' | '));
  const of = (d, sg = '') => r.turma.find((a) => a.disciplina === d && (a.subGrupo || '') === sg);
  if (nome === 'editar_sem_mudar') {
    confere('CARTOGRAFIA continua com a CH inteira', of('CARTOGRAFIA E GEOPROCESSAMENTO')?.horas === 60);
  } else if (nome === 'choque_professor') {
    confere('barrou por choque de professor', /Choque de professor/.test(aviso) && !r.mudouPlano);
  } else if (nome === 'docente_novo') {
    confere('barrou docente sem cadastro', /sem cadastro/i.test(aviso) && !r.mudouPlano);
  } else if (nome === 'substituir') {
    const escolhida = r.avisos.escolhida.replace(/\s*\(\d+h\)$/, '');
    confere(`SOCIOLOGIA virou pendente e ${escolhida} entrou`, of('SOCIOLOGIA APLICADA AS COMUNIDADES PESQUEIRAS')?.modo === 'pendente' && !!of(escolhida));
  } else if (nome === 'nova_componente') {
    const m = of('METODOLOGIA CIENTIFICA');
    confere('METODOLOGIA salva com 45h', m?.horas === 45, `${m?.inicio}..${m?.fim} ${m?.horas}h`);
  } else if (nome === 'turma_extra') {
    const metod = r.turma.filter((a) => a.disciplina === 'METODOLOGIA CIENTIFICA');
    confere('METODOLOGIA T01 e T02', metod.length === 2 && metod.every((a) => /T0[12]$/.test(a.subGrupo)),
      metod.map((a) => `${a.subGrupo || '(turma)'} ${a.inicio}..${a.fim} ${a.horas}h`).join(' | '));
  } else if (nome === 'excluir_t02' || nome === 'excluir_t01') {
    const metod = r.turma.filter((a) => a.disciplina === 'METODOLOGIA CIENTIFICA');
    const lista = metod.map((a) => `${a.subGrupo || '(turma)'} ${a.inicio}..${a.fim} ${a.horas}h`).join(' | ');
    confere('sobrou uma METODOLOGIA, sem T01/T02', metod.length === 1 && !metod[0].subGrupo, lista);
  } else if (nome === 'nao_intensiva') {
    const m = of('MATEMATICA BASICA');
    confere('MATEMATICA BASICA salva (segunda e quarta)', !!m && m.horas > 0, `${m?.inicio}..${m?.fim} ${m?.horas}h`);
  }
}
fs.writeFileSync(saida, JSON.stringify(foto, null, 1));
console.log('\nresultado gravado:', saida);

const iComparar = process.argv.indexOf('--comparar');
if (iComparar > 0) {
  const antes = JSON.parse(fs.readFileSync(process.argv[iComparar + 1], 'utf8'));
  const dif = Object.keys({ ...antes, ...foto }).filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(foto[k]));
  if (dif.length) falhas++;
  console.log(dif.length ? `DIFERENTE do resultado de antes em: ${dif.join(', ')}` : 'IGUAL ao resultado de antes.');
}
console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo certo: os caminhos do Salvar funcionam.');
process.exit(falhas ? 1 : 0);
