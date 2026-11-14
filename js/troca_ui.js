// Botao "Trocar" da Lista de Ofertas (janela, calculo das novas posicoes e
// gravacao) e o "Como resolver?" do Calendario Docente. Saiu do ui.js em
// 14/11/2026 sem mudar nada; as funcoes do editor que ele usa chegam por
// ligarTroca (ver ui.js). Quem pode trocar com quem: troca_ordem.mjs.
import { slotLabelsOverlap } from './academic_rules.mjs?v=202611141134';
import { getAllocationTeachersForConflict, isFaixaAllocation } from './allocation_helpers.js?v=202611141134';
import { getCalendarEvents } from './calendar.js?v=202611141134';
import { getCursoSiglaDaTurma, getDisciplinaInfo, getTurmaLabel } from './curso_turma_helpers.js?v=202611141134';
import { addDaysISO, formatDateBR } from './date_utils_ui.js?v=202611141134';
import { alignFaixasToExecutionEnd, buildFinalAdjustmentFaixaSuggestion, computeIntensiveExecution, getNormalizedIntensiveFaixas, normalizeFaixaEntry, shouldIgnoreTurmaEventForCandidate } from './faixa_utils.js?v=202611141134';
import { datasFeriadoDaTurma } from './feriados.mjs?v=202611141134';
import { store } from './store.js?v=202611141134';
import { saoSubturmasDiferentes } from './subturmas.mjs?v=202611141134';
import { classifySwap } from './troca_ordem.mjs?v=202611141134';
import { normalizeConflictSlotLabel } from './turno_helpers.js?v=202611141134';
import { showToastWarning } from './ui_feedback.js?v=202611141134';

// Do ui.js: editor, conflitos de professor, desfazer e recalculo das datas.
let ligacoes = {};
export function ligarTroca(fns) {
    ligacoes = fns;
}
// --- Botao "Trocar" (trocar a ordem) -------------------------------------------------
// Quem pode trocar com quem esta em troca_ordem.mjs. Aqui: as componentes da
// turma, as novas posicoes calculadas com o mesmo motor do salvar e as checagens
// de turma e de professor antes de gravar.

const CAMPOS_DE_POSICAO = ['dataInicio', 'dataFim', 'faixas', 'executionByDate', 'horariosOcupados', 'horariosUltimoDia', 'diasMarcados', 'usaSabado', 'sabadoManha'];

export function escapeTrocaHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function contarHorasExecutadas(byDate) {
    return Object.values(byDate || {}).reduce((n, slots) => n + (Array.isArray(slots) ? slots.length : 0), 0);
}

function buildComponentesParaTroca(turmaId) {
    const grupos = new Map();
    store.allocations.forEach((a) => {
        if (String(a.turmaId) !== String(turmaId) || !isFaixaAllocation(a)) return;
        const key = `${ligacoes.normalizeDisciplinaInputValue(a.disciplina || '')}|${a.subGrupo || ''}`;
        if (!grupos.has(key)) grupos.set(key, []);
        grupos.get(key).push(a);
    });
    return [...grupos.values()]
        .map((registros) => {
            const alloc = registros[0];
            return {
                alloc,
                ids: registros.map((r) => r.id),
                disciplina: alloc.disciplina,
                subGrupo: alloc.subGrupo || '',
                ch: parseInt(alloc.ch, 10) || parseInt(getDisciplinaInfo(alloc.disciplina, alloc.turmaId).ch, 10) || 0,
                dataInicio: alloc.dataInicio || '',
                dataFim: alloc.dataFim || alloc.dataInicio || '',
                registros: registros.length,
                faixas: getNormalizedIntensiveFaixas(alloc)
            };
        })
        .sort((x, y) => String(x.dataInicio).localeCompare(String(y.dataInicio)));
}

// Posicao de uma componente comecando em "inicio", com o padrao de horarios da
// sua 1a faixa e a faixa de ajuste do ultimo dia, como o salvar faz.
function calcularPosicaoAPartirDe(alloc, inicio) {
    const padrao = getNormalizedIntensiveFaixas(alloc)[0];
    if (!padrao || !inicio) return null;
    const opcoes = { respectPriority: true, respectTurmaOccupancy: false };
    let faixas = [normalizeFaixaEntry({ inicio, fim: null, drawnSlotsByDay: padrao.drawnSlotsByDay })].filter(Boolean);
    let execution = computeIntensiveExecution(ligacoes.buildCandidateIntensiveFromFaixas(alloc, faixas), opcoes);
    const ajuste = buildFinalAdjustmentFaixaSuggestion(faixas, execution);
    if (ajuste?.faixas?.length) {
        faixas = ajuste.faixas.map(normalizeFaixaEntry).filter(Boolean);
        execution = computeIntensiveExecution(ligacoes.buildCandidateIntensiveFromFaixas(alloc, faixas), opcoes);
    }
    if (!execution?.dataFim || execution.totalHours <= 0) return null;
    return {
        horas: execution.totalHours,
        posicao: {
            dataInicio: execution.dataInicio,
            dataFim: execution.dataFim,
            faixas: alignFaixasToExecutionEnd(faixas, execution.dataFim),
            executionByDate: execution.byDate || {},
            horariosOcupados: execution.unionSlots || [],
            horariosUltimoDia: execution.horariosUltimoDia || [],
            diasMarcados: execution.unionDias || [],
            usaSabado: (execution.unionDias || []).includes(6)
        }
    };
}

// Sugestao para o choque de professor no salvar: o primeiro inicio, depois do
// escolhido, em que a componente cabe inteira no periodo (com os horarios da
// Faixa 1, como o "Trocar") sem choque de turma nem de professor. As aulas ja
// alocadas sao lidas uma vez so; cada dia testado recalcula so a propria
// componente. So olha o PL aberto. Devolve a nova posicao ou null.
export function sugerirInicioSemChoque(candidato, professores = []) {
    const fimPL = store.settings.termEnd;
    if (!candidato?.dataInicio || !candidato.turmaId || !fimPL) return null;
    const horasPrecisas = contarHorasExecutadas(candidato.executionByDate) || parseInt(candidato.ch, 10) || 0;
    if (!horasPrecisas) return null;
    const inicioBusca = addDaysISO(candidato.dataInicio, 1);
    if (!inicioBusca || inicioBusca > fimPL) return null;

    // Mesmas regras do salvar: a turma ignora so a propria componente; o
    // professor ignora as aulas desta turma (essas a turma ja confere).
    const turmaOcupada = new Set();
    Object.entries(getCalendarEvents(String(candidato.turmaId), inicioBusca, fimPL) || {}).forEach(([data, lista]) => {
        (lista || []).forEach((ev) => {
            if (shouldIgnoreTurmaEventForCandidate(ev, candidato)) return;
            const slot = normalizeConflictSlotLabel(ev?.horario || '');
            if (slot) turmaOcupada.add(`${data}|${slot}`);
        });
    });
    const agendas = professores.map((nome) => {
        const porData = new Map();
        Object.entries(getCalendarEvents(null, inicioBusca, fimPL, nome) || {}).forEach(([data, lista]) => {
            (lista || []).forEach((ev) => {
                if (!ev || String(ev.turmaId) === String(candidato.turmaId)) return;
                const slot = normalizeConflictSlotLabel(ev.horario || '');
                if (!slot) return;
                if (!porData.has(data)) porData.set(data, []);
                porData.get(data).push(slot);
            });
        });
        return { nome, porData };
    });

    let dia = inicioBusca;
    for (let n = 0; dia && dia <= fimPL && n < 160; n++, dia = addDaysISO(dia, 1)) {
        const calc = calcularPosicaoAPartirDe(candidato, dia);
        // Se nao cabe comecando hoje, comecando mais tarde tambem nao cabe.
        if (!calc || calc.horas < horasPrecisas) return null;
        // Dia sem aula (domingo, feriado, dia fora do padrao): o dia da 1a aula
        // ainda sera testado na sua vez.
        if (calc.posicao.dataInicio !== dia) continue;
        const nova = { ...candidato, ...calc.posicao };
        const chocaNaTurma = Object.entries(nova.executionByDate || {}).some(([data, slots]) =>
            (slots || []).some((s) => turmaOcupada.has(`${data}|${normalizeConflictSlotLabel(s)}`)));
        if (chocaNaTurma) continue;
        const chocaProfessor = agendas.some(({ nome, porData }) =>
            ligacoes.buildIntensiveTeacherConflictEntries(nova, nome).some((aula) =>
                (porData.get(aula.date) || []).some((slot) => slotLabelsOverlap(slot, aula.horario))));
        if (chocaProfessor) continue;
        return calc.posicao;
    }
    return null;
}

// Choque com outra componente da mesma turma. Sub-turmas diferentes podem
// ter aula em paralelo; as posicoes antigas das duas que trocam sao ignoradas.
function acharChoqueNaTurma(candidato) {
    const eventos = getCalendarEvents(String(candidato.turmaId), candidato.dataInicio, candidato.dataFim);
    const ocupados = new Map();
    Object.entries(eventos || {}).forEach(([data, lista]) => (lista || []).forEach((ev) => {
        if (shouldIgnoreTurmaEventForCandidate(ev, candidato)) return;
        if (saoSubturmasDiferentes(candidato.subGrupo, ev?.subGrupo)) return;
        const slot = normalizeConflictSlotLabel(ev?.horario || '');
        if (slot && !ocupados.has(`${data}|${slot}`)) ocupados.set(`${data}|${slot}`, ev);
    }));
    for (const [data, slots] of Object.entries(candidato.executionByDate || {})) {
        for (const slot of (slots || [])) {
            const ev = ocupados.get(`${data}|${normalizeConflictSlotLabel(slot)}`);
            if (ev) return { date: data, horario: slot, disciplina: ev.disciplina || '' };
        }
    }
    return null;
}

// Resultado: { novas: Map(alloc -> posicao), avisos } ou { erro }.
function planejarTrocaDeOrdem(compA, compB, modo) {
    const a = compA.alloc;
    const b = compB.alloc;
    const novas = new Map();

    if (modo === 'mesma-ch') {
        const posicaoDe = (x) => JSON.parse(JSON.stringify(Object.fromEntries(CAMPOS_DE_POSICAO.map((c) => [c, x[c] ?? null]))));
        // Uma oferta cortada no fim do periodo tem menos aulas que a carga: a
        // outra perderia aulas ao ocupar o lugar dela.
        for (const [alloc, outra] of [[a, b], [b, a]]) {
            const horas = contarHorasExecutadas(alloc.executionByDate);
            const cabem = contarHorasExecutadas(outra.executionByDate);
            if (cabem < horas) {
                return { erro: `"${alloc.disciplina}" não caberia no lugar de "${outra.disciplina}" (${cabem}h de ${horas}h).` };
            }
        }
        novas.set(a, posicaoDe(b));
        novas.set(b, posicaoDe(a));
    } else {
        const [first, second] = String(a.dataInicio) <= String(b.dataInicio) ? [a, b] : [b, a];
        const novaSegunda = calcularPosicaoAPartirDe(second, first.dataInicio);
        const novaPrimeira = novaSegunda && calcularPosicaoAPartirDe(first, addDaysISO(novaSegunda.posicao.dataFim, 1));
        if (!novaSegunda || !novaPrimeira) return { erro: 'Não foi possível calcular as novas posições.' };
        for (const [alloc, nova] of [[second, novaSegunda], [first, novaPrimeira]]) {
            const horasAntes = contarHorasExecutadas(alloc.executionByDate) || parseInt(alloc.ch, 10) || 0;
            if (nova.horas < horasAntes) {
                return { erro: `"${alloc.disciplina}" não caberia até o fim do período letivo (${nova.horas}h de ${horasAntes}h).` };
            }
            novas.set(alloc, nova.posicao);
        }
    }

    const avisos = [];
    for (const [alloc, posicao] of novas) {
        const candidato = { ...alloc, ...posicao, ignoreAllocationIds: [a.id, b.id] };
        const choque = acharChoqueNaTurma(candidato);
        if (choque) {
            return { erro: `"${alloc.disciplina}" ficaria em choque com "${choque.disciplina}" em ${formatDateBR(choque.date)} (${choque.horario}).` };
        }
        const prof = ligacoes.findConfirmedTeacherConflictForCandidate(candidato, getAllocationTeachersForConflict(candidato));
        if (prof) {
            const onde = `${prof.teacherName} já tem ${prof.event.disciplina} na turma ${getTurmaLabel(prof.event.turmaId, prof.event.subGrupo)} em ${formatDateBR(prof.date)} (${prof.horario}).`;
            return { erro: `Choque de professor: ${onde}` };
        }
    }
    return { novas, avisos };
}

// ===== "Como resolver?" (alerta de choque do Calendario Docente) =====
// So calcula e descreve: nada e alterado aqui. Para cada oferta do choque:
// - do curso do usuario: ate duas saidas que so dependem dele (adiar o inicio;
//   trocar a ordem com outra componente da turma), conferidas com as mesmas
//   regras do salvar e do Trocar;
// - de outro curso: com quem conversar (e a data que resolveria).
// Componente com mais de um registro na turma fica de fora do calculo
// (o coordenador ajusta pelo Editar).

function ofertaUnicaNaTurma(alloc) {
    if (!alloc || !isFaixaAllocation(alloc)) return false;
    const disc = ligacoes.normalizeDisciplinaInputValue(alloc.disciplina || '');
    return store.allocations.filter((a) => String(a.turmaId) === String(alloc.turmaId)
        && isFaixaAllocation(a)
        && ligacoes.normalizeDisciplinaInputValue(a.disciplina || '') === disc
        && String(a.subGrupo || '') === String(alloc.subGrupo || '')).length === 1;
}

function inicioQueResolve(alloc) {
    if (!ofertaUnicaNaTurma(alloc)) return null;
    return sugerirInicioSemChoque(alloc, getAllocationTeachersForConflict(alloc));
}

// A troca mais proxima no tempo que o Trocar aceitaria (sem choque de turma
// nem de professor nas novas posicoes). Testa no maximo 8 componentes.
function trocaQueResolve(alloc) {
    if (!ofertaUnicaNaTurma(alloc)) return null;
    const componentes = buildComponentesParaTroca(alloc.turmaId);
    const atual = componentes.find((c) => c.ids.includes(alloc.id));
    if (!atual) return null;
    const feriados = [...datasFeriadoDaTurma(store.rawData?.feriados, alloc.turmaId)];
    const distancia = (c) => Math.abs(new Date(`${c.dataInicio}T12:00:00`) - new Date(`${atual.dataInicio}T12:00:00`));
    const outras = componentes.filter((c) => c !== atual && c.registros === 1).sort((x, y) => distancia(x) - distancia(y)).slice(0, 8);
    for (const outra of outras) {
        const regra = classifySwap(atual, outra, { feriados });
        if (!regra.ok) continue;
        const plano = planejarTrocaDeOrdem(atual, outra, regra.modo);
        if (!plano.erro) return outra;
    }
    return null;
}

// Frases comuns ao bloqueio do salvar e ao "Como resolver?".
export function fraseComeceEm(nome, posicao) {
    return `comece ${nome} em ${formatDateBR(posicao.dataInicio)}, com os horários da Faixa 1: termina em ${formatDateBR(posicao.dataFim)} sem choque.`;
}

export function cursoDaTurma(turmaId) {
    return getCursoSiglaDaTurma(turmaId) || 'outro curso';
}

// Devolve [{ quem: 'voce' | 'outro', texto }]; nunca vazio.
export function sugerirComoResolverChoque({ ids = [] } = {}) {
    const ofertas = [...new Set(ids.map(String))]
        .map((id) => store.allocations.find((a) => String(a?.id) === id))
        .filter(Boolean)
        // A que comeca depois primeiro: em geral foi a ultima a entrar na grade.
        .sort((a, b) => String(b.dataInicio || '').localeCompare(String(a.dataInicio || '')));
    if (!ofertas.length) {
        return [{ quem: 'voce', texto: 'Estas aulas mudaram desde o último cálculo. Recarregue a página e abra de novo.' }];
    }
    const nome = (a) => `"${a.disciplina}" (${getTurmaLabel(a.turmaId, a.subGrupo)})`;
    const linhas = [];
    let algumaMinha = false;

    ofertas.forEach((alloc) => {
        const inicio = inicioQueResolve(alloc);
        if (store.podeEditarTurma(alloc.turmaId)) {
            algumaMinha = true;
            if (inicio) {
                linhas.push({ quem: 'voce', texto: `${capitalizar(fraseComeceEm(nome(alloc), inicio))} Faça pelo Editar, na Lista de Ofertas.` });
            }
            const troca = trocaQueResolve(alloc);
            if (troca) {
                linhas.push({ quem: 'voce', texto: `Troque a ordem de ${nome(alloc)} com "${troca.disciplina}": as duas ficam sem choque. Use o botão Trocar, na Lista de Ofertas.` });
            }
        } else {
            linhas.push({ quem: 'outro', texto: `${nome(alloc)} é de ${cursoDaTurma(alloc.turmaId)}: converse com essa coordenação${inicio ? `. Se ela começar em ${formatDateBR(inicio.dataInicio)}, o choque some` : ''}.` });
        }
    });

    if (algumaMinha && !linhas.some((l) => l.quem === 'voce')) {
        linhas.unshift({ quem: 'voce', texto: 'Não achei nova data nem troca que resolva sem criar outro choque: mude os dias ou os horários da semana pelo Editar.' });
    }
    return linhas;
}

function capitalizar(texto) {
    return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : texto;
}

function formatPeriodoTroca(inicio, fim) {
    return `${formatDateBR(inicio)} a ${formatDateBR(fim)}`;
}

function fecharTrocaDeOrdem() {
    document.getElementById('troca-ordem-modal')?.remove();
    document.removeEventListener('keydown', onTrocaKeydown);
}

function onTrocaKeydown(e) {
    if (e.key === 'Escape') fecharTrocaDeOrdem();
}

export function abrirTrocaDeOrdem(baseAlloc) {
    if (!baseAlloc || ligacoes.bloquearSeSomenteLeitura(baseAlloc.turmaId)) return;
    const componentes = buildComponentesParaTroca(baseAlloc.turmaId);
    const atual = componentes.find((c) => c.ids.includes(baseAlloc.id));
    if (!atual) return;
    const outras = componentes.filter((c) => c !== atual);
    const feriados = [...datasFeriadoDaTurma(store.rawData?.feriados, baseAlloc.turmaId)];
    const opcoes = outras.map((outra) => ({ outra, regra: classifySwap(atual, outra, { feriados }) }));

    const itens = opcoes.map(({ outra, regra }, idx) => {
        const selo = regra.ok
            ? `<span class="troca-selo">${regra.modo === 'mesma-ch' ? 'mesma carga' : 'em sequência'}</span>`
            : `<span class="troca-motivo">${escapeTrocaHtml(regra.motivo)}</span>`;
        return `
            <li>
                <button type="button" class="troca-opcao" data-idx="${idx}" ${regra.ok ? '' : 'disabled'}>
                    <strong>${escapeTrocaHtml(outra.disciplina)}${outra.subGrupo ? ` (${escapeTrocaHtml(outra.subGrupo)})` : ''}</strong>
                    <span class="troca-info">${formatPeriodoTroca(outra.dataInicio, outra.dataFim)} · ${outra.ch}h</span>
                    ${selo}
                </button>
            </li>`;
    }).join('');

    fecharTrocaDeOrdem();
    const overlay = document.createElement('div');
    overlay.id = 'troca-ordem-modal';
    overlay.className = 'troca-modal no-print';
    overlay.innerHTML = `
        <div class="troca-caixa" role="dialog" aria-modal="true" aria-labelledby="troca-titulo">
            <h3 id="troca-titulo">Trocar a ordem de ${escapeTrocaHtml(atual.disciplina)}</h3>
            <p class="troca-sub">${formatPeriodoTroca(atual.dataInicio, atual.dataFim)} · ${atual.ch}h. Escolha com qual componente ela troca de lugar:</p>
            ${itens ? `<ul class="troca-lista">${itens}</ul>` : '<p class="troca-sub">Não há outra componente alocada nesta turma.</p>'}
            <p class="troca-nota">Mesma carga: troca em qualquer posição. Carga diferente: só se estiverem em sequência.</p>
            <div class="troca-acoes"><button type="button" class="btn-secondary troca-cancelar">Cancelar</button></div>
        </div>`;
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onTrocaKeydown);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay || e.target.closest('.troca-cancelar')) {
            fecharTrocaDeOrdem();
            return;
        }
        const botao = e.target.closest('.troca-opcao');
        if (!botao || botao.disabled) return;
        const { outra, regra } = opcoes[Number(botao.dataset.idx)];
        const plano = planejarTrocaDeOrdem(atual, outra, regra.modo);
        if (plano.erro) {
            botao.disabled = true;
            botao.querySelector('.troca-selo')?.remove();
            botao.insertAdjacentHTML('beforeend', `<span class="troca-motivo">${escapeTrocaHtml(plano.erro)}</span>`);
            return;
        }
        const linhas = [...plano.novas].map(([alloc, posicao]) =>
            `${alloc.disciplina}\n   antes: ${formatPeriodoTroca(alloc.dataInicio, alloc.dataFim)}\n   depois: ${formatPeriodoTroca(posicao.dataInicio, posicao.dataFim)}`);
        if (!confirm(`Trocar a ordem das componentes?\n\n${linhas.join('\n\n')}\n\nSe precisar, use o botão "Desfazer troca", ao lado do título da lista.`)) return;
        aplicarTrocaDeOrdem(plano);
    });
}

function aplicarTrocaDeOrdem(plano) {
    const undoSnapshot = ligacoes.snapshotAllocationsForUndo();
    const esperado = [...plano.novas].map(([alloc, posicao]) => [alloc, contarHorasExecutadas(posicao.executionByDate)]);
    plano.novas.forEach((posicao, alloc) => Object.assign(alloc, posicao));
    ligacoes.syncAllIntensiveDates();

    // O recalculo geral nao pode ter cortado aulas de nenhuma das duas.
    const cortada = esperado.find(([alloc, horas]) => contarHorasExecutadas(alloc.executionByDate) < horas);
    if (cortada && undoSnapshot) {
        store.replaceAllocations(undoSnapshot);
        ligacoes.rerenderPlanBoundViews();
        fecharTrocaDeOrdem();
        showToastWarning(`Troca cancelada: "${cortada[0].disciplina}" perderia aulas na nova posição.`, 'error', 6000);
        return;
    }

    ligacoes.commitAllocationUndoSnapshot(undoSnapshot, { troca: true });
    fecharTrocaDeOrdem();
    ligacoes.rerenderPlanBoundViews();
    plano.avisos.forEach((aviso) => showToastWarning(aviso, 'warning', 6000));
    if (!plano.avisos.length) showToastWarning('Ordem trocada. Se precisar, clique em "Desfazer troca", ao lado do título da lista (antes de atualizar a página).', 'success', 4500);
}
