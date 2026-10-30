-- Keep rejected extractions for traceability instead of deleting the evidence.
alter type public.fact_confirmation_state add value if not exists 'user_rejected';
