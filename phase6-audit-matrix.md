# Phase 6 Audit Matrix - Concise Summary

## P6-01: Define Evidence Taxonomy and Metadata Contract

**✅ Implemented:**
- `parseDocumentTypeHint` returns `null` for unknown types (test: phase-6-evidence-metadata.test.mjs:11-13)
- Upload route preserves `document_type_hint` separately from `document_type` (route.ts:36-44)
- `resolveDocumentMetadata` prioritizes confirmed values over suggestions (test: phase-6-evidence-metadata.test.mjs:50-78)
- Migration adds columns without data loss (202610180001_phase6_evidence_metadata.sql)

**⚠️ Partial:**
- File naming alone doesn't prevent Approved Baseline assignment (handled via review process, not upload)
- Legacy type mapping needs verification (add test for existing records)

## P6-02: Make Large File Upload Finish or Fail Visibly

**✅ Implemented:**
- 50 MB limit enforced (`maxEvidenceFileSizeBytes = 50 * 1024 * 1024`)
- Clear error messages for oversized files (route.ts:131-143)
- Individual item status display with retry option (upload-form.tsx)
- No duplicate records for completed uploads (submission ID validation)

**⚠️ Partial:**
- PRD mentions 10 MB limit; code uses 50 MB. Need to verify documented limit.

## P6-03: Add Durable Multi-File and Optional Single-File Intake Flows

**✅ Implemented:**
- Bulk upload with individual statuses and shared submission ID (submission-scope.test.mjs)
- Single-file with optional type hint (upload-form.tsx:160-175)
- Server-side state persistence across navigation (submission_id in DB)
- Partial failure handling with distinguishable statuses (upload-form.tsx)
- Batch follow-up state persistence (submission table)

**⚠️ Partial:**
- Need verification that server-side state survives page navigation without re-uploading
- Batch follow-up completion mechanism needs confirmation

## P6-04: Safely Expand ZIP Submissions into Evidence Items

**✅ Implemented:**
- ZIP safety validation in `inspectZipDirectory` (zip-safety.ts)
- Member rejection for unsafe paths, encryption, corruption (zip-safety.ts)
- Duplicate detection and warning (markDuplicateContent, phase-6-zip-intake.test.mjs)
- Independent item statuses with common parent submission ID

**⚠️ Partial:**
- Need to verify `/api/.../import-archive` route exists and enforces all safety checks

## P6-05: Complete Common-Format Extraction and Source-Aware Chunking

**✅ Implemented:**
- PDF, DOCX, XLSX, PPTX, CSV, TXT, image parsing with source location (document-parser.ts)
- OCR for scanned PDFs/images via RapidOCR (PP-OCRv6) with failure handling
- Structure-aware chunking with overlap (paragraphBlocks, chunkSourceBlocks)
- No synthetic placeholder data on failure (worker route error handling)

**⚠️ Partial:**
- Verify OCR functionality in development environment (Tesseract/Ghostscript dependencies)

## P6-06: Validate Per-File AI Suggestions and Preserve Reviewer Corrections

**✅ Implemented:**
- Schema validation prevents invalid output (validateGroupExtraction, document-extraction.ts)
- Low-confidence/conflicting evidence routes to Needs Review (nullableDocumentType, classifyDocument)
- Reviewer corrections stored and prioritized (persistConfirmedDocumentMetadata)
- Idempotent chunk-group persistence (upsert with conflict handler)
- N independent parse jobs with concurrency limits (ai_jobs per document, MAX_CONCURRENT_PROVIDER_REQUESTS=2)

**⚠️ Partial:**
- Verify actual concurrency enforcement in practice
- Confirm no batch-wide concatenated text requests exist

## P6-07: Rework Evidence Library Around Review Roles and Artifact Types

**✅ Implemented:**
- Filtering by type/period/workstream/processing state (filterReviewEvidence)
- Grouped evidence display with role filters (assurance workspace)
- Suggestion vs confirmation distinction in UI (document card components)
- Missing evidence prevents "On Track" status (reviewEvidenceIssue)

**⚠️ Partial:**
- Verify archive page filtering without review role assignment
- Document card UI labeling of suggestions vs confirmations

## P6-08: Ground AI Advisor Retrieval, Conversation Context, and Citations

**✅ Implemented:**
- Ranked evidence retrieval with project/review scope (advisorRetrievalQuery)
- Follow-up context handling with fresh retrieval (askAssistant, shouldUseActiveReview)
- No fixed confidence scores (AssistantSource type, formatCitedAnswer)
- Forged citation rejection (validateAdvisorResponse, phase6-advisor.test.mjs)
- Cross-project isolation (conversation/message scoping tests)

**⚠️ Partial:**
- Verify PostgreSQL full-text ranking is actually used in queries
- Confirm prompt construction bases facts on fresh retrieval for follow-ups

## P6-09: Build End-to-End Evaluation and Development Release Gate

**✅ Implemented:**
- E2E test covers full workflow (phase6-workflow.spec.ts)
- All tests pass (npm test, test:e2e, lint, build)
- Transient failure handling and retry (phase6-e2e-provider.test.mjs)
- Evidence readiness checks prevent false completion (evidence-readiness.ts)
- Rollback procedure documented (but external usability session missing)

**⚠️ Partial:**
- Human first-time-user session not conducted (blocker)
- Rollback plan not verified (needs testing)