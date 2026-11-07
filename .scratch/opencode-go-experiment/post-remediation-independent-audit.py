#!/usr/bin/env python3
"""Independent OOXML metric audit for the post-remediation validation.

Reads only the JSON produced by ooxml_reader.py (Python stdlib, no formula
execution, no network) and expected-results.json. It does NOT use the
production parser or extraction output. Values are read from the workbook
cells themselves; expected values are loaded separately for comparison.

Metrics: reporting cut-off, planned, actual, variance, RAG, overall progress,
independently recomputed weighted progress (sum I*J), next milestone, and
per-session risk sets/evolution.
"""
import argparse
import json
import os
import re
import sys

TOL = 0.00005
CODE_RE = re.compile(r"^\d+(?:\.\d+)*$")


def load(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def num(cell):
    if cell is None:
        return None
    value = cell.get("value")
    if value in (None, ""):
        return None
    try:
        return float(str(value).replace(",", "").strip())
    except ValueError:
        return None


def cached_or_value(cell):
    """Return (value, status). Formula caches are never silently treated as fresh."""
    if cell is None:
        return None, "missing_cell"
    if cell.get("hasFormula"):
        status = cell.get("formulaCacheStatus")
        if status != "cached_value":
            return None, f"formula_{status}"
        raw = cell.get("formulaCacheRaw")
        try:
            return float(str(raw).replace(",", "").strip()), "cached_formula"
        except (TypeError, ValueError):
            return None, "cached_non_numeric"
    return num(cell), "literal"


def text(cell):
    if cell is None:
        return None
    value = cell.get("value")
    return None if value in (None, "") else str(value).strip()


def sheet(book, name):
    for item in book.get("sheets", []):
        if item.get("name") == name:
            return item
    return None


def find_row(ws, predicate):
    for row_key, row in ws.get("rows", {}).items():
        cells = row.get("cells", {})
        if predicate(cells, int(row_key)):
            return int(row_key), cells
    return None, None


def cell_at(cells, ref):
    return cells.get(ref)


def read_weekly(book, cutoff):
    ws = sheet(book, "Weekly Report")
    if not ws:
        return {"status": "missing_sheet"}
    header_row, header = find_row(
        ws,
        lambda cells, _row: any(str(c.get("value", "")).strip() == "Planned %" for c in cells.values()),
    )
    if not header_row:
        return {"status": "missing_header"}
    labels = {str(c.get("value", "")).strip(): ref.rstrip("0123456789") for ref, c in header.items()}
    selected = None
    for row_key, row in ws.get("rows", {}).items():
        row_no = int(row_key)
        if row_no <= header_row:
            continue
        cells = row.get("cells", {})
        date_cell = cells.get(labels.get("Cut-off Date", "B") + row_key)
        iso = date_cell.get("dateIso") if date_cell else None
        raw = text(date_cell) if date_cell else None
        if iso == cutoff or raw == cutoff:
            selected = (row_no, cells)
            break
    if not selected:
        return {"status": "cutoff_row_not_found", "header_row": header_row}
    row_no, cells = selected
    col = {label: ref for label, ref in labels.items()}

    def get(label):
        ref = f"{col.get(label)}{row_no}" if col.get(label) else None
        return cells.get(ref) if ref else None

    planned = num(get("Planned %"))
    actual = num(get("Actual %"))
    variance, variance_status = cached_or_value(get("Variance"))
    rag_cell = get("RAG")
    if rag_cell and rag_cell.get("hasFormula"):
        rag = (
            str(rag_cell.get("formulaCacheRaw")).strip()
            if rag_cell.get("formulaCacheStatus") == "cached_value"
            else None
        )
        rag_status = f"formula_{rag_cell.get('formulaCacheStatus')}"
    else:
        rag = text(rag_cell)
        rag_status = "literal"
    return {
        "status": "ok",
        "row": row_no,
        "cutoff_date": cutoff,
        "planned_percent": planned,
        "actual_percent": actual,
        "variance_percent": variance,
        "variance_status": variance_status,
        "rag": rag,
        "rag_status": rag_status,
        "cells": {
            "planned": f"{col.get('Planned %')}{row_no}",
            "actual": f"{col.get('Actual %')}{row_no}",
            "variance": f"{col.get('Variance')}{row_no}",
            "rag": f"{col.get('RAG')}{row_no}",
            "cutoff": f"{col.get('Cut-off Date')}{row_no}",
        },
    }


def read_pm(book):
    ws = sheet(book, "PM Summary")
    if not ws:
        return {"status": "missing_sheet"}
    values = {}
    for row in ws.get("rows", {}).values():
        cells = row.get("cells", {})
        for ref, cell in cells.items():
            label = text(cells.get(f"A{cell.get('row')}"))
            if label:
                values[label] = cell
    def field(label):
        cell = values.get(label)
        return {
            "value": text(cell),
            "dateIso": cell.get("dateIso") if cell else None,
            "cell": cell.get("cell") if cell else None,
            "cache_status": cell.get("formulaCacheStatus") if cell else None,
        }
    return {
        "status": "ok",
        "cutoff": field("Reporting Cut-off"),
        "overall_progress": field("Overall Progress"),
        "overall_rag": field("Overall RAG"),
        "next_milestone": field("Next Critical Milestone"),
    }


def read_workplan(book):
    ws = sheet(book, "Workplan & Gantt")
    if not ws:
        return {"status": "missing_sheet"}
    header_row, header = find_row(
        ws,
        lambda cells, _row: any(str(c.get("value", "")).strip().upper() == "WBS" for c in cells.values()),
    )
    if not header_row:
        return {"status": "missing_header"}
    labels = {}
    for ref, cell in header.items():
        label = str(cell.get("value", "")).strip().lower()
        column = re.match(r"^[A-Z]+", ref)
        if column and label:
            labels.setdefault(label, column.group(0))
    code_col = labels.get("wbs")
    weight_col = labels.get("weight")
    percent_col = labels.get("% complete")
    if not code_col or not percent_col:
        return {"status": "missing_columns", "labels": sorted(labels)}
    rows = []
    for row_key, row in ws.get("rows", {}).items():
        if int(row_key) <= header_row:
            continue
        cells = row.get("cells", {})
        code = text(cells.get(f"{code_col}{row_key}"))
        if not code or not CODE_RE.match(code):
            continue
        weight = num(cells.get(f"{weight_col}{row_key}")) if weight_col else None
        percent = num(cells.get(f"{percent_col}{row_key}"))
        rows.append(
            {
                "row": int(row_key),
                "code": code,
                "weight": weight,
                "percent": percent,
                "weighted": weight * percent if weight is not None and percent is not None else None,
            }
        )
    weighted_values = [r["weighted"] for r in rows if r["weighted"] is not None]
    weights = [r["weight"] for r in rows if r["weight"] is not None]
    return {
        "status": "ok",
        "header_row": header_row,
        "columns": {"code": code_col, "weight": weight_col, "percent": percent_col},
        "rows": rows,
        "row_count": len(rows),
        "weight_sum": round(sum(weights), 10) if weights else None,
        "weighted_progress": round(sum(weighted_values), 10) if weighted_values else None,
        "rows_missing_weight_or_percent": sum(1 for r in rows if r["weighted"] is None),
    }


def read_risks(book):
    ws = sheet(book, "Issue Risk & Change")
    if not ws:
        return {"status": "missing_sheet"}
    header_row, header = find_row(
        ws,
        lambda cells, _row: any(str(c.get("value", "")).strip() == "ID" for c in cells.values()),
    )
    if not header_row:
        return {"status": "missing_header"}
    labels = {}
    for ref, cell in header.items():
        label = str(cell.get("value", "")).strip().lower()
        column = re.match(r"^[A-Z]+", ref)
        if column and label:
            labels.setdefault(label, column.group(0))
    id_col = labels.get("id")
    status_col = labels.get("status")
    priority_col = labels.get("priority")
    if not id_col or not status_col:
        return {"status": "missing_columns"}
    entries = []
    for row_key, row in ws.get("rows", {}).items():
        if int(row_key) <= header_row:
            continue
        cells = row.get("cells", {})
        risk_id = text(cells.get(f"{id_col}{row_key}"))
        if not risk_id or not risk_id.upper().startswith("R-"):
            continue
        entries.append(
            {
                "id": risk_id,
                "row": int(row_key),
                "status": text(cells.get(f"{status_col}{row_key}")),
                "priority": text(cells.get(f"{priority_col}{row_key}")) if priority_col else None,
            }
        )
    return {
        "status": "ok",
        "header_row": header_row,
        "entries": entries,
        "open": sorted(item["id"] for item in entries if str(item["status"] or "").lower().startswith("open")),
    }


def within(actual, expected):
    return actual is not None and expected is not None and abs(actual - expected) <= TOL


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ooxml-root", required=True)
    parser.add_argument("--expected", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--sessions", nargs="+", required=True)
    args = parser.parse_args()

    expected = load(args.expected)
    result = {
        "kind": "post-remediation-independent-ooxml-audit",
        "reader": "ooxml_reader.py (Python stdlib, no formula execution, no network)",
        "tolerance": TOL,
        "expected": args.expected,
        "sessions": {},
        "overall": {
            "workbooks": 0,
            "cutoff": {"match": 0, "mismatch": 0, "unsupported": 0},
            "weekly": {
                field: {"match": 0, "mismatch": 0, "unsupported": 0}
                for field in ("planned_percent", "actual_percent", "variance_percent", "rag")
            },
            "overall_progress": {"match": 0, "mismatch": 0, "unsupported": 0},
            "weighted_progress": {"match": 0, "mismatch": 0, "unsupported": 0},
            "milestone": {"match": 0, "mismatch": 0, "unsupported": 0},
            "risk_open_set": {"match": 0, "mismatch": 0, "unsupported": 0},
            "risk_new_set": {"match": 0, "mismatch": 0, "unsupported": 0},
            "risk_closed_set": {"match": 0, "mismatch": 0, "unsupported": 0},
            "risk_priority_changed": {"match": 0, "mismatch": 0, "unsupported": 0},
            "row_rollup": {"match": 0, "mismatch": 0, "unsupported": 0},
        },
        "mismatches": [],
    }

    prev_open = {}
    prev_priority = {}
    for session in expected["sessions"]:
        name = session["session"]
        session_dir = os.path.join(args.ooxml_root, name)
        session_out = {"cut_off": session["cut_off"], "components": {}, "rollup": {}, "risk_summary": {}}
        independent_actuals = []
        independent_open_total = 0
        for code, component in session["components"].items():
            file_name = component["report_file"]
            path = os.path.join(session_dir, file_name + ".ooxml.json")
            if not os.path.exists(path):
                session_out["components"][code] = {"status": "missing_ooxml", "file": file_name}
                continue
            book = load(path)
            pm = read_pm(book)
            cutoff = pm.get("cutoff", {}).get("value") if pm.get("status") == "ok" else None
            if cutoff is None and pm.get("cutoff", {}).get("dateIso"):
                cutoff = pm["cutoff"]["dateIso"]
            weekly = read_weekly(book, cutoff or "")
            workplan = read_workplan(book)
            risks = read_risks(book)
            item = {
                "file": file_name,
                "pm": pm,
                "weekly": weekly,
                "workplan": workplan,
                "risks": risks,
                "checks": {},
            }

            def check(scope, got, want, extra=None):
                container = result["overall"]
                if scope in container.get("weekly", {}):
                    container = container["weekly"]
                target = container[scope]
                if got is None:
                    target["unsupported"] += 1
                    verdict = "unsupported"
                elif isinstance(got, (int, float)) and isinstance(want, (int, float)):
                    verdict = "match" if within(got, want) else "mismatch"
                    target[verdict] += 1
                elif want is not None and got == want:
                    target["match"] += 1
                    verdict = "match"
                else:
                    target["mismatch"] += 1
                    verdict = "mismatch"
                item["checks"][scope] = {"got": got, "expected": want, "verdict": verdict, **(extra or {})}
                if verdict != "match":
                    result["mismatches"].append(
                        {"session": name, "component": code, "scope": scope, "got": got, "expected": want, **(extra or {})}
                    )
                return verdict

            check("cutoff", cutoff, session["cut_off"], {"cell": pm.get("cutoff", {}).get("cell")})
            if weekly.get("status") == "ok":
                for field in ("planned_percent", "actual_percent", "variance_percent", "rag"):
                    check(field, weekly.get(field), component.get(field), {"cell": weekly.get("cells", {}).get(field.split("_")[0])})
            else:
                for field in ("planned_percent", "actual_percent", "variance_percent", "rag"):
                    result["overall"]["weekly"][field]["unsupported"] += 1
                item["checks"]["weekly"] = {"verdict": "unsupported", "status": weekly.get("status")}

            overall_value = None
            if pm.get("status") == "ok" and pm.get("overall_progress"):
                try:
                    overall_value = float(str(pm["overall_progress"]["value"]).replace(",", ""))
                except (TypeError, ValueError):
                    overall_value = None
            check("overall_progress", overall_value, component.get("overall_weighted_progress"), {"cell": pm.get("overall_progress", {}).get("cell")})
            check(
                "weighted_progress",
                workplan.get("weighted_progress") if workplan.get("status") == "ok" else None,
                component.get("overall_weighted_progress"),
                {"rows": workplan.get("row_count"), "weight_sum": workplan.get("weight_sum")},
            )
            milestone = pm.get("next_milestone", {}).get("value") if pm.get("status") == "ok" else None
            check("milestone", milestone, component.get("next_milestone"), {"cell": pm.get("next_milestone", {}).get("cell")})

            open_ids = risks.get("open") if risks.get("status") == "ok" else None
            check("risk_open_set", open_ids, sorted(component.get("open_risks") or []))
            if open_ids is not None:
                independent_open_total += len(open_ids)
            previous = prev_open.get(code)
            if open_ids is None:
                result["overall"]["risk_new_set"]["unsupported"] += 1
                result["overall"]["risk_closed_set"]["unsupported"] += 1
                result["overall"]["risk_priority_changed"]["unsupported"] += 1
            else:
                current = set(open_ids)
                before = set(previous or [])
                new_ids = sorted(current - before)
                closed_ids = sorted(before - current)
                current_priority = {
                    entry["id"]: entry["priority"] for entry in risks.get("entries", []) if entry.get("priority")
                }
                changed = []
                for risk_id, priority in current_priority.items():
                    if risk_id in (prev_priority.get(code) or {}) and prev_priority[code][risk_id] != priority:
                        changed.append(risk_id)
                if previous is None:
                    # No earlier workbook in this corpus: a first-session delta is
                    # not derivable, so it is unsupported rather than a mismatch.
                    for scope in ("risk_new_set", "risk_closed_set", "risk_priority_changed"):
                        result["overall"][scope]["unsupported"] += 1
                        item["checks"][scope] = {"verdict": "unsupported", "reason": "first_session_no_prior"}
                else:
                    check("risk_new_set", new_ids, sorted(component.get("new_risks") or []))
                    check("risk_closed_set", closed_ids, sorted(component.get("closed_risks") or []))
                    check("risk_priority_changed", sorted(changed), sorted(component.get("priority_changed_risks") or []))
                prev_priority[code] = current_priority
                prev_open[code] = open_ids
            if weekly.get("status") == "ok" and weekly.get("actual_percent") is not None:
                independent_actuals.append((code, weekly["actual_percent"]))
            session_out["components"][code] = item

        average = (
            round(sum(value for _code, value in independent_actuals) / len(independent_actuals), 4)
            if independent_actuals
            else None
        )
        rollup = {"average_actual_percent": average, "denominator": len(independent_actuals)}
        rollup_verdict = check("row_rollup", average, session.get("project_rollup", {}).get("average_actual_percent"))
        session_out["rollup"] = {**rollup, "verdict": rollup_verdict}
        session_out["risk_summary"] = {
            "open_total": independent_open_total,
            "expected_open_total": session.get("risk_summary", {}).get("open_total"),
            "verdict": "match" if independent_open_total == session.get("risk_summary", {}).get("open_total") else "mismatch",
        }
        result["sessions"][name] = session_out
        result["overall"]["workbooks"] += len(session["components"])

    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, "independent-audit.json"), "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2)
    print(json.dumps({"overall": result["overall"], "mismatch_count": len(result["mismatches"])}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
