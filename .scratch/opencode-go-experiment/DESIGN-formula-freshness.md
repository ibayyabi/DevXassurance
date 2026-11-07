# Draf desain: konfirmasi freshness formula (untuk review, belum spesifikasi)

**Masalah.** Workbook nyata penuh formula (RAG status, Duration, Weighted Progress, Variance). Nilai cache formula tidak dapat menopang klaim status kini tanpa bukti kesegaran — kontrak saat ini menahannya sebagai `formula_cache_review_required` (kandidat review) atau `formula_result_unavailable`. Akibatnya kolom-kolom besar di dokumen asli menjadi gap permanen, padahal nilai cachennya ada.

**Prinsip yang dipertahankan.** Fail-closed: tanpa konfirmasi, nilai tetap gap/kandidat-review — tidak pernah dianggap mutakhir. Setiap keputusan tersimpan dengan provenance (siapa, kapan, hash nilai cache yang dikonfirmasi). Tidak ada inferensi otomatis kesegaran.

## Alur yang diusulkan (meniru pola persetujuan baseline ADR)

1. **Parser** menerbitkan setiap sel formula dengan: teks formula, nilai cache, status cache, dan **fingerprint input** — hash dari sel yang dirujuk formula tersebut beserta nilainya saat ekstraksi.
2. **Tinjauan reviewer** memperlihatkan: formula, hasil cache, sel input, dan tiga tindakan:
   - **Rekalkulasi & unggah ulang** — workbook dibuka, direkalkulasi, diunggah lagi; ekstraksi baru menghasilkan nilai segar dan fingerprint baru (jalur paling bersih).
   - **Attestation** — reviewer menyatakan "hasil cache ini masih sesuai kondisi workbook saat ini" (mis. setelah memeriksa manual). Tersimpan sebagai keputusan reviewer dengan provenance; nilai kemudian dapat menopang klaim status **dengan atribusi "reviewer-confirmed freshness"**.
   - **Tandai usang** — nilai dinyatakan tidak valid; tetap gap.
3. **Invalidasi**: bila ekstraksi berikutnya menghasilkan fingerprint input yang berubah (nilai sel input berubah), attestation otomatis kedaluwarsa → kembali ke review-required. Dokumen baru dengan konten sama mewarisi attestation selama fingerprint cocok.

## Keputusan terbuka

- Granularitas attestation: per sel, per kolom, atau per sheet?
- Kebijakan kedaluwarsa waktu (selain invalidasi fingerprint)?
- Apakah rekalkulasi + unggah ulang otomatis menghapus marker tanpa attestation eksplisit (usulan: ya, karena nilainya baru diekstrak)?
- UI lokasi (menempel pada detail assurance atau daftar tersendiri)?

## Dampak

Menutup gap status/hitungan terbesar pada workbook asli (RAG, Variance, Weighted Progress) tanpa mengorbankan fail-closed — dengan jejak audit lengkap. Implementasi butuh tiket: tabel keputusan attestation, UI, dan wiring invalidasi (terkait mekanisme versi snapshot di rencana overview).
