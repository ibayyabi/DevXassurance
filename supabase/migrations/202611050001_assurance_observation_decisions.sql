-- Ticket 03: partial evidence review. Reviewers accept, correct, or reject
-- individual supported observations; the original observation stays immutable
-- and decisions carry their own attribution, reason, and source version.
-- Decisions participate in the assurance source fingerprint, so any analysis
-- built over them goes stale the moment a decision changes.

-- Per-row observation identity: content, chunk index, excerpt, and location.
-- A generated column cannot call stable JSONB constructors, so the immutable
-- helper below does the hashing.
create or replace function public.assurance_observation_fingerprint(
  p_observation jsonb, p_chunk_index integer, p_excerpt text, p_source_location jsonb
)
returns text language sql immutable as $$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'observation', p_observation,
    'evidence_chunk_index', p_chunk_index,
    'excerpt', p_excerpt,
    'source_location', p_source_location
  )::text, 'UTF8'), 'sha256'), 'hex');
$$;

create or replace function public.assurance_cost_observation_fingerprint(
  p_measure text, p_source_value text, p_normalized_amount numeric, p_currency text,
  p_scope_level text, p_scope_label text, p_chunk_index integer, p_excerpt text, p_source_location jsonb
)
returns text language sql immutable as $$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'measure', p_measure, 'source_value', p_source_value,
    'normalized_amount', p_normalized_amount, 'currency', p_currency,
    'scope_level', p_scope_level, 'scope_label', p_scope_label,
    'evidence_chunk_index', p_chunk_index, 'excerpt', p_excerpt,
    'source_location', p_source_location
  )::text, 'UTF8'), 'sha256'), 'hex');
$$;

alter table public.cost_observations
  add column if not exists observation_fingerprint text
  generated always as
    (public.assurance_cost_observation_fingerprint(measure, source_value, normalized_amount, currency, scope_level, scope_label, evidence_chunk_index, excerpt, source_location)) stored;

alter table public.assurance_observations
  add column if not exists observation_fingerprint text
  generated always as
    (public.assurance_observation_fingerprint(observation, evidence_chunk_index, excerpt, source_location)) stored;

alter table public.assurance_observation_decisions
  add column if not exists target_type text not null default 'assurance';
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'assurance_observation_decisions_decision_check'
      and conrelid = 'public.assurance_observation_decisions'::regclass
  ) then
    alter table public.assurance_observation_decisions
      drop constraint if exists assurance_observation_decisions_decision_check;
  end if;
end $$;
create table if not exists public.assurance_observation_decisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  target_type text not null default 'assurance' check (target_type in ('assurance', 'cost')),
  document_id uuid not null references public.documents(id) on delete cascade,
  source_content_hash text not null check (source_content_hash ~ '^[0-9a-f]{64}$'),
  parser_version text not null check (length(parser_version) between 1 and 100),
  contract_version text not null check (length(contract_version) between 1 and 100),
  observation_fingerprint text not null check (observation_fingerprint ~ '^[0-9a-f]{64}$'),
  decision text not null check (decision in ('accepted', 'corrected', 'rejected')),
  corrected_observation jsonb check (corrected_observation is null or jsonb_typeof(corrected_observation) = 'object'),
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  decided_by uuid not null references public.profiles(id) on delete restrict,
  decided_at timestamptz not null default clock_timestamp(),
  unique (document_id, source_content_hash, parser_version, contract_version, target_type, observation_fingerprint)
);
-- Widen the unique key on tables created by earlier drafts of this migration.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'assurance_observation_decisions_observation_unique'
      and conrelid = 'public.assurance_observation_decisions'::regclass
  ) then
    alter table public.assurance_observation_decisions
      drop constraint if exists assurance_observation_decisions_document_id_source_content_hash_parser_v_key;
    alter table public.assurance_observation_decisions
      add constraint assurance_observation_decisions_observation_unique
      unique (document_id, source_content_hash, parser_version, contract_version, target_type, observation_fingerprint);
  end if;
end $$;

create index if not exists assurance_observation_decisions_document_idx
  on public.assurance_observation_decisions (project_id, document_id, decided_at, id);

alter table public.assurance_observation_decisions enable row level security;
revoke all on table public.assurance_observation_decisions from anon, authenticated;
grant select on table public.assurance_observation_decisions to authenticated;
grant select, insert, update, delete on table public.assurance_observation_decisions to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'assurance_observation_decisions'
      and policyname = 'assurance_observation_decisions_read_by_project_members'
  ) then
    create policy "assurance_observation_decisions_read_by_project_members"
      on public.assurance_observation_decisions for select to authenticated
      using (public.is_project_member(project_id));
  end if;
end $$;

-- Decisions only count when their fingerprint still matches a stored
-- observation of the same source version. A re-extraction under the same
-- version tuple reattaches identical observations; changed content leaves the
-- decision orphaned: kept for audit, ignored by consumers, and the snapshot
-- below shrinks so dependent analyses invalidate.
create or replace function public.assurance_observation_decisions_snapshot(p_project_id uuid, p_review_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare decisions jsonb;
begin
  with matched as (
    select d.id, d.target_type, d.document_id, d.source_content_hash, d.parser_version, d.contract_version,
      d.observation_fingerprint, d.decision, d.corrected_observation, d.reason,
      d.decided_by, d.decided_at,
      (select coalesce(jsonb_agg(o.id order by o.id), '[]'::jsonb)
      from public.assurance_observations o
      where o.project_id = d.project_id and o.document_id = d.document_id
        and o.source_content_hash = d.source_content_hash
        and o.parser_version = d.parser_version
        and o.contract_version = d.contract_version
        and o.observation_fingerprint = d.observation_fingerprint) as observation_ids,
      (select coalesce(jsonb_agg(c.id order by c.id), '[]'::jsonb)
      from public.cost_observations c
      where c.project_id = d.project_id and c.document_id = d.document_id
        and c.source_content_hash = d.source_content_hash
        and c.parser_version = d.parser_version
        and c.contract_version = d.contract_version
        and c.observation_fingerprint = d.observation_fingerprint) as cost_observation_ids
    from public.assurance_observation_decisions d
    where d.project_id = p_project_id
      and exists (
        select 1 from public.assurance_review_documents l
        where l.document_id = d.document_id and l.review_id = p_review_id
          and l.project_id = p_project_id
      )
      -- The decision applies only while the document's current source version
      -- is still the version the decision was recorded against; a superseded
      -- version drops it from the snapshot so analyses invalidate.
      and exists (
        select 1 from public.documents doc
        where doc.id = d.document_id and doc.project_id = d.project_id
          and doc.content_hash = d.source_content_hash
          and doc.assurance_observation_parser_version = d.parser_version
          and doc.assurance_observation_contract_version = d.contract_version
      )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'target_type', m.target_type,
    'document_id', m.document_id,
    'source_content_hash', m.source_content_hash,
    'parser_version', m.parser_version,
    'contract_version', m.contract_version,
    'observation_fingerprint', m.observation_fingerprint,
    'decision', m.decision,
    'corrected_observation', m.corrected_observation,
    'reason', m.reason,
    'decided_by', m.decided_by,
    'decided_at', m.decided_at,
    'observation_ids', m.observation_ids,
    'cost_observation_ids', m.cost_observation_ids
  ) order by m.document_id, m.target_type, m.observation_fingerprint, m.id), '[]'::jsonb)
  into decisions
  from matched m
  where jsonb_array_length(m.observation_ids) > 0 or jsonb_array_length(m.cost_observation_ids) > 0;

  return jsonb_build_object(
    'fingerprint', encode(sha256(convert_to(decisions::text, 'UTF8')), 'hex'),
    'decisions', decisions
  );
end;
$$;
revoke all on function public.assurance_observation_decisions_snapshot(uuid, uuid) from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = pronamespace
    where nspname = 'public' and proname = 'assurance_source_snapshot_without_observation_decisions'
  ) then
    alter function public.assurance_source_snapshot(uuid, uuid)
      rename to assurance_source_snapshot_without_observation_decisions;
  end if;
end $$;
revoke all on function public.assurance_source_snapshot_without_observation_decisions(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.assurance_source_snapshot(p_project_id uuid, p_review_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare source_snapshot jsonb; decision_snapshot jsonb;
begin
  source_snapshot := public.assurance_source_snapshot_without_observation_decisions(p_project_id, p_review_id);
  decision_snapshot := public.assurance_observation_decisions_snapshot(p_project_id, p_review_id);
  return source_snapshot || jsonb_build_object(
    'fingerprint', encode(sha256(convert_to(jsonb_build_array(
      source_snapshot->>'fingerprint', decision_snapshot->>'fingerprint'
    )::text, 'UTF8')), 'hex'),
    'observation_decisions', decision_snapshot->'decisions'
  );
end;
$$;
revoke all on function public.assurance_source_snapshot(uuid, uuid) from public, anon, authenticated;

-- Server boundary for per-observation review decisions. Authorization, the
-- current source version, and the displayed fingerprint are re-checked here,
-- not only in the UI. The original observation row is never updated.
create or replace function public.save_assurance_observation_decision(
  p_project_id uuid,
  p_target_type text,
  p_observation_id uuid,
  p_observation_fingerprint text,
  p_decision text,
  p_reason text,
  p_corrected jsonb default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  observation public.assurance_observations%rowtype;
  cost_row public.cost_observations%rowtype;
  previous public.assurance_observation_decisions%rowtype;
  corrected jsonb;
  decision_id uuid;
  v_document_id uuid;
  v_source_hash text;
  v_parser_version text;
  v_contract_version text;
  v_stored_fingerprint text;
  v_cost_measure text;
  v_cost_scope_level text;
begin
  if auth.uid() is null or not public.can_upload_project_evidence(p_project_id) then
    raise exception 'Your project role cannot review assurance evidence.';
  end if;
  if p_observation_id is null
    or p_target_type is null or p_target_type not in ('assurance', 'cost')
    or p_observation_fingerprint is null or p_observation_fingerprint !~ '^[0-9a-f]{64}$'
    or p_decision is null or p_decision not in ('accepted', 'corrected', 'rejected')
    or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'A supported observation, its displayed fingerprint, a decision, and a reason are required.';
  end if;
  if p_decision = 'corrected' and (p_corrected is null or jsonb_typeof(p_corrected) <> 'object') then
    raise exception 'A corrected decision requires a corrected value object.';
  end if;
  if p_decision <> 'corrected' and p_corrected is not null then
    raise exception 'Only a corrected decision carries a corrected value.';
  end if;

  if p_decision = 'corrected' and p_target_type = 'assurance' then
    if p_corrected ? 'percent' and (jsonb_typeof(p_corrected->'percent') <> 'number'
        or (p_corrected->>'percent')::numeric < 0 or (p_corrected->>'percent')::numeric > 100) then
      raise exception 'A corrected progress percentage between 0 and 100 is required.';
    end if;
    if p_corrected ? 'date' and (jsonb_typeof(p_corrected->'date') <> 'string'
        or (p_corrected->>'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        or (p_corrected->>'date')::date is null) then
      raise exception 'A corrected milestone date must be a valid YYYY-MM-DD date.';
    end if;
    if exists (
      select 1 from jsonb_object_keys(p_corrected) as correction_key(key)
      where correction_key.key not in ('percent', 'date', 'status', 'rating_label', 'rating_value')
    ) then
      raise exception 'Correction supports only progress percent, milestone date, risk status, and risk rating fields.';
    end if;
    if p_corrected ? 'rating_value' and jsonb_typeof(p_corrected->'rating_value') <> 'number' then
      raise exception 'A corrected risk rating value must be a number.';
    end if;
    if p_corrected ? 'status' and coalesce(nullif(p_corrected->>'status', ''), '') = '' then
      raise exception 'A corrected risk status cannot be empty.';
    end if;
  end if;
  if p_decision = 'corrected' and p_target_type = 'cost' then
    if exists (
      select 1 from jsonb_object_keys(p_corrected) as correction_key(key)
      where correction_key.key not in ('normalized_amount', 'currency', 'scope_label')
    ) then
      raise exception 'A cost correction supports only amount, currency, and WBS scope label.';
    end if;
    if p_corrected ? 'normalized_amount' and (jsonb_typeof(p_corrected->'normalized_amount') <> 'number') then
      raise exception 'A corrected cost amount must be a number.';
    end if;
    if p_corrected ? 'currency' and coalesce(p_corrected->>'currency', '') !~ '^[A-Z]{3}$' then
      raise exception 'A corrected currency must be a three-letter code.';
    end if;
    if p_corrected ? 'scope_label' and coalesce(nullif(p_corrected->>'scope_label', ''), '') = '' then
      raise exception 'A corrected WBS scope label cannot be empty.';
    end if;
  end if;

  if p_target_type = 'assurance' then
    select o.* into observation
    from public.assurance_observations o
    join public.documents d on d.id = o.document_id and d.project_id = p_project_id
    where o.id = p_observation_id and o.project_id = p_project_id
      and d.processing_status in ('completed', 'needs_review')
      and o.source_content_hash = d.content_hash
      and o.parser_version = d.assurance_observation_parser_version
      and o.contract_version = d.assurance_observation_contract_version
    for share of o;
    if not found then
      raise exception 'Observation is not current evidence in this project.';
    end if;
    v_document_id := observation.document_id;
    v_source_hash := observation.source_content_hash;
    v_parser_version := observation.parser_version;
    v_contract_version := observation.contract_version;
    v_stored_fingerprint := observation.observation_fingerprint;
    if p_decision = 'corrected' then
      if observation.observation_type = 'progress' then
        if not p_corrected ? 'percent' then
          raise exception 'A progress correction requires a percent value.';
        end if;
      elsif observation.observation_type = 'milestone' then
        if not p_corrected ? 'date' then
          raise exception 'A milestone correction requires a date value.';
        end if;
      elsif observation.observation_type = 'risk_snapshot' then
        if not (p_corrected ? 'status' or p_corrected ? 'rating_label' or p_corrected ? 'rating_value') then
          raise exception 'A risk correction requires a status or rating field.';
        end if;
      else
        raise exception 'Risk register statements are verbatim source claims; they can be accepted or rejected, not corrected.';
      end if;
    end if;
  else
    select c.* into cost_row
    from public.cost_observations c
    join public.documents d on d.id = c.document_id and d.project_id = p_project_id
    where c.id = p_observation_id and c.project_id = p_project_id
      and d.processing_status in ('completed', 'needs_review')
      and c.source_content_hash = d.content_hash
      and c.parser_version = d.assurance_observation_parser_version
      and c.contract_version = d.assurance_observation_contract_version
    for share of c;
    if not found then
      raise exception 'Observation is not current evidence in this project.';
    end if;
    v_document_id := cost_row.document_id;
    v_source_hash := cost_row.source_content_hash;
    v_parser_version := cost_row.parser_version;
    v_contract_version := cost_row.contract_version;
    v_stored_fingerprint := cost_row.observation_fingerprint;
    v_cost_measure := cost_row.measure;
    v_cost_scope_level := cost_row.scope_level;
    if p_decision = 'corrected' and p_corrected ? 'scope_label'
      and coalesce(v_cost_scope_level, 'project') <> 'wbs' then
      raise exception 'Only a WBS-scoped cost observation can have its scope label corrected; project scope stays as extracted.';
    end if;
    if p_decision = 'corrected' and v_cost_measure = 'approved_baseline' then
      raise exception 'Accept an approved baseline through baseline acceptance, which already records your own decision and note; a correction cannot pre-edit its amount.';
    end if;
  end if;
  if v_stored_fingerprint <> p_observation_fingerprint then
    raise exception 'The observation changed since it was displayed. Refresh and review the current version.';
  end if;
  corrected := p_corrected;

  select * into previous from public.assurance_observation_decisions
  where project_id = p_project_id and document_id = v_document_id
    and source_content_hash = v_source_hash
    and parser_version = v_parser_version
    and contract_version = v_contract_version
    and target_type = p_target_type
    and observation_fingerprint = v_stored_fingerprint
  for update;

  insert into public.assurance_observation_decisions (
    project_id, target_type, document_id, source_content_hash, parser_version, contract_version,
    observation_fingerprint, decision, corrected_observation, reason, decided_by
  ) values (
    p_project_id, p_target_type, v_document_id, v_source_hash,
    v_parser_version, v_contract_version,
    v_stored_fingerprint, p_decision, corrected, btrim(p_reason), auth.uid()
  )
  on conflict (document_id, source_content_hash, parser_version, contract_version, target_type, observation_fingerprint)
  do update set decision = excluded.decision,
    corrected_observation = excluded.corrected_observation,
    reason = excluded.reason,
    decided_by = excluded.decided_by,
    decided_at = clock_timestamp()
  returning id into decision_id;

  insert into public.audit_events(project_id, actor_id, event_type, entity_type, entity_id, before_state, after_state)
  values (
    p_project_id, auth.uid(), 'assurance_observation_reviewed',
    case when p_target_type = 'assurance' then 'assurance_observation' else 'cost_observation' end,
    p_observation_id,
    coalesce(to_jsonb(previous), jsonb_build_object('decision_state', 'unreviewed')),
    jsonb_build_object(
      'target_type', p_target_type,
      'decision', p_decision,
      'corrected_observation', corrected,
      'observation_fingerprint', v_stored_fingerprint,
      'source_content_hash', v_source_hash,
      'parser_version', v_parser_version,
      'contract_version', v_contract_version,
      'reason', btrim(p_reason), 'decided_by', auth.uid())
  );
  return decision_id;
end;
$$;
revoke all on function public.save_assurance_observation_decision(uuid, text, uuid, text, text, text, jsonb)
  from public, anon;
grant execute on function public.save_assurance_observation_decision(uuid, text, uuid, text, text, text, jsonb)
  to authenticated;

-- Selection boundary: a needs-review document is admissible only when its
-- current source version has observation coverage. The UI applies the same
-- rule; this re-checks it where the write happens.
create or replace function public.save_assurance_evidence(p_project_id uuid, p_review_id uuid,
  p_baseline_ids uuid[], p_current_ids uuid[])
returns boolean language plpgsql security definer set search_path = '' as $$
declare r public.assurance_reviews; s jsonb; refs jsonb; b uuid[]; c uuid[]; same_selection boolean;
begin
  r := public.lock_assurance_review(p_project_id, p_review_id);
  select array_agg(distinct x order by x) into b from unnest(p_baseline_ids) x where x is not null;
  select array_agg(distinct x order by x) into c from unnest(p_current_ids) x where x is not null;
  if coalesce(cardinality(b),0) = 0 or coalesce(cardinality(c),0) = 0 or b && c
    then raise exception 'Choose distinct baseline and current evidence.'; end if;
  if (select count(*) from public.documents where project_id = p_project_id
    and id = any(b || c) and processing_status in ('completed', 'needs_review')) <> cardinality(b || c)
    then raise exception 'Selected documents must be fully processed and belong to this project.'; end if;
  if exists (
    select 1 from public.documents d
    where d.project_id = p_project_id and d.id = any(b || c)
      and d.processing_status = 'needs_review'
      and not exists (
        select 1 from public.assurance_observation_coverage cov
        where cov.project_id = p_project_id and cov.document_id = d.id
          and cov.source_content_hash = d.content_hash
          and cov.parser_version = d.assurance_observation_parser_version
          and cov.contract_version = d.assurance_observation_contract_version
      )
  ) then raise exception 'A needs-review document is selectable only with observation coverage for its current source version.'; end if;
  same_selection := (select coalesce(array_agg(document_id order by document_id)
    filter (where evidence_role = 'baseline'), '{}'::uuid[]) = b
    and coalesce(array_agg(document_id order by document_id)
    filter (where evidence_role = 'current'), '{}'::uuid[]) = c
    from public.assurance_review_documents where project_id = p_project_id and review_id = p_review_id);
  if not same_selection then
    delete from public.assurance_review_documents where project_id = p_project_id and review_id = p_review_id;
    insert into public.assurance_review_documents(project_id, review_id, document_id, evidence_role, added_by)
      select p_project_id, p_review_id, x, 'baseline', auth.uid() from unnest(b) x
      union all select p_project_id, p_review_id, x, 'current', auth.uid() from unnest(c) x;
  end if;
  s := public.assurance_source_snapshot(p_project_id, p_review_id);
  refs := public.assurance_reference_snapshot(p_project_id, p_review_id);
  if same_selection and s->>'fingerprint' = coalesce(r.analysis_metadata->>'selection_fingerprint',
    r.analysis_metadata->'last_success'->>'fingerprint')
    and refs->>'fingerprint' = coalesce(r.analysis_metadata->>'selection_reference_fingerprint',
      r.analysis_metadata->'last_success'->>'reference_fingerprint') then return false; end if;
  update public.assurance_reviews set status = 'evidence_ready', current_step = 'analysis',
    analysis_error = null, approved_at = null, reviewed_by = null,
    analysis_metadata = analysis_metadata || jsonb_build_object(
      'selection_fingerprint', s->>'fingerprint',
      'selection_reference_fingerprint', refs->>'fingerprint',
      'selection_reference_versions', refs->'versions'
    ) || case when analysis_metadata->'latest_attempt'->>'outcome' = 'analyzing' then
      jsonb_build_object('latest_attempt', analysis_metadata->'latest_attempt' ||
        jsonb_build_object('outcome','invalidated','finished_at',clock_timestamp()))
      else '{}'::jsonb end,
    updated_at = clock_timestamp() where id = p_review_id and project_id = p_project_id;
  return true;
end;
$$;
revoke all on function public.save_assurance_evidence(uuid, uuid, uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.save_assurance_evidence(uuid, uuid, uuid[], uuid[]) to authenticated;
