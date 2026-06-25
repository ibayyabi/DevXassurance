# Demo Evidence Fixtures

Use these files to create three separate demo projects and verify dashboard status, trend, document intelligence, anomaly, assistant, and report flows.

## Suggested Projects

1. `Green Demo - Riverside Data Hub`
   - Upload all files in `green-riverside-data-hub`
   - Expected dashboard: mostly green, high scores, few or no critical alerts.

2. `Amber Demo - Alpha Infrastructure Program`
   - Upload all files in `amber-alpha-infrastructure`
   - Expected dashboard: amber overall, schedule/cost attention, medium-to-high alerts.

3. `Red Demo - Orion ERP Recovery`
   - Upload all files in `red-orion-erp-recovery`
   - Expected dashboard: red overall, high/critical alerts, urgent recommended actions.

## Upload Notes

- Leave title, document date, and type empty when uploading. The app should use the filename, file modified date, and default type.
- Upload multiple files at once per project.
- After upload, confirm n8n processes the queued jobs.
- Use Dashboard after processing to check the percentage/status cards and monthly trend.

