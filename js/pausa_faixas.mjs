// Pausa de uma componente: dias sem aula ENTRE duas faixas.
// Funcoes puras (sem DOM nem store), testadas em tests/pausa_faixas.test.mjs.
//
// Normalmente cada faixa termina na vespera do inicio da seguinte. Quando o
// coordenador digita um Fim mais cedo, os dias entre esse Fim e o inicio da
// faixa seguinte ficam sem aula: e a pausa. Ex.: Faixa 1 de 15/03 a 16/03 e
// Faixa 2 a partir de 13/04 => pausa de 17/03 a 12/04.
//
// A pausa nao e uma faixa (nao gasta uma das 3) e nao precisa de campo novo:
// os motores do calendario (calendar.js) e do salvamento (faixa_utils.js) ja
// tratam a data sem faixa vigente como dia sem aula.
//
// Faixa esperada: { inicio: 'AAAA-MM-DD', fim: 'AAAA-MM-DD' | '' | null }

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function isIso(value) {
  return ISO_RE.test(String(value || '').trim());
}

export function shiftIso(iso, days) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10);
}

// O Fim digitado abre uma pausa antes da faixa seguinte? So quando fica pelo
// menos um dia livre entre os dois (Fim < vespera do proximo inicio).
export function isPauseEnd(inicio, fim, proximoInicio) {
  if (!isIso(inicio) || !isIso(fim) || !isIso(proximoInicio)) return false;
  if (fim < inicio) return false;
  return fim < shiftIso(proximoInicio, -1);
}

// Pausas de uma lista de faixas: [{ aposFaixa, inicio, fim }], onde aposFaixa e
// o numero (1, 2...) da faixa que para; inicio/fim sao os dias sem aula.
export function listFaixaPauses(faixas = []) {
  const ordenadas = (Array.isArray(faixas) ? faixas : [])
    .filter((f) => f && isIso(f.inicio))
    .slice()
    .sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));

  const pausas = [];
  for (let i = 0; i < ordenadas.length - 1; i++) {
    const atual = ordenadas[i];
    const proxima = ordenadas[i + 1];
    if (!isPauseEnd(atual.inicio, atual.fim, proxima.inicio)) continue;
    pausas.push({
      aposFaixa: i + 1,
      inicio: shiftIso(atual.fim, 1),
      fim: shiftIso(proxima.inicio, -1)
    });
  }
  return pausas;
}

export function hasFaixaPause(faixas = []) {
  return listFaixaPauses(faixas).length > 0;
}

// Fecha os Fins das faixas para o salvamento: cada faixa termina na vespera da
// seguinte, EXCETO quando o Fim marcado como pausa (pausaPorIndice[i] = true)
// para antes disso. Devolve uma copia; a ultima faixa fica como veio.
export function closeFaixaEnds(faixas = [], pausaPorIndice = {}) {
  const ordenadas = (Array.isArray(faixas) ? faixas : [])
    .map((f) => ({ ...f }))
    .sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));

  for (let i = 0; i < ordenadas.length - 1; i++) {
    const atual = ordenadas[i];
    const proximoInicio = ordenadas[i + 1].inicio;
    const manterPausa = !!pausaPorIndice[i] && isPauseEnd(atual.inicio, atual.fim, proximoInicio);
    if (!manterPausa) atual.fim = shiftIso(proximoInicio, -1);
  }
  return ordenadas;
}
