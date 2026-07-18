# Plano de Limpeza Priorizado — Cardume (gestor-iecos)

> Roadmap incremental para reduzir a dívida técnica acumulada (improvisações ao
> longo do desenvolvimento). Cada passo é isolado, **não muda comportamento** e
> deve ser validado no navegador antes do próximo. Complementa
> `docs/instrucoes_fatiamento_ui.md`.

## Diagnóstico (auditoria de 2026-07-14)

| Métrica | Valor | Observação |
|---|---|---|
| `ui.js` | ~5.558 linhas / 180 funções | ainda o gargalo |
| Funções gigantes | `renderWeeklyGrid` (473), `renderOfertasList` (416), `handleAddManual` (385), `initUI` (308) | fazem coisas demais |
| Acoplamento DOM | 194 `getElementById`, 136 `.style` inline, 25 `innerHTML=` | difícil testar |
| `window.` | 74 usos | estado global disfarçado |
| Estado mutável da Grade Semanal | ~14 variáveis de módulo espalhadas | fonte da maioria dos bugs recentes |
| Detecção de conflito | 3 lugares (`conflicts.js`, `conflitos_ui.js`, `ui.js`) | lógica duplicada |

## Fases

### 🟢 Fase 0 — Higiene rápida (baixo risco, alto retorno)
- [x] **0.1** Remover código morto residual. **CONCLUÍDO (2026-07-14, cache v57).**
  Removidas 7 funções órfãs de `ui.js` (não referenciadas em JS nem HTML):
  `formatSlotLabel`, `resolveFaixaTurno`, `rangeOverlaps`, `isIntensiveAllocation`,
  `hasIntensiveConflictByDay`, `handleSlotClick` e (cascata) `hasSlotsIntersection`.
  Validado: `node --check`, `node --test` (16/16), app no navegador sem erros de console.
- [x] **0.2** ~~Unificar regra de `importado`~~ → **RESOLVIDO (2026-07-14): manter comportamento atual (decisão do usuário).**
  A diferença atual é justificada, não acidental: conflito de *turma* é resolvido por
  empilhamento (mesma turma, reordena no tempo); conflito de *professor* é **cross-turma**
  e não pode empilhar. Decisão: **importada PODE sobrepor** (salvar com aviso), e a
  sobreposição é **destacada na aba Docente** para o diretor resolver manualmente.
  Isso já é o comportamento vigente: `handleAddManual` permite a sobreposição importada
  (toast de aviso) e `switchTab('teacher')` → `refreshTeacherConflictsUI()` →
  `updateGlobalConflictsUI()` (conflitos_ui.js) renderiza o alerta de conflito global.
  **Nenhuma alteração de código necessária.**

> Funcionalidade `weekAutoPosition` (chk-auto-week-position / radios no `index.html`):
> **REMOVIDA (2026-07-14, cache JS v58 / CSS v8, decisão do usuário).** O toggle estava
> duplamente morto: escondido por CSS (`#auto-week-position-row { display:none !important }`)
> E nunca era ligado (`setupWeekAutoPositionControls` jamais chamado). Removidos: os controles
> HTML, as funções `setupWeekAutoPositionControls`/`syncWeekAutoPositionControls`/
> `persistWeekAutoPositionSettings`/`getWeekAutoPositionMode`, os settings
> `weekAutoPositionEnabled`/`weekAutoPositionMode` e a regra CSS. **Mantido** o comportamento
> útil de bastidor (`applyWeekAutoPositionForComponentChange` + `getWeekAutoPositionAnchorDate`,
> simplificado para o modo padrão "Início") que reposiciona a semana ao trocar/carregar componente.

### 🟡 Fase 1 — Estado da Grade Semanal (raiz dos bugs)
- [ ] **1.1** Criar `weekly_state.js` centralizando `activeFaixaIndex`,
  `faixasPatterns`, `editing*`, `weeklyViewState`, `window.isDrawingFaixa`,
  `pendingFaixaStartPick`, etc. num objeto único com getters/setters.
  Elimina o global `window.isDrawingFaixa` e a dessincronização de estado.
  **Maior impacto estrutural.**

### 🟡 Fase 2 — Quebrar funções gigantes
- [ ] **2.1** `handleAddManual` → `validateComponentInput()`,
  `computeComponentExecution()`, `resolveConflictPlacement()`,
  `persistComponent()`; função vira orquestrador.
- [ ] **2.2** `renderWeeklyGrid` → `buildWeeklyGridModel()` + `paintWeeklyGrid(model)`.
- [ ] **2.3** `renderOfertasList` → promover `buildCanonicalRows`/`buildPendenteRows`
  a módulo puro.

### 🟢 Fase 3 — Consolidar conflitos
- [ ] **3.1** Unificar `detectTeacherConflicts` (conflicts.js),
  `detectGlobalTeacherConflictsStable` (conflitos_ui.js) e as checagens de
  `handleAddManual` num único motor com a mesma fonte de verdade.

### 🔵 Fase 4 — Cosmético (opcional)
- [ ] **4.1** Migrar `.style` inline → classes CSS (136 ocorrências).

## Regras de segurança (herdadas da série de fatiamento)
- Módulo novo **nunca** importa de `ui.js` (quebra ciclo de import).
- Refs DOM de módulo (`calStart`, `gridContainer`…) recriadas no módulo novo.
- Editar com Python (utf-8), **nunca** PowerShell `Get-Content/Out-File` (mojibake).
- Validar sempre: `node --check`, `node --test tests/academic_rules.test.mjs`, e
  no navegador (`python -m http.server 8123` + Playwright, limpar cache via CDP).
- Bump de cache (`??v=`) a cada edição de `ui.js` (em `js/main.js` e `index.html`).

## Histórico de execução
- 2026-07-14: plano criado. Fase 0.1 (código morto) CONCLUÍDA — 7 funções removidas,
  cache v57, validado (node --check/--test + navegador). Fase 0.2 reclassificada como
  decisão de comportamento (aguardando usuário). Feature `weekAutoPosition` sinalizada.
