-- Ticket 03: assurance evaluates complete, source-validated grouped observations,
-- never raw selected document text. Historical versions remain auditable; only
-- the document's current source/parser/contract tuple is eligible for analysis.

alter table public.documents
  add column assurance_observation_parser_version text,
  add column assurance_observation_contract_version text;

alter table public.cost_observations
  add column source_content_hash text,
  add column parser_version text,
  add column contract_version text;

alter table public.cost_observations
  add constraint cost_observations_source_hash_check
    check (source_content_hash is null or source_content_hash ~ '^[0-9a-f]{64}$'),
  add constraint cost_observations_parser_version_check
    check (parser_version is null or length(parser_version) between 1 and 100),
  add constraint cost_observations_contract_version_check
    check (contract_version is null or length(contract_version) between 1 and 100);

drop index if exists public.cost_observations_scope_identity_idx;
create unique index cost_observations_versioned_scope_identity_idx
  on public.cost_observations (
    document_id,
    source_content_hash,
    parser_version,
    contract_version,
    measure,
    scope_level,
    evidence_chunk_index,
    source_value,
    coalesce(scope_label, '')
  ) where source_content_hash is not null;

create table public.assurance_observations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  source_content_hash text not null check (source_content_hash ~ '^[0-9a-f]{64}$'),
  parser_version text not null check (length(parser_version) between 1 and 100),
  contract_version text not null check (length(contract_version) between 1 and 100),
  domain text not null check (domain in ('schedule', 'progress', 'risk')),
  observation_type text not null check (observation_type in ('milestone', 'progress', 'risk_snapshot', 'risk_register_statement')),
  observation jsonb not null check (jsonb_typeof(observation) = 'object'),
  evidence_chunk_index integer not null check (evidence_chunk_index >= 0),
  excerpt text not null check (length(excerpt) between 1 and 5000),
  page_number integer check (page_number is null or page_number >= 1),
  section_label text,
  source_location jsonb,
  created_at timestamptz not null default now(),
  check (
    (domain = 'schedule' and observation_type = 'milestone') or
    (domain = 'progress' and observation_type = 'progress') or
    (domain = 'risk' and observation_type in ('risk_snapshot', 'risk_register_statement'))
  )
);

create index assurance_observations_current_source_idx
  on public.assurance_observations
  (document_id, source_content_hash, parser_version, contract_version, domain);

create table public.assurance_observation_coverage (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  source_content_hash text not null check (source_content_hash ~ '^[0-9a-f]{64}$'),
  parser_version text not null check (length(parser_version) between 1 and 100),
  contract_version text not null check (length(contract_version) between 1 and 100),
  domain text not null check (domain in ('budget', 'schedule', 'progress', 'risk')),
  state text not null check (state in ('processed', 'unprocessed', 'ambiguous_conflicting', 'absent')),
  total_groups integer not null check (total_groups >= 0),
  processed_groups integer not null check (processed_groups >= 0 and processed_groups <= total_groups),
  reason text check (reason is null or length(reason) <= 1500),
  created_at timestamptz not null default now(),
  unique (document_id, source_content_hash, parser_version, contract_version, domain)
);

create index assurance_observation_coverage_current_source_idx
  on public.assurance_observation_coverage
  (document_id, source_content_hash, parser_version, contract_version, domain);

alter table public.assurance_observations enable row level security;
alter table public.assurance_observation_coverage enable row level security;
revoke all on table public.assurance_observations, public.assurance_observation_coverage from anon, authenticated;
grant select on table public.assurance_observations, public.assurance_observation_coverage to authenticated;
grant select, insert, update, delete on table public.assurance_observations, public.assurance_observation_coverage to service_role;

create policy "assurance_observations_read_by_project_members"
  on public.assurance_observations for select to authenticated
  using (public.is_project_member(project_id));
create policy "assurance_observation_coverage_read_by_project_members"
  on public.assurance_observation_coverage for select to authenticated
  using (public.is_project_member(project_id));

-- Replace the document-wide delete with a source/parser/contract-scoped write.
drop function public.persist_cost_observations(uuid, uuid, jsonb);
create function public.persist_cost_observations(
  p_job_id uuid,
  p_claim_token uuid,
  p_source_content_hash text,
  p_parser_version text,
  p_contract_version text,
  p_observations jsonb
)
returns integer language plpgsql security definer set search_path = public as $$
declare
  job public.ai_jobs%rowtype;
  stored_hash text;
  observation jsonb;
  saved integer := 0;
begin
  perform public.assert_document_job_owner(p_job_id, p_claim_token);
  select * into job from public.ai_jobs where id = p_job_id;
  if p_source_content_hash is null or p_source_content_hash !~ '^[0-9a-f]{64}$'
    or p_parser_version is null or length(p_parser_version) not between 1 and 100
    or p_contract_version is distinct from 'pmo-assurance-observations/1'
    or jsonb_typeof(p_observations) is distinct from 'array' then
    raise exception 'Cost observation source version or payload is invalid.';
  end if;
  select d.content_hash into stored_hash from public.documents d
    where d.id = job.document_id and d.project_id = job.project_id for update;
  if not found or (stored_hash is not null and stored_hash <> p_source_content_hash) then
    raise exception 'Cost observations do not match the document source version.';
  end if;

  delete from public.cost_observations
  where project_id = job.project_id and document_id = job.document_id
    and source_content_hash = p_source_content_hash and parser_version = p_parser_version
    and contract_version = p_contract_version;

  for observation in select value from jsonb_array_elements(p_observations)
  loop
    insert into public.cost_observations (
      project_id, document_id, measure, source_value, normalized_amount, currency,
      scope_level, scope_label, wbs_code, wbs_parent_code, wbs_name, scope_description,
      period_label, as_of_date, status_label, evidence_chunk_index, excerpt,
      page_number, section_label, source_location, provider, model,
      source_content_hash, parser_version, contract_version
    ) values (
      job.project_id, job.document_id, observation->>'measure', observation->>'source_value',
      nullif(observation->>'normalized_amount', '')::numeric, observation->>'currency',
      coalesce(nullif(observation->>'scope_level', ''), 'project'), observation->>'scope_label',
      observation->>'wbs_code', observation->>'wbs_parent_code', observation->>'wbs_name',
      observation->>'scope_description', observation->>'period_label',
      nullif(observation->>'as_of_date', '')::date, observation->>'status_label',
      (observation->>'evidence_chunk_index')::integer, observation->>'excerpt',
      nullif(observation->>'page_number', '')::integer, observation->>'section_label',
      observation->'source_location', observation->>'provider', observation->>'model',
      p_source_content_hash, p_parser_version, p_contract_version
    );
    saved := saved + 1;
  end loop;
  return saved;
end;
$$;
revoke all on function public.persist_cost_observations(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.persist_cost_observations(uuid, uuid, text, text, text, jsonb) to service_role;

create function public.persist_assurance_observations(
  p_job_id uuid,
  p_claim_token uuid,
  p_source_content_hash text,
  p_parser_version text,
  p_contract_version text,
  p_observations jsonb,
  p_coverage jsonb
)
returns integer language plpgsql security definer set search_path = public as $$
declare
  job public.ai_jobs%rowtype;
  stored_hash text;
  observation jsonb;
  coverage_row jsonb;
  saved integer := 0;
begin
  perform public.assert_document_job_owner(p_job_id, p_claim_token);
  select * into job from public.ai_jobs where id = p_job_id;
  if p_source_content_hash is null or p_source_content_hash !~ '^[0-9a-f]{64}$'
    or p_parser_version is null or length(p_parser_version) not between 1 and 100
    or p_contract_version is distinct from 'pmo-assurance-observations/1'
    or jsonb_typeof(p_observations) is distinct from 'array'
    or jsonb_typeof(p_coverage) is distinct from 'array' then
    raise exception 'Assurance observation source version or payload is invalid.';
  end if;
  if jsonb_array_length(p_coverage) <> 4
    or (select count(distinct value->>'domain') from jsonb_array_elements(p_coverage)) <> 4
    or exists (
      select 1 from jsonb_array_elements(p_coverage) row
      where row.value->>'domain' not in ('budget', 'schedule', 'progress', 'risk')
        or row.value->>'state' not in ('processed', 'unprocessed', 'ambiguous_conflicting', 'absent')
        or nullif(row.value->>'total_groups', '') is null
        or nullif(row.value->>'processed_groups', '') is null
    ) then
    raise exception 'Assurance observation source version or coverage payload is invalid.';
  end if;
  select d.content_hash into stored_hash from public.documents d
    where d.id = job.document_id and d.project_id = job.project_id for update;
  if not found or (stored_hash is not null and stored_hash <> p_source_content_hash) then
    raise exception 'Assurance observations do not match the document source version.';
  end if;

  delete from public.assurance_observations
  where project_id = job.project_id and document_id = job.document_id
    and source_content_hash = p_source_content_hash and parser_version = p_parser_version
    and contract_version = p_contract_version;
  delete from public.assurance_observation_coverage
  where project_id = job.project_id and document_id = job.document_id
    and source_content_hash = p_source_content_hash and parser_version = p_parser_version
    and contract_version = p_contract_version;

  for observation in select value from jsonb_array_elements(p_observations)
  loop
    if jsonb_typeof(observation) is distinct from 'object'
      or observation->>'domain' not in ('schedule', 'progress', 'risk')
      or observation->>'observation_type' not in ('milestone', 'progress', 'risk_snapshot', 'risk_register_statement')
      or jsonb_typeof(observation->'observation') is distinct from 'object'
      or nullif(observation->>'evidence_chunk_index', '') is null
      or nullif(observation->>'excerpt', '') is null then
      raise exception 'An assurance observation row is malformed.';
    end if;
    insert into public.assurance_observations (
      project_id, document_id, source_content_hash, parser_version, contract_version,
      domain, observation_type, observation, evidence_chunk_index, excerpt,
      page_number, section_label, source_location
    ) values (
      job.project_id, job.document_id, p_source_content_hash, p_parser_version, p_contract_version,
      observation->>'domain', observation->>'observation_type', observation->'observation',
      (observation->>'evidence_chunk_index')::integer, observation->>'excerpt',
      nullif(observation->>'page_number', '')::integer, observation->>'section_label',
      observation->'source_location'
    );
    saved := saved + 1;
  end loop;

  for coverage_row in select value from jsonb_array_elements(p_coverage)
  loop
    insert into public.assurance_observation_coverage (
      project_id, document_id, source_content_hash, parser_version, contract_version,
      domain, state, total_groups, processed_groups, reason
    ) values (
      job.project_id, job.document_id, p_source_content_hash, p_parser_version, p_contract_version,
      coverage_row->>'domain', coverage_row->>'state',
      (coverage_row->>'total_groups')::integer, (coverage_row->>'processed_groups')::integer,
      left(coverage_row->>'reason', 1500)
    );
  end loop;

  update public.documents set content_hash = coalesce(content_hash, p_source_content_hash),
    assurance_observation_parser_version = p_parser_version,
    assurance_observation_contract_version = p_contract_version,
    updated_at = clock_timestamp()
  where id = job.document_id and project_id = job.project_id;
  return saved;
end;
$$;
revoke all on function public.persist_assurance_observations(uuid, uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.persist_assurance_observations(uuid, uuid, text, text, text, jsonb, jsonb) to service_role;

-- Source identity remains protected by the original chunks, but only their hash
-- and current validated observations leave this boundary; raw chunks are never
-- returned to the assurance evaluator or sent through a review-time model call.
create or replace function public.assurance_source_snapshot(p_project_id uuid, p_review_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare sources jsonb; baseline uuid[]; current_ids uuid[];
begin
  perform d.id from public.documents d join public.assurance_review_documents l on l.document_id = d.id
    where l.review_id = p_review_id and l.project_id = p_project_id and d.project_id = p_project_id
    order by d.id for update of d;
  perform c.id from public.document_chunks c join public.assurance_review_documents l on l.document_id = c.document_id
    where l.review_id = p_review_id and l.project_id = p_project_id and c.project_id = p_project_id
    order by c.id for share of c;
  perform o.id from public.cost_observations o join public.assurance_review_documents l on l.document_id = o.document_id
    where l.review_id = p_review_id and l.project_id = p_project_id and o.project_id = p_project_id
    order by o.id for share of o;
  perform o.id from public.assurance_observations o join public.assurance_review_documents l on l.document_id = o.document_id
    where l.review_id = p_review_id and l.project_id = p_project_id and o.project_id = p_project_id
    order by o.id for share of o;
  perform c.id from public.assurance_observation_coverage c join public.assurance_review_documents l on l.document_id = c.document_id
    where l.review_id = p_review_id and l.project_id = p_project_id and c.project_id = p_project_id
    order by c.id for share of c;
  perform o.id from storage.objects o join public.documents d on d.storage_bucket = o.bucket_id and d.storage_path = o.name
    join public.assurance_review_documents l on l.document_id = d.id
    where l.review_id = p_review_id and l.project_id = p_project_id and d.project_id = p_project_id
    order by o.id for share of o;

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
    'document_id', d.id,
    'role', l.evidence_role,
    'processing_status', d.processing_status,
    'title', d.title,
    'file_name', d.file_name,
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
        'measure', o.measure, 'source_value', o.source_value,
        'normalized_amount', o.normalized_amount, 'currency', o.currency,
        'scope_level', o.scope_level, 'scope_label', o.scope_label,
        'wbs_code', o.wbs_code, 'wbs_parent_code', o.wbs_parent_code,
        'wbs_name', o.wbs_name, 'scope_description', o.scope_description,
        'period_label', o.period_label, 'as_of_date', o.as_of_date,
        'status_label', o.status_label, 'evidence_chunk_index', o.evidence_chunk_index,
        'excerpt', o.excerpt, 'page_number', o.page_number, 'section_label', o.section_label,
        'source_location', o.source_location, 'evidence_role', l.evidence_role
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

create or replace function public.get_assurance_current_review_ids(p_project_id uuid)
returns uuid[] language plpgsql security definer set search_path = '' as $$
declare current_ids uuid[];
begin
  if auth.uid() is null or not public.is_project_member(p_project_id) then
    raise exception 'Project membership is required.';
  end if;
  perform 1 from public.projects where id = p_project_id for share;
  if not found then raise exception 'Project was not found.'; end if;
  select coalesce(array_agg(r.id order by r.reporting_period desc), '{}'::uuid[])
    into current_ids
    from public.assurance_reviews r
    where r.project_id = p_project_id
      and r.status in ('findings_ready', 'report_draft', 'approved')
      and public.assurance_analysis_is_current(p_project_id, r.id);
  return current_ids;
end;
$$;
revoke all on function public.get_assurance_current_review_ids(uuid) from public, anon;
grant execute on function public.get_assurance_current_review_ids(uuid) to authenticated;

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

create or replace function public.accept_cost_baseline(
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
    where o.id = p_observation_id and o.project_id = p_project_id
      and d.processing_status in ('completed', 'needs_review')
      and o.source_content_hash = d.content_hash
      and o.parser_version = d.assurance_observation_parser_version
      and o.contract_version = d.assurance_observation_contract_version
    for share of o;
  if not found or observation.measure <> 'approved_baseline'
    or observation.normalized_amount is null or observation.currency is null then
    raise exception 'Only a current source-backed approved-baseline observation with a valid amount and currency can be accepted.';
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
