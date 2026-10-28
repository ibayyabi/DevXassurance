import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  FileCheck2,
  LoaderCircle,
  ShieldAlert,
} from "lucide-react";

import {
  confirmAssuranceFinding,
  correctBudgetFinding,
  createAssuranceReview,
  runAssuranceAnalysis,
  updateAssuranceAction,
} from "@/features/assurance/actions/assurance-actions";
import { CostBaselinePanel } from "@/features/assurance/components/cost-baseline-panel";
import { WbsComparisonPanel } from "@/features/assurance/components/wbs-comparison-panel";
import type {
  CostBaseline,
  CostObservation,
  WbsMapping,
} from "@/features/assurance/lib/cost-evidence";
import { ProcessingRefresh } from "@/features/assurance/components/processing-refresh";
import type {
  AssuranceDocument,
  AssuranceFinding,
  AssuranceReview,
} from "@/features/assurance/lib/queries";
import { Button } from "@/components/ui/button";
import { ReviewEvidenceFilters } from "@/features/assurance/components/review-evidence-filters";
import { Input } from "@/components/ui/input";

const steps = ["Evidence", "Analysis", "Findings", "Actions", "Report"];

export function AssuranceWorkspace({
  projectId,
  review,
  documents,
  costObservations,
  costBaselines,
  wbsScopeLabels,
  wbsMappings,
  canApproveBaseline,
}: {
  projectId: string;
  review: AssuranceReview | null;
  documents: AssuranceDocument[];
  costObservations: CostObservation[];
  costBaselines: CostBaseline[];
  wbsScopeLabels: string[];
  wbsMappings: WbsMapping[];
  canApproveBaseline: boolean;
}) {
  const activeProcessing = documents.some((document) =>
    ["uploaded", "queued", "processing"].includes(document.processingStatus),
  );

  if (!review) {
    return (
      <section className="mx-auto max-w-3xl rounded-2xl border border-ui-border bg-surface p-6 shadow-sm md:p-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-plan-track text-ink-muted">
          <FileCheck2 className="h-6 w-6" />
        </div>
        <h2 className="mt-5 text-2xl font-semibold text-ink">
          Start one clear assurance review
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
          Choose the reporting month first. You will then connect the approved
          plan to current evidence and receive only three conditions: Budget,
          Schedule, and Risk.
        </p>
        <form action={createAssuranceReview} className="mt-6 flex max-w-md flex-col gap-3 sm:flex-row sm:items-end">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="flex-1 text-sm font-medium text-ink-muted">
            Reporting month
            <Input
              type="month"
              name="reportingMonth"
              defaultValue={new Date().toISOString().slice(0, 7)}
              required
              className="mt-1"
            />
          </label>
          <Button type="submit" className="bg-brand text-brand-foreground hover:bg-brand/90">
            Start review
            <ArrowRight className="h-4 w-4" />
          </Button>
        </form>
      </section>
    );
  }

  const baselineIds = new Set(
    review.documents
      .filter((item) => item.role === "baseline")
      .map((item) => item.documentId),
  );
  const currentIds = new Set(
    review.documents
      .filter((item) => item.role === "current")
      .map((item) => item.documentId),
  );
  const failedCount = documents.filter((document) => document.processingStatus === "failed").length;
  const selectedIds = new Set([...baselineIds, ...currentIds]);
  const unavailableSelectedCount = [...selectedIds].filter(
    (id) => !documents.some((document) => document.id === id && document.processingStatus === "completed"),
  ).length;
  const missingBaseline = baselineIds.size === 0;
  const missingCurrent = currentIds.size === 0;
  const reviewReady = unavailableSelectedCount === 0 && !missingBaseline && !missingCurrent;

  return (
    <div className="space-y-5">
      <ProcessingRefresh active={activeProcessing} />
      <ReviewHeader review={review} evidenceReady={reviewReady} />
      {!reviewReady && (
        <section className="rounded-xl border border-status-warn bg-status-warn-bg p-4 text-status-warn-text" role="status">
          <h2 className="font-semibold">Review evidence needs attention</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {missingBaseline && <li>Choose at least one completed Approved Baseline document.</li>}
            {missingCurrent && <li>Choose at least one completed Current Period document.</li>}
          </ul>
          <Link href={`/app/projects/${projectId}/documents`} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold underline underline-offset-4">
            Open Evidence Library <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      )}
      {unavailableSelectedCount > 0 && (
        <p className="rounded-lg bg-status-warn-bg p-3 text-sm text-status-warn-text" role="status">
          {unavailableSelectedCount} selected document(s) are unavailable. Retry or replace them in the Evidence Library.
        </p>
      )}
      {(failedCount > 0 || activeProcessing) && (
        <p className="rounded-lg bg-status-warn-bg p-3 text-sm text-status-warn-text" role="status">
          {failedCount > 0 ? `${failedCount} other file(s) failed` : "Some files are still processing"}; completed selected baseline/current evidence can still be reviewed.
        </p>
      )}

      <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <EvidenceStep
          projectId={projectId}
          review={review}
          documents={documents}
          baselineIds={baselineIds}
          currentIds={currentIds}
        />
        <AnalysisStep
          projectId={projectId}
          review={review}
          evidenceReady={reviewReady}
        />
      </section>

      <CostBaselinePanel
        projectId={projectId}
        observations={costObservations}
        baselines={costBaselines}
        canApprove={canApproveBaseline}
      />

      <WbsComparisonPanel
        projectId={projectId}
        review={review}
        wbsScopeLabels={wbsScopeLabels}
        wbsMappings={wbsMappings}
        canApprove={canApproveBaseline}
      />

      <FindingsStep
        projectId={projectId}
        review={review}
        evidenceReady={reviewReady}
        canCorrect={canApproveBaseline}
      />
      <ActionsStep projectId={projectId} review={review} />

      <section className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-ink-muted">Step 5, Report</p>
            <h2 className="mt-1 text-xl font-semibold text-ink">
              Prepare the management report
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-muted">
              Continue after reviewing the three conditions and assigning owners to required actions. The report uses this reporting period instead of mixing all project history.
            </p>
          </div>
          {reviewReady ? (
            <Button asChild className="shrink-0 bg-brand text-brand-foreground hover:bg-brand/90">
              <Link href={`/app/projects/${projectId}/reports?review=${review.id}`}>
                Continue to report <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          ) : (
            <Button disabled className="shrink-0">Resolve evidence requirements first</Button>
          )}
        </div>
      </section>
    </div>
  );
}


function ReviewHeader({ review, evidenceReady }: { review: AssuranceReview; evidenceReady: boolean }) {
  const currentIndex = evidenceReady
    ? Math.max(
        0,
        steps.findIndex((step) => step.toLowerCase() === review.currentStep),
      )
    : 0;

  return (
    <section className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium text-brand">Current review</p>
          <h2 className="mt-1 text-2xl font-semibold text-ink">
            {review.title}
          </h2>
        </div>
        <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold capitalize ${evidenceReady ? "bg-plan-track text-ink-muted" : "bg-status-warn-bg text-status-warn-text"}`}>
          {evidenceReady ? review.status.replaceAll("_", " ") : "Needs evidence"}
        </span>
      </div>
      <ol className="mt-5 grid gap-2 sm:grid-cols-5">
        {steps.map((step, index) => (
          <li
            key={step}
            className={`rounded-lg border px-3 py-2 text-sm font-medium ${
              index === currentIndex
                ? "border-brand bg-brand-soft text-brand"
                : index < currentIndex
                  ? "border-status-ok bg-status-ok-bg text-status-ok-text"
                  : "border-ui-border bg-base text-ink-muted"
            }`}
          >
            <span className="mr-2 text-xs">{index + 1}</span>
            {step}
          </li>
        ))}
      </ol>
    </section>
  );
}

function EvidenceStep({
  projectId,
  review,
  documents,
  baselineIds,
  currentIds,
}: {
  projectId: string;
  review: AssuranceReview;
  documents: AssuranceDocument[];
  baselineIds: Set<string>;
  currentIds: Set<string>;
}) {
  return (
    <section className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm">
      <p className="text-sm font-medium text-ink-muted">Step 1, Evidence</p>
      <h2 className="mt-1 text-lg font-semibold text-ink">
        Choose plan and current evidence
      </h2>
      <p className="mt-2 text-sm leading-6 text-ink-muted">
        Baseline means the approved plan. Current means evidence for this
        reporting month. Only completed documents can be selected.
      </p>


      {documents.length === 0 ? (
        <Link
          href={`/app/projects/${projectId}/documents`}
          className="mt-4 block rounded-xl border border-dashed border-ui-border bg-base p-4 text-sm font-medium text-ink hover:bg-plan-track"
        >
          Upload evidence before starting this review →
        </Link>
      ) : (
        <div className="mt-4 space-y-4">
          <ReviewEvidenceFilters
            projectId={projectId}
            review={review}
            documents={documents}
            baselineIds={baselineIds}
            currentIds={currentIds}
          />
          <Button asChild type="button" variant="outline">
            <Link href={`/app/projects/${projectId}/documents`}>Open Evidence Library</Link>
          </Button>
        </div>
      )}
    </section>
  );
}


function AnalysisStep({
  projectId,
  review,
  evidenceReady,
}: {
  projectId: string;
  review: AssuranceReview;
  evidenceReady: boolean;
}) {
  return (
    <section className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm">
      <p className="text-sm font-medium text-ink-muted">Step 2, Analysis</p>
      <h2 className="mt-1 text-lg font-semibold text-ink">
        Compare what the documents actually say
      </h2>
      <p className="mt-2 text-sm leading-6 text-ink-muted">
        AI extracts values and source excerpts. Fixed rules, not the model, then
        calculate the Budget, Schedule, and Risk condition.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <AnalysisDomain icon={CircleDollarSign} title="Budget" help="Accepted baseline vs reported EAC" />
        <AnalysisDomain icon={CalendarDays} title="Schedule" help="Baseline dates vs current forecast" />
        <AnalysisDomain icon={ShieldAlert} title="Risk" help="Current critical and uncontrolled risks" />
      </div>

      {review.analysisError && (
        <div className="mt-4 flex gap-2 rounded-lg border border-status-critical bg-status-critical-bg p-3 text-sm text-status-critical-text">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{review.analysisError}</p>
        </div>
      )}

      <form action={runAssuranceAnalysis} className="mt-4">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="reviewId" value={review.id} />
        <Button
          type="submit"
          disabled={!evidenceReady || review.status === "analyzing"}
          variant="outline"
          className="border-ui-border bg-surface text-ink hover:bg-plan-track"
        >
          {review.status === "analyzing" ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <FileCheck2 className="h-4 w-4" />
          )}
          {review.findings.length > 0 ? "Run analysis again" : "Run analysis"}
        </Button>
      </form>
    </section>
  );
}

function AnalysisDomain({
  icon: Icon,
  title,
  help,
}: {
  icon: typeof CircleDollarSign;
  title: string;
  help: string;
}) {
  return (
    <div className="rounded-xl border border-ui-border bg-base p-3">
      <Icon className="h-5 w-5 text-ink-muted" />
      <p className="mt-2 text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 text-xs leading-5 text-ink-muted">{help}</p>
    </div>
  );
}

function FindingsStep({
  projectId,
  review,
  evidenceReady,
  canCorrect,
}: {
  projectId: string;
  review: AssuranceReview;
  evidenceReady: boolean;
  canCorrect: boolean;
}) {
  return (
    <section className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm">
      <p className="text-sm font-medium text-ink-muted">Step 3, Findings</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="mt-1 text-lg font-semibold text-ink">
            Three conditions, with plain-language reasons
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            No health percentage. Missing evidence remains visibly incomplete.
          </p>
        </div>
        {evidenceReady && review.findings.length > 0 && (
          <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${overallTone(review.findings)}`}>
            {overallLabel(review.findings)}
          </span>
        )}
      </div>

      {!evidenceReady ? (
        <div className="mt-4 rounded-xl border border-dashed border-ui-border p-6 text-sm text-ink-muted">
          Findings are not current until completed Approved Baseline and Current Period evidence is available.
        </div>
      ) : review.findings.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-ui-border p-6 text-sm text-ink-muted">
          Save evidence and run the analysis to create findings.
        </div>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {review.findings.map((finding) => (
            <FindingCard
              key={finding.id}
              projectId={projectId}
              reviewId={review.id}
              finding={finding}
              canCorrect={canCorrect}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function FindingCard({
  projectId,
  reviewId,
  finding,
  canCorrect,
}: {
  projectId: string;
  reviewId: string;
  finding: AssuranceFinding;
  canCorrect: boolean;
}) {
  return (
    <article className="rounded-xl border border-ui-border p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold capitalize text-ink">{finding.domain}</p>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${conditionTone(finding.condition)}`}>
          {conditionLabel(finding.condition)}
        </span>
      </div>
      <h3 className="mt-4 font-semibold leading-6 text-ink">
        {finding.headline}
      </h3>
      <p className="mt-2 text-sm leading-6 text-ink-muted">{finding.explanation}</p>
      {finding.requiredEvidence.length > 0 && (
        <div className="mt-3 rounded-lg bg-base p-3 text-xs text-ink-muted">
          <p className="font-semibold">Still needed</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {finding.requiredEvidence.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      )}
      {finding.sourceExcerpts.length > 0 && (
        <details className="mt-3 rounded-lg border border-ui-border p-3 text-xs">
          <summary className="cursor-pointer font-semibold text-ink">View source excerpts</summary>
          <div className="mt-2 space-y-2 text-ink-muted">
            {finding.sourceExcerpts.map((source, index) => (
              <p key={`${source.role}-${index}`}>
                <span className="font-semibold capitalize text-ink">{source.role}:</span>{" "}
                {source.documentId ? (
                  <a
                    className="font-semibold text-brand underline"
                    href={`/app/projects/${projectId}/documents?document=${source.documentId}#document-${source.documentId}`}
                  >
                    {source.documentTitle ?? "Source document"}
                  </a>
                ) : null}
                {(source.pageNumber || source.sectionLabel) && (
                  <span>
                    {" · "}
                    {[source.pageNumber ? `page ${source.pageNumber}` : null, source.sectionLabel]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
                <br />
                {source.excerpt}
              </p>
            ))}
          </div>
        </details>
      )}
      {finding.domain === "budget" && (
        <BudgetCorrection
          projectId={projectId}
          reviewId={reviewId}
          finding={finding}
          canCorrect={canCorrect}
        />
      )}
      <form action={confirmAssuranceFinding} className="mt-4">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="reviewId" value={reviewId} />
        <input type="hidden" name="findingId" value={finding.id} />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={finding.confirmationState === "user_confirmed"}
        >
          <CheckCircle2 className="h-4 w-4" />
          {finding.confirmationState === "user_confirmed" ? "Confirmed" : "Confirm finding"}
        </Button>
      </form>
    </article>
  );
}

/**
 * A reviewer may correct the value used in assessment. The extracted values and
 * their citations above stay as extracted; the correction is recorded with who
 * made it and why.
 */
function BudgetCorrection({
  projectId,
  reviewId,
  finding,
  canCorrect,
}: {
  projectId: string;
  reviewId: string;
  finding: AssuranceFinding;
  canCorrect: boolean;
}) {
  const correction = finding.correction;
  const comparableBaseline =
    typeof finding.baselineValue?.amount === "number" &&
    typeof finding.baselineValue?.currency === "string";

  return (
    <div className="mt-3 rounded-lg border border-ui-border p-3 text-xs">
      {correction && (
        <div className="mb-3 rounded-md bg-base p-2 text-ink-muted">
          <p className="font-semibold text-ink">Assessed value corrected by a reviewer</p>
          <p className="mt-1">
            Now assessed against {String(correction.corrected_currency ?? "")}{" "}
            {String(correction.corrected_amount ?? "")}
            {finding.correctedAt ? ` · ${finding.correctedAt.slice(0, 10)}` : ""}
          </p>
          {finding.correctionReason && <p className="mt-1">Reason: {finding.correctionReason}</p>}
          <p className="mt-1">
            The extracted values and source citations above are unchanged.
          </p>
        </div>
      )}
      {!canCorrect ? null : !comparableBaseline ? (
        <p className="text-ink-muted">
          Accept a cost baseline before correcting the assessed value.
        </p>
      ) : (
        <form action={correctBudgetFinding} className="grid gap-2">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="reviewId" value={reviewId} />
          <input type="hidden" name="findingId" value={finding.id} />
          <p className="font-semibold text-ink">Correct the assessed EAC</p>
          <div className="grid gap-2 sm:grid-cols-[1fr_90px]">
            <Input
              name="correctedEacAmount"
              placeholder={
                typeof finding.currentValue?.amount === "number"
                  ? String(finding.currentValue.amount)
                  : "Reported EAC amount"
              }
              className="h-8"
            />
            <Input
              name="correctedCurrency"
              placeholder={String(finding.baselineValue?.currency ?? "CUR")}
              maxLength={3}
              className="h-8"
            />
          </div>
          <Input name="correctionReason" placeholder="Why this value is corrected" required className="h-8" />
          <Button type="submit" size="sm" variant="outline" className="w-fit">
            Save correction
          </Button>
        </form>
      )}
    </div>
  );
}

function ActionsStep({
  projectId,
  review,
}: {
  projectId: string;
  review: AssuranceReview;
}) {
  return (
    <section className="rounded-2xl border border-ui-border bg-surface p-5 shadow-sm">
      <p className="text-sm font-medium text-ink-muted">Step 4, Actions</p>
      <h2 className="mt-1 text-lg font-semibold text-ink">
        Turn important findings into owned work
      </h2>
      <p className="mt-2 text-sm text-ink-muted">
        Only Needs Attention or Critical findings create an action.
      </p>
      <div className="mt-4 grid gap-3">
        {review.actions.length === 0 ? (
          <p className="rounded-xl bg-base p-4 text-sm text-ink-muted">
            No action is required yet, or analysis has not been completed.
          </p>
        ) : (
          review.actions.map((action) => (
            <form
              key={action.id}
              action={updateAssuranceAction}
              className="grid gap-3 rounded-xl border border-ui-border p-4 lg:grid-cols-[1fr_220px_170px_170px_auto] lg:items-end"
            >
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="reviewId" value={review.id} />
              <input type="hidden" name="actionId" value={action.id} />
              <div>
                <p className="font-medium leading-6 text-ink">{action.title}</p>
                <p className="mt-1 text-xs font-medium capitalize text-status-warn-text">
                  {action.priority} priority
                </p>
              </div>
              <label className="text-xs font-medium text-ink-muted">
                Owner
                <Input name="ownerName" defaultValue={action.ownerName ?? ""} placeholder="Required" className="mt-1" />
              </label>
              <label className="text-xs font-medium text-ink-muted">
                Due date
                <Input name="dueDate" type="date" defaultValue={action.dueDate ?? ""} className="mt-1" />
              </label>
              <label className="text-xs font-medium text-ink-muted">
                Status
                <select name="status" defaultValue={action.status} className="mt-1 h-9 w-full rounded-md border border-ui-border bg-surface px-3 text-sm">
                  <option value="open">Open</option>
                  <option value="in_progress">In progress</option>
                  <option value="completed">Completed</option>
                  <option value="deferred">Deferred</option>
                </select>
              </label>
              <Button type="submit" variant="outline">Save</Button>
            </form>
          ))
        )}
      </div>
    </section>
  );
}

function conditionLabel(condition: AssuranceFinding["condition"]) {
  if (condition === "on_track") return "On Track";
  if (condition === "needs_attention") return "Needs Attention";
  if (condition === "critical") return "Critical";
  return "More Evidence Required";
}

function conditionTone(condition: AssuranceFinding["condition"]) {
  if (condition === "on_track") return "bg-status-ok-bg text-status-ok-text";
  if (condition === "needs_attention") return "bg-status-warn-bg text-status-warn-text";
  if (condition === "critical") return "bg-status-critical-bg text-status-critical-text";
  return "bg-plan-track text-ink-muted";
}

function overallLabel(findings: AssuranceFinding[]) {
  if (findings.some((finding) => finding.condition === "more_evidence_required")) return "Review Incomplete";
  if (findings.some((finding) => finding.condition === "critical")) return "Critical";
  if (findings.some((finding) => finding.condition === "needs_attention")) return "Needs Attention";
  return "On Track";
}

function overallTone(findings: AssuranceFinding[]) {
  const label = overallLabel(findings);
  if (label === "On Track") return "bg-status-ok-bg text-status-ok-text";
  if (label === "Needs Attention") return "bg-status-warn-bg text-status-warn-text";
  if (label === "Critical") return "bg-status-critical-bg text-status-critical-text";
  return "bg-plan-track text-ink-muted";
}
