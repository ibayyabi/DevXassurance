# Laporan: keamanan semantik fakta milestone-progress (semantic-safety-execution-plan.md)

Tanggal: 2026-11-07. Eksekutor: GLM 5.3 Flash via Zcode. Semua pekerjaan offline; **nol request LLM live** pada sesi ini. Anggaran empat request sebelumnya tetap habis dan tidak dijamah.

## Keputusan kesiapan

**NOT READY untuk klaim siap produksi / end-to-end.** Regresi offline untuk cacat semantik yang dilaporkan sudah selesai dan lulus; dua request live sintetis (disetujui pengguna) menunjukkan model tidak lagi mengetik persentase progres sebagai milestone dan validator tetap menahan baris observasi yang lemah secara fail-closed. Yang belum ada: evaluasi ground truth yang ditinjau manusia, uji live klasifikasi/ringkasan, dan pengukuran token vs baseline — lihat bagian Gerbang uji live dan Keputusan kesiapan (setelah live).

## Gap yang dibuktikan sebelum perbaikan

`citedProgressPercentSemanticsError()` yang ada hanya melindungi jalur **domain evidence** (baris progress observation). Jalur **facts** tidak punya guard semantik: probe offline (`probe-milestone-fact-semantics.mjs`) mereplay respons sintetis tersimpan dari `.local-evaluation/production-live-diagnostic/response-1.json` melalui seam produksi `extractDocumentGroups` dengan mock provider, dan sebelum perbaikan menghasilkan:

- `fact_type: "milestone"` untuk `"Progress pekerjaan: 5%"` **diterbitkan sebagai fakta tervalidasi**, tanpa warning, checkpoint `completed`, dan dapat dipakai ulang dari cache.

Ini persis cacat yang dilaporkan di `report-validation-next.md`, masih ada di working tree saat ini.

## Perubahan

Semua di `worker/src/services/document-extraction.ts` kecuali yang disebut:

1. **Guard semantik fakta (baru).** `milestoneFactClaimIsPureProgressStatement()` menolak fakta `fact_type: "milestone"` yang klaimnya tidak lain adalah pernyataan persentase progres. Aturannya konservatif dan provabel:
   - Persentase pada klaim harus terhubung ke wording progres eksplisit dengan **bukti linkage yang sama** dengan validator progress-observation (`narrativePercentLinksToProgressWording()`, direfaktor dari `narrativeProgressPercentIsSourceLinked()` tanpa mengubah perilakunya — tiga regex linkage dinaikkan ke konstanta modul).
   - Setelah semua token persen dan kosakata skematik progres (progress term/qualifier/connector yang sudah ada, plus kata fungsi gramatikal tertutup: the/a/an/has/have/had/it/its/this/that/these/those/yang/ini/itu/pada/dengan) dihapus, **tidak boleh tersisa huruf apa pun**. Klaim milestone yang menyebut subjeknya sendiri (mis. "Tower crane erection reached 50% complete") tetap diterima; klaim yang tidak dapat dibuktikan salah dibiarkan tanpa diubah.
   - Guard tidak pernah mengubah tipe fakta secara diam-diam dan tidak pernah menghapus konten milestone.
2. **Pemasangan di batas tunggal.** Guard dipasang di loop validasi `facts[]` dalam `validateGroupExtraction` — batas yang dipakai semua jalur (live, koreksi/retry, dan revalidasi cache). Error baris memicu mekanisme fail-closed yang sudah ada: baris dieluarkan + warning → koreksi ke task analysis (pemilik `facts`) → jika model tetap mengembalikannya, checkpoint grup `failed` + `result: null` (tidak reusable) dan dokumen masuk `needs_review` dengan `processing_error` eksplisit.
3. **Versi cache /37 → /38** (`EXTRACTION_SCHEMA_VERSION`) sehingga grup hasil validasi versi lama diekstraksi ulang sekali.
4. **Dokumentasi**: `worker/README.md` paragraf batas verifikasi semantik diperbarui — subkasus yang provabel kini ditegakkan validator; mislabel tipe lain (persentase progres diketik risk/issue/decision/owner_action) belum dapat dibuktikan deterministik dan tetap butuh penilaian reviewer.
5. **Fixture tes yang memuat penerimaan salah disesuaikan** (bukan dipertahankan agar lulus): tiga fakta `milestone` berisi `"Progress: 25%"` di phase6 formula-guard test dan marker `"Progress: 42%"` di evidence-provenance cache test diubah menjadi klaim milestone sah ("Topping off reached 25% complete", "Topping off reached 42% complete") — tujuan aslinya (scoping sitasi formula, staleness cache) tidak berubah.

## Jalur review yang benar-benar teruji (perilaku konsumen, bukan helper)

Dua tes baru di `tests/integration/phase6-document-extraction.test.mjs` melalui `processDocumentJob` (parser + validator + checkpoint + agregasi dokumen nyata, model mock):

- **Jalur koreksi**: percobaan pertama mengirim fakta milestone palsu → guard menolak → koreksi ke analysis task → percobaan kedua mengirim milestone sah (bahasa Indonesia "Milestone: topping off gedung direncanakan 3 Februari 2026" dan Inggris "Tower crane erection reached 50% complete") → dokumen `completed` tanpa warning; fakta risk sah tetap terbit; kedua milestone sah terbit; **persentase yang sama tetap tersedia sebagai progress observation (percent 5)**; checkpoint grup `completed` dan reusable.
- **Jalur penolakan fail-closed**: model terus mengirim dua fakta milestone palsu (ID "Progress pekerjaan: 5%" dan EN "Physical progress has reached 25%") → keduanya dieluarkan dengan pesan `types a progress percentage as a milestone` → `processing_status: "needs_review"`, `processing_error` memuat kedua pesan, tidak ada fakta milestone di hasil, fakta risk sah tetap terbit, checkpoint grup `failed` + `result: null` + `lastError` memuat pesan guard (tidak dapat dihidupkan kembali dari cache sebagai completed).

## Uji dan hasil (perintah aktual)

| Perintah | Hasil |
|---|---|
| `node --test tests/integration/*.test.mjs` | **310/310 lulus** (termasuk 2 tes baru; sebelumnya 308 + 2). Termasuk tes OCR: "available local PP-OCRv6 extracts image and scanned-PDF text with real provenance" — **lulus**, bukan skip. |
| `npx tsc --noEmit -p tsconfig.json` | Bersih (exit 0). |
| `npx eslint` pada 3 file yang diubah | Bersih (exit 0). |
| `node .scratch/opencode-go-experiment/smoke-two-workbooks.mjs` | `all_passed: true`, `network_response_used: false` — dua workbook W7 nyata melalui parser + `extractDocumentGroups` dengan model/jaringan dimock. |
| `node .scratch/opencode-go-experiment/replay-live-diagnostic.mjs` | Lulus dengan **ekspektasi yang disesuaikan**: urutan historis tetap mereproduksi koreksi `period_label` + checkpoint gagal `sheet_interpretation`; pasangan valid kini **tidak lagi** menerima fakta milestone palsu — fakta dieluarkan dengan pesan guard, fakta risk + progress [5] tetap terbit, checkpoint `failed` (tidak reusable). Tidak ada jaringan. |
| `node .scratch/opencode-go-experiment/probe-milestone-fact-semantics.mjs` | Artefak diagnosis: merekam gap sebelum perbaikan dan perilaku baru sesudahnya. Offline. |
| `graphify update .` | Graph dibangun ulang (4232 node, 9847 edge). |

Batas uji: semua mock; tidak ada panggilan provider live; tidak ada dokumen pengguna yang dikirim ke mana pun; fixture bersifat sintetis dan non-sensitif.

## Request/token aktual

**2 request live (sesuai persetujuan), 3.466 input / 1.533 output token** menurut laporan provider (1.368+2.098 in, 904+629 out). Tidak ada retry provider; dua dispatch awal gagal lokal sebelum mencapai provider (0 token) — lihat bagian Gerbang uji live. Empat request historis (6.798 input / 1.877 output token) tercatat di `report-validation-next.md` dan terjadi **sebelum** perubahan prompt/guard. Ledger tidak pernah dihapus atau diubah untuk menghindari batas.

## Gerbang uji live (disetujui pengguna: 2 request, data sintetis)

Setelah persetujuan anggaran baru (2 request), skrip `.scratch/opencode-go-experiment/live-semantic-safety-check.mjs` dijalankan dengan cap yang ditegakkan sebelum dispatch (nol retry, hard-stop pada 401/403/404/429/`finish=length`/visible-cap). Kunci dibaca dari `.env.opencode-go.local`, tidak pernah dicetak atau disimpan. Hanya chunk sintetis yang sudah disetujui sebelumnya yang dikirim.

Catatan integritas anggaran: dua dispatch sebelum run sukses gagal **lokal** (ENOTFOUND — URL capture salah konfigurasi; tidak pernah sampai provider, 0 token, 0 panggilan API). Setelah akar masalah diperbaiki dan guard URL fail-fast lokal ditambahkan, satu run koreksi mengirim tepat **2 request provider** — total panggilan API LLM yang benar-benar terjadi sesi ini: **2 dari 2 disetujui**.

| # | Task | HTTP | in tok | out tok | reasoning | finish | JSON | owned fields |
|---|------|------|--------|---------|-----------|--------|------|--------------|
| 1 | analysis (prompt produksi, dari source asli) | 200 | 1.368 | 904 | 104 | stop | yes | none missing |
| 2 | domain (prompt produksi) | 200 | 2.098 | 629 | 3 | stop | yes | none missing |

Model: `glm-5.3-flash` (OpenCode Go, temperature 0, `response_format json_object`). Usage adalah angka laporan provider, bukan inferensi. Artefak: `.local-evaluation/opencode-go-exp-semantic-safety/live/` (`live-attempts.jsonl`, `response-analysis_task.json`, `response-domain_task.json`, `semantic-summary.json`; git-ignored).

**Temuan semantik live (pertama kalinya setelah perubahan prompt):**

1. **Model live tidak lagi mengetik persentase progres sebagai milestone.** Respons analysis live memuat dua fakta: `risk` ("Risk R-1: Tower crane delivery is Open and rated High.") dan `milestone` ("Due date penyelesaian struktur: 3 Februari 2026." — milestone sah berbasis due date). Tidak ada fakta milestone untuk "Progress pekerjaan: 5%". Ini bukti live pertama bahwa penjelasan prompt efektif untuk kasus yang dilaporkan — dengan satu contoh sintetis saja, bukan bukti statistik.
2. **Guard tidak terpicu live** (karena model tidak mengeluarkan mislabel pada contoh ini); perilaku guard tetap dibuktikan oleh regresi offline. Posisi defensinya berlapis: prompt (kini ada bukti live positifnya) + validator (fail-closed terbukti offline).
3. **Kelemahan domain task tetap ada dan pindah lokasi**: respons domain live melampirkan `period_label` yang tidak dapat diatribusikan ("Periode: Tahap 2 Januari 2026" — jebakan stage-counter dari sesi sebelumnya) dan `as_of_date` dari record date ambigu; validator menolak semua baris observasi terkait (cost, progress, risk snapshot, milestone observation, risk register) → checkpoint grup `failed` (retryable) + dokumen `needs_review`. **Tidak ada data buruk yang diterbitkan** — kontrak fail-closed menahan — tetapi respons model terhadap prompt /37 untuk period_label/as_of_date belum memenuhi validator; ini pekerjaan prompt/validasi lanjutan, terpisah dari guard milestone-progress.
4. Yang masih dimock: klasifikasi dokumen dan ringkasan eksekutif. Koreksi validator pada replay offline melayani respons live yang sama (0 permintaan jaringan tambahan); jumlah attempt mencerminkan retry validator, bukan panggilan provider.

## Keputusan kesiapan (setelah live)

**NOT READY untuk klaim siap produksi / end-to-end.** Yang sudah terbukti: regresi offline 310/310, smoke workbook, dan dua respons live sintetis yang (a) tidak lagi memuat mislabel milestone-progress dan (b) tetap ditahan fail-closed oleh validator pada kelemahan periode/tanggal. Yang belum: korpus perwakilan dengan ground truth manusia, uji klasifikasi/ringkasan live, skenario retry live, dan pengukuran token vs baseline — prasyarat klaim `READY`/`READY WITH HUMAN REVIEW` sesuai gerbang rencana.

## Blocker

1. **Atribusi `period_label`/`as_of_date` pada domain task**: respons live masih gagal memenuhi validator untuk periode/tanggal record (temuan #3 di atas) → grup berakhir `failed`/retryable meski kontennya bagus. Perlu iterasi prompt + (bila ada anggaran baru) verifikasi live, atau keputusan desain tentang bagaimana "Tahap 2 Januari 2026" seharusnya diperlakukan.
2. **Evaluasi end-to-end** dengan dokumen perwakilan ber-ground-truth yang ditinjau manusia (cost, risk, narasi, OCR, XLSX ambigu, klasifikasi/ringkasan, skenario retry) belum ada — prasyarat klaim siap produksi.

## Risiko false positive / false negative guard

- **False positive (milestone sah tertolak)**: hanya mungkin bila seluruh klaim persis berupa persentase + kosakata progres + kata fungsi — klaim seperti itu memang bukan milestone. Kasus "Pekerjaan selesai 100%" (progres penyelesaian) memang diarahkan ke kanal progres, bukan fakta milestone; koreksi model dapat memperbaikinya. Milestone dengan subjek apa pun tetap lolos (tercakup tes).
- **False negative (mislabel tetap lolos)**: (a) klaim progres dengan kata yang tidak ada di kosakata skematik, mis. "Progres minggu ini: 5%" — sisa "minggu ini" membuat guard diam (konservatif, terdokumentasi); (b) **semua mislabel non-milestone** (persentase progres diketik risk/issue/decision/owner_action) belum ditegakkan — guard sengaja dibatasi ke tipe yang dilaporkan; (c) fakta milestone yang sitasinya salah baris tetap tidak dideteksi semantik. Ketiganya tetap tertangkap sebagian oleh koreksi prompt dan review manusia, dan tercatat sebagai batas.

## Langkah berikutnya

1. Iterasi prompt domain task untuk atribusi `period_label`/`as_of_date` (temuan live #3); verifikasi berikutnya membutuhkan anggaran live baru.
2. Evaluasi korpus perwakilan dengan ground truth manusia sebelum klaim `READY`/`READY WITH HUMAN REVIEW`.
3. Pertimbangkan perluasan guard ke tipe fakta lain bila data live menunjukkan mislabel lintas tipe; keputusan UX (bagaimana `needs_review` tampil per fakta di UI review) dapat diambil terpisah tanpa mengubah kontrak worker.
