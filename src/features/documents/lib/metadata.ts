import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentType } from "@/features/documents/lib/constants";

export function parseOptionalDate(value: unknown): string | null {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate) return null;
  const date = new Date(`${candidate}T00:00:00.000Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) &&
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === candidate
    ? candidate
    : null;
}

export function parseDocumentTypeHint(
  value: unknown,
  allowedTypes: readonly string[],
): DocumentType | null {
  return typeof value === "string" &&
    value !== "unknown" &&
    allowedTypes.includes(value)
    ? (value as DocumentType)
    : null;
}
export function parseOptionalReportingPeriod(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (/^\d{4}-\d{2}$/.test(candidate)) {
    const month = Number(candidate.slice(5));
    return month >= 1 && month <= 12 ? `${candidate}-01` : null;
  }
  const date = parseOptionalDate(candidate);
  return date ? `${date.slice(0, 7)}-01` : null;
}

export function parseOptionalWorkstream(value: unknown): string | null {
  return typeof value === "string" ? value.trim() || null : null;
}
export type EvidenceRole = "baseline" | "current" | "supporting";

export type DocumentMetadataValues = {
  document_type: DocumentType;
  document_type_hint: DocumentType | null;
  suggested_document_type: DocumentType | null;
  confirmed_document_type: DocumentType | null;
  document_date: string | null;
  suggested_document_date: string | null;
  confirmed_document_date: string | null;
  detected_reporting_period: string | null;
  reporting_period_hint: string | null;
  confirmed_reporting_period: string | null;
  evidence_role: EvidenceRole | null;
  suggested_evidence_role: EvidenceRole | null;
  confirmed_evidence_role: EvidenceRole | null;
  workstream_hint: string | null;
  workstream: string | null;
  suggested_workstream: string | null;
  confirmed_workstream: string | null;
};

export function resolveDocumentMetadata(metadata: DocumentMetadataValues) {
  return {
    documentType:
      metadata.confirmed_document_type ??
      metadata.suggested_document_type ??
      (metadata.document_type_hint
        ? "unknown"
        : metadata.document_type === "unknown"
          ? "unknown"
          : metadata.document_type),
    evidenceRole:
      metadata.confirmed_evidence_role ??
      metadata.suggested_evidence_role ??
      metadata.evidence_role,
    documentDate:
      metadata.confirmed_document_date ??
      metadata.suggested_document_date ??
      metadata.document_date,
    reportingPeriod:
      metadata.confirmed_reporting_period ??
      metadata.detected_reporting_period ??
      metadata.reporting_period_hint,
    workstream:
      metadata.confirmed_workstream ??
      metadata.suggested_workstream ??
      metadata.workstream ??
      metadata.workstream_hint,
  };
}
export type ConfirmedMetadataChanges = {
  projectId: string;
  documentId: string;
  userId: string;
  values: {
    documentType?: DocumentType;
    evidenceRole?: EvidenceRole;
    documentDate?: string | null;
    reportingPeriod?: string | null;
    workstream?: string | null;
  };
  now?: string;
};

export async function persistConfirmedDocumentMetadata(
  supabase: SupabaseClient,
  input: ConfirmedMetadataChanges,
) {
  const updates: Record<string, unknown> = {
    confirmed_by: input.userId,
    confirmed_at: input.now ?? new Date().toISOString(),
  };
  if (input.values.documentType) {
    updates.document_type = input.values.documentType;
    updates.confirmed_document_type = input.values.documentType;
  }
  if (input.values.evidenceRole) {
    updates.confirmed_evidence_role = input.values.evidenceRole;
  }
  if (input.values.documentDate !== undefined) {
    updates.confirmed_document_date = input.values.documentDate;
  }
  if (input.values.reportingPeriod !== undefined) {
    updates.confirmed_reporting_period = input.values.reportingPeriod;
  }
  if (input.values.workstream !== undefined) {
    updates.confirmed_workstream = input.values.workstream;
  }

  return supabase
    .from("documents")
    .update(updates)
    .eq("id", input.documentId)
    .eq("project_id", input.projectId)
    .select("id")
    .maybeSingle();
}
