-- Ticket 01 (pmo-pipeline-robustness): fenced document job execution on top of
-- the phase6 intake contract. Every attempt carries a claim token that is
-- verified together with an unexpired lease inside the same transaction as any
-- durable write, so a stale or expired worker can neither extend a newer claim,
-- overwrite results, nor publish twice. Publication becomes one atomic
-- transaction binding every result table to the terminal job/document state.
-- Capacity limiting (advisory lock, two slots) and available_at backoff from
-- 202610180009/202610180010 are preserved and now guarded by attempt tokens.

alter table public.ai_jobs
  add column if not exists claim_token uuid;

-- Output lineage: every generated alert/action/anomaly is stamped with the
-- publishing job so a retry discards exactly its own outputs, even when the
-- caller supplied a custom source_path. Legacy rows keep the source_path
-- marker fallback.
alter table public.dashboard_critical_alerts
  add column if not exists ai_job_id uuid references public.ai_jobs(id) on delete set null;
alter table public.recommended_actions
  add column if not exists ai_job_id uuid references public.ai_jobs(id) on delete set null;
alter table public.anomalies
  add column if not exists ai_job_id uuid references public.ai_jobs(id) on delete set null;

create index if not exists dashboard_critical_alerts_ai_job_idx
  on public.dashboard_critical_alerts (ai_job_id) where ai_job_id is not null;
create index if not exists recommended_actions_ai_job_idx
  on public.recommended_actions (ai_job_id) where ai_job_id is not null;
create index if not exists anomalies_ai_job_idx
  on public.anomalies (ai_job_id) where ai_job_id is not null;

-- ---------------------------------------------------------------------------
-- Fenced claim with capacity and backoff (replaces the unfenced definition).
-- Repairs expired leases, then claims the oldest eligible queued parse job
-- within the concurrency budget and mints a fresh claim token for it.
-- ---------------------------------------------------------------------------
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
        claimed_at = now(), lease_expires_at = now() + interval '15 minutes',
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

revoke all on function public.claim_next_available_document_job() from public, anon, authenticated;
grant execute on function public.claim_next_available_document_job() to service_role;

-- ---------------------------------------------------------------------------
-- Fenced claim of one specific queued job (webhook entry point). Mints the same
-- attempt token and discards previous-attempt results in the same transaction.
-- It serializes on the same advisory capacity lock as the polling claim and
-- enforces the same active-job cap, so the webhook cannot bypass admission.
-- ---------------------------------------------------------------------------
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

  -- Same admission cap as the polling claim: at most two active parse jobs
  -- across every entry point, serialized on the shared advisory lock.
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
    lease_expires_at = now() + interval '15 minutes',
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

revoke all on function public.claim_document_job(uuid) from public, anon, authenticated;
grant execute on function public.claim_document_job(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Result cleanup shared by claim recovery and fenced completion. Removes only
-- published rows of the given job; worker-owned checkpoints (document_chunks,
-- document_extraction_groups, cost_observations) are never touched because a
-- retry must be able to reuse them. Runs inside the caller's transaction.
-- ---------------------------------------------------------------------------
create or replace function public.discard_document_job_results(discard_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.evidence_links
  where extracted_fact_id in (
    select fact.id
    from public.extracted_facts as fact
    join public.extraction_runs as run on run.id = fact.extraction_run_id
    where run.ai_job_id = discard_job_id
  );

  delete from public.extracted_facts
  where extraction_run_id in (
    select id from public.extraction_runs where ai_job_id = discard_job_id
  );

  delete from public.document_summary_sources
  where summary_id in (
    select id
    from public.document_summaries
    where metadata ->> 'job_id' = discard_job_id::text
  );

  delete from public.document_summaries
  where metadata ->> 'job_id' = discard_job_id::text;

  -- Explicit lineage wins: a row stamped with another job's ai_job_id is never
  -- removed by this job's cleanup, even if its source_path carries this job's
  -- legacy marker. The marker fallback only covers rows published before the
  -- lineage column existed.
  delete from public.dashboard_critical_alerts
  where ai_job_id = discard_job_id
    or (ai_job_id is null and source_path like '%job=' || discard_job_id::text || '%');

  delete from public.recommended_actions
  where ai_job_id = discard_job_id
    or (ai_job_id is null and source_path like '%job=' || discard_job_id::text || '%');

  delete from public.anomalies
  where ai_job_id = discard_job_id
    or (ai_job_id is null and source_path like '%job=' || discard_job_id::text || '%');

  delete from public.extraction_runs
  where ai_job_id = discard_job_id;
end;
$$;

revoke all on function public.discard_document_job_results(uuid) from public, anon, authenticated;
grant execute on function public.discard_document_job_results(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Fenced publication boundary. The claim token and an unexpired lease are
-- verified under a row lock before any durable write; the extraction run,
-- facts, evidence links, summary and sources, snapshots, alerts, actions, and
-- anomalies are written in one transaction together with the terminal
-- job/document state. Repeating the call after a lost response returns the same
-- outcome instead of duplicating results. Generated output rows carry a job
-- marker in source_path so a retry replaces exactly its own outputs.
-- ---------------------------------------------------------------------------
create or replace function public.complete_document_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.ai_jobs%rowtype;
  run_id uuid;
  summary_id uuid;
  fact jsonb;
  snapshot jsonb;
  alert jsonb;
  action_row jsonb;
  anomaly jsonb;
  fact_id uuid;
  fact_type_value text;
  fact_ordinal integer;
  link_chunk_id uuid;
  source_row jsonb;
  source_chunk_id uuid;
  final_status text;
  run_metadata jsonb;
  result_summary jsonb;
begin
  if p_job_id is null or p_claim_token is null or p_result is null
    or jsonb_typeof(p_result) <> 'object' then
    raise exception 'Publication rejected: job id, claim token, and a result object are required.';
  end if;

  select * into job
  from public.ai_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'Publication rejected: document job was not found.';
  end if;

  -- Idempotent completion: the same attempt repeating itself after a lost
  -- response observes its own terminal state instead of writing again.
  if job.status in ('completed', 'needs_review') and job.claim_token = p_claim_token then
    return jsonb_build_object('status', 'already_completed', 'job_id', job.id);
  end if;

  if job.claim_token is null or job.claim_token <> p_claim_token then
    raise exception 'Publication rejected: this attempt lost ownership of the job (stale claim token).';
  end if;

  if job.status <> 'processing' then
    raise exception 'Publication rejected: job is %, not processing.', job.status;
  end if;

  if job.lease_expires_at is null or job.lease_expires_at < now() then
    raise exception 'Publication rejected: the attempt lease has expired; ownership was revoked.';
  end if;

  if job.document_id is null or job.project_id is null then
    raise exception 'Publication rejected: job has no document to publish against.';
  end if;

  final_status := coalesce(p_result->>'processing_status', 'completed');
  if final_status not in ('completed', 'needs_review') then
    raise exception 'Publication rejected: processing_status must be completed or needs_review.';
  end if;

  if jsonb_typeof(p_result->'facts') <> 'array' then
    raise exception 'Publication rejected: facts array is required.';
  end if;

  result_summary := p_result->'summary';
  if jsonb_typeof(result_summary) = 'null' then
    result_summary := null;
  end if;
  if result_summary is not null and jsonb_typeof(result_summary) <> 'object' then
    raise exception 'Publication rejected: summary must be an object or null.';
  end if;

  if result_summary is not null
    and coalesce(result_summary->>'summary_text', '') = '' then
    raise exception 'Publication rejected: summary_text is required when a summary is present.';
  end if;

  -- Remove any published output from a previous attempt before writing the
  -- consistent version. Within this transaction readers observe either the
  -- previous state or the complete new one, never a mixture.
  perform public.discard_document_job_results(p_job_id);

  run_metadata := coalesce(p_result->'extraction_run_metadata', '{}'::jsonb)
    || jsonb_build_object(
      'source', 'n8n_document_processing',
      'worker', coalesce(p_result->>'worker', 'next_document_worker'),
      'fact_count', jsonb_array_length(p_result->'facts'),
      'published_at', now()
    );

  insert into public.extraction_runs (
    project_id,
    document_id,
    ai_job_id,
    status,
    metadata
  ) values (
    job.project_id,
    job.document_id,
    job.id,
    final_status::public.document_processing_status,
    run_metadata
  )
  on conflict (ai_job_id) do update
    set
      status = excluded.status,
      metadata = excluded.metadata,
      updated_at = now()
  returning id into run_id;

  for fact, fact_ordinal in
    select value, ord - 1
    from jsonb_array_elements(p_result->'facts') with ordinality as items(value, ord)
  loop
    fact_type_value := fact->>'fact_type';

    if fact_type_value not in ('risk', 'issue', 'milestone', 'decision', 'owner_action') then
      raise exception 'Publication rejected: unknown fact_type %.', fact_type_value;
    end if;

    if coalesce(fact->>'extracted_text', '') = '' then
      continue;
    end if;

    insert into public.extracted_facts (
      project_id,
      extraction_run_id,
      fact_type,
      extracted_text,
      original_value,
      confidence,
      confirmation_state
    ) values (
      job.project_id,
      run_id,
      fact_type_value::public.extracted_fact_type,
      fact->>'extracted_text',
      coalesce(nullif(fact->>'original_value', ''), fact->>'extracted_text'),
      least(greatest(coalesce((fact->>'confidence')::numeric, 0.65), 0), 1),
      'ai_extracted'
    )
    returning id into fact_id;

    link_chunk_id := null;
    if fact->>'evidence_chunk_index' is not null then
      select id into link_chunk_id
      from public.document_chunks
      where document_id = job.document_id
        and chunk_index = (fact->>'evidence_chunk_index')::integer;
    end if;

    insert into public.evidence_links (
      project_id,
      extracted_fact_id,
      document_id,
      document_chunk_id,
      excerpt,
      confidence
    ) values (
      job.project_id,
      fact_id,
      job.document_id,
      link_chunk_id,
      coalesce(
        nullif(fact->>'evidence_excerpt', ''),
        nullif(fact->>'excerpt', '')
      ),
      least(greatest(coalesce((fact->>'confidence')::numeric, 0.65), 0), 1)
    );
  end loop;

  if result_summary is not null then
    insert into public.document_summaries (
      project_id,
      summary_text,
      confidence,
      quality_warning,
      selected_document_ids,
      metadata
    ) values (
      job.project_id,
      result_summary->>'summary_text',
      least(greatest(coalesce((result_summary->>'confidence')::numeric, 0.65), 0), 1),
      result_summary->>'quality_warning',
      array[job.document_id],
      coalesce(result_summary->'metadata', '{}'::jsonb)
        || jsonb_build_object('job_id', job.id)
    )
    returning id into summary_id;

    if jsonb_typeof(p_result->'summary_sources') = 'array' then
      for source_row in
        select value
        from jsonb_array_elements(p_result->'summary_sources')
      loop
        source_chunk_id := null;
        if source_row->>'chunk_index' is not null then
          select id into source_chunk_id
          from public.document_chunks
          where document_id = job.document_id
            and chunk_index = (source_row->>'chunk_index')::integer;
        end if;

        insert into public.document_summary_sources (
          project_id,
          summary_id,
          document_id,
          document_chunk_id,
          excerpt,
          confidence
        ) values (
          job.project_id,
          summary_id,
          job.document_id,
          source_chunk_id,
          nullif(source_row->>'excerpt', ''),
          least(greatest(coalesce((source_row->>'confidence')::numeric,
            (result_summary->>'confidence')::numeric, 0.65), 0), 1)
        );
      end loop;
    end if;
  end if;

  if jsonb_typeof(p_result->'health_snapshots') = 'array' then
    for snapshot in
      select value
      from jsonb_array_elements(p_result->'health_snapshots')
    loop
      insert into public.dashboard_health_snapshots (
        project_id,
        dimension,
        score,
        status,
        evidence_coverage,
        status_text,
        snapshot_date,
        source_summary
      ) values (
        job.project_id,
        (snapshot->>'dimension')::public.health_dimension,
        nullif(snapshot->>'score', '')::numeric,
        (snapshot->>'status')::public.health_status,
        nullif(snapshot->>'evidence_coverage', '')::numeric,
        coalesce(nullif(snapshot->>'status_text', ''), 'Insufficient evidence'),
        coalesce(nullif(snapshot->>'snapshot_date', '')::date, (select document_date_hint from public.documents where id = job.document_id), current_date),
        coalesce(nullif(snapshot->>'source_summary', ''), (select title from public.documents where id = job.document_id))
      )
      on conflict (project_id, dimension, snapshot_date) do update
        set
          score = excluded.score,
          status = excluded.status,
          evidence_coverage = excluded.evidence_coverage,
          status_text = excluded.status_text,
          source_summary = excluded.source_summary;
    end loop;
  end if;

  if jsonb_typeof(p_result->'alerts') = 'array' then
    for alert in
      select value
      from jsonb_array_elements(p_result->'alerts')
    loop
      if coalesce(alert->>'explanation', '') = '' then
        continue;
      end if;

      insert into public.dashboard_critical_alerts (
        project_id,
        severity,
        impacted_area,
        explanation,
        evidence_count,
        recommended_action,
        source_path,
        ai_job_id
      ) values (
        job.project_id,
        coalesce(alert->>'severity', 'medium')::public.alert_severity,
        coalesce(alert->>'impacted_area', 'Document intelligence'),
        alert->>'explanation',
        greatest(coalesce((alert->>'evidence_count')::integer, 1), 0),
        coalesce(alert->>'recommended_action', 'Review the source document and assign an owner.'),
        coalesce(
          nullif(alert->>'source_path', ''),
          '/app/projects/' || job.project_id::text || '/documents?document=' || job.document_id::text || '&job=' || job.id::text
        ),
        job.id
      );
    end loop;
  end if;

  if jsonb_typeof(p_result->'actions') = 'array' then
    for action_row in
      select value
      from jsonb_array_elements(p_result->'actions')
    loop
      if coalesce(action_row->>'title', '') = '' then
        continue;
      end if;

      insert into public.recommended_actions (
        project_id,
        title,
        owner_name,
        due_date,
        priority,
        status,
        source_path,
        ai_job_id
      ) values (
        job.project_id,
        action_row->>'title',
        action_row->>'owner_name',
        nullif(action_row->>'due_date', '')::date,
        coalesce(action_row->>'priority', 'medium')::public.action_priority,
        coalesce(action_row->>'status', 'open')::public.action_status,
        coalesce(
          nullif(action_row->>'source_path', ''),
          '/app/projects/' || job.project_id::text || '/anomalies?job=' || job.id::text
        ),
        job.id
      );
    end loop;
  end if;

  if jsonb_typeof(p_result->'anomalies') = 'array' then
    for anomaly in
      select value
      from jsonb_array_elements(p_result->'anomalies')
    loop
      if coalesce(anomaly->>'title', '') = ''
        or coalesce(anomaly->>'explanation', '') = '' then
        continue;
      end if;

      insert into public.anomalies (
        project_id,
        category,
        missing_field,
        severity,
        status,
        title,
        affected_item,
        explanation,
        impact,
        impact_rating,
        recommended_action,
        suggested_owners,
        evidence_count,
        absence_type,
        rationale,
        source_path,
        ai_job_id
      ) values (
        job.project_id,
        coalesce(anomaly->>'category', 'risk')::public.anomaly_category,
        anomaly->>'missing_field',
        coalesce(anomaly->>'severity', 'medium')::public.alert_severity,
        coalesce(anomaly->>'status', 'open')::public.anomaly_status,
        anomaly->>'title',
        coalesce(nullif(anomaly->>'affected_item', ''), (select title from public.documents where id = job.document_id)),
        anomaly->>'explanation',
        coalesce(anomaly->>'impact', 'Evidence requires project assurance review.'),
        coalesce(anomaly->>'impact_rating', 'Medium'),
        coalesce(anomaly->>'recommended_action', 'Review the source evidence and assign an owner.'),
        coalesce(
          (
            select array_agg(value)
            from jsonb_array_elements_text(
              case
                when jsonb_typeof(anomaly->'suggested_owners') = 'array'
                  then anomaly->'suggested_owners'
                else '[]'::jsonb
              end
            )
          ),
          '{}'::text[]
        ),
        greatest(coalesce((anomaly->>'evidence_count')::integer, 1), 0),
        coalesce(anomaly->>'absence_type', 'not_applicable')::public.evidence_absence_type,
        coalesce(anomaly->>'rationale', 'Generated from document processing output.'),
        coalesce(
          nullif(anomaly->>'source_path', ''),
          '/app/projects/' || job.project_id::text || '/documents?document=' || job.document_id::text || '&job=' || job.id::text
        ),
        job.id
      );
    end loop;
  end if;

  -- The claim token is retained on the terminal job so the same attempt can
  -- verify itself when repeating the completion after a lost response.
  update public.ai_jobs
  set
    status = final_status::public.document_processing_status,
    error_code = null,
    error_message = null,
    lease_expires_at = null,
    completed_at = now(),
    updated_at = now()
  where id = job.id;

  update public.documents
  set
    processing_status = final_status::public.document_processing_status,
    processing_error = nullif(p_result->>'processing_error', ''),
    updated_at = now()
  where id = job.document_id;

  return jsonb_build_object(
    'status',
    'completed',
    'job_id',
    job.id,
    'document_id',
    job.document_id,
    'processing_status',
    final_status,
    'extraction_run_id',
    run_id,
    'summary_id',
    summary_id,
    'fact_count',
    jsonb_array_length(p_result->'facts')
  );
end;
$$;

revoke all on function public.complete_document_job(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.complete_document_job(uuid, uuid, jsonb) to service_role;


-- ---------------------------------------------------------------------------
-- Shared ownership predicate for every worker durable write. Locks the job row
-- FOR UPDATE and raises unless the attempt still holds a live claim: matching
-- claim token, processing status, and an unexpired lease. Called inside the
-- same transaction as the write it guards, so a stale attempt cannot slip a
-- checkpoint between verification and commit.
-- ---------------------------------------------------------------------------
create or replace function public.assert_document_job_owner(
  owner_job_id uuid,
  owner_claim_token uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.ai_jobs%rowtype;
begin
  -- A missing caller token is not a valid claim identity: reject it before any
  -- lock, write, or heartbeat side effect.
  if owner_claim_token is null then
    raise exception 'Ownership rejected: a claim token is required for every durable write.';
  end if;

  select * into job
  from public.ai_jobs
  where id = owner_job_id
  for update;

  if not found then
    raise exception 'Ownership rejected: document job was not found.';
  end if;

  if job.claim_token is null or job.claim_token <> owner_claim_token then
    raise exception 'Ownership rejected: this attempt lost ownership of the job (stale claim token).';
  end if;

  if job.status <> 'processing' then
    raise exception 'Ownership rejected: job is %, not processing.', job.status;
  end if;

  if job.lease_expires_at is null or job.lease_expires_at < now() then
    raise exception 'Ownership rejected: the attempt lease has expired; ownership was revoked.';
  end if;
end;
$$;

revoke all on function public.assert_document_job_owner(uuid, uuid) from public, anon, authenticated;
grant execute on function public.assert_document_job_owner(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Fenced failure: only the attempt that still owns the job (valid token and
-- unexpired lease) may record its failure. Repeating the same failure call is a
-- no-op; a completed job is never demoted.
-- ---------------------------------------------------------------------------
create or replace function public.fail_document_job_attempt(
  fail_job_id uuid,
  fail_project_id uuid,
  fail_document_id uuid,
  fail_claim_token uuid,
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

  if not found then
    return false;
  end if;

  if job.claim_token is null or job.claim_token <> fail_claim_token then
    return false;
  end if;

  if job.lease_expires_at is null or job.lease_expires_at < now() then
    return false;
  end if;

  update public.extraction_runs
  set
    status = 'failed',
    metadata = metadata || jsonb_build_object(
      'error_code', left(fail_error_code, 100),
      'error_message', left(fail_error_message, 1000),
      'failed_at', failed_at
    ),
    updated_at = failed_at
  where ai_job_id = job.id
    and project_id = job.project_id
    and document_id = job.document_id;

  update public.documents
  set
    processing_status = 'failed',
    processing_error = left(fail_error_message, 1000),
    updated_at = failed_at
  where id = job.document_id
    and project_id = job.project_id;

  update public.ai_jobs
  set
    status = 'failed',
    error_code = left(fail_error_code, 100),
    error_message = left(fail_error_message, 1000),
    claim_token = null,
    claimed_at = null,
    lease_expires_at = null,
    completed_at = failed_at,
    updated_at = failed_at
  where id = job.id;
  return true;
end;
$$;

revoke all on function public.fail_document_job_attempt(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.fail_document_job_attempt(uuid, uuid, uuid, uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Fenced transient retry: requeues with backoff only while the attempt still
-- owns the job (valid token and unexpired lease); otherwise returns null so a
-- stale attempt cannot force a requeue over a newer claim.
-- ---------------------------------------------------------------------------
create or replace function public.retry_document_job_attempt(
  retry_job_id uuid,
  retry_project_id uuid,
  retry_document_id uuid,
  retry_claim_token uuid,
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

  if not found then
    return null;
  end if;

  if job.claim_token is null or job.claim_token <> retry_claim_token then
    return null;
  end if;

  if job.lease_expires_at is null or job.lease_expires_at < now() then
    return null;
  end if;

  if not exists (
    select 1 from public.documents
    where id = retry_document_id and project_id = retry_project_id
      and processing_status = 'processing'
    for update
  ) then
    return null;
  end if;

  if job.attempt_count >= job.max_attempts then
    update public.ai_jobs
    set status = 'failed', error_code = 'retry_limit_exceeded',
        error_message = left(retry_error_message, 1000),
        claim_token = null, claimed_at = null, lease_expires_at = null,
        completed_at = now(), updated_at = now()
    where id = job.id;
    update public.documents
    set processing_status = 'failed',
        processing_error = left(retry_error_message, 1000), updated_at = now()
    where id = retry_document_id and project_id = retry_project_id
      and processing_status = 'processing';
    return 'failed';
  end if;

  perform public.discard_document_job_results(job.id);

  retry_at := now() + least(300, 15 * power(2, greatest(job.attempt_count - 1, 0))) * interval '1 second';
  update public.ai_jobs
  set status = 'queued', error_code = left(retry_error_code, 100),
      error_message = left(retry_error_message, 1000), available_at = retry_at,
      claim_token = null, claimed_at = null, lease_expires_at = null, updated_at = now()
  where id = job.id;
  update public.documents
  set processing_status = 'queued', processing_error = left(retry_error_message, 1000), updated_at = now()
  where id = retry_document_id and project_id = retry_project_id
    and processing_status = 'processing';
  return 'queued';
end;
$$;

revoke all on function public.retry_document_job_attempt(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.retry_document_job_attempt(uuid, uuid, uuid, uuid, text, text) to service_role;


-- ---------------------------------------------------------------------------
-- Fenced worker checkpoint writes. Every durable write of the worker goes
-- through one of these RPCs; ownership (claim token + live lease) is verified
-- by assert_document_job_owner inside the same transaction as the write, so a
-- stale attempt can no longer land a checkpoint before its lease is rejected.
-- ---------------------------------------------------------------------------

create or replace function public.save_document_chunks(
  p_job_id uuid,
  p_claim_token uuid,
  p_chunks jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.ai_jobs%rowtype;
  chunk jsonb;
  chunk_ordinal integer;
  saved integer := 0;
begin
  perform public.assert_document_job_owner(p_job_id, p_claim_token);

  select * into job from public.ai_jobs where id = p_job_id;

  if p_chunks is null or jsonb_typeof(p_chunks) <> 'array' then
    raise exception 'Chunk checkpoint rejected: chunks array is required.';
  end if;

  for chunk, chunk_ordinal in
    select value, ord - 1
    from jsonb_array_elements(p_chunks) with ordinality as items(value, ord)
  loop
    continue when coalesce(chunk->>'chunk_text', '') = '';

    insert into public.document_chunks (
      project_id,
      document_id,
      chunk_index,
      chunk_text,
      page_number,
      section_label,
      parser_metadata
    ) values (
      job.project_id,
      job.document_id,
      coalesce((chunk->>'chunk_index')::integer, chunk_ordinal),
      chunk->>'chunk_text',
      nullif(chunk->>'page_number', '')::integer,
      chunk->>'section_label',
      coalesce(chunk->'parser_metadata', jsonb_build_object('source', 'document_worker'))
    )
    on conflict (document_id, chunk_index) do update
      set
        chunk_text = excluded.chunk_text,
        page_number = excluded.page_number,
        section_label = excluded.section_label,
        parser_metadata = excluded.parser_metadata;
    saved := saved + 1;
  end loop;

  return saved;
end;
$$;

revoke all on function public.save_document_chunks(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_document_chunks(uuid, uuid, jsonb) to service_role;

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
    -- The worker sends JSON null for a failed group's result; jsonb null is
    -- normalized to SQL NULL so the checkpoint CHECK constraints accept the
    -- legitimate error payload instead of rejecting it.
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
    lease_expires_at = now() + interval '15 minutes',
    updated_at = now()
  where id = p_job_id;
end;
$$;

revoke all on function public.save_extraction_group(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_extraction_group(uuid, uuid, jsonb) to service_role;

create or replace function public.persist_cost_observations(
  p_job_id uuid,
  p_claim_token uuid,
  p_observations jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.ai_jobs%rowtype;
  observation jsonb;
  saved integer := 0;
begin
  perform public.assert_document_job_owner(p_job_id, p_claim_token);

  select * into job from public.ai_jobs where id = p_job_id;

  delete from public.cost_observations
  where project_id = job.project_id
    and document_id = job.document_id;

  if p_observations is null or jsonb_typeof(p_observations) <> 'array' then
    return 0;
  end if;

  for observation in
    select value
    from jsonb_array_elements(p_observations)
  loop
    insert into public.cost_observations (
      project_id,
      document_id,
      measure,
      source_value,
      normalized_amount,
      currency,
      scope_level,
      scope_label,
      wbs_code,
      wbs_parent_code,
      wbs_name,
      scope_description,
      period_label,
      as_of_date,
      status_label,
      evidence_chunk_index,
      excerpt,
      page_number,
      section_label,
      source_location,
      provider,
      model
    ) values (
      job.project_id,
      job.document_id,
      observation->>'measure',
      observation->>'source_value',
      nullif(observation->>'normalized_amount', '')::numeric,
      observation->>'currency',
      coalesce(nullif(observation->>'scope_level', ''), 'project'),
      observation->>'scope_label',
      observation->>'wbs_code',
      observation->>'wbs_parent_code',
      observation->>'wbs_name',
      observation->>'scope_description',
      observation->>'period_label',
      nullif(observation->>'as_of_date', '')::date,
      observation->>'status_label',
      (observation->>'evidence_chunk_index')::integer,
      observation->>'excerpt',
      nullif(observation->>'page_number', '')::integer,
      observation->>'section_label',
      observation->'source_location',
      observation->>'provider',
      observation->>'model'
    );
    saved := saved + 1;
  end loop;

  return saved;
end;
$$;

revoke all on function public.persist_cost_observations(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.persist_cost_observations(uuid, uuid, jsonb) to service_role;

create or replace function public.persist_document_suggestions(
  p_job_id uuid,
  p_claim_token uuid,
  p_suggestions jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.ai_jobs%rowtype;
begin
  perform public.assert_document_job_owner(p_job_id, p_claim_token);

  select * into job from public.ai_jobs where id = p_job_id;

  update public.documents
  set
    suggested_document_type = nullif(p_suggestions->>'suggested_document_type', '')::public.document_type,
    suggested_document_date = nullif(p_suggestions->>'suggested_document_date', '')::date,
    detected_reporting_period = nullif(p_suggestions->>'detected_reporting_period', '')::date,
    suggested_workstream = p_suggestions->>'suggested_workstream',
    suggested_evidence_role = p_suggestions->>'suggested_evidence_role',
    classification_confidence = nullif(p_suggestions->>'classification_confidence', '')::numeric,
    classification_reason = p_suggestions->>'classification_reason',
    updated_at = now()
  where id = job.document_id
    and project_id = job.project_id;
end;
$$;

revoke all on function public.persist_document_suggestions(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.persist_document_suggestions(uuid, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Fenced lease extension for long-running work. Only the current owner with an
-- unexpired lease can extend; an expired lease means ownership was already
-- lost and the next poll will repair the job.
-- ---------------------------------------------------------------------------
create or replace function public.extend_document_job_lease(
  p_job_id uuid,
  p_claim_token uuid,
  p_minutes integer default 15
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  new_expiry timestamptz;
begin
  if p_minutes is null or p_minutes < 1 or p_minutes > 30 then
    raise exception 'Lease extension must be between 1 and 30 minutes.';
  end if;

  update public.ai_jobs
  set
    lease_expires_at = now() + make_interval(mins => p_minutes),
    updated_at = now()
  where id = p_job_id
    and claim_token = p_claim_token
    and status = 'processing'
    and lease_expires_at is not null
    and lease_expires_at > now()
  returning lease_expires_at into new_expiry;

  if not found then
    raise exception 'Lease extension rejected: this attempt does not own the job or its lease expired.';
  end if;

  return new_expiry;
end;
$$;

revoke all on function public.extend_document_job_lease(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.extend_document_job_lease(uuid, uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Atomic job queueing for the upload finalize boundary. The document row
-- already exists (created at prepare time or during archive import); this call
-- inserts the queued parse job and flips the document in one transaction.
--
-- Replay vs re-upload: each queued job records the upload identity
-- (storage path + content hash) it was created for. A repeated finalize of the
-- SAME upload is a no-op even after its job reached a terminal state, while a
-- genuine re-upload of the document (prepare swapped in a new storage path /
-- content hash) always receives a fresh claimable job. An explicit retry
-- remains the only other path that creates attempts.
-- ---------------------------------------------------------------------------
create or replace function public.queue_document_parse_job(
  p_project_id uuid,
  p_document_id uuid,
  p_source text,
  p_job_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  document_row public.documents%rowtype;
  active_job_id uuid;
  latest_job_id uuid;
  latest_status text;
  recorded_upload_path text;
  new_job_id uuid;
begin
  if p_project_id is null or p_document_id is null then
    raise exception 'Project and document are required to queue processing.';
  end if;

  if auth.uid() is null or not public.can_upload_project_evidence(p_project_id) then
    raise exception 'Not authorized to queue document processing for this project.';
  end if;

  select * into document_row
  from public.documents
  where id = p_document_id
    and project_id = p_project_id
  for update;

  if not found then
    raise exception 'Document was not found in this project.';
  end if;

  -- An active job always wins: concurrent or repeated finalization observes it
  -- instead of queueing a duplicate.
  select id into active_job_id
  from public.ai_jobs
  where ai_jobs.document_id = document_row.id
    and job_type = 'parse_document'
    and status in ('queued', 'processing')
  order by created_at desc
  limit 1;

  if active_job_id is not null then
    return jsonb_build_object('job_id', active_job_id, 'queued', false);
  end if;

  -- Terminal history: replay only when the document's CURRENT upload identity
  -- matches the identity the latest job was created for. A re-upload swaps in
  -- a new storage path (and content hash) at prepare/finalize, so a mismatch
  -- is a genuine new upload that must receive a fresh claimable job.
  select id, status::text, metadata->>'upload_storage_path'
  into latest_job_id, latest_status, recorded_upload_path
  from public.ai_jobs
  where ai_jobs.document_id = document_row.id
    and job_type = 'parse_document'
  order by created_at desc
  limit 1;

  if latest_job_id is not null
    and latest_status in ('completed', 'needs_review', 'failed', 'cancelled')
    and coalesce(recorded_upload_path, '') = coalesce(document_row.storage_path, '') then
    return jsonb_build_object('job_id', latest_job_id, 'queued', false);
  end if;

  insert into public.ai_jobs (
    project_id,
    document_id,
    job_type,
    status,
    metadata
  ) values (
    p_project_id,
    document_row.id,
    'parse_document',
    'queued',
    coalesce(p_job_metadata, '{}'::jsonb)
      || jsonb_build_object(
        'source', coalesce(p_source, 'upload'),
        'upload_storage_path', document_row.storage_path,
        'upload_content_hash', document_row.content_hash
      )
  )
  returning id into new_job_id;

  update public.documents
  set
    processing_status = 'queued',
    processing_error = null,
    updated_at = now()
  where id = document_row.id;

  return jsonb_build_object('job_id', new_job_id, 'queued', true);
end;
$$;

revoke all on function public.queue_document_parse_job(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.queue_document_parse_job(uuid, uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Atomic archive-member intake: the document and its parse job are created as
-- one pair inside one transaction. Idempotent on storage_path (a concurrent or
-- repeated finalize returns the same pair instead of erroring), and rejects
-- non-members and cross-project storage paths before any write.
-- ---------------------------------------------------------------------------
create or replace function public.create_document_with_job(
  p_project_id uuid,
  p_submission_id uuid,
  p_archive_member_identity text,
  p_title text,
  p_file_name text,
  p_file_size bigint,
  p_mime_type text,
  p_storage_path text,
  p_document_type text,
  p_document_date date,
  p_process_automatically boolean,
  p_job_source text,
  p_job_metadata jsonb default '{}'::jsonb,
  p_content_hash text default null
)
returns table (
  document_id uuid,
  job_id uuid,
  queued boolean,
  created boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document_type public.document_type;
  existing_document public.documents%rowtype;
  new_document_id uuid;
  new_job_id uuid;
  active_job_id uuid;
begin
  if p_project_id is null or p_storage_path is null or p_file_name is null then
    raise exception 'Project, file name, and storage path are required.';
  end if;

  if auth.uid() is null or not public.can_upload_project_evidence(p_project_id) then
    raise exception 'Not authorized to upload evidence for this project.';
  end if;

  if split_part(p_storage_path, '/', 1) <> p_project_id::text then
    raise exception 'Storage path does not belong to the target project.';
  end if;

  v_document_type := coalesce(nullif(p_document_type, ''), 'unknown')::public.document_type;

  select * into existing_document
  from public.documents
  where storage_path = p_storage_path
  for update;

  if found then
    if existing_document.project_id <> p_project_id then
      raise exception 'Storage path does not belong to the target project.';
    end if;

    select id into active_job_id
    from public.ai_jobs
    where ai_jobs.document_id = existing_document.id
      and job_type = 'parse_document'
      and status in ('queued', 'processing')
    order by created_at
    limit 1;

    return query
      select existing_document.id, active_job_id, active_job_id is not null, false;
    return;
  end if;

  begin
    insert into public.documents (
      project_id,
      uploader_id,
      submission_id,
      archive_member_identity,
      document_type,
      title,
      file_name,
      file_size,
      mime_type,
      storage_path,
      document_date,
      processing_status,
      processing_error,
      content_hash
    ) values (
      p_project_id,
      auth.uid(),
      p_submission_id,
      p_archive_member_identity,
      v_document_type,
      p_title,
      p_file_name,
      p_file_size,
      p_mime_type,
      p_storage_path,
      p_document_date,
      case when p_process_automatically then 'queued'::public.document_processing_status else 'needs_review'::public.document_processing_status end,
      case
        when p_process_automatically then null
        else 'File retained as reference evidence; this format is not automatically analyzed.'
      end,
      -- Content identity crosses the atomic boundary: checkpoint readers only
      -- trust findings attributable to the document's current content.
      nullif(p_content_hash, '')
    )
    returning id into new_document_id;
  exception
    when unique_violation then
      -- A concurrent finalize won the race for this storage path; return its
      -- pair so the repeated call observes the same outcome, never an error.
      select * into existing_document
      from public.documents
      where storage_path = p_storage_path;

      select id into active_job_id
      from public.ai_jobs
      where ai_jobs.document_id = existing_document.id
        and job_type = 'parse_document'
        and status in ('queued', 'processing')
      order by created_at
      limit 1;

      return query
        select existing_document.id, active_job_id, active_job_id is not null, false;
      return;
  end;

  if p_process_automatically then
    insert into public.ai_jobs (
      project_id,
      document_id,
      job_type,
      status,
      metadata
    ) values (
      p_project_id,
      new_document_id,
      'parse_document',
      'queued',
      coalesce(p_job_metadata, '{}'::jsonb)
        || jsonb_build_object('source', coalesce(p_job_source, 'zip_import'))
    )
    returning id into new_job_id;

    return query
      select new_document_id, new_job_id, true, true;
  else
    return query
      select new_document_id, null::uuid, false, true;
  end if;
end;
$$;

revoke all on function public.create_document_with_job(uuid, uuid, text, text, text, bigint, text, text, text, date, boolean, text, jsonb, text) from public, anon;
grant execute on function public.create_document_with_job(uuid, uuid, text, text, text, bigint, text, text, text, date, boolean, text, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Manual retry cancels active attempts, revokes their claim tokens, discards
-- their published outputs, and queues a fresh job, atomically.
-- ---------------------------------------------------------------------------
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

  -- Discard the published and partial outputs of every parse job this retry
  -- replaces (including the terminal attempt that published them), then revoke
  -- the replaced attempts' claim tokens atomically. Without this, a retry
  -- republishes the same logical output alongside the previous one.
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

-- Cutover: the old unfenced claim paths are removed. In-flight workflow
-- executions that still call them fail loudly instead of bypassing fencing.
drop function if exists public.recover_and_fetch_document_job();
drop function if exists public.reset_document_job_results(uuid);
drop function if exists public.fail_document_job_attempt(uuid, uuid, uuid, text, text);
drop function if exists public.retry_document_job_attempt(uuid, uuid, uuid, text, text);
