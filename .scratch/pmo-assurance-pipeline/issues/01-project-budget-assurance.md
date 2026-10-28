# 01: Project-Level Budget Assurance

**What to build:** A PMO reviewer can upload a supported project document, approve a cost baseline for a scope and effective date, and see an evidence-backed project-total Budget comparison on the existing Assurance page. The extraction uses document content rather than restricting evidence to the document's primary type.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] Cost observations preserve source value and location, with safe normalized amount, currency, scope, period/as-of date, and status where present.
- [x] A reviewer can accept a cost baseline per scope/effective date; a source document's own “approved” label does not activate it.
- [x] Compare the approved baseline only with explicitly reported EAC. Actual and committed costs remain separate; missing EAC is an evidence gap, never a comparison against actual cost.
- [x] Compare currencies only when they match; differing currencies remain source values and are marked not comparable, without conversion.
- [x] For comparable evidence, Budget status uses the agreed thresholds: variance <= 0% on track, > 0% through 5% needs attention, and > 5% critical.
- [x] The Assurance page shows the result with source citations; reviewer corrections preserve the original extraction and source wording/location and record reviewer attribution/reason.
- [x] The grouped extraction path uses a free provider selected for the implementation; if quota is reached, remaining text groups stay not processed and are retried later rather than treated as absent evidence.

## Comments

### 2026-10-27 — implemented and verified

**Delivered**

- `supabase/migrations/202610260001_pmo_cost_evidence.sql`: `cost_observations`
  (source value, deterministic normalized amount/currency, scope, period/as-of
  date, status, chunk index, bounded excerpt, page/section/source location),
  `cost_baselines` (reviewer-accepted reference per scope and effective date,
  one accepted row per scope enforced by a partial unique index), and
  attributed correction columns on `assurance_findings`. Observations are
  service-role writes with member-only reads; baseline acceptance is guarded by
  `can_upload_project_evidence`.
- `src/features/assurance/lib/cost-evidence.ts`: the cost contract and the
  deterministic project-total Budget comparison, with named evidence gaps
  (`baseline_not_accepted`, `eac_not_reported`, `eac_conflicting`,
  `currency_mismatch`, `baseline_not_positive`).
- `worker/src/services/document-extraction.ts`: the existing grouped extraction
  call now also returns `cost_observations` for any document type. No extra
  call and no per-domain call was added; schema version is now
  `phase6-document-extraction/12`. A value absent from its cited source, an
  invalid measure or scope, or a formula-unavailable citation is excluded with a
  review warning instead of being accepted. Amount and currency are derived in
  the worker from the source wording; a model-supplied number is never trusted.
- `src/app/api/workers/parse-document/route.ts`: persists this run's validated
  observations, replacing the document's previous rows.
- `src/features/assurance/actions/assurance-actions.ts`: Budget is built from
  the accepted baseline and the reported EAC instead of the review prompt (cost
  keys removed from that prompt); `approveCostBaseline` and
  `correctBudgetFinding` added.
- Assurance page: a Cost baseline panel (accepted baseline, source-backed
  candidates with citations, acceptance form) and an attributed correction form
  on the Budget finding.

**Acceptance criteria**

1. Observations keep the source value, exact location, and period/status;
   normalization is deterministic and stays null for ambiguous wording
   (`phase6-document-extraction.test.mjs`, `ticket-01-...test.mjs`).
2. A baseline is comparable only after `approveCostBaseline`; superseded and
   not-yet-effective rows are excluded; a candidate whose amount or currency
   could not be read cannot be accepted.
3. Only an explicitly reported EAC is compared. Actual and committed costs are
   listed as kept separate; missing EAC is `eac_not_reported`, and conflicting
   reported totals are `eac_conflicting`.
4. Differing currencies stay source values, marked not comparable, with no
   conversion and no variance.
5. Thresholds verified at 0%, +0.0001%, 5%, and above 5%.
6. The Assurance page shows the result with document/page/section citations; a
   correction records amount, currency, reason, reviewer, and timestamp, and
   leaves `baseline_value`, `current_value`, `variance`, and `source_excerpts`
   as extracted (the superseded assessment text is kept inside `correction`).
7. The free provider is local Ollama by default (no quota); the free Ollama
   Cloud tier is the hosted alternative. A 429 is a transient failure: the group
   is checkpointed as not processed, the job stays retryable, completed groups
   keep their cached result, and a retry re-sends only the deferred group. A
   test asserts the retry re-sends that group alone and never reports absent
   evidence.

**Verification run here**

- `node --experimental-strip-types --test tests/integration/*.test.mjs`:
  133 pass, 2 fail. Both failures ("TXT extraction keeps headings and
  source-linked bounded chunks across long prose", "XLSX normalizes recognized
  dates using workbook epoch and flags invalid or ambiguous serials") fail
  identically on the unmodified checkout.
- `npx tsc --noEmit`: clean. `npx eslint .`: only the four pre-existing unused
  variables in `src/features/documents/lib/queries.ts`. `npm run build`:
  succeeded.
- Tests updated for the new contract: `phase-4-assurance-analysis`,
  `phase-6-review-schema`, `demo-evidence-scenarios` (golden packs now treat
  the stated baseline as accepted and the forecast as the reported EAC; their
  expected conditions are unchanged), `phase6-e2e-provider`, and the fixture
  provider's review prompt matcher.
- Live provider smoke against `ollama_cloud` / `gpt-oss:20b` on 2026-10-28,
  driving `extractDocumentGroups` on synthetic evidence that states an
  approved baseline, an actual to date, and an estimate at completion. The
  model returned three observations with the right measure each, no quality
  warnings, and normalization read `USD 1,000,000` as 1000000 USD. With no
  accepted baseline, Budget stayed More Evidence Required rather than
  comparing the actual; after acceptance it reported Critical at 6.0% with
  `actual_to_date` named as kept separate.
- Database contract checked against the deployed schema with the service
  role: duplicate observation tuple, lowercase currency, invalid measure,
  and negative chunk index are all refused (23505 / 23514); a second
  accepted baseline for the same scope is refused by
  `cost_baselines_active_scope_idx`, a superseded row without
  `superseded_at` is refused, and a superseded row with one coexists. All
  test rows were deleted and the residue check returned empty.
- The exact column lists in `cost-queries.ts`, including the
  `documents(title)` embed, select successfully against the deployed tables.

**Not done / not verified**

- The migration is applied. Pushed to the linked development project
  `DevXAssurance` (ref `oaoevvwwjvcnjlonltcw`) on 2026-10-28:
  `db push --linked --dry-run` listed only this file, the push reported
  success, and `migration list --linked` shows local and remote in step for
  all 27 migrations. Verified through PostgREST that `cost_observations`,
  `cost_baselines`, and the `assurance_findings` correction columns exist;
  row level security is enabled on both new tables and `anon` is refused on
  `cost_observations`.
- `npm run test:e2e` was not run: Playwright 1.64.1 is installed but its
  browser binaries are not, and the ~150 MB Chromium download was declined
  for now. That spec asserts nothing about Budget or the cost baseline panel
  anyway, so it would prove only that the surrounding upload-to-Assurance
  flow still works. Separately, the fixture provider's group-extraction
  fixture is stale
  against the current worker prompt: it still reads `SOURCE_CHUNKS_JSON=` and
  `evidence_chunk_index` citations, which predates this ticket.
- The browser step for accepting a baseline and reading the Budget result is
  therefore unverified end to end; the README development workflow documents it
  as step 7.
- `npm test` on this machine's Node 22.15 needs `--experimental-strip-types`
  because the suite imports TypeScript directly. The README now states Node
  22.18 or newer.
- WBS-scope cost observations are captured but not compared; that is ticket 02.
  Corrections apply to the Budget domain's assessed EAC and currency only.
- Budget is still saved as part of `runAssuranceAnalysis`, so a failed
  schedule/risk model call leaves the whole review unready, including its
  Budget gap. Decoupling that is ticket 05's cutover.
