import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ofertasDoPlano, cargaPorDocente, ordenarLinhas, SEM_DOCENTE } from '../js/indicadores.mjs';

const CH = { 'CALCULO I': 60, 'ZOOLOGIA': 90, 'QUIMICA GERAL': 45, 'ESTAGIO': 105 };
const opcoes = {
    cursoDaTurma: (turmaId) => turmaId.match(/^[A-Z]+/)?.[0] || '',
    chDaComponente: (disciplina) => CH[disciplina] || 0,
    ordemCursos: ['EP', 'CB', 'CN']
};
const linha = (resultado, nome) => resultado.linhas.find((l) => l.nome === nome);

test('uma oferta com varios horarios conta uma vez, com a CH do PPC', () => {
    const allocs = [
        { turmaId: 'EP2026', disciplina: 'CALCULO I', modo: 'semanal', docente: 'Ana Souza' },
        { turmaId: 'EP2026', disciplina: 'CALCULO I', modo: 'semanal', docente: 'Ana Souza' },
        { turmaId: 'EP2026', disciplina: 'CALCULO I (60h)', modo: 'faixas', docente: 'Ana Souza' }
    ];
    const ofertas = ofertasDoPlano(allocs, opcoes);
    assert.equal(ofertas.length, 1);
    assert.deepEqual(ofertas[0].docentes, [{ nome: 'Ana Souza', ch: 60 }]);
});

test('componente dividida: cada docente com a sua parte (30/90)', () => {
    const r = cargaPorDocente([{ periodo: 'PL2', allocations: [
        { turmaId: 'CB2025', disciplina: 'ZOOLOGIA', modo: 'semanal', docentes: [{ nome: 'Ana Souza', ch: 30 }, { nome: 'Bruno Lima', ch: 60 }] },
        { turmaId: 'CB2025', disciplina: 'ZOOLOGIA', modo: 'semanal', docentes: [{ nome: 'Ana Souza', ch: 30 }, { nome: 'Bruno Lima', ch: 60 }] }
    ] }], opcoes);
    assert.equal(linha(r, 'Ana Souza').total, 30);
    assert.equal(linha(r, 'Bruno Lima').total, 60);
    assert.deepEqual(linha(r, 'Bruno Lima').porCurso, { CB: 60 });
});

test('pendentes ficam de fora; "A definir" e sem docente vao para a linha A definir', () => {
    const r = cargaPorDocente([{ periodo: 'PL1', allocations: [
        { turmaId: 'EP2026', disciplina: 'ESTAGIO', modo: 'pendente', docente: 'Ana Souza' },
        { turmaId: 'EP2026', disciplina: 'QUIMICA GERAL', modo: 'semanal', docente: 'A definir' },
        { turmaId: 'EP2026', disciplina: 'CALCULO I', modo: 'semanal' }
    ] }], opcoes);
    assert.equal(linha(r, 'Ana Souza'), undefined);
    const semDocente = linha(r, SEM_DOCENTE);
    assert.equal(semDocente.semDocente, true);
    assert.equal(semDocente.total, 105);
    assert.equal(semDocente.ofertas, 2);
});

test('subturmas T01 e T02 do mesmo docente contam as duas; BL6 = turma inteira', () => {
    const r = cargaPorDocente([{ periodo: 'PL2', allocations: [
        { turmaId: 'EP2026', subGrupo: 'BL6_T01', disciplina: 'QUIMICA GERAL', modo: 'semanal', docente: 'Ana Souza' },
        { turmaId: 'EP2026', subGrupo: 'BL6_T02', disciplina: 'QUIMICA GERAL', modo: 'semanal', docente: 'Ana Souza' },
        { turmaId: 'EP2026', subGrupo: 'BL6', disciplina: 'CALCULO I', modo: 'semanal', docente: 'Ana Souza' },
        { turmaId: 'EP2026', subGrupo: '', disciplina: 'CALCULO I', modo: 'semanal', docente: 'Ana Souza' }
    ] }], opcoes);
    assert.equal(linha(r, 'Ana Souza').total, 45 + 45 + 60);
    assert.equal(linha(r, 'Ana Souza').ofertas, 3);
});

test('ano inteiro: soma por PL e por curso; mesmo nome com/sem acento = mesma pessoa', () => {
    const r = cargaPorDocente([
        { periodo: 'PL3', allocations: [{ turmaId: 'CN2026', disciplina: 'QUIMICA GERAL', modo: 'semanal', docente: 'Zélia Moraes' }] },
        { periodo: 'PL1', allocations: [{ turmaId: 'EP2026', disciplina: 'CALCULO I', modo: 'faixas', docente: 'Zelia Moraes' }] }
    ], opcoes);
    assert.equal(r.linhas.length, 1);
    const z = r.linhas[0];
    assert.deepEqual(z.porPL, { PL1: 60, PL3: 45 });
    assert.deepEqual(z.porCurso, { EP: 60, CN: 45 });
    assert.equal(z.total, 105);
    assert.deepEqual(r.periodos, ['PL1', 'PL3']);
    assert.deepEqual(r.cursos, ['EP', 'CN']);
});

test('ordem: pessoas pelo total, depois vagas, por ultimo A definir', () => {
    const r = cargaPorDocente([{ periodo: 'PL1', allocations: [
        { turmaId: 'EP2026', disciplina: 'ZOOLOGIA', modo: 'semanal', docente: 'Vaga1 FBIO' },
        { turmaId: 'EP2026', disciplina: 'CALCULO I', modo: 'semanal' },
        { turmaId: 'EP2026', disciplina: 'QUIMICA GERAL', modo: 'semanal', docente: 'Bruno Lima' },
        { turmaId: 'CB2026', disciplina: 'CALCULO I', modo: 'semanal', docente: 'Ana Souza' }
    ] }], opcoes);
    assert.deepEqual(ordenarLinhas(r.linhas).map((l) => l.nome), ['Ana Souza', 'Bruno Lima', 'Vaga1 FBIO', SEM_DOCENTE]);
    assert.deepEqual(ordenarLinhas(r.linhas, { coluna: 'nome', crescente: true }).map((l) => l.nome).slice(0, 2), ['Ana Souza', 'Bruno Lima']);
    assert.deepEqual(ordenarLinhas(r.linhas, { coluna: 'curso:CB' }).map((l) => l.nome).slice(0, 2), ['Ana Souza', 'Bruno Lima']);
});

test('nome improvisado ("n.n.") fica marcado e vai para o grupo das vagas', () => {
    const r = cargaPorDocente([{ periodo: 'PL2', allocations: [
        { turmaId: 'CN2025', disciplina: 'QUIMICA GERAL', modo: 'semanal', docente: 'n.n. (substituto)' },
        { turmaId: 'EP2026', disciplina: 'CALCULO I', modo: 'semanal', docente: 'Ana Souza' }
    ] }], opcoes);
    const nn = linha(r, 'n.n. (substituto)');
    assert.equal(nn.improvisado, true);
    assert.equal(nn.vaga, false);
    assert.deepEqual(ordenarLinhas(r.linhas).map((l) => l.nome), ['Ana Souza', 'n.n. (substituto)']);
    assert.equal(linha(r, 'Ana Souza').improvisado, false);
});
