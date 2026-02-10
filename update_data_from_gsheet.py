"""
Atualiza dados_app.json a partir de uma planilha do Google Sheets (1 arquivo com várias abas).

✅ MODO AUTOMÁTICO (padrão):
- Se você rodar apenas `python update_data_from_gsheet.py`, o script vai:
  1) tentar encontrar um XLSX local (dados_app.xlsx) e usar ele, OU
  2) se não existir XLSX local, baixar automaticamente do Google Sheets (URL padrão abaixo)

✅ MODO URL (forçar online):
  python update_data_from_gsheet.py --url "https://docs.google.com/spreadsheets/d/SEU_ID/edit?usp=sharing"

✅ MODO XLSX (forçar local):
  python update_data_from_gsheet.py --xlsx dados_app.xlsx

Requisitos:
  pip install pandas openpyxl requests
"""

from __future__ import annotations

import argparse
import io
import json
import os
from datetime import datetime, date
from typing import Dict, List, Optional, Tuple

import pandas as pd
import requests

DEFAULT_JSON = "dados_app.json"
DEFAULT_XLSX = "dados_app.xlsx"

# ✅ URL padrão (se você rodar sem argumentos e não houver XLSX local)
DEFAULT_SHEET_URL = "https://docs.google.com/spreadsheets/d/1iyhNnJtj77xPc44dB9I5-e2JJRWP9Mtd1U9vjwmopSI/edit?usp=sharing"

SHEET_ALIASES = {
    "componentes": ["componente", "componentes", "componentes_curriculares", "componene", "componete", "componene "],
    "docentes": ["docentes", "docente", "professores", "professor"],
    "turmas": ["turmas", "turma"],
    "cursos": ["cursos", "curso"],
    "horarios": ["horarios", "horário", "horario"],
    "feriados": ["feriados", "feriado"],
}


# =========================
# Utils
# =========================
def now_str() -> str:
    return datetime.now().strftime("%d/%m/%Y %H:%M")


def norm_space(s: str) -> str:
    return " ".join(str(s).strip().split())


def norm_key(s: str) -> str:
    return norm_space(s).lower()


def pick_col(cols: List[str], candidates: List[str]) -> Optional[str]:
    cols_map = {norm_key(c): c for c in cols}
    for cand in candidates:
        k = norm_key(cand)
        if k in cols_map:
            return cols_map[k]
    return None


def read_excel_bytes(xlsx_bytes: bytes) -> pd.ExcelFile:
    return pd.ExcelFile(io.BytesIO(xlsx_bytes), engine="openpyxl")


def read_sheet(xls: pd.ExcelFile, sheet_name: str) -> pd.DataFrame:
    df = xls.parse(sheet_name=sheet_name, dtype=str, keep_default_na=False)
    df.columns = [norm_key(c) for c in df.columns]
    return df


def parse_date_any(v: str) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, (datetime, date)):
        return v.strftime("%Y-%m-%d")

    s = norm_space(v)
    if not s:
        return None

    dt = pd.to_datetime(s, errors="coerce", dayfirst=True)
    if pd.isna(dt):
        return None
    return dt.strftime("%Y-%m-%d")


def safe_int(v: str, default: int = 0) -> int:
    s = norm_space(v)
    if not s:
        return default
    try:
        return int(float(s))
    except Exception:
        return default


def split_codigo_cor(codigo_raw: str) -> Tuple[str, Optional[str]]:
    s = norm_space(codigo_raw)
    if "#" not in s:
        return s, None
    left, right = s.split("#", 1)
    codigo = norm_space(left)
    cor = "#" + norm_space(right).replace(" ", "")
    if len(cor) < 4:
        cor = None
    return codigo, cor


def ensure_hex_color(c: str, default: str = "#bdc3c7") -> str:
    s = norm_space(c).replace(" ", "")
    if not s:
        return default
    if not s.startswith("#"):
        s = "#" + s
    if len(s) not in (4, 7):
        return default
    return s


def find_sheet_name(xls: pd.ExcelFile, logical_key: str) -> Optional[str]:
    names = xls.sheet_names
    aliases = SHEET_ALIASES.get(logical_key, [])
    norm_map = {norm_key(n): n for n in names}

    for a in aliases:
        if norm_key(a) in norm_map:
            return norm_map[norm_key(a)]

    for n in names:
        nn = norm_key(n)
        for a in aliases:
            if norm_key(a) in nn:
                return n

    return None


# =========================
# Download Google Sheets as XLSX
# =========================
def extract_sheet_id(url: str) -> str:
    u = url.strip()
    marker = "/spreadsheets/d/"
    if marker not in u:
        raise ValueError("URL não parece ser de Google Sheets (falta /spreadsheets/d/).")
    after = u.split(marker, 1)[1]
    sheet_id = after.split("/", 1)[0]
    if not sheet_id:
        raise ValueError("Não consegui extrair o ID da planilha.")
    return sheet_id


def download_xlsx_from_gsheet(url: str, timeout: int = 60) -> bytes:
    sheet_id = extract_sheet_id(url)
    export_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=xlsx"

    r = requests.get(export_url, timeout=timeout)
    r.raise_for_status()

    if not r.content[:2] == b"PK":
        raise RuntimeError(
            "O download não retornou um XLSX válido. "
            "Verifique se a planilha está compartilhada como 'Qualquer pessoa com o link' "
            "ou se o link exige login."
        )
    return r.content


# =========================
# Parsers por aba
# =========================
def parse_cursos(df: pd.DataFrame) -> List[dict]:
    # Aceita: sigla+nome OU curso_sigla+curso
    col_sigla = pick_col(list(df.columns), ["sigla", "curso_sigla", "sigla_curso"])
    col_nome = pick_col(list(df.columns), ["nome", "curso", "nome_curso", "curso_nome"])

    if not col_sigla or not col_nome:
        raise ValueError(
            "Aba cursos precisa de colunas de sigla e nome.\n"
            "Aceitos: ('sigla' + 'nome') ou ('curso_sigla' + 'curso').\n"
            f"Colunas encontradas: {list(df.columns)}"
        )

    cursos = []
    seen = set()
    for _, row in df.iterrows():
        sigla = norm_space(row.get(col_sigla, "")).upper()
        nome = norm_space(row.get(col_nome, ""))
        if not sigla or not nome:
            continue
        if sigla in seen:
            continue
        seen.add(sigla)
        cursos.append({"sigla": sigla, "nome": nome})
    return cursos


def parse_docentes(df: pd.DataFrame) -> List[dict]:
    col_nome = pick_col(list(df.columns), ["docente", "nome", "professor"])
    if not col_nome:
        raise ValueError(f"Aba docentes precisa de coluna 'Docente' ou 'nome'. Colunas: {list(df.columns)}")

    col_unidade = "unidade" if "unidade" in df.columns else None
    col_sub = "subunidade" if "subunidade" in df.columns else None

    docentes = []
    seen = set()
    for _, row in df.iterrows():
        nome = norm_space(row.get(col_nome, ""))
        if not nome:
            continue
        key = nome.lower()
        if key in seen:
            continue
        seen.add(key)

        obj = {"nome": nome}
        if col_unidade:
            unidade = norm_space(row.get(col_unidade, ""))
            if unidade:
                obj["unidade"] = unidade
        if col_sub:
            sub = norm_space(row.get(col_sub, ""))
            if sub:
                obj["subunidade"] = sub
        docentes.append(obj)
    return docentes


def parse_componentes(df: pd.DataFrame) -> List[dict]:
    col_sigla = pick_col(list(df.columns), ["curso_sigla", "sigla", "curso", "sigla_curso"])
    if not col_sigla:
        raise ValueError(f"Aba componente(s) precisa de coluna 'curso_sigla'. Colunas: {list(df.columns)}")

    col_nome = pick_col(list(df.columns), ["nome", "componente", "disciplina"])
    if not col_nome:
        raise ValueError(f"Aba componente(s) precisa de coluna 'nome'. Colunas: {list(df.columns)}")

    cor_cols = [c for c in ("cordisciplina", "cor_disciplina", "cor") if c in df.columns]

    disciplinas = []
    for _, row in df.iterrows():
        sigla = norm_space(row.get(col_sigla, "")).upper()
        nome = norm_space(row.get(col_nome, ""))
        if not sigla or not nome:
            continue

        codigo_raw = norm_space(row.get("codigo", ""))
        codigo, cor_from_codigo = split_codigo_cor(codigo_raw) if codigo_raw else ("", None)

        cor_raw = ""
        if cor_cols:
            cor_raw = norm_space(row.get(cor_cols[0], ""))
        cor = ensure_hex_color(cor_raw or (cor_from_codigo or ""), default="#bdc3c7")

        abreviacao = norm_space(row.get("abreviacao", "")) or nome
        ch = safe_int(row.get("ch", "0"), default=0)

        disciplinas.append({
            "codigo": codigo,
            "nome": nome,
            "abreviacao": abreviacao,
            "ch": ch,
            "cor_disciplina": cor,
            "curso_sigla": sigla
        })

    return disciplinas


def parse_turmas(df: pd.DataFrame) -> List[dict]:
    col_sigla = pick_col(list(df.columns), ["curso_sigla", "sigla", "curso", "sigla_curso"])
    if not col_sigla:
        raise ValueError(f"Aba turmas precisa de 'curso_sigla' (ou equivalente). Colunas: {list(df.columns)}")

    col_turma_id = pick_col(list(df.columns), ["turma_id", "id", "turma"])
    col_label = pick_col(list(df.columns), ["turma_label", "label", "nome_turma", "turma"])
    col_ano = pick_col(list(df.columns), ["turma_ano", "ano", "ingresso_ano"])
    col_turno = pick_col(list(df.columns), ["turno_padrao", "turno"])
    col_horario = pick_col(list(df.columns), ["horario_padrao", "horario"])

    turmas = []
    for _, row in df.iterrows():
        curso_sigla = norm_space(row.get(col_sigla, "")).upper()
        if not curso_sigla:
            continue

        turma_id = norm_space(row.get(col_turma_id, "")) if col_turma_id else ""
        turma_label = norm_space(row.get(col_label, "")) if col_label else ""
        turno = norm_space(row.get(col_turno, "")) if col_turno else ""
        horario = norm_space(row.get(col_horario, "")) if col_horario else ""
        ano = safe_int(row.get(col_ano, ""), default=0) if col_ano else 0

        if not turma_id:
            turma_id = f"{curso_sigla}{ano}" if ano else f"{curso_sigla}{len(turmas)+1}"
        if not turma_label:
            turma_label = turma_id

        obj = {
            "curso_sigla": curso_sigla,
            "turma_id": turma_id,
            "turma_label": turma_label,
        }
        if ano:
            obj["turma_ano"] = ano
        if turno:
            obj["turno_padrao"] = turno
        if horario:
            obj["horario_padrao"] = horario

        turmas.append(obj)

    return turmas


def parse_horarios(df: pd.DataFrame) -> Dict[str, List[str]]:
    if "key" in df.columns and "horario" in df.columns:
        out: Dict[str, List[str]] = {}
        for _, row in df.iterrows():
            k = norm_space(row.get("key", ""))
            h = norm_space(row.get("horario", ""))
            if not k or not h:
                continue
            out.setdefault(k, []).append(h)
        return out

    if "tipo" in df.columns and "horario" in df.columns:
        out: Dict[str, List[str]] = {}
        for _, row in df.iterrows():
            k = norm_space(row.get("tipo", ""))
            h = norm_space(row.get("horario", ""))
            if not k or not h:
                continue
            out.setdefault(k, []).append(h)
        return out

    out: Dict[str, List[str]] = {}
    for col in df.columns:
        key = norm_space(col)
        vals = [norm_space(v) for v in df[col].tolist() if norm_space(v)]
        if vals:
            out[key] = vals
    if not out:
        raise ValueError(f"Aba horarios vazia ou layout não reconhecido. Colunas: {list(df.columns)}")
    return out


def parse_feriados(df: pd.DataFrame) -> List[dict]:
    if "data" not in df.columns:
        if "dia" in df.columns:
            df = df.rename(columns={"dia": "data"})
        else:
            raise ValueError(f"Aba feriados precisa de coluna 'data'. Colunas: {list(df.columns)}")

    feriados = []
    for _, row in df.iterrows():
        dt = parse_date_any(row.get("data", ""))
        if not dt:
            continue

        nome = norm_space(row.get("nome", "")) if "nome" in df.columns else ""
        curso_sigla = norm_space(row.get("curso_sigla", "")).upper() if "curso_sigla" in df.columns else ""
        turma_id = norm_space(row.get("turma_id", "")) if "turma_id" in df.columns else ""

        feriados.append({
            "curso_sigla": curso_sigla,
            "turma_id": turma_id,
            "data": dt,
            "nome": nome
        })
    return feriados


# =========================
# Main update
# =========================
def update_json_from_xlsx_bytes(xlsx_bytes: bytes, json_path: str) -> None:
    if not os.path.exists(json_path):
        raise FileNotFoundError(f"'{json_path}' não encontrado na raiz do projeto.")

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    xls = read_excel_bytes(xlsx_bytes)
    sheet_map = {k: find_sheet_name(xls, k) for k in SHEET_ALIASES.keys()}

    if sheet_map.get("cursos"):
        df = read_sheet(xls, sheet_map["cursos"])
        data["cursos"] = parse_cursos(df)

    if sheet_map.get("docentes"):
        df = read_sheet(xls, sheet_map["docentes"])
        data["docentes"] = parse_docentes(df)

    if sheet_map.get("componentes"):
        df = read_sheet(xls, sheet_map["componentes"])
        data["disciplinas"] = parse_componentes(df)

    if sheet_map.get("turmas"):
        df = read_sheet(xls, sheet_map["turmas"])
        data["turmas"] = parse_turmas(df)

    if sheet_map.get("horarios"):
        df = read_sheet(xls, sheet_map["horarios"])
        data["horarios"] = parse_horarios(df)

    if sheet_map.get("feriados"):
        df = read_sheet(xls, sheet_map["feriados"])
        data["feriados"] = parse_feriados(df)

    if "periodos" not in data:
        data["periodos"] = []

    data["atualizado_em"] = now_str()

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print("Sucesso! JSON atualizado a partir do XLSX.")
    print(f"- cursos: {len(data.get('cursos', []))}")
    print(f"- docentes: {len(data.get('docentes', []))}")
    print(f"- disciplinas: {len(data.get('disciplinas', []))}")
    print(f"- turmas: {len(data.get('turmas', []))}")
    print(f"- horarios: {len(data.get('horarios', {}).keys()) if isinstance(data.get('horarios'), dict) else 0}")
    print(f"- feriados: {len(data.get('feriados', []))}")
    print(f"- atualizado_em: {data['atualizado_em']}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", type=str, default="", help="URL do Google Sheets (compartilhado).")
    ap.add_argument("--xlsx", type=str, default="", help="Caminho para XLSX local.")
    ap.add_argument("--json", type=str, default=DEFAULT_JSON, help="Arquivo JSON de saída (dados_app.json).")
    args = ap.parse_args()

    # 1) Se usuário passou --xlsx: força local
    if args.xlsx:
        xlsx_path = args.xlsx
        if not os.path.exists(xlsx_path):
            raise FileNotFoundError(f"Não encontrei '{xlsx_path}'.")
        with open(xlsx_path, "rb") as f:
            xlsx_bytes = f.read()
        update_json_from_xlsx_bytes(xlsx_bytes, args.json)
        return

    # 2) Se usuário passou --url: força online
    if args.url:
        xlsx_bytes = download_xlsx_from_gsheet(args.url)
        update_json_from_xlsx_bytes(xlsx_bytes, args.json)
        return

    # 3) Sem args: tenta XLSX padrão; se não existir, usa URL padrão
    if os.path.exists(DEFAULT_XLSX):
        with open(DEFAULT_XLSX, "rb") as f:
            xlsx_bytes = f.read()
        update_json_from_xlsx_bytes(xlsx_bytes, args.json)
        return

    print("Nenhum XLSX local encontrado. Baixando automaticamente do Google Sheets (URL padrão)...")
    xlsx_bytes = download_xlsx_from_gsheet(DEFAULT_SHEET_URL)
    update_json_from_xlsx_bytes(xlsx_bytes, args.json)


if __name__ == "__main__":
    main()
