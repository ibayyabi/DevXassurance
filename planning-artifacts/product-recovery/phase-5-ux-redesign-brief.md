# Phase 5 UX Redesign Brief

Date: 22 July 2026
Environment: XAss Development only
Status: Approved direction for TasteSkill redesign

## Product Promise

X-Assurance turns a collection of project documents into a clear, source-grounded explanation of project condition. A non-technical user should be able to upload everything they have, understand what needs attention, ask a follow-up question, and export a management report.

## Primary User Journey

1. Open a project.
2. Upload all available project documents in one place.
3. Let the system classify document type, date, reporting period, and evidence role.
4. Review only uncertain classifications or conflicting evidence.
5. See the latest Budget, Schedule, and Risk condition on Overview.
6. Open supporting evidence when more detail is needed.
7. Ask the AI Advisor a plain-language follow-up question.
8. Approve and export a management report from Reports.

The database may continue to use Assurance Reviews as internal reporting-period snapshots. The normal user should not need to create, name, or manually manage those records.

## Frozen Scope

### Included

- Project selection and access.
- Bulk evidence upload and visible processing status.
- AI-assisted document classification and reporting-period detection.
- Automatic selection of the strongest baseline and current evidence.
- Deterministic Budget, Schedule, and Risk conditions.
- Source excerpts and plain-language explanations.
- AI Advisor grounded in project evidence and assessment results.
- Approval-gated PDF and DOCX management reports.
- Honest missing-evidence and failure states.

### Deferred

- PMBOK knowledge-base RAG.
- Historical trend analysis beyond available assessment history.
- Additional assurance dimensions outside Budget, Schedule, and Risk.
- Automated report sharing or email delivery.
- Portfolio-level analytics.

## Navigation

1. Overview
2. Evidence
3. Reports
4. AI Advisor
5. Trends — visibly marked Under Development
6. Team & Settings

Remove Assurance Review from primary navigation. Its useful review and approval records remain an internal system concept.

## Information Architecture

### Overview

The first viewport must answer four questions without scrolling:

- What is the overall project condition?
- Why is it in that condition?
- What changed from the plan?
- What requires attention now?

Required hierarchy:

1. Large condition label: `Critical`, `Needs Attention`, `On Track`, or `Insufficient Evidence`.
2. One-sentence explanation using the most material verified finding.
3. Clear `As of` reporting period and last-updated time.
4. Budget comparison visual: approved versus current/forecast amount and variance.
5. Schedule comparison visual: baseline versus forecast milestone/date and days early/late.
6. Risk visual: open critical and high risks, plus missing ownership or mitigation.
7. Maximum three priority actions with owner and due-date state.
8. Secondary links to Evidence and Reports.

Do not use a single unexplained health percentage. Do not show a trend chart until at least two comparable historical assessment snapshots exist.

### Evidence

The dominant control is one large upload area with copy that tells the user to upload all relevant documents.

Each document row or card shows:

- File name and processing status.
- AI-detected document type.
- Detected date and reporting period.
- Detected role such as approved plan, current progress, cost, risk, or supporting evidence.
- Two- or three-sentence summary.
- Relevant Budget, Schedule, and Risk facts.
- Confidence and a review request only when classification is uncertain.

Technical chunks and raw extraction remain behind an advanced disclosure. Report generation does not appear on this page.

### Reports

Reports owns the reporting workflow:

- Current management-report preview.
- Reporting period and audience.
- Key findings and actions.
- Clear approval state.
- Visible PDF and DOCX export actions.
- Recent exports with readable download controls.

Remove database table names and internal traceability IDs from the default view. Detailed traceability may be opened from an advanced Evidence Details disclosure.

### AI Advisor

Each response follows this order:

1. Direct answer in one prominent sentence.
2. Supporting values or a small deterministic chart when relevant.
3. Plain-language interpretation.
4. Recommended next action.
5. Collapsed evidence sources.

Do not repeat the same source cards in two places. Do not show provider/model configuration in the primary workspace. Render Markdown correctly instead of exposing formatting symbols.

## Automatic Evidence Decisions

AI performs document understanding; deterministic application rules calculate project condition.

The automatic evidence service should:

- Classify all completed documents.
- Detect reporting dates and periods.
- Rank baseline candidates by approval language, document type, and date.
- Rank current candidates by reporting period and evidence relevance.
- Use all relevant current-period documents, not only one file.
- create or refresh the latest internal assessment snapshot.
- Ask the user only when confidence is low, evidence conflicts, or multiple candidates are equally strong.
- Preserve all selected source IDs so every finding remains traceable.

The UI must never silently claim `On Track` when required comparison evidence is missing.

## Condition Language

- `Critical`: at least one confirmed critical Budget, Schedule, or Risk condition.
- `Needs Attention`: no critical condition, but at least one warning condition.
- `On Track`: all three dimensions have sufficient evidence and are within approved limits.
- `Insufficient Evidence`: at least one required dimension cannot be assessed reliably.

Prefer `Critical` over `Danger` because it is professional, actionable, and suitable for executive reporting.

## Chart Rules

- Charts are generated from structured stored values, never from model-written numbers.
- Every chart shows units, source period, and comparison labels.
- Budget uses paired bars or a variance bullet chart.
- Schedule uses a baseline-versus-forecast date line or milestone variance bars.
- Risk uses compact severity counts, not decorative percentages.
- Empty and incomplete charts explain which evidence is missing.
- Color is never the only signal; include label, icon, and text.

## Visual Direction for TasteSkill

Audience: project managers, PMO reviewers, sponsors, and executives.
Personality: authoritative, calm, modern, confident, and easy to scan.
Avoid: generic card grids, excessive borders, tiny text, technical IDs, decorative metrics, black rectangles, and large unused whitespace.

Suggested TasteSkill dials:

- Design variance: 6/10 — distinctive hierarchy without experimental navigation.
- Motion intensity: 3/10 — restrained state transitions and useful feedback only.
- Visual density: 5/10 — executive summary first, detail available progressively.

Use a light-first design with strong contrast, one restrained accent family, semantic status colors, generous type hierarchy, and responsive layouts for laptop and desktop widths.

## Accessibility and Interaction Requirements

- Text and interactive controls meet WCAG AA contrast.
- Disabled controls remain readable and explain why they are unavailable.
- Hover is not required to discover a label or action.
- Keyboard focus is visible.
- Loading, processing, failed, incomplete, and empty states have specific copy.
- Important values use larger type and plain-language labels.
- No action depends on color alone.

## Acceptance Test

A first-time non-technical user must be able to complete the primary journey without developer explanation. During testing, the user should correctly identify:

- Overall condition.
- Most important Budget, Schedule, or Risk problem.
- Evidence supporting that problem.
- Recommended next action.
- Where to download the report.

If any of those answers require inspecting technical IDs, hovering to reveal text, or understanding the internal Assurance Review workflow, the redesign is not complete.
