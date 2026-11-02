alter type public.document_type add value if not exists 'unknown';
alter type public.document_type add value if not exists 'project_plan';
alter type public.document_type add value if not exists 'approved_baseline';
alter type public.document_type add value if not exists 'procurement_request';
alter type public.document_type add value if not exists 'decision_record';
alter type public.document_type add value if not exists 'technical_reference';
alter type public.document_type add value if not exists 'proposal';
alter type public.document_type add value if not exists 'other';

alter table public.documents
  add column if not exists document_type_hint public.document_type,
  add column if not exists document_date_hint date,
  add column if not exists reporting_period_hint date,
  add column if not exists workstream_hint text,
  add column if not exists suggested_document_type public.document_type,
  add column if not exists confirmed_document_type public.document_type,
  add column if not exists suggested_document_date date,
  add column if not exists suggested_workstream text,
  add column if not exists suggested_evidence_role text
    check (suggested_evidence_role in ('baseline', 'current', 'supporting')),
  add column if not exists confirmed_evidence_role text
    check (confirmed_evidence_role in ('baseline', 'current', 'supporting')),
  add column if not exists workstream text,
  add column if not exists confirmed_document_date date,
  add column if not exists confirmed_reporting_period date,
  add column if not exists confirmed_workstream text,
  add column if not exists confirmed_by uuid references public.profiles(id) on delete set null,
  add column if not exists confirmed_at timestamptz;

update public.documents
set suggested_document_type = document_type
where suggested_document_type is null;
update public.documents
set suggested_document_date = document_date
where suggested_document_date is null and document_date is not null;

update public.documents
set suggested_evidence_role = evidence_role
where suggested_evidence_role is null and evidence_role is not null;

comment on column public.documents.document_type is
  'Legacy-compatible document type value; unknown for new unclassified uploads.';
comment on column public.documents.document_type_hint is
  'Optional type selected at intake; never treated as an AI suggestion or reviewer confirmation.';
comment on column public.documents.suggested_document_type is
  'AI-suggested artifact type; separate from reviewer-confirmed metadata.';
comment on column public.documents.confirmed_document_type is
  'Reviewer-confirmed artifact type, taking precedence over suggestions.';
comment on column public.documents.suggested_evidence_role is
  'AI-suggested review role; null until context supports a suggestion.';
comment on column public.documents.confirmed_evidence_role is
  'Reviewer-confirmed review role, taking precedence over suggestions.';
comment on column public.documents.document_date is
  'Optional artifact date; upload time is recorded separately in created_at.';
comment on column public.documents.detected_reporting_period is
  'AI-suggested reporting period; null when unknown.';
comment on column public.documents.workstream is
  'Optional project workstream label.';
comment on column public.documents.confirmed_by is
  'Reviewer who last confirmed document metadata.';
comment on column public.documents.document_date_hint is
  'Optional intake date hint; distinct from AI suggestion and reviewer confirmation.';
comment on column public.documents.reporting_period_hint is
  'Optional intake reporting period; null when unknown.';
comment on column public.documents.workstream_hint is
  'Optional intake workstream hint.';
comment on column public.documents.suggested_document_date is
  'AI-suggested artifact date; null when unknown.';
comment on column public.documents.suggested_workstream is
  'AI-suggested workstream; null when unknown.';
comment on column public.documents.confirmed_reporting_period is
  'Reviewer-confirmed reporting period, taking precedence over suggestions.';
comment on column public.documents.confirmed_workstream is
  'Reviewer-confirmed workstream, taking precedence over suggestions.';
