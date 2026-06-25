from __future__ import annotations

from datetime import datetime
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches, Pt
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill, Side, Border
from openpyxl.utils import get_column_letter


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "demo-evidence-fixtures" / "realistic-pmo-cases"


CASES = [
    {
        "folder": "case_01_green_riverside_data_hub",
        "project": "Riverside Data Hub",
        "sector": "Digital services and data platform",
        "sponsor": "Customer Operations Directorate",
        "manager": "Maya Prasetyo",
        "period": "March 2026",
        "baseline_budget": 500000,
        "forecast_budget": 487000,
        "planned_progress": 60,
        "actual_progress": 62,
        "narrative": (
            "Delivery remains controlled. The team completed the API integration milestone "
            "ahead of the March checkpoint, expenditure remains below the approved baseline, "
            "and the evidence pack is current for requirements, design review, and test planning."
        ),
        "baseline_milestones": [
            ("Requirements baseline approved", "2026-01-20", "Baseline", "Scope signed off by product and operations"),
            ("Data ingestion foundation complete", "2026-02-28", "Baseline", "Core ingestion service and schema controls"),
            ("API integration checkpoint", "2026-03-15", "Baseline", "External service integration and load test"),
            ("Operational readiness review", "2026-04-18", "Baseline", "Runbook and support readiness approval"),
        ],
        "progress_milestones": [
            ("Requirements baseline approved", "2026-01-20", "Completed", "Approved on 2026-01-18 with no open scope caveats"),
            ("Data ingestion foundation complete", "2026-02-28", "Completed", "Completed on 2026-02-27"),
            ("API integration checkpoint", "2026-03-15", "Completed", "Completed on 2026-03-13 after successful load test"),
            ("Operational readiness review", "2026-04-18", "On Track", "Draft runbook accepted by service owner"),
        ],
        "attention_points": [
            "Maintain weekly evidence updates through the readiness review.",
            "Keep contingency usage under review as the team enters operational testing.",
            "Confirm support handover attendance before the April readiness meeting.",
        ],
        "cost_rows": [
            ("Requirements and design", 90000, 85000, 88000, "Normal", "Design effort closed below estimate"),
            ("Data ingestion build", 145000, 136000, 141000, "Normal", "No material variance"),
            ("API integration", 120000, 105000, 118000, "Normal", "Vendor API testing completed"),
            ("Operational readiness", 95000, 42000, 91000, "Monitor", "Training sessions remain scheduled"),
            ("Contingency", 50000, 0, 49000, "Normal", "Contingency largely preserved"),
        ],
        "risk_rows": [
            ("R-101", "Operational support attendance slips", "Low", "Medium", "Low", "Confirm named attendees two weeks before readiness review", "Service Owner", "Open"),
            ("R-102", "Minor data mapping clarification remains", "Low", "Low", "Low", "Resolve in weekly data working group", "Data Lead", "Open"),
            ("R-103", "Vendor API availability risk retired", "Low", "Low", "Low", "Load test passed and risk can be closed after March report", "Integration Lead", "Closed"),
        ],
        "issue_rows": [
            ("I-101", "Support rota confirmation pending", "Service Owner", "2026-04-02", "Open", "Low", "No delivery impact expected"),
            ("I-102", "One optional report field requires wording decision", "Product Owner", "2026-03-28", "Open", "Low", "Decision can be made in working session"),
        ],
    },
    {
        "folder": "case_02_amber_alpha_infrastructure",
        "project": "Alpha Infrastructure Program",
        "sector": "Infrastructure modernization",
        "sponsor": "Capital Delivery Board",
        "manager": "Sarah Khan",
        "period": "May 2026",
        "baseline_budget": 4300000,
        "forecast_budget": 4550000,
        "planned_progress": 54,
        "actual_progress": 43,
        "narrative": (
            "The program needs management attention. Installation progress is below the baseline, "
            "the forecast is above the approved budget, and metering approval evidence is incomplete. "
            "The delivery team has a recovery proposal, but the plan has not yet been fully evidenced."
        ),
        "baseline_milestones": [
            ("Energy audit baseline approved", "2026-02-20", "Baseline", "Baseline reference for plan-vs-actual comparison"),
            ("Smart meter procurement award", "2026-04-30", "Baseline", "Procurement award required before installation mobilization"),
            ("Building A installation complete", "2026-05-25", "Baseline", "Controls pilot depends on this milestone"),
            ("Campus dashboard pilot", "2026-07-10", "Baseline", "Pilot needs clean metering data and approval evidence"),
        ],
        "progress_milestones": [
            ("Energy audit baseline approved", "2026-02-20", "Completed", "Completed on 2026-02-18"),
            ("Smart meter procurement award", "2026-04-30", "Completed Late", "Award completed on 2026-05-03"),
            ("Building A installation complete", "2026-05-25", "At Risk", "Forecast completion on 2026-06-08"),
            ("Campus dashboard pilot", "2026-07-10", "At Risk", "Dependent on metering data and Building A recovery"),
        ],
        "attention_points": [
            "Validate whether the revised installation sequence protects the July dashboard pilot.",
            "Review forecast cost variance against the approved baseline and agree mitigation.",
            "Close the missing metering approval evidence before the next assurance checkpoint.",
        ],
        "cost_rows": [
            ("Energy audit and design", 520000, 510000, 540000, "Monitor", "Minor consulting extension"),
            ("Smart meter procurement", 1850000, 1320000, 1910000, "At Risk", "Supplier price adjustment"),
            ("Installation works", 1400000, 610000, 1540000, "At Risk", "Night shift work may increase labor cost"),
            ("Dashboard integration", 380000, 90000, 390000, "Normal", "No major variance"),
            ("Contingency", 150000, 0, 170000, "At Risk", "Contingency may be exceeded"),
        ],
        "risk_rows": [
            ("R-201", "Building A installation delay affects dashboard pilot", "High", "Medium", "High", "Add weekend installation shift and daily constraint review", "Installation Lead", "Open"),
            ("R-202", "Metering approval evidence incomplete", "Medium", "High", "High", "Collect approval records and update evidence register", "Document Control", "Open"),
            ("R-203", "Supplier price adjustment increases forecast cost", "Medium", "Medium", "Medium", "Validate quotation and negotiate fixed price addendum", "Procurement Lead", "Open"),
        ],
        "issue_rows": [
            ("I-201", "Building A installation behind plan", "Installation Lead", "2026-05-25", "Open", "High", "Forecast completion shifted into June"),
            ("I-202", "Metering approval record missing from evidence register", "Document Control", "2026-05-14", "Overdue", "High", "Approval email not attached"),
            ("I-203", "Supplier revised quotation not validated", "Procurement Lead", "2026-05-18", "Overdue", "Medium", "Commercial review pending"),
        ],
    },
    {
        "folder": "case_03_red_orion_erp_recovery",
        "project": "Orion ERP Recovery",
        "sector": "Enterprise systems transformation",
        "sponsor": "Finance Transformation Steering Committee",
        "manager": "Leon Hartono",
        "period": "June 2026",
        "baseline_budget": 900000,
        "forecast_budget": 1062000,
        "planned_progress": 59,
        "actual_progress": 31,
        "narrative": (
            "The recovery workstream is no longer tracking to the approved baseline. The cutover path "
            "is blocked by unresolved customer master reconciliation failures, the cost forecast has "
            "moved materially above the approved budget, and key governance evidence is missing."
        ),
        "baseline_milestones": [
            ("Recovery baseline approved", "2026-03-15", "Baseline", "Steering committee checkpoint"),
            ("Customer master migration verified", "2026-05-20", "Baseline", "Required before cutover rehearsal"),
            ("Cutover rehearsal complete", "2026-06-10", "Baseline", "Required evidence for go/no-go"),
            ("Release 2 go-live", "2026-07-01", "Baseline", "Depends on clean migration and sign-off"),
        ],
        "progress_milestones": [
            ("Recovery baseline approved", "2026-03-15", "Partially Approved", "Decision record lacks signed recovery owner"),
            ("Customer master migration verified", "2026-05-20", "Blocked", "Reconciliation failure remains unresolved"),
            ("Cutover rehearsal complete", "2026-06-10", "Missed", "Rehearsal could not proceed without migration evidence"),
            ("Release 2 go-live", "2026-07-01", "Not Credible", "Current path requires re-baseline"),
        ],
        "attention_points": [
            "Appoint a single accountable recovery owner and publish an approved recovery baseline.",
            "Escalate the migration defect to the steering committee with decision options.",
            "Freeze non-critical scope until reconciliation evidence and cutover readiness are restored.",
        ],
        "cost_rows": [
            ("Recovery PMO and controls", 130000, 112000, 156000, "Over Baseline", "Extended governance cycle"),
            ("Data migration remediation", 280000, 265000, 378000, "Over Baseline", "Repeated reconciliation failures"),
            ("Vendor defect triage", 210000, 196000, 278000, "Over Baseline", "Additional vendor sprint requested"),
            ("Cutover rehearsal", 180000, 68000, 205000, "At Risk", "Rehearsal delayed and may need repeat cycle"),
            ("Contingency", 100000, 96000, 45000, "Depleted", "Contingency mostly consumed"),
        ],
        "risk_rows": [
            ("R-301", "Customer master migration reconciliation failure blocks cutover", "High", "High", "Critical", "Dedicated recovery squad and executive decision on data tolerance", "", "Open"),
            ("R-302", "No approved recovery baseline after missed rehearsal", "High", "High", "Critical", "Steering committee to approve re-baseline and owner", "Program Director", "Open"),
            ("R-303", "Cost forecast exceeds approved funding envelope", "Medium", "High", "High", "Finance to approve or reject revised forecast", "Finance Controller", "Open"),
        ],
        "issue_rows": [
            ("I-301", "Customer master reconciliation fails tolerance threshold", "", "2026-06-05", "Overdue", "Critical", "No accepted workaround"),
            ("I-302", "Cutover readiness evidence unavailable", "PMO Controls", "2026-06-10", "Overdue", "High", "Go/no-go pack incomplete"),
            ("I-303", "Recovery owner not confirmed in decision record", "", "2026-06-12", "Open", "High", "Accountability gap remains"),
        ],
    },
]


def apply_doc_styles(doc: Document) -> None:
    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name = "Arial"
    normal.font.size = Pt(10)
    for name, size, color in [
        ("Heading 1", 16, "1F4E79"),
        ("Heading 2", 12, "1F4E79"),
    ]:
        style = styles[name]
        style.font.name = "Arial"
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = __import__("docx").shared.RGBColor.from_string(color)


def add_title(doc: Document, title: str, subtitle: str) -> None:
    paragraph = doc.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.LEFT
    run = paragraph.add_run(title)
    run.bold = True
    run.font.name = "Arial"
    run.font.size = Pt(22)
    run.font.color.rgb = __import__("docx").shared.RGBColor(31, 78, 121)
    sub = doc.add_paragraph(subtitle)
    sub.runs[0].font.size = Pt(11)
    sub.runs[0].font.color.rgb = __import__("docx").shared.RGBColor(89, 89, 89)


def add_table(doc: Document, headers: list[str], rows: list[tuple], widths: list[float] | None = None) -> None:
    table = doc.add_table(rows=1, cols=len(headers))
    table.style = "Table Grid"
    hdr = table.rows[0].cells
    for i, header in enumerate(headers):
        hdr[i].text = str(header)
        for paragraph in hdr[i].paragraphs:
            for run in paragraph.runs:
                run.bold = True
        hdr[i]._tc.get_or_add_tcPr().append(shading("D9EAF7"))
    for row in rows:
        cells = table.add_row().cells
        for i, value in enumerate(row):
            cells[i].text = "" if value is None else str(value)
    if widths:
        for row in table.rows:
            for i, width in enumerate(widths):
                row.cells[i].width = Inches(width)
    doc.add_paragraph()


def shading(fill: str):
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    element = OxmlElement("w:shd")
    element.set(qn("w:fill"), fill)
    return element


def build_baseline(case: dict, folder: Path) -> None:
    doc = Document()
    apply_doc_styles(doc)
    add_title(doc, "Project Baseline", case["project"])
    doc.add_paragraph(
        "This baseline defines the approved delivery reference used by the PMO to compare current "
        "performance against expected schedule, cost, governance, and assurance evidence."
    )
    doc.add_heading("Project Control Profile", level=1)
    add_table(
        doc,
        ["Field", "Value"],
        [
            ("Project Name", case["project"]),
            ("Sector", case["sector"]),
            ("Sponsor", case["sponsor"]),
            ("Project Manager", case["manager"]),
            ("Baseline Budget USD", f"{case['baseline_budget']:,}"),
            ("Assurance Cadence", "Monthly PMO checkpoint with evidence-backed executive summary"),
        ],
        [2.0, 4.8],
    )
    doc.add_heading("Baseline Milestones", level=1)
    add_table(doc, ["Milestone", "Baseline Date", "Status", "Planning Note"], case["baseline_milestones"], [2.4, 1.2, 1.1, 2.4])
    doc.add_heading("Governance and Assurance Requirements", level=1)
    for item in [
        "Monthly executive summary must compare planned progress, actual progress, cost forecast, active risk exposure, and evidence readiness.",
        "Schedule variance above 10 days or a missed dependency milestone requires a named recovery owner.",
        "Forecast cost above approved baseline requires finance review and mitigation options.",
        "High risks, overdue high-severity issues, and missing decision evidence must be escalated to the sponsor or steering committee.",
        "Every management finding should be traceable to a source document, register, or approved record.",
    ]:
        doc.add_paragraph(item, style="List Bullet")
    doc.core_properties.title = f"{case['project']} Project Baseline"
    doc.core_properties.subject = "PMO project baseline evidence"
    doc.save(folder / "01_project_baseline.docx")


def build_progress(case: dict, folder: Path) -> None:
    doc = Document()
    apply_doc_styles(doc)
    add_title(doc, "Monthly Progress Report", case["project"])
    doc.add_heading("Executive Narrative", level=1)
    doc.add_paragraph(case["narrative"])
    doc.add_heading("Current Control Position", level=1)
    add_table(
        doc,
        ["Field", "Value"],
        [
            ("Reporting Period", case["period"]),
            ("Prepared For", case["sponsor"]),
            ("Prepared By", "PMO Assurance Team"),
            ("Planned Progress", f"{case['planned_progress']}%"),
            ("Actual Progress", f"{case['actual_progress']}%"),
            ("Approved Budget USD", f"{case['baseline_budget']:,}"),
            ("Forecast Budget USD", f"{case['forecast_budget']:,}"),
        ],
        [2.1, 4.7],
    )
    doc.add_heading("Milestone Status Update", level=1)
    add_table(doc, ["Milestone", "Baseline Date", "Current Status", "Current Note"], case["progress_milestones"], [2.4, 1.2, 1.2, 2.2])
    doc.add_heading("Management Attention Points", level=1)
    for item in case["attention_points"]:
        doc.add_paragraph(item, style="List Bullet")
    doc.add_heading("Evidence Interpretation Notes", level=1)
    doc.add_paragraph(
        "The report should be interpreted alongside the cost report, risk register, and issue log. "
        "The PMO should avoid treating any single indicator as definitive unless it is supported by the registers."
    )
    doc.core_properties.title = f"{case['project']} Monthly Progress Report"
    doc.core_properties.subject = "PMO monthly progress evidence"
    doc.save(folder / "02_monthly_progress_report.docx")


def style_sheet(ws) -> None:
    header_fill = PatternFill("solid", fgColor="1F4E79")
    header_font = Font(color="FFFFFF", bold=True)
    border = Border(
        left=Side(style="thin", color="D9E2F3"),
        right=Side(style="thin", color="D9E2F3"),
        top=Side(style="thin", color="D9E2F3"),
        bottom=Side(style="thin", color="D9E2F3"),
    )
    for cell in ws[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    for row in ws.iter_rows():
        for cell in row:
            cell.border = border
            cell.alignment = Alignment(vertical="top", wrap_text=True)
    for col in range(1, ws.max_column + 1):
        max_len = max(len(str(ws.cell(row=row, column=col).value or "")) for row in range(1, ws.max_row + 1))
        ws.column_dimensions[get_column_letter(col)].width = min(max(max_len + 3, 12), 42)
    ws.freeze_panes = "A2"


def build_cost(case: dict, folder: Path) -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "Cost Report"
    ws.append(["Cost Item", "Planned Cost USD", "Actual Cost USD", "Forecast Cost USD", "Forecast Variance USD", "Variance %", "Status", "Evidence Note"])
    for i, row in enumerate(case["cost_rows"], start=2):
        item, planned, actual, forecast, status, note = row
        ws.append([item, planned, actual, forecast, f"=D{i}-B{i}", f"=E{i}/B{i}", status, note])
    total = len(case["cost_rows"]) + 2
    ws.append(["Total", f"=SUM(B2:B{total-1})", f"=SUM(C2:C{total-1})", f"=SUM(D2:D{total-1})", f"=SUM(E2:E{total-1})", f"=E{total}/B{total}", "", ""])
    for row in ws.iter_rows(min_row=2, min_col=2, max_col=5):
        for cell in row:
            cell.number_format = '"$"#,##0'
    for cell in ws.iter_rows(min_row=2, min_col=6, max_col=6):
        cell[0].number_format = "0.0%"
    style_sheet(ws)
    meta = wb.create_sheet("Project Metadata")
    meta.append(["Field", "Value"])
    meta.append(["Project Name", case["project"]])
    meta.append(["Reporting Period", case["period"]])
    meta.append(["Approved Baseline Budget USD", case["baseline_budget"]])
    meta.append(["Total Forecast Budget USD", case["forecast_budget"]])
    style_sheet(meta)
    wb.save(folder / "03_cost_report.xlsx")


def build_register(case: dict, folder: Path, kind: str) -> None:
    wb = Workbook()
    ws = wb.active
    if kind == "risk":
        ws.title = "Risk Register"
        ws.append(["Risk ID", "Risk Description", "Probability", "Impact", "Severity", "Mitigation Plan", "Owner", "Status"])
        for row in case["risk_rows"]:
            ws.append(row)
        purpose = "Active project risks for executive summary generation"
        filename = "04_risk_register.xlsx"
    else:
        ws.title = "Issue Log"
        ws.append(["Issue ID", "Issue Description", "Owner", "Due Date", "Status", "Severity", "Current Note"])
        for row in case["issue_rows"]:
            ws.append(row)
        for cell in ws.iter_rows(min_row=2, min_col=4, max_col=4):
            cell[0].number_format = "yyyy-mm-dd"
        purpose = "Open project issues and overdue actions for executive summary generation"
        filename = "05_issue_log.xlsx"
    style_sheet(ws)
    meta = wb.create_sheet("Project Metadata")
    meta.append(["Field", "Value"])
    meta.append(["Project Name", case["project"]])
    meta.append(["Reporting Period", case["period"]])
    meta.append(["Purpose", purpose])
    style_sheet(meta)
    wb.save(folder / filename)


def set_file_dates(folder: Path, case: dict) -> None:
    date_by_name = {
        "01_project_baseline.docx": "2026-01-15T09:00:00",
        "02_monthly_progress_report.docx": "2026-03-20T09:00:00" if "green" in case["folder"] else "2026-05-20T09:00:00" if "amber" in case["folder"] else "2026-06-20T09:00:00",
        "03_cost_report.xlsx": "2026-03-21T09:00:00" if "green" in case["folder"] else "2026-05-21T09:00:00" if "amber" in case["folder"] else "2026-06-21T09:00:00",
        "04_risk_register.xlsx": "2026-03-22T09:00:00" if "green" in case["folder"] else "2026-05-22T09:00:00" if "amber" in case["folder"] else "2026-06-22T09:00:00",
        "05_issue_log.xlsx": "2026-03-23T09:00:00" if "green" in case["folder"] else "2026-05-23T09:00:00" if "amber" in case["folder"] else "2026-06-23T09:00:00",
    }
    for name, value in date_by_name.items():
        timestamp = datetime.fromisoformat(value).timestamp()
        path = folder / name
        path.touch(exist_ok=True)
        import os

        os.utime(path, (timestamp, timestamp))


def build_readme() -> None:
    readme = OUT / "README.md"
    readme.write_text(
        """# Realistic PMO Demo Evidence Cases

These evidence packs are structured like general PMO project documents rather than direct test strings.
Each case contains:

- `01_project_baseline.docx`
- `02_monthly_progress_report.docx`
- `03_cost_report.xlsx`
- `04_risk_register.xlsx`
- `05_issue_log.xlsx`

Suggested projects:

1. `Riverside Data Hub` from `case_01_green_riverside_data_hub`
2. `Alpha Infrastructure Program` from `case_02_amber_alpha_infrastructure`
3. `Orion ERP Recovery` from `case_03_red_orion_erp_recovery`

Upload all five files into a fresh project and leave title, date, and type blank.
The app should infer title from filename and document date from file modified date.
""",
        encoding="utf-8",
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for case in CASES:
        folder = OUT / case["folder"]
        folder.mkdir(parents=True, exist_ok=True)
        build_baseline(case, folder)
        build_progress(case, folder)
        build_cost(case, folder)
        build_register(case, folder, "risk")
        build_register(case, folder, "issue")
        set_file_dates(folder, case)
    build_readme()
    print(f"Created {len(CASES)} realistic PMO fixture packs under {OUT}")


if __name__ == "__main__":
    main()

