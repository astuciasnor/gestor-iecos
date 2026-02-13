# Manual do Usuário — Gestor Acadêmico IECOS

## 1) Visão geral
O **Gestor Acadêmico** é um aplicativo web (site estático) para:
- montar **grade semanal** por turma (aulas regulares e intensivas);
- gerar **calendário mensal da turma**;
- gerar **visão do professor** (inclui detecção visual de choques);
- manter **lista de ofertas**;
- **Exportar/Importar JSON** para backup e para comparar/mesclar grades.

> Este sistema roda localmente no navegador (sem servidor). Basta abrir o `index.html`.

---

## 2) Filosofia do projeto (por que foi feito assim)
Este projeto foi desenhado para ser **simples de operar e fácil de versionar**, mesmo com usuários não técnicos.

### 2.1 Sem backend (só HTML/CSS/JS)
- Facilidade de uso: abre em qualquer computador.
- Facilidade de distribuição: pode enviar por pasta/zip, pendrive ou link.
- Menos manutenção: não depende de servidor, banco de dados ou instalação complexa.

### 2.2 Dados separados do código
- **Excel (`planilha_base.xlsx`)** é a fonte “humana”, fácil para professores editarem.
- **JSON (`dados_app.json`)** é a fonte do aplicativo, rápida e sem ambiguidade.
- O conversor `convert_data.py` faz a ponte **Excel → JSON**.

---

## 3) Estrutura do projeto (arquivos e interação)
> A ideia desta seção é você lembrar daqui a 4–6 meses onde mexer e por quê.

### 3.1 Arquivos principais
- `index.html`  
  Estrutura da interface (abas, sidebar, containers) e inclusão dos scripts.

- `css/style.css`  
  Estilos visuais do sistema: layout, sidebar, tabelas, calendários, impressão.

- `js/main.js`  
  Ponto de entrada do app: inicializa, carrega dados, conecta eventos principais.

- `js/store.js`  
  “Estado” do app: turma selecionada, configurações, ofertas/grade; salva no `localStorage`.  
  Também cuida de **Exportar/Importar JSON**.

- `js/ui.js`  
  Renderização e comportamento da interface: Grade Semanal, Calendário da Turma, Visão do Professor, Lista de Ofertas, Ajuda.  
  Regras importantes estão aqui (ex.: “Intervalo” em cinza; intensivas com 5 aulas por dia pulando o intervalo, etc.).

- `js/utils.js`  
  Funções auxiliares: datas, formatações, ordenações, validações simples.

### 3.2 Dados e conversão
- `planilha_base.xlsx`  
  Fonte de dados editável. Professores editam aqui (preferencialmente em Drive compartilhado).

- `convert_data.py`  
  Script que lê o Excel e gera o JSON do app.

- `dados_app.json`  
  Arquivo consumido pelo app. Deve ser regenerado sempre que o Excel mudar.

---

## 4) Fluxo de atualização de dados (Excel → JSON → App)
Sempre que a planilha mudar:

1) Salve a planilha como `planilha_base.xlsx` na pasta do projeto.
2) No terminal, com o `.venv` ativo, rode:
   `python convert_data.py --input .\planilha_base.xlsx --output .\dados_app.json`
3) Abra/atualize o `index.html` no navegador e valide.

### Edição por professores (sem Git/GitHub)
Para facilitar a colaboração, os professores devem editar **apenas** a planilha `planilha_base.xlsx`
em um drive compartilhado (ex.: Google Drive/Sheets ou OneDrive).
O arquivo `dados_app.json` é gerado pelo coordenador/gestor do sistema usando o script `convert_data.py`.
Assim, ninguém precisa conhecer Git/GitHub: os professores só editam o Excel; o gestor valida, gera o JSON e publica a versão oficial.

---

## 5) Como usar (passo a passo)
### 5.1 Configuração inicial
1) Selecione **Curso** e **Turma**
2) Informe **Início/Fim do Período Letivo**
3) Selecione o **Turno** (Manhã/Tarde/Noite, conforme existir)

### 5.2 Inserir disciplinas (Regular)
1) Selecione **Disciplina** e **Docente**
2) Clique diretamente nos quadradinhos da grade semanal para alocar aulas
3) Para remover, clique no “X” da aula

### 5.3 Inserir disciplinas (Intensiva)
1) Troque o tipo para **Intensiva**
2) Defina datas de início e fim
3) Clique em **Adicionar à Grade (Intensiva)**
4) O sistema preenche os dias úteis automaticamente

---

## 6) Backup, compartilhamento e comparação entre cursos
### 6.1 Ordem recomendada (sem erro)
1) Clique em **Exportar (JSON)** para salvar a grade do seu curso (ex.: `pesca.json`)
2) Peça o arquivo do outro diretor (ex.: `biologia.json`) para importar
3) Opcional (recomendado): se você quer começar do zero, clique em **Limpar Tudo** antes de importar

### 6.2 Importar dois arquivos e escolher ação
- Clique em **Importar** e carregue o primeiro arquivo
- Clique em **Importar** novamente e carregue o segundo
- Quando aparecer a pergunta:
  - **MESCLAR**: mantém o que já está carregado e **adiciona** o segundo arquivo (ideal para comparar cursos)
  - **SUBSTITUIR**: apaga o que está carregado e usa apenas o arquivo importado

Depois, vá na aba **Visão do Professor** para identificar choques.

---

## 7) Impressão (PDF)
- Use o botão **Imprimir**
- Nas opções do navegador, ative **“Imprimir planos de fundo”** (para sair colorido)

---

## 8) Solução de problemas (rápido)
- “Listas vazias / não atualizou”: gere novamente `dados_app.json`
- “Ficou estranho depois de muitas importações”: use **Limpar Tudo** e importe novamente
- “Mudou o Excel e não refletiu”: você esqueceu o passo **Excel → JSON**

---

## 9) Contato do desenvolvedor
Fale com o desenvolvedor **Prof. Dr. Evaldo Silva** se quiser solicitar nova funcionalidade,
corrigir algo, ou adicionar novos dados.
