# 04: Progress per komponen dan cut-off

**What to build:** PMO melihat planned dan actual progress untuk scope dan periode yang sebanding, serta perubahan dari snapshot sebelumnya dengan sumber kedua periode.

**Blocked by:** 01: Evidence provenance dan reproduksi lokal; 03: Evidence parsial yang aman dan review.

**Status:** claimed

Baca [rencana](../plan.md). Aturan disepakati: RAG sumber disimpan sebagai klaim bersitasi, terpisah dari status hitungan. Hitung status hanya dengan aturan per proyek yang disetujui dan berversi; tanpa aturan yang berlaku, tetap tampilkan nilai dan status belum dinilai. Ambang fixture bukan default global. Kontrak saat ini tetap melarang rollup project dari WBS.

- [ ] W4/W5 SB01 menampilkan actual 12,50% → 20,40%, delta +7,90 poin persentase, dengan tanggal dan kutipan kedua sumber.
- [ ] Planned/actual dibandingkan hanya untuk scope, unit, dan periode yang terbukti sebanding; fraksi dinormalisasi hanya bila didukung sumber/format.
- [ ] Previous snapshot dibedakan dari baseline rencana yang disetujui; identik filename dengan isi berbeda tidak menimpa snapshot.
- [ ] Metadata bulan saja, unit ambigu, konflik, missing periode, dan bukti masa depan ditampilkan sebagai gap, bukan ditebak.
- [ ] Gunakan hanya aturan per proyek yang disetujui dan berversi; tanpa aturan, status hitungan belum dinilai. RAG sumber tetap dibedakan dan bersitasi.

## Comments

- Persiapan read-only: comparator `src/features/assurance/lib/schedule-comparison.ts` belum membedakan planned/actual atau memilih snapshot berdasarkan cut-off; ia memakai peran baseline/current. Rancangan harus memisahkan previous snapshot dari approved baseline.
- Overview aktif memakai `src/app/app/projects/[projectId]/dashboard/page.tsx` → `UsableOverview`; model chart saat ini belum memuat Progress. Scope SB01 tidak boleh diperlakukan sebagai total proyek atau dijumlahkan dari WBS.
- Workbook terbaru tetap menyatakan W4 planned 11,45% / actual 12,50% dan W5 planned 18,13% / actual 20,40%. Formula RAG memiliki cache; freshness cache tidak otomatis terbukti. `expected-results.json` hanya oracle, bukan evidence yang diunggah.
