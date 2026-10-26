# 05: Cut Over Assurance to Evidence-Backed Results

**What to build:** PMO Assurance uses the domain-contract results as its single source of truth after Budget, WBS/scope, Schedule/progress, and Risk are available; unrelated summary/advisor paths continue to work.

**Blocked by:** 01: Project-Level Budget Assurance; 02: WBS Cost and Scope Comparison; 03: Schedule and Progress Assurance; 04: Risk Snapshot Comparison.

**Status:** ready-for-agent

- [ ] The existing Assurance page displays separate Budget, Schedule, and Risk results, findings, evidence gaps, and source citations; it does not calculate one combined project score.
- [ ] Assurance no longer depends on the old generic extraction/output path or emits unsupported AI-generated action suggestions or a separate downloadable report.
- [ ] Remove obsolete assurance-only extraction paths after all Assurance consumers use the domain contracts; retain parser/OCR, source-located chunks, and unrelated summary/advisor behavior.
- [ ] Missing EAC never falls back to actual cost, and non-comparable currency/WBS/schedule evidence remains explicitly marked rather than silently omitted.
- [ ] End-to-end checks cover the upload-to-Assurance path and verify unrelated document summary/advisor behavior remains intact.
