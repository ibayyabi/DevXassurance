# 02: Evidence guidance and optional onboarding

**Authority:** [Governing specification](../xassurance-guided-inline-uiux-aligned.md), including its screen contracts, classification rules, batch dependencies, and approval gates. This ticket authorizes no implementation. Historical preservation against separate pre-revision originals remains unverified.

**Batch ownership:** D1: guidance/copy A and optional disclosure B.

**Classification/completion:** Presentation is A; local-only interaction is B; integration behavior is C and deferred. Verification inherits its subject classification. Uncertain behavior/data remains unverified. A/B completion never closes deferred C criteria.

**Purpose:** Help users understand what evidence to prepare through contextual guidance near the existing uploader and optional help that can be dismissed and reopened.

**Dependencies:** Guided-inline C design is selected; use Ticket 01 as design history only. Production implementation must use existing components and behavior.

## Eligible after separate batch approval
- [ ] [A] Explain approved plan, current evidence, reporting period, and examples of useful sources using verified product language.
- [ ] [A] Explain that one document may support more than one domain without requiring manual categorization before bulk upload.
- [ ] [B] Keep the existing uploader visible and unchanged; help is optional/reopenable, and essential instructions remain near the relevant control.
- [ ] [A] Distinguish supported/analyzed formats from reference-only formats only where current behavior is verified. Explain scan/OCR limitations without promising OCR exists.
- [ ] [A] Preserve existing permissions, keyboard behavior, and accessible labels.
- [ ] [B] Verify a new user can identify the initial evidence to prepare on desktop and mobile.

## Deferred
- [C — deferred] Changes to upload requests, accepted formats, OCR, server processing, or classification behavior.
- [C — deferred] Any promise that all files are automatically analyzed if current behavior does not establish that.

**Acceptance boundary:** Copy and presentation may change; uploader behavior and FE–BE contracts must not.
