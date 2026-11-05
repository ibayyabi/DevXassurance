import { NextResponse, type NextRequest } from "next/server";
import { createLeaseHeartbeat } from "@/features/documents/lib/lease-heartbeat";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isTransientDocumentWriteFailure, retryDocumentWrite } from "@/features/documents/lib/document-write-retry";
import { processDocumentJob } from "../../../../../worker/src/jobs/process-document";
import { documentSuggestionUpdateFields } from "../../../../../worker/src/services/document-extraction";
import type {
  DocumentExtractionGroupCacheRow,
  DocumentExtractionGroupStore,
  ExtractedCostObservation,
  ExtractedAssuranceObservationCoverage,
  ExtractedAssuranceObservations,
} from "../../../../../worker/src/services/document-extraction";

type WorkerRequest = {
  job_id?: string;
  claim_token?: string;
  project_id?: string;
  document_id?: string;
};

type StoredDocument = {
  id: string;
  project_id: string;
  title: string | null;
  file_name: string;
  storage_bucket: string;
  storage_path: string;
  document_type_hint: string | null;
  document_date_hint: string | null;
  reporting_period_hint: string | null;
  workstream_hint: string | null;
};

const CACHE_QUERY_BATCH_SIZE = 100;
const TRANSIENT_JOB_ERRORS: Record<string, true> = {
  assurance_observation_persistence_failed: true,
  cost_observation_persistence_failed: true,
  document_lookup_failed: true,
  extraction_group_cache_unavailable: true,
  extraction_group_checkpoint_failed: true,
  llm_provider_transient_failure: true,
  storage_download_transient_failure: true,
  suggestion_persistence_failed: true,
};

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.XASS_WORKER_SECRET;

  if (!expectedSecret) {
    return NextResponse.json(
      { ok: false, error: "Document worker authentication is not configured." },
      { status: 503 },
    );
  }

  const providedSecret = request.headers.get("x-xass-worker-secret");
  if (providedSecret !== expectedSecret) {
    return NextResponse.json(
      { ok: false, error: "Invalid worker secret." },
      { status: 401 },
    );
  }

  const payload = (await request.json()) as WorkerRequest;
  const jobId = payload.job_id;
  const claimToken = payload.claim_token;
  const projectId = payload.project_id;
  const documentId = payload.document_id;
  if (!jobId || !claimToken || !projectId || !documentId) {
    return NextResponse.json(
      { ok: false, error: "job_id, claim_token, project_id, and document_id are required." },
      { status: 400 },
    );
  }

  const supabase = createServiceRoleClient();
  const { data: claimedJob, error: claimError } = await supabase
    .from("ai_jobs")
    .select("id, project_id, document_id")
    .eq("id", jobId)
    .eq("claim_token", claimToken)
    .eq("job_type", "parse_document")
    .eq("status", "processing")
    .maybeSingle();
  if (claimError || !claimedJob) return notOwnedResponse();
  if (claimedJob.project_id !== projectId || claimedJob.document_id !== documentId) {
    return notOwnedResponse("document_project_mismatch");
  }
  const { error: initialLeaseError } = await supabase.rpc("extend_document_job_lease", {
    p_job_id: jobId,
    p_claim_token: claimToken,
    p_minutes: 15,
  });
  if (initialLeaseError) return notOwnedResponse();
  // The 15-minute lease outlives each claim, but lengthy checkpoint-free
  // phases (parse/OCR, final summary, persist chain) can exceed it. A periodic
  // renewal keeps the lease alive; a rejection means a newer attempt owns the
  // job and this attempt stops before wasting provider quota. Every durable
  // write remains fenced by the database regardless of the heartbeat.
  const heartbeat = createLeaseHeartbeat(supabase, jobId, claimToken);
  const workerStarted = performance.now();
  let workerOutcome = "failed";
  try {
    // Stop early when a renewal already revealed lost ownership (the timer
    // may have fired while the earlier stages ran).
    if (heartbeat.lost()) return notOwnedResponse();
    const { data, error } = await supabase
      .from("documents")
      .select(
        "id, project_id, title, file_name, storage_bucket, storage_path, document_type_hint, document_date_hint, reporting_period_hint, workstream_hint",
      )
      .eq("id", documentId)
      .eq("project_id", projectId)
      .maybeSingle();

    if (error) {
      return retryableResponse(supabase, {
        jobId,
        claimToken,
        projectId,
        documentId,
        errorCode: "document_lookup_failed",
        errorMessage: "The stored document could not be verified for this project.",
      });
    }

    if (!data) {
      return terminalFailureResponse(supabase, {
        jobId,
        claimToken,
        projectId,
        documentId,
        errorCode: "document_project_mismatch",
        errorMessage: "The document was not found in the requested project.",
      }, 404);
    }

    const document = data as StoredDocument;
    const downloadStarted = performance.now();
    const { data: file, error: storageError } = await supabase.storage
      .from(document.storage_bucket)
      .download(document.storage_path);
    console.info("Document worker stage completed", {
      stage: "download",
      jobId,
      projectId,
      documentId,
      durationMs: Math.round(performance.now() - downloadStarted),
      outcome: storageError || !file ? "failed" : "success",
    });

    if (storageError || !file) {
      const message = "The stored document could not be downloaded.";
      const status = Number(
        (storageError as { statusCode?: unknown; status?: unknown } | null)?.statusCode ??
        (storageError as { statusCode?: unknown; status?: unknown } | null)?.status,
      );
      const transient = status === 408 || status === 429 || status >= 500;
      const errorCode = transient ? "storage_download_transient_failure" : "storage_download_failed";
      const failure = { jobId, claimToken, projectId, documentId, errorCode, errorMessage: message };
      return transient
        ? retryableResponse(supabase, failure)
        : terminalFailureResponse(supabase, failure, 502);
    }

    const processingStarted = performance.now();
    const result = await processDocumentJob(
      {
        jobId,
        projectId,
        documentId,
        title: document.title,
        fileName: document.file_name,
        documentTypeHint: document.document_type_hint,
        documentDateHint: document.document_date_hint,
        reportingPeriodHint: document.reporting_period_hint,
        workstreamHint: document.workstream_hint,
        fileBuffer: await file.arrayBuffer(),
      },
      createExtractionGroupStore(supabase, jobId, claimToken),
    );
    console.info("Document worker stage completed", {
      stage: "processing",
      jobId,
      projectId,
      documentId,
      durationMs: Math.round(performance.now() - processingStarted),
      outcome: result.status === "failed" ? "failed" : "success",
    });

    if (result.status === "failed") {
      if (result.errorCode === "extraction_group_checkpoint_rejected") return notOwnedResponse();
      const failure = {
        jobId,
        claimToken,
        projectId,
        documentId,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      };
      return TRANSIENT_JOB_ERRORS[result.errorCode]
        ? retryableResponse(supabase, failure)
        : terminalFailureResponse(supabase, failure, 422);
    }

    const chunkWriteStarted = performance.now();
    const chunkWrite = await saveDocumentChunks(supabase, {
      jobId,
      claimToken,
      chunks: result.chunks,
    });
    console.info("Document worker stage completed", {
      stage: "chunk_upsert",
      jobId,
      projectId,
      documentId,
      durationMs: Math.round(performance.now() - chunkWriteStarted),
      outcome: chunkWrite.error ? "failed" : "success",
    });
    if (chunkWrite.error) {
      if (isOwnershipRejection(chunkWrite.error)) return notOwnedResponse();
      const failure = {
        jobId, claimToken, projectId, documentId,
        errorCode: "document_chunk_checkpoint_failed",
        errorMessage: "Document chunks could not be persisted.",
      };
      return chunkWrite.transient
        ? retryableResponse(supabase, failure)
        : terminalFailureResponse(supabase, failure, 502);
    }
    const costWrite = await persistCostObservations(
      supabase,
      jobId,
      claimToken,
      result.cost_observations,
      result.chunks,
      result.source_content_hash,
      result.parser_version,
      result.assurance_observation_contract_version,
    );
    if (costWrite.error) {
      if (isOwnershipRejection(costWrite.error)) return notOwnedResponse();
      const failure = {
        jobId,
        claimToken,
        projectId,
        documentId,
        errorCode: "cost_observation_persistence_failed",
        errorMessage: "Validated cost evidence could not be persisted.",
      };
      return costWrite.transient
        ? retryableResponse(supabase, failure)
        : terminalFailureResponse(supabase, failure, 502);
    }

    const observationWrite = await persistAssuranceObservations(
      supabase,
      jobId,
      claimToken,
      result.source_content_hash,
      result.parser_version,
      result.assurance_observation_contract_version,
      result.assurance_observations,
      result.assurance_observation_coverage,
      result.chunks,
    );
    if (observationWrite.error) {
      if (isOwnershipRejection(observationWrite.error)) return notOwnedResponse();
      const failure = {
        jobId,
        claimToken,
        projectId,
        documentId,
        errorCode: "assurance_observation_persistence_failed",
        errorMessage: "Validated assurance observations and coverage could not be persisted.",
      };
      return observationWrite.transient
        ? retryableResponse(supabase, failure)
        : terminalFailureResponse(supabase, failure, 502);
    }

    const suggestionWrite = await retryDocumentWrite(async () =>
      await supabase.rpc("persist_document_suggestions", {
        p_job_id: jobId,
        p_claim_token: claimToken,
        p_suggestions: documentSuggestionUpdateFields(result.document_suggestions),
      }),
    );

    if (suggestionWrite.error) {
      if (isOwnershipRejection(suggestionWrite.error)) return notOwnedResponse();
      const failure = {
        jobId,
        claimToken,
        projectId,
        documentId,
        errorCode: "suggestion_persistence_failed",
        errorMessage: "Validated document suggestions could not be persisted.",
      };
      return suggestionWrite.transient
        ? retryableResponse(supabase, failure)
        : terminalFailureResponse(supabase, failure, 502);
    }


    workerOutcome = "success";
    return NextResponse.json({
      ok: true,
      worker: "next_document_worker",
      processing_status: result.processing_status,
      processing_error: result.processing_error,
      chunks: result.chunks,
      facts: result.facts,
      summary: result.summary,
      summary_sources: result.summary_sources,
      health_snapshots: result.health_snapshots,
      alerts: result.alerts,
      actions: result.actions,
      cost_observations: result.cost_observations,
      source_content_hash: result.source_content_hash,
      parser_version: result.parser_version,
      assurance_observation_contract_version: result.assurance_observation_contract_version,
      assurance_observations: result.assurance_observations,
      assurance_observation_coverage: result.assurance_observation_coverage,
      document_suggestions: result.document_suggestions,
      anomalies: result.anomalies,
      parser_metadata: result.parserMetadata,
    });
  } catch (error) {
    if (isOwnershipRejection(error)) return notOwnedResponse();
    const transient = isTransientDocumentWriteFailure(error);
    const failure = {
      jobId,
      claimToken,
      projectId,
      documentId,
      errorCode: transient ? "worker_transport_transient_failure" : "worker_unhandled_error",
      errorMessage: transient
        ? "A transient network failure interrupted document processing."
        : "The document worker could not complete processing.",
    };
    return transient
      ? retryableResponse(supabase, failure)
      : terminalFailureResponse(supabase, failure, 500);
  }
  finally {
    heartbeat.stop();
    console.info("Document worker stage completed", {
      stage: "worker_total",
      jobId,
      projectId,
      documentId,
      durationMs: Math.round(performance.now() - workerStarted),
      outcome: workerOutcome,
    });
}
}

/**
 * Replaces this document's cost evidence with the validated observations from
 * this run. Each row keeps the source wording and resolves its exact location
 * from the chunk it cited.
 */
async function persistCostObservations(
  supabase: SupabaseClient,
  jobId: string,
  claimToken: string,
  observations: ExtractedCostObservation[],
  chunks: {
    chunk_index: number;
    page_number: number | null;
    section_label: string | null;
    parser_metadata: Record<string, unknown>;
  }[],
  sourceContentHash: string,
  parserVersion: string,
  contractVersion: string,
) {
  const chunksByIndex = new Map(chunks.map((chunk) => [chunk.chunk_index, chunk]));
  return await retryDocumentWrite(async () =>
    await supabase.rpc("persist_cost_observations", {
      p_job_id: jobId,
      p_claim_token: claimToken,
      p_source_content_hash: sourceContentHash,
      p_parser_version: parserVersion,
      p_contract_version: contractVersion,
      p_observations: observations.map((observation) => {
        const chunk = chunksByIndex.get(observation.evidence_chunk_index);
        const sourceLocation = observation.source_location ?? chunk?.parser_metadata?.sourceLocation;
        return {
          measure: observation.measure,
          source_value: observation.source_value,
          normalized_amount: observation.normalized_amount,
          currency: observation.currency,
          scope_level: observation.scope_level,
          scope_label: observation.scope_label,
          scope_source_id: observation.scope_source_id ?? null,
          scope_provenance: observation.scope_provenance ?? null,
          wbs_code: observation.wbs_code,
          wbs_parent_code: observation.wbs_parent_code,
          wbs_name: observation.wbs_name,
          scope_description: observation.scope_description,
          period_label: observation.period_label,
          as_of_date: observation.as_of_date,
          status_label: observation.status_label,
          evidence_chunk_index: observation.evidence_chunk_index,
          excerpt: observation.excerpt,
          page_number: chunk?.page_number ?? null,
          section_label: chunk?.section_label ?? null,
          source_location:
            sourceLocation && typeof sourceLocation === "object" && !Array.isArray(sourceLocation)
              ? sourceLocation
              : null,
        };
      }),
    }),
  );
}

async function persistAssuranceObservations(
  supabase: SupabaseClient,
  jobId: string,
  claimToken: string,
  sourceContentHash: string,
  parserVersion: string,
  contractVersion: string,
  observations: ExtractedAssuranceObservations,
  coverage: ExtractedAssuranceObservationCoverage[],
  chunks: {
    chunk_index: number;
    page_number: number | null;
    section_label: string | null;
    parser_metadata: Record<string, unknown>;
  }[],
) {
  const chunksByIndex = new Map(chunks.map((chunk) => [chunk.chunk_index, chunk]));
  const rows = [
    ...observations.milestones.map((observation) => ({ domain: "schedule", observation_type: "milestone", observation })),
    ...observations.progress.map((observation) => ({ domain: "progress", observation_type: "progress", observation })),
    ...observations.risk_snapshots.map((observation) => ({ domain: "risk", observation_type: "risk_snapshot", observation })),
    ...observations.risk_register_statements.map((observation) => ({ domain: "risk", observation_type: "risk_register_statement", observation })),
  ].map(({ domain, observation_type, observation }) => {
    const chunk = chunksByIndex.get(observation.evidence_chunk_index);
    const sourceLocation = observation.source_location ?? chunk?.parser_metadata?.sourceLocation;
    return {
      domain,
      observation_type,
      observation,
      evidence_chunk_index: observation.evidence_chunk_index,
      excerpt: observation.excerpt,
      page_number: chunk?.page_number ?? null,
      section_label: chunk?.section_label ?? null,
      source_location:
        sourceLocation && typeof sourceLocation === "object" && !Array.isArray(sourceLocation)
          ? sourceLocation
          : null,
    };
  });
  return await retryDocumentWrite(async () =>
    await supabase.rpc("persist_assurance_observations", {
      p_job_id: jobId,
      p_claim_token: claimToken,
      p_source_content_hash: sourceContentHash,
      p_parser_version: parserVersion,
      p_contract_version: contractVersion,
      p_observations: rows,
      p_coverage: coverage,
    }),
  );
}

async function saveDocumentChunks(
  supabase: SupabaseClient,
  {
    jobId,
    claimToken,
    chunks,
  }: {
    jobId: string;
    claimToken: string;
    chunks: {
      chunk_index: number;
      chunk_text: string;
      page_number: number | null;
      section_label: string | null;
      parser_metadata: Record<string, unknown>;
    }[];
  },
) {
  return await retryDocumentWrite(async () =>
    await supabase.rpc("save_document_chunks", {
      p_job_id: jobId,
      p_claim_token: claimToken,
      p_chunks: chunks.map((chunk) => ({
        chunk_index: chunk.chunk_index,
        chunk_text: chunk.chunk_text,
        page_number: chunk.page_number,
        section_label: chunk.section_label,
        parser_metadata: chunk.parser_metadata,
      })),
    }),
  );
}
function createExtractionGroupStore(
  supabase: SupabaseClient,
  jobId: string,
  claimToken: string,
): DocumentExtractionGroupStore {
  return {
    async loadGroups(projectId, documentId, groupKeys) {
      const rows: DocumentExtractionGroupCacheRow[] = [];
      for (let offset = 0; offset < groupKeys.length; offset += CACHE_QUERY_BATCH_SIZE) {
        const keys = groupKeys.slice(offset, offset + CACHE_QUERY_BATCH_SIZE);
        const { data, error } = await supabase
          .from("document_extraction_groups")
          .select(
            "project_id, document_id, group_key, status, result, attempt_count, provider, model",
          )
          .eq("project_id", projectId)
          .eq("document_id", documentId)
          .in("group_key", keys);

        if (error) throw new Error("The extraction-group cache could not be read.");
        for (const row of data ?? []) {
          if (row.status !== "completed" && row.status !== "failed") {
            throw new Error("The extraction-group cache contains an invalid status.");
          }
          rows.push({
            projectId: row.project_id,
            documentId: row.document_id,
            groupKey: row.group_key,
            status: row.status,
            result: row.result,
            attemptCount: row.attempt_count,
            provider: row.provider,
            model: row.model,
          });
        }
      }
      return rows;
    },

    async saveGroup(group) {
      const started = performance.now();
      const write = await retryDocumentWrite(async () =>
        await supabase.rpc("save_extraction_group", {
          p_job_id: jobId,
          p_claim_token: claimToken,
          p_group: {
            group_key: group.groupKey,
            content_hash: group.contentHash,
            parser_version: group.parserVersion,
            schema_version: group.schemaVersion,
            group_index: group.groupIndex,
            chunk_start_index: group.chunkStartIndex,
            chunk_end_index: group.chunkEndIndex,
            status: group.status,
            result: group.result,
            attempt_count: group.attemptCount,
            provider: group.provider,
            model: group.model,
            last_error: group.lastError,
          },
        }),
      );
      console.info("Document worker stage completed", {
        stage: "group_checkpoint",
        jobId,
        projectId: group.projectId,
        documentId: group.documentId,
        groupIndex: group.groupIndex,
        durationMs: Math.round(performance.now() - started),
        outcome: write.error ? "failed" : "success",
      });
      if (write.error) {
        throw Object.assign(
          new Error(write.error.message ?? "The extraction-group cache could not be written."),
          { code: write.error.code, retryable: write.transient },
        );
      }
    },
  };
}
function isOwnershipRejection(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "message" in error &&
      typeof error.message === "string" &&
      (error.message.includes("Ownership rejected") ||
        error.message.includes("Lease extension rejected")),
  );
}

function notOwnedResponse(errorCode = "stale_claim_token") {
  return NextResponse.json(
    {
      ok: false,
      status: "not_owned",
      errorCode,
      errorMessage: "This attempt lost ownership of the job; no durable write was committed.",
    },
    { status: 409 },
  );
}


function failedResponse(errorCode: string, errorMessage: string, status: number) {
  return NextResponse.json(
    { ok: false, status: "failed", errorCode, errorMessage },
    { status },
  );
}

async function terminalFailureResponse(
  supabase: SupabaseClient,
  failure: {
    jobId: string;
    claimToken: string;
    projectId: string;
    documentId: string;
    errorCode: string;
    errorMessage: string;
  },
  status: number,
) {
  const persisted = await markJobFailed(supabase, failure);
  if (!persisted) {
    return failedResponse(
      "failure_status_persistence_failed",
      "Failure status could not be recorded; lease recovery will reconcile the job.",
      500,
    );
  }
  return failedResponse(failure.errorCode, failure.errorMessage, status);
}

async function retryableResponse(
  supabase: SupabaseClient,
  failure: {
    jobId: string;
    claimToken: string;
    projectId: string;
    documentId: string;
    errorCode: string;
    errorMessage: string;
  },
) {
  const persisted = await markJobForRetry(supabase, failure);
  if (!persisted) {
    return failedResponse(
      "retry_status_persistence_failed",
      "Retry state could not be recorded because the job is no longer active or the database write failed.",
      500,
    );
  }
  if (persisted === "failed") {
    return failedResponse(
      "retry_limit_exceeded",
      "Document processing failed after the maximum number of attempts.",
      422,
    );
  }
  return NextResponse.json(
    {
      ok: false,
      status: "retrying",
      errorCode: failure.errorCode,
      errorMessage: failure.errorMessage,
    },
    { status: 503 },
  );
}

async function markJobFailed(
  supabase: SupabaseClient,
  {
    jobId,
    claimToken,
    projectId,
    documentId,
    errorCode,
    errorMessage,
  }: {
    jobId: string;
    claimToken: string;
    projectId: string;
    documentId: string;
    errorCode: string;
    errorMessage: string;
  },
) {
  try {
    const { data, error } = await supabase.rpc("fail_document_job_attempt", {
      fail_claim_token: claimToken,
      fail_job_id: jobId,
      fail_project_id: projectId,
      fail_document_id: documentId,
      fail_error_code: errorCode,
      fail_error_message: errorMessage.slice(0, 1000),
    });
    return !error && data === true;
  } catch {
    return false;
  }
}

async function markJobForRetry(
  supabase: SupabaseClient,
  {
    jobId,
    claimToken,
    projectId,
    documentId,
    errorCode,
    errorMessage,
  }: {
    jobId: string;
    claimToken: string;
    projectId: string;
    documentId: string;
    errorCode: string;
    errorMessage: string;
  },
) {
  try {
    const { data, error } = await supabase.rpc("retry_document_job_attempt", {
      retry_claim_token: claimToken,
      retry_job_id: jobId,
      retry_project_id: projectId,
      retry_document_id: documentId,
      retry_error_code: errorCode,
      retry_error_message: errorMessage.slice(0, 1000),
    });
    return !error && (data === "queued" || data === "failed") ? data : null;
  } catch {
    return null;
  }
}
