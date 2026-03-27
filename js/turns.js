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
  
  let fromArr = hp[fromTurno];
  if (!fromArr) {
    const normalizedFrom = normalizeTurnoKey(fromTurno);
    const keyFrom = Object.keys(hp).find((k) => normalizeTurnoKey(k) === normalizedFrom);
    fromArr = keyFrom ? hp[keyFrom] : null;
  }
  if (!fromArr) {
    fromArr = Object.values(hp).find(arr => arr.includes(slotString));
  }
  if (!fromArr) return slotString;

  let toArr = hp[toTurno];
  if (!toArr) {
    const normalizedTo = normalizeTurnoKey(toTurno);
    const keyTo = Object.keys(hp).find((k) => normalizeTurnoKey(k) === normalizedTo);
    toArr = keyTo ? hp[keyTo] : null;
  }
  if (!toArr) return slotString;

  const idx = fromArr.findIndex(s => s === slotString || (s.includes('INTERVALO') && slotString.includes('INTERVALO')));
  if (idx !== -1 && idx < toArr.length) {
    return toArr[idx];
  }
  return slotString;
}
