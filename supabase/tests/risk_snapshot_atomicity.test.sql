-- Ticket 05: prior-current evidence is captured by claim, fenced at finish,
-- and invalidates completed analyses.
-- Two-session claim check (same project, two distinct findings_ready reviews):
-- A: BEGIN; set JWT claims; SELECT claim_assurance_analysis(project, A).
-- B: BEGIN; set JWT claims; SELECT claim_assurance_analysis(project, B);
-- B waits before taking review B. COMMIT A, then B returns and commits.
-- Repeat reversed. Source-write check: A claims and keeps its transaction
-- open; B updates selected prior assurance_observations and waits in its
-- after-trigger for the project lock. A finishes against its captured source
-- and commits; B must then commit and invalidate currentness. No deadlock.
-- pgTAP runs after migrations 202611050001, 202611050002, and 202611050003.
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/risk_snapshot_atomicity.test.sql
begin;
select extensions.plan(23);
select ok((
  select lock_position > 0 and lock_position < review_position
  from (
    select position('from public.projects where id = p_project_id for update' in definition) as lock_position,
      position('from public.assurance_reviews' in definition) as review_position
    from (select pg_get_functiondef('public.lock_assurance_review(uuid,uuid)'::regprocedure) as definition) f
  ) positions
), 'review locks are acquired after the exclusive project lock');
select is((
  select count(*) from pg_policies
  where schemaname = 'public' and tablename = 'assurance_reviews'
    and cmd in ('UPDATE', 'ALL') and roles && array['authenticated'::name, 'public'::name]
), 0::bigint, 'direct review updates are unavailable outside project-first RPCs');
select ok((
  select position('for update' in lower(definition)) = 0
    and position('for share' in lower(definition)) = 0
  from (select pg_get_functiondef(
    'public.assurance_source_snapshot_without_observation_decisions(uuid,uuid)'::regprocedure
  ) as definition) f
), 'source snapshot does not wait on rows mutated before after-trigger project locks');
select ok((
  select position('from public.projects where id = job.project_id for update' in lower(definition))
    > position('where id = owner_job_id for update' in lower(definition))
  from (select pg_get_functiondef('public.assert_document_job_owner(uuid,uuid)'::regprocedure) as definition) f
), 'worker source writes acquire the project lock before reference rows');
select ok((
  select position('from public.projects where id = p_project_id for update' in lower(definition))
    < position('public.save_assurance_observation_decision_without_project_lock(' in lower(definition))
  from (select pg_get_functiondef(
    'public.save_assurance_observation_decision(uuid,text,uuid,text,text,text,jsonb)'::regprocedure
  ) as definition) f
), 'decision writes acquire the project lock before reading and locking evidence');
select ok(exists (
  select 1 from pg_trigger
  where tgrelid = 'public.document_chunks'::regclass
    and tgname = 'document_chunks_prior_risk_reference_change' and not tgisinternal
), 'chunk changes invalidate dependent source fingerprints');

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, created_at, updated_at)
values
  ('51000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'risk-atomic@example.invalid', '', now(), '{}'::jsonb, now(), now())
on conflict (id) do nothing;
insert into public.profiles (id, full_name)
values ('51000000-0000-4000-8000-000000000001', 'Risk Atomic Reviewer')
on conflict (id) do nothing;
insert into public.organizations (id, name)
values ('51000000-0000-4000-8000-000000000002', 'Risk atomic org')
on conflict (id) do nothing;
insert into public.projects (id, organization_id, name)
values
  ('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000002', 'Risk atomic project'),
  ('51000000-0000-4000-8000-000000000004', '51000000-0000-4000-8000-000000000002', 'Other risk project')
on conflict (id) do nothing;
insert into public.project_members (project_id, user_id, role)
values
  ('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000001', 'project_manager'),
  ('51000000-0000-4000-8000-000000000004', '51000000-0000-4000-8000-000000000001', 'project_manager')
on conflict do nothing;
insert into storage.buckets (id, name, public)
values ('project-evidence', 'project-evidence', false)
on conflict (id) do nothing;
insert into storage.objects (bucket_id, name)
values
  ('project-evidence', '51000000-0000-4000-8000-000000000003/prior.pdf'),
  ('project-evidence', '51000000-0000-4000-8000-000000000003/base.pdf'),
  ('project-evidence', '51000000-0000-4000-8000-000000000003/current.pdf'),
  ('project-evidence', '51000000-0000-4000-8000-000000000004/foreign.pdf')
on conflict do nothing;

insert into public.documents
  (id, project_id, uploader_id, document_type, title, file_name, file_size, mime_type,
   storage_bucket, storage_path, processing_status, content_hash,
   assurance_observation_parser_version, assurance_observation_contract_version)
values
  ('51000000-0000-4000-8000-000000000031', '51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000001', 'progress_report', 'Prior risk', 'prior.pdf', 10, 'application/pdf', 'project-evidence', '51000000-0000-4000-8000-000000000003/prior.pdf', 'completed', repeat('a',64), 'parser/1', 'pmo-assurance-observations/1'),
  ('51000000-0000-4000-8000-000000000032', '51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000001', 'progress_report', 'Baseline', 'base.pdf', 10, 'application/pdf', 'project-evidence', '51000000-0000-4000-8000-000000000003/base.pdf', 'completed', repeat('b',64), 'parser/1', 'pmo-assurance-observations/1'),
  ('51000000-0000-4000-8000-000000000033', '51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000001', 'progress_report', 'Current risk', 'current.pdf', 10, 'application/pdf', 'project-evidence', '51000000-0000-4000-8000-000000000003/current.pdf', 'completed', repeat('c',64), 'parser/1', 'pmo-assurance-observations/1'),
  ('51000000-0000-4000-8000-000000000034', '51000000-0000-4000-8000-000000000004', '51000000-0000-4000-8000-000000000001', 'progress_report', 'Foreign risk', 'foreign.pdf', 10, 'application/pdf', 'project-evidence', '51000000-0000-4000-8000-000000000004/foreign.pdf', 'completed', repeat('d',64), 'parser/1', 'pmo-assurance-observations/1')
on conflict (id) do nothing;

insert into public.assurance_reviews (id, project_id, reporting_period, cutoff_precision, title, created_by, status, current_step)
values
  ('51000000-0000-4000-8000-000000000021', '51000000-0000-4000-8000-000000000003', '2026-10-16', 'date', 'Prior risk review', '51000000-0000-4000-8000-000000000001', 'findings_ready', 'findings'),
  ('51000000-0000-4000-8000-000000000022', '51000000-0000-4000-8000-000000000003', '2026-10-23', 'date', 'Current risk review', '51000000-0000-4000-8000-000000000001', 'evidence_ready', 'analysis'),
  ('51000000-0000-4000-8000-000000000025', '51000000-0000-4000-8000-000000000004', '2026-10-23', 'date', 'Foreign review', '51000000-0000-4000-8000-000000000001', 'draft', 'evidence')
on conflict (id) do nothing;
insert into public.assurance_review_documents (project_id, review_id, document_id, evidence_role, added_by)
values
  ('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000021', '51000000-0000-4000-8000-000000000031', 'current', '51000000-0000-4000-8000-000000000001'),
  ('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000022', '51000000-0000-4000-8000-000000000032', 'baseline', '51000000-0000-4000-8000-000000000001'),
  ('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000022', '51000000-0000-4000-8000-000000000033', 'current', '51000000-0000-4000-8000-000000000001')
on conflict do nothing;

insert into public.assurance_observations
  (id, project_id, document_id, source_content_hash, parser_version, contract_version,
   domain, observation_type, observation, evidence_chunk_index, excerpt, page_number, section_label, source_location)
values
  ('51000000-0000-4000-8000-000000000041', '51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000031', repeat('a',64), 'parser/1', 'pmo-assurance-observations/1', 'risk', 'risk_snapshot',
    '{"risk_id":"R-1","status":"Open","rating_label":"Medium","rating_value":2,"as_of_date":"2026-10-16"}'::jsonb, 0, 'Prior risk row', 1, 'Risk register', '{"sheet_name":"Risk register","cell_reference":"A1"}'::jsonb),
  ('51000000-0000-4000-8000-000000000042', '51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000033', repeat('c',64), 'parser/1', 'pmo-assurance-observations/1', 'risk', 'risk_snapshot',
    '{"risk_id":"R-1","status":"Open","rating_label":"High","rating_value":4,"as_of_date":"2026-10-23"}'::jsonb, 0, 'Current risk row', 1, 'Risk register', '{"sheet_name":"Risk register","cell_reference":"A1"}'::jsonb);
insert into public.assurance_observation_coverage
  (project_id, document_id, source_content_hash, parser_version, contract_version, domain, state, total_groups, processed_groups)
values
  ('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000031', repeat('a',64), 'parser/1', 'pmo-assurance-observations/1', 'risk', 'processed', 1, 1),
  ('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000032', repeat('b',64), 'parser/1', 'pmo-assurance-observations/1', 'risk', 'processed', 1, 1),
  ('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000033', repeat('c',64), 'parser/1', 'pmo-assurance-observations/1', 'risk', 'processed', 1, 1);
insert into public.assurance_observation_decisions
  (id, project_id, target_type, document_id, source_content_hash, parser_version, contract_version,
   observation_fingerprint, decision, corrected_observation, reason, decided_by)
select '51000000-0000-4000-8000-000000000051', o.project_id, 'assurance', o.document_id,
  o.source_content_hash, o.parser_version, o.contract_version, o.observation_fingerprint,
  'accepted', null, 'Prior risk verified', '51000000-0000-4000-8000-000000000001'
from public.assurance_observations o where o.id = '51000000-0000-4000-8000-000000000041'
on conflict (document_id, source_content_hash, parser_version, contract_version, target_type, observation_fingerprint)
do nothing;

select set_config('request.jwt.claims', '{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
create temporary table risk_claims (stage integer primary key, claim jsonb not null);
create function pg_temp.claim_current() returns jsonb language sql as $$
  select public.claim_assurance_analysis('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000022');
$$;
create function pg_temp.finish_current(p_claim jsonb) returns boolean language sql as $$
  select public.finish_assurance_analysis_with_decision_fingerprint(
    '51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000022',
    (p_claim->>'attempt_id')::uuid,
    jsonb_build_array(
      jsonb_build_object('domain','budget','condition','more_evidence_required','severity','information','headline','Budget','explanation','Test','requiredEvidence','[]'::jsonb,'sourceExcerpts','[]'::jsonb,'confidence',0.5),
      jsonb_build_object('domain','schedule','condition','more_evidence_required','severity','information','headline','Schedule','explanation','Test','requiredEvidence','[]'::jsonb,'sourceExcerpts','[]'::jsonb,'confidence',0.5),
      jsonb_build_object('domain','risk','condition','more_evidence_required','severity','information','headline','Risk','explanation','Test','requiredEvidence','[]'::jsonb,'sourceExcerpts','[]'::jsonb,'confidence',0.5)
    ), '[]'::jsonb, '{}'::jsonb, '{}'::jsonb);
$$;
create function pg_temp.add_claim(stage integer) returns void language sql as $$
  insert into risk_claims values (stage, pg_temp.claim_current());
$$;

select pg_temp.add_claim(1);
select is(
  (select claim->'prior_risk_snapshot'->'review'->>'id' from risk_claims where stage=1),
  '51000000-0000-4000-8000-000000000021',
  'claim returns the separately selected prior current-role review'
);
select is(
  (select claim->'prior_risk_snapshot'->'sources'->0->'source_version'->>'content_hash' from risk_claims where stage=1),
  repeat('a',64), 'claim includes the prior source version, not the approved baseline'
);
select is(
  (select claim->'reference_versions'->>'prior_risk_fingerprint'
    = claim->'prior_risk_snapshot'->>'fingerprint' from risk_claims where stage=1),
  true, 'the claim reference versions fingerprint the returned prior payload'
);
update public.assurance_observations set observation = jsonb_set(observation, '{rating_value}', '3'::jsonb)
where id = '51000000-0000-4000-8000-000000000041';
select is(pg_temp.finish_current((select claim from risk_claims where stage=1)), false,
  'a prior evidence change during analysis fences finish');

select pg_temp.add_claim(2);
insert into public.assurance_observation_decisions
  (id, project_id, target_type, document_id, source_content_hash, parser_version, contract_version,
   observation_fingerprint, decision, reason, decided_by)
select '51000000-0000-4000-8000-000000000052', o.project_id, 'assurance', o.document_id,
  o.source_content_hash, o.parser_version, o.contract_version, o.observation_fingerprint,
  'accepted', 'Decision added during analysis', '51000000-0000-4000-8000-000000000001'
from public.assurance_observations o where o.id = '51000000-0000-4000-8000-000000000041';
select is(pg_temp.finish_current((select claim from risk_claims where stage=2)), false,
  'a prior reviewer-decision change during analysis fences finish');

select pg_temp.add_claim(3);
insert into public.assurance_reviews (id, project_id, reporting_period, cutoff_precision, title, created_by, status, current_step)
values ('51000000-0000-4000-8000-000000000023', '51000000-0000-4000-8000-000000000003', '2026-10-18', 'date', 'Nearer review during analysis', '51000000-0000-4000-8000-000000000001', 'findings_ready', 'findings');
insert into public.assurance_review_documents (project_id, review_id, document_id, evidence_role, added_by)
values ('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000023', '51000000-0000-4000-8000-000000000031', 'current', '51000000-0000-4000-8000-000000000001');
select is(pg_temp.finish_current((select claim from risk_claims where stage=3)), false,
  'a newly nearer prior review during analysis fences finish');

select pg_temp.add_claim(4);
select is((select claim->'prior_risk_snapshot'->'review'->>'id' from risk_claims where stage=4),
  '51000000-0000-4000-8000-000000000023', 'the next claim uses the nearer review');
select is(pg_temp.finish_current((select claim from risk_claims where stage=4)), true,
  'the unchanged selected prior snapshot can publish');
select is(public.assurance_analysis_is_current('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000022'), true,
  'published analysis is current before prior evidence changes');

update public.assurance_observations set excerpt = 'Prior risk row revised after publication'
where id = '51000000-0000-4000-8000-000000000041';
select is(public.assurance_analysis_is_current('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000022'), false,
  'prior evidence changes after publication invalidate the dependent analysis');
insert into public.assurance_observation_decisions
  (id, project_id, target_type, document_id, source_content_hash, parser_version, contract_version,
   observation_fingerprint, decision, reason, decided_by)
select '51000000-0000-4000-8000-000000000053', o.project_id, 'assurance', o.document_id,
  o.source_content_hash, o.parser_version, o.contract_version, o.observation_fingerprint,
  'accepted', 'Decision for revised prior evidence', '51000000-0000-4000-8000-000000000001'
from public.assurance_observations o where o.id = '51000000-0000-4000-8000-000000000041';
select pg_temp.add_claim(5);
select is(pg_temp.finish_current((select claim from risk_claims where stage=5)), true,
  'analysis can publish against the revised evidence and matching decision');
update public.assurance_observation_decisions set reason = 'Decision changed after publication'
where id = '51000000-0000-4000-8000-000000000053';
select is(public.assurance_analysis_is_current('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000022'), false,
  'prior reviewer-decision changes after publication invalidate the dependent analysis');
select pg_temp.add_claim(6);
select is(pg_temp.finish_current((select claim from risk_claims where stage=6)), true,
  'analysis can publish after the changed prior decision is included');
insert into public.assurance_reviews (id, project_id, reporting_period, cutoff_precision, title, created_by, status, current_step)
values ('51000000-0000-4000-8000-000000000024', '51000000-0000-4000-8000-000000000003', '2026-10-20', 'date', 'Nearer review after analysis', '51000000-0000-4000-8000-000000000001', 'findings_ready', 'findings');
insert into public.assurance_review_documents (project_id, review_id, document_id, evidence_role, added_by)
values ('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000024', '51000000-0000-4000-8000-000000000031', 'current', '51000000-0000-4000-8000-000000000001');
select is(public.assurance_analysis_is_current('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000022'), false,
  'a newly nearer prior review after publication invalidates dependent analysis');

insert into public.assurance_review_documents (project_id, review_id, document_id, evidence_role, added_by)
values ('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000024', '51000000-0000-4000-8000-000000000034', 'current', '51000000-0000-4000-8000-000000000001');
select pg_temp.add_claim(7);
select is((select claim->'prior_risk_snapshot'->>'gap_reason' from risk_claims where stage=7),
  'prior_source_version_unavailable', 'a cross-project linked source is an honest scoped gap');
select is(jsonb_array_length((select claim->'prior_risk_snapshot'->'sources' from risk_claims where stage=7)),
  0, 'cross-project source observations are never returned in the prior payload');
select throws_ok(
  $$select public.claim_assurance_analysis('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000025')$$,
  'P0001', 'Assurance review was not found in this project.',
  'project membership cannot claim another project review'
);

select * from extensions.finish();
rollback;
