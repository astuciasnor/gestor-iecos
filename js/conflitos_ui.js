import { store } from './store.js??v=20260625v';
import { getCalendarEvents } from './calendar.js??v=20260625v';
import { isDateOverlap } from './utils.js';
import { timeToMinutes } from './date_utils_ui.js';
import {
    isFaixaAllocation,
    isPendingAllocation,
    getAllocationTeachersForConflict
} from './allocation_helpers.js';
import { normalizeConflictSlotLabel } from './turno_helpers.js';
import { getTurmaLabel } from './curso_turma_helpers.js';
import { renderTeacherCalendar } from './calendarios_ui.js';

// Ref DOM de nivel de modulo (modulo deferred, DOM pronto).
const selViewDocente = document.getElementById('sel-view-docente');

// ==== NOVO MOTOR: AUDITORIA GLOBAL DE PROFESSORES ====
export function detectGlobalTeacherConflicts() {
    // Retorna Map<nomeDocente, [{dia, horario, dataInicio, discA, turmaA, discB, turmaB}]>
    const conflictMap = new Map();
    const allocs = store.allocations;

    function getInvolvedTeachers(alloc) {
        if (alloc.docentes && alloc.docentes.length > 0) return alloc.docentes.map(d => d.nome).filter(n => n && n.toUpperCase() !== 'A DEFINIR');
        if (alloc.docente && alloc.docente.toUpperCase() !== 'A DEFINIR') return [alloc.docente];
        return [];
    }

    const diasNomes = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

    for (let i = 0; i < allocs.length; i++) {
        for (let j = i + 1; j < allocs.length; j++) {
            const a = allocs[i];
            const b = allocs[j];

            if (String(a.turmaId) === String(b.turmaId) && a.disciplina === b.disciplina && a.modo === b.modo) continue;

            const teachersA = getInvolvedTeachers(a);
            const teachersB = getInvolvedTeachers(b);
            const sharedTeachers = teachersA.filter(t => teachersB.includes(t));

            if (sharedTeachers.length === 0) continue;

            const startA = a.dataInicio || store.settings.termStart;
            const endA = a.dataFim || store.settings.termEnd;
            const startB = b.dataInicio || store.settings.termStart;
            const endB = b.dataFim || store.settings.termEnd;

            if (!isDateOverlap(startA, endA, startB, endB)) continue;

            // Data em que o conflito começa = o maior dos dois starts
            const dataConflito = startA > startB ? startA : startB;

            let isSlotConflict = false;
            let diaConflito = '';
            let horarioConflito = '';

            if (!isFaixaAllocation(a) && !isFaixaAllocation(b)) {
                if (parseInt(a.diaSemana) === parseInt(b.diaSemana) && a.horario === b.horario) {
                    isSlotConflict = true;
                    diaConflito = diasNomes[parseInt(a.diaSemana)] || a.diaSemana;
                    horarioConflito = a.horario;
                }
            } else if (isFaixaAllocation(a) && isFaixaAllocation(b)) {
                if (a.horariosOcupados && b.horariosOcupados) {
                    const sharedSlots = a.horariosOcupados.filter(h => b.horariosOcupados.includes(h));
                    if (sharedSlots.length > 0) {
                        isSlotConflict = true;
                        diaConflito = 'Faixas';
                        horarioConflito = sharedSlots.slice(0, 2).join(', ');
                    }
                }
            } else {
                const intAlloc = isFaixaAllocation(a) ? a : b;
                const regAlloc = isFaixaAllocation(a) ? b : a;
                const regDay = parseInt(regAlloc.diaSemana);

                // Fallback de retrocompatibilidade
                const diasPermitidos = Array.isArray(intAlloc.diasMarcados) ? intAlloc.diasMarcados : (intAlloc.usaSabado ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5]);

                const isIntDayActive = diasPermitidos.includes(regDay);
                if (isIntDayActive && intAlloc.horariosOcupados && intAlloc.horariosOcupados.includes(regAlloc.horario)) {
                    isSlotConflict = true;
                    diaConflito = diasNomes[regDay] || regDay;
                    horarioConflito = regAlloc.horario;
                }
            }

            if (isSlotConflict) {
                const detail = {
                    dia: diaConflito,
                    horario: horarioConflito,
                    dataInicio: dataConflito,
                    discA: `${getTurmaLabel(a.turmaId)} – ${a.disciplina}`,
                    discB: `${getTurmaLabel(b.turmaId)} – ${b.disciplina}`,
                };
                sharedTeachers.forEach(t => {
                    if (!conflictMap.has(t)) conflictMap.set(t, []);
                    // Evitar duplicatas exatas
                    const existing = conflictMap.get(t);
                    const isDup = existing.some(e => e.dia === detail.dia && e.horario === detail.horario &&
                        ((e.discA === detail.discA && e.discB === detail.discB) ||
                            (e.discA === detail.discB && e.discB === detail.discA)));
                    if (!isDup) existing.push(detail);
                });
            }
        }
    }
    return conflictMap;
}

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
            const slotMap = new Map();

            (events || []).forEach((event) => {
                const slotKey = normalizeConflictSlotLabel(event?.horario || '');
                if (!slotKey) return;

                if (!slotMap.has(slotKey)) slotMap.set(slotKey, []);
                const items = slotMap.get(slotKey);
                const identity = getTeacherEventIdentity(event, slotKey);
                if (!items.some((item) => item.identity === identity)) {
                    items.push({ identity, event });
                }
            });

            slotMap.forEach((items, slotKey) => {
                if (items.length < 2) return;

                for (let i = 0; i < items.length; i++) {
                    for (let j = i + 1; j < items.length; j++) {
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
                        aggregate.slotSet.add(slotKey);
                    }
                }
            });
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

    if (conflictMap.size > 0) {
        const tdStyle = 'padding: 5px 10px; border: 1px solid rgba(255,255,255,0.3); font-size: 0.85em; white-space: nowrap;';
        const thStyle = 'padding: 5px 10px; border: 1px solid rgba(255,255,255,0.4); font-size: 0.8em; text-align:left; background: rgba(0,0,0,0.2); white-space: nowrap;';

        let blocksHtml = '';
        conflictMap.forEach((details, teacher) => {
            const rows = details.map(d => {
                const dataBR = d.dataInicio ? d.dataInicio.split('-').reverse().join('/') : '—';
                return `<tr>
                    <td style="${tdStyle}">${d.dia}</td>
                    <td style="${tdStyle}">${d.horario}</td>
                    <td style="${tdStyle}">${dataBR}</td>
                    <td style="${tdStyle}">${d.discA}</td>
                    <td style="${tdStyle}">${d.discB}</td>
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
