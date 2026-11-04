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

**Handoff (worktree `../DevXassurance-pmo-health-01`, branch `ticket/pmo-health-01`, baseline `db96485`).**

Perubahan produksi (hanya jalur worker evidence):
- `worker/src/services/document-parser.ts`: format angka bawaan `0%`/`0.00%` (numFmtId 9/10) dikenali; sel persen non-formula dengan nilai numerik menampilkan persentase (`0.125` → `12.5%`) di `text`/`modelText` sementara anotasi `[raw value: 0.125; number format: 0%]` tetap utuh. Konversi hanya jika format sel sendiri membuktikannya; sel formula, teks, dan tanggal tidak diubah.
- `worker/src/services/document-extraction.ts`: `period_label` dan `as_of_date` pada cost observation wajib ada di sumber yang dikutip (sama seperti baris assurance); periode/cut-off dari sel atau snapshot lain tidak lagi lolos.
- `worker/README.md`: mencatat kedua perilaku di atas.

Verifikasi yang dijalankan (semua deterministik, tanpa provider live, tanpa Supabase hosted; respons model dikendalikan mock):
- `node --test tests/integration/evidence-provenance.test.mjs` → 5/5 lulus. Replay nyata `2026-10-09_w4` dan `2026-10-16_w5` `01_Alarm_Kebencanaan_Subcontractor_Weekly.xlsx` lewat `processDocumentJob`: D7 `12.5%` dan D8 `20.4%` diterima dengan `source_location` tepat (`Weekly Report!D7`/`D8`, row tunggal), meskipun grup sumber memuat formula unresolved; kutipan sel formula (`F8`) dan barisnya ditolak `formula_result_unavailable`; coverage empat domain `unprocessed` (bukan nol/absent); risiko W5 `R-SB01-001` tersimpan dengan lokasi. Negatif: source ID palsu, excerpt tak didukung, cut-off salah, scope lintas sel, dan cache versi parser lama tidak lolos; cache hit tidak memanggil model dan lokasi diturunkan ulang dari chunk hidup; payload persistensi mempertahankan `source_location` sel dan fallback lokasi chunk.
- `node --test tests/integration/phase6-document-extraction.test.mjs` → 30/30 lulus (termasuk per-cell vs formula unresolved, WBS cost, cache).
- `node --test tests/integration/phase6-document-parser.test.mjs` → 17/19; 2 gagal sudah ada di baseline `db96485` (wording `(stored cached result: 61` yang lebih baru dari assertion lama, dan OCR lokal tidak tersedia di environment ini) — direproduksi identik di worktree baseline.
- Batch `phase6-document-summary`, `phase6-n8n-document-processing`, `demo-evidence-scenarios`, `review-period`, `extracted-details`, `phase-6-evidence-metadata`, `phase6-e2e-provider`: hasil gagal/lulus identik dengan baseline (yang gagal butuh Supabase lokal), tidak ada regresi.

Batas yang tersisa:
1. Teks ringkas yang dilihat model (`modelText`) untuk sel ber-format angka/tanggal bukan substring dari teks kanonik yang dikutip, jadi excerpt hasil model harus berupa potongan yang benar-benar ada di teks kanonik; excerpt di luar sumber tetap ditolak. Penyelarasan `modelText`/`excerpt` adalah perubahan desain di luar tiket ini.
2. `percent` harus dilaporkan sebagai persentase yang ditampilkan; `raw_value` pecahan murni (`0.125`) tanpa dukungan unit tetap ditolak sebagai gap, bukan dikonversi diam-diam.
3. `extraction` hanya menjamin periode/cut-off dapat ditelusuri ke sumber, bukan kesamaan dengan cut-off review tingkat dokumen; pencampuran lintas cut-off tetap urusan identitas dokumen/periode (tiket 04).
4. Tidak ada panggilan provider live; kelayakan quoting model nyata tidak dibuktikan di sini.
5. `tests/integration/evidence-provenance.test.mjs` menambah `node_modules` symlink di worktree (gitignored) agar bisa dijalankan tanpa `npm install`.

