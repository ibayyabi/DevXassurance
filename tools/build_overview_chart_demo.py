from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path

from docx import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor, Twips


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "demo-evidence-fixtures" / "overview-chart-demo"

# standard_business_brief preset
CONTENT_WIDTH_DXA = 9360
TABLE_INDENT_DXA = 120
CELL_MARGINS_DXA = {"top": 80, "bottom": 80, "start": 120, "end": 120}
FONT = "Calibri"
INK = "0F172A"
BLUE = "2E74B5"
DARK_BLUE = "1F4D78"
MUTED = "475569"
LIGHT = "F2F4F7"
WHITE = "FFFFFF"
BORDER = "CBD5E1"
STATUS_WARN = "9A6700"
STATUS_WARN_BG = "FFF4CE"
STATUS_CRITICAL = "9B1C1C"
STATUS_CRITICAL_BG = "FDECEC"


def set_run_font(
    run,
    *,
    size: float,
    color: str = INK,
    bold: bool = False,
    italic: bool = False,
) -> None:
    run.font.name = FONT
    run._element.get_or_add_rPr()
    run._element.rPr.rFonts.set(qn("w:ascii"), FONT)
    run._element.rPr.rFonts.set(qn("w:hAnsi"), FONT)
    run.font.size = Pt(size)
    run.font.color.rgb = RGBColor.from_string(color)
    run.bold = bold
    run.italic = italic


def ensure_child(parent, tag: str):
    child = parent.find(qn(tag))
    if child is None:
        child = OxmlElement(tag)
        parent.append(child)
    return child


def set_width(parent, tag: str, width_dxa: int) -> None:
    width = ensure_child(parent, tag)
    width.set(qn("w:type"), "dxa")
    width.set(qn("w:w"), str(width_dxa))


def set_cell_margins(cell) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_mar = ensure_child(tc_pr, "w:tcMar")
    for side, width in CELL_MARGINS_DXA.items():
        margin = ensure_child(tc_mar, f"w:{side}")
        margin.set(qn("w:w"), str(width))
        margin.set(qn("w:type"), "dxa")


def set_cell_shading(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shading = ensure_child(tc_pr, "w:shd")
    shading.set(qn("w:fill"), fill)
    shading.set(qn("w:val"), "clear")


def set_repeat_table_header(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    header = ensure_child(tr_pr, "w:tblHeader")
    header.set(qn("w:val"), "true")


def apply_table_geometry(table, widths_dxa: list[int]) -> None:
    if sum(widths_dxa) != CONTENT_WIDTH_DXA:
        raise ValueError("Table column widths must total 9360 DXA.")

    table.autofit = False
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    tbl_pr = table._tbl.tblPr
    set_width(tbl_pr, "w:tblW", CONTENT_WIDTH_DXA)

    indent = ensure_child(tbl_pr, "w:tblInd")
    indent.set(qn("w:type"), "dxa")
    indent.set(qn("w:w"), str(TABLE_INDENT_DXA))

    layout = ensure_child(tbl_pr, "w:tblLayout")
    layout.set(qn("w:type"), "fixed")

    grid = table._tbl.tblGrid
    for child in list(grid):
        grid.remove(child)
    for width in widths_dxa:
        grid_col = OxmlElement("w:gridCol")
        grid_col.set(qn("w:w"), str(width))
        grid.append(grid_col)

    for column_index, width in enumerate(widths_dxa):
        table.columns[column_index].width = Twips(width)

    for row in table.rows:
        row.height = None
        for column_index, cell in enumerate(row.cells):
            width = widths_dxa[column_index]
            cell.width = Twips(width)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            set_width(cell._tc.get_or_add_tcPr(), "w:tcW", width)
            set_cell_margins(cell)


def set_cell_text(
    cell,
    value: str,
    *,
    bold: bool = False,
    color: str = INK,
    size: float = 9,
    align: WD_ALIGN_PARAGRAPH = WD_ALIGN_PARAGRAPH.LEFT,
) -> None:
    cell.text = ""
    paragraph = cell.paragraphs[0]
    paragraph.alignment = align
    paragraph.paragraph_format.space_before = Pt(0)
    paragraph.paragraph_format.space_after = Pt(0)
    paragraph.paragraph_format.line_spacing = 1.1
    set_run_font(
        paragraph.add_run(value),
        size=size,
        color=color,
        bold=bold,
    )


def add_table(
    doc: Document,
    headers: list[str],
    rows: list[tuple[str, ...]],
    widths_dxa: list[int],
    *,
    numeric_columns: set[int] | None = None,
) -> None:
    table = doc.add_table(rows=1, cols=len(headers))
    table.style = "Table Grid"
    set_repeat_table_header(table.rows[0])

    for index, header in enumerate(headers):
        set_cell_shading(table.rows[0].cells[index], LIGHT)
        set_cell_text(
            table.rows[0].cells[index],
            header,
            bold=True,
            size=9,
            align=(
                WD_ALIGN_PARAGRAPH.RIGHT
                if numeric_columns and index in numeric_columns
                else WD_ALIGN_PARAGRAPH.LEFT
            ),
        )

    for row_values in rows:
        cells = table.add_row().cells
        for index, value in enumerate(row_values):
            set_cell_text(
                cells[index],
                str(value),
                align=(
                    WD_ALIGN_PARAGRAPH.RIGHT
                    if numeric_columns and index in numeric_columns
                    else WD_ALIGN_PARAGRAPH.LEFT
                ),
            )

    apply_table_geometry(table, widths_dxa)
    spacer = doc.add_paragraph()
    spacer.paragraph_format.space_after = Pt(1)


def add_page_number(paragraph) -> None:
    paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    paragraph.paragraph_format.space_after = Pt(0)
    run = paragraph.add_run("Page ")
    set_run_font(run, size=9, color=MUTED)
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instruction = OxmlElement("w:instrText")
    instruction.set(qn("xml:space"), "preserve")
    instruction.text = " PAGE "
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    display = OxmlElement("w:t")
    display.text = "1"
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.extend([begin, instruction, separate, display, end])


def configure_document(doc: Document, running_label: str) -> None:
    section = doc.sections[0]
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.top_margin = Inches(1)
    section.right_margin = Inches(1)
    section.bottom_margin = Inches(1)
    section.left_margin = Inches(1)
    section.header_distance = Inches(0.492)
    section.footer_distance = Inches(0.492)

    normal = doc.styles["Normal"]
    normal.font.name = FONT
    normal._element.rPr.rFonts.set(qn("w:ascii"), FONT)
    normal._element.rPr.rFonts.set(qn("w:hAnsi"), FONT)
    normal.font.size = Pt(11)
    normal.font.color.rgb = RGBColor.from_string(INK)
    normal.paragraph_format.space_before = Pt(0)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.1

    for name, size, color, before, after in (
        ("Heading 1", 16, BLUE, 16, 8),
        ("Heading 2", 13, BLUE, 12, 6),
        ("Heading 3", 12, DARK_BLUE, 8, 4),
    ):
        style = doc.styles[name]
        style.font.name = FONT
        style._element.rPr.rFonts.set(qn("w:ascii"), FONT)
        style._element.rPr.rFonts.set(qn("w:hAnsi"), FONT)
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = RGBColor.from_string(color)
        style.paragraph_format.space_before = Pt(before)
        style.paragraph_format.space_after = Pt(after)
        style.paragraph_format.keep_with_next = True

    header = section.header.paragraphs[0]
    header.text = ""
    header.paragraph_format.space_after = Pt(0)
    set_run_font(header.add_run(running_label), size=9, color=MUTED)
    add_page_number(section.footer.paragraphs[0])


def add_masthead(
    doc: Document,
    *,
    title: str,
    project: str,
    metadata: list[tuple[str, str]],
) -> None:
    title_paragraph = doc.add_paragraph()
    title_paragraph.paragraph_format.space_before = Pt(10)
    title_paragraph.paragraph_format.space_after = Pt(4)
    set_run_font(title_paragraph.add_run(title), size=23, bold=True)

    subtitle = doc.add_paragraph()
    subtitle.paragraph_format.space_after = Pt(12)
    set_run_font(subtitle.add_run(project), size=14, color=DARK_BLUE, bold=True)

    for label, value in metadata:
        paragraph = doc.add_paragraph()
        paragraph.paragraph_format.space_before = Pt(0)
        paragraph.paragraph_format.space_after = Pt(2)
        set_run_font(paragraph.add_run(f"{label}: "), size=10, bold=True)
        set_run_font(paragraph.add_run(value), size=10)

    spacer = doc.add_paragraph()
    spacer.paragraph_format.space_after = Pt(3)


def add_status_callout(
    doc: Document,
    *,
    label: str,
    message: str,
    fill: str,
    text_color: str,
) -> None:
    paragraph = doc.add_paragraph()
    paragraph.paragraph_format.space_before = Pt(2)
    paragraph.paragraph_format.space_after = Pt(10)
    paragraph.paragraph_format.left_indent = Inches(0.14)
    paragraph.paragraph_format.right_indent = Inches(0.14)
    paragraph.paragraph_format.space_before = Pt(6)
    paragraph.paragraph_format.space_after = Pt(6)
    shading = ensure_child(paragraph._p.get_or_add_pPr(), "w:shd")
    shading.set(qn("w:fill"), fill)
    shading.set(qn("w:val"), "clear")
    set_run_font(
        paragraph.add_run(f"{label}: "),
        size=10.5,
        color=text_color,
        bold=True,
    )
    set_run_font(
        paragraph.add_run(message),
        size=10.5,
        color=text_color,
    )


def add_body_paragraph(doc: Document, text: str, *, muted: bool = False) -> None:
    paragraph = doc.add_paragraph()
    paragraph.paragraph_format.space_after = Pt(6)
    set_run_font(
        paragraph.add_run(text),
        size=10.5,
        color=MUTED if muted else INK,
    )


def save_document(
    doc: Document,
    filename: str,
    *,
    title: str,
    subject: str,
    document_date: datetime,
) -> Path:
    doc.core_properties.title = title
    doc.core_properties.subject = subject
    doc.core_properties.author = "X-Assurance Demo"
    doc.core_properties.created = document_date
    doc.core_properties.modified = document_date
    target = OUT / filename
    doc.save(target)
    timestamp = document_date.timestamp()
    os.utime(target, (timestamp, timestamp))
    return target


def build_baseline() -> Path:
    document_date = datetime(2026, 3, 31, 17, 0, 0)
    doc = Document()
    configure_document(doc, "X-Assurance demo evidence | Approved baseline")
    add_masthead(
        doc,
        title="Project Control Baseline",
        project="Northstar Customer Platform",
        metadata=[
            ("Document role", "Approved project plan and baseline"),
            ("Approval status", "Approved"),
            ("Baseline date", "2026-03-31"),
            ("Project manager", "Dana Whitfield"),
        ],
    )
    add_body_paragraph(
        doc,
        "This is the approved reference plan. X-Assurance should classify this "
        "document as baseline evidence and reuse it when comparing each monthly report.",
    )

    doc.add_heading("Approved cost and schedule plan", level=1)
    add_table(
        doc,
        ["Control field", "Approved baseline value"],
        [
            ("Approved budget", "USD 1,200,000"),
            ("Project start date", "2026-01-05"),
            ("Production Go-Live milestone", "2026-09-30"),
            ("Benefits readiness review", "2026-08-31"),
            ("Planned completion by 2026-04-30", "40%"),
            ("Planned completion by 2026-05-31", "60%"),
        ],
        [3420, 5940],
    )

    doc.add_heading("Approved risk posture", level=1)
    add_table(
        doc,
        ["Risk measure", "Approved position"],
        [
            ("Open critical risks", "0"),
            ("Open high risks", "0"),
            ("High risks without owner or mitigation", "0"),
            (
                "Risk control rule",
                "Every high risk must have a named owner, mitigation, and due date.",
            ),
        ],
        [3420, 5940],
    )

    doc.add_heading("Extraction anchors", level=1)
    add_body_paragraph(
        doc,
        "Approved baseline budget: USD 1,200,000. Approved Production Go-Live "
        "date: 2026-09-30. These values remain fixed for April 2026 and May 2026.",
    )

    return save_document(
        doc,
        "01_northstar_project_baseline.docx",
        title="Northstar Customer Platform Project Control Baseline",
        subject="Approved cost, schedule, and risk baseline",
        document_date=document_date,
    )


def build_april_report() -> Path:
    document_date = datetime(2026, 4, 30, 17, 0, 0)
    doc = Document()
    configure_document(doc, "X-Assurance demo evidence | Monthly project report")
    add_masthead(
        doc,
        title="Monthly Project Report",
        project="Northstar Customer Platform",
        metadata=[
            ("Document role", "Current monthly performance evidence"),
            ("Reporting period", "April 2026"),
            ("Reporting period key", "2026-04-01"),
            ("Report date", "2026-04-30"),
        ],
    )
    add_status_callout(
        doc,
        label="Management status",
        message=(
            "Needs attention. Forecast cost is 2% above the approved budget, "
            "Go-Live is forecast 7 days late, and one new controlled high risk is open."
        ),
        fill=STATUS_WARN_BG,
        text_color=STATUS_WARN,
    )

    doc.add_heading("Current control snapshot", level=1)
    add_table(
        doc,
        ["Measure", "Plan / baseline", "April current value"],
        [
            ("Budget", "USD 1,200,000", "Forecast at completion: USD 1,224,000"),
            ("Cost to date", "-", "Actual cost: USD 455,000"),
            ("Overall progress", "40% planned", "34% actual"),
            ("Production Go-Live", "2026-09-30", "Forecast: 2026-10-07"),
            ("Schedule movement", "0 days", "7 calendar days late"),
        ],
        [2520, 2520, 4320],
    )

    doc.add_heading("Current risk evidence", level=1)
    add_table(
        doc,
        ["Risk ID", "Severity", "Status and control"],
        [
            (
                "R-014",
                "High",
                "Open; owner: Integration Lead; mitigation: add capacity test; due 2026-05-15.",
            ),
        ],
        [1440, 1440, 6480],
    )
    add_body_paragraph(
        doc,
        "Explicit April risk counts: 0 open critical risks; 1 open high risk; "
        "0 high risks missing an owner or mitigation; 0 increased risks; "
        "1 new high risk; maximum mitigation overdue is 0 days.",
    )

    doc.add_heading("PMO decision", level=1)
    add_body_paragraph(
        doc,
        "Keep the approved baseline unchanged. The Integration Lead will run the "
        "capacity test before the May steering committee and report whether the "
        "7-day forecast delay can be recovered.",
    )

    return save_document(
        doc,
        "02_northstar_monthly_report_2026-04.docx",
        title="Northstar Customer Platform April 2026 Monthly Project Report",
        subject="April 2026 current cost, schedule, and risk evidence",
        document_date=document_date,
    )


def build_may_report() -> Path:
    document_date = datetime(2026, 5, 31, 17, 0, 0)
    doc = Document()
    configure_document(doc, "X-Assurance demo evidence | Monthly project report")
    add_masthead(
        doc,
        title="Monthly Project Report",
        project="Northstar Customer Platform",
        metadata=[
            ("Document role", "Current monthly performance evidence"),
            ("Reporting period", "May 2026"),
            ("Reporting period key", "2026-05-01"),
            ("Report date", "2026-05-31"),
        ],
    )
    add_status_callout(
        doc,
        label="Management status",
        message=(
            "Critical. Forecast cost is 8% above the approved budget, Go-Live is "
            "forecast 21 days late, and critical or uncontrolled risk requires escalation."
        ),
        fill=STATUS_CRITICAL_BG,
        text_color=STATUS_CRITICAL,
    )

    doc.add_heading("Current control snapshot", level=1)
    add_table(
        doc,
        ["Measure", "Plan / baseline", "May current value"],
        [
            ("Budget", "USD 1,200,000", "Forecast at completion: USD 1,296,000"),
            ("Cost to date", "-", "Actual cost: USD 690,000"),
            ("Overall progress", "60% planned", "46% actual"),
            ("Production Go-Live", "2026-09-30", "Forecast: 2026-10-21"),
            ("Schedule movement", "0 days", "21 calendar days late"),
        ],
        [2520, 2520, 4320],
    )

    doc.add_heading("Current risk evidence", level=1)
    add_table(
        doc,
        ["Risk ID", "Severity", "Status and control"],
        [
            (
                "R-014",
                "High",
                "Open and increased; owner: Integration Lead; capacity mitigation overdue by 21 days.",
            ),
            (
                "R-021",
                "Critical",
                "Open; data migration rehearsal failed; owner: Recovery Manager; mitigation in progress.",
            ),
            (
                "R-022",
                "High",
                "Open and new; no owner and no mitigation has been assigned.",
            ),
        ],
        [1440, 1440, 6480],
    )
    add_body_paragraph(
        doc,
        "Explicit May risk counts: 1 open critical risk; 2 open high risks; "
        "1 high risk missing an owner or mitigation; 2 increased risks; "
        "1 new high risk; maximum mitigation overdue is 21 days.",
    )

    doc.add_heading("Required management decision", level=1)
    add_body_paragraph(
        doc,
        "Escalate the recovery plan to the steering committee. Assign an owner and "
        "mitigation to R-022, approve the data migration recovery resources, and "
        "decide whether to rebaseline only after the impact is independently verified.",
    )

    return save_document(
        doc,
        "03_northstar_monthly_report_2026-05.docx",
        title="Northstar Customer Platform May 2026 Monthly Project Report",
        subject="May 2026 current cost, schedule, and risk evidence",
        document_date=document_date,
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    outputs = [build_baseline(), build_april_report(), build_may_report()]
    for output in outputs:
        print(output)


if __name__ == "__main__":
    main()
