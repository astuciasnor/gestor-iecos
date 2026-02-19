# 📘 Manual Técnico do Desenvolvedor — Gestor Acadêmico IECOS

**Versão do Sistema:** 2.0 (Release Final - Fevereiro 2026)  
**Status do Projeto:** 🟢 Estável / Em Produção  
**Responsável Técnico:** Prof. Dr. Evaldo Silva  
**Tecnologia:** Vanilla JavaScript (ES6+), HTML5, CSS3 Grid/Flexbox, Python (ETL)

---

## 1. 🌐 Visão Geral e Filosofia da Arquitetura

Este projeto foi concebido seguindo a filosofia de arquitetura **"Serverless & Offline-First"**. Ao contrário de sistemas acadêmicos tradicionais que dependem de servidores pesados, bancos de dados SQL complexos e instalação de backends, o Gestor Acadêmico IECOS roda **100% no navegador do cliente (Client-Side)**.

### 🚀 Pilares Técnicos Fundamentais:

1.  **Persistência Local (Local Storage):**
    * O "banco de dados" é o próprio navegador do usuário. Utilizamos a API `localStorage` para salvar o estado da aplicação (alocações, configurações de data, turno e período).
    * **Vantagem:** Os dados sobrevivem ao fechamento da aba ou reinício do computador sem necessidade de login em nuvem.
    * **Segurança:** Os dados ficam restritos ao dispositivo do usuário, garantindo privacidade e velocidade instantânea.

2.  **Fonte de Dados Estática (Master Data):**
    * Toda a inteligência de Cursos, Turmas, Disciplinas, Cargas Horárias e Docentes provém de um arquivo estático: **`dados_app.json`**.
    * Este JSON é gerado a partir de uma planilha Excel (`dados/planilha_base.xlsx`) processada por um script Python (`tools/convert_data.py`), garantindo que a secretaria possa gerenciar os dados em uma ferramenta familiar (Excel) antes de subir para o sistema.

3.  **Modularidade (ES6 Modules):**
    * O código JavaScript é dividido em módulos com responsabilidades únicas (`import`/`export`), facilitando a manutenção e a escalabilidade sem criar um "código espaguete".

---

## 2. 📂 Estrutura de Arquivos e Responsabilidades ("A Anatomia")

Abaixo, detalhamos a função vital de cada arquivo no ecossistema do projeto:

### 🖥️ Camada de Interface (View)
* **`index.html`**: O esqueleto da aplicação.
    * Contém a estrutura das abas (Tabs), a barra lateral (Sidebar) com os seletores de **Período (1P-4P)**, e as áreas de renderização.
    * Implementa o script de **Login de Sessão** (`sessionStorage`) para proteção básica de acesso.
* **`css/style.css`**: A pele do projeto.
    * Utiliza **CSS Grid** para desenhar a grade horária com precisão matemática.
    * Define as regras de impressão (`@media print`) para garantir que os relatórios em PDF saiam limpos, coloridos e sem elementos de interface (botões, menus).

### 🧠 Camada de Lógica (Controller & Model)
* **`js/store.js` (O "Cérebro"):**
    * Atua como o **Gerenciador de Estado Global** (State Management).
    * Mantém o array `allocations[]` com todas as aulas criadas.
    * Gerencia o objeto `settings` (datas, turno, e o novo campo **período**).
    * Contém a lógica de persistência (`saveAllocations`, `loadAllocations`).
* **`js/ui.js` (O "Maestro"):**
    * Faz a ponte entre o HTML e o JavaScript.
    * Gerencia todos os **Event Listeners** (cliques, mudanças de input).
    * Contém a lógica visual crítica de renderização da grade semanal (`renderWeeklyGrid`).
    * Monitora o seletor de período para garantir que o arquivo exportado tenha o nome correto.
* **`js/calendar.js` (O "Matemático"):**
    * O motor de cálculo de datas. Transforma uma alocação abstrata ("Segunda-feira") em dias reais do calendário (ex: "14/02, 21/02").
    * Calcula a Carga Horária Efetiva descontando feriados.
* **`js/main.js` (O "Porteiro"):**
    * Inicializa a aplicação (`DOMContentLoaded`).
    * Gerencia a **Exportação Dinâmica** e a **Importação/Mesclagem** de arquivos JSON.

---

## 3. 🔄 Fluxo de Dados (Data Pipeline)

Entenda como a informação viaja dentro do sistema:

1.  **Entrada (Excel):** A coordenação atualiza a planilha base com novos professores ou disciplinas.
2.  **Transformação (Python):** O script `convert_data.py` é executado. Ele lê o Excel, valida os dados e "cospe" o arquivo `dados_app.json` diretamente na raiz.
3.  **Carregamento (Fetch):** Ao abrir o site, o `store.js` carrega o `dados_app.json` para a memória RAM.
4.  **Interação (UI):** O usuário seleciona "Curso" -> "Turma" -> "Disciplina".
5.  **Processamento:** O `ui.js` valida choques de horário e chama `store.addAllocation()`.
6.  **Persistência:** O `store.js` salva o novo estado no `localStorage` instantaneamente.
7.  **Saída (Export):** O usuário clica em "Exportar". O `main.js` lê a configuração atual (Sigla + Ano + Período) e gera um arquivo JSON (ex: `EP_2026_2P.json`) para backup ou compartilhamento.

---

## 4. 💎 Lógicas Críticas da Versão 2.0 (O "Pulo do Gato")

Esta versão introduziu conceitos avançados para lidar com a realidade acadêmica complexa:

### 4.1. 👑 Hierarquia de Soberania (Prioridades de Slot)
O sistema não trata todas as aulas da mesma forma. Existe uma hierarquia visual e lógica para ocupação da sala:
* 🥇 **Nível 1 - Regular Prioritária:** É a "dona" do horário. Bloqueia visualmente o slot com uma borda roxa/tracejada preta e **impede** que intensivas sejam alocadas ali sem aviso.
* 🥈 **Nível 2 - Intensiva (Blocada):** Tem poder de "usurpar" o espaço de uma Regular Comum. Se alocada sobre uma regular, a intensiva aparece na grade da turma e a regular é "escondida" temporariamente.
* 🥉 **Nível 3 - Regular Comum:** Ocupação padrão. Cede espaço automaticamente para Intensivas.

### 4.2. ⏳ Carga Horária com Deslocamento (Shift Logic)
Diferente da versão 1.0, onde uma aula suspensa era "perdida", a v2.0 é inteligente:
* Se uma **Intensiva** suspende uma aula **Regular** no dia 15/03...
* O sistema **não contabiliza** as horas dessa regular no dia 15/03.
* Automaticamente, o sistema busca a próxima data disponível (ex: 22/03) e continua a contagem até atingir a Carga Horária total (ex: 60h). Isso garante que o planejamento pedagógico seja real.

### 4.3. 👁️ Visão Dual (Contexto Turma vs. Contexto Professor)
A interface se adapta dependendo de quem está olhando (Abas no `index.html`):
* **Aba Grade/Calendário da Turma:** Foca na **Ocupação Física da Sala**. Mostra quem está dando aula *naquela sala*. Se houver conflito, mostra a Intensiva (soberana).
* **Aba Visão do Professor:** Foca na **Agenda Pessoal**. Se a aula dele foi suspensa por uma intensiva de outro colega, o sistema exibe explicitamente um card cinza: `⛔ [Disciplina] Suspensa`. Isso avisa ao docente que ele está liberado naquele dia.

---

## 5. 🛠️ Guia de Manutenção e Evolução

### Como adicionar um novo campo de configuração?
Se no futuro for necessário adicionar, por exemplo, um filtro por "Semestre Par/Ímpar":

1.  **HTML (`index.html`):** Adicione o `<select id="sel-semestre">...</select>` na Sidebar.
2.  **Store (`js/store.js`):**
    * No `constructor`, adicione `semestre: ''` dentro do objeto `this.settings`.
    * Crie o método `setSemestre(val) { this.settings.semestre = val; this.saveSettings(); }`.
3.  **UI (`js/ui.js`):**
    * Na função `initPeriodoLetivoETurno`, capture o elemento: `const sel = document.getElementById('sel-semestre');`
    * Adicione o listener: `sel.addEventListener('change', () => store.setSemestre(sel.value));`

### Cuidados Críticos ⚠️
* **IDs Únicos:** Nunca gere IDs manualmente. Use a função `generateUUID()` do `utils.js`.
* **Formato de Data:** O sistema espera estritamente `YYYY-MM-DD`.
* **Limpeza de Cache:** Ao subir uma nova versão crítica (ex: mudança na estrutura do JSON), instrua os usuários a clicarem no botão vermelho **"Limpar Tudo"** para evitar conflitos com dados antigos no cache do navegador.

---

## 6. 🗺️ Organização de Pastas do Projeto

A estrutura de arquivos foi desenhada para ser extremamente limpa, intuitiva e separar a lógica de processamento de dados (Backend) da interface visual (Frontend).

```text
/gestor-iecos
│
├── dados/
│   └── planilha_base.xlsx       (📊 Arquivo mestre que o Prof. Evaldo edita)
│
├── tools/
│   ├── convert_data.py          (⚙️ O script conversor Python Excel -> JSON)
│   ├── instalar_pacotes.py      (🚀 O script que automatiza a instalação)
│   └── requirements.txt         (📄 A lista enxuta de pacotes: openpyxl)
│
├── js/                          (🧠 O Núcleo do Sistema Frontend)
│   ├── main.js             
│   ├── store.js            
│   ├── ui.js               
│   ├── calendar.js         
│   └── utils.js            
│
├── css/                         (🎨 Estilos, Cores e Regras de Impressão)
│   └── style.css           
│
├── docs/                        (📚 Documentação Oficial)
│   └── MANUAL_DESENVOLVEDOR.md
│
├── img/                         (🖼️ Logos e Favicons)
│   └── logo_iecos.png
│
├── index.html                   (🏠 O Ponto de Entrada da Aplicação / App principal)
├── README.md                    (📖 Apresentação Front-page)
└── dados_app.json               (💾 O Banco de Dados estático gerado automaticamente)