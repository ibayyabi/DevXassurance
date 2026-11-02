-- Ticket 02 (AC1): WBS cost evidence must carry the work package's stated
-- identity, not only a single scope_label. These columns hold what the source
-- states about the work package: its own code, its parent's code, its name, and
-- its stated deliverable or scope. They stay null for project-scope rows and
-- whenever the source does not state them. A canonical code is never stored
-- here: it is assigned only through a reviewer-accepted mapping (ADR 0004), so
-- the model never writes a canonical identity of its own.

alter table public.cost_observations
  add column if not exists wbs_code text
    check (wbs_code is null or length(wbs_code) between 1 and 200),
  add column if not exists wbs_parent_code text
    check (wbs_parent_code is null or length(wbs_parent_code) between 1 and 200),
  add column if not exists wbs_name text
    check (wbs_name is null or length(wbs_name) between 1 and 500),
  add column if not exists scope_description text
    check (scope_description is null or length(scope_description) between 1 and 2000);

-- A project total has a single scope, so its rows carry no work-package
-- identity; the worker drops these for project scope, and the constraint keeps
-- that true for any writer.
alter table public.cost_observations
  add constraint cost_observations_project_scope_has_no_wbs_identity
    check (
      scope_level <> 'project'
      or (wbs_code is null and wbs_parent_code is null and wbs_name is null and scope_description is null)
    );
