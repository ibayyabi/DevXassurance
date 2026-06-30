# Project Assurance Deployment Handoff

## Purpose

Project Assurance is a demo application that turns project evidence into
structured assurance information. Users create projects, upload evidence, and
review document summaries, extracted facts, health scores, anomalies,
assistant answers, and reports.

This document describes the current VPS deployment. Do not put real secret
values in this file, Git, screenshots, or chat messages.

## Current Deployment

| Component | Location | Responsibility |
|---|---|---|
| Next.js | VPS, PM2, port `3000` | UI, authentication integration, server actions, file-processing worker, LLM calls |
| n8n | VPS, Docker, port `5678` | Polls and orchestrates document-processing jobs |
| n8n PostgreSQL | VPS, Docker internal network | Stores n8n configuration and executions |
| Supabase | Hosted cloud project | Auth, PostgreSQL data, RLS, and file storage |
| Ollama Cloud | Hosted API | Document analysis, assistant responses, and generated narrative |
| Nginx | VPS, port `80` | Temporary HTTP access/reverse proxy for n8n administration |

The current VPS public IP is `103.37.125.131`. This is a demo configuration
without a domain or HTTPS. A public production deployment should use a domain,
TLS, restricted n8n access, and rotated secrets.

## Data Flow

```text
Browser
  -> Next.js upload
  -> Supabase Storage + documents row + queued ai_jobs row
  -> n8n polls ai_jobs every 15 seconds
  -> n8n atomically changes one job from queued to processing
  -> n8n calls the Next.js document worker
  -> worker downloads and parses the source file
  -> worker calls Ollama Cloud
  -> n8n writes chunks, facts, summaries, health, alerts, actions, and anomalies
  -> UI reads the resulting project-scoped Supabase records
```

The AI Assistant and report-generation server actions call the configured
cloud LLM from Next.js. n8n does not host an AI model.

Supported extraction formats are PDF, TXT, CSV, DOCX, and XLSX. Other formats
are stored as reference evidence and flagged as unsupported for extraction.

## Important Files

| File | Purpose |
|---|---|
| `.env.local` | Next.js, Supabase, worker-secret, and LLM configuration |
| `workflows/n8n/.env` | n8n database, Supabase, and worker configuration |
| `workflows/n8n/docker-compose.yml` | n8n and its PostgreSQL service |
| `workflows/n8n/x-assurance-supabase-document-polling.json` | Active VPS workflow |
| `workflows/n8n/x-assurance-supabase-document-processing.json` | Optional webhook workflow |
| `supabase/migrations/` | Database schema and RLS migrations |

Never commit `.env.local` or `workflows/n8n/.env`.

## Runtime Configuration

The root `.env.local` requires:

```env
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
XASS_WORKER_SECRET=...

XASS_LLM_PROVIDER=ollama_cloud
OLLAMA_CLOUD_BASE_URL=https://ollama.com/api
OLLAMA_API_KEY=...
OLLAMA_CLOUD_MODEL=gpt-oss:20b
TZ=Asia/Jakarta
```

The n8n `.env` requires:

```env
POSTGRES_USER=n8n_user
POSTGRES_PASSWORD=...
POSTGRES_DB=n8n
N8N_HOST=103.37.125.131
N8N_PORT=5678
N8N_PROTOCOL=http
WEBHOOK_URL=http://103.37.125.131/
N8N_ENCRYPTION_KEY=...
N8N_SECURE_COOKIE=false
GENERIC_TIMEZONE=Asia/Jakarta
TZ=Asia/Jakarta
N8N_DIAGNOSTICS_ENABLED=false
N8N_PERSONALIZATION_ENABLED=false
N8N_DEFAULT_BINARY_DATA_MODE=filesystem
N8N_RESTRICT_FILE_ACCESS_TO=/files
N8N_BLOCK_ENV_ACCESS_IN_NODE=false

SUPABASE_URL=https://PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
XASS_DOCUMENT_WORKER_URL=http://host.docker.internal:3000/api/workers/parse-document
XASS_WORKER_SECRET=...
```

`XASS_WORKER_SECRET` must match in both files. Keep
`N8N_ENCRYPTION_KEY` stable; changing it prevents n8n from decrypting stored
credentials.

## Normal Operations

Check the application:

```bash
pm2 status
pm2 logs xass --lines 100
curl -I http://127.0.0.1:3000
```

Check n8n:

```bash
cd ~/apps/XAss/workflows/n8n
docker compose ps
docker compose logs --tail=100 n8n
curl -I http://127.0.0.1:5678
```

The polling workflow must be published. The old webhook workflow and Supabase
Database Webhook should remain disabled while polling is active.

## Deploying Code Updates

Push tested changes to GitHub, then on the VPS:

```bash
cd ~/apps/XAss
git pull origin master
npm ci
npm run build
pm2 restart xass --update-env
pm2 save
```

Run database migrations separately in Supabase when an update adds migration
files. Workflow JSON changes are not automatically imported into n8n; import
the updated JSON in the n8n editor and publish the new version.

For Compose or n8n environment changes:

```bash
cd ~/apps/XAss/workflows/n8n
docker compose up -d --force-recreate
docker compose ps
```

Do not run `docker compose down -v` during normal operation. It deletes n8n and
PostgreSQL volumes.

## Changing VPS or IP

When only the public IP changes:

1. Update `N8N_HOST` and `WEBHOOK_URL` in `workflows/n8n/.env`.
2. Update the Nginx `server_name` if it contains the old IP.
3. Update Supabase Auth Site URL and allowed redirect URLs.
4. Allow ports `22`, `80`, and `3000` in the VPS/provider firewall.
5. Recreate n8n and restart Next.js.
6. Test login, upload, polling, LLM extraction, assistant, and reports.

Polling does not require Supabase to call the VPS, so no Supabase Database
Webhook URL needs changing.

When moving to a new VPS:

1. Install Git, Node.js 20+, Docker Compose, PM2, and Nginx/Caddy.
2. Clone the repository and restore both environment files securely.
3. Preserve the existing n8n Docker volumes or export/import workflows.
4. Preserve `N8N_ENCRYPTION_KEY`.
5. Build Next.js and start it under PM2.
6. Start n8n with Docker Compose and publish the polling workflow.
7. Apply firewall and Supabase Auth URL changes.

For a domain deployment, proxy the application and n8n through HTTPS. Set
secure cookies back to `true` and avoid exposing ports `3000` and `5678`
directly to the internet.

## Troubleshooting

### Site is unreachable

```bash
pm2 status
pm2 logs xass --lines 100
curl -I http://127.0.0.1:3000
sudo ss -lntp | grep 3000
sudo ufw status
```

If localhost works but the public URL does not, check the IDCloudHost firewall
and public IP.

### Document remains queued

1. Confirm a queued row exists in Supabase `public.ai_jobs`.
2. Confirm the polling workflow is published.
3. Check n8n Executions for a run within the last 15 seconds.
4. Verify n8n has `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and
   `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`.
5. Confirm only one polling workflow is published.

### Job remains processing or fails

```bash
docker compose logs --tail=150 n8n
pm2 logs xass --lines 150
docker exec aisx-n8n node -e "fetch('http://host.docker.internal:3000').then(r=>console.log(r.status)).catch(e=>{console.error(e.message);process.exit(1)})"
```

Check that `XASS_WORKER_SECRET` matches in both environments and that the
document storage path still exists.

### LLM fallback warning

The LLM configuration belongs in root `.env.local`, not n8n `.env`.

```bash
cd ~/apps/XAss
grep -E '^(XASS_LLM_PROVIDER|OLLAMA_CLOUD_BASE_URL|OLLAMA_CLOUD_MODEL)=' .env.local
grep -q '^OLLAMA_API_KEY=.\+' .env.local && echo configured || echo missing
```

Test Ollama Cloud using the configured model:

```bash
set -a
source .env.local
set +a
curl -sS https://ollama.com/api/chat \
  -H "Authorization: Bearer $OLLAMA_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"$OLLAMA_CLOUD_MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with OK\"}],\"stream\":false}"
```

After changing LLM variables:

```bash
pm2 restart xass --update-env
```

Re-upload a document because saved fallback outputs are not regenerated
automatically.

### n8n does not start

```bash
cd ~/apps/XAss/workflows/n8n
docker compose ps -a
docker compose logs --tail=150 postgres
docker compose logs --tail=150 n8n
```

`ENOTFOUND postgres` means the PostgreSQL container/network is unavailable.
An encryption-key mismatch means the configured key differs from the key used
to create the existing n8n data volume. Restore the original key rather than
deleting production volumes.

### Login redirects incorrectly

Update Supabase Authentication URL Configuration with the current public
application URL. Confirm the Site URL and allowed redirect patterns both use
the same scheme, host, and port.

### Upload or database operations fail

Check the Next.js PM2 error log, Supabase Storage bucket, RLS policies, and
migration status. Confirm the publishable key is used in browser code and the
service-role key is only present server-side.

## Demo Acceptance Check

Before handing the demo to users:

1. Sign in and create or select a project.
2. Upload a supported evidence file.
3. Confirm its job moves `queued -> processing -> completed`.
4. Confirm extracted facts and an LLM-backed summary appear.
5. Refresh and inspect the dashboard.
6. Open anomalies and verify evidence links.
7. Ask the AI Assistant a project-scoped question.
8. Generate and download a report.
9. Add a project member and verify project access.
10. Restart the VPS services and confirm they recover automatically.
