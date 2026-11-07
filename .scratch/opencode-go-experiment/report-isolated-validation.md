# Isolated validation: repaired OCR runtime and disposable local DB

## 0. Scope and constraints

- Repo: `/Users/iweng/Documents/GitHub/DevXassurance`; branch `development-bismillah-final`; HEAD `784a04d`.
- No commits, pushes, resets, checkouts, fixture edits, or source edits in this session.
- No `.env*`, credentials, auth store, or secret files read.
- No LLM provider/model call from the application or tests. Network was used only for: pinned PyPI packages, pinned OCR assets, and the already-local Docker image (no DB image pull was needed).
- Fresh disposable root: `.local-evaluation/isolated-validation-2026-11-06/` (gitignored via `.gitignore:19`).
- Raw evidence logs were written only there.

## 1. OCR runtime repair and real OCR execution

### 1.1 Fresh isolated Python environment

Commands:

```sh
mkdir -p .local-evaluation/isolated-validation-2026-11-06
python3.11 -m venv .local-evaluation/isolated-validation-2026-11-06/venv
.local-evaluation/isolated-validation-2026-11-06/venv/bin/python -m pip install \
  --disable-pip-version-check -r worker/ocr/requirements.txt
```

Result: `python 3.11.16`, `pip 24.0`. Installed exactly the pinned set:

```
rapidocr==3.10.0
onnxruntime==1.31.0
```

The existing `.venv-ocr` and the user environment were not touched.

### 1.2 Pinned model prefetch and checksum validation

Used the project's existing `worker/ocr/ppocr.py --prefetch` with an isolated model directory:

```sh
export XASS_OCR_MODEL_DIR="$PWD/.local-evaluation/isolated-validation-2026-11-06/models"
mkdir -p "$XASS_OCR_MODEL_DIR"
.local-evaluation/isolated-validation-2026-11-06/venv/bin/python worker/ocr/ppocr.py --prefetch --json
.local-evaluation/isolated-validation-2026-11-06/venv/bin/python worker/ocr/ppocr.py --check --json
```

Both exited `0`. The configured source (`modelscope.cn`, pinned `v3.10.0`) worked on the first attempt; no alternate source was needed. Verified SHA-256:

| Asset | SHA-256 | Bytes |
|---|---|---:|
| `PP-OCRv6_det_tiny.onnx` | `f42c0fbd294d95eac1a550e131b277dac97462c8025fa4b6c3cec1b7894bd3d5` | 1,829,618 |
| `PP-OCRv6_rec_tiny.onnx` | `e16e242de5937ad92609223f19bc2aff3727ee40b095f996907c24749bad251b` | 4,489,813 |
| `ch_ppocr_mobile_v2.0_cls_mobile.onnx` | `e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c` | 585,532 |

`--check` reported `rapidocr 3.10.0`, `onnxruntime 1.31.0`, route `id`.

### 1.3 Actual OCR on an image and a scanned PDF

Generated a real PNG containing `OCR SOURCE 4821` and a scanned PDF from it, then:
- OCR'd the PNG directly with `ppocr.py --images`.
- Rasterized the scanned PDF with Ghostscript (`-sDEVICE=pnggray -r220`) and OCR'd the page.

Both returned exit `0` and the exact text:

```json
{"ok": true, "engine": "rapidocr", "model": "tiny", "backend": "onnxruntime-cpu",
 "route": "id", "results": [{"index": 0, "text": "OCR SOURCE 4821"}]}
```

Then exercised the **production parser** (`parseDocumentBuffer`) against both inputs with
`XASS_OCR_PYTHON` and `XASS_OCR_MODEL_DIR` set (`.local-evaluation/.../exercise-parser.mjs`):

| Input | `ok` | Extracted text | Metadata |
|---|---|---|---|
| `scan.png` | `true` | `OCR SOURCE 4821` | `parser=rapidocr`, `ocrEngine=rapidocr`, `ocrModel=PP-OCRv6`, `ocrRoute=id`, pinned versions + hashes, image location |
| `scanned.pdf` | `true` | `OCR SOURCE 4821` | `parser=pdfjs-dist`, `scannedPageCount=1`, `ocrEngine=rapidocr`, page 1 location |

So image OCR, scanned-PDF rasterization + OCR, and parser→OCR integration all genuinely work.

### 1.4 The previously failing OCR test: actual result

Command:

```sh
export XASS_OCR_PYTHON="$PWD/.local-evaluation/isolated-validation-2026-11-06/venv/bin/python"
export XASS_OCR_MODEL_DIR="$PWD/.local-evaluation/isolated-validation-2026-11-06/models"
node --test --test-name-pattern "available local OCR" \
  tests/integration/phase6-document-parser.test.mjs
```

Result: **1 test, 0 pass, 1 fail, 0 skipped** (exit `1`). The failure is at
`tests/integration/phase6-document-parser.test.mjs:609`:

```
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
undefined !== 'eng'
```

This is **not** an environment/OCR failure. The test reached and passed the OCR-text
assertions (`:607` text matches `/OCR SOURCE/`, `:608` image location), then failed on
`parserMetadata.ocrLanguage === "eng"`.

Root cause: the test is stale relative to the PP-OCRv6 migration. It asserts the removed
Tesseract contract:

- `XASS_OCR_LANG` (`eng`, `xass_missing_language`),
- `parserMetadata.ocrLanguage === "eng"`,
- `errorCode === "ocr_language_unavailable"` mentioning `XASS_OCR_LANG`.

The production parser (`worker/src/services/document-parser.ts`) implements PP-OCRv6/RapidOCR
with route `id` and emits `ocrEngine/ocrModel/ocrRoute/ocrRuntimeVersions/ocrModelSha256`; it
has no `XASS_OCR_LANG` or `ocrLanguage` anywhere. `planning-artifacts/product-recovery/ocr-pp-ocrv6-migration-prd.md`
explicitly says `XASS_OCR_LANG` MUST be removed after the transition.

**Exact blocker:** environment is repaired and OCR works, but this test cannot pass until its
assertions are updated from Tesseract semantics to PP-OCRv6 semantics. The test was not
modified and was not skipped.

## 2. Real isolated disposable local database

### 2.1 Docker availability

- Docker Desktop was not running (`docker info` failed on `unix:///Users/iweng/.docker/run/docker.sock`).
- Started it with `open -a Docker`; daemon became reachable, server `29.8.2`.
- Note: Docker Desktop's configured restart policies auto-started existing Supabase containers
  (`supabase_*_pmo-mapping-final`). They were **not** modified, stopped, or removed.
- The required image was already local: `public.ecr.aws/supabase/postgres:17.6.1.167`, matching
  `supabase/config.toml` `major_version = 17`. No DB image pull was needed.

### 2.2 New exclusively named container

```sh
docker run -d --name xass-disposable-test-20261106 \
  -e POSTGRES_PASSWORD=postgres \
  -p 127.0.0.1:55432:5432 \
  public.ecr.aws/supabase/postgres:17.6.1.167
```

Name matches the harness disposable allowlist (`test|disposable|smoke`). It was removed after
validation.

### 2.3 Provisioning shims (recorded explicitly)

The raw image is a clean Supabase Postgres, not a full local stack. Three shims were applied
only inside the disposable container:

1. **`storage` schema bootstrap** (`.local-evaluation/.../storage-bootstrap.sql`): storage-api
   normally owns this schema. Created minimal `storage.buckets`, `storage.objects`
   (`id/bucket_id/name/metadata/...`), `storage.foldername(text)`, and grants for
   `anon/authenticated/service_role`. Only objects/columns/functions referenced by migrations
   and pgTAP suites were created. **This is not the full storage-api schema.**
2. **`auth.users.email_confirmed_at`** added because the image ships an older auth schema; the
   suites insert that GoTrue column.
3. **`pgtap` installed into `extensions`** and `auth.uid()/auth.role()` replaced with the modern
   implementation that also reads `request.jwt.claims` (the image only read
   `request.jwt.claim.sub`, so every suite was unauthorized).

These shims make the container match the contract the project's tooling expects; they do not
alter production code or any user database.

### 2.4 Migrations

Bootstrap ran as `supabase_admin`; migrations ran as `postgres`:

```sh
for f in $(ls supabase/migrations/*.sql | sort); do
  docker exec -i xass-disposable-test-20261106 psql -U postgres -d postgres \
    -v ON_ERROR_STOP=1 < "$f"
done
```

Result: all **47/47** migrations applied, exit `0` each. Logs: `db-bootstrap.log`,
`db-provision-extra.log`.

### 2.5 Existing project tooling

```sh
XASS_DB_CONTAINER=xass-disposable-test-20261106 npm run test:db
```

Each suite runs inside one transaction that always rolls back; the target is left unchanged.

| Suite | Result |
|---|---|
| `document_job_fencing.test.sql` | valid TAP, **32/32** passed |
| `document_job_fencing_callers.test.sql` | valid TAP, **69/69** passed |
| `document_job_reliability.test.sql` | valid TAP, **38/38** passed |
| `risk_snapshot_atomicity.test.sql` | valid TAP, **32/32** passed |
| `partial_evidence_review.test.sql` | **43/45**, assertions 38 and 40 failed |

Exit `1` because of the last suite. Exact failures:

- #38: expected `analysis_error = 'Reviewer decisions changed. Run the analysis again.'`,
  got `'Selected evidence changed. Run the analysis again.'`
- #40: expected `analysis_metadata.observation_decision_invalidation.reason` to be non-null;
  it is absent.

Classification: **genuine current-code behavior, not environment**. In
`supabase/tests/partial_evidence_review.test.sql` the simulated `last_success.fingerprint` is
literally `'x'`. The `assurance_reviews` update to `analyzing` fires
`invalidate_assurance_prior_risk_change`, which (for `assurance_reviews`) calls
`invalidate_assurance_reference_results(project_id)` with source-change checking enabled. It
therefore marks the review `evidence_ready` with `Selected evidence changed` before the decision
invalidation runs. The 050003 trigger's observation-first ordering cannot recover because the
review is already `evidence_ready`. The other four suites, including the 32-assertion
`risk_snapshot_atomicity` suite, pass.

**Exact blocker:** 2 assertions in `partial_evidence_review` expose an invalidation-reason
ordering mismatch between `202611050001_assurance_observation_decisions.sql` and the
`assurance_reviews` branch of `202611050003_risk_snapshot_atomicity.sql`. It is reproducible on
a real isolated Postgres 17 database.

### 2.6 Isolation integrity

- Never connected to a remote/production database.
- Never read or used `.env*`.
- Never touched `supabase_db_pmo-mapping-final` or any pre-existing container/database.
- The new container was removed with `docker rm -f xass-disposable-test-20261106`; it is gone.
- Docker Desktop remains running; existing containers were left as they were found after startup.

## 3. Final focused checks

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit -p tsconfig.json` | exit **0** |
| Full suite (once) | `XASS_OCR_PYTHON=... XASS_OCR_MODEL_DIR=... npm test` | **290 tests, 289 pass, 1 fail, 0 skipped**, 3.42 s |
| DB suites | `XASS_DB_CONTAINER=xass-disposable-test-20261106 npm run test:db` | 4/5 suites valid; see §2.5 |
| Real OCR | `ppocr.py --check/--images`, parser exercise | **pass**, exact text `OCR SOURCE 4821` |

The single full-suite failure is the stale OCR assertion described in §1.4. No UI, assurance,
provenance, parser, or DB-independent test regressed.

**No API LLM use:** the full suite's provider tests replace `globalThis.fetch` with deterministic
mocks (e.g. `groq-provider.test.mjs`, `phase6-document-extraction.test.mjs`,
`evidence-provenance.test.mjs`); no provider key or endpoint was called. This session's DB and OCR
runs are entirely local.

## 4. Integrity and artifacts

- `git status --porcelain -- demo-evidence-fixtures` → **0 lines**; fixtures unchanged.
- No source files, tests, or fixtures were edited in this session.
- Prior user changes remain intact (`.gitignore`, `AGENTS.md`, `README.md`, `worker/README.md`,
  `worker/src/services/document-extraction.ts`, `worker/src/services/document-parser.ts`, the
  modified integration tests, `tests/integration/wbs-header-provenance.test.mjs`).
- `.local-evaluation/` is gitignored; validation artifacts live there.
- No commit, push, or reset.

Evidence hashes:

| Artifact | SHA-256 |
|---|---|
| `models/PP-OCRv6_det_tiny.onnx` | `f42c0fbd294d95eac1a550e131b277dac97462c8025fa4b6c3cec1b7894bd3d5` |
| `models/PP-OCRv6_rec_tiny.onnx` | `e16e242de5937ad92609223f19bc2aff3727ee40b095f996907c24749bad251b` |
| `models/ch_ppocr_mobile_v2.0_cls_mobile.onnx` | `e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c` |
| `db-bootstrap.log` | `2b3be809f352af333d1ad5053c982a770dd1884e09736ee59282510d4b925f7a` |
| `db-provision-extra.log` | `c26ab8d38657d8774be90b9e644f0ece67905afcf9fe400632f802f7b72f23ed` |
| `db-test.log` | `6e835eb99a672a9aa75ba5124df7d69cc8ab1ff6eb9d550d01a43e0866ef7da3` |
| `ocr-test.log` | `5c5bcab69c77da4c879fd1aeff6a11554e84d1a04c255615a1413c3cd71ba143` |
| `parser-exercise.log` | `e3867a37a7ac85a27f21ee63e8752169d79270d77b463ed60e485e0bc1341ffd` |
| `full-suite.log` | `71535cf4dbf40b673d5fdf62c44bb612fe3afb28474b211f0fd945e306937078` |
| `tsc.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (empty, exit 0) |

## 5. Reproduce

```sh
ROOT=.local-evaluation/isolated-validation-2026-11-06

# OCR environment
python3.11 -m venv "$ROOT/venv"
"$ROOT/venv/bin/python" -m pip install -r worker/ocr/requirements.txt
export XASS_OCR_MODEL_DIR="$PWD/$ROOT/models"
"$ROOT/venv/bin/python" worker/ocr/ppocr.py --prefetch --json
"$ROOT/venv/bin/python" worker/ocr/ppocr.py --check --json

# Real OCR + parser integration
"$ROOT/venv/bin/python" "$ROOT/make_ocr_assets.py"
"$ROOT/venv/bin/python" worker/ocr/ppocr.py --json --images "$ROOT/ocr-input/scan.png"
export XASS_OCR_PYTHON="$PWD/$ROOT/venv/bin/python"
node "$ROOT/exercise-parser.mjs"

# Previously failing OCR test
node --test --test-name-pattern "available local OCR" \
  tests/integration/phase6-document-parser.test.mjs

# Isolated DB (after `open -a Docker`)
docker run -d --name xass-disposable-test-20261106 -e POSTGRES_PASSWORD=postgres \
  -p 127.0.0.1:55432:5432 public.ecr.aws/supabase/postgres:17.6.1.167
docker exec -i xass-disposable-test-20261106 psql -U supabase_admin -d postgres \
  -v ON_ERROR_STOP=1 < "$ROOT/storage-bootstrap.sql"
docker exec -i xass-disposable-test-20261106 psql -U supabase_admin -d postgres <<'SQL'
alter table auth.users add column if not exists email_confirmed_at timestamptz;
create extension if not exists pgtap with schema extensions;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid;
$$;
SQL
for f in $(ls supabase/migrations/*.sql | sort); do
  docker exec -i xass-disposable-test-20261106 psql -U postgres -d postgres \
    -v ON_ERROR_STOP=1 < "$f"
done
XASS_DB_CONTAINER=xass-disposable-test-20261106 npm run test:db
docker rm -f xass-disposable-test-20261106

# Final
npx tsc --noEmit -p tsconfig.json
npm test
```

## 6. Bottom line

- OCR runtime: **repaired and proven**. Pinned package install, pinned model prefetch with
  checksum validation, direct image OCR, scanned-PDF raster OCR, and production-parser OCR all
  succeed on real inputs.
- OCR test: **still fails**, and the remaining cause is a stale test contract (Tesseract
  `XASS_OCR_LANG`/`ocrLanguage`/`ocr_language_unavailable` vs PP-OCRv6). Not an environment
  blocker anymore; it requires a test update, which was intentionally not made here.
- Isolated DB: **real and run**. 4 of 5 pgTAP suites pass; `partial_evidence_review` has 2
  genuine invalidation-reason failures that reproduce on a clean, migrated Postgres 17.
- Full suite: **289/290**, 0 skipped. Only the stale OCR test fails.
- No LLM provider calls, no remote/prod DB, no fixture changes, no commits, no false skips.
