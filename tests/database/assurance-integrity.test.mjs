// Opt-in, disposable PostgreSQL integration tests. Never connects to an app DB.
// XASS_INTEGRITY_PG_PORT=55439 node --test tests/database/assurance-integrity.test.mjs
import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { spawnSync, spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const port = process.env.XASS_INTEGRITY_PG_PORT;
const psql = process.env.XASS_TEST_PSQL ?? 'C:/Program Files/PostgreSQL/17/bin/psql.exe';
const database = `xass_integrity_${randomUUID().replaceAll('-', '')}`;
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
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const user = id(1), project = id(3), otherProject = id(4), review = id(5);
const base = id(6), current = id(7), alternate = id(8);
const auth = who => `set role authenticated; set request.jwt.claim.sub='${who}';`;
const call = text => sql(`${auth(user)} ${text}`);
const quoted = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const findings = ['budget','schedule','risk'].map(domain => ({ domain, condition: 'on_track', severity: 'information',
  headline: 'Source-backed result', explanation: 'Verified evidence', baselineValue: {}, currentValue: {}, variance: {},
  requiredEvidence: [], sourceExcerpts: [], confidence: 0.9 }));
const save = (b = base, c = current) => call(`select public.save_assurance_evidence('${project}','${review}',array['${b}']::uuid[],array['${c}']::uuid[]);`);
const claim = () => JSON.parse(call(`select public.claim_assurance_analysis('${project}','${review}');`));
const finish = (attempt, data = findings, actions = []) => call(`select public.finish_assurance_analysis('${project}','${review}','${attempt}',${quoted(data)},${quoted(actions)});`);
const fail = attempt => call(`select public.finish_assurance_analysis('${project}','${review}','${attempt}',p_error=>'Model failed');`);
const fresh = () => sql(`select public.assurance_analysis_is_current('${project}','${review}');`);
const report = (op, preview = null, attempt = null, payload = {}) => call(`select public.assurance_report_operation('${project}','${review}','${op}',${preview ? `'${preview}'` : 'null'},${attempt ? `'${attempt}'` : 'null'},${quoted(payload)});`);
function success() { const attempt = claim().attempt_id; assert.equal(finish(attempt), 't'); return attempt; }
function createReport(attempt) {
  return JSON.parse(report('create',null,attempt,{reporting_period:'October 2026',audience:'Sponsor',detail_level:'Concise',sections:{project_health:'Current'},counts:{},provenance:[]})).id;
}

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
  for (const name of migrations) sql(readFileSync(join('supabase/migrations',name),'utf8'));
  sql(`insert into auth.users values('${user}'),('${id(2)}');
    insert into public.profiles(id) values('${user}'),('${id(2)}');
    insert into public.organizations(id,name) values('${id(9)}','Test');
    insert into public.projects(id,organization_id,name) values('${project}','${id(9)}','Test'),('${otherProject}','${id(9)}','Other');
    insert into public.project_members(project_id,user_id,role) values('${project}','${user}','admin'),('${otherProject}','${user}','admin'),('${project}','${id(2)}','pmo_reviewer');
    insert into public.assurance_reviews(id,project_id,reporting_period,title,created_by)
      values('${review}','${project}','2026-10-01','October','${user}'),('${id(10)}','${otherProject}','2026-10-01','Other','${user}');
    insert into public.documents(id,project_id,uploader_id,document_type,title,file_name,file_size,mime_type,storage_path,processing_status)
      select x,'${project}','${user}','progress_report','Evidence','evidence.pdf',10,'application/pdf',x::text,'completed'
      from unnest(array['${base}','${current}','${alternate}']::uuid[]) x;
    insert into public.documents(id,project_id,uploader_id,document_type,title,file_name,file_size,mime_type,storage_path,processing_status)
      values('${id(11)}','${otherProject}','${user}','progress_report','Other','other.pdf',10,'application/pdf','other','completed');
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

test('backend analysis integrity on a disposable database', { skip: !port }, async t => {
  await t.test('selection saves, successful publication and identical save preserve approval', () => {
    assert.equal(save(), 't'); const attempt = success(); assert.equal(fresh(), 't');
    const preview = createReport(attempt); report('approve',preview);
    const before = sql(`select row_to_json(r) from public.assurance_reviews r where id='${review}';`);
    assert.equal(save(), 'f');
    assert.equal(sql(`select row_to_json(r) from public.assurance_reviews r where id='${review}';`),before);
  });
  await t.test('changed role or document invalidates without deleting previous findings', () => {
    const latest=sql(`select analysis_metadata->'latest_attempt' from public.assurance_reviews where id='${review}'`);
    assert.equal(save(current,base),'t'); assert.equal(fresh(),'f');
    assert.equal(sql(`select analysis_metadata->'latest_attempt' from public.assurance_reviews where id='${review}'`),latest,'A successful attempt remains recorded as successful history');
    assert.equal(sql(`select count(*) from public.assurance_findings where review_id='${review}'`),'3');
    assert.equal(save(base,alternate),'t'); assert.equal(fresh(),'f');
    save(); success();
  });
  await t.test('text, location and storage metadata changes under the same ID invalidate snapshots', () => {
    for (const mutation of [
      `update public.document_chunks set chunk_text=chunk_text||' changed' where document_id='${current}'`,
      `update public.document_chunks set parser_metadata='{"sourceLocation":{"page":4}}' where document_id='${current}'`,
      `update storage.objects set name=name||'-new' where name=(select storage_path from public.documents where id='${current}'); update public.documents set storage_path=storage_path||'-new' where id='${current}'`,
      `update storage.objects set metadata='{"eTag":"new"}' where name=(select storage_path from public.documents where id='${current}')`,
    ]) { sql(mutation); assert.equal(fresh(),'f'); success(); }
    sql(`update public.documents set updated_at=clock_timestamp() where id='${current}'`);
    assert.equal(fresh(),'t');
  });
  await t.test('failure retains last success; retry associates all domains with the new identity', () => {
    const previous=sql(`select analysis_metadata->'last_success' from public.assurance_reviews where id='${review}'`);
    const attempt=claim().attempt_id; assert.equal(fresh(),'f'); assert.equal(fail(attempt),'f');
    assert.equal(fresh(),'f');
    assert.equal(sql(`select analysis_metadata->'last_success' from public.assurance_reviews where id='${review}'`),previous);
    const retry=success(); assert.equal(sql(`select count(*) from public.assurance_findings where review_id='${review}' and provenance->>'analysis_attempt_id'='${retry}'`),'3');
  });
  await t.test('fault injected after deletes rolls back findings, actions and successful metadata', () => {
    sql(`insert into public.assurance_actions(project_id,review_id,title,owner_name) values('${project}','${review}','Keep me','Owner');`);
    const before=sql(`select jsonb_agg(to_jsonb(f) order by domain) from public.assurance_findings f where review_id='${review}';`);
    const attempt=claim().attempt_id;
    const metadata=sql(`select analysis_metadata from public.assurance_reviews where id='${review}'`);
    const broken=structuredClone(findings); broken[2].confidence=2;
    assert.throws(()=>finish(attempt,broken),/confidence|check constraint/);
    assert.equal(sql(`select jsonb_agg(to_jsonb(f) order by domain) from public.assurance_findings f where review_id='${review}';`),before);
    assert.equal(sql(`select owner_name from public.assurance_actions where title='Keep me'`),'Owner');
    assert.equal(sql(`select analysis_metadata from public.assurance_reviews where id='${review}'`),metadata);
    assert.equal(fresh(),'f'); fail(attempt); success();
  });
  await t.test('obsolete attempts cannot overwrite success or failure after selection changes', () => {
    const old=claim().attempt_id; save(base,alternate); const newer=claim().attempt_id;
    assert.equal(finish(old),'f'); assert.equal(fail(old),'f'); fail(newer);
    assert.equal(finish(old),'f'); assert.equal(sql(`select analysis_metadata->'latest_attempt'->>'id' from public.assurance_reviews where id='${review}'`),newer);
    const latest=success(); assert.equal(fail(old),'f');
    assert.equal(sql(`select analysis_metadata->'last_success'->>'id' from public.assurance_reviews where id='${review}'`),latest);
    save(); success();
  });
  await t.test('publication rechecks the source after claim', () => {
    const attempt=claim().attempt_id;
    sql(`update public.document_chunks set chunk_text=chunk_text||' concurrent' where document_id='${current}'`);
    assert.equal(finish(attempt),'f'); assert.equal(fresh(),'f'); success();
  });
  await t.test('expired claims can be reclaimed and late completions cannot publish', () => {
    const old=claim().attempt_id;
    sql(`update public.assurance_reviews set analysis_metadata=jsonb_set(analysis_metadata,'{latest_attempt,lease_until}',to_jsonb((now()-interval '1 second')::text)) where id='${review}'`);
    const retry=claim().attempt_id; assert.notEqual(retry,old);
    assert.equal(finish(old),'f'); assert.equal(fail(old),'f'); assert.equal(finish(retry),'t');
  });
  await t.test('source writes cannot pass verification before publication commits', async () => {
    const attempt=claim().attempt_id;
    const publishing=asyncSql(`${auth(user)} begin; select public.finish_assurance_analysis('${project}','${review}','${attempt}',${quoted(findings)}); select pg_sleep(2); commit;`);
    // Wait for the publisher to hold its source locks, using pg_stat_activity
    // rather than relying on a scheduling delay.
    for(let i=0;i<50;i++) {
      await new Promise(resolve=>setTimeout(resolve,10));
      if(sql(`select count(*) from pg_stat_activity where datname='${database}' and wait_event='PgSleep'`)!=='0') break;
      if(i===49) throw new Error('Publisher did not reach controlled commit barrier');
    }
    const writing=asyncSql(`update public.document_chunks set chunk_text=chunk_text||' after commit' where document_id='${current}'`);
    let blocked=false;
    for(let i=0;i<12;i++) {
      await new Promise(resolve=>setTimeout(resolve,10));
      if(sql(`select count(*) from pg_stat_activity where datname='${database}' and wait_event_type='Lock'
        and query like 'update public.document_chunks%'`)!=='0') { blocked=true; break; }
    }
    assert.equal(blocked,true,'Source update must wait for the publication transaction');
    await Promise.all([publishing,writing]); assert.equal(fresh(),'f'); success();
  });
  await t.test('overlapping requests serialize and only one claims ownership', async () => {
    const first=asyncSql(`${auth(user)} begin; select public.claim_assurance_analysis('${project}','${review}'); select pg_sleep(0.4); commit;`);
    // Both sessions are real PostgreSQL connections; whichever locks first wins.
    const second=asyncSql(`${auth(user)} select public.claim_assurance_analysis('${project}','${review}');`);
    const outcomes=await Promise.allSettled([first,second]);
    assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
    assert.match(outcomes.find(x=>x.status==='rejected').reason.message,/already running/);
    const attempt=sql(`select analysis_metadata->'latest_attempt'->>'id' from public.assurance_reviews where id='${review}'`);
    fail(attempt); success();
  });
  await t.test('reports reject stale, legacy and mismatched analysis associations at every operation', () => {
    const attempt=sql(`select analysis_metadata->'last_success'->>'id' from public.assurance_reviews where id='${review}'`);
    const preview=createReport(attempt); report('approve',preview);
    const check=JSON.parse(report('export_check',preview));
    assert.equal(check.attempt_id,attempt);
    assert.throws(()=>report('create',null,id(99),{}),/analysis has changed/);
    sql(`update public.report_previews set provenance='[]' where id='${preview}'`);
    assert.throws(()=>report('approve',preview),/not associated/);
    sql(`update public.report_previews set provenance=${quoted([{label:'Analysis attempt',source:attempt}])} where id='${preview}'`);
    save(base,alternate);
    for(const op of ['context','create','approve','export_check','export_finish'])
      assert.throws(()=>report(op,preview,attempt,{}),/successful analysis/);
    success(); assert.throws(()=>report('export_check',preview),/not associated/);
    const legacy=sql(`select analysis_metadata from public.assurance_reviews where id='${review}'`);
    sql(`update public.assurance_reviews set analysis_metadata='{"completed_at":"2026-10-01"}' where id='${review}'`);
    assert.equal(fresh(),'f'); assert.throws(()=>report('context'),/successful analysis/);
    sql(`update public.assurance_reviews set analysis_metadata='${legacy.replaceAll("'","''")}'::jsonb where id='${review}'`);
  });
  await t.test('export completion rejects changed report content and commits valid files atomically', () => {
    const attempt=sql(`select analysis_metadata->'last_success'->>'id' from public.assurance_reviews where id='${review}'`);
    const preview=createReport(attempt); report('approve',preview);
    const check=JSON.parse(report('export_check',preview));
    const payload={report_fingerprint:check.report_fingerprint,format:'pdf',storage_path:`${project}/test.pdf`,file_name:'test.pdf',file_size:10};
    sql(`update public.report_previews set edited_sections='{"project_health":"Edited"}' where id='${preview}'`);
    assert.throws(()=>report('export_finish',preview,attempt,payload),/changed during file/);
    const updated=JSON.parse(report('export_check',preview)); payload.report_fingerprint=updated.report_fingerprint;
    report('export_finish',preview,attempt,payload);
    assert.equal(sql(`select count(*) from public.report_exports where report_preview_id='${preview}'`),'1');
  });
  await t.test('restricted roles, anon, and cross-project references fail; helpers are private', () => {
    for(const role of ['pmo_reviewer','sponsor','steering_committee']) {
      sql(`update public.project_members set role='${role}' where user_id='${id(2)}' and project_id='${project}'`);
      assert.throws(()=>sql(`${auth(id(2))} select public.claim_assurance_analysis('${project}','${review}')`),/cannot manage/);
      const state=JSON.parse(sql(`${auth(id(2))} select public.get_assurance_analysis_state('${project}','${review}')`));
      assert.equal(state.current,true); assert.equal(state.chunks,undefined);
    }
    assert.throws(()=>sql(`set role anon; select public.claim_assurance_analysis('${project}','${review}')`),/permission denied/);
    assert.throws(()=>save(base,id(11)),/belong to this project/);
    assert.throws(()=>call(`select public.claim_assurance_analysis('${project}','${id(10)}')`),/not found/);
    assert.throws(()=>call(`select public.assurance_source_snapshot('${project}','${review}')`),/permission denied/);
    assert.throws(()=>sql(`${auth(id(99))} select public.claim_assurance_analysis('${project}','${review}')`),/cannot manage/);
    assert.throws(()=>sql(`${auth(id(99))} select public.get_assurance_analysis_state('${project}','${review}')`),/membership/);
    for(const role of ['pmc_consultant','project_manager']) {
      sql(`update public.project_members set role='${role}' where user_id='${id(2)}' and project_id='${project}'`);
      assert.equal(sql(`${auth(id(2))} select public.save_assurance_evidence('${project}','${review}',array['${base}']::uuid[],array['${alternate}']::uuid[])`),'f');
    }
    assert.equal(fresh(),'t');
  });
  await t.test('one unverifiable domain makes the entire analysis ineligible', () => {
    const before=sql(`select provenance from public.assurance_findings where review_id='${review}' and domain='budget'`);
    sql(`update public.assurance_findings set provenance=provenance-'analysis_attempt_id' where review_id='${review}' and domain='budget'`);
    assert.equal(fresh(),'f'); assert.throws(()=>report('context'),/successful analysis/);
    sql(`update public.assurance_findings set provenance='${before.replaceAll("'","''")}'::jsonb where review_id='${review}' and domain='budget'`);
    assert.equal(fresh(),'t');
  });
});
