# Project Assurance VPS Deployment Handoff

## Purpose and scope

Provider-neutral preparation guide for a Linux VPS. It does not assume a specific VPS provider, IP address, domain, or existing server state. The baseline runs Next.js under PM2, n8n and its PostgreSQL database with Docker Compose, and uses the existing hosted Supabase project.

This deployment assumes Supabase migrations have already been applied by the project owner. The deployer needs the environment values below; **do not run Supabase migrations or `supabase db push` as part of this runbook**. If a future application release introduces a migration, stop and have the Supabase owner handle it before deploying that release.

Never commit or send secrets in Git, screenshots, or public chat. Transfer them through a password manager or another approved secret channel.

## What must be prepared

### VPS and network

- Linux VPS with SSH and `sudo` access for the deploy account. Use an architecture with compatible Node.js and ONNX Runtime packages; this repo does not define a minimum CPU, RAM, or disk size.
- A domain and DNS records for the app and n8n are strongly recommended. Configure HTTPS before exposing either service.
- Public ingress: SSH (restrict source IPs if possible), HTTP, and HTTPS. Do not expose app port `3000` or n8n port `5678` directly to the Internet.
- Outbound HTTPS access to Supabase, the selected LLM provider, and package/model hosts during setup.
- If reusing a VPS, inventory running PM2 apps, Docker containers, and volumes first. Preserve an existing n8n `N8N_ENCRYPTION_KEY` and volumes; never run `docker compose down -v` as routine cleanup.

### Software to install

| Component | Requirement | Why |
|---|---|---|
| Node.js and npm | Node.js `22.18+` | Build and run Next.js |
| Python | Python `3.11` with `venv`/`pip` | Local OCR helper |
| OCR packages | `worker/ocr/requirements.txt` (`rapidocr==3.10.0`, `onnxruntime==1.31.0`) | PP-OCRv6 CPU inference |
| OCR model assets | Download once using `ppocr.py --prefetch` | The worker does not download models at request time |
| Ghostscript | Install the OS package providing `gs` | Rasterizes scanned PDF pages; not needed for image files or text-based PDFs |
| Docker Engine + Compose v2.24.4+ | Required | Runs n8n and its bundled PostgreSQL service; `!override` safely replaces the public port binding |
| PM2 | Install with npm | Keeps Next.js running across restarts |
| Nginx or Caddy | Reverse proxy with TLS | Publishes app and n8n through HTTPS |
| Git | Required | Checks out the approved release |

The current OCR is PP-OCRv6 tiny on ONNX Runtime CPU. It does **not** use Tesseract or CUDA. The configured `id` route is fixed configuration, not language detection. The worker README marks this OCR setup as a localhost pilot: before production use, validate Indonesian/English quality against a human-checked corpus and measure CPU throughput and memory on the actual VPS. No universal minimum VPS size is specified by the repository.

### Values the project owner supplies

- Supabase project URL, publishable key, and service-role key. The service-role key is required server-side by both the app and n8n; never expose it in a `NEXT_PUBLIC_*` variable.
- The final app URL. Before handing off, the owner must ensure the Supabase Auth Site URL and allowed redirect URLs include it; then the deployer needs no Supabase dashboard access. No database migration is needed.
- One configured LLM provider and its model/API credentials. Supported `XASS_LLM_PROVIDER` values: `ollama_cloud`, `ollama`, `openai-compatible`, `gemini`, or `groq`. Local `ollama` also requires Ollama and its model on the VPS. Hosted providers receive evidence text sent for analysis; choose one approved for that data. Provider failure is visible; there is no analysis fallback.
- A strong `XASS_WORKER_SECRET`; use the same value in the app and n8n.
- n8n internal PostgreSQL credentials and a persistent `N8N_ENCRYPTION_KEY`. Generate secrets, for example, with `openssl rand -hex 32`; keep the encryption key unchanged when reusing an n8n data volume.
- App and n8n hostnames, timezone, and TLS/reverse-proxy configuration.

## Runtime layout and data flow

- Next.js serves the UI and worker endpoint on port `3000` under PM2. It uses Supabase for Auth, database, and storage, and calls the selected LLM provider.
- n8n runs in Docker and polls Supabase every 60 seconds for document jobs. It calls the Next.js worker through `http://host.docker.internal:3000/api/workers/parse-document`.
- The worker parses supported evidence, uses the local OCR helper for images and scanned PDFs, and performs configured model calls. n8n completes the job through the database workflow.
- The polling workflow needs no inbound Supabase webhook. Keep only one polling workflow active; disable the alternate webhook workflow and Supabase Database Webhook while polling is used.

The parser supports PDF, DOCX, XLSX, PPTX, CSV, TXT, and PNG/JPG/JPEG/WEBP/TIF/TIFF/BMP images. Scanned-PDF OCR requires both PP-OCRv6 assets and Ghostscript.

## Step-by-step deployment

### 1. Confirm the target and record the release

Use a deploy account, not root, for app files and PM2. Before changing a reused VPS, check its current services and Docker volumes. Back up existing n8n data and retain its original encryption key if migrating an existing instance.

Choose a tested Git tag or commit supplied by the project owner. Do not deploy an unspecified moving branch such as `master`.

### 2. Install and verify the host prerequisites

Install the software listed above using the official instructions for the VPS operating system. On Debian/Ubuntu, the Ghostscript package is named `ghostscript`; other distributions use their package manager's equivalent.

Verify the installed tools:

```bash
node --version
npm --version
python3.11 --version
docker compose version
pm2 --version
gs --version
```

Confirm Node is `22.18` or newer and Docker Compose is `2.24.4` or newer. `!override` in the VPS-local Compose file requires this Compose version. `gs --version` is required when scanned PDFs will be processed. Docker Compose supplies the n8n PostgreSQL container; do not install a separate database for this stack.

### 3. Configure DNS, HTTPS, and ingress

Point the chosen app and n8n DNS names to the VPS. Configure the reverse proxy to terminate TLS and forward the app hostname to `http://127.0.0.1:3000` and the n8n hostname to `http://127.0.0.1:5678`.

Keep `3000` unavailable to public clients while allowing the n8n Docker container to reach the host worker through `host.docker.internal`. Bind the published n8n port to loopback using the Compose override in step 8. Allow only the proxy's HTTPS endpoint publicly.
Have the project owner set the Supabase Auth Site URL and redirect allowlist to the final app URL before the login check.

### 4. Check out the approved application release

Example path and command; replace `REPOSITORY_URL` and `RELEASE_TAG_OR_COMMIT` with values supplied by the owner:

```bash
mkdir -p ~/apps
cd ~/apps
git clone REPOSITORY_URL x-assurance
cd x-assurance
git checkout RELEASE_TAG_OR_COMMIT
```

### 5. Configure the app environment

Create the app environment file and restrict its permissions:

```bash
cp .env.example .env.local
chmod 600 .env.local
```

Set these values in `.env.local` before building:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-or-legacy-anon-key
NEXT_PUBLIC_SITE_URL=https://app.example.com
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
XASS_WORKER_SECRET=the-shared-worker-secret
XASS_LLM_PROVIDER=the-selected-provider
```

Add only the selected provider's matching credentials/model from `.env.example`. `XASS_OCR_PYTHON` is optional; the default is `.venv-ocr/bin/python`. `XASS_OCR_MODEL_DIR` is optional. The current OCR route is fixed in code; `XASS_OCR_LANG` is not needed.

### 6. Install the OCR runtime and assets

From the repository root:

```bash
python3.11 -m venv .venv-ocr
.venv-ocr/bin/pip install -r worker/ocr/requirements.txt
.venv-ocr/bin/python worker/ocr/ppocr.py --prefetch
.venv-ocr/bin/python worker/ocr/ppocr.py --check
```

`--prefetch` downloads the three pinned ONNX model files and verifies their SHA-256 hashes. It requires outbound HTTPS access to the model host. Repeat these setup commands if the OCR virtual environment is recreated. The request path never downloads models. For scanned PDFs, also install Ghostscript and verify `gs --version` succeeds.

### 7. Build and start Next.js

From the repository root, with `.env.local` already configured:

```bash
npm ci
npm run build
pm2 start npm --name xass -- start
pm2 startup
pm2 save
```

Run the command printed by `pm2 startup` with `sudo` so the deploy account's process list is restored after reboot. Check the local app response before configuring the public proxy:

```bash
curl -I http://127.0.0.1:3000
pm2 status
```

### 8. Configure and start n8n

From `workflows/n8n`:

```bash
cp .env.example .env
chmod 600 .env
```

Set the following in `.env`; keep `POSTGRES_PASSWORD` and `N8N_ENCRYPTION_KEY` private and stable:

```env
N8N_HOST=n8n.example.com
N8N_PORT=5678
N8N_PROTOCOL=https
WEBHOOK_URL=https://n8n.example.com/
N8N_SECURE_COOKIE=true
N8N_ENCRYPTION_KEY=stable-random-secret

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
XASS_DOCUMENT_WORKER_URL=http://host.docker.internal:3000/api/workers/parse-document
XASS_WORKER_SECRET=the-same-shared-worker-secret
N8N_BLOCK_ENV_ACCESS_IN_NODE=false
```

Also replace the internal `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` values from the template. `XASS_N8N_WEBHOOK_SECRET` is for the alternate webhook mode; it is not used by the polling deployment.

The checked-in Compose file publishes port `5678` on every host interface. Create a VPS-local override with `!override` so the public binding is replaced and only host-local services, including the reverse proxy, can reach n8n:

```bash
cat > docker-compose.override.yml <<'EOF'
services:
  n8n:
    ports: !override
      - "127.0.0.1:5678:5678"
EOF

docker compose -f docker-compose.yml -f docker-compose.override.yml up -d
docker compose -f docker-compose.yml -f docker-compose.override.yml ps
docker compose -f docker-compose.yml -f docker-compose.override.yml port n8n 5678
```

Confirm the reported binding is `127.0.0.1:5678`. Do not run `docker compose down -v`; it deletes n8n and PostgreSQL data volumes. When changing n8n environment values, recreate the service with `docker compose -f docker-compose.yml -f docker-compose.override.yml up -d --force-recreate`.

### 9. Import and activate the polling workflow

Open the HTTPS n8n hostname, finish the initial account setup, then import `workflows/n8n/x-assurance-supabase-document-polling.json`. Configure/verify the environment values, save, and activate this workflow only. Keep the webhook workflow inactive and the Supabase Database Webhook disabled. One active poller is the normal setup.

### 10. Run the deployment smoke check

Use synthetic or otherwise approved test evidence; the selected hosted LLM provider receives submitted evidence text.

1. Open the public app URL and sign in; confirm the Supabase redirect returns to the app.
2. Upload a text-based document and confirm its job reaches `completed` through the n8n polling workflow.
3. Upload a representative image and a scanned PDF. Confirm image OCR works; for the scanned PDF, confirm both Ghostscript rasterization and PP-OCRv6 OCR work.
4. Check n8n Executions and app/worker logs for errors. Confirm there is only one active polling workflow.
5. Verify app and n8n restart policies. During an approved maintenance window, reboot the VPS and confirm both return.

Before production use of OCR, complete the human-checked quality and target-VPS CPU/memory validation described in `worker/README.md`. Repository docs do not claim OCR is production-validated on every VPS.

## Normal update and recovery

Deploy only a tested release tag/commit. After checkout, update dependencies and build, then restart Next.js:

```bash
npm ci
npm run build
pm2 restart xass --update-env
pm2 save
```

Import and activate an updated n8n workflow JSON separately; Git checkout does not update an imported workflow. Do not change database schema in this runbook. For a faulty app release, return the app to the previous known-good tag/commit and rebuild. Preserve n8n volumes and encryption key. Never delete persistent data as a routine rollback.

Useful checks:

```bash
pm2 status
pm2 logs xass --lines 100
curl -I http://127.0.0.1:3000
cd ~/apps/x-assurance/workflows/n8n
docker compose ps
docker compose logs --tail=100 n8n
curl -I http://127.0.0.1:5678
```

`curl` to port `5678` is a local host check, not a recommendation to expose that port publicly.
