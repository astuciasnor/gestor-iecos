// Indicadores > Dias do docente: dias com 2 ou mais componentes diferentes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { diasDoDocente } from '../js/dias_docente.mjs';

const aula = (date, key, horario, extra = {}) => ({
    date, key, horario, aulas: 1, disciplina: key.split('|')[1], turmaId: key.split('|')[0], subGrupo: key.split('|')[2] || '', ...extra
});

test('manha de uma componente e tarde de outra no mesmo dia = dia carregado', () => {
    // 15/03/2027 e segunda.
    const r = diasDoDocente({
        termStart: '2027-03-15',
        termEnd: '2027-03-21',
        entries: [
            aula('2027-03-15', 'EP2024|ESTATISTICA', '08:00 - 08:50'),
            aula('2027-03-15', 'EP2024|ESTATISTICA', '08:50 - 09:40'),
            aula('2027-03-15', 'EP2025|ECOLOGIA', '14:00 - 14:50'),
            aula('2027-03-16', 'EP2024|ESTATISTICA', '08:00 - 08:50')
        ]
    });
    assert.equal(r.datas.length, 7);
    assert.equal(r.carregados, 1);
    assert.deepEqual(r.datas.filter((d) => d.carregado).map((d) => d.date), ['2027-03-15']);
    assert.deepEqual(r.datas[0].componentes, ['EP2024|ESTATISTICA', 'EP2025|ECOLOGIA']);
    const est = r.componentes.find((c) => c.key === 'EP2024|ESTATISTICA');
    assert.equal(est.aulas, 3);
    assert.deepEqual(est.porData['2027-03-15'], { aulas: 2, horario: '08:00–09:40', turnos: 'manhã' });
    assert.equal(est.weekdays, 'seg e ter');
});

test('a mesma componente em dois horarios do dia nao e dia carregado', () => {
    const r = diasDoDocente({
        termStart: '2027-03-15',
        termEnd: '2027-03-15',
        entries: [
            aula('2027-03-15', 'EP2024|ESTATISTICA', '08:00 - 08:50'),
            aula('2027-03-15', 'EP2024|ESTATISTICA', '14:00 - 14:50')
        ]
    });
    assert.equal(r.carregados, 0);
    assert.equal(r.componentes[0].porData['2027-03-15'].turnos, 'manhã e tarde');
});

test('T01 de manha e T02 a tarde da mesma componente = dia carregado', () => {
    const r = diasDoDocente({
        termStart: '2027-03-15',
        termEnd: '2027-03-15',
        entries: [
            aula('2027-03-15', 'EP2027|QUIMICA|T01', '08:00 - 08:50'),
            aula('2027-03-15', 'EP2027|QUIMICA|T02', '14:00 - 14:50')
        ]
    });
    assert.equal(r.carregados, 1);
    assert.equal(r.componentes.length, 2);
});

test('manha e noite tambem contam', () => {
    const r = diasDoDocente({
        termStart: '2027-03-15',
        termEnd: '2027-03-15',
        entries: [
            aula('2027-03-15', 'EP2024|ESTATISTICA', '08:00 - 08:50'),
            aula('2027-03-15', 'CN2026|CALCULO', '19:00 - 19:50')
        ]
    });
    assert.equal(r.carregados, 1);
});

test('aulas fora do PL ficam de fora; feriado marcado; componentes em ordem de inicio', () => {
    const r = diasDoDocente({
        termStart: '2027-03-22',
        termEnd: '2027-03-28',
        feriados: ['2027-03-26'],
        entries: [
            aula('2027-03-21', 'EP2024|ESTATISTICA', '08:00 - 08:50'),
            aula('2027-03-25', 'EP2027|INFORMATICA', '14:00 - 14:50'),
            aula('2027-03-22', 'EP2024|ESTATISTICA', '08:00 - 08:50'),
            aula('2027-03-29', 'EP2025|ECOLOGIA', '14:00 - 14:50')
        ]
    });
    assert.deepEqual(r.componentes.map((c) => c.key), ['EP2024|ESTATISTICA', 'EP2027|INFORMATICA']);
    assert.equal(r.componentes[0].firstDate, '2027-03-22');
    assert.equal(r.datas.find((d) => d.date === '2027-03-26').feriado, true);
    assert.equal(r.datas.find((d) => d.date === '2027-03-25').feriado, false);
    assert.equal(r.datas[6].weekday, 0); // 28/03 e domingo
});

test('PL invalido devolve vazio', () => {
    assert.deepEqual(diasDoDocente({ termStart: '2027-04-01', termEnd: '2027-03-01' }), { datas: [], componentes: [], carregados: 0 });
});

test('estagio em campo aparece, mas nao faz o dia carregado (20/11/2026)', () => {
    const r = diasDoDocente({
        termStart: '2027-03-15',
        termEnd: '2027-03-21',
        entries: [
            aula('2027-03-15', 'EP2024|ESTATISTICA', '08:00 - 08:50'),
            aula('2027-03-15', 'EP2025|ESTAGIO', '14:00 - 14:50', { campo: true }),
            aula('2027-03-16', 'EP2025|ESTAGIO', '14:00 - 14:50')
        ]
    });
    const seg = r.datas.find((d) => d.date === '2027-03-15');
    assert.equal(seg.carregado, false);
    assert.deepEqual(seg.componentes, ['EP2024|ESTATISTICA']);
    assert.deepEqual(seg.emCampo, ['EP2025|ESTAGIO']);
    const estagio = r.componentes.find((c) => c.key === 'EP2025|ESTAGIO');
    assert.equal(estagio.porData['2027-03-15'].campo, true);
    assert.ok(!estagio.porData['2027-03-16'].campo); // encontro conta normal
    assert.equal(r.carregados, 0);
});
