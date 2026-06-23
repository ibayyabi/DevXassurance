create type public.report_type as enum (
  'executive_summary',
  'assurance_report',
  'governance_gap_report',
  'risk_issue_summary'
);

create type public.report_review_state as enum (
  'draft_ai_generated',
  'user_edited',
  'reviewed',
  'exported',
  'export_failed'
);

create type public.report_export_format as enum (
  'pdf',
  'docx'
);

insert into storage.buckets (id, name, public)
values ('project-reports', 'project-reports', false)
on conflict (id) do nothing;

create table public.report_previews (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  report_type public.report_type not null,
  reporting_period text not null,
  audience text not null,
  detail_level text not null,
  original_sections jsonb not null,
  edited_sections jsonb,
  included_evidence_counts jsonb not null default '{}'::jsonb,
  provenance jsonb not null default '[]'::jsonb,
  review_state public.report_review_state not null default 'draft_ai_generated',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.report_exports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  report_preview_id uuid not null references public.report_previews(id) on delete cascade,
  exported_by uuid not null references public.profiles(id) on delete restrict,
  export_format public.report_export_format not null,
  storage_bucket text not null default 'project-reports',
  storage_path text not null,
  file_name text not null,
  file_size bigint not null default 0 check (file_size >= 0),
  status public.report_review_state not null default 'exported',
  error_message text,
  created_at timestamptz not null default now()
);

create index report_previews_project_created_idx
  on public.report_previews(project_id, created_at desc);

create index report_exports_project_created_idx
  on public.report_exports(project_id, created_at desc);

alter table public.report_previews enable row level security;
alter table public.report_exports enable row level security;

create policy "report_previews_read_by_project_members"
  on public.report_previews
  for select
  to authenticated
  using (public.is_project_member(project_id));

create policy "report_previews_insert_by_project_uploaders"
  on public.report_previews
  for insert
  to authenticated
  with check (
    public.can_upload_project_evidence(project_id)
    and created_by = auth.uid()
  );

create policy "report_previews_update_by_project_uploaders"
  on public.report_previews
  for update
  to authenticated
  using (public.can_upload_project_evidence(project_id))
  with check (public.can_upload_project_evidence(project_id));

create policy "report_exports_read_by_project_members"
  on public.report_exports
  for select
  to authenticated
  using (public.is_project_member(project_id));

create policy "report_exports_insert_by_project_uploaders"
  on public.report_exports
  for insert
  to authenticated
  with check (
    public.can_upload_project_evidence(project_id)
    and exported_by = auth.uid()
  );

create policy "storage_reports_read_by_project_members"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'project-reports'
    and public.is_project_member((storage.foldername(name))[1]::uuid)
  );

create policy "storage_reports_insert_by_project_uploaders"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'project-reports'
    and public.can_upload_project_evidence((storage.foldername(name))[1]::uuid)
  );
