// Subturmas (turma extra) de uma componente: a mesma componente alocada mais de
// uma vez na mesma turma e no mesmo PL (ex.: laboratorio em dois grupos).
// Numeracao automatica: a primeira oferta vira T01, a segunda T02, e assim por
// diante. O codigo e so "T02" (sem o bloco), como o usuario pediu em 08/11/2026;
// codigos antigos como "BL1_T02" ou "T2" continuam lidos pelo numero.
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

export function codigoDaSubturma(numero) {
  return `T${String(numero).padStart(2, '0')}`;
}

// Proxima subturma, dados os sub-grupos das ofertas que ja existem dessa
// componente na turma: o MENOR numero livre. A oferta sem subturma conta como
// T01 (sera renomeada). Se a T01 foi apagada e sobrou a T02, a nova e a T01.
// Devolve null quando ainda nao ha nenhuma oferta (primeira insercao normal).
export function proximaSubturma(subGruposExistentes = []) {
  const lista = Array.isArray(subGruposExistentes) ? subGruposExistentes : [];
  if (lista.length === 0) return null;
  const usados = new Set(lista.map((sg) => numeroDaSubturma(sg) || 1));
  let numero = 1;
  while (usados.has(numero)) numero++;
  const codigo = codigoDaSubturma(numero);
  return { numero, rotulo: codigo, codigo };
}

// Codigo da T01 quando a subturma salva e "BL1_T02" (formato antigo) ou "T02":
// mantem o prefixo antigo, se houver, para as duas ficarem no mesmo formato.
export function codigoT01Como(subGrupoSalvo) {
  const sg = String(subGrupoSalvo || '').trim();
  const prefixo = sg.replace(/T0*\d+$/i, '');
  return `${prefixo}T01`;
}

// Duas ofertas da mesma turma estao em subturmas DIFERENTES (T01 x T02)? Elas
// podem ter aula em paralelo na turma (cada grupo numa sala), mas o mesmo
// professor nas duas ao mesmo tempo e choque. Turma inteira (vazio ou "BL6")
// nunca e subturma diferente: ocupa a turma toda.
export function saoSubturmasDiferentes(subA, subB) {
  if (isTurmaInteira(subA) || isTurmaInteira(subB)) return false;
  const na = numeroDaSubturma(subA);
  const nb = numeroDaSubturma(subB);
  if (na !== null && nb !== null) return na !== nb;
  return String(subA).trim().toUpperCase() !== String(subB).trim().toUpperCase();
}
