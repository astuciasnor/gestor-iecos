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
    { sigla: 'CBRAG', nome: 'Campus Bragança', subunidades: ['FACED', 'FAHIST', 'FAMAT', 'FALE', 'FALEST'] },
    { sigla: 'CANAN', nome: 'Campus de Ananindeua', subunidades: ['FACFIS'] }
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

// ---- Comparar e achar nomes (com ou sem acento) ----
// Regra unica do Cardume: o mesmo nome ignorando acentos, maiusculas e
// espacos e a mesma pessoa ("Zelia" = "Zélia"); os sobrenomes distinguem
// pessoas com o mesmo primeiro nome.

export function mesmoDocente(a, b) {
    const chave = normalizeTeacherNameForMatch(a);
    return !!chave && chave === normalizeTeacherNameForMatch(b);
}

// Um nome por pessoa, na ordem recebida: vale a primeira grafia que aparecer
// (quem chama poe a planilha de docentes antes das alocacoes).
export function umNomePorPessoa(nomes = []) {
    const porChave = new Map();
    (Array.isArray(nomes) ? nomes : []).forEach((nome) => {
        const chave = normalizeTeacherNameForMatch(nome);
        if (chave && !porChave.has(chave)) porChave.set(chave, nome);
    });
    return [...porChave.values()];
}

// Sugestoes para o que foi digitado: nomes com TODAS as partes digitadas, em
// qualquer ordem ("marcos laz"), com ou sem acento nos dois sentidos ("Láz"
// acha "Lazaro"). Primeiro os que comecam pelo texto, depois os que tem uma
// palavra comecando assim, depois o resto; em cada grupo, ordem alfabetica.
// Campo vazio: todos, em ordem alfabetica.
export function filtrarDocentes(digitado, nomes = [], max = 50) {
    const lista = (Array.isArray(nomes) ? nomes : []).filter(Boolean);
    const termo = normalizeTeacherNameForMatch(digitado);
    const ordenar = (a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });
    if (!termo) return lista.slice().sort(ordenar).slice(0, max);
    const partes = termo.split(' ');
    const grupo = (chave) => {
        if (chave.startsWith(termo)) return 0;
        if (chave.split(' ').some((p) => p.startsWith(partes[0]))) return 1;
        return 2;
    };
    return lista
        .map((nome) => ({ nome, chave: normalizeTeacherNameForMatch(nome) }))
        .filter(({ chave }) => partes.every((p) => chave.includes(p)))
        .sort((a, b) => grupo(a.chave) - grupo(b.chave) || ordenar(a.nome, b.nome))
        .slice(0, max)
        .map(({ nome }) => nome);
}

// Nome da lista para o que foi digitado ("zelia maria pimental nunes" ->
// "Zélia Maria Pimental Nunes"). Com parcial, vale um pedaco (3+ letras) que
// so um docente tenha, pela mesma regra das sugestoes ("glaucia").
// Sem um nome unico, devolve null (o texto fica como foi digitado).
export function acharNomeConhecido(digitado, conhecidos = [], { parcial = false } = {}) {
    const chave = normalizeTeacherNameForMatch(digitado);
    if (!chave) return null;
    const lista = (Array.isArray(conhecidos) ? conhecidos : []).filter(Boolean);
    const exato = lista.find((nome) => mesmoDocente(nome, chave));
    if (exato) return exato;
    if (!parcial || chave.length < 3) return null;
    const achados = filtrarDocentes(digitado, umNomePorPessoa(lista), 2);
    return achados.length === 1 ? achados[0] : null;
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

// ---- Vaga: docente ainda sem nome (substituto a contratar, professor nao contatado) ----
// O nome da vaga e gerado pela janela de cadastro: "Vaga1 FACIN", "Vaga2 FACIN",
// numerado por subunidade. A grade mostra a primeira palavra ("Vaga1"); a Agenda
// Publica, o nome inteiro. A mesma vaga em duas componentes no mesmo horario e choque.
const REGEX_VAGA = /^vaga(\d{1,2}) ([a-z0-9]+)$/;

export function ehVaga(nome) {
    return REGEX_VAGA.test(normalizeTeacherNameForMatch(nome));
}

// Rotulo curto (grade, calendario, "Multiplos"): o primeiro nome; vaga, inteira
// ("Vaga1 FBIO"), para nao confundir vagas de faculdades diferentes.
export function rotuloCurtoDocente(nome) {
    const texto = String(nome || '').trim();
    return ehVaga(texto) ? texto : (texto.split(/\s+/)[0] || texto);
}

export function siglaValida(sigla) {
    return /^[A-Za-z0-9]{2,12}$/.test(String(sigla || '').trim());
}

export function nomeDaVaga(numero, subunidade) {
    return `Vaga${numero} ${String(subunidade || '').trim().toUpperCase()}`;
}

// Menor numero livre para a subunidade, olhando os nomes ja usados.
export function proximaVaga(subunidade, nomes = []) {
    const sub = normalizeTeacherNameForMatch(subunidade);
    const usados = new Set();
    (Array.isArray(nomes) ? nomes : []).forEach((nome) => {
        const m = normalizeTeacherNameForMatch(nome).match(REGEX_VAGA);
        if (m && m[2] === sub) usados.add(Number(m[1]));
    });
    let n = 1;
    while (usados.has(n)) n += 1;
    return nomeDaVaga(n, subunidade);
}

// Nome improvisado para quem ainda nao tem nome ("n.n. (substituto)",
// "Professor Provisorio CN1", "Docente Temporario 1", "a contratar"...).
// Esses nomes nao passam: o caminho e cadastrar uma vaga.
const PALAVRAS_DE_VAGA = /\b(vaga\d*|substitut[oa]s?|provisori[oa]s?|temporari[oa]s?|contratar|contratad[oa]|definir|indefinid[oa]|docente|nn|xx+)\b/;
export function pareceVaga(nome) {
    if (ehVaga(nome)) return false;
    const chave = normalizeTeacherNameForMatch(nome);
    return !!chave && (PALAVRAS_DE_VAGA.test(chave) || /^n n\b/.test(chave));
}

// Motivo para nao aceitar o nome como esta ('' = parece bom).
export function problemaNoNome(nome) {
    if (ehVaga(nome)) return '';
    if (pareceVaga(nome)) return 'Docente ainda sem nome? Cadastre como vaga (botão "Cadastrar Vaga…").';
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

const ROTULO_MULTIPLOS = /\(m[uú]ltiplos\)/i;
export const A_DEFINIR = 'A definir';

// Mesmo rotulo que o formulario monta para varios docentes ("Evaldo / Chico (Múltiplos)").
function rotuloMultiplos(docentes) {
    const nomes = docentes.map((d) => {
        const nome = String(d?.nome || '');
        return /^a definir$/i.test(nome) ? A_DEFINIR : rotuloCurtoDocente(nome);
    });
    return `${nomes.join(' / ')} (Múltiplos)`;
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
        if (mudouLista && ROTULO_MULTIPLOS.test(String(copia.docente || ''))) {
            copia.docente = rotuloMultiplos(copia.docentes);
        }
        mudou = mudou || mudouLista;
    }
    if (Array.isArray(copia.docentesCadastrados)) {
        copia.docentesCadastrados = copia.docentesCadastrados.map((cad) => {
            if (normalizeTeacherNameForMatch(cad?.nome) !== chave) return cad;
            mudou = true;
            const { outraUnidade: _digitadaPeloCoordenador, vaga: _eraVaga, ...resto } = cad;
            return {
                ...resto,
                // Vaga trocada pelo nome da pessoa deixa de ser vaga.
                ...(ehVaga(revisao.nome) ? { vaga: true } : {}),
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

// Remocao de cadastro indevido pelo administrador: a componente fica (datas,
// horarios, faixas e carga de cada docente), so o nome vira "A definir" e o
// cadastro sai. Devolve uma copia alterada da alocacao, ou null se nada mudou.
export function removerDocenteDaAlocacao(alloc, nome) {
    const chave = normalizeTeacherNameForMatch(nome);
    if (!alloc || !chave) return null;
    const copia = structuredClone(alloc);
    let mudou = false;

    if (normalizeTeacherNameForMatch(copia.docente) === chave) {
        copia.docente = A_DEFINIR;
        mudou = true;
    }
    if (Array.isArray(copia.docentes)) {
        let mudouLista = false;
        copia.docentes.forEach((d) => {
            if (d && normalizeTeacherNameForMatch(d.nome) === chave) {
                d.nome = A_DEFINIR;
                mudouLista = true;
            }
        });
        if (mudouLista && ROTULO_MULTIPLOS.test(String(copia.docente || ''))) {
            copia.docente = rotuloMultiplos(copia.docentes);
        }
        mudou = mudou || mudouLista;
    }
    if (Array.isArray(copia.docentesCadastrados)) {
        const resto = copia.docentesCadastrados.filter((cad) => normalizeTeacherNameForMatch(cad?.nome) !== chave);
        if (resto.length !== copia.docentesCadastrados.length) {
            mudou = true;
            if (resto.length) copia.docentesCadastrados = resto;
            else delete copia.docentesCadastrados;
        }
    }
    return mudou ? copia : null;
}
