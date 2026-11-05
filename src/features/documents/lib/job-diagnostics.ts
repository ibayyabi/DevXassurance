// Project-scoped job diagnostics for the document library. Reads the latest
// parse job per document via the user's own Supabase client: RLS
// (`ai_jobs_read_by_project_members`) keeps every row project-scoped and the
// service-role key never reaches this path.
import type { SupabaseClient } from "@supabase/supabase-js";

export type JobDiagnosticRow = {
  id: string;
  document_id: string;
  status: string;
  error_code: string | null;
  error_message: string | null;
  attempt_count: number | null;
  max_attempts: number | null;
  lease_expires_at: string | null;
  available_at: string | null;
  claimed_at: string | null;
};

export type JobDiagnostic = {
  jobId: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  attemptCount: number;
  maxAttempts: number | null;
  /** True while a retry backoff is pending; the job is not lost. */
  retryPending: boolean;
  /** True while the lease is still live — the attempt is being worked on. */
  leaseActive: boolean;
  leaseExpired: boolean;
};

export function mapJobDiagnostic(row: JobDiagnosticRow, now: Date = new Date()): JobDiagnostic {
  const leaseExpiry = row.lease_expires_at ? new Date(row.lease_expires_at) : null;
  const availableAt = row.available_at ? new Date(row.available_at) : null;
  return {
    jobId: row.id,
    status: row.status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    attemptCount: row.attempt_count ?? 0,
    maxAttempts: row.max_attempts,
    retryPending:
      row.status === "queued" && availableAt !== null && availableAt.getTime() > now.getTime(),
    leaseActive:
      row.status === "processing" &&
      leaseExpiry !== null &&
      leaseExpiry.getTime() > now.getTime(),
    leaseExpired:
      row.status === "processing" &&
      (leaseExpiry === null || leaseExpiry.getTime() <= now.getTime()),
  };
}

export async function fetchJobDiagnostics(
  supabase: SupabaseClient,
  projectId: string,
  documentIds: string[],
): Promise<Map<string, JobDiagnostic>> {
  const byDocument = new Map<string, JobDiagnostic>();
  if (!documentIds.length) return byDocument;
  const { data, error } = await supabase
    .from("ai_jobs")
    .select(
      "id, document_id, status, error_code, error_message, attempt_count, max_attempts, lease_expires_at, available_at, claimed_at",
    )
    .eq("project_id", projectId)
    .eq("job_type", "parse_document")
    .in("document_id", documentIds)
    .order("created_at", { ascending: true });
  if (error) return byDocument;
  const now = new Date();
  for (const row of data ?? []) {
    // Rows arrive ordered by created_at; the last row per document is the
    // latest job, matching how queue_document_parse_job/retry pick jobs.
    byDocument.set(row.document_id, mapJobDiagnostic(row, now));
  }
  return byDocument;
}
