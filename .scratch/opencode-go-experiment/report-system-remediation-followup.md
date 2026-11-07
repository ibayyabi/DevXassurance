# Laporan tindak lanjut remediasi sistem — tiga regresi

## 0. Status, ruang lingkup, dan batas

- Repo: `/Users/iweng/Documents/GitHub/DevXassurance`; branch `development-bismillah-final`.
- Rencana induk: `.scratch/opencode-go-experiment/system-remediation-plan.md`.
- Tindak lanjut review independen atas tiga regresi potensial:
  1. `document-extraction.ts` — dua tanggal bernilai sama dengan peran berbeda (record + due).
  2. `document-parser.ts` — deteksi dua header dapat memakan baris data pertama.
  3. `document-parser.ts` — `splitBlockRanges()` dapat membuang literal `" | "` di dalam isi sel.
- Perubahan hanya pada `worker/src/services/document-parser.ts`, `worker/src/services/document-extraction.ts`, `worker/README.md`, dan dua tes integrasi terkait (hanya penambahan kasus).
- Tidak mengubah atau menimpa laporan sebelumnya. Dokumen ini file baru.
- Tidak membaca `.env*`, API key/auth store, tidak ada request provider/LLM/jaringan nyata, tidak menyentuh DB eksternal/production, tidak install, tidak commit, tidak ada operasi git destruktif.
- Tes memakai `node:test`, `parseDocumentBuffer()` nyata, fetch mock lokal deterministik, dan `loadWorkerModules()`.

## 1. Reproduksi sebelum perbaikan

Tiga kasus baru dijalankan terhadap kode sebelum perbaikan. Semua gagal dengan gejala yang dilaporkan:

| # | Kasus | Lokasi tes | Gejala aktual sebelum perbaikan |
|---|---|---|---|
| 1 | Nilai yang sama berperan record **dan** due | `tests/integration/evidence-provenance.test.mjs:2880` | `milestones` = `[]`, ekspektasi `[["18 September 2026", "2026-09-18"]]`. `milestoneDateError()` menolak karena `matching.some(role === "record")` dievaluasi sebelum cue due. |
| 2 | Header satu baris + baris data pertama semua teks + baris ketiga numerik | `tests/integration/phase6-document-parser.test.mjs:823` | `the first data row keeps its own row reference` = false. Baris 2 diangkat menjadi header kedua (`headerCount = 2`) lalu hilang sebagai baris data. |
| 3 | `" | "` literal di dalam nilai sel | `tests/integration/phase6-document-parser.test.mjs:873` | `the literal pipe inside the cell value is not skipped` = false. `lastIndexOf(" | ", boundary)` menemukan delimiter di dalam isi sel, lalu `next = cut + 3` melewati tiga karakter literal. |

Catatan reproduksi #3: bentuk sintetik pertama belum melewati batas part sehingga belum terpecah. Setelah panjang baris dinaikkan (tetap > `MAX_SOURCE_BLOCK_PART_LENGTH` = 3100), kasus dijalankan ulang terhadap algoritma lama yang dipulihkan sementara; hasilnya merah dengan assertion di atas, lalu perbaikan dipasang kembali. Tidak ada tes yang dilemahkan atau dihapus.

## 2. Akar masalah dan perbaikan

### 2.1 Tanggal milestone: peran due harus menang atas record untuk nilai yang sama

`worker/src/services/document-extraction.ts:2381` (`milestoneDateError`), cabang naratif di `:2417-2431`.

Akar masalah: cabang naratif mengambil klausa pertama yang memuat `raw_date`, lalu menolak bila ada entri `record` untuk nilai yang sama. Pada `"Reporting date 18 September 2026, milestone due 18 September 2026"`, kedua tanggal bernilai sama; satu berperan record dan satu berperan due, sehingga valid due ikut ditolak. Pencarian satu klausa juga melewatkan peran due bila record dan due berada di klausa terpisah (`|`).

Perbaikan:

- Semua entri tanggal naratif yang nilainya sama dengan `date` **dan** klausanya memuat `raw_date` dipertimbangkan (bukan hanya klausa pertama).
- Bila ada entri `due`/`approval` eksplisit untuk nilai itu → diterima.
- Bila hanya ada entri `record` → tetap ditolak dengan pesan record-date.
- Tanpa cue yang berlawanan → raw tetap dipertahankan seperti sebelumnya.

Hasil: record-only dan record + due berbeda nilai tetap ditolak; nilai yang sama dengan cue due eksplisit diterima. Provenance (`raw_date`, klausa sumber, warning) tidak dihapus.

### 2.2 Deteksi dua header: fail closed, bukan memakan baris data

`worker/src/services/document-parser.ts:378-386` (konstanta bukti header) dan `:688-748` (deteksi).

Akar masalah: kondisi lama hanya memeriksa tipe sel (`headerLikeCell` di baris 0, semua teks di baris 1, ada sel non-teks di baris 2). Baris data pertama yang seluruhnya teks memenuhi syarat itu, sehingga diangkat menjadi header kedua dan hilang sebagai data.

Perbaikan: dua header hanya diterima bila **salah satu** bukti positif berikut ada:

1. **Week/period grid**: setiap sel baris 0 adalah label periode/tanggal valid (`W1`, `Week 3`, `2026-10-16`, tanggal serial valid, nama bulan), boleh ditambah caption WBS/task, dan minimal dua sel periode. Ini mempertahankan dukungan Gantt mingguan.
2. **Merged group header**: baris 0 seluruhnya teks non-formula dengan nilai, memuat merge anchor yang membentang >1 kolom pada baris itu, dan tidak memuat tanggal valid. Ini mempertahankan header bertingkat yang sah (mis. `Delivery`/`Totals` di atas `Start date`/`Status`/`Amount`).

Selain itu, baris kandidat header kedua harus seluruhnya teks non-formula, tidak kosong, panjang ≤ 60 karakter, dan bukan nilai mirip data (angka, persen, mata uang, tanggal). Bila syarat tidak terpenuhi, `headerCount` tetap 1 dan baris kandidat diproses sebagai baris data (row reference + per-cell tetap dibuat). Tidak ada baris yang dihapus.

### 2.3 Split blok: hanya separator antar-sel yang terbukti boleh dikonsumsi

`worker/src/services/document-parser.ts:2110-2147` (`splitBlockRanges`) dan `:2167-2176` (`splitSourceBlock`).

Akar masalah: `lastIndexOf(" | ", boundary)` tidak membedakan separator antar-sel dari `" | "` di dalam teks sel. Ketika delimiter ditemukan di dalam isi sel, `next = cut + 3` melewati karakter literal.

Perbaikan:

- `splitBlockRanges()` menerima span sel yang sudah dilokalisasi (`locateCellSpans()`), bukan boolean.
- Separator hanya dianggap terbukti bila `text.slice(span.end, next.start) === " | "` tepat di antara akhir satu token sel dan awal token sel berikutnya.
- `" | "` di dalam span sel tidak pernah menjadi titik potong; fallback spasi/batas keras tetap seperti sebelumnya.
- Filter `contained` yang sudah ada tetap menentukan sel mana yang boleh per-cell; sel yang melewati batas tetap row-level. Tidak ada ID/sel sintetis.

## 3. Hasil tes (persis)

Semua perintah offline.

| Perintah | Hasil |
|---|---|
| 5 kasus regresi baru (`--test-name-pattern`) sebelum perbaikan | **2 pass, 3 fail** (reproduksi) |
| 5 kasus regresi baru setelah perbaikan | **5/5 pass** |
| `node --test tests/integration/evidence-provenance.test.mjs` | **19/19 pass** |
| `node --test tests/integration/phase6-document-parser.test.mjs` | **26/27 pass**; 1 gagal = OCR lokal yang sudah diketahui (bukan perubahan ini) |
| 10 suite terkait (`evidence-provenance`, `phase6-document-extraction`, `phase6-document-summary`, `ticket-01/02/03/05`, `partial-evidence-review`, `document-worker-fencing`, `upload-finalize-hash`) | **134/134 pass** |
| `node --test tests/integration/*.test.mjs` | **287 tes, 267 pass, 20 fail, 0 skip, 0 cancelled, 0 todo**, exit 1 |
| `./node_modules/.bin/tsc --noEmit` | **exit 0** |

Perbandingan baseline laporan sebelumnya: 282 tes / 262 pass / 20 fail. Kenaikan 5 tes berasal dari 5 kasus regresi baru; 5 tambahan pass. **Tidak ada kegagalan baru**; 20 kegagalan yang tersisa adalah kategori lama (UI/harness/copy, nama RPC lama, dan OCR lokal).

## 4. Smoke offline dua workbook

```sh
node .scratch/opencode-go-experiment/smoke-two-workbooks.mjs
```

`all_passed: true`, `network_response_used: false`, memakai fetch mock deterministik.

| Workbook | Versi | Chunk | Ref sel | Ref baris | Baris split | Maks ref/chunk | Extract |
|---|---|---:|---:|---:|---:|---:|---|
| `02_Kamera_Pengawasan_Subcontractor_Weekly.xlsx` | `document-parser/19` | 41 | 668 | 101 | 8 | 88 | ok |
| `07_Air_Bersih_Subcontractor_Weekly.xlsx` | `document-parser/19` | 29 | 561 | 89 | 0 | 72 | ok |

Angka identik dengan laporan sebelumnya: perubahan ini tidak mengubah perilaku kedua workbook tersebut.

## 5. Dokumentasi dan graph

- `worker/README.md` diperbarui untuk: separator ` | ` hanya bila terbukti antar-sel; dua header hanya untuk week/period grid atau merged group header dengan baris label, selain itu fail closed; peran due eksplisit menang atas record untuk nilai yang sama, record-only tetap ditolak.
- `graphify update .`: **3723 nodes, 8887 edges, 169 communities** (AST-only, tanpa LLM). `graphify-out/` diperbarui.
- `PARSER_VERSION` tetap `document-parser/19`. Versi 19 masih merupakan changeset kerja yang belum dirilis; bila kode `/19` sebelumnya sudah pernah dipakai di suatu lingkungan, hasil cache-nya harus dianggap stale dan `PARSER_VERSION` perlu dinaikkan sebelum rilis.

## 6. Source locator aktual

| Item | Lokasi |
|---|---|
| `milestoneDateError()` — peran due/record naratif | `worker/src/services/document-extraction.ts:2381`, `:2417-2431` |
| Pemanggilan validasi milestone | `worker/src/services/document-extraction.ts:3246` |
| Konstanta bukti header | `worker/src/services/document-parser.ts:378-386` |
| Deteksi dua header | `worker/src/services/document-parser.ts:688-748` |
| `splitBlockRanges()` | `worker/src/services/document-parser.ts:2110-2147` |
| `locateCellSpans()` | `worker/src/services/document-parser.ts:2153` |
| `splitSourceBlock()` dan pemanggilan span | `worker/src/services/document-parser.ts:2167-2176` |
| Tes regresi tanggal | `tests/integration/evidence-provenance.test.mjs:2880`, `:2945` |
| Tes regresi header | `tests/integration/phase6-document-parser.test.mjs:823`, `:855` |
| Tes regresi split literal | `tests/integration/phase6-document-parser.test.mjs:873` |

## 7. Batas dan non-claim

- Tidak ada klaim bahwa semua 48 workbook/408 baris kini production-safe; yang diuji adalah dua workbook smoke dan kasus sintetik.
- Deteksi dua header tetap heuristik fail-closed: header bertingkat tanpa merge dan tanpa grid periode akan diperlakukan sebagai satu header (label hilang, baris data tetap aman).
- OCR lokal tetap gagal karena runtime PP-OCRv6 tidak tersedia; tidak diinstal.
- 19 kegagalan UI/harness/copy dan 1 nama RPC lama tetap tercatat dan tidak diperbaiki.
- DB terisolasi, provider live, E2E Playwright, dan ground truth independen tetap BLOCKED.
- Tidak ada klaim kesiapan produksi pipeline keseluruhan.
