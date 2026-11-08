// Subturmas (turma extra) de uma componente: a mesma componente alocada mais de
// uma vez na mesma turma e no mesmo PL (ex.: laboratorio em dois grupos).
// Numeracao automatica: a primeira oferta vira T01, a segunda T02, e assim por
// diante. Com bloco no PL o codigo leva o bloco: "BL1_T02" (rotulo da turma
// "EP2026_BL1_T02"); sem bloco (PL1/PL3), so "T02".
// Funcoes puras (sem DOM nem store), testadas em tests/subturmas.test.mjs.

// Numero da subturma no codigo ("BL1_T02" -> 2, "T2" -> 2) ou null.
export function numeroDaSubturma(subGrupo) {
  const m = String(subGrupo || '').trim().match(/(?:^|_)T0*(\d+)$/i);
  return m ? parseInt(m[1], 10) : null;
}

// Vale para a turma toda (sem subturma)? Vazio ou so o bloco ("BL6").
export function isTurmaInteira(subGrupo) {
  const sg = String(subGrupo || '').trim();
  return !sg || /^BL\d+$/i.test(sg);
}

export function codigoDaSubturma(numero, bloco = '') {
  const t = `T${String(numero).padStart(2, '0')}`;
  const bl = String(bloco || '').trim();
  return bl ? `${bl}_${t}` : t;
}

// Proxima subturma, dados os sub-grupos das ofertas que ja existem dessa
// componente na turma. A oferta sem subturma conta como T01 (sera renomeada).
// Devolve null quando ainda nao ha nenhuma oferta (primeira insercao normal).
export function proximaSubturma(subGruposExistentes = [], bloco = '') {
  const lista = Array.isArray(subGruposExistentes) ? subGruposExistentes : [];
  if (lista.length === 0) return null;
  const maior = lista.reduce((max, sg) => Math.max(max, numeroDaSubturma(sg) || 1), 1);
  const numero = maior + 1;
  return { numero, rotulo: `T${String(numero).padStart(2, '0')}`, codigo: codigoDaSubturma(numero, bloco) };
}

// Codigo T01 no mesmo formato da subturma salva ("BL1_T02" -> "BL1_T01", "T02" -> "T01").
export function codigoT01Como(subGrupoSalvo) {
  const sg = String(subGrupoSalvo || '').trim();
  const prefixo = sg.replace(/T0*\d+$/i, '');
  return `${prefixo}T01`;
}
