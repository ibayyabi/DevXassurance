-- Pin every report draft to the published assessment snapshot it was generated
-- from. Without this a report could only be described by its review id, so a
-- later analysis of the same review silently re-attributed an old draft to new
-- evidence. snapshot_manifest freezes the source values, gaps, actions and
-- provenance at creation time so the draft stays readable after new evidence,
-- a backfill or a corrected decision produces a newer snapshot version.
--
-- This migration intentionally does not resolve the snapshot itself. The report
-- layer pins the identity the assessment stream publishes (see
-- src/features/reports/lib/snapshot-source.ts); today that is the successful
-- analysis attempt of the review covering the cut-off.

alter table public.report_previews
  add column if not exists snapshot_id text,
  add column if not exists snapshot_cutoff date,
  add column if not exists snapshot_version text,
  add column if not exists snapshot_manifest jsonb not null default '{}'::jsonb;

create index if not exists report_previews_project_snapshot_idx
  on public.report_previews(project_id, snapshot_id);

-- Additive rewrite of the report operation: the signature and every existing
-- operation keep their behaviour. Only 'create' additionally persists the
-- pinned snapshot identity from the payload and refuses to pin anything other
-- than the review's currently published analysis.
create or replace function public.assurance_report_operation(p_project_id uuid, p_review_id uuid,
  p_operation text, p_preview_id uuid default null, p_attempt_id uuid default null,
  p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.assurance_reviews; preview public.report_previews; attempt text; result_id uuid;
  report_fingerprint text;
begin
  r := public.lock_assurance_review(p_project_id,p_review_id);
  if public.assurance_analysis_is_current(p_project_id,p_review_id) is distinct from true
    then raise exception 'Run a successful analysis of the current evidence before using this report.'; end if;
  attempt := r.analysis_metadata->'last_success'->>'id';
  if p_attempt_id is not null and p_attempt_id::text <> attempt
    then raise exception 'The report analysis has changed. Generate a current report.'; end if;
  if p_preview_id is not null then
    select * into preview from public.report_previews where id = p_preview_id
      and project_id = p_project_id and assurance_review_id = p_review_id for update;
    if not found or not (preview.provenance @> jsonb_build_array(
      jsonb_build_object('label','Analysis attempt','source',attempt)))
      then raise exception 'This report is not associated with the current successful analysis.'; end if;
    report_fingerprint := encode(sha256(convert_to(jsonb_build_array(preview.original_sections,
      preview.edited_sections,preview.review_state)::text,'UTF8')),'hex');
  end if;
  if p_operation = 'context' then
    return jsonb_build_object('attempt_id',attempt,'review',to_jsonb(r),
      'findings',(select jsonb_agg(to_jsonb(f) order by domain) from public.assurance_findings f
        where review_id = p_review_id and project_id = p_project_id),
      'actions',coalesce((select jsonb_agg(to_jsonb(a) order by priority desc) from public.assurance_actions a
        where review_id = p_review_id and project_id = p_project_id),'[]'::jsonb),
      'evidence_count',(select count(*) from public.assurance_review_documents
        where review_id = p_review_id and project_id = p_project_id));
  elsif p_operation = 'create' then
    if p_attempt_id is null then raise exception 'An analysis association is required.'; end if;
    if p_payload->>'snapshot_id' is null or p_payload->>'snapshot_version' is null
      or p_payload->>'snapshot_cutoff' is null
      then raise exception 'A published assessment snapshot is required to pin a report.'; end if;
    if p_payload->>'snapshot_version' is distinct from attempt
      then raise exception 'The report snapshot is not the published analysis of this review.'; end if;
    insert into public.report_previews(project_id,created_by,assurance_review_id,report_type,reporting_period,
      audience,detail_level,original_sections,included_evidence_counts,provenance,review_state,
      snapshot_id,snapshot_cutoff,snapshot_version,snapshot_manifest)
    values(p_project_id,auth.uid(),p_review_id,'assurance_report',p_payload->>'reporting_period',
      p_payload->>'audience',p_payload->>'detail_level',p_payload->'sections',p_payload->'counts',
      coalesce(p_payload->'provenance','[]'::jsonb) || jsonb_build_array(
        jsonb_build_object('label','Analysis attempt','source',attempt)),'draft_ai_generated',
      p_payload->>'snapshot_id',(p_payload->>'snapshot_cutoff')::date,p_payload->>'snapshot_version',
      coalesce(p_payload->'snapshot_manifest','{}'::jsonb)) returning id into result_id;
    update public.assurance_reviews set status = 'report_draft', current_step = 'report', updated_at = clock_timestamp()
      where id = p_review_id and project_id = p_project_id;
    return jsonb_build_object('id',result_id);
  elsif p_operation = 'approve' and p_preview_id is not null then
    update public.report_previews set review_state = 'reviewed', updated_at = clock_timestamp() where id = p_preview_id;
    update public.assurance_reviews set status = 'approved', current_step = 'report', reviewed_by = auth.uid(),
      approved_at = clock_timestamp(), updated_at = clock_timestamp() where id = p_review_id and project_id = p_project_id;
    insert into public.audit_events(project_id,actor_id,event_type,entity_type,entity_id,before_state,after_state)
      values(p_project_id,auth.uid(),'report_reviewed','report_preview',p_preview_id,to_jsonb(preview),
        jsonb_build_object('review_state','reviewed','analysis_attempt_id',attempt));
    return jsonb_build_object('id',p_preview_id);
  elsif p_operation in ('export_check','export_finish') and p_preview_id is not null then
    if preview.review_state not in ('reviewed','exported') then raise exception 'Approve the report before exporting PDF or DOCX.'; end if;
    if p_operation = 'export_check' then
      return jsonb_build_object('attempt_id',attempt,'preview',to_jsonb(preview),'report_fingerprint',report_fingerprint);
    end if;
    if p_attempt_id is null or p_payload->>'report_fingerprint' is distinct from report_fingerprint
      then raise exception 'Report content or approval changed during file creation. Retry the export.'; end if;
    if p_payload->>'format' not in ('pdf','docx') or p_payload->>'storage_path' is null
      or split_part(p_payload->>'storage_path','/',1) <> p_project_id::text
      then raise exception 'Invalid report export.'; end if;
    insert into public.report_exports(project_id,report_preview_id,exported_by,export_format,storage_path,file_name,file_size,status)
      values(p_project_id,p_preview_id,auth.uid(),(p_payload->>'format')::public.report_export_format,
        p_payload->>'storage_path',p_payload->>'file_name',(p_payload->>'file_size')::bigint,'exported');
    update public.report_previews set review_state = 'exported', updated_at = clock_timestamp() where id = p_preview_id;
    insert into public.audit_events(project_id,actor_id,event_type,entity_type,entity_id,before_state,after_state)
      values(p_project_id,auth.uid(),'report_exported','report_preview',p_preview_id,to_jsonb(preview),p_payload);
    return jsonb_build_object('id',p_preview_id);
  end if;
  raise exception 'Invalid report operation.';
end;
$$;
