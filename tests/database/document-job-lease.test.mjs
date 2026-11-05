// Opt-in, disposable PostgreSQL test for ticket 07 lease recovery semantics.
// Never connects to an app DB: it creates its own database, applies the
// migrations, and drops it afterwards.
//   XASS_INTEGRITY_PG_PORT=<port> XASS_TEST_PSQL=psql node --test tests/database/document-job-lease.test.mjs
import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const port = process.env.XASS_INTEGRITY_PG_PORT;
const psql = process.env.XASS_TEST_PSQL ?? 'psql';
const database = `xass_lease_${randomUUID().replaceAll('-', '')}`;
const args = db => ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-d', db];
function sql(text, db = database) {
  const result = spawnSync(psql, args(db), { input: text, encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr);
  return result.stdout.trim();
}
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const user = id(1), org = id(9), project = id(3), document = id(7), job = id(10);
const call = text => sql(`set role service_role; ${text}`);

before(() => {
  if (!port) return;
  assert.match(port, /^\d{4,5}$/);
  sql(`do $$begin
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
    if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
    end$$;`, 'postgres');
  sql(`create database ${database};`, 'postgres');
  sql(`create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table storage.buckets(id text primary key,name text,public boolean);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,
      metadata jsonb,version text,created_at timestamptz default now(),updated_at timestamptz default now());
    create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
    grant usage on schema auth,storage to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
  const migrations = readdirSync('supabase/migrations').filter(name => name.endsWith('.sql') && !name.includes('project_access_seed')).sort();
  for (const name of migrations) sql(readFileSync(join('supabase/migrations', name), 'utf8'));
  sql(`insert into auth.users values('${user}');
    insert into public.profiles(id) values('${user}');
    insert into public.organizations(id,name) values('${org}','Test');
    insert into public.projects(id,organization_id,name) values('${project}','${org}','Test');
    insert into public.project_members(project_id,user_id,role) values('${project}','${user}','admin');
    insert into public.documents(id,project_id,uploader_id,document_type,title,file_name,file_size,mime_type,storage_path,processing_status)
      values('${document}','${project}','${user}','progress_report','Lease fixture','lease.pdf',10,'application/pdf','${document}/lease.pdf','queued');
    insert into public.ai_jobs(id,project_id,document_id,job_type,status)
      values('${job}','${project}','${document}','parse_document','queued');`);
});

after(() => {
  if (port) sql(`drop database ${database} with (force);`, 'postgres');
});

test('fenced claim, lease expiry recovery, and stale-claim protection on a disposable database', { skip: !port }, async t => {
  await t.test('claim mints a token and a 15-minute lease; document moves to processing', () => {
    const claimed = JSON.parse(call(`select row_to_json(r) from (select * from public.claim_document_job('${job}')) r;`));
    assert.equal(claimed.status, 'processing');
    assert.ok(claimed.claim_token, 'a claim token is minted');
    const minutes = sql(`select extract(epoch from (lease_expires_at - now()))/60 from public.ai_jobs where id='${job}';`);
    assert.ok(Number(minutes) > 14 && Number(minutes) <= 15, 'lease starts at 15 minutes');
    assert.equal(sql(`select processing_status from public.documents where id='${document}';`), 'processing');
    // Keep the token for later subtests via the database itself.
    sql(`create table if not exists public.__lease_test_state(token uuid);
      truncate public.__lease_test_state;
      insert into public.__lease_test_state select claim_token from public.ai_jobs where id='${job}';
      grant usage on schema public to service_role; grant select on public.__lease_test_state to service_role;`);
  });

  await t.test('a valid owner can renew the lease and checkpoint within it', () => {
    const renewed = call(`select public.extend_document_job_lease('${job}', (select token from public.__lease_test_state), 15);`);
    assert.ok(renewed, 'the current owner renews successfully');
    // A durable write inside the lease succeeds and extends the lease atomically.
    call(`select public.save_extraction_group('${job}', (select token from public.__lease_test_state),
      '{"group_key":"' || repeat('b',64) || '","content_hash":"' || repeat('a',64) || '","parser_version":"test/1","schema_version":"test/1",
        "group_index":0,"chunk_start_index":0,"chunk_end_index":0,"status":"completed","result":{},"attempt_count":1}'::jsonb);`);
    assert.equal(sql(`select count(*) from public.document_extraction_groups where document_id='${document}';`), '1');
  });

  await t.test('an expired lease loses ownership: renewal, retry, and completion are rejected', () => {
    // Simulated clock: age the lease past expiry without touching claim state.
    sql(`update public.ai_jobs set lease_expires_at = now() - interval '1 second' where id='${job}';`);
    assert.throws(
      () => call(`select public.extend_document_job_lease('${job}', (select token from public.__lease_test_state), 15);`),
      /Lease extension rejected/,
    );
    assert.equal(
      call(`select coalesce(public.retry_document_job_attempt('${job}','${project}','${document}',(select token from public.__lease_test_state),'llm_provider_transient_failure','HTTP 429'),'null');`),
      'null',
      'a stale attempt cannot requeue the job over a newer claim',
    );
    assert.throws(
      () => call(`select public.complete_document_job('${job}', (select token from public.__lease_test_state),
        '{"processing_status":"completed","facts":[]}'::jsonb);`),
      /lease has expired/,
      'a stale attempt cannot publish',
    );
    assert.equal(sql(`select status from public.ai_jobs where id='${job}';`), 'processing',
      'rejections leave the job untouched for recovery');
  });

  await t.test('lease recovery requeues the deferred job and preserves checkpoints for reuse', () => {
    const recoveryRows = JSON.parse(
      sql(`select coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb) from (select * from public.claim_next_available_document_job()) r;`),
    );
    assert.equal(recoveryRows.length, 1, 'recovery claims the stale job');
    const recovered = recoveryRows[0];
    assert.equal(recovered.error_code, 'worker_lease_expired');
    assert.notEqual(recovered.claim_token, sql(`select token from public.__lease_test_state;`),
      'the recovered attempt receives a fresh token');
    assert.equal(sql(`select processing_status from public.documents where id='${document}';`), 'processing');
    // Checkpoints are worker-owned and survive recovery for reuse.
    assert.equal(sql(`select count(*) from public.document_extraction_groups where document_id='${document}';`), '1');
    assert.equal(sql(`select status from public.document_extraction_groups where document_id='${document}';`), 'completed');
  });

  await t.test('a 429-deferred retry never reports absent evidence and caps backoff', () => {
    // The recovered attempt now owns the job; its token is the current one.
    sql(`truncate public.__lease_test_state; insert into public.__lease_test_state select claim_token from public.ai_jobs where id='${job}';`);
    const current = sql(`select token from public.__lease_test_state;`);
    assert.notEqual(current, token, 'recovery minted a fresh claim token');
    // Simulate the provider 429 deferral: the worker requeues with backoff.
    const outcome = call(`select public.retry_document_job_attempt('${job}','${project}','${document}','${current}','llm_provider_transient_failure','The configured AI provider returned HTTP 429.');`);
    assert.equal(outcome, 'queued', 'a 429 deferral requeues instead of failing');
    assert.equal(sql(`select error_code from public.ai_jobs where id='${job}';`), 'llm_provider_transient_failure');
    assert.equal(sql(`select processing_status from public.documents where id='${document}';`), 'queued');
    const backoffSeconds = Number(sql(`select extract(epoch from (available_at - now())) from public.ai_jobs where id='${job}';`));
    assert.ok(backoffSeconds >= 0 && backoffSeconds <= 300, 'backoff is bounded (≤300s), preventing quota-eating loops');
    // Coverage semantics: nothing has been reported absent; the extraction group
    // checkpoint remains reusable for the next attempt.
    assert.equal(sql(`select status from public.document_extraction_groups where document_id='${document}';`), 'completed');
  });

  await t.test('the retry limit terminates the loop instead of consuming quota forever', () => {
    const claim1 = JSON.parse(call(`select row_to_json(r) from (select * from public.claim_document_job('${job}')) r;`));
    sql(`update public.ai_jobs set attempt_count = max_attempts where id='${job}';`);
    const outcome = call(`select public.retry_document_job_attempt('${job}','${project}','${document}','${claim1.claim_token}','llm_provider_transient_failure','HTTP 429 again');`);
    assert.equal(outcome, 'failed', 'exhausted attempts fail terminally instead of retrying');
    assert.equal(sql(`select error_code from public.ai_jobs where id='${job}';`), 'retry_limit_exceeded');
    assert.equal(sql(`select processing_status from public.documents where id='${document}';`), 'failed');
  });

  await t.test('a stale claimant cannot overwrite the new attempt after manual retry', () => {
    // Queue a fresh job and claim it; the old token must be worthless.
    sql(`set role authenticated; set request.jwt.claim.sub='${user}';`);
    const newJobRow = JSON.parse(call(`select row_to_json(r) from (select public.retry_document_job('${project}','${document}') as job_id) r;`));
    sql(`set role service_role;`);
    const newJob = newJobRow.job_id;
    const claimed = JSON.parse(call(`select row_to_json(r) from (select * from public.claim_document_job('${newJob}')) r;`));
    assert.ok(claimed.claim_token, 'the new attempt receives a fresh claim token');
    assert.throws(
      () => call(`select public.complete_document_job('${newJob}', (select token from public.__lease_test_state),
        '{"processing_status":"completed","facts":[]}'::jsonb);`),
      /stale claim token/,
      'the superseded token cannot publish over the new attempt',
    );
    assert.equal(sql(`select status from public.ai_jobs where id='${newJob}';`), 'processing',
      'the new attempt keeps ownership and its lease');
  });
});
