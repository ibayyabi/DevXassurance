-- Batch 1A: no new result/history tables. Existing JSON carries attempt ownership.
-- Helpers are owner-only; authenticated entry points explicitly enforce the
-- server actions' manager roles (can_upload_project_evidence also allows reviewers).
create function public.lock_assurance_review(p_project_id uuid, p_review_id uuid)
returns public.assurance_reviews
language plpgsql security definer set search_path = '' as $$
declare r public.assurance_reviews;
begin
  if auth.uid() is null or not exists (
    select 1 from public.project_members where project_id = p_project_id
      and user_id = auth.uid() and role in ('admin', 'pmc_consultant', 'project_manager')
  ) then raise exception 'Your project role cannot manage an assurance review.'; end if;
  select * into r from public.assurance_reviews
    where id = p_review_id and project_id = p_project_id for update;
  if not found then raise exception 'Assurance review was not found in this project.'; end if;
  return r;
end;
$$;

-- Fingerprint the actual stored source, including Storage's object metadata,
-- ordered text and locations. General document updated_at is deliberately absent.
-- sha256(bytea) is a PostgreSQL built-in; no extension is required.
create function public.assurance_source_snapshot(p_project_id uuid, p_review_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare sources jsonb; chunks jsonb; baseline uuid[]; current_ids uuid[];
begin
  -- Short source locks prevent changes after verification but before commit.
  -- Document FOR UPDATE also blocks new chunks' FK checks; existing chunk and
  -- Storage rows are locked explicitly because their updates need not touch d.
  perform d.id from public.documents d join public.assurance_review_documents l on l.document_id = d.id
    where l.review_id = p_review_id and l.project_id = p_project_id and d.project_id = p_project_id
    order by d.id for update of d;
  perform c.id from public.document_chunks c join public.assurance_review_documents l on l.document_id = c.document_id
    where l.review_id = p_review_id and l.project_id = p_project_id and c.project_id = p_project_id
    order by c.id for share of c;
  perform o.id from storage.objects o join public.documents d on d.storage_bucket = o.bucket_id and d.storage_path = o.name
    join public.assurance_review_documents l on l.document_id = d.id
    where l.review_id = p_review_id and l.project_id = p_project_id and d.project_id = p_project_id
    order by o.id for share of o;
  if exists (
    select 1 from public.assurance_review_documents l
    left join public.documents d on d.id = l.document_id and d.project_id = p_project_id
    where l.review_id = p_review_id and (l.project_id <> p_project_id
      or d.id is null or d.processing_status <> 'completed')
  ) then raise exception 'Selected evidence is unavailable or not completed.'; end if;
  select array_agg(document_id order by document_id) filter (where evidence_role = 'baseline'),
    array_agg(document_id order by document_id) filter (where evidence_role = 'current')
    into baseline, current_ids from public.assurance_review_documents
    where review_id = p_review_id and project_id = p_project_id;
  if coalesce(cardinality(baseline), 0) = 0 or coalesce(cardinality(current_ids), 0) = 0
    then raise exception 'Select completed baseline and current evidence first.'; end if;
  select jsonb_agg(jsonb_build_object(
    'document_id', d.id, 'role', l.evidence_role, 'processing_status', d.processing_status,
    'source', jsonb_build_object('title', d.title, 'file_name', d.file_name,
      'file_size', d.file_size, 'mime_type', d.mime_type,
      'storage_bucket', d.storage_bucket, 'storage_path', d.storage_path,
      'document_type', d.document_type, 'document_date', d.document_date,
      'confirmed_document_type', d.confirmed_document_type,
      'confirmed_document_date', d.confirmed_document_date,
      'confirmed_evidence_role', d.confirmed_evidence_role,
      'confirmed_reporting_period', d.confirmed_reporting_period,
      'confirmed_workstream', d.confirmed_workstream),
    'storage_object', (select to_jsonb(o) - array['last_accessed_at', 'owner', 'owner_id']
      from storage.objects o where o.bucket_id = d.storage_bucket and o.name = d.storage_path),
    'chunks', coalesce((select jsonb_agg(to_jsonb(c) - 'created_at' order by c.chunk_index, c.id)
      from public.document_chunks c where c.document_id = d.id and c.project_id = p_project_id), '[]'::jsonb)
  ) order by d.id) into sources
  from public.assurance_review_documents l join public.documents d on d.id = l.document_id
  where l.review_id = p_review_id and l.project_id = p_project_id and d.project_id = p_project_id;
  -- Return the very chunks fingerprinted above, never a second live chunk read.
  if jsonb_array_length(sources) <> cardinality(baseline || current_ids) or exists (
    select 1 from jsonb_array_elements(sources) x where x->>'processing_status' <> 'completed'
      or x->'storage_object' = 'null'::jsonb
  ) then raise exception 'Selected evidence changed while reading its source.'; end if;
  select coalesce(jsonb_agg(c.value || jsonb_build_object('documents',
    jsonb_build_object('title', d.value->'source'->>'title'))
    order by d.value->>'document_id', (c.value->>'chunk_index')::integer, c.value->>'id'),'[]'::jsonb)
    into chunks from jsonb_array_elements(sources) d
    cross join lateral jsonb_array_elements(d.value->'chunks') c;
  return jsonb_build_object('fingerprint', encode(sha256(convert_to(sources::text, 'UTF8')), 'hex'),
    'baseline_ids', to_jsonb(baseline), 'current_ids', to_jsonb(current_ids), 'chunks', chunks);
end;
$$;

create function public.assurance_analysis_is_current(p_project_id uuid, p_review_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare r public.assurance_reviews; s jsonb; success jsonb; attempt jsonb;
begin
  select * into r from public.assurance_reviews where id = p_review_id and project_id = p_project_id;
  if not found then return false; end if;
  success := r.analysis_metadata->'last_success'; attempt := r.analysis_metadata->'latest_attempt';
  if success->>'id' is null or attempt->>'outcome' is distinct from 'succeeded'
    or attempt->>'id' is distinct from success->>'id'
    or r.status not in ('findings_ready', 'report_draft', 'approved') then return false; end if;
  begin s := public.assurance_source_snapshot(p_project_id, p_review_id);
  exception when others then return false; end;
  if s->>'fingerprint' is distinct from success->>'fingerprint' then return false; end if;
  return (select count(*) = 3 and count(distinct domain) = 3 and bool_and(coalesce(
    provenance->>'analysis_attempt_id' = success->>'id'
    and to_jsonb(baseline_document_ids) = s->'baseline_ids'
    and to_jsonb(current_document_ids) = s->'current_ids', false))
    from public.assurance_findings where review_id = p_review_id and project_id = p_project_id);
end;
$$;

create function public.save_assurance_evidence(p_project_id uuid, p_review_id uuid,
  p_baseline_ids uuid[], p_current_ids uuid[])
returns boolean language plpgsql security definer set search_path = '' as $$
declare r public.assurance_reviews; s jsonb; b uuid[]; c uuid[]; same_selection boolean;
begin
  r := public.lock_assurance_review(p_project_id, p_review_id);
  select array_agg(distinct x order by x) into b from unnest(p_baseline_ids) x where x is not null;
  select array_agg(distinct x order by x) into c from unnest(p_current_ids) x where x is not null;
  if coalesce(cardinality(b),0) = 0 or coalesce(cardinality(c),0) = 0 or b && c
    then raise exception 'Choose distinct baseline and current evidence.'; end if;
  if (select count(*) from public.documents where project_id = p_project_id
    and id = any(b || c) and processing_status = 'completed') <> cardinality(b || c)
    then raise exception 'Selected documents must be completed and belong to this project.'; end if;
  same_selection := (select coalesce(array_agg(document_id order by document_id)
    filter (where evidence_role = 'baseline'), '{}'::uuid[]) = b
    and coalesce(array_agg(document_id order by document_id)
    filter (where evidence_role = 'current'), '{}'::uuid[]) = c
    from public.assurance_review_documents where project_id = p_project_id and review_id = p_review_id);
  if not same_selection then
    delete from public.assurance_review_documents where project_id = p_project_id and review_id = p_review_id;
    insert into public.assurance_review_documents(project_id, review_id, document_id, evidence_role, added_by)
      select p_project_id, p_review_id, x, 'baseline', auth.uid() from unnest(b) x
      union all select p_project_id, p_review_id, x, 'current', auth.uid() from unnest(c) x;
  end if;
  s := public.assurance_source_snapshot(p_project_id, p_review_id);
  if same_selection and s->>'fingerprint' = coalesce(r.analysis_metadata->>'selection_fingerprint',
    r.analysis_metadata->'last_success'->>'fingerprint') then return false; end if;
  update public.assurance_reviews set status = 'evidence_ready', current_step = 'analysis',
    analysis_error = null, approved_at = null, reviewed_by = null,
    analysis_metadata = analysis_metadata || jsonb_build_object('selection_fingerprint',s->>'fingerprint') ||
      case when analysis_metadata->'latest_attempt'->>'outcome' = 'analyzing' then
        jsonb_build_object('latest_attempt',analysis_metadata->'latest_attempt' ||
          jsonb_build_object('outcome','invalidated','finished_at',clock_timestamp()))
      else '{}'::jsonb end,
    updated_at = clock_timestamp() where id = p_review_id and project_id = p_project_id;
  return true;
end;
$$;

-- Batch 1B can consume this member-only projection without duplicating the rule
-- or granting direct access to the owner-only source/content helpers.
create function public.get_assurance_analysis_state(p_project_id uuid, p_review_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.assurance_reviews;
begin
  if auth.uid() is null or not public.is_project_member(p_project_id)
    then raise exception 'Project membership is required.'; end if;
  select * into r from public.assurance_reviews where id = p_review_id and project_id = p_project_id for share;
  if not found then raise exception 'Assurance review was not found in this project.'; end if;
  return jsonb_build_object('current',public.assurance_analysis_is_current(p_project_id,p_review_id),
    'status',r.status,'latest_attempt',r.analysis_metadata->'latest_attempt',
    'last_success',r.analysis_metadata->'last_success');
end;
$$;

create function public.claim_assurance_analysis(p_project_id uuid, p_review_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.assurance_reviews; s jsonb; attempt jsonb;
begin
  r := public.lock_assurance_review(p_project_id, p_review_id);
  if r.analysis_metadata->'latest_attempt'->>'outcome' = 'analyzing'
    and coalesce((r.analysis_metadata->'latest_attempt'->>'lease_until')::timestamptz, 'infinity') > clock_timestamp()
    then raise exception 'Analysis is already running for this review.'; end if;
  s := public.assurance_source_snapshot(p_project_id, p_review_id);
  attempt := jsonb_build_object('id', gen_random_uuid(), 'outcome', 'analyzing',
    'started_at', clock_timestamp(), 'lease_until', clock_timestamp() + interval '15 minutes',
    'fingerprint', s->>'fingerprint');
  update public.assurance_reviews set status = 'analyzing', current_step = 'analysis', analysis_error = null,
    analysis_metadata = analysis_metadata || jsonb_build_object('latest_attempt', attempt,
      'selection_fingerprint', s->>'fingerprint'), updated_at = clock_timestamp()
    where id = p_review_id and project_id = p_project_id;
  return s || jsonb_build_object('attempt_id', attempt->>'id');
end;
$$;

create function public.finish_assurance_analysis(p_project_id uuid, p_review_id uuid,
  p_attempt_id uuid, p_findings jsonb default null, p_actions jsonb default '[]',
  p_metadata jsonb default '{}', p_error text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare r public.assurance_reviews; attempt jsonb; s jsonb; f jsonb; a jsonb; failure text := p_error;
  completed timestamptz := clock_timestamp(); inserted_id uuid;
begin
  r := public.lock_assurance_review(p_project_id, p_review_id);
  attempt := r.analysis_metadata->'latest_attempt';
  if attempt->>'id' is distinct from p_attempt_id::text or attempt->>'outcome' is distinct from 'analyzing'
    then return false; end if;
  if (attempt->>'lease_until')::timestamptz <= clock_timestamp()
    then failure := 'Analysis attempt expired. Run analysis again.'; end if;
  begin s := public.assurance_source_snapshot(p_project_id, p_review_id);
  exception when others then failure := 'Selected evidence is no longer available.'; end;
  if s->>'fingerprint' is distinct from attempt->>'fingerprint'
    then failure := 'Evidence changed during analysis. Run analysis again.'; end if;
  if failure is not null then
    update public.assurance_reviews set status = 'analysis_failed', current_step = 'analysis',
      analysis_error = left(failure,1000),
      analysis_metadata = jsonb_set(analysis_metadata, '{latest_attempt}', attempt ||
        jsonb_build_object('outcome','analysis_failed','finished_at',completed)), updated_at = completed
      where id = p_review_id and project_id = p_project_id;
    return false;
  end if;
  if jsonb_typeof(p_findings) is distinct from 'array' or jsonb_array_length(p_findings) <> 3
    then raise exception 'Publish all three domain findings together.'; end if;
  if (select count(distinct x->>'domain') from jsonb_array_elements(p_findings) x
    where x->>'domain' in ('budget','schedule','risk')) <> 3
    then raise exception 'Publish Budget, Schedule, and Risk exactly once.'; end if;
  -- Preserve the existing successful-rerun replacement policy. Reconciliation is
  -- a separate batch; putting it here makes replacement rollback on any failure.
  delete from public.assurance_actions where project_id = p_project_id and review_id = p_review_id;
  delete from public.assurance_findings where project_id = p_project_id and review_id = p_review_id;
  for f in select value from jsonb_array_elements(p_findings) loop
    insert into public.assurance_findings(project_id,review_id,domain,condition,severity,headline,explanation,
      baseline_value,current_value,variance,required_evidence,baseline_document_ids,current_document_ids,
      source_excerpts,confidence,provenance)
    values(p_project_id,p_review_id,f->>'domain',f->>'condition',f->>'severity',f->>'headline',f->>'explanation',
      f->'baselineValue',f->'currentValue',f->'variance',
      array(select jsonb_array_elements_text(f->'requiredEvidence')),
      array(select jsonb_array_elements_text(s->'baseline_ids'))::uuid[],
      array(select jsonb_array_elements_text(s->'current_ids'))::uuid[],f->'sourceExcerpts',
      (f->>'confidence')::numeric, coalesce(p_metadata,'{}'::jsonb) ||
        jsonb_build_object('analysis_attempt_id',p_attempt_id)) returning id into inserted_id;
    for a in select value from jsonb_array_elements(p_actions) where value->>'domain' = f->>'domain' loop
      insert into public.assurance_actions(project_id,review_id,finding_id,title,priority,status)
        values(p_project_id,p_review_id,inserted_id,a->>'title',a->>'priority','open');
    end loop;
  end loop;
  update public.assurance_reviews set status = 'findings_ready', current_step = 'findings', analysis_error = null,
    approved_at = null, reviewed_by = null,
    analysis_metadata = analysis_metadata || coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object(
      'completed_at',completed,'latest_attempt',attempt || jsonb_build_object('outcome','succeeded','finished_at',completed),
      'last_success',jsonb_build_object('id',p_attempt_id,'completed_at',completed,'fingerprint',s->>'fingerprint'),
      'baseline_document_count',jsonb_array_length(s->'baseline_ids'),
      'current_document_count',jsonb_array_length(s->'current_ids')),
    updated_at = completed where id = p_review_id and project_id = p_project_id;
  return true;
end;
$$;

-- A single checked context is used before report construction and checked again
-- in the same transaction that persists a preview, approval or export record.
create function public.assurance_report_operation(p_project_id uuid, p_review_id uuid,
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
    insert into public.report_previews(project_id,created_by,assurance_review_id,report_type,reporting_period,
      audience,detail_level,original_sections,included_evidence_counts,provenance,review_state)
    values(p_project_id,auth.uid(),p_review_id,'assurance_report',p_payload->>'reporting_period',
      p_payload->>'audience',p_payload->>'detail_level',p_payload->'sections',p_payload->'counts',
      coalesce(p_payload->'provenance','[]'::jsonb) || jsonb_build_array(
        jsonb_build_object('label','Analysis attempt','source',attempt)),'draft_ai_generated') returning id into result_id;
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

revoke all on function public.lock_assurance_review(uuid,uuid) from public, anon, authenticated;
revoke all on function public.assurance_source_snapshot(uuid,uuid) from public, anon, authenticated;
revoke all on function public.assurance_analysis_is_current(uuid,uuid) from public, anon, authenticated;
revoke all on function public.save_assurance_evidence(uuid,uuid,uuid[],uuid[]) from public, anon;
revoke all on function public.get_assurance_analysis_state(uuid,uuid) from public, anon;
revoke all on function public.claim_assurance_analysis(uuid,uuid) from public, anon;
revoke all on function public.finish_assurance_analysis(uuid,uuid,uuid,jsonb,jsonb,jsonb,text) from public, anon;
revoke all on function public.assurance_report_operation(uuid,uuid,text,uuid,uuid,jsonb) from public, anon;
grant execute on function public.save_assurance_evidence(uuid,uuid,uuid[],uuid[]) to authenticated;
grant execute on function public.get_assurance_analysis_state(uuid,uuid) to authenticated;
grant execute on function public.claim_assurance_analysis(uuid,uuid) to authenticated;
grant execute on function public.finish_assurance_analysis(uuid,uuid,uuid,jsonb,jsonb,jsonb,text) to authenticated;
grant execute on function public.assurance_report_operation(uuid,uuid,text,uuid,uuid,jsonb) to authenticated;
