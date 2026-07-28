"use client";

import { BrainCircuit, CheckCircle2, LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { refreshAutomaticAssurance } from "@/features/assurance/actions/assurance-actions";
import type { EvidenceDocument } from "@/features/documents/lib/queries";

type State = "waiting" | "organizing" | "ready" | "error";

export function AutomaticAssessment({
  projectId,
  documents,
  assessedFingerprint,
}: {
  projectId: string;
  documents: EvidenceDocument[];
  assessedFingerprint: string | null;
}) {
  const router = useRouter();
  const attemptedFingerprint = useRef<string | null>(null);
  const completedIds = useMemo(
    () =>
      documents
        .filter((document) => document.processingStatus === "completed")
        .map((document) => document.id)
        .sort(),
    [documents],
  );
  const fingerprint = completedIds.join(":");
  const processing = documents.some((document) =>
    ["uploaded", "queued", "processing"].includes(document.processingStatus),
  );
  const alreadyAssessed = Boolean(
    fingerprint && fingerprint === assessedFingerprint,
  );
  const [state, setState] = useState<State>(
    alreadyAssessed ? "ready" : processing ? "waiting" : "organizing",
  );
  const [message, setMessage] = useState(
    alreadyAssessed
      ? "All ready documents are included in the latest project assessment."
      : "The assessment starts after document processing finishes.",
  );

  useEffect(() => {
    if (alreadyAssessed) {
      setState("ready");
      setMessage("All ready documents are included in the latest project assessment.");
      return;
    }
    if (processing || completedIds.length === 0) {
      setState("waiting");
      setMessage(
        completedIds.length === 0
          ? "Upload documents to start the automatic project assessment."
          : "Waiting for every uploaded document to finish processing.",
      );
      return;
    }
    if (attemptedFingerprint.current === fingerprint) return;

    attemptedFingerprint.current = fingerprint;
    setState("organizing");
    setMessage(
      "AI is classifying the documents, selecting evidence, and calculating the project condition.",
    );

    void refreshAutomaticAssurance(projectId)
      .then((result) => {
        setState(result.ok ? "ready" : "error");
        setMessage(result.message);
        if (result.ok) router.refresh();
      })
      .catch((error: unknown) => {
        setState("error");
        setMessage(
          error instanceof Error
            ? error.message
            : "Automatic assessment could not be completed.",
        );
      });
  }, [
    alreadyAssessed,
    completedIds.length,
    fingerprint,
    processing,
    projectId,
    router,
  ]);

  const Icon =
    state === "ready"
      ? CheckCircle2
      : state === "error"
        ? TriangleAlert
        : state === "organizing"
          ? LoaderCircle
          : BrainCircuit;
  const tone =
    state === "ready"
      ? "border-status-ok bg-status-ok-bg text-status-ok-text"
      : state === "error"
        ? "border-status-critical bg-status-critical-bg text-status-critical-text"
        : state === "organizing"
          ? "border-status-warn bg-status-warn-bg text-status-warn-text"
          : "border-ui-border bg-plan-track text-ink-muted";

  return (
    <section className={`rounded-2xl border p-4 ${tone}`} aria-live="polite">
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-surface p-2 shadow-sm">
          <Icon
            className={`h-5 w-5 ${state === "organizing" ? "animate-spin" : ""}`}
          />
        </span>
        <div>
          <h2 className="font-semibold">
            {state === "ready"
              ? "Project assessment is ready"
              : state === "error"
                ? "Assessment needs attention"
                : state === "organizing"
                  ? "Building the project assessment"
                  : "Automatic assessment is waiting"}
          </h2>
          <p className="mt-1 text-sm leading-6 opacity-80">{message}</p>
        </div>
      </div>
    </section>
  );
}
