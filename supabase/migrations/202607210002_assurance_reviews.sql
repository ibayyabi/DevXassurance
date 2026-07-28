-- Phase 4 Gates 2 and 3: bind evidence to one reporting period and store
-- deterministic Budget, Schedule, and Risk comparisons.

create table public.assurance_reviews (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  reporting_period date not null,
  title text not null,
  status text not null default 'draft'
    check (status in (
      'draft',
      'evidence_ready',
      'analyzing',
      'findings_ready',
      'report_draft',
      'approved',
      'analysis_failed'
    )),
  current_step text not null default 'evidence'
    check (current_step in ('evidence', 'analysis', 'findings', 'actions', 'report')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  reviewed_by uuid references public.profiles(id) on delete set null,
  analysis_error text,
  analysis_metadata jsonb not null default '{}'::jsonb,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, reporting_period)
);

create table public.assurance_review_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  review_id uuid not null references public.assurance_reviews(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  evidence_role text not null check (evidence_role in ('baseline', 'current')),
  added_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (review_id, document_id)
);

create table public.assurance_findings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  review_id uuid not null references public.assurance_reviews(id) on delete cascade,
  domain text not null check (domain in ('budget', 'schedule', 'risk')),
  condition text not null check (condition in (
    'on_track',
    'needs_attention',
    'critical',
    'more_evidence_required'
  )),
  severity text not null check (severity in ('information', 'medium', 'high', 'critical')),
  headline text not null,
  explanation text not null,
  baseline_value jsonb,
  current_value jsonb,
  variance jsonb,
  required_evidence text[] not null default '{}',
  baseline_document_ids uuid[] not null default '{}',
  current_document_ids uuid[] not null default '{}',
  source_excerpts jsonb not null default '[]'::jsonb,
  confidence numeric(5, 4) check (confidence >= 0 and confidence <= 1),
  provenance jsonb not null default '{}'::jsonb,
  confirmation_state text not null default 'ai_extracted'
    check (confirmation_state in ('ai_extracted', 'user_confirmed', 'user_edited')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (review_id, domain)
);

create table public.assurance_actions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  review_id uuid not null references public.assurance_reviews(id) on delete cascade,
  finding_id uuid references public.assurance_findings(id) on delete set null,
  title text not null,
  owner_name text,
  due_date date,
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high')),
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'completed', 'deferred')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index assurance_reviews_project_period_idx
  on public.assurance_reviews(project_id, reporting_period desc);

create index assurance_review_documents_review_role_idx
  on public.assurance_review_documents(review_id, evidence_role);

create index assurance_findings_review_domain_idx
  on public.assurance_findings(review_id, domain);

create index assurance_actions_review_status_idx
  on public.assurance_actions(review_id, status, priority);

alter table public.report_previews
  add column if not exists assurance_review_id uuid
    references public.assurance_reviews(id) on delete set null;

alter table public.assistant_interactions
  add column if not exists assurance_review_id uuid
    references public.assurance_reviews(id) on delete set null;

alter table public.assurance_reviews enable row level security;
alter table public.assurance_review_documents enable row level security;
alter table public.assurance_findings enable row level security;
alter table public.assurance_actions enable row level security;

create policy "assurance_reviews_read_by_project_members"
  on public.assurance_reviews for select to authenticated
  using (public.is_project_member(project_id));

create policy "assurance_reviews_insert_by_project_uploaders"
  on public.assurance_reviews for insert to authenticated
  with check (
    public.can_upload_project_evidence(project_id)
    and created_by = auth.uid()
  );

create policy "assurance_reviews_update_by_project_uploaders"
  on public.assurance_reviews for update to authenticated
  using (public.can_upload_project_evidence(project_id))
  with check (public.can_upload_project_evidence(project_id));

create policy "assurance_review_documents_read_by_project_members"
  on public.assurance_review_documents for select to authenticated
  using (public.is_project_member(project_id));

create policy "assurance_review_documents_manage_by_project_uploaders"
  on public.assurance_review_documents for all to authenticated
  using (public.can_upload_project_evidence(project_id))
  with check (
    public.can_upload_project_evidence(project_id)
    and added_by = auth.uid()
  );

create policy "assurance_findings_read_by_project_members"
  on public.assurance_findings for select to authenticated
  using (public.is_project_member(project_id));

create policy "assurance_findings_manage_by_project_uploaders"
  on public.assurance_findings for all to authenticated
  using (public.can_upload_project_evidence(project_id))
  with check (public.can_upload_project_evidence(project_id));

create policy "assurance_actions_read_by_project_members"
  on public.assurance_actions for select to authenticated
  using (public.is_project_member(project_id));

create policy "assurance_actions_manage_by_project_uploaders"
  on public.assurance_actions for all to authenticated
  using (public.can_upload_project_evidence(project_id))
  with check (public.can_upload_project_evidence(project_id));
