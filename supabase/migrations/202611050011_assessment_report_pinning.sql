-- Ticket: report drafts from the automatic assessment queue.
--
-- Until now a report could only pin a review-bound analysis (009). The
-- automatic queue publishes snapshots per (project, cut-off) without any
-- review, so those results were invisible to the report surface even though
-- the dashboard shows them. This migration extends the same server-side
-- derivation contract to automatic snapshots: the caller never supplies the
-- snapshot identity, manifest, counts, or sources.
--
-- Snapshot identity for the automatic path is "assessment:<uuid>:<generation>"
-- so it can never collide with a review attempt id.

-- ---------------------------------------------------------------------------
-- Server-side derivation of a report snapshot from the automatic queue.
-- Same output shape as public.assurance_report_snapshot; not callable from an
-- application role.
-- ---------------------------------------------------------------------------
create function public.assurance_automatic_report_snapshot(
  p_project_id uuid,
  p_cutoff date
)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
declare
  snapshot_row public.assurance_assessment_snapshots%rowtype;
  evidence jsonb;
  assessed jsonb;
  missing jsonb;
  acts jsonb;
  derived jsonb;
begin
  select * into snapshot_row
    from public.assurance_assessment_snapshots s
    where s.project_id = p_project_id and s.cutoff = p_cutoff
      and s.superseded_at is null
    order by s.generation desc limit 1;
  if not found then
    raise exception 'No published automatic assessment exists for this cut-off.';
  end if;

  -- Concrete bound documents with their source version, never table names.
  -- A snapshot's source_versions row carries the content hash each document
  -- was read at; the join proves the document still belongs to the project.
  select coalesce(jsonb_agg(jsonb_build_object(
      'label', 'Evidence document',
      'source', 'documents:' || coalesce(sv->>'document_id', 'unknown'),
      'documentId', sv->>'document_id',
      'documentName', d.file_name,
      'evidenceRole', sv->>'role',
      'contentHash', sv->>'content_hash',
      'parserVersion', sv->>'parser_version',
      'contractVersion', sv->>'contract_version'
    ) order by sv->>'role', sv->>'document_id'), '[]'::jsonb)
    into evidence
    from public.assurance_assessment_snapshots s
    cross join lateral jsonb_array_elements(s.source_versions) as sv
    left join public.documents d
      on d.id::text = sv->>'document_id' and d.project_id = p_project_id
    where s.id = snapshot_row.id;

  select coalesce(jsonb_agg(jsonb_build_object(
        'domain', f->>'domain', 'condition', f->>'condition', 'headline', f->>'headline',
        'explanation', f->>'explanation', 'confirmationState', 'ai_extracted'
      ) order by f->>'domain'), '[]'::jsonb)
    into assessed
    from jsonb_array_elements(snapshot_row.findings) as f
    where f->>'condition' <> 'more_evidence_required';

  select coalesce(jsonb_agg(jsonb_build_object('domain', f->>'domain', 'reason', f->>'headline')
      order by f->>'domain'), '[]'::jsonb)
    into missing
    from jsonb_array_elements(snapshot_row.findings) as f
    where f->>'condition' = 'more_evidence_required';

  select coalesce(jsonb_agg(jsonb_build_object('title', a->>'title', 'ownerName', null,
      'dueDate', null, 'status', a->>'status') order by a->>'priority' desc), '[]'::jsonb)
    into acts
    from jsonb_array_elements(snapshot_row.actions) as a;

  select jsonb_build_object(
      'snapshot_documents', (select count(*) from jsonb_array_elements(coalesce(snapshot_row.source_versions, '[]'::jsonb))),
      'assessed_domains', jsonb_array_length(assessed),
      'evidence_gaps', jsonb_array_length(missing),
      'critical_conditions', (select count(*) from jsonb_array_elements(snapshot_row.findings) f
        where f->>'condition' = 'critical'),
      'actions', jsonb_array_length(acts),
      'confirmed_findings', 0
    ) into derived;

  return jsonb_build_object(
    'snapshotId', 'assessment:' || snapshot_row.id,
    'snapshotVersion', 'assessment:' || snapshot_row.id,
    'snapshotCutoff', snapshot_row.cutoff,
    'cutoffLabel', to_char(snapshot_row.cutoff, 'FMMonth YYYY'),
    'reviewId', null,
    'evidenceCount', (select count(*) from jsonb_array_elements(coalesce(snapshot_row.source_versions, '[]'::jsonb))),
    'values', assessed,
    'gaps', missing,
    'actions', acts,
    'sources', jsonb_build_array(jsonb_build_object(
      'label', 'Automatic assessment snapshot',
      'source', 'assurance_assessment_snapshots:' || snapshot_row.id || '#' || snapshot_row.generation,
      'snapshotStatus', snapshot_row.status)) || evidence,
    'counts', derived,
    'assessmentStatus', snapshot_row.status,
    'fingerprint', snapshot_row.fingerprint,
    'attemptId', snapshot_row.attempt_id,
    'generation', snapshot_row.generation);
end;
$$;
revoke all on function public.assurance_automatic_report_snapshot(uuid, date) from public, anon, authenticated;

-- Member-gated read so the renderer can display the same server-derived
-- snapshot the create persists.
create function public.get_assessment_report_snapshot(p_project_id uuid, p_cutoff date)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_project_member(p_project_id) then
    raise exception 'Project membership is required.';
  end if;
  return public.assurance_automatic_report_snapshot(p_project_id, p_cutoff);
end;
$$;
revoke all on function public.get_assessment_report_snapshot(uuid, date) from public, anon;
grant execute on function public.get_assessment_report_snapshot(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Additive rewrite of the report operation: 'create_automatic' pins a draft to
-- the automatic queue's published snapshot. Every existing operation keeps its
-- behaviour; the review-bound path is untouched.
-- ---------------------------------------------------------------------------
create or replace function public.assurance_report_operation(p_project_id uuid, p_review_id uuid,
  p_operation text, p_preview_id uuid default null, p_attempt_id uuid default null,
  p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.assurance_reviews; preview public.report_previews; attempt text; result_id uuid;
  report_fingerprint text; snapshot jsonb; derived_counts jsonb;
  auto_snapshot jsonb;
begin
  if p_operation = 'create_automatic' then
    if auth.uid() is null or not exists (
      select 1 from public.project_members where project_id = p_project_id
        and user_id = auth.uid() and role in ('admin', 'pmc_consultant', 'project_manager')
    ) then raise exception 'Your project role cannot manage reports.'; end if;
    perform 1 from public.projects where id = p_project_id for update;
    if not found then raise exception 'Project was not found.'; end if;
    if jsonb_typeof(p_payload->'sections') is distinct from 'object'
      or coalesce(p_payload->>'audience','') = '' or coalesce(p_payload->>'detail_level','') = ''
      or p_payload->>'snapshot_cutoff' is null
      then raise exception 'A report needs an audience, a detail level and its section content.'; end if;
    auto_snapshot := public.assurance_automatic_report_snapshot(
      p_project_id, (p_payload->>'snapshot_cutoff')::date);
    -- The caller may echo the identity it rendered from, but never choose it.
    if p_payload->>'snapshot_version' is not null
      and p_payload->>'snapshot_version' is distinct from auto_snapshot->>'snapshotVersion'
      then raise exception 'The report snapshot is not the published automatic assessment for this cut-off.'; end if;
    derived_counts := auto_snapshot->'counts';
    if p_payload->'counts' is not null and p_payload->'counts' is distinct from derived_counts
      then raise exception 'Report counts do not match the published assessment snapshot.'; end if;
    insert into public.report_previews(project_id,created_by,assurance_review_id,report_type,reporting_period,
      audience,detail_level,original_sections,included_evidence_counts,provenance,review_state,
      snapshot_id,snapshot_cutoff,snapshot_version,snapshot_manifest)
    values(p_project_id,auth.uid(),null,'assurance_report',auto_snapshot->>'cutoffLabel',
      p_payload->>'audience',p_payload->>'detail_level',p_payload->'sections',derived_counts,
      auto_snapshot->'sources' || jsonb_build_array(jsonb_build_object(
        'label','Automatic assessment snapshot',
        'source',auto_snapshot->'sources'->0->>'source')),
      'draft_ai_generated',
      auto_snapshot->>'snapshotId',
      (auto_snapshot->>'snapshotCutoff')::date,
      auto_snapshot->>'snapshotVersion',
      auto_snapshot || jsonb_build_object('audience',p_payload->>'audience',
        'detailLevel',p_payload->>'detail_level'))
    returning id into result_id;
    return jsonb_build_object('id',result_id);
  end if;

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
  if p_operation in ('context','create') then
    snapshot := public.assurance_report_snapshot(p_project_id,p_review_id,attempt);
    if snapshot is null then raise exception 'Assurance review was not found in this project.'; end if;
  end if;
  if p_operation = 'context' then
    return jsonb_build_object('attempt_id',attempt,'review',to_jsonb(r),'snapshot',snapshot,
      'findings',(select jsonb_agg(to_jsonb(f) order by domain) from public.assurance_findings f
        where review_id = p_review_id and project_id = p_project_id),
      'actions',coalesce((select jsonb_agg(to_jsonb(a) order by priority desc) from public.assurance_actions a
        where review_id = p_review_id and project_id = p_project_id),'[]'::jsonb),
      'evidence_count',(select count(*) from public.assurance_review_documents
        where review_id = p_review_id and project_id = p_project_id));
  elsif p_operation = 'create' then
    if p_attempt_id is null then raise exception 'An analysis association is required.'; end if;
    if jsonb_typeof(p_payload->'sections') is distinct from 'object'
      or coalesce(p_payload->>'audience','') = '' or coalesce(p_payload->>'detail_level','') = ''
      then raise exception 'A report needs an audience, a detail level and its section content.'; end if;
    if p_payload->>'snapshot_id' is not null and p_payload->>'snapshot_id' is distinct from attempt
      then raise exception 'The report snapshot is not the published analysis of this review.'; end if;
    if p_payload->>'snapshot_version' is not null and p_payload->>'snapshot_version' is distinct from attempt
      then raise exception 'The report snapshot is not the published analysis of this review.'; end if;
    if p_payload->>'snapshot_cutoff' is not null
      and (p_payload->>'snapshot_cutoff')::date is distinct from (snapshot->>'snapshotCutoff')::date
      then raise exception 'The report cut-off is not the published cut-off of this review.'; end if;
    derived_counts := snapshot->'counts';
    if p_payload->'counts' is not null and p_payload->'counts' is distinct from derived_counts
      then raise exception 'Report counts do not match the published assessment snapshot.'; end if;
    insert into public.report_previews(project_id,created_by,assurance_review_id,report_type,reporting_period,
      audience,detail_level,original_sections,included_evidence_counts,provenance,review_state,
      snapshot_id,snapshot_cutoff,snapshot_version,snapshot_manifest)
    values(p_project_id,auth.uid(),p_review_id,'assurance_report',snapshot->>'cutoffLabel',
      p_payload->>'audience',p_payload->>'detail_level',p_payload->'sections',derived_counts,
      snapshot->'sources' || jsonb_build_array(jsonb_build_object('label','Analysis attempt','source',attempt)),
      'draft_ai_generated',attempt,(snapshot->>'snapshotCutoff')::date,attempt,
      snapshot || jsonb_build_object('audience',p_payload->>'audience','detailLevel',p_payload->>'detail_level'))
    returning id into result_id;
    update public.assurance_reviews set status = 'report_draft', current_step = 'report', updated_at = clock_timestamp()
      where id = p_review_id and project_id = p_project_id;
    return jsonb_build_object('id',result_id);
  elsif p_operation = 'approve' and p_preview_id is not null then
    if preview.assurance_review_id is null then
      -- An automatic draft approves without changing any review state.
      if preview.review_state not in ('draft_ai_generated','user_edited')
        then raise exception 'Only a draft can be approved.'; end if;
      update public.report_previews set review_state = 'reviewed', updated_at = clock_timestamp()
        where id = p_preview_id and project_id = p_project_id;
      insert into public.audit_events(project_id,actor_id,event_type,entity_type,entity_id,before_state,after_state)
        values(p_project_id,auth.uid(),'report_reviewed','report_preview',p_preview_id,to_jsonb(preview),
          jsonb_build_object('review_state','reviewed','assessment_snapshot_id',preview.snapshot_id));
      return jsonb_build_object('id',p_preview_id);
    end if;
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
    if p_payload->>'report_fingerprint' is distinct from report_fingerprint
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
revoke all on function public.assurance_report_operation(uuid,uuid,text,uuid,uuid,jsonb) from public, anon;
grant execute on function public.assurance_report_operation(uuid,uuid,text,uuid,uuid,jsonb) to authenticated;
