---
baseline_commit: NO_VCS
---

# Story 5.3: Suggested Prompts and Recommendations Panel

Status: review

## Story

As a project user,
I want suggested prompts and next actions,
so that I can quickly ask useful project assurance questions.

## Acceptance Criteria

1. Given the assistant page loads, when no question is active, then suggested prompts are visible for project health, escalation, and weekly risk summary.
2. Given the assistant identifies recommended actions, when the answer renders, then next actions appear with owner/priority where available and source evidence links.

## Tasks / Subtasks

- [x] Add suggested prompts panel (AC: 1)
  - [x] Include prompts for "Why is the project Amber?", escalation, and weekly risks.
  - [x] Clicking prompt populates/submits the assistant input.
- [x] Add recommendations/next actions panel (AC: 2)
  - [x] Show owner and priority where available.
  - [x] Include source evidence links.
- [x] Add empty and loading behavior (AC: 1, 2)

## Dev Notes

- Depends on Stories 5.1 and 5.2.
- Prompt labels can be static initially but must be project-scoped in behavior.
- Next actions should reuse recommendations/action data where available; do not create a parallel action model.

### UX Guardrails

- Suggested prompts are right-side panel items with arrow affordance.
- Recommendations panel uses compact rows and severity/priority tags.

### Testing Requirements

- Suggested prompt populates or submits query.
- Recommendations show owner/priority/source if returned.
- No recommendations renders a calm empty state.

### References

- `planning-artifacts/epics.md` - Story 5.3
- `planning-artifacts/ux-designs/ux-x-assurance-2026-06-08/EXPERIENCE.md` - AI Assistant

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Git baseline unavailable because repository has no commits yet; recorded `baseline_commit: NO_VCS`.
- Added suggested prompts panel with health, escalation, and weekly risk prompts.
- Prompt click populates the chat input.
- Added Recommendations / Next Actions panel from project `recommended_actions`.
- Added owner, priority, and source links for returned recommendations.
- Added empty and loading states.
- `npm test` passed.
- `npm run lint` passed.
- `npm run build` passed.

### Completion Notes List

- Suggested prompts are static labels but project-scoped in behavior because they submit through the project route/action.
- Recommendations reuse the existing `recommended_actions` model rather than creating a parallel assistant action model.
- Empty recommendation/source states are calm and non-blocking.

### File List

- `src/features/assistant/actions/assistant-actions.ts`
- `src/features/assistant/components/assistant-chat.tsx`
- `src/features/assistant/lib/types.ts`
- `tests/integration/epic-5-assistant.test.mjs`

### Change Log

- 2026-06-08: Implemented suggested prompts, prompt-to-input behavior, recommendations panel, source links, empty/loading states, and tests.
