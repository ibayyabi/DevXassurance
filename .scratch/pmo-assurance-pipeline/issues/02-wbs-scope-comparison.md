# 02: WBS Cost and Scope Comparison

**What to build:** A PMO reviewer can compare cost and approved scope at project and WBS/work-package levels when source records can be matched, while retaining a supported project-total result when WBS evidence is incomplete.

**Blocked by:** 01: Project-Level Budget Assurance.

**Status:** resolved

- [x] WBS evidence captures source/canonical code, parent code when present, name, and stated deliverable/scope.
- [x] Differently coded or named work packages can be proposed as a source-backed mapping; a reviewer must accept it before comparison or reuse within its approved scope.
- [x] Compare baseline and reported EAC for matching WBS records without merging unaccepted mappings.
- [x] Compare reported scope with the approved baseline and show added, missing, or changed items as evidence-backed candidates, not approved changes.
- [x] Missing or incomparable WBS data is shown as a WBS evidence gap and does not suppress a supported project-total Budget result.
- [x] A WBS observation is never silently replaced by another work package's row: the `cost_observations` uniqueness key includes the scope label.

## Comments

### 2026-10-28 — inherited from ticket 01

**Defect to fix before WBS comparison can be trusted.** Ticket 01 left the
`cost_observations` uniqueness key without `scope_label`:

- The table constraint is `unique (document_id, measure, scope_level,
  evidence_chunk_index, source_value)` in
  `supabase/migrations/202610260001_pmo_cost_evidence.sql`.
- `persistCostObservations` in `src/app/api/workers/parse-document/route.ts`
  upserts with that same key as `onConflict`.
- But `aggregateGroups` in `worker/src/services/document-extraction.ts`
  dedupes on a key that *does* include `scope_label`.

So two WBS observations that differ only by work package — same measure, same
chunk, same source value — pass the aggregate dedupe and then collide in the
database. Because the write is an upsert, the second overwrites the first with
no error and one work package's evidence disappears. A cost table listing the
same amount for two work packages in one chunk is enough to trigger it.

At project scope this is unreachable, because ticket 01 drops `scope_label`
for `scope_level: "project"`. It only bites once WBS rows are compared, which
is this ticket.

**Fix:** add a migration replacing the constraint with an expression index
over `coalesce(scope_label, '')`, since a plain unique constraint treats
NULL labels as distinct and would still permit duplicates. Update the route's
`onConflict` to match, and cover it with a test that two labelled rows sharing
a source value both survive persistence.

### 2026-10-28 — AC6 fix applied and verified

Migration `supabase/migrations/202610280001_cost_observation_scope_label_uniqueness.sql`
drops ticket 01's scope-label-blind unique constraint and adds
`cost_observations_scope_identity_idx`, a unique index over
`(document_id, measure, scope_level, evidence_chunk_index, source_value,
coalesce(scope_label, ''))`. `persistCostObservations` in
`src/app/api/workers/parse-document/route.ts` now plain-inserts instead of
upserting: the delete-first plus `aggregateGroups` dedupe already guarantee no
in-batch collision on exactly that key, and PostgREST `onConflict` cannot name
an expression index.

Applied to linked project DevXAssurance (`oaoevvwwjvcnjlonltcw`);
`supabase migration list --linked` shows local and remote in step through
`202610280001`. Service-role contract check (synthetic rows, deleted after):
two WBS rows differing only by `scope_label` both persisted; a true duplicate
and a duplicate project-scope (null label) row were both rejected with 23505.

### 2026-10-28 — ticket resolved (AC1–AC6)

**AC1 — WBS identity capture.** Migration
`202610280002_wbs_identity_on_cost_observations.sql` adds `wbs_code`,
`wbs_parent_code`, `wbs_name`, `scope_description` to `cost_observations`, with
a check that project-scope rows carry none. The worker extraction schema
(`document-extraction.ts`, version `/13`) captures them from the source and
forces them null for project scope; `persistCostObservations` and the cost
queries carry them. "Canonical code" is not stored on evidence — it is assigned
only by a reviewer-accepted mapping (AC2 / ADR 0004), so the model never writes
a canonical identity. DB check + a unit test pass; the live provider captured
code/parent/name/deliverable for a two-work-package cost table.

**AC2 — reviewer-accepted mappings.** Migration `202610280003_wbs_mappings.sql`
adds `wbs_mappings` (one accepted canonical target per source label per project,
self-maps rejected, accepted state requires attribution), with member-read /
reviewer-write RLS. Server actions `acceptWbsMapping` / `removeWbsMapping` and a
reviewer panel manage them. The comparison applies only `accepted` mappings;
identical labels match directly; the model never merges work packages. DB
constraint checks pass (23505 on duplicate accepted, 23514 on self-map and
missing attribution).

**AC3 — WBS cost comparison.** `wbs-comparison.ts#buildWbsBudgetFindings` groups
observations/baselines by canonical label and reuses `evaluateProjectBudget`
per WBS scope, so the project thresholds apply. Differing labels compare only
through an accepted mapping. Unit tests and the live smoke pass (Build on_track
at 0%, Design needs_attention at 5%).

**AC4 — scope comparison.** `buildWbsScopeCandidates` compares the WBS identity
captured on baseline-role vs current-role evidence and reports added / missing /
changed work packages as source-backed candidates (never approved changes),
grouped by canonical label. Unit tests pass.

**AC5 — WBS gaps never suppress the project total.** The single project-total
Budget finding is still the only `budget` row in `assurance_findings`
(`unique (review_id, domain)`); WBS findings and scope candidates are stored
beside it in the review's `analysis_metadata` and rendered in the WBS panel. A
WBS evidence gap is reported as its own gap and leaves the project total intact.

**Composition & UI.** `runAssuranceAnalysis` computes the WBS comparison and
scope candidates and stores them in `analysis_metadata`;
`getAssuranceWorkspace` returns WBS labels + mappings; the `WbsComparisonPanel`
renders WBS budget findings, scope candidates, and the reviewer mapping controls.

**Verification.** `tsc --noEmit` clean. Integration suite: 144 tests, 141 pass,
2 fail (pre-existing TXT/XLSX parser failures, unrelated), 1 skipped. Migrations
`202610280001/02/03` applied to DevXAssurance (`oaoevvwwjvcnjlonltcw`); migration
list local == remote. Service-role contract checks for AC1/AC2/AC6 and a live
provider smoke for AC1/AC3/AC4 all passed; all synthetic rows were deleted.

**Not done / not verified.**
- The reviewer UI (WBS panel, mapping accept/remove) has not been exercised in a
  running browser; it is server-rendered with the existing form-action pattern.
- Model auto-proposal of mappings is reviewer-driven (the reviewer maps surfaced
  source labels); the model does not itself write `proposed` mapping rows.
- AC4 scope items are derived from WBS cost observations, so a deliverable stated
  with no cost value is not captured as a scope item.
- Documents processed before schema `/13` carry no `wbs_*` until reprocessed.
