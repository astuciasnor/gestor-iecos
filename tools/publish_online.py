#!/usr/bin/env python3
"""
Publica o arquivo alocacoes_publicas.json com validacoes e travas de seguranca.

Uso tipico:
  python tools/publish_online.py
  python tools/publish_online.py --check
  python tools/publish_online.py --no-git
  python tools/publish_online.py --push
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime
from os import PathLike
from pathlib import Path
from typing import Any


REQUIRED_WEB_FILES = (
    "index.html",
    "agenda_publica.html",
    "js/main.js",
)

PUBLIC_URL = "https://astuciasnor.github.io/gestor-iecos/"
PUBLIC_JSON_URL = "https://astuciasnor.github.io/gestor-iecos/alocacoes_publicas.json"
PUBLIC_DOWNLOAD_GLOB = "alocacoes_publicas*.json"


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


def get_git_status(repo_root: Path) -> str:
    return run_git(repo_root, ["status", "--porcelain"], check=True).stdout.strip()


def get_git_branch(repo_root: Path) -> str:
    return run_git(repo_root, ["branch", "--show-current"], check=True).stdout.strip()


def debug_print(enabled: bool, label: str, value: Any) -> None:
    if enabled:
        print(f"[debug] {label}: {value}")


def require_clean_tree(repo_root: Path, allow_dirty: bool, status: str | None = None) -> None:
    status = get_git_status(repo_root) if status is None else status
    if status and not allow_dirty:
        print("Erro: repositorio com alteracoes pendentes.", file=sys.stderr)
        print("Use --allow-dirty para ignorar esta trava.", file=sys.stderr)
        print("\nArquivos pendentes:", file=sys.stderr)
        for line in status.splitlines()[:20]:
            print(f"  {line}", file=sys.stderr)
        raise SystemExit(1)


def require_main_branch(repo_root: Path, allow_non_main: bool, branch: str | None = None) -> None:
    branch = get_git_branch(repo_root) if branch is None else branch
    if branch != "main" and not allow_non_main:
        print(
            f"Erro: branch atual e '{branch}'. Publique em 'main' ou use --allow-non-main.",
            file=sys.stderr,
        )
        raise SystemExit(1)


def can_run_git_publish(
    allow_dirty: bool,
    allow_non_main: bool,
    branch: str,
    git_status: str,
) -> tuple[bool, list[str]]:
    reasons: list[str] = []
    if branch != "main" and not allow_non_main:
        reasons.append(f"branch atual e '{branch}' (use --allow-non-main para ignorar)")
    if git_status and not allow_dirty:
        reasons.append("repositorio com alteracoes pendentes (use --allow-dirty para ignorar)")
    return (not reasons), reasons


def write_public_file(payload: Any, target_path: Path) -> None:
    target_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def has_staged_changes(repo_root: Path, relpath: str) -> bool:
    result = run_git(repo_root, ["diff", "--cached", "--quiet", "--", relpath], check=False)
    return result.returncode == 1


def file_size_or_none(path: Path) -> int | None:
    if not path.exists() or not path.is_file():
        return None
    return path.stat().st_size


def confirm(prompt: str) -> bool:
    answer = input(f"{prompt} [s/N]: ").strip().lower()
    return answer in {"s", "sim", "y", "yes"}


def get_downloads_dir() -> Path:
    return Path.home() / "Downloads"


def expand_path_string(value: str | PathLike[str]) -> str:
    return os.path.expandvars(str(value))


def resolve_input_path(value: str | PathLike[str]) -> Path:
    expanded = expand_path_string(value)
    return Path(expanded).expanduser().resolve()


def find_latest_public_download(downloads_dir: Path) -> Path | None:
    if not downloads_dir.exists():
        return None

    candidates = [p for p in downloads_dir.glob(PUBLIC_DOWNLOAD_GLOB) if p.is_file()]
    if not candidates:
        return None

    candidates.sort(key=lambda p: (p.stat().st_mtime, p.name.lower()), reverse=True)
    return candidates[0]


def resolve_source_path(
    source_arg: str | PathLike[str] | None,
    repo_default: Path,
) -> tuple[Path | None, str]:
    if source_arg:
        source_path = resolve_input_path(source_arg)
        return source_path, "manual"

    latest_download = find_latest_public_download(get_downloads_dir())
    if latest_download is not None:
        return latest_download.resolve(), "downloads"

    if repo_default.exists():
        return repo_default.resolve(), "repo"

    return None, "missing"


def build_target_content(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def describe_source_mode(source_mode: str) -> str:
    if source_mode == "manual":
        return "Origem informada manualmente."
    if source_mode == "downloads":
        return "Origem detectada automaticamente em Downloads."
    if source_mode == "repo":
        return "Origem automatica nao encontrada em Downloads; usando arquivo atual do repositorio."
    return "Origem nao identificada."


def print_publication_summary(
    source_mode: str,
    source_path: Path,
    target_path: Path,
    allocations_count: int,
    term_start: Any,
    term_end: Any,
) -> None:
    print("Resumo da publicacao:")
    print(f"  {describe_source_mode(source_mode)}")
    print(f"  Origem: {source_path}")
    print(f"  Destino: {target_path}")
    print(f"  Alocacoes: {allocations_count}")
    print(f"  Periodo: {term_start} a {term_end}")


def print_public_urls() -> None:
    print(f"URL publica: {PUBLIC_URL}")
    print(f"JSON publico: {PUBLIC_JSON_URL}")


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    default_target = repo_root / "alocacoes_publicas.json"

    parser = argparse.ArgumentParser(
        description="Automatiza a publicacao do alocacoes_publicas.json (commit e push opcional)."
    )
    parser.add_argument(
        "--from-download",
        dest="source",
        default=None,
        help="Caminho do JSON gerado pelo botao Publicar Online. Se omitido, usa o mais recente em Downloads.",
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
        "--check",
        action="store_true",
        help="Apenas localiza, valida e resume a publicacao, sem gravar ou executar Git.",
    )
    parser.add_argument(
        "--no-git",
        action="store_true",
        help="Grava o arquivo localmente, mas pula git add, commit e push.",
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
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Exibe detalhes internos do fluxo de publicacao.",
    )
    args = parser.parse_args()

    source_path, source_mode = resolve_source_path(args.source, default_target)
    target_path = resolve_input_path(args.target)

    branch = get_git_branch(repo_root)
    git_status = get_git_status(repo_root)
    target_existed_before = target_path.exists()
    git_publish_allowed, git_publish_reasons = can_run_git_publish(
        allow_dirty=args.allow_dirty,
        allow_non_main=args.allow_non_main,
        branch=branch,
        git_status=git_status,
    )

    debug_print(args.debug, "repo_root", repo_root)
    debug_print(args.debug, "source_mode", source_mode)
    debug_print(args.debug, "source_path", source_path if source_path is not None else "<nenhum>")
    debug_print(args.debug, "source_exists", bool(source_path and source_path.exists()))
    debug_print(args.debug, "target_path", target_path)
    debug_print(args.debug, "target_exists_before", target_existed_before)
    debug_print(args.debug, "target_size_before", file_size_or_none(target_path))
    debug_print(args.debug, "branch_atual", branch)
    debug_print(args.debug, "git_status", git_status or "<limpo>")

    if source_mode == "missing" or source_path is None:
        print("Erro: nenhuma origem valida foi encontrada.", file=sys.stderr)
        print(
            "Nao foi encontrado nenhum arquivo compativel em Downloads e tambem nao existe "
            "alocacoes_publicas.json na raiz do repositorio.",
            file=sys.stderr,
        )
        print(
            "Proximo passo: gere o arquivo pelo botao Publicar Online ou informe a origem com "
            "--from-download.",
            file=sys.stderr,
        )
        return 1

    if not source_path.exists():
        print(f"Erro: arquivo de origem nao encontrado: {source_path}", file=sys.stderr)
        print(
            "Proximo passo: confirme o caminho informado ou gere um novo download antes de rodar o script.",
            file=sys.stderr,
        )
        return 1

    missing = ensure_required_files(repo_root)
    if missing:
        print("Erro: arquivos essenciais do frontend nao encontrados:", file=sys.stderr)
        for rel in missing:
            print(f"  - {rel}", file=sys.stderr)
        return 1

    try:
        print(f"Arquivo de origem encontrado: {source_path}")
        debug_print(args.debug, "source_size", file_size_or_none(source_path))
        print("Lendo conteudo do JSON de origem...")
        payload = json.loads(source_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"Erro: JSON invalido em {source_path}: {exc}", file=sys.stderr)
        print(
            "Proximo passo: gere novamente o arquivo pelo botao Publicar Online e repita a validacao.",
            file=sys.stderr,
        )
        return 1

    print("JSON lido com sucesso.")
    errors = validate_public_json(payload)
    if errors:
        print("Erro: a validacao do JSON falhou. Publicacao cancelada.", file=sys.stderr)
        for item in errors:
            print(f"  - {item}", file=sys.stderr)
        print(
            "Proximo passo: corrija o arquivo de origem ou gere um novo export antes de publicar.",
            file=sys.stderr,
        )
        return 1
    print("JSON validado com sucesso.")

    allocations_count = len(payload.get("allocations", []))
    settings = payload.get("settings", {})
    term_start = settings.get("termStart")
    term_end = settings.get("termEnd")

    print_publication_summary(
        source_mode=source_mode,
        source_path=source_path,
        target_path=target_path,
        allocations_count=allocations_count,
        term_start=term_start,
        term_end=term_end,
    )

    if args.check:
        print("Verificacao concluida com sucesso. Nenhum arquivo foi gravado e nenhuma etapa Git foi executada.")
        print("Se desejar publicar depois, rode: python tools/publish_online.py --push")
        print_public_urls()
        return 0

    confirm_prompt = "Confirmar gravacao do arquivo publico?"
    if not args.no_git:
        confirm_prompt = "Confirmar gravacao e commit do arquivo publico?"

    if not args.yes and not confirm(confirm_prompt):
        print("Operacao cancelada.")
        return 0

    target_content = build_target_content(payload)
    target_parent = target_path.parent
    if not target_parent.exists():
        print(f"Criando diretorio de destino: {target_parent}")
        target_parent.mkdir(parents=True, exist_ok=True)

    target_had_same_content = False
    if target_existed_before and target_path.is_file():
        try:
            target_had_same_content = target_path.read_text(encoding="utf-8") == target_content
        except OSError:
            target_had_same_content = False

    if target_existed_before:
        print(f"Arquivo de destino ja existia e sera sobrescrito: {target_path}")
    else:
        print(f"Arquivo de destino sera criado na raiz do projeto: {target_path}")

    if not target_had_same_content:
        write_public_file(payload, target_path)
        print("Arquivo de destino gravado com sucesso.")
    else:
        print("Arquivo de destino ja continha conteudo identico; nenhuma regravacao foi necessaria.")

    debug_print(args.debug, "target_exists_after", target_path.exists())
    debug_print(args.debug, "target_size_after", file_size_or_none(target_path))

    if args.no_git:
        print("Atualizacao local concluida com sucesso.")
        print("Nenhuma etapa Git foi executada porque voce usou --no-git.")
        print("Quando quiser publicar, rode novamente sem --no-git ou use --push.")
        if args.push:
            print("Observacao: --push foi ignorado porque --no-git desativa git add, commit e push.")
        print_public_urls()
        return 0

    if not git_publish_allowed:
        print("Arquivo de destino resolvido e atualizado localmente com sucesso.")
        print("A etapa Git foi bloqueada pelas travas de seguranca:")
        for reason in git_publish_reasons:
            print(f"  - {reason}")
        print("Proximo passo: regularize o Git e rode novamente para commitar ou publicar.")
        print_public_urls()
        return 0

    rel_target = target_path.relative_to(repo_root).as_posix()

    run_git(repo_root, ["add", "--", rel_target], check=True)
    if not has_staged_changes(repo_root, rel_target):
        print(
            "O arquivo publico foi validado e comparado com o repositorio, mas o conteudo final ja era "
            "identico ao existente. Nao ha alteracao para commitar."
        )
        print("Proximo passo: nenhum. O repositorio ja estava atualizado.")
        print_public_urls()
        return 0

    run_git(repo_root, ["commit", "-m", args.message], check=True)
    print("Commit criado com sucesso.")

    if args.push:
        if args.yes or confirm("Deseja enviar para origin/main agora?"):
            run_git(repo_root, ["push", "origin", "main"], check=True)
            print("Push concluido. A publicacao no GitHub Pages sera atualizada em seguida.")
        else:
            print("Push nao executado. Proximo passo: rode git push origin main quando desejar.")
    else:
        print("Commit pronto. Proximo passo: rode git push origin main quando quiser publicar.")

    print_public_urls()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
