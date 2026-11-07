# Laporan validasi offline pasca perbaikan

## 0. Status eksekusi dan batas

- Repo: `/Users/iweng/Documents/GitHub/DevXassurance`; branch `development-bismillah-final`; commit `784a04d`.
- Parser produksi saat eksekusi: `document-parser/19`.
- Output baru: `.local-evaluation/opencode-go-exp-post-remediation/` (direktori baru; output eksperimen lama tidak ditulis ulang).
- Laporan ini: `.scratch/opencode-go-experiment/report-post-remediation-validation.md`.
- Runner/analisis baru: `.scratch/opencode-go-experiment/post-remediation-independent-audit.py` dan `.scratch/opencode-go-experiment/cost-production-parser-probe.mjs`.
- `/tmp/xlsx-robustness/deterministic.mjs` dan direktori `/tmp/xlsx-robustness/` sudah tidak ada; harness yang tersedia di repo dipakai ulang.

Batas yang dipatuhi:

- Tidak membaca `.env*`, API key, auth store, atau kredensial.
- Tidak ada request provider/model dari aplikasi yang diuji. `evidence-v2.mjs --dry-run` dan smoke memakai `fetch` mock lokal; tidak ada model nyata yang dipanggil. Inference CommandCode untuk sesi ini terpisah dari aplikasi yang diuji.
- Tidak menyentuh database eksternal/production dan tidak menjalankan tes database.
- Tidak mengubah kode produksi, tes, fixture, workbook, `expected-results.json`, atau output eksperimen lama.
- Tidak menjalankan ulang suite kegagalan. 20 kegagalan dibaca dari log yang sudah ada sesuai instruksi.
- Tidak melakukan install, commit, push, reset, atau operasi destruktif.
- Perubahan pengguna yang sudah ada dipertahankan. `git status --porcelain` dan `git diff --stat` sebelum/sesudah identik; hash 68 fixture sebelum/sesudah identik (`diff` exit 0).

## 1. Pemisahan jalur produksi dan harness eksperimental

Ini penting agar angka tidak diklaim setara:

| Bukti | Yang benar-benar dijalankan | Bukan |
|---|---|---|
| C 48 workbook (`evidence-v2.mjs --variant C --dry-run`) | `parseDocumentBuffer()` produksi + `deterministicExtract()` eksperimental dari harness | Bukan `extractDocumentGroups()` produksi; bukan model/provider |
| WBS/milestone 48 (`wbs-milestone-offline.mjs`) | `parseDocumentBuffer()` produksi + logika baris/WBS eksperimental | Bukan validator produksi; `next_milestone` adalah nilai turunan |
| Smoke 2 workbook (`smoke-two-workbooks.mjs`) | `parseDocumentBuffer()` + `extractDocumentGroups()` produksi dengan respons fetch mock deterministik | Bukan model nyata; bukan bukti kualitas ekstraksi model |
| Audit OOXML independen | Pembaca Python stdlib atas sel workbook; tidak mengeksekusi formula | Bukan output parser/validator produksi |
| Probe cost parser | `parseDocumentBuffer()` produksi saja | Bukan cost-observation validator produksi |

Semua skor terhadap `expected-results.json` adalah **konsistensi terhadap fixture yang dibuat generator yang sama**, bukan ground truth independen atau human-reviewed holdout. Yang independen adalah pembacaan langsung sel OOXML; yang tidak independen adalah asal `expected-results.json`.

Denominator utama:

- 48 workbook = 4 sesi × 12 komponen.
- 408 baris WBS.
- 48 milestone komponen.
- 288 field C = 48 × 6 field.

## 2. Progress 48 workbook

### 2.1 Jalur deterministik C: 6 field per workbook

Perintah dan output:

```sh
for s in 2026-10-09_w4 2026-10-16_w5 2026-10-23_w6 2026-10-30_w7; do
  node .scratch/opencode-go-experiment/evidence-v2.mjs --variant C --dry-run \
    --out .local-evaluation/opencode-go-exp-post-remediation/c48/$s \
    demo-evidence-fixtures/smart-building-itb/sessions/$s/*.xlsx
done
V3_ROOT=.local-evaluation/opencode-go-exp-post-remediation/c48 \
  node .scratch/opencode-go-experiment/score-v3.mjs
```

Hasil nyata:

| Field | Nilai cocok | Provenance valid | Nilai + provenance | Found | Unknown | Review/ambiguous | False accept | Denominator |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `cutoff_date` | 48/48 | 48/48 | 48/48 | 48 | 0 | 0 | 0 | 48 |
| `planned_percent` | 48/48 | 48/48 | 48/48 | 48 | 0 | 0 | 0 | 48 |
| `actual_percent` | 48/48 | 48/48 | 48/48 | 48 | 0 | 0 | 0 | 48 |
| `variance_percent` | 48/48 | 48/48 | 48/48 | 48 | 0 | 0 | 0 | 48 |
| `rag` | 48/48 | 48/48 | 48/48 | 48 | 0 | 0 | 0 | 48 |
| `open_risk_ids` | 44/48 | 44/48 | 44/48 | 44 | 4 | 0 | 0 | 48 |
| **Total** | **284/288** | **284/288** | **284/288** | **284** | **4** | **0** | **0** | **288** |

- `risk_entries`: 44 resolved, 44 structural valid, 44 candidate-complete; 4 `unknown`.
- Origin variance: 48 `cached_formula`; RAG: 48 `cached_formula`; 96/96 formula cache memiliki `rule_matched: true`; 48/48 RAG punya `recomputed_from_dependency` yang setuju.
- Tidak ada model yang dipanggil: 4 sesi × 12 file, `requests=0`, `retry_count=0`, `files_failed=0`, usage `reported:false`.

Empat `unknown` (fail-closed, bukan nilai salah dan bukan daftar kosong):

| Sesi | Komponen | File | Field | Expected | Got | Alasan |
|---|---|---|---|---|---|---|
| `2026-10-09_w4` | SB01 | `01_Alarm_Kebencanaan_Subcontractor_Weekly.xlsx` | `open_risk_ids` | `[]` | `null` | indeks deterministik tidak menemukan baris risiko; kelengkapan log tidak terbukti |
| `2026-10-09_w4` | SB02 | `02_Kamera_Pengawasan_Subcontractor_Weekly.xlsx` | `open_risk_ids` | `[]` | `null` | sama |
| `2026-10-09_w4` | SB04 | `04_Kelistrikan_Subcontractor_Weekly.xlsx` | `open_risk_ids` | `[]` | `null` | sama |
| `2026-10-09_w4` | SB06 | `09_Pengelolaan_Sampah_Subcontractor_Weekly.xlsx` | `open_risk_ids` | `[]` | `null` | sama |

Bukti: `.local-evaluation/opencode-go-exp-post-remediation/c48/score-v3.json` dan `score-v3.md`.

### 2.2 WBS per baris dan milestone

```sh
for s in 2026-10-09_w4 2026-10-16_w5 2026-10-23_w6 2026-10-30_w7; do
  node .scratch/opencode-go-experiment/wbs-milestone-offline.mjs \
    --out .local-evaluation/opencode-go-exp-post-remediation/wbs/all-48/$s --session $s \
    demo-evidence-fixtures/smart-building-itb/sessions/$s/*.xlsx
done
node .scratch/opencode-go-experiment/score-wbs-offline.mjs \
  --root .local-evaluation/opencode-go-exp-post-remediation/wbs/all-48 \
  --out .local-evaluation/opencode-go-exp-post-remediation/wbs
```

| Cakupan | WBS nilai | WBS found+provenance (skorer lama) | Milestone komposit | Review/unknown/false accept |
|---|---:|---:|---:|---:|
| Development (W7 SB02 + SB07) | 16/16 | 16/16 | 2/2 | 0/0/0 |
| Holdout (W7 SB01 + SB08) | 18/18 | 18/18 | 2/2 | 0/0/0 |
| **Semua 48** | **408/408** | **408/408** | **48/48** | **0/0/0** |

- Semua 48 komponen kini terbaca sebagai `structured_row_cells` (sebelum perbaikan: 24 `demoted_row_text` / 216 baris row-level).
- `array_order_ok`: 408/408; `date_match`, `code_match`, `label_match`: 48/48.
- Per sesi: 102/102 WBS dan 12/12 milestone pada masing-masing W4–W7.
- `provenance_valid` di skorer lama hanya memeriksa format/source ID, bukan bukti per-cell. Lihat §2.4.
- `next_milestone` adalah **nilai turunan** dari kode WBS, Deliverable, Baseline Finish, dan `% Complete`, bukan sel literal; skorer memberi label `derived: true`.

Bukti: `.local-evaluation/opencode-go-exp-post-remediation/wbs/score-wbs.json` dan `score-wbs.md`.

### 2.3 Audit metrik independen dari sel OOXML

Skrip baru membaca hanya JSON `ooxml_reader.py` (Python stdlib, tanpa eksekusi formula) dan `expected-results.json` secara terpisah. Untuk baris Weekly dipilih berdasarkan `Reporting Cut-off` di PM Summary, bukan berdasarkan nomor sesi expected.

```sh
python3 .scratch/opencode-go-experiment/post-remediation-independent-audit.py \
  --ooxml-root .local-evaluation/opencode-go-exp-post-remediation/provenance/ooxml \
  --expected demo-evidence-fixtures/smart-building-itb/expected-results.json \
  --out .local-evaluation/opencode-go-exp-post-remediation/provenance \
  --sessions 2026-10-09_w4 2026-10-16_w5 2026-10-23_w6 2026-10-30_w7
```

Toleransi numerik `0.00005` (fraksi); RAG/teks/himpunan ID exact.

| Metrik | Hasil | Mismatch | Unsupported | Sumber |
|---|---:|---:|---:|---|
| Cut-off | 48/48 | 0 | 0 | PM Summary `B5` vs `session.cut_off` |
| Planned | 48/48 | 0 | 0 | Weekly Report `C` pada baris cut-off |
| Actual | 48/48 | 0 | 0 | Weekly Report `D` pada baris cut-off |
| Variance | 48/48 | 0 | 0 | Weekly Report `E` (literal/cache) |
| RAG | 48/48 | 0 | 0 | Weekly Report `F` (literal/cache) |
| Overall progress | 48/48 | 0 | 0 | PM Summary `B6` |
| Weighted progress `Σ(I×J)` | 48/48 | 0 | 0 | Workplan `I` dan `J` per baris WBS |
| Next milestone | 48/48 | 0 | 0 | PM Summary `B8` |
| Open risk set | 48/48 | 0 | 0 | Issue Risk & Change, kolom `ID`/`Status` |
| Risk new set | 36/36 | 0 | 12 | delta open set antar sesi |
| Risk closed set | 36/36 | 0 | 12 | delta open set antar sesi |
| Risk priority changed | 36/36 | 0 | 12 | delta Priority antar sesi |
| Project rollup (rata-rata actual) | 4/4 | 0 | 0 | rata-rata 12 komponen per sesi |
| **Total mismatch** | **0** | **0** | — | — |

Catatan:

- `unsupported` 12 pada tiga metrik evolusi risiko adalah 12 komponen sesi W4: tidak ada sesi sebelumnya, sehingga delta first-session tidak dapat diturunkan. Ini bukan kegagalan ekstraksi.
- Open risk total per sesi juga cocok: W4 9, W5 28, W6 30, W7 24.
- Rollup rata-rata actual: W4 `0.0963`, W5 `0.1441`, W6 `0.2017`, W7 `0.2723`; semuanya cocok.
- Pembacaan independen menemukan 4 risk set kosong W4 yang oleh jalur deterministik C dilaporkan `unknown`. Keduanya konsisten dengan kebijakan fail-closed: pembaca OOXML dapat membaca sheet kosong, tetapi pipeline deterministik tidak mengklaim “tidak ada risiko” tanpa bukti kelengkapan.

Bukti: `.local-evaluation/opencode-go-exp-post-remediation/provenance/independent-audit.json`, log `logs/independent-audit.log`.

### 2.4 Provenance per-cell

```sh
node .scratch/opencode-go-experiment/audit-wbs-provenance.mjs \
  --root .local-evaluation/opencode-go-exp-post-remediation/wbs/all-48 \
  --fixtures demo-evidence-fixtures/smart-building-itb/sessions \
  --out .local-evaluation/opencode-go-exp-post-remediation/provenance
```

| Verdict | Jumlah | Porsi | Arti |
|---|---:|---:|---|
| `per_cell_proven` | 192/408 | 47,1% | nilai, sel, header, dan cross-check K sepakat |
| `review_inconsistent_reference` | 216/408 | 52,9% | reference per-cell ada, tetapi `cell.label` tidak terikat (`parser_label_unbound`) |
| `review_row_level` | 0/408 | 0% | tidak ada lagi baris yang hanya row-level |
| `false_accept_percent` (standar per-cell) | 216 | — | 216 baris belum boleh disebut per-cell-proven |
| Milestone kolom O | 408 `unbound_no_citation` | — | output lama tidak menyimpan source ID kolom O |

Per sesi sama: 48 `per_cell_proven` + 54 `review_inconsistent_reference`.

Kesimpulan yang benar:

- Perbaikan split memindahkan 216 baris dari row-level ke **referensi per-cell**, tetapi **bukan** menjadi 408 per-cell-proven.
- Semua nilai pada 216 baris itu cocok dengan sel OOXML; yang gagal adalah pengikatan label header pada `cell.label`. Jadi ini masalah metadata provenance, bukan salah nilai.
- Jangan gunakan angka `408/408 provenance_valid` dari skorer WBS sebagai bukti per-cell.

Prototipe cell-aware tetap feasible secara eksploratif: 408/408 baris, 2.448/2.448 sel wajib terpetakan, 0 token hilang/ambigu, maksimum 2 part dan 2.565 karakter. Prototipe memakai identitas `proto:` dan bukan source ID produksi; ini bukan bukti perilaku produksi. Bukti: `provenance/prototype/prototype-summary.json`.

### 2.5 Rekap mismatch, missing, review, unsupported

| Kategori | Jumlah | Lokasi/arti |
|---|---:|---|
| Mismatch nilai C (6 field) | 0 | 4 `unknown` bukan mismatch nilai |
| Mismatch nilai WBS/milestone | 0 | 408/408, 48/48 |
| Mismatch nilai OOXML independen | 0 | semua metrik dalam toleransi |
| Mismatch numerik cost | 0 | 2/2 verdict PASSED_NUMERIC_WITH_GAPS |
| Missing file C | 0 | 48/48 output ada |
| Missing artefak WBS | 0 | 48/48 komponen |
| Missing dokumen OOXML | 0 | 48/48 workbook |
| Review produksi C | 0 | status `review`/`ambiguous` = 0 |
| Review provenance WBS | **216** | `parser_label_unbound` pada baris hasil split |
| Unsupported evolusi risiko | **12** | 12 komponen W4 tanpa sesi sebelumnya |
| Unsupported provenance milestone | **408** | output lama tidak menyimpan source ID kolom O; nilai milestone tetap cocok 48/48 |
| Unknown produksi C | **4** | `open_risk_ids` W4; fail-closed |

## 3. Cost baseline

### 3.1 Audit independen OOXML

```sh
python3 .scratch/opencode-go-experiment/ooxml_reader.py --all-sheets \
  --out .local-evaluation/opencode-go-exp-post-remediation/cost/ooxml \
  demo-evidence-fixtures/smart-building-itb/00_baseline/*.xlsx
python3 .scratch/opencode-go-experiment/audit-cost-baseline.py \
  --ooxml-root .local-evaluation/opencode-go-exp-post-remediation/cost/ooxml \
  --expected demo-evidence-fixtures/smart-building-itb/expected-results.json \
  --out .local-evaluation/opencode-go-exp-post-remediation/cost
```

| Field | Klaim | Hasil independen | Sel/jejak | Verdict |
|---|---:|---:|---|---|
| `hardware_baseline_total` | `1309670793.0` | `1309670793.00` | Spesifikasi `Master Hardware!L33` literal `1309670793.0`; Perhitungan `Estimasi Rincian Pembagian!E9` literal `1309670793.0` | **PASSED_NUMERIC_WITH_GAPS** |
| `purchase_request_total` | `1375170793.0` | `1375170793.00` | Pengajuan `Master Hardware!L33` formula `SUM(L2:L32)`, cache `1375170793.0` | **PASSED_NUMERIC_WITH_GAPS** |

Rincian penting:

- 31 baris Master Hardware (A2:A32) pada tiap workbook; H×K sama dengan L pada dua workbook utama.
- `Spesifikasi Teknis` L33 adalah literal `TOTAL`, bukan formula.
- `Pengajuan` L33 formula dengan cache `cached_value`; freshness tidak dibuktikan (tidak ada rekalkulasi Excel).
- `Perhitungan` E9 berlabel `Hardware`/`Pengeluaran`; E10 `SUM(E5:E9)` cache `4250383389.3` dan cocok dengan jumlah komponen.
- **Malformed:** `Perhitungan` `Master Hardware!L32` berisi teks `Rp11,500,00`. Jika sel itu dikeluarkan, jumlah tampilan kolom L = `1.298.170.793`, yaitu `11.500.000` di bawah total klaim; rekomputasi H×K tetap mencapai `1.309.670.793`. Fixture tidak diperbaiki.
- **Currency/scope:** tidak ada sel yang menyatakan currency untuk total Spesifikasi; IDR berasal dari pack, bukan dari sel. Scope adalah sheet/pack, bukan label proyek eksplisit. Keduanya tidak cell-proven.
- **Freshness:** cache SUM tidak membuktikan nilai mutakhir.

### 3.2 Apakah audit mencakup cost-evidence produksi?

Tidak. `audit-cost-baseline.py` hanya membaca OOXML independen dan dua nilai klaim; ia tidak memakai parser atau validator cost-evidence produksi.

Sebagai bukti produksi tambahan yang terpisah, probe parser dijalankan tanpa model:

```sh
node .scratch/opencode-go-experiment/cost-production-parser-probe.mjs \
  .local-evaluation/opencode-go-exp-post-remediation/cost
```

Hasil `parseDocumentBuffer()` produksi `document-parser/19`:

| Workbook | Sel | Yang dilihat parser | Formula/cache |
|---|---|---|---|
| Spesifikasi | `Master Hardware!L33` | source ID `c48s58`, label `Total`, raw `1309670793.0` | bukan formula |
| Spesifikasi | `Master Hardware!L32` | source ID `c48s54`, raw `11500000.0` | bukan formula |
| Pengajuan | `Master Hardware!L33` | source ID `c22s19`, label `Total`, raw `1375170793.0` | `formulaCells`: `SUM(L2:L32)`, `cached_value`, `1375170793.0` |
| Perhitungan | `Estimasi Rincian Pembagian!E9` | source ID `c1s22`, label `Pengeluaran`, raw `1309670793.0` | bukan formula |
| Perhitungan | `Estimasi Rincian Pembagian!E10` | source ID `c1s26`, raw `4250383389.3` | `formulaCells`: `SUM(E5:E9)`, `cached_value` |
| Perhitungan | `Master Hardware!L32` | source ID `c50s53`, raw `Rp11,500,00` | bukan formula |

Kesimpulan: parser produksi mengekspos nilai, label, lokasi sel, formula, dan status cache; ia **tidak** melakukan rekalkulasi atau normalisasi cost. Validator cost-observation produksi (yang menerima/menolak klaim model) tidak dijalankan tanpa model. Jadi statusnya: **parser cost terbukti membaca; cost-evidence end-to-end produksi belum diuji.**

## 4. Tinjauan 20 kegagalan (log yang sudah ada, tidak dijalankan ulang)

Sumber: `.local-evaluation/opencode-go-exp-system-remediation/formula-due/integration-suite.log` (288 tes, 268 pass, 20 fail, 0 skip). Kutipan error di bawah adalah error pertama; assertion setelah titik gagal tidak dievaluasi.

| # | Lokasi | Tes | Error aktual | Klasifikasi | Dampak/ketidakpastian |
|---:|---|---|---|---|---|
| 1 | `assurance-integrity-actions.test.mjs:191` | sibling document with unprocessed schedule coverage... | `actual undefined !== expected 'processed'` karena mencari RPC `finish_assurance_analysis_with_results`; produksi memakai `finish_assurance_analysis_with_decision_fingerprint` | Tes stale terhadap nama RPC | **Langsung terkait assurance**. Perilaku merge coverage tidak terbukti rusak, tetapi juga tidak terverifikasi oleh tes ini. Prioritas review 1. |
| 2 | `document-library.test.mjs:45` | tabs and extracted pointers... | `ReferenceError: SectionCard is not defined` | Harness memotong source komponen | UI tidak terverifikasi; bukan kegagalan pipeline data. Setelah helper ditambal, assertion copy Inggris vs UI Indonesia masih mungkin gagal. |
| 3 | `document-library.test.mjs:62` | failed documents with stored rows... | `ReferenceError: SectionCard is not defined` | Harness source-slice | sama |
| 4 | `document-library.test.mjs:73` | quick filters count files once... | `ReferenceError: SectionCard is not defined` | Harness source-slice | sama |
| 5 | `document-library.test.mjs:86` | archive is one list... | `ReferenceError: SectionCard is not defined` | Harness source-slice | sama |
| 6 | `document-library.test.mjs:100` | category and combined filters... | `ReferenceError: statusLabelsId is not defined` | Harness source-slice | sama |
| 7 | `document-library.test.mjs:112` | empty matches, quick statuses... | `ReferenceError: statusLabelsId is not defined` | Harness source-slice | sama |
| 8 | `document-library.test.mjs:127` | pagination slices the complete filtered set... | `ReferenceError: SectionCard is not defined` | Harness source-slice | sama |
| 9 | `document-library.test.mjs:141` | sorting handles filenames naturally... | `ReferenceError: SectionCard is not defined` | Harness source-slice | sama |
| 10 | `epic-3-dashboard.test.mjs:25` | overview uses the latest project assessment | regex `/Latest assessment/` tidak cocok; UI berbahasa Indonesia | Copy/localization drift | Presentasi dashboard; bukan alur data. |
| 11 | `epic-3-dashboard.test.mjs:41` | overview presents only understandable conditions... | regex `/Management focus/` tidak cocok | Copy drift | sama |
| 12 | `epic-3-dashboard.test.mjs:72` | schedule chart always compares forecast... | regex `/name="Approved baseline"/` tidak cocok; produksi memakai `Baseline disetujui` | Copy drift | Semantik chart tidak terbukti rusak; tes source-regex usang. |
| 13 | `epic-3-dashboard.test.mjs:85` | trends is an honest placeholder... | regex `/Under Development/` tidak cocok | Copy drift | Placeholder UI; bukan data. |
| 14 | `epic-4-anomalies.test.mjs:41` | anomaly workspace supports filters... | regex `/Evidence/` tidak cocok; produksi memakai `Bukti` | Copy drift | Assertion berikutnya tidak dievaluasi; dampak presentasi. |
| 15 | `extracted-details.test.mjs:12` | facts are flat and paginated... | regex `/Showing 1–10 of 22 matching rows/` vs UI `22 baris tersimpan.` | Copy/pagination drift | UI review; bukan data pipeline. |
| 16 | `extracted-details.test.mjs:29` | one extraction owner prevents cross-document... | `'1 risiko' !== '1 risk'` | Copy drift | sama |
| 17 | `extracted-details.test.mjs:42` | drawer review is collapsed... | regex `/Review extracted items \(22\)/` vs `Tinjau item terekstraksi (22)` | Copy drift | sama |
| 18 | `extracted-details.test.mjs:66` | compact pointers distinguish failed... | `'62 item · Parsial' !== '62 items · Partial'` | Copy drift | sama |
| 19 | `extracted-details.test.mjs:75` | statuses, conservative totals... | `'Diterima' !== 'Accepted'` | Copy drift | sama |
| 20 | `phase6-document-parser.test.mjs:574` (assertion `:605`) | available local OCR extracts image and scanned-PDF text... | `imageResult.ok false !== true` | Runtime OCR lokal tidak tersedia | **Langsung terkait ingestion**. `.venv-ocr` ada tetapi kosong (tidak ada `bin/python`, tidak ada model `.onnx`); gate tes hanya memeriksa `gs`/`tesseract` sehingga tes berjalan lalu gagal. OCR gambar/PDF scan tidak terverifikasi. |

Rekap: **8** harness source-slice (`document-library`), **10** copy/localization drift (`extracted-details` 5, `epic-3` 4, `epic-4` 1), **1** stale RPC assurance, **1** OCR runtime. Tidak ada kegagalan yang menunjukkan nilai WBS/cost/planned/actual/RAG yang salah.

Prioritas review:

1. `assurance-integrity-actions` — satu-satunya kegagalan yang menyentuh alur assurance; status perilaku **belum pasti**.
2. OCR — fitur ingestion tidak terverifikasi di lingkungan ini.
3. `document-library` — tes UI fungsional merah karena harness, sehingga filter/pagination/sort tidak punya bukti lulus.
4. Copy/localization — dampak presentasi, tetapi tetap membuat suite rilis merah.

## 5. Keputusan readiness

| Area | Status | Bukti |
|---|---|---|
| Parser produksi → ekstraksi deterministik 48 workbook | **LULUS eksperimental dengan catatan** | 284/288; 4 unknown fail-closed; 0 false accept |
| WBS per baris | **LULUS nilai** | 408/408; 0 review/unknown |
| Milestone komponen | **LULUS nilai turunan** | 48/48; `derived` |
| Provenance per-cell | **SEBAGIAN** | 192/408 proven; 216 referensi per-cell tetapi label header tidak terikat |
| Metrik independen OOXML | **LULUS konsistensi** | 0 mismatch; 12 unsupported first-session risk delta |
| Cost baseline numerik | **LULUS dengan gap** | 2/2; malformed L32; currency/scope/freshness tidak terbukti |
| Production extraction seam | **LULUS offline mock (2 workbook)** | `all_passed:true`; 28+24 request mock; network `false` |
| Suite integrasi penuh | **GAGAL 20** | Log lama; tidak dijalankan ulang |
| OCR | **TIDAK TERVERIFIKASI** | Runtime PP-OCRv6 tidak ada |
| Provider/model nyata | **BLOCKED** | Tidak dipanggil; mock bukan bukti kualitas model |
| Database/fencing nyata | **BLOCKED** | Tidak dijalankan |
| Ground truth independen/human-reviewed | **BLOCKED** | Tidak tersedia; expected dan fixture dari generator yang sama |

**Keputusan:** hasil ini cukup untuk menyatakan pipeline parser→deterministik **konsisten pada keluarga fixture ini** dan perbaikan split tidak menurunkan nilai WBS. Hasil ini **belum** cukup untuk klaim produksi, cutover, akurasi model, atau “semua aman”. 216 baris belum per-cell-proven, satu tes assurance belum terverifikasi, OCR belum berjalan, dan tidak ada ground truth independen.

## 6. Perintah reproduksi offline

Semua dijalankan dari root repo, tanpa `--env-file`, tanpa API key, tanpa database.

```sh
OUT=.local-evaluation/opencode-go-exp-post-remediation

# 1. C 48 workbook (parser produksi + deterministik eksperimental; requests=0)
for s in 2026-10-09_w4 2026-10-16_w5 2026-10-23_w6 2026-10-30_w7; do
  node .scratch/opencode-go-experiment/evidence-v2.mjs --variant C --dry-run \
    --out "$OUT/c48/$s" demo-evidence-fixtures/smart-building-itb/sessions/$s/*.xlsx
done
V3_ROOT="$OUT/c48" node .scratch/opencode-go-experiment/score-v3.mjs

# 2. WBS/milestone 48
for s in 2026-10-09_w4 2026-10-16_w5 2026-10-23_w6 2026-10-30_w7; do
  node .scratch/opencode-go-experiment/wbs-milestone-offline.mjs \
    --out "$OUT/wbs/all-48/$s" --session $s \
    demo-evidence-fixtures/smart-building-itb/sessions/$s/*.xlsx
done
node .scratch/opencode-go-experiment/score-wbs-offline.mjs \
  --root "$OUT/wbs/all-48" --out "$OUT/wbs"

# 3. Pembaca OOXML independen + metrik
for s in 2026-10-09_w4 2026-10-16_w5 2026-10-23_w6 2026-10-30_w7; do
  python3 .scratch/opencode-go-experiment/ooxml_reader.py --all-sheets \
    --out "$OUT/provenance/ooxml/$s" \
    demo-evidence-fixtures/smart-building-itb/sessions/$s/*.xlsx
done
node .scratch/opencode-go-experiment/audit-wbs-provenance.mjs \
  --root "$OUT/wbs/all-48" \
  --fixtures demo-evidence-fixtures/smart-building-itb/sessions \
  --out "$OUT/provenance"
python3 .scratch/opencode-go-experiment/post-remediation-independent-audit.py \
  --ooxml-root "$OUT/provenance/ooxml" \
  --expected demo-evidence-fixtures/smart-building-itb/expected-results.json \
  --out "$OUT/provenance" \
  --sessions 2026-10-09_w4 2026-10-16_w5 2026-10-23_w6 2026-10-30_w7
node .scratch/opencode-go-experiment/prototype-cell-aware-split.mjs \
  --audit-root "$OUT/provenance/audit" \
  --ooxml-root "$OUT/provenance/ooxml" \
  --out "$OUT/provenance/prototype"

# 4. Cost
python3 .scratch/opencode-go-experiment/ooxml_reader.py --all-sheets \
  --out "$OUT/cost/ooxml" demo-evidence-fixtures/smart-building-itb/00_baseline/*.xlsx
python3 .scratch/opencode-go-experiment/audit-cost-baseline.py \
  --ooxml-root "$OUT/cost/ooxml" \
  --expected demo-evidence-fixtures/smart-building-itb/expected-results.json \
  --out "$OUT/cost"
node .scratch/opencode-go-experiment/cost-production-parser-probe.mjs "$OUT/cost"

# 5. Seam produksi dan sintetis (mock lokal)
node .scratch/opencode-go-experiment/smoke-two-workbooks.mjs "$OUT/smoke"
node .scratch/opencode-go-experiment/verify-full-offline-seams.mjs --out "$OUT/seams"
node .scratch/opencode-go-experiment/verify-wbs-offline.mjs

# 6. Graph (AST-only, tanpa LLM)
graphify update .
```

Tidak dijalankan pada sesi ini: `node --test tests/integration/*.test.mjs` (20 kegagalan sudah user-reported), `npm run test:db`, Playwright, provider live, install OCR.

## 7. Integritas dan artefak

Pemeriksaan:

```sh
diff -u "$OUT/logs/fixtures-before.sha256" "$OUT/logs/fixtures-after.sha256"
# exit 0: 68 fixture identik

diff -u "$OUT/logs/git-status-before.txt" "$OUT/logs/git-status-after.txt"
diff -u "$OUT/logs/git-diff-stat-before.txt" "$OUT/logs/git-diff-stat-after.txt"
# exit 0: perubahan pengguna tidak berubah
```

`git diff --stat -- worker src demo-evidence-fixtures tests supabase package.json package-lock.json` tetap berisi perubahan pengguna yang sudah ada sebelum sesi (5 file: dua tes, `worker/README.md`, `document-extraction.ts`, `document-parser.ts`). Tidak ada perubahan tambahan dari sesi ini.

| Artefak | SHA-256 |
|---|---|
| `c48/score-v3.json` | `ab163e58e7f0c1be99dfaaeb806efe173177f7f92546aa42b156ab45a309b6e6` |
| `wbs/score-wbs.json` | `6f2c65d6a0068fe85ba29d5cd6dbb595e00d9037a3c690b23f08a5f97110b3e5` |
| `provenance/audit-summary.json` | `e7fd6cb9be23cbc537441bcdcbc272dce22e63a1ea8a264fdde4068e832c4338` |
| `provenance/independent-audit.json` | `567d115c130cc8804f6eed4f92050bfc58361432e48dacd558a3679bc7d2560f` |
| `cost/cost-baseline-audit.json` | `8b6bd305428ba755ebfbb1b6f3c6dc0b7819ea68639894a4698a5ded535c6d4c` |
| `cost/production-parser-cost-probe.json` | `448bdd318f4d94d23b9262db5372af38dccdebb15e21b1eeb981549fd7d49708` |
| `smoke/smoke-summary.json` | `32e8e9f60a682bc08f32a7e356b962e976ede0ff3fc231c29ae0e33636d01495` |
| `seams/seams-result.json` | `59dc2845f2668979c0eeeb2348aa9739e60d99e981a73dcb51e55b1764e4e8d7` |

Output mentah penting:

- `logs/c48-compute.log`, `logs/score-v3.log`
- `logs/wbs-compute.log`, `logs/score-wbs.log`
- `logs/provenance-audit.log`, `logs/independent-audit.log`
- `logs/cost-ooxml.log`, `logs/cost-audit.log`, `logs/cost-production-parser.log`
- `logs/smoke.log`, `logs/seams.log`, `logs/verify-wbs-offline.log`
- `logs/parsed-failures.json` (20 kegagalan yang diparse dari log lama)

`smoke-two-workbooks.mjs`: `all_passed:true`, `network_used:false`, `environment_file_read:false`, `model_called:false`, parser `document-parser/19`, 28 dan 24 request mock lokal. `verify-full-offline-seams.mjs`: 8/8. `verify-wbs-offline.mjs`: 21/21.

`graphify update .` setelah penambahan runner eksperimen: **3748 nodes, 8949 edges, 155 communities**; AST-only, tanpa LLM. Graphify menyarankan `graphify label` untuk menyegarkan nama komunitas; tidak dijalankan karena membutuhkan LLM.

## 8. Blocker, non-claim, dan langkah berikutnya

**Blocker yang tetap terbuka**

1. **Ground truth independen/human-reviewed** tidak ada. `expected-results.json` dibuat generator yang sama dengan workbook; WBS dicocokkan berdasarkan urutan dan `next_milestone` adalah nilai turunan.
2. **Per-cell provenance 216 baris** belum lengkap: reference per-cell ada, tetapi `cell.label` tidak terikat. Ini perlu diperbaiki di parser atau konsumen harus memperlakukannya sebagai review/row-level.
3. **OCR** tidak terverifikasi; `.venv-ocr` kosong dan model PP-OCRv6 tidak ada.
4. **Tes assurance** yang gagal memakai nama RPC lama; perilaku merge coverage belum terbukti.
5. **Provider/model live** dan **database terisolasi** tidak diuji; mock/fake bukan transaksi atau kualitas model nyata.
6. **Cost currency/scope/freshness** tidak cell-proven; `Rp11,500,00` sengaja dibiarkan.
7. **UI fungsional** (filter/pagination/sort) tidak punya bukti lulus karena harness source-slice.

**Tidak diklaim**

- Tidak ada klaim produksi siap, cutover aman, benchmark, atau akurasi model.
- Tidak ada klaim 408/408 per-cell-proven; yang benar adalah 192/408 proven dan 216 review.
- Tidak ada klaim cache formula fresh, currency/scope cost terbukti, atau 20 kegagalan “aman”.
- Tidak ada klaim angka ini berlaku di luar satu keluarga fixture sintetis.

**Usulan langkah berikutnya**

1. Perbaiki pengikatan label header pada cell reference untuk part hasil split, lalu jalankan ulang audit per-cell; target nyata adalah menaikkan 192/408, bukan mengubah skorer agar lulus.
2. Perbarui tes `assurance-integrity-actions` ke RPC `finish_assurance_analysis_with_decision_fingerprint` dan tambahkan assertion perilaku merge coverage; jangan hanya mengganti nama tanpa memverifikasi hasil.
3. Sediakan runtime OCR lokal yang lengkap atau ubah gate tes agar sesuai implementasi PP-OCRv6; jangan install tanpa persetujuan.
4. Pisahkan tes copy UI dari tes perilaku, atau selaraskan ekspektasi ke UI Indonesia; ini keputusan produk, bukan perbaikan data.
5. Sediakan ground truth independen/human-reviewed dan DB terisolasi sebelum klaim produksi; jalankan provider live hanya dengan persetujuan kuota terpisah.
6. Tetapkan kebijakan currency/scope/freshness untuk cost; pertahankan input malformed dan jangan menurunkan standar provenance demi angka.

## Lampiran — ringkasan satu baris

- 48 workbook: 284/288 field deterministik cocok; 4 `unknown` fail-closed; 0 false accept.
- WBS: 408/408 nilai; 48/48 milestone; 408/408 baris kini punya referensi per-cell, tetapi hanya 192/408 yang per-cell-proven; 216 review karena label header tidak terikat.
- OOXML independen: cut-off, planned, actual, variance, RAG, overall, weighted progress, milestone, dan open risk set semuanya 48/48; 0 mismatch; evolusi risiko 36/36 yang dapat diturunkan.
- Cost: 2/2 total cocok secara numerik dengan gap currency/scope/freshness dan L32 malformed.
- 20 kegagalan: 8 harness UI, 10 copy/localization, 1 stale RPC assurance, 1 OCR; tidak ada bukti nilai pipeline salah.
- Readiness: **eksperimental offline layak dilanjutkan; produksi belum diklaim.**
