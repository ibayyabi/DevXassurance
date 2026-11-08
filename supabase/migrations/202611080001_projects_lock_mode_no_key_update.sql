-- Fix deadlock (40P01) between concurrent document/storage-object inserts for
-- the same project: the FK key-share taken by the INSERT on public.projects was
-- upgraded to FOR UPDATE by these invalidation triggers, so two concurrent
-- inserts for one project deadlocked on the lock upgrade. FOR NO KEY UPDATE is
-- compatible with the FK key-share (no upgrade) while still conflicting with
-- the reference readers' FOR SHARE, preserving the invalidation/reader
-- exclusion this lock was added for (202611050003).
CREATE OR REPLACE FUNCTION public.invalidate_assurance_prior_risk_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare project_ids uuid[]; project_id uuid;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op = 'DELETE' then
    project_ids := array[old.project_id];
  elsif tg_op = 'INSERT' then
    project_ids := array[new.project_id];
  elsif old.project_id is distinct from new.project_id then
    project_ids := array[least(old.project_id, new.project_id), greatest(old.project_id, new.project_id)];
  else
    project_ids := array[new.project_id];
  end if;
  foreach project_id in array project_ids loop
    if tg_table_name <> 'assurance_reviews' or tg_op = 'INSERT' then
      perform 1 from public.projects where id = project_id for no key update;
      if not found then continue; end if;
    end if;
    if tg_table_name = 'assurance_observation_decisions' then
      -- Keep ticket 03's specific decision reason before prior-risk reference
      -- invalidation makes the same result inactive.
      perform public.invalidate_assurance_observation_results(project_id);
    end if;
    if tg_table_name = 'assurance_observation_decisions' then
      -- Ticket 03 owns invalidation for selected decisions. Ticket 05 checks
      -- only comparison references here (prior decisions/newer review), so its
      -- source-change reason cannot overwrite ticket 03's reviewer-specific one.
      perform public.invalidate_assurance_reference_results(project_id, false);
    else
      perform public.invalidate_assurance_reference_results(project_id);
    end if;
  end loop;
  return null;
end;
$function$
;


CREATE OR REPLACE FUNCTION public.invalidate_assurance_storage_object_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare project_ids uuid[]; project_id uuid;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op = 'UPDATE' and
    (to_jsonb(old) - array['last_accessed_at', 'owner', 'owner_id'])
      is not distinct from
    (to_jsonb(new) - array['last_accessed_at', 'owner', 'owner_id']) then return null; end if;
  if tg_op = 'DELETE' then
    select array_agg(distinct d.project_id order by d.project_id) into project_ids
    from public.documents d where d.storage_bucket = old.bucket_id and d.storage_path = old.name;
  elsif tg_op = 'INSERT' then
    select array_agg(distinct d.project_id order by d.project_id) into project_ids
    from public.documents d where d.storage_bucket = new.bucket_id and d.storage_path = new.name;
  else
    select array_agg(distinct d.project_id order by d.project_id) into project_ids
    from public.documents d where (d.storage_bucket = old.bucket_id and d.storage_path = old.name)
      or (d.storage_bucket = new.bucket_id and d.storage_path = new.name);
  end if;
  foreach project_id in array coalesce(project_ids, '{}'::uuid[]) loop
    perform 1 from public.projects where id = project_id for no key update;
    if found then perform public.invalidate_assurance_reference_results(project_id); end if;
  end loop;
  return null;
end;
$function$
;


