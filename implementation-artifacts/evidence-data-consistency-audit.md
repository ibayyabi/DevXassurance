# Evidence count consistency audit

Audit date: 2026-10-30. Read-only checks against the Smart Building project `f2f5ba32-3887-43ea-9e75-4a5c3225f465`, identified by the exact first-page counts and the water report's 62 facts. Another project has the same name and 26 documents; its data was not mixed into these results.

## Query scope and the old 20-item panel

Replaying the original `extracted_facts` query (`project_id`, `created_at desc`, `limit 20`) reproduces exactly **10 milestones, 8 decisions, 2 risks, 0 issues, 0 owners/actions**. Those were the newest 20 rows, not project totals. Many rows share insertion timestamps, so the old ordering also lacked a stable tie-breaker.

| Surface | Rows counted | Limits and filters | Deduplication |
| --- | --- | --- | --- |
| Old Review extracted details | Returned project fact rows grouped by fact type | Newest 20; project ID only; all review statuses; no selected-evidence filter | None by text, source, or extraction run |
| Previous Extracted facts tab | All returned project fact rows | Server pages of 500 ordered by timestamp and ID; client type filter and five-row pages | None by text |
| Previous document pointers/drawer | Facts with an evidence link to that document | Same fetched fact set; document table filters and ten-row pagination only affect visible documents | Repeated links within one fact counted once, but a fact linked to several documents could count in several files |
| Corrected tab, pointers, drawer | One shared project fact set; exactly one owning document per fact | All server pages of 500; all review statuses and extraction runs, including failed/incomplete runs; no selected-evidence filter | No text deduplication; ownership prevents supporting citations from creating extra counts |

Document search/type/period/workstream/status filters and sorting do not change the project-wide tab count. Fact type chips and pagination change the visible subset, with its own Showing range. Document summaries are separately capped at 100; they do not supply fact counts. Document and metadata queries retain the API's default response ceiling; the audited project has only 26 documents.

## Reconciled counts

| Fact type | Old limited panel | Complete stored rows |
| --- | ---: | ---: |
| Milestones | 10 | 497 |
| Decisions | 8 | 367 |
| Risks | 2 | 65 |
| Issues | 0 | 211 |
| Owners & Actions | 0 | 229 |
| **Total** | **20** | **1,369** |

All 1,369 rows currently have `ai_extracted` review status. There is no review-status filter explaining the discrepancy.

The six populated files in the supplied screenshot have 324 evidence-linked rows: 105 milestones, 87 decisions, 15 risks, 71 issues, and 46 owners/actions. These match the screenshot.

There are **332 additional rows with no evidence links**. They were included in the tab but excluded by the previous per-document attribution:

- `Perhitungan dari Spesifikasi Teknis Smart Building Pemetaan Kegiatan dan Prioritas Pembelian Barang.xlsx`: 123 rows, all missing citations; Failed.
- `All Minutes of Meeting Smart Building.docx`: 209 rows, all missing citations; Failed.

Each of these rows still references an extraction run with a document ID. The corrected shared query joins `extraction_runs(document_id)` and uses that ownership. It does not invent source excerpts, locations, or evidence links. Missing citations are explicitly disclosed in the fact view and drawer.

For legacy rows without run ownership, a single distinct source document provides a fallback. Multiple supporting documents never multiply a count. Unresolvable ownership raises an explicit integrity error instead of silently producing inconsistent totals.

The live production-query check verified:

```
Extracted facts tab total:             1369
Sum of all 26 owning-document counts: 1369
Distinct fact IDs:                    1369
Unattributable facts:                    0
```

Rows have not been deleted, deduplicated, recategorized, or filtered out to achieve this equality.

## Failed water report

`07_Air_Bersih_Subcontractor_Weekly.xlsx` has **62 stored rows**: 11 milestones, 10 decisions, 6 risks, 22 issues, 13 owners/actions.

- Document ID: `bbc97d81-dfe5-4b3e-93f7-373e0cf3055f`.
- Job `ec115e60-3f9c-4d34-8717-121936b8c393`: Failed; `retry_limit_exceeded`; three of three attempts; recorded lease-expiry recovery.
- Extraction run `6956fb38-db16-4748-bc94-5b928bbb86ba`: still Processing; metadata records 62 facts and 22 chunks.
- Facts were persisted at **2026-10-18 23:52:56 WIB**; the job/document were marked Failed at **2026-10-19 00:20:00 WIB**. Some extraction-group checkpoint timestamps extend beyond that failure. All eight saved group checkpoints are now Completed.
- All 62 fact citations match their currently stored source chunks across 22 chunks. This verifies citation consistency, not the correctness of every model interpretation.

The Failed badge agrees with the terminal job state and must not be changed to Completed just because fact rows exist. The extraction run's lingering Processing state is inconsistent with that terminal job. The observed data and the sequential n8n persistence path support partial persistence plus incomplete/late finalization after lease recovery; the records alone do not identify every failed workflow node.

The UI now labels nonzero Failed-file counts **Partial (n)**, repeats the partial warning in the drawer, and marks their facts as partial in the tab. Saved facts remain inspectable. Repairing job/run finalization and missing citation persistence is separate pipeline work; no database status or extraction data was rewritten by this audit.

## Duplicate rows

Using **owning document ID + trimmed, otherwise unchanged extracted text**:

- 40 repeated-text groups, containing 70 rows beyond one row per group.
- 34 groups repeat within one fact type; six span different fact types.
- No repeated-text group spans multiple extraction runs in this dataset.
- There are no facts with evidence links to multiple distinct documents in this project. Cross-document counting was a latent issue, not the cause of this project's difference.

Example: `Validate main/floor panels, 40 power meters, data transmission, installation manpower, and 4-system procurement.` occurs eight times as Owners & Actions in `KEGIATAN SMART BUILDING.xlsx`, in the same extraction run. `UAT / handover readiness` occurs five times as Milestones in that document.

Identical text is a duplicate candidate, not proof that the underlying source occurrences are interchangeable. Citations and review records must be considered before any future deduplication. Current counts intentionally count stored rows, including these repetitions.

The extraction aggregator concatenates group facts with `groups.flatMap(group => group.value.facts)`; unlike some alerts/actions, facts are not deduplicated during aggregation. Persistence inserts fact rows without a document/text uniqueness constraint. This explains how repeated source/chunk interpretations can remain separate rows; it does not prove that every repeated row is erroneous.

## Weekly-report categorization

Yes: activity, task, and progress entries are stored as Milestones. Confirmed examples include:

- `06_Pengkondisian_Udara_Subcontractor_Weekly.xlsx`: `Utility data architecture & interface design`, cited from an Activity / Work Package field.
- The same file: `Report completion/evidence: Utility data architecture & interface design`, cited from Work Completed This Week.
- `01_Alarm_Kebencanaan_Subcontractor_Weekly(1).xlsx`: `Update installation/integration/testing progress and evidence`, cited from Work Completed This Week.
- The HVAC report also stores `Overall progress 0.0` and `Week W14 planned %: 0.95` as Milestones.

Some other milestone rows do cite explicit Milestone fields, such as Design approved. The category therefore mixes actual milestones with activities and progress measures. Categorization and extraction prompts remain unchanged, as requested.

## Verification

- Original limited query replay reproduced 10/8/2/0/0.
- Updated production query executed against the live project and reconciled 1,369 rows with the document sum.
- Missing-citation attribution, single-document ownership, review-status preservation, partial Failed-file labels, pagination and integrity errors are covered by focused tests.
- Browser checks exercise the actual UI components with mocked mutations; the live database was queried read-only.
- A browser pass using the live query snapshot summed the displayed pointers across all 26 documents: **1,369**, matching the tab total. It also verified all type-chip totals and the water-report drawer's **62 partial items**. No database mutations occurred.
- All 17 focused tests, changed-file lint, and application-source TypeScript checks passed. The standard fixture browser checks also passed for keyboard navigation, filters, review-state synchronization, drawer focus/Escape, and mobile overflow.
