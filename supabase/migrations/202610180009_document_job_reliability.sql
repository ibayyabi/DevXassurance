alter table public.ai_jobs
  add column if not exists available_at timestamptz not null default now();

create or replace function public.retry_document_job_attempt(
  retry_job_id uuid,
  retry_project_id uuid,
  retry_document_id uuid,
  retry_error_code text,
  retry_error_message text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.ai_jobs%rowtype;
  retry_at timestamptz;
begin
  select * into job
  from public.ai_jobs
  where id = retry_job_id
    and project_id = retry_project_id
    and document_id = retry_document_id
    and job_type = 'parse_document'
    and status = 'processing'
  for update;

  if not found then return null; end if;
  if not exists (
    select 1 from public.documents
    where id = retry_document_id and project_id = retry_project_id
      and processing_status = 'processing'
    for update
  ) then return null; end if;
  if job.attempt_count >= job.max_attempts then
    update public.ai_jobs
    set status = 'failed', error_code = 'retry_limit_exceeded',
        error_message = left(retry_error_message, 1000), lease_expires_at = null,
        claimed_at = null, completed_at = now(), updated_at = now()
    where id = job.id;
    update public.documents
    set processing_status = 'failed',
        processing_error = left(retry_error_message, 1000), updated_at = now()
    where id = retry_document_id and project_id = retry_project_id
      and processing_status = 'processing';
    return 'failed';
  end if;

  retry_at := now() + least(300, 15 * power(2, greatest(job.attempt_count - 1, 0))) * interval '1 second';
  update public.ai_jobs
  set status = 'queued', error_code = left(retry_error_code, 100),
      error_message = left(retry_error_message, 1000), available_at = retry_at,
      claimed_at = null, lease_expires_at = null, updated_at = now()
  where id = job.id;
  update public.documents
  set processing_status = 'queued', processing_error = left(retry_error_message, 1000), updated_at = now()
  where id = retry_document_id and project_id = retry_project_id
    and processing_status = 'processing';
  return 'queued';
end;
$$;

revoke all on function public.retry_document_job_attempt(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.retry_document_job_attempt(uuid, uuid, uuid, text, text) to service_role;

