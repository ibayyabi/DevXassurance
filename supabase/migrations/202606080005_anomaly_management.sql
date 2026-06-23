create type public.anomaly_category as enum (
  'cost',
  'schedule',
  'risk',
  'governance',
  'scope',
  'accountability'
);

create type public.anomaly_status as enum (
  'open',
  'reviewed',
  'false_positive',
  'action_created',
  'dismissed'
);

create type public.evidence_absence_type as enum (
  'not_found_in_evidence',
  'confirmed_missing',
  'not_applicable'
);

create table public.anomalies (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  affected_fact_id uuid references public.extracted_facts(id) on delete set null,
  evidence_link_id uuid references public.evidence_links(id) on delete set null,
  category public.anomaly_category not null,
  missing_field text,
  severity public.alert_severity not null,
  status public.anomaly_status not null default 'open',
  title text not null,
  affected_item text not null,
  explanation text not null,
  impact text not null,
  impact_rating text not null,
  recommended_action text not null,
  suggested_owners text[] not null default '{}',
  evidence_count integer not null default 0 check (evidence_count >= 0),
  absence_type public.evidence_absence_type not null default 'not_applicable',
  rationale text not null,
  source_path text,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  entity_type text not null,
  entity_id uuid not null,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);

alter table public.recommended_actions
  add column source_anomaly_id uuid references public.anomalies(id) on delete set null;

create index anomalies_project_category_idx
  on public.anomalies(project_id, category, severity, status);

create index anomalies_project_created_idx
  on public.anomalies(project_id, created_at desc);

create index audit_events_project_entity_idx
  on public.audit_events(project_id, entity_type, entity_id, created_at desc);

create index recommended_actions_source_anomaly_idx
  on public.recommended_actions(source_anomaly_id);

alter table public.anomalies enable row level security;
alter table public.audit_events enable row level security;

create policy "anomalies_read_by_project_members"
  on public.anomalies
  for select
  to authenticated
  using (public.is_project_member(project_id));

create policy "anomalies_update_by_project_uploaders"
  on public.anomalies
  for update
  to authenticated
  using (public.can_upload_project_evidence(project_id))
  with check (public.can_upload_project_evidence(project_id));

create policy "anomalies_insert_by_project_uploaders"
  on public.anomalies
  for insert
  to authenticated
  with check (public.can_upload_project_evidence(project_id));

create policy "audit_events_read_by_project_members"
  on public.audit_events
  for select
  to authenticated
  using (public.is_project_member(project_id));

create policy "audit_events_insert_by_project_uploaders"
  on public.audit_events
  for insert
  to authenticated
  with check (public.can_upload_project_evidence(project_id));
