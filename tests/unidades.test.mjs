// Unidades academicas (js/unidades.mjs): lista unica e unidade de cada curso.
import test from 'node:test';
import assert from 'node:assert/strict';
import { UNIDADE_PADRAO, UNIDADES, unidadeDoCurso } from '../js/unidades.mjs';
import { UNIDADES as UNIDADES_DOCENTES } from '../js/docente_nomes.mjs';

test('curso sem unidade fica na unidade padrao; com unidade, em maiusculas', () => {
    assert.equal(UNIDADE_PADRAO, 'IECOS');
    assert.equal(unidadeDoCurso({ sigla: 'EP' }), 'IECOS');
    assert.equal(unidadeDoCurso({ sigla: 'MT', unidade: ' cbrag ' }), 'CBRAG');
    assert.equal(unidadeDoCurso(undefined), 'IECOS');
});

test('a lista de unidades e a mesma vista pelos docentes', () => {
    // No Node o ?v= do import cria outra copia do modulo: compara o conteudo.
    assert.deepEqual(UNIDADES_DOCENTES, UNIDADES);
    assert.ok(UNIDADES.some((u) => u.sigla === UNIDADE_PADRAO));
});
