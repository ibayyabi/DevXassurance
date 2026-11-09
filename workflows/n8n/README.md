# n8n Workflows

## Supabase Document Processing

Import `x-assurance-supabase-document-processing.json` into n8n.

This workflow is designed around the app's Supabase schema. Supabase remains
the source of truth; n8n only orchestrates the processing job and writes results
back to the tables already used by the UI.

## Automatic Assessment

Import `x-assurance-automatic-assessment.json` into n8n.

This workflow refreshes the published assessment for a project cut-off without
anyone opening the dashboard, and it never calls a model:

1. `public.complete_document_job` queues an assessment for the document's
   reviewer-confirmed reporting period inside the same transaction that
   publishes the observations. Reviewer decisions, approved baselines, accepted
   mappings, rule approvals, and later backfills queue the affected cut-off and
   every cut-off after it the same way.
2. The workflow drains that queue through the app route
   `/api/internal/assurance/assessment`. The route claims one cut-off per
   project at a time with a rotating claim token, computes the same
   deterministic findings a manual review would, and publishes an immutable
   snapshot carrying its cut-off, source versions, coverage, and gaps.
3. The five-minute schedule is the safety net: a missed webhook, an expired
   lease, or a retry waiting on backoff is picked up automatically.

Required n8n environment variables:

```bash
XASS_APP_URL=https://your-app-host
XASS_ASSESSMENT_SECRET=same-value-as-the-root-app
XASS_ASSESSMENT_WEBHOOK_SECRET=optional-shared-secret-for-the-webhook-entry
XASS_ASSESSMENT_BATCH_LIMIT=5
```

Optional Supabase Database Webhook for low latency:

- Table: `public.assurance_assessment_jobs`
- Event: `INSERT`
- Method: `POST`
- URL: the production n8n webhook URL for `x-assurance-assessment-jobs`
- Header, if using the optional secret:
  `x-xass-assessment-webhook-secret: <XASS_ASSESSMENT_WEBHOOK_SECRET>`

The root app `.env.local` also needs:

```bash
XASS_ASSESSMENT_SECRET=same-value-as-n8n
```

Only documents whose reviewer-confirmed reporting period and evidence role are
set become assessment evidence; the upload date, the file name, the maximum
observation date, and the document date are never used as a cut-off. A document
without a confirmed period appears as an evidence gap, not as an assessment.
Publishing a snapshot never rewrites an older one: newer input produces a new
generation and marks the previous snapshot stale.

## VPS polling mode

Use `x-assurance-supabase-document-polling.json` when Supabase cannot reach the
VPS webhook. This workflow does not require an inbound request from Supabase.
Every 60 seconds it:

1. requests the oldest queued `parse_document` job from Supabase;
2. claims it only if its status is still `queued`; and
3. runs the same document-processing pipeline as the webhook workflow.

The polling workflow uses these n8n environment variables:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
XASS_DOCUMENT_WORKER_URL=http://host.docker.internal:3000/api/workers/parse-document
XASS_WORKER_SECRET=same-value-as-the-root-app
N8N_BLOCK_ENV_ACCESS_IN_NODE=false
```

On the VPS:

1. Import `x-assurance-supabase-document-polling.json`.
2. Publish the polling workflow.
3. Unpublish the webhook workflow to avoid two consumers.
4. Disable the Supabase Database Webhook for `public.ai_jobs`.
5. Upload a new document and inspect n8n Executions.

The job is claimed from Supabase and the worker maintains a 15-minute lease
while extraction groups complete. A transient worker failure is left for
bounded lease recovery; deterministic validation failures are terminal. Partial
results use `needs_review` and retain explicit quality warnings. If there are no
queued or recoverable jobs, a polling execution ends without writes. Keep only
one published polling workflow unless you intentionally introduce additional
queue coordination.

### Local n8n with Docker

From this folder, create `.env` if needed, populate its n8n/Supabase values, then validate and start Compose with the root app environment included. This makes the app's `XASS_ASSESSMENT_SECRET` available without duplicating the secret in this folder's `.env`.

```bash
[ -f .env ] || cp .env.example .env
docker compose --env-file .env --env-file ../../.env.local config --quiet
docker compose --env-file .env --env-file ../../.env.local up -d
```

Then open:

```text
http://localhost:5678
```

For local HTTP, `.env` sets `N8N_SECURE_COOKIE=false` so Chromium-based
debugging sessions can authenticate. Do not use that setting on a public
HTTP endpoint; use HTTPS and set it to `true` instead.

The Docker configuration saves in-progress execution data so a live execution
can be inspected node by node. This increases database writes.

Import and activate `x-assurance-supabase-document-polling.json`.

The polling workflow is the default local mode. It checks Supabase every
60 seconds and calls the local Next.js worker through `host.docker.internal`,
so no ngrok tunnel or inbound Supabase webhook is required.

Keep the webhook workflow and Supabase Database Webhook disabled while polling
is active. Only one polling workflow may be published.

### Required n8n environment variables

Set these in the n8n runtime, not in the public Next.js app:

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
XASS_DOCUMENT_WORKER_URL=http://host.docker.internal:3000/api/workers/parse-document
XASS_APP_URL=http://host.docker.internal:3000
XASS_ASSESSMENT_SECRET=same-value-as-root-app

Optional:

```bash
XASS_N8N_WEBHOOK_SECRET=shared-secret-sent-by-supabase-webhook
XASS_WORKER_SECRET=shared-secret-sent-to-worker
```

Never expose `SUPABASE_SERVICE_ROLE_KEY` in browser code or any
`NEXT_PUBLIC_*` variable.

The root app `.env.local` also needs:

```bash
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
XASS_WORKER_SECRET=same-value-as-n8n
XASS_LLM_PROVIDER=ollama_cloud
OLLAMA_CLOUD_BASE_URL=https://ollama.com/api
OLLAMA_API_KEY=your-ollama-api-key
OLLAMA_CLOUD_MODEL=gpt-oss:20b
```

To use Gemini instead, keep these settings in the root app `.env.local`:

```env
XASS_LLM_PROVIDER=gemini
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-3.8-flash
```

To use Groq instead, keep these settings in the root app `.env.local`:

```env
XASS_LLM_PROVIDER=groq
GROQ_API_KEY=your-groq-api-key
GROQ_MODEL=your-groq-model-id
```

Choose a model available to your Groq account; access, pricing, and rate limits
vary by model and account.

To use a local 9router combo instead, configure the Next.js app:

```env
XASS_LLM_PROVIDER=openai-compatible
XASS_CLOUD_LLM_BASE_URL=http://localhost:20128/v1
XASS_CLOUD_LLM_API_KEY=your-9router-api-key
XASS_CLOUD_LLM_MODEL=executor-free
```

The worker requests non-streaming JSON. Restart the Next.js app after changing
environment variables; the n8n container does not call 9router directly.

The LLM variables belong to the Next.js app because its worker calls the
configured provider after parsing a document; n8n only calls the worker.

For a local Ollama demo instead, use:

```bash
XASS_LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:3b
```

Make sure Ollama is running and the model exists:

```bash
ollama pull qwen2.5:3b
```

If that model is too heavy for your machine, choose another available model and
set `OLLAMA_MODEL` to its name. If Ollama is unavailable, the worker reports the
provider failure; it does not produce fallback analysis.

### Supabase Database Webhook

Create a Supabase Database Webhook:

- Table: `public.ai_jobs`
- Event: `INSERT`
- Filter/condition: `job_type = parse_document` and `status = queued`
- Method: `POST`
- URL: the production n8n webhook URL for `x-assurance-ai-jobs`
- Header, if using the optional secret:
  `x-xass-workflow-secret: <XASS_N8N_WEBHOOK_SECRET>`

The app creates this queued job after a document upload.

### Worker response contract

The workflow calls `XASS_DOCUMENT_WORKER_URL` with:

```json
{
  "job_id": "uuid",
  "project_id": "uuid",
  "document_id": "uuid",
  "storage_bucket": "project-evidence",
  "storage_path": "project-id/file.pdf",
  "title": "Progress Report",
  "file_name": "progress-report.pdf",
  "document_type": "progress_report",
  "document_date": "2026-06-09"
}
```

The worker should return:

```json
{
  "chunks": [
    {
      "chunk_index": 0,
      "chunk_text": "source text",
      "page_number": 1,
      "section_label": "Executive Summary",
      "parser_metadata": {}
    }
  ],
  "facts": [
    {
      "fact_type": "risk",
      "extracted_text": "Vendor delay in critical path",
      "original_value": "Vendor delay in critical path",
      "confidence": 0.9,
      "evidence_chunk_index": 0,
      "excerpt": "source excerpt"
    }
  ],
  "summary": {
    "summary_text": "Grounded document summary.",
    "confidence": 0.82,
    "quality_warning": null
  },
  "health_snapshots": [],
  "alerts": [],
  "actions": [],
  "anomalies": [
    {
      "category": "accountability",
      "missing_field": "owner",
      "severity": "high",
      "title": "Missing owner for risk",
      "affected_item": "Vendor delay in critical path",
      "explanation": "The extracted risk does not include a confirmed owner.",
      "impact": "An unowned signal may delay mitigation.",
      "impact_rating": "High",
      "recommended_action": "Assign an owner and confirm mitigation.",
      "suggested_owners": [],
      "evidence_count": 1,
      "absence_type": "not_found_in_evidence",
      "rationale": "Generated from document processing output."
    }
  ]
}
```

Valid fact types are `risk`, `issue`, `milestone`, `decision`, and
`owner_action`.

