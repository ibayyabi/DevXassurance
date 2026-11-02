create or replace function public.fail_document_job_attempt(
  fail_job_id uuid,
  fail_project_id uuid,
  fail_document_id uuid,
  fail_error_code text,
  fail_error_message text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.ai_jobs%rowtype;
  failed_at timestamptz := now();
begin
  select * into job
  from public.ai_jobs
  where id = fail_job_id
    and project_id = fail_project_id
    and document_id = fail_document_id
    and job_type = 'parse_document'
    and status = 'processing'
  for update;
  if not found then return false; end if;

  perform 1
  from public.documents
  where id = fail_document_id
    and project_id = fail_project_id
    and processing_status = 'processing'
  for update;
  if not found then return false; end if;

  update public.extraction_runs
  set status = 'failed',
      metadata = metadata || jsonb_build_object(
        'error_code', left(fail_error_code, 100),
        'error_message', left(fail_error_message, 1000),
        'failed_at', failed_at
      ),
      updated_at = failed_at
  where ai_job_id = fail_job_id
    and project_id = fail_project_id
    and document_id = fail_document_id;

  update public.documents
  set processing_status = 'failed',
      processing_error = left(fail_error_message, 1000),
      updated_at = failed_at
  where id = fail_document_id
    and project_id = fail_project_id;

  update public.ai_jobs
  set status = 'failed',
      error_code = left(fail_error_code, 100),
      error_message = left(fail_error_message, 1000),
      claimed_at = null,
      lease_expires_at = null,
      completed_at = failed_at,
      updated_at = failed_at
  where id = job.id;
  return true;
end;
$$;

revoke all on function public.fail_document_job_attempt(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.fail_document_job_attempt(uuid, uuid, uuid, text, text) to service_role;

create or replace function public.claim_next_available_document_job()
returns setof public.ai_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  stale_job public.ai_jobs%rowtype;
  document_status public.document_processing_status;
  slots integer;
begin
  perform pg_advisory_xact_lock(hashtext('parse_document_claim_capacity'));

  for stale_job in
    select * from public.ai_jobs
    where job_type = 'parse_document' and status = 'processing'
      and coalesce(lease_expires_at, claimed_at + interval '5 minutes', created_at + interval '5 minutes') < now()
    for update skip locked
  loop
    select processing_status into document_status
    from public.documents
    where id = stale_job.document_id
    for update;

    if document_status in ('completed', 'needs_review') then
      update public.ai_jobs
      set status = 'completed', error_code = null, error_message = null,
          claimed_at = null, lease_expires_at = null,
          completed_at = coalesce(completed_at, now()), updated_at = now()
      where id = stale_job.id;
    elsif document_status = 'failed' then
      update public.ai_jobs set status = 'failed', error_code = coalesce(error_code, 'document_already_failed'),
        error_message = coalesce(error_message, 'The document was already in a terminal failed state.'),
        claimed_at = null, lease_expires_at = null, completed_at = coalesce(completed_at, now()), updated_at = now()
      where id = stale_job.id;
    elsif stale_job.attempt_count < stale_job.max_attempts then
      update public.ai_jobs set status = 'queued', error_code = 'worker_lease_expired',
        error_message = 'The previous processing attempt stopped before completion and was queued for retry.',
        claimed_at = null, lease_expires_at = null, available_at = now(), updated_at = now()
      where id = stale_job.id;
      update public.documents set processing_status = 'queued',
        processing_error = 'The previous processing attempt stopped. Retrying automatically.', updated_at = now()
      where id = stale_job.document_id and processing_status = 'processing';
    else
      update public.ai_jobs set status = 'failed', error_code = 'retry_limit_exceeded',
        error_message = 'Document analysis failed after the maximum number of attempts.',
        lease_expires_at = null, claimed_at = null, completed_at = now(), updated_at = now()
      where id = stale_job.id;
      update public.documents set processing_status = 'failed',
        processing_error = 'Document analysis failed after the maximum number of attempts.', updated_at = now()
      where id = stale_job.document_id and processing_status = 'processing';
    end if;
  end loop;

  select greatest(0, 2 - count(*))::integer into slots
  from public.ai_jobs where job_type = 'parse_document' and status = 'processing';

  return query
  with candidates as (
    select job.id
    from public.ai_jobs as job
    join public.documents as document
      on document.id = job.document_id
      and document.project_id = job.project_id
      and document.processing_status = 'queued'
    where job.job_type = 'parse_document'
      and job.status = 'queued'
      and job.available_at <= now()
    order by job.created_at, job.id
    limit least(slots, 1)
    for update of job, document skip locked
  ),
  claimed as (
    update public.ai_jobs as job
    set status = 'processing', attempt_count = job.attempt_count + 1,
        claimed_at = now(), lease_expires_at = now() + interval '15 minutes',
        error_code = null, error_message = null, updated_at = now(),
        metadata = job.metadata || jsonb_build_object('claimed_by', 'n8n', 'claimed_at', now())
    from candidates
    where job.id = candidates.id
    returning job.*
  ),
  synced_documents as (
    update public.documents as document
    set processing_status = 'processing', processing_error = null, updated_at = now()
    from claimed
    where document.id = claimed.document_id
      and document.project_id = claimed.project_id
    returning document.id
  )
  select claimed.* from claimed;
end;
$$;

revoke all on function public.claim_next_available_document_job() from public, anon, authenticated;
grant execute on function public.claim_next_available_document_job() to service_role;
