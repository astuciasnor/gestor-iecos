// Feriados e bloqueios por turma - uma regra so, usada por todas as telas.
//
// Feriado comum (sem "turmas"): vale para todas as turmas, como sempre foi.
// Bloqueio por turma (com "turmas", ex.: Recepcao Calouros): vale so para as
// turmas listadas. Quem decide esses dias e a unidade academica; o
// administrador so cadastra na aba "feriados" da planilha (coluna "turmas").

function turmasDoFeriado(feriado) {
  return Array.isArray(feriado?.turmas)
    ? feriado.turmas.map((t) => String(t || '').trim()).filter(Boolean)
    : [];
}

function dataDoFeriado(feriado) {
  return String(feriado?.data || feriado || '').trim();
}

// turmaId vazio = tela sem turma (ex.: agenda geral): so os feriados comuns.
export function feriadoValeParaTurma(feriado, turmaId = '') {
  const turmas = turmasDoFeriado(feriado);
  if (turmas.length === 0) return true;
  return !!turmaId && turmas.includes(String(turmaId).trim());
}

export function feriadosDaTurma(feriados = [], turmaId = '') {
  return (Array.isArray(feriados) ? feriados : []).filter((f) => dataDoFeriado(f) && feriadoValeParaTurma(f, turmaId));
}

export function datasFeriadoDaTurma(feriados = [], turmaId = '') {
  return new Set(feriadosDaTurma(feriados, turmaId).map(dataDoFeriado));
}
