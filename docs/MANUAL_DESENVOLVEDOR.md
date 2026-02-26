# 📘 Manual Técnico do Desenvolvedor — Gestor Acadêmico IECOS

**Versão do Sistema:** 3.1 (Release Avançado - Fevereiro 2026)  
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

A estrutura de arquivos foi desenhada para separar a lógica de processamento de dados (Backend ETL) da interface visual (Frontend Web). Abaixo está o mapeamento exato do repositório:

```text
/GESTOR-IECOS
│
├── .venv/                       (Ambiente virtual Python - Ignorado no Git)
│   ├── Scripts/
│   ├── .gitignore
│   └── pyvenv.cfg
│
├── css/                         (🎨 Estilos, Cores e Regras de Impressão)
│   └── style.css           
│
├── dados/
│   └── planilha_base.xlsx       (📊 Arquivo mestre Excel gerenciado pela secretaria)
│
├── docs/                        (📚 Documentação Oficial e Outputs)
│   ├── pdfs/                    (Pasta destinada para salvar os calendários gerados)
│   └── manual_desenvolvedor.md
│
├── img/                         (🖼️ Logos e Favicons)
│   └── logo_iecos.png
│
├── js/                          (🧠 O Núcleo do Sistema Frontend)
│   ├── calendar.js              (Motor matemático de datas e slots)
│   ├── consulta.js              (Lógica da página pública de alunos)
│   ├── main.js                  (Inicialização e exportação)
│   ├── store.js                 (Gerenciamento de Estado e LocalStorage)
│   ├── ui.js                    (Auditor Global e renderização da interface)
│   └── utils.js                 (Funções auxiliares e cálculo de dias úteis)
│
├── tools/
│   ├── convert_data.py          (⚙️ O script conversor Python Excel -> JSON)
│   ├── instalar_pacotes.py      (🚀 Script de automação de instalação)
│   └── requirements.txt         (📄 Pacotes Python necessários: openpyxl)
│
├── .gitignore                   (Regras de ignorar pastas de ambiente)
├── alocacoes_publicas.json      (💾 Arquivo final gerado via "Publicar Grade Online")
├── consulta.html                (🌐 Página de portal para os alunos/professores visualizarem)
├── dados_app.json               (💾 O Banco de Dados estático gerado via Python)
├── index.html                   (🏠 App principal de Coordenação Restrito)
└── README.md                    (📖 Apresentação Front-page GitHub)
```

---

## 3. 🔄 Fluxo de Importação e Mesclagem (Workflow de Coordenação)

O sistema foi desenhado para que múltiplos diretores de faculdade trabalhem em seus computadores localmente (em modo offline) e, no fim do dia, realizem um "Merge" do semestre inteiro de forma limpa.

1. O Diretor do **Curso A** salva seu trabalho clicando no botão **Exportar (JSON)**.
2. O Diretor do **Curso B** (ou Diretor Geral) clica em **Importar (JSON)** e seleciona o arquivo do Curso A.
3. A tela modal surge perguntando a ação. A opção **➕ Mesclar (Juntar)** lê o array `allocations[]` do arquivo e injeta no `localStorage` os dados sem destruir as alocações locais.
4. Com a grade unificada na máquina, as ferramentas de auditoria entram em ação (Ver item 4.2).

---

## 4. 💎 Lógicas e Algoritmos Críticos da v3.1 (O "Pulo do Gato")

Esta versão blindou o aplicativo contra o erro humano com matemática de datas rigorosa.

### 4.1. ⏳ Empurre e Suspensão de Regulares (Shift Logic)
Diferente de sistemas básicos, o IECOS v3 trata conflitos internos de turma de forma inteligente. Ao inserir uma disciplina Intensiva sobre uma data que já possuía uma aula Regular:

* O sistema chama a função `getSuspendedDates()`. Ao cruzar as datas e notar interseção, a data daquela Regular entra no vetor de `suspended`.
* O loop principal `syncAllRegularDates()` ignora os dias suspensos e **estende a data de encerramento** (`dataFim`) da aula Regular para compensar. Nenhuma carga horária é perdida.

### 4.2. 🛡️ Barreiras de Conflito Global (Cross-Course Overlap)
A física proíbe o professor de estar em dois cursos ao mesmo tempo. Criamos duas barreiras para evitar isso:

* **Barreira Input (Inserção Manual):** Quando o usuário tenta agendar uma aula (via clique na grade ou formulário), o `ui.js` roda um `isDateOverlap()` varrendo todo o IECOS (todas as turmas não selecionadas). Se o professor já estiver ocupado (seja em módulo ou semanal), a requisição morre com um alerta vermelho.
* **Barreira de Auditoria (Pós-Importação):** Se um choque ocorrer sorrateiramente após mesclar JSONs de outros diretores (pois os dados entram via backend), o sistema usa um Hook na aba Visão do Professor. O método `detectGlobalTeacherConflicts()` varre todos os arrays de docentes para localizar duplicação de horários e avisa a direção através de um Banner de Alerta Crítico.

### 4.3. 🧮 Amputação Cirúrgica do Último Dia (Intensivas)
Componentes intensivos nem sempre cravam um número múltiplo exato de horários. (Ex: 17h, 5 aulas/dia = 3 dias cheios + 1 dia com apenas 2 slots).

* O `handleAddManual()` processa a Carga Horária através de módulo: `effectiveCH % slotsIntensiva.length`.
* Se houver resto da divisão, ele recorta o vetor de horários (`slice`) salvando na chave `horariosUltimoDia`. O `calendar.js` intercepta a leitura final renderizando as aulas apenas nas primeiras horas da manhã e liberando o docente no restante daquele dia específico.

---

## 5. 🛠️ Guia de Manutenção de Dados (ETL e Deploy)

Como mantenedor, você precisará preparar o sistema a cada virada de semestre ou ingresso de novos professores concursados. Siga o roteiro:

### 5.1. Atualizando a Planilha Base (A Fonte da Verdade)
Vá até `dados/planilha_base.xlsx` e abra no Excel.

* **Docentes:** Adicione o nome dos novos professores.
* **Componentes:** Atualize Carga Horária (CH), Períodos do PPC ou Cursos novos.
* **Feriados:** Atualize as datas bloqueadas com o calendário oficial (`YYYY-MM-DD`).

### 5.2. Executando o Pipeline de Conversão (ETL Python)
Abra seu terminal na pasta raiz do projeto.

```bash
# 1. Ative seu ambiente virtual 
.venv\Scripts\activate   # (Windows)
# ou
source .venv/bin/activate # (Mac/Linux)

# 2. Acesse a pasta tools e rode o conversor
cd tools
python convert_data.py
```
O script consumirá a planilha e atualizará de forma automática e minificada o arquivo `dados_app.json` no núcleo do sistema web.

### 5.3. Atualização das Datas Padrão da UI (Setup de Semestre)
Para evitar que os diretores comecem configurando a data errada, modifique os atributos `value` dos inputs de data padrão no `index.html`.
*Exemplo: Troque de `2025-10-13` para o novo calendário letivo na linha respectiva do `<input type="date" id="cal-start">`.*

### 5.4. Publicação e Deploy (GitHub Pages)
Testou localmente e tudo funcionou? Salve as mudanças e mande para o GitHub Pages para os diretores atualizarem suas versões online:

```bash
# Volte para a raiz do repositório (se estiver na tools)
cd ..

# Adiciona todos os arquivos rastreados (incluindo o novo dados_app.json modificado)
git add .

# Empacota a versão com uma mensagem clara (Modifique a string conforme a atualização)
git commit -m "Nova carga de PPC e Professores atualizada para o período 2026.2"

# Envia para a nuvem
git push
```

> **⚠️ PROTOCOLO DE SEGURANÇA NA VIRADA DE SEMESTRE:**
> Sempre que fizer um Push estrutural, comunique a equipe: *“Caros diretores, salvem o JSON de suas disciplinas finalizadas. Ao abrirem o sistema na nova versão, cliquem impreterivelmente no botão vermelho **Limpar Tudo** para apagar o cache antigo do navegador antes de recomeçar.”*