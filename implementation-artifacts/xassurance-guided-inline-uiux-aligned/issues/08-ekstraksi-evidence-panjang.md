# 08: Important evidence near the end of long documents

**Authority:** [Governing specification](../xassurance-guided-inline-uiux-aligned.md), including its screen contracts, classification rules, batch dependencies, and approval gates. This ticket authorizes no implementation. Historical preservation against separate pre-revision originals remains unverified.

**Batch ownership:** D2: existing Evidence quality warnings A only; extraction C remains deferred.

**Classification/completion:** Presentation is A; local-only interaction is B; integration behavior is C and deferred. Verification inherits its subject classification. Uncertain behavior/data remains unverified. A/B completion never closes deferred C criteria.

**Status for extraction behavior: DEFERRED — parser/extraction/worker work.**

**Purpose:** Avoid missing relevant Budget, Schedule, and Risk information because only an initial text prefix was read, while honestly exposing partial reading when the system can verify it.

## Out of scope for UI-only implementation
- [ ] [C — deferred] Parser, chunking, LLM, worker, token/context limits, extraction schema, OCR, or supported-format changes.
- [ ] [C — deferred] Reprocessing existing evidence or regenerating stored results/exports.
- [ ] [C — deferred] Inventing a partial-reading status when the current data does not expose one.

## Presentation-only allowance
- [ ] [A] Display existing partial-read/quality-warning metadata accurately if it is already available to the frontend.
- [ ] [A] Keep existing source, period, unit, and currency context visible where supplied.
- [ ] [A] Avoid claiming that all evidence was reviewed when the existing result explicitly says otherwise.

**Deferred verification:** [C — deferred] Long-document/table fixtures with important evidence near the end, preserving source/period/value context. This requires a separately approved extraction implementation and must not be represented as completed by UI work.
