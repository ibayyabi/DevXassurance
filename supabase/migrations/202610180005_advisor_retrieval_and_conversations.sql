alter table public.document_chunks
  add column search_vector tsvector generated always as (
    to_tsvector('simple'::regconfig, coalesce(chunk_text, ''))
  ) stored;

create index document_chunks_search_vector_gin_idx
  on public.document_chunks using gin (search_vector);

alter table public.assistant_interactions
  add column conversation_id uuid;

create index assistant_interactions_conversation_scope_idx
  on public.assistant_interactions(project_id, user_id, conversation_id, created_at desc)
  where conversation_id is not null;

comment on column public.assistant_interactions.conversation_id is
  'Explicit per-project, per-user Advisor conversation scope; legacy interactions remain unscoped.';

create or replace function public.search_project_document_chunks(
  p_project_id uuid,
  p_query text,
  p_evidence_role text default null,
  p_reporting_period date default null,
  p_review_id uuid default null,
  p_limit integer default 8
)
returns table (
  chunk_id uuid,
  project_id uuid,
  document_id uuid,
  chunk_index integer,
  chunk_text text,
  page_number integer,
  section_label text,
  parser_metadata jsonb,
  document_title text,
  document_file_name text,
  confirmed_evidence_role text,
  confirmed_reporting_period date,
  review_ids uuid[],
  rank real
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $function$
  with search_query as (
    select pg_catalog.websearch_to_tsquery('simple'::pg_catalog.regconfig, coalesce(p_query, '')) as query
  )
  select
    c.id as chunk_id,
    c.project_id,
    c.document_id,
    c.chunk_index,
    c.chunk_text,
    c.page_number,
    c.section_label,
    c.parser_metadata,
    d.title as document_title,
    d.file_name as document_file_name,
    d.confirmed_evidence_role,
    d.confirmed_reporting_period,
    linked_reviews.review_ids,
    pg_catalog.ts_rank_cd(c.search_vector, search_query.query)::real as rank
  from public.document_chunks as c
  join public.documents as d
    on d.id = c.document_id
    and d.project_id = c.project_id
  cross join search_query
  left join lateral (
    select pg_catalog.array_agg(ard.review_id order by r.reporting_period desc) as review_ids
    from public.assurance_review_documents as ard
    join public.assurance_reviews as r
      on r.id = ard.review_id
      and r.project_id = p_project_id
    where ard.project_id = p_project_id
      and ard.document_id = d.id
      and (p_review_id is null or ard.review_id = p_review_id)
  ) as linked_reviews on true
  where auth.uid() is not null
    and public.is_project_member(p_project_id)
    and c.project_id = p_project_id
    and d.project_id = p_project_id
    and d.processing_status = 'completed'
    and pg_catalog.numnode(search_query.query) > 0
    and c.search_vector @@ search_query.query
    and (
      p_review_id is null
      or (
        exists (
          select 1
          from public.assurance_reviews as scoped_review
          where scoped_review.id = p_review_id
            and scoped_review.project_id = p_project_id
        )
        and exists (
          select 1
          from public.assurance_review_documents as scoped_document
          where scoped_document.project_id = p_project_id
            and scoped_document.review_id = p_review_id
            and scoped_document.document_id = d.id
        )
      )
    )
    and (
      p_reporting_period is null
      or d.confirmed_reporting_period = p_reporting_period
      or exists (
        select 1
        from public.assurance_review_documents as period_document
        join public.assurance_reviews as period_review
          on period_review.id = period_document.review_id
          and period_review.project_id = p_project_id
        where period_document.project_id = p_project_id
          and period_document.document_id = d.id
          and period_review.reporting_period = p_reporting_period
          and (p_review_id is null or period_review.id = p_review_id)
      )
    )
    and (
      p_evidence_role is null
      or d.confirmed_evidence_role = p_evidence_role
      or exists (
        select 1
        from public.assurance_review_documents as role_document
        where role_document.project_id = p_project_id
          and role_document.document_id = d.id
          and role_document.evidence_role = p_evidence_role
          and (p_review_id is null or role_document.review_id = p_review_id)
      )
    )
  order by rank desc, d.created_at desc, c.chunk_index
  limit least(greatest(coalesce(p_limit, 8), 1), 12);
$function$;

revoke all on function public.search_project_document_chunks(uuid, text, text, date, uuid, integer)
  from public, anon;
grant execute on function public.search_project_document_chunks(uuid, text, text, date, uuid, integer)
  to authenticated;
