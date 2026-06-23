create type public.assistant_message_role as enum (
  'user',
  'assistant'
);

create table public.assistant_interactions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  question text not null,
  answer text not null,
  insufficient_evidence boolean not null default false,
  evidence_links jsonb not null default '[]'::jsonb,
  inferred_claims text[] not null default '{}',
  recommended_action_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create index assistant_interactions_project_created_idx
  on public.assistant_interactions(project_id, created_at desc);

alter table public.assistant_interactions enable row level security;

create policy "assistant_interactions_read_by_project_members"
  on public.assistant_interactions
  for select
  to authenticated
  using (public.is_project_member(project_id));

create policy "assistant_interactions_insert_by_project_members"
  on public.assistant_interactions
  for insert
  to authenticated
  with check (
    public.is_project_member(project_id)
    and user_id = auth.uid()
  );
