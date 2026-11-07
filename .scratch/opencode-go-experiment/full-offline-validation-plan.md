# Rencana Terra: validasi menyeluruh yang dapat dilakukan offline

## Batas yang tidak boleh dilanggar

User meminta Terra planning dan CommandCode `deepseek/deepseek-v4.1-flash` eksekusi. Pengujian aplikasi harus **offline**: jangan membaca `.env*`, API key, auth store, atau memanggil provider/LLM; jangan gunakan runner tanpa `--dry-run`/replay yang aman. CommandCode inference sendiri terpisah dari request aplikasi. Jangan mengubah production worker, fixture dan expected asli, output eksperimen sebelumnya, atau kode pengguna; jangan install paket, commit, menjalankan aksi database/deployment destruktif, atau men-trigger job eksternal. Output baru `.local-evaluation/opencode-go-exp-full-offline/`, eksperimen/sintetik baru `.scratch/opencode-go-experiment/`. `graphify query` sebelum source search/read jika graph tersedia, `graphify update .` setelah mengubah kode. Pengguna menginginkan semua yang bisa diuji: jangan klaim 'semuanya valid' tanpa bukti, jangan menyembunyikan blocker, jangan berpindah ke provider atau menghabiskan kuota API.

## Tujuan dan prinsip

Verifikasi dari pembacaan dokumen sampai kontrak observasi pada seam publik aktual bila tersedia, bukan menguji hanya wiring, formula scorer sendiri, copy data, atau prototype dan menganggap itu produksi. Prototipe belum mengubah parser/validator produksi dan tidak boleh disebut lolos end-to-end produksi. Bukti fixture yang dibuat generator sama bukan ground truth independen; human-reviewed holdout tidak boleh dibuat-buat. Ambiguitas harus fail-closed dan data yang tidak diperiksa harus jelas.

## A. Bukti parser → validator → output

- Audit fungsi publik `parseDocumentBuffer` dan `extractDocumentGroups`, source IDs, column/source-location, guardrail oversized split, sourceReferences cap 120, header ambigu/duplikat, formula cache, dates 1900/1904, checkpoint parser version. Rujuk laporan provenance terbaru.
- Jalankan suite integrasi yang relevan di repo secara aman dengan network dimatikan/dilarang, termasuk parser, grouped extraction, cost, schedule, risk, checkpoint/fencing jika dapat dilakukan tanpa database eksternal. Periksa source test dulu agar tidak melakukan network atau aksi berbahaya. Rekam exact command, total, failure, skip. Laporan user-reported failure ground truth, jangan rerun hanya untuk membuktikannya.
- Tambahkan pengujian eksperimental kecil yang menjangkau seam publik produksi apabila ada gap; gunakan synthetic fixture/response deterministic dan temp file, jangan mengganti user code atau count tests non-behavioral. Uji chunk split, cap 120, per-cell identity, cross-sheet/row/period confusion, duplicate/moved header dan row ambiguity, formula missing/empty/error/stale mismatch, empty vs zero, Excel 1900/1904, versioned checkpoint berbeda parser. Jangan melemahkan guardrail; bila implementasi produksi tidak mendukung, tuliskan failing evidence/blocker, jangan ubah expected test agar lulus. Tetap lanjutkan pengujian lain.

## B. Cakupan domain dan ground truth

- Audit apa yang didukung dan jalankan kontrak existing untuk WBS (code+value+source/period, bukan array-index identity), milestone (reported baseline vs forecast), cost (baseline/actual/committed/EAC, currency/scope/normalization), risiko (status/priority/ID/period dan issue type dibedakan), klasifikasi/fakta/ringkasan dan explicit coverage unknown/review. Jalankan parser produksi dan tes yang ada atau runner terisolasi jika dibutuhkan; jangan membuat jawaban benchmark dari output yang diuji.
- Untuk file cost baseline, audit `hardware_baseline_total` dan `purchase_request_total` terhadap lokasi sumber workbook secara independen offline dengan OOXML/openpyxl jika tersedia; jangan menyamakan total yang dihitung dengan klaim yang secara eksplisit dilaporkan. Jika tak bisa membuktikan label/scope/currency/formula, catat gap dan tidak membuat klaim valid. MoM/naratif hanya dinilai jika expected/independent evidence tersedia, bukan diada-adakan.
- Gunakan split/fixture yang ada, catat sample/hash/version, dev vs holdout. Expected WBS saat ini array dan generator bersama, jadi skor bukan identity atau kualitas real-world. Secara opsional bangun anotasi lokal yang merujuk nilai/sel langsung dari workbook sebagai cross-check struktural, tetapi jangan panggil itu human-reviewed independent semantic ground truth. Jika tak ada corpus independent, buat blocker eksplisit dan jelaskan apa yang dibutuhkan.

## C. Failures, checkpoint dan ketersediaan

- Uji perbedaan 'tidak ada' vs 'belum diproses' vs 'ambigu'; 429/timeout dan partial groups tidak menjadi absence; completed groups tidak diulang hanya bila data, parser version, schema dan contract cocok; cache bila fresh tidak dibuktikan jangan diasumsikan. Untuk queue/fencing integrasi nyata butuh DB, gunakan local DB hanya jika sudah tersedia, aman dan test harness terisolasi; jika tidak tersedia, jangan menjalankan DB user/production dan catat test tidak dijalankan. Jangan mengekstrapolasi mock/unit sebagai bukti transaksi nyata.
- Uji selected progress/risk cell lintas period dan review, source reference survives end-to-end, formula tidak dikenal tidak diperlakukan trusted. Prioritaskan perbaikan 216 WBS per-cell hanya sebagai prototipe, bukan fake production success.

## D. Pengukuran dan laporan

- Lakukan baseline validasi eksperimen offline yang sudah ada tanpa mengubah output lama (48 WBS dan evidence, synthetic, prototype). Hasil lama boleh dirujuk dengan bukti, tetapi jalankan skenario relevan yang belum dikerjakan. Budget dan penggunaan API baru = 0; data file dapat sensitif, output lokal gitignored.
- Ukur numerator/denominator tiap domain, provenance cell vs row vs unknown, nilai vs validasi, false accept/false reject, fail/skip, dan thresholds dalam laporan. Simpan hasil baru dan ringkasan di `.local-evaluation/opencode-go-exp-full-offline/`, laporan `.scratch/opencode-go-experiment/report-full-offline.md`, tambahkan README jika ada runner baru.
- Untuk setiap penerimaan: PASSED berdasar perintah/output yang benar-benar dijalankan; FAILED berdasar bukti; BLOCKED yang butuh real independent annotated documents, DB terisolasi, atau request LLM. Nyatakan batas data synthetic/fixture, unobserved and operational tradeoffs; jangan menyatakan production ready atau biaya/akurasi model valid jika tidak dites. Lakukan semua tindakan yang tidak tergantung blocker sebelum berhenti.
