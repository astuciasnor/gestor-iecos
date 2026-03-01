
import os

TARGET_FILE = r'd:\Git\planejador-academico\gestor-iecos\js\ui.js'

def fix_syntax_error():
    print(f"Lendo {TARGET_FILE}...")
    with open(TARGET_FILE, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    modified = False
    for i in range(len(lines)):
        # Corrigir duplicação e fSlotsSet
        if 'const fDias = Array.from(fDiasSet).sort((a, b) => a - b);const fDias = Array.from(fDiasSet).sort((a, b) => a - b);' in lines[i]:
            print(f"Corrigindo linha {i+1}...")
            # Detectar indentação
            indent = lines[i][:lines[i].find('const fDias')]
            lines[i] = f"{indent}const fDias = Array.from(fDiasSet).sort((a, b) => a - b);\n"
            
            # Verificar a linha seguinte para fSlotsSet
            if i+1 < len(lines) and 'const fSlots = Array.from(fSlotsSet)' in lines[i+1]:
                print(f"Corrigindo referência fSlotsSet na linha {i+2}...")
                lines[i+1] = lines[i+1].replace('Array.from(fSlotsSet)', 'Array.from(allFSlotsSet)')
            modified = True
            break # Só esperamos uma ocorrência desse erro específico

    if modified:
        with open(TARGET_FILE, 'w', encoding='utf-8') as f:
            f.writelines(lines)
        print("SINTAXE CORRIGIDA COM SUCESSO.")
    else:
        print("Marcador de erro não encontrado. Verificando alternativas...")
        # Alternativa: Substituição de string bruta se a quebra de linha estiver estranha
        content = "".join(lines)
        target = 'const fDias = Array.from(fDiasSet).sort((a, b) => a - b);const fDias = Array.from(fDiasSet).sort((a, b) => a - b);'
        if target in content:
            print("Encontrado via string bruta. Substituindo...")
            content = content.replace(target, 'const fDias = Array.from(fDiasSet).sort((a, b) => a - b);')
            content = content.replace('fSlots = Array.from(fSlotsSet)', 'fSlots = Array.from(allFSlotsSet)')
            with open(TARGET_FILE, 'w', encoding='utf-8') as f:
                f.write(content)
            print("SINTAXE CORRIGIDA VIA STRING BRUTA.")
        else:
            print("ERRO: Não foi possível localizar o erro de sintaxe.")

if __name__ == "__main__":
    fix_syntax_error()
