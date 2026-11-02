# 03: Schedule and Progress Assurance

**What to build:** A PMO reviewer can compare approved milestone/work-package dates with explicitly reported forecast dates and inspect reported progress in the selected review period, without the system inventing schedule predictions.

**Blocked by:** 01: Project-Level Budget Assurance; 02: WBS Cost and Scope Comparison.

**Status:** resolved

- [x] Compare baseline and reported forecast dates only for the same milestone or work package; missing forecast dates remain evidence gaps.
- [x] Differently named milestones can be proposed as a source-backed mapping and used only after reviewer approval; accepted mappings are reusable within project scope.
- [x] Progress percentages are preserved as reported at project/WBS level and are not aggregated from WBS percentages or converted into forecast dates.
- [x] Compare progress across periods only when scope and WBS are comparable; preserve each source period/as-of date and use the PMO-selected review period.
- [x] For comparable schedule evidence, status uses the agreed thresholds: 0 days late on track, 1–14 days needs attention, and > 14 days critical.
- [x] The existing Assurance page shows schedule/progress results with exact source citations and evidence gaps.

## Comments

### 2026-10-28 — ticket resolved (AC1–AC6)

Schedule/progress reuses the review-prompt path (the model extracts raw
per-source values; fixed rules compute every condition), not a new worker
extraction stack — the same determinism ADR 0003/0005 require. This branch was
cut from `master` and was missing tickets 01/02, so `origin/ticket/02-wbs-scope-comparison`
was merged in first (clean fast-forward).

**AC1 — same-milestone date comparison.** `schedule-comparison.ts#buildMilestoneComparisons`
groups baseline and current milestones by canonical label and compares dates
only within a label. The review prompt now returns `baseline_milestones` and
`current_milestones` as separate lists, so the model never pairs differing
labels itself (ADR 0004). A milestone with a baseline date but no reported
forecast (or the reverse) is an explicit gap (`forecast_not_reported` /
`baseline_not_reported`), never a guessed date. Unit tests cover on-track,
ahead, needs-attention, critical, and both gap directions.

**AC2 — reviewer-accepted milestone mappings.** Migration
`202610280004_milestone_mappings.sql` adds `milestone_mappings`, mirroring
`wbs_mappings` but as a distinct namespace (a WBS code and a milestone label
that share a string are never grouped). Only `accepted` mappings are applied;
identical labels match directly; the model never merges milestones. Server
actions `acceptMilestoneMapping` / `removeMilestoneMapping` and the reviewer
panel manage them; one accepted canonical target per source label per project,
reusable across reviews. Applied to linked project DevXAssurance
(`oaoevvwwjvcnjlonltcw`); `supabase migration list --linked` shows local==remote
through `202610280004`. Service-role contract check (synthetic rows, deleted
after): accepted insert OK; a second accepted row for the same source label
rejected (23505); self-map rejected (23514); accepted without attribution
rejected (23514); a `proposed` row for an already-accepted source label inserts.
All 5 checks passed; synthetic rows cleaned up.

**AC3 — progress preserved.** `buildProgressComparison` keeps each reported
percentage as stated, at the level stated (project or WBS). It never sums or
averages WBS percentages into a project total and never derives a date from a
percentage. The prompt instructs the model accordingly. Unit tests confirm a
WBS value is preserved without a delta and a project value is preserved with its
own period/as-of.

**AC4 — cross-period progress only for comparable scope.** Progress is compared
only within the same scope key — project, or a WBS label resolved through an
accepted WBS mapping — using the current-role (reviewer-selected period) value
against a prior baseline-role value; each source keeps its own `period_label` /
`as_of_date`. Differing WBS labels without an accepted mapping, and labelless
WBS values, are preserved but not compared. The review period is the review's
reporting-period end, as for Budget. Unit tests cover mapped vs unmapped WBS and
the labelless case.

**AC5 — thresholds.** `buildMilestoneComparisons` applies 0 days late →
on_track (including ahead of baseline), 1–14 → needs_attention, > 14 → critical,
for comparable evidence only. `buildScheduleFinding` reports the worst comparable
delay as the single Schedule finding, or a named gap when none is comparable.
Unit tests assert 0 / 9 / 19 day cases and the ahead-of-baseline case.

**AC6 — Assurance page.** `ScheduleProgressPanel` renders per-milestone
comparisons (baseline → forecast, delay, condition), reported progress per scope
(current/prior, delta, period/as-of), evidence gaps with their reason, verbatim
source excerpts, and the reviewer mapping controls. `runAssuranceAnalysis` stores
`schedule_milestone_comparisons`, `progress_observations`, and
`schedule_milestone_labels` in `analysis_metadata`; the single Schedule finding
stays in `assurance_findings` and gets document-linked citations via the existing
excerpt-verification merge.

**Verification.** `tsc --noEmit` clean. Integration suite: 156 tests, 150 pass,
5 fail, 1 skipped. The 5 failures are all in `phase6-document-parser.test.mjs`
(TXT headings, XLSX serial dates, three PDF cases); that file imports nothing
from the assurance/schedule code and is unchanged by this ticket — pre-existing
/ environment. 12 new tests in `tests/integration/ticket-03-schedule-comparison.test.mjs`
pass. Four assurance tests and the LLM review fixture were updated to the new
extraction contract (split milestone lists + progress section).

**Not done / not verified.**
- The reviewer UI (schedule/progress panel, milestone mapping accept/remove) has
  not been exercised in a running browser; it is server-rendered with the same
  form-action pattern as the WBS panel (ticket 02 carried the same limitation).
- Model auto-proposal of milestone mappings is reviewer-driven: the reviewer maps
  surfaced source labels; the model does not write `proposed` mapping rows.
- A live-provider smoke of the full extraction→comparison path was not run; the
  LLM fixture exercises the new review-prompt shape instead.
- Progress and milestone evidence is extracted per review (not persisted like
  cost observations), so mappable milestone labels come from the latest review's
  `analysis_metadata`.
