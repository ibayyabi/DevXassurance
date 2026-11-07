-- Ticket 05: prior-current evidence is captured by claim, fenced at finish,
-- and invalidates completed analyses.
-- Two-session claim check (same project, two distinct findings_ready reviews):
-- A: BEGIN; set JWT claims; SELECT claim_assurance_analysis(project, A).
-- B: BEGIN; set JWT claims; SELECT claim_assurance_analysis(project, B);
-- B waits before taking review B. COMMIT A, then B returns and commits.
-- Repeat reversed. Source-write check: A claims and keeps its transaction
-- open; B updates selected prior evidence or uses Storage API to delete/update
-- its selected object. The after-trigger waits for project; A finishes against
-- its captured MVCC source and commits; B then invalidates currentness. No
-- deadlock. pgTAP runs after migrations 202611050001, 003, and 006.
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/risk_snapshot_atomicity.test.sql
begin;
select set_config('storage.allow_delete_query', 'true', true);
select extensions.plan(52);
select ok(not exists (
  select 1 from unnest(array[
    'cost_baselines','wbs_mappings','milestone_mappings','risk_identity_mappings','risk_scale_mappings'
  ]) rt(table_name)
  cross join (values ('INSERT'),('UPDATE'),('DELETE')) p(privilege)
  where has_table_privilege('authenticated', 'public.' || rt.table_name, p.privilege)
), 'reference table writes are restricted to project-lock RPCs');

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
insert into public.cost_observations (
  id, project_id, document_id, measure, source_value, normalized_amount, currency,
  scope_level, scope_label, evidence_chunk_index, excerpt, source_location,
  provider, model, source_content_hash, parser_version, contract_version
) values (
  '51000000-0000-4000-8000-000000000061',
  '51000000-0000-4000-8000-000000000003',
  '51000000-0000-4000-8000-000000000033',
  'actual_to_date', 'USD 10', 10, 'USD', 'project', null, 0, 'Current cost',
  '{"sheet_name":"Costs","cell_reference":"A1"}'::jsonb,
  'fixture', 'fixture', repeat('c',64), 'parser/1', 'pmo-assurance-observations/1'
);
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
set local role authenticated;
with changed as (
  update public.assurance_reviews set title = 'Unauthorized direct edit'
  where id = '51000000-0000-4000-8000-000000000022' returning id
)
select is((select count(*) from changed), 0::bigint,
  'direct review updates are unavailable outside project-first RPCs');
reset role;
insert into public.progress_rag_rules (id, project_id, rule_version, thresholds, approved_by)
values (
  '51000000-0000-4000-8000-000000000071',
  '51000000-0000-4000-8000-000000000003',
  'approved-v1',
  '{"amber_below_pp": -2, "red_below_pp": -5}'::jsonb,
  '51000000-0000-4000-8000-000000000001'
);
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
  (select claim->'progress_rag_rule'->>'rule_version' from risk_claims where stage=1),
  'approved-v1', 'the same claim carries the approved progress rule'
);
select is(
  (select claim->'reference_versions'->>'progress_rag_rule_id' from risk_claims where stage=1),
  '51000000-0000-4000-8000-000000000071', 'the progress rule is included in reference fencing'
);
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
insert into public.assurance_observation_decisions (
  id, project_id, target_type, document_id, source_content_hash, parser_version,
  contract_version, observation_fingerprint, decision, reason, decided_by
)
select '51000000-0000-4000-8000-000000000054', o.project_id, 'assurance', o.document_id,
  o.source_content_hash, o.parser_version, o.contract_version, o.observation_fingerprint,
  'accepted', 'Current risk verified', '51000000-0000-4000-8000-000000000001'
from public.assurance_observations o where o.id = '51000000-0000-4000-8000-000000000042';
select is((select analysis_error from public.assurance_reviews
  where id = '51000000-0000-4000-8000-000000000022'),
  'Reviewer decisions changed. Run the analysis again.',
  'ticket 05 preserves ticket 03 reviewer-specific invalidation reason');
select ok((select analysis_metadata->'observation_decision_invalidation'->>'reason'
  from public.assurance_reviews where id = '51000000-0000-4000-8000-000000000022')
  = 'Reviewer decisions changed', 'ticket 03 decision invalidation metadata remains intact');
update public.documents set file_name = 'current-reviewed.pdf',
  confirmed_workstream = 'Electrical'
where id = '51000000-0000-4000-8000-000000000033';
select is(public.assurance_analysis_is_current('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000022'), false,
  'fingerprinted document metadata changes invalidate published source data');
select is((select status from public.assurance_reviews where id = '51000000-0000-4000-8000-000000000022'),
  'evidence_ready', 'document metadata changes invalidate the published review');
select pg_temp.add_claim(7);
select is(pg_temp.finish_current((select claim from risk_claims where stage=7)), true,
  'analysis can publish after the changed document metadata is included');
update public.cost_observations set provider = 'reviewed'
where id = '51000000-0000-4000-8000-000000000061';
select is(public.assurance_analysis_is_current('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000022'), false,
  'cost-observation provenance changes invalidate published source fingerprints');
select is((select status from public.assurance_reviews where id = '51000000-0000-4000-8000-000000000022'),
  'evidence_ready', 'cost-observation changes invalidate the published review');
select pg_temp.add_claim(8);
select is(pg_temp.finish_current((select claim from risk_claims where stage=8)), true,
  'analysis can publish after the changed cost evidence is included');
update storage.objects
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('risk_atomicity', 'updated')
where bucket_id = 'project-evidence'
  and name = '51000000-0000-4000-8000-000000000003/current.pdf';
select is(public.assurance_analysis_is_current('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000022'), false,
  'storage-object metadata updates invalidate published source fingerprints');
select is((select status from public.assurance_reviews where id = '51000000-0000-4000-8000-000000000022'),
  'evidence_ready', 'storage-object update invalidates the published review');
insert into public.assurance_reviews (id, project_id, reporting_period, cutoff_precision, title, created_by, status, current_step)
values ('51000000-0000-4000-8000-000000000024', '51000000-0000-4000-8000-000000000003', '2026-10-20', 'date', 'Nearer review after analysis', '51000000-0000-4000-8000-000000000001', 'findings_ready', 'findings');
insert into public.assurance_review_documents (project_id, review_id, document_id, evidence_role, added_by)
values ('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000024', '51000000-0000-4000-8000-000000000031', 'current', '51000000-0000-4000-8000-000000000001');
select is(public.assurance_analysis_is_current('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000022'), false,
  'a newly nearer prior review after publication invalidates dependent analysis');

insert into public.assurance_review_documents (project_id, review_id, document_id, evidence_role, added_by)
values ('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000024', '51000000-0000-4000-8000-000000000034', 'current', '51000000-0000-4000-8000-000000000001');
select pg_temp.add_claim(9);
select is((select claim->'prior_risk_snapshot'->>'gap_reason' from risk_claims where stage=9),
  'prior_source_version_unavailable', 'a cross-project linked source is an honest scoped gap');
select is(jsonb_array_length((select claim->'prior_risk_snapshot'->'sources' from risk_claims where stage=9)),
  0, 'cross-project source observations are never returned in the prior payload');
delete from storage.objects
where bucket_id = 'project-evidence'
  and name = '51000000-0000-4000-8000-000000000003/current.pdf';
select is(pg_temp.finish_current((select claim from risk_claims where stage=9)), false,
  'storage deletion after claim prevents stale publication');
select is(public.assurance_analysis_is_current('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000022'), false,
  'currentness rejects a selected source after its storage object is deleted');
select is((select status from public.assurance_reviews where id = '51000000-0000-4000-8000-000000000022'),
  'evidence_ready', 'storage deletion invalidates the in-flight review');
select throws_ok(
  $$select public.claim_assurance_analysis('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000025')$$,
  'P0001', 'Assurance review was not found in this project.',
  'project membership cannot claim another project review'
);

-- Claim-scoped risk mapping fence: the claim carries ALL accepted
-- project-scoped identity/scale mappings (simplest consistent contract; a
-- chunk-mention selection would miss reviewer-corrected labels absent from
-- raw text). Any accepted mapping change must fence finish in-flight and
-- invalidate a published analysis; cross-project rows never enter.
-- ponytail: full-project snapshot, unrelated mapping changes invalidate
-- other reviews in the project; narrow if measurable.
-- No document_chunks rows are inserted here on purpose: the whole mapping
-- set is claim-carried whether or not any chunk mentions it.
-- Restore the selected current storage object deleted at stage 9 before any
-- further claim.
insert into storage.objects (bucket_id, name)
values ('project-evidence', '51000000-0000-4000-8000-000000000003/current.pdf')
on conflict do nothing;
insert into public.risk_identity_mappings
  (id, project_id, source_label, canonical_label, state, created_by, accepted_by, accepted_at)
values ('51000000-0000-4000-8000-000000000081', '51000000-0000-4000-8000-000000000003',
  'R-prior only', 'R-1', 'accepted', '51000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001', now())
on conflict do nothing;
insert into public.risk_scale_mappings
  (id, project_id, source_label, canonical_label, state, created_by, accepted_by, accepted_at)
values ('51000000-0000-4000-8000-000000000082', '51000000-0000-4000-8000-000000000003',
  '1to5', '1-5', 'accepted', '51000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001', now())
on conflict do nothing;
insert into public.risk_identity_mappings
  (id, project_id, source_label, canonical_label, state, created_by, accepted_by, accepted_at)
values ('51000000-0000-4000-8000-000000000083', '51000000-0000-4000-8000-000000000004',
  'R-prior only', 'R-foreign', 'accepted', '51000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001', now())
on conflict do nothing;
insert into public.risk_scale_mappings
  (id, project_id, source_label, canonical_label, state, created_by, accepted_by, accepted_at)
values ('51000000-0000-4000-8000-000000000084', '51000000-0000-4000-8000-000000000003',
  'Corrected-Low', 'Low-Med-High', 'accepted', '51000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001', now())
on conflict do nothing;
select pg_temp.add_claim(10);
select is(
  (select claim->'risk_mappings'->'risk_scale_mappings'->0->>'id' from risk_claims where stage=10),
  '51000000-0000-4000-8000-000000000082',
  'claim carries the accepted project scale mapping');
select is(
  (select count(*) from jsonb_array_elements(
    (select claim->'risk_mappings'->'risk_identity_mappings' from risk_claims where stage=10)) as h
   where h->>'canonical_label' = 'R-foreign'),
  0::bigint, 'a foreign-project mapping is never in the claim payload');
select is(
  (select claim->'reference_versions'->'risk_identity_mapping_ids'->>0 from risk_claims where stage=10),
  '51000000-0000-4000-8000-000000000081',
  'reference versions fingerprinted the claim identity mapping id');
select is(pg_temp.finish_current((select claim from risk_claims where stage=10)), true,
  'unchanged claim mapping set publishes');
select is(public.assurance_analysis_is_current('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000022'), true,
  'published analysis is current with claim mappings');
select public.remove_assurance_mapping(
  '51000000-0000-4000-8000-000000000003', 'risk_identity', '51000000-0000-4000-8000-000000000081');
select is(public.assurance_analysis_is_current('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000022'), false,
  'claim identity removal after publication invalidates the analysis');
select is((select status from public.assurance_reviews where id = '51000000-0000-4000-8000-000000000022'),
  'evidence_ready', 'claim identity removal invalidates the published review');
select pg_temp.add_claim(11);
select is(
  (select claim->'risk_mappings'->'risk_identity_mappings' from risk_claims where stage=11),
  '[]'::jsonb, 'superseded claim identity mapping leaves the next claim');
select is(pg_temp.finish_current((select claim from risk_claims where stage=11)), true,
  'analysis republishes without the removed mapping');
select pg_temp.add_claim(12);
select public.replace_assurance_mapping(
  '51000000-0000-4000-8000-000000000003', 'risk_scale', '1to5', '1-10', 'scale revised prior only');
select is(pg_temp.finish_current((select claim from risk_claims where stage=12)), false,
  'claim scale change during analysis fences finish');
select pg_temp.add_claim(13);
select is(
  (select claim->'reference_versions'->'risk_scale_mapping_ids'
   from risk_claims where stage=13) ? (select h->>'id'
     from jsonb_array_elements(
       (select claim->'risk_mappings'->'risk_scale_mappings' from risk_claims where stage=13)) as h
     where h->>'source_label' = '1to5' and h->>'canonical_label' = '1-10'),
  true,
  'reference versions contain the exact superseding claim scale mapping id');
select is(
  (select claim->'reference_versions'->'risk_scale_mapping_ids'
   from risk_claims where stage=13) ? '51000000-0000-4000-8000-000000000082',
  false,
  'superseded claim scale mapping id leaves reference versions');
select is(
  (select count(*) from jsonb_array_elements(
    (select claim->'risk_mappings'->'risk_scale_mappings' from risk_claims where stage=13)) as h
   where h->>'source_label' = '1to5' and h->>'canonical_label' = '1-10'),
  1::bigint, 'the next claim carries the revised claim scale mapping');
select is(pg_temp.finish_current((select claim from risk_claims where stage=13)), true,
  'analysis publishes with the revised claim scale mapping');
select pg_temp.add_claim(14);
select is(
  (select count(*) from jsonb_array_elements(
    (select claim->'risk_mappings'->'risk_scale_mappings' from risk_claims where stage=14)) as h
   where h->>'source_label' = 'Corrected-Low'),
  1::bigint,
  'a corrected-only scale mapping absent from chunk text is still claim-carried');
select is(pg_temp.finish_current((select claim from risk_claims where stage=14)), true,
  'analysis publishes with the corrected-only claim scale mapping');
select is(public.assurance_analysis_is_current('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000022'), true,
  'published analysis is current with corrected-only claim mapping');
select public.remove_assurance_mapping(
  '51000000-0000-4000-8000-000000000003', 'risk_scale', '51000000-0000-4000-8000-000000000084');
select is(public.assurance_analysis_is_current('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000022'), false,
  'corrected-only mapping removal after publication invalidates the analysis');
select * from extensions.finish();
rollback;
