-- Ticket 04 (AC2, AC4): risk snapshots whose IDs differ across documents may be
-- compared only after a reviewer accepts an identity mapping, and ratings on
-- different source scales may be compared only after a reviewer accepts a scale
-- mapping (ADR 0004). The model never matches risks by name or aligns scales on
-- its own. Both are reviewer-accepted statements scoped to the project; exact
-- risk IDs and identical scales are matched directly by the comparison. These
-- are distinct namespaces from wbs_mappings / milestone_mappings.

create table public.risk_identity_mappings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  -- The risk ID as a source document states it.
  source_label text not null check (length(source_label) between 1 and 500),
  -- The canonical risk ID the comparison groups it under.
  canonical_label text not null check (length(canonical_label) between 1 and 500),
  state text not null default 'accepted' check (state in ('proposed', 'accepted', 'rejected')),
  proposed_by_model boolean not null default false,
  note text check (note is null or length(note) <= 1000),
  created_by uuid references public.profiles(id) on delete set null,
  accepted_by uuid references public.profiles(id) on delete restrict,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  check (source_label <> canonical_label),
  check (
    (state = 'accepted' and accepted_by is not null and accepted_at is not null)
    or (state <> 'accepted' and accepted_by is null and accepted_at is null)
  )
);

-- The rating scale a source uses may differ ("Low/Med/High" vs "1-5"); a
-- reviewer maps a source scale onto a canonical scale so ratings become
-- comparable. Two ratings are comparable only when their scales resolve to the
-- same canonical scale (or are identical).
create table public.risk_scale_mappings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  -- The rating scale as a source document states it.
  source_label text not null check (length(source_label) between 1 and 500),
  -- The canonical scale the comparison aligns it to.
  canonical_label text not null check (length(canonical_label) between 1 and 500),
  state text not null default 'accepted' check (state in ('proposed', 'accepted', 'rejected')),
  proposed_by_model boolean not null default false,
  note text check (note is null or length(note) <= 1000),
  created_by uuid references public.profiles(id) on delete set null,
  accepted_by uuid references public.profiles(id) on delete restrict,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  check (source_label <> canonical_label),
  check (
    (state = 'accepted' and accepted_by is not null and accepted_at is not null)
    or (state <> 'accepted' and accepted_by is null and accepted_at is null)
  )
);

-- At most one accepted canonical target per source label in a project.
create unique index risk_identity_mappings_active_source_idx
  on public.risk_identity_mappings (project_id, source_label)
  where state = 'accepted';
create unique index risk_scale_mappings_active_source_idx
  on public.risk_scale_mappings (project_id, source_label)
  where state = 'accepted';

create index risk_identity_mappings_project_state_idx
  on public.risk_identity_mappings (project_id, state);
create index risk_scale_mappings_project_state_idx
  on public.risk_scale_mappings (project_id, state);

alter table public.risk_identity_mappings enable row level security;
alter table public.risk_scale_mappings enable row level security;

revoke all on table public.risk_identity_mappings from anon, authenticated;
revoke all on table public.risk_scale_mappings from anon, authenticated;
grant select on table public.risk_identity_mappings to authenticated;
grant select on table public.risk_scale_mappings to authenticated;
grant select, insert, update, delete on table public.risk_identity_mappings to service_role;
grant select, insert, update, delete on table public.risk_scale_mappings to service_role;

create policy "risk_identity_mappings_read_by_project_members"
  on public.risk_identity_mappings for select to authenticated
  using (public.is_project_member(project_id));
create policy "risk_identity_mappings_insert_by_authorized_reviewers"
  on public.risk_identity_mappings for insert to authenticated
  with check (public.can_upload_project_evidence(project_id));
create policy "risk_identity_mappings_update_by_authorized_reviewers"
  on public.risk_identity_mappings for update to authenticated
  using (public.can_upload_project_evidence(project_id))
  with check (public.can_upload_project_evidence(project_id));

create policy "risk_scale_mappings_read_by_project_members"
  on public.risk_scale_mappings for select to authenticated
  using (public.is_project_member(project_id));
create policy "risk_scale_mappings_insert_by_authorized_reviewers"
  on public.risk_scale_mappings for insert to authenticated
  with check (public.can_upload_project_evidence(project_id));
create policy "risk_scale_mappings_update_by_authorized_reviewers"
  on public.risk_scale_mappings for update to authenticated
  using (public.can_upload_project_evidence(project_id))
  with check (public.can_upload_project_evidence(project_id));
