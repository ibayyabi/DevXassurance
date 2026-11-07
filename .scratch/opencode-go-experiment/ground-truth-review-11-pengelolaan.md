# Ground truth review: 11_Pengelolaan_Utilitas (W4)

**Cara meninjau (±5–10 menit):** buka `demo-evidence-fixtures/smart-building-itb/sessions/2026-10-09_w4/11_Pengelolaan_Utilitas_Subcontractor_Weekly.xlsx` (pakai Excel/LibreOffice), lalu untuk tiap baris di bawah: cek apakah sel sumber yang disebut benar-benar berisi nilai yang diklaim pipeline. Isi kolom **Status** dengan `OK` / `TIDAK` + catatan.

Verifikasi otomatis terhadap pembacaan XML mentah yang independen (bukan parser pipeline): **8/8 baris cocok**.

## 1. Progress deterministik — 8 baris (kolom `% Complete`, sheet `Workplan & Gantt`)

| WBS | % pipeline | Sel sumber | Raw XML (independen) | Baris sheet | Status (Anda) |
|---|---|---|---|---|---|
| 1.1 | 12.5% | Workplan & Gantt!J5..J5 | 12.5% | 5 | |
| 2.1 | 0% | Workplan & Gantt!J6..J6 | 0% | 6 | |
| 3.1 | 0% | Workplan & Gantt!J7..J7 | 0% | 7 | |
| 4.1 | 0% | Workplan & Gantt!J8..J8 | 0% | 8 | |
| 5.1 | 0% | Workplan & Gantt!J9..J9 | 0% | 9 | |
| 6.1 | 0% | Workplan & Gantt!J10..J10 | 0% | 10 | |
| 7.1 | 0% | Workplan & Gantt!J11..J11 | 0% | 11 | |
| 8.1 | 0% | Workplan & Gantt!J12..J12 | 0% | 12 | |

## 2. Milestone deterministik — 12 baris

| # | Label | Tanggal | Scope | Sel sumber | Status (Anda) |
|---|---|---|---|---|---|
| 1 | Utility inventory approved | 2026-09-18 | 1.1 | Workplan & Gantt!A5..P5 | |
| 2 | Utility inventory approved | 2026-09-25 | 1.1 | Workplan & Gantt!A5..P5 | |
| 3 | Utility inventory approved | 2026-10-09 | 1.1 | Workplan & Gantt!A5..P5 | |
| 4 | Design approved | 2026-09-28 | 2.1 | Workplan & Gantt!A6..P6 | |
| 5 | Design approved | 2026-10-09 | 2.1 | Workplan & Gantt!A6..P6 | |
| 6 | Design approved | 2026-10-23 | 2.1 | Workplan & Gantt!A6..P6 | |
| 7 | Platform/material ready | 2026-10-12 | 3.1 | Workplan & Gantt!A7..P7 | |
| 8 | Infrastructure ready | 2026-11-02 | 4.1 | Workplan & Gantt!A8..P8 | |
| 9 | Utility data operational | 2026-11-10 | 5.1 | Workplan & Gantt!A9..P9 | |
| 10 | Integrated data verified | 2026-11-16 | 6.1 | Workplan & Gantt!A10..P10 | |
| 11 | Test cases passed | 2026-11-30 | 7.1 | Workplan & Gantt!A11..P11 | |
| 12 | Handover complete | 2026-12-07 | 8.1 | Workplan & Gantt!A12..P12 | |

## 3. Evolusi antar sesi (W4 → W7) — nilai progress scope 1.1 harus naik wajar

| Sesi | Baris progress | Milestone | Nilai per WBS |
|---|---|---|---|
| 2026-10-09_w4 | 8 | 12 | 1.1=12.5%, 2.1=0%, 3.1=0%, 4.1=0%, 5.1=0%, 6.1=0%, 7.1=0%, 8.1=0% |
| 2026-10-16_w5 | 8 | 14 | 1.1=43.75%, 2.1=0%, 3.1=0%, 4.1=0%, 5.1=0%, 6.1=0%, 7.1=0%, 8.1=0% |
| 2026-10-23_w6 | 8 | 14 | 1.1=87.5%, 2.1=0%, 3.1=0%, 4.1=0%, 5.1=0%, 6.1=0%, 7.1=0%, 8.1=0% |
| 2026-10-30_w7 | 8 | 12 | 1.1=100%, 2.1=40%, 3.1=0%, 4.1=0%, 5.1=0%, 6.1=0%, 7.1=0%, 8.1=0% |

## 4. Keluaran model live (grup ambigu g1, sudah lolos validator)

Tinjau juga apakah tipe fakta ini masuk akal bagi Anda sebagai reviewer:

- **issue**: "SUBCONTRACTOR WEEKLY PROGRESS REPORT - PENGELOLAAN UTILITAS is a template for each subcontractor to report to the Project Manager"
- **milestone**: "Reporting period stated as Sep–Dec 2026" ⚠️ *kandidat mislabel: ini pernyataan periode, bukan milestone — contoh kelas yang belum ditegakkan guard*

## Yang perlu diputuskan reviewer

1. Apakah nilai % dan tanggal di atas sesuai isi workbook? (bagian 1–2)
2. Apakah evolusi W4→W7 masuk akal? (bagian 3)
3. Apakah tipe fakta live di bagian 4 dapat diterima, atau kelas mislabelnya harus ditegakkan guard berikutnya?
