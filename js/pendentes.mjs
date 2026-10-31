// Pendentes da turma: componentes do Bloco do PPC (ou devolvidas pelo
// "Substituir por...") que ainda nao tem horarios.
// Regra: uma componente nunca e pendente e alocada ao mesmo tempo na mesma
// turma. Ela so volta a ser pendente quando outra a substitui.
// Funcoes puras (sem DOM nem store), testadas em tests/pendentes.test.mjs.

// Nome de comparacao: sem o sufixo "(60h)" da lista, sem diferenca de
// maiusculas nem de espacos.
export function getDisciplinaKey(nome) {
  return String(nome || '')
    .replace(/\s*\(\s*\d+\s*h\s*\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleUpperCase('pt-BR');
}

// Sub-turma vazia ou so com o bloco ("BL6") vale para a turma toda; "BL6_T01"
// e uma divisao da turma e so casa com ela mesma.
function isTurmaInteira(subGrupo) {
  const sg = String(subGrupo || '').trim();
  return !sg || /^BL\d+$/i.test(sg);
}

export function subGruposCompativeis(a, b) {
  if (isTurmaInteira(a) || isTurmaInteira(b)) return true;
  return String(a).trim().toUpperCase() === String(b).trim().toUpperCase();
}

function getModo(alloc) {
  return String(alloc?.modo || '').trim().toLowerCase();
}

// A pendente e da mesma oferta que a alocacao (turma, componente e sub-turma)?
export function pendenteCorrespondeA(pendente, alloc) {
  return String(pendente?.turmaId) === String(alloc?.turmaId)
    && getDisciplinaKey(pendente?.disciplina) === getDisciplinaKey(alloc?.disciplina)
    && subGruposCompativeis(pendente?.subGrupo, alloc?.subGrupo);
}

// Pendente cuja componente ja tem horarios na mesma turma (sobra de uma edicao).
export function isPendenteJaAlocada(pendente, allocations = []) {
  if (getModo(pendente) !== 'pendente') return false;
  return allocations.some((a) => getModo(a) === 'faixas' && pendenteCorrespondeA(pendente, a));
}

// Ids das pendentes que devem sair ao salvar esta alocacao.
export function findPendentesCobertas(alloc, allocations = []) {
  return allocations
    .filter((a) => getModo(a) === 'pendente' && pendenteCorrespondeA(a, alloc))
    .map((a) => a.id);
}
