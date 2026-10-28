# 03: Budget, Schedule, and Risk evidence readiness presentation

**Authority:** [Governing specification](../xassurance-guided-inline-uiux-aligned.md), including its screen contracts, classification rules, batch dependencies, and approval gates. This ticket authorizes no implementation. Historical preservation against separate pre-revision originals remains unverified.

**Batch ownership:** D4: existing Assurance/Overview domain presentation A. D2 may clarify existing Evidence facts/sources A, not add domain findings.

**Classification/completion:** Presentation is A; local-only interaction is B; integration behavior is C and deferred. Verification inherits its subject classification. Uncertain behavior/data remains unverified. A/B completion never closes deferred C criteria.

**Purpose:** Present existing assessment information, source references, and known gaps clearly after assessment.

**Dependencies:** Guided-inline C presentation. New readiness logic/data remains integration-dependent.

## Eligible after separate batch approval
- [ ] [A] Improve hierarchy and labels for structured values, known gaps, and source references already supplied to the UI.
- [ ] [A] Clearly distinguish existing states such as not assessed, found, and not found in the sources read **only when the data contract already provides enough information to support them**.
- [ ] [A] Explain that absence from reviewed sources does not mean zero risk or On Track.
- [ ] [A] Keep source references associated with the values they support.
- [ ] [A] Show unavailable/unknown information honestly rather than filling gaps with inferred values.

## Deferred
- [ ] [C — deferred] New readiness calculations or evidence requirements.
- [ ] [C — deferred] New domain fields not currently exposed by existing data.
- [ ] [C — deferred] Changes to Budget semantics (approved budget, current forecast, current actual, currency, and period), Schedule baseline/current milestone logic, or Risk/control extraction.
- [ ] [C — deferred] Proving partial-to-complete transitions after new evidence or reassessment.

**Acceptance boundary:** Display existing structured results only. Do not infer readiness from file count or processing completion; do not fabricate fields, evidence, sources, or completeness.

**Screen boundary:** Evidence receives documents, upload submissions, facts, and summaries, not Assurance domain findings or authoritative freshness. Absent screen data does not mean no assessment occurred or a domain is ready, complete, or blocked. Where relevant, say "Assessment results are not available on this screen" and retain the existing Assurance Review destination. New retrieval, response handling, or prop contracts are C. Preserve supplied Budget source meaning (forecast versus actual).
