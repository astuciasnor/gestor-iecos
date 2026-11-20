// Desenho do quadro "Dias do docente" (Indicadores e agenda publica).
import assert from 'node:assert/strict';
import test from 'node:test';
import { diasDoDocente } from '../js/dias_docente.mjs';
import { fmtCH, quadroDiasHtml, quadroVazioHtml, textoDoDia, semVermelhoDeAlerta, DICA_MOUSE } from '../js/quadro_dias.mjs';

const aula = (date, key, horario) => ({
    date, key, horario, aulas: 1, disciplina: key.split('|')[1], turmaId: key.split('|')[0], subGrupo: '', cor: '#3366cc'
});

// 15/03/2027 e segunda; 21/03 e domingo.
const r = diasDoDocente({
    termStart: '2027-03-15',
    termEnd: '2027-03-21',
    feriados: ['2027-03-19'],
    entries: [
        aula('2027-03-15', 'EP2024|ESTATISTICA', '08:00 - 08:50'),
        aula('2027-03-15', 'EP2025|ECOLOGIA <B>', '14:00 - 14:50'),
        aula('2027-03-16', 'EP2024|ESTATISTICA', '08:00 - 08:50')
    ]
});
const rotulos = new Map([['EP2024|ESTATISTICA', 'EP2024'], ['EP2025|ECOLOGIA <B>', 'EP2025']]);
const quadro = { r, rotulos, nomeFeriado: new Map([['2027-03-19', 'Dia de São José']]) };

test('fmtCH: inteiro, fracao e zero', () => {
    assert.equal(fmtCH(0), '');
    assert.equal(fmtCH(1234), '1.234');
    assert.equal(fmtCH(2.5), '2,5');
});

test('quadro: uma coluna por dia, Dia a dia vermelho no dia carregado, CH e dica', () => {
    const html = quadroDiasHtml(3, '2027 - PL2', '15/03/2027 a 21/03/2027', r, rotulos, 3);
    assert.match(html, /data-dd-quadro="3"/);
    assert.equal((html.match(/dd-resumo/g) || []).length, 6, 'Dia a dia: 6 dias (domingo e coluna fina, sem celula)');
    assert.equal((html.match(/dd-resumo dd-n2/g) || []).length, 1);
    assert.equal((html.match(/dd-on/g) || []).length, 3);
    assert.match(html, /<span class="dd-ch"[^>]*>3h<\/span>/);
    assert.match(html, /1 dia com 2 ou mais componentes/);
    assert.ok(html.includes(DICA_MOUSE));
    assert.ok(!html.includes('<B>'), 'nome da componente escapado');
});

test('quadro: dica trocavel (celular)', () => {
    const html = quadroDiasHtml(0, 'PL', 'datas', r, rotulos, 3, { dica: 'Toque num dia para ver as aulas dele.' });
    assert.ok(html.includes('Toque num dia'));
    assert.ok(!html.includes(DICA_MOUSE));
});

test('quadro vazio: aviso padrao e aviso proprio', () => {
    assert.match(quadroVazioHtml('2027 - PL3', 'x'), /dd-quadro is-vazio.*Sem aulas neste período/);
    assert.match(quadroVazioHtml('2027 - PL3', 'x', 'Ainda sem ofertas publicadas'), /Ainda sem ofertas publicadas/);
});

test('texto do dia: carregado, comum, feriado, sem aula', () => {
    assert.match(textoDoDia(quadro, '2027-03-15'), /^seg 15\/03: <b>2 componentes no mesmo dia<\/b> · manhã 08:00–08:50: ESTATISTICA \(EP2024\) · tarde 14:00–14:50: ECOLOGIA &lt;B&gt; \(EP2025\)$/);
    assert.equal(textoDoDia(quadro, '2027-03-16'), 'ter 16/03: manhã 08:00–08:50: ESTATISTICA (EP2024)');
    assert.equal(textoDoDia(quadro, '2027-03-19'), 'sex 19/03: feriado (Dia de São José).');
    assert.equal(textoDoDia(quadro, '2027-03-17'), 'qua 17/03: sem aula.');
    assert.equal(textoDoDia(quadro, '2027-04-01'), '');
});

test('outro PL: celulas fracas e listradas, nome apagado e item na legenda', () => {
    const outroPL = (key) => (key === 'EP2025|ECOLOGIA <B>' ? 'PL2' : '');
    const html = quadroDiasHtml(0, 'PL3', 'datas', r, rotulos, 3, { outroPL });
    assert.equal((html.match(/dd-on dd-outro/g) || []).length, 1, 'so a aula da Ecologia');
    assert.equal((html.match(/dd-rot dd-rot-outro/g) || []).length, 1);
    assert.match(html, /componente do PL2/);
    assert.match(html, /aula de outro PL/);
    assert.ok(!quadroDiasHtml(0, 'PL3', 'datas', r, rotulos, 3).includes('aula de outro PL'), 'sem outro PL, sem item na legenda');
});

test('CH do orientador diferente das horas de aula: mostra as duas', () => {
    assert.match(quadroDiasHtml(0, 'PL', 'datas', r, rotulos, 2, { aulas: 3 }), /dd-ch-orientador[^>]*>2\/3h</);
});

test('vermelho vira rosa; as outras cores ficam', () => {
    assert.equal(semVermelhoDeAlerta('#ff4f4f'), '#ff4f8e');
    assert.equal(semVermelhoDeAlerta('#6aaee8'), '#6aaee8');
    assert.equal(semVermelhoDeAlerta('#808080'), '#808080', 'cinza fica');
});

test('comeco do mes: linha no dia 1 (ou na segunda dia 2), nunca na 1a coluna', () => {
    const r2 = diasDoDocente({ termStart: '2027-07-30', termEnd: '2027-08-03', entries: [] });
    const html = quadroDiasHtml(0, 'PL', 'datas', r2, new Map(), 0);
    assert.ok(/dd-mes-ini[^>]*data-dd-date="2027-08-02"/.test(html), '1/8/2027 e domingo: linha na segunda, dia 2');
    assert.ok(!/dd-mes-ini[^>]*data-dd-date="2027-07-30"/.test(html));
    const r3 = diasDoDocente({ termStart: '2027-06-28', termEnd: '2027-07-02', entries: [] });
    assert.ok(/dd-mes-ini[^>]*data-dd-date="2027-07-01"/.test(quadroDiasHtml(0, 'PL', 'datas', r3, new Map(), 0)));
});
