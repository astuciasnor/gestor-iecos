#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
convert_data.py (IECOS - sem ambiguidade)

Planilha esperada (abas/colunas EXATAS):

docentes:
  docente | unidade | subunidade

componentes:
  sigla | periodo | codigo | cor | componente | abreviacao | ch

turmas:
  sigla | ano | turno

cursos:
  sigla | curso

horarios:
  turno | ordem | faixa

feriados:
  data | feriado | dia | tipo

Requisitos:
  pip install openpyxl
"""

from __future__ import annotations

import argparse
import json
import unicodedata
from dataclasses import dataclass
from datetime import datetime, date
from pathlib import Path
from typing import Any, Dict, List

import openpyxl


# -----------------------------
# Helpers
# -----------------------------
def norm_key(s: Any) -> str:
    """Normaliza cabeçalho: lowercase, sem acento, espaços/hífens -> underscore."""
    if s is None:
        return ""
    s = str(s).strip().lower()
    s = unicodedata.normalize("NFD", s)
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    s = s.replace(" ", "_").replace("-", "_")
    s = "".join(ch for ch in s if ch.isalnum() or ch == "_")
    return s


def to_str(x: Any) -> str:
    return "" if x is None else str(x).strip()


def to_int(x: Any) -> int:
    if x is None or x == "":
        return 0
    try:
        return int(x)
    except Exception:
        try:
            return int(float(x))
        except Exception:
            return 0


def to_date_iso(x: Any) -> str:
    """Converte data do Excel para ISO (YYYY-MM-DD)."""
    if x is None or x == "":
        return ""
    if isinstance(x, datetime):
        return x.date().isoformat()
    if isinstance(x, date):
        return x.isoformat()

    s = str(x).strip()
    if not s:
        return ""

    # dd/mm/yyyy
    if len(s) >= 10 and s[2] == "/" and s[5] == "/":
        dd, mm, yy = s[:2], s[3:5], s[6:10]
        return f"{yy}-{mm}-{dd}"

    # yyyy-mm-dd
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10]

    return s


def is_intervalo(faixa: str) -> bool:
    """
    Intervalo se:
      - contém a palavra INTERVALO
      - OU duração <= 25 min (ex.: 10:00 - 10:20)
    """
    up = faixa.upper()
    if "INTERVALO" in up:
        return True

    try:
        a, b = [p.strip() for p in faixa.split("-")]
        h1, m1 = [int(p) for p in a.split(":")]
        h2, m2 = [int(p) for p in b.split(":")]
        dur = (h2 * 60 + m2) - (h1 * 60 + m1)
        return 1 <= dur <= 25
    except Exception:
        return False


# -----------------------------
# Leitura de abas
# -----------------------------
@dataclass(frozen=True)
class SheetSpec:
    name: str
    required_cols: List[str]


def read_sheet(wb: openpyxl.Workbook, spec: SheetSpec) -> List[Dict[str, Any]]:
    if spec.name not in wb.sheetnames:
        raise ValueError(f"Aba '{spec.name}' não existe na planilha.")

    ws = wb[spec.name]

    header_row = next(ws.iter_rows(min_row=1, max_row=1, values_only=True))
    headers = [norm_key(h) for h in header_row if h is not None]

    # valida colunas (EXATAS)
    missing = [c for c in spec.required_cols if c not in headers]
    if missing:
        raise ValueError(
            f"Aba '{spec.name}': faltando colunas: {missing}. Encontradas: {headers}"
        )

    # mapa idx -> col
    idx_map: Dict[int, str] = {}
    for idx, h in enumerate([norm_key(h) for h in header_row]):
        if h:
            idx_map[idx] = h

    rows: List[Dict[str, Any]] = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if all(v is None or str(v).strip() == "" for v in row):
            continue

        item: Dict[str, Any] = {}
        for idx, val in enumerate(row):
            col = idx_map.get(idx)
            if not col:
                continue
            item[col] = val
        rows.append(item)

    return rows


def build_json_from_excel(xlsx_path: Path) -> Dict[str, Any]:
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)

    specs = [
        SheetSpec("docentes",   ["docente", "unidade", "subunidade"]),
        SheetSpec("componentes",["sigla", "periodo", "codigo", "cor", "componente", "abreviacao", "ch"]),
        SheetSpec("turmas",     ["sigla", "ano", "turno"]),
        SheetSpec("cursos",     ["sigla", "curso"]),
        SheetSpec("horarios",   ["turno", "ordem", "faixa"]),
        SheetSpec("feriados",   ["data", "feriado", "dia", "tipo"]),
    ]

    data: Dict[str, Any] = {
        "meta": {
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "source_file": xlsx_path.name,
        }
    }

    # lê abas
    raw: Dict[str, List[Dict[str, Any]]] = {}
    for sp in specs:
        raw[sp.name] = read_sheet(wb, sp)

    # docentes
    data["docentes"] = [
        {
            "docente": to_str(r.get("docente")),
            "unidade": to_str(r.get("unidade")),
            "subunidade": to_str(r.get("subunidade")),
        }
        for r in raw["docentes"]
    ]

    # cursos
    data["cursos"] = [
        {"sigla": to_str(r.get("sigla")), "curso": to_str(r.get("curso"))}
        for r in raw["cursos"]
    ]

    # componentes
    data["componentes"] = [
        {
            "sigla": to_str(r.get("sigla")),
            "periodo": to_str(r.get("periodo")),
            "codigo": to_str(r.get("codigo")),
            "cor": to_str(r.get("cor")),
            "componente": to_str(r.get("componente")),
            "abreviacao": to_str(r.get("abreviacao")),
            "ch": to_int(r.get("ch")),
        }
        for r in raw["componentes"]
    ]

    # turmas + derivados
    turmas_out = []
    for r in raw["turmas"]:
        sigla = to_str(r.get("sigla"))
        ano = to_int(r.get("ano"))
        turno = to_str(r.get("turno"))
        turma_id = f"{sigla}{ano}" if sigla and ano else ""
        turmas_out.append(
            {
                "sigla": sigla,
                "ano": ano,
                "turno": turno,
                "turma_id": turma_id,
                "turma_label": turma_id,
            }
        )
    data["turmas"] = turmas_out

    # horarios + horarios_por_turno
    horarios_out = []
    for r in raw["horarios"]:
        turno = to_str(r.get("turno"))
        ordem = to_int(r.get("ordem"))
        faixa = to_str(r.get("faixa"))
        if not turno or not faixa:
            continue
        faixa_out = f"INTERVALO ({faixa})" if is_intervalo(faixa) else faixa
        horarios_out.append({"turno": turno, "ordem": ordem, "faixa": faixa_out})

    horarios_out.sort(key=lambda x: (x["turno"], x["ordem"]))
    data["horarios"] = horarios_out

    horarios_por_turno: Dict[str, List[str]] = {}
    for h in horarios_out:
        horarios_por_turno.setdefault(h["turno"], []).append(h["faixa"])
    data["horarios_por_turno"] = horarios_por_turno

    # feriados
    data["feriados"] = [
        {
            "data": to_date_iso(r.get("data")),
            "feriado": to_str(r.get("feriado")),
            "dia": to_str(r.get("dia")),
            "tipo": to_str(r.get("tipo")),
        }
        for r in raw["feriados"]
    ]

    return data


def main() -> None:
    p = argparse.ArgumentParser(description="Converte Excel (.xlsx) em JSON para o app (IECOS).")
    p.add_argument("--input", required=True, help="Caminho do .xlsx")
    p.add_argument("--output", required=True, help="Caminho do .json de saída")
    args = p.parse_args()

    in_path = Path(args.input).expanduser().resolve()
    out_path = Path(args.output).expanduser().resolve()

    if not in_path.exists():
        raise SystemExit(f"Arquivo não encontrado: {in_path}")

    data = build_json_from_excel(in_path)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"OK: gerado {out_path}")
    print("Chaves:", ", ".join(data.keys()))


if __name__ == "__main__":
    main()
