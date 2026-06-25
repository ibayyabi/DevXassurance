import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("document intelligence migration defines storage, document, job, chunk, extraction, and summary tables", () => {
  const migration = read("supabase/migrations/202606080003_document_intelligence.sql");

  for (const table of [
    "documents",
    "ai_jobs",
    "document_chunks",
    "extraction_runs",
    "extracted_facts",
    "evidence_links",
    "document_summaries",
    "document_summary_sources",
  ]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }

  assert.match(migration, /project-evidence/);
  assert.match(migration, /can_upload_project_evidence/);
  assert.match(migration, /storage_evidence_insert_by_uploaders/);
});

test("document classification values and processing statuses are stable", () => {
  const constants = read("src/features/documents/lib/constants.ts");

  for (const type of [
    "progress_report",
    "meeting_minutes",
    "risk_register",
    "issue_log",
    "schedule",
    "cost_report",
    "approval",
    "claim",
    "change_record",
    "governance_reference",
  ]) {
    assert.match(constants, new RegExp(`"${type}"`));
  }

  for (const status of ["queued", "processing", "needs_review", "completed", "failed", "cancelled"]) {
    assert.match(constants, new RegExp(`"${status}"`));
  }
});

test("documents page includes upload, library, extraction, summary, and source panels", () => {
  assert.ok(existsSync("src/app/app/projects/[projectId]/documents/page.tsx"));
  const page = read("src/app/app/projects/[projectId]/documents/page.tsx");
  const panel = read("src/features/documents/components/document-intelligence.tsx");
  const upload = read("src/features/documents/components/upload-document-form.tsx");
  const actions = read("src/features/documents/actions/document-actions.ts");

  assert.match(page, /DocumentIntelligence/);
  assert.match(upload, /Upload Documents/);
  assert.match(panel, /Document Library/);
  assert.match(panel, /Extracted Information/);
  assert.match(panel, /Document Summary/);
  assert.match(panel, /Source & Evidence/);
  assert.match(actions, /isSupportedEvidenceFile/);
  assert.match(read("src/features/documents/lib/file-types.ts"), /application\/pdf/);
  assert.match(actions, /Automated extraction supports PDF, TXT, CSV, DOCX, and XLSX files/);
  assert.match(upload, /Document title optional/);
  assert.match(upload, /Document date optional/);
  assert.match(upload, /Primary type optional/);
  assert.match(upload, /multiple/);
  assert.match(actions, /parse_document/);
  assert.match(actions, /runOllamaChat/);
});

test("evidence upload queues extractable files and stores reference-only files for review", () => {
  const migration = read("supabase/migrations/202606190001_allow_reference_evidence_file_types.sql");
  const uploadRoute = read("src/app/api/projects/[projectId]/documents/upload/route.ts");
  const form = read("src/features/documents/components/upload-document-form.tsx");
  const fileTypes = read("src/features/documents/lib/file-types.ts");

  assert.match(migration, /drop constraint if exists documents_mime_type_check/);
  assert.match(fileTypes, /processableEvidenceMimeTypes/);
  assert.match(fileTypes, /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/);
  assert.match(fileTypes, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
  assert.match(fileTypes, /text\/csv/);
  assert.match(fileTypes, /text\/plain/);
  assert.match(fileTypes, /image\/png/);
  assert.match(form, /evidenceFileAccept/);
  assert.match(uploadRoute, /isProcessableEvidenceFile/);
  assert.match(uploadRoute, /needs_review/);
  assert.match(uploadRoute, /parse_document/);
});

test("upload defaults metadata and supports multiple files in one request", () => {
  const uploadRoute = read("src/app/api/projects/[projectId]/documents/upload/route.ts");
  const actions = read("src/features/documents/actions/document-actions.ts");
  const form = read("src/features/documents/components/upload-document-form.tsx");

  assert.match(form, /Default: Progress Report/);
  assert.match(uploadRoute, /getAll\("file"\)/);
  assert.match(uploadRoute, /titleFromFileName/);
  assert.match(uploadRoute, /todayIsoDate/);
  assert.match(uploadRoute, /fileLastModifiedIsoDate/);
  assert.match(uploadRoute, /fileLastModifiedValues/);
  assert.match(uploadRoute, /timestampIsoDate\(fileLastModifiedValues\[index\]\)/);
  assert.match(uploadRoute, /documentType: effectiveDocumentType/);
  assert.match(uploadRoute, /fileLastModifiedIsoDate\(file\) \|\|/);
  assert.match(uploadRoute, /file\(s\) uploaded/);
  assert.match(actions, /getAll\("file"\)/);
  assert.match(actions, /titleFromFileName/);
  assert.match(actions, /todayIsoDate/);
  assert.match(actions, /fileLastModifiedIsoDate/);
  assert.match(actions, /timestampIsoDate\(fileLastModifiedValues\[index\]\)/);
});

test("document worker parses supported file types and rejects unsupported files", () => {
  const parser = read("worker/src/services/document-parser.ts");
  const workerRoute = read("src/app/api/workers/parse-document/route.ts");

  assert.match(parser, /pdfjs-dist/);
  assert.match(parser, /TextDecoder/);
  assert.match(parser, /mammoth/);
  assert.match(parser, /xlsx-zip-xml/);
  assert.match(parser, /unsupported_file_type/);
  assert.match(parser, /PDF, TXT, CSV, DOCX, and XLSX/);
  assert.match(workerRoute, /next_document_worker/);
  assert.match(workerRoute, /source text extraction fails/);
});

test("worker and n8n boundaries record success and failure contracts", () => {
  const parser = read("worker/src/services/document-parser.ts");
  const job = read("worker/src/jobs/process-document.ts");
  const workflow = read("workflows/n8n/document-processing-boundary.md");
  const n8nCompose = read("workflows/n8n/docker-compose.yml");
  const workerRoute = read("src/app/api/workers/parse-document/route.ts");

  assert.match(parser, /pdfjs-dist/);
  assert.match(job, /status: "failed"/);
  assert.match(job, /status: "completed"/);
  assert.match(job, /isBenignAssuranceText/);
  assert.match(job, /under budget/);
  assert.match(job, /completed on track/);
  assert.match(workerRoute, /x-xass-worker-secret/);
  assert.match(n8nCompose, /XASS_DOCUMENT_WORKER_URL/);
  assert.match(workflow, /Supabase remains the state source/);
});
