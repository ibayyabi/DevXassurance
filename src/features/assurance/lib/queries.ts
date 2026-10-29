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
        "id, title, document_type, document_type_hint, suggested_document_type, confirmed_document_type, document_date, document_date_hint, suggested_document_date, confirmed_document_date, processing_status, processing_error, evidence_role, suggested_evidence_role, confirmed_evidence_role, classification_confidence, classification_reason, detected_reporting_period, reporting_period_hint, confirmed_reporting_period, workstream_hint, suggested_workstream, workstream, confirmed_workstream",
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
