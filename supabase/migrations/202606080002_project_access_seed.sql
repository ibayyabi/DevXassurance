insert into public.organizations (id, name)
values ('00000000-0000-4000-8000-000000000001', 'Alpha Infrastructure Program')
on conflict (id) do nothing;

insert into public.projects (id, organization_id, name, health_status)
values
  (
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000001',
    'Alpha Infrastructure Program',
    'Amber'
  ),
  (
    '00000000-0000-4000-8000-000000000102',
    '00000000-0000-4000-8000-000000000001',
    'Beta Recovery Works',
    'Green'
  )
on conflict (id) do nothing;
