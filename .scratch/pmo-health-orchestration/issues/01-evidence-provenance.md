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

**Handoff 2 (worktree `../DevXassurance-pmo-health-01`, branch `ticket/pmo-health-01`, baseline `db96485`).**

Kontrak sumber yang diperbaiki (temuan review): sebelumnya `modelText` (teks ringkas yang dilihat model) bukan substring dari teks kanonik yang dipakai validator, sehingga excerpt hasil model nyata bisa gagal validasi walau berasal dari sel yang sama — replay bisa lulus keliru bila test memakai teks kanonik. Sekarang untuk setiap cell/row XLSX, teks kanonik **dimulai dengan** teks yang dilihat model, dan anotasi `[raw value: …; number format: …; ISO date: …; formula cache: …]` ditambahkan setelahnya. Jadi excerpt yang disalin model dari prompt selalu substring sumber kanonik (`parser_metadata`/`chunk_text` yang dipersist) dan tetap dapat diverifikasi.

Perubahan produksi (jalur worker evidence saja):
- `worker/src/services/document-parser.ts`:
  1. Teks kanonik sel/baris = teks yang dilihat model + anotasi mentah di akhir (lihat di atas). Nilai anotasi tidak berubah; hanya urutannya.
  2. Format persen bawaan `0%`/`0.00%` (numFmtId 9/10) dikenali, dan sel non-formula numerik dengan format persen menampilkan nilai persen eksak (`0.125` → `12.5%`, bukan pembulatan tampilan Excel) di teks yang dilihat model maupun kanonik.
  3. Konversi hanya bila format sel **membuktikan** penskalaan: setiap section numerik harus pola `#0…`+`%` murni. `\%` escaped, `"%"` quoted, section warna/kondisi, dan format mata uang/tanggal tidak dikonversi (`isPercentNumberFormat`).
- `worker/src/services/document-extraction.ts`: `period_label` dan `as_of_date` pada cost observation wajib ada di sumber yang dikutip (sama seperti baris assurance).
- `worker/README.md`: mencatat kontrak teks + konversi persen + syarat periode cost.

Test (`tests/integration/evidence-provenance.test.mjs`, dibantu `tests/integration/helpers/worker-modules.mjs`):
- Respons model terkendali dibangun **hanya** dari field prompt (`SOURCE_REFERENCES_JSON`); excerpt adalah potongan teks yang memang dilihat model, bukan teks kanonik.
- Kontrak diuji langsung: untuk setiap `sourceReference` di W4/W5, `text.includes(modelText)` harus benar.
- Replay W4/W5 lewat `processDocumentJob`: satu actual **bertanggal** (`as_of_date` = cut-off baris, `period_label` = minggu) diterima dari kutipan baris, `scope_level: "unknown"` karena baris tidak menyatakan scope; fact sel literal D7/D8 menyimpan lokasi sel tepat; kutipan sel formula (`F8`/`F9`) dan barisnya ditolak `formula_result_unavailable`; coverage empat domain `unprocessed` (tidak ada nol/hijau). Negatif: cut-off salah, scope WBS milik sel lain, source ID palsu — semuanya ditolak; kutipan tersimpan ada di dalam `chunk_text` persistensi. Cache: versi parser lama tidak dipakai (group key berbeda), cache hit tidak memanggil model dan lokasi diturunkan ulang dari chunk hidup. Cost: periode/cut-off tak bersumber ditolak.

Verifikasi: **tidak dijalankan lagi oleh saya** setelah revisi ini (instruksi integrator: tidak menjalankan test/build/lint; verifikasi setelah commit akhir). Yang saya lakukan hanya `node --check` sintaks pada dua file test baru. Hasil yang sudah pernah saya jalankan pada revisi sebelumnya (sebelum kontrak teks diubah): `tests/integration/evidence-provenance.test.mjs` 5/5, `phase6-document-extraction.test.mjs` 30/30, `phase6-document-parser.test.mjs` 17/19 dengan 2 gagal pra-baseline (wording `(stored cached result: 61` dan OCR lokal tidak tersedia) yang juga gagal di worktree baseline `db96485`; batch summary/n8n/demo-evidence/review-period/extracted-details/evidence-metadata/e2e-provider gagal-lulus identik dengan baseline (butuh Supabase lokal). **Revisi ini mengubah bentuk teks baris XLSX, jadi `phase6-document-parser.test.mjs` (dan test apa pun yang membaca teks baris XLSX) wajib dijalankan ulang oleh integrator.** Hanya `phase6-document-parser.test.mjs` yang membangun XLSX; test extraction/summary memakai chunk sintetis.

Batas yang tersisa:
1. Excerpt assurance disimpan apa adanya (harus substring sumber kanonik); validator tidak memverifikasi bahwa nomor/unit berasal dari kolom yang sama bila model mengutip seluruh baris, jadi tanggal lain di baris yang sama (mis. kolom Due Date) bisa memenuhi aturan "tanggal ada di excerpt". Membedakan semantik kolom butuh mapping header/kolom (tiket 03/04).
2. `percent` dilaporkan sebagai persentase tampilan; `raw_value` pecahan murni (`0.125`) tanpa dukungan unit tetap ditolak sebagai gap, bukan dikonversi diam-diam.
3. `extraction` menjamin periode/cut-off dapat ditelusuri ke sumber, bukan kesamaan dengan cut-off review tingkat dokumen; pencampuran lintas cut-off tetap urusan identitas dokumen/periode (tiket 04).
4. Tidak ada panggilan provider live; kelayakan quoting model nyata tidak dibuktikan.
5. Mapping route→RPC persistensi (`observation.source_location ?? chunk.parser_metadata.sourceLocation`) tidak saya ubah dan tidak saya uji ulang; replay hanya membuktikan observasi membawa lokasi parser-authored dan `excerpt` berada di dalam `chunk_text` yang dipersist. Test persistensi berbasis mock route dihapus sesuai instruksi menghindari test wiring.
6. Worktree memakai symlink `node_modules` (gitignored) agar test bisa dijalankan tanpa `npm install`.
