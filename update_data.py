import pandas as pd
import json
import os
from datetime import datetime

# CONFIGURAÇÃO
CSV_FILE = 'componentes.csv'
JSON_FILE = 'dados_app.json'

def update_json_from_csv():
    if not os.path.exists(JSON_FILE):
        print(f"Erro: {JSON_FILE} não encontrado. Crie o arquivo base primeiro.")
        return

    # 1. Carregar JSON existente
    with open(JSON_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # 2. Carregar CSV com tratamento de erro
    try:
        df = pd.read_csv(CSV_FILE)
        # Limpar nomes das colunas (remover espaços extras e deixar minúsculo)
        df.columns = [c.strip().lower() for c in df.columns]
    except Exception as e:
        print(f"Erro crítico ao ler CSV: {e}")
        return

    # 3. Identificar a coluna de Sigla do Curso
    col_sigla = None
    possiveis_nomes = ['curso_sigla', 'curso', 'sigla', 'sigla_curso', 'cursosigla']
    
    for nome in possiveis_nomes:
        if nome in df.columns:
            col_sigla = nome
            break
    
    if not col_sigla:
        print("ERRO: Não encontrei a coluna 'curso_sigla' no CSV.")
        print(f"Colunas encontradas: {list(df.columns)}")
        print("Adicione uma coluna 'curso_sigla' com valores 'EP', 'CB', etc.")
        return

    print(f"Lendo dados... (Coluna de vínculo encontrada: '{col_sigla}')")
    
    novas_disciplinas = []

    # 4. Processar linhas
    for index, row in df.iterrows():
        # Tratamento seguro para campos vazios
        codigo = str(row.get('codigo', '')).strip()
        if codigo == 'nan': codigo = ''
        
        nome = str(row.get('nome', '')).strip()
        
        # Pega a cor ou usa cinza padrão
        cor = str(row.get('cordisciplina', '')).strip()
        if not cor or cor == 'nan': cor = '#bdc3c7'

        # Pega CH
        try:
            ch = int(float(row.get('ch', 0)))
        except:
            ch = 0

        # Pega Sigla do Curso (O MAIS IMPORTANTE)
        sigla = str(row.get(col_sigla, '')).strip().upper() # Força maiúsculo (EP, CB)
        if sigla == 'NAN': sigla = ''

        disc = {
            "codigo": codigo,
            "nome": nome,
            "abreviacao": str(row.get('abreviacao', nome)).strip() or nome, # Usa nome se abrev for vazio
            "ch": ch,
            "cor_disciplina": cor,
            "curso_sigla": sigla  # VÍNCULO CRUCIAL
        }
        novas_disciplinas.append(disc)

    # 5. Salvar
    data['disciplinas'] = novas_disciplinas
    data['atualizado_em'] = datetime.now().strftime("%d/%m/%Y %H:%M")

    with open(JSON_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"Sucesso! {len(novas_disciplinas)} disciplinas importadas.")
    print("Verifique se o campo 'curso_sigla' está preenchido no dados_app.json")

if __name__ == "__main__":
    update_json_from_csv()