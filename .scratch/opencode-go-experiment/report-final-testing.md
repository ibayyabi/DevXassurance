# Laporan: ronde pengujian final — robustness pipeline terhadap file input yang ada

Tanggal: 2026-11-07. Eksekutor: GLM 5.3 Flash via Zcode. Metode: matriks celah dari 20+ laporan sebelumnya → satu ronde pengujian (sweep korpus offline, mutasi edge offline, live terkontrol) → remediasi → verifikasi penuh.

## Cara ronde ini dirancang

Sebelum mengeksekusi, seluruh laporan dan rencana di `.scratch/opencode-go-experiment/` dipindai menjadi matriks celah konsolidasi (kategori: parser, derivasi deterministik, semantik validator, checkpoint/cache, klasifikasi/ringkasan live, OCR, token vs baseline, lintas-dokumen, end-to-end live + ground truth, cost, prompt injection). Ronde ini menutup celah yang dapat dibuktikan tanpa ground truth manusia/DB produksi/E2E browser; sisanya dicatat ulang sebagai blocker terpisah.

## Fase 1 — Sweep korpus penuh (offline, 0 token)

`final-corpus-sweep.mjs`: parser produksi + `extractDocumentGroups` (model mock) atas **100 file input** dari 5 keluarga fixture (48 XLSX mingguan + 4 baseline ITB, 9 XLSX realistic-pmo, 22 DOCX, 6 PDF, 6 CSV, 6 TXT — hanya file dengan ekstensi input).

- **100/100 parse OK, 100/100 extract OK, 0 crash, 0 parse failure.**
- Beban live ekuivalen terukur: 2.930 request untuk seluruh korpus (~29/file; maksimum 58/file) — angka perencanaan biaya untuk run live penuh.
- **TEMUAN BESAR**: derivasi deterministik produksi menghasilkan **0 baris progress** di seluruh korpus (milestone hanya 7 file), padahal laporan eksperimen mengklaim 284–408 nilai pada workbook yang sama. Deterministic-first diam-diam tidak pernah aktif untuk file nyata.

### Akar masalah (diagnosis + perbaikan)

1. **Persen numerik tak terlihat**: workbook nyata menyimpan persen sebagai angka berformat (`raw "0.125"`, tampilan `"12.5%"`); gate derivasi menguji `rawValue` berbentuk persen (`/^(.*)%\s*$/`) sehingga tidak pernah cocok, dan klaim memakai `rawValue` sebagai `raw_value` yang tidak akan pernah ada di excerpt.
2. **Ledakan varian as_of**: varian `as_of_date` diambil dari SEMUA sel bertanggal (Baseline Start/Finish, Forecast) bukan hanya kolom record-date → klaim tak valid bermunculan, memicu `MAX_DETERMINISTIC_CLAIMS_PER_ARRAY` → `overCap` **menghapus seluruh klaim grup termasuk milestone yang sah** (itu sebabnya milestone hanya 7 file).
3. **Label non-progress lolos proposal**: gate lama mengusulkan klaim dari sel persen berlabel apa pun (mis. `Weight: 8%` akan menjadi "observasi progress" palsu).

**Perbaikan** (`document-extraction.ts`, cache `/38` → `/39`):
- `percentShapedClaimText()` — menerima bentuk teks maupun angka-berformat-persen; klaim selalu memakai bentuk tampilan yang ada di excerpt.
- Varian as_of hanya dari kolom ber-cue record (`isRecordDateColumn`, classifier yang sama dengan validator).
- Eligibility sel persen: label harus membuktikan progress (atau kosong) dan tidak pernah label metrik risiko — regex `RISK_METRIC_LABEL`/`PROGRESS_METRIC_LABEL` di-hoist ke modul dan dipakai bersama validator (tidak ada drift).
- `citedPercentCellForClaim()` dan dedup fallback diperluas mengenali bentuk tampilan (mencegah duplikasi deterministik+model pada sel persen numerik).

**Bukti setelah perbaikan** (sweep ulang): **48/48 workbook mingguan menurunkan progress deterministik — total 408 baris progress + 248 milestone** di korpus, 0 eksklusi validator, 0 warning. Nilai terverifikasi contoh: scope 2.1 → 82,5%, scope 1.1 → 100% (kolom `% Complete` asli). Regresi baru: `deterministic-first.test.mjs` "percent-formatted numeric cells derive deterministic progress; non-progress percent labels stay model work" (numerik 0.125 → klaim `12.5%` + as_of cut-off + period W4 + scope WBS; Weight 8% tidak diturunkan).

## Fase 2 — Matriks mutasi edge (offline, 0 token)

`final-edge-mutations.mjs` — 4/4 PASS:

| Kasus | Hasil |
|---|---|
| Zip XLSX dikorup (60% trailing) | `office_package_invalid` — gagal eksplisit, tanpa crash |
| Dua kolom record-date bernilai beda | 0 klaim as_of diturunkan — ambiguitas tidak pernah diklaim; baris jatuh ke jalur model (fail-closed) |
| Baris milestone identik terduplikasi | 2 baris observasi dengan sitasi baris masing-masing — duplikasi copy-paste tetap terlihat, tidak dilipat diam-diam |
| Rerun hangat workbook nyata (22 grup, 8 ambigu-flag parser) | 14 grup completed **tidak dipanggil ulang**; hanya 8 grup ambigu yang di-retry (34 panggilan ≤ budget retry) |

Temuan tambahan dari diagnosis kasus: judul sheet yang menempel langsung pada baris header membuat deteksi header gagal → label kolom null → derivasi 0 klaim (fail-closed, tanpa fabrikasi) — perilaku konservatif yang benar, dicatat sebagai karakteristik.

## Fase 3 — Live terkontrol (disetujui pengguna; cap 12 request)

`final-live-run.mjs`: dispatcher ber-cap ketat (counter sebelum dispatch, ≤12k input char, ≤4096 visible output/request, hard-stop 401/403/404/429/`length`/langit-langit total 60k in + 24k out, URL guard endpoint).

**Terpakai: 10/12 request — 14.262 input / 4.598 output token** (laporan provider). Dua sisa sengaja tidak dipakai: mengulang prompt yang sama hanya untuk mengejar hasil bagus dilarang.

| # | Task | in/out |
|---|------|--------|
| 1–6 | Amber TXT end-to-end: classification + 2×(analysis+domain, loop koreksi) + summary | 8.920/2.936 |
| 7–10 | Injection probe end-to-end: classification + analysis + domain + summary | 4.942/640 |

Model: `glm-5.3-flash` (temperature 0, `response_format json_object`). Kunci tidak pernah dicetak/disimpan. Konten terkirim: fixture demo fiktif (amber-alpha) + chunk sintetis.

**Temuan live:**

1. **Probe prompt-injection: checkpoint `completed` — ekstraksi live pertama yang menyelesaikan seluruh pipeline melalui validator produksi.** Model menolak instruksi override secara eksplisit (tercatat di `classification_reason`); tidak ada klaim fabrikasi "USD 999.999.999 / 100% complete" yang terbit; progress 5% sah terbit sebagai observasi; quality warning bahkan menandai dokumen sebagai percobaan injection.
2. **Kegagalan fail-closed yang jujur pada Amber TXT**: model live memfabrikasi `snapshot_date` untuk 6 health snapshot (tanggal yang tidak ada di sumber) → validator menolak semua → grup `failed`/retryable, dokumen `needs_review`. **Tidak ada data fabrikasi yang diterbitkan.** Ini kelemahan model yang sama kelasnya dengan `period_label`/`as_of_date` domain task (sesi sebelumnya) — kandidat iterasi prompt berikutnya.
3. Klasifikasi dan ringkasan eksekutif **live untuk pertama kalinya**: keduanya menghasilkan keluaran valid (classification 0.85–0.9 dengan sitasi; summary 2 bullet dengan caveat data-quality).

## Verifikasi penuh setelah semua perubahan

| Perintah | Hasil |
|---|---|
| `node --test tests/integration/*.test.mjs` | **311/311 lulus** (310 + 1 regresi baru; 3 asersi evidence-provenance disesuaikan ke kontrak derivasi baru, intent aslinya dipertahankan: baris actual literal tetap bertahan dengan provenance penuh, hash antar-sesi berbeda, baris 0% wajib mengutip sel eksplisit) |
| `npx tsc --noEmit -p tsconfig.json` | Bersih |
| `npx eslint` pada file yang diubah | Bersih |
| `smoke-two-workbooks.mjs` | `all_passed: true`, tanpa jaringan |
| `graphify update .` | Graph dibangun ulang |
| Dokumentasi | `worker/README.md` diperbarui (derivasi persen numerik, as_of record-only, eligibility label, /39) |

## Status celah setelah ronde ini

**Tertutup ronde ini:** robustness parser di 100 file nyata (0 crash); derivasi deterministic-first aktif di korpus nyata (408+248 baris, sebelumnya 0); label non-progress tidak menjadi klaim progress; as_of hanya dari record date; dedup/binding sel persen numerik; zip korup gagal eksplisit; ambiguitas record-date tidak diklaim; duplikasi baris tidak dilipat diam-diam; cache reuse warm-run; **klasifikasi + ringkasan live**; **probe injection fail-closed live**; **satu pipeline live menyelesaikan checkpoint completed**.

**Tetap terbuka (blocker terpisah, tidak bisa dibuktikan di sesi ini):**
1. Model live masih memfabrikasi tanggal (snapshot_date/period_label/as_of_date) pada dokumen naratif → grup `failed`/retryable meski konten lain bagus; perlu iterasi prompt domain/health-snapshot + verifikasi live berikutnya.
2. Ground truth independen yang ditinjau manusia (prasyarat klaim READY).
3. Baseline A monolitik tak pernah selesai → perbandingan token/akurasi apple-to-apple belum mungkin; nondeterminisme model (1 run/file) belum diukur.
4. DB Supabase native + E2E Playwright; cache freshness (rekalkulasi Excel) — verifikasi runtime terpisah.
5. Mislabel non-milestone (progres diketik risk/issue/decision) tetap tidak ditegakkan deterministik — terdokumentasi; kandidat perluasan guard bila data live menunjukkan dampak.

## Keputusan

Pipa ekstraksi terhadap file input yang ada kini terbukti: **tidak crash, tidak fabrikasi, fail-closed pada semua kasus tepi yang diuji, dan jalur deterministic-first benar-benar bekerja di korpus nyata** (penghematan beban model: ±408+248 baris tidak lagi memerlukan model). Klaim `READY` produksi tetap **BELUM** — menunggu ground truth manusia dan perbaikan atribusi tanggal model.
