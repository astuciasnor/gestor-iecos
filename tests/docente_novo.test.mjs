// Docente novo (Docente Temporario: Substituto, Visitante), fora do dados_app.json.
// O choque de horario depende so do nome escrito nas alocacoes: o mesmo nome
// (ignorando maiusculas e acentos) junta as aulas do docente; uma abreviacao nao.
// Por isso o Cardume pede para conferir o nome completo antes de salvar.
import test from 'node:test';
import assert from 'node:assert/strict';

import { detectTeacherConflicts } from '../js/conflicts.js';
import { acharNomeConhecido, semAcento, findNewNames, findSimilarNames, problemaNoNome, UNIDADES, VINCULOS_DOCENTE_NOVO, listarDocentesParaConferir, aplicarRevisaoDocente, removerDocenteDaAlocacao } from '../js/docente_nomes.mjs';

// store.js le o localStorage ao carregar; no Node ele nao existe.
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { allocationHasTeacherMatch, teacherNamesMatch } = await import('../js/allocation_helpers.js');

const NOVO = 'Ana Beatriz Cardoso Lima';

const alocacoes = [
  { turmaId: 'EP2025', disciplina: 'BIOLOGIA PESQUEIRA', docente: NOVO, horario: '08:00 - 08:50' },
  { turmaId: 'MT2026', disciplina: 'CALCULO I', docente: 'ana beatriz cardoso lima', horario: '08:00 - 08:50' },
  { turmaId: 'EP2027C', disciplina: 'ECOLOGIA', docente: 'A. B. Cardoso Lima', horario: '08:00 - 08:50' }
];

function choquesDe(nome) {
  const eventos = alocacoes.filter((a) => allocationHasTeacherMatch(a, nome));
  return detectTeacherConflicts({ eventsByDate: { '2027-03-01': eventos } });
}

test('docente novo com o mesmo nome em duas turmas gera choque', () => {
  const choques = choquesDe(NOVO);
  assert.equal(choques.length, 1);
  assert.deepEqual(choques[0].turmas, ['EP2025', 'MT2026']);
});

test('maiusculas e acentos nao atrapalham', () => {
  assert.equal(teacherNamesMatch('Ána Beatriz Cardoso Lima', NOVO), true);
  assert.equal(teacherNamesMatch('ANA BEATRIZ CARDOSO LIMA', NOVO), true);
});

test('nome abreviado vira outra pessoa e o choque escapa', () => {
  assert.equal(teacherNamesMatch('A. B. Cardoso Lima', NOVO), false);
  const turmas = choquesDe(NOVO).flatMap((c) => c.turmas);
  assert.equal(turmas.includes('EP2027C'), false);
});

// ---- Regras do aviso e da janela "Cadastrar Docente Temporario" ----
const LISTA = ['Thiago Tomé Ferreira', 'Ana Beatriz Cardoso Lima', 'Evaldo Martins da Silva'];

test('nome novo: ignora maiusculas, acentos, espacos e "A definir"', () => {
  assert.deepEqual(findNewNames(['evaldo martins da silva', '  Ana  Beatriz Cardoso Lima ', 'A definir', ''], LISTA), []);
  assert.deepEqual(findNewNames(['Thiago Tomé', 'thiago tome'], LISTA), ['Thiago Tomé']);
});

test('nome parecido aponta a mesma pessoa provavel', () => {
  assert.deepEqual(findSimilarNames('Thiago Tomé', LISTA), ['Thiago Tomé Ferreira']);
  assert.deepEqual(findSimilarNames('Ana B. Lima', LISTA), ['Ana Beatriz Cardoso Lima']);
  assert.deepEqual(findSimilarNames('Ana Lima', LISTA), ['Ana Beatriz Cardoso Lima']);
  assert.deepEqual(findSimilarNames('Carlos Souza', LISTA), []);
  assert.deepEqual(findSimilarNames('Thiago', LISTA), []);
});

test('abreviacao, titulo ou nome sem sobrenome nao passam', () => {
  assert.equal(problemaNoNome('Thiago Tomé Ferreira'), '');
  assert.equal(problemaNoNome('Maria e Silva'), '');
  assert.match(problemaNoNome('Thiago'), /sobrenome/);
  assert.match(problemaNoNome('Ana B. Lima'), /abrevia/);
  assert.match(problemaNoNome('Ana B Lima'), /abrevia/);
  assert.match(problemaNoNome('Prof. João Silva'), /título/);
  assert.match(problemaNoNome('Dra Maria Souza'), /título/);
});

test('vinculos e subunidades por unidade', () => {
  assert.deepEqual(VINCULOS_DOCENTE_NOVO, ['Substituto', 'Visitante', 'Efetivo']);
  const porSigla = Object.fromEntries(UNIDADES.map((u) => [u.sigla, u.subunidades]));
  assert.deepEqual(porSigla.IECOS, ['FEPESCA', 'FACIN', 'FBIO']);
  assert.deepEqual(porSigla.CBRAG, ['FACED', 'FAHIST', 'FAMAT', 'FALE', 'FALEST']);
});

test('painel do administrador: so cadastros fora da planilha, um por nome', () => {
  const cad = (nome, em, extra = {}) => ({ nome, vinculo: 'Efetivo', unidade: 'CANAN', subunidade: 'FACFIS', outraUnidade: true, por: 'coord@ufpa.br', em, ...extra });
  const porPeriodo = {
    PL1: [
      { turmaId: 'EP2025', disciplina: 'ECOLOGIA', docentesCadastrados: [cad('Chico Buarque de Holanda', '2026-11-06')] },
      { turmaId: 'EP2026', disciplina: 'BIOLOGIA', docentesCadastrados: [cad('Chico Buarque de Holanda', '2026-11-05')] },
      { turmaId: 'MT2026', disciplina: 'CALCULO', docentesCadastrados: [cad('Evaldo Martins da Silva', '2026-11-01')] },
      { turmaId: 'MT2026', disciplina: 'ALGEBRA', docente: 'Sem cadastro' }
    ],
    PL2: [{ turmaId: 'EP2025', disciplina: 'ECOLOGIA', docentesCadastrados: [cad('chico buarque de holanda', '2026-11-07')] }]
  };
  const itens = listarDocentesParaConferir(porPeriodo, LISTA);
  assert.equal(itens.length, 1);
  assert.equal(itens[0].nome, 'Chico Buarque de Holanda');
  assert.equal(itens[0].em, '2026-11-05');
  assert.deepEqual(itens[0].usos, ['EP2025 · ECOLOGIA', 'EP2026 · BIOLOGIA']);
  assert.equal(itens[0].outraUnidade, true);
});

test('revisao do administrador troca o nome e mantem quem cadastrou', () => {
  const cadastro = { nome: 'Chico Buarque', vinculo: 'Efetivo', unidade: 'Campus de Ananindeua', subunidade: 'Faculdade de Física', outraUnidade: true, por: 'coord@ufpa.br', porNome: 'Coord EP', em: '2026-11-06' };
  const revisao = { nome: 'Chico Buarque de Holanda', vinculo: 'Efetivo', unidade: 'CANAN', subunidade: 'FACFIS', por: 'admin@ufpa.br', porNome: 'Admin', em: '2026-11-07' };
  const unico = { id: 'a1', turmaId: 'EP2025', docente: 'chico  buarque', docentesCadastrados: [cadastro] };
  const r1 = aplicarRevisaoDocente(unico, 'Chico Buarque', revisao);
  assert.equal(r1.docente, 'Chico Buarque de Holanda');
  const cad = r1.docentesCadastrados[0];
  assert.equal(cad.unidade, 'CANAN');
  assert.equal(cad.subunidade, 'FACFIS');
  assert.equal(cad.por, 'coord@ufpa.br');
  assert.equal(cad.outraUnidade, undefined);
  assert.equal(cad.cadastradoComo.unidade, 'Campus de Ananindeua');
  assert.equal(cad.revisado.por, 'admin@ufpa.br');
  assert.equal(unico.docente, 'chico  buarque', 'a original nao muda');

  const varios = { id: 'a2', docente: 'Evaldo / Chico (Múltiplos)', docentes: [{ nome: 'Evaldo Martins da Silva', ch: 30 }, { nome: 'Chico Buarque', ch: 30 }] };
  const r2 = aplicarRevisaoDocente(varios, 'Chico Buarque', { ...revisao, nome: 'Francisco Buarque de Holanda' });
  assert.equal(r2.docentes[1].nome, 'Francisco Buarque de Holanda');
  assert.equal(r2.docente, 'Evaldo / Francisco (Múltiplos)');

  assert.equal(aplicarRevisaoDocente({ id: 'a3', docente: 'Outra Pessoa' }, 'Chico Buarque', revisao), null);
  assert.deepEqual(listarDocentesParaConferir({ PL1: [r1] }, []), [], 'revisado sai da lista');
});

test('remover cadastro indevido: componente fica, docente vira "A definir"', () => {
  const cad = { nome: 'Fulano Indevido', vinculo: 'Substituto', unidade: 'IECOS', subunidade: 'FEPESCA', por: 'c@ufpa.br', em: '2026-11-06' };
  const unico = { id: 'a1', turmaId: 'EP2025', disciplina: 'ECOLOGIA', docente: 'Fulano Indevido', ch: 60, faixas: [{ inicio: '2027-03-15' }], docentesCadastrados: [cad] };
  const r1 = removerDocenteDaAlocacao(unico, 'fulano indevido');
  assert.equal(r1.docente, 'A definir');
  assert.equal(r1.docentesCadastrados, undefined);
  assert.deepEqual(r1.faixas, unico.faixas);
  assert.equal(r1.ch, 60);

  const outro = { nome: 'Chico Buarque', vinculo: 'Efetivo' };
  const varios = { id: 'a2', docente: 'Evaldo / Fulano (Múltiplos)', docentes: [{ nome: 'Evaldo Martins da Silva', ch: 30 }, { nome: 'Fulano Indevido', ch: 30 }], docentesCadastrados: [cad, outro] };
  const r2 = removerDocenteDaAlocacao(varios, 'Fulano Indevido');
  assert.deepEqual(r2.docentes, [{ nome: 'Evaldo Martins da Silva', ch: 30 }, { nome: 'A definir', ch: 30 }]);
  assert.equal(r2.docente, 'Evaldo / A definir (Múltiplos)');
  assert.deepEqual(r2.docentesCadastrados, [outro]);

  assert.equal(removerDocenteDaAlocacao({ id: 'a3', docente: 'Outra Pessoa' }, 'Fulano Indevido'), null);
});

test('nome digitado sem acento acha o nome da lista', () => {
  const lista = ['Zélia Maria Pimental Nunes', 'Fábio Silva', 'Fabiana Costa', 'Ana Garcês'];
  assert.equal(acharNomeConhecido('zelia maria pimental nunes', lista), 'Zélia Maria Pimental Nunes');
  assert.equal(acharNomeConhecido('ANA GARCES', lista), 'Ana Garcês');
  // Pedaco do nome so vale com parcial e se for de um docente so.
  assert.equal(acharNomeConhecido('zelia', lista), null);
  assert.equal(acharNomeConhecido('zelia', lista, { parcial: true }), 'Zélia Maria Pimental Nunes');
  assert.equal(acharNomeConhecido('fab', lista, { parcial: true }), null);
  assert.equal(acharNomeConhecido('fabio', lista, { parcial: true }), 'Fábio Silva');
  assert.equal(acharNomeConhecido('an', lista, { parcial: true }), null);
  assert.equal(acharNomeConhecido('Maria Nova', lista), null);
  assert.equal(semAcento('Zélia Garcês'), 'Zelia Garces');
});
