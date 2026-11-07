# Laporan remediasi sistem — milestone, provenance per-cell, header, formula

## 0. Status eksekusi dan batas

- Repo: `/Users/iweng/Documents/GitHub/DevXassurance`; branch `development-bismillah-final`.
- Rencana yang dieksekusi: `.scratch/opencode-go-experiment/system-remediation-plan.md`.
- Parser produksi: `document-parser/19` (dinaikkan dari `18`; output kontrak parser berubah).
- Perubahan produksi: `worker/src/services/document-parser.ts`, `worker/src/services/document-extraction.ts`, `worker/README.md`, serta dua tes integrasi terkait.
- Tidak ada perubahan pada `demo-evidence-fixtures/`, workbook pengguna, `src/`, `supabase/`, `package.json`, atau `package-lock.json`.
- Tidak membaca `.env*`, API key/auth store, atau kredensial.
- Tidak ada request provider/LLM/jaringan nyata. Semua fetch pada tes dan smoke adalah mock lokal.
- Tidak menyentuh database eksternal. `npm run test:db` hanya menjalankan guard skip.
- Tidak ada commit, install, push, reset, atau perintah destruktif.
- Laporan dan hasil sebelumnya tidak diubah/ditimpa. Artefak baru berada di `.local-evaluation/opencode-go-exp-system-remediation/`.

## 1. Perubahan yang dibuat

### 1.1 Tanggal milestone divalidasi sebagai due/event

Akar masalah: `date` milestone diturunkan dari `raw_date` setelah hanya dicek keberadaannya di excerpt; tidak ada pemeriksaan peran kolom. Nilai kolom `Cut-off Date`/`complete` karenanya bisa menjadi tanggal milestone.

Perbaikan di `worker/src/services/document-extraction.ts`:

- `milestoneDateError()` (sekitar L2381) memvalidasi tanggal milestone dengan semantik due/event:
  - untuk XLSX, kecocokan raw wording diperiksa lebih dulu terhadap sel saudara; kolom due/target/plan/baseline/actual diterima, kolom record/cut-off ditolak, sel tanpa label ditolak;
  - bila raw wording tidak dapat dinormalisasi tetapi kolomnya terbukti due, raw tetap disimpan (`date: null`) dan tidak ditolak;
  - bila tanggal ternormalisasi tersedia, validasi memakai `dueDateError()` yang sudah ada;
  - untuk naratif, tanggal ISO maupun non-ISO yang tidak ambigu (`18 September 2026`, `31-Oct-2026`) dapat diatribusikan perannya; tanggal dengan cue record/approval yang berlawanan ditolak; raw yang eksplisit tanpa peran berlawanan tetap dipertahankan.
- `narrativeDateValues()` (sekitar L2091) kini mengenali format hari + nama bulan + tahun dan menormalisasinya lewat `parseCitedRawDate()`, tanpa menebak format numerik ambigu.
- Panggilan validasi ditambahkan pada blok milestone (sekitar L3231) dengan path `${path}.date`.

Hasil yang dipertahankan: tanggal milestone yang benar (ISO, non-ISO yang dapat dinormalisasi, dan naratif dengan bukti eksplisit) tetap diterima; tanggal dari kolom record/cut-off dan sel tanpa label tidak lagi diterima sebagai milestone.

### 1.2 Provenance per-cell pada XLSX panjang

Akar masalah: `splitSourceBlock()` membuang seluruh `cellReferences` dan `rowCells` ketika teks baris melebihi batas part (3100 karakter), sehingga baris panjang hanya punya provenance row-level.

Perbaikan di `worker/src/services/document-parser.ts`:

- `splitBlockRanges()` (sekitar L2050) memotong pada batas sel `" | "` bila block memiliki referensi sel, lalu fallback ke spasi/batas keras.
- `locateCellSpans()` (sekitar L2082) memetakan teks model setiap sel ke satu span deterministik; token yang tidak dapat ditemukan atau ganda tanpa posisi unik tidak dipaksakan.
- `splitSourceBlock()` (sekitar L2097):
  - referensi sel hanya dilampirkan ke part yang memuat seluruh span sel tersebut;
  - `rowCells` per part hanya berisi sel yang benar-benar ada di part itu;
  - sel yang melewati batas part tetap row-level/review, bukan dikaitkan ke part lain;
  - tidak membuat ID/sel sintetis; ID tetap dihasilkan oleh `chunkSourceBlocks()` secara deterministik dan unik.
- Anggaran referensi: `referenceCount()` (sekitar L1912) dan flush proaktif memastikan setiap chunk tidak melebihi 120 referensi setelah baris wajib ditambahkan. Baris yang sendirian melebihi anggaran tetap punya row reference dan turun ke row-level.

### 1.3 Diagnosis header duplikat dan header Gantt mingguan

Perbaikan di `worker/src/services/document-parser.ts`:

- `diagnoseTableAmbiguity()` (sekitar L1320) menambahkan alasan `duplicate_header` (L1304, L1315) untuk label header non-kosong yang berulang di kolom tak berhubungan pada baris header yang sama.
- Pengulangan yang berasal dari satu merge range (`A1:B1`) tidak dianggap duplikat.
- Deteksi header dua baris (sekitar L683) menerima baris header mingguan bertipe tanggal di atas baris header WBS tekstual bila baris berikutnya adalah data. Ini menghindari pemaksaan mapping kolom hanya dari nama sheet atau satu baris.

### 1.4 Versi parser

- `PARSER_VERSION = "document-parser/19"` (sekitar L367).
- Cache group dikunci oleh versi parser, sehingga hasil `document-parser/18` tidak dipakai ulang. Perilaku replay/cache diuji oleh suite `evidence-provenance`.
- `worker/README.md` diperbarui untuk split per-cell, diagnosis `duplicate_header`, header Gantt dua baris, batas 120 referensi, dan validasi tanggal milestone.

## 2. Verifikasi

Semua perintah aplikasi berjalan offline.

### 2.1 Tes terarah

| Suite / perintah | Hasil |
|---|---|
| `node --test --test-name-pattern="row metadata separates the record date" tests/integration/evidence-provenance.test.mjs` | **1/1 PASS** (known red diverifikasi setelah perbaikan, tidak dijalankan sebelum perbaikan) |
| `node --test tests/integration/evidence-provenance.test.mjs` | **17/17 PASS** |
| `node --test tests/integration/phase6-document-parser.test.mjs` | **23/24 PASS**; 1 gagal adalah OCR lokal yang sudah diketahui |
| `node --test` 9 suite domain (extraction, summary, ticket-01/02/03/05, partial-evidence-review, document-worker-fencing, upload-finalize-hash) | **115/115 PASS** |
| `./node_modules/.bin/tsc --noEmit` | **exit 0** |
| `node .scratch/opencode-go-experiment/verify-full-offline-seams.mjs --out .../seams` | **8/8 PASS** |

Tes baru yang ditambahkan:

- Parser: split baris panjang menahan referensi sel hanya di part yang memuat sel; sel yang melewati batas tidak punya referensi per-cell; formula/cache tetap terbaca; setiap chunk ≤120 referensi; baris terlalu lebar tetap row-level; header duplikat didiagnosis; merge range tidak salah didiagnosis; header mingguan + WBS dua baris dikenali.
- Integrasi `parseDocumentBuffer` → `extractDocumentGroups`: milestone dari sel `Due Date` pada baris yang di-split tetap citable dan diterima; saudara `Cut-off Date` ditolak dengan warning.
- Integrasi `extractDocumentGroups`: raw date non-ISO yang tidak dapat dinormalisasi tetapi kolomnya terbukti due tetap disimpan mentah; `Cut-off Date` non-ISO ditolak.
- Tes non-ISO naratif yang sudah ada (`18 September 2026`, `31-Oct-2026`, trailing remark, raw non-date) tetap lulus.

### 2.2 Suite integrasi penuh

```sh
node --test tests/integration/*.test.mjs
```

Hasil: **282 tes, 262 pass, 20 fail, 0 skipped, 0 cancelled, 0 todo**, exit 1.
Log: `.local-evaluation/opencode-go-exp-system-remediation/tests/integration-suite.log`.

Dibandingkan baseline sebelumnya (276 tes, 255 pass, 21 fail), jumlah tes naik 6 karena tes regresi baru, dan satu kegagalan known-red (milestone) hilang. **Tidak ada kegagalan baru.**

20 kegagalan yang tersisa adalah kategori lama dan di luar bug parser/milestone:

| File | Jumlah | Penyebab utama |
|---|---:|---|
| `document-library` | 7 | Harness memotong komponen (`SectionCard`/`statusLabelsId`) dan drift copy UI |
| `extracted-details` | 6 | Drift copy/pagination UI |
| `epic-3-dashboard` | 4 | Drift copy UI berbahasa Indonesia |
| `epic-4-anomalies` | 1 | Regex `/Evidence/` vs UI `Bukti` |
| `assurance-integrity-actions` | 1 | Nama RPC lama di tes |
| `phase6-document-parser` | 1 | Runtime OCR lokal tidak tersedia |
| **Total** | **20** | |

### 2.3 Smoke dua workbook W7 (dua template)

```sh
node .scratch/opencode-go-experiment/smoke-two-workbooks.mjs
```

Memakai `loadWorkerModules()` dan fetch mock deterministik; tidak ada model/API nyata.

| Workbook | Versi | Chunk | Ref sel | Ref baris | Baris split | Maks ref/chunk | Model text citable | Split text citable | Extract |
|---|---|---:|---:|---:|---:|---:|---|---|---|
| `02_Kamera_Pengawasan_Subcontractor_Weekly.xlsx` | `document-parser/19` | 41 | 668 | 101 | **8** | 88 | ya | ya | ok |
| `07_Air_Bersih_Subcontractor_Weekly.xlsx` | `document-parser/19` | 29 | 561 | 89 | 0 | 72 | ya | ya | ok |

- Workbook 02 mewakili bentuk baris panjang yang sebelumnya kehilangan per-cell; 8 baris teramati di-split dengan referensi sel yang tetap citable di part masing-masing.
- Workbook 07 mewakili bentuk baris pendek/terstruktur; tidak ada split dan seluruh referensi sel tetap citable.
- Jumlah request mock: 28 dan 24; `network_response_used=false`, tidak ada respons jaringan.
- Ini bukan klaim bahwa semua 216/408 baris fixture kini production-safe; hanya perilaku dua workbook yang diuji dan bukti sintetis yang ditambahkan.

### 2.4 Lint, DB, dan graph

- `npm run test:db`: **exit 0**, hanya `skip: set XASS_DB_CONTAINER ...` (tidak ada DB eksternal).
- `eslint .`: **exit 1** dengan 1245 problem pada baseline repo yang sudah ada. Tidak ada error baru pada dua tes yang diubah; `document-parser.ts` tidak muncul di log lint; `document-extraction.ts` hanya memuat satu `prefer-const` lama pada blok risk (`asOfDate`), bukan dari perubahan ini. Lint menyeluruh tidak diperbaiki karena di luar scope.
- `graphify update .`: **3723 nodes, 8887 edges, 169 communities**; AST-only tanpa LLM. Graphify menyarankan `graphify label` untuk menyegarkan nama komunitas (tidak dijalankan karena bukan bagian verifikasi ini).

## 3. Source locator aktual

| Item | Lokasi |
|---|---|
| `PARSER_VERSION` | `worker/src/services/document-parser.ts:367` |
| `MAX_SOURCE_REFERENCES_PER_CHUNK` | `worker/src/services/document-parser.ts:373` |
| Deteksi header dua baris | `worker/src/services/document-parser.ts:683` |
| `duplicate_header` | `worker/src/services/document-parser.ts:1304`, `:1320`, `:1390` |
| `referenceCount()` / budget flush | `worker/src/services/document-parser.ts:1912`, sekitar `:1983` |
| `splitBlockRanges()` | `worker/src/services/document-parser.ts:2050` |
| `locateCellSpans()` | `worker/src/services/document-parser.ts:2082` |
| `splitSourceBlock()` | `worker/src/services/document-parser.ts:2097` |
| `narrativeDateValues()` | `worker/src/services/document-extraction.ts:2091` |
| `milestoneDateError()` | `worker/src/services/document-extraction.ts:2381` |
| Pemanggilan validasi milestone | `worker/src/services/document-extraction.ts:3231` |
| `parseCitedRawDate()` | `worker/src/services/document-extraction.ts:4540` |

## 4. Artefak dan hash

| Artefak | SHA-256 |
|---|---|
| `.local-evaluation/opencode-go-exp-system-remediation/smoke/smoke-summary.json` | `57124d8a1a15e24be88f8b2f9e36b554189acfc6efb802ce4740cbd8b45315f7` |
| `.local-evaluation/opencode-go-exp-system-remediation/seams/seams-result.json` | `984157361f516340ae460009f4b681eafd28cbf6532f28ae9f08dd2415edd354` |
| `.local-evaluation/opencode-go-exp-system-remediation/tests/integration-suite.log` | `a7773a2f8ca3769e84ca6bb5cb53603c934e3ea650c657dbff7a9e9bd3608c74` |

Perubahan kerja (belum di-commit):

```text
tests/integration/evidence-provenance.test.mjs
tests/integration/phase6-document-parser.test.mjs
worker/README.md
worker/src/services/document-extraction.ts
worker/src/services/document-parser.ts
```

## 5. Blocker, batas, dan non-claim

**Tetap gagal / tidak diperbaiki (di luar scope):**

1. OCR lokal: runtime PP-OCRv6 tidak tersedia; tes OCR tetap gagal. Instalasi OCR tidak dilakukan.
2. 19 kegagalan UI/harness/copy dan 1 kegagalan nama RPC lama tetap tercatat. Tidak ada repin wording UI, perbaikan harness, atau perubahan RPC yang diklaim.
3. Lint menyeluruh masih exit 1 karena baseline 1245 problem; perubahan ini tidak menambah error baru.

**BLOCKED / tidak dijalankan:**

1. Database terisolasi: tidak tersedia; queue/fencing/transaksi Supabase nyata tidak diuji.
2. Live provider/model: tidak dipanggil. Kualitas model, biaya, latency, dan 429/timeout nyata tidak dinilai.
3. E2E Playwright dan ground truth independen/human-reviewed holdout: tidak tersedia.
4. Freshness cache formula: tidak dibuktikan. Parser tidak menghitung ulang rumus.
5. Verifikasi per-cell pada seluruh 48 workbook/408 baris: tidak diklaim. Yang diukur hanya 2 workbook smoke dan tes sintetis.
6. Diagnosis `duplicate_header` adalah warning/review, bukan mapping yang disetujui; header yang ambigu tetap tidak boleh diperlakukan sebagai mapping final.
7. Angka `Rp11,500,00` pada fixture tidak dikoreksi dan tidak dianggap IDR/scope tersirat.
8. Tidak ada klaim bahwa pipeline keseluruhan siap produksi.

**Tidak diklaim:**

- Semua baris panjang kini memiliki provenance per-cell di seluruh fixture.
- Kualitas WBS/milestone, kelengkapan domain, atau kesegaran cache.
- Bahwa UI/copy yang masih gagal sudah sesuai dengan tes lama.
