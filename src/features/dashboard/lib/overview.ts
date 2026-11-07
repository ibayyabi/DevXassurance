import type { ReviewCondition } from "@/features/assurance/lib/analysis";
import type { RiskSnapshot } from "@/features/assurance/lib/analysis";
import type { RiskItemFinding } from "@/features/assurance/lib/risk-comparison";
import type {
  ProgressComputedStatus,
  ProgressRagRule,
  ProgressScopeResult,
} from "@/features/assurance/lib/schedule-comparison";
import type {
  AssuranceDocument,
  AssuranceFinding,
  AssuranceObservationReview,
  AssuranceReview,
  CostObservationReviewRow,
  ObservationReviewDocument,
  ObservationReviewRow,
} from "@/features/assurance/lib/queries";

/**
 * Dashboard read model over the published assurance analysis. Everything here
 * is derived from stored, cited evidence: missing values stay missing (never
 * zero), unproven periods stay unproven, and source-reported RAG never becomes
 * a computed condition.
 */

const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
] as const;

const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
] as const;

export type PeriodParts = { month: string; date: string | null };

export function parsePeriod(value: string | null | undefined): PeriodParts | null {
  const trimmed = (value ?? "").trim();
  const month = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (month) {
    const index = Number(month[2]);
    return index >= 1 && index <= 12 ? { month: trimmed, date: null } : null;
  }
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!date) return null;
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === trimmed
    ? { month: trimmed.slice(0, 7), date: trimmed }
    : null;
}

function monthEnd(month: string) {
  const [year, index] = month.split("-").map(Number);
  return new Date(Date.UTC(year, index, 0)).toISOString().slice(0, 10);
}

/** Indonesian period label; a month-only value never renders as a fake date. */
export function formatPeriodLabel(value: string | null | undefined): string {
  const parsed = parsePeriod(value);
  if (!parsed) return (value ?? "").trim() || "Tanggal tidak diketahui";
  const [year, month] = parsed.month.split("-").map(Number);
  if (!parsed.date) return `${MONTHS[month - 1]} ${year}`;
  return `${Number(parsed.date.slice(8, 10))} ${MONTHS[month - 1]} ${year}`;
}

export function formatShortPeriod(value: string | null | undefined): string {
  const parsed = parsePeriod(value);
  if (!parsed) return (value ?? "").trim() || "?";
  const [year, month] = parsed.month.split("-").map(Number);
  if (!parsed.date) return `${SHORT_MONTHS[month - 1]} ${year}`;
  return `${Number(parsed.date.slice(8, 10))} ${SHORT_MONTHS[month - 1]} ${String(year).slice(2)}`;
}

export type ReviewCutoff = {
  precision: "month" | "date" | "unknown";
  label: string;
};

export function reviewCutoff(
  review: Pick<AssuranceReview, "reportingPeriod"> & {
    cutoffPrecision?: "month" | "date" | "unknown";
  },
): ReviewCutoff {
  const parsed = parsePeriod(review.reportingPeriod);
  const precision = review.cutoffPrecision ??
    (parsed?.date ? "date" : "month");
  if (precision === "unknown") {
    return { precision, label: "Periode tidak terbukti" };
  }
  if (!parsed) {
    return {
      precision,
      label: review.reportingPeriod || "Tanggal tidak diketahui",
    };
  }
  return {
    precision,
    label: precision === "month"
      ? formatPeriodLabel(parsed.month)
      : formatPeriodLabel(parsed.date ?? parsed.month),
  };
}

export type EvidencePeriodState = "match" | "mismatch" | "month_only" | "unknown";

/**
 * A review cut-off proves a day; a document's month-only metadata never proves
 * a weekly date. Different days are a mismatch, and a month inside the cut-off
 * month without a day stays unproven rather than being treated as equal.
 */
export function compareEvidencePeriod(
  reviewPeriod: string,
  precision: "month" | "date" | "unknown",
  documentPeriod: string | null | undefined,
): EvidencePeriodState {
  const review = parsePeriod(reviewPeriod);
  const document = parsePeriod(documentPeriod);
  if (precision === "unknown" || !review || !document) return "unknown";
  if (precision === "month") {
    return document.month === review.month ? "match" : "mismatch";
  }
  const reviewDate = review.date ?? monthEnd(review.month);
  if (!document.date) {
    return document.month === review.month ? "month_only" : "mismatch";
  }
  return document.date === reviewDate ? "match" : "mismatch";
}

/**
 * Authoritative currentness: the DB-checked `isAnalysisCurrent` from
 * `assurance_analysis_is_current` (fingerprint/versions/rule/decision). The
 * client never reimplements fingerprint comparison; it fails closed when the
 * DB check says false (or is unavailable).
 */
export function isAnalysisCurrent(review: AssuranceReview) {
  return review.isAnalysisCurrent === true;
}

type SourceVersion = {
  document_id?: unknown;
  role?: unknown;
  content_hash?: unknown;
};

function metadataSourceVersions(review: AssuranceReview): SourceVersion[] {
  const versions = review.analysisMetadata.source_versions;
  return Array.isArray(versions)
    ? versions.filter((item): item is SourceVersion => typeof item === "object" && item !== null)
    : [];
}

function contentHashByDocument(review: AssuranceReview) {
  const hashes = new Map<string, string | null>();
  for (const version of metadataSourceVersions(review)) {
    if (typeof version.document_id !== "string") continue;
    hashes.set(
      version.document_id,
      typeof version.content_hash === "string" ? version.content_hash : null,
    );
  }
  return hashes;
}

export type Citation = {
  role: "baseline" | "current" | "previous";
  title: string;
  documentId: string | null;
  hash: string | null;
  location: string | null;
  excerpt: string | null;
};

type LocationRecord = Record<string, string | number>;

function recordValue(location: LocationRecord | null | undefined, ...keys: string[]) {
  if (!location) return null;
  for (const key of keys) {
    const value = location[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

export function formatSourceLocation(
  location: Record<string, string | number> | null | undefined,
): string | null {
  if (!location) return null;
  const sheet = recordValue(location, "sheetName", "sheet_name");
  const cellStart = recordValue(location, "cellRangeStart", "cell_range_start", "cell_reference");
  const cellEnd = recordValue(location, "cellRangeEnd", "cell_range_end");
  const row = recordValue(location, "rowStart", "row_start");
  const page = recordValue(location, "pageNumber", "page_number");
  const parts = [
    sheet ? `sheet ${sheet}` : null,
    cellStart ? `sel ${cellStart}${cellEnd && cellEnd !== cellStart ? `:${cellEnd}` : ""}` : null,
    !cellStart && row ? `baris ${row}` : null,
    recordValue(location, "sectionLabel", "section_label"),
    page ? `hal. ${page}` : null,
  ];
  return parts.filter((part): part is string => Boolean(part)).join(" · ");
}

function citationFromExcerpt(
  excerpt: AssuranceFinding["sourceExcerpts"][number],
  hashes: Map<string, string | null>,
): Citation {
  const documentId = excerpt.documentId ?? null;
  return {
    role: excerpt.role,
    title: excerpt.documentTitle ?? documentId ?? "Sumber tidak dikenal",
    documentId,
    hash: documentId ? hashes.get(documentId) ?? null : null,
    location: formatSourceLocation(excerpt.sourceLocation) ??
      (excerpt.pageNumber ? `hal. ${excerpt.pageNumber}` : null) ??
      excerpt.sectionLabel ?? null,
    excerpt: excerpt.excerpt ?? null,
  };
}

function citationFromSnapshot(
  snapshot: RiskSnapshot | null,
  role: "current" | "previous",
): Citation | null {
  if (!snapshot?.sourceRef) return null;
  const source = snapshot.sourceRef;
  return {
    role,
    title: source.documentTitle ?? source.documentId,
    documentId: source.documentId,
    hash: source.sourceContentHash,
    location: formatSourceLocation(source.valueSourceLocation ?? source.sourceLocation),
    excerpt: snapshot.excerpt ?? source.excerpt ?? null,
  };
}

// ---------------------------------------------------------------------------
// Review navigation and evidence identity
// ---------------------------------------------------------------------------

export type EvidenceItem = {
  documentId: string;
  title: string;
  fileName: string | null;
  role: "baseline" | "current";
  period: string | null;
  periodState: EvidencePeriodState;
  contentHash: string | null;
  hashShort: string | null;
  sameTitleInReview: boolean;
  sameTitleAcrossReviews: boolean;
  warnings: string[];
};

export type ReviewEvidence = {
  items: EvidenceItem[];
  periodWarnings: string[];
  sameNameCount: number;
};

const periodStateLabels: Record<EvidencePeriodState, string> = {
  match: "Cocok dengan cut-off",
  mismatch: "Di luar cut-off",
  month_only: "Hanya bulan; tanggal tidak terbukti",
  unknown: "Periode tidak diketahui",
};

export function evidencePeriodLabel(state: EvidencePeriodState) {
  return periodStateLabels[state];
}

/**
 * Same-name identity uses the actual uploaded filename, not the editable
 * title: identical titles with different original filenames are NOT the
 * same name; identical original filenames ARE even when titles differ.
 */
function nameKey(document: AssuranceDocument | undefined, fallback: string) {
  const key = (document?.fileName ?? document?.title ?? "").trim().toLocaleLowerCase("id");
  return key || fallback;
}

/**
 * Totally occurrences of a filename are grouped by (period, hash) so the
 * SAME document reused across reviews is one identity, while the same
 * filename on different documents (different id/hash) are distinct files.
 */

/**
 * Identity of the files linked to one review. Identical filenames are not
 * identities: each file is shown with its period, processing state and content
 * hash, and the same name across reviews is called out explicitly.
 */
export function buildReviewEvidence(
  review: AssuranceReview,
  reviews: readonly AssuranceReview[],
  documents: readonly AssuranceDocument[],
): ReviewEvidence {
  const cutoff = reviewCutoff(review);
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  const nameOccurrences = new Map<string, number>();
  for (const link of review.documents) {
    const document = documentsById.get(link.documentId);
    const key = nameKey(document, link.documentId);
    nameOccurrences.set(key, (nameOccurrences.get(key) ?? 0) + 1);
  }
  // Across reviews: same actual document counted once (by id), same filename
  // on differing documents counted as distinct files.
  const occurrencesAcrossReviews = new Map<string, Set<string>>();
  for (const item of reviews) {
    for (const link of item.documents) {
      const document = documentsById.get(link.documentId);
      const key = nameKey(document, link.documentId);
      // One identity per actual document (id + hash), distinct from filename.
      // Reusing the same document in another review is the SAME file;
      // the same filename on another document (new id/hash) is a new file.
      const identity = `${link.documentId}|${document?.contentHash ?? ""}`;
      const values = occurrencesAcrossReviews.get(key) ?? new Set<string>();
      values.add(identity);
      occurrencesAcrossReviews.set(key, values);
    }
  }

  const items = review.documents.map((link): EvidenceItem => {
    const document = documentsById.get(link.documentId);
    const title = document?.title ?? link.documentId;
    const fileName = document?.fileName ?? null;
    const key = nameKey(document, link.documentId);
    const period = document?.confirmedReportingPeriod ??
      document?.detectedReportingPeriod ?? null;
    const periodState = document
      ? compareEvidencePeriod(review.reportingPeriod, cutoff.precision, period)
      : "unknown";
    const contentHash = document?.contentHash ?? null;
    const sameTitleInReview = (nameOccurrences.get(key) ?? 0) > 1;
    const sameTitleAcrossReviews = (occurrencesAcrossReviews.get(key)?.size ?? 0) > 1;
    const warnings: string[] = [];
    if (!document) {
      warnings.push("Metadata berkas tidak tersedia; identitas file tidak dapat diperiksa.");
    } else {
      if (periodState === "mismatch") {
        warnings.push(
          `Periode dokumen ${period ? formatPeriodLabel(period) : "tidak diketahui"} berada di luar cut-off tinjauan ${cutoff.label}.`,
        );
      }
      if (periodState === "month_only") {
        warnings.push("Metadata hanya menyebut bulan; tanggal mingguan tidak terbukti dari sumber.");
      }
      if (periodState === "unknown") {
        warnings.push("Periode dokumen tidak diketahui; kesesuaian dengan cut-off tidak dapat dibuktikan.");
      }
      if (document.processingStatus === "needs_review") {
        warnings.push("Dokumen masih berstatus Perlu diperiksa; hanya observasi tervalidasi yang dipakai.");
      }
    }
    if (!contentHash) {
      warnings.push("Hash isi tidak tersedia; file dengan nama sama tidak dapat dibedakan dari versi lain.");
    }
    return {
      documentId: link.documentId,
      title,
      fileName,
      role: link.role,
      period,
      periodState,
      contentHash,
      hashShort: contentHash ? contentHash.slice(0, 12) : null,
      sameTitleInReview,
      sameTitleAcrossReviews,
      warnings,
    };
  }).sort((first, second) =>
    first.role === second.role
      ? first.title.localeCompare(second.title, "id")
      : first.role === "baseline" ? -1 : 1,
  );

  return {
    items,
    periodWarnings: items
      .filter((item) => item.periodState !== "match")
      .map((item) =>
        `${item.title}: ${item.period ? formatPeriodLabel(item.period) : "periode tidak diketahui"} — ${periodStateLabels[item.periodState]}.`,
      ),
    sameNameCount: items.filter((item) => item.sameTitleInReview || item.sameTitleAcrossReviews).length,
  };
}

export type ReviewNavigationItem = {
  id: string;
  periodLabel: string;
  statusLabel: string;
  /** True only for a genuine worker/analysis failure, not stale invalidation. */
  analysisFailed: boolean;
  analysisError: string | null;
  evidenceCount: number;
  periodWarningCount: number;
  sameNameCount: number;
  analysisCurrent: boolean;
};

const reviewStatusLabels: Record<string, string> = {
  draft: "Draf",
  evidence_ready: "Bukti siap — belum mutakhir",
  analyzing: "Menganalisis — belum mutakhir",
  findings_ready: "Temuan siap",
  report_draft: "Laporan draf",
  approved: "Disetujui",
  in_progress: "Sedang berjalan — belum mutakhir",
  completed: "Selesai",
  analysis_failed: "Analisis gagal",
};

export function buildReviewNavigation(
  reviews: readonly AssuranceReview[],
  documents: readonly AssuranceDocument[],
): ReviewNavigationItem[] {
  return reviews.map((item) => {
    const evidence = buildReviewEvidence(item, reviews, documents);
    // DB invalidation sets status to evidence_ready/analyzing with an error
    // like "Selected evidence changed...": that is stale, NOT a failed
    // analysis. Only analysis_failed is a real failure.
    const failed = item.status === "analysis_failed";
    return {
      id: item.id,
      periodLabel: formatPeriodLabel(item.reportingPeriod),
      statusLabel: failed ? "Analisis gagal" : (reviewStatusLabels[item.status] ?? item.status.replaceAll("_", " ")),
      analysisError: failed ? item.analysisError : null,
      analysisFailed: failed,
      evidenceCount: evidence.items.length,
      periodWarningCount: evidence.items.filter((entry) => entry.periodState !== "match").length,
      sameNameCount: evidence.sameNameCount,
      analysisCurrent: isAnalysisCurrent(item),
    };
  });
}

// ---------------------------------------------------------------------------
// Domain summaries (Budget, Schedule, Risk). Progress has its own section.
// ---------------------------------------------------------------------------

export type DomainSummary = {
  domain: "budget" | "schedule" | "risk";
  label: string;
  condition: ReviewCondition;
  cutoff: string;
  change: string | null;
  changeKnown: boolean;
  sources: Citation[];
  gapReason: string | null;
  warnings: string[];
};

function findDomain(review: AssuranceReview, domain: DomainSummary["domain"]) {
  return review.findings.find((finding) => finding.domain === domain);
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dedupeCitations(citations: Citation[]) {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    const key = [citation.role, citation.documentId, citation.hash, citation.location].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type RiskComparisonProvenance = {
  contract?: unknown;
  referenceFingerprint?: unknown;
  referenceVersions?: Record<string, unknown> | null;
  previousReviewId?: unknown;
  previousReportingPeriod?: unknown;
  previousDecisionSummary?: unknown;
  previousGapReason?: unknown;
  previousSourceVersions?: {
    document_id?: unknown;
    content_hash?: unknown;
  }[];
  previousSnapshotAvailable?: unknown;
  previousCoverageComplete?: unknown;
  previousCutoffComplete?: unknown;
  currentCoverageComplete?: unknown;
};

export function riskComparisonProvenance(review: AssuranceReview): RiskComparisonProvenance | null {
  // Persisted analysis metadata without a schema validator; every field is
  // narrowed where it is read.
  const value = review.analysisMetadata.risk_comparison_provenance as
    RiskComparisonProvenance | undefined;
  return typeof value === "object" && value !== null ? value : null;
}

/**
 * Stale results are preserved for navigation and evidence provenance but are
 * never presented as a current analysis: status, change and citation claims
 * are gated until the analysis is re-run.
 */
export const STALE_GAP_REASON =
  "Hasil analisis ini sudah tidak mutakhir (sumber berubah atau status belum terbit); status, perubahan, dan rujukan berikut tidak disajikan sebagai kondisi terkini. Jalankan analisis ulang.";

function staleDomainSummary(domain: DomainSummary["domain"], label: string): DomainSummary {
  return {
    domain,
    label,
    condition: "more_evidence_required",
    cutoff: "Tidak dinilai pada hasil tidak mutakhir",
    change: null,
    changeKnown: false,
    sources: [],
    gapReason: STALE_GAP_REASON,
    warnings: ["Hasil tidak mutakhir: lihat banner peringatan di atas."],
  };
}

export function buildDomainSummaries(
  review: AssuranceReview,
  documents: readonly AssuranceDocument[] = [],
): DomainSummary[] {
  if (!isAnalysisCurrent(review)) {
    return [
      staleDomainSummary("budget", "Anggaran"),
      staleDomainSummary("schedule", "Jadwal"),
      staleDomainSummary("risk", "Risiko"),
    ];
  }
  const cutoff = reviewCutoff(review);
  const hashes = contentHashByDocument(review);
  const titles = new Map(documents.map((document) => [document.id, document.title]));

  const budget = findDomain(review, "budget");
  const budgetChange = numberValue(budget?.variance?.percent);
  const budgetChangeLabel = budget?.variance?.comparable === true && budgetChange !== null
    ? `${budgetChange > 0 ? "+" : ""}${budgetChange.toFixed(1)}% terhadap baseline`
    : null;
  const budgetCutoff = textValue(budget?.currentValue?.as_of_date) ??
    textValue(budget?.currentValue?.period_label) ?? `tinjauan ${cutoff.label}`;
  const budgetSummary: DomainSummary = {
    domain: "budget",
    label: "Anggaran",
    condition: budget?.condition ?? "more_evidence_required",
    cutoff: budgetCutoff,
    change: budgetChangeLabel,
    changeKnown: budgetChangeLabel !== null,
    sources: dedupeCitations((budget?.sourceExcerpts ?? []).map((excerpt) =>
      citationFromExcerpt(excerpt, hashes),
    )),
    gapReason: budget?.condition === "more_evidence_required"
      ? budget.requiredEvidence.join(" · ") || budget.explanation
      : null,
    warnings: [],
  };

  const schedule = findDomain(review, "schedule");
  const delay = numberValue(schedule?.variance?.delay_days);
  const scheduleCutoff = textValue(schedule?.currentValue?.as_of_date) ??
    textValue(schedule?.currentValue?.period_label) ?? `tinjauan ${cutoff.label}`;
  const scheduleSummary: DomainSummary = {
    domain: "schedule",
    label: "Jadwal",
    condition: schedule?.condition ?? "more_evidence_required",
    cutoff: scheduleCutoff,
    change: delay === null
      ? null
      : delay === 0 ? "Sesuai baseline" : delay > 0
        ? `Terlambat ${delay} hari`
        : `Lebih cepat ${Math.abs(delay)} hari`,
    changeKnown: delay !== null,
    sources: dedupeCitations((schedule?.sourceExcerpts ?? []).map((excerpt) =>
      citationFromExcerpt(excerpt, hashes),
    )),
    gapReason: schedule?.condition === "more_evidence_required"
      ? schedule.requiredEvidence.join(" · ") || schedule.explanation
      : null,
    warnings: [],
  };

  const risk = findDomain(review, "risk");
  const provenance = riskComparisonProvenance(review);
  const items = Array.isArray(review.analysisMetadata.risk_item_findings)
    ? review.analysisMetadata.risk_item_findings as RiskItemFinding[]
    : [];
  const hasRiskComparison = provenance?.contract === "pmo_risk_comparison_v2";
  const currentCutoffs = [...new Set(items
    .map((item) => item.currentCutoff?.trim() ?? "")
    .filter(Boolean))];
  const previousCutoffs = [...new Set(items
    .map((item) => item.previousCutoff?.trim() ?? "")
    .filter(Boolean))];
  const changeCounts: Record<string, number> = {};
  for (const item of items) {
    changeCounts[item.changeType] = (changeCounts[item.changeType] ?? 0) + 1;
  }
  const comparableTypes = ["new", "increased", "decreased", "closed", "rating_changed"] as const;
  const changeParts = comparableTypes.flatMap((type) => {
    const count = changeCounts[type] ?? 0;
    return count === 0 ? [] : [`${count} ${type === "new" ? "baru" : type === "increased" ? "meningkat" : type === "decreased" ? "menurun" : type === "rating_changed" ? "berubah peringkat" : "ditutup"}`];
  });
  const notComparable = ["rating_not_comparable", "period_not_comparable", "identity_not_comparable", "not_reported"]
    .reduce((total, type) => total + (changeCounts[type] ?? 0), 0);
  const riskWarnings: string[] = [];
  if (currentCutoffs.length > 1) {
    riskWarnings.push(`Item risiko menyebut cut-off berbeda (${currentCutoffs.join(", ")}); perubahan tidak disatukan.`);
  }
  if (hasRiskComparison && items.length > 0 && currentCutoffs.length === 0) {
    riskWarnings.push("Item risiko tidak menyebut cut-off sendiri; tanggal tidak diambil dari sumber lain.");
  }
  const gapReasons: string[] = [];
  if (!hasRiskComparison) {
    gapReasons.push("Provenance perbandingan risiko tidak tersedia; hasil perbandingan lama tidak dipakai.");
  } else if (provenance) {
    if (typeof provenance.referenceFingerprint !== "string" || !provenance.referenceFingerprint.trim()) {
      gapReasons.push("Fingerprint referensi risiko tidak tercatat; hasil perbandingan belum dapat diverifikasi ulang terhadap sumbernya.");
    }
    if (!provenance.previousSnapshotAvailable) {
      gapReasons.push("Potret risiko sebelumnya belum tersedia; tidak ada risiko yang dinyatakan baru, dan tidak ada klaim ketiadaan.");
    }
    if (provenance.previousSnapshotAvailable && !provenance.previousCutoffComplete) {
      gapReasons.push("Cut-off potret sebelumnya tidak dapat dibuktikan.");
    }
    if (provenance.previousSnapshotAvailable && !provenance.previousCoverageComplete) {
      gapReasons.push("Coverage risiko potret sebelumnya belum lengkap.");
    }
    if (!provenance.currentCoverageComplete) {
      gapReasons.push("Coverage risiko periode berjalan belum lengkap.");
    }
  }
  if (notComparable > 0) {
    gapReasons.push(`${notComparable} item tidak dapat dibandingkan (identitas, skala, periode, atau tidak dilaporkan).`);
  }
  const presentOnly = changeCounts.present ?? 0;
  if (presentOnly > 0) {
    gapReasons.push(`${presentOnly} item hanya tercatat pada periode berjalan; tidak diklaim sebagai risiko baru.`);
  }
  if (items.length === 0) {
    gapReasons.push("Belum ada item risiko yang dapat dibandingkan.");
  }
  const riskSources = dedupeCitations(items.flatMap((item) => {
    const previous = citationFromSnapshot(item.previous, "previous");
    const current = citationFromSnapshot(item.current, "current");
    return [current, previous].filter((citation): citation is Citation => citation !== null);
  }));
  if (hasRiskComparison) {
    for (const version of provenance?.previousSourceVersions ?? []) {
      if (typeof version.document_id !== "string") continue;
      riskSources.push({
        role: "previous",
        title: titles.get(version.document_id) ?? version.document_id,
        documentId: version.document_id,
        hash: typeof version.content_hash === "string" ? version.content_hash : null,
        location: "sumber potret sebelumnya",
        excerpt: null,
      });
    }
  }
  const riskSummary: DomainSummary = {
    domain: "risk",
    label: "Risiko",
    condition: risk?.condition ?? "more_evidence_required",
    cutoff: `${currentCutoffs.join(" · ") || `tinjauan ${cutoff.label}`}${previousCutoffs.length > 0 ? ` · sebelumnya ${previousCutoffs.join(" / ")}` : ""}`,
    change: hasRiskComparison && changeParts.length > 0
      ? changeParts.join(" · ")
      : null,
    changeKnown: hasRiskComparison && changeParts.length > 0,
    sources: dedupeCitations(riskSources),
    gapReason: gapReasons.length ? gapReasons.join(" ") : null,
    warnings: riskWarnings,
  };

  return [budgetSummary, scheduleSummary, riskSummary];
}

// ---------------------------------------------------------------------------
// Progress per component
// ---------------------------------------------------------------------------

export type ProgressPoint = {
  percent: number | null;
  cutoff: string | null;
  periodLabel: string | null;
  citation: Citation | null;
};

export type ProgressScopeView = {
  key: string;
  scopeTitle: string;
  current: ProgressPoint | null;
  prior: ProgressPoint | null;
  baseline: ProgressPoint | null;
  deltaPercentPoints: number | null;
  deltaGapReason: string;
  gaps: { message: string; citation: Citation | null }[];
};

const deltaGapMessages: Record<string, string> = {
  no_current: "Belum ada nilai periode berjalan — tidak ada perubahan yang dihitung.",
  current_cutoff_unknown: "Tanggal cut-off berjalan tidak diketahui — perubahan tidak dihitung.",
  current_cutoff_mismatch: "Bukti periode berjalan tidak cocok dengan cut-off terpilih — perubahan tidak dihitung.",
  no_prior_snapshot: "Tidak ada snapshot bertanggal yang lebih awal — baseline rencana bukan snapshot sebelumnya.",
  unproven_measure_kind: "Jenis pengukuran tidak terbukti dari sumber — perubahan tidak dihitung.",
  uncomparable_scope: "Lingkup tidak dapat dipastikan atau tidak sebanding antarperiode.",
  unproven_measurement_basis: "Dasar pengukuran tidak terbukti pada kedua snapshot — perubahan tidak dihitung.",
  measurement_basis_mismatch: "Dasar pengukuran snapshot berbeda — perubahan tidak dihitung.",
  conflicting_observations: "Nilai sumber bertentangan — tidak ada nilai yang dipilih.",
};

const progressGapMessages: Record<string, string> = {
  current_cutoff_unknown: "Nilai berjalan tidak memiliki tanggal cut-off.",
  current_cutoff_mismatch: "Nilai berjalan berada di luar cut-off terpilih.",
  snapshot_cutoff_unknown: "Snapshot sebelumnya tidak memiliki tanggal yang dapat dibandingkan.",
  snapshot_not_earlier: "Snapshot tidak lebih awal dari cut-off berjalan.",
  conflicting_observations: "Terdapat nilai sumber yang bertentangan; tidak ada yang dipilih.",
};

type ProgressObservationLike = NonNullable<ProgressScopeResult["current"]>;

function progressPoint(observation: ProgressObservationLike | null): ProgressPoint | null {
  if (!observation) return null;
  return {
    percent: observation.percent,
    cutoff: observation.asOfDate ?? observation.periodLabel ?? null,
    periodLabel: observation.periodLabel,
    citation: observation.sourceRef
      ? {
          role: observation.role,
          title: observation.sourceRef.documentTitle ?? observation.sourceRef.documentId,
          documentId: observation.sourceRef.documentId,
          hash: observation.sourceRef.sourceContentHash,
          location: formatSourceLocation(
            observation.sourceRef.valueSourceLocation ?? observation.sourceRef.sourceLocation,
          ),
          excerpt: observation.excerpt,
        }
      : null,
  };
}

export function buildProgressScopes(review: AssuranceReview): ProgressScopeView[] {
  if (!isAnalysisCurrent(review)) return [];
  const scopes = Array.isArray(review.analysisMetadata.progress_observations)
    ? review.analysisMetadata.progress_observations as ProgressScopeResult[]
    : [];
  return scopes.map((scope) => {
    const scopeName = scope.scopeLevel === "project"
      ? "Total proyek"
      : scope.scopeLevel === "wbs" && scope.scopeLabel
        ? `WBS ${scope.scopeLabel}`
        : "Lingkup tidak diketahui";
    return {
      key: `${scope.scopeLevel}-${scope.scopeLabel ?? "project"}-${scope.measureKind}`,
      scopeTitle: `${scopeName} — ${scope.measureKind === "planned" ? "Planned" : scope.measureKind === "actual" ? "Actual" : "Jenis tak disebutkan"}`,
      current: progressPoint(scope.current),
      prior: progressPoint(scope.prior),
      baseline: progressPoint(scope.baseline),
      deltaPercentPoints: scope.deltaPercentPoints,
      deltaGapReason: scope.deltaGapReason
        ? deltaGapMessages[scope.deltaGapReason] ?? "Nilai disimpan tetapi tidak dibandingkan."
        : "Nilai disimpan tetapi tidak dibandingkan.",
      gaps: scope.gaps.map((gap) => ({
        message: progressGapMessages[gap.reason] ?? "Terdapat nilai sumber yang bertentangan; tidak ada yang dipilih.",
        citation: progressPoint(gap.observation)?.citation ?? null,
      })),
    };
  });
}

export type ComputedProgressView = {
  key: string;
  scopeTitle: string;
  cutoff: string | null;
  condition: ProgressComputedStatus["condition"];
  conditionLabel: string;
  variancePercentPoints: number | null;
  ruleVersion: string | null;
  reason: string | null;
};

const computedReasons: Record<string, string> = {
  no_approved_rule: "Tidak ada aturan proyek yang disetujui.",
  unknown_scope: "Lingkup sumber tidak dapat dipastikan.",
  cutoff_unknown: "Tanggal cut-off tidak diketahui.",
  cutoff_mismatch: "Nilai tidak cocok dengan cut-off berjalan.",
  unproven_measure_kind: "Planned/actual tidak terbukti dari sumber.",
  missing_planned_or_actual: "Pasangan planned dan actual belum lengkap.",
  unproven_period: "Periode sumber tidak terbukti.",
  period_mismatch: "Planned/actual berasal dari periode berbeda.",
  unproven_measurement_basis: "Basis pengukuran sumber tidak terbukti.",
  measurement_basis_mismatch: "Basis pengukuran planned/actual berbeda.",
  conflicting_observations: "Sumber bertentangan; status tidak dipilih.",
};

const computedConditionLabels: Record<ProgressComputedStatus["condition"], string> = {
  on_track: "Sesuai aturan",
  needs_attention: "Perlu perhatian",
  critical: "Kritis",
  unassessed: "Belum dinilai",
};

export function buildComputedProgress(review: AssuranceReview): {
  statuses: ComputedProgressView[];
  rule: ProgressRagRule | null;
  gated: boolean;
} {
  const gated = !isAnalysisCurrent(review);
  if (gated) return { statuses: [], rule: null, gated };
  const ruleValue = review.analysisMetadata.progress_rag_rule;
  const rule = typeof ruleValue === "object" && ruleValue !== null
    ? ruleValue as ProgressRagRule
    : null;
  const statuses = Array.isArray(review.analysisMetadata.progress_computed_statuses)
    ? (review.analysisMetadata.progress_computed_statuses as ProgressComputedStatus[]).map((status) => ({
        key: `${status.scopeLevel}-${status.scopeLabel ?? "project"}-${status.asOfDate ?? "unknown"}`,
        scopeTitle: status.scopeLevel === "project"
          ? "Total proyek"
          : status.scopeLevel === "wbs" && status.scopeLabel
            ? `WBS ${status.scopeLabel}`
            : "Lingkup tidak diketahui",
        cutoff: status.asOfDate,
        condition: status.condition,
        conditionLabel: computedConditionLabels[status.condition],
        variancePercentPoints: status.variancePercentPoints,
        ruleVersion: status.ruleVersion,
        reason: status.reason ? computedReasons[status.reason] ?? status.reason : null,
      }))
    : [];
  return { statuses, rule, gated };
}

export type RagClaimView = {
  key: string;
  label: string;
  scopeLabel: string;
  cutoff: string | null;
  excerpt: string;
  freshness: string | null;
  freshnessWarning: string | null;
  citation: Citation;
};

export function buildRagClaims(review: AssuranceReview): RagClaimView[] {
  if (!isAnalysisCurrent(review)) return [];
  const claims = Array.isArray(review.analysisMetadata.progress_source_rag_claims)
    ? review.analysisMetadata.progress_source_rag_claims as {
        role?: string;
        document_id: string;
        document_title?: string | null;
        source_version?: { content_hash?: string | null };
        freshness?: string;
        observation_id?: string;
        source_location?: Record<string, string | number> | null;
        rag_label: string;
        scope_level?: string | null;
        scope_label?: string | null;
        period_label?: string | null;
        as_of_date?: string | null;
        excerpt: string;
      }[]
    : [];
  return claims.map((claim, index) => ({
    key: `${claim.document_id}-${claim.observation_id ?? index}`,
    label: claim.rag_label,
    scopeLabel: claim.scope_label
      ? `WBS ${claim.scope_label}`
      : claim.scope_level === "project" ? "Total proyek" : "Lingkup tidak diketahui",
    cutoff: claim.as_of_date ?? claim.period_label ?? null,
    excerpt: claim.excerpt,
    freshness: claim.freshness ?? null,
    freshnessWarning: claim.freshness === "cached_formula_unverified"
      ? "Nilai berasal dari formula dengan cache; kesegarannya belum terverifikasi."
      : null,
    citation: {
      role: claim.role === "baseline" ? "baseline" : "current",
      title: claim.document_title ?? claim.document_id,
      documentId: claim.document_id,
      hash: typeof claim.source_version?.content_hash === "string"
        ? claim.source_version.content_hash
        : null,
      location: formatSourceLocation(claim.source_location),
      excerpt: claim.excerpt,
    },
  }));
}

// ---------------------------------------------------------------------------
// Evidence coverage, freshness and trend
// ---------------------------------------------------------------------------

export type CoverageWarning = {
  key: string;
  domain: string;
  role: "baseline" | "current";
  state: string;
  stateLabel: string;
  processedGroups: number;
  totalGroups: number;
  reason: string | null;
};

const coverageStateLabels: Record<string, string> = {
  unprocessed: "Belum diproses",
  ambiguous_conflicting: "Ambigu/bertentangan",
  absent: "Tidak ditemukan",
};

const domainLabels: Record<string, string> = {
  budget: "Anggaran",
  schedule: "Jadwal",
  progress: "Progres",
  risk: "Risiko",
};

type CoverageRowLike = {
  state?: unknown;
  total_groups?: unknown;
  processed_groups?: unknown;
  reason?: unknown;
};

type CoverageByRole = {
  byRole?: Record<string, Record<string, CoverageRowLike>>;
};

export function buildCoverageWarnings(review: AssuranceReview): CoverageWarning[] {
  // Persisted analysis metadata has no schema validator in this codebase; the
  // rows are read defensively and an unknown state is reported as unprocessed.
  const coverage = review.analysisMetadata.observation_coverage as CoverageByRole | undefined;
  const byRole = coverage?.byRole;
  if (!byRole) return [];
  const warnings: CoverageWarning[] = [];
  for (const role of ["baseline", "current"] as const) {
    const domains = byRole[role];
    if (!domains) continue;
    for (const domain of ["budget", "schedule", "progress", "risk"] as const) {
      const row = domains[domain];
      if (!row) continue;
      const state = typeof row.state === "string" && row.state.trim()
        ? row.state
        : "unprocessed";
      if (state === "processed") continue;
      warnings.push({
        key: `${role}-${domain}`,
        domain: domainLabels[domain] ?? domain,
        role,
        state,
        stateLabel: coverageStateLabels[state] ?? state,
        processedGroups: numberValue(row.processed_groups) ?? 0,
        totalGroups: numberValue(row.total_groups) ?? 0,
        reason: textValue(row.reason),
      });
    }
  }
  return warnings;
}

/**
 * A published analysis is stale when a linked source's stored version no
 * longer matches the document's current version. The stored findings remain
 * visible but are not presented as current.
 */
export function buildFreshnessWarnings(
  review: AssuranceReview,
  documents: readonly AssuranceDocument[],
): string[] {
  const versions = metadataSourceVersions(review);
  if (!versions.length) {
    return review.findings.length > 0
      ? ["Versi sumber tidak tercatat pada hasil ini; kesegaran bukti tidak dapat diverifikasi."]
      : [];
  }
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  const warnings: string[] = [];
  for (const version of versions) {
    if (typeof version.document_id !== "string") continue;
    const document = documentsById.get(version.document_id);
    const analyzedHash = typeof version.content_hash === "string" ? version.content_hash : null;
    if (!document) {
      warnings.push(`Sumber ${version.document_id} tidak lagi tersedia; hasil analisis mungkin tidak berlaku.`);
      continue;
    }
    if (!analyzedHash) {
      warnings.push(`${document.title}: hash sumber tidak tercatat pada hasil ini; kesegaran tidak dapat diverifikasi.`);
      continue;
    }
    if (analyzedHash && document.contentHash && analyzedHash !== document.contentHash) {
      warnings.push(
        `${document.title} berubah setelah analisis (hash sumber berbeda); jalankan analisis ulang.`,
      );
    }
  }
  return warnings;
}

export type OverviewTrendPoint = {
  period: string;
  label: string;
  budgetPlan: number | null;
  budgetCurrent: number | null;
  scheduleDelay: number | null;
  openCriticalRisks: number | null;
  openHighRisks: number | null;
  uncontrolledRisks: number | null;
  /** Cut-off rejected for publication (source changed / status invalidated): the point stays in the series as a null gap. */
  stale: boolean;
};

/** Cut-off sort key: a date cut-off is itself; a month cut-off sorts at month-end. */
function cutoffSortKey(review: AssuranceReview): string {
  if (review.cutoffPrecision === "unknown") return "\uffff";
  const parsed = parsePeriod(review.reportingPeriod);
  if (!parsed) return review.reportingPeriod;
  if (review.cutoffPrecision === "month" || !parsed.date) return monthEnd(parsed.month);
  return parsed.date;
}

/**
 * One point per review, in cut-off order. A stale, unpublished, or
 * value-less cut-off stays in the series as null values so the chart breaks
 * there — it is never dropped and never drawn as a current (green/zero) value.
 */
export function buildTrendPoints(reviews: readonly AssuranceReview[]): OverviewTrendPoint[] {
  return [...reviews]
    .sort((first, second) => cutoffSortKey(first).localeCompare(cutoffSortKey(second)))
    .map((review) => {
      const stale = !isAnalysisCurrent(review) || review.cutoffPrecision === "unknown";
      const budget = stale ? null : findDomain(review, "budget");
      const schedule = stale ? null : findDomain(review, "schedule");
      const risk = stale ? null : findDomain(review, "risk");
      return {
        period: review.reportingPeriod,
        label: review.cutoffPrecision === "unknown" ? "?" : formatShortPeriod(review.reportingPeriod),
        budgetPlan: numberValue(budget?.baselineValue?.amount),
        budgetCurrent: numberValue(budget?.currentValue?.amount),
        scheduleDelay: numberValue(schedule?.variance?.delay_days),
        openCriticalRisks: numberValue(risk?.currentValue?.open_critical_count),
        openHighRisks: numberValue(risk?.currentValue?.open_high_count),
        uncontrolledRisks: numberValue(risk?.currentValue?.high_risks_missing_control),
        stale,
      };
    });
}

// ---------------------------------------------------------------------------
// Published observation evidence (no review required)
// ---------------------------------------------------------------------------

/** Domain contract of the published observations and of per-domain coverage. */
export const publishedDomains = ["budget", "schedule", "progress", "risk"] as const;

export type PublishedDomain = (typeof publishedDomains)[number];

const publishedDomainLabels: Record<string, string> = {
  budget: "Anggaran",
  schedule: "Jadwal",
  progress: "Progres",
  risk: "Risiko",
};

export function publishedDomainLabel(domain: string) {
  return publishedDomainLabels[domain] ?? domain;
}

export type PublishedCoverageState =
  | "processed"
  | "partial"
  | "unprocessed"
  | "ambiguous_conflicting"
  | "absent";

const publishedCoverageStateLabels: Record<PublishedCoverageState, string> = {
  processed: "Cakupan domain diproses",
  partial: "Cakupan sebagian",
  unprocessed: "Belum diproses",
  ambiguous_conflicting: "Ambigu / bertentangan",
  absent: "Tidak ditemukan di sumber",
};

export function publishedCoverageStateLabel(state: PublishedCoverageState) {
  return publishedCoverageStateLabels[state];
}

/**
 * Coverage tone never means "healthy": `processed` only says the domain's
 * evidence groups were processed, every other state is an open gap.
 */
export function publishedCoverageStateTone(state: PublishedCoverageState) {
  if (state === "processed") return "ok" as const;
  if (state === "absent") return "neutral" as const;
  return "warn" as const;
}

export type PublishedObservationDecision = "accepted" | "corrected" | "rejected" | "pending";

export type PublishedObservationView = {
  id: string;
  domain: string;
  domainLabel: string;
  typeLabel: string;
  value: string;
  /** Source-proven period of this claim; null when the source proves none. */
  period: string | null;
  periodLabel: string;
  /** `claim` when the claim states its own period; `unknown` is never filled in. */
  periodOrigin: "claim" | "unknown";
  scope: string | null;
  scopeProvenance: string | null;
  sourceTitle: string;
  sourceVersion: string;
  location: string | null;
  excerpt: string;
  decision: PublishedObservationDecision;
  decisionNote: string | null;
};

export type PublishedCoverageView = {
  domain: string;
  domainLabel: string;
  state: PublishedCoverageState;
  stateLabel: string;
  tone: "ok" | "warn" | "neutral";
  processedGroups: number;
  totalGroups: number;
  reason: string | null;
};

export type PublishedEvidenceDocumentView = {
  documentId: string;
  title: string;
  sourceVersion: string;
  processingStatus: string;
  /** Honest processing state; a needs-review source still keeps its warnings. */
  processingNote: string;
  period: string | null;
  periodLabel: string;
  coverage: PublishedCoverageView[];
  gaps: PublishedCoverageView[];
  observations: PublishedObservationView[];
};

export type PublishedDomainStateView = {
  domain: PublishedDomain;
  domainLabel: string;
  state: PublishedCoverageState;
  stateLabel: string;
  tone: "ok" | "warn" | "neutral";
  observationCount: number;
  sourceCount: number;
  gaps: { sourceTitle: string; reason: string }[];
};

export type PublishedEvidence = {
  documents: PublishedEvidenceDocumentView[];
  domains: PublishedDomainStateView[];
  eligibleObservationCount: number;
  excludedObservationCount: number;
  /**
   * Always true for this read model: the overview shows cited source claims and
   * coverage gaps, never a project-level health verdict.
   */
  claimsOnly: true;
};

const assuranceObservationTypeLabels: Record<string, string> = {
  milestone: "Tanggal milestone",
  progress: "Progres",
  risk_snapshot: "Potret risiko",
  risk_register_statement: "Pernyataan register risiko",
};

const costMeasureLabels: Record<string, string> = {
  approved_baseline: "Baseline disetujui",
  actual_to_date: "Aktual s.d. hari ini",
  committed: "Biaya komitmen",
  eac: "Estimasi penyelesaian (EAC)",
};

const scopeProvenanceKindLabels: Record<string, string> = {
  cited_row_column: "baris yang dikutip",
  declared_subject_key: "label kunci subjek",
  declared_subject: "nilai subjek",
  sheet_title: "judul lembar",
};

const unknownPeriodLabel = "Periode tidak terbukti";
const unknownVersionLabel = "Versi sumber tidak diketahui";

function publishedPeriod(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed || null;
}

function locationLabel(
  pageNumber: number | null,
  sectionLabel: string | null,
  sourceLocation: Record<string, string | number> | null | undefined,
) {
  return [
    formatSourceLocation(sourceLocation ?? null),
    pageNumber ? `hal. ${pageNumber}` : null,
    sectionLabel,
  ].filter((part): part is string => Boolean(part)).join(" · ") || null;
}

function provenanceLabel(
  provenance: { kind: string; sheetName: string; cellReference: string; excerpt: string }[] | null,
) {
  if (!provenance || provenance.length === 0) return null;
  return provenance
    .map((item) => `${scopeProvenanceKindLabels[item.kind] ?? item.kind}: ${item.sheetName}!${item.cellReference} — “${item.excerpt}”`)
    .join(" · ");
}

function decisionFields(decision: AssuranceObservationReview["decisions"][number] | undefined) {
  if (!decision) return { decision: "pending" as const, corrected: null, decisionNote: null };
  return {
    decision: decision.decision,
    corrected: decision.decision === "corrected" ? decision.correctedObservation : null,
    decisionNote: decision.reason
      ? `${decision.reason} (${decision.decidedAt.slice(0, 10)})`
      : null,
  };
}

/**
 * Assurance observation claim as cited text. A missing value stays missing
 * text, never a zero; a corrected decision renders the corrected claim.
 */
function assuranceObservationView(
  row: ObservationReviewRow,
  decision: AssuranceObservationReview["decisions"][number] | undefined,
  document: ObservationReviewDocument,
): PublishedObservationView {
  const { decision: state, corrected, decisionNote } = decisionFields(decision);
  const value = row.observation;
  let valueText: string;
  if (row.observationType === "progress") {
    valueText = [
      typeof value.raw_value === "string" ? `“${value.raw_value}”` : null,
      typeof corrected?.percent === "number"
        ? `→ dikoreksi menjadi ${corrected.percent}%`
        : typeof value.percent === "number"
          ? `→ ${value.percent}%`
          : "→ persentase tidak terbaca",
      typeof value.scope_label === "string" ? `· scope ${value.scope_label}` : null,
    ].filter(Boolean).join(" ");
  } else if (row.observationType === "milestone") {
    valueText = [
      typeof value.label === "string" ? value.label : "Milestone",
      typeof corrected?.date === "string"
        ? `→ dikoreksi menjadi ${corrected.date}`
        : typeof value.date === "string"
          ? `· ${value.date}`
          : "· tanggal tidak terbaca",
      typeof value.scope_label === "string" ? `· scope ${value.scope_label}` : null,
    ].filter(Boolean).join(" ");
  } else if (row.observationType === "risk_snapshot") {
    valueText = [
      typeof value.risk_id === "string" ? value.risk_id : "Risiko tanpa ID",
      typeof value.name === "string" ? `· ${value.name}` : null,
      typeof corrected?.status === "string"
        ? `· status dikoreksi: ${corrected.status}`
        : typeof value.status === "string" ? `· ${value.status}` : null,
      typeof corrected?.rating_label === "string"
        ? `· peringkat dikoreksi: ${corrected.rating_label}`
        : typeof value.rating_label === "string" ? `· ${value.rating_label}` : null,
    ].filter(Boolean).join(" ");
  } else {
    valueText = value.state === "no_open_high_or_critical"
      ? "Sumber menyatakan tidak ada risiko tinggi/kritis terbuka"
      : value.state
        ? "Sumber menyatakan ada risiko yang dilaporkan"
        : "Pernyataan register risiko";
  }

  const claimPeriod =
    publishedPeriod(typeof value.as_of_date === "string" ? value.as_of_date : null) ??
    publishedPeriod(typeof value.period_label === "string" ? value.period_label : null);
  const scopeLabel = typeof value.scope_label === "string" ? value.scope_label : null;
  const provenance = Array.isArray(value.scope_provenance)
    ? (value.scope_provenance as {
        kind: string; sheet_name: string; cell_reference: string; excerpt: string;
      }[]).map((item) => ({
        kind: item.kind,
        sheetName: item.sheet_name,
        cellReference: item.cell_reference,
        excerpt: item.excerpt,
      }))
    : null;

  return {
    ...claimIdentity(row.id, row.domain, document, state, decisionNote),
    typeLabel: assuranceObservationTypeLabels[row.observationType] ?? row.observationType,
    value: valueText,
    ...claimPeriodFields(claimPeriod),
    scope: scopeLabel,
    scopeProvenance: provenanceLabel(provenance),
    location: locationLabel(row.pageNumber, row.sectionLabel, row.sourceLocation),
    excerpt: row.excerpt,
  };
}

/** Cost observation claim; unreadable amounts stay unreadable, not zero. */
function costObservationView(
  row: CostObservationReviewRow,
  decision: AssuranceObservationReview["decisions"][number] | undefined,
  document: ObservationReviewDocument,
): PublishedObservationView {
  const { decision: state, corrected, decisionNote } = decisionFields(decision);
  const amount = typeof corrected?.amount === "number" ? corrected.amount : row.normalizedAmount;
  const currency = typeof corrected?.currency === "string" ? corrected.currency : row.currency;
  const valueText = `“${row.sourceValue}” → ${
    amount !== null && currency ? `${currency} ${amount}` : "jumlah/mata uang tidak terbaca aman"
  }`;
  const claimPeriod = publishedPeriod(row.asOfDate) ?? publishedPeriod(row.periodLabel);

  return {
    ...claimIdentity(row.id, "budget", document, state, decisionNote),
    typeLabel: costMeasureLabels[row.measure] ?? row.measure,
    value: valueText,
    ...claimPeriodFields(claimPeriod),
    scope: row.scopeLabel,
    scopeProvenance: provenanceLabel(row.scopeProvenance),
    location: locationLabel(row.pageNumber, row.sectionLabel, null),
    excerpt: row.excerpt,
  };
}

function claimIdentity(
  id: string,
  domain: string,
  document: ObservationReviewDocument,
  decision: PublishedObservationDecision,
  decisionNote: string | null,
) {
  return {
    id,
    domain,
    domainLabel: publishedDomainLabel(domain),
    sourceTitle: document.title,
    sourceVersion: document.contentHash ? document.contentHash.slice(0, 12) : unknownVersionLabel,
    decision,
    decisionNote,
  };
}

/**
 * A claim period is only ever proven by the claim itself. The document's
 * reporting period is never lent to an observation — an extraction whose
 * as-of date is missing (for example deterministic WBS progress rows) stays an
 * unproven date, shown as a sourced claim, not a cut-off.
 */
function claimPeriodFields(claimPeriod: string | null) {
  return {
    period: claimPeriod,
    periodLabel: claimPeriod ? formatPeriodLabel(claimPeriod) : unknownPeriodLabel,
    periodOrigin: claimPeriod ? ("claim" as const) : ("unknown" as const),
  };
}

function observationSortKey(view: PublishedObservationView) {
  const domainIndex = publishedDomains.indexOf(view.domain as PublishedDomain);
  return [
    domainIndex === -1 ? publishedDomains.length : domainIndex,
    view.typeLabel,
    view.id,
  ].join("|");
}

function processingNote(status: string) {
  if (status === "needs_review") {
    return "Perlu diperiksa — peringatan pemrosesan tetap berlaku; hanya observasi tervalidasi yang ditampilkan.";
  }
  if (status === "completed") return "Selesai diproses.";
  return `Status pemrosesan: ${status}.`;
}

function buildPublishedDocument(
  document: ObservationReviewDocument,
  evidence: AssuranceObservationReview,
  decisions: Map<string, AssuranceObservationReview["decisions"][number]>,
): PublishedEvidenceDocumentView {
  const coverage: PublishedCoverageView[] = document.coverage
    .map((row) => coverageView(row))
    .sort((first, second) =>
      publishedDomains.indexOf(first.domain as PublishedDomain) -
      publishedDomains.indexOf(second.domain as PublishedDomain),
    );
  const observations = [
    ...evidence.observations
      .filter((row) => row.documentId === document.documentId)
      .map((row) => assuranceObservationView(row, decisions.get(row.observationFingerprint), document)),
    ...evidence.costObservations
      .filter((row) => row.documentId === document.documentId)
      .map((row) => costObservationView(row, decisions.get(row.observationFingerprint), document)),
  ].sort((first, second) => observationSortKey(first).localeCompare(observationSortKey(second)));

  return {
    documentId: document.documentId,
    title: document.title,
    sourceVersion: document.contentHash ? document.contentHash.slice(0, 12) : unknownVersionLabel,
    processingStatus: document.processingStatus,
    processingNote: processingNote(document.processingStatus),
    period: publishedPeriod(document.reportingPeriod),
    periodLabel: document.reportingPeriod
      ? formatPeriodLabel(document.reportingPeriod)
      : unknownPeriodLabel,
    coverage,
    gaps: coverage.filter((row) => row.state !== "processed"),
    observations,
  };
}

function coverageView(row: ObservationReviewDocument["coverage"][number]): PublishedCoverageView {
  // An unknown or missing stored state fails closed to `unprocessed`: it never
  // becomes a processed (or healthy) domain.
  const known = publishedCoverageStateLabels[row.state as PublishedCoverageState] !== undefined;
  const state: PublishedCoverageState = known
    ? (row.state as PublishedCoverageState)
    : "unprocessed";
  return {
    domain: row.domain,
    domainLabel: publishedDomainLabel(row.domain),
    state,
    stateLabel: publishedCoverageStateLabel(state),
    tone: publishedCoverageStateTone(state),
    processedGroups: row.processedGroups,
    totalGroups: row.totalGroups,
    reason: row.reason,
  };
}

/**
 * Domain state is the coverage state across the sources of this project, never
 * a project health verdict: any ambiguous source makes the domain ambiguous,
 * and a domain is only `processed` when every source processed it. A domain
 * with a gap never holds back the other domains.
 */
function domainState(states: PublishedCoverageState[]): PublishedCoverageState {
  if (states.length === 0) return "unprocessed";
  if (states.includes("ambiguous_conflicting")) return "ambiguous_conflicting";
  if (states.every((state) => state === "processed")) return "processed";
  if (states.some((state) => state === "processed")) return "partial";
  if (states.every((state) => state === "absent")) return "absent";
  return "unprocessed";
}

function buildPublishedDomainStates(
  sourceDocuments: readonly ObservationReviewDocument[],
  documents: PublishedEvidenceDocumentView[],
): PublishedDomainStateView[] {
  return publishedDomains.map((domain) => {
    const states = sourceDocuments.flatMap((document) =>
      document.coverage
        .filter((row) => row.domain === domain)
        .map((row) => coverageView(row).state),
    );
    const state = domainState(states);
    const observations = documents.flatMap((document) =>
      document.observations.filter((view) => view.decision !== "rejected" && view.domain === domain),
    );
    const gaps = documents.flatMap((document) =>
      document.gaps
        .filter((row) => row.domain === domain)
        .map((row) => ({
          sourceTitle: document.title,
          reason: row.reason ?? row.stateLabel,
        })),
    );
    return {
      domain,
      domainLabel: publishedDomainLabel(domain),
      state,
      stateLabel: publishedCoverageStateLabel(state),
      tone: publishedCoverageStateTone(state),
      observationCount: observations.length,
      sourceCount: new Set(observations.map((view) => view.sourceTitle)).size,
      gaps,
    };
  });
}

/**
 * Published observation evidence of a project, independent of any assurance
 * review. Every claim keeps its source version, period (or unproven period),
 * scope and citation; gaps stay gaps. No comparison between periods or
 * baselines is derived here, and no project-level condition is computed.
 */
export function buildPublishedEvidence(evidence: AssuranceObservationReview): PublishedEvidence {
  const decisions = new Map(
    evidence.decisions.map((decision) => [decision.observationFingerprint, decision]),
  );
  const documents = [...evidence.documents]
    .sort((first, second) =>
      first.title.localeCompare(second.title, "id") ||
      first.documentId.localeCompare(second.documentId),
    )
    .map((document) => buildPublishedDocument(document, evidence, decisions));
  const observations = documents.flatMap((document) => document.observations);

  return {
    documents,
    domains: buildPublishedDomainStates(evidence.documents, documents),
    eligibleObservationCount: observations.filter((view) => view.decision !== "rejected").length,
    excludedObservationCount: observations.filter((view) => view.decision === "rejected").length,
    claimsOnly: true,
  };
}
