# Status integrasi deterministic-first: BELUM AMAN

## Hasil akhir sesi

- Terra mengambil alih setelah GLM Zcode timeout. Implementasi produksi menggabungkan kandidat progres/milestone XLSX yang lolos validator dengan keluaran model; scope yang tidak terbukti dan sumber tak terstruktur tetap memerlukan model. Gate cakupan hanya menyatakan lengkap bila setiap sumber dapat dipertanggungjawabkan; tidak ada klaim bahwa token lebih hemat.
- Array assurance yang hilang/salah tipe diteruskan ke validator, bukan diubah menjadi daftar kosong. Tes regresi consumer-visible lulus. Warning validasi tidak dihapus berdasarkan indeks array hasil yang telah difilter.
- Suite integrasi offline: **307/307 lulus**, 0 skip, menggunakan runtime OCR terisolasi. Typecheck dan ESLint untuk file yang diubah lulus. Smoke parser produksi → ekstraksi pada dua workbook: `all_passed=true`, fetch mock, tanpa network/model.
- Uji live: tepat **2 request** ke OpenCode Go, model `glm-5.3-flash`, satu task analisis dan satu domain, maksimum 4096 completion token per request termasuk reasoning, tanpa retry live. Data sintetis; classifier dan summary dimock. Keduanya HTTP 200 (`finish=stop`), 1374+1968 input dan 590+393 completion token. Validator tidak menyelesaikan grup pada attempt pertama; retry berikutnya dihentikan oleh guard budget lokal, sehingga hasil akhir `llm_provider_transient_failure` dan checkpoint `failed`. Penyebab detail penolakan awal tidak disimpan; jangan mengklaim live extraction sukses. Biaya/allowance provider tercatat 0.0005011 + 0.0004917 (provider-reported).
- Tidak ada perubahan stash selama sesi ini. Kode belum siap cutover: quality live, kelengkapan observasi, deduplikasi lintas metode, serta penghematan token perlu pembuktian tambahan. Jangan deploy berdasarkan hasil mock saja.

## Update setelah Terra mengambil alih

- Merge tidak lagi mengubah array domain yang hilang atau salah tipe menjadi array kosong. Tes `missing nested assurance arrays do not become completed empty evidence` lulus.
- Gate kelengkapan lebih konservatif: blok XLSX yang tidak terstruktur tidak dianggap terbukti; jika cakupan grup belum terbukti, hasil derivasi tidak digabung dan model tetap bertanggung jawab. Ini mencegah klaim kelengkapan palsu, tetapi belum menyelesaikan deterministic-first untuk grup campuran.
- Verifikasi terbaru `node --test tests/integration/deterministic-first.test.mjs tests/integration/evidence-provenance.test.mjs tests/integration/phase6-document-extraction.test.mjs`: **66 lulus, 6 gagal** dari 72. Empat kegagalan menunjukkan hasil deterministik yang diharapkan belum dikembalikan pada grup parsial; satu mengungkap masalah scope ambigu dan satu lagi kontrak penggabungan parsial. Tidak ada assertion yang dilemahkan untuk menyembunyikan kegagalan tersebut.
- `npx tsc --noEmit -p tsconfig.json` lulus setelah perubahan.
- `graphify update .` selesai; tidak ada API LLM live yang dipanggil.
- Status sebelumnya di bawah ini adalah catatan run awal; angka pengujian dan temuan merge digantikan oleh update ini.

## Worktree dan stash
Audit read-only: enam stash tercatat. `git diff --name-only 'stash@{0}' -- demo-evidence-fixtures/smart-building-itb` hanya menyebut `smartbuildingdata.zip`; file workbook yang dibandingkan cocok dengan stash tersebut. Tidak ada stash/reset/checkout/clean/restore yang dijalankan pada sesi ini. Perubahan lain tetap milik pengguna dan belum dipisahkan atau dibalik.

## Status
Tiga eksekusi OMP `zcode/glm-5.3-flash` untuk menyelesaikan integrasi berhenti karena deadline; eksekutor meninggalkan perubahan parsial pada `worker/src/services/document-extraction.ts` dan tes. Jangan deploy, jalankan job produksi, atau menganggap varian C selesai sampai temuan di bawah diperbaiki dan diuji.

### Risiko correctness yang teramati
1. Penggabungan `assurance_observations` di worker mengubah `milestones`/`progress` yang bukan array menjadi `[]`, dan field risiko null/missing menjadi `[]`. Ini dapat membuat respons task domain yang cacat terlihat sebagai bukti kosong, bukan failure. Validator harus menerima nilai malformed/missing semula untuk menolaknya; jangan menyintesis array kosong.
2. `deterministicCoverageComplete()` menganggap kelompok XLSX tanpa structured row references sebagai lengkap (vacuous `every`). Sel atau teks XLSX yang tidak diwakili row reference bisa berisi bukti yang terlewat, sementara prompt meminta model melewatkan observasi spreadsheet. Gate harus mempertahankan fallback ketika cakupan tidak terbukti, termasuk row tak didukung atau klaim ditolak.
3. Semua perubahan lain perlu ditinjau terhadap kontrak citation, review, formula cache, checkpoint dan kehilangan data. Implementation saat ini belum di-review penuh.

### Verifikasi yang benar-benar dijalankan
- `npx tsc --noEmit -p tsconfig.json`: exit 0.
- `node --test tests/integration/deterministic-first.test.mjs`: 4 lulus / 2 gagal. `deterministic groups checkpoint as completed and reuse without a model call`: 14 vs 8 panggilan, perlu pisahkan klasifikasi/sintesis dan grup yang belum di-checkpoint. `a group the parser flagged ambiguous keeps candidate-only interpretation and unprocessed coverage`: interpretasi kosong. Tidak diketahui apakah kesalahan ada pada test atau implementasi; jangan melemahkan kontrak untuk membuatnya hijau.
- Tidak ada request API LLM aplikasi dalam sesi ini; uji live belum dijalankan karena implementasi belum aman.
- Tidak ada klaim bahwa full suite, smoke produksi, graph update, atau deterministic-first varian C lulus setelah perubahan parsial.

## Berikutnya
Perbaiki fail-closed merge dan bukti kelengkapan; tambahkan regresi perilaku untuk malformed domain output dan teks XLSX tak terstruktur. Verifikasi checkpoint dan ambiguity dengan mempertahankan perilaku consumer, kemudian jalankan focused test, full suite, typecheck, smoke parser produksi dan update graph. Baru uji live dengan budget global yang ditegakkan sebelum request, termasuk reasoning tokens. Jangan menjalankan provider live sebelum pengujian offline lulus.
