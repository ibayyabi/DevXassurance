# Laporan WBS `% complete` dan milestone — offline

> Klarifikasi verifikasi: skor provenance pada `score-wbs-offline.mjs` memeriksa format source ID dan keberadaannya di output, bukan mencocokkan ulang setiap ID dengan sel workbook secara independen. Untuk 216 baris demoted, hasil `resolved` adalah hasil eksperimen berbasis row-level, **bukan** bukti provenance per-cell yang cukup untuk produksi. Jika sel/label individual wajib dibuktikan, baris ini masih memerlukan review.

## Ringkasan

- Ekstraksi deterministik WBS `% Complete` dan `next_milestone` dari **48 workbook** `demo-evidence-fixtures/smart-building-itb` (W4–W7, 12 komponen per sesi) berjalan **offline penuh**: tidak ada request provider, tidak ada pembacaan `.env*`/API key/auth store, tidak ada pemanggilan model, tidak ada pembacaan ground truth oleh runner.
- Hasil: **408/408 nilai WBS** cocok dalam toleransi `0.00005` fraksi dan **408/408** memiliki source ID parser yang tervalidasi; **48/48** composite `next_milestone` cocok (kode, label, tanggal, dan teks), dengan **0 review**, **0 unknown**, **0 false-accept**.
- Skor development (W7 SB02 + SB07): **16/16** WBS, **2/2** milestone. Holdout (W7 SB01 + SB08): **18/18** WBS, **2/2** milestone.
- Parser produksi tidak diubah: `document-parser/18`. Dua bentuk parser teramati: **24 komponen / 216 baris** demoted ke teks baris (tanpa sel terstruktur per-cell), dan **24 komponen / 192 baris** menyimpan `rowCells` + source ID per-cell.
- **Caveat terpenting:** `next_milestone` di `expected-results.json` **bukan nilai literal sel**. Generator fixture menurunkannya dari kode WBS (A), Deliverable (D), Baseline Finish (G), dan `% Complete` (J) dengan aturan yang saya audit di `generator/generate_fixtures.py:143-150`. Karena expected dan workbook dibuat oleh generator yang sama, skor **48/48 adalah konsistensi internal, bukan benchmark independen**. Array expected WBS juga tidak memuat kode WBS; pencocokan hanya berdasarkan urutan baris.
- Uji negatif sintetis: **21/21 lulus**. Baseline lama `verify-v3.mjs`: **50/50 lulus**. Tidak ada perubahan source produksi, fixture asli, output eksperimen sebelumnya, atau git state terlacak.

## Batas dan kepatuhan

- Semua uji aplikasi offline. Runner hanya membaca file workbook yang diberikan dan menulis JSON ke `.local-evaluation/opencode-go-exp-wbs/` (git-ignored). Runner **tidak** membaca `expected-results.json`; skoring ada di script terpisah.
- Tidak menjalankan `baseline-v2.mjs`, `run.mjs`, atau `main()` dari `evidence-v2.mjs`. Runner mengimpor dua fungsi murni (`buildEvidenceIndex`, `deterministicExtract`) dari `evidence-v2.mjs`; guard `import.meta.url` memastikan `main()` tidak dieksekusi.
- Tidak ada install dependency, commit, atau perintah destruktif. Tidak ada perubahan pada `worker/`, `src/`, fixture, atau laporan v2/v3 sebelumnya.
- `git status` tetap seperti snapshot awal (`M .gitignore`, `M AGENTS.md`, `M README.md`, untracked `.agents/skills/graphify/`, `.codex/`, `.scratch/opencode-go-experiment/`, `graphify-out/`). File baru berada di `.scratch/opencode-go-experiment/` (untracked) dan `.local-evaluation/` (git-ignored).
- `graphify query` dijalankan sebelum membaca source parser; `graphify update .` dijalankan setelah perubahan kode: 3660 nodes, 8688 edges, 150 communities. Hanya `graphify-out/` yang berubah.

## Dataset, split, dan dua template

- Dataset: `demo-evidence-fixtures/smart-building-itb/sessions/2026-10-09_w4`, `2026-10-16_w5`, `2026-10-23_w6`, `2026-10-30_w7`; 12 workbook per sesi.
- Development (dipilih sebelum aturan final): W7 `SB02` (`02_Kamera...`) dan `SB07` (`05_Pencahayaan...`).
- Holdout: W7 `SB01` (`01_Alarm...`) dan `SB08` (`07_Air_Bersih...`).
- Seluruh 48 workbook dijalankan setelah aturan final; skor dev dan holdout dilaporkan terpisah.
- Split bukan uji buta penuh: struktur holdout juga saya probe saat observasi awal, dan aturan `next_milestone` saya audit dari generator. Ini dinyatakan sebagai keterbatasan, bukan diklaim sebagai holdout independen.

Dua template parser yang teramati:

| Template | Komponen | Baris WBS | Provenance |
|---|---:|---:|---|
| `demoted_row_text` (Workplan A:AF, kolom Gantt mingguan) | 24 | 216 | row-level source ID; `cell_source_id: null` |
| `structured_row_cells` (Workplan A:P, `rowCells` dipertahankan) | 24 | 192 | source ID per-cell (A/J/D/G/I/O) |

Template pertama memicu guardrail parser karena teks baris melebihi `MAX_SOURCE_BLOCK_PART_LENGTH`; parser mempertahankan referensi baris dan `formulaCells`, tetapi membuang referensi per-cell. Runner **tidak mengarang** source ID per-cell: untuk 216 baris tersebut provenance tercatat `row_text`, dengan source ID baris nyata dan source ID sel header (J4/D4/G4) tempat label berasal.

## Metode

1. **Parser produksi unmodified.** `parseDocumentBuffer` di `document-parser.ts` ditranspilasi ke modul sementara dengan cara yang sama seperti runner eksperimen lain; source tidak ditulis.
2. **Deteksi header Workplan & Gantt.** Header dikenali dari sel A bernilai `WBS`; label kolom dibangun dari sel header (template demoted) atau dari `label` pada `rowCells` (template structured). Kolom kunci: A=kode, D=Deliverable, G=Baseline Finish, I=Weight, J=`% Complete`, O=Milestone.
3. **Baris WBS.** Unit baris dikelompokkan dari `sourceLocation.rowStart-rowEnd`, lalu bagian teks yang terpotong antar-chunk disatukan kembali dengan satu spasi (split parser memotong di spasi dan melakukan trim, sehingga satu spasi hilang). Baris dianggap WBS bila kode A cocok `^\d+(\.\d+)*$`. Kode duplikat → `review`, bukan dipilih diam-diam.
4. **Nilai `% Complete`.**
   - Structured: `rowCells.J.rawValue` (exact) + `cell_source_id` per-cell.
   - Demoted: wording `J: 82.5%` dari teks baris (parser menulis hingga 12 significant digits), lalu anotasi `[raw value: ...]` di-align ke token ber-anotasi. Semua **408/408** baris berhasil di-align (`annotation_alignment: aligned`). Exactness: 216 `row_text_annotation`, 192 `raw_value`.
   - Nilai kosong/absen/missing/error tidak diubah menjadi 0. Nilai di luar 0–1 → `review`.
5. **Cross-check formula.** Formula `K` yang dikenali (`IF(J<row>="",0,I<row>*J<row>)`) dicek terhadap cache dan `I*J`. Semua **408/408** match. Formula yang berubah/bentuk lain → `unrecognized_formula` (cache tidak dipakai); cache kosong/missing/error → `cache_not_numeric` (bukan 0); cache bertentangan → `review`. Tidak ada evaluasi Excel umum dan tidak ada klaim freshness cache.
6. **Milestone turunan.** `next_milestone` dihitung dari baris berlabel (D) dan tanggal valid (G): baris pertama dengan `% Complete < 1` dan `Baseline Finish >= cut-off`; jika tidak ada, baris pertama dengan `Baseline Finish >= cut-off`; jika tidak ada, `unknown`. Cut-off diambil dari deklarasi `Reporting Cut-off` (PM Summary) atau baris progress yang cocok. Composite = `<kode> <deliverable> - <dd-MMM-yyyy>`. Semua milestone ditandai `derived: true` dengan input dan source ID; tidak dipresentasikan sebagai klaim literal.
7. **Tanggal.** `date_raw` dan `date_normalized` dipisah. Template demoted menyimpan serial Excel mentah (mis. `46332`); template structured menyimpan teks ISO (mis. `2026-11-06`). Satu kasus SB12 menyimpan `2026-09-25 0:00:00`; bagian tanggalnya dinormalisasi ke `2026-09-25` dan tanggal mentah tetap dicatat.
8. **Guard fallback.** `applyClaimGuard` tidak mengizinkan klaim fallback mengubah `review` menjadi `found`, atau mengganti nilai sumber tanpa source ID yang valid. Runner tidak memakai fallback model; guard diuji sintetis.

## Perintah yang dijalankan

```sh
node --check .scratch/opencode-go-experiment/wbs-milestone-offline.mjs
node --check .scratch/opencode-go-experiment/score-wbs-offline.mjs
node --check .scratch/opencode-go-experiment/verify-wbs-offline.mjs

node .scratch/opencode-go-experiment/verify-wbs-offline.mjs
node .scratch/opencode-go-experiment/verify-v3.mjs

for s in 2026-10-09_w4 2026-10-16_w5 2026-10-23_w6 2026-10-30_w7; do
  node .scratch/opencode-go-experiment/wbs-milestone-offline.mjs \
    --out .local-evaluation/opencode-go-exp-wbs/all-48/$s --session $s \
    demo-evidence-fixtures/smart-building-itb/sessions/$s/*.xlsx
done

node .scratch/opencode-go-experiment/score-wbs-offline.mjs \
  --root .local-evaluation/opencode-go-exp-wbs/all-48 \
  --out .local-evaluation/opencode-go-exp-wbs

graphify update .
```

Semua exit 0. 48 file diproses, 0 request jaringan, 0 kegagalan parse. `verify-wbs-offline.mjs`: 21/21. `verify-v3.mjs`: 50/50. `graphify update .`: 3660 nodes, 8688 edges, 150 communities.

## Hasil

### Development dan holdout

| Kelompok | Komponen | WBS cocok | WBS provenance | Milestone cocok | Review/unknown/false-accept |
|---|---:|---:|---:|---:|---:|
| Development (W7 SB02, SB07) | 2 | 16/16 | 16/16 | 2/2 | 0/0/0 |
| Holdout (W7 SB01, SB08) | 2 | 18/18 | 18/18 | 2/2 | 0/0/0 |
| **Semua 48** | **48** | **408/408** | **408/408** | **48/48** | **0/0/0** |

### Per template

| Template | Komponen | Baris | WBS cocok | Provenance | Milestone |
|---|---:|---:|---:|---:|---:|
| `demoted_row_text` | 24 | 216 | 216/216 | row-level (216) | 24/24 |
| `structured_row_cells` | 24 | 192 | 192/192 | per-cell (192) | 24/24 |

### Per sesi

| Sesi | Komponen | WBS cocok | Milestone cocok |
|---|---:|---:|---:|
| 2026-10-09_w4 | 12 | 102/102 | 12/12 |
| 2026-10-16_w5 | 12 | 102/102 | 12/12 |
| 2026-10-23_w6 | 12 | 102/102 | 12/12 |
| 2026-10-30_w7 | 12 | 102/102 | 12/12 |

Tidak ada field failure pada run final. Parser menghasilkan 30–264 warning per file (diagnostik ambiguitas tabel); warning tidak disembunyikan, tetapi juga tidak dipakai untuk mengubah hasil row/column yang sudah deterministik.

## Audit provenance dan ground truth

- **`next_milestone` adalah nilai turunan.** `generator/generate_fixtures.py:143-150`:
  `f"{code} {deliverable} - {finish:%d-%b-%Y}"`, memilih baris pertama dengan `j < 1 and finish >= cutoff`, lalu fallback baris pertama dengan `finish >= cutoff`, lalu `"Handover"`. Expected memakai Deliverable (D), Baseline Finish (G), kode (A), dan nilai J. Runner menurunkan nilai yang sama dari kolom sumber, bukan dari expected. Karena generator yang sama membuat workbook dan expected, **48/48 bukan uji independen**.
- **Array WBS tidak memuat kode.** `expected-results.json` hanya memberi array angka. Pencocokan dilakukan per indeks setelah runner memverifikasi urutan baris. Semua 48 komponen memiliki jumlah baris yang sama dengan expected dan baris naik ketat; **408/408** indeks `array_order_ok`. Namun identitas WBS tidak dapat dibuktikan independen dari array itu sendiri; ini adalah asumsi urutan, bukan bukti identitas.
- **Provenance per-cell hanya untuk template structured.** 192 baris punya source ID per-cell (`cell_source_id`). 216 baris demoted hanya punya source ID baris + source ID header; `cell_source_id` sengaja `null`. Skor "408/408 provenance" berarti **row-level provenance yang valid**, bukan 408 sitasi per-cell.
- **Tidak ada review/unknown di dataset nyata.** Semua 408 baris dan 48 milestone berstatus `resolved`. Perilaku fail-closed (0 vs kosong, duplikat, cross-sheet, tanggal invalid/konflik, cache kosong/berubah/bertentangan, fallback) hanya dibuktikan oleh **uji sintetis**, bukan oleh variasi fixture nyata.
- **Freshness cache tidak dibuktikan.** Yang dibuktikan hanya bentuk formula `I*J`, kecocokan cache dengan input, dan konsistensi nilai. Tidak ada rekalkulasi Excel dan tidak ada klaim cache mutakhir.
- **Fixture pack bukan real-world test independen.** 48 workbook berasal dari generator fixture yang sama; hasil terikat `document-parser/18` dan struktur template ini.

## Uji negatif terarah

`verify-wbs-offline.mjs`: **21/21 lulus**, tanpa workbook dan tanpa jaringan. Cakupan outcome yang terlihat:

- baris valid → `resolved` 0.42, source ID per-cell, cross-check `match`; composite milestone benar;
- `0%` valid → 0; sel `% Complete` kosong → `review` (bukan 0), walau cache K = 0;
- kode WBS duplikat → kedua baris `review`;
- baris dari sheet lain tidak masuk;
- kode/percent tertukar (`A=0.5`, `J=1.1`) → `review` karena di luar 0–1;
- tanggal milestone invalid → `review`; label milestone absen → `unknown`; tanggal konflik → `review` dan tidak dipilih;
- cache K kosong → `cache_not_numeric`, nilai `null`; formula K berubah → `unrecognized_formula`, nilai `null`; cache K bertentangan → `mismatch` dan percent jadi `review`;
- fallback tidak dapat menaikkan `review` → `found`, tidak dapat mengganti nilai sumber, dan klaim tanpa source ID ditolak;
- token cleaning mempertahankan `(delivery note)` tetapi membuang tag formula/cache; parser persen menangani `82.5%` dan `76.11%`;
- tanpa cut-off → `review`, bukan menebak.

Baseline lama `verify-v3.mjs` juga dijalankan: **50/50 lulus**.

## Artefak dan reproduksibilitas

- Runner: `.scratch/opencode-go-experiment/wbs-milestone-offline.mjs`
- Skorer: `.scratch/opencode-go-experiment/score-wbs-offline.mjs`
- Uji negatif: `.scratch/opencode-go-experiment/verify-wbs-offline.mjs`
- Output: `.local-evaluation/opencode-go-exp-wbs/all-48/<sesi>/WBS-<file>.json` (48 file) + `summary.json` per sesi
- Skor: `.local-evaluation/opencode-go-exp-wbs/score-wbs.json` dan `score-wbs.md`
- Smoke dev: `.local-evaluation/opencode-go-exp-wbs/dev-smoke/` (hanya 2 komponen; skor smoke mencatat 46 komponen lain sebagai `missing artifacts`, bukan kegagalan ekstraksi)
- Setiap artefak memuat: `workbook.sha256`, `generated_at`, `parse.parser_version`, `recording_period.cutoff`, `template`, baris WBS dengan `percent`/`milestone`/`source_ids`, `next_milestone` derived, `failures`, dan penanda `ground_truth_read: false`, `network_used: false`.
- 48 SHA-256 unik; rentang `generated_at` 2026-11-06T13:46:20Z–13:46:23Z. `expected-results.json` sha256: `2506bcc517319c263a88be8e2f31102ae920c1934e0108d3599741bf3e3dec5c`.
- Parser version: `document-parser/18` untuk 48/48 file. Cut-off: 12 file per `2026-10-09`, `2026-10-16`, `2026-10-23`, `2026-10-30`.

## Yang tidak dinilai / blocker

Blocker terhadap klaim produksi (bukan blocker eksekusi):

1. **Tidak ada ground truth independen.** Expected dibuat oleh generator yang sama; skor 408/408 dan 48/48 mengukur konsistensi, bukan akurasi terhadap dokumen dunia nyata.
2. **Identitas WBS tidak independen.** Array expected tidak memuat kode; pencocokan berbasis urutan. Tidak ada bukti bahwa kode/row yang sama tanpa asumsi urutan.
3. **Provenance per-cell tidak tersedia untuk 216/408 baris.** Template demoted hanya memberi provenance row-level. Jika kebijakan produksi mensyaratkan sitasi per-cell, baris tersebut harus `review`, bukan `found`.
4. **Tidak ada uji LLM live.** Eksperimen ini deterministik; tidak mengukur ekstraksi model/provider. CommandCode inference terpisah dan tidak dipakai oleh tes aplikasi.
5. **Review/unknown tidak muncul di data nyata.** Fail-closed hanya dibuktikan sintetis; fixture tidak memvariasikan kasus negatif.
6. **Milestone bukan klaim literal.** `next_milestone` adalah turunan A+D+G+J; holdout tidak buta karena audit generator.
7. **Freshness cache dan formula umum tidak divalidasi.** Hanya bentuk `I*J` yang dikenali; tidak ada rekalkulasi Excel.
8. **Cakupan terbatas.** Hanya WBS `% complete` dan milestone; rollup project, `overall_weighted_progress`, forecast, Issue vs Risk, MoM, baseline workbook, dan perbandingan antar-sesi tidak dinilai.

## Keputusan

Eksperimen **aman dilanjutkan** sebagai harness deterministik offline untuk WBS dan milestone pada fixture ini: parser produksi dipakai tanpa perubahan, provenance dilacak sampai source ID nyata, nilai kosong/konflik tidak diubah menjadi nol/found, dan semua langkah dapat direproduksi tanpa jaringan. Namun **belum siap produksi**: provenance per-cell hilang untuk separuh baris (template demoted), ground truth tidak independen, identitas WBS hanya berbasis urutan, dan perilaku fail-closed belum teruji pada data nyata. Langkah berikutnya yang masuk akal: (a) dapatkan source ID per-cell untuk baris demoted atau ubah guardrail parser, (b) siapkan ground truth independen/blind holdout, (c) perluas uji negatif ke dokumen nyata, dan (d) jika ekstraksi model ingin diukur, jalankan uji live terpisah dengan persetujuan kuota/provider.
