
import os
import re

TARGET_FILE = r'd:\Git\planejador-academico\gestor-iecos\js\ui.js'

def restore_desaggregated_view_v2():
    print(f"Lendo {TARGET_FILE}...")
    with open(TARGET_FILE, 'r', encoding='utf-8') as f:
        content = f.read()

    # --- 1. MODIFICAR appendRow PARA SUPORTAR PARÂMETROS EXTERNOS ---
    # Atualmente: const appendRow = (a) => {
    # Queremos: const appendRow = (a, params = {}) => {
    
    content = content.replace('const appendRow = (a) => {', 'const appendRow = (a, params = {}) => {')
    
    # Substituir os campos por params se existirem
    # start, end, totalHoras, details, color
    content = content.replace('const start = a.dataInicio || semestreInicio;', 'const start = params.start || a.dataInicio || semestreInicio;')
    content = content.replace('const end = a.dataFim || semestreFim;', 'const end = params.end || a.dataFim || semestreFim;')
    content = content.replace('let totalHoras = 0, details = \'\';', 'let totalHoras = params.totalHoras || 0, details = params.details || \'\';')
    
    # Achar o local onde totalHoras e details são calculados para ignorar no caso de params
    # (No ui.js atual, eles são calculados dentro de if(tipo===pendente)...else if(regular)...else{intensiva})
    
    # --- 2. SUBSTITUIR O LOOP intensivas.forEach ---
    old_loop = """    intensivas.forEach((a) => {
        const monthKey = a.dataInicio ? a.dataInicio.substring(0, 7) : '';
        if (monthKey && monthKey !== currentMonth) {
            appendMonthSeparator(monthKey);
            currentMonth = monthKey;
        }
        if (!monthKey && currentMonth !== 'SEM DATA') {
            appendSeparator('SEM DATA');
            currentMonth = 'SEM DATA';
        }
        appendRow(a);
    });"""

    new_loop = """    intensivas.forEach((a) => {
        const monthKey = a.dataInicio ? a.dataInicio.substring(0, 7) : '';
        if (monthKey && monthKey !== currentMonth) {
            appendMonthSeparator(monthKey);
            currentMonth = monthKey;
        }
        
        const info = getDisciplinaInfo(a.disciplina);
        const chMax = a.ch || info.ch;
        const feriadosSet = new Set(feriados.map(f => (f.data || f)));
        
        let faixasToUse = (a.faixas && a.faixas.length > 0) ? [...a.faixas].sort((x, y) => x.inicio.localeCompare(y.inicio)) : [{ inicio: a.dataInicio, slots: a.horariosOcupados || [], dias: a.diasMarcados || [1,2,3,4,5,6] }];
        
        let accumCH = 0;
        const overallEnd = a.dataFim;

        faixasToUse.forEach((f, idx) => {
            const rowStart = f.inicio;
            let rowEnd = overallEnd;
            if (idx < faixasToUse.length - 1) {
                const nextD = new Date(faixasToUse[idx + 1].inicio + 'T12:00:00');
                nextD.setDate(nextD.getDate() - 1);
                rowEnd = nextD.toISOString().split('T')[0];
            }

            let rowCH = 0, rowDayCount = 0, cur = new Date(rowStart + 'T12:00:00'), reObj = new Date(rowEnd + 'T12:00:00');
            if (reObj > new Date(overallEnd + 'T12:00:00')) reObj = new Date(overallEnd + 'T12:00:00');

            while (cur <= reObj && (accumCH + rowCH) < chMax) {
                const dStr = cur.toISOString().split('T')[0];
                if (!feriadosSet.has(dStr) && f.dias.includes(cur.getDay())) {
                     const dowSlots = f.drawnSlotsByDay ? (f.drawnSlotsByDay[cur.getDay()] || []) : f.slots;
                     if (dowSlots.length > 0) {
                        rowDayCount++;
                        const rem = chMax - (accumCH + rowCH);
                        if (dStr === overallEnd && a.horariosUltimoDia?.length > 0) rowCH += Math.min(a.horariosUltimoDia.length, rem);
                        else rowCH += Math.min(dowSlots.length, rem);
                     }
                }
                cur.setDate(cur.getDate() + 1);
            }

            const labelNomes = ["Primeira", "Segunda", "Terceira"];
            const exampleSlots = f.drawnSlotsByDay ? (f.drawnSlotsByDay[f.dias[0]] || []) : f.slots;
            const faixaLabel = `${labelNomes[idx] || (idx+1)+'ª'} faixa: ${rowDayCount} dias com ${exampleSlots ? exampleSlots.length : 0} aulas por dia`;
            
            let color = (accumCH + rowCH >= chMax) ? '#27ae60' : (idx === faixasToUse.length - 1 ? '#d35400' : '#2c3e50');
            
            appendRow({ ...a, faixaLabel: faixaLabel, isSubRow: idx > 0 }, { 
                start: rowStart, 
                end: rowEnd, 
                totalHoras: rowCH, 
                details: `${rowDayCount} dias`, 
                color: color 
            });
            accumCH += rowCH;
        });
    });"""

    if old_loop in content:
        content = content.replace(old_loop, new_loop)
        
        # Ajustar a cor e as disciplinas (labels)
        content = content.replace('let color = \'#2c3e50\';', 'let color = params.color || \'#2c3e50\';')
        content = content.replace('<td>${a.disciplina}</td>', '<td>${a.disciplina}${a.faixaLabel ? \'<br><small style="color:#666;">\'+a.faixaLabel+\'</small>\' : \'\'}</td>')

        with open(TARGET_FILE, 'w', encoding='utf-8') as f:
            f.write(content)
        print("VISUALIZAÇÃO DESMEMBRADA RESTAURADA COM SUCESSO.")
    else:
        print("NÃO FOI POSSÍVEL LOCALIZAR O LOOP ANTIGO.")

if __name__ == "__main__":
    restore_desaggregated_view_v2()
