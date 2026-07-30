# Phase 5 usability test report

Date: 22 July 2026
Environment: XAss Development only
Branch: `improve/frontend-and-performance`

## Outcome

The revised product flow is usable end to end:

1. Upload all available project documents.
2. AI classifies each document as approved plan, current evidence, or supporting evidence.
3. The application automatically selects evidence and assesses Budget, Schedule, and Risk.
4. Overview presents the management condition, evidence-backed comparisons, and next actions.
5. Reports creates an approval-gated PDF or DOCX management report.

The production application, production database, and production n8n instance were not changed.

## TasteSkill design direction

The redesign used TasteSkill as an audit-first system for an existing product. The configured direction was:

- design variance: 6
- motion intensity: 3
- information density: 5
- light-first interface
- slate and graphite neutrals with cobalt actions
- semantic green, amber, and red only for real conditions
- asymmetric page hierarchy instead of equal card grids
- plain management language instead of pipeline terminology
- WCAG-friendly button and text contrast
- no decorative or fabricated charts

## Functional usability test

The test used a disposable development user and project with two text fixtures: an approved baseline and a current report.

| Test | Result | Evidence |
| --- | --- | --- |
| Sign in and create project | Pass | Development user could create and open a project under RLS. |
| Upload all evidence together | Pass | Both files were accepted by one multi-file control. No manual title, date, or document type was required. |
| Background document processing | Pass | Both jobs moved from queued to completed through Supabase, n8n, and the document worker. |
| AI document organization | Pass | Baseline was classified as approved plan and the current report as current evidence, each with a reason and confidence. |
| Automatic evidence selection | Pass | The completed documents were linked to the latest assessment without user checkboxes. |
| Automatic assessment | Pass | One idempotent assessment produced Budget, Schedule, and Risk findings. |
| Overview comprehension | Pass | The first viewport showed `Critical condition`, the reporting period, evidence count, real comparisons, and three actions. |
| Budget visual | Pass | Approved USD 1,000,000 versus current USD 1,080,000 was shown with proportional bars and an 8.0% variance. |
| Schedule visual | Pass | Approved 15 July 2026 versus forecast 5 August 2026 was shown as 21 days late. |
| Risk visual | Pass | One open critical risk was shown without inventing a percentage. |
| Management report | Pass | Preview generation, editing, approval, PDF export creation, and recent-download presentation worked. |
| AI Advisor | Pass | Answer used the assessment evidence, displayed sources once, and stated when owner or due-date information was absent. |
| Desktop layout | Pass | Main pages fit at 1280 px without horizontal overflow. |
| Mobile layout | Pass | Overview, Evidence, and Reports fit at 390 px without horizontal overflow; primary navigation remained available. |
| Clean browser console | Pass | A fresh authenticated Overview load produced no browser warnings or errors. |

## Defects found and fixed during testing

1. **Invisible black controls**: explicit foreground colors and a light theme now keep primary, outline, disabled, export, and download controls readable.
2. **Misleading export wording**: actions now say `Create PDF file` and `Create DOCX file`; downloads are presented separately after creation.
3. **PDF opening inline**: report signed URLs now request download disposition.
4. **Mobile report overflow**: long filenames and traceability content now wrap inside the viewport.
5. **Raw AI Markdown**: tables, emphasis markers, and decorative separators are removed from the rendered answer.
6. **Unsupported AI details**: the model prompt explicitly prohibits invented owners, dates, thresholds, and project facts.
7. **Stale report preview**: a report generated before a newer assessment must be regenerated before approval or export.
8. **Repeated assessment calls**: the automatic assessment is keyed by a completed-document fingerprint and reuses an unchanged assessment.

## Automated verification

- ESLint: pass
- TypeScript: pass
- Integration tests: 30 passed, 0 failed
- Next.js optimized production build: pass
- Development Supabase migration alignment: pass through `202607220001_automatic_evidence_organization.sql`

## Honest remaining limits

- Trends intentionally remains an `Under Development` page and does not fabricate historical data.
- Image and presentation formats that cannot be extracted reliably remain reference evidence and may require review.
- Automatic assessment is triggered when the Evidence page observes that background processing has settled. If the user closes the page immediately after upload, reopening Evidence triggers the same idempotent assessment.
- PMBOK-grounded RAG is future scope. AI Advisor currently uses project evidence plus general project-assurance guidance and identifies that limitation.
- The in-app browser verified a forced-download signed URL and a visible recent-download link. Its download event was not used as the authoritative assertion because the browser harness did not expose the completed file event reliably.

## Release recommendation

The development version is ready for stakeholder usability review, not direct production deployment. The next safe step is a short review with the boss using one familiar real project, followed by fixing only release-blocking feedback before a controlled staging or production rollout.

## Entry experience extension

The public and first-time user surfaces were redesigned after the core workflow test:

- Landing page now explains the complete Upload, Organize, Assess, and Report workflow with an original evidence-to-decision hero image.
- Sign-in, registration, confirmation, password recovery, password update, and authentication-error pages now share one accessible visual system.
- Project selection now separates existing projects from project creation, clearly presents condition and role, and includes a visible sign-out action.
- Account confirmation and password reset no longer redirect to the nonexistent `/protected` route.

Additional browser checks passed at 1280 px and 390 px:

- hero remains within the intended initial viewport and uses two desktop headline lines
- navigation remains one line and mobile branding no longer wraps
- form fields retain visible labels, 48 px controls, autofill metadata, and inline error regions
- all primary buttons use white text on cobalt and all secondary buttons remain readable
- landing, sign-in, registration, empty project selection, project creation, and populated project selection have no horizontal overflow
- browser console contains no warnings or errors on the tested entry pages
