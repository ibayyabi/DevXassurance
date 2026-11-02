# 07: Report completeness, freshness, and approval presentation

**Authority:** [Governing specification](../xassurance-guided-inline-uiux-aligned.md), including its screen contracts, classification rules, batch dependencies, and approval gates. This ticket authorizes no implementation. Historical preservation against separate pre-revision originals remains unverified.

**Batch ownership:** D3: lifecycle labels/counts A and local dirty indicator B.

**Classification/completion:** Presentation is A; local-only interaction is B; integration behavior is C and deferred. Verification inherits its subject classification. Uncertain behavior/data remains unverified. A/B completion never closes deferred C criteria.

**Purpose:** Help users understand the existing report lifecycle without changing it: draft, saved edits, approval, file creation, and download are distinct stages.

## Eligible after separate batch approval
- [ ] [A] Clarify existing lifecycle labels and disabled-action explanations using current props/state.
- [ ] [B] Add a client-side unsaved-edit indicator by comparing editor values with the saved values already available in the component.
- [ ] [A] Use accurate labels such as “Generated files” where the UI lists created exports rather than verified downloads.
- [ ] [A] Display preview-specific counts only where those counts are already supplied; otherwise label project-wide counts accurately.
- [ ] [A] Preserve existing edit controls, approval, export, and download behavior.

## Deferred
- [ ] [C — deferred] New completeness/freshness calculations or authoritative draft-to-analysis association.
- [ ] [C — deferred] Server-side approval/freshness guards or changes to existing guards.
- [ ] [C — deferred] New approval gating, atomic save-and-approve, changed export behavior, or lifecycle rules.
- [ ] [C — deferred] Automatic merging/preservation logic for reviewer edits.

**Acceptance boundary:** An unsaved indicator must reflect actual local comparison and clear when values match saved props. Do not claim save success before the existing operation reports it. Do not change payloads, server actions, approval/export rules, or existing exported files.

**Safeguards:** Preserve Batch 1A guards; deployment is unverified. Existing timestamp comparisons and readiness labels do not prove freshness. Dirty state clears when editor values match saved props, never merely on Save click. Preserve mounted editor state, field names, and separate save/approve/export actions. Per-answer Advisor sources are a separate audit-origin D3 A item using existing message associations.
