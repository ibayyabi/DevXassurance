# Validasi lanjutan dekomposisi ekstraksi

## Keputusan

Belum layak dinyatakan siap produksi tanpa review: replay respons model menunjukkan teks progres `Progress pekerjaan: 5%` diterima sebagai `fact_type: milestone`, bahkan ketika checkpoint berstatus `completed` dan tidak ada quality warning. Validasi sumber dan angka bukan pembuktian jenis fakta. Instruksi prompt sudah diperjelas, tetapi respons model terhadap prompt yang diubah belum diuji live; perubahan prompt tidak membuktikan masalah semantik sudah hilang.

## Perubahan

- Prompt analisis hanya menawarkan `sheet_interpretation` untuk grup yang memang mempunyai kandidat interpretasi dari parser; instruksi diperjelas bahwa persentase progres saja bukan milestone.
- Prompt evidence meminta `period_label` spesifik, bukan judul generik seperti `Weekly report`.
- Duplikasi hasil fallback yang merujuk sel progres atau baris milestone yang sama dengan hasil deterministik yang benar-benar lolos validasi dihilangkan secara konservatif. Nilai identik dari dua baris/periode tetap terpisah. Cache ekstraksi dinaikkan ke `/37`.
- Batas verifikasi semantik dicatat di `worker/README.md`.

## Uji live terbatas

Empat permintaan HTTP ke `glm-5.3-flash`, semua HTTP 200 dan `finish_reason=stop`; total 6.798 input dan 1.877 output token menurut usage provider. Dokumen sintetis saja; klasifikasi dan ringkasan menggunakan mock. Tidak ada dokumen pengguna atau API key di laporan ini. Batas empat permintaan sudah habis; tidak ada permintaan tambahan setelah perubahan prompt.

Respons awal mengisi `period_label` dengan judul generik sehingga validator menolak progres dan risiko serta meminta koreksi. Pada percobaan berikutnya model juga mengeluarkan `sheet_interpretation` untuk grup yang tidak ambigu; validator mengeluarkannya, dan checkpoint grup menjadi `failed`. Perubahan prompt menargetkan kedua penyebab ini; efektivitasnya masih memerlukan uji live.

Catatan dan respons sintetis tersimpan di `.local-evaluation/production-live-diagnostic/`. `replay-live-diagnostic.mjs` menggunakan respons tersimpan tanpa jaringan: urutan historis mereproduksi koreksi serta checkpoint gagal; kombinasi respons lain menghasilkan checkpoint selesai tanpa warning tetapi tetap menerima fakta milestone yang salah.

## Verifikasi offline setelah perubahan

- Integrasi: 308/308 lulus, termasuk OCR dengan runtime dan model lokal yang dikonfigurasi.
- TypeScript `tsc --noEmit` dan ESLint pada file yang diubah: lulus.
- Replay live tersimpan: lulus sebagai reproduksi perilaku yang diamati, tanpa panggilan jaringan; ini bukan bukti keluaran semantik benar.
- Smoke dua workbook melalui jalur ekstraksi dengan model dan jaringan dimatikan: `all_passed=true`, `network_used=false`, `model_called=false`.
- Graph kode diperbarui dengan `graphify update .`.

## Batas dan langkah sebelum peluncuran

1. Rancang dan uji penanganan yang aman untuk salah klasifikasi semantik fakta, termasuk kasus multilingual dan kejadian milestone yang sah; jangan menganggap prompt atau sitasi cukup sebagai validator semantik. Sampai itu tersedia, hasil memerlukan review manusia dan tidak boleh dipresentasikan sebagai terverifikasi otomatis.
2. Jalankan uji live terkontrol terhadap prompt terbaru dengan batas request/token yang disepakati; empat panggilan di atas terjadi sebelum perubahan prompt. Sertakan retry dan checkpoint.
3. Evaluasi end-to-end dengan dokumen perwakilan yang memiliki ground truth yang ditinjau manusia, termasuk cost, risk, narasi, OCR, dan XLSX ambigu; klasifikasi dan ringkasan juga harus diuji jika ingin mengklaim seluruh pipeline tervalidasi.
4. Ukur kualitas dan pemakaian token terhadap baseline yang sama. Hasil saat ini tidak membuktikan penghematan biaya maupun akurasi untuk seluruh dokumen.

Executor GLM via OMP dicoba untuk diagnosis offline tetapi timeout tanpa hasil; diagnosis dan perubahan dilakukan oleh orchestrator. Tidak ada deployment atau commit.
