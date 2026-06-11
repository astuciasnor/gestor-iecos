export function normalizeTurnoKey(value) {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  if (normalized.includes('manh')) return 'manha';
  if (normalized.includes('tard')) return 'tarde';
  if (normalized.includes('noit')) return 'noite';
  return normalized;
}

export function getTurnoLetter(slotString) {
  const match = String(slotString || '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const totalMinutes = h * 60 + m;

  if (totalMinutes < (12 * 60 + 30)) return 'M';
  if (totalMinutes < (18 * 60 + 30)) return 'T';
  return 'N';
}

export function mapSlotToTurno(slotString, fromTurno, toTurno, horariosPorTurno) {
  if (!horariosPorTurno) return slotString;
  const hp = horariosPorTurno;

  const getArr = (turno) => {
    if (Array.isArray(hp[turno])) return hp[turno];
    const normalized = normalizeTurnoKey(turno);
    const key = Object.keys(hp).find((k) => normalizeTurnoKey(k) === normalized);
    if (key && Array.isArray(hp[key])) return hp[key];
    return null;
  };

  let fromArr = getArr(fromTurno);
  if (!fromArr) {
    fromArr = Object.values(hp).find(arr => arr.includes(slotString));
  }
  if (!fromArr) return slotString;

  const toArr = getArr(toTurno);
  if (!toArr) return slotString;

  const isInterval = (s) => String(s || '').toUpperCase().includes('INTERVALO');
  const sourceIsInt = isInterval(slotString);

  // Mapeamento inteligente: pareia classes com classes e intervalos com intervalos, ignorando a posição absoluta
  let sourceRank = -1;
  let currentRank = 0;
  for (let i = 0; i < fromArr.length; i++) {
    const s = fromArr[i];
    if (s === slotString || (sourceIsInt && isInterval(s) && (s.includes('INTERVALO') && slotString.includes('INTERVALO')))) {
      sourceRank = currentRank;
      break;
    }
    if (isInterval(s) === sourceIsInt) currentRank++;
  }

  if (sourceRank !== -1) {
    let targetRank = 0;
    for (let i = 0; i < toArr.length; i++) {
      const s = toArr[i];
      if (isInterval(s) === sourceIsInt) {
        if (targetRank === sourceRank) return s;
        targetRank++;
      }
    }
  }

  // Fallback para o comportamento original (índice absoluto) caso o rank falhe
  const idx = fromArr.findIndex(s => s === slotString || (s.includes('INTERVALO') && slotString.includes('INTERVALO')));
  if (idx !== -1 && idx < toArr.length) {
    return toArr[idx];
  }
  return slotString;
}
