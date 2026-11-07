-- Automatic assessment: a durable, fenced queue that turns published evidence
-- into per-cut-off assessments without a human opening the dashboard, and
-- without a single provider request.
--
-- Rules this migration encodes (see .scratch/automatic-project-overview/spec.md):
--   * The trigger lives in the final publication transaction
--     (public.complete_document_job), not in a worker response. A worker
--     checkpoint that never reaches publication never queues an assessment.
--   * Nothing here calls a model, enqueues extraction, or retries an ambiguous
--     extraction group. An assessment consumes published observations,
--     coverage, provenance, and source versions only.
--   * A cut-off is never invented. A document becomes eligible only through its
--     reviewer-confirmed reporting period; upload time, file name, the maximum
--     observation date, and the document date are not cut-offs.
--   * A baseline is only used when a reviewer confirmed the document role or
--     approved the value (cost_baselines stays the approved-baseline source).
--   * Ambiguity and missing evidence become gaps and explicit job failures, per
--     domain. One incomplete domain never blanks out another.
--   * A published snapshot is never rewritten. New input produces a new
--     generation; the older snapshot is marked stale/superseded, not edited.
--   * The queue coalesces by (project, cut-off) with a monotonically increasing
--     generation so no update is lost, claims are fenced by a rotating token,
--     and one project runs at most one assessment at a time.

-- ---------------------------------------------------------------------------
-- Queue and published snapshots
-- ---------------------------------------------------------------------------
create table public.assurance_assessment_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  cutoff date not null,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'succeeded', 'failed')),
  -- Every request for this cut-off bumps the generation. A queued or
  -- in-flight run whose generation is behind republishes; nothing is lost.
  generation bigint not null default 1 check (generation >= 1),
  published_generation bigint check (published_generation is null or published_generation >= 1),
  reason text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  claim_token uuid,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  claimed_fingerprint text,
  claimed_reference_fingerprint text,
  available_at timestamptz not null default now(),
  last_attempted_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, cutoff)
);

create index assurance_assessment_jobs_claim_idx
  on public.assurance_assessment_jobs (status, available_at, created_at)
  where status = 'queued';
create index assurance_assessment_jobs_project_idx
  on public.assurance_assessment_jobs (project_id, status);

create table public.assurance_assessment_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  cutoff date not null,
  generation bigint not null check (generation >= 1),
  -- partial: published on incomplete evidence or coverage; complete: every
  -- domain finding stood on complete, comparable published evidence;
  -- failed: the queue gave up for this cut-off and no snapshot existed;
  -- stale: a published snapshot whose input has since changed.
  status text not null check (status in ('partial', 'complete', 'failed', 'stale')),
  job_id uuid references public.assurance_assessment_jobs(id) on delete set null,
  attempt_id uuid not null,
  fingerprint text not null,
  reference_fingerprint text,
  source_versions jsonb not null default '[]'::jsonb,
  evidence_gaps jsonb not null default '[]'::jsonb,
  coverage jsonb not null default '{}'::jsonb,
  findings jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  published_at timestamptz not null default now(),
  superseded_at timestamptz,
  superseded_by uuid references public.assurance_assessment_snapshots(id) on delete set null,
  unique (project_id, cutoff, generation)
);

create index assurance_assessment_snapshots_live_idx
  on public.assurance_assessment_snapshots (project_id, cutoff desc)
  where superseded_at is null;
create index assurance_assessment_snapshots_project_idx
  on public.assurance_assessment_snapshots (project_id, cutoff desc, generation desc);

alter table public.assurance_assessment_jobs enable row level security;
alter table public.assurance_assessment_snapshots enable row level security;
revoke all on table public.assurance_assessment_jobs, public.assurance_assessment_snapshots
  from public, anon, authenticated;
grant select on table public.assurance_assessment_jobs, public.assurance_assessment_snapshots
  to authenticated;
grant select, insert, update, delete on table public.assurance_assessment_jobs,
  public.assurance_assessment_snapshots to service_role;

create policy "assurance_assessment_jobs_read_by_project_members"
  on public.assurance_assessment_jobs for select to authenticated
  using (public.is_project_member(project_id));
create policy "assurance_assessment_snapshots_read_by_project_members"
  on public.assurance_assessment_snapshots for select to authenticated
  using (public.is_project_member(project_id));

-- ---------------------------------------------------------------------------
-- Reviewer decisions, project scoped. Mirrors
-- assurance_observation_decisions_snapshot's matching rule (a decision only
-- counts while the document still holds the version it was recorded against)
-- without requiring an assurance review: the automatic path has no review.
-- ---------------------------------------------------------------------------
create function public.assurance_assessment_decisions(
  p_project_id uuid,
  p_document_ids uuid[]
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare decisions jsonb;
begin
  with matched as (
    select d.id, d.target_type, d.document_id, d.source_content_hash, d.parser_version,
      d.contract_version, d.observation_fingerprint, d.decision, d.corrected_observation,
      d.reason, d.decided_by, d.decided_at,
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
      and d.document_id = any(coalesce(p_document_ids, '{}'::uuid[]))
      and exists (
        select 1 from public.documents doc
        where doc.id = d.document_id and doc.project_id = d.project_id
          and doc.content_hash = d.source_content_hash
          and doc.assurance_observation_parser_version = d.parser_version
          and doc.assurance_observation_contract_version = d.contract_version
      )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'target_type', m.target_type, 'document_id', m.document_id,
    'source_content_hash', m.source_content_hash, 'parser_version', m.parser_version,
    'contract_version', m.contract_version, 'observation_fingerprint', m.observation_fingerprint,
    'decision', m.decision, 'corrected_observation', m.corrected_observation,
    'reason', m.reason, 'decided_by', m.decided_by, 'decided_at', m.decided_at,
    'observation_ids', m.observation_ids, 'cost_observation_ids', m.cost_observation_ids
  ) order by m.document_id, m.target_type, m.observation_fingerprint, m.id), '[]'::jsonb)
  into decisions
  from matched m
  where jsonb_array_length(m.observation_ids) > 0
     or jsonb_array_length(m.cost_observation_ids) > 0;
  return decisions;
end;
$$;
revoke all on function public.assurance_assessment_decisions(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.assurance_assessment_decisions(uuid, uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- Published-evidence snapshot for one project and one explicit cut-off. This is
-- the automatic path's replacement for assurance_source_snapshot: it never
-- requires a manually selected baseline/current pair, and it never blocks a
-- domain on another domain's missing coverage. Role assignment comes from
-- reviewer-confirmed document metadata only.
-- ---------------------------------------------------------------------------
create function public.assurance_assessment_evidence(p_project_id uuid, p_cutoff date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  sources jsonb;
  gaps jsonb;
begin
  if p_project_id is null or p_cutoff is null then
    raise exception 'A project and an explicit cut-off are required for automatic assessment.';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'Project was not found.';
  end if;

  -- Documents whose role and reporting period a reviewer confirmed, whose
  -- current source version still holds published observations, and whose period
  -- is the newest confirmed period at or before this cut-off for its role.
  with newest as (
  select d.id as document_id, d.confirmed_evidence_role as role, d.confirmed_reporting_period as period
  from public.documents d
  join (
    select d2.confirmed_evidence_role as role, max(d2.confirmed_reporting_period) as period
    from public.documents d2
    where d2.project_id = p_project_id
      and d2.confirmed_evidence_role in ('baseline', 'current')
      and d2.confirmed_reporting_period is not null
      and d2.confirmed_reporting_period <= p_cutoff
      and d2.processing_status in ('completed', 'needs_review')
      and d2.content_hash is not null
      and d2.assurance_observation_parser_version is not null
      and d2.assurance_observation_contract_version is not null
      and (
        d2.processing_status = 'completed'
        -- A needs_review document contributes only when its current version has
        -- validated coverage; that is the same rule the manual evidence picker
        -- applies. A needs_review document without coverage is not evidence yet.
        or exists (
          select 1 from public.assurance_observation_coverage c
          where c.project_id = d2.project_id and c.document_id = d2.id
            and c.source_content_hash = d2.content_hash
            and c.parser_version = d2.assurance_observation_parser_version
            and c.contract_version = d2.assurance_observation_contract_version
        )
      )
      and (
        exists (
          select 1 from public.assurance_observations o
          where o.project_id = d2.project_id and o.document_id = d2.id
            and o.source_content_hash = d2.content_hash
            and o.parser_version = d2.assurance_observation_parser_version
            and o.contract_version = d2.assurance_observation_contract_version
        )
        or exists (
          select 1 from public.cost_observations o
          where o.project_id = d2.project_id and o.document_id = d2.id
            and o.source_content_hash = d2.content_hash
            and o.parser_version = d2.assurance_observation_parser_version
            and o.contract_version = d2.assurance_observation_contract_version
        )
      )
    group by d2.confirmed_evidence_role
  ) newest on newest.role = d.confirmed_evidence_role
    and newest.period = d.confirmed_reporting_period
  where d.project_id = p_project_id
    and d.processing_status in ('completed', 'needs_review')
  )

  select coalesce(jsonb_agg(jsonb_build_object(
    'document_id', d.id,
    'role', c.role,
    'period', c.period,
    'processing_status', d.processing_status,
    'title', d.title,
    -- source_version is the exact published version this snapshot reads; a
    -- version change invalidates the snapshot instead of silently mixing rows.
    'source_version', jsonb_build_object(
      'content_hash', d.content_hash,
      'parser_version', d.assurance_observation_parser_version,
      'contract_version', d.assurance_observation_contract_version
    ),
    'source', jsonb_build_object(
      'title', d.title, 'file_name', d.file_name,
      'document_date', d.document_date,
      'confirmed_document_date', d.confirmed_document_date,
      'confirmed_document_type', d.confirmed_document_type,
      'confirmed_evidence_role', d.confirmed_evidence_role,
      'confirmed_reporting_period', d.confirmed_reporting_period,
      'confirmed_workstream', d.confirmed_workstream
    ),
    'cost_observations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'project_id', o.project_id, 'document_id', o.document_id,
        'source_content_hash', o.source_content_hash, 'parser_version', o.parser_version,
        'contract_version', o.contract_version, 'measure', o.measure, 'source_value', o.source_value,
        'normalized_amount', o.normalized_amount, 'currency', o.currency,
        'scope_level', o.scope_level, 'scope_label', o.scope_label,
        'scope_source_id', o.scope_source_id, 'scope_provenance', o.scope_provenance,
        'wbs_code', o.wbs_code, 'wbs_parent_code', o.wbs_parent_code,
        'wbs_name', o.wbs_name, 'scope_description', o.scope_description,
        'period_label', o.period_label, 'as_of_date', o.as_of_date,
        'status_label', o.status_label, 'evidence_chunk_index', o.evidence_chunk_index,
        'excerpt', o.excerpt, 'page_number', o.page_number, 'section_label', o.section_label,
        'source_location', o.source_location, 'observation_fingerprint', o.observation_fingerprint,
        'evidence_role', c.role
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
        'state', coalesce(cv.state, 'unprocessed'),
        'total_groups', coalesce(cv.total_groups, 0),
        'processed_groups', coalesce(cv.processed_groups, 0),
        'reason', coalesce(cv.reason,
          'No validated observation coverage exists for this source version; re-run extraction.')
      ) order by domains.domain)
      from unnest(array['budget', 'schedule', 'progress', 'risk']::text[]) domains(domain)
      left join public.assurance_observation_coverage cv
        on cv.project_id = p_project_id and cv.document_id = d.id
        and cv.source_content_hash = d.content_hash
        and cv.parser_version = d.assurance_observation_parser_version
        and cv.contract_version = d.assurance_observation_contract_version
        and cv.domain = domains.domain
    )
  ) order by c.role, d.id), '[]'::jsonb)
  into sources
  from newest c
  join public.documents d on d.id = c.document_id and d.project_id = p_project_id;

  -- Why otherwise published evidence is not part of this cut-off. These are
  -- published with the snapshot so a gap is never mistaken for a zero or a
  -- clean result. A document that has not published observations yet is not
  -- evidence and not a gap here; its own processing status shows that.
  with selected as (
    select (value->>'document_id')::uuid as document_id, value->>'role' as role
    from jsonb_array_elements(coalesce(sources, '[]'::jsonb)) as selected_source(value)
  ),
  published_rejections as (
    select jsonb_build_object(
      'document_id', d.id, 'title', d.title,
      'role', d.confirmed_evidence_role, 'reason', reason.text, 'detail', reason.detail
    ) as gap
    from public.documents d
    cross join lateral (
      select 'reporting_period_not_confirmed' as text,
        'No reviewer-confirmed reporting period; the document cannot be placed at a cut-off.' as detail
      where d.confirmed_reporting_period is null
      union all
      select 'evidence_role_not_confirmed',
        'No reviewer-confirmed baseline/current role; confirm the role or select it in a manual review.'
      where d.confirmed_reporting_period is not null and d.confirmed_evidence_role is null
      union all
      select 'evidence_role_supporting',
        'Confirmed as supporting evidence; supporting documents are never a comparison baseline or current source.'
      where d.confirmed_evidence_role = 'supporting'
      union all
      select 'requires_review_without_current_coverage',
        'A needs_review document contributes only with validated coverage for its current source version.'
      where d.processing_status = 'needs_review'
        and not exists (
          select 1 from public.assurance_observation_coverage c
          where c.project_id = d.project_id and c.document_id = d.id
            and c.source_content_hash = d.content_hash
            and c.parser_version = d.assurance_observation_parser_version
            and c.contract_version = d.assurance_observation_contract_version
        )
      union all
      select 'superseded_by_newer_confirmed_period',
        'A newer confirmed reporting period exists for this role at or before the cut-off.'
      where d.confirmed_reporting_period is not null
        and d.confirmed_reporting_period <= p_cutoff
        and d.confirmed_evidence_role in ('baseline', 'current')
        and not exists (select 1 from selected c where c.document_id = d.id)
        and exists (select 1 from selected c where c.role = d.confirmed_evidence_role)
    ) reason
    where d.project_id = p_project_id
      and d.processing_status in ('completed', 'needs_review')
      and d.content_hash is not null
      and d.assurance_observation_parser_version is not null
      and d.assurance_observation_contract_version is not null
      and (
        exists (
          select 1 from public.assurance_observations o
          where o.project_id = d.project_id and o.document_id = d.id
            and o.source_content_hash = d.content_hash
            and o.parser_version = d.assurance_observation_parser_version
            and o.contract_version = d.assurance_observation_contract_version
        )
        or exists (
          select 1 from public.cost_observations o
          where o.project_id = d.project_id and o.document_id = d.id
            and o.source_content_hash = d.content_hash
            and o.parser_version = d.assurance_observation_parser_version
            and o.contract_version = d.assurance_observation_contract_version
        )
      )
  ),
  role_gaps as (
    select jsonb_build_object(
      'document_id', null, 'title', null, 'role', missing.role,
      'reason', missing.role || '_evidence_not_confirmed',
      'detail', 'No document with a reviewer-confirmed ' || missing.role
        || ' role and a reporting period at or before this cut-off is available.'
    ) as gap
    from unnest(array['baseline', 'current']::text[]) missing(role)
    where not exists (select 1 from selected c where c.role = missing.role)
  )
  select coalesce(jsonb_agg(gap order by gap->>'reason', gap->>'document_id'), '[]'::jsonb)
  into gaps
  from (
    select gap from published_rejections where gap->>'reason' is not null
    union all
    select gap from role_gaps
  ) gap_rows;

  return jsonb_build_object(
    'project_id', p_project_id,
    'cutoff', p_cutoff,
    'sources', coalesce(sources, '[]'::jsonb),
    'gaps', gaps,
    'fingerprint', encode(sha256(convert_to(coalesce(sources, '[]'::jsonb)::text, 'UTF8')), 'hex')
  );
end;
$$;
revoke all on function public.assurance_assessment_evidence(uuid, date) from public, anon, authenticated;
grant execute on function public.assurance_assessment_evidence(uuid, date) to service_role;

-- ---------------------------------------------------------------------------
-- Previous comparable cut-off for cross-period claims. The comparison only
-- stands on a published snapshot whose evidence still matches, so an
-- assessment never mixes a previous period's numbers with changed input.
-- ---------------------------------------------------------------------------
create function public.assurance_assessment_prior_risk(p_project_id uuid, p_cutoff date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  previous public.assurance_assessment_snapshots%rowtype;
  evidence jsonb;
  sources jsonb;
  decisions jsonb;
  gap text;
  prior jsonb;
  document_ids uuid[];
begin
  select * into previous
  from public.assurance_assessment_snapshots s
  where s.project_id = p_project_id and s.superseded_at is null
    and s.cutoff < p_cutoff and s.status in ('partial', 'complete')
  order by s.cutoff desc
  limit 1;

  if not found then
    prior := jsonb_build_object(
      'current_cutoff', p_cutoff, 'review', null, 'sources', '[]'::jsonb,
      'observation_decisions', '[]'::jsonb, 'gap_reason', 'no_prior_assessment_snapshot');
    return prior || jsonb_build_object(
      'fingerprint', encode(sha256(convert_to(prior::text, 'UTF8')), 'hex'));
  end if;

  evidence := public.assurance_assessment_evidence(p_project_id, previous.cutoff);
  if evidence->>'fingerprint' is distinct from previous.fingerprint then
    prior := jsonb_build_object(
      'current_cutoff', p_cutoff, 'review', null, 'sources', '[]'::jsonb,
      'observation_decisions', '[]'::jsonb, 'gap_reason', 'prior_snapshot_evidence_changed');
    return prior || jsonb_build_object(
      'fingerprint', encode(sha256(convert_to(prior::text, 'UTF8')), 'hex'));
  end if;

  select coalesce(jsonb_agg(value order by value->>'document_id'), '[]'::jsonb)
  into sources
  from jsonb_array_elements(evidence->'sources') as prior_source(value)
  where value->>'role' = 'current';

  select coalesce(array_agg(distinct (value->>'document_id')::uuid), '{}'::uuid[])
  into document_ids from jsonb_array_elements(sources) as prior_source(value);
  decisions := public.assurance_assessment_decisions(p_project_id, document_ids);

  gap := case when jsonb_array_length(sources) = 0
    then 'prior_snapshot_has_no_current_sources' else null end;

  prior := jsonb_build_object(
    'current_cutoff', p_cutoff,
    -- The previous published snapshot id is the provenance anchor; the
    -- automatic path has no manual review row to point at.
    'review', jsonb_build_object(
      'id', previous.id, 'reporting_period', previous.cutoff,
      'cutoff_precision', 'date', 'status', 'findings_ready'),
    'sources', sources,
    'observation_decisions', decisions,
    'gap_reason', gap);
  return prior || jsonb_build_object(
    'fingerprint', encode(sha256(convert_to(prior::text, 'UTF8')), 'hex'));
end;
$$;
revoke all on function public.assurance_assessment_prior_risk(uuid, date) from public, anon, authenticated;
grant execute on function public.assurance_assessment_prior_risk(uuid, date) to service_role;

-- ---------------------------------------------------------------------------
-- Reference snapshot: approved baselines, accepted mappings, the active
-- progress rule, and the previous cut-off anchor. Any change here re-derives
-- affected cut-offs (triggers below) and lands in the snapshot provenance.
-- ---------------------------------------------------------------------------
create function public.assurance_assessment_reference(p_project_id uuid, p_cutoff date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  baselines jsonb;
  mappings jsonb;
  rule jsonb;
  previous_id uuid;
  previous_cutoff date;
  refs jsonb;
  versions jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'scope_level', b.scope_level, 'scope_label', b.scope_label,
    'amount', b.amount, 'currency', b.currency, 'effective_date', b.effective_date,
    'observation_id', b.observation_id, 'source_document_id', b.source_document_id,
    'approved_at', b.approved_at) order by b.id), '[]'::jsonb)
  into baselines
  from public.cost_baselines b
  where b.project_id = p_project_id and b.state = 'accepted'
    and b.effective_date <= p_cutoff;

  select coalesce(jsonb_agg(jsonb_build_object(
      'kind', m.kind, 'id', m.id, 'source_label', m.source_label,
      'canonical_label', m.canonical_label, 'accepted_at', m.accepted_at) order by m.kind, m.id), '[]'::jsonb)
  into mappings
  from (
    select 'wbs' as kind, w.id, w.source_label, w.canonical_label, w.accepted_at
      from public.wbs_mappings w where w.project_id = p_project_id and w.state = 'accepted'
    union all
    select 'milestone', m.id, m.source_label, m.canonical_label, m.accepted_at
      from public.milestone_mappings m where m.project_id = p_project_id and m.state = 'accepted'
    union all
    select 'risk_identity', r.id, r.source_label, r.canonical_label, r.accepted_at
      from public.risk_identity_mappings r where r.project_id = p_project_id and r.state = 'accepted'
    union all
    select 'risk_scale', s.id, s.source_label, s.canonical_label, s.accepted_at
      from public.risk_scale_mappings s where s.project_id = p_project_id and s.state = 'accepted'
  ) m;

  select jsonb_build_object(
    'id', r.id, 'rule_version', r.rule_version, 'thresholds', r.thresholds,
    'note', r.note, 'approved_by', r.approved_by, 'approved_at', r.approved_at)
  into rule
  from public.progress_rag_rules r
  where r.project_id = p_project_id and r.state = 'active';

  select s.id, s.cutoff into previous_id, previous_cutoff
  from public.assurance_assessment_snapshots s
  where s.project_id = p_project_id and s.superseded_at is null
    and s.cutoff < p_cutoff and s.status in ('partial', 'complete')
  order by s.cutoff desc limit 1;

  refs := jsonb_build_object(
    'cost_baselines', baselines, 'mappings', mappings, 'progress_rag_rule', rule,
    'previous_snapshot_id', previous_id, 'previous_snapshot_cutoff', previous_cutoff);
  versions := jsonb_build_object(
    'cost_baseline_ids', coalesce((select jsonb_agg(b.value->'id' order by b.value->>'id')
      from jsonb_array_elements(baselines) b(value)), '[]'::jsonb),
    'mapping_ids', coalesce((select jsonb_agg(m.value->'id' order by m.value->>'id')
      from jsonb_array_elements(mappings) m(value)), '[]'::jsonb),
    'progress_rag_rule_id', rule->'id',
    'progress_rag_rule_version', rule->>'rule_version',
    'previous_snapshot_id', previous_id);
  return jsonb_build_object(
    'fingerprint', encode(sha256(convert_to(refs::text, 'UTF8')), 'hex'),
    'versions', versions, 'references', refs);
end;
$$;
revoke all on function public.assurance_assessment_reference(uuid, date) from public, anon, authenticated;
grant execute on function public.assurance_assessment_reference(uuid, date) to service_role;

-- ---------------------------------------------------------------------------
-- Queueing. Coalescing keeps one row per (project, cut-off): a new request
-- bumps the generation (so an in-flight run republishes instead of dropping the
-- update) and marks the live snapshot stale. No request is ever discarded.
-- ---------------------------------------------------------------------------
create function public.enqueue_assurance_assessment(
  p_project_id uuid,
  p_cutoff date,
  p_reason text default 'publication'
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  job public.assurance_assessment_jobs%rowtype;
begin
  if p_project_id is null or p_cutoff is null then
    raise exception 'A project and an explicit cut-off are required to queue an assessment.';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'Project was not found.';
  end if;

  -- One statement: a concurrent publication for the same project and cut-off
  -- coalesces here instead of raising a unique violation inside publication.
  insert into public.assurance_assessment_jobs (project_id, cutoff, reason)
  values (p_project_id, p_cutoff, left(coalesce(p_reason, 'publication'), 200))
  on conflict (project_id, cutoff) do update
  set generation = public.assurance_assessment_jobs.generation + 1,
      reason = excluded.reason,
      -- A new request is a new, genuine event: give it a fresh attempt budget
      -- and queue it again so a succeeded or failed run is re-derived.
      status = case
        when public.assurance_assessment_jobs.status = 'processing' then 'processing'
        else 'queued' end,
      attempt_count = 0,
      last_error = null,
      available_at = case
        when public.assurance_assessment_jobs.status = 'processing'
          then public.assurance_assessment_jobs.available_at
        else now() end,
      updated_at = now()
  returning * into job;

  update public.assurance_assessment_snapshots
  set status = 'stale',
      metadata = metadata || jsonb_build_object(
        'stale_at', now(), 'stale_reason', left(coalesce(p_reason, 'publication'), 200))
  where project_id = p_project_id and cutoff = p_cutoff
    and superseded_at is null and status in ('partial', 'complete');

  return job.generation;
end;
$$;
revoke all on function public.enqueue_assurance_assessment(uuid, date, text) from public, anon, authenticated;
grant execute on function public.enqueue_assurance_assessment(uuid, date, text) to service_role;

-- Every known cut-off at or after a changed one: the changed period itself plus
-- later periods that depend on it (backfill, correction, reference change).
create function public.signal_assurance_assessment_from(
  p_project_id uuid,
  p_cutoff date,
  p_reason text
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  affected date;
  queued integer := 0;
begin
  if p_project_id is null or p_cutoff is null then
    return 0;
  end if;
  for affected in
    select distinct known.cutoff
    from (
      select j.cutoff from public.assurance_assessment_jobs j where j.project_id = p_project_id
      union
      select s.cutoff from public.assurance_assessment_snapshots s where s.project_id = p_project_id
      union
      select d.confirmed_reporting_period from public.documents d
        where d.project_id = p_project_id and d.confirmed_reporting_period is not null
    ) known
    where known.cutoff >= p_cutoff
    order by known.cutoff
  loop
    perform public.enqueue_assurance_assessment(p_project_id, affected, p_reason);
    queued := queued + 1;
  end loop;
  return queued;
end;
$$;
revoke all on function public.signal_assurance_assessment_from(uuid, date, text)
  from public, anon, authenticated;
grant execute on function public.signal_assurance_assessment_from(uuid, date, text) to service_role;

create function public.signal_assurance_assessment_all(p_project_id uuid, p_reason text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  earliest date;
begin
  select min(known.cutoff) into earliest
  from (
    select j.cutoff from public.assurance_assessment_jobs j where j.project_id = p_project_id
    union
    select s.cutoff from public.assurance_assessment_snapshots s where s.project_id = p_project_id
    union
    select d.confirmed_reporting_period from public.documents d
      where d.project_id = p_project_id and d.confirmed_reporting_period is not null
  ) known;
  if earliest is null then
    return 0;
  end if;
  return public.signal_assurance_assessment_from(p_project_id, earliest, p_reason);
end;
$$;
revoke all on function public.signal_assurance_assessment_all(uuid, text) from public, anon, authenticated;
grant execute on function public.signal_assurance_assessment_all(uuid, text) to service_role;

-- The publication signal. A document only participates when a reviewer
-- confirmed its reporting period; the upload date, the file name, the maximum
-- observation date, and the document date are never used as a cut-off.
create function public.signal_assurance_assessment_for_document(
  p_project_id uuid,
  p_document_id uuid,
  p_reason text default 'document_publication'
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  cutoff date;
begin
  if p_project_id is null or p_document_id is null then
    return 0;
  end if;
  select d.confirmed_reporting_period into cutoff
  from public.documents d
  where d.id = p_document_id and d.project_id = p_project_id;
  if cutoff is null then
    return 0;
  end if;
  return public.signal_assurance_assessment_from(p_project_id, cutoff, p_reason);
end;
$$;
revoke all on function public.signal_assurance_assessment_for_document(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.signal_assurance_assessment_for_document(uuid, uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Durable signal inside the final publication transaction. n8n calls
-- rpc/complete_document_job; the assessment request commits with the published
-- observations or not at all.
-- ---------------------------------------------------------------------------
alter function public.complete_document_job(uuid, uuid, jsonb)
  rename to complete_document_job_publication_guard;
revoke all on function public.complete_document_job_publication_guard(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

create function public.complete_document_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_result jsonb
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  outcome jsonb;
  published_job public.ai_jobs%rowtype;
begin
  outcome := public.complete_document_job_publication_guard(p_job_id, p_claim_token, p_result);

  -- Only a real publication queues an assessment. An idempotent repeat
  -- ('already_completed') publishes nothing new and must not bump a generation.
  if outcome->>'status' = 'completed' then
    select * into published_job from public.ai_jobs where id = p_job_id;
    if found then
      perform public.signal_assurance_assessment_for_document(
        published_job.project_id, published_job.document_id, 'document_publication');
    end if;
  end if;

  return outcome;
end;
$$;
revoke all on function public.complete_document_job(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_document_job(uuid, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Re-derive on reference changes. These fire on commits made by the existing
-- review paths (reviewer decisions, baseline approval, mapping acceptance, rule
-- approval) and on backfill; they only queue work, never compute.
-- ---------------------------------------------------------------------------
create function public.signal_assessment_after_observation_decision()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  project uuid;
  document uuid;
  cutoff date;
begin
  if tg_op = 'DELETE' then
    project := old.project_id;
    document := old.document_id;
  else
    project := new.project_id;
    document := new.document_id;
  end if;
  select d.confirmed_reporting_period into cutoff
  from public.documents d where d.id = document and d.project_id = project;
  perform public.signal_assurance_assessment_from(project, cutoff, 'observation_decision');
  return null;
end;
$$;
revoke all on function public.signal_assessment_after_observation_decision()
  from public, anon, authenticated;
grant execute on function public.signal_assessment_after_observation_decision() to service_role;
create trigger assurance_observation_decisions_assessment_signal
  after insert or update or delete on public.assurance_observation_decisions
  for each row execute function public.signal_assessment_after_observation_decision();

create function public.signal_assessment_after_cost_baseline()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  project uuid;
  effective date;
begin
  if tg_op = 'DELETE' then
    project := old.project_id;
    effective := old.effective_date;
  else
    project := new.project_id;
    effective := new.effective_date;
  end if;
  -- An approved baseline changes every cut-off it is effective for or later.
  perform public.signal_assurance_assessment_from(project, effective, 'cost_baseline_change');
  return null;
end;
$$;
revoke all on function public.signal_assessment_after_cost_baseline() from public, anon, authenticated;
grant execute on function public.signal_assessment_after_cost_baseline() to service_role;
create trigger cost_baselines_assessment_signal
  after insert or update or delete on public.cost_baselines
  for each row execute function public.signal_assessment_after_cost_baseline();

create function public.signal_assessment_after_mapping()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  project uuid;
begin
  if tg_op = 'DELETE' then
    project := old.project_id;
  else
    project := new.project_id;
  end if;
  -- An accepted mapping applies wherever its label appears, so every known
  -- cut-off is re-derived.
  perform public.signal_assurance_assessment_all(project, 'mapping_change');
  return null;
end;
$$;
revoke all on function public.signal_assessment_after_mapping() from public, anon, authenticated;
grant execute on function public.signal_assessment_after_mapping() to service_role;
create trigger wbs_mappings_assessment_signal
  after insert or update or delete on public.wbs_mappings
  for each row execute function public.signal_assessment_after_mapping();
create trigger milestone_mappings_assessment_signal
  after insert or update or delete on public.milestone_mappings
  for each row execute function public.signal_assessment_after_mapping();
create trigger risk_identity_mappings_assessment_signal
  after insert or update or delete on public.risk_identity_mappings
  for each row execute function public.signal_assessment_after_mapping();
create trigger risk_scale_mappings_assessment_signal
  after insert or update or delete on public.risk_scale_mappings
  for each row execute function public.signal_assessment_after_mapping();

create function public.signal_assessment_after_progress_rag_rule()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  project uuid;
begin
  if tg_op = 'DELETE' then
    project := old.project_id;
  else
    project := new.project_id;
  end if;
  perform public.signal_assurance_assessment_all(project, 'progress_rag_rule_change');
  return null;
end;
$$;
revoke all on function public.signal_assessment_after_progress_rag_rule()
  from public, anon, authenticated;
grant execute on function public.signal_assessment_after_progress_rag_rule() to service_role;
create trigger progress_rag_rules_assessment_signal
  after insert or update or delete on public.progress_rag_rules
  for each row execute function public.signal_assessment_after_progress_rag_rule();

create function public.signal_assessment_after_document_confirmation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Confirming (or clearing) the role or the reporting period changes which
  -- documents a cut-off may use.
  if new.confirmed_reporting_period is not null then
    perform public.signal_assurance_assessment_from(
      new.project_id, new.confirmed_reporting_period, 'document_confirmation');
  else
    perform public.signal_assurance_assessment_all(new.project_id, 'document_confirmation');
  end if;
  return null;
end;
$$;
revoke all on function public.signal_assessment_after_document_confirmation()
  from public, anon, authenticated;
grant execute on function public.signal_assessment_after_document_confirmation() to service_role;
create trigger documents_assessment_signal
  after update of confirmed_reporting_period, confirmed_evidence_role on public.documents
  for each row
  when (old.confirmed_reporting_period is distinct from new.confirmed_reporting_period
     or old.confirmed_evidence_role is distinct from new.confirmed_evidence_role)
  execute function public.signal_assessment_after_document_confirmation();

-- ---------------------------------------------------------------------------
-- Recovery: requeue expired leases with backoff, give up after max_attempts.
-- Runs without an open dashboard and without any provider request.
-- ---------------------------------------------------------------------------
create function public.recover_expired_assurance_assessment_jobs()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  expired public.assurance_assessment_jobs%rowtype;
  recovered integer := 0;
begin
  for expired in
    select * from public.assurance_assessment_jobs j
    where j.status = 'processing'
      and coalesce(j.lease_expires_at, j.claimed_at + interval '10 minutes') < now()
    for update skip locked
  loop
    if expired.attempt_count < expired.max_attempts then
      update public.assurance_assessment_jobs
      set status = 'queued', claim_token = null, claimed_at = null, lease_expires_at = null,
          available_at = now() + (least(expired.attempt_count, 6) * interval '2 minutes'),
          last_error = 'Assessment attempt lease expired before completion.',
          updated_at = now()
      where id = expired.id;
    else
      update public.assurance_assessment_jobs
      set status = 'failed', claim_token = null, claimed_at = null, lease_expires_at = null,
          last_error = 'Assessment attempt lease expired and the retry limit was reached.',
          updated_at = now()
      where id = expired.id;
      perform public.record_assessment_failure(expired.id,
        'Assessment attempt lease expired and the retry limit was reached.');
    end if;
    recovered := recovered + 1;
  end loop;
  return recovered;
end;
$$;
revoke all on function public.recover_expired_assurance_assessment_jobs()
  from public, anon, authenticated;
grant execute on function public.recover_expired_assurance_assessment_jobs() to service_role;

-- A permanent failure is durable per cut-off: a failed snapshot when none was
-- published, a stale marker (never a rewrite) when one was.
create function public.record_assessment_failure(p_job_id uuid, p_error text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  failed_job public.assurance_assessment_jobs%rowtype;
begin
  select * into failed_job from public.assurance_assessment_jobs where id = p_job_id;
  if not found then
    return;
  end if;
  if exists (
    select 1 from public.assurance_assessment_snapshots s
    where s.project_id = failed_job.project_id and s.cutoff = failed_job.cutoff
      and s.superseded_at is null
  ) then
    update public.assurance_assessment_snapshots
    set status = 'stale',
        metadata = metadata || jsonb_build_object(
          'failed_at', now(), 'failure', left(coalesce(p_error, 'Assessment failed.'), 1000))
    where project_id = failed_job.project_id and cutoff = failed_job.cutoff
      and superseded_at is null and status in ('partial', 'complete');
  else
    insert into public.assurance_assessment_snapshots (
      project_id, cutoff, generation, status, job_id, attempt_id, fingerprint,
      reference_fingerprint, metadata
    ) values (
      failed_job.project_id, failed_job.cutoff, failed_job.generation, 'failed', failed_job.id,
      coalesce(failed_job.claim_token, gen_random_uuid()),
      encode(sha256(convert_to('failed:' || failed_job.id::text, 'UTF8')), 'hex'),
      failed_job.claimed_reference_fingerprint,
      jsonb_build_object('failure', left(coalesce(p_error, 'Assessment failed.'), 1000),
        'failed_at', now())
    )
    on conflict (project_id, cutoff, generation) do nothing;
  end if;
end;
$$;
revoke all on function public.record_assessment_failure(uuid, text) from public, anon, authenticated;
grant execute on function public.record_assessment_failure(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Fenced claim. One assessment per project at a time; expired leases are
-- recovered first so a dead attempt never blocks a project.
-- ---------------------------------------------------------------------------
create function public.claim_next_assurance_assessment_job(p_worker text default 'scheduler')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  job public.assurance_assessment_jobs%rowtype;
  evidence jsonb;
  reference jsonb;
  prior jsonb;
  decisions jsonb;
  token uuid := gen_random_uuid();
  document_ids uuid[];
begin
  perform public.recover_expired_assurance_assessment_jobs();
  -- A single claim lock is deliberate: assessment volume is one run per project
  -- per cut-off, and a global lock is the smallest correct admission control.
  perform pg_advisory_xact_lock(hashtext('assurance_assessment_claim'));

  select * into job
  from public.assurance_assessment_jobs candidate
  where candidate.status = 'queued'
    and candidate.available_at <= now()
    -- Project isolation: never two concurrent assessments of one project, so a
    -- project's previous cut-off is always complete before the next one runs.
    and not exists (
      select 1 from public.assurance_assessment_jobs active
      where active.project_id = candidate.project_id and active.status = 'processing'
    )
  order by candidate.available_at, candidate.created_at, candidate.id
  limit 1
  for update skip locked;

  if not found then
    return null;
  end if;

  evidence := public.assurance_assessment_evidence(job.project_id, job.cutoff);
  reference := public.assurance_assessment_reference(job.project_id, job.cutoff);
  prior := public.assurance_assessment_prior_risk(job.project_id, job.cutoff);
  select coalesce(array_agg(distinct (value->>'document_id')::uuid), '{}'::uuid[])
  into document_ids
  from jsonb_array_elements(evidence->'sources') as evidence_source(value);
  decisions := public.assurance_assessment_decisions(job.project_id, document_ids);

  update public.assurance_assessment_jobs
  set status = 'processing',
      attempt_count = attempt_count + 1,
      claim_token = token,
      claimed_at = now(),
      lease_expires_at = now() + interval '10 minutes',
      last_attempted_at = now(),
      claimed_fingerprint = evidence->>'fingerprint',
      claimed_reference_fingerprint = reference->>'fingerprint',
      updated_at = now()
  where id = job.id
  returning * into job;

  return jsonb_build_object(
    'job_id', job.id,
    'claim_token', token,
    'generation', job.generation,
    'project_id', job.project_id,
    'cutoff', job.cutoff,
    'fingerprint', evidence->>'fingerprint',
    'sources', evidence->'sources',
    'evidence_gaps', evidence->'gaps',
    'observation_decisions', decisions,
    'reference_fingerprint', reference->>'fingerprint',
    'reference_versions', reference->'versions',
    'references', reference->'references',
    'progress_rag_rule', reference->'references'->'progress_rag_rule',
    'prior_risk_snapshot', prior
  );
end;
$$;
revoke all on function public.claim_next_assurance_assessment_job(text) from public, anon, authenticated;
grant execute on function public.claim_next_assurance_assessment_job(text) to service_role;

-- ---------------------------------------------------------------------------
-- Fenced publication. The claim token, the generation, and the evidence
-- fingerprint are re-checked inside this transaction; changed input republishes
-- instead of publishing a stale result.
-- ---------------------------------------------------------------------------
create function public.publish_assurance_assessment_snapshot(
  p_job_id uuid,
  p_claim_token uuid,
  p_generation bigint,
  p_findings jsonb,
  p_actions jsonb default '[]'::jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  job public.assurance_assessment_jobs%rowtype;
  evidence jsonb;
  snapshot_id uuid := gen_random_uuid();
  snapshot_status text;
  domains_present integer;
  coverage_complete boolean;
  pending_generation boolean;
begin
  if p_job_id is null or p_claim_token is null or p_generation is null then
    raise exception 'A job, its claim token, and its generation are required.';
  end if;
  if jsonb_typeof(p_findings) is distinct from 'array' then
    raise exception 'Assessment findings must be an array.';
  end if;
  if jsonb_typeof(coalesce(p_actions, '[]'::jsonb)) is distinct from 'array'
    or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) is distinct from 'object' then
    raise exception 'Assessment actions and metadata have an unsupported shape.';
  end if;

  select * into job from public.assurance_assessment_jobs where id = p_job_id for update;
  if not found then
    raise exception 'Assessment job was not found.';
  end if;
  if job.claim_token is null or job.claim_token <> p_claim_token or job.status <> 'processing' then
    raise exception 'Assessment publication rejected: this attempt lost ownership of the job.';
  end if;
  if job.lease_expires_at is null or job.lease_expires_at < now() then
    raise exception 'Assessment publication rejected: the attempt lease has expired.';
  end if;

  pending_generation := job.generation > p_generation;
  if pending_generation then
    update public.assurance_assessment_jobs
    set status = 'queued', claim_token = null, claimed_at = null, lease_expires_at = null,
        available_at = now(), last_error = null, updated_at = now()
    where id = job.id;
    return jsonb_build_object('status', 'requeued', 'reason', 'input_changed',
      'job_id', job.id, 'generation', job.generation);
  end if;

  evidence := public.assurance_assessment_evidence(job.project_id, job.cutoff);
  if evidence->>'fingerprint' is distinct from job.claimed_fingerprint then
    -- Evidence changed during the run: republish from the new input instead of
    -- recording a result that no longer matches what was assessed.
    update public.assurance_assessment_jobs
    set status = 'queued', claim_token = null, claimed_at = null, lease_expires_at = null,
        available_at = now(), last_error = null, updated_at = now()
    where id = job.id;
    return jsonb_build_object('status', 'requeued', 'reason', 'evidence_changed',
      'job_id', job.id, 'generation', job.generation);
  end if;

  select count(distinct value->>'domain') into domains_present
  from jsonb_array_elements(p_findings) as finding(value)
  where value->>'domain' in ('budget', 'schedule', 'risk');
  if jsonb_array_length(p_findings) <> 3 or domains_present <> 3 then
    raise exception 'Publish Budget, Schedule, and Risk exactly once.';
  end if;

  -- complete = every domain finding stands on processed coverage for every
  -- source and no domain was downgraded to a coverage gap. Anything else is
  -- published as partial so an incomplete result is never shown as complete.
  coverage_complete := not exists (
    select 1
    from jsonb_array_elements(evidence->'sources') as evidence_source(value)
    cross join unnest(array['budget', 'schedule', 'progress', 'risk']::text[]) as domain(name)
    left join lateral (
      select coverage_row as row
      from jsonb_array_elements(value->'assurance_observation_coverage')
        as coverage_entry(coverage_row)
      where coverage_row->>'domain' = name
    ) coverage on true
    where value->'assurance_observation_coverage' is null
      or coverage.row is null
      or coverage.row->>'state' <> 'processed'
  );
  snapshot_status := case
    when coverage_complete
      and jsonb_array_length(coalesce(evidence->'gaps', '[]'::jsonb)) = 0
      and not exists (
        select 1 from jsonb_array_elements(p_findings) as finding(value)
        where value->>'condition' = 'more_evidence_required')
    then 'complete'
    else 'partial'
  end;

  update public.assurance_assessment_snapshots
  set superseded_at = now(), superseded_by = snapshot_id
  where project_id = job.project_id and cutoff = job.cutoff and superseded_at is null;

  insert into public.assurance_assessment_snapshots (
    id, project_id, cutoff, generation, status, job_id, attempt_id, fingerprint,
    reference_fingerprint, source_versions, evidence_gaps, coverage, findings, actions, metadata
  ) values (
    snapshot_id, job.project_id, job.cutoff, p_generation, snapshot_status, job.id, p_claim_token,
    evidence->>'fingerprint', job.claimed_reference_fingerprint,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'document_id', value->>'document_id', 'role', value->>'role',
        'period', value->>'period', 'processing_status', value->>'processing_status',
        'content_hash', value->'source_version'->>'content_hash',
        'parser_version', value->'source_version'->>'parser_version',
        'contract_version', value->'source_version'->>'contract_version')
        order by value->>'role', value->>'document_id')
      from jsonb_array_elements(evidence->'sources') as evidence_source(value)), '[]'::jsonb),
    coalesce(evidence->'gaps', '[]'::jsonb),
    coalesce(p_metadata->'coverage', '{}'::jsonb),
    p_findings, coalesce(p_actions, '[]'::jsonb),
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'cutoff', job.cutoff, 'generation', p_generation,
      'published_status', snapshot_status, 'coverage_complete', coverage_complete,
      'source_count', jsonb_array_length(evidence->'sources'),
      'attempt_count', job.attempt_count, 'enqueue_reason', job.reason)
  );

  update public.assurance_assessment_jobs
  set published_generation = p_generation,
      -- If input changed while this run was publishing, the newer generation
      -- stays queued so the update is never lost.
      status = case when generation > p_generation then 'queued' else 'succeeded' end,
      claim_token = null, claimed_at = null, lease_expires_at = null,
      available_at = case when generation > p_generation then now() else available_at end,
      last_error = null, updated_at = now()
  where id = job.id;

  return jsonb_build_object(
    'status', 'published', 'job_id', job.id, 'snapshot_id', snapshot_id,
    'snapshot_status', snapshot_status, 'generation', p_generation,
    'pending_generation', job.generation);
end;
$$;
revoke all on function public.publish_assurance_assessment_snapshot(uuid, uuid, bigint, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.publish_assurance_assessment_snapshot(uuid, uuid, bigint, jsonb, jsonb, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- Fenced failure. A retryable failure requeues with backoff while the attempt
-- still owns its lease; a permanent one is durable per cut-off.
-- ---------------------------------------------------------------------------
create function public.fail_assurance_assessment_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_error text,
  p_retryable boolean default true
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  job public.assurance_assessment_jobs%rowtype;
  message text := left(coalesce(p_error, 'Assessment failed.'), 1000);
begin
  select * into job from public.assurance_assessment_jobs where id = p_job_id for update;
  if not found then
    raise exception 'Assessment job was not found.';
  end if;
  -- A lost or expired claim is not this attempt's failure to report; recovery
  -- owns the row from here.
  if job.claim_token is null or job.claim_token <> p_claim_token or job.status <> 'processing'
    or job.lease_expires_at is null or job.lease_expires_at < now() then
    return jsonb_build_object('status', 'lost', 'job_id', job.id);
  end if;

  if p_retryable and job.attempt_count < job.max_attempts then
    update public.assurance_assessment_jobs
    set status = 'queued', claim_token = null, claimed_at = null, lease_expires_at = null,
        available_at = now() + (least(job.attempt_count, 6) * interval '2 minutes'),
        last_error = message, updated_at = now()
    where id = job.id;
    return jsonb_build_object('status', 'retry_scheduled', 'job_id', job.id,
      'attempt_count', job.attempt_count, 'max_attempts', job.max_attempts);
  end if;

  update public.assurance_assessment_jobs
  set status = 'failed', claim_token = null, claimed_at = null, lease_expires_at = null,
      last_error = message, updated_at = now()
  where id = job.id;
  perform public.record_assessment_failure(job.id, message);
  return jsonb_build_object('status', 'failed', 'job_id', job.id);
end;
$$;
revoke all on function public.fail_assurance_assessment_job(uuid, uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.fail_assurance_assessment_job(uuid, uuid, text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- Read surface for overview and report consumers: the live snapshot per
-- cut-off plus its queue state, and the list of available cut-offs.
-- ---------------------------------------------------------------------------
create function public.get_latest_assessment_snapshot(
  p_project_id uuid,
  p_cutoff date default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target date := p_cutoff;
  snapshot jsonb;
  job jsonb;
begin
  if auth.uid() is null or not public.is_project_member(p_project_id) then
    raise exception 'Project membership is required.';
  end if;
  if target is null then
    select max(cutoff) into target from (
      select s.cutoff from public.assurance_assessment_snapshots s
        where s.project_id = p_project_id and s.superseded_at is null
      union all
      select j.cutoff from public.assurance_assessment_jobs j where j.project_id = p_project_id
    ) known;
  end if;
  if target is null then
    return jsonb_build_object('project_id', p_project_id, 'cutoff', null,
      'status', 'none', 'snapshot', null, 'job', null);
  end if;

  select to_jsonb(s) into snapshot
  from public.assurance_assessment_snapshots s
  where s.project_id = p_project_id and s.cutoff = target and s.superseded_at is null
  order by s.generation desc limit 1;
  select to_jsonb(j) into job
  from public.assurance_assessment_jobs j
  where j.project_id = p_project_id and j.cutoff = target;

  return jsonb_build_object(
    'project_id', p_project_id,
    'cutoff', target,
    'status', coalesce(snapshot->>'status', job->>'status', 'none'),
    'pending_generation', coalesce(job->>'generation', '0')::bigint
      > coalesce(job->>'published_generation', '0')::bigint,
    'snapshot', snapshot,
    'job', job);
end;
$$;
revoke all on function public.get_latest_assessment_snapshot(uuid, date) from public, anon;
grant execute on function public.get_latest_assessment_snapshot(uuid, date) to authenticated;
grant execute on function public.get_latest_assessment_snapshot(uuid, date) to service_role;

create function public.get_project_assessment_periods(p_project_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare periods jsonb;
begin
  if auth.uid() is null or not public.is_project_member(p_project_id) then
    raise exception 'Project membership is required.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'cutoff', known.cutoff,
      'snapshot_id', known.snapshot_id,
      'status', coalesce(known.snapshot_status, known.job_status, 'none'),
      'published_at', known.published_at,
      'fingerprint', known.fingerprint,
      'job_status', known.job_status,
      'pending', known.pending
    ) order by known.cutoff desc), '[]'::jsonb)
  into periods
  from (
    select coalesce(s.cutoff, j.cutoff) as cutoff,
      s.id as snapshot_id,
      s.status as snapshot_status,
      s.published_at,
      s.fingerprint,
      j.status as job_status,
      coalesce(j.generation, 0) > coalesce(j.published_generation, 0) as pending
    from public.assurance_assessment_snapshots s
    full join public.assurance_assessment_jobs j
      on j.project_id = s.project_id and j.cutoff = s.cutoff
    where coalesce(s.project_id, j.project_id) = p_project_id
      and (s.id is null or s.superseded_at is null)
  ) known;
  return periods;
end;
$$;
revoke all on function public.get_project_assessment_periods(uuid) from public, anon;
grant execute on function public.get_project_assessment_periods(uuid) to authenticated;
grant execute on function public.get_project_assessment_periods(uuid) to service_role;
