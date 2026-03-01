
import os

TARGET_FILE = r'd:\Git\planejador-academico\gestor-iecos\js\ui.js'

def patch_ui():
    print(f"Lendo {TARGET_FILE}...")
    with open(TARGET_FILE, 'r', encoding='utf-8') as f:
        content = f.read()

    # --- 1. AJUSTE NA CAPTURA (handleAddManual) ---
    marker_h_start = 'const drawnItems = window.drawnFaixas[f] || [];'
    marker_h_end = 'const fDias = Array.from(fDiasSet).sort((a, b) => a - b);'
    
    new_capture = """                const drawnItems = window.drawnFaixas[f] || [];
                if (drawnItems.length === 0) return alert(`A Faixa ${f} não possui horários desenhados na Grade.`);

                // NOVO: Capturar dias selecionados via checkbox
                const selectedDays = Array.from(document.querySelectorAll(`.f${f}-day:checked`)).map(cb => parseInt(cb.value));
                if (selectedDays.length === 0) return alert(`Selecione ao menos um dia da semana na Faixa ${f}.`);

                const fDiasSet = new Set(selectedDays);
                const allFSlotsSet = new Set(drawnItems.map(it => it.slot));
                const allFSlots = Array.from(allFSlotsSet);
                const drawnSlotsByDay = {};

                // Lógica de Propagação (Fallback):
                // Se o usuário marcou o dia nos checkboxes mas não desenhou nada nele, 
                // o sistema usa a união de tudo que foi desenhado na faixa.
                selectedDays.forEach(dia => {
                    const specific = drawnItems.filter(it => it.dia === dia).map(it => it.slot);
                    drawnSlotsByDay[dia] = specific.length > 0 ? specific : [...allFSlots];
                });

                const fDias = Array.from(fDiasSet).sort((a, b) => a - b);"""

    if marker_h_start in content and marker_h_end in content:
        print("Aplicando patch de Captura/Propagação em handleAddManual...")
        idx1 = content.find(marker_h_start)
        idx2 = content.find(marker_h_end)
        content = content[:idx1] + new_capture + content[idx2:]
    else:
        print("ERRO: Marcadores de captura em handleAddManual não encontrados.")

    # --- 2. AJUSTE NA RESTAURAÇÃO (Edit) ---
    marker_e_start = 'if (inpInicio) inpInicio.value = fData.inicio;'
    
    new_restore = """                        if (inpInicio) inpInicio.value = fData.inicio;
                        
                        // Restaurar os checkboxes de dias da faixa
                        document.querySelectorAll(`.f${f}-day`).forEach(cb => {
                            cb.checked = fData.dias.includes(parseInt(cb.value));
                        });"""

    if marker_e_start in content:
        print("Aplicando patch de Restauração (Edit)...")
        content = content.replace(marker_e_start, new_restore)

    # --- 3. AJUSTE NA TABELA (renderOfertasList - Propagação Consistente) ---
    # Precisamos garantir que o cálculo visual na tabela também propague se o objeto 
    # for antigo ou se o drawnSlotsByDay de um dia específico estiver vazio (fallback).
    
    marker_t_start = 'const dowSlots = f.drawnSlotsByDay ? (f.drawnSlotsByDay[cur.getDay()] || []) : f.slots;'
    
    new_table_logic = """                        // Lógica de Fallback Consistente com Propagação
                        let dowSlots = [];
                        if (f.drawnSlotsByDay && f.drawnSlotsByDay[cur.getDay()]) {
                             dowSlots = f.drawnSlotsByDay[cur.getDay()];
                        } else if (f.slots) {
                             dowSlots = f.slots;
                        }"""

    if marker_t_start in content:
        print("Aplicando patch de Fallback na Tabela de Ofertas...")
        content = content.replace(marker_t_start, new_table_logic)

    # Verificação de segurança
    if "export { renderWeeklyGrid" not in content:
        print("ERRO: Arquivo parece corrompido ou exportação ausente. Abortando.")
        return

    with open(TARGET_FILE, 'w', encoding='utf-8') as f:
        f.write(content)
    print("PATCH APLICADO COM SUCESSO.")

if __name__ == "__main__":
    patch_ui()
