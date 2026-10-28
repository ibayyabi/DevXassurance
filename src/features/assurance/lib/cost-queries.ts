import type {
  CostBaseline,
  CostMeasure,
  CostObservation,
  CostScopeLevel,
} from "@/features/assurance/lib/cost-evidence";

export const costObservationColumns =
  "id, document_id, measure, source_value, normalized_amount, currency, scope_level, scope_label, period_label, as_of_date, status_label, evidence_chunk_index, excerpt, page_number, section_label, source_location, documents(title)";

export const costBaselineColumns =
  "id, scope_level, scope_label, amount, currency, effective_date, state, observation_id, source_document_id, approval_note, approved_at";

export type CostObservationRow = {
  id: string;
  document_id: string;
  measure: CostMeasure;
  source_value: string;
  normalized_amount: number | string | null;
  currency: string | null;
  scope_level: CostScopeLevel;
  scope_label: string | null;
  period_label: string | null;
  as_of_date: string | null;
  status_label: string | null;
  evidence_chunk_index: number;
  excerpt: string;
  page_number: number | null;
  section_label: string | null;
  source_location: Record<string, unknown> | null;
  documents?: { title: string } | { title: string }[] | null;
};

export type CostBaselineRow = {
  id: string;
  scope_level: CostScopeLevel;
  scope_label: string | null;
  amount: number | string;
  currency: string;
  effective_date: string;
  state: "accepted" | "superseded";
  observation_id: string | null;
  source_document_id: string | null;
  approval_note: string | null;
  approved_at: string;
};

export function mapCostObservationRow(row: CostObservationRow): CostObservation {
  const related = Array.isArray(row.documents) ? row.documents[0] : row.documents;
  return {
    id: row.id,
    documentId: row.document_id,
    documentTitle: related?.title ?? null,
    measure: row.measure,
    sourceValue: row.source_value,
    normalizedAmount: numeric(row.normalized_amount),
    currency: row.currency,
    scopeLevel: row.scope_level,
    scopeLabel: row.scope_label,
    periodLabel: row.period_label,
    asOfDate: row.as_of_date,
    statusLabel: row.status_label,
    evidenceChunkIndex: row.evidence_chunk_index,
    excerpt: row.excerpt,
    pageNumber: row.page_number,
    sectionLabel: row.section_label,
    sourceLocation: scalarRecord(row.source_location),
  };
}

export function mapCostBaselineRow(row: CostBaselineRow): CostBaseline {
  return {
    id: row.id,
    scopeLevel: row.scope_level,
    scopeLabel: row.scope_label,
    amount: numeric(row.amount) ?? 0,
    currency: row.currency,
    effectiveDate: row.effective_date,
    state: row.state,
    observationId: row.observation_id,
    sourceDocumentId: row.source_document_id,
    approvalNote: row.approval_note,
    approvedAt: row.approved_at,
  };
}

// Postgres numeric arrives as a string through PostgREST.
function numeric(value: number | string | null) {
  if (value === null || value === "") return null;
  const parsed = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(parsed) ? parsed : null;
}

function scalarRecord(value: Record<string, unknown> | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string | number] =>
      typeof entry[1] === "string" || typeof entry[1] === "number",
  );
  return entries.length ? Object.fromEntries(entries) : null;
}
