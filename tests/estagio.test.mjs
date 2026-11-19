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

// ---------------------------------------------------------------- Montar estagio
import { calcularEstagio, faixasDoEstagio, expressaoSigaaDaEtapa, horasPorTurno, turnoQueMostra, choqueDaEtapa, diasQueFaltamNoPadrao } from '../js/estagio.mjs';

const PL2 = { termStart: '2027-03-15', termEnd: '2027-07-14' };
const FERIADOS = new Set(['2027-03-26', '2027-04-21', '2027-05-01', '2027-06-03']);
const MAX = { M: 6, T: 6, N: 4 };
const SLOTS = {
    M: ['08:00 - 08:50', '08:50 - 09:40', '09:40 - 10:30', '10:50 - 11:40', '11:40 - 12:30', '12:30 - 13:20'],
    T: ['14:00 - 14:50', '14:50 - 15:40', '15:40 - 16:30', '16:50 - 17:40', '17:40 - 18:30', '18:30 - 19:20'],
    N: ['19:00 - 19:50', '19:50 - 20:40', '20:40 - 21:30', '21:30 - 22:20']
};
const sandra = () => [
    { tipo: 'encontro', turno: 'Manhã', horasDia: 5, mes: '2027-03', dias: ['2027-03-15', '2027-03-16', '2027-03-17'] },
    { tipo: 'campo', turno: 'Noite', horasDia: 3, mes: '2027-03', diasSemana: [1, 3] },
    { tipo: 'encontro', turno: 'Manhã', horasDia: 5, mes: '2027-06', dias: ['2027-06-28', '2027-06-29', '2027-06-30'] }
];

test('caso Sandra: o estágio em campo termina em 16/06 com 25 aulas e fecha 105 h', () => {
    const r = calcularEstagio({ etapas: sandra(), ch: 105, ...PL2, feriados: FERIADOS });
    assert.equal(r.alocada, 105);
    assert.equal(r.etapas[1].aulas.length, 25);
    assert.equal(r.etapas[1].aulas[0], '2027-03-22');
    assert.equal(r.etapas[1].aulas.at(-1), '2027-06-16');
    assert.ok(!r.etapas[1].aulas.includes('2027-04-21')); // feriado
    assert.ok(r.avisos.some((a) => a.tipo === 'ok'));
    assert.ok(!r.avisos.some((a) => a.tipo === 'erro'));
});

test('caso Sandra vira 3 faixas: sem pausa depois do encontro, pausa antes do fechamento', () => {
    const r = calcularEstagio({ etapas: sandra(), ch: 105, ...PL2, feriados: FERIADOS });
    const f = faixasDoEstagio(r.etapas, SLOTS, FERIADOS);
    assert.equal(f.length, 3);
    assert.deepEqual([f[0].inicio, f[0].fim, f[0].pausa], ['2027-03-15', '2027-03-21', false]);
    assert.deepEqual([f[1].inicio, f[1].fim, f[1].pausa], ['2027-03-22', '2027-06-16', true]);
    assert.deepEqual([f[2].inicio, f[2].fim], ['2027-06-28', '']);
    assert.equal(f[0].pattern.length, 3 * 5);   // seg-qua x 5 aulas
    assert.equal(f[1].pattern.length, 2 * 3);   // seg/qua x 3 aulas da noite
    assert.deepEqual(f[1].pattern.map((p) => p.slot).slice(0, 3), SLOTS.N.slice(0, 3));
    assert.equal(expressaoSigaaDaEtapa(r.etapas[1], MAX), '24N123');
    assert.equal(expressaoSigaaDaEtapa(r.etapas[0], MAX), '234M12345');
});

test('manhã e noite no mesmo PL (4 etapas, turma da Tarde)', () => {
    const etapas = [
        { tipo: 'encontro', turno: 'Tarde', horasDia: 5, mes: '2027-03', dias: ['2027-03-15', '2027-03-16', '2027-03-17'] },
        { tipo: 'campo', turno: 'Manhã', horasDia: 3, mes: '2027-03', diasSemana: [1, 3], fim: '2027-04-30' },
        { tipo: 'campo', turno: 'Noite', horasDia: 3, mes: '2027-05', diasSemana: [2, 4] },
        { tipo: 'encontro', turno: 'Tarde', horasDia: 5, mes: '2027-07', dias: ['2027-07-05', '2027-07-06', '2027-07-07'] }
    ];
    const r = calcularEstagio({ etapas, ch: 105, ...PL2, feriados: FERIADOS });
    assert.equal(r.alocada, 105);
    assert.equal(r.etapas[1].aulas.length, 11);
    assert.equal(r.etapas[2].aulas.at(-1), '2027-06-22');
    assert.equal(faixasDoEstagio(r.etapas, SLOTS, FERIADOS).length, 4);
    assert.equal(choqueDaEtapa('Manhã', 'Tarde'), 'nao');
    assert.equal(choqueDaEtapa('Tarde', 'Tarde'), 'sim');
    assert.equal(choqueDaEtapa('Manhã+Tarde', 'Tarde'), 'parte');
    assert.equal(turnoQueMostra(['T', 'M', 'N']), 'Integral');
    assert.equal(turnoQueMostra(['M', 'N']), 'Manhã+Noite');
});

test('avisos: padrão semanal quebrado, sobra de horas e 10 h por dia', () => {
    assert.deepEqual(diasQueFaltamNoPadrao(['2027-03-15', '2027-03-22'], FERIADOS), []);          // toda segunda
    assert.deepEqual(diasQueFaltamNoPadrao(['2027-03-15', '2027-03-17', '2027-03-22'], FERIADOS), []);
    // seg 15, qua 17, ter 23: a faixa repetiria seg/ter/qua, faltam ter 16 e seg 22
    assert.deepEqual(diasQueFaltamNoPadrao(['2027-03-15', '2027-03-17', '2027-03-23'], FERIADOS), ['2027-03-16', '2027-03-22']);
    const etapas = sandra();
    etapas[1].horasDia = 4; // 75 h nao divide por 4
    const r = calcularEstagio({ etapas, ch: 105, ...PL2, feriados: FERIADOS });
    assert.ok(r.avisos.some((a) => a.tipo === 'erro' && a.texto.includes('Sobra 1 h')));
    assert.deepEqual(horasPorTurno('Manhã+Tarde', 10, MAX), [['M', 5], ['T', 5]]);
    assert.deepEqual(horasPorTurno('Manhã+Noite', 10, MAX), [['M', 6], ['N', 4]]);
    const dez = calcularEstagio({ etapas: [{ tipo: 'encontro', turno: 'Manhã+Tarde', horasDia: 10, mes: '2027-03', dias: ['2027-03-15'] }], ch: 10, ...PL2, feriados: FERIADOS });
    assert.equal(dez.alocada, 10);
    assert.ok(dez.avisos.some((a) => a.tipo === 'info'));
});

test('dias planejados: campo do meio dura N dias; encontro avisa quando marcou menos', () => {
    const etapas = [
        { tipo: 'encontro', turno: 'Tarde', horasDia: 5, mes: '2027-03', diasPlanejados: 3, dias: ['2027-03-15', '2027-03-16', '2027-03-17'] },
        { tipo: 'campo', turno: 'Manhã', horasDia: 3, mes: '2027-03', diasSemana: [1, 3], diasPlanejados: 11 },
        { tipo: 'campo', turno: 'Noite', horasDia: 3, mes: '2027-05', diasSemana: [2, 4] },
        { tipo: 'encontro', turno: 'Tarde', horasDia: 5, mes: '2027-07', diasPlanejados: 3, dias: ['2027-07-05', '2027-07-06', '2027-07-07'] }
    ];
    const r = calcularEstagio({ etapas, ch: 105, ...PL2, feriados: FERIADOS, turnoDaTurma: 'Tarde' });
    assert.equal(r.etapas[1].aulas.length, 11);
    assert.equal(r.etapas[1].aulas.at(-1), '2027-04-28');   // 11 seg/qua desde 22/03 (21/04 e feriado)
    assert.equal(r.alocada, 105);
    assert.ok(!r.avisos.some((a) => a.tipo === 'erro'));

    etapas[0].dias = ['2027-03-15', '2027-03-16'];
    const faltando = calcularEstagio({ etapas, ch: 105, ...PL2, feriados: FERIADOS, turnoDaTurma: 'Tarde' });
    assert.ok(faltando.avisos.some((a) => a.tipo === 'erro' && a.texto.includes('2 de 3 dias')));
});


test('campo pode começar semanas depois do encontro (vira pausa); antes do mínimo, usa o mínimo', () => {
    const etapas = sandra();
    etapas[1].inicio = '2027-04-05'; // encontro termina 17/03; campo so em abril
    const r = calcularEstagio({ etapas, ch: 105, ...PL2, feriados: FERIADOS });
    assert.equal(r.etapas[1].aulas[0], '2027-04-05');
    assert.equal(r.etapas[1].inicioMinimo, '2027-03-18');
    const f = faixasDoEstagio(r.etapas, SLOTS, FERIADOS);
    assert.deepEqual([f[0].fim, f[0].pausa], ['2027-03-17', true]); // pausa de 18/03 a 04/04
    etapas[1].inicio = '2027-03-01'; // antes do encontro: comeca no minimo
    const cedo = calcularEstagio({ etapas, ch: 105, ...PL2, feriados: FERIADOS });
    assert.equal(cedo.etapas[1].aulas[0], '2027-03-22');
});

test('sábado: só de manhã, a partir da 1a aula, até 5 aulas', () => {
    const etapas = [
        { tipo: 'encontro', turno: 'Tarde', horasDia: 5, mes: '2027-03', dias: ['2027-03-15', '2027-03-16'] },
        { tipo: 'campo', turno: 'Manhã+Tarde', horasDia: 8, mes: '2027-03', diasSemana: [1, 2, 3, 4, 5, 6] }
    ];
    const r = calcularEstagio({ etapas, ch: 76, ...PL2, feriados: FERIADOS, turnoDaTurma: 'Tarde', maxPorLetra: MAX });
    const campo = r.etapas[1];
    // qua 17, qui 18, sex 19 (8 h) + sab 20 (5 h) ... sex 26 e feriado ... sab 27 (5 h) = 66 h
    assert.equal(r.alocada, 76);
    assert.equal(campo.aulas.at(-1), '2027-03-27');
    assert.ok(!r.avisos.some((a) => a.tipo === 'erro'));
    assert.ok(campo.aulas.includes('2027-03-20'));
    assert.equal(expressaoSigaaDaEtapa(campo, MAX), '23456M1234 23456T1234 7M12345');
    const f = faixasDoEstagio(r.etapas, SLOTS, FERIADOS);
    const sabado = f[1].pattern.filter((p) => p.dia === 6).map((p) => p.slot);
    assert.deepEqual(sabado, SLOTS.M.slice(0, 5));
});
