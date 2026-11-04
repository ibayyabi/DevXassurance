# 02: Seleksi dan isolasi model pengujian

**What to build:** Tim dapat memilih kandidat model khusus testing yang terisolasi tanpa mengubah atau menggunakan kuota model production.

**Blocked by:** None (can start immediately).

**Status:** needs-info

Baca [rencana dan constraint](../plan.md). Ini evaluasi read-only; jangan mengubah konfigurasi production atau melakukan request model live tanpa persetujuan eksplisit user.

- [ ] Bandingkan kandidat yang benar-benar tersedia menggunakan bukti sumber primer terkini untuk API JSON, konteks, rate limit, biaya, lisensi, privasi, hardware, dan response-shape.
- [x] Usulkan model/version dan konfigurasi testing terpisah, dengan batas request/biaya, fallback dimatikan, dan rollback; jika akses atau kandidat belum ada, catat blocker.
- [x] Tidak mengirim dokumen nyata kepada provider; izin menggunakan fixture sintetis harus dipastikan sebelum live testing.
- [x] Tegaskan bahwa hasil model testing tidak membuktikan kualitas `gpt-oss:20b` production.

## Comments

- Riset di [testing-model-notes.md](../testing-model-notes.md) membandingkan kandidat dan mengusulkan `gpt-oss:20b` lokal; belum ada runtime/weights lokal dan akses provider belum divalidasi. Kriteria kandidat yang benar-benar tersedia belum terbukti.
- Tidak ada pengujian live atau instalasi. Batas request dan stop pada 429 masih usulan, bukan kontrol yang ditegakkan; verifikasi live tetap terblokir oleh izin dan mekanisme pembatasan yang teruji.
