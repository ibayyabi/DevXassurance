# 02: WBS Cost and Scope Comparison

**What to build:** A PMO reviewer can compare cost and approved scope at project and WBS/work-package levels when source records can be matched, while retaining a supported project-total result when WBS evidence is incomplete.

**Blocked by:** 01: Project-Level Budget Assurance.

**Status:** ready-for-agent

- [ ] WBS evidence captures source/canonical code, parent code when present, name, and stated deliverable/scope.
- [ ] Differently coded or named work packages can be proposed as a source-backed mapping; a reviewer must accept it before comparison or reuse within its approved scope.
- [ ] Compare baseline and reported EAC for matching WBS records without merging unaccepted mappings.
- [ ] Compare reported scope with the approved baseline and show added, missing, or changed items as evidence-backed candidates, not approved changes.
- [ ] Missing or incomparable WBS data is shown as a WBS evidence gap and does not suppress a supported project-total Budget result.
- [ ] A WBS observation is never silently replaced by another work package's row: the `cost_observations` uniqueness key includes the scope label.

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
