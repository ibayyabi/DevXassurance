# 03: Evidence parsial yang aman dan review

**What to build:** PMO dapat meninjau dan menggunakan observasi yang jelas dari dokumen `needs_review`, sambil melihat gap dan warning untuk bagian yang belum dapat diproses.

**Blocked by:** 01: Evidence provenance dan reproduksi lokal.

**Status:** resolved

Baca [rencana dan kontrak bersama](../plan.md), termasuk baseline, source version, coverage, permission dan larangan memanggil provider live.

- [x] Observasi valid dari dokumen campuran dapat ditampilkan dengan kutipan dan lokasi sumber; formula unavailable dan bagian ambigu tetap gap spesifik.
- [x] Satu observasi valid tidak menjadikan coverage seluruh domain lengkap; `unprocessed` tidak berubah menjadi `absent`, nol, atau hijau.
- [x] Dokumen `needs_review` dengan coverage versi terkini dapat dipilih jika aturan akses terpenuhi; warning tetap terlihat.
- [x] Reviewer dapat menerima, mengoreksi, atau menolak evidence yang didukung; nilai asli, alasan koreksi, atribusi, dan provenance tetap tersimpan.
- [x] Tidak ada penerimaan massal otomatis atau promosi status yang menyembunyikan warning; verifikasi antarmuka, role, dan source version pada lingkungan test terisolasi.

## Comments

- Persiapan read-only terhadap baseline: `extracted_facts` dan `assurance_observations` adalah dua jalur berbeda; review fakta yang ada tidak otomatis mengoreksi observasi assurance. Pertahankan nilai observasi asli, versi sumber, provenance, alasan dan atribusi reviewer.
- UI membatasi dokumen `needs_review` pada coverage versi terkini; `save_assurance_evidence` pada baseline belum menerapkan syarat coverage yang sama di RPC. Periksa dan tegakkan invariant pada boundary server, bukan hanya UI.
- Gunakan pola keputusan assurance yang sudah ada sebagai rujukan, termasuk otorisasi, invalidasi hasil/fingerprint, dan konflik versi. Evaluasi ulang setelah kontrak tiket 01 terintegrasi; `scope_provenance` harus bisa diperiksa reviewer.
- `processDocumentJob` membatasi `processing_error` dokumen hingga 1.000 karakter; banyak warning dapat memotong alasan domain berikutnya. Jangan jadikan string itu satu-satunya sumber penjelasan gap per domain; pastikan alasan yang relevan tetap terlihat.

- Tiket 01 terintegrasi dan diverifikasi secara deterministik; gunakan kontrak sumber, coverage, dan `scope_provenance` yang sekarang ada. Reviewer tetap harus melihat warning dan mengambil keputusan per observasi.

- Kandidat `b00a93d`, dokumentasi dipindahkan pada `bbe8a9e`: suite deterministik review, parser, extraction, provenance dan budget lulus; `tsc --noEmit` lulus. Seluruh migrasi sampai `202611050001` diterapkan pada stack Supabase baru terisolasi; 45/45 pemeriksaan pgTAP review/akses/fingerprint lulus. Tidak ada panggilan provider LLM atau perubahan hosted.
- Browser lokal: unggah W4, replay worker dengan respons terkendali, dan buka dokumen `needs_review` tanpa baseline yang ditautkan. Coverage belum lengkap, scope serta tiga lokasi sumber terlihat; koreksi uji 12,6% disimpan dengan reviewer sementara nilai sumber 12,5% tetap tersimpan. Ini bukan uji kualitas model production atau E2E penuh.
- Screenshot browser tidak berhasil karena tool timeout; verifikasi permukaan dilakukan melalui DOM dan interaksi browser. Formula cache dan reason domain tetap perlu interpretasi reviewer.
