// Funcoes compartilhadas de data (js/datas.mjs), horario (js/horarios.mjs) e texto (js/texto.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { toMiddayDate, toISODate, addDaysISO, getWeekStartISO, sortUniqueIsoDates, isoToUtc, weekdayOf, getLocalTodayIso } from '../js/datas.mjs';
import { timeToMinutesSafe, normalizeDayList, normalizeSlotList, normalizeDrawnSlotsByDay, buildDrawnSlotsByDay, normalizeConflictSlotLabel } from '../js/horarios.mjs';
import { escapeHtml, normalizeKeyPart } from '../js/texto.mjs';

test('addDaysISO soma e subtrai dias, inclusive virando mes e ano', () => {
    assert.equal(addDaysISO('2027-03-15', 7), '2027-03-22');
    assert.equal(addDaysISO('2027-03-01', -1), '2027-02-28');
    assert.equal(addDaysISO('2027-12-31', 1), '2028-01-01');
    assert.equal(addDaysISO(' 2027-03-15 ', '2'), '2027-03-17');
});

test('data invalida devolve vazio, sem erro', () => {
    assert.equal(addDaysISO('', 1), '');
    assert.equal(addDaysISO('15/03/2027', 1), '');
    assert.equal(getWeekStartISO('xx'), '');
    assert.equal(toISODate(new Date('nada')), '');
    assert.equal(toMiddayDate('2027-13-01'), null);
});

test('getWeekStartISO: segunda da semana; domingo fica na semana que termina nele', () => {
    assert.equal(getWeekStartISO('2027-03-17'), '2027-03-15');   // quarta
    assert.equal(getWeekStartISO('2027-03-15'), '2027-03-15');   // segunda
    assert.equal(getWeekStartISO('2027-03-21'), '2027-03-15');   // domingo
});

test('sortUniqueIsoDates, isoToUtc, weekdayOf e hoje', () => {
    assert.deepEqual(sortUniqueIsoDates(['2027-03-02', 'x', '2027-03-01', '2027-03-02']), ['2027-03-01', '2027-03-02']);
    assert.equal((isoToUtc('2027-03-02') - isoToUtc('2027-03-01')) / 86400000, 1);
    assert.equal(weekdayOf('2027-03-15'), 1);
    assert.equal(weekdayOf('2027-03-20'), 6);
    assert.match(getLocalTodayIso(), /^\d{4}-\d{2}-\d{2}$/);
});

test('horarios: minutos, dias e listas normalizadas', () => {
    assert.equal(timeToMinutesSafe('14:00 - 14:50'), 840);
    assert.equal(timeToMinutesSafe('M1'), Number.MAX_SAFE_INTEGER);
    assert.deepEqual(normalizeDayList(['3', 1, 7, 1, 0]), [1, 3]);
    assert.deepEqual(normalizeSlotList([' 15:40 - 16:30', '14:00 - 14:50', '15:40 - 16:30', '']), ['14:00 - 14:50', '15:40 - 16:30']);
    assert.deepEqual(normalizeDrawnSlotsByDay({ 2: ['14:50 - 15:40', '14:00 - 14:50'], 7: ['14:00'], 3: [] }), { 2: ['14:00 - 14:50', '14:50 - 15:40'] });
    assert.deepEqual(buildDrawnSlotsByDay([3, 1], ['14:00 - 14:50']), { 1: ['14:00 - 14:50'], 3: ['14:00 - 14:50'] });
    assert.equal(normalizeConflictSlotLabel(' 14:00–14:50 '), '14:00 - 14:50');
});

test('texto: escapeHtml e chave em maiuscula', () => {
    assert.equal(escapeHtml(`<b>"Zé" & 'Ana'</b>`), '&lt;b&gt;&quot;Zé&quot; &amp; &#39;Ana&#39;&lt;/b&gt;');
    assert.equal(escapeHtml(null), '');
    assert.equal(normalizeKeyPart('  ep2027 '), 'EP2027');
});
