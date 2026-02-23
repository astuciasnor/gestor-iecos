import { store } from './store.js';
import { initUI } from './ui.js';

document.addEventListener('DOMContentLoaded', async () => {
  await store.loadData();
  initUI();

  // Exportar com Nome Dinâmico: SIGLA_ANO_PERIODO (Ex: EP_2026_2P)
  document.getElementById('btn-export').onclick = () => {
    // 1. Obtém a Sigla do curso selecionado (ex: EP)
    const sigla = store.selectedCurso || 'DADOS';
    
    // 2. Obtém o Ano (YYYY) da data de início definida nas configurações
    let ano = '0000';
    if (store.settings.termStart) {
        ano = store.settings.termStart.split('-')[0];
    }
    
    // 3. Obtém o Período selecionado (1P, 2P, 3P ou 4P)
    const periodo = store.settings.periodo || '1P';

    const fileName = `${sigla}_${ano}_${periodo}.json`;

    const dataStr =
      "data:text/json;charset=utf-8," +
      encodeURIComponent(JSON.stringify(store.allocations));

    const a = document.createElement('a');
    a.setAttribute('href', dataStr);
    a.setAttribute('download', fileName);
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // NOVO: Exportar para o Portal Público (Nome Fixo)
  const btnExportPublic = document.getElementById('btn-export-public');
  if (btnExportPublic) {
    btnExportPublic.onclick = () => {
      // Força o nome do arquivo a ser exatamente o que o Portal do Aluno espera
      const fileName = 'alocacoes_publicas.json';
      
      const dataStr =
        "data:text/json;charset=utf-8," +
        encodeURIComponent(JSON.stringify(store.allocations));

      const a = document.createElement('a');
      a.setAttribute('href', dataStr);
      a.setAttribute('download', fileName);
      document.body.appendChild(a);
      a.click();
      a.remove();
      
      alert("Arquivo '" + fileName + "' gerado com sucesso!\n\nFaça o upload deste arquivo no GitHub para atualizar a grade de todos os alunos instantaneamente.");
    };
  }

  // Importar (Mesclar/Substituir)
  document.getElementById('inp-import').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target.result);

        if (Array.isArray(json)) {
          const mode = confirm(
            "Deseja MESCLAR estes dados com os atuais?\n\n[OK] = MESCLAR\n[CANCELAR] = SUBSTITUIR"
          );

          if (mode) {
            const count = store.mergeAllocations(json);
            alert(`Processo concluído! ${count} novas alocações foram adicionadas.`);
          } else {
            store.allocations = json;
            store.saveAllocations();
            alert("Dados substituídos com sucesso!");
          }

          window.location.reload();
        } else {
          alert("Arquivo inválido. O formato deve ser uma lista JSON.");
        }
      } catch (err) {
        console.error(err);
        alert("Erro ao ler o arquivo JSON.");
      }
    };

    reader.readAsText(file);
    e.target.value = '';
  };

  document.getElementById('btn-clear').onclick = () => store.clearData();
});