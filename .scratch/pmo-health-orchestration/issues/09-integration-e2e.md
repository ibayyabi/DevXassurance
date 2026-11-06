# 09: Integrasi dan computer-use E2E

**What to build:** PMO dapat menelusuri evidence baseline dan snapshot W4/W5 hingga hasil assurance dan Overview yang jujur, termasuk review dokumen dan penjelasan gap.

**Blocked by:** 04: Progress per komponen dan cut-off; 05: Perbandingan risk snapshot lintas waktu; 06: Overview progress dan navigasi tinjauan; 07: Ketahanan job dan status pemrosesan. Tiket 08 hanya diperlukan untuk klaim live-provider, bukan E2E offline.

**Status:** ready-for-agent

Baca [rencana](../plan.md). Gunakan lingkungan test dan proyek baru; periksa migrasi/target. Pengujian provider live, hosted DB mutation, deployment, dan upload penuh memerlukan izin user secara terpisah.

- [ ] Jalankan baseline → W4 → review `needs_review` → assurance → W5 file bernama sama → assurance → Overview; bandingkan dengan oracle fixture tanpa mengunggah oracle.
- [ ] Progress, sumber, tanggal, scope, warning, dan gap sesuai bukti; tidak mengisi nilai atau menerima seluruh fakta secara buta agar test lulus.
- [ ] W6/W7 dan tes provider live dilakukan hanya bila user menyetujui kapasitas/budget; catat request count dan berhenti pada quota/error.
- [ ] Catat PASS/FAIL/BLOCKED/DATA GAP, langkah, screenshot, environment, hasil, dan batas klaim; tidak menganggap model testing membuktikan kualitas production.

## Comments
