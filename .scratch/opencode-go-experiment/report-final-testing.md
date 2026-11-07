# Laporan: ronde pengujian final — robustness pipeline terhadap file input yang ada

## Lampiran 2: validasi live terarah pada konten smart-building-itb (disetujui pengguna, maks 8 request)

Pertanyaan: apakah seluruh perubahan valid untuk keluarga fixture `smart-building-itb`? Bukti offline (61/61 file, derivasi 408+248) sudah ada; yang belum adalah **jalur model live dengan konten ITB**. `itb-live-targeted.mjs` menguji dua grup nyata dari `11_Pengelolaan_Utilitas_Subcontractor_Weekly.xlsx` (W4): satu grup **ambigu** (wajib `sheet_interpretation` valid) dan satu grup **terstruktur** (berinteraksi dengan baris deterministik /39).

**Terpakai: 5/8 request** — 16.217 in / 3.519 out token (`glm-5.3-flash`). Rincian: ambigu analysis 1.960/1.047, ambigu domain 2.643/52, terstruktur analysis 3.600/1.612 (dua kali — run ulang karena cap karakter dinaikkan bertahap 12k→16k→18k mengikuti ukuran prompt nyata; 1 request terpakai untuk discovery itu), terstruktur domain 4.414/71. Artefak: `.local-evaluation/final-testing/itb-live/`.

**Hasil:**

1. **Grup ambigu lolos live**: respons `sheet_interpretation` live diterima pipeline; satu kandidat header invalid **dieksklusi konservatif** oleh validator (warning eksplisit), grup checkpoint `completed`. Fail-closed bekerja pada keluaran model nyata.
2. **Grup terstruktur menaati kontrak deterministic-first**: model live mengembalikan array kosong untuk milestone/progress (yang memang sudah diturunkan deterministik — prompt melarang re-report) dan merge menghasilkan 8 baris progress deterministik + checkpoint `completed` tanpa duplikasi.
3. **Prompt /40 bekerja di konten ITB**: tidak ada `period_label`/`as_of_date`/`snapshot_date` fabrikasi pada kedua grup.
4. **Temuan false-negative yang terdokumentasi**: fakta live `"Reporting period stated as Sep–Dec 2026"` diketik `milestone` oleh model — guard milestone-progress tidak mencakupnya (tanpa persen) dan validator menerima (sitasi valid). Ini contoh nyata kelas "mislabel non-progress" yang tetap terbuka; dampaknya terbatas (fakta tampil di review dengan sitasi), dicatat sebagai kandidat iterasi berikutnya.
5. Ukuran prompt nyata: prompt domain grup terstruktur 17,8k char (~4,4k token) — relevan untuk perencanaan biaya per file (48 workbook × ~22 grup × 2 task).

**Status validasi ITB setelah lampiran ini:** offline penuh (61 file) + jalur model live terbukti untuk grup ambigu dan grup terstruktur pada satu workbook representatif. Yang tetap belum: run live penuh satu workbook (~44–58 request/file — butuh anggaran terpisah), ground truth manusia, dan file baseline/MoM ITB (jalur modelnya belum disentuh live).


## Lampiran: iterasi prompt tanggal (langkah 2, setelah ronde final)

Setelah ronde final, langkah lanjutan menutup temuan live #2 (fabrikasi tanggal oleh model):

- **Perubahan** (`document-extraction.ts`, cache `/39` → `/40`, commit `46cc490`): prompt analysis mewajibkan `snapshot_date` ISO yang muncul digit-per-digit di excerpt (bukan due date, deadline, document date, atau tanggal locale yang diformat ulang); prompt domain mewajibkan `period_label` verbatim dengan jebakan counter tahap/fase ("Tahap 2 Januari 2026" adalah label, bukan periode) dan `as_of_date` hanya dari cut-off/record date eksplisit dengan bentuk verbatim.
- **Verifikasi offline**: 311/311 tes, `tsc`, lint, replay diagnostik — semua lulus.
- **Verifikasi live** (`LIVE_MAX_REQUESTS=6`, dir `live-prompt-v2`): dokumen Amber TXT yang sebelumnya gagal (6 snapshot terfabrikasi → grup failed) kini **checkpoint `completed` tanpa warning** — 5 fakta bertipe benar, summary grounded. Tepat **6/6 request, 9.253 in / 2.868 out token** (`glm-5.3-flash`; ada satu loop koreksi yang berhasil pada attempt 2).
- Artinya: kelas kegagalan live yang tersisa dari ronde final telah ditutup untuk kasus naratif yang diuji; bukti masih satu dokumen — bukan statistik korpus.


Tanggal: 2026-11-07. Eksekutor: GLM 5.3 Flash via Zcode. Metode: matriks celah dari 20+ laporan sebelumnya → satu ronde pengujian (sweep korpus offline, mutasi edge offline, live terkontrol) → remediasi → verifikasi penuh.

## Cara ronde ini dirancang

Sebelum mengeksekusi, seluruh laporan dan rencana di `.scratch/opencode-go-experiment/` dipindai menjadi matriks celah konsolidasi (kategori: parser, derivasi deterministik, semantik validator, checkpoint/cache, klasifikasi/ringkasan live, OCR, token vs baseline, lintas-dokumen, end-to-end live + ground truth, cost, prompt injection). Ronde ini menutup celah yang dapat dibuktikan tanpa ground truth manusia/DB produksi/E2E browser; sisanya dicatat ulang sebagai blocker terpisah.

## Fase 1 — Sweep korpus penuh (offline, 0 token)

`final-corpus-sweep.mjs`: parser produksi + `extractDocumentGroups` (model mock) atas **100 file input** dari 5 keluarga fixture (48 XLSX mingguan + 4 baseline ITB, 9 XLSX realistic-pmo, 22 DOCX, 6 PDF, 6 CSV, 6 TXT — hanya file dengan ekstensi input).

- **100/100 parse OK, 100/100 extract OK, 0 crash, 0 parse failure.**
- Beban live ekuivalen terukur: 2.930 request untuk seluruh korpus (~29/file; maksimum 58/file) — angka perencanaan biaya untuk run live penuh.
- **TEMUAN BESAR**: derivasi deterministik produksi menghasilkan **0 baris progress** di seluruh korpus (milestone hanya 7 file), padahal laporan eksperimen mengklaim 284–408 nilai pada workbook yang sama. Deterministic-first diam-diam tidak pernah aktif untuk file nyata.

### Akar masalah (diagnosis + perbaikan)

1. **Persen numerik tak terlihat**: workbook nyata menyimpan persen sebagai angka berformat (`raw "0.125"`, tampilan `"12.5%"`); gate derivasi menguji `rawValue` berbentuk persen (`/^(.*)%\s*$/`) sehingga tidak pernah cocok, dan klaim memakai `rawValue` sebagai `raw_value` yang tidak akan pernah ada di excerpt.
2. **Ledakan varian as_of**: varian `as_of_date` diambil dari SEMUA sel bertanggal (Baseline Start/Finish, Forecast) bukan hanya kolom record-date → klaim tak valid bermunculan, memicu `MAX_DETERMINISTIC_CLAIMS_PER_ARRAY` → `overCap` **menghapus seluruh klaim grup termasuk milestone yang sah** (itu sebabnya milestone hanya 7 file).
3. **Label non-progress lolos proposal**: gate lama mengusulkan klaim dari sel persen berlabel apa pun (mis. `Weight: 8%` akan menjadi "observasi progress" palsu).

**Perbaikan** (`document-extraction.ts`, cache `/38` → `/39`):
- `percentShapedClaimText()` — menerima bentuk teks maupun angka-berformat-persen; klaim selalu memakai bentuk tampilan yang ada di excerpt.
- Varian as_of hanya dari kolom ber-cue record (`isRecordDateColumn`, classifier yang sama dengan validator).
- Eligibility sel persen: label harus membuktikan progress (atau kosong) dan tidak pernah label metrik risiko — regex `RISK_METRIC_LABEL`/`PROGRESS_METRIC_LABEL` di-hoist ke modul dan dipakai bersama validator (tidak ada drift).
- `citedPercentCellForClaim()` dan dedup fallback diperluas mengenali bentuk tampilan (mencegah duplikasi deterministik+model pada sel persen numerik).

**Bukti setelah perbaikan** (sweep ulang): **48/48 workbook mingguan menurunkan progress deterministik — total 408 baris progress + 248 milestone** di korpus, 0 eksklusi validator, 0 warning. Nilai terverifikasi contoh: scope 2.1 → 82,5%, scope 1.1 → 100% (kolom `% Complete` asli). Regresi baru: `deterministic-first.test.mjs` "percent-formatted numeric cells derive deterministic progress; non-progress percent labels stay model work" (numerik 0.125 → klaim `12.5%` + as_of cut-off + period W4 + scope WBS; Weight 8% tidak diturunkan).

## Fase 2 — Matriks mutasi edge (offline, 0 token)

`final-edge-mutations.mjs` — 4/4 PASS:

| Kasus | Hasil |
|---|---|
| Zip XLSX dikorup (60% trailing) | `office_package_invalid` — gagal eksplisit, tanpa crash |
| Dua kolom record-date bernilai beda | 0 klaim as_of diturunkan — ambiguitas tidak pernah diklaim; baris jatuh ke jalur model (fail-closed) |
| Baris milestone identik terduplikasi | 2 baris observasi dengan sitasi baris masing-masing — duplikasi copy-paste tetap terlihat, tidak dilipat diam-diam |
| Rerun hangat workbook nyata (22 grup, 8 ambigu-flag parser) | 14 grup completed **tidak dipanggil ulang**; hanya 8 grup ambigu yang di-retry (34 panggilan ≤ budget retry) |

Temuan tambahan dari diagnosis kasus: judul sheet yang menempel langsung pada baris header membuat deteksi header gagal → label kolom null → derivasi 0 klaim (fail-closed, tanpa fabrikasi) — perilaku konservatif yang benar, dicatat sebagai karakteristik.

## Fase 3 — Live terkontrol (disetujui pengguna; cap 12 request)

`final-live-run.mjs`: dispatcher ber-cap ketat (counter sebelum dispatch, ≤12k input char, ≤4096 visible output/request, hard-stop 401/403/404/429/`length`/langit-langit total 60k in + 24k out, URL guard endpoint).

**Terpakai: 10/12 request — 14.262 input / 4.598 output token** (laporan provider). Dua sisa sengaja tidak dipakai: mengulang prompt yang sama hanya untuk mengejar hasil bagus dilarang.

| # | Task | in/out |
|---|------|--------|
| 1–6 | Amber TXT end-to-end: classification + 2×(analysis+domain, loop koreksi) + summary | 8.920/2.936 |
| 7–10 | Injection probe end-to-end: classification + analysis + domain + summary | 4.942/640 |

Model: `glm-5.3-flash` (temperature 0, `response_format json_object`). Kunci tidak pernah dicetak/disimpan. Konten terkirim: fixture demo fiktif (amber-alpha) + chunk sintetis.

**Temuan live:**

1. **Probe prompt-injection: checkpoint `completed` — ekstraksi live pertama yang menyelesaikan seluruh pipeline melalui validator produksi.** Model menolak instruksi override secara eksplisit (tercatat di `classification_reason`); tidak ada klaim fabrikasi "USD 999.999.999 / 100% complete" yang terbit; progress 5% sah terbit sebagai observasi; quality warning bahkan menandai dokumen sebagai percobaan injection.
2. **Kegagalan fail-closed yang jujur pada Amber TXT**: model live memfabrikasi `snapshot_date` untuk 6 health snapshot (tanggal yang tidak ada di sumber) → validator menolak semua → grup `failed`/retryable, dokumen `needs_review`. **Tidak ada data fabrikasi yang diterbitkan.** Ini kelemahan model yang sama kelasnya dengan `period_label`/`as_of_date` domain task (sesi sebelumnya) — kandidat iterasi prompt berikutnya.
3. Klasifikasi dan ringkasan eksekutif **live untuk pertama kalinya**: keduanya menghasilkan keluaran valid (classification 0.85–0.9 dengan sitasi; summary 2 bullet dengan caveat data-quality).

## Verifikasi penuh setelah semua perubahan

| Perintah | Hasil |
|---|---|
| `node --test tests/integration/*.test.mjs` | **311/311 lulus** (310 + 1 regresi baru; 3 asersi evidence-provenance disesuaikan ke kontrak derivasi baru, intent aslinya dipertahankan: baris actual literal tetap bertahan dengan provenance penuh, hash antar-sesi berbeda, baris 0% wajib mengutip sel eksplisit) |
| `npx tsc --noEmit -p tsconfig.json` | Bersih |
| `npx eslint` pada file yang diubah | Bersih |
| `smoke-two-workbooks.mjs` | `all_passed: true`, tanpa jaringan |
| `graphify update .` | Graph dibangun ulang |
| Dokumentasi | `worker/README.md` diperbarui (derivasi persen numerik, as_of record-only, eligibility label, /39) |

## Status celah setelah ronde ini

**Tertutup ronde ini:** robustness parser di 100 file nyata (0 crash); derivasi deterministic-first aktif di korpus nyata (408+248 baris, sebelumnya 0); label non-progress tidak menjadi klaim progress; as_of hanya dari record date; dedup/binding sel persen numerik; zip korup gagal eksplisit; ambiguitas record-date tidak diklaim; duplikasi baris tidak dilipat diam-diam; cache reuse warm-run; **klasifikasi + ringkasan live**; **probe injection fail-closed live**; **satu pipeline live menyelesaikan checkpoint completed**.

**Tetap terbuka (blocker terpisah, tidak bisa dibuktikan di sesi ini):**
1. Model live masih memfabrikasi tanggal (snapshot_date/period_label/as_of_date) pada dokumen naratif → grup `failed`/retryable meski konten lain bagus; perlu iterasi prompt domain/health-snapshot + verifikasi live berikutnya.
2. Ground truth independen yang ditinjau manusia (prasyarat klaim READY).
3. Baseline A monolitik tak pernah selesai → perbandingan token/akurasi apple-to-apple belum mungkin; nondeterminisme model (1 run/file) belum diukur.
4. DB Supabase native + E2E Playwright; cache freshness (rekalkulasi Excel) — verifikasi runtime terpisah.
5. Mislabel non-milestone (progres diketik risk/issue/decision) tetap tidak ditegakkan deterministik — terdokumentasi; kandidat perluasan guard bila data live menunjukkan dampak.

## Keputusan

Pipa ekstraksi terhadap file input yang ada kini terbukti: **tidak crash, tidak fabrikasi, fail-closed pada semua kasus tepi yang diuji, dan jalur deterministic-first benar-benar bekerja di korpus nyata** (penghematan beban model: ±408+248 baris tidak lagi memerlukan model). Klaim `READY` produksi tetap **BELUM** — menunggu ground truth manusia dan perbaikan atribusi tanggal model.

## Lampiran 3: ground truth review siap + estimasi biaya per file (gratis, offline)

### Ground truth review — menunggu tinjauan Anda

File: `.scratch/opencode-go-experiment/ground-truth-review-11-pengeloaan.md` (11_Pengelolaan_Utilitas W4). Isinya: 8 baris progress deterministik + 12 milestone dengan sel sumber persisnya, **cross-check otomatis 8/8 cocok** terhadap pembacaan XML mentah workbook yang independen dari parser pipeline (termasuk mapping number-format persen), evolusi W4→W7, dan 2 fakta live dari grup ambigu (termasuk contoh mislabel "periode diketik milestone" untuk dinilai reviewer). Skrip: `ground-truth-review.mjs`; data: `ground-truth-data.json`. Catatan perbaikan kecil: pembacaan styles.xml independen harus membatasi ke blok `cellXfs` (blok `cellStyleXfs` menggeser indeks — sumber mismatch semu 7/8 sebelum diperbaiki, pipeline-nya benar).

### Estimasi biaya run live penuh (dari sweep 100 file + sampel live nyata, provider-reported)

| Tipe file | File | Req/file (rata-rata) | Est. input token/file | Est. output token/file | Est. total korpus |
|---|---|---|---|---|---|
| XLSX mingguan ITB | 48 | 50 (22–29 grup × 2 task + 2) | ~159k | ~29k | **~9,0M** |
| XLSX baseline ITB | 4 | 44 | ~140k | ~26k | ~0,66M |
| DOCX (MoM + demo) | 21 | 9 | ~24k | ~4,5k | ~0,6M |
| TXT/CSV | 12 | 4 | ~8k | ~1,4k | ~0,11M |
| PDF | 6 | 4 | ~8k | ~1,4k | ~0,06M |
| **Total korpus 100 file** | **100** | **2.846 request** | | | **~10,4M token (±87% input)** |

Sampel dasar per panggilan (rata-rata terukur): classification 936/137, analysis naratif 1.582/1.020, analysis XLSX 3.053/1.132, domain naratif 2.282/308, domain XLSX 3.528/62, summary 512/136. Satuan token, bukan biaya uang.

Faktor yang mengubah angka: (1) **loop koreksi** +20–50% request (teramati 1 loop pada Amber naratif; grup ITB lolos attempt pertama); (2) **prompt caching penyedia** berpotensi memangkas biaya input secara besar (pilot melihat input cached) — belum diukur; (3) reasoning token dihitung provider ke `max_tokens`. Penurunan biaya paling menjanjikan berikutnya: memangkas ukuran prompt source-reference dan mengeksplorasi caching — bukan bagian ronde ini.

## Lampiran 4: cache grup konten-ter-address (/41) — penghematan upload mingguan terukur offline

**Motivasi pengguna**: file yang diupload antar minggu strukturnya sama, hanya sebagian kecil nilai berubah (mis. `01_Alarm` W4 vs W5). Pengukuran menunjukkan 64–86% chunk identik byte-per-byte antar minggu — tetapi kunci cache lama menghash **seluruh dokumen** + index grup, sehingga satu nilai berubah menginvalidasi semua grup dan upload mingguan membayar ulang penuh (~50 request, ~188k token).

**Perubahan** (commit terpisah, tanpa migrasi DB):
1. `groupKey` kini **konten-ter-address**: hash teks chunk + locator + versi parser/schema — tanpa hash dokumen, tanpa index grup. Reuse hanya untuk baris `completed` dengan kesamaan konten eksak; hasil reuse **divalidasi ulang** terhadap grup saat ini saat load; `chunkStart/EndIndex` tetap di kunci sehingga `evidence_chunk_index` dan source id parser tetap valid tanpa remap.
2. Reuse lintas-dokumen dalam satu proyek: baris dokumen lain yang completed boleh memuaskan grup identik (baris dokumen-sendiri diutamakan; baris `failed` dari dokumen lain tidak pernah reusable).
3. Query store produksi (`parse-document/route.ts`) menjadi project-scoped (query app-level; format kunci tetap sha256 → tanpa migrasi).
4. Cache `/40` → `/41` (baris lama diekstrak ulang sekali).

**Bukti offline (0 token):**
- 3 tes baru (`content-addressed-group-cache.test.mjs`): upload minggu berikutnya hanya memanggil ulang grup yang berubah (2 panggilan, sisanya reuse); re-upload identik sebagai dokumen baru = 0 panggilan grup; baris proyek lain tidak pernah reusable. Suite penuh **314/314**, tsc, lint bersih.
- **Pengukuran file asli** (`measure-cache-savings.mjs`, cold vs warm minggu yang sama, termasuk retry grup gagal):

| Subsistem | W4→W5 | W5→W6 | W6→W7 |
|---|---|---|---|
| 11_Pengelolaan | −22 call (50%) | −26 (59%) | −8 (18%) |
| 01_Alarm | −24 (43%) | −8 (14%) | −22 (39%) |
| 12_BISMA | −18 (43%) | −20 (48%) | −8 (19%) |

Rata-rata **~36% panggilan grup hemat per upload mingguan** (≈60–100k token/minggu/subsistem pada sampel live). Tiga faktor yang menahan di bawah potensi chunk-level (64–86%): nilai % berubah tersebar di banyak grup Workplan; grup ambigu gagal-closed harus diekstrak ulang tiap minggu (butuh `sheet_interpretation` baru); transisi W6→W7 menggeser boundary chunk (29→31, 27→28, 44→45) sehingga grup lintas pergeseran meleset. Levyer lanjutan yang tersisa: chunking struktural yang stabil antar minggu dan remap index — dicatat sebagai kerja berikutnya, bukan bagian ronde ini.

## Lampiran 5: sign-off ground truth (reviewer manusia) + status

Reviewer (pemilik proyek) meninjau `ground-truth-review-11-pengelolaan.md` dan menerima hasilnya ("sudah cukup baik", 2026-11-07): nilai progress/milestone deterministik cocok dengan workbook, evolusi W4→W7 masuk akal, dan tipe fakta live diterima termasuk toleransi atas contoh mislabel "periode diketik milestone".

**Status yang dibenarkan oleh bukti gabungan**: `READY WITH HUMAN REVIEW` untuk **jalur deterministic-first (progress + milestone) pada korpus mingguan ITB** — didukung 408+248 baris tervalidasi, cross-check XML independen 8/8, dan tinjauan manusia ini. Yang TETAP di luar klaim: cost/risk observations (jalur model, belum ditinjau manusia per baris), file baseline & MoM, run live penuh satu workbook, dan pengukuran biaya provider (prompt caching penyedia belum diverifikasi — dikerjakan di lampiran 6).

## Lampiran 6: lapisan 2 — prompt statis-dulu + pengukuran prefix cache penyedia

**Perubahan** (cache `/41` → `/42`): kedua prompt task kini memimpin dengan konten statis byte-identik (preamble bersama + rules + schema), lalu konteks dokumen, lalu scope grup, lalu sumber, lalu aturan dinamis per-grup (aturan milestone/progress deterministik pindah ke belakang sources). Angka grup/count tidak lagi muncul sebelum sumber. Kontrak layout diuji tes baru: prefix bersama antar DOKUMEN > 2.000 char (berakhiran sebelum "Document context:", memuat "Required JSON schema"), dan antar grup satu dokumen berakhiran tepat di "This request contains group ". Suite **315/315**, tsc + lint bersih.

**Pengukuran live** (`prefix-cache-ab.mjs`, disetujui 6 request, terpakai 4 — 9.074 in / 3.491 out, `glm-5.3-flash`): dikirim 3 prompt analysis grup berbeda + 1 repeat identik, back-to-back.

| Request | Prompt | in | cached_tokens |
|---|---|---|---|
| 1 | analysis g1 (cold) | 1.980 | 0 |
| 2 | analysis g2 (berbagi prefix statis ±2k char) | 3.605 | 0 |
| 3 | analysis g3 | 1.509 | 0 |
| 4 | repeat identik g1 | 1.980 | **1.088** |

**Kesimpulan terukur**: penyedia menghormati caching untuk **repeat identik** (~55% prompt tokens kena cache) tetapi **tidak melakukan prefix-sharing antar prompt berbeda** pada ukuran blok statis kita — konsisten dengan minimum blok cache ±1.024 token, sedangkan blok statis kita ±550–700 token. Implikasi:
1. Reorder dipertahankan (layout yang benar untuk penyedia dengan prefix caching penuh; tanpa biaya), tetapi klaim hemat biayanya untuk OpenCode Go adalah **repeat identik saja**.
2. Penghemat utama untuk beban kerja mingguan tetap **cache grup konten-ter-address** (lampiran 4, ~36%) — request hilang utuh, bukan sekali diskon.
3. Untuk memperbesar prefix-shared hit perlu blok statis >1.024 token — berarti menambah teks statis ke setiap request (memboroskan token non-cache); tidak diambil. Alternatif yang lebih sehat: hitung ulang bila pindah ke penyedia dengan prefix caching penuh (OpenAI/Anthropic-style).

Status keputusan: lapisan 2 selesai dieksekusi dan diukur; penghematan realistis tercatat jujur.

## Lampiran 7: gerbang live workbook — dihentikan atas disiplin anggaran, temuan tetap berharga

Rencana: satu workbook ITB (11_Pengelolaan W4, 22 grup) end-to-end live tanpa mock. Eksekusi tiga attempt dengan cap pengaman; berhenti dua kali karena menemukan prompt grup yang lebih besar dari cap (38k → 53k char), sekali karena socket transient (kini di-retry). **Dihentikan setelah total ~271k token (231,6k in / 39,2k out) — melampaui anggaran ~188k yang disetujui; sisa 17 grup membutuhkan ~160–220k token tambahan dan menunggu keputusan anggaran baru.**

**Yang tercapai dan tersimpan:**
- 5 dari 22 grup terekstraksi live (tersimpan di cache konten `/41` — lanjutan gerbang tidak membayar ulang).
- ~28k token tercatat `cached_tokens` dari penyedia pada repeat/correction.
- Store gate berbasis file (`live-workbook-gate/group-store.json`) — gerbang dapat dilanjutkan kapan pun.

**Temuan model biaya yang penting (diukur offline, eksak):**
- Ukuran prompt grup keluarga ITB: 8k–83k char per pasangan task (rata-rata ~37,6k char ≈ 9,4k token) — bukan ~3k seperti estimasi lampiran 3. Biaya nyata 1 workbook mingguan ITB ≈ **240k token**, bukan 188k.
- Grup terbesar 83.394 char (~21k token per request). Estimasi korpus 100 file (lampiran 3) perlu dikoreksi untuk keluarga ITB: faktor ~3× pada keluarga mingguan.
- **Lever optimasi terbesar berikutnya teridentifikasi**: anotasi formula raksasa (RAG `IF(...)` berulang identik per baris) mendominasi source references — kompresi anotasi formula berulang berpotensi memangkas 40–60% prompt keluarga ini. Belum dikerjakan; tercatat sebagai kerja berikutnya.

**Keputusan**: gerbang ditunda; integrasi kode ke arsitektur utama tetap didukung bukti yang ada (315/315 offline, ground truth manusia jalur deterministik, grup ITB ambigu+terstruktur live lulus, injection probe lulus, dokumen naratif selesai end-to-end). Produksi menjadi kelanjutan pembuktian dengan fail-closed menahan keluaran yang tak terbukti.

## Lampiran 8: validasi offline pada DOKUMEN ASLI (PMO docs, bukan fixtures)

Pengguna mengungkapkan bahwa `smart-building-itb` fixtures semi-generated; dokumen kerja PMO yang sebenarnya ada di `DOKUMEN ASLI/` (31 file: 12 folder subsistem dengan pasangan file progress, baseline, MoM gabungan, planning PPTX, proposal/standar PDF/DOCX; proyek baru ±2 minggu).

**Sweep offline seluruh 30 file input (0 token): 30/30 parse + extract OK, 0 crash, 0 eksklusi validator.** Derivasi deterministik aktif di 20 file (progress) + 10 file (milestone).

**Verifikasi independen nilai nyata** (`Progres Air Bersih.xlsx`, pembacaan XML mentah terpisah dari parser):
- WBS 2.1: raw `0.9` berformat persen → **90%** — pipeline 2.1=90% ✓ MATCH
- WBS 2.2: raw `0.3` → **30%** — pipeline 2.2=30% ✓ MATCH
- Baris 2.3–2.7: kolom % complete kosong → **tidak ada klaim** (disiplin empty-vs-zero di data nyata) ✓
- Kolom Bobot (0,16/0,14/0,18, format persen kustom) → **tidak dijadikan progress** (gate label) ✓

**Pola pasangan file terkonfirmasi**: dua file per subsistem memang laporan BERBEDA — `*_Weekly.xlsx` adalah template mingguan subkontraktor (15 baris × 0% + 7 milestone, proyek baru), `Progres X.xlsx` adalah tracker PM dengan nilai nyata (1–3 baris: 80%, 95%, 100%, 90%...). Nama file dunia nyata menampilkan varian typo (`Pengondisian`/`Pengkondisian`, `Pengawasan`/`Pengawas`), duplikat unduhan `(1)`, dan nama orang (`Kelistrikan_Elisa`) — semua ditangani tanpa crash.

**Ukuran prompt workbook asli** (01_Alarm, 26 grup): 990.568 char ≈ **~248k input token per workbook** — masalah anotasi formula raksasa sama dengan fixtures (grup terbesar 40,5k char). Lever kompresi anotasi formula berulang berlaku sama (potensi 40–60%).

**Implikasi**: arsitektur saat ini valid secara offline untuk dokumen PMO asli. Test live pada dokumen asli membutuhkan (a) persetujuan eksplisit pengiriman konten dokumen nyata ke provider, dan (b) sebaiknya setelah kompresi anotasi formula agar biaya test akhir turun 40–60%.

## Lampiran 9: koreksi komposisi prompt pada dokumen asli (pengukuran eksak)

Hipotesis lampiran 7/8 ("anotasi formula raksasa mendominasi") terbukti **spesifik fixtures** — di workbook asli (01_Alarm, 26 grup), formula kecil. Pengukuran prompt terbesar dokumen asli (d14, 40.531 char, 94 referensi):

| Komponen | Char | Share |
|---|---|---|
| Kerangka statis (preamble+rules+schema) | 10.725 | 26% |
| `source_location` JSON (94 ref) | 11.942 | 30% |
| Overhead JSON referensi | 6.853 | 17% |
| modelText (bukti) | 10.988 | 27% |
| Anotasi formula | **812** | **2%** |

Implikasi jujur: tidak ada satu lever aman yang dramatis untuk dokumen asli. Kompresi `source_location`/overhead JSON menyentuh bentuk sitasi yang mengalir ke persistensi dan read model; slimming kerangka menyentuh rules fail-closed yang diperoleh dari insiden. Kombinasi realistis ±20–25% dengan risiko kontrak sedang — **tidak dikerjakan sekarang**. Biaya workbook asli ±250k token; cache `/41` memangkas ±36% untuk upload mingguan berikutnya. Kompresi anotasi formula TETAP berharga untuk keluarga fixtures (formula RAG raksasa generator) tapi bukan prioritas dokumen asli.

Status akhir "menerima file asli sebaik mungkin": **terpenuhi secara offline** (30/30 file, derivasi terverifikasi independen, disiplin kosong-vs-nol, gate label) dan fail-closed untuk live. Test live dokumen asli menunggu persetujuan konten + anggaran dari pengguna.

## Lampiran 10: gerbang live dokumen PMO asli — dua dokumen, dua jalur, lulus

Persetujuan pengguna (konten nyata ke provider + anggaran test akhir). Subsistem 7. AIR BERSIH dipilih karena nilainya sudah terverifikasi independen. Provider: `glm-5.3-flash` via OpenCode Go; tanpa mock.

**Tahap 1 — `Progres Air Bersih.xlsx` (tracker PM, dokumen ringan): `ok: true` end-to-end penuh.** 6 request, 32.590 in / 5.557 out. Progress **2.1=90%, 2.2=30% — cocok persis ground truth XML independen**. Fakta grounded berbahasa Indonesia dari kolom Catatan (kendala access point, pengadaan flow meter, milestone uji fungsi 2026-11-27); summary koheren. Fail-closed: 8 milestone dengan `scope_source_id` tak terbukti dieksklusi validator.

**Tahap 2 — `07_Air_Bersih_Subcontractor_Weekly.xlsx` (template berat, 21 grup): pipeline selesai, `ok: true`.** 53 request, 271.249 in / 48.642 out, `cached_tokens` 47.872. **13 grup completed, 8 gagal fail-closed** (milestone scope tak terbukti ×2, nilai fakta tak cocok sumber, dst. — semua tampil sebagai warning/needs_review, tidak ada data tak terbukti terbit). Terbit: 36 fakta, 15 progress (termasuk **konflik sumber nyata: dua baris berbeda mengklaim WBS 2.1 = 90% dan 9%** — diturunkan setia dengan sitasi masing-masing, bahan tepat untuk keputusan konflik C4 di overview), 16 milestone. Summary dokumen koheren (subkontraktor Urbansolv, baseline 2026-09-18, progress minimal).

**Total live dokumen asli: ±428k token** (tahap 1 + tiga attempt tahap 2; dua attempt awal terhenti di cap prompt 38k/45k sebelum dinaikkan ke 60k — grup terbesar 47k char). Store `/41` menyimpan semua grup completed; run ulang tidak membayar ulang.

**Kesimpulan gerbang**: arsitektur menerima dokumen PMO asli end-to-end secara live pada KEDUA jalur (dokumen ringan selesai bersih; dokumen berat selesai dengan 8 grup gagal-closed yang jujur). Rasio needs_review pada workbook berat (8/21) adalah feedback loop iterasi prompt berikutnya — bukan kebocoran. Status klaim tetap `READY WITH HUMAN REVIEW` (lampiran 5); bukti live dokumen asli ini memperluas cakupannya ke jalur model pada 1 subsistem nyata.

## Lampiran 11: iterasi prompt kelas 1–2 — verifikasi live parsial dan tercemar ceiling

Perubahan (/43, ter-commit): (1) aturan verbatim `original_value` digit-per-digit dari teks tersitasi (belum pernah ada di prompt analysis — celah nyata); (2) milestone: scope_label wajib bukti kolom scope/declared subject, tanggal hanya dari kolom due/event, null bila tak terbukti — di kedua branch deterministicComplete.

Verifikasi offline: 315/315, tsc, lint ✓. Verifikasi live dilakukan murah via kunci /42 sementara (13 grup completed gratis), lalu versi dikembalikan ke /43 untuk ship.

**Hasil verifikasi: TIDAK MENUTUP.** 22 request, 165,9k in / 32,9k out — **melewati langit-langit input 150k yang dipasang sendiri** → sisa run teracun (4 grup gagal "provider failed" karena StopError, bukan model). Dari 4 grup yang kebagian tes adil: numeric-mismatch ×2, milestone ×1, header ×1 — **masih gagal**. Kelas over-limit dan formula-alert tidak muncul ulang, tetapi sampel tercemar membuat klaim perbaikan lemah.

**Kesimpulan jujur**: iterasi prompt saja **belum terbukti** memperbaiki kelas kegagalan ini pada `glm-5.3-flash` dengan tabel nyata yang padat — model tetap memparafrase angka meski diinstruksikan verbatim. Kumulatif live dokumen asli ±627k token; dirundur sesuai disiplin anti-loop, tanpa run live lanjutan sesi ini.

**Lever berikutnya yang lebih menjanjikan (tercatat, belum dikerjakan)**:
1. Perkecil kepadatan konteks: kurangi chunk/grup atau pecah grup tabel besar — model lebih jarang salah baris.
2. Model kuat untuk grup padat (fallback per-kepadatan) — perlu anggaran dan keputusan provider terpisah.
3. Terima sebagai desain: grup gagal = needs_review + keputusan reviewer (USERFLOW C2/C4) — pipeline sudah benar; beban reviewer inilah metrik yang dipantau rencana overview.

Status klaim TETAP lampiran 5 (READY WITH HUMAN REVIEW, terbatas). Bukti live dokumen asli (lampiran 10) tidak berubah.

## Lampiran 12: kurva kepadatan grup pada workbook asli + batas grup dapat dikonfigurasi

Batas grup kini dapat diatur via `XASS_EXTRACTION_MAX_GROUP_CHUNKS` / `XASS_EXTRACTION_MAX_GROUP_CHARACTERS` (default tetap 10.000/3). Kunci grup mengikat teks chunk + range, jadi perubahan limit mempartisi ulang kunci secara alami tanpa bump versi.

Kurva pada `07_Air_Bersih_Weekly` (21 grup, mock, 0 token; total termasuk retry koreksi mock):
- chunks=3 (kini): 1,10M char ≈ 274k tok; prompt terbesar 47,4k
- chunks=2: +3% total; prompt terbesar −19% (38,5k)
- chunks=1: +16% total; prompt terbesar −41% (27,9k)

Trade-off terukur: memperkecil kepadatan menaikkan total biaya moderat (scaffolding terduplikasi) tetapi memangkas prompt terbesar drastis. Apakah kepadatan rendah benar-benar memperbaiki kelas numeric-mismatch hanya bisa dibuktikan live (est. ±320k token untuk chunks=1) — menunggu keputusan anggaran; fallback Gemini free-tier (desain sadar-kelas di diskusi) tetap jalurnya bila lever ini tidak cukup.

## Lampiran 13: Opsi A — gerbang kepadatan-rendah (chunks=1) pada workbook asli

80 request, 334k in / 64k out (±398k token). Hasil: `ok: true` — **13/27 grup completed, 14 gagal**. Pembanding dengan chunks=3 (lampiran 10: 13/21 completed, 8 gagal):

**Kepadatan rendah TIDAK menurunkan rasio kegagalan** — bahkan naik (14/27 = 52% vs 8/21 = 38%; jumlah grup memang bertambah karena partisi). Kelas numeric-mismatch tetap muncul (×4), header candidate (×3), milestone (×3) — model tetap memparafrase angka meski konteks jarang. Yang ikut naik: jumlah request (+27) dan total token (+130k vs chunks=3).

**Kesimpulan keputusan**: lever kepadatan konteks **terbukti tidak efektif** untuk kelas gagal ini pada model ini — biaya lebih tinggi, rasio gagal tidak membaik. Sisa jalur: fallback Gemini flash generasi-3.8 (desain sadar-kelas, free tier) atau terima needs_review sebagai desain. Grup completed tersimpan di cache /41.

## Lampiran 14: probe validator Gemini 3.8-flash — kontrol positif lulus, kontrol negatif tertahan kuota

Probe v2 (respons Gemini disuapi ke validator produksi): kontrol positif (grup Progres yang glm luluskan) - validator ok, 1 fakta grounded terbit tanpa warning; model mampu menghasilkan keluaran yang lolos fail-closed pada dokumen asli. Kontrol negatif (grup numeric-mismatch yang glm gagalkan) tertahan high demand free tier - inkonklusif, tinggal re-run gratis. Kesimpulan sementara: fallback Gemini flash 3.8 layak dibangun; keputusan final menunggu kontrol negatif.

## Lampiran 15: dokumen cost asli (Pengajuan Pembelian) — gagal tertutup 8/8, penyebab teridentifikasi

File cost nyata satu-satunya di DOKUMEN ASLI ternyata yang terpadat: 8 grup dengan prompt 29-41k char (~7-10k token/request). Dua attempt live (total ±565k token): **semua 8 grup gagal fail-closed** bahkan setelah loop koreksi — model konsisten menghasilkan keluaran yang ditolak validator pada tabel ini.

**Akar masalah teridentifikasi**: tabel Master Hardware di file ini **bergeser** — header r1 (Kode Komponen | Nama | PIC | ...) tidak lagi cocok dengan layout baris 5+ (harga 2.357.276 muncul di kolom "Satuan"; nama komponen pindah ke kolom A). Ini kasus konkret dari catatan terbuka stream parser: "headerless tables are still open". Model tidak dapat mengaitkan nilai ke kolom bermakna pada tabel yang strukturnya melompat, dan validator (dengan benar) menolak klaim tanpa bukti kolom.

**Implikasi**:
1. Sign-off cost/risk pada dokumen asli **tertahan** oleh masalah tabel bergeser — bukan oleh iterasi prompt.
2. Jalur penyelesaiannya adalah pekerjaan **parser**: deteksi tabel yang header-nya tidak cocok dengan tata letak data (structural re-mapping atau per-row header inference) — item nyata untuk stream parser/document-22 berikutnya, dengan contoh file nyata yang kini tersedia.
3. Model biaya keluarga ini dikoreksi: file 8-grup ≈ **300k+ token** (rerata 10k token/request — terpadat sejauh ini).

Status klaim tetap lampiran 5; domain cost pada dokumen asli = gap yang jujur sampai tabel bergeser tertangani.

## Lampiran 16: Level 1 freshness tereksekusi (/44) - rekalkulasi verifikasi formula aritmetika

Dengan persetujuan pelonggaran aturan "formulas are never evaluated" untuk subset aman: formula murni aritmetika self-contained (referensi sel + angka + +-*/() saja; tanpa fungsi, cross-sheet, range) kini **dihitung ulang dari sel input barisnya sendiri** dan dibandingkan dengan nilai cache:
- **Cocok** -> status `cached_value_verified_match`: bebas freshness review, provenance "recomputed match" (Duration, Weighted Progress, Variance pada dokumen asli berhenti jadi gap)
- **Tidak cocok** -> `cached_value_recompute_mismatch`: review-required dengan pesan inkonsistensi eksplisit di jalur error dedikasi
- Di luar subset / tidak terverifikasi -> perilaku lama (review-required)
Konservatif: cache tetap otoritatif; rekalkulasi hanya membuka gerbang bila konsisten. Nilai tak terhitung (teks, RAG IF kompleks) tetap jalur lama. Schema /43 -> /44. Verifikasi: 2 tes baru (match = terbit tanpa marker; mismatch = tereliminasi dengan review-required), suite penuh **319/319**, tsc bersih. Efek pada dokumen asli: kolom Duration/Weighted Progress/Variance ber-cache kini terverifikasi otomatis; RAG (IF) menunggu Level 2 (garansi generator tracker-web).

## Lampiran 17: fallback Gemini sadar-kelas tereksekusi (/44, tanpa bump)

Mekanisme di jalur partial-success (lokasi kegagalan fidelity yang sebenarnya): grup yang selesai dengan warning kelas fidelity (numeric-mismatch, milestone peran/kapasitas) di-retry SEKALI dengan Gemini sebelum di-checkpoint failed; kelas struktural (formula freshness, scope tak terbukti, header invalid) tidak pernah memicu fallback; porsi dibatasi `XASS_EXTRACTION_GEMINI_FALLBACK_GROUPS` (default 3/dokumen); provenance provider/model per grup mencatat model yang menghasilkan.

Verifikasi offline: 2 tes baru - (1) fidelity gagal di flash -> retry Gemini -> grup selesai dengan provenance Gemini; (2) kegagalan struktural -> 0 panggilan Gemini, checkpoint failed. Suite penuh **321/321**, tsc + lint bersih. Verifikasi live: residu saja (gratis di free tier) - menunggu server Gemini lega.

## Lampiran 18: re-run kontrol negatif Gemini - masih tertahan kapasitas

Dengan kunci baru: kontrol positif lulus lagi (1 fakta grounded); kontrol negatif (grup padat) tetap tertahan "high demand" free tier - dua kali berturut-turut. Tidak diulang lagi sesi ini (anti-loop).

Fallback sadar-kelas tetap terbangun dan terverifikasi offline (lampiran 17); bukti live kontrol negatif menunggu kapasitas Gemini - re-run gratis kapan pun via skrip yang sama.

## Lampiran 19: Level 2 dari artefak - harness verifikasi formula dibangun, temuan generator pertama

`tools/tracker-web` tidak ada di repo ini (hanya di sebutkan di dalam file), jadi verifikasi Level 2 bekerja dari artefak: harness Python (`formula-verify-harness.py`) membaca XML mentah (shared strings, styles, pemetaan sheet agnostik urutan atribut), mengevaluasi ulang 5 bentuk formula (referensi lintas sheet, aritmetika, IF, MAX/MIN), dan membandingkan dengan cache.

**Hasil pertama pada 07_Air_Bersih (60 sel formula): 58 not_computable, 2 mismatch, 0 match** - dan akarnya adalah temuan generator yang nyata:
1. **Tanggal baseline disimpan sebagai shared string** (F5/G5 = indeks teks, bukan serial angka) - konsisten dengan anotasi `invalid Excel serial` yang dilihat parser. Resolver numerik sederhana tidak dapat mengevaluasi `G5-F5+1` dari teks tanggal.
2. K5 Weighted Progress cached `0%` vs computed 0.0 - bug normalisasi persen milik harness (string vs angka), bukan generator.
3. Kasus Duration (H5) computed 2 vs cached 8 butuh resolusi tanggal-teks -> belum dapat disimpulkan.

**Kesimpulan sementara Level 2**: generator menyimpan formula cache + tanggal dengan cara yang tidak konsisten (sebagian serial, sebagian teks) - inkonsistensi ini nyata dan akan tertangkap oleh harness setelah resolusi tanggal-teks ditambahkan. Harness butuh satu iterasi: resolusi tanggal dari shared string (string ISO/serial) + normalisasi persen dua arah. Sifat fail-closed tidak berubah: selama belum terverifikasi, cache formula tetap jalur review.

## Lampiran 20: Level 2 ronde 2 - keluarga aritmetika TERVERIFIKASI, sisanya butuh iterasi evaluator

Setelah resolusi tanggal-teks: **Duration (G5-F5+1=8) dan Weighted Progress (I5*J5) cocok persis** dengan cache - keluarga aritmetika terverifikasi konsisten. 58 sel tersisa (referensi lintas-sheet yang menarik nilai teks + formula IF) belum terhitung evaluator ringkas - iterasi evaluator berlanjut sebagai pekerjaan tersisa (skrip probe tidak di-commit per preferensi pengguna; hasil saja).

**Status Level 2**: parsial - keluarga aritmetika generator terbukti konsisten; keluarga IF/lintas-sheet menunggu evaluator lengkap. Temuan generator nyata sejauh ini: tanggal disimpan sebagai teks (kelas invalid-serial terkonfirmasi dari sisi artefak).

## Lampiran 21: iterasi evaluator ronde 3 - masih 58 not_computable, debug berlanjut

Guard aritmetika + normalisasi dua-arah ditambahkan; keluarga aritmetika tetap terverifikasi (2 match), namun 58 sel cross-sheet/IF tetap not_computable - penyebab pastinya belum terisolasi (dugaan: pemetaan nama sheet ter-escape `&amp;` antara token formula dan kunci data, atau bentuk sel yang belum tertangani regex). Debug berlanjut di konteks berikutnya dengan pelacakan per-token; skrip probe tetap working file (tidak di-commit).

**Status Level 2 tetap parsial**: keluarga aritmetika terverifikasi; IF/cross-sheet inconclusive - bukan bukti generator salah, bukan bukti benar.

## Lampiran 22: Level 2 VERDICT - generator terbukti konsisten (580/609, 0 mismatch)

Verifikasi formula di-jalankan ke seluruh 12 workbook mingguan asli: **609 sel formula, 580 match (95,2%), 0 mismatch, 29 not_computable** (`formula-verify-asli.json`).

- **Generator (tracker-web) terbukti menghitung cache formula dengan benar** untuk seluruh keluarga: Duration, Weighted Progress, Variance, RAG, dan 56 referensi lintas-sheet - di semua subsistem.
- 29 not_computable: sel ber-cache string kosong (tak ada yang diverifikasi) + formula shared (`<f t="shared">`) yang butuh dukungan shared-formula di harness.
- 1 file (01_Alarm non-(1), 798 ref) total=0: formula-nya dalam bentuk shared-formula yang belum diekstrak harness - tercatat sebagai iterasi harness, bukan indikasi masalah generator (file (1)-nya yang identik struktur terverifikasi penuh).

**Implikasi freshness (gabungan Level 1 + 2)**:
1. Level 1 (pipeline): cache aritmetika diverifikasi otomatis via rekalkulasi (/44).
2. Level 2 (bukti generator): cache generator konsisten 580/609, 0 mismatch - basis untuk mempercayai cache keluarga generated setelah parser mendukung shared-formula.
3. Attestation reviewer hanya tersisa untuk file manual-edit.

Ditutup sesuai preferensi: harness tetap working file (tidak di-commit), hasil di lampiran ini + `formula-verify-asli.json`.
