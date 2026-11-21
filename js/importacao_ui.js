// Importacao: arquivo JSON de backup (Substituir / Mesclar / Cancelar, na janela
// #import-modal) e "Insercao por Bloco (PPC)" (componentes de um periodo do curso
// como pendentes). Saiu do ui.js em 20/11/2026 sem mudar nada; as funcoes do
// ui.js que ela usa chegam por ligarImportacao (modulo novo nao importa ui.js).
import { store } from './store.js?v=202611210933';
import { getTurmaLabel } from './curso_turma_helpers.js?v=202611210933';
import { renderOfertasList } from './lista_ofertas_ui.js?v=202611210933';
import { parseBackupDataFile, extractImportPlanMeta } from './serialization.js?v=202611210933';
import { showToastWarning } from './ui_feedback.js?v=202611210933';

// Funcoes do ui.js (plano, datas, docentes, abas) que a importacao chama.
let ligacoes = {};
export function ligarImportacao(fns) {
    ligacoes = fns;
}

// Arquivo escolhido, esperando Substituir, Mesclar ou Cancelar.
let tempImportData = null;
let tempImportPlanMeta = null;

// ==== IMPORTAÇÃO DE BLOCO ====
function normalizePeriodoToNumber(value) {
    const raw = String(value || '').trim().toUpperCase();
    if (!raw) return '';

    const numMatch = raw.match(/\d{1,2}/);
    if (numMatch) return String(parseInt(numMatch[0], 10));

    const romanMap = {
        I: '1',
        II: '2',
        III: '3',
        IV: '4',
        V: '5',
        VI: '6',
        VII: '7',
        VIII: '8',
        IX: '9',
        X: '10'
    };

    const romanOnly = raw.replace(/[^IVX]/g, '');
    if (romanOnly && romanMap[romanOnly]) return romanMap[romanOnly];

    return '';
}

export function handleImportBloco() {
    if (!store.selectedCurso || !store.selectedTurma) {
        showToastWarning('Selecione um Curso e uma Turma primeiro.', 'warning', 2600);
        return;
    }
    if (ligacoes.bloquearSeSomenteLeitura()) return;

    const comps = store.rawData?.componentes?.filter(c => c.sigla === store.selectedCurso) || [];
    if (comps.length === 0) {
        showToastWarning('Nenhum componente encontrado para este curso no arquivo mestre.', 'warning', 2800);
        return;
    }

    const periodosDisponiveisNoCurso = [...new Set(comps
        .map(c => normalizePeriodoToNumber(c.periodo))
        .filter(Boolean))]
        .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

    if (periodosDisponiveisNoCurso.length === 0) {
        showToastWarning('Os componentes deste curso nao possuem periodos validos cadastrados.', 'warning', 3000);
        return;
    }

    const opcoesDisponiveis = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
    const p = prompt(
        'INICIANDO IMPORTACAO RAPIDA\n' +
        'Turma alvo: ' + getTurmaLabel(store.selectedTurma) + '\n\n' +
        'Digite o NUMERO DO PERIODO que deseja importar:\n' +
        '(Opcoes disponiveis: ' + opcoesDisponiveis.join(', ') + ')\n' +
        'Periodos encontrados neste curso: ' + periodosDisponiveisNoCurso.join(', ')
    );

    if (!p) return;

    const periodoSelecionadoNum = normalizePeriodoToNumber(p);
    if (!periodoSelecionadoNum || !opcoesDisponiveis.includes(periodoSelecionadoNum)) {
        showToastWarning('Periodo invalido. Use uma das opcoes: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10.', 'warning', 3200);
        return;
    }

    const compsToImport = comps.filter(c => normalizePeriodoToNumber(c.periodo) === periodoSelecionadoNum);
    if (compsToImport.length === 0) {
        showToastWarning(`Nenhuma disciplina encontrada no periodo "${periodoSelecionadoNum}".`, 'warning', 3000);
        return;
    }

    const blocoId = `BL${periodoSelecionadoNum}`;
    let addedCount = 0;

    compsToImport.forEach(c => {
        const exists = store.allocations.some(a =>
            String(a.turmaId) === String(store.selectedTurma) && a.disciplina === c.componente
        );
        if (exists) return;

        store.addAllocation({
            turmaId: store.selectedTurma,
            disciplina: c.componente,
            docente: 'A definir',
            modo: 'pendente',
            importado: true,
            cor: c.cor || '#bdc3c7',
            dataInicio: store.settings.termStart,
            dataFim: store.settings.termEnd,
            subGrupo: blocoId
        });
        addedCount++;
    });

    if (addedCount > 0) {
        const turmaNome = getTurmaLabel(store.selectedTurma, blocoId);
        showToastWarning(`Sucesso! ${addedCount} disciplinas importadas como ${turmaNome}. Va em "Lista de Ofertas" para alocar na grade.`, 'success');
        store.saveAllocations();
        renderOfertasList();
        ligacoes.switchTab('list');
    } else {
        showToastWarning('Todas as disciplinas deste bloco ja estao na grade (ou pendentes) para esta turma.', 'warning', 3200);
    }
}

export function updateImportBlocoButtonState() {
    const btnImportBloco = document.getElementById('btn-import-bloco');
    if (!btnImportBloco) return;

    btnImportBloco.innerHTML = 'Inser&ccedil;&atilde;o por Bloco (PPC)';
    btnImportBloco.disabled = !(store.selectedCurso && store.selectedTurma);
}

export function ligarImportacaoJson() {
    const inpImport = sanitizeImportInputElement();
    if (inpImport) {
        // Neutraliza handlers legados e impede bind duplicado no input de importacao.
        inpImport.onchange = null;
        if (inpImport.dataset.importBound !== '1') {
            inpImport.dataset.importBound = '1';
            inpImport.addEventListener('change', handleFileSelect);
        }
    }

    const btnReplace = document.getElementById('btn-modal-replace');
    if (btnReplace) {
        btnReplace.addEventListener('click', () => {
            if (tempImportData) {
                if (tempImportPlanMeta?.key) {
                    ligacoes.applyPlanContextToUI(tempImportPlanMeta, { resetDraftOnChange: true });
                }
                store.replaceAllocations(markAllocationsAsImported(tempImportData));
                ligacoes.syncAllRegularDates();
                ligacoes.syncAllIntensiveDates();
                ligacoes.populateDocentes();
                ligacoes.rerenderPlanBoundViews();
                const planLabel = tempImportPlanMeta?.key ? ` no plano ${ligacoes.getPlanDisplayLabel(tempImportPlanMeta)}` : '';
                showToastWarning(`Dados importados${planLabel} com datas recalculadas com sucesso.`, 'success', 2200);
            }
            closeModal();
        });
    }

    const btnMerge = document.getElementById('btn-modal-merge');
    if (btnMerge) {
        btnMerge.addEventListener('click', () => {
            if (tempImportData) {
                if (tempImportPlanMeta?.key && tempImportPlanMeta.key !== store.getActivePlanMeta().key) {
                    const shouldSwitch = confirm(
                        `O arquivo pertence ao plano ${ligacoes.getPlanDisplayLabel(tempImportPlanMeta)}.\n\n` +
                        `Deseja trocar para esse plano antes de mesclar as alocacoes?`
                    );
                    if (!shouldSwitch) return;
                    ligacoes.applyPlanContextToUI(tempImportPlanMeta, { resetDraftOnChange: true });
                }
                const { addedCount, updatedCount } = store.mergeAllocations(markAllocationsAsImported(tempImportData));
                ligacoes.syncAllRegularDates();
                ligacoes.syncAllIntensiveDates();
                ligacoes.populateDocentes();
                showToastWarning(`Mesclagem concluida! ${addedCount} nova(s) e ${updatedCount} atualizada(s), com datas corrigidas.`, 'success', 3500);
                ligacoes.rerenderPlanBoundViews();
            }
            closeModal();
        });
    }

    const btnCancel = document.getElementById('btn-modal-cancel');
    if (btnCancel) {
        btnCancel.addEventListener('click', () => {
            tempImportData = null;
            tempImportPlanMeta = null;
            if (inpImport) inpImport.value = '';
            closeModal();
        });
    }
}

// Marca alocacoes vindas de arquivo importado para que sobreposicoes sejam
// permitidas e destacadas na aba Calendario Docente.
function markAllocationsAsImported(list) {
    if (!Array.isArray(list)) return [];
    return list.map((alloc) => (alloc && typeof alloc === 'object' ? { ...alloc, importado: true } : alloc));
}

function handleFileSelect(event) {
    if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
    }
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        const result = parseBackupDataFile(e.target.result);
        
        if (!result.success) {
            showToastWarning(result.error || 'Arquivo inválido. O formato não é suportado.', 'error', 3000);
            tempImportData = null;
            tempImportPlanMeta = null;
            event.target.value = '';
            return;
        }

        tempImportData = result.allocations;
        tempImportPlanMeta = extractImportPlanMeta(result.parsed, ligacoes.resolveOfficialPeriodoLetivoPlan);
        
        if (tempImportPlanMeta?.key) {
            showToastWarning(`Arquivo reconhecido para o plano ${ligacoes.getPlanDisplayLabel(tempImportPlanMeta)}.`, 'success', 2400);
        }
        
        const modal = document.getElementById('import-modal');
        if (modal) modal.style.display = 'flex';
    };
    reader.readAsText(file);
}

function closeModal() {
    const modal = document.getElementById('import-modal');
    if (modal) modal.style.display = 'none';
    tempImportData = null;
    tempImportPlanMeta = null;
    const inp = document.getElementById('inp-import');
    if (inp) inp.value = '';
}

function sanitizeImportInputElement() {
    const current = document.getElementById('inp-import');
    if (!current) return null;
    if (current.dataset.importSanitized === '1') return current;

    const clone = current.cloneNode(true);
    clone.value = '';
    clone.onchange = null;
    clone.dataset.importSanitized = '1';
    current.replaceWith(clone);
    return clone;
}
