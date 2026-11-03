-- Ticket 04: progress comparisons require a period-specific, auditable source choice.

create table public.assurance_progress_decisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  review_id uuid not null references public.assurance_reviews(id) on delete cascade,
  group_key text not null check (group_key ~ '^[0-9a-f]{64}$'),
  period_key text not null check (period_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  role text not null check (role in ('baseline', 'current')),
  candidate_fingerprint text not null check (candidate_fingerprint ~ '^[0-9a-f]{64}$'),
  selected_source_key text not null check (selected_source_key ~ '^[0-9a-f]{64}$'),
  selected_observation_id uuid not null,
  selected_document_id uuid not null,
  source_content_hash text not null check (source_content_hash ~ '^[0-9a-f]{64}$'),
  parser_version text not null,
  contract_version text not null,
  evidence_chunk_index integer not null check (evidence_chunk_index >= 0),
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  decided_by uuid not null,
  decided_at timestamptz not null default clock_timestamp()
);

create index assurance_progress_decisions_review_idx
  on public.assurance_progress_decisions (project_id, review_id, decided_at, id);

alter table public.assurance_progress_decisions enable row level security;
revoke all on table public.assurance_progress_decisions from anon, authenticated;
grant select on table public.assurance_progress_decisions to authenticated;
create policy "assurance_progress_decisions_read_by_project_members"
  on public.assurance_progress_decisions for select to authenticated
  using (public.is_project_member(project_id));

create function public.assurance_progress_decisions_snapshot(p_project_id uuid, p_review_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare decisions jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id,
    'groupKey', d.group_key,
    'periodKey', d.period_key,
    'role', d.role,
    'candidateFingerprint', d.candidate_fingerprint,
    'selectedSourceKey', d.selected_source_key,
    'selectedObservationId', d.selected_observation_id,
    'selectedDocumentId', d.selected_document_id,
    'sourceContentHash', d.source_content_hash,
    'parserVersion', d.parser_version,
    'contractVersion', d.contract_version,
    'evidenceChunkIndex', d.evidence_chunk_index,
    'reason', d.reason,
    'decidedBy', d.decided_by,
    'decidedAt', d.decided_at
  ) order by d.decided_at, d.id), '[]'::jsonb)
  into decisions
  from public.assurance_progress_decisions d
  where d.project_id = p_project_id and d.review_id = p_review_id;

  return jsonb_build_object(
    'fingerprint', encode(sha256(convert_to(decisions::text, 'UTF8')), 'hex'),
    'decisions', decisions
  );
end;
$$;
revoke all on function public.assurance_progress_decisions_snapshot(uuid, uuid) from public, anon, authenticated;

-- Wrap the existing versioned evidence snapshot so claim/current/finish all
-- fingerprint the complete reviewer-decision history without changing callers.
alter function public.assurance_source_snapshot(uuid, uuid)
  rename to assurance_source_snapshot_without_progress_decisions;
revoke all on function public.assurance_source_snapshot_without_progress_decisions(uuid, uuid)
  from public, anon, authenticated;

create function public.assurance_source_snapshot(p_project_id uuid, p_review_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare source_snapshot jsonb; decision_snapshot jsonb;
begin
  source_snapshot := public.assurance_source_snapshot_without_progress_decisions(p_project_id, p_review_id);
  decision_snapshot := public.assurance_progress_decisions_snapshot(p_project_id, p_review_id);
  return source_snapshot || jsonb_build_object(
    'fingerprint', encode(sha256(convert_to(jsonb_build_array(
      source_snapshot->>'fingerprint', decision_snapshot->>'fingerprint'
    )::text, 'UTF8')), 'hex'),
    'progress_decisions', decision_snapshot->'decisions'
  );
end;
$$;
revoke all on function public.assurance_source_snapshot(uuid, uuid) from public, anon, authenticated;

create function public.save_assurance_progress_decision(
  p_project_id uuid,
  p_review_id uuid,
  p_group_key text,
  p_period_key text,
  p_candidate_fingerprint text,
  p_selected_source_key text,
  p_selected_observation_id uuid,
  p_role text,
  p_reason text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.assurance_reviews; decision_id uuid; selected_observation public.assurance_observations%rowtype;
begin
  if auth.uid() is null or not public.can_upload_project_evidence(p_project_id) then
    raise exception 'Your project role cannot resolve progress conflicts.';
  end if;
  perform 1 from public.projects where id = p_project_id for share;
  if not found then raise exception 'Project was not found.'; end if;
  select * into r from public.assurance_reviews
    where id = p_review_id and project_id = p_project_id for update;
  if not found then raise exception 'Assurance review was not found in this project.'; end if;
  if p_group_key is null or p_group_key !~ '^[0-9a-f]{64}$'
    or p_period_key is null or p_period_key !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    or p_candidate_fingerprint is null or p_candidate_fingerprint !~ '^[0-9a-f]{64}$'
    or p_selected_source_key is null or p_selected_source_key !~ '^[0-9a-f]{64}$'
    or p_selected_observation_id is null
    or p_role is null or p_role not in ('baseline', 'current')
    or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'A valid progress source, period, role, and decision reason are required.';
  end if;
  if not public.assurance_analysis_is_current(p_project_id, p_review_id) then
    raise exception 'Run analysis on the current evidence before resolving a progress conflict.';
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(case
      when jsonb_typeof(r.analysis_metadata->'progress_observations') = 'array'
        then r.analysis_metadata->'progress_observations'
      else '[]'::jsonb end) scope(value)
    cross join lateral jsonb_array_elements(case
      when jsonb_typeof(scope.value->'conflicts') = 'array' then scope.value->'conflicts'
      else '[]'::jsonb end) conflict(value)
    cross join lateral jsonb_array_elements(case
      when jsonb_typeof(conflict.value->'candidates') = 'array' then conflict.value->'candidates'
      else '[]'::jsonb end) candidate(value)
    cross join lateral jsonb_array_elements(case
      when jsonb_typeof(candidate.value->'observations') = 'array' then candidate.value->'observations'
      else '[]'::jsonb end) observation(value)
    where conflict.value->>'groupKey' = p_group_key
      and conflict.value->>'periodKey' = p_period_key
      and conflict.value->>'candidateFingerprint' = p_candidate_fingerprint
      and conflict.value->>'role' = p_role
      and candidate.value->>'sourceKey' = p_selected_source_key
      and observation.value->'sourceRef'->>'observationId' = p_selected_observation_id::text
  ) then
    raise exception 'Selected source is not one of the current conflict alternatives.';
  end if;

  select o.* into selected_observation
  from public.assurance_observations o
  join public.documents d on d.id = o.document_id and d.project_id = p_project_id
  join public.assurance_review_documents l
    on l.document_id = d.id and l.project_id = p_project_id and l.review_id = p_review_id
  where o.id = p_selected_observation_id and o.project_id = p_project_id
    and o.domain = 'progress' and o.observation_type = 'progress'
    and l.evidence_role = p_role
    and d.processing_status in ('completed', 'needs_review')
    and o.source_content_hash = d.content_hash
    and o.parser_version = d.assurance_observation_parser_version
    and o.contract_version = d.assurance_observation_contract_version
  for share of o;
  if not found then
    raise exception 'Selected progress observation is no longer current evidence for this review.';
  end if;

  insert into public.assurance_progress_decisions (
    project_id, review_id, group_key, period_key, role, candidate_fingerprint,
    selected_source_key, selected_observation_id, selected_document_id,
    source_content_hash, parser_version, contract_version, evidence_chunk_index,
    reason, decided_by
  ) values (
    p_project_id, p_review_id, p_group_key, p_period_key, p_role,
    p_candidate_fingerprint, p_selected_source_key, p_selected_observation_id,
    selected_observation.document_id, selected_observation.source_content_hash,
    selected_observation.parser_version, selected_observation.contract_version,
    selected_observation.evidence_chunk_index, btrim(p_reason), auth.uid()
  ) returning id into decision_id;

  update public.assurance_reviews set status = 'evidence_ready', current_step = 'analysis',
    analysis_error = null, approved_at = null, reviewed_by = null,
    analysis_metadata = analysis_metadata || case
      when analysis_metadata->'latest_attempt'->>'outcome' = 'analyzing' then
        jsonb_build_object('latest_attempt', analysis_metadata->'latest_attempt' ||
          jsonb_build_object('outcome', 'invalidated', 'finished_at', clock_timestamp()))
      else '{}'::jsonb end,
    updated_at = clock_timestamp()
  where id = p_review_id and project_id = p_project_id;
  return decision_id;
end;
$$;
revoke all on function public.save_assurance_progress_decision(uuid, uuid, text, text, text, text, uuid, text, text)
  from public, anon;
grant execute on function public.save_assurance_progress_decision(uuid, uuid, text, text, text, text, uuid, text, text)
  to authenticated;
 
-- Publish result metadata in the same transaction as findings so a visible
-- current analysis never carries stale progress candidates.
create function public.finish_assurance_analysis_with_results(
  p_project_id uuid,
  p_review_id uuid,
  p_attempt_id uuid,
  p_findings jsonb,
  p_actions jsonb default '[]',
  p_metadata jsonb default '{}',
  p_result_metadata jsonb default '{}'
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare published boolean;
begin
  if jsonb_typeof(coalesce(p_result_metadata, '{}'::jsonb)) is distinct from 'object' then
    raise exception 'Analysis result metadata must be an object.';
  end if;
  if exists (
    select 1 from jsonb_object_keys(coalesce(p_result_metadata, '{}'::jsonb)) as result_keys(key)
    where key not in (
      'wbs_budget_findings', 'wbs_scope_candidates',
      'schedule_milestone_comparisons', 'schedule_milestone_labels',
      'progress_observations', 'progress_source_observations',
      'risk_item_findings', 'risk_unidentified_items', 'risk_source_ids', 'risk_source_scales'
    )
  ) then
    raise exception 'Analysis result metadata contains an unsupported key.';
  end if;

  published := public.finish_assurance_analysis(
    p_project_id, p_review_id, p_attempt_id, p_findings, p_actions, p_metadata, null
  );
  if not coalesce(published, false) then
    return false;
  end if;

  update public.assurance_reviews
  set analysis_metadata = coalesce(analysis_metadata, '{}'::jsonb) || coalesce(p_result_metadata, '{}'::jsonb),
    updated_at = clock_timestamp()
  where id = p_review_id and project_id = p_project_id;
  if not found then
    raise exception 'Assurance review disappeared while publishing analysis metadata.';
  end if;
  return true;
end;
$$;
revoke all on function public.finish_assurance_analysis_with_results(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb)
  from public, anon;
grant execute on function public.finish_assurance_analysis_with_results(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb)
  to authenticated;
