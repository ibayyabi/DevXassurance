-- Accepted baselines and mappings are versioned reference decisions. Their
-- replacement, attribution, and invalidation of affected analyses commit together.

alter table public.cost_baselines
  add column if not exists superseded_by uuid references public.profiles(id) on delete set null;

alter table public.cost_baselines
  add constraint cost_baselines_superseded_by_state_check
  check (state = 'superseded' or superseded_by is null);

alter table public.wbs_mappings
  add column if not exists superseded_by uuid references public.profiles(id) on delete set null,
  add column if not exists superseded_at timestamptz;
alter table public.milestone_mappings
  add column if not exists superseded_by uuid references public.profiles(id) on delete set null,
  add column if not exists superseded_at timestamptz;
alter table public.risk_identity_mappings
  add column if not exists superseded_by uuid references public.profiles(id) on delete set null,
  add column if not exists superseded_at timestamptz;
alter table public.risk_scale_mappings
  add column if not exists superseded_by uuid references public.profiles(id) on delete set null,
  add column if not exists superseded_at timestamptz;

do $$
declare
  table_name text;
  constraint_name text;
begin
  foreach table_name in array array[
    'wbs_mappings', 'milestone_mappings', 'risk_identity_mappings', 'risk_scale_mappings'
  ] loop
    for constraint_name in
      select c.conname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public' and t.relname = table_name and c.contype = 'c'
        and (
          pg_get_constraintdef(c.oid) ilike '%accepted_by%'
          or (pg_get_constraintdef(c.oid) ilike '%proposed%' and pg_get_constraintdef(c.oid) ilike '%rejected%')
        )
    loop
      execute format('alter table public.%I drop constraint %I', table_name, constraint_name);
    end loop;

    execute format(
      'alter table public.%I add constraint %I check (state in (''proposed'', ''accepted'', ''rejected'', ''superseded''))',
      table_name, table_name || '_state_check'
    );
    execute format(
      'alter table public.%I add constraint %I check (' ||
      '(state = ''accepted'' and accepted_by is not null and accepted_at is not null and superseded_at is null and superseded_by is null) or ' ||
      '(state = ''superseded'' and accepted_by is not null and accepted_at is not null and superseded_at is not null) or ' ||
      '(state in (''proposed'', ''rejected'') and accepted_by is null and accepted_at is null and superseded_by is null and superseded_at is null))',
      table_name, table_name || '_decision_attribution_check'
    );
  end loop;
end;
$$;

create or replace function public.lock_assurance_review(p_project_id uuid, p_review_id uuid)
returns public.assurance_reviews
language plpgsql security definer set search_path = '' as $$
declare r public.assurance_reviews;
begin
  if auth.uid() is null or not exists (
    select 1 from public.project_members where project_id = p_project_id
      and user_id = auth.uid() and role in ('admin', 'pmc_consultant', 'project_manager')
  ) then raise exception 'Your project role cannot manage an assurance review.'; end if;
  perform 1 from public.projects where id = p_project_id for share;
  if not found then raise exception 'Project was not found.'; end if;
  select * into r from public.assurance_reviews
    where id = p_review_id and project_id = p_project_id for update;
  if not found then raise exception 'Assurance review was not found in this project.'; end if;
  return r;
end;
$$;

create function public.assurance_chunk_contains_label(p_chunk text, p_label text)
returns boolean language sql immutable set search_path = '' as $$
  select btrim(normalized.label) <> ''
    and position(' ' || normalized.label || ' ' in ' ' || normalized.chunk || ' ') > 0
  from (
    select
      btrim(regexp_replace(lower(coalesce(p_chunk, '')), '[^[:alnum:]]+', ' ', 'g')) as chunk,
      btrim(regexp_replace(lower(coalesce(p_label, '')), '[^[:alnum:]]+', ' ', 'g')) as label
  ) normalized;
$$;

-- Only references that can affect this review are fingerprinted. Baseline
-- decisions are selected by approval order among versions effective by period end;
-- a later, future-effective approval cannot replace a historical baseline.
create function public.assurance_reference_snapshot(p_project_id uuid, p_review_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  period_start date;
  period_end date;
  observations jsonb;
  baselines jsonb;
  wbs_mappings jsonb;
  milestone_mappings jsonb;
  risk_identity_mappings jsonb;
  risk_scale_mappings jsonb;
  refs jsonb;
  versions jsonb;
begin
  perform 1 from public.projects where id = p_project_id for share;
  if not found then raise exception 'Project was not found.'; end if;
  select r.reporting_period,
    (date_trunc('month', r.reporting_period::timestamp) + interval '1 month - 1 day')::date
    into period_start, period_end
    from public.assurance_reviews r where r.id = p_review_id and r.project_id = p_project_id;
  if not found then raise exception 'Assurance review was not found in this project.'; end if;

  perform b.id from public.cost_baselines b
    where b.project_id = p_project_id and b.effective_date <= period_end
      and b.state in ('accepted', 'superseded')
    order by b.id for share of b;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', selected.id, 'scope_level', selected.scope_level, 'scope_label', selected.scope_label,
      'amount', selected.amount, 'currency', selected.currency, 'effective_date', selected.effective_date,
      'observation_id', selected.observation_id, 'source_document_id', selected.source_document_id,
      'approved_by', selected.approved_by, 'approval_note', selected.approval_note,
      'approved_at', selected.approved_at
    ) order by selected.scope_level, selected.scope_label nulls first), '[]'::jsonb)
    into baselines
    from (
      select distinct on (b.scope_level, b.scope_label)
        b.id, b.scope_level, b.scope_label, b.amount, b.currency, b.effective_date,
        b.observation_id, b.source_document_id, b.approved_by, b.approval_note, b.approved_at
      from public.cost_baselines b
      where b.project_id = p_project_id and b.effective_date <= period_end
        and b.state in ('accepted', 'superseded')
      order by b.scope_level, b.scope_label, b.approved_at desc, b.id desc
    ) selected;

  perform o.id from public.cost_observations o
    where o.project_id = p_project_id and (
      exists (
        select 1 from public.assurance_review_documents l
        where l.project_id = p_project_id and l.review_id = p_review_id and l.document_id = o.document_id
      )
      or o.id in (
        select b.observation_id from (
          select distinct on (cb.scope_level, cb.scope_label) cb.observation_id, cb.scope_level, cb.scope_label
          from public.cost_baselines cb
          where cb.project_id = p_project_id and cb.effective_date <= period_end
            and cb.state in ('accepted', 'superseded')
          order by cb.scope_level, cb.scope_label, cb.approved_at desc, cb.id desc
        ) b where b.observation_id is not null
      )
    ) order by o.id for share of o;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'document_id', o.document_id, 'evidence_role', l.evidence_role,
      'measure', o.measure, 'source_value', o.source_value, 'normalized_amount', o.normalized_amount,
      'currency', o.currency, 'scope_level', o.scope_level, 'scope_label', o.scope_label,
      'period_label', o.period_label, 'as_of_date', o.as_of_date, 'status_label', o.status_label,
      'evidence_chunk_index', o.evidence_chunk_index, 'excerpt', o.excerpt,
      'page_number', o.page_number, 'section_label', o.section_label, 'source_location', o.source_location
    ) order by o.document_id, o.measure, o.scope_label nulls first, o.evidence_chunk_index, o.id), '[]'::jsonb)
    into observations
    from public.cost_observations o
    left join public.assurance_review_documents l
      on l.project_id = p_project_id and l.review_id = p_review_id and l.document_id = o.document_id
    where o.project_id = p_project_id and (
      l.document_id is not null
      or o.id in (
        select b.observation_id from (
          select distinct on (cb.scope_level, cb.scope_label) cb.observation_id, cb.scope_level, cb.scope_label
          from public.cost_baselines cb
          where cb.project_id = p_project_id and cb.effective_date <= period_end
            and cb.state in ('accepted', 'superseded')
          order by cb.scope_level, cb.scope_label, cb.approved_at desc, cb.id desc
        ) b where b.observation_id is not null
      )
    );

  perform m.id from public.wbs_mappings m
    where m.project_id = p_project_id and m.state = 'accepted'
      and (
        exists (
          select 1 from public.cost_observations o
          join public.assurance_review_documents l on l.project_id = p_project_id
            and l.review_id = p_review_id and l.document_id = o.document_id
          where o.project_id = p_project_id and o.scope_level = 'wbs' and o.scope_label = m.source_label
        )
        or exists (
          select 1 from public.cost_baselines b
          where b.project_id = p_project_id and b.scope_level = 'wbs'
            and b.scope_label = m.source_label and b.effective_date <= period_end
            and b.state in ('accepted', 'superseded')
        )
      ) order by m.id for share of m;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'source_label', m.source_label, 'canonical_label', m.canonical_label,
      'note', m.note, 'created_by', m.created_by, 'accepted_by', m.accepted_by, 'accepted_at', m.accepted_at
    ) order by m.source_label, m.id), '[]'::jsonb)
    into wbs_mappings
    from public.wbs_mappings m
    where m.project_id = p_project_id and m.state = 'accepted'
      and (
        exists (
          select 1 from public.cost_observations o
          join public.assurance_review_documents l on l.project_id = p_project_id
            and l.review_id = p_review_id and l.document_id = o.document_id
          where o.project_id = p_project_id and o.scope_level = 'wbs' and o.scope_label = m.source_label
        )
        or exists (
          select 1 from public.cost_baselines b
          where b.project_id = p_project_id and b.scope_level = 'wbs'
            and b.scope_label = m.source_label and b.effective_date <= period_end
            and b.state in ('accepted', 'superseded')
        )
      );

  perform m.id from public.milestone_mappings m
    where m.project_id = p_project_id and m.state = 'accepted'
      and exists (
        select 1 from public.document_chunks c
        join public.assurance_review_documents l on l.project_id = p_project_id
          and l.review_id = p_review_id and l.document_id = c.document_id
        where c.project_id = p_project_id and public.assurance_chunk_contains_label(c.chunk_text, m.source_label)
      ) order by m.id for share of m;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'source_label', m.source_label, 'canonical_label', m.canonical_label,
      'note', m.note, 'created_by', m.created_by, 'accepted_by', m.accepted_by, 'accepted_at', m.accepted_at
    ) order by m.source_label, m.id), '[]'::jsonb)
    into milestone_mappings
    from public.milestone_mappings m
    where m.project_id = p_project_id and m.state = 'accepted'
      and exists (
        select 1 from public.document_chunks c
        join public.assurance_review_documents l on l.project_id = p_project_id
          and l.review_id = p_review_id and l.document_id = c.document_id
        where c.project_id = p_project_id and public.assurance_chunk_contains_label(c.chunk_text, m.source_label)
      );

  perform m.id from public.risk_identity_mappings m
    where m.project_id = p_project_id and m.state = 'accepted'
      and exists (
        select 1 from public.document_chunks c
        join public.assurance_review_documents l on l.project_id = p_project_id
          and l.review_id = p_review_id and l.document_id = c.document_id
        where c.project_id = p_project_id and public.assurance_chunk_contains_label(c.chunk_text, m.source_label)
      ) order by m.id for share of m;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'source_label', m.source_label, 'canonical_label', m.canonical_label,
      'note', m.note, 'created_by', m.created_by, 'accepted_by', m.accepted_by, 'accepted_at', m.accepted_at
    ) order by m.source_label, m.id), '[]'::jsonb)
    into risk_identity_mappings
    from public.risk_identity_mappings m
    where m.project_id = p_project_id and m.state = 'accepted'
      and exists (
        select 1 from public.document_chunks c
        join public.assurance_review_documents l on l.project_id = p_project_id
          and l.review_id = p_review_id and l.document_id = c.document_id
        where c.project_id = p_project_id and public.assurance_chunk_contains_label(c.chunk_text, m.source_label)
      );

  perform m.id from public.risk_scale_mappings m
    where m.project_id = p_project_id and m.state = 'accepted'
      and exists (
        select 1 from public.document_chunks c
        join public.assurance_review_documents l on l.project_id = p_project_id
          and l.review_id = p_review_id and l.document_id = c.document_id
        where c.project_id = p_project_id and public.assurance_chunk_contains_label(c.chunk_text, m.source_label)
      ) order by m.id for share of m;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'source_label', m.source_label, 'canonical_label', m.canonical_label,
      'note', m.note, 'created_by', m.created_by, 'accepted_by', m.accepted_by, 'accepted_at', m.accepted_at
    ) order by m.source_label, m.id), '[]'::jsonb)
    into risk_scale_mappings
    from public.risk_scale_mappings m
    where m.project_id = p_project_id and m.state = 'accepted'
      and exists (
        select 1 from public.document_chunks c
        join public.assurance_review_documents l on l.project_id = p_project_id
          and l.review_id = p_review_id and l.document_id = c.document_id
        where c.project_id = p_project_id and public.assurance_chunk_contains_label(c.chunk_text, m.source_label)
      );

  refs := jsonb_build_object(
    'reporting_period', period_start, 'period_end', period_end,
    'cost_observations', observations, 'cost_baselines', baselines,
    'wbs_mappings', wbs_mappings, 'milestone_mappings', milestone_mappings,
    'risk_identity_mappings', risk_identity_mappings, 'risk_scale_mappings', risk_scale_mappings
  );

  versions := jsonb_build_object(
    'cost_observation_ids', coalesce((select jsonb_agg(entry.value->'id' order by entry.value->>'id')
      from jsonb_array_elements(observations) as entry(value)), '[]'::jsonb),
    'cost_baseline_ids', coalesce((select jsonb_agg(entry.value->'id' order by entry.value->>'id')
      from jsonb_array_elements(baselines) as entry(value)), '[]'::jsonb),
    'wbs_mapping_ids', coalesce((select jsonb_agg(entry.value->'id' order by entry.value->>'id')
      from jsonb_array_elements(wbs_mappings) as entry(value)), '[]'::jsonb),
    'milestone_mapping_ids', coalesce((select jsonb_agg(entry.value->'id' order by entry.value->>'id')
      from jsonb_array_elements(milestone_mappings) as entry(value)), '[]'::jsonb),
    'risk_identity_mapping_ids', coalesce((select jsonb_agg(entry.value->'id' order by entry.value->>'id')
      from jsonb_array_elements(risk_identity_mappings) as entry(value)), '[]'::jsonb),
    'risk_scale_mapping_ids', coalesce((select jsonb_agg(entry.value->'id' order by entry.value->>'id')
      from jsonb_array_elements(risk_scale_mappings) as entry(value)), '[]'::jsonb)
  );
  return jsonb_build_object(
    'fingerprint', encode(sha256(convert_to(refs::text, 'UTF8')), 'hex'),
    'versions', versions,
    'references', refs
  );
end;
$$;

-- ponytail: compare every active result in this project per reference write; add a dependency index only if review volume warrants it.
create function public.invalidate_assurance_reference_results(p_project_id uuid)
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

-- ponytail: project-wide locking keeps replacement and uniqueness simple; split by scope only if approval throughput requires it.
create function public.accept_cost_baseline(
  p_project_id uuid, p_observation_id uuid, p_effective_date date, p_note text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  observation public.cost_observations;
  new_id uuid;
  active public.cost_baselines;
begin
  if auth.uid() is null or not public.can_upload_project_evidence(p_project_id) then
    raise exception 'Your project role cannot approve a cost baseline.';
  end if;
  if p_effective_date is null or length(coalesce(p_note, '')) > 1000 then
    raise exception 'A valid effective date and note are required.';
  end if;
  perform 1 from public.projects where id = p_project_id for update;
  if not found then raise exception 'Project was not found.'; end if;
  select o.* into observation from public.cost_observations o
    join public.documents d on d.id = o.document_id and d.project_id = p_project_id
    where o.id = p_observation_id and o.project_id = p_project_id and d.processing_status = 'completed'
    for share of o;
  if not found or observation.measure <> 'approved_baseline'
    or observation.normalized_amount is null or observation.currency is null then
    raise exception 'Only a source-backed approved-baseline observation with a valid amount and currency can be accepted.';
  end if;

  select b.* into active from public.cost_baselines b
    where b.project_id = p_project_id and b.scope_level = observation.scope_level
      and b.scope_label is not distinct from observation.scope_label and b.state = 'accepted'
    for update;
  if found and active.observation_id = observation.id
    and active.source_document_id = observation.document_id
    and active.amount = observation.normalized_amount and active.currency = observation.currency
    and active.effective_date = p_effective_date
    and active.approval_note is not distinct from nullif(btrim(p_note), '') then
    return active.id;
  end if;

  update public.cost_baselines set state = 'superseded', superseded_at = clock_timestamp(),
    superseded_by = auth.uid()
    where project_id = p_project_id and scope_level = observation.scope_level
      and scope_label is not distinct from observation.scope_label and state = 'accepted';
  insert into public.cost_baselines(
    project_id, scope_level, scope_label, amount, currency, effective_date,
    observation_id, source_document_id, approved_by, approval_note
  ) values (
    p_project_id, observation.scope_level, observation.scope_label, observation.normalized_amount,
    observation.currency, p_effective_date, observation.id, observation.document_id, auth.uid(),
    nullif(btrim(p_note), '')
  ) returning id into new_id;
  perform public.invalidate_assurance_reference_results(p_project_id);
  return new_id;
end;
$$;

create function public.replace_assurance_mapping(
  p_project_id uuid, p_mapping_kind text, p_source_label text, p_canonical_label text, p_note text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  table_name text;
  new_id uuid;
  active_id uuid;
  active_canonical text;
  active_note text;
begin
  if auth.uid() is null or not public.can_upload_project_evidence(p_project_id) then
    raise exception 'Your project role cannot approve an assurance mapping.';
  end if;
  table_name := case p_mapping_kind
    when 'wbs' then 'wbs_mappings'
    when 'milestone' then 'milestone_mappings'
    when 'risk_identity' then 'risk_identity_mappings'
    when 'risk_scale' then 'risk_scale_mappings'
    else null end;
  if table_name is null then raise exception 'Invalid mapping kind.'; end if;
  if p_source_label is null or p_canonical_label is null
    or length(p_source_label) not between 1 and 500 or length(p_canonical_label) not between 1 and 500
    or p_source_label = p_canonical_label or length(coalesce(p_note, '')) > 1000 then
    raise exception 'Provide distinct source and canonical labels and a note of at most 1000 characters.';
  end if;
  perform 1 from public.projects where id = p_project_id for update;
  if not found then raise exception 'Project was not found.'; end if;

  execute format(
    'select id, canonical_label, note from public.%I ' ||
    'where project_id = $1 and source_label = $2 and state = ''accepted'' for update',
    table_name
  ) into active_id, active_canonical, active_note using p_project_id, p_source_label;
  if active_id is not null and active_canonical = p_canonical_label
    and active_note is not distinct from nullif(btrim(p_note), '') then
    return active_id;
  end if;

  execute format(
    'update public.%I set state = ''superseded'', superseded_at = clock_timestamp(), superseded_by = $3 ' ||
    'where project_id = $1 and source_label = $2 and state = ''accepted''', table_name
  ) using p_project_id, p_source_label, auth.uid();
  execute format(
    'insert into public.%I (project_id, source_label, canonical_label, state, proposed_by_model, note, created_by, accepted_by, accepted_at) ' ||
    'values ($1, $2, $3, ''accepted'', false, $4, $5, $5, clock_timestamp()) returning id', table_name
  ) into new_id using p_project_id, p_source_label, p_canonical_label, nullif(btrim(p_note), ''), auth.uid();
  perform public.invalidate_assurance_reference_results(p_project_id);
  return new_id;
end;
$$;

create function public.remove_assurance_mapping(p_project_id uuid, p_mapping_kind text, p_mapping_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  table_name text;
  updated_id uuid;
  already_removed boolean;
begin
  if auth.uid() is null or not public.can_upload_project_evidence(p_project_id) then
    raise exception 'Your project role cannot remove an assurance mapping.';
  end if;
  table_name := case p_mapping_kind
    when 'wbs' then 'wbs_mappings'
    when 'milestone' then 'milestone_mappings'
    when 'risk_identity' then 'risk_identity_mappings'
    when 'risk_scale' then 'risk_scale_mappings'
    else null end;
  if table_name is null then raise exception 'Invalid mapping kind.'; end if;
  perform 1 from public.projects where id = p_project_id for update;
  if not found then raise exception 'Project was not found.'; end if;
  execute format(
    'update public.%I set state = ''superseded'', superseded_at = clock_timestamp(), superseded_by = $3 ' ||
    'where project_id = $1 and id = $2 and state = ''accepted'' returning id', table_name
  ) into updated_id using p_project_id, p_mapping_id, auth.uid();
  if updated_id is null then
    execute format(
      'select exists (select 1 from public.%I where project_id = $1 and id = $2 and state = ''superseded'')',
      table_name
    ) into already_removed using p_project_id, p_mapping_id;
    if already_removed then return false; end if;
    raise exception 'Accepted mapping was not found in this project.';
  end if;
  perform public.invalidate_assurance_reference_results(p_project_id);
  return true;
end;
$$;

create or replace function public.assurance_analysis_is_current(p_project_id uuid, p_review_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare r public.assurance_reviews; s jsonb; refs jsonb; success jsonb; attempt jsonb;
begin
  select * into r from public.assurance_reviews where id = p_review_id and project_id = p_project_id;
  if not found then return false; end if;
  success := r.analysis_metadata->'last_success'; attempt := r.analysis_metadata->'latest_attempt';
  if success->>'id' is null or attempt->>'outcome' is distinct from 'succeeded'
    or attempt->>'id' is distinct from success->>'id'
    or r.status not in ('findings_ready', 'report_draft', 'approved') then return false; end if;
  begin
    s := public.assurance_source_snapshot(p_project_id, p_review_id);
    refs := public.assurance_reference_snapshot(p_project_id, p_review_id);
  exception when others then return false; end;
  if s->>'fingerprint' is distinct from success->>'fingerprint'
    or refs->>'fingerprint' is distinct from success->>'reference_fingerprint' then return false; end if;
  return (select count(*) = 3 and count(distinct domain) = 3 and bool_and(coalesce(
    provenance->>'analysis_attempt_id' = success->>'id'
    and to_jsonb(baseline_document_ids) = s->'baseline_ids'
    and to_jsonb(current_document_ids) = s->'current_ids', false))
    from public.assurance_findings where review_id = p_review_id and project_id = p_project_id);
end;
$$;

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
    and id = any(b || c) and processing_status = 'completed') <> cardinality(b || c)
    then raise exception 'Selected documents must be completed and belong to this project.'; end if;
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

create or replace function public.get_assurance_analysis_state(p_project_id uuid, p_review_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.assurance_reviews;
begin
  if auth.uid() is null or not public.is_project_member(p_project_id)
    then raise exception 'Project membership is required.'; end if;
  perform 1 from public.projects where id = p_project_id for share;
  if not found then raise exception 'Project was not found.'; end if;
  select * into r from public.assurance_reviews where id = p_review_id and project_id = p_project_id for share;
  if not found then raise exception 'Assurance review was not found in this project.'; end if;
  return jsonb_build_object('current',public.assurance_analysis_is_current(p_project_id,p_review_id),
    'status',r.status,'latest_attempt',r.analysis_metadata->'latest_attempt',
    'last_success',r.analysis_metadata->'last_success');
end;
$$;

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
    'reference_fingerprint', refs->>'fingerprint', 'reference_versions', refs->'versions');
end;
$$;

create or replace function public.finish_assurance_analysis(p_project_id uuid, p_review_id uuid,
  p_attempt_id uuid, p_findings jsonb default null, p_actions jsonb default '[]',
  p_metadata jsonb default '{}', p_error text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare r public.assurance_reviews; attempt jsonb; s jsonb; refs jsonb; f jsonb; a jsonb;
  failure text := p_error; completed timestamptz := clock_timestamp(); inserted_id uuid;
begin
  r := public.lock_assurance_review(p_project_id, p_review_id);
  attempt := r.analysis_metadata->'latest_attempt';
  if attempt->>'id' is distinct from p_attempt_id::text or attempt->>'outcome' is distinct from 'analyzing'
    then return false; end if;
  if (attempt->>'lease_until')::timestamptz <= clock_timestamp()
    then failure := 'Analysis attempt expired. Run analysis again.'; end if;
  begin
    s := public.assurance_source_snapshot(p_project_id, p_review_id);
    refs := public.assurance_reference_snapshot(p_project_id, p_review_id);
  exception when others then failure := 'Selected evidence or comparison references are no longer available.';
  end;
  if s->>'fingerprint' is distinct from attempt->>'fingerprint'
    then failure := 'Evidence changed during analysis. Run analysis again.'; end if;
  if refs is not null and refs->>'fingerprint' is distinct from attempt->>'reference_fingerprint'
    then failure := 'Approved comparison references changed during analysis. Run analysis again.'; end if;
  if failure is not null then
    update public.assurance_reviews set status = 'analysis_failed', current_step = 'analysis',
      analysis_error = left(failure,1000),
      analysis_metadata = jsonb_set(analysis_metadata, '{latest_attempt}', attempt ||
        jsonb_build_object('outcome','analysis_failed','finished_at',completed)), updated_at = completed
      where id = p_review_id and project_id = p_project_id;
    return false;
  end if;
  if jsonb_typeof(p_findings) is distinct from 'array' or jsonb_array_length(p_findings) <> 3
    then raise exception 'Publish all three domain findings together.'; end if;
  if (select count(distinct x->>'domain') from jsonb_array_elements(p_findings) x
    where x->>'domain' in ('budget','schedule','risk')) <> 3
    then raise exception 'Publish Budget, Schedule, and Risk exactly once.'; end if;
  delete from public.assurance_actions where project_id = p_project_id and review_id = p_review_id;
  delete from public.assurance_findings where project_id = p_project_id and review_id = p_review_id;
  for f in select value from jsonb_array_elements(p_findings) loop
    insert into public.assurance_findings(project_id,review_id,domain,condition,severity,headline,explanation,
      baseline_value,current_value,variance,required_evidence,baseline_document_ids,current_document_ids,
      source_excerpts,confidence,provenance)
    values(p_project_id,p_review_id,f->>'domain',f->>'condition',f->>'severity',f->>'headline',f->>'explanation',
      f->'baselineValue',f->'currentValue',f->'variance',
      array(select jsonb_array_elements_text(f->'requiredEvidence')),
      array(select jsonb_array_elements_text(s->'baseline_ids'))::uuid[],
      array(select jsonb_array_elements_text(s->'current_ids'))::uuid[],f->'sourceExcerpts',
      (f->>'confidence')::numeric, coalesce(p_metadata,'{}'::jsonb) ||
        jsonb_build_object('analysis_attempt_id',p_attempt_id)) returning id into inserted_id;
    for a in select value from jsonb_array_elements(p_actions) where value->>'domain' = f->>'domain' loop
      insert into public.assurance_actions(project_id,review_id,finding_id,title,priority,status)
        values(p_project_id,p_review_id,inserted_id,a->>'title',a->>'priority','open');
    end loop;
  end loop;
  update public.assurance_reviews set status = 'findings_ready', current_step = 'findings', analysis_error = null,
    approved_at = null, reviewed_by = null,
    analysis_metadata = analysis_metadata || coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object(
      'completed_at',completed,'latest_attempt',attempt || jsonb_build_object('outcome','succeeded','finished_at',completed),
      'last_success',jsonb_build_object('id',p_attempt_id,'completed_at',completed,
        'fingerprint',s->>'fingerprint','reference_fingerprint',refs->>'fingerprint',
        'reference_versions',refs->'versions'),
      'baseline_document_count',jsonb_array_length(s->'baseline_ids'),
      'current_document_count',jsonb_array_length(s->'current_ids')),
    updated_at = completed where id = p_review_id and project_id = p_project_id;
  return true;
end;
$$;

-- Existing successful results have no comparison-reference fingerprint and
-- cannot be proven current under the new contract.
update public.assurance_reviews set status = 'evidence_ready', current_step = 'analysis',
  analysis_error = 'Comparison references changed. Run the analysis again.',
  approved_at = null, reviewed_by = null,
  analysis_metadata = analysis_metadata || jsonb_build_object(
    'reference_invalidation', jsonb_build_object('reason', 'Reference fingerprint required', 'at', clock_timestamp())
  ), updated_at = clock_timestamp()
where status in ('findings_ready', 'report_draft', 'approved')
  and analysis_metadata->'last_success'->>'id' is not null
  and analysis_metadata->'last_success'->>'reference_fingerprint' is null;

update public.assurance_reviews set status = 'evidence_ready', current_step = 'analysis',
  analysis_error = 'Comparison references changed during analysis. Run the analysis again.',
  analysis_metadata = jsonb_set(analysis_metadata, '{latest_attempt}',
    analysis_metadata->'latest_attempt' || jsonb_build_object(
      'outcome', 'invalidated', 'finished_at', clock_timestamp()
    )), updated_at = clock_timestamp()
where status = 'analyzing'
  and analysis_metadata->'latest_attempt'->>'outcome' = 'analyzing'
  and analysis_metadata->'latest_attempt'->>'reference_fingerprint' is null;

revoke all on function public.assurance_chunk_contains_label(text,text) from public, anon, authenticated;
revoke all on function public.lock_assurance_review(uuid,uuid) from public, anon, authenticated;
revoke all on function public.assurance_reference_snapshot(uuid,uuid) from public, anon, authenticated;
revoke all on function public.invalidate_assurance_reference_results(uuid) from public, anon, authenticated;
revoke all on function public.accept_cost_baseline(uuid,uuid,date,text) from public, anon, authenticated;
revoke all on function public.replace_assurance_mapping(uuid,text,text,text,text) from public, anon, authenticated;
revoke all on function public.remove_assurance_mapping(uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.assurance_analysis_is_current(uuid,uuid) from public, anon, authenticated;
revoke all on function public.save_assurance_evidence(uuid,uuid,uuid[],uuid[]) from public, anon;
revoke all on function public.get_assurance_analysis_state(uuid,uuid) from public, anon;
revoke all on function public.claim_assurance_analysis(uuid,uuid) from public, anon;
revoke all on function public.finish_assurance_analysis(uuid,uuid,uuid,jsonb,jsonb,jsonb,text) from public, anon;
grant execute on function public.accept_cost_baseline(uuid,uuid,date,text) to authenticated;
grant execute on function public.replace_assurance_mapping(uuid,text,text,text,text) to authenticated;
grant execute on function public.remove_assurance_mapping(uuid,text,uuid) to authenticated;
grant execute on function public.save_assurance_evidence(uuid,uuid,uuid[],uuid[]) to authenticated;
grant execute on function public.get_assurance_analysis_state(uuid,uuid) to authenticated;
grant execute on function public.claim_assurance_analysis(uuid,uuid) to authenticated;
grant execute on function public.finish_assurance_analysis(uuid,uuid,uuid,jsonb,jsonb,jsonb,text) to authenticated;
