---
title: X-Assurance Usable MVP Product Recovery Specification
status: implementation-ready
created: 2026-07-21
updated: 2026-07-21
decision_scope: Phase 3 product and UX freeze
---

# X-Assurance Usable MVP Product Recovery Specification

## 0. Authority and Purpose

This document is the authoritative product and UX specification for recovery of the existing X-Assurance product. Where it conflicts with the June 2026 draft PRD, epics, or UX documents, this document wins for the recovery implementation.

Earlier artifacts remain useful as implementation history and architectural context. They must not be used to reintroduce deferred features, unexplained health percentages, dense module-specific dashboards, or unsupported AI behavior.

Phase 3 changes the product definition and implementation target. It does not authorize changes to the production deployment. All implementation and verification must occur in the `XAss-Development` worktree and development services before a separately approved release.

## 1. Product Definition

### 1.1 Product Statement

X-Assurance helps a PMC or PMO reviewer compare an approved project plan with current project evidence, identify understandable budget, schedule, and risk concerns, recommend management actions, and produce an evidence-backed report for upper management.

### 1.2 Primary Question

The product must answer:

> Compared with what was approved, what is happening now, what requires attention, and what should management do next?

### 1.3 Primary Outcome

A reviewer completes one Assurance Review for a reporting period and produces a reviewed, evidence-backed PDF or DOCX report.

### 1.4 Product Principles

1. One guided journey is more important than many separate modules.
2. Every screen has one clear purpose and one obvious next action.
3. Project facts come from project documents; methodology guidance comes from an approved knowledge base.
4. The system shows missing evidence and processing failures honestly.
5. The model extracts and explains; deterministic application logic performs date, percentage, variance, and status calculations.
6. A human reviewer approves findings and reports before external distribution.
7. Attractive UI means calm, clear, trustworthy, and easy to scan. It does not mean adding more cards or charts.

## 2. Users and Permissions

### 2.1 Primary Operator

The primary operator is a **PMC/PMO Reviewer** who:

- selects a project and reporting period;
- uploads or selects approved baseline and current evidence;
- reviews analysis results and sources;
- confirms, edits, or dismisses findings;
- confirms recommended actions; and
- approves and exports a report.

### 2.2 Management Viewer

A **Sponsor/Steering Committee Viewer**:

- reads the project overview;
- opens reviewed findings and sources;
- reads approved reports; and
- may ask read-only project questions in AI Advisor.

### 2.3 Administrator

An **Administrator** manages organizations, projects, members, and project-level analysis settings. Existing project-scoped authorization and RLS remain mandatory.

### 2.4 Permission Rule

Frontend visibility is never authorization. Every project document, review, finding, action, AI interaction, and report must be protected by project-scoped backend authorization and RLS.

## 3. Usable MVP Boundary

### 3.1 Included Product Areas

| Product area | User purpose | Recovery decision |
| --- | --- | --- |
| Projects | Select an assigned project | Keep and simplify |
| Overview | Understand current review condition and next action | Replace current dashboard design |
| Assurance Review | Complete Evidence, Analysis, Findings, Actions, and Report steps | New central workflow using existing capabilities |
| Reports | View report history and download approved output | Keep and simplify |
| AI Advisor | Ask evidence-grounded project questions with methodology guidance | Keep, rename, and strengthen grounding |
| Trends | Explain future multi-period capability | Visible placeholder only |
| Team & Settings | Manage members and basic project settings | Keep with low visual priority |

### 3.2 Deferred Product Areas

The usable MVP does not include:

- predictive cost, delay, risk, resource, or health models;
- portfolio analytics or project benchmarking;
- governance health scoring;
- audit-readiness scoring;
- scope anomaly scoring;
- general-purpose anomaly detection;
- complex trend charts;
- automated corrective-action execution;
- ERP, scheduling-system, contract-system, or DMS integrations;
- a general-purpose chatbot; or
- a numeric overall health percentage.

These capabilities may be revisited only after the usable MVP passes end-to-end user testing.

### 3.3 Terminology Freeze

| Retired or technical term | User-facing term |
| --- | --- |
| Document Intelligence | Evidence |
| Anomaly Detection | Findings & Early Warnings |
| AI Assistant | AI Advisor |
| Document processing job | Document analysis |
| Extracted chunks/facts | Extracted information |
| Health snapshot | Project condition |
| Green | On Track |
| Amber | Needs Attention |
| Red | Critical |
| Insufficient evidence | More Evidence Required |

Database and internal code names may be migrated incrementally. User-facing copy must use the frozen terminology.

## 4. Information Architecture

### 4.1 Primary Navigation

The authenticated project navigation is:

1. Overview
2. Assurance Review
3. Reports
4. AI Advisor
5. Trends
6. Team & Settings

`Evidence` and `Findings` are steps inside Assurance Review, not standalone navigation modules.

### 4.2 Planned Route Intent

Routes may be introduced incrementally, but the intended product structure is:

- `/app/projects`
- `/app/projects/{projectId}/overview`
- `/app/projects/{projectId}/reviews`
- `/app/projects/{projectId}/reviews/{reviewId}/evidence`
- `/app/projects/{projectId}/reviews/{reviewId}/analysis`
- `/app/projects/{projectId}/reviews/{reviewId}/findings`
- `/app/projects/{projectId}/reviews/{reviewId}/actions`
- `/app/projects/{projectId}/reviews/{reviewId}/report`
- `/app/projects/{projectId}/reports`
- `/app/projects/{projectId}/advisor`
- `/app/projects/{projectId}/trends`
- `/app/projects/{projectId}/settings`

Redirects may preserve old routes during implementation. Old route names must not force the old information architecture to remain visible.

## 5. Assurance Review Contract

### 5.1 Review Definition

An **Assurance Review** is a project-scoped analysis for one reporting period. It binds approved baseline evidence, current-period evidence, extracted information, comparisons, reviewed findings, management actions, and a report version.

### 5.2 Reporting Period

- Monthly is the default review period.
- A reviewer may select a custom start and end date.
- Every finding, AI answer, and report must display or retain its reporting-period context.

### 5.3 Review Lifecycle

| Internal state | User meaning | Allowed next action |
| --- | --- | --- |
| `draft` | Evidence is still being selected | Add evidence |
| `evidence_ready` | Minimum evidence is present | Start analysis |
| `analyzing` | Documents are being parsed and compared | View progress |
| `analysis_failed` | One or more required operations failed | Retry or replace evidence |
| `needs_review` | Findings are ready for human review | Review findings |
| `actions_ready` | Findings and actions have been reviewed | Prepare report |
| `report_draft` | Report can be edited | Review and approve |
| `approved` | Report content is approved | Export PDF or DOCX |
| `exported` | Management output exists | Download or start next review |

The system must never move a failed analysis to `needs_review` by substituting template content.

### 5.4 Five-Step User Journey

```text
Evidence -> Analysis -> Findings -> Actions -> Report
```

Only the current step receives primary visual emphasis. Completed steps remain accessible. Future steps show their prerequisites instead of unusable controls.

## 6. Evidence Contract

### 6.1 Evidence Roles

Each document used by a review has both a document type and a review role.

Review roles:

- **Approved Baseline** - the approved plan or previously authorized control value.
- **Current Period** - the latest reported or forecast condition for the selected period.
- **Supporting Evidence** - meeting minutes, approvals, change records, issue logs, or other context.

The application may suggest a role and document type, but the reviewer can correct both.

### 6.2 Supported Document Types for the Usable MVP

- Project baseline or project plan
- Baseline schedule
- Approved budget
- Monthly progress report
- Current cost report or forecast
- Current schedule or milestone report
- Risk register
- Meeting minutes
- Approved change record
- Supporting approval

Existing document types may be retained internally. The UI groups them by the three review roles above.

### 6.3 Minimum Evidence

To start an Assurance Review, the user must provide:

1. at least one Approved Baseline document;
2. at least one Current Period document; and
3. a reporting period.

Each domain also has minimum evidence requirements. A review may continue when one domain lacks evidence, but the overall review is marked **Review Incomplete** and the affected domain is marked **More Evidence Required**.

### 6.4 Processing States

Every document displays exactly one state:

- Uploaded
- Queued
- Analyzing
- Needs Review
- Ready
- Failed

A failed document displays a plain-language reason plus `Retry` and, when relevant, `Replace document`. Internal stack traces, credentials, and provider errors must not be shown.

### 6.5 Source Contract

Every extracted or generated factual claim must retain:

- project ID;
- review ID and reporting period;
- document ID and title;
- document role and type;
- page, sheet, section, or chunk location when available;
- supporting excerpt;
- extraction confidence; and
- reviewer confirmation state.

Raw chunks are available through a source drawer. They are not primary page content.

## 7. Analysis and Project Condition Rules

### 7.1 Division of Responsibility

The AI model may:

- classify document content;
- extract candidate values and dates;
- normalize project language;
- summarize evidence;
- explain an application-calculated comparison; and
- draft recommendations.

Versioned application logic must:

- calculate monetary and percentage variance;
- calculate date slippage;
- apply threshold rules;
- assign domain condition;
- calculate review completeness; and
- preserve rule version and provenance.

The model must not invent missing baseline or current values and must not be the sole calculator of a health result.

### 7.2 Domain Condition Vocabulary

Each domain uses one of four user-facing conditions:

- **On Track**
- **Needs Attention**
- **Critical**
- **More Evidence Required**

No numeric domain or overall health percentage is shown.

### 7.3 Working Default Thresholds

The following defaults make the recovery implementation testable. An administrator may later configure approved organization or project thresholds. Any override must be versioned and shown in finding rationale.

#### Budget

Minimum evidence:

- approved budget or baseline cost value; and
- current actual cost and/or estimate at completion from current-period evidence.

Comparisons:

- approved budget versus current forecast;
- planned cost versus actual cost where both are present;
- approved change value versus reported change value; and
- current cost statement versus previous or supporting evidence where available.

Default condition rules:

| Condition | Working rule |
| --- | --- |
| More Evidence Required | Approved budget or current cost/forecast value cannot be established |
| On Track | Current forecast is at or below approved budget and no material unexplained conflict is found |
| Needs Attention | Forecast overrun is greater than 0% and up to 5%, or a material cost change lacks a clear explanation |
| Critical | Forecast overrun is greater than 5%, or a material overrun depends on an unapproved change |

#### Schedule

Minimum evidence:

- approved baseline milestone/date; and
- current actual or forecast milestone/date.

Comparisons:

- baseline milestone date versus current forecast date;
- planned completion versus actual completion;
- planned progress versus reported progress when compatible values exist; and
- delay statement versus recovery or escalation evidence.

Default condition rules:

| Condition | Working rule |
| --- | --- |
| More Evidence Required | A baseline or current milestone/date cannot be established |
| On Track | No compared milestone is forecast later than its approved baseline |
| Needs Attention | A compared milestone is 1-14 calendar days late, or a delay has no clear recovery explanation |
| Critical | A compared milestone is more than 14 calendar days late, or a critical milestone is overdue without an approved recovery plan |

#### Risk

Minimum evidence:

- a current risk register or current-period document containing identifiable risk information.

A previous or baseline risk register is required to claim that a risk is new or has changed. Without it, the system may describe the current risk but not claim a trend.

Comparisons and checks:

- previous risk rating versus current rating;
- previous risk list versus newly reported risks;
- risk owner, mitigation, due date, and status completeness;
- mitigation due date versus reporting period; and
- risk statement versus supporting progress evidence.

Default condition rules:

| Condition | Working rule |
| --- | --- |
| More Evidence Required | Current risk evidence cannot be established |
| On Track | No open high/critical risk lacks required mitigation, ownership, or due-date information |
| Needs Attention | A risk increases in rating, a new high risk appears, or required mitigation is overdue by up to 14 days |
| Critical | A critical risk is open, a high risk lacks an owner or mitigation, or required mitigation is overdue by more than 14 days |

### 7.4 Overall Review Condition

The Overview must not calculate a percentage.

- If any of Budget, Schedule, or Risk is **More Evidence Required**, the review-level label is **Review Incomplete**.
- Otherwise, **Critical** wins over all other conditions.
- If none is Critical and at least one is **Needs Attention**, the review is **Needs Attention**.
- The review is **On Track** only when all three domains are On Track.

The Overview still shows each domain condition when the overall review is incomplete.

### 7.5 Finding Contract

Every finding contains:

- short title;
- domain: Budget, Schedule, or Risk;
- priority: High, Medium, or Low;
- baseline statement and value when applicable;
- current statement and value;
- application-calculated variance when applicable;
- plain-language explanation;
- potential impact;
- recommended action;
- baseline and current source links;
- confidence and missing-information statement;
- rule ID and rule version;
- review state: Draft, Confirmed, Edited, Dismissed; and
- reviewer identity and timestamp after review.

If only current evidence exists, the output is an observation, not a baseline-comparison finding.

## 8. Screen Contracts and Low-Fidelity Layouts

### 8.1 Global UX Rules

- One primary action per screen.
- No more than three major content regions at one time.
- Details use progressive disclosure through drawers, expandable rows, or dedicated steps.
- Status color supports text; color never carries meaning alone.
- Red, amber, and green are reserved for real status.
- Empty, loading, success, failure, and insufficient-evidence states are designed behavior, not afterthoughts.
- Technical extraction output is never the default user view.
- Desktop is primary, but the review remains operable at tablet width.

### 8.2 Overview

Purpose: explain the latest review condition and the next required action.

```text
+------------------------------------------------------------------+
| June 2026 Assurance Review                 [Continue Review]       |
| NEEDS ATTENTION                                                  |
| Schedule is 18 days late; budget forecast is 4% above baseline.  |
+------------------------------------------------------------------+
| Budget              | Schedule             | Risk                |
| Needs Attention     | Critical             | On Track            |
| One-line reason     | One-line reason      | One-line reason     |
+------------------------------------------------------------------+
| Top Findings                       | Recommended Actions          |
| 1. ...                             | 1. ...                       |
| 2. ...                             | 2. ...                       |
+------------------------------------------------------------------+
| Latest report                                      [View Report]  |
+------------------------------------------------------------------+
```

Required behavior:

- The primary action changes with lifecycle state: Add Evidence, Start Analysis, Review Findings, Prepare Report, or View Report.
- If evidence is incomplete, the hero says **Review Incomplete** and names missing evidence.
- No score, evidence percentage, or single-point trend chart is shown.
- At most three findings and three actions are shown before `View all`.

### 8.3 Assurance Review - Evidence

Purpose: select the approved plan and current evidence for one reporting period.

```text
Evidence -> Analysis -> Findings -> Actions -> Report

Reporting period: [June 2026 v]

+-------------------------------+ +-------------------------------+
| Approved Baseline             | | Current Period                |
| Ready 3 documents             | | Missing current cost report   |
| - Baseline schedule           | | - June progress report        |
| - Approved budget             | | - Updated risk register       |
| - Baseline risk register      | |                               |
| [Add baseline evidence]       | | [Add current evidence]        |
+-------------------------------+ +-------------------------------+

Supporting Evidence (collapsed)

                                           [Start Analysis]
```

Required behavior:

- Upload and classification are one guided interaction.
- The system suggests type and role; the user can correct them.
- Advanced metadata is collapsed by default.
- The primary action is disabled only with a visible prerequisite explanation.

### 8.4 Assurance Review - Analysis

Purpose: show understandable progress without exposing workflow internals.

```text
Analyzing June 2026 evidence

[done] Reading 6 documents
[done] Extracting budget information
[active] Comparing schedule milestones
[next] Reviewing risks
[next] Preparing findings

Current schedule report could not be read. [Retry] [Replace]
```

Required behavior:

- Progress updates without requiring a page refresh where practical.
- A completed document and a failed document cannot look the same.
- The system cannot label the analysis complete while a required operation has failed.
- `View technical details` is secondary and does not reveal secrets.

### 8.5 Assurance Review - Findings

Purpose: let the reviewer understand and approve evidence-backed project conditions.

```text
Budget: Needs Attention   Schedule: Critical   Risk: On Track

Schedule milestone forecast is 18 days late                  HIGH
Baseline    10 Oct 2026
Current     28 Oct 2026
Difference  +18 calendar days
Impact      Commissioning may start late.
Sources     Baseline p.14; June Report p.7       [View sources]

[Confirm] [Edit] [Dismiss]
```

Required behavior:

- The main view shows normalized comparisons, not raw extraction blobs.
- Baseline and current sources are visually distinguishable.
- Dismiss requires a reason.
- User edits preserve the original generated content.
- A finding without sufficient source evidence cannot be confirmed as management-ready.

### 8.6 Assurance Review - Actions

Purpose: turn confirmed findings into accountable next steps.

Required fields:

- action title;
- source finding;
- priority;
- owner;
- due date; and
- status.

The reviewer may approve, edit, or omit a recommendation. Actions missing owner or due date are visibly incomplete and cannot be presented as finalized commitments.

### 8.7 Assurance Review - Report

Purpose: review and approve a management-ready assurance report.

The screen contains:

1. a report preview;
2. a compact inclusion/settings panel; and
3. approval/export controls.

The report uses the current review evidence and confirmed findings automatically. The user must not reselect source documents that were already bound to the review.

Primary action progression:

```text
Generate Draft -> Approve Report -> Download PDF / Download DOCX
```

### 8.8 Reports

Purpose: find previously generated reports.

Each row shows project, period, status, reviewer, generated date, and available formats. The initial usable MVP provides one report type: **Assurance Review Report**, which contains an executive summary rather than requiring the user to choose among overlapping report types.

### 8.9 AI Advisor

Purpose: answer project questions using the selected project and review context.

The screen contains:

- current project and reporting-period context;
- suggested questions;
- conversation;
- answer source controls; and
- a contextual source drawer.

Suggested questions include:

- How does the current forecast compare with the approved budget?
- Which milestones require management attention?
- Which risks require escalation?
- What evidence is missing from this review?
- What actions should be discussed with management?

### 8.10 Trends

The usable MVP page contains only:

> **Trend Analytics is under development.**
>
> This feature will compare budget, schedule, and risk conditions across multiple reporting periods. It does not affect the current Assurance Review.

No simulated chart, disabled filter set, placeholder metric, or fabricated projection is displayed.

## 9. AI Advisor and Knowledge Contract

### 9.1 Two Grounding Layers

AI Advisor uses two visibly separate knowledge layers:

1. **Project Evidence** - project-specific documents, confirmed extracted information, findings, actions, and reports.
2. **Methodology Guidance** - approved internal PMO/PMC procedures and properly licensed project-management standards.

Project Evidence answers what is happening. Methodology Guidance helps explain what a reviewer might do about it.

### 9.2 PMBOK Use

The intended external methodology reference is the [PMBOK Guide](https://www.pmi.org/standards/pmbok), with the Eighth Edition as the current target reference. The complete copyrighted publication must not be ingested into a commercial knowledge base until the organization confirms appropriate access through [PMI's permissions process](https://www.pmi.org/permissions).

Until licensing is confirmed, the knowledge base may use:

- organization-owned PMO/PMC procedures;
- approved project controls and assurance checklists;
- licensed excerpts or references;
- public, permission-compatible standards material; and
- organization-authored guidance that does not reproduce protected text.

Methodology sources must be versioned and carry title, owner/publisher, edition/version, approval status, and effective date.

### 9.3 Answer Structure

Every project-specific answer uses this structure:

1. **Direct answer**
2. **Project evidence**
3. **Baseline comparison** when available
4. **Recommended action**
5. **Methodology guidance** when relevant
6. **Sources**
7. **Confidence and missing information**

Project and methodology citations are labeled separately.

### 9.4 Prohibited Advisor Behavior

AI Advisor must not:

- answer from another project;
- present general methodology as a project fact;
- claim a comparison when no baseline exists;
- hide missing evidence;
- omit sources for factual project claims;
- present fallback/template text as model analysis;
- make contractual, legal, safety, or financial approval decisions; or
- claim that a methodology recommendation is mandatory unless the cited project rule states that it is.

## 10. Report Contract

### 10.1 Initial Report

The usable MVP generates one **Assurance Review Report** with these sections:

1. Project and reporting-period information
2. Executive summary
3. Overall review condition
4. Budget condition
5. Schedule condition
6. Risk condition
7. Confirmed findings and early warnings
8. Approved management actions
9. Missing information and limitations
10. Evidence reference appendix
11. Reviewer, approval date, generation date, and version

### 10.2 Human Review

- Generated content starts as Draft.
- The executive summary is editable.
- Findings can be included or omitted.
- Only confirmed findings can appear as final findings.
- Approval records reviewer and timestamp.
- PDF or DOCX export is available only after approval.
- Regeneration never overwrites an approved version silently.

### 10.3 Export Quality

PDF and DOCX output must:

- remain readable without the web application;
- include project, period, version, and generation date;
- preserve human edits;
- include human-readable source references;
- distinguish missing evidence from confirmed absence; and
- avoid internal IDs, prompts, stack traces, or model-provider details.

## 11. Visual Direction

### 11.1 Intended Character

The authenticated product should feel like a calm executive review workspace: serious, spacious enough to understand, and focused on decisions.

### 11.2 Visual Rules

- Retain dark navy navigation and a light neutral workspace.
- Use one restrained blue or teal primary accent.
- Use semantic red, amber, and green only for actual conditions.
- Use cards only for meaningful grouping, not every metric or sentence.
- Prefer short comparison rows and structured lists over paragraphs of extracted text.
- Use a clear type hierarchy with comfortable line height and a readable base size.
- Keep the primary content width controlled on reading-heavy screens.
- Avoid decorative charts, nested cards, excessive badges, and permanent multi-column control panels.
- Use TasteSkill during implementation to refine hierarchy, spacing, typography, and interaction polish after the wireframe contract is preserved.

### 11.3 Density Limit

The old instruction to keep authenticated surfaces highly dense is retired. Operational efficiency remains important, but comprehension wins over information volume. The default view shows decisions and comparisons; evidence excerpts and technical details are opened on demand.

## 12. Cross-Cutting State and Accessibility Requirements

### 12.1 Required States

Every user-triggered operation has:

- empty state;
- ready state;
- loading/progress state;
- success state;
- failure state with recovery action; and
- More Evidence Required state when applicable.

### 12.2 Accessibility Floor

- Status never relies on color alone.
- All controls have accessible names and visible keyboard focus.
- Step progress is announced semantically, not only visually.
- Source drawers and dialogs return focus to their opener.
- Tables have meaningful headers and remain understandable when stacked.
- Error summaries identify the failed item and available recovery action.
- Core review completion remains possible without pointer-only interaction.

## 13. Feature Recovery Matrix

| Existing capability | Current problem | Recovery decision | Usable-MVP destination |
| --- | --- | --- | --- |
| Dashboard health cards | Too many equal cards; unsupported percentage; missing data appears alongside confident health | Rebuild | Overview hero plus Budget, Schedule, and Risk conditions |
| Health trend | One point and no meaningful trend | Remove from MVP | Trends placeholder |
| Document upload | Mixed with extraction, summary, corrections, and sources | Keep but separate by step | Assurance Review - Evidence |
| Extracted information | Raw machine text dominates the page | Hide by default and normalize | Analysis details/source drawer |
| Document summary | Manual source selection and unclear button behavior | Automate within selected review evidence | Analysis project brief and report draft |
| Anomalies | Broad, technical, and disconnected | Narrow and rename | Budget, Schedule, and Risk Findings |
| Recommended actions | Generic and sometimes incomplete | Bind to confirmed finding | Assurance Review - Actions |
| Reports | Too many overlapping report types and settings | Simplify | One Assurance Review Report plus history |
| AI Assistant | May provide fallback-like output and weak retrieval | Rename and strengthen | AI Advisor with dual grounding and citations |
| Members | Valid but visually equal to the core workflow | Keep with lower priority | Team & Settings |
| Governance/audit health | Insufficient product definition | Defer | Not visible in usable MVP |
| Predictive/portfolio analytics | No reliable historical foundation | Defer | Future product work |

## 14. Usable MVP Acceptance Criteria

### 14.1 Core Journey

A PMC/PMO reviewer can, without developer assistance:

1. select an assigned project;
2. create or open an Assurance Review;
3. set a reporting period;
4. add approved baseline and current evidence;
5. understand document processing progress and recover from a failure;
6. view Budget, Schedule, and Risk conditions;
7. inspect baseline/current comparisons and their sources;
8. confirm, edit, or dismiss findings;
9. approve or edit recommended actions;
10. preview and approve a report;
11. download a readable PDF and DOCX; and
12. ask AI Advisor a project question and inspect its project and methodology sources.

### 14.2 Trust

- No overall percentage is shown.
- A missing required domain source produces More Evidence Required.
- A failed parse cannot produce a successful analysis result.
- Every confirmed finding has usable evidence links.
- Every numeric/date variance is reproducible from cited values.
- Every project-specific AI claim has a source or an explicit inference label.
- Report export is blocked until human approval.

### 14.3 Usability

- Every screen has one primary action.
- A first-time user can identify the next action without reading internal documentation.
- No main screen shows raw extraction blobs by default.
- No empty chart or unusable control appears.
- A user unfamiliar with implementation terminology can explain Budget, Schedule, and Risk findings after reading them.

### 14.4 Verification

Acceptance requires runtime verification, not static source-text assertions alone:

- browser-based happy-path test;
- browser-based missing-evidence test;
- browser-based processing-failure and retry test;
- API authorization and project-isolation tests;
- worker success, timeout, provider-failure, and invalid-output tests;
- PDF and DOCX content verification; and
- at least one usability session with a person who did not build the product.

## 15. Implementation Handoff

Phase 4 must implement the specification in risk order.

### 15.1 Trust and Data Foundations

1. Introduce an `assurance_reviews` concept with reporting period and lifecycle state.
2. Bind documents to a review with Approved Baseline, Current Period, or Supporting Evidence roles.
3. Store normalized baseline/current values and comparison provenance.
4. Version condition rules and thresholds.
5. Prevent fallback/template output from being recorded as successful AI analysis.
6. Add explicit timeouts, failure states, retry behavior, and stale-job recovery.

### 15.2 Experience Structure

1. Replace navigation with the frozen information architecture.
2. Build the five-step Assurance Review shell.
3. Replace the dashboard with the simplified Overview.
4. Move technical extraction details into source/detail views.
5. Add the Trends placeholder.

### 15.3 Management Output and Advisor

1. Consolidate report generation into one Assurance Review Report.
2. Enforce review and approval before export.
3. Implement PDF and DOCX verification.
4. Separate Project Evidence retrieval from Methodology Guidance retrieval.
5. Add structured Advisor answers and citation validation.

### 15.4 Verification Before Release

1. Replace static-only confidence with real API and browser tests.
2. Run the complete core journey in the development Supabase and n8n environment.
3. Conduct first-time-user usability testing.
4. Fix only blockers, misleading states, incorrect results, and severe performance problems before the usable release.
5. Prepare backup, migration, deployment, smoke-test, and rollback instructions before touching production.

## 16. Phase 3 Completion Record

The following product decisions are frozen by this specification:

- product purpose and primary user;
- usable-MVP scope and deferred scope;
- user-facing terminology;
- simplified navigation;
- Assurance Review definition and five-step journey;
- evidence roles and minimum evidence;
- Budget, Schedule, and Risk boundaries;
- working default condition rules;
- finding and action contracts;
- Overview, Review, Reports, AI Advisor, and Trends screen contracts;
- report content and approval/export behavior;
- AI dual-grounding and answer behavior;
- visual direction and density limit;
- trust, accessibility, and runtime acceptance criteria; and
- Phase 4 implementation order.

Changes to these decisions require an explicit product decision recorded in this file or a superseding approved specification. New capabilities must not be added merely because an existing database table or UI module already supports them.
