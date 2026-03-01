
import os

TARGET_FILE = r'd:\Git\planejador-academico\gestor-iecos\js\ui.js'

def patch_ui_v4d():
    print(f"Lendo {TARGET_FILE}...")
    with open(TARGET_FILE, 'r', encoding='utf-8') as f:
        content = f.read()

    # --- 1. LIMPEZA DO TOPO E DEFINIÇÃO DE VARIÁVEIS ---
    # Remover o "comentário" e variáveis duplicadas que o usuário pode ter colocado
    if "let activeFaixaIndex = 1;" in content:
        # Tenta achar o bloco inicial e limpar
        start_marker = "// Adicione logo no início do arquivo"
        import_marker = "import { store }"
        if start_marker in content and import_marker in content:
            idx1 = content.find(start_marker)
            idx2 = content.find(import_marker)
            content = content[:idx1] + "let activeFaixaIndex = 1;\nconst faixasPatterns = { 1: [], 2: [], 3: [] };\n\n" + content[idx2:]

    # --- 2. SUBSTITUIR drawnFaixas POR faixasPatterns ---
    content = content.replace('window.drawnFaixas', 'faixasPatterns')

    # --- 3. IMPLEMENTAR setupFaixaControls ---
    setup_func = """
function setupFaixaControls() {
    const f1Fim = document.getElementById('inp-data-fim-f1');
    const f2Ini = document.getElementById('inp-data-inicio-f2');
    const f2Fim = document.getElementById('inp-data-fim-f2');
    const f3Ini = document.getElementById('inp-data-inicio-f3');

    const addOneDay = (dt) => {
        if (!dt) return '';
        const d = new Date(dt + 'T12:00:00');
        d.setDate(d.getDate() + 1);
        return d.toISOString().split('T')[0];
    };

    if (f1Fim) f1Fim.addEventListener('change', () => { if (f1Fim.value && f2Ini) f2Ini.value = addOneDay(f1Fim.value); });
    if (f2Fim) f2Fim.addEventListener('change', () => { if (f2Fim.value && f3Ini) f3Ini.value = addOneDay(f2Fim.value); });

    document.querySelectorAll('.btn-draw-faixa').forEach(btn => {
        btn.onclick = () => {
            activeFaixaIndex = parseInt(btn.dataset.faixa);
            activateDrawingMode(activeFaixaIndex);
            
            // Carregar desenho da faixa
            document.querySelectorAll('.slot').forEach(s => s.classList.remove('selected-slot'));
            const saved = faixasPatterns[activeFaixaIndex] || [];
            saved.forEach(slotInfo => {
                const [d, h] = slotInfo.split('-');
                const el = Array.from(document.querySelectorAll('.slot')).find(s => s.dataset.dia == d && s.dataset.horario == h);
                if (el) el.classList.add('selected-slot');
            });
        };
    });

    const btnSaveDraw = document.getElementById('btn-save-draw');
    if (btnSaveDraw) {
        btnSaveDraw.onclick = () => {
            const selected = Array.from(document.querySelectorAll('.slot.selected-slot'));
            if (selected.length === 0) return alert('Selecione ao menos um horário.');
            faixasPatterns[activeFaixaIndex] = selected.map(el => `${el.dataset.dia}-${el.dataset.horario}`);
            const status = document.getElementById(`status-draw-f${activeFaixaIndex}`);
            if (status) {
                status.textContent = `${selected.length} horários definidos`;
                status.style.color = '#27ae60';
            }
            deactivateDrawingMode();
        };
    }
}
"""
    if "function initPeriodoLetivoETurno()" in content:
        content = content.replace("function initPeriodoLetivoETurno()", setup_func + "\nfunction initPeriodoLetivoETurno()")

    # --- 4. CHAMAR setupFaixaControls EM initUI ---
    if "initUI() {" in content:
        content = content.replace("initUI() {", "initUI() {\n    setupFaixaControls();")

    # --- 5. AJUSTAR handleAddManual PARA LER DATAS DE FIM E USAR faixasPatterns ---
    # Captura melhorada com união de dias do usuário
    old_cap_start = 'for (let f = 1; f <= 3; f++) {'
    old_cap_end = 'faixasData.push({'
    
    new_capture = """        for (let f = 1; f <= 3; f++) {
            const elFaixa = document.getElementById(`faixa-${f}`);
            if (elFaixa && !elFaixa.classList.contains('hidden')) {
                const fInicio = document.getElementById(`inp-data-inicio-f${f}`)?.value;
                const fFim = document.getElementById(`inp-data-fim-f${f}`)?.value;
                if (!fInicio) return alert(`Defina a data de início da Faixa ${f}.`);

                const pattern = faixasPatterns[f] || [];
                if (pattern.length === 0) return alert(`A Faixa ${f} não possui horários desenhados.`);

                const selectedDays = Array.from(document.querySelectorAll(`.f${f}-day:checked`)).map(cb => parseInt(cb.value));
                if (selectedDays.length === 0) return alert(`Selecione ao menos um dia da semana na Faixa ${f}.`);

                const drawnSlotsByDay = {};
                const fSlotsSet = new Set();
                
                // Processar pattern: item é "dia-horario"
                pattern.forEach(p => {
                    const [d, h] = p.split('-');
                    fSlotsSet.add(h);
                    const diaInt = parseInt(d);
                    if (!drawnSlotsByDay[diaInt]) drawnSlotsByDay[diaInt] = [];
                    drawnSlotsByDay[diaInt].push(h);
                });

                // Fallback de Propagação para os selecionados
                const allSlots = Array.from(fSlotsSet);
                selectedDays.forEach(dia => {
                    if (!drawnSlotsByDay[dia] || drawnSlotsByDay[dia].length === 0) {
                        drawnSlotsByDay[dia] = [...allSlots];
                    }
                });

                faixasData.push({
                    inicio: fInicio,
                    fim: fFim || null,
                    slots: allSlots,
                    dias: selectedDays,
                    drawnSlotsByDay: drawnSlotsByDay
                });"""

    # Localizar o bloco exato de captura no handleAddManual
    idx_loop = content.find('for (let f = 1; f <= 3; f++) {', content.find('function handleAddManual()'))
    idx_push = content.find('faixasData.push({', idx_loop)
    if idx_loop != -1 and idx_push != -1:
        # Tenta achar o final do bloco do loop
        end_loop = content.find('}', content.find('drawnSlotsByDay: drawnSlotsByDay', idx_push)) + 1
        content = content[:idx_loop] + new_capture + content[end_loop:]

    # --- 6. AJUSTAR MOTOR PARA RESPEITAR f.fim ---
    boundary_marker = 'if (currentFaixaIndex + 1 < faixasData.length && currentDateStr >= faixasData[currentFaixaIndex + 1].inicio) {'
    new_boundary = """            // 1. Verificar se batemos no FIM explícito da faixa atual OU no início da próxima
            let reachedEnd = false;
            if (activeFaixa.fim && currentDateStr > activeFaixa.fim) reachedEnd = true;
            if (currentFaixaIndex + 1 < faixasData.length && currentDateStr >= faixasData[currentFaixaIndex + 1].inicio) reachedEnd = true;

            if (reachedEnd && currentFaixaIndex + 1 < faixasData.length) {
                currentFaixaIndex++;
                activeFaixa = faixasData[currentFaixaIndex];
            }"""

    if boundary_marker in content:
        content = content.replace(boundary_marker, new_boundary)

    with open(TARGET_FILE, 'w', encoding='utf-8') as f:
        f.write(content)
    print("PATCH FUSÃO 4D APLICADO COM SUCESSO.")

if __name__ == "__main__":
    patch_ui_v4d()
