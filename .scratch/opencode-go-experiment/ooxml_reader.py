#!/usr/bin/env python3
"""
Independent, offline OOXML workbook reader for the WBS provenance audit.

Reads the XLSX ZIP/XML directly with the Python standard library. It shares no
code with the production TypeScript parser: it re-derives sheet paths, shared
strings, styles, raw stored values, formulas, formula caches, date1904 and
number formats from OOXML. It does NOT execute formulas and does NOT call the
network, read .env/API keys, or write anything outside --out.

By default only the Workplan & Gantt and PM Summary sheets are emitted; pass
--all-sheets to emit every sheet. Output is one JSON file per workbook.

Usage:
  python3 ooxml_reader.py --out DIR file1.xlsx [file2.xlsx ...]
  python3 ooxml_reader.py --all-sheets --out DIR file.xlsx
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import posixpath
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

WORKPLAN = re.compile(r"workplan\s*&\s*gantt", re.I)
PM_SUMMARY = re.compile(r"pm\s*summary", re.I)


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def attr_local(elem: ET.Element, name: str) -> str | None:
    for key, value in elem.attrib.items():
        if local(key) == name:
            return value
    return None


def children_local(elem: ET.Element, name: str):
    return [child for child in list(elem) if local(child.tag) == name]


def descendants_local(elem: ET.Element, name: str):
    return [node for node in elem.iter() if local(node.tag) == name]


def text_content(elem: ET.Element) -> str:
    return "".join(node.text or "" for node in elem.iter() if local(node.tag) == "t")


def column_letters(number: int) -> str:
    value = number
    letters = ""
    while value > 0:
        value -= 1
        letters = chr(65 + value % 26) + letters
        value //= 26
    return letters


def column_number(ref: str) -> int:
    letters = re.match(r"^[A-Za-z]+", ref or "")
    if not letters:
        return 0
    value = 0
    for ch in letters.group(0).upper():
        value = value * 26 + ord(ch) - 64
    return value


def is_percent_format(fmt: str | None) -> bool:
    if not fmt:
        return False
    cleaned = re.sub(r'"[^"]*"|\[[^\]]*\]|\\.', "", fmt)
    sections = [section.strip() for section in cleaned.split(";") if section.strip()]
    return bool(sections) and all(
        re.fullmatch(r"[#0][#0,]*(?:\.[#0]+)?%", section) is not None
        for section in sections
    )


def is_date_format(fmt: str | None) -> bool:
    if not fmt:
        return False
    cleaned = re.sub(r'"[^"]*"|\[[^\]]*\]', "", fmt)
    return re.search(r"[yd]", cleaned, re.I) is not None


BUILTIN_FORMATS = {
    "9": "0%",
    "10": "0.00%",
    "14": "m/d/yy",
    "15": "d-mmm-yy",
    "16": "d-mmm",
    "17": "mmm-yy",
    "18": "h:mm AM/PM",
    "19": "h:mm:ss AM/PM",
    "20": "h:mm",
    "21": "h:mm:ss",
    "22": "m/d/yy h:mm",
}


def excel_serial_to_iso(raw: str, date1904: bool) -> str | None:
    try:
        serial = float(raw)
    except (TypeError, ValueError):
        return None
    if not (serial >= 0) or (not date1904 and int(serial // 1) == 60):
        return None
    day = int(serial // 1)
    if date1904:
        epoch = dt.datetime(1904, 1, 1, tzinfo=dt.timezone.utc)
    else:
        epoch = dt.datetime(1899, 12, 31 if day < 60 else 30, tzinfo=dt.timezone.utc)
    try:
        return (epoch + dt.timedelta(days=day)).date().isoformat()
    except (OverflowError, ValueError):
        return None


def classify_formula(has_formula: bool, type_: str | None, has_value: bool, raw: str):
    if not has_formula:
        return "not_formula", None
    if not has_value:
        return "missing_cache", None
    if type_ == "e":
        return "cached_error", "error"
    if type_ in ("b",):
        return ("cached_empty", None) if raw == "" else ("cached_value", "boolean")
    if type_ in ("str", "s"):
        return ("cached_empty", None) if raw == "" else ("cached_value", "string")
    if type_ in ("n", None, ""):
        return ("cached_empty", None) if raw == "" else ("cached_value", "number")
    return "unknown", None


def sheet_paths(zf: zipfile.ZipFile):
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = {}
    if "xl/_rels/workbook.xml.rels" in zf.namelist():
        rel_root = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        for rel in rel_root.iter():
            if local(rel.tag) != "Relationship":
                continue
            rid = rel.attrib.get("Id")
            target = rel.attrib.get("Target")
            if rid and target:
                target = target[1:] if target.startswith("/") else posixpath.join("xl", target)
                rels[rid] = posixpath.normpath(target)
    sheets = []
    for index, sheet in enumerate(descendants_local(workbook, "sheet")):
        name = sheet.attrib.get("name") or f"Sheet {index + 1}"
        rid = attr_local(sheet, "id") or ""
        sheets.append((name, rels.get(rid, f"xl/worksheets/sheet{index + 1}.xml")))
    date1904 = False
    for pr in descendants_local(workbook, "workbookPr"):
        date1904 = (pr.attrib.get("date1904") or "").lower() in ("1", "true")
    return sheets, date1904


def read_shared_strings(zf: zipfile.ZipFile):
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    return [text_content(si) for si in descendants_local(root, "si")]


def read_styles(zf: zipfile.ZipFile):
    if "xl/styles.xml" not in zf.namelist():
        return []
    root = ET.fromstring(zf.read("xl/styles.xml"))
    custom = {
        fmt.attrib.get("numFmtId"): fmt.attrib.get("formatCode")
        for fmt in descendants_local(root, "numFmt")
    }
    xfs = []
    for cell_xfs in descendants_local(root, "cellXfs"):
        for xf in children_local(cell_xfs, "xf"):
            num_fmt_id = xf.attrib.get("numFmtId")
            fmt = custom.get(num_fmt_id) or BUILTIN_FORMATS.get(num_fmt_id)
            xfs.append(
                {
                    "numFmtId": num_fmt_id,
                    "format": fmt,
                    "date": is_date_format(fmt),
                    "percent": is_percent_format(fmt),
                }
            )
    return xfs


def read_sheet(xml: bytes, shared: list[str], styles: list[dict], date1904: bool):
    root = ET.fromstring(xml)
    merges = [m.attrib.get("ref", "") for m in descendants_local(root, "mergeCell")]
    rows = {}
    for row in descendants_local(root, "row"):
        row_number = int(row.attrib.get("r") or 0)
        if not row_number:
            continue
        cells = {}
        for cell in children_local(row, "c"):
            ref = cell.attrib.get("r") or ""
            if not ref:
                continue
            type_ = cell.attrib.get("t")
            style_index = int(cell.attrib.get("s") or 0)
            style = styles[style_index] if style_index < len(styles) else {}
            value_nodes = children_local(cell, "v")
            value_node = value_nodes[0] if value_nodes else None
            raw = (value_node.text or "") if value_node is not None else ""
            formula_nodes = children_local(cell, "f")
            formula = (formula_nodes[0].text or "") if formula_nodes else ""
            if type_ == "s":
                try:
                    value = shared[int(raw)]
                except (ValueError, IndexError):
                    value = ""
            elif type_ == "inlineStr":
                value = text_content(cell)
            elif type_ == "b":
                value = "TRUE" if raw == "1" else "FALSE"
            else:
                value = raw
            cache_status, cache_type = classify_formula(bool(formula_nodes), type_, value_node is not None, raw)
            fmt = style.get("format")
            textual = type_ in ("s", "inlineStr", "str", "b")
            is_date = bool(style.get("date")) and bool(value)
            iso = excel_serial_to_iso(value, date1904) if is_date and not textual else None
            invalid_date = bool(is_date and not textual and not iso and value.strip())
            percent_display = None
            if style.get("percent") and not formula and not textual:
                try:
                    percent_display = f"{float(raw) * 100:.12g}%"
                except ValueError:
                    percent_display = None
            cells[ref] = {
                "cell": ref,
                "row": row_number,
                "column": column_letters(column_number(ref)),
                "type": type_,
                "storedRaw": raw,
                "raw": raw,
                "value": value,
                "textual": textual,
                "formula": formula or None,
                "hasFormula": bool(formula_nodes),
                "formulaCacheStatus": cache_status,
                "formulaCacheType": cache_type,
                "formulaCacheRaw": raw if formula_nodes else None,
                "styleIndex": style_index,
                "numFmtId": style.get("numFmtId"),
                "formatCode": fmt,
                "isDate": is_date,
                "invalidDate": invalid_date,
                "dateIso": iso,
                "isPercent": bool(style.get("percent")),
                "percentDisplay": percent_display,
            }
        if cells:
            rows[row_number] = {"row": row_number, "cells": cells}
    return {"merges": merges, "rows": rows}


def read_workbook(path: str, all_sheets: bool):
    with open(path, "rb") as handle:
        digest = hashlib.sha256(handle.read()).hexdigest()
    with zipfile.ZipFile(path) as zf:
        sheets, date1904 = sheet_paths(zf)
        shared = read_shared_strings(zf)
        styles = read_styles(zf)
        out_sheets = []
        for name, sheet_path in sheets:
            wanted = all_sheets or WORKPLAN.search(name) or PM_SUMMARY.search(name)
            if not wanted:
                continue
            xml = zf.read(sheet_path)
            out_sheets.append({"name": name, "path": sheet_path, **read_sheet(xml, shared, styles, date1904)})
    return {
        "workbook": {
            "file": os.path.basename(path),
            "path": path,
            "sha256": digest,
        },
        "reader": {
            "kind": "independent-ooxml-python-stdlib",
            "version": 1,
            "executes_formulas": False,
            "network_used": False,
        },
        "date1904": date1904,
        "sheet_names": [name for name, _ in sheets],
        "sheets": out_sheets,
    }


def main(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--all-sheets", action="store_true")
    parser.add_argument("files", nargs="+")
    args = parser.parse_args(argv)
    os.makedirs(args.out, exist_ok=True)
    written = []
    for path in args.files:
        data = read_workbook(path, args.all_sheets)
        target = os.path.join(args.out, os.path.basename(path) + ".ooxml.json")
        with open(target, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=1)
        written.append({"file": os.path.basename(path), "out": target, "sha256": data["workbook"]["sha256"]})
    json.dump({"reader": "ooxml_reader.py", "files": written}, sys.stdout, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main(sys.argv[1:])
