# 🐟 Cardume – Planejador Acadêmico | IECOS/UFPA

![Capa do Projeto](img/capa_projeto.png)

Sistema web desenvolvido sob medida para a gestão, alocação e visualização de grades horárias acadêmicas do IECOS/UFPA. Ferramenta essencial para diretores de curso e secretaria acadêmica na montagem e cruzamento de horários dos semestres letivos.

🔗 **Acesse o Sistema Online:** [CLIQUE AQUI PARA ACESSAR](https://astuciasnor.github.io/gestor-iecos/)

📘 **Documentação Técnica Oficial:** [`docs/manual_desenvolvedor.md`](docs/manual_desenvolvedor.md)

---

## 🎯 Funcionalidades Principais

O sistema foi desenhado para resolver a complexidade de alocar turmas Regulares e Intensivas no mesmo calendário de forma harmônica e matematicamente estrita:

* **Importação de Bloco de PPC:** Puxe todas as disciplinas de um período inteiro para a grade pendente com apenas um clique.
* **Grade Semanal Interativa:** Interface visual de "clicar e alocar" slots para disciplinas regulares semanais.
* **Matemática do Último Dia (Intensivas):** Suporte a disciplinas blocadas e híbridas. O sistema calcula a data de término exata e **recorta (amputa)** os slots excedentes do último dia de aula para que as horas do sistema batam perfeitamente com a Carga Horária do Plano de Curso.
* **Motor de Suspensão de Aulas:** Quando uma Intensiva é alocada por cima de uma Regular da mesma turma, o sistema automaticamente suspende a Regular daquele dia e empurra seu calendário para compensar as horas finais.
* **Auditoria Global de Professores:** A barreira de inserção cruza o banco inteiro e impede que aulas sejam criadas se um professor já estiver em sala em *outro curso* no mesmo horário.
* **Auditoria Visual Pós-Importação:** Alert box inteligente na Visão do Professor que denuncia sobreposição cruzada após o "merge" de arquivos JSON de coordenações diferentes.
* **Gráfico de Gantt Interativo:** Um mapa de calor no tempo mostrando a jornada fluida do semestre de cada professor e equipe letiva (múltiplos docentes).
* **Visão do Professor e Calendário:** Telas individualizadas com botão 🔄 **Refresh Dinâmico** que recalcula a visualização visual com as atualizações instantâneas feitas no painel lateral.
* **Offline-First:** O servidor é o próprio navegador. Funciona em total privacidade e velocidade com uso intensivo de `localStorage`.

---

## 📚 Guia de Uso Detalhado

### 1. Início e Configuração
1.  **Acesse o Link:** Abra o sistema no navegador (Chrome, Edge ou Firefox preferencialmente).
2.  **Login:** Utilize a senha de acesso restrito da coordenação.
3.  **Configuração Inicial:** No menu lateral esquerdo, selecione o **Período Letivo** (1P a 4P) e o **Turno**. Depois escolha o **Curso** e a **Turma** que deseja trabalhar (nesta exata ordem).

### 2. Alocação de Aulas
* **Disciplinas Regulares:** Selecione a disciplina, a cor e o docente (ou múltiplos docentes). Em seguida, clique diretamente nos "quadradinhos" vazios da grade semanal para preencher os horários.
* **Disciplinas Intensivas:** Mude o "Tipo" para *Intensiva*. Selecione os slots de horário que a disciplina utilizará. Defina a **Data de Início** e clique em "Adicionar à Grade". (A data final e fracionamento do último dia são gerados pelo software).
* **Regular Prioritária:** Utilize esta opção para horários inegociáveis de um docente ou laboratórios essenciais. Elas formam uma borda preta tracejada e o sistema impede que disciplinas intensivas se alojem em cima.

### 3. Visualização e Relatórios de Output (Versão 3.1)

#### 📅 Calendário da Turma
Para visualizar o cronograma letivo final a ser enviado aos alunos:
1.  Vá até a aba **"Calendário da Turma"**.
2.  Verifique o período de datas no painel (início e fim do semestre).
3.  Sempre clique no botão azul 🔄 **"Atualizar"** ao fazer modificações na aba lateral para renderizar o layout do zero.
4.  Para gerar o arquivo limpo, clique no botão cinza **"Imprimir"** (canto superior direito).

#### 👨‍🏫 Visão do Professor (Evitando o Caos)
Para conferir o mapa total de aulas e horas contratadas de um docente específico:
1.  Abra a aba **"Visão do Professor"**.
2.  *O Radar Anti-Choque atuará aqui!* Se você puxou grades de outros cursos na aba lateral, o sistema listará no topo a presença de Professores clonados/em conflito global em vermelho escuro.
3.  Busque o nome do docente para identificar o dia fatídico marcado com "⚠️". Clique em 🔄 para atualizar após corrigir as sobreposições na grade.

---

## ⚠️ Workflow: Integração e Mesclagem entre Diretorias

A fim de cruzar horários entre Eng. de Pesca, Ciências Biológicas e Naturais:

1.  O Diretor "A" deve concluir a etapa primária e clicar em **Exportar (JSON)** salvando o seu arquivo de curso.
2.  A Coordenação/Direção central clica no botão vermelho **Limpar Tudo** em sua própria máquina para preparar a prancheta de análise.
3.  Clica em **Importar** e seleciona o primeiro arquivo local.
4.  Clica em **Importar** de novo selecionando o segundo arquivo.
5.  No modal que sobe na tela, aciona o botão **MESCLAR (Juntar)** (nunca Substituir).
6.  Com as matrizes unificadas na memória do navegador, basta conferir a aba **"Visão do Professor"** para visualizar os relatórios de conflito de turmas e os ajustes necessários.

---

## 🛠️ Manutenção (Exclusivo para o Administrador Mantenedor)

O sistema é robustamente abastecido via pipeline estático ETL. Ele utiliza a base `dados_app.json`, a qual é cronicamente compilada a partir de planilhas locais Excel (`planilha_base.xlsx`) na máquina do administrador. 

⚠️ Para a rotina de manipulação via script Python, arquitetura da árvore de códigos ou Setup inicial, dirija-se exclusivamente ao doc principal em: `docs/manual_desenvolvedor.md`.