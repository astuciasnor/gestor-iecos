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
PUBLIC_DOWNLOAD_GLOB = "alocacoes_publicas*.json"
LEGACY_PUBLIC_JSON_REL = "alocacoes_publicas.json"
PUBLICATION_CONFIG_REL = Path("publicacoes") / "publicacao_config.json"
DEFAULT_PUBLICATION_CATALOG_REL = "publicacoes/catalogo_publicacoes.json"
DEFAULT_PLAN_DIRECTORY_TEMPLATE = "publicacoes/{year}/{periodo_slug}/alocacoes_publicas.json"
DEFAULT_LAYOUT_MODE = "legacy_single_file"
MAX_PUBLISHED_PLANS = 3


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


def normalize_periodo(value: Any) -> str:
    text = str(value or "").strip().upper().replace(" ", "")
    if not text:
        return ""

    legacy_map = {
        "1P": "PL1",
        "2P": "PL2",
        "3P": "PL3",
        "4P": "PL4",
    }
    if text in legacy_map:
        return legacy_map[text]

    if text.isdigit():
        return f"PL{int(text)}"

    if text.startswith("PL") and text[2:].isdigit():
        return f"PL{int(text[2:])}"

    return text


def slugify_public_piece(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return ""
    out = []
    last_was_dash = False
    for ch in raw:
        if ch.isalnum():
            out.append(ch)
            last_was_dash = False
            continue
        if not last_was_dash:
            out.append("-")
            last_was_dash = True
    return "".join(out).strip("-")


def load_publication_config(repo_root: Path) -> dict[str, Any]:
    base_config: dict[str, Any] = {
        "version": 1,
        "layoutMode": DEFAULT_LAYOUT_MODE,
        "defaultJsonPath": LEGACY_PUBLIC_JSON_REL,
        "catalogPath": DEFAULT_PUBLICATION_CATALOG_REL,
        "planDirectoryTemplate": DEFAULT_PLAN_DIRECTORY_TEMPLATE,
        "studentRouting": {
            "strategy": "default_publication",
            "allowManualPlanSelection": False,
            "planQueryParam": "pl",
        },
    }

    config_path = repo_root / PUBLICATION_CONFIG_REL
    if not config_path.exists():
        return base_config

    try:
        loaded = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return base_config

    if not isinstance(loaded, dict):
        return base_config

    merged = {**base_config, **loaded}
    student_routing = loaded.get("studentRouting")
    if isinstance(student_routing, dict):
        merged["studentRouting"] = {**base_config["studentRouting"], **student_routing}
    else:
        merged["studentRouting"] = dict(base_config["studentRouting"])
    return merged


def build_publication_plan_descriptor(payload: Any) -> dict[str, str]:
    payload_dict = payload if isinstance(payload, dict) else {}
    plan = payload_dict.get("plan") if isinstance(payload_dict.get("plan"), dict) else {}
    settings = payload_dict.get("settings") if isinstance(payload_dict.get("settings"), dict) else {}
    meta = payload_dict.get("meta") if isinstance(payload_dict.get("meta"), dict) else {}

    periodo = normalize_periodo(
        plan.get("periodo")
        or settings.get("periodo")
        or meta.get("periodoLetivo")
        or ""
    )
    term_start = str(plan.get("termStart") or settings.get("termStart") or "").strip()
    term_end = str(plan.get("termEnd") or settings.get("termEnd") or "").strip()
    year = str(plan.get("ano") or (term_start[:4] if is_iso_date(term_start) else "")).strip()
    plan_key = str(plan.get("key") or "").strip()
    periodo_slug = slugify_public_piece(periodo)
    plan_slug = slugify_public_piece("-".join(part for part in (year, periodo.lower() if periodo else "") if part))

    return {
        "plan_key": plan_key,
        "periodo": periodo,
        "periodo_slug": periodo_slug,
        "term_start": term_start,
        "term_end": term_end,
        "year": year,
        "plan_slug": plan_slug,
    }


def resolve_public_target_path(
    repo_root: Path,
    payload: Any,
    publication_config: dict[str, Any],
    target_arg: str | PathLike[str] | None,
) -> tuple[Path, str, dict[str, str]]:
    descriptor = build_publication_plan_descriptor(payload)

    if target_arg:
        return resolve_input_path(target_arg), "manual", descriptor

    layout_mode = str(publication_config.get("layoutMode") or DEFAULT_LAYOUT_MODE).strip().lower()
    default_json_path = str(publication_config.get("defaultJsonPath") or LEGACY_PUBLIC_JSON_REL).strip() or LEGACY_PUBLIC_JSON_REL

    if layout_mode == "plan_directory":
        template = str(publication_config.get("planDirectoryTemplate") or DEFAULT_PLAN_DIRECTORY_TEMPLATE).strip()
        if descriptor["year"] and descriptor["periodo_slug"]:
            rel_target = template.format(
                year=descriptor["year"],
                periodo=descriptor["periodo"],
                periodo_slug=descriptor["periodo_slug"],
                plan_key=descriptor["plan_key"],
                plan_slug=descriptor["plan_slug"],
            )
            return (repo_root / Path(rel_target)).resolve(), "config_plan_directory", descriptor

    return (repo_root / Path(default_json_path)).resolve(), "config_default", descriptor


def build_public_file_url(repo_root: Path, path: Path) -> str:
    try:
        rel = path.resolve().relative_to(repo_root.resolve()).as_posix()
    except ValueError:
        return ""
    return f"{PUBLIC_URL}{rel}"


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


def publication_identity(pub: Any) -> str:
    """Identidade estavel de um plano publicado (para deduplicar por periodo letivo)."""
    pub = pub if isinstance(pub, dict) else {}
    plan = pub.get("plan") if isinstance(pub.get("plan"), dict) else {}
    settings = pub.get("settings") if isinstance(pub.get("settings"), dict) else {}
    meta = pub.get("meta") if isinstance(pub.get("meta"), dict) else {}

    key = str(plan.get("key") or "").strip()
    if key:
        return key

    periodo = normalize_periodo(
        meta.get("periodoLetivo") or plan.get("periodo") or settings.get("periodo") or ""
    )
    term_start = str(plan.get("termStart") or settings.get("termStart") or "").strip()
    term_end = str(plan.get("termEnd") or settings.get("termEnd") or "").strip()
    parts = [part for part in (periodo, term_start, term_end) if part]
    return "__".join(parts) or periodo


def publication_sort_value(pub: Any) -> str:
    pub = pub if isinstance(pub, dict) else {}
    plan = pub.get("plan") if isinstance(pub.get("plan"), dict) else {}
    settings = pub.get("settings") if isinstance(pub.get("settings"), dict) else {}
    return str(plan.get("termStart") or settings.get("termStart") or "")


def publication_periodo_label(pub: Any) -> str:
    pub = pub if isinstance(pub, dict) else {}
    plan = pub.get("plan") if isinstance(pub.get("plan"), dict) else {}
    settings = pub.get("settings") if isinstance(pub.get("settings"), dict) else {}
    meta = pub.get("meta") if isinstance(pub.get("meta"), dict) else {}
    return (
        str(meta.get("periodoLetivo") or plan.get("periodo") or settings.get("periodo") or "").strip()
        or "?"
    )


def extract_existing_publications(existing_data: Any) -> list[dict]:
    """Normaliza o arquivo publico existente (v2 unico ou v3 multi) numa lista de planos."""
    if isinstance(existing_data, dict) and isinstance(existing_data.get("publications"), list):
        return [pub for pub in existing_data["publications"] if isinstance(pub, dict)]
    if isinstance(existing_data, dict) and isinstance(existing_data.get("allocations"), list):
        return [existing_data]
    if isinstance(existing_data, list):
        return [{"allocations": existing_data, "settings": {}}]
    return []


def merge_publications(
    existing_publications: list[dict],
    new_publication: dict,
    max_plans: int = MAX_PUBLISHED_PLANS,
) -> list[dict]:
    """Substitui o plano de mesmo periodo, mantem os demais e limita aos mais recentes."""
    new_identity = publication_identity(new_publication)
    merged = [
        pub for pub in existing_publications
        if publication_identity(pub) != new_identity
    ]
    merged.append(new_publication)
    merged.sort(key=publication_sort_value, reverse=True)
    return merged[:max_plans]


def build_multi_plan_document(publications: list[dict]) -> dict:
    return {
        "version": 3,
        "exportedAt": datetime.now().isoformat() + "Z",
        "layoutMode": "single_file_multi_plan",
        "publications": publications,
    }


def build_output_document(
    payload: dict,
    target_path: Path,
    layout_mode: str,
) -> Any:
    """No modo arquivo unico, mescla o plano novo com o(s) plano(s) ja publicado(s)."""
    if str(layout_mode or "").strip().lower() != "legacy_single_file":
        return payload

    existing_data = None
    if target_path.exists() and target_path.is_file():
        try:
            existing_data = json.loads(target_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            existing_data = None

    existing_publications = extract_existing_publications(existing_data)
    merged = merge_publications(existing_publications, payload)
    return build_multi_plan_document(merged)


def describe_source_mode(source_mode: str) -> str:
    if source_mode == "manual":
        return "Origem informada manualmente."
    if source_mode == "downloads":
        return "Origem detectada automaticamente em Downloads."
    if source_mode == "repo":
        return "Origem automatica nao encontrada em Downloads; usando arquivo atual do repositorio."
    return "Origem nao identificada."


def update_publication_catalog(
    repo_root: Path,
    publication_config: dict[str, Any],
    descriptor: dict[str, str],
    target_path: Path,
) -> tuple[Path | None, bool]:
    catalog_rel = publication_config.get("catalogPath") or DEFAULT_PUBLICATION_CATALOG_REL
    catalog_path = repo_root / catalog_rel

    if not catalog_path.exists():
        return None, False

    try:
        catalog_data = json.loads(catalog_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None, False

    layout_mode = publication_config.get("layoutMode") or DEFAULT_LAYOUT_MODE
    catalog_data["layoutMode"] = layout_mode

    try:
        json_rel_path = target_path.resolve().relative_to(repo_root.resolve()).as_posix()
    except ValueError:
        json_rel_path = str(target_path)

    new_pub = {
        "planKey": descriptor.get("plan_key", ""),
        "periodo": descriptor.get("periodo", ""),
        "periodoSlug": descriptor.get("periodo_slug", ""),
        "year": descriptor.get("year", ""),
        "termStart": descriptor.get("term_start", ""),
        "termEnd": descriptor.get("term_end", ""),
        "jsonPath": json_rel_path,
        "publishedAt": datetime.now().isoformat() + "Z",
    }

    publications = catalog_data.get("publications")
    if not isinstance(publications, list):
        publications = []

    found = False
    for i, pub in enumerate(publications):
        if pub.get("year") == new_pub["year"] and pub.get("periodo") == new_pub["periodo"]:
            publications[i] = {**pub, **new_pub}
            found = True
            break
            
    if not found:
        publications.append(new_pub)
        
    catalog_data["publications"] = publications

    default_pub = catalog_data.get("defaultPublication") or {}
    default_pub.update({
        "planKey": new_pub["planKey"],
        "periodo": new_pub["periodo"],
        "year": new_pub["year"],
        "label": f"Publicacao {new_pub['periodo']} - {new_pub['year']}",
        "jsonPath": json_rel_path,
        "agendaPath": "agenda_publica.html",
        "isStudentDefault": True,
        "status": "published"
    })
    
    catalog_data["defaultPublication"] = default_pub

    catalog_path.write_text(json.dumps(catalog_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return catalog_path, True


def print_publication_summary(
    source_mode: str,
    source_path: Path,
    target_path: Path,
    allocations_count: int,
    term_start: Any,
    term_end: Any,
    layout_mode: str,
    target_mode: str,
    plan_descriptor: dict[str, str],
) -> None:
    print("Resumo da publicacao:")
    print(f"  {describe_source_mode(source_mode)}")
    print(f"  Origem: {source_path}")
    print(f"  Destino: {target_path}")
    print(f"  Layout publico: {layout_mode}")
    print(f"  Resolucao do destino: {target_mode}")
    if plan_descriptor.get("periodo") or plan_descriptor.get("year"):
        print(f"  Plano detectado: {plan_descriptor.get('periodo') or '--'} / {plan_descriptor.get('year') or '--'}")
    print(f"  Alocacoes: {allocations_count}")
    print(f"  Periodo: {term_start} a {term_end}")


def print_public_urls(repo_root: Path, target_path: Path, publication_config: dict[str, Any]) -> None:
    print(f"URL publica: {PUBLIC_URL}agenda_publica.html")
    json_url = build_public_file_url(repo_root, target_path)
    print(f"JSON publico: {json_url or (PUBLIC_URL + LEGACY_PUBLIC_JSON_REL)}")

    catalog_rel = str(publication_config.get("catalogPath") or "").strip()
    if catalog_rel:
        print(f"Catalogo publico: {PUBLIC_URL}{catalog_rel}")


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    default_source = repo_root / LEGACY_PUBLIC_JSON_REL
    publication_config = load_publication_config(repo_root)

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
        default=None,
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

    source_path, source_mode = resolve_source_path(args.source, default_source)

    branch = get_git_branch(repo_root)
    git_status = get_git_status(repo_root)
    git_publish_allowed, git_publish_reasons = can_run_git_publish(
        allow_dirty=args.allow_dirty,
        allow_non_main=args.allow_non_main,
        branch=branch,
        git_status=git_status,
    )

    debug_print(args.debug, "repo_root", repo_root)
    debug_print(args.debug, "publication_config_path", repo_root / PUBLICATION_CONFIG_REL)
    debug_print(args.debug, "publication_layout_mode", publication_config.get("layoutMode"))
    debug_print(args.debug, "source_mode", source_mode)
    debug_print(args.debug, "source_path", source_path if source_path is not None else "<nenhum>")
    debug_print(args.debug, "source_exists", bool(source_path and source_path.exists()))
    debug_print(args.debug, "branch_atual", branch)
    debug_print(args.debug, "git_status", git_status or "<limpo>")

    if source_mode == "missing" or source_path is None:
        print("Erro: nenhuma origem valida foi encontrada.", file=sys.stderr)
        print(
            "Nao foi encontrado nenhum arquivo compativel em Downloads e tambem nao existe "
            f"{LEGACY_PUBLIC_JSON_REL} na raiz do repositorio.",
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
    target_path, target_mode, plan_descriptor = resolve_public_target_path(
        repo_root=repo_root,
        payload=payload,
        publication_config=publication_config,
        target_arg=args.target,
    )
    target_existed_before = target_path.exists()
    layout_mode = str(publication_config.get("layoutMode") or DEFAULT_LAYOUT_MODE)

    debug_print(args.debug, "target_path", target_path)
    debug_print(args.debug, "target_mode", target_mode)
    debug_print(args.debug, "target_exists_before", target_existed_before)
    debug_print(args.debug, "target_size_before", file_size_or_none(target_path))
    debug_print(args.debug, "plan_descriptor", plan_descriptor)

    print_publication_summary(
        source_mode=source_mode,
        source_path=source_path,
        target_path=target_path,
        allocations_count=allocations_count,
        term_start=term_start,
        term_end=term_end,
        layout_mode=layout_mode,
        target_mode=target_mode,
        plan_descriptor=plan_descriptor,
    )

    if args.check:
        print("Verificacao concluida com sucesso. Nenhum arquivo foi gravado e nenhuma etapa Git foi executada.")
        print("Se desejar publicar depois, rode: python tools/publish_online.py --push")
        print_public_urls(repo_root, target_path, publication_config)
        return 0

    confirm_prompt = "Confirmar gravacao do arquivo publico?"
    if not args.no_git:
        confirm_prompt = "Confirmar gravacao e commit do arquivo publico?"

    if not args.yes and not confirm(confirm_prompt):
        print("Operacao cancelada.")
        return 0

    output_document = build_output_document(payload, target_path, layout_mode)
    target_content = build_target_content(output_document)
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

    if isinstance(output_document, dict) and isinstance(output_document.get("publications"), list):
        planos = ", ".join(publication_periodo_label(pub) for pub in output_document["publications"])
        print(
            f"Planos no arquivo publico unico ({len(output_document['publications'])}): {planos}"
        )

    if not target_had_same_content:
        write_public_file(output_document, target_path)
        print("Arquivo de destino gravado com sucesso.")
    else:
        print("Arquivo de destino ja continha conteudo identico; nenhuma regravacao foi necessaria.")

    catalog_updated = False
    catalog_path = None
    if layout_mode == "plan_directory":
        catalog_path, catalog_updated = update_publication_catalog(
            repo_root=repo_root,
            publication_config=publication_config,
            descriptor=plan_descriptor,
            target_path=target_path
        )
        if catalog_updated:
            print(f"Catalogo de publicacoes atualizado: {catalog_path.relative_to(repo_root) if catalog_path else ''}")

    debug_print(args.debug, "target_exists_after", target_path.exists())
    debug_print(args.debug, "target_size_after", file_size_or_none(target_path))

    if args.no_git:
        print("Atualizacao local concluida com sucesso.")
        print("Nenhuma etapa Git foi executada porque voce usou --no-git.")
        print("Quando quiser publicar, rode novamente sem --no-git ou use --push.")
        if args.push:
            print("Observacao: --push foi ignorado porque --no-git desativa git add, commit e push.")
        print_public_urls(repo_root, target_path, publication_config)
        return 0

    if not git_publish_allowed:
        print("Arquivo de destino resolvido e atualizado localmente com sucesso.")
        print("A etapa Git foi bloqueada pelas travas de seguranca:")
        for reason in git_publish_reasons:
            print(f"  - {reason}")
        print("Proximo passo: regularize o Git e rode novamente para commitar ou publicar.")
        print_public_urls(repo_root, target_path, publication_config)
        return 0

    try:
        rel_target = target_path.relative_to(repo_root).as_posix()
    except ValueError:
        print(
            "Erro: o destino publico precisa permanecer dentro do repositorio para que o Git possa versionar a publicacao.",
            file=sys.stderr,
        )
        print(
            "Proximo passo: ajuste --target ou a configuracao publica para um caminho interno ao projeto.",
            file=sys.stderr,
        )
        return 1

    run_git(repo_root, ["add", "--", rel_target], check=True)
    
    rel_catalog = ""
    if catalog_updated and catalog_path:
        try:
            rel_catalog = catalog_path.relative_to(repo_root).as_posix()
            run_git(repo_root, ["add", "--", rel_catalog], check=True)
        except ValueError:
            pass

    has_target_changes = has_staged_changes(repo_root, rel_target)
    has_catalog_changes = has_staged_changes(repo_root, rel_catalog) if rel_catalog else False

    if not has_target_changes and not has_catalog_changes:
        print(
            "O arquivo publico foi validado e comparado com o repositorio, mas o conteudo final ja era "
            "identico ao existente. Nao ha alteracao para commitar."
        )
        print("Proximo passo: nenhum. O repositorio ja estava atualizado.")
        print_public_urls(repo_root, target_path, publication_config)
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

    print_public_urls(repo_root, target_path, publication_config)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
