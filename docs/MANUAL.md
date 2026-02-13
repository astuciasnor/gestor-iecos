# Manual do Usuário — Gestor Acadêmico IECOS

## 1. Visão geral
Este sistema organiza a grade semanal e gera calendários mensais por turma e por docente, com suporte a ofertas regulares e intensivas, além de detecção visual de choques.

## 2. Estrutura do projeto (resumo)
- `index.html`: interface do sistema
- `css/style.css`: estilos
- `js/*.js`: lógica do app
- `planilha_base.xlsx`: base de dados editável (fonte)
- `convert_data.py`: converte Excel → JSON
- `dados_app.json`: arquivo de dados consumido pelo app

## 3. Fluxo recomendado para atualização de dados (Excel → JSON)
1) Atualize `planilha_base.xlsx`  
2) Gere o JSON:
   `python convert_data.py --input .\planilha_base.xlsx --output .\dados_app.json`
3) Abra o `index.html` e valide as listas/grades

### Edição por professores (sem Git/GitHub)
[COLE AQUI O TEXTO QUE PASSEI ACIMA]

## 4. Como usar (passo a passo)
1) Selecione Curso e Turma
2) Defina período letivo (início/fim) e turno
3) Selecione disciplina e docente
4) Adicione:
   - Regular: clique na grade semanal
   - Intensiva: selecione datas e use “Adicionar à Grade”
5) Gere calendários:
   - Calendário da Turma
   - Visão do Professor

## 5. Importar, Mesclar e Substituir
- Importar duas vezes → escolha:
  - MESCLAR: junta dados
  - SUBSTITUIR: troca tudo pelo novo arquivo
Recomendação: para comparar cursos e detectar choques, use MESCLAR.

## 6. Exportar e backup
- Sempre exporte antes de fechar para manter backup.

## 7. Impressão (PDF)
- Use “Imprimir” e ative “Planos de fundo” para manter cores.

## 8. Solução de problemas
- Se listas estiverem vazias/desatualizadas: regenere `dados_app.json`
- Se ficar estranho no navegador: Limpar Tudo e reimportar JSON

## 9. Contato do desenvolvedor
Fale com o desenvolvedor “Prof. Dr. Evaldo Silva” para solicitar novas funcionalidades, correções ou inclusão de novos dados.
