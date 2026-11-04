alter table public.extracted_facts
  add column correction_reason text,
  add column corrected_by uuid references public.profiles(id) on delete set null,
  add column corrected_at timestamptz,
  add constraint extracted_facts_correction_attribution_check
    check (
      (correction_reason is null and corrected_by is null and corrected_at is null)
      or (
        edited_value is not null
        and correction_reason is not null
        and btrim(correction_reason) <> ''
        and corrected_at is not null
      )
    );
