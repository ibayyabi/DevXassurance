-- Ticket 01: project-level budget assurance on PMO cost evidence contracts.
-- Cost observations keep the source value and exact location captured by the
-- existing grouped extraction. A baseline becomes comparable only after an
-- authorized reviewer accepts it for a scope and effective date.

create table public.cost_observations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  measure text not null check (measure in ('approved_baseline', 'actual_to_date', 'committed', 'eac')),
  source_value text not null check (length(source_value) between 1 and 5000),
  normalized_amount numeric,
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  scope_level text not null check (scope_level in ('project', 'wbs')),
  scope_label text check (scope_label is null or length(scope_label) <= 500),
  period_label text check (period_label is null or length(period_label) <= 200),
  as_of_date date,
  status_label text check (status_label is null or length(status_label) <= 200),
  evidence_chunk_index integer not null check (evidence_chunk_index >= 0),
  excerpt text not null check (length(excerpt) between 1 and 5000),
  page_number integer check (page_number is null or page_number >= 1),
  section_label text,
  source_location jsonb,
  provider text,
  model text,
  created_at timestamptz not null default now(),
  unique (document_id, measure, scope_level, evidence_chunk_index, source_value)
);

-- A reviewer-accepted comparison reference. The source document's own
-- "approved" wording stays in cost_observations and never activates a row here.
create table public.cost_baselines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  scope_level text not null check (scope_level in ('project', 'wbs')),
  scope_label text check (scope_label is null or length(scope_label) <= 500),
  amount numeric not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  effective_date date not null,
  state text not null default 'accepted' check (state in ('accepted', 'superseded')),
  observation_id uuid references public.cost_observations(id) on delete set null,
  source_document_id uuid references public.documents(id) on delete set null,
  approved_by uuid not null references public.profiles(id) on delete restrict,
  approval_note text check (approval_note is null or length(approval_note) <= 1000),
  approved_at timestamptz not null default now(),
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  check ((state = 'accepted' and superseded_at is null) or (state = 'superseded' and superseded_at is not null))
);

-- Only one accepted baseline per project scope; a replacement supersedes it.
create unique index cost_baselines_active_scope_idx
  on public.cost_baselines (project_id, scope_level, coalesce(scope_label, ''))
  where state = 'accepted';

create index cost_observations_project_measure_idx
  on public.cost_observations (project_id, measure, scope_level);

create index cost_observations_document_idx
  on public.cost_observations (document_id);

create index cost_baselines_project_scope_idx
  on public.cost_baselines (project_id, scope_level, effective_date desc);

-- A reviewer may correct the value used in assessment without rewriting the
-- original extraction: baseline_value, current_value, variance, and
-- source_excerpts stay as extracted.
alter table public.assurance_findings
  add column if not exists correction jsonb,
  add column if not exists correction_reason text,
  add column if not exists corrected_by uuid references public.profiles(id) on delete set null,
  add column if not exists corrected_at timestamptz;

alter table public.assurance_findings
  add constraint assurance_findings_correction_attribution_check
    check (
      (correction is null and correction_reason is null and corrected_by is null and corrected_at is null)
      or (correction is not null and correction_reason is not null and corrected_by is not null and corrected_at is not null)
    );

alter table public.cost_observations enable row level security;
alter table public.cost_baselines enable row level security;

-- Extraction writes observations through the worker's service role only.
revoke all on table public.cost_observations from anon, authenticated;
grant select on table public.cost_observations to authenticated;
grant select, insert, update, delete on table public.cost_observations to service_role;

create policy "cost_observations_read_by_project_members"
  on public.cost_observations for select to authenticated
  using (public.is_project_member(project_id));

create policy "cost_baselines_read_by_project_members"
  on public.cost_baselines for select to authenticated
  using (public.is_project_member(project_id));

create policy "cost_baselines_insert_by_authorized_reviewers"
  on public.cost_baselines for insert to authenticated
  with check (
    public.can_upload_project_evidence(project_id)
    and approved_by = auth.uid()
  );

create policy "cost_baselines_update_by_authorized_reviewers"
  on public.cost_baselines for update to authenticated
  using (public.can_upload_project_evidence(project_id))
  with check (public.can_upload_project_evidence(project_id));
