# 07: Ketahanan job dan status pemrosesan

**What to build:** PMO dapat mengetahui status pemrosesan dokumen dan memulihkan pekerjaan yang terhenti tanpa menimpa hasil atau menghabiskan kuota.

**Blocked by:** 03: Evidence parsial yang aman dan review.

**Status:** ready-for-agent

Baca [rencana](../plan.md). Diagnosis `stale_claim_token` menggunakan job test terisolasi; jangan memutasi job proyek pengguna.

- [ ] Kehilangan claim/lease tidak menimpa hasil attempt baru dan tidak menduplikasi pekerjaan; penyebab serta tindakan yang tersedia terlihat.
- [ ] 429/deferred tidak dilaporkan sebagai evidence absent; checkpoint valid dipakai ulang tanpa retry loop massal.
- [ ] UI membedakan queued, processing, failed, needs_review, dan completed tanpa menyiratkan coverage assurance lengkap.
- [ ] Verifikasi menggunakan simulated lease/clock dan provider fixture; tidak melakukan panggilan cloud.

## Comments
