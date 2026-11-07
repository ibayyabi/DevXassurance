// Opt-in, disposable PostgreSQL integration tests for report snapshot pinning.
// Never connects to an app DB.
// XASS_INTEGRITY_PG_PORT=55439 node --test tests/database/report-snapshot-pinning.test.mjs
import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { spawnSync, spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const port = process.env.XASS_INTEGRITY_PG_PORT;
const psql = process.env.XASS_TEST_PSQL ?? 'C:/Program Files/PostgreSQL/17/bin/psql.exe';
const database = `xass_report_pin_${randomUUID().replaceAll('-', '')}`;
const args = db => ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-d', db];
function sql(text, db = database) {
  const result = spawnSync(psql, args(db), { input: text, encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr);
  return result.stdout.trim();
}
function asyncSql(text) {
  return new Promise((resolve, reject) => {
    const child = spawn(psql, args(database), { windowsHide: true });
    let output = '', error = '';
    child.stdout.on('data', value => output += value);
    child.stderr.on('data', value => error += value);
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(output.trim()) : reject(new Error(error)));
    child.stdin.end(text);
  });
}
const id = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const user = id(1), reviewer = id(2), project = id(3), otherProject = id(4);
const review = id(5), otherReview = id(10);
const base = id(6), current = id(7), alternate = id(8), otherDoc = id(11);
const auth = who => `set role authenticated; set request.jwt.claim.sub='${who}';`;
const call = text => sql(`${auth(user)} ${text}`);
const quoted = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

const findings = ['budget', 'schedule', 'risk'].map(domain => ({
  domain, condition: 'on_track', severity: 'information',
  headline: 'Source-backed result', explanation: 'Verified evidence',
  baselineValue: {}, currentValue: {}, variance: {}, requiredEvidence: [],
  sourceExcerpts: [], confidence: 0.9,
}));
const save = (b = base, c = current) =>
  call(`select public.save_assurance_evidence('${project}','${review}',array['${b}']::uuid[],array['${c}']::uuid[]);`);
const claim = () => JSON.parse(call(`select public.claim_assurance_analysis('${project}','${review}');`));
const finish = (attempt, data = findings) =>
  call(`select public.finish_assurance_analysis('${project}','${review}','${attempt}',${quoted(data)},'[]'::jsonb);`);
const fresh = () => sql(`select public.assurance_analysis_is_current('${project}','${review}');`);
const published = () => sql(`select analysis_metadata->'last_success'->>'id' from public.assurance_reviews where id='${review}'`);
function publish() { const attempt = claim().attempt_id; assert.equal(finish(attempt), 't'); return attempt; }
const reportFor = (reviewId, op, previewId = null, attemptId = null, payload = {}) =>
  call(`select public.assurance_report_operation('${project}','${reviewId}','${op}',` +
    `${previewId ? `'${previewId}'` : 'null'},${attemptId ? `'${attemptId}'` : 'null'},${quoted(payload)});`);

// Counts the database derives for this fixture: 2 bound documents, three
// on-track findings, no gaps, no actions.
const derivedCounts = {
  snapshot_documents: 2, assessed_domains: 3, evidence_gaps: 0,
  critical_conditions: 0, actions: 0, confirmed_findings: 0,
};
const previewPayload = (attempt, extra = {}) => ({
  audience: 'PMO', detail_level: 'Standard',
  sections: { project_health: 'Budget - On Track', key_findings: 'Source-backed result' },
  counts: derivedCounts,
  snapshot_id: attempt, snapshot_cutoff: '2026-10-16', snapshot_version: attempt,
  ...extra,
});
const previewRow = previewId =>
  sql(`select to_jsonb(p) from public.report_previews p where id='${previewId}';`);

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
  const migrations = readdirSync('supabase/migrations')
    .filter(name => name.endsWith('.sql') && !name.includes('project_access_seed')).sort();
  for (const name of migrations) sql(readFileSync(join('supabase/migrations', name), 'utf8'));
  sql(`insert into auth.users values('${user}'),('${reviewer}');
    insert into public.profiles(id) values('${user}'),('${reviewer}');
    insert into public.organizations(id,name) values('${id(9)}','Test');
    insert into public.projects(id,organization_id,name) values('${project}','${id(9)}','Test'),('${otherProject}','${id(9)}','Other');
    insert into public.project_members(project_id,user_id,role) values
      ('${project}','${user}','admin'),('${otherProject}','${user}','admin'),('${project}','${reviewer}','pmo_reviewer');
    insert into public.assurance_reviews(id,project_id,reporting_period,title,created_by)
      values('${review}','${project}','2026-10-16','October','${user}'),
            ('${otherReview}','${otherProject}','2026-10-16','Other','${user}');
    insert into public.documents(id,project_id,uploader_id,document_type,title,file_name,file_size,mime_type,storage_path,processing_status,content_hash)
      select x,'${project}','${user}','progress_report','Evidence','evidence.pdf',10,'application/pdf',x::text,'completed',repeat('a',64)
      from unnest(array['${base}','${current}','${alternate}']::uuid[]) x;
    insert into public.documents(id,project_id,uploader_id,document_type,title,file_name,file_size,mime_type,storage_path,processing_status,content_hash)
      values('${otherDoc}','${otherProject}','${user}','progress_report','Other','other.pdf',10,'application/pdf','other','completed',repeat('b',64));
    insert into public.document_chunks(project_id,document_id,chunk_index,chunk_text)
      select '${project}',id,0,'Source text '||id from public.documents where project_id='${project}';
    insert into storage.objects(bucket_id,name,metadata)
      select storage_bucket,storage_path,'{"eTag":"original"}' from public.documents where project_id='${project}';
    grant usage on schema public to authenticated,anon;
    grant select on all tables in schema public to authenticated;
    grant select on storage.objects to authenticated;`);
});
after(() => {
  if (port) sql(`drop database ${database} with (force);`, 'postgres');
});

test('report drafts pin a published snapshot on a disposable database', { skip: !port }, async t => {
  let pinnedAttempt;
  let preview;

  await t.test('creation requires the published snapshot identity', () => {
    assert.equal(save(), 't');
    pinnedAttempt = publish();
    assert.equal(fresh(), 't');
    assert.throws(() => reportFor(review, 'create', null, pinnedAttempt,
      previewPayload(pinnedAttempt, { snapshot_id: id(42) })),
      /not the published analysis/);
    assert.throws(() => reportFor(review, 'create', null, pinnedAttempt,
      previewPayload(pinnedAttempt, { snapshot_cutoff: '2026-01-01' })),
      /published cut-off/);
    assert.throws(() => reportFor(review, 'create', null, pinnedAttempt,
      previewPayload(pinnedAttempt, { counts: { snapshot_documents: 99 } })),
      /counts do not match/);
    preview = JSON.parse(reportFor(review, 'create', null, pinnedAttempt, previewPayload(pinnedAttempt))).id;
    const row = JSON.parse(previewRow(preview));
    assert.equal(row.snapshot_id, pinnedAttempt);
    assert.equal(row.snapshot_version, pinnedAttempt);
    assert.equal(row.snapshot_cutoff, '2026-10-16');
    assert.equal(row.assurance_review_id, review);
    assert.deepEqual(row.included_evidence_counts, derivedCounts);
  });

  await t.test('the stored snapshot is derived server-side, never from the payload', () => {
    const forged = previewPayload(pinnedAttempt, {
      snapshot_manifest: { snapshotId: 'forged', snapshotCutoff: '1999-01-01', gaps: [{ domain: 'risk', reason: 'forged' }] },
      provenance: [{ label: 'Forged', source: 'nowhere' }],
    });
    const derived = JSON.parse(reportFor(review, 'create', null, pinnedAttempt, forged)).id;
    const row = JSON.parse(previewRow(derived));
    const manifest = row.snapshot_manifest;
    assert.equal(row.snapshot_id, pinnedAttempt, 'the payload cannot choose the snapshot id');
    assert.equal(manifest.snapshotId, pinnedAttempt);
    assert.equal(manifest.snapshotVersion, pinnedAttempt);
    assert.equal(manifest.snapshotCutoff, '2026-10-16');
    assert.equal(manifest.reviewId, review);
    assert.equal(manifest.cutoffLabel, 'October 2026');
    assert.equal(manifest.evidenceCount, 2);
    assert.equal(manifest.values.length, 3);
    assert.deepEqual(manifest.gaps, [], 'the payload cannot inject a gap');
    assert.deepEqual(manifest.values.map(value => value.domain), ['budget', 'risk', 'schedule']);
    // Sources are concrete bound documents with their source version, not names
    // of tables, and never the caller's list.
    const sources = manifest.sources;
    assert.equal(sources[0].label, 'Assessment snapshot');
    assert.equal(sources[0].source, `assurance_reviews:${review}#${pinnedAttempt}`);
    const documents = sources.filter(source => source.documentId);
    assert.equal(documents.length, 2);
    assert.deepEqual(documents.map(document => document.evidenceRole).sort(), ['baseline', 'current']);
    assert.ok(documents.every(document => document.documentName === 'evidence.pdf'));
    assert.ok(documents.every(document => document.contentHash === 'a'.repeat(64)));
    assert.ok(!row.provenance.some(item => item.label === 'Forged'));
    assert.ok(row.provenance.some(item => item.label === 'Analysis attempt' && item.source === pinnedAttempt));
    assert.equal(sources.some(source => source.documentId === otherDoc), false, 'another project never leaks in');
  });

  await t.test('a newer analysis leaves the pinned draft text untouched', () => {
    const target = preview;
    const before = previewRow(target);
    assert.equal(save(base, alternate), 't');
    const next = publish();
    assert.notEqual(next, pinnedAttempt);
    assert.equal(published(), next);
    assert.equal(previewRow(target), before, 'pinned sections, manifest and version must not change');
    const reread = JSON.parse(sql(`${auth(reviewer)} select jsonb_build_object('sections',p.original_sections,
      'manifest',p.snapshot_manifest,'version',p.snapshot_version) from public.report_previews p where id='${target}';`));
    assert.equal(reread.version, pinnedAttempt);
    assert.equal(reread.sections.project_health, 'Budget - On Track');
    assert.equal(reread.manifest.snapshotVersion, pinnedAttempt);
    pinnedAttempt = next;
  });

  await t.test('a superseded draft stays readable but cannot be re-approved', () => {
    assert.throws(() => reportFor(review, 'create', null, id(7), previewPayload(id(7))),
      /analysis has changed/);
    assert.throws(() => reportFor(review, 'approve', preview), /not associated/);
    const freshPreview = JSON.parse(reportFor(review, 'create', null, pinnedAttempt, previewPayload(pinnedAttempt))).id;
    reportFor(review, 'approve', freshPreview);
    assert.equal(sql(`select review_state from public.report_previews where id='${freshPreview}'`), 'reviewed');
    assert.equal(sql(`select snapshot_version from public.report_previews where id='${freshPreview}'`), pinnedAttempt);
  });

  await t.test('cross-project and unauthorized roles cannot pin or read reports', () => {
    assert.throws(() => reportFor(otherReview, 'create', null, pinnedAttempt, previewPayload(pinnedAttempt)),
      /not found/);
    for (const role of ['pmo_reviewer', 'sponsor', 'steering_committee']) {
      sql(`update public.project_members set role='${role}' where user_id='${reviewer}' and project_id='${project}'`);
      assert.throws(() => sql(`${auth(reviewer)} select public.assurance_report_operation('${project}','${review}','create',null,'${pinnedAttempt}',${quoted(previewPayload(pinnedAttempt))});`),
        /cannot manage an assurance review/);
    }
    assert.throws(
      () => sql(`set role anon; select public.assurance_report_operation('${project}','${review}','create',null,null,'{}'::jsonb);`),
      /permission denied/);
    sql(`update public.project_members set role='pmo_reviewer' where user_id='${reviewer}' and project_id='${project}'`);
  });

  await t.test('a concurrent source change cannot be published into a draft', async () => {
    assert.equal(save(base, current), 't');
    pinnedAttempt = publish();
    const previews = sql(`select count(*) from public.report_previews where project_id='${project}'`);
    // The holder keeps the review row lock while it changes the source, so a
    // concurrent create must wait for the lock and then find the analysis stale.
    const holder = asyncSql(`begin; select 1 from public.assurance_reviews where id='${review}' for update;
      select pg_sleep(2); update public.document_chunks set chunk_text=chunk_text||' concurrent'
        where document_id='${current}'; commit;`);
    for (let i = 0; i < 100; i++) {
      await new Promise(resolve => setTimeout(resolve, 20));
      if (sql(`select count(*) from pg_stat_activity where datname='${database}' and wait_event='PgSleep'`) !== '0') break;
      if (i === 99) throw new Error('Lock holder did not reach the controlled barrier');
    }
    const blocked = asyncSql(`${auth(user)} select public.assurance_report_operation('${project}','${review}','create',null,'${pinnedAttempt}',${quoted(previewPayload(pinnedAttempt))});`);
    const outcomes = await Promise.allSettled([holder, blocked]);
    assert.equal(outcomes[0].status, 'fulfilled', 'the source change commits');
    assert.equal(outcomes[1].status, 'rejected', 'the draft is never pinned to a changed source');
    assert.match(outcomes[1].reason.message, /successful analysis/);
    assert.equal(fresh(), 'f');
    assert.equal(sql(`select count(*) from public.report_previews where project_id='${project}'`), previews);
  });
});
