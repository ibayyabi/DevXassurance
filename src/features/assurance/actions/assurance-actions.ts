"use server";

import { revalidatePath } from "next/cache";

import { evaluateAssuranceReview } from "@/features/assurance/lib/analysis";
import {
  applyCostObservationDecisions,
  applyCoverageGaps,
  applyObservationDecisions,
  buildActionRows,
  buildPreviousRiskSnapshot,
  buildProjectBudgetFinding,
  buildReviewExtraction,
  buildRiskAssessment,
  buildRiskSnapshotComparison,
  buildScheduleComparison,
  buildWbsComparison,
  mapSelectedCostObservations,
  summarizeObservationCoverage,
  summarizeObservationDecisions,
  validRiskCutoff,
  type AssuranceSource,
  type ClaimRiskMappings,
  type ObservationDecision,
  type PriorRiskSnapshotClaim,
  type ProgressRagRuleSnapshot,
} from "@/features/assurance/lib/analysis-pipeline";
import { evaluateProjectBudget } from "@/features/assurance/lib/cost-evidence";
import {
  formatReportingPeriod,
  reportingPeriodEnd,
} from "@/features/assurance/lib/review-period";
import { requireProjectMembership } from "@/features/projects/lib/queries";
import { canApproveAssuranceBaseline, canManageProject } from "@/features/projects/lib/roles";

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
