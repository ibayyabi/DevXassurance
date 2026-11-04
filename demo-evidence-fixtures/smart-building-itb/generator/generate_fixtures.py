#!/usr/bin/env python3
"""Generate the Smart Building ITB fixture pack.

Reads the source documents (read-only) under /Users/iweng/Downloads/SMART BUILDING
and writes a cleaned, completed, multi-session fixture pack next to this script:

    ../00_baseline/   approved baseline + reconciled cost documents
    ../mom/           one cleaned MoM per meeting (5 source meetings)
    ../sessions/      4 weekly sessions x 12 identical-filename progress reports
    ../expected-results.json

The same report filename is re-uploaded in every session with the progress
advanced one week - that is the re-upload userflow under test.

Run with the generator venv:  python3 generate_fixtures.py
"""

from __future__ import annotations

import datetime as dt
import json
import shutil
import sys
from pathlib import Path

from openpyxl import load_workbook

sys.path.insert(0, str(Path(__file__).parent))
from xlsx_patch import Patcher  # noqa: E402
import docx_tools  # noqa: E402
from data import (  # noqa: E402
    ACTUAL, BASELINE_APPROVED, COMPONENTS, COMPANY_CANON, CONTRACT_REF,
    CONTRACT_VALUE, MOM_W6, MOM_W7, NARRATIVE, PROJECT, RISKS, SESSIONS,
    SOURCE_ROOT, TEMPLATE_WBS, WEEK_CUTOFF,
)

# normalize risk "raised" strings to dates once, up front
for _risks in RISKS.values():
    for _r in _risks:
        if isinstance(_r["raised"], str):
            _r["raised"] = dt.date.fromisoformat(_r["raised"])
        if isinstance(_r["target"], str):
            _r["target"] = dt.date.fromisoformat(_r["target"])

PACK = Path(__file__).resolve().parent.parent
PEMANTAU = Path(SOURCE_ROOT) / "Pemantau Project"

TITLE_FIX = {
    "SB01": "ALARM KEBENCANAAN", "SB02": "KAMERA PENGAWASAN", "SB03": "KONTROL AKSES",
    "SB04": "KELISTRIKAN", "SB05": "PENGKONDISIAN UDARA", "SB06": "PENGELOLAAN SAMPAH",
    "SB07": "PENCAHAYAAN", "SB08": "AIR BERSIH", "SB09": "AIR LIMBAH",
    "SB10": "VENTILASI", "SB11": "PENGELOLAAN UTILITAS", "SB12": "BISMA",
}

INTEGRATION_DEVICE = {
    "SB07": ("Light intensity sensor RS485 (24 unit)", "lux-001..024",
             "Modbus RTU -> gateway MQTT (bisma/lighting/../event)"),
    "SB08": ("Sensor air bersih pH/EC/turbidity/level/flow",
             "ph-001..003; ec-001..003; tb-001..003; lvl-001..003; fm-001..008",
             "RS-485 -> API /clean-water"),
    "SB09": ("Sensor IPAL pH/EC/level/flow",
             "ipal-ph-001..002; ipal-lvl-001..002; ipal-fm-001..002",
             "RS-485 -> API /waste-water"),
    "SB10": ("Smart air purifier (15 unit) + sensor udara", "pur-001..015; aq-001..005",
             "WiFi/Tuya -> bridge MQTT (bisma/air/../telemetry)"),
    "SB11": ("Gateway utilitas (listrik, air, gas)", "utl-gw-001..004",
             "Modbus/MQTT -> API /utility"),
    "SB12": ("BISMA integration hub (broker + REST)", "bisma-hub-01",
             "MQTT broker + REST API /bisma"),
}

MOM_FILES = {
    4: "MoM_2026-10-09_Diskusi_Teknis.docx",
    5: "MoM_2026-10-16_Diskusi_Teknis.docx",
    6: "MoM_2026-10-23_Weekly_Meeting_ke-6.docx",
    7: "MoM_2026-10-30_Weekly_Meeting_ke-7.docx",
}

# ---------------------------------------------------------------- helpers ---

def iso(d) -> str:
    return d.strftime("%Y-%m-%d")


def serial(d) -> float:
    return float((d - dt.date(1899, 12, 30)).days)


def rag_weekly(variance: float | None) -> str:
    if variance is None:
        return ""
    if variance < -0.1:
        return "Red"
    if variance < -0.05:
        return "Amber"
    return "Green"


def planned_frac(start: dt.date, finish: dt.date, cutoff: dt.date) -> float:
    if cutoff < start:
        return 0.0
    dur = (finish - start).days + 1
    if dur <= 0:
        return 1.0
    return max(0.0, min(1.0, ((cutoff - start).days + 1) / dur))


def weighted_planned(rows, cutoff) -> float:
    return round(sum(r["weight"] * planned_frac(r["start"], r["finish"], cutoff) for r in rows), 6)


def solve_j(rows, cutoff, target, prev=None):
    """Distribute cumulative actual `target` over WBS rows (% Complete values).

    Greedy fill in natural completion order (earliest finish first): keeps the
    earned total EXACTLY at `target`, stays monotonic vs `prev`, and caps each
    row at its planned fraction (natural look). Returns per-row J, 4 dp.
    """
    fr = [planned_frac(r["start"], r["finish"], cutoff) for r in rows]
    w = [r["weight"] for r in rows]
    cur = list(prev) if prev is not None else [0.0] * len(rows)
    remaining = target - sum(wi * ci for wi, ci in zip(w, cur))
    if remaining > 1e-9:
        order = sorted(range(len(rows)), key=lambda i: (rows[i]["finish"], rows[i]["start"]))
        for i in order:  # first pass: up to each row's planned fraction
            avail = min(1.0, fr[i]) - cur[i]
            if avail <= 0:
                continue
            take = min(avail, remaining / w[i])
            cur[i] += take
            remaining -= w[i] * take
            if remaining <= 1e-9:
                break
        for i in order:  # overflow: planned exhausted, push rows to 100%
            if remaining <= 1e-9:
                break
            take = min(1.0 - cur[i], remaining / w[i])
            cur[i] += take
            remaining -= w[i] * take
    return [round(min(1.0, c), 4) for c in cur]


def next_milestone(rows, j_values, cutoff):
    for r, j in zip(rows, j_values):
        if j < 1 and r["finish"] >= cutoff:
            return f"{r['code']} {r['deliverable']} - {r['finish'].strftime('%d-%b-%Y')}"
    for r in rows:
        if r["finish"] >= cutoff:
            return f"{r['code']} {r['deliverable']} - {r['finish'].strftime('%d-%b-%Y')}"
    return "Handover"


def visible_risks(code, cutoff):
    return [r for r in RISKS[code] if r["raised"] <= cutoff]


def top_issue(code, cutoff_week):
    visible = visible_risks(code, WEEK_CUTOFF[cutoff_week])
    for prio in ("Critical", "High"):
        for r in visible:
            p = r["priority_by_week"].get(cutoff_week, r["priority"])
            if p == prio and r["status_by_week"][cutoff_week].startswith("Open"):
                return f"{r['id']}: {r['desc']}"
    for r in visible:
        if r["status_by_week"][cutoff_week].startswith("Open"):
            return f"{r['id']}: {r['desc']}"
    return "-"


# ------------------------------------------------------------ base reading --

def read_base(comp):
    """Read WBS rows + planned curve from the component's base workbook."""
    wb = load_workbook(PEMANTAU / comp.base_rel, data_only=False)
    gantt, weekly = wb["Workplan & Gantt"], wb["Weekly Report"]
    rows = []
    r = 5
    while gantt.cell(row=r, column=1).value is not None:
        start = gantt.cell(row=r, column=6).value
        finish = gantt.cell(row=r, column=7).value
        if not isinstance(start, dt.datetime):
            start = dt.datetime.fromisoformat(str(start).split(" ")[0])
        if not isinstance(finish, dt.datetime):
            finish = dt.datetime.fromisoformat(str(finish).split(" ")[0])
        rows.append({
            "row": r, "code": str(gantt.cell(row=r, column=1).value),
            "phase": gantt.cell(row=r, column=2).value,
            "activity": gantt.cell(row=r, column=3).value,
            "deliverable": gantt.cell(row=r, column=4).value,
            "pic": gantt.cell(row=r, column=5).value,
            "start": start.date(), "finish": finish.date(),
            "weight": float(gantt.cell(row=r, column=9).value or 0),
            "j": gantt.cell(row=r, column=10).value,
            "ev": gantt.cell(row=r, column=16).value,
        })
        r += 1
    planned = {wk: weekly.cell(row=wk + 3, column=3).value for wk in range(1, 15)}
    wb.close()
    return rows, planned


def component_rows_and_curve(comp):
    rows, planned_curve = read_base(comp)
    if comp.code in TEMPLATE_WBS:
        tw = TEMPLATE_WBS[comp.code]
        rows = [
            {"row": 5 + i, "code": r["code"], "phase": r["phase"], "activity": r["activity"],
             "deliverable": r["deliverable"], "pic": r["pic"] or comp.pic,
             "start": r["start"], "finish": r["finish"], "weight": r["weight"],
             "j": 0.0, "ev": r["ev"]}
            for i, r in enumerate(tw)
        ]
        planned_curve = {wk: weighted_planned(rows, WEEK_CUTOFF[wk]) for wk in range(1, 15)}
    return rows, planned_curve


def j_history_for(comp, rows, cutoff_week):
    """% Complete per WBS row per week (cumulative, monotonic). W5 for real
    components stays at the untouched source values."""
    history, prev = {}, None
    for wk in range(4, cutoff_week + 1):
        if comp.family == "real" and wk == 5:
            history[5] = [r["j"] if isinstance(r["j"], (int, float)) else 0.0 for r in rows]
            prev = history[5]
            continue
        history[wk] = solve_j(rows, WEEK_CUTOFF[wk], ACTUAL[comp.code][wk], prev)
        prev = history[wk]
    return history


def template_narrative(comp, wk, rows):
    cutoff = WEEK_CUTOFF[wk]
    active = None
    for r in rows:
        if r["start"] <= cutoff:
            active = r
    nxt = None
    if active is not None:
        idx = rows.index(active)
        nxt = rows[idx + 1] if idx + 1 < len(rows) else None
    g = f"Report completion/evidence: {active['activity']}" if active else ""
    h = f"Next: {nxt['activity']}" if nxt else "Close open items and prepare handover."
    ev = active["ev"] if active else ""
    return g, h, ev


# ------------------------------------------------------- workbook patches ---

def apply_readme(p, comp):
    p.set("Read Me", "A1", ("s", f"SUBCONTRACTOR WEEKLY PROGRESS REPORT - {TITLE_FIX[comp.code]}"))


def apply_project_info(p, comp):
    info = "Project Info"
    p.set(info, "B3", ("s", PROJECT))
    p.set(info, "B4", ("s", COMPANY_CANON[comp.code]))
    p.set(info, "B5", ("s", comp.name))
    p.set(info, "B7", ("s", comp.pic))
    p.set(info, "B10", ("s", BASELINE_APPROVED))
    p.set(info, "B11", ("s", "TS CA_ITB_12A2"))


def apply_workplan_sheet(p, comp, cutoff_week, rows, j_values):
    sheet = "Workplan & Gantt"
    p.set(sheet, "A1", ("s", f"DETAILED WORKPLAN & GANTT - {TITLE_FIX[comp.code]}"))
    cutoff = WEEK_CUTOFF[cutoff_week]
    if comp.code in TEMPLATE_WBS:
        for i, r in enumerate(TEMPLATE_WBS[comp.code]):
            row = 5 + i
            pic = r["pic"] or comp.pic
            p.set(sheet, f"A{row}", ("s", r["code"]))
            p.set(sheet, f"B{row}", ("s", r["phase"]))
            p.set(sheet, f"C{row}", ("s", r["activity"]))
            p.set(sheet, f"D{row}", ("s", r["deliverable"]))
            p.set(sheet, f"E{row}", ("s", pic))
            p.set(sheet, f"F{row}", ("s", iso(r["start"])))
            p.set(sheet, f"G{row}", ("s", iso(r["finish"])))
            p.set(sheet, f"H{row}", ("f", f"=G{row}-F{row}+1", (r["finish"] - r["start"]).days + 1))
            p.set(sheet, f"I{row}", ("n", r["weight"]))
            p.set(sheet, f"L{row}", ("s", iso(r["finish"])))
            p.set(sheet, f"N{row}", ("s", "Kickoff" if i == 0 else TEMPLATE_WBS[comp.code][i - 1]["code"]))
            p.set(sheet, f"O{row}", ("s", r["deliverable"]))
            p.set(sheet, f"P{row}", ("s", r["ev"]))
    for i, r in enumerate(rows):
        row = r["row"]
        j = j_values[i]
        p.set(sheet, f"J{row}", ("n", j))
        p.set(sheet, f"K{row}", ("f", f'=IF(J{row}="",0,I{row}*J{row})', round(r["weight"] * j, 6)))
        pf = planned_frac(r["start"], r["finish"], cutoff)
        if j >= 1:
            m = "Green"
        elif pf - j > 0.25:
            m = "Red"
        elif pf - j > 0.10:
            m = "Amber"
        else:
            m = "Green"
        delayed = pf - j > 0.05
        if comp.family == "real":
            formula = ('=IF(J{r}="","",IF(J{r}>=1,"Green",IF(OR(L{r}-G{r}>7,J{r}<MAX(0,MIN(1,'
                       '(\'PM Summary\'!$B$5-F{r}+1)/H{r}))-0.25),"Red",IF(OR(L{r}>G{r},J{r}<MAX(0,MIN(1,'
                       '(\'PM Summary\'!$B$5-F{r}+1)/H{r}))-0.1),"Amber","Green"))))').format(r=row)
            p.set(sheet, f"M{row}", ("f", formula, m))
            if delayed:
                p.set(sheet, f"L{row}", ("n", serial(r["finish"] + dt.timedelta(days=14))))
        else:
            p.set(sheet, f"M{row}", ("s", m))
            if delayed:
                p.set(sheet, f"L{row}", ("s", iso(r["finish"] + dt.timedelta(days=14))))


def apply_weekly_sheet(p, comp, cutoff_week, rows, planned_curve, j_by_week):
    sheet = "Weekly Report"
    p.set(sheet, "A1", ("s", f"WEEKLY PROGRESS REPORT - {TITLE_FIX[comp.code]}"))
    for wk in range(1, 15):
        row = wk + 3
        pcut = planned_curve.get(wk)
        if pcut is None:
            continue
        narr = NARRATIVE[comp.code].get(wk)
        if comp.family == "tmpl":
            p.set(sheet, f"C{row}", ("n", pcut))
            g, h, ev = template_narrative(comp, wk, rows)
            p.set(sheet, f"G{row}", ("s", g))
            p.set(sheet, f"H{row}", ("s", h))
            p.set(sheet, f"L{row}", ("s", comp.pic))
            p.set(sheet, f"M{row}", ("s", ev))
            if narr:
                g, h, blk, need, due, ev = narr
                p.set(sheet, f"G{row}", ("s", g))
                p.set(sheet, f"H{row}", ("s", h))
            if 4 <= wk <= cutoff_week:
                actual = j_by_week[wk]
                var = round(actual - pcut, 6)
                p.set(sheet, f"D{row}", ("n", actual))
                p.set(sheet, f"E{row}", ("f", f'=IF(D{row}="","",D{row}-C{row})', var))
                p.set(sheet, f"F{row}", ("f", f'=IF(D{row}="","",IF(E{row}<-0.1,"Red",IF(E{row}<-0.05,"Amber","Green")))', rag_weekly(var)))
            if narr and 4 <= wk <= cutoff_week:
                _, _, blk, need, due, ev = narr
                p.set(sheet, f"I{row}", ("s", blk))
                p.set(sheet, f"J{row}", ("s", need))
                p.set(sheet, f"K{row}", ("s", comp.pic))
                p.set(sheet, f"L{row}", ("s", due))
                p.set(sheet, f"M{row}", ("s", ev))
        else:
            if wk <= cutoff_week:
                if 4 <= wk <= cutoff_week:
                    actual = ACTUAL[comp.code][wk] if (comp.family == "real" and wk == 5) else j_by_week[wk]
                    var = round(actual - pcut, 6)
                    p.set(sheet, f"D{row}", ("n", actual))
                    p.set(sheet, f"E{row}", ("f", f'=IF(D{row}="","",D{row}-C{row})', var))
                    p.set(sheet, f"F{row}", ("f", f'=IF(D{row}="","",IF(E{row}<-0.1,"Red",IF(E{row}<-0.05,"Amber","Green")))', rag_weekly(var)))
                if narr:
                    g, h, blk, need, due, ev = narr
                    p.set(sheet, f"G{row}", ("s", g))
                    p.set(sheet, f"H{row}", ("s", h))
                    p.set(sheet, f"I{row}", ("s", blk))
                    p.set(sheet, f"J{row}", ("s", need))
                    p.set(sheet, f"K{row}", ("s", comp.pic))
                    p.set(sheet, f"L{row}", ("s", due))
                    p.set(sheet, f"M{row}", ("s", ev))
                # weeks without narrative (e.g. W5) keep the source evidence
            elif ACTUAL[comp.code].get(wk) is not None:
                # clear future actuals/narrative (the W5 row inside the W4 file)
                p.set(sheet, f"D{row}", ("c",))
                for col in "GHIJKLM":
                    p.set(sheet, f"{col}{row}", ("c",))
    if comp.family == "tmpl":
        # trim the template grid beyond the project window (W15/W16 -> 1-Jan-2027)
        for row in (18, 19):
            for col in "ABCDEFGHIJKLMN":
                p.set(sheet, f"{col}{row}", ("c",))


def apply_pm_summary(p, comp, cutoff_week, cutoff, overall, rag, rows, j_values):
    pm = "PM Summary"
    p.set(pm, "B3", ("s", COMPANY_CANON[comp.code]))
    p.set(pm, "B4", ("s", comp.name))
    p.set(pm, "B5", ("s", iso(cutoff)))
    p.set(pm, "B6", ("f", "=SUM('Workplan & Gantt'!K5:K%d)" % (4 + len(rows)), overall))
    p.set(pm, "B7", ("f", f"='Weekly Report'!F{cutoff_week + 3}", rag))
    p.set(pm, "B8", ("s", next_milestone(rows, j_values, cutoff)))
    p.set(pm, "B9", ("s", top_issue(comp.code, cutoff_week)))


def apply_risks(p, comp, cutoff_week):
    sheet = "Issue Risk & Change"
    header = ["ID", "Type", "Date Raised", "Description", "Impact", "Probability",
              "Priority", "Owner", "Target Date", "Mitigation / Corrective Action",
              "Status", "Change Impact to Schedule"]
    for col_idx, h in enumerate(header):
        p.set(sheet, f"{chr(65 + col_idx)}3", ("s", h))
    p.set(sheet, "M3", ("c",))
    cutoff = WEEK_CUTOFF[cutoff_week]
    visible = visible_risks(comp.code, cutoff)
    for i, risk in enumerate(visible):
        row = 4 + i
        p.set(sheet, f"A{row}", ("s", risk["id"]))
        p.set(sheet, f"B{row}", ("s", risk["type"]))
        p.set(sheet, f"C{row}", ("s", iso(risk["raised"])))
        p.set(sheet, f"D{row}", ("s", risk["desc"]))
        p.set(sheet, f"E{row}", ("s", risk["impact"]))
        p.set(sheet, f"F{row}", ("s", risk["prob"]))
        p.set(sheet, f"G{row}", ("s", risk["priority_by_week"].get(cutoff_week, risk["priority"])))
        p.set(sheet, f"H{row}", ("s", risk["owner"]))
        p.set(sheet, f"I{row}", ("s", iso(risk["target"])))
        p.set(sheet, f"J{row}", ("s", risk["mitigation"]))
        p.set(sheet, f"K{row}", ("s", risk["status_by_week"][cutoff_week]))
        if risk["change_impact"]:
            p.set(sheet, f"L{row}", ("s", risk["change_impact"]))
    for row in range(4 + len(visible), 16):
        for col in "ABCDEFGHIJKL":
            p.set(sheet, f"{col}{row}", ("c",))


def apply_integration(p, comp):
    if comp.code not in INTEGRATION_DEVICE:
        return
    name, dev_id, protocol = INTEGRATION_DEVICE[comp.code]
    sheet = "Integration Readiness"
    p.set(sheet, "A4", ("s", name))
    p.set(sheet, "B4", ("s", dev_id))
    p.set(sheet, "F4", ("s", protocol))


def apply_audit(p, comp, cutoff, is_template):
    sheet = "Data Quality Audit"
    p.set(sheet, "A1", ("s", f"DATA QUALITY AUDIT - {comp.name}"))
    p.set(sheet, "A2", ("s", "Dibangkitkan"))
    p.set(sheet, "B2", ("s", cutoff.strftime("%d-%b-%Y 10:15")))
    if is_template:
        p.set(sheet, "A4", ("s", "Pemeriksaan"))
        p.set(sheet, "B4", ("s", "Hasil"))
        p.set(sheet, "C4", ("s", "Status"))
        p.set(sheet, "D4", ("c",))
        for row in range(10, 13):
            for col in "ABCD":
                p.set(sheet, f"{col}{row}", ("c",))
    checks = [
        ("Total bobot WBS", "1.00", "OK"),
        ("Tanggal baseline", "Urut", "OK"),
        ("Dependensi", "Semua merujuk WBS yang ada", "OK"),
        ("% Complete aktivitas yang sudah mulai", "Terisi", "OK"),
        ("Baseline", "Disetujui 18-Sep-2026 (MoM kick-off); revisi melalui persetujuan PMO", "OK"),
    ]
    for i, (a, b, c) in enumerate(checks):
        row = 5 + i
        p.set(sheet, f"A{row}", ("s", a))
        p.set(sheet, f"B{row}", ("s", b))
        p.set(sheet, f"C{row}", ("s", c))


# --------------------------------------------------------- report building --

def build_report(comp, session_dir: Path, cutoff, cutoff_week, payload):
    src = PEMANTAU / comp.base_rel
    rows, planned_curve = component_rows_and_curve(comp)
    history = j_history_for(comp, rows, cutoff_week)
    j_values = history[cutoff_week]
    j_by_week = {wk: round(sum(r["weight"] * j for r, j in zip(rows, js)), 4)
                 for wk, js in history.items()}

    p = Patcher(str(src))
    apply_readme(p, comp)
    apply_project_info(p, comp)
    apply_workplan_sheet(p, comp, cutoff_week, rows, j_values)
    apply_weekly_sheet(p, comp, cutoff_week, rows, planned_curve, j_by_week)
    # W5 of a real component keeps the untouched source actual; other weeks the
    # reported actual is exactly the weighted WBS progress we wrote.
    actual = ACTUAL[comp.code][cutoff_week] if (comp.family == "real" and cutoff_week == 5) else j_by_week[cutoff_week]
    overall = round(sum(r["weight"] * j for r, j in zip(rows, j_values)), 4)
    var = round(actual - planned_curve.get(cutoff_week, 0), 4)
    apply_pm_summary(p, comp, cutoff_week, cutoff, overall, rag_weekly(var), rows, j_values)
    apply_risks(p, comp, cutoff_week)
    apply_integration(p, comp)
    apply_audit(p, comp, cutoff, comp.family == "tmpl")
    p.save(str(session_dir / comp.out_name))

    prev_cutoff = WEEK_CUTOFF[cutoff_week - 1] if cutoff_week > 1 else dt.date(2026, 1, 1)
    payload["components"][comp.code] = {
        "name": comp.name,
        "report_file": comp.out_name,
        "planned_percent": round(planned_curve.get(cutoff_week, 0), 4),
        "actual_percent": actual,
        "variance_percent": var,
        "rag": rag_weekly(var),
        "overall_weighted_progress": overall,
        "wbs_percent_complete": j_values,
        "open_risks": [r["id"] for r in visible_risks(comp.code, cutoff) if r["status_by_week"][cutoff_week].startswith("Open")],
        "new_risks": [r["id"] for r in RISKS[comp.code] if prev_cutoff < r["raised"] <= cutoff],
        "closed_risks": [r["id"] for r in visible_risks(comp.code, cutoff) if not r["status_by_week"][cutoff_week].startswith("Open")],
        "priority_changed_risks": [
            r["id"] for r in RISKS[comp.code]
            if cutoff_week in r["priority_by_week"] and cutoff_week > min(r["priority_by_week"])
            and r["priority_by_week"][cutoff_week] != r["priority"]
        ],
        "next_milestone": next_milestone(rows, j_values, cutoff),
    }


# ------------------------------------------------------------ baseline doc --

def build_baseline(out_dir: Path):
    src = Path(SOURCE_ROOT) / "KEGIATAN SMART BUILDING.xlsx"
    p = Patcher(str(src))
    p.set("Read Me", "B7", ("s",
        "PIC mengikuti MoM 18-Sep-2026 dan konfirmasi mingguan berikut: Pengkondisian Udara -> Amar "
        "(Indismart), dikonfirmasi pada MoM 16-Okt-2026; Ventilasi -> Tezar (Urbansolv) sesuai Master Gantt."))
    p.set("Read Me", "A11", ("s", "Baseline disetujui"))
    p.set("Read Me", "B11", ("s", "18 September 2026 (kick-off). Revisi baseline hanya melalui persetujuan "
                                   "PMO/PPK; laporan atau forecast baru tidak menggantikan baseline."))
    # Pengkondisian Udara -> Indismart / Amar (Master Gantt rows 40-46, Task Register 39-45)
    for sheet, rng in (("Master Gantt", range(40, 47)), ("Task Register", range(39, 46))):
        for r in rng:
            p.set(sheet, f"C{r}", ("s", "Indismart"))
            p.set(sheet, f"D{r}", ("s", "Amar (Indismart)"))
    # Ventilasi -> Urbansolv / Tezar (Master Gantt rows 68-74, Task Register 67-73)
    for sheet, rng in (("Master Gantt", range(68, 75)), ("Task Register", range(67, 74))):
        for r in rng:
            p.set(sheet, f"C{r}", ("s", "Urbansolv"))
            p.set(sheet, f"D{r}", ("s", "Tezar (Urbansolv)"))
    for r in range(39, 46):
        p.set("Task Register", f"K{r}", ("s", "PIC dikonfirmasi: Amar (Indismart) per MoM 16-Okt-2026; "
                                               "klarifikasi lingkup software AC (action item 1009-2)."))
    for r in range(67, 74):
        p.set("Task Register", f"K{r}", ("s", "PIC dikonfirmasi: Tezar (Urbansolv); handover data Indihealth "
                                               "dilengkapi pada MoM 23-Okt-2026."))
    # PIC Summary: Amar now covers 3 components; drop the TBD row; canonical companies
    p.set("PIC Summary", "C4", ("n", 3))
    p.set("PIC Summary", "D4", ("s", "Alarm & Kebencanaan; Kamera Pengawasan; Pengkondisian Udara"))
    p.set("PIC Summary", "F4", ("s", "Alarm, kamera, dan pengkondisian udara: assessment, hardware readiness, "
                                      "deployment dan integrasi ke BISMA."))
    for col in "ABCDEF":
        p.set("PIC Summary", f"{col}10", ("c",))
    for row, company in {12: "Indismart", 13: "Indismart", 14: "LCI", 15: "Elisa/LCI", 16: "Indismart",
                         17: "LCI", 18: "Urbansolv", 19: "Urbansolv", 20: "Urbansolv", 21: "Urbansolv",
                         22: "Kazee", 23: "Kazee"}.items():
        p.set("PIC Summary", f"C{row}", ("s", company))
    p.set("PIC Summary", "D18", ("s", "Pencahayaan"))
    p.save(str(out_dir / "KEGIATAN SMART BUILDING.xlsx"))


# ---------------------------------------------------------- cost documents --

def parse_rp(value) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip().replace("Rp", "").replace(" ", "")
    if s == "11,500,00":  # known typo: one digit short of 11,500,000
        return 11_500_000.0
    if "," in s and "." in s:
        s = s.replace(",", "")          # 451,200.00 style
    elif s.count(",") and "." not in s:
        s = s.replace(",", "")          # 8,000,000 style
    else:
        s = s.replace(".", "").replace(",", ".")
    return float(s)


def build_cost_docs(out_dir: Path):
    spec_src = Path(SOURCE_ROOT) / "Spesifikasi Teknis Smart Building Pemetaan Kegiatan dan Prioritas Pembelian Barang.xlsx"
    calc_src = Path(SOURCE_ROOT) / "Perhitungan dari Spesifikasi Teknis Smart Building Pemetaan Kegiatan dan Prioritas Pembelian Barang.xlsx"
    req_src = Path(SOURCE_ROOT) / "Pengajuan Pembelian Hardware 2 Oktober 2026_bahasan meeting 16oct.xlsx"

    # --- Spesifikasi Teknis: canonical hardware baseline --------------------
    wb = load_workbook(spec_src, data_only=False)
    mh = wb["Master Hardware"]
    p = Patcher(str(spec_src))
    total = 0.0
    for row in range(2, 33):
        if mh[f"A{row}"].value is None:
            continue
        price = parse_rp(mh[f"K{row}"].value)
        line = round(float(mh[f"H{row}"].value) * price, 2)
        total += line
        p.set("Master Hardware", f"K{row}", ("n", price))
        p.set("Master Hardware", f"L{row}", ("n", line))
    total = round(total, 2)
    p.set("Master Hardware", "A33", ("s", "TOTAL"))
    p.set("Master Hardware", "L33", ("n", total))
    for row, company in {2: "Indismart/LCI", 3: "Indismart/LCI", 4: "LCI", 5: "Elisa/LCI",
                         6: "Indismart/LCI", 7: "LCI"}.items():
        p.set("Master Komponen", f"C{row}", ("s", company))
    p.save(str(spec_out_path := out_dir / spec_src.name))

    # --- Pengajuan (committed-cost request discussed in MoM 16-Okt) ---------
    wb = load_workbook(req_src, data_only=False)
    mh = wb["Master Hardware"]
    p = Patcher(str(req_src))
    req_total = 0.0
    for row in range(2, 33):
        if mh[f"A{row}"].value is None:
            continue
        price = parse_rp(mh[f"K{row}"].value)
        line = round(float(mh[f"H{row}"].value) * price, 2)
        req_total += line
        p.set("Master Hardware", f"K{row}", ("n", price))
        p.set("Master Hardware", f"L{row}", ("n", line))
    req_total = round(req_total, 2)
    p.set("Master Hardware", "J2", ("s", "Indonesia"))  # align country of origin
    p.set("Master Hardware", "L33", ("f", "=SUM(L2:L32)", req_total))
    p.save(str(out_dir / req_src.name))

    # --- Perhitungan: distribution estimate on the canonical hardware total -
    p = Patcher(str(calc_src))
    kontrak = float(CONTRACT_VALUE)
    potongan = round(kontrak * 0.30, 2)
    pengeluaran = round(potongan + 700_000_000 + 200_000_000 + total, 2)
    p.set("Estimasi Rincian Pembagian", "E9", ("n", total))
    p.set("Estimasi Rincian Pembagian", "E6", ("f", "=D5*30%", potongan))
    p.set("Estimasi Rincian Pembagian", "F6", ("f", "=D5-E6", round(kontrak - potongan, 2)))
    p.set("Estimasi Rincian Pembagian", "E10", ("f", "=SUM(E5:E9)", pengeluaran))
    p.set("Estimasi Rincian Pembagian", "F10", ("f", "=D10-E10", round(kontrak - pengeluaran, 2)))
    p.save(str(out_dir / calc_src.name))
    return {"hardware_baseline_total": total, "purchase_request_total": req_total}


# ---------------------------------------------------------------- minutes ---

def build_minutes(out_root: Path, session_dirs: dict):
    src = Path(SOURCE_ROOT) / "All Minutes of Meeting Smart Building.docx"
    mom_dir = out_root / "mom"
    mom_dir.mkdir(parents=True, exist_ok=True)

    blocks = docx_tools.meeting_blocks(str(src))
    assert len(blocks) == 5, f"expected 5 meetings, found {len(blocks)}"

    zoom_refs = {
        0: ["Rekaman Zoom: 2026-09-18 10.03.08 Pemetaan Kegiatan dan Timeline Smart Building",
            "Chat rapat: folder Zoom 2026-09-18 (chat.txt)"],
        1: ["Rekaman Zoom: 2026-09-25 10.14.39 Rapat Koordinasi Proposal dan RAB Smart Building DKST",
            "Chat rapat: folder Zoom 2026-09-25 (chat.txt)"],
        2: ["Rekaman Zoom: 2026-09-30 10.02.46 Diskusi Teknis Smart Building",
            "Chat rapat: folder Zoom 2026-09-30 (chat.txt)"],
        3: ["Rekaman Zoom: 2026-10-09 10.16.24 Weekly Meeting Smart Building DKHT"],
        4: ["Rekaman Zoom: 2026-10-16 10.03.51 Weekly Meeting Smart Building DKST",
            "Arsip dokumen: https://drive.google.com/drive/folders/1E6E9TIj0vfZZsfzXn4eDFiyy7iaWLvoH?usp=drive_link"],
    }
    names = [
        "MoM_2026-09-18_Pemetaan_Kegiatan_dan_Timeline.docx",
        "MoM_2026-09-25_Koordinasi_Teknis_dan_Pengadaan.docx",
        "MoM_2026-09-30_Diskusi_Teknis.docx",
        "MoM_2026-10-09_Diskusi_Teknis.docx",
        "MoM_2026-10-16_Diskusi_Teknis.docx",
    ]
    split_paths = []
    for i, (title, indices) in enumerate(blocks):
        final = mom_dir / names[i]
        docx_tools.split_meeting(str(src), indices, str(final))
        fixes = [("tanggal 2 September 2026", "tanggal 2 Oktober 2026")] if i == 2 else []
        docx_tools.postprocess(str(final), fixes, zoom_refs[i])
        split_paths.append(final)

    shutil.copy2(split_paths[3], session_dirs["2026-10-09_w4"] / names[3])
    shutil.copy2(split_paths[4], session_dirs["2026-10-16_w5"] / names[4])

    for session, fname, model in (
        ("2026-10-23_w6", "MoM_2026-10-23_Weekly_Meeting_ke-6.docx", MOM_W6),
        ("2026-10-30_w7", "MoM_2026-10-30_Weekly_Meeting_ke-7.docx", MOM_W7),
    ):
        sections = [
            ("Tujuan Pertemuan", model["tujuan"]),
            ("Pembahasan dan Progres Pekerjaan", model["pembahasan"]),
            ("Action Items", model["action_items"]),
            ("Isu yang Memerlukan Perhatian", model["isu"]),
            ("Kesimpulan", model["kesimpulan"]),
        ]
        info = dict(model["info"])
        dokumentasi = ["Rekaman Zoom sesi mingguan Smart Building (folder sesi fixture)"]
        docx_tools.new_mom_from(str(split_paths[4]), str(session_dirs[session] / fname),
                                model["title"], info, sections, dokumentasi)


# --------------------------------------------------------------- assembly --

def main():
    for sub in ("00_baseline", "mom", "sessions"):
        shutil.rmtree(PACK / sub, ignore_errors=True)
    (PACK / "00_baseline").mkdir(parents=True, exist_ok=True)
    session_dirs = {}
    for session_name, cutoff, week in SESSIONS:
        d = PACK / "sessions" / session_name
        d.mkdir(parents=True)
        session_dirs[session_name] = d

    print("1/4 baseline workbook ...")
    build_baseline(PACK / "00_baseline")

    print("2/4 cost documents ...")
    cost_info = build_cost_docs(PACK / "00_baseline")

    print("3/4 minutes of meeting ...")
    build_minutes(PACK, session_dirs)

    print("4/4 weekly report pack (12 components x 4 sessions) ...")
    sessions_payload = []
    for session_name, cutoff, week in SESSIONS:
        payload = {"components": {}}
        for comp in COMPONENTS:
            build_report(comp, session_dirs[session_name], cutoff, week, payload)
        sessions_payload.append((session_name, cutoff, week, payload))
        print(f"    {session_name}: {len(payload['components'])} reports")

    expected = {
        "pack": "smart-building-itb",
        "project": PROJECT,
        "currency": "IDR",
        "baseline": {
            "approved_date": BASELINE_APPROVED,
            "contract_value": CONTRACT_VALUE,
            "hardware_baseline_total": cost_info["hardware_baseline_total"],
            "purchase_request_total": cost_info["purchase_request_total"],
            "purchase_request_note": "Pengajuan 2-Okt tidak memuat SB11-01; SB11-01 masuk pengadaan gelombang 2 (MoM 30-Okt). SB12-05 Workstation hanya ada di Pengajuan 16-Okt.",
            "milestones": [
                {"id": "M3", "name": "Minimum 60% progress", "date": "2026-10-31"},
                {"id": "M4", "name": "Minimum 80% progress", "date": "2026-11-30"},
                {"id": "M5", "name": "Technical readiness 100%", "date": "2026-12-04"},
                {"id": "M6", "name": "Final BA / handover documentation", "date": "2026-12-18"},
                {"id": "M7", "name": "Administrative closeout", "date": "2026-12-31"},
            ],
            "note": "Baseline 18-Sep-2026 tetap berlaku untuk semua sesi; laporan mingguan tidak menggantikan baseline.",
        },
        "report_filenames": [c.out_name for c in COMPONENTS],
        "reupload_flow": "file dengan nama sama di-upload ulang di setiap sesi; periode dibedakan oleh Cut-off Date pada sheet Weekly Report dan Reporting Cut-off pada PM Summary",
        "rag_rules": "variance <= -10% Red; -10% < variance <= -5% Amber; else Green (mengikuti rumus Weekly Report)",
        "sessions": [],
    }
    for session_name, cutoff, week, payload in sessions_payload:
        comps = payload["components"]
        expected["sessions"].append({
            "session": session_name,
            "cut_off": iso(cutoff),
            "week": week,
            "mom_file": MOM_FILES[week],
            "components": comps,
            "project_rollup": {
                "note": "rata-rata sama-bobot 12 komponen; sistem tidak boleh menghitung skor gabungan tanpa menandai sumber",
                "average_actual_percent": round(sum(ACTUAL[c][week] for c in ACTUAL) / len(ACTUAL), 4),
                "on_track": sorted(c for c, e in comps.items() if e["rag"] == "Green"),
                "needs_attention": sorted(c for c, e in comps.items() if e["rag"] == "Amber"),
                "critical": sorted(c for c, e in comps.items() if e["rag"] == "Red"),
            },
            "risk_summary": {
                "open_total": sum(len(e["open_risks"]) for e in comps.values()),
                "new_this_week": sorted(i for e in comps.values() for i in e["new_risks"]),
                "closed_this_week": sorted(i for e in comps.values() for i in e["closed_risks"]),
                "priority_changed_this_week": sorted(i for e in comps.values() for i in e["priority_changed_risks"]),
            },
        })
    with open(PACK / "expected-results.json", "w", encoding="utf-8") as f:
        json.dump(expected, f, ensure_ascii=False, indent=2)
    print("done:", PACK)


if __name__ == "__main__":
    main()
