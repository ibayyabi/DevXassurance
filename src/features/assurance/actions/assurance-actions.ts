"use server";

import { revalidatePath } from "next/cache";

import {
  evaluateAssuranceReview,
  parseReviewExtraction,
  type EvaluatedFinding,
  type ReviewExtraction,
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
  riskMappingColumns,
  wbsMappingColumns,
  type CostBaselineRow,
  type CostObservationRow,
  type MilestoneMappingRow,
  type RiskMappingRow,
  type WbsMappingRow,
} from "@/features/assurance/lib/cost-queries";
import {
  buildWbsBudgetFindings,
  buildWbsScopeCandidates,
} from "@/features/assurance/lib/wbs-comparison";
import {
  buildMilestoneComparisons,
  buildProgressComparison,
  buildScheduleFinding,
  milestoneSourceLabels,
} from "@/features/assurance/lib/schedule-comparison";
import {
  buildRiskComparison,
  riskSourceIds,
  riskSourceScales,
} from "@/features/assurance/lib/risk-comparison";
import { reviewEvidenceIssue } from "@/features/assurance/lib/evidence-readiness";
import { requireProjectMembership } from "@/features/projects/lib/queries";
import { canApproveAssuranceBaseline, canManageProject } from "@/features/projects/lib/roles";
import { parseJsonObject, runOllamaChat } from "@/lib/ai/ollama";
import { reviewEvidenceFits } from "@/features/assurance/lib/review-prompt";
import { verifySourceExcerpt, type VerifiedSource } from "@/features/assurance/lib/source-evidence";


export async function createAssuranceReview(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const reportingMonth = String(formData.get("reportingMonth") ?? "");

  if (!projectId || !/^\d{4}-\d{2}$/.test(reportingMonth)) {
    throw new Error("Choose a valid reporting month.");
  }

  const { supabase, user, membership } =
    await requireProjectMembership(projectId);
  assertCanManage(membership.role);

  const reportingPeriod = `${reportingMonth}-01`;
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

  const { supabase, user, membership } =
    await requireProjectMembership(projectId);
  assertCanManage(membership.role);

  const selectedIds = [...baselineIds, ...currentIds];
  const { data: documents, error: documentError } = await supabase
    .from("documents")
    .select("id, processing_status")
    .eq("project_id", projectId)
    .in("id", selectedIds);

  if (documentError) throw new Error(documentError.message);
  if ((documents ?? []).length !== selectedIds.length) {
    throw new Error("One or more selected documents are not in this project.");
  }
  if ((documents ?? []).some((document) => document.processing_status !== "completed")) {
    throw new Error("Wait for selected documents to finish processing first.");
  }

  const { error: deleteError } = await supabase
    .from("assurance_review_documents")
    .delete()
    .eq("review_id", reviewId)
    .eq("project_id", projectId);
  if (deleteError) throw new Error(deleteError.message);

  const rows = [
    ...baselineIds.map((documentId) => ({
      project_id: projectId,
      review_id: reviewId,
      document_id: documentId,
      evidence_role: "baseline",
      added_by: user.id,
    })),
    ...currentIds.map((documentId) => ({
      project_id: projectId,
      review_id: reviewId,
      document_id: documentId,
      evidence_role: "current",
      added_by: user.id,
    })),
  ];
  const { error: insertError } = await supabase
    .from("assurance_review_documents")
    .insert(rows);
  if (insertError) throw new Error(insertError.message);

  const { error: reviewError } = await supabase
    .from("assurance_reviews")
    .update({
      status: "evidence_ready",
      current_step: "analysis",
      analysis_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", reviewId)
    .eq("project_id", projectId);
  if (reviewError) throw new Error(reviewError.message);

  revalidateAssurance(projectId);
}

export async function runAssuranceAnalysis(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const reviewId = String(formData.get("reviewId") ?? "");
  if (!projectId || !reviewId) throw new Error("Assurance review is required.");

  const { supabase, membership } = await requireProjectMembership(projectId);
  assertCanManage(membership.role);

  const { data: review, error: reviewLookupError } = await supabase
    .from("assurance_reviews")
    .select("reporting_period")
    .eq("id", reviewId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (reviewLookupError) throw new Error(reviewLookupError.message);
  if (!review) throw new Error("Assurance review is required.");
  const reportingPeriod = reportingPeriodEnd(review.reporting_period);

  const { data: links, error: linksError } = await supabase
    .from("assurance_review_documents")
    .select("document_id, evidence_role, documents!inner(title, document_date, processing_status)")
    .eq("project_id", projectId)
    .eq("review_id", reviewId);
  if (linksError) throw new Error(linksError.message);

  const baselineIds = (links ?? [])
    .filter((link) => link.evidence_role === "baseline")
    .map((link) => link.document_id);
  const currentIds = (links ?? [])
    .filter((link) => link.evidence_role === "current")
    .map((link) => link.document_id);

  const linkedIds = [...new Set((links ?? []).map((link) => link.document_id))];
  const { data: linkedDocuments, error: linkedError } = linkedIds.length
    ? await supabase.from("documents").select("id, processing_status")
        .eq("project_id", projectId).in("id", linkedIds)
    : { data: [], error: null };
  if (linkedError) throw new Error(linkedError.message);
  const evidenceIssue = reviewEvidenceIssue(links ?? [], linkedDocuments ?? []);
  if (evidenceIssue) {
    const message = evidenceIssue === "missing_role"
      ? "Baseline and current evidence must be selected before analysis."
      : "A linked evidence document is not completed. Retry or replace it in the Evidence Library.";
    await setAnalysisFailure(supabase, projectId, reviewId, message);
    return;
  }

  await supabase
    .from("assurance_reviews")
    .update({
      status: "analyzing",
      current_step: "analysis",
      analysis_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", reviewId)
    .eq("project_id", projectId);

  const allDocumentIds = [...baselineIds, ...currentIds];
  const { data: chunks, error: chunksError } = await supabase
    .from("document_chunks")
    .select("document_id, chunk_text, page_number, section_label, parser_metadata, documents(title)")
    .eq("project_id", projectId)
    .in("document_id", allDocumentIds)
    .order("chunk_index");

  if (chunksError || !chunks?.length) {
    await setAnalysisFailure(
      supabase,
      projectId,
      reviewId,
      chunksError?.message ?? "Selected evidence has no processed text.",
    );
    return;
  }

  const baselineText = formatEvidence(chunks, new Set(baselineIds));
  const currentText = formatEvidence(chunks, new Set(currentIds));
  if (!reviewEvidenceFits(baselineText, currentText)) {
    await setAnalysisFailure(
      supabase,
      projectId,
      reviewId,
      "Selected evidence exceeds the complete review request limit. Filter or select fewer documents and retry; no partial evidence was analyzed.",
    );
    return;
  }
  const response = await runOllamaChat({
    format: "json",
    temperature: 0,
    system:
      "You extract structured project assurance values. Use only supplied evidence. Never invent a number, date, risk, comparison, or source excerpt. Use null or zero only as instructed. Return valid JSON only.",
    user: buildReviewPrompt(baselineText, currentText),
  });

  if (!response.ok) {
    await setAnalysisFailure(
      supabase,
      projectId,
      reviewId,
      `AI analysis failed: ${response.warning}`,
    );
    return;
  }

  const parsed = parseJsonObject(response.content);
  const extraction = parsed ? parseReviewExtraction(parsed) : null;

  if (!extraction) {
    await setAnalysisFailure(
      supabase,
      projectId,
      reviewId,
      "AI analysis returned an invalid structure. No finding was saved.",
    );
    return;
  }
  const baselineSet = new Set(baselineIds);
  const currentSet = new Set(currentIds);
  const excerptRequests: { role: "baseline" | "current"; excerpt: string | null; required: boolean }[] = [
    { role: "baseline", excerpt: extraction.risk.baselineExcerpt, required: false },
    { role: "current", excerpt: extraction.risk.currentExcerpt, required: extraction.risk.hasCurrentEvidence },
    ...extraction.schedule.baselineMilestones.map((milestone) => ({
      role: "baseline" as const, excerpt: milestone.excerpt, required: milestone.date !== null,
    })),
    ...extraction.schedule.currentMilestones.map((milestone) => ({
      role: "current" as const, excerpt: milestone.excerpt, required: milestone.date !== null,
    })),
    ...extraction.progress.observations.map((observation) => ({
      role: observation.role, excerpt: observation.excerpt, required: observation.percent !== null,
    })),
    ...extraction.riskItems.baselineSnapshots.map((snapshot) => ({
      role: "baseline" as const, excerpt: snapshot.excerpt, required: false,
    })),
    ...extraction.riskItems.currentSnapshots.map((snapshot) => ({
      role: "current" as const, excerpt: snapshot.excerpt, required: false,
    })),
  ];
  const verifiedSources: VerifiedSource[] = [];
  let unverifiable = false;
  for (const request of excerptRequests) {
    if (!request.excerpt) {
      if (request.required) unverifiable = true;
      continue;
    }
    const source = verifySourceExcerpt(request.role, request.excerpt, chunks, request.role === "baseline" ? baselineSet : currentSet);
    if (!source) unverifiable = true;
    else verifiedSources.push(source);
  }
  if (unverifiable) {
    await setAnalysisFailure(supabase, projectId, reviewId,
      "More Evidence Required: one or more extracted values lack an exact excerpt in the selected baseline/current source documents.");
    return;
  }

  const budgetFinding = await buildProjectBudgetFinding(
    supabase,
    projectId,
    currentIds,
    reportingPeriod,
  );
  const wbs = await buildWbsComparison(
    supabase,
    projectId,
    baselineIds,
    currentIds,
    reportingPeriod,
  );
  const schedule = await buildScheduleComparison(supabase, projectId, extraction);
  const risk = await buildRiskSnapshotComparison(supabase, projectId, extraction);
  const findings = evaluateAssuranceReview(extraction, budgetFinding, schedule.finding).map((finding) => ({
    ...finding,
    sourceExcerpts: finding.sourceExcerpts.map((source) => ({
      ...source,
      ...verifiedSources.find((verified) => verified.role === source.role && verified.excerpt === source.excerpt),
    })),
  }));
  const { error: findingDeleteError } = await supabase
    .from("assurance_findings")
    .delete()
    .eq("review_id", reviewId);
  if (findingDeleteError) throw new Error(findingDeleteError.message);

  const { error: findingInsertError } = await supabase
    .from("assurance_findings")
    .insert(
      findings.map((finding) => ({
        project_id: projectId,
        review_id: reviewId,
        domain: finding.domain,
        condition: finding.condition,
        severity: finding.severity,
        headline: finding.headline,
        explanation: finding.explanation,
        baseline_value: finding.baselineValue,
        current_value: finding.currentValue,
        variance: finding.variance,
        required_evidence: finding.requiredEvidence,
        baseline_document_ids: baselineIds,
        current_document_ids: currentIds,
        source_excerpts: finding.sourceExcerpts,
        confidence: finding.confidence,
        provenance: finding.domain === "budget"
          ? {
              evidence_source: "cost_observations_and_accepted_baseline",
              comparison_engine: "pmo_cost_contract_v1",
              thresholds: "pmo_budget_variance_v1",
            }
          : finding.domain === "schedule"
            ? {
                extraction_provider: response.provider,
                extraction_model: response.model,
                comparison_engine: "pmo_schedule_contract_v1",
                thresholds: "pmo_schedule_variance_v1",
              }
            : {
                extraction_provider: response.provider,
                extraction_model: response.model,
                comparison_engine: "deterministic_phase_4_v1",
                thresholds: "phase_3_usable_mvp_defaults",
              },
      })),
    );
  if (findingInsertError) throw new Error(findingInsertError.message);

  const { error: reviewUpdateError } = await supabase
    .from("assurance_reviews")
    .update({
      status: "findings_ready",
      current_step: "findings",
      analysis_error: null,
      analysis_metadata: {
        provider: response.provider,
        model: response.model,
        completed_at: new Date().toISOString(),
        baseline_document_count: baselineIds.length,
        current_document_count: currentIds.length,
        // WBS comparisons sit beside the single project-total Budget finding.
        wbs_budget_findings: wbs.findings,
        wbs_scope_candidates: wbs.scopeCandidates,
        // Per-milestone schedule comparisons and reported progress sit beside
        // the single Schedule finding; progress is preserved, never scored.
        schedule_milestone_comparisons: schedule.comparisons,
        schedule_milestone_labels: schedule.milestoneLabels,
        progress_observations: schedule.progress,
        // Item-level risk findings sit beside the Risk domain condition; no
        // project Risk score or composite is produced.
        risk_item_findings: risk.comparison.items,
        risk_unidentified_items: risk.comparison.unidentified,
        risk_source_ids: risk.sourceIds,
        risk_source_scales: risk.sourceScales,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", reviewId)
    .eq("project_id", projectId);
  if (reviewUpdateError) throw new Error(reviewUpdateError.message);

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

  const { supabase, user, membership } = await requireProjectMembership(projectId);
  assertCanApproveBaseline(membership.role);

  const { data: observation, error: observationError } = await supabase
    .from("cost_observations")
    .select(
      "id, document_id, measure, source_value, normalized_amount, currency, scope_level, scope_label",
    )
    .eq("id", observationId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (observationError) throw new Error(observationError.message);
  if (!observation) throw new Error("That baseline candidate is not in this project.");
  if (observation.measure !== "approved_baseline") {
    throw new Error("Only an approved-baseline cost observation can be accepted as a baseline.");
  }
  if (observation.normalized_amount === null || !observation.currency) {
    throw new Error(
      "That candidate's amount or currency could not be read safely from the source. It stays a source value and cannot be accepted.",
    );
  }

  const activeScope = supabase
    .from("cost_baselines")
    .update({ state: "superseded", superseded_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .eq("scope_level", observation.scope_level)
    .eq("state", "accepted");
  const { error: supersedeError } = await (observation.scope_label === null
    ? activeScope.is("scope_label", null)
    : activeScope.eq("scope_label", observation.scope_label));
  if (supersedeError) throw new Error(supersedeError.message);

  const { error: insertError } = await supabase.from("cost_baselines").insert({
    project_id: projectId,
    scope_level: observation.scope_level,
    scope_label: observation.scope_label,
    amount: observation.normalized_amount,
    currency: observation.currency,
    effective_date: effectiveDate,
    observation_id: observation.id,
    source_document_id: observation.document_id,
    approved_by: user.id,
    approval_note: note || null,
  });
  if (insertError) throw new Error(insertError.message);

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

  const { supabase, user, membership } = await requireProjectMembership(projectId);
  assertCanApproveBaseline(membership.role);

  // One accepted canonical target per source label: replace any prior one.
  const { error: clearError } = await supabase
    .from("wbs_mappings")
    .delete()
    .eq("project_id", projectId)
    .eq("source_label", sourceLabel)
    .eq("state", "accepted");
  if (clearError) throw new Error(clearError.message);

  const { error: insertError } = await supabase.from("wbs_mappings").insert({
    project_id: projectId,
    source_label: sourceLabel,
    canonical_label: canonicalLabel,
    state: "accepted",
    proposed_by_model: false,
    note: note || null,
    created_by: user.id,
    accepted_by: user.id,
    accepted_at: new Date().toISOString(),
  });
  if (insertError) throw new Error(insertError.message);

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

  const { error } = await supabase
    .from("wbs_mappings")
    .delete()
    .eq("project_id", projectId)
    .eq("id", mappingId);
  if (error) throw new Error(error.message);

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

  const { supabase, user, membership } = await requireProjectMembership(projectId);
  assertCanApproveBaseline(membership.role);

  // One accepted canonical target per source label: replace any prior one.
  const { error: clearError } = await supabase
    .from("milestone_mappings")
    .delete()
    .eq("project_id", projectId)
    .eq("source_label", sourceLabel)
    .eq("state", "accepted");
  if (clearError) throw new Error(clearError.message);

  const { error: insertError } = await supabase.from("milestone_mappings").insert({
    project_id: projectId,
    source_label: sourceLabel,
    canonical_label: canonicalLabel,
    state: "accepted",
    proposed_by_model: false,
    note: note || null,
    created_by: user.id,
    accepted_by: user.id,
    accepted_at: new Date().toISOString(),
  });
  if (insertError) throw new Error(insertError.message);

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

  const { error } = await supabase
    .from("milestone_mappings")
    .delete()
    .eq("project_id", projectId)
    .eq("id", mappingId);
  if (error) throw new Error(error.message);

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

  const { supabase, user, membership } = await requireProjectMembership(projectId);
  assertCanApproveBaseline(membership.role);

  // One accepted canonical target per source label: replace any prior one.
  const { error: clearError } = await supabase
    .from(table)
    .delete()
    .eq("project_id", projectId)
    .eq("source_label", sourceLabel)
    .eq("state", "accepted");
  if (clearError) throw new Error(clearError.message);

  const { error: insertError } = await supabase.from(table).insert({
    project_id: projectId,
    source_label: sourceLabel,
    canonical_label: canonicalLabel,
    state: "accepted",
    proposed_by_model: false,
    note: note || null,
    created_by: user.id,
    accepted_by: user.id,
    accepted_at: new Date().toISOString(),
  });
  if (insertError) throw new Error(insertError.message);

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

  const { error } = await supabase
    .from(table)
    .delete()
    .eq("project_id", projectId)
    .eq("id", mappingId);
  if (error) throw new Error(error.message);

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
 * The project-total Budget finding for this review: the accepted baseline
 * active for the period, compared only with an explicitly reported EAC from
 * the selected current evidence.
 */
async function buildProjectBudgetFinding(
  supabase: Awaited<ReturnType<typeof requireProjectMembership>>["supabase"],
  projectId: string,
  currentDocumentIds: string[],
  asOf: string,
) {
  const [baselineResult, observationResult] = await Promise.all([
    supabase
      .from("cost_baselines")
      .select(costBaselineColumns)
      .eq("project_id", projectId)
      .eq("state", "accepted"),
    currentDocumentIds.length
      ? supabase
          .from("cost_observations")
          .select(costObservationColumns)
          .eq("project_id", projectId)
          .in("document_id", currentDocumentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (baselineResult.error) throw new Error(baselineResult.error.message);
  if (observationResult.error) throw new Error(observationResult.error.message);

  const baselines = ((baselineResult.data ?? []) as CostBaselineRow[]).map(mapCostBaselineRow);
  const observations = ((observationResult.data ?? []) as CostObservationRow[]).map(
    mapCostObservationRow,
  );
  const baseline = selectAcceptedCostBaseline(baselines, { scopeLevel: "project", asOf });

  let baselineObservation = null;
  if (baseline?.observationId) {
    const { data, error } = await supabase
      .from("cost_observations")
      .select(costObservationColumns)
      .eq("project_id", projectId)
      .eq("id", baseline.observationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    baselineObservation = data ? mapCostObservationRow(data as CostObservationRow) : null;
  }

  return evaluateProjectBudget({
    baseline,
    baselineObservation,
    eac: selectReportedEac(observations, { scopeLevel: "project" }),
    separateMeasures: observations.filter(
      (observation) =>
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
  baselineDocumentIds: string[],
  currentDocumentIds: string[],
  asOf: string,
) {
  const reviewDocumentIds = [...new Set([...baselineDocumentIds, ...currentDocumentIds])];
  if (reviewDocumentIds.length === 0) {
    return { findings: [], scopeCandidates: [] };
  }

  const [observationResult, baselineResult, mappingResult] = await Promise.all([
    supabase
      .from("cost_observations")
      .select(costObservationColumns)
      .eq("project_id", projectId)
      .eq("scope_level", "wbs")
      .in("document_id", reviewDocumentIds),
    supabase
      .from("cost_baselines")
      .select(costBaselineColumns)
      .eq("project_id", projectId)
      .eq("scope_level", "wbs")
      .eq("state", "accepted"),
    supabase
      .from("wbs_mappings")
      .select(wbsMappingColumns)
      .eq("project_id", projectId)
      .eq("state", "accepted"),
  ]);
  if (observationResult.error) throw new Error(observationResult.error.message);
  if (baselineResult.error) throw new Error(baselineResult.error.message);
  if (mappingResult.error) throw new Error(mappingResult.error.message);

  const observations = ((observationResult.data ?? []) as CostObservationRow[]).map(mapCostObservationRow);
  const baselines = ((baselineResult.data ?? []) as CostBaselineRow[]).map(mapCostBaselineRow);
  const mappings = ((mappingResult.data ?? []) as WbsMappingRow[]).map(mapWbsMappingRow);

  const baselineSet = new Set(baselineDocumentIds);
  const currentSet = new Set(currentDocumentIds);
  const currentObservations = observations.filter((observation) => currentSet.has(observation.documentId));
  const baselineObservations = observations.filter((observation) => baselineSet.has(observation.documentId));

  const findings = buildWbsBudgetFindings({
    observations: currentObservations,
    baselineObservations: observations,
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
  extraction: ReviewExtraction,
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
  });
  const finding = buildScheduleFinding(comparisons, extraction.schedule.confidence);
  const progress = buildProgressComparison({
    observations: extraction.progress.observations,
    wbsMappings,
  });
  const milestoneLabels = milestoneSourceLabels({
    baselineMilestones: extraction.schedule.baselineMilestones,
    currentMilestones: extraction.schedule.currentMilestones,
  });
  return { finding, comparisons, progress, milestoneLabels };
}

/**
 * Item-level risk comparison for this review. Risks are matched only by exact
 * source ID or a reviewer-accepted identity mapping, and ratings compare only
 * within the same scale or an accepted scale mapping; both mapping sets are
 * reusable within the project. No project Risk score or composite is produced —
 * the Risk domain condition stays separate.
 */
async function buildRiskSnapshotComparison(
  supabase: Awaited<ReturnType<typeof requireProjectMembership>>["supabase"],
  projectId: string,
  extraction: ReviewExtraction,
) {
  const [identityResult, scaleResult] = await Promise.all([
    supabase
      .from("risk_identity_mappings")
      .select(riskMappingColumns)
      .eq("project_id", projectId)
      .eq("state", "accepted"),
    supabase
      .from("risk_scale_mappings")
      .select(riskMappingColumns)
      .eq("project_id", projectId)
      .eq("state", "accepted"),
  ]);
  if (identityResult.error) throw new Error(identityResult.error.message);
  if (scaleResult.error) throw new Error(scaleResult.error.message);

  const identityMappings = ((identityResult.data ?? []) as RiskMappingRow[]).map(mapRiskMappingRow);
  const scaleMappings = ((scaleResult.data ?? []) as RiskMappingRow[]).map(mapRiskMappingRow);

  const comparison = buildRiskComparison({
    baselineSnapshots: extraction.riskItems.baselineSnapshots,
    currentSnapshots: extraction.riskItems.currentSnapshots,
    identityMappings,
    scaleMappings,
  });
  const sourceIds = riskSourceIds(extraction.riskItems);
  const sourceScales = riskSourceScales(extraction.riskItems);
  return { comparison, sourceIds, sourceScales };
}

// The reviewed month's last day: a baseline accepted later does not apply.
function reportingPeriodEnd(reportingPeriod: string) {
  const start = new Date(`${reportingPeriod.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return reportingPeriod.slice(0, 10);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);
}

function buildReviewPrompt(baseline: string, current: string) {
  return `Extract comparable Schedule, Progress, and Risk values from the two evidence groups.

Rules:
- Never calculate a condition, score, variance, delay, or health label. The application calculates those deterministically.
- Never pair, match, or rename milestones across the two groups. List each milestone under the label its own evidence uses; the application matches milestones by label.
- A baseline value must come from BASELINE EVIDENCE. A current value must come from CURRENT EVIDENCE.
- Use null when a value or date is not explicit. Copy each date as YYYY-MM-DD only when the source states it; never infer a date from a percentage or a status.
- Report each progress percentage exactly as stated, at the level it is stated (project or WBS). Never sum or average WBS percentages into a project figure.
- has_current_evidence is true only when current evidence contains identifiable risk information.
- Counts must represent explicit open risks. Do not treat an absent statement as zero unless the evidence explicitly indicates none.
- For risk_items, list each risk item under the ID and scale its own evidence uses. Never match risks across groups, rename them, or align rating scales; the application matches by exact ID or a reviewer-accepted mapping. Set rating_value only when the source states a number for the rating; otherwise null. Do not label an item new or increased.
- Copy short source excerpts verbatim enough for a reviewer to locate the evidence. Record each source's own period or as-of date when it states one.

Do not extract cost or budget values here; project cost evidence is collected separately.

Return exactly:
{
  "schedule": {
    "baseline_milestones": [
      {
        "label": "Milestone name as baseline evidence states it",
        "date": "YYYY-MM-DD or null",
        "period_label": "source period or null",
        "as_of_date": "YYYY-MM-DD or null",
        "excerpt": "verbatim source text or null"
      }
    ],
    "current_milestones": [
      {
        "label": "Milestone name as current evidence states it",
        "date": "YYYY-MM-DD or null",
        "period_label": "source period or null",
        "as_of_date": "YYYY-MM-DD or null",
        "excerpt": "verbatim source text or null"
      }
    ],
    "confidence": 0.0
  },
  "progress": {
    "observations": [
      {
        "role": "baseline or current",
        "scope_level": "project or wbs",
        "scope_label": "WBS label, or null for project",
        "percent": 0,
        "period_label": "source period or null",
        "as_of_date": "YYYY-MM-DD or null",
        "excerpt": "verbatim source text or null"
      }
    ],
    "confidence": 0.0
  },
  "risk_items": {
    "baseline_snapshots": [
      {
        "source_id": "risk ID as stated, or null",
        "name": "short risk name or null",
        "description": "risk description or null",
        "status": "status as stated or null",
        "rating_label": "rating as stated (e.g. High) or null",
        "rating_value": null,
        "scale_label": "rating scale as stated (e.g. 1-5, Low/Med/High) or null",
        "owner": "owner as stated or null",
        "mitigation": "mitigation as stated or null",
        "due_date": "YYYY-MM-DD or null",
        "wbs": "WBS label or null",
        "period_label": "source period or null",
        "as_of_date": "YYYY-MM-DD or null",
        "excerpt": "verbatim source text or null"
      }
    ],
    "current_snapshots": [],
    "confidence": 0.0
  },
  "risk": {
    "has_current_evidence": false,
    "open_critical_count": 0,
    "open_high_count": 0,
    "high_risks_missing_owner_or_mitigation": 0,
    "increased_risk_count": 0,
    "new_high_risk_count": 0,
    "max_mitigation_overdue_days": 0,
    "baseline_excerpt": null,
    "current_excerpt": null,
    "confidence": 0.0
  }
}

BASELINE EVIDENCE:
${baseline}

CURRENT EVIDENCE:
${current}`;
}

function formatEvidence(
  chunks: {
    document_id: string;
    chunk_text: string;
    page_number: number | null;
    documents: { title: string } | { title: string }[] | null;
  }[],
  documentIds: Set<string>,
) {
  return chunks
    .filter((chunk) => documentIds.has(chunk.document_id))
    .map((chunk) => {
      const related = Array.isArray(chunk.documents)
        ? chunk.documents[0]
        : chunk.documents;
      return `[${related?.title ?? "Document"}${chunk.page_number ? `, page ${chunk.page_number}` : ""}]\n${chunk.chunk_text}`;
    })
    .join("\n\n");
}

async function setAnalysisFailure(
  supabase: Awaited<ReturnType<typeof requireProjectMembership>>["supabase"],
  projectId: string,
  reviewId: string,
  message: string,
) {
  await supabase
    .from("assurance_reviews")
    .update({
      status: "analysis_failed",
      current_step: "analysis",
      analysis_error: message.slice(0, 1000),
      updated_at: new Date().toISOString(),
    })
    .eq("id", reviewId)
    .eq("project_id", projectId);
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

function formatReportingPeriod(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}

function revalidateAssurance(projectId: string) {
  revalidatePath(`/app/projects/${projectId}/assurance`);
  revalidatePath(`/app/projects/${projectId}/dashboard`);
}
