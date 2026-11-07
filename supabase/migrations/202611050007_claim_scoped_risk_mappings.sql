-- Ticket 05 reopen: risk mapping changes that the prior side uses must fence
-- analysis. Until now the comparator applied every accepted project mapping
-- read after claim, while the claim's reference fingerprint did not cover any
-- mapping at all. A mapping reachable only from a prior-linked document could
-- change or appear after claim (or after publication) without moving the
-- fingerprint, leaving stale results current.
--
-- Simplest consistent contract: the claim carries ALL accepted project-scoped
-- identity/scale mappings, and the comparator applies exactly that set. A
-- chunk-mention filter could omit a mapping needed by the prior snapshot;
-- it also uses different matching semantics from the comparator. Project lock
-- already serializes mapping writers (replace/remove take the project row
-- before invalidating, see replace_assurance_mapping/remove_assurance_mapping
-- and the lock order in 202611050003), so the applied set and the fence stay
-- race-free without narrowing.
-- ponytail: snapshot covers the full project mapping set, so an unrelated
-- accepted mapping change in the same project invalidates other reviews too;
-- narrow to per-review mention/linkage if that becomes measurable.
--
-- Numbering: this is one forward migration after 202611050006, the head of
-- this branch's reference-snapshot chain (202611050003 added the prior-risk
-- layer, 202611050006 the approved progress rule). It renames whatever
-- assurance_reference_snapshot currently is and rebuilds the wrapper on top of
-- it, so a fresh database and a database that already ran 003/004/006 both
-- migrate forward through one rename plus one create with no self-call. The
-- wrapping keeps the 202611030001 current-LINKED-documents fingerprint layer
-- and the rule layer intact; the fingerprint delta comes from this layer
-- alone, so any accepted mapping add/change/supersede moves it. Ticket 03
-- decision fencing and ticket 04 rule fencing are untouched.
--
-- Ordering note for reviewers: the snapshot only aggregates mapping rows (for
-- share of project, for share of mapping rows in the 003001 base layer). This
-- migration does not add row locks; serialization still comes from the project
-- lock held by writers.

alter function public.assurance_reference_snapshot(uuid, uuid)
  rename to assurance_reference_snapshot_without_claim_risk_mappings;
revoke all on function public.assurance_reference_snapshot_without_claim_risk_mappings(uuid, uuid)
  from public, anon, authenticated;

create function public.assurance_claim_risk_mappings(p_project_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  identity_mappings jsonb;
  scale_mappings jsonb;
begin
  perform 1 from public.projects where id = p_project_id for share;
  if not found then raise exception 'Project was not found.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'project_id', m.project_id, 'source_label', m.source_label,
      'canonical_label', m.canonical_label, 'state', m.state,
      'proposed_by_model', m.proposed_by_model, 'note', m.note,
      'created_by', m.created_by, 'accepted_by', m.accepted_by, 'accepted_at', m.accepted_at
    ) order by m.id), '[]'::jsonb)
    into identity_mappings
  from public.risk_identity_mappings m
  where m.project_id = p_project_id and m.state = 'accepted';
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'project_id', m.project_id, 'source_label', m.source_label,
      'canonical_label', m.canonical_label, 'state', m.state,
      'proposed_by_model', m.proposed_by_model, 'note', m.note,
      'created_by', m.created_by, 'accepted_by', m.accepted_by, 'accepted_at', m.accepted_at
    ) order by m.id), '[]'::jsonb)
    into scale_mappings
  from public.risk_scale_mappings m
  where m.project_id = p_project_id and m.state = 'accepted';

  return jsonb_build_object(
    'risk_identity_mappings', identity_mappings,
    'risk_scale_mappings', scale_mappings
  );
end;
$$;
revoke all on function public.assurance_claim_risk_mappings(uuid) from public, anon, authenticated;

create function public.assurance_reference_snapshot(p_project_id uuid, p_review_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare refs jsonb; mappings jsonb; reference_values jsonb; reference_versions jsonb;
begin
  refs := public.assurance_reference_snapshot_without_claim_risk_mappings(p_project_id, p_review_id);
  mappings := public.assurance_claim_risk_mappings(p_project_id);
  reference_values := coalesce(refs->'references', '{}'::jsonb) ||
    jsonb_build_object('risk_mappings', mappings);
  reference_versions := coalesce(refs->'versions', '{}'::jsonb) || jsonb_build_object(
    'risk_identity_mapping_ids', coalesce((select jsonb_agg(entry.value->'id' order by entry.value->>'id')
      from jsonb_array_elements(mappings->'risk_identity_mappings') as entry(value)), '[]'::jsonb),
    'risk_scale_mapping_ids', coalesce((select jsonb_agg(entry.value->'id' order by entry.value->>'id')
      from jsonb_array_elements(mappings->'risk_scale_mappings') as entry(value)), '[]'::jsonb));
  return refs || jsonb_build_object(
    'fingerprint', encode(sha256(convert_to(jsonb_build_array(refs->>'fingerprint', mappings)::text, 'UTF8')), 'hex'),
    'versions', reference_versions,
    'references', reference_values,
    'risk_mappings', mappings);
end;
$$;
revoke all on function public.assurance_reference_snapshot(uuid, uuid) from public, anon, authenticated;

-- The claim returns exactly the applied risk mappings its combined reference
-- fingerprint captured. The TypeScript comparator never reads the mapping
-- tables after claim. The progress rule and prior risk layers stay in the
-- returned payload: the wrapper above only adds to the snapshot it wraps.
create or replace function public.claim_assurance_analysis(p_project_id uuid, p_review_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.assurance_reviews; s jsonb; refs jsonb; attempt jsonb;
begin
  r := public.lock_assurance_review(p_project_id, p_review_id);
  if r.analysis_metadata->'latest_attempt'->>'outcome' = 'analyzing'
    and coalesce((r.analysis_metadata->'latest_attempt'->>'lease_until')::timestamptz, 'infinity') > clock_timestamp()
    then raise exception 'Analysis is already running for this review.'; end if;
  s := public.assurance_source_snapshot(p_project_id, p_review_id);
  refs := public.assurance_reference_snapshot(p_project_id, p_review_id);
  attempt := jsonb_build_object('id', gen_random_uuid(), 'outcome', 'analyzing',
    'started_at', clock_timestamp(), 'lease_until', clock_timestamp() + interval '15 minutes',
    'fingerprint', s->>'fingerprint', 'reference_fingerprint', refs->>'fingerprint',
    'reference_versions', refs->'versions');
  update public.assurance_reviews set status = 'analyzing', current_step = 'analysis', analysis_error = null,
    analysis_metadata = analysis_metadata || jsonb_build_object('latest_attempt', attempt,
      'selection_fingerprint', s->>'fingerprint',
      'selection_reference_fingerprint', refs->>'fingerprint',
      'selection_reference_versions', refs->'versions'), updated_at = clock_timestamp()
    where id = p_review_id and project_id = p_project_id;
  return s || jsonb_build_object('attempt_id', attempt->>'id',
    'reference_fingerprint', refs->>'fingerprint', 'reference_versions', refs->'versions',
    'progress_rag_rule', refs->'progress_rag_rule',
    'risk_mappings', refs->'risk_mappings',
    'prior_risk_snapshot', refs->'prior_risk_snapshot');
end;
$$;
revoke all on function public.claim_assurance_analysis(uuid, uuid) from public, anon;
grant execute on function public.claim_assurance_analysis(uuid, uuid) to authenticated;
