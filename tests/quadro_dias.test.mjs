// Desenho do quadro "Dias do docente" (Indicadores e agenda publica).
import assert from 'node:assert/strict';
import test from 'node:test';
import { diasDoDocente } from '../js/dias_docente.mjs';
import { fmtCH, quadroDiasHtml, quadroVazioHtml, textoDoDia, semVermelhoDeAlerta, DICA_MOUSE, entradaDias, montarQuadrosDias, quadroTurmaHtml, textoSobrecarga } from '../js/quadro_dias.mjs';

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
    assert.match(html, />1 dia com sobrecarga</);
    assert.match(html, /Sobrecarga diária<\/span><span class="dd-rot-leg"><i class="dd-leg dd-leg-sim"><\/i>sim<i class="dd-leg dd-leg-nao"><\/i>não/, 'legenda sim/nao na linha 1');
    assert.match(html, /<span class="dd-info" aria-live="polite"><\/span>/, 'caixa do dia vazia no cabecalho');
    assert.ok(!html.includes(DICA_MOUSE), 'a dica fica uma vez so, fora do quadro');
    assert.ok(!html.includes('dd-legenda'), 'sem legenda');
    assert.ok(!html.includes('<B>'), 'nome da componente escapado');
});

test('quadro: dica trocavel (celular)', () => {
    const html = quadroDiasHtml(0, 'PL', 'datas', r, rotulos, 3, { dica: 'Toque num dia para ver as aulas dele.' });
    assert.ok(html.includes('Toque num dia'));
});

test('quadro vazio: aviso padrao e aviso proprio', () => {
    assert.match(quadroVazioHtml('2027 - PL3', 'x'), /dd-quadro is-vazio.*Sem aulas neste período/);
    assert.match(quadroVazioHtml('2027 - PL3', 'x', 'Ainda sem ofertas publicadas'), /Ainda sem ofertas publicadas/);
});

test('texto do dia: carregado, comum, feriado, sem aula', () => {
    assert.match(textoDoDia(quadro, '2027-03-15'), /^seg 15\/03 · <b>2 componentes<\/b> · 08:00–08:50 ESTATISTICA \(EP2024\) · 14:00–14:50 ECOLOGIA &lt;B&gt; \(EP2025\)$/);
    assert.equal(textoDoDia(quadro, '2027-03-16'), 'ter 16/03 · 08:00–08:50 ESTATISTICA (EP2024)');
    assert.equal(textoDoDia(quadro, '2027-03-19'), 'sex 19/03: feriado (Dia de São José).');
    assert.equal(textoDoDia(quadro, '2027-03-17'), 'qua 17/03: sem aula.');
    assert.equal(textoDoDia(quadro, '2027-04-01'), '');
});

test('outro PL: celulas fracas e listradas, nome apagado', () => {
    const outroPL = (key) => (key === 'EP2025|ECOLOGIA <B>' ? 'PL2' : '');
    const html = quadroDiasHtml(0, 'PL3', 'datas', r, rotulos, 3, { outroPL });
    assert.equal((html.match(/dd-on dd-outro/g) || []).length, 1, 'so a aula da Ecologia');
    assert.equal((html.match(/dd-rot dd-rot-outro/g) || []).length, 1);
    assert.match(html, /componente do PL2/);
});

test('CH ao lado da componente: do docente / da componente; igual = so um numero', () => {
    const chComp = (comp) => (comp.key.startsWith('EP2024') ? { docente: 60, total: 90 } : { docente: 30, total: 30 });
    const html = quadroDiasHtml(0, 'PL', 'datas', r, rotulos, 3, { chComp });
    assert.match(html, /<b class="dd-rot-ch">60\/90h<\/b> · EP2024/);
    assert.match(html, /<b class="dd-rot-ch">30h<\/b> · EP2025/);
    assert.match(html, /CH do docente: 60 h de 90 h da componente/);
    assert.match(quadroDiasHtml(0, 'PL', 'datas', r, rotulos, 3), /<b class="dd-rot-ch">2h<\/b>/, 'sem chComp: horas de aula');
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

test('textoSobrecarga: singular, plural e nenhum', () => {
    assert.equal(textoSobrecarga(0), 'nenhum dia com sobrecarga');
    assert.equal(textoSobrecarga(1), '1 dia com sobrecarga');
    assert.equal(textoSobrecarga(3), '3 dias com sobrecarga');
});

test('montarQuadrosDias: PLs sobrepostos, outro PL listrado, CH do orientador, PL vazio com aviso', () => {
    const ev = (turmaId, disciplina, extra = {}) => ({ turmaId, disciplina, cor: '#3366cc', horario: '08:00 - 08:50', docentes: [{ nome: 'X' }], ...extra });
    const planos = [
        { key: 'pl2', periodo: 'PL2', termStart: '2027-03-15', termEnd: '2027-03-26' },
        { key: 'pl3', periodo: 'PL3', termStart: '2027-03-22', termEnd: '2027-04-02' },
        { key: 'pl4', periodo: 'PL4', termStart: '2027-08-23', termEnd: '2027-08-27', naoPublicado: true }
    ];
    const estagio = ev('EP2024', 'ESTAGIO III', { ch: 90, chOrientador: 45 });
    const entries = [
        entradaDias(ev('EP2025', 'ECOLOGIA'), '2027-03-22', 'pl2'),
        entradaDias(estagio, '2027-03-22', 'pl3', { chComponente: 90, aulas: 2, horario: '14:00 - 15:40' }),
        entradaDias(estagio, '2027-03-29', 'pl3', { chComponente: 90, aulas: 2, horario: '14:00 - 15:40' })
    ];
    assert.equal(entries[1].key, 'EP2024|ESTAGIO III|');
    assert.equal(entries[1].chOrientador, 45);
    const rotulos = new Map(entries.map((e) => [e.key, e.turmaId]));
    const out = montarQuadrosDias({ planos, entries, rotulos, avisoVazio: (m) => (m.naoPublicado ? 'Ainda sem ofertas publicadas' : undefined) });
    assert.equal(out.quadros.length, 2, 'PL4 vazio nao entra na lista de quadros');
    assert.equal(out.carregados, 2, '22/03 com sobrecarga no PL2 e no PL3 (os dois mostram o dia)');
    assert.equal(out.chDoPL('pl2'), 1);
    assert.equal(out.chDoPL('pl3'), 45, 'estagio conta a CH do orientador');
    assert.match(out.html, /dd-on dd-outro/, 'componente do outro PL listrada');
    assert.match(out.html, /Ainda sem ofertas publicadas/);
    assert.match(out.html, /45\/4h/, 'pill do PL3: CH do docente / horas de aula');
});

// ===== Quadro da turma (Indicadores > Componente, 26/11/2026) =====
test('quadro da turma: sem Sobrecarga diaria, buscada em destaque, as outras claras', () => {
    const entries = [
        { ...aula('2027-03-15', 'EP2024|ESTATISTICA|', '08:00 - 08:50'), chComponente: 60 },
        { ...aula('2027-03-15', 'EP2024|ECOLOGIA|', '14:00 - 14:50'), chComponente: 45 },
        { ...aula('2027-03-16', 'EP2024|ECOLOGIA|', '14:00 - 14:50'), chComponente: 45 }
    ];
    const { html, quadro } = quadroTurmaHtml({
        titulo: 'EP2024 · 2027 - PL2', datas: 'x', termStart: '2027-03-15', termEnd: '2027-03-21',
        entries, rotulos: new Map([['EP2024|ECOLOGIA|', 'Ana Souza']]), destaque: 'EP2024|ECOLOGIA|'
    });
    assert.doesNotMatch(html, /Sobrecarga/, 'turma: 2 componentes no dia e normal');
    assert.doesNotMatch(html, /dd-dupla|dd-n2/);
    assert.equal((html.match(/dd-rot-destaque/g) || []).length, 1);
    assert.equal((html.match(/dd-rot-apagada/g) || []).length, 1);
    assert.equal((html.match(/dd-on dd-apagada/g) || []).length, 1, 'a Estatistica (1 aula) fica clara');
    assert.match(html, /<b class="dd-rot-ch">45h<\/b> · Ana Souza/, 'CH da componente e o docente ao lado');
    assert.match(html, /<span class="dd-ch" title="Horas de aula da turma neste PL">3h<\/span>/);
    assert.equal(quadro.r.carregados, 0);
});

test('quadro da turma: vai ate a ultima aula se passar do fim do PL; sem aulas = aviso', () => {
    const { quadro } = quadroTurmaHtml({
        titulo: 't', datas: 'x', termStart: '2027-03-15', termEnd: '2027-03-16',
        entries: [aula('2027-03-18', 'EP2024|ESTATISTICA|', '08:00 - 08:50')]
    });
    assert.equal(quadro.r.datas[quadro.r.datas.length - 1].date, '2027-03-18');
    const vazio = quadroTurmaHtml({ titulo: 't', datas: 'x', termStart: '2027-03-15', termEnd: '2027-03-16' });
    assert.equal(vazio.quadro, null);
    assert.match(vazio.html, /Sem aulas desta turma/);
});
