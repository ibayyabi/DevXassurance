// Opt-in, disposable PostgreSQL integration tests for report snapshot pinning.
// Never connects to an app DB.
// XASS_INTEGRITY_PG_PORT=55439 node --test tests/database/report-snapshot-pinning.test.mjs
import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { spawnSync } from 'node:child_process';
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
const previewPayload = (attempt, extra = {}) => ({
  reporting_period: 'October 2026', audience: 'PMO', detail_level: 'Standard',
  sections: { project_health: 'Budget - On Track', key_findings: 'Source-backed result' },
  counts: { snapshot_documents: 2, evidence_gaps: 0 },
  provenance: [{ label: 'Assessment snapshot', source: `assurance_reviews:${review}#${attempt}` }],
  snapshot_id: attempt, snapshot_cutoff: '2026-10-16', snapshot_version: attempt,
  snapshot_manifest: { snapshotId: attempt, snapshotCutoff: '2026-10-16', snapshotVersion: attempt, evidenceCount: 2, gaps: [] },
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
    insert into public.documents(id,project_id,uploader_id,document_type,title,file_name,file_size,mime_type,storage_path,processing_status)
      select x,'${project}','${user}','progress_report','Evidence','evidence.pdf',10,'application/pdf',x::text,'completed'
      from unnest(array['${base}','${current}','${alternate}']::uuid[]) x;
    insert into public.documents(id,project_id,uploader_id,document_type,title,file_name,file_size,mime_type,storage_path,processing_status)
      values('${otherDoc}','${otherProject}','${user}','progress_report','Other','other.pdf',10,'application/pdf','other','completed');
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
      previewPayload(pinnedAttempt, { snapshot_id: null, snapshot_version: null, snapshot_cutoff: null })),
      /published assessment snapshot is required/);
    assert.throws(() => reportFor(review, 'create', null, pinnedAttempt,
      previewPayload(pinnedAttempt, { snapshot_version: id(99) })),
      /not the published analysis/);
    preview = JSON.parse(reportFor(review, 'create', null, pinnedAttempt, previewPayload(pinnedAttempt))).id;
    const row = JSON.parse(previewRow(preview));
    assert.equal(row.snapshot_id, pinnedAttempt);
    assert.equal(row.snapshot_version, pinnedAttempt);
    assert.equal(row.snapshot_cutoff, '2026-10-16');
    assert.deepEqual(row.snapshot_manifest.gaps, []);
    assert.equal(row.assurance_review_id, review);
  });

  await t.test('a newer analysis leaves the pinned draft text untouched', () => {
    const before = previewRow(preview);
    assert.equal(save(base, alternate), 't');
    const next = publish();
    assert.notEqual(next, pinnedAttempt);
    assert.equal(published(), next);
    assert.equal(previewRow(preview), before, 'pinned sections, manifest and version must not change');
    const reread = JSON.parse(sql(`${auth(reviewer)} select jsonb_build_object('sections',p.original_sections,
      'manifest',p.snapshot_manifest,'version',p.snapshot_version) from public.report_previews p where id='${preview}';`));
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
});
