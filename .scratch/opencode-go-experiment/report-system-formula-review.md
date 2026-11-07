# Laporan review formula — tanggal milestone dari sel due berformula

## 0. Status eksekusi dan batas

- Repo: `/Users/iweng/Documents/GitHub/DevXassurance`; branch `development-bismillah-final`.
- Rencana induk: `.scratch/opencode-go-experiment/system-remediation-plan.md` (lanjutan).
- Ruang lingkup: celah freshness formula pada tanggal milestone di `worker/src/services/document-extraction.ts`, regresi integrasi consumer-visible, dokumentasi worker, dan verifikasi offline.
- Tidak membaca `.env*`, API key/auth store, atau kredensial.
- Tidak ada request provider/LLM/jaringan nyata. Semua `fetch` pada tes/smoke adalah mock lokal.
- Tidak menyentuh database eksternal/production. `npm run test:db` hanya menjalankan guard skip.
- Tidak ada install, commit, push, reset, atau perintah destruktif.
- Tidak mengubah `demo-evidence-fixtures/`, workbook pengguna, ground truth, `src/`, `supabase/`, `package.json`, atau `package-lock.json`.
- Perubahan pengguna yang sudah ada tidak ditimpa; laporan/hasil sebelumnya tidak diubah.
- Tidak ada tes yang di-suppress, di-skip, atau dilonggarkan assertion-nya.

## 1. Akar masalah

`milestoneDateError()` sudah memvalidasi peran kolom due/record untuk XLSX, tetapi cabang structured-nya berhenti terlalu cepat:

- `worker/src/services/document-extraction.ts:2409` (sebelum perbaikan) mengembalikan `null` begitu sel yang cocok dengan `raw_date` terdeteksi sebagai kolom due:
  `if (isDueColumn(cell)) return null;`
- `formulaDateReviewError()` (`:2234`) — konvensi review formula yang sudah dipakai untuk `as_of_date` dan approval date — tidak pernah dievaluasi pada jalur itu.
- `date` milestone diturunkan langsung dari `raw_date` lewat `parseCitedRawDate()` (`:4554`); tidak melewati `checkedDate()` (`:3198`), yang hanya diterapkan pada `as_of_date` (`:3239`–`:3240`).
- Akibatnya `cached_value` pada sel due berformula diterima seolah tanggal milestone yang fresh. Jalur normalisasi juga punya bentuk bypass yang sama: bila `raw_date` tidak byte-identik dengan nilai sel tetapi tanggal ternormalisasinya cocok dengan sel due berformula, `dueDateError()` menerimanya.

## 2. Perbaikan

### 2.1 Validator

`worker/src/services/document-extraction.ts`:

- `milestoneDateError()` sekarang mengembalikan `formulaDateReviewError(citation, cell, path)` ketika sel due yang cocok adalah hasil formula tersimpan (`:2411`). Ini mempertahankan peran kolom sebagai bukti due, tetapi menolak menerima freshness-nya.
- Jalur fallback tanggal ternormalisasi juga memeriksa sel due berformula yang tanggalnya sama sebelum memanggil `dueDateError()` (`:2416`–`:2424`), sehingga normalisasi tidak bisa mem-bypass aturan yang sama.
- Perilaku lain tidak diubah:
  - kolom record/cut-off tetap ditolak;
  - sel tanpa label tetap tidak dapat membuktikan peran;
  - raw wording yang sah dan tidak dapat dinormalisasi tetap dipertahankan (`date: null`), bukan dibuang;
  - `missing_cache`/`cached_empty`/`cached_error`/`unknown` tetap fail-closed lewat `excerptFor()` → `citationHasUnavailableFormula()` → `formula_result_unavailable`;
  - aturan risk mitigation due date, `as_of_date`, dan naratif tidak diubah.

### 2.2 Regresi consumer-visible

`tests/integration/evidence-provenance.test.mjs`:

- Helper synthetic `syntheticFormulaDueWorkbook()` (`:137`) membuat satu sheet dengan tiga kolom due:
  - `B2` literal `2026-10-23`;
  - `C3` formula `TEXT(DATE(2026,10,30),"yyyy-mm-dd")` dengan cache `2026-10-30`;
  - `D4` formula tanpa cache (`missing_cache`).
- Tes `a literal due date stays a milestone while a cached formula due date requires review` (`:1989`) memakai seam `parseDocumentBuffer()` → `extractDocumentGroups()` dan provider mock lokal. Assertion:
  - `C3` = `cached_value`, `D4` = `missing_cache`;
  - hanya milestone literal `["Due Date", "2026-10-23"]` yang diterima;
  - milestone `C3` ditolak dengan `formula_cache_review_required` dan pesan freshness not established;
  - milestone `D4` ditolak dengan `formula_result_unavailable`.
- Assertion berifat consumer-visible (hasil ekstraksi tervalidasi + `quality_warnings`), bukan pencocokan wording internal.

### 2.3 Dokumentasi

`worker/README.md:15` menambahkan aturan eksplisit: sel due berformula hanya membuktikan peran kolom; tanggal turunannya tetap kandidat source-reported untuk review dan tidak diterima sebagai milestone fresh.

## 3. Verifikasi (semua offline)

| Perintah | Hasil |
|---|---|
| `node --test --test-name-pattern="literal due date stays a milestone" tests/integration/evidence-provenance.test.mjs` | **1/1 PASS** |
| `npm test` (`node --test tests/integration/*.test.mjs`) | **288 tes, 268 pass, 20 fail, 0 skipped** |
| `./node_modules/.bin/tsc --noEmit` | **exit 0** |
| `node .scratch/opencode-go-experiment/smoke-two-workbooks.mjs ...` | **all_passed: true**; `network_used: false` |
| `node .scratch/opencode-go-experiment/verify-full-offline-seams.mjs ...` | **8/8 PASS** |
| `npm run test:db` | **exit 0**; hanya guard skip (tanpa DB eksternal) |
| `graphify update .` | **3724 nodes, 8889 edges, 164 communities** (AST-only, tanpa LLM) |

### 3.1 Perbandingan suite integrasi

- Baseline laporan sebelumnya: **282 tes, 262 pass, 20 fail**.
- Setelah perubahan: **288 tes, 268 pass, 20 fail**.
- Selisih: **+6 tes baru, +6 pass**; jumlah kegagalan tetap 20. **Tidak ada kegagalan baru dan tidak ada tes yang dihapus/di-suppress.**
- 20 kegagalan yang tersisa adalah kategori lama di luar bug ini:
  - 19 kegagalan UI/harness/copy/RPC (`document-library`, `extracted-details`, `epic-3-dashboard`, `epic-4-anomalies`, `assurance-integrity-actions`);
  - 1 kegagalan OCR lokal karena runtime PP-OCRv6 tidak tersedia.
- Kegagalan `assurance-integrity-actions` yang tersisa (`observation_coverage.byRole.current.schedule.state` = `undefined`) tidak memakai jalur ekstraksi worker/milestone dan sudah ada sebelum perubahan.

### 3.2 Smoke dua workbook W7

`smoke-two-workbooks.mjs` memakai `loadWorkerModules()` dan fetch mock deterministik; tidak ada model/API nyata.

| Workbook | Parse | Extract | Request mock | Network response |
|---|---|---|---|---|
| `02_Kamera_Pengawasan_Subcontractor_Weekly.xlsx` | ok | ok | 28 | tidak |
| `07_Air_Bersih_Subcontractor_Weekly.xlsx` | ok | ok | 24 | tidak |

`all_passed: true`, `network_used: false`, `environment_file_read: false`, `model_called: false`.

## 4. Source locator aktual

| Item | Lokasi |
|---|---|
| `formulaDateReviewError()` | `worker/src/services/document-extraction.ts:2234` |
| `isDueColumn()` / `isRecordColumn()` | `worker/src/services/document-extraction.ts:2230`–`:2233` |
| `milestoneDateError()` | `worker/src/services/document-extraction.ts:2381` |
| Cabang due berformula (fix) | `worker/src/services/document-extraction.ts:2411` |
| Fallback tanggal ternormalisasi (fix) | `worker/src/services/document-extraction.ts:2416`–`:2424` |
| `checkedDate()` (hanya `as_of_date`) | `worker/src/services/document-extraction.ts:3198`, `:3239` |
| Pemanggilan `milestoneDateError()` | `worker/src/services/document-extraction.ts:3245`–`:3247` |
| `parseCitedRawDate()` | `worker/src/services/document-extraction.ts:4554` |
| Tes regresi | `tests/integration/evidence-provenance.test.mjs:1989` |
| Helper workbook sintetik | `tests/integration/evidence-provenance.test.mjs:137` |
| Dokumentasi perilaku | `worker/README.md:15` |

## 5. Artefak dan hash

Log verifikasi disimpan di `.local-evaluation/opencode-go-exp-system-remediation/formula-due/`.

| Artefak | SHA-256 |
|---|---|
| `formula-due/focused-test.log` | `64e0c6481c72d6a48dccfd570a19109ff637dea03626a296a1d627c3b275e237` |
| `formula-due/integration-suite.log` | `8f1bb4638e3545d0f8d91720220884d3d532a5bf774799dfe05f4ed523fb539a` |
| `formula-due/smoke.log` | `929be5b5e335df54d7f5120b19313358b024c6ee83370b66cd756f47a8c43e00` |
| `formula-due/seams.log` | `16f7fec721e898516a6c2815e5b84d9754e584e18118064daaef6016a8456553` |
| `formula-due-smoke/smoke-summary.json` | `559e32ea5600695998e6137b4b587818bd6473fa1758643d2bca809adc54c5c8` |
| `formula-due-seams/seams-result.json` | `8543f523037f8483bd6ebbec2efff969b043a0b6ed0cc7162445b2a70a920d0f` |

Perubahan kerja (belum di-commit):

```text
tests/integration/evidence-provenance.test.mjs
worker/README.md
worker/src/services/document-extraction.ts
```

`graphify-out/` ikut diperbarui oleh `graphify update .` sesuai aturan repo.

## 6. Blocker, batas, dan non-claim

**Tidak diuji / tetap di luar scope:**

1. Database terisolasi/nyata tidak tersedia; queue, fencing, dan transaksi Supabase tidak diuji. `npm run test:db` hanya guard skip.
2. Provider/model live tidak dipanggil; kualitas model, biaya, latency, dan perilaku 429/timeout nyata tidak dinilai.
3. Runtime OCR lokal (PP-OCRv6) tidak tersedia; satu tes OCR tetap gagal seperti baseline.
4. 19 kegagalan UI/harness/copy/RPC tetap tercatat dan tidak diperbaiki (di luar scope).
5. Lint menyeluruh tidak dijalankan ulang untuk laporan ini; tidak ada klaim bahwa baseline lint repo bersih.
6. Tidak ada klaim bahwa seluruh pipeline atau semua workbook fixture kini production-ready. Bukti hanya pada seam parser→ekstraksi, workbook sintetik, dua workbook smoke W7, dan 8 check seam offline.
