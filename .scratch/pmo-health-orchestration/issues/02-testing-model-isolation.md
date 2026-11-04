# 02: Seleksi dan isolasi model pengujian

**What to build:** Tim dapat memilih kandidat model khusus testing yang terisolasi tanpa mengubah atau menggunakan kuota model production.

**Blocked by:** None (can start immediately).

**Status:** claimed

Baca [rencana dan constraint](../plan.md). Ini evaluasi read-only; jangan mengubah konfigurasi production atau melakukan request model live tanpa persetujuan eksplisit user.

- [ ] Bandingkan kandidat yang benar-benar tersedia menggunakan bukti sumber primer terkini untuk API JSON, konteks, rate limit, biaya, lisensi, privasi, hardware, dan response-shape.
- [ ] Usulkan model/version dan konfigurasi testing terpisah, dengan batas request/biaya, fallback dimatikan, dan rollback; jika akses atau kandidat belum ada, catat blocker.
- [ ] Tidak mengirim dokumen nyata kepada provider; izin menggunakan fixture sintetis harus dipastikan sebelum live testing.
- [ ] Tegaskan bahwa hasil model testing tidak membuktikan kualitas `gpt-oss:20b` production.

## Comments
