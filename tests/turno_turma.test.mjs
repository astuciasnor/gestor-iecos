// Turma de dois turnos (ex.: EP2027C, Cameta, Manha+Tarde): aula em qualquer dos
// seus turnos nao e mudanca de turno, e o sabado nao e levado para a manha.
import test from 'node:test';
import assert from 'node:assert/strict';

import { turnoDaTurmaInclui } from '../js/turns.js';

test('turma de um turno so tem o proprio turno', () => {
    assert.equal(turnoDaTurmaInclui('Tarde', 'tarde'), true);
    assert.equal(turnoDaTurmaInclui('Tarde', 'manha'), false);
    assert.equal(turnoDaTurmaInclui('Manhã', 'manha'), true);
    assert.equal(turnoDaTurmaInclui('Noite', 'tarde'), false);
});

test('turma de dois turnos tem os dois', () => {
    assert.equal(turnoDaTurmaInclui('Manhã+Tarde', 'manha'), true);
    assert.equal(turnoDaTurmaInclui('Manhã+Tarde', 'tarde'), true);
    assert.equal(turnoDaTurmaInclui('Manhã+Tarde', 'noite'), false);
    assert.equal(turnoDaTurmaInclui('Tarde+Noite', 'manha'), false);
});

test('integral tem todos; vazio nao tem nenhum', () => {
    assert.equal(turnoDaTurmaInclui('Integral', 'noite'), true);
    assert.equal(turnoDaTurmaInclui('', 'manha'), false);
    assert.equal(turnoDaTurmaInclui('Tarde', ''), false);
});
