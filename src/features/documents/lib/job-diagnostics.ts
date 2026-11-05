// Project-scoped job diagnostics for the document library. Reads the latest
// parse job per document via the user's own Supabase client: RLS
// (`ai_jobs_read_by_project_members`) keeps every row project-scoped and the
// service-role key never reaches this path. All jobs of a project are paged
// past the PostgREST row cap so the latest job per document is never silently missed;
// a failed read returns null, distinct from a successful query with no job rows.
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
  /** True only when a recorded lease expiry has passed. */
  leaseExpired: boolean;
  /** True when a processing job has no valid lease expiry to assess. */
  leaseUnknown: boolean;
};

export const JOB_DIAGNOSTICS_PAGE_SIZE = 1000;

export function mapJobDiagnostic(row: JobDiagnosticRow, now: Date = new Date()): JobDiagnostic {
  const leaseExpiry = row.lease_expires_at ? new Date(row.lease_expires_at) : null;
  const leaseExpiryMs = leaseExpiry?.getTime();
  const leaseKnown = leaseExpiryMs !== undefined && Number.isFinite(leaseExpiryMs);
  return {
    jobId: row.id,
    status: row.status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    attemptCount: row.attempt_count ?? 0,
    maxAttempts: row.max_attempts,
    retryPending:
      row.status === "queued" && row.available_at !== null && new Date(row.available_at).getTime() > now.getTime(),
    leaseActive:
      row.status === "processing" &&
      leaseKnown &&
      leaseExpiryMs! > now.getTime(),
    leaseExpired:
      row.status === "processing" &&
      leaseKnown &&
      leaseExpiryMs! <= now.getTime(),
    leaseUnknown: row.status === "processing" && !leaseKnown,
  };
}

type JobQuery = {
  select: (columns: string) => JobQuery;
  eq: (column: string, value: string) => JobQuery;
  in: (column: string, values: string[]) => JobQuery;
  order: (column: string, options: { ascending: boolean }) => JobQuery;
  range: (from: number, to: number) => Promise<{ data: JobDiagnosticRow[] | null; error: { message: string } | null }>;
};

function jobDiagnosticsQuery(supabase: SupabaseClient): JobQuery {
  return supabase
    .from("ai_jobs")
    .select(
      "id, document_id, status, error_code, error_message, attempt_count, max_attempts, lease_expires_at, available_at, claimed_at",
    ) as unknown as JobQuery;
}

export async function fetchJobDiagnostics(
  supabase: SupabaseClient,
  projectId: string,
  documentIds: string[],
): Promise<Map<string, JobDiagnostic> | null> {
  const byDocument = new Map<string, JobDiagnostic>();
  if (!documentIds.length) return byDocument;
  const now = new Date();
  // Ascending created_at order plus overwrite-on-repeat keeps the latest job
  // per document after full pagination. A page short of the full size ends the
  // scan; a page exactly at the cap is followed by one more range request.
  try {
    for (let offset = 0; ; offset += JOB_DIAGNOSTICS_PAGE_SIZE) {
      const { data, error } = await jobDiagnosticsQuery(supabase)
        .eq("job_type", "parse_document")
        .eq("project_id", projectId)
        .in("document_id", documentIds)
        .order("created_at", { ascending: true })
        .range(offset, offset + JOB_DIAGNOSTICS_PAGE_SIZE - 1);
      if (error) return null;
      const rows = data ?? [];
      for (const row of rows) {
        byDocument.set(row.document_id, mapJobDiagnostic(row, now));
      }
      if (rows.length < JOB_DIAGNOSTICS_PAGE_SIZE) break;
    }
  } catch {
    return null;
  }
  return byDocument;
}
