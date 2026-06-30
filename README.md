# Project Assurance

Project Assurance is a working demo for evidence-backed project assurance. The
app uses Next.js and Supabase for the product surface and data store. n8n
orchestrates document-processing jobs, and the Next.js worker endpoint parses
supported evidence files and calls the configured LLM when available.

## Current State

- Role-based project workspace with dashboard, documents, anomalies, AI
  assistant, and reports pages.
- Evidence file upload to Supabase Storage. PDF, TXT, CSV, DOCX, and XLSX files
  are queued for automated extraction; PowerPoint and image files are stored as
  reference evidence.
- Upload creates a `public.ai_jobs` row.
- The deployed n8n polling workflow checks Supabase for queued jobs every 15
  seconds. The webhook workflow remains available for local/tunnel or future
  HTTPS deployments.
- n8n calls the Next.js worker endpoint at
  `/api/workers/parse-document`.
- The worker extracts supported file text, uses the configured LLM when
  available, and
  returns chunks, facts, summary, alerts, actions, and health signals.
- n8n writes processed data back to Supabase tables used by the UI.
- Documents can be removed from the library, including related extracted
  evidence and storage files.
- Processed documents now feed the Documents, Dashboard, Anomalies, Assistant,
  and Reports pages through shared Supabase records.
- Dashboard can be refreshed from current evidence without a new upload.
- Reports can be generated, edited, marked reviewed, exported, and downloaded
  from recent exports.
- Project members can be viewed, added by Supabase Auth email, role-updated,
  and removed from a project by project managers/admins.

## Required Tools

- Node.js 20 or newer
- Docker Desktop
- Supabase hosted project
- n8n through the included Docker Compose file
- ngrok only when testing the optional webhook workflow locally
- A cloud LLM API key for hosted extraction and assistant/report writing
  (Ollama remains supported for local demos)

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
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-or-anon-key
NEXT_PUBLIC_SITE_URL=https://your-domain.example
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
XASS_WORKER_SECRET=use-the-same-value-as-n8n
XASS_LLM_PROVIDER=ollama_cloud
OLLAMA_CLOUD_BASE_URL=https://ollama.com/api
OLLAMA_API_KEY=your-ollama-api-key
OLLAMA_CLOUD_MODEL=gpt-oss:20b
```

`SUPABASE_SERVICE_ROLE_KEY` must stay server-only. Never put it in a
`NEXT_PUBLIC_*` variable.

## 3. Apply Supabase Migrations

Run every SQL file in `supabase/migrations` in order using the Supabase SQL
Editor, or use the Supabase CLI if your project is linked.

The latest migration needed for the current demo is:

```text
supabase/migrations/202606190001_allow_reference_evidence_file_types.sql
```

This allows non-PDF evidence to be saved in the document library. If
you have not applied the previous migrations yet, apply all files in
`supabase/migrations` in filename order.

## 4. Configure the LLM

For VPS deployment, use the cloud provider in the Next.js app environment:

```env
XASS_LLM_PROVIDER=ollama_cloud
OLLAMA_CLOUD_BASE_URL=https://ollama.com/api
OLLAMA_API_KEY=your-ollama-api-key
OLLAMA_CLOUD_MODEL=gpt-oss:20b
```

The app uses Ollama Cloud's native API at:

```text
{OLLAMA_CLOUD_BASE_URL}/chat
```

Do not put the cloud LLM key in `NEXT_PUBLIC_*` variables, the browser, or the
n8n workflow JSON. Keep it in `.env.local` locally and in your VPS secret/env
configuration for the Next.js process.

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
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
XASS_DOCUMENT_WORKER_URL=http://host.docker.internal:3000/api/workers/parse-document
XASS_N8N_WEBHOOK_SECRET=use-a-shared-webhook-secret
XASS_WORKER_SECRET=use-the-same-value-as-root-env
N8N_BLOCK_ENV_ACCESS_IN_NODE=false
```

Start n8n:

```powershell
docker compose -f workflows\n8n\docker-compose.yml --env-file workflows\n8n\.env up -d
```

Open:

```text
http://localhost:5678
```

Import:

```text
workflows/n8n/x-assurance-supabase-document-processing.json
```

Publish/activate the workflow. Use the production webhook URL, not the test URL.
Re-import this workflow after pulling changes because it now writes anomalies as
well as chunks, facts, summaries, dashboard health, alerts, and actions.

## 7. Expose n8n with ngrok

Supabase cannot call your local `localhost:5678`, so run:

```powershell
ngrok http 5678
```

Copy the HTTPS forwarding URL, then update `WEBHOOK_URL` in
`workflows/n8n/.env`:

```env
WEBHOOK_URL=https://your-ngrok-url.ngrok-free.app/
```

Restart n8n:

```powershell
docker compose -f workflows\n8n\docker-compose.yml --env-file workflows\n8n\.env restart n8n
```

If the ngrok URL changes, update `WEBHOOK_URL`, restart n8n, and update the
Supabase Database Webhook URL.

## 8. Create the Supabase Database Webhook

In Supabase Dashboard:

1. Go to Database Webhooks.
2. Create a webhook for table `public.ai_jobs`.
3. Event: `INSERT`.
4. Method: `POST`.
5. URL: n8n production URL:

```text
https://your-ngrok-url.ngrok-free.app/webhook/x-assurance-ai-jobs
```

6. Add headers:

```text
Content-Type: application/json
x-xass-workflow-secret: same-value-as-XASS_N8N_WEBHOOK_SECRET
```

Do not use `/webhook-test/` for the Supabase webhook. Test URLs only work while
the n8n editor is listening.

## 9. Demo Test Path

1. Sign in to the app.
2. Open a project.
3. Go to Documents.
4. Upload a PDF, TXT, CSV, DOCX, or XLSX file.
5. Confirm the file shows `Queued`, then `Processing`, then `Completed`.
6. Check n8n Executions for a successful run.
7. Refresh the Documents page and confirm extracted information, summary,
   source evidence, dashboard health, alerts, and actions are populated.
8. Upload a PowerPoint or image file and confirm it is saved in the Document
   Library as reference evidence with `Needs Review`.
9. Open Dashboard and use `Refresh from evidence` if you want to recompute the
   dashboard from the current facts and anomalies.
10. Open Reports, generate a preview, edit sections, mark it reviewed, export a
   PDF or DOCX, then use Recent Exports to download the real generated file.
11. Open Members and add another signed-up Supabase Auth user by email. Choose
   their project role, save changes, and confirm they can see the project after
   login.
12. Open AI Assistant and ask a project-scoped question. It uses local Ollama
    when `XASS_LLM_PROVIDER=ollama`, or the configured cloud provider when
    `XASS_LLM_PROVIDER=ollama_cloud`.
13. Use the document menu to remove old demo documents from the library.

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

Check n8n can reach Supabase:

```powershell
docker exec aisx-n8n node -e "const dns=require('dns'); dns.lookup('your-project.supabase.co',(e,a)=>{console.log(e?e.message:a); process.exit(e?1:0)})"
```

Check n8n can reach the Next.js worker:

```powershell
docker exec aisx-n8n node -e "fetch('http://host.docker.internal:3000').then(r=>console.log(r.status)).catch(e=>{console.error(e.message); process.exit(1)})"
```

Run local validation:

```powershell
npm run lint
npm test
```

## Architecture Boundary

The deployed demo flow is:

```text
Next.js upload -> Supabase ai_jobs -> n8n polling -> Next.js worker -> cloud LLM -> Supabase tables -> UI
```

n8n is the orchestrator. Supabase remains the source of truth. The app does not
directly call n8n after upload.

See `DEPLOYMENT_HANDOFF.md` for the current VPS configuration, deployment
procedure, and troubleshooting guide.
