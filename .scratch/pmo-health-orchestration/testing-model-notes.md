# Riset awal model khusus testing

Status: penjajakan sumber primer; belum ada model yang dipilih atau diuji. Tidak ada request model live, instalasi, perubahan production, atau pengiriman fixture.

## Pilihan awal

- **Model lokal Qwen3 8B lewat Ollama:** [katalog Ollama](https://ollama.com/library/qwen3:8b) mencantumkan tag `qwen3:8b`; [dokumentasi Ollama](https://docs.ollama.com/capabilities/structured-outputs) menjelaskan format JSON/schema untuk Ollama lokal. Workstation melaporkan RAM fisik 25.769.803.776 byte (24 GiB); `ollama` tidak ditemukan di PATH. Ini belum membuktikan runtime, weights, memori tersedia, performa, panjang konteks yang memadai, lisensi, atau kecocokan dengan pipeline. Perlu cek sebelum memilih; tidak ada instalasi atau pengunduhan yang dilakukan.
- **Gemini Developer API:** [structured output](https://ai.google.dev/gemini-api/docs/structured-output) mendokumentasikan JSON Schema. [Harga dan kebijakan](https://ai.google.dev/gemini-api/docs/pricing) membedakan free tier, yang dapat menggunakan konten untuk peningkatan produk, dan paid tier yang dinyatakan tidak demikian; baca terms yang berlaku untuk akun/region sebelum penggunaan. [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) bergantung model, tier dan project; akses aktual, model, kuota, harga dan konfigurasi akun belum diverifikasi. Hanya data sintetis non-sensitif yang boleh diusulkan untuk pengujian, dan tetap perlu izin eksplisit terlebih dahulu.

## Batas interpretasi

Ollama menyatakan [structured outputs belum didukung di Ollama Cloud](https://docs.ollama.com/capabilities/structured-outputs). Local schema-constrained output atau Gemini tidak otomatis merepresentasikan perilaku aplikasi production dengan `gpt-oss:20b` Cloud; validasi schema dan uji penanganan respons buruk tetap diperlukan. Konfirmasi kompatibilitas bentuk request/response dengan integrasi aplikasi sebelum memilih model. Uji model alternatif tidak membuktikan kualitas model production.

Lanjutkan uji deterministik dengan respons terkendali terlebih dahulu. Tiket 02 masih membutuhkan evaluasi lengkap lisensi, context window, response-shape, akses dan rencana isolasi; tiket 08 tetap membutuhkan izin eksplisit provider, data, batas request, biaya dan environment sebelum live testing.
