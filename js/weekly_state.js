// ---------------------------------------------------------------------------
// ESTADO DA ALOCACAO DE COMPONENTES (aba "weekly") — centralizacao incremental.
//
// Modulo NEUTRO: NAO importa de ui.js (evita ciclo de import). Guarda o estado
// mutavel da SESSAO DE EDICAO de uma componente num unico dono, para acabar com
// a classe de bug "esqueci de resetar um campo de edicao em algum caminho".
//
// Fase 1 do plano de blindagem do motor. Nesta 1a fatia migramos apenas o
// cluster de EDICAO (5 campos + reset atomico). drawingFaixaIndex, faixasPatterns
// e weeklyViewState continuam em ui.js por enquanto (migracao incremental).
//
// Uso em ui.js: `import { weeklyState } from './weekly_state.js';` e acessar
// `weeklyState.editingDisciplinaDraft` etc. (mutacao de PROPRIEDADE do objeto —
// nao da para reatribuir um binding de import, por isso o estado vive num objeto).
// ---------------------------------------------------------------------------

export const weeklyState = {
    // Rascunho da disciplina carregada no editor (nome normalizado, sem "(60h)").
    editingDisciplinaDraft: '',

    // true quando a disciplina carregada no editor veio de importacao (bloco PPC
    // ou arquivo). Sobreposicao ao salvar so e permitida quando esta flag for true.
    editingImportadoDraft: false,

    // Edicao segura: IDs das ofertas originais carregadas no editor. A remocao e
    // ADIADA ate o salvar (remover agora persistiria no localStorage e seria
    // perdido num reload antes de confirmar). Limpo ao salvar com sucesso ou ao
    // abandonar a edicao (troca de disciplina/turma/plano).
    editingOriginalAllocationIds: [],

    // Data inicial (Faixa 1) original da componente em edicao. Usada pelo
    // "Limpar Faixas" para reposicionar a Faixa 1 na data que a componente ja
    // ocupava, em vez de recalcular o primeiro dia livre.
    editingComponentOriginalStart: '',

    // Ultimo valor normalizado digitado no campo de disciplina (rastreio para
    // detectar "nova selecao de disciplina" nos handlers de input/change).
    lastDisciplinaInputNormalized: '',

    // --- Estado de DESENHO / FAIXAS ---
    // Padroes desenhados por faixa (1|2|3) -> array de { dia, slot }. E MUTADO
    // IN-PLACE (faixasPatterns[i] = ...) e nunca reatribuido como objeto inteiro,
    // para que o alias `const faixasPatterns = weeklyState.faixasPatterns` em
    // ui.js continue apontando para este mesmo objeto. Para limpar os 3, use
    // clearFaixasPatterns() (preserva a identidade do objeto).
    faixasPatterns: { 1: [], 2: [], 3: [] },

    // --- Estado de VISUALIZACAO da grade semanal ---
    // weekStartISO: 1a data (segunda) da semana exibida; followActiveFaixa:
    // se a grade deve pular para a semana da faixa ativa. Objeto acessado em
    // ui.js via alias `const weeklyViewState = weeklyState.view`.
    view: {
        weekStartISO: '',
        followActiveFaixa: true
    },

    // Flag interna do trace de diagnostico (ver isTraceEnabled/setTrace).
    _traceEnabled: false,

    // Limpa os 3 padroes de faixa IN-PLACE (preserva a identidade do objeto
    // faixasPatterns para o alias de ui.js seguir valido). Substitui o antigo
    // `faixasPatterns = { 1: [], 2: [], 3: [] }`.
    clearFaixasPatterns() {
        this.faixasPatterns[1] = [];
        this.faixasPatterns[2] = [];
        this.faixasPatterns[3] = [];
        this.trace('clearFaixasPatterns');
        this.checkInvariants('clearFaixasPatterns');
    },

    // FONTE UNICA DE VERDADE do "reset completo" da sessao de edicao. Os 3
    // caminhos que abandonam a edicao por inteiro (troca de plano, reset da turma,
    // pos-salvamento) chamam este metodo — se um novo campo de edicao surgir,
    // basta adiciona-lo aqui e nenhum caminho fica dessincronizado.
    // Resets PARCIAIS intencionais (handlers de disciplina que mantem
    // lastDisciplinaInputNormalized; undo que so limpa os IDs) permanecem inline.
    resetEditing() {
        this.editingDisciplinaDraft = '';
        this.editingImportadoDraft = false;
        this.editingOriginalAllocationIds = [];
        this.editingComponentOriginalStart = '';
        this.lastDisciplinaInputNormalized = '';
        this.trace('resetEditing');
        this.checkInvariants('resetEditing');
    },

    // -----------------------------------------------------------------------
    // DIAGNOSTICO — trace + guardas de invariante (o "rastreavel e previsivel").
    // Desligado por padrao (impacto zero em producao). Ligar no console:
    //   __weeklyStateDebug.trace(true)
    // e interagir; ou persistente via localStorage 'weekly_state_trace' = '1'.
    // -----------------------------------------------------------------------
    isTraceEnabled() {
        if (this._traceEnabled) return true;
        try {
            return localStorage.getItem('weekly_state_trace') === '1';
        } catch (e) {
            return false;
        }
    },

    setTrace(on = true) {
        this._traceEnabled = !!on;
        try {
            localStorage.setItem('weekly_state_trace', on ? '1' : '0');
        } catch (e) { /* noop */ }
        return this._traceEnabled;
    },

    // Copia LEVE do estado para inspecao/log (nao expoe os objetos mutaveis:
    // faixasPatterns vira contagem por faixa; arrays sao copiados).
    snapshot() {
        return {
            editingDisciplinaDraft: this.editingDisciplinaDraft,
            editingImportadoDraft: this.editingImportadoDraft,
            editingOriginalAllocationIds: [...this.editingOriginalAllocationIds],
            editingComponentOriginalStart: this.editingComponentOriginalStart,
            lastDisciplinaInputNormalized: this.lastDisciplinaInputNormalized,
            faixasPatterns: {
                1: (this.faixasPatterns?.[1] || []).length,
                2: (this.faixasPatterns?.[2] || []).length,
                3: (this.faixasPatterns?.[3] || []).length
            },
            view: { ...this.view }
        };
    },

    // Registra uma transicao (so quando o trace esta ligado). NUNCA lanca.
    trace(event, extra = {}) {
        if (!this.isTraceEnabled()) return;
        try {
            console.log(`[weeklyState] ${event}`, { ...this.snapshot(), ...extra });
        } catch (e) { /* noop */ }
    },

    // Verifica invariantes ESTRUTURAIS do estado. NUNCA lanca: retorna a lista de
    // violacoes e, se o trace estiver ligado, avisa no console. Chamada nas
    // transicoes chave (reset/clear/enter-edicao) para caçar desincronizacao cedo.
    checkInvariants(context = '') {
        const problems = [];

        // faixasPatterns deve ter exatamente as chaves 1,2,3, cada uma array.
        [1, 2, 3].forEach((k) => {
            if (!Array.isArray(this.faixasPatterns?.[k])) {
                problems.push(`faixasPatterns[${k}] nao e array`);
            }
        });
        const extraKeys = Object.keys(this.faixasPatterns || {})
            .filter((k) => !['1', '2', '3'].includes(String(k)));
        if (extraKeys.length) problems.push(`faixasPatterns com chaves inesperadas: ${extraKeys.join(',')}`);

        // Tipos basicos.
        if (typeof this.editingImportadoDraft !== 'boolean') problems.push('editingImportadoDraft nao e boolean');
        if (!Array.isArray(this.editingOriginalAllocationIds)) problems.push('editingOriginalAllocationIds nao e array');

        // view.weekStartISO: vazio OU ISO YYYY-MM-DD.
        const wk = this.view?.weekStartISO;
        if (wk && !/^\d{4}-\d{2}-\d{2}$/.test(String(wk))) problems.push(`view.weekStartISO invalido: ${wk}`);

        // Coupling: se ha data inicial original guardada, deve haver IDs originais
        // rastreados — senao a sessao de edicao esta dessincronizada.
        if (this.editingComponentOriginalStart && this.editingOriginalAllocationIds.length === 0) {
            problems.push('editingComponentOriginalStart setado sem editingOriginalAllocationIds');
        }

        if (problems.length && this.isTraceEnabled()) {
            try {
                console.warn(`[weeklyState] invariantes violadas${context ? ' @ ' + context : ''}:`, problems, this.snapshot());
            } catch (e) { /* noop */ }
        }
        return problems;
    }
};

// Hook de DEPURACAO (nao expoe o estado mutavel direto — so leitura via snapshot,
// toggle do trace e verificacao de invariantes). No console do navegador:
//   __weeklyStateDebug.trace(true)   -> liga o log de transicoes
//   __weeklyStateDebug.snapshot()    -> inspeciona o estado atual (copia)
//   __weeklyStateDebug.check()       -> lista invariantes violadas agora
if (typeof window !== 'undefined') {
    window.__weeklyStateDebug = {
        trace: (on = true) => weeklyState.setTrace(on),
        snapshot: () => weeklyState.snapshot(),
        check: () => weeklyState.checkInvariants('manual')
    };
}
