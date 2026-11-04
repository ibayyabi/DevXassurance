-- The worker validates source-reported statuses and record dates before
-- completion. Keep a review-needed result neutral, preserve its validated
-- source text, and never let the legacy RPC invent a dashboard date.
alter function public.complete_document_job(uuid, uuid, jsonb)
  rename to complete_document_job_unfiltered_health;
revoke all on function public.complete_document_job_unfiltered_health(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

create function public.complete_document_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_result jsonb := p_result;
  safe_snapshots jsonb := '[]'::jsonb;
  snapshot jsonb;
begin
  if jsonb_typeof(p_result) = 'object'
    and jsonb_typeof(p_result->'health_snapshots') = 'array' then
    for snapshot in select value from jsonb_array_elements(p_result->'health_snapshots')
    loop
      -- A health snapshot without a source-validated reporting date is not a
      -- dated dashboard observation. Do not substitute a document hint or the
      -- current date in the legacy publisher.
      if nullif(snapshot->>'snapshot_date', '') is null then
        continue;
      end if;

      -- Scores and coverage are not calculated from these source reports. A
      -- needs_review result keeps only its literal status text, not a promoted
      -- model status; the text remains available as a source-reported claim.
      snapshot := jsonb_set(snapshot, '{score}', 'null'::jsonb, true);
      snapshot := jsonb_set(snapshot, '{evidence_coverage}', 'null'::jsonb, true);
      if p_result->>'processing_status' = 'needs_review' then
        snapshot := jsonb_set(snapshot, '{status}', '"insufficient_evidence"'::jsonb, true);
      end if;
      safe_snapshots := safe_snapshots || jsonb_build_array(snapshot);
    end loop;
    safe_result := jsonb_set(safe_result, '{health_snapshots}', safe_snapshots, true);
  end if;

  return public.complete_document_job_unfiltered_health(p_job_id, p_claim_token, safe_result);
end;
$$;
revoke all on function public.complete_document_job(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_document_job(uuid, uuid, jsonb) to service_role;
