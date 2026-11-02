create table public.document_extraction_groups (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  group_key text not null check (group_key ~ '^[0-9a-f]{64}$'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  parser_version text not null,
  schema_version text not null,
  group_index integer not null check (group_index >= 0),
  chunk_start_index integer not null check (chunk_start_index >= 0),
  chunk_end_index integer not null check (chunk_end_index >= chunk_start_index),
  status text not null check (status in ('completed', 'failed')),
  result jsonb,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  provider text,
  model text,
  last_error text check (last_error is null or length(last_error) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, group_key),
  check (
    (status = 'completed' and result is not null and jsonb_typeof(result) = 'object' and last_error is null)
    or
    (status = 'failed' and result is null and last_error is not null)
  )
);

create index document_extraction_groups_project_document_idx
  on public.document_extraction_groups (project_id, document_id);

alter table public.document_extraction_groups enable row level security;
revoke all on table public.document_extraction_groups from anon, authenticated;
grant select, insert, update, delete on table public.document_extraction_groups to service_role;
