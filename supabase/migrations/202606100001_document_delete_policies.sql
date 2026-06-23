create policy "documents_delete_by_project_uploaders"
  on public.documents
  for delete
  to authenticated
  using (public.can_upload_project_evidence(project_id));

create policy "storage_evidence_delete_by_project_uploaders"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'project-evidence'
    and public.can_upload_project_evidence((storage.foldername(name))[1]::uuid)
  );

create policy "ai_jobs_delete_by_project_uploaders"
  on public.ai_jobs
  for delete
  to authenticated
  using (public.can_upload_project_evidence(project_id));

create policy "document_chunks_delete_by_project_uploaders"
  on public.document_chunks
  for delete
  to authenticated
  using (public.can_upload_project_evidence(project_id));

create policy "extraction_runs_delete_by_project_uploaders"
  on public.extraction_runs
  for delete
  to authenticated
  using (public.can_upload_project_evidence(project_id));

create policy "extracted_facts_delete_by_project_uploaders"
  on public.extracted_facts
  for delete
  to authenticated
  using (public.can_upload_project_evidence(project_id));

create policy "evidence_links_delete_by_project_uploaders"
  on public.evidence_links
  for delete
  to authenticated
  using (public.can_upload_project_evidence(project_id));

create policy "document_summaries_delete_by_project_uploaders"
  on public.document_summaries
  for delete
  to authenticated
  using (public.can_upload_project_evidence(project_id));

create policy "document_summary_sources_delete_by_project_uploaders"
  on public.document_summary_sources
  for delete
  to authenticated
  using (public.can_upload_project_evidence(project_id));
