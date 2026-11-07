#!/usr/bin/env python3
"""Offline audit of the two claimed cost-baseline totals.

Reads only:
  * JSON produced by ooxml_reader.py (independent Python-stdlib OOXML reader)
  * the two claimed totals from demo-evidence-fixtures/.../expected-results.json

It never executes Excel formulas, never calls production code, never reads .env,
and never uses the network. Text line totals are parsed conservatively: a
malformed value is reported as malformed instead of being silently repaired.

Usage:
  python3 audit-cost-baseline.py \
    --ooxml-root .local-evaluation/opencode-go-exp-full-offline/cost/ooxml \
    --expected demo-evidence-fixtures/smart-building-itb/expected-results.json \
    --out .local-evaluation/opencode-go-exp-full-offline/cost
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
from decimal import Decimal, InvalidOperation


def sha256_file(path: str) -> str:
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def cell(sheet: dict, ref: str) -> dict | None:
    match = re.match(r"^([A-Z]+)(\d+)$", ref)
    if not match:
        return None
    return sheet["rows"].get(match.group(2), {}).get("cells", {}).get(ref)


def parse_number(value_cell: dict | None) -> tuple[Decimal | None, str | None]:
    """Parse a stored cell value without repairing malformed source text."""
    if not value_cell:
        return None, "missing_cell"
    raw = value_cell.get("value")
    if raw is None or str(raw).strip() == "":
        return None, "empty"
    text = str(raw).strip()
    if not value_cell.get("textual"):
        try:
            return Decimal(text), None
        except InvalidOperation:
            return None, "non_numeric_stored_value"
    cleaned = re.sub(r"^(rp|idr)\s*", "", text, flags=re.I).replace(" ", "")
    if not cleaned or not re.search(r"\d", cleaned):
        return None, "no_digits"
    # Accept unambiguous thousands grouping or a single decimal comma/dot.
    if re.fullmatch(r"\d{1,3}(,\d{3})+(\.\d+)?", cleaned):
        return Decimal(cleaned.replace(",", "")), None
    if re.fullmatch(r"\d{1,3}(\.\d{3})+(,\d+)?", cleaned):
        return Decimal(cleaned.replace(".", "").replace(",", ".")), None
    if re.fullmatch(r"\d{1,3}(,\d{3})+", cleaned):
        return Decimal(cleaned.replace(",", "")), None
    if re.fullmatch(r"\d{1,3}(\.\d{3})+", cleaned):
        return Decimal(cleaned.replace(".", "")), None
    if re.fullmatch(r"\d+(\.\d+)?", cleaned):
        return Decimal(cleaned), None
    if re.fullmatch(r"\d+(,\d+)?", cleaned):
        return Decimal(cleaned.replace(",", ".")), None
    return None, "malformed_grouping_or_separators"


def find_workbook(documents: list[dict], filename_fragment: str) -> dict:
    matches = [doc for doc in documents
               if doc["workbook"]["file"].lower().startswith(filename_fragment.lower())]
    if not matches:
        matches = [doc for doc in documents
                   if filename_fragment.lower() in doc["workbook"]["file"].lower()]
    if len(matches) != 1:
        raise SystemExit(f"expected exactly one workbook matching {filename_fragment!r}, "
                         f"found {[m['workbook']['file'] for m in matches]}")
    return matches[0]


def master_hardware(doc: dict, expected_total: Decimal) -> dict:
    sheet = next((s for s in doc["sheets"] if s["name"].lower() == "master hardware"), None)
    if sheet is None:
        raise SystemExit(f"Master Hardware sheet missing in {doc['workbook']['file']}")

    rows = []
    sum_lines = Decimal(0)
    sum_hk = Decimal(0)
    malformed = []
    for row_number in range(2, 33):
        code = cell(sheet, f"A{row_number}")
        if not code or not str(code.get("value") or "").strip():
            continue
        qty, qty_error = parse_number(cell(sheet, f"H{row_number}"))
        price, price_error = parse_number(cell(sheet, f"K{row_number}"))
        line, line_error = parse_number(cell(sheet, f"L{row_number}"))
        hk = qty * price if qty is not None and price is not None else None
        if line is None:
            malformed.append({"row": row_number, "cell": f"L{row_number}",
                              "reason": line_error, "raw": (cell(sheet, f"L{row_number}") or {}).get("value")})
        else:
            sum_lines += line
        if hk is None:
            malformed.append({"row": row_number, "cell": f"H{row_number}*K{row_number}",
                              "reason": qty_error or price_error})
        else:
            sum_hk += hk
        rows.append({
            "row": row_number,
            "code": code.get("value"),
            "hardware_code": (cell(sheet, f"D{row_number}") or {}).get("value"),
            "qty": str(qty) if qty is not None else None,
            "unit_price": str(price) if price is not None else None,
            "line_total": str(line) if line is not None else None,
            "qty_x_price": str(hk) if hk is not None else None,
            "line_matches_qty_x_price": None if (line is None or hk is None) else line == hk,
        })

    total = cell(sheet, "L33") or cell(sheet, "E33")
    total_value, total_error = parse_number(total)
    formats = sorted({str((cell(sheet, f"{col}2") or {}).get("formatCode"))
                      for col in ("H", "K", "L")})
    currency_text = sorted({
        str(c.get("value")) for row in sheet["rows"].values() for c in row["cells"].values()
        if isinstance(c.get("value"), str) and re.search(r"\b(IDR|Rp|USD)\b", c["value"], re.I)
    })
    total_label = (cell(sheet, "A33") or cell(sheet, "K33") or {}).get("value")

    return {
        "workbook": doc["workbook"]["file"],
        "workbook_sha256": doc["workbook"]["sha256"],
        "sheet": sheet["name"],
        "data_rows": len(rows),
        "row_range": "A2:A32 (non-empty code)",
        "sum_line_totals": str(sum_lines),
        "sum_qty_x_unit_price": str(sum_hk),
        "expected_total": str(expected_total),
        "total_label": total_label,
        "total_cell": (total or {}).get("cell"),
        "total_value": str(total_value) if total_value is not None else None,
        "total_parse_error": total_error,
        "total_formula": (total or {}).get("formula"),
        "total_formula_cache_status": (total or {}).get("formulaCacheStatus"),
        "total_formula_cache_raw": (total or {}).get("formulaCacheRaw"),
        "line_equals_qty_x_price": all(r["line_matches_qty_x_price"] is not False for r in rows),
        "line_total_malformed_cells": malformed,
        "quote_currency_text_found_in_sheet": currency_text,
        "format_codes_row_2": formats,
        "numeric_reconciles": sum_hk == expected_total and total_value == expected_total,
        "displayed_line_sum_reconciles": sum_lines == expected_total,
        "rows": rows,
    }


def calculation_sheet(doc: dict, expected_total: Decimal) -> dict:
    sheet = next((s for s in doc["sheets"]
                  if s["name"].lower() == "estimasi rincian pembagian"), None)
    if sheet is None:
        return {"workbook": doc["workbook"]["file"], "sheet": None,
                "status": "blocked", "reason": "sheet missing"}
    e9, e9_error = parse_number(cell(sheet, "E9"))
    e10, _ = parse_number(cell(sheet, "E10"))
    e6, _ = parse_number(cell(sheet, "E6"))
    e7, _ = parse_number(cell(sheet, "E7"))
    e8, _ = parse_number(cell(sheet, "E8"))
    parts_sum = sum(v for v in (e6, e7, e8, e9) if v is not None)
    return {
        "workbook": doc["workbook"]["file"],
        "sheet": sheet["name"],
        "e9_label_row": {
            "C9": (cell(sheet, "C9") or {}).get("value"),
            "D4": (cell(sheet, "D4") or {}).get("value"),
            "E4": (cell(sheet, "E4") or {}).get("value"),
        },
        "e9_hardware": str(e9) if e9 is not None else None,
        "e9_parse_error": e9_error,
        "e9_formula": (cell(sheet, "E9") or {}).get("formula"),
        "e9_formula_cache_status": (cell(sheet, "E9") or {}).get("formulaCacheStatus"),
        "e10_total": str(e10) if e10 is not None else None,
        "e10_formula": (cell(sheet, "E10") or {}).get("formula"),
        "e10_formula_cache_status": (cell(sheet, "E10") or {}).get("formulaCacheStatus"),
        "e6_e7_e8_e9_sum": str(parts_sum),
        "e9_matches_hardware_total": e9 == expected_total,
        "e10_matches_component_sum": e10 == parts_sum,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ooxml-root", required=True)
    parser.add_argument("--expected", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    expected = json.load(open(args.expected, encoding="utf-8"))
    hardware_expected = Decimal(str(expected["baseline"]["hardware_baseline_total"]))
    purchase_expected = Decimal(str(expected["baseline"]["purchase_request_total"]))

    documents = []
    for name in sorted(os.listdir(args.ooxml_root)):
        if name.endswith(".ooxml.json"):
            documents.append(json.load(open(os.path.join(args.ooxml_root, name), encoding="utf-8")))

    spec = find_workbook(documents, "Spesifikasi Teknis")
    calc = find_workbook(documents, "Perhitungan dari Spesifikasi")
    request = find_workbook(documents, "Pengajuan Pembelian Hardware")

    hardware = master_hardware(spec, hardware_expected)
    purchase = master_hardware(request, purchase_expected)
    calc_view = calculation_sheet(calc, hardware_expected)
    calc_master = master_hardware(calc, hardware_expected)

    gaps = [
        "No workbook cell names the reporting currency for the Spesifikasi Teknis total; "
        "IDR is the fixture-pack currency, not a field read from that sheet.",
        "Scope is the sheet 'Master Hardware' and the fixture-pack baseline; no explicit "
        "project/scope label cell proves that scope.",
        "Formula freshness is not proven: the request total is a cached SUM value and the "
        "Spesifikasi total is a literal. Arithmetic was recomputed from stored H*K values, "
        "not by an Excel recalculation engine.",
        "The Perhitungan Master Hardware sheet stores L32 as the malformed text 'Rp11,500,00' "
        "(one digit short). Excluding that unparseable cell, its displayed L column sums to "
        "1,298,170,793, which is 11,500,000 below the stated hardware total; the H*K recomputation "
        "still reaches 1,309,670,793.",
    ]
    verdicts = {
        "hardware_baseline_total": {
            "claimed": str(hardware_expected),
            "verdict": "PASSED_NUMERIC_WITH_GAPS" if hardware["numeric_reconciles"] else "FAILED",
            "independent_sum_qty_x_unit_price": hardware["sum_qty_x_unit_price"],
            "spec_total_cell": hardware["total_value"],
            "calculation_sheet_e9": calc_view.get("e9_hardware"),
            "gaps": gaps,
        },
        "purchase_request_total": {
            "claimed": str(purchase_expected),
            "verdict": "PASSED_NUMERIC_WITH_GAPS" if purchase["numeric_reconciles"] else "FAILED",
            "independent_sum_qty_x_unit_price": purchase["sum_qty_x_unit_price"],
            "stored_total_cell": purchase["total_value"],
            "stored_total_formula": purchase["total_formula"],
            "stored_total_formula_cache_status": purchase["total_formula_cache_status"],
            "gaps": gaps,
        },
    }

    result = {
        "kind": "cost-baseline-offline-audit",
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "inputs": {
            "expected": {"path": args.expected, "sha256": sha256_file(args.expected)},
            "ooxml_documents": {
                doc["workbook"]["file"]: {
                    "sha256": doc["workbook"]["sha256"],
                    "source_path": doc["workbook"]["path"],
                } for doc in documents
            },
        },
        "reader": {"kind": "independent-ooxml-python-stdlib", "executes_formulas": False,
                   "network_used": False},
        "verdicts": verdicts,
        "hardware_baseline": hardware,
        "purchase_request": purchase,
        "calculation_sheet": calc_view,
        "calculation_workbook_master_hardware": calc_master,
        "non_claims": [
            "Not a business approval or an independent human review of scope/currency.",
            "Not proof that the cached SUM is fresh.",
            "Not a production-parser result; production code and fixtures were not modified.",
        ],
    }

    os.makedirs(args.out, exist_ok=True)
    json_path = os.path.join(args.out, "cost-baseline-audit.json")
    with open(json_path, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2, sort_keys=True)
        handle.write("\n")

    md_path = os.path.join(args.out, "cost-baseline-audit.md")
    with open(md_path, "w", encoding="utf-8") as handle:
        handle.write("# Cost baseline offline audit\n\n")
        for field, value in verdicts.items():
            handle.write(f"## {field}\n\n")
            handle.write(f"- Claimed: `{value['claimed']}`\n")
            handle.write(f"- Verdict: **{value['verdict']}**\n")
            for key in ("independent_sum_qty_x_unit_price", "spec_total_cell",
                        "calculation_sheet_e9", "stored_total_cell",
                        "stored_total_formula", "stored_total_formula_cache_status"):
                if key in value:
                    handle.write(f"- {key}: `{value[key]}`\n")
            handle.write("\n")
        handle.write("## Findings\n\n")
        for gap in gaps:
            handle.write(f"- {gap}\n")
        handle.write("\nArtifacts: `cost-baseline-audit.json`, "
                     "`ooxml/*.ooxml.json`.\n")

    print(json.dumps({"verdicts": verdicts,
                      "hardware_sum": hardware["sum_qty_x_unit_price"],
                      "purchase_sum": purchase["sum_qty_x_unit_price"],
                      "calc_e9": calc_view.get("e9_hardware"),
                      "calc_master_line_sum": calc_master["sum_line_totals"],
                      "calc_master_malformed": calc_master["line_total_malformed_cells"]},
                     indent=2))
    ok = all(v["verdict"] != "FAILED" for v in verdicts.values())
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
