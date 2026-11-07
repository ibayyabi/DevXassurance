# Hasil eksperimen dekomposisi — pilot SB02 (2026-10-30_w7)

> Koreksi: hasil yang disebut “varian C” di bawah **bukan** implementasi C sesuai rencana. `run-variant.mjs` menyimpan hasil deterministik terpisah dan tetap meminta LLM mengekstrak semua field; tidak ada seleksi ID bukti atau validasi provenance setara produksi. Skor 8/8 adalah kecocokan output LLM pada satu file, bukan hasil pipeline deterministik + fallback. Perbandingan ke A/B dan klaim penghematan belum terbukti; penggunaan cache juga tidak sebanding.

File: `02_Kamera_Pengawasan_Subcontractor_Weekly.xlsx`
SHA256: `a7aef5d48b3848f868580c69495f08f6370365600a926f9f682c6e888df170aa`
Model: `deepseek-v4.1-flash` via OpenCode Go (`https://opencode.ai/zen/go/v1`), session `pilot-sb02-1` dan varian sesinya masing-masing.
Parser: produksi `parseDocumentBuffer` — 31 chunks, 63,142 chars, 215 warnings. Parse 98 ms.

## Varian C (deterministik + B) — 8/8 benar

| Field | Hasil | Expected |
|---|---|---|
| planned_percent | 0.2475 | 0.2475 ✓ |
| actual_percent | 0.102 | 0.102 ✓ |
| variance_percent | -0.1455 | -0.1455 ✓ |
| rag | Red | Red ✓ |
| cutoff | 2026-10-30 | 2026-10-30 ✓ |
| next_milestone | 2.1 Barang diterima (delivery note) - 06-Nov-2026 | sama ✓ |
| wbs_percent_complete | [1, 0.7, 0, 0, 0, 0, 0, 0] | sama ✓ |
| open_risks | [R-SB02-001, R-SB02-002, R-SB02-003] | sama ✓ |

Biaya: 1 request, prompt 20,630 (20,608 cached), completion 972 (reasoning 835), allowance $0.000778. Respons `finish=stop`, tidak terpotong.

Catatan deterministik: ekstraktor deterministik sederhana ini berhasil menemukan 3 risk ID yang benar dan dua baris header tabel, tetapi gagal menemukan planned/actual/variance/rag dan tidak memisahkan WBS data (hanya header). Jadi varian C pada pilot ini memakai deterministik untuk risk ID dan sisanya dari model. Ini konsisten dengan hipotesis "deterministik sebagai lapis pertama dengan gerbang eskalasi", bukan deterministic-only.

## Varian A (baseline produksi) — parsial, belum tuntas untuk 1 file

- Klasifikasi: 1 request, 3,106 input / 284 output, 5,429 ms, sukses.
- Group extraction: ≥5 group berhasil sebelum di-kill timeout 180 s. Sampel:
  - G1: 2,868 in / 2,499 out, 27,610 ms
  - G2: 4,846 in / 3,196 out, 34,109 ms
  - G3: 2,489 in / 1,677 out, 17,577 ms
  - G4: 2,811 in / 1,834 out, 19,413 ms
  - G5: 4,243 in / 3,798 out, 39,344 ms
  - G7: 8,092 in / 9,714 out, 91,703 ms (output besar, kemungkinan rich observation)
- Total tool call di trace: ≥9 request untuk 1 file sebelum berhenti. Pola: 10–16 group per file × 1–2 attempt + klasifikasi + sintesis = ~15–25 request/file. Per request ~5–90 detik, throughput concurrency-2.
- Tidak ada hasil JSON final untuk file ini karena run di-kill pada 180 s. Perlu rerun dengan timeout lebih panjang (900–1200 s) atau dengan retry/backoff 429 untuk menyelesaikan.

## Varian B (model langsung, 1 call) — kena 429 kapasitas

- Request gagal karena `prefill_cap_refused` (cell at capacity) pada 3 percobaan. Ini rate-limit dari sisi provider, bukan error kualitas model. Perlu retry dengan backoff / ganti session / jalankan pada waktu off-peak.
- Desain B dirancang 1 request ~20k input / ~1k output (mirip C tanpa deterministic). Jika berhasil, perbandingan biaya langsung dari data C: 1 request, 20,630 input (hampir semua cached pada run kedua), 972 output, 9,947 ms.

## Kesimpulan sementara (belum untuk klaim penuh)

- Varian C mencapai 8/8 pada file pilot ini.
- Varian A jauh lebih mahal dalam request dan waktu (≥9 request, ≥180 s, dan belum selesai) dibanding C (1 request, 9,947 ms). Ini konsisten dengan hipotesis penghematan, tetapi perbandingan token total A vs C memerlukan run A yang tuntas.
- Varian B belum terukur karena 429 kapasitas. Ulangi dengan backoff.

Output tersimpan di `.local-evaluation/opencode-go-exp/` (git-ignored): `C-02_Kamera....json`, `summary-C.json`, `summary.json` (parsial A, gagal konfigurasi karena variabel key), dan log trace fetch dari diag-run.
