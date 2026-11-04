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

- Persiapan read-only pada baseline: lease job berlangsung 15 menit, sedangkan timeout workflow n8n dapat mencapai 3 jam. Checkpoint memperpanjang lease, tetapi tahapan panjang tanpa checkpoint berpotensi kehilangan claim; ini bukan bukti penyebab historis job pengguna.
- RPC fencing dan checkpoint sudah ada. Pertahankan token/lease saat recovery; uji kehilangan lease di tengah proses serta 429 dengan provider fixture, tanpa retry massal atau mengubah coverage menjadi absent.
- Detail dokumen masih menggabungkan queued/processing dan belum menampilkan penyebab, backoff, serta tindakan pemulihan berdasarkan status job. Setiap pembacaan diagnostik harus tetap project-scoped dan mengikuti role.
