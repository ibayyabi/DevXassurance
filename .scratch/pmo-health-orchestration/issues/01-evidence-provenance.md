# 01: Evidence provenance dan reproduksi lokal

**What to build:** Evidence literal dari dokumen PMO dapat dibaca dan divalidasi dengan lokasi sumber, konteks scope, unit, dan periode yang dapat ditelusuri, tanpa menebak hasil formula.

**Blocked by:** Kuota Command Code habis; menunggu dapat melanjutkan dengan subagent sesuai pilihan pengguna.

**Status:** needs-info

Baca [rencana dan kontrak bersama](../plan.md), khususnya constraint model dan kuota. Gunakan fixture Smart Building untuk replay deterministik tanpa provider live.

- [ ] Reproduksi alur parser → validasi → hasil/persistensi untuk bukti W4/W5 tanpa panggilan LLM.
- [ ] Nilai literal yang didukung diterima dengan lokasi tepat walaupun sel lain mengandung formula unresolved; hasil formula unresolved tidak dikarang atau dinilai nol.
- [ ] Hubungan lintas sel untuk periode, scope, dan satuan hanya diterima bila struktur sumber membuktikannya; kasus ambigu tetap gap.
- [ ] Source ID palsu, cut-off salah, cache versi lama, dan kutipan tidak didukung tidak lolos; provenance tetap benar saat cache hit dan tersimpan.
- [ ] Bukti verifikasi dan batas yang tersisa dicatat dalam Comments.

## Comments

- Pekerjaan kandidat tersimpan di worktree `../DevXassurance-pmo-health-01`, branch `ticket/pmo-health-01`, commit `48689e2`; **belum digabung ke integration branch** dan belum memenuhi seluruh acceptance.
- Verifikasi offline pada kandidat: 34 pengujian evidence/extraction dan 4 pengujian XLSX terarah lulus, `tsc --noEmit` lulus; parser membaca W4 D7 `12.5%` dan W5 D8 `20.4%`. Ini tidak membuktikan persistensi database atau kualitas model production.
- Blocker correctness: `contextSources` membangun kutipan `${subject.key}: ${subject.value}` dari label dan nilai pada dua sel, tetapi menyimpan lokasi hanya untuk sel nilai. Kutipan tersebut bukan kutipan verbatim dari satu sel yang ditunjuk; benahi dan buktikan lokasi label maupun nilai sebelum menggabungkan patch. Review independen juga belum selesai karena 429.
- Tidak ada provider LLM aplikasi live atau mutasi Supabase hosted. Pengguna memilih menunggu Command Code, bukan mengganti pelaksana.
