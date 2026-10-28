# 05: Review evidence role and reporting-period suggestions

**Authority:** [Governing specification](../xassurance-guided-inline-uiux-aligned.md), including its screen contracts, classification rules, batch dependencies, and approval gates. This ticket authorizes no implementation. Historical preservation against separate pre-revision originals remains unverified.

**Batch ownership:** D2: existing metadata suggestions/rationale/sources A; preserve existing correction forms and save behavior.

**Classification/completion:** Presentation is A; local-only interaction is B; integration behavior is C and deferred. Verification inherits its subject classification. Uncertain behavior/data remains unverified. A/B completion never closes deferred C criteria.

**Purpose:** Help users understand detected evidence role/period, why it was detected, and which source supports it.

## Eligible after separate batch approval
- [ ] [A] Improve presentation of existing evidence role, reporting period, detection rationale, source references, and ambiguity.
- [ ] [A] Clearly distinguish an evidence role (approved plan/current/supporting) from the user's access role.
- [ ] [A] Make uncertain suggestions visually understandable without claiming certainty.
- [ ] [A] Keep source context discoverable and preserve existing keyboard/accessibility behavior.

## Deferred
- [ ] [C — deferred] New or changed persisted correction, save/cancel mutations, and reload-persistence behavior; preserve existing forms and save behavior.
- [ ] [C — deferred] Permission logic or server-action changes.
- [ ] [C — deferred] Protecting user overrides from future classification.
- [ ] [C — deferred] Triggering reassessment and marking prior results stale.

**Acceptance boundary:** Do not show a Save action that only updates client state while implying it is persisted. Do not change document dates to make evidence fit a period. New or changed correction behavior and reassessment require separate integration approval. Preserve existing forms, field names, actions, permissions, and current save behavior; do not remove, replace, or simulate them. Generic classification rationale does not establish field-specific provenance.
