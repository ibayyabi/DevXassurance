-- Ticket 02 (AC2): WBS work packages whose codes or names differ across
-- documents may be compared only after a project reviewer accepts a mapping
-- (ADR 0004). The model never merges work packages on its own: a mapping is a
-- reviewer-accepted statement that a source label is the same work package as a
-- canonical label, scoped to the project. Identical labels need no mapping and
-- are matched directly by the comparison.

create table public.wbs_mappings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  -- The label as a source document states it (its code or name).
  source_label text not null check (length(source_label) between 1 and 500),
  -- The canonical label the comparison groups it under.
  canonical_label text not null check (length(canonical_label) between 1 and 500),
  state text not null default 'accepted' check (state in ('proposed', 'accepted', 'rejected')),
  -- A model may surface a candidate; only a reviewer's acceptance activates it.
  proposed_by_model boolean not null default false,
  note text check (note is null or length(note) <= 1000),
  created_by uuid references public.profiles(id) on delete set null,
  accepted_by uuid references public.profiles(id) on delete restrict,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  -- A source label mapped to itself is a no-op and never a real mapping.
  check (source_label <> canonical_label),
  check (
    (state = 'accepted' and accepted_by is not null and accepted_at is not null)
    or (state <> 'accepted' and accepted_by is null and accepted_at is null)
  )
);

-- At most one accepted canonical target per source label in a project.
create unique index wbs_mappings_active_source_idx
  on public.wbs_mappings (project_id, source_label)
  where state = 'accepted';

create index wbs_mappings_project_state_idx
  on public.wbs_mappings (project_id, state);

alter table public.wbs_mappings enable row level security;

revoke all on table public.wbs_mappings from anon, authenticated;
grant select on table public.wbs_mappings to authenticated;
grant select, insert, update, delete on table public.wbs_mappings to service_role;

create policy "wbs_mappings_read_by_project_members"
  on public.wbs_mappings for select to authenticated
  using (public.is_project_member(project_id));

create policy "wbs_mappings_insert_by_authorized_reviewers"
  on public.wbs_mappings for insert to authenticated
  with check (public.can_upload_project_evidence(project_id));

create policy "wbs_mappings_update_by_authorized_reviewers"
  on public.wbs_mappings for update to authenticated
  using (public.can_upload_project_evidence(project_id))
  with check (public.can_upload_project_evidence(project_id));
