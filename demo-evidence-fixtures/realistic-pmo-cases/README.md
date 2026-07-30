# Realistic PMO Demo Evidence Cases

These are golden acceptance-test packs for the real document pipeline. Each project contains an approved baseline, three reporting periods, a current cost report, a current risk register, an issue log, and machine-readable expected results.

## Cases

1. `Riverside Data Hub` from `case_01_green_riverside_data_hub`. Expected final condition: `on_track`.
2. `Alpha Infrastructure Program` from `case_02_amber_alpha_infrastructure`. Expected final condition: `needs_attention`.
3. `Orion ERP Recovery` from `case_03_red_orion_erp_recovery`. Expected final condition: `critical`.

## Upload files

For each case, upload every DOCX, PDF, and XLSX file into a fresh project. Do not upload `expected-results.json`.

The application must:

1. classify the approved baseline separately from current evidence;
2. detect all three reporting periods;
3. save a separate assessment snapshot for each period;
4. match the final condition in `expected-results.json`;
5. show source evidence in the Overview, report, and AI Advisor.

The AI response wording may vary. Budget variance, schedule delay, risk counts, conditions, reporting periods, and cited evidence must remain correct.
