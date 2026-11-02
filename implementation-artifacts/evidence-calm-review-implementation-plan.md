# Evidence inspection: concise review implementation plan

**Status:** Implemented following the user's approval on 2026-10-30. The approved requirements are retained below; implementation choices and verification are recorded at the end.

## Goal

Make Baca & periksa easier to absorb: help a reviewer understand the document collection, identify files requiring attention, and read a short document summary before deciding to inspect individual extracted records.

Restore the old panel's compact presentation without restoring its accidental 20-row limit. Preserve the complete, reconciled dataset beneath the presentation.

This is a separate information-hierarchy change. It does not replace or edit the palette-only requirements in `ui-ux-spec.md`.

## Proposed experience

| Surface | Default presentation | Available on demand |
| --- | --- | --- |
| Page | Document collection; quick filters carry the attention counts | Extraction breakdown and full fact list |
| Document row | Filename, existing metadata/status, one extraction count | Category breakdown and records in the drawer |
| Document drawer | Key facts, short summary preview, one consolidated review notice | Extracted records, full summary, citations, metadata and administration |
| Extracted facts view | Compact, searchable, paginated list with quick review actions | Original text, citations, confidence, edit and correction details for a selected item |

## 1. Keep the document collection primary

- Keep Documents as the initial view when entering Baca & periksa.
- Keep the existing two accessible views, labelled **Documents** and **Extracted facts**. Remove large totals from the tab labels; show accurate totals in the relevant view's content instead.
- Retain the document count in the card header. Do not repeat it in another summary card.
- Show attention counts on the existing quick-filter buttons instead of adding a separate status line: for example, **Failed (8)** and **Needs review (6)**. These numbers are examples, not hardcoded values. The buttons keep their current filtering behavior, so the counts are clickable and no information is duplicated.
- Omit the count (not the button) when a category is zero. Count files, not extracted issues or risks. A failed file belongs to Failed only; it is not also counted as Needs review.
- Show processing files in the same way if a quick filter for them exists; otherwise do not add one for this change.
- Give Failed the established error treatment and Needs review the established warning treatment. Avoid new colored dashboard cards, charts or progress indicators.
- Preserve search, quick filters, Additional filters, category selection, sorting and document pagination behavior.

## 2. Replace category lists with one short pointer

Replace the five-category text in each Extracted cell:

| State | Proposed copy |
| --- | --- |
| Stored items available | **60 items** |
| Failed file with saved items | **62 items · Partial** |
| Completed file with no stored items | **None found** |
| Failed file with no stored items | **Unavailable** |
| Uploaded, queued or processing with no stored items | **Pending** |

For other states with no stored items, use **No stored items**; do not imply successful extraction. "None found" is deliberate: it reports what the extraction returned and does not claim the document contains no facts.

Keep the existing row click and chevron behavior: open the document drawer. Do not add row expansion, extra icon buttons, or a new navigation destination to the pointer.

Keep the full per-document category counts in the drawer's collapsed extracted-items section. They must use the same attributed facts as the compact pointer.

## 3. Make the drawer a concise document overview

Proposed order:

1. Filename, processing state and Close.
2. Existing key-facts strip: artifact type, period, and an explicitly extracted currency total when unambiguous.
3. **Summary preview:** up to three sentences and approximately 400–480 characters; retain Show full summary.
4. One consolidated review notice, only when applicable.
5. **Review extracted items (n)**, collapsed by default.
6. Source details, collapsed.
7. Metadata, reading details and administrative controls, grouped behind disclosures where practical.

The consolidated notice may explain partial processing, missing citations, or the existing possible summary/extraction mismatch. Use one notice region instead of repeating the same warning in several blocks. Keep distinct problems as short separate lines within that region.

The summary preview is truncated and may omit problems the full summary mentions. The notice region must therefore appear whenever the document has extracted issues or risks, independent of what the preview shows, and must link to Show full summary when the full summary is longer than the preview.

Remove the standalone expanded Flagged in this file list. Its risk/issue records remain available through type filters in Review extracted items. Show at most one compact line such as **“6 risks · 22 issues extracted”** when applicable; describe these as extraction categories, not verified findings or severity.

When Review extracted items is expanded:

- Show the category breakdown and filters.
- Show **10 compact rows per page**. Do not offer an unbounded Show all list. The list uses a fixed maximum height so the drawer does not grow with page size.
- Keep original text, source references, locations, confidence and corrections available for each record.
- Each collapsed row carries compact **Accept** and **Reject** icon buttons (with accessible names and visible keyboard focus), so the common review path is one click. **Edit** and correction details live in the expanded item.
- Preserve **Accept all** for pending suggestions with these rules:
  - Scope is the current document's pending items, and the control says so.
  - Activating it opens a confirmation that states the exact number of items and their per-type breakdown before anything is saved.
  - If the active type filter would narrow the scope, the confirmation offers both choices explicitly: the filtered type only, or all pending items in the document.
  - It never runs without that confirmation, and failures are reported per the existing mutation feedback.
- Keep missing-citation notices truthful; extraction-run ownership does not replace a citation.

Retain the entire existing summary and all currently accessible metadata and source details. No extraction data is discarded to shorten the drawer.

## 4. Make the full extraction view secondary, searchable and compact

- Keep the complete project extraction list accessible through Extracted facts.
- Show the complete total once in this view, worded as **stored rows**, for example **“1,369 stored rows.”** Do not call the total “facts” or “findings.” Place one short caveat on the same line or directly beneath it: **“Includes partial results and repeated rows.”** This caveat is always visible; it is not placed only inside a disclosure.
- Keep type filters, the single muted empty-types indicator, and **10-item** pagination.
- Add **search** over item text, and filters for **source document** and **review status** (pending, accepted, edited, rejected), alongside the type filters. Filters combine. Document and status filters change the filtered count shown with the list, but the project total above keeps its meaning (see counting scope below).
- Each collapsed row shows only a short item preview, review status and source document, plus the same compact Accept and Reject icon buttons as in the drawer. Include the type as a quiet label when All is selected.
- Keep Edit, original text, citations, confidence and corrections inside each item's expanded details. Keep source-document navigation directly available.
- Preserve shared review state between this view and the drawer, including save-failure feedback.
- Keep a collapsed **About these counts** disclosure for the full explanation: all stored rows and review statuses, partial results included, repeated rows retained, document filters do not change project totals.
- Keep individual partial-result and missing-citation indicators discoverable. Do not repeat a long explanation on every row.

## 5. Preserve data consistency

Reuse the current shared query and single-document attribution. Do not introduce an independent count query or fetch summaries as a substitute for fact records.

Required invariant, over the complete project collection:

```
Full extraction total = sum of all per-document item counts
Each drawer total = its document's pointer count
Each document's type counts sum to its item count
```

The current audited example is 1,369 stored rows across 26 documents. Treat it as verification evidence, not permanent application data.

Retain the integrity check for unresolvable ownership. Do not hide orphaned rows or remove duplicates to make totals reconcile. Do not restore the old 20-row cap.

## 6. Partial results from failed documents

Documents in Failed state may still have saved items (for example the water report with 62). For this change:

- Show these items with a visible **Partial** indicator wherever they appear (row pointer, drawer notice, fact rows).
- Keep them reviewable, since hiding them would break the reconciliation invariant.
- Do not change how Assurance Review selects evidence. Whether partial items from failed documents may feed an assessment is an open decision (see below), and this change must not silently decide it.

## Implementation sequence after approval

1. Simplify table pointers and tab labels; add attention counts to the quick filters; retain current filtering and navigation.
2. Consolidate drawer warnings and remove the repeated flagged-item list.
3. Put per-document review behind a collapsed, filtered, paginated section, with quick Accept/Reject and a confirmed Accept all.
4. Compact the full extraction view; add search, document and status filters; move Edit and details into the expanded item.
5. Update existing behavior tests and inspect the rendered desktop/mobile surfaces.

Expected application changes are limited to the document workspace and fact-review components. Reuse the existing query, actions, components and design tokens. No new UI library, route, database schema, model call or extraction pipeline is proposed. If server-side search or status filtering is not already supported by the shared query, report that as a gap instead of adding a second query path.

## Verification and acceptance criteria

- Initial view emphasizes files and their processing/review needs, without expanded extracted-record lists.
- No document row displays a five-category count paragraph; extraction pointers remain one compact phrase at desktop sizes.
- Default drawer presents its key facts and summary before detailed extraction work. It contains one consolidated notice region and no repeated risk/issue list.
- Expanding either review surface never creates an unpaginated stack of hundreds of records. Pages show at most 10 rows.
- With 1,369 stored rows, a reviewer can reach a specific item using search, document filter or status filter in a small number of steps, without paging through the full list.
- Accept all always shows a confirmation with the exact item count before saving; cancelling saves nothing.
- A single item can be accepted or rejected from its collapsed row in one action.
- The project total is labelled as stored rows and the short caveat is visible without opening any disclosure.
- All original information and review actions remain reachable by keyboard.
- Tabs retain correct roles, arrow-key navigation and focus behavior. Disclosures expose their state. The drawer traps focus, closes on Escape, and restores focus.
- Verify at 1920×1080, 1440×900 and 375px width, using representative long filenames, long summaries, partial files and missing citations. Target the primary desktop controls and first document page within approximately one viewport plus a short scroll; do not shrink text to achieve this.
- Recheck the live-snapshot fixture: the full extraction total and the sum across all document pages remain 1,369; the water report remains 62 items marked Partial.
- Verify category filtering, pagination, search, source navigation, Accept/Edit/Reject/Accept all synchronization, retained corrections and mutation failures using existing test seams.
- Record a visual review as a heuristic check. Do not claim reduced cognitive load has been user-tested without a user review.

## Explicit exclusions

- Extraction categorization changes, including task/progress entries stored as milestones.
- Duplicate deletion, merging, or hiding duplicate rows in counts.
- Repairing missing citations or job/extraction-run finalization.
- New AI summarization, severity ranking, representative-item selection, or recommendations.
- Changing which items Assurance Review can select, including partial items from failed documents.
- Sidebar changes, the other Evidence steps, or changes to Assurance Review behavior.
- Altering stored review statuses, model outputs, or source documents for presentation purposes.

The existing summary is only a shortened preview, not a newly synthesized project assessment. A meaningful cross-document narrative summary would require a separate agreement on content, evidence, and handling unreliable categories.

## Open decisions for the final version

1. Should partial items from Failed documents be selectable as evidence in Assurance Review? Default in this plan: display and review only; selection behavior unchanged.
2. Page size of 10 rows: confirm, or choose another value that keeps the drawer within one viewport plus a short scroll.
3. Does the shared query already support text search and status filtering? If not, which approach is acceptable (extend the query, or filter client-side for now)?
4. Should processing documents get their own quick filter, or stay out of scope?

The earlier proposed defaults still stand for confirmation: keep the two view tabs with quiet labels; collapse drawer extraction review by default; and use a factual overview rather than add AI summary generation. These are proposals for review, not approved implementation decisions.

## Revision notes (changes from the previous draft)

- Page size raised from 5 to 10 rows, with a fixed-height list; search, document and status filters added to Extracted facts.
- Accept all now requires a confirmation stating the exact count and scope.
- Compact Accept and Reject added to collapsed rows; Edit and details stay in expanded items.
- Project total reworded to “stored rows” with a caveat always visible; the full explanation stays in “About these counts”.
- The separate status line was replaced by counts on the existing quick-filter buttons.
- “No items” changed to “None found” for completed files.
- Added a section on partial results from failed documents and an open decision on Assurance Review selection.
- The notice region must appear whenever extracted issues or risks exist, because the truncated summary preview may omit them.

## Execution record — 2026-10-30

Implemented the revised plan in the document workspace and shared fact-review components. No new query, API, schema, dependency, model call, or extraction-pipeline change was introduced for this revision.

Choices for the open decisions:

- Assurance Review selection stays unchanged. Failed-file items remain visible, reviewable, and labelled Partial.
- Both review surfaces paginate 10 rows. The document drawer list is capped at 60% of viewport height / 40rem; the project list at 50% / 34rem to keep filters and pagination near the first desktop viewport.
- Search and document/status/type filters run client-side over the complete, existing shared dataset. No server-side search endpoint was needed, and searches are not restricted to the current page.
- No Processing quick filter was added.

Delivered behavior:

- Quiet Documents / Extracted facts tab labels; attention counts on existing Failed / Needs review buttons; one compact document extraction pointer.
- Summary preview, one consolidated notice with access to the full summary, and collapsed extraction/source/metadata disclosures in the drawer. The separate expanded flagged-item list was removed.
- Searchable and filtered project extraction view, a stored-row total with an always-visible caveat, compact Accept/Reject actions, and Edit inside expanded item details.
- Bulk acceptance requires a native modal confirmation with the exact pending count and category breakdown. When a type filter narrows the scope, explicit filtered-type and whole-document choices are offered. Cancelling makes no mutation; errors remain visible in the confirmation.

Verification:

- All 20 focused integration tests passed, covering existing document controls, pointer states, combined filters, pagination, ownership/count consistency, mutations, and permissions.
- Chrome fixture checks passed at 1920×1080, 1440×900, and 375px width. These cover source navigation, shared review state, quick actions and editing, bulk scopes and confirmation, cancellation, save failures, focus trapping, Escape, and bounded list heights.
- The 1,369-row live-query snapshot passed rendered reconciliation across all 26 document pages. Its water-report drawer retains 62 items labelled Partial; combined search/document/status/type filters preserve the full project total. This browser run made no database mutations.
- Changed-file lint, application-source TypeScript checks, and `git diff --check` passed. The source TypeScript check excludes generated `.next` declarations.
- Desktop and mobile screenshots were inspected. This is a heuristic visual review, not user testing of cognitive load.

Screenshots are under `.scratch/evidence-inspect/calm-*`. Existing categorization, duplicates, missing citations, and job/extraction-run finalization issues remain as documented in `evidence-data-consistency-audit.md`.
