create type public.health_dimension as enum (
  'overall',
  'schedule',
  'cost',
  'risk',
  'governance',
  'audit_readiness'
);

create type public.health_status as enum (
  'green',
  'amber',
  'red',
  'insufficient_evidence'
);

create type public.alert_severity as enum (
  'low',
  'medium',
  'high',
  'critical'
);

create type public.action_priority as enum (
  'low',
  'medium',
  'high'
);

create type public.action_status as enum (
  'open',
  'in_progress',
  'completed',
  'deferred'
);

create table public.dashboard_health_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  dimension public.health_dimension not null,
  score numeric(5, 2) check (score >= 0 and score <= 100),
  status public.health_status not null,
  evidence_coverage numeric(5, 4) check (evidence_coverage >= 0 and evidence_coverage <= 1),
  status_text text not null,
  snapshot_date date not null default current_date,
  source_summary text,
  created_at timestamptz not null default now(),
  unique (project_id, dimension, snapshot_date)
);

create table public.dashboard_critical_alerts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  severity public.alert_severity not null,
  impacted_area text not null,
  explanation text not null,
  evidence_count integer not null default 0 check (evidence_count >= 0),
  recommended_action text not null,
  source_path text,
  created_at timestamptz not null default now()
);

create table public.recommended_actions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source_alert_id uuid references public.dashboard_critical_alerts(id) on delete set null,
  title text not null,
  owner_name text,
  due_date date,
  priority public.action_priority not null default 'medium',
  status public.action_status not null default 'open',
  source_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index dashboard_health_project_date_idx
  on public.dashboard_health_snapshots(project_id, snapshot_date desc);

create index dashboard_alerts_project_severity_idx
  on public.dashboard_critical_alerts(project_id, severity, created_at desc);

create index recommended_actions_project_priority_idx
  on public.recommended_actions(project_id, priority, due_date);

alter table public.dashboard_health_snapshots enable row level security;
alter table public.dashboard_critical_alerts enable row level security;
alter table public.recommended_actions enable row level security;

create policy "dashboard_health_read_by_project_members"
  on public.dashboard_health_snapshots
  for select
  to authenticated
  using (public.is_project_member(project_id));

create policy "dashboard_alerts_read_by_project_members"
  on public.dashboard_critical_alerts
  for select
  to authenticated
  using (public.is_project_member(project_id));

create policy "recommended_actions_read_by_project_members"
  on public.recommended_actions
  for select
  to authenticated
  using (public.is_project_member(project_id));
