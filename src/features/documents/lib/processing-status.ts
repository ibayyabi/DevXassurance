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
  queued: "Menunggu pekerja analisis tersedia.",
  processing: "Sedang dianalisis oleh pekerja dokumen.",
  needs_review:
    "Pemrosesan selesai dengan temuan yang perlu keputusan peninjau; bukan kegagalan.",
  completed: "Pemrosesan selesai tanpa peringatan pemrosesan.",
  failed: "Pemrosesan berhenti sebelum selesai; hasil parsial tidak dianggap lengkap.",
  cancelled: "Attempt dihentikan karena digantikan percobaan lain.",
};

export const processingStateCauses: Record<ProcessingState, string> = {
  uploaded: "Analisis otomatis belum diantrekan untuk format ini.",
  queued:
    "Antrean menunggu kapasitas pekerja atau jeda retry (backoff) berjalan; tidak ada data yang hilang.",
  processing:
    "Attempt masih memegang lease; tahap panjang (parser/OCR) tidak memperbarui lease per menit.",
  needs_review:
    "Classifier, formula tidak terjawab, interpretasi sheet, atau warning validasi menandai dokumen ini.",
  completed:
    "Pemrosesan tuntas; nilai dan status assurance tetap dihitung dari observasi tervalidasi, bukan dari status ini.",
  failed:
    "Attempt berhenti: kegagalan perangkat/provider, lease kedaluwarsa (stale_claim_token saat recovery), atau batas retry tercapai.",
  cancelled: "Attempt digantikan oleh retry manual atau percobaan lebih baru.",
};

export const processingStateActions: Record<ProcessingState, string> = {
  uploaded: "Gunakan konfirmasi metadata untuk memproses otomatis, atau simpan sebagai referensi.",
  queued:
    "Tunggu; retry otomatis berjalan dengan backoff bertingkat (15 detik hingga 5 menit) tanpa mengirim ulang kelompok yang sudah selesai.",
  processing:
    "Tunggu; pekerja memperbarui lease secara berkala dan menghentikan diri bila kepemilikan hilang.",
  needs_review:
    "Tinjau warning dan observasi tervalidasi; domain yang belum diproses tetap kesenjangan bukti.",
  completed:
    "Pemrosesan tuntas; status ini bukan jaminan coverage assurance penuh — periksa coverage per domain.",
  failed:
    "Gunakan \"Ulangi pemrosesan dokumen\"; checkpoint kelompok yang valid dipakai ulang dan kelompok tertunda (mis. 429 kuota) dikirim ulang saja.",
  cancelled: "Pantau attempt pengganti; tidak ada tindakan tambahan.",
};

export function processingCause(status: string): string | null {
  return processingStateCauses[status as ProcessingState] ?? null;
}

export function processingAction(status: string): string | null {
  return processingStateActions[status as ProcessingState] ?? null;
}

export function processingLabel(status: string): string {
  return processingStateLabels[status as ProcessingState] ?? status.replaceAll("_", " ");
}
