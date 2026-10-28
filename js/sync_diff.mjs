// Regras puras da sincronizacao com o banco compartilhado (sem rede, sem DOM).
// "synced" e um Map id -> { h: hash da ultima versao confirmada no servidor, c: curso }.

// JSON com chaves ordenadas: o jsonb do Postgres reordena as chaves, entao a
// comparacao precisa ignorar a ordem.
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

// Hash curto (cyrb53) para guardar no navegador sem duplicar os dados.
export function hashAllocation(alloc) {
  const str = stableStringify(alloc);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function getAllocationCurso(alloc, turmaParaCurso = {}) {
  const turmaId = String(alloc?.turmaId || '').trim();
  const mapped = turmaParaCurso[turmaId];
  if (mapped) return String(mapped).toUpperCase();
  const prefix = turmaId.match(/^[A-Za-z]+/);
  return prefix ? prefix[0].toUpperCase() : '';
}

// O que enviar ao servidor: alteracoes locais de cursos editaveis.
// Alteracoes em cursos de outros coordenadores vao para "blocked".
export function computePushPlan({ allocations = [], synced = new Map(), canEdit, cursoOf }) {
  const upserts = [];
  const deletes = [];
  const blocked = [];
  const currentIds = new Set();

  allocations.forEach((alloc) => {
    if (!alloc?.id) return;
    currentIds.add(alloc.id);
    const hash = hashAllocation(alloc);
    const prev = synced.get(alloc.id);
    if (prev && prev.h === hash) return;
    const curso = cursoOf(alloc);
    if (!canEdit(curso) || (prev && !canEdit(prev.c))) {
      blocked.push({ id: alloc.id, curso: prev?.c || curso });
      return;
    }
    upserts.push({ alloc, curso, hash });
  });

  synced.forEach((prev, id) => {
    if (currentIds.has(id)) return;
    if (!canEdit(prev.c)) {
      blocked.push({ id, curso: prev.c, removed: true });
      return;
    }
    deletes.push(id);
  });

  return { upserts, deletes, blocked };
}

// Junta o que esta no navegador com o que veio do servidor.
// - alocacao alterada localmente e ainda nao enviada (curso editavel): fica a local;
// - demais: vale a do servidor;
// - apagada no servidor: sai; criada localmente e nunca enviada: fica se editavel.
export function reconcileAllocations({ local = [], remote = [], synced = new Map(), canEdit, cursoOf }) {
  const remoteById = new Map(remote.map((a) => [a.id, a]));
  const result = [];
  const seen = new Set();

  local.forEach((alloc) => {
    if (!alloc?.id || seen.has(alloc.id)) return;
    const prev = synced.get(alloc.id);
    const remoteAlloc = remoteById.get(alloc.id);
    const editable = canEdit(cursoOf(alloc));
    const dirty = !prev || prev.h !== hashAllocation(alloc);

    if (remoteAlloc) {
      result.push(editable && prev && dirty ? alloc : remoteAlloc);
    } else if (!prev && editable) {
      result.push(alloc);
    } else {
      return;
    }
    seen.add(alloc.id);
  });

  const localIds = new Set(local.map((a) => a?.id));
  remote.forEach((alloc) => {
    if (seen.has(alloc.id)) return;
    // Apagada localmente e ainda nao enviada: nao ressuscita.
    if (synced.has(alloc.id) && !localIds.has(alloc.id) && canEdit(cursoOf(alloc))) return;
    seen.add(alloc.id);
    result.push(alloc);
  });

  return result;
}

export function buildSyncedMap(remote = [], cursoOf) {
  return new Map(remote.map((a) => [a.id, { h: hashAllocation(a), c: cursoOf(a) }]));
}
