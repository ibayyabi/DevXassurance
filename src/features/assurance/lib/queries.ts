import { resolveDocumentMetadata } from "@/features/documents/lib/metadata";
import {
  costBaselineColumns,
  costObservationColumns,
  mapCostBaselineRow,
  mapCostObservationRow,
  mapMilestoneMappingRow,
  mapRiskMappingRow,
  mapWbsMappingRow,
  milestoneMappingColumns,
  riskMappingColumns,
  wbsMappingColumns,
  type CostBaselineRow,
  type CostObservationRow,
  type MilestoneMappingRow,
  type RiskMappingRow,
  type WbsMappingRow,
} from "@/features/assurance/lib/cost-queries";
import type { WbsMapping } from "@/features/assurance/lib/cost-evidence";
import type { MilestoneMapping } from "@/features/assurance/lib/schedule-comparison";
import type { RiskMapping } from "@/features/assurance/lib/risk-comparison";
import type {
  ReviewCondition,
  ReviewDomain,
} from "@/features/assurance/lib/analysis";
import type {
  DocumentType,
  ProcessingStatus,
} from "@/features/documents/lib/constants";
import { requireProjectMembership } from "@/features/projects/lib/queries";

export type AssuranceDocument = {
  id: string;
  title: string;
  documentType: DocumentType;
  documentTypeHint: DocumentType | null;
  suggestedDocumentType: DocumentType | null;
  confirmedDocumentType: DocumentType | null;
  documentDate: string | null;
  suggestedDocumentDate: string | null;
  confirmedDocumentDate: string | null;
  processingStatus: ProcessingStatus;
  processingError: string | null;
  hasCurrentAssuranceCoverage: boolean;
  evidenceRole: "baseline" | "current" | "supporting" | null;
  suggestedEvidenceRole: "baseline" | "current" | "supporting" | null;
  confirmedEvidenceRole: "baseline" | "current" | "supporting" | null;
  classificationConfidence: number | null;
  classificationReason: string | null;
  detectedReportingPeriod: string | null;
  confirmedReportingPeriod: string | null;
  workstreamHint: string | null;
  suggestedWorkstream: string | null;
  workstream: string | null;
  confirmedWorkstream: string | null;
};

export type AssuranceReview = {
  id: string;
  reportingPeriod: string;
  title: string;
  status: string;
  currentStep: "evidence" | "analysis" | "findings" | "actions" | "report";
  analysisError: string | null;
  analysisMetadata: Record<string, unknown>;
  documents: { documentId: string; role: "baseline" | "current" }[];
  findings: AssuranceFinding[];
  actions: AssuranceAction[];
};

export type AssuranceFinding = {
  id: string;
  domain: ReviewDomain;
  condition: ReviewCondition;
  severity: string;
  headline: string;
  explanation: string;
  baselineValue: Record<string, unknown> | null;
  currentValue: Record<string, unknown> | null;
  variance: Record<string, unknown> | null;
  requiredEvidence: string[];
  sourceExcerpts: {
    role: "baseline" | "current";
    excerpt: string;
    documentId?: string;
    documentTitle?: string;
    pageNumber?: number | null;
    sectionLabel?: string | null;
    sourceLocation?: Record<string, string | number> | null;
  }[];
  confidence: number | null;
  confirmationState: string;
  correction: Record<string, unknown> | null;
  correctionReason: string | null;
  correctedAt: string | null;
};

export type AssuranceAction = {
  id: string;
  findingId: string | null;
  title: string;
  ownerName: string | null;
  dueDate: string | null;
  priority: "low" | "medium" | "high";
  status: "open" | "in_progress" | "completed" | "deferred";
};

type ReviewRow = {
  id: string;
  reporting_period: string;
  title: string;
  status: string;
  current_step: AssuranceReview["currentStep"];
  analysis_error: string | null;
  analysis_metadata: Record<string, unknown> | null;
};

type DocumentLinkRow = {
  review_id: string;
  document_id: string;
  evidence_role: "baseline" | "current";
};

type FindingRow = {
  id: string;
  review_id: string;
  domain: ReviewDomain;
  condition: ReviewCondition;
  severity: string;
  headline: string;
  explanation: string;
  baseline_value: Record<string, unknown> | null;
  current_value: Record<string, unknown> | null;
  variance: Record<string, unknown> | null;
  required_evidence: string[] | null;
  source_excerpts: AssuranceFinding["sourceExcerpts"] | null;
  confidence: number | null;
  confirmation_state: string;
  correction: Record<string, unknown> | null;
  correction_reason: string | null;
  corrected_at: string | null;
};

type ActionRow = {
  id: string;
  review_id: string;
  finding_id: string | null;
  title: string;
  owner_name: string | null;
  due_date: string | null;
  priority: AssuranceAction["priority"];
  status: AssuranceAction["status"];
};

export type ObservationReviewRow = {
  id: string;
  documentId: string;
  domain: string;
  observationType: string;
  observation: Record<string, unknown>;
  observationFingerprint: string;
  excerpt: string;
  pageNumber: number | null;
  sectionLabel: string | null;
  sourceLocation: Record<string, string | number> | null;
};

export type CostObservationReviewRow = {
  id: string;
  documentId: string;
  measure: string;
  sourceValue: string;
  normalizedAmount: number | string | null;
  currency: string | null;
  scopeLevel: string;
  scopeLabel: string | null;
  scopeProvenance: {
    kind: string;
    sourceId: string;
    sheetName: string;
    cellReference: string;
    excerpt: string;
  }[] | null;
  excerpt: string;
  pageNumber: number | null;
  sectionLabel: string | null;
  observationFingerprint: string;
};

export type ObservationReviewDecisionRow = {
  targetType: "assurance" | "cost";
  observationFingerprint: string;
  decision: "accepted" | "corrected" | "rejected";
  correctedObservation: Record<string, unknown> | null;
  reason: string;
  decidedBy: string;
  decidedAt: string;
};

export type ObservationCoverageDisplayRow = {
  documentId: string;
  domain: string;
  state: string;
  totalGroups: number;
  processedGroups: number;
  reason: string | null;
};

export type ObservationReviewDocument = {
  documentId: string;
  title: string;
  role: "baseline" | "current";
  processingStatus: string;
  processingError: string | null;
  coverage: ObservationCoverageDisplayRow[];
};

export type AssuranceObservationReview = {
  documents: ObservationReviewDocument[];
  observations: ObservationReviewRow[];
  costObservations: CostObservationReviewRow[];
  decisions: ObservationReviewDecisionRow[];
};

const coverageDomains = ["budget", "schedule", "progress", "risk"] as const;

/**
 * The per-observation review surface for one assurance review: current-version
 * observations of the selected evidence, their existing reviewer decisions, and
 * per-document coverage across all four domains. A domain without a stored
 * coverage row stays `unprocessed` with an explicit reason — it is never
 * absent, zero, or green by omission.
 */
export async function getAssuranceObservationReview(
  projectId: string,
  reviewId: string,
): Promise<AssuranceObservationReview> {
  const { supabase } = await requireProjectMembership(projectId);

  const [linksResult, reviewResult, documentsResult] = await Promise.all([
    supabase
      .from("assurance_review_documents")
      .select("document_id, evidence_role")
      .eq("review_id", reviewId)
      .eq("project_id", projectId),
    supabase
      .from("assurance_reviews")
      .select("id")
      .eq("id", reviewId)
      .eq("project_id", projectId)
      .maybeSingle(),
    // Reviewable evidence is every project document whose processing allows
    // review, independent of review linkage: a PMO with one needs-review file
    // and no approved baseline can still inspect and decide its observations.
    supabase
      .from("documents")
      .select(
        "id, title, processing_status, processing_error, content_hash, assurance_observation_parser_version, assurance_observation_contract_version",
      )
      .eq("project_id", projectId)
      .in("processing_status", ["completed", "needs_review"]),
  ]);
  if (linksResult.error) throw new Error(linksResult.error.message);
  if (reviewResult.error) throw new Error(reviewResult.error.message);
  if (documentsResult.error) throw new Error(documentsResult.error.message);
  if (!reviewResult.data) throw new Error("Assurance review was not found in this project.");

  const links = (linksResult.data ?? []) as {
    document_id: string;
    evidence_role: "baseline" | "current";
  }[];
  type DocumentVersionRow = {
    id: string;
    title: string;
    processing_status: string;
    processing_error: string | null;
    content_hash: string | null;
    assurance_observation_parser_version: string | null;
    assurance_observation_contract_version: string | null;
  };
  const documentRows = (documentsResult.data ?? []) as DocumentVersionRow[];
  const roleByDocument = new Map(links.map((link) => [link.document_id, link.evidence_role]));
  const documentIds = documentRows.map((row) => row.id);
  if (documentIds.length === 0) {
    return { documents: [], observations: [], costObservations: [], decisions: [] };
  }

  const [observationsResult, costResult, coverageResult, decisionsResult] = await Promise.all([
    supabase
      .from("assurance_observations")
      .select(
        "id, document_id, source_content_hash, parser_version, contract_version, domain, observation_type, observation, observation_fingerprint, evidence_chunk_index, excerpt, page_number, section_label, source_location",
      )
      .eq("project_id", projectId)
      .in("document_id", documentIds)
      .order("domain")
      .order("observation_type")
      .order("evidence_chunk_index")
      .order("id"),
    supabase
      .from("cost_observations")
      .select(
        "id, document_id, source_content_hash, parser_version, contract_version, measure, source_value, normalized_amount, currency, scope_level, scope_label, scope_provenance, evidence_chunk_index, excerpt, page_number, section_label, observation_fingerprint",
      )
      .eq("project_id", projectId)
      .in("document_id", documentIds)
      .order("measure")
      .order("evidence_chunk_index")
      .order("id"),
    supabase
      .from("assurance_observation_coverage")
      .select(
        "document_id, source_content_hash, parser_version, contract_version, domain, state, total_groups, processed_groups, reason",
      )
      .eq("project_id", projectId)
      .in("document_id", documentIds),
    supabase
      .from("assurance_observation_decisions")
      .select(
        "target_type, document_id, source_content_hash, parser_version, contract_version, observation_fingerprint, decision, corrected_observation, reason, decided_by, decided_at",
      )
      .eq("project_id", projectId)
      .in("document_id", documentIds)
      .order("decided_at"),
  ]);
  if (observationsResult.error) throw new Error(observationsResult.error.message);
  if (costResult.error) throw new Error(costResult.error.message);
  if (coverageResult.error) throw new Error(coverageResult.error.message);
  if (decisionsResult.error) throw new Error(decisionsResult.error.message);

  const versionKey = (row: {
    content_hash: string | null;
    assurance_observation_parser_version: string | null;
    assurance_observation_contract_version: string | null;
  }) =>
    JSON.stringify([
      row.content_hash,
      row.assurance_observation_parser_version,
      row.assurance_observation_contract_version,
    ]);
  const currentVersion = new Map(documentRows.map((row) => [row.id, versionKey(row)]));

  const documents: ObservationReviewDocument[] = documentRows
    .map((row) => ({
      documentId: row.id,
      title: row.title,
      // Display-only default for not-yet-linked documents; nothing is saved or
      // promoted by viewing it.
      role: roleByDocument.get(row.id) ?? "current",
      processingStatus: row.processing_status,
      processingError: row.processing_error,
      coverage: coverageDomains.map((domain) => {
        const stored = ((coverageResult.data ?? []) as {
          document_id: string;
          source_content_hash: string;
          parser_version: string;
          contract_version: string;
          domain: string;
          state: string;
          total_groups: number;
          processed_groups: number;
          reason: string | null;
        }[]).find((coverage) =>
          coverage.document_id === row.id &&
          coverage.domain === domain &&
          versionKey({
            content_hash: coverage.source_content_hash,
            assurance_observation_parser_version: coverage.parser_version,
            assurance_observation_contract_version: coverage.contract_version,
          }) === versionKey(row));
        return stored
          ? {
              documentId: row.id,
              domain,
              state: stored.state,
              totalGroups: stored.total_groups,
              processedGroups: stored.processed_groups,
              reason: stored.reason,
            }
          : {
              documentId: row.id,
              domain,
              state: "unprocessed",
              totalGroups: 0,
              processedGroups: 0,
              reason: "No validated observation coverage exists for this source version; re-run extraction.",
            };
      }),
    }));

  const observations: ObservationReviewRow[] = ((observationsResult.data ?? []) as {
    id: string;
    document_id: string;
    source_content_hash: string;
    parser_version: string;
    contract_version: string;
    domain: string;
    observation_type: string;
    observation: Record<string, unknown>;
    observation_fingerprint: string;
    excerpt: string;
    page_number: number | null;
    section_label: string | null;
    source_location: Record<string, unknown> | null;
  }[])
    .filter((row) =>
      currentVersion.get(row.document_id) ===
        JSON.stringify([row.source_content_hash, row.parser_version, row.contract_version]))
    .map((row) => ({
      id: row.id,
      documentId: row.document_id,
      domain: row.domain,
      observationType: row.observation_type,
      observation: row.observation,
      observationFingerprint: row.observation_fingerprint,
      excerpt: row.excerpt,
      pageNumber: row.page_number,
      sectionLabel: row.section_label,
      sourceLocation: sourceLocationRecord(row.source_location),
    }));

  const costObservations: CostObservationReviewRow[] = ((costResult.data ?? []) as {
    id: string;
    document_id: string;
    source_content_hash: string;
    parser_version: string;
    contract_version: string;
    measure: string;
    source_value: string;
    normalized_amount: number | string | null;
    currency: string | null;
    scope_level: string;
    scope_label: string | null;
    scope_provenance: {
      kind: string;
      source_id: string;
      sheet_name: string;
      cell_reference: string;
      excerpt: string;
    }[] | null;
    excerpt: string;
    page_number: number | null;
    section_label: string | null;
    observation_fingerprint: string;
  }[])
    .filter((row) =>
      currentVersion.get(row.document_id) ===
        JSON.stringify([row.source_content_hash, row.parser_version, row.contract_version]))
    .map((row) => ({
      id: row.id,
      documentId: row.document_id,
      measure: row.measure,
      sourceValue: row.source_value,
      normalizedAmount: row.normalized_amount,
      currency: row.currency,
      scopeLevel: row.scope_level,
      scopeLabel: row.scope_label,
      scopeProvenance: row.scope_provenance?.map((item) => ({
        kind: item.kind,
        sourceId: item.source_id,
        sheetName: item.sheet_name,
        cellReference: item.cell_reference,
        excerpt: item.excerpt,
      })) ?? null,
      excerpt: row.excerpt,
      pageNumber: row.page_number,
      sectionLabel: row.section_label,
      observationFingerprint: row.observation_fingerprint,
    }));

  const observationFingerprints = new Set(observations.map((row) => row.observationFingerprint));
  const costFingerprints = new Set(costObservations.map((row) => row.observationFingerprint));
  const decisions: ObservationReviewDecisionRow[] = ((decisionsResult.data ?? []) as {
    target_type: "assurance" | "cost";
    document_id: string;
    source_content_hash: string;
    parser_version: string;
    contract_version: string;
    observation_fingerprint: string;
    decision: ObservationReviewDecisionRow["decision"];
    corrected_observation: Record<string, unknown> | null;
    reason: string;
    decided_by: string;
    decided_at: string;
  }[])
    .filter((row) =>
      currentVersion.get(row.document_id) ===
        JSON.stringify([row.source_content_hash, row.parser_version, row.contract_version]) &&
      (row.target_type === "assurance"
        ? observationFingerprints.has(row.observation_fingerprint)
        : costFingerprints.has(row.observation_fingerprint)))
    .map((row) => ({
      targetType: row.target_type,
      observationFingerprint: row.observation_fingerprint,
      decision: row.decision,
      correctedObservation: row.corrected_observation,
      reason: row.reason,
      decidedBy: row.decided_by,
      decidedAt: row.decided_at,
    }));

  return { documents, observations, costObservations, decisions };
}

function sourceLocationRecord(value: Record<string, unknown> | null): Record<string, string | number> | null {
  if (!value) return null;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string | number] =>
      typeof entry[1] === "string" || typeof entry[1] === "number",
  );
  return entries.length ? Object.fromEntries(entries) : null;
}

export async function getAssuranceWorkspace(projectId: string) {
  const { supabase, membership } = await requireProjectMembership(projectId);
  const [
    costResult,
    baselineResult,
    wbsLabelResult,
    mappingResult,
    milestoneMappingResult,
    riskIdentityResult,
    riskScaleResult,
  ] = await Promise.all([
    supabase
      .from("cost_observations")
      .select(costObservationColumns)
      .eq("project_id", projectId)
      .eq("scope_level", "project")
      .order("as_of_date", { ascending: false, nullsFirst: false }),
    supabase
      .from("cost_baselines")
      .select(costBaselineColumns)
      .eq("project_id", projectId)
      .order("effective_date", { ascending: false }),
    // Distinct WBS source labels captured in evidence, so a reviewer can map
    // differing codes before comparison.
    supabase
      .from("cost_observations")
      .select("scope_label")
      .eq("project_id", projectId)
      .eq("scope_level", "wbs")
      .not("scope_label", "is", null),
    supabase
      .from("wbs_mappings")
      .select(wbsMappingColumns)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
    supabase
      .from("milestone_mappings")
      .select(milestoneMappingColumns)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
    supabase
      .from("risk_identity_mappings")
      .select(riskMappingColumns)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
    supabase
      .from("risk_scale_mappings")
      .select(riskMappingColumns)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
  ]);
  if (costResult.error) throw new Error(costResult.error.message);
  if (baselineResult.error) throw new Error(baselineResult.error.message);
  if (wbsLabelResult.error) throw new Error(wbsLabelResult.error.message);
  if (mappingResult.error) throw new Error(mappingResult.error.message);
  if (milestoneMappingResult.error) throw new Error(milestoneMappingResult.error.message);
  if (riskIdentityResult.error) throw new Error(riskIdentityResult.error.message);
  if (riskScaleResult.error) throw new Error(riskScaleResult.error.message);

  const costObservations = ((costResult.data ?? []) as CostObservationRow[]).map(
    mapCostObservationRow,
  );
  const costBaselines = ((baselineResult.data ?? []) as CostBaselineRow[]).map(
    mapCostBaselineRow,
  );
  const wbsScopeLabels = [
    ...new Set(
      ((wbsLabelResult.data ?? []) as { scope_label: string | null }[])
        .map((row) => row.scope_label)
        .filter((label): label is string => Boolean(label)),
    ),
  ].sort((first, second) => first.localeCompare(second));
  const wbsMappings: WbsMapping[] = ((mappingResult.data ?? []) as WbsMappingRow[]).map(
    mapWbsMappingRow,
  );
  const milestoneMappings: MilestoneMapping[] = (
    (milestoneMappingResult.data ?? []) as MilestoneMappingRow[]
  ).map(mapMilestoneMappingRow);
  const riskIdentityMappings: RiskMapping[] = (
    (riskIdentityResult.data ?? []) as RiskMappingRow[]
  ).map(mapRiskMappingRow);
  const riskScaleMappings: RiskMapping[] = (
    (riskScaleResult.data ?? []) as RiskMappingRow[]
  ).map(mapRiskMappingRow);
  const [documentsResult, reviewsResult] = await Promise.all([
    supabase
      .from("documents")
      .select(
        "id, title, document_type, document_type_hint, suggested_document_type, confirmed_document_type, document_date, document_date_hint, suggested_document_date, confirmed_document_date, processing_status, processing_error, content_hash, assurance_observation_parser_version, assurance_observation_contract_version, evidence_role, suggested_evidence_role, confirmed_evidence_role, classification_confidence, classification_reason, detected_reporting_period, reporting_period_hint, confirmed_reporting_period, workstream_hint, suggested_workstream, workstream, confirmed_workstream",
      )
      .eq("project_id", projectId)
      .order("document_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("assurance_reviews")
      .select(
        "id, reporting_period, title, status, current_step, analysis_error, analysis_metadata",
      )
      .eq("project_id", projectId)
      .order("reporting_period", { ascending: false }),
  ]);

  if (documentsResult.error) throw new Error(documentsResult.error.message);
  if (reviewsResult.error) throw new Error(reviewsResult.error.message);
  const needsReviewDocuments = (documentsResult.data ?? []).filter(
    (row) => row.processing_status === "needs_review",
  );
  let currentCoverageDocumentIds = new Set<string>();
  if (needsReviewDocuments.length) {
    const { data: coverageRows, error: coverageError } = await supabase
      .from("assurance_observation_coverage")
      .select("document_id, source_content_hash, parser_version, contract_version")
      .eq("project_id", projectId)
      .in("document_id", needsReviewDocuments.map((document) => document.id));
    if (coverageError) throw new Error(coverageError.message);
    const versions = new Map(needsReviewDocuments.map((document) => [
      document.id,
      JSON.stringify([
        document.content_hash,
        document.assurance_observation_parser_version,
        document.assurance_observation_contract_version,
      ]),
    ]));
    currentCoverageDocumentIds = new Set((coverageRows ?? []).flatMap((coverage) =>
      versions.get(coverage.document_id) === JSON.stringify([
        coverage.source_content_hash,
        coverage.parser_version,
        coverage.contract_version,
      ]) ? [coverage.document_id] : [],
    ));
  }

  const documents: AssuranceDocument[] = (documentsResult.data ?? []).map(
    (row) => {
      const effective = resolveDocumentMetadata(row);
      return {
        id: row.id,
        title: row.title,
        documentType: effective.documentType,
        documentTypeHint: row.document_type_hint,
        suggestedDocumentType: row.suggested_document_type,
        confirmedDocumentType: row.confirmed_document_type,
        documentDate: effective.documentDate,
        suggestedDocumentDate: row.suggested_document_date,
        confirmedDocumentDate: row.confirmed_document_date,
        processingStatus: row.processing_status,
        processingError: row.processing_error,
        hasCurrentAssuranceCoverage: currentCoverageDocumentIds.has(row.id),
        evidenceRole: effective.evidenceRole,
        suggestedEvidenceRole: row.suggested_evidence_role,
        confirmedEvidenceRole: row.confirmed_evidence_role,
        classificationConfidence: row.classification_confidence,
        classificationReason: row.classification_reason,
        detectedReportingPeriod: effective.reportingPeriod,
        confirmedReportingPeriod: row.confirmed_reporting_period,
        workstreamHint: row.workstream_hint,
        suggestedWorkstream: row.suggested_workstream,
        workstream: effective.workstream,
        confirmedWorkstream: row.confirmed_workstream,
      };
    },
  );

  const reviewRows = (reviewsResult.data ?? []) as ReviewRow[];
  if (reviewRows.length === 0) {
    return {
      membership,
      documents,
      review: null,
      reviews: [] as AssuranceReview[],
      costObservations,
      costBaselines,
      wbsScopeLabels,
      wbsMappings,
      milestoneMappings,
      riskIdentityMappings,
      riskScaleMappings,
    };
  }

  const reviewIds = reviewRows.map((row) => row.id);
  const [linksResult, findingsResult, actionsResult] = await Promise.all([
    supabase
      .from("assurance_review_documents")
      .select("review_id, document_id, evidence_role")
      .in("review_id", reviewIds),
    supabase
      .from("assurance_findings")
      .select(
        "id, review_id, domain, condition, severity, headline, explanation, baseline_value, current_value, variance, required_evidence, source_excerpts, confidence, confirmation_state, correction, correction_reason, corrected_at",
      )
      .in("review_id", reviewIds)
      .order("domain"),
    supabase
      .from("assurance_actions")
      .select(
        "id, review_id, finding_id, title, owner_name, due_date, priority, status",
      )
      .in("review_id", reviewIds)
      .order("priority", { ascending: false }),
  ]);

  if (linksResult.error) throw new Error(linksResult.error.message);
  if (findingsResult.error) throw new Error(findingsResult.error.message);
  if (actionsResult.error) throw new Error(actionsResult.error.message);

  const links = (linksResult.data ?? []) as DocumentLinkRow[];
  const findings = (findingsResult.data ?? []) as FindingRow[];
  const actions = (actionsResult.data ?? []) as ActionRow[];
  const reviews = reviewRows.map((row): AssuranceReview => ({
    id: row.id,
    reportingPeriod: row.reporting_period,
    title: row.title,
    status: row.status,
    currentStep: row.current_step,
    analysisError: row.analysis_error,
    analysisMetadata: row.analysis_metadata ?? {},
    documents: links
      .filter((link) => link.review_id === row.id)
      .map((link) => ({
        documentId: link.document_id,
        role: link.evidence_role,
      })),
    findings: findings
      .filter((finding) => finding.review_id === row.id)
      .map((finding) => ({
        id: finding.id,
        domain: finding.domain,
        condition: finding.condition,
        severity: finding.severity,
        headline: finding.headline,
        explanation: finding.explanation,
        baselineValue: finding.baseline_value,
        currentValue: finding.current_value,
        variance: finding.variance,
        requiredEvidence: finding.required_evidence ?? [],
        sourceExcerpts: finding.source_excerpts ?? [],
        confidence: finding.confidence,
        confirmationState: finding.confirmation_state,
        correction: finding.correction,
        correctionReason: finding.correction_reason,
        correctedAt: finding.corrected_at,
      })),
    actions: actions
      .filter((action) => action.review_id === row.id)
      .map((action) => ({
        id: action.id,
        findingId: action.finding_id,
        title: action.title,
        ownerName: action.owner_name,
        dueDate: action.due_date,
        priority: action.priority,
        status: action.status,
      })),
  }));

  return {
    membership,
    documents,
    review: reviews[0],
    reviews,
    costObservations,
    costBaselines,
    wbsScopeLabels,
    wbsMappings,
    milestoneMappings,
    riskIdentityMappings,
    riskScaleMappings,
  };
}
