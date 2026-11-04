# 03: Evidence parsial yang aman dan review

**What to build:** PMO dapat meninjau dan menggunakan observasi yang jelas dari dokumen `needs_review`, sambil melihat gap dan warning untuk bagian yang belum dapat diproses.

**Blocked by:** 01: Evidence provenance dan reproduksi lokal.

**Status:** ready-for-agent

Baca [rencana dan kontrak bersama](../plan.md), termasuk baseline, source version, coverage, permission dan larangan memanggil provider live.

- [ ] Observasi valid dari dokumen campuran dapat ditampilkan dengan kutipan dan lokasi sumber; formula unavailable dan bagian ambigu tetap gap spesifik.
- [ ] Satu observasi valid tidak menjadikan coverage seluruh domain lengkap; `unprocessed` tidak berubah menjadi `absent`, nol, atau hijau.
- [ ] Dokumen `needs_review` dengan coverage versi terkini dapat dipilih jika aturan akses terpenuhi; warning tetap terlihat.
- [ ] Reviewer dapat menerima, mengoreksi, atau menolak evidence yang didukung; nilai asli, alasan koreksi, atribusi, dan provenance tetap tersimpan.
- [ ] Tidak ada penerimaan massal otomatis atau promosi status yang menyembunyikan warning; verifikasi antarmuka, role, dan source version pada lingkungan test terisolasi.

## Comments

- Persiapan read-only terhadap baseline: `extracted_facts` dan `assurance_observations` adalah dua jalur berbeda; review fakta yang ada tidak otomatis mengoreksi observasi assurance. Pertahankan nilai observasi asli, versi sumber, provenance, alasan dan atribusi reviewer.
- UI membatasi dokumen `needs_review` pada coverage versi terkini; `save_assurance_evidence` pada baseline belum menerapkan syarat coverage yang sama di RPC. Periksa dan tegakkan invariant pada boundary server, bukan hanya UI.
- Gunakan pola keputusan assurance yang sudah ada sebagai rujukan, termasuk otorisasi, invalidasi hasil/fingerprint, dan konflik versi. Evaluasi ulang setelah kontrak tiket 01 terintegrasi; `scope_provenance` harus bisa diperiksa reviewer.
