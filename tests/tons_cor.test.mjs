// Testes dos tons suaves usados para pintar os blocos da grade (redesenho).
import test from 'node:test';
import assert from 'node:assert/strict';
import { tonsDaCor, PALETA_CORES, matizESaturacao, estiloTonsBloco } from '../js/color_utils.js';

test('cores da paleta devolvem os tres tons curados', () => {
  assert.deepEqual(tonsDaCor('#16A34A'), { fundo: '#DCFCE7', borda: '#16A34A', texto: '#14532D' });
  // o seletor nativo grava em minusculas: tem de achar igual
  assert.deepEqual(tonsDaCor('#16a34a'), { fundo: '#DCFCE7', borda: '#16A34A', texto: '#14532D' });
});

test('cada cor forte da paleta acha a si mesma', () => {
  assert.equal(PALETA_CORES.length, 15);
  for (const [, fundo, borda, texto] of PALETA_CORES) {
    assert.deepEqual(tonsDaCor(borda), { fundo, borda, texto });
  }
});

test('cor antiga fora da paleta vira tom suave pela matiz', () => {
  const t = tonsDaCor('#FFADAD'); // pastel vermelho antigo
  assert.equal(t.fundo, 'hsl(0 85% 93%)');
  assert.equal(t.borda, 'hsl(0 75% 40%)');
  assert.equal(t.texto, 'hsl(0 70% 20%)');
});

test('cinza continua cinza e cor invalida nao quebra', () => {
  assert.equal(tonsDaCor('#808080').fundo, 'hsl(0 0% 93%)');
  assert.ok(tonsDaCor('').fundo.startsWith('hsl('));
  assert.ok(tonsDaCor('abc-nada').borda.startsWith('hsl('));
  assert.ok(tonsDaCor('#abc').texto.startsWith('hsl('));
});

test('estilo em texto traz as tres variaveis do bloco', () => {
  assert.equal(estiloTonsBloco('#16A34A'), '--bloco-fundo:#DCFCE7; --bloco-borda:#16A34A; --bloco-texto:#14532D;');
  // cor vazia ou invalida nao quebra o HTML
  assert.match(estiloTonsBloco(''), /^--bloco-fundo:hsl\(.+; --bloco-borda:hsl\(.+; --bloco-texto:hsl\(.+;$/);
});

test('matiz e saturacao basicas', () => {
  assert.deepEqual(matizESaturacao('#FF0000'), { matiz: 0, sat: 100 });
  assert.equal(matizESaturacao('#00FF00').matiz, 120);
  assert.equal(matizESaturacao('#0000FF').matiz, 240);
});
