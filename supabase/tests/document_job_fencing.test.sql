-- Behavior tests for migration 202611020002 (document job fencing).
-- Runs inside one transaction that always rolls back. Requires pgTAP.
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/document_job_fencing.test.sql

begin;
select plan(32);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, created_at, updated_at)
values ('30000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'fencing-test@example.invalid', '', now(), '{}'::jsonb, now(), now())
on conflict (id) do nothing;
insert into public.profiles (id, full_name)
values ('30000000-0000-4000-8000-000000000001', 'Fencing test member')
on conflict (id) do nothing;
insert into public.organizations (id, name)
values ('30000000-0000-4000-8000-000000000002', 'Fencing test org')
on conflict (id) do nothing;
insert into public.projects (id, organization_id, name)
values ('30000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002', 'Fencing test project')
on conflict (id) do nothing;
insert into public.project_members (project_id, user_id, role)
values ('30000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001', 'project_manager');

-- ---------------------------------------------------------------------------
-- Atomic upload finalize: queue_document_parse_job idempotency
-- ---------------------------------------------------------------------------
insert into public.documents (id, project_id, uploader_id, document_type, title, file_name, file_size, mime_type, storage_path, processing_status)
values ('30000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001', 'progress_report', 'Fencing doc', 'fencing.pdf', 10, 'application/pdf', '30000000-0000-4000-8000-000000000003/fencing.pdf', 'uploaded');

select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select (public.queue_document_parse_job('30000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000004', 'upload'))->>'queued'), 'true', 'finalize queues the parse job');
select is((select processing_status::text from public.documents where id = '30000000-0000-4000-8000-000000000004'), 'queued', 'finalize flips the document atomically');
select is((select (public.queue_document_parse_job('30000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000004', 'upload'))->>'queued'), 'false', 'repeated finalize is idempotent');
select is((select count(*) from public.ai_jobs where document_id = '30000000-0000-4000-8000-000000000004'), 1::bigint, 'repeated finalize creates no duplicate job');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000009","role":"authenticated"}', true);
select throws_ok(
  'select public.queue_document_parse_job(''30000000-0000-4000-8000-000000000003'', ''30000000-0000-4000-8000-000000000004'', ''upload'')',
  'P0001',
  'Not authorized to queue document processing for this project.',
  'non-member finalize is rejected'
);
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ---------------------------------------------------------------------------
-- Atomic archive-member intake: create_document_with_job pair + concurrency
-- ---------------------------------------------------------------------------
select is(
  (select queued from public.create_document_with_job(
    '30000000-0000-4000-8000-000000000003', null, 'member-1', 'Zip member', 'member.pdf', 10,
    'application/pdf', '30000000-0000-4000-8000-000000000003/member-1.pdf', 'unknown', null, true, 'zip_import', '{}'::jsonb)),
  true, 'archive member intake queues the job'
);
select is(
  (select created from public.create_document_with_job(
    '30000000-0000-4000-8000-000000000003', null, 'member-1', 'Zip member', 'member.pdf', 10,
    'application/pdf', '30000000-0000-4000-8000-000000000003/member-1.pdf', 'unknown', null, true, 'zip_import', '{}'::jsonb)),
  false, 'repeated member intake returns the existing pair'
);
select is((select count(*) from public.documents where storage_path = '30000000-0000-4000-8000-000000000003/member-1.pdf'), 1::bigint, 'member intake never duplicates the document row');
-- Keep the claim order deterministic inside this transaction: the main fixture
-- job is always the oldest queued candidate.
update public.ai_jobs
set created_at = now() + interval '1 hour'
where document_id = (select id from public.documents where storage_path = '30000000-0000-4000-8000-000000000003/member-1.pdf');

-- ---------------------------------------------------------------------------
-- Fenced claim: token mint and stale-token fencing
-- ---------------------------------------------------------------------------
select is((select claim_token is not null from public.claim_next_available_document_job()), true, 'claim mints an attempt token');

update public.ai_jobs
set claim_token = 'bbbbbbbb-0000-4000-8000-0000000000aa'
where document_id = '30000000-0000-4000-8000-000000000004' and status = 'processing';

select throws_ok(
  format('select public.complete_document_job(''%s'', ''cccccccc-0000-4000-8000-0000000000ff'', ''{"facts":[]}''::jsonb)',
    (select id from public.ai_jobs where claim_token = 'bbbbbbbb-0000-4000-8000-0000000000aa')),
  'P0001',
  'Publication rejected: this attempt lost ownership of the job (stale claim token).',
  'publication with a foreign token is rejected'
);

-- ---------------------------------------------------------------------------
-- Expired lease is ownership lost: extension and completion are rejected
-- ---------------------------------------------------------------------------
update public.ai_jobs
set lease_expires_at = now() - interval '1 second'
where claim_token = 'bbbbbbbb-0000-4000-8000-0000000000aa';

select throws_ok(
  format('select public.extend_document_job_lease(''%s'', ''bbbbbbbb-0000-4000-8000-0000000000aa'', 15)',
    (select id from public.ai_jobs where claim_token = 'bbbbbbbb-0000-4000-8000-0000000000aa')),
  'P0001',
  'Lease extension rejected: this attempt does not own the job or its lease expired.',
  'expired lease cannot be extended'
);
select throws_ok(
  format('select public.complete_document_job(''%s'', ''bbbbbbbb-0000-4000-8000-0000000000aa'', ''{"facts":[]}''::jsonb)',
    (select id from public.ai_jobs where claim_token = 'bbbbbbbb-0000-4000-8000-0000000000aa')),
  'P0001',
  'Publication rejected: the attempt lease has expired; ownership was revoked.',
  'expired lease cannot publish'
);
select is(
  (select public.fail_document_job_attempt(
    (select id from public.ai_jobs where claim_token = 'bbbbbbbb-0000-4000-8000-0000000000aa'),
    '30000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000004',
    'bbbbbbbb-0000-4000-8000-0000000000aa', 'worker_failed', 'too late')),
  false, 'expired lease cannot record failure'
);
select is((select status::text from public.ai_jobs where claim_token = 'bbbbbbbb-0000-4000-8000-0000000000aa'), 'processing', 'expired attempt did not change durable state');

-- Recovery requeues the expired attempt (fresh lease, attempt 2, new token).
select is((select attempt_count from public.claim_next_available_document_job()), 2, 'recovery re-claims the expired attempt');
select is((select status::text from public.ai_jobs where document_id = '30000000-0000-4000-8000-000000000004'), 'processing', 'recovered job is processing again');

-- ---------------------------------------------------------------------------
-- Fenced publication: one consistent version, idempotent replay, retry replace
-- ---------------------------------------------------------------------------
update public.ai_jobs
set claim_token = 'bbbbbbbb-0000-4000-8000-0000000000bb'
where document_id = '30000000-0000-4000-8000-000000000004' and status = 'processing';

insert into public.document_chunks (project_id, document_id, chunk_index, chunk_text)
values ('30000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000004', 0, 'Progress is on track at 8 percent for the fencing fixture.');

select is(
  ((public.complete_document_job(
    (select id from public.ai_jobs where claim_token = 'bbbbbbbb-0000-4000-8000-0000000000bb'),
    'bbbbbbbb-0000-4000-8000-0000000000bb',
    jsonb_build_object(
      'facts', jsonb_build_array(jsonb_build_object(
        'fact_type', 'milestone', 'extracted_text', 'Foundation complete',
        'confidence', 0.9, 'evidence_chunk_index', 0)),
      'summary', jsonb_build_object('summary_text', 'Fixture summary', 'confidence', 0.8),
      'summary_sources', jsonb_build_array(jsonb_build_object('chunk_index', 0, 'excerpt', 'Progress is on track', 'confidence', 0.8)),
      'alerts', jsonb_build_array(jsonb_build_object('severity', 'low', 'explanation', 'No blockers found')),
      'actions', jsonb_build_array(jsonb_build_object('title', 'Track the next milestone')),
      'anomalies', jsonb_build_array(jsonb_build_object(
        'category', 'schedule', 'severity', 'low', 'title', 'No blockers logged',
        'explanation', 'No schedule blockers found in evidence.', 'absence_type', 'not_found_in_evidence')),
      'health_snapshots', jsonb_build_array(jsonb_build_object('dimension', 'schedule', 'status', 'green', 'score', 80, 'status_text', 'On track'))
    )))->>'status'), 'completed', 'owned publication completes'
);
select is((select count(*) from public.extracted_facts), 1::bigint, 'publication wrote exactly one fact');
select is((select count(*) from public.document_summaries), 1::bigint, 'publication wrote exactly one summary');
select is((select count(*) from public.dashboard_critical_alerts), 1::bigint, 'publication wrote exactly one alert');
select is((select count(*) from public.recommended_actions), 1::bigint, 'publication wrote exactly one action');
select is((select count(*) from public.anomalies), 1::bigint, 'publication wrote exactly one anomaly');
select ok((select source_path like '%job=%' from public.dashboard_critical_alerts limit 1), 'generated output carries the job marker in source_path');
select is((select processing_status::text from public.documents where id = '30000000-0000-4000-8000-000000000004'), 'completed', 'publication completes the document');

select is(
  ((public.complete_document_job(
    (select id from public.ai_jobs where claim_token = 'bbbbbbbb-0000-4000-8000-0000000000bb'),
    'bbbbbbbb-0000-4000-8000-0000000000bb',
    '{"facts":[],"summary":null}'::jsonb))->>'status'),
  'already_completed', 'repeated completion is idempotent'
);
select is((select count(*) from public.extracted_facts), 1::bigint, 'repeated completion writes no duplicate fact');

-- Manual retry discards published outputs and revokes tokens atomically.
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.retry_document_job('30000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000004');
select is((select count(*) from public.extracted_facts), 0::bigint, 'manual retry discards published facts');
select is((select count(*) from public.dashboard_critical_alerts), 0::bigint, 'manual retry discards published alerts');
select is((select count(*) from public.anomalies), 0::bigint, 'manual retry discards published anomalies');
select is((select count(*) from public.extraction_runs), 0::bigint, 'manual retry discards the previous extraction run');
select is((select count(*) from public.document_chunks), 1::bigint, 'worker-owned chunks survive retry cleanup');
select set_config('request.jwt.claims', '', true);

select is((select count(*) from public.ai_jobs where claim_token = 'bbbbbbbb-0000-4000-8000-0000000000bb' and status in ('queued','processing')), 0::bigint, 'retry revokes the replaced attempt token');

select * from finish();
rollback;
