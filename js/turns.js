export function normalizeTurnoKey(value) {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (normalized.includes('manh') && normalized.includes('tard') && normalized.includes('noit')) return 'integral';
  if (normalized.includes('manh') && normalized.includes('tard')) return 'manha_tarde';
  if (normalized.includes('tard') && normalized.includes('noit')) return 'tarde_noite';
  if (normalized.includes('manh') && normalized.includes('noit')) return 'manha_noite';
  if (normalized.includes('integral')) return 'integral';
  
  if (normalized.includes('manh')) return 'manha';
  if (normalized.includes('tard')) return 'tarde';
  if (normalized.includes('noit') || normalized.includes('noite')) return 'noite';
  return normalized;
}

export function getHorariosByTurno(turno, hp) {
  if (!hp || typeof hp !== 'object') return [];
  const normalizedTurno = normalizeTurnoKey(turno);

  const getSlice = (norm) => {
    const key = Object.keys(hp).find(k => normalizeTurnoKey(k) === norm);
    return (key && Array.isArray(hp[key])) ? hp[key] : [];
  };

  if (normalizedTurno === 'manha_tarde') {
    const manha = getSlice('manha');
    const tarde = getSlice('tarde');
    const combined = [...manha];
    if (manha.length > 0 && tarde.length > 0) combined.push('INTERVALO (Almoço)');
    return [...combined, ...tarde];
  }
  if (normalizedTurno === 'tarde_noite') {
    const tarde = getSlice('tarde');
    const noite = getSlice('noite');
    const combined = [...tarde];
    if (tarde.length > 0 && noite.length > 0) combined.push('INTERVALO (Jantar)');
    return [...combined, ...noite];
  }
  if (normalizedTurno === 'manha_noite') {
    const manha = getSlice('manha');
    const noite = getSlice('noite');
    const combined = [...manha];
    if (manha.length > 0 && noite.length > 0) combined.push('INTERVALO (Manhã-Noite)');
    return [...combined, ...noite];
  }
  if (normalizedTurno === 'integral') {
    const manha = getSlice('manha');
    const tarde = getSlice('tarde');
    const noite = getSlice('noite');
    let combined = [...manha];
    if (manha.length > 0 && tarde.length > 0) combined.push('INTERVALO (Almoço)');
    combined = [...combined, ...tarde];
    if (tarde.length > 0 && noite.length > 0) combined.push('INTERVALO (Jantar)');
    return [...combined, ...noite];
  }

  const key = Object.keys(hp).find((k) => k === turno || normalizeTurnoKey(k) === normalizedTurno);
  if (key && Array.isArray(hp[key])) return hp[key];

  return [];
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

  let fromArr = getHorariosByTurno(fromTurno, hp);
  if (!fromArr || fromArr.length === 0) {
    fromArr = Object.values(hp).find(arr => arr.includes(slotString));
  }
  if (!fromArr) return slotString;

  const toArr = getHorariosByTurno(toTurno, hp);
  if (!toArr || toArr.length === 0) return slotString;

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
