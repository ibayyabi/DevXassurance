-- Phase 4 Gate 1: make document processing truthful, recoverable, and retryable.

alter table public.ai_jobs
  add column if not exists attempt_count integer not null default 0
    check (attempt_count >= 0),
  add column if not exists max_attempts integer not null default 3
    check (max_attempts between 1 and 10),
  add column if not exists claimed_at timestamptz,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists completed_at timestamptz;

create index if not exists ai_jobs_queue_idx
  on public.ai_jobs (job_type, status, created_at)
  where status in ('queued', 'processing');

-- Old workflow versions could create more than one extraction run for a job
-- when a multi-row chunk response was expanded into multiple n8n items. Keep
-- the oldest association and detach later duplicates without deleting history.
with ranked_runs as (
  select
    id,
    row_number() over (
      partition by ai_job_id
      order by created_at, id
    ) as duplicate_rank
  from public.extraction_runs
  where ai_job_id is not null
)
update public.extraction_runs as run
set
  ai_job_id = null,
  metadata = run.metadata || jsonb_build_object(
    'detached_duplicate_job_run', true,
    'detached_at', now()
  )
from ranked_runs
where run.id = ranked_runs.id
  and ranked_runs.duplicate_rank > 1;

create unique index if not exists extraction_runs_ai_job_unique_idx
  on public.extraction_runs (ai_job_id)
  where ai_job_id is not null;

create or replace function public.recover_and_fetch_document_job()
returns setof public.ai_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  stale_job public.ai_jobs%rowtype;
begin
  -- A worker lease is intentionally short. Every poll repairs expired work
  -- before fetching the next queued job.
  for stale_job in
    select *
    from public.ai_jobs
    where job_type = 'parse_document'
      and status = 'processing'
      and coalesce(lease_expires_at, claimed_at + interval '5 minutes', created_at + interval '5 minutes') < now()
    for update skip locked
  loop
    if stale_job.attempt_count < stale_job.max_attempts then
      update public.ai_jobs
      set
        status = 'queued',
        error_code = 'worker_lease_expired',
        error_message = 'The previous processing attempt stopped before completion and was queued for retry.',
        claimed_at = null,
        lease_expires_at = null,
        updated_at = now(),
        metadata = metadata || jsonb_build_object(
          'last_recovered_at', now(),
          'last_recovery_reason', 'worker_lease_expired'
        )
      where id = stale_job.id;

      update public.documents
      set
        processing_status = 'queued',
        processing_error = 'The previous processing attempt stopped. Retrying automatically.',
        updated_at = now()
      where id = stale_job.document_id;
    else
      update public.ai_jobs
      set
        status = 'failed',
        error_code = 'retry_limit_exceeded',
        error_message = 'Document analysis failed after the maximum number of attempts.',
        lease_expires_at = null,
        completed_at = now(),
        updated_at = now()
      where id = stale_job.id;

      update public.documents
      set
        processing_status = 'failed',
        processing_error = 'Document analysis failed after three attempts. Review the configuration, then retry.',
        updated_at = now()
      where id = stale_job.document_id;
    end if;
  end loop;

  return query
  select job.*
  from public.ai_jobs as job
  where job.job_type = 'parse_document'
    and job.status = 'queued'
  order by job.created_at
  limit 1
  for update skip locked;
end;
$$;

revoke all on function public.recover_and_fetch_document_job() from public;
revoke all on function public.recover_and_fetch_document_job() from anon;
revoke all on function public.recover_and_fetch_document_job() from authenticated;
grant execute on function public.recover_and_fetch_document_job() to service_role;

create or replace function public.retry_document_job(
  retry_project_id uuid,
  retry_document_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_job_id uuid;
begin
  if not public.can_upload_project_evidence(retry_project_id) then
    raise exception 'Not authorized to retry document processing.';
  end if;

  if not exists (
    select 1
    from public.documents
    where id = retry_document_id
      and project_id = retry_project_id
  ) then
    raise exception 'Document was not found in this project.';
  end if;

  update public.ai_jobs
  set
    status = 'cancelled',
    error_code = 'superseded_by_manual_retry',
    error_message = 'This attempt was replaced by a manual retry.',
    lease_expires_at = null,
    completed_at = now(),
    updated_at = now()
  where project_id = retry_project_id
    and document_id = retry_document_id
    and job_type = 'parse_document'
    and status in ('queued', 'processing');

  insert into public.ai_jobs (
    project_id,
    document_id,
    job_type,
    status,
    metadata
  )
  values (
    retry_project_id,
    retry_document_id,
    'parse_document',
    'queued',
    jsonb_build_object('source', 'manual_retry', 'requested_at', now())
  )
  returning id into new_job_id;

  update public.documents
  set
    processing_status = 'queued',
    processing_error = null,
    updated_at = now()
  where id = retry_document_id
    and project_id = retry_project_id;

  return new_job_id;
end;
$$;

revoke all on function public.retry_document_job(uuid, uuid) from public;
revoke all on function public.retry_document_job(uuid, uuid) from anon;
grant execute on function public.retry_document_job(uuid, uuid) to authenticated;

create or replace function public.reset_document_job_results(reset_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  reset_document_id uuid;
begin
  select document_id into reset_document_id
  from public.ai_jobs
  where id = reset_job_id
  for update;

  if reset_document_id is null then
    raise exception 'Document job was not found.';
  end if;

  delete from public.evidence_links
  where extracted_fact_id in (
    select fact.id
    from public.extracted_facts as fact
    join public.extraction_runs as run on run.id = fact.extraction_run_id
    where run.ai_job_id = reset_job_id
  );

  delete from public.extracted_facts
  where extraction_run_id in (
    select id from public.extraction_runs where ai_job_id = reset_job_id
  );

  delete from public.document_summary_sources
  where summary_id in (
    select id
    from public.document_summaries
    where metadata ->> 'job_id' = reset_job_id::text
  );

  delete from public.document_summaries
  where metadata ->> 'job_id' = reset_job_id::text;

  delete from public.dashboard_critical_alerts
  where source_path like '%job=' || reset_job_id::text || '%';

  delete from public.recommended_actions
  where source_path like '%job=' || reset_job_id::text || '%';

  delete from public.anomalies
  where source_path like '%job=' || reset_job_id::text || '%';

  delete from public.extraction_runs
  where ai_job_id = reset_job_id;
end;
$$;

revoke all on function public.reset_document_job_results(uuid) from public;
revoke all on function public.reset_document_job_results(uuid) from anon;
revoke all on function public.reset_document_job_results(uuid) from authenticated;
grant execute on function public.reset_document_job_results(uuid) to service_role;
