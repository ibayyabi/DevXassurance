create policy "dashboard_alerts_delete_by_project_uploaders"
  on public.dashboard_critical_alerts
  for delete
  to authenticated
  using (public.can_upload_project_evidence(project_id));

create policy "recommended_actions_delete_by_project_uploaders"
  on public.recommended_actions
  for delete
  to authenticated
  using (public.can_upload_project_evidence(project_id));

create policy "anomalies_delete_by_project_uploaders"
  on public.anomalies
  for delete
  to authenticated
  using (public.can_upload_project_evidence(project_id));
