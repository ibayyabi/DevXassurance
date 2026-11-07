-- Fix a lock-ordering cycle between reference invalidation and claim/read paths.
-- invalidate_assurance_prior_risk_change takes the project row FOR UPDATE while
-- a concurrent lock_assurance_review holds the project FOR SHARE and waits on the
-- review row lock the writer already holds, so a chunk update inside that window
-- deadlocked and was cancelled. The existence check needs no lock: the review row
-- lock remains the fence, and project-level writers keep their own FOR UPDATE.
create or replace function public.lock_assurance_review(p_project_id uuid, p_review_id uuid)
returns public.assurance_reviews
language plpgsql security definer set search_path = '' as $$
declare r public.assurance_reviews;
begin
  if auth.uid() is null or not exists (
    select 1 from public.project_members where project_id = p_project_id
      and user_id = auth.uid() and role in ('admin', 'pmc_consultant', 'project_manager')
  ) then raise exception 'Your project role cannot manage an assurance review.'; end if;
  select * into r from public.assurance_reviews
    where id = p_review_id and project_id = p_project_id for update;
  if not found then raise exception 'Assurance review was not found in this project.'; end if;
  perform 1 from public.projects where id = p_project_id;
  if not found then raise exception 'Project was not found.'; end if;
  return r;
end;
$$;
revoke all on function public.lock_assurance_review(uuid, uuid) from public, anon, authenticated;
grant execute on function public.lock_assurance_review(uuid, uuid) to authenticated;
