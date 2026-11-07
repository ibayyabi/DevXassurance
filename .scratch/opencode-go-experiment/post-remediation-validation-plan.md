# Validasi offline pasca perbaikan

## Tujuan dan batas
- Eksekusi dengan CommandCode DeepSeek V4.1 Flash. Tidak memakai API model eksperimen, file environment/kredensial, provider, atau database eksternal. CommandCode sendiri memakai layanan model untuk bekerja; bukan panggilan aplikasi yang diuji.
- Jangan ubah workbook, ground truth, kode produksi, atau pekerjaan yang ada; jangan install, commit, atau hapus data. Output evaluasi di direktori baru `.local-evaluation/`, laporan di `.scratch/opencode-go-experiment/`.
- Jalankan graphify query sebelum pencarian source sesuai aturan repo. Reuse harness yang ada setelah memeriksa metode dan versi parser; jangan jalankan ulang kegagalan suite yang sudah dilaporkan sekadar untuk konfirmasi. Gunakan log yang sudah tersimpan.

## 1. Progress 48 workbook
Gunakan parser produksi terkini setelah perbaikan dan perbandingan ground truth yang independen; cari dan gunakan harness yang tersedia termasuk `/tmp/xlsx-robustness/deterministic.mjs` jika masih ada. Ukur dengan denominator eksplisit semua workbook/sesi: cutoff, planned, actual, variance, RAG, WBS per baris dan weighted progress, milestone/overall, evolusi risiko. Laporkan mismatch, missing, review, unsupported secara terpisah dengan lokasi sumber. Pastikan tidak membandingkan ground truth terhadap dirinya sendiri. Bedakan output harness deterministik eksploratif versus output jalur produksi: jangan klaim keduanya setara atau klaim akurasi model dari mock. Catat bukti parser version, perintah, output mentah, pembilang/penyebut dan toleransi. Jika metrik tak dapat dihitung andal, laporkan blocker dan kerjakan sisanya.

## 2. Cost baseline
Bandingkan hardware_baseline_total dan purchase_request_total dengan nilai workbook serta expected-results secara konservatif dengan audit yang ada; laporkan sel/nilai, formula cache, nilai malformed/ambiguous dan perbedaan. Tunjukkan secara eksplisit apakah audit mencakup cost-evidence produksi atau hanya pembacaan OOXML independen. Jangan memperbaiki input atau menciptakan ground truth. Jika masuk akal, uji output parser produksi terpisah dengan fixture yang sama tanpa model/layanan.

## 3. Tinjau 20 kegagalan
Pakai `.local-evaluation/opencode-go-exp-system-remediation/formula-due/integration-suite.log` dan laporan baseline; enumerasi setiap test gagal, error aktual, lokasi, dampak consumer/rilis dan klasifikasinya berdasarkan bukti; tandai tidak pasti jika belum diketahui. Jangan mengeksekusi ulang tes gagal yang sudah dilaporkan. Jangan mengubah kode/tes atau menyebut semua aman hanya karena kegagalan lama. Jelaskan apakah ada failure yang berkaitan langsung dengan pipeline/assurance dan prioritas review.

## Deliverable
Laporan Indonesia `.scratch/opencode-go-experiment/report-post-remediation-validation.md` mencakup angka terukur, semua mismatch/unknown dan evidence path, keputusan readiness yang proporsional, perintah reproduksi offline, no-network/no model nyata, dan usulan langkah berikutnya. Jangan jalankan uji provider/model nyata pada tahap ini. Kembalikan ringkasan hasil, kegagalan dan blocker.
