-- Checkpoint findings must be attributable to the document's CURRENT content.
-- A retry upload may reuse the same document row for a different file, so the
-- content identity of the stored object is persisted at the existing upload
-- seams and the progressive reader only surfaces extraction-group checkpoints
-- whose content_hash matches the row's current value. This is identity
-- metadata, not a new extraction schema: nothing here changes parsing,
-- prompts, or extraction output.
alter table public.documents add column content_hash text;

create index documents_project_content_hash_idx
  on public.documents (project_id, content_hash);
