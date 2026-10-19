begin;
select plan(39);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'job-reliability-test@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now())
on conflict (id) do nothing;
insert into public.profiles (id, full_name)
values ('10000000-0000-4000-8000-000000000001', 'Job reliability test')
on conflict (id) do nothing;
insert into public.organizations (id, name)
values ('10000000-0000-4000-8000-000000000002', 'Job reliability test')
on conflict (id) do nothing;
insert into public.projects (id, organization_id, name)
values ('10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'Job reliability test')
on conflict (id) do nothing;
insert into public.documents (id, project_id, uploader_id, document_type, title, file_name, file_size, mime_type, storage_path, processing_status)
values ('10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'progress_report', 'Retry state', 'test.pdf', 1, 'application/pdf', 'job-reliability/retry.pdf', 'processing');
insert into public.ai_jobs (id, project_id, document_id, job_type, status, attempt_count, max_attempts, claimed_at, lease_expires_at)
values ('10000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004', 'parse_document', 'processing', 1, 3, now(), now() + interval '15 minutes');

select is(public.retry_document_job_attempt('10000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004', 'extraction_group_checkpoint_failed', 'Transient checkpoint write failed'), 'queued', 'first transient failure queues job atomically');
select is((select status::text from public.ai_jobs where id = '10000000-0000-4000-8000-000000000005'), 'queued', 'first retry changes job state');
select is((select processing_status::text from public.documents where id = '10000000-0000-4000-8000-000000000004'), 'queued', 'first retry synchronizes document state');
select ok((select lease_expires_at is null and claimed_at is null from public.ai_jobs where id = '10000000-0000-4000-8000-000000000005'), 'first retry clears claim lease');
select ok((select available_at between now() + interval '14 seconds' and now() + interval '16 seconds' from public.ai_jobs where id = '10000000-0000-4000-8000-000000000005'), 'first retry uses 15-second backoff');
select is((select count(*) from public.claim_next_available_document_job()), 0::bigint, 'retry backoff prevents early claim');
select is((select count(*) from public.recover_and_fetch_document_job()), 0::bigint, 'legacy poller respects retry backoff');

update public.ai_jobs set status = 'processing', attempt_count = 2, claimed_at = now(), lease_expires_at = now() + interval '15 minutes' where id = '10000000-0000-4000-8000-000000000005';
update public.documents set processing_status = 'processing' where id = '10000000-0000-4000-8000-000000000004';
select is(public.retry_document_job_attempt('10000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004', 'extraction_group_checkpoint_failed', 'Transient checkpoint write failed'), 'queued', 'second transient failure queues job');
select ok((select available_at between now() + interval '29 seconds' and now() + interval '31 seconds' from public.ai_jobs where id = '10000000-0000-4000-8000-000000000005'), 'second retry uses 30-second backoff');

update public.ai_jobs set status = 'processing', attempt_count = 3, claimed_at = now(), lease_expires_at = now() + interval '15 minutes' where id = '10000000-0000-4000-8000-000000000005';
update public.documents set processing_status = 'processing' where id = '10000000-0000-4000-8000-000000000004';
select is(public.retry_document_job_attempt('10000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004', 'extraction_group_checkpoint_failed', 'Transient checkpoint write failed'), 'failed', 'attempt limit terminally fails retry');
select is((select status::text from public.ai_jobs where id = '10000000-0000-4000-8000-000000000005'), 'failed', 'attempt limit fails job');
select is((select processing_status::text from public.documents where id = '10000000-0000-4000-8000-000000000004'), 'failed', 'attempt limit synchronizes document failure');
select ok((select lease_expires_at is null and claimed_at is null from public.ai_jobs where id = '10000000-0000-4000-8000-000000000005'), 'terminal retry clears claim lease');

insert into public.documents (id, project_id, uploader_id, document_type, title, file_name, file_size, mime_type, storage_path, processing_status)
values
  ('10000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'progress_report', 'Terminal failure', 'terminal.pdf', 1, 'application/pdf', 'job-reliability/terminal.pdf', 'processing'),
  ('10000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'progress_report', 'Already finalized', 'finalized.pdf', 1, 'application/pdf', 'job-reliability/finalized.pdf', 'needs_review');
insert into public.ai_jobs (id, project_id, document_id, job_type, status, attempt_count, max_attempts, claimed_at, lease_expires_at)
values
  ('10000000-0000-4000-8000-000000000014', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000012', 'parse_document', 'processing', 1, 3, now(), now() + interval '15 minutes'),
  ('10000000-0000-4000-8000-000000000015', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000013', 'parse_document', 'processing', 1, 3, now() - interval '16 minutes', now() - interval '1 second');
insert into public.extraction_runs (project_id, document_id, ai_job_id, status, metadata)
values ('10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000014', 'processing', '{"source":"n8n"}');

select ok(public.fail_document_job_attempt('10000000-0000-4000-8000-000000000014', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000012', 'worker_failed', 'Terminal worker failure'), 'terminal failure RPC commits atomically');
select is((select status::text from public.ai_jobs where id = '10000000-0000-4000-8000-000000000014'), 'failed', 'terminal RPC fails job');
select is((select processing_status::text from public.documents where id = '10000000-0000-4000-8000-000000000012'), 'failed', 'terminal RPC fails document');
select is((select status::text from public.extraction_runs where ai_job_id = '10000000-0000-4000-8000-000000000014'), 'failed', 'terminal RPC fails extraction run');
select ok((select metadata @> '{"source":"n8n","error_code":"worker_failed","error_message":"Terminal worker failure"}'::jsonb from public.extraction_runs where ai_job_id = '10000000-0000-4000-8000-000000000014'), 'terminal RPC preserves prior run metadata and adds failure details');
select ok((select lease_expires_at is null and claimed_at is null from public.ai_jobs where id = '10000000-0000-4000-8000-000000000014'), 'terminal RPC clears claim lease');

insert into public.documents (id, project_id, uploader_id, document_type, title, file_name, file_size, mime_type, storage_path, processing_status)
values
  ('10000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'progress_report', 'Cancelled', 'cancelled.pdf', 1, 'application/pdf', 'job-reliability/cancelled.pdf', 'processing'),
  ('10000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'progress_report', 'Completed', 'completed.pdf', 1, 'application/pdf', 'job-reliability/completed.pdf', 'completed'),
  ('10000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'progress_report', 'Expired', 'expired.pdf', 1, 'application/pdf', 'job-reliability/expired.pdf', 'processing');
insert into public.ai_jobs (id, project_id, document_id, job_type, status, attempt_count, max_attempts, claimed_at, lease_expires_at)
values
  ('10000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000006', 'parse_document', 'cancelled', 1, 3, null, null),
  ('10000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000007', 'parse_document', 'completed', 1, 3, null, null),
  ('10000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000008', 'parse_document', 'processing', 3, 3, now() - interval '16 minutes', now() - interval '1 second');
insert into public.documents (id, project_id, uploader_id, document_type, title, file_name, file_size, mime_type, storage_path, processing_status)
values ('10000000-0000-4000-8000-000000000016', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'progress_report', 'Failed document', 'failed.pdf', 1, 'application/pdf', 'job-reliability/failed.pdf', 'failed');
insert into public.ai_jobs (id, project_id, document_id, job_type, status, attempt_count, max_attempts, claimed_at, lease_expires_at)
values ('10000000-0000-4000-8000-000000000017', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000016', 'parse_document', 'processing', 1, 3, now() - interval '16 minutes', now() - interval '1 second');

select is(public.retry_document_job_attempt('10000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000006', 'retry', 'cancelled'), null::text, 'cancelled job is not retried');
select is((select status::text from public.ai_jobs where id = '10000000-0000-4000-8000-000000000009'), 'cancelled', 'cancelled job remains cancelled');
select is(public.retry_document_job_attempt('10000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000007', 'retry', 'completed'), null::text, 'completed job is not retried');
select is((select status::text from public.ai_jobs where id = '10000000-0000-4000-8000-000000000010'), 'completed', 'completed job remains completed');
select is((select count(*) from public.claim_next_available_document_job()), 0::bigint, 'expired exhausted lease is terminal before claim');
select is((select status::text from public.ai_jobs where id = '10000000-0000-4000-8000-000000000011'), 'failed', 'lease recovery fails exhausted job');
select ok((select lease_expires_at is null and claimed_at is null from public.ai_jobs where id = '10000000-0000-4000-8000-000000000011'), 'terminal lease recovery clears claim lease');
select is((select status::text from public.ai_jobs where id = '10000000-0000-4000-8000-000000000017'), 'failed', 'stale job for failed document is reconciled terminally');
select ok((select claimed_at is null and lease_expires_at is null from public.ai_jobs where id = '10000000-0000-4000-8000-000000000017'), 'failed-document recovery clears lease');
select is((select status::text from public.ai_jobs where id = '10000000-0000-4000-8000-000000000015'), 'completed', 'lease recovery reconciles finalized job without reprocessing');
select is((select processing_status::text from public.documents where id = '10000000-0000-4000-8000-000000000013'), 'needs_review', 'lease recovery preserves finalized document status');

insert into public.documents (id, project_id, uploader_id, document_type, title, file_name, file_size, mime_type, storage_path, processing_status)
select ('20000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'progress_report', 'Claim ' || n, 'claim.pdf', 1, 'application/pdf', 'job-reliability/claim-' || n || '.pdf', 'queued'
from generate_series(1, 3) n;
insert into public.ai_jobs (project_id, document_id, job_type, status)
select '10000000-0000-4000-8000-000000000003', id, 'parse_document', 'queued'
from public.documents where storage_path like 'job-reliability/claim-%';

select is((select status::text from public.recover_and_fetch_document_job()), 'queued', 'legacy workflow RPC still returns queued candidate');
select is((select count(*) from public.ai_jobs job join public.documents document on document.id = job.document_id where job.status = 'queued' and job.job_type = 'parse_document' and document.storage_path like 'job-reliability/claim-%'), 3::bigint, 'legacy candidate lookup leaves the queued jobs unchanged');
select is((select count(*) from public.claim_next_available_document_job()), 1::bigint, 'new claim RPC claims one job per poll');
select is((select count(*) from public.ai_jobs where status = 'processing' and job_type = 'parse_document'), 1::bigint, 'first claim occupies one active slot');
select is((select count(*) from public.documents where processing_status = 'processing' and storage_path like 'job-reliability/claim-%'), 1::bigint, 'claim atomically synchronizes document processing');
select is((select count(*) from public.claim_next_available_document_job()), 1::bigint, 'second poll claims one remaining active slot');
select is((select count(*) from public.ai_jobs where status = 'processing' and job_type = 'parse_document'), 2::bigint, 'active parse jobs reach but do not exceed cap');
select is((select count(*) from public.claim_next_available_document_job()), 0::bigint, 'claim RPC stops at two active jobs');
select is((select count(*) from public.ai_jobs where status = 'processing' and job_type = 'parse_document'), 2::bigint, 'active parse job count remains capped');

select * from finish();
rollback;
