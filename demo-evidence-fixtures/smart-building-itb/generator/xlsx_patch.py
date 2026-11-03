"""Surgical .xlsx patcher.

Edits cell values directly inside the zip's sheet XML so that everything the
openpyxl load/save round-trip would drop (charts, drawings, images, styles,
number formats, cached formatting) is preserved byte-for-byte.

Value kinds accepted by ``patch_sheet``:
    ("n", 0.204)               numeric (plain ``<v>``)
    ("s", "Teks")              shared string
    ("f", "=A1+B1", 5)         formula with cached value (cached may be None)
    ("c",)                     clear the cell entirely

Strings containing ``=`` at position 0 are NOT auto-treated as formulas;
callers must be explicit.
"""

from __future__ import annotations

import re
import shutil
import zipfile
from xml.sax.saxutils import escape

COL_RE = re.compile(r"([A-Z]+)(\d+)")


def col_letter_to_num(letters: str) -> int:
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n


def split_coord(coord: str) -> tuple[str, int]:
    m = COL_RE.fullmatch(coord)
    if not m:
        raise ValueError(f"bad cell coordinate: {coord}")
    return m.group(1), int(m.group(2))


def sheet_targets(zf: zipfile.ZipFile) -> dict[str, str]:
    """Map sheet name -> zip path of its sheet XML."""
    wb = zf.read("xl/workbook.xml").decode("utf-8")
    rels = zf.read("xl/_rels/workbook.xml.rels").decode("utf-8")
    rel_map = {}
    for rel in re.findall(r"<Relationship\b[^>]*/?>", rels):
        rid = re.search(r'Id="([^"]+)"', rel)
        target = re.search(r'Target="([^"]+)"', rel)
        if rid and target:
            rel_map[rid.group(1)] = target.group(1)
    out = {}
    for m in re.finditer(r'<sheet[^>]*name="([^"]+)"[^>]*r:id="(rId\d+)"', wb):
        name, rid = m.group(1), m.group(2)
        name = name.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&apos;", "'")
        target = rel_map[rid].lstrip("/")
        if not target.startswith("xl/"):
            target = "xl/" + target
        out[name] = target
    return out


class Patcher:
    def __init__(self, src_path: str):
        self.src_path = src_path
        self._zf = zipfile.ZipFile(src_path)
        self.targets = sheet_targets(self._zf)
        self._shared: list[str] | None = None
        self._sheet_edits: dict[str, dict[str, tuple]] = {}

    # -- shared strings -------------------------------------------------
    def _shared_list(self) -> list[str]:
        if self._shared is None:
            try:
                xml = self._zf.read("xl/sharedStrings.xml").decode("utf-8")
            except KeyError:
                xml = None
            if xml is None:
                self._shared = []
            else:
                items = re.findall(r"<si>(.*?)</si>", xml, flags=re.S)
                out = []
                for item in items:
                    text = "".join(re.findall(r"<t[^>]*>(.*?)</t>", item, flags=re.S))
                    out.append(
                        text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&apos;", "'")
                    )
                self._shared = out
                self._shared_xml_header = xml[: xml.index("<si>")] if "<si>" in xml else None
        return self._shared

    def _string_index(self, text: str) -> int:
        ss = self._shared_list()
        if text in ss:
            return ss.index(text)
        ss.append(text)
        return len(ss) - 1

    # -- public API ------------------------------------------------------
    def set(self, sheet: str, coord: str, value) -> None:
        self._sheet_edits.setdefault(sheet, {})[coord] = value

    def set_many(self, sheet: str, values: dict[str, object]) -> None:
        for coord, v in values.items():
            self.set(sheet, coord, v)

    def save(self, dst_path: str) -> None:
        replacements: dict[str, bytes] = {}

        # cached formula values become stale after patching: force recalc on open
        wb_path = "xl/workbook.xml"
        wb_xml = self._zf.read(wb_path).decode("utf-8")
        if "<calcPr" in wb_xml:
            wb_xml = re.sub(r"<calcPr", '<calcPr fullCalcOnLoad="1"', wb_xml, count=1) \
                if "fullCalcOnLoad" not in wb_xml else wb_xml
        else:
            wb_xml = wb_xml.replace("</workbook>", '<calcPr calcId="0" fullCalcOnLoad="1"/></workbook>')
        replacements[wb_path] = wb_xml.encode("utf-8")

        for sheet, edits in self._sheet_edits.items():
            path = self.targets[sheet]
            xml = self._zf.read(path).decode("utf-8")
            xml = self._apply_edits(xml, edits)
            replacements[path] = xml.encode("utf-8")

        # shared strings must be written after all sheets appended their strings
        if self._shared is not None:
            ss_path = "xl/sharedStrings.xml"
            try:
                orig = self._zf.read(ss_path).decode("utf-8")
            except KeyError:
                if self._shared:
                    orig = (
                        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                        '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                        + "".join(f"<si><t xml:space=\"preserve\">{escape(t)}</t></si>" for t in self._shared)
                        + "</sst>"
                    )
                    replacements[ss_path] = orig.encode("utf-8")
            else:
                items = "".join(f"<si><t xml:space=\"preserve\">{escape(t)}</t></si>" for t in self._shared)
                body_start = orig.index("<si>") if "<si>" in orig else orig.index("</sst>")
                head = orig[:body_start]
                n = len(self._shared)
                head = re.sub(r'count="\d+"', f'count="{n}"', head)
                head = re.sub(r'uniqueCount="\d+"', f'uniqueCount="{n}"', head)
                replacements[ss_path] = (head + items + "</sst>").encode("utf-8")

        with zipfile.ZipFile(dst_path, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in self._zf.infolist():
                data = replacements.get(item.filename)
                if data is None:
                    data = self._zf.read(item.filename)
                zout.writestr(item, data)
            for path, data in replacements.items():
                if path not in {i.filename for i in self._zf.infolist()}:
                    zout.writestr(path, data)
        self._zf.close()

    # -- internals --------------------------------------------------------
    def _cell_xml(self, coord: str, attrs: str, value) -> str:
        kind = value[0]
        if kind == "n":
            return f'<c r="{coord}"{attrs}><v>{value[1]}</v></c>'
        if kind == "s":
            # inline string: valid in any workbook, no sharedStrings part needed
            text = escape(value[1])
            return (f'<c r="{coord}" t="inlineStr"{attrs}>'
                    f'<is><t xml:space="preserve">{text}</t></is></c>')
        if kind == "f":
            formula = escape(str(value[1]).lstrip("="))
            cached = value[2] if len(value) >= 3 else None
            if cached is None:
                return f'<c r="{coord}"{attrs}><f>{formula}</f></c>'
            if isinstance(cached, str):
                # string-valued formula result needs t="str"
                return (f'<c r="{coord}" t="str"{attrs}><f>{formula}</f>'
                        f'<v>{escape(cached)}</v></c>')
            return f'<c r="{coord}"{attrs}><f>{formula}</f><v>{cached}</v></c>'
        if kind == "c":
            return ""
        raise ValueError(f"unknown value kind: {value!r}")

    @staticmethod
    def _strip_t(attrs: str) -> str:
        attrs = re.sub(r'\s+t="[^"]*"', "", attrs)
        return attrs

    @staticmethod
    def _find_cell(xml: str, coord: str):
        """Return (start, end, attrs) of the cell with this coordinate, or None.

        Matches the open tag exactly (up to the first '>'), then, for non
        self-closing cells, the first following '</c>' (cells never nest).
        """
        open_pat = re.compile(r'<c r="%s"[^>]*>' % re.escape(coord))
        m = open_pat.search(xml)
        if not m:
            return None
        if m.group(0).endswith("/>"):
            return m.start(), m.end(), m.group(0)[len(f'<c r="{coord}"'):-2]
        close = xml.index("</c>", m.end())
        return m.start(), close + 4, m.group(0)[len(f'<c r="{coord}"'):-1]

    def _apply_edits(self, xml: str, edits: dict[str, tuple]) -> str:
        for coord, value in edits.items():
            found = self._find_cell(xml, coord)
            attrs = self._strip_t(found[2]) if found else ""
            if value[0] == "c":
                if found:
                    xml = xml[: found[0]] + xml[found[1]:]
                continue
            if not found:
                attrs = self._donor_attrs(xml, coord)
            new_cell = self._cell_xml(coord, attrs, value)
            if found:
                xml = xml[: found[0]] + new_cell + xml[found[1]:]
            else:
                xml = self._insert_cell(xml, coord, new_cell)
        return xml

    @staticmethod
    def _donor_attrs(xml: str, coord: str) -> str:
        """Style attribute borrowed from the nearest existing cell in the same
        column, so inserted cells inherit the column's number format/border."""
        letters, rownum = split_coord(coord)
        best = None
        best_dist = None
        for m in re.finditer(r'<c r="%s(\d+)"([^>]*)' % letters, xml):
            dist = abs(int(m.group(1)) - rownum)
            if "s=" in m.group(2) and (best_dist is None or dist < best_dist):
                best = m.group(2)
                best_dist = dist
        if best is None:
            return ""
        s = re.search(r'\bs="\d+"', best)
        return (" " + s.group(0)) if s else ""

    def _insert_cell(self, xml: str, coord: str, new_cell: str) -> str:
        letters, rownum = split_coord(coord)
        col = col_letter_to_num(letters)
        # find the row element
        row_pat = re.compile(r'(<row r="%d"[^>]*>)(.*?)(</row>)' % rownum, flags=re.S)
        m = row_pat.search(xml)
        if not m:
            # possibly a self-closing empty row
            row_pat2 = re.compile(r'<row r="%d"[^>]*/>' % rownum)
            m2 = row_pat2.search(xml)
            if m2:
                expanded = m2.group(0)[:-2] + ">" + new_cell + "</row>"
                return xml[: m2.start()] + expanded + xml[m2.end():]
            return _insert_row(xml, coord, new_cell)
        head, body, tail = m.group(1), m.group(2), m.group(3)
        cells = list(re.finditer(r'<c r="([A-Z]+)\d+".*?(?:/>|</c>)', body, flags=re.S))
        insert_at = len(body)
        for cm in cells:
            c_letters = cm.group(1)
            if col_letter_to_num(c_letters) > col:
                insert_at = cm.start()
                break
        new_body = body[:insert_at] + new_cell + body[insert_at:]
        return xml[: m.start()] + head + new_body + tail + xml[m.end():]


def _insert_row(xml: str, coord: str, new_cell: str) -> str:
    letters, rownum = split_coord(coord)
    row_xml = f'<row r="{rownum}">{new_cell}</row>'
    rows = list(re.finditer(r'<row r="(\d+)"', xml))
    for rm in rows:
        if int(rm.group(1)) > rownum:
            return xml[: rm.start()] + row_xml + xml[rm.start():]
    return xml.replace("</sheetData>", row_xml + "</sheetData>")
