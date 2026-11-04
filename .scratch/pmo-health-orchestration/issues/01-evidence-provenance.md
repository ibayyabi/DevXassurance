# 01: Evidence provenance dan reproduksi lokal

**What to build:** Evidence literal dari dokumen PMO dapat dibaca dan divalidasi dengan lokasi sumber, konteks scope, unit, dan periode yang dapat ditelusuri, tanpa menebak hasil formula.

**Blocked by:** None (can start immediately).

**Status:** claimed

Baca [rencana dan kontrak bersama](../plan.md), khususnya constraint model dan kuota. Gunakan fixture Smart Building untuk replay deterministik tanpa provider live.

- [ ] Reproduksi alur parser → validasi → hasil/persistensi untuk bukti W4/W5 tanpa panggilan LLM.
- [ ] Nilai literal yang didukung diterima dengan lokasi tepat walaupun sel lain mengandung formula unresolved; hasil formula unresolved tidak dikarang atau dinilai nol.
- [ ] Hubungan lintas sel untuk periode, scope, dan satuan hanya diterima bila struktur sumber membuktikannya; kasus ambigu tetap gap.
- [ ] Source ID palsu, cut-off salah, cache versi lama, dan kutipan tidak didukung tidak lolos; provenance tetap benar saat cache hit dan tersimpan.
- [ ] Bukti verifikasi dan batas yang tersisa dicatat dalam Comments.

## Comments

**Handoff 7 — kontradiksi unlabelled XLSX diperbaiki.**

Laporan handoff 6 menyebut tanggal XLSX tanpa label menjadi gap, tetapi kode untuk **sel tunggal** masih menerima (return null) saat kolom tidak terbukti. Sekarang: untuk sumber `kind: "xlsx"`, tanggal hanya diterima bila kolomnya terbukti — `as_of_date` butuh kolom record (cut-off/periode), `date`/`mitigation_due_date` butuh kolom due/target/plan/baseline/actual; sel tanpa label, sel berlabel tak relevan, baris tanpa metadata sel (baris terpecah / payload lama) menjadi **gap** (ditolak dengan alasan eksplisit), bukan tanggal tervalidasi. Sumber non-spreadsheet tetap memakai aturan excerpt seperti sebelumnya. `EXTRACTION_SCHEMA_VERSION` → `phase6-document-extraction/21`; `PARSER_VERSION` tetap `document-parser/12`.

Test: skenario negatif sel tanpa label ditambahkan pada test metadata baris — klaim `as_of_date` dan klaim tanggal milestone dari sel tanpa label sama-sama ditolak dengan pesan "cannot be attributed to a … column in the cited source", dan assert memastikan tanggal itu tidak muncul pada evidence yang diterima. Assertion lama tidak dilonggarkan.

Koreksi klaim: `scope_provenance` **dipersist** di JSON observation (jsonb) tetapi belum dibaca oleh read model/UI review — wiring review ada di tiket 03. README dan laporan diperbaiki agar tidak menyebutnya sudah dapat ditinjau di UI.

**Handoff 6 — diagnosis dua kegagalan offline pada handoff 5.**

1. `keeps the plan date cell locator` (actual undefined): test menyiapkan milestone dari sel `Baseline Start` sheet **Workplan & Gantt**, tetapi sheet itu tidak punya header terdeteksi — baris 4 (header asli) berada tepat di bawah baris timeline 3 sehingga parser menganggapnya baris data, dan baris data berikutnya dirender dengan prefiks huruf kolom (`F: 2026-09-18`), bukan label `Baseline Start`. Jadi **tidak ada** referensi valid/label yang pernah dibuat parser; produksi tidak salah (sel tanpa label → tanpa atribusi kolom → aturan excerpt tetap berlaku, tidak ada penerimaan keliru). Perbaikan di test: milestone memakai sel Due Date milik baris yang sama (`L7` W4 / `L8` W5 di sheet Weekly Report) yang memang berlabel, dengan label dan tanggal diturunkan dari teks prompt, bukan dari koordinat tetap. Bukti tambahan: assert `milestone.label` = label kolom due.
2. `risk due date ['2026-10-23']` (actual `[]`): baris risk sintetis tidak mengisi `raw_mitigation_due_date`, sedangkan validator mensyaratkan `raw_mitigation_due_date === mitigation_due_date` bila tanggal diisi — sehingga seluruh baris risk dikecualikan. Perbaikan di test: `raw_mitigation_due_date` diisi sama dengan `mitigation_due_date`.
3. Pengerasan produksi saat diagnosis: atribusi untuk **sel tunggal** kini memakai label kolom sel itu sendiri, bukan `dateIso`, sehingga sel tanggal berformat-teks (mis. `L7`/`L8` dan date string di sheet Risk) tetap dinilai dari kolomnya dan tidak bisa menyelundupkan kolom record sebagai tanggal due (atau sebaliknya). `EXTRACTION_SCHEMA_VERSION` → `phase6-document-extraction/20`; `PARSER_VERSION` tetap `document-parser/12` (output parser tidak berubah).

Batas baru yang dicatat: sheet seperti Workplan & Gantt yang header aslinya berada di bawah baris timeline tidak punya label kolom; tanggal/scope di sana menjadi gap (bukan salah terima). Memperbaiki heuristik header itu di luar tiket ini.

**Handoff 5 (worktree `../DevXassurance-pmo-health-01`, branch `ticket/pmo-health-01`, baseline `db96485`).**

Dua bug semantik dari review 992299f diperbaiki.

1. **Satu aturan tanggal tidak boleh dipakai untuk semua field.** Sekarang semantik per field:
   - `as_of_date` (milestone/progress/risk/risk statement/cost) = tanggal laporan baris → hanya kolom cut-off/periode yang sah; kolom due/target/start/mitigation tidak pernah menjadi record date; lebih dari satu kolom cut-off = ambigu dan ditolak.
   - milestone `date` dan `mitigation_due_date` = justru **sah** berasal dari kolom due/target/plan/baseline/actual, sehingga tidak pernah ditolak karena "due"; ditolak hanya bila nilainya terbukti berasal dari kolom record (cut-off/periode) dan tidak ada kolom due yang menyatakan tanggal itu.
   Helper terpisah `asOfDateError` / `dueDateError`; `checkDate(..., "record" | "due")` dipasang sesuai field.
2. **Provenance scope harus tertelusur.** `scope_provenance` (array `{ kind, sheet_name, cell_reference, excerpt }`) kini ikut pada observation untuk setiap scope yang dibuktikan: `cited_row_column` bila kolom scope pada baris yang dikutip, atau `declared_subject` + `sheet_title` (lokasi sel deklarasi dan sel judul sheet) untuk subjek workbook. Field ini tersimpan di jsonb `assurance_observations.observation` lewat jalur persistensi yang ada (tanpa migrasi). `parserMetadata.subjects`/`sheetTitles` sekarang membawa lokasi sel (`valueCell`, `cell`), bukan string tanpa sitasi; kelayakan subjek tetap dihitung dari nilai unik, bukan jumlah entri.

Parser: `PARSER_VERSION` → `document-parser/12` (metadata sel + subjects/sheetTitles berlokasi). Validasi: `EXTRACTION_SCHEMA_VERSION` → `phase6-document-extraction/19`. Keduanya bagian group key.

Bukti test (`tests/integration/evidence-provenance.test.mjs`, respons hanya dari `SOURCE_REFERENCES_JSON`):
- **Valid W4/W5**: actual per baris diterima dengan `as_of_date` 2026-10-09/2026-10-16, `period_label` W4/W5, `scope_level: "wbs"` + `scope_label: "Alarm Kebencanaan"` + `scope_provenance` = [declared_subject(B5/B4), sheet_title(Weekly Report)]; milestone dari sel kolom plan `Baseline Start` (Workplan & Gantt) diterima dengan `date` 2026-09-18 dan lokasi sel tunggal; fact sel literal D7/D8 menyimpan lokasi sel tepat.
- **Due date**: klaim `as_of_date` dari kolom Due Date ditolak walau tanggalnya ada di excerpt; baris ber-`Due Date` saja ditolak sebagai record date; baris `Report Date` + `Cut-off Date` ditolak ambigu.
- **Regresi field due**: milestone dari kolom Due Date (baris maupun sel tunggal) **diterima**; milestone dari cut-off ditolak ("not a due or event date"); `mitigation_due_date` dari kolom Due Date diterima, dari cut-off ditolak.
- Negatif lain: scope tak terbukti, source ID palsu, kutipan formula, coverage `unprocessed`, cache hit/versi lama.

Verifikasi: **tidak menjalankan test/build/lint** (instruksi integrator). Hanya `node --check` pada dua `.mjs` dan transpile sintaks TS pada dua file worker. Integrator wajib menjalankan: `node --test tests/integration/evidence-provenance.test.mjs tests/integration/phase6-document-parser.test.mjs tests/integration/phase6-document-extraction.test.mjs`.

Batas yang tersisa:
1. Kosakata label kolom (record: `cut-off|as-of|report(ing|ed) date|reporting period|period|periode`; due: `due|target|start|finish|milestone|planned|actual|baseline|mitigation|submission|delivery|approval`; scope: `subsystem|component|work package|discipline|package|scope|activity|task|wbs`). Istilah lain → gap (aman), bukan salah terima. Tidak ada nama file atau layout fixture.
2. Scope subjek dokumen hanya bila nilai subjek unik dan judul sheet yang dikutip menyatakannya; selain itu gap.
3. `scope_provenance` dipersist di jsonb observation; read model/UI review belum membacanya (tiket 03).
4. `period_label` tetap hanya diuji keberadaannya di excerpt (bukan link kolom); relasi periode lintas cut-off tiket 04.
5. `percent` harus persentase tampilan; `raw_value` pecahan murni tetap gap.
6. Tidak ada panggilan provider live.
7. Mapping route→RPC persistensi tidak berubah dan tidak diuji ulang.
8. Worktree memakai symlink `node_modules` (gitignored).
