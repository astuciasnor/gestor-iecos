# Roteiro de testes — Sugestão inteligente de início (despacho pela última componente)

Implementação: `resolveSmartComponentStartSuggestion()` em `js/ui.js` (cache v60).
Contexto de teste: **turma CB2025 (Tarde, regime 2 = 5 aulas/dia)**, período **2026-PL4 (24/08 a 23/12/2026)**, pendentes do 5º bloco (CBBR026–033).

O regime 2 vale para o curso CB a partir da vigência 24/08/2026 (início do PL4).
Turno Tarde (regime 2): `14:00 · 14:50 · 15:40 · [intervalo] · 16:50 · 17:40`.
Slots de **encaixe**: `14:00` (1ª aula) e `16:50` (4ª aula = 1ª após o intervalo).
Metade baixa = 3 aulas (14:00–16:30) · metade alta = 2 aulas (16:50–18:30) → pares **3+2**.

**Atenção à capacidade**: PL4 tem 81 dias letivos (88 dias úteis − 7 feriados) × 5 aulas = **405h**. As 8 componentes somam **exatamente 405h** — o encaixe precisa ser perfeito, sem slot desperdiçado. A ordem abaixo fecha a conta (36 dias de turno inteiro + 45 dias de escada 3+2). A única sobra inevitável é o meio-dia final da Psicologia (45h ÷ 2 aulas = 22,5 dias): ~1h pode escorregar 1 dia além de 23/12; se quiser folga, habilite sábado em uma das componentes.

---

## Parte 1 — Testes das regras (executar em sequência, turma zerada no PL4)

Cada passo é também a **ordem de alocação recomendada**. Anote a data/slot que o sistema sugerir e compare com o esperado.

| # | Componente | CH | Desenho recomendado | Regra testada | Sugestão esperada |
|---|-----------|----|--------------------|---------------|-------------------|
| 1 | MORFOLOGIA VEGETAL (CBBR026) | 75h | 5 aulas/dia (turno inteiro) → 15 dias | **Caso zero** (turma vazia) | 24/08 (seg), célula 14:00 destacada |
| 2 | GEOMORFOLOGIA COSTEIRA (CBBR029) | 60h | 5 aulas/dia (turno inteiro) → 12 dias | **Regra 1a**: última é turno inteiro → dia útil após o fim | ~15/09, 14:00 (07/09 é feriado; conferir pulo) |
| 3 | SOCIOLOGIA, EDUCAÇÃO E CIDADANIA (CBBR030) | 45h | 5 aulas/dia (turno inteiro) → 9 dias | **Regra 1a** de novo | Dia útil após Geomorfologia, 14:00 |
| 4 | METODOLOGIA DO ENSINO DE C. E B. (CBBR027) | 60h | 3 aulas baixas (14:00–16:30) → 20 dias | **Regra 1a** (fim do bloco de turno inteiro) | Dia útil após Sociologia, 14:00 |
| 5 | PSICOLOGIA DA APRENDIZAGEM (CBBR032) | 45h | 2 aulas altas (16:50–18:30) → 22,5 dias | **Regra 1b + b**: última é meio turno → mesmo dia da F1 dela, encaixe complementar | **Mesmo dia da F1 da Metodologia**, célula **16:50** destacada (par 3+2) |
| 6 | INTRODUÇÃO À GEOLOGIA (CBBR028) | 45h | 3 aulas baixas → 15 dias | **Escada**: par M+P fechado no início, mas Metodologia (20d) acaba antes da Psicologia (23d) | Dia útil após o fim da Metodologia, **14:00** (baixa liberada; alta ainda ocupada) |
| 7 | LIBRAS II (CBBR033) | 45h | 2 aulas altas → 22,5 dias | **Escada** (espelho): última é Geologia (baixa); alta libera quando Psicologia acaba | Dia útil após o fim da Psicologia, **16:50** |
| 8 | HISTÓRIAS DE VIDA E F. DOCENTE (CBBR031) | 30h | 3 aulas baixas → 10 dias | **Escada**: baixa libera quando Geologia acaba | Dia útil após o fim da Geologia, **14:00** |

Fechamento esperado: 81 dias letivos ≈ término em 23/12/2026, colado no fim do PL4 (ver nota de capacidade acima).

Em **cada** passo, verificar também:
- A Grade Semanal **pula para a semana da data sugerida** ao escolher a disciplina (ou clicar Editar na pendente).
- A **célula sugerida** aparece com borda laranja pontilhada e pulso.
- A **nota de contexto** mostra "Encaixe sugerido: aula das HH:MM".
- Pendentes (botão Editar) e inserção individual (digitar a disciplina) sugerem a **mesma** data/slot.

## Parte 2 — Testes dos pontos cegos

| # | Cenário | Como provocar | Esperado |
|---|---------|---------------|----------|
| B1 | **Gap anterior — só avisar** | Após o passo 4, excluir a Geologia (passo 2) e inserir nova componente | Toast "Há espaço livre em … antes da última componente"; sugestão **mantida** após a última (não posiciona no gap) |
| B2 | **Edição não re-ancora** | Editar (duplo clique/botão) uma componente já alocada do meio da sequência | Datas originais preservadas; sugestão não salta para depois da última |
| B3 | **Metade parcialmente ocupada = fechada** | Com par 3+2 em que sobra só a 17:40 (16:50 ocupado) | Dia é pulado; sugestão cai após o fim do par |
| B4 | **Feriados/fins de semana** | Sugestões próximas a 07/09, 12/10, 02/11, 20/11 e SIEPE (30/11–02/12) | Nunca sugerir feriado, domingo, nem sábado (turma não usa sábado) |
| B5 | **Esgotamento** | Preencher o PL4 e tentar inserir mais uma componente | Toast "Nenhum slot de encaixe livre até o fim do período letivo"; data volta ao início do período |
| B6 | **Empate de F1 (par mesmo dia)** | Após passo 3 (Geologia+Libras começam juntas), inserir a próxima | Cai na regra c (após o par), sem erro |
| B7 | **Desenhar além da metade** | No passo 6, desenhar 4+ aulas em vez de 3 | Ao salvar, aviso de conflito e reposicionamento em sequência (comportamento do empilhamento, já existente) |
| B8 | **Turno combinado (regra d)** | Em turma "Manhã e Tarde": alocar intensiva que lote só a manhã; inserir nova | Sugestão no **mesmo dia**, 1º slot da **tarde** |

## O que mudou no código (referência)

- `getComponentStartCandidateSlots()`: encaixes = 1ª **e** 4ª aula de **cada** turno presente (antes, combinados só usavam a 1ª de cada turno).
- `getLastPlannedComponentForCurrentTurma()`: "última" = maior início de **Faixa 1** (não a ordem de inserção); ignora pendentes e componente em edição.
- `resolveSmartComponentStartSuggestion()`: âncora na F1 da última + varredura por encaixe livre → devolve `{data, slot}`; fallback re-varre do início do semestre; `gapBefore` (só aviso) e `exhausted` (aviso).
- `getPreferredStartDateForCurrentTurma` / `getPreferredPendingStartDateForCurrentTurma`: delegam ao resolvedor único (Pendentes e inserção individual agora idênticos).
- Destaque visual da célula sugerida (`.slot-start-suggestion`, css) + slot na nota de contexto.
- Cache: `main.js`/`ui.js` → v60; `style.css` → v10.
