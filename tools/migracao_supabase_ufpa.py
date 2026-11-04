"""Copia usuarios e alocacoes do Supabase para o banco da UFPA (MariaDB).

Entrada: os dois CSV baixados do SQL Editor do Supabase (consultas abaixo).
Saida:   importar_ufpa.sql, para importar no phpMyAdmin (aba Importar).

Uso:
    python tools/migracao_supabase_ufpa.py PASTA
PASTA deve conter usuarios.csv e alocacoes.csv; o .sql e gravado nela.
Use uma pasta FORA do repositorio: os CSV trazem os hashes das senhas.

Pode ser repetido: a importacao substitui as alocacoes, atualiza os usuarios
pelo id, zera o historico e encerra as sessoes (todos entram de novo).

Consulta 1 (salvar como usuarios.csv):
    select u.id, u.email, u.encrypted_password as senha_hash,
           coalesce((u.raw_user_meta_data->>'senha_definida')::boolean, false) as senha_definida,
           coalesce(p.nome, '') as nome, coalesce(p.curso, '') as curso,
           coalesce(p.papel, 'coordenador') as papel, u.created_at as criado_em,
           count(*) over () as total
    from auth.users u left join public.perfis p on p.usuario = u.id
    order by u.email;

Consulta 2 (salvar como alocacoes.csv):
    select id, plano, curso, turma, dados::text as dados, atualizado_em, atualizado_por,
           count(*) over () as total
    from public.alocacoes
    order by plano, id;
"""
import csv
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

BELEM = timezone(timedelta(hours=-3))  # horario do servidor da UFPA (sem horario de verao)
LOTE = 200  # linhas por INSERT


def sql_texto(valor):
    if valor is None:
        return 'NULL'
    s = str(valor)
    s = (s.replace('\\', '\\\\').replace("'", "\\'").replace('\0', '\\0')
          .replace('\n', '\\n').replace('\r', '\\r').replace('\x1a', '\\Z'))
    return "'" + s + "'"


def sql_data(valor):
    """Data do Postgres (UTC, ex. 2026-10-29 14:03:11.123456+00) -> horario de Belem."""
    if not valor:
        return 'NULL'
    v = valor.strip().replace('T', ' ')
    if v.endswith('+00'):
        v += ':00'
    dt = datetime.fromisoformat(v.replace('Z', '+00:00'))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    local = dt.astimezone(BELEM)
    return "'" + local.strftime('%Y-%m-%d %H:%M:%S.') + f'{local.microsecond // 1000:03d}' + "'"


def ler_csv(caminho, colunas):
    csv.field_size_limit(1 << 30)
    with open(caminho, encoding='utf-8-sig', newline='') as f:
        linhas = list(csv.DictReader(f))
    if not linhas:
        sys.exit(f'{caminho.name}: arquivo sem linhas.')
    faltando = [c for c in colunas + ['total'] if c not in linhas[0]]
    if faltando:
        sys.exit(f'{caminho.name}: faltam as colunas {faltando}. Rodou a consulta certa?')
    total = int(linhas[0]['total'])
    if len(linhas) != total:
        sys.exit(f'{caminho.name}: veio {len(linhas)} de {total} linhas. '
                 'O Supabase cortou o resultado; baixe de novo sem limite de linhas.')
    return linhas


def booleano(valor):
    return 1 if str(valor).strip().lower() in ('true', 't', '1') else 0


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    pasta = Path(sys.argv[1])
    usuarios = ler_csv(pasta / 'usuarios.csv',
                       ['id', 'email', 'senha_hash', 'senha_definida', 'nome', 'curso', 'papel', 'criado_em'])
    alocacoes = ler_csv(pasta / 'alocacoes.csv',
                        ['id', 'plano', 'curso', 'turma', 'dados', 'atualizado_em', 'atualizado_por'])

    for u in usuarios:
        if not u['senha_hash'].startswith('$2'):
            sys.exit(f"Usuario {u['email']}: senha sem formato bcrypt.")
        if u['papel'] not in ('coordenador', 'admin'):
            sys.exit(f"Usuario {u['email']}: papel desconhecido '{u['papel']}'.")
    for a in alocacoes:
        dados = json.loads(a['dados'])  # para se o JSON vier quebrado
        if dados.get('id') != a['id']:
            sys.exit(f"Alocacao {a['id']}: o id dentro de dados nao confere.")

    saida = [
        '-- Gerado por tools/migracao_supabase_ufpa.py em '
        + datetime.now().strftime('%Y-%m-%d %H:%M'),
        f'-- {len(usuarios)} usuarios, {len(alocacoes)} alocacoes',
        'SET NAMES utf8mb4;',
        'START TRANSACTION;',
        '',
        '-- Usuarios: mesmo id do Supabase; atualiza quem ja existe.',
    ]
    valores = [
        '(' + ', '.join([sql_texto(u['id']), sql_texto(u['email'].strip().lower()), sql_texto(u['senha_hash']),
                         str(booleano(u['senha_definida'])), sql_texto(u['nome']), sql_texto(u['curso']),
                         sql_texto(u['papel']), sql_data(u['criado_em'])]) + ')'
        for u in usuarios
    ]
    saida.append('INSERT INTO usuarios (id, email, senha_hash, senha_definida, nome, curso, papel, criado_em) VALUES\n'
                 + ',\n'.join(valores)
                 + '\nON DUPLICATE KEY UPDATE email = VALUES(email), senha_hash = VALUES(senha_hash),'
                   ' senha_definida = VALUES(senha_definida), nome = VALUES(nome), curso = VALUES(curso),'
                   ' papel = VALUES(papel);')
    saida += [
        '',
        '-- Alocacoes: substitui tudo pelo que esta no Supabase.',
        'DELETE FROM alocacoes;',
        'DELETE FROM alocacoes_historico;',
    ]
    for i in range(0, len(alocacoes), LOTE):
        valores = [
            '(' + ', '.join([sql_texto(a['id']), sql_texto(a['plano']), sql_texto(a['curso']), sql_texto(a['turma']),
                             sql_texto(a['dados']), sql_data(a['atualizado_em']),
                             sql_texto(a['atualizado_por']) if a['atualizado_por'] else 'NULL']) + ')'
            for a in alocacoes[i:i + LOTE]
        ]
        saida.append('INSERT INTO alocacoes (id, plano, curso, turma, dados, atualizado_em, atualizado_por) VALUES\n'
                     + ',\n'.join(valores) + ';')
    saida += [
        '',
        '-- Todos entram de novo; zera bloqueios por senha errada.',
        'DELETE FROM sessoes;',
        'DELETE FROM login_tentativas;',
        'COMMIT;',
        '',
    ]
    destino = pasta / 'importar_ufpa.sql'
    destino.write_text('\n'.join(saida), encoding='utf-8')

    print(f'{len(usuarios)} usuarios e {len(alocacoes)} alocacoes -> {destino}')
    for u in usuarios:
        print(f"  {u['email']:<40} {u['curso'] or '-':<4} {u['papel']}")
    por_curso = {}
    for a in alocacoes:
        por_curso[a['curso']] = por_curso.get(a['curso'], 0) + 1
    print('  alocacoes por curso: ' + ', '.join(f'{c}={n}' for c, n in sorted(por_curso.items())))


if __name__ == '__main__':
    main()
