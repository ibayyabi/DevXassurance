-- ticket/06-job-fencing-reliability: widen the parse-document lease window
-- from 15 to 30 minutes (the existing extend_document_job_lease cap).
--
-- Observed in the E2E Smart Building project: a 24-group XLSX extraction
-- failed with stale_claim_token even though its lease was still owned by the
-- same unfinished attempt. The 15-minute window only renews at claim time and
-- at each per-group checkpoint (save_extraction_group); a slow first group
-- (large document parse + a slow/retried provider call before the first
-- checkpoint lands) can outlast 15 minutes with no renewal in between, so the
-- next poll's stale-lease recovery in claim_next_available_document_job
-- requeues the job out from under the still-running attempt. That attempt's
-- later checkpoint or publication is then correctly rejected as a stale
-- claim token -- the fencing itself is not wrong, the window was too tight.
--
-- This migration only widens the window to the already-approved 30-minute
-- maximum; it changes no fencing rule, no table shape, and no caller
-- contract. The corresponding worker change raises its initial
-- extend_document_job_lease call from 15 to 30 minutes to match.

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
      and coalesce(lease_expires_at, claimed_at + interval '30 minutes', created_at + interval '30 minutes') < now()
    for update skip locked
  loop
    select processing_status into document_status
    from public.documents
    where id = stale_job.document_id
    for update;

    if document_status in ('completed', 'needs_review') then
      update public.ai_jobs
      set status = 'completed', error_code = null, error_message = null,
          claim_token = null, claimed_at = null, lease_expires_at = null,
          completed_at = coalesce(completed_at, now()), updated_at = now()
      where id = stale_job.id;
    elsif document_status = 'failed' then
      update public.ai_jobs set status = 'failed', error_code = coalesce(error_code, 'document_already_failed'),
        error_message = coalesce(error_message, 'The document was already in a terminal failed state.'),
        claim_token = null, claimed_at = null, lease_expires_at = null,
        completed_at = coalesce(completed_at, now()), updated_at = now()
      where id = stale_job.id;
    elsif stale_job.attempt_count < stale_job.max_attempts then
      perform public.discard_document_job_results(stale_job.id);

      update public.ai_jobs set status = 'queued', error_code = 'worker_lease_expired',
        error_message = 'The previous processing attempt stopped before completion and was queued for retry.',
        claim_token = null, claimed_at = null, lease_expires_at = null, available_at = now(), updated_at = now()
      where id = stale_job.id;
      update public.documents set processing_status = 'queued',
        processing_error = 'The previous processing attempt stopped. Retrying automatically.', updated_at = now()
      where id = stale_job.document_id and processing_status = 'processing';
    else
      update public.ai_jobs set status = 'failed', error_code = 'retry_limit_exceeded',
        error_message = 'Document analysis failed after the maximum number of attempts.',
        claim_token = null, lease_expires_at = null, claimed_at = null, completed_at = now(), updated_at = now()
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
        claim_token = gen_random_uuid(),
        claimed_at = now(), lease_expires_at = now() + interval '30 minutes',
        error_code = null, error_message = null, completed_at = null, updated_at = now(),
        metadata = job.metadata || jsonb_build_object('claimed_by', 'n8n', 'claim_issued_at', now())
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

create or replace function public.claim_document_job(p_job_id uuid)
returns setof public.ai_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_job public.ai_jobs%rowtype;
  document_status public.document_processing_status;
  slots integer;
begin
  if p_job_id is null then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('parse_document_claim_capacity'));

  select greatest(0, 2 - count(*))::integer into slots
  from public.ai_jobs where job_type = 'parse_document' and status = 'processing';

  if slots < 1 then
    return;
  end if;

  select * into claimed_job
  from public.ai_jobs
  where id = p_job_id
    and job_type = 'parse_document'
    and status = 'queued'
    and available_at <= now()
  for update skip locked;

  if not found then
    return;
  end if;

  select processing_status into document_status
  from public.documents
  where id = claimed_job.document_id
  for update;

  if document_status is distinct from 'queued' then
    return;
  end if;

  perform public.discard_document_job_results(claimed_job.id);

  update public.ai_jobs
  set
    status = 'processing',
    attempt_count = attempt_count + 1,
    claim_token = gen_random_uuid(),
    claimed_at = now(),
    lease_expires_at = now() + interval '30 minutes',
    error_code = null,
    error_message = null,
    completed_at = null,
    updated_at = now(),
    metadata = metadata || jsonb_build_object(
      'claimed_by', 'n8n',
      'claim_issued_at', now(),
      'attempt_count', attempt_count + 1
    )
  where id = claimed_job.id
  returning * into claimed_job;

  update public.documents
  set
    processing_status = 'processing',
    processing_error = null,
    updated_at = now()
  where id = claimed_job.document_id;

  return query select claimed_job.*;
end;
$$;

create or replace function public.save_extraction_group(
  p_job_id uuid,
  p_claim_token uuid,
  p_group jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.ai_jobs%rowtype;
  group_status text;
begin
  perform public.assert_document_job_owner(p_job_id, p_claim_token);

  select * into job from public.ai_jobs where id = p_job_id;

  group_status := p_group->>'status';
  if group_status not in ('completed', 'failed') then
    raise exception 'Extraction group checkpoint rejected: status must be completed or failed.';
  end if;

  insert into public.document_extraction_groups (
    project_id,
    document_id,
    group_key,
    content_hash,
    parser_version,
    schema_version,
    group_index,
    chunk_start_index,
    chunk_end_index,
    status,
    result,
    attempt_count,
    provider,
    model,
    last_error
  ) values (
    job.project_id,
    job.document_id,
    p_group->>'group_key',
    p_group->>'content_hash',
    p_group->>'parser_version',
    p_group->>'schema_version',
    coalesce((p_group->>'group_index')::integer, 0),
    (p_group->>'chunk_start_index')::integer,
    (p_group->>'chunk_end_index')::integer,
    group_status,
    case when jsonb_typeof(p_group->'result') = 'null' then null else p_group->'result' end,
    greatest(coalesce((p_group->>'attempt_count')::integer, 1), 0),
    p_group->>'provider',
    p_group->>'model',
    case
      when jsonb_typeof(p_group->'last_error') = 'null' then null
      else left(p_group->>'last_error', 1000)
    end
  )
  on conflict (document_id, group_key) do update
    set
      content_hash = excluded.content_hash,
      parser_version = excluded.parser_version,
      schema_version = excluded.schema_version,
      group_index = excluded.group_index,
      chunk_start_index = excluded.chunk_start_index,
      chunk_end_index = excluded.chunk_end_index,
      status = excluded.status,
      result = excluded.result,
      attempt_count = excluded.attempt_count,
      provider = excluded.provider,
      model = excluded.model,
      last_error = excluded.last_error,
      updated_at = now();

  -- Checkpoint and heartbeat commit atomically: a group write either lands
  -- together with a renewed lease, or the stale attempt is rejected whole.
  update public.ai_jobs
  set
    lease_expires_at = now() + interval '30 minutes',
    updated_at = now()
  where id = p_job_id;
end;
$$;
