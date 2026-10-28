-- Ticket 02: a WBS cost observation must never be silently replaced by another
-- work package's row. Ticket 01's uniqueness key omitted scope_label, so two
-- WBS rows differing only by work package (same measure, scope_level, chunk,
-- and source value) collided and the upsert dropped one. The aggregation dedupe
-- already keys on scope_label, so the database must key on it too.
--
-- A plain unique constraint over scope_label would treat NULL labels as
-- distinct and permit duplicate project-scope rows (which carry a NULL label),
-- so the uniqueness is expressed over coalesce(scope_label, ''), matching the
-- existing cost_baselines_active_scope_idx pattern.

-- Drop the old scope-label-blind unique constraint, whatever its generated name.
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.cost_observations'::regclass
      and contype = 'u'
  loop
    execute format('alter table public.cost_observations drop constraint %I', constraint_name);
  end loop;
end $$;

create unique index cost_observations_scope_identity_idx
  on public.cost_observations (
    document_id,
    measure,
    scope_level,
    evidence_chunk_index,
    source_value,
    coalesce(scope_label, '')
  );
