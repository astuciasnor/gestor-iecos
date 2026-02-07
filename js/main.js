import { store } from './store.js';
import { initUI } from './ui.js';

document.addEventListener('DOMContentLoaded', async () => {
    await store.loadData();
    initUI();
    
    // Exportar
    document.getElementById('btn-export').onclick = () => {
        // Nome do arquivo sugere a data e quem exportou (opcional)
        const date = new Date().toISOString().slice(0,10);
        const fileName = `alocacoes_${date}.json`;

        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(store.allocations));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", fileName);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    };

    // Importar (Com Lógica de Mesclagem)
    document.getElementById('inp-import').onchange = (e) => {
        const file = e.target.files[0];
        if(!file) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const json = JSON.parse(event.target.result);
                
                if(Array.isArray(json)) {
                    // Pergunta crucial para integração
                    const mode = confirm("Deseja MESCLAR estes dados com os atuais?\n\n[OK] = MESCLAR (Junta com o que já tem)\n[CANCELAR] = SUBSTITUIR (Apaga o atual e usa o novo)");
                    
                    if (mode) {
                        // Modo Mesclar (Importar dados de outro diretor)
                        const count = store.mergeAllocations(json);
                        alert(`Processo concluído! ${count} novas alocações foram adicionadas.`);
                    } else {
                        // Modo Substituir (Backup pessoal)
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
        // Limpa o input para permitir importar o mesmo arquivo novamente se precisar
        e.target.value = '';
    };

    document.getElementById('btn-clear').onclick = () => store.clearData();
});