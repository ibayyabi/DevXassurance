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

revoke all on table public.progress_rag_rules from anon, authenticated;
grant select on table public.progress_rag_rules to authenticated;
grant select, insert, update, delete on table public.progress_rag_rules to service_role;

create policy "progress_rag_rules_read_by_project_members"
  on public.progress_rag_rules for select to authenticated
  using (public.is_project_member(project_id));

create policy "progress_rag_rules_insert_by_authorized_reviewers"
  on public.progress_rag_rules for insert to authenticated
  with check (
    public.can_upload_project_evidence(project_id)
    and approved_by = auth.uid()
    and state = 'active'
  );

create policy "progress_rag_rules_update_by_authorized_reviewers"
  on public.progress_rag_rules for update to authenticated
  using (public.can_upload_project_evidence(project_id) and state = 'active')
  with check (public.can_upload_project_evidence(project_id) and state = 'superseded');
create function public.guard_progress_rag_rule_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Approved progress RAG rule versions cannot be deleted.';
  end if;
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
