#!/usr/bin/env python3
"""Composition audit: in the modelText of one real workbook's chunks, how much
is formula text, annotation text, and actual values? Offline, zero tokens."""
import zipfile, re

path = 'DOKUMEN ASLI/Pemantau Project/1. ALARM KEBENCANAAN/01_Alarm_Kebencanaan_Subcontractor_Weekly.xlsx'
z = zipfile.ZipFile(path)
xml = z.read('xl/worksheets/sheet3.xml').decode('utf8', 'ignore')  # Workplan & Gantt
try:
    ss = z.read('xl/sharedStrings.xml').decode('utf8', 'ignore')
    shared = re.findall(r'<si>(?:<t[^>]*>)?([^<]*)</t>', ss)
except KeyError:
    shared = []

total_formula = 0
total_annotation = 0
total_value = 0
formula_samples = []
rag_formulas = set()
rows = re.findall(r'<row[^>]*r="(\d+)"[^>]*>(.*?)</row>', xml, re.S)
for r, content in rows:
    cells = re.findall(r'<c r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)</c>', content)
    for ref, attrs, inner in cells:
        f = re.search(r'<f[^>]*>([\s\S]*?)</f>', inner)
        v = re.search(r'<v>([^<]*)</v>', inner)
        if f:
            formula = f.group(1)
            total_formula += len(formula) + 2
            if 'IF(' in formula:
                rag_formulas.add(formula[:60])
            # annotation length estimate: "(stored cached result: X; freshness not established); formula cache: cached_value [formula cache: cached_value]"
            total_annotation += len('(stored cached result: ; freshness not established); formula cache: cached_value [formula cache: cached_value]') + len(v.group(1) if v else '')
        elif v:
            total_value += len(v.group(1)) + 4
        elif '<is>' in inner:
            t = re.search(r'<t[^>]*>([^<]*)</t>', inner)
            total_value += len(t.group(1)) if t else 0

print(f'sheet3 rows: {len(rows)}')
print(f'formula text: {total_formula} chars')
print(f'annotation text (formula cells): ~{total_annotation} chars')
print(f'values + labels: ~{total_value} chars')
print(f'distinct IF-formula prefixes: {len(rag_formulas)}')
for s in list(rag_formulas)[:4]:
    print('  ', s)
# how many times the longest formula repeats
longest = max(rag_formulas, key=len) if rag_formulas else ''
count = sum(1 for r, c in rows for f in re.findall(r'<f[^>]*>([\s\S]*?)</f>', c) if f[:60] == longest)
print(f'longest formula ({len(longest)}-char prefix) repeats: {count}x → full chars ≈ {count * 350}')
