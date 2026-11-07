// Regras de nomes de docentes, sem tela nem store (testaveis no Node).
// Usadas pelo aviso de "nome novo", pela janela "Cadastrar Docente Novo" e pelo painel do administrador.

// Vinculos que o coordenador pode cadastrar. Pos-graduando, colaborador ou
// voluntario nao: a componente fica no nome do professor responsavel.
export const VINCULOS_DOCENTE_NOVO = ['Substituto', 'Visitante', 'Efetivo'];

// Unidades com subunidades conhecidas. Professor de outra unidade: o coordenador
// digita unidade e subunidade (ex.: CANAN / FACFIS) e o administrador confere.
export const OUTRA_UNIDADE = 'OUTRA';
export const UNIDADES = [
    { sigla: 'IECOS', nome: 'IECOS', subunidades: ['FEPESCA', 'FACIN', 'FBIO'] },
    { sigla: 'CBRAG', nome: 'Campus Bragança', subunidades: ['FACED', 'FAHIST', 'FAMAT', 'FALE', 'FALEST'] }
];

export function normalizeTeacherNameForMatch(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function limparEspacos(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

// Nomes digitados que nao estao na lista conhecida (ignora maiusculas e acentos).
export function findNewNames(nomes = [], conhecidos = []) {
    const lista = new Set(conhecidos.map(normalizeTeacherNameForMatch));
    const vistos = new Set();
    return nomes
        .map(limparEspacos)
        .filter((n) => n && !/^a definir$/i.test(n))
        .filter((n) => {
            const chave = normalizeTeacherNameForMatch(n);
            if (lista.has(chave) || vistos.has(chave)) return false;
            vistos.add(chave);
            return true;
        });
}

const CONECTIVOS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

function partesDoNome(nome) {
    return normalizeTeacherNameForMatch(nome)
        .split(' ')
        .filter((p) => p.length > 1 && !CONECTIVOS.has(p));
}

// Nomes da lista que podem ser a mesma pessoa: mesmo primeiro e ultimo nome,
// ou todas as partes de um aparecem no outro ("Ana B. Lima" x "Ana Beatriz Lima").
export function findSimilarNames(nome, conhecidos = [], max = 3) {
    const alvo = partesDoNome(nome);
    if (alvo.length < 2) return [];
    const chave = normalizeTeacherNameForMatch(nome);
    return conhecidos
        .filter((outro) => normalizeTeacherNameForMatch(outro) !== chave)
        .filter((outro) => {
            const partes = partesDoNome(outro);
            if (partes.length < 2) return false;
            if (partes[0] === alvo[0] && partes[partes.length - 1] === alvo[alvo.length - 1]) return true;
            const [menor, maior] = alvo.length <= partes.length ? [alvo, partes] : [partes, alvo];
            return menor.every((p) => maior.includes(p));
        })
        .slice(0, max);
}

// Motivo para nao aceitar o nome como esta ('' = parece bom).
export function problemaNoNome(nome) {
    const partes = limparEspacos(nome).split(' ').filter(Boolean);
    if (partes.length < 2) return 'Digite nome e sobrenome.';
    const titulo = partes.find((p) => /^(prof|profa|professor|professora|dr|dra|msc|phd)\.?$/i.test(p));
    if (titulo) return `Tire o título "${titulo}" e deixe só o nome.`;
    const abreviado = partes.find((p) => /^\p{L}{1,3}\.$/u.test(p) || (/^\p{L}$/u.test(p) && !/^e$/i.test(p)));
    if (abreviado) return `"${abreviado}" parece abreviação. Escreva o nome por extenso.`;
    return '';
}

// Docentes cadastrados pelos coordenadores que ainda nao estao na planilha
// (dados_app.json). allocationsByPlan: { chaveDoPeriodo: [alocacoes] }.
// Um item por nome, com as turmas/componentes onde aparece. Revisados saem da lista.
export function listarDocentesParaConferir(allocationsByPlan = {}, nomesPlanilha = []) {
    const naPlanilha = new Set(nomesPlanilha.map(normalizeTeacherNameForMatch));
    const porNome = new Map();
    Object.values(allocationsByPlan || {}).forEach((alocacoes) => {
        (Array.isArray(alocacoes) ? alocacoes : []).forEach((alloc) => {
            (Array.isArray(alloc?.docentesCadastrados) ? alloc.docentesCadastrados : []).forEach((cad) => {
                const chave = normalizeTeacherNameForMatch(cad?.nome);
                if (!chave || cad.revisado || naPlanilha.has(chave)) return;
                if (!porNome.has(chave)) porNome.set(chave, { ...cad, usos: [] });
                const item = porNome.get(chave);
                if (String(cad.em || '') < String(item.em || '')) Object.assign(item, { ...cad, usos: item.usos });
                const uso = [alloc.turmaId, alloc.disciplina].filter(Boolean).join(' · ');
                if (uso && !item.usos.includes(uso)) item.usos.push(uso);
            });
        });
    });
    return [...porNome.values()].sort((a, b) => String(b.em || '').localeCompare(String(a.em || '')));
}

// Revisao do administrador: troca o nome antigo pelo revisado (docente unico,
// lista de docentes e rotulo "(Multiplos)") e atualiza o cadastro, mantendo quem
// cadastrou. Devolve uma copia alterada da alocacao, ou null se nada mudou.
// revisao: { nome, vinculo, unidade, subunidade, por, porNome, em }
export function aplicarRevisaoDocente(alloc, nomeAntigo, revisao) {
    const chave = normalizeTeacherNameForMatch(nomeAntigo);
    if (!alloc || !chave) return null;
    const copia = structuredClone(alloc);
    let mudou = false;

    if (normalizeTeacherNameForMatch(copia.docente) === chave) {
        copia.docente = revisao.nome;
        mudou = true;
    }
    if (Array.isArray(copia.docentes)) {
        let mudouLista = false;
        copia.docentes.forEach((d) => {
            if (d && normalizeTeacherNameForMatch(d.nome) === chave) {
                d.nome = revisao.nome;
                mudouLista = true;
            }
        });
        // Mesmo rotulo que o formulario monta para varios docentes.
        if (mudouLista && /\(m[uú]ltiplos\)/i.test(String(copia.docente || ''))) {
            copia.docente = `${copia.docentes.map((d) => String(d?.nome || '').split(' ')[0]).join(' / ')} (Múltiplos)`;
        }
        mudou = mudou || mudouLista;
    }
    if (Array.isArray(copia.docentesCadastrados)) {
        copia.docentesCadastrados = copia.docentesCadastrados.map((cad) => {
            if (normalizeTeacherNameForMatch(cad?.nome) !== chave) return cad;
            mudou = true;
            const { outraUnidade: _digitadaPeloCoordenador, ...resto } = cad;
            return {
                ...resto,
                nome: revisao.nome,
                vinculo: revisao.vinculo,
                unidade: revisao.unidade,
                subunidade: revisao.subunidade,
                cadastradoComo: cad.cadastradoComo || {
                    nome: cad.nome, vinculo: cad.vinculo, unidade: cad.unidade, subunidade: cad.subunidade
                },
                revisado: { por: revisao.por || '', porNome: revisao.porNome || '', em: revisao.em || '' }
            };
        });
    }
    return mudou ? copia : null;
}
