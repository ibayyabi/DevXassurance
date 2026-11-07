# Pengujian lanjutan — evidence-first

## Konteks dan batas

Eksperimen terisolasi, bukan perubahan produksi. Model: `deepseek-v4.1-flash` melalui OpenCode Go. Parser produksi saat run baseline melaporkan `document-parser/18`; sumber kode dapat berubah dan hash file output tersimpan per hasil. Dataset: `demo-evidence-fixtures/smart-building-itb`, `expected-results.json`; tidak dikirim ke model. Output lengkap dan log percobaan di `.local-evaluation/opencode-go-exp-v2/` (git-ignored; mungkin memuat isi dokumen).

Run lama `report.md` tidak mengimplementasikan varian C yang direncanakan; jangan gunakan untuk perbandingan.

## C deterministik: 48 workbook × 6 field

Pada W4–W7, masing-masing 12 workbook; 36 workbook W4–W6 dan seluruh W7 dijalankan dengan `--dry-run`, sehingga jika perlu eskalasi tidak ada model yang dipanggil. Empat file W7 juga dijalankan tanpa `--dry-run`; seluruh 7 field yang didukung runner teresolusi deterministik dan menghasilkan 0 request. Ini bukan seluruh kontrak produksi. SB02 dan 05_Pencahayaan adalah development; 01_Alarm dan 07_Air_Bersih adalah holdout W7 yang dipilih sebelum scoring, meskipun semua file berasal dari paket fixture yang sama.

Perbandingan: tanggal dan RAG persis; planned/actual/variance toleransi absolut `0.00005` pada skala fraksi, setara separuh unit digit keempat sesuai presisi ground truth; risk ID sebagai set persis. Unknown dihitung tidak cocok, bukan dianggap daftar kosong. Tidak semua field/risk diuji dalam semua dimensi semantik.

| Field | Cocok / total |
|---|---:|
| Tanggal cut-off | 48/48 |
| Planned % | 48/48 dengan toleransi; 38/48 bila toleransi 0.000001 |
| Actual % | 48/48 |
| Variance | 48/48 dengan toleransi; 38/48 bila toleransi 0.000001 |
| RAG | 48/48 |
| Set ID risiko open | 44/48; empat `unknown` pada W4, expected daftar kosong |

10 planned dan 10 variance yang tidak cocok ketat berbeda maksimum 0.000037 fraksi dari expected yang dibulatkan empat desimal. Empat unknown tidak boleh ditafsirkan sebagai tidak ada risiko. Angka 284/288 kecocokan memakai toleransi di atas dan menghitung empat unknown sebagai tidak cocok. Tingkat kandidat recall lengkap belum dihitung; kecocokan nilai bukan jaminan provenance atau kebenaran semantik.

C tidak menilai baris WBS, milestone, perubahan risiko antarperiode, cost, MoM atau keseluruhan kontrak produksi. Output risiko deterministik mencantumkan ID sumber tetapi tidak mencantumkan seluruh sel status/prioritas yang mendukung kesimpulan open; provenance belum memadai untuk produksi. Formula cache dipakai dengan peringatan bahwa freshness belum dibuktikan.

## B model pemilih bukti: 4 workbook W7

Dua development (SB02, SB07/05_Pencahayaan) dan dua holdout (SB01, SB08/07_Air_Bersih), 1 request per file, tidak ada cached input yang dilaporkan. Enam field yang sama dinilai pada keempat file. Output mentah cocok 22/24; setelah validator eksperimen, 20/24 field cocok dan berstatus found. Risiko dari semua file ditandai `candidate_mismatch`: validator memperlakukan sel Status/Priority yang ikut dikutip seolah-olah semuanya harus memuat ID. Ini false rejection pada beberapa sitasi pendukung, bukan bukti bahwa semua empat set ID salah. Selain itu model benar-benar melewatkan satu ID risiko open di SB07 dan satu di SB08. Validator ini eksperimen dan bukan validator produksi; perlu diperbaiki serta diuji ulang sebelum menarik kesimpulan provenance.

| Workbook | Kecocokan mentah | Cocok + found | Input / output token | Latensi |
|---|---:|---:|---:|---:|
| SB01 | 6/6 | 5/6 | 3.036 / 2.469 | 23,2 s |
| SB02 | 6/6 | 5/6 | 3.138 / 1.479 | 12,1 s |
| SB07 | 5/6 | 5/6 | 2.415 / 5.038 | 86,6 s |
| SB08 | 5/6 | 5/6 | 2.387 / 3.900 | 42,3 s |

Satu run per file; belum ada pengulangan dan belum ada evaluasi lengkap retrieval recall, false positives, prompt injection, atau validasi sitasi lintas field.

## Baseline A: SB02

Parser dan `extractDocumentGroups()` produksi digunakan; adapter hanya menambahkan header sesi dan mencatat request. Run selesai sebagai **gagal** `llm_provider_transient_failure` setelah 1.363,4 detik, 37 request; tiga rentang chunk gagal meski ada attempt ulang. Provider melaporkan usage untuk 26 request: 127.443 input dan 144.786 output token. Usage 11 request lain tidak tersedia, maka total sebenarnya tidak diketahui. Tidak ada hasil dokumen final untuk perbandingan akurasi. A memproses cakupan yang lebih luas daripada B/C; angka token/waktu tidak membuktikan perbandingan apple-to-apple.

## Uji negatif terarah

- W4 SB01, tidak ada baris risiko yang terindeks: C mempertahankan lima field lain deterministik dan meminta model hanya untuk `open_risk_ids` dan `risk_entries`. Model menjawab `unknown`, bukan `[]`; 1 request, 2.613 input dan 190 output token. Ini perilaku hati-hati, tetapi ground truth kosong tidak dapat dinyatakan terverifikasi dari hasil ini.
- Salinan sementara SB01 W7 dengan cache formula E10/F10 dikosongkan: C menghitung variance `actual - planned` dan mencatat rumus/input; RAG tetap unknown dan dieskalasi. Live fallback mengembalikan unknown (1 request, 2.874 input / 135 output). Hasil derived bukan cache asli workbook.
- Salinan kedua dengan rumus E10 diubah menjadi `D10+C10` dan cache dikosongkan: runner tetap mengeluarkan variance turunan `actual - planned` serta menerima RAG cache sebelumnya. Hasil itu bukan evaluasi rumus sumber yang telah diubah; kesesuaian rumus, invalidasi cache dependen, dan freshness memerlukan guardrail. Uji ini tidak berarti nilai derived tidak boleh didefinisikan oleh aturan domain, tetapi tidak boleh disajikan sebagai hasil formula sumber atau membuktikan cache dependen valid.

## Keputusan

Prototipe deterministik menjanjikan untuk enam field fixture, tetapi **belum layak menjadi refactor produksi**: validasi status/priority dan provenance harus lengkap, kondisi `unknown` dan rumus/cache perlu ditangani secara aman, serta kontrak di luar subset belum tercakup. Baseline tidak menyelesaikan dokumen, dan kualitas full-document maupun biaya total setara belum dibandingkan. Simpan log dan hasil sebagai bukti percobaan, bukan benchmark final.
