// Lista de Ofertas: a tabela da aba "Lista de Ofertas" (ofertas da turma, Copiar
// SIGAA, Editar, Substituir, Trocar e Excluir). Saiu do ui.js em 13/11/2026 sem
// mudar nada; as funcoes do editor que ela usa chegam por ligarListaOfertas (ver ui.js).
import { isPendingAllocation } from './allocation_helpers.js?v=202611141114';
import { refreshTeacherConflictsUI } from './conflitos_ui.js?v=202611141114';
import { getDisciplinaInfo, getTurmaLabel } from './curso_turma_helpers.js?v=202611141114';
import { formatDateBR } from './date_utils_ui.js?v=202611141114';
import { buildCanonicalOfferProjection } from './execution_engine.js?v=202611141114';
import { getNormalizedIntensiveFaixas } from './faixa_utils.js?v=202611141114';
import { isPendenteJaAlocada } from './pendentes.mjs?v=202611141114';
import { buildScopedSigaaAllocationFromOfferFaixa, buildSigaaHorarioResumo, getSigaaCode } from './sigaa_metadata.js?v=202611141114';
import { store } from './store.js?v=202611141114';
import { numeroDaSubturma } from './subturmas.mjs?v=202611141114';
import { copyTextToClipboard, flashButtonCopyState } from './ui_feedback.js?v=202611141114';
import { weeklyState } from './weekly_state.js?v=202611141114';

// Funcoes do ui.js (editor, grade, desfazer, troca...) que a lista chama.
let ligacoes = {};
export function ligarListaOfertas(fns) {
    ligacoes = fns;
}
export function renderOfertasList() {
    const tbody = document.querySelector('#ofertas-table tbody');
    if (!tbody) return;
    ligacoes.updateActivePlanStatus();
    ligacoes.updateListPrintHeader();
    ligacoes.updateUndoAllocationButtonUI();   // "Desfazer troca" some se houve outra alteracao

    const theadTr = document.querySelector('#ofertas-table thead tr');
    if (theadTr && !document.getElementById('th-sigaa')) {
        const thSigaa = document.createElement('th');
        thSigaa.id = 'th-sigaa';
        thSigaa.textContent = 'SIGAA';
        thSigaa.style.textAlign = 'center';
        theadTr.insertBefore(thSigaa, theadTr.lastElementChild);
    }

    const getColCount = () => document.querySelectorAll('#ofertas-table thead th').length || 7;
    const dayLabels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
    const semesterStart = document.getElementById('cal-start') ? document.getElementById('cal-start').value : '2025-01-01';
    const semesterEnd = document.getElementById('cal-end') ? document.getElementById('cal-end').value : '2025-12-31';
    const list = store.allocations.filter((a) => String(a.turmaId) === String(store.selectedTurma));
    const offerProjection = buildCanonicalOfferProjection({
        allocations: list,
        startDate: semesterStart,
        endDate: semesterEnd
    });
    // Pendente que sobrou de uma edicao antiga, com a componente ja alocada, nao aparece.
    const pendentes = list.filter((a) => isPendingAllocation(a) && !isPendenteJaAlocada(a, list));

    const appendSeparator = (label) => {
        const tr = document.createElement('tr');
        tr.className = 'list-section-sep';
        tr.innerHTML = `<td colspan="${getColCount()}">${label}</td>`;
        tbody.appendChild(tr);
    };

    const ensureWarningEndDate = (end) => {
        let endFmt = formatDateBR(end);
        if (store.settings.termEnd && end > store.settings.termEnd) {
            endFmt = `<span style="color:#c0392b; font-weight:bold; font-size:1.1em;" title="Atenção: Esta data ultrapassa o fim oficial do semestre!">${endFmt}</span>`;
        }
        return endFmt;
    };

    const buildRegularRows = () => {
        return (offerProjection.regularOfferGroups || []).map((group) => {
            const first = group.baseAlloc;
            const info = getDisciplinaInfo(first.disciplina, first.turmaId);
            const horariosResumo = (Array.isArray(group.scheduleEntries) ? group.scheduleEntries : [])
                .map((entry) => `${dayLabels[entry.diaSemana] || 'Dia'} ${entry.horario}`)
                .join(', ');

            return {
                rowType: 'regular_group',
                baseAlloc: first,
                groupIds: group.allocationIds,
                disciplina: group.disciplina,
                componentKey: group.componentKey,
                codigo: info.codigo || '-',
                docente: group.docenteLabel || first.docente,
                tipoLabel: 'componente',
                start: group.start,
                end: group.end,
                horarioTxt: `${formatDateBR(group.start)} a ${ensureWarningEndDate(group.end)}<br><small>${horariosResumo}</small>`,
                totalHoras: group.executedHours,
                chMax: first.ch || info.ch,
                details: `${group.maxExecutionDays} semanas`,
                sigaaCode: getSigaaCode(group.allocations),
                faixaIndex: 0
            };
        });
    };

    const buildIntensiveRows = () => {
        const rows = [];
        (offerProjection.faixaOfferGroups || [])
            .slice()
            .sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')))
            .forEach((group) => {
                const base = group.baseAlloc;
                const info = getDisciplinaInfo(base.disciplina, base.turmaId);
                const faixas = getNormalizedIntensiveFaixas(base);
                const fallbackDias = Array.isArray(base.diasMarcados) && base.diasMarcados.length > 0
                    ? base.diasMarcados
                    : (base.usaSabado ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5]);
                const fallbackSlots = Array.isArray(base.horariosOcupados) ? base.horariosOcupados : [];

                const resolvedFaixas = faixas.length > 0
                    ? faixas
                    : [{
                        inicio: base.dataInicio || semesterStart,
                        fim: base.dataFim || semesterEnd,
                        dias: fallbackDias,
                        slots: fallbackSlots,
                        drawnSlotsByDay: fallbackDias.reduce((acc, d) => {
                            acc[d] = [...fallbackSlots];
                            return acc;
                        }, {})
                    }];

                resolvedFaixas.forEach((faixa, idx) => {
                    const faixaStart = faixa.inicio || base.dataInicio || semesterStart;
                    const faixaEnd = faixa.fim || base.dataFim || semesterEnd;
                    const faixaDias = Array.isArray(faixa.dias) && faixa.dias.length > 0 ? faixa.dias : fallbackDias;
                    const faixaSlots = Array.isArray(faixa.slots) && faixa.slots.length > 0 ? faixa.slots : fallbackSlots;
                    const dateHours = offerProjection.dateHoursByAlloc.get(base.id) || new Map();
                    let faixaTotalHoras = 0;
                    const faixaDaysSet = new Set();
                    dateHours.forEach((hours, dStr) => {
                        if (dStr >= faixaStart && dStr <= faixaEnd) {
                            faixaTotalHoras += hours;
                            if (hours > 0) faixaDaysSet.add(dStr);
                        }
                    });

                    const scoped = {
                        ...base,
                        ch: 0,
                        dataInicio: faixaStart,
                        dataFim: faixaEnd,
                        diasMarcados: faixaDias,
                        horariosOcupados: faixaSlots,
                        usaSabado: faixaDias.includes(6),
                        faixas: [{ ...faixa, inicio: faixaStart, fim: faixaEnd, dias: faixaDias, slots: faixaSlots }]
                    };
                    const sigaaCode = getSigaaCode([scoped]);
                    const sabadoLabel = faixaDias.includes(6)
                        ? `<br><span style="color:#e67e22; font-weight:bold; font-size:0.8em;">(Inclui Sábados)</span>`
                        : '';

                    rows.push({
                        rowType: 'intensiva_faixa',
                        baseAlloc: base,
                        groupIds: group.allocationIds,
                        disciplina: base.disciplina,
                        componentKey: String(base.disciplina || '').trim().toLocaleUpperCase('pt-BR'),
                        codigo: info.codigo || '-',
                        docente: group.docenteLabel || base.docente,
                        tipoLabel: resolvedFaixas.length > 1 ? `componente <small>(Faixa ${idx + 1})</small>` : 'componente',
                        start: faixaStart,
                        end: faixaEnd,
                        horarioTxt: `${formatDateBR(faixaStart)} a ${ensureWarningEndDate(faixaEnd)}<br><small>Faixa ${idx + 1}</small>`,
                        totalHoras: faixaTotalHoras,
                        chMax: base.ch || info.ch,
                        details: `${faixaDaysSet.size} dias`,
                        sigaaCode,
                        sabadoLabel,
                        faixaIndex: idx + 1
                    });
                });
            });

        rows.sort((a, b) => {
            const comp = (a.componentKey || '').localeCompare(b.componentKey || '');
            if (comp !== 0) return comp;
            const startA = a.start || '9999-12-31';
            const startB = b.start || '9999-12-31';
            if (startA !== startB) return startA.localeCompare(startB);
            return (a.faixaIndex || 0) - (b.faixaIndex || 0);
        });
        return rows;
    };

    const buildCanonicalRows = () => {
        // Sabado com "Sabado -> manha": mostra o horario da manha, como sai no SIGAA.
        const buildFaixaHorarioResumo = (faixa, base) => {
            const drawnSlotsByDay = faixa?.drawnSlotsByDay || {};
            return Object.entries(drawnSlotsByDay)
                .sort(([left], [right]) => Number(left) - Number(right))
                .map(([day, slots]) => {
                    let safeSlots = Array.isArray(slots) ? slots.filter(Boolean) : [];
                    if (safeSlots.length === 0) return '';
                    let sufixo = '';
                    if (Number(day) === 6 && base?.sabadoManha && !safeSlots.every(ligacoes.ehAulaDaManha)) {
                        safeSlots = ligacoes.sabadoNaManha(safeSlots, base);
                        sufixo = ' (manhã)';
                    }
                    return `${dayLabels[Number(day)] || 'Dia'} ${safeSlots.join(', ')}${sufixo}`;
                })
                .filter(Boolean)
                .join(', ');
        };

        const getOfferFaixas = (group) => {
            if (Array.isArray(group?.faixas) && group.faixas.length > 0) return group.faixas;
            const drawnSlotsByDay = group?.timeRangesByDay || {};
            const dias = Object.keys(drawnSlotsByDay)
                .map((value) => Number.parseInt(value, 10))
                .filter((value) => value >= 1 && value <= 6)
                .sort((left, right) => left - right);
            const slots = [...new Set(Object.values(drawnSlotsByDay).flat().map(String).filter(Boolean))];
            return [{
                faixaId: `${group?.offerKey || 'offer'}|1`,
                index: 1,
                inicio: group?.start || group?.baseAlloc?.dataInicio || semesterStart,
                fim: group?.end || group?.baseAlloc?.dataFim || semesterEnd,
                dias,
                slots,
                drawnSlotsByDay,
                executedHours: group?.executedHours || 0,
                executionDays: group?.activeDates?.length || 0
            }];
        };

        const rows = [];
        offerProjection.offerGroups
            .slice()
            .sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')))
            .forEach((group) => {
                const base = group.baseAlloc || group.allocations?.[0];
                if (!base) return;
                const info = getDisciplinaInfo(base.disciplina, base.turmaId);
                const resolvedFaixas = getOfferFaixas(group);
                const codigosDasFaixas = resolvedFaixas.map((faixa) => getSigaaCode([
                    buildScopedSigaaAllocationFromOfferFaixa(group, faixa, {
                        termStart: semesterStart,
                        termEnd: semesterEnd
                    })
                ]));
                // O "Copiar" leva sempre o codigo com as datas, no formato do SIGAA:
                // 26M23456 (18/09/2026 - 21/09/2026). Com varias faixas, "Copiar tudo"
                // junta todas: 26M23456 (18/09/2026 - 21/09/2026), 23456M56 (22/09/2026 - 06/11/2026)
                const textosParaCopiar = resolvedFaixas.map((faixa, idx) => (
                    codigosDasFaixas[idx] && codigosDasFaixas[idx] !== '-'
                        ? buildSigaaHorarioResumo([{
                            sigaa: codigosDasFaixas[idx],
                            inicio: faixa?.inicio || base.dataInicio || semesterStart,
                            fim: faixa?.fim || base.dataFim || semesterEnd
                        }], formatDateBR)
                        : ''
                ));
                const sigaaTudo = resolvedFaixas.length > 1 && textosParaCopiar.every(Boolean)
                    ? textosParaCopiar.join(', ')
                    : '';

                resolvedFaixas.forEach((faixa, idx) => {
                    const faixaStart = faixa?.inicio || base.dataInicio || semesterStart;
                    const faixaEnd = faixa?.fim || base.dataFim || semesterEnd;
                    const sigaaCode = codigosDasFaixas[idx];
                    const sabadoLabel = Array.isArray(faixa?.dias) && faixa.dias.includes(6)
                        ? `<br><span style="color:#e67e22; font-weight:bold; font-size:0.8em;">(Inclui S\u00e1bados)</span>`
                        : '';
                    const horariosResumo = buildFaixaHorarioResumo(faixa, base);
                    const faixaLabel = resolvedFaixas.length > 1 ? `Faixa ${idx + 1}` : 'Faixa \u00fanica';
                    const detailParts = [faixaLabel];
                    if (horariosResumo) detailParts.push(horariosResumo);

                    rows.push({
                        rowType: 'offer_faixa',
                        baseAlloc: base,
                        groupIds: group.allocationIds,
                        disciplina: group.disciplina,
                        componentKey: group.componentKey,
                        codigo: info.codigo || '-',
                        docente: group.docenteLabel || base.docente,
                        tipoLabel: resolvedFaixas.length > 1 ? `componente <small>(Faixa ${idx + 1})</small>` : 'componente',
                        start: faixaStart,
                        end: faixaEnd,
                        horarioTxt: `${formatDateBR(faixaStart)} a ${ensureWarningEndDate(faixaEnd)}<br><small>${detailParts.join(' \u2022 ')}</small>`,
                        totalHoras: faixa?.executedHours || 0,
                        chMax: base.ch || info.ch,
                        details: `${faixa?.executionDays || 0} ocorr\u00eancias`,
                        sigaaCode,
                        sigaaCopia: textosParaCopiar[idx],
                        sigaaTudo: idx === 0 ? sigaaTudo : '',
                        sabadoLabel,
                        faixaIndex: idx + 1
                    });
                });
            });

        rows.sort((a, b) => {
            const comp = (a.componentKey || '').localeCompare(b.componentKey || '');
            if (comp !== 0) return comp;
            const startA = a.start || '9999-12-31';
            const startB = b.start || '9999-12-31';
            if (startA !== startB) return startA.localeCompare(startB);
            return (a.faixaIndex || 0) - (b.faixaIndex || 0);
        });
        return rows;
    };

    const buildPendenteRows = () => {
        return pendentes.map((a) => {
            const info = getDisciplinaInfo(a.disciplina, a.turmaId);
            return {
                rowType: 'pendente',
                baseAlloc: a,
                groupIds: [a.id],
                disciplina: a.disciplina,
                componentKey: String(a.disciplina || '').trim().toLocaleUpperCase('pt-BR'),
                codigo: info.codigo || '-',
                docente: a.docente,
                tipoLabel: '<span style="background:#f1c40f; color:#000; padding:2px 6px; border-radius:4px; font-size:0.85em; font-weight:bold;">Pendente</span>',
                start: a.dataInicio || semesterStart,
                end: a.dataFim || semesterEnd,
                horarioTxt: '<span style="color:#e67e22; font-style:italic; font-weight:bold;">Sem horário definido</span>',
                totalHoras: 0,
                chMax: a.ch || info.ch,
                details: 'Aguardando grade',
                sigaaCode: '-',
                faixaIndex: 0
            };
        }).sort((a, b) => (a.componentKey || '').localeCompare(b.componentKey || ''));
    };

    const handleCopySigaa = async (btn) => {
        const textToCopy = btn.dataset.code;
        try {
            await copyTextToClipboard(textToCopy);
            flashButtonCopyState(btn);
        } catch (err) {
            console.error('Falha ao copiar', err);
        }
    };

    const appendRow = (row, previousRow = null) => {
        const tr = document.createElement('tr');
        if (previousRow && previousRow.rowType !== 'pendente' && row.rowType !== 'pendente') {
            if ((previousRow.componentKey || '') === (row.componentKey || '')) {
                tr.classList.add('oferta-sep-faixa');
            } else {
                tr.classList.add('oferta-sep-component');
            }
        }
        let color = '#2c3e50';
        if (row.chMax > 0) {
            if (row.totalHoras < row.chMax) color = '#d35400';
            if (row.totalHoras === row.chMax) color = '#27ae60';
            if (row.totalHoras > row.chMax) color = '#c0392b';
        }
        const horasFaltando = row.rowType === 'pendente' ? 0 : ligacoes.getHorasFaltando(row.baseAlloc);
        const chInfo = row.rowType === 'pendente'
            ? `<span style="color:#7f8c8d;">--- / ${row.chMax}h</span>`
            : `<b style="color:${color}">${row.totalHoras}</b> / ${row.chMax}h <small>(${row.details})</small>${row.sabadoLabel || ''}`
                + (horasFaltando ? `<br><span class="falta-badge" title="A oferta tem menos aulas que a carga horaria. Use Editar para ajustar datas ou horarios.">faltam ${horasFaltando}h</span>` : '');

        const btnCopySigaa = row.sigaaCode && row.sigaaCode !== '-'
            ? `<div style="display:flex; align-items:center; justify-content:center; gap:6px;">
                    <span style="font-family:monospace; font-weight:bold; background:#ecf0f1; padding:2px 6px; border-radius:4px; font-size:0.9em; letter-spacing:1px;">${row.sigaaCode}</span>
                    <button class="btn-sigaa-copy" data-code="${row.sigaaCopia || row.sigaaCode}" title="Copia: ${row.sigaaCopia || row.sigaaCode}" style="background:transparent; color:var(--primary); border:1px solid #ccc; border-radius:4px; cursor:pointer; padding:2px 6px; font-size:0.9em; transition: all 0.2s;">Copiar</button>
               </div>`
                + (row.sigaaTudo
                    ? `<button class="btn-sigaa-copy" data-code="${row.sigaaTudo}" title="Copia todas as faixas com as datas: ${row.sigaaTudo}" style="margin-top:6px; background:transparent; color:var(--primary); border:1px solid var(--primary); border-radius:4px; cursor:pointer; padding:2px 6px; font-size:0.85em; transition: all 0.2s;">Copiar tudo</button>`
                    : '')
            : `<span style="color:#999;">-</span>`;

        const btnHtml = `
            <button class="btn-primary btn-edit-row" style="padding:4px 8px; margin:0; font-size:0.85em; background-color:#2980b9; border:none; color:white; border-radius:3px; cursor:pointer;" title="Editar">Editar</button>
            ${row.rowType === 'pendente' ? '' : '<button class="btn-secondary btn-replace-row" style="padding:4px 8px; margin:0; font-size:0.85em; background-color:#8e44ad; border:none; color:white; border-radius:3px; cursor:pointer;" title="Substituir por outra componente (mantem faixas e horarios)">Substituir</button>'}
            ${row.rowType === 'pendente' ? '' : '<button class="btn-secondary btn-swap-row" style="padding:4px 8px; margin:0; font-size:0.85em; background-color:#16a085; border:none; color:white; border-radius:3px; cursor:pointer;" title="Trocar a ordem com outra componente da turma">Trocar</button>'}
            <button class="btn-danger btn-delete-row" style="padding:4px 8px; margin:0; font-size:0.85em; border-radius:3px; cursor:pointer;" title="Excluir">Excluir</button>
        `;

        // Selo da subturma (turma extra): T01, T02... ao lado do nome
        const numSub = row.rowType === 'pendente' ? null : numeroDaSubturma(row.baseAlloc?.subGrupo);
        const seloSub = numSub
            ? ` <span class="subturma-selo" title="Subturma ${ligacoes.escapeTrocaHtml(getTurmaLabel(row.baseAlloc.turmaId, row.baseAlloc.subGrupo))}">T${String(numSub).padStart(2, '0')}</span>`
            : '';
        tr.innerHTML = `
            <td>${ligacoes.escapeTrocaHtml(row.disciplina)}${seloSub}</td>
            <td style="text-align:center; font-family:monospace; font-weight:bold;">${ligacoes.escapeTrocaHtml(row.codigo || '-')}</td>
            <td>${ligacoes.escapeTrocaHtml(row.docente || '-')}</td>
            <td>${row.horarioTxt}</td>
            <td style="text-align:center;">${chInfo}</td>
            <td style="text-align:center;">${btnCopySigaa}</td>
            <td style="white-space:nowrap;"><div style="display:grid; grid-template-columns:repeat(2, auto); gap:5px; justify-content:center;">${btnHtml}</div></td>
        `;

        const idsToRemove = Array.isArray(row.groupIds) && row.groupIds.length > 0 ? row.groupIds : [row.baseAlloc.id];

        tr.querySelectorAll('.btn-sigaa-copy').forEach((copyBtn) => {
            copyBtn.onclick = (e) => handleCopySigaa(e.currentTarget);
        });

        const btnDelete = tr.querySelector('.btn-delete-row');
        if (btnDelete) {
            btnDelete.onclick = () => {
                if (ligacoes.bloquearSeSomenteLeitura(row.baseAlloc?.turmaId)) return;
                const msg = idsToRemove.length > 1
                    ? 'Remover este bloco (todas as linhas associadas)?'
                    : 'Remover esta oferta?';
                if (!confirm(msg)) return;
                // A oferta excluida estava aberta no editor: limpa o editor (senao
                // um "Salvar" depois a recriaria).
                const abertaNoEditor = (weeklyState.editingOriginalAllocationIds || [])
                    .some((id) => idsToRemove.some((rid) => String(rid) === String(id)));
                const removidas = store.allocations.filter((a) => idsToRemove.some((rid) => String(rid) === String(a.id)));
                idsToRemove.forEach((id) => store.removeAllocation(id));
                ligacoes.syncAllRegularDates();
                ligacoes.syncAllIntensiveDates();
                if (abertaNoEditor) {
                    ligacoes.finalizeWeeklyEditorAfterSave();
                    ligacoes.limparDatasDasFaixas();
                }
                ligacoes.limparFaixasSeExcluiuAUltimaSalva(removidas);
                ligacoes.renderWeeklyGrid();
                renderOfertasList();
            };
        }

        const btnEdit = tr.querySelector('.btn-edit-row');
        if (btnEdit) {
            btnEdit.onclick = () => {
                ligacoes.loadAllocationIntoEditor(row.baseAlloc, idsToRemove);
            };
        }

        const btnReplace = tr.querySelector('.btn-replace-row');
        if (btnReplace) {
            btnReplace.onclick = () => {
                if (ligacoes.bloquearSeSomenteLeitura(row.baseAlloc?.turmaId)) return;
                ligacoes.loadAllocationIntoEditor(row.baseAlloc, idsToRemove, { replace: true });
            };
        }

        const btnSwap = tr.querySelector('.btn-swap-row');
        if (btnSwap) btnSwap.onclick = () => ligacoes.abrirTrocaDeOrdem(row.baseAlloc);


        tbody.appendChild(tr);
    };

    const canonicalRows = buildCanonicalRows();
    const pendenteRows = buildPendenteRows();
    // Ordena os COMPONENTES pela data de inicio alocada (cronologica), mantendo
    // as linhas (faixas/docentes) de um mesmo componente agrupadas. Espelha a
    // ordem da tabela resumo do calendario.
    const componentEarliestStart = new Map();
    canonicalRows.forEach((row) => {
        const key = row.componentKey || '';
        const start = row.start || '9999-12-31';
        const prev = componentEarliestStart.get(key);
        if (prev === undefined || start.localeCompare(prev) < 0) {
            componentEarliestStart.set(key, start);
        }
    });
    canonicalRows.sort((a, b) => {
        const aCompStart = componentEarliestStart.get(a.componentKey || '') || '9999-12-31';
        const bCompStart = componentEarliestStart.get(b.componentKey || '') || '9999-12-31';
        if (aCompStart !== bCompStart) return aCompStart.localeCompare(bCompStart);
        const comp = (a.componentKey || '').localeCompare(b.componentKey || '');
        if (comp !== 0) return comp;
        const startA = a.start || '9999-12-31';
        const startB = b.start || '9999-12-31';
        if (startA !== startB) return startA.localeCompare(startB);
        const endA = a.end || '9999-12-31';
        const endB = b.end || '9999-12-31';
        if (endA !== endB) return endA.localeCompare(endB);
        const faixaA = a.faixaIndex || 0;
        const faixaB = b.faixaIndex || 0;
        if (faixaA !== faixaB) return faixaA - faixaB;
        return String(a.docente || '').localeCompare(String(b.docente || ''));
    });

    tbody.innerHTML = '';
    let previousCanonicalRow = null;
    canonicalRows.forEach((row) => {
        appendRow(row, previousCanonicalRow);
        previousCanonicalRow = row;
    });

    if (pendenteRows.length > 0) {
        appendSeparator('AGUARDANDO ALOCA\u00c7\u00c3O NA GRADE (PENDENTES)');
        let previousPendingRow = null;
        pendenteRows.forEach((row) => {
            appendRow(row, previousPendingRow);
            previousPendingRow = row;
        });
    }

    if (canonicalRows.length === 0 && pendenteRows.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="${getColCount()}" style="text-align:center; color:#666;">Nenhuma oferta cadastrada.</td>`;
        tbody.appendChild(tr);
    }

    refreshTeacherConflictsUI();
}
