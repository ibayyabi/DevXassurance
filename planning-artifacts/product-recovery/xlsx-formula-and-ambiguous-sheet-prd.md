# PRD — Formula XLSX dan Interpretasi Sheet Ambigu

**Status:** Proposed; memformalkan dua arah yang disetujui sementara: penanganan formula tanpa cached value dan interpretasi LLM untuk struktur sheet XLSX yang ambigu. Dokumen ini belum merupakan persetujuan implementasi atau produksi.

**Lingkup:** Kontrak hasil formula serta interpretasi struktur/semantik worksheet ambigu di worker. PRD ini memperinci bagian XLSX dari [PRD Evidence Normalization and Project Baseline](evidence-normalization-and-baseline-prd.md), terutama requirement parsing, mapping, source provenance, dan review.

**Keputusan teknologi:** Tidak memilih vendor/model tertentu. Implementasi awal memakai provider dan jalur LLM worker yang sudah dikonfigurasi. n8n tetap mengorkestrasi pemanggilan worker; tidak ditambahkan node LLM n8n.

## 1. Ringkasan

XLSX harus dibaca sebagai workbook terstruktur, bukan diubah menjadi gambar lalu di-OCR. Parser mempertahankan data sel, formula, hasil cache yang disimpan di file, dan referensi worksheet/sel. Parser **tidak menghitung ulang formula**. Formula dengan hasil cache dan formula tanpa hasil cache menjadi dua keadaan berbeda; hasil yang tidak tersedia tidak boleh berubah menjadi `0`, nilai kosong yang dianggap valid, atau kesimpulan “tidak ada evidence”.

Untuk sheet yang struktur tabelnya jelas, worker memakai jalur ekstraksi yang ada. Jika bentuk sheet ambigu—misalnya key/value, header bertingkat, atau Gantt—worker boleh meminta LLM mengusulkan interpretasi terstruktur. Interpretasi tersebut tetap candidate, harus menyertakan referensi sumber yang dapat divalidasi, dan tidak menjadi keputusan bisnis atau mapping yang disetujui.

**Pilihan ringan:** gabungkan interpretasi sheet ambigu ke dalam permintaan group-extraction yang sudah ada jika masih memenuhi batas input. Jangan menambah panggilan per sel, model service baru, formula engine, OCR, atau node LLM n8n.

## 2. Keputusan produk

| ID | Keputusan | Dampak |
|---|---|---|
| D01 | Parsing XLSX normal tetap menggunakan isi workbook/OOXML; OCR bukan jalur standar. | Nilai sel dan posisi spreadsheet dipertahankan tanpa rasterisasi seluruh workbook. |
| D02 | Worker tidak mengevaluasi atau menghitung ulang formula. | Sistem hanya boleh menyajikan formula dan cached result yang ditemukan dalam file. |
| D03 | Cached result diberi label sebagai nilai cache tersimpan, bukan jaminan bahwa nilai itu baru atau sudah dihitung ulang. | Sistem tidak mengklaim freshness yang tidak dapat dibuktikan dari parser. |
| D04 | Cache hilang, cache kosong, dan formula error adalah keadaan berbeda dari nilai numerik `0`. | Formula unresolved tidak boleh dipakai sebagai nilai aktual atau status hijau. |
| D05 | Interpretasi sheet ambigu merupakan usulan model dengan source references, bukan fakta yang diterima atau approval. | Nilai material tetap melalui validasi dan review yang berlaku. |
| D06 | Jalur model pertama menggunakan request group extraction worker yang sudah ada bila konteksnya sesuai. | Tidak ada panggilan model tambahan untuk setiap worksheet atau cell. |
| D07 | Sheet atau grup yang tidak dapat ditafsirkan tetap menyimpan raw evidence dan ditandai `ambiguous`/`unknown`/`needs_review`. | Kegagalan satu sheet tidak membuang isi workbook lainnya. |
| D08 | Formula, interpretasi, dan hasil model diberi versi agar cache lama tidak dipakai sebagai hasil kontrak baru. | Perubahan parser/prompt/schema menginvalidasi cache yang relevan. |

## 3. Kondisi eksisting dan bukti masalah

Bagian ini berdasarkan inspeksi source code dan isi OOXML workbook, bukan hasil runtime parser pada file korpus.

### 3.1 Parser dan worker saat ini

- `worker/src/services/document-parser.ts` memetakan `.xlsx` ke `parseXlsxDocument()`, membaca worksheet yang terdaftar, shared strings, format angka/tanggal, formula, dan cached `<v>` yang tersedia. Hasil chunk memiliki nama sheet dan lokasi/rentang baris-sel.
- Parser membentuk blok tabel dari baris berisi yang berurutan dan memutus blok pada lompatan nomor baris. Header satu atau dua baris dipilih memakai heuristik terbatas; parser tidak mengenali semua bentuk layout secara eksplisit.
- Untuk cell berformula, teks hasil parsing saat ini menyertakan formula serta cached value bila ada, atau teks “no cached value” bila tidak ada. Parser tidak menjalankan formula engine.
- `worker/src/jobs/process-document.ts` menjalankan urutan parse → `extractDocumentGroups()` → menyimpan chunks, hasil ekstraksi, warning, dan status review.
- `worker/src/services/document-extraction.ts` sudah memiliki klasifikasi tingkat dokumen dan group extraction LLM. Group dibatasi hingga 3 chunks/10.000 karakter, dengan batas 32 group per dokumen dan concurrency provider 2. Prompt extraction membatasi model pada source references yang diberikan dan memvalidasi citation IDs.
- Klasifikasi dokumen saat ini bukan interpretasi struktur tiap sheet. Group extraction saat ini mengekstrak jenis fakta, ringkasan, alerts/actions, health snapshots, dan metadata terbatas; belum memiliki kontrak khusus untuk tipe layout sheet atau usulan header/kolom.
- `tests/integration/phase6-document-parser.test.mjs` menguji contoh XLSX sintetis untuk multi-sheet, provenance, merged header, format tanggal, serta formula **dengan** cached value. Belum ada acceptance fixture untuk workbook nyata dengan banyak sheet dan formula tanpa cache.

### 3.2 Korpus SMART BUILDING yang ditinjau

Di `SMART BUILDING/Archive.zip`, 20 workbook XLSX nyata memiliki distribusi sheet: 16 workbook berisi 9 sheet, 2 berisi 5 sheet, 1 berisi 4 sheet, dan 1 berisi 1 sheet. Workbook `Pemantau Project/1. ALARM KEBENCANAAN/01_Alarm_Kebencanaan_Subcontractor_Weekly.xlsx` mempunyai 9 sheet: `Read Me`, `Project Info`, `Workplan & Gantt`, `Weekly Report`, `Integration Readiness`, `Issue Risk & Change`, `Evidence & Handover`, `PM Summary`, dan `Data Quality Audit`.

Inspeksi OOXML workbook contoh tersebut menemukan 277 formula tanpa cached value:

| Sheet | Formula tanpa cached value |
|---|---:|
| Workplan & Gantt | 170 |
| Weekly Report | 28 |
| PM Summary | 79 |
| **Total** | **277** |

Contoh formula yang terlihat pada `Workplan & Gantt` mencakup durasi, weighted progress, RAG, dan periode Gantt. Pada `Weekly Report`, formula mencakup variance dan RAG. Karena cache tidak ada, nilai hasilnya tidak tersedia untuk dibaca dari workbook yang diperiksa.

**[INFERENCE]** Struktur `Workplan & Gantt` memiliki label periode di baris terpisah dari nama kolom utama. `PM Summary` berbentuk pasangan label–nilai. Heuristik header saat ini berisiko menganggap baris yang salah sebagai header pada kedua pola tersebut. Hasil parser aktual untuk workbook ini belum dijalankan dalam runtime worker saat riset; acceptance implementation harus mengonfirmasi perilaku itu dengan menjalankan parser pada fixture yang disetujui.

## 4. Masalah dan tujuan

### 4.1 Masalah

1. Formula tanpa cache dapat terbaca sebagai string formula biasa, tanpa status typed yang dapat dipakai downstream untuk membedakan “hasil tak tersedia” dari nilai nol atau fakta kosong.
2. Hasil cache yang tersedia tidak menyatakan apakah workbook sudah dihitung ulang atau apakah nilai itu fresh.
3. Sheet korporat dapat mencampur judul, petunjuk, pasangan label–nilai, tabel, dan timeline. Flattening ke baris umum dapat menghilangkan relasi header-ke-nilai.
4. Group extraction yang ada dapat membaca teks, tetapi tidak memiliki kontrak untuk menyatakan “ini key/value”, “baris ini header”, atau “kolom ini adalah periode Gantt” beserta sumber selnya.
5. Memperbaiki persoalan itu dengan OCR atau formula engine akan menambah compute/runtime tanpa menyelesaikan ambiguitas semantik secara langsung.

### 4.2 Tujuan

1. Membuat keadaan formula dan hasil cache eksplisit, stabil, dan dapat ditelusuri sampai cell.
2. Mencegah nilai formula yang hilang dipakai sebagai fakta, `0`, atau input deterministik assurance.
3. Memakai interpretasi LLM hanya ketika parser tidak dapat mempertahankan struktur sheet secara andal.
4. Menyimpan interpretasi sebagai candidate yang dapat diverifikasi, dengan provenance hingga sheet/range/cell.
5. Menjaga compute ringan dengan memakai OOXML parser dan permintaan LLM worker yang sudah ada.
6. Memastikan sheet yang jelas tetap diproses tanpa interpretasi LLM tambahan.

### 4.3 Non-goals

- Menjalankan formula dengan Excel, LibreOffice, atau implementasi formula engine sendiri.
- Memperkirakan hasil formula menggunakan LLM.
- OCR terhadap nilai sel biasa atau seluruh halaman workbook.
- Menafsirkan semua sheet dengan LLM tanpa pemicu ambiguity.
- Membuat model/provider baru, memilih vendor, atau mengubah n8n menjadi pemilik pemanggilan model.
- Mengubah candidate menjadi accepted mapping, menyetujui baseline, atau menghitung Budget/Schedule/Risk dengan LLM.
- Menentukan bahwa workbook tertentu adalah source of truth hanya dari nama sheet, nama file, atau nilai confidence model.
- Mengganti kontrak besar evidence-normalization; requirement mapping/review umum tetap mengikuti PRD induk.

## 5. Pengguna dan kebutuhan

| Aktor | Kebutuhan |
|---|---|
| PMO/uploader | Melihat sheet/sel yang formula hasilnya tidak tersedia dan mengetahui bahwa file perlu dihitung ulang sebelum nilai itu dapat dipakai. |
| Reviewer | Memeriksa usulan struktur/header dan observation model berdampingan dengan range sumber aslinya. |
| Sistem ekstraksi | Membedakan raw value, formula, cache, dan status interpretasi; meneruskan hanya fakta yang didukung. |
| Worker/operator | Memakai batas input, concurrency, cache, dan provider yang sudah dikonfigurasi; tidak mengelola formula engine atau OCR baru. |

## 6. Istilah domain

| Istilah | Definisi |
|---|---|
| Formula expression | Ekspresi formula yang tersimpan di cell OOXML, tanpa evaluasi ulang oleh worker. |
| Cached result | Nilai terakhir yang disimpan oleh aplikasi spreadsheet bersama formula. Parser dapat membacanya, tetapi tidak membuktikan bahwa cache itu fresh. |
| Missing cache | Cell mempunyai formula, tetapi tidak memiliki cached result yang dapat dibaca. Bukan nol dan bukan bukti bahwa nilainya tidak ada. |
| Cached error | Formula cell memiliki hasil bertipe error, misalnya error spreadsheet. Tidak boleh dinormalisasi menjadi nilai numerik/string biasa. |
| Sheet interpretation | Usulan tipe layout, baris header, peran kolom, dan hubungan data dari satu worksheet atau blok; bukan approval bisnis. |
| Ambiguous | Ada lebih dari satu interpretasi struktur/pemetaan yang masuk akal atau bukti yang diberikan tidak cukup. |
| Source locator | Referensi ke workbook, sheet, row/range, dan—untuk formula atau klaim per-cell—alamat cell spesifik. |

## 7. Alur produk dan pemilik tanggung jawab

1. **Parser worker** membaca semua worksheet yang ditangani parser, mempertahankan raw cells, formula/cache state, source locators, dan diagnostics struktur.
2. **Rule layer worker** mengenali tabel jelas dan menentukan apakah satu blok cukup jelas untuk jalur deterministic. Ini bukan pengganti semantic interpretation lintas domain.
3. **Existing group extraction LLM** menerima source group bounded. Bila group XLSX ditandai ambiguous, request yang sama boleh menyertakan `sheet_interpretation` dan candidate observations. Group yang jelas tidak meminta output interpretasi tambahan.
4. **Validator worker** memeriksa schema, status formula, source IDs/cell locators, batas output, dan konsistensi bahwa model tidak mengubah formula tanpa cache menjadi nilai.
5. **Persist/review** menyimpan candidate, warning, provider/model/version, dan source reference. Candidate material atau ambiguous mengikuti review yang telah ditentukan PRD induk.
6. **n8n** tetap memanggil workflow/worker eksisting; tidak memproses XLSX sendiri dan tidak memanggil provider LLM secara paralel.

## 8. Functional requirements

### FR-01 — Provenance formula per cell

- Parser **MUST** mempertahankan formula expression dan cached result sebagai dua nilai terpisah.
- Formula yang material **MUST** memiliki locator `sheetName` + `cellRef`; row-level range boleh tetap digunakan untuk context tabel.
- Cached result **MUST** menyimpan nilai mentah dan tipe asal yang bisa dibedakan, minimum numeric, string, boolean, dan error.
- Nilai cache **MUST** diberi provenance `stored_cached_result`; UI/narasi tidak boleh menyebutnya “baru dihitung” tanpa bukti lain.
- Field `0` yang tersimpan **MUST** tetap berbeda dari missing cache, empty cache, atau error.

### FR-02 — Status formula yang tidak ambigu

Parser/output worker **MUST** membedakan sekurang-kurangnya:

- `not_formula`: cell bukan formula;
- `cached_value`: formula dan cached value terbaca, termasuk nilai `0`;
- `cached_empty`: formula cell memiliki representasi cache kosong yang dapat dibedakan dari cache yang tidak ada;
- `missing_cache`: formula ada, cached value tidak tersedia;
- `cached_error`: formula cache menyimpan error spreadsheet.

Jika format OOXML tidak memungkinkan status tertentu ditentukan dengan aman, status menjadi `unknown`/`needs_review`, bukan ditebak. Nilai formula dan status cache tidak boleh dikodekan hanya dalam satu string bebas sebagai satu-satunya representasi downstream.

### FR-03 — Tidak ada evaluasi formula

- Worker **MUST NOT** menghitung atau memperkirakan formula.
- LLM **MUST NOT** menggunakan formula expression untuk mengarang hasil numerik, status, variance, atau progress.
- Jika formula memiliki `missing_cache`, semua field yang bergantung pada hasil formula **MUST** membawa `formula_result_unavailable` dan tidak eligible menjadi input perhitungan deterministik.
- Jika formula memiliki cached result, downstream boleh menggunakan hanya nilai cache tersebut dengan label provenance yang tepat dan validasi tipe/satuan/scope yang berlaku.
- Ketidaktersediaan formula result **MUST NOT** otomatis menggagalkan seluruh workbook. Sheet/field lain yang didukung tetap dapat diproses.

### FR-04 — Penanganan dan pesan review

- Warning unresolved menyebut nama sheet, cell/range, formula, dan status cache; tidak menyatakan bahwa nilai sama dengan nol atau tidak ada di proyek.
- Pesan user yang disarankan: hitung ulang lalu simpan workbook di aplikasi spreadsheet, kemudian unggah ulang bila hasil formula diperlukan. Pesan **MUST NOT** menjamin bahwa tindakan tersebut akan memperbaiki semua formula.
- Status formula result dipisahkan dari status parsing, status ekstraksi LLM, status evidence, dan kondisi bisnis.
- Nilai hasil formula yang unavailable diperlakukan sebagai `needs_review`/`formula_result_unavailable`, bukan `not_found_in_scope`.

### FR-05 — Pemicu interpretasi sheet ambigu

Rule layer **SHOULD** memberi diagnostic ambiguity bila pola seperti berikut menghalangi pemetaan baris/kolom yang stabil:

- judul/preamble terpisah dari header data;
- lebih dari satu baris kandidat header atau merged header bertingkat;
- pasangan label–nilai, bukan tabel records;
- kolom tanggal/periode berulang atau matriks Gantt;
- beberapa area tabel di satu sheet atau header tidak persegi;
- nilai/cell type tidak konsisten dengan kandidat header;
- range formula/cache kosong membuat makna kolom hasil tidak tersedia.

Satu indikator saja tidak otomatis memanggil LLM jika layout tetap dapat dipetakan secara deterministic. Heuristik harus konservatif dan mengeluarkan diagnostic yang bisa diperiksa.

### FR-06 — Jalur LLM hanya untuk ambiguity yang relevan

- Sheet/table yang jelas **MUST** menggunakan hasil deterministic tanpa request interpretasi sheet tambahan.
- Untuk ambiguity yang relevan ke extraction, worker **SHOULD** menambahkan instruksi/output interpretasi ke existing group extraction request, bukan memanggil LLM per sheet atau per cell.
- Request tetap mematuhi limit group worker yang aktif dan hanya menerima block/range yang diperlukan; seluruh workbook tidak dikirim sebagai satu prompt tanpa batas.
- Jika batas input mencegah interpretasi, worker mempertahankan raw blocks dan menandai bagian yang terlewat sebagai `not_processed`/`needs_review`; tidak memotong diam-diam.
- Ketidakpastian semantik tidak memicu retry berulang. Retry format/schema tetap mengikuti kebijakan existing; hasil tetap ambiguous setelah retry masuk review.

### FR-07 — Kontrak keluaran interpretasi sheet

Interpretasi model untuk group XLSX **MUST** dapat menyatakan:

- `interpretation_status`: `resolved`, `ambiguous`, atau `unknown`;
- `structure_type`: `table`, `key_value`, `timeline_gantt`, `narrative`, `instructions_template`, `mixed`, atau `unknown`;
- kandidat header row/range dan kandidat peran kolom, setiap item dengan source locator;
- candidate observations yang relevan dengan output contract, mempertahankan `raw_value`, optional normalized value, tipe/satuan/periode jika didukung, dan source locator;
- warning yang menjelaskan ketidakpastian atau keterbatasan, tanpa chain-of-thought.

Aturan validasi:

- Semua source ID **MUST** berasal dari allowlist group; source locator **MUST** menunjuk sheet/cell/range yang benar-benar ada dalam input parser.
- Model **MUST NOT** menciptakan cell, sheet, header, cached value, tanggal, owner, atau nilai formula.
- Normalisasi **MUST** mempertahankan nilai mentah dan tidak menggantikan bukti sumber.
- `unknown`, `ambiguous`, dan `unmapped` adalah hasil sah. Model **MUST NOT** dipaksa memilih satu pemetaan.
- `resolved` hanya menyatakan struktur yang terpetakan terhadap bukti yang tersedia; bukan validasi kebenaran bisnis dan bukan persetujuan reviewer.

### FR-08 — Pemisahan interpretasi dari fakta dan approval

- Sheet role, kolom, relasi istilah, dan field assignment hasil LLM **MUST** tetap `candidate` sampai rule atau human decision yang berlaku menyetujuinya.
- Mapping material, perubahan baseline, dan penilaian Budget/Schedule/Risk tetap mengikuti PRD induk; interpretasi sheet tidak melewati jalur review tersebut.
- Workbook Read Me/instructions/template dapat menjelaskan definisi atau cara pelaporan, tetapi tidak menjadi bukti progress aktual dengan sendirinya.
- Jika satu sheet ambiguous, fakta dari sheet lain yang tervalidasi tetap boleh diproses. Satu ambiguity tidak boleh menyebar menjadi kesimpulan negatif global.

### FR-09 — Cache, versi, dan provenance model

- Perubahan parser yang mengubah cell/formula representation **MUST** menaikkan `parserVersion`.
- Perubahan bentuk output/prompt interpretasi **MUST** menaikkan schema/prompt version yang berpartisipasi dalam cache key/checkpoint.
- Cache hasil lama **MUST NOT** dianggap valid jika content hash, parser version, extraction schema/prompt version, atau dependency context yang relevan berubah.
- Setiap candidate interpretasi menyimpan provider/model, logical task, schema/prompt version, source IDs/locators, dan status validasinya sesuai kemampuan store existing.
- Implementasi **SHOULD** memakai cache/checkpoint group worker yang ada; tabel/provider baru hanya ditambahkan bila storage contract saat implementasi membuktikan tidak dapat memenuhi requirement.

### FR-10 — Keamanan konten workbook

- Nilai cell, formula, comments, dan instruksi template **MUST** diperlakukan sebagai untrusted evidence, bukan instruksi sistem.
- LLM hanya boleh mengakses source yang diizinkan untuk project/dokumen tersebut; referensi dari project lain ditolak.
- Data workbook tidak boleh dikirim ke provider baru hanya demi interpretasi sheet; kebijakan data dan otorisasi provider existing tetap berlaku.

## 9. Kontrak data konseptual

Ini logical contract untuk requirement, bukan keputusan nama kolom database:

```json
{
  "sheet_name": "Workplan & Gantt",
  "cell_ref": "K5",
  "formula_expression": "IF(J5=\"\",0,I5*J5)",
  "cached_result": {
    "status": "missing_cache",
    "type": null,
    "raw_value": null
  },
  "usable_value": null,
  "quality_state": "formula_result_unavailable"
}
```

`usable_value: null` pada contoh berarti **hasil tidak tersedia**, bukan nilai bisnis nol. Implementasi boleh memakai representasi berbeda selama kehilangan status dan provenance tersebut tidak mungkin.

Contoh konseptual output interpretasi:

```json
{
  "interpretation_status": "resolved",
  "structure_type": "key_value",
  "sheet_name": "PM Summary",
  "source_ids": ["allowed-source-id"],
  "header_candidates": [],
  "column_roles": [],
  "candidate_observations": [],
  "warnings": []
}
```

Contoh tidak menetapkan enum business field atau menggantikan extraction schema yang ada; implementasi harus menghubungkannya ke output contract aktif dan source allowlist.

## 10. Pembagian tanggung jawab LLM

| Logical role | Input | Output | Batas |
|---|---|---|---|
| Deterministic XLSX parser/rule layer | OOXML workbook, cell types, formula/cache, sheet/range structure | Raw cell evidence, formula state, layout diagnostics, source refs | Tidak menafsirkan istilah korporasi atau menghitung formula. |
| Existing document classifier | Preview bounded, metadata workbook, daftar sheet | Satu klasifikasi primer dokumen dan citation | Bukan classifier struktur tiap sheet; tidak menggantikan sheet interpretation. |
| XLSX sheet interpreter dalam group extraction | Ambiguous source group, parser diagnostics, source allowlist, canonical output contract | Struktur/kolom/observations sebagai candidate dan warnings | Tidak ada formula evaluation, approval, atau fakta tanpa citation. |
| Existing validator/worker rules | Output model dan sumber yang diizinkan | Valid/invalid candidate, warning, status review | Tidak menganggap JSON valid sebagai bukti benar. |
| Reviewer | Candidate, raw source, cell/range references, formula/cache status | Accept/correct/reject/defer sesuai permission dan workflow | Keputusan tidak ditulis oleh LLM. |

### 10.1 Satu model atau lebih dari satu

- **Default satu model:** provider/model worker yang ada menjalankan classifier dan group extraction seperti sekarang. Sheet interpretation disertakan hanya pada group XLSX yang ambiguous dan digabung dengan extraction request tersebut bila memungkinkan.
- **Multi-model bila kelak dipilih:** role XLSX interpreter boleh memiliki binding berbeda hanya jika task-based routing tersedia, model lolos evaluasi interpretasi, dan provider diizinkan untuk klasifikasi data tersebut. Kontrak output, sumber, review, dan formula guard tetap sama.
- Model kedua sebagai verifier **MAY** dipertimbangkan hanya jika benchmark menunjukkan pengurangan error material yang lebih besar daripada biaya/latency tambahannya. Verifier tidak membuktikan kebenaran melalui voting dan tidak wajib pada PRD ini.
- PRD ini tidak memilih model tertentu, menambah provider, atau menetapkan angka biaya tanpa benchmark.

## 11. Acceptance criteria

### 11.1 Formula

| ID | Skenario | Kriteria lulus |
|---|---|---|
| AC-F01 | Formula memiliki cache numerik `0`. | `0` disimpan sebagai cached value; bukan missing, blank, atau unresolved. |
| AC-F02 | Formula memiliki cache numerik/string yang terbaca. | Formula dan nilai cache terpisah; output menyatakan nilai adalah cache tersimpan dan mempertahankan cell locator. |
| AC-F03 | Formula tanpa `<v>` cache. | `missing_cache`; tidak ada hasil yang dikarang; downstream tidak boleh memakai nol atau hasil formula sebagai fakta. |
| AC-F04 | Formula dengan cached empty result. | Dibedakan dari cache yang tidak ada bila OOXML menyediakan bukti perbedaannya; bila tidak, status unknown dan review. |
| AC-F05 | Formula cached error. | Error dipertahankan sebagai error state, bukan normalized numeric/business value. |
| AC-F06 | Salah satu sheet memiliki formula unresolved, sheet lain memiliki tabel jelas. | Workbook tidak gagal seluruhnya; source yang valid tetap diproses dan keterbatasan lokal ditampilkan. |

### 11.2 Interpretasi sheet

| ID | Skenario | Kriteria lulus |
|---|---|---|
| AC-S01 | Tabel berheader jelas. | Jalur deterministic; tidak ada request interpretasi sheet tambahan. |
| AC-S02 | `PM Summary` berbentuk pasangan label–nilai. | Candidate struktur `key_value` atau `ambiguous` yang mencantumkan sumber; tidak mengarang tabel atau header. |
| AC-S03 | `Workplan & Gantt` memiliki label periode dan header kolom pada baris berbeda. | Interpretasi candidate mengidentifikasi rentang header/kolom yang didukung atau mengembalikan ambiguous; tidak menyamarkan label periode sebagai header seluruh kolom. |
| AC-S04 | Teks cell berisi instruksi seperti “abaikan aturan”. | Diperlakukan sebagai source text, tidak mengubah prompt, model routing, atau permission. |
| AC-S05 | Model memberi source ID/cell yang tidak tersedia. | Output kandidat ditolak/ditandai invalid; tidak dipersist sebagai supported fact. |
| AC-S06 | Model tidak dapat memilih struktur. | Hasil `unknown`/`ambiguous`, source asli tetap ada, dan status review tampil. Tidak ada loop retry semantik. |
| AC-S07 | Satu worksheet ambiguous di workbook 9-sheet. | Sheet lain yang jelas tetap diproses; coverage menyebut status tiap sheet/group. |
| AC-S08 | Formula tanpa cache ada dalam group yang sama dengan interpretasi. | LLM tidak menghasilkan hasil formula; output tetap `formula_result_unavailable`. |
| AC-S09 | Ubah parser/prompt/schema/model binding yang memengaruhi hasil. | Cache hasil tidak dipakai sebagai output versi baru. |
| AC-S10 | Workbook satu-model dan multi-model deployment. | Business contract, candidate status, citation validation, dan formula behavior identik. |

### 11.3 Quality gate sebelum promotion

- Acceptance fixtures membuktikan **nol** formula `missing_cache` berubah menjadi angka atau status bisnis.
- **100%** citations yang dipakai pada candidate interpretasi menunjuk source ID dan sheet/cell/range yang diizinkan.
- Semua test case deliberately ambiguous menghasilkan `ambiguous`/`unknown` atau candidate untuk review; tidak auto-accepted karena confidence model.
- Pemakaian model dihitung: jumlah request per dokumen/group, input/output tokens bila tersedia, p50/p95 latency, cache hit, dan error. Budget/latency deployment ditetapkan sebelum production promotion, bukan dikarang di PRD.
- Hasil dievaluasi pada fixture nyata yang disetujui dan held-out workbook; jangan memakai nama/angka SCIC sebagai hardcoded business rule.

## 12. Rancangan evaluasi

Dataset minimal harus memuat:

1. Workbook contoh 9-sheet di `SMART BUILDING/Pemantau Project/1. ALARM KEBENCANAAN/01_Alarm_Kebencanaan_Subcontractor_Weekly.xlsx` setelah akses dan penggunaan fixture disetujui.
2. Tabel normal satu header, merged/multirow headers, key/value, Gantt dengan tanggal/periode, beberapa table blocks dalam satu sheet, Read Me/template, serta sheet kosong atau hidden bila ada pada sample yang disetujui.
3. Formula dengan cache `0`, non-zero cache, missing cache, empty cache, dan cached error.
4. String ambigu atau prompt injection di sel, serta variasi bahasa Indonesia–Inggris.
5. Ground truth per sheet/block/header dan per observation dengan exact sheet/cell/range locator; label dibuat/ditinjau manusia, bukan dihasilkan oleh model yang diuji.

Metrik:

- ketepatan klasifikasi struktur sheet/block dan deteksi ambiguity;
- ketepatan baris header, column roles, dan hubungan nilai-ke-header;
- precision/recall observation per business field dan bahasa;
- citation/source-locator validity dan support rate;
- formula state accuracy serta jumlah false computed values;
- proporsi kasus unresolved yang benar diarahkan ke review;
- tambahan model calls, tokens, latency, serta cache behavior.

## 13. UX dan status yang terlihat

- Untuk formula tanpa cache, reviewer melihat workbook, sheet, cell/range, formula expression, dan status `hasil belum tersedia`; bukan nilai `0` atau label “tidak ditemukan”.
- Untuk interpretasi sheet, reviewer melihat candidate structure, header/column-role mapping, source excerpt/cell, alasan singkat, warning, dan tindakan review yang diizinkan.
- Hasil `candidate`, `ambiguous`, `unknown`, `formula_result_unavailable`, `not_processed`, dan parser failure tetap status berbeda.
- Output model tidak disajikan sebagai accepted fact sebelum validasi dan workflow approval yang relevan selesai.
- Rancangan memanfaatkan status/warning dan review UI yang sudah ada; screen baru tidak wajib untuk rilis pertama bila candidate dapat diperiksa di review surface existing.

## 14. Operasional, biaya, dan rollout

### Fase implementasi yang diusulkan

1. **Formula contract:** tambahkan typed formula/cache state, exact cell locator, raw preservation, dan parser versioning. Tidak ada LLM/formula engine baru.
2. **Deterministic ambiguity diagnostics:** bentuk parser diagnostics untuk header, key/value, timeline, dan block boundaries; jangan menimpa raw OOXML evidence.
3. **LLM candidate output:** perluas group-extraction schema untuk sheet interpretation pada group ambiguous saja; validasi source refs dan formula states sebelum cache/persist.
4. **Shadow/review rollout:** bandingkan candidate interpretation terhadap ground truth/reviewer; tidak mengubah accepted mapping atau downstream assurance otomatis.
5. **Promotion:** izinkan consumer memakai field yang lolos quality gate dan aturan review; simpan unresolved sebagai gap/review. Promotion tidak berarti formula dievaluasi ulang.

### Batas resource

- Tidak menambahkan OCR, LibreOffice, spreadsheet calculation runtime, atau model download pada worker.
- Deterministic parsing tetap bounded oleh batas file/package yang sudah ada.
- LLM memakai batas group, concurrency, retry, dan request size worker yang ada. Ambiguous sheet yang tidak muat tidak dikirim sebagai prompt besar; tandai review/partition sesuai limit existing.
- Jangan menambah request model hanya untuk mengulang interpretasi yang sama pada setiap cell. Cache scope/version mengikuti parser + extraction schema/prompt + content.

## 15. Risiko dan mitigasi

| Risiko | Mitigasi |
|---|---|
| Cached value sudah stale | Selalu sebut sebagai cache tersimpan; tidak ada klaim recalculate/freshness. Field material dapat diminta dihitung ulang dan diunggah kembali. |
| LLM membingkai asumsi sebagai header atau nilai | Candidate status, source allowlist, schema validator, explicit `ambiguous/unknown`, human review untuk mapping material. |
| Formula string membingungkan ekstraksi | Simpan expression/cache sebagai metadata terpisah; larang LLM menghitung hasilnya; validator menahan nilai hasil tanpa cache. |
| Workbook besar menghabiskan context/cost | Ambiguous-only, batching dalam group worker, existing limits, no full-workbook prompt. |
| Model/provider berubah dan cache usang | Version prompt/schema/model context di cache key/checkpoint; reprocess hanya hasil yang terdampak. |
| PRD berkembang menjadi “AI parser semua format” | Scope dibatasi pada formula XLSX dan sheet XLSX ambiguous; OCR/vision hanya di bawah kebutuhan dan otorisasi terpisah. |

## 16. Dependencies dan keputusan implementation-time

- Parser output memiliki source locator per cell/range yang dapat divalidasi oleh model validator dan UI review.
- Group extraction dapat menambahkan output sheet interpretation tanpa melewati JSON/schema validation dan allowed-source validation existing.
- Store/cache existing dapat menyimpan versi dan output candidate; schema database baru hanya dibuat bila JSON/checkpoint contract terbukti tidak cukup.
- Review surface existing dapat menampilkan warning formula dan candidate sheet mapping dengan permission project yang sama.
- Sebelum implementasi, jalankan parser dalam runtime worker pada workbook 9-sheet dan capture hasil aktual. Analisis sebelumnya memeriksa OOXML workbook dan source code; belum mengamati output parser runtime untuk file tersebut.

## 17. Di luar keputusan PRD ini

1. Apakah user wajib menerima instruksi “hitung ulang dan unggah ulang” atau cukup mendapat warning. Default yang disarankan: warning dan opsi tindak lanjut, bukan upload blocker.
2. Apakah ada kasus di mana hasil formula tanpa cache boleh diestimasi untuk display. Default: tidak; estimasi tidak masuk fakta dan tidak mengisi assessment.
3. Apakah hasil interpretasi struktur non-material boleh diterapkan otomatis setelah evaluasi. Default rilis awal: hanya interpretasi sebagai candidate; accepted mapping tetap mengikuti PRD induk.
4. Apakah perlu verifier LLM independen. Default rilis awal: tidak; pertimbangkan hanya jika benchmark menunjukkan manfaat terhadap error material.

Keempat default tersebut konservatif dan tidak memerlukan keputusan vendor/model sebelum implementasi.
