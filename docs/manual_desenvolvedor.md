# Manual Tecnico do Desenvolvedor - Cardume Planejador Academico (IECOS)

**Versao do sistema:** 3.3
**Status:** estavel em producao, com refatoracao estrutural em andamento
**Stack:** HTML5, CSS3, JavaScript ES modules, Python ETL, `localStorage`

---

## 1. Visao geral

O Cardume e um app web offline-first para montagem de grades academicas. O sistema roda 100% no navegador e usa uma combinacao de:

- `dados_app.json` como base estatica institucional;
- `localStorage` como persistencia local do trabalho da coordenacao;
- um modelo canonico por **faixas** para execucao, conflitos, visualizacao e exportacao.

O principio atual do produto e:

> **toda oferta deve ser tratada como oferta por faixas**

Isso vale para Grade Semanal, Lista de Ofertas, calendario, exportacoes e SIGAA.

---

## 2. Pilares tecnicos

### 2.1. Persistencia local

O sistema salva o trabalho diretamente no navegador do usuario. A persistencia principal fica em:

- `academic_settings`
- `academic_plan_index_v1`
- `academic_plan_v1::<chave_do_plano>`

O estado nao fica mais concentrado em um unico repositario global de alocacoes. Cada plano letivo possui sua propria area de armazenamento.

### 2.2. Fonte de dados estatica

Toda a estrutura institucional vem de `dados_app.json`, gerado a partir de `dados/planilha_base.xlsx` pelo script `tools/convert_data.py`.

Esse JSON hoje inclui:

- `meta`
- `docentes`
- `cursos`
- `componentes`
- `turmas`
- `horarios`
- `horarios_por_turno`
- `feriados`
- `periodos_letivos`

### 2.3. Modelo unico por faixas

Faixa significa:

> **regime de funcionamento em um intervalo de datas**

Regras:

- cada data da execucao pertence a uma faixa vigente;
- quando uma nova faixa comeca, ela substitui a faixa anterior a partir daquela data;
- o usuario desenha explicitamente os slots da nova faixa;
- CH, conflitos, calendario e exportacoes derivam da execucao real calculada a partir dessas faixas.

---

## 3. Estrutura do repositorio

```text
/gestor-iecos
|-- css/
|   `-- style.css
|-- dados/
|   `-- planilha_base.xlsx
|-- docs/
|   `-- manual_desenvolvedor.md
|-- img/
|-- js/
|   |-- agenda_discente.js
|   |-- agenda_docente.js
|   |-- calendar.js
|   |-- main.js
|   |-- plan_storage.js
|   |-- store.js
|   |-- ui.js
|   `-- utils.js
|-- tools/
|   |-- convert_data.py
|   |-- publish_online.py
|   `-- requirements.txt
|-- agenda_discente.html
|-- agenda_docente.html
|-- alocacoes_publicas.json
|-- dados_app.json
|-- index.html
`-- README.md
```

### Responsabilidades principais

- `tools/convert_data.py`: converte o Excel institucional para `dados_app.json`.
- `js/plan_storage.js`: normalizacao de periodo letivo e persistencia por plano.
- `js/store.js`: estado principal, leitura do JSON e gravação das alocacoes no plano ativo.
- `js/ui.js`: fluxo principal da interface, Grade Semanal, Lista de Ofertas, conflitos e exportacoes.
- `js/calendar.js`: renderizacao de calendario a partir da execucao real.
- `js/main.js`: bootstrap, importacao/exportacao e publicacao.

---

## 4. Modelo de dados

### 4.1. Periodos letivos oficiais

O app passou a consumir periodos oficiais a partir da aba `periodos_letivos` do Excel.

Estrutura esperada:

| coluna | descricao |
|---|---|
| `ano` | ano institucional |
| `periodo_letivo` | codigo como `PL1`, `PL2`, `PL3`, `PL4` |
| `inicio` | inicio oficial do periodo |
| `fim` | fim oficial do periodo |

No `dados_app.json`, o bloco resultante tem o formato:

```json
{
  "ano": 2026,
  "periodo_letivo": "PL2",
  "inicio": "2026-03-23",
  "fim": "2026-07-23",
  "label": "2026 - PL2"
}
```

### 4.2. Chave do plano letivo

O plano ativo e identificado por:

```text
PLx__YYYY-MM-DD__YYYY-MM-DD
```

Exemplo:

```text
PL2__2026-03-23__2026-07-23
```

Essa chave e usada para:

- isolar alocacoes por periodo letivo;
- indexar o historico de planos locais;
- escopar `lastStartByTurma`;
- amarrar importacao, exportacao, publicacao e metadados SIGAA ao plano correto.

### 4.3. Compatibilidade legada

O sistema continua entendendo codigos antigos como `1P`, `2P`, `3P`, `4P`, mas os normaliza internamente para `PL1`, `PL2`, `PL3`, `PL4`.

---

## 5. Fluxo do usuario no app

### 5.1. Sidebar

Ordem esperada de uso:

1. selecionar o **Periodo Letivo**;
2. deixar o app preencher `Inicio` e `Fim` automaticamente;
3. selecionar o **Turno**;
4. selecionar **Curso**;
5. selecionar **Turma**;
6. selecionar componente, cor e docente(s).

O periodo letivo da sidebar nao deve ser tratado como campo livre. Ele vem do cadastro oficial do Excel/JSON.

### 5.2. Grade Semanal

A Grade Semanal e o centro operacional do sistema. O fluxo canonico atual e:

1. definir a data de inicio da `Faixa 1`;
2. desenhar os slots por clique ou arraste;
3. criar `Faixa 2` ou `Faixa 3` se o regime mudar;
4. salvar a componente;
5. usar a Lista de Ofertas apenas para revisao, edicao e exclusao.

Regras importantes:

- nova faixa substitui a anterior a partir de sua data de inicio;
- nao ha heranca automatica de slots entre faixas;
- a nova faixa so passa a ter slots depois que o usuario os desenha;
- a CH mostrada na tabela de faixas deve bater com a execucao real.

### 5.3. Faixa final automatica

Ao salvar uma componente, o sistema pode criar automaticamente a `Faixa 2` quando:

- o ultimo dia fica quebrado por truncamento de CH; ou
- os dois ultimos dias reais de aula ja nao seguem o regime principal da `Faixa 1`.

Nesse caso:

- a `Faixa 2` cobre do penultimo ao ultimo dia real de aula;
- o salvamento continua no mesmo clique;
- se o usuario fizer novos ajustes depois, precisa salvar novamente.

### 5.4. Lista de Ofertas

A Lista de Ofertas tem funcao administrativa e de revisao. O comportamento esperado atual e:

- ordenar componentes alfabeticamente;
- manter faixas da mesma componente consecutivas;
- usar separador fino entre faixas da mesma componente;
- usar separador mais forte entre componentes diferentes;
- nao agrupar mais por mes.

### 5.5. Calendario e visoes

- **Calendario da Turma**: leitura do cronograma final da turma.
- **Visao do Professor**: leitura e auditoria de ocupacao docente.
- **Gantt**: leitura temporal do semestre por docente/equipe.

Essas telas devem consumir a mesma base canonica de execucao.

---

## 6. Conflitos

### 6.1. Formula canonica

Um conflito real existe apenas quando houver:

1. sobreposicao de periodo;
2. sobreposicao de dia da semana;
3. sobreposicao de slot.

Formula:

`conflito = overlap(periodo) AND overlap(dia) AND overlap(slot)`

### 6.2. Escopos

| Escopo | Regra | Bloqueia? |
|---|---|---|
| Turma | duas ofertas com intersecao de periodo + dia + slot | Sim |
| Turma | mesmo slot em dias diferentes | Nao |
| Turma | periodos sem sobreposicao | Nao |
| Professor global | mesmo professor em turmas diferentes com intersecao de periodo + dia + slot | Sim |
| Professor global | mesmo slot em dias diferentes | Nao |
| Professor "A definir" | sem identificacao docente definitiva | Nao |

---

## 7. Bloco curricular da turma

O rotulo automatico da turma continua usando o bloco curricular derivado do PPC. A funcao `derivarBloco(turmaId, periodo, termStart)` hoje trabalha com os codigos `PLx`.

Regra:

```text
anoEntrada = ultimos 4 digitos do turmaId
anoRef = ano de termStart
anosDecorridos = anoRef - anoEntrada

periodo = PL2 -> bloco = (2 x anosDecorridos) + 1
periodo = PL4 -> bloco = (2 x anosDecorridos) + 2
periodo = PL1 ou PL3 -> retorna '' (periodos curtos)
```

Exemplos:

| Turma | Periodo | Bloco | Exibicao |
|---|---|---|---|
| EP2026 | PL2 | BL1 | `EP2026_BL1` |
| EP2026 | PL4 | BL2 | `EP2026_BL2` |
| EP2025 | PL2 | BL3 | `EP2025_BL3` |
| CB2024 | PL2 | BL5 | `CB2024_BL5` |

Se `subGrupo` existir, ele tem prioridade sobre a derivacao automatica.

---

## 8. ETL e manutencao de dados

### 8.1. Abas esperadas no Excel

O arquivo `dados/planilha_base.xlsx` deve conter:

- `docentes`
- `componentes`
- `turmas`
- `cursos`
- `horarios`
- `feriados`
- `periodos_letivos`

### 8.2. Conversao Excel -> JSON

Com o ambiente Python ativo:

```bash
python tools/convert_data.py
```

O script:

- le o Excel institucional;
- normaliza horarios e intervalos;
- gera `horarios_por_turno`;
- converte feriados para ISO;
- gera `periodos_letivos`;
- salva `dados_app.json`.

### 8.3. Mudanca de semestre

Nao e mais necessario editar datas padrao no `index.html`.

O procedimento correto agora e:

1. atualizar a aba `periodos_letivos` no Excel;
2. rodar `python tools/convert_data.py`;
3. validar `dados_app.json`;
4. abrir o app e selecionar o novo periodo letivo na sidebar.

---

## 9. Importacao, exportacao, SIGAA e publicacao

### 9.1. Importacao e exportacao local

- o backup JSON representa o plano ativo;
- a importacao deve respeitar o plano letivo selecionado;
- mesclagens entre diretorias devem ser feitas com atencao ao plano institucional correto.

### 9.2. Exportacao SIGAA

Os metadados para o SIGAA devem sair do **plano letivo ativo**, porque o cadastro institucional e feito por periodo letivo.

Consequencias:

- o export nao deve misturar semestres;
- o payload deve carregar `periodoLetivo`, `termStart` e `termEnd`;
- a base de execucao usada no SIGAA deve ser a mesma da Grade Semanal.

### 9.3. Publicacao online

Fluxo:

1. clicar em **Publicar Online** no app;
2. executar `python tools/publish_online.py`;
3. opcionalmente publicar com `python tools/publish_online.py --push`.

Arquivos envolvidos:

- `alocacoes_publicas.json`
- `agenda_discente.html`
- `agenda_docente.html`

---

## 10. Diretrizes de refatoracao em curso

Direcoes ja assumidas:

- preservar o comportamento funcional maduro do produto;
- remover regras espalhadas e remendos da UI;
- concentrar logica temporal e de conflitos em nucleo compartilhado;
- tratar Grade Semanal como principal ponto de entrada operacional;
- manter Lista de Ofertas como painel de revisao;
- preparar exportacoes e publicacao para evolucoes futuras sem reabrir a arquitetura.

Itens ainda em observacao tecnica:

- limpeza final de nomenclaturas internas legadas;
- extracao mais explicita do motor canonico de execucao;
- evolucao futura da agenda docente publica.
