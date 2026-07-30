---
title: X-Assurance Phase 4.1 Document Pipeline Audit
status: complete
created: 2026-07-21
updated: 2026-07-21
scope: development environment only
---

# X-Assurance Phase 4.1 Document Pipeline Audit

## 1. Audit Objective

Trace the current development document-processing path from browser upload to stored outputs, identify confirmed reliability and trust failures, and define the smallest safe repair order for Phase 4.2.

This audit was read-only with respect to application code, the development database, n8n state, and production. It inspected source, service status, sanitized n8n execution metadata, and aggregate development-database metadata. No document contents, credentials, or secret values were read into the report.

## 2. Audited Runtime

- Worktree: `XAss-Development`
- Branch: `improve/frontend-and-performance`
- Base commit: `0e5a34c648743db41b4c63387e55f7d61a98817d`
- Next.js development server: listening on port 3000
- n8n: `aisx-n8n`, listening on port 5678
- n8n PostgreSQL: `aisx-n8n-postgres`
- Active workflow: `X-Assurance - Supabase Document Polling`
- Production: not accessed or changed

Existing Phase 3 planning changes and user-created Supabase CLI files were preserved.

## 3. Current Pipeline

```text
Browser upload form
  -> Next.js upload API
  -> Supabase Storage
  -> documents row
  -> ai_jobs row: queued
  -> n8n polls every 15 seconds
  -> n8n PATCH claims job: processing
  -> n8n marks document: processing
  -> n8n calls Next.js parse-document worker
  -> worker downloads and parses the file
  -> worker attempts an LLM extraction
  -> worker returns chunks, facts, summary, health, alerts, actions, anomalies
  -> n8n performs a long sequence of Supabase writes
  -> n8n marks extraction run, job, and document completed
  -> user sees new state only after the page is refreshed
```

This is not a transaction. The system changes authoritative state before work succeeds, then writes result tables one by one.

## 4. Runtime Evidence

### 4.1 n8n execution history

At audit time, n8n stored:

- 712 successful scheduled executions;
- 19 failed scheduled executions;
- 14 failures at `Fetch Oldest Queued Job` with `EAI_AGAIN` DNS errors;
- 4 failures at `Fetch Oldest Queued Job` with `ECONNRESET`; and
- 1 failure at `Call Document Worker` with `ECONNREFUSED`.

A scheduled execution marked `success` does not mean a document was processed. A poll that finds no queued job exits successfully.

### 4.2 Confirmed stranded job

The single `Call Document Worker` failure occurred after n8n claimed a queued job. The worker connection was refused because the Next.js worker was unavailable.

Development Supabase then contained:

- 5 completed AI jobs;
- 1 AI job still marked `processing`;
- 5 completed documents;
- 1 document still marked `processing`;
- 0 jobs with a stored `error_code`; and
- 1 processing job older than 30 minutes.

The stuck job was claimed at the same time as the recorded `ECONNREFUSED` execution. It had no extraction run and remained processing for approximately 28 hours because later polls only search for `queued` jobs.

This is a confirmed root cause of the previously observed stuck-document behavior.

### 4.3 Duplicate extraction-run history

Aggregate development data contained:

- 6 AI jobs;
- 6 documents;
- 7 extraction runs;
- 7 document chunks;
- 17 extracted facts; and
- 5 generated document summaries.

The five completed documents had the following relationships:

- two 2-chunk documents each created 2 extraction runs;
- three 1-chunk documents each created 1 extraction run.

For each duplicated pair, only one extraction run received facts. The other run remained an empty completed audit record.

The n8n chain allows the chunk-upsert response to fan out into `Create Extraction Run`, so a multi-item response can create more than one run for one job.

### 4.4 Model provenance is discarded

All five stored summaries reported `generated_by: n8n_document_worker`. The worker calculates provider/model metadata, but the workflow does not preserve that metadata on the stored summary or extraction run.

Therefore the database cannot reliably prove whether a stored output came from Ollama Cloud, a local model, or fallback rules. This explains why model usage and stored output were difficult to reconcile.

## 5. Confirmed Findings

### P0-1: Claimed jobs have no failure or recovery path

**Evidence**

- `Claim Job` changes the job to `processing` before document retrieval, worker invocation, and all result writes.
- Every subsequent node is part of one linear success chain.
- No n8n node has a configured failure branch, retry policy, or compensating job/document update.
- Polling selects only `status=queued`.
- No stale-job, heartbeat, lease, attempt-count, or timeout recovery implementation exists.

**Impact**

Any worker, network, Supabase, or result-write failure after claim can leave the job and document processing forever.

### P0-2: Parser failures are deliberately returned as success

**Evidence**

`src/app/api/workers/parse-document/route.ts` receives a real `failed` result and returns HTTP success containing synthetic:

- a `Processing warning` chunk;
- a manual-review fact;
- a low-confidence summary;
- an insufficient-evidence health snapshot;
- an alert;
- a recommended action; and
- a governance anomaly.

n8n cannot distinguish this from successful extraction and completes the job and document.

**Impact**

Unreadable or unsupported evidence can be displayed as successfully processed, contaminate downstream findings, and enter reports.

### P0-3: LLM failures are swallowed and replaced with prototype output

**Evidence**

- All worker LLM providers return `null` on missing configuration, non-2xx response, invalid JSON, or caught exception.
- Fetch calls have no explicit timeout or abort signal.
- `processDocumentJob` replaces missing LLM facts, summary, health, alerts, and actions with keyword-based prototype builders.
- The job is returned as `completed`.

**Impact**

The product can show plausible output and completed status when the configured model never produced a valid result.

### P0-4: Health logic is intentionally optimistic and not comparative

**Evidence**

- The LLM prompt instructs the model to prefer low-confidence Green when evidence is thin.
- Prototype status inference returns Green when text exists but no matching domain evidence exists.
- Prototype scores are fixed at 88, 68, or 42 based on keyword status.
- The dashboard normalizes Green to at least 80, Amber to 50-79, and Red below 50.
- No approved-baseline/current-period relationship exists.

**Impact**

The current 80%/Green-style output is not a defensible project-health calculation and can contradict missing evidence.

### P0-5: There is no Assurance Review boundary

**Evidence**

- Documents, chunks, facts, summaries, findings, actions, assistant interactions, and reports are project-scoped but not review-scoped.
- The system cannot formally bind approved baseline evidence to current-period evidence.
- The report `reportingPeriod` is a label; report evidence queries are not filtered by that period.
- AI Assistant retrieval is project-wide and not bound to a review period.

**Impact**

Old and current evidence can be mixed, and the system cannot make a trustworthy baseline-versus-current statement.

### P1-1: n8n result persistence is non-transactional and item-sensitive

**Evidence**

- n8n writes chunks, extraction runs, facts, evidence links, summaries, health, alerts, actions, and anomalies through separate HTTP nodes.
- A failure can leave partial data.
- Chunk responses fan out and create duplicate extraction runs.
- Facts, summaries, alerts, actions, and anomalies have no complete idempotency contract.
- Completion updates occur separately for extraction runs, AI jobs, and documents.

**Impact**

Retries can duplicate data; partial success can create contradictory records; completion states can disagree.

### P1-2: Upload behavior is duplicated and non-atomic

**Evidence**

- Upload logic exists in both a server action and an API route.
- The current client form calls the API route.
- Storage upload, document insert, job insert, and document queued update are separate operations.
- Failure of the final document-status update is ignored.

**Impact**

The two implementations can drift, and storage/document/job state can become inconsistent.

### P1-3: The frontend does not observe background progress

**Evidence**

- The upload form calls `router.refresh()` only immediately after upload.
- No document status polling, Supabase subscription, or scheduled refresh exists.
- n8n cannot trigger Next.js route revalidation in the running browser.

**Impact**

The UI remains Queued even after processing completes until the user refreshes or navigates away and back.

### P1-4: Manual Summary has silent no-op and fallback paths

**Evidence**

- Submitting without selected document IDs returns without user feedback.
- Non-completed selected documents create a stored guardrail summary instead of a normal validation message.
- Model failure creates and stores a concatenated-chunk fallback summary.
- The action has no visible pending, failure, or provider-status contract.
- n8n also creates summaries automatically, so two independent summary paths exist.

**Impact**

The button can appear to do nothing, while other actions can create a summary unexpectedly.

### P1-5: Dashboard refresh creates additional heuristic truth

**Evidence**

- The dashboard has a separate manual refresh action.
- It infers status using keywords, evidence counts, anomaly penalties, and prior snapshots.
- Any processed evidence can produce an Amber-like numeric result without domain-complete evidence.
- It creates additional alerts and actions from already generated anomalies.

**Impact**

Document processing, manual dashboard refresh, and the LLM can each generate competing health results and duplicate actions.

### P1-6: Report and Advisor outputs are not review-period safe

**Evidence**

- Reports query the latest project-wide snapshots, anomalies, actions, facts, and summaries without binding them to the entered reporting period.
- Report model failure silently uses fallback sections and still stores `draft_ai_generated`.
- AI Advisor uses simple keyword `ilike` retrieval over a few project-wide chunks/facts.
- Advisor model failure returns a concatenated-evidence fallback answer.
- There is no separate approved methodology knowledge base.

**Impact**

Outputs can mix periods and can look AI-generated even when the model failed.

### P1-7: Existing integration tests do not test integration

**Evidence**

The current 23 tests read source and migration files and assert that expected strings exist. They do not:

- call the running application;
- exercise Supabase writes or RLS;
- invoke n8n or the worker;
- simulate provider failure;
- use a browser; or
- verify PDF/DOCX output behavior.

**Impact**

All tests can pass while the product has stuck jobs, false success, dead-looking buttons, and mixed-period outputs.

### P2-1: Observability is insufficient

**Evidence**

- Worker/provider failures are swallowed.
- Job failures are not stored.
- No stable attempt ID, duration, provider result, model, or rule version is preserved end to end.
- A scheduled no-work poll and a completed document-processing run both appear as successful n8n executions.

**Impact**

Operators cannot quickly distinguish no work, model fallback, partial persistence, real completion, or failure.

## 6. Architecture Decision for Repair

n8n should remain orchestration, not the owner of business truth or a long multi-table persistence script.

The target Phase 4 pipeline is:

```text
Upload API
  -> create document and queued job
  -> n8n calls atomic claim operation
  -> worker parses and analyzes with explicit timeout/error contract
  -> application/database validates structured result
  -> atomic completion operation stores one run and review-scoped outputs
  -> job/document become completed

On any failure:
  -> atomic failure operation stores code/message/attempt
  -> job/document become failed
  -> user can retry
```

The completion operation must be idempotent by job/run ID. Repeated delivery must not create duplicate facts, findings, summaries, actions, or extraction runs.

## 7. Minimal Phase 4.2 Repair Order

### Gate 1: Job truth

1. Add job attempt, claimed/started/completed timestamps, lease/heartbeat or stale threshold, and retry metadata.
2. Add atomic claim, complete, and fail operations.
3. Add an n8n error path that always calls fail after a successful claim.
4. Add safe retry and stale-processing recovery.
5. Stop returning parser failure as HTTP success.
6. Add explicit worker and LLM timeouts.

**Gate passes when:** stopping the Next.js worker produces a visible Failed job/document, then Retry completes it without duplicate data.

### Gate 2: Review scope

1. Add Assurance Review and review-evidence relationships.
2. Add Approved Baseline, Current Period, and Supporting Evidence roles.
3. Bind all new analysis output to review ID and reporting period.
4. Prevent cross-period evidence from entering a comparison by default.

**Gate passes when:** one review can name exactly which baseline and current documents it uses.

### Gate 3: Honest structured analysis

1. Remove prototype health, alert, action, and anomaly output from the success path.
2. Preserve provider, model, prompt/schema version, parser, rule version, and warnings.
3. Extract only the Phase 3 Budget, Schedule, and Risk fields.
4. Validate model JSON against a strict schema.
5. Calculate budget variance and schedule slippage in versioned application logic.
6. Generate Findings only from traceable baseline/current facts or explicitly label current-only observations.

**Gate passes when:** every displayed condition is reproducible from stored cited values and no model call means no model-generated success.

### Gate 4: Observable browser behavior

1. Add job-status polling or a project-scoped realtime subscription.
2. Show clear Queued, Analyzing, Ready, Failed, and Retry states.
3. Remove silent Summary no-op behavior.
4. Use one summary path inside Assurance Review.

**Gate passes when:** the browser updates from Queued to Ready or Failed without manual refresh.

### Gate 5: Runtime verification

Add real tests for:

- successful processing;
- worker unavailable;
- Supabase/network failure;
- LLM timeout/non-2xx/invalid JSON;
- unreadable or unsupported evidence;
- stale job recovery;
- duplicate delivery/idempotency;
- baseline/current scoping;
- deterministic Budget, Schedule, and Risk comparisons; and
- cross-project authorization.

**Gate passes when:** a real browser/API/worker path proves both success and recoverable failure.

## 8. Phase 4.1 Conclusion

The production-like feature problems are not primarily caused by one incorrect key or one broken button. They come from a pipeline that optimizes for always showing a demo result instead of preserving processing truth.

Phase 4.2 must begin with job lifecycle and failure semantics. UI redesign, report polish, and RAG work must not be built on the current false-success pipeline.

No production change is recommended until all five repair gates pass in development.
