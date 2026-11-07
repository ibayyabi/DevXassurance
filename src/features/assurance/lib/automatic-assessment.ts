/**
 * Automatic assessment runner.
 *
 * Consumes the durable queue filled by public.complete_document_job (and by the
 * decision/reference/backfill signals) and turns published observations,
 * coverage, provenance, and source versions into a snapshot for a project and
 * an explicit cut-off. It reuses the same deterministic pipeline as a manual
 * review and never calls a provider, never enqueues extraction, and never
 * retries an extraction group: the queue holds assessment work only.
 *
 * The database fences everything that matters: claiming is one job per project,
 * the claim token rotates, the generation catches updates that arrive while a
 * run is in flight, and a changed evidence fingerprint republishes instead of
 * publishing a result that no longer matches its input.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { evaluateAssuranceReview, missingFinding, type EvaluatedFinding } from "./analysis";
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
  type AssuranceSource,
  type ObservationCoverageSummary,
  type ObservationDecision,
  type PriorRiskSnapshotClaim,
  type ProgressRagRuleSnapshot,
  type ReviewExtractionBundle,
  type RiskSnapshotComparisonResult,
  type ScheduleComparisonResult,
  type WbsComparisonResult,
} from "./analysis-pipeline";

export type AutomaticAssessmentClaim = {
  job_id: string;
  claim_token: string;
  generation: number;
  project_id: string;
  cutoff: string;
  fingerprint: string;
  sources: AssuranceSource[];
  evidence_gaps: Record<string, unknown>[];
  observation_decisions: ObservationDecision[];
  reference_fingerprint: string | null;
  reference_versions: Record<string, unknown> | null;
  references: Record<string, unknown> | null;
  progress_rag_rule: ProgressRagRuleSnapshot;
  prior_risk_snapshot?: PriorRiskSnapshotClaim;
};

export type AutomaticAssessmentOutcome =
  | { status: "published"; jobId: string; cutoff: string; snapshotId: string; snapshotStatus: string }
  | { status: "requeued"; jobId: string; reason: string }
  | { status: "failed"; jobId: string; error: string };

export type AutomaticAssessmentBatch = {
  processed: number;
  failed: number;
  recovered: number;
  outcomes: AutomaticAssessmentOutcome[];
};

/** Everything the published snapshot's metadata serializes beside the findings. */
type AssessmentPublication = {
  wbs: WbsComparisonResult;
  schedule: ScheduleComparisonResult;
  risk: RiskSnapshotComparisonResult;
  reviewData: ReviewExtractionBundle;
  decisions: ObservationDecision[];
};

const DEFAULT_BATCH_LIMIT = 5;
const MAX_BATCH_LIMIT = 25;

function isValidCutoff(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Assesses one claimed job. Exported so the deterministic tests can drive the
 * exact production path with a controlled source snapshot and no provider.
 */
export async function assessClaimedJob(
  supabase: SupabaseClient,
  claim: AutomaticAssessmentClaim,
): Promise<AutomaticAssessmentOutcome> {
  try {
    // A cut-off is explicit or there is no assessment: never borrow the upload
    // date, the file name, or an observation date to place a document.
    if (!isValidCutoff(claim.cutoff)) {
      return await failClaim(supabase, claim, "The assessment cut-off is not a valid date.", false);
    }

    const decisions = claim.observation_decisions ?? [];
    const sources = claim.sources ?? [];
    const coverage = summarizeObservationCoverage(sources);

    // No usable published evidence at this cut-off: publish the gap per domain
    // instead of inventing values. The snapshot is published as partial.
    if (sources.length === 0) {
      const findings = (["budget", "schedule", "risk"] as const).map((domain) =>
        missingFinding(
          domain,
          "No usable published evidence for this cut-off",
          claim.evidence_gaps?.length
            ? `Published evidence was not eligible for this cut-off: ${describeGaps(claim.evidence_gaps)}`
            : "No role-confirmed, published evidence exists for this cut-off. Confirm the reporting period and evidence role of an uploaded document.",
          ["A reviewer-confirmed reporting period and evidence role on at least one processed document"],
          [],
          null,
        ),
      );
      return await publish(supabase, claim, findings, coverage, null);
    }

    const reviewData = buildReviewExtraction(sources, decisions);
    const previousRisk = buildPreviousRiskSnapshot(claim.prior_risk_snapshot);
    const currentRiskCoverageComplete = coverage.byRole.current.risk.state === "processed";
    const currentCostObservations = mapSelectedCostObservations(sources, "current");
    const baselineCostObservations = mapSelectedCostObservations(sources, "baseline");
    const costDecisions = applyCostObservationDecisions(
      decisions, sources, currentCostObservations, baselineCostObservations,
    );

    const budgetFinding = await buildProjectBudgetFinding(
      supabase, claim.project_id, claim.cutoff, costDecisions.current,
    );
    const wbs = await buildWbsComparison(
      supabase, claim.project_id, claim.cutoff, costDecisions.baseline, costDecisions.current,
    );
    const schedule = await buildScheduleComparison(
      supabase, claim.project_id, claim.cutoff, reviewData.extraction,
      claim.progress_rag_rule ?? null,
    );
    const risk = await buildRiskSnapshotComparison(
      supabase, claim.project_id, reviewData.extraction, previousRisk, currentRiskCoverageComplete,
    );
    reviewData.extraction.risk = buildRiskAssessment(
      reviewData.extraction, risk.comparison, reviewData.riskStatements,
      coverage.byRole, claim.cutoff,
    );

    const findings = applyObservationDecisions(
      applyCoverageGaps(
        evaluateAssuranceReview(reviewData.extraction, budgetFinding, schedule.finding),
        coverage.byRole,
      ),
      decisions,
      sources,
    );

    return await publish(supabase, claim, findings, coverage, {
      wbs, schedule, risk, reviewData, decisions,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Automatic assessment failed.";
    // A retry is only useful while the queue still owns this attempt; the RPC
    // decides that under a row lock and reports 'lost' when it does not.
    return await failClaim(supabase, claim, message, true);
  }
}

async function publish(
  supabase: SupabaseClient,
  claim: AutomaticAssessmentClaim,
  findings: EvaluatedFinding[],
  coverage: ObservationCoverageSummary,
  publication: AssessmentPublication | null,
): Promise<AutomaticAssessmentOutcome> {
  const { data, error } = await supabase.rpc("publish_assurance_assessment_snapshot", {
    p_job_id: claim.job_id,
    p_claim_token: claim.claim_token,
    p_generation: claim.generation,
    p_findings: findings,
    p_actions: buildActionRows(findings),
    p_metadata: buildMetadata(claim, coverage, publication),
  });
  if (error) throw new Error(error.message);

  const result = (data ?? {}) as {
    status?: string;
    reason?: string;
    snapshot_id?: string;
    snapshot_status?: string;
  };
  if (result.status === "published" && result.snapshot_id) {
    return {
      status: "published",
      jobId: claim.job_id,
      cutoff: claim.cutoff,
      snapshotId: result.snapshot_id,
      snapshotStatus: result.snapshot_status ?? "partial",
    };
  }
  // 'requeued' covers input that changed while this run was computing; the job
  // stays queued so the newer input is assessed instead of dropped.
  return {
    status: "requeued",
    jobId: claim.job_id,
    reason: result.reason ?? result.status ?? "requeued",
  };
}

function buildMetadata(
  claim: AutomaticAssessmentClaim,
  coverage: ObservationCoverageSummary,
  publication: AssessmentPublication | null,
) {
  const decisions = publication?.decisions ?? claim.observation_decisions ?? [];
  return {
    assessment_mode: "automatic",
    cut_off: claim.cutoff,
    source_fingerprint: claim.fingerprint,
    source_versions: (claim.sources ?? []).map((source) => ({
      document_id: source.document_id,
      role: source.role,
      ...source.source_version,
    })),
    coverage,
    evidence_gaps: claim.evidence_gaps ?? [],
    observation_review_summary: summarizeObservationDecisions(claim.sources ?? [], decisions),
    reference_fingerprint: claim.reference_fingerprint,
    reference_versions: claim.reference_versions,
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
      previousSnapshotId: claim.prior_risk_snapshot?.review?.id ?? null,
      previousCutoff: claim.prior_risk_snapshot?.review?.reporting_period ?? null,
      previousGapReason: claim.prior_risk_snapshot?.gap_reason ?? null,
      currentCoverageComplete: coverage.byRole.current.risk.state === "processed",
    },
    results: publication
      ? {
        wbs_budget_findings: publication.wbs.findings,
        wbs_scope_candidates: publication.wbs.scopeCandidates,
        schedule_milestone_comparisons: publication.schedule.comparisons,
        schedule_milestone_labels: publication.schedule.milestoneLabels,
        progress_observations: publication.schedule.progress,
        progress_source_observations: publication.reviewData.progressSourceObservations,
        progress_source_rag_claims: publication.reviewData.progressSourceRagClaims,
        progress_rag_rule: publication.schedule.progressRagRule,
        progress_computed_statuses: publication.schedule.progressComputedStatuses,
        risk_item_findings: publication.risk.comparison.items,
        risk_unidentified_items: publication.risk.comparison.unidentified,
        risk_source_ids: publication.risk.sourceIds,
        risk_source_scales: publication.risk.sourceScales,
      }
      : {},
  };
}

async function failClaim(
  supabase: SupabaseClient,
  claim: AutomaticAssessmentClaim,
  message: string,
  retryable: boolean,
): Promise<AutomaticAssessmentOutcome> {
  const { data, error } = await supabase.rpc("fail_assurance_assessment_job", {
    p_job_id: claim.job_id,
    p_claim_token: claim.claim_token,
    p_error: message.slice(0, 1000),
    p_retryable: retryable,
  });
  if (error) throw new Error(error.message);
  const status = (data as { status?: string } | null)?.status;
  if (status === "failed") {
    return { status: "failed", jobId: claim.job_id, error: message };
  }
  // 'retry_scheduled' and 'lost' both leave the job queued (or owned by
  // recovery): either way the update is not lost.
  return { status: "requeued", jobId: claim.job_id, reason: status ?? "lost" };
}

function describeGaps(gaps: Record<string, unknown>[]) {
  return gaps
    .map((gap) => {
      const reason = typeof gap.reason === "string" ? gap.reason : "unknown";
      const title = typeof gap.title === "string" ? gap.title : null;
      return title ? `${title}: ${reason}` : reason;
    })
    .slice(0, 5)
    .join("; ");
}

/**
 * Drains the queue. Recovery runs first so a lease that expired while nothing
 * was listening is requeued before the claim decides what to pick up.
 */
export async function runAutomaticAssessments(
  supabase: SupabaseClient,
  options: { worker?: string; limit?: number } = {},
): Promise<AutomaticAssessmentBatch> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? DEFAULT_BATCH_LIMIT), 1), MAX_BATCH_LIMIT);
  const worker = (options.worker ?? "internal_api").slice(0, 100);

  const { data: recovered, error: recoveryError } = await supabase.rpc(
    "recover_expired_assurance_assessment_jobs",
  );
  if (recoveryError) throw new Error(recoveryError.message);

  const outcomes: AutomaticAssessmentOutcome[] = [];
  for (let index = 0; index < limit; index += 1) {
    const { data, error } = await supabase.rpc("claim_next_assurance_assessment_job", {
      p_worker: worker,
    });
    if (error) throw new Error(error.message);
    if (!data) break;
    outcomes.push(await assessClaimedJob(supabase, data as AutomaticAssessmentClaim));
  }

  return {
    processed: outcomes.filter((outcome) => outcome.status === "published").length,
    failed: outcomes.filter((outcome) => outcome.status === "failed").length,
    recovered: Number(recovered ?? 0),
    outcomes,
  };
}
