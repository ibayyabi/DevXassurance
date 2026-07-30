# Demo Evidence Fixtures

Use the `realistic-pmo-cases` packs for product demonstrations and acceptance testing. Each pack contains real uploadable DOCX, PDF, and XLSX evidence covering three reporting periods.

## Verified cases

1. `case_01_green_riverside_data_hub`: final condition `on_track`.
2. `case_02_amber_alpha_infrastructure`: final condition `needs_attention`.
3. `case_03_red_orion_erp_recovery`: final condition `critical`.

## Test procedure

1. Create one fresh project per case.
2. Upload every DOCX, PDF, and XLSX file in that case together.
3. Do not upload `expected-results.json`.
4. Wait for document processing and automatic assessment.
5. Confirm that three reporting periods appear and the final condition matches `expected-results.json`.
6. Verify the Overview trends, evidence sources, AI Advisor answer, report preview, PDF, and DOCX export.

Do not manually select a baseline or reporting period. Automatic organization is part of the acceptance test.
