# 01: Evidence provenance dan reproduksi lokal

**What to build:** Evidence literal dari dokumen PMO dapat dibaca dan divalidasi dengan lokasi sumber, konteks scope, unit, dan periode yang dapat ditelusuri, tanpa menebak hasil formula.

**Blocked by:** None (can start immediately).

**Status:** claimed

Baca [rencana dan kontrak bersama](../plan.md), khususnya constraint model dan kuota. Gunakan fixture Smart Building untuk replay deterministik tanpa provider live.

- [ ] Reproduksi alur parser → validasi → hasil/persistensi untuk bukti W4/W5 tanpa panggilan LLM.
- [ ] Nilai literal yang didukung diterima dengan lokasi tepat walaupun sel lain mengandung formula unresolved; hasil formula unresolved tidak dikarang atau dinilai nol.
- [ ] Hubungan lintas sel untuk periode, scope, dan satuan hanya diterima bila struktur sumber membuktikannya; kasus ambigu tetap gap.
- [ ] Source ID palsu, cut-off salah, cache versi lama, dan kutipan tidak didukung tidak lolos; provenance tetap benar saat cache hit dan tersimpan.
- [ ] Bukti verifikasi dan batas yang tersisa dicatat dalam Comments.

## Comments

**Handoff 3 (worktree `../DevXassurance-pmo-health-01`, branch `ticket/pmo-health-01`, baseline `db96485`).**

Tiga hal yang diperbaiki atas review integrator:

1. **Kontrak teks sumber.** Teks kanonik sel/baris XLSX sekarang dimulai dengan teks yang dilihat model dan menambahkan anotasi `[raw value: …; number format: …; ISO date: …; formula cache: …]` di belakangnya. Jadi setiap excerpt hasil model adalah substring sumber kanonik yang divalidasi dan dipersist (`chunk_text`). Diuji langsung untuk seluruh `sourceReference` di W4/W5: `text.includes(modelText)`.
2. **Versi cache.** `PARSER_VERSION` → `document-parser/10` (output parser berubah) dan `EXTRACTION_SCHEMA_VERSION` → `phase6-document-extraction/17` (semantik validasi berubah). Keduanya bagian dari group key, sehingga baris cache lama tidak bisa dipakai ulang; test cache menyimpan baris dengan versi nyata dan membuktikan baris versi `document-parser/9` tidak dipakai (model dipanggil ulang) serta `schemaVersion` tersimpan sebagai `…/17`.
3. **Tanggal lintas kolom.** Aturan baru: tanggal (`as_of_date`, `date` milestone, mitigation due date, cut-off cost) hanya diterima bila sumber yang dikutip adalah **satu sel**; kutipan baris/tabel yang mencakup banyak kolom menjadikan tanggal **gap** (`spans more than one cell, so its date cannot be attributed to a column`). Ini menutup substitusi kolom (mis. Due Date di baris yang sama) tanpa kosakata atau template fixture, dan berlaku juga untuk payload XLSX lama tanpa rentang sel.

Perubahan produksi: `worker/src/services/document-parser.ts` (kontrak teks + format persen `0%`/`0.00%` + tampilan persen eksak yang hanya bila setiap section numerik membuktikan penskalaan + bump versi), `worker/src/services/document-extraction.ts` (helper `dateAttributionErrors` pada cost/milestone/progress/risk + `period_label`/`as_of_date` cost wajib ada di sumber + bump schema), `worker/README.md` (mencatat kontrak teks, aturan tanggal satu sel, dan bump versi). `tests/integration/phase6-document-parser.test.mjs` hanya diperbarui pada dua literal versi `document-parser/9` → `/10`; tidak ada assertion yang dilemahkan.

Test (`tests/integration/evidence-provenance.test.mjs` + helper `tests/integration/helpers/worker-modules.mjs`):
- replay W4/W5 lewat `processDocumentJob` dengan respons terkendali yang dibangun **hanya** dari `SOURCE_REFERENCES_JSON`;
- diterima: actual per-sel D7/D8 (`12.5%`/`20.4%`, `scope_level: "unknown"`, `as_of_date: null`, lokasi sel tepat) dan milestone dari sel cut-off tunggal B7/B8 (`date` = cut-off, lokasi sel tunggal);
- ditolak: kutipan baris ber-`as_of_date` (atribusi kolom), scope WBS milik sel lain, source ID palsu, kutipan sel/baris formula (`formula_result_unavailable`); coverage empat domain `unprocessed`, tanpa nol/hijau; excerpt diterima ada di dalam `chunk_text` persist;
- test terpisah: baris pendek yang memuat cut-off + Actual % + Due Date — klaim `as_of_date` = Due Date ditolak walau tanggalnya ada di excerpt, sedangkan sel tunggal cut-off tetap diterima;
- test cost: periode/cut-off tak bersumber ditolak.

Verifikasi: **tidak menjalankan test/build/lint** (instruksi integrator). Hanya `node --check` pada dua file `.mjs` dan transpile sintaks TS pada dua file worker. Karena parser/validasi/versi berubah, integrator wajib menjalankan: `node --test tests/integration/evidence-provenance.test.mjs tests/integration/phase6-document-parser.test.mjs tests/integration/phase6-document-extraction.test.mjs`. Hasil run pada revisi sebelumnya (sebelum kontrak teks + aturan tanggal + bump versi): provenance 5/5, extraction 30/30, parser 17/19 dengan 2 gagal pra-baseline (wording `(stored cached result: 61` dan OCR lokal tidak tersedia) yang juga gagal di worktree baseline `db96485`; batch summary/n8n/demo-evidence/review-period/extracted-details/evidence-metadata/e2e-provider gagal-lulus identik dengan baseline (butuh Supabase lokal). Hanya `phase6-document-parser.test.mjs` yang membangun XLSX.

Batas yang tersisa:
1. Aturan tanggal satu sel berarti cut-off baris mingguan (nilai di satu kolom, tanggal di kolom lain) adalah **gap**, bukan nilai bertanggal; linking header/kolom untuk merekonstruksi relasi itu adalah pekerjaan tiket 03/04. Perlindungannya konservatif: kutipan multi-sel tidak pernah menerima tanggal.
2. `percent` dilaporkan sebagai persentase tampilan; `raw_value` pecahan murni (`0.125`) tanpa dukungan unit tetap ditolak sebagai gap.
3. Dokumen non-spreadsheet memakai aturan unit-kutipan (satu chunk/paragraf), jadi risiko tanggal dari kalimat lain di unit yang sama tetap ada.
4. `extraction` tidak membandingkan periode dengan cut-off review tingkat dokumen; pencampuran lintas cut-off tetap urusan identitas dokumen/periode (tiket 04).
5. Tidak ada panggilan provider live; kelayakan quoting model nyata tidak dibuktikan.
6. Mapping route→RPC persistensi tidak berubah dan tidak diuji ulang (test mock-echo dihapus sesuai instruksi); replay hanya membuktikan observasi membawa lokasi parser-authored dan excerpt ada di dalam `chunk_text`.
7. Worktree memakai symlink `node_modules` (gitignored) agar test bisa dijalankan tanpa `npm install`.
