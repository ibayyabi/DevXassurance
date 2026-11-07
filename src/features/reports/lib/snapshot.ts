// Snapshot identity and draft content for a management report. Everything in
// this module is pure: the draft sections and the persisted manifest are built
// from one snapshot descriptor, so a report can be re-derived from its stored
// manifest without reading any live evidence.
export const reportSectionKeys = [
  "project_health",
  "key_findings",
  "critical_risks",
  "recommended_actions",
] as const;

export type ReportSectionKey = (typeof reportSectionKeys)[number];
export type ReportSections = Record<ReportSectionKey, string>;

/** A published assessment result a report is pinned to. */
export type ReportSnapshotRef = {
  /**
   * Identity of the published snapshot. Today the assessment stream publishes
   * one version per successful analysis attempt, so this is the attempt id.
   */
  snapshotId: string;
  /** Assurance review whose cut-off and evidence binding produced the snapshot. */
  reviewId: string;
  /** Review cut-off as YYYY-MM-DD. Never derived from upload or file metadata. */
  cutoff: string;
  /** Published version of the snapshot; differs whenever the assessment is refreshed. */
  version: string;
  /** Display period derived from the cut-off. */
  reportingPeriod: string;
  publishedAt: string | null;
};

export type ReportSnapshotValue = {
  domain: string;
  condition: string;
  headline: string;
  explanation: string;
  confirmationState: string;
};

/** A domain the snapshot could not assess. It is a limitation, not a zero. */
export type ReportSnapshotGap = { domain: string; reason: string };

/**
 * Concrete origin of the snapshot. Document entries carry the evidence
 * document identity and the source version it was read at, so a draft cites
 * real rows instead of a table name.
 */
export type ReportSnapshotSource = {
  label: string;
  source: string;
  documentId?: string;
  documentName?: string;
  evidenceRole?: string;
  contentHash?: string | null;
  parserVersion?: string | null;
  contractVersion?: string | null;
};

export type ReportSnapshotAction = {
  title: string;
  ownerName: string | null;
  dueDate: string | null;
  status: string;
};

export type ReportSnapshot = {
  evidenceCount: number;
  values: ReportSnapshotValue[];
  gaps: ReportSnapshotGap[];
  actions: ReportSnapshotAction[];
  sources: ReportSnapshotSource[];
} & ReportSnapshotRef;

/** Frozen structured source of a draft, stored so history never depends on live tables. */
export type ReportManifest = {
  snapshotId: string;
  snapshotCutoff: string;
  snapshotVersion: string;
  cutoffLabel: string;
  reviewId: string;
  audience: string;
  detailLevel: string;
  evidenceCount: number;
  values: ReportSnapshotValue[];
  gaps: ReportSnapshotGap[];
  actions: ReportSnapshotAction[];
  sources: ReportSnapshotSource[];
};

export type ReportBuild = {
  sections: ReportSections;
  counts: Record<string, number>;
};

export function conditionLabel(value: string) {
  if (value === "on_track") return "On Track";
  if (value === "needs_attention") return "Needs Attention";
  if (value === "critical") return "Critical";
  return "More Evidence Required";
}

/**
 * Library title from a YYYY-MM-DD cut-off, e.g. "October 2026". The report is
 * labelled by the cut-off it covers, not by when it was generated.
 */
export function formatReportPeriod(cutoff: string) {
  const date = new Date(`${cutoff}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return cutoff;
  return new Intl.DateTimeFormat("en", {
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}

export function buildReportSections(
  snapshot: ReportSnapshot,
  options: { audience: string; detailLevel: string },
): ReportBuild {
  const { values, gaps, actions } = snapshot;

  // Never a combined project condition: CONTEXT.md forbids one, and each domain
  // keeps its own assessed condition or its own gap.
  const healthLines = values.map(
    (value) =>
      `${titleCase(value.domain)} - ${conditionLabel(value.condition)}: ${value.headline}`,
  );
  const health = [
    `Reporting period: ${snapshot.reportingPeriod} (cut-off ${snapshot.cutoff})`,
    `Snapshot: ${snapshot.snapshotId} (version ${snapshot.version})`,
    `Evidence in this snapshot: ${snapshot.evidenceCount} document(s)`,
    "",
    healthLines.length > 0
      ? healthLines.join("\n")
      : "No domain in this snapshot could be assessed from the published evidence.",
  ];
  if (gaps.length > 0) {
    health.push(
      "",
      "Evidence limitations in this snapshot:",
      ...gaps.map((gap) => `- ${titleCase(gap.domain)}: ${gap.reason}`),
    );
  }

  const findingBlocks = values.map((value) =>
    options.detailLevel === "Executive Summary"
      ? `${titleCase(value.domain)} - ${conditionLabel(value.condition)}: ${value.headline}`
      : `${titleCase(value.domain)} (${conditionLabel(value.condition)}): ${value.explanation || value.headline}`,
  );
  findingBlocks.push(...gaps.map((gap) => `Gap - ${titleCase(gap.domain)}: ${gap.reason}`));
  if (findingBlocks.length === 0) {
    findingBlocks.push("No finding is recorded in this snapshot.");
  }
  if (options.detailLevel === "Detailed") {
    findingBlocks.push(
      "",
      "Sources of this snapshot:",
      ...snapshot.sources.map(describeSource),
    );
  }

  const critical = values.filter((value) => value.condition === "critical");
  const criticalRisks =
    critical.length > 0
      ? critical
          .map((value) =>
            options.detailLevel === "Executive Summary"
              ? `${titleCase(value.domain)}: ${value.headline}`
              : `${titleCase(value.domain)}: ${value.explanation || value.headline}`,
          )
          .join("\n\n")
      : // An empty list is a limitation of this snapshot, not a risk clearance.
        "No critical condition is supported by the evidence in this snapshot; this does not establish that no critical risk exists.";

  const recommendedActions =
    actions.length > 0
      ? actions
          .map(
            (action) =>
              `${action.title} - owner: ${action.ownerName ?? "not recorded"}; due: ${action.dueDate ?? "not recorded"}; status: ${action.status}`,
          )
          .join("\n")
      : "No action is recorded in this snapshot.";

  return {
    sections: {
      project_health: health.join("\n"),
      key_findings: findingBlocks.join("\n\n"),
      critical_risks: criticalRisks,
      recommended_actions: recommendedActions,
    },
    counts: {
      snapshot_documents: snapshot.evidenceCount,
      assessed_domains: values.length,
      evidence_gaps: gaps.length,
      critical_conditions: critical.length,
      actions: actions.length,
      confirmed_findings: values.filter(
        (value) => value.confirmationState === "user_confirmed",
      ).length,
    },
  };
}

/**
 * Rebuild a snapshot descriptor from its persisted manifest. Draft history is
 * rendered from this, so a report stays readable after the assessment moved on.
 */
export function snapshotFromManifest(
  manifest: Partial<ReportManifest> | null | undefined,
): ReportSnapshot | null {
  if (!manifest?.snapshotId || !manifest.snapshotCutoff || !manifest.snapshotVersion) {
    return null;
  }
  return {
    snapshotId: manifest.snapshotId,
    reviewId: manifest.reviewId ?? "",
    cutoff: manifest.snapshotCutoff,
    version: manifest.snapshotVersion,
    reportingPeriod: manifest.cutoffLabel || formatReportPeriod(manifest.snapshotCutoff),
    publishedAt: null,
    evidenceCount: manifest.evidenceCount ?? 0,
    values: manifest.values ?? [],
    gaps: manifest.gaps ?? [],
    actions: manifest.actions ?? [],
    sources: manifest.sources ?? [],
  };
}

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * A document source is cited by its evidence identity and the content hash it
 * was read at, so a distributed draft cannot be traced only to a table name.
 */
function describeSource(source: ReportSnapshotSource) {
  if (!source.documentId) return `- ${source.label}: ${source.source}`;
  const sourceVersion = source.contentHash
    ? `${source.contentHash.slice(0, 12)} (${source.parserVersion ?? "parser not recorded"})`
    : "version not recorded";
  return `- ${source.label}: ${source.documentName ?? source.source} [${source.evidenceRole ?? "role not recorded"}] ${source.source} — ${sourceVersion}`;
}
