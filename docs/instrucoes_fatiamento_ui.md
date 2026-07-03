# Instrucoes de Fatiamento do js/ui.js — Guia para Agente Executor

> **Publico-alvo deste documento:** um agente de IA executor que fara o trabalho mecanico de extracao de modulos.
> **Autoria do plano:** mapeamento feito em 02/07/2026 sobre o `ui.js` com 11.136 linhas (480 KB).
> **Leia este documento INTEIRO antes de editar qualquer arquivo.**

---

## 1. Objetivo

Fatiar `js/ui.js` em modulos por responsabilidade, **sem mudar nenhum comportamento visivel do sistema**. O `ui.js` final deve virar uma casca fina de orquestracao (imports + `initUI` + wiring).

Este e um trabalho de **mover codigo, nao de reescrever codigo**.

---

## 2. Regras inviolaveis

1. **NUNCA altere a logica interna de uma funcao.** Copie e cole o corpo exatamente como esta. Nao "melhore" nada: nao renomeie variaveis, nao simplifique condicionais, nao adicione comentarios, nao formate.
2. **Uma extracao por rodada.** Cada rodada = criar 1 modulo novo + ajustar imports + testar + commit. Nunca faca duas extracoes no mesmo commit.
3. **Nao renomeie funcoes.** O nome exportado deve ser identico ao nome original.
4. **Preserve a convencao de cache-busting nos imports.** O projeto usa sufixos como `'./store.js??v=20260625v'` (com `??` duplo, intencional). Ao criar imports novos entre modulos internos, use o caminho simples sem sufixo (ex.: `'./ui_feedback.js'`), como ja e feito em `turns.js`, `utils.js` etc. **Nao remova** os sufixos dos imports existentes.
5. **Nao toque em `index.html`, `agenda_publica.html` ou `js/main.js`** exceto quando a rodada exigir explicitamente (indicado na fase).
6. **Se algo nao se encaixar nas instrucoes, PARE e reporte.** Nao improvise solucao criativa.
7. **Numeros de linha neste documento sao do estado original.** Eles mudam apos cada extracao. **Localize sempre pelo NOME da funcao**, nunca pela linha.
8. Apos cada rodada, rode a verificacao da secao 7 antes de commitar.

---

## 3. Estado atual (mapa geral)

### 3.1. Exports atuais do ui.js (interface publica — NAO QUEBRAR)

| Export | Consumidor |
|---|---|
| `initUI` | `js/main.js` |
| `exportSigaaMetadataJSON` | `js/main.js` |
| `showToastWarning` | `js/main.js` |
| `renderPublicTeacherGantt` | **nenhum** (export morto; manter por ora, remover so na fase final com aprovacao humana) |

`js/main.js` importa assim:
```js
import { initUI, exportSigaaMetadataJSON, showToastWarning } from './ui.js??v=20260627v48';
```
Esses tres exports devem continuar saindo de `ui.js` (re-export permitido) ate a fase final.

### 3.2. Estado mutavel de modulo (PONTO CRITICO)

O topo do `ui.js` (linhas ~25–90 originais) declara referencias DOM e estado mutavel compartilhado, por exemplo:

- `gridContainer`, `selCurso`, `selTurma`, `inputConfig`, `calStart`, `calEnd` (referencias DOM)
- `activeFaixaIndex`, `faixasPatterns`, `editingDisciplinaDraft`, `editingImportadoDraft`, `editingOriginalAllocationIds`, `editingComponentOriginalStart`
- `componentStartSelectionMode`, `drawingViewMode`, `drawingDragState`
- `pendingFaixaStartPick`, `pendingFaixaQuickActionConfirm`, `weeklyViewState`
- `window.isDrawingFaixa` (estado global via `window` — usado em varios pontos)

**Regra:** uma funcao so pode ser movida para outro modulo se **nao ler nem escrever** esse estado compartilhado, OU se **todo o grupo de funcoes que compartilha aquele estado for movido junto com as declaracoes do estado**. Na duvida, deixe a funcao no `ui.js` e reporte.

As fases abaixo ja foram escolhidas para minimizar esse problema. Funcoes de Grade Semanal/faixas (que concentram quase todo o estado mutavel) ficam por ULTIMO e podem nem ser extraidas nesta serie.

---

## 4. Fases de extracao (ordem obrigatoria)

Execute na ordem. Nao pule fases. Nao adiante fases.

---

### FASE 1 — `js/ui_feedback.js` (toasts, status, copiar)

**Risco:** baixo. **Tamanho estimado:** ~140 linhas.

Mover para o novo modulo `js/ui_feedback.js`:

| Funcao | Linha original | Observacao |
|---|---|---|
| `showToastWarning` | 339 | usa `window.toastTimeout`; mover como esta. **export** |
| `showPersistentStatusMessage` | 365 | **export** (usada em varios pontos do ui.js) |
| `copyTextToClipboard` | 407 | async; **export** |
| `flashButtonCopyState` | 423 | **export** |
| `setupCopyActionButtons` | 444 | **export** (chamada no initUI) |

Passos:
1. Criar `js/ui_feedback.js` com as 5 funcoes copiadas literalmente, todas com `export function` (ou `export async function`).
2. No `ui.js`: remover as 5 funcoes e adicionar no topo:
   ```js
   import { showToastWarning, showPersistentStatusMessage, copyTextToClipboard, flashButtonCopyState, setupCopyActionButtons } from './ui_feedback.js';
   ```
3. Manter o export de `showToastWarning` para `main.js` adicionando ao final do `ui.js`:
   ```js
   export { showToastWarning };
   ```
   (e conferir que nao ha conflito com o import — o re-export via `export { showToastWarning };` apos import e valido em ES modules.)
4. Buscar no `ui.js` inteiro por chamadas as 5 funcoes e confirmar que nenhuma ficou orfa.
5. Verificar (secao 7) e commitar: `refactor(ui): extrai ui_feedback.js (toasts, status e copiar)`.

---

### FASE 2 — `js/color_utils.js` (utilitarios de cor)

**Risco:** baixo. **Tamanho estimado:** ~110 linhas. Funcoes puras, sem DOM, sem estado.

| Funcao | Linha original |
|---|---|
| `normalizeHexColor` | 1266 |
| `hexToRgb` | 1275 |
| `adjustHexColor` | 1284 |
| `hexToRgba` | 1291 |
| `rgbToHsl` | 1297 |
| `hslToRgb` | 1317 |
| `vividHexColor` | 1344 |

Passos identicos ao padrao (secao 6). Commit: `refactor(ui): extrai color_utils.js`.

**Atencao:** `getDrawingBaseColor` (1361) usa DOM/estado — NAO mover, fica no ui.js.

---

### FASE 3 — `js/date_utils_ui.js` (utilitarios de data puros)

**Risco:** baixo. Funcoes puras de data usadas em varias areas.

| Funcao | Linha original |
|---|---|
| `shiftISODate` | 1610 |
| `diffDaysISO` | 2422 |
| `toISODate` | 3428 |
| `addDaysISO` | 3432 |
| `getWeekStartISO` | 3438 |
| `formatDayMonthShort` | 3448 |
| `isDateInsideRange` | 3762 |
| `formatCompactFaixaDate` | 2845 |
| `formatDateBRShortYear` | 5241 |
| `formatDateBR` | 11104 |
| `isValidISODateValue` | 1875 |
| `timeToMinutes` | 473 |
| `shortDayName` | 886 |

**Antes de mover cada uma:** confirmar que o corpo nao usa DOM nem variaveis de modulo. Se usar, deixe no `ui.js` e registre no relatorio.
Commit: `refactor(ui): extrai date_utils_ui.js`.

---

### FASE 4 — `js/gantt_ui.js` (camada de UI do Gantt legado + interacoes)

**STATUS: CONCLUIDA em 02/07/2026 (commits 8a3f2d0 + fix cc9f51f). O `gantt_ui.js` foi extraido via as sub-fases 4a-4d (helpers neutros primeiro, Gantt por ultimo). ui.js caiu de ~10.614 para ~8.691 linhas. Validado no browser: PLs/cursos/Grade Semanal/Calendarios/Gantt/Lista de Ofertas OK, zero erros de console.**

> As tres primeiras tentativas de extracao DIRETA do Gantt quebraram o app. As causas raiz e a estrategia correta estao em "Licoes aprendidas" ao final desta fase — leia antes de mexer no gantt_ui.js de novo.

**Risco:** alto (originalmente estimado medio). **Tamanho estimado:** ~1.800 linhas. E o maior bloco isolavel: funcoes `*Gantt*` formam um cluster coeso que quase nao toca o estado da Grade Semanal.

Mover o bloco continuo de funcoes (todas com `Gantt` no nome + auxiliares exclusivas do Gantt):

- `getGanttTurnoCode` (8184), `getGanttTurnoConfigs` (8193), `resolveGanttTurnoForSlot` (8225), `resolveGanttTurnosForSlots` (8248), `getGanttVisibleTurnosLegacy` (8259)
- `getShiftTimeRangeStr` (8283), `getShiftTimeRangeMeta` (8308)
- `buildGanttTimelineLinesHtml` (8332), `buildGanttMonthStartLinesHtml` (8348), `buildGanttMonthOverlaysHtml` (8365), `buildGanttMonthHeaderColumnsHtml` (8383)
- `resolveExecutionRangeBounds` (8409), `collectLegacyGanttDayItems` (8416)
- `getGanttCompactDisciplinaLabel` (8547), `getGanttCompactRangeLabel` (8569), `buildGanttDetailedScheduleRows` (8576), `clampGanttPercent` (8592), `formatGanttShortDate` (8596)
- `buildGanttSegmentDescriptors` (8600), `buildGanttSharedSegmentLabelsHtml` (8718), `buildGanttSharedSeamDatesHtml` (8747), `buildGanttOuterDateLabelsHtml` (8767), `buildGanttInnerDateLabelsHtml` (8789)
- `renderGanttTurnoLane` (8796), `renderTeacherClassicGantt` (9001), `renderGanttDayRow` (9076)
- `buildGanttLensHtml` (9090), `ensureGanttDetailLens` (9150), `positionGanttDetailLens` (9164), `ensureGanttDetailModal` (9201), `openGanttDetailModal` (9231), `bindGanttDetailInteractions` (9395)
- `getGanttVisibleTurnos` (9627), `collectGanttDayItems` (9660)
- `renderTeacherGanttInto` (9798), `renderGanttChart` (9847), `renderTurmaGanttInto` (9854), `getActiveGanttMode` (9891), `renderGanttForActiveMode` (9896), `printGanttLandscape` (9911)
- `renderPublicTeacherGantt` (9984) — manter o `export` dela no novo modulo e re-exportar no `ui.js`

**Cuidados especificos desta fase:**
1. Essas funcoes usam `store`, `buildTeacherExecutionSnapshot`, `renderBidimensionalTeacherGantt`, `renderBidimensionalTurmaGantt`, helpers de turno de `turns.js` e possivelmente funcoes que ficaram no `ui.js` (ex.: `getDocenteShortLabel`, `getTurmaLabel`, snapshots `buildGanttFaixaDaySnapshots`/`buildGanttFaixaTurnoSnapshots` das linhas 4181/4225). **Mapeie cada dependencia antes de mover.**
2. `buildGanttFaixaDaySnapshots` (4181) e `buildGanttFaixaTurnoSnapshots` (4225) sao candidatas a ir junto — verifique se algo fora do Gantt as usa. Se sim, deixe no `ui.js` e importe no `gantt_ui.js`. Cuidado: importacao circular `ui.js <-> gantt_ui.js` deve ser EVITADA; se a dependencia for mutua, mova o helper compartilhado para um terceiro modulo ja existente da serie (ex.: `date_utils_ui.js`) ou reporte.
3. Funcoes chamadas de dentro do `initUI` ou de `switchTab` (ex.: `renderGanttForActiveMode`) precisam ser exportadas do `gantt_ui.js` e importadas no `ui.js`.
4. NAO mover `renderMonthlyCalendar`, `renderTeacherCalendar` nem nada de calendario nesta fase.

Commit: `refactor(ui): extrai gantt_ui.js (camada de UI do Gantt)`.

#### Licoes aprendidas (Fase 4, 3 tentativas em 02/07/2026)

Foram TRES causas distintas de quebra, todas descobertas so em runtime no browser (nem `node --check`, nem `node --test`, nem o linter pegam):

**1. Ciclo de import `ui.js <-> gantt_ui.js`.** Na 1a tentativa o `gantt_ui.js` importava 15 funcoes que ficaram no `ui.js`; em runtime alguns bindings apareciam `undefined` durante o `initUI` -> PLs/cursos nao carregavam. FIX: extrair os helpers para modulos NEUTROS primeiro (fases 4a-4c), para o `gantt_ui.js` nunca importar do `ui.js`.

**2. Variaveis DOM de nivel de modulo.** O bloco Gantt usa `calStart`/`calEnd` (= `document.getElementById('cal-start'/'cal-end')`, declaradas no topo do `ui.js` L99-100) dentro de `renderTeacherGanttInto`/`renderTurmaGanttInto` como `calStart?.value`. Optional chaining NAO protege identificador NAO-DECLARADO -> `ReferenceError` ao renderizar o Gantt no init -> PLs travavam em "Carregando...". FIX: redeclarar essas refs DOM no topo do `gantt_ui.js` (`const calStart = document.getElementById('cal-start'); const calEnd = document.getElementById('cal-end');`). O modulo e deferred, entao o DOM ja esta pronto.

**3. Mojibake por extracao via PowerShell.** Gerar o `gantt_ui.js` com `Get-Content -Raw` / `Out-File` (PowerShell 5.1 le/escreve como ANSI, nao UTF-8) CORROMPEU todos os acentos, transformando o regex `/[^A-Za-zÀ-ÿ0-9]/` de `getGanttTurnoCode` em range invalido -> `Invalid regular expression: Range out of order`. FIX: fazer a extracao com PYTHON (`io.open(..., encoding='utf-8')`), que preserva UTF-8. NUNCA usar Get-Content/Out-File para mover blocos de codigo com acentos.

**4. Import reverso esquecido (core -> gantt).** Apos extrair, uma funcao que FICOU no `ui.js` (`getSigaaCode` -> chama `getGanttTurnoCode`) passou a referenciar uma funcao movida sem import de volta -> Lista de Ofertas quebrava inteira (getGanttTurnoCode is not defined). FIX: apos extrair, rodar um scanner dos DOIS sentidos: (a) gantt_ui.js chamando funcoes do ui.js; (b) ui.js chamando exports do gantt_ui.js. Comando usado: `python -c "import io,re; src=open('js/ui.js',encoding='utf-8').read(); gantt=set(re.findall(r'export function ([A-Za-z0-9_]+)', open('js/gantt_ui.js',encoding='utf-8').read())); called=set(re.findall(r'(?<![.\w])([A-Za-z0-9_]+)\s*\(', src)); print(sorted((gantt & called) - IMPORTED))"`.

**Divisao final que funcionou (sentido unico ui.js -> gantt_ui.js, sem ciclo):**
- Fase 4a `allocation_helpers.js`: getAllocationModo, isFaixaAllocation, isPriorityRegularAllocation, isRegularAllocation, isScheduledRegularAllocation, isPendingAllocation, normalizeTeacherNameForMatch, teacherNamesMatch, allocationHasTeacherMatch, getDocenteShortLabel, calculateTeacherTotalCH. Importa store + curso_turma_helpers.
- Fase 4b `turno_helpers.js`: normalizeConflictSlotLabel, normalizeTurnoOfertaKey, formatTurnoOfertaLabel, getAvailableTurnoOfertaOptions, resolveTurnoOfertaValue, getTurnoNormalizedFromLetter, getTurnoValueFromLetter, getShiftChangeLabel, getNativeTurnoValueForAllocation. Importa store + turns.js.
- Fase 4c `curso_turma_helpers.js`: getDisciplinaCHGlobal, derivarBloco, getTurmaSelectLabel, getTurmaLabel, getTurmaBaseLabel, getDisciplinaInfo. Importa store + plan_storage.js.
- Fase 4d `gantt_ui.js`: resolveTeacherShiftForSlot + buildGanttFaixaDaySnapshots/Turno + todo o bloco getGanttTurnoCode..renderPublicTeacherGantt. Importa dos 3 modulos acima + store/calendar/execution_engine/gantt_bidimensional/academic_rules/plan_storage/color_utils/date_utils_ui/ui_feedback. Redeclara calStart/calEnd. O `ui.js` importa de volta: resolveTeacherShiftForSlot, getGanttTurnoConfigs, getGanttTurnoCode, renderGanttChart, renderGanttForActiveMode, getActiveGanttMode, printGanttLandscape.

**Regra de ouro:** ao extrair um bloco, (1) nunca deixe o modulo novo importar do ui.js; (2) redeclare refs DOM de modulo usadas pelo bloco; (3) use Python para mover codigo com acentos; (4) valide os DOIS sentidos de import; (5) teste NO BROWSER com dados reais (subir `python -m http.server` e clicar cada aba), pois node --check/--test nao pegam esses erros.


---

### FASE 5 — `js/calendarios_ui.js` (calendarios internos e visao docente)

**Risco:** medio. **Tamanho estimado:** ~1.400 linhas.

- `renderMonthlyCalendar` (7910)
- `getTeacherCalendarTurnoConfigs` (7930), `resolveTeacherShiftForSlot` (7938), `collectSlotsForTurnoValues` (7943), `getSlotsForTeacherShifts` (7968)
- `buildTurmaCalendarSlots` (7995)
- `formatConflictDateRange` (8065), `renderTeacherConflictRows` (8071), `renderTeacherCalendar` (8126)
- `buildCalendarTurmaResumeTable` (10286), `buildCalendarDocenteResumeTable` (10574), `generateCalendarGrid` (10765)

**Cuidados:** `generateCalendarGrid` e grande e usa muitos helpers (`getTurmaLabel`, `getHolidayLabelMap`, `getCalendarShiftBadgeHTML` etc.). Antes de mover, liste as dependencias; helpers usados TAMBEM por outras areas (ex.: `getCalendarShiftBadgeHTML`, linha 5178, e usado pela Grade Semanal?) devem permanecer no `ui.js` e ser importados — mas evite ciclo de import. Se houver ciclo, mova o helper para modulo neutro ou reporte.

Commit: `refactor(ui): extrai calendarios_ui.js`.

---

### FASE 6 — `js/conflitos_ui.js` (auditoria global de professores)

**Risco:** baixo/medio. **Tamanho estimado:** ~300 linhas. Bloco marcado no fonte como `==== NOVO MOTOR: AUDITORIA GLOBAL DE PROFESSORES ====`.

- `detectGlobalTeacherConflicts` (9989)
- `detectGlobalTeacherConflictsStable` (10083)
- `updateGlobalConflictsUI` (10215)
- `refreshTeacherConflictsUI` (10277)

Commit: `refactor(ui): extrai conflitos_ui.js (auditoria global)`.

---

### FASES FUTURAS (NAO EXECUTAR SEM APROVACAO HUMANA)

- **Lista de Ofertas** (`renderOfertasList`, 7431 — ~420 linhas): entrelacada com edicao de ofertas e estado de desenho.
- **Grade Semanal e faixas** (linhas ~744 a ~3427 + `renderWeeklyGrid` 6209 + `handleAddManual` 6928): concentra TODO o estado mutavel do modulo. So deve ser fatiada depois que as fases 1–6 estiverem estaveis, com plano proprio.
- **SIGAA/export** (`buildScopedSigaaAllocationFromOfferFaixa` 4847, `getSigaaCode` 4892, `exportSigaaMetadataJSON` 7857): envolve export publico consumido pelo `main.js`.
- **Plano letivo/PL** (4996–5596): mexe com estado de inicializacao.
- Casca final: reduzir `initUI` (5597) a orquestracao e remover exports mortos.

---

## 5. O que NUNCA mover do ui.js (nesta serie)

- `initUI` (5597) e tudo que ele referencia diretamente por closure.
- Qualquer funcao que leia/escreva: `activeFaixaIndex`, `faixasPatterns`, `editing*`, `drawingDragState`, `pendingFaixaStartPick`, `weeklyViewState`, `window.isDrawingFaixa`.
- As referencias DOM do topo do arquivo (`gridContainer`, `selCurso` etc.).
- `switchTab` (11109).
- `handleAddManual` (6928), `renderWeeklyGrid` (6209), `loadAllocationIntoEditor` (6765).

---

## 6. Procedimento padrao de cada extracao

1. `git status` deve estar limpo antes de comecar.
2. Localizar cada funcao da fase **pelo nome** (busca exata `function NOME(`).
3. Para cada funcao, listar identificadores externos que o corpo usa. Classificar cada um: (a) import ja existente no ui.js -> importar tambem no modulo novo; (b) funcao que TAMBEM sera movida nesta fase -> ok; (c) funcao/estado que fica no ui.js -> **avaliar risco de ciclo**; se o modulo novo precisar importar do ui.js, PARE e reporte (ciclo proibido).
4. Criar o arquivo novo com: os imports necessarios no topo (mesma convencao de sufixo dos originais quando importar de `store.js`/`calendar.js`; sem sufixo para modulos novos) e as funcoes copiadas byte a byte, com `export` adicionado.
5. Remover as funcoes do `ui.js` e adicionar o import correspondente no topo.
6. Buscar no projeto inteiro (nao so no ui.js) por usos dos nomes movidos para garantir que nada quebrou: `grep` por cada nome em `js/**` e nos HTML.
7. Rodar a verificacao (secao 7).
8. Commit com mensagem no padrao `refactor(ui): extrai <modulo>.js (<resumo>)`. **Um commit por fase. Nao fazer push** — o humano revisa e faz push.

---

## 7. Verificacao obrigatoria pos-extracao

1. `node --test tests/academic_rules.test.mjs` — deve passar 100%.
2. Checagem de sintaxe dos modulos alterados: `node --check js/ui.js` e `node --check js/<novo_modulo>.js`.
   - Obs.: `node --check` pode reclamar de ES modules dependendo da versao; alternativa: `node -e "import('./js/ui.js').catch(e=>{console.error(e);process.exit(1)})"` NAO funciona (usa DOM). Nesse caso, validar sintaxe com o editor/linter e seguir para o teste manual.
3. Abrir `index.html` via servidor local (ex.: `python -m http.server 8000`) e verificar no console do navegador que NAO ha erro de import/undefined.
4. Teste manual minimo por fase:
   - Fase 1: aparecer um toast (ex.: acao invalida) e botao "Copiar" da ajuda.
   - Fase 2: cores das barras/slots continuam identicas.
   - Fase 3: datas nas faixas, navegador de semana e rotulos continuam corretos.
   - Fase 4: aba do Gantt renderiza docente e turma; popover/modal de detalhes abre; impressao paisagem abre.
   - Fase 5: Calendario da Turma e Visao do Professor renderizam com badges de turno e tabela resumo.
   - Fase 6: painel de conflitos globais continua listando (ou vazio sem erro).
5. Se QUALQUER item falhar: `git checkout -- .` (descartar a rodada), registrar o motivo no relatorio e passar para a fase seguinte SOMENTE se a falha for especifica da fase atual.

---

## 8. Relatorio final esperado do executor

Ao terminar (ou interromper), produzir um resumo com:
- fases concluidas e hash de cada commit;
- funcoes que NAO puderam ser movidas e por que (dependencia de estado, risco de ciclo etc.);
- contagem de linhas do `ui.js` antes e depois;
- qualquer comportamento estranho observado no teste manual.
