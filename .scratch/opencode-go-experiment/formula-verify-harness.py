#!/usr/bin/env python3
"""Level 2 freshness verification: independently recompute every cached formula
result in the tracker-generated workbooks and compare with the stored cache.
Catches generator inconsistencies from the artifact side (the generator source
is not in this repo). Zero network, zero tokens."""
import zipfile, re, sys, json

class Cell:
    __slots__ = ("raw", "display", "numfmt", "formula", "cached")
    def __init__(self):
        self.raw = None; self.display = None; self.numfmt = 0
        self.formula = None; self.cached = None

def read_workbook(path):
    z = zipfile.ZipFile(path)
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        ss = z.read('xl/sharedStrings.xml').decode('utf8', 'ignore')
        shared = [re.sub(r'<[^>]+>', '', m) for m in re.findall(r'<si>([\s\S]*?)</si>', ss)]
    styles = z.read('xl/styles.xml').decode('utf8', 'ignore') if 'xl/styles.xml' in z.namelist() else ''
    block = re.search(r'<cellXfs[^>]*>([\s\S]*?)</cellXfs>', styles)
    xfs = [int(m) for m in re.findall(r'<xf [^>]*numFmtId="(\d+)"', block.group(1))] if block else []
    wb = z.read('xl/workbook.xml').decode('utf8', 'ignore')
    rels = z.read('xl/_rels/workbook.xml.rels').decode('utf8', 'ignore')
    relmap = dict(re.findall(r'Id="([^"]+)"[^>]*Target="([^"]+)"', rels))
    sheets = {}
    for tag in re.findall(r'<sheet [^>]*/?>', wb):
        name_m = re.search(r'name="([^"]+)"', tag)
        rid_m = re.search(r'r:id="([^"]+)"', tag)
        if not name_m or not rid_m: continue
        name, rid = name_m.group(1), rid_m.group(1)
        target = relmap.get(rid, '').lstrip('/')
        sheets[f'xl/{target}' if not target.startswith('xl/') else target] = name
    data = {}
    for xmlpath, name in sheets.items():
        try: xml = z.read(xmlpath).decode('utf8', 'ignore')
        except KeyError: continue
        sheetdata = {}
        for r, content in re.findall(r'<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)</row>', xml):
            for m in re.finditer(r'<c r="([A-Z]+\d+)"([^>]*?)(?:/>|>([\s\S]*?)</c>)', content):
                ref, attrs, inner = m.group(1), m.group(2) or '', m.group(3) or ''
                cell = Cell()
                s = re.search(r's="(\d+)"', attrs)
                cell.numfmt = xfs[int(s.group(1))] if s and int(s.group(1)) < len(xfs) else 0
                fm = re.search(r'<f[^>]*>([\s\S]*?)</f>', inner)
                v = re.search(r'<v>([^<]*)</v>', inner)
                t = re.search(r'<is><t[^>]*>([^<]*)</t', inner)
                if fm:
                    cell.formula = fm.group(1)
                    if v: cell.cached = v.group(1)
                elif t: cell.display = t
                elif v:
                    cell.raw = v.group(1)
                    if 't="s"' in attrs:
                        try: cell.display = shared[int(v.group(1))]
                        except (ValueError, IndexError): cell.display = None
                    else: cell.display = cell.raw
                sheetdata[ref] = cell
        data[name] = sheetdata
    return data

def cell_value(cell):
    if cell is None: return None
    if cell.formula is not None and cell.cached is not None:
        try: return float(cell.cached)
        except ValueError: return None
    if cell.raw is None: return None
    try: return float(cell.raw)
    except ValueError: return None

def display_value(cell):
    if cell is None: return None
    if cell.formula is not None and cell.cached is not None:
        try:
            n = float(cell.cached)
            return f'{n * 100:g}%' if cell.numfmt in (9, 10) else f'{n:g}'
        except ValueError: return cell.cached
    if cell.raw is not None and cell.numfmt in (9, 10):
        try: return f'{float(cell.raw) * 100:g}%'
        except ValueError: return cell.raw
    return cell.display if cell.display is not None else cell.raw

class Eval:
    def __init__(self, data, sheet):
        self.data = data; self.sheet = sheet
    def resolve(self, ref):
        ref = ref.replace('$', '')
        if '!' in ref:
            sheet, cellref = ref.split('!', 1)
            sheet = sheet.strip("'").replace('&amp;', '&')
        else:
            sheet, cellref = self.sheet, ref
        return self.data.get(sheet, {}).get(cellref)
    def value_of(self, ref):
        return cell_value(self.resolve(ref))
    def eval(self, expr):
        self.tokens = self.tokenize(expr)
        self.pos = 0
        if not self.tokens: return None
        v = self.expr()
        return v if self.pos >= len(self.tokens) else None
    def tokenize(self, expr):
        return re.findall(r"'[^']*'!\$?[A-Z]+\$?\d+|\$?[A-Z]{1,3}\$?\d+|\d+(?:\.\d+)?|\"[^\"]*\"|[<>=!]+|[A-Za-z_][A-Za-z0-9_.]*|[+\-*/(),;]", expr)
    def expr(self):
        return self.compare()
    def compare(self):
        left = self.additive()
        while self.pos < len(self.tokens) and self.tokens[self.pos] in ('<', '>', '<=', '>=', '=', '<>'):
            op = self.tokens[self.pos]; self.pos += 1
            right = self.additive()
            if left is None or right is None: return None
            if op == '<': left = left < right
            elif op == '>': left = left > right
            elif op == '<=': left = left <= right
            elif op == '>=': left = left >= right
            elif op == '=': left = left == right
            else: left = left != right
        return left
    def additive(self):
        left = self.mult()
        while self.pos < len(self.tokens) and self.tokens[self.pos] in ('+', '-'):
            op = self.tokens[self.pos]; self.pos += 1
            right = self.mult()
            if left is None or right is None: return None
            left = left + right if op == '+' else left - right
        return left
    def mult(self):
        left = self.unary()
        while self.pos < len(self.tokens) and self.tokens[self.pos] in ('*', '/'):
            op = self.tokens[self.pos]; self.pos += 1
            right = self.unary()
            if left is None or right is None: return None
            if op == '*': left = left * right
            else: left = None if right == 0 else left / right
        return left
    def unary(self):
        if self.pos < len(self.tokens) and self.tokens[self.pos] == '-':
            self.pos += 1; v = self.unary(); return None if v is None else -v
        return self.atom()
    def atom(self):
        token = self.tokens[self.pos]
        if re.fullmatch(r'\d+(?:\.\d+)?', token):
            self.pos += 1; return float(token)
        if token.startswith('"'): self.pos += 1; return token[1:-1]
        if re.fullmatch(r"\$?[A-Z]{1,3}\$?\d+|'[^']*'!\$?[A-Z]{1,3}\$?\d+", token):
            self.pos += 1; return self.value_of(token)
        upper = token.upper()
        if upper in ('IF', 'MAX', 'MIN') and self.pos + 1 < len(self.tokens) and self.tokens[self.pos + 1] == '(':
            fname = upper; self.pos += 2
            args = [self.expr()]
            while self.pos < len(self.tokens) and self.tokens[self.pos] in (',', ';'):
                self.pos += 1; args.append(self.expr())
            if self.pos < len(self.tokens) and self.tokens[self.pos] == ')': self.pos += 1
            if fname == 'IF':
                cond = args[0]
                truthy = cond not in (None, 0, False, '')
                return args[1] if truthy else (args[2] if len(args) > 2 else None)
            nums = [a for a in args if isinstance(a, (int, float))]
            if fname == 'MAX': return max(nums) if nums else None
            if fname == 'MIN': return min(nums) if nums else None
        if upper in ('TRUE', 'FALSE'): self.pos += 1; return upper == 'TRUE'
        return None

def normalized(v, numfmt):
    if v is None: return None
    if isinstance(v, str): return v.strip().upper() or None
    if numfmt in (9, 10): return round(v * 100, 6)
    return round(v, 9)

def verify_workbook(path):
    data = read_workbook(path)
    stats = {'match': 0, 'mismatch': [], 'not_computable': 0, 'total': 0}
    for sheet, cells in data.items():
        ev = Eval(data, sheet)
        for ref, cell in cells.items():
            if cell.formula is None or cell.cached is None: continue
            stats['total'] += 1
            try: computed = ev.eval(cell.formula)
            except Exception: computed = None
            cached_norm = normalized(display_value(cell), cell.numfmt)
            computed_norm = normalized(computed, cell.numfmt)
            if computed_norm is None:
                stats['not_computable'] += 1
            elif isinstance(cached_norm, (int, float)) and isinstance(computed_norm, (int, float)) and abs(cached_norm - computed_norm) < 1e-6:
                stats['match'] += 1
            elif cached_norm == computed_norm:
                stats['match'] += 1
            else:
                stats['mismatch'].append({'sheet': sheet, 'cell': ref, 'formula': cell.formula[:80], 'cached': cached_norm, 'computed': computed_norm})
    return stats

if __name__ == '__main__':
    result = verify_workbook(sys.argv[1])
    print(json.dumps({k: (v if k != 'mismatch' else v[:8]) for k, v in result.items()}, indent=1, default=str))
