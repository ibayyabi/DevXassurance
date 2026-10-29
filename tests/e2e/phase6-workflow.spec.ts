import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import JSZip from "jszip";
import PDFDocument from "pdfkit";


const EXPECTED_REF = "oaoevvwwjvcnjlonltcw";
const APP_ORIGIN = "http://127.0.0.1:3000";
const MODEL_PROXY = "http://127.0.0.1:3218";
const PROJECTS: string[] = [];
let supabase: SupabaseClient | undefined;
let userId: string | undefined;
let email = "";
let password = "";
function safeWorkerErrorSummary(value: unknown) {
  if (typeof value !== "string") return "unavailable";
  return value
    .replace(/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/gu, "<redacted-jwt>")
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/gu, "<redacted-key>")
    .replace(/\b(?:bearer\s+|(?:api[-_ ]?key|token|authorization|cookie)\s*[:=]\s*)\S+/giu, "<redacted-credential>")
    .replace(/https?:\/\/[^\s"'<>]+/giu, "<redacted-url>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu, "<redacted-id>")
    .replace(/(?:^|\s)\/[^\s"'<>]*/gu, " <redacted-path>")
    .slice(0, 200);
}

type UploadedFile = { name: string; mimeType: string; buffer: Buffer };
type StoredDocument = {
  id: string;
  submission_id: string;
  file_name: string;
  file_size: number;
  storage_path: string;
  processing_status: string;
  processing_error: string | null;
  document_type_hint: string | null;
  document_date_hint: string | null;
  reporting_period_hint: string | null;
  workstream_hint: string | null;
  suggested_document_type: string | null;
  confirmed_document_type: string | null;
  confirmed_evidence_role: string | null;
};
type WorkerPayload = {
  ok?: boolean;
  worker?: string;
  processing_status?: string;
  processing_error?: string | null;
  chunks?: Array<{
    chunk_index: number;
    chunk_text: string;
    page_number: number | null;
    section_label: string | null;
    parser_metadata: Record<string, unknown>;
  }>;
  facts?: unknown[];
  summary?: unknown;
  summary_sources?: unknown[];
  health_snapshots?: unknown[];
  alerts?: unknown[];
  actions?: unknown[];
  document_suggestions?: Record<string, unknown>;
  parser_metadata?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
};
type AssuranceSourceExcerpt = {
  documentId: string;
  documentTitle: string;
  sectionLabel: string | null;
  pageNumber: number | null;
};

test.beforeAll(async () => {
  assertDevelopmentTarget();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const workerSecret = process.env.XASS_WORKER_SECRET;
  if (!supabaseUrl || !serviceKey || !workerSecret || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("E2E requires the verified development Supabase URL, publishable key, service role, and worker secret.");
  }
  const proxy = await fetch(`${MODEL_PROXY}/__e2e/health`).catch(() => null);
  if (!proxy?.ok) throw new Error("The configured development model proxy is unavailable.");

  supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  email = `phase6-${randomUUID()}@example.test`;
  password = `E2e-${randomUUID()}-9x!`;
  const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error("Could not create the isolated E2E user in the verified development project.");
  userId = data.user.id;
});

test.afterAll(async () => {
  if (!supabase) return;
  for (const projectId of PROJECTS) await cleanProject(projectId);
  if (userId) {
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) throw new Error("Could not remove the isolated E2E user from the verified development project.");
  }
});

test("Phase 6 browser journey: multi-file, ZIP safety, guided correction, retries, review filters, citations, and isolation", async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/projects");

  const projectId = await createProject(page, "Phase 6 E2E project");
  const baseline = file("baseline.txt", "text/plain", `APPROVED PROJECT BASELINE\nProject: Phase Six Synthetic Demonstration.\nArtifact type: approved baseline.\nDocument date: 2025-12-05.\nReporting period: 2025-12-01.\nApproved budget: USD 500000.\nMilestone: Operational readiness review is scheduled for 2026-04-18.\nThe approved risk review records no open critical or high risks.\nThe baseline was approved by the project board on 2025-12-05.`);
  const february = file("progress-february.txt", "text/plain", `MONTHLY PROGRESS REPORT\nProject: Phase Six Synthetic Demonstration.\nArtifact type: progress report.\nDocument date: 2026-02-10.\nReporting period: 2026-02-01.\nWorkstream: Civil works.\nCurrent completion is 72 percent.\nThe forecast cost is USD 488500.\nThe operational readiness review remains scheduled for 2026-04-18.\nThe current risk review records no open critical or high risks.`);
  const march = file("progress-march.txt", "text/plain", `MONTHLY PROGRESS REPORT\nProject: Phase Six Synthetic Demonstration.\nArtifact type: progress report.\nDocument date: 2026-03-10.\nReporting period: 2026-03-01.\nWorkstream: Civil works.\nCurrent completion is 81 percent.\nThe forecast cost is USD 487000.\nThe operational readiness review remains scheduled for 2026-04-18.\nThe current risk review records no open critical or high risks.`);
  const safeZipText = "ZIP SAFETY REPORT\nProject: Phase Six Synthetic Demonstration.\nA safe archive member records the readiness review scheduled for 2026-04-18.";
  const nestedArchive = new JSZip();
  nestedArchive.file("inner.txt", "Nested archive test content.");
  const zip = new JSZip();
  zip.file("safe-evidence.txt", safeZipText);
  zip.file("safe-copy.txt", safeZipText);
  zip.file("../unsafe.txt", "UNSAFE PATH TEST MEMBER");
  zip.file("unsupported.exe", Buffer.from("unsupported test member"));
  zip.file("nested.zip", await nestedArchive.generateAsync({ type: "nodebuffer" }));
  const zipFile = file("phase6-safety.zip", "application/zip", await zip.generateAsync({ type: "nodebuffer" }));

  await page.goto(`/app/projects/${projectId}/documents`);
  const projectFilesInput = page.getByLabel("Project files");
  await expect(projectFilesInput).toBeVisible({ timeout: 30_000 });
  await projectFilesInput.setInputFiles([baseline, february, march, zipFile]);
  await page.getByRole("button", { name: "Upload project files" }).click();
  const initialUploadStatus = page.getByRole("list", { name: "Upload status" });
  await expect(initialUploadStatus).toContainText("Queued", { timeout: 120_000 });
  const memberList = page.getByRole("list", { name: "Archive member results" });
  await expect(memberList).toContainText("safe-evidence.txt: accepted", { timeout: 120_000 });
  await expect(memberList).toContainText("safe-copy.txt: accepted");
  await expect(memberList).toContainText("Same content as another archive member.");
  await expect(memberList).toContainText("unsupported.exe: rejected");
  await expect(memberList).toContainText("unsafe.txt: rejected");
  await expect(memberList).toContainText("nested.zip: rejected");
  const regularRows = await Promise.all([baseline, february, march].map((item) => waitForDocument(projectId, item.name)));
  const archiveRow = await waitForDocument(projectId, "safe-evidence.txt");
  const archiveCopyRow = await waitForDocument(projectId, "safe-copy.txt");
  for (const member of [archiveRow, archiveCopyRow]) {
    // The helper below bypasses n8n claim, so catch stranded imports before it changes document state.
    expect(["queued", "processing", "completed", "needs_review"]).toContain(member.processing_status);
  }
  expect(archiveCopyRow.submission_id).toBe(archiveRow.submission_id);
  const { data: regularSubmission, error: regularSubmissionError } = await db().from("document_upload_submissions").select("batch_id").eq("id", regularRows[0].submission_id).eq("project_id", projectId).maybeSingle();
  const { data: archiveSubmission, error: archiveSubmissionError } = await db().from("document_upload_submissions").select("batch_id").eq("id", archiveRow.submission_id).eq("project_id", projectId).maybeSingle();
  if (regularSubmissionError || archiveSubmissionError || !regularSubmission?.batch_id || !archiveSubmission?.batch_id) {
    throw new Error("The mixed upload batch did not persist its regular and ZIP submissions.");
  }
  expect(regularRows.every((row) => row.submission_id === regularRows[0].submission_id)).toBe(true);
  expect(archiveSubmission.batch_id).toBe(regularSubmission.batch_id);
  const processSuccessfully = async (fileName: string) => {
    const result = await processUploadedDocument(projectId, fileName);
    expect(result.ok, `Worker failed for ${fileName} with HTTP ${result.status}; error code ${result.payload.errorCode ?? "unknown"}; detail ${safeWorkerErrorSummary(result.payload.errorMessage)}.`).toBe(true);
    return result;
  };
  for (const item of [baseline, february, march]) {
    await processSuccessfully(item.name);
  }
  await processSuccessfully(archiveRow.file_name);
  await processSuccessfully(archiveCopyRow.file_name);
  await page.reload();
  const uploadBatch = page.locator("li").filter({ hasText: `Batch ${regularSubmission.batch_id.slice(0, 8)}` });
  await expect(uploadBatch).toContainText("5 file(s)");
  await expect(uploadBatch).toContainText("Results saved");
  const generatedPdf = await largeEvidencePdf();
  const largeFile = file("large-evidence.pdf", "application/pdf", generatedPdf);
  await page.getByLabel("Project files").setInputFiles([largeFile]);
  await page.getByRole("button", { name: "Upload project files" }).click();
  await expect(page.getByRole("list", { name: "Upload status" })).toContainText("Queued", { timeout: 120_000 });
  const largeRow = await waitForDocument(projectId, largeFile.name);
  expect(largeRow.file_size).toBeGreaterThan(10 * 1024 * 1024);
  const largeResult = await processSuccessfully(largeFile.name);
  expect((largeResult.payload.chunks ?? []).reduce((sum, chunk) => sum + chunk.chunk_text.length, 0)).toBeLessThan(320_000);

  const guided = file("guided-cost-report.txt", "text/plain", `COST REPORT\nProject: Phase Six Synthetic Demonstration.\nDocument date: 2026-02-16.\nReporting period: 2026-02-01.\nWorkstream: Commercial.\nThe February forecast cost is USD 488500 against the approved USD 500000 baseline.`);
  await page.getByLabel("One document").check();
  await page.getByLabel("Document type").selectOption("risk_register");
  await page.getByRole("textbox", { name: "Document date Optional" }).fill("2026-02-16");
  await page.getByRole("textbox", { name: "Reporting period Optional" }).fill("2026-02");
  await page.getByRole("textbox", { name: "Workstream Optional" }).fill("Commercial");
  await page.getByLabel("Document file").setInputFiles([guided]);
  let storageCreateAttempts = 0;
  let interruptStorage = true;
  await page.route("**/storage/v1/upload/resumable**", async (route) => {
    if (interruptStorage && route.request().method() === "POST") {
      storageCreateAttempts += 1;
      await route.fulfill({ status: 503, contentType: "application/json", body: "{\"message\":\"temporary development storage interruption\"}" });
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Upload document" }).click();
  const uploadStatus = page.getByRole("list", { name: "Upload status" }).filter({ hasText: guided.name });
  await expect(uploadStatus.getByRole("button", { name: "Retry" })).toBeVisible({ timeout: 120_000 });
  expect(storageCreateAttempts).toBeGreaterThan(0);
  interruptStorage = false;
  await uploadStatus.getByRole("button", { name: "Retry" }).click();
  await expect(uploadStatus).toContainText("Queued", { timeout: 120_000 });
  await page.unroute("**/storage/v1/upload/resumable**");
  const guidedRow = await waitForDocument(projectId, guided.name);
  expect(guidedRow.document_type_hint).toBe("risk_register");
  expect(guidedRow.document_date_hint).toBe("2026-02-16");
  expect(guidedRow.reporting_period_hint).toBe("2026-02-01");
  await expectExactlyOneDocumentAndJob(projectId, guided.name, guidedRow.id);
  await processSuccessfully(guided.name);
  const suggestedGuided = await getDocument(projectId, guided.name);
  expect(suggestedGuided.suggested_document_type).toBeTruthy();
  expect(suggestedGuided.confirmed_document_type).toBeNull();
  await page.reload();
  await confirmMetadata(page, guided.name, {
    documentType: "cost_report",
    evidenceRole: "supporting",
    documentDate: "2026-02-16",
    reportingPeriod: "2026-02",
    workstream: "Commercial",
  });
  const correctedGuided = await getDocument(projectId, guided.name);
  expect(correctedGuided.confirmed_document_type).toBe("cost_report");
  expect(correctedGuided.confirmed_evidence_role).toBe("supporting");
  expect(correctedGuided.document_type_hint).toBe("risk_register");
  expect(correctedGuided.suggested_document_type).toBe(suggestedGuided.suggested_document_type);
  const failureFile = file("model-retry.txt", "text/plain", `DECISION RECORD\nProject: Phase Six Synthetic Demonstration.\nDocument date: 2026-03-12.\nReporting period: 2026-03-01.\nThe board approved the procurement gate on 2026-03-12.\nThe responsible owner is the delivery director.`);
  await page.getByLabel("One document").check();
  await page.getByLabel("Document file").setInputFiles([failureFile]);
  await page.getByRole("button", { name: "Upload document" }).click();
  await expect(page.getByRole("list", { name: "Upload status" })).toContainText("Queued", { timeout: 120_000 });
  const noHintRow = await waitForDocument(projectId, failureFile.name);
  expect(noHintRow.document_type_hint).toBeNull();
  expect(noHintRow.document_date_hint).toBeNull();
  expect(noHintRow.reporting_period_hint).toBeNull();
  expect(noHintRow.workstream_hint).toBeNull();
  await armTransientModelFailure();
  const failedWorker = await processUploadedDocument(projectId, failureFile.name);
  expect(failedWorker.ok).toBe(false);
  expect(failedWorker.payload.errorCode).toBeTruthy();
  await page.reload();
  await page.getByRole("button", { name: "2. Baca & periksa", exact: true }).click();
  const failedArticle = documentArticle(page, failureFile.name);
  await failedArticle.locator("details[data-document-details]").locator(":scope > summary").click();
  await expect(failedArticle.getByText("Failed", { exact: true })).toBeVisible();
  await failedArticle.getByRole("button", { name: "Retry document processing" }).click();
  await waitForJob(projectId, failureFile.name, failedWorker.jobId);
  await processSuccessfully(failureFile.name);
  const noHintSuggestion = await getDocument(projectId, failureFile.name);
  expect(noHintSuggestion.suggested_document_type).toBeTruthy();
  expect(noHintSuggestion.confirmed_document_type).toBeNull();
  await page.reload();
  await confirmMetadata(page, failureFile.name, {
    documentType: "decision_record",
    evidenceRole: "supporting",
    documentDate: "2026-03-12",
    reportingPeriod: "2026-03",
    workstream: "Governance",
  });

  await page.reload();
  await confirmMetadata(page, baseline.name, {
    documentType: "approved_baseline",
    evidenceRole: "baseline",
    documentDate: "2025-12-05",
    reportingPeriod: "2025-12",
    workstream: "Governance",
  });
  await confirmMetadata(page, february.name, {
    documentType: "progress_report",
    evidenceRole: "current",
    documentDate: "2026-02-10",
    reportingPeriod: "2026-02",
    workstream: "Civil works",
  });
  await confirmMetadata(page, march.name, {
    documentType: "progress_report",
    evidenceRole: "current",
    documentDate: "2026-03-10",
    reportingPeriod: "2026-03",
    workstream: "Civil works",
  });
  await confirmMetadata(page, largeFile.name, {
    documentType: "technical_reference",
    evidenceRole: "supporting",
    documentDate: "2026-03-01",
    reportingPeriod: "2026-03",
    workstream: "General",
  });
  await confirmMetadata(page, archiveRow.file_name, {
    documentType: "other",
    evidenceRole: "supporting",
    documentDate: "2026-03-01",
    reportingPeriod: "2026-03",
    workstream: "General",
  });

  await verifyGuidedInlineD2(page);

  await page.goto(`/app/projects/${projectId}/assurance`);
  await page.getByLabel("Reporting month").fill("2026-03");
  await page.getByRole("button", { name: "Start review" }).click();
  await expect(page.getByRole("heading", { name: "Choose plan and current evidence" })).toBeVisible({ timeout: 120_000 });
  const { data: createdReview, error: reviewError } = await db().from("assurance_reviews")
    .select("id")
    .eq("project_id", projectId)
    .eq("reporting_period", "2026-03-01")
    .maybeSingle();
  if (reviewError || !createdReview) throw new Error("The Assurance Review was not persisted.");
  const reviewId = createdReview.id;
  await expect(page.getByText("Review evidence needs attention")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run analysis" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Resolve evidence requirements first" })).toBeDisabled();
  await expect(page.getByText("On Track", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Continue to report" })).toHaveCount(0);
  const [baselineReady, marchReady] = await Promise.all([
    getDocument(projectId, baseline.name),
    getDocument(projectId, march.name),
  ]);
  if (baselineReady.processing_status !== "completed" || marchReady.processing_status !== "completed") {
    console.warn("Assurance evidence remained in Needs Review after the real worker response; analysis and report were not forced.");
    throw new Error("The configured model did not make both selected evidence documents ready for Assurance analysis.");
  }
  const baselineGroup = page.getByRole("group", { name: "Approved baseline", exact: true });
  const currentGroup = page.getByRole("group", { name: "Current period", exact: true });
  const februaryReady = await getDocument(projectId, february.name);
  await baselineGroup.locator("label").filter({ hasText: baseline.name }).getByRole("checkbox").check();
  await currentGroup.locator("label").filter({ hasText: february.name }).getByRole("checkbox").check();
  await page.getByRole("button", { name: "Save evidence selection" }).click();
  await expect.poll(async () => {
    const links = await persistedReviewEvidence(projectId, reviewId);
    return [
      links.some((link) => link.document_id === baselineReady.id && link.evidence_role === "baseline"),
      links.some((link) => link.document_id === februaryReady.id && link.evidence_role === "current"),
    ];
  }).toEqual([true, true]);
  await page.reload();
  await page.getByLabel(/Document type/u).selectOption("progress_report");
  await expect(baselineGroup.locator("label").filter({ hasText: baseline.name })).toHaveCount(0);
  await expect(currentGroup.locator("label").filter({ hasText: february.name })).toBeVisible();
  await expect(currentGroup.locator("label").filter({ hasText: march.name })).toBeVisible();
  await currentGroup.locator("label").filter({ hasText: february.name }).getByRole("checkbox").uncheck();
  await currentGroup.locator("label").filter({ hasText: march.name }).getByRole("checkbox").check();
  await page.getByRole("button", { name: "Save evidence selection" }).click();
  await expect.poll(async () => {
    const links = await persistedReviewEvidence(projectId, reviewId);
    return [
      links.some((link) => link.document_id === baselineReady.id && link.evidence_role === "baseline"),
      links.some((link) => link.document_id === februaryReady.id && link.evidence_role === "current"),
      links.some((link) => link.document_id === marchReady.id && link.evidence_role === "current"),
    ];
  }).toEqual([true, false, true]);
  await page.reload();
  const savedBaseline = baselineGroup.locator("label").filter({ hasText: baseline.name }).getByRole("checkbox");
  const savedFebruary = currentGroup.locator("label").filter({ hasText: february.name }).getByRole("checkbox");
  const savedMarch = currentGroup.locator("label").filter({ hasText: march.name }).getByRole("checkbox");
  await expect(savedBaseline).toBeChecked();
  await expect(savedFebruary).not.toBeChecked();
  await expect(savedMarch).toBeChecked();

  const analysisButton = page.getByRole("button", { name: "Run analysis" });
  if (await analysisButton.isEnabled()) {
    await analysisButton.click();
    const analysis = await waitForAssuranceAnalysis(projectId, reviewId);
    await page.reload();
    if (analysis.status === "findings_ready") {
      const { data: findings, error: findingsError } = await db().from("assurance_findings")
        .select("source_excerpts")
        .eq("project_id", projectId)
        .eq("review_id", reviewId);
      if (findingsError) throw new Error("Could not read the completed Assurance findings.");
      const baselineDocumentId = (await getDocument(projectId, baseline.name)).id;
      const marchDocumentId = (await getDocument(projectId, march.name)).id;
      const source = (findings ?? [])
        .flatMap((finding) => Array.isArray(finding.source_excerpts) ? finding.source_excerpts as AssuranceSourceExcerpt[] : [])
        .find((excerpt) => [baselineDocumentId, marchDocumentId].includes(excerpt.documentId));
      if (!source) throw new Error("The completed Assurance analysis has no source document link.");
      expect(source.sectionLabel || source.pageNumber).toBeTruthy();
      const sourceDetails = page.locator("details")
        .filter({ hasText: "View source excerpts" })
        .filter({ hasText: source.documentTitle })
        .first();
      await sourceDetails.locator("summary").click();
      const sourceLink = sourceDetails.getByRole("link", { name: source.documentTitle, exact: true });
      await expect(sourceLink).toBeVisible();
      expect(await sourceLink.getAttribute("href")).toContain(
        `/app/projects/${projectId}/documents?document=${source.documentId}#document-${source.documentId}`,
      );
      await expect(sourceDetails).toContainText(source.sectionLabel ?? `page ${source.pageNumber}`);
      await page.getByRole("link", { name: "Continue to report" }).click();
      await expect(page.getByText("Source review", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Generate report" }).click();
      await expect(page.getByRole("button", { name: "Save report edits" })).toBeVisible();
    } else {
      console.warn("Assurance analysis remained visibly unready: strict model output did not produce verified findings; no synthetic result was substituted.");
      expect(analysis.analysis_error).toBeTruthy();
      await expect(page.getByText(analysis.analysis_error!, { exact: true })).toBeVisible();
      await expect(page.getByText("On Track", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Save evidence and run the analysis to create findings.")).toBeVisible();
    }
  } else {
    console.warn("Assurance analysis remained visibly unready: selected worker results did not meet the evidence-readiness gate; no synthetic result was substituted.");
    await expect(page.getByRole("status").filter({ hasText: "selected document(s) are unavailable" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Resolve evidence requirements first" })).toBeDisabled();
    await expect(page.getByText("On Track", { exact: true })).toHaveCount(0);
  }
  await page.goto(`/app/projects/${projectId}/assistant`);
  const assistantQuestion = page.getByLabel("Ask the AI Advisor");
  await assistantQuestion.fill("What date is the operational readiness review scheduled for in the approved baseline?");
  await page.getByRole("button", { name: "Ask" }).click();
  const sourcePanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Sources used" }),
  });
  await expect(sourcePanel.getByText(baseline.name, { exact: false })).toBeVisible({ timeout: 180_000 });
  const baselineCard = sourcePanel.locator("details").filter({ hasText: baseline.name }).first();
  await baselineCard.locator("summary").click();
  await expect(baselineCard.getByText("Source ID:", { exact: false })).toBeVisible();
  const firstInteraction = await latestInteraction(projectId);
  const baselineDocumentId = (await getDocument(projectId, baseline.name)).id;
  const baselineCitation = firstInteraction.evidence_links.find((source) => source.documentId === baselineDocumentId);
  expect(baselineCitation).toBeDefined();
  expect(baselineCitation?.excerpt).toContain("2026-04-18");
  const { data: exactSource, error: sourceError } = await db().from("document_chunks")
    .select("id, parser_metadata, section_label")
    .eq("id", baselineCitation?.id)
    .eq("project_id", projectId)
    .maybeSingle();
  expect(sourceError).toBeNull();
  expect(exactSource?.id).toBe(baselineCitation?.id);
  expect(exactSource?.parser_metadata?.sourceLocation?.paragraphStart).toBe(1);
  expect(exactSource?.section_label).toBe("APPROVED PROJECT BASELINE");
  await expect(baselineCard).toContainText("Paragraph 1");
  await expect(baselineCard).toContainText("APPROVED PROJECT BASELINE");
  await assistantQuestion.fill("Why?");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect.poll(async () => (await latestInteraction(projectId)).question, { timeout: 180_000 }).toBe("Why?");
  await expect(sourcePanel.getByText(new RegExp(`S1 · ${baseline.name}`))).toBeVisible();
  const followup = await latestInteraction(projectId);
  expect(followup.question).toBe("Why?");
  expect(followup.conversation_id).toBe(firstInteraction.conversation_id);
  expect(followup.evidence_links.length).toBeGreaterThan(0);

  await page.getByRole("button", { name: "New conversation" }).click();
  await assistantQuestion.fill("Which date does the approved baseline set for the readiness review?");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(sourcePanel.getByText(new RegExp(`S1 · ${baseline.name}`))).toBeVisible({ timeout: 180_000 });
  expect((await latestInteraction(projectId)).evidence_links.length).toBeGreaterThan(0);

  await page.getByRole("button", { name: "New conversation" }).click();
  await assistantQuestion.fill("Which lunar launch pad hosted the Mars rover?");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByText("The available evidence is not sufficient for a reliable answer.")).toBeVisible({ timeout: 60_000 });
  expect((await latestInteraction(projectId)).evidence_links).toHaveLength(0);

  const isolatedProjectId = await createProject(page, "Phase 6 isolated E2E project");
  await page.goto(`/app/projects/${isolatedProjectId}/assistant`);
  await page.getByLabel("Ask the AI Advisor").fill("What date is the operational readiness review scheduled for in the approved baseline?");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByText("The available evidence is not sufficient for a reliable answer.")).toBeVisible({ timeout: 60_000 });
  const isolatedInteraction = await latestInteraction(isolatedProjectId);
  expect(isolatedInteraction.evidence_links).toHaveLength(0);
  expect(isolatedInteraction.conversation_id).not.toBe(firstInteraction.conversation_id);
});

function assertDevelopmentTarget() {
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const linked = JSON.parse(readFileSync("supabase/.temp/linked-project.json", "utf8")) as { ref?: string; name?: string };
  const linkedRef = readFileSync("supabase/.temp/project-ref", "utf8").trim();
  const localConfig = readFileSync("supabase/config.toml", "utf8");
  const projectName = /^project_id\s*=\s*"([^"]+)"/mu.exec(localConfig)?.[1];
  let configuredRef = "";
  try {
    configuredRef = new URL(configuredUrl).hostname.split(".")[0];
  } catch {
    configuredRef = "";
  }
  if (
    configuredRef !== EXPECTED_REF || linkedRef !== EXPECTED_REF || linked.ref !== EXPECTED_REF ||
    linked.name !== "DevXAssurance" || projectName !== "XAss-Development"
  ) {
    throw new Error("Refusing E2E writes: the configured Supabase target is not the verified DevXAssurance/XAss-Development project.");
  }
}

async function createProject(page: Page, label: string) {
  await page.goto("/app/projects");
  const projectName = `${label} ${randomUUID().slice(0, 8)}`;
  await page.getByLabel("Project name").fill(projectName);
  await page.getByLabel("Organization or program").fill("Synthetic E2E only");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/\/app\/projects\/[^/]+\/dashboard/);
  const match = /\/app\/projects\/([^/]+)\//u.exec(new URL(page.url()).pathname);
  if (!match) throw new Error("Project creation did not return a project workspace.");
  PROJECTS.push(match[1]);
  return match[1];
}

function file(name: string, mimeType: string, value: string | Buffer): UploadedFile {
  return { name, mimeType, buffer: Buffer.isBuffer(value) ? value : Buffer.from(value) };
}

async function largeEvidencePdf() {
  const document = new PDFDocument({ compress: true });
  const chunks: Buffer[] = [];
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  document.on("end", () => resolve(Buffer.concat(chunks)));
  document.on("error", reject);
  document.fontSize(12).text(`PROJECT STATUS REPORT\nProject: Phase Six Synthetic Demonstration.\nReporting period: 2026-03-01.\nForecast cost: USD 487000.\nThe operational readiness review is scheduled for 2026-04-18.\n${"Synthetic project evidence. ".repeat(12)}`);
  document.file(randomBytes(12 * 1024 * 1024), {
    name: "non-text-evidence-payload.bin",
    type: "application/octet-stream",
    hidden: true,
  });
  document.end();
  return promise;
}

async function waitForDocument(projectId: string, fileName: string) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const { data, error } = await db().from("documents")
      .select("id, submission_id, file_name, file_size, storage_path, processing_status, processing_error, document_type_hint, document_date_hint, reporting_period_hint, workstream_hint, suggested_document_type, confirmed_document_type, confirmed_evidence_role")
      .eq("project_id", projectId)
      .eq("file_name", fileName)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Could not read E2E document ${fileName}.`);
    if (data) return data as StoredDocument;
    await sleep(500);
  }
  throw new Error(`Upload did not create the expected evidence row: ${fileName}.`);
}
async function expectExactlyOneDocumentAndJob(projectId: string, fileName: string, documentId: string) {
  const deadline = Date.now() + 30_000;
  let documents: Array<{ id: string }> = [];
  let jobs: Array<{ id: string }> = [];
  while (Date.now() < deadline) {
    const [documentResult, jobResult] = await Promise.all([
      db().from("documents").select("id").eq("project_id", projectId).eq("file_name", fileName),
      db().from("ai_jobs").select("id").eq("project_id", projectId).eq("document_id", documentId).eq("job_type", "parse_document"),
    ]);
    if (documentResult.error || jobResult.error) throw new Error(`Could not verify the storage-retry rows for ${fileName}.`);
    documents = documentResult.data ?? [];
    jobs = jobResult.data ?? [];
    if (documents.length === 1 && jobs.length === 1) return;
    await sleep(500);
  }
  expect(documents).toHaveLength(1);
  expect(jobs).toHaveLength(1);
}

async function getDocument(projectId: string, fileName: string) {
  return waitForDocument(projectId, fileName);
}

async function waitForJob(projectId: string, fileName: string, previousJobId?: string) {
  const document = await getDocument(projectId, fileName);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const { data, error } = await db().from("ai_jobs")
      .select("id, status, created_at")
      .eq("project_id", projectId)
      .eq("document_id", document.id)
      .eq("job_type", "parse_document")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("Could not read the E2E parse job.");
    if (data && data.id !== previousJobId) return data;
    await sleep(500);
  }
  throw new Error(`No parse job appeared for ${fileName}.`);
}
async function waitForAssuranceAnalysis(projectId: string, reviewId: string) {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const { data, error } = await db().from("assurance_reviews")
      .select("status, analysis_error")
      .eq("id", reviewId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (error) throw new Error("Could not read the Assurance analysis state.");
    if (data && ["findings_ready", "analysis_failed"].includes(data.status)) return data;
    await sleep(1000);
  }
  throw new Error("The Assurance analysis did not reach a visible success or failure state.");
}

async function processUploadedDocument(projectId: string, fileName: string) {
  const document = await getDocument(projectId, fileName);
  const job = await waitForJob(projectId, fileName);
  const now = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const { data: claimedJob, error: claimError } = await db().from("ai_jobs")
    .update({ status: "processing", claimed_at: now, lease_expires_at: leaseUntil, updated_at: now })
    .eq("id", job.id)
    .eq("project_id", projectId)
    .eq("document_id", document.id)
    .eq("status", "queued")
    .select("id")
    .maybeSingle();
  if (claimError) throw new Error(`Could not claim the E2E parse job for ${fileName}.`);
  if (!claimedJob) return { ...(await waitForPersistedResult(projectId, document.id, fileName)), jobId: job.id };

  const { data: processingDocument, error: documentError } = await db().from("documents")
    .update({ processing_status: "processing", processing_error: null, updated_at: now })
    .eq("id", document.id)
    .eq("project_id", projectId)
    .select("id")
    .maybeSingle();
  if (documentError || !processingDocument) {
    const { data: resetJob, error: resetError } = await db().from("ai_jobs")
      .update({ status: "queued", claimed_at: null, lease_expires_at: null })
      .eq("id", job.id)
      .eq("project_id", projectId)
      .select("id")
      .maybeSingle();
    if (resetError || !resetJob) throw new Error(`Could not release the E2E parse job for ${fileName}.`);
    throw new Error(`Could not set the E2E document ${fileName} to processing.`);
  }

  const response = await fetch(`${APP_ORIGIN}/api/workers/parse-document`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-xass-worker-secret": process.env.XASS_WORKER_SECRET ?? "",
    },
    body: JSON.stringify({ job_id: job.id, project_id: projectId, document_id: document.id }),
  });
  const payload = await response.json() as WorkerPayload;
  if (!response.ok || payload.ok !== true) return { ok: false, status: response.status, payload, documentId: document.id, jobId: job.id };
  if (!Array.isArray(payload.chunks) || payload.chunks.length === 0) {
    throw new Error(`The actual parser worker returned no source chunks for ${fileName}.`);
  }
  const { error: runError } = await db().from("extraction_runs").insert({
    project_id: projectId,
    document_id: document.id,
    ai_job_id: job.id,
    status: "completed",
    metadata: { parser_metadata: payload.parser_metadata ?? {}, source: "phase6-e2e-worker-result" },
  });
  if (runError) throw new Error(`Could not persist the completed worker run for ${fileName}.`);
  const rows = payload.chunks.map((chunk) => ({
    project_id: projectId,
    document_id: document.id,
    chunk_index: chunk.chunk_index,
    chunk_text: chunk.chunk_text,
    page_number: chunk.page_number,
    section_label: chunk.section_label,
    parser_metadata: chunk.parser_metadata ?? {},
  }));
  const { error: chunkError } = await db().from("document_chunks").upsert(rows, { onConflict: "document_id,chunk_index" });
  if (chunkError) throw new Error(`Could not persist the worker source chunks for ${fileName}.`);
  const finishedAt = new Date().toISOString();
  const [{ data: completedJob, error: jobError }, { data: resultDocument, error: resultDocumentError }] = await Promise.all([
    db().from("ai_jobs").update({ status: "completed", error_code: null, error_message: null, completed_at: finishedAt, claimed_at: null, lease_expires_at: null, updated_at: finishedAt }).eq("id", job.id).eq("project_id", projectId).select("id").maybeSingle(),
    db().from("documents").update({ processing_status: payload.processing_status ?? "needs_review", processing_error: payload.processing_error ?? null, updated_at: finishedAt }).eq("id", document.id).eq("project_id", projectId).select("id").maybeSingle(),
  ]);
  if (jobError || resultDocumentError || !completedJob || !resultDocument) throw new Error(`Could not apply the worker result to ${fileName}.`);
  return { ok: true, status: response.status, payload, documentId: document.id, jobId: job.id };
}

async function waitForPersistedResult(projectId: string, documentId: string, fileName: string) {
  const deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    const { data: document, error } = await db().from("documents")
      .select("processing_status, processing_error")
      .eq("id", documentId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (error) throw new Error(`Could not read the n8n result for ${fileName}.`);
    if (document?.processing_status === "failed") {
      return { ok: false, status: 422, payload: { ok: false, errorCode: "n8n_processing_failed", errorMessage: document.processing_error ?? "The n8n worker failed." }, documentId };
    }
    if (document?.processing_status === "completed" || document?.processing_status === "needs_review") {
      const { data: chunks, error: chunkError } = await db().from("document_chunks")
        .select("chunk_index, chunk_text, page_number, section_label, parser_metadata")
        .eq("project_id", projectId)
        .eq("document_id", documentId)
        .order("chunk_index", { ascending: true });
      if (chunkError) throw new Error(`Could not read the n8n chunks for ${fileName}.`);
      if (chunks?.length) {
        return { ok: true, status: 200, payload: { ok: true, processing_status: document.processing_status, processing_error: document.processing_error, chunks }, documentId };
      }
    }
    await sleep(1000);
  }
  throw new Error(`The claimed n8n job did not reach a persisted terminal result for ${fileName}.`);
}

async function confirmMetadata(page: Page, fileName: string, values: {
  documentType: string;
  evidenceRole: "baseline" | "current" | "supporting";
  documentDate: string;
  reportingPeriod: string;
  workstream: string;
}) {
  await page.getByRole("button", { name: "2. Baca & periksa", exact: true }).click();
  const article = documentArticle(page, fileName);
  await article.locator("details[data-document-details]").evaluate((element) => { (element as HTMLDetailsElement).open = true; });
  await expect(article).toBeVisible({ timeout: 120_000 });
  const details = article.locator("summary").filter({ hasText: /^(Review suggestions|Edit confirmed metadata)$/ }).locator("..");
  if (!(await details.evaluate((element) => element.hasAttribute("open")))) {
    await details.locator("summary").click();
  }
  const form = article.locator("form").filter({ hasText: "Save review metadata" });
  const projectId = await form.locator('input[name="projectId"]').inputValue();
  await form.getByLabel("Artifact type").selectOption(values.documentType);
  await form.getByLabel("Evidence role (not user access)").selectOption(values.evidenceRole);
  await form.getByLabel("Document date").fill(values.documentDate);
  await form.getByLabel("Reporting period").fill(values.reportingPeriod);
  await form.getByLabel("Workstream").fill(values.workstream);
  await form.getByRole("button", { name: "Save review metadata" }).click();
  await expect.poll(async () => (await getDocument(projectId, fileName)).processing_status).toBe("completed");
  await page.reload();
  const updated = documentArticle(page, fileName);
  await page.getByRole("button", { name: "2. Baca & periksa", exact: true }).click();
  await updated.locator("details[data-document-details]").locator(":scope > summary").click();
  await expect(updated.getByText(new RegExp(`Type: .*Confirmed`))).toBeVisible();
  await expect(updated.getByText(new RegExp(`Evidence role: .*Confirmed`))).toBeVisible();
  await expect(updated.getByText("Completed", { exact: true })).toBeVisible();
}

function documentArticle(page: Page, fileName: string) {
  return page.getByRole("article").filter({ hasText: fileName });
}

async function persistedReviewEvidence(projectId: string, reviewId: string) {
  const { data, error } = await db().from("assurance_review_documents")
    .select("document_id, evidence_role")
    .eq("project_id", projectId)
    .eq("review_id", reviewId);
  if (error) throw new Error("Could not verify saved review evidence.");
  return data ?? [];
}
async function armTransientModelFailure() {
  const response = await fetch(`${MODEL_PROXY}/__e2e/fail-next`, { method: "POST" });
  if (!response.ok) throw new Error("Could not arm the local one-request provider failure for recovery coverage.");
}

async function latestInteraction(projectId: string) {
  const { data, error } = await db().from("assistant_interactions")
    .select("project_id, user_id, conversation_id, question, evidence_links, insufficient_evidence, answer")
    .eq("project_id", projectId)
    .eq("user_id", userId!)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) throw new Error("The Advisor did not persist the expected E2E conversation turn.");
  return data as {
    project_id: string;
    user_id: string;
    conversation_id: string;
    question: string;
    evidence_links: Array<{ id: string; documentId: string; excerpt: string }>;
    insufficient_evidence: boolean;
    answer: string;
  };
}

async function cleanProject(projectId: string) {
  const client = db();
  const [documentResult, submissionResult] = await Promise.all([
    client.from("documents").select("storage_path").eq("project_id", projectId),
    client.from("document_upload_submissions").select("archive_storage_path, archive_manifest").eq("project_id", projectId),
  ]);
  if (documentResult.error || submissionResult.error) throw new Error(`Could not list E2E storage paths for project ${projectId}.`);
  const documents = documentResult.data;
  const submissions = submissionResult.data;
  const paths = new Set<string>();
  for (const row of documents ?? []) if (row.storage_path?.startsWith(`${projectId}/`)) paths.add(row.storage_path);
  for (const row of submissions ?? []) {
    if (row.archive_storage_path?.startsWith(`${projectId}/`)) paths.add(row.archive_storage_path);
    const manifest = row.archive_manifest;
    if (manifest && typeof manifest === "object" && "cleanupPaths" in manifest && Array.isArray(manifest.cleanupPaths)) {
      for (const value of manifest.cleanupPaths) if (typeof value === "string" && value.startsWith(`${projectId}/`)) paths.add(value);
    }
  }
  if (paths.size) {
    const { error } = await client.storage.from("project-evidence").remove([...paths]);
    if (error) throw new Error(`Could not remove test-owned storage paths for project ${projectId}.`);
  }
  const { data: deletedProject, error: projectError } = await client.from("projects")
    .delete()
    .eq("id", projectId)
    .select("id")
    .maybeSingle();
  if (projectError || !deletedProject) throw new Error(`Could not remove test-owned project ${projectId}.`);
}

async function sleep(milliseconds: number) {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, milliseconds);
  await promise;
}
function db() {
  if (!supabase) throw new Error("The isolated development Supabase client is not initialized.");
  return supabase;
}

// Local presentation checks never submit the selected file or reviewer edits.
async function verifyGuidedInlineD2(page: Page) {
  const library = page.locator("#evidence-library");
  const controls = page.locator("#evidence-check");
  await page.getByRole("button", { name: "2. Baca & periksa", exact: true }).click();
  await controls.getByRole("button", { name: "All documents", exact: true }).click();
  const article = library.locator("article").first();
  const articleId = await article.getAttribute("id");
  await article.locator("details[data-document-details]").evaluate((element) => { (element as HTMLDetailsElement).open = true; });
  const metadata = article.locator("form").filter({ hasText: "Save review metadata" });
  const disclosure = metadata.locator("..");
  await disclosure.evaluate((element) => { (element as HTMLDetailsElement).open = true; });
  const field = metadata.getByLabel("Workstream");
  const originalWorkstream = await field.inputValue();
  await field.fill("D2 unsaved workstream");
  const snapshot = await metadata.locator('input[type="hidden"]').evaluateAll((inputs) => inputs.map((input) => [(input as HTMLInputElement).name, (input as HTMLInputElement).value]));
  const rowNode = await article.elementHandle();
  const fieldNode = await field.elementHandle();
  const upload = page.locator('input[type="file"]');
  await upload.setInputFiles({ name: "d2-selection-only.txt", mimeType: "text/plain", buffer: Buffer.from("Do not upload") });
  const uploadNode = await upload.elementHandle();
  const factInput = page.locator('input[name="editedValue"]').first();
  const hasFact = await factInput.count() > 0;
  let factNode;
  const originalFactEdit = hasFact ? await factInput.inputValue() : "";
  if (hasFact) {
    await page.getByText("Review extracted details", { exact: true }).click();
    await factInput.locator("xpath=ancestor::details[@data-extracted-fact]").locator("summary").click();
    await factInput.fill("D2 unsaved fact correction");
    factNode = await factInput.elementHandle();
  }
  let submissions = 0;
  const mutations: string[] = [];
  await page.exposeFunction("d2ObservedSubmit", () => { submissions++; });
  await page.evaluate(() => document.addEventListener("submit", () => { void (window as unknown as { d2ObservedSubmit: () => Promise<void> }).d2ObservedSubmit(); }, { capture: true }));
  const onRequest = (request: import("@playwright/test").Request) => {
    if (!["GET", "HEAD"].includes(request.method())) mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
  };
  page.on("request", onRequest);
  try {
    await controls.getByLabel("Search filenames").fill("no-matching-D2-filename");
    await expect(article).toBeHidden();
    await expect(library.getByText("No documents match these filters.")).toBeVisible();
    await expect(fieldNode!.evaluate((element) => element.isConnected)).resolves.toBe(true);
    await controls.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(article).toBeVisible();
    await controls.getByText("Additional filters", { exact: true }).click();
    const artifactFilter = library.getByLabel("Artifact type").first();
    const artifactValue = await metadata.locator('select[name="documentType"]').inputValue();
    await artifactFilter.selectOption(artifactValue);
    await controls.getByLabel("Search filenames").fill("no-matching-D2-filename");
    await expect(article).toBeHidden();
    await controls.getByRole("button", { name: "All documents", exact: true }).click();
    await expect(artifactFilter).toHaveValue("all");
    await expect(controls.getByLabel("Search filenames")).toHaveValue("");
    await expect(article).toBeVisible();
    for (const name of ["Failed", "Needs review"]) {
      await controls.getByRole("button", { name, exact: true }).click();
      await expect(controls.getByLabel("Processing state")).toHaveValue(name === "Failed" ? "failed" : "needs_review");
    }
    await controls.getByRole("button", { name: "All documents", exact: true }).click();
    const rowDetails = article.locator("details[data-document-details]");
    await rowDetails.locator(":scope > summary").focus();
    await page.keyboard.press("Enter");
    await expect(field).toBeHidden();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.closest("details[data-document-details][open]") !== null)).toBe(false);
    await rowDetails.locator(":scope > summary").focus();
    await page.keyboard.press("Enter");
    await expect(field).toHaveValue("D2 unsaved workstream");
    for (const name of ["1. Siapkan evidence", "2. Baca & periksa", "3. Tinjau hasil"]) {
      await page.getByRole("navigation", { name: "Evidence steps" }).getByRole("button", { name, exact: true }).click();
      await expect(page.getByRole("button", { name, exact: true })).toHaveAttribute("aria-current", "step");
      const activePanel = name.startsWith("1.") ? "prepare" : name.startsWith("2.") ? "check" : "review";
      for (const panel of ["prepare", "check", "review"]) {
        if (panel === activePanel) await expect(page.locator(`#evidence-${panel}`)).toBeVisible();
        else await expect(page.locator(`#evidence-${panel}`)).toBeHidden();
      }
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.closest("[hidden]") !== null)).toBe(false);
      if (activePanel !== "check") await expect(page.getByRole("article")).toHaveCount(0);
    }
    await expect(rowNode!.evaluate((element, id) => element === document.getElementById(id!), articleId)).resolves.toBe(true);
    await expect(fieldNode!.evaluate((element) => element.isConnected)).resolves.toBe(true);
    await expect(library).toBeHidden();
    await expect(field).toHaveValue("D2 unsaved workstream");
    expect(await metadata.locator('input[type="hidden"]').evaluateAll((inputs) => inputs.map((input) => [(input as HTMLInputElement).name, (input as HTMLInputElement).value]))).toEqual(snapshot);
    expect(await uploadNode!.evaluate((element) => (element as HTMLInputElement).files?.[0]?.name)).toBe("d2-selection-only.txt");
    if (hasFact) {
      await page.getByRole("button", { name: "2. Baca & periksa", exact: true }).click();
      await expect(factInput).toHaveValue("D2 unsaved fact correction");
      expect(await factNode!.evaluate((element) => element.isConnected)).toBe(true);
      const source = page.getByRole("list", { name: "Fact sources" }).getByRole("button").first();
      if (await source.count()) {
        await controls.getByLabel("Search filenames").fill("no-matching-D2-filename");
        await source.click();
        // A loaded target is revealed; an unavailable target is explained without retrieval.
        await expect.poll(async () => await controls.getByLabel("Search filenames").inputValue() === "" || await page.getByText("This source document is not available in the loaded collection.").isVisible()).toBe(true);
      }
    }
    expect(submissions).toBe(0);
    expect(mutations).toEqual([]);
  } finally {
    await page.getByRole("button", { name: "2. Baca & periksa", exact: true }).click();
    page.off("request", onRequest);
    await controls.getByRole("button", { name: "All documents", exact: true }).click();
    await field.fill(originalWorkstream);
    if (hasFact) await factInput.fill(originalFactEdit);
    await upload.setInputFiles([]);
  }
}
