import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { processDocumentJob } from "../../../../../worker/src/jobs/process-document";

type WorkerRequest = {
  job_id?: string;
  project_id?: string;
  document_id?: string;
  storage_bucket?: string;
  storage_path?: string;
  title?: string | null;
  file_name?: string | null;
  document_type?: string | null;
  document_date?: string | null;
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
  const projectId = payload.project_id;
  const documentId = payload.document_id;
  const storageBucket = payload.storage_bucket ?? "project-evidence";
  const storagePath = payload.storage_path;
  const fileName = payload.file_name ?? "document.pdf";

  if (!jobId || !projectId || !documentId || !storagePath) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "job_id, project_id, document_id, and storage_path are required.",
      },
      { status: 400 },
    );
  }

  const supabase = createServiceRoleClient();

  try {
    const { data, error } = await supabase.storage
      .from(storageBucket)
      .download(storagePath);

    if (error || !data) {
      const message = error?.message ?? "Document could not be downloaded.";
      await markJobFailed({
        jobId,
        documentId,
        errorCode: "storage_download_failed",
        errorMessage: message,
      });

      return NextResponse.json(
        {
          ok: false,
          status: "failed",
          errorCode: "storage_download_failed",
          errorMessage: message,
        },
        { status: 502 },
      );
    }

    const result = await processDocumentJob({
      jobId,
      projectId,
      documentId,
      title: payload.title,
      documentType: payload.document_type,
      documentDate: payload.document_date,
      fileName,
      fileBuffer: await data.arrayBuffer(),
    });

    if (result.status === "failed") {
      await markJobFailed({
        jobId,
        documentId,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      });

      return NextResponse.json(
        {
          ok: false,
          status: "failed",
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      ok: true,
      worker: "next_document_worker",
      chunks: result.chunks,
      facts: result.facts,
      summary: result.summary,
      health_snapshots: result.health_snapshots,
      alerts: result.alerts,
      actions: result.actions,
      anomalies: result.anomalies,
      parser_metadata: result.parserMetadata,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected worker failure.";
    await markJobFailed({
      jobId,
      documentId,
      errorCode: "worker_unhandled_error",
      errorMessage: message,
    });

    return NextResponse.json(
      {
        ok: false,
        status: "failed",
        errorCode: "worker_unhandled_error",
        errorMessage: message,
      },
      { status: 500 },
    );
  }
}

async function markJobFailed({
  jobId,
  documentId,
  errorCode,
  errorMessage,
}: {
  jobId: string;
  documentId: string;
  errorCode: string;
  errorMessage: string;
}) {
  const supabase = createServiceRoleClient();
  const safeMessage = errorMessage.slice(0, 1000);

  await Promise.all([
    supabase
      .from("ai_jobs")
      .update({
        status: "failed",
        error_code: errorCode,
        error_message: safeMessage,
        lease_expires_at: null,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId),
    supabase
      .from("documents")
      .update({
        processing_status: "failed",
        processing_error: safeMessage,
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId),
    supabase
      .from("extraction_runs")
      .update({
        status: "failed",
        metadata: {
          error_code: errorCode,
          error_message: safeMessage,
          failed_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq("ai_job_id", jobId),
  ]);
}
