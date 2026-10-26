# 01: Project-Level Budget Assurance

**What to build:** A PMO reviewer can upload a supported project document, approve a cost baseline for a scope and effective date, and see an evidence-backed project-total Budget comparison on the existing Assurance page. The extraction uses document content rather than restricting evidence to the document's primary type.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Cost observations preserve source value and location, with safe normalized amount, currency, scope, period/as-of date, and status where present.
- [ ] A reviewer can accept a cost baseline per scope/effective date; a source document's own “approved” label does not activate it.
- [ ] Compare the approved baseline only with explicitly reported EAC. Actual and committed costs remain separate; missing EAC is an evidence gap, never a comparison against actual cost.
- [ ] Compare currencies only when they match; differing currencies remain source values and are marked not comparable, without conversion.
- [ ] For comparable evidence, Budget status uses the agreed thresholds: variance <= 0% on track, > 0% through 5% needs attention, and > 5% critical.
- [ ] The Assurance page shows the result with source citations; reviewer corrections preserve the original extraction and source wording/location and record reviewer attribution/reason.
- [ ] The grouped extraction path uses a free provider selected for the implementation; if quota is reached, remaining text groups stay not processed and are retried later rather than treated as absent evidence.
