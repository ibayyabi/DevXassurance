alter table public.document_upload_submissions
  add column archive_name text,
  add column archive_storage_path text,
  add column archive_manifest jsonb;

comment on column public.document_upload_submissions.archive_manifest is
  'Safe, per-member ZIP import outcomes; never contains archive member bytes.';

create policy "document_upload_submissions_update_by_creator"
  on public.document_upload_submissions
  for update
  to authenticated
  using (
    public.can_upload_project_evidence(project_id)
    and created_by = auth.uid()
  )
  with check (
    public.can_upload_project_evidence(project_id)
    and created_by = auth.uid()
  );

alter table public.documents
  add column archive_member_identity text;

create unique index documents_submission_archive_member_identity_idx
  on public.documents(submission_id, archive_member_identity)
  where archive_member_identity is not null;
