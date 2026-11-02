# Phase 6 — Evidence Intake and Grounded Advisor PRD

Status: Planning draft; user-approved direction, detailed scope captured here  
Environment: XAss-Development only  
Scope: Evidence intake, document understanding, evidence review, and AI Advisor grounding

## Decision and relationship to existing product documents

This PRD makes the evidence experience explicit as two supported paths: bulk import without pre-classification, and guided single-file submission with an optional document-type hint. It extends the approved Phase 5 direction to upload and organize project evidence; where the Phase 5 brief implies one bulk-only intake control, this PRD supersedes that detail. It retains the Phase 3 evidence contract: document type and review role are distinct, AI suggestions are correctable, project claims remain traceable, and failed or missing evidence is never represented as successful analysis.

This is a development planning document, not authorization to change production. Implementation, data migration, and runtime verification must happen in XAss-Development; production release requires separate approval and release/rollback preparation.

## Problem

PMC/PMO users work with mixed project records—plans, progress reports, procurement and cost files, meeting minutes, technical references, and workstream reports. Requiring a user to upload and classify these one by one does not fit a mature project's evidence archive. A single “upload everything” path also fails users who know what an individual submission is and want to identify it up front. ZIP archives are a common packaging format but are not currently expanded into individual evidence records.

The current upload form accepts multiple files, and the upload endpoint creates a document and parse job per processable file. It does not accept ZIP as an ingestion package; absent a type hint currently defaults to `progress_report`. The user has experienced indefinite loading for files larger than 10 MB in the deployed web app. That is a confirmed user-visible failure, not a confirmed database diagnosis; its root cause is not established here.

The free/local-model path also needs stronger grounding and recovery. Processing is bounded by current parsers and prompt truncation; the model can return unusable output, and document text/metadata do not yet provide the retrieval and citation quality expected for a project advisor. The Advisor retrieves a small, keyword-matched set from the latest review, does not send prior turns to the model, and labels sources with a fixed confidence value. The interface therefore looks conversational without reliably behaving as a context-aware conversation.

## Users and jobs to be done

- **Project manager / PMO / PMC user:** Upload a project's existing files efficiently, know which ones were accepted and processed, correct uncertain AI suggestions, and locate evidence by purpose and reporting period.
- **Reviewer / sponsor:** See which evidence supports an assessment, identify gaps and conflicts, and distinguish approved plans from current-period records and supporting context.
- **AI Advisor user:** Ask a project question, ask a follow-up, and verify the answer against the project's actual source excerpts.

## Goals

1. Support bulk selection of ordinary files and ZIP packages without requiring users to classify each file first.
2. Keep a guided one-file flow with an optional type dropdown and an “I’m not sure” / automatic suggestion choice.
3. Turn each accepted file into an independently tracked evidence item with its own upload, parse, classification, retry, and failure state.
4. Make common project artifacts recognizable without forcing PMBOK knowledge-area classification.
5. Produce source-grounded summaries and structured facts with a free/local LLM; handle provider failure and weak outputs honestly.
6. Organize evidence by review role, with type, period, workstream, and processing status available as facets.
7. Improve Advisor retrieval, follow-up context, and citations without adding an unproven multi-agent architecture or vector database.
8. Preserve project isolation, reviewer correction, and deterministic application calculations.

## Non-goals

- PMBOK knowledge-base RAG or a methodology chatbot.
- Multi-agent or multi-model orchestration in n8n.
- A vector database/embedding pipeline in this iteration. Add only if evaluation shows PostgreSQL full-text retrieval misses important evidence.
- Replacing deterministic Budget, Schedule, or Risk condition calculations with LLM judgments.
- Treating every arbitrary file as analyzable. Unsupported or unreadable files must be stored only when safe and labeled for review, never marked analyzed.
- Production rollout as part of this work.

## Domain contract

Do not conflate these fields:

- **Document type:** what the artifact is (for example, meeting minutes, project progress report, procurement request, technical specification).
- **Evidence role:** how the artifact is used for a particular reporting-period review: Approved Baseline, Current Period, or Supporting Evidence. A document type does not determine a role by itself; an approval, date, and review context matter.
- **Reporting period / document date:** extracted date metadata; unknown remains unknown, not an invented month.
- **Workstream:** optional project grouping such as electrical, access control, or HVAC; a filter, not a replacement for type or role.
- **Processing state:** Uploaded, Queued, Analyzing, Needs Review, Ready, or Failed. A processed file can still need reviewer confirmation.
- **User decision:** confirmed or corrected type/role, kept with provenance so later analysis uses the human decision.

Initial type groups, informed only by names and extensions in the `SMART BUILDING/` inventory:

1. Plans and baselines — project plan, approved baseline/schedule/budget.
2. Progress and delivery — project or workstream/subcontractor weekly or monthly report.
3. Finance, cost, and procurement — finance/cost report, forecast, procurement request, purchase or cost calculation.
4. Meetings and decisions — minutes, decision, action record.
5. Risk, issue, change, and approval — risk/issue log, change record, approval.
6. Technical reference — proposal, technical specification, component/standard document.
7. Other / not sure.

Filename/extension inventory indicates technical specifications and standards, proposals and planning presentations, meeting minutes, procurement requests and cost calculations, project spreadsheets, and recurring workstream/subcontractor progress spreadsheets. These are likely artifact types, not facts about document contents or approval.

The folder was inspected by filename and extension only; no cell values, text, or document contents were read. Do not ingest these files as evaluation data without explicit permission.

## User experience and workflows

### A. Bulk import

1. User opens a project Evidence area and chooses **Upload multiple files**.
2. User selects multiple supported files, or a ZIP archive. No per-file category is required before upload.
3. For ZIP, the system displays a manifest of safe, supported members and any rejected members before or during import; users can see why a member will not be processed.
4. The app shows upload progress and then a separate processing state for every member. One failed member does not erase or hide successful siblings.
5. Each file receives an AI type/date/period/summary suggestion and, when used for a review, a suggested evidence role. Low-confidence, conflicting, or incomplete results go to **Needs Review** with a clear correction action.
6. Users can retry or replace one failed item without resubmitting the entire package.

### B. Guided single-file submission

1. User selects one file and may choose a document type from a short, understandable dropdown.
2. The type field is optional; **Not sure — suggest automatically** is a valid choice.
3. The app displays the chosen hint separately from the AI result, then the same per-file processing and review states as bulk import.
4. The user can correct type, date/period, workstream, and review role before those values are used for a review.

### C. Evidence library and active review

- In a review, show Approved Baseline, Current Period, and Supporting Evidence as the primary groups; show type, period, workstream, and processing state as filters/secondary labels.
- In the project archive, allow grouping/filtering by document type and workstream without assigning a review role prematurely.
- A document card shows filename, upload date, file type, processing state, suggested/confirmed type and role, detected date/period, concise summary, and a review action when necessary.
- Evidence excerpts and page/sheet/section links are available through a source detail/drawer; raw parser chunks are not primary content.
- Batch progress is visible after navigation away and back; a settled batch does not depend on an Evidence page remaining mounted to trigger its final review/assessment step.

### D. AI Advisor

- A follow-up question uses prior turns in the current conversation as conversational context, but only newly retrieved, authorized project evidence and stored assessment facts can support project claims.
- The Advisor retrieves across the relevant review scope and reporting period, not just arbitrary text matches from one latest snapshot.
- Each project-specific statement can be traced to an actual document/chunk/page/sheet/section excerpt. The UI distinguishes direct evidence from inference and states when evidence is absent or conflicting.
- No fixed confidence value is presented as a model confidence score.

## Functional requirements

### Intake and upload reliability

- Support multi-file upload as independent items and partial success.
- Move large file bytes through an authorized Storage upload path rather than relying on an unbounded application-server multipart request body; use resumable transfer where supported and warranted by development verification.
- Show determinate per-file upload progress, completion, retryable failure, and configured size/type limit errors. Never leave a spinner running without a terminal or actionable state.
- A file larger than 10 MB and within the documented service limit must be exercised in development. Files above the configured limit must fail promptly with the limit and recovery option visible.
- Preserve one document record and one `parse_document` job per processable file; retain batch/submission lineage for status and retry. Unsupported-but-safe reference items must not receive a false successful parse state.

### ZIP safety and semantics

- Extract archive members as separate evidence items; do not submit the ZIP itself as a single document to the LLM.
- Enforce configured limits for compressed size, expanded bytes, member count, and supported file types before extraction/processing.
- Reject or safely report traversal paths, absolute paths, symlinks, encrypted archives, corrupt archives, nested archives, and expansion-limit violations. Never write outside the project-controlled staging area.
- Preserve archive filename and parent-submission provenance; sanitize storage paths. Detect duplicate candidates and warn rather than silently discard evidence.
- Report per-member accepted/rejected reasons and let safe members continue when a sibling is rejected.

### Parsing and AI understanding

- Initial supported analysis formats: text PDF, scanned PDF via OCR, DOCX, XLSX, PPTX, CSV, TXT, and common image evidence via OCR. If a format cannot be processed in the current environment, retain a safe reference when allowed and show **Needs Review** with the reason; do not label it Ready.
- Preserve useful source boundaries: PDF page, spreadsheet sheet/row or range, document heading/paragraph, slide number, and image/page as available.
- Replace paragraph-only 1,400-character splitting with structure-aware bounded chunks and suitable overlap where it improves retrieval; every chunk keeps stable document and location metadata. Avoid splitting spreadsheet rows or losing headings. Test chunk boundaries on tables, long paragraphs, and mixed sections.
- Run structured extraction over all document chunks in bounded requests sized to the configured model context; a short document may fit one request, while a long document requires multiple requests with bounded concurrency. Never silently truncate at a fixed character limit.
- Bound total concurrent document/chunk requests to configured worker/provider capacity; persist successful chunk-group outputs idempotently so retries do not duplicate facts.
- Reuse per-file outputs for classification and organization; do not send one whole ZIP/batch prompt or add a classification-only request. Aggregate validated facts deterministically; add a bounded synthesis request only if evaluation shows deterministic aggregation cannot meet summary quality.
- Keep n8n as queue/orchestration; application workers make data-dependent model calls within per-document jobs. No new n8n LLM node or batch-wide model request.
- Validate output against a versioned schema and verify all returned source references belong to that file. Invalid, missing, or unsupported model output becomes a finite retry followed by Needs Review/Failed, not fabricated success.
- The LLM may classify, summarize, and extract; application rules select/aggregate evidence and calculate project condition. User corrections take precedence over model suggestions.
- Use the existing free/local provider seam where viable. The product promise is graceful, source-grounded behavior with a free model—not guaranteed identical accuracy across free providers. Persist provider/model/schema and extraction warnings for support and evaluation.

### Retrieval and Advisor context

- Start with project/review-scoped PostgreSQL full-text ranking over verified document chunks, filtered by confirmed evidence and reporting period. Keep an exact source ID and location with each result.
- Use retrieved sources plus deterministic findings/actions and a bounded number of prior conversation turns as model context. Prior chat text is context only, never a source of project facts.
- Persist or otherwise reliably reload conversation turns under an explicit project and conversation scope; do not mix another project/user's history.
- Validate every displayed citation against the retrieved source IDs and excerpt; remove unsupported citations and mark uncited project-specific claims as inference or omit them.
- If search returns no relevant evidence, answer that the project record does not support the answer and identify the missing evidence. Do not substitute generic guidance for a project fact.
- Evaluate lexical retrieval before adding embeddings/vector search. Keep any future vector path behind demonstrated retrieval need and a separate decision.

## Reliability, security, and trust requirements

- Every upload, archive member, parse job, model result, review, and Advisor retrieval remains scoped to a project the user can access; re-check authorization server-side.
- Validate file signature/content where applicable; do not trust extension or client MIME alone. Avoid archive path traversal, decompression bombs, cross-project writes, or secrets in user-facing errors.
- Transient failures get bounded retries; permanent parse/provider/schema failures get an understandable reason and an item-level recovery path.
- No assessment is complete while a required operation is still active or failed. Partial batch success remains visible and does not create a misleading all-ready banner.
- Maintain source provenance through any chunking, classification, reviewer correction, retrieval, summary, and assessment step.
- Accessibility: keyboard-operable upload, visible focus, screen-reader status announcements, and errors adjacent to the affected file.

## Acceptance and success measures

The iteration is accepted only when all of these are demonstrated in XAss-Development:

1. A user can upload a mixed batch without assigning types first; each accepted file has an independent status and retry action.
2. A ZIP with valid supported members produces one evidence record/job per processable member, while unsafe/unsupported members receive explicit reasons and do not block safe siblings.
3. A single-file user can select an optional type hint or let the system suggest one; neither path silently assigns a definitive review role.
4. A `>10 MB` supported file within the documented limit reaches a terminal successful state, and an over-limit file reaches a prompt, actionable error state.
5. PDFs (including scanned), DOCX, XLSX, PPTX, CSV/TXT, and image fixtures preserve relevant source location or show an honest unsupported/review state.
6. Low-confidence, invalid-schema, provider-timeout, and unreadable-file cases never render as successfully analyzed. A human correction is retained and used over the suggestion.
7. Review evidence is grouped by role and remains filterable by type, period, and workstream; assessment cannot silently claim On Track with missing required evidence.
8. Advisor evaluation covers exact terms, paraphrases, follow-up questions, no-match questions, conflicting evidence, and project isolation. Every displayed factual citation resolves to a retrieved source; unsupported project claims are absent or explicitly labeled as inference.
9. A first-time project user can complete both intake paths and identify what needs review without reading implementation terminology.

Before implementation release, create a permitted evaluation set representing the listed artifact types, including difficult spreadsheet/table and long-document cases. The SMART BUILDING files are not evaluation data until the owner authorizes content use. Measure classification corrections, parse failures, retrieval misses, citation validity, and upload completion; agree numerical release thresholds after the first baseline run rather than inventing an accuracy claim now.

## Implementation sequence

1. **Define evidence data contract and upload limits** (ticket P6-01).
2. **Stabilize large-file transfer and item-level batch status** (P6-02, P6-03).
3. **Add safe ZIP expansion and real-format extraction/chunking** (P6-04, P6-05).
4. **Unify structured AI suggestions, validation, and human correction** (P6-06).
5. **Build role-first Evidence review and category filters** (P6-07).
6. **Improve Advisor retrieval, multi-turn context, and citations** (P6-08).
7. **Run the development evaluation/release gate** (P6-09).

See [Phase 6 implementation tickets](phase-6-tickets.md) for owners' work units, dependencies, and executable acceptance criteria.

## Planning references

- Phase 3 evidence roles, type list, processing states, provenance, and source UI: `phase-3-usable-mvp-spec.md:194-259,445-495,764-829`.
- Approved Phase 5 bulk-first direction and exclusions: `phase-5-ux-redesign-brief.md:11-43,81-137`.
- Phase 5 usability coverage and known limits (including page-triggered assessment and presentation/image limitation): `phase-5-usability-test-report.md:34-80`.
- Multi-file request, default type, and per-file job creation: `../../src/app/api/projects/[projectId]/documents/upload/route.ts:27-33,205-210`.
- Supported versus processable formats: `../../src/features/documents/lib/file-types.ts:1-34`.
- Current text extraction, 1,400-character paragraph chunks, missing scanned-PDF OCR, and extraction input cap: `../../worker/src/services/document-parser.ts:36-59,97-116,357-388`; `../../worker/src/jobs/process-document.ts:14-42,114-137`.
- Current review organization prompt limits: `../../src/features/assurance/actions/assurance-actions.ts:864-883`.
- Current Advisor review selection, keyword retrieval, source confidence, and persisted interactions: `../../src/features/assistant/actions/assistant-actions.ts:37-103,136-160,163-203`; in-memory UI state: `../../src/features/assistant/components/assistant-chat.tsx:36-45,90-103`.
- Phase 5 runtime report confirms a multi-file development path through Supabase, n8n, and the worker: `phase-5-usability-test-report.md:40-45`.
