# Rencana Terra: uji WBS dan milestone offline

## Aturan dan batas

Eksekusi menggunakan CommandCode model `deepseek/deepseek-v4.1-flash`, sesuai permintaan pengguna. CommandCode inference sendiri terpisah; semua pengujian aplikasi **offline**: jangan baca `.env*`, API key atau auth store; jangan membuat request ke LLM/provider; jangan menjalankan `baseline-v2.mjs`, `run.mjs`, atau `evidence-v2.mjs` tanpa `--dry-run`/`--replay`. Jangan mengubah source produksi, workbook/ground truth fixture asli, output sebelumnya, konfigurasi provider, atau kode tidak terkait. `graphify query` sebelum source search/read jika graph ada; `graphify update .` setelah perubahan kode. Gunakan workspace `.scratch/opencode-go-experiment/`, output baru `.local-evaluation/opencode-go-exp-wbs/` (git-ignored). Jangan commit/install dependency/jalankan perintah destruktif. Jangan klaim uji LLM live.

## Tujuan

Mengukur bukti WBS `% complete` dan milestone pada fixture `demo-evidence-fixtures/smart-building-itb` dengan parser produksi aktual; ini eksperimen, bukan implementasi pipeline produksi. Pertahankan source WBS code, percent source wording, normalized value, reporting period/as-of, exact provenance. Milestone memerlukan label dan tanggal yang eksplisit, locators dari sumber; bedakan raw date dan tanggal normalisasi. Jangan mengubah actual progress menjadi forecast atau menghitung rollup project dari WBS. Kebijakan Issue vs Risk di luar cakupan; jangan otomatis mengonversi keduanya.

## Dataset dan pengukuran

- `expected-results.json` menyediakan `wbs_percent_complete` array dan `next_milestone` per komponen/periode. Audit apakah `next_milestone` betul literal sumber atau nilai turunan; jangan menjadikannya sumber untuk ekstraksi atau memakai expected untuk memilih row. Ground truth hanya untuk skor.
- Pilih subset development yang berbeda dari holdout sebelum menyesuaikan aturan. Pilihan awal dev W7 `02_Kamera` dan `05_Pencahayaan`; holdout W7 `01_Alarm` dan `07_Air_Bersih`; catat variasi dua template berdasarkan observasi parser yang aktual. Setelah aturan final, jalankan semua 48 workbook W4–W7 offline. Laporkan skor development dan holdout secara terpisah; seluruh paket fixture terkait bukan independent real-world test.
- Array expected WBS tidak memuat kode WBS: cocokkan terhadap urutan hanya setelah memverifikasi pola row/urutan dari sumber. Jangan mengklaim benchmark identitas WBS independent jika expected tidak memuat kode; laporkan coverage/ambiguity dan risiko array-order. Gunakan pembilang/penyebut untuk row completeness dan nilai, tanggal/teks milestone, source ID/locator yang tervalidasi, unknown/review/false-accept. `unknown` tidak otomatis absent atau sukses. Tentukan dan nyatakan toleransi sesuai ground truth dan format (misalnya 0.00005 fraksi jika relevan), jangan ubah expected.

## Implementasi eksperimen

- Pakai parser produksi unmodified; lihat `parseDocumentBuffer`, `sourceReferences`, `sourceLocation`, `cell` dan `formulaCells` aktual, serta runner eksperimen yang sudah ada. Bangun minimum runner baru di `.scratch/opencode-go-experiment/` untuk mengenali masing-masing dua template. Jika guardrail parser mendemosi tabel WBS menjadi teks tanpa sel terstruktur, catat batas: jangan mengarang source ID atau locator per-cell; row-level hanya jika benar didukung source, dan turunkan status menjadi review bila sel/label tidak dapat dibuktikan.
- Setiap nilai `found` harus dibuktikan sumber dan field/row/period yang tepat; tanggal dan label milestone jangan berasal dari kolom lain tanpa bukti hubungan. Jika next milestone dihitung dari beberapa baris, tandai derived, berikan input/source dan aturan; jangan presentasikan sebagai reported claim. Jangan menggeneralisasikan aturan fixture ke dokumen lain.
- Untuk formula, nilai cached kosong/missing/error bukan nol; freshness cache tidak dibuktikan hanya karena ada. Jangan menjalankan arbitrary Excel formula. Konflik, label/period ambigu, nilai di luar 0–1, WBS duplikat, source kosong atau tanpa locator pasti → unknown/ambiguous/review; jangan silent truncate.

## Uji negatif dan verifikasi

- Jalankan pemeriksaan deterministik terarah: status 0 valid vs sel kosong, row/kolom tertukar atau kode duplikat, kode/nilai dari sheet/periode berbeda, tanggal milestone invalid/konflik/absen, formula cache kosong/berubah/bertentangan, dan fallback tak boleh mengubah review menjadi found tanpa bukti. Pakai sel/data sintetis atau salinan sementara, bukan fixture asli. Assertions harus menguji outcome yang terlihat, bukan sekadar wiring.
- Jalankan baseline validasi yang sudah ada `node .scratch/opencode-go-experiment/verify-v3.mjs` dan smoke runner baru dengan fixture; laporkan jumlah dan command. Untuk 48 workbook catat hash, parser version, tanggal, asal ground truth, field failures beserta reason dan provenance. Jangan menghitung nilai/review sebagai found, dan jangan menyembunyikan omissions.
- Tulis `.scratch/opencode-go-experiment/report-wbs-milestone-offline.md` berisi perintah, metode, skor per template/sesi dan kondisi gagal, caveat provenance, data yang tidak dinilai, simpulan apakah eksperimen aman untuk dilanjutkan. Jika ground truth milestone tak memadai, ungkapkan dan tetap selesaikan pemeriksaan yang tersedia; jangan fabrikasi atau menyempitkan tanpa penanda. Update README untuk instruksi offline baru.
