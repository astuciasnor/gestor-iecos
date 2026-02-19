# Gestor de Alocação de Carga Horária - IECOS/UFPA

![Capa do Projeto](img/capa_projeto.png)

Sistema web desenvolvido sob medida para a gestão, alocação e visualização de grades horárias acadêmicas. Ferramenta essencial para facilitar o trabalho dos diretores de faculdade e da secretaria acadêmica do IECOS/UFPA na montagem dos semestres letivos.

🔗 **Acesse o Sistema Online:** [CLIQUE AQUI PARA ACESSAR](https://astuciasnor.github.io/gestor-iecos/)

📘 **Documentação Técnica:** [`docs/MANUAL_DESENVOLVEDOR.md`](docs/MANUAL_DESENVOLVEDOR.md)

---

## 🎯 Funcionalidades Principais

O sistema foi desenhado para resolver a complexidade de alocar turmas Regulares e Intensivas no mesmo calendário:

* **Grade Semanal Interativa:** Interface visual de "clicar e alocar" para disciplinas regulares.
* **Gestão de Intensivas:** Suporte a disciplinas de módulo (blocadas) com cálculo automático de datas finais.
* **Detector de Conflitos:** Identifica visualmente se um professor foi alocado em duas turmas no mesmo horário.
* **Visão do Professor:** Calendário individualizado por docente para conferência de agenda pessoal.
* **Calendário Acadêmico da Turma:** Visualização mensal completa para os alunos.
* **Controle de Carga Horária:** Contagem automática de horas alocadas vs. horas da disciplina (PPC).
* **Integração e Mesclagem:** Permite juntar arquivos de diferentes diretores para uma visão unificada da faculdade.
* **Impressão PDF:** Geração de relatórios formatados para mural, alunos e secretaria.
* **Offline-First:** Funciona inteiramente no navegador, garantindo privacidade e velocidade.

---

## 📚 Guia de Uso Detalhado

### 1. Início e Configuração
1.  **Acesse o Link:** Abra o sistema no navegador (Chrome, Edge ou Firefox preferencialmente).
2.  **Login:** Utilize a senha de acesso restrito da coordenação.
3.  **Configuração Inicial:** No menu lateral esquerdo, selecione o **Curso**, a **Turma**, o **Turno** e o **Período Letivo** (1P a 4P) que deseja trabalhar.

### 2. Alocação de Aulas
* **Disciplinas Regulares:** Selecione a disciplina e o docente no menu lateral. Em seguida, clique diretamente nos "quadradinhos" da grade semanal para preencher os horários.
* **Disciplinas Intensivas:** Mude o "Tipo" para *Intensiva*. Selecione os slots de horário (ex: Manhã inteira ou Híbrido), defina a **Data de Início** e clique em "Adicionar à Grade". O sistema calculará os dias letivos automaticamente.
* **Regular Prioritária:** Utilize esta opção para disciplinas que possuem prioridade absoluta de sala/horário. Elas serão destacadas com uma borda tracejada preta na grade.

### 3. Visualização e Relatórios (Novidade v2.0)

#### 📅 Calendário da Turma
Para visualizar o cronograma que será entregue aos alunos:
1.  Vá até a aba **"Calendário da Turma"**.
2.  Defina o período de datas (início e fim do semestre).
3.  Clique no botão verde **"Atualizar Calendário"** para renderizar a visualização mensal.
4.  Para gerar o arquivo final, clique no botão **"Imprimir"** (canto superior direito). Isso gerará a versão em PDF formatada para ser enviada aos discentes.

#### 👨‍🏫 Visão do Professor
Para auditar a carga horária e a agenda de um docente específico:
1.  Vá até a aba **"Visão do Professor"**.
2.  No campo de busca, entre com o nome do professor.
3.  O sistema carregará o calendário completo onde foram alocadas componentes para aquele determinado docente, cruzando dados de todas as turmas cadastradas.
4.  **Atenção aos Conflitos:** Se houver choque de horário, o sistema exibirá um alerta vermelho nesta visualização.

---

## ⚠️ Integração e Detecção de Conflitos

Para verificar choques de horário entre cursos diferentes (ex.: Biologia e Eng. Pesca) que compartilham professores:

1.  Cada diretor deve clicar em **Exportar (JSON)** e salvar o arquivo do seu curso.
2.  Reúna os arquivos `.json` de todos os cursos.
3.  Clique em **Limpar Tudo** (botão vermelho) para garantir um ambiente limpo.
4.  Clique em **Importar** e carregue o primeiro arquivo.
5.  Clique em **Importar** novamente e carregue o segundo arquivo.
6.  Quando o sistema perguntar, escolha:
    * **MESCLAR (Juntar):** Mantém o que já está carregado e adiciona o novo arquivo. ✅ Opção correta para verificar conflitos.
    * **SUBSTITUIR:** Apaga o anterior e carrega o novo.
7.  Vá na aba **"Visão do Professor"** e busque os docentes compartilhados.

---

## 🛠️ Manutenção e Dados (Para Administrador)

O sistema é alimentado por arquivos estáticos (`dados_app.json`) gerados a partir de uma planilha Excel mestre. Isso permite que a secretaria gerencie os dados em uma ferramenta familiar.

### ✅ Fluxo de Atualização: Excel → JSON
Para adicionar novos professores, turmas ou feriados:

1.  Edite a planilha base: `planilha_base.xlsx`.
2.  Execute o script de conversão Python:
    ```bash
    # Certifique-se de estar no ambiente virtual (.venv)
    python convert_data.py --input .\planilha_base.xlsx --output .\dados_app.json
    ```
3.  Faça o *commit* e *push* do novo arquivo `dados_app.json` para o repositório.

---
*Desenvolvido e mantido por Prof. Dr. Evaldo Silva - IECOS/UFPA*