# Project Assurance

Project Assurance is a working demo for evidence-backed project assurance. The
app uses Next.js and Supabase for the product surface and data store. n8n
orchestrates document-processing jobs, and the Next.js worker endpoint parses
supported evidence files and calls the configured LLM when available.

## Current State

- Role-based project workspace with dashboard, documents, anomalies, Advisor,
  and reports pages.
- Evidence uses resumable TUS multi-file intake; ZIP files are expanded as
  separate evidence items. Traversal paths, nested archives, unsupported
  members, and unsafe package contents are reported
  without discarding safe siblings.
- PDF, TXT, CSV, DOCX, XLSX, and PPTX files plus PNG, JPEG/JPG, WEBP, TIF/TIFF,
  and BMP images are parsed. Legacy `.ppt` files can be retained for review but
  are not automatically parsed. Image OCR and scanned-PDF OCR use local Tesseract
  (and Ghostscript for PDF pages); missing tools or configured language data cause
  an explicit failure, never an empty successful extraction.
- Upload creates a `public.ai_jobs` row. n8n remains the queue/orchestrator and
  calls the Next.js worker at `/api/workers/parse-document`; the worker handles
  bounded per-document model calls and returns source-mapped chunks, facts,
  summaries, alerts, actions, and health signals.
- The worker persists AI suggestions separately from intake hints and human
  confirmations. Review roles are `baseline`, `current`, and `supporting`;
  confirmation does not overwrite the original hints or AI suggestions.
- The same grouped extraction call also collects project cost evidence
  (approved baseline, actual to date, committed, and reported EAC) from any
  document type into `cost_observations`, keeping the source wording and its
  exact location. Amount and currency are normalized deterministically and stay
  null when the source wording is ambiguous.
- Project Budget assurance compares a reviewer-accepted baseline
  (`cost_baselines`) only with an explicitly reported EAC in the same currency.
  A document's own "approved" label does not activate a baseline, missing EAC is
  an evidence gap rather than a comparison against actual cost, and differing
  currencies stay source values without conversion. A reviewer may correct the
  assessed value with an attributed reason; the original extraction and its
  citations are unchanged.
- The Advisor searches fresh project evidence with active-review, role, and
  period scope, preserves follow-up conversation context, and shows only
  citations verified against the exact retrieved chunk and source location.
- Documents can be removed from the library, including related extracted
  evidence and storage files.
- Processed documents feed the Documents, Dashboard, Anomalies, Advisor, and
  Reports pages through shared Supabase records.
- Dashboard can be refreshed from current evidence without a new upload.
- Reports can be generated, edited, marked reviewed, exported, and downloaded
  from recent exports.
- Project members can be viewed, added by Supabase Auth email, role-updated,
  and removed from a project by project managers/admins.

## Team AI tooling

- Install the official [RTK CLI](https://www.rtk-ai.app/docs/getting-started/installation/) and verify it with `rtk --version` and `rtk gain`. OMP loads the checked-in project extension at `.omp/extensions/rtk.ts`; it rewrites supported Bash tool commands when RTK is on `PATH` (minimum version: `0.23.0`).
- Repository skills are consolidated under `.agents/skills/`: six selected Matt Pocock workflows (`grill-with-docs`, `handoff`, `implement`, `implement-spec`, `to-spec`, `to-tickets`) plus the project `ponytail` and `ui-skills` guidance.
- See [Agent workflows](docs/agents/README.md) to continue PMO tickets or start a new objective. Start a new OMP session or run `/reload-plugins` after checkout or skill changes.

## Required Tools

- Node.js 22.18 or newer (the test suite imports TypeScript modules directly;
  on an older Node 22, run the suite with `--experimental-strip-types`)
- Supabase development project (verify the linked project before any writes)
- Docker Desktop and the included n8n workflow for queue/polling integration
- A configured Ollama Cloud provider, or local Ollama for fully local model runs
- Tesseract and (for scanned PDFs) Ghostscript for OCR; OCR language data is
  installed separately and configured with `XASS_OCR_LANG`

## 1. Install App Dependencies

```powershell
npm install
```

## 2. Configure the Next.js App

Create `.env.local` from `.env.example`:

```powershell
Copy-Item .env.example .env.local
```

Fill these values from Supabase Project Settings > API:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-development-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-or-anon-key
NEXT_PUBLIC_SITE_URL=http://localhost:3000
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
XASS_WORKER_SECRET=use-the-same-value-as-n8n
XASS_LLM_PROVIDER=ollama_cloud
OLLAMA_CLOUD_BASE_URL=https://ollama.com/api
OLLAMA_API_KEY=your-ollama-api-key
OLLAMA_CLOUD_MODEL=gpt-oss:20b
XASS_OCR_LANG=eng
```

`SUPABASE_SERVICE_ROLE_KEY` must stay server-only. Never put it in a
`NEXT_PUBLIC_*` variable.

Local mode runs Next.js and n8n on this machine while targeting the hosted
development Supabase project in the environment files. The local Supabase
stack under `supabase/` is a separate target; do not mix its keys with the
hosted project's keys.

Apply `supabase/migrations` in filename order. For a linked development project,
verify the project name/ref before writes and dry-run first:

```powershell
supabase projects list
supabase db push --linked --dry-run
supabase db push --linked
supabase migration list --linked
```

Phase 6's additive migrations apply in this order:

```text
202610180001_phase6_evidence_metadata.sql
202610180002_document_upload_submissions.sql
202610180003_zip_intake_manifest.sql
202610180004_document_extraction_groups.sql
202610180005_advisor_retrieval_and_conversations.sql
202610180006_upload_submission_batches.sql
202610180007_advisor_ranked_or_search.sql
202610180008_advisor_relaxed_match_guard.sql
```

The PMO cost evidence migration applies after the Phase 6 set:

```text
202610260001_pmo_cost_evidence.sql
```

Do not link, push, or test against production as part of development work.

## 4. Configure the LLM

For a development run, choose the configured provider for the Next.js worker and
Advisor:

```env
XASS_LLM_PROVIDER=ollama_cloud
OLLAMA_CLOUD_BASE_URL=https://ollama.com/api
OLLAMA_API_KEY=your-ollama-api-key
OLLAMA_CLOUD_MODEL=gpt-oss:20b
```

The app sends model requests server-side to `{OLLAMA_CLOUD_BASE_URL}/chat`. Keep
the key in `.env.local`; never put it in a `NEXT_PUBLIC_*` variable, browser
code, workflow JSON, or logs. A cloud provider may send evidence to the
configured provider; use only approved development/test evidence.

Document extraction requests use temperature `0` and request JSON mode where the
provider supports it. Provider formatting is not trusted: strict schema and
source-citation checks still apply, and malformed output remains a visible
failure for review rather than a successful extraction.

For a local-only demo, you can still use Ollama:

```powershell
ollama pull qwen2.5:3b
```

If `ollama serve` says the port is already in use, that is fine. It usually
means Ollama is already running.

```env
XASS_LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:3b
```

OCR uses `XASS_OCR_LANG=eng` by default. For Bahasa Indonesia and English,
install both Tesseract traineddata files and set `XASS_OCR_LANG=ind+eng`.
Missing language data is an explicit OCR failure, not an empty successful parse.

## 5. Start the Next.js App

```powershell
npm run dev
```

Open:

```text
http://localhost:3000
```

## 6. Configure n8n

Create the n8n env file:

```powershell
Copy-Item workflows\n8n\.env.example workflows\n8n\.env
```

Fill these values in `workflows/n8n/.env`:

```env
SUPABASE_URL=https://your-development-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
XASS_DOCUMENT_WORKER_URL=http://host.docker.internal:3000/api/workers/parse-document
XASS_N8N_WEBHOOK_SECRET=use-a-shared-webhook-secret
XASS_WORKER_SECRET=use-the-same-value-as-root-env
N8N_BLOCK_ENV_ACCESS_IN_NODE=false
```

Start n8n:

```bash
docker compose -f workflows/n8n/docker-compose.yml --env-file workflows/n8n/.env up -d
```

Open:

```text
http://localhost:5678
```

Import and activate:

```text
workflows/n8n/x-assurance-supabase-document-polling.json
```

The polling workflow is the default local mode. It checks Supabase every 60
seconds, claims queued jobs atomically, and calls the Next.js worker through
`host.docker.internal`. It does not need a public tunnel or a Supabase Database
Webhook.

Keep the webhook workflow and the Supabase Database Webhook disabled while
polling is active. Only one polling workflow may be published. Re-import and
publish the workflow after changing its JSON.

The webhook workflow is optional for testing inbound delivery. Use it only with
a public HTTPS tunnel and a matching `WEBHOOK_URL`; never use its
`/webhook-test/` URL for a persistent integration.

## 8. Development Workflow

1. Verify the linked Supabase project is the approved development target, then
   dry-run migrations before applying them; use the Phase 6 order above.
2. Start the app and open a development project.
3. Upload multiple supported files together. Select a ZIP containing a safe
   supported file plus an unsafe path, nested archive, or unsupported member;
   verify the safe sibling remains available and rejected members are listed.
4. For a single file, optionally enter document type, date, reporting period,
   and workstream hints. Hints remain distinct from AI suggestions and reviewer
   confirmations.
5. Review the file state and extraction summary. PDF/TXT/CSV/DOCX/XLSX/PPTX and
   supported images are parsed; image and scanned-PDF OCR requires Tesseract
   language data and Ghostscript for PDF. Missing tools/languages, invalid
   evidence, and work-limit breaches must remain Needs Review or Failed, never
   Ready.
6. Correct the suggested artifact type and assign an evidence role:
   `baseline`, `current`, or `supporting`. Confirm the saved value while
   retaining the original hint and AI suggestion.
7. On the Assurance page, review the cost baseline candidates extracted from
   evidence and accept one for a scope and effective date. Confirm Budget stays
   More Evidence Required until a baseline is accepted, that a document calling
   itself approved does not activate one, and that a candidate whose amount or
   currency could not be read safely cannot be accepted.
8. Start an assurance review and verify missing baseline/current evidence keeps
   analysis and reporting unready. Select approved baseline and current-period
   evidence, filter by a dimension, change a visible selection, and save;
   confirm selected off-filter evidence remains linked. Run analysis, inspect
   its source document/location link, and continue to a report only after
   verified findings exist. A failed model analysis stays visibly unready; do
   not invent findings.
9. Ask the Advisor a project question. Inspect its exact source ID/location,
   ask a follow-up in the same conversation, and try a historical/comparative
   question and a no-match question. Unsupported claims should not be presented
   as facts.
10. Use the existing Dashboard, Reports, and Members pages as needed.

Phase 6 extraction limits and OCR setup are also documented in `worker/README.md`.
The full release, rollback, browser-run, and moderator checklist is
`planning-artifacts/product-recovery/phase-6-development-release-and-rollback.md`.

## Member Management Notes

Members must already exist in Supabase Auth before they can be added to a
project. For the demo, create the user from the app sign-up page or Supabase
Authentication > Users first, then add their email from the Members page.

Project roles are:

```text
Admin, PMC Consultant, PMO Reviewer, Project Manager, Sponsor, Steering Committee
```

Only Admin, PMC Consultant, and Project Manager can manage project access.

## Useful Checks

Check containers:

```powershell
docker ps
```

Run the integration behavior suite and persistent browser workflow:

```powershell
npm test
npx playwright install chromium
npm run test:e2e
npm run test:e2e:live
```

`npm run test:e2e` runs the full browser journey against a deterministic,
source-grounded provider fixture isolated in the test proxy; fixture mode has
no upstream request path. It still requires the verified development Supabase
target and development credentials because the journey creates and cleans up
test-owned rows and storage objects. `npm run test:e2e:live` is a separate
single-document extraction smoke that calls the configured real provider with
generated synthetic evidence and reports strict success or a visible failure.
Never print model keys or use private project evidence.

## Architecture Boundary

The development flow is:

```text
TUS multi-file/ZIP intake -> Supabase Storage + ai_jobs -> n8n queue/orchestrator -> Next.js worker -> configured LLM -> Supabase evidence rows -> UI
Advisor -> scoped PostgreSQL full-text search -> fresh chunk IDs/locations -> citation validation -> conversation history
```

n8n remains the queue/orchestrator and Supabase remains the source of truth. The
browser suite can call the actual Next.js worker endpoint for queued development
jobs when n8n is unavailable. The route persists validated document suggestions;
the E2E helper separately persists returned chunks, an extraction-run record,
and terminal job/document state so the browser can use the real worker output.
Facts, summaries, snapshots, alerts, and actions use n8n's separate persistence
path, covered by n8n mapping behavior tests. This does not verify live n8n
connectivity or claim a production rollout.

See `DEPLOYMENT_HANDOFF.md` for the existing environment-specific handoff. The
Phase 6 development release and rollback procedure is
`planning-artifacts/product-recovery/phase-6-development-release-and-rollback.md`.
