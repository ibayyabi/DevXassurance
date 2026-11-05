-- Ticket 05: the exact previous-current risk evidence is a reference snapshot,
-- not a post-claim client lookup. It participates in claim/finish/currentness and
-- in the existing reference invalidation path without replacing ticket 04's rule.

alter function public.assurance_reference_snapshot(uuid, uuid)
  rename to assurance_reference_snapshot_without_prior_risk_snapshot;
revoke all on function public.assurance_reference_snapshot_without_prior_risk_snapshot(uuid, uuid)
  from public, anon, authenticated;

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
  refs jsonb;
  success jsonb;
  attempt jsonb;
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
      refs := public.assurance_reference_snapshot(p_project_id, r.id);
    exception when others then
      refs := null;
    end;
    if refs is not null and r.status = 'analyzing'
      and attempt->>'outcome' = 'analyzing'
      and coalesce((attempt->>'lease_until')::timestamptz, '-infinity') > clock_timestamp()
      and attempt->>'reference_fingerprint' is not distinct from refs->>'fingerprint' then
      continue;
    end if;
    changed := success->>'id' is not null and
      success->>'reference_fingerprint' is distinct from refs->>'fingerprint';
    changed := changed or (r.status = 'analyzing' and attempt->>'outcome' = 'analyzing' and
      attempt->>'reference_fingerprint' is distinct from refs->>'fingerprint');
    if not changed then continue; end if;
    update public.assurance_reviews set status = 'evidence_ready', current_step = 'analysis',
      analysis_error = 'Approved comparison references changed. Run the analysis again.',
      approved_at = null, reviewed_by = null,
      analysis_metadata = analysis_metadata || jsonb_build_object(
        'reference_invalidation', jsonb_build_object(
          'reason', 'Approved comparison references changed', 'at', clock_timestamp()
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
  after insert or update of project_id, title, content_hash, processing_status,
    assurance_observation_parser_version, assurance_observation_contract_version or delete on public.documents
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
