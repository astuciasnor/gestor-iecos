// Botao "Trocar" da Lista de Ofertas: quando duas componentes da mesma turma podem trocar
// de lugar. Funcoes puras (sem DOM nem store), testadas em tests/troca_ordem.test.mjs.
//
//  - Mesma carga horaria: uma pega exatamente a posicao da outra (datas, faixas
//    e horarios), estejam juntas ou afastadas. A grade da turma fica igual.
//  - Cargas diferentes: so quando estao em sequencia (nenhum dia de aula livre
//    entre elas) e cada uma tem um unico padrao de horarios. A que vinha depois
//    passa a comecar onde a primeira comecava e a outra vem logo em seguida.
//
// Componente esperada: { disciplina, subGrupo, ch, dataInicio, dataFim,
//   registros (quantos registros de alocacao formam a oferta),
//   faixas: [{ inicio, fim, drawnSlotsByDay: { dia: [horarios] } }] }

function isoToUtc(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

export function addDaysIso(iso, days) {
  return new Date(isoToUtc(iso) + days * 86400000).toISOString().slice(0, 10);
}

function weekdayOf(iso) {
  return new Date(isoToUtc(iso)).getUTCDay();
}

function slotsByDay(faixa) {
  return faixa?.drawnSlotsByDay && typeof faixa.drawnSlotsByDay === 'object' ? faixa.drawnSlotsByDay : {};
}

// Um unico padrao: as faixas seguintes so repetem ou reduzem os horarios da
// primeira (ex.: a faixa de ajuste do ultimo dia incompleto).
export function hasSinglePattern(faixas = []) {
  if (!faixas.length) return false;
  const base = slotsByDay(faixas[0]);
  return faixas.slice(1).every((faixa) => Object.entries(slotsByDay(faixa)).every(([dia, slots]) => {
    const permitidos = new Set((base[dia] || []).map(String));
    return (slots || []).every((slot) => permitidos.has(String(slot)));
  }));
}

function diasDaComponente(comp) {
  const dias = new Set();
  (comp.faixas || []).forEach((faixa) => Object.keys(slotsByDay(faixa)).forEach((d) => dias.add(Number(d))));
  return dias;
}

// Em sequencia: a segunda comeca depois (ou no ultimo dia) da primeira e, entre
// elas, so ha domingos, feriados ou dias da semana em que nenhuma das duas tem aula.
export function areInSequence(first, second, { feriados = [] } = {}) {
  if (!first?.dataFim || !second?.dataInicio) return false;
  if (second.dataInicio < first.dataFim) return false;
  const feriadosSet = new Set(feriados.map(String));
  const dias = new Set([...diasDaComponente(first), ...diasDaComponente(second)]);
  for (let dia = addDaysIso(first.dataFim, 1); dia < second.dataInicio; dia = addDaysIso(dia, 1)) {
    const dow = weekdayOf(dia);
    if (dow === 0 || feriadosSet.has(dia) || !dias.has(dow)) continue;
    return false;
  }
  return true;
}

function nomeSubGrupo(subGrupo) {
  return subGrupo ? `sub-turma ${subGrupo}` : 'turma inteira';
}

// Resultado: { ok: true, modo: 'mesma-ch' | 'sequencia' } ou { ok: false, motivo }.
export function classifySwap(a, b, { feriados = [] } = {}) {
  const dividida = [a, b].find((comp) => Number(comp.registros) !== 1);
  if (dividida) return { ok: false, motivo: 'oferta dividida em mais de um registro' };

  const subA = String(a.subGrupo || '');
  const subB = String(b.subGrupo || '');
  if (subA !== subB) return { ok: false, motivo: `sub-turma diferente (${nomeSubGrupo(subB)} x ${nomeSubGrupo(subA)})` };

  const chA = Number(a.ch) || 0;
  const chB = Number(b.ch) || 0;
  if (chA > 0 && chA === chB) return { ok: true, modo: 'mesma-ch' };

  const [first, second] = String(a.dataInicio) <= String(b.dataInicio) ? [a, b] : [b, a];
  if (!areInSequence(first, second, { feriados })) {
    return { ok: false, motivo: `carga diferente (${chB}h x ${chA}h) e não estão em sequência` };
  }
  const variada = [a, b].find((comp) => !hasSinglePattern(comp.faixas || []));
  if (variada) {
    return { ok: false, motivo: `${variada.disciplina} tem faixas com horários diferentes (com carga diferente, só troca com um único padrão)` };
  }
  return { ok: true, modo: 'sequencia' };
}
