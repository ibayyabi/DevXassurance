# 05: Perbandingan risk snapshot lintas waktu

**What to build:** PMO dapat membandingkan risiko antar-cut-off dengan identitas, skala, dan kutipan yang dapat diperiksa.

**Blocked by:** 03: Evidence parsial yang aman dan review. Gunakan kontrak identitas dan periode dari 01.

**Status:** claimed

Baca [rencana](../plan.md) dan periksa terlebih dahulu tiket/implementasi risk yang sudah ada; jangan membuat pipeline paralel atau menutup tiket lama tanpa otorisasi.

- [x] Risk W5 Alarm 001 dan 002 tampil dengan periode dan sumber jika berhasil diekstraksi dan memenuhi validasi.
- [x] New, closed, dan increased hanya ditampilkan bila dua snapshot comparable dan identitas cocok persis atau mapping telah disetujui reviewer.
- [x] Bukti yang hilang, belum diproses, ID berbeda tanpa mapping, atau skala berbeda tanpa mapping tetap gap; ketiadaan observasi bukan closed.
- [x] Kasus W6/W7 dibandingkan dengan expected-results hanya bila sumber dan identitas tersedia; tidak menghasilkan skor risiko gabungan.

## Comments

- Previous is selected and returned by `claim_assurance_analysis` from the nearest strictly earlier eligible review's project-scoped `current`-role evidence; the approved baseline is never substituted. The atomic reference fingerprint covers review selection, linked source versions, risk observations, coverage, and matching reviewer decisions; analysis does no post-claim previous-source reads.
- Matched risks use their own stated cut-offs and require valid ISO dates in strict previous-before-current order. "New" additionally requires complete prior coverage and one valid cut-off across every linked prior source; duplicate conflicting IDs and ambiguous dates remain gaps.
- Findings retain source excerpts, document/version/location references, source values, reviewer corrections/decisions, accepted project-scoped identity/scale mappings, and the combined mapping/rule/prior-risk reference fingerprint. Missing later observations are `not_reported`, never `closed`.
- Deterministic comparator and actual analysis-flow tests cover W5 IDs/citations, claim-carried previous-source data, W6 source-backed changes, baseline-vs-previous separation, version and decision filtering, and project/mapping scope. W7 is not asserted without a validated source; no composite Risk score is produced.
- Tests were authored but not executed under the ticket's verification constraint; leave status `claimed` for integration-owner verification.
- Audit integrasi menemukan mapping risk yang hanya muncul pada sumber review sebelumnya dipakai comparator tetapi tidak masuk reference fingerprint. Perubahan mapping tersebut dapat meninggalkan hasil stale; tiket dibuka kembali sampai fencing dan uji regresi perilaku selesai.
- Fencing mapping diperbaiki di `202611050007_claim_scoped_risk_mappings.sql` (satu migrasi maju setelah 006; hanya me-rename lalu membangun ulang wrapper, bukan mengandalkan migrasi lama): claim membawa seluruh mapping identitas/skala yang disetujui pada proyek yang sama dan comparator memakai tepat set tersebut, bukan pembacaan tabel setelah claim. Uji perilaku pgTAP ditambahkan (proyeksi mapping lintas proyek, invalidasi setelah publikasi, perubahan mapping di tengah analisis) dan uji alur analisis memakai payload claim. Konsekuensi: perubahan mapping lain dalam proyek yang sama juga dapat menginvalidasi review. Eksekusi suite dan typecheck diserahkan ke integration owner.
