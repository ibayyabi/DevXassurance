alter table public.document_upload_submissions
  add column batch_id uuid not null default gen_random_uuid();

create index document_upload_submissions_project_batch_idx
  on public.document_upload_submissions(project_id, batch_id, created_at);

comment on column public.document_upload_submissions.batch_id is
  'Shared durable identifier grouping ordinary-file submissions with per-archive ZIP submissions from one selection.';
