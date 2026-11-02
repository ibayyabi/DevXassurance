# 01: Isolated Evidence → Overview → Reports preview

**Authority:** [Governing specification](../xassurance-guided-inline-uiux-aligned.md), including its screen contracts, classification rules, batch dependencies, and approval gates. This ticket authorizes no implementation. Historical preservation against separate pre-revision originals remains unverified.

**Batch ownership:** Outside D1-D4: separately approved evaluation of an existing isolated preview only.

**Classification/completion:** Presentation is A; local-only interaction is B; integration behavior is C and deferred. Verification inherits its subject classification. Uncertain behavior/data remains unverified. A/B completion never closes deferred C criteria.

**Purpose:** Validate the selected Guided-inline C composition against the earlier upload-first and readiness-first alternatives without affecting real projects.

**Current decision:** Guided-inline C is selected. Do not reopen A/B/C or build a permanent production switcher.

**Scope:** Development-only, synthetic fixtures in memory. No real upload, LLM, project mutation, approval, export, or file download. The preview is not the production workflow.

**Handling:** If the preview already exists, inspect the current branch and verify it; do not rebuild it just because this checklist is unchecked. Do not promote preview fixtures, fake processing controls, or simulated report lifecycle into production.

**Acceptance / verification:**
- [ ] [B] Only if an existing isolated preview is located and evaluation is separately approved: verify its existing comparison and keyboard controls without reopening C. If absent, record unavailable and defer creation. No replacement preview, production route, or simulated production workflow is authorized in D1.
- [ ] [A] Seven synthetic scenarios remain explicit: empty, processing, partial evidence, complete, unreadable, incorrect period classification, and new evidence not yet reflected in assessment.
- [ ] [B] Scenario state survives in-preview navigation and resets on reload, as documented.
- [ ] [A] Partial draft, simulated approval invalidated by edits, and simulated stale-draft restrictions are labeled as simulations.
- [ ] [B] PDF/DOCX output is simulated and never creates/downloads a real file.
- [ ] [A] Preview is explicitly development-only; production does not serve it.
- [ ] [B] No real mutation/upload/LLM/export requests are issued.
- [ ] [B] Desktop/mobile/keyboard behavior is checked.

**Proposed preview scope (separate approval required):** No isolated preview was located. Evaluation of an existing preview and any bounded refinements require separate approval; creation is deferred. No production workflow change is authorized by this ticket.
