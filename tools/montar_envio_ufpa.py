"""Monta a pasta com o que vai para o servidor da UFPA pelo FileZilla.

Uso (na raiz do projeto):
    python tools/montar_envio_ufpa.py

Cria (ou refaz) ../cardume_envio_ufpa, ao lado do repositorio. Nunca inclui
api/config.php: o do servidor tem a senha do banco e nao deve ser sobrescrito.
No FileZilla: esquerda nessa pasta, direita em /, selecionar tudo e arrastar.
"""
import shutil
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DESTINO = RAIZ.parent / 'cardume_envio_ufpa'
ARQUIVOS = ['.htaccess', 'index.html', 'agenda_publica.html', 'dados_app.json', 'alocacoes_publicas.json',
            'api/index.php', 'api/.htaccess']
PASTAS = ['css', 'img', 'js', 'publicacoes']


def main():
    if DESTINO.exists():
        shutil.rmtree(DESTINO)
    for nome in ARQUIVOS:
        alvo = DESTINO / nome
        alvo.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(RAIZ / nome, alvo)
    for nome in PASTAS:
        shutil.copytree(RAIZ / nome, DESTINO / nome, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    arquivos = [p for p in DESTINO.rglob('*') if p.is_file()]
    assert not (DESTINO / 'api' / 'config.php').exists()
    tamanho = sum(p.stat().st_size for p in arquivos) / 1024 / 1024
    print(f'{len(arquivos)} arquivos ({tamanho:.1f} MB) em {DESTINO}')
    print('Sem api/config.php (o do servidor fica como esta).')


if __name__ == '__main__':
    main()
