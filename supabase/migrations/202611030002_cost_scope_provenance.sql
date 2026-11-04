-- Cost observations retain the validated scope source chain so WBS evidence
-- remains reviewable after the worker persists its source-scoped extraction.
alter table public.cost_observations
  add column scope_source_id text check (scope_source_id is null or length(scope_source_id) between 1 and 200),
  add column scope_provenance jsonb check (scope_provenance is null or jsonb_typeof(scope_provenance) = 'array');

create or replace function public.persist_cost_observations(
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
    if observation ? 'scope_provenance'
      and observation->'scope_provenance' <> 'null'::jsonb
      and jsonb_typeof(observation->'scope_provenance') is distinct from 'array' then
      raise exception 'Cost observation scope provenance must be an array.';
    end if;
    if jsonb_typeof(observation->'scope_provenance') = 'array' then
      if exists (
        select 1 from jsonb_array_elements(observation->'scope_provenance') as provenance(item)
        where jsonb_typeof(provenance.item) is distinct from 'object'
          or provenance.item->>'kind' is null
          or provenance.item->>'kind' not in ('cited_row_column', 'declared_subject_key', 'declared_subject', 'sheet_title')
          or nullif(provenance.item->>'source_id', '') is null
          or nullif(provenance.item->>'sheet_name', '') is null
          or nullif(provenance.item->>'cell_reference', '') is null
          or nullif(provenance.item->>'excerpt', '') is null
      ) then
        raise exception 'Cost observation scope provenance is invalid.';
      end if;
    end if;
    if nullif(observation->>'scope_source_id', '') is not null then
      if jsonb_typeof(observation->'scope_provenance') is distinct from 'array' then
        raise exception 'Cost observation scope source does not match its declared subject provenance.';
      end if;
      if not exists (
        select 1 from jsonb_array_elements(observation->'scope_provenance') as provenance(item)
        where provenance.item->>'kind' = 'declared_subject'
          and provenance.item->>'source_id' = observation->>'scope_source_id'
      ) then
        raise exception 'Cost observation scope source does not match its declared subject provenance.';
      end if;
    end if;

    insert into public.cost_observations (
      project_id, document_id, measure, source_value, normalized_amount, currency,
      scope_level, scope_label, scope_source_id, scope_provenance, wbs_code,
      wbs_parent_code, wbs_name, scope_description, period_label, as_of_date,
      status_label, evidence_chunk_index, excerpt, page_number, section_label,
      source_location, provider, model, source_content_hash, parser_version,
      contract_version
    ) values (
      job.project_id, job.document_id, observation->>'measure', observation->>'source_value',
      nullif(observation->>'normalized_amount', '')::numeric, observation->>'currency',
      coalesce(nullif(observation->>'scope_level', ''), 'project'), observation->>'scope_label',
      nullif(observation->>'scope_source_id', ''),
      nullif(observation->'scope_provenance', 'null'::jsonb),
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
