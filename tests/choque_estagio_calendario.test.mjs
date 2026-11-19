// Regra de choque do estagio passando pelo CALENDARIO de verdade (js/calendar.js +
// js/conflicts.js), com os dados do app (dados_app.json): nao so a funcao da regra.
//  - estagio fora do turno da turma: sem choque para o professor;
//  - estagio dentro do turno da turma (encontro): choque normal;
//  - as outras componentes nao mudam.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// O calendario roda no navegador: o minimo para carregar no Node.
const memoria = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
globalThis.localStorage = memoria;
globalThis.sessionStorage = memoria;
globalThis.window = globalThis;
globalThis.document = { getElementById: () => null, querySelector: () => null, addEventListener() {} };

// O calendario importa o store com '?v=<versao>': no Node isso e outro modulo.
// Usa a mesma versao para mexer no MESMO store que o calendario le.
const fonteCalendario = fs.readFileSync(new URL('../js/calendar.js', import.meta.url), 'utf8');
const versao = (fonteCalendario.match(/store\.js\?v=(\d+)/) || [])[1] || '';
const { store } = await import(`../js/store.js${versao ? `?v=${versao}` : ''}`);
const { getCalendarEvents } = await import('../js/calendar.js');
const { detectTeacherConflicts } = await import('../js/conflicts.js');

store.rawData = JSON.parse(fs.readFileSync(new URL('../dados_app.json', import.meta.url), 'utf8'));
store.settings.termStart = '2027-03-15';
store.settings.termEnd = '2027-07-14';

const PROF = 'Professor do Teste';
const NOITE = '18:30 - 19:20';
const MANHA = '08:00 - 08:50';
let seq = 0;
function oferta(turmaId, disciplina, slot, docente = PROF) {
    const slots = [slot];
    return {
        id: `t${++seq}`, ch: 1, modo: 'faixas', modelo: 'Automatico', turmaId, disciplina, docente,
        dataInicio: '2027-03-15', dataFim: '2027-03-15', diasMarcados: [1], usaSabado: false, sabadoManha: false,
        horariosOcupados: slots, horariosUltimoDia: slots,
        faixas: [{ inicio: '2027-03-15', fim: '2027-03-15', dias: [1], slots, drawnSlotsByDay: { 1: slots } }]
    };
}
const choquesDoProfessor = () => detectTeacherConflicts({ eventsByDate: getCalendarEvents(null, '2027-03-15', '2027-03-21', PROF) });

test('turmas do teste existem com o turno esperado', () => {
    const turno = (id) => store.rawData.turmas.find((t) => t.turma_id === id)?.turno || '';
    assert.match(turno('CB2024'), /Manh/);
    assert.match(turno('EP2025'), /Tarde/);
});

test('estágio da CB2024 (Manhã) à noite + outra aula do professor no mesmo horário: sem choque', () => {
    store.allocations = [oferta('CB2024', 'CBBR049 ESTÁGIO III', NOITE), oferta('EP2025', 'QUIMICA BASICA', NOITE)];
    const aulas = getCalendarEvents(null, '2027-03-15', '2027-03-15', PROF)['2027-03-15'];
    assert.equal(aulas.length, 2); // as duas aulas existem no calendario
    assert.equal(choquesDoProfessor().length, 0);
});

test('encontro do estágio de manhã (turno da turma) + outra aula do professor: choque', () => {
    store.allocations = [oferta('CB2024', 'CBBR049 ESTÁGIO III', MANHA), oferta('EP2024', 'QUIMICA BASICA', MANHA)];
    assert.equal(choquesDoProfessor().length, 1);
});

test('componente comum no mesmo horário que outra do professor: choque, como sempre', () => {
    store.allocations = [oferta('CB2024', 'ZOOLOGIA', NOITE), oferta('EP2025', 'QUIMICA BASICA', NOITE)];
    assert.equal(choquesDoProfessor().length, 1);
});

test('o calendário marca semChoque só no estágio fora do turno da turma', () => {
    store.allocations = [
        oferta('CB2024', 'CBBR049 ESTÁGIO III', NOITE),
        oferta('CB2024', 'CBBR050 ESTÁGIO IV', MANHA, 'Outro Professor'),
        oferta('CB2024', 'ZOOLOGIA', NOITE, 'Terceiro Professor')
    ];
    const eventos = getCalendarEvents('CB2024', '2027-03-15', '2027-03-15')['2027-03-15'];
    const marca = (disc, slot) => eventos.find((e) => e.disciplina.startsWith(disc) && e.horario === slot)?.semChoque;
    assert.equal(marca('CBBR049', NOITE), true);
    assert.equal(marca('CBBR050', MANHA), false);
    assert.equal(marca('ZOOLOGIA', NOITE), false);
});

test('regime 1: estágio de turma da Tarde às 18:00 (última aula da Tarde) conta choque', () => {
    const TARDE_FIM = '18:00 - 18:50';
    store.allocations = [oferta('EP2025', 'ESTÁGIO SUPERVISIONADO', TARDE_FIM), oferta('CB2025', 'ZOOLOGIA', TARDE_FIM)];
    assert.equal(choquesDoProfessor().length, 1);
});
