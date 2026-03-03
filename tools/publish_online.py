#!/usr/bin/env python3
"""
Publica o arquivo alocacoes_publicas.json com validacoes e travas de seguranca.

Uso típico:
  python tools/publish_online.py --from-download "%USERPROFILE%\\Downloads\\alocacoes_publicas.json" --push
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


REQUIRED_WEB_FILES = (
    "index.html",
    "agenda_discente.html",
    "agenda_docente.html",
    "js/main.js",
)

PUBLIC_URL = "https://astuciasnor.github.io/gestor-iecos/"
PUBLIC_JSON_URL = "https://astuciasnor.github.io/gestor-iecos/alocacoes_publicas.json"


def run_git(repo_root: Path, args: list[str], check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args],
        cwd=repo_root,
        check=check,
        capture_output=True,
        text=True,
    )


def is_iso_date(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        return False
    return True


def validate_public_json(payload: Any) -> list[str]:
    errors: list[str] = []
    if not isinstance(payload, dict):
        return ["JSON publico deve ser um objeto com campos allocations e settings."]

    allocations = payload.get("allocations")
    settings = payload.get("settings")

    if not isinstance(allocations, list):
        errors.append("Campo allocations ausente ou invalido (esperado: array).")
    elif not allocations:
        errors.append("Campo allocations esta vazio; publicacao bloqueada.")
    else:
        bad_indexes = [i for i, item in enumerate(allocations) if not isinstance(item, dict)]
        if bad_indexes:
            errors.append(f"allocations contem itens invalidos (indices: {bad_indexes[:5]}).")

    if not isinstance(settings, dict):
        errors.append("Campo settings ausente ou invalido (esperado: objeto).")
        return errors

    term_start = settings.get("termStart")
    term_end = settings.get("termEnd")
    if not is_iso_date(term_start):
        errors.append("settings.termStart invalido (esperado YYYY-MM-DD).")
    if not is_iso_date(term_end):
        errors.append("settings.termEnd invalido (esperado YYYY-MM-DD).")
    if is_iso_date(term_start) and is_iso_date(term_end) and term_start > term_end:
        errors.append("settings.termStart e maior que settings.termEnd.")

    return errors


def ensure_required_files(repo_root: Path) -> list[str]:
    missing = []
    for rel in REQUIRED_WEB_FILES:
        if not (repo_root / rel).exists():
            missing.append(rel)
    return missing


def require_clean_tree(repo_root: Path, allow_dirty: bool) -> None:
    status = run_git(repo_root, ["status", "--porcelain"], check=True).stdout.strip()
    if status and not allow_dirty:
        print("Erro: repositorio com alteracoes pendentes.", file=sys.stderr)
        print("Use --allow-dirty para ignorar esta trava.", file=sys.stderr)
        print("\nArquivos pendentes:", file=sys.stderr)
        for line in status.splitlines()[:20]:
            print(f"  {line}", file=sys.stderr)
        raise SystemExit(1)


def require_main_branch(repo_root: Path, allow_non_main: bool) -> None:
    branch = run_git(repo_root, ["branch", "--show-current"], check=True).stdout.strip()
    if branch != "main" and not allow_non_main:
        print(
            f"Erro: branch atual e '{branch}'. Publique em 'main' ou use --allow-non-main.",
            file=sys.stderr,
        )
        raise SystemExit(1)


def write_public_file(payload: Any, target_path: Path) -> None:
    target_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def has_staged_changes(repo_root: Path, relpath: str) -> bool:
    result = run_git(repo_root, ["diff", "--cached", "--quiet", "--", relpath], check=False)
    return result.returncode == 1


def confirm(prompt: str) -> bool:
    answer = input(f"{prompt} [s/N]: ").strip().lower()
    return answer in {"s", "sim", "y", "yes"}


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    default_source = repo_root / "alocacoes_publicas.json"
    default_target = repo_root / "alocacoes_publicas.json"

    parser = argparse.ArgumentParser(
        description="Automatiza a publicacao do alocacoes_publicas.json (commit e push opcional)."
    )
    parser.add_argument(
        "--from-download",
        dest="source",
        default=str(default_source),
        help="Caminho do JSON gerado pelo botao Publicar Online.",
    )
    parser.add_argument(
        "--target",
        default=str(default_target),
        help="Destino do arquivo público no repositório.",
    )
    parser.add_argument(
        "--message",
        default="chore: atualizar alocacoes_publicas.json",
        help="Mensagem do commit.",
    )
    parser.add_argument(
        "--push",
        action="store_true",
        help="Executa git push origin main apos commit.",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Pula confirmacoes interativas.",
    )
    parser.add_argument(
        "--allow-dirty",
        action="store_true",
        help="Permite publicar com mudancas locais ja existentes.",
    )
    parser.add_argument(
        "--allow-non-main",
        action="store_true",
        help="Permite rodar em branch diferente de main.",
    )
    args = parser.parse_args()

    source_path = Path(args.source).expanduser().resolve()
    target_path = Path(args.target).expanduser().resolve()

    if not source_path.exists():
        print(f"Erro: arquivo de origem nao encontrado: {source_path}", file=sys.stderr)
        return 1

    missing = ensure_required_files(repo_root)
    if missing:
        print("Erro: arquivos essenciais do frontend nao encontrados:", file=sys.stderr)
        for rel in missing:
            print(f"  - {rel}", file=sys.stderr)
        return 1

    require_main_branch(repo_root, allow_non_main=args.allow_non_main)
    require_clean_tree(repo_root, allow_dirty=args.allow_dirty)

    try:
        payload = json.loads(source_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"Erro: JSON invalido em {source_path}: {exc}", file=sys.stderr)
        return 1

    errors = validate_public_json(payload)
    if errors:
        print("Erro: validacao falhou. Publicacao cancelada.", file=sys.stderr)
        for item in errors:
            print(f"  - {item}", file=sys.stderr)
        return 1

    allocations_count = len(payload.get("allocations", []))
    settings = payload.get("settings", {})
    term_start = settings.get("termStart")
    term_end = settings.get("termEnd")

    print("Resumo da publicacao:")
    print(f"  Origem: {source_path}")
    print(f"  Destino: {target_path}")
    print(f"  Alocações: {allocations_count}")
    print(f"  Período: {term_start} a {term_end}")

    if not args.yes and not confirm("Confirmar gravacao e commit do arquivo publico?"):
        print("Operacao cancelada.")
        return 0

    write_public_file(payload, target_path)
    rel_target = target_path.relative_to(repo_root).as_posix()

    run_git(repo_root, ["add", "--", rel_target], check=True)
    if not has_staged_changes(repo_root, rel_target):
        print("Nenhuma alteracao detectada em alocacoes_publicas.json. Nada para commitar.")
        print(f"URL pública: {PUBLIC_URL}")
        print(f"JSON público: {PUBLIC_JSON_URL}")
        return 0

    run_git(repo_root, ["commit", "-m", args.message], check=True)
    print("Commit criado com sucesso.")

    if args.push:
        if args.yes or confirm("Deseja enviar para origin/main agora?"):
            run_git(repo_root, ["push", "origin", "main"], check=True)
            print("Push concluido. Publicacao no GitHub Pages sera atualizada.")
        else:
            print("Push nao executado. Faca manualmente quando desejar.")

    print(f"URL pública: {PUBLIC_URL}")
    print(f"JSON público: {PUBLIC_JSON_URL}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
