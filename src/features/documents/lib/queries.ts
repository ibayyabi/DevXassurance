import { requireProjectMembership } from "@/features/projects/lib/queries";
import type {
  DocumentType,
  FactType,
  ProcessingStatus,
} from "@/features/documents/lib/constants";
import { resolveDocumentMetadata } from "@/features/documents/lib/metadata";

export type EvidenceDocument = {
  submissionId: string | null;
  submissionBatchId: string | null;
  id: string;
  projectId: string;
  title: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  documentType: DocumentType;
  documentTypeHint: DocumentType | null;
  suggestedDocumentType: DocumentType | null;
  confirmedDocumentType: DocumentType | null;
  processingStatus: ProcessingStatus;
  processingError: string | null;
  documentDate: string | null;
  documentDateHint: string | null;
  suggestedDocumentDate: string | null;
  createdAt: string;
  evidenceRole: "baseline" | "current" | "supporting" | null;
  suggestedEvidenceRole: "baseline" | "current" | "supporting" | null;
  confirmedEvidenceRole: "baseline" | "current" | "supporting" | null;
  classificationConfidence: number | null;
  classificationReason: string | null;
  detectedReportingPeriod: string | null;
  reportingPeriodHint: string | null;
  confirmedDocumentDate: string | null;
  confirmedReportingPeriod: string | null;
  workstreamHint: string | null;
  suggestedWorkstream: string | null;
  workstream: string | null;
  confirmedWorkstream: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  effectiveDocumentType: DocumentType;
  effectiveEvidenceRole: "baseline" | "current" | "supporting" | null;
  effectiveDocumentDate: string | null;
  effectiveReportingPeriod: string | null;
  effectiveWorkstream: string | null;
  reviewDetails: DocumentReviewDetail[];
};
export type DocumentReviewDetail = {
  key: string;
  title: string;
  entries: string[];
  omittedCount: number;
};
export type ExtractedFact = {
  id: string;
  factType: FactType;
  extractedText: string;
  originalValue: string;
  editedValue: string | null;
  confidence: number;
  confirmationState: "ai_extracted" | "user_confirmed" | "user_edited";
  evidenceLinks: EvidenceLink[];
};

export type EvidenceLink = {
  id: string;
  documentId: string;
  documentTitle: string;
  chunkId: string | null;
  excerpt: string | null;
  confidence: number | null;
};

export type DocumentSummary = {
  id: string;
  summaryText: string;
  confidence: number;
  qualityWarning: string | null;
  selectedDocumentIds: string[];
  sources: SummarySource[];
};
export type UploadSubmission = {
  id: string;
  batchId: string;
  archiveName: string | null;
  archiveStoragePath: string | null;
  archiveManifest: unknown;
  createdAt: string;
};

export type SummarySource = {
  id: string;
  documentId: string;
  documentTitle: string;
  excerpt: string | null;
  confidence: number | null;
  location: string | null;
};

type DocumentRow = {
  submission_id: string | null;
  document_upload_submissions: { batch_id: string } | null;
  id: string;
  project_id: string;
  title: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  document_type: DocumentType;
  document_type_hint: DocumentType | null;
  suggested_document_type: DocumentType | null;
  confirmed_document_type: DocumentType | null;
  processing_status: ProcessingStatus;
  processing_error: string | null;
  document_date: string | null;
  document_date_hint: string | null;
  suggested_document_date: string | null;
  created_at: string;
  evidence_role: "baseline" | "current" | "supporting" | null;
  suggested_evidence_role: "baseline" | "current" | "supporting" | null;
  confirmed_evidence_role: "baseline" | "current" | "supporting" | null;
  classification_confidence: number | null;
  classification_reason: string | null;
  detected_reporting_period: string | null;
  reporting_period_hint: string | null;
  confirmed_document_date: string | null;
  confirmed_reporting_period: string | null;
  workstream_hint: string | null;
  suggested_workstream: string | null;
  workstream: string | null;
  confirmed_workstream: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
};

type FactRow = {
  id: string;
  fact_type: FactType;
  extracted_text: string;
  original_value: string;
  edited_value: string | null;
  confidence: number;
  confirmation_state: "ai_extracted" | "user_confirmed" | "user_edited";
  evidence_links: {
    id: string;
    document_id: string;
    document_chunk_id: string | null;
    excerpt: string | null;
    confidence: number | null;
    documents: { title: string } | null;
  }[];
};

type SummaryRow = {
  id: string;
  summary_text: string;
  confidence: number;
  quality_warning: string | null;
  selected_document_ids: string[];
  document_summary_sources: {
    id: string;
    document_id: string;
    excerpt: string | null;
    confidence: number | null;
    documents: { title: string } | null;
    document_chunks: {
      page_number: number | null;
      section_label: string | null;
      parser_metadata: Record<string, unknown> | null;
    } | null;
  }[];
};

export async function getDocumentIntelligence(projectId: string) {
  const { supabase, membership } = await requireProjectMembership(projectId);

  const [{ data: documentsData, error: documentsError }, { data: factsData, error: factsError }, { data: summaryData, error: summaryError }, { data: submissionData, error: submissionError }] =
    await Promise.all([
      supabase
        .from("documents")
        .select(
          "id, project_id, title, file_name, file_size, mime_type, document_type, document_type_hint, suggested_document_type, confirmed_document_type, processing_status, processing_error, document_date, document_date_hint, suggested_document_date, created_at, submission_id, document_upload_submissions(batch_id), evidence_role, suggested_evidence_role, confirmed_evidence_role, classification_confidence, classification_reason, detected_reporting_period, reporting_period_hint, confirmed_document_date, confirmed_reporting_period, workstream_hint, suggested_workstream, workstream, confirmed_workstream, confirmed_by, confirmed_at",
        )
        .eq("project_id", projectId)
        .order("created_at", { ascending: false }),
      supabase
        .from("extracted_facts")
        .select(
          "id, fact_type, extracted_text, original_value, edited_value, confidence, confirmation_state, evidence_links(id, document_id, document_chunk_id, excerpt, confidence, documents(title))",
        )
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("document_summaries")
        .select(
          "id, summary_text, confidence, quality_warning, selected_document_ids, document_summary_sources(id, document_id, excerpt, confidence, documents(title), document_chunks(page_number, section_label, parser_metadata))",
        )
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("document_upload_submissions")
        .select("id, batch_id, archive_name, archive_storage_path, archive_manifest, created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
    ]);

  const documentIds = (documentsData ?? []).map((row) => row.id);
  let reviewChunkData: Array<{ document_id: string; parser_metadata: Record<string, unknown> | null }> = [];
  if (documentIds.length) {
    const { data, error } = await supabase
      .from("document_chunks")
      .select("document_id, parser_metadata")
      .eq("project_id", projectId)
      .in("document_id", documentIds);
    if (error) throw new Error(error.message);
    reviewChunkData = (data ?? []) as unknown as typeof reviewChunkData;
  }
  const metadataByDocument = new Map<string, unknown[]>();
  for (const row of reviewChunkData) {
    const metadata = metadataByDocument.get(row.document_id) ?? [];
    metadata.push(row.parser_metadata);
    metadataByDocument.set(row.document_id, metadata);
  }

  return {
    membership,
    documents: ((documentsData ?? []) as unknown as DocumentRow[]).map((row) =>
      mapDocument(row, readDocumentReviewDetails(metadataByDocument.get(row.id) ?? [])),
    ),
    facts: ((factsData ?? []) as unknown as FactRow[]).map(mapFact),
    summaries: ((summaryData ?? []) as unknown as SummaryRow[]).map(mapSummary),
    uploadSubmissions: (submissionData ?? []).map((row) => ({
      id: row.id,
      batchId: row.batch_id,
      archiveName: row.archive_name,
      archiveStoragePath: row.archive_storage_path,
      archiveManifest: row.archive_manifest,
      createdAt: row.created_at,
    })),
    summary: summaryData?.[0]
      ? mapSummary(summaryData[0] as unknown as SummaryRow)
      : null,
  };
}

function mapDocument(
  row: DocumentRow,
  reviewDetails: DocumentReviewDetail[] = [],
): EvidenceDocument {
  const effective = resolveDocumentMetadata(row);
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    fileName: row.file_name,
    fileSize: row.file_size,
    mimeType: row.mime_type,
    submissionId: row.submission_id,
    submissionBatchId: row.document_upload_submissions?.batch_id ?? null,
    documentType: row.document_type,
    documentTypeHint: row.document_type_hint,
    suggestedDocumentType: row.suggested_document_type,
    confirmedDocumentType: row.confirmed_document_type,
    processingStatus: row.processing_status,
    processingError: row.processing_error,
    documentDate: row.document_date,
    documentDateHint: row.document_date_hint,
    suggestedDocumentDate: row.suggested_document_date,
    createdAt: row.created_at,
    evidenceRole: row.evidence_role,
    suggestedEvidenceRole: row.suggested_evidence_role,
    confirmedEvidenceRole: row.confirmed_evidence_role,
    classificationConfidence: row.classification_confidence,
    classificationReason: row.classification_reason,
    detectedReportingPeriod: row.detected_reporting_period,
    reportingPeriodHint: row.reporting_period_hint,
    confirmedDocumentDate: row.confirmed_document_date,
    confirmedReportingPeriod: row.confirmed_reporting_period,
    workstreamHint: row.workstream_hint,
    suggestedWorkstream: row.suggested_workstream,
    workstream: row.workstream,
    confirmedWorkstream: row.confirmed_workstream,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at,
    effectiveDocumentType: effective.documentType,
    effectiveEvidenceRole: effective.evidenceRole,
    effectiveDocumentDate: effective.documentDate,
    effectiveReportingPeriod: effective.reportingPeriod,
    effectiveWorkstream: effective.workstream,
    reviewDetails,
  };
}

function readDocumentReviewDetails(metadataRows: unknown[]): DocumentReviewDetail[] {
  const formulaCells = new Map<string, string[]>();
  const interpretations = new Map<string, Record<string, unknown>>();
  for (const value of metadataRows) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const metadata = value as Record<string, unknown>;
    if (Array.isArray(metadata.formulaCells)) {
      for (const value of metadata.formulaCells) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const cell = value as Record<string, unknown>;
        if (typeof cell.formulaCacheStatus !== "string") continue;
        const status = cell.formulaCacheStatus;
        if (!["cached_value", "cached_empty", "missing_cache", "cached_error", "unknown"].includes(status)) continue;
        const sheet = typeof cell.sheetName === "string" ? cell.sheetName : "Unknown sheet";
        const reference = typeof cell.cellReference === "string" ? cell.cellReference : "Unknown cell";
        const formula = typeof cell.formula === "string" ? cell.formula.slice(0, 300) : "";
        const raw = typeof cell.formulaCacheRaw === "string" ? cell.formulaCacheRaw.slice(0, 100) : null;
        const type = typeof cell.formulaCacheType === "string" ? cell.formulaCacheType : null;
        const provenance = cell.cacheProvenance === "stored_cached_result"
          ? "stored cached result; freshness not established"
          : null;
        const entry = `${sheet}!${reference}: ${formula || "(formula text unavailable)"} → ${status}${provenance ? ` (${provenance})` : ""}${type ? `; type ${type}` : ""}${raw !== null ? `; raw cache ${JSON.stringify(raw)}` : ""}`;
        const entries = formulaCells.get(status) ?? [];
        entries.push(entry);
        formulaCells.set(status, entries);
      }
    }
    if (Array.isArray(metadata.sheetInterpretations)) {
      for (const value of metadata.sheetInterpretations) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const interpretation = value as Record<string, unknown>;
        interpretations.set(JSON.stringify(interpretation), interpretation);
      }
    }
  }

  const details: DocumentReviewDetail[] = [];
  const formulaTitles: Record<string, string> = {
    cached_value: "Stored formula cache",
    cached_empty: "Formula cache is empty",
    missing_cache: "Formula result unavailable",
    cached_error: "Formula cache contains spreadsheet error",
    unknown: "Formula cache needs review",
  };
  for (const [status, entries] of formulaCells) {
    details.push({
      key: `formula-${status}`,
      title: `${formulaTitles[status] ?? "Formula cache"} (${entries.length} cell${entries.length === 1 ? "" : "s"})`,
      entries: entries.slice(0, 8),
      omittedCount: Math.max(0, entries.length - 8),
    });
  }
  let interpretationIndex = 0;
  for (const interpretation of interpretations.values()) {
    const sheet = typeof interpretation.sheet_name === "string" ? interpretation.sheet_name : "Unknown sheet";
    const status = typeof interpretation.interpretation_status === "string" ? interpretation.interpretation_status : "unknown";
    const structure = typeof interpretation.structure_type === "string" ? interpretation.structure_type : "unknown";
    const entries: string[] = [];
    const addEntries = (key: string, format: (value: Record<string, unknown>) => string) => {
      const values = Array.isArray(interpretation[key]) ? interpretation[key] as unknown[] : [];
      for (const value of values) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        entries.push(format(value as Record<string, unknown>));
      }
    };
    const formatLocations = (value: unknown) => {
      const locations = Array.isArray(value)
        ? value.filter((location): location is Record<string, unknown> =>
          Boolean(location) && typeof location === "object" && !Array.isArray(location),
        )
        : [];
      return locations.map((location) => {
        const locationSheet = typeof location.sheet_name === "string" ? location.sheet_name : sheet;
        const cell = typeof location.cell_reference === "string"
          ? location.cell_reference
          : typeof location.cell_range_start === "string"
            ? `${location.cell_range_start}-${typeof location.cell_range_end === "string" ? location.cell_range_end : location.cell_range_start}`
            : typeof location.row_start === "number"
              ? `rows ${location.row_start}-${typeof location.row_end === "number" ? location.row_end : location.row_start}`
              : "";
        return cell ? `${locationSheet}!${cell}` : locationSheet;
      }).join(", ");
    };
    addEntries("header_candidates", (value) =>
      `Header candidate: ${String(value.label ?? "")} [${formatLocations(value.source_locations)}]`,
    );
    addEntries("column_roles", (value) =>
      `Column ${String(value.column ?? "?")}: ${String(value.role ?? "")} [${formatLocations(value.source_locations)}]`,
    );
    addEntries("candidate_observations", (value) => {
      const normalized = typeof value.normalized_value === "string" ? ` → ${value.normalized_value}` : "";
      const unit = typeof value.unit === "string" ? ` ${value.unit}` : "";
      const period = typeof value.period === "string" ? ` (${value.period})` : "";
      return `Observation: ${String(value.raw_value ?? "")}${normalized}${unit}${period} [${formatLocations(value.source_locations)}]`;
    });
    if (Array.isArray(interpretation.warnings)) {
      entries.push(...interpretation.warnings.filter((warning): warning is string => typeof warning === "string").slice(0, 8));
    }
    details.push({
      key: `sheet-interpretation-${interpretationIndex++}`,
      title: `Candidate only · ${sheet} (${structure}; ${status})`,
      entries: entries.slice(0, 12),
      omittedCount: Math.max(0, entries.length - 12),
    });
  }
  return details;
}


function mapFact(row: FactRow): ExtractedFact {
  return {
    id: row.id,
    factType: row.fact_type,
    extractedText: row.extracted_text,
    originalValue: row.original_value,
    editedValue: row.edited_value,
    confidence: row.confidence,
    confirmationState: row.confirmation_state,
    evidenceLinks: (row.evidence_links ?? []).map((link) => ({
      id: link.id,
      documentId: link.document_id,
      documentTitle: link.documents?.title ?? "Source document",
      chunkId: link.document_chunk_id,
      excerpt: link.excerpt,
      confidence: link.confidence,
    })),
  };
}

function formatSourceLocation(
  chunk: {
    page_number: number | null;
    section_label: string | null;
    parser_metadata: Record<string, unknown> | null;
  } | null,
): string | null {
  if (!chunk) return null;
  const location = chunk.parser_metadata?.sourceLocation;
  if (location && typeof location === "object" && !Array.isArray(location)) {
    const detail = location as Record<string, unknown>;
    const value = (key: string) => {
      const item = detail[key];
      return typeof item === "string" || typeof item === "number" ? item : null;
    };
    const range = (start: string, end: string, label: string) => {
      const from = value(start);
      const to = value(end);
      return from === null ? null : `${label} ${from}${to !== null && to !== from ? `–${to}` : ""}`;
    };
    const kind = value("kind");
    const parts = [
      kind === "pdf" ? range("pageNumber", "pageNumber", "Page") : null,
      kind === "xlsx" ? value("sheetName") : null,
      kind === "xlsx" || kind === "csv"
        ? range("rowStart", "rowEnd", "Rows")
        : null,
      kind === "xlsx" && value("cellRangeStart")
        ? `${value("cellRangeStart")}${value("cellRangeEnd") ? `–${value("cellRangeEnd")}` : ""}`
        : null,
      kind === "docx" && value("tableNumber")
        ? `Table ${value("tableNumber")}`
        : null,
      kind === "docx" && value("paragraphStart")
        ? range("paragraphStart", "paragraphEnd", "Paragraphs")
        : kind === "docx"
          ? range("rowStart", "rowEnd", "Rows")
          : null,
      kind === "pptx" ? range("slideNumber", "slideNumber", "Slide") : null,
      kind === "pptx" && value("tableNumber")
        ? `Table ${value("tableNumber")}`
        : null,
    ].filter((part): part is string => Boolean(part));
    if (parts.length) return parts.join(", ");
  }
  if (chunk.section_label) return chunk.section_label;
  return chunk.page_number ? `Page ${chunk.page_number}` : null;
}

function mapSummary(row: SummaryRow): DocumentSummary {
  return {
    id: row.id,
    summaryText: row.summary_text,
    confidence: row.confidence,
    qualityWarning: row.quality_warning,
    selectedDocumentIds: row.selected_document_ids,
    sources: (row.document_summary_sources ?? []).map((source) => ({
      id: source.id,
      documentId: source.document_id,
      documentTitle: source.documents?.title ?? "Source document",
      excerpt: source.excerpt,
      confidence: source.confidence,
      location: formatSourceLocation(source.document_chunks),
    })),
  };
}
