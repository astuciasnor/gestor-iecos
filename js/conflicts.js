import { sortUniqueIsoDates, normalizeShiftKey } from './academic_rules.mjs';

function normalizeConflictSlotLabel(value = '') {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*[-–]\s*/g, ' - ');
}

function addPairConflictEntry(targetMap, key, entry) {
  if (!targetMap.has(key)) {
    targetMap.set(key, {
      shift: entry.shift,
      slot: entry.slot,
      turmas: new Set(entry.turmas || []),
      componentes: new Set(entry.componentes || []),
      importado: false,
      dates: []
    });
  }

  const current = targetMap.get(key);
  current.shift = current.shift || entry.shift;
  current.slot = current.slot || entry.slot;
  if (entry.importado) current.importado = true;
  (entry.turmas || []).forEach((turma) => current.turmas.add(turma));
  (entry.componentes || []).forEach((componente) => current.componentes.add(componente));
  if (entry.date) current.dates.push(entry.date);
}

export function detectTeacherConflicts({
  eventsByDate = {},
  resolveShift = null,
  formatTurmaLabel = null
} = {}) {
  const aggregates = new Map();

  Object.entries(eventsByDate || {}).forEach(([dateStr, events]) => {
    const slotMap = new Map();

    (Array.isArray(events) ? events : []).forEach((event) => {
      const slot = normalizeConflictSlotLabel(event?.horario || '');
      if (!slot) return;
      if (!slotMap.has(slot)) slotMap.set(slot, []);
      slotMap.get(slot).push(event);
    });

    slotMap.forEach((slotEvents, slot) => {
      if (!Array.isArray(slotEvents) || slotEvents.length < 2) return;

      for (let i = 0; i < slotEvents.length; i++) {
        for (let j = i + 1; j < slotEvents.length; j++) {
          const eventA = slotEvents[i];
          const eventB = slotEvents[j];
          const turmaA = typeof formatTurmaLabel === 'function'
            ? formatTurmaLabel(eventA)
            : String(eventA?.turmaId || '').trim();
          const turmaB = typeof formatTurmaLabel === 'function'
            ? formatTurmaLabel(eventB)
            : String(eventB?.turmaId || '').trim();
          const componenteA = String(eventA?.disciplina || '').trim();
          const componenteB = String(eventB?.disciplina || '').trim();
          const eventKeyA = [turmaA, componenteA, String(eventA?.subGrupo || '').trim()].join('|');
          const eventKeyB = [turmaB, componenteB, String(eventB?.subGrupo || '').trim()].join('|');

          if (!eventKeyA || !eventKeyB || eventKeyA === eventKeyB) continue;

          const orderedTurmas = [turmaA, turmaB].filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
          const orderedComponentes = [componenteA, componenteB].filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
          const shift = typeof resolveShift === 'function'
            ? String(resolveShift(slot, eventA) || resolveShift(slot, eventB) || '').trim()
            : '';
          const aggregateKey = [
            orderedTurmas.join('||'),
            orderedComponentes.join('||'),
            normalizeShiftKey(shift),
            slot
          ].join('|||');

          addPairConflictEntry(aggregates, aggregateKey, {
            date: dateStr,
            shift,
            slot,
            turmas: orderedTurmas,
            componentes: orderedComponentes,
            importado: !!(eventA?.importado || eventB?.importado)
          });
        }
      }
    });
  });

  return [...aggregates.values()]
    .map((entry) => {
      const orderedDates = sortUniqueIsoDates(entry.dates);
      const startDate = orderedDates[0] || '';
      const endDate = orderedDates[orderedDates.length - 1] || startDate;
      const turmas = [...entry.turmas].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
      const componentes = [...entry.componentes].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));

      return {
        startDate,
        endDate,
        shift: entry.shift || '',
        slot: entry.slot || '',
        turmas,
        componentes,
        importado: !!entry.importado,
        description: `Choque no mesmo horario (${entry.slot || 'horario nao identificado'}).`
      };
    })
    .sort((a, b) => {
      if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate);
      if (a.shift !== b.shift) return a.shift.localeCompare(b.shift, 'pt-BR', { sensitivity: 'base' });
      if (a.slot !== b.slot) return a.slot.localeCompare(b.slot, 'pt-BR', { sensitivity: 'base' });
      return a.componentes.join(' | ').localeCompare(b.componentes.join(' | '), 'pt-BR', { sensitivity: 'base' });
    });
}
