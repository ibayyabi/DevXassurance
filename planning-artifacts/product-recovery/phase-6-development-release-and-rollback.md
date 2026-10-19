# Phase 6 Development Release, Rollback, and Usability Checklist

This procedure is for local/development verification only. It does not authorize a production migration, deployment, webhook, or evidence upload. The full browser suite uses generated synthetic data and an isolated Auth user/project through the deterministic fixture proxy; only `npm run test:e2e:live` uses the configured model provider. Never include private project evidence or `SMART BUILDING/` material.

## Current execution status

- `npm run test:e2e` passed: the deterministic, fixture-mode browser journey completed 1 test in 2.4 minutes after the Advisor source-card and retrieval fixes.
- Migration 008 passed dry-run and was applied to the verified DevXAssurance development target. Phase 6 migrations 001–008 have been applied in sequence.
- `npm run test:e2e:live` passed once: strict extraction completed for generated synthetic evidence. The runner uses a temporary transpiled `.mjs` module and cleans it up in `finally`; no provider response or secret was logged.
- Final checks after the smoke-runner change: `npm test` passed (108/108), `npx tsc --noEmit --incremental false` passed, `npm run lint` reported no issues, and `npm run build` passed.
- **P6-09 remains incomplete.** Human first-time-user session not conducted; a participant was unavailable. Automated tests are not a substitute. This remains an external blocker.

## Preconditions

- Node.js 20+, npm dependencies, Playwright Chromium, and the local app are available.
- `.env.local` points to the approved development Supabase project. Before any write, compare its URL ref with `supabase/.temp/project-ref`, `supabase/.temp/linked-project.json`, and `supabase/config.toml`; verify the linked target name/ref from `supabase projects list`. Do not print environment values, keys, or tokens.
- The browser workflow uses deterministic fixture responses and does not need model credentials. `npm run test:e2e:live` requires the configured provider credentials/base URL; keep them server-side and out of logs, screenshots, traces, and source control.
- Tesseract is installed for OCR; scanned PDFs also require Ghostscript. English uses `XASS_OCR_LANG=eng`; Bahasa Indonesia plus English uses `XASS_OCR_LANG=ind+eng` after installing both traineddata files. Missing language data is an explicit failure.
- n8n is the normal queue/orchestrator. If unavailable, the E2E test claims each queued development job with a compare-and-set update and calls the actual Next worker route. That route persists validated document suggestions; the E2E helper persists returned chunks, `extraction_runs`, and terminal job/document processing state only to drive the browser workflow. Facts, snapshots, summaries, alerts, and actions use n8n's separate result-persistence path, covered by mapping behavior tests. This fallback does not verify live n8n connectivity.

## Migration and browser verification

Apply the existing migrations in filename order. Phase 6 migrations are additive and ordered:

1. `202610180001_phase6_evidence_metadata.sql`
2. `202610180002_document_upload_submissions.sql`
3. `202610180003_zip_intake_manifest.sql`
4. `202610180004_document_extraction_groups.sql`
5. `202610180005_advisor_retrieval_and_conversations.sql`
6. `202610180006_upload_submission_batches.sql`
7. `202610180007_advisor_ranked_or_search.sql`
8. `202610180008_advisor_relaxed_match_guard.sql`

For a linked development project only:

```sh
supabase projects list
supabase db push --linked --dry-run
supabase migration list --linked
supabase db push --linked
supabase migration list --linked
```

Compare the linked project name/ref and the `.env.local` URL ref before `db push`. If they disagree, stop before writes. Do not substitute a different project or use a production target.

Install and run the deterministic full browser workflow and the separate real-provider smoke:

```sh
npm install
npx playwright install chromium
npm test
npm run test:e2e
npm run test:e2e:live
```

`npm run test:e2e` starts a loopback Next development server and a loopback
model proxy in fixture mode. Fixture mode produces bounded schema-shaped outputs
from the generated source chunks used by the journey and has no upstream request
path. The E2E test refuses a Supabase target other than the linked
`DevXAssurance` / `XAss-Development` development project. It creates and cleans up only its own
user, projects, rows, and storage objects.

The browser workflow covers mixed regular/ZIP multi-file intake and persisted
batch IDs, safe ZIP siblings plus rejected traversal/nested/unsupported/
duplicate-content entries, TUS storage retry without duplicate document/job
rows, guided hints and user correction, single-file upload without hints,
transient model failure and retry, a greater-than-10-MiB PDF with a small
extracted text body, actual worker parsing/classification, active-review
evidence filters with a saved off-filter selection, verified citations and
follow-up, no-match answers, and project isolation. It also verifies the empty
Assurance review guard and analysis/report source links using fixture outputs.

`npm run test:e2e:live` sends one generated synthetic evidence document through
the strict extraction service with the configured real provider. It prints only
whether strict extraction completed or the safe error code; it never logs the
provider response body or credentials. A live-provider failure is not a
deterministic E2E failure and does not alter the full workflow result.

The Next worker route persists validated document suggestions. With n8n
unavailable, the browser-test helper persists only returned source chunks, an
extraction-run record, and terminal job/document processing state so the UI can
exercise the actual worker route; facts, snapshots, summaries, alerts, and
actions use n8n's separate persistence path, covered by mapping behavior tests.
No live n8n runtime is claimed. Report exact commands and outcomes; provider
quota/auth/network errors are blockers for the live smoke, not successful
extraction.

Extraction requests use temperature `0`; JSON mode is requested where supported
but is not treated as schema enforcement. Strict schema and source-citation
validation remains authoritative, so malformed provider output is a visible
failure/Needs Review outcome rather than a successful extraction.

## Rollback and recovery

1. Stop development uploads and deactivate the development n8n workflow/webhook before changing schema or code.
2. If the application change is faulty, stop the local app and revert/restore the development code to its prior known-good revision. Leave additive migrations and their data in place unless a database owner has approved a separately reviewed rollback.
3. Do not delete migration-history rows, drop Phase 6 tables/columns, or erase extraction-group cache rows as a routine code rollback. These migrations have no automatic destructive down path. If schema removal is specifically required, first take a development database snapshot, inspect dependents and data, and prepare a separately reviewed reverse migration; otherwise leave the additive schema and roll forward.
4. The E2E `afterAll` removes only the user/projects it created and storage paths scoped to those project IDs. If the process is interrupted, identify test-created project IDs and verify ownership before cleanup; never run broad deletes or remove unrelated user data.
5. Re-run focused behavior tests and the development browser workflow after recovery. Do not describe a development rollback as a production rollback or rollout.

## First-time-user moderator checklist

**Human session status: not conducted.** No participant was available in this task context. Automated tests and agent walkthroughs are simulated checks, not a human usability session. Recruiting and running a first-time-user session remains an external blocker.

When a participant is available, use only synthetic test files and a fresh development account. Avoid teaching the interface or suggesting answers; ask the participant to think aloud and record confusion/errors without collecting private evidence.

- [ ] Ask the participant to create/open a project and locate evidence intake without coaching.
- [ ] Have them upload several files together, then a ZIP with one safe file and one rejected member; observe whether they understand independent item states and retry.
- [ ] Ask them to add a single file with a type/date/period/workstream hint, inspect the suggestion, and correct it; note whether the difference between hint, suggestion, and confirmation is clear.
- [ ] Have them assign baseline/current/supporting roles and create a review; filter one dimension, change a visible selection, save, and verify an off-filter selected document remains linked.
- [ ] Ask an evidence question, a follow-up, and a question with no matching evidence; observe whether source IDs/locations and the insufficiency message are understandable.
- [ ] Capture task completion, misclicks, hesitation, recovery behavior, and verbatim confusion points. Do not invent a completion time, success rate, or participant quote.

Record the actual participant/session details only after it occurs; until then, leave usability findings unclaimed.
