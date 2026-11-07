# Laporan validasi offline penuh — eksekusi end-to-end

## 0. Status eksekusi dan batas

- Repo: `/Users/iweng/Documents/GitHub/DevXassurance`; branch `development-bismillah-final`; commit terakhir yang terlihat `784a04d`.
- Parser produksi: `document-parser/18`. Extraction schema: `phase6-document-extraction/34`. Contract observasi: `pmo-assurance-observations/1`.
- Fixture pack: 68 file di `demo-evidence-fixtures/smart-building-itb/`; `expected-results.json` SHA-256 `2506bcc517319c263a88be8e2f31102ae920c1934e0108d3599741bf3e3dec5c`.
- Output baru: `.local-evaluation/opencode-go-exp-full-offline/` (347 file, 189 MB, git-ignored).
- Laporan ini baru: `.scratch/opencode-go-experiment/report-full-offline.md`.
- Runner baru: `.scratch/opencode-go-experiment/verify-full-offline-seams.mjs`, `.scratch/opencode-go-experiment/audit-cost-baseline.py`.
- `README.md` eksperimen ditambah bagian "Full offline validation (v7)".

Batas yang dipatuhi:

- Tidak membaca `.env*`, API key, auth store, atau kredensial.
- Tidak ada request provider/LLM/jaringan dari pengujian aplikasi. Semua `fetch` yang dieksekusi adalah mock lokal; `--dry-run` dan `--replay` tidak memanggil model.
- Tidak ada database eksternal, container, atau service yang disentuh. `npm run test:db` hanya menjalankan guard skip.
- Tidak ada install paket, commit, push, reset, atau perintah destruktif.
- Tidak ada perubahan pada `worker/`, `src/`, `demo-evidence-fixtures/`, `tests/`, `supabase/`, atau `package*.json`. `git diff --stat -- worker src demo-evidence-fixtures tests supabase package.json package-lock.json` kosong.
- Output lama tidak diubah. Manifest 514 file `.local-evaluation` sebelum sesi diverifikasi ulang dengan `shasum -a 256 -c`, exit 0. Hash 68 fixture sebelum/sesudah identik (`diff` exit 0).
- CommandCode inference untuk sesi ini terpisah dari aplikasi yang diuji.

## 1. Ringkasan penerimaan

| Area | Status | Bukti utama | Blocker / batas |
|---|---|---|---|
| Parser → validator → output (source ID, sel, tanggal, cache) | **PASSED dengan catatan** | `phase6-document-parser` 19/20; `phase6-document-extraction` 37/37; `evidence-provenance` 14/15; seam baru 8/8 | 1 tes OCR gagal karena runtime OCR lokal tidak ada; 1 tes metadata tanggal gagal karena produksi menerima `Cut-off Date`/`complete` sebagai milestone |
| Chunk split guardrail 3100 karakter | **PASSED** | Seam baru: baris 4200 karakter menjadi 2 chunk, referensi baris tetap, referensi sel hilang; parser tidak diubah | Perilaku demotion tetap ada; bukan perbaikan produksi |
| Cap 120 source reference | **PASSED** | Seam baru: maksimum 112 referensi/chunk, baris 7–11 hanya punya row reference | Cap tetap fail-closed; tidak diuji pada workbook yang lebih padat dari fixture |
| Header ambigu / duplikat / row ambiguity | **PASSED dengan gap** | Seam baru: dua header periode + baris non-square menghasilkan warning `date_period_columns, non_square_header` | Label header duplikat dipertahankan mentah tetapi **tidak** didiagnosis sebagai duplikat |
| Formula cache missing/empty/error/unknown | **PASSED** | Seam baru: label `missing_cache`, `cached_empty`, `cached_error`, `unknown`; tidak ada nilai nol yang dikarang; validator review-only di `verify-v3` 50/50 | Kesegaran cache tidak dibuktikan |
| Empty vs zero | **PASSED** | Seam baru: sel kosong tidak dipancarkan; literal `0` tetap ada sebagai `"0"` | Tidak ada bukti tambahan di luar seam sintetis |
| Excel 1900/1904 | **PASSED** | Seam baru: serial 60 invalid; serial 1 epoch 1904 → `1904-01-02`; tes repo juga lulus | Format tanggal lain tidak diuji |
| Checkpoint/cache version & reuse | **PASSED** | Tes target `stale group cache version` 1/1; `bounded groups retry only failed work` 1/1; `structured assurance preserves source versions` 1/1 | Bukan transaksi database nyata |
| 429 / partial group bukan absence | **PASSED** | Tes target `provider quota defers` 1/1 | Hanya 429; timeout diuji terpisah dengan mock |
| Timeout provider | **PASSED** | Seam baru: `fetch` melempar `TimeoutError`; hasil `llm_provider_transient_failure`, grup gagal tercatat, tidak ada grup completed | Mock, bukan provider nyata |
| WBS / milestone | **PASSED nilai; provenance terbatas** | 408/408 nilai WBS, 48/48 milestone; dev 16+2, holdout 18+2 | 216/408 baris hanya row-level; 216 false accept di bawah standar per-cell |
| Cost baseline | **PASSED numerik dengan gap** | `hardware_baseline_total` 1.309.670.793 dan `purchase_request_total` 1.375.170.793 direkonsiliasi dari OOXML | Currency/scope tidak dibuktikan oleh sel; L32 di workbook Perhitungan malformed; freshness cache tidak dibuktikan |
| Schedule | **PASSED** | `ticket-03-schedule-comparison` 10/10 | Tidak memakai dokumen nyata di luar fixture |
| Risk | **PASSED dengan batas** | `ticket-05-risk-snapshots` 25/25; replay 22/24 nilai, 24/24 sitasi, 0 false accept, 2 ambiguous | 2 set parsial model; bukan kualitas model umum |
| Klasifikasi/fakta/ringkasan | **PASSED untuk seam yang diuji** | `phase6-document-extraction` 37/37; `phase6-document-summary` 3/3 | 5 tes UI `extracted-details` gagal karena copy/pagination drift |
| Coverage unknown/review | **PASSED** | `partial-evidence-review` 18/18 | Tidak ada DB nyata |
| Queue/fencing transaksi DB | **BLOCKED** | `document-worker-fencing` 1/1 dengan fake; `npm run test:db` skip | Tidak ada disposable DB; tidak menyentuh DB pengguna |
| Full integration suite | **255/276 PASS; 21 FAIL** | Lihat §2 | 21 kegagalan terklasifikasi di §2.2 |
| E2E Playwright / live provider | **BLOCKED** | Tidak dijalankan | Butuh app, browser, DB, dan/atau provider live |
| Kesiapan produksi | **TIDAK DIKLAIM** | — | Ground truth independen, DB terisolasi, dan model live tidak tersedia |

## 2. Eksekusi suite repo

### 2.1 Perintah dan total

```sh
node --test tests/integration/*.test.mjs
```

Hasil: **276 tes, 255 pass, 21 fail, 0 skipped, 0 cancelled, 0 todo**, exit 1. Log: `.local-evaluation/opencode-go-exp-full-offline/tests/integration-suite.log`.

Setiap file juga dijalankan terpisah agar denominator dapat diverifikasi:

```sh
for f in tests/integration/*.test.mjs; do
  b=$(basename "$f" .test.mjs)
  node --test "$f" > ".local-evaluation/opencode-go-exp-full-offline/tests/$b.log" 2>&1
done
```

Rekap per file: `.local-evaluation/opencode-go-exp-full-offline/tests/per-file-summary.tsv`; totalnya juga **276/255/21/0**.

### 2.2 Kegagalan dan klasifikasinya

| File | Jumlah | Penyebab pertama | Klasifikasi |
|---|---:|---|---|
| `document-library` | 8 | `ReferenceError: SectionCard is not defined` / `statusLabelsId is not defined` | Harness tes memotong source component dan tidak menyertakan helper yang sekarang dipakai |
| `extracted-details` | 5 | label Inggris vs UI Indonesia; `Showing 1–10 of 22 matching rows` | Drift copy/pagination UI |
| `epic-3-dashboard` | 4 | `Latest assessment`, `Management focus`, `Approved baseline`, `Under Development` | Drift copy UI (UI berbahasa Indonesia) |
| `epic-4-anomalies` | 1 | regex `/Evidence/` vs UI `Bukti` | Drift copy UI |
| `assurance-integrity-actions` | 1 | mencari RPC `finish_assurance_analysis_with_results`; produksi hanya memanggil `finish_assurance_analysis_with_decision_fingerprint` | Tes stale terhadap nama RPC |
| `evidence-provenance` | 1 | milestone menerima `Cut-off Date` `2026-10-16` (dua kali) dan `complete` `2026-11-05`; tes mengharapkan hanya dua `Due Date` | **Perbedaan perilaku produksi vs ekspektasi tes**; tidak diperbaiki |
| `phase6-document-parser` | 1 | OCR image result `ok:false`; `.venv-ocr` tidak ada, tetapi gate tes memeriksa `gs`/`tesseract` | Runtime OCR lokal tidak tersedia; gate tes tidak sesuai implementasi |
| **Total** | **21** | | |

Catatan penting: 19 dari 21 kegagalan adalah drift harness/copy UI atau nama RPC, bukan bukti kegagalan alur data. Dua kegagalan yang tersisa adalah metadata tanggal (`evidence-provenance`, perilaku produksi vs ekspektasi tes) dan OCR (runtime lokal tidak tersedia). Keduanya dicatat sebagai failure, bukan disembunyikan.

### 2.3 Tes domain yang lulus

| Suite | Hasil |
|---|---|
| `phase6-document-extraction` | 37/37 |
| `phase6-document-parser` | 19/20 |
| `evidence-provenance` | 14/15 |
| `ticket-01-project-budget-assurance` | 11/11 |
| `ticket-02-wbs-comparison` | 7/7 |
| `ticket-03-schedule-comparison` | 10/10 |
| `ticket-05-risk-snapshots` | 25/25 |
| `partial-evidence-review` | 18/18 |
| `assurance-integrity-actions` | 15/16 |
| `document-worker-fencing` | 1/1 (fake) |
| `document-job-write-retry` | 4/4 |
| `phase6-document-summary` | 3/3 |
| `upload-finalize-hash` | 3/3 |
| `gemini-provider` / `groq-provider` | 1/1 / 1/1 (fetch di-mock) |
| `phase6-llm-proxy` | 5/5 (URL helper saja) |

## 3. Audit seam parser dan tes eksperimental baru

### 3.1 Seam publik yang diaudit

- `parseDocumentBuffer()` — `worker/src/services/document-parser.ts:380`.
- `extractDocumentGroups()` — `worker/src/services/document-extraction.ts:511`.
- `splitSourceBlock()` — `document-parser.ts:1984`; `MAX_SOURCE_BLOCK_PART_LENGTH = 4000 - 900 = 3100`.
- `chunkBlockGroup()` — `document-parser.ts:1856`; cap `MAX_SOURCE_REFERENCES_PER_CHUNK = 120` di `:373`.
- `classifyFormulaCache()` — `document-parser.ts:1204`.
- `excelSerialToIsoDate()` — `document-parser.ts:1091`.
- `diagnoseTableAmbiguity()` — `document-parser.ts:1312`.
- `PARSER_VERSION = "document-parser/18"` — `:367`.
- Checkpoint/reuse: `isPermanentCheckpointFailure()` `document-extraction.ts:4570`; cache keyed by parser/schema/contract versions di sekitar `:394` dan `:4048`.

### 3.2 Tes seam baru

```sh
node .scratch/opencode-go-experiment/verify-full-offline-seams.mjs \
  --out .local-evaluation/opencode-go-exp-full-offline/seams
```

Hasil: **8/8 PASS**, exit 0. Log: `logs/seams.log`; hasil JSON: `seams/seams-result.json`.

| Cek | Hasil terukur |
|---|---|
| Baris XLSX 4200 karakter | 2 chunk; 3 referensi baris; tidak ada referensi sel `B2` yang diklaim |
| Cap 120 | maksimum 112 referensi/chunk; 101 cell-level; baris 7–11 hanya row-level; `C3` tetap exact (sheet `Cap`, row 3, column `C`) |
| Header ambigu | 1 warning dengan `date_period_columns` dan `non_square_header` |
| Header duplikat | label `Progress` dipertahankan di dua kolom; **tidak** ada diagnosis duplikat (`diagnosedAsDuplicate:false`) |
| Formula cache | `B2` missing_cache, `C2` cached_empty, `D2` cached_error `#DIV/0!`, `E2` unknown, `F2` cached literal `2`; tidak ada nilai nol karangan |
| Empty vs zero | `B2` literal `0` ada; sel `C2` kosong tidak dipancarkan |
| Excel 1900/1904 | serial 60 invalid; serial 1 dengan `date1904=true` → `1904-01-02` |
| Timeout provider | `fetch` mock melempar `TimeoutError`; outcome `llm_provider_transient_failure`; grup failed tercatat; tidak ada grup completed |

### 3.3 Tes target tambahan

```sh
node --test --test-name-pattern="stale group cache version" tests/integration/evidence-provenance.test.mjs
node --test --test-name-pattern="provider quota defers" tests/integration/phase6-document-extraction.test.mjs
node --test --test-name-pattern="bounded groups retry only failed work" tests/integration/phase6-document-extraction.test.mjs
node --test --test-name-pattern="structured assurance preserves source versions" tests/integration/phase6-document-extraction.test.mjs
node --test --test-name-pattern="per-cell citation survives" tests/integration/phase6-document-extraction.test.mjs
node --test --test-name-pattern="same-named milestones in different WBS scopes|week or month labels|reversed dates" tests/integration/ticket-05-risk-snapshots.test.mjs
```

Hasil: 1/1, 1/1, 1/1, 1/1, 1/1, 2/2 — semuanya exit 0.

### 3.4 Verifikasi sintetis yang sudah ada

```sh
node .scratch/opencode-go-experiment/verify-v3.mjs
node .scratch/opencode-go-experiment/verify-wbs-offline.mjs
node .scratch/opencode-go-experiment/verify-wbs-provenance.mjs
(cd .scratch/opencode-go-experiment && python3 -m unittest -v test_ooxml_reader.py)
```

Hasil: **50/50**, **21/21**, **44/44**, **14/14**; semua exit 0. Ini tes sintetis, bukan ground truth independen.

## 4. Cakupan domain dan ground truth

### 4.1 WBS dan milestone (48 workbook)

```sh
for s in 2026-10-09_w4 2026-10-16_w5 2026-10-23_w6 2026-10-30_w7; do
  node .scratch/opencode-go-experiment/wbs-milestone-offline.mjs \
    --out .local-evaluation/opencode-go-exp-full-offline/wbs/all-48/$s --session $s \
    demo-evidence-fixtures/smart-building-itb/sessions/$s/*.xlsx
done
node .scratch/opencode-go-experiment/score-wbs-offline.mjs \
  --root .local-evaluation/opencode-go-exp-full-offline/wbs/all-48 \
  --out .local-evaluation/opencode-go-exp-full-offline/wbs
```

| Cakupan | WBS nilai | WBS provenance_valid | Milestone |
|---|---:|---:|---:|
| Development (W7 SB02 + SB07) | 16/16 | 16/16 | 2/2 |
| Holdout (W7 SB01 + SB08) | 18/18 | 18/18 | 2/2 |
| All 48 | **408/408** | **408/408** | **48/48** |
| Template `demoted_row_text` | 216/216 | 216/216 | 24/24 |
| Template `structured_row_cells` | 192/192 | 192/192 | 24/24 |

Tetapi `provenance_valid` di scorer lama hanya memeriksa format source ID (`^c\d+s\d+$`), bukan bukti per-cell. Audit independen:

```sh
for s in 2026-10-09_w4 2026-10-16_w5 2026-10-23_w6 2026-10-30_w7; do
  python3 .scratch/opencode-go-experiment/ooxml_reader.py \
    --out .local-evaluation/opencode-go-exp-full-offline/provenance/ooxml/$s \
    demo-evidence-fixtures/smart-building-itb/sessions/$s/*.xlsx
done
node .scratch/opencode-go-experiment/audit-wbs-provenance.mjs \
  --root .local-evaluation/opencode-go-exp-full-offline/wbs/all-48 \
  --fixtures demo-evidence-fixtures/smart-building-itb/sessions \
  --out .local-evaluation/opencode-go-exp-full-offline/provenance
node .scratch/opencode-go-experiment/prototype-cell-aware-split.mjs \
  --audit-root .local-evaluation/opencode-go-exp-full-offline/provenance/audit \
  --ooxml-root .local-evaluation/opencode-go-exp-full-offline/provenance/ooxml \
  --out .local-evaluation/opencode-go-exp-full-offline/provenance/prototype
```

| Audit | Hasil |
|---|---|
| Workbook / baris | 48 / 408 |
| `per_cell_proven` | **192/408** |
| `review_row_level` | **216/408** |
| Nilai persen per-cell vs row-level | 192 vs 216 |
| False accept di bawah standar per-cell | **216** |
| Baris inconsistent | 0 |
| Milestone kolom O | 408 `unbound_no_citation` (output lama tidak menyimpan source ID kolom O) |
| Prototipe cell-aware | 408/408 baris feasible; **2448/2448** sel wajib terpetakan; 0 token hilang/ambigu; max part 2688 karakter |
| Produksi diubah? | **Tidak**; prototipe memakai `proto:` identity, bukan source ID produksi |

Batas ground truth: `expected-results.json` dan fixture dibuat oleh generator yang sama; array WBS tidak membawa kode WBS (matching by row order), dan `next_milestone` adalah nilai derived. Ini bukan benchmark independen atau human-reviewed holdout. Split dev/holdout sudah ditetapkan sebelum run akhir, tetapi tetap fixture sintetis.

### 4.2 Cost baseline

```sh
python3 .scratch/opencode-go-experiment/ooxml_reader.py --all-sheets \
  --out .local-evaluation/opencode-go-exp-full-offline/cost/ooxml \
  demo-evidence-fixtures/smart-building-itb/00_baseline/*.xlsx
python3 .scratch/opencode-go-experiment/audit-cost-baseline.py \
  --ooxml-root .local-evaluation/opencode-go-exp-full-offline/cost/ooxml \
  --expected demo-evidence-fixtures/smart-building-itb/expected-results.json \
  --out .local-evaluation/opencode-go-exp-full-offline/cost
```

| Field | Klaim | Jumlah independen H×K | Total sel | Verdict |
|---|---:|---:|---|---|
| `hardware_baseline_total` | `1309670793.0` | `1309670793.00` | `Spesifikasi Teknis` L33 = `1309670793.0`; `Perhitungan` E9 = `1309670793.0` | **PASSED_NUMERIC_WITH_GAPS** |
| `purchase_request_total` | `1375170793.0` | `1375170793.00` | `Pengajuan` L33 formula `SUM(L2:L32)`, cache `cached_value` = `1375170793.0` | **PASSED_NUMERIC_WITH_GAPS** |

Rincian:

- 31 baris Master Hardware (A2:A32) untuk masing-masing workbook; semua baris H×K sama dengan L pada dua workbook utama.
- `Spesifikasi Teknis` L33 adalah literal `TOTAL`, bukan formula.
- `Pengajuan` L33 adalah formula `SUM(L2:L32)` dengan cache; freshness tidak dibuktikan (tidak ada rekalkulasi Excel).
- `Perhitungan` E9 berlabel `Hardware` (C9) dan `Pengeluaran` (E4); E9 literal 1.309.670.793; E10 `SUM(E5:E9)` cache 4.250.383.389,3 dan cocok dengan jumlah komponen E6+E7+E8+E9.
- **Gap data:** `Perhitungan` Master Hardware L32 berisi teks malformed `Rp11,500,00`. Jika sel itu dikeluarkan, jumlah kolom L adalah 1.298.170.793, yaitu 11.500.000 di bawah total yang diklaim; rekomputasi H×K tetap mencapai 1.309.670.793. Ini tidak diubah karena fixture asli harus dipertahankan.
- **Gap label/scope/currency:** tidak ada sel yang menyatakan currency untuk total `Spesifikasi Teknis`; IDR berasal dari metadata pack, bukan dari sel. Scope adalah sheet `Master Hardware` dan pack baseline, bukan label proyek eksplisit. Karena itu klaim currency/scope tidak boleh disebut cell-proven.

### 4.3 C: 48 workbook × 6 field (dry-run)

```sh
for s in 2026-10-09_w4 2026-10-16_w5 2026-10-23_w6 2026-10-30_w7; do
  node .scratch/opencode-go-experiment/evidence-v2.mjs --variant C --dry-run \
    --out .local-evaluation/opencode-go-exp-full-offline/c48/$s \
    demo-evidence-fixtures/smart-building-itb/sessions/$s/*.xlsx
done
V3_ROOT=.local-evaluation/opencode-go-exp-full-offline/c48 \
  node .scratch/opencode-go-experiment/score-v3.mjs
```

| Metrik | Hasil |
|---|---:|
| File / field / checks | 48 / 6 / **288** |
| Nilai cocok | **284/288** |
| Provenance valid | **284/288** |
| Provenance struktural (field found) | **284/284** |
| Nilai + provenance | **284/288** |
| `found` | **284** |
| `unknown` | **4** (W4 SB01, SB02, SB04, SB06) |
| `review` / `ambiguous` | 0 / 0 |
| False accept | **0** |
| Origin variance/RAG | 48/48 `cached_formula`; 96/96 `rule_matched`; 48/48 RAG `recomputed_from_dependency` setuju |
| Risk entries | 44 resolved, 44 evidence lengkap, 44 structural valid, 44 candidate-complete; 4 unknown |

Empat mismatch adalah `unknown` yang disengaja: tidak ada baris risiko yang dapat diikat dan kelengkapan log tidak terbukti. Ini **bukan** bukti “tidak ada risiko” dan bukan daftar kosong.

### 4.4 Replay B: 4 workbook W7

```sh
node .scratch/opencode-go-experiment/evidence-v2.mjs \
  --replay .local-evaluation/opencode-go-exp-v2 \
  --out .local-evaluation/opencode-go-exp-full-offline/c48 --session replay-v3
REPLAY_ROOT=.local-evaluation/opencode-go-exp-full-offline/c48/replay-v3 \
  node .scratch/opencode-go-experiment/score-b-replay-v3.mjs
```

| Metrik | Hasil |
|---|---:|
| Checks | **24** |
| Nilai cocok | **22/24** |
| Provenance valid | **22/24** |
| Sitasi struktural valid | **24/24** |
| Nilai + provenance | **22/24** |
| `found` | 22 |
| `ambiguous` | 2 (SB07/SB08 `open_risk_ids`) |
| False accept | **0** |
| Completeness failure | 2: model memilih hanya `R-SB07-002` / `R-SB08-002`; kandidat deterministik juga memuat `R-SB07-001` / `R-SB08-001` |

Replay hanya memvalidasi ulang `model_output.parsed` historis; tidak ada model yang dipanggil.

## 5. Kegagalan, checkpoint, dan ketersediaan

- **429 / partial groups:** `provider quota defers the remaining groups for retry instead of reporting absent evidence` lulus 1/1. Grup yang selesai tidak dikirim ulang; grup 429 tercatat failed, bukan absence.
- **Timeout:** seam baru lulus; `fetch` mock `TimeoutError` menghasilkan `llm_provider_transient_failure`, grup failed tersimpan, tidak ada grup completed.
- **Reuse cache:** `bounded groups retry only failed work, reuse exact cached outputs` lulus 1/1; output validated yang sama tidak dikirim ulang.
- **Versi parser/schema/contract:** `a stale group cache version is not reused and a cache hit re-derives provenance` lulus 1/1; `structured assurance preserves source versions` lulus 1/1 (parser version dihormati, contract version `pmo-assurance-observations/1`).
- **Sumber sitasi bertahan end-to-end:** `per-cell citation survives a sibling cell's unresolved formula` lulus 1/1; referensi baris/sel yang tidak valid tetap ditolak.
- **Cross-period / cross-sheet:** 2 tes target risk cross-period lulus; `verify-v3` 50/50 mencakup cross-sheet, cross-row, cut-off periode lain, status ambigu/closed, duplikasi ID, set risiko parsial, dan formula threshold.
- **DB/fencing:** `npm run test:db` exit 0 dengan pesan `skip: set XASS_DB_CONTAINER ...`. `tests/database/assurance-integrity.test.mjs` adalah opt-in dan tidak dijalankan tanpa port/DB disposable. `document-worker-fencing` 1/1 hanya membuktikan route menolak claim superseded dengan fake Supabase, bukan transaksi DB nyata.
- **Cache freshness:** tidak ada bukti freshness; yang dibuktikan hanya bentuk formula, status cache, dan konsistensi aritmetika. Ini tetap non-claim.

## 6. Akuntansi request dan bukti tidak ada jaringan

- C dry-run: 48/48 file `status=ok`, `requests=0`, `retry_count=0`, `model_called=false`.
- Replay: 4/4 file `status=ok`, `requests=0`, `api_called=false`.
- Tidak ada `--env-file`, tidak ada `run.mjs`, `baseline-v2.mjs`, atau `evidence-v2.mjs` tanpa `--dry-run`/`--replay`.
- Semua `fetch` di tes repo dan seam baru adalah mock lokal (`globalThis.fetch` diganti). Tidak ada request ke `opencode.ai`, Ollama, Gemini, Groq, Supabase, atau host lain.
- Usage provider pada artefak dry-run/replay adalah `null`/`reported:false`, bukan nol yang diklaim sebagai pemakaian nyata. Tidak ada usage API baru.

## 7. Integritas, reproduksibilitas, dan artefak

### 7.1 Pemeriksaan integritas

```sh
shasum -a 256 -c .local-evaluation/opencode-go-exp-full-offline/logs/local-evaluation-before.sha256 --status
# exit 0: 514 file output lama tidak berubah

find demo-evidence-fixtures/smart-building-itb -type f \
  -not -path '*/__pycache__/*' -not -name '.DS_Store' -print0 \
  | sort -z | xargs -0 shasum -a 256 > /tmp/xass-fixture-hashes-after.txt
diff -u .local-evaluation/opencode-go-exp-full-offline/logs/fixtures-before.sha256 \
  /tmp/xass-fixture-hashes-after.txt
# exit 0: 68 fixture identik

git diff --stat -- worker src demo-evidence-fixtures tests supabase package.json package-lock.json
# kosong
```

### 7.2 Artefak utama

| Artefak | SHA-256 |
|---|---|
| `c48/score-v3.json` | `230ecd8e1203189a0d70224fc46acc1f21a529aa20560f60bb51210de0b2fc3e` |
| `c48/replay-v3/score-b-replay-v3.json` | `e8bffa182193bd0d5c8ce96571d66ff135c5f1261a5444b277ad197af6c40fa4` |
| `wbs/score-wbs.json` | `33e39a001781fba872743efbff8c5ecd244a67927b54c741398087ef432a8dde` |
| `provenance/audit-summary.json` | `a7d806706428bec68e892ae7d2724fea1a6df00d677274bcec5b45a8566524a5` |
| `provenance/prototype/prototype-summary.json` | `4c21f773e0b46d42a025aafcf7eea693e591d8cc552d7cccdbd12d2899c8a1eb` |
| `cost/cost-baseline-audit.json` | `7f6220d3d6bd4c6993abb97a7303a7ecafb3ced56799f2985611327ac4123558` |
| `seams/seams-result.json` | `8f67ca796ae357a5c4fa159d4ec3b3b053f4987edb4d72a21e4208dcf3415381` |

`graphify update .` setelah perubahan script eksperimen: **3698 nodes, 8847 edges, 152 communities**; tidak memakai LLM.

### 7.3 Perintah lengkap yang dijalankan

Semua perintah ada di `.scratch/opencode-go-experiment/README.md` bagian "Full offline validation (v7)". Ringkasnya:

```sh
node --test tests/integration/*.test.mjs
npm run test:db
node .scratch/opencode-go-experiment/verify-v3.mjs
node .scratch/opencode-go-experiment/verify-wbs-offline.mjs
node .scratch/opencode-go-experiment/verify-wbs-provenance.mjs
node .scratch/opencode-go-experiment/verify-full-offline-seams.mjs \
  --out .local-evaluation/opencode-go-exp-full-offline/seams
(cd .scratch/opencode-go-experiment && python3 -m unittest -v test_ooxml_reader.py)
# C dry-run, replay, score-v3, score-b-replay-v3
# WBS 48, score-wbs-offline
# ooxml_reader, audit-wbs-provenance, prototype-cell-aware-split
# ooxml_reader --all-sheets + audit-cost-baseline.py
graphify update .
```

## 8. Blocker dan non-claim

**FAILED berdasarkan bukti:**

1. `evidence-provenance`: metadata milestone menerima `Cut-off Date` dan `complete` sebagai milestone; tes mengharapkan hanya `Due Date`. Ini perbedaan perilaku yang belum diperbaiki.
2. `phase6-document-parser`: OCR test gagal karena `.venv-ocr` tidak ada; gate tes memeriksa `gs`/`tesseract`, bukan runtime PP-OCRv6 yang dipakai produksi.
3. UI/harness: 18 kegagalan karena `SectionCard`/`statusLabelsId` tidak ada di slice tes atau copy UI sudah berbahasa Indonesia; ini bukan bukti alur data, tetapi tetap kegagalan suite.
4. `assurance-integrity-actions`: tes mencari nama RPC lama `finish_assurance_analysis_with_results`; produksi memakai `finish_assurance_analysis_with_decision_fingerprint`.

**BLOCKED:**

1. **Ground truth independen / human-reviewed holdout** — tidak ada. Expected dan fixture dibuat generator yang sama; WBS tidak punya kode identitas dan `next_milestone` derived. Semua skor WBS/C/B adalah kecocokan terhadap fixture ini, bukan akurasi dunia nyata.
2. **Database terisolasi** — tidak tersedia. Queue/fencing, pgTAP, dan transaksi Supabase tidak dijalankan terhadap DB nyata; hanya fake/unit.
3. **Live provider / LLM** — tidak dijalankan. 429/timeout diuji dengan mock; kualitas model, biaya, latency, dan perilaku prompt nyata tidak dinilai.
4. **E2E Playwright** — tidak dijalankan; membutuhkan app, browser, DB, dan/atau service live.
5. **OCR** — runtime lokal tidak tersedia; OCR gambar/PDF scan tidak diverifikasi.
6. **Currency/scope cost** — tidak ada sel currency/scope eksplisit; IDR berasal dari pack. Perhitungan L32 malformed; freshness cache tidak dibuktikan.
7. **Duplicate header** — produksi tidak mendiagnosis label header duplikat; hanya trigger ambiguity lain (periode/non-square/merged/multi-row) yang diberi warning.
8. **WBS per-cell** — 216 baris demoted hanya row-level; 216 false accept jika output lama disebut per-cell. Prototipe membuktikan feasibility, bukan perilaku produksi.

**Tidak diklaim:**

- Produksi siap, benchmark, atau validasi biaya/akurasi model.
- Generalisasi ke dokumen nyata di luar 48 workbook satu keluarga fixture.
- Bahwa 408/408 nilai WBS berarti identitas atau kualitas WBS nyata.
- Bahwa cache yang diterima adalah cache mutakhir.
- Bahwa set risiko `unknown`/`ambiguous` berarti tidak ada risiko.

## Lampiran A — rekap per file integration

```
assurance-integrity-actions          exit 1  tests 16  pass 15  fail 1  skip 0
demo-evidence-scenarios              exit 0  tests 2   pass 2   fail 0  skip 0
document-job-write-retry             exit 0  tests 4   pass 4   fail 0  skip 0
document-library                     exit 1  tests 8   pass 0   fail 8  skip 0
document-worker-fencing              exit 0  tests 1   pass 1   fail 0  skip 0
epic-1-foundation                    exit 0  tests 4   pass 4   fail 0  skip 0
epic-3-dashboard                     exit 1  tests 7   pass 3   fail 4  skip 0
epic-4-anomalies                     exit 1  tests 3   pass 2   fail 1  skip 0
evidence-provenance                  exit 1  tests 15  pass 14  fail 1  skip 0
extracted-details                    exit 1  tests 6   pass 1   fail 5  skip 0
fact-review-actions                  exit 0  tests 4   pass 4   fail 0  skip 0
fact-review-query                    exit 0  tests 3   pass 3   fail 0  skip 0
gemini-provider                      exit 0  tests 1   pass 1   fail 0  skip 0
groq-provider                        exit 0  tests 1   pass 1   fail 0  skip 0
partial-evidence-review              exit 0  tests 18  pass 18  fail 0  skip 0
phase-4-assurance-analysis           exit 0  tests 4   pass 4   fail 0  skip 0
phase-6-archive-size                 exit 0  tests 1   pass 1   fail 0  skip 0
phase-6-archive-status               exit 0  tests 2   pass 2   fail 0  skip 0
phase-6-evidence-metadata            exit 0  tests 4   pass 4   fail 0  skip 0
phase-6-evidence-readiness           exit 0  tests 4   pass 4   fail 0  skip 0
phase-6-file-types                   exit 0  tests 1   pass 1   fail 0  skip 0
phase-6-review-evidence-filters      exit 0  tests 2   pass 2   fail 0  skip 0
phase-6-source-evidence              exit 0  tests 1   pass 1   fail 0  skip 0
phase-6-submission-scope             exit 0  tests 1   pass 1   fail 0  skip 0
phase-6-upload-batch                 exit 0  tests 5   pass 5   fail 0  skip 0
phase-6-upload-job-retry             exit 0  tests 3   pass 3   fail 0  skip 0
phase-6-zip-intake                   exit 0  tests 11  pass 11  fail 0  skip 0
phase6-advisor                       exit 0  tests 9   pass 9   fail 0  skip 0
phase6-document-extraction           exit 0  tests 37  pass 37  fail 0  skip 0
phase6-document-parser               exit 1  tests 20  pass 19  fail 1  skip 0
phase6-document-summary              exit 0  tests 3   pass 3   fail 0  skip 0
phase6-e2e-provider                  exit 0  tests 3   pass 3   fail 0  skip 0
phase6-llm-proxy                     exit 0  tests 5   pass 5   fail 0  skip 0
phase6-n8n-document-processing       exit 0  tests 8   pass 8   fail 0  skip 0
review-period                        exit 0  tests 3   pass 3   fail 0  skip 0
ticket-01-project-budget-assurance   exit 0  tests 11  pass 11  fail 0  skip 0
ticket-02-wbs-comparison             exit 0  tests 7   pass 7   fail 0  skip 0
ticket-03-schedule-comparison        exit 0  tests 10  pass 10  fail 0  skip 0
ticket-05-risk-snapshots             exit 0  tests 25  pass 25  fail 0  skip 0
upload-finalize-hash                 exit 0  tests 3   pass 3   fail 0  skip 0
TOTAL                                40 files 276 tests 255 pass 21 fail 0 skip
```

## Lampiran B — non-claim eksplisit

- Bukan ground truth bisnis independen; pembaca OOXML memeriksa file yang sama.
- Bukan bukti kelengkapan WBS, akurasi nama work package, atau kesegaran cache.
- Bukan evaluasi kualitas model/provider; tidak ada model yang dipanggil.
- Bukan bukti transaksi database nyata; tidak ada DB yang disentuh.
- Bukan perubahan produksi; `worker/`, `src/`, fixture, tes, dan output lama tidak diubah.
- Bukan klaim bahwa `proto:` identity adalah source ID produksi.
- Bukan klaim bahwa 48 workbook mewakili dokumen dunia nyata; ini fixture pack yang dibuat generator yang sama dengan expected.
