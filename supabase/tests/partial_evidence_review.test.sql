-- Ticket 03 behavior tests: per-observation review decisions (accept, correct,
-- reject) with attribution and fingerprint staleness, coverage-driven needs-
-- review selection, decision fingerprints feeding the analysis snapshot, and
-- role/version denial at the server boundary. Runs inside one transaction that
-- always rolls back.
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/partial_evidence_review.test.sql

begin;
select extensions.plan(29);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, created_at, updated_at)
values
  ('50000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'review-pmo@example.invalid', '', now(), '{}'::jsonb, now(), now()),
  ('50000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'review-manager@example.invalid', '', now(), '{}'::jsonb, now(), now()),
  ('50000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'review-sponsor@example.invalid', '', now(), '{}'::jsonb, now(), now()),
  ('50000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'review-pm@example.invalid', '', now(), '{}'::jsonb, now(), now())
on conflict (id) do nothing;
insert into public.profiles (id, full_name)
values
  ('50000000-0000-4000-8000-000000000001', 'Review PMO'),
  ('50000000-0000-4000-8000-000000000002', 'Review Manager'),
  ('50000000-0000-4000-8000-000000000006', 'Review Sponsor'),
  ('50000000-0000-4000-8000-000000000005', 'Review PM')
on conflict (id) do nothing;
insert into public.organizations (id, name)
values ('50000000-0000-4000-8000-000000000002', 'Partial review org')
on conflict (id) do nothing;
insert into public.projects (id, organization_id, name)
values
  ('50000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000002', 'Partial review project'),
  ('50000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000002', 'Other project')
on conflict (id) do nothing;
insert into public.project_members (project_id, user_id, role)
values
  ('50000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000001', 'pmo_reviewer'),
  ('50000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000002', 'sponsor'),
  ('50000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000005', 'project_manager'),
  ('50000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000001', 'pmo_reviewer');

insert into public.documents (id, project_id, uploader_id, document_type, title, file_name, file_size, mime_type, storage_path, processing_status, content_hash, assurance_observation_parser_version, assurance_observation_contract_version)
values
  ('50000000-0000-4000-8000-000000000011', '50000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000001', 'progress_report', 'Baseline mixed W4', 'w4.xlsx', 10, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '50000000-0000-4000-8000-000000000003/w4.xlsx', 'needs_review', repeat('a', 64), 'document-parser/6', 'pmo-assurance-observations/1'),
  ('50000000-0000-4000-8000-000000000012', '50000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000001', 'progress_report', 'Current mixed W5', 'w5.xlsx', 10, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '50000000-0000-4000-8000-000000000003/w5.xlsx', 'completed', repeat('b', 64), 'document-parser/6', 'pmo-assurance-observations/1'),
  ('50000000-0000-4000-8000-000000000013', '50000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000001', 'progress_report', 'Stale coverage doc', 'stale.xlsx', 10, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '50000000-0000-4000-8000-000000000003/stale.xlsx', 'needs_review', repeat('c', 64), 'document-parser/6', 'pmo-assurance-observations/1')
on conflict (id) do nothing;

-- Storage objects back the review documents (the snapshot verifies them).
insert into storage.buckets (id, name, public) values ('project-evidence', 'project-evidence', false)
on conflict (id) do nothing;
insert into storage.objects (bucket_id, name)
values
  ('project-evidence', '50000000-0000-4000-8000-000000000003/w4.xlsx'),
  ('project-evidence', '50000000-0000-4000-8000-000000000003/w5.xlsx'),
  ('project-evidence', '50000000-0000-4000-8000-000000000003/stale.xlsx')
on conflict do nothing;

-- Baseline document W4: one clear progress observation and one milestone, while
-- its risk coverage stays unprocessed (the mixed-document case).
insert into public.assurance_observations
  (project_id, document_id, source_content_hash, parser_version, contract_version, domain, observation_type, observation, evidence_chunk_index, excerpt, page_number, section_label, source_location)
values
  ('50000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000011', repeat('a', 64), 'document-parser/6', 'pmo-assurance-observations/1', 'progress', 'progress',
    jsonb_build_object('raw_value', '12,5%', 'percent', 12.5, 'scope_level', 'wbs', 'scope_label', 'Alarm Kebencanaan', 'period_label', 'W4', 'as_of_date', '2026-10-09'),
    0, 'Actual 12,5% pada 9 Oktober', 1, 'Weekly Report', jsonb_build_object('sheet_name', 'Weekly Report', 'cell_reference', 'D7')),
  ('50000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000011', repeat('a', 64), 'document-parser/6', 'pmo-assurance-observations/1', 'schedule', 'milestone',
    jsonb_build_object('label', 'Pemasangan sensor', 'date', '2026-06-30'),
    1, 'Pemasangan sensor selesai 30 Juni', 1, 'Weekly Report', jsonb_build_object('sheet_name', 'Weekly Report', 'cell_reference', 'B7'));

-- Coverage: budget/schedule/progress processed, risk unprocessed — one domain
-- gap never green-lights the whole document.
insert into public.assurance_observation_coverage (project_id, document_id, source_content_hash, parser_version, contract_version, domain, state, total_groups, processed_groups, reason)
values
  ('50000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000011', repeat('a', 64), 'document-parser/6', 'pmo-assurance-observations/1', 'budget', 'processed', 2, 2, null),
  ('50000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000011', repeat('a', 64), 'document-parser/6', 'pmo-assurance-observations/1', 'schedule', 'processed', 2, 2, null),
  ('50000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000011', repeat('a', 64), 'document-parser/6', 'pmo-assurance-observations/1', 'progress', 'processed', 2, 2, null),
  ('50000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000011', repeat('a', 64), 'document-parser/6', 'pmo-assurance-observations/1', 'risk', 'unprocessed', 2, 1, 'Group 1-1 failed: formula cache missing.'),
  ('50000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000012', repeat('b', 64), 'document-parser/6', 'pmo-assurance-observations/1', 'budget', 'processed', 1, 1, null),
  ('50000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000012', repeat('b', 64), 'document-parser/6', 'pmo-assurance-observations/1', 'schedule', 'processed', 1, 1, null),
  ('50000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000012', repeat('b', 64), 'document-parser/6', 'pmo-assurance-observations/1', 'progress', 'processed', 1, 1, null),
  ('50000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000012', repeat('b', 64), 'document-parser/6', 'pmo-assurance-observations/1', 'risk', 'processed', 1, 1, null);

-- Review with baseline = W4 (needs_review with current coverage), current = W5.
insert into public.assurance_reviews (id, project_id, reporting_period, title, created_by, status, current_step)
values ('50000000-0000-4000-8000-000000000021', '50000000-0000-4000-8000-000000000003', '2026-10-16', 'Partial evidence review', '50000000-0000-4000-8000-000000000001', 'draft', 'evidence')
on conflict (id) do nothing;
insert into public.assurance_review_documents (project_id, review_id, document_id, evidence_role, added_by)
values
  ('50000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000021', '50000000-0000-4000-8000-000000000011', 'baseline', '50000000-0000-4000-8000-000000000001'),
  ('50000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000021', '50000000-0000-4000-8000-000000000012', 'current', '50000000-0000-4000-8000-000000000001')
on conflict do nothing;

create or replace function pg_temp.review_fingerprint() returns text language sql as $$
  select (public.assurance_source_snapshot('50000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000021'))->>'fingerprint';
$$;
create or replace function pg_temp.decision_count() returns bigint language sql as $$
  select jsonb_array_length(public.assurance_source_snapshot('50000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000021')->'observation_decisions');
$$;

select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-8000-000000000005","role":"authenticated"}', true);

-- ---------------------------------------------------------------------------
-- Coverage invariant at the selection boundary
-- ---------------------------------------------------------------------------
select throws_ok(
  format('select public.save_assurance_evidence(''50000000-0000-4000-8000-000000000003'', ''50000000-0000-4000-8000-000000000021'', array[''50000000-0000-4000-8000-000000000013''::uuid], array[''50000000-0000-4000-8000-000000000012''::uuid])'),
  'P0001',
  'A needs-review document is selectable only with observation coverage for its current source version.',
  'needs_review selection without current-version coverage is rejected by the RPC'
);
select is(
  (select count(*) from public.assurance_review_documents
    where review_id = '50000000-0000-4000-8000-000000000021' and document_id = '50000000-0000-4000-8000-000000000013'),
  0::bigint, 'rejected selection leaves no link rows behind'
);
select lives_ok(
  format('select public.save_assurance_evidence(''50000000-0000-4000-8000-000000000003'', ''50000000-0000-4000-8000-000000000021'', array[''50000000-0000-4000-8000-000000000011''::uuid], array[''50000000-0000-4000-8000-000000000012''::uuid])'),
  'needs_review with current-version coverage is selectable'
);

-- Role denial: a sponsor cannot select evidence.
select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-8000-000000000006","role":"authenticated"}', true);
select throws_ok(
  format('select public.save_assurance_evidence(''50000000-0000-4000-8000-000000000003'', ''50000000-0000-4000-8000-000000000021'', array[''50000000-0000-4000-8000-000000000011''::uuid], array[''50000000-0000-4000-8000-000000000012''::uuid])'),
  'P0001',
  'Your project role cannot manage an assurance review.',
  'sponsor cannot save review evidence'
);
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- Cross-project membership is not authorization: the reviewer belongs to
-- project ...004 but the observation lives in project ...003.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  format('select public.save_assurance_observation_decision(''50000000-0000-4000-8000-000000000004'', ''50000000-0000-4000-8000-000000000011''::uuid, repeat(''d'', 64), ''accepted'', ''cross-project attempt'', null)'),
  'P0001',
  'Observation is not current evidence in this project.',
  'an observation of another project cannot be decided through a project the reviewer belongs to'
);

-- ---------------------------------------------------------------------------
-- Decision validation and staleness
-- ---------------------------------------------------------------------------
select throws_ok(
  format('select public.save_assurance_observation_decision(''50000000-0000-4000-8000-000000000003'', (select id from public.assurance_observations where project_id = ''50000000-0000-4000-8000-000000000003'' and domain = ''progress'' limit 1), repeat(''0'', 64), ''accepted'', ''ok'', null)'),
  'P0001',
  'The observation changed since it was displayed. Refresh and review the current version.',
  'a stale displayed fingerprint is rejected'
);
select throws_ok(
  format('select public.save_assurance_observation_decision(''50000000-0000-4000-8000-000000000003'', (select id from public.assurance_observations where project_id = ''50000000-0000-4000-8000-000000000003'' and domain = ''progress'' limit 1), (select observation_fingerprint from public.assurance_observations where project_id = ''50000000-0000-4000-8000-000000000003'' and domain = ''progress'' limit 1), ''corrected'', ''no value'', null::numeric)'),
  'P0001',
  'A corrected progress percentage between 0 and 100 is required.',
  'a correction without a value is rejected'
);
select throws_ok(
  format('select public.save_assurance_observation_decision(''50000000-0000-4000-8000-000000000003'', (select id from public.assurance_observations where project_id = ''50000000-0000-4000-8000-000000000003'' and domain = ''progress'' limit 1), (select observation_fingerprint from public.assurance_observations where project_id = ''50000000-0000-4000-8000-000000000003'' and domain = ''progress'' limit 1), ''corrected'', ''too high'', 140::numeric)'),
  'P0001',
  'A corrected progress percentage between 0 and 100 is required.',
  'a correction above 100 is rejected'
);
select throws_ok(
  format('select public.save_assurance_observation_decision(''50000000-0000-4000-8000-000000000003'', (select id from public.assurance_observations where project_id = ''50000000-0000-4000-8000-000000000003'' and observation_type = ''milestone'' limit 1), (select observation_fingerprint from public.assurance_observations where project_id = ''50000000-0000-4000-8000-000000000003'' and observation_type = ''milestone'' limit 1), ''corrected'', ''not progress'', 30::numeric)'),
  'P0001',
  'Only progress observations support a corrected value here.',
  'a milestone cannot be value-corrected'
);

select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-8000-000000000006","role":"authenticated"}', true);
select throws_ok(
  format('select public.save_assurance_observation_decision(''50000000-0000-4000-8000-000000000003'', (select id from public.assurance_observations where project_id = ''50000000-0000-4000-8000-000000000003'' and domain = ''progress'' limit 1), (select observation_fingerprint from public.assurance_observations where project_id = ''50000000-0000-4000-8000-000000000003'' and domain = ''progress'' limit 1), ''accepted'', ''sponsor attempt'', null)'),
  'P0001',
  'Your project role cannot review assurance evidence.',
  'sponsor cannot review observations'
);

-- The pmo_reviewer decides with the fingerprint the UI displays.
select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  format('select public.save_assurance_observation_decision(''50000000-0000-4000-8000-000000000003'', (select id from public.assurance_observations where project_id = ''50000000-0000-4000-8000-000000000003'' and domain = ''progress'' limit 1), (select observation_fingerprint from public.assurance_observations where project_id = ''50000000-0000-4000-8000-000000000003'' and domain = ''progress'' limit 1), ''accepted'', ''Nilai 12,5 persen terbaca jelas dari sel D7.'', null)'),
  'pmo_reviewer accepts a supported observation with its displayed fingerprint'
);

-- Original observation values are immutable.
select is(
  (select observation->>'percent' from public.assurance_observations where domain = 'progress' limit 1),
  '12.5', 'accepted observation keeps its original extracted percent'
);
select is(
  (select count(*) from public.audit_events where event_type = 'assurance_observation_reviewed'),
  1::bigint, 'the decision is audited with before/after states'
);

-- ---------------------------------------------------------------------------
-- Correction replaces the decision; rejection of the milestone observation
-- ---------------------------------------------------------------------------
select lives_ok(
  format('select public.save_assurance_observation_decision(''50000000-0000-4000-8000-000000000003'', (select id from public.assurance_observations where project_id = ''50000000-0000-4000-8000-000000000003'' and domain = ''progress'' limit 1), (select observation_fingerprint from public.assurance_observations where project_id = ''50000000-0000-4000-8000-000000000003'' and domain = ''progress'' limit 1), ''corrected'', ''Sel D7 terbaca 13,5 setelah konfirmasi lapangan.'', 13.5::numeric)'),
  're-deciding the same observation replaces the decision with a correction'
);
select is(
  (select decision from public.assurance_observation_decisions where observation_fingerprint = (select observation_fingerprint from public.assurance_observations where project_id = '50000000-0000-4000-8000-000000000003' and domain = 'progress' limit 1)),
  'corrected', 'the replacement decision is a correction'
);
select is(
  (select corrected_observation->>'percent' from public.assurance_observation_decisions where observation_fingerprint = (select observation_fingerprint from public.assurance_observations where project_id = '50000000-0000-4000-8000-000000000003' and domain = 'progress' limit 1)),
  '13.5', 'the correction stores its own corrected value'
);
select is(
  (select count(*) from public.assurance_observation_decisions),
  1::bigint, 'one decision row per observation fingerprint'
);
select is(
  (select observation->>'percent' from public.assurance_observations where domain = 'progress' limit 1),
  '12.5', 'correction never rewrites the stored observation'
);
select lives_ok(
  format('select public.save_assurance_observation_decision(''50000000-0000-4000-8000-000000000003'', (select id from public.assurance_observations where project_id = ''50000000-0000-4000-8000-000000000003'' and observation_type = ''milestone'' limit 1), (select observation_fingerprint from public.assurance_observations where project_id = ''50000000-0000-4000-8000-000000000003'' and observation_type = ''milestone'' limit 1), ''rejected'', ''Tanggal tidak didukung konteks baris.'', null)'),
  'reviewer rejects an unsupported milestone observation'
);

-- ---------------------------------------------------------------------------
-- Decisions enter the source fingerprint and go stale when changed
-- ---------------------------------------------------------------------------
select is(pg_temp.decision_count()::int, 2, 'both decisions appear in the snapshot');
select is(pg_temp.review_fingerprint(), pg_temp.review_fingerprint(),
  'the snapshot fingerprint is stable across reads without changes');
select ok(pg_temp.review_fingerprint() is not null, 'the review fingerprint is computable');

select lives_ok(
  format('select public.save_assurance_observation_decision(''50000000-0000-4000-8000-000000000003'', (select id from public.assurance_observations where project_id = ''50000000-0000-4000-8000-000000000003'' and domain = ''progress'' limit 1), (select observation_fingerprint from public.assurance_observations where project_id = ''50000000-0000-4000-8000-000000000003'' and domain = ''progress'' limit 1), ''rejected'', ''Koreksi ditarik; nilai tidak didukung.'', null)'),
  'a decision can be changed later with a new reason'
);
select is(pg_temp.decision_count()::int, 2, 'one decision per observation after re-decision');

-- Stale source version: re-extraction under a new parser version orphans the
-- old decisions. They stay stored for audit but leave the snapshot (consumers
-- stop applying them) and no longer match any current observation.
select is(
  (select count(*) from public.assurance_observations o
    join public.assurance_observation_decisions d
      on d.document_id = o.document_id
      and d.observation_fingerprint = o.observation_fingerprint
      and d.source_content_hash = o.source_content_hash
      and d.parser_version = o.parser_version
      and d.contract_version = o.contract_version),
  2::bigint, 'both decisions currently match a stored observation'
);

update public.documents
set content_hash = repeat('e', 64), assurance_observation_parser_version = 'document-parser/7'
where id = '50000000-0000-4000-8000-000000000011';

select is(pg_temp.decision_count()::int, 0, 'decisions on a superseded source version leave the snapshot');
select is(
  (select count(*) from public.assurance_observation_decisions),
  2::bigint, 'orphaned decisions remain stored for audit'
);
select is(
  (select count(*) from public.assurance_observations o
    join public.assurance_observation_decisions d
      on d.project_id = o.project_id and d.document_id = o.document_id
      and d.observation_fingerprint = o.observation_fingerprint
      and d.source_content_hash = o.source_content_hash
      and d.parser_version = o.parser_version
      and d.contract_version = o.contract_version
    join public.documents doc on doc.id = o.document_id
      and doc.content_hash = o.source_content_hash
      and doc.assurance_observation_parser_version = o.parser_version
      and doc.assurance_observation_contract_version = o.contract_version),
  0::bigint, 'no orphaned decision matches a current observation of the document current version'
);

-- The stale needs_review document loses its selectability: its declared current
-- version has no coverage rows.
select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-8000-000000000005","role":"authenticated"}', true);
select throws_ok(
  format('select public.save_assurance_evidence(''50000000-0000-4000-8000-000000000003'', ''50000000-0000-4000-8000-000000000021'', array[''50000000-0000-4000-8000-000000000011''::uuid], array[''50000000-0000-4000-8000-000000000012''::uuid])'),
  'P0001',
  'A needs-review document is selectable only with observation coverage for its current source version.',
  'stale needs_review document loses its selectability'
);

select set_config('request.jwt.claims', '', true);
select * from extensions.finish();
rollback;
