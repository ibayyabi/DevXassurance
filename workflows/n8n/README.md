# n8n Workflows

## Supabase Document Processing

Import `x-assurance-supabase-document-processing.json` into n8n.

This workflow is designed around the app's Supabase schema. Supabase remains
the source of truth; n8n only orchestrates the processing job and writes results
back to the tables already used by the UI.

### Local n8n with Docker

From this folder:

```bash
cp .env.example .env
docker compose up -d
```

Then open:

```text
http://localhost:5678
```

Import `x-assurance-supabase-document-processing.json`, open the webhook node,
copy the production URL, and activate the workflow.

If Supabase is hosted in the cloud, it cannot call your machine's
`localhost:5678` directly. Use a public tunnel for local testing, for example:

```bash
ngrok http 5678
```

Then set `WEBHOOK_URL` in `workflows/n8n/.env` to the public tunnel URL and
restart n8n:

```bash
docker compose restart n8n
```

### Required n8n environment variables

Set these in the n8n runtime, not in the public Next.js app:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
XASS_DOCUMENT_WORKER_URL=http://host.docker.internal:3000/api/workers/parse-document
```

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

The LLM variables belong to the Next.js app because the worker endpoint calls
the configured LLM after parsing the PDF. n8n only calls the worker.

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

If that model is too heavy for your machine, use another available model and
set `OLLAMA_MODEL` to that name. The worker falls back to rule-based extraction
if Ollama is unavailable.

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

