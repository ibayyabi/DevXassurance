# Rencana perbaikan harness evidence-first

## Tujuan dan batas

Perbaiki harness eksperimen `.scratch/opencode-go-experiment/evidence-v2.mjs` berdasarkan `report-v2.md`; tidak mengubah worker produksi, fixture asli, `.env*`, atau hasil eksperimen terdahulu. Pengguna meminta perencanaan oleh Terra dan pelaksanaan oleh CommandCode model `deepseek/deepseek-v4.1-flash`. Ikuti `AGENTS.md`, termasuk `graphify query` sebelum eksplorasi source jika graf tersedia dan `graphify update .` setelah perubahan kode.

## 1. Validator risiko dan provenance

- Periksa `riskRowFrom`, `deterministicExtract`, `corroborate`, `validateModelOutput`, serta alur `resolveFields` dari source aktual. Perbaiki tanpa menerima klaim yang tidak didukung.
- Observasi risiko harus mengikat ID, status, dan priority ke **sel berlabel benar pada sheet dan baris yang sama**. Rujukan sel Status/Priority yang sah tidak boleh ditolak karena bukan ID. Setiap ID yang diklaim harus didukung; ID yang berbeda baris, tidak dikenal, missing status, status tidak jelas, nilai/status/priority bertentangan, atau bukti tidak lengkap harus menghasilkan unknown/ambiguous/invalid, bukan found. Jangan mengasumsikan tabel tidak memiliki risiko open hanya karena tak ada baris ditemukan.
- Untuk C, output `open_risk_ids` sertakan source ID dan status untuk tiap risiko yang mendasari status open; `risk_entries` sertakan source ID, status, dan priority yang mendukung klaim. Untuk risiko kosong perlu bukti kelengkapan, jika tidak tetap unknown. Jangan menambah sumber yang tidak ada.
- Uji ulang respons B yang disimpan di `.local-evaluation/opencode-go-exp-v2/B-*.json` tanpa menimpa hasil sebelumnya: kasus sel status/prioritas sah harus tidak lagi ditolak hanya karena bukan ID; risiko yang model lewatkan tetap terlewat. Jangan mengukur hanya nilai output mentah.

## 2. Formula dan cache fail-closed

- Pisahkan nilai literal, hasil cache formula sumber, dan nilai `derived` oleh aturan domain. Pertahankan teks formula, status cache, dan referensi sumber input; jangan gambarkan derived sebagai hasil formula Excel. Cache kosong/missing/error bukan nol.
- Jangan menyatakan cache formula pasti mutakhir hanya karena ada. Rumus yang tidak cocok dengan aturan yang direkalkulasi, tidak dikenali, atau input dependensinya tidak tersedia → jangan terima sebagai hasil formula; tandai review/unknown. Untuk RAG cache, jika dependensi yang relevan kehilangan cache/berubah/tidak bisa dibuktikan aman, jangan terima cache seolah valid; tandai review/unknown. Tidak perlu mengevaluasi rumus Excel arbitrary atau menambahkan dependency baru; konservatif lebih baik.
- Beri output yang membedakan eksplisit derived domain, source formula, dan cache. Bila tidak bisa memverifikasi kesesuaian rumus, jangan menampilkan domain-derived sebagai ekuivalen formula sumber. Jangan ubah workbook asli.

## 3. Verifikasi

- Uji regresi perilaku yang kecil dan deterministik: sel ID + status + priority baris sama diterima, sel status dari baris lain/ID tidak dikenal/ID terlewat atau value salah tidak diterima; missing/ambiguous risk tidak menjadi absent; formula kosong, formula variance diubah menjadi plus, dan cache RAG dependen yang tidak dapat diverifikasi tidak diam-diam valid. Gunakan data sintetis sementara yang tidak merusak fixture; jangan memasukkan kunci API.
- Jalankan C pada 48 fixture W4–W7 menggunakan `--dry-run` dan simpan output di direktori baru `.local-evaluation/opencode-go-exp-v3/<session>/`; laporkan denominators, unknown/ambiguous dan perbedaan terhadap hasil expected pada field yang didukung. Bandingkan planned/actual/variance dengan toleransi 0.00005 fraksi, set risiko exact, tanggal/RAG exact. Nilai turunan yang memerlukan review tidak dihitung valid.
- Lakukan B validasi menggunakan rekaman output sebelumnya tanpa menghubungi API jika memungkinkan; jika jalur replay belum ada, implementasikan minimum yang memungkinkan replay aman tanpa mengubah output mentah. Tidak perlu rerun baseline 37 request atau penggunaan LLM berulang hanya untuk memperbaiki validator. Jika benar-benar diperlukan request tambahan, pakai fixture sintetik, model yang sama, catat usage/failure dan stop 429.
- Laporkan dengan jujur nilai cocok versus provenance benar, false rejection dan yang belum terukur. Temuan lama tidak dihapus. Output baru terpisah dari v2. Jika validasi tidak dapat dibuktikan, tandai blocker, jangan mengklaim siap produksi.

## 4. Artefak

Perbarui `.scratch/opencode-go-experiment/README.md` sesuai cara menjalankan evaluasi dan tulis hasil baru `report-v3.md` dengan perintah, jumlah field, status serta batas klaim. Jangan ubah `.env.opencode-go.local` atau log key. Jangan jalankan build/lint full-suite; jalankan verifikasi terarah setelah implementasi. Model eksekusi diminta pengguna adalah CommandCode `-m deepseek/deepseek-v4.1-flash`.
