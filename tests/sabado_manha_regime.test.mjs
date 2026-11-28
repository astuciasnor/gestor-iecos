// Sabado passado para a manha (sabadoManha) numa turma da tarde: o calendario
// converte o horario desenhado (14:00) para a manha (08:00) pelo regime do curso
// DA TURMA. Antes (28/11/2026) usava o regime do curso escolhido na tela; a agenda
// publica nao escolhe curso, ficava no regime padrao (tarde 13:30) e mostrava o
// sabado as 14:00 com aviso "Tarde".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const memoria = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
globalThis.localStorage = memoria;
globalThis.sessionStorage = memoria;
globalThis.window = globalThis;
globalThis.document = { getElementById: () => null, querySelector: () => null, addEventListener() {} };

const fonteCalendario = fs.readFileSync(new URL('../js/calendar.js', import.meta.url), 'utf8');
const versao = (fonteCalendario.match(/store\.js\?v=(\d+)/) || [])[1] || '';
const { store } = await import(`../js/store.js${versao ? `?v=${versao}` : ''}`);
const { getCalendarEvents } = await import('../js/calendar.js');

store.rawData = JSON.parse(fs.readFileSync(new URL('../dados_app.json', import.meta.url), 'utf8'));
store.settings.termStart = '2027-08-23';   // depois da vigencia dos regimes por curso
store.settings.termEnd = '2027-12-23';

const TARDE = ['14:00 - 14:50', '14:50 - 15:40', '15:40 - 16:30'];
const SABADO = '2027-10-30';
const oferta = {
    id: 'sab1', ch: 3, modo: 'faixas', modelo: 'Automatico', turmaId: 'EP2027', disciplina: 'TESTE SABADO',
    docente: 'Professor do Teste', dataInicio: SABADO, dataFim: SABADO, diasMarcados: [6], usaSabado: true,
    sabadoManha: true, horariosOcupados: TARDE, horariosUltimoDia: TARDE,
    faixas: [{ inicio: SABADO, fim: SABADO, dias: [6], slots: TARDE, drawnSlotsByDay: { 6: TARDE } }]
};
const horariosDoSabado = () => (getCalendarEvents('EP2027', SABADO, SABADO)[SABADO] || []).map((e) => e.horario);

test('a EP2027 e da tarde e o curso EP usa um regime com tarde as 14:00', () => {
    const turma = store.rawData.turmas.find((t) => t.turma_id === 'EP2027');
    assert.match(turma.turno, /tarde/i);
    assert.ok(store.getHorariosPorTurnoDoCurso('EP').Tarde.includes('14:00 - 14:50'));
});

test('sem curso escolhido (agenda publica): sabado vai para a manha', () => {
    store.selectedCurso = null;
    store.allocations = [oferta];
    assert.deepEqual(horariosDoSabado(), ['08:00 - 08:50', '08:50 - 09:40', '09:40 - 10:30']);
});

test('com outro curso escolhido na tela: continua pela turma da aula', () => {
    store.selectedCurso = 'MT';
    store.allocations = [oferta];
    assert.deepEqual(horariosDoSabado(), ['08:00 - 08:50', '08:50 - 09:40', '09:40 - 10:30']);
    store.selectedCurso = null;
});

test('sem a marca de sabado na manha: fica no horario desenhado', () => {
    store.allocations = [{ ...oferta, sabadoManha: false }];
    assert.deepEqual(horariosDoSabado(), TARDE);
});
