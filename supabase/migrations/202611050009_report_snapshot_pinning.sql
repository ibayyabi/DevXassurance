-- Pin every report draft to the published assessment snapshot it was generated
-- from. Without this a report could only be described by its review id, so a
-- later analysis of the same review silently re-attributed an old draft to new
-- evidence.
--
-- Identity is derived server-side, never taken from the caller. A report may
-- only be pinned to the review's published analysis attempt, and the cut-off,
-- assessed values, gaps, actions and concrete evidence sources are all read
-- from the bound rows inside the same transaction that holds the review lock.
-- A caller that calls the RPC directly can therefore not forge a snapshot id, a
-- cut-off, or a source list; the payload only supplies presentation choices
-- (audience, detail level) and the rendered section text, whose numbers are
-- checked against the derived counts.
--
-- This migration intentionally does not resolve which snapshot to report. The
-- report layer picks one (see src/features/reports/lib/snapshot-source.ts);
-- today the assessment stream publishes one version per successful analysis.

alter table public.report_previews
  add column if not exists snapshot_id text,
  add column if not exists snapshot_cutoff date,
  add column if not exists snapshot_version text,
  add column if not exists snapshot_manifest jsonb not null default '{}'::jsonb;

create index if not exists report_previews_project_snapshot_idx
  on public.report_previews(project_id, snapshot_id);

-- The single derivation of a report snapshot, used both to render a draft
-- (assurance_report_operation 'context') and to persist it ('create'), so the
-- two can never disagree. Not callable from an application role.
create or replace function public.assurance_report_snapshot(p_project_id uuid, p_review_id uuid, p_attempt_id text)
returns jsonb language sql security definer set search_path = '' stable as $$
  with review as (
    select r.reporting_period,
      case when r.cutoff_precision = 'month'
           then (date_trunc('month', r.reporting_period::timestamp) + interval '1 month - 1 day')::date
           else r.reporting_period end as cutoff
    from public.assurance_reviews r
    where r.id = p_review_id and r.project_id = p_project_id
  ), evidence as (
    select count(*) as doc_count,
      coalesce(jsonb_agg(jsonb_build_object(
        'label', 'Evidence document',
        'source', 'documents:' || d.id::text,
        'documentId', d.id,
        'documentName', d.file_name,
        'evidenceRole', l.evidence_role,
        'contentHash', d.content_hash,
        'parserVersion', d.assurance_observation_parser_version,
        'contractVersion', d.assurance_observation_contract_version
      ) order by l.evidence_role, d.id), '[]'::jsonb) as sources
    from public.assurance_review_documents l
    join public.documents d on d.id = l.document_id and d.project_id = l.project_id
    where l.review_id = p_review_id and l.project_id = p_project_id
  ), assessed as (
    select coalesce(jsonb_agg(jsonb_build_object(
        'domain', f.domain, 'condition', f.condition, 'headline', f.headline,
        'explanation', f.explanation, 'confirmationState', f.confirmation_state
      ) order by f.domain), '[]'::jsonb) as assessed_rows
    from public.assurance_findings f
    where f.review_id = p_review_id and f.project_id = p_project_id
      and f.condition <> 'more_evidence_required'
  ), missing as (
    select coalesce(jsonb_agg(jsonb_build_object('domain', f.domain, 'reason', f.headline)
      order by f.domain), '[]'::jsonb) as gap_rows
    from public.assurance_findings f
    where f.review_id = p_review_id and f.project_id = p_project_id
      and f.condition = 'more_evidence_required'
  ), acts as (
    select coalesce(jsonb_agg(jsonb_build_object('title', a.title, 'ownerName', a.owner_name,
      'dueDate', a.due_date, 'status', a.status) order by a.priority desc), '[]'::jsonb) as action_rows
    from public.assurance_actions a
    where a.review_id = p_review_id and a.project_id = p_project_id
  ), counts as (
    select jsonb_build_object(
      'snapshot_documents', e.doc_count,
      'assessed_domains', jsonb_array_length(a.assessed_rows),
      'evidence_gaps', jsonb_array_length(m.gap_rows),
      'critical_conditions', (select count(*) from public.assurance_findings f
        where f.review_id = p_review_id and f.project_id = p_project_id and f.condition = 'critical'),
      'actions', jsonb_array_length(x.action_rows),
      'confirmed_findings', (select count(*) from public.assurance_findings f
        where f.review_id = p_review_id and f.project_id = p_project_id
          and f.condition <> 'more_evidence_required' and f.confirmation_state = 'user_confirmed')
    ) as derived
    from evidence e, assessed a, missing m, acts x
  )
  select jsonb_build_object(
    'snapshotId', p_attempt_id,
    'snapshotVersion', p_attempt_id,
    'snapshotCutoff', r.cutoff,
    'cutoffLabel', to_char(r.cutoff, 'FMMonth YYYY'),
    'reviewId', p_review_id,
    'evidenceCount', e.doc_count,
    'values', a.assessed_rows,
    'gaps', m.gap_rows,
    'actions', x.action_rows,
    'sources', jsonb_build_array(jsonb_build_object(
      'label', 'Assessment snapshot',
      'source', 'assurance_reviews:' || p_review_id::text || '#' || p_attempt_id)) || e.sources,
    'counts', c.derived)
  from review r, evidence e, assessed a, missing m, acts x, counts c;
$$;

revoke all on function public.assurance_report_snapshot(uuid,uuid,text) from public, anon, authenticated;

-- Additive rewrite of the report operation: the signature and every existing
-- operation keep their behaviour. 'context' additionally returns the derived
-- snapshot, and 'create' pins the draft to it instead of trusting the payload.
create or replace function public.assurance_report_operation(p_project_id uuid, p_review_id uuid,
  p_operation text, p_preview_id uuid default null, p_attempt_id uuid default null,
  p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.assurance_reviews; preview public.report_previews; attempt text; result_id uuid;
  report_fingerprint text; snapshot jsonb; derived_counts jsonb;
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
    -- The caller may echo the identity it rendered from, but never choose it.
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
