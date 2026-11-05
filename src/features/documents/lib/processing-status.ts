// Single source of truth for processing-status messaging: each status maps to
// one Indonesian label, one cause, and one recovery action, so the document
// library, assurance workspace, and details panel describe queued, processing,
// failed, needs_review, and completed the same way. Statuses describe job
// progress only — they never imply complete assurance coverage.
export type ProcessingState =
  | "uploaded"
  | "queued"
  | "processing"
  | "needs_review"
  | "completed"
  | "failed"
  | "cancelled";

export const processingStateLabels: Record<ProcessingState, string> = {
  uploaded: "Diunggah",
  queued: "Dalam antrean",
  processing: "Diproses",
  needs_review: "Perlu diperiksa",
  completed: "Selesai",
  failed: "Gagal",
  cancelled: "Dibatalkan",
};

export const processingStateDescriptions: Record<ProcessingState, string> = {
  uploaded: "File tersimpan; analisis otomatis belum dimulai.",
  queued: "Job menunggu kapasitas pekerja atau jeda retry (backoff).",
  processing: "Job tercatat sedang diproses; lihat diagnostik lease bila tersedia.",
  needs_review:
    "Pemrosesan selesai dengan temuan yang perlu keputusan peninjau; bukan kegagalan.",
  completed: "Pemrosesan selesai; peringatan sebelumnya dapat tetap tersimpan.",
  failed: "Pemrosesan berhenti sebelum selesai; hasil parsial tidak dianggap lengkap.",
  cancelled: "Attempt dihentikan karena digantikan percobaan lain.",
};

export const processingStateCauses: Record<ProcessingState, string> = {
  uploaded: "Status dokumen masih uploaded; status ini tidak menetapkan alasan job belum dimulai.",
  queued:
    "Job menunggu kapasitas pekerja atau jeda retry (backoff); status antrean bukan bukti kehilangan evidence.",
  processing:
    "Status processing tidak memastikan lease masih aktif; diagnostik job menunjukkan lease aktif atau kedaluwarsa bila tersedia.",
  needs_review:
    "Classifier, formula tidak terjawab, interpretasi sheet, atau warning validasi menandai dokumen ini.",
  completed:
    "Pemrosesan tuntas; nilai dan status assurance tetap dihitung dari observasi tervalidasi, bukan dari status ini.",
  failed:
    "Pemrosesan berhenti sebelum selesai; status ini sendiri tidak membuktikan penyebab historis, jadi lihat kode/error job bila tersedia.",
  cancelled: "Attempt digantikan oleh retry manual atau percobaan lebih baru.",
};

type ProcessingDiagnostic = {
  status?: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  retryPending?: boolean;
  leaseActive?: boolean;
  leaseExpired?: boolean;
  leaseUnknown?: boolean;
};

export const processingStateActions: Record<ProcessingState, string> = {
  uploaded: "Gunakan konfirmasi metadata untuk memproses otomatis, atau simpan sebagai referensi.",
  queued:
    "Retry otomatis hanya dapat dijalankan bila worker memeriksa antrean; backoff menentukan kapan job siap. Jika antrean tidak bergerak, periksa ketersediaan worker. Untuk HTTP 429, pulihkan kuota dan tunggu backoff; jangan mulai ulang manual saat job masih queued.",
  processing:
    "Tunggu dan periksa diagnostik lease; status processing saja tidak memastikan pekerja masih memegang lease.",
  needs_review:
    "Tinjau warning dan observasi tervalidasi; domain yang belum diproses tetap kesenjangan bukti.",
  completed:
    "Pemrosesan tuntas; status ini bukan jaminan coverage assurance penuh — periksa coverage per domain.",
  failed:
    "Periksa kode/error sebelum mengulangi. Jika tercatat HTTP 429, pulihkan kuota provider lebih dahulu; kelompok yang selesai, jika ada, dipakai ulang.",
  cancelled: "Pantau attempt pengganti; tidak ada tindakan tambahan.",
};

export function processingCause(status: string, diagnostic?: ProcessingDiagnostic | null): string | null {
  if (status === "failed" && diagnostic && (diagnostic.status === "processing" || diagnostic.status === "queued")) {
    return processingCause(diagnostic.status, diagnostic);
  }
  if (status === "processing" && diagnostic?.status === "processing") {
    if (diagnostic.leaseExpired) return "Lease job kedaluwarsa; status ini tidak memastikan pekerja telah berhenti.";
    if (diagnostic.leaseActive) return "Diagnostik job menunjukkan lease aktif saat terakhir dibaca.";
    if (diagnostic.leaseUnknown) return "Waktu kedaluwarsa lease tidak tersedia; kepemilikan proses tidak dapat dipastikan.";
  }
  if (status === "queued" && diagnostic?.errorCode === "llm_provider_transient_failure") {
    return /http 429\b/i.test(diagnostic.errorMessage ?? "")
      ? "Diagnostik mencatat HTTP 429 dari provider; job menunggu retry dan kuota perlu dipulihkan."
      : "Job menunggu retry setelah kegagalan provider sementara.";
  }
  if (status === "failed" && /http 429\b/i.test(diagnostic?.errorMessage ?? "")) {
    return "Pesan job mencatat HTTP 429 dari provider; ini bukan bukti bahwa evidence tidak ada.";
  }
  return processingStateCauses[status as ProcessingState] ?? null;
}

export function processingAction(status: string, diagnostic?: ProcessingDiagnostic | null): string | null {
  if (status === "failed" && diagnostic && (diagnostic.status === "processing" || diagnostic.status === "queued")) {
    return processingAction(diagnostic.status, diagnostic);
  }
  if (status === "queued" && /http 429\b/i.test(diagnostic?.errorMessage ?? "")) {
    if (diagnostic?.retryPending === true) {
      return "Jeda backoff setelah HTTP 429 masih berjalan. Pulihkan kuota provider, lalu tunggu worker tersedia; jangan mulai ulang manual selama status masih queued.";
    }
    if (diagnostic?.retryPending === false) {
      return "HTTP 429 tercatat, tetapi jeda backoff tidak sedang aktif. Pulihkan kuota provider dan pastikan worker memeriksa antrean; jangan mulai ulang manual selama status masih queued.";
    }
    return "HTTP 429 tercatat, tetapi status backoff tidak dapat dipastikan. Pulihkan kuota provider dan pastikan worker memeriksa antrean; jangan mulai ulang manual selama status masih queued.";
  }
  if (status === "processing" && diagnostic?.status === "processing") {
    if (diagnostic.leaseExpired) {
      return "Pengelola proyek dapat memilih “Ganti attempt kedaluwarsa” untuk mengantrekan ulang; lease kedaluwarsa tidak memastikan worker telah berhenti.";
    }
    if (diagnostic.leaseActive) return "Lease aktif saat terakhir dibaca; tunggu dan jangan mulai ulang pemrosesan.";
    if (diagnostic.leaseUnknown) return "Lease tidak dapat dipastikan; perbarui diagnostik sebelum memulai ulang pemrosesan.";
  }
  if (status === "failed" && /http 429\b/i.test(diagnostic?.errorMessage ?? "")) {
    return "Pulihkan kuota provider sebelum memilih Ulangi pemrosesan; kelompok yang selesai, jika ada, dipakai ulang.";
  }
  return processingStateActions[status as ProcessingState] ?? null;
}

export function processingLabel(status: string): string {
  return processingStateLabels[status as ProcessingState] ?? status.replaceAll("_", " ");
}
