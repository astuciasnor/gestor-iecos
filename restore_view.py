
import os
import re

TARGET_FILE = r'd:\Git\planejador-academico\gestor-iecos\js\ui.js'

def restore_desaggregated_view():
    print(f"Lendo {TARGET_FILE}...")
    with open(TARGET_FILE, 'r', encoding='utf-8') as f:
        content = f.read()

    # Vamos substituir o bloco de cálculo da intensiva dentro do forEach(a) do renderOfertasList
    # O bloco atual é algo como: } else { // CÁLCULO DINÂMICO DE HORAS (INTENSIVA): ... loop while ... totalHoras = totalHorasIntensiva; }
    
    # Lógica de renderização desmembrada
    new_render_logic = """        if (a.tipo !== 'intensiva') {
            const info = getDisciplinaInfo(a.disciplina);
            const chMax = a.ch || info.ch;
            let totalHoras = 0, details = '';
            const start = a.dataInicio || semestreInicio;
            const end = a.dataFim || semestreFim;
            
            if (a.tipo === 'pendente') {
                details = `Aguardando grade`;
            } else {
                const suspended = getSuspendedDates(store.allocations, a.turmaId, a.diaSemana, a.disciplina, start);
                const numAulasBase = countWeekdaysInPeriod(start, end, parseInt(a.diaSemana), feriados, suspended);
                const slotsDesseDia = store.allocations.filter(all => String(all.turmaId) === String(a.turmaId) && all.disciplina === a.disciplina && parseInt(all.diaSemana) === parseInt(a.diaSemana)).length;
                totalHoras = numAulasBase;
                if (a.horariosUltimoDia && a.horariosUltimoDia.length > 0 && slotsDesseDia > 0) {
                    if (!a.horariosUltimoDia.includes(a.horario) && numAulasBase > 0) totalHoras -= 1;
                }
                details = `${numAulasBase} semanas`;
            }

            let color = '#2c3e50';
            if (chMax > 0) {
                if (totalHoras < chMax) color = '#d35400';
                else if (totalHoras === chMax) color = '#27ae60';
                else color = '#c0392b';
            }
            appendRow(a, { start, end, totalHoras, details, color });

        } else {
            // CÁLCULO DESMEMBRADO POR FAIXA (INTENSIVA)
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
                const faixaLabel = `${labelNomes[idx] || (idx+1)+'ª'} faixa: ${rowDayCount} dias com ${exampleSlots ? exampleSlots.length : 0} aulas/dia`;
                
                let color = (accumCH + rowCH >= chMax) ? '#27ae60' : (idx === faixasToUse.length - 1 ? '#d35400' : '#2c3e50');
                
                appendRow({ ...a, faixaLabel, isSubRow: idx > 0 }, { start: rowStart, end: rowEnd, totalHoras: rowCH, details: `${rowDayCount} dias`, color });
                accumCH += rowCH;
            });
        }"""

    # Identificar a função appendRow e o loop foreach(a)
    # Procurar por: allSorted.forEach((a) => { ... })
    pattern_loop = re.compile(r'allSorted\.forEach\(\(a\)\s*=>\s*\{.*?(if\s*\(a\.tipo\s*===\s*\'pendente\'\).*?)\s*\}\);', re.DOTALL)
    
    # Mas no ui.js atual, parece que ele usa if (a.tipo === 'pendente') { ... } else if (a.tipo === 'regular' ...) { ... } else { ... (intensiva) }
    # Vamos ser mais genéricos: substituir do início do if (a.tipo === 'pendente') até o fim do bloco do else
    start_match = content.find("if (a.tipo === 'pendente') {", content.find("allSorted.forEach"))
    
    # Tenta achar o final desse bloco. Ele termina antes do final do forEach.
    # No ui.js atual (step 3280): lines 2262 to 2342
    if start_match != -1:
        # Achar o final do else que contém o cálculo da intensiva
        idx_intensiva = content.find("// CÁLCULO DINÂMICO DE HORAS (INTENSIVA)", start_match)
        if idx_intensiva != -1:
            end_else = content.find("}", idx_intensiva) + 1
            # Se tiver o código de cor e sigla depois do else, precisamos incluir no novo bloco ou ajustar
            # No ui.js atual, a cor e sigla estão DEPOIS do fechamento do else (lines 2344-2394)
            # Então substituímos apenas lines 2262 a 2342.
            content = content[:start_match] + new_render_logic + content[end_else:]
            
            # Ajustar a função appendRow interna para aceitar um objeto de params
            content = content.replace("const appendRow = (a) => {", "const appendRow = (a, params) => {")
            content = content.replace("const start = a.dataInicio || semestreInicio;", "const start = params.start;")
            content = content.replace("const end = a.dataFim || semestreFim;", "const end = params.end;")
            content = content.replace("let totalHoras = 0, details = '';", "let totalHoras = params.totalHoras || 0, details = params.details || '';")
            content = content.replace("let color = '#2c3e50';", "let color = params.color || '#2c3e50';")
            
            # Ajustar o innerHTML da appendRow para usar a label de faixa se existir
            content = content.replace("<td>${a.disciplina}</td>", "<td>${a.disciplina}${a.faixaLabel ? '<br><small style=\"color:#666;\">'+a.faixaLabel+'</small>' : ''}</td>")

            with open(TARGET_FILE, 'w', encoding='utf-8') as f:
                f.write(content)
            print("VISUALIZAÇÃO DESMEMBRADA RESTAURADA.")
        else:
            print("Não foi possível localizar o bloco de cálculo de intensiva.")
    else:
        print("Não foi possível localizar o início do loop de renderização.")

if __name__ == "__main__":
    restore_desaggregated_view()
