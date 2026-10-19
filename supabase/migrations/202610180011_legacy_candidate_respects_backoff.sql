create or replace function public.recover_and_fetch_document_job()
returns setof public.ai_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  stale_job public.ai_jobs%rowtype;
begin
  for stale_job in
    select * from public.ai_jobs
    where job_type = 'parse_document' and status = 'processing'
      and coalesce(lease_expires_at, claimed_at + interval '5 minutes', created_at + interval '5 minutes') < now()
    for update skip locked
  loop
    if stale_job.attempt_count < stale_job.max_attempts then
      update public.ai_jobs
      set status = 'queued', error_code = 'worker_lease_expired',
          error_message = 'The previous processing attempt stopped before completion and was queued for retry.',
          claimed_at = null, lease_expires_at = null, updated_at = now(),
          metadata = metadata || jsonb_build_object(
            'last_recovered_at', now(),
            'last_recovery_reason', 'worker_lease_expired'
          )
      where id = stale_job.id;
      update public.documents
      set processing_status = 'queued',
          processing_error = 'The previous processing attempt stopped. Retrying automatically.',
          updated_at = now()
      where id = stale_job.document_id;
    else
      update public.ai_jobs
      set status = 'failed', error_code = 'retry_limit_exceeded',
          error_message = 'Document analysis failed after the maximum number of attempts.',
          claimed_at = null, lease_expires_at = null, completed_at = now(), updated_at = now()
      where id = stale_job.id;
      update public.documents
      set processing_status = 'failed',
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
    and job.available_at <= now()
  order by job.created_at
  limit 1
  for update skip locked;
end;
$$;

revoke all on function public.recover_and_fetch_document_job() from public, anon, authenticated;
grant execute on function public.recover_and_fetch_document_job() to service_role;
