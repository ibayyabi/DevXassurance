# Laporan v3 — validator risiko dan formula/cache

## Ringkasan

- Validator eksperimen diperbaiki: sitasi Status/Priority yang sah pada baris risiko yang sama tidak lagi ditolak, ID/status/priority yang tidak didukung tidak diterima sebagai `found`, dan cache formula tidak lagi diterima tanpa verifikasi bentuk/input.
- Verifikasi independen menemukan celah lanjutan: `progressRowFrom` menerima cache RAG `Red` untuk varians terverifikasi `0.014`, padahal rumus `IF(D10="","",IF(E10<-0.1,"Red",IF(E10<-0.05,"Amber","Green")))` menghasilkan `Green`. Sekarang cache RAG baru diterima bila nilainya setuju dengan ambang yang dihitung ulang dari varians terverifikasi; ketidaksesuaian atau ketidakmampuan hitung ulang menjadi `review`, bukan `found`.
- `resolveFields` varian C juga dikunci: field formula/cache yang berstatus review tidak dapat diubah menjadi `found` oleh fallback model. Percobaan model tetap dicatat di `model_fallback` untuk diagnosis, tetapi status akhir tetap `review` dan `review_required: true`.
- Variant C, 48 workbook W4–W7 × 6 field (recheck terpisah): **284/288 nilai cocok**, **284/288 provenance valid**, **284/288 nilai + provenance**, **0 field review**. Empat `unknown` adalah log risiko kosong di W4 yang kelengkapan tabelnya tidak dapat dibuktikan.
- Replay B pada 4 rekaman W7 tanpa request API: **22/24 nilai cocok**, **24/24 provenance valid**, **22/24 nilai + provenance**. Delapan field risiko yang di v2 `candidate_mismatch` sekarang `found`; dua ID risiko yang memang dilewatkan model tetap terlewat.
- Tidak ada request API baru pada v3. Hasil v2 dan hasil v3 lama tidak diubah; recheck baru berada di direktori terpisah.

## Konteks dan batas

Eksperimen terisolasi; bukan perubahan produksi. Harness: `.scratch/opencode-go-experiment/evidence-v2.mjs` (validator v3, guard formula/cache, dan mode replay). Parser produksi tidak diubah: `document-parser/18`. Dataset: `demo-evidence-fixtures/smart-building-itb` (48 workbook W4–W7; empat W7 dipakai untuk replay B). Model benchmark yang diminta: `deepseek-v4.1-flash` melalui OpenCode Go; tidak dipanggil di v3. Model eksekusi yang diminta pengguna: CommandCode `deepseek/deepseek-v4.1-flash`.

Hasil v2 tetap utuh: sha256 empat `B-*.json` identik sebelum/sesudah (`1958bc77…`, `985f356b…`, `284e06b5…`, `4abd8d7d…`), mtimes 11:30–11:32 lokal. Hasil v3 lama di `.local-evaluation/opencode-go-exp-v3/` juga tidak ditimpa; recheck ditulis ke `.local-evaluation/opencode-go-exp-v3-recheck/`. SHA-256 135 file di kedua direktori lama dibandingkan sebelum/sesudah recheck: identik. Tidak ada `.env*` yang dibaca atau diubah; tidak ada kunci yang dicetak atau disimpan di hasil.

## Temuan verifikasi independen

Verifikasi independen menunjukkan `progressRowFrom` menerima cache RAG `Red` pada baris dengan varians terverifikasi `0.014`; rumus RAG yang sama (`IF(D10="","",IF(E10<-0.1,"Red",IF(E10<-0.05,"Amber","Green")))`) menghasilkan `Green`. Validator lama hanya memeriksa bentuk rumus dan dependensi variance, tidak membandingkan nilai cache dengan hasil ambang. Perbaikan yang diterapkan:

- `ragFormulaRule`/`ragFromVariance` menghitung ulang ambang dari nilai variance terverifikasi.
- Cache RAG yang bertentangan atau tidak dapat dihitung ulang ditolak menjadi `review`/`review_required` dengan nilai `null`.
- Metadata formula RAG menyimpan `recomputed_from_dependency`.
- `resolveFields` varian C mempertahankan review; fallback model tidak dapat mengubahnya menjadi `found` dan jawaban yang ditolak dicatat di `model_fallback`.
- Uji regresi baru mencakup kasus `Red` vs varians `0.014` → `Green`, cache `Red`/`Amber` yang setuju, serta fallback model pada review RAG dan variance.

## Perubahan yang diimplementasikan

1. **Validasi risiko terikat baris.** ID, Status, dan Priority dibaca dari baris terindeks yang sama. Sel Status/Priority yang sah tidak lagi ditolak hanya karena bukan ID. ID tak dikenal → `invalid_citation`; ID klaim tanpa sitasi ID, sel lintas baris, status/priority bertentangan, atau status hilang/tidak jelas → `candidate_mismatch`/`ambiguous`, bukan `found`.
2. **Kelengkapan risiko.** Tidak ada baris risiko → `unknown`, bukan `[]`. Baris risiko tanpa status jelas → `ambiguous`. Tidak ada risiko open tetapi kelengkapan log tidak terbukti → `unknown`.
3. **Provenance risiko.** `open_risk_ids` dan `risk_entries` pada jalur deterministik membawa `evidence` per baris: source ID, status, dan priority yang mendukung klaim.
4. **Formula/cache fail-closed.** Teks formula dan status cache dipertahankan di evidence index. Cache variance diterima hanya bila formula cocok dengan bentuk `IF(<actual>="","",<actual>-<planned>)` dan nilai cache setuju dengan input. Cache RAG diterima hanya bila bentuk ambang dikenali, dependensi variance adalah nilai cache/literal yang terverifikasi, **dan nilai cache RAG setuju dengan ambang yang dihitung ulang dari varians tersebut**. Cache RAG yang bertentangan atau tidak dapat dihitung ulang ditolak menjadi `review`. Cache kosong/missing/error bukan nol. Variance kosong dengan input tersedia → `derived_domain` (rule + input), bukan hasil formula Excel. RAG tidak pernah diturunkan.
5. **Output eksplisit.** Nilai dibedakan sebagai `cell_value`, `cached_formula`, `derived_domain`, `formula_cache_unverified`, dengan `review_required`, `formula`, dan `derived_domain` terpisah. Metadata formula RAG menyimpan `recomputed_from_dependency`.
6. **Guard review varian C.** Field yang ditandai review oleh deterministik tidak dapat diubah menjadi `found` oleh fallback model; hasil akhir tetap `review`/`review_required: true`, dan jawaban model yang ditolak disimpan di `model_fallback`.
7. **Replay aman.** `--replay DIR` memvalidasi ulang `model_output.parsed` yang tersimpan, tidak memanggil API, dan tidak menulis ke direktori sumber.
8. **Uji regresi deterministik.** `verify-v3.mjs` menjalankan 25 pemeriksaan sintetis tanpa workbook dan tanpa jaringan.

## Perintah yang dijalankan

```sh
node --check .scratch/opencode-go-experiment/evidence-v2.mjs
node .scratch/opencode-go-experiment/verify-v3.mjs

for s in 2026-10-09_w4 2026-10-16_w5 2026-10-23_w6 2026-10-30_w7; do
  node .scratch/opencode-go-experiment/evidence-v2.mjs --variant C --dry-run \
    --out .local-evaluation/opencode-go-exp-v3-recheck/$s \
    demo-evidence-fixtures/smart-building-itb/sessions/$s/*.xlsx
done

node .scratch/opencode-go-experiment/evidence-v2.mjs \
  --replay .local-evaluation/opencode-go-exp-v2 \
  --out .local-evaluation/opencode-go-exp-v3-recheck --session replay-v3

V3_ROOT=.local-evaluation/opencode-go-exp-v3-recheck node .scratch/opencode-go-experiment/score-v3.mjs
REPLAY_ROOT=.local-evaluation/opencode-go-exp-v3-recheck/replay-v3 node .scratch/opencode-go-experiment/score-b-replay-v3.mjs

graphify update .
```

Semua perintah exit 0. C: 48 file, 0 request, 0 retry, 0 failure. Replay: 4 file, 0 request. `graphify update .`: 3492 nodes, 8369 edges, 151 communities; hanya `graphify-out/` yang berubah. `graphify query` dijalankan sebelum perubahan source; keluarannya berupa daftar node/adjacency yang sebagian relevan (`resolveFields()`, `deterministicExtract()`) dan sebagian noise dari bundle vendored, sehingga keputusan akhir tetap dari pembacaan source langsung. Tidak ada build/lint full-suite, sesuai rencana.

## Hasil C: 48 workbook × 6 field

Denominator 288. Toleransi numerik 0.00005 pada skala fraksi; tanggal dan RAG exact; himpunan ID risiko exact; `unknown` dihitung tidak cocok; nilai yang memerlukan review tidak dihitung valid.

| Field | Nilai cocok | Provenance valid | Nilai + provenance | Total |
|---|---:|---:|---:|---:|
| cutoff_date | 48 | 48 | 48 | 48 |
| planned_percent | 48 | 48 | 48 | 48 |
| actual_percent | 48 | 48 | 48 | 48 |
| variance_percent | 48 | 48 | 48 | 48 |
| rag | 48 | 48 | 48 | 48 |
| open_risk_ids | 44 | 44 | 44 | 48 |
| **Total** | **284** | **284** | **284** | **288** |

Status deterministik: variance 48 `cached_formula`; RAG 48 `cached_formula`; 96/96 field cache formula memiliki `rule_matched: true`, dan 48/48 RAG memiliki `recomputed_from_dependency` yang setuju dengan cache; risiko 44 `resolved` + 4 `unknown`; tidak ada `ambiguous` dan **tidak ada `review`** pada dataset ini. `risk_entries` provenance lengkap 44/48.

Recheck mereproduksi angka v3 sebelumnya persis: denominator, totals, per-field, status, origin, empat mismatch, dan skor replay identik. Perbedaan hanya timestamp. Karena seluruh 48 fixture nyata memiliki cache RAG yang konsisten, defect `Red` untuk varians `0.014` tidak muncul di dataset ini; bukti perilaku fail-closed berasal dari uji regresi sintetis, bukan dari perubahan angka fixture.

Empat ketidakcocokan, semuanya `unknown` yang disengaja:

| Sesi | Komponen | Field | Expected | Got | Status |
|---|---|---|---:|---:|---|
| 2026-10-09_w4 | SB01 | open_risk_ids | [] | null | unknown |
| 2026-10-09_w4 | SB02 | open_risk_ids | [] | null | unknown |
| 2026-10-09_w4 | SB04 | open_risk_ids | [] | null | unknown |
| 2026-10-09_w4 | SB06 | open_risk_ids | [] | null | unknown |

Tidak ada baris risiko yang dapat diikat pada keempat file itu. Kelengkapan log tidak dapat dibuktikan dari evidence index, sehingga hasilnya tetap `unknown`. Ini bukan bukti bahwa tidak ada risiko open.

Angka 284/288 sama dengan v2, tetapi komposisinya berbeda: provenance risiko v3 mencakup ID+Status+Priority, cache formula yang tidak dikenal tidak lagi diterima, dan cache RAG yang bertentangan kini fail-closed. Kesamaan angka tidak berarti kualitasnya sama.

## Replay B: 4 workbook W7

Rekaman mentah v2 dipakai ulang; 0 request API. Provenance B dinilai dari `model_output.validated.fields.*.citations`.

| Workbook | Nilai cocok | Provenance valid | Nilai + provenance |
|---|---:|---:|---:|
| SB01 | 6/6 | 6/6 | 6/6 |
| SB02 | 6/6 | 6/6 | 6/6 |
| SB07 | 5/6 | 6/6 | 5/6 |
| SB08 | 5/6 | 6/6 | 5/6 |
| **Total** | **22/24** | **24/24** | **22/24** |

- **False rejection diperbaiki.** Di v2, 20/28 field `found` dan 8 field risiko (`open_risk_ids` + `risk_entries` × 4 file) `candidate_mismatch`. Di v3 replay, 28/28 field `found`; 61 sitasi, 0 `corroborated: false`. Termasuk 37 sitasi pada field risiko.
- **Miss model tetap terlewat.** SB07 hanya memuat `R-SB07-002` (expected `R-SB07-001` + `R-SB07-002`); SB08 hanya memuat `R-SB08-002` (expected `R-SB08-001` + `R-SB08-002`). Deterministik C menunjukkan kedua baris yang hilang benar-benar `Open` (priority Medium/High), jadi ini omission model, bukan penolakan validator.
- Nilai mentah B tetap 22/24; kenaikan v2→v3 adalah status/provenance, bukan nilai.
- `risk_entries` B tidak dinilai terhadap ground truth karena fixture tidak menyediakan expected untuk field itu. Terlihat model juga hanya memuat baris open di SB07/SB08.
- Perbaikan RAG menyentuh jalur deterministik; replay B dijalankan ulang untuk memastikan tidak ada regresi dan tetap 22/24 nilai, 24/24 provenance.

## Uji negatif terarah

`verify-v3.mjs`: **25/25 lulus**, exit 0. Cakupan:

- ID + Status + Priority pada baris yang sama diterima; sel Status dari baris lain ditolak; ID tak dikenal → `invalid_citation`; ID klaim tanpa sitasi ID ditolak; status yang bertentangan ditolak.
- Status hilang → `ambiguous`; tidak ada baris risiko → `unknown` (bukan `[]`); risiko open membawa source ID+Status.
- Formula cache valid diterima; formula variance diubah menjadi `+` → review; cache RAG ditolak bila dependensi variance tidak terverifikasi; cache kosong bukan nol (variance `derived_domain`, RAG review); cache yang tidak setuju dengan input ditolak.
- Cache RAG `Red` untuk varians `0.014` (rumus menghasilkan `Green`) ditolak menjadi `review`; nilai hitung ulang `Green` tercatat.
- Cache RAG `Red`/`Amber` yang setuju dengan varians `-0.12`/`-0.07` tetap diterima.
- Varian C tidak dapat mengubah review RAG/variance menjadi `found` lewat fallback model; `model_fallback` mencatat percobaan yang ditolak.
- Output C mempertahankan `cached_formula` + metadata formula dan status review.

## Yang belum terukur / blocker

- Empat `unknown` W4: belum ada bukti kelengkapan log risiko. Tidak diklaim kosong dan tidak dihitung cocok.
- `evidence` per baris hanya dibuat pada jalur deterministik C. Pada B, provenance ada di `model_output.validated.fields.*.citations`; objek `fields` B belum membawa `evidence` yang setara.
- Pengenalan formula sengaja konservatif dan spesifik fixture: hanya bentuk `actual - planned` dan ambang RAG yang dikenal. Formula lain, referensi lintas sheet, atau bentuk berbeda → `review`, bukan evaluasi Excel umum.
- Freshness cache tidak dibuktikan; yang dibuktikan hanya bentuk formula, konsistensi input/dependensi, dan kecocokan nilai cache dengan ambang yang dihitung ulang. Tidak ada rekalkulasi Excel dan tidak ada klaim bahwa cache mutakhir.
- Jalur `derived_domain` belum muncul pada 48 workbook nyata karena semua cache variance/RAG tersedia; jalur ini baru diuji secara sintetis.
- Tidak ada build/lint full-suite (sesuai rencana). Verifikasi terarah: `node --check`, 25 test, 48 dry-run, replay, dan skoring.
- Uji regresi berjumlah 25 pemeriksaan sintetis. Fixture nyata tidak memicu jalur kontradiksi RAG, sehingga bukti perilaku fail-closed berasal dari uji sintetis, bukan dari data fixture.
- Satu run per file; variasi model tidak diukur. Baseline A tidak dijalankan ulang. `risk_entries` tidak punya ground truth.
- Replay B hanya mencakup 4 rekaman yang tersedia di root v2; 48 hasil sesi lain tidak berada di root dan tidak di-replay.
- Hasil terikat `document-parser/18` dan paket fixture ini; bukan benchmark umum.
- `graphify query` dijalankan sebelum perubahan source (keluaran node/adjacency, sebagian noise); `graphify update .` dijalankan setelah perubahan.

## Keputusan

Perbaikan validator menghilangkan false rejection Status/Priority, menutup celah cache/formula yang ditemukan di v2, dan menutup celah lanjutan dari verifikasi independen: cache RAG yang bertentangan kini fail-closed, dan review deterministik varian C tidak dapat dibatalkan diam-diam oleh model. Namun bukti belum cukup untuk menyatakan siap produksi: kelengkapan log risiko kosong belum dapat dibuktikan (4 `unknown`), provenance B belum seragam dengan C, pengenalan formula sengaja terbatas pada bentuk fixture, freshness cache tidak dibuktikan, dan cakupan di luar 6 field/48 workbook belum dinilai. Simpan output v3/recheck sebagai bukti eksperimen, bukan validasi produksi.
