-- PostgREST uses ON CONFLICT (ai_job_id) for idempotent extraction-run writes.
-- A partial unique index cannot satisfy that conflict target. PostgreSQL unique
-- indexes already allow multiple NULL values, so a full index preserves legacy
-- rows without job IDs while enforcing one extraction run per real job.
drop index if exists public.extraction_runs_ai_job_unique_idx;

create unique index extraction_runs_ai_job_unique_idx
  on public.extraction_runs (ai_job_id);
