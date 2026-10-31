// Uma componente nao fica pendente e alocada ao mesmo tempo na mesma turma.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getDisciplinaKey,
  subGruposCompativeis,
  isPendenteJaAlocada,
  findPendentesCobertas
} from '../js/pendentes.mjs';

const pend = (id, disciplina, extra = {}) => ({ id, turmaId: 'EP2025', disciplina, modo: 'pendente', ...extra });
const aloc = (id, disciplina, extra = {}) => ({ id, turmaId: 'EP2025', disciplina, modo: 'faixas', ...extra });

test('nome compara sem "(60h)", maiusculas e espacos sobrando', () => {
  assert.equal(getDisciplinaKey('Limnologia (75h)'), 'LIMNOLOGIA');
  assert.equal(getDisciplinaKey('  limnologia  '), 'LIMNOLOGIA');
  assert.equal(getDisciplinaKey('Tecnologia  do Pescado'), getDisciplinaKey('TECNOLOGIA DO PESCADO'));
});

test('bloco inteiro casa com qualquer sub-turma; divisoes diferentes nao casam', () => {
  assert.equal(subGruposCompativeis('BL6', ''), true);
  assert.equal(subGruposCompativeis('BL6', 'BL6_T01'), true);
  assert.equal(subGruposCompativeis(null, 'BL6_T02'), true);
  assert.equal(subGruposCompativeis('BL6_T01', 'bl6_t01'), true);
  assert.equal(subGruposCompativeis('BL6_T01', 'BL6_T02'), false);
});

test('pendente do bloco some quando a componente e salva pela barra lateral', () => {
  const lista = [pend('p1', 'LIMNOLOGIA', { subGrupo: 'BL5' }), pend('p2', 'CARTOGRAFIA', { subGrupo: 'BL5' })];
  assert.deepEqual(findPendentesCobertas(aloc('n', 'Limnologia', { subGrupo: null }), lista), ['p1']);
});

test('nao remove pendente de outra turma nem de outra divisao da turma', () => {
  const lista = [
    pend('outraTurma', 'LIMNOLOGIA', { turmaId: 'EP2023' }),
    pend('t02', 'LIMNOLOGIA', { subGrupo: 'BL5_T02' })
  ];
  assert.deepEqual(findPendentesCobertas(aloc('n', 'LIMNOLOGIA', { subGrupo: 'BL5_T01' }), lista), []);
});

test('pendente que sobrou de edicao antiga e reconhecida; a devolvida pelo Substituir nao', () => {
  const sobra = pend('p1', 'LIMNOLOGIA', { subGrupo: 'BL5' });
  const devolvida = pend('p2', 'MAQUINAS E MOTORES', { subGrupo: 'BL5' });
  const todas = [sobra, devolvida, aloc('a1', 'LIMNOLOGIA'), aloc('a2', 'CARTOGRAFIA')];
  assert.equal(isPendenteJaAlocada(sobra, todas), true);
  assert.equal(isPendenteJaAlocada(devolvida, todas), false);
  assert.equal(isPendenteJaAlocada(aloc('a1', 'LIMNOLOGIA'), todas), false);
});
