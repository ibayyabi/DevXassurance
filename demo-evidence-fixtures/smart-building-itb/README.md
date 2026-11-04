# Smart Building ITB — fixture pack multi-sesi (PM controlling)

Fixture realistis untuk menguji pipeline assurance DevXassurance pada proyek
**Smart Building DKST ITB Summarecon** (18 Sep – 31 Des 2026, 12 komponen SB01–SB12,
kontrak IDR 6.802.375.321). Semua dokumen mempertahankan **format asli** dokumen
sumber di `~/Downloads/SMART BUILDING` (xlsx multi-sheet dengan chart, docx
ber-tabel) — hanya isinya yang dilengkapi dan dikonsistenkan.

## Struktur

```
00_baseline/
  KEGIATAN SMART BUILDING.xlsx              baseline terjadwal (Gantt 94 task, Milestone, PIC)
  Spesifikasi Teknis ... .xlsx              cost baseline hardware (TOTAL = 1.309.670.793 IDR)
  Perhitungan dari ... .xlsx                estimasi pembagian (Hardware = total Spesifikasi)
  Pengajuan Pembelian Hardware ... .xlsx    committed-cost request (bahasan MoM 16-Okt)
mom/                                        5 MoM asli, dibersihkan, satu file per rapat
sessions/
  2026-10-09_w4/  MoM + 12 progress report (cut-off 09 Okt)
  2026-10-16_w5/  MoM + 12 progress report (cut-off 16 Okt — nilai asli dokumen sumber)
  2026-10-23_w6/  MoM sintetis + 12 progress report (cut-off 23 Okt)
  2026-10-30_w7/  MoM sintetis + 12 progress report (cut-off 30 Okt)
expected-results.json                       nilai harapan per sesi (planned/actual/RAG/risk)
generator/                                  script pembuat + verifikator
```

## Userflow yang diuji

1. **Re-upload file sama antar sesi** — 12 nama file progress report **identik di
   keempat sesi** (mis. `01_Alarm_Kebencanaan_Subcontractor_Weekly.xlsx`).
   Periode dibedakan oleh `Cut-off Date` (sheet `Weekly Report`) dan
   `Reporting Cut-off` (sheet `PM Summary`). Pipeline tidak boleh menganggapnya
   duplikat; tiap upload adalah snapshot periode baru dengan progress naik.
2. **Evidence utuh untuk status & tracking** — baseline (tanggal, PIC, milestone),
   kurva `Planned %` per minggu diturunkan dari baseline, `Actual %` + narasi +
   blocker + evidence ref (EV-xxx) per minggu, risk log dengan **ID stabil
   lintas sesi** (`R-SBxx-nnn`), dan MoM per rapat sebagai evidence keputusan.

## Kondisi yang dirancang (cut-off 30 Okt)

| Kondisi | Komponen |
|---|---|
| On-track (hijau) | SB01 Alarm, SB05 Pengkondisian (ahead), SB06 Sampah, SB09 Air Limbah, SB12 BISMA |
| Needs attention (kuning) | SB03 Kontrol Akses (membaik), SB07 Pencahayaan, SB08 Air Bersih |
| Critical (merah) | SB02 Kamera, SB04 Kelistrikan, SB10 Ventilasi (telat mulai), SB11 Utilitas |

Checkpoint 60% (31 Okt) sengaja tidak tercapai merata → menguji schedule
comparison & temuan, tanpa mengubah baseline. Event risk untuk uji snapshot
comparison (ticket 04): risiko **baru** di W6 (`R-SB02-003`, `R-SB10-002`),
**closed** di W7 (`R-SB01-002`, `R-SB03-001`, `R-SB05-001`, `R-SB09-002`,
`R-SB11-002`), dan **rating naik** Medium→High di W7 (`R-SB02-001`).

## Prosedur uji manual

1. Buat satu project baru di app (mis. "Smart Building DKST ITB").
2. Upload `00_baseline/` (4 file) → klasifikasi baseline/cost; setujui sebagai
   baseline bila diminta (nilai & tanggal: 18-Sep-2026).
3. Untuk tiap folder `sessions/<sesi>/`: upload **semua** file dalam satu sesi
   (MoM + 12 xlsx). JANGAN upload `expected-results.json` / isi `generator/`.
4. Upload file bernama sama di sesi berikutnya — perilaku yang diharapkan:
   dokumen baru dengan periode berbeda (bukan menimpa), dan assurance
   membandingkan antar cut-off (W4 → W5 → W6 → W7).
5. Bandingkan hasil assurance dengan `expected-results.json`
   (planned/actual/variance/RAG per komponen, rollup, dan ringkasan risk).

Konsistensi internal yang sudah diverifikasi otomatis (775 cek,
`generator/verify_fixtures.py`): bobot WBS = 1.00; Actual % mingguan = Σ(bobot ×
% Complete); progres monoton naik antar sesi; nilai W5 = nilai asli dokumen
sumber; ID risk stabil; total hardware reconcile di ketiga file cost; PIC dan
ejaan komponen kanonik (SB01–SB12, "Kamera Pengawasan", "Pengkondisian Udara").

## Regenerasi

```bash
python3 -m venv .venv && .venv/bin/pip install openpyxl python-docx lxml
.venv/bin/python generator/generate_fixtures.py    # butuh ~/Downloads/SMART BUILDING
.venv/bin/python generator/verify_fixtures.py
```

Generator mem-patch XML sel secara bedasarkan (chart/format asli tetap utuh)
dan tidak pernah menulis ke folder sumber.
