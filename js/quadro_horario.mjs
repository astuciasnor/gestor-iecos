// Conversao de ofertas entre quadros de horario (regimes).
// Quando um curso muda de quadro (ex.: MT de 13:30 para 14:00), as ofertas ja
// salvas continuam com os rotulos antigos. Aqui elas passam ao quadro atual,
// aula por aula: 1a aula do turno -> 1a aula do turno no quadro novo, e assim
// por diante. Aulas sem correspondente (o quadro novo tem menos) ficam como estao.

function normalizarRotulo(valor) {
  return String(valor || '').trim().replace(/\s+/g, ' ').replace(/\s*[-–]\s*/g, ' - ');
}

function apenasAulas(lista) {
  return (Array.isArray(lista) ? lista : [])
    .map(normalizarRotulo)
    .filter((rotulo) => rotulo && !/intervalo/i.test(rotulo));
}

// quadros: { "1": { Tarde: [...] }, "2": {...} } (horarios_por_regime).
// Retorna Map rotulo antigo -> rotulo do quadro destino.
export function buildQuadroConversionMap(quadros = {}, regimeDestino = '') {
  const destino = quadros?.[regimeDestino] || {};
  const rotulosDestino = new Set(Object.values(destino).flatMap(apenasAulas));
  const mapa = new Map();

  Object.entries(quadros || {}).forEach(([regime, turnos]) => {
    if (regime === String(regimeDestino)) return;
    Object.entries(turnos || {}).forEach(([turno, lista]) => {
      const origem = apenasAulas(lista);
      const alvo = apenasAulas(destino[turno]);
      origem.forEach((rotulo, i) => {
        if (i >= alvo.length || rotulosDestino.has(rotulo) || mapa.has(rotulo)) return;
        mapa.set(rotulo, alvo[i]);
      });
    });
  });

  return mapa;
}

function trocarRotulo(valor, mapa) {
  if (!/\d{1,2}:\d{2}/.test(valor)) return valor;
  return mapa.get(normalizarRotulo(valor)) ?? valor;
}

function converterNo(no, mapa) {
  let mudou = false;
  const chaves = Array.isArray(no) ? no.keys() : Object.keys(no);
  for (const chave of chaves) {
    const valor = no[chave];
    if (typeof valor === 'string') {
      const novo = trocarRotulo(valor, mapa);
      if (novo !== valor) {
        no[chave] = novo;
        mudou = true;
      }
    } else if (valor && typeof valor === 'object') {
      mudou = converterNo(valor, mapa) || mudou;
    }
  }
  return mudou;
}

// Troca, em todos os campos da alocacao, os rotulos do quadro antigo pelos do
// quadro atual. Altera a propria alocacao; retorna true se algo mudou.
export function convertAllocationQuadro(alloc, mapa) {
  if (!alloc || typeof alloc !== 'object' || !mapa?.size) return false;
  return converterNo(alloc, mapa);
}
