# Document Processing Workflow Boundary

Story 2.3 establishes the workflow contract. Supabase remains the state source.

1. The 60-second workflow calls `claim_next_available_document_job`, which atomically claims at most one queued job per poll, synchronizes document/job state, and caps active parse jobs at two. `recover_and_fetch_document_job` retains its legacy queued-candidate contract for the currently deployed workflow.
2. The Next.js worker downloads the stored document, parses it, and runs extraction with the configured `ollama_cloud` + `gpt-oss:20b` model.
3. The worker persists document chunks and extraction-group checkpoints using idempotent conflict keys, with at most three attempts for transient/network failures. Retryable worker or checkpoint failures atomically return the job and document to queued with a bounded backoff and cleared lease; expired leases remain the crash-recovery fallback.
4. Validated facts and citations are persisted without dropping invalid rows silently. Partial extraction is recorded as `needs_review` with explicit warnings.
5. Multi-document summaries process every selected source chunk in bounded same-model batches and hierarchical synthesis; citations still point to exact original chunks, and incomplete selected-document or citation coverage remains an explicit warning.
6. Terminal worker failures use one atomic Supabase transition for the extraction run, document, and job, clearing the claim and lease.

Supabase remains the source of truth. n8n does not retry worker HTTP failures directly after the backend may have requeued the job. The chunk node reads the worker-persisted rows; transient database write retries happen at the worker boundary.

## Operator troubleshooting

- **Deploy the polling workflow:** editing `x-assurance-supabase-document-polling.json` does not change live n8n. Apply the database migrations, deploy/restart the Next.js worker that persists chunks, then import and activate the updated workflow that calls `claim_next_available_document_job` and reads those persisted chunks. Preserve the existing single consumer. The old workflow remains compatible during this sequence because it upserts chunks idempotently. Keep the legacy `recover_and_fetch_document_job` RPC until live cutover is confirmed. Confirm the success chain is `Complete Extraction Run -> Mark Document Complete -> Complete Job`.
- **Compare job and document state:** `ai_jobs.status`, `error_code`, `attempt_count`, and `lease_expires_at` describe queue/worker progress; `documents.processing_status` and `processing_error` describe the document's processing state. A processing job with an expired lease is stale/recovery work; a failed job with an error code is terminal. A completed job with a document still marked `processing` indicates inconsistent finalization—check the n8n execution and document-status update. Compare timestamps and lease state; neither status alone proves the other.
- **Find review warnings:** check `documents.processing_status` and `processing_error` for document-level `needs_review` reasons. Multi-document summary coverage and quality warnings are in `document_summaries.quality_warning` and `document_summaries.metadata.document_coverage` (also shown with the summary).
- **Provider and spreadsheets:** this deployment uses `ollama_cloud` with `gpt-oss:20b`; provider/model failures do not fall back to another model. Excel formulas are not recalculated during parsing: the parser uses cached values when present and preserves formula information, so recalculate and save the workbook in Excel before processing if formula results are missing or stale.
