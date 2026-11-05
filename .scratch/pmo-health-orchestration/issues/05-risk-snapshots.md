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

- Previous is fetched from the nearest earlier completed review's `current`-role evidence in the same project; an approved baseline is never substituted. Source hashes, parser/contract versions, coverage, and accepted/corrected/rejected decision fingerprints scope the observations.
- Matched risks use their own stated cut-offs and require valid ISO dates in strict previous-before-current order. "New" additionally requires complete prior coverage and one valid cut-off across every linked prior source; duplicate conflicting IDs and ambiguous dates remain gaps.
- Findings retain source excerpts, document/version/location references, source values, reviewer corrections/decisions, accepted project-scoped identity/scale mappings, and the analysis mapping-reference fingerprint. Missing later observations are `not_reported`, never `closed`.
- Deterministic comparator and actual analysis-flow tests cover W5 IDs/citations, W6 source-backed changes, baseline-vs-previous separation, version and decision filtering, and project/mapping scope. W7 is not asserted without a validated source; no composite Risk score is produced.
- Tests were authored but not executed under the ticket's verification constraint; leave status `claimed` for integration-owner verification.
