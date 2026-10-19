import { parseDocumentBuffer } from "../services/document-parser";
import {
  extractDocumentGroups,
  type DocumentExtractionContext,
  type DocumentExtractionGroupStore,
  type DocumentSuggestions,
  type ExtractedAlert,
  type ExtractedFact,
} from "../services/document-extraction";

export type ProcessDocumentJob = DocumentExtractionContext & {
  jobId: string;
  fileBuffer: ArrayBuffer;
};
const MIN_READY_CLASSIFICATION_CONFIDENCE = 0.7;

export async function processDocumentJob(
  job: ProcessDocumentJob,
  groupStore: DocumentExtractionGroupStore,
) {
  const parseStarted = performance.now();
  const parsed = await parseDocumentBuffer(job.fileName, job.fileBuffer);
  console.info("Document processing stage completed", {
    stage: "parse",
    jobId: job.jobId,
    projectId: job.projectId,
    documentId: job.documentId,
    durationMs: Math.round(performance.now() - parseStarted),
    success: parsed.ok,
  });
  if (!parsed.ok) return failedJob(job, parsed.errorCode, parsed.errorMessage);

  const result = await extractDocumentGroups(
    job,
    parsed.chunks,
    parsed.parserMetadata,
    groupStore,
  );
  if (!result.ok) return failedJob(job, result.errorCode, result.errorMessage);

  const extraction = result.extraction;
  const classificationNeedsReview = suggestionsNeedReview(job, extraction.document_suggestions);
  const needsReview = classificationNeedsReview || extraction.quality_warnings.length > 0;
  const reviewMessages = [
    ...(classificationNeedsReview
      ? [`Review AI artifact type and evidence role; artifact-type confidence must be at least ${MIN_READY_CLASSIFICATION_CONFIDENCE} with no conflicting intake hints. ${extraction.document_suggestions.classification_reason ?? ""}`.trim()]
      : []),
    ...extraction.quality_warnings,
  ];
  return {
    jobId: job.jobId,
    projectId: job.projectId,
    documentId: job.documentId,
    status: "completed" as const,
    processing_status: needsReview ? "needs_review" as const : "completed" as const,
    processing_error: needsReview ? [...new Set(reviewMessages)].join(" ").slice(0, 1000) : null,
    chunks: parsed.chunks.map((chunk) => ({
      chunk_index: chunk.chunkIndex,
      chunk_text: chunk.chunkText,
      page_number: chunk.pageNumber ?? null,
      section_label: chunk.sectionLabel ?? null,
      parser_metadata: {
        ...parsed.parserMetadata,
        sourceLocation: chunk.sourceLocation ?? null,
      },
    })),
    facts: extraction.facts,
    summary: extraction.summary,
    summary_sources: extraction.summary_sources,
    health_snapshots: extraction.health_snapshots,
    alerts: extraction.alerts,
    actions: extraction.actions,
    document_suggestions: extraction.document_suggestions,
    anomalies: buildAnomalies(extraction.alerts, extraction.facts),
    parserMetadata: {
      ...parsed.parserMetadata,
      llmProvider: extraction.provider,
      llmModel: extraction.model,
    },
  };
}

function suggestionsNeedReview(
  job: ProcessDocumentJob,
  suggestions: DocumentSuggestions,
) {
  if (
    !suggestions.suggested_document_type ||
    !suggestions.suggested_evidence_role ||
    suggestions.classification_confidence === null ||
    suggestions.classification_confidence < MIN_READY_CLASSIFICATION_CONFIDENCE
  ) {
    return true;
  }
  return [
    [job.documentTypeHint, suggestions.suggested_document_type],
    [job.documentDateHint, suggestions.suggested_document_date],
    [job.reportingPeriodHint, suggestions.detected_reporting_period],
    [job.workstreamHint, suggestions.suggested_workstream],
  ].some(([hint, suggestion]) =>
    typeof hint === "string" &&
    typeof suggestion === "string" &&
    hint.trim() !== "" &&
    suggestion.trim() !== "" &&
    hint.trim().toLowerCase() !== suggestion.trim().toLowerCase(),
  );
}

function failedJob(job: ProcessDocumentJob, errorCode: string, errorMessage: string) {
  return {
    jobId: job.jobId,
    projectId: job.projectId,
    documentId: job.documentId,
    status: "failed" as const,
    errorCode,
    errorMessage,
  };
}

function buildAnomalies(alerts: ExtractedAlert[], facts: ExtractedFact[]) {
  const alertAnomalies = alerts.map((alert) => ({
    category: normalizeAnomalyCategory(alert.impacted_area),
    missing_field: null,
    severity: alert.severity,
    title: `${alert.impacted_area} signal requires review`,
    affected_item: alert.explanation.slice(0, 240),
    explanation: alert.explanation,
    impact:
      "Evidence indicates a potential assurance concern that should be reviewed against project controls.",
    impact_rating:
      alert.severity === "critical" || alert.severity === "high"
        ? "High"
        : alert.severity === "medium"
          ? "Medium"
          : "Low",
    recommended_action: alert.recommended_action,
    suggested_owners: [],
    evidence_count: alert.evidence_count,
    absence_type: "not_applicable",
    rationale:
      "Generated from document-processing alert output so dashboard and anomaly views use the same evidence signal.",
  }));

  const accountabilityAnomalies = facts
    .filter(shouldFlagMissingOwner)
    .slice(0, 3)
    .map((fact) => ({
      category: "accountability",
      missing_field: "owner",
      severity: "high" as const,
      title: `Missing owner for ${fact.fact_type}`,
      affected_item: fact.extracted_text.slice(0, 240),
      explanation:
        "The extracted risk or issue does not include a confirmed accountable owner.",
      impact:
        "An unowned project signal may delay mitigation, escalation, or management action.",
      impact_rating: "High",
      recommended_action:
        "Assign an owner and confirm the next mitigation or escalation step.",
      suggested_owners: [],
      evidence_count: 1,
      absence_type: "not_found_in_evidence",
      rationale:
        "Generated by document-processing accountability check for extracted risk and issue facts.",
    }));

  return [...alertAnomalies, ...accountabilityAnomalies].slice(0, 8);
}

function shouldFlagMissingOwner(fact: ExtractedFact) {
  if (fact.fact_type !== "risk" && fact.fact_type !== "issue") return false;

  const text = `${fact.extracted_text} ${fact.original_value} ${fact.excerpt}`.toLowerCase();
  if (
    /\b(owner|owned|assigned|responsible|closed|retired|resolved|complete|completed|approved|green|on track|within budget|under budget|low risk|no high risk|no open|passed)\b/.test(text)
  ) {
    return false;
  }
  return /\b(risk|issue|blocker|delay|overdue|critical|high|missing|unassigned|no owner|not assigned|blocked|failed|failure)\b/.test(text);
}

function normalizeAnomalyCategory(area: string) {
  if (/cost|budget|forecast|overrun|variance/i.test(area)) return "cost";
  if (/schedule|delay|late|milestone|timeline/i.test(area)) return "schedule";
  if (/scope|change/i.test(area)) return "scope";
  if (/governance|approval|audit|readiness/i.test(area)) return "governance";
  if (/owner|accountability|action/i.test(area)) return "accountability";
  return "risk";
}
