import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReportSections,
  snapshotFromManifest,
} from "../../src/features/reports/lib/snapshot.ts";

function snapshot(overrides = {}) {
  return {
    snapshotId: "attempt-1",
    reviewId: "review-1",
    cutoff: "2026-10-16",
    version: "attempt-1",
    reportingPeriod: "October 2026",
    publishedAt: "2026-10-17T00:00:00.000Z",
    evidenceCount: 2,
    values: [
      {
        domain: "budget",
        condition: "on_track",
        headline: "Reported EAC matches the approved baseline",
        explanation: "Variance is within the approved range.",
        confirmationState: "ai_extracted",
      },
    ],
    gaps: [{ domain: "risk", reason: "Risk log for the period was not published" }],
    actions: [],
    sources: [{ label: "Assessment snapshot", source: "assurance_reviews:review-1#attempt-1" }],
    ...overrides,
  };
}

const options = { audience: "PMO", detailLevel: "Standard" };

test("a draft never states a combined project condition", () => {
  const withEverythingCritical = snapshot({
    values: [
      { domain: "budget", condition: "critical", headline: "Overrun", explanation: "Above baseline", confirmationState: "ai_extracted" },
      { domain: "schedule", condition: "on_track", headline: "On schedule", explanation: "No delay", confirmationState: "ai_extracted" },
      { domain: "risk", condition: "needs_attention", headline: "Open risk", explanation: "Rising", confirmationState: "ai_extracted" },
    ],
    gaps: [],
  });
  const build = buildReportSections(withEverythingCritical, options);
  const everything = Object.values(build.sections).join("\n");
  assert.doesNotMatch(everything, /overall condition/i);
  assert.doesNotMatch(everything, /overall status/i);
  assert.match(build.sections.project_health, /Budget - Critical: Overrun/);
  assert.match(build.sections.project_health, /Schedule - On Track: On schedule/);
  assert.match(build.sections.project_health, /Risk - Needs Attention: Open risk/);
});

test("empty sections are limitations, never risk or action clearance", () => {
  const build = buildReportSections(
    snapshot({ values: [], gaps: [{ domain: "budget", reason: "No baseline for the period" }], actions: [] }),
    options,
  );
  // An empty critical list must not read as "there is no risk".
  assert.match(build.sections.critical_risks, /no critical condition is supported by the evidence/i);
  assert.match(build.sections.critical_risks, /does not establish that no critical risk exists/i);
  assert.match(build.sections.recommended_actions, /no action is recorded in this snapshot/i);
  assert.doesNotMatch(build.sections.recommended_actions, /not required|no action required/i);
  assert.match(build.sections.key_findings, /Gap - Budget: No baseline for the period/);
  assert.match(build.sections.project_health, /Evidence limitations in this snapshot:/);
});

test("a draft names the snapshot and cut-off it was built from", () => {
  const build = buildReportSections(snapshot(), options);
  assert.match(build.sections.project_health, /Reporting period: October 2026 \(cut-off 2026-10-16\)/);
  assert.match(build.sections.project_health, /Snapshot: attempt-1 \(version attempt-1\)/);
  assert.match(build.sections.project_health, /Evidence in this snapshot: 2 document\(s\)/);
  assert.deepEqual(build.manifest.values, snapshot().values);
  assert.deepEqual(build.manifest.gaps, snapshot().gaps);
  assert.equal(build.manifest.snapshotVersion, "attempt-1");
});

test("a stored draft re-derives from its persisted manifest after later evidence", () => {
  const original = buildReportSections(snapshot(), options);
  // The snapshot the assessment publishes next is a different version; the
  // stored manifest must still produce the original draft text.
  const stored = JSON.parse(JSON.stringify(original.manifest));
  const rehydrated = snapshotFromManifest(stored);
  assert.ok(rehydrated);
  const reread = buildReportSections(rehydrated, {
    audience: stored.audience,
    detailLevel: stored.detailLevel,
  });
  assert.deepEqual(reread.sections, original.sections);
  assert.equal(reread.manifest.snapshotVersion, "attempt-1");
});

test("detail level changes verbosity without changing the pinned snapshot", () => {
  const full = snapshot();
  const executive = buildReportSections(full, { audience: "Sponsor", detailLevel: "Executive Summary" });
  const detailed = buildReportSections(full, { audience: "Sponsor", detailLevel: "Detailed" });
  assert.doesNotMatch(executive.sections.key_findings, /Variance is within the approved range/);
  assert.match(detailed.sections.key_findings, /Variance is within the approved range/);
  assert.match(detailed.sections.key_findings, /assurance_reviews:review-1#attempt-1/);
  assert.equal(executive.manifest.snapshotId, detailed.manifest.snapshotId);
  assert.equal(executive.manifest.snapshotVersion, detailed.manifest.snapshotVersion);
});
