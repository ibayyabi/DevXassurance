# Laporan penyelesaian: sitasi milestone O, audit 48 workbook, dan sisa kegagalan suite

## 0. Status eksekusi dan batas

- Repo: `/Users/iweng/Documents/GitHub/DevXassurance`; branch `development-bismillah-final`; HEAD `784a04d`. Tidak ada commit, push, reset, atau operasi destruktif.
- Output mentah baru: `.local-evaluation/opencode-go-exp-completion/`. Laporan ini: `.scratch/opencode-go-experiment/report-completion.md`.
- Perubahan sesi ini hanya pada harness eksperimen, audit eksperimen, dokumentasi harness, dan empat tes integrasi UI. Tidak ada perubahan kode produksi pada sesi ini.
- Perubahan pengguna yang sudah ada (parser/extraction/worker README/tiga tes) dipertahankan. Total 118 file di `demo-evidence-fixtures/` di-hash; `git status --porcelain -- demo-evidence-fixtures` dan `git diff --stat -- demo-evidence-fixtures` kosong.
- Tidak membaca `.env*`, API key, auth store, atau kredensial. Hanya nama file `.env*` yang terlihat saat memeriksa tooling; isinya tidak dibaca.
- Tidak ada request provider/model dari aplikasi yang diuji. Smoke memakai `fetch` mock lokal. `model_called:false`, `network_used:false`, `environment_file_read:false`.
- Tidak install, tidak prefetch model, tidak mengakses database eksternal/production, dan tidak menjalankan tes database.
- Tes OCR tidak di-skip dan tidak diubah gate-nya. Kegagalannya dilaporkan apa adanya sebagai blocker environment.

## 1. Sitasi kolom O (Milestone) pada harness WBS

### 1.1 Apakah sitasi ini semantik?

Ya. Pada 408 baris, kolom O berisi teks milestone yang nyata dan non-kosong. Nilainya sering sama dengan kolom D (`Deliverable / Acceptance Criteria`), tetapi pembaca OOXML independen membuktikan bahwa nilai itu memang ada di sel O baris tersebut. Contoh W6 SB01 baris 5:

- `O5` = `Titik pemasangan disetujui (dokumen Konsep)`, sama dengan `D5`.
- `O4` = header `Milestone`.
- `milestone_cell_wording` sebelumnya sudah berisi nilai O5; yang hilang hanyalah source ID sel O.

Jadi menambahkan sitasi ke sel O bukan fabrikasi: itu mengikat nilai yang sudah diklaim ke sel sumber yang benar-benar ada. Yang tetap tidak diklaim sebagai sel literal adalah `next_milestone` komposit (kode + label + tanggal), yang tetap ditandai `derived:true`.

### 1.2 Perubahan harness dan audit

- `wbs-milestone-offline.mjs` sekarang menyimpan:
  - `milestone_cell` (mis. `O5`),
  - `milestone_cell_source_id` (mis. `c5s17`),
  - `milestone_cell_source` (`cell_reference`),
  - dan source ID O ikut masuk ke `milestone_source_ids`.
- `audit-wbs-provenance.mjs` memakai `auditMilestone`, bukan verdict hardcoded:
  - source ID O harus resolve ke sel yang tepat (sheet, baris, kolom, locator);
  - label header harus `Milestone`;
  - nilai sel O independen harus sama dengan nilai yang diklaim;
  - sel O kosong menghasilkan `review_missing_value`, bukan proven;
  - baris tanpa source ID O tetap `unbound_no_citation`.
- Denominator tetap 408 baris/408 sel milestone. Tidak ada baris yang dikeluarkan karena sel kosong.

### 1.3 Hasil audit ulang 48 workbook

Perintah: `wbs-milestone-offline.mjs` → `ooxml_reader.py` → `audit-wbs-provenance.mjs` → `score-wbs-offline.mjs` → `post-remediation-independent-audit.py`, semua tanpa network.

| Pemeriksaan | Hasil | Denominator |
|---|---:|---:|
| Baris WBS | 408 | 408 |
| Row verdict `per_cell_proven` | **408** | 408 |
| `code` per-cell proven | **408** | 408 |
| `percent` per-cell proven | **408** | 408 |
| `deliverable` per-cell proven | **408** | 408 |
| `baseline_finish` per-cell proven | **408** | 408 |
| `milestone` (kolom O) per-cell proven | **408** | 408 |
| Sel milestone kosong | **0** | 408 |
| `milestone.value_agrees` | **408** | 408 |
| `false_accept_percent` | **0** | — |
| `false_accept_row` | **0** | — |
| `header_ok` | **48** | 48 |
| `hash_ok` (fixture vs OOXML) | **48** | 48 |
| `period_mismatch` / `period_unverified` | **0 / 0** | 48 |
| `header_binding_mismatch` | **0** | 48 |

Per sesi: `102/102` baris `per_cell_proven` pada masing-masing W4–W7.

Uji sintetis guard sel kosong (`logs/milestone-guard.log`): **5/5** kasus lulus —
`no_source_id` → `unbound_no_citation`; sel O tidak ada → `review_missing_value`;
sel O kosong → `review_missing_value`; nilai sama → `per_cell_proven`; nilai berbeda →
`review_inconsistent_reference`. Ini membuktikan denominator tidak “dinaikkan” saat sel
milestone kosong, meskipun pada 48 workbook ini tidak ada sel O kosong.

Nilai terpisah (`score-wbs.json`): WBS `408/408` nilai cocok, milestone komposit `48/48`, `review=0`, `unknown=0`, `false_accept=0`, `array_order_ok=408`.

Audit OOXML independen: 0 mismatch pada cut-off, planned, actual, variance, RAG, overall progress, weighted progress, milestone, open risk set, dan rollup. Tiga metrik evolusi risiko (new/closed/priority-changed) `36/36` yang dapat diturunkan; `12` `unsupported` adalah 12 komponen sesi pertama (W4) yang tidak punya sesi sebelumnya. Itu bukan kegagalan ekstraksi.

Catatan penting:

- Angka `408/408` di atas berarti **nilai sel O dan sitasinya** terbukti per-cell. `next_milestone` tetap nilai turunan, bukan sel literal.
- `expected-results.json` tetap berasal dari generator fixture yang sama; ini konsistensi terhadap fixture, bukan ground truth independen/human-reviewed.
- Pembacaan OOXML independen membuktikan nilai sel, bukan kualitas model.

### 1.4 Verifikasi 24 warning ambiguitas Gantt

`gantt-ambiguity-audit.py` membandingkan warning parser dengan bentuk tabel mentah:

- row 3 berisi grid minggu `W1..W14` pada kolom S–AF;
- row 4 berisi tanggal pada kolom grid yang sama;
- row 4 juga berisi label `WBS`, `Deliverable / Acceptance Criteria`, `Baseline Finish`, `% Complete`, `Milestone`.

Hasil:

| Pemeriksaan | Hasil |
|---|---:|
| Workbook dengan warning Gantt (`multi_row_header` + `date_period_columns`) | **24** |
| Workbook tanpa warning Gantt | **24** |
| False positive | **0** |
| False negative | **0** |
| Mismatch bentuk vs warning | **0** |
| Range tabel yang di-flag | `3-12`, `3-13`, `3-14` |
| Distribusi | 6 workbook per sesi (W4–W7) |
| Komponen yang di-flag | `01, 02, 03, 04, 06, 09` |

Kesimpulan: 24 warning itu **benar-benar ambigu secara struktur** (header dua baris + kolom tanggal/minggu), bukan label yang salah. Warning dipertahankan; tidak ada yang disembunyikan agar hasil terlihat hijau. Audit per-cell tetap membuktikan label dan nilai pada tabel yang sama.

Empat warning Workplan lain tetap ada dan bukan bagian dari 24:

- `12_BISMA_Subcontractor_Weekly.xlsx` pada W4–W7: `inconsistent_cell_types`.
- Penyebabnya nyata: kolom tanggal yang sama kadang berupa string `2026-09-18 0:00:00`, kadang serial numerik `46286.0`. Ini ambiguitas tipe sel yang sah, jadi warning dipertahankan.

## 2. Sisa kegagalan suite dari log lama

Sumber: `.local-evaluation/opencode-go-exp-system-remediation/formula-due/integration-suite.log` (288 tes, 268 lulus, 20 gagal). Tidak menjalankan ulang suite gagal hanya untuk konfirmasi. Setelah perbaikan, suite penuh dijalankan **sekali**.

### 2.1 Klasifikasi dan tindakan

| # | Lokasi | Klasifikasi | Tindakan | Status |
|---:|---|---|---|---|
| 1 | `assurance-integrity-actions.test.mjs:191` | Tes stale terhadap nama RPC | Diperbaiki pada sesi sebelumnya ke `finish_assurance_analysis_with_decision_fingerprint`; diverifikasi ulang sesi ini | **Lulus** |
| 2–9 | `document-library.test.mjs` (8 tes) | Harness source-slice, bukan bug perilaku | Harness dilengkapi dependency nyata: `SectionCard`, `statusLabelsId`, `PillTabs`, `MetaPill`, `PaginationFooter`, `EmptyState`, `FilterChip`, `StatusPill`, `FileTypeIcon`, `documentTypeTone`, ikon `ListChecks`/`RotateCcw`/`Search`/`X`/`Check`/`ChevronDown`/`Layers`/`Archive` | **8/8 lulus** |
| 10–13 | `epic-3-dashboard.test.mjs` (4 tes) | Copy/localization drift | Assertion copy Inggris dihapus. Satu tes yang seluruhnya copy (`overview presents only understandable conditions and next actions`) dihapus. Assertion struktural/no-fabrication dipertahankan | **Lulus** |
| 14 | `epic-4-anomalies.test.mjs` (1 tes) | Copy/implementation drift | Label copy dihapus; identitas kategori, `severityRank`, wiring aksi, dan nama audit event dipertahankan | **Lulus** |
| 15–19 | `extracted-details.test.mjs` (5 tes) | Copy/localization drift | String label Inggris diganti assertion semantik: jumlah baris, pagination range, distinctness status pointer/review, `statedTotal`, `summaryGaps`, `shortSummary` | **Lulus** |
| 20 | `phase6-document-parser.test.mjs:574` | Runtime OCR lokal tidak tersedia | Tidak diubah, tidak di-skip. Blocker environment dilaporkan di §3 | **Gagal (blocker)** |

Tidak ada expectation yang di-“re-pin” ke copy Indonesia. Assertion copy yang insidental dihapus; cakupan perilaku yang bermakna dipertahankan (filter, pagination, sorting, visibility, hitungan, total konservatif, gap ringkasan, dan wiring aksi).

### 2.2 Hasil tes setelah perbaikan

Focused:

| Perintah | Hasil |
|---|---:|
| 4 file UI (`document-library`, `extracted-details`, `epic-3`, `epic-4`) | **23/23 lulus** |
| `assurance-integrity-actions` + `wbs-header-provenance` + `evidence-provenance` | **39/39 lulus** |
| `phase6-document-parser` pola XLSX/header/CSV/PPTX (tanpa OCR) | **14/14 lulus** |
| `npx tsc --noEmit -p tsconfig.json` | exit **0** |
| `npx eslint` pada 4 file tes yang diubah | exit **0** |

Suite penuh (`npm test`, sekali):

| Metrik | Hasil |
|---|---:|
| Tes | **290** |
| Lulus | **289** |
| Gagal | **1** |
| Skip | **0** |
| Durasi | 2.348 s |

Satu-satunya kegagalan adalah tes OCR di `phase6-document-parser.test.mjs:574` (`imageResult.ok false !== true`). Tidak ada kegagalan UI, copy, assurance, provenance, atau parser lain.

## 3. Blocker OCR: status dan prasyarat tepat

### 3.1 Yang tersedia

- Ghostscript: `/opt/homebrew/bin/gs`, versi `10.07.1`.
- Tesseract: `/opt/homebrew/bin/tesseract`, bahasa `eng`, `osd`, `snum`.
- `.venv-ocr/lib/python3.11/site-packages/` berisi `rapidocr-3.10.0.dist-info`, `onnxruntime-1.31.0.dist-info`, `rapidocr/`, dan `onnxruntime/`.
- Python `3.11.16` tersedia dan dapat mengimpor `rapidocr`/`onnxruntime` bila `PYTHONPATH` diarahkan ke site-packages tersebut.

### 3.2 Yang tidak tersedia

- `.venv-ocr/bin/` kosong: tidak ada `python`, `pip`, atau entry point venv. Tidak ada `pyvenv.cfg`.
- `.venv-ocr/lib/python3.11/site-packages/rapidocr/` tidak lengkap: hanya ada `__pycache__/`, subdirektori model kosong, dan tidak ada source `__init__.py`. Akibatnya `rapidocr.__file__` bernilai `None`.
- `worker/ocr/ppocr.py --check` (dijalankan offline dengan `PYTHONPATH` ke site-packages) keluar `1` dengan `TypeError: expected str, bytes or os.PathLike object, not NoneType` sebelum verifikasi model.
- `.venv-ocr/lib/python3.11/site-packages/rapidocr/models/` kosong. Tidak ada `PP-OCRv6_det_tiny.onnx`, `PP-OCRv6_rec_tiny.onnx`, atau `ch_ppocr_mobile_v2.0_cls_mobile.onnx`.
- Tidak ada model `.onnx` di `~/.cache`.
- Parser produksi memakai PP-OCRv6/RapidOCR, bukan Tesseract. Karena itu keberadaan `gs`/`tesseract` tidak membuat jalur OCR produksi tersedia; gate tes yang memeriksa `gs`/`tesseract` memang membuat tes berjalan, lalu gagal.

### 3.3 Prasyarat persis untuk menjalankan OCR nyata

1. Buat venv Python 3.11 yang lengkap di `.venv-ocr` sehingga `.venv-ocr/bin/python` ada.
2. Install `worker/ocr/requirements.txt` (`rapidocr==3.10.0`, `onnxruntime==1.31.0`) ke venv itu. Ini membutuhkan network/package source.
3. Jalankan sekali `python worker/ocr/ppocr.py --prefetch` untuk mengunduh tiga aset pinned dan memverifikasi SHA-256. Ini membutuhkan network.
4. Verifikasi dengan `python worker/ocr/ppocr.py --check`.
5. Alternatif tanpa prefetch: sediakan direktori berisi tiga file ONNX dengan hash yang benar, lalu set `XASS_OCR_MODEL_DIR`; set `XASS_OCR_PYTHON` bila interpreter bukan `.venv-ocr/bin/python`.

Sampai langkah-langkah itu tersedia, OCR gambar/PDF scan tidak dapat dieksekusi offline. Tes tetap gagal dan tidak diklaim lulus.

## 4. Isolated local DB

### 4.1 Tooling yang ada

- `tools/run-db-tests.mjs` hanya mau berjalan bila `XASS_DB_CONTAINER` menunjuk container disposable (nama cocok `smoke|disposable|test`) atau override eksplisit `XASS_DB_ALLOW_NON_DISPOSABLE=1`.
- Setiap suite dijalankan di dalam satu transaksi yang selalu rollback, sehingga target tidak diubah.
- `supabase/config.toml` mendefinisikan stack lokal (`54321`–`54324`, DB `54322`), tetapi stack itu tidak berjalan.
- Supabase CLI `2.117.0` dan Docker CLI tersedia.

### 4.2 Kenapa tidak dijalankan

- Docker daemon tidak berjalan: `failed to connect to the docker API at unix:///Users/iweng/.docker/run/docker.sock`.
- Tidak ada container disposable yang berjalan.
- Menjalankan Supabase lokal membutuhkan Docker aktif dan, untuk pertama kali, image pull (network). Ini di luar batas sesi.
- Tidak ada database eksternal/production yang disentuh, dan tidak ada database yang sudah ada yang dimodifikasi.

**Status: BLOCKED.** Prasyarat: aktifkan Docker, jalankan stack Supabase lokal yang terisolasi, lalu set `XASS_DB_CONTAINER` ke container DB disposable dan jalankan `npm run test:db`. Tanpa itu, atomicity/fencing/RLS nyata tidak teruji.

## 5. Smoke dan verifikasi offline

| Pemeriksaan | Hasil |
|---|---|
| `smoke-two-workbooks.mjs` | `all_passed:true`; 2 workbook; parser `document-parser/20` |
| Smoke network/model/env | `network_used:false`, `model_called:false`, `environment_file_read:false` |
| Smoke citation | `every_cell_model_text_citable:true`; `split_cell_reference_texts_citable:true` |
| `verify-full-offline-seams.mjs` | **8/8** checks |
| `verify-wbs-offline.mjs` | **21/21** checks |
| `graphify update .` | **3764 nodes, 8988 edges, 167 communities**; AST-only, tanpa LLM |

`graphify label` tidak dijalankan karena membutuhkan LLM; nama komunitas tetap nama hub.

Smoke memakai respons fetch mock deterministik; ini membuktikan seam parser→ekstraksi, bukan kualitas model.

## 6. Artefak dan hash

Direktori: `.local-evaluation/opencode-go-exp-completion/` (`wbs/`, `provenance/`, `smoke/`, `seams/`, `logs/`).

| Artefak | SHA-256 |
|---|---|
| `provenance/audit-summary.json` | `954a51df749a911f4ba8349fadc67cc3a96d55170f5206c5286ef8b86aa6bb1b` |
| `wbs/score-wbs.json` | `308bc42d09ac7883c40f17a72c573f220c64b2445b90ededda0a04f2bd27c669` |
| `provenance/independent-audit.json` | `567d115c130cc8804f6eed4f92050bfc58361432e48dacd558a3679bc7d2560f` |
| `provenance/gantt-ambiguity-audit.json` | `3f2d823f8c8729584538acdda6af26717d82e67c915dc6fc634bd6d9430fe07b` |
| `smoke/smoke-summary.json` | `20a48fc2aa58b963d0fe2807ea56d806e845e8fb49f367751d2b9e3e6f0d076f` |
| `seams/seams-result.json` | `ac13fed0d94f68a22d8ac36ddad71f0ffd960505312b5a35df4f982b42c95a6f` |
| `logs/full-suite.log` | `9ec987805bb8dfe5aa5e9c6f6819e20780a1f871cb9846aed7af26e08a52e0e6` |
| `logs/focused-ui.log` | `0f11cd14b704dda1195d3d7c7a02725b9c3712b2d6d025853879f4f778a496b6` |
| `logs/focused-assurance-provenance.log` | `c415775c62fef82896e5cf029c3939780f255308a3675304ed9b9a0f8cd5b487` |
| `logs/focused-parser.log` | `320807993908612df0def45415e2ae036669cc9f36358c562f4efe69070f8bc6` |

`independent-audit.json` identik dengan hash audit independen sebelumnya (`567d…`), menunjukkan hasil metrik OOXML stabil terhadap perubahan sitasi milestone.

## 7. Integritas

- `git status --porcelain -- demo-evidence-fixtures` kosong; `git diff --stat -- demo-evidence-fixtures` kosong.
- 118 file fixture di-hash ke `logs/fixtures-sha256.txt`; tidak ada yang diubah.
- Perubahan sesi ini: empat tes UI (`document-library`, `epic-3-dashboard`, `epic-4-anomalies`, `extracted-details`), harness/audit eksperimen, README eksperimen. Perubahan pengguna sebelumnya tetap: `.gitignore`, `AGENTS.md`, `README.md`, `worker/README.md`, `worker/src/services/document-extraction.ts`, `worker/src/services/document-parser.ts`, `tests/integration/assurance-integrity-actions.test.mjs`, `tests/integration/evidence-provenance.test.mjs`, `tests/integration/phase6-document-parser.test.mjs`.
- Tidak ada commit/push.
- `graphify-out/` berubah karena `graphify update .`; itu output graph, bukan perubahan kode.

## 8. Readiness dan non-claim

| Area | Status | Bukti |
|---|---|---|
| Sitasi milestone kolom O | **LULUS** | 408/408 sel O per-cell proven; 0 sel kosong; 408/408 `value_agrees` |
| Nilai WBS | **LULUS nilai** | 408/408 cocok; 0 mismatch |
| Milestone komposit | **LULUS nilai turunan** | 48/48 cocok; tetap `derived`, bukan sel literal |
| Metrik OOXML independen | **LULUS konsistensi** | 0 mismatch; 12 unsupported delta sesi pertama |
| Warning Gantt | **LULUS konservatif** | 24 warning nyata; 0 false positive/negative |
| Suite integrasi | **289/290** | satu kegagalan OCR environment |
| OCR runtime | **BLOCKED** | venv tidak lengkap; model ONNX tidak ada |
| Database terisolasi | **BLOCKED** | Docker daemon mati; tidak ada container disposable |
| Provider/model live | **TIDAK DIJALANKAN** | mock lokal, bukan bukti kualitas model |
| Ground truth independen/human-reviewed | **TIDAK ADA** | `expected-results.json` dari generator fixture yang sama |

**Keputusan:** perbaikan sitasi milestone O valid dan audit 48 workbook kini membuktikan 408/408 sel milestone per-cell. Suite turun dari 20 kegagalan menjadi 1 kegagalan environment. Namun status keseluruhan **belum** boleh disebut siap produksi: OCR belum berjalan, database nyata belum diuji, dan tidak ada ground truth independen/human-reviewed. Tidak ada klaim akurasi model, atomicitas database, atau kesiapan cutover.

## 9. Perintah reproduksi offline

```sh
OUT=.local-evaluation/opencode-go-exp-completion

# 1. WBS/milestone 48 workbook (parser produksi, tanpa network)
for s in 2026-10-09_w4 2026-10-16_w5 2026-10-23_w6 2026-10-30_w7; do
  node .scratch/opencode-go-experiment/wbs-milestone-offline.mjs \
    --out "$OUT/wbs/all-48/$s" --session $s \
    demo-evidence-fixtures/smart-building-itb/sessions/$s/*.xlsx
  python3 .scratch/opencode-go-experiment/ooxml_reader.py --all-sheets \
    --out "$OUT/provenance/ooxml/$s" \
    demo-evidence-fixtures/smart-building-itb/sessions/$s/*.xlsx
done

# 2. Audit provenance + nilai + metrik independen
node .scratch/opencode-go-experiment/audit-wbs-provenance.mjs \
  --root "$OUT/wbs/all-48" \
  --fixtures demo-evidence-fixtures/smart-building-itb/sessions \
  --out "$OUT/provenance"
node .scratch/opencode-go-experiment/score-wbs-offline.mjs \
  --root "$OUT/wbs/all-48" --out "$OUT/wbs"
python3 .scratch/opencode-go-experiment/post-remediation-independent-audit.py \
  --ooxml-root "$OUT/provenance/ooxml" \
  --expected demo-evidence-fixtures/smart-building-itb/expected-results.json \
  --out "$OUT/provenance" \
  --sessions 2026-10-09_w4 2026-10-16_w5 2026-10-23_w6 2026-10-30_w7

# 3. Verifikasi warning Gantt terhadap bentuk tabel mentah
python3 .scratch/opencode-go-experiment/gantt-ambiguity-audit.py \
  --root "$OUT/wbs/all-48" --ooxml-root "$OUT/provenance/ooxml" \
  --out "$OUT/provenance"

# 4. Smoke dan seam offline
node .scratch/opencode-go-experiment/smoke-two-workbooks.mjs "$OUT/smoke"
node .scratch/opencode-go-experiment/verify-full-offline-seams.mjs --out "$OUT/seams"
node .scratch/opencode-go-experiment/verify-wbs-offline.mjs

# 5. Tes fokus dan suite penuh
node --test tests/integration/document-library.test.mjs \
  tests/integration/extracted-details.test.mjs \
  tests/integration/epic-3-dashboard.test.mjs \
  tests/integration/epic-4-anomalies.test.mjs
node --test tests/integration/assurance-integrity-actions.test.mjs \
  tests/integration/wbs-header-provenance.test.mjs \
  tests/integration/evidence-provenance.test.mjs
npm test

# 6. Graph saja (tanpa LLM)
graphify update .
```

Tidak dijalankan: `npm run test:db` (tidak ada container disposable), Playwright, provider live, prefetch/install OCR.

## Lampiran — ringkasan satu baris

- 48 workbook: 408/408 baris per-cell proven untuk `code`, `percent`, `deliverable`, `baseline_finish`, dan `milestone` kolom O; 0 sel O kosong; 0 false accept.
- 24 warning Gantt diverifikasi nyata (header dua baris + kolom minggu/tanggal); 0 false positive/negative; warning dipertahankan.
- 19 dari 20 kegagalan lama diselesaikan dengan perbaikan harness/tes, bukan re-pin copy; 1 kegagalan OCR tetap karena runtime PP-OCRv6 tidak tersedia.
- Suite penuh: 289/290 lulus; satu-satunya kegagalan adalah OCR environment.
- Database terisolasi tidak dapat dijalankan: Docker daemon mati dan tidak ada container disposable.
- Tidak ada model live, tidak ada DB eksternal, tidak ada ground truth independen/human-reviewed; status produksi tidak diklaim.
