# Rencana eksperimen dekomposisi AI pipeline

## Handoff

Eksekusi dilakukan pada sesi berikutnya oleh CommandCode dengan DeepSeek V4.1 Flash. Dokumen ini adalah rencana, bukan hasil benchmark. Jangan menjalankan eksperimen saat menyusun rencana ini.

Pengguna menyatakan bahwa penggunaan OpenCode Go untuk eksperimen ini diizinkan. Gunakan fixture proyek; jangan mengirim dokumen lain tanpa izin. API key tersedia untuk diisi pengguna pada `.env.opencode-go.local`, variabel `OPENCODE_GO_API_KEY`. Jangan mencetak, menyimpan dalam hasil, atau mengirim key dalam prompt. Jangan mengubah provider produksi.

Runner koneksi `.scratch/opencode-go-experiment/run.mjs` menggunakan endpoint `https://opencode.ai/zen/go/v1/chat/completions`, header `x-opencode-session`, dan default `glm-5.3-flash`. Ini hanya smoke runner, bukan benchmark. Jika benchmark memakai DeepSeek V4.1 Flash melalui OpenCode Go, atur `OPENCODE_GO_MODEL=deepseek-v4.1-flash` dan verifikasi ID, ketersediaan akun, izin regional, serta response usage pada satu panggilan; jangan menganggapnya pasti tersedia. DeepSeek sebagai model agent CommandCode tidak otomatis berarti request benchmark memakai model yang sama: catat keduanya secara terpisah.

## Tujuan dan batas klaim

Uji apakah dekomposisi dapat meningkatkan kualitas ekstraksi dan/atau mengurangi token total pada model yang sama, dibanding pipeline eksisting. GPT-OSS 120B tidak tersedia; jangan mengklaim perbandingan langsung dengannya. Gunakan harga atau allowance yang dilaporkan provider jika tersedia, tanpa menganggap token identik antar model.

## Dataset

- Sumber: `demo-evidence-fixtures/smart-building-itb/`; hasil harapan: `expected-results.json`; struktur dan batas fixture: README di folder yang sama.
- Pilot: dua workbook progress dari `sessions/2026-10-30_w7/`, dipilih setelah memeriksa bahwa keduanya mewakili dua bentuk tabel berbeda. Catat path dan hash masing-masing. Jika tidak mewakili dua bentuk, dokumentasikan dan pilih ulang berdasarkan isi, bukan nomor file semata.
- Evaluasi setelah pilot berhasil: 12 workbook W7, lalu W4–W6 untuk uji lintas periode bila kuota memadai. Tetapkan set pengembangan terpisah dari evaluasi sebelum menyempurnakan aturan; jangan menyesuaikan aturan dengan jawaban evaluasi. Tiap file/periode punya identitas terpisah walaupun nama file sama.
- Gunakan ground truth hanya untuk penilaian, tidak pernah dikirim sebagai input model. Ukur hanya field yang benar-benar bisa dipetakan dengan jelas ke expected results; catat field lain sebagai belum dinilai. Evaluasi cost baseline dan MoM hanya setelah tersedia ground truth yang memadai untuk field yang dinilai.

## Tiga varian

1. **A — baseline eksisting.** Jalankan parser dan `extractDocumentGroups()` pada `worker/src/services/document-extraction.ts` dengan prompt, validator, dan aturan grouping aktual; gunakan store checkpoint terisolasi per varian/run. Hitung seluruh panggilan, termasuk klasifikasi, ekstraksi, koreksi, dan sintesis. Jika provider tidak bisa dihubungkan tanpa memodifikasi worker, gunakan adapter eksperimen terisolasi yang mempertahankan kontrak request/response; dokumentasikan perbedaannya. Jangan menyebut prompt buatan sendiri sebagai baseline produksi.
2. **B — ekstraksi terdekomposisi.** Gunakan parser dan dataset yang sama. Kelompokkan tugas berdasarkan domain (progress/milestone dan risk sebagai titik awal), kirim konteks relevan dan ID bukti stabil, lalu validasi ID, nilai, hubungan semantik, dan provenance. Sediakan `unknown`/`ambiguous`; bila kandidat tidak ada atau konteks kurang, tandai belum terselesaikan, bukan tidak ada di dokumen. Ukur recall generator kandidat secara terpisah. Jangan mengubah kode produksi hanya untuk membuktikan hipotesis.
3. **C — deterministik + B.** Ekstrak field XLSX yang strukturnya dapat dikenali secara aman; panggil B hanya untuk field yang belum terselesaikan. Nilai derived harus mencatat aturan dan input; cache formula kosong bukan nol. Bila struktur atau sumber ambigu, eskalasi atau review. Jangan menganggap hasil harness lama sebagai implementasi yang tersedia.

Batasi perbandingan lintas varian ke output domain dan field yang setara. Catat perbedaan cakupan; jangan menganggap varian menang karena mengerjakan lebih sedikit. Simpan setiap hasil sebelum memulai varian berikutnya agar kuota atau kegagalan tidak menghapus bukti.

## Protokol dan metrik

- Rekam hash input, commit/versi kode, versi parser/prompt/aturan, model ID yang benar-benar direspons provider, parameter, batas output, waktu, dan session ID non-rahasia. Gunakan session stabil dalam satu percakapan dan berbeda antar run independen; catat penggunaan cache jika dilaporkan.
- Jalankan varian pada file yang sama dan periksa hasil JSON/finish reason; respons terpotong, error, 429, output tak valid, atau token usage hilang harus tercatat, bukan dinilai sebagai nol. Tentukan kebijakan retry yang sama dan batas request/output/token **sebelum** menjalankan pilot; hentikan pada limit atau jika kuota habis. Jangan melakukan retry tak terbatas.
- Laporkan per varian dan domain: precision/recall observasi terhadap ground truth, field-value accuracy, kutipan/provenance benar, fakta terlewat, salah-positif, kandidat recall, unresolved/review, dan error. Definisikan matching, toleransi angka, tanggal, dan kasus tanpa expected sebelum menghitung; simpan pembilang dan penyebut.
- Catat input/output/reasoning/cached tokens bila tersedia, total semua panggilan/retry per dokumen, request count, latensi dan allowance/biaya yang dilaporkan. Bedakan cold/warm cache dan keberhasilan parsial. Tidak ada totalisasi diam-diam ketika provider tidak melaporkan usage.
- Model non-deterministik: setelah pilot, ulangi run independen bila kuota memungkinkan, laporkan variasi dan jumlah ulangan. Satu run tidak cukup untuk klaim kestabilan.

## Langkah eksekusi dan keputusan

1. Verifikasi key tanpa mencetaknya dan lakukan satu smoke call dengan data non-sensitif; catat model aktual dan usage. Berhenti pada 401/403/404/429 atau akses model tidak tersedia; jangan pindah provider diam-diam.
2. Audit fixture, kontrak hasil, runner dan dependensi. Tentukan subset, field, matching, batas kuota, dan acceptance criteria sebelum benchmark. Jika ground truth untuk sebuah domain tidak memadai, laporkan gap; jangan merekayasa nilai.
3. Implementasikan runner evaluasi terisolasi dan tiga varian secara eksplisit, kemudian jalankan pilot. Jika baseline aktual tidak dapat dijalankan, nyatakan blocker dan jangan mengganti namanya dengan baseline tiruan.
4. Jalankan evaluasi yang disepakati, simpan output per file/varian dan ringkasan di `.local-evaluation/` yang diabaikan Git. Hindari menyimpan key; output mungkin memuat konten sumber dan harus diperlakukan sensitif.
5. Laporkan hasil apa adanya: kualitas dan biaya per dokumen, kegagalan, field yang tidak dinilai, limit kuota, serta apakah bukti cukup untuk melanjutkan. Jangan menyimpulkan performa pada XLSX sewenang-wenang dari fixture ini.

Tidak ada klaim penghematan atau peningkatan kualitas sebelum hasil aktual tersedia. Pertahankan kode produksi tidak berubah sampai hasil eksperimen dan rencana cutover disetujui.
