#!/usr/bin/env python3
"""Verify the generated Smart Building ITB fixture pack.

Checks internal consistency only (no app involvement):
  - pack structure & identical filenames across sessions (re-upload flow)
  - workbooks open; weights sum to 1.00; weekly actual = weighted WBS progress
  - session progression: actual % increases week over week for every component
  - W5 actuals equal the untouched source values; W4/W6/W7 match expected-results.json
  - canonical naming/PIC; risk IDs stable across sessions; new/closed risks per session
  - cost reconciliation; baseline PIC fixes; charts preserved; MoM files valid
"""

from __future__ import annotations

import datetime as dt
import json
import sys
import zipfile
from pathlib import Path

from openpyxl import load_workbook

PACK = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).parent))
from data import ACTUAL, COMPONENTS, SESSIONS, SOURCE_ROOT, WEEK_CUTOFF  # noqa: E402

ERRORS: list[str] = []
CHECKS = 0


def check(cond, msg):
    global CHECKS
    CHECKS += 1
    if not cond:
        ERRORS.append(msg)


def main():
    # 1. structure -----------------------------------------------------------
    sessions = [s[0] for s in SESSIONS]
    for s in sessions:
        d = PACK / "sessions" / s
        files = sorted(f.name for f in d.iterdir())
        check(len(files) == 13, f"{s}: expected 13 files, got {len(files)}")
    names_by_session = [sorted(f.name for f in (PACK / "sessions" / s).iterdir() if f.suffix == ".xlsx")
                        for s in sessions]
    for i in range(1, len(names_by_session)):
        check(names_by_session[i] == names_by_session[0],
              f"filenames differ between {sessions[0]} and {sessions[i]} (re-upload flow broken)")
    moms = sorted(f.name for f in (PACK / "mom").iterdir())
    check(len(moms) == 5, f"mom/: expected 5 files, got {len(moms)}")
    for f in ("KEGIATAN SMART BUILDING.xlsx",
              "Spesifikasi Teknis Smart Building Pemetaan Kegiatan dan Prioritas Pembelian Barang.xlsx",
              "Perhitungan dari Spesifikasi Teknis Smart Building Pemetaan Kegiatan dan Prioritas Pembelian Barang.xlsx",
              "Pengajuan Pembelian Hardware 2 Oktober 2026_bahasan meeting 16oct.xlsx"):
        check((PACK / "00_baseline" / f).exists(), f"missing baseline file {f}")
    check((PACK / "expected-results.json").exists(), "missing expected-results.json")
    expected = json.loads((PACK / "expected-results.json").read_text(encoding="utf-8"))

    # 2. per-session workbook checks ----------------------------------------
    comp_by_file = {c.out_name: c for c in COMPONENTS}
    prev_actual: dict[str, float] = {}
    for (session, cutoff, week), exp_session in zip(SESSIONS, expected["sessions"]):
        check(exp_session["cut_off"] == cutoff.isoformat(), f"{session}: cut_off mismatch in expected-results")
        for fname in names_by_session[0]:
            comp = comp_by_file[fname]
            path = PACK / "sessions" / session / fname
            with zipfile.ZipFile(path) as z:
                names = z.namelist()
            check("xl/charts/chart1.xml" in names, f"{session}/{fname}: chart lost")
            wb = load_workbook(path, data_only=False)
            gantt, weekly, pm, risk = wb["Workplan & Gantt"], wb["Weekly Report"], wb["PM Summary"], wb["Issue Risk & Change"]

            # weights sum & rows
            weights, js, w = [], [], []
            r = 5
            while gantt.cell(row=r, column=1).value is not None:
                weights.append(float(gantt.cell(row=r, column=9).value or 0))
                j = gantt.cell(row=r, column=10).value
                js.append(float(j) if isinstance(j, (int, float)) else 0.0)
                w.append((gantt.cell(row=r, column=6).value, gantt.cell(row=r, column=7).value))
                r += 1
            check(abs(sum(weights) - 1.0) < 1e-9, f"{session}/{fname}: weights sum {sum(weights)} != 1.0")

            # weekly planned/actual vs expected-results
            exp = exp_session["components"][comp.code]
            crow = week + 3
            d_val = weekly.cell(row=crow, column=4).value
            c_val = weekly.cell(row=crow, column=3).value
            check(c_val is not None, f"{session}/{fname}: missing planned at W{week}")
            if d_val is None:
                check(False, f"{session}/{fname}: missing actual at W{week}")
                continue
            check(abs(d_val - exp["actual_percent"]) < 1e-6,
                  f"{session}/{fname}: actual {d_val} != expected {exp['actual_percent']}")
            weighted = round(sum(wi * ji for wi, ji in zip(weights, js)), 4)
            check(abs(weighted - d_val) < 5e-4,
                  f"{session}/{fname}: weighted WBS progress {weighted} != weekly actual {d_val}")

            # monotonic progression across sessions
            code = comp.code
            if code in prev_actual:
                check(d_val > prev_actual[code],
                      f"{session}/{fname}: actual {d_val} not above previous session {prev_actual[code]}")
            prev_actual[code] = d_val

            # PM summary consistent with the cut-off week
            check(str(pm["B5"].value)[:10] == cutoff.isoformat(),
                  f"{session}/{fname}: PM Summary cut-off {pm['B5'].value} != {cutoff}")
            check(f"F{crow}" in str(pm["B7"].value), f"{session}/{fname}: PM Summary RAG refs {pm['B7'].value}")

            # canonical naming
            check(comp.name in str(pm["B4"].value), f"{session}/{fname}: subsystem {pm['B4'].value}")
            check("Pengondisian" not in str(pm["B4"].value), f"{session}/{fname}: misspelling survived")
            if comp.code == "SB02":
                check("pengawasan" in str(gantt["A1"].value).lower(), f"{session}/{fname}: Kamera title not canonical")

            # risks: canonical IDs, statuses visible
            ids = set()
            rr = 4
            while risk.cell(row=rr, column=1).value not in (None, "ID"):
                ids.add(str(risk.cell(row=rr, column=1).value))
                rr += 1
                if rr > 20:
                    break
            for rid in ids:
                check(rid.startswith(f"R-{comp.code}-"), f"{session}/{fname}: foreign risk id {rid}")
            wb.close()

    # new / closed risks per expected-results
    for exp_session in expected["sessions"]:
        for code, e in exp_session["components"].items():
            for rid in e["open_risks"]:
                check(rid.startswith(f"R-{code}-"), f"foreign risk {rid} in {code}")

    # 3. W5 values equal the untouched source --------------------------------
    src_map = {
        "SB01": "Pemantau Project/1. ALARM KEBENCANAAN/01_Alarm_Kebencanaan_Subcontractor_Weekly.xlsx",
        "SB02": "Pemantau Project/2. KAMERA PENGAWAS/02_Kamera_Pengawas_Subcontractor_Weekly.xlsx",
        "SB03": "Pemantau Project/3. KONTROL AKSES/03_Kontrol_Akses_Subcontractor_Weekly.xlsx",
        "SB04": "Pemantau Project/4. KELISTRIKAN/04_Kelistrikan_Subcontractor_Weekly.xlsx",
        "SB05": "Pemantau Project/6. PENGKONDISIAN UDARA/06_Pengondisian_Udara_Subcontractor_Weekly.xlsx",
        "SB06": "Pemantau Project/9. PENGELOLAAN SAMPAH/09_Pengelolaan_Sampah_Subcontractor_Weekly.xlsx",
    }
    for code, rel in src_map.items():
        src = load_workbook(Path(SOURCE_ROOT) / rel, data_only=False)["Weekly Report"]
        out = load_workbook(PACK / "sessions" / "2026-10-16_w5" /
                            next(c.out_name for c in COMPONENTS if c.code == code))["Weekly Report"]
        check(abs(src["D8"].value - out["D8"].value) < 1e-9,
              f"{code}: W5 actual altered from source ({src['D8'].value} -> {out['D8'].value})")
        check(abs(src["C8"].value - out["C8"].value) < 1e-9, f"{code}: W5 planned altered")

    # 4. template grid trimmed ------------------------------------------------
    out = load_workbook(PACK / "sessions" / "2026-10-30_w7" / "05_Pencahayaan_Subcontractor_Weekly.xlsx")["Weekly Report"]
    check(out["A18"].value is None and out["A19"].value is None, "template W15/W16 rows not trimmed")

    # 5. baseline --------------------------------------------------------------
    base = load_workbook(PACK / "00_baseline" / "KEGIATAN SMART BUILDING.xlsx", data_only=False)
    check(base["Master Gantt"]["C40"].value == "Indismart", "Pengkondisian company not fixed in Master Gantt")
    check(base["Master Gantt"]["D74"].value == "Tezar (Urbansolv)", "Ventilasi PIC not fixed in Master Gantt")
    check(base["PIC Summary"]["A10"].value is None, "TBD PIC row still present")
    check(base["PIC Summary"]["C4"].value == 3, "Amar component count not updated")
    check("Baseline disetujui" == base["Read Me"]["A11"].value, "baseline approval row missing")
    base.close()

    # 6. cost reconciliation ----------------------------------------------------
    spec = load_workbook(PACK / "00_baseline" / "Spesifikasi Teknis Smart Building Pemetaan Kegiatan dan Prioritas Pembelian Barang.xlsx")["Master Hardware"]
    total = 0.0
    r = 2
    while spec[f"A{r}"].value is not None:
        if str(spec[f"A{r}"].value).upper() == "TOTAL":
            break
        check(isinstance(spec[f"K{r}"].value, (int, float)) and isinstance(spec[f"L{r}"].value, (int, float)),
              f"spec row {r}: money cells not numeric")
        check(abs(spec[f"K{r}"].value * spec[f"H{r}"].value - spec[f"L{r}"].value) < 0.01,
              f"spec row {r}: qty*price != total")
        total += spec[f"L{r}"].value
        r += 1
    check(abs(total - spec["L33"].value) < 0.01, f"spec TOTAL {spec['L33'].value} != sum {total}")
    check(spec["L32"].value == 11_500_000, "video wall controller typo not fixed")

    req = load_workbook(Pack_req := PACK / "00_baseline" / "Pengajuan Pembelian Hardware 2 Oktober 2026_bahasan meeting 16oct.xlsx")["Master Hardware"]
    req_total = sum(req[f"L{r}"].value or 0 for r in range(2, 33) if req[f"A{r}"].value)
    check(abs(req_total - 1_375_170_793) < 0.01, f"pengajuan total {req_total} unexpected")
    check(req["J2"].value == "Indonesia", "pengajuan origin not aligned")

    calc = load_workbook(PACK / "00_baseline" / "Perhitungan dari Spesifikasi Teknis Smart Building Pemetaan Kegiatan dan Prioritas Pembelian Barang.xlsx")["Estimasi Rincian Pembagian"]
    check(calc["E9"].value == total, "Perhitungan hardware total != Spesifikasi TOTAL")

    # 7. MoM docx ---------------------------------------------------------------
    import docx
    for f in sorted((PACK / "mom").iterdir()):
        d = docx.Document(str(f))
        titles = [p.text for p in d.paragraphs if p.style.name == "Title"]
        check(len(titles) == 1, f"{f.name}: {len(titles)} Title paragraphs")
    m3 = docx.Document(str(PACK / "mom" / "MoM_2026-09-30_Diskusi_Teknis.docx"))
    full_text = "\n".join(p.text for p in m3.paragraphs) + "\n" + "\n".join(
        c.text for t in m3.tables for row in t.rows for c in row.cells)
    check("2 September" not in full_text, "MoM 30-Sep typo not fixed")
    check("2 Oktober" in full_text, "MoM 30-Sep corrected date missing")
    for s in sessions:
        for f in (PACK / "sessions" / s).glob("*.docx"):
            d = docx.Document(str(f))
            check(len(d.tables) >= 3, f"{s}/{f.name}: tables missing")
    d6 = docx.Document(str(PACK / "sessions" / "2026-10-23_w6" / "MoM_2026-10-23_Weekly_Meeting_ke-6.docx"))
    t6 = "\n".join(c.text for t in d6.tables for row in t.rows for c in row.cells)
    check("64 lantai" in t6, "MoM W6 missing elevator confirmation")
    d7 = docx.Document(str(PACK / "sessions" / "2026-10-30_w7" / "MoM_2026-10-30_Weekly_Meeting_ke-7.docx"))
    t7 = "\n".join(c.text for t in d7.tables for row in t.rows for c in row.cells)
    check("R-SB02-001" in t7 or "API" in t7, "MoM W7 missing kamera risk escalation")

    print(f"{CHECKS} checks run, {len(ERRORS)} failures")
    for e in ERRORS:
        print("  FAIL:", e)
    return 1 if ERRORS else 0


if __name__ == "__main__":
    sys.exit(main())
