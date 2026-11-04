# 08: Verifikasi kandidat model khusus testing

**What to build:** Tim memperoleh bukti terukur tentang kandidat model testing pada lingkungan terisolasi, tanpa mengubah model production.

**Blocked by:** 02: Seleksi dan isolasi model pengujian; persetujuan eksplisit user untuk provider, data, jumlah maksimum request, biaya, dan lingkungan.

**Status:** needs-info

Baca [rencana](../plan.md). Jangan melakukan panggilan live sebelum user memberikan izin di atas; hentikan saat batas, 429/402, atau biaya tidak pasti.

- [ ] Jalankan hanya skenario kecil sintetis/non-sensitive dalam konfigurasi dan database test terpisah, dalam batas yang disetujui.
- [ ] Periksa JSON, source ID, bahasa Indonesia, unit/tanggal, hasil, dan retry terhadap fixture; catat model/version, request count, latency, dan keterbatasan.
- [ ] Tidak mengubah konfigurasi atau data production, tidak mengaktifkan fallback otomatis, dan tidak mengklaim model testing setara `gpt-oss:20b`.
- [ ] Laporkan kegagalan dan blocker tanpa retry massal.

## Comments
