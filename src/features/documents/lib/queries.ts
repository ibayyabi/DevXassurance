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

  if (documentsError) throw new Error(documentsError.message);
  if (factsError) throw new Error(factsError.message);
  if (summaryError) throw new Error(summaryError.message);
  if (submissionError) throw new Error(submissionError.message);

  return {
    membership,
    documents: ((documentsData ?? []) as unknown as DocumentRow[]).map(
      mapDocument,
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

function mapDocument(row: DocumentRow): EvidenceDocument {
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
  };
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
