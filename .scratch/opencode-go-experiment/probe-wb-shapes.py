import zipfile, re

files = ['12_BISMA', '04_Kelistrikan', '02_Kamera_Pengawasan']
for f in files:
    p = f'demo-evidence-fixtures/smart-building-itb/sessions/2026-10-30_w7/{f}_Subcontractor_Weekly.xlsx'
    z = zipfile.ZipFile(p)
    for sheet in ['sheet1.xml', 'sheet2.xml', 'sheet3.xml', 'sheet4.xml']:
        try:
            xml = z.read(f'xl/worksheets/{sheet}').decode('utf8', 'ignore')
        except KeyError:
            continue
        rows = re.findall(r'<row[^>]*r="(\d+)"[^>]*>(.*?)</row>', xml, re.S)
        nonempty = [(r, c) for r, c in rows if re.search(r'<v>|<t[^>]*>[^<]+</t>', c)]
        if len(nonempty) > 12:
            pct = re.findall(r'<v>([\d.]+)</v>', ' '.join(c for _, c in nonempty))
            texts = re.findall(r'<t[^>]*>([^<]{3,44})</t>', ' '.join(c for _, c in nonempty[:300]))
            print(f'{f}/{sheet}: {len(nonempty)} nonempty; pct: {pct[:10]}')
            print('   texts:', texts[:10])
        else:
            print(f'{f}/{sheet}: {len(nonempty)} nonempty rows')
