# 05: Perbandingan risk snapshot lintas waktu

**What to build:** PMO dapat membandingkan risiko antar-cut-off dengan identitas, skala, dan kutipan yang dapat diperiksa.

**Blocked by:** 03: Evidence parsial yang aman dan review. Gunakan kontrak identitas dan periode dari 01.

**Status:** ready-for-agent

Baca [rencana](../plan.md) dan periksa terlebih dahulu tiket/implementasi risk yang sudah ada; jangan membuat pipeline paralel atau menutup tiket lama tanpa otorisasi.

- [ ] Risk W5 Alarm 001 dan 002 tampil dengan periode dan sumber jika berhasil diekstraksi dan memenuhi validasi.
- [ ] New, closed, dan increased hanya ditampilkan bila dua snapshot comparable dan identitas cocok persis atau mapping telah disetujui reviewer.
- [ ] Bukti yang hilang, belum diproses, ID berbeda tanpa mapping, atau skala berbeda tanpa mapping tetap gap; ketiadaan observasi bukan closed.
- [ ] Kasus W6/W7 dibandingkan dengan expected-results hanya bila sumber dan identitas tersedia; tidak menghasilkan skor risiko gabungan.

## Comments

- Persiapan read-only pada baseline: `buildRiskComparison` sudah ada di `src/features/assurance/lib/risk-comparison.ts`, tetapi saat ini menandai risiko yang hilang dari snapshot current sebagai `resolved`; ketiadaan evidence bukan bukti closed. Status closed eksplisit pada sumber juga perlu diperlakukan terpisah.
- Periode observasi belum menjadi syarat pembandingan dan peran `baseline/current` belum membedakan previous snapshot dari approved baseline. Tampilkan gap untuk coverage belum diproses atau snapshot yang tidak sebanding.
- W5 Alarm menyatakan `R-SB01-001` dan `R-SB01-002`; label skala seperti Medium/High tidak otomatis membuktikan peringkat numerik. Ikat kutipan dengan identitas file/versi dan tanggal yang terbukti.
- Periksa kembali keselarasan mapping yang dipakai comparator dengan fingerprint analisis, serta RPC mapping atomic yang sudah ada. Temuan ini berasal dari baseline dan harus diverifikasi lagi setelah tiket 03 terintegrasi.
