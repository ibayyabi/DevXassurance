"use server";

import { revalidatePath } from "next/cache";

import {
  evaluateAssuranceReview,
  parseReviewExtraction,
  type EvaluatedFinding,
} from "@/features/assurance/lib/analysis";
import { reviewEvidenceIssue } from "@/features/assurance/lib/evidence-readiness";
import { requireProjectMembership } from "@/features/projects/lib/queries";
import { canManageProject } from "@/features/projects/lib/roles";
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
    { role: "baseline", excerpt: extraction.budget.baselineExcerpt, required: extraction.budget.baselineAmount !== null },
    { role: "current", excerpt: extraction.budget.currentExcerpt, required: extraction.budget.currentForecast !== null || extraction.budget.currentActual !== null },
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

  const findings = evaluateAssuranceReview(extraction).map((finding) => ({
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
        provenance: {
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



function buildReviewPrompt(baseline: string, current: string) {
  return `Extract comparable Budget, Schedule, and Risk values from the two evidence groups.

Rules:
- Never calculate a condition, score, percentage, or health label. The application calculates those deterministically.
- A baseline value must come from BASELINE EVIDENCE.
- A current value must come from CURRENT EVIDENCE.
- Use null when a value or date is not explicit.
- has_current_evidence is true only when current evidence contains identifiable risk information.
- Counts must represent explicit open risks. Do not treat an absent statement as zero unless the evidence explicitly indicates none.
- Copy short source excerpts verbatim enough for a reviewer to locate the evidence.

Return exactly:
{
  "budget": {
    "baseline_amount": null,
    "current_forecast": null,
    "current_actual": null,
    "currency": null,
    "baseline_excerpt": null,
    "current_excerpt": null,
    "confidence": 0.0
  },
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
      "Confirm the cost forecast, explain the variance, and agree a budget recovery decision.",
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
