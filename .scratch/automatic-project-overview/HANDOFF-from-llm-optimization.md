# Handoff ke agent Kelompok B (refactor userflow) — dari stream optimisasi LLM

Tanggal: 2026-11-07. Branch: `development` = `development-bismillah-final` = `90c2ad4` (ter-push). Master tidak disentuh. Deployment ditunda.

## 1. Dua kelompok kerja

- **Kelompok A (ekstraksi)** — stream ini. Status: selesai sejauh mungkin tanpa input eksternal. Output: pipeline `/44` memproduksi observasi + coverage + provenance + status per dokumen.
- **Kelompok B (userflow)** — Anda. Mengonsumsi output A. Sumber: [plan.md](plan.md) + [USERFLOW.md](USERFLOW.md).

## 2. Yang sudah dikerjakan stream A (ringkas; bukti lengkap: [report-final-testing.md](../opencode-go-experiment/report-final-testing.md), 18 lampiran)

- **Pipeline `/44`**: deterministic-first XLSX (progress/milestone tanpa model), dekomposisi 2-task, guard semantik fakta, prompt verbatim+tanggal, cache grup konten-ter-address lintas-dokumen (hemat ±36% upload mingguan), formula freshness Level 1 (rekalkulasi verifikasi, aturan "never evaluate" dilonggar untuk subset aritmetika aman), fallback Gemini sadar-kelas (dorman tanpa kunci), batas kepadatan grup via env.
- **Bukti**: 319/319 tes; sweep 30/30 dokumen asli + 48 workbook fixture, 0 crash; derivasi terverifikasi XML independen + sign-off manusia (1 subsistem); live end-to-end: dokumen ringan asli selesai bersih, workbook berat 13/21 grup + 8 gagal fail-closed; probe injection lulus; kontrol positif Gemini lulus.
- **Koreksi model biaya**: workbook mingguan asli ±240–400k token (bukan 188k); keluarga padat ~10k token/request.
- **Parser /22** (kerja stream parser lain) sudah ter-merge dan terverifikasi gabungan (317/317 saat merge; derivasi bertahan).

## 3. Kelompok A yang BELUM selesai (bukan tanggung jawab B, tapi B harus tahu)

| Item | Status | Implikasi untuk B |
|---|---|---|
| Cost/risk sign-off | **Terblokir** tabel bergeser di `Pengajuan Pembelian` (8/8 grup gagal fail-closed; handoff parser: [HANDOFF-drifting-table-parser.md](../opencode-go-experiment/HANDOFF-drifting-table-parser.md)) | Domain Budget/Risk di overview: bukti ekstraksi nyata belum ada — tampilkan sebagai gap/klaim bersumber, jangan klaim kesiapan |
| Formula freshness Level 2 (RAG, IF kompleks) | Menunggu garansi generator tracker-web | Kolom status RAG tetap gap/review |
| Gemini kontrol negatif | 2× tertahan kapasitas free tier; mekanisme fallback dorman (aktif via env) | Fallback tidak mempengaruhi kontrak B |
| Baseline + MoM live | Belum diuji live (offline 30/30 OK); biaya tinggi (±240–400k token/file) | Domain action-item/baseline: kualitas ekstraksi nyata belum terbukti |
| Baseline A, infra (DB native, E2E), deployment | Keputusan/ditunda | — |

## 4. Kontrak wajib untuk B (pelanggaran = konflik dengan stream A)

1. **Asesmen otomatis hanya mengonsumsi observasi/coverage terpublikasi; pemicunya TIDAK memanggil LLM dan tidak me-retry ekstraksi.** Pemulihan dokumen = workflow terpisah (tiket 07).
2. **Eligibility per-observasi, bukan per-dokumen**: dokumen `needs_review` tetap menyumbang observasi valid parsial. Payload worker mengirim `processing_status` + observasi + coverage **bersama** — jangan menggate pada status dokumen.
3. **Jangan mengubah/melonggarkan worker, validator, atau prompt** tanpa handoff (area bersama). Guard fail-closed dari stream A adalah yang membuat "tanpa tinjauan massal" aman; kegagalan grup = keputusan/gap di overview, bukan masalah validator.
4. **Klaim kesiapan per domain mengikuti bukti**: progress/milestone = READY WITH HUMAN REVIEW (terbatas ITB mingguan); cost/risk/baseline/MoM = belum.

## 5. Titik integrasi konkret untuk B

- **Sinyal post-publikasi belum ada** — pipeline tidak memberi hook "observasi terbit"; B perlu mendesainnya (area bersama; koordinasikan bila menyentuh worker/route).
- `runAssuranceAnalysis` saat ini aksi `FormData` manual (assurance-actions.ts:209) — tahap 3 plan.md (pemisahan pemicu otomatis dari aksi manual) sudah mengidentifikasi ini.
- **Env yang tersedia dari stream A**: `XASS_EXTRACTION_MAX_GROUP_CHUNKS`/`_CHARACTERS` (kepadatan), `XASS_EXTRACTION_GEMINI_FALLBACK_GROUPS` (porsi fallback), `GEMINI_API_KEY`/`GEMINI_MODEL` (fallback dorman).
- **Cache `/44`**: kunci konten-ter-address per grup, lintas dokumen dalam satu proyek; `PARSER_VERSION /22` + schema `/44` → deploy pertama re-extract sekali.

## 6. Status keputusan terbuka B (plan.md 0–7) — semua masih terbuka kecuali koreksi berikut

- Koreksi fakta ke plan.md: referensi laporan kini `/44` (bukan `/42`); biaya workbook asli ±240–400k (lampiran 7–9); mislabel guard DITUTUP dengan data (0 kasus nyata — lampiran 14/17 area terkait).
- #7 (kondisi gabungan vs domain terpisah) = konflik kontrak langsung dengan CONTEXT.md — harus diselesaikan sebelum cutover overview.
- #0 ownership tetap gerbang pertama.

## 7. Proses

Tahapan plan.md = pembagian rencana, **bukan tiket disetujui** — ikuti [workflow repo](../../docs/agents/README.md) untuk spesifikasi + persetujuan tiket sebelum implementasi. Jangan ubah status tiket 04–07 dari dokumen.
