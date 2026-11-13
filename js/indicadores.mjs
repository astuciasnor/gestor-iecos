// Menu Indicadores: contas sobre as alocacoes, sem tela nem store (testaveis no Node).
//
// Carga por docente: quantas horas cada docente tem em cada curso e em cada PL.
// Conta tudo o que esta no Cardume (rascunho incluido): componentes com horario
// (semanal) ou em faixas. Pendentes (ainda sem horario) ficam de fora.
//
// Uma componente tem varias alocacoes (uma por horario/faixa); conta uma vez por
// oferta = turma + subturma + componente, em cada PL. Subturmas T01 e T02 sao
// ofertas diferentes: o mesmo docente nas duas conta as duas.
//
// CH do docente: componente dividida entre docentes = a parte declarada dele
// (30 de 90); docente unico = a CH da componente no PPC do curso da turma.

import { normalizeTeacherNameForMatch, ehVaga, nomeImprovisado } from './docente_nomes.mjs?v=202611132043';

export const SEM_DOCENTE = 'A definir';

function toCH(value) {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

// Nome da componente sem o "(60h)" do fim, sem diferenca de maiusculas/espacos.
function chaveDisciplina(nome) {
    return String(nome || '')
        .replace(/\s*\(\s*\d+\s*h\s*\)\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLocaleUpperCase('pt-BR');
}

// Vazio ou so o bloco ("BL6") = turma inteira; "BL6_T01" = subturma.
function chaveSubturma(subGrupo) {
    const sg = String(subGrupo || '').trim().toUpperCase();
    return !sg || /^BL\d+$/.test(sg) ? '' : sg;
}

function contaNaCarga(alloc) {
    const modo = String(alloc?.modo || '').trim().toLowerCase();
    return modo === 'semanal' || modo === 'faixas';
}

function semNome(nome) {
    const chave = normalizeTeacherNameForMatch(nome);
    return !chave || chave === 'a definir';
}

// Docentes declarados numa alocacao: [{ nome, ch }].
function docentesDaAlocacao(alloc) {
    if (Array.isArray(alloc?.docentes) && alloc.docentes.length) {
        return alloc.docentes
            .map((d) => ({ nome: String(d?.nome ?? d ?? '').trim(), ch: toCH(d?.ch) }))
            .filter((d) => !semNome(d.nome));
    }
    const unico = alloc?.docente && typeof alloc.docente === 'object' ? alloc.docente.nome : alloc?.docente;
    const nome = String(unico || '').trim();
    return semNome(nome) ? [] : [{ nome, ch: toCH(alloc?.ch) }];
}

// Ofertas de um PL: [{ turmaId, disciplina, curso, ch, docentes: [{ nome, ch }] }].
//   cursoDaTurma(turmaId) -> 'EP'; chDaComponente(disciplina, turmaId) -> 60.
export function ofertasDoPlano(allocations = [], { cursoDaTurma, chDaComponente }) {
    const porOferta = new Map();
    (Array.isArray(allocations) ? allocations : []).forEach((alloc) => {
        if (!contaNaCarga(alloc)) return;
        const turmaId = String(alloc?.turmaId || '').trim();
        const disciplina = String(alloc?.disciplina || '').trim();
        if (!turmaId || !disciplina) return;
        const chave = `${turmaId}|${chaveSubturma(alloc?.subGrupo)}|${chaveDisciplina(disciplina)}`;
        let oferta = porOferta.get(chave);
        if (!oferta) {
            const semSufixo = disciplina.replace(/\s*\(\s*\d+\s*h\s*\)\s*$/i, '').trim();
            oferta = {
                turmaId,
                disciplina,
                curso: cursoDaTurma(turmaId) || '?',
                ch: toCH(chDaComponente(disciplina, turmaId)) || toCH(chDaComponente(semSufixo, turmaId)) || toCH(alloc?.ch),
                docentes: new Map()
            };
            porOferta.set(chave, oferta);
        }
        // Junta os docentes de todas as alocacoes da oferta (a mesma pessoa uma vez).
        docentesDaAlocacao(alloc).forEach((d) => {
            const k = normalizeTeacherNameForMatch(d.nome);
            const ja = oferta.docentes.get(k);
            if (!ja) oferta.docentes.set(k, { ...d });
            else if (!ja.ch && d.ch) ja.ch = d.ch;
        });
    });
    return [...porOferta.values()].map((oferta) => {
        const lista = [...oferta.docentes.values()];
        const dividida = lista.length > 1;
        return {
            turmaId: oferta.turmaId,
            disciplina: oferta.disciplina,
            curso: oferta.curso,
            ch: oferta.ch,
            docentes: lista.map((d) => ({ nome: d.nome, ch: dividida ? d.ch : (oferta.ch || d.ch) }))
        };
    });
}

// planos: [{ periodo: 'PL1', allocations }]. Devolve:
//   linhas: [{ nome, vaga, improvisado, semDocente, porCurso: { EP: 60 }, porPL: { PL1: 60 }, total, ofertas }]
//   cursos / periodos: os que aparecem, na ordem pedida (ordemCursos) ou alfabetica.
// Ofertas sem docente entram numa linha "A definir" (semDocente: true) com a CH toda.
export function cargaPorDocente(planos = [], { cursoDaTurma, chDaComponente, ordemCursos = [] }) {
    const porPessoa = new Map();
    const cursos = new Set();
    const periodos = [];

    const linhaDe = (nome, extra = {}) => {
        const k = extra.semDocente ? '\u0000sem-docente' : normalizeTeacherNameForMatch(nome);
        let linha = porPessoa.get(k);
        if (!linha) {
            linha = { nome, vaga: ehVaga(nome), improvisado: nomeImprovisado(nome), semDocente: false, porCurso: {}, porPL: {}, total: 0, ofertas: 0, ...extra };
            porPessoa.set(k, linha);
        }
        return linha;
    };
    const somar = (linha, curso, periodo, ch) => {
        linha.porCurso[curso] = (linha.porCurso[curso] || 0) + ch;
        linha.porPL[periodo] = (linha.porPL[periodo] || 0) + ch;
        linha.total += ch;
        linha.ofertas += 1;
    };

    (Array.isArray(planos) ? planos : []).forEach(({ periodo, allocations }) => {
        const pl = String(periodo || '').trim() || '?';
        if (!periodos.includes(pl)) periodos.push(pl);
        ofertasDoPlano(allocations, { cursoDaTurma, chDaComponente }).forEach((oferta) => {
            cursos.add(oferta.curso);
            if (!oferta.docentes.length) {
                somar(linhaDe(SEM_DOCENTE, { semDocente: true }), oferta.curso, pl, oferta.ch);
                return;
            }
            oferta.docentes.forEach((d) => somar(linhaDe(d.nome), oferta.curso, pl, d.ch));
        });
    });

    const posicao = (sigla) => {
        const i = ordemCursos.indexOf(sigla);
        return i < 0 ? ordemCursos.length : i;
    };
    return {
        linhas: [...porPessoa.values()],
        cursos: [...cursos].sort((a, b) => posicao(a) - posicao(b) || a.localeCompare(b)),
        periodos: periodos.sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))
    };
}

// Ordem da tabela: pessoas (pelo total, maior primeiro, ou pela coluna escolhida),
// depois as vagas e os nomes improvisados ("n.n.") e por ultimo "A definir".
export function ordenarLinhas(linhas = [], { coluna = 'total', crescente = false } = {}) {
    const grupo = (l) => (l.semDocente ? 2 : (l.vaga || l.improvisado ? 1 : 0));
    const valor = (l) => {
        if (coluna === 'nome') return l.nome;
        if (coluna === 'total') return l.total;
        if (coluna.startsWith('curso:')) return l.porCurso[coluna.slice(6)] || 0;
        if (coluna.startsWith('pl:')) return l.porPL[coluna.slice(3)] || 0;
        return 0;
    };
    const porNome = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base', numeric: true });
    return linhas.slice().sort((a, b) => {
        const g = grupo(a) - grupo(b);
        if (g) return g;
        if (coluna === 'nome') return crescente ? porNome(a, b) : porNome(b, a);
        const d = valor(a) - valor(b);
        if (d) return crescente ? d : -d;
        return porNome(a, b);
    });
}
