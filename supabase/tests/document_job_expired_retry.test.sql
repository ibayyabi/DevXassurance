-- Atomic explicit recovery for an expired document-job lease.
-- Runs inside one transaction that always rolls back. Requires pgTAP.
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/document_job_expired_retry.test.sql
begin;
select plan(22);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, created_at, updated_at)
values
  ('50000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'expired-retry-manager@example.invalid', '', now(), '{}'::jsonb, now(), now()),
  ('50000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'expired-retry-sponsor@example.invalid', '', now(), '{}'::jsonb, now(), now())
on conflict (id) do nothing;
insert into public.profiles (id, full_name)
values
  ('50000000-0000-4000-8000-000000000001', 'Expired retry manager'),
  ('50000000-0000-4000-8000-000000000002', 'Expired retry sponsor')
on conflict (id) do nothing;
insert into public.organizations (id, name)
values ('50000000-0000-4000-8000-000000000003', 'Expired retry org')
on conflict (id) do nothing;
insert into public.projects (id, organization_id, name)
values ('50000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000003', 'Expired retry project')
on conflict (id) do nothing;
insert into public.project_members (project_id, user_id, role)
values
  ('50000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000001', 'project_manager'),
  ('50000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000002', 'sponsor');

insert into public.documents (id, project_id, uploader_id, document_type, title, file_name, file_size, mime_type, storage_path, processing_status)
values
  ('50000000-0000-4000-8000-000000000010', '50000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000001', 'progress_report', 'Expired retry', 'expired.pdf', 10, 'application/pdf', '50000000-0000-4000-8000-000000000004/expired.pdf', 'processing'),
  ('50000000-0000-4000-8000-000000000011', '50000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000001', 'progress_report', 'Reclaimed retry', 'reclaimed.pdf', 10, 'application/pdf', '50000000-0000-4000-8000-000000000004/reclaimed.pdf', 'processing'),
  ('50000000-0000-4000-8000-000000000012', '50000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000001', 'progress_report', 'Failed retry', 'failed.pdf', 10, 'application/pdf', '50000000-0000-4000-8000-000000000004/failed.pdf', 'failed'),
  ('50000000-0000-4000-8000-000000000013', '50000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000001', 'progress_report', 'Attempt limit', 'attempt-limit.pdf', 10, 'application/pdf', '50000000-0000-4000-8000-000000000004/attempt-limit.pdf', 'processing');

insert into public.ai_jobs (id, project_id, document_id, job_type, status, attempt_count, max_attempts, claim_token, claimed_at, lease_expires_at)
values
  ('50000000-0000-4000-8000-000000000020', '50000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000010', 'parse_document', 'processing', 1, 3, 'aaaaaaaa-0000-4000-8000-000000000001', now() - interval '16 minutes', '2000-01-01T00:00:00Z'),
  ('50000000-0000-4000-8000-000000000021', '50000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000011', 'parse_document', 'processing', 2, 3, 'bbbbbbbb-0000-4000-8000-000000000002', now(), '2999-01-01T00:00:00Z'),
  ('50000000-0000-4000-8000-000000000022', '50000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000012', 'parse_document', 'failed', 3, 3, null, null, null),
  ('50000000-0000-4000-8000-000000000023', '50000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000013', 'parse_document', 'processing', 3, 3, 'cccccccc-0000-4000-8000-000000000003', now() - interval '16 minutes', '2000-01-01T00:00:00Z');

insert into public.extraction_runs (id, project_id, document_id, ai_job_id, status)
values ('50000000-0000-4000-8000-000000000030', '50000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000010', '50000000-0000-4000-8000-000000000020', 'completed');
insert into public.extracted_facts (id, project_id, extraction_run_id, fact_type, extracted_text, original_value, confidence)
values ('50000000-0000-4000-8000-000000000031', '50000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000030', 'risk', 'Preserved prior result', 'Preserved prior result', 0.9);
insert into public.document_summaries (id, project_id, summary_text, confidence, selected_document_ids, metadata)
values ('50000000-0000-4000-8000-000000000032', '50000000-0000-4000-8000-000000000004', 'Preserved summary', 0.9, array['50000000-0000-4000-8000-000000000010'::uuid], jsonb_build_object('job_id', '50000000-0000-4000-8000-000000000020'));

select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  public.retry_expired_document_job(
    '50000000-0000-4000-8000-000000000004',
    '50000000-0000-4000-8000-000000000010',
    '50000000-0000-4000-8000-000000000020',
    'aaaaaaaa-0000-4000-8000-000000000001',
    '2000-01-01T00:00:00Z'
  ),
  'queued'::public.document_processing_status,
  'expired lease requeues the same attempt'
);
select is((select status::text from public.ai_jobs where id = '50000000-0000-4000-8000-000000000020'), 'queued', 'requeued job remains the same row');
select ok((select claim_token is null and lease_expires_at is null and claimed_at is null from public.ai_jobs where id = '50000000-0000-4000-8000-000000000020'), 'requeue clears only the expired claim');
select is((select processing_status::text from public.documents where id = '50000000-0000-4000-8000-000000000010'), 'queued', 'document and job statuses change atomically');
select is((select count(*) from public.extraction_runs where ai_job_id = '50000000-0000-4000-8000-000000000020'), 1::bigint, 'requeue preserves prior extraction run');
select is((select count(*) from public.extracted_facts where id = '50000000-0000-4000-8000-000000000031'), 1::bigint, 'requeue preserves prior fact');
select is((select count(*) from public.document_summaries where id = '50000000-0000-4000-8000-000000000032'), 1::bigint, 'requeue preserves prior summary');

select throws_ok(
  $$select public.retry_expired_document_job('50000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000011', '50000000-0000-4000-8000-000000000021', 'bbbbbbbb-0000-4000-8000-000000000002', '2000-01-01T00:00:00Z')$$,
  'P0001',
  'Expired lease retry rejected: the expected attempt is no longer current.',
  'a renewed lease rejects the stale expiry supplied by the caller'
);
select throws_ok(
  $$select public.retry_expired_document_job('50000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000011', '50000000-0000-4000-8000-000000000021', 'aaaaaaaa-0000-4000-8000-000000000001', '2000-01-01T00:00:00Z')$$,
  'P0001',
  'Expired lease retry rejected: the expected attempt is no longer current.',
  'a reclaimed job rejects its previous owner token'
);
select is((select status::text from public.ai_jobs where id = '50000000-0000-4000-8000-000000000021'), 'processing', 'the new owner remains processing');
select is((select claim_token::text from public.ai_jobs where id = '50000000-0000-4000-8000-000000000021'), 'bbbbbbbb-0000-4000-8000-000000000002', 'the new owner token is not revoked');
select ok((select lease_expires_at > clock_timestamp() from public.ai_jobs where id = '50000000-0000-4000-8000-000000000021'), 'the new owner lease is not overwritten');
select is((select processing_status::text from public.documents where id = '50000000-0000-4000-8000-000000000011'), 'processing', 'the new owner document is not requeued');

select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$select public.retry_expired_document_job('50000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000011', '50000000-0000-4000-8000-000000000021', 'bbbbbbbb-0000-4000-8000-000000000002', '2999-01-01T00:00:00Z')$$,
  'P0001',
  'Not authorized to retry document processing.',
  'a project sponsor cannot requeue a job'
);
select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$select public.retry_document_job('50000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000011')$$,
  'P0001',
  'A queued or processing document cannot be replaced by a manual retry.',
  'the legacy retry RPC cannot supersede an active attempt'
);
select is((select claim_token::text from public.ai_jobs where id = '50000000-0000-4000-8000-000000000021'), 'bbbbbbbb-0000-4000-8000-000000000002', 'legacy retry denial also preserves the active claim');

select is(
  public.retry_expired_document_job(
    '50000000-0000-4000-8000-000000000004',
    '50000000-0000-4000-8000-000000000013',
    '50000000-0000-4000-8000-000000000023',
    'cccccccc-0000-4000-8000-000000000003',
    '2000-01-01T00:00:00Z'
  ),
  'failed'::public.document_processing_status,
  'expired attempt at the configured limit becomes failed instead of bypassing the cap'
);
select is((select status::text from public.ai_jobs where id = '50000000-0000-4000-8000-000000000023'), 'failed', 'attempt-limited job is terminal');
select is((select processing_status::text from public.documents where id = '50000000-0000-4000-8000-000000000013'), 'failed', 'attempt-limited document is terminal');

select ok(
  public.retry_document_job('50000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000012') is not null,
  'existing failed-job retry remains available'
);
select is((select count(*) from public.ai_jobs where document_id = '50000000-0000-4000-8000-000000000012' and status = 'queued'), 1::bigint, 'failed retry queues one replacement job');
select is((select count(*) from public.ai_jobs where document_id = '50000000-0000-4000-8000-000000000012'), 2::bigint, 'failed retry keeps the existing terminal job as history');

select * from finish();
rollback;
