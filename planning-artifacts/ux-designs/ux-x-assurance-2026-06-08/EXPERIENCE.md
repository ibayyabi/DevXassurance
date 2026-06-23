---
title: X-Assurance Experience
status: final
created: 2026-06-08
updated: 2026-06-08
sources:
  - ../../prds/prd-x-assistance-2026-06-08/prd.md
  - ../../architecture.md
  - user-supplied screenshots in chat: Dashboard, Document Intelligence, Anomaly Detection, AI Assistant, Report Generation
design_reference: DESIGN.md
---

# X-Assurance Experience

## Foundation

X-Assurance is a responsive web application for project assurance teams and executives. The MVP surface is desktop-first because the supplied UX is dashboard-heavy and optimized for management review, document intelligence, anomaly triage, AI Q&A, and report preparation. Mobile should remain readable for review, but primary creation and analysis workflows target desktop/tablet widths.

The app uses the visual system defined in `DESIGN.md`. Behavioral decisions in this file win for interaction, state, information architecture, accessibility, and flow behavior. Visual token names should be referenced from `DESIGN.md` when implementation needs color, spacing, or component styling.

## Information Architecture

### Public Surface

- `/` Landing Page
- `/login` Login
- Auth callback/redirect handling

The landing page introduces Project Assurance/X-Assurance and routes users to login. It should not become a marketing-heavy long page for MVP; it exists to orient users, establish trust, and start authenticated access.

### Authenticated Surface

- `/app/projects` Project selection
- `/app/projects/{projectId}/dashboard` Executive Overview
- `/app/projects/{projectId}/documents` Document Intelligence
- `/app/projects/{projectId}/anomalies` Anomaly Detection
- `/app/projects/{projectId}/assistant` AI Assistant
- `/app/projects/{projectId}/reports` Report Generation

The sidebar navigation is project-scoped. Users first select or land in an assigned project, then navigate among modules for that project. The current project name must be visible in the header or page context area.

## Roles and Access

Users log in and see only projects assigned to them. Role is project-scoped.

Recommended roles:

- **Admin** - manages users, roles, organizations, and project setup.
- **PMC Consultant** - uploads evidence, reviews extracted facts, generates findings and reports.
- **PMO Reviewer** - reviews evidence, anomalies, actions, and reports across assigned projects.
- **Project Manager** - reviews anomalies and recommended actions for owned projects.
- **Sponsor** - views executive dashboard, key findings, reports, and escalation items.
- **Steering Committee** - views executive summaries, critical alerts, and strategic recommendations.

Role behavior:

- Navigation may be shared, but actions differ by role.
- Sponsors and steering committee users should see fewer editing controls.
- PMC/PMO users need upload, review, correction, report generation, and triage controls.
- Frontend visibility is convenience only; backend authorization must enforce access.

## Voice and Tone

The product voice is concise, evidence-led, and operational. It should avoid generic AI enthusiasm.

Use:

- "Grounded in source"
- "Insufficient evidence"
- "Needs attention"
- "Recommended action"
- "Impact: High"
- "Reviewed"
- "Export ready"

Avoid:

- "The AI thinks..."
- "This is definitely..."
- Unsupported confidence claims.
- Decorative or vague language such as "smart insights" without evidence.

## Component Patterns

### App Shell

The app shell includes sidebar, top bar, notification icon, user identity, and active project context. Sidebar items map exactly to the five authenticated modules shown in the screenshots:

- Dashboard
- Documents
- Anomalies
- AI Assistant
- Reports

The active page is always highlighted. Collapse should reduce sidebar width but preserve icon navigation.

### Project Selector

Users with multiple assigned projects can switch project context from the dashboard/page header. Project switching updates all module routes and clears page-specific filters that no longer apply.

### Date and Filters

Dashboard, Anomalies, and Reports use date range controls. Filters should be compact, top-right aligned, and apply to the current project only.

### Status and Severity

Use the same status vocabulary across modules:

- Overall health: Green, Amber, Red.
- Severity: High, Medium, Low.
- AI job status: queued, processing, needs review, completed, failed, cancelled.

Status labels must include enough text for non-color understanding.

### Evidence Controls

Every AI-generated answer, anomaly, report finding, and summary must expose sources. Evidence controls may collapse by default, but source count and confidence should remain visible.

## State Patterns

### Empty States

- No projects: explain that the user has no assigned projects and should contact an admin.
- No documents: show upload area and supported file guidance.
- No anomalies: show "No anomalies detected for this period" and evidence coverage caveat.
- No reports: show report type options and required inputs.
- No assistant history: show suggested prompts.

### Loading States

- Use skeleton cards for dashboard metrics.
- Use row skeletons for document, anomaly, evidence, and report lists.
- Use inline processing status for uploaded documents and AI jobs.
- Do not block a whole project workspace while one document or report is processing.

### Error States

- Upload failed: explain the file problem and allow retry.
- Processing failed: show job error and retry action for PMC/PMO roles.
- Insufficient evidence: show the missing source category, not a generic error.
- Unauthorized: redirect or show a role/access explanation without leaking project existence.

### Review States

AI outputs can be:

- Draft
- Needs review
- Reviewed
- Edited
- Exported

The UI should distinguish AI-generated content from user-edited content in report and finding contexts.

## Interaction Primitives

- Primary actions use a filled blue button.
- Secondary actions use outline or ghost buttons.
- Icon buttons need accessible labels/tooltips.
- Rows open detail panes when review context is needed.
- Filters and sort controls should update result lists without full page reload where practical.
- Source links open the cited document/page/sheet context.
- "Create Action" from an anomaly converts a finding into a management action with owner, due date, and status.

## Accessibility Floor

- Do not rely on color alone for health, risk, or severity.
- All icons in navigation and status cards need accessible names.
- Keyboard users must reach sidebar navigation, filters, upload controls, anomaly detail actions, chat input, and export buttons.
- Focus state must be visible against navy and white surfaces.
- Text in compact cards must not truncate critical values without tooltip or detail access.
- AI Assistant chat must preserve readable message order for screen readers.

## Key Flows

### UJ-1. Rina prepares a monthly assurance review

Rina, a PMC consultant, logs in from the landing page and lands in her assigned project list. She opens Alpha Infrastructure Program and enters Document Intelligence. She uploads progress reports, meeting minutes, risk registers, and cost reports. The system shows processing states, extracted risks/issues/milestones/decisions/actions, a source-grounded summary, and source confidence. Rina reviews extracted facts, opens evidence rows, resolves obvious extraction issues, then moves to Reports to generate an assurance report draft. The value moment is when she has a management-ready report preview with included evidence counts and export actions.

### UJ-2. Budi checks project health before steering committee

Budi, a sponsor, logs in and opens the Executive Overview for his assigned project. He sees health cards for Overall Health, Schedule, Cost, Risk, Governance, and Audit Readiness. The project is Amber because schedule and risk signals are deteriorating. Budi opens critical alerts and top recommended actions. The value moment is when he can identify the top escalation items without reading raw project documents.

### UJ-3. Sari challenges an optimistic project status

Sari, a PMO reviewer, opens the AI Assistant and asks why the project is Amber. The assistant answers with schedule slippage, cost trend, risk register references, and source controls. Sari expands sources and checks the cited dashboard, cost forecast, and risk register. The value moment is when she can challenge the reported status using traceable evidence instead of subjective concern.

### UJ-4. Dimas triages anomalies into corrective action

Dimas, a Project Manager, opens Anomaly Detection and filters high severity anomalies. He selects "Missing Risk Owner" and sees the detail pane with evidence, impact, impact rating, and recommended action. He assigns owners and creates an action. The value moment is when an assurance finding turns into accountable follow-up.

### UJ-5. Sarah prepares an executive summary

Sarah, a Program Director, opens Reports and selects Executive Summary. She previews overall status, key findings, critical risks, recommended actions, and included evidence counts. She adjusts report settings, checks that source categories are included, then exports PDF or DOCX. The value moment is when the report is credible enough to share with executive stakeholders.

## Page Specifications

### Landing Page

Purpose: introduce X-Assurance and route authenticated users into the app.

Required elements:

- Product name and concise value proposition.
- Evidence-based project assurance message.
- Login call to action.
- Secondary trust cues: evidence-based, early warning, executive-ready.

Behavior:

- Logged-out users can only access landing/login.
- Logged-in users can continue to project selection or last active project.

### Project Selection

Purpose: show assigned projects after login.

Required elements:

- User identity and role context.
- List/grid of assigned projects.
- Project health summary when available.
- Last updated/last viewed metadata.

Behavior:

- Users with one assigned project may be routed directly into that project.
- Users with multiple projects choose one explicitly.
- Users with no projects see an access/help empty state.

### Executive Overview

Purpose: one-view project health for PMO, sponsor, and steering committee users.

Required elements:

- Project selector/context.
- Date range and filters.
- Health cards: Overall Health, Schedule, Cost, Risk, Governance, Audit Readiness.
- Project Health Trend chart.
- Critical Alerts list.
- Top Recommended Actions list.

Behavior:

- Health cards drill into supporting evidence or module-specific detail.
- Critical alerts link to Anomaly Detection.
- Recommended actions link to action/finding detail.

### Document Intelligence

Purpose: upload, organize, extract, summarize, and source-check project evidence.

Required elements:

- Upload documents action and drag/drop area.
- Document library with file type, size/date, processing status.
- Extracted Information panel grouped by risks, issues, milestones, decisions, owners/actions.
- Document Summary panel with confidence.
- Source & Evidence panel.

Behavior:

- Upload creates processing status.
- Extracted facts can be reviewed and opened.
- Source rows open cited page/sheet/document context.
- Summary exposes sources and confidence.

### Anomaly Detection

Purpose: review anomalies and turn findings into action.

Required elements:

- Category filters: All, Cost, Schedule, Risk, Governance, Scope.
- Sort control.
- Anomaly list with severity and impact.
- Detail pane with evidence, impact, recommendation, suggested owners.
- Actions: Create Action, Mark as Reviewed.

Behavior:

- Selecting a row opens detail pane.
- Severity and impact are shown separately.
- Create Action captures owner, due date, and source anomaly.
- Mark as Reviewed logs audit event.

### AI Assistant

Purpose: ask project questions and receive source-grounded answers.

Required elements:

- Chat history.
- Suggested prompts.
- Evidence & Sources panel.
- Recommendations / Next Actions panel.
- Input field.

Behavior:

- Assistant answers must include sources for factual claims.
- Suggested prompts can populate the input.
- Source controls expand/collapse under answers.
- Unsupported questions return an insufficient evidence response.

### Report Generation

Purpose: create executive-ready assurance outputs.

Required elements:

- Report type selector: Executive Summary, Assurance Report, Governance Gap Report, Risk & Issue Summary.
- Report Preview.
- Included Evidence panel.
- Report Settings: period, program/project, audience, detail level.
- Export buttons: PDF, DOCX, Share Report.

Behavior:

- Report generation starts as preview/draft.
- Users can adjust included evidence and settings before export.
- Exported reports preserve evidence references.

## Responsive & Platform

Desktop is primary. At tablet widths, sidebar may collapse to icons and detail panels may stack. At mobile widths, use a single-column route-first experience; complex review panes should become full-screen detail views.

Do not attempt to compress all dashboard cards and detail panes into one mobile viewport. Preserve task completion over visual similarity.

## Open UX Questions

1. Should the product name in UI be Project Assurance, X-Assurance, or X-Assistance?
2. Should role-specific dashboards differ substantially, or should one dashboard adapt actions by role?
3. Should users with one project skip project selection by default?
4. Should chat history be stored per project, per user, or per reporting period?
5. What exact export formats are required for first MVP: PDF only, PDF + DOCX, or PDF + DOCX + share link?
6. Do screenshots represent final information density, or should UX simplify for first build?
7. Should the landing page be minimal login-oriented or a fuller external marketing page?
