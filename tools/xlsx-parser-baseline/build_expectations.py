"""Build structural expectations for the XLSX parser from RAW workbook cells.

Expectations come from the source workbooks (openpyxl), never from parser
output. The TEMPLATE block below is the human-reviewable statement of what the
DKST subcontractor template looks like; each entry is verified against the raw
cells before it is emitted, so a wrong statement fails loudly here.

Usage: python build_expectations.py <smart-building-itb dir> <out dir>
Writes: <out>/expectations.json and <out>/heldout/*.xlsx
"""
import datetime
import json
import pathlib
import re
import sys

import openpyxl
from openpyxl.styles.numbers import is_date_format
from openpyxl.utils import get_column_letter, column_index_from_string
from openpyxl.utils.datetime import from_excel

# ---- Reviewable template statement (DKST subcontractor weekly workbook) ----
# header_row: row holding the real column header; cols: inclusive column span
# that the header covers. Cells above the header row (title, week band) are not
# column headers.
TABLES = {
    "Workplan & Gantt": {"first_label": "WBS", "family": "workplan", "header_row": 4, "cols": ("A", "R")},
    "Weekly Report": {"first_label": "Week", "family": "weekly_report", "header_row": 3, "cols": ("A", "N")},
    "Integration Readiness": {"first_label": "Device / Component", "family": "integration_readiness", "header_row": 3, "cols": ("A", "M")},
    "Issue Risk & Change": {"first_label": "ID", "family": "issue_risk_change", "header_row": 3, "cols": ("A", "L")},
    "Evidence & Handover": {"first_label": "Ref ID", "family": "evidence_handover", "header_row": 3, "cols": ("A", "J")},
    "Data Quality Audit": {"first_label": "Pemeriksaan", "family": "data_quality", "header_row": 4, "cols": ("A", "C")},
}
# Key-value blocks: start row; the block runs while column A and B are both
# non-empty literal text/number cells. Value cell must be labelled by its key.
KEY_VALUE = {
    "Project Info": {"family": "project_info", "start": 3},
    "PM Summary": {"family": "pm_summary", "start": 3},
    "Read Me": {"family": "read_me", "start": 4},
    "Data Quality Audit": {"first_label": "Pemeriksaan", "family": "data_quality_meta", "start": 2, "single": True},
}
# ----------------------------------------------------------------------------


def text(cell):
    v = cell.value
    return None if v is None else str(v).strip()


def is_formula(cell):
    return isinstance(cell.value, str) and cell.value.startswith("=")


def table_check(ws, spec):
    hr = spec["header_row"]
    c1, c2 = (column_index_from_string(c) for c in spec["cols"])
    if text(ws.cell(hr, 1)) != spec["first_label"]:
        # Template variant: no header row exists; row `hr` is already data.
        # The parser must not invent labels from it and must keep it as a record.
        return {"type": "noHeader", "sheet": ws.title, "family": spec["family"],
                "firstDataRow": hr, "lastRow": ws.max_row, "cols": [get_column_letter(i) for i in range(c1, c2 + 1)],
                "firstRowValues": [str(ws.cell(hr, i).value) for i in range(c1, c2 + 1) if ws.cell(hr, i).value is not None],
                "note": f"A{hr} is {text(ws.cell(hr, 1))!r}, not the template header {spec['first_label']!r}"}
    labels = {}
    for ci in range(c1, c2 + 1):
        v = text(ws.cell(hr, ci))
        if not v:
            raise SystemExit(f"{ws.parent.path if hasattr(ws.parent,'path') else ''}{ws.title}: empty header at {get_column_letter(ci)}{hr}")
        labels[get_column_letter(ci)] = v
    present = {}
    for col in labels:
        ci = column_index_from_string(col)
        present[col] = [r for r in range(hr + 1, ws.max_row + 1)
                        if ws.cell(r, ci).value is not None and str(ws.cell(r, ci).value).strip() != ""]
    return {
        "type": "columnLabels",
        "sheet": ws.title,
        "family": spec["family"],
        "headerRow": hr,
        "firstDataRow": hr + 1,
        "lastRow": ws.max_row,
        "labels": labels,
        "present": present,
    }


def key_value_check(ws, spec):
    pairs = []
    r = spec["start"]
    while True:
        a, b = ws.cell(r, 1), ws.cell(r, 2)
        if text(a) is None or text(b) is None or is_formula(a):
            break
        pairs.append({"key": text(a), "keyCell": a.coordinate, "valueCell": b.coordinate})
        r += 1
        if spec.get("single"):
            break
    if not pairs:
        raise SystemExit(f"{ws.title}: no key-value pairs at row {spec['start']}")
    return {"type": "keyValue", "sheet": ws.title, "family": spec["family"], "pairs": pairs}


def date_cells(ws):
    out = []
    for row in ws.iter_rows():
        for c in row:
            if c.value is None or not is_date_format(c.number_format):
                continue
            v = c.value
            if isinstance(v, str):
                if v.startswith("="):
                    continue
                kind = "text_iso" if re.match(r"^\d{4}-\d{2}-\d{2}", v) else "text_other"
                out.append({"sheet": ws.title, "cell": c.coordinate, "kind": kind, "iso": v[:10] if kind == "text_iso" else None})
            elif isinstance(v, (datetime.datetime, datetime.date)):
                d = v.date() if isinstance(v, datetime.datetime) else v
                out.append({"sheet": ws.title, "cell": c.coordinate, "kind": "serial", "iso": d.isoformat()})
            elif isinstance(v, (int, float)):
                out.append({"sheet": ws.title, "cell": c.coordinate, "kind": "serial", "iso": from_excel(v).date().isoformat()})
    return out


def title_check(ws):
    a1 = ws["A1"]
    t = text(a1)
    return {"type": "title", "sheet": ws.title, "cell": "A1", "family": "title", "text": t} if t else None


def build_template_file(path, rel):
    wb = openpyxl.load_workbook(path)
    checks = []
    for ws in wb:
        if ws.title in TABLES:
            checks.append(table_check(ws, TABLES[ws.title]))
        if ws.title in KEY_VALUE:
            checks.append(key_value_check(ws, KEY_VALUE[ws.title]))
        t = title_check(ws)
        if t:
            checks.append(t)
    # Header-row cells are labels, not data: they are never expected as data cells.
    header_rows = {c["sheet"]: c["headerRow"] for c in checks if c["type"] == "columnLabels"}
    dates = [d for ws in wb for d in date_cells(ws)
             if int("".join(ch for ch in d["cell"] if ch.isdigit())) != header_rows.get(ws.title)]
    return {"file": rel, "set": "tuning", "checks": checks, "dates": dates}


# ------------------------------ held-out set ------------------------------
def heldout(outdir):
    outdir.mkdir(parents=True, exist_ok=True)
    cases = []

    def save(name, wb):
        p = outdir / name
        wb.save(p)
        return p

    # H1: Indonesian headers, reordered, one extra column
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Laporan Mingguan"
    ws["A1"] = "LAPORAN KEMAJUAN MINGGUAN - UJI"; ws.merge_cells("A1:H1")
    hdr = ["Periode", "Tanggal Cut-off", "Rencana %", "Aktual %", "Pemilik", "Catatan", "Tenggat", "Ref Bukti"]
    for i, h in enumerate(hdr, 1): ws.cell(3, i, h)
    for r in range(4, 9):
        ws.cell(r, 1, f"W{r-3}"); ws.cell(r, 2, datetime.datetime(2026, 10, 2) + datetime.timedelta(days=7 * (r - 4))).number_format = "dd-mmm-yyyy"
        ws.cell(r, 3, 0.1 * (r - 3)).number_format = "0%"; ws.cell(r, 4, 0.09 * (r - 3)).number_format = "0%"
        ws.cell(r, 5, "Amar"); ws.cell(r, 6, "Catatan minggu ini"); ws.cell(r, 7, datetime.datetime(2026, 10, 30)).number_format = "dd-mmm-yyyy"; ws.cell(r, 8, f"EV-00{r}")
    p = save("H1_weekly_report_id_reordered.xlsx", wb)
    cases.append((p, [{"type": "columnLabels", "sheet": "Laporan Mingguan", "family": "heldout_weekly", "headerRow": 3, "firstDataRow": 4, "lastRow": 8, "labels": {chr(64 + i): h for i, h in enumerate(hdr, 1)}},
                      {"type": "title", "sheet": "Laporan Mingguan", "cell": "A1", "family": "title", "text": "LAPORAN KEMAJUAN MINGGUAN - UJI"}]))

    # H2: Gantt-style week band above a real header (band only over gantt columns)
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Rencana"
    ws["A1"] = "RENCANA KERJA - UJI"; ws.merge_cells("A1:E1")
    for i, h in enumerate(["M1", "M2", "M3", "M4"], 6): ws.cell(3, i, h)
    hdr = ["WBS", "Kegiatan", "Mulai", "Selesai", "Bobot"]
    for i, h in enumerate(hdr, 1): ws.cell(4, i, h)
    # Week-start dates as header cells over the band columns (mixed text/date header row).
    for i in range(6, 10):
        ws.cell(4, i, datetime.datetime(2026, 9, 18) + datetime.timedelta(days=7 * (i - 6))).number_format = "dd-mmm"
    for r in range(5, 10):
        ws.cell(r, 1, f"1.{r-4}"); ws.cell(r, 2, f"Kegiatan {r-4}")
        ws.cell(r, 3, datetime.datetime(2026, 9, 18) + datetime.timedelta(days=7 * (r - 5))).number_format = "yyyy-mm-dd"
        ws.cell(r, 4, datetime.datetime(2026, 10, 9) + datetime.timedelta(days=7 * (r - 5))).number_format = "yyyy-mm-dd"
        ws.cell(r, 5, 0.2).number_format = "0%"
        for c in range(6, 10): ws.cell(r, c, 1 if (r + c) % 3 == 0 else None)
    p = save("H2_gantt_band_header.xlsx", wb)
    cases.append((p, [{"type": "columnLabels", "sheet": "Rencana", "family": "heldout_gantt", "headerRow": 4, "firstDataRow": 5, "lastRow": 9, "labels": {chr(64 + i): h for i, h in enumerate(hdr, 1)}}]))

    # H3: two-row header (merged group header over sub-headers)
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Anggaran"
    ws["A3"] = "Item"; ws["B3"] = "Anggaran"; ws.merge_cells("B3:C3"); ws["D3"] = "Realisasi"; ws.merge_cells("D3:E3")
    for c, h in zip("BCDE", ["Rencana", "Revisi", "s.d. Bulan Lalu", "Bulan Ini"]): ws[f"{c}4"] = h
    ws["A4"] = None
    for r in range(5, 9):
        ws.cell(r, 1, f"Paket {r-4}")
        for c in range(2, 6): ws.cell(r, c, 1000000 * (r - 3) + c)
    p = save("H3_two_row_header.xlsx", wb)
    cases.append((p, [{"type": "columnLabels", "sheet": "Anggaran", "family": "heldout_two_row", "headerRow": 3, "firstDataRow": 5, "lastRow": 8,
                       "labels": {"A": "Item", "B": "Anggaran / Rencana", "C": "Anggaran / Revisi", "D": "Realisasi / s.d. Bulan Lalu", "E": "Realisasi / Bulan Ini"}}]))

    # H4: Indonesian key-value block
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Info Proyek"
    ws["A1"] = "INFORMASI PROYEK - UJI"; ws.merge_cells("A1:D1")
    kv = [("Proyek", "Smart Building Uji"), ("Subsistem", "Kelistrikan"), ("Periode Pelaporan", "September-Desember 2026"),
          ("Cut-off Pelaporan", datetime.datetime(2026, 10, 30)), ("Progres Keseluruhan", 0.381)]
    for i, (k, v) in enumerate(kv, 3):
        ws.cell(i, 1, k); c = ws.cell(i, 2, v)
        if isinstance(v, datetime.datetime): c.number_format = "dd-mmm-yyyy"
        if isinstance(v, float): c.number_format = "0%"
    p = save("H4_key_value_id.xlsx", wb)
    cases.append((p, [{"type": "keyValue", "sheet": "Info Proyek", "family": "heldout_key_value",
                       "pairs": [{"key": k, "keyCell": f"A{i}", "valueCell": f"B{i}"} for i, (k, _) in enumerate(kv, 3)]}]))

    # H5: two-column table WITH a real header (must not be read as key-value)
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Audit"
    ws["A1"] = "AUDIT DATA - UJI"; ws.merge_cells("A1:C1")
    ws["A3"] = "Pemeriksaan"; ws["B3"] = "Hasil"
    for r, (a, b) in enumerate([("Total bobot WBS", "1.00"), ("Tanggal baseline", "Urut"), ("Dependensi", "Lengkap"), ("Persen selesai", "Terisi")], 4):
        ws.cell(r, 1, a); ws.cell(r, 2, b)
    p = save("H5_two_column_real_header.xlsx", wb)
    cases.append((p, [{"type": "columnLabels", "sheet": "Audit", "family": "heldout_two_col_table", "headerRow": 3, "firstDataRow": 4, "lastRow": 7, "labels": {"A": "Pemeriksaan", "B": "Hasil"}}]))

    # H6: mixed date typing in a date-formatted column
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Tanggal"
    ws["A1"] = "Kegiatan"; ws["B1"] = "Tanggal"; ws["B1"].number_format = "dd-mmm-yyyy"
    rows = [("A", datetime.datetime(2026, 10, 13)), ("B", "2026-10-13"), ("C", "13/10/2026"), ("D", "TBD"), ("E", 46313)]
    for r, (a, b) in enumerate(rows, 2):
        ws.cell(r, 1, a); ws.cell(r, 2, b).number_format = "dd-mmm-yyyy"
    p = save("H6_mixed_date_typing.xlsx", wb)
    cases.append((p, [{"type": "columnLabels", "sheet": "Tanggal", "family": "heldout_dates", "headerRow": 1, "firstDataRow": 2, "lastRow": 6, "labels": {"A": "Kegiatan", "B": "Tanggal"}}]))

    out = []
    for p, checks in cases:
        wb = openpyxl.load_workbook(p)
        for chk in checks:
            if chk["type"] == "columnLabels":
                ws = wb[chk["sheet"]]
                chk["present"] = {col: [r for r in range(chk["firstDataRow"], chk["lastRow"] + 1)
                                        if ws.cell(r, column_index_from_string(col)).value is not None] for col in chk["labels"]}
        header_rows = {c["sheet"]: c["headerRow"] for c in checks if c["type"] == "columnLabels"}
        dates = [d for ws in wb for d in date_cells(ws)
                 if int("".join(ch for ch in d["cell"] if ch.isdigit())) != header_rows.get(ws.title)]
        out.append({"file": "heldout/" + p.name, "set": "heldout", "checks": checks, "dates": dates})
    return out


def main():
    src = pathlib.Path(sys.argv[1]); out = pathlib.Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
    files = []
    uncovered = []
    for p in sorted(src.rglob("*.xlsx")):
        rel = p.relative_to(src).as_posix()
        if "Subcontractor_Weekly" in p.name:
            files.append(build_template_file(p, rel))
        else:
            wb = openpyxl.load_workbook(p)
            files.append({"file": rel, "set": "tuning", "checks": [], "dates": [d for ws in wb for d in date_cells(ws)]})
            uncovered.append(rel)
    files += heldout(out / "heldout")
    (out / "expectations.json").write_text(json.dumps({"files": files, "structurallyUncovered": uncovered}, indent=1), encoding="utf-8")
    n = sum(len(f["checks"]) for f in files)
    print(f"files={len(files)} structural-checks={n} date-cells={sum(len(f['dates']) for f in files)} uncovered={len(uncovered)}")


if __name__ == "__main__":
    main()
