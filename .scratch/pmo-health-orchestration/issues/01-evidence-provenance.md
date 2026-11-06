# 01: Evidence provenance dan reproduksi lokal

**What to build:** Evidence literal dari dokumen PMO dapat dibaca dan divalidasi dengan lokasi sumber, konteks scope, unit, dan periode yang dapat ditelusuri, tanpa menebak hasil formula.

**Blocked by:** None (can start immediately).

**Status:** resolved

Baca [rencana dan kontrak bersama](../plan.md), khususnya constraint model dan kuota. Gunakan fixture Smart Building untuk replay deterministik tanpa provider live.

- [x] Reproduksi alur parser → validasi → hasil/persistensi untuk bukti W4/W5 tanpa panggilan LLM.
- [x] Nilai literal yang didukung diterima dengan lokasi tepat walaupun sel lain mengandung formula unresolved; hasil formula unresolved tidak dikarang atau dinilai nol.
- [x] Hubungan lintas sel untuk periode, scope, dan satuan hanya diterima bila struktur sumber membuktikannya; kasus ambigu tetap gap.
- [x] Source ID palsu, cut-off salah, cache versi lama, dan kutipan tidak didukung tidak lolos; provenance tetap benar saat cache hit dan tersimpan.
- [x] Bukti verifikasi dan batas yang tersisa dicatat dalam Comments.

## Comments

- Eksekusi dijeda atas permintaan pengguna; subagent Luna dihentikan. Worktree `../DevXassurance-pmo-health-01` pada branch `ticket/pmo-health-01` masih memiliki perubahan **belum dikomit dan belum diverifikasi** pada `worker/src/services/document-parser.ts` dan `document-extraction.ts`. Pertahankan perubahan itu; jangan reset, stash, atau menganggapnya selesai. Commit terakhir tetap `48689e2`.
- Audit read-only fixture checkout utama: W4 `Weekly Report!B7/C7/D7` = 2026-10-09 / 11,45% / 12,5%; W5 `B8/C8/D8` = 2026-10-16 / 18,13% / 20,4%. Workbook terbaru memiliki formula cache yang dihitung ulang; sebagian cache W5 `Workplan & Gantt!M5/M6/M8` berubah. Saat lanjut, gunakan workbook checkout utama secara read-only dan jangan timpa perubahan pengguna; skenario formula tanpa cache perlu contoh terpisah.
- Langkah berikut: selesaikan koreksi provenance label/nilai dua sel, verifikasi perubahan yang tertunda dan review, lalu uji deterministik serta smoke pada fixture terbaru. Jangan gabungkan kandidat sebelum semua acceptance tiket terpenuhi.

- Pengguna mengizinkan eksekusi dilanjutkan dengan `openai-codex/gpt-6-luna:xhigh`; perubahan workbook yang belum dikomit di checkout utama harus dipertahankan dan diperhitungkan saat verifikasi.

- Pekerjaan kandidat tersimpan di worktree `../DevXassurance-pmo-health-01`, branch `ticket/pmo-health-01`, commit `48689e2`; **belum digabung ke integration branch** dan belum memenuhi seluruh acceptance.
- Verifikasi offline pada kandidat: 34 pengujian evidence/extraction dan 4 pengujian XLSX terarah lulus, `tsc --noEmit` lulus; parser membaca W4 D7 `12.5%` dan W5 D8 `20.4%`. Ini tidak membuktikan persistensi database atau kualitas model production.
- Blocker correctness: `contextSources` membangun kutipan `${subject.key}: ${subject.value}` dari label dan nilai pada dua sel, tetapi menyimpan lokasi hanya untuk sel nilai. Kutipan tersebut bukan kutipan verbatim dari satu sel yang ditunjuk; benahi dan buktikan lokasi label maupun nilai sebelum menggabungkan patch. Review independen juga belum selesai karena 429.
- Tidak ada provider LLM aplikasi live atau mutasi Supabase hosted. Pengguna memilih menunggu Command Code, bukan mengganti pelaksana.

- Kandidat terakhir `01bd56d`: suite parser/extraction/provenance dan budget terarah lulus dengan OCR lokal tidak tersedia dikecualikan; `tsc --noEmit` lulus. Replay worker deterministik pada fixture checkout utama membaca W4 12,5% (9 Oktober 2026) dan W5 20,4% (16 Oktober 2026), scope Alarm Kebencanaan, dengan tiga referensi provenance.
- Persistensi observasi W4/W5 dan cache/fencing diuji melalui RPC PostgreSQL pada database disposable tanpa jaringan; tidak ada mutasi Supabase hosted atau panggilan LLM aplikasi live. Hasil ini belum membuktikan kualitas klasifikasi model production, review UI, atau kesehatan proyek end-to-end.
- Guard naratif menolak klaim ambigu, negasi, dan konteks risiko/biaya yang dikenali; daftar istilah bukan jaminan untuk semua bahasa/template. Formula cache tetap perlu review dan tidak dianggap bukti kesegaran perhitungan.
