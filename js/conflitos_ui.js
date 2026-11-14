import { store } from './store.js?v=202611132116';
import { getCalendarEvents } from './calendar.js?v=202611132116';
import { timeToMinutes } from './date_utils_ui.js?v=202611132116';
import {
    isPendingAllocation,
    getAllocationTeachersForConflict,
    normalizeTeacherNameForMatch
} from './allocation_helpers.js?v=202611132116';
import { normalizeConflictSlotLabel } from './turno_helpers.js?v=202611132116';
import { slotLabelsOverlap } from './academic_rules.mjs?v=202611132116';
import { getTurmaLabel } from './curso_turma_helpers.js?v=202611132116';
import { renderTeacherCalendar, withPlanContext } from './calendarios_ui.js?v=202611132116';
import { showToastWarning } from './ui_feedback.js?v=202611132116';
import { saoSubturmasDiferentes } from './subturmas.mjs?v=202611132116';
import { umNomePorPessoa } from './docente_nomes.mjs?v=202611132116';

// Ref DOM de nivel de modulo (modulo deferred, DOM pronto).
const selViewDocente = document.getElementById('sel-view-docente');

export function detectGlobalTeacherConflictsStable() {
    const conflictMap = new Map();
    const allocs = (store.allocations || []).filter((alloc) => alloc && !isPendingAllocation(alloc));
    if (allocs.length === 0) return conflictMap;

    const diasNomes = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
    // Um nome por professor: "Zelia" e "Zélia" sao a mesma pessoa (o calendario
    // ja junta as duas grafias; sem isto o choque sairia duas vezes no alerta).
    const allTeachers = umNomePorPessoa(allocs.flatMap((alloc) => getAllocationTeachersForConflict(alloc)));
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

                    // A mesma oferta (mesma turma, componente e subturma) nao choca
                    // consigo. Subturmas diferentes (T01 x T02) com o mesmo professor
                    // no mesmo horario SAO choque: a CH dele ficaria distorcida.
                    if (
                        String(eventA?.turmaId) === String(eventB?.turmaId) &&
                        String(eventA?.disciplina || '') === String(eventB?.disciplina || '') &&
                        !saoSubturmasDiferentes(eventA?.subGrupo, eventB?.subGrupo) &&
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
                            slotSet: new Set(),
                            turmaIds: new Set(),
                            allocIds: new Set()
                        });
                    }

                    const aggregate = pairAggregates.get(pairKey);
                    aggregate.turmaIds.add(String(eventA?.turmaId || ''));
                    aggregate.turmaIds.add(String(eventB?.turmaId || ''));
                    // Os eventos trazem o id da oferta: usado pelo "Como resolver?".
                    if (eventA?.id) aggregate.allocIds.add(String(eventA.id));
                    if (eventB?.id) aggregate.allocIds.add(String(eventB.id));
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
                discB: item.discB,
                turmaIds: [...item.turmaIds].filter(Boolean),
                allocIds: [...item.allocIds]
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

// Choque da componente recem-salva com um PL que se sobrepoe ao aberto nas
// datas. O salvar so confere o PL aberto; aqui so AVISA (os outros PLs vem do
// cache de ate 2 minutos e podem estar desatualizados). Devolve o primeiro
// choque achado ou null.
export function acharChoqueComOutroPL(alloc) {
    const ativo = store.activePlanMeta;
    if (!alloc?.dataInicio || !ativo?.key) return null;
    const professores = getAllocationTeachersForConflict(alloc);
    if (!professores.length) return null;
    const ehEstaOferta = (ev) => String(ev?.turmaId) === String(alloc.turmaId)
        && String(ev?.disciplina || '') === String(alloc.disciplina || '')
        && String(ev?.subGrupo || '') === String(alloc.subGrupo || '');

    for (const { meta, allocations } of getOverlappingPlans()) {
        const inicio = [ativo.termStart, meta.termStart, alloc.dataInicio].sort().pop();
        const fim = [ativo.termEnd, meta.termEnd, alloc.dataFim || alloc.dataInicio].sort()[0];
        if (!inicio || !fim || inicio > fim) continue;
        const doOutro = (allocations || []).filter((a) => a && !isPendingAllocation(a));
        if (!doOutro.length) continue;

        for (const professor of professores) {
            const nossas = getCalendarEvents(null, inicio, fim, professor);
            const deles = withPlanContext(meta, doOutro, () => {
                const eventos = getCalendarEvents(null, inicio, fim, professor);
                Object.values(eventos || {}).forEach((lista) => (lista || []).forEach((ev) => {
                    if (ev && ev.type !== 'holiday') ev.rotuloTurma = getTurmaLabel(ev.turmaId, ev.subGrupo);
                }));
                return eventos;
            });
            for (const [data, lista] of Object.entries(nossas || {})) {
                const outras = deles?.[data] || [];
                if (!outras.length) continue;
                for (const a of (lista || [])) {
                    if (!a || a.type === 'holiday' || !ehEstaOferta(a)) continue;
                    const slotA = normalizeConflictSlotLabel(a.horario || '');
                    if (!slotA) continue;
                    const b = outras.find((ev) => ev && ev.type !== 'holiday'
                        && slotLabelsOverlap(slotA, normalizeConflictSlotLabel(ev.horario || '')));
                    if (b) {
                        return { professor, data, horario: slotA, disciplina: b.disciplina, turma: b.rotuloTurma, plano: planLabel(meta) };
                    }
                }
            }
        }
    }
    return null;
}

// Rede de seguranca: um choque NOVO no PL aberto, venha de onde vier (datas
// recalculadas, nome de professor unificado, mudanca de outro coordenador,
// desfazer), e avisado na hora, uma vez. So os choques que tocam turmas que
// este usuario pode editar. A primeira leitura de cada PL so guarda o que ja
// existia (nao avisa os choques antigos ao abrir o app).
// Mesma chave para o aviso de choque novo e para as linhas abertas do alerta.
function chaveDoChoque(professor, d) {
    return `${normalizeTeacherNameForMatch(professor)}|${d.discA}|${d.discB}`;
}

// Estado do "Como resolver?" (ver setResolverDeChoque, mais abaixo).
let resolverDeChoque = null;          // ({ ids }) => [{ quem: 'voce' | 'outro', texto }]
const comoResolverAbertos = new Set(); // linhas abertas: continuam abertas ao redesenhar
let linhasDoAlerta = [];

let choquesConhecidos = { plano: '', chaves: null };

function avisarChoquesNovos(conflictMap) {
    const plano = store.activePlanMeta?.key || '';
    const atuais = new Map();
    conflictMap.forEach((detalhes, professor) => detalhes.forEach((d) => {
        if (!(d.turmaIds || []).some((turmaId) => store.podeEditarTurma(turmaId))) return;
        atuais.set(chaveDoChoque(professor, d), { professor, ...d });
    }));

    if (choquesConhecidos.plano !== plano || !choquesConhecidos.chaves) {
        // Sem alocacoes ainda (o servidor nao respondeu): espera a grade chegar.
        if ((store.allocations || []).some((a) => a && !isPendingAllocation(a))) {
            choquesConhecidos = { plano, chaves: new Set(atuais.keys()) };
        }
        return;
    }

    const novos = [...atuais].filter(([chave]) => !choquesConhecidos.chaves.has(chave)).map(([, d]) => d);
    choquesConhecidos.chaves = new Set(atuais.keys());
    if (!novos.length) return;

    const primeiro = novos[0];
    const dataBR = primeiro.dataInicio ? primeiro.dataInicio.split('-').reverse().join('/') : '';
    // O aviso usa innerHTML: nomes escapados.
    const mensagem = novos.length === 1
        ? `Novo choque de professor: ${escaparHtml(primeiro.professor)} tem ${escaparHtml(primeiro.discA)} e ${escaparHtml(primeiro.discB)} no mesmo horário (a partir de ${dataBR}). Veja o alerta na aba Calendário Docente.`
        : `${novos.length} novos choques de professor (${escaparHtml([...new Set(novos.map((d) => d.professor))].join(', '))}). Veja o alerta na aba Calendário Docente.`;
    showToastWarning(mensagem, 'warning', 12000);
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
    avisarChoquesNovos(conflictMap);
    // Junta os choques com outro PL (mesmo professor, mesmo bloco no alerta).
    detectCrossPlanConflicts().forEach((detalhes, professor) => {
        const chave = normalizeTeacherNameForMatch(professor);
        const nome = [...conflictMap.keys()].find((k) => normalizeTeacherNameForMatch(k) === chave) || professor;
        conflictMap.set(nome, [...(conflictMap.get(nome) || []), ...detalhes]);
    });
    let temEntrePLs = false;
    const chavesAtuais = new Set();
    linhasDoAlerta = [];

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
                // "Como resolver?" so no PL aberto (os outros PLs vem do cache).
                let celulaResolver = `<td style="${tdStyle}"></td>`;
                let linhaSugestoes = '';
                if (!d.entrePLs && resolverDeChoque && d.allocIds?.length) {
                    const chave = chaveDoChoque(teacher, d);
                    chavesAtuais.add(chave);
                    const idx = linhasDoAlerta.push({ chave, ids: d.allocIds }) - 1;
                    const aberto = comoResolverAbertos.has(chave);
                    celulaResolver = `<td style="${tdStyle}"><button type="button" class="btn-como-resolver" data-idx="${idx}" aria-expanded="${aberto}" style="background:#fff; color:#c0392b; border:none; border-radius:12px; padding:3px 10px; font-weight:700; font-size:0.85em; cursor:pointer;">${aberto ? 'Fechar' : 'Como resolver?'}</button></td>`;
                    if (aberto) linhaSugestoes = htmlSugestoes(d.allocIds);
                }
                // Nomes digitados (professor, componente): sempre escapados.
                return `<tr>
                    <td style="${tdStyle}">${escaparHtml(d.dia)}</td>
                    <td style="${tdStyle}">${escaparHtml(d.horario)}</td>
                    <td style="${tdStyle}">${escaparHtml(dataBR)}</td>
                    <td style="${tdCompStyle}">${escaparHtml(d.discA)}</td>
                    <td style="${tdCompStyle}">${escaparHtml(d.discB)}${selo}</td>
                    ${celulaResolver}
                </tr>${linhaSugestoes}`;
            }).join('');

            blocksHtml += `
                <div style="margin-top: 10px;">
                    <b style="font-size:1em;">&#128274; ${escaparHtml(teacher)}</b>
                    <table style="border-collapse: collapse; margin-top: 6px; width: 100%;">
                        <thead><tr>
                            <th style="${thStyle}">Dia</th>
                            <th style="${thStyle}">Horário</th>
                            <th style="${thStyle}">A partir de</th>
                            <th style="${thStyle}">Componente A</th>
                            <th style="${thStyle}">Componente B</th>
                            <th style="${thStyle}"></th>
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
                ${linhasDoAlerta.length ? '<p style="margin: 4px 0 0 0; font-size: 0.8em; opacity: 0.95;"><i><b>Como resolver?</b>: mostra o que muda só no seu curso e, quando a outra aula é de outro curso, com quem conversar. Nada é alterado sozinho.</i></p>' : ''}
                ${temEntrePLs ? '<p style="margin: 4px 0 0 0; font-size: 0.8em; opacity: 0.95;"><i><b>Outro PL</b>: choque com um período letivo que se sobrepõe a este nas datas. Para ver os dois juntos, escolha o professor e clique em <b>Ano inteiro</b>.</i></p>' : ''}
            </div>
        `;
        warningDiv.style.display = 'block';
    } else {
        warningDiv.style.display = 'none';
    }
    // Choque que sumiu nao fica "aberto" para quando voltar.
    [...comoResolverAbertos].forEach((chave) => { if (!chavesAtuais.has(chave)) comoResolverAbertos.delete(chave); });

    if (!warningDiv.dataset.ouvinteResolver) {
        warningDiv.dataset.ouvinteResolver = '1';
        warningDiv.addEventListener('click', (e) => {
            const botao = e.target.closest('.btn-como-resolver');
            if (!botao) return;
            const linha = linhasDoAlerta[Number(botao.dataset.idx)];
            if (!linha) return;
            if (comoResolverAbertos.has(linha.chave)) comoResolverAbertos.delete(linha.chave);
            else comoResolverAbertos.add(linha.chave);
            updateGlobalConflictsUI();
        });
    }
}

// ===== "Como resolver?" =====
// O calculo fica no ui.js (usa o motor do salvar e do Trocar); aqui so a tela.
// O estado (linhas abertas etc.) fica junto do alerta, mais acima.

export function setResolverDeChoque(fn) {
    resolverDeChoque = typeof fn === 'function' ? fn : null;
}

function escaparHtml(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function htmlSugestoes(ids) {
    let linhas = [];
    try {
        linhas = resolverDeChoque({ ids }) || [];
    } catch (error) {
        console.warn('Como resolver: falha no calculo', error);
        linhas = [{ quem: 'voce', texto: 'Não foi possível calcular agora. Tente de novo ou ajuste pelo Editar.' }];
    }
    const rotulo = { voce: 'Depende só de você', outro: 'Depende de outra coordenação' };
    const itens = linhas.map((l) => `<li style="margin:3px 0;"><b style="color:${l.quem === 'voce' ? '#1e7e34' : '#a04000'};">${rotulo[l.quem] || ''}:</b> ${escaparHtml(l.texto)}</li>`).join('');
    return `<tr><td colspan="6" style="background:#fff; color:#2d3436; padding:8px 12px; border:1px solid rgba(255,255,255,0.3); font-size:0.85em;">
        <ul style="margin:0; padding-left:18px;">${itens}</ul>
    </td></tr>`;
}

export function refreshTeacherConflictsUI() {
    updateGlobalConflictsUI();
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    if (activeTab === 'teacher' && selViewDocente && selViewDocente.value) {
        renderTeacherCalendar();
    }
}
