import { requireProjectMembership } from "@/features/projects/lib/queries";
import type {
  DocumentType,
  FactType,
  ProcessingStatus,
} from "@/features/documents/lib/constants";

export type EvidenceDocument = {
  id: string;
  projectId: string;
  title: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  documentType: DocumentType;
  processingStatus: ProcessingStatus;
  processingError: string | null;
  documentDate: string | null;
  createdAt: string;
  evidenceRole: "baseline" | "current" | "supporting" | null;
  classificationConfidence: number | null;
  classificationReason: string | null;
  detectedReportingPeriod: string | null;
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

export type SummarySource = {
  id: string;
  documentId: string;
  documentTitle: string;
  excerpt: string | null;
  confidence: number | null;
};

type DocumentRow = {
  id: string;
  project_id: string;
  title: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  document_type: DocumentType;
  processing_status: ProcessingStatus;
  processing_error: string | null;
  document_date: string | null;
  created_at: string;
  evidence_role: "baseline" | "current" | "supporting" | null;
  classification_confidence: number | null;
  classification_reason: string | null;
  detected_reporting_period: string | null;
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
  }[];
};

export async function getDocumentIntelligence(projectId: string) {
  const { supabase, membership } = await requireProjectMembership(projectId);

  const [{ data: documentsData, error: documentsError }, { data: factsData, error: factsError }, { data: summaryData, error: summaryError }] =
    await Promise.all([
      supabase
        .from("documents")
        .select(
          "id, project_id, title, file_name, file_size, mime_type, document_type, processing_status, processing_error, document_date, created_at, evidence_role, classification_confidence, classification_reason, detected_reporting_period",
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
          "id, summary_text, confidence, quality_warning, selected_document_ids, document_summary_sources(id, document_id, excerpt, confidence, documents(title))",
        )
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

  if (documentsError) throw new Error(documentsError.message);
  if (factsError) throw new Error(factsError.message);
  if (summaryError) throw new Error(summaryError.message);

  return {
    membership,
    documents: ((documentsData ?? []) as unknown as DocumentRow[]).map(
      mapDocument,
    ),
    facts: ((factsData ?? []) as unknown as FactRow[]).map(mapFact),
    summaries: ((summaryData ?? []) as unknown as SummaryRow[]).map(mapSummary),
    summary: summaryData?.[0]
      ? mapSummary(summaryData[0] as unknown as SummaryRow)
      : null,
  };
}

function mapDocument(row: DocumentRow): EvidenceDocument {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    fileName: row.file_name,
    fileSize: row.file_size,
    mimeType: row.mime_type,
    documentType: row.document_type,
    processingStatus: row.processing_status,
    processingError: row.processing_error,
    documentDate: row.document_date,
    createdAt: row.created_at,
    evidenceRole: row.evidence_role,
    classificationConfidence: row.classification_confidence,
    classificationReason: row.classification_reason,
    detectedReportingPeriod: row.detected_reporting_period,
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
    })),
  };
}
