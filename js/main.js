import { store } from './store.js';
import { initUI, exportSigaaMetadataJSON } from './ui.js';

// Executar imediatamente (scripts type="module" já são diferidos e o DOM já deve estar pronto)
(async () => {
  await store.loadData();
  initUI();

  // Exportar: opção de curso atual ou todos os cursos
  document.getElementById('btn-export').onclick = () => {
    const sigla = store.selectedCurso || 'DADOS';
    let ano = '0000';
    if (store.settings.termStart) ano = store.settings.termStart.split('-')[0];
    const periodo = store.settings.periodo || '1P';

    // Monta mapa turmaId → sigla a partir dos dados de turmas
    const turmaParaCurso = {};
    (store.rawData?.turmas || []).forEach(t => {
      if (t.turma_id && t.sigla) turmaParaCurso[String(t.turma_id)] = String(t.sigla);
    });

    // Nome legível do curso para exibir no diálogo
    const cursoObj = (store.rawData?.cursos || []).find(c => c.sigla === sigla);
    const cursoNome = cursoObj?.nome ? `${sigla} – ${cursoObj.nome}` : sigla;

    const escolha = confirm(
      `Escolha o escopo da exportação:\n\n` +
      `[OK]       → Salvar apenas as turmas do curso ${cursoNome}\n` +
      `[Cancelar] → Salvar todas as turmas dos Cursos do IECOS`
    );

    let dadosExportar, fileName;

    if (escolha) {
      // Filtra alocações cujo turmaId pertence ao curso selecionado
      dadosExportar = store.allocations.filter(a =>
        turmaParaCurso[String(a.turmaId)] === sigla
      );
      fileName = `${sigla}_${ano}_${periodo}.json`;
    } else {
      dadosExportar = store.allocations;
      fileName = `IECOS_TODOS_${ano}_${periodo}.json`;
    }

    const dataStr =
      "data:text/json;charset=utf-8," +
      encodeURIComponent(JSON.stringify(dadosExportar, null, 2));

    const a = document.createElement('a');
    a.setAttribute('href', dataStr);
    a.setAttribute('download', fileName);
    document.body.appendChild(a);
    a.click();
    a.remove();
  };


  // NOVO: Exportar para o Portal Público (Nome Fixo + Datas do Semestre)
  const btnExportPublic = document.getElementById('btn-export-public');
  if (btnExportPublic) {
    btnExportPublic.onclick = () => {
      const fileName = 'alocacoes_publicas.json';

      // MÁGICA DA OPÇÃO C: Agrupamos as alocações E as configurações do semestre
      const exportData = {
        allocations: store.allocations,
        settings: {
          termStart: store.settings.termStart,
          termEnd: store.settings.termEnd
        }
      };

      const dataStr =
        "data:text/json;charset=utf-8," +
        encodeURIComponent(JSON.stringify(exportData));

      const a = document.createElement('a');
      a.setAttribute('href', dataStr);
      a.setAttribute('download', fileName);
      document.body.appendChild(a);
      a.click();
      a.remove();

      alert("Arquivo '" + fileName + "' gerado com sucesso!\n\nFaça o upload deste arquivo no GitHub para atualizar a grade de todos os alunos instantaneamente.");
    };
  }

  const btnExportSigaa = document.getElementById('btn-export-sigaa-json');
  if (btnExportSigaa) {
    btnExportSigaa.onclick = () => exportSigaaMetadataJSON();
  }

  // Importar (Mesclar/Substituir)
  document.getElementById('inp-import').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target.result);

        // Verifica se é o formato antigo de backup (Array) ou o novo do portal público (Objeto)
        const dataToImport = Array.isArray(json) ? json : (json.allocations ? json.allocations : null);

        if (dataToImport && Array.isArray(dataToImport)) {
          const mode = confirm(
            "Deseja MESCLAR estes dados com os atuais?\n\n[OK] = MESCLAR\n[CANCELAR] = SUBSTITUIR"
          );

          if (mode) {
            const count = store.mergeAllocations(dataToImport);
            alert(`Processo concluído! ${count} novas alocações foram adicionadas.`);
          } else {
            store.allocations = dataToImport;
            store.saveAllocations();
            alert("Dados substituídos com sucesso!");
          }

          window.location.reload();
        } else {
          alert("Arquivo inválido. O formato não é suportado.");
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
})();
