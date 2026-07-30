# Phase 4 Implementation Report

Date: 21 July 2026
Branch: `improve/frontend-and-performance`
Environment: XAss Development only

## Outcome

Phase 4 is complete in the development environment. The product now supports one understandable assurance journey:

1. Upload project evidence.
2. Wait for visible processing results or retry a failed job.
3. Bind an approved baseline and a current-period report.
4. Review deterministic Budget, Schedule, and Risk findings.
5. Confirm findings and management actions.
6. Approve and export a management report as PDF or DOCX.

No production application, database, workflow, or deployment was changed.

## What Changed

### Reliable evidence processing

- Added job leases, attempts, retry limits, recovery of abandoned jobs, and plain failure messages.
- Removed successful-looking fallback extraction when the AI provider fails or returns an incomplete contract.
- Added a user-visible retry action and automatic page refresh while evidence is being processed.
- Made extraction runs idempotent by AI job ID so retries do not create duplicate runs.
- Updated the development n8n polling workflow with lease recovery, worker retries, a longer processing lease, and reliable output continuation for the reset step.

Database migrations:

- `202607210001_reliable_document_jobs.sql`
- `202607210002_assurance_reviews.sql`
- `202607210003_extraction_run_idempotency.sql`

### One Assurance Review

- Added reporting-period reviews with explicit baseline and current-evidence roles.
- Added deterministic Budget, Schedule, and Risk comparison rules.
- Missing evidence remains `Incomplete`; it is not converted into a positive score.
- Findings show condition, reason, source evidence, and confirmation state.
- Management actions can be reviewed before reporting.

### Simpler product navigation and screens

- Replaced the percentage-heavy dashboard with a plain-language Overview.
- Made Assurance Review the central task.
- Simplified Evidence to upload, processing status, library, and an advanced extraction disclosure.
- Renamed AI Assistant to AI Advisor and bound its context to the latest assurance review.
- Added an honest Trends placeholder instead of fabricated history.
- Updated public, login, project selection, navigation, and report copy to match the usable recovery scope.

### Management reports

- Reports are generated from the selected Assurance Review.
- PDF and DOCX exports remain disabled until the report is approved.
- Exported reports use `Project Condition`, not an unexplained health percentage.
- PDFKit is treated as an external server package so its font metrics are available in Next.js production builds.
- Export dates are rendered deterministically in UTC to avoid client hydration mismatch.

## Verification Evidence

| Gate | Result |
| --- | --- |
| ESLint | Passed |
| Integration and rule tests | 28 passed, 0 failed |
| Next.js production build | Passed; 25 routes generated |
| Git whitespace check | Passed |
| Supabase migration parity | 13 local migrations match 13 development migrations |
| Browser journey | Passed from sign-in through evidence, review, approval, PDF, and DOCX |
| Worker failure behavior | Failed jobs became visible, retryable, and recovered without duplicate extraction runs |
| Assurance analysis | Produced source-grounded Budget, Schedule, and Risk findings from synthetic QA evidence |
| Report approval gate | Exports disabled before approval and enabled after approval |
| PDF export | Valid two-page PDF; visually inspected; expected findings and evidence appendix present |
| DOCX export | Valid Word document; text/table structure inspected; expected findings present |

The runtime test used synthetic development-only evidence with an approved budget of USD 1,000,000, a current value of USD 1,080,000, a 21-day forecast delay, and an open critical risk. The resulting findings correctly reported an 8.0% budget overrun, 21 days late, and a critical risk condition.

## Problems Found During Real Runtime Testing

The end-to-end check caught issues that static tests alone would not have found:

- A void Supabase RPC caused n8n to stop after resetting an earlier attempt. The workflow now always continues with output.
- The original five-minute job lease was shorter than the configured worker retry window. The development workflow now uses a fifteen-minute lease.
- A partial unique index could not support the extraction-run upsert conflict target. A full unique index now enforces one extraction run per AI job.
- Bundled PDFKit could not find its AFM font data in a Turbopack production path. `pdfkit` is now server-external.
- Locale-dependent export timestamps caused a hydration mismatch. Export history now uses deterministic UTC formatting.
- The DOCX export retained the old `Project Health` heading after the UI changed. It now uses `Project Condition` consistently.

## Safety and Rollback

- The production worktree remains untouched.
- Development migrations were applied only to the linked development Supabase project.
- The live local development n8n workflow was backed up before import.
- No branch was pushed, no pull request was opened, and no production deployment was made.

## Remaining Boundary

Phase 4 makes the development product functionally usable and honest. It does not authorize production release. The next phase should be a short usability and release-preparation phase: have representative users complete the one review journey, fix only blocking usability defects, prepare environment-specific deployment steps, rehearse rollback, and release through a reviewed pull request.

DOCX verification was structural because LibreOffice was unavailable in this environment. The PDF was rendered and visually inspected. A final Microsoft Word visual check should be included in release preparation.
