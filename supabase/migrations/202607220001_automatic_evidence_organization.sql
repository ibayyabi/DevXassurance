-- Phase 5: keep the AI's document organization visible and auditable.

alter table public.documents
  add column if not exists evidence_role text
    check (evidence_role in ('baseline', 'current', 'supporting')),
  add column if not exists classification_confidence numeric(5, 4)
    check (
      classification_confidence is null
      or (classification_confidence >= 0 and classification_confidence <= 1)
    ),
  add column if not exists classification_reason text,
  add column if not exists detected_reporting_period date;

create index if not exists documents_project_evidence_role_idx
  on public.documents(project_id, evidence_role, document_date desc);

comment on column public.documents.evidence_role is
  'AI-organized role for the latest automatic project assessment.';

comment on column public.documents.classification_reason is
  'Short evidence-grounded explanation of the AI document classification.';
