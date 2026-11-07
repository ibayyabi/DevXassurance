# OpenCode Go experiment connection

`run.mjs` is an isolated connection smoke runner. `baseline-v2.mjs` is the variant A
runner. `evidence-v2.mjs` is the variant B/C evidence-first runner and, since report-v3,
contains the v3 risk/formula validator and a no-network replay mode. None of the runners
modify the production worker.

OpenCode Go is designed for coding-agent traffic; its documentation asks clients to send
typical coding-agent traffic. Confirm the provider permits document-extraction
experiments before sending prompts or documents. Hosted inference sends the prompt to the
provider; do not send sensitive evidence without approval.

The smoke runner defaults to `glm-5.3-flash`. The B/C runner defaults to
`deepseek-v4.1-flash`; override with `OPENCODE_GO_MODEL`. Availability and usage limits
depend on the account. Model names do not establish parameter count.

Put the API key in the git-ignored `.env.opencode-go.local` file at the repository root:

```sh
OPENCODE_GO_API_KEY=your-key
```

Do not commit credentials. The runners never print, log, or store the key. Treat prompts,
responses, and saved outputs as potentially sensitive: outputs may contain workbook
content.

## Connection smoke test

```sh
printf 'Write a JavaScript function that adds two numbers. Return only the code.\n' \
  | node --env-file=.env.opencode-go.local .scratch/opencode-go-experiment/run.mjs
```

One request, at most 1024 output tokens; prints the response, elapsed time, finish reason,
and provider-reported usage as JSON. It does not retry. `OPENCODE_GO_SESSION` reuses a
stable session id; otherwise each invocation generates a fresh one.

Documentation: https://opencode.ai/docs/go

## Variant A (production baseline) runner

`baseline-v2.mjs` runs the real production parser and `extractDocumentGroups()` with the
actual prompt, validator and grouping rules, and only adapts the transport (OpenAI-
compatible provider pointed at OpenCode Go plus a fetch wrapper that adds
`x-opencode-session`). It never touches production code or store, records every provider
attempt as JSONL, and checkpoints each validated group so a failure still leaves partial
output.

```sh
BASELINE_MAX_REQUESTS=60 XASS_LLM_TIMEOUT_MS=120000 \
  timeout 1500 node --env-file=.env.opencode-go.local \
  .scratch/opencode-go-experiment/baseline-v2.mjs \
  demo-evidence-fixtures/smart-building-itb/sessions/2026-10-30_w7/02_Kamera_Pengawasan_Subcontractor_Weekly.xlsx
```

Artifacts go to `.local-evaluation/opencode-go-exp-v2/` (git-ignored). Usage the provider
did not report is stored as `null`, never totalised as zero. The runner halts (exit 2) on
HTTP 429 without retrying.

## Variant B/C evidence-first runner

Results and limitations: `report-v2.md`, `report-v3.md`.

### Variant C, dry run: deterministic first, zero requests

```sh
for s in 2026-10-09_w4 2026-10-16_w5 2026-10-23_w6 2026-10-30_w7; do
  node .scratch/opencode-go-experiment/evidence-v2.mjs --variant C --dry-run \
    --out .local-evaluation/opencode-go-exp-v3/$s \
    demo-evidence-fixtures/smart-building-itb/sessions/$s/*.xlsx
done
```

Each session directory receives `C-<file>.xlsx.json` and `summary-C.json`. `--dry-run`
builds the evidence and prompt and writes the result without any API request. Without
`--dry-run`, variant C calls the model only for fields the deterministic pass did not
resolve; do not run that without quota approval.

### Replay recorded B answers, no network

```sh
node .scratch/opencode-go-experiment/evidence-v2.mjs \
  --replay .local-evaluation/opencode-go-exp-v2 \
  --out .local-evaluation/opencode-go-exp-v3 --session replay-v3
```

Replay re-validates the stored `model_output.parsed` with the current validator and writes
new files under `<out>/<session>/`. It never rewrites the source result and makes no
request. `--replay` requires no positional file and no API key.

### Focused verification and scoring

```sh
node --check .scratch/opencode-go-experiment/evidence-v2.mjs
node .scratch/opencode-go-experiment/verify-v3.mjs
V3_ROOT=.local-evaluation/opencode-go-exp-v3-recheck node .scratch/opencode-go-experiment/score-v3.mjs
REPLAY_ROOT=.local-evaluation/opencode-go-exp-v3-recheck/replay-v3 node .scratch/opencode-go-experiment/score-b-replay-v3.mjs
```

- `verify-v3.mjs`: 50 synthetic, deterministic regression tests; reads no workbook and makes
  no request.
- `score-v3.mjs`: compares variant C v3 outputs with `expected-results.json`; writes
  `score-v3.json` and `score-v3.md` in the v3 root. Numeric tolerance 0.00005 fraction;
  date/RAG exact; risk ID set exact; unknown counts as not matched; review-required values
  are not valid. It reports value match, found+provenance, structural provenance (source
  ids on the selected progress row, risk evidence matching the deterministic row/source
  ids), candidate completeness, status counts, and false accepts separately.
- `score-b-replay-v3.mjs`: scores the replayed B answers against W7 ground truth and writes
  in `replay-v3/`. It separates found+citation provenance from structural citation
  validity, reports candidate completeness for risk sets, and lists false accepts.
- Both scoring scripts read `.local-evaluation/opencode-go-exp-v3/` by default. Set
  `V3_ROOT` / `REPLAY_ROOT` to score an isolated recheck without touching earlier results.

### Offline validation (v4) — no network

Use a new output root so earlier v2/v3/v3-recheck results stay untouched. The reports are
`report-offline.md` and `.local-evaluation/opencode-go-exp-offline/`.

```sh
for s in 2026-10-09_w4 2026-10-16_w5 2026-10-23_w6 2026-10-30_w7; do
  node .scratch/opencode-go-experiment/evidence-v2.mjs --variant C --dry-run \
    --out .local-evaluation/opencode-go-exp-offline/$s \
    demo-evidence-fixtures/smart-building-itb/sessions/$s/*.xlsx
done

node .scratch/opencode-go-experiment/evidence-v2.mjs \
  --replay .local-evaluation/opencode-go-exp-v2 \
  --out .local-evaluation/opencode-go-exp-offline --session replay-v3

V3_ROOT=.local-evaluation/opencode-go-exp-offline node .scratch/opencode-go-experiment/score-v3.mjs
REPLAY_ROOT=.local-evaluation/opencode-go-exp-offline/replay-v3 node .scratch/opencode-go-experiment/score-b-replay-v3.mjs
```

`--dry-run` and `--replay` make no provider request and require no API key. Replay
recomputes the context/cap from the recorded workbook using the source record's
`context.cap.max_chars`, records `replay.source_context_matches`, and refuses to write into
the source directory.

### WBS `% complete` and next-milestone offline (v5) — no network

`wbs-milestone-offline.mjs` extracts the Workplan & Gantt WBS rows and derives the
next milestone for the workbook's reporting cut-off. It uses the production parser
unmodified, makes no provider request, reads no `.env*`, no API key and no ground
truth. Scoring is a separate script because the runner must not see
`expected-results.json`. Results are tied to parser `document-parser/18` and this
fixture pack; see `report-wbs-milestone-offline.md`.

```sh
# smoke: the development subset only (W7 SB02 + SB07)
node .scratch/opencode-go-experiment/wbs-milestone-offline.mjs \
  --out .local-evaluation/opencode-go-exp-wbs/dev-smoke --session 2026-10-30_w7 \
  demo-evidence-fixtures/smart-building-itb/sessions/2026-10-30_w7/02_Kamera_Pengawasan_Subcontractor_Weekly.xlsx \
  demo-evidence-fixtures/smart-building-itb/sessions/2026-10-30_w7/05_Pencahayaan_Subcontractor_Weekly.xlsx

# all 48 workbooks W4–W7 (offline)
for s in 2026-10-09_w4 2026-10-16_w5 2026-10-23_w6 2026-10-30_w7; do
  node .scratch/opencode-go-experiment/wbs-milestone-offline.mjs \
    --out .local-evaluation/opencode-go-exp-wbs/all-48/$s --session $s \
    demo-evidence-fixtures/smart-building-itb/sessions/$s/*.xlsx
done

# score; dev and holdout are reported separately
node .scratch/opencode-go-experiment/score-wbs-offline.mjs \
  --root .local-evaluation/opencode-go-exp-wbs/all-48 \
  --out .local-evaluation/opencode-go-exp-wbs

# targeted negative tests (synthetic cells; no workbook, no network)
node .scratch/opencode-go-experiment/verify-wbs-offline.mjs
```

Development = W7 SB02 + SB07; holdout = W7 SB01 + SB08. The split was fixed before
the final rule was run over all 48. Do not treat the fixture pack as an independent
real-world benchmark: `next_milestone` in expected-results.json is derived by the
fixture generator, and the WBS arrays carry no WBS codes (matching is by row order).

Two parser shapes occur. `structured_row_cells` keeps per-cell references
(per-cell source ids are cited). `demoted_row_text` loses per-cell references for
long rows; the runner cites the real row source ids and the header cells, records
`provenance_level: "row_text"` and `cell_source_id: null`, and never invents a
per-cell locator. The `% Complete` wording is read from the row text; the raw
annotation is aligned and cross-checked against the displayed value and the
`I*J` weighted-progress cache. Empty/missing/error caches are not zero.

### What the v3 validator enforces

- Risk claims bind ID, Status and Priority to the same indexed row. A valid Status or
  Priority citation on a claimed row is accepted even though it is not an ID. Cross-row,
  cross-sheet, duplicate, unknown, uncited claimed IDs, missing/unclear/closed status, and
  contradicting status/priority produce `candidate_mismatch`, `ambiguous`, or
  `invalid_citation`, never `found`.
- A claimed risk set that omits deterministic candidate rows is `ambiguous` with
  `candidate_check` (missing/extra/complete), never a complete `found`. An empty open-risk
  set without a completeness proof is `ambiguous`, not `[]`.
- Duplicate risk IDs on multiple indexed rows, or duplicate claimed IDs, are not resolved as
  `found`; the deterministic set becomes `ambiguous`.
- Non-risk `found` claims need at least one citation that supports the field's label on the
  selected progress row. Citations outside the provided context, or a `found` with no
  citation, are rejected. The reporting-cut-off declaration cell is accepted for
  `cutoff_date`.
- An empty open-risk set needs a completeness proof. Without one the result stays
  `unknown` (deterministic path) or `ambiguous` (model path), never `[]`. A risk-like row
  that cannot be bound to a valid ID makes the set `ambiguous`.
- Formula caches are accepted only when the formula matches the recognized
  `actual - planned` / RAG threshold shape and the inputs are available and agree. For RAG,
  the cached value must also agree with the threshold re-applied to the verified variance
  value; a contradictory or non-evaluable RAG cache becomes `review`, never `found`. Empty,
  missing, error, unrecognized, changed, or contradictory caches are not zero and are not
  accepted as formula results. A variance derived by the domain rule is labelled
  `derived_domain` with its rule and input source ids, never presented as an Excel formula
  result. RAG is never derived, and its cache is rejected when the variance dependency is
  not a verified workbook value.
- `open_risk_ids` and `risk_entries` on the deterministic path carry per-row `evidence`
  with the supporting ID, Status and Priority source ids.
- Variant C never lets a model fallback clear a deterministic formula/cache review: the
  field stays `review` with `review_required: true`, and the rejected model answer is kept
  under `model_fallback` for diagnosis.

### WBS provenance audit (v6) — no network

`audit-wbs-provenance.mjs` audits the existing WBS outputs against a fresh, unmodified production
parser run and an independent OOXML reader (`ooxml_reader.py`, Python stdlib). A row is
`per_cell_proven` only when the value's own cell reference resolves to the real workbook cell and
the header, literal/formula-cache and independent value agree; row-level references become
`review_row_level`. `prototype-cell-aware-split.mjs` is the isolated Option A prototype: it keeps
cell identity only in the part that fully contains the cell's text and emits `proto:` identities,
never production source ids. Results are in `report-wbs-provenance.md`.

```sh
# one command, offline: reader + audit + prototype + tests + regressions + graph update
bash .scratch/opencode-go-experiment/run-provenance-audit.sh

# or individually
python3 .scratch/opencode-go-experiment/ooxml_reader.py \
  --out .local-evaluation/opencode-go-exp-provenance/ooxml/2026-10-30_w7 \
  demo-evidence-fixtures/smart-building-itb/sessions/2026-10-30_w7/*.xlsx
node .scratch/opencode-go-experiment/audit-wbs-provenance.mjs \
  --root .local-evaluation/opencode-go-exp-wbs/all-48 \
  --fixtures demo-evidence-fixtures/smart-building-itb/sessions \
  --out .local-evaluation/opencode-go-exp-provenance
node .scratch/opencode-go-experiment/prototype-cell-aware-split.mjs \
  --audit-root .local-evaluation/opencode-go-exp-provenance/audit \
  --ooxml-root .local-evaluation/opencode-go-exp-provenance/ooxml \
  --out .local-evaluation/opencode-go-exp-provenance/prototype
node .scratch/opencode-go-experiment/verify-wbs-provenance.mjs
python3 -m unittest -v .scratch/opencode-go-experiment/test_ooxml_reader.py
```

Outputs: `.local-evaluation/opencode-go-exp-provenance/` (`ooxml/`, `audit/`,
`audit-summary.json`, `prototype/`, `prototype-summary.json`, `logs/`). The audit never reads
`expected-results.json` and never rewrites the older `opencode-go-exp-wbs/` outputs. The old
`score-wbs-offline.mjs` `provenance_valid` is a source-id-format check, not per-cell proof; see
the report before using it.

### Milestone column O citation and Gantt warning audit

`wbs-milestone-offline.mjs` now stores the actual Milestone (column O) reference for every
row: `milestone_cell`, `milestone_cell_source_id`, and `milestone_cell_source`. This is a
real parser cell reference, not a fabricated source id. `audit-wbs-provenance.mjs` audits
that reference with `auditMilestone`: a non-empty O cell is `per_cell_proven` only when the
sheet/row/column, header label, and independent OOXML value agree. An empty O cell is
`review_missing_value`, and a row without an O source id stays `unbound_no_citation`.
The derived `next_milestone` composite remains a derived value and is not claimed as a
literal cell.

`gantt-ambiguity-audit.py` checks the parser's Workplan & Gantt candidate-ambiguity
warnings against the raw table shape. A warning is expected only when row 3 is a `W1..Wn`
week grid, the same columns carry dates in row 4, and row 4 has the WBS/Deliverable/
Baseline Finish/% Complete/Milestone labels. It reports false positives and negatives
explicitly; it never suppresses a warning to make a result green.

```sh
node .scratch/opencode-go-experiment/audit-wbs-provenance.mjs \
  --root .local-evaluation/opencode-go-exp-completion/wbs/all-48 \
  --fixtures demo-evidence-fixtures/smart-building-itb/sessions \
  --out .local-evaluation/opencode-go-exp-completion/provenance
python3 .scratch/opencode-go-experiment/gantt-ambiguity-audit.py \
  --root .local-evaluation/opencode-go-exp-completion/wbs/all-48 \
  --ooxml-root .local-evaluation/opencode-go-exp-completion/provenance/ooxml \
  --out .local-evaluation/opencode-go-exp-completion/provenance
```

### Full offline validation (v7) — no network

Use `.local-evaluation/opencode-go-exp-full-offline/` so every earlier v2/v3/v3-recheck/offline/wbs/provenance output stays untouched. The report is `report-full-offline.md`.

```sh
# Repo suites (no live provider/DB; the DB entrypoint skips without a disposable container)
node --test tests/integration/*.test.mjs
npm run test:db

# Synthetic verification
node .scratch/opencode-go-experiment/verify-v3.mjs
node .scratch/opencode-go-experiment/verify-wbs-offline.mjs
node .scratch/opencode-go-experiment/verify-wbs-provenance.mjs
node .scratch/opencode-go-experiment/verify-full-offline-seams.mjs \
  --out .local-evaluation/opencode-go-exp-full-offline/seams
(cd .scratch/opencode-go-experiment && python3 -m unittest -v test_ooxml_reader.py)

# C dry-run, replay, scoring
for s in 2026-10-09_w4 2026-10-16_w5 2026-10-23_w6 2026-10-30_w7; do
  node .scratch/opencode-go-experiment/evidence-v2.mjs --variant C --dry-run \
    --out .local-evaluation/opencode-go-exp-full-offline/c48/$s \
    demo-evidence-fixtures/smart-building-itb/sessions/$s/*.xlsx
done
node .scratch/opencode-go-experiment/evidence-v2.mjs \
  --replay .local-evaluation/opencode-go-exp-v2 \
  --out .local-evaluation/opencode-go-exp-full-offline/c48 --session replay-v3
V3_ROOT=.local-evaluation/opencode-go-exp-full-offline/c48 \
  node .scratch/opencode-go-experiment/score-v3.mjs
REPLAY_ROOT=.local-evaluation/opencode-go-exp-full-offline/c48/replay-v3 \
  node .scratch/opencode-go-experiment/score-b-replay-v3.mjs

# WBS/milestone over all 48 workbooks
for s in 2026-10-09_w4 2026-10-16_w5 2026-10-23_w6 2026-10-30_w7; do
  node .scratch/opencode-go-experiment/wbs-milestone-offline.mjs \
    --out .local-evaluation/opencode-go-exp-full-offline/wbs/all-48/$s --session $s \
    demo-evidence-fixtures/smart-building-itb/sessions/$s/*.xlsx
done
node .scratch/opencode-go-experiment/score-wbs-offline.mjs \
  --root .local-evaluation/opencode-go-exp-full-offline/wbs/all-48 \
  --out .local-evaluation/opencode-go-exp-full-offline/wbs

# Independent OOXML provenance audit + cell-aware prototype
for s in 2026-10-09_w4 2026-10-16_w5 2026-10-23_w6 2026-10-30_w7; do
  python3 .scratch/opencode-go-experiment/ooxml_reader.py \
    --out .local-evaluation/opencode-go-exp-full-offline/provenance/ooxml/$s \
    demo-evidence-fixtures/smart-building-itb/sessions/$s/*.xlsx
done
node .scratch/opencode-go-experiment/audit-wbs-provenance.mjs \
  --root .local-evaluation/opencode-go-exp-full-offline/wbs/all-48 \
  --fixtures demo-evidence-fixtures/smart-building-itb/sessions \
  --out .local-evaluation/opencode-go-exp-full-offline/provenance
node .scratch/opencode-go-experiment/prototype-cell-aware-split.mjs \
  --audit-root .local-evaluation/opencode-go-exp-full-offline/provenance/audit \
  --ooxml-root .local-evaluation/opencode-go-exp-full-offline/provenance/ooxml \
  --out .local-evaluation/opencode-go-exp-full-offline/provenance/prototype

# Cost baseline: independent all-sheet OOXML read + strict numeric reconciliation
python3 .scratch/opencode-go-experiment/ooxml_reader.py --all-sheets \
  --out .local-evaluation/opencode-go-exp-full-offline/cost/ooxml \
  demo-evidence-fixtures/smart-building-itb/00_baseline/*.xlsx
python3 .scratch/opencode-go-experiment/audit-cost-baseline.py \
  --ooxml-root .local-evaluation/opencode-go-exp-full-offline/cost/ooxml \
  --expected demo-evidence-fixtures/smart-building-itb/expected-results.json \
  --out .local-evaluation/opencode-go-exp-full-offline/cost
```

`verify-full-offline-seams.mjs` adds synthetic public-seam checks for the 3100-character
row split, the 120-reference cap, ambiguity diagnostics, formula cache states, empty vs
zero, Excel 1900/1904, and a provider timeout. `audit-cost-baseline.py` reads only the
independent OOXML JSON and the two claimed totals; it does not execute formulas or use the
production parser.

### Boundaries

This is an experiment, not a production validator and not a benchmark. Results are tied to
parser `document-parser/18` and this fixture pack. The risk completeness proof and
cross-sheet/arbitrary formula recognition are deliberately conservative. Outputs may
contain workbook content and must be treated as sensitive.
