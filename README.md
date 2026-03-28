# Cardume - Planejador Academico | IECOS/UFPA

![Logo do Projeto](img/logo_cardume.png)

Sistema web para montagem, revisao e publicacao de grades academicas do IECOS/UFPA. O app roda no navegador, usa `localStorage` como persistencia local e trabalha com um modelo canonico por faixas.

Link publico do sistema:
- https://astuciasnor.github.io/gestor-iecos/

Documentacao tecnica:
- [`docs/manual_desenvolvedor.md`](docs/manual_desenvolvedor.md)

---

## Funcionalidades principais

- **Periodos letivos oficiais:** o seletor lateral consome `periodos_letivos` do `dados_app.json` e preenche automaticamente inicio e fim do periodo.
- **Persistencia por plano letivo:** cada combinacao `periodo + inicio + fim` e salva separadamente no navegador.
- **Grade Semanal como centro operacional:** toda marcacao de slots, datas e faixas acontece na aba **Grade Semanal**.
- **Faixas como modelo unico:** cada faixa representa um regime de funcionamento em um intervalo de datas.
- **Fechamento automatico da faixa final:** quando os dois ultimos dias reais de aula fogem do regime principal, o sistema cria automaticamente a `Faixa 2` para manter a estrutura consistente.
- **Conflitos canonicos:** so existe conflito real com sobreposicao simultanea de periodo, dia da semana e slot.
- **Lista de Ofertas organizada para revisao:** componentes em ordem alfabetica, faixas consecutivas e separacao visual entre faixas e entre componentes.
- **Calendario da turma, visao docente e Gantt:** o app usa a mesma base de execucao para leitura e auditoria.
- **Exportacao/importacao e publicacao online:** backups, JSON publico e metadados SIGAA partem do plano letivo ativo.

---

## Fluxo de uso

### 1. Configuracao inicial

1. Abra o sistema no navegador.
2. Selecione o **Periodo Letivo** oficial na lateral. O app preenche automaticamente as datas de inicio e fim.
3. Escolha o **Turno**, depois o **Curso** e a **Turma**.

### 2. Montagem da grade

1. Selecione a componente, a cor e o(s) docente(s) na lateral.
2. Va para a aba **Grade Semanal**.
3. Defina o inicio da `Faixa 1` clicando no primeiro slot do dia desejado.
4. Desenhe os slots diretamente na grade.
5. Se precisar mudar o regime ao longo do periodo, crie a `Faixa 2` ou `Faixa 3` e desenhe explicitamente o novo padrao.
6. Clique em **Salvar Componente**.

### 3. Revisao e administracao

- Use a aba **Lista de Ofertas** para revisar, editar ou excluir ofertas.
- A lista e exibida em ordem alfabetica por componente.
- Faixas da mesma componente aparecem uma abaixo da outra.
- A **Lista de Ofertas** nao e lugar de desenhar slots; isso fica restrito a **Grade Semanal**.

### 4. Publicacao e exportacoes

- **Exportar JSON:** gera backup do plano letivo ativo.
- **Importar JSON:** restaura ou mescla dados no contexto do plano selecionado.
- **Exportar Metadados SIGAA:** gera os metadados do plano ativo, no recorte institucional correto do periodo letivo.
- **Publicar Online:** gera `alocacoes_publicas.json` para a agenda publica.

---

## Modelo canonico

### Faixa

Faixa significa:

> **regime de funcionamento em um intervalo de datas**

Regra operacional:

- a nova faixa substitui a faixa anterior a partir de sua data de inicio;
- o fim da faixa anterior e ajustado automaticamente;
- os slots da nova faixa so existem se forem desenhados pelo usuario;
- o calculo de CH, conflitos e exportacoes parte da execucao real gerada por essas faixas.

### Conflitos

Um conflito real existe somente quando houver, ao mesmo tempo:

1. sobreposicao de periodo;
2. sobreposicao de dia da semana;
3. sobreposicao de slot.

Formula:

`conflito = overlap(periodo) AND overlap(dia) AND overlap(slot)`

---

## Dados e manutencao

O arquivo `dados_app.json` e gerado a partir de `dados/planilha_base.xlsx` pelo script:

```bash
python tools/convert_data.py
```

Abas principais esperadas no Excel:

- `docentes`
- `componentes`
- `turmas`
- `cursos`
- `horarios`
- `feriados`
- `periodos_letivos`

A aba `periodos_letivos` e a fonte oficial dos periodos institucionais. Exemplo:

| ano | periodo_letivo | inicio | fim |
|---|---|---|---|
| 2026 | PL1 | 05/01/2026 | 06/03/2026 |
| 2026 | PL2 | 23/03/2026 | 23/07/2026 |

Observacao importante:

- o app nao depende mais de datas padrao escritas manualmente no `index.html`;
- o seletor lateral passa a consumir os periodos oficiais gerados no JSON.

---

## Publicacao online

1. No app, clique em **Publicar Online**.
2. No terminal, execute:

```bash
python tools/publish_online.py
```

Para publicar no GitHub Pages:

```bash
python tools/publish_online.py --push
```

URLs publicas:
- https://astuciasnor.github.io/gestor-iecos/
- https://astuciasnor.github.io/gestor-iecos/alocacoes_publicas.json

---

## Estado atual da refatoracao

Diretrizes ja consolidadas:

- periodos letivos oficiais `PL1..PL4` vindos do Excel/JSON;
- armazenamento por plano letivo;
- Grade Semanal como unico ponto de desenho de slots;
- Lista de Ofertas como painel de revisao;
- exportacoes e publicacao apoiadas no plano ativo;
- modelo unico por faixas, sem depender da UX antiga de tipos de oferta.
