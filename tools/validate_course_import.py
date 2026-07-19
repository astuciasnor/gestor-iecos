#!/usr/bin/env python3
"""Valida uma planilha de cadastro de curso sem modificar a base oficial."""

from __future__ import annotations

import argparse
from pathlib import Path

from course_import_common import validate_course_import, write_validation_report


def main() -> int:
    root_dir = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(
        description="Valida uma planilha de cadastro de curso e gera um relatorio JSON."
    )
    parser.add_argument("input", help="Planilha .xlsx preenchida a validar")
    parser.add_argument(
        "--base",
        default=str(root_dir / "dados" / "planilha_base.xlsx"),
        help="Planilha-base usada para detectar conflitos",
    )
    parser.add_argument(
        "--report",
        help="Caminho do relatorio JSON; padrao: ao lado da planilha de entrada",
    )
    args = parser.parse_args()

    input_path = Path(args.input).expanduser().resolve()
    base_path = Path(args.base).expanduser().resolve() if args.base else None
    report_path = (
        Path(args.report).expanduser().resolve()
        if args.report
        else input_path.with_name(f"{input_path.stem}_validacao.json")
    )

    if not input_path.exists():
        parser.error(f"planilha nao encontrada: {input_path}")
    if base_path is not None and not base_path.exists():
        parser.error(f"planilha-base nao encontrada: {base_path}")

    validation = validate_course_import(input_path, base_path)
    write_validation_report(validation, report_path)

    status = "VALIDA" if validation.valid else "INVALIDA"
    print(f"Planilha {status}: {input_path}")
    print(f"Curso: {validation.course_sigla or '(nao identificado)'}")
    print(f"Erros: {len(validation.errors)} | Avisos: {len(validation.warnings)}")
    print(f"Relatorio: {report_path}")
    for issue in validation.issues:
        location = issue.sheet
        if issue.row is not None:
            location += f" linha {issue.row}"
        prefix = "ERRO" if issue.severity == "error" else "AVISO"
        print(f"- {prefix} [{location or 'arquivo'}] {issue.message}")

    return 0 if validation.valid else 1


if __name__ == "__main__":
    raise SystemExit(main())