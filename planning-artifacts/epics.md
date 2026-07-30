---
stepsCompleted: [1, 2, 3, 4]
status: superseded-for-recovery
completedAt: 2026-06-08
updatedAt: 2026-07-21
supersededBy: planning-artifacts/product-recovery/phase-3-usable-mvp-spec.md
inputDocuments:
  - planning-artifacts/prds/prd-x-assistance-2026-06-08/prd.md
  - planning-artifacts/prds/prd-x-assistance-2026-06-08/addendum.md
  - planning-artifacts/architecture.md
  - planning-artifacts/ux-designs/ux-x-assurance-2026-06-08/DESIGN.md
  - planning-artifacts/ux-designs/ux-x-assurance-2026-06-08/EXPERIENCE.md
---

# X-Assurance / X-Assistance - Epic Breakdown

> **Recovery notice:** These epics describe the original broad module implementation. Do not use them as the recovery backlog without reconciling them against [`phase-3-usable-mvp-spec.md`](product-recovery/phase-3-usable-mvp-spec.md).

## Overview

This document provides the complete epic and story breakdown for X-Assurance / X-Assistance, decomposing the requirements from the PRD, UX Design, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: PMC/PMO users can upload Project Evidence into a project workspace; MVP accepts at minimum PDF documents, records document metadata, and keeps failed uploads out of downstream analysis.

FR2: PMC/PMO users can classify uploaded documents by primary document type, including progress report, meeting minutes, risk register, issue log, schedule, cost report, approval, claim, change record, or Governance Reference.

FR3: The system parses uploaded documents, extracts searchable text, chunks content, and attaches metadata needed for traceable downstream analysis.

FR4: The system extracts project facts from Project Evidence, including risk, issue, milestone, decision, owner, due date, action item, and where supported scope change, claim, approval, cost signal, and progress signal.

FR5: PMC/PMO users can review and correct extracted facts while preserving original extracted values and marking whether facts are AI-extracted, user-confirmed, or user-edited.

FR6: PMC/PMO users can generate summaries for individual documents and selected document sets, including key points, risks/issues, decisions, action items, confidence/quality indicators, and Evidence Links.

FR7: The system generates quick project insight across selected Project Evidence, including project health narrative, critical risks/issues, overdue actions, governance gaps, recommended Management Actions, Evidence Links, and inference markers.

FR8: The system flags risks, issues, decisions, and action items missing owner, due date, status, or escalation path, and allows users to mark findings as accepted, resolved, or false positive.

FR9: The system flags inconsistent status signals such as delay without escalation, overdue issue without action, cost variance without explanation, and progress claims inconsistent with schedule or cost evidence.

FR10: The system compares Project Evidence against Governance Reference requirements and flags missing approvals, missing reports, missing review evidence, or incomplete assurance checklist items.

FR11: The system classifies Anomalies as High, Medium, or Low based on severity and likely project impact, shows rationale, and supports user priority override with a required reason.

FR12: The Executive Dashboard presents project health across schedule, cost, risk, governance, and audit readiness, with explainable Health Score behavior and insufficient-evidence handling.

FR13: The dashboard highlights critical alerts with severity, impacted area, explanation, Evidence Link count, recommended Management Action, and filters by schedule, cost, risk, governance, scope, and audit readiness.

FR14: The dashboard converts analysis into prioritized Management Actions with owner, due date, source finding, priority, status, export/report inclusion, and incomplete-action flags.

FR15: Authorized users can ask natural language project questions against a project workspace covering status, risk, issue, cost, schedule, governance, evidence, and escalation needs.

FR16: The AI Assistant returns concise evidence-grounded answers with source documents, supporting facts, relevant excerpts, uncertainty separation, recommended next action, and source-opening behavior.

FR17: PMC/PMO users can generate an executive summary for a selected reporting period with project health, key findings, critical risks, governance gaps, recommended Management Actions, and editable draft content.

FR18: PMC/PMO users can generate a structured assurance report using extracted facts, summaries, Anomalies, and Governance Reference checks, including evidence-backed findings, severity, impact, recommendations, and source references.

FR19: Users can export generated reports for management distribution, with MVP supporting at least PDF export and including generation date, project name, reporting period, evidence appendix, and AI/user-edited distinction.

### NonFunctional Requirements

NFR1: Every summary, answer, Anomaly, Assurance Finding, and generated report must preserve traceability to source Project Evidence whenever factual claims are made.

NFR2: Users must only access projects and documents they are authorized to view, enforced through project-scoped roles and backend authorization.

NFR3: AI-generated findings and reports must be reviewable and editable before external distribution.

NFR4: Health Score, anomaly severity, and recommended Management Actions must expose enough rationale for PMO/PMC users to defend findings.

NFR5: Project Evidence, extracted facts, generated outputs, and user corrections must follow the client's retention, residency, and confidentiality policies once confirmed.

NFR6: The system must not present unsupported conclusions as facts; unsupported content must be labeled as inference, assumption, or insufficient evidence.

NFR7: The product must maintain an audit trail for upload events, processing status, generated outputs, user edits, finding status changes, priority overrides, and report exports.

NFR8: The interface must not rely on color alone for health, risk, or severity states.

NFR9: Keyboard users must be able to reach sidebar navigation, filters, upload controls, anomaly detail actions, chat input, and export buttons.

NFR10: Text in compact cards must not truncate critical values without tooltip or detail access.

NFR11: The desktop-first app must remain usable on tablet and mobile by collapsing sidebar/detail patterns and preserving task completion over visual similarity.

### Additional Requirements

- Initialize the product from the Supabase `with-supabase` Next.js template, then add shadcn/ui.
- Use TypeScript, Next.js App Router, Tailwind CSS, and shadcn/ui for the product UI.
- Use Supabase/Postgres as the system of record for users, organizations, projects, documents, chunks, extraction runs, extracted facts, evidence links, anomalies, recommendations, reports, audit events, and AI jobs.
- Use Supabase Auth plus Postgres Row Level Security for project-scoped access.
- Use Supabase Storage for uploaded Project Evidence and generated reports.
- Use pgvector inside Supabase/Postgres for MVP document chunk embeddings and retrieval.
- Use Supabase migrations from the beginning for schema, RLS policies, storage policies, functions, and seed data.
- Use n8n only as AI/document workflow orchestration, not as the system of record.
- Add a separate worker/service boundary for heavy document and AI processing.
- Store AI job state in Supabase using the shared statuses: queued, processing, needs_review, completed, failed, cancelled.
- Keep health scoring, anomaly severity, permission checks, and report provenance in versioned application/backend logic or database-controlled logic, not only in n8n workflows.
- Organize the frontend by product domain: dashboard, documents, anomalies, assistant, reports, projects, auth, and app shell.
- Route authenticated modules under `/app/projects/[projectId]/...`.
- Add RLS policies before real project data is added.
- Add evidence provenance schema before AI extraction, assistant answers, or report generation.
- Add project-scoped API routes/server actions for uploads, AI jobs, assistant queries, and reports.
- Export and version n8n workflow JSON for document ingestion, extraction/summary, anomaly detection, and report generation.
- Include tests for e2e flows, integration behavior, RLS policy validation, and fixtures.
- Defer portfolio analytics, predictive model serving, data warehouse/feature store, enterprise SSO, and native ERP/schedule/DMS integrations until after MVP.

### UX Design Requirements

UX-DR1: Implement a public landing page that introduces Project Assurance/X-Assurance, communicates evidence-based project assurance, shows trust cues, and routes users to login.

UX-DR2: Implement login/auth behavior where logged-in users proceed to assigned project selection or last active project, and logged-out users can only access landing/login.

UX-DR3: Implement project selection for users with assigned projects, including user identity, role context, project list/grid, project health summary where available, and empty state for no assigned projects.

UX-DR4: Implement project-scoped role behavior where navigation may be shared but actions differ by role; sponsors/steering committee see fewer editing controls, while PMC/PMO users can upload, review, correct, generate reports, and triage.

UX-DR5: Implement a persistent authenticated app shell with sidebar, top bar, notification icon, user identity, active project context, active navigation highlight, and collapsible sidebar.

UX-DR6: Implement the exact five authenticated sidebar modules: Dashboard, Documents, Anomalies, AI Assistant, and Reports.

UX-DR7: Apply the `DESIGN.md` token system for navy shell, white panels, semantic status colors, Inter/system typography, 8px default card radius, compact spacing, and blue primary actions.

UX-DR8: Implement semantic status color behavior: green for healthy/favorable, orange for amber/attention/medium, red for high risk/critical/failed, purple for governance, teal for audit readiness, and blue for navigation/info/action.

UX-DR9: Implement metric cards with icon, label, value, short status/trend phrase, semantic color, and insufficient-evidence fallback.

UX-DR10: Implement evidence-oriented charts with green/orange/red threshold bands and tooltips that show date, score, status, and evidence coverage when available.

UX-DR11: Implement compact lists/tables with leading semantic icon, title, subtype, metadata, status/severity badge, and progressive disclosure into detail panes.

UX-DR12: Implement evidence source rows with document icon/type, document title, supporting excerpt, page/sheet/location metadata, confidence score, and source category badge.

UX-DR13: Implement AI chat with assistant messages aligned left, user prompts aligned right, suggested prompts, source controls, and evidence/recommendation side panels.

UX-DR14: Implement Report Generation as a three-column workspace: report type selector, report preview, and settings/evidence panel.

UX-DR15: Implement Dashboard page with project selector/context, date range, filters, health cards, Project Health Trend chart, Critical Alerts list, and Top Recommended Actions list.

UX-DR16: Implement Document Intelligence page with upload action/drag-drop area, document library, extracted information grouped by risks/issues/milestones/decisions/owners-actions, summary, confidence, and source/evidence panel.

UX-DR17: Implement Anomaly Detection page with category filters, sorting, anomaly list, detail pane, evidence, impact, recommendations, suggested owners, Create Action, and Mark as Reviewed.

UX-DR18: Implement AI Assistant page with chat history, suggested prompts, evidence/sources panel, recommendations/next actions panel, source expansion, and insufficient-evidence responses.

UX-DR19: Implement Report Generation page with report type selector, preview, included evidence, report settings, PDF/DOCX/share export actions, and evidence-preserving export behavior.

UX-DR20: Implement empty states for no projects, no documents, no anomalies, no reports, and no assistant history.

UX-DR21: Implement loading states using route-level loading, skeleton cards/rows, and inline job processing indicators without blocking the entire project workspace for one processing item.

UX-DR22: Implement error states for upload failure, processing failure, insufficient evidence, and unauthorized access without leaking sensitive internal details.

UX-DR23: Implement AI output review states: Draft, Needs review, Reviewed, Edited, and Exported.

UX-DR24: Ensure icon buttons have accessible labels/tooltips and focus states are visible against navy and white surfaces.

UX-DR25: Ensure desktop-first layouts adapt to tablet and mobile by collapsing sidebar/detail panels and using full-screen detail views where needed.

### FR Coverage Map

FR1: Epic 2 - Upload Project Evidence into a project workspace.

FR2: Epic 2 - Classify uploaded evidence by document type.

FR3: Epic 2 - Parse, chunk, and prepare evidence for traceable analysis.

FR4: Epic 2 - Extract project facts from evidence.

FR5: Epic 2 - Review and correct extracted facts.

FR6: Epic 2 - Generate document and document-set summaries.

FR7: Epic 3 - Generate quick project insight across selected evidence.

FR8: Epic 4 - Detect missing accountability.

FR9: Epic 4 - Detect inconsistent status signals.

FR10: Epic 4 - Detect governance gaps.

FR11: Epic 4 - Prioritize anomalies.

FR12: Epic 3 - Show overall project health.

FR13: Epic 3 - Surface critical alerts.

FR14: Epic 3 and Epic 4 - Show action priorities on dashboard and support anomaly-to-action triage.

FR15: Epic 5 - Ask project questions naturally.

FR16: Epic 5 - Return evidence-grounded answers.

FR17: Epic 6 - Generate executive summaries.

FR18: Epic 6 - Generate assurance reports.

FR19: Epic 6 - Export management-ready output.

## Epic List

### Epic 1: Authenticated Project Workspace

Users can land on the product, log in, see assigned projects, and enter a project-scoped assurance workspace with role-aware navigation.

**FRs covered:** Supports FR1-FR19 through access foundations; no direct PRD feature FR is complete without this base.

### Epic 2: Project Evidence Library and Document Intelligence

PMC/PMO users can upload, classify, process, review, and summarize Project Evidence with source traceability.

**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR6

### Epic 3: Evidence-Based Project Health and Executive Dashboard

PMO, sponsor, and steering committee users can view project health, alerts, trends, and recommended actions from processed evidence.

**FRs covered:** FR7, FR12, FR13, FR14

### Epic 4: Anomaly Detection and Management Action Triage

Project users can detect, inspect, prioritize, review, and convert anomalies into accountable management actions.

**FRs covered:** FR8, FR9, FR10, FR11, FR14

### Epic 5: Source-Grounded AI Assistant

Authorized users can ask project questions and receive source-grounded answers with evidence, uncertainty, and recommended next actions.

**FRs covered:** FR15, FR16

### Epic 6: Report Generation and Export

PMC/PMO users can generate, review, edit, and export executive-ready reports with included evidence and provenance.

**FRs covered:** FR17, FR18, FR19

## Epic 1: Authenticated Project Workspace

Users can land on the product, log in, see assigned projects, and enter a project-scoped assurance workspace with role-aware navigation.

### Story 1.1: Initialize Product Application Foundation

As a product team,
I want the Next.js, Supabase, and shadcn/ui foundation initialized,
So that all later product work follows the agreed architecture.

**Acceptance Criteria:**

**Given** an empty repository
**When** the project is initialized
**Then** it uses the Supabase `with-supabase` Next.js template and shadcn/ui
**And** TypeScript, Tailwind, Supabase clients, middleware, and app route structure are present.

**Given** the architecture document
**When** folders are created
**Then** the project uses `src/app`, `src/features`, `src/components`, `src/lib`, `supabase`, `workflows`, `worker`, and `tests` boundaries.

### Story 1.2: Public Landing and Login Entry

As a logged-out user,
I want a landing page and login path,
So that I understand the product and can access my project workspace.

**Acceptance Criteria:**

**Given** a logged-out visitor
**When** they open `/`
**Then** they see product name, evidence-based assurance message, trust cues, and login call to action.

**Given** a logged-out visitor
**When** they access protected app routes
**Then** they are redirected to login without exposing protected project data.

### Story 1.3: Project-Scoped User and Role Model

As an administrator,
I want users assigned to organizations and projects with project-scoped roles,
So that access can vary per project.

**Acceptance Criteria:**

**Given** Supabase migrations run
**When** the auth foundation is installed
**Then** profiles, organizations, projects, and project_members tables exist with RLS enabled.

**Given** a user belongs to one project
**When** they query project data
**Then** only assigned project records are returned.

### Story 1.4: Assigned Project Selection

As an authenticated user,
I want to see my assigned projects after login,
So that I can enter the correct assurance workspace.

**Acceptance Criteria:**

**Given** a user has multiple assigned projects
**When** they log in
**Then** `/app/projects` lists assigned projects with role context and health summary placeholders.

**Given** a user has no assigned projects
**When** they log in
**Then** they see an access empty state telling them to contact an admin.

### Story 1.5: Project App Shell and Role-Aware Navigation

As an authenticated project user,
I want a persistent project-scoped app shell,
So that I can move between assurance modules consistently.

**Acceptance Criteria:**

**Given** a user opens an assigned project
**When** the app shell renders
**Then** it shows sidebar, top bar, active project context, user identity, notifications area, and active navigation state.

**Given** a user's project role
**When** the shell renders actions
**Then** restricted actions are hidden or disabled in the UI and still enforced by backend authorization.

## Epic 2: Project Evidence Library and Document Intelligence

PMC/PMO users can upload, classify, process, review, and summarize Project Evidence with source traceability.

### Story 2.1: Evidence Upload and Document Library

As a PMC/PMO user,
I want to upload and view project evidence documents,
So that project assurance starts from centralized source material.

**Acceptance Criteria:**

**Given** a user with upload permission
**When** they upload a PDF document
**Then** the file is stored in Supabase Storage and a documents record is created with project, type, date, uploader, and processing status.

**Given** a document upload fails
**When** the UI receives the failure
**Then** the document is not sent to downstream processing and the user sees a retryable error.

### Story 2.2: Document Classification and Processing Status

As a PMC/PMO user,
I want to classify documents and see processing state,
So that evidence can be organized before analysis.

**Acceptance Criteria:**

**Given** an uploaded document
**When** the user chooses a document type
**Then** the document is classified as exactly one primary type.

**Given** documents are processing
**When** the library renders
**Then** each row shows file type, size/date, processing status, and available actions without blocking the workspace.

### Story 2.3: Document Parsing, Chunking, and Evidence Links

As a PMC/PMO user,
I want uploaded documents parsed into traceable chunks,
So that later AI outputs can cite their sources.

**Acceptance Criteria:**

**Given** a document is queued for processing
**When** the worker/n8n pipeline parses it
**Then** searchable text and document_chunks records are created with document ID and page/section metadata where available.

**Given** parsing fails
**When** the job ends
**Then** ai_jobs records a failed status, error code, and user-safe error message.

### Story 2.4: Extracted Information Panel

As a PMC/PMO user,
I want extracted risks, issues, milestones, decisions, owners, and actions grouped clearly,
So that I can review project facts quickly.

**Acceptance Criteria:**

**Given** processed evidence exists
**When** extraction completes
**Then** extracted facts are grouped by risk, issue, milestone, decision, and owner/action with confidence and Evidence Links.

**Given** a user edits an extracted fact
**When** the edit is saved
**Then** original value, edited value, and AI/user confirmation state are preserved.

### Story 2.5: Source-Grounded Document Summary

As a PMC/PMO user,
I want a source-grounded summary of selected documents,
So that I can understand project evidence without reading every page.

**Acceptance Criteria:**

**Given** selected documents have processed chunks and facts
**When** the user generates a summary
**Then** the summary includes key points, risks/issues, decisions, action items, confidence, and source references.

**Given** evidence is ambiguous or incomplete
**When** the summary renders
**Then** the UI shows a confidence or quality warning.

## Epic 3: Evidence-Based Project Health and Executive Dashboard

PMO, sponsor, and steering committee users can view project health, alerts, trends, and recommended actions from processed evidence.

### Story 3.1: Dashboard Health Cards

As a sponsor or PMO user,
I want project health summarized across key dimensions,
So that I can scan project condition quickly.

**Acceptance Criteria:**

**Given** project evidence and findings exist
**When** the dashboard loads
**Then** it shows Overall Health, Schedule, Cost, Risk, Governance, and Audit Readiness cards.

**Given** evidence is insufficient for a dimension
**When** the card renders
**Then** it shows insufficient evidence rather than a fabricated score.

### Story 3.2: Project Health Trend

As a sponsor or PMO user,
I want to see health trend over a reporting period,
So that I can understand whether the project is improving or deteriorating.

**Acceptance Criteria:**

**Given** health history exists
**When** the trend chart renders
**Then** it shows score over time with green, amber, and red threshold bands.

**Given** a user hovers a point
**When** tooltip appears
**Then** it shows date, score, status, and evidence coverage where available.

### Story 3.3: Critical Alerts

As a sponsor or PMO user,
I want critical alerts surfaced on the dashboard,
So that I can focus on urgent project issues.

**Acceptance Criteria:**

**Given** high priority anomalies exist
**When** the dashboard loads
**Then** critical alerts show severity, impacted area, explanation, evidence count, and recommended action.

**Given** a user selects an alert
**When** detail is requested
**Then** the app routes to the related anomaly or evidence context.

### Story 3.4: Recommended Actions Summary

As a project leader,
I want recommended actions summarized on the dashboard,
So that analysis turns into management follow-up.

**Acceptance Criteria:**

**Given** recommendations exist
**When** the dashboard loads
**Then** top recommended actions show owner, due date, priority, and source finding where available.

**Given** an action is missing owner or due date
**When** it renders
**Then** it is flagged as incomplete.

## Epic 4: Anomaly Detection and Management Action Triage

Project users can detect, inspect, prioritize, review, and convert anomalies into accountable management actions.

### Story 4.1: Anomaly Detection Rules for Missing Accountability

As a PMO reviewer,
I want the system to flag missing owners, due dates, statuses, and escalation paths,
So that accountability gaps are visible early.

**Acceptance Criteria:**

**Given** extracted facts include risks, issues, decisions, or actions
**When** required accountability fields are missing
**Then** an anomaly is created with missing field, affected item, severity, and Evidence Link.

**Given** a user marks an anomaly false positive
**When** the change is saved
**Then** anomaly status and audit event are recorded.

### Story 4.2: Inconsistent Status and Governance Gap Detection

As a PMO reviewer,
I want the system to flag inconsistent project signals and governance gaps,
So that optimistic reporting can be challenged with evidence.

**Acceptance Criteria:**

**Given** evidence includes schedule, cost, risk, and governance references
**When** delay, cost variance, overdue issue, missing approval, or missing review evidence is detected
**Then** an anomaly is created with compared evidence, explanation, severity, and recommended action.

**Given** the system cannot distinguish absence from confirmed missing
**When** it reports a governance gap
**Then** the finding labels "not found in evidence" separately from "confirmed missing."

### Story 4.3: Anomaly Review Workspace

As a Project Manager,
I want to filter, sort, and inspect anomalies,
So that I can decide which findings need action.

**Acceptance Criteria:**

**Given** anomalies exist
**When** the Anomalies page loads
**Then** users can filter by category, sort by severity, and select a row to open detail.

**Given** an anomaly is selected
**When** the detail pane opens
**Then** it shows evidence, impact, impact rating, recommended action, and suggested owners.

### Story 4.4: Create and Review Management Actions

As a Project Manager,
I want to convert anomalies into assigned actions,
So that findings become accountable follow-up.

**Acceptance Criteria:**

**Given** an anomaly detail is open
**When** the user creates an action
**Then** the action captures owner, due date, source anomaly, priority, and status.

**Given** the user marks an anomaly reviewed
**When** the action completes
**Then** review state and audit event are recorded.

## Epic 5: Source-Grounded AI Assistant

Authorized users can ask project questions and receive source-grounded answers with evidence, uncertainty, and recommended next actions.

### Story 5.1: Project-Scoped Assistant Chat

As an authorized project user,
I want to ask natural language questions about my project,
So that I can understand status, risk, cost, schedule, governance, and escalation needs.

**Acceptance Criteria:**

**Given** a user is assigned to a project
**When** they ask a question in the AI Assistant
**Then** the assistant only retrieves from that project workspace and associated Governance Reference.

**Given** the user asks an unsupported or insufficiently evidenced question
**When** the assistant responds
**Then** it states insufficient evidence instead of fabricating an answer.

### Story 5.2: Evidence-Grounded Answers and Source Controls

As a PMO reviewer,
I want assistant answers to expose sources and uncertainty,
So that I can validate the answer before acting on it.

**Acceptance Criteria:**

**Given** an assistant answer includes factual claims
**When** the response renders
**Then** every factual claim has Evidence Links or is marked as inference.

**Given** a user expands sources
**When** source controls open
**Then** cited documents, excerpts, page/sheet metadata, and confidence are visible.

### Story 5.3: Suggested Prompts and Recommendations Panel

As a project user,
I want suggested prompts and next actions,
So that I can quickly ask useful project assurance questions.

**Acceptance Criteria:**

**Given** the assistant page loads
**When** no question is active
**Then** suggested prompts are visible for project health, escalation, and weekly risk summary.

**Given** the assistant identifies recommended actions
**When** the answer renders
**Then** next actions appear with owner/priority where available and source evidence links.

## Epic 6: Report Generation and Export

PMC/PMO users can generate, review, edit, and export executive-ready reports with included evidence and provenance.

### Story 6.1: Report Type Selection and Settings

As a PMC/PMO user,
I want to choose report type and settings,
So that the output matches the intended management audience.

**Acceptance Criteria:**

**Given** the Reports page opens
**When** the user selects a report type
**Then** Executive Summary, Assurance Report, Governance Gap Report, and Risk & Issue Summary options are available.

**Given** a report type is selected
**When** settings render
**Then** reporting period, program/project, audience, and detail level are configurable.

### Story 6.2: Evidence-Included Report Preview

As a PMC/PMO user,
I want to preview generated report content and included evidence,
So that I can review before export.

**Acceptance Criteria:**

**Given** processed evidence, findings, and recommendations exist
**When** the report preview is generated
**Then** it includes project health, key findings, critical risks, governance gaps, recommended actions, and included evidence counts.

**Given** generated content is AI-produced
**When** it appears in preview
**Then** the UI distinguishes draft AI-generated content from user-edited content.

### Story 6.3: Edit, Export, and Audit Report Output

As a PMC/PMO user,
I want to edit and export report outputs,
So that I can share management-ready evidence-backed reports.

**Acceptance Criteria:**

**Given** a report preview exists
**When** the user edits content
**Then** edits are saved and original AI-generated content remains auditable.

**Given** a user exports a report
**When** PDF or DOCX export completes
**Then** the report includes project name, reporting period, generation date, evidence appendix, and export audit event.
