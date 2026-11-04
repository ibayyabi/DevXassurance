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

**Handoff 4 (worktree `../DevXassurance-pmo-health-01`, branch `ticket/pmo-health-01`, baseline `db96485`).**

Larangan menyeluruh “tanggal hanya dari satu sel” dibatalkan. Diganti dengan **linking struktural** dari metadata baris/kolom/header yang dihasilkan parser:

- Parser (`document-parser.ts`) menambahkan metadata terstruktur per sel: `ParsedSourceCell { sheetName, row, column, cell, label, value, rawValue, dateIso }`. Referensi per-sel membawa `cell`, referensi baris membawa `rowCells` (hanya untuk baris yang tidak dipecah karena batas panjang; baris tanpa metadata itu kembali ke aturan excerpt). Parser juga mengekspor `parserMetadata.subjects` (nilai dari baris key-value yang key-nya menyebut subjek, mis. `Subsystem`, hanya dari baris data — bukan header) dan `parserMetadata.sheetTitles` (blok header pertama tiap sheet). Tidak ada nama file atau layout fixture yang di-hardcode.
- Validasi (`document-extraction.ts`) menilai klaim tanggal lewat kolom yang terbukti: baris dengan **tepat satu** kolom cut-off/periode menerima tanggal hanya bila nilainya sama dengan nilai sel kolom itu; kolom due/target/start/mitigation tidak pernah dianggap tanggal laporan; baris dengan **lebih dari satu** kolom cut-off/periode ditolak sebagai ambigu. Sel tunggal pun diperiksa: label sel yang berupa kolom due/target membuat klaim tanggalnya ditolak. Bila metadata tidak ada (payload lama / dokumen non-spreadsheet) aturan excerpt yang berlaku tetap dipertahankan.
- Scope komponen: diterima bila baris yang dikutip punya kolom scope berlabel (activity/work package/task/wbs/component/dll) yang berisi label tersebut, **atau** bila workbook mendeklarasikan tepat satu subjek dan judul sheet yang dikutip menyebut subjek itu. Selain itu tetap gap.
- `PARSER_VERSION` → `document-parser/11`, `EXTRACTION_SCHEMA_VERSION` → `phase6-document-extraction/18`; keduanya bagian group key, jadi baris cache dari versi lama tidak bisa dipakai ulang. `phase6-document-parser.test.mjs` hanya diperbarui pada dua literal versi.

Bukti test (`tests/integration/evidence-provenance.test.mjs`, respons model dibangun hanya dari `SOURCE_REFERENCES_JSON`):
- **Valid W4/W5**: actual per baris diterima dengan `as_of_date` = cut-off baris (2026-10-09 / 2026-10-16), `period_label` W4/W5, `scope_level: "wbs"`, `scope_label: "Alarm Kebencanaan"` (subjek unik workbook + judul sheet), lokasi = referensi baris; milestone dari sel cut-off tetap ada; fact sel literal D7/D8 menyimpan lokasi sel tepat.
- **Due date palsu**: klaim `as_of_date` = nilai kolom Due Date di baris yang sama ditolak walau tanggalnya ada di excerpt (pesan menyebut kolom Cut-off Date dan nilainya); baris yang hanya punya kolom Due Date ditolak dengan pesan kolom due; baris dengan dua kolom cut-off/periode (Report Date + Cut-off Date) ditolak sebagai ambigu; sel tunggal berlabel Due Date ditolak untuk milestone.
- **Negatif lain**: scope yang tidak dideklarasikan/dibuktikan baris ditolak, source ID palsu ditolak, kutipan sel/baris formula ditolak `formula_result_unavailable`, coverage empat domain `unprocessed` (tanpa nol/hijau). Cache: versi parser lama tidak dipakai ulang; cache hit tidak memanggil model dan lokasi diturunkan ulang dari chunk hidup. Cost: periode/cut-off tak bersumber ditolak.

Verifikasi: **tidak menjalankan test/build/lint** (instruksi integrator). Hanya `node --check` pada dua `.mjs` dan transpile sintaks TS pada dua file worker. Integrator wajib menjalankan: `node --test tests/integration/evidence-provenance.test.mjs tests/integration/phase6-document-parser.test.mjs tests/integration/phase6-document-extraction.test.mjs`. Catatan: test extraction/summary memakai chunk sintetis (tanpa `rowCells`/`cell`), jadi perilakunya tidak berubah; hanya `phase6-document-parser.test.mjs` yang membangun XLSX.

Batas yang tersisa:
1. Kosakata label: `cut-off|as-of|report(ing) date|report(ing) period|period|cue` untuk kolom periode dan `due|target|start|finish|planned|actual|baseline|mitigation|submission|delivery|approval` untuk kolom non-periode, plus `subsystem|component|work package|discipline|package|scope|activity|task|wbs` untuk kolom scope. Template dengan istilah lain akan menghasilkan gap (aman), bukan salah terima.
2. Scope subjek dokumen hanya dipakai bila workbook mendeklarasikan tepat satu subjek dan judul sheet mengutipnya; workbook multi-subjek atau tanpa deklarasi tetap gap.
3. `period_label` tidak dilink ke kolomnya (hanya wajib ada di excerpt); relasi periode lintas cut-off tetap tiket 04.
4. `percent` harus dilaporkan sebagai persentase tampilan; `raw_value` pecahan murni tanpa dukungan unit tetap gap.
5. Tidak ada panggilan provider live; kelayakan quoting model nyata tidak dibuktikan, hanya kontrak teks yang diuji.
6. Mapping route→RPC persistensi tidak berubah dan tidak diuji ulang.
7. Worktree memakai symlink `node_modules` (gitignored).
