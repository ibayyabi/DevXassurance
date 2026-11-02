# 04: Assessment continues after leaving Evidence

**Authority:** [Governing specification](../xassurance-guided-inline-uiux-aligned.md), including its screen contracts, classification rules, batch dependencies, and approval gates. This ticket authorizes no implementation. Historical preservation against separate pre-revision originals remains unverified.

**Batch ownership:** D1: truthful stage wording A only; background behavior C remains deferred.

**Classification/completion:** Presentation is A; local-only interaction is B; integration behavior is C and deferred. Verification inherits its subject classification. Uncertain behavior/data remains unverified. A/B completion never closes deferred C criteria.

**Status for background behavior: DEFERRED — backend/job-orchestration work.**

**Purpose:** Ensure a real assessment continues after upload is accepted even if the user leaves Evidence or closes the tab, and that results are available on return.

## Out of scope for UI-only implementation
- [ ] [C — deferred] Changing triggers, workers, polling, job infrastructure, event handling, idempotency, or persistence.
- [ ] [C — deferred] Introducing new persistent job/assessment states or changing failure/retry behavior.
- [ ] [C — deferred] Claiming that leaving the page does not interrupt assessment unless this behavior has already been verified in the live implementation.

## Presentation-only allowance
- [ ] [A] Correct existing labels for file acceptance, extraction, and assessment stages where each state is already provided by the application.
- [ ] [A] Explain the currently verified behavior without implying unsupported background processing.
- [ ] [A] Preserve existing files/results and current recovery controls.

**Deferred verification:** [C — deferred] Real upload → leave Evidence → return through Overview, including duplicate events and assessment failure. This requires the backend implementation and integration approval, not this UI-only batch.
