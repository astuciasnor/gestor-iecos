// Botao "Completar" da Lista de Ofertas: a oferta tem menos aulas que a carga
// horaria (foi cortada no fim do periodo ou da faixa). Aqui ficam as pecas puras
// das alternativas (testadas em tests/completar_carga.test.mjs); o calculo das
// aulas, as checagens de turma e de professor e o ensaio do recalculo geral
// ficam em ui.js.
//
// Faixa esperada: { inicio, fim, dias, slots, drawnSlotsByDay: { dia: [horarios] } }

import { addDaysIso } from './troca_ordem.mjs';

function weekdayOf(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();
}

function startMinutes(slot) {
  const match = String(slot || '').match(/(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
}

// Semanas da oferta (segunda a domingo, cortadas no inicio e no fim).
function weekStarts(inicio, fim) {
  const starts = [inicio];
  let dia = addDaysIso(inicio, 1);
  for (; dia <= fim; dia = addDaysIso(dia, 1)) {
    if (weekdayOf(dia) === 1) starts.push(dia);
  }
  return starts;
}

// Janelas [desde, ate] onde o acrescimo pode valer: primeiro as de 1 semana
// (da ultima para a primeira), depois as de 2 semanas, e assim por diante.
// Assim a alternativa usa o menor numero de semanas possivel.
export function candidateWindows(inicio, fim) {
  if (!inicio || !fim || inicio > fim) return [];
  const starts = weekStarts(inicio, fim);
  const total = starts.length;
  const janelas = [];
  for (let semanas = 1; semanas <= total; semanas++) {
    for (let i = total - semanas; i >= 0; i--) {
      const ate = i + semanas < total ? addDaysIso(starts[i + semanas], -1) : fim;
      janelas.push([starts[i], ate]);
    }
  }
  return janelas;
}

// Faixas com horarios a mais entre "desde" e "ate" (inclusive): as faixas que
// cruzam a janela sao divididas e, dentro dela, recebem extraFor(faixa)
// ({ dia: [horarios] }) somado ao seu padrao. Fora da janela nada muda.
export function addToPatternBetween(faixas, desde, ate, extraFor) {
  const comExtra = (faixa) => {
    const drawn = {};
    Object.entries(faixa.drawnSlotsByDay || {}).forEach(([dia, slots]) => { drawn[dia] = [...slots]; });
    Object.entries(extraFor(faixa) || {}).forEach(([dia, slots]) => {
      drawn[dia] = [...new Set([...(drawn[dia] || []), ...slots])];
    });
    return { ...faixa, drawnSlotsByDay: drawn };
  };
  const out = [];
  faixas.forEach((faixa) => {
    const fim = faixa.fim || '9999-12-31';
    if (fim < desde || faixa.inicio > ate) {
      out.push(faixa);
      return;
    }
    if (faixa.inicio < desde) out.push({ ...faixa, fim: addDaysIso(desde, -1) });
    const dentroInicio = faixa.inicio > desde ? faixa.inicio : desde;
    const dentroFim = fim < ate ? faixa.fim : ate;
    out.push(comExtra({ ...faixa, inicio: dentroInicio, fim: dentroFim }));
    if (fim > ate) out.push({ ...faixa, inicio: addDaysIso(ate, 1), fim: faixa.fim });
  });
  return out;
}

// Horario vizinho ao padrao, no quadro do turno: o seguinte ao ultimo ou, se
// nao houver, o anterior ao primeiro. Null quando o padrao nao esta no quadro.
export function adjacentSlot(patternSlots = [], turnoSlots = []) {
  const quadro = turnoSlots.filter((slot) => Number.isFinite(startMinutes(slot)));
  const usados = new Set(patternSlots.map(startMinutes));
  const posicoes = quadro.map((slot, i) => (usados.has(startMinutes(slot)) ? i : -1)).filter((i) => i >= 0);
  if (!posicoes.length) return null;
  const depois = quadro[posicoes[posicoes.length - 1] + 1];
  if (depois && !usados.has(startMinutes(depois))) return depois;
  const antes = quadro[posicoes[0] - 1];
  return antes && !usados.has(startMinutes(antes)) ? antes : null;
}

// O padrao comeca de manha? (para oferecer sabado de manha a turmas da tarde/noite)
export function isMorningPattern(slots = []) {
  const minutos = slots.map(startMinutes).filter(Number.isFinite);
  return minutos.length > 0 && Math.min(...minutos) < 12 * 60;
}
