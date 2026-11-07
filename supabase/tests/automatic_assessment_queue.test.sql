-- Behavior tests for migration 202611050008 (automatic assessment queue).
-- Runs inside one transaction that always rolls back. Requires pgTAP.
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/automatic_assessment_queue.test.sql
--
-- Covers: durable signal inside the final publication transaction, cut-off
-- provenance (never upload date/file name/maximum date), role/period
-- confirmation as the only eligibility, needs_review partial evidence, gaps
-- per domain instead of a cross-domain blank, queue coalescing with a
-- monotonic generation, fenced claims, project isolation, evidence-change
-- requeue, stale-token rejection, recovery/retry limits, stale marking of a
-- published snapshot, and the member-only read surface.

begin;
select plan(47);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, created_at, updated_at)
values
  ('80000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'auto-assess@example.invalid', '', now(), '{}'::jsonb, now(), now()),
  ('80000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'auto-outsider@example.invalid', '', now(), '{}'::jsonb, now(), now())
on conflict (id) do nothing;
insert into public.profiles (id, full_name)
values
  ('80000000-0000-4000-8000-000000000001', 'Automatic assessor'),
  ('80000000-0000-4000-8000-000000000009', 'Unrelated user')
on conflict (id) do nothing;
insert into public.organizations (id, name)
values ('80000000-0000-4000-8000-000000000002', 'Automatic assessment org')
on conflict (id) do nothing;
insert into public.projects (id, organization_id, name)
values
  ('80000000-0000-4000-8000-000000000003', '80000000-0000-4000-8000-000000000002', 'Automatic assessment project'),
  ('80000000-0000-4000-8000-000000000004', '80000000-0000-4000-8000-000000000002', 'Isolated project')
on conflict (id) do nothing;
insert into public.project_members (project_id, user_id, role)
values ('80000000-0000-4000-8000-000000000003', '80000000-0000-4000-8000-000000000001', 'project_manager')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Published evidence with reviewer-confirmed role and reporting period
-- ---------------------------------------------------------------------------
insert into public.documents (
  id, project_id, uploader_id, document_type, title, file_name, file_size, mime_type,
  storage_path, processing_status, content_hash, assurance_observation_parser_version,
  assurance_observation_contract_version, confirmed_evidence_role, confirmed_reporting_period
) values
  ('80000000-0000-4000-8000-000000000010', '80000000-0000-4000-8000-000000000003',
   '80000000-0000-4000-8000-000000000001', 'progress_report', 'Approved baseline', 'baseline.pdf',
   10, 'application/pdf', '80000000-0000-4000-8000-000000000003/baseline.pdf', 'completed',
   repeat('a', 64), 'xass/1', 'pmo-assurance-observations/1', 'baseline', '2026-01-31'),
  ('80000000-0000-4000-8000-000000000011', '80000000-0000-4000-8000-000000000003',
   '80000000-0000-4000-8000-000000000001', 'progress_report', 'Week 2 report', 'w2.pdf',
   10, 'application/pdf', '80000000-0000-4000-8000-000000000003/w2.pdf', 'completed',
   repeat('b', 64), 'xass/1', 'pmo-assurance-observations/1', 'current', '2026-02-28'),
  -- needs_review with validated coverage contributes valid partial evidence.
  ('80000000-0000-4000-8000-000000000012', '80000000-0000-4000-8000-000000000003',
   '80000000-0000-4000-8000-000000000001', 'mom', 'Week 2 minutes', 'w2-mom.pdf',
   10, 'application/pdf', '80000000-0000-4000-8000-000000000003/w2-mom.pdf', 'needs_review',
   repeat('c', 64), 'xass/1', 'pmo-assurance-observations/1', 'current', '2026-02-28'),
  -- needs_review without coverage: published text, but not eligible evidence.
  ('80000000-0000-4000-8000-000000000013', '80000000-0000-4000-8000-000000000003',
   '80000000-0000-4000-8000-000000000001', 'progress_report', 'Unevaluated report', 'w1.pdf',
   10, 'application/pdf', '80000000-0000-4000-8000-000000000003/w1.pdf', 'needs_review',
   repeat('d', 64), 'xass/1', 'pmo-assurance-observations/1', 'current', '2026-02-15'),
  -- Published, but no confirmed period or role: never a cut-off of its own.
  ('80000000-0000-4000-8000-000000000014', '80000000-0000-4000-8000-000000000003',
   '80000000-0000-4000-8000-000000000001', 'progress_report', 'Unconfirmed report', 'x.pdf',
   10, 'application/pdf', '80000000-0000-4000-8000-000000000003/x.pdf', 'completed',
   repeat('e', 64), 'xass/1', 'pmo-assurance-observations/1', null, null),
  ('80000000-0000-4000-8000-000000000020', '80000000-0000-4000-8000-000000000004',
   '80000000-0000-4000-8000-000000000001', 'progress_report', 'Isolated report', 'iso.pdf',
   10, 'application/pdf', '80000000-0000-4000-8000-000000000004/iso.pdf', 'completed',
   repeat('f', 64), 'xass/1', 'pmo-assurance-observations/1', 'current', '2026-02-28');

insert into public.assurance_observations (
  id, project_id, document_id, source_content_hash, parser_version, contract_version,
  domain, observation_type, observation, evidence_chunk_index, excerpt
) values
  ('80000000-0000-4000-8000-000000000031', '80000000-0000-4000-8000-000000000003',
   '80000000-0000-4000-8000-000000000010', repeat('a', 64), 'xass/1', 'pmo-assurance-observations/1',
   'schedule', 'milestone',
   '{"label": "Foundation complete", "date": "2026-02-14", "scope_level": "project", "period_label": "Baseline"}',
   0, 'Foundation complete by 2026-02-14'),
  ('80000000-0000-4000-8000-000000000032', '80000000-0000-4000-8000-000000000003',
   '80000000-0000-4000-8000-000000000011', repeat('b', 64), 'xass/1', 'pmo-assurance-observations/1',
   'schedule', 'milestone',
   '{"label": "Foundation complete", "date": "2026-02-21", "scope_level": "project", "period_label": "W2"}',
   0, 'Foundation complete by 2026-02-21'),
  ('80000000-0000-4000-8000-000000000033', '80000000-0000-4000-8000-000000000003',
   '80000000-0000-4000-8000-000000000011', repeat('b', 64), 'xass/1', 'pmo-assurance-observations/1',
   'progress', 'progress',
   '{"scope_level": "project", "percent": 18, "measure_kind": "actual", "period_label": "W2", "as_of_date": "2026-02-28"}',
   1, 'Actual progress 18% at W2'),
  ('80000000-0000-4000-8000-000000000034', '80000000-0000-4000-8000-000000000003',
   '80000000-0000-4000-8000-000000000011', repeat('b', 64), 'xass/1', 'pmo-assurance-observations/1',
   'risk', 'risk_snapshot',
   '{"risk_id": "R-1", "name": "Supplier delay", "status": "open", "rating_label": "High", "rating_value": 4, "scale_label": "3x3", "as_of_date": "2026-02-28"}',
   2, 'R-1 Supplier delay rated High'),
  ('80000000-0000-4000-8000-000000000035', '80000000-0000-4000-8000-000000000003',
   '80000000-0000-4000-8000-000000000012', repeat('c', 64), 'xass/1', 'pmo-assurance-observations/1',
   'progress', 'progress',
   '{"scope_level": "project", "percent": 20, "measure_kind": "actual", "period_label": "W2", "as_of_date": "2026-02-28"}',
   0, 'Actual progress 20% at W2'),
  ('80000000-0000-4000-8000-000000000036', '80000000-0000-4000-8000-000000000003',
   '80000000-0000-4000-8000-000000000013', repeat('d', 64), 'xass/1', 'pmo-assurance-observations/1',
   'progress', 'progress',
   '{"scope_level": "project", "percent": 12, "measure_kind": "actual", "period_label": "W1"}',
   0, 'Actual progress 12% at W1'),
  ('80000000-0000-4000-8000-000000000037', '80000000-0000-4000-8000-000000000003',
   '80000000-0000-4000-8000-000000000014', repeat('e', 64), 'xass/1', 'pmo-assurance-observations/1',
   'progress', 'progress',
   '{"scope_level": "project", "percent": 9, "measure_kind": "actual"}',
   0, 'Actual progress 9%'),
  ('80000000-0000-4000-8000-000000000038', '80000000-0000-4000-8000-000000000004',
   '80000000-0000-4000-8000-000000000020', repeat('f', 64), 'xass/1', 'pmo-assurance-observations/1',
   'progress', 'progress',
   '{"scope_level": "project", "percent": 30, "measure_kind": "actual", "period_label": "W2"}',
   0, 'Actual progress 30% at W2');

insert into public.assurance_observation_coverage (
  project_id, document_id, source_content_hash, parser_version, contract_version,
  domain, state, total_groups, processed_groups
)
select d.project_id, d.id, d.content_hash, d.assurance_observation_parser_version,
  d.assurance_observation_contract_version, domain.name,
  case when d.id = '80000000-0000-4000-8000-000000000011' and domain.name = 'risk'
    then 'unprocessed' else 'processed' end,
  2, case when d.id = '80000000-0000-4000-8000-000000000011' and domain.name = 'risk'
    then 1 else 2 end
from public.documents d
cross join (values ('budget'), ('schedule'), ('progress'), ('risk')) domain(name)
where d.id in (
  '80000000-0000-4000-8000-000000000010', '80000000-0000-4000-8000-000000000011',
  '80000000-0000-4000-8000-000000000012');

-- ---------------------------------------------------------------------------
-- Eligibility: confirmed role + confirmed period, newest period per role
-- ---------------------------------------------------------------------------
select is(
  (select jsonb_array_length(public.assurance_assessment_evidence(
    '80000000-0000-4000-8000-000000000003', '2026-02-28') -> 'sources')),
  3, 'the newest confirmed period per role is selected, including needs_review with coverage');

select is(
  (select count(*)::integer from jsonb_array_elements(
    public.assurance_assessment_evidence('80000000-0000-4000-8000-000000000003', '2026-02-28') -> 'sources') source
   where source->>'role' = 'current'),
  2, 'both current-role documents at the newest period are current sources');

select is(
  (select jsonb_array_length(public.assurance_assessment_evidence(
    '80000000-0000-4000-8000-000000000003', '2026-01-31') -> 'sources')),
  1, 'an earlier cut-off selects only the evidence published by then');

select ok(
  (select (public.assurance_assessment_evidence(
    '80000000-0000-4000-8000-000000000003', '2026-02-28') ->> 'fingerprint') ~ '^[0-9a-f]{64}$'),
  'the source fingerprint is a content hash');

select ok(
  (select exists (
    select 1 from jsonb_array_elements(
      public.assurance_assessment_evidence('80000000-0000-4000-8000-000000000003', '2026-02-28') -> 'gaps') gap
    where gap->>'reason' = 'reporting_period_not_confirmed')),
  'a published document without a confirmed reporting period is a gap, not a cut-off');

select ok(
  (select exists (
    select 1 from jsonb_array_elements(
      public.assurance_assessment_evidence('80000000-0000-4000-8000-000000000003', '2026-02-28') -> 'gaps') gap
    where gap->>'reason' = 'requires_review_without_current_coverage')),
  'needs_review without current coverage is a gap');

select ok(
  (select exists (
    select 1 from jsonb_array_elements(
      public.assurance_assessment_evidence('80000000-0000-4000-8000-000000000003', '2026-01-31') -> 'gaps') gap
    where gap->>'reason' = 'current_evidence_not_confirmed')),
  'a cut-off without current evidence records the missing role instead of blanking the domain');

-- ---------------------------------------------------------------------------
-- Coalescing and signals
-- ---------------------------------------------------------------------------
select is(
  public.enqueue_assurance_assessment('80000000-0000-4000-8000-000000000003', '2026-02-28', 'publication'),
  1::bigint, 'the first request creates the queue row at generation 1');

select is(
  public.enqueue_assurance_assessment('80000000-0000-4000-8000-000000000003', '2026-02-28', 'publication'),
  2::bigint, 'a repeated request bumps the generation instead of dropping the update');

select is(
  (select count(*) from public.assurance_assessment_jobs
   where project_id = '80000000-0000-4000-8000-000000000003' and cutoff = '2026-02-28'),
  1::bigint, 'coalescing keeps exactly one queue row per project and cut-off');

select is(
  (select status from public.assurance_assessment_jobs
   where project_id = '80000000-0000-4000-8000-000000000003' and cutoff = '2026-02-28'),
  'queued', 'a coalesced request leaves the job queued');

select is(
  public.signal_assurance_assessment_for_document(
    '80000000-0000-4000-8000-000000000003', '80000000-0000-4000-8000-000000000014', 'document_publication'),
  0, 'publication of a document without a confirmed period queues nothing');

select is(
  public.signal_assurance_assessment_from(
    '80000000-0000-4000-8000-000000000003', '2026-01-31', 'backfill'),
  3, 'a backfill re-derives its own cut-off and every later known cut-off');

select ok(
  (select generation > 2 from public.assurance_assessment_jobs
   where project_id = '80000000-0000-4000-8000-000000000003' and cutoff = '2026-02-28'),
  'a later signal keeps raising the generation of an affected cut-off');

select is(
  public.enqueue_assurance_assessment('80000000-0000-4000-8000-000000000004', '2026-02-28', 'publication'),
  1::bigint, 'a second project has its own independent queue row');

update public.assurance_assessment_jobs set max_attempts = 10
where project_id in ('80000000-0000-4000-8000-000000000003', '80000000-0000-4000-8000-000000000004');
-- Make claim order explicit: every cut-off except the one under test waits.
update public.assurance_assessment_jobs set available_at = now() + interval '1 hour'
where project_id = '80000000-0000-4000-8000-000000000003' and cutoff <> '2026-02-28';
update public.assurance_assessment_jobs set available_at = now()
where project_id = '80000000-0000-4000-8000-000000000003' and cutoff = '2026-02-28';
update public.assurance_assessment_jobs set available_at = now() + interval '2 hours'
where project_id = '80000000-0000-4000-8000-000000000004';

-- ---------------------------------------------------------------------------
-- Fenced claim and project isolation
-- ---------------------------------------------------------------------------
select is(
  (select (public.claim_next_assurance_assessment_job('pg-tap'))->>'project_id'),
  '80000000-0000-4000-8000-000000000003', 'the oldest eligible job is claimed first');

select is(
  (select count(*) from public.assurance_assessment_jobs
   where project_id = '80000000-0000-4000-8000-000000000003' and status = 'processing'),
  1::bigint, 'claiming leaves exactly one processing attempt per project');

select ok(
  (select public.claim_next_assurance_assessment_job('pg-tap')) is null,
  'a project with an in-flight assessment is never claimed twice at once');

update public.assurance_assessment_jobs set available_at = now()
where project_id = '80000000-0000-4000-8000-000000000004';

select is(
  (select (public.claim_next_assurance_assessment_job('pg-tap'))->>'project_id'),
  '80000000-0000-4000-8000-000000000004', 'another project is assessed independently');

select ok(
  (select claimed_fingerprint ~ '^[0-9a-f]{64}$' from public.assurance_assessment_jobs
   where project_id = '80000000-0000-4000-8000-000000000003' and status = 'processing'),
  'the claim records the evidence fingerprint it assessed');

select ok(
  (select claimed_reference_fingerprint ~ '^[0-9a-f]{64}$' from public.assurance_assessment_jobs
   where project_id = '80000000-0000-4000-8000-000000000003' and status = 'processing'),
  'the claim records the reference fingerprint it assessed');

-- ---------------------------------------------------------------------------
-- Publication fencing: generation, evidence, and stale tokens
-- ---------------------------------------------------------------------------
select is(
  public.enqueue_assurance_assessment('80000000-0000-4000-8000-000000000003', '2026-02-28', 'observation_decision'),
  4::bigint, 'an update during a run raises the generation of the in-flight cut-off');

select is(
  public.publish_assurance_assessment_snapshot(
    (select id from public.assurance_assessment_jobs
     where project_id = '80000000-0000-4000-8000-000000000003' and status = 'processing'),
    (select claim_token from public.assurance_assessment_jobs
     where project_id = '80000000-0000-4000-8000-000000000003' and status = 'processing'),
    3::bigint,
    '[{"domain":"budget"},{"domain":"schedule"},{"domain":"risk"}]'::jsonb) ->> 'status',
  'requeued', 'a run whose input changed while computing republishes instead of publishing');

select is(
  (select status from public.assurance_assessment_jobs
   where project_id = '80000000-0000-4000-8000-000000000003' and cutoff = '2026-02-28'),
  'queued', 'the requeued job stays queued so the newer input is assessed');

select is(
  (select (public.claim_next_assurance_assessment_job('pg-tap'))->>'cutoff'),
  '2026-02-28', 'the requeued cut-off is claimed again immediately');

select is(
  public.publish_assurance_assessment_snapshot(
    (select id from public.assurance_assessment_jobs
     where project_id = '80000000-0000-4000-8000-000000000003' and status = 'processing'),
    (select claim_token from public.assurance_assessment_jobs
     where project_id = '80000000-0000-4000-8000-000000000003' and status = 'processing'),
    4::bigint,
    '[{"domain":"budget","condition":"needs_attention"},{"domain":"schedule","condition":"needs_attention"},{"domain":"risk","condition":"more_evidence_required"}]'::jsonb,
    '[{"domain":"budget","title":"Confirm the reported EITC"}]'::jsonb,
    '{"coverage":{"byRole":{"current":{"risk":{"state":"unprocessed"}}}}}'::jsonb) ->> 'snapshot_status',
  'partial', 'incomplete coverage and gaps are published as a partial snapshot');

select is(
  (select count(*)::integer from public.assurance_assessment_snapshots
   where project_id = '80000000-0000-4000-8000-000000000003' and cutoff = '2026-02-28'
     and superseded_at is null),
  1, 'exactly one live snapshot exists per cut-off');

select is(
  (select status from public.assurance_assessment_jobs
   where project_id = '80000000-0000-4000-8000-000000000003' and cutoff = '2026-02-28'),
  'succeeded', 'a published generation marks the job succeeded');

select is(
  (select jsonb_array_length(source_versions) from public.assurance_assessment_snapshots
   where project_id = '80000000-0000-4000-8000-000000000003' and cutoff = '2026-02-28'
     and superseded_at is null),
  3, 'the snapshot carries the exact source versions it assessed');

select is(
  (select jsonb_array_length(evidence_gaps) > 0 from public.assurance_assessment_snapshots
   where project_id = '80000000-0000-4000-8000-000000000003' and cutoff = '2026-02-28'
     and superseded_at is null),
  true, 'evidence gaps are published with the snapshot');

select is(
  public.enqueue_assurance_assessment('80000000-0000-4000-8000-000000000003', '2026-02-28', 'document_confirmation'),
  5::bigint, 'a new confirmation request bumps the generation of the live cut-off');

select is(
  (select status from public.assurance_assessment_snapshots
   where project_id = '80000000-0000-4000-8000-000000000003' and cutoff = '2026-02-28'
     and superseded_at is null),
  'stale', 'a published snapshot is marked stale when its input changes, never rewritten');

-- ---------------------------------------------------------------------------
-- Evidence change during a run, retry backoff, and recovery
-- ---------------------------------------------------------------------------
select is(
  (select (public.claim_next_assurance_assessment_job('pg-tap'))->>'cutoff'),
  '2026-02-28', 'the changed cut-off is claimed for re-derivation');

insert into public.assurance_observations (
  id, project_id, document_id, source_content_hash, parser_version, contract_version,
  domain, observation_type, observation, evidence_chunk_index, excerpt
) values (
  '80000000-0000-4000-8000-000000000039', '80000000-0000-4000-8000-000000000003',
  '80000000-0000-4000-8000-000000000011', repeat('b', 64), 'xass/1', 'pmo-assurance-observations/1',
  'risk', 'risk_register_statement',
  '{"state": "no_open_high_or_critical", "period_label": "W2", "as_of_date": "2026-02-28"}',
  3, 'No open high or critical risks');

select is(
  public.publish_assurance_assessment_snapshot(
    (select id from public.assurance_assessment_jobs
     where project_id = '80000000-0000-4000-8000-000000000003' and status = 'processing'),
    (select claim_token from public.assurance_assessment_jobs
     where project_id = '80000000-0000-4000-8000-000000000003' and status = 'processing'),
    5::bigint,
    '[{"domain":"budget"},{"domain":"schedule"},{"domain":"risk"}]'::jsonb) ->> 'reason',
  'evidence_changed', 'evidence that changed during a run requeues instead of publishing');

select throws_ok(
  format('select public.publish_assurance_assessment_snapshot(%L::uuid, ''80000000-0000-4000-8000-0000000000ff''::uuid, 5::bigint, ''[{"domain":"budget"},{"domain":"schedule"},{"domain":"risk"}]''::jsonb)',
    (select id from public.assurance_assessment_jobs
     where project_id = '80000000-0000-4000-8000-000000000003' and cutoff = '2026-02-28')),
  'P0001',
  'Assessment publication rejected: this attempt lost ownership of the job.',
  'a stale token cannot publish');

select is(
  (select (public.claim_next_assurance_assessment_job('pg-tap'))->>'cutoff'),
  '2026-02-28', 'the requeued job is claimable again after the evidence change');

select is(
  public.fail_assurance_assessment_job(
    (select id from public.assurance_assessment_jobs
     where project_id = '80000000-0000-4000-8000-000000000003' and status = 'processing'),
    (select claim_token from public.assurance_assessment_jobs
     where project_id = '80000000-0000-4000-8000-000000000003' and status = 'processing'),
    'worker failed', true) ->> 'status',
  'retry_scheduled', 'a retryable failure requeues with backoff while the lease is held');

select ok(
  (select status = 'queued' and available_at > now() and last_error = 'worker failed'
   from public.assurance_assessment_jobs
   where project_id = '80000000-0000-4000-8000-000000000003' and cutoff = '2026-02-28'),
  'the retry keeps the error, the backoff, and the queued work');

update public.assurance_assessment_jobs set available_at = now()
where project_id = '80000000-0000-4000-8000-000000000003' and cutoff = '2026-01-31';

select is(
  (select public.claim_next_assurance_assessment_job('pg-tap'))->>'cutoff',
  '2026-01-31',
  'a backed-off cut-off does not block another cut-off of the same project');

-- ---------------------------------------------------------------------------
-- Recovery of an expired lease
-- ---------------------------------------------------------------------------
update public.assurance_assessment_jobs
set lease_expires_at = now() - interval '1 minute'
where project_id = '80000000-0000-4000-8000-000000000003' and status = 'processing';

select ok(
  public.recover_expired_assurance_assessment_jobs() >= 1,
  'expired assessment leases are recovered without a user or a provider');

-- ---------------------------------------------------------------------------
-- Durable signal inside the final publication transaction
-- ---------------------------------------------------------------------------
insert into public.documents (
  id, project_id, uploader_id, document_type, title, file_name, file_size, mime_type,
  storage_path, processing_status, content_hash, assurance_observation_parser_version,
  assurance_observation_contract_version, confirmed_evidence_role, confirmed_reporting_period
) values (
  '80000000-0000-4000-8000-000000000015', '80000000-0000-4000-8000-000000000003',
  '80000000-0000-4000-8000-000000000001', 'progress_report', 'Week 4 report', 'w4.pdf',
  10, 'application/pdf', '80000000-0000-4000-8000-000000000003/w4.pdf', 'processing',
  repeat('1', 64), 'xass/1', 'pmo-assurance-observations/1', 'current', '2026-04-30');

insert into public.ai_jobs (id, project_id, document_id, job_type, status, claim_token, lease_expires_at)
values (
  '80000000-0000-4000-8000-000000000040', '80000000-0000-4000-8000-000000000003',
  '80000000-0000-4000-8000-000000000015', 'parse_document', 'processing',
  '80000000-0000-4000-8000-0000000000aa', now() + interval '10 minutes');

select is(
  public.complete_document_job(
    '80000000-0000-4000-8000-000000000040',
    '80000000-0000-4000-8000-0000000000aa',
    '{"processing_status":"completed","facts":[],"health_snapshots":[]}'::jsonb) ->> 'status',
  'completed', 'publication still succeeds with the assessment signal in the same transaction');

select is(
  (select status from public.assurance_assessment_jobs
   where project_id = '80000000-0000-4000-8000-000000000003' and cutoff = '2026-04-30'),
  'queued', 'the final publication transaction queues the assessment for its confirmed period');

select is(
  (select enqueued from (
    select public.complete_document_job(
      '80000000-0000-4000-8000-000000000040',
      '80000000-0000-4000-8000-0000000000aa',
      '{"processing_status":"completed","facts":[],"health_snapshots":[]}'::jsonb) ->> 'status' as enqueued
  ) repeated),
  'already_completed', 'an idempotent repeat publication returns its terminal state');

select is(
  (select generation from public.assurance_assessment_jobs
   where project_id = '80000000-0000-4000-8000-000000000003' and cutoff = '2026-04-30'),
  1::bigint, 'a repeated publication does not bump the generation of its cut-off');

-- ---------------------------------------------------------------------------
-- Member-only read surface
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"80000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  (select public.get_latest_assessment_snapshot(
    '80000000-0000-4000-8000-000000000003', '2026-02-28') ->> 'status'),
  'stale', 'a member reads the live snapshot status for a cut-off');

select is(
  (select jsonb_array_length(public.get_project_assessment_periods(
    '80000000-0000-4000-8000-000000000003'))),
  4, 'period navigation lists every assessed or queued cut-off');

select set_config('request.jwt.claims',
  '{"sub":"80000000-0000-4000-8000-000000000009","role":"authenticated"}', true);
select throws_ok(
  $$select public.get_latest_assessment_snapshot('80000000-0000-4000-8000-000000000003', '2026-02-28')$$,
  'P0001', 'Project membership is required.',
  'a non-member cannot read automatic assessment results');
select set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
