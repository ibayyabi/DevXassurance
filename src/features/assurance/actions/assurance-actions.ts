"use server";

import { revalidatePath } from "next/cache";

import {
  dateDifferenceDays,
  evaluateAssuranceReview,
  type AssuranceEvidenceReference,
  type MilestoneObservation,
  type ProgressObservation,
  type ReviewExtraction,
  type RiskSnapshot,
} from "@/features/assurance/lib/analysis";
import {
  evaluateProjectBudget,
  selectAcceptedCostBaseline,
  selectReportedEac,
} from "@/features/assurance/lib/cost-evidence";
import {
  costBaselineColumns,
  costObservationColumns,
  mapCostBaselineRow,
  mapCostObservationRow,
  mapMilestoneMappingRow,
  mapRiskMappingRow,
  mapWbsMappingRow,
  milestoneMappingColumns,
  wbsMappingColumns,
  type CostBaselineRow,
  type CostObservationRow,
  type MilestoneMappingRow,
  type WbsMappingRow,
} from "@/features/assurance/lib/cost-queries";
import {
  buildWbsBudgetFindings,
  buildWbsScopeCandidates,
} from "@/features/assurance/lib/wbs-comparison";
import {
  buildMilestoneComparisons,
  buildProgressComparison,
  buildProgressComputedStatuses,
  buildScheduleFinding,
  milestoneSourceLabels,
} from "@/features/assurance/lib/schedule-comparison";
import {
  buildRiskComparison,
  riskRatingClass,
  riskSourceIds,
  riskSourceScales,
  riskStatusIsOpen,
  type RiskComparison,
} from "@/features/assurance/lib/risk-comparison";
import {
  formatReportingPeriod,
  reportingPeriodEnd,
} from "@/features/assurance/lib/review-period";
import { requireProjectMembership } from "@/features/projects/lib/queries";
import { canApproveAssuranceBaseline, canManageProject } from "@/features/projects/lib/roles";
type ObservationCoverageDomain = "budget" | "schedule" | "progress" | "risk";
type ObservationCoverageState = "processed" | "unprocessed" | "ambiguous_conflicting" | "absent";
type AssuranceCoverageRow = {
  domain: ObservationCoverageDomain;
  state: ObservationCoverageState;
  total_groups: number;
  processed_groups: number;
  reason: string | null;
  partial?: boolean;
};
type ObservationCoverageByRole = Record<
  "baseline" | "current",
  Record<ObservationCoverageDomain, AssuranceCoverageRow>
>;
type ObservationDecision = {
  id: string;
  target_type: "assurance" | "cost";
  document_id: string;
  observation_fingerprint: string;
  decision: "accepted" | "corrected" | "rejected";
  corrected_observation: Record<string, unknown> | null;
  reason: string;
  decided_by: string;
  decided_at: string;
  observation_ids: string[];
  cost_observation_ids?: string[];
};
type AssuranceObservationRow = {
  id: string;
  domain: "schedule" | "progress" | "risk";
  observation_type: "milestone" | "progress" | "risk_snapshot" | "risk_register_statement";
  observation: Record<string, unknown>;
  evidence_chunk_index: number;
  excerpt: string;
  page_number: number | null;
  section_label: string | null;
  source_location: Record<string, unknown> | null;
};
type AssuranceSource = {
  document_id: string;
  role: "baseline" | "current";
  title: string | null;
  source_version: {
    content_hash: string | null;
    parser_version: string | null;
    contract_version: string | null;
  };
  cost_observations: CostObservationRow[];
  assurance_observations: AssuranceObservationRow[];
  assurance_observation_coverage: AssuranceCoverageRow[];
};
type PreviousRiskReview = {
  id: string;
  reporting_period: string;
  cutoff_precision: "month" | "date";
  status: string;
};
type PreviousRiskSelection = {
  review: PreviousRiskReview | null;
  sources: AssuranceSource[];
  decisions: ObservationDecision[];
  snapshots: RiskSnapshot[];
  coverageComplete: boolean;
  cutoffComplete: boolean;
  gapReason: string | null;
};
type ClaimRiskMapping = {
  id: string;
  project_id: string;
  source_label: string;
  canonical_label: string;
  state: "proposed" | "accepted" | "rejected";
  proposed_by_model: boolean;
  note: string | null;
  created_by: string | null;
  accepted_by: string | null;
  accepted_at: string | null;
};
type ClaimRiskMappings = {
  risk_identity_mappings: ClaimRiskMapping[];
  risk_scale_mappings: ClaimRiskMapping[];
};
type PriorRiskSnapshotClaim = {
  current_cutoff: string | null;
  review: PreviousRiskReview | null;
  sources: AssuranceSource[];
  observation_decisions: ObservationDecision[];
  gap_reason: string | null;
};
type ProgressRagRuleSnapshot = {
  id: string;
  rule_version: string;
  thresholds: Record<string, unknown>;
  note: string | null;
  approved_by: string;
  approved_at: string;
} | null;
type AssuranceAnalysisClaim = {
  attempt_id: string;
  sources: AssuranceSource[];
  observation_decisions?: ObservationDecision[];
  reference_fingerprint?: string;
  reference_versions?: Record<string, unknown>;
  prior_risk_snapshot?: PriorRiskSnapshotClaim;
  progress_rag_rule: ProgressRagRuleSnapshot;
  risk_mappings?: ClaimRiskMappings;
};

export async function createAssuranceReview(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const reportingDate = String(formData.get("reportingDate") ?? "");

  if (!projectId || !/^\d{4}-\d{2}-\d{2}$/.test(reportingDate)) {
    throw new Error("Choose a valid reporting date.");
  }

  const { supabase, user, membership } =
    await requireProjectMembership(projectId);
  assertCanManage(membership.role);

  const reportingPeriod = reportingDate;
  const title = `${formatReportingPeriod(reportingPeriod)} Assurance Review`;
  const { data: existing } = await supabase
    .from("assurance_reviews")
    .select("id")
    .eq("project_id", projectId)
    .eq("reporting_period", reportingPeriod)
    .maybeSingle();

  if (!existing) {
    const { error } = await supabase.from("assurance_reviews").insert({
      project_id: projectId,
      reporting_period: reportingPeriod,
      cutoff_precision: "date",
      title,
      created_by: user.id,
    });

    if (error) throw new Error(error.message);
  }

  revalidateAssurance(projectId);
}

export async function saveReviewEvidence(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const reviewId = String(formData.get("reviewId") ?? "");
  const baselineIds = uniqueStrings(formData.getAll("baselineDocumentIds"));
  const currentIds = uniqueStrings(formData.getAll("currentDocumentIds"));

  if (!projectId || !reviewId) throw new Error("Assurance review is required.");
  if (baselineIds.length === 0 || currentIds.length === 0) {
    throw new Error(
      "Select at least one approved baseline document and one current document.",
    );
  }

  const duplicateId = baselineIds.find((id) => currentIds.includes(id));
  if (duplicateId) {
    throw new Error("One document cannot be both baseline and current evidence.");
  }

  const { supabase, membership } =
    await requireProjectMembership(projectId);
  assertCanManage(membership.role);

  const { error } = await supabase.rpc("save_assurance_evidence", {
    p_project_id: projectId, p_review_id: reviewId,
    p_baseline_ids: baselineIds, p_current_ids: currentIds,
  });
  if (error) throw new Error(error.message);

  revalidateAssurance(projectId);
}

export async function runAssuranceAnalysis(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const reviewId = String(formData.get("reviewId") ?? "");
  if (!projectId || !reviewId) throw new Error("Assurance review is required.");

  const { supabase, membership } = await requireProjectMembership(projectId);
  assertCanManage(membership.role);
  const { data, error } = await supabase.rpc("claim_assurance_analysis", {
    p_project_id: projectId, p_review_id: reviewId,
  });
  if (error) throw new Error(error.message);
  const claim = data as AssuranceAnalysisClaim | null;
  if (!claim?.attempt_id || !Array.isArray(claim.sources)) {
    throw new Error("Analysis claim did not return its versioned source snapshot.");
  }
  const { attempt_id: attemptId, sources } = claim;

  try {
    const priorSnapshot = claim.prior_risk_snapshot;
    const reportingPeriod = priorSnapshot?.current_cutoff;
    if (!reportingPeriod || !validRiskCutoff(reportingPeriod)) {
      await setAnalysisFailure(supabase, projectId, reviewId, attemptId,
        "The review cut-off is not provable. Set a valid reporting cut-off and run analysis again.");
      return;
    }

    if (!sources.length) {
      await setAnalysisFailure(supabase, projectId, reviewId, attemptId,
        "Selected evidence has no versioned source observations.");
      return;
    }

    const decisions = (claim.observation_decisions ?? []) as ObservationDecision[];
    const coverage = summarizeObservationCoverage(sources);
    const reviewData = buildReviewExtraction(sources, decisions);
    const previousRisk = buildPreviousRiskSnapshot(priorSnapshot);
    const currentRiskCoverageComplete = coverage.byRole.current.risk.state === "processed";
    const currentCostObservations = mapSelectedCostObservations(sources, "current");
    const baselineCostObservations = mapSelectedCostObservations(sources, "baseline");
    const costDecisions = applyCostObservationDecisions(
      decisions, sources, currentCostObservations, baselineCostObservations,
    );
    const budgetFinding = await buildProjectBudgetFinding(
      supabase, projectId, reportingPeriod, costDecisions.current,
    );
    const wbs = await buildWbsComparison(
      supabase, projectId, reportingPeriod, costDecisions.baseline, costDecisions.current,
    );
    const schedule = await buildScheduleComparison(
      supabase, projectId, reportingPeriod, reviewData.extraction, claim.progress_rag_rule ?? null,
    );
    const risk = buildRiskSnapshotComparison(
      claim.risk_mappings, reviewData.extraction, previousRisk, currentRiskCoverageComplete,
    );
    reviewData.extraction.risk = buildRiskAssessment(
      reviewData.extraction, risk.comparison, reviewData.riskStatements,
      coverage.byRole, reportingPeriod,
    );
    const findings = applyObservationDecisions(
      applyCoverageGaps(
        evaluateAssuranceReview(reviewData.extraction, budgetFinding, schedule.finding),
        coverage.byRole,
      ),
      decisions,
      sources,
    );
    const { data: published, error: publicationError } = await supabase.rpc(
      "finish_assurance_analysis_with_decision_fingerprint",
      {
        p_project_id: projectId,
        p_review_id: reviewId,
        p_attempt_id: attemptId,
        p_findings: findings,
        p_actions: buildActionRows(findings),
        p_metadata: {
          source_versions: sources.map((source) => ({
            document_id: source.document_id,
            role: source.role,
            ...source.source_version,
          })),
          assurance_observation_contract_versions: [...new Set(
            sources.map((source) => source.source_version.contract_version).filter(Boolean),
          )],
          observation_coverage: coverage,
          observation_review_summary: summarizeObservationDecisions(sources, decisions),
          comparison_engine: {
            budget: "pmo_cost_contract_v1",
            schedule: "pmo_schedule_observations_v1",
            progress: "pmo_progress_cut_off_v1",
            risk: "pmo_risk_observations_v2",
          },
          thresholds: {
            budget: "pmo_budget_variance_v1",
            schedule: "pmo_schedule_variance_v1",
            risk: "phase_3_usable_mvp_defaults",
          },
          budget_evidence_source: "versioned_cost_observations_and_accepted_baseline",
          risk_comparison_provenance: {
            contract: "pmo_risk_comparison_v2",
            referenceFingerprint: claim.reference_fingerprint ?? null,
            referenceVersions: claim.reference_versions ?? null,
            previousReviewId: previousRisk.review?.id ?? null,
            previousReportingPeriod: previousRisk.review
              ? reportingPeriodEnd(
                  previousRisk.review.reporting_period,
                  previousRisk.review.cutoff_precision,
                )
              : null,
            previousSourceVersions: previousRisk.sources.map((source) => ({
              document_id: source.document_id,
              role: "current",
              ...source.source_version,
            })),
            previousSnapshotAvailable: previousRisk.snapshots.length > 0,
            previousCoverageComplete: previousRisk.coverageComplete,
            previousCutoffComplete: previousRisk.cutoffComplete,
            previousDecisionSummary: summarizeObservationDecisions(
              previousRisk.sources, previousRisk.decisions,
            ),
            currentCoverageComplete: currentRiskCoverageComplete,
            previousGapReason: previousRisk.gapReason,
          },
        },
        p_result_metadata: {
          wbs_budget_findings: wbs.findings,
          wbs_scope_candidates: wbs.scopeCandidates,
          schedule_milestone_comparisons: schedule.comparisons,
          schedule_milestone_labels: schedule.milestoneLabels,
          progress_observations: schedule.progress,
          progress_source_observations: reviewData.progressSourceObservations,
          progress_source_rag_claims: reviewData.progressSourceRagClaims,
          progress_rag_rule: schedule.progressRagRule,
          progress_computed_statuses: schedule.progressComputedStatuses,
          risk_item_findings: risk.comparison.items,
          risk_unidentified_items: risk.comparison.unidentified,
          risk_source_ids: risk.sourceIds,
          risk_source_scales: risk.sourceScales,
        },
      },
    );
    if (publicationError) throw new Error(publicationError.message);
    if (!published) {
      throw new Error("Analysis was not published: evidence or attempt ownership changed. Run analysis again.");
    }
  } catch (error) {
    await setAnalysisFailure(supabase, projectId, reviewId, attemptId,
      error instanceof Error ? error.message : "Assurance analysis failed.");
    throw error;
  }

  revalidateAssurance(projectId);
}

export async function confirmAssuranceFinding(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const reviewId = String(formData.get("reviewId") ?? "");
  const findingId = String(formData.get("findingId") ?? "");
  if (!projectId || !reviewId || !findingId) return;

  const { supabase, membership } = await requireProjectMembership(projectId);
  assertCanManage(membership.role);
  const { error } = await supabase
    .from("assurance_findings")
    .update({
      confirmation_state: "user_confirmed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", findingId)
    .eq("review_id", reviewId)
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);
  revalidateAssurance(projectId);
}

/**
 * Activates a source-backed cost observation as the comparison baseline for a
 * scope and effective date. The document's own "approved" wording never
 * reaches this point by itself; a reviewer does.
 */
export async function approveCostBaseline(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const observationId = String(formData.get("observationId") ?? "");
  const effectiveDate = String(formData.get("effectiveDate") ?? "").trim();
  const note = String(formData.get("approvalNote") ?? "").trim();

  if (!projectId || !observationId) throw new Error("Choose a baseline candidate to accept.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    throw new Error("Enter the baseline effective date as YYYY-MM-DD.");
  }

  const { supabase, membership } = await requireProjectMembership(projectId);
  assertCanApproveBaseline(membership.role);

  const { error } = await supabase.rpc("accept_cost_baseline", {
    p_project_id: projectId,
    p_observation_id: observationId,
    p_effective_date: effectiveDate,
    p_note: note || null,
  });
  if (error) throw new Error(error.message);

  revalidateAssurance(projectId);
}

/**
 * Accepts a reviewer-approved WBS mapping: a statement that a source work-
 * package label is the same work package as a canonical label, scoped to the
 * project. Only after acceptance does the comparison group the two labels
 * together (ADR 0004). The model never writes this; a reviewer does.
 */
export async function acceptWbsMapping(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const sourceLabel = String(formData.get("sourceLabel") ?? "").trim();
  const canonicalLabel = String(formData.get("canonicalLabel") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  if (!projectId || !sourceLabel || !canonicalLabel) {
    throw new Error("Provide the source label and the canonical label it maps to.");
  }
  if (sourceLabel === canonicalLabel) {
    throw new Error("A label mapped to itself is not a mapping; identical labels already match.");
  }

  const { supabase, membership } = await requireProjectMembership(projectId);
  assertCanApproveBaseline(membership.role);

  const { data: mappingId, error } = await supabase.rpc("replace_assurance_mapping", {
    p_project_id: projectId,
    p_mapping_kind: "wbs",
    p_source_label: sourceLabel,
    p_canonical_label: canonicalLabel,
    p_note: note || null,
  });
  if (error) throw new Error(error.message);
  if (!mappingId) throw new Error("The mapping could not be saved.");

  revalidateAssurance(projectId);
}

/**
 * Removes a WBS mapping. The comparison stops grouping its labels together
 * immediately; nothing about the underlying evidence changes.
 */
export async function removeWbsMapping(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const mappingId = String(formData.get("mappingId") ?? "");
  if (!projectId || !mappingId) throw new Error("Choose a mapping to remove.");

  const { supabase, membership } = await requireProjectMembership(projectId);
  assertCanApproveBaseline(membership.role);

  const { data: removed, error } = await supabase.rpc("remove_assurance_mapping", {
    p_project_id: projectId,
    p_mapping_kind: "wbs",
    p_mapping_id: mappingId,
  });
  if (error) throw new Error(error.message);
  if (removed === false) return;

  revalidateAssurance(projectId);
}

/**
 * Accepts a reviewer-stated mapping that two differing milestone labels are the
 * same milestone, reusable within the project. Only after acceptance does the
 * schedule comparison group them; identical labels already match directly.
 */
export async function acceptMilestoneMapping(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const sourceLabel = String(formData.get("sourceLabel") ?? "").trim();
  const canonicalLabel = String(formData.get("canonicalLabel") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  if (!projectId || !sourceLabel || !canonicalLabel) {
    throw new Error("Provide the source milestone label and the canonical label it maps to.");
  }
  if (sourceLabel === canonicalLabel) {
    throw new Error("A label mapped to itself is not a mapping; identical labels already match.");
  }

  const { supabase, membership } = await requireProjectMembership(projectId);
  assertCanApproveBaseline(membership.role);

  const { data: mappingId, error } = await supabase.rpc("replace_assurance_mapping", {
    p_project_id: projectId,
    p_mapping_kind: "milestone",
    p_source_label: sourceLabel,
    p_canonical_label: canonicalLabel,
    p_note: note || null,
  });
  if (error) throw new Error(error.message);
  if (!mappingId) throw new Error("The mapping could not be saved.");

  revalidateAssurance(projectId);
}

/**
 * Removes a milestone mapping. The comparison stops grouping its labels together
 * immediately; nothing about the underlying evidence changes.
 */
export async function removeMilestoneMapping(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const mappingId = String(formData.get("mappingId") ?? "");
  if (!projectId || !mappingId) throw new Error("Choose a mapping to remove.");

  const { supabase, membership } = await requireProjectMembership(projectId);
  assertCanApproveBaseline(membership.role);

  const { data: removed, error } = await supabase.rpc("remove_assurance_mapping", {
    p_project_id: projectId,
    p_mapping_kind: "milestone",
    p_mapping_id: mappingId,
  });
  if (error) throw new Error(error.message);
  if (removed === false) return;

  revalidateAssurance(projectId);
}

async function acceptRiskMapping(
  table: "risk_identity_mappings" | "risk_scale_mappings",
  formData: FormData,
): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const sourceLabel = String(formData.get("sourceLabel") ?? "").trim();
  const canonicalLabel = String(formData.get("canonicalLabel") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  if (!projectId || !sourceLabel || !canonicalLabel) {
    throw new Error("Provide the source label and the canonical label it maps to.");
  }
  if (sourceLabel === canonicalLabel) {
    throw new Error("A label mapped to itself is not a mapping; identical labels already match.");
  }

  const { supabase, membership } = await requireProjectMembership(projectId);
  assertCanApproveBaseline(membership.role);

  // One accepted canonical target per source label: the RPC supersedes any
  // prior mapping and inserts the replacement in one transaction, invalidating
  // affected analyses on the same commit.
  const mappingKind = table === "risk_identity_mappings" ? "risk_identity" : "risk_scale";
  const { data: mappingId, error } = await supabase.rpc("replace_assurance_mapping", {
    p_project_id: projectId,
    p_mapping_kind: mappingKind,
    p_source_label: sourceLabel,
    p_canonical_label: canonicalLabel,
    p_note: note || null,
  });
  if (error) throw new Error(error.message);
  if (!mappingId) throw new Error("The mapping could not be saved.");

  revalidateAssurance(projectId);
}

async function removeRiskMapping(
  table: "risk_identity_mappings" | "risk_scale_mappings",
  formData: FormData,
): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const mappingId = String(formData.get("mappingId") ?? "");
  if (!projectId || !mappingId) throw new Error("Choose a mapping to remove.");

  const { supabase, membership } = await requireProjectMembership(projectId);
  assertCanApproveBaseline(membership.role);

  // Supersede rather than delete: the mapping history and its attribution stay,
  // and analyses built on it are invalidated on the same commit.
  const mappingKind = table === "risk_identity_mappings" ? "risk_identity" : "risk_scale";
  const { data: removed, error } = await supabase.rpc("remove_assurance_mapping", {
    p_project_id: projectId,
    p_mapping_kind: mappingKind,
    p_mapping_id: mappingId,
  });
  if (error) throw new Error(error.message);
  if (removed === false) return;

  revalidateAssurance(projectId);
}

/**
 * Accepts a reviewer-stated mapping that two differing risk IDs are the same
 * risk, reusable within the project. Only after acceptance does the comparison
 * group them; identical IDs already match directly. A name alone never maps.
 */
export async function acceptRiskIdentityMapping(formData: FormData): Promise<void> {
  await acceptRiskMapping("risk_identity_mappings", formData);
}

export async function removeRiskIdentityMapping(formData: FormData): Promise<void> {
  await removeRiskMapping("risk_identity_mappings", formData);
}

/**
 * Accepts a reviewer-stated mapping that a source rating scale aligns to a
 * canonical scale, reusable within the project. Only after acceptance are
 * ratings on those scales compared; identical scales already match.
 */
export async function acceptRiskScaleMapping(formData: FormData): Promise<void> {
  await acceptRiskMapping("risk_scale_mappings", formData);
}

export async function removeRiskScaleMapping(formData: FormData): Promise<void> {
  await removeRiskMapping("risk_scale_mappings", formData);
}

/**
 * Records a reviewer correction to the value used in assessment. The original
 * extraction, its source wording, and its location stay untouched; the
 * correction carries its own attribution and reason.
 */
export async function correctBudgetFinding(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const reviewId = String(formData.get("reviewId") ?? "");
  const findingId = String(formData.get("findingId") ?? "");
  const reason = String(formData.get("correctionReason") ?? "").trim();
  const correctedEac = String(formData.get("correctedEacAmount") ?? "").trim();
  const correctedCurrency = String(formData.get("correctedCurrency") ?? "").trim().toUpperCase();

  if (!projectId || !reviewId || !findingId) throw new Error("Assurance finding is required.");
  if (!reason) throw new Error("Record why the assessed value is corrected.");
  if (correctedCurrency && !/^[A-Z]{3}$/.test(correctedCurrency)) {
    throw new Error("Enter the corrected currency as a three-letter code.");
  }

  const { supabase, user, membership } = await requireProjectMembership(projectId);
  assertCanApproveBaseline(membership.role);

  const { data: finding, error: findingError } = await supabase
    .from("assurance_findings")
    .select("id, domain, condition, severity, headline, explanation, baseline_value, current_value")
    .eq("id", findingId)
    .eq("review_id", reviewId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (findingError) throw new Error(findingError.message);
  if (!finding) throw new Error("That finding is not part of this review.");
  if (finding.domain !== "budget") {
    throw new Error("Only the Budget finding supports a corrected cost value here.");
  }

  const baselineValue = finding.baseline_value as Record<string, unknown> | null;
  const currentValue = finding.current_value as Record<string, unknown> | null;
  const baselineAmount = Number(baselineValue?.amount);
  const baselineCurrency = String(baselineValue?.currency ?? "");
  if (!Number.isFinite(baselineAmount) || !/^[A-Z]{3}$/.test(baselineCurrency)) {
    throw new Error(
      "Accept a cost baseline before correcting the assessed value; a correction cannot create a baseline.",
    );
  }

  const originalEac = Number(currentValue?.amount);
  const amount = correctedEac ? Number(correctedEac.replace(/[,\s]/g, "")) : originalEac;
  if (!Number.isFinite(amount)) {
    throw new Error("Enter the corrected estimate at completion as a number.");
  }
  const currency = correctedCurrency || String(currentValue?.currency ?? baselineCurrency);

  const corrected = evaluateProjectBudget({
    baseline: {
      id: String(baselineValue?.baseline_id ?? finding.id),
      scopeLevel: "project",
      scopeLabel: null,
      amount: baselineAmount,
      currency: baselineCurrency,
      effectiveDate: String(baselineValue?.effective_date ?? ""),
      state: "accepted",
      observationId: null,
      sourceDocumentId: null,
      approvalNote: null,
      approvedAt: String(baselineValue?.accepted_at ?? ""),
    },
    baselineObservation: null,
    eac: { state: "reported", amount, currency, observations: [] },
    separateMeasures: [],
  });

  const { error: updateError } = await supabase
    .from("assurance_findings")
    .update({
      condition: corrected.condition,
      severity: corrected.severity,
      headline: corrected.headline,
      explanation: corrected.explanation,
      confirmation_state: "user_edited",
      correction: {
        corrected_measure: "eac",
        corrected_amount: amount,
        corrected_currency: currency,
        variance: corrected.variance,
        superseded_assessment: {
          condition: finding.condition,
          severity: finding.severity,
          headline: finding.headline,
          explanation: finding.explanation,
        },
      },
      correction_reason: reason.slice(0, 1000),
      corrected_by: user.id,
      corrected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", findingId)
    .eq("review_id", reviewId)
    .eq("project_id", projectId);
  if (updateError) throw new Error(updateError.message);

  revalidateAssurance(projectId);
}

/**
 * Records one reviewer decision (accept / correct / reject) on a single
 * supported observation — assurance observations (progress percent, milestone
 * date, risk status/rating) or cost observations (amount, currency, WBS scope
 * label). The fingerprint of the displayed observation is re-checked
 * server-side so a stale page cannot write a decision over changed evidence.
 * The stored observation is never modified; the decision carries its own
 * reason and attribution and invalidates analyses built over it.
 */
export async function reviewAssuranceObservation(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const targetType = String(formData.get("targetType") ?? "assurance");
  const observationId = String(formData.get("observationId") ?? "");
  const fingerprint = String(formData.get("observationFingerprint") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const correction: Record<string, unknown> = {};
  if (targetType === "assurance") {
    const correctedPercent = String(formData.get("correctedPercent") ?? "").trim();
    const correctedDate = String(formData.get("correctedDate") ?? "").trim();
    const correctedStatus = String(formData.get("correctedStatus") ?? "").trim();
    const correctedRatingLabel = String(formData.get("correctedRatingLabel") ?? "").trim();
    const correctedRatingValue = String(formData.get("correctedRatingValue") ?? "").trim();
    if (correctedPercent) {
      const percent = Number(correctedPercent.replace(",", "."));
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        throw new Error("Enter the corrected progress percentage as a number between 0 and 100.");
      }
      correction.percent = percent;
    }
    if (correctedDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(correctedDate)) {
        throw new Error("Enter the corrected milestone date as YYYY-MM-DD.");
      }
      correction.date = correctedDate;
    }
    if (correctedStatus) correction.status = correctedStatus;
    if (correctedRatingLabel) correction.rating_label = correctedRatingLabel;
    if (correctedRatingValue) {
      const rating = Number(correctedRatingValue.replace(",", "."));
      if (!Number.isFinite(rating)) throw new Error("Enter the corrected rating value as a number.");
      correction.rating_value = rating;
    }
  } else {
    const correctedAmount = String(formData.get("correctedAmount") ?? "").trim();
    const correctedCurrency = String(formData.get("correctedCurrency") ?? "").trim().toUpperCase();
    const correctedScopeLabel = String(formData.get("correctedScopeLabel") ?? "").trim();
    if (correctedAmount) {
      // Accept "1250000", "1,250,000", and Indonesian "1.250.000": dots act as
      // thousand separators only when no comma decimal remains.
      const normalized = correctedAmount.replace(/\s/g, "");
      const amount = Number(
        /^-?\d{1,3}(\.\d{3})+$/.test(normalized)
          ? normalized.replace(/\./g, "")
          : normalized.replace(/,/g, ""),
      );
      if (!Number.isFinite(amount)) throw new Error("Enter the corrected amount as a number.");
      correction.normalized_amount = amount;
    }
    if (correctedCurrency) {
      if (!/^[A-Z]{3}$/.test(correctedCurrency)) {
        throw new Error("Enter the corrected currency as a three-letter code.");
      }
      correction.currency = correctedCurrency;
    }
    if (correctedScopeLabel) correction.scope_label = correctedScopeLabel;
  }

  if (!projectId || !observationId) throw new Error("Choose an observation to review.");
  if (!["accepted", "corrected", "rejected"].includes(decision)) {
    throw new Error("Choose accept, correct, or reject for this observation.");
  }
  if (!reason) throw new Error("Record why this observation is accepted, corrected, or rejected.");
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) {
    throw new Error("The observation version is missing; refresh the page and review again.");
  }
  if (decision === "corrected" && Object.keys(correction).length === 0) {
    throw new Error("Enter the corrected value for this observation.");
  }

  const { supabase, membership } = await requireProjectMembership(projectId);
  assertCanApproveBaseline(membership.role);

  const { error } = await supabase.rpc("save_assurance_observation_decision", {
    p_project_id: projectId,
    p_target_type: targetType,
    p_observation_id: observationId,
    p_observation_fingerprint: fingerprint,
    p_decision: decision,
    p_reason: reason.slice(0, 1000),
    p_corrected: decision === "corrected" ? correction : null,
  });
  if (error) throw new Error(error.message);

  revalidateAssurance(projectId);
}

export async function updateAssuranceAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const reviewId = String(formData.get("reviewId") ?? "");
  const actionId = String(formData.get("actionId") ?? "");
  const ownerName = String(formData.get("ownerName") ?? "").trim();
  const dueDate = String(formData.get("dueDate") ?? "").trim();
  const status = String(formData.get("status") ?? "open");
  if (!projectId || !reviewId || !actionId) return;
  if (!["open", "in_progress", "completed", "deferred"].includes(status)) {
    throw new Error("Invalid action status.");
  }

  const { supabase, membership } = await requireProjectMembership(projectId);
  assertCanManage(membership.role);
  const { error } = await supabase
    .from("assurance_actions")
    .update({
      owner_name: ownerName || null,
      due_date: /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : null,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", actionId)
    .eq("review_id", reviewId)
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);
  revalidateAssurance(projectId);
}



/**
 * The project-total Budget finding for this review: the accepted baseline
 * active for the period, compared only with an explicitly reported EAC from
 * the selected current evidence.
 */
async function buildProjectBudgetFinding(
  supabase: Awaited<ReturnType<typeof requireProjectMembership>>["supabase"],
  projectId: string,
  asOf: string,
  currentObservationRows: CostObservationRow[],
) {
  const { data, error } = await supabase
    .from("cost_baselines")
    .select(costBaselineColumns)
    .eq("project_id", projectId)
    .in("state", ["accepted", "superseded"]);
  if (error) throw new Error(error.message);

  const baselines = ((data ?? []) as CostBaselineRow[]).map(mapCostBaselineRow);
  const observations = currentObservationRows.map(mapCostObservationRow);
  const baseline = selectAcceptedCostBaseline(baselines, { scopeLevel: "project", asOf });

  let baselineObservation = null;
  if (baseline?.observationId) {
    const { data: observation, error: observationError } = await supabase
      .from("cost_observations")
      .select(costObservationColumns)
      .eq("project_id", projectId)
      .eq("id", baseline.observationId)
      .maybeSingle();
    if (observationError) throw new Error(observationError.message);
    baselineObservation = observation
      ? mapCostObservationRow(observation as CostObservationRow)
      : null;
  }

  return evaluateProjectBudget({
    baseline,
    baselineObservation,
    eac: selectReportedEac(observations, { scopeLevel: "project" }),
    separateMeasures: observations.filter((observation) =>
      observation.scopeLevel === "project" &&
      (observation.measure === "actual_to_date" || observation.measure === "committed"),
    ),
  });
}

/**
 * WBS-level cost comparisons and scope candidates for this review. These sit
 * beside the single project-total Budget finding and never replace it: a WBS
 * evidence gap is reported as its own gap and leaves the project total intact.
 * Differing work-package labels are grouped only through reviewer-accepted
 * mappings; identical labels match directly.
 */
async function buildWbsComparison(
  supabase: Awaited<ReturnType<typeof requireProjectMembership>>["supabase"],
  projectId: string,
  asOf: string,
  baselineObservationRows: CostObservationRow[],
  currentObservationRows: CostObservationRow[],
) {
  const [baselineResult, mappingResult] = await Promise.all([
    supabase
      .from("cost_baselines")
      .select(costBaselineColumns)
      .eq("project_id", projectId)
      .eq("scope_level", "wbs")
      .in("state", ["accepted", "superseded"]),
    supabase
      .from("wbs_mappings")
      .select(wbsMappingColumns)
      .eq("project_id", projectId)
      .eq("state", "accepted"),
  ]);
  if (baselineResult.error) throw new Error(baselineResult.error.message);
  if (mappingResult.error) throw new Error(mappingResult.error.message);

  const baselineObservations = baselineObservationRows.map(mapCostObservationRow);
  const currentObservations = currentObservationRows.map(mapCostObservationRow);
  const baselines = ((baselineResult.data ?? []) as CostBaselineRow[]).map(mapCostBaselineRow);
  const mappings = ((mappingResult.data ?? []) as WbsMappingRow[]).map(mapWbsMappingRow);
  const findings = buildWbsBudgetFindings({
    observations: currentObservations,
    baselineObservations: [...baselineObservations, ...currentObservations],
    baselines,
    mappings,
    asOf,
  });
  const scopeCandidates = buildWbsScopeCandidates({
    baselineObservations,
    currentObservations,
    mappings,
  });
  return { findings, scopeCandidates };
}

/**
 * Per-milestone schedule comparisons, the single Schedule finding, and reported
 * progress for this review. Milestones are grouped only through reviewer-accepted
 * mappings; identical labels match directly. Progress values are preserved as
 * reported — never aggregated into a project total and never turned into dates —
 * and compared across periods only within a comparable scope. WBS progress scope
 * is canonicalized through the existing accepted WBS mappings.
 */
async function buildScheduleComparison(
  supabase: Awaited<ReturnType<typeof requireProjectMembership>>["supabase"],
  projectId: string,
  cutoffDate: string,
  extraction: ReviewExtraction,
  ragRule: ProgressRagRuleSnapshot,
) {
  const [milestoneMappingResult, wbsMappingResult] = await Promise.all([
    supabase
      .from("milestone_mappings")
      .select(milestoneMappingColumns)
      .eq("project_id", projectId)
      .eq("state", "accepted"),
    supabase
      .from("wbs_mappings")
      .select(wbsMappingColumns)
      .eq("project_id", projectId)
      .eq("state", "accepted"),
  ]);
  if (milestoneMappingResult.error) throw new Error(milestoneMappingResult.error.message);
  if (wbsMappingResult.error) throw new Error(wbsMappingResult.error.message);

  const milestoneMappings = ((milestoneMappingResult.data ?? []) as MilestoneMappingRow[]).map(
    mapMilestoneMappingRow,
  );
  const wbsMappings = ((wbsMappingResult.data ?? []) as WbsMappingRow[]).map(mapWbsMappingRow);

  const comparisons = buildMilestoneComparisons({
    baselineMilestones: extraction.schedule.baselineMilestones,
    currentMilestones: extraction.schedule.currentMilestones,
    mappings: milestoneMappings,
    wbsMappings,
  });
  const finding = buildScheduleFinding(comparisons, extraction.schedule.confidence);
  const progress = buildProgressComparison({
    observations: extraction.progress.observations,
    wbsMappings,
    cutoffDate,
  });
  const progressComputedStatuses = buildProgressComputedStatuses({
    observations: extraction.progress.observations,
    wbsMappings,
    cutoffDate,
    rule: ragRule,
  });
  const milestoneLabels = milestoneSourceLabels({
    baselineMilestones: extraction.schedule.baselineMilestones,
    currentMilestones: extraction.schedule.currentMilestones,
  });
  return {
    finding,
    comparisons,
    progress,
    progressComputedStatuses,
    milestoneLabels,
    progressRagRule: ragRule,
  };
}

/**
 * Item-level risk comparison for this review. Risks are matched only by exact
 * source ID or a reviewer-accepted identity mapping, and ratings compare only
 * within the same scale or an accepted scale mapping. The applied mappings
 * come from the atomic claim — all accepted project-scoped mappings, exactly
 * the set its reference fingerprint captured — never a post-claim table read,
 * so a change after claim cannot silently alter the comparison. No project
 * Risk score or composite is produced — the Risk domain condition stays
 * separate.
 */
function buildRiskSnapshotComparison(
  claimMappings: ClaimRiskMappings | undefined,
  extraction: ReviewExtraction,
  previous: PreviousRiskSelection,
  currentCoverageComplete: boolean,
) {
  const identityMappings = (claimMappings?.risk_identity_mappings ?? [])
    .filter((row) => row.state === "accepted")
    .map((row) => mapRiskMappingRow(row));
  const scaleMappings = (claimMappings?.risk_scale_mappings ?? [])
    .filter((row) => row.state === "accepted")
    .map((row) => mapRiskMappingRow(row));
  const currentSnapshots = extraction.riskItems.currentSnapshots;
  const comparison = buildRiskComparison({
    previousSnapshots: previous.snapshots,
    currentSnapshots,
    identityMappings,
    scaleMappings,
    previousCoverageComplete: previous.coverageComplete,
    previousCutoffComplete: previous.cutoffComplete,
    currentCoverageComplete,
  });
  const riskSnapshots = {
    previousSnapshots: previous.snapshots,
    currentSnapshots,
  };
  return {
    comparison,
    sourceIds: riskSourceIds(riskSnapshots),
    sourceScales: riskSourceScales(riskSnapshots),
  };
}

function validRiskCutoff(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function buildPreviousRiskSnapshot(snapshot?: PriorRiskSnapshotClaim): PreviousRiskSelection {
  const noSnapshot: PreviousRiskSelection = {
    review: null, sources: [], decisions: [], snapshots: [],
    coverageComplete: false, cutoffComplete: false,
    gapReason: "current_review_cutoff_not_provable",
  };
  if (!snapshot || !snapshot.current_cutoff || !validRiskCutoff(snapshot.current_cutoff)) return noSnapshot;

  const review = snapshot.review;
  const sources = snapshot.sources ?? [];
  const decisions = snapshot.observation_decisions ?? [];
  if (!review || !sources.length) {
    return {
      review, sources, decisions, snapshots: [],
      coverageComplete: false, cutoffComplete: false,
      gapReason: snapshot.gap_reason ?? "no_prior_current_review",
    };
  }
  const coverageComplete = sources.every((source) =>
    source.assurance_observation_coverage.length > 0 &&
    source.assurance_observation_coverage.every((row) => row.state === "processed"));
  const snapshots = buildReviewExtraction(sources, decisions).extraction.riskItems.currentSnapshots;
  const sourceDocumentsWithRisk = new Set(snapshots
    .map((risk) => risk.sourceRef?.documentId)
    .filter((documentId): documentId is string => Boolean(documentId)));
  const statedCutoffs = snapshots.map((risk) =>
    risk.asOfDate?.trim() || risk.periodLabel?.trim() || "");
  const cutoffComplete = coverageComplete &&
    sources.every((source) => sourceDocumentsWithRisk.has(source.document_id)) &&
    snapshots.length > 0 &&
    statedCutoffs.every(validRiskCutoff) &&
    new Set(statedCutoffs).size === 1;
  const gapReason = snapshot.gap_reason ?? (!coverageComplete
    ? "prior_risk_coverage_incomplete"
    : !snapshots.length
      ? "prior_review_has_no_risk_snapshots"
      : !cutoffComplete
        ? "prior_risk_cutoff_not_provable"
        : null);
  return { review, sources, decisions, snapshots, coverageComplete, cutoffComplete, gapReason };
}

function mapSelectedCostObservations(
  sources: AssuranceSource[],
  role: "baseline" | "current",
): CostObservationRow[] {
  return sources
    .filter((source) => source.role === role)
    .flatMap((source) => source.cost_observations.map((observation) => ({
      ...observation,
      source_content_hash: source.source_version.content_hash,
      parser_version: source.source_version.parser_version,
      contract_version: source.source_version.contract_version,
      documents: source.title
        ? {
            title: source.title,
            content_hash: source.source_version.content_hash,
            assurance_observation_parser_version: source.source_version.parser_version,
            assurance_observation_contract_version: source.source_version.contract_version,
          }
        : null,
    })));
}

function summarizeObservationCoverage(sources: AssuranceSource[]) {
  const byRole: ObservationCoverageByRole = {
    baseline: {} as Record<ObservationCoverageDomain, AssuranceCoverageRow>,
    current: {} as Record<ObservationCoverageDomain, AssuranceCoverageRow>,
  };
  for (const role of ["baseline", "current"] as const) {
    const roleSources = sources.filter((source) => source.role === role);
    for (const domain of ["budget", "schedule", "progress", "risk"] as const) {
      const rows = roleSources.flatMap((source) => {
        const row = source.assurance_observation_coverage.find((item) => item.domain === domain);
        return row ? [{ row, title: source.title ?? source.document_id }] : [];
      });
      const missingCoverage = rows.length !== roleSources.length;
      const states = rows.map(({ row }) => row.state);
      // A conflicting source always wins: mixed/contradictory evidence for a
      // domain is unsafe to use even if other sources are clean. Otherwise,
      // at least one genuinely processed source is enough to let a
      // comparison stand on that source's own evidence -- a sibling
      // document that hasn't been processed yet (or has none at all) is a
      // gap at *that document's* level, not grounds to blank out a
      // comparison that other documents already support (see CONTEXT.md,
      // "Comparison level": missing/incomparable evidence at one scope must
      // not suppress a supported comparison elsewhere).
      const state: ObservationCoverageState = states.includes("ambiguous_conflicting")
        ? "ambiguous_conflicting"
        : states.includes("processed")
          ? "processed"
          : missingCoverage || states.includes("unprocessed")
            ? "unprocessed"
            : "absent";
      const partial = state === "processed" && (missingCoverage || states.some((candidate) => candidate !== "processed"));
      const reasons = [...new Set([
        ...rows.flatMap(({ row, title }) => row.reason ? [`${title}: ${row.reason}`] : []),
        ...(missingCoverage ? ["A selected source has no coverage record for this domain."] : []),
      ])];
      byRole[role][domain] = {
        domain,
        state,
        total_groups: rows.reduce((total, { row }) => total + row.total_groups, 0),
        processed_groups: rows.reduce((total, { row }) => total + row.processed_groups, 0),
        reason: reasons.length ? reasons.join(" ").slice(0, 1500) : null,
        partial,
      };
    }
  }
  return { byRole };
}

function buildReviewExtraction(
  sources: AssuranceSource[],
  decisions: ObservationDecision[] = [],
): {
  extraction: ReviewExtraction;
  progressSourceObservations: Record<string, unknown>[];
  progressSourceRagClaims: Record<string, unknown>[];
  riskStatements: {
    current: { source: AssuranceSource; row: AssuranceObservationRow }[];
    baseline: { source: AssuranceSource; row: AssuranceObservationRow }[];
  };
} {
  // Rejected observations stay in storage untouched; they are simply excluded
  // from this analysis. A corrected progress value replaces the percent used
  // by comparisons while the observation's original percent stays stored.
  const excluded = new Set(
    decisions.filter((item) => item.decision === "rejected")
      .flatMap((item) => item.observation_ids),
  );
  const corrections = new Map(
    decisions.filter((item) => item.decision === "corrected")
      .flatMap((item) => item.observation_ids.map((observationId) => [observationId, item])),
  );
  const rowsFor = (
    role: "baseline" | "current",
    domain: AssuranceObservationRow["domain"],
    observationType: AssuranceObservationRow["observation_type"],
  ) => sources
    .filter((source) => source.role === role)
    .flatMap((source) => source.assurance_observations
      .filter((row) => row.domain === domain && row.observation_type === observationType
        && !excluded.has(row.id))
      .map((row) => ({ source, row })));

  const mapMilestones = (role: "baseline" | "current"): MilestoneObservation[] =>
    rowsFor(role, "schedule", "milestone").map(({ source, row }) => {
      const observation = row.observation;
      const scopeLevel = observation.scope_level;
      const correction = corrections.get(row.id);
      const correctedDate = snapshotText(correction?.corrected_observation?.date);
      const accepted = decisions.some((item) =>
        item.decision === "accepted" && item.observation_ids.includes(row.id));
      return {
        label: snapshotText(observation.label) ?? "",
        // A reviewer-corrected date drives the comparison; the extracted date
        // stays in sourceDate for display and audit.
        date: correctedDate ?? snapshotText(observation.date),
        sourceDate: snapshotText(observation.date),
        periodLabel: snapshotText(observation.period_label),
        asOfDate: snapshotText(observation.as_of_date),
        scopeLevel: scopeLevel === "project" || scopeLevel === "wbs" ? scopeLevel : "unknown",
        scopeLabel: snapshotText(observation.scope_label),
        excerpt: row.excerpt,
        sourceRef: assuranceEvidenceReference(source, row),
        reviewDecision: correction
          ? { decision: "corrected" as const, date: correctedDate, reason: correction.reason }
          : accepted
            ? { decision: "accepted" as const, date: null, reason: null }
            : null,
      };
    });
  const progressRows = (["baseline", "current"] as const).flatMap((role) =>
    rowsFor(role, "progress", "progress"),
  );
  const progressObservations: ProgressObservation[] = progressRows.flatMap(({ source, row }) => {
    const observation = row.observation;
    const scopeLevel = observation.scope_level;
    if (scopeLevel !== "project" && scopeLevel !== "wbs" && scopeLevel !== "unknown") return [];
    const rawValueLocation = observation.value_source_location;
    const valueLocation = typeof rawValueLocation === "object" &&
      rawValueLocation !== null && !Array.isArray(rawValueLocation)
      ? rawValueLocation as Record<string, unknown>
      : null;
    const correction = corrections.get(row.id);
    const correctedPercent = typeof correction?.corrected_observation?.percent === "number"
      ? correction.corrected_observation.percent
      : null;
    return [{
      role: source.role,
      scopeLevel,
      scopeLabel: snapshotText(observation.scope_label),
      percent: correctedPercent ??
        (typeof observation.percent === "number" ? observation.percent : null),
      sourcePercent: typeof observation.percent === "number" ? observation.percent : null,
      // measure_kind is the extraction's cited-source proof; a reviewer
      // correction changes the percent, never the measurement kind.
      measureKind: observation.measure_kind === "planned" || observation.measure_kind === "actual"
        ? observation.measure_kind
        : "unspecified",
      periodLabel: snapshotText(observation.period_label),
      periodBasis: observation.period_basis === "cumulative" ||
          observation.period_basis === "weekly" ||
          observation.period_basis === "monthly" ||
          observation.period_basis === "daily" ||
          observation.period_basis === "paired_variance_formula"
        ? observation.period_basis
        : null,
      asOfDate: snapshotText(observation.as_of_date),
      excerpt: row.excerpt,
      sourceRef: {
        ...assuranceEvidenceReference(source, row),
        valueSourceLocation: sourceLocationRecord(valueLocation),
      },
      reviewDecision: correction
        ? { decision: "corrected" as const, percent: correctedPercent, reason: correction.reason }
        : decisions.some((item) =>
            item.decision === "accepted" && item.observation_ids.includes(row.id))
          ? { decision: "accepted" as const, percent: null, reason: null }
          : null,
    }];
  });
  const riskStatements = (role: "baseline" | "current") =>
    sources
      .filter((source) => source.role === role)
      .flatMap((source) => source.assurance_observations
        .filter((row) => row.domain === "risk" && row.observation_type === "risk_register_statement"
          && !excluded.has(row.id))
        .map((row) => ({ source, row })));
  const currentStatements = riskStatements("current");
  const baselineStatements = riskStatements("baseline");
  const riskSnapshots = (role: "baseline" | "current"): RiskSnapshot[] =>
    rowsFor(role, "risk", "risk_snapshot").map(({ source, row }) => {
      const observation = row.observation;
      const correction = corrections.get(row.id);
      const corrected = correction?.corrected_observation;
      const correctedStatus = snapshotText(corrected?.status);
      const correctedRatingLabel = snapshotText(corrected?.rating_label);
      const correctedRatingValue = typeof corrected?.rating_value === "number"
        ? corrected.rating_value
        : null;
      const accepted = decisions.find((item) =>
        item.decision === "accepted" && item.observation_ids.includes(row.id));
      return {
        sourceId: snapshotText(observation.risk_id),
        name: snapshotText(observation.name),
        description: snapshotText(observation.description),
        // Corrected status/rating drive the comparison; the extracted values
        // stay in sourceStatus/sourceRating* for display and audit.
        status: correctedStatus ?? snapshotText(observation.status),
        ratingLabel: correctedRatingLabel ?? snapshotText(observation.rating_label),
        ratingValue: correctedRatingValue ??
          (typeof observation.rating_value === "number" ? observation.rating_value : null),
        scaleLabel: snapshotText(observation.scale_label),
        owner: snapshotText(observation.owner),
        mitigation: snapshotText(observation.mitigation),
        dueDate: snapshotText(observation.mitigation_due_date),
        wbs: snapshotText(observation.wbs),
        periodLabel: snapshotText(observation.period_label),
        asOfDate: snapshotText(observation.as_of_date),
        excerpt: row.excerpt,
        sourceRef: assuranceEvidenceReference(source, row),
        reviewDecision: correction
          ? {
              decision: "corrected" as const,
              status: correctedStatus,
              ratingLabel: correctedRatingLabel,
              ratingValue: correctedRatingValue,
              reason: correction.reason,
              decidedBy: correction.decided_by,
              decidedAt: correction.decided_at,
            }
          : accepted
            ? {
                decision: "accepted" as const,
                status: null,
                ratingLabel: null,
                ratingValue: null,
                reason: accepted.reason,
                decidedBy: accepted.decided_by,
                decidedAt: accepted.decided_at,
              }
            : null,
        sourceStatus: snapshotText(observation.status),
        sourceRatingLabel: snapshotText(observation.rating_label),
        sourceRatingValue: typeof observation.rating_value === "number" ? observation.rating_value : null,
      };
    });
  const progressSourceObservations = progressRows.map(({ source, row }) => ({
    role: source.role,
    document_id: source.document_id,
    document_title: source.title,
    source_version: source.source_version,
    observation_id: row.id,
    ...row.observation,
    evidence_chunk_index: row.evidence_chunk_index,
    excerpt: row.excerpt,
    page_number: row.page_number,
    section_label: row.section_label,
    source_location: sourceLocationRecord(row.source_location),
  }));

  // A source-reported RAG label (a cited cell such as "Green") stays exactly
  // what the source claims: it is published beside the comparison for the
  // reviewer and never becomes the computed condition. Rejected observations
  // are excluded here too — a rejected row's RAG claim is not evidence.
  const progressSourceRagClaims = progressRows
    .map(({ source, row }) => {
      const claim = row.observation.source_rag_claim;
      if (typeof claim !== "object" || claim === null || Array.isArray(claim)) return null;
      const ragClaim = claim as Record<string, unknown>;
      const ragLabel = snapshotText(ragClaim.label);
      if (!ragLabel) return null;
      const sourceLocation = typeof ragClaim.source_location === "object" &&
        ragClaim.source_location !== null && !Array.isArray(ragClaim.source_location)
        ? ragClaim.source_location as Record<string, unknown>
        : row.source_location;
      return {
        role: source.role,
        document_id: source.document_id,
        document_title: source.title,
        source_version: source.source_version,
        observation_id: row.id,
        scope_level: snapshotText(row.observation.scope_level),
        scope_label: snapshotText(row.observation.scope_label),
        rag_label: ragLabel,
        freshness: ragClaim.freshness === "cached_formula_unverified"
          ? "cached_formula_unverified"
          : ragClaim.freshness === "source_literal" ? "source_literal" : "unknown",
        period_label: snapshotText(row.observation.period_label),
        as_of_date: snapshotText(row.observation.as_of_date),
        evidence_chunk_index: typeof ragClaim.evidence_chunk_index === "number"
          ? ragClaim.evidence_chunk_index
          : row.evidence_chunk_index,
        excerpt: snapshotText(ragClaim.excerpt) ?? row.excerpt,
        page_number: typeof ragClaim.page_number === "number" ? ragClaim.page_number : row.page_number,
        section_label: snapshotText(ragClaim.section_label) ?? row.section_label,
        source_location: sourceLocationRecord(sourceLocation),
      };
    })
    .filter((claim): claim is NonNullable<typeof claim> => claim !== null);

  return {
    extraction: {
      schedule: {
        baselineMilestones: mapMilestones("baseline"),
        currentMilestones: mapMilestones("current"),
        confidence: null,
      },
      progress: { observations: progressObservations, confidence: null },
      riskItems: {
        baselineSnapshots: riskSnapshots("baseline"),
        currentSnapshots: riskSnapshots("current"),
        confidence: null,
      },
      risk: {
        hasCurrentEvidence: false,
        openCriticalCount: 0,
        openHighCount: 0,
        highRisksMissingControl: 0,
        increasedRiskCount: 0,
        newHighRiskCount: 0,
        maxMitigationOverdueDays: 0,
        currentSource: null,
        baselineSource: null,
        currentExcerpt: null,
        baselineExcerpt: null,
        confidence: null,
      },
    },
    progressSourceObservations,
    progressSourceRagClaims,
    // Decision-filtered register statements: the risk assessment must read the
    // same effective evidence as every other comparison, so a rejected
    // no_open_high_or_critical claim can never produce on_track.
    riskStatements: {
      current: currentStatements,
      baseline: baselineStatements,
    },
  };
}

function buildRiskAssessment(
  extraction: ReviewExtraction,
  comparison: RiskComparison,
  riskStatements: {
    current: { source: AssuranceSource; row: AssuranceObservationRow }[];
    baseline: { source: AssuranceSource; row: AssuranceObservationRow }[];
  },
  coverage: ObservationCoverageByRole,
  reportingPeriodEndDate: string,
): ReviewExtraction["risk"] {
  const currentSnapshots = extraction.riskItems.currentSnapshots;
  const currentStatements = riskStatements.current;
  const baselineStatements = riskStatements.baseline;
  const explicitlyNoOpenHighRisk = currentStatements.some(
    ({ row }) => row.observation.state === "no_open_high_or_critical",
  );
  const openRiskSnapshots = currentSnapshots.filter((snapshot) => riskStatusIsOpen(snapshot.status) === true);
  const openCritical = openRiskSnapshots.filter((snapshot) => riskRatingClass(snapshot.ratingLabel) === "critical");
  const openHigh = openRiskSnapshots.filter((snapshot) => riskRatingClass(snapshot.ratingLabel) === "high");
  const contradictions = explicitlyNoOpenHighRisk && openCritical.length + openHigh.length > 0;
  const snapshotsComplete = currentSnapshots.length > 0 && currentSnapshots.every((snapshot) => {
    const open = riskStatusIsOpen(snapshot.status);
    return open !== null && (!open || riskRatingClass(snapshot.ratingLabel) !== "unknown");
  });
  const hasCurrentEvidence = coverage.current.risk.state === "processed" &&
    !contradictions && (explicitlyNoOpenHighRisk || snapshotsComplete);
  let maxMitigationOverdueDays = 0;
  for (const snapshot of openRiskSnapshots) {
    const overdueDays = dateDifferenceDays(snapshot.dueDate, reportingPeriodEndDate);
    if (overdueDays !== null) maxMitigationOverdueDays = Math.max(maxMitigationOverdueDays, overdueDays);
  }
  return {
    hasCurrentEvidence,
    openCriticalCount: openCritical.length,
    openHighCount: openHigh.length,
    highRisksMissingControl: [...openCritical, ...openHigh].filter(
      (snapshot) => !snapshot.owner || !snapshot.mitigation,
    ).length,
    increasedRiskCount: comparison.items.filter((item) => item.changeType === "increased").length,
    newHighRiskCount: comparison.items.filter((item) =>
      item.changeType === "new" &&
      item.current !== null &&
      riskStatusIsOpen(item.current.status) === true &&
      ["high", "critical"].includes(riskRatingClass(item.current.ratingLabel)),
    ).length,
    maxMitigationOverdueDays,
    currentSource: currentStatements[0]
      ? assuranceEvidenceReference(currentStatements[0].source, currentStatements[0].row)
      : currentSnapshots[0]?.sourceRef ?? null,
    baselineSource: baselineStatements[0]
      ? assuranceEvidenceReference(baselineStatements[0].source, baselineStatements[0].row)
      : extraction.riskItems.baselineSnapshots[0]?.sourceRef ?? null,
    currentExcerpt: null,
    baselineExcerpt: null,
    confidence: null,
  };
}

function applyCoverageGaps(
  findings: ReturnType<typeof evaluateAssuranceReview>,
  coverage: ObservationCoverageByRole,
) {
  return findings.map((finding) => {
    const rows = (["baseline", "current"] as const)
      .map((role) => ({ role, ...coverage[role][finding.domain] }));
    // Hard gaps: this role has no usable evidence at all for the domain, so
    // the finding cannot stand on its own and must fall back to
    // more_evidence_required.
    const gaps = rows.filter((row) => row.state !== "processed");
    // Soft gaps: at least one source for this role was processed (the
    // finding is still backed by real evidence), but a sibling source in
    // the same role has incomplete coverage for the domain. That sibling's
    // gap stays visible as a caveat without downgrading an otherwise
    // supported comparison -- see the "Comparison level" note above.
    const partialRows = rows.filter((row) => row.state === "processed" && row.partial);
    if (!gaps.length) {
      if (!partialRows.length) return finding;
      const caveat = partialRows
        .map((row) => row.reason ?? `${row.role} ${row.domain} coverage is incomplete for at least one source.`)
        .join(" ");
      return {
        ...finding,
        explanation: `${finding.explanation} Note: ${caveat}`,
      };
    }
    const explanation = gaps.map((row) => row.reason ??
      (row.state === "absent"
        ? `No ${row.domain} observations were found after processing all ${row.total_groups} ${row.role} group(s).`
        : `${row.role} ${row.domain} coverage is ${row.state}.`)).join(" ");
    const findingIsActionable = finding.condition === "critical" || finding.condition === "needs_attention";
    return {
      ...finding,
      condition: findingIsActionable ? finding.condition : "more_evidence_required" as const,
      severity: findingIsActionable ? finding.severity : "information" as const,
      headline: findingIsActionable ? finding.headline : `${finding.headline}: coverage gap`,
      explanation: `${finding.explanation} Coverage gap: ${explanation}`,
      requiredEvidence: [...new Set([
        ...finding.requiredEvidence,
        ...gaps.map((row) => `Complete ${row.role} ${row.domain} observation coverage`),
      ])],
      confidence: findingIsActionable ? finding.confidence : null,
    };
  });
}

/**
 * Reviewer decisions never touch the stored observation; this annotates the
 * published findings with what a reviewer decided so reports and UI show
 * reviewed versus unreviewed evidence instead of silently merging them.
 */
function applyObservationDecisions(
  findings: ReturnType<typeof evaluateAssuranceReview>,
  decisions: ObservationDecision[],
  sources: AssuranceSource[],
) {
  if (!decisions.length) return findings;
  const domainByDecision = new Map(decisions.map((decision) => {
    const source = sources.find((item) => item.document_id === decision.document_id);
    const observation = source?.assurance_observations.find((row) =>
      decision.observation_ids.includes(row.id));
    return [decision.id, { decision, domain: observation?.domain ?? null }];
  }));
  const decisionLabels = { accepted: "accepted", corrected: "corrected", rejected: "rejected" };
  return findings.map((finding) => {
    const relevant = [...domainByDecision.values()].filter((item) =>
      item.domain !== null &&
      (item.domain === finding.domain ||
        (finding.domain === "schedule" && item.domain === "progress")));
    if (!relevant.length) return finding;
    const summary = relevant
      .map(({ decision }) =>
        `Reviewer ${decisionLabels[decision.decision]} an observation${decision.reason ? `: ${decision.reason}` : ""}.`)
      .join(" ");
    return { ...finding, explanation: `${finding.explanation} Reviewer decisions: ${summary}` };
  });
}

/**
 * Applies cost-observation reviewer decisions to the rows the Budget and WBS
 * comparisons consume. A rejected cost observation is excluded; a correction
 * replaces the normalized amount, currency, or WBS scope label used by the
 * comparison while every stored row keeps its original values. Unreviewed
 * observations pass through unchanged.
 */
function applyCostObservationDecisions(
  decisions: ObservationDecision[],
  sources: AssuranceSource[],
  currentRows: CostObservationRow[],
  baselineRows: CostObservationRow[],
): { current: CostObservationRow[]; baseline: CostObservationRow[]; changed: boolean } {
  const costDecisions = decisions.filter((item) => item.target_type === "cost");
  if (!costDecisions.length) return { current: currentRows, baseline: baselineRows, changed: false };
  const excluded = new Set(
    costDecisions.filter((item) => item.decision === "rejected")
      .flatMap((item) => item.cost_observation_ids ?? []),
  );
  const corrections = new Map(
    costDecisions.filter((item) => item.decision === "corrected")
      .flatMap((item) => (item.cost_observation_ids ?? []).map((id) => [id, item])),
  );
  const apply = (rows: CostObservationRow[]) => rows
    .filter((row) => !excluded.has(row.id))
    .map((row) => {
      const correction = corrections.get(row.id);
      if (!correction?.corrected_observation) return row;
      const corrected = correction.corrected_observation;
      return {
        ...row,
        normalized_amount: typeof corrected.normalized_amount === "number"
          ? String(corrected.normalized_amount)
          : row.normalized_amount,
        currency: typeof corrected.currency === "string" ? corrected.currency : row.currency,
        scope_label: typeof corrected.scope_label === "string" ? corrected.scope_label : row.scope_label,
        documents: row.documents,
      };
    });
  const decisionSources = new Set(costDecisions.map((item) => item.document_id));
  return {
    current: apply(currentRows),
    baseline: apply(baselineRows),
    changed: sources.some((source) => decisionSources.has(source.document_id)),
  };
}

function summarizeObservationDecisions(
  sources: AssuranceSource[],
  decisions: ObservationDecision[],
) {
  const counts = { accepted: 0, corrected: 0, rejected: 0 };
  const countFor = (decision: ObservationDecision) =>
    (decision.observation_ids?.length ?? 0) + (decision.cost_observation_ids?.length ?? 0);
  for (const decision of decisions) counts[decision.decision] += countFor(decision);
  const totalObservations = sources.reduce(
    (total, source) =>
      total + source.assurance_observations.length + source.cost_observations.length, 0,
  );
  return {
    total_observations: totalObservations,
    reviewed: counts.accepted + counts.corrected + counts.rejected,
    ...counts,
  };
}

function snapshotText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function sourceLocationRecord(value: Record<string, unknown> | null): Record<string, string | number> | null {
  if (!value) return null;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string | number] =>
      typeof entry[1] === "string" || typeof entry[1] === "number",
  );
  return entries.length ? Object.fromEntries(entries) : null;
}

function assuranceEvidenceReference(
  source: AssuranceSource,
  row: AssuranceObservationRow,
): AssuranceEvidenceReference {
  return {
    observationId: row.id,
    documentId: source.document_id,
    documentTitle: source.title,
    sourceContentHash: source.source_version.content_hash,
    parserVersion: source.source_version.parser_version,
    contractVersion: source.source_version.contract_version,
    evidenceChunkIndex: row.evidence_chunk_index,
    pageNumber: row.page_number,
    sectionLabel: row.section_label,
    sourceLocation: sourceLocationRecord(row.source_location),
    excerpt: row.excerpt,
  };
}

function buildActionRows(findings: ReturnType<typeof evaluateAssuranceReview>) {
  const titles = {
    budget:
      "Confirm the reported estimate at completion, explain the variance against the accepted baseline, and agree a budget decision.",
    schedule:
      "Confirm the delayed milestone owner and approve a dated schedule recovery plan.",
    risk:
      "Assign accountable owners and dated mitigation for high or critical risks.",
  } as const;

  return findings
    .filter((finding) =>
      ["needs_attention", "critical"].includes(finding.condition),
    )
    .map((finding) => ({
      domain: finding.domain,
      title: titles[finding.domain],
      priority: finding.condition === "critical" ? "high" : "medium",
      status: "open",
    }));
}

async function setAnalysisFailure(
  supabase: Awaited<ReturnType<typeof requireProjectMembership>>["supabase"],
  projectId: string,
  reviewId: string,
  attemptId: string,
  message: string,
) {
  const { error } = await supabase.rpc("finish_assurance_analysis", {
    p_project_id: projectId, p_review_id: reviewId, p_attempt_id: attemptId,
    p_error: message.slice(0, 1000),
  });
  if (error) throw new Error(error.message);
  revalidateAssurance(projectId);
}

function uniqueStrings(values: FormDataEntryValue[]) {
  return [...new Set(values.map(String).filter(Boolean))];
}

function assertCanManage(role: Parameters<typeof canManageProject>[0]) {
  if (!canManageProject(role)) {
    throw new Error("Your project role cannot manage an assurance review.");
  }
}

function assertCanApproveBaseline(role: Parameters<typeof canApproveAssuranceBaseline>[0]) {
  if (!canApproveAssuranceBaseline(role)) {
    throw new Error("Your project role cannot accept a baseline or correct an assessed value.");
  }
}

function revalidateAssurance(projectId: string) {
  revalidatePath(`/app/projects/${projectId}/assurance`);
  revalidatePath(`/app/projects/${projectId}/dashboard`);
  revalidatePath(`/app/projects/${projectId}/reports`);
}
