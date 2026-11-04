# Isolasi model pengujian — evaluasi kandidat (tiket 02)

**Tanggal evaluasi:** 2026-11-04 · **Branch:** `ticket/pmo-health-02` (dari `db96485`) · **Basis:** `plan.md` slice 02 dan tiket 02.
**Batasan yang dipatuhi:** read-only. Tidak ada request model live, tidak ada instalasi/unduhan, tidak ada perubahan source atau konfigurasi production, tidak ada fixture atau data proyek dikirim ke provider, tidak ada nilai secret dibaca atau dicatat (hanya nama variabel dan status terisi/kosong). Tidak ada build/lint/test/formatter dijalankan.

## 1. Bukti konfigurasi integrasi aplikasi (dari source, bukan asumsi)

Dibaca langsung di `worker/src/services/document-extraction.ts` (fungsi `configuredModelProvider`, `requestModel`, `extractGroupWithCorrection`, `classifyDocument`) dan `src/lib/ai/ollama.ts`. Simbol yang dipakai jalur ini (`buildExtractionPrompt`, `citationHasUnavailableFormula`, `ParsedSourceReference`) terverifikasi ada di source; verifikasi source ini menggantikan pembacaan graf.

| Aspek | Kondisi aktual |
|---|---|
| Pemilihan provider | Satu variabel `XASS_LLM_PROVIDER` ∈ `ollama` \| `ollama_cloud` \| `openai-compatible` \| `gemini` \| `groq`. **Tidak ada fallback otomatis**: provider salah/ kurang konfigurasi → throw, bukan pindah provider. |
| Bentuk request (worker) | `ollama`: POST `{OLLAMA_BASE_URL}/api/chat`, tanpa field `format`. `ollama_cloud`: `/api/chat` **dengan** `format:"json"`. `groq`/`openai-compatible`: `/chat/completions` dengan `response_format:{type:"json_object"}`. `gemini`: `{base}/models/{model}:generateContent` dengan `responseMimeType:"application/json"`. Semua `temperature: 0`, `stream: false`. |
| Bentuk response yang diterima | `ollama`/`ollama_cloud` → `message.content` (atau `response`); OpenAI-compatible → `choices[0].message.content`; gemini → `candidates[0].content.parts[0].text`. Envelope di-parse `JSON.parse`; respons > `MAX_PROVIDER_RESPONSE_BYTES` (1.000.000 byte) ditolak. |
| Struktur panggilan per dokumen | 1× klasifikasi dokumen + 1× ekstraksi per grup + 1× executive summary. `MAX_GROUP_ATTEMPTS = 2` per tahap; `MAX_CONCURRENT_PROVIDER_REQUESTS = 2`. |
| Batas input | `MAX_DOCUMENT_GROUPS = 32`, `MAX_GROUP_CHUNKS = 3` (maks 96 chunk), `MAX_GROUP_CHARACTERS = 10_000` per grup, ±320.000 karakter per dokumen. |
| Timeout | `XASS_LLM_TIMEOUT_MS`, default 120.000 ms, di-clamp ke 5.000–300.000 ms. |
| Error tak terduga | HTTP 408/429/≥500 → `TransientProviderError` (retryable), lainnya error permanen. |

**Harness live yang sudah ada:** `tests/e2e/live-provider-smoke.mjs` (`npm run test:e2e:live`). Bukti dari source: sumber teks **sintetis inline** (bukan file unggahan), `loadGroups`/`saveGroup` adalah stub (tidak menulis DB), satu chunk → satu grup → **≈3 panggilan provider per run, batas atas 6 menurut konstanta kode `MAX_GROUP_ATTEMPTS=2` (belum diobservasi karena belum ada run)**. Ini seam pengujian terisolasi yang tepat; tidak perlu harness baru.

**Lingkungan lokal (terukur, 2026-11-04):** Apple M4, macOS 27.0.1, RAM 25.769.803.776 byte (24 GiB), 10 CPU, disk bebas 79 GB. `ollama` tidak ada di PATH, `Ollama.app` tidak ada, tidak ada server di `localhost:11434`, `~/.ollama` tidak ada, LM Studio/llama.cpp/MLX tidak ada. `docker` tersedia (`/opt/homebrew/bin/docker`), Python `torch 2.15.0` + `transformers 5.17.0` tersedia. Di checkout utama `.env.local` ada dan **semua** nama variabel provider (termasuk `OLLAMA_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `XASS_CLOUD_LLM_API_KEY`) terisi; nilainya tidak dibaca, dan validitas/pemilik kuotanya tidak dapat diverifikasi tanpa panggilan live.

## 2. Kandidat (sumber primer)

| Kandidat | Konteks / ukuran | JSON | Rate limit & biaya | Lisensi / privasi | Hardware | Verdict |
|---|---|---|---|---|---|---|
| **`gpt-oss:20b` lokal via Ollama** | Tag Ollama **12,8 GB**; jendela konteks **131.072** token ([Ollama](https://ollama.com/library/gpt-oss:20b), [OpenAI model card](https://developers.openai.com/api/docs/models/gpt-oss-20b)) | `/api/chat` mendukung `format` JSON **dan JSON Schema**; juga tersedia lewat API OpenAI-compatible via `response_format` ([dok struktur](https://docs.ollama.com/capabilities/structured-outputs)) | Tidak ada kuota/biaya pihak ketiga; hanya listrik & disk | **Apache 2.0** (21B param, 3,6B aktif, MoE MXFP4) — tanpa batasan copyleft/patent | Model dijalankan **dalam 16 GB memori** (kartu resmi); workstation 24 GiB → cukup tipis; latency M4 belum diukur | **Pilihan utama**, tetapi runtime + weights belum ada → perlu izin instalasi/unduhan (§4) |
| **Groq `openai/gpt-oss-20b`** | Nama/keluarga model sama dengan production; identitas bobot, kuantisasi, versi dan serving **tidak dibuktikan** oleh sumber mana pun; konteks mengikuti gpt-oss (131k) | Branch `groq` yang sudah ada mengirim `response_format:{type:"json_object"}` | Free/Developer: **30 RPM, 1.000 RPD, 8K TPM, 200K TPD** ([rate limits](https://console.groq.com/docs/rate-limits)) | **Tidak menyimpan data pelanggan secara default** (log 30 hari hanya untuk reliabilitas/abuse, ZDR tersedia); hosting GCP US ([Your Data](https://console.groq.com/docs/your-data)) | Hosted; 8K TPM berisiko 429 untuk grup 10.000 karakter | **Alternatif tanpa instalasi**; perlu key terpisah + izin |
| **Gemini Developer API (branch `gemini`)** | Hingga 1M token input | `responseMimeType:"application/json"` sudah dikirim branch `gemini` | Kuota per **project**, bukan per key; limit aktual harus dilihat di AI Studio ([rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)) | Free tier: **konten dipakai untuk meningkatkan produk Google**; paid: tidak ([pricing](https://ai.google.dev/gemini-api/docs/pricing)) | Hosted | Hanya bila fixture sintetis + izin; model **bukan** gpt-oss |
| ~~Ollama Cloud `gpt-oss:20b`~~ | — | Structured outputs **tidak didukung** di cloud ([dok](https://docs.ollama.com/capabilities/structured-outputs)) | **Kuota production** | Data ke pihak ketiga | — | **Ditolak**: melanggar isolasi (model + kredensial production) |
| ~~OpenRouter free router~~ | Identitas model bisa berubah | Variatif | 20 RPM / 50 RPD, risiko fallback ke model berbayar | — | Hosted | Ditolak: identitas/kuota tidak dapat dipin |
| ~~DeepSeek via commandcode~~ | — | — | — | — | — | Ditolak untuk peran ini: alat subagent engineering, bukan branch provider aplikasi, sehingga tidak menguji bentuk response aplikasi |

## 3. Rekomendasi

**Pin yang diusulkan (utama): `gpt-oss:20b` lokal melalui Ollama, terintegrasi lewat branch `ollama` yang sudah ada.**
Alasan: (a) satu-satunya kandidat dengan kuota dan biaya **nol** serta tidak ada data yang meninggalkan mesin; (b) memakai **nama/keluarga model yang sama** dengan production (`gpt-oss:20b`, Apache 2.0) — ini klaim kesamaan nama model saja, **bukan** bukti bobot, kuantisasi, versi, atau serving yang identik dengan Ollama Cloud, dan bukan jaminan kedekatan bentuk keluaran; (c) runtime-nya adalah yang direkomendasikan kartu model resmi untuk hardware konsumen; (d) tidak memerlukan perubahan source atau konfigurasi production.

**Alternatif bila user tidak menginginkan unduhan 12,8 GB: Groq `openai/gpt-oss-20b`** (nama model sama, tanpa instalasi) melalui branch `groq`, dengan key **terpisah** dan kesadaran bahwa 8K TPM dapat menimbulkan 429 pada grup besar. **Gemini** hanya jika user menerima model non-gpt-oss dan kebijakan free tier yang memakai konten untuk peningkatan produk.

### Blocker yang dicatat jujur
Kapasitas lokal **belum terbukti ada**: runtime Ollama, weights, dan server lokal tidak ada di workstation. Menginstal Ollama + mengunduh 12,8 GB adalah instalasi/unduhan yang **tidak diizinkan** pada tiket ini, dan validitas key hosted tidak dapat diuji tanpa panggilan live. Karena itu kandidat di atas **belum boleh dijalankan**: status eksekusi = **blocked menunggu persetujuan user** (izin instalasi lokal, atau izin key hosted + anggaran request). Sampai itu, seluruh pengujian deterministik dengan respons terkendali tetap berjalan dan tidak terhalang.

**Blocker kedua (penegakan batas):** batas request/biaya di §4 saat ini hanya **usulan prosedural**, bukan kontrol yang ditegakkan. Worker sendiri me-retry error transien (termasuk 429/5xx) sampai `MAX_GROUP_ATTEMPTS = 2` per tahap, dan tidak ada proxy pembatas/penghitung request atau mekanisme kill yang teridentifikasi di workstation maupun di harness smoke. Jadi larangan "berhenti pada 429/5xx pertama" bergantung pada operator manusia dan dapat dilanggar oleh retry internal maupun pengulangan run. **Verifikasi live tetap blocked sampai ada mekanisme pembatas/stop eksternal yang sudah diuji (mis. proxy penghitung request, pembatas jaringan, atau batas akun provider yang nyata) atau kode diubah** — keduanya di luar lingkup read-only tiket ini.

## 4. Desain eksekusi terisolasi (bila disetujui)

1. **Tanpa mengubah file konfigurasi production.** Jalankan dari worktree `../DevXassurance-pmo-health-02` (worktree tidak memiliki `.env.local`, hanya `.env.example`). Variabel disetel **per proses** di shell; `loadEnvConfig` pada @next/env tidak menimpa `process.env` yang sudah ada, jadi `.env.local` production tetap tidak tersentuh.
2. **Konfigurasi test terpisah (pin eksplisit):** `XASS_LLM_PROVIDER=ollama`, `OLLAMA_BASE_URL=http://127.0.0.1:11434`, `OLLAMA_MODEL=gpt-oss:20b`, `XASS_LLM_TIMEOUT_MS=120000`. Jangan set `XASS_LLM_PROVIDER=ollama_cloud`.
3. **Fallback dimatikan:** tidak ada fallback di dalam kode dan tidak boleh ditambahkan; satu provider per run.
4. **Data uji:** hanya teks sintetis inline milik harness, atau fixture sintetis repo. **Tidak ada dokumen proyek nyata**, tidak ada `expected-results.json` dikirim, dan izin fixture harus dinyatakan user sebelum run live.
5. **Database:** smoke memakai stub store (tidak menulis DB). Untuk verifikasi integrasi (tiket 08) gunakan database lokal/proyek test terpisah, bukan Supabase hosted.
6. **Kredensial:** key hosted harus key/akun **terpisah dari `OLLAMA_API_KEY` production**; key production tidak boleh dipakai (kuota production). Tidak ada key di file yang di-commit, log, atau workflow JSON.

### Batas request/biaya yang **diusulkan** (bukan kontrol yang sudah diimplementasikan/ditegakkan)
Semua angka di bawah adalah usulan kebijakan untuk user; belum ada kode, proxy, atau mekanisme kill yang menegakkannya (lihat "Blocker kedua" di §3). Angka ini hanya dapat dipakai sebagai anggaran yang dipantau manual, dan **bukan** pengganti kontrol penegakan.

- Default: **0 request live** — ini satu-satunya batas yang saat ini benar-benar berlaku, karena belum ada panggilan live yang diotorisasi.
- Run lokal pertama (setelah izin): **1 dokumen sintetis, 1 chunk/1 grup, perkiraan 6 request provider, satu kali run**; rumus 3 tahap × `MAX_GROUP_ATTEMPTS=2`. Angka 6 adalah **estimasi batas atas retry internal**, bukan jaminan: tanpa pembatas eksternal, run ulang oleh operator dapat melewatinya.
- Bila memakai hosted (Groq/Gemini): usulan **≤ 20 request dan ≤ 100.000 token input total**, ≤ 3 request/menit (di bawah 30 RPM Groq), hanya free tier. "Berhenti pada 429/402/5xx pertama" adalah **instruksi operator**, bukan perilaku kode: worker justru akan me-retry error transien sampai `MAX_GROUP_ATTEMPTS=2` per tahap. Jangan mengubah kode/harness untuk menambah penghitung request di tiket ini.
- Timeout tetap `XASS_LLM_TIMEOUT_MS=120000` (clamp kode 5.000–300.000 ms). Ini satu-satunya parameter di bagian ini yang memang ditegakkan oleh kode.

### Rollback
Variabel test hilang saat shell ditutup (`unset`/hapus file env test); hentikan server lokal (`ollama stop gpt-oss:20b`) atau matikan proses serving; hapus DB/proyek test lokal. Karena tidak ada file production yang diubah dan tidak ada mutasi Supabase hosted, rollback tidak menyentuh production. Bila key hosted terpisah dipakai, cabut key tersebut. Artefak hasil test tidak di-commit.

## 5. Batas interpretasi (wajib dinyatakan)

Hasil model pengujian **tidak membuktikan kualitas `gpt-oss:20b` production**. Nama model yang sama (lokal via Ollama, atau Groq) **tidak** membuktikan bobot, kuantisasi, versi, atau serving stack identik dengan Ollama Cloud — tidak ada bukti provider untuk itu — dan juga tidak menyamakan panjang konteks efektif atau kuota Ollama Cloud. Selain itu, branch `ollama` lokal **tidak mengirim `format:"json"`** (cloud mengirim), sehingga jalur lokal justru menguji enforcement yang lebih lemah; hasil lulus/gagal lokal tidak dapat dipindahkan sebagai klaim kualitas production. Sign-off akhir tetap memerlukan validasi terbatas `gpt-oss:20b` production atas izin user (tiket 08, plan §"Keputusan yang masih terbuka" 3).

## 6. Ketidakpastian & yang belum diverifikasi

- Tag Ollama belum dipin ke digest; setelah pull, catat digest dari `ollama show gpt-oss:20b --modelfile`/`--verbose`.
- Panjang konteks efektif lokal bergantung `num_ctx`/`OLLAMA_CONTEXT_LENGTH`; harus diverifikasi dengan `ollama ps` sebelum run, jangan mengasumsikan 131k.
- Latensi M4 (GPU 10 core, 24 GiB) belum diukur; prompt grup hingga 10.000 karakter + keluaran JSON panjang dapat mendekati timeout 120 s.
- Perilaku gpt-oss (format harmony, token reasoning) di `/api/chat` lokal belum diamati; ada risiko JSON di dalam `message.content` tidak bersih. Ini harus **diobservasi**, bukan diasumsikan.
- Validitas/plan/key hosted (Groq, Gemini, `XASS_CLOUD_LLM_*`) belum diverifikasi; hanya keberadaan variabel yang terisi yang terbukti.
- Bila memakai `XASS_LLM_PROVIDER=openai-compatible` menuju `/v1` Ollama lokal untuk mendapat enforcement `response_format`, cabang kode yang diuji berbeda dari branch `ollama`; pilih satu dan catat sebagai bagian konfigurasi test.

## 7. Perintah verifikasi (untuk integrator; belum dijalankan)

Setelah persetujuan izin dan (di worktree baru) `npm ci`:
**Status saat ini: BLOCKED.** Jangan jalankan perintah di bawah sampai (1) user memberi izin eksplisit (instalasi lokal atau key hosted + anggaran request) **dan** (2) ada mekanisme pembatas/stop eksternal yang sudah diuji, atau kode diubah untuk menegakkan batas request (§3 "Blocker kedua"). Tanpa syarat (2), batas §4 hanya instruksi manual dan retry internal worker tetap dapat melewatinya.

```bash
cd ../DevXassurance-pmo-health-02
npm ci
# lokal (setelah ollama terpasang + ollama pull gpt-oss:20b):
XASS_LLM_PROVIDER=ollama OLLAMA_BASE_URL=http://127.0.0.1:11434 OLLAMA_MODEL=gpt-oss:20b XASS_LLM_TIMEOUT_MS=120000 npm run test:e2e:live
# hosted terisolasi (key terpisah; batas §4 masih usulan, belum ditegakkan):
XASS_LLM_PROVIDER=groq GROQ_API_KEY=<key-test-terpisah> GROQ_MODEL=openai/gpt-oss-20b npm run test:e2e:live
```

Harapan: `Live provider smoke: strict extraction completed…` dengan sekitar 3 panggilan provider (maks 6 bila retry internal terpakai) terhadap teks sintetis; kegagalan harus terlihat sebagai `errorCode`, bukan fallback. Catat model/versi, jumlah panggilan, latensi, dan limitation. Tidak ada build/lint/test lain yang dijalankan pada tiket ini.

## Sumber

- [Ollama gpt-oss:20b](https://ollama.com/library/gpt-oss:20b) · [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs)
- [OpenAI gpt-oss-20b model docs](https://developers.openai.com/api/docs/models/gpt-oss-20b) · [kartu model Hugging Face (Apache 2.0, MXFP4, ≤16 GB)](https://huggingface.co/openai/gpt-oss-20b)
- [Groq rate limits](https://console.groq.com/docs/rate-limits) · [Groq Your Data](https://console.groq.com/docs/your-data)
- [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) · [Gemini pricing & free-tier data use](https://ai.google.dev/gemini-api/docs/pricing)
