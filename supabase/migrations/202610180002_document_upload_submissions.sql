create table public.document_upload_submissions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.documents
  add column submission_id uuid references public.document_upload_submissions(id) on delete set null;

create index documents_submission_id_idx
  on public.documents(submission_id, created_at);

create index document_upload_submissions_project_created_idx
  on public.document_upload_submissions(project_id, created_at desc);

alter table public.document_upload_submissions enable row level security;

create policy "document_upload_submissions_read_by_project_members"
  on public.document_upload_submissions
  for select
  to authenticated
  using (public.is_project_member(project_id));

create policy "document_upload_submissions_insert_by_uploaders"
  on public.document_upload_submissions
  for insert
  to authenticated
  with check (
    public.can_upload_project_evidence(project_id)
    and created_by = auth.uid()
  );

create policy "document_upload_submissions_delete_by_project_uploaders"
  on public.document_upload_submissions
  for delete
  to authenticated
  using (public.can_upload_project_evidence(project_id));

comment on table public.document_upload_submissions is
  'Durable lineage for one-file or multi-file evidence intake submissions.';
