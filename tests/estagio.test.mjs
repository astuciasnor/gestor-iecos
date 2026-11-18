// Regra de choque do estagio (js/estagio.mjs), decidida em 18/11/2026:
// estagio so gera choque dentro do turno da turma; fora dele (estagio em campo)
// nao gera choque nem para o docente nem para a turma.
import test from 'node:test';
import assert from 'node:assert/strict';

import { ehEstagio, turnoDoHorario, aulaContaComoChoque } from '../js/estagio.mjs';

test('reconhece componente de estagio pelo nome, com ou sem acento', () => {
    assert.equal(ehEstagio('CBBR049 ESTÁGIO III'), true);
    assert.equal(ehEstagio('Estagio Supervisionado I'), true);
    assert.equal(ehEstagio('estágio em aquicultura'), true);
    assert.equal(ehEstagio('QUIMICA BASICA'), false);
    assert.equal(ehEstagio('ESTAGIOLOGIA'), false); // palavra inteira
    assert.equal(ehEstagio(''), false);
});

test('turno do horario: pelo quadro, e pelo relogio quando nao acha', () => {
    const quadro = { 'Manhã': ['08:00 - 08:50'], 'Tarde': ['14:00 - 14:50'], 'Noite': ['18:30 - 19:20'] };
    assert.equal(turnoDoHorario('14:00 - 14:50', quadro), 'tarde');
    assert.equal(turnoDoHorario('07:30 - 08:20'), 'manha');
    assert.equal(turnoDoHorario('11:40 - 12:30'), 'manha');
    assert.equal(turnoDoHorario('13:30 - 14:20'), 'tarde');
    assert.equal(turnoDoHorario('17:10 - 18:00'), 'tarde');
    assert.equal(turnoDoHorario('18:30 - 19:20'), 'noite');
    assert.equal(turnoDoHorario(''), '');
});

test('caso Sandra (CB2024, Manhã): encontro de manhã conta, estágio à noite não', () => {
    const estagio = 'CBBR049 ESTÁGIO III';
    assert.equal(aulaContaComoChoque({ disciplina: estagio, horario: '08:00 - 08:50' }, 'Manhã'), true);
    assert.equal(aulaContaComoChoque({ disciplina: estagio, horario: '18:30 - 19:20' }, 'Manhã'), false);
    assert.equal(aulaContaComoChoque({ disciplina: estagio, horario: '14:00 - 14:50' }, 'Manhã'), false);
});

test('turma de dois turnos (EP, Manhã+Tarde): só a noite fica sem choque', () => {
    const estagio = 'ESTÁGIO SUPERVISIONADO';
    assert.equal(aulaContaComoChoque({ disciplina: estagio, horario: '08:00 - 08:50' }, 'Manhã+Tarde'), true);
    assert.equal(aulaContaComoChoque({ disciplina: estagio, horario: '14:00 - 14:50' }, 'Manhã+Tarde'), true);
    assert.equal(aulaContaComoChoque({ disciplina: estagio, horario: '19:20 - 20:10' }, 'Manhã+Tarde'), false);
});

test('outras componentes sempre contam, em qualquer turno', () => {
    assert.equal(aulaContaComoChoque({ disciplina: 'QUIMICA BASICA', horario: '18:30 - 19:20' }, 'Manhã'), true);
});

test('sem turno da turma ou sem horario: conta (lado seguro)', () => {
    assert.equal(aulaContaComoChoque({ disciplina: 'ESTÁGIO I', horario: '18:30 - 19:20' }, ''), true);
    assert.equal(aulaContaComoChoque({ disciplina: 'ESTÁGIO I', horario: 'M1' }, 'Manhã'), true);
});
