# 06: Overview period, freshness, and history presentation

**Authority:** [Governing specification](../xassurance-guided-inline-uiux-aligned.md), including its screen contracts, classification rules, batch dependencies, and approval gates. This ticket authorizes no implementation. Historical preservation against separate pre-revision originals remains unverified.

**Batch ownership:** D4: existing Assurance/Overview period/history presentation A.

**Classification/completion:** Presentation is A; local-only interaction is B; integration behavior is C and deferred. Verification inherits its subject classification. Uncertain behavior/data remains unverified. A/B completion never closes deferred C criteria.

**Purpose:** Make the reporting period, assessment time, upload time, and available history understandable using existing authoritative values.

## Eligible after separate batch approval
- [ ] [A] Clarify existing labels for reporting period, assessment time, and upload time when these values are supplied.
- [ ] [A] Explain the available historical context without calling a single period a trend.
- [ ] [A] Present existing comparison values with their supplied units, baseline, period, and source context.
- [ ] [A] Make unknown or unavailable period/history information explicit.

## Deferred
- [ ] [C — deferred] New freshness computation or association between current evidence and a successful analysis.
- [ ] [C — deferred] New period selection/persistence or comparison logic.
- [ ] [C — deferred] New cross-period comparable datasets or gap calculations.
- [ ] [C — deferred] Claims that newly uploaded evidence has or has not entered an assessment unless this is already supplied authoritatively.
- [ ] [C — deferred] Batch 1B consumer alignment.

**Acceptance boundary:** Copy and layout only for currently available fields. Do not derive freshness from upload timestamps, document counts, or local state; do not label a result current without authoritative data.

**Current contract:** Overview has review period, assessment metadata, and history, but no document upload timestamps. Do not add fetching to fill this gap. Timestamps, counts, and workflow labels do not establish freshness. Preserve Batch 1A safeguards without assuming migration deployment; authoritative freshness consumption remains Batch 1B/C.
