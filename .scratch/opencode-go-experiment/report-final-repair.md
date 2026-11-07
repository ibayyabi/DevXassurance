# Final repair: PP-OCRv6 parser test and partial-evidence invalidation

## 0. Scope and constraints

- Repo: `/Users/iweng/Documents/GitHub/DevXassurance`; branch `development-bismillah-final`.
- Executed via CommandCode. No commit, push, reset, or checkout.
- No application LLM provider calls, no `.env*`/secret reads, no remote/production DB.
- No fixture edits (`git status --porcelain -- demo-evidence-fixtures` = 0 lines).
- No packages installed outside the already-isolated OCR venv.
- Only a newly created, uniquely named disposable container was used and removed:
  `xass-repair-20261106-disposable`. The existing `pmo-mapping-final` stack was never
  connected to, stopped, modified, or removed.

## 1. OCR: stale Tesseract test replaced with real PP-OCRv6 behavior

### 1.1 Root cause confirmed against code

`worker/src/services/document-parser.ts` implements only PP-OCRv6/RapidOCR:
`OCR_ENGINE = "rapidocr"`, `OCR_MODEL = "PP-OCRv6"`, `OCR_MODEL_SIZE = "tiny"`,
`OCR_BACKEND = "onnxruntime-cpu"`, `OCR_ROUTE = "id"`. It reads `XASS_OCR_PYTHON`
and delegates model lookup to `worker/ocr/ppocr.py` (`XASS_OCR_MODEL_DIR`). There is
no `XASS_OCR_LANG`, no `ocrLanguage`, and no `ocr_language_unavailable` code anywhere
in the parser.

`tests/integration/phase6-document-parser.test.mjs` still asserted the removed
Tesseract contract and gated the test on `tesseract --list-langs` containing `eng`.
That gate is why the test reached real OCR text and then failed on
`parserMetadata.ocrLanguage === "eng"`.

### 1.2 Change (tests/integration/phase6-document-parser.test.mjs)

- Removed `tesseract` detection and all `XASS_OCR_LANG` / `ocrLanguage` /
  `ocr_language_unavailable` assertions.
- Gating now runs the real runtime check:
  `python worker/ocr/ppocr.py --check --json` (using `XASS_OCR_PYTHON` when set,
  otherwise `<repo>/.venv-ocr/bin/python`) plus Ghostscript availability. The test
  skips only when that real runtime is genuinely absent.
- The test now preserves and asserts the meaningful behavior at the parser boundary:
  - image OCR returns the real extracted text `OCR SOURCE 4821`;
  - every chunk carries the image location (`imageName === "scan.png"`);
  - metadata reports `parser`, `ocrEngine=rapidocr`, `ocrModel=PP-OCRv6`,
    `ocrModelSize=tiny`, `ocrBackend=onnxruntime-cpu`, `ocrRoute=id`, real
    `rapidocr`/`onnxruntime` versions, and three 64-hex model SHA-256 values;
  - a missing runtime (`XASS_OCR_PYTHON` pointing to a nonexistent binary) fails
    explicitly with `ocr_unavailable` and a PP-OCRv6 runtime message;
  - a missing pinned model directory (`XASS_OCR_MODEL_DIR` set to an empty temp dir)
    fails explicitly with `ocr_model_unavailable` mentioning `--prefetch`;
  - a scanned PDF keeps page 1, the OCR text, an OCR warning, `scannedPageCount=1`,
    and the RapidOCR/PP-OCRv6 metadata.
- Environment variables are restored in `finally`.

This is a real-behavior test, not a weakened assertion: it asserts more of the current
contract (engine/model/route/runtime/model hashes and both failure modes) than the old
test did.

### 1.3 Real OCR execution

Runtime check (`XASS_OCR_MODEL_DIR=.local-evaluation/isolated-validation-2026-11-06/models`):

```json
{"ok": true, "engine": "rapidocr", "model": "tiny", "backend": "onnxruntime-cpu",
 "route": "id", "runtimeVersions": {"rapidocr": "3.10.0", "onnxruntime": "1.31.0"},
 "modelSha256": {
   "detector": "f42c0fbd294d95eac1a550e131b277dac97462c8025fa4b6c3cec1b7894bd3d5",
   "recognizer": "e16e242de5937ad92609223f19bc2aff3727ee40b095f996907c24749bad251b",
   "classifier": "e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c"}}
```

Focused test command:

```sh
XASS_OCR_PYTHON=$PWD/.local-evaluation/isolated-validation-2026-11-06/venv/bin/python \
XASS_OCR_MODEL_DIR=$PWD/.local-evaluation/isolated-validation-2026-11-06/models \
node --test --test-name-pattern "available local PP-OCRv6" \
  tests/integration/phase6-document-parser.test.mjs
```

Result:

```
✔ available local PP-OCRv6 extracts image and scanned-PDF text with real provenance (2086ms)
ℹ tests 1  pass 1  fail 0  skipped 0
```

The test exercised actual ONNX OCR on a rasterized PNG and a scanned PDF; it did not
mock the helper.

## 2. DB: partial evidence review invalidation

### 2.1 Root cause: test fingerprint setup, not the domain contract

The production contract is that an analysis record carries the exact fingerprints it
was built over. All real producers write them:

- `claim_assurance_analysis` (202611050003) writes
  `latest_attempt.fingerprint` and `latest_attempt.reference_fingerprint`.
- `finish_assurance_analysis_with_results` writes
  `last_success.fingerprint` and `last_success.reference_fingerprint`.
- `finish_assurance_analysis_with_decision_fingerprint` (202611050001) adds both
  `last_success.observation_decision_fingerprint` and
  `latest_attempt.observation_decision_fingerprint`.

The failing test bypassed those producers and hand-built `analysis_metadata`:

- `last_success.fingerprint` was the literal `'x'` (not the source fingerprint);
- both `last_success` and the `analyzing` `latest_attempt` omitted
  `reference_fingerprint`;
- the `analyzing` attempt omitted the source `fingerprint`.

When the test then ran `UPDATE assurance_reviews SET status = 'analyzing'`, the
`assurance_reviews_prior_risk_reference_change` trigger called
`invalidate_assurance_reference_results(project_id)` with source-change checking
enabled. Because `last_success.fingerprint = 'x'` differed from the recomputed source
fingerprint, it classified the fabricated row as `Selected evidence changed` and moved
the review to `evidence_ready` before the decision-change RPC could run. Ticket 03's
`invalidate_assurance_observation_results` then skipped the review because it was no
longer `analyzing`/`findings_ready`, so `Reviewer decisions changed` and
`observation_decision_invalidation` were never recorded.

For a realistic attempt, the guard in `invalidate_assurance_reference_results`
(`attempt.fingerprint` and `attempt.reference_fingerprint` match the live snapshots,
lease valid) skips reference invalidation, and the later decision change is handled by
ticket 03 with the reviewer-specific reason. The ordering code in 202611050003
(`invalidate_assurance_observation_results` first, then
`invalidate_assurance_reference_results(project_id, false)` for decisions) is correct.

**Conclusion:** expected priority behavior was right; the test fingerprint setup was
wrong. No source or migration contract changed, so no new migration is required for
already-deployed databases.

### 2.2 Change (supabase/tests/partial_evidence_review.test.sql)

- Added `pg_temp.source_fingerprint()` and `pg_temp.reference_fingerprint()` helpers.
- Rebuilt the simulated `last_success` and `latest_attempt` exactly as the real claim
  and finish paths write them: source fingerprint, reference fingerprint, and decision
  fingerprint.
- Assertions were not weakened or changed. Security/atomicity semantics, RLS, project
  locking, and trigger ordering were untouched.

### 2.3 Isolated disposable DB and real pgTAP results

Recreated a fresh container (image already local, matching `major_version = 17`):

```sh
docker run -d --name xass-repair-20261106-disposable \
  -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55433:5432 \
  public.ecr.aws/supabase/postgres:17.6.1.167
```

Provisioning shims (same as prior validation, inside the disposable container only):

1. Minimal `storage` schema/objects/grants from
   `.local-evaluation/isolated-validation-2026-11-06/storage-bootstrap.sql`.
2. `auth.users.email_confirmed_at` added (the image ships an older auth schema).
3. `pgtap` installed into `extensions`.
4. `auth.uid()` replaced with the modern implementation that also reads
   `request.jwt.claims`.

These are Supabase-stack stand-ins, not production-code changes; the raw image is a
bare Postgres, not a full Supabase stack.

All migrations applied with `ON_ERROR_STOP=1` as `postgres` after bootstrapping as
`supabase_admin`: **46/46 migration files**, exit 0 each (`db-migrations.log`).

`XASS_DB_CONTAINER=xass-repair-20261106-disposable npm run test:db` — every suite runs
in a transaction that rolls back:

| Suite | Plan | Result |
|---|---:|---|
| `document_job_fencing.test.sql` | 32 | valid TAP, all passed |
| `document_job_fencing_callers.test.sql` | 69 | valid TAP, all passed |
| `document_job_reliability.test.sql` | 38 | valid TAP, all passed |
| `partial_evidence_review.test.sql` | 45 | valid TAP, all passed (was 43/45) |
| `risk_snapshot_atomicity.test.sql` | 32 | valid TAP, all passed |

The runner rejects plans whose executed assertion count differs, so each suite's
assertion count equals its plan.

The container was then removed with `docker rm -f xass-repair-20261106-disposable`.
`pmo-mapping-final` containers remain as they were.

## 3. Final checks (real outputs)

| Check | Command | Result |
|---|---|---|
| Focused OCR | `node --test --test-name-pattern "available local PP-OCRv6" ...` | 1/1 pass, 0 skipped |
| All DB suites | `XASS_DB_CONTAINER=xass-repair-20261106-disposable npm run test:db` | 5/5 suites valid TAP, all assertions pass |
| Full integration | `XASS_OCR_PYTHON=... XASS_OCR_MODEL_DIR=... npm test` | **290 tests, 290 pass, 0 fail, 0 skipped**, 5.18 s |
| Typecheck | `npx tsc --noEmit -p tsconfig.json` | exit 0, empty log |
| Lint (changed test) | `npx eslint tests/integration/phase6-document-parser.test.mjs` | exit 0, empty log |
| Graph refresh | `graphify update .` | 3768 nodes, 8992 edges, 159 communities |

No test was skipped and no assertion was removed to force a pass.

## 4. Resulting diffs

- `tests/integration/phase6-document-parser.test.mjs`: Tesseract contract removed;
  real PP-OCRv6 success and failure behavior asserted.
- `supabase/tests/partial_evidence_review.test.sql`: realistic analysis fingerprints
  in the simulated in-flight attempt; assertions unchanged.
- `graphify-out/`: rebuilt because tests changed.
- No source file, fixture, or migration was modified.

## 5. Assumptions, shims, and remaining prerequisites

- OCR test uses the isolated venv/models from
  `.local-evaluation/isolated-validation-2026-11-06/` and skips when
  `ppocr.py --check` or Ghostscript is unavailable. CI must provide that runtime and
  set `XASS_OCR_PYTHON` / `XASS_OCR_MODEL_DIR` (or create `.venv-ocr`) for the test to
  execute rather than skip.
- DB validation depends on the local Supabase Postgres image plus the four recorded
  stack shims (storage schema, `email_confirmed_at`, `pgtap`, `auth.uid()`). A full
  `supabase start` stack would supply these natively.
- No new migration is needed: the failing behavior was caused by fabricated test
  fingerprints, and realistic fingerprints follow the existing deployed contract.
- Docker Desktop remains running; only the disposable container was created and
  removed.

## 6. Evidence artifacts

Under `.local-evaluation/final-repair-2026-11-06/`:

| Artifact | SHA-256 |
|---|---|
| `db-bootstrap.log` | `dbca657f2134e7c2cb76b84f9aa32a56f0abba988c9fb61d2ecf0fe2667e47b6` |
| `db-migrations.log` | `af53d93e0463e87d8ed396bfaab298572d55a63aeeadf0a15a89937dee541c3d` |
| `db-provision-extra.log` | `34d98a4807c2e18381743d78d85ac826f4af836292c5e6694fa52b3210e200dd` |
| `db-test.log` | `4d40242d2a48383f496e8c4c5d913607b873dea2bc25b6ed60b86133fcbe6d0b` |
| `full-suite.log` | `ea85ec26dddc4d9d05cf2fc6a520082822e080880941c4c9dc9dcbb8e255a39f` |
| `ocr-check.log` | `bca84a3ee18037692fc7fd0d21f7b1f32fcdda833103699fe9e7eb97fe490618` |
| `tsc.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (empty, exit 0) |
| `eslint.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (empty, exit 0) |
