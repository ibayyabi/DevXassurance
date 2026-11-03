"""docx tooling for the Smart Building fixture pack.

- split_meetings(): split the concatenated "All Minutes of Meeting" docx into
  one docx per meeting, preserving all formatting (we rebuild document.xml
  with only the target meeting's body elements; every other package part is
  copied unchanged).
- replace_in_paragraphs(): run-aware text replacement (joins a paragraph's
  runs when the phrase spans runs).
- fill_dokumentasi(): put evidence links into each meeting's empty
  "Dokumentasi" table.
- new_mom_from(): build a synthesized MoM (used for the two sessions that
  have no source minutes) reusing the styles of an existing split MoM.
"""

from __future__ import annotations

import copy
import re
import shutil
import zipfile
from xml.sax.saxutils import escape

from lxml import etree

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W = "{%s}" % W_NS
NSMAP = {"w": W_NS}

TITLE_RE = re.compile(r"^\d{8} - MoM")


def _body(xml_bytes: bytes):
    root = etree.fromstring(xml_bytes)
    return root, root.find(W + "body")


def _serialize(root) -> bytes:
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)


def _rewrite_document(zip_path: str, dst_path: str, new_document: bytes) -> None:
    src = zipfile.ZipFile(zip_path)
    entries = [(item, src.read(item.filename)) for item in src.infolist()]
    src.close()
    with zipfile.ZipFile(dst_path, "w", zipfile.ZIP_DEFLATED) as out:
        for item, data in entries:
            if item.filename == "word/document.xml":
                data = new_document
            out.writestr(item, data)


def meeting_blocks(docx_path: str) -> list[tuple[str, list[int]]]:
    """Return [(title, [body-element indices]), ...] for each MoM in the file."""
    zf = zipfile.ZipFile(docx_path)
    root, body = _body(zf.read("word/document.xml"))
    zf.close()
    titles = []
    for i, el in enumerate(body):
        if el.tag == W + "p" and TITLE_RE.match("".join(t.text or "" for t in el.iter(W + "t")) or ""):
            titles.append((i, "".join(t.text or "" for t in el.iter(W + "t")).strip()))
    blocks = []
    for n, (idx, title) in enumerate(titles):
        end = titles[n + 1][0] if n + 1 < len(titles) else len(list(body))
        blocks.append((title, list(range(idx, end))))
    return blocks


def split_meeting(docx_path: str, indices: list[int], dst_path: str) -> None:
    """Write one meeting (given body-element indices) as a standalone docx."""
    zf = zipfile.ZipFile(docx_path)
    root, body = _body(zf.read("word/document.xml"))
    zf.close()
    elements = list(body)
    keep = set(indices)
    sect_pr = body.find(W + "sectPr")
    for i, el in enumerate(elements):
        if i in keep or el is sect_pr:
            continue
        body.remove(el)
    _rewrite_document(docx_path, dst_path, _serialize(root))


def _para_text(p) -> str:
    return "".join(t.text or "" for t in p.iter(W + "t"))


def postprocess(docx_path: str, replacements: list[tuple[str, str]] | None = None, dokumentasi_links: list[str] | None = None) -> None:
    """Apply in-place fixes to a split meeting docx (in a formatting-safe way)."""
    zf = zipfile.ZipFile(docx_path)
    root, body = _body(zf.read("word/document.xml"))
    zf.close()
    elements = list(body)
    if replacements:
        replace_in_paragraphs(elements, replacements)
    if dokumentasi_links:
        fill_dokumentasi(elements, dokumentasi_links)
    _rewrite_document(docx_path, docx_path, _serialize(root))


def replace_in_paragraphs(elements, replacements: list[tuple[str, str]]) -> int:
    """Replace text across runs. Returns number of paragraphs changed."""
    changed = 0
    for el in elements:
        for p in el.iter(W + "p"):
            text = _para_text(p)
            new = text
            for old, rep in replacements:
                if old in new:
                    new = new.replace(old, rep)
            if new != text:
                runs = p.findall(W + "r")
                ts = [t for r in runs for t in r.findall(W + "t")]
                if not ts:
                    continue
                ts[0].text = new
                for t in ts[1:]:
                    t.text = ""
                changed += 1
    return changed


def fill_dokumentasi(elements, links: list[str]) -> None:
    """Fill the (empty) 'Dokumentasi' table content cell with link lines."""
    for el in elements:
        if el.tag != W + "tbl":
            continue
        rows = el.findall(W + "tr")
        if not rows:
            continue
        if "Dokumentasi" not in _para_text(rows[0]):
            continue
        if len(rows) < 2:
            continue
        cell = rows[1].find(W + "tc")
        if cell is None:
            continue
        # replace existing (empty) paragraphs with one paragraph per link
        paras = cell.findall(W + "p")
        template_p = paras[0] if paras else None
        for p in paras:
            cell.remove(p)
        for link in links:
            new_p = copy.deepcopy(template_p) if template_p is not None else etree.SubElement(cell, W + "p")
            for r in new_p.findall(W + "r"):
                new_p.remove(r)
            run = etree.SubElement(new_p, W + "r")
            t = etree.SubElement(run, W + "t")
            t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
            t.text = link
            cell.append(new_p)


# ---------------------------------------------------------------------------
# Synthesized MoM (weekly meetings without source minutes)
# ---------------------------------------------------------------------------

def new_mom_from(template_docx: str, dst_path: str, title: str, info: dict, sections: list[tuple[str, list[str] | list[list[str]]]], dokumentasi: list[str]) -> None:
    """Build a MoM docx with the same skeleton as the source minutes.

    sections: list of (heading, content). If content is a list[str] the section
    is a 1-column table (heading row + one paragraph per string). If it is a
    list[list[str]] the section is an Action-Items-style grid; the first inner
    list is the column header row.
    """
    import docx  # python-docx

    doc = docx.Document(template_docx)
    body = doc.element.body
    sect_pr = body.find(W + "sectPr")
    for child in list(body):
        if child is not sect_pr:
            body.remove(child)

    def add_title(text: str):
        p = doc.add_paragraph(text)
        try:
            p.style = doc.styles["Title"]
        except KeyError:
            pass

    def add_1col(heading: str, lines: list[str]):
        t = doc.add_table(rows=2, cols=1)
        t.style = _style_like(template_docx, "section")
        t.rows[0].cells[0].text = heading
        cell = t.rows[1].cells[0]
        cell.text = lines[0] if lines else ""
        for line in lines[1:]:
            cell.add_paragraph(line)

    def add_grid(heading: str, rows: list[list[str]]):
        ncols = len(rows[0])
        t = doc.add_table(rows=1 + len(rows), cols=ncols)
        t.style = _style_like(template_docx, "grid")
        t.rows[0].cells[0].text = heading
        for j, val in enumerate(rows[0]):
            t.rows[1].cells[j].text = val
        for i, row in enumerate(rows[1:], start=2):
            for j, val in enumerate(row):
                t.rows[i].cells[j].text = val

    add_title(title)
    doc.add_paragraph()
    info_tbl = doc.add_table(rows=len(info), cols=3)
    info_tbl.style = _style_like(template_docx, "info")
    for i, (k, v) in enumerate(info.items()):
        info_tbl.rows[i].cells[0].text = k
        info_tbl.rows[i].cells[1].text = ":"
        info_tbl.rows[i].cells[2].text = v
    doc.add_paragraph()
    for heading, content in sections:
        if content and isinstance(content[0], (list, tuple)):
            add_grid(heading, [list(r) for r in content])
        else:
            add_1col(heading, list(content))
        doc.add_paragraph()
    add_1col("Dokumentasi", dokumentasi)
    doc.save(dst_path)


_STYLE_CACHE: dict[str, dict[str, str]] = {}


def _style_like(template_docx: str, kind: str) -> str:
    """Find representative table style names in the template docx."""
    if template_docx not in _STYLE_CACHE:
        zf = zipfile.ZipFile(template_docx)
        root = etree.fromstring(zf.read("word/document.xml"))
        zf.close()
        styles = []
        for tbl in root.iter(W + "tbl"):
            st = tbl.find(f"{W}tblPr/{W}tblStyle")
            rows = tbl.findall(W + "tr")
            ncols = len(rows[0].findall(W + "tc")) if rows else 0
            styles.append((st.get(W + "val") if st is not None else "Table Grid", ncols))
        _STYLE_CACHE[template_docx] = {
            "info": next((s for s, n in styles if n == 3), styles[0][0]),
            "section": next((s for s, n in styles if n == 1), styles[0][0]),
            "grid": next((s for s, n in styles if n >= 4), styles[0][0]),
        }
    return _STYLE_CACHE[template_docx][kind]
