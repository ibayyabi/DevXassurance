-- Behavior tests for the caller-facing fencing contract (review rounds 2-3):
-- stale-attempt checkpoint rejection with owner content intact, named-argument
-- RPC resolution, shared webhook/polling admission cap, custom source_path
-- lineage, terminal replay idempotency, and needs_review publication without
-- a validated summary. Runs inside one transaction that always rolls back.
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/document_job_fencing_callers.test.sql

begin;
select plan(69);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, created_at, updated_at)
values ('40000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'caller-fencing@example.invalid', '', now(), '{}'::jsonb, now(), now())
on conflict (id) do nothing;
insert into public.profiles (id, full_name)
values ('40000000-0000-4000-8000-000000000001', 'Caller fencing member')
on conflict (id) do nothing;
insert into public.organizations (id, name)
values ('40000000-0000-4000-8000-000000000002', 'Caller fencing org')
on conflict (id) do nothing;
insert into public.projects (id, organization_id, name)
values ('40000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000002', 'Caller fencing project')
on conflict (id) do nothing;
insert into public.project_members (project_id, user_id, role)
values ('40000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000001', 'project_manager');

insert into public.documents (id, project_id, uploader_id, document_type, title, file_name, file_size, mime_type, storage_path, processing_status)
values
  ('40000000-0000-4000-8000-000000000011', '40000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000001', 'progress_report', 'Stale checkpoint doc', 'stale.pdf', 10, 'application/pdf', '40000000-0000-4000-8000-000000000003/stale.pdf', 'uploaded'),
  ('40000000-0000-4000-8000-000000000012', '40000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000001', 'progress_report', 'Webhook doc', 'webhook.pdf', 10, 'application/pdf', '40000000-0000-4000-8000-000000000003/webhook.pdf', 'uploaded'),
  ('40000000-0000-4000-8000-000000000013', '40000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000001', 'progress_report', 'Webhook doc two', 'webhook2.pdf', 10, 'application/pdf', '40000000-0000-4000-8000-000000000003/webhook2.pdf', 'uploaded'),
  ('40000000-0000-4000-8000-000000000014', '40000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000001', 'progress_report', 'Over cap doc', 'over.pdf', 10, 'application/pdf', '40000000-0000-4000-8000-000000000003/over.pdf', 'uploaded'),
  ('40000000-0000-4000-8000-000000000015', '40000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000001', 'progress_report', 'Custom lineage doc', 'lineage.pdf', 10, 'application/pdf', '40000000-0000-4000-8000-000000000003/lineage.pdf', 'uploaded'),
  ('40000000-0000-4000-8000-000000000016', '40000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000001', 'progress_report', 'Review fallback doc', 'fallback.pdf', 10, 'application/pdf', '40000000-0000-4000-8000-000000000003/fallback.pdf', 'uploaded');

select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select (public.queue_document_parse_job('40000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000011', 'upload'))->>'queued'), 'true', 'fixture job queued');

-- ---------------------------------------------------------------------------
-- Recovery handover: A loses the lease, B takes over with a fresh token
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
select is((select claim_token is not null from public.claim_next_available_document_job()), true, 'attempt A claims the fixture job');
update public.ai_jobs set claim_token = 'aaaaaaaa-0000-4000-8000-0000000000aa'
where document_id = '40000000-0000-4000-8000-000000000011' and status = 'processing';
update public.ai_jobs
set lease_expires_at = now() - interval '1 second'
where document_id = '40000000-0000-4000-8000-000000000011' and status = 'processing';
select is((select attempt_count from public.claim_next_available_document_job()), 2, 'attempt B takes over after the lease expires');

-- ---------------------------------------------------------------------------
-- Owner B writes every checkpoint through the fenced RPCs
-- ---------------------------------------------------------------------------
update public.ai_jobs set claim_token = 'bbbbbbbb-0000-4000-8000-0000000000bb'
where document_id = '40000000-0000-4000-8000-000000000011' and status = 'processing';

select is(
  (select public.save_document_chunks(
    (select id from public.ai_jobs where claim_token = 'bbbbbbbb-0000-4000-8000-0000000000bb'),
    'bbbbbbbb-0000-4000-8000-0000000000bb',
    jsonb_build_array(
      jsonb_build_object('chunk_index', 0, 'chunk_text', 'Owner B chunk zero.'),
      jsonb_build_object('chunk_index', 1, 'chunk_text', 'Owner B chunk one.')))),
  2, 'owner B persists chunks through the fenced RPC'
);
select lives_ok(
  format('select public.save_extraction_group(''%s'', ''bbbbbbbb-0000-4000-8000-0000000000bb'', ''%s''::jsonb)',
    (select id from public.ai_jobs where claim_token = 'bbbbbbbb-0000-4000-8000-0000000000bb'),
    jsonb_build_object('group_key', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'content_hash', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'parser_version', 'document-parser/6',
      'schema_version', 'phase6-document-extraction/15', 'group_index', 0,
      'chunk_start_index', 0, 'chunk_end_index', 1, 'status', 'completed',
      'result', jsonb_build_object('facts', jsonb_build_array()), 'attempt_count', 1,
      'provider', 'fixture', 'model', 'fixture')::text),
  'owner B persists the extraction group checkpoint'
);
select is(
  (select public.persist_cost_observations(
    (select id from public.ai_jobs where claim_token = 'bbbbbbbb-0000-4000-8000-0000000000bb'),
    'bbbbbbbb-0000-4000-8000-0000000000bb', repeat('a', 64), 'document-parser/6',
    'pmo-assurance-observations/1',
    jsonb_build_array(jsonb_build_object(
      'measure', 'eac', 'source_value', 'USD 100', 'scope_level', 'wbs',
      'scope_label', 'Alarm Kebencanaan', 'scope_source_id', 'subject-value',
      'scope_provenance', jsonb_build_array(
        jsonb_build_object('kind', 'declared_subject_key', 'source_id', 'subject-key', 'sheet_name', 'Project Info', 'cell_reference', 'A5', 'excerpt', 'Subsystem / Scope'),
        jsonb_build_object('kind', 'declared_subject', 'source_id', 'subject-value', 'sheet_name', 'Project Info', 'cell_reference', 'B5', 'excerpt', 'Alarm Kebencanaan'),
        jsonb_build_object('kind', 'sheet_title', 'source_id', 'weekly-title', 'sheet_name', 'Weekly Report', 'cell_reference', 'A1', 'excerpt', 'Weekly progress report - Alarm Kebencanaan')),
      'evidence_chunk_index', 0, 'excerpt', 'Owner B chunk zero.', 'provider', 'fixture', 'model', 'fixture')))),
  1, 'owner B persists versioned cost observations through the fenced RPC'
);
select is(
  (select scope_source_id from public.cost_observations where document_id = '40000000-0000-4000-8000-000000000011'),
  'subject-value', 'cost scope source id is persisted'
);
select is(
  (select scope_provenance from public.cost_observations where document_id = '40000000-0000-4000-8000-000000000011'),
  jsonb_build_array(
    jsonb_build_object('kind', 'declared_subject_key', 'source_id', 'subject-key', 'sheet_name', 'Project Info', 'cell_reference', 'A5', 'excerpt', 'Subsystem / Scope'),
    jsonb_build_object('kind', 'declared_subject', 'source_id', 'subject-value', 'sheet_name', 'Project Info', 'cell_reference', 'B5', 'excerpt', 'Alarm Kebencanaan'),
    jsonb_build_object('kind', 'sheet_title', 'source_id', 'weekly-title', 'sheet_name', 'Weekly Report', 'cell_reference', 'A1', 'excerpt', 'Weekly progress report - Alarm Kebencanaan')),
  'cost scope provenance retains exact subject and title sources'
);
select is(
  (select public.persist_assurance_observations(
    (select id from public.ai_jobs where claim_token = 'bbbbbbbb-0000-4000-8000-0000000000bb'),
    'bbbbbbbb-0000-4000-8000-0000000000bb', repeat('a', 64), 'document-parser/6',
    'pmo-assurance-observations/1',
    jsonb_build_array(jsonb_build_object('domain', 'schedule', 'observation_type', 'milestone',
      'observation', jsonb_build_object('label', 'Release', 'raw_date', '2026-06-30', 'date', '2026-06-30'),
      'evidence_chunk_index', 0, 'excerpt', 'Release 2026-06-30.')),
    jsonb_build_array(
      jsonb_build_object('domain', 'budget', 'state', 'processed', 'total_groups', 1, 'processed_groups', 1),
      jsonb_build_object('domain', 'schedule', 'state', 'processed', 'total_groups', 1, 'processed_groups', 1),
      jsonb_build_object('domain', 'progress', 'state', 'absent', 'total_groups', 1, 'processed_groups', 1),
      jsonb_build_object('domain', 'risk', 'state', 'absent', 'total_groups', 1, 'processed_groups', 1)))),
  1, 'owner B persists typed observations and coverage through the fenced RPC'
);
select is(
  (select assurance_observation_contract_version from public.documents
    where id = '40000000-0000-4000-8000-000000000011'),
  'pmo-assurance-observations/1', 'document current pointer follows persisted observations'
);
select lives_ok(
  format('select public.persist_document_suggestions(''%s'', ''bbbbbbbb-0000-4000-8000-0000000000bb'', ''%s''::jsonb)',
    (select id from public.ai_jobs where claim_token = 'bbbbbbbb-0000-4000-8000-0000000000bb'),
    jsonb_build_object('suggested_document_type', 'progress_report', 'classification_confidence', 0.9)::text),
  'owner B persists document suggestions through the fenced RPC'
);
select ok(
  (select lease_expires_at > now() from public.ai_jobs where claim_token = 'bbbbbbbb-0000-4000-8000-0000000000bb'),
  'checkpoint save renews the lease atomically'
);

-- ---------------------------------------------------------------------------
-- Stale attempt A cannot land any durable checkpoint write; B content intact
-- ---------------------------------------------------------------------------
update public.ai_jobs set claim_token = 'bbbbbbbb-0000-4000-8000-0000000000bb'
where document_id = '40000000-0000-4000-8000-000000000011' and status = 'processing';
-- (A's token was replaced by B's claim; every write below uses the stale A
-- identity that the recovery handed over.)

select throws_ok(
  format('select public.save_document_chunks(''%s'', ''aaaaaaaa-0000-4000-8000-0000000000aa'', ''[]''::jsonb)',
    (select id from public.ai_jobs where claim_token = 'bbbbbbbb-0000-4000-8000-0000000000bb')),
  'P0001',
  'Ownership rejected: this attempt lost ownership of the job (stale claim token).',
  'stale chunks write is rejected'
);
select throws_ok(
  format('select public.save_extraction_group(''%s'', ''aaaaaaaa-0000-4000-8000-0000000000aa'', ''{}''::jsonb)',
    (select id from public.ai_jobs where claim_token = 'bbbbbbbb-0000-4000-8000-0000000000bb')),
  'P0001',
  'Ownership rejected: this attempt lost ownership of the job (stale claim token).',
  'stale extraction group write is rejected'
);
select throws_ok(
  format('select public.persist_cost_observations(''%s'', ''aaaaaaaa-0000-4000-8000-0000000000aa'', ''%s'', ''document-parser/6'', ''pmo-assurance-observations/1'', ''[]''::jsonb)',
    (select id from public.ai_jobs where claim_token = 'bbbbbbbb-0000-4000-8000-0000000000bb'), repeat('a', 64)),
  'P0001',
  'Ownership rejected: this attempt lost ownership of the job (stale claim token).',
  'stale cost observation write is rejected'
);
select throws_ok(
  format('select public.persist_assurance_observations(''%s'', ''aaaaaaaa-0000-4000-8000-0000000000aa'', ''%s'', ''document-parser/6'', ''pmo-assurance-observations/1'', ''[]''::jsonb, ''[]''::jsonb)',
    (select id from public.ai_jobs where claim_token = 'bbbbbbbb-0000-4000-8000-0000000000bb'), repeat('a', 64)),
  'P0001',
  'Ownership rejected: this attempt lost ownership of the job (stale claim token).',
  'stale assurance observation write is rejected'
);
select throws_ok(
  format('select public.persist_document_suggestions(''%s'', ''aaaaaaaa-0000-4000-8000-0000000000aa'', ''{}''::jsonb)',
    (select id from public.ai_jobs where claim_token = 'bbbbbbbb-0000-4000-8000-0000000000bb')),
  'P0001',
  'Ownership rejected: this attempt lost ownership of the job (stale claim token).',
  'stale suggestion write is rejected'
);

select is((select count(*) from public.document_chunks where document_id = '40000000-0000-4000-8000-000000000011'), 2::bigint, 'stale writes leave owner chunks untouched');
select is((select chunk_text from public.document_chunks where document_id = '40000000-0000-4000-8000-000000000011' and chunk_index = 0), 'Owner B chunk zero.', 'owner chunk content is intact after stale attempts');
select is((select count(*) from public.document_extraction_groups), 1::bigint, 'owner group checkpoint is intact');
select is((select count(*) from public.cost_observations), 1::bigint, 'owner cost observations are intact');
select is((select suggested_document_type from public.documents where id = '40000000-0000-4000-8000-000000000011'), 'progress_report', 'owner suggestions are intact');

-- ---------------------------------------------------------------------------
-- Named-argument RPC resolution (the HTTP caller contract)
-- ---------------------------------------------------------------------------
select is(
  (select public.fail_document_job_attempt(
    fail_job_id => (select id from public.ai_jobs where claim_token = 'bbbbbbbb-0000-4000-8000-0000000000bb'),
    fail_project_id => '40000000-0000-4000-8000-000000000003',
    fail_document_id => '40000000-0000-4000-8000-000000000011',
    fail_claim_token => 'aaaaaaaa-0000-4000-8000-0000000000aa',
    fail_error_code => 'worker_failed',
    fail_error_message => 'stale terminal failure')),
  false, 'named-argument failure with the stale token is fenced'
);
select is(
  (select public.fail_document_job_attempt(
    fail_job_id => (select id from public.ai_jobs where claim_token = 'bbbbbbbb-0000-4000-8000-0000000000bb'),
    fail_project_id => '40000000-0000-4000-8000-000000000003',
    fail_document_id => '40000000-0000-4000-8000-000000000011',
    fail_claim_token => 'bbbbbbbb-0000-4000-8000-0000000000bb',
    fail_error_code => 'worker_failed',
    fail_error_message => 'owned terminal failure')),
  true, 'named-argument failure with the owning token records the failure'
);
select is((select status::text from public.ai_jobs where document_id = '40000000-0000-4000-8000-000000000011' order by created_at desc limit 1), 'failed', 'owned failure terminal state');

-- ---------------------------------------------------------------------------
-- Replay finalize after a terminal state never queues a new job
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  (select (public.queue_document_parse_job('40000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000011', 'upload'))->>'queued'),
  'false', 'replay finalize after terminal state is a no-op'
);
select is((select count(*) from public.ai_jobs where document_id = '40000000-0000-4000-8000-000000000011'), 1::bigint, 'terminal replay creates no new job');
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- Genuine re-upload after a terminal job queues a FRESH claimable job
-- ---------------------------------------------------------------------------
-- prepare swaps the document's identity to a new storage path + content hash
-- while reusing the document row; finalize must NOT treat this as a replay of
-- the failed job.
update public.documents
set
  storage_path = '40000000-0000-4000-8000-000000000003/stale-v2.pdf',
  content_hash = '2222222222222222222222222222222222222222222222222222222222222222',
  processing_status = 'uploaded'
where id = '40000000-0000-4000-8000-000000000011';

select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  (select (public.queue_document_parse_job('40000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000011', 'upload'))->>'queued'),
  'true', 're-upload after a failed job queues a fresh job'
);
select is(
  (select count(*) from public.ai_jobs where document_id = '40000000-0000-4000-8000-000000000011'),
  2::bigint, 'the fresh re-upload job is a new attempt, not the failed one'
);
select set_config('request.jwt.claims', '', true);
select is(
  (select count(*) from public.claim_document_job(
    (select id from public.ai_jobs
      where document_id = '40000000-0000-4000-8000-000000000011' and status = 'queued'))),
  1::bigint, 'the fresh re-upload job is claimable'
);
select is(
  (select metadata->>'upload_storage_path' from public.ai_jobs
    where document_id = '40000000-0000-4000-8000-000000000011' and status = 'processing'),
  '40000000-0000-4000-8000-000000000003/stale-v2.pdf',
  'the new job records the upload identity it was created for'
);
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  (select (public.queue_document_parse_job('40000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000011', 'upload'))->>'queued'),
  'false', 'repeated finalize of the new upload observes the active job'
);
select set_config('request.jwt.claims', '', true);
select is(
  (select public.fail_document_job_attempt(
    fail_job_id => (select id from public.ai_jobs where document_id = '40000000-0000-4000-8000-000000000011' and status = 'processing'),
    fail_project_id => '40000000-0000-4000-8000-000000000003',
    fail_document_id => '40000000-0000-4000-8000-000000000011',
    fail_claim_token => (select claim_token from public.ai_jobs where document_id = '40000000-0000-4000-8000-000000000011' and status = 'processing'),
    fail_error_code => 'worker_failed',
    fail_error_message => 'release the re-upload slot for the capacity section')),
  true, 're-upload slot freed via named-argument failure'
);

-- ---------------------------------------------------------------------------
-- Shared admission cap across webhook and polling entry points
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.queue_document_parse_job('40000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000012', 'upload');
select public.queue_document_parse_job('40000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000013', 'upload');
select public.queue_document_parse_job('40000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000014', 'upload');
-- Deterministic queue order within this transaction: same-timestamp rows tie
-- on id, so shift the later fixtures explicitly.
update public.ai_jobs set created_at = now() + interval '1 hour'
where document_id = '40000000-0000-4000-8000-000000000013';
update public.ai_jobs set created_at = now() + interval '2 hours'
where document_id = '40000000-0000-4000-8000-000000000014';
select set_config('request.jwt.claims', '', true);

select is((select count(*) from public.claim_next_available_document_job()), 1::bigint, 'polling claim fills the first active slot');
select is((select count(*) from public.claim_document_job(
  (select id from public.ai_jobs where document_id = '40000000-0000-4000-8000-000000000013' and status = 'queued'))), 1::bigint, 'webhook claim fills the second active slot');
select is((select count(*) from public.ai_jobs where status = 'processing'), 2::bigint, 'both entry points share the active-job state');
select is((select count(*) from public.claim_document_job(
  (select id from public.ai_jobs where document_id = '40000000-0000-4000-8000-000000000014' and status = 'queued'))), 0::bigint, 'webhook claim stops at the shared cap');
select is((select count(*) from public.claim_next_available_document_job()), 0::bigint, 'polling claim also stops at the shared cap');

-- ---------------------------------------------------------------------------
-- Custom source_path outputs still carry lineage and never duplicate on retry
-- ---------------------------------------------------------------------------
select is(
  (select public.fail_document_job_attempt(
    fail_job_id => (select id from public.ai_jobs where document_id = '40000000-0000-4000-8000-000000000012' and status = 'processing'),
    fail_project_id => '40000000-0000-4000-8000-000000000003',
    fail_document_id => '40000000-0000-4000-8000-000000000012',
    fail_claim_token => (select claim_token from public.ai_jobs where document_id = '40000000-0000-4000-8000-000000000012' and status = 'processing'),
    fail_error_code => 'worker_failed',
    fail_error_message => 'free the slot for the lineage test')),
  true, 'webhook slot freed via named-argument failure'
);
select is(
  (select public.fail_document_job_attempt(
    fail_job_id => (select id from public.ai_jobs where document_id = '40000000-0000-4000-8000-000000000013' and status = 'processing'),
    fail_project_id => '40000000-0000-4000-8000-000000000003',
    fail_document_id => '40000000-0000-4000-8000-000000000013',
    fail_claim_token => (select claim_token from public.ai_jobs where document_id = '40000000-0000-4000-8000-000000000013' and status = 'processing'),
    fail_error_code => 'worker_failed',
    fail_error_message => 'free the slot for the lineage test')),
  true, 'polling slot freed via named-argument failure'
);

select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  (select (public.retry_document_job('40000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000012') is not null)),
  true, 'manual retry queues a fresh job'
);
select set_config('request.jwt.claims', '', true);
select is((select count(*) from public.claim_next_available_document_job()), 1::bigint, 'lineage fixture job claimed');

update public.ai_jobs set claim_token = 'bbbbbbbb-0000-4000-8000-0000000000cc'
where document_id = '40000000-0000-4000-8000-000000000012' and status = 'processing';

-- ---------------------------------------------------------------------------
-- Stale attempt with a NULL token: rejected before any write or heartbeat
-- ---------------------------------------------------------------------------
select throws_ok(
  format('select public.save_document_chunks(''%s'', null, ''[]''::jsonb)',
    (select id from public.ai_jobs where claim_token = 'bbbbbbbb-0000-4000-8000-0000000000cc')),
  'P0001',
  'Ownership rejected: a claim token is required for every durable write.',
  'checkpoint write without a token is rejected'
);
select ok(
  (select lease_expires_at > now() from public.ai_jobs where claim_token = 'bbbbbbbb-0000-4000-8000-0000000000cc'),
  'rejected tokenless write performs no heartbeat'
);

-- ---------------------------------------------------------------------------
-- Failed extraction groups (JSON null result) are legitimate checkpoints
-- ---------------------------------------------------------------------------
select lives_ok(
  format('select public.save_extraction_group(''%s'', ''bbbbbbbb-0000-4000-8000-0000000000cc'', ''%s''::jsonb)',
    (select id from public.ai_jobs where claim_token = 'bbbbbbbb-0000-4000-8000-0000000000cc'),
    jsonb_build_object('group_key', repeat('f', 64), 'content_hash', repeat('e', 64), 'parser_version', 'document-parser/6',
      'schema_version', 'phase6-document-extraction/15', 'group_index', 1,
      'chunk_start_index', 0, 'chunk_end_index', 1, 'status', 'failed',
      'result', null, 'attempt_count', 2, 'provider', 'fixture', 'model', 'fixture',
      'last_error', 'The provider response failed schema validation.')::text),
  'failed group checkpoint with JSON null result is accepted'
);
select is(
  (select status from public.document_extraction_groups
    where document_id = '40000000-0000-4000-8000-000000000012' and group_key = repeat('f', 64)),
  'failed', 'failed group checkpoint persists'
);


select is(
  (select result->>'status' from (select (public.complete_document_job(
    (select id from public.ai_jobs where claim_token = 'bbbbbbbb-0000-4000-8000-0000000000cc'),
    'bbbbbbbb-0000-4000-8000-0000000000cc',
    jsonb_build_object(
      'facts', jsonb_build_array(),
      'summary', jsonb_build_object('summary_text', 'Lineage fixture summary', 'confidence', 0.8),
      'summary_sources', jsonb_build_array(jsonb_build_object('chunk_index', null, 'excerpt', 'no chunk', 'confidence', 0.8)),
      'alerts', jsonb_build_array(jsonb_build_object('severity', 'low', 'explanation', 'Custom path alert', 'source_path', '/app/custom/alert')),
      'actions', jsonb_build_array(jsonb_build_object('title', 'Custom path action', 'source_path', '/app/custom/action')),
      'anomalies', jsonb_build_array(jsonb_build_object('category', 'risk', 'severity', 'low', 'title', 'Custom path anomaly',
        'explanation', 'Custom path anomaly explanation.', 'absence_type', 'not_found_in_evidence', 'source_path', '/app/custom/anomaly'))))) as result)) ,
  'completed', 'publication with custom source paths completes'
);
select is((select count(*) from public.dashboard_critical_alerts where source_path = '/app/custom/alert'), 1::bigint, 'custom-path alert published');
select ok((select ai_job_id is not null from public.dashboard_critical_alerts where source_path = '/app/custom/alert'), 'custom-path alert carries job lineage');
select ok((select ai_job_id is not null from public.recommended_actions where source_path = '/app/custom/action'), 'custom-path action carries job lineage');
select ok((select ai_job_id is not null from public.anomalies where source_path = '/app/custom/anomaly'), 'custom-path anomaly carries job lineage');

select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select public.retry_document_job('40000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000012') is not null), true, 'retry replaces the custom-path attempt');
select set_config('request.jwt.claims', '', true);
select is((select count(*) from public.dashboard_critical_alerts), 0::bigint, 'retry discards custom-path alerts');
select is((select count(*) from public.recommended_actions), 0::bigint, 'retry discards custom-path actions');
select is((select count(*) from public.anomalies), 0::bigint, 'retry discards custom-path anomalies');

-- ---------------------------------------------------------------------------
-- Content identity crosses the atomic intake boundary (ZIP members)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  (select queued from public.create_document_with_job(
    '40000000-0000-4000-8000-000000000003', null, 'hashed-member', 'Hashed member', 'hashed.pdf', 10,
    'application/pdf', '40000000-0000-4000-8000-000000000003/hashed-member.pdf', 'unknown', null, true,
    'zip_import', '{}'::jsonb,
    '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef')),
  true, 'hashed archive member intake queues the job'
);
select is(
  (select content_hash from public.documents where storage_path = '40000000-0000-4000-8000-000000000003/hashed-member.pdf'),
  '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  'content hash persists through the atomic intake boundary'
);
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- needs_review publication without a validated summary
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.retry_document_job('40000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000016') as fallback_job_id \gset
select ok(:'fallback_job_id' is not null, 'fallback fixture job queued');
select set_config('request.jwt.claims', '', true);
select is((select count(*) from public.claim_document_job(:'fallback_job_id')), 1::bigint, 'fallback fixture job claimed');
update public.ai_jobs set claim_token = 'bbbbbbbb-0000-4000-8000-0000000000dd'
where id = :'fallback_job_id';

select is(
  (select public.complete_document_job(
    :'fallback_job_id',
    'bbbbbbbb-0000-4000-8000-0000000000dd',
    jsonb_build_object(
      'processing_status', 'needs_review',
      'processing_error', 'Guardrail fallback requires review.',
      'facts', jsonb_build_array(),
      'summary', null,
      'summary_sources', jsonb_build_array(),
      'alerts', jsonb_build_array(),
      'actions', jsonb_build_array(),
      'anomalies', jsonb_build_array(),
      'health_snapshots', jsonb_build_array(
        jsonb_build_object('dimension', 'overall', 'score', 95, 'status', 'green',
          'evidence_coverage', 0.9, 'status_text', 'Overall Status: Green',
          'source_summary', 'Overall Status: Green', 'snapshot_date', '2026-06-30'),
        jsonb_build_object('dimension', 'schedule', 'score', 80, 'status', 'green',
          'evidence_coverage', 0.8, 'status_text', 'Schedule: Green',
          'source_summary', 'Schedule: Green', 'snapshot_date', null)
      )
    )
  )->>'status'),
  'completed', 'needs_review publication without a summary succeeds'
);
select is((select processing_status::text from public.documents where id = '40000000-0000-4000-8000-000000000016'), 'needs_review', 'fallback document lands as needs_review');
select is((select count(*) from public.document_summaries), 0::bigint, 'no invented summary row for the fallback');
select is((select status::text from public.extraction_runs where document_id = '40000000-0000-4000-8000-000000000016'), 'needs_review', 'extraction run records the needs_review terminal state');
select is(
  (select status::text from public.dashboard_health_snapshots
    where project_id = '40000000-0000-4000-8000-000000000003'
      and dimension = 'overall' and snapshot_date = '2026-06-30'),
  'insufficient_evidence', 'needs_review health statuses are not promoted'
);
select is(
  (select score from public.dashboard_health_snapshots
    where project_id = '40000000-0000-4000-8000-000000000003'
      and dimension = 'overall' and snapshot_date = '2026-06-30'),
  null::numeric, 'source-reported status has no fabricated score'
);
select is(
  (select status_text from public.dashboard_health_snapshots
    where project_id = '40000000-0000-4000-8000-000000000003'
      and dimension = 'overall' and snapshot_date = '2026-06-30'),
  'Overall Status: Green', 'needs_review preserves the source-reported status text'
);
select is(
  (select count(*) from public.dashboard_health_snapshots
    where project_id = '40000000-0000-4000-8000-000000000003'
      and source_summary = 'Schedule: Green'),
  0::bigint, 'health snapshots without a source date are not assigned a fallback date'
);

-- ---------------------------------------------------------------------------
-- Explicit lineage wins over the legacy source_path marker
-- ---------------------------------------------------------------------------
-- The custom-path alert carries the publishing job's lineage but a crafted
-- source_path embedding ANOTHER job's legacy marker.
insert into public.dashboard_critical_alerts (
  project_id, severity, impacted_area, explanation, recommended_action,
  source_path, ai_job_id
) values (
  '40000000-0000-4000-8000-000000000003', 'low', 'Lineage precedence',
  'Crafted marker must not decide ownership.',
  'Lineage column wins.',
  '/app/custom/alert?job=' || (select id from public.ai_jobs where document_id = '40000000-0000-4000-8000-000000000016' and status = 'needs_review'),
  (select id from public.ai_jobs where document_id = '40000000-0000-4000-8000-000000000012' and status = 'completed')
);
select public.discard_document_job_results(
  (select id from public.ai_jobs where document_id = '40000000-0000-4000-8000-000000000016' and status = 'needs_review')
);
select is(
  (select count(*) from public.dashboard_critical_alerts where source_path like '/app/custom/alert%'),
  1::bigint, 'another job marker cleanup cannot delete lineage-stamped rows'
);
select public.discard_document_job_results(
  (select id from public.ai_jobs where document_id = '40000000-0000-4000-8000-000000000012' and status = 'completed')
);
select is(
  (select count(*) from public.dashboard_critical_alerts where source_path like '/app/custom/alert%'),
  0::bigint, 'the owning job cleanup removes its own lineage rows'
);

select * from finish();
rollback;