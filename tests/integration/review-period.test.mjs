import assert from "node:assert/strict";
import test from "node:test";

import {
  formatReportingPeriod,
  reportingPeriodEnd,
} from "../../src/features/assurance/lib/review-period.ts";

test("reportingPeriodEnd returns the cut-off date itself, not the month end", () => {
  assert.equal(reportingPeriodEnd("2026-10-16"), "2026-10-16");
  assert.equal(reportingPeriodEnd("2026-01-31"), "2026-01-31");
  assert.equal(reportingPeriodEnd("2026-02-01"), "2026-02-01");
});

test("reportingPeriodEnd preserves legacy month scope", () => {
  assert.equal(reportingPeriodEnd("2026-10-01", "month"), "2026-10-31");
  assert.equal(reportingPeriodEnd("2026-02-01", "month"), "2026-02-28");
  assert.equal(reportingPeriodEnd("2026-10-01", "date"), "2026-10-01");
});

test("formatReportingPeriod renders an Indonesian date from the cut-off", () => {
  assert.equal(formatReportingPeriod("2026-10-16"), "16 Oktober 2026");
  assert.equal(formatReportingPeriod("2026-02-01"), "1 Februari 2026");
});
