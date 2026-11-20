import { escapeHtml as esc } from './texto.mjs?v=202611201738';
import { vividHexColor, hexToRgb, rgbToHsl, hslToRgb } from './color_utils.js?v=202611201738';
// Desenho do quadro "Dias do docente": uma coluna por dia do PL, a linha
// "Dia a dia" (verde = 1 componente, vermelho = 2 ou mais) e uma linha por
// componente. Usado em Indicadores > Dias do docente; sem store e sem DOM
// global, para poder servir tambem a agenda publica (Consulta Docente).
// A regra (quais dias, quais componentes) esta em dias_docente.mjs; aqui so o HTML.
// Testado em tests/quadro_dias.test.mjs.

const SEMANA_CURTA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const LETRA_DIA = ['', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export const DICA_MOUSE = 'Passe o mouse num dia para ver as aulas dele.';

// Carga horaria: inteiro com separador de milhar; fracao com 1 casa. Zero = ''.
export function fmtCH(n) {
    if (!n) return '';
    return Number.isInteger(n) ? n.toLocaleString('pt-BR') : n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

// PL sem aulas do docente: so o cabecalho.
export function quadroVazioHtml(titulo, datas, aviso = 'Sem aulas neste período') {
    return `<section class="dd-quadro is-vazio"><div class="dd-head"><b class="dd-pl">${esc(titulo)}</b><span class="dd-datas">${esc(datas)}</span><span class="dd-sem">${esc(aviso)}</span></div></section>`;
}

// No quadro Dias do docente o vermelho e o alerta de "2 ou mais componentes".
// Componente de cor vermelha (ex.: Bioquimica rosa #ffc2c2 vira #ff4f4f no tom
// forte) e desenhada em rosa aqui, para nao parecer alerta (20/11/2026).
// So neste quadro: a cor da componente nas outras telas nao muda.
export function semVermelhoDeAlerta(hex) {
    const { r, g, b } = hexToRgb(hex);
    const { h, s, l } = rgbToHsl(r, g, b);
    if (s < 0.08 || (h >= 0.04 && h <= 0.96)) return hex;
    const out = hslToRgb(0.94, s, l);
    return `#${[out.r, out.g, out.b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}

// Uma coluna por dia do PL (domingo e uma coluna fina); linha 1 = meses,
// 2 = numero das segundas, 3 = letra do dia, 4 = "Dia a dia", depois as componentes.
// indice: posicao do quadro na lista guardada por quem desenha (ver focarDiaDoQuadro).
// aulas: horas de aula (difere de ch no estagio com CH do orientador); outroPL(key):
// nome do PL de origem quando a componente e de outro PL; dica: texto da faixa de info.
export function quadroDiasHtml(indice, titulo, datas, r, rotulos, ch, { aulas = ch, outroPL = () => '', dica = DICA_MOUSE } = {}) {
    const col = (k) => k + 2;
    const colunas = r.datas.map((d) => (d.weekday === 0 ? '4.75px' : 'minmax(5.7px, 1fr)')).join(' ');
    const pos = (k, linha) => `grid-column:${col(k)};grid-row:${linha}`;
    const corDe = (comp) => semVermelhoDeAlerta(vividHexColor(comp?.cor || '', '#7fa892'));
    let html = '';

    // Meses
    html += '<span class="dd-rot" style="grid-row:1"></span>';
    for (let i = 0; i < r.datas.length;) {
        const mes = r.datas[i].date.slice(0, 7);
        let j = i;
        while (j + 1 < r.datas.length && r.datas[j + 1].date.slice(0, 7) === mes) j += 1;
        html += `<span class="dd-mes" style="grid-column:${col(i)} / ${col(j) + 1};grid-row:1">${MES_CURTO[Number(mes.slice(5, 7)) - 1]}</span>`;
        i = j + 1;
    }
    // Segundas e letras
    html += '<span class="dd-rot dd-rot-sub" style="grid-row:2">segunda-feira, dia</span>';
    r.datas.forEach((d, k) => {
        html += `<span class="dd-num" style="${pos(k, 2)}" data-dd-h="${d.date}">${d.weekday === 1 ? Number(d.date.slice(8, 10)) : ''}</span>`;
    });
    html += '<span class="dd-rot" style="grid-row:3"></span>';
    r.datas.forEach((d, k) => {
        html += `<span class="dd-letra" style="${pos(k, 3)}" data-dd-h="${d.date}">${LETRA_DIA[d.weekday]}</span>`;
    });

    const celula = (d, k, linha, classe, cor) => {
        if (d.weekday === 0) return `<span class="dd-d dd-dom" style="${pos(k, linha)}"></span>`;
        // Primeiro dia do mes (2 se o dia 1 cai no domingo): linha mais forte a
        // esquerda separa os meses (antes era fundo cinza nos meses pares - confundia).
        const iniMes = k > 0 && (d.date.endsWith('-01') || (d.date.endsWith('-02') && d.weekday === 1)) ? ' dd-mes-ini' : '';
        const fer = d.feriado && !classe.includes('dd-on') && !classe.includes('dd-n2') ? ' dd-fer' : '';
        return `<span class="dd-d${iniMes}${fer}${classe}" data-dd-date="${d.date}" style="${pos(k, linha)}${cor ? `;--dd-c:${cor}` : ''}"></span>`;
    };

    // Dia a dia (todas as componentes juntas)
    html += '<span class="dd-rot dd-rot-resumo" style="grid-row:4"><span class="dd-rot-nome">Dia a dia</span><span class="dd-rot-sub">todas as componentes</span></span>';
    r.datas.forEach((d, k) => {
        if (d.carregado) html += celula(d, k, 4, ' dd-resumo dd-n2', '');
        // Um verde so (nao a cor da componente): uma componente vermelha nao parece dia carregado.
        else if (d.componentes.length === 1) html += celula(d, k, 4, ' dd-resumo dd-um', '');
        else if (d.emCampo.length) html += celula(d, k, 4, ' dd-resumo dd-campo', '');
        else html += celula(d, k, 4, ' dd-resumo', '');
    });
    html += '<span class="dd-sep" style="grid-row:5"></span>';

    // Uma linha por componente
    const carregado = new Set(r.datas.filter((d) => d.carregado).map((d) => d.date));
    r.componentes.forEach((comp, n) => {
        const linha = 6 + n;
        const turma = rotulos.get(comp.key) || comp.turmaId;
        const sub = [turma, `${comp.turnos} ${comp.horario}`.trim(), comp.weekdays, `${fmtCH(comp.aulas)}h`].filter(Boolean).join(' · ');
        // Componente de outro PL: cor fraca e listrada (nome tambem mais apagado).
        const pl = outroPL(comp.key);
        const dica = pl ? `${comp.disciplina} (componente do ${pl})\n${sub}` : `${comp.disciplina}\n${sub}`;
        html += `<span class="dd-rot${pl ? ' dd-rot-outro' : ''}" style="grid-row:${linha}" title="${esc(dica)}"><span class="dd-rot-nome">${esc(comp.disciplina)}</span><span class="dd-rot-sub">${esc(sub)}</span></span>`;
        const cor = corDe(comp);
        r.datas.forEach((d, k) => {
            if (!comp.porData[d.date]) { html += celula(d, k, linha, '', ''); return; }
            // Estagio em campo: os alunos no campo, sem o docente (cinza, nao pesa o dia).
            if (comp.porData[d.date].campo) { html += celula(d, k, linha, ' dd-campo', ''); return; }
            html += celula(d, k, linha, ` dd-on${pl ? ' dd-outro' : ''}${carregado.has(d.date) ? ' dd-dupla' : ''}`, cor);
        });
    });

    return `
        <section class="dd-quadro" data-dd-quadro="${indice}">
            <div class="dd-head">
                <b class="dd-pl">${esc(titulo)}</b>
                <span class="dd-datas">${esc(datas)}</span>
                ${ch === aulas
                    ? `<span class="dd-ch" title="Carga horária do docente neste PL">${fmtCH(ch) || 0}h</span>`
                    : `<span class="dd-ch dd-ch-orientador" title="Carga horária do docente neste PL: ${fmtCH(ch)} h (o estágio conta a CH do orientador). Horas de aula no calendário: ${fmtCH(aulas)} h.">${fmtCH(ch) || 0}/${fmtCH(aulas) || 0}h</span>`}
                ${r.carregados ? `<span class="dd-alerta">${r.carregados} dia${r.carregados === 1 ? '' : 's'} com 2 ou mais componentes</span>` : '<span class="dd-sem">nenhum dia com 2 componentes</span>'}
            </div>
            <div class="dd-legenda">
                <span><i class="dd-leg-baixo" style="background:#8fbfa2"></i>Dia a dia: 1 componente</span>
                <span><i class="dd-leg-baixo" style="background:#d61f1f;border-color:#d61f1f"></i>Dia a dia: 2 ou mais componentes</span>
                <span><i style="background:#6aaee8"></i>aula (cor da componente)</span>
                <span><i style="background:#6aaee8;box-shadow:inset 0 -4px 0 #d61f1f,inset 0 -5px 0 #fff"></i>aula num dia carregado</span>
                <span><i style="background:repeating-linear-gradient(135deg,#b9c6bd 0 2px,transparent 2px 4px)"></i>feriado</span>
                ${r.datas.some((d) => d.emCampo.length) ? '<span><i class="dd-leg-campo"></i>estágio em campo (alunos no campo; não pesa o dia do docente)</span>' : ''}
                ${r.componentes.some((c) => outroPL(c.key)) ? '<span><i class="dd-leg-outro" style="--dd-c:#6aaee8"></i>aula de outro PL (nas datas deste)</span>' : ''}
                <span>coluna fina = domingo</span>
            </div>
            <div class="dd-info" aria-live="polite">${esc(dica)}</div>
            <div class="dd-rolagem"><div class="dd-grade" style="grid-template-columns:minmax(152px, 208px) ${colunas}">${html}</div></div>
        </section>`;
}

export function textoDoDia(quadro, date) {
    const { r, rotulos, nomeFeriado } = quadro;
    const dia = r.datas.find((d) => d.date === date);
    if (!dia) return '';
    const nome = `${SEMANA_CURTA[dia.weekday]} ${ddmm(date)}`;
    if (dia.feriado && !dia.componentes.length && !dia.emCampo.length) return `${esc(nome)}: feriado (${esc(nomeFeriado.get(date) || 'Feriado')}).`;
    if (!dia.componentes.length && !dia.emCampo.length) return `${esc(nome)}: sem aula.`;
    const item = (key, campo) => {
        const comp = r.componentes.find((c) => c.key === key);
        const d = comp.porData[date];
        return `${campo ? 'estágio em campo, ' : ''}${esc(`${d.turnos} ${d.horario}`.trim())}: ${esc(comp.disciplina)} (${esc(rotulos.get(key) || comp.turmaId)})`;
    };
    const lista = [...dia.componentes.map((key) => item(key, false)), ...dia.emCampo.map((key) => item(key, true))].join(' · ');
    return dia.carregado
        ? `${esc(nome)}: <b>${dia.componentes.length} componentes no mesmo dia</b> · ${lista}`
        : `${esc(nome)}: ${lista}`;
}

// quadros: a lista guardada por quem desenhou ({ r, rotulos, nomeFeriado } por indice).
export function focarDiaDoQuadro(cel, quadros) {
    const secao = cel.closest('[data-dd-quadro]');
    const quadro = quadros[Number(secao?.dataset.ddQuadro)];
    if (!secao || !quadro) return;
    const date = cel.dataset.ddDate;
    secao.querySelectorAll('.is-foco').forEach((el) => el.classList.remove('is-foco'));
    secao.querySelectorAll(`[data-dd-date="${date}"], [data-dd-h="${date}"]`).forEach((el) => el.classList.add('is-foco'));
    const info = secao.querySelector('.dd-info');
    if (info) info.innerHTML = textoDoDia(quadro, date);
}
