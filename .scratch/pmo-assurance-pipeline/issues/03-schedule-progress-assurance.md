# 03: Schedule and Progress Assurance

**What to build:** A PMO reviewer can compare approved milestone/work-package dates with explicitly reported forecast dates and inspect reported progress in the selected review period, without the system inventing schedule predictions.

**Blocked by:** 01: Project-Level Budget Assurance; 02: WBS Cost and Scope Comparison.

**Status:** ready-for-agent

- [ ] Compare baseline and reported forecast dates only for the same milestone or work package; missing forecast dates remain evidence gaps.
- [ ] Differently named milestones can be proposed as a source-backed mapping and used only after reviewer approval; accepted mappings are reusable within project scope.
- [ ] Progress percentages are preserved as reported at project/WBS level and are not aggregated from WBS percentages or converted into forecast dates.
- [ ] Compare progress across periods only when scope and WBS are comparable; preserve each source period/as-of date and use the PMO-selected review period.
- [ ] For comparable schedule evidence, status uses the agreed thresholds: 0 days late on track, 1–14 days needs attention, and > 14 days critical.
- [ ] The existing Assurance page shows schedule/progress results with exact source citations and evidence gaps.
