"use server";

import { revalidatePath } from "next/cache";

import {
  evaluateAssuranceReview,
  parseReviewExtraction,
  type EvaluatedFinding,
} from "@/features/assurance/lib/analysis";
import {
  documentTypes,
  type DocumentType,
} from "@/features/documents/lib/constants";
import { requireProjectMembership } from "@/features/projects/lib/queries";
import { canManageProject } from "@/features/projects/lib/roles";
import { parseJsonObject, runOllamaChat } from "@/lib/ai/ollama";

export type AutomaticAssessmentResult = {
  ok: boolean;
  changed: boolean;
  message: string;
};

type AutomaticDocumentRow = {
  id: string;
  title: string;
  file_name: string;
  document_type: DocumentType;
  document_date: string | null;
  created_at: string;
};

type AutomaticClassification = {
  documentId: string;
  documentType: DocumentType;
  evidenceRole: "baseline" | "current" | "supporting";
  reportingPeriod: string | null;
  reason: string;
  confidence: number;
};

type AutomaticPeriodAssessment = {
  reportingPeriod: string;
  extraction: NonNullable<ReturnType<typeof parseReviewExtraction>>;
};

export async function refreshAutomaticAssurance(
  projectId: string,
): Promise<AutomaticAssessmentResult> {
  if (!projectId) {
    return { ok: false, changed: false, message: "Project is required." };
  }

  const { supabase, user, membership } =
    await requireProjectMembership(projectId);
  assertCanManage(membership.role);

  const { data: documentData, error: documentError } = await supabase
    .from("documents")
    .select("id, title, file_name, document_type, document_date, created_at")
    .eq("project_id", projectId)
    .eq("processing_status", "completed")
    .order("document_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (documentError) {
    return { ok: false, changed: false, message: documentError.message };
  }

  const documents = (documentData ?? []) as AutomaticDocumentRow[];
  if (documents.length === 0) {
    return {
      ok: true,
      changed: false,
      message: "Upload documents and wait for processing to finish.",
    };
  }

  const fingerprint = documents
    .map((document) => document.id)
    .sort()
    .join(":");
  const { data: latestReview } = await supabase
    .from("assurance_reviews")
    .select("id, status, analysis_metadata")
    .eq("project_id", projectId)
    .order("reporting_period", { ascending: false })
    .limit(1)
    .maybeSingle();
  const previousMetadata = (latestReview?.analysis_metadata ?? {}) as Record<
    string,
    unknown
  >;

  const previousFingerprint =
    previousMetadata.project_document_fingerprint ??
    previousMetadata.document_fingerprint;

  if (
    previousFingerprint === fingerprint &&
    ["findings_ready", "report_draft", "approved"].includes(
      latestReview?.status ?? "",
    )
  ) {
    return {
      ok: true,
      changed: false,
      message: "The latest evidence is already assessed.",
    };
  }

  const documentIds = documents.map((document) => document.id);
  const { data: chunks, error: chunksError } = await supabase
    .from("document_chunks")
    .select("document_id, chunk_text, page_number, documents(title)")
    .eq("project_id", projectId)
    .in("document_id", documentIds)
    .order("chunk_index");

  if (chunksError || !chunks?.length) {
    return {
      ok: false,
      changed: false,
      message: chunksError?.message ?? "Processed documents contain no readable text.",
    };
  }

  const response = await runOllamaChat({
    format: "json",
    temperature: 0,
    system:
      "You organize project evidence and extract project assurance values. Use only supplied evidence. Never invent a document date, classification, number, risk, or source excerpt. Return valid JSON only.",
    user: buildAutomaticAssessmentPrompt(documents, chunks),
  });

  if (!response.ok) {
    return {
      ok: false,
      changed: false,
      message: `Automatic assessment failed: ${response.warning}`,
    };
  }

  const parsed = parseJsonObject(response.content);
  if (!parsed) {
    return {
      ok: false,
      changed: false,
      message: "The AI response was incomplete, so no project condition was changed.",
    };
  }

  const classifications = normalizeAutomaticClassifications(
    parsed.organization,
    documents,
  );
  const latestPeriod = latestReportingPeriod(classifications, documents);
  const periodAssessments = normalizePeriodAssessments(
    parsed.period_assessments,
    parsed.assessment,
    latestPeriod,
  );
  if (periodAssessments.length === 0) {
    return {
      ok: false,
      changed: false,
      message: "The AI response did not contain a usable reporting-period assessment.",
    };
  }

  const classificationUpdates = await Promise.all(
    classifications.map((classification) =>
      supabase
        .from("documents")
        .update({
          document_type: classification.documentType,
          evidence_role: classification.evidenceRole,
          classification_confidence: classification.confidence,
          classification_reason: classification.reason,
          detected_reporting_period: classification.reportingPeriod,
          updated_at: new Date().toISOString(),
        })
        .eq("id", classification.documentId)
        .eq("project_id", projectId),
    ),
  );
  const classificationFailure = classificationUpdates.find((result) => result.error);
  if (classificationFailure?.error) {
    return { ok: false, changed: false, message: classificationFailure.error.message };
  }

  const baselineIds = classifications
    .filter((item) => item.evidenceRole === "baseline")
    .map((item) => item.documentId);
  let savedPeriods = 0;
  for (const periodAssessment of periodAssessments) {
    const currentIds = classifications
      .filter(
        (item) =>
          item.evidenceRole !== "baseline" &&
          (item.reportingPeriod === periodAssessment.reportingPeriod ||
            (item.reportingPeriod === null &&
              periodAssessment.reportingPeriod === latestPeriod)),
      )
      .map((item) => item.documentId);

    if (currentIds.length === 0) continue;

    const result = await persistAutomaticReviewPeriod({
      supabase,
      userId: user.id,
      projectId,
      reportingPeriod: periodAssessment.reportingPeriod,
      extraction: periodAssessment.extraction,
      baselineIds,
      currentIds,
      provider: response.provider,
      model: response.model,
      projectFingerprint: fingerprint,
      projectDocumentCount: documents.length,
    });
    if (!result.ok) return result;
    savedPeriods += 1;
  }

  if (savedPeriods === 0) {
    return {
      ok: false,
      changed: false,
      message: "Documents were organized, but no current evidence matched a reporting period.",
    };
  }

  revalidateAssurance(projectId);
  revalidatePath(`/app/projects/${projectId}/documents`);
  return {
    ok: true,
    changed: true,
    message: `${documents.length} document${documents.length === 1 ? " was" : "s were"} organized into ${savedPeriods} reporting period${savedPeriods === 1 ? "" : "s"}.`,
  };
}

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
    .select("document_id, evidence_role, documents(title, document_date)")
    .eq("project_id", projectId)
    .eq("review_id", reviewId);
  if (linksError) throw new Error(linksError.message);

  const baselineIds = (links ?? [])
    .filter((link) => link.evidence_role === "baseline")
    .map((link) => link.document_id);
  const currentIds = (links ?? [])
    .filter((link) => link.evidence_role === "current")
    .map((link) => link.document_id);

  if (baselineIds.length === 0 || currentIds.length === 0) {
    await setAnalysisFailure(
      supabase,
      projectId,
      reviewId,
      "Baseline and current evidence must be selected before analysis.",
    );
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
    .select("document_id, chunk_text, page_number, documents(title)")
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

  const findings = evaluateAssuranceReview(extraction);
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

async function replaceReviewFindings({
  supabase,
  projectId,
  reviewId,
  findings,
  baselineIds,
  currentIds,
  provider,
  model,
}: {
  supabase: Awaited<ReturnType<typeof requireProjectMembership>>["supabase"];
  projectId: string;
  reviewId: string;
  findings: EvaluatedFinding[];
  baselineIds: string[];
  currentIds: string[];
  provider: string;
  model: string;
}): Promise<AutomaticAssessmentResult> {
  const { error: actionDeleteError } = await supabase
    .from("assurance_actions")
    .delete()
    .eq("review_id", reviewId);
  if (actionDeleteError) {
    return { ok: false, changed: false, message: actionDeleteError.message };
  }

  const { error: findingDeleteError } = await supabase
    .from("assurance_findings")
    .delete()
    .eq("review_id", reviewId);
  if (findingDeleteError) {
    return { ok: false, changed: false, message: findingDeleteError.message };
  }

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
          extraction_provider: provider,
          extraction_model: model,
          comparison_engine: "deterministic_phase_5_v1",
          thresholds: "phase_3_usable_mvp_defaults",
          evidence_selection: "automatic",
        },
      })),
    )
    .select("id, domain, condition");
  if (findingInsertError) {
    return { ok: false, changed: false, message: findingInsertError.message };
  }

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
    if (actionInsertError) {
      return { ok: false, changed: false, message: actionInsertError.message };
    }
  }

  return { ok: true, changed: true, message: "Assessment saved." };
}

async function persistAutomaticReviewPeriod({
  supabase,
  userId,
  projectId,
  reportingPeriod,
  extraction,
  baselineIds,
  currentIds,
  provider,
  model,
  projectFingerprint,
  projectDocumentCount,
}: {
  supabase: Awaited<ReturnType<typeof requireProjectMembership>>["supabase"];
  userId: string;
  projectId: string;
  reportingPeriod: string;
  extraction: NonNullable<ReturnType<typeof parseReviewExtraction>>;
  baselineIds: string[];
  currentIds: string[];
  provider: string;
  model: string;
  projectFingerprint: string;
  projectDocumentCount: number;
}): Promise<AutomaticAssessmentResult> {
  const title = `${formatReportingPeriod(reportingPeriod)} Project Assessment`;
  const { data: existingReview, error: existingReviewError } = await supabase
    .from("assurance_reviews")
    .select("id")
    .eq("project_id", projectId)
    .eq("reporting_period", reportingPeriod)
    .maybeSingle();
  if (existingReviewError) {
    return { ok: false, changed: false, message: existingReviewError.message };
  }

  let reviewId = existingReview?.id as string | undefined;
  if (!reviewId) {
    const { data: createdReview, error: createError } = await supabase
      .from("assurance_reviews")
      .insert({
        project_id: projectId,
        reporting_period: reportingPeriod,
        title,
        status: "analyzing",
        current_step: "analysis",
        created_by: userId,
      })
      .select("id")
      .single();
    if (createError || !createdReview) {
      return {
        ok: false,
        changed: false,
        message: createError?.message ?? "Automatic assessment could not be created.",
      };
    }
    reviewId = createdReview.id;
  } else {
    const { error: updateError } = await supabase
      .from("assurance_reviews")
      .update({
        title,
        status: "analyzing",
        current_step: "analysis",
        analysis_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", reviewId)
      .eq("project_id", projectId);
    if (updateError) {
      return { ok: false, changed: false, message: updateError.message };
    }
  }

  if (!reviewId) {
    return {
      ok: false,
      changed: false,
      message: "Automatic assessment could not identify its saved review.",
    };
  }

  const { error: deleteLinksError } = await supabase
    .from("assurance_review_documents")
    .delete()
    .eq("review_id", reviewId)
    .eq("project_id", projectId);
  if (deleteLinksError) {
    return { ok: false, changed: false, message: deleteLinksError.message };
  }

  const evidenceRows = [
    ...baselineIds.map((documentId) => ({
      project_id: projectId,
      review_id: reviewId,
      document_id: documentId,
      evidence_role: "baseline",
      added_by: userId,
    })),
    ...currentIds.map((documentId) => ({
      project_id: projectId,
      review_id: reviewId,
      document_id: documentId,
      evidence_role: "current",
      added_by: userId,
    })),
  ];
  if (evidenceRows.length > 0) {
    const { error: linkError } = await supabase
      .from("assurance_review_documents")
      .insert(evidenceRows);
    if (linkError) {
      return { ok: false, changed: false, message: linkError.message };
    }
  }

  const findings = evaluateAssuranceReview(extraction);
  const persisted = await replaceReviewFindings({
    supabase,
    projectId,
    reviewId,
    findings,
    baselineIds,
    currentIds,
    provider,
    model,
  });
  if (!persisted.ok) return persisted;

  const periodFingerprint = [...baselineIds, ...currentIds].sort().join(":");
  const { error: completeError } = await supabase
    .from("assurance_reviews")
    .update({
      status: "findings_ready",
      current_step: "findings",
      analysis_error: null,
      analysis_metadata: {
        mode: "automatic",
        provider,
        model,
        completed_at: new Date().toISOString(),
        document_fingerprint: periodFingerprint,
        project_document_fingerprint: projectFingerprint,
        project_document_count: projectDocumentCount,
        baseline_document_count: baselineIds.length,
        current_document_count: currentIds.length,
        assessment_version: "multi_period_v1",
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", reviewId)
    .eq("project_id", projectId);

  if (completeError) {
    return { ok: false, changed: false, message: completeError.message };
  }

  return { ok: true, changed: true, message: "Assessment period saved." };
}

function normalizePeriodAssessments(
  value: unknown,
  legacyValue: unknown,
  fallbackPeriod: string,
): AutomaticPeriodAssessment[] {
  const byPeriod = new Map<string, AutomaticPeriodAssessment>();
  const rawItems = Array.isArray(value) ? value : [];

  for (const item of rawItems) {
    const row = recordValue(item);
    if (!row) continue;
    const reportingPeriod = normalizedMonth(textValue(row.reporting_period));
    const assessment = recordValue(row.assessment) ?? row;
    const extraction = parseReviewExtraction(assessment);
    if (reportingPeriod && extraction) {
      byPeriod.set(reportingPeriod, { reportingPeriod, extraction });
    }
  }

  if (byPeriod.size === 0) {
    const legacyAssessment = recordValue(legacyValue);
    const extraction = legacyAssessment
      ? parseReviewExtraction(legacyAssessment)
      : null;
    if (extraction) {
      byPeriod.set(fallbackPeriod, {
        reportingPeriod: fallbackPeriod,
        extraction,
      });
    }
  }

  return [...byPeriod.values()].sort((a, b) =>
    a.reportingPeriod.localeCompare(b.reportingPeriod),
  );
}

function buildAutomaticAssessmentPrompt(
  documents: AutomaticDocumentRow[],
  chunks: {
    document_id: string;
    chunk_text: string;
    page_number: number | null;
    documents: { title: string } | { title: string }[] | null;
  }[],
) {
  const evidence = documents
    .map((document) => {
      const text = chunks
        .filter((chunk) => chunk.document_id === document.id)
        .map((chunk) => chunk.chunk_text)
        .join("\n")
        .slice(0, 6000);
      return `DOCUMENT_ID: ${document.id}\nTITLE: ${document.title}\nFILE_NAME: ${document.file_name}\nUPLOADED_TYPE_HINT: ${document.document_type}\nDATE_HINT: ${document.document_date ?? "unknown"}\nTEXT:\n${text}`;
    })
    .join("\n\n--- NEXT DOCUMENT ---\n\n")
    .slice(0, 30000);

  return `Organize the complete project evidence set, then extract a comparable Budget, Schedule, and Risk assessment for every reporting period found.

Organization rules:
- Return every supplied DOCUMENT_ID exactly once.
- document_type must be one of: ${documentTypes.join(", ")}.
- evidence_role is baseline only for approved plans, approved budgets, baseline schedules, contracts, charters, or equivalent plan evidence.
- evidence_role is current for reporting-period performance, forecasts, risk registers, issue logs, actual costs, and current schedules.
- evidence_role is supporting for useful evidence that is neither an approved plan nor current performance evidence.
- reporting_period is YYYY-MM-01 only when the document states or strongly identifies a reporting month. Otherwise use null.
- reason must be a short plain-language explanation grounded in title or document text.

Assessment rules:
- Return one period_assessments item for every distinct reporting month in current evidence.
- Reuse approved baseline evidence in each period assessment.
- Use only current or supporting evidence from that item's reporting period for current values.
- Never calculate a condition, health label, or score. The application calculates conditions deterministically.
- Use null when an amount or date is not explicit.
- has_current_evidence is true only when current evidence contains identifiable risk information.
- Counts must represent explicit open risks. Absence of a statement is not zero.
- Copy short source excerpts that help a reviewer locate the evidence.

Return exactly this JSON shape:
{
  "organization": [
    {
      "document_id": "supplied UUID",
      "document_type": "progress_report",
      "evidence_role": "baseline | current | supporting",
      "reporting_period": "YYYY-MM-01 or null",
      "reason": "short reason",
      "confidence": 0.0
    }
  ],
  "period_assessments": [
    {
      "reporting_period": "YYYY-MM-01",
      "assessment": {
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
    }
  ]
}

PROJECT EVIDENCE:
${evidence}`;
}

function normalizeAutomaticClassifications(
  value: unknown,
  documents: AutomaticDocumentRow[],
): AutomaticClassification[] {
  const rawItems = Array.isArray(value) ? value : [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const item of rawItems) {
    const row = recordValue(item);
    const documentId = textValue(row?.document_id);
    if (row && documents.some((document) => document.id === documentId)) {
      byId.set(documentId, row);
    }
  }

  return documents.map((document) => {
    const raw = byId.get(document.id);
    const rawType = textValue(raw?.document_type);
    const rawRole = textValue(raw?.evidence_role);
    const fallback = fallbackClassification(document);

    return {
      documentId: document.id,
      documentType: documentTypes.includes(rawType as DocumentType)
        ? (rawType as DocumentType)
        : fallback.documentType,
      evidenceRole: ["baseline", "current", "supporting"].includes(rawRole)
        ? (rawRole as AutomaticClassification["evidenceRole"])
        : fallback.evidenceRole,
      reportingPeriod:
        normalizedMonth(textValue(raw?.reporting_period)) ??
        (fallback.evidenceRole === "baseline"
          ? null
          : normalizedMonth(document.document_date ?? document.created_at)),
      reason:
        textValue(raw?.reason).slice(0, 280) || fallback.reason,
      confidence: boundedConfidence(raw?.confidence),
    };
  });
}

function fallbackClassification(document: AutomaticDocumentRow) {
  const clue = `${document.title} ${document.file_name}`.toLowerCase();
  const documentType: DocumentType = /risk/.test(clue)
    ? "risk_register"
    : /issue/.test(clue)
      ? "issue_log"
      : /cost|budget|financial/.test(clue)
        ? "cost_report"
        : /schedule|programme|timeline/.test(clue)
          ? "schedule"
          : /minute|meeting/.test(clue)
            ? "meeting_minutes"
            : /approval/.test(clue)
              ? "approval"
              : /change/.test(clue)
                ? "change_record"
                : document.document_type;
  const baseline = /baseline|approved plan|charter|contract/.test(clue);

  return {
    documentType,
    evidenceRole: baseline ? ("baseline" as const) : ("current" as const),
    reason: baseline
      ? "The file name identifies approved plan or baseline evidence."
      : "The file is treated as current evidence until the document text indicates otherwise.",
  };
}

function latestReportingPeriod(
  classifications: AutomaticClassification[],
  documents: AutomaticDocumentRow[],
) {
  const candidates = [
    ...classifications
      .map((classification) => classification.reportingPeriod)
      .filter((value): value is string => Boolean(value)),
    ...documents.map((document) =>
      normalizedMonth(document.document_date ?? document.created_at),
    ),
  ].filter((value): value is string => Boolean(value));

  return candidates.sort().at(-1) ?? `${new Date().toISOString().slice(0, 7)}-01`;
}

function normalizedMonth(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-01` : null;
}

function boundedConfidence(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0.5;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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
${baseline.slice(0, 12000)}

CURRENT EVIDENCE:
${current.slice(0, 12000)}`;
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
