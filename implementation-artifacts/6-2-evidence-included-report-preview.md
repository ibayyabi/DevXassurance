---
baseline_commit: NO_VCS
---

# Story 6.2: Evidence-Included Report Preview

Status: review

## Story

As a PMC/PMO user,
I want to preview generated report content and included evidence,
so that I can review before export.

## Acceptance Criteria

1. Given processed evidence, findings, and recommendations exist, when the report preview is generated, then it includes project health, key findings, critical risks, governance gaps, recommended actions, and included evidence counts.
2. Given generated content is AI-produced, when it appears in preview, then the UI distinguishes draft AI-generated content from user-edited content.

## Tasks / Subtasks

- [x] Add report preview generation job/output model (AC: 1, 2)
  - [x] Store report type, settings, generated sections, included evidence counts, and review state.
- [x] Implement report preview generation boundary (AC: 1)
  - [x] Use processed evidence, anomalies, recommendations, and evidence links.
  - [x] Store provenance for generated sections.
- [x] Build preview UI (AC: 1, 2)
  - [x] Show status cards, key findings, critical risks, recommendations.
  - [x] Display draft AI-generated vs user-edited state.
- [x] Build Included Evidence panel (AC: 1)

## Dev Notes

- Depends on Story 6.1, Epic 2 evidence, Epic 3 dashboard data, and Epic 4 anomalies/actions.
- Do not export final files here; Story 6.3 owns export.

### UX Guardrails

- Preview should resemble the supplied report screenshot: report selector, preview, evidence/settings panel.
- AI-generated report sections must be visibly reviewable.

### Testing Requirements

- Preview includes expected sections when source data exists.
- Included evidence counts render.
- AI-generated state is distinguishable from user-edited state.

### References

- `planning-artifacts/epics.md` - Story 6.2
- `planning-artifacts/architecture.md` - Report Generation, Evidence Provenance Pattern

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Git baseline unavailable because repository has no commits yet; recorded `baseline_commit: NO_VCS`.
- Added `report_previews` schema with report type, settings, generated sections, evidence counts, provenance, and review state.
- Added preview generation action using dashboard health, anomalies, recommendations, documents, and chunks.
- Added preview editor showing generated sections and draft/user-edited state.
- Added Included Evidence panel showing source counts.
- `npm test` passed.
- `npm run lint` passed.
- `npm run build` passed.

### Completion Notes List

- Preview generation is evidence/read-model based and stores provenance labels for generated sections.
- Missing source data renders explicit insufficient/no-data section text rather than unsupported claims.
- AI-generated vs user-edited state is visible through `review_state`.

### File List

- `supabase/migrations/202606080007_report_generation.sql`
- `src/features/reports/actions/report-actions.ts`
- `src/features/reports/components/report-workspace.tsx`
- `src/features/reports/lib/queries.ts`
- `tests/integration/epic-6-reports.test.mjs`

### Change Log

- 2026-06-08: Implemented report preview model, generation boundary, generated section preview, provenance, review state, and evidence counts panel.
