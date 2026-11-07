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
