# Manual Técnico do Desenvolvedor — Gestor Acadêmico IECOS

**Versão:** 1.0 (Fevereiro 2026)  
**Responsável:** Prof. Dr. Evaldo Silva

---

## 1. Visão Geral da Arquitetura
Este projeto segue a filosofia **"Serverless & Offline-First"**. Não há backend, banco de dados SQL ou instalação complexa. Todo o processamento ocorre no navegador do cliente (Client-Side) usando JavaScript puro (ES6 Modules).

### Pilares Técnicos:
1.  **Persistência:** `localStorage` do navegador. Os dados sobrevivem ao fechamento da aba.
2.  **Fonte de Dados:** Arquivo estático `dados_app.json`, gerado a partir de uma planilha Excel (`planilha_base.xlsx`) via script Python.
3.  **Portabilidade:** A pasta do projeto pode ser enviada por ZIP, Pendrive ou hospedada no GitHub Pages sem configuração extra.

---

## 2. Estrutura de Arquivos e Responsabilidades

* **`index.html`**: O esqueleto. Contém a Sidebar (configurações) e as Sections (abas) ocultas/exibidas via CSS.
* **`css/style.css`**: Design visual. Uso extensivo de Grid CSS para a grade horária e Flexbox para layouts. Define as regras de impressão (`@media print`).
* **`js/store.js`**: O "Banco de Dados" em memória.
    * Gerencia o array `allocations` (onde ficam as aulas criadas).
    * Gerencia o salvamento/carregamento no `localStorage`.
    * Lida com a lógica de Importar/Exportar e Mesclar JSONs.
* **`js/ui.js`**: O "Controlador" (Lógica de Tela).
    * Escuta os cliques na grade e botões.
    * Lida com a lógica de inserção manual (validação de formulário).
    * Contém a **Lógica de Atualização Inteligente** (update vs insert).
* **`js/calendar.js`**: O "Renderizador Lógico".
    * Transforma as alocações abstratas em eventos de calendário reais (dia a dia).
    * **Ponto Crítico:** É aqui que reside a lógica de "Soberania da Sala" (ver seção 4).
* **`js/utils.js`**: Funções puras (cálculo de datas, dias úteis, contagem de feriados).

---

## 3. Fluxo de Dados (Data Pipeline)

1.  **Entrada:** O usuário edita `planilha_base.xlsx` (Excel).
2.  **Processamento:** O script `convert_data.py` lê o Excel e cospe o `dados_app.json`.
3.  **Consumo:** O `js/store.js` faz um `fetch('dados_app.json')` ao iniciar.
4.  **Operação:** O usuário cria alocações. Elas são salvas no array `allocations` e persistidas no `localStorage`.
5.  **Saída:** O usuário clica em "Exportar JSON" para gerar um backup ou enviar para a secretaria.

> **Cuidado:** Se você mudar o nome de uma coluna no Excel, precisará atualizar o `convert_data.py`. Se mudar a estrutura do JSON, pode quebrar o `ui.js`.

---

## 4. Lógicas Críticas (O "Pulo do Gato")

### 4.1. Soberania da Sala (Supressão de Regulares)
*Arquivo: `js/calendar.js`*
Para evitar falsos positivos de choque, o sistema usa a regra: **"A Ocupação Física da Sala é Soberana"**.
1.  Antes de desenhar as aulas do dia, o script varre todas as **Intensivas** ativas na data.
2.  Ele cria um mapa de `blockedSlotsByTurma`.
3.  Ao tentar desenhar uma aula **Regular**, ele checa: *"A sala desta turma está bloqueada neste horário por uma intensiva?"*
4.  Se sim, a aula Regular **não é renderizada** (é suprimida).
    * *Resultado:* O professor da regular aparece "livre" naquele dia, permitindo que ele pegue outra aula (ou dê a própria intensiva) sem gerar alerta de choque visual.

### 4.2. Atualização vs. Inserção
*Arquivo: `js/ui.js` -> `handleAddManual`*
Ao tentar inserir uma disciplina Intensiva:
1.  O sistema busca conflitos.
2.  Se encontrar um conflito com a **mesma disciplina** na **mesma turma**:
    * Ele entende como uma intenção de **Edição**.
    * Pergunta ao usuário: *"Deseja atualizar?"*.
    * Se SIM: Remove a alocação antiga e insere a nova imediatamente. Isso facilita ajustes de carga horária (ex: mudar de 5 slots para 3 slots).

### 4.3. Coexistência (Slots Livres)
O sistema **não** bloqueia o dia inteiro por padrão.
* Se uma Intensiva ocupa das 10:00 às 12:00.
* Os horários das 07:30 às 10:00 **continuam livres** para receber aulas Regulares.
* *Nota:* Se quiser mudar isso para "Bloqueio Total do Dia", a alteração deve ser feita no `calendar.js` (verificar presença de intensiva no dia e ignorar horário).

---

## 5. Manutenção e Evolução

### Como adicionar novos campos?
1.  Adicione a coluna no Excel.
2.  Edite o `convert_data.py` para ler essa coluna e incluí-la no JSON.
3.  No `js/ui.js`, capture esse dado onde necessário (ex: renderização da tabela).

### Cuidados ao Atualizar
* **Limpar Tudo:** Sempre teste novas versões clicando em "Limpar Tudo" para garantir que não há lixo de versões anteriores no `localStorage`.
* **IDs:** As alocações usam UUIDs gerados no frontend. Não tente criar IDs sequenciais manuais.

### Lista de Tarefas Futuras (Roadmap v2.0 - Ideias)
* [ ] Validação pedagógica: Impedir regular no mesmo dia de intensiva (Bloqueio Total).
* [ ] Relatório de Carga Horária Docente consolidado.
* [ ] Modo Escuro (Dark Mode).

---

## 6. Organização de Pastas Recomendada
/gestor-iecos
│
├── index.html          (App)
├── dados_app.json      (Dados Compilados)
├── planilha_base.xlsx  (Dados Brutos - Editável)
├── convert_data.py     (Script Conversor)
│
├── css/
│   └── style.css
│
├── js/
│   ├── main.js
│   ├── ui.js
│   ├── store.js
│   ├── calendar.js
│   └── utils.js
│
├── img/                (Logos)
└── docs/
   └── MANUAL_DESENVOLVEDOR.md