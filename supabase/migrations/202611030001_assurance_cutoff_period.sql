-- A review's cut-off is now a single date, not a month. New reviews carry
-- cutoff_precision = 'date'; legacy month-scoped reviews keep 'month' (the
-- column default), so their period_end remains the last day of the reporting
-- month and historical baseline/overdue semantics are unchanged.

alter table public.assurance_reviews
  add column if not exists cutoff_precision text not null default 'month';

create or replace function public.assurance_reference_snapshot(p_project_id uuid, p_review_id uuid)
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
    case when r.cutoff_precision = 'date' then r.reporting_period
         else (date_trunc('month', r.reporting_period::timestamp) + interval '1 month - 1 day')::date
    end
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
