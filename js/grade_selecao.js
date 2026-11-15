// Selecao na grade semanal da aba Alocar: clique, arrasto e Shift+clique
// (retangulo, como no Excel), e o clique que escolhe o inicio de uma faixa.
//
// Os eventos ficam na grade (#weekly-grid), uma vez so: o renderWeeklyGrid
// (js/ui.js) so marca em cada celula o que ela faz, em data-acao:
//   inicio   - escolhe o inicio da faixa pendente (pointerdown);
//   desenhar - marca/desmarca o horario; arrastar pinta varios; Shift+clique
//              marca o retangulo desde a ancora (mousedown + mouseenter);
//   aviso    - fora da faixa: mostra o aviso (data-aviso) ou, num dia livre
//              antes do inicio (data-recomecar="1"), recomeca a componente ali.
// O resto (o que muda nas faixas ao marcar) continua no ui.js e chega aqui por
// ligarSelecaoDaGrade({ ...funcoes do ui.js }).

let lig = null;

// Arrasto em andamento: { active, shouldSelect (marcar ou apagar), touchedAnyCell }.
const arrasto = { active: false, shouldSelect: true, touchedAnyCell: false };

// Ancora do Shift+clique: a ultima celula clicada na grade.
// { dia, horario, date, select } ou null.
let ancora = null;

export function arrastoAtivo() {
    return arrasto.active;
}

export function esquecerAncora() {
    ancora = null;
}

// Fim do arrasto (mouseup, janela perde o foco, troca de faixa...): grava a marcacao.
export function endDrawingDrag() {
    const shouldPersist = !!lig?.faixaEmDesenho() && arrasto.active && arrasto.touchedAnyCell;
    arrasto.active = false;
    arrasto.shouldSelect = true;
    arrasto.touchedAnyCell = false;
    if (document.body) document.body.style.userSelect = '';
    if (shouldPersist) lig.persistActiveDrawingSelection();
}

// Pinta (ou limpa) uma celula marcada, com as cores do desenho.
export function setDrawingCellSelection(cell, selected, styles) {
    if (!cell) return;
    if (selected) {
        cell.classList.add('selected-slot');
        cell.classList.remove('slot-free-draw');
        // O background precisa de !important inline para vencer a regra de tint
        // por turno (.timetable .slot.turno-* { background-color: ... !important }),
        // senao a celula pintada fica com a cor do turno e so a borda aparece colorida.
        cell.style.setProperty('background', styles.background, 'important');
        cell.style.border = styles.border;
        cell.style.color = styles.color;
        cell.style.fontWeight = styles.fontWeight;
        cell.style.boxShadow = styles.boxShadow || '';
    } else {
        cell.classList.remove('selected-slot');
        if (cell.dataset.canEdit === '1') cell.classList.add('slot-free-draw');
        cell.style.removeProperty('background');
        cell.style.border = '';
        cell.style.color = '';
        cell.style.fontWeight = '';
        cell.style.boxShadow = '';
    }
    lig.marcarSabadoManhaNaCelula(cell);
}

// A celula da grade num dia da semana (1..6) e horario; com data, so dessa data.
function celulaEm(dia, horario, date = '') {
    const grade = lig.grade();
    if (!grade) return null;
    return [...grade.querySelectorAll(`.slot[data-dia="${dia}"]`)]
        .find((c) => c.dataset.horario === horario && (!date || c.dataset.date === date)) || null;
}

export function marcarAncoraNaGrade() {
    const grade = lig?.grade();
    if (!grade) return;
    grade.querySelectorAll('.slot-ancora').forEach((c) => c.classList.remove('slot-ancora'));
    if (!ancora) return;
    celulaEm(ancora.dia, ancora.horario, ancora.date)?.classList.add('slot-ancora');
}

// Shift+clique: marca (ou apaga, se a ancora foi apagada) o retangulo entre a
// ancora e a celula clicada, como no Excel. Pula intervalo, feriado, horario
// ocupado e dia fora da faixa. Acha cada celula pela posicao, porque uma
// marcacao pode redesenhar a grade (inicio, sabado, faixa nova). Retorna false
// se nao ha ancora nesta semana (o clique segue como clique normal).
function marcarRetangulo(dia, horario, date) {
    const a = ancora;
    if (!a || !date || lig.getWeekStartISO(a.date) !== lig.getWeekStartISO(date)) return false;

    const horarios = [...new Set([...lig.grade().querySelectorAll('.slot[data-horario]')].map((c) => c.dataset.horario))];
    const l1 = horarios.indexOf(a.horario);
    const l2 = horarios.indexOf(horario);
    if (l1 < 0 || l2 < 0) return false;
    const linhas = horarios.slice(Math.min(l1, l2), Math.max(l1, l2) + 1);

    let mudou = false;
    for (let d = Math.min(a.dia, dia); d <= Math.max(a.dia, dia); d++) {
        for (const h of linhas) {
            const cell = celulaEm(d, h);
            if (!cell || cell.dataset.canEdit !== '1') continue;
            if (cell.classList.contains('selected-slot') === a.select) continue;
            if (!lig.tryApplyDrawingSelection(cell, a.select, lig.getDrawingSelectedStyles())) {
                if (a.select) { if (mudou) lig.persistActiveDrawingSelection(); return true; }   // CH cheia: para aqui
                continue;
            }
            mudou = true;
        }
    }
    if (mudou) lig.persistActiveDrawingSelection();
    marcarAncoraNaGrade();
    return true;
}

// Celula da grade (com a acao pedida) onde o evento aconteceu, ou null.
function celulaDoEvento(e, acao) {
    const grade = lig.grade();
    const cell = e.target instanceof Element ? e.target.closest('.slot') : null;
    if (!cell || !grade || !grade.contains(cell) || cell.dataset.acao !== acao) return null;
    return cell;
}

const diaDa = (cell) => parseInt(cell.dataset.dia, 10);

// Inicio da faixa pendente: um toque no dia escolhido.
function aoEscolherInicio(e) {
    const cell = celulaDoEvento(e, 'inicio');
    if (!cell) return;
    if (typeof e.button === 'number' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    endDrawingDrag();
    lig.applyPendingFaixaStartByDate(cell.dataset.date, { dia: diaDa(cell), slot: cell.dataset.horario });
}

// Comeco do clique/arrasto (ou Shift+clique) num horario livre da faixa.
function aoApertarNaCelula(e) {
    const cell = celulaDoEvento(e, 'desenhar');
    if (!cell) return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const dia = diaDa(cell);
    const horario = cell.dataset.horario;
    const date = cell.dataset.date;
    if (e.shiftKey && marcarRetangulo(dia, horario, date)) return;
    arrasto.active = true;
    arrasto.shouldSelect = !cell.classList.contains('selected-slot');
    ancora = { dia, horario, date, select: arrasto.shouldSelect };
    marcarAncoraNaGrade();
    arrasto.touchedAnyCell = false;
    if (document.body) document.body.style.userSelect = 'none';

    const applied = lig.tryApplyDrawingSelection(cell, arrasto.shouldSelect, lig.getDrawingSelectedStyles());
    if (!applied) {
        arrasto.active = false;
        if (document.body) document.body.style.userSelect = '';
        return;
    }
    arrasto.touchedAnyCell = true;
}

// Arrasto passando por outra celula. mouseenter nao borbulha: a grade o ouve na
// captura e so aceita quando o alvo e a propria celula (como um ouvinte nela).
function aoEntrarNaCelula(e) {
    if (!(e.target instanceof Element) || !e.target.matches('.slot')) return;
    const cell = celulaDoEvento(e, 'desenhar');
    if (!cell || !arrasto.active) return;
    const applied = lig.tryApplyDrawingSelection(cell, arrasto.shouldSelect, lig.getDrawingSelectedStyles());
    if (!applied) {
        endDrawingDrag();
        return;
    }
    arrasto.touchedAnyCell = true;
}

// Clique num horario fora da faixa: aviso, ou recomeca num dia livre antes do inicio.
function aoClicarForaDaFaixa(e) {
    const cell = celulaDoEvento(e, 'aviso');
    if (!cell) return;
    e.preventDefault();
    e.stopPropagation();
    if (cell.dataset.recomecar === '1') {
        lig.recomecarNoDia(cell.dataset.date, diaDa(cell), cell.dataset.horario);
        return;
    }
    const avisoPausa = cell.dataset.aviso || '';
    lig.showToastWarning(avisoPausa || 'Slot nao disponivel. Ajuste a data da faixa.', 'warning', avisoPausa ? 4200 : 2400);
}

export function ligarSelecaoDaGrade(ligacoes) {
    lig = ligacoes;
    const grade = lig.grade();
    if (!grade) return;
    grade.addEventListener('pointerdown', aoEscolherInicio);
    grade.addEventListener('mousedown', aoApertarNaCelula);
    grade.addEventListener('mouseenter', aoEntrarNaCelula, true);
    grade.addEventListener('click', aoClicarForaDaFaixa);
}
