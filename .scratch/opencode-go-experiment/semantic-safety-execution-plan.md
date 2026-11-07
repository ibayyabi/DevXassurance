# Rencana eksekusi: keamanan semantik dan validasi dekomposisi AI

**Untuk eksekutor:** GLM 5.3 Flash melalui Zcode di harness terpisah. Jalankan rencana ini dari root repository yang sama; jangan menganggap konteks percakapan sebelumnya tersedia. Ini pekerjaan implementasi dan validasi, bukan perintah deployment.

## Konteks dan tujuan

Sistem ekstraksi dokumen sebelumnya mengandalkan prompt besar dan model GPT-OSS 120B. Tujuan pekerjaan ini adalah mengurangi beban model tanpa mengorbankan provenance atau menyajikan hasil yang belum terverifikasi sebagai fakta. Arsitektur yang sedang dikerjakan adalah **varian C / deterministic-first dengan dekomposisi prompt**:

1. Parser menghasilkan chunk dan referensi sumber, termasuk struktur sel XLSX jika dapat dibuktikan.
2. Aturan deterministik mengusulkan sebagian progres dan milestone XLSX; validator yang sama menilai usulan tersebut. Cakupannya sengaja terbatas, bukan klaim bahwa semua XLSX bisa diekstrak tanpa model.
3. Model menangani bagian yang belum terselesaikan dan tugas yang berbeda melalui **group analysis** (fakta, ringkasan grup, status, alert, tindakan, metadata) dan **domain evidence** (cost, progres, milestone, risiko). Satu model kecil dapat melayani kedua tugas; tidak ada keharusan menggunakan model besar atau dua model yang berbeda.
4. Hasil digabung dan divalidasi; checkpoint, retry, dan fencing yang sudah ada harus tetap benar. Ringkasan dan klasifikasi dokumen juga merupakan tahap tersendiri.

Implementasi ini sudah berada di working tree, terutama `worker/src/services/document-extraction.ts`; bukan berarti sudah layak dipasang ke produksi. Baca `.scratch/opencode-go-experiment/report-validation-next.md` untuk bukti terakhir dan `.scratch/opencode-go-experiment/report-production-decomposition.md` untuk konteks implementasi. Periksa kode dan tes terkini; laporan adalah snapshot, bukan pengganti pemeriksaan kode.

## Masalah yang harus diselesaikan

Respons live sintetis yang tersimpan pernah menghasilkan `fact_type: milestone` untuk `Progress pekerjaan: 5%`. Validator menerima fakta tersebut; sebuah replay menghasilkan checkpoint `completed` tanpa warning. Sitasi yang ada dan angka yang cocok **tidak membuktikan jenis fakta**. Ini risiko sistem, bukan bukti bahwa Excel pengguna rusak.

Prompt sudah meminta model untuk tidak menyebut persentase progres sebagai milestone, tetapi perubahan itu belum diuji live. Prompt saja bukan jaminan semantik. Dua masalah lain juga diamati: judul generik `Weekly report` dijadikan `period_label`, dan model mengeluarkan `sheet_interpretation` untuk grup yang tidak ambigu. Prompt telah diperjelas untuk kedua kasus, tetapi belum dibuktikan dengan respons live baru.

Hasil sebelumnya: 308/308 tes integrasi lulus; smoke dua workbook offline lulus. Empat request live sintetis sebelum perubahan prompt memakai 6.798 input dan 1.877 output token; klasifikasi dan ringkasan di-mock. Angka-angka itu bukan bukti akurasi end-to-end atau penghematan biaya.

## Batas kerja dan biaya

- Pertahankan semua perubahan pengguna yang sudah ada, termasuk perubahan uncommitted dan stash. Jangan menjalankan `git stash pop`, reset, checkout/restore, clean, atau operasi destruktif untuk memperoleh worktree bersih. Jangan commit atau deploy kecuali diminta.
- Jalankan semua diagnosis, regresi, dan smoke yang memungkinkan **secara offline**. Menggunakan GLM sebagai agen coding di harness adalah terpisah dari panggilan model oleh aplikasi yang diuji.
- **Jangan melakukan request API LLM baru tanpa persetujuan pengguna atas anggaran baru.** Budget empat request sebelumnya sudah habis. Jangan menghapus/mengganti ledger untuk menghindari batas. Jika nanti disetujui, batasi total request termasuk retry secara global sebelum dispatch, tetapkan batas input/output serta timeout, catat usage aktual, dan berhenti saat habis. Mintalah persetujuan terpisah sebelum mengirim dokumen non-sintetis ke provider.
- Jangan tampilkan API key, isi `.env`, atau dokumen sensitif di log dan laporan. Jangan menyimpulkan sebuah output benar hanya karena HTTP 200, JSON valid, checkpoint completed, atau validator tanpa warning.
- `graphify-out/graph.json` ada: sebelum pencarian/reading kode pertama, jalankan `graphify query "semantic fact validation document extraction checkpoint review"`; ikuti aturan repository. Setelah mengubah kode jalankan `graphify update .`.

## Langkah eksekusi

### 1. Petakan alur dan kontrak konsumen

Baca laporan terakhir, lalu telusuri bagaimana `facts` divalidasi di `validateGroupExtraction`, bagaimana hasil grup dan checkpoint diputuskan, serta bagaimana fakta dipersist dan ditampilkan/digunakan pada review dan downstream. Periksa contoh fakta valid yang sudah dicakup tes. Temukan apakah status review, provenance, dan penanganan warning saat ini benar-benar mencegah fakta tidak pasti dipakai sebagai fakta terverifikasi.

Bukti selesai: catat jalur fungsi/file dan perilaku aktual dari output model sampai konsumen; identifikasi di mana keputusan semantik dapat ditegakkan tanpa melemahkan sitasi, fencing, atau domain lain. Jangan mengasumsikan warning saja otomatis memblokir semua konsumen.

### 2. Tentukan dan implementasikan penanganan yang aman

Tangani akar masalah secara konservatif pada batas yang dipakai semua jalur terkait. Klaim dengan jenis yang tidak dapat didukung oleh bukti harus ditolak atau dipertahankan sebagai **perlu review**, dengan status yang benar-benar dikenali konsumen; jangan diam-diam mengubah jenisnya, menghilangkan warning, atau menandai checkpoint bersih jika itu membuat klaim yang tidak didukung tampak terverifikasi. Pertahankan fakta yang jenisnya benar dan didukung sumber.

Jangan memperbaiki hanya string `Progress pekerjaan: 5%`, mengandalkan instruksi prompt sebagai satu-satunya guard, atau memperkenalkan daftar kata sempit yang diam-diam menghapus kejadian valid. Jika pembuktian umum tidak mungkin dilakukan secara deterministik, bedakan secara jujur kasus yang dapat dibuktikan dari yang memerlukan review. Periksa dampak terhadap retry, persistensi, UI/read model, dan versi cache; migrasikan semua konsumen yang terdampak bila kontrak berubah.

Bukti selesai: ada penanganan nyata dari ekstraksi sampai konsumen, dengan batas coverage yang dijelaskan. Jika keselamatan memerlukan perubahan domain/UX yang belum dapat diputuskan dari repo, selesaikan bagian aman yang dapat dikerjakan dan laporkan keputusan yang dibutuhkan; jangan mengklaim solusi menyeluruh.

### 3. Buktikan dengan regresi offline

Tambahkan tes perilaku minimum pada konvensi yang ada, termasuk:

- Persentase progres semata yang diberi tipe milestone tidak dapat diterbitkan sebagai milestone terverifikasi; cek perilaku checkpoint dan konsumennya, bukan hanya fungsi helper.
- Milestone yang benar-benar dinyatakan, termasuk contoh bahasa Indonesia dan Inggris, tetap ditangani dengan benar; progres yang sah tetap tersedia sebagai progres.
- Fakta risk, issue, decision, dan owner action yang sah tidak hilang akibat perubahan; klaim ambigu atau sitasi yang tidak mendukung jenisnya mengikuti jalur review/penolakan yang dipilih.
- Tidak mencampur sumber, kolom, cakupan, atau periode; checkpoint gagal/tidak reusable ketika kontraknya mensyaratkan itu; retry dan hasil deterministik/fallback tidak menghasilkan duplikasi.

Gunakan respons sintetis tersimpan di `.local-evaluation/production-live-diagnostic/response-*.json` jika tersedia, atau fixture sintetis mandiri jika harness terpisah tidak memiliki direktori tersebut. `.scratch/opencode-go-experiment/replay-live-diagnostic.mjs` mendokumentasikan reproduksi lama; sesuaikan ekspektasi replay setelah perubahan, jangan mempertahankan penerimaan fakta yang salah hanya supaya replay lama lulus. Jangan memasukkan data sensitif ke fixture.

Jalankan tes fokus, suite integrasi yang terdampak, `npx tsc --noEmit -p tsconfig.json`, dan lint untuk file yang diubah. Jalankan smoke nyata melalui jalur ekstraksi menggunakan model/network mock dan amati fakta, status review, warning, dan checkpoint. Untuk OCR gunakan runtime lokal yang sudah tersedia bila ada; jika tidak tersedia, laporkan verifikasi OCR sebagai belum dijalankan, bukan lulus.

Bukti selesai: laporkan perintah, hasil, dan batasnya; setiap tes harus menguji perilaku konsumen yang masuk akal, bukan detail wiring atau sekadar tidak error.

### 4. Gerbang uji live dan kesiapan

Tanpa persetujuan anggaran baru, berhenti pada pengujian offline dan catat live sebagai **belum diuji**. Jika pengguna menyetujui budget baru, rancang uji minimal dengan data sintetis, hitung semua panggilan termasuk klasifikasi, analisis, evidence, ringkasan, dan retry; pastikan cap benar-benar ditegakkan sebelum request. Catat model aktual, request berhasil/gagal, penggunaan token provider, hasil validator, semantik, checkpoint, dan apa yang masih dimock. Jangan jalankan loop berulang hanya untuk mendapatkan hasil baik.

Untuk klaim end-to-end/siap produksi, butuh evaluasi terhadap dokumen perwakilan dengan ground truth yang ditinjau manusia, termasuk cost, risk, narasi, OCR, dan XLSX ambigu, serta pengujian klasifikasi/ringkasan dan skenario retry. Bandingkan akurasi dan token pada corpus dan kondisi yang sama bila mengklaim penghematan. Satu contoh sintetis atau suite offline hijau tidak memenuhi gerbang ini. Laporkan `READY`, `READY WITH HUMAN REVIEW`, atau `NOT READY` hanya berdasarkan bukti dan batas tersebut.

### 5. Dokumentasi dan handoff

Perbarui dokumentasi relevan jika perilaku berubah dan tulis `.scratch/opencode-go-experiment/report-semantic-safety.md` berisi: perubahan, jalur review yang benar-benar teruji, uji/perintah dan hasil, jumlah request/token aktual, blocker, risiko false positive/negative, keputusan kesiapan, dan langkah berikutnya. Sebutkan jelas bila tidak ada request live atau bila artefak sebelumnya tidak tersedia. Jangan mengklaim model atau provider telah terbukti hanya dari mock.
