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
