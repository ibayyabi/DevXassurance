create type public.document_type as enum (
  'progress_report',
  'meeting_minutes',
  'risk_register',
  'issue_log',
  'schedule',
  'cost_report',
  'approval',
  'claim',
  'change_record',
  'governance_reference'
);

create type public.document_processing_status as enum (
  'uploaded',
  'queued',
  'processing',
  'needs_review',
  'completed',
  'failed',
  'cancelled'
);

create type public.extracted_fact_type as enum (
  'risk',
  'issue',
  'milestone',
  'decision',
  'owner_action'
);

create type public.fact_confirmation_state as enum (
  'ai_extracted',
  'user_confirmed',
  'user_edited'
);

insert into storage.buckets (id, name, public)
values ('project-evidence', 'project-evidence', false)
on conflict (id) do nothing;

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  uploader_id uuid not null references public.profiles(id) on delete restrict,
  document_type public.document_type not null,
  title text not null,
  file_name text not null,
  file_size bigint not null check (file_size > 0),
  mime_type text not null check (mime_type = 'application/pdf'),
  storage_bucket text not null default 'project-evidence',
  storage_path text not null unique,
  processing_status public.document_processing_status not null default 'uploaded',
  processing_error text,
  document_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  document_id uuid references public.documents(id) on delete cascade,
  job_type text not null,
  status public.document_processing_status not null default 'queued',
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  chunk_text text not null,
  page_number integer,
  section_label text,
  parser_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create table public.extraction_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  document_id uuid references public.documents(id) on delete cascade,
  ai_job_id uuid references public.ai_jobs(id) on delete set null,
  status public.document_processing_status not null default 'queued',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.extracted_facts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  extraction_run_id uuid references public.extraction_runs(id) on delete set null,
  fact_type public.extracted_fact_type not null,
  extracted_text text not null,
  original_value text not null,
  edited_value text,
  confidence numeric(5, 4) not null check (confidence >= 0 and confidence <= 1),
  confirmation_state public.fact_confirmation_state not null default 'ai_extracted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.evidence_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  extracted_fact_id uuid references public.extracted_facts(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  document_chunk_id uuid references public.document_chunks(id) on delete set null,
  excerpt text,
  confidence numeric(5, 4) check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now()
);

create table public.document_summaries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  summary_text text not null,
  confidence numeric(5, 4) not null check (confidence >= 0 and confidence <= 1),
  quality_warning text,
  selected_document_ids uuid[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.document_summary_sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  summary_id uuid not null references public.document_summaries(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  document_chunk_id uuid references public.document_chunks(id) on delete set null,
  excerpt text,
  confidence numeric(5, 4) check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now()
);

create index documents_project_id_idx on public.documents(project_id);
create index ai_jobs_project_id_idx on public.ai_jobs(project_id);
create index ai_jobs_document_id_idx on public.ai_jobs(document_id);
create index document_chunks_project_id_idx on public.document_chunks(project_id);
create index document_chunks_document_id_idx on public.document_chunks(document_id);
create index extracted_facts_project_id_idx on public.extracted_facts(project_id);
create index evidence_links_project_id_idx on public.evidence_links(project_id);
create index document_summaries_project_id_idx on public.document_summaries(project_id);

alter table public.documents enable row level security;
alter table public.ai_jobs enable row level security;
alter table public.document_chunks enable row level security;
alter table public.extraction_runs enable row level security;
alter table public.extracted_facts enable row level security;
alter table public.evidence_links enable row level security;
alter table public.document_summaries enable row level security;
alter table public.document_summary_sources enable row level security;

create or replace function public.can_upload_project_evidence(check_project_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.project_members
    where project_id = check_project_id
      and user_id = auth.uid()
      and role in ('admin', 'pmc_consultant', 'pmo_reviewer', 'project_manager')
  );
$$;

create policy "documents_read_by_project_members"
  on public.documents
  for select
  to authenticated
  using (public.is_project_member(project_id));

create policy "documents_insert_by_uploaders"
  on public.documents
  for insert
  to authenticated
  with check (
    public.can_upload_project_evidence(project_id)
    and uploader_id = auth.uid()
  );

create policy "documents_update_by_project_uploaders"
  on public.documents
  for update
  to authenticated
  using (public.can_upload_project_evidence(project_id))
  with check (public.can_upload_project_evidence(project_id));

create policy "storage_evidence_read_by_project_members"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'project-evidence'
    and public.is_project_member((storage.foldername(name))[1]::uuid)
  );

create policy "storage_evidence_insert_by_uploaders"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'project-evidence'
    and public.can_upload_project_evidence((storage.foldername(name))[1]::uuid)
  );

create policy "ai_jobs_read_by_project_members"
  on public.ai_jobs
  for select
  to authenticated
  using (public.is_project_member(project_id));

create policy "ai_jobs_insert_by_project_uploaders"
  on public.ai_jobs
  for insert
  to authenticated
  with check (public.can_upload_project_evidence(project_id));

create policy "document_chunks_read_by_project_members"
  on public.document_chunks
  for select
  to authenticated
  using (public.is_project_member(project_id));

create policy "extraction_runs_read_by_project_members"
  on public.extraction_runs
  for select
  to authenticated
  using (public.is_project_member(project_id));

create policy "extracted_facts_read_by_project_members"
  on public.extracted_facts
  for select
  to authenticated
  using (public.is_project_member(project_id));

create policy "extracted_facts_update_by_project_uploaders"
  on public.extracted_facts
  for update
  to authenticated
  using (public.can_upload_project_evidence(project_id))
  with check (public.can_upload_project_evidence(project_id));

create policy "evidence_links_read_by_project_members"
  on public.evidence_links
  for select
  to authenticated
  using (public.is_project_member(project_id));

create policy "document_summaries_read_by_project_members"
  on public.document_summaries
  for select
  to authenticated
  using (public.is_project_member(project_id));

create policy "document_summaries_insert_by_project_uploaders"
  on public.document_summaries
  for insert
  to authenticated
  with check (public.can_upload_project_evidence(project_id));

create policy "document_summary_sources_read_by_project_members"
  on public.document_summary_sources
  for select
  to authenticated
  using (public.is_project_member(project_id));
