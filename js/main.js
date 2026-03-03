import { store } from './store.js';
import { initUI, exportSigaaMetadataJSON } from './ui.js';

function isValidIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validatePublicExportData(exportData) {
  const issues = [];
  if (!exportData || typeof exportData !== 'object') {
    issues.push('Payload inválido para exportação pública.');
    return issues;
  }

  const { allocations, settings } = exportData;
  if (!Array.isArray(allocations)) {
    issues.push('Campo allocations ausente ou inválido.');
  } else if (!allocations.length) {
    issues.push('Nenhuma alocação encontrada para publicar.');
  }

  if (!settings || typeof settings !== 'object') {
    issues.push('Configurações do semestre ausentes.');
    return issues;
  }

  if (!isValidIsoDate(settings.termStart)) {
    issues.push('Data inicial do semestre inválida.');
  }
  if (!isValidIsoDate(settings.termEnd)) {
    issues.push('Data final do semestre inválida.');
  }
  if (
    isValidIsoDate(settings.termStart) &&
    isValidIsoDate(settings.termEnd) &&
    settings.termStart > settings.termEnd
  ) {
    issues.push('Data inicial do semestre maior que a data final.');
  }

  return issues;
}

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

      const exportData = {
        allocations: store.allocations,
        settings: {
          termStart: store.settings.termStart,
          termEnd: store.settings.termEnd
        }
      };

      const issues = validatePublicExportData(exportData);
      if (issues.length) {
        alert(
          'Publicação cancelada por inconsistências:\n\n- ' +
          issues.join('\n- ')
        );
        return;
      }

      const shouldExport = confirm(
        `Confirmar publicação online?\n\n` +
        `Alocações: ${exportData.allocations.length}\n` +
        `Período: ${exportData.settings.termStart} a ${exportData.settings.termEnd}\n\n` +
        `Clique em OK para gerar o arquivo público.`
      );
      if (!shouldExport) return;

      const dataStr =
        "data:text/json;charset=utf-8," +
        encodeURIComponent(JSON.stringify(exportData, null, 2));

      const a = document.createElement('a');
      a.setAttribute('href', dataStr);
      a.setAttribute('download', fileName);
      document.body.appendChild(a);
      a.click();
      a.remove();

      alert(
        "Arquivo '" + fileName + "' gerado com sucesso.\n\n" +
        "Publicação automática recomendada (na raiz do projeto):\n" +
        "python tools/publish_online.py --from-download \"%USERPROFILE%\\Downloads\\alocacoes_publicas.json\" --push"
      );
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
