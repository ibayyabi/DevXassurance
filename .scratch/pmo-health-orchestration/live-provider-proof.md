# Bukti live pipeline dokumen — OpenRouter & 9router

**Tanggal:** 2026-11-06 · **Worktree:** `/private/tmp/pmo-integration-resume` (`integration/pmo-health-orchestration` @ `074f7d0`)
**Harness:** `npm run test:e2e:live` → `tests/e2e/live-provider-smoke.mjs` (pipeline ekstraksi asli worker: klasifikasi dokumen → ekstraksi per grup dengan koreksi → executive summary; teks uji sintetis, stub DB, tidak menulis Supabase).
**Kredensial:** key sementara dari user, sudah di-revoke setelah run.

## Hasil

| Provider | Konfigurasi model | Panggilan pipeline | Semua attempt sukses | Status akhir |
|---|---|---|---|---|
| **OpenRouter** | `openai/gpt-4o-mini` via `https://openrouter.ai/api/v1` | 4 — `classify`, `group` ×2, `summary` | ✅ 4/4 (`success: true`) | ✅ `strict extraction completed` (exit 0) |
| **9router** | `cmc/deepseek/deepseek-v4-flash` via `http://localhost:20128/v1` | 4 — `classify`, `group` ×2, `summary` | ✅ 4/4 (`success: true`) | ✅ `strict extraction completed` (exit 0) |

Latensi terobservasi (9router): group attempt 1 ≈ 37,6 s, group attempt 2 ≈ 14,9 s, summary ≈ 15,1 s. OpenRouter (gpt-4o-mini): total run jauh lebih cepat (attempt pertama ≈ 1,6 s).

## Perintah reproducible

### OpenRouter

```bash
cd /private/tmp/pmo-integration-resume
XASS_LLM_PROVIDER=openai-compatible \
XASS_CLOUD_LLM_BASE_URL=https://openrouter.ai/api/v1 \
XASS_CLOUD_LLM_API_KEY=<key> \
XASS_CLOUD_LLM_MODEL=openai/gpt-4o-mini \
XASS_LLM_TIMEOUT_MS=120000 \
npm run test:e2e:live
```

### 9router

```bash
cd /private/tmp/pmo-integration-resume
# 9router harus jalan dulu: `9router` (listen di 127.0.0.1:20128)
XASS_LLM_PROVIDER=openai-compatible \
XASS_CLOUD_LLM_BASE_URL=http://localhost:20128/v1 \
XASS_CLOUD_LLM_API_KEY=<key> \
XASS_CLOUD_LLM_MODEL=cmc/deepseek/deepseek-v4-flash \
XASS_LLM_TIMEOUT_MS=120000 \
npm run test:e2e:live
```

Tidak ada perubahan kode antara kedua run — hanya env. Keduanya masuk lewat branch
`openai-compatible` di `src/lib/ai/provider.ts` (matrix provider bersama app + worker),
dengan `response_format: { type: "json_object" }` untuk semua tahap, sesuai kontrak
ekstraksi strict worker.

## Log ringkas (transcript asli)

**OpenRouter** (log penuh: `/tmp/xass-smoke-openrouter.log` saat run):

```
Document extraction attempt completed { stage: 'classify', ... success: true }
Document extraction attempt completed { stage: 'group', groupIndex: 0, attempt: 1, durationMs: 1645, success: true }
Document extraction attempt completed { stage: 'group', groupIndex: 0, attempt: 2, success: true }
Document extraction attempt completed { stage: 'summary', attempt: 1, success: true }
Live provider smoke: strict extraction completed for generated synthetic evidence.
```

**9router:**

```
Document extraction attempt completed { stage: 'group', groupIndex: 0, attempt: 1, durationMs: 37586, success: true }
Document extraction attempt completed { stage: 'group', groupIndex: 0, attempt: 2, durationMs: 14931, success: true }
Document extraction attempt completed { stage: 'summary', attempt: 1, durationMs: 15112, success: true }
Live provider smoke: strict extraction completed for generated synthetic evidence.
```

## Catatan

- `group` berjalan 2 attempt bukan karena kegagalan — attempt kedua adalah koreksi
  (`extractGroupWithCorrection`): attempt 1 hasil ekstraksi, attempt 2 verifikasi/koreksi
  terhadap hasil itu. Keduanya `success: true`.
- 9router lebih lambat (~15–38 s per tahap) dibanding gpt-4o-mini via OpenRouter (~2 s),
  wajar untuk deepseek-v4-flash melalui gateway lokal.
- Smoke ini tidak mengubah file konfigurasi production dan tidak menulis database.
