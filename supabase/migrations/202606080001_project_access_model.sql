create type public.project_role as enum (
  'admin',
  'pmc_consultant',
  'pmo_reviewer',
  'project_manager',
  'sponsor',
  'steering_committee'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  health_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.project_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, user_id)
);

create index project_members_user_id_idx on public.project_members(user_id);
create index project_members_project_id_idx on public.project_members(project_id);
create index projects_organization_id_idx on public.projects(organization_id);

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;

create or replace function public.is_project_member(check_project_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.project_members
    where project_id = check_project_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.is_org_member(check_organization_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.project_members pm
    join public.projects p on p.id = pm.project_id
    where p.organization_id = check_organization_id
      and pm.user_id = auth.uid()
  );
$$;

create policy "profiles_read_self"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid());

create policy "organizations_read_by_membership"
  on public.organizations
  for select
  to authenticated
  using (public.is_org_member(id));

create policy "projects_read_by_membership"
  on public.projects
  for select
  to authenticated
  using (public.is_project_member(id));

create policy "project_members_read_own_projects"
  on public.project_members
  for select
  to authenticated
  using (public.is_project_member(project_id));
