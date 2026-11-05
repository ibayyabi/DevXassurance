-- Ticket 05: the exact previous-current risk evidence is a reference snapshot,
-- not a post-claim client lookup. It participates in claim/finish/currentness and
-- in the existing reference invalidation path without replacing ticket 04's rule.

alter function public.assurance_reference_snapshot(uuid, uuid)
  rename to assurance_reference_snapshot_without_prior_risk_snapshot;
revoke all on function public.assurance_reference_snapshot_without_prior_risk_snapshot(uuid, uuid)
  from public, anon, authenticated;
-- The claim holds the project lock before reading its review. Keep this source
-- snapshot MVCC-only: after-write invalidators acquire that same project lock,
-- so waiting on their already-mutated source rows here would deadlock.
create or replace function public.assurance_source_snapshot_without_observation_decisions(p_project_id uuid, p_review_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare sources jsonb; baseline uuid[]; current_ids uuid[];
begin
  if exists (
    select 1 from public.assurance_review_documents l
    left join public.documents d on d.id = l.document_id and d.project_id = p_project_id
    where l.review_id = p_review_id and (l.project_id <> p_project_id or d.id is null
      or d.processing_status not in ('completed', 'needs_review'))
  ) then raise exception 'Selected evidence is unavailable or not fully processed.'; end if;

  select array_agg(document_id order by document_id) filter (where evidence_role = 'baseline'),
    array_agg(document_id order by document_id) filter (where evidence_role = 'current')
    into baseline, current_ids from public.assurance_review_documents
    where review_id = p_review_id and project_id = p_project_id;
  if coalesce(cardinality(baseline), 0) = 0 or coalesce(cardinality(current_ids), 0) = 0
    then raise exception 'Select processed baseline and current evidence first.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'document_id', d.id, 'role', l.evidence_role, 'processing_status', d.processing_status,
    'title', d.title, 'file_name', d.file_name,
    'source_version', jsonb_build_object(
      'content_hash', d.content_hash,
      'parser_version', d.assurance_observation_parser_version,
      'contract_version', d.assurance_observation_contract_version
    ),
    'source', jsonb_build_object(
      'file_size', d.file_size, 'mime_type', d.mime_type,
      'storage_bucket', d.storage_bucket, 'storage_path', d.storage_path,
      'document_type', d.document_type, 'document_date', d.document_date,
      'confirmed_document_type', d.confirmed_document_type,
      'confirmed_document_date', d.confirmed_document_date,
      'confirmed_evidence_role', d.confirmed_evidence_role,
      'confirmed_reporting_period', d.confirmed_reporting_period,
      'confirmed_workstream', d.confirmed_workstream
    ),
    'storage_object', (select to_jsonb(o) - array['last_accessed_at', 'owner', 'owner_id']
      from storage.objects o where o.bucket_id = d.storage_bucket and o.name = d.storage_path),
    'chunks_fingerprint', encode(sha256(convert_to(coalesce((
      select jsonb_agg(to_jsonb(c) - 'created_at' order by c.chunk_index, c.id)
      from public.document_chunks c where c.document_id = d.id and c.project_id = p_project_id
    ), '[]'::jsonb)::text, 'UTF8')), 'hex'),
    'cost_observations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'project_id', o.project_id, 'document_id', o.document_id,
        'source_content_hash', o.source_content_hash, 'parser_version', o.parser_version,
        'contract_version', o.contract_version, 'measure', o.measure, 'source_value', o.source_value,
        'normalized_amount', o.normalized_amount, 'currency', o.currency,
        'scope_level', o.scope_level, 'scope_label', o.scope_label,
        'wbs_code', o.wbs_code, 'wbs_parent_code', o.wbs_parent_code,
        'wbs_name', o.wbs_name, 'scope_description', o.scope_description,
        'period_label', o.period_label, 'as_of_date', o.as_of_date,
        'status_label', o.status_label, 'evidence_chunk_index', o.evidence_chunk_index,
        'excerpt', o.excerpt, 'page_number', o.page_number, 'section_label', o.section_label,
        'provider', o.provider, 'model', o.model,
        'scope_source_id', o.scope_source_id, 'scope_provenance', o.scope_provenance,
        'source_location', o.source_location, 'observation_fingerprint', o.observation_fingerprint,
        'evidence_role', l.evidence_role
      ) order by o.measure, o.scope_label nulls first, o.evidence_chunk_index, o.id)
      from public.cost_observations o
      where o.project_id = p_project_id and o.document_id = d.id
        and o.source_content_hash = d.content_hash
        and o.parser_version = d.assurance_observation_parser_version
        and o.contract_version = d.assurance_observation_contract_version
    ), '[]'::jsonb),
    'assurance_observations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'domain', o.domain, 'observation_type', o.observation_type,
        'observation', o.observation, 'evidence_chunk_index', o.evidence_chunk_index,
        'excerpt', o.excerpt, 'page_number', o.page_number,
        'section_label', o.section_label, 'source_location', o.source_location
      ) order by o.domain, o.observation_type, o.evidence_chunk_index, o.id)
      from public.assurance_observations o
      where o.project_id = p_project_id and o.document_id = d.id
        and o.source_content_hash = d.content_hash
        and o.parser_version = d.assurance_observation_parser_version
        and o.contract_version = d.assurance_observation_contract_version
    ), '[]'::jsonb),
    'assurance_observation_coverage', (
      select jsonb_agg(jsonb_build_object(
        'domain', domains.domain,
        'state', coalesce(c.state, 'unprocessed'),
        'total_groups', coalesce(c.total_groups, 0),
        'processed_groups', coalesce(c.processed_groups, 0),
        'reason', coalesce(c.reason, 'No validated observation coverage exists for this source version; re-run extraction.')
      ) order by domains.domain)
      from unnest(array['budget', 'schedule', 'progress', 'risk']::text[]) domains(domain)
      left join public.assurance_observation_coverage c
        on c.project_id = p_project_id and c.document_id = d.id
        and c.source_content_hash = d.content_hash
        and c.parser_version = d.assurance_observation_parser_version
        and c.contract_version = d.assurance_observation_contract_version
        and c.domain = domains.domain
    )
  ) order by d.id), '[]'::jsonb) into sources
  from public.assurance_review_documents l
  join public.documents d on d.id = l.document_id and d.project_id = p_project_id
  where l.review_id = p_review_id and l.project_id = p_project_id;

  if jsonb_array_length(sources) <> cardinality(baseline || current_ids) or exists (
    select 1 from jsonb_array_elements(sources) x
    where x->>'processing_status' not in ('completed', 'needs_review')
      or x->'storage_object' = 'null'::jsonb
  ) then raise exception 'Selected evidence changed while reading its source.'; end if;

  return jsonb_build_object(
    'fingerprint', encode(sha256(convert_to(sources::text, 'UTF8')), 'hex'),
    'baseline_ids', to_jsonb(baseline), 'current_ids', to_jsonb(current_ids),
    'sources', sources
  );
end;
$$;
revoke all on function public.assurance_source_snapshot_without_observation_decisions(uuid, uuid)
  from public, anon, authenticated;

-- Durable worker writes also take the project lock before touching source rows
-- included in the locked reference snapshot (notably cost observations).
create or replace function public.assert_document_job_owner(owner_job_id uuid, owner_claim_token uuid)
returns void language plpgsql security definer set search_path = public as $$
declare job public.ai_jobs%rowtype;
begin
  if owner_claim_token is null then
    raise exception 'Ownership rejected: a claim token is required for every durable write.';
  end if;
  select * into job from public.ai_jobs where id = owner_job_id for update;
  if not found then raise exception 'Ownership rejected: document job was not found.'; end if;
  if job.claim_token is null or job.claim_token <> owner_claim_token then
    raise exception 'Ownership rejected: this attempt lost ownership of the job (stale claim token).';
  end if;
  if job.status <> 'processing' then
    raise exception 'Ownership rejected: job is %, not processing.', job.status;
  end if;
  if job.lease_expires_at is null or job.lease_expires_at < now() then
    raise exception 'Ownership rejected: the attempt lease has expired; ownership was revoked.';
  end if;
  perform 1 from public.projects where id = job.project_id for update;
  if not found then raise exception 'Ownership rejected: project was not found.'; end if;
end;
$$;
revoke all on function public.assert_document_job_owner(uuid, uuid) from public, anon, authenticated;
grant execute on function public.assert_document_job_owner(uuid, uuid) to service_role;

-- Observation decisions invalidate every analysis in the project. Acquire the
-- project lock before the original RPC reads/locks an observation or review.
alter function public.save_assurance_observation_decision(uuid, text, uuid, text, text, text, jsonb)
  rename to save_assurance_observation_decision_without_project_lock;
revoke all on function public.save_assurance_observation_decision_without_project_lock(uuid, text, uuid, text, text, text, jsonb)
  from public, anon, authenticated;
create function public.save_assurance_observation_decision(
  p_project_id uuid, p_target_type text, p_observation_id uuid,
  p_observation_fingerprint text, p_decision text, p_reason text, p_corrected jsonb default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare decision_id uuid;
begin
  if auth.uid() is null or not public.can_upload_project_evidence(p_project_id) then
    raise exception 'Your project role cannot review assurance evidence.';
  end if;
  perform 1 from public.projects where id = p_project_id for update;
  if not found then raise exception 'Project was not found.'; end if;
  return public.save_assurance_observation_decision_without_project_lock(
    p_project_id, p_target_type, p_observation_id, p_observation_fingerprint,
    p_decision, p_reason, p_corrected);
end;
$$;
revoke all on function public.save_assurance_observation_decision(uuid, text, uuid, text, text, text, jsonb)
  from public, anon;
grant execute on function public.save_assurance_observation_decision(uuid, text, uuid, text, text, text, jsonb)
  to authenticated;


create function public.assurance_prior_risk_snapshot(p_project_id uuid, p_review_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  current_review public.assurance_reviews%rowtype;
  previous_review public.assurance_reviews%rowtype;
  current_cutoff date;
  previous_cutoff date;
  nearest_count integer;
  linked_count integer;
  valid_linked_count integer;
  unknown_cutoffs jsonb;
  nearest_reviews jsonb;
  linked_sources jsonb;
  sources jsonb;
  decisions jsonb;
  prior jsonb;
  gap text;
begin
  perform 1 from public.projects where id = p_project_id for share;
  if not found then raise exception 'Project was not found.'; end if;
  -- Source/link writes acquire this project lock before their invalidation can
  -- commit; review-row edits are fenced by their post-write invalidation.
  select * into current_review from public.assurance_reviews r
    where r.id = p_review_id and r.project_id = p_project_id;
  if not found then raise exception 'Assurance review was not found in this project.'; end if;
  current_cutoff := case current_review.cutoff_precision
    when 'date' then current_review.reporting_period
    when 'month' then (date_trunc('month', current_review.reporting_period::timestamp)
      + interval '1 month - 1 day')::date
    else null end;
  if current_cutoff is null then
    prior := jsonb_build_object('current_cutoff', null, 'review', null, 'sources', '[]'::jsonb,
      'observation_decisions', '[]'::jsonb, 'gap_reason', 'current_review_cutoff_not_provable');
    return prior || jsonb_build_object('fingerprint', encode(sha256(convert_to(prior::text, 'UTF8')), 'hex'));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'reporting_period', r.reporting_period,
      'cutoff_precision', r.cutoff_precision) order by r.id), '[]'::jsonb)
    into unknown_cutoffs
    from public.assurance_reviews r
    where r.project_id = p_project_id and r.id <> p_review_id
      and r.status in ('findings_ready', 'report_draft', 'approved')
      and r.cutoff_precision not in ('date', 'month')
      and r.reporting_period <= current_review.reporting_period
      and exists (select 1 from public.assurance_review_documents l
        where l.project_id = p_project_id and l.review_id = r.id and l.evidence_role = 'current');
  if jsonb_array_length(unknown_cutoffs) > 0 then
    prior := jsonb_build_object('current_cutoff', current_cutoff, 'review', null, 'sources', '[]'::jsonb,
      'observation_decisions', '[]'::jsonb, 'gap_reason', 'prior_review_cutoff_not_provable',
      'unorderable_reviews', unknown_cutoffs);
    return prior || jsonb_build_object('fingerprint', encode(sha256(convert_to(prior::text, 'UTF8')), 'hex'));
  end if;

  select max(cutoff) into previous_cutoff from (
    select case r.cutoff_precision
      when 'date' then r.reporting_period
      when 'month' then (date_trunc('month', r.reporting_period::timestamp)
        + interval '1 month - 1 day')::date
      else null end as cutoff
    from public.assurance_reviews r
    where r.project_id = p_project_id and r.id <> p_review_id
      and r.status in ('findings_ready', 'report_draft', 'approved')
      and exists (select 1 from public.assurance_review_documents l
        where l.project_id = p_project_id and l.review_id = r.id and l.evidence_role = 'current')
  ) candidates
  where cutoff is not null and cutoff < current_cutoff;
  if previous_cutoff is null then
    prior := jsonb_build_object('current_cutoff', current_cutoff, 'review', null, 'sources', '[]'::jsonb,
      'observation_decisions', '[]'::jsonb, 'gap_reason', 'no_prior_current_review');
    return prior || jsonb_build_object('fingerprint', encode(sha256(convert_to(prior::text, 'UTF8')), 'hex'));
  end if;

  select count(*) into nearest_count from public.assurance_reviews r
  where r.project_id = p_project_id and r.id <> p_review_id
    and r.status in ('findings_ready', 'report_draft', 'approved')
    and case r.cutoff_precision
      when 'date' then r.reporting_period
      when 'month' then (date_trunc('month', r.reporting_period::timestamp)
        + interval '1 month - 1 day')::date
      else null end = previous_cutoff
    and exists (select 1 from public.assurance_review_documents l
      where l.project_id = p_project_id and l.review_id = r.id and l.evidence_role = 'current');
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'reporting_period', r.reporting_period,
      'cutoff_precision', r.cutoff_precision) order by r.id), '[]'::jsonb)
    into nearest_reviews
    from public.assurance_reviews r
    where r.project_id = p_project_id and r.id <> p_review_id
      and r.status in ('findings_ready', 'report_draft', 'approved')
      and case r.cutoff_precision
        when 'date' then r.reporting_period
        when 'month' then (date_trunc('month', r.reporting_period::timestamp)
          + interval '1 month - 1 day')::date
        else null end = previous_cutoff
      and exists (select 1 from public.assurance_review_documents l
        where l.project_id = p_project_id and l.review_id = r.id and l.evidence_role = 'current');
  if nearest_count <> 1 then
    prior := jsonb_build_object('current_cutoff', current_cutoff, 'review', null, 'sources', '[]'::jsonb,
      'observation_decisions', '[]'::jsonb, 'gap_reason', 'ambiguous_prior_review_cutoff',
      'nearest_reviews', nearest_reviews);
    return prior || jsonb_build_object('fingerprint', encode(sha256(convert_to(prior::text, 'UTF8')), 'hex'));
  end if;

  select r.* into previous_review from public.assurance_reviews r
  where r.project_id = p_project_id and r.id = (nearest_reviews->0->>'id')::uuid;
  select count(*), count(*) filter (where d.id is not null and d.content_hash is not null
      and d.assurance_observation_parser_version is not null
      and d.assurance_observation_contract_version is not null
      and d.processing_status in ('completed', 'needs_review'))
    into linked_count, valid_linked_count
    from public.assurance_review_documents l
    left join public.documents d on d.id = l.document_id and d.project_id = p_project_id
    where l.project_id = p_project_id and l.review_id = previous_review.id and l.evidence_role = 'current';
  select coalesce(jsonb_agg(jsonb_build_object(
      'project_id', l.project_id, 'review_id', l.review_id, 'document_id', l.document_id, 'evidence_role', l.evidence_role,
      'added_by', l.added_by,
      'document', case when d.id is null then null else jsonb_build_object(
        'id', d.id, 'project_id', d.project_id, 'title', d.title, 'content_hash', d.content_hash,
        'parser_version', d.assurance_observation_parser_version,
        'contract_version', d.assurance_observation_contract_version,
        'processing_status', d.processing_status) end
    ) order by l.document_id), '[]'::jsonb)
    into linked_sources
    from public.assurance_review_documents l
    left join public.documents d on d.id = l.document_id and d.project_id = p_project_id
    where l.project_id = p_project_id and l.review_id = previous_review.id and l.evidence_role = 'current';

  if linked_count = 0 then
    gap := 'prior_review_has_no_current_sources';
    sources := '[]'::jsonb;
    decisions := '[]'::jsonb;
  elsif valid_linked_count <> linked_count then
    gap := 'prior_source_version_unavailable';
    sources := '[]'::jsonb;
    decisions := '[]'::jsonb;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
        'project_id', d.project_id, 'document_id', d.id, 'role', 'current', 'title', d.title,
        'source_version', jsonb_build_object('content_hash', d.content_hash,
          'parser_version', d.assurance_observation_parser_version,
          'contract_version', d.assurance_observation_contract_version),
        'cost_observations', '[]'::jsonb,
        'assurance_observations', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', o.id, 'project_id', o.project_id, 'document_id', o.document_id,
            'source_content_hash', o.source_content_hash, 'parser_version', o.parser_version,
            'contract_version', o.contract_version, 'observation_fingerprint', o.observation_fingerprint,
            'domain', o.domain, 'observation_type', o.observation_type, 'observation', o.observation,
            'evidence_chunk_index', o.evidence_chunk_index, 'excerpt', o.excerpt,
            'page_number', o.page_number, 'section_label', o.section_label, 'source_location', o.source_location
          ) order by o.domain, o.observation_type, o.evidence_chunk_index, o.id)
          from public.assurance_observations o
          where o.project_id = p_project_id and o.document_id = d.id and o.domain = 'risk'
            and o.source_content_hash = d.content_hash
            and o.parser_version = d.assurance_observation_parser_version
            and o.contract_version = d.assurance_observation_contract_version
        ), '[]'::jsonb),
        'assurance_observation_coverage', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', c.id, 'project_id', c.project_id, 'document_id', c.document_id,
            'source_content_hash', c.source_content_hash, 'parser_version', c.parser_version,
            'contract_version', c.contract_version, 'domain', c.domain, 'state', c.state,
            'total_groups', c.total_groups, 'processed_groups', c.processed_groups, 'reason', c.reason
          ) order by c.id)
          from public.assurance_observation_coverage c
          where c.project_id = p_project_id and c.document_id = d.id and c.domain = 'risk'
            and c.source_content_hash = d.content_hash
            and c.parser_version = d.assurance_observation_parser_version
            and c.contract_version = d.assurance_observation_contract_version
        ), '[]'::jsonb)
      ) order by d.id), '[]'::jsonb)
      into sources
      from public.assurance_review_documents l
      join public.documents d on d.id = l.document_id and d.project_id = p_project_id
      where l.project_id = p_project_id and l.review_id = previous_review.id and l.evidence_role = 'current';

    select coalesce(jsonb_agg(jsonb_build_object(
        'id', dec.id, 'project_id', dec.project_id, 'target_type', dec.target_type, 'document_id', dec.document_id,
        'source_content_hash', dec.source_content_hash, 'parser_version', dec.parser_version,
        'contract_version', dec.contract_version, 'observation_fingerprint', dec.observation_fingerprint,
        'decision', dec.decision, 'corrected_observation', dec.corrected_observation,
        'reason', dec.reason, 'decided_by', dec.decided_by, 'decided_at', dec.decided_at,
        'observation_ids', matched.observation_ids
      ) order by dec.document_id, dec.observation_fingerprint, dec.id), '[]'::jsonb)
      into decisions
      from public.assurance_observation_decisions dec
      join public.documents d on d.id = dec.document_id and d.project_id = p_project_id
      cross join lateral (
        select coalesce(jsonb_agg(o.id order by o.id), '[]'::jsonb) as observation_ids
        from public.assurance_observations o
        where o.project_id = p_project_id and o.document_id = d.id and o.domain = 'risk'
          and o.source_content_hash = dec.source_content_hash
          and o.parser_version = dec.parser_version and o.contract_version = dec.contract_version
          and o.observation_fingerprint = dec.observation_fingerprint
      ) matched
      where dec.project_id = p_project_id and dec.target_type = 'assurance'
        and dec.document_id in (select l.document_id from public.assurance_review_documents l
          where l.project_id = p_project_id and l.review_id = previous_review.id and l.evidence_role = 'current')
        and dec.source_content_hash = d.content_hash
        and dec.parser_version = d.assurance_observation_parser_version
        and dec.contract_version = d.assurance_observation_contract_version
        and jsonb_array_length(matched.observation_ids) > 0;
    gap := null;
  end if;

  prior := jsonb_build_object(
    'current_cutoff', current_cutoff,
    'review', jsonb_build_object('id', previous_review.id, 'project_id', previous_review.project_id,
      'reporting_period', previous_review.reporting_period, 'cutoff_precision', previous_review.cutoff_precision,
      'status', 'eligible'),
    'sources', sources, 'observation_decisions', decisions, 'gap_reason', gap,
    'nearest_reviews', nearest_reviews, 'linked_sources', linked_sources
  );
  return prior || jsonb_build_object('fingerprint', encode(sha256(convert_to(prior::text, 'UTF8')), 'hex'));
end;
$$;
revoke all on function public.assurance_prior_risk_snapshot(uuid, uuid) from public, anon, authenticated;

create function public.assurance_reference_snapshot(p_project_id uuid, p_review_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare refs jsonb; prior jsonb; reference_values jsonb; reference_versions jsonb;
begin
  refs := public.assurance_reference_snapshot_without_prior_risk_snapshot(p_project_id, p_review_id);
  prior := public.assurance_prior_risk_snapshot(p_project_id, p_review_id);
  reference_values := coalesce(refs->'references', '{}'::jsonb) ||
    jsonb_build_object('prior_risk_snapshot', prior);
  reference_versions := coalesce(refs->'versions', '{}'::jsonb) || jsonb_build_object(
    'prior_risk_review_id', prior->'review'->'id',
    'prior_risk_fingerprint', prior->'fingerprint');
  return refs || jsonb_build_object(
    'fingerprint', encode(sha256(convert_to(jsonb_build_array(refs->>'fingerprint', prior->>'fingerprint')::text, 'UTF8')), 'hex'),
    'versions', reference_versions, 'references', reference_values,
    'prior_risk_snapshot', prior);
end;
$$;
revoke all on function public.assurance_reference_snapshot(uuid, uuid) from public, anon, authenticated;
-- A claim begun against the new reference fingerprint supersedes an older
-- successful result. Do not let that stale success invalidate the fresh claim
-- when the claim's row update invokes reference invalidation.
create or replace function public.invalidate_assurance_reference_results(p_project_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r record;
  source_snapshot jsonb;
  refs jsonb;
  success jsonb;
  attempt jsonb;
  source_changed boolean;
  reference_changed boolean;
  invalidation_reason text;
  changed boolean;
begin
  for r in
    select id, status, analysis_metadata from public.assurance_reviews
    where project_id = p_project_id and status in ('analyzing', 'findings_ready', 'report_draft', 'approved')
    order by id for update
  loop
    success := r.analysis_metadata->'last_success';
    attempt := r.analysis_metadata->'latest_attempt';
    if success->>'id' is null and not (
      r.status = 'analyzing' and attempt->>'outcome' = 'analyzing'
    ) then continue; end if;
    begin
      source_snapshot := public.assurance_source_snapshot(p_project_id, r.id);
      refs := public.assurance_reference_snapshot(p_project_id, r.id);
    exception when others then
      source_snapshot := null;
      refs := null;
    end;
    if source_snapshot is not null and refs is not null and r.status = 'analyzing'
      and attempt->>'outcome' = 'analyzing'
      and coalesce((attempt->>'lease_until')::timestamptz, '-infinity') > clock_timestamp()
      and attempt->>'fingerprint' is not distinct from source_snapshot->>'fingerprint'
      and attempt->>'reference_fingerprint' is not distinct from refs->>'fingerprint' then
      continue;
    end if;
    source_changed := success->>'id' is not null and success->>'fingerprint' is not null
      and success->>'fingerprint' is distinct from source_snapshot->>'fingerprint';
    source_changed := source_changed or (r.status = 'analyzing' and attempt->>'outcome' = 'analyzing'
      and attempt->>'fingerprint' is not null
      and attempt->>'fingerprint' is distinct from source_snapshot->>'fingerprint');
    reference_changed := success->>'id' is not null and success->>'reference_fingerprint' is not null
      and success->>'reference_fingerprint' is distinct from refs->>'fingerprint';
    reference_changed := reference_changed or (r.status = 'analyzing' and attempt->>'outcome' = 'analyzing'
      and attempt->>'reference_fingerprint' is not null
      and attempt->>'reference_fingerprint' is distinct from refs->>'fingerprint');
    changed := source_changed or reference_changed;
    if not changed then continue; end if;
    invalidation_reason := case when source_changed then 'Selected evidence changed'
      else 'Approved comparison references changed' end;
    update public.assurance_reviews set status = 'evidence_ready', current_step = 'analysis',
      analysis_error = invalidation_reason || '. Run the analysis again.',
      approved_at = null, reviewed_by = null,
      analysis_metadata = analysis_metadata || jsonb_build_object(
        'reference_invalidation', jsonb_build_object(
          'reason', invalidation_reason, 'at', clock_timestamp()
        )
      ) || case when attempt->>'outcome' = 'analyzing' then
        jsonb_build_object('latest_attempt', attempt || jsonb_build_object(
          'outcome', 'invalidated', 'finished_at', clock_timestamp()
        )) else '{}'::jsonb end,
      updated_at = clock_timestamp()
    where id = r.id and project_id = p_project_id;
  end loop;
end;
$$;
revoke all on function public.invalidate_assurance_reference_results(uuid) from public, anon, authenticated;
-- Prevent direct authenticated review updates from locking a review before the
-- project. Review mutations must use the project-first security-definer RPCs.
drop policy if exists "assurance_reviews_update_by_project_uploaders" on public.assurance_reviews;
-- Claims serialize on the project before they lock a review. This preserves the
-- reference-writer lock order and prevents two claims from locking each other's
-- review rows through project-wide invalidation.
create or replace function public.lock_assurance_review(p_project_id uuid, p_review_id uuid)
returns public.assurance_reviews
language plpgsql security definer set search_path = '' as $$
declare r public.assurance_reviews;
begin
  if auth.uid() is null or not exists (
    select 1 from public.project_members where project_id = p_project_id
      and user_id = auth.uid() and role in ('admin', 'pmc_consultant', 'project_manager')
  ) then raise exception 'Your project role cannot manage an assurance review.'; end if;
  perform 1 from public.projects where id = p_project_id for update;
  if not found then raise exception 'Project was not found.'; end if;
  select * into r from public.assurance_reviews
    where id = p_review_id and project_id = p_project_id for update;
  if not found then raise exception 'Assurance review was not found in this project.'; end if;
  return r;
end;
$$;
revoke all on function public.lock_assurance_review(uuid, uuid) from public, anon, authenticated;


-- Claim returns exactly the prior payload that its combined reference
-- fingerprint captured. No client query can race selection against publication.
create or replace function public.claim_assurance_analysis(p_project_id uuid, p_review_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.assurance_reviews; s jsonb; refs jsonb; attempt jsonb;
begin
  r := public.lock_assurance_review(p_project_id, p_review_id);
  if r.analysis_metadata->'latest_attempt'->>'outcome' = 'analyzing'
    and coalesce((r.analysis_metadata->'latest_attempt'->>'lease_until')::timestamptz, 'infinity') > clock_timestamp()
    then raise exception 'Analysis is already running for this review.'; end if;
  s := public.assurance_source_snapshot(p_project_id, p_review_id);
  refs := public.assurance_reference_snapshot(p_project_id, p_review_id);
  attempt := jsonb_build_object('id', gen_random_uuid(), 'outcome', 'analyzing',
    'started_at', clock_timestamp(), 'lease_until', clock_timestamp() + interval '15 minutes',
    'fingerprint', s->>'fingerprint', 'reference_fingerprint', refs->>'fingerprint',
    'reference_versions', refs->'versions');
  update public.assurance_reviews set status = 'analyzing', current_step = 'analysis', analysis_error = null,
    analysis_metadata = analysis_metadata || jsonb_build_object('latest_attempt', attempt,
      'selection_fingerprint', s->>'fingerprint',
      'selection_reference_fingerprint', refs->>'fingerprint',
      'selection_reference_versions', refs->'versions'), updated_at = clock_timestamp()
    where id = p_review_id and project_id = p_project_id;
  return s || jsonb_build_object('attempt_id', attempt->>'id',
    'reference_fingerprint', refs->>'fingerprint', 'reference_versions', refs->'versions',
    'progress_rag_rule', refs->'progress_rag_rule',
    'prior_risk_snapshot', refs->'prior_risk_snapshot');
end;
$$;
revoke all on function public.claim_assurance_analysis(uuid, uuid) from public, anon;
grant execute on function public.claim_assurance_analysis(uuid, uuid) to authenticated;

-- Prior-source changes share the project lock with the reference reader, then
-- invalidate only analyses whose recomputed references actually changed.
create function public.invalidate_assurance_prior_risk_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare project_ids uuid[]; project_id uuid;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op = 'DELETE' then
    project_ids := array[old.project_id];
  elsif tg_op = 'INSERT' then
    project_ids := array[new.project_id];
  elsif old.project_id is distinct from new.project_id then
    project_ids := array[least(old.project_id, new.project_id), greatest(old.project_id, new.project_id)];
  else
    project_ids := array[new.project_id];
  end if;
  foreach project_id in array project_ids loop
    if tg_table_name <> 'assurance_reviews' or tg_op = 'INSERT' then
      perform 1 from public.projects where id = project_id for update;
      if not found then continue; end if;
    end if;
    if tg_table_name = 'assurance_observation_decisions' then
      -- Keep ticket 03's specific decision reason before prior-risk reference
      -- invalidation makes the same result inactive.
      perform public.invalidate_assurance_observation_results(project_id);
    end if;
    perform public.invalidate_assurance_reference_results(project_id);
  end loop;
  return null;
end;
$$;
revoke all on function public.invalidate_assurance_prior_risk_change() from public, anon, authenticated;
grant execute on function public.invalidate_assurance_prior_risk_change() to service_role;

drop trigger if exists assurance_reviews_prior_risk_reference_change on public.assurance_reviews;
create trigger assurance_reviews_prior_risk_reference_change
  after insert or update or delete on public.assurance_reviews
  for each row execute function public.invalidate_assurance_prior_risk_change();
drop trigger if exists assurance_review_documents_prior_risk_reference_change on public.assurance_review_documents;
create trigger assurance_review_documents_prior_risk_reference_change
  after insert or update or delete on public.assurance_review_documents
  for each row execute function public.invalidate_assurance_prior_risk_change();
drop trigger if exists documents_prior_risk_reference_change on public.documents;
create trigger documents_prior_risk_reference_change
  after insert or update of id, project_id, title, file_name, file_size, mime_type,
    storage_bucket, storage_path, document_type, document_date, confirmed_document_type,
    confirmed_document_date, confirmed_evidence_role, confirmed_reporting_period, confirmed_workstream,
    content_hash, processing_status, assurance_observation_parser_version,
    assurance_observation_contract_version or delete on public.documents
  for each row execute function public.invalidate_assurance_prior_risk_change();
drop trigger if exists assurance_observations_prior_risk_reference_change on public.assurance_observations;
create trigger assurance_observations_prior_risk_reference_change
  after insert or update or delete on public.assurance_observations
  for each row execute function public.invalidate_assurance_prior_risk_change();
drop trigger if exists assurance_observation_coverage_prior_risk_reference_change on public.assurance_observation_coverage;
create trigger assurance_observation_coverage_prior_risk_reference_change
  after insert or update or delete on public.assurance_observation_coverage
  for each row execute function public.invalidate_assurance_prior_risk_change();
drop trigger if exists assurance_observation_decisions_prior_risk_reference_change on public.assurance_observation_decisions;
create trigger assurance_observation_decisions_prior_risk_reference_change
  after insert or update or delete on public.assurance_observation_decisions
  for each row execute function public.invalidate_assurance_prior_risk_change();
drop trigger if exists document_chunks_prior_risk_reference_change on public.document_chunks;
create trigger document_chunks_prior_risk_reference_change
  after insert or update or delete on public.document_chunks
  for each row execute function public.invalidate_assurance_prior_risk_change();
drop trigger if exists cost_observations_prior_risk_reference_change on public.cost_observations;
create trigger cost_observations_prior_risk_reference_change
  after insert or update or delete on public.cost_observations
  for each row execute function public.invalidate_assurance_prior_risk_change();

-- These rows are locked by reference snapshots; allow writes only through RPCs
-- that acquire the project lock before mutation.
revoke insert, update, delete on table public.cost_baselines, public.wbs_mappings,
  public.milestone_mappings, public.risk_identity_mappings, public.risk_scale_mappings
  from public, anon, authenticated;

create or replace function public.invalidate_assurance_storage_object_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare project_ids uuid[]; project_id uuid;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op = 'UPDATE' and
    (to_jsonb(old) - array['last_accessed_at', 'owner', 'owner_id'])
      is not distinct from
    (to_jsonb(new) - array['last_accessed_at', 'owner', 'owner_id']) then return null; end if;
  if tg_op = 'DELETE' then
    select array_agg(distinct d.project_id order by d.project_id) into project_ids
    from public.documents d where d.storage_bucket = old.bucket_id and d.storage_path = old.name;
  elsif tg_op = 'INSERT' then
    select array_agg(distinct d.project_id order by d.project_id) into project_ids
    from public.documents d where d.storage_bucket = new.bucket_id and d.storage_path = new.name;
  else
    select array_agg(distinct d.project_id order by d.project_id) into project_ids
    from public.documents d where (d.storage_bucket = old.bucket_id and d.storage_path = old.name)
      or (d.storage_bucket = new.bucket_id and d.storage_path = new.name);
  end if;
  foreach project_id in array coalesce(project_ids, '{}'::uuid[]) loop
    perform 1 from public.projects where id = project_id for update;
    if found then perform public.invalidate_assurance_reference_results(project_id); end if;
  end loop;
  return null;
end;
$$;
revoke all on function public.invalidate_assurance_storage_object_change() from public, anon, authenticated;
grant execute on function public.invalidate_assurance_storage_object_change() to service_role;

drop trigger if exists storage_objects_assurance_source_change on storage.objects;
create trigger storage_objects_assurance_source_change
  after insert or update or delete on storage.objects
  for each row execute function public.invalidate_assurance_storage_object_change();
