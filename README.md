# Gestor de Alocação de Carga Horária - IECOS/UFPA

```markdown
# Gestor de Alocação de Carga Horária - IECOS/UFPA

![Capa do Projeto](img/capa_projeto.jpg)


Sistema web para gestão, alocação e visualização de grades horárias acadêmicas. Desenvolvido para facilitar o trabalho dos diretores de faculdade e da secretaria acadêmica do IECOS/UFPA.

🔗 **Acesse o Sistema:** [CLIQUE AQUI PARA ACESSAR](https://astuciasnor.github.io/gestor-iecos/)
*(Substitua o link acima pelo link real do seu GitHub Pages)*

## 🎯 Funcionalidades

* **Visualização Gráfica:** Grade semanal interativa e Calendário Mensal acadêmico.
* **Controle de Carga Horária:** Contagem automática de horas alocadas vs. horas da disciplina.
* **Detector de Conflitos:** Identifica visualmente se um professor foi alocado em duas turmas no mesmo horário (mesmo entre faculdades diferentes).
* **Integração:** Permite mesclar arquivos de diferentes diretores para uma visão unificada.
* **Impressão:** Geração de PDFs formatados para mural e secretaria.
* **Offline-First:** Funciona no navegador, sem necessidade de instalação ou banco de dados complexo.

## 📚 Como Usar (Para Diretores)

1.  **Acesse o Link:** Abra o sistema no navegador (Chrome, Edge, Firefox).
2.  **Selecione a Turma:** Escolha o Curso e a Turma que deseja trabalhar.
3.  **Aloque as Aulas:**
    * **Regular:** Selecione Disciplina e Docente, depois clique nos horários da grade.
    * **Intensiva:** Use o menu lateral para definir datas de início e fim.
4.  **Salve seu Trabalho:** Clique em **Exportar (JSON)**. Guarde este arquivo com você.
5.  **Envie:** Encaminhe o arquivo `.json` para a Secretaria para consolidação.

## 🛠️ Manutenção (Para Administrador)

O sistema é alimentado por arquivos estáticos. Para atualizar disciplinas, turmas ou docentes:

1.  Edite o arquivo `componentes.csv` (ou a planilha original).
2.  Execute o script de atualização:
    ```bash
    python update_data.py
    ```
3.  Envie as alterações para o GitHub:
    ```bash
    git add .
    git commit -m "Atualização de dados acadêmicos"
    git push
    ```

## ⚠️ Detecção de Conflitos (Secretaria)

Para verificar choques de horário entre cursos (ex: Biologia e Eng. Pesca):
1.  Clique em **Importar**.
2.  Carregue o arquivo da Engenharia de Pesca.
3.  Clique em **Importar** novamente e carregue o arquivo da Biologia.
4.  Escolha a opção **MESCLAR**.
5.  Vá na aba **"Visão do Professor"** e verifique os docentes. Conflitos aparecerão em destaque cinza/vermelho.

---
*Desenvolvido como solução tecnológica para o IECOS/UFPA.*