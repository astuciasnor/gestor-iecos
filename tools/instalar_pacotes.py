#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Script auxiliar para instalar as dependências do projeto IECOS.
Lê automaticamente o arquivo requirements.txt na mesma pasta.
"""

import subprocess
import sys
from pathlib import Path

def check_virtual_env():
    """Verifica se o script está rodando dentro de um ambiente virtual (.venv)"""
    # Verifica propriedades que indicam a presença de um venv
    is_venv = hasattr(sys, 'real_prefix') or (hasattr(sys, 'base_prefix') and sys.base_prefix != sys.prefix)
    return is_venv

def main():
    print("="*50)
    print("🚀 INSTALADOR DE DEPENDÊNCIAS - GESTOR IECOS")
    print("="*50)

    # 1. Descobre a pasta onde este script está (tools/)
    tools_dir = Path(__file__).resolve().parent
    
    # 2. Caminho para o requirements.txt
    req_file = tools_dir / "requirements.txt"

    if not req_file.exists():
        print(f"\n❌ ERRO: Arquivo '{req_file.name}' não encontrado na pasta '{tools_dir.name}'.")
        print("Certifique-se de criar o arquivo requirements.txt junto deste script.")
        sys.exit(1)

    print(f"\n📦 Lendo pacotes de: {req_file}")
    print(f"🐍 Interpretador Python atual: {sys.executable}")
    
    # 3. Trava de Segurança: Checa o Ambiente Virtual (.venv)
    if check_virtual_env():
        print("✅ Ambiente virtual (.venv) detectado. Tudo certo!")
    else:
        print("\n⚠️  AVISO DE SEGURANÇA: Você NÃO está rodando dentro do seu '.venv'!")
        print("Se continuar, os pacotes serão instalados no Python global do seu computador.")
        print("Recomendação: Cancele, ative o .venv e rode novamente.")
        resposta = input("\nDeseja continuar a instalação MESMO ASSIM? (s/N): ")
        if resposta.strip().lower() != 's':
            print("🛑 Operação cancelada com segurança.")
            sys.exit(0)

    # 4. Executa a instalação via PIP
    print("\n⏳ Iniciando o download e instalação... Aguarde.\n")
    try:
        # É o equivalente a rodar: pip install -r tools/requirements.txt
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", str(req_file)])
        print("\n🎉 SUCESSO! Todos os pacotes foram instalados corretamente.")
        print("O ambiente está pronto para rodar o conversor (convert_data.py).")
    except subprocess.CalledProcessError as e:
        print(f"\n❌ Ocorreu um erro durante a instalação do PIP. Código do erro: {e.returncode}")
        sys.exit(1)

if __name__ == "__main__":
    main()