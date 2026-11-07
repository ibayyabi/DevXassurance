-- Ticket 04: a computed progress status may come only from a project-scoped,
-- reviewer-approved, and versioned rule. There is deliberately no global or
-- fixture default: without an active rule for the project the reported values
-- stay visible but the computed status remains unassessed. The source-reported
-- RAG claim (a workbook cell such as "Green") is stored on the observation as
-- cited evidence and is never read here; this table only powers the
-- computed status. One active rule per project; approving a new one
-- supersedes the previous. No WBS rollup and no project-total threshold live
-- here — a rule compares one reported value at one scope and cut-off.
create table public.progress_rag_rules (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  rule_version text not null check (length(rule_version) between 1 and 100),
  -- Variance is actual minus planned in percentage points. Both bounds must be
  -- explicit, bounded, and ordered; an invalid or absent rule stays unassessed.
  thresholds jsonb not null check (
    jsonb_typeof(thresholds) = 'object'
    and thresholds ?& array['amber_below_pp', 'red_below_pp']
    and thresholds - 'amber_below_pp' - 'red_below_pp' = '{}'::jsonb
    and case
      when jsonb_typeof(thresholds->'amber_below_pp') = 'number'
        and jsonb_typeof(thresholds->'red_below_pp') = 'number'
      then (thresholds->>'red_below_pp')::numeric between -100 and 100
        and (thresholds->>'amber_below_pp')::numeric between -100 and 100
        and (thresholds->>'red_below_pp')::numeric < (thresholds->>'amber_below_pp')::numeric
      else false
    end
  ),
  note text check (note is null or length(note) <= 1000),
  state text not null default 'active' check (state in ('active', 'superseded')),
  approved_by uuid not null references public.profiles(id) on delete restrict,
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  unique (project_id, rule_version),
  check ((state = 'active') = (superseded_at is null))
);

create index progress_rag_rules_project_state_idx
  on public.progress_rag_rules (project_id, state);
create unique index progress_rag_rules_one_active_per_project
  on public.progress_rag_rules (project_id)
  where state = 'active';

comment on table public.progress_rag_rules is
  'Reviewer-approved versioned progress RAG thresholds per project. No global default exists; without an active rule the computed progress status is unassessed while reported values and their cited source RAG claims stay visible.';

alter table public.progress_rag_rules enable row level security;

-- Authenticated members can read rules; privileged service-role provisioning
-- is required to create or supersede them.
revoke all on table public.progress_rag_rules from anon, authenticated;
grant select on table public.progress_rag_rules to authenticated;
grant select, insert, update, delete on table public.progress_rag_rules to service_role;

create policy "progress_rag_rules_read_by_project_members"
  on public.progress_rag_rules for select to authenticated
  using (public.is_project_member(project_id));

create or replace function public.guard_progress_rag_rule_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Direct deletion would erase an approved version; a nested FK cascade
    -- from deleting its owning project is the sole exception.
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'Approved progress RAG rule versions cannot be deleted.';
  end if;
  perform 1 from public.projects where id = old.project_id for update;
  if not found then raise exception 'Project was not found.'; end if;
  if old.state <> 'active'
    or new.state <> 'superseded'
    or new.superseded_at is null
    or new.id is distinct from old.id
    or new.project_id is distinct from old.project_id
    or new.rule_version is distinct from old.rule_version
    or new.thresholds is distinct from old.thresholds
    or new.note is distinct from old.note
    or new.approved_by is distinct from old.approved_by
    or new.approved_at is distinct from old.approved_at
    or new.created_at is distinct from old.created_at
  then
    raise exception 'A progress RAG rule version is immutable; only active-to-superseded is allowed.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_progress_rag_rule_version() from public, anon, authenticated;
grant execute on function public.guard_progress_rag_rule_version() to authenticated, service_role;
create trigger progress_rag_rules_preserve_approved_versions
  before update or delete on public.progress_rag_rules
  for each row execute function public.guard_progress_rag_rule_version();

-- 202611020006 is already deployed on some databases. Extend its result-key
-- allowlist here rather than editing that applied migration in place.
create or replace function public.finish_assurance_analysis_with_results(
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
      'progress_source_rag_claims', 'progress_rag_rule',
      'progress_computed_statuses',
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
-- The active rule is an analysis reference, not a later UI lookup. Reference
-- snapshots carry its full approved identity so claim, finish, currentness,
-- and existing mapping invalidation all fence the same thresholds.
alter function public.assurance_reference_snapshot(uuid, uuid)
  rename to assurance_reference_snapshot_without_progress_rag_rule;
revoke all on function public.assurance_reference_snapshot_without_progress_rag_rule(uuid, uuid)
  from public, anon, authenticated;

create function public.assurance_reference_snapshot(p_project_id uuid, p_review_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  refs jsonb;
  rule jsonb;
  reference_values jsonb;
  reference_versions jsonb;
begin
  refs := public.assurance_reference_snapshot_without_progress_rag_rule(p_project_id, p_review_id);
  select jsonb_build_object(
    'id', r.id,
    'rule_version', r.rule_version,
    'thresholds', r.thresholds,
    'note', r.note,
    'approved_by', r.approved_by,
    'approved_at', r.approved_at
  )
  into rule
  from public.progress_rag_rules r
  where r.project_id = p_project_id and r.state = 'active';

  reference_values := coalesce(refs->'references', '{}'::jsonb) ||
    jsonb_build_object('progress_rag_rule', rule);
  reference_versions := coalesce(refs->'versions', '{}'::jsonb) ||
    jsonb_build_object(
      'progress_rag_rule_id', rule->'id',
      'progress_rag_rule_version', rule->'rule_version'
    );
  return refs || jsonb_build_object(
    'fingerprint', encode(sha256(convert_to(jsonb_build_array(
      refs->>'fingerprint', rule
    )::text, 'UTF8')), 'hex'),
    'versions', reference_versions,
    'references', reference_values,
    'progress_rag_rule', rule
  );
end;
$$;
revoke all on function public.assurance_reference_snapshot(uuid, uuid) from public, anon, authenticated;

-- Rule writes acquire the same project lock as claim/finish before they can
-- invalidate references. Snapshots do not row-lock rules, avoiding a project /
-- rule-row lock cycle while making either claim or rule change win atomically.
create function public.lock_progress_rag_rule_project()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.projects where id = new.project_id for update;
  if not found then raise exception 'Project was not found.'; end if;
  return new;
end;
$$;
revoke all on function public.lock_progress_rag_rule_project() from public, anon, authenticated;
grant execute on function public.lock_progress_rag_rule_project() to service_role;
create trigger progress_rag_rules_lock_project_before_insert
  before insert on public.progress_rag_rules
  for each row execute function public.lock_progress_rag_rule_project();

create function public.invalidate_progress_rag_rule_results()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.invalidate_assurance_reference_results(new.project_id);
  return new;
end;
$$;
revoke all on function public.invalidate_progress_rag_rule_results() from public, anon, authenticated;
grant execute on function public.invalidate_progress_rag_rule_results() to service_role;
create trigger progress_rag_rules_invalidate_results
  after insert or update on public.progress_rag_rules
  for each row execute function public.invalidate_progress_rag_rule_results();

-- Return the exact rule snapshot used by the reference fingerprint so the
-- analysis consumer never performs an independent post-claim rule lookup.
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
