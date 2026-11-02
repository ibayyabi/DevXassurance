"use server";

import {
  parseDocumentTypeHint,
  parseOptionalDate,
  parseOptionalReportingPeriod,
  parseOptionalWorkstream,
  persistConfirmedDocumentMetadata,
  type ConfirmedMetadataChanges,
} from "@/features/documents/lib/metadata";
import { shouldPromoteReviewedDocument } from "@/features/assurance/lib/evidence-readiness";

import { revalidatePath } from "next/cache";

import { requireProjectMembership } from "@/features/projects/lib/queries";
import { canManageProject } from "@/features/projects/lib/roles";
import { documentTypes } from "@/features/documents/lib/constants";
import { runOllamaChat } from "@/lib/ai/ollama";



export async function updateDocumentClassification(
  formData: FormData,
): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const documentId = String(formData.get("documentId") ?? "");
  const documentType = parseDocumentTypeHint(
    formData.get("documentType"),
    documentTypes,
  );
  const evidenceRole = String(formData.get("evidenceRole") ?? "");
  const dateProvided = formData.has("documentDate");
  const periodProvided = formData.has("reportingPeriod");
  const workstreamProvided = formData.has("workstream");

  if (
    !projectId ||
    !documentId ||
    (!documentType &&
      !["baseline", "current", "supporting"].includes(evidenceRole) &&
      !dateProvided &&
      !periodProvided &&
      !workstreamProvided)
  ) {
    return;
  }

  const { supabase, user, membership } = await requireProjectMembership(projectId);

  if (!canManageProject(membership.role)) {
    return;
  }

  const values: ConfirmedMetadataChanges["values"] = {};
  if (documentType) values.documentType = documentType;
  if (["baseline", "current", "supporting"].includes(evidenceRole)) {
    values.evidenceRole = evidenceRole as ConfirmedMetadataChanges["values"]["evidenceRole"];
  }
  if (dateProvided) {
    values.documentDate = parseOptionalDate(formData.get("documentDate"));
  }
  if (periodProvided) {
    values.reportingPeriod = parseOptionalReportingPeriod(
      formData.get("reportingPeriod"),
    );
  }
  if (workstreamProvided) {
    values.workstream = parseOptionalWorkstream(formData.get("workstream"));
  }
  const { data: updatedDocument, error: metadataError } = await persistConfirmedDocumentMetadata(supabase, {
    projectId,
    documentId,
    userId: user.id,
    values,
  });
  if (metadataError) throw new Error(metadataError.message);
  if (!updatedDocument) throw new Error("Document metadata could not be saved. Refresh and try again.");
  const [{ data: document }, { data: completedExtraction }] = await Promise.all([
    supabase.from("documents").select("processing_status").eq("id", documentId).eq("project_id", projectId).maybeSingle(),
    supabase.from("extraction_runs").select("id").eq("document_id", documentId).eq("project_id", projectId).eq("status", "completed").limit(1).maybeSingle(),
  ]);
  if (shouldPromoteReviewedDocument(
    document?.processing_status ?? "",
    Boolean(completedExtraction),
    Boolean(values.documentType || values.evidenceRole),
  )) {
    const { error: promoteError } = await supabase.from("documents")
      .update({ processing_status: "completed", processing_error: null })
      .eq("id", documentId)
      .eq("project_id", projectId)
      .eq("processing_status", "needs_review");
    if (promoteError) throw new Error(promoteError.message);
  }
  revalidatePath(`/app/projects/${projectId}/documents`);
  revalidatePath(`/app/projects/${projectId}/assurance`);
}

export async function retryDocumentProcessing(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const documentId = String(formData.get("documentId") ?? "");

  if (!projectId || !documentId) {
    throw new Error("Project and document are required to retry processing.");
  }

  const { supabase, membership } = await requireProjectMembership(projectId);

  if (!canManageProject(membership.role)) {
    throw new Error("Your project role cannot retry document processing.");
  }

  const { error } = await supabase.rpc("retry_document_job", {
    retry_project_id: projectId,
    retry_document_id: documentId,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/app/projects/${projectId}/documents`);
  revalidatePath(`/app/projects/${projectId}/assurance`);
}

export async function deleteDocument(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const documentId = String(formData.get("documentId") ?? "");

  if (!projectId || !documentId) {
    return;
  }

  const { supabase, membership } = await requireProjectMembership(projectId);

  if (!canManageProject(membership.role)) {
    return;
  }

  const { data: document } = await supabase
    .from("documents")
    .select("id, storage_path")
    .eq("id", documentId)
    .eq("project_id", projectId)
    .single();

  if (!document) {
    return;
  }

  const { data: linkedFacts } = await supabase
    .from("evidence_links")
    .select("extracted_fact_id")
    .eq("project_id", projectId)
    .eq("document_id", documentId);

  const linkedFactIds = [
    ...new Set(
      (linkedFacts ?? [])
        .map((link) => link.extracted_fact_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  await supabase
    .from("document_summaries")
    .delete()
    .eq("project_id", projectId)
    .contains("selected_document_ids", [documentId]);

  if (linkedFactIds.length > 0) {
    await supabase
      .from("anomalies")
      .delete()
      .eq("project_id", projectId)
      .in("affected_fact_id", linkedFactIds);

    await supabase
      .from("extracted_facts")
      .delete()
      .eq("project_id", projectId)
      .in("id", linkedFactIds);
  }

  const generatedSourcePath = `/app/projects/${projectId}/documents?document=${documentId}`;

  await supabase
    .from("recommended_actions")
    .delete()
    .eq("project_id", projectId)
    .eq("source_path", generatedSourcePath);

  await supabase
    .from("dashboard_critical_alerts")
    .delete()
    .eq("project_id", projectId)
    .eq("source_path", generatedSourcePath);

  await supabase
    .from("anomalies")
    .delete()
    .eq("project_id", projectId)
    .eq("source_path", generatedSourcePath);

  await supabase
    .from("extraction_runs")
    .delete()
    .eq("project_id", projectId)
    .eq("document_id", documentId);

  await supabase
    .from("documents")
    .delete()
    .eq("id", documentId)
    .eq("project_id", projectId);

  if (document.storage_path) {
    await supabase.storage
      .from("project-evidence")
      .remove([document.storage_path]);
  }

  revalidatePath(`/app/projects/${projectId}/documents`);
}

export async function updateExtractedFact(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const factId = String(formData.get("factId") ?? "");
  const editedValue = String(formData.get("editedValue") ?? "").trim();
  const intent = String(formData.get("intent") ?? "edit");
  const factIds = [...new Set([factId, ...formData.getAll("factIds").map(String)].filter(Boolean))];

  if (!projectId || !factIds.length || !["accept", "edit", "reject"].includes(intent) || (intent === "edit" && (!editedValue || factIds.length !== 1))) throw new Error("Choose a valid fact review action and value.");

  const { supabase, membership } = await requireProjectMembership(projectId);

  if (!canManageProject(membership.role)) {
    throw new Error("You do not have permission to review extracted facts.");
  }

  const { data, error } = await supabase
    .from("extracted_facts")
    .update({
      ...(intent === "edit" ? { edited_value: editedValue } : {}),
      confirmation_state: intent === "accept" ? "user_confirmed" : intent === "reject" ? "user_rejected" : "user_edited",
    })
    .in("id", factIds)
    .eq("project_id", projectId)
    .select("id");
  if (error) throw new Error("Fact review could not be saved. Try again.");
  if (data?.length !== factIds.length) throw new Error("Some facts are no longer available. Refresh and try again.");

  revalidatePath(`/app/projects/${projectId}/documents`);
}

export async function generateDocumentSummary(
  formData: FormData,
): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const selectedDocumentIds = [...new Set(formData.getAll("documentIds").map(String).filter(Boolean))];

  if (!projectId || selectedDocumentIds.length === 0) return;

  const { supabase, membership } = await requireProjectMembership(projectId);
  if (!canManageProject(membership.role)) return;

  const { data: documents, error: documentsError } = await supabase
    .from("documents")
    .select("id, processing_status")
    .eq("project_id", projectId)
    .in("id", selectedDocumentIds);
  if (documentsError) throw new Error("Selected document status could not be read.");

  const pageSize = 500;
  const chunks: { id: string; document_id: string; chunk_index: number; section_label: string | null; chunk_text: string }[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("document_chunks")
      .select("id, document_id, chunk_index, section_label, chunk_text")
      .eq("project_id", projectId)
      .in("document_id", selectedDocumentIds)
      .order("document_id")
      .order("chunk_index")
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error("Selected document source chunks could not be read.");
    chunks.push(...(data ?? []));
    if ((data ?? []).length < pageSize) break;
  }

  const documentsById = new Map((documents ?? []).map((document) => [document.id, document]));
  const chunksByDocument = new Map<string, number>();
  for (const chunk of chunks) {
    chunksByDocument.set(chunk.document_id, (chunksByDocument.get(chunk.document_id) ?? 0) + 1);
  }
  const documentCoverage = selectedDocumentIds.map((id, document_index) => {
    const document = documentsById.get(id);
    return {
      document_index,
      status: document?.processing_status ?? "not_found",
      source_chunk_count: chunksByDocument.get(id) ?? 0,
    };
  });
  const coverageWarnings: string[] = [];
  const missingDocuments = documentCoverage.filter((document) => document.status === "not_found").length;
  const reviewDocuments = documentCoverage.filter((document) => document.status === "needs_review").length;
  const incompleteDocuments = documentCoverage.filter((document) =>
    document.status !== "not_found" &&
    document.status !== "completed" &&
    document.status !== "needs_review",
  ).length;
  const documentsWithoutChunks = documentCoverage.filter((document) =>
    document.status !== "not_found" && document.source_chunk_count === 0,
  ).length;
  if (missingDocuments) coverageWarnings.push(`${missingDocuments} selected document(s) were not found.`);
  if (reviewDocuments) coverageWarnings.push(`${reviewDocuments} selected document(s) are marked needs_review; their available source chunks are included.`);
  if (incompleteDocuments) coverageWarnings.push(`${incompleteDocuments} selected document(s) are not completed; available source coverage is partial.`);
  if (documentsWithoutChunks) coverageWarnings.push(`${documentsWithoutChunks} selected document(s) have no parsed source chunks.`);

  const evidence = chunks;
  const generated = evidence.length
    ? await generateGroundedSummary(evidence, documentCoverage, selectedDocumentIds)
    : {
        summary_text: "No grounded summary was generated because no selected source chunks are available.",
        confidence: 0,
        sources: [],
        provider: null,
        model: null,
        qualityWarnings: ["No selected source chunks are available for a grounded summary."],
      };
  const qualityWarning = [...new Set([...coverageWarnings, ...generated.qualityWarnings])].join(" ") || null;
  const citedChunksByDocument = new Map<string, number>();
  for (const source of generated.sources) {
    citedChunksByDocument.set(
      source.document_id,
      (citedChunksByDocument.get(source.document_id) ?? 0) + 1,
    );
  }
  const persistedDocumentCoverage = documentCoverage.map((document) => {
    const documentId = selectedDocumentIds[document.document_index];
    return {
      document_id: documentId,
      status: document.status,
      source_chunk_count: document.source_chunk_count,
      cited_chunk_count: citedChunksByDocument.get(documentId) ?? 0,
    };
  });
  const { data: summary, error: summaryError } = await supabase
    .from("document_summaries")
    .insert({
      project_id: projectId,
      summary_text: generated.summary_text,
      confidence: generated.confidence,
      quality_warning: qualityWarning,
      selected_document_ids: selectedDocumentIds,
      metadata: {
        generated_by: generated.sources.length ? generated.provider : "app_guardrail",
        model: generated.model,
        inferred_content: false,
        selected_document_count: selectedDocumentIds.length,
        source_chunk_count: evidence.length,
        cited_chunk_count: generated.sources.length,
        document_coverage: persistedDocumentCoverage,
      },
    })
    .select("id")
    .single();
  if (summaryError || !summary) throw new Error("The grounded document summary could not be saved.");

  if (generated.sources.length) {
    const { error: sourcesError } = await supabase.from("document_summary_sources").insert(
      generated.sources.map((source) => ({
        project_id: projectId,
        summary_id: summary.id,
        document_id: source.document_id,
        document_chunk_id: source.chunk_id,
        excerpt: source.excerpt,
        confidence: generated.confidence,
      })),
    );
    if (sourcesError) throw new Error("Grounded summary citations could not be saved.");
  }

  revalidatePath(`/app/projects/${projectId}/documents`);
}


async function generateGroundedSummary(
  evidence: { id: string; document_id: string; chunk_index: number; section_label: string | null; chunk_text: string }[],
  documentCoverage: { document_index: number; status: string; source_chunk_count: number }[],
  selectedDocumentIds: string[],
) {
  const MAX_BATCH_SOURCES = 8;
  const MAX_BATCH_CHARACTERS = 18_000;
  const MAX_HIERARCHY_CHILDREN = 3;
  const MAX_HIERARCHY_CHARACTERS = 15_000;
  const documentIndexById = new Map(selectedDocumentIds.map((id, index) => [id, index]));
  const sourceRows = evidence.map((source, evidence_index) => ({
    evidence_index,
    document_index: documentIndexById.get(source.document_id) ?? null,
    document_id: source.document_id,
    chunk_id: source.id,
    chunk_index: source.chunk_index,
    section_label: source.section_label,
    text: source.chunk_text,
  }));
  const batches: typeof sourceRows[] = [];
  const qualityWarnings: string[] = [];
  let currentBatch: typeof sourceRows = [];
  let oversizedSources = 0;
  for (const source of sourceRows) {
    const encodedSource = (source_index: number) => ({ ...source, source_index });
    const singletonLength = JSON.stringify([encodedSource(0)]).length;
    if (singletonLength > MAX_BATCH_CHARACTERS) {
      oversizedSources += 1;
      continue;
    }
    const candidate = [...currentBatch, source].map((item, source_index) => ({ ...item, source_index }));
    if (
      currentBatch.length &&
      (candidate.length > MAX_BATCH_SOURCES ||
        JSON.stringify(candidate).length > MAX_BATCH_CHARACTERS)
    ) {
      batches.push(currentBatch);
      currentBatch = [];
    }
    currentBatch.push(source);
  }
  if (currentBatch.length) batches.push(currentBatch);
  if (oversizedSources) {
    qualityWarnings.push(
      `${oversizedSources} source chunk(s) exceeded the bounded summary request size and were not sent; the summary is incomplete.`,
    );
  }

  const validSources: {
    evidence_index: number;
    document_id: string;
    chunk_id: string;
    excerpt: string;
  }[] = [];
  const summaryNodes: {
    summary_text: string;
    confidence: number;
    document_indexes: number[];
  }[] = [];
  let provider: string | null = null;
  let model: string | null = null;
  let failedBatches = oversizedSources;
  const system =
    "You are X-Assurance, an evidence-grounded project assurance analyst. Summarize only supplied source material; do not invent facts, dates, owners, or metrics. Return one JSON object only.";
  const parseOutput = (content: string): Record<string, unknown> | null => {
    try {
      const parsed: unknown = JSON.parse(content);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  };
  const validSummaryFields = (output: Record<string, unknown> | null) => {
    const summaryText = output?.summary_text;
    const confidence = output?.confidence;
    return typeof summaryText === "string" &&
      Boolean(summaryText.trim()) &&
      summaryText.length <= 5000 &&
      typeof confidence === "number" &&
      Number.isFinite(confidence) &&
      confidence >= 0 &&
      confidence <= 1;
  };

  for (const [batchIndex, batch] of batches.entries()) {
    const batchSources = batch.map((source, source_index) => ({ ...source, source_index }));
    const batchDocumentIndexes = [...new Set(batch.map((source) => source.document_index))]
      .filter((index): index is number => index !== null);
    const batchCoverage = batchDocumentIndexes.map((index) => documentCoverage[index]);
    const response = await runOllamaChat({
      system,
      user: `Summarize every supplied source chunk in this bounded batch. Identify material risks, issues, decisions, or actions only when directly supported. Cite every source_index with an exact contiguous excerpt of 1-500 characters from that source text. Return {"summary_text":"...","confidence":0.0,"sources":[{"source_index":0,"excerpt":"exact source excerpt"}]}.\n\nBATCH_COVERAGE_JSON=${JSON.stringify(batchCoverage)}\nBATCH_SOURCES_JSON=${JSON.stringify(batchSources)}`,
      temperature: 0,
      format: "json",
    });
    provider ??= response.provider;
    model ??= response.model;
    if (!response.ok) {
      failedBatches += 1;
      qualityWarnings.push(`Summary batch ${batchIndex + 1} failed: ${response.warning}`);
      continue;
    }
    const output = parseOutput(response.content);
    if (!output || !validSummaryFields(output) || !Array.isArray(output.sources)) {
      failedBatches += 1;
      qualityWarnings.push(`Summary batch ${batchIndex + 1} returned an invalid summary schema.`);
      continue;
    }

    const citedSourceIndexes = new Set<number>();
    let invalidCitationCount = 0;
    for (const candidate of output.sources) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        invalidCitationCount += 1;
        continue;
      }
      const citation = candidate as Record<string, unknown>;
      const sourceIndex = citation.source_index;
      const excerpt = typeof citation.excerpt === "string" ? citation.excerpt : "";
      if (
        !Number.isInteger(sourceIndex) ||
        Number(sourceIndex) < 0 ||
        Number(sourceIndex) >= batchSources.length ||
        !excerpt.trim() ||
        excerpt.length > 500 ||
        !batchSources[Number(sourceIndex)].text.includes(excerpt) ||
        citedSourceIndexes.has(Number(sourceIndex))
      ) {
        invalidCitationCount += 1;
        continue;
      }
      const cited = batchSources[Number(sourceIndex)];
      citedSourceIndexes.add(Number(sourceIndex));
      validSources.push({
        evidence_index: cited.evidence_index,
        document_id: cited.document_id,
        chunk_id: cited.chunk_id,
        excerpt,
      });
    }
    if (invalidCitationCount) {
      qualityWarnings.push(`Summary batch ${batchIndex + 1} contained ${invalidCitationCount} invalid citation row(s).`);
    }
    if (citedSourceIndexes.size !== batchSources.length) {
      qualityWarnings.push(
        `Summary batch ${batchIndex + 1} citations cover ${citedSourceIndexes.size} of ${batchSources.length} source chunks.`,
      );
    }
    if (!citedSourceIndexes.size) {
      failedBatches += 1;
      qualityWarnings.push(`Summary batch ${batchIndex + 1} supplied no valid source citations.`);
      continue;
    }
    summaryNodes.push({
      summary_text: (output.summary_text as string).trim(),
      confidence: output.confidence as number,
      document_indexes: batchDocumentIndexes,
    });
  }

  const citedEvidence = new Set(validSources.map((source) => source.evidence_index));
  if (citedEvidence.size !== evidence.length) {
    const missing = sourceRows.filter((source) => !citedEvidence.has(source.evidence_index));
    qualityWarnings.push(
      `Summary citations cover ${citedEvidence.size} of ${evidence.length} source chunks; ${new Set(missing.map((source) => source.document_id)).size} document(s) have incomplete citation coverage.`,
    );
  }
  if (failedBatches) {
    return {
      summary_text: "No grounded summary was generated because one or more bounded source batches could not be validated.",
      confidence: 0,
      sources: validSources,
      provider,
      model,
      qualityWarnings,
    };
  }

  const hierarchyConfidences = summaryNodes.map((node) => node.confidence);
  while (summaryNodes.length > 1) {
    const hierarchyBatches: typeof summaryNodes[] = [];
    let hierarchyBatch: typeof summaryNodes = [];
    for (const node of summaryNodes) {
      const candidate = [...hierarchyBatch, node];
      const encoded = candidate.map(({ summary_text, document_indexes }) => ({
        summary_text,
        document_indexes,
      }));
      if (
        hierarchyBatch.length &&
        (candidate.length > MAX_HIERARCHY_CHILDREN ||
          JSON.stringify(encoded).length > MAX_HIERARCHY_CHARACTERS)
      ) {
        hierarchyBatches.push(hierarchyBatch);
        hierarchyBatch = [];
      }
      hierarchyBatch.push(node);
    }
    if (hierarchyBatch.length) hierarchyBatches.push(hierarchyBatch);

    const nextLevel: typeof summaryNodes = [];
    for (const [batchIndex, batch] of hierarchyBatches.entries()) {
      if (batch.length === 1) {
        nextLevel.push(batch[0]);
        continue;
      }
      const hierarchy = batch.map(({ summary_text, document_indexes }) => ({
        summary_text,
        document_indexes,
      }));
      const response = await runOllamaChat({
        system,
        user: `Synthesize these bounded, source-grounded summaries into one concise assurance summary. Use only claims supported by the child summaries and preserve their full document-index coverage. Return {"summary_text":"...","confidence":0.0}.\n\nHIERARCHY_JSON=${JSON.stringify(hierarchy)}`,
        temperature: 0,
        format: "json",
      });
      provider ??= response.provider;
      model ??= response.model;
      const output = response.ok ? parseOutput(response.content) : null;
      if (!response.ok || !output || !validSummaryFields(output)) {
        qualityWarnings.push(
          response.ok
            ? `Summary hierarchy batch ${batchIndex + 1} returned an invalid summary schema.`
            : `Summary hierarchy batch ${batchIndex + 1} failed: ${response.warning}`,
        );
        return {
          summary_text: "No complete grounded summary was generated because hierarchical synthesis could not be validated.",
          confidence: 0,
          sources: validSources,
          provider,
          model,
          qualityWarnings,
        };
      }
      const documentIndexes = [...new Set(batch.flatMap((item) => item.document_indexes))].sort((a, b) => a - b);
      const confidence = output.confidence as number;
      hierarchyConfidences.push(confidence);
      nextLevel.push({
        summary_text: (output.summary_text as string).trim(),
        confidence,
        document_indexes: documentIndexes,
      });
    }
    summaryNodes.splice(0, summaryNodes.length, ...nextLevel);
  }

  return {
    summary_text: summaryNodes[0]?.summary_text ?? "No grounded summary was generated.",
    confidence: hierarchyConfidences.length ? Math.min(...hierarchyConfidences) : 0,
    sources: validSources,
    provider,
    model,
    qualityWarnings,
  };
}
