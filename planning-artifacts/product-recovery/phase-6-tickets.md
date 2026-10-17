# Phase 6 — Implementation Tickets

These tickets implement [Phase 6 Evidence Intake and Grounded Advisor PRD](phase-6-evidence-intake-and-grounded-advisor-prd.md). Work in XAss-Development only. Do not deploy to production under these tickets.

## Dependency order

```text
P6-01 ─┬─> P6-02 ─> P6-03 ─> P6-04 ─┐
       └─> P6-05 ───────────┬───────┤
                            v       v
                          P6-06 ─> P6-07
                              └───> P6-08
                                     |
P6-01..P6-08 ───────────────────────> P6-09
```

P6-02 and P6-05 can proceed in parallel after P6-01. P6-04 depends on the batch model and supported-format matrix. P6-08 can start after the source contract is stable, but final acceptance waits for P6-06. P6-09 is the release gate for the full scope.

---

## P6-01 — Define the evidence taxonomy and metadata contract

**Priority:** P0  
**Depends on:** None

### Goal

Represent a document's artifact type separately from its role in a reporting-period review, while preserving user hints and corrections.

### Scope

- Define allowed document types and user-facing labels using the PRD's initial artifact groups.
- Keep `Approved Baseline`, `Current Period`, and `Supporting Evidence` as review roles; do not derive a definitive role from file name/type alone.
- Define optional document date, reporting period, workstream, AI suggestion confidence/reason, reviewer confirmation/override, and source/provenance fields.
- Define `Other / Not sure` behavior and migration compatibility for existing document types.

### Acceptance criteria

- Given an uploaded item without a type hint, when it is stored, then it remains unknown/suggestion-pending rather than silently becoming `progress_report`.
- Given an AI or user type suggestion and a review role, when they are saved, then each is stored independently and a user correction takes precedence in later organization/assessment.
- Given a file with a familiar name such as “proposal” or “meeting minutes,” when no review context or approval is known, then the system does not assign Approved Baseline solely from that name.
- Given legacy types in existing records, when the new taxonomy is deployed to development, then existing records remain readable and map to a user-visible value or `Other` without losing their stored values.

### Verification

Exercise create/read/update flows for unknown type, AI suggestion, user override, date/period, and role; verify review/project isolation and legacy records in the development database.

---

## P6-02 — Make large file upload finish or fail visibly

**Priority:** P0  
**Depends on:** P6-01

### Goal

Remove indefinite loading for large files and keep upload transport independent from the application-server multipart body limit.

### Scope

- Reproduce the greater-than-10-MB user scenario in XAss-Development and inspect browser/network and storage responses; do not assume the database is the cause.
- Transfer file bytes through an authorized direct-to-Storage upload path; use resumable transfer if supported and needed by the observed failure mode.
- Show per-file progress, completion, cancellation/retry where safe, and explicit configured size/type errors.
- Keep authorization and final document/job creation server-validated; do not expose service-role credentials.

### Acceptance criteria

- Given a supported file larger than 10 MB but within the configured service limit, when the user uploads it in development, then it reaches a terminal uploaded/queued state and can be processed.
- Given a file above the configured size limit or a storage/network error, when upload fails, then the affected file promptly shows a plain-language reason and retry/replace action; no indefinite spinner remains.
- Given a failed upload, when the user retries, then duplicate document/job records are not created for a completed prior upload.
- Given one file in a multi-file submission fails, when its sibling succeeds, then the successful file remains available and the failed item remains independently recoverable.

### Verification

Run a browser upload smoke with one supported >10-MB fixture, a configured over-limit fixture, and an interrupted/retried upload. Inspect visible status plus Storage/document/job state in development.

---

## P6-03 — Add durable multi-file and optional single-file intake flows

**Priority:** P0  
**Depends on:** P6-01, P6-02

### Goal

Support both unclassified batch intake and a guided single file with an optional type hint, with status that survives navigation.

### Scope

- Keep multi-file selection and add a clear single-file path with an optional document-type dropdown and “Not sure — suggest automatically.”
- Create or persist a submission/batch identifier linking the selected files, upload results, and subsequent per-file processing states.
- Maintain one evidence record and one parse job per processable file; represent unsupported-but-safe reference files with an honest review state.
- Show per-file upload/processing progress, partial success, and item-level retry/replace. Do not require the Evidence page to remain open to finish batch follow-up work.

### Acceptance criteria

- Given a user selects multiple files, when they submit, then no category is required before upload and each accepted file has its own document ID, job/status, and common submission ID.
- Given a user selects one file and a type hint, when it is submitted, then the hint is stored as user-provided metadata and is not displayed as an AI-confirmed classification.
- Given a user selects one file without a hint, when it is submitted, then the system proceeds and later shows its suggestion or `Needs Review` state.
- Given a user navigates away during analysis and returns, when the submission is reopened, then per-file and batch states reflect persisted server-side state without re-uploading.
- Given all file jobs finish while the user is away, when batch follow-up work completes, then its server-side state is updated without requiring the Evidence page to trigger it; unresolved prerequisites remain explicitly pending or Needs Review.
- Given only some items in a batch fail, when the batch view is rendered, then successful, active, and failed items remain distinguishable and the batch is not labeled fully ready.

### Verification

Complete browser scenarios for unclassified multi-file intake, single-file with a hint, single-file without a hint, page navigation during processing, and a mixed partial-failure batch.

---

## P6-04 — Safely expand ZIP submissions into evidence items

**Priority:** P0  
**Depends on:** P6-03, P6-05

### Goal

Treat a ZIP as a package of independently reviewed files, not as one opaque document or one batch-wide LLM prompt.

### Scope

- Inspect and validate archive members before storage/extraction; show an understandable manifest and rejection reasons.
- Apply configured compressed-size, expanded-size, member-count, and supported-format limits.
- Reject or safely report traversal/absolute paths, symlinks, encrypted/corrupt archives, nested archives, and expansion-limit violations. Sanitize member names/paths.
- Create one child evidence item and (when processable) one parse job per safe member; retain parent submission/archive provenance.
- Detect duplicate file candidates and warn rather than silently dropping them; continue processing safe siblings when one member is rejected.

### Acceptance criteria

- Given a ZIP with supported safe members, when imported, then each member becomes a separate evidence item with its own status and a common parent submission ID.
- Given a ZIP containing an unsupported file, when imported, then the supported siblings proceed and the unsupported member displays its reason without being marked analyzed.
- Given a ZIP containing traversal paths, a symlink, encryption, corruption, a nested archive, or a configured expansion-limit violation, when imported, then no file is written outside the controlled staging/storage path and the relevant member/package is rejected visibly.
- Given two same-name or duplicate-content members, when imported, then the user sees a duplicate warning and the system does not silently discard either item.
- Given an archive-level or member-level failure, when safe siblings complete, then their data remains available and retrying a failed member does not duplicate completed siblings.

### Verification

Run development archive scenarios for normal multi-file ZIP, unsupported member, duplicate name/content, corrupt/encrypted ZIP, traversal path, nested ZIP, and expansion limit. Verify no archive member escapes the project storage namespace.

---

## P6-05 — Complete common-format extraction and source-aware chunking

**Priority:** P0  
**Depends on:** P6-01

### Goal

Extract text and stable source locations from the formats used in project delivery, and preserve context across chunk boundaries.

### Scope

- Support text PDF, scanned PDF and common image evidence through a free/local OCR path; DOCX; XLSX; PPTX; CSV; and TXT.
- Preserve page, sheet/row or range, section/heading, slide, or image/page location when available.
- Replace paragraph-only fixed 1,400-character splitting with structure-aware bounded chunks and appropriate overlap; preserve headings and table-row context.
- Detect empty, encrypted, malformed, OCR-failed, and unsupported files and return actionable errors rather than success.
- Record parser/version and warnings with extraction output.

### Acceptance criteria

- Given digital PDF, DOCX, XLSX, PPTX, CSV, and TXT fixtures, when parsed, then extracted text retains its relevant page/sheet/slide/section location.
- Given a scanned PDF or image fixture, when processed with the configured local OCR path, then OCR text is source-linked; when OCR cannot run or yields no usable text, then the item is `Needs Review`/`Failed` with an actionable reason, not Ready.
- Given a long paragraph, a table spanning rows, or a heading followed by a table, when chunked, then a consumer can retrieve the section context and boundary content without duplicated/missing row text.
- Given a parser error or unsupported format, when the job ends, then no success summary or successful assessment output is created from synthetic placeholder data.

### Verification

Run parser smoke cases for each required format, scanned PDF/image, empty and malformed inputs, and chunk boundaries across long text/tables. Verify source location fields in stored chunks.

---

## P6-06 — Validate per-file AI suggestions and preserve reviewer corrections

**Priority:** P0  
**Depends on:** P6-01, P6-05

### Goal

Make a free/local model useful without allowing weak, invalid, or unsupported output to appear as verified project evidence.

### Scope

- Run structured extraction over all per-document chunks in bounded requests sized to the configured model context; use bounded concurrency. Short documents may fit one request; long documents use multiple chunk-group requests with deterministic aggregation. Never truncate a document at a fixed character limit.
- Bound total in-flight file/chunk requests to existing worker/provider capacity; persist chunk-group outputs idempotently and retry failed groups without duplicating successful facts.
- Reuse per-file outputs for classification/organization instead of adding a classification-only request. Do not send one whole ZIP/batch prompt; use another bounded synthesis request only if evaluation shows the deterministic aggregate is insufficient. n8n remains queue/orchestration; the worker makes data-dependent model calls in each document job.
- Validate schema, allowed enum values, confidence/review triggers, and source chunk IDs against stored extraction results.
- Preserve provider/model/prompt-schema version and warning; support free/local provider failure with bounded retry and explicit terminal state.
- Store reviewer-confirmed/corrected metadata and ensure it overrides later AI suggestions.

### Acceptance criteria

- Given a supported parsed document and a valid model response, when processing completes, then type/date/period are suggestions with a concise source-grounded summary and facts linked to valid source locations.
- Given invalid JSON, an invalid enum, an unknown source ID, missing required fields, provider timeout, or provider outage, when processing ends, then the item is never marked Ready with fabricated model output; it reaches the documented retry/Needs Review/Failed state.
- Given low-confidence or conflicting evidence, when classification completes, then the item is routed to `Needs Review` rather than receiving a definitive role silently.
- Given a reviewer correction, when later organization or assessment runs, then the confirmed value is used and the original suggestion remains auditable.
- Given one chunk-group request fails after bounded retries, when document processing is retried, then successful group outputs are reused without duplicate facts and the document remains Needs Review/Failed until required groups complete.
- Given a batch with N processable files, when document processing runs, then it creates N independent parse jobs, processes all chunks through one or more bounded model requests per document, and never exceeds configured worker/provider concurrency; no request contains batch-wide concatenated text or silently drops later sections.

### Verification

Exercise valid response, schema failure, unknown citation, low confidence, conflicting baseline/current hints, timeout/provider outage, and reviewer correction using deterministic model responses plus one free/local provider smoke in development.

---

## P6-07 — Rework Evidence library around review roles and artifact types

**Priority:** P0  
**Depends on:** P6-03, P6-06

### Goal

Make the evidence set understandable both as a project archive and as the evidence for a reporting-period review.

### Scope

- Use Approved Baseline, Current Period, and Supporting Evidence as the primary groups inside a review.
- Add type, reporting-period, workstream, and processing-state filters; keep project-archive browsing separate from review-role assignment.
- Present type/role as suggested versus confirmed; surface only uncertain/conflicting work for correction, but make the correction action discoverable.
- Show summary, detected metadata, and source details without exposing raw chunks by default.
- Show explicit missing evidence, processing failures, and actions to retry, replace, or correct.

### Acceptance criteria

- Given a project with mixed plan, progress, procurement, meeting, and technical-reference files, when Evidence is opened, then a user can filter/group by useful artifact types without assigning all files to a PMBOK knowledge area.
- Given an active review, when evidence is displayed, then documents are grouped by role and can be filtered by type, period, workstream, and processing state.
- Given an unconfirmed or conflicting suggestion, when the card is rendered, then it is labeled as a suggestion and offers correction; confirmed user values are visibly distinguished.
- Given required baseline/current evidence is missing or a required file has failed, when review readiness is displayed, then the missing/failed requirement and next action are explicit and the review cannot appear complete or On Track.
- Given a source detail is opened, when the user follows a citation, then the referenced page/sheet/section excerpt is displayed for the correct document.

### Verification

Run browser checks at desktop and mobile widths with empty, mixed-ready, uncertain, failed, and missing-evidence project states; verify keyboard and screen-reader status behavior.

---

## P6-08 — Ground AI Advisor retrieval, conversation context, and citations

**Priority:** P0  
**Depends on:** P6-01, P6-05, P6-06

### Goal

Make the Advisor answer follow-up questions using relevant authorized evidence and verifiable citations.

### Scope

- Replace unsorted keyword `ILIKE` retrieval with project/review-scoped PostgreSQL full-text ranking and filters for confirmed role/period where applicable.
- Preserve source ID, document, location, excerpt, and retrieval provenance; remove fixed confidence values that are not computed.
- Add an explicit conversation scope, load prior turns for that conversation, and include a bounded number of turns in the prompt. Prior turns are context, not evidence.
- Retrieve fresh evidence for each question; validate each displayed citation against retrieved source IDs and excerpts.
- Keep general method guidance separate from project claims. Do not add vector search or PMBOK RAG in this ticket.

### Acceptance criteria

- Given a question with exact terms or paraphrased wording, when relevant evidence exists in the authorized review, then ranked evidence is supplied and the answer cites the actual source/location.
- Given a follow-up such as “why?” or “what changed?”, when earlier turns exist, then the Advisor uses the prior question/answer for conversational reference but bases project facts on freshly retrieved evidence.
- Given no relevant source, conflicting records, or missing values, when asked a project-specific question, then the answer says what is unsupported or conflicting and does not invent a result.
- Given a forged or stale model citation, when the answer is validated, then the citation is removed/rejected and the claim is omitted or explicitly labeled as inference.
- Given two projects/users or two conversation IDs, when conversation context and retrieval are loaded, then no history or source from another scope is included.
- Given a model answer, when source cards render, then there is no fabricated confidence score such as a constant 0.78.

### Verification

Evaluate exact and paraphrased queries, follow-up questions, no-match, conflicting evidence, missing data, invalid citations, and cross-project isolation in the development browser/API path. Compare full-text ranking against a small human-labeled query set before considering embeddings.

---

## P6-09 — Build the end-to-end evaluation and development release gate

**Priority:** P0  
**Depends on:** P6-01 through P6-08

### Goal

Prove the new workflow with representative artifacts and failure cases before any separate production decision.

### Scope

- Create a permitted, versioned evaluation set spanning the PRD's common artifact types and difficult extraction/retrieval cases. Do not use `SMART BUILDING/` contents until authorized; filenames/extensions alone were inspected during planning.
- Run upload, archive safety, parser/OCR, LLM schema/provider, batch recovery, evidence-role, source citation, Advisor, and access-isolation checks in development.
- Record baseline and agreed release targets for file completion, manual correction rate, citation validity, retrieval misses, and user comprehension; do not invent unmeasured accuracy claims.
- Conduct one first-time-user usability session covering both intake paths and the Evidence review.
- Document deployment, migration, backup, smoke-test, and rollback steps for a later separately approved release; this ticket does not deploy production.

### Acceptance criteria

- Given the evaluation set, when all supported file and query cases run, then results include pass/fail evidence for parsing, source locations, model schema, classifications, citations, and project isolation.
- Given a simulated worker/model/storage failure, when the end-to-end workflow runs, then affected files show actionable recovery and unaffected siblings remain usable.
- Given any required failure or missing evidence, when the final assessment/report state is shown, then it cannot claim completion or On Track.
- Given a first-time user, when they complete bulk import and a guided single-file submission, then they can identify each file's state and correct a suggestion without internal pipeline terminology.
- Given production remains untouched, when this ticket closes, then development verification and a separate release/rollback plan exist; no production service or data has been changed.

### Verification

Run the complete browser-based development journey, API authorization/project-isolation checks, worker/provider failure scenarios, and usability session; attach observed results and list any release-blocking gap.
