-- Requeue an expired attempt only if the exact job, claim, and lease read by
-- the caller are still current. The job lock serializes with renewal/reclaim;
-- the document lock serializes publication state and prevents duplicate jobs.
create or replace function public.retry_expired_document_job(
  retry_project_id uuid,
  retry_document_id uuid,
  expected_job_id uuid,
  expected_claim_token uuid,
  expected_lease_expires_at timestamptz
)
returns public.document_processing_status
language plpgsql
security definer
set search_path = public
as $$
declare
  current_job public.ai_jobs%rowtype;
  document_status public.document_processing_status;
  latest_job_id uuid;
  checked_at timestamptz;
  retry_error_message text;
  result_status public.document_processing_status;
begin
  perform 1
  from public.project_members
  where project_id = retry_project_id
    and user_id = auth.uid()
    and role in ('admin', 'pmc_consultant', 'project_manager')
  for share;
  if not found then
    raise exception 'Not authorized to retry document processing.';
  end if;
  if retry_project_id is null
    or retry_document_id is null
    or expected_job_id is null
    or expected_claim_token is null
    or expected_lease_expires_at is null then
    raise exception 'Expired lease retry requires the expected job, claim, and lease.';
  end if;

  select * into current_job
  from public.ai_jobs
  where id = expected_job_id
    and project_id = retry_project_id
    and document_id = retry_document_id
    and job_type = 'parse_document'
  for update;
  if not found then
    raise exception 'Expired lease retry rejected: the expected attempt is no longer current.';
  end if;
  if current_job.status <> 'processing'
    or current_job.claim_token is distinct from expected_claim_token
    or current_job.lease_expires_at is distinct from expected_lease_expires_at then
    raise exception 'Expired lease retry rejected: the expected attempt is no longer current.';
  end if;

  if exists (
    select 1
    from public.ai_jobs
    where project_id = retry_project_id
      and document_id = retry_document_id
      and job_type = 'parse_document'
      and id <> expected_job_id
      and status in ('queued', 'processing')
  ) then
    raise exception 'Expired lease retry rejected: another attempt is queued or processing.';
  end if;


  select processing_status into document_status
  from public.documents
  where id = retry_document_id
    and project_id = retry_project_id
  for update;
  if not found then
    raise exception 'Document was not found in this project.';
  end if;
  if document_status <> 'processing' then
    raise exception 'Expired lease retry rejected: the document is no longer processing.';
  end if;

  select id into latest_job_id
  from public.ai_jobs
  where project_id = retry_project_id
    and document_id = retry_document_id
    and job_type = 'parse_document'
  order by created_at desc, id desc
  limit 1;
  if latest_job_id is distinct from expected_job_id then
    raise exception 'Expired lease retry rejected: a newer attempt exists.';
  end if;


  checked_at := clock_timestamp();
  if current_job.lease_expires_at >= checked_at then
    raise exception 'Expired lease retry rejected: the expected lease has not expired.';
  end if;

  if current_job.attempt_count < current_job.max_attempts then
    retry_error_message := 'A project manager requeued this job after its recorded lease expired; this does not prove the worker stopped.';
    result_status := 'queued';
    update public.ai_jobs
    set status = result_status,
      error_code = 'manual_expired_lease_requeue',
      error_message = retry_error_message,
      claim_token = null,
      claimed_at = null,
      lease_expires_at = null,
      available_at = checked_at,
      completed_at = null,
      updated_at = checked_at
    where id = expected_job_id;
  else
    retry_error_message := 'The configured attempt limit was reached; the expired attempt was marked failed.';
    result_status := 'failed';
    update public.ai_jobs
    set status = result_status,
      error_code = 'retry_limit_exceeded',
      error_message = retry_error_message,
      claim_token = null,
      claimed_at = null,
      lease_expires_at = null,
      completed_at = checked_at,
      updated_at = checked_at
    where id = expected_job_id;
  end if;

  update public.documents
  set processing_status = result_status,
    processing_error = retry_error_message,
    updated_at = checked_at
  where id = retry_document_id
    and project_id = retry_project_id;

  return result_status;
end;
$$;

revoke all on function public.retry_expired_document_job(uuid, uuid, uuid, uuid, timestamptz) from public, anon;
grant execute on function public.retry_expired_document_job(uuid, uuid, uuid, uuid, timestamptz) to authenticated;

-- Keep the existing failed/completed retry behavior, but never let that path
-- cancel a queued or processing attempt that appeared since its caller read.
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
  document_status public.document_processing_status;
begin
  perform 1
  from public.project_members
  where project_id = retry_project_id
    and user_id = auth.uid()
    and role in ('admin', 'pmc_consultant', 'project_manager')
  for share;
  if not found then
    raise exception 'Not authorized to retry document processing.';
  end if;

  select processing_status into document_status
  from public.documents
  where id = retry_document_id
    and project_id = retry_project_id
  for update;
  if not found then
    raise exception 'Document was not found in this project.';
  end if;

  if document_status in ('queued', 'processing') then
    raise exception 'A queued or processing document cannot be replaced by a manual retry.';
  end if;

  if exists (
    select 1
    from public.ai_jobs
    where project_id = retry_project_id
      and document_id = retry_document_id
      and job_type = 'parse_document'
      and status in ('queued', 'processing')
  ) then
    raise exception 'A queued or processing attempt cannot be replaced by a failed-document retry.';
  end if;

  -- Discard the published and partial outputs of every terminal parse job
  -- this existing manual retry replaces, then mint a fresh queued job.
  perform public.discard_document_job_results(replaced.id)
  from public.ai_jobs as replaced
  where replaced.project_id = retry_project_id
    and replaced.document_id = retry_document_id
    and replaced.job_type = 'parse_document'
    and replaced.status in ('queued', 'processing', 'completed', 'failed');

  update public.ai_jobs
  set
    status = 'cancelled',
    error_code = 'superseded_by_manual_retry',
    error_message = 'This attempt was replaced by a manual retry.',
    claim_token = null,
    claimed_at = null,
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

revoke all on function public.retry_document_job(uuid, uuid) from public, anon;
grant execute on function public.retry_document_job(uuid, uuid) to authenticated;
