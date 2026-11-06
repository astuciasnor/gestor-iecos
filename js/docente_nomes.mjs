// Regras de nomes de docentes, sem tela nem store (testaveis no Node).
// Usadas pelo aviso de "nome novo" e pela janela "Cadastrar Docente Temporario".

// So Substituto e Visitante sao cadastrados pelos coordenadores. Efetivo: e-mail
// para o administrador. Pos-graduando, colaborador ou voluntario: a componente
// fica no nome do professor responsavel.
export const VINCULOS_TEMPORARIOS = ['Substituto', 'Visitante'];

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
