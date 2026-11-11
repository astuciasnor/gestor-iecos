import test from 'node:test';
import assert from 'node:assert/strict';
import { filtrarDocentes, umNomePorPessoa, mesmoDocente } from '../js/docente_nomes.mjs';

const NOMES = [
  'Marcos Lazaro de Souza Albuquerque',
  'Fábio Batagini Quinteiro',
  'Elizardo Fabricio Lima Lucena',
  'Zélia Maria Pimental Nunes',
  'Ana Garcês'
];

test('acha com ou sem acento, nos dois sentidos', () => {
  assert.deepEqual(filtrarDocentes('Láz', NOMES), ['Marcos Lazaro de Souza Albuquerque']);
  assert.deepEqual(filtrarDocentes('laz', NOMES), ['Marcos Lazaro de Souza Albuquerque']);
  assert.deepEqual(filtrarDocentes('zelia', NOMES), ['Zélia Maria Pimental Nunes']);
  assert.deepEqual(filtrarDocentes('GARCES', NOMES), ['Ana Garcês']);
});

test('quem comeca pelo texto vem primeiro; uma linha por nome', () => {
  assert.deepEqual(filtrarDocentes('fab', NOMES), ['Fábio Batagini Quinteiro', 'Elizardo Fabricio Lima Lucena']);
});

test('varias partes em qualquer ordem', () => {
  assert.deepEqual(filtrarDocentes('albuquerque marcos', NOMES), ['Marcos Lazaro de Souza Albuquerque']);
  assert.deepEqual(filtrarDocentes('marcos zelia', NOMES), []);
});

test('campo vazio mostra todos em ordem alfabetica', () => {
  assert.equal(filtrarDocentes('', NOMES).length, NOMES.length);
  assert.equal(filtrarDocentes('', NOMES)[0], 'Ana Garcês');
  assert.equal(filtrarDocentes('', NOMES, 2).length, 2);
});

test('um nome por pessoa: vale a primeira grafia', () => {
  assert.deepEqual(umNomePorPessoa(['Zélia Nunes', 'zelia  nunes', 'Zélia Santos', '']), ['Zélia Nunes', 'Zélia Santos']);
  assert.equal(mesmoDocente('Zelia Nunes', 'ZÉLIA NUNES'), true);
  assert.equal(mesmoDocente('Zélia Nunes', 'Zélia Santos'), false);
  assert.equal(mesmoDocente('', ''), false);
});
