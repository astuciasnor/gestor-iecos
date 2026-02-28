# 📘 Manual Técnico do Desenvolvedor — Cardume – Planejador Acadêmico (IECOS)

**Versão do Sistema:** 3.2 (Release Fevereiro 2026 — Identificação de Turmas por Bloco)  
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
│   ├── agenda_discente.js       (Lógica da página pública de alunos)
│   ├── agenda_docente.js        (Lógica da página pública de professores)
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
├── agenda_discente.html         (🌐 Página de portal para os alunos visualizarem)
├── agenda_docente.html          (👨‍🏫 Página de portal para os professores visualizarem)
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

### 4.1.1. 👑 Regular Prioritária (A Chefona)
Diferente da Regular comum, a **Regular Prioritária** possui precedência absoluta *dentro da sua própria turma*:
- **Inversão de Suspensão**: Ela **não pode ser suspensa** por disciplinas Intensivas. Se houver sobreposição no mesmo horário, a Intensiva é quem tem as aulas suspensas naquele dia.
- **Visual**: Aparece com uma **borda preta tracejada** na grade semanal.

### 4.2. 🛡️ Barreiras de Conflito Global (Escudo do Docente)
O sistema aplica a "Lei da Física": um professor não pode estar em dois lugares ao mesmo tempo, mesmo que uma das aulas seja "Prioritária".

1. **Barreira de Inserção (Real-time):** Ao tentar clicar na grade ou adicionar uma Intensiva, o sistema varre **todas as turmas de todos os cursos** no banco de dados local. Se o professor já tiver qualquer alocação no mesmo dia/horário/período, o sistema **barra a inserção** com um alerta vermelho. O status de "Prioritária" ajuda contra conflitos internos, mas **não anula** este Escudo Global.
2. **Barreira de Auditoria (Pós-Importação):** Se um choque ocorrer após mesclar JSONs de outros diretores, o sistema usa o Hook na aba **Visão do Professor** (`detectGlobalTeacherConflicts()`) para localizar duplicações e avisar a direção através de um Banner de Alerta Crítico.

### 4.3. 🧮 Amputação Cirúrgica do Último Dia (Intensivas)
Componentes intensivos nem sempre cravam um número múltiplo exato de horários. (Ex: 17h, 5 aulas/dia = 3 dias cheios + 1 dia com apenas 2 slots).

* O `handleAddManual()` processa a Carga Horária através de módulo: `effectiveCH % slotsIntensiva.length`.
* Se houver resto da divisão, ele recorta o vetor de horários (`slice`) salvando na chave `horariosUltimoDia`. O `calendar.js` intercepta a leitura final renderizando as aulas apenas nas primeiras horas da manhã e liberando o docente no restante daquele dia específico.

### 4.4. 🏷️ Identificação Automática de Turmas por Bloco Curricular

A partir da v3.2, a nomenclatura de turma exibida na UI incorpora o **bloco curricular do PPC** de forma automática.

#### Regra de Derivação (`derivarBloco`)

A função `derivarBloco(turmaId, periodo, termStart)` em `ui.js` calcula o bloco usando:

```
anoEntrada = últimos 4 dígitos do turmaId (ex: EP2026 → 2026)
anoRef     = ano extraído de termStart (ex: 2026-02-27 → 2026)
anosDecorridos = anoRef - anoEntrada

periodo = '2P': bloco = (2 × anosDecorridos) + 1  → BL1, BL3, BL5... (ímpares)
periodo = '4P': bloco = (2 × anosDecorridos) + 2  → BL2, BL4, BL6... (pares)
periodo = '1P' ou '3P': retorna '' (sem bloco — períodos curtos)
```

**Exemplos (ano de referência 2026):**

| Turma | Período | Bloco | Exibido como |
|-------|---------|-------|--------|
| EP2026 | 2P | BL1 | `EP2026_BL1` |
| EP2026 | 4P | BL2 | `EP2026_BL2` |
| EP2025 | 2P | BL3 | `EP2025_BL3` |
| CB2024 | 2P | BL5 | `CB2024_BL5` |

#### Sub-grupos de Turma (`subGrupo`)

O campo `subGrupo` é salvo em cada alocação (`store.allocations[]`) para identificar grupos menores:

- **Bloco simples:** `BL1` → rótulo `EP2026_BL1`
- **Sub-turma de laboratório:** `BL1_T01` ou `BL1_T02` → rótulos `EP2026_BL1_T01` / `EP2026_BL1_T02`

`getTurmaLabel(turmaId, subGrupo)` usa o `subGrupo` explícito com prioridade; caso vazio, aplica `derivarBloco` como fallback automático.

#### No Gráfico de Gantt

- **Label compacto:** `EP2026 EP05003 Ecologia (60h)` — sem BL, economiza espaço
- **Com sub-turma:** `EP2026 [T01] EP05003 LabInfo (30h)` — prefixo `[T01]` aparece só quando `subGrupo` contém `_T##`
- **Tooltip (hover):** exibe o rótulo completo `EP2026_BL1_T01`

Detecção do sufixo T: regex `/_?(T\d+)$/i`

#### Importação em Bloco

Ao usar **"Importar Componentes em Bloco"**, o sistema extrai o número do período e atribui `subGrupo = 'BLx'` automaticamente a todas as disciplinas importadas. Ex: período `2` → `subGrupo = 'BL2'`.

---

 🛠️ Guia de Manutenção de Dados (ETL e Deploy)

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