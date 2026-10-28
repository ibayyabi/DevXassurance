# X-Assurance — Guided-inline C: UI/UX-Only Implementation Handoff

Date: 28 October 2026  
Status: **Guided-inline C is selected. Documentation corrections only are authorized; implementation requires explicit approval of a named batch and its acceptance criteria.**  
Audience: coding agent / developer receiving the work.

## 1. Decision and current authorization

The selected direction is **Guided-inline C**: guidance embedded in the existing Evidence workspace, with three navigable steps: **Prepare evidence → Check what is understood → Review results**. It is not a mandatory wizard, does not lock navigation, and does not itself establish readiness, assessment completion, freshness, or approval.

The current workstream is strictly UI/UX-only. Improve how existing information is presented and how users navigate it. Do not change frontend–backend interaction or business behavior.

### Eligible after separate implementation approval

- Component composition, layout, spacing, typography, and existing design-token usage.
- Accurate copy, guidance, labels, status presentation, empty/loading/error presentation using information already supplied to the frontend.
- Accessibility semantics, accessible names, keyboard operation, responsive behavior, and focus handling.
- Client-only presentation controls such as collapsible guidance, local search/filter/sort, and unsaved-edit indicators, provided they use already-loaded data and do not change submitted data or existing request behavior.
- Outside D1-D4, separately approved evaluation or bounded display-only refinement of a development-only, memory-only preview if it already exists. Preview fixtures must never be presented as production data.

### Outside the UI-only implementation scope

- Changes to API calls, request payloads, response parsing/handling, data-fetching behavior, query logic, server actions, routes that alter production behavior, background jobs, workers, LLM prompts, parsing/chunking, database schemas, migrations, persistence, authorization, RLS, or report lifecycle rules.
- New server-derived readiness/freshness/permission states or calculations. Do not infer them from document counts, timestamps, labels, DOM text, or local state.
- New or changed persisted evidence-role/period correction, triggering reassessment, background assessment orchestration, new domain extraction, or new OCR behavior.
- New dependencies, a new design system, a palette redesign, or a large unrelated refactor.

If a requested UI requires data the frontend does not currently receive, leave the data-dependent part deferred and present only a truthful display-only alternative. Do not simulate a production capability.

## 2. Source artifacts and precedence

This file is the governing specification. The companion `xassurance-guided-inline-handoff.md` is a pointer and cannot independently override it. Ticket paths are relative to this package's `issues/` directory.

The user identified this folder as the supplied ZIP package and authorized documentation corrections. No separate pre-revision originals, original ZIP archive, or original scratch plan/tickets were located. Preservation against historical originals and their blocker order remain unverified; do not reconstruct them from revised text. Deferred requirements remain documented without claiming equivalence to unavailable originals.

The earlier palette-refresh specification governs its original workstream, including its layout freeze. This package proposes only its explicitly listed presentation/layout changes after separate approval. Preserve the existing palette and design tokens. Documentation correction itself authorizes no implementation.

**Classification:** A means display-only (existing copy, labels, layout, warnings, and source presentation); B means frontend-only interaction (local disclosures, filters, stable section navigation, dirty indicators using already-loaded state); C means integration-dependent and deferred (new retrieval, response handling, contracts, persistence, authorization, business rules, extraction, or workflow state). Verification criteria inherit their subject's classification. Uncertain data or behavior remains unverified, not assumed A/B.

**Screen contracts:** Evidence receives documents, upload submissions, facts, and summaries, not Assurance domain findings or authoritative freshness. Missing screen data does not mean an assessment has not occurred or a domain is ready, complete, or blocked. Where relevant, say “Assessment results are not available on this screen” and retain the existing Assurance Review destination. New retrieval or prop contracts are C. Assurance/Overview may display findings already supplied there. Overview has review period, assessment metadata, and history, but no document upload timestamps. Preserve Budget source meaning (forecast versus actual). Evidence may expose existing confirmation states, fact sources, summary quality warnings, and document review details; preserve multi-document associations and never invent field-specific provenance from generic classification rationale.

Read these before editing:

- This governing specification (the historical `.scratch/evidence-ux-improvement/PLAN.md` is unavailable, not a prerequisite to reconstruct)
- `issues/01-preview-evidence-overview-reports.md`
- `issues/02-panduan-evidence-onboarding.md`
- `issues/03-kesiapan-evidence-domain.md`
- `issues/04-assessment-background.md`
- `issues/05-koreksi-peran-periode.md`
- `issues/06-overview-periode-freshness.md`
- `issues/07-reports-kelengkapan-approval.md`
- `issues/08-ekstraksi-evidence-panjang.md`
- `implementation-artifacts/ui-ux-spec.md` and the current user-journey/as-is documents.

The live repository and latest user authorization take precedence over stale mockups or historical notes. Guided-inline C is already selected; do not reopen the A/B/C decision unless asked.

## 3. Ticket-by-ticket alignment

### Ticket 01 — Isolated preview

No isolated preview was located. If none is found, record verification unavailable and defer creation. Existing-preview evaluation and any refinements require separate approval; no replacement preview or production route is authorized in D1.

This ticket is a **development-only design-validation surface**, not a production workflow. Its memory-only scenarios may be used to validate hierarchy and interactions. Do not promote its fixtures, scenario switcher, fake upload/processing controls, simulated approval, or simulated export to production. If the preview has already been built and checked, do not rebuild it just to satisfy stale checkboxes; verify current source and record actual status.

### Ticket 02 — Evidence guidance and optional onboarding

**Eligible after batch approval:** contextual copy near the existing uploader; optional, dismissible/reopenable help; examples and explanations that accurately describe currently supported formats; accessible disclosure and mobile layout. Keep bulk upload and the existing uploader unchanged.

**Defer:** claims about OCR or automatic analysis that are not verified in current behavior; new required classification steps; changes to upload requests or supported-format behavior.

### Ticket 03 — Budget/Schedule/Risk readiness

**Eligible after batch approval:** improve hierarchy and labels for existing structured values, gaps, source links, and known assessment states already passed to the UI. Display not assessed only when explicitly established by supplied state; missing screen data means unavailable on this screen; make no inference that absence of evidence means zero risk or On Track.

**Defer:** new readiness calculations, new evidence requirements, domain-specific fields not currently exposed, fabricated source links, or changing the meaning of Budget comparisons. If the existing data is insufficient, document the gap rather than manufacturing a complete readiness view.

### Ticket 04 — Assessment continues in the background

**Background behavior is deferred (C); truthful existing-stage wording is eligible in D1 (A) after approval.** Background orchestration is not a display-only change. UI copy may accurately describe current behavior, but must not promise that assessment continues after leaving the page unless this is already verified in the live implementation. Do not change triggers, workers, polling, or jobs.

### Ticket 05 — Evidence role and reporting-period correction

**Eligible after batch approval:** improve the display of existing role/period suggestions, detection rationale, source references, ambiguity, and the distinction between evidence role and user access role.

**Preserve:** existing metadata correction forms, field names, actions, and current save behavior. Do not remove, replace, or simulate working corrections.

**Defer:** new or changed save/cancel persistence, override protection, permission logic, or reassessment. Do not show a Save action that only changes browser state while implying persistence.

### Ticket 06 — Overview period/freshness/history

**Eligible after batch approval:** clarify existing period labels, assessment timestamps, upload timestamps, available history, and limitations when those values are already available to the component. Use precise copy and existing values.

**Defer:** new freshness association or computation, new period selection/persistence, cross-period comparison logic, or any claim that new evidence has or has not entered an assessment unless the authoritative data is already provided. This is not a substitute for Batch 1B.

### Ticket 07 — Reports completeness, freshness, and approval

**Eligible after batch approval:** improve stage labels and explanations using current props; show a client-side unsaved-edit indicator by comparing editor contents with the saved values already in memory; clarify that draft, approval, file creation, and download are distinct where current UI already supports those stages.

**Defer:** new or changed server-side approval/freshness guards, new completeness computation, changed report lifecycle, atomic save-and-approve, changed export behavior, or claims of freshness not supported by supplied data. Never change request payloads or approval/export rules in this workstream.

### Ticket 08 — Long-document extraction

**Deferred as an extraction/processing change.** Do not change parser, chunking, worker, LLM, document limits, OCR, or extraction schema. If existing metadata already exposes partial reading or quality warnings, the UI may present them clearly. If it does not, do not invent a partial-reading status; document the dependency for a later integration batch.

## 4. Guided-inline C presentation contract

The intended three-step composition is a presentation and navigation aid inside the existing Evidence workspace, not a new business workflow.

### Step 1 — Prepare evidence

- Explain the purpose of approved plans, current evidence, and reporting periods using verified product terminology.
- Keep the existing uploader visible and bulk upload available.
- Make guidance optional and reopenable; do not make tutorial completion a prerequisite.
- Do not require users to classify every document before upload.
- Upload acceptance must not be described as successful extraction or assessment.

#### Step 1 states and recovery

[A] Present only per-file intake and processing states already exposed by the uploader; [B] keep optional help local. These states do not establish assessment readiness.

| Supplied state | Message | Available action |
|---|---|---|
| No files selected | Select evidence to upload; one file may support several domains. | Use the existing file selector or bulk uploader; open optional help. |
| Files selected, not submitted | Files selected; upload has not started. | Use existing selection/remove controls and the explicit upload action. |
| Upload in progress | Uploading selected files. | Preserve existing progress and cancellation controls where provided; no new retry or cancellation behavior. |
| Accepted, queued, or processing | Upload accepted; reading is queued or in progress. | Inspect existing submission/document status; continue to Check without implying assessment completion. |
| Some files rejected, others accepted | Some files were not accepted. Review each supplied error; accepted files retain their existing status. | Correct the rejected files and use existing retry/reselect controls only for the affected items where supported. |
| Entire submission failed | Upload failed: show the supplied error. | Use existing retry/reselect controls where available; retain access to already uploaded evidence. |
| Canceled, if explicitly supplied | Upload canceled; accepted files, if any, retain their supplied status. | Inspect existing results and select/retry only through supported controls. |

[A/B] Partial-rejection recovery must keep accepted documents, selected/pending files, errors, and edits associated with their original identities. Do not automatically resubmit accepted files, clear remaining selections, or claim that nothing uploaded. If existing controls do not support targeted retry, explain the supplied error and retain their existing behavior; do not add requests or retry logic. [C — deferred] New per-file outcomes or retry capabilities not currently supplied.

A Step 1 stepper click must not submit a form, trigger a request, save local or persisted workflow state, confirm findings, or approve a report. Only its transient navigation/focus position may change; uploader state remains mounted.

### Step 2 — Check what is understood

- Present only states/results supplied to this screen under section 2's contracts. Evidence must not imply it receives domain findings or authoritative freshness. Preserve the explicit manual Assurance Review destination.
- Keep processing state separate from assessment readiness and reviewer confirmation.
- Show existing source references and gaps clearly; do not invent page numbers, values, source links, or domain classifications.
- Allow users to navigate onward even when information is missing, while explaining the known limitation.
- A stepper click must not save evidence selection, confirm findings, or approve a report.

#### Step 2 states and recovery

[A] Distinguish reading/extraction from reviewer confirmation. Only show a named state when the supplied fields support it; otherwise use an unavailable/unknown message.

| Supplied state | Message | Available action |
|---|---|---|
| No extracted information available | No extracted information is available on this screen. | Inspect document status or return to Prepare; retain the Assurance Review destination. |
| Queued or reading | Reading is queued/in progress; extracted information may not yet be available. | Inspect existing progress; keep current refresh behavior unchanged. |
| Suggestions available, unconfirmed | Extracted suggestions need reviewer confirmation. | Inspect existing values and sources; use existing metadata/fact correction controls explicitly. |
| Reviewer-confirmed information | Show the supplied confirmation label separately from processing status. | Inspect the confirmed value and associated sources; preserve existing editing permissions/actions. |
| Quality warning or explicit partial reading | Reading has limitations: show the existing warning without implying complete coverage. | Inspect affected documents, summary sources, and existing review details; retain navigation onward. |
| Failed or unreadable | Reading failed or needs attention: show the supplied error/review details. | Use existing recovery controls where available; return to Prepare to select another file explicitly. |
| Domain findings unavailable here | Assessment results are not available on this screen. | Open the existing Assurance Review destination; do not label the domain not assessed, ready, complete, or blocked. |

[A] Partial-coverage recovery preserves available excerpts, original document associations, and warning context. A missing value is not zero, absence of risk, or proof the whole document was read. A generic quality warning must not be relabeled as a measured coverage percentage or a specific unread page range. [C — deferred] Coverage measurements, OCR, extraction repair, new domain findings, or reprocessing capabilities not already supplied. Existing user-invoked correction/recovery actions remain unchanged; navigation never invokes them automatically.

A Step 2 stepper click must not submit a form, trigger a request, save state or evidence selection, confirm findings, or approve a report. Preserve unsaved edits; transient navigation/focus is not a confirmation or business-state transition.

### Step 3 — Review results

- Use existing authoritative status/data to explain what is available and the next sensible destination.
- Keep Overview and Reports on their existing routes and preserve their existing behavior.
- Do not move report generation, approval, or export into Evidence.
- Never style old/unknown results as current simply because this is the final step.

#### Step 3 states and recovery

The Evidence screen does not currently receive authoritative assessment/freshness state. Its current [A] fallback is **Assessment results are not available on this screen**, with existing Assurance Review, Overview, and Reports destinations. The states below document required behavior without authorizing new data integration. A retained finding, completed file, timestamp, count, or final step position must never select one of these states by inference.

| State and required evidence | Message when authoritatively established | Available action and current scope |
|---|---|---|
| No assessment yet: explicit assessment state | No assessment has been run for this review. | Retain the existing manual Assurance Review destination. [C — deferred] Establishing this state on Evidence. |
| Assessment processing: explicit assessment-job state, distinct from file reading | Assessment is running; results are not yet available. | Inspect the existing Assurance Review surface; no new polling or promise of background completion. [C — deferred] Supplying this assessment state to Evidence. |
| Partial assessment: explicit domain/result coverage | Only the identified assessment results are available; show supplied gaps. | Inspect available findings/sources on existing Assurance/Overview surfaces [A]; [C — deferred] new partial-assessment classification or its display on Evidence. |
| Complete and current: authoritative successful-analysis and freshness association | Assessment complete and current for the identified review/evidence snapshot. | Open existing review/results destinations; retain existing report controls and guards. [C — deferred] Current-state association/display on Evidence; completion timestamps alone are insufficient. |
| New evidence not yet assessed: authoritative evidence-to-analysis association | New evidence is not included in these assessment results. | Inspect retained results and use existing manual review/analysis controls explicitly on Assurance Review. [C — deferred] Determining/displaying this association on Evidence; no automatic reassessment. |
| Operation failed: explicit assessment failure | Assessment failed: show the supplied error; do not discard retained results. | Inspect existing error/recovery controls on Assurance Review. [C — deferred] New assessment failure data on Evidence; file-processing failures remain Step 2 states. |
| Status unknown or not supplied: current Evidence contract | Assessment results are not available on this screen. | Open existing Assurance Review, Overview, or Reports links [A]; no freshness badge or inferred completion. |

[A] Stale/unknown-result recovery must preserve retained values and source context without styling them as current. Do not hide old findings, erase edits, change permissions, disable existing actions, or impose new approval/export gates. [C — deferred] An authoritative stale label on Evidence and any new stale-specific reassessment or report restriction. Existing backend safeguards remain intact, with deployment unverified. Existing result destinations may show already-supplied findings, but a timestamp-based comparison there is not authoritative freshness.

A Step 3 stepper click must not submit a form, trigger a request, save state, confirm findings, run analysis, generate/export a file, or approve a report. Opening an existing destination is a separate explicit link action with its existing route behavior; the stepper itself remains local navigation.

### Navigation and responsive behavior

- Prefer navigation between stable, mounted sections. Preserve selected files, upload controls, pending selections, unsaved metadata/fact edits, and existing processing-refresh behavior. Step changes may update transient navigation/focus only: they must not submit forms, trigger requests, save workflow state, confirm findings, approve reports, reset local state, or introduce persistence. Use non-submit buttons where applicable.
- If these guarantees cannot be established from the architecture, mark navigation unverified and report the dependency for evaluation; do not weaken the requirement or change integration behavior.
- Preserve the existing app shell, visual identity, typography, and tokens.
- Desktop may place step navigation beside the active content; mobile should stack it above content without horizontal scrolling.
- Use links/buttons with clear names and `aria-current="step"` for the current step; do not use tab semantics unless the full ARIA tabs pattern is implemented.
- Preserve direct access to Overview and Reports. The stepper must not lock users into a wizard.
- Use existing routes and data contracts. If a three-step composition requires changing route behavior or server integration, stop and report the dependency.

## 5. Recommended implementation batches

### D1 — Guidance, status clarity, and accessibility

Eligible: Ticket 02 copy/disclosure, audit items for contradictory automation messaging, accessible names/current-navigation semantics/form labels, stage-specific wording for existing document states, source-text readability using existing tokens, and honest feature availability.

Acceptance: all copy reflects actual current behavior; existing states remain distinct; keyboard/focus/accessibility behavior improves; no request or payload changes.

### D2 — Evidence review efficiency

Eligible: stable Guided-inline section navigation and state preservation, existing quality warnings, metadata/fact/source clarity, local attention filters, filename search, clear filters, collapsible grouping, and source-reference navigation using already-loaded documents/facts. Keep an “All documents” route/view. Preserve fact identity, edits, and source associations.

Acceptance: users can find failed/needs-review items and return to the full list; local controls do not drop edits or alter submission IDs; no project-wide counts are claimed unless supplied.

### D3 — Reports and Advisor presentation

Eligible: client-side unsaved-edit indication, accurate labels for generated files vs downloads, existing preview-specific counts where supplied, and sources displayed beside their corresponding Advisor answers using already-present message data.

Acceptance: presentation reflects saved/current client values without changing save, approval, export, or Advisor request contracts.

### D4 — Assurance and Overview hierarchy

Eligible: section order, scanability, labels, next-action explanations, and display of existing period/assessment metadata. Do not introduce freshness claims or new readiness calculations.

Acceptance: users can identify the selected context and available action; unknown or unavailable state remains explicit; no business-state transition occurs through navigation alone.

### Explicit ownership and dependencies

| Batch | Owned criteria / classification | Dependency and boundary |
|---|---|---|
| D1 | Ticket 02 guidance A/disclosure B; Ticket 04 truthful stage wording A; existing status, accessibility, source readability A | Explicit D1 approval and verified behavior. No new preview or step composition; background criteria remain open. |
| D2 | Section 4 stable Guided-inline navigation B; local filters/grouping B; Ticket 05 metadata and existing fact/source clarity A; Ticket 08 quality warnings A | Review D1 diff/results and obtain D2 approval. Establish state preservation before navigation changes. No domain findings integration into Evidence. |
| D3 | Ticket 07 report labels/counts A and dirty indicator B; audit-origin sources beside each Advisor answer A | Review D2 diff/results and obtain D3 approval. Reuse saved props and message-level sources; preserve existing actions. |
| D4 | Tickets 03/06 existing Assurance/Overview hierarchy, domain values, period/history context A | Review D3 diff/results and obtain D4 approval. Existing per-screen data only; no freshness integration. |

D1 is proposed first, not automatically authorized. Each batch requires explicit approval. Ticket 01 existing-preview evaluation is outside D1–D4 and requires separate approval; no isolated preview was located, so creation and runtime verification remain deferred. Original integration blockers are unverified until originals are available; integration work needs a separately evaluated dependency plan.

Record completion per eligible A/B criterion. Never close an entire parent ticket while C criteria remain deferred. UI work need not wait for backend work if truthful with existing data.

## 6. Mandatory agent workflow

Before coding:

1. Inspect available repository skills and read relevant instructions rather than inferring behavior from names. At minimum check `ui-skills`, `implement`, `ponytail`, and applicable specification/handoff skills such as `grill-with-docs`, `implement-spec`, `to-spec`, `to-tickets`, and `handoff` where available.
2. Inspect current branch/status and the actual source components. Do not assume the prior preview verification or Batch 1A deployment state is current.
3. State the exact batch and ticket acceptance criteria being implemented.
4. Present the files to change, the existing data to reuse, and the tests to run. Wait for approval before editing.

During implementation:

- Keep the change minimal and reuse existing components/tokens.
- Do not alter any FE–BE interaction, request payload, response handling, data fetching, server action, database query, persistence, business rule, or authorization.
- If a change cannot satisfy its acceptance criteria without crossing this boundary, stop that sub-item and report it as deferred.

After implementation:

- Run relevant unit/component/accessibility tests and available lint/type checks.
- Inspect the diff for API, action, query, and backend changes; if any were made, revert them unless separately authorized.
- Report actual tests and runtime checks separately; do not call source inspection a live test.
- List changed files, acceptance criteria completed/deferred, risks, and any data/integration dependencies.
- Stop after the approved batch.

## 7. Verification checklist

- Desktop and mobile, including 390px width, long filenames, dense lists, and zoom.
- Keyboard-only use, visible focus, accessible names, current step semantics, disclosure controls, and status announcements.
- Empty, uploaded, queued, processing, completed, needs-review, failed, and canceled states only where those states exist in current data.
- Source references and confirmation labels remain associated with the correct facts/documents.
- No new false claims about automation, OCR, completeness, freshness, approval, or background work.
- No API/request/payload/response/query/server-action/schema/migration/worker changes.
- Existing upload, evidence selection, report save/approval/export, and Advisor behavior remain unchanged.

## 8. Dependencies intentionally deferred

The following remain separate integration work and must not be smuggled into UI batches: background assessment (Ticket 04), new or changed persisted evidence role/period correction and reassessment (Ticket 05), new domain readiness data/calculation (Ticket 03 portions), authoritative period/freshness/history alignment (Ticket 06 portions and Batch 1B), new or changed server-side report freshness/completeness/approval behavior (Ticket 07 portions), and long-document extraction changes (Ticket 08).

Preserve existing Batch 1A safeguards for analysis attempts, evidence snapshots, atomic findings publication, and report generation/approval/export. Migration deployment is unverified. Do not bypass, reimplement, or assume deployment of these guards. New authoritative freshness consumption is deferred integration work (Batch 1B). Existing timestamp comparisons, counts, status labels, and visual state do not establish freshness.

The display layer must be honest about unavailable data. A visual label is not a substitute for an authoritative backend guarantee.

## 9. Source map (inspect before editing)

- Evidence entry: `src/app/app/projects/[projectId]/documents/page.tsx`
- Evidence surface: `src/features/documents/components/document-intelligence.tsx`
- Upload UI: `src/features/documents/components/upload-document-form.tsx`
- Existing processing summary and manual Assurance-review guidance; does not trigger assessment (inspect only; do not change): `src/features/assurance/components/automatic-assessment.tsx`
- Assurance actions (inspect only; do not change): `src/features/assurance/actions/assurance-actions.ts`
- Analysis and queries (inspect only; do not change): `src/features/assurance/lib/analysis.ts`, `src/features/assurance/lib/queries.ts`
- Overview: `src/features/dashboard/components/usable-overview.tsx`
- Reports: `src/features/reports/components/report-workspace.tsx`, `src/features/reports/actions/report-actions.ts`, `src/features/reports/lib/queries.ts`
- Parsing/extraction (out of scope for current UI-only work): `worker/src/services/document-parser.ts`, `worker/src/jobs/process-document.ts`
- Job orchestration (out of scope): `workflows/n8n/x-assurance-supabase-document-polling.json`

Confirm paths against the current checkout; this list is a starting point, not proof of current implementation.

## 10. Skills and reporting

Report which skills were actually inspected and used. Relevant skills may include `ponytail`, `ui-skills`, `impeccable`, `codebase-memory`, `to-tickets`, and `diagnosing-bugs` if available and relevant. Do not claim to use unavailable tools or skills. Preserve existing work-item granularity; do not publish duplicate tickets or create a second backlog unless explicitly requested.

## 11. Agent opening instruction

> Read this governing specification, the companion pointer, all eight supplied tickets, and current source. Report missing historical originals without inventing them. Guided-inline C is already selected. Propose D1 only; implementation requires explicit approval. Before editing, inspect the relevant agent skills, report the exact files/data/states to reuse, the proposed changes, acceptance criteria, and tests, then wait for approval. Keep all changes strictly presentational/client-only: no FE–BE interaction, request/response handling, fetching, server action, query, persistence, worker, schema, or business-rule changes. Defer any requirement that needs new data or backend behavior. Stop after D1 and report actual verification.
