# Rencana pengujian offline — provenance dan risiko terlewat

## Aturan operasional

User meminta Terra menyusun rencana dan CommandCode `deepseek/deepseek-v4.1-flash` mengeksekusi. CommandCode sendiri menggunakan model untuk bekerja; **pengujian aplikasi harus offline**: jangan membaca `.env*`, API key, auth store, atau mengirim request ke API LLM/provider/model. Jangan menjalankan `run.mjs`, `baseline-v2.mjs`, atau `evidence-v2.mjs` tanpa `--dry-run`/`--replay`. Jangan menyuntik fake output sebagai hasil model nyata. Worktree bersama: jangan ubah worker produksi, fixture asli, atau hasil v2/v3; tulis artefak baru di `.local-evaluation/opencode-go-exp-offline/` dan laporan baru `.scratch/opencode-go-experiment/report-offline.md`. Jangan commit. `graphify query` sebelum source search/read; setelah perubahan kode `graphify update .`.

## 1. Diagnosis SB07/SB08 terhadap rekaman historis

- Periksa rekaman B v2 + replay v3 `05_Pencahayaan` (SB07), `07_Air_Bersih` (SB08), dan ground truth W7. Identifikasi setiap ID risiko open yang semestinya ada vs output model.
- Untuk masing-masing ID yang terlewat, periksa struktur baris pada parser/evidence index, ID source, sel status dan source ID, `context.risk.included_source_ids`, `context.cap.dropped_source_ids`, potensi pemotongan deskripsi, dan apakah output mentah model/validator memuatnya. Pisahkan fakta teramati dari inferensi. Jika prompt exact tidak tersimpan, jangan klaim konten model benar-benar terlihat kecuali daftar source ID atau hasil relevan membuktikannya. Jika ID masuk konteks tetapi tidak ada di response, sebut omission model pada rekaman tersebut, bukan sifat umum model.
- Laporkan candidate recall berdasarkan set ID/status expected dan evidence yang tercakup, per file dan denominator. Bedakan candidate ditemukan, masuk konteks, dipilih model, lolos validator; raw expected tidak dimasukkan ke prompt/replay.

## 2. Audit dan pengujian offline

- Uji semantik provenance: ID/status/priority baris sama, ID/status beda baris atau beda sheet, duplikasi ID, status kosong/ambigu/closed, ID tidak tersitasi, ID tidak ada, source ID tidak valid, tidak ada bukti, dan context yang terpotong. Untuk field nilai numerik dan tanggal uji sitasi kolom/row/period berbeda, salah konteks dan daftar sitasi kosong; jangan terima `found` tanpa bukti lengkap. Uji provenance dari hasil C: sumber ID dan status memiliki nilai dan sheet/row sesuai; scorer v3 menguji kelengkapan struktur, bukan verifikasi independen seluruh klaim.
- Uji keamanan formula: cache kosong/error/missing, formula changed plus, RAG cache bertentangan, threshold boundaries dan fallback model tidak boleh melewati review. Gunakan test sintetis deterministic, tidak mengubah workbook fixture. Eksplisit cek derived vs cache, tanpa mengklaim freshness cache pasti.
- Jika menemukan bug aktual di harness eksperimen yang mengakibatkan klaim salah/validator menerima unsupported, perbaiki fail-closed di `.scratch/opencode-go-experiment/evidence-v2.mjs`, tambahkan tes perilaku. Jika perlu fitur yang belum bisa diimplementasikan aman, tandai known limitation, jangan melemahkan guardrail. Jangan mengubah worker produksi. Field risk set yang benar sebagian tidak boleh direpresentasikan sebagai lengkap jika seluruh kandidat diketahui belum tercakup; tetap tampilkan provenance parsial dan status review/ambiguous, bukan rekaan fakta baru.
- Perbedaan konteks yang dieksklusi atau WBS/cost/milestone yang tidak dinilai harus terlihat; jangan menarik kesimpulan tentang seluruh dokumen hanya dari sebagian sheet.

## 3. Hasil yang dapat direproduksi

- Rerun test lokal, empat sesi × 12 workbook C dengan `--dry-run`, dan replay jawaban B historis dengan `--replay` ke direktori baru. Scoring 6 field: tanggal/RAG/set ID exact, numerik toleransi 0.00005 fraksi; pisahkan value match, source/provenance structural, status found vs review/unknown, dan false accept. Jangan hitung unknown sebagai daftar kosong. Rekam denominators.
- Jangan overclaim: replay adalah respons historis, perubahan prompt/model baru belum teruji; 48 workbook satu fixture-family bukan generalisasi; cache freshness belum dibuktikan; dokumen produksi lain belum dinilai. Tidak ada API usage baru untuk pengujian.
- Tulis laporan `.scratch/opencode-go-experiment/report-offline.md` lengkap: perintah lokal, SB07/SB08 temuan, metrik + pembatasannya, positive/negative tests, perubahan harness, rekomendasi, pernyataan tidak ada request LLM dari pengujian. Update README harness jika ada cara run/replay baru.
