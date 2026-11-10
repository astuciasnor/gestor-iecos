import { store } from './store.js?v=202611101246';
import { getCalendarEvents } from './calendar.js?v=202611101246';
import { timeToMinutes } from './date_utils_ui.js?v=202611101246';
import {
    isPendingAllocation,
    getAllocationTeachersForConflict,
    normalizeTeacherNameForMatch
} from './allocation_helpers.js?v=202611101246';
import { normalizeConflictSlotLabel } from './turno_helpers.js?v=202611101246';
import { slotLabelsOverlap } from './academic_rules.mjs?v=202611101246';
import { getTurmaLabel } from './curso_turma_helpers.js?v=202611101246';
import { renderTeacherCalendar, withPlanContext } from './calendarios_ui.js?v=202611101246';

// Ref DOM de nivel de modulo (modulo deferred, DOM pronto).
const selViewDocente = document.getElementById('sel-view-docente');

export function detectGlobalTeacherConflictsStable() {
    const conflictMap = new Map();
    const allocs = (store.allocations || []).filter((alloc) => alloc && !isPendingAllocation(alloc));
    if (allocs.length === 0) return conflictMap;

    const diasNomes = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
    const allTeachers = [...new Set(allocs.flatMap((alloc) => getAllocationTeachersForConflict(alloc)))];
    if (allTeachers.length === 0) return conflictMap;

    const auditStart = allocs.reduce((minDate, alloc) => {
        const start = alloc.dataInicio || store.settings.termStart || '';
        if (!start) return minDate;
        return !minDate || start < minDate ? start : minDate;
    }, '');
    const auditEnd = allocs.reduce((maxDate, alloc) => {
        const end = alloc.dataFim || alloc.dataInicio || store.settings.termEnd || '';
        if (!end) return maxDate;
        return !maxDate || end > maxDate ? end : maxDate;
    }, '');

    if (!auditStart || !auditEnd) return conflictMap;

    function formatSlotSummary(slotSet) {
        const ordered = [...slotSet].sort((x, y) => timeToMinutes(x) - timeToMinutes(y));
        if (ordered.length <= 3) return ordered.join(', ');
        return `${ordered.slice(0, 3).join(', ')}...`;
    }

    function formatDaySummary(daySet) {
        const ordered = [...daySet].sort((a, b) => a - b);
        if (ordered.length === 0) return '';
        if (ordered.length <= 3) return ordered.map((d) => diasNomes[d] || String(d)).join(', ');
        return `${ordered.slice(0, 3).map((d) => diasNomes[d] || String(d)).join(', ')}...`;
    }

    function getTeacherEventIdentity(event, slotKey) {
        return [
            String(event?.id || ''),
            String(event?.turmaId || ''),
            String(event?.disciplina || ''),
            String(event?.modo || ''),
            String(event?.subGrupo || ''),
            slotKey
        ].join('|');
    }

    function getTeacherEventLabel(event) {
        return `${getTurmaLabel(event.turmaId, event.subGrupo)} - ${event.disciplina}`;
    }

    allTeachers.forEach((teacherName) => {
        const eventsByDate = getCalendarEvents(null, auditStart, auditEnd, teacherName);
        const pairAggregates = new Map();

        Object.entries(eventsByDate || {}).forEach(([dateStr, events]) => {
            const items = [];

            (events || []).forEach((event) => {
                const slotKey = normalizeConflictSlotLabel(event?.horario || '');
                if (!slotKey) return;

                const identity = getTeacherEventIdentity(event, slotKey);
                if (!items.some((item) => item.identity === identity)) {
                    items.push({ identity, event, slotKey });
                }
            });

            for (let i = 0; i < items.length; i++) {
                for (let j = i + 1; j < items.length; j++) {
                    // Compara pelo relogio: cursos com quadros diferentes tambem chocam.
                    if (!slotLabelsOverlap(items[i].slotKey, items[j].slotKey)) continue;
                    const eventA = items[i].event;
                    const eventB = items[j].event;

                    if (
                        String(eventA?.turmaId) === String(eventB?.turmaId) &&
                        String(eventA?.disciplina || '') === String(eventB?.disciplina || '') &&
                        String(eventA?.modo || '') === String(eventB?.modo || '')
                    ) {
                        continue;
                    }

                    const labelA = getTeacherEventLabel(eventA);
                    const labelB = getTeacherEventLabel(eventB);
                    const orderedLabels = [labelA, labelB].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
                    const pairKey = `${orderedLabels[0]}|||${orderedLabels[1]}`;
                    const dayOfWeek = new Date(dateStr + 'T12:00:00').getDay();

                    if (!pairAggregates.has(pairKey)) {
                        pairAggregates.set(pairKey, {
                            discA: orderedLabels[0],
                            discB: orderedLabels[1],
                            firstDate: dateStr,
                            daySet: new Set(),
                            slotSet: new Set()
                        });
                    }

                    const aggregate = pairAggregates.get(pairKey);
                    if (dateStr < aggregate.firstDate) aggregate.firstDate = dateStr;
                    if (dayOfWeek >= 1 && dayOfWeek <= 6) aggregate.daySet.add(dayOfWeek);
                    aggregate.slotSet.add(items[i].slotKey);
                    aggregate.slotSet.add(items[j].slotKey);
                }
            }
        });

        if (pairAggregates.size === 0) return;

        const details = [...pairAggregates.values()]
            .map((item) => ({
                dia: formatDaySummary(item.daySet),
                horario: formatSlotSummary(item.slotSet),
                dataInicio: item.firstDate,
                discA: item.discA,
                discB: item.discB
            }))
            .sort((a, b) => {
                if (a.dataInicio !== b.dataInicio) return a.dataInicio.localeCompare(b.dataInicio);
                if (a.discA !== b.discA) return a.discA.localeCompare(b.discA, 'pt-BR', { sensitivity: 'base' });
                return a.discB.localeCompare(b.discB, 'pt-BR', { sensitivity: 'base' });
            });

        if (details.length > 0) conflictMap.set(teacherName, details);
    });

    return conflictMap;
}

// ===== Choques com outro periodo letivo =====
// Os PLs se sobrepoem nas datas (ex.: o PL3 comeca antes do fim do PL2). O
// alerta global olha tambem as alocacoes desses PLs: so os professores que
// aparecem nos dois e so na janela de datas em comum. Os outros PLs vem do
// crossPlanLoader (ui.js: servidor ou navegador), guardados por 2 minutos.
const CROSS_PLAN_TTL_MS = 2 * 60 * 1000;
let crossPlanLoader = null;       // async (termStart, termEnd) => [{ meta, allocations }] sem o PL aberto
let crossPlan = { key: '', loadedAt: 0, plans: [] };
let crossPlanLoading = '';

export function setCrossPlanLoader(loader) {
    crossPlanLoader = typeof loader === 'function' ? loader : null;
}

// PLs que se sobrepoem ao aberto, ja carregados (ou [] enquanto chegam). Quando
// faltam ou estao velhos, pede de novo e redesenha o alerta ao chegar.
function getOverlappingPlans() {
    const meta = store.activePlanMeta;
    if (!meta?.key || !meta.termStart || !meta.termEnd || !crossPlanLoader) return [];
    const fresh = crossPlan.key === meta.key && Date.now() - crossPlan.loadedAt < CROSS_PLAN_TTL_MS;
    if (!fresh && crossPlanLoading !== meta.key) {
        const key = meta.key;
        crossPlanLoading = key;
        Promise.resolve()
            .then(() => crossPlanLoader(meta.termStart, meta.termEnd))
            .then((plans) => {
                crossPlan = {
                    key,
                    loadedAt: Date.now(),
                    plans: (Array.isArray(plans) ? plans : []).filter((p) => p?.meta?.key && p.meta.key !== key)
                };
            })
            .catch((error) => {
                // Sem servidor agora: tenta de novo depois do prazo, sem aviso na tela.
                console.warn('Alerta global: nao foi possivel ler os outros periodos letivos', error);
                crossPlan = { key, loadedAt: Date.now(), plans: crossPlan.key === key ? crossPlan.plans : [] };
            })
            .finally(() => {
                if (crossPlanLoading === key) crossPlanLoading = '';
                if (store.activePlanMeta?.key === key) updateGlobalConflictsUI();
            });
    }
    return crossPlan.key === meta.key ? crossPlan.plans : [];
}

function planLabel(meta) {
    return `${meta?.periodo || ''}/${String(meta?.termStart || '').slice(0, 4)}`;
}

// { nomeDoProfessor: [{ dia, horario, dataInicio, discA, discB, entrePLs }] }
function detectCrossPlanConflicts() {
    const result = new Map();
    const ativo = store.activePlanMeta;
    const plans = getOverlappingPlans();
    if (!ativo?.key || !plans.length) return result;

    const doAtivo = (store.allocations || []).filter((alloc) => alloc && !isPendingAllocation(alloc));
    const professoresAtivo = new Map();
    doAtivo.forEach((alloc) => getAllocationTeachersForConflict(alloc)
        .forEach((nome) => professoresAtivo.set(normalizeTeacherNameForMatch(nome), nome)));
    if (!professoresAtivo.size) return result;

    const diasNomes = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
    const rotuloAtivo = planLabel(ativo);

    plans.forEach(({ meta, allocations }) => {
        const inicio = ativo.termStart > meta.termStart ? ativo.termStart : meta.termStart;
        const fim = ativo.termEnd < meta.termEnd ? ativo.termEnd : meta.termEnd;
        if (!inicio || !fim || inicio > fim) return;

        const doOutro = (allocations || []).filter((alloc) => alloc && !isPendingAllocation(alloc));
        const comuns = new Map();
        doOutro.forEach((alloc) => getAllocationTeachersForConflict(alloc).forEach((nome) => {
            const chave = normalizeTeacherNameForMatch(nome);
            if (professoresAtivo.has(chave)) comuns.set(chave, professoresAtivo.get(chave));
        }));
        if (!comuns.size) return;
        const rotuloOutro = planLabel(meta);

        comuns.forEach((professor) => {
            const eventosAtivo = getCalendarEvents(null, inicio, fim, professor);
            // O rotulo da turma (bloco) depende do PL: calcula dentro do contexto dele.
            const eventosOutro = withPlanContext(meta, doOutro, () => {
                const eventos = getCalendarEvents(null, inicio, fim, professor);
                Object.values(eventos || {}).forEach((lista) => (lista || []).forEach((ev) => {
                    if (ev && ev.type !== 'holiday') ev.rotuloTurma = getTurmaLabel(ev.turmaId, ev.subGrupo);
                }));
                return eventos;
            });
            const pares = new Map();

            Object.entries(eventosAtivo || {}).forEach(([data, listaA]) => {
                const listaB = eventosOutro?.[data] || [];
                if (!listaB.length) return;
                (listaA || []).forEach((a) => {
                    const slotA = a && a.type !== 'holiday' ? normalizeConflictSlotLabel(a.horario || '') : '';
                    if (!slotA) return;
                    listaB.forEach((b) => {
                        const slotB = b && b.type !== 'holiday' ? normalizeConflictSlotLabel(b.horario || '') : '';
                        if (!slotB || !slotLabelsOverlap(slotA, slotB)) return;
                        const discA = `${getTurmaLabel(a.turmaId, a.subGrupo)} - ${a.disciplina} (${rotuloAtivo})`;
                        const discB = `${b.rotuloTurma || getTurmaLabel(b.turmaId, b.subGrupo)} - ${b.disciplina} (${rotuloOutro})`;
                        const chave = `${discA}|||${discB}`;
                        if (!pares.has(chave)) pares.set(chave, { discA, discB, firstDate: data, dias: new Set(), slots: new Set() });
                        const par = pares.get(chave);
                        if (data < par.firstDate) par.firstDate = data;
                        const dow = new Date(`${data}T12:00:00`).getDay();
                        if (dow >= 1 && dow <= 6) par.dias.add(dow);
                        par.slots.add(slotA);
                    });
                });
            });

            if (!pares.size) return;
            const detalhes = [...pares.values()].map((par) => {
                const slots = [...par.slots].sort((x, y) => timeToMinutes(x) - timeToMinutes(y));
                const dias = [...par.dias].sort((x, y) => x - y).map((d) => diasNomes[d]);
                return {
                    dia: dias.length <= 3 ? dias.join(', ') : `${dias.slice(0, 3).join(', ')}...`,
                    horario: slots.length <= 3 ? slots.join(', ') : `${slots.slice(0, 3).join(', ')}...`,
                    dataInicio: par.firstDate,
                    discA: par.discA,
                    discB: par.discB,
                    entrePLs: true
                };
            });
            result.set(professor, [...(result.get(professor) || []), ...detalhes]);
        });
    });
    return result;
}

export function updateGlobalConflictsUI() {
    const tabTeacher = document.getElementById('tab-teacher');
    if (!tabTeacher) return;

    let warningDiv = document.getElementById('global-conflict-warning');
    if (!warningDiv) {
        warningDiv = document.createElement('div');
        warningDiv.id = 'global-conflict-warning';
        tabTeacher.insertBefore(warningDiv, tabTeacher.firstChild);
    }

    const conflictMap = detectGlobalTeacherConflictsStable();
    // Junta os choques com outro PL (mesmo professor, mesmo bloco no alerta).
    detectCrossPlanConflicts().forEach((detalhes, professor) => {
        const chave = normalizeTeacherNameForMatch(professor);
        const nome = [...conflictMap.keys()].find((k) => normalizeTeacherNameForMatch(k) === chave) || professor;
        conflictMap.set(nome, [...(conflictMap.get(nome) || []), ...detalhes]);
    });
    let temEntrePLs = false;

    if (conflictMap.size > 0) {
        const tdStyle = 'padding: 5px 10px; border: 1px solid rgba(255,255,255,0.3); font-size: 0.85em; white-space: nowrap;';
        // Nomes de componente sao longos: quebram linha em vez de sair da caixa.
        const tdCompStyle = 'padding: 5px 10px; border: 1px solid rgba(255,255,255,0.3); font-size: 0.85em; white-space: normal; min-width: 180px;';
        const thStyle = 'padding: 5px 10px; border: 1px solid rgba(255,255,255,0.4); font-size: 0.8em; text-align:left; background: rgba(0,0,0,0.2); white-space: nowrap;';

        let blocksHtml = '';
        conflictMap.forEach((details, teacher) => {
            const rows = details.map(d => {
                const dataBR = d.dataInicio ? d.dataInicio.split('-').reverse().join('/') : '—';
                if (d.entrePLs) temEntrePLs = true;
                const selo = d.entrePLs
                    ? ' <span style="display:inline-block; margin-left:6px; padding:0 7px; border-radius:8px; background:#fff; color:#c0392b; font-size:0.78em; font-weight:800;">outro PL</span>'
                    : '';
                return `<tr>
                    <td style="${tdStyle}">${d.dia}</td>
                    <td style="${tdStyle}">${d.horario}</td>
                    <td style="${tdStyle}">${dataBR}</td>
                    <td style="${tdCompStyle}">${d.discA}</td>
                    <td style="${tdCompStyle}">${d.discB}${selo}</td>
                </tr>`;
            }).join('');

            blocksHtml += `
                <div style="margin-top: 10px;">
                    <b style="font-size:1em;">&#128274; ${teacher}</b>
                    <table style="border-collapse: collapse; margin-top: 6px; width: 100%;">
                        <thead><tr>
                            <th style="${thStyle}">Dia</th>
                            <th style="${thStyle}">Horário</th>
                            <th style="${thStyle}">A partir de</th>
                            <th style="${thStyle}">Componente A</th>
                            <th style="${thStyle}">Componente B</th>
                        </tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>`;
        });

        warningDiv.innerHTML = `
            <div style="background-color: #e74c3c; color: white; padding: 15px 18px; border-radius: 6px; margin-bottom: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.15);">
                <h4 style="margin: 0 0 6px 0; display: flex; align-items: center; gap: 8px; font-size: 1em; letter-spacing: 0.5px;">
                    ⚠️ ALERTA: CONFLITO GLOBAL NA GRADE
                </h4>
                <p style="margin: 0 0 4px 0; font-size: 0.92em;">Professor(es) alocado(s) em mais de uma disciplina no mesmo horário:</p>
                ${blocksHtml}
                <p style="margin: 12px 0 0 0; font-size: 0.8em; opacity: 0.85;"><i>Selecione o professor abaixo para visualizar a grade (o slot estará destacado em vermelho escuro).</i></p>
                ${temEntrePLs ? '<p style="margin: 4px 0 0 0; font-size: 0.8em; opacity: 0.95;"><i><b>Outro PL</b>: choque com um período letivo que se sobrepõe a este nas datas. Para ver os dois juntos, escolha o professor e clique em <b>Ano inteiro</b>.</i></p>' : ''}
            </div>
        `;
        warningDiv.style.display = 'block';
    } else {
        warningDiv.style.display = 'none';
    }
}

export function refreshTeacherConflictsUI() {
    updateGlobalConflictsUI();
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    if (activeTab === 'teacher' && selViewDocente && selViewDocente.value) {
        renderTeacherCalendar();
    }
}
