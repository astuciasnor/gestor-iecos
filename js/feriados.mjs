// Feriados e bloqueios por turma - uma regra so, usada por todas as telas.
//
// Feriado comum (sem "turmas" e sem "campus"): vale para todas as turmas.
// Bloqueio por turma (com "turmas", ex.: Recepcao Calouros): vale so para as
// turmas listadas. Quem decide esses dias e a unidade academica; o
// administrador so cadastra na aba "feriados" da planilha (coluna "turmas").
// Feriado municipal (com "campus", ex.: Cameta): vale so para as turmas desse
// campus. O convert_data.py ja poe em "turmas" as turmas do campus.

// Campus da sede: tela sem turma (agenda geral, docente) mostra os feriados
// municipais daqui. Tem que ser igual a CAMPUS_PADRAO do convert_data.py.
export const CAMPUS_PADRAO = 'Bragança';

const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

function turmasDoFeriado(feriado) {
  return Array.isArray(feriado?.turmas)
    ? feriado.turmas.map((t) => String(t || '').trim()).filter(Boolean)
    : [];
}

function dataDoFeriado(feriado) {
  return String(feriado?.data || feriado || '').trim();
}

// turmaId vazio = tela sem turma (ex.: agenda geral): feriados comuns + os
// municipais do campus da sede.
export function feriadoValeParaTurma(feriado, turmaId = '') {
  const turmas = turmasDoFeriado(feriado);
  const campus = String(feriado?.campus || '').trim();
  const turma = String(turmaId || '').trim();
  if (!turma) return campus ? semAcento(campus) === semAcento(CAMPUS_PADRAO) : turmas.length === 0;
  if (campus) return turmas.includes(turma);
  if (turmas.length === 0) return true;
  return turmas.includes(turma);
}

export function feriadosDaTurma(feriados = [], turmaId = '') {
  return (Array.isArray(feriados) ? feriados : []).filter((f) => dataDoFeriado(f) && feriadoValeParaTurma(f, turmaId));
}

export function datasFeriadoDaTurma(feriados = [], turmaId = '') {
  return new Set(feriadosDaTurma(feriados, turmaId).map(dataDoFeriado));
}
