# Laporan perbaikan provenance header WBS dan assurance

## 0. Status eksekusi dan batas

- Repo: `/Users/iweng/Documents/GitHub/DevXassurance`; branch `development-bismillah-final`; HEAD `784a04d` (tidak ada commit/reset).
- Output baru: `.local-evaluation/opencode-go-exp-header-assurance/`. Laporan ini: `.scratch/opencode-go-experiment/report-header-assurance.md`.
- Tidak membaca `.env*`, API key, auth store, atau kredensial.
- Tidak memanggil provider/model dari aplikasi atau tes. Smoke memakai `fetch` mock lokal; `model_called:false`, `network_used:false`, `environment_file_read:false`.
- Tidak memakai database eksternal/production.
- Tidak install, commit, push, reset, atau menekan tes.
- Workbook, `expected-results.json`, dan output eksperimen lama tidak diubah. `git status --porcelain -- demo-evidence-fixtures` kosong.
- Perubahan pengguna yang sudah ada dipertahankan. Perubahan sesi ini: parser, dokumentasi header di `worker/README.md`, empat assertion versi parser (dua di `phase6-document-parser.test.mjs`, dua di `evidence-provenance.test.mjs`), tes assurance, dan satu tes regresi baru.

## 1. WBS provenance

### 1.1 Akar masalah 216 `parser_label_unbound`

Angka 216 bukan nilai yang salah dan bukan label yang memang sengaja ditahan karena konten ambigu. Penyebabnya adalah deteksi header dua baris yang terlalu sempit pada 24 workbook yang memiliki grid Gantt:

- Baris 3 hanya berisi label minggu: `S3:AF3 = W1..W14`.
- Baris 4 berisi label field `A4:R4` (WBS, Deliverable, Baseline Finish, % Complete, ...) **dan** sel tanggal `S4:AF4`.
- Pemeriksaan `isLabelRow` lama mewajibkan **setiap** sel baris kedua textual. Sel `S4:AF4` adalah sel tanggal numerik, sehingga baris 4 ditolak sebagai header kedua.
- Akibatnya `headerCount` tetap 1 dan baris 3 (hanya kolom S–AF) menjadi satu-satunya header. Data baris 5+ mendapat `label=null` untuk kolom A–R.
- 24 workbook lain tidak memiliki grid Gantt; header-nya satu baris (baris 4), sehingga sejak awal terbaca benar: `192/408` proven dan `216/408` review.

Nilai, lokasi sel, dan cross-check K pada 216 baris itu sudah cocok dengan OOXML independen. Yang hilang hanya pengikatan `cell.label` ke header sumber.

### 1.2 Perbaikan minimal

Pada `worker/src/services/document-parser.ts`:

- Baris kedua hanya diterima sebagai header tambahan jika baris pertama terbukti week/period grid.
- Setiap sel baris kedua harus berupa label pendek non-numerik, **atau** sel tanggal yang berada di kolom yang sudah dilabeli baris pertama.
- Harus ada minimal satu label di luar kolom week grid.
- Label subtitle harus unik; jika berulang, baris tetap data (fail-closed), bukan header.
- Parser version dinaikkan `document-parser/19` → `document-parser/20` karena keluaran parsing berubah.

Runner eksperimental `wbs-milestone-offline.mjs` disesuaikan agar mengenali blok header gabungan (baris 3–4) dan memakai baris terakhir header (baris 4) sebagai `header_row`. Perubahan ini hanya pada harness eksperimen, bukan produksi.

Dokumentasi `worker/README.md` diperbarui untuk menyebut date continuation yang sah dan aturan fail-closed saat label berulang.

### 1.3 Regresi pada seam parser produksi

Tes baru: `tests/integration/wbs-header-provenance.test.mjs`.

1. **Binding sah**: workbook sintetis dengan header bertingkat (baris 3 `W1/W2`, baris 4 label field + tanggal) menghasilkan:
   - `A5` label `WBS`, nilai `1.1`
   - `D5` label `Deliverable / Acceptance Criteria`, nilai `Deliverable A`
   - `G5` label `Baseline Finish`, nilai `2026-10-09`
   - `J5` label `% Complete`, nilai `1`
   - Label tetangga tidak bocor (`D5 != WBS`, `G5 != Baseline Start`).
2. **Ambiguitas fail-closed**: subtitle dengan label `Baseline Finish` berulang tidak dikonsumsi sebagai header. Baris tetap memiliki row reference dan per-cell reference, tetapi `A4.label` dan `G5.label` tetap `null`.
3. **Fixture yang dilaporkan**: workbook nyata `2026-10-23_w6/01_Alarm_Kebencanaan_Subcontractor_Weekly.xlsx` mem-parse baris 5 dengan label `WBS`/`Deliverable / Acceptance Criteria`/`Baseline Finish`/`% Complete`, nilai `1.1`, tanggal `2026-10-09`, dan raw `1.0`.

Focused tests lain yang relevan:

```sh
node --test tests/integration/wbs-header-provenance.test.mjs
node --test --test-name-pattern="XLSX|two-header|weekly Gantt|splitting a long row" \
  tests/integration/phase6-document-parser.test.mjs
node --test tests/integration/evidence-provenance.test.mjs
npx tsc --noEmit -p tsconfig.json
```

Hasil: tes baru `3/3` lulus; tes XLSX/header parser `11/11` lulus; provenance `20/20` lulus; `tsc` exit `0`.

### 1.4 Audit ulang 48 workbook dengan parser terkini

```sh
OUT=.local-evaluation/opencode-go-exp-header-assurance

for s in 2026-10-09_w4 2026-10-16_w5 2026-10-23_w6 2026-10-30_w7; do
  python3 .scratch/opencode-go-experiment/ooxml_reader.py --all-sheets \
    --out "$OUT/provenance/ooxml/$s" \
    demo-evidence-fixtures/smart-building-itb/sessions/$s/*.xlsx
  node .scratch/opencode-go-experiment/wbs-milestone-offline.mjs \
    --out "$OUT/wbs/all-48/$s" --session "$s" \
    demo-evidence-fixtures/smart-building-itb/sessions/$s/*.xlsx
done

node .scratch/opencode-go-experiment/score-wbs-offline.mjs \
  --root "$OUT/wbs/all-48" --out "$OUT/wbs"

node .scratch/opencode-go-experiment/audit-wbs-provenance.mjs \
  --root "$OUT/wbs/all-48" \
  --fixtures demo-evidence-fixtures/smart-building-itb/sessions \
  --out "$OUT/provenance"
```

Denominator: 48 workbook, 408 baris WBS, 4 field pembanding per baris (1.632 field-check), ditambah 408 field milestone.

| Field | Per-cell proven | Unknown | Review | Mismatch | Denominator |
|---|---:|---:|---:|---:|---:|
| `code` | **408** | 0 | 0 | 0 | 408 |
| `percent` | **408** | 0 | 0 | 0 | 408 |
| `deliverable` | **408** | 0 | 0 | 0 | 408 |
| `baseline_finish` | **408** | 0 | 0 | 0 | 408 |
| `milestone` (kolom O) | 0 | 0 | 408 `unbound_no_citation` | 0 | 408 |
| **Total baris** | **408/408** | **0** | **0** | **0** | **408** |

Bukti independen:

- `header_ok`: `48/48` (baris header 4; label `WBS`, `Deliverable / Acceptance Criteria`, `Baseline Finish`, `% Complete`, `Milestone`; tidak ada merge/duplikasi pada header pembanding).
- `hash_ok`: `48/48` (hash fixture = hash pembaca OOXML).
- `period_mismatch`: `0`; `period_unverified`: `0`.
- `header_binding_mismatch`: `0`.
- `false_accept_percent`: `0`; `false_accept_row`: `0`.
- Per sesi: `102/102` baris `per_cell_proven` (4 sesi).
- Angka `408/408` adalah **per-cell-proven untuk empat field pembanding** (nilai, sel, label header, dan OOXML independen sepakat), bukan klaim bahwa tabel bebas dari review header dua baris. Flag kandidat tingkat tabel dilaporkan terpisah di bawah.
- Template: `48/48` `structured_row_cells`; `header_row` `4` pada 48 workbook; failures runner `0`.
- Normalisasi tanggal diverifikasi independen, misalnya `G5 raw 46304 → 2026-10-09`.
- `milestone.value_agrees`: `408/408`; nilainya cocok, tetapi output runner tidak menyimpan source ID kolom O, sehingga verdict tetap `unbound_no_citation`. Ini tidak dipaksa menjadi proven.

Skor nilai terpisah (`score-wbs.json`): WBS `408/408` nilai cocok, milestone `48/48`, `review=0`, `unknown=0`, `false_accept=0`. Catatan: `provenance_valid` pada skorer lama hanya memeriksa bentuk/source ID; bukti per-cell yang kuat adalah audit independen di atas.

#### Review konservatif yang masih ada

24 workbook yang memiliki grid Gantt masih memancarkan diagnostic parser:

```text
Sheet "Workplan & Gantt" table rows 3-14 (S3-AF14) has candidate ambiguity
indicators: multi_row_header, date_period_columns; row/column mapping is kept
as raw evidence and may need a candidate interpretation review.
```

Ini adalah **flag review konservatif** untuk tabel header dua baris/Gantt, bukan label yang salah. Audit per-cell tetap membuktikan label dan nilai. Tidak ada model/candidate interpretation yang dijalankan untuk mengubah flag ini. 24 workbook tanpa grid tidak memiliki warning tersebut.

#### Sample format A dan B (label exact + sumber)

**Format A — sebelumnya `review_inconsistent_reference` (W6 / `01_Alarm_Kebencanaan_Subcontractor_Weekly.xlsx`, row 5):**

| Field | Label exact | Source ID | Cell | Nilai klaim | OOXML independen |
|---|---|---|---|---:|---|
| code | `WBS` | `c5s3` | `A5` | `1.1` | `1.1` |
| deliverable | `Deliverable / Acceptance Criteria` | `c5s6` | `D5` | `Titik pemasangan disetujui (dokumen Konsep)` | sama |
| baseline_finish | `Baseline Finish` | `c5s9` | `G5` | `2026-10-09` | raw `46304` → `2026-10-09` |
| percent | `% Complete` | `c5s12` | `J5` | `1` | raw `1.0`, format `0%`, display `100%` |

**Format B — sebelumnya sudah `per_cell_proven` (W6 / `05_Pencahayaan_Subcontractor_Weekly.xlsx`, row 5):**

| Field | Label exact | Source ID | Cell | Nilai klaim | OOXML independen |
|---|---|---|---|---:|---|
| code | `WBS` | `c5s3` | `A5` | `1.1` | `1.1` |
| deliverable | `Deliverable / Acceptance Criteria` | `c5s6` | `D5` | `Daftar titik disetujui PPK` | sama |
| baseline_finish | `Baseline Finish` | `c5s9` | `G5` | `2026-09-25` | `2026-09-25` |
| percent | `% Complete` | `c5s12` | `J5` | `1` | raw `1.0`, format `0%` |

### 1.5 Blocker provenance yang tetap terbuka

1. Kolom `O` (Milestone) belum punya `milestone_cell_source_id` di output runner, sehingga `408` baris tetap `unbound_no_citation` meskipun `value_agrees` `408/408`. Tidak dipaksa menjadi proven.
2. `expected-results.json` berasal dari generator fixture yang sama; ini konsistensi terhadap fixture, bukan ground truth independen/human-reviewed.
3. Flag `multi_row_header`/`date_period_columns` tetap ada secara konservatif untuk tabel Gantt dua baris; flag ini bukan bukti label salah, tetapi tetap review.

## 2. Assurance coverage

### 2.1 Akar masalah

Kegagalan `tests/integration/assurance-integrity-actions.test.mjs:191` disebabkan tes masih mencari RPC lama `finish_assurance_analysis_with_results`. Produksi memakai `finish_assurance_analysis_with_decision_fingerprint`. Karena lookup RPC tidak menemukan apa pun, `publication` undefined dan assertion perilaku tidak pernah benar-benar dievaluasi. Tidak ada bug produksi yang ditemukan pada seam ini.

### 2.2 Perbaikan tes

Tes stale diperbaiki pada seam yang tepat, bukan dengan mempertahankan RPC forwarding:

- RPC publikasi diganti ke `finish_assurance_analysis_with_decision_fingerprint`.
- Assertion sekarang memeriksa hasil/metadata yang dibaca consumer:
  - `observation_coverage.byRole.current.schedule.state === 'processed'`;
  - `partial === true`;
  - `reason` memuat `W4 Alarm Kebencanaan schedule groups remain unprocessed`;
  - `observation_coverage.byRole.current.progress.state === 'processed'`;
  - `source_versions` memuat `base`, `current-master-gantt`, `current-w4-alarm`;
  - finding schedule `condition === 'critical'`;
  - headline tidak mengandung `coverage gap`;
  - explanation menyebut `unprocessed`.

Skenario gap semua-unprocessed sudah ada dan tetap lulus: `analysis preserves unprocessed coverage in its atomic result` menghasilkan `more_evidence_required`.

Hasil: `16/16` tes assurance lulus.

### 2.3 Keterbatasan bukti assurance

Fixture memakai Supabase in-memory/mock. Ini membuktikan kontrak `runAssuranceAnalysis` dan metadata yang dipublikasikan, tetapi **bukan** bukti atomicitas transaksi database, row locking, atau fencing attempt pada database nyata. Tidak ada database eksternal yang dijalankan.

## 3. Smoke parse/extract offline

```sh
node .scratch/opencode-go-experiment/smoke-two-workbooks.mjs \
  .local-evaluation/opencode-go-exp-header-assurance/smoke
```

Hasil `smoke-summary.json`:

- `all_passed: true`
- `network_used: false`
- `environment_file_read: false`
- `model_called: false`
- Parser `document-parser/20` pada kedua workbook.
- `every_cell_model_text_citable: true`; `split_cell_reference_texts_citable: true`.
- Formula cache tetap terlihat dan tidak dieksekusi; warning cache kosong tetap muncul.

## 4. Artefak dan hash

| Artefak | SHA-256 |
|---|---|
| `provenance/audit-summary.json` | `044f07a282654030c7081514c844e43d4afbd73a51920b37882b3e68ea5dab13` |
| `wbs/score-wbs.json` | `479677f99a9292b687e9cb1cce60938ddd1ff494d3a90a24f759fef2222588d9` |
| `smoke/smoke-summary.json` | `f5221bac018683b1e08411d1e2cfc0601504e74cf1e7f158bf027697af33ae4a` |
| `logs/provenance-audit.log` | `58efde0b4f4122d0fc9de9fbf7d8b7ef5dc53a69a645325222e97d9f39461079` |

Direktori bukti: `.local-evaluation/opencode-go-exp-header-assurance/{provenance,wbs,smoke,logs}`.

`graphify update .` dijalankan setelah perubahan kode: 3757 nodes, 8966 edges, 157 communities; AST-only, tanpa LLM.

## 5. Readiness dan non-claim

| Area | Status | Bukti |
|---|---|---|
| Binding label header WBS | **LULUS** | 408/408 baris per-cell-proven untuk `code`, `percent`, `deliverable`, `baseline_finish` |
| Nilai WBS/milestone | **LULUS nilai** | 408/408 WBS; 48/48 milestone; 0 mismatch |
| Provenance milestone kolom O | **SEBAGIAN** | 408 `unbound_no_citation`; nilai cocok 408/408 |
| Flag konservatif header Gantt | **REVIEW** | 24 Workplan tables; bukan label salah |
| Assurance merge coverage | **LULUS perilaku mock** | 16/16 tes; metadata `partial/reason` terverifikasi |
| Atomic DB/fencing | **TIDAK TERBUKTI** | Mock, bukan database nyata |
| Ground truth independen | **TIDAK ADA** | `expected-results.json` dari generator yang sama |
| Model/provider live | **TIDAK DIJALANKAN** | Dilarang; mock bukan bukti kualitas model |

Tidak dijalankan: full suite lama (kegagalan UI/OCR sudah dilaporkan dan tidak relevan), OCR runtime, provider live, dan tes database. Tidak ada klaim produksi siap, akurasi model, atau atomicitas database.
