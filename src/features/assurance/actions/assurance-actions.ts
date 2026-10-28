"use server";

import { revalidatePath } from "next/cache";

import {
  evaluateAssuranceReview,
  parseReviewExtraction,
  type EvaluatedFinding,
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
  type CostBaselineRow,
  type CostObservationRow,
} from "@/features/assurance/lib/cost-queries";
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
    ...extraction.schedule.milestones.flatMap((milestone) => [
      { role: "baseline" as const, excerpt: milestone.baselineExcerpt, required: milestone.baselineDate !== null },
      { role: "current" as const, excerpt: milestone.currentExcerpt, required: milestone.currentDate !== null },
    ]),
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
  const findings = evaluateAssuranceReview(extraction, budgetFinding).map((finding) => ({
    ...finding,
    sourceExcerpts: finding.sourceExcerpts.map((source) => ({
      ...source,
      ...verifiedSources.find((verified) => verified.role === source.role && verified.excerpt === source.excerpt),
    })),
  }));
  const { error: actionDeleteError } = await supabase
    .from("assurance_actions")
    .delete()
    .eq("review_id", reviewId);
  if (actionDeleteError) throw new Error(actionDeleteError.message);

  const { error: findingDeleteError } = await supabase
    .from("assurance_findings")
    .delete()
    .eq("review_id", reviewId);
  if (findingDeleteError) throw new Error(findingDeleteError.message);

  const { data: insertedFindings, error: findingInsertError } = await supabase
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
          : {
              extraction_provider: response.provider,
              extraction_model: response.model,
              comparison_engine: "deterministic_phase_4_v1",
              thresholds: "phase_3_usable_mvp_defaults",
            },
      })),
    )
    .select("id, domain, condition");
  if (findingInsertError) throw new Error(findingInsertError.message);

  const actionRows = buildActionRows(
    projectId,
    reviewId,
    findings,
    insertedFindings ?? [],
  );
  if (actionRows.length > 0) {
    const { error: actionInsertError } = await supabase
      .from("assurance_actions")
      .insert(actionRows);
    if (actionInsertError) throw new Error(actionInsertError.message);
  }

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

// The reviewed month's last day: a baseline accepted later does not apply.
function reportingPeriodEnd(reportingPeriod: string) {
  const start = new Date(`${reportingPeriod.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return reportingPeriod.slice(0, 10);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);
}

function buildReviewPrompt(baseline: string, current: string) {
  return `Extract comparable Schedule and Risk values from the two evidence groups.

Rules:
- Never calculate a condition, score, percentage, or health label. The application calculates those deterministically.
- A baseline value must come from BASELINE EVIDENCE.
- A current value must come from CURRENT EVIDENCE.
- Use null when a value or date is not explicit.
- has_current_evidence is true only when current evidence contains identifiable risk information.
- Counts must represent explicit open risks. Do not treat an absent statement as zero unless the evidence explicitly indicates none.
- Copy short source excerpts verbatim enough for a reviewer to locate the evidence.

Do not extract cost or budget values here; project cost evidence is collected separately.

Return exactly:
{
  "schedule": {
    "milestones": [
      {
        "name": "Milestone name",
        "baseline_date": "YYYY-MM-DD or null",
        "current_forecast_date": "YYYY-MM-DD or null",
        "baseline_excerpt": null,
        "current_excerpt": null
      }
    ],
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

function buildActionRows(
  projectId: string,
  reviewId: string,
  findings: EvaluatedFinding[],
  inserted: { id: string; domain: string; condition: string }[],
) {
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
      project_id: projectId,
      review_id: reviewId,
      finding_id:
        inserted.find((row) => row.domain === finding.domain)?.id ?? null,
      title: titles[finding.domain],
      priority: finding.condition === "critical" ? "high" : "medium",
      status: "open",
    }));
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
  revalidatePath(`/app/projects/${projectId}/reports`);
}
