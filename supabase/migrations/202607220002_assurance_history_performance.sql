-- Support automatic multi-period assessment and PMO history reads.

create index if not exists documents_completed_period_idx
  on public.documents(project_id, detected_reporting_period desc, document_date desc)
  where processing_status = 'completed';

create index if not exists assurance_findings_project_review_idx
  on public.assurance_findings(project_id, review_id, domain);

create index if not exists assurance_actions_project_review_idx
  on public.assurance_actions(project_id, review_id, status);
