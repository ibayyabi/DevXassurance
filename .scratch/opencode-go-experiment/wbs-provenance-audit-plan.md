# Rencana Terra — audit provenance WBS offline

## Batas

Eksekusi dengan CommandCode model `deepseek/deepseek-v4.1-flash`. CommandCode inference terpisah; **semua pengujian aplikasi offline**: jangan baca `.env*`, API key atau auth store; jangan panggil provider/LLM. Hanya `--dry-run`/replay lokal jika memakai evidence runner. Jangan ubah workbook/expected fixture asli, worker produksi, atau output eksperimen sebelumnya; jangan install dependency/commit. Gunakan `.scratch/opencode-go-experiment/` untuk alat eksperimen, `.local-evaluation/opencode-go-exp-provenance/` untuk output baru. Ikuti AGENTS.md: `graphify query` sebelum pencarian/pembacaan source jika graph ada; `graphify update .` setelah perubahan kode.

## Tujuan

Audit penyebab 216 baris WBS fixture demoted kehilangan per-cell source ID; uji apakah dapat mempertahankan bukti individual tanpa melemahkan guardrail parser. Ini **bukan** otorisasi refactor produksi, dan bukan meminta mengubah parser produksi. Dua opsi wajib diuji: A hanya berikan provenance per-cell jika dapat dibuktikan dengan struktur yang benar; B jika tidak, `review` dengan rujukan baris yang memang ada, jangan mengarang source ID/locator. Tempatkan setiap kode eksperimental di scratch dan uji parser produksi aktual untuk baseline.

## 1. Audit alur parser dan kontrak

- Telusuri dari XLSX OOXML → workbook cells → source blocks → chunking/demotion → `sourceReferences`/`rowCells`, dan validator konsumen; baca lokasi dan kondisi aktual. Jelaskan mengapa referensi hilang dengan bukti source; jangan asumsikan tiap warning adalah sebab.
- Bandingkan dua template dengan sampel W7 `02_Kamera`, `05_Pencahayaan`, `01_Alarm`, `07_Air_Bersih`: identifikasi row/column/header/cell, chunk dan risiko overflow/row-split. Pertahankan source ID per-cell hanya jika parser/prototipe benar-benar menghasilkan referensi terhadap sel itu; row-level + header bukan bukti per-cell.
- Standar penerimaan: per-cell dinyatakan didukung hanya dengan identitas workbook hash/sheet/row/column, header yang tidak ambigu, literal/cache status dan reference nyata yang konsisten; jika row/span ambiguous, metadata hilang, formula untrusted, sumber bertentangan, atau tidak dapat diikat ke output parser, hasil `review`/`unknown`, bukan `found`. Jangan turunkan semua warning jadi bukti aman. Bedakan nilai source tertulis, cached formula dan derived.

## 2. Uji dua jalur secara lokal

- Jalur B konservatif: evaluasi output WBS existing di `.local-evaluation/opencode-go-exp-wbs/all-48/`; baris tanpa per-cell source ID → review, baris per-cell hanya didukung setelah cek kesesuaian secara independen. Catat pembilang/penyebut per workbook/template, alasan, dan jangan memodifikasi output lama.
- Jalur A: bila feasible tanpa melemahkan guardrail, bangun *prototipe terisolasi* yang mempertahankan identitas sel saat parse/split, tidak membuat ID sintetis seolah-olah dari produksi, dan menyatakan dengan jelas jika menggunakan pembaca independen/prototype, bukan parser produksi. Jika tak bisa dibangun aman, jelaskan blocker dan tetap selesaikan jalur B. Jangan memperbaiki validator dengan regex yang menganggap semua tabel WBS aman atau menciptakan source ID dari dugaan kolom.
- Cross-check nilai dengan pembaca workbook independen offline (misal openpyxl jika sudah terinstal) atau OOXML mentah; ulangi mapping workbook/sheet/row/column/header, numeric stored values, scope periode; perhitungan skor berbeda dari extractor. Jika memeriksa sumber yang sama, nyatakan ini verifikasi lokasi, **bukan** ground truth independen untuk makna bisnis/kelengkapan. 0 valid vs blank; date1904/date format; periksa formula/cache tanpa mengeksekusi rumus tak dikenal.
- Bila mungkin jalankan semua 48 workbook W4–W7 (termasuk 216 row-level dan 192 structured), bila tidak output semua yang reachable dan jelaskan missing/errors. Laporkan per opsi (per-cell proven vs review/unknown/false accept), template, periode dan field, dengan denominator yang jelas. Jangan memakai pencocokan index array expected sebagai bukti identitas WBS; input expected tidak boleh memilih kandidat.

## 3. Pengujian negatif dan laporan

- Tes outcome fail-closed secara deterministik: header ganda/salah, kolom percent tertukar, row split/oversized, identitas sheet/row yang salah, nilai kosong vs nol, format percent/raw, 1900/1904, formula kosong/invalid, data yang bertentangan dan duplicate WBS. Gunakan objek sintetis atau salinan sementara; jangan mengubah fixture asli. Uji juga bahwa keputusan B tidak memberikan `found` tanpa per-cell evidence.
- Verifikasi regresi terarah: jalankan `node .scratch/opencode-go-experiment/verify-wbs-offline.mjs`, `node .scratch/opencode-go-experiment/verify-v3.mjs`, runner dan skor baru secara offline. Jangan menjalankan API LLM bahkan jika ada missing evidence; catat unresolved.
- Simpan rencana/prototype/verifier, log, dan laporan `.scratch/opencode-go-experiment/report-wbs-provenance.md`, termasuk perintah, detail perubahan, formula penerimaan, coverage, nilai error dan hasil uji negatif. Nyatakan dengan jelas apakah A terbukti feasible untuk masing-masing template atau hanya B aman; jangan klaim akurasi bisnis atau kesegaran cache dari cross-check. Identifikasi gap sebelum implementasi produksi. Update README bila ada runner baru.
