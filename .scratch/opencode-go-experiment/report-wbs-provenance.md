# Laporan audit provenance WBS — offline

> **Klarifikasi verifikasi.** Audit ini memeriksa apakah output WBS yang sudah ada benar-benar
> membawa **bukti per-cell** untuk nilai yang diklaim. Pembaca OOXML independen memverifikasi
> lokasi/nilai dari file yang sama; ini **bukan** ground truth independen untuk makna bisnis,
> kelengkapan, atau kesegaran cache. Array `expected-results.json` **tidak** dipakai oleh audit
> maupun prototipe, dan tidak dipakai sebagai bukti identitas WBS. Prototipe Jalur A memakai
> `proto:` identity, **bukan** source ID produksi.

## Ringkasan keputusan

- **Akar masalah utama:** `splitSourceBlock()` di `worker/src/services/document-parser.ts:1984-2010`
  membuang `cellReferences` dan `rowCells` untuk seluruh block ketika teks baris melebihi
  `MAX_SOURCE_BLOCK_PART_LENGTH = 4000 - 900 = 3100` karakter (`document-parser.ts:368-376`).
  Baris tetap punya row reference nyata, tetapi kehilangan referensi sel per-cell.
- **Dampak terukur:** 24 workbook / **216 dari 408 baris** memakai template `demoted_row_text`;
  semuanya kehilangan `rowCells`, `cellReferences`, dan `cell_source_id`. 24 workbook /
  **192 baris** memakai template `structured_row_cells` dan mempertahankan 16 referensi sel per baris.
- **Jalur B (konservatif) — aman dipakai sekarang:** **192/192** baris structured terbukti
  per-cell setelah dicek independen (hash, sheet, row, column, header, literal/cache, nilai).
  **216/216** baris demoted menjadi **review row-level**; tidak ada source ID/locator yang
  dikarang. **216** klaim `resolved` lama menjadi *false accept* di bawah standar per-cell.
- **Jalur A — feasible sebagai prototipe, belum production-ready:** prototipe cell-aware split
  memetakan **2448/2448** sel wajib (A, D, G, I, J, O) pada **408/408** baris; **216/216** baris
  demoted feasible dan **192/192** structured feasible. Namun ini bukti bahwa informasi sel
  **dapat** dipertahankan, bukan bukti bahwa parser produksi sudah menghasilkannya.
- **Blocker produksi Jalur A:** (1) `splitSourceBlock` harus diubah menjadi cell-aware dan versi
  parser di-bump; (2) parser memilih header row 3, bukan WBS header row 4, pada 24 workbook
  demoted sehingga `rowCells.label` A..R akan tetap `null` walau referensi sel dipertahankan;
  (3) validator konsumen belum diuji end-to-end dengan ref prototipe; (4) cap 120 referensi per
  chunk masih laten (tidak terpicu di fixture ini: maksimum chunk baris WBS 51, maksimum global 118).
- **Tidak ada perubahan produksi, fixture asli, output eksperimen lama, atau commit.** Semua
  pengujian aplikasi offline; tidak ada `.env*`, API key, auth store, provider/LLM, install, atau
  perintah destruktif.

## Batas dan kepatuhan

- Offline penuh: tidak membaca `.env*`, API key, atau auth store; tidak memanggil provider/LLM.
  `run.mjs`, `baseline-v2.mjs`, dan `main()` `evidence-v2.mjs` tidak dijalankan. CommandCode
  inference terpisah dan tidak dipakai.
- Parser produksi dipakai **tanpa perubahan** untuk baseline: ditranspilasi ke modul sementara,
  sourcenya tidak ditulis. `worker/`, `src/`, dan fixture tidak berubah.
- Output lama `.local-evaluation/opencode-go-exp-wbs/all-48/` hanya dibaca. Output baru ditulis ke
  `.local-evaluation/opencode-go-exp-provenance/` (git-ignored).
- `expected-results.json` tidak dibaca oleh `audit-wbs-provenance.mjs` atau
  `prototype-cell-aware-split.mjs`. Skor nilai lama dijalankan terpisah ke direktori baru dan
  hanya dipakai sebagai pembanding nilai, bukan identitas.
- `graphify query` dijalankan sebelum eksplorasi source; `graphify update .` dijalankan setelah
  perubahan kode eksperimental. Graph akhir: 3668 nodes, 8784 edges, 153 communities.
- Satu-satunya perubahan tracked yang terlihat di `git status` adalah perubahan yang sudah ada
  sebelum sesi ini (`.gitignore`, `AGENTS.md`, `README.md`); tidak ada diff pada `worker/`, `src/`,
  atau `demo-evidence-fixtures/`.

## Metode dan reproduksi

Pipeline lengkap:

```sh
bash .scratch/opencode-go-experiment/run-provenance-audit.sh
```

Perintah inti:

```sh
node --check .scratch/opencode-go-experiment/audit-wbs-provenance.mjs
node --check .scratch/opencode-go-experiment/prototype-cell-aware-split.mjs
node --check .scratch/opencode-go-experiment/verify-wbs-provenance.mjs
python3 -m py_compile .scratch/opencode-go-experiment/ooxml_reader.py
(cd .scratch/opencode-go-experiment && python3 -m unittest -v test_ooxml_reader.py)

for s in 2026-10-09_w4 2026-10-16_w5 2026-10-23_w6 2026-10-30_w7; do
  python3 .scratch/opencode-go-experiment/ooxml_reader.py \
    --out .local-evaluation/opencode-go-exp-provenance/ooxml/$s \
    demo-evidence-fixtures/smart-building-itb/sessions/$s/*.xlsx
done

node .scratch/opencode-go-experiment/audit-wbs-provenance.mjs \
  --root .local-evaluation/opencode-go-exp-wbs/all-48 \
  --fixtures demo-evidence-fixtures/smart-building-itb/sessions \
  --out .local-evaluation/opencode-go-exp-provenance

node .scratch/opencode-go-experiment/prototype-cell-aware-split.mjs \
  --audit-root .local-evaluation/opencode-go-exp-provenance/audit \
  --ooxml-root .local-evaluation/opencode-go-exp-provenance/ooxml \
  --out .local-evaluation/opencode-go-exp-provenance/prototype

node .scratch/opencode-go-experiment/verify-wbs-provenance.mjs
node .scratch/opencode-go-experiment/verify-wbs-offline.mjs
node .scratch/opencode-go-experiment/verify-v3.mjs
graphify update .
```

Artefak baru:

- `.local-evaluation/opencode-go-exp-provenance/ooxml/<session>/<file>.ooxml.json` — pembacaan
  OOXML independen (sheet, row, cell, raw `<v>`, formula, cache, style, `date1904`).
- `.local-evaluation/opencode-go-exp-provenance/audit/<session>/<file>.audit.json` — audit per
  workbook/row.
- `.local-evaluation/opencode-go-exp-provenance/audit-summary.json` — agregat Jalur B.
- `.local-evaluation/opencode-go-exp-provenance/prototype/<session>/<file>.prototype.json` —
  prototipe Jalur A.
- `.local-evaluation/opencode-go-exp-provenance/prototype/prototype-summary.json` — agregat Jalur A.
- `.local-evaluation/opencode-go-exp-provenance/baseline-smoke/` — runner lama pada 4 sampel W7;
  tidak ada diff dengan output lama.
- `.local-evaluation/opencode-go-exp-provenance/score-wbs-baseline/` — skor nilai lama (expected
  array hanya untuk nilai, bukan identitas).
- `.local-evaluation/opencode-go-exp-provenance/logs/` — log setiap perintah.

Catatan: `diag-provenance.mjs` (dump chunk/header shape) dan `ooxml-smoke/` (smoke output pembaca)
adalah diagnostik tambahan, bukan bagian pipeline yang menentukan hasil. Manifest hash artefak
utama ada di `.local-evaluation/opencode-go-exp-provenance/manifest.json`.

## 1. Audit alur parser dan kontrak

### 1.1 XLSX OOXML → workbook cells

`parseXlsxDocument()` (`document-parser.ts:631`) membaca ZIP/XML, shared strings, number formats,
sheet paths, dan `date1904` (`:640`, `:1105-1152`). `readWorkbookCell()` (`:1175-1200`) menyimpan
`reference`, `value`, `rawValue` (di sini `value` hasil resolusi shared string), formula, number
format, `dateFormat`, dan status cache formula. Formula cache diklasifikasikan di
`classifyFormulaCache()` (`:1204-1255`: `not_formula`, `cached_value`, `cached_empty`,
`missing_cache`, `cached_error`, `unknown`). Tidak ada eksekusi formula. Serial tanggal
dikonversi di `excelSerialToIsoDate()` (`:1091-1103`), termasuk penolakan serial 60 untuk
workbook 1900 dan epoch 1904.

### 1.2 Header/table detection

Tabel dideteksi dari baris berurutan; `headerCount` dinaikkan menjadi 2 hanya jika dua baris
pertama seluruhnya tekstual dan baris ketiga punya sel non-tekstual (`:678-684`). `headers` map
dibangun dari `tableRows.slice(0, headerCount)` (`:686-707`). Untuk data row, `labelText` memakai
`headers.get(column)` jika ada; jika tidak, memakai huruf kolom (`:853-857`).

**Temuan header:** pada layout demoted (contoh 01/02), parser memilih **row 3** (baris header
mingguan S..AF) sebagai header tabel, bukan **row 4** (header WBS A..O). Akibatnya `headers` hanya
terisi untuk S..AF; baris data memakai prefix huruf kolom (`A: 1.1`) dan `rowCells.label` untuk
A..R adalah `null`. Runner eksperimen memilih row 4 secara terpisah lewat `buildHeaderMeta()`,
sehingga nilainya benar, tetapi **parser produksi tidak mengikat label kolom WBS**. Ini terukur:
24/48 workbook punya `header_binding_mismatch` (parser row 3 vs WBS row 4); 24/48 structured
terikat di row 4. Pembaca independen tetap menemukan header row 4 yang tidak ambigu di 48/48
workbook.

### 1.3 Source blocks → rowCells / cellReferences

Untuk setiap data row, parser membangun `sourceCell` per sel (`:897-911`), `modelText` per baris
(`:914`), `text` baris + anotasi (`:917`), `rowCells` (`:918`), dan `cellReferences` per sel
(`:970-979`) di dalam `blocks.push` (`:963-982`). `sourceCell` memuat `sheetName`, `row`, `column`,
`cell`, `label`, `value`, `rawValue`, dan `dateIso` (`:273-282`). Anotasi memuat raw value, number
format, ISO date, dan status cache (`:882-884`), sehingga teks baris 32 kolom menjadi panjang.

### 1.4 Chunking dan cap 120 referensi

`chunkSourceBlocks()` (`:1830-1854`) mengelompokkan per `groupKey`, lalu memberi source ID
`c<chunk>s<index>`. `chunkBlockGroup()` (`:1856-1955`) selalu menambahkan **row reference lebih
dulu** (`:1879-1887`), lalu cell references (`:1888-1900`). Jika
`sourceReferences.length + cellReferences.length > MAX_SOURCE_REFERENCES_PER_CHUNK` (120,
`:373`), blok tersebut melewati penambahan cell references (`:1889-1891`). Row reference tetap ada.
Ini adalah jalur kedua yang dapat menghilangkan per-cell evidence, tetapi **tidak terpicu** untuk
baris WBS di fixture ini: maksimum referensi per chunk baris WBS adalah 51; maksimum chunk mana pun
di 48 workbook adalah 118 (<120).

### 1.5 Guardrail demotion

`splitSourceBlock()` (`:1984-2010`) memotong block yang lebih panjang dari 3100 karakter. Kunci
masalahnya:

```ts
// document-parser.ts:1991-1998
const cellReferences = remaining.length > MAX_SOURCE_BLOCK_PART_LENGTH
  ? undefined
  : block.cellReferences;
const rowCells = remaining.length > MAX_SOURCE_BLOCK_PART_LENGTH
  ? undefined
  : block.rowCells;
```

Untuk baris yang melebihi threshold, **seluruh** `cellReferences` dan `rowCells` dibuang, bukan
hanya sel yang terpotong. `modelText` juga dibuang (`:1988-1990`). Pemotongan berikutnya memakai
spasi terakhir sebelum batas (`:2000-2009`), sehingga satu baris bisa menjadi dua part
(`c6s0`, `c7s0`) tanpa metadata sel. Row reference tetap disimpan; itulah sebabnya output lama
mempunyai `source_ids` row-level yang nyata tetapi `cell_source_id: null`.

### 1.6 Validator konsumen

`sourceReferencesForChunk()` (`document-extraction.ts:1086-1096`) dan
`allowedSourceCitations()` (`:1098-1111`) mengekspos semua source ID, baik row-level maupun
cell-level. `resolveSheetSourceLocations()` (`:1491-1520`) memerlukan `sheetName`, `rowStart`,
`rowEnd`, `cellRangeStart`, dan `cellRangeEnd`; row-level reference memenuhi ini karena range-nya
seluruh baris.

Yang penting: `citedProgressPercentSemanticsError()` (`:1447-1489`) memakai `rowCells`/`cell` jika
ada. Jika hanya ada row-level reference, `sourceCells` menjadi `[]`, `matchingCells` menjadi `[]`,
dan fungsi mengembalikan `null` — artinya **tidak ada error**, bukan berarti bukti per-cell ada.
Sebaliknya `asOfDateError()` (`:2240-2278`) untuk xlsx tanpa `rowCells`/`cell` mengembalikan
"cannot be attributed to a cut-off or period column". Jadi validasi persen tidak simetris dengan
validasi tanggal: row-level citation bisa lolos untuk persen. Ini menjelaskan mengapa output lama
bisa `resolved` untuk 216 baris demoted tanpa per-cell evidence.

### 1.7 Mengapa referensi hilang — bukti terukur

| Template | Workbook | Baris | Panjang teks baris | Part | `rowCells` | Cell refs/baris | `cell_source_id` |
|---|---:|---:|---|---:|---|---:|---:|
| `demoted_row_text` | 24 | 216 | 3872–4190 | 2 | 0 | 0 | 0 |
| `structured_row_cells` | 24 | 192 | 1075–1659 | 1 | 16 | 16 | 192 |

Threshold 3100 terbukti: seluruh 216 baris demoted melebihi threshold; tidak ada baris structured
yang melebihi. Baris demoted selalu terdiri dari 2 part. Baris structured muat dalam satu part dan
mempertahankan 16 sel non-kosong (bukan 32; sel kosong difilter di `:666`).

### 1.8 Warning parser

Parser menghasilkan 30–264 warning per workbook (26–46 chunk per workbook). Warning ini
diagnostik ambiguitas tabel/cache; audit **tidak** memakai warning sebagai bukti aman. Tidak ada
warning yang diubah menjadi `found` atau menjadi per-cell evidence.

## 2. Empat sampel W7

| File | Template | Parser header row | WBS header row (independen) | Row 5 text | Part | `rowCells` row 5 | Cell refs row 5 | Label A..R |
|---|---|---:|---:|---:|---:|---:|---:|---|
| `01_Alarm_Kebencanaan...` | demoted | 3 | 4 | 4025 | 2 | 0 | 0 | `null` |
| `02_Kamera_Pengawasan...` | demoted | 3 | 4 | 3935 | 2 | 0 | 0 | `null` |
| `05_Pencahayaan...` | structured | 4 | 4 | 1540 | 1 | 16 | 16 | terikat |
| `07_Air_Bersih...` | structured | 4 | 4 | 1527 | 1 | 16 | 16 | terikat |

Pada 01/02, row 4 (header WBS) diperlakukan parser sebagai data row; `rowCells` row 4 berisi 32
sel tetapi label A..R `null` dan label S..AF adalah `W1..W14`. Pembaca independen menemukan header
row 4 yang tidak ambigu, tetapi parser produksi tidak mengikatnya. Pada 05/07, header row 4
terikat dan baris data memakai label (`WBS: 1.1`, `% Complete: ...`).

## 3. Jalur B — evaluasi konservatif

### 3.1 Formula penerimaan

Sebuah field hanya `per_cell_proven` jika **semua** kondisi berikut benar:

1. `workbook.sha256` sama untuk output lama, fixture, dan pembacaan OOXML.
2. `sheetName`, `row`, `column`, dan `cell` dari source ID sama dengan sel yang diharapkan.
3. `sourceLocation.cellRangeStart = sourceLocation.cellRangeEnd = cell` (bukan range baris).
4. Header row 4 tidak ambigu: tepat satu kolom per peran, tidak ada merge yang menutupi kolom,
   dan kolom persen bukan metrik risk/likelihood/rating.
5. `cell.label` parser terikat dan sama dengan label header independen.
6. Sel independen ada; `rawValue` parser sama dengan nilai OOXML; untuk formula, cache harus
   `cached_value` dan `cache_raw` sama.
7. Nilai independen sama dengan nilai klaim (tanggal dinormalisasi ke ISO; raw value tetap dicatat).
8. Sel persen memakai format persen yang terbukti (bukan teks/raw yang ditafsirkan).
9. Cross-check K (jika ada) berbentuk `IF(J<row>="",0,I<row>*J<row>)`, cache `cached_value`, dan
   sama dengan `I*J`.

Verdict baris:

- `per_cell_proven` = code, percent, deliverable, dan baseline finish semuanya per-cell proven.
- `review_row_level` = ada field yang hanya punya row reference.
- `review_inconsistent` = ada mismatch identitas/nilai/cache.
- `review_period_scope` = cut-off independen berbeda dari cut-off output.

Kolom Milestone (O) dicatat `unbound_no_citation` untuk semua 408 baris karena output lama tidak
menyimpan source ID untuk kolom O; nilainya dicocokkan tetapi tidak dihitung sebagai per-cell.

### 3.2 Hasil per template

| Template | Workbook | Baris | Per-cell proven | Review row-level | Inconsistent | False-accept (n) |
|---|---:|---:|---:|---:|---:|---:|
| `demoted_row_text` | 24 | 216 | 0 | 216 | 0 | 216 |
| `structured_row_cells` | 24 | 192 | 192 | 0 | 0 | 0 |
| **Total** | **48** | **408** | **192** | **216** | **0** | **216** |

Tidak ada `review_inconsistent` pada run final: nilai semua 408 baris konsisten dengan pembacaan
independen. Tidak ada verdict `unknown`; 48/48 workbook berhasil diparse; 0 baris hilang. Perbedaan
utama adalah **level provenance**, bukan nilai.

### 3.3 Hasil per sesi

| Sesi | Workbook | Baris | Per-cell proven | Review row-level | Inconsistent | False-accept (n) |
|---|---:|---:|---:|---:|---:|---:|
| 2026-10-09_w4 | 12 | 102 | 48 | 54 | 0 | 54 |
| 2026-10-16_w5 | 12 | 102 | 48 | 54 | 0 | 54 |
| 2026-10-23_w6 | 12 | 102 | 48 | 54 | 0 | 54 |
| 2026-10-30_w7 | 12 | 102 | 48 | 54 | 0 | 54 |

### 3.4 Hasil per field

| Field | Per-cell proven | Review row-level | Inconsistent | Unbound |
|---|---:|---:|---:|---:|
| code | 192 | 216 | 0 | 0 |
| percent | 192 | 216 | 0 | 0 |
| deliverable | 192 | 216 | 0 | 0 |
| baseline_finish | 192 | 216 | 0 | 0 |
| milestone (O) | 0 | 0 | 0 | 408 |

### 3.5 False accept dan definisi skor lama

Skor lama `.scratch/opencode-go-experiment/score-wbs-offline.mjs` melaporkan
**408/408 provenance_valid**, tetapi definisinya adalah:

```js
// score-wbs-offline.mjs:82-84, 124-129
function validSourceId(value) {
  return typeof value === "string" && /^c\d+s\d+$/.test(value);
}
const cellOk =
  row?.percent?.provenance_level === "row_and_cell_reference"
    ? validSourceId(row.percent.cell_source_id)
    : true;
const provenanceValid = found && sourceIds.length > 0
  && sourceIds.every(validSourceId) && cellOk;
```

Untuk baris demoted (`row_text`), `cellOk` bernilai `true` tanpa memerlukan `cell_source_id`.
Jadi 408/408 hanya berarti "ada source ID berformat benar", bukan "ada bukti per-cell". Audit ini
menghitung **216** baris yang status lama `resolved` tetapi tidak punya per-cell evidence sebagai
false accept. Skor nilai lama tetap 408/408 value match; angka itu tidak berubah dan tidak
dipakai sebagai bukti identitas/provenance.

### 3.6 Cross-check independen

- **Hash:** 48/48 output lama, fixture, dan pembacaan OOXML memiliki SHA-256 yang sama.
- **Header:** 48/48 header row 4 independen tidak ambigu; 24/48 punya `header_binding_mismatch`
  parser (demoted). 0 merge yang menutupi kolom wajib; tidak ada header persen ganda.
- **Periode:** cut-off independen ditemukan dan sama dengan output lama di 48/48; 0 mismatch,
  0 unverified.
- **Tanggal:** `date1904` false di 48/48. Empat baris `12_BISMA` menyimpan
  `2026-09-25 0:00:00`; dinormalisasi ke `2026-09-25` dengan raw value tetap tercatat. Tidak ada
  perbedaan hari/bulan/tahun.
- **Nilai 0 vs kosong:** 288 baris bernilai 0 valid (157 demoted, 131 structured); 0 sel kosong
  yang diklaim sebagai 0. Tidak ada blank yang diubah menjadi nol.
- **Formula/cache:** tidak ada sel J yang berupa formula (408 literal). Semua 408 sel K memiliki
  formula `IF(J<row>="",0,I<row>*J<row>)` dengan `cached_value` dan cocok dengan `I*J`. Tidak ada
  evaluasi formula tak dikenal dan tidak ada klaim kesegaran cache.
- **Nilai persen:** semua 192 sel structured berformat persen dan nilainya sama dengan klaim;
  semua 216 baris demoted juga nilainya sama dengan sel J independen, meskipun provenance-nya
  row-level.
- **Error nilai:** 0 mismatch nilai persen, 0 mismatch tanggal, 0 mismatch cache K, 0 period
  mismatch, 0 baris tanpa sel independen. Dengan kata lain, audit tidak menemukan kesalahan nilai;
  yang ditemukan adalah ketiadaan bukti per-cell pada 216 baris.

**Jenis nilai yang dibedakan.** A/D/G/I/J/O adalah nilai source tertulis (J literal, bukan
formula). K adalah formula cache `cached_value` yang dibaca dari `<v>` tanpa dieksekusi. Composite
`next_milestone` pada output lama adalah nilai **derived**; audit ini tidak memakainya sebagai
bukti literal/per-cell. Kolom yang diaudit untuk milestone adalah kolom O literal, dan kolom O
tetap `unbound_no_citation` karena output lama tidak menyimpan source ID untuk kolom itu.

## 4. Jalur A — prototipe terisolasi

### 4.1 Desain dan guardrail

Prototipe `prototype-cell-aware-split.mjs` memakai:

- **Teks baris produksi** yang benar-benar dipancarkan parser (bukan rekonstruksi teks dari nol).
- **Identitas sel independen** dari `ooxml_reader.py` (sheet, row, column, cell, raw value,
  formula/cache, format).
- Pemetaan token `${column}: ${rendered}` atau `${headerLabel}: ${rendered}` ke span teks baris;
  hanya token yang muncul tepat satu kali yang dipakai.

Split cell-aware memotong pada batas `" | "` (fallback spasi, lalu hard limit) dan hanya
memberikan referensi sel kepada part yang **memuat seluruh span sel**. Jika span melewati batas
part, sel tersebut **tidak** mendapat referensi (fail-closed). Part tetap ≤3100 karakter. Tidak
ada source ID produksi yang dibuat: semua identitas berprefix `proto:<sha8>:<sheet>:<cell>` dan
`production_source_id` selalu `null`. Parser produksi tidak diubah.

### 4.2 Hasil

| Template | Baris | Feasible | Not feasible | Sel wajib | Sel terpetakan |
|---|---:|---:|---:|---:|---:|
| `demoted_row_text` | 216 | 216 | 0 | 1296 | 1296 |
| `structured_row_cells` | 192 | 192 | 0 | 1152 | 1152 |
| **Total** | **408** | **408** | **0** | **2448** | **2448** |

- 0 token tidak ditemukan, 0 token ambigu, 0 span terpotong antar-part.
- Maksimum part per baris: 2. Maksimum panjang part: **2688** karakter (≤3100).
- Pada 216 baris demoted, produksi memberi 0 referensi sel; prototipe memetakan 6/6 sel wajib
  (A, D, G, I, J, O) ke part yang memuatnya.
- Pada 192 baris structured, produksi sudah memberi 16 cell refs/baris; prototipe memetakan 6/6
  sel wajib tanpa regresi.

### 4.3 Feasibility per template

- **Structured (`structured_row_cells`):** Jalur A **sudah** menjadi perilaku produksi untuk baris
  ini (teks 1075–1659 < 3100; 192/192 per-cell proven). Tidak perlu perubahan parser untuk
  fixture ini.
- **Demoted (`demoted_row_text`):** Jalur A **feasible sebagai prototipe** untuk 216/216 baris.
  Informasi sel cukup untuk mempertahankan identitas per-cell tanpa melemahkan guardrail.
  Namun ini **belum production provenance**.

### 4.4 Blocker produksi Jalur A

1. **Perubahan parser diperlukan.** `splitSourceBlock()` harus mempertahankan `rowCells`/
   `cellReferences` per part (hanya sel yang seluruh teksnya ada di part tersebut). Ini perubahan
   produksi; dalam audit ini tidak diizinkan dan tidak dilakukan. `PARSER_VERSION` harus di-bump
   dari `document-parser/18` agar cache group lama tidak dipakai ulang.
2. **Header binding masih salah untuk layout demoted.** 24/48 workbook memilih parser header row 3,
   bukan WBS header row 4. `rowCells.label` untuk A..R akan tetap `null`; consumer yang memakai
   label (mis. `citedProgressPercentSemanticsError`) tidak akan bisa membuktikan kolom dari label
   parser. Perlu perbaikan deteksi header atau binding header eksplisit. Pembaca independen
   membuktikan header row 4 tidak ambigu, tetapi itu bukan bukti bahwa parser sudah mengikatnya.
3. **Validator konsumen belum diuji end-to-end.** Audit mensimulasikan formula penerimaan
   struktural; ia tidak menjalankan `validateGroupExtraction()`/`validateSheetInterpretation()`
   produksi terhadap ref prototipe. Klaim "validator produksi akan menerima" belum diuji.
4. **Cap 120 referensi per chunk masih laten.** Tidak terpicu di fixture ini (maksimum baris WBS
   51; maksimum global 118), tetapi implementasi cell-aware harus tetap menangani cap secara
   fail-closed untuk chunk dengan banyak baris.
5. **Tidak ada otorisasi produksi.** Tidak ada perubahan `worker/`, `src/`, fixture, atau output
   lama; tidak ada commit.

## 5. Uji negatif dan fail-closed

### 5.1 Suite baru `verify-wbs-provenance.mjs` — 44/44 lulus

Mencakup outcome yang terlihat, bukan wiring:

- header valid, header persen ganda, header persen hilang, merge header, header WBS ganda;
- source ID menunjuk kolom/sheet/row/lokasi yang salah; range baris bukan sel;
- row-level percent tidak pernah menjadi `per_cell_proven`;
- template demoted dengan `cell_source_id` tetap review;
- kolom persen/weight tertukar: sitasi ke kolom lama ditolak;
- sel kosong yang diklaim 0 → review; 0 tersimpan → valid zero;
- sel persen tanpa format persen → review;
- formula cache kosong/error/tidak dikenal → review, bukan nol;
- cache K bertentangan dengan `I*J` → review;
- period mismatch → `review_period_scope`;
- duplicate WBS → review; claim guard tidak dapat menaikkan review menjadi found;
- cell-aware split: part ≤ limit, span yang melewati batas tidak mendapat assignment;
- token tidak ditemukan/ambigu; `proto:` identity dan `production_source_id: null`;
- prototipe gagal-closed ketika token tidak muat dalam satu part.

### 5.2 Unit test pembaca independen — 14/14 lulus

`test_ooxml_reader.py` menguji:

- serial 1900 (termasuk serial 60 invalid), epoch 1904, serial negatif/non-numerik;
- format persen (`0%`, `0.00%`, multi-section, quoted `%`, negative section tidak dianggap proven);
- format tanggal (`yyyy-mm-dd`, `dd\-mmm\-yyyy`, `m/d/yy`, bukan persen);
- cache formula: `not_formula`, `missing_cache`, `cached_empty`, `cached_error`, `cached_value`,
  tipe tidak dikenal;
- konversi kolom A/Z/AA/AF.

### 5.3 Baseline lama

- `verify-wbs-offline.mjs`: **21/21** lulus.
- `verify-v3.mjs`: **50/50** lulus.

## 6. Regresi dan reproduksibilitas

- Runner lama pada 4 sampel W7 ke root baru: **0 diff** pada template, jumlah baris, kode, nilai
  persen, `cell_source_id`, dan `next_milestone` dibanding output lama.
- Skor nilai lama ke root baru: **408/408 value match**, 48/48 milestone value match. Seperti
  dijelaskan di §3.5, `provenance_valid` 408/408 adalah cek regex source ID, bukan per-cell.
- Audit baru: 192/408 per-cell proven; 216/408 review row-level; 216 false accept.
- Prototipe baru: 408/408 feasible; 2448/2448 sel wajib terpetakan.
- `graphify update .`: 3668 nodes, 8784 edges, 153 communities.
- Log perintah tersimpan di `.local-evaluation/opencode-go-exp-provenance/logs/`.

## 7. Gap dan blocker terhadap klaim produksi

1. **Tidak ada ground truth bisnis independen.** Pembaca OOXML independen memverifikasi lokasi dan
   nilai dari file yang sama; ia tidak membuktikan bahwa nilai itu benar secara bisnis, lengkap,
   atau disetujui. Fixture pack dibuat oleh generator yang sama dengan `expected-results.json`.
2. **Identitas WBS tidak dibuktikan dari array expected.** Audit/prototipe tidak membaca array
   expected; pencocokan baris memakai sheet/row/column dan kode A. Namun tidak ada pengenal WBS
   eksternal independen; kode WBS tetap berasal dari workbook yang sama.
3. **Per-cell evidence produksi tidak ada untuk 216/408 baris.** Hanya 192 baris structured yang
   per-cell proven. Baris demoted harus `review` dalam keputusan B.
4. **Header binding parser salah di 24 workbook demoted.** Ini blocker produksi Jalur A yang
   terpisah dari `splitSourceBlock`.
5. **Validator konsumen tidak diuji end-to-end dengan ref prototipe.** Formula penerimaan audit
   bersifat struktural; belum ada uji `validateGroupExtraction()` penuh.
6. **Kesegaran cache tidak dibuktikan.** Yang dibuktikan hanya bentuk formula, status
   `cached_value`, dan konsistensi cache dengan `I*J`. Tidak ada rekalkulasi Excel.
7. **Tidak ada uji LLM/provider.** Tidak ada panggilan model; ekstraksi model tidak dinilai.
8. **Cakupan field terbatas.** Audit fokus pada code, percent, deliverable, baseline finish, dan
   milestone O. Field lain (RAG, dependency, forecast finish, rollup project, risk, cost) tidak
   diaudit.
9. **Cap 120 referensi laten.** Tidak terpicu di fixture ini, tetapi belum diuji pada workbook
   dengan chunk yang lebih padat.
10. **Tidak ada perubahan produksi.** Semua temuan adalah audit/eksperimen; belum ada implementasi
    yang disetujui.

## 8. Keputusan

- **Untuk penggunaan sekarang, gunakan Jalur B.** 192/192 baris structured dapat diklaim per-cell
  dengan bukti yang diaudit; 216/216 baris demoted harus `review` dengan row reference nyata dan
  **tidak** boleh diklaim `found`/per-cell. Jangan memakai angka lama 408/408
  `provenance_valid` sebagai bukti per-cell.
- **Jalur A layak dilanjutkan sebagai prototipe**, tetapi belum boleh dipromosikan tanpa:
  (a) perubahan `splitSourceBlock` yang cell-aware + bump `PARSER_VERSION`,
  (b) perbaikan/binding header row 4 untuk 24 workbook demoted,
  (c) uji end-to-end validator konsumen dengan ref prototipe,
  (d) uji cap 120 pada chunk padat,
  (e) persetujuan perubahan produksi.
- **Jangan klaim** akurasi bisnis, kelengkapan WBS, kesegaran cache, atau identitas WBS
  independen dari cross-check ini.

## Lampiran A — pembilang/penyebut per workbook

| Sesi | Komponen | Template | Baris | Per-cell proven | Review row-level | Inconsistent | False-accept (n) | Hash | Header bind |
|---|---|---|---:|---:|---:|---:|---:|---|---|
| 2026-10-09_w4 | 01_Alarm_Kebencanaan | demoted_row_text | 10 | 0 | 10 | 0 | 10 | ok | parser row 3 vs WBS row 4 |
| 2026-10-09_w4 | 02_Kamera_Pengawasan | demoted_row_text | 8 | 0 | 8 | 0 | 8 | ok | parser row 3 vs WBS row 4 |
| 2026-10-09_w4 | 03_Kontrol_Akses | demoted_row_text | 8 | 0 | 8 | 0 | 8 | ok | parser row 3 vs WBS row 4 |
| 2026-10-09_w4 | 04_Kelistrikan | demoted_row_text | 9 | 0 | 9 | 0 | 9 | ok | parser row 3 vs WBS row 4 |
| 2026-10-09_w4 | 05_Pencahayaan | structured_row_cells | 8 | 8 | 0 | 0 | 0 | ok | bound |
| 2026-10-09_w4 | 06_Pengkondisian_Udara | demoted_row_text | 9 | 0 | 9 | 0 | 9 | ok | parser row 3 vs WBS row 4 |
| 2026-10-09_w4 | 07_Air_Bersih | structured_row_cells | 8 | 8 | 0 | 0 | 0 | ok | bound |
| 2026-10-09_w4 | 08_Air_Limbah | structured_row_cells | 8 | 8 | 0 | 0 | 0 | ok | bound |
| 2026-10-09_w4 | 09_Pengelolaan_Sampah | demoted_row_text | 10 | 0 | 10 | 0 | 10 | ok | parser row 3 vs WBS row 4 |
| 2026-10-09_w4 | 10_Ventilasi | structured_row_cells | 8 | 8 | 0 | 0 | 0 | ok | bound |
| 2026-10-09_w4 | 11_Pengelolaan_Utilitas | structured_row_cells | 8 | 8 | 0 | 0 | 0 | ok | bound |
| 2026-10-09_w4 | 12_BISMA | structured_row_cells | 8 | 8 | 0 | 0 | 0 | ok | bound |
| 2026-10-16_w5 | 01_Alarm_Kebencanaan | demoted_row_text | 10 | 0 | 10 | 0 | 10 | ok | parser row 3 vs WBS row 4 |
| 2026-10-16_w5 | 02_Kamera_Pengawasan | demoted_row_text | 8 | 0 | 8 | 0 | 8 | ok | parser row 3 vs WBS row 4 |
| 2026-10-16_w5 | 03_Kontrol_Akses | demoted_row_text | 8 | 0 | 8 | 0 | 8 | ok | parser row 3 vs WBS row 4 |
| 2026-10-16_w5 | 04_Kelistrikan | demoted_row_text | 9 | 0 | 9 | 0 | 9 | ok | parser row 3 vs WBS row 4 |
| 2026-10-16_w5 | 05_Pencahayaan | structured_row_cells | 8 | 8 | 0 | 0 | 0 | ok | bound |
| 2026-10-16_w5 | 06_Pengkondisian_Udara | demoted_row_text | 9 | 0 | 9 | 0 | 9 | ok | parser row 3 vs WBS row 4 |
| 2026-10-16_w5 | 07_Air_Bersih | structured_row_cells | 8 | 8 | 0 | 0 | 0 | ok | bound |
| 2026-10-16_w5 | 08_Air_Limbah | structured_row_cells | 8 | 8 | 0 | 0 | 0 | ok | bound |
| 2026-10-16_w5 | 09_Pengelolaan_Sampah | demoted_row_text | 10 | 0 | 10 | 0 | 10 | ok | parser row 3 vs WBS row 4 |
| 2026-10-16_w5 | 10_Ventilasi | structured_row_cells | 8 | 8 | 0 | 0 | 0 | ok | bound |
| 2026-10-16_w5 | 11_Pengelolaan_Utilitas | structured_row_cells | 8 | 8 | 0 | 0 | 0 | ok | bound |
| 2026-10-16_w5 | 12_BISMA | structured_row_cells | 8 | 8 | 0 | 0 | 0 | ok | bound |
| 2026-10-23_w6 | 01_Alarm_Kebencanaan | demoted_row_text | 10 | 0 | 10 | 0 | 10 | ok | parser row 3 vs WBS row 4 |
| 2026-10-23_w6 | 02_Kamera_Pengawasan | demoted_row_text | 8 | 0 | 8 | 0 | 8 | ok | parser row 3 vs WBS row 4 |
| 2026-10-23_w6 | 03_Kontrol_Akses | demoted_row_text | 8 | 0 | 8 | 0 | 8 | ok | parser row 3 vs WBS row 4 |
| 2026-10-23_w6 | 04_Kelistrikan | demoted_row_text | 9 | 0 | 9 | 0 | 9 | ok | parser row 3 vs WBS row 4 |
| 2026-10-23_w6 | 05_Pencahayaan | structured_row_cells | 8 | 8 | 0 | 0 | 0 | ok | bound |
| 2026-10-23_w6 | 06_Pengkondisian_Udara | demoted_row_text | 9 | 0 | 9 | 0 | 9 | ok | parser row 3 vs WBS row 4 |
| 2026-10-23_w6 | 07_Air_Bersih | structured_row_cells | 8 | 8 | 0 | 0 | 0 | ok | bound |
| 2026-10-23_w6 | 08_Air_Limbah | structured_row_cells | 8 | 8 | 0 | 0 | 0 | ok | bound |
| 2026-10-23_w6 | 09_Pengelolaan_Sampah | demoted_row_text | 10 | 0 | 10 | 0 | 10 | ok | parser row 3 vs WBS row 4 |
| 2026-10-23_w6 | 10_Ventilasi | structured_row_cells | 8 | 8 | 0 | 0 | 0 | ok | bound |
| 2026-10-23_w6 | 11_Pengelolaan_Utilitas | structured_row_cells | 8 | 8 | 0 | 0 | 0 | ok | bound |
| 2026-10-23_w6 | 12_BISMA | structured_row_cells | 8 | 8 | 0 | 0 | 0 | ok | bound |
| 2026-10-30_w7 | 01_Alarm_Kebencanaan | demoted_row_text | 10 | 0 | 10 | 0 | 10 | ok | parser row 3 vs WBS row 4 |
| 2026-10-30_w7 | 02_Kamera_Pengawasan | demoted_row_text | 8 | 0 | 8 | 0 | 8 | ok | parser row 3 vs WBS row 4 |
| 2026-10-30_w7 | 03_Kontrol_Akses | demoted_row_text | 8 | 0 | 8 | 0 | 8 | ok | parser row 3 vs WBS row 4 |
| 2026-10-30_w7 | 04_Kelistrikan | demoted_row_text | 9 | 0 | 9 | 0 | 9 | ok | parser row 3 vs WBS row 4 |
| 2026-10-30_w7 | 05_Pencahayaan | structured_row_cells | 8 | 8 | 0 | 0 | 0 | ok | bound |
| 2026-10-30_w7 | 06_Pengkondisian_Udara | demoted_row_text | 9 | 0 | 9 | 0 | 9 | ok | parser row 3 vs WBS row 4 |
| 2026-10-30_w7 | 07_Air_Bersih | structured_row_cells | 8 | 8 | 0 | 0 | 0 | ok | bound |
| 2026-10-30_w7 | 08_Air_Limbah | structured_row_cells | 8 | 8 | 0 | 0 | 0 | ok | bound |
| 2026-10-30_w7 | 09_Pengelolaan_Sampah | demoted_row_text | 10 | 0 | 10 | 0 | 10 | ok | parser row 3 vs WBS row 4 |
| 2026-10-30_w7 | 10_Ventilasi | structured_row_cells | 8 | 8 | 0 | 0 | 0 | ok | bound |
| 2026-10-30_w7 | 11_Pengelolaan_Utilitas | structured_row_cells | 8 | 8 | 0 | 0 | 0 | ok | bound |
| 2026-10-30_w7 | 12_BISMA | structured_row_cells | 8 | 8 | 0 | 0 | 0 | ok | bound |

## Lampiran B — non-claim eksplisit

- Bukan ground truth bisnis independen; pembaca OOXML memeriksa file yang sama.
- Bukan bukti kelengkapan WBS, akurasi nama work package, atau kesegaran cache.
- Bukan bukti identitas WBS lewat `expected-results.json`; array expected tidak dipakai untuk
  identitas.
- Bukan evaluasi ekstraksi LLM/provider; tidak ada model yang dipanggil.
- Bukan perubahan produksi; tidak ada `worker/`, `src/`, fixture, atau output lama yang diubah.
- Bukan klaim bahwa `proto:` identity adalah source ID produksi.
- Bukan klaim bahwa seluruh 48 workbook mewakili dokumen dunia nyata; ini fixture pack yang dibuat
  generator yang sama dengan expected.
