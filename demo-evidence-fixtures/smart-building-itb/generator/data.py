"""Data model for the Smart Building ITB fixture pack.

All values are grounded in the source documents:
- /Users/iweng/Downloads/SMART BUILDING/KEGIATAN SMART BUILDING.xlsx (baseline)
- .../All Minutes of Meeting Smart Building.docx (5 meetings, 18 Sep - 16 Oct 2026)
- .../Pemantau Project/** (weekly subcontractor reports; W5 = 16-Oct-2026 anchors)

Canonical component registry follows "Master Komponen" (SB01..SB12) with
canonical spelling: "Kamera Pengawasan", "Pengkondisian Udara".
"""

from __future__ import annotations

import datetime as dt

D = dt.date

SOURCE_ROOT = "/Users/iweng/Downloads/SMART BUILDING"

PROJECT = "Smart Building DKST ITB"
BASELINE_APPROVED = "2026-09-18"
CONTRACT_REF = "TS CA_ITB_12A2"
CONTRACT_VALUE = 6_802_375_321  # IDR, Perhitungan -> Nilai Kontrak

# Sessions (weekly re-uploads of the same report file, cut-off Fridays)
SESSIONS = [
    ("2026-10-09_w4", D(2026, 10, 9), 4),
    ("2026-10-16_w5", D(2026, 10, 16), 5),
    ("2026-10-23_w6", D(2026, 10, 23), 6),
    ("2026-10-30_w7", D(2026, 10, 30), 7),
]

# cut-off dates per week number (Friday of each week)
WEEK_CUTOFF = {
    1: D(2026, 9, 18), 2: D(2026, 9, 25), 3: D(2026, 10, 2), 4: D(2026, 10, 9),
    5: D(2026, 10, 16), 6: D(2026, 10, 23), 7: D(2026, 10, 30), 8: D(2026, 11, 6),
    9: D(2026, 11, 13), 10: D(2026, 11, 20), 11: D(2026, 11, 27), 12: D(2026, 12, 4),
    13: D(2026, 12, 11), 14: D(2026, 12, 18),
}

# ---------------------------------------------------------------------------
# Components
# ---------------------------------------------------------------------------

class Comp:
    def __init__(self, code, name, short, subcon, pic, base_rel, out_name, family):
        self.code = code
        self.name = name          # canonical component name
        self.short = short        # for titles/upper
        self.subcon = subcon
        self.pic = pic
        self.base_rel = base_rel  # path under Pemantau Project/
        self.out_name = out_name  # identical across sessions (re-upload flow)
        self.family = family      # "real" (filled source report) | "tmpl"


COMPONENTS = [
    Comp("SB01", "Alarm Kebencanaan", "ALARM KEBENCANAAN", "Indismart/LCI", "Amar",
         "1. ALARM KEBENCANAAN/01_Alarm_Kebencanaan_Subcontractor_Weekly.xlsx",
         "01_Alarm_Kebencanaan_Subcontractor_Weekly.xlsx", "real"),
    Comp("SB02", "Kamera Pengawasan", "KAMERA PENGAWASAN", "Indismart/LCI", "Nadhif",
         "2. KAMERA PENGAWAS/02_Kamera_Pengawas_Subcontractor_Weekly.xlsx",
         "02_Kamera_Pengawasan_Subcontractor_Weekly.xlsx", "real"),
    Comp("SB03", "Kontrol Akses", "KONTROL AKSES", "LCI", "Nadhif",
         "3. KONTROL AKSES/03_Kontrol_Akses_Subcontractor_Weekly.xlsx",
         "03_Kontrol_Akses_Subcontractor_Weekly.xlsx", "real"),
    Comp("SB04", "Kelistrikan", "KELISTRIKAN", "Elisa/LCI", "Farhan",
         "4. KELISTRIKAN/04_Kelistrikan_Subcontractor_Weekly.xlsx",
         "04_Kelistrikan_Subcontractor_Weekly.xlsx", "real"),
    Comp("SB05", "Pengkondisian Udara", "PENGKONDISIAN UDARA", "Indismart/LCI", "Amar",
         "6. PENGKONDISIAN UDARA/06_Pengondisian_Udara_Subcontractor_Weekly.xlsx",
         "06_Pengkondisian_Udara_Subcontractor_Weekly.xlsx", "real"),
    Comp("SB06", "Pengelolaan Sampah", "PENGELOLAAN SAMPAH", "LCI", "Sutani",
         "9. PENGELOLAAN SAMPAH/09_Pengelolaan_Sampah_Subcontractor_Weekly.xlsx",
         "09_Pengelolaan_Sampah_Subcontractor_Weekly.xlsx", "real"),
    Comp("SB07", "Pencahayaan", "PENCAHAYAAN", "Urbansolv", "Tezar",
         "5. PENCAHAYAAN/05_Pencahayaan_Subcontractor_Weekly.xlsx",
         "05_Pencahayaan_Subcontractor_Weekly.xlsx", "tmpl"),
    Comp("SB08", "Air Bersih", "AIR BERSIH", "Urbansolv", "Tezar",
         "7. AIR BERSIH/07_Air_Bersih_Subcontractor_Weekly.xlsx",
         "07_Air_Bersih_Subcontractor_Weekly.xlsx", "tmpl"),
    Comp("SB09", "Air Limbah", "AIR LIMBAH", "Urbansolv", "Tezar",
         "8. AIR LIMBAH/08_Air_Limbah_Subcontractor_Weekly.xlsx",
         "08_Air_Limbah_Subcontractor_Weekly.xlsx", "tmpl"),
    Comp("SB10", "Ventilasi", "VENTILASI", "Urbansolv", "Tezar",
         "10. VENTILASI/10_Ventilasi_Subcontractor_Weekly.xlsx",
         "10_Ventilasi_Subcontractor_Weekly.xlsx", "tmpl"),
    Comp("SB11", "Pengelolaan Utilitas", "PENGELOLAAN UTILITAS", "Kazee", "Rizki Samsul",
         "11. PENGELOLAAN UTILITAS/11_Pengelolaan_Utilitas_Subcontractor_Weekly.xlsx",
         "11_Pengelolaan_Utilitas_Subcontractor_Weekly.xlsx", "tmpl"),
    Comp("SB12", "BISMA", "BISMA", "Kazee", "Rizki Samsul",
         "12. BISMA/12_BISMA_Subcontractor_Weekly.xlsx",
         "12_BISMA_Subcontractor_Weekly.xlsx", "tmpl"),
]

BY_CODE = {c.code: c for c in COMPONENTS}

# Canonical PIC registry per component (reconciles KEGIATAN/MoM/weekly reports)
COMPANY_CANON = {
    "SB01": "Indismart/LCI", "SB02": "Indismart/LCI", "SB03": "LCI",
    "SB04": "Elisa/LCI", "SB05": "Indismart/LCI", "SB06": "LCI",
    "SB07": "Urbansolv", "SB08": "Urbansolv", "SB09": "Urbansolv",
    "SB10": "Urbansolv", "SB11": "Kazee", "SB12": "Kazee",
}

# ---------------------------------------------------------------------------
# WBS for template-family components (dates aligned to the approved baseline
# phases in KEGIATAN Master Gantt; weights reuse the released template weights)
# ---------------------------------------------------------------------------

GEN_WBS_DATES = [
    (D(2026, 9, 18), D(2026, 9, 25)),   # 1.1 assessment
    (D(2026, 9, 28), D(2026, 10, 9)),   # 2.1 design
    (D(2026, 10, 12), D(2026, 10, 30)), # 3.1 procurement
    (D(2026, 11, 2), D(2026, 11, 13)),  # 4.1 installation
    (D(2026, 11, 10), D(2026, 11, 27)), # 5.1 configuration
    (D(2026, 11, 16), D(2026, 12, 4)),  # 6.1 integration
    (D(2026, 11, 30), D(2026, 12, 9)),  # 7.1 testing
    (D(2026, 12, 7), D(2026, 12, 11)),  # 8.1 handover
]
GEN_WBS_WEIGHTS = [0.08, 0.10, 0.15, 0.22, 0.12, 0.13, 0.12, 0.08]
GEN_WBS_CODES = ["1.1", "2.1", "3.1", "4.1", "5.1", "6.1", "7.1", "8.1"]
GEN_WBS_PHASES = ["Engineering", "Engineering", "Procurement", "Installation",
                  "Configuration", "Integration", "Testing", "Handover"]
GEN_ROW_PICS = ["PIC", "PIC", "Procurement PIC", "Site PIC", "Engineer",
                "Integration PIC", "QA / Engineer", "Project PIC"]

def _gen_wbs(activities, deliverables, integration_api):
    """8 WBS rows; the integration row names its BISMA API."""
    rows = []
    for i in range(8):
        rows.append({
            "code": GEN_WBS_CODES[i],
            "phase": GEN_WBS_PHASES[i],
            "activity": activities[i],
            "deliverable": deliverables[i],
            "pic": GEN_ROW_PICS[i] if i not in (0, 1) else None,  # None -> tech PIC
            "start": GEN_WBS_DATES[i][0], "finish": GEN_WBS_DATES[i][1],
            "weight": GEN_WBS_WEIGHTS[i],
            "ev": f"EV-{i + 1:03d}",
        })
    rows[5]["activity"] = integration_api
    return rows

TEMPLATE_WBS = {
    "SB07": _gen_wbs(
        ["Inventarisasi titik pencahayaan dan konfirmasi 24 titik sensing (BGC)",
         "Desain sistem pencahayaan: sensor intensitas, kontrol dimmable, skenario",
         "Pengadaan 24 light intensity sensor dan modul kontrol pencahayaan",
         "Pemasangan sensor dan modul kontrol di area lantai 9",
         "Konfigurasi skenario pencahayaan dan kalibrasi sensor",
         "Integrasi ke BISMA (Modbus/MQTT, API /lighting)",
         "Uji fungsi dan end-to-end skenario pencahayaan",
         "As-built, manual, pelatihan operator"],
        ["Daftar titik disetujui PPK", "Dokumen desain disetujui",
         "Barang diterima (delivery note)", "Terpasang (foto dan checklist)",
         "Skenario dapat diperagakan", "Data pencahayaan tampil di BISMA",
         "Berita acara uji fungsi", "Serah terima"],
        "Integrasi ke BISMA (Modbus/MQTT, API /lighting)"),
    "SB08": _gen_wbs(
        ["Inventarisasi titik air bersih dan kebutuhan monitoring kualitas",
         "Desain monitoring air bersih (pH, EC, turbidity, level, flow)",
         "Pengadaan sensor pH/EC/turbidity/level/flowmeter (quotation vendor)",
         "Instalasi sensor dan panel di ruang pompa",
         "Konfigurasi telemetry dan validasi data lokal",
         "Integrasi ke BISMA (API /clean-water)",
         "Uji fungsi dan end-to-end monitoring air bersih",
         "As-built, manual, pelatihan operator"],
        ["Daftar titik disetujui", "Dokumen desain disetujui",
         "Barang diterima (delivery note)", "Terpasang (foto dan checklist)",
         "Data operasional", "Data air bersih tampil di BISMA",
         "Berita acara uji fungsi", "Serah terima"],
        "Integrasi ke BISMA (API /clean-water)"),
    "SB09": _gen_wbs(
        ["Inventarisasi dan pemetaan titik monitoring IPAL",
         "Desain monitoring IPAL (sensor pH, EC, level, flow)",
         "Pengadaan sensor prioritas PO (Recap ADB)",
         "Instalasi sensor di area IPAL",
         "Konfigurasi telemetry dan alarm ambang batas",
         "Integrasi ke BISMA (API /waste-water)",
         "Uji fungsi dan end-to-end monitoring IPAL",
         "As-built, manual, pelatihan operator"],
        ["Daftar titik disetujui", "Dokumen desain disetujui",
         "Barang diterima (delivery note)", "Terpasang (foto dan checklist)",
         "Data operasional", "Data IPAL tampil di BISMA",
         "Berita acara uji fungsi", "Serah terima"],
        "Integrasi ke BISMA (API /waste-water)"),
    "SB10": _gen_wbs(
        ["Assessment handover data Indihealth dan pemetaan ruang/AHU",
         "Desain monitoring kualitas udara dan kontrol ventilasi",
         "Pengadaan 15 smart air purifier dan sensor udara",
         "Pemasangan air purifier dan sensor udara",
         "Konfigurasi kendali dan skenario kualitas udara",
         "Integrasi ke BISMA (bridge MQTT, API /air-quality)",
         "Uji fungsi dan end-to-end ventilasi",
         "As-built, manual, pelatihan operator"],
        ["Daftar titik disetujui", "Dokumen desain disetujui",
         "Barang diterima (delivery note)", "Terpasang (foto dan checklist)",
         "Skenario dapat diperagakan", "Data udara tampil di BISMA",
         "Berita acara uji fungsi", "Serah terima"],
        "Integrasi ke BISMA (bridge MQTT, API /air-quality)"),
    "SB11": _gen_wbs(
        ["Inventarisasi utilitas (listrik, air, gas) dan point list",
         "Arsitektur data utilitas dan desain interface",
         "Persiapan gateway/server/platform utilitas",
         "Setup interface dan jaringan utilitas",
         "Konfigurasi point utilitas dan validasi lokal",
         "Agregasi data utilitas ke BISMA",
         "Uji lintas sistem end-to-end",
         "Handover dokumentasi dan SOP"],
        ["Utility inventory approved", "Design approved",
         "Platform/material ready", "Infrastructure ready",
         "Utility data operational", "Integrated data verified",
         "Test cases passed", "Handover complete"],
        "Agregasi data utilitas ke BISMA (API /utility)"),
}

# SB12 (BISMA) keeps its own source WBS; only progress/forecast is patched.

# ---------------------------------------------------------------------------
# Trajectories: cumulative actual progress (weighted) per week
# W5 values marked * are the real anchors from the source documents.
# ---------------------------------------------------------------------------

ACTUAL = {
    # code: {week: cumulative actual fraction}
    "SB01": {4: 0.125, 5: 0.204, 6: 0.283, 7: 0.381},   # on track (real W5 0.204)
    "SB02": {4: 0.045, 5: 0.060, 6: 0.078, 7: 0.102},   # critical (real W5 0.060)
    "SB03": {4: 0.055, 5: 0.080, 6: 0.145, 7: 0.225},   # late -> recovering (real W5 0.080)
    "SB04": {4: 0.030, 5: 0.051, 6: 0.090, 7: 0.155},   # critical (real W5 0.051)
    "SB05": {4: 0.028, 5: 0.130, 6: 0.210, 7: 0.360},   # ahead (real W5 0.130)
    "SB06": {4: 0.062, 5: 0.102, 6: 0.200, 7: 0.340},   # on track (real W5 0.102)
    "SB07": {4: 0.125, 5: 0.165, 6: 0.215, 7: 0.270},   # needs attention (amber)
    "SB08": {4: 0.140, 5: 0.180, 6: 0.215, 7: 0.260},   # needs attention (W4 anchor from source 0.14)
    "SB09": {4: 0.190, 5: 0.230, 6: 0.285, 7: 0.345},   # on track
    "SB10": {4: 0.005, 5: 0.012, 6: 0.030, 7: 0.060},   # critical, late start
    "SB11": {4: 0.010, 5: 0.035, 6: 0.070, 7: 0.120},   # critical
    "SB12": {4: 0.340, 5: 0.480, 6: 0.600, 7: 0.650},   # on track (integration-heavy plan)
}

# ---------------------------------------------------------------------------
# Weekly narrative cells (Work Completed / Plan Next / Blocker / Support Needed)
# for the weeks that have no source text. W5 rows of "real" components are the
# untouched source evidence.
# L = due date (next Friday), M = evidence ref, owner = technical PIC.
# ---------------------------------------------------------------------------

NARRATIVE = {
    "SB01": {
        4: ("1. Asesmen panel alarm eksisting dan titik sensor seismik.\n2. Draft konsep titik pemasangan (EV-001).",
            "1. Finalisasi desain sistem dan alur data (MQTT/API).\n2. Mulai desain papan sensor seismik D7S.",
            "1. Peran panel alarm baru vs eksisting belum ditetapkan.",
            "1. Data panel alarm eksisting dari gedung.", "2026-10-16", "EV-001"),
        6: ("1. Desain papan sensor D7S berjalan (skematik).\n2. Desain sistem dan kontrak MQTT/API direview bersama BISMA.",
            "1. Selesaikan review desain papan D7S.\n2. Terbitkan PO FACP dan komponen.",
            "1. Datasheet FACP TNT-AFA02L belum diterima.",
            "1. Follow-up datasheet ke vendor; siapkan jalur kontak kering.", "2026-10-30", "EV-004"),
        7: ("1. Review desain papan D7S selesai.\n2. PO pengadaan FACP/NAS disiapkan.",
            "1. Produksi prototipe papan D7S.\n2. Penerimaan barang pengadaan (FACP, NAS).",
            "1. Panel baru vs eksisting masih menunggu keputusan gedung.",
            "1. Keputusan peran panel baru (action item 1610-3).", "2026-11-06", "EV-004"),
    },
    "SB02": {
        4: ("1. Survei titik kamera di 5 kabin lift.\n2. Kebutuhan event analitik dan siaran langsung ke BISMA dipetakan.",
            "1. Pilih merek kamera/NVR (ONVIF dan API terbuka).\n2. Diskusi integrasi dengan Pak Indra.",
            "1. Merek kamera/NVR belum diputuskan; API collector belum diketahui.",
            "1. Keputusan merek; izin vendor lift untuk pemasangan di kabin.", "2026-10-16", "EV-001"),
        6: ("1. Perbandingan kandidat kamera/NVR (ONVIF).\n2. Draft desain integrasi analitik VIANA.",
            "1. Finalisasi merek dan API.\n2. PO kamera, NVR, NAS.",
            "1. API vendor tertutup bila salah pilih merek - kriteria BGC CC-10.",
            "1. Konfirmasi kebutuhan GPU analitik VIANA.", "2026-10-30", "EV-002"),
        7: ("1. Kandidat merek dipersempit menjadi 2 pilihan.\n2. Uji ONVIF kandidat.",
            "1. Keputusan final merek (eskalasi ke PPK).\n2. Terbitkan PO.",
            "1. Kandidat ber-API terbuka terbatas; risiko dinaikkan menjadi High.",
            "1. Eskalasi keputusan merek ke PPK.", "2026-11-06", "EV-002"),
    },
    "SB03": {
        4: ("1. Survei kabin lift dan titik reader.\n2. Draft desain integrasi log akses.",
            "1. Klarifikasi kapasitas 32/64 lantai ke PPK.\n2. Koordinasi izin vendor lift.",
            "1. Spesifikasi kapasitas elevator tidak konsisten di TS; menahan PO.",
            "1. Klarifikasi ke PPK (action item 1009-3).", "2026-10-16", "EV-001"),
        6: ("1. Menunggu konfirmasi kapasitas elevator.\n2. Desain profil pengguna dan enkripsi disiapkan.",
            "1. PO elevator access control setelah konfirmasi.\n2. Koordinasi swing gate.",
            "1. PO tertahan konfirmasi PPK.",
            "1. Percepat konfirmasi PPK.", "2026-10-30", "EV-002"),
        7: ("1. Kapasitas elevator dikonfirmasi 64 lantai (MoM 23-Okt).\n2. Draft PO elevator access control final.",
            "1. Terbitkan PO elevator access control.\n2. Survei swing gate.",
            "1. Risiko garansi lift bila pemasangan tanpa vendor lift.",
            "1. Libatkan vendor lift sejak tahap instalasi.", "2026-11-06", "EV-002"),
    },
    "SB04": {
        4: ("1. Persiapan survei kelistrikan bersama Elisa (14-Okt).\n2. Inventaris power meter dari gambar as-built.",
            "1. Rekap hasil survei dan daftar titik 40 power meter.\n2. Mulai DED power meter rakitan.",
            "1. Jadwal survei menunggu akses dokumen gedung.",
            "1. File spesifikasi/denah gedung.", "2026-10-16", "EV-001"),
        6: ("1. Daftar titik draf (inventaris as-built, alokasi 40 unit Lt. 8-9).\n2. Jalur kabel panel ke switch dipetakan.",
            "1. Verifikasi lapangan oleh vendor (paket 0).\n2. Lanjut DED skematik/PCB.",
            "1. Pembagian MCB panel lantai tidak sesuai desain awal.",
            "1. Konfirmasi jumlah gateway (asumsi 1/lantai/gedung) ke Pak Justin.", "2026-10-30", "EV-010, EV-011"),
        7: ("1. Survei vendor selesai; daftar titik final.\n2. DED pengawatan panel berjalan.",
            "1. Finalisasi DED.\n2. PO komponen 40 power meter.",
            "1. Usulan pembelian via marketplace berisiko temuan audit.",
            "1. Keputusan PM soal jalur pembelian yang sah.", "2026-11-06", "EV-010, EV-011"),
    },
    "SB05": {
        4: ("1. Uji Tuya Cloud API pada perangkat sampel.\n2. Identifikasi RH Data Logger dan TC-700Pro.",
            "1. Finalisasi cara pengambilan data.\n2. Klarifikasi lingkup software AC ke PPK.",
            "1. Software di TS berjudul Sistem Pencahayaan, isinya modul pencahayaan.",
            "1. Klarifikasi software ke PPK (action item 1009-2).", "2026-10-16", "EV-002"),
        6: ("1. Lingkup software AC dikonfirmasi PPK.\n2. Bridge MQTT untuk sensor Tuya diuji.",
            "1. Selesaikan dokumentasi pengambilan data.\n2. PO RH Data Logger (14) dan TC-700Pro (15).",
            "1. TS tidak memuat gateway HVAC.",
            "1. Keputusan kebutuhan gateway HVAC dan anggarannya.", "2026-10-30", "EV-002"),
        7: ("1. Dokumentasi cara ambil data selesai (EV-002).\n2. Skema bridge MQTT final.",
            "1. Penerimaan barang sensor (29 unit).\n2. Konfigurasi bridge produksi.",
            "1. Protokol sensor tertutup via Tuya Cloud.",
            "1. Catat sebagai risiko BGC AC-08/AC-10.", "2026-11-06", "EV-003"),
    },
    "SB06": {
        4: ("1. Pemetaan 14 titik selesai; hardware diputuskan (Orange Pi Zero 2W, VL53L1X, SIM800L).\n2. BOM prototipe siap.",
            "1. Belanja dan rakit prototipe 1 unit.\n2. Uji sensor dan modem.",
            "1. Jumlah UART Orange Pi Zero 2W perlu verifikasi.",
            "", "2026-10-16", "EV-001"),
        6: ("1. Prototipe 1 unit dirakit; sensor jarak teruji.\n2. Desain PCB carrier dimulai.",
            "1. Uji modem SIM800L pada prototipe.\n2. Review desain PCB dan enclosure.",
            "1. Charger power-path diuji pada tahap PCB.",
            "", "2026-10-30", "EV-002"),
        7: ("1. Prototipe lolos uji fungsi dasar.\n2. Review desain PCB tahap 1.",
            "1. PO 14 tempat sampah dan komponen kontroler.\n2. Produksi PCB.",
            "1. Dimensi unit 3x60 L vs ruang di sebagian titik.",
            "1. Ukur ruang pada titik pemasangan akhir.", "2026-11-06", "EV-002"),
    },
    "SB07": {
        4: ("1. Inventarisasi titik pencahayaan lantai 9.\n2. Konfirmasi 24 titik sensing terhadap BGC.",
            "1. Finalisasi desain skenario dan kontrol dimmable.\n2. Mulai pengadaan sensor.",
            "1. Spesifikasi LED dimmable belum dikonfirmasi vendor (MoM 0910).",
            "1. Konfirmasi spesifikasi ke PPK/vendor.", "2026-10-16", "EV-002"),
        5: ("1. Desain skenario pencahayaan didraft.\n2. Kandidat sensor intensitas dikaji.",
            "1. PO 24 light intensity sensor.\n2. Koordinasi titik pemasangan.",
            "1. Konfirmasi denah titik menunggu finalisasi desain.",
            "1. Penetapan titik final oleh PPK.", "2026-10-23", "EV-002"),
        6: ("1. Review-1 desain skenario selesai.\n2. PO sensor disiapkan.",
            "1. Terbitkan PO sensor dan modul kontrol.\n2. Kalibrasi awal perangkat contoh.",
            "1. Jadwal pengadaan bergeser mengikuti penyelarasan spesifikasi.",
            "1. Keputusan merek/spesifikasi sensor.", "2026-10-30", "EV-003"),
        7: ("1. PO sensor cahaya terbit (24 unit).\n2. Perangkat contoh diterima dan diuji.",
            "1. Penerimaan seluruh barang.\n2. Persiapan instalasi (2 Nov).",
            "1. Pengiriman sensor sekitar 7 hari kerja.",
            "1. Pantau delivery note.", "2026-11-06", "EV-003"),
    },
    "SB08": {
        4: ("1. Survei ruang pompa dan titik sensor air bersih.\n2. Quotation vendor sensor (pH, EC, turbidity, level, flow) dikaji.",
            "1. Finalisasi desain monitoring air bersih.\n2. Negosiasi harga vendor terhadap HPS.",
            "1. Harga quotation vendor melampaui HPS pada beberapa item.",
            "1. Persetujuan anggaran / negosiasi ulang.", "2026-10-16", "EV-001"),
        5: ("1. Desain monitoring final (5 parameter).\n2. Negosiasi harga vendor tahap 1.",
            "1. PO sensor gelombang 1.\n2. Persiapan instalasi ruang pompa.",
            "1. Akses ruang pompa untuk survei lanjutan.",
            "1. Izin akses dari pengelola gedung.", "2026-10-23", "EV-002"),
        6: ("1. PO sensor gelombang 1 diterbitkan.\n2. Jadwal instalasi disusun.",
            "1. Penerimaan barang gelombang 1.\n2. Instalasi awal sensor level dan flow.",
            "1. Lead time sensor impor sekitar 3 minggu.",
            "1. Pantau pengiriman; siapkan alternatif vendor lokal.", "2026-10-30", "EV-003"),
        7: ("1. Sebagian sensor diterima.\n2. Pemasangan sensor level dimulai.",
            "1. Selesaikan instalasi titik air bersih.\n2. Konfigurasi telemetry lokal.",
            "1. Sisa sensor menunggu pengiriman.",
            "1. Eskalasi pengiriman ke vendor.", "2026-11-06", "EV-003"),
    },
    "SB09": {
        4: ("1. Pemetaan titik monitoring IPAL.\n2. Daftar sensor prioritas PO disusun (Recap ADB).",
            "1. Finalisasi desain monitoring IPAL.\n2. Follow-up PO prioritas barang (MoM 2509).",
            "1. PO prioritas barang belum terbit.",
            "1. Percepat penerbitan PO.", "2026-10-16", "EV-001"),
        5: ("1. Desain monitoring IPAL selesai review.\n2. Daftar barang prioritas final.",
            "1. Menunggu PO; siapkan instalasi.\n2. Koordinasi akses area IPAL.",
            "1. PO prioritas barang belum terbit.",
            "1. Follow-up procurement ke PMO.", "2026-10-23", "EV-002"),
        6: ("1. Persiapan instalasi (timeline dan tenaga).\n2. Koordinasi akses IPAL dengan operasional gedung.",
            "1. Penerimaan barang setelah PO terbit.\n2. Instalasi sensor pH dan level.",
            "1. Ketergantungan PO menjalar ke jadwal instalasi.",
            "1. Eskalasi PO ke PMO.", "2026-10-30", "EV-002"),
        7: ("1. PO prioritas barang terbit (29-Okt).\n2. Jadwal instalasi dikunci minggu depan.",
            "1. Penerimaan dan uji barang.\n2. Mulai instalasi sensor IPAL.",
            "1. Lead time pengiriman barang sekitar 1 minggu.",
            "", "2026-11-06", "EV-003"),
    },
    "SB10": {
        4: ("1. Handover data dari Indihealth; inventaris perangkat eksisting belum lengkap.",
            "1. Lengkapi handover dokumen dan akses.\n2. Mulai assessment ruang/AHU.",
            "1. PIC Ventilasi baru dikonfirmasi (Tezar); data Indihealth belum lengkap.",
            "1. Dukungan PMO untuk handover data Indihealth.", "2026-10-16", "EV-001"),
        5: ("1. Assessment dimulai (pemetaan ruang dan AHU).\n2. Kebutuhan 15 air purifier dikonfirmasi.",
            "1. Selesaikan assessment baseline.\n2. Desain monitoring kualitas udara.",
            "1. Handover dokumen belum lengkap; progress mulai dari nol.",
            "1. Prioritaskan ventilasi menjelang checkpoint 60%.", "2026-10-23", "EV-001"),
        6: ("1. Assessment baseline ruang selesai.\n2. Draft desain monitoring dan kontrol ventilasi.",
            "1. Finalisasi desain.\n2. PO 15 smart air purifier.",
            "1. Akses ruang AHU terbatas untuk survei.",
            "1. Jadwal akses AHU dari operasional gedung.", "2026-10-30", "EV-002"),
        7: ("1. Desain monitoring disetujui internal.\n2. PO air purifier disiapkan.",
            "1. Terbitkan PO air purifier dan sensor.\n2. Recovery plan menuju 80% (30-Nov).",
            "1. Forecast finish Ventilasi bergeser dari baseline 30-Okt.",
            "1. Setujui recovery plan; baseline tidak diubah.", "2026-11-06", "EV-002"),
    },
    "SB11": {
        4: ("1. Inventarisasi utilitas (listrik, air, gas) dimulai.\n2. Draft point list disusun.",
            "1. Kunci point list dengan pengelola gedung.\n2. Lanjut arsitektur data utilitas.",
            "1. Point list utilitas belum dikunci.",
            "1. Penetapan lingkup point list oleh pengelola/PPK.", "2026-10-16", "EV-001"),
        5: ("1. Point list draft v2 (listrik dan air).\n2. Arsitektur data utilitas didraft.",
            "1. Finalisasi point list.\n2. Kebutuhan gateway/server disusun.",
            "1. Lingkup masih bergeser; SB11-01 belum masuk daftar pengadaan.",
            "1. Masukkan SB11-01 ke pengadaan gelombang 2.", "2026-10-23", "EV-002"),
        6: ("1. Arsitektur data utilitas v1.\n2. Usulan kebutuhan gateway disiapkan.",
            "1. Finalisasi point list bersama pengelola.\n2. PO SB11-01 (pengadaan gelombang 2).",
            "1. Progress tertinggal dari checkpoint 60%; fokus desain dan pengadaan.",
            "1. Keputusan anggaran platform utilitas.", "2026-10-30", "EV-002"),
        7: ("1. Point list final disetujui pengelola.\n2. SB11-01 masuk daftar pengadaan gelombang 2.",
            "1. Setup environment platform.\n2. Recovery plan Utilitas (target 80% November).",
            "1. Instalasi tertunda menunggu platform dan gateway.",
            "1. Prioritaskan pengadaan gelombang 2.", "2026-11-06", "EV-003"),
    },
    "SB12": {
        4: ("1. Konfirmasi requirement dan data point subsistem.\n2. Review arsitektur integrasi dan data model.",
            "1. Finalisasi arsitektur (MQTT + REST).\n2. Siapkan environment integrasi.",
            "1. Spesifikasi protokol 12 subsistem belum seragam.",
            "1. Standarisasi topik MQTT dan registry API.", "2026-10-16", "EV-002"),
        5: ("1. Environment integrasi siap.\n2. Draft topic registry MQTT.",
            "1. Setup connector subsistem pertama (Alarm).\n2. Dashboard 18 indikator.",
            "1. Workstation BISMA (SB12-05) baru diusulkan; anggaran menunggu.",
            "1. Keputusan pengadaan workstation (Pengajuan 16-Okt).", "2026-10-23", "EV-003"),
        6: ("1. Connector Alarm (MQTT) diuji sandbox.\n2. Draft dashboard 18 indikator.",
            "1. Connector Kamera dan Kelistrikan.\n2. Uji telemetry end-to-end pertama.",
            "1. Sebagian subsistem belum menyerahkan register/topic.",
            "1. Tekankan register/topic map pada weekly monev.", "2026-10-30", "EV-004"),
        7: ("1. Connector Alarm dan Kamera terintegrasi sandbox.\n2. Register/topic map 6 subsistem diterima.",
            "1. Integrasi 6 subsistem berikutnya.\n2. SIT pertama lingkup terbatas.",
            "1. Workstation SB12-05 menunggu persetujuan pengadaan.",
            "1. Konfirmasi anggaran workstation.", "2026-11-06", "EV-005"),
    },
}

# ---------------------------------------------------------------------------
# Risk register (stable IDs across sessions -> snapshot comparison).
# status: dict week -> status; priority: dict week -> value (defaults to base)
# ---------------------------------------------------------------------------

def _risk(rid, rtype, raised, desc, impact, prob, priority, owner, target, mitigation, status_by_week=None, priority_by_week=None, change_impact=""):
    return {
        "id": rid, "type": rtype, "raised": raised, "desc": desc,
        "impact": impact, "prob": prob, "priority": priority, "owner": owner,
        "target": target, "mitigation": mitigation, "change_impact": change_impact,
        "status_by_week": status_by_week or {4: "Open", 5: "Open", 6: "Open", 7: "Open"},
        "priority_by_week": priority_by_week or {},
    }

RISKS = {
    "SB01": [
        _risk("R-SB01-001", "Risk", "2026-10-13",
              "Panel FACP baru tumpang tindih dengan sistem alarm eksisting gedung",
              "Medium", "Medium", "Medium", "Amar", "2026-10-30",
              "Tetapkan peran panel baru (ganti, lengkapi, berdampingan) bersama gedung"),
        _risk("R-SB01-002", "Risk", "2026-10-13",
              "Port komunikasi dan protokol FACP TNT-AFA02L belum diketahui",
              "Medium", "Medium", "Medium", "Amar", "2026-10-23",
              "Minta datasheet; jalur cadangan kontak kering",
              status_by_week={4: "Open", 5: "Open", 6: "Open", 7: "Closed (datasheet diterima 29-Okt)"}),
    ],
    "SB02": [
        _risk("R-SB02-001", "Risk", "2026-10-13",
              "API vendor kamera/NVR belum diketahui; bila tertutup, kriteria BGC CC-10 tidak terpenuhi",
              "Medium", "Medium", "Medium", "Nadhif", "2026-10-30",
              "Pilih merek yang mendukung ONVIF dan API terbuka",
              priority_by_week={4: "Medium", 5: "Medium", 6: "Medium", 7: "High"}),
        _risk("R-SB02-002", "Risk", "2026-10-13",
              "Perangkat penjalan analitik VIANA (GPU) tidak tercantum di TS",
              "Medium", "Medium", "Medium", "Nadhif", "2026-10-30",
              "Konfirmasi ke vendor VIANA; pertimbangkan workstation BISMA"),
        _risk("R-SB02-003", "Risk", "2026-10-23",
              "Izin vendor lift untuk pemasangan kamera di kabin belum ada",
              "Medium", "Medium", "Medium", "Nadhif", "2026-11-06",
              "Koordinasi izin tertulis bersama Kontrol Akses dan pengelola gedung"),
    ],
    "SB03": [
        _risk("R-SB03-001", "Issue", "2026-10-09",
              "Kapasitas akses elevator tidak konsisten di TS: 32 lantai dan 64 lantai per lift",
              "Medium", "High", "High", "Nadhif", "2026-10-23",
              "Klarifikasi ke PPK sebelum PO (action item 1009-3)",
              status_by_week={4: "Open", 5: "Open", 6: "Open", 7: "Closed (dikonfirmasi 64 lantai, MoM 2310)"},
              change_impact="Menahan PO elevator access control"),
        _risk("R-SB03-002", "Risk", "2026-10-13",
              "Pemasangan di kabin lift tanpa vendor lift dapat membatalkan garansi lift",
              "High", "Medium", "High", "Nadhif", "2026-10-30",
              "Libatkan vendor lift sejak desain; izin tertulis pemilik gedung"),
        _risk("R-SB03-003", "Risk", "2026-10-13",
              "Data wajah termasuk data pribadi sensitif (UU PDP)",
              "Medium", "Low", "Low", "Nadhif", "2026-11-06",
              "Templat wajah tetap di sistem vendor; tetapkan pengelola dan masa simpan"),
    ],
    "SB04": [
        _risk("R-SB04-001", "Issue", "2026-10-13",
              "Beban yang disambung ke 120 relay belum diketahui",
              "Medium", "High", "High", "Farhan", "2026-10-23",
              "Relay hanya untuk AC indoor dan penerangan ruang; tetap ON saat komunikasi putus; rating relay mengikuti perangkat final (EV-011)"),
        _risk("R-SB04-002", "Issue", "2026-10-13",
              "Definisi VIN pada TS ambigu (arus masuk atau status daya masuk)",
              "Low", "High", "Medium", "Farhan", "2026-10-23",
              "Klarifikasi ke PPK",
              status_by_week={4: "Open", 5: "Open", 6: "Open", 7: "Closed (diklarifikasi ke PPK, MoM 3010)"}),
        _risk("R-SB04-003", "Risk", "2026-10-13",
              "Tarik kabel ethernet cukup panjang sehingga perlu banyak wiring",
              "Medium", "Medium", "Medium", "Farhan", "2026-10-30",
              "Ethernet tetap digunakan; estimasi rute <100 m; usulan switch kecil di box tambahan (EV-012)"),
        _risk("R-SB04-004", "Issue", "2026-10-14",
              "Pembagian MCB panel lantai tidak sesuai desain awal (lampu dan stop kontak tergabung); kemungkinan perlu panel box tambahan",
              "Medium", "High", "High", "Farhan", "2026-10-23",
              "Titik ukur per tenant/feeder; rewiring/panel tambahan dicatat sebagai rekomendasi ke pengelola gedung"),
        _risk("R-SB04-005", "Risk", "2026-10-14",
              "Usulan pemasangan lewat vendor tanpa bendera dan pembelian gateway/sensor via marketplace; risiko temuan audit BPK",
              "High", "Medium", "High", "PM", "2026-10-23",
              "Keputusan PM/manajemen; bukti pembelian sah dan spek >= TS harus bisa ditunjukkan"),
    ],
    "SB05": [
        _risk("R-SB05-001", "Issue", "2026-10-09",
              "Software di TS berjudul Kenyamanan Ruangan - Sistem Pencahayaan, isinya modul pencahayaan",
              "High", "High", "Critical", "Urbansolv / PPK", "2026-10-23",
              "Klarifikasi (action item 1009-2); bangun modul umum per zona sampai jelas",
              status_by_week={4: "Open", 5: "Open", 6: "Open", 7: "Closed (lingkup AC dikonfirmasi PPK, MoM 2310)"}),
        _risk("R-SB05-002", "Risk", "2026-10-13",
              "TS tidak memuat gateway HVAC; data unit AC tidak punya sumber",
              "Medium", "High", "High", "Amar", "2026-10-30",
              "Putuskan perlu-tidaknya gateway dan sumber anggarannya"),
        _risk("R-SB05-003", "Risk", "2026-10-13",
              "Sensor hanya dapat dibaca lewat Tuya Cloud (protokol tertutup, butuh internet)",
              "Medium", "Medium", "Medium", "Amar", "2026-10-30",
              "Bungkus lewat bridge MQTT milik sendiri; catat sebagai risiko BGC AC-08/AC-10"),
    ],
    "SB06": [
        _risk("R-SB06-001", "Risk", "2026-10-13",
              "Jaringan 2G dapat dimatikan operator selama umur proyek",
              "Medium", "Low", "Low", "Sutani", "2026-11-13",
              "WiFi jalur utama; slot modem di PCB dapat diganti LTE Cat-1"),
        _risk("R-SB06-002", "Risk", "2026-10-13",
              "Unit 3 x 60 L mungkin tidak muat di semua titik",
              "Medium", "Medium", "Medium", "Sutani", "2026-10-30",
              "Ukur produk terpilih dan ruang di tiap titik"),
    ],
    "SB07": [
        _risk("R-SB07-001", "Issue", "2026-10-09",
              "Spesifikasi LED dimmable belum dikonfirmasi vendor (klarifikasi MoM 0910)",
              "Medium", "Medium", "Medium", "Tezar", "2026-10-30",
              "Konfirmasi spesifikasi kontrol dim ke PPK dan vendor lampu"),
        _risk("R-SB07-002", "Risk", "2026-10-16",
              "24 titik sensing menunggu penetapan titik final",
              "Low", "Medium", "Low", "Tezar", "2026-10-30",
              "Penetapan titik final oleh PPK"),
    ],
    "SB08": [
        _risk("R-SB08-001", "Issue", "2026-10-09",
              "Harga quotation vendor sensor air melampaui HPS pada beberapa item",
              "High", "Medium", "High", "Tezar", "2026-10-30",
              "Negosiasi ulang; siapkan alternatif vendor dengan spek setara"),
        _risk("R-SB08-002", "Risk", "2026-10-16",
              "Akses ruang pompa untuk survei lanjutan terbatas",
              "Medium", "Low", "Medium", "Tezar", "2026-10-23",
              "Izin akses dari pengelola gedung"),
    ],
    "SB09": [
        _risk("R-SB09-001", "Risk", "2026-10-09",
              "Kebutuhan sensor level dan flow menunggu konfirmasi kapasitas IPAL eksisting",
              "Medium", "Medium", "Medium", "Tezar", "2026-10-30",
              "Konfirmasi kapasitas dan titik ukur IPAL dengan operasional gedung"),
        _risk("R-SB09-002", "Issue", "2026-10-09",
              "PO prioritas barang belum terbit (bahasan MoM 2509)",
              "High", "High", "High", "PMO", "2026-10-30",
              "Percepat penerbitan PO prioritas barang",
              status_by_week={4: "Open", 5: "Open", 6: "Open", 7: "Closed (PO terbit 29-Okt)"},
              change_impact="Menahan pengadaan sensor IPAL"),
    ],
    "SB10": [
        _risk("R-SB10-001", "Issue", "2026-10-09",
              "PIC Ventilasi baru dikonfirmasi (Tezar/Urbansolv); handover data Indihealth belum lengkap",
              "High", "High", "High", "Tezar", "2026-10-23",
              "Lengkapi handover dokumen dan akses; mulai assessment baseline"),
        _risk("R-SB10-002", "Risk", "2026-10-23",
              "Akses ruang AHU terbatas untuk survei",
              "Medium", "Medium", "Medium", "Tezar", "2026-11-06",
              "Jadwalkan akses AHU dengan operasional gedung"),
    ],
    "SB11": [
        _risk("R-SB11-001", "Issue", "2026-10-09",
              "Point list utilitas (listrik, air, gas) belum dikunci dengan pengelola gedung",
              "High", "High", "High", "Rizki Samsul", "2026-10-30",
              "Finalisasi point list bersama pengelola/PPK"),
        _risk("R-SB11-002", "Issue", "2026-10-16",
              "SB11-01 (Sistem Pengelolaan Utilitas) belum masuk daftar pengadaan 2-Okt",
              "Medium", "Medium", "Medium", "Rizki Samsul", "2026-10-30",
              "Masukkan ke pengadaan gelombang 2",
              status_by_week={4: "Open", 5: "Open", 6: "Open", 7: "Closed (masuk pengadaan gelombang 2, MoM 3010)"}),
    ],
    "SB12": [
        _risk("R-SB12-001", "Risk", "2026-10-09",
              "Integrasi 12 subsistem: protokol dan registrasi telemetry belum seragam",
              "High", "Medium", "High", "Rizki Samsul", "2026-11-13",
              "Standarisasi topik MQTT dan registry API; wajibkan register/topic map per subsistem"),
        _risk("R-SB12-002", "Issue", "2026-10-16",
              "Workstation BISMA (SB12-05) baru diusulkan pada Pengajuan 16-Okt; anggaran menunggu persetujuan",
              "Medium", "Medium", "Medium", "PMO", "2026-10-30",
              "Keputusan pengadaan workstation pada bahasan meeting 16 Okt"),
    ],
}

# ---------------------------------------------------------------------------
# Synthesized minutes for sessions W6 and W7 (no source MoM exists)
# ---------------------------------------------------------------------------

MOM_W6 = {
    "title": "23102026 - MoM Weekly Meeting Smart Building ke-6",
    "info": [
        ("Hari/Tanggal", "Jum'at, 23 Oktober 2026"),
        ("Waktu", "10.00 s/d selesai"),
        ("Tempat", "Zoom"),
        ("Topik", "Weekly Meeting Smart Building ke-6: rekap progress cut-off 23 Okt dan mitigasi komponen tertinggal"),
        ("Peserta", "Pak Pujo, Pak Samsul, Rizki (Kazee); Mas Sandhi (PM); Mbak Sani; Amar, Nadhif (Indismart); Farhan, Sutani (LCI); Justin Elisa; Tezar (Urbansolv); Salsa (PMO)"),
    ],
    "tujuan": [
        "Rekap progress 12 komponen per cut-off 23 Oktober 2026.",
        "Keputusan mitigasi untuk komponen yang tertinggal dari kurva rencana.",
        "Memastikan kesiapan checkpoint progres minimum 60% pada 31 Oktober 2026.",
    ],
    "pembahasan": [
        "A. Indismart - Alarm Kebencanaan (28,3% vs rencana 27,1%, hijau): desain papan D7S berjalan; menunggu datasheet FACP. Kamera Pengawasan (7,8% vs rencana 19,5%, merah): pemilihan merek kamera/NVR belum selesai sehingga API collector belum bisa ditetapkan. Pengkondisian Udara (21,0% vs rencana 18,3%, hijau): lingkup software AC dikonfirmasi PPK.",
        "B. LCI / Elisa - Kontrol Akses (14,5% vs rencana 22,5%, merah): kapasitas elevator dikonfirmasi 64 lantai sehingga PO dapat terbit minggu ini. Kelistrikan (9,0% vs rencana 20,0%, merah): survei vendor dipercepat; DED berjalan. Pengelolaan Sampah (20,0% vs rencana 19,5%, hijau): prototipe masuk tahap perakitan.",
        "C. Urbansolv - Pencahayaan (22,0% vs rencana 27,5%, kuning): PO sensor disiapkan. Air Bersih (21,5% vs rencana 27,5%, kuning): PO gelombang 1 terbit. Air Limbah (28,5% vs rencana 27,5%, hijau): menunggu PO prioritas barang yang dijadwalkan terbit minggu ini. Ventilasi (3,0% vs rencana 27,5%, merah): assessment baseline ruang selesai; akses AHU dijadwalkan.",
        "D. Kazee - BISMA (60,0% vs rencana 58,2%, hijau): connector Alarm teruji di sandbox. Pengelolaan Utilitas (7,0% vs rencana 27,5%, merah): point list final disepakati dengan pengelola; SB11-01 dimasukkan ke pengadaan gelombang 2.",
        "Checkpoint 60% (31-Okt) dipastikan tidak tercapai merata; 4 komponen memerlukan recovery plan dan deviation dicatat sebagai temuan tanpa mengubah baseline.",
    ],
    "action_items": [
        ["No", "Action Item", "PIC", "Target"],
        ["1", "Finalisasi merek kamera/NVR dengan ONVIF dan API terbuka", "Nadhif", "30 Oktober 2026"],
        ["2", "Terbitkan PO elevator access control setelah konfirmasi 64 lantai", "Farhan", "30 Oktober 2026"],
        ["3", "Percepat verifikasi lapangan vendor kelistrikan (paket 0)", "Farhan / Elisa", "28 Oktober 2026"],
        ["4", "Lengkapi handover dokumen ventilasi dari Indihealth", "Tezar", "28 Oktober 2026"],
        ["5", "Jadwalkan akses ruang AHU untuk survei ventilasi", "Tezar / Operasional Gedung", "28 Oktober 2026"],
        ["6", "Kunci point list utilitas bersama pengelola gedung", "Rizki (Kazee)", "28 Oktober 2026"],
        ["7", "Masukkan SB11-01 ke daftar pengadaan gelombang 2", "PMO / Kazee", "30 Oktober 2026"],
        ["8", "Terbitkan PO prioritas barang Air Limbah (Recap ADB)", "PMO", "29 Oktober 2026"],
        ["9", "Follow-up datasheet FACP TNT-AFA02L ke vendor", "Amar", "29 Oktober 2026"],
        ["10", "Pantau harga quotation sensor air terhadap HPS", "Tezar", "30 Oktober 2026"],
        ["11", "Terima PO sensor pencahayaan (24 unit) dan laporkan delivery", "Tezar", "30 Oktober 2026"],
        ["12", "Update Master Gantt dan rekap progress mingguan", "PMO (Salsa)", "Setiap Jumat"],
    ],
    "isu": [
        "Empat komponen berstatus merah per 23-Okt: Kamera Pengawasan, Kelistrikan, Ventilasi, Pengelolaan Utilitas.",
        "Checkpoint progres minimum 60% pada 31 Oktober berisiko tidak tercapai merata; baseline tidak diubah, deviation dicatat.",
        "Risiko baru: izin vendor lift untuk kamera (R-SB02-003) dan akses ruang AHU (R-SB10-002).",
    ],
    "kesimpulan": [
        "Tiga komponen unggul (Alarm, Pengkondisian Udara, Sampah) dipertahankan; BISMA on-track.",
        "Recovery plan Kamera, Kelistrikan, Ventilasi, dan Utilitas dipantau mingguan sampai kembali ke jalur.",
        "Konfirmasi kapasitas elevator (64 lantai) membuka PO Kontrol Akses.",
    ],
}

MOM_W7 = {
    "title": "30102026 - MoM Weekly Meeting Smart Building ke-7",
    "info": [
        ("Hari/Tanggal", "Jum'at, 30 Oktober 2026"),
        ("Waktu", "10.00 s/d selesai"),
        ("Tempat", "Zoom"),
        ("Topik", "Weekly Meeting Smart Building ke-7: rekap cut-off 30 Okt dan kesiapan checkpoint 60% (31 Okt)"),
        ("Peserta", "Pak Pujo, Pak Samsul, Rizki (Kazee); Mas Sandhi (PM); Mbak Sani; Amar, Nadhif (Indismart); Farhan, Sutani (LCI); Justin Elisa; Tezar (Urbansolv); Salsa (PMO)"),
    ],
    "tujuan": [
        "Rekap progress 12 komponen per cut-off 30 Oktober 2026.",
        "Evaluasi kesiapan checkpoint progres minimum 60% pada 31 Oktober 2026.",
        "Penetapan recovery plan komponen merah menuju target 80% (30 November).",
    ],
    "pembahasan": [
        "A. Indismart - Alarm Kebencanaan (38,1% vs rencana 36,7%, hijau): datasheet FACP diterima 29-Okt sehingga risiko port komunikasi ditutup. Kamera Pengawasan (10,2% vs rencana 24,8%, merah): kandidat ber-API terbuka terbatas; risiko API vendor dinaikkan menjadi High dan dieskalasi ke PPK. Pengkondisian Udara (36,0% vs rencana 32,6%, hijau): dokumentasi akses data selesai; menunggu kedatangan 29 sensor.",
        "B. LCI / Elisa - Kontrol Akses (22,5% vs rencana 27,8%, kuning): membaik setelah PO elevator access control siap terbit. Kelistrikan (15,5% vs rencana 32,4%, merah): survei vendor selesai; DED pengawatan panel berjalan. Pengelolaan Sampah (34,0% vs rencana 33,3%, hijau): prototipe lolos uji fungsi dasar.",
        "C. Urbansolv - Pencahayaan (28,0% vs rencana 33,0%, kuning): PO 24 sensor cahaya terbit. Air Bersih (26,0% vs rencana 33,0%, kuning): sebagian sensor diterima; instalasi dimulai. Air Limbah (34,5% vs rencana 33,0%, hijau): PO prioritas barang terbit 29-Okt; risiko ketergantungan PO ditutup. Ventilasi (6,0% vs rencana 33,0%, merah): desain disetujui internal; recovery plan disusun, forecast finish bergeser dari baseline.",
        "D. Kazee - BISMA (65,0% vs rencana 63,5%, hijau): connector Alarm dan Kamera terintegrasi sandbox. Pengelolaan Utilitas (12,0% vs rencana 33,0%, merah): point list final disetujui; SB11-01 resmi masuk pengadaan gelombang 2 sehingga risiko pengadaan ditutup.",
        "Checkpoint 60% (31-Okt): 8 komponen mendekati/melewati target, 4 komponen merah memerlukan recovery plan. Baseline 18-Sep tetap berlaku; seluruh deviation dicatat sebagai temuan assurance.",
    ],
    "action_items": [
        ["No", "Action Item", "PIC", "Target"],
        ["1", "Eskalasi keputusan merek kamera/NVR ke PPK (risiko API dinaikkan High)", "PM / Nadhif", "4 November 2026"],
        ["2", "Terbitkan PO elevator access control", "Farhan", "4 November 2026"],
        ["3", "Finalisasi DED kelistrikan dan PO komponen 40 power meter", "Farhan", "6 November 2026"],
        ["4", "Recovery plan Ventilasi menuju target 80% (30-Nov)", "Tezar", "4 November 2026"],
        ["5", "Recovery plan Pengelolaan Utilitas menuju target 80% (30-Nov)", "Rizki (Kazee)", "4 November 2026"],
        ["6", "Jadwal padam untuk pemasangan power meter di panel lantai", "Farhan / Operasional", "6 November 2026"],
        ["7", "Penerimaan barang sensor Pengkondisian Udara (29 unit)", "Amar", "6 November 2026"],
        ["8", "Penerimaan dan instalasi sensor IPAL pasca-PO", "Tezar", "6 November 2026"],
        ["9", "Konfirmasi anggaran workstation BISMA (SB12-05)", "PMO / Kazee", "6 November 2026"],
        ["10", "Integrasi connector subsistem berikutnya ke BISMA", "Rizki (Kazee)", "13 November 2026"],
        ["11", "Laporkan rekap checkpoint 60% per komponen", "PMO (Salsa)", "31 Oktober 2026"],
        ["12", "Update Master Gantt dan rekap progress mingguan", "PMO (Salsa)", "Setiap Jumat"],
    ],
    "isu": [
        "Empat komponen berstatus merah per 30-Okt: Kamera Pengawasan, Kelistrikan, Ventilasi, Pengelolaan Utilitas.",
        "Risiko API vendor kamera dinaikkan dari Medium menjadi High; eskalasi ke PPK.",
        "Forecast finish Ventilasi dan Utilitas bergeser dari baseline; baseline 18-Sep tetap berlaku, deviation dicatat.",
    ],
    "kesimpulan": [
        "Alarm, Pengkondisian Udara, Sampah, Air Limbah, dan BISMA on-track; Kontrol Akses, Pencahayaan, dan Air Bersih kuning dan membaik.",
        "Checkpoint 60% tidak tercapai merata; recovery plan 4 komponen merah menjadi prioritas November.",
        "Baseline tidak diubah; seluruh pergeseran dicatat sebagai temuan dengan referensi evidence mingguan.",
    ],
}
