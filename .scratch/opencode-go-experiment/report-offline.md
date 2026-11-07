# Laporan validasi offline — provenance, kelengkapan risiko, dan formula/cache

## Batas operasional dan pernyataan request

- Semua pengujian aplikasi dijalankan **offline**: hanya `--dry-run` dan `--replay`, ditambah tes sintetis lokal. Tidak ada `.env*` yang dibaca, tidak ada API key yang dicetak atau disimpan, dan tidak ada request ke provider/model/LLM dari pengujian.
- Tidak ada perubahan pada worker produksi, fixture asli, hasil v2/v3/v3-recheck, atau kode yang tidak terkait. Artefak baru berada di `.local-evaluation/opencode-go-exp-offline/`; laporan ini baru.
- Tidak ada commit, install paket, atau perintah destruktif.
- CommandCode sendiri memakai model untuk bekerja; itu terpisah dari pengujian aplikasi. Semua ringkasan run di bawah menunjukkan `requests: 0`, `retry_count: 0`, `model_called: false` (dry-run) atau `api_called: false` (replay).
- `graphify query` dijalankan sebelum pembacaan source; `graphify update .` dijalankan setelah perubahan kode. Update terakhir: 3514 node, 8409 edge, 145 community.

## Ringkasan temuan

1. **SB07/SB08**: kedua ID risiko open yang diharapkan benar-benar ditemukan kandidat deterministik, masuk konteks prompt (ID + Status + Priority + deskripsi, tanpa pemotongan dan tanpa drop cap), tetapi model hanya memilih baris `Type=Risk` (satu ID). Model sendiri mencatat “Only Type=Risk row with Status=Open”; baris yang terlewat bertipe `Issue` dengan Status `Open`. Ini omission model pada rekaman tersebut, bukan kegagalan retrieval atau pemotongan konteks. Prompt persis run v2 tidak disimpan; bukti yang tersedia adalah `context.risk.included_source_ids` dari run itu dan reproduksi dry-run dengan parser yang sama.
2. **Celah validator**: validator v3 lama menerima set risiko parsial sebagai `found` selama sitasi ID yang diklaim valid. Untuk SB07/SB08, ini berarti set 1-dari-2 ditampilkan `found`; skor lama 24/24 provenance tidak membuktikan kelengkapan set. Audit menemukan tujuh jalur false-accept serupa.
3. **Perbaikan fail-closed**: `found` tanpa sitasi, sitasi label/baris/periode salah, sitasi di luar konteks yang disediakan, set risiko parsial, duplikasi ID, dan set risiko kosong tanpa bukti kelengkapan sekarang tidak diterima sebagai `found`. Replay merekonstruksi konteks/cap dari record sumber dan mencatat `source_context_matches`.
4. **Hasil reproduksi**: C 48 workbook × 6 field = **284/288** nilai dan provenance; **284/284** provenance struktural untuk field `found`; **0** false accept; 4 `unknown` W4 tetap `unknown`, bukan daftar kosong. Replay B baru: **22/24** nilai, **24/24** sitasi struktural valid, **22/24** nilai + provenance `found`, **0** false accept, 2 set parsial menjadi `ambiguous`. Replay lama yang sama menghasilkan **4 false accept** di bawah pemeriksaan kelengkapan baru.
5. **Tes**: `verify-v3.mjs` sekarang **50/50 lulus**, semuanya sintetis, tanpa workbook dan tanpa jaringan.

## 1. Diagnosis SB07/SB08 terhadap rekaman historis

### Fakta teramati

Ground truth W7: SB07 `05_Pencahayaan_Subcontractor_Weekly.xlsx` mengharapkan `R-SB07-001` + `R-SB07-002`; SB08 `07_Air_Bersih_Subcontractor_Weekly.xlsx` mengharapkan `R-SB08-001` + `R-SB08-002`. Keduanya berstatus `Open`.

Rekaman B v2 dan replay v3 menunjukkan:

| Komponen | Baris | ID | Status | Priority | Source ID (ID/Status/Priority/Type/Description) |
|---|---|---|---:|---|---|
| SB07 | Issue Risk & Change 4 | R-SB07-001 | Open | Medium | c18s3 / c18s13 / c18s9 / c18s4 / c18s6 |
| SB07 | Issue Risk & Change 5 | R-SB07-002 | Open | Low | c18s15 / c18s25 / c18s21 / c18s16 / c18s18 |
| SB08 | Issue Risk & Change 4 | R-SB08-001 | Open | High | c18s3 / c18s13 / c18s9 / c18s4 / c18s6 |
| SB08 | Issue Risk & Change 5 | R-SB08-002 | Open | Medium | c18s15 / c18s25 / c18s21 / c18s16 / c18s18 |

Konteks prompt yang tersimpan di rekaman v2:

- `context.risk.lines = 10`, `included_source_ids` memuat **kesepuluh** source ID di atas, termasuk kedua ID dan kedua Status.
- `context.risk.truncated = []`; `context.cap.dropped_source_ids = []`; `used_chars` 4548 (SB07) dan 4537 (SB08) dari batas 60000.
- Deskripsi kedua baris pendek (di bawah cap 160 karakter), jadi tidak ada pemotongan deskripsi yang bisa menghilangkan ID.
- Dry-run B pada workbook yang sama dengan parser `document-parser/18` mereproduksi tepat 10 baris risk evidence yang sama; ini memverifikasi bahwa konteks run v2 memang memuat kedua baris.

Output model pada rekaman v2:

- SB07: `open_risk_ids.value = ["R-SB07-002"]`, catatan model “Only Type=Risk row with Status=Open”; `risk_entries` hanya memuat R-SB07-002.
- SB08: `open_risk_ids.value = ["R-SB08-002"]`, catatan model sama; `risk_entries` hanya memuat R-SB08-002.
- Model mengutip sel `Type` (B5) dan `Status` (K5) pada baris yang diklaim. Validator v2 menolak ini sebagai `candidate_mismatch` karena sel `Type` bukan ID; itu **false rejection** sitasi pendukung, bukan bukti bahwa ID yang diklaim salah. Validator v3 memperbaiki false rejection ini, tetapi kemudian menerima set parsial sebagai `found` — **false accept kelengkapan**.

Status historis vs perbaikan:

| Rekaman | Field | Status lama (v3-recheck) | Status baru (offline) | Nilai |
|---|---|---|---|---|
| SB07 | `open_risk_ids` | `found` | `ambiguous` | ["R-SB07-002"] |
| SB07 | `risk_entries` | `found` | `ambiguous` | hanya R-SB07-002 |
| SB08 | `open_risk_ids` | `found` | `ambiguous` | ["R-SB08-002"] |
| SB08 | `risk_entries` | `found` | `ambiguous` | hanya R-SB08-002 |

Catatan baru: “claimed set omits candidate risk rows …; completeness is not proven”. Sitasi yang ada tetap valid secara struktural (3 sitasi untuk `open_risk_ids`, semuanya corroborated); yang berubah adalah klaim kelengkapan, bukan validitas sitasi parsialnya.

### Recall kandidat per file

Definisi: **expected** = ID open di ground truth W7; **candidate** = baris open dari ekstraksi deterministik; **in context** = ID dan Status source ID-nya ada di `context.risk.included_source_ids`; **model selected** = nilai `open_risk_ids` dari output mentah model; **validator claimed** = ID yang benar-benar diklaim dan diterima (bukan sekadar status field).

| File | Expected open | Candidate found | In context | Model selected | Validator claimed | Catatan |
|---|---:|---:|---:|---:|---:|---|
| SB01 `01_Alarm` | 1 | 1 | 1 | 1 | 1 `found` | lengkap |
| SB02 `02_Kamera` | 3 | 3 | 3 | 3 | 3 `found` | lengkap |
| SB07 `05_Pencahayaan` | 2 | 2 | 2 | 1 | 1 `found` + 1 `ambiguous` | set parsial; R-SB07-001 terlewat |
| SB08 `07_Air_Bersih` | 2 | 2 | 2 | 1 | 1 `found` + 1 `ambiguous` | set parsial; R-SB08-001 terlewat |
| **Total** | **8** | **8** | **8** | **6** | **6 `found`; 2 file parsial** | denominator 8 ID |

Validator v3 lama akan melaporkan 6 ID yang diklaim sebagai `found` dan 0 field `found` untuk 2 ID yang tidak diklaim; tetapi field `open_risk_ids` untuk SB07/SB08 tetap `found` dengan set parsial. Jadi “6/8 ID diklaim” bukan “6/8 kelengkapan set”; kelengkapan set adalah 2/4 file replay (SB01, SB02), dan 0/2 untuk SB07/SB08.

### Fakta vs inferensi

- **Fakta**: kedua ID adalah kandidat open, kedua ID/Status ada di konteks, tidak ada truncation/cap drop, model hanya mengembalikan satu ID, dan catatan model menyebut filter `Type=Risk`.
- **Inferensi**: model tampaknya menambahkan filter `Type=Risk` yang tidak diminta prompt (prompt meminta “risk IDs whose Status is Open”). Ini penjelasan yang konsisten dengan catatan model, tetapi bukan bukti proses internal model.
- **Batas semantik:** expected fixture menghitung baris bertipe `Issue` dengan ID `R-...` sebagai bagian dari `open_risk_ids`. Ini membuktikan perbedaan terhadap kontrak benchmark saat ini, bukan bahwa setiap Issue di dokumen nyata adalah Risk. Kebijakan domain untuk tipe Issue perlu disepakati sebelum digunakan sebagai aturan produksi.
- **Bukan klaim umum**: ini omission pada dua rekaman W7 dengan satu run per file; tidak membuktikan sifat umum model atau prompt.
- **Prompt persis**: rekaman v2 non-dry-run tidak menyimpan teks prompt. Yang tersedia adalah konteks yang tersimpan dan reproduksi dry-run; kita tidak mengklaim isi prompt historis di luar daftar source ID/konteks tersebut.
- **Ground truth tidak masuk prompt/replay**: runner tidak membaca `expected-results.json`; replay memakai `model_output.parsed` yang tersimpan; hanya scorer yang membaca ground truth. Raw expected tidak dimasukkan ke prompt/replay.

## 2. Audit dan pengujian offline

### Bug harness yang ditemukan dan diperbaiki

Semua jalur di bawah terbukti dengan sel sintetis; sebelum perbaikan, output berstatus `found`/`resolved` yang tidak didukung.

1. **`found` tanpa sitasi** — `validateModelOutput` menerima `found` dengan `source_ids: []`. Sekarang menjadi `candidate_mismatch` (“found without any citation”).
2. **Sitasi label salah** — nilai numerik yang sama dari sel `Actual %` diterima untuk `planned_percent` karena `label_matches_field` dihitung tetapi tidak pernah ditegakkan. Sekarang sitasi harus mendukung label field pada baris progress terpilih.
3. **Sitasi periode/baris salah** — nilai sama dari baris W6 diterima untuk W7. Sekarang `selectedRow` (sheet + row) dioper ke validator; sitasi label yang berada di baris lain ditolak. Deklarasi `Reporting Cut-off` tetap diterima sebagai sumber `cutoff_date`.
4. **Sitasi di luar konteks** — ID yang ada di evidence index tetapi tidak masuk prompt (mis. terpotong cap) tetap diterima. Sekarang `allowedSourceIds` dioper; sitasi di luar konteks menjadi `invalid_citation`.
5. **Set risiko kosong tanpa bukti** — `open_risk_ids: []` dengan `found` diterima. Sekarang menjadi `ambiguous` (“empty risk set has no completeness proof”).
6. **Set risiko parsial** — set 1-dari-2 diterima sebagai `found`. Sekarang `candidate_check` membandingkan dengan kandidat deterministik; set parsial menjadi `ambiguous` dengan `missing`, `extra`, `complete`.
7. **Duplikasi ID** — ID ganda dalam nilai klaim diterima; dua baris deterministik dengan ID sama menghasilkan `resolved` berisi duplikat. Sekarang klaim duplikat menjadi `candidate_mismatch`, dan baris deterministik duplikat menjadi `ambiguous`.

Perubahan juga menambahkan pemeriksaan bahwa sitasi non-risiko berada di baris progress terpilih dan bahwa semua sitasi berasal dari konteks yang benar-benar dikirim. Replay merekonstruksi `buildContext` + `capContext` dari `record.context.cap.max_chars`, lalu mencatat `replay.source_context_matches`; untuk keempat rekaman hasilnya `true`.

### Tes positif/negatif

`node .scratch/opencode-go-experiment/verify-v3.mjs` → **50/50 lulus**, exit 0. Tidak membaca workbook dan tidak membuat request. Cakupan:

- **Risiko**: ID+Status+Priority baris sama diterima; Status baris lain, Status sheet lain, ID tak dikenal, klaim tanpa sitasi ID, status bertentangan, status `Closed`, status ambigu (`In Progress`), status kosong, duplikasi ID klaim, dan baris deterministik duplikat ditolak/tidak `found`; status hilang → `ambiguous`; tidak ada baris risiko → `unknown`, bukan `[]`; set parsial → `ambiguous`; set lengkap → `found`.
- **Nilai/tanggal**: `found` tanpa sitasi, sitasi label salah, sitasi baris/periode lain, dan sitasi di luar konteks ditolak; sitasi baris terpilih dan deklarasi `Reporting Cut-off` diterima.
- **Formula/cache**: cache variance/RAG yang dikenali dan konsisten diterima; formula variance diubah menjadi `+` → review; cache RAG yang bertentangan → review; cache kosong bukan nol; `missing_cache`, `cached_error`, `unknown` → variance `derived_domain`, RAG review; formula berubah + cache kosong → `derived_domain`, RAG review; batas ambang `-0.1` strict → Amber, `-0.1` inclusive → Red, `-0.1` strict dengan cache Red → review, `-0.05` strict → Green.
- **Fallback model**: review deterministik RAG/variance tidak dapat diubah menjadi `found` oleh fallback; `model_fallback` mencatat jawaban yang ditolak.

### Batas pengujian audit

- Pemeriksaan provenance struktural adalah **konsistensi internal** terhadap record deterministik (source ID, sheet/row, status/priority), bukan pembacaan ulang independen seluruh sel workbook. Scorer tidak membuktikan bahwa nilai sel pada workbook benar; ia membuktikan bahwa evidence yang dipancarkan menunjuk baris/source ID yang sama dengan ekstraksi deterministik.
- Kelengkapan set risiko dibandingkan dengan **kandidat deterministik**, bukan ground truth global. Jika kandidat sendiri tidak lengkap, validator tidak dapat membuktikan kelengkapan; karena itu set parsial dibuat `ambiguous`, bukan `found`.
- Pengenalan formula sengaja konservatif: hanya bentuk `actual - planned` dan ambang RAG yang dikenal. Bentuk lain, referensi lintas sheet, atau cache yang tidak dapat dihitung ulang → review.
- Freshness cache tidak dibuktikan. Yang dibuktikan hanya bentuk formula, konsistensi input/dependensi, dan kecocokan nilai cache dengan ambang yang dihitung ulang dari variance terverifikasi.
- Tidak ada build/lint full-suite; verifikasi terarah: `node --check`, 50 tes, 48 dry-run C, replay, dan skoring.

## 3. Hasil yang dapat direproduksi

### Perintah yang dijalankan

```sh
node --check .scratch/opencode-go-experiment/evidence-v2.mjs
node --check .scratch/opencode-go-experiment/verify-v3.mjs
node --check .scratch/opencode-go-experiment/score-v3.mjs
node --check .scratch/opencode-go-experiment/score-b-replay-v3.mjs
node .scratch/opencode-go-experiment/verify-v3.mjs

# Diagnosis: dry-run B untuk mereproduksi baris risk evidence persis.
node .scratch/opencode-go-experiment/evidence-v2.mjs --variant B --dry-run \
  --out .local-evaluation/opencode-go-exp-offline/probe-b \
  demo-evidence-fixtures/smart-building-itb/sessions/2026-10-30_w7/01_Alarm_Kebencanaan_Subcontractor_Weekly.xlsx
node .scratch/opencode-go-experiment/evidence-v2.mjs --variant B --dry-run \
  --out .local-evaluation/opencode-go-exp-offline/probe-b-sb07 \
  demo-evidence-fixtures/smart-building-itb/sessions/2026-10-30_w7/05_Pencahayaan_Subcontractor_Weekly.xlsx
node .scratch/opencode-go-experiment/evidence-v2.mjs --variant B --dry-run \
  --out .local-evaluation/opencode-go-exp-offline/probe-b-sb08 \
  demo-evidence-fixtures/smart-building-itb/sessions/2026-10-30_w7/07_Air_Bersih_Subcontractor_Weekly.xlsx

# C: 4 sesi × 12 workbook, hanya dry-run.
for s in 2026-10-09_w4 2026-10-16_w5 2026-10-23_w6 2026-10-30_w7; do
  node .scratch/opencode-go-experiment/evidence-v2.mjs --variant C --dry-run \
    --out .local-evaluation/opencode-go-exp-offline/$s \
    demo-evidence-fixtures/smart-building-itb/sessions/$s/*.xlsx
done

# Replay jawaban B historis ke direktori baru.
node .scratch/opencode-go-experiment/evidence-v2.mjs \
  --replay .local-evaluation/opencode-go-exp-v2 \
  --out .local-evaluation/opencode-go-exp-offline --session replay-v3

# Scoring.
V3_ROOT=.local-evaluation/opencode-go-exp-offline node .scratch/opencode-go-experiment/score-v3.mjs
REPLAY_ROOT=.local-evaluation/opencode-go-exp-offline/replay-v3 node .scratch/opencode-go-experiment/score-b-replay-v3.mjs

# Quantifikasi false accept historis: salin replay lama ke direktori baru, jangan menimpa sumber.
mkdir -p .local-evaluation/opencode-go-exp-offline/historical-recheck-replay
cp .local-evaluation/opencode-go-exp-v3-recheck/replay-v3/B-*.json \
  .local-evaluation/opencode-go-exp-offline/historical-recheck-replay/
REPLAY_ROOT=.local-evaluation/opencode-go-exp-offline/historical-recheck-replay \
  node .scratch/opencode-go-experiment/score-b-replay-v3.mjs

graphify update .
```

### C: 48 workbook × 6 field

Denominator 288. Toleransi numerik 0.00005 fraksi; tanggal/RAG exact; himpunan ID risiko exact; `unknown` dihitung tidak cocok, bukan daftar kosong.

| Field | Nilai cocok | Provenance valid | Provenance struktural (found) | Nilai + provenance | Found | False accept | Checks |
|---|---:|---:|---:|---:|---:|---:|---:|
| cutoff_date | 48 | 48 | 48/48 | 48 | 48 | 0 | 48 |
| planned_percent | 48 | 48 | 48/48 | 48 | 48 | 0 | 48 |
| actual_percent | 48 | 48 | 48/48 | 48 | 48 | 0 | 48 |
| variance_percent | 48 | 48 | 48/48 | 48 | 48 | 0 | 48 |
| rag | 48 | 48 | 48/48 | 48 | 48 | 0 | 48 |
| open_risk_ids | 44 | 44 | 44/44 | 44 | 44 | 0 | 48 |
| **Total** | **284/288** | **284/288** | **284/284** | **284/288** | **284** | **0** | **288** |

- Status: 284 `found`, 4 `unknown`, 0 `review`, 0 `ambiguous`.
- `risk_entries`: 44 resolved, 44 evidence lengkap, 44 structural valid, 44 candidate-complete; 4 `unknown`.
- Origin: variance 48 `cached_formula`, RAG 48 `cached_formula`; 96/96 cache memiliki `rule_matched: true`; 48/48 RAG memiliki `recomputed_from_dependency` yang setuju.
- Empat mismatch adalah `unknown` yang disengaja pada W4: SB01, SB02, SB04, SB06 (file 01, 02, 04, 09). Tidak ada baris risiko yang dapat diikat; `coverage.unused_sheets` mencakup `Issue Risk & Change` pada contoh W4, dan catatan menyatakan kelengkapan log tidak terbukti. Ini bukan bukti “tidak ada risiko”.
- Empat file W4 menge-escalate dua field (`open_risk_ids` dan `risk_entries`); tetap 0 request karena `--dry-run`.
- Recall kandidat deterministik pada 48 file: 44 file expected non-empty dan 4 file expected empty; himpunan ID open kandidat sama persis dengan expected di **48/48 file** (0 ID terlewat, 0 ID ekstra). Namun 4 file expected-empty tetap `unknown`, bukan `[]`, karena kelengkapan log tidak terbukti. Angka ini adalah recall kandidat terhadap fixture ini, bukan bukti recall global. Artefak: `.local-evaluation/opencode-go-exp-offline/candidate-recall-c48.json`.
- Seluruh 48 output C memiliki `fields` dan `deterministic` yang identik dengan hasil v3-recheck sebelumnya (perbandingan deep, 0 file berbeda). Perubahan harness tidak mengubah jalur deterministik C.

### B replay: 4 workbook W7

Denominator 24. Sumber: rekaman mentah v2; 0 request API.

| Workbook | Nilai cocok | Found + sitasi | Sitasi struktural | Nilai + provenance | False accept | open_risk_ids (got vs expected; candidate) |
|---|---:|---:|---:|---:|---:|---|
| SB01 | 6/6 | 6/6 | 6/6 | 6/6 | 0 | [001] vs [001]; complete |
| SB02 | 6/6 | 6/6 | 6/6 | 6/6 | 0 | [001,002,003] vs sama; complete |
| SB07 | 5/6 | 5/6 | 6/6 | 5/6 | 0 | [002] vs [001,002]; incomplete |
| SB08 | 5/6 | 5/6 | 6/6 | 5/6 | 0 | [002] vs [001,002]; incomplete |
| **Total** | **22/24** | **22/24** | **24/24** | **22/24** | **0** | 2 incomplete |

- Status baru: 22 `found`, 2 `ambiguous` (SB07/SB08 `open_risk_ids`), 0 `unknown`, 0 `review`.
- `risk_entries` SB07/SB08 juga `ambiguous` dengan `candidate_check.missing` berisi ID yang terlewat; `risk_entries` SB01/SB02 tetap `found` dan complete.
- **Perbandingan dengan validator lama**: salinan replay v3-recheck yang sama, diskor dengan pemeriksaan baru, menghasilkan 24/24 `found` + sitasi, 24/24 sitasi struktural, 22/24 nilai, tetapi **4 false accept** — 2 `open_risk_ids` dan 2 `risk_entries` pada SB07/SB08 yang `found` meski set parsial. Artinya angka lama “24/24 provenance” adalah validitas sitasi struktural, bukan kelengkapan set.
- 2 selisih nilai tetap sama seperti sebelumnya: R-SB07-001 dan R-SB08-001 tidak dipilih model. Deterministik C menunjukkan keduanya `Open` (Medium/High), jadi ini omission model, bukan penolakan validator.

### Akuntansi request dan integritas hasil lama

- Semua ringkasan C: 48 file, 48 ok, 0 failed, 0 request, 0 retry, `dry_run: true`, 0 `model_called`.
- Replay: 4 file, 4 ok, 0 failed, 0 request; `summary-B-replay.json` mencatat `api_called: false`.
- Usage pada dry-run/replay adalah `null`/`reported: false`, bukan nol yang diklaim sebagai pemakaian nyata. Tidak ada usage provider baru.
- SHA-256 empat `B-*.json` v2 tetap `1958bc77…`, `985f356b…`, `284e06b5…`, `4abd8d7d…`; mtime replay v3-recheck tetap 6 Nov 19:17:56. Tidak ada file v2/v3/v3-recheck yang ditulis ulang.
- Semua output baru berada di `.local-evaluation/opencode-go-exp-offline/` (git-ignored), termasuk `candidate-recall-historical.json`, hasil C, replay, skor, dan probe dry-run.

### Konteks yang dikecualikan dan field yang tidak dinilai

- Setiap output C menyimpan `coverage.used_sheets`, `coverage.unused_sheets`, `context.*.omitted`, `context.*.truncated`, dan `context.cap.dropped_source_ids`. Contoh SB07 W7: sheet terpakai `PM Summary`, `Weekly Report`, `Issue Risk & Change`; tidak terpakai `Read Me`, `Project Info`, `Workplan & Gantt`, `Integration Readiness`, `Evidence & Handover`, `Data Quality Audit`. Jadi hasil ini tidak menilai seluruh isi workbook.
- `not_assessed` mencakup `wbs_percent_complete`, `overall_weighted_progress`, `next_milestone`, `new_risks`, `closed_risks`, `priority_changed_risks`, `project_rollup`, `hardware_cost_reconciliation`, dan `mom_decisions`. Tidak ada klaim tentang field tersebut.
- Empat `unknown` W4 tidak boleh ditafsirkan sebagai daftar risiko kosong.

## 4. Perubahan harness

File yang diubah (eksperimen, bukan produksi):

1. `.scratch/opencode-go-experiment/evidence-v2.mjs`
   - `validateModelOutput(..., options)` menerima `allowedSourceIds`, `cutoffDeclarationSourceIds`, `selectedRow`, dan `riskCandidates`.
   - `corroborate` menegakkan label/baris progress, sitasi kosong, dan dukungan field; menambahkan `support_kind`, `on_selected_row`, `supports_field`.
   - `candidateCoverage` dan `candidate_check` untuk set risiko parsial; set parsial → `ambiguous`.
   - `duplicateValues` dan deteksi duplikasi ID klaim/baris deterministik.
   - `open_risk_ids`/`risk_entries` kosong tanpa bukti → `ambiguous`.
   - `runFile` dan `runReplay` mengoper konteks yang benar-benar dikirim; replay merekonstruksi context/cap dan mencatat `source_context_matches`.
   - Export `labelSupportsField` dan `candidateCoverage` untuk tes.
2. `.scratch/opencode-go-experiment/verify-v3.mjs`
   - 25 tes lama dipertahankan; 25 tes baru ditambahkan (total 50) untuk sitasi kosong/label/baris/periode/konteks, set parsial, duplikasi ID, status closed/ambigu/kosong, cross-sheet, dan batas formula/cache.
3. `.scratch/opencode-go-experiment/score-v3.mjs`
   - Menambahkan status summary, provenance struktural dengan denominator field `found`, candidate completeness, dan daftar false accept.
4. `.scratch/opencode-go-experiment/score-b-replay-v3.mjs`
   - Memisahkan validitas sitasi struktural dari status `found`, menambahkan candidate completeness dan false accept; tetap menghitung nilai/provenance lama.
5. `.scratch/opencode-go-experiment/README.md`
   - Menambahkan alur offline v4, perintah C/replay/skoring baru, dan aturan validator yang diperbarui.

## 5. Rekomendasi

1. **Pertahankan gerbang kelengkapan**. Set risiko parsial harus tetap `ambiguous`/review dengan `candidate_check`; jangan pernah menampilkan set parsial sebagai `found` lengkap. Ini juga harus berlaku di jalur B live, bukan hanya replay.
2. **Simpan prompt yang benar-benar dikirim** (dengan kontrol sensitivitas) di artefak eksperimen. Saat ini diagnosis SB07/SB08 mengandalkan context tersimpan + reproduksi dry-run; teks prompt historis tidak dapat diklaim.
3. **Tambahkan verifikasi sel independen** untuk evidence C: baca kembali sel workbook pada sheet/row/col yang dikutip, bukan hanya mencocokkan record deterministik. Scorer saat ini membuktikan konsistensi internal, bukan kebenaran sel.
4. **Jangan gunakan hasil ini sebagai validasi produksi**. Cakupan terbatas pada 6 field, satu keluarga fixture, dan parser `document-parser/18`; WBS, cost, milestone, MoM, dan perbandingan antar-sesi tidak dinilai.
5. **Formula/cache**: pertahankan pengenalan konservatif; tambahkan rekalkulasi/freshness check sebelum produksi. Jangan menganggap cache yang diterima sebagai bukti cache mutakhir.
6. **Uji lintas sesi** untuk `new_risks`, `closed_risks`, dan `priority_changed_risks`; runner saat ini hanya melihat satu file.
7. **Perluas evaluasi** ke WBS/cost/milestone dengan ground truth yang memadai sebelum mengklaim kesiapan produksi.
8. **Jangan generalisasi** dari 48 workbook satu fixture-family, satu run per file, atau replay respons historis. Perubahan prompt/model baru belum diuji.

## 6. Pernyataan tidak ada request LLM dari pengujian

Semua perintah aplikasi memakai `--dry-run` atau `--replay`; tidak ada `--env-file`, tidak ada `run.mjs`, `baseline-v2.mjs`, atau `evidence-v2.mjs` tanpa mode offline. Jalur `chat()`/`fetch()` tidak dieksekusi. Ringkasan C menunjukkan `requests: 0`, `retry_count: 0`, `model_called: false`; ringkasan replay menunjukkan `api_called: false` dan `requests: 0`. Tidak ada API usage baru yang dilaporkan. CommandCode inference untuk sesi ini terpisah dari aplikasi yang diuji.

Hasil ini adalah bukti eksperimen offline, bukan benchmark produksi.
