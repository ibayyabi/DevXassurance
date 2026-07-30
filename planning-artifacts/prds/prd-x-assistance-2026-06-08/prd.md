---
title: X-Assurance / X-Assistance
status: superseded-for-recovery
created: 2026-06-08
updated: 2026-07-21
superseded_by: ../../product-recovery/phase-3-usable-mvp-spec.md
source:
  - "C:/Users/kasyf/Downloads/[26-04] X-Assistance (Project_Assurance)-1.pdf"
---

# PRD: X-Assurance / X-Assistance

> **Recovery notice:** Product scope, terminology, workflow, health behavior, and UX decisions in this draft are superseded by [`phase-3-usable-mvp-spec.md`](../../product-recovery/phase-3-usable-mvp-spec.md). Retain this file as concept and planning history.

*Working title: X-Assurance. The user request and source filename use X-Assistance; product naming should be confirmed.*

## 0. Document Purpose

This PRD turns the provided concept deck into a buildable product requirements document for product, UX, architecture, and story planning. It captures the commercial MVP first, keeps advanced analytics as future scope, and indexes assumptions that require stakeholder confirmation before implementation.

## 1. Vision

X-Assurance is an AI Project Assurance Assistant for project management consulting teams, PMO teams, project sponsors, and steering committees. It turns scattered project evidence into evidence-based project health insight, early warnings, executive-ready findings, and recommended management actions.

The product addresses a common project control failure: organizations often have many reports but still miss the weak signals that show schedule, cost, governance, risk, or audit readiness is deteriorating. X-Assurance does not replace human project managers or consultants; it helps them review evidence faster, validate claims against source documents, detect anomalies earlier, and present findings in a management-ready format.

The MVP thesis is that project assurance becomes more reliable when document intelligence, anomaly checks, evidence traceability, and standardized executive reporting are delivered together in a focused workflow for PMC/PMO review.

## 2. Target Users

### 2.1 Jobs To Be Done

- As a Project Manager, identify project risks, issues, owners, due dates, and required actions quickly enough to intervene.
- As a PMO user, standardize project control reviews across documents, projects, reviewers, and reporting cycles.
- As a Project Sponsor, understand the true project health and priority management actions without reading every source document.
- As a Steering Committee member, gain visibility into strategic project status, critical anomalies, escalation needs, and evidence behind recommendations.
- As a PMC Consultant, review project documentation faster and produce consistent assurance reports without losing analytical depth.

### 2.2 Non-Users (v1)

- Field execution teams using the product as a day-to-day task management system.
- Finance teams using the product as the system of record for cost control.
- Planners using the product as the authoritative scheduling tool.
- Auditors expecting a full audit workpaper management platform.

### 2.3 Key User Journeys

- **UJ-1. Rina prepares a monthly assurance review.**
  Rina, a PMC consultant, uploads progress reports, meeting minutes, risk registers, issue logs, schedule extracts, and cost reports for a strategic project. The system extracts project facts, identifies missing owners and overdue actions, summarizes evidence-backed findings, and produces a draft assurance report. Rina reviews the evidence links, adjusts the wording, and exports a management-ready report for PMO review.

- **UJ-2. Budi checks project health before a steering committee meeting.**
  Budi, a project sponsor, opens the Executive Dashboard before a governance meeting. He sees overall project health across schedule, cost, risk, governance, and audit readiness. Critical alerts surface schedule delay, cost variance, vendor risk, and missing approval evidence. He opens the highest severity finding, reads the source-backed explanation, and decides which item needs escalation.

- **UJ-3. Sari asks the AI Assistant why the project status looks optimistic.**
  Sari, a PMO reviewer, asks a natural language question about whether the reported status is consistent with cost, progress, issue, and risk evidence. The assistant returns a concise answer with supporting source references, conflicting facts, and recommended follow-up questions for the project team.

- **UJ-4. Dimas reviews anomalies for corrective action.**
  Dimas, a Project Manager, opens the anomaly queue and filters high severity findings. He reviews missing owners, delayed actions without escalation, inconsistent cost-versus-progress signals, and governance gaps. For each finding, he sees evidence, impact, recommended action, and the accountable owner once assigned.

## 3. Glossary

- **AI Assistant** - Natural language interface that answers project questions using uploaded Project Evidence and source-grounded extracted facts.
- **Anomaly** - A condition that appears abnormal, inconsistent, missing, late, unapproved, or risky when compared across Project Evidence and Governance Reference rules.
- **Assurance Finding** - A structured finding that includes evidence, impact, severity, and recommended management action.
- **Commercial MVP** - First sellable product version focused on extraction improvements, quick insight, basic health checks, anomaly/gap detection, and dashboard delivery.
- **Evidence Link** - Traceable reference from an answer, summary, Anomaly, or Assurance Finding back to the source document and relevant excerpt or metadata.
- **Executive Dashboard** - Management-facing view of project health, critical alerts, anomalies, and action priorities.
- **Governance Reference** - SOPs, assurance templates, PMO controls, checklists, and project control standards used to evaluate Project Evidence.
- **Health Score** - A synthesized project health indicator across schedule, cost, risk, governance, scope, and audit readiness.
- **Management Action** - Recommended escalation, corrective action, mitigation, or attention point for PMO, sponsor, or steering committee decision-making.
- **Project Evidence** - Uploaded project documents and structured data such as progress reports, meeting minutes, risk registers, issue logs, schedules, cost reports, claims, approvals, and change records.
- **Report Generation** - Product capability that creates executive summaries, assurance reports, governance gap reports, and risk summaries.

## 4. Features

### 4.1 Project Evidence Ingestion

**Description:** Users upload and organize Project Evidence and Governance Reference documents. The system parses supported files, extracts metadata, and prepares content for extraction, search, summary, anomaly detection, and reporting. Realizes UJ-1.

**Functional Requirements:**

#### FR-1: Upload project evidence

PMC/PMO users can upload Project Evidence into a project workspace.

**Consequences (testable):**
- The system accepts at minimum PDF documents for MVP. [ASSUMPTION: PDF is the first required file type because the source deck explicitly references PDF reports.]
- Uploaded documents are associated with a project, document type, upload date, uploader, and processing status.
- Failed uploads show an actionable error state and do not enter downstream analysis.

#### FR-2: Organize evidence by document type

PMC/PMO users can classify uploaded documents as progress report, meeting minutes, risk register, issue log, schedule, cost report, approval, claim, change record, or Governance Reference.

**Consequences (testable):**
- Each uploaded document has exactly one primary document type.
- Users can filter the document repository by document type.
- The system flags unclassified documents before report generation.

#### FR-3: Process evidence for analysis

The system parses uploaded documents, extracts text, chunks content, and attaches metadata needed for traceability.

**Consequences (testable):**
- Each processed document exposes searchable text.
- Each chunk keeps document ID, page or section reference where available, and upload metadata.
- Downstream summaries, AI Assistant answers, and Assurance Findings can cite Evidence Links.

### 4.2 Information Extraction

**Description:** The system extracts key project facts from Project Evidence, including risks, issues, milestones, decisions, owners, due dates, action items, scope changes, claims, progress statements, and approvals. Realizes UJ-1, UJ-3, UJ-4.

**Functional Requirements:**

#### FR-4: Extract project entities

The system identifies project facts from processed Project Evidence.

**Consequences (testable):**
- Extraction output includes entity type, extracted text, source Evidence Link, confidence indicator, and timestamp.
- MVP extraction covers risk, issue, milestone, decision, owner, due date, and action item.
- Scope change, claim, approval, cost signal, and progress signal extraction are supported where document content provides enough structure. [ASSUMPTION: These are MVP-relevant because the source deck references FPSO project documents, claims, cost, progress, and approvals.]

#### FR-5: Review and correct extracted facts

PMC/PMO users can review extracted facts and correct incorrect type, owner, date, severity, or wording.

**Consequences (testable):**
- Corrected facts retain the original extracted value and the edited value.
- The system marks whether a fact is AI-extracted, user-confirmed, or user-edited.
- Corrected facts are used in summaries, anomaly detection, and generated reports.

### 4.3 Document Summarization and Quick Insight

**Description:** The system summarizes project charters, progress reports, meeting minutes, risk registers, and issue logs into concise, evidence-grounded insight. Realizes UJ-1, UJ-2, UJ-3.

**Functional Requirements:**

#### FR-6: Generate document summaries

PMC/PMO users can generate summaries for individual documents and selected document sets.

**Consequences (testable):**
- Each summary includes key points, risks/issues mentioned, decisions, action items, and relevant Evidence Links.
- Each summary exposes a confidence indicator or quality warning when source evidence is incomplete, ambiguous, or low quality.
- Users can regenerate a summary after document or extracted fact corrections.

#### FR-7: Generate quick project insight

The system generates a concise project insight view across selected Project Evidence.

**Consequences (testable):**
- Quick insight includes current project health narrative, critical risks/issues, overdue actions, governance gaps, and recommended Management Actions.
- Every generated insight references supporting Evidence Links.
- The system distinguishes evidence-backed statements from inferred recommendations.

### 4.4 Basic Health Check and Anomaly Detection

**Description:** The system detects abnormal or risky conditions across schedule, cost, risk, governance, scope, and audit evidence. Realizes UJ-2, UJ-3, UJ-4.

**Functional Requirements:**

#### FR-8: Detect missing accountability

The system flags risks, issues, decisions, and action items without owner, due date, status, or escalation path.

**Consequences (testable):**
- Findings identify the missing field, affected item, severity, and Evidence Link.
- Findings can be filtered by missing owner, missing due date, missing status, and missing escalation.
- Users can mark a finding as accepted, resolved, or false positive.

#### FR-9: Detect inconsistent status signals

The system flags inconsistencies between reported status and underlying evidence.

**Consequences (testable):**
- MVP checks include delay without escalation, overdue issue without action, cost variance without explanation, and progress claim inconsistent with schedule or cost evidence. [ASSUMPTION: These checks are feasible in MVP using document-derived facts rather than full project system integrations.]
- Each inconsistency includes compared evidence, explanation, severity, and recommended Management Action.
- Users can inspect all Evidence Links used to produce the finding.

#### FR-10: Detect governance gaps

The system compares Project Evidence against Governance Reference requirements and flags missing approvals, missing reports, missing review evidence, or incomplete assurance checklist items.

**Consequences (testable):**
- Users can upload or select a Governance Reference for the project workspace.
- A governance gap includes unmet requirement, related evidence, severity, and recommended next step.
- The system distinguishes "not found in evidence" from "confirmed missing."

#### FR-11: Prioritize anomalies

The system classifies Anomalies as High, Medium, or Low priority based on severity and likely project impact.

**Consequences (testable):**
- Each priority level has visible rationale.
- High priority findings appear first in the Executive Dashboard and anomaly queue.
- Users can override priority with a required reason.

### 4.5 Executive Dashboard

**Description:** The Executive Dashboard gives PMO, sponsors, and steering committee users one view of project health, early warnings, and action priorities. Realizes UJ-2, UJ-4.

**Functional Requirements:**

#### FR-12: Show overall project health

The dashboard presents project health across schedule, cost, risk, governance, and audit readiness.

**Consequences (testable):**
- Each health dimension shows current status, trend direction where available, and evidence coverage.
- Health Score calculations are explainable through underlying Anomalies, extracted facts, and Evidence Links.
- If evidence is insufficient, the dashboard shows "insufficient evidence" rather than a confident score.

#### FR-13: Surface critical alerts

The dashboard highlights urgent Anomalies and Management Actions.

**Consequences (testable):**
- High priority Anomalies are visible without navigating away from the dashboard.
- Each alert includes severity, impacted area, short explanation, Evidence Link count, and recommended Management Action.
- Alerts can be filtered by schedule, cost, risk, governance, scope, and audit readiness.

#### FR-14: Show action priorities

The dashboard converts analysis into a prioritized Management Action list for PMO, sponsor, and steering committee use.

**Consequences (testable):**
- Each Management Action has owner, due date, source finding, priority, and status where available.
- Actions can be exported or included in generated reports.
- Actions without owner or due date are flagged as incomplete.

### 4.6 AI Assistant for PMC

**Description:** Users ask natural language questions about project status, risks, cost, schedule, governance, and escalation needs. Answers are grounded in Project Evidence, not generic project management advice. Realizes UJ-3.

**Functional Requirements:**

#### FR-15: Ask project questions naturally

Authorized users can ask questions against a project workspace.

**Consequences (testable):**
- The assistant answers only from the selected project workspace and associated Governance Reference.
- The assistant can answer questions about status, risk, issue, cost, schedule, governance, evidence, and escalation needs.
- If evidence is insufficient, the assistant states what is missing instead of fabricating an answer.

#### FR-16: Return evidence-grounded answers

The assistant returns concise answers with source documents, supporting facts, and relevant excerpts.

**Consequences (testable):**
- Every factual claim in an answer has at least one Evidence Link or is marked as inference.
- The answer separates findings, evidence, uncertainty, and recommended next action.
- Users can open the cited source from the answer.

### 4.7 Report Generation

**Description:** The product generates structured executive summaries, assurance reports, governance gap reports, and risk summaries for management review. Realizes UJ-1, UJ-2.

**Functional Requirements:**

#### FR-17: Generate executive summary

PMC/PMO users can generate an executive summary for a selected reporting period.

**Consequences (testable):**
- The summary includes project health, key findings, critical risks, governance gaps, and recommended Management Actions.
- The generated content uses a consistent structure suitable for sponsor or steering committee review.
- Users can edit the summary before export.

#### FR-18: Generate assurance report

PMC/PMO users can generate a structured assurance report using extracted facts, summaries, Anomalies, and Governance Reference checks.

**Consequences (testable):**
- The report includes evidence-backed findings, severity, impact, recommendation, and source references.
- Users can include or exclude selected findings before export.
- The report preserves Evidence Links for auditability.

#### FR-19: Export management-ready output

Users can export generated reports for management distribution.

**Consequences (testable):**
- MVP supports at least PDF export. [ASSUMPTION: PDF export is required because management-ready reporting is central and source documents are PDF-oriented.]
- Exported reports include generation date, project name, reporting period, and evidence reference appendix.
- Exported reports distinguish AI-generated content from user-edited content.

## 5. Data Governance, Security, and Auditability

### 5.1 Cross-Cutting NFRs

- **NFR-1 Evidence traceability:** Every summary, answer, Anomaly, Assurance Finding, and generated report must preserve traceability to source Project Evidence whenever factual claims are made.
- **NFR-2 Permission boundaries:** Users must only access projects and documents they are authorized to view. [ASSUMPTION: Role-based access control is required for PMO/sponsor/committee separation.]
- **NFR-3 Human review:** AI-generated findings and reports must be reviewable and editable before external distribution.
- **NFR-4 Explainability:** Health Score, anomaly severity, and recommended Management Actions must expose enough rationale for PMO/PMC users to defend the finding.
- **NFR-5 Data retention:** Project Evidence, extracted facts, generated outputs, and user corrections must follow the client's retention policy. [NOTE FOR PM: Confirm whether SKK Migas, ENI, or oil-and-gas data governance rules impose specific retention, residency, or confidentiality requirements.]
- **NFR-6 Model behavior:** The system must not present unsupported conclusions as facts. Unsupported content must be labeled as inference, assumption, or insufficient evidence.

### 5.2 Audit Trail / Decision Provenance

- The system records upload events, processing status, generated outputs, user edits, finding status changes, priority overrides, and report exports.
- The system preserves original extracted text after user correction.
- Generated reports must show enough provenance for management and audit review.

## 6. Non-Goals (Explicit)

- X-Assurance is not a replacement for Project Managers, PMO analysts, PMC consultants, sponsors, or steering committees.
- MVP is not a full enterprise project management system.
- MVP is not the authoritative cost, schedule, or risk system of record.
- MVP does not include portfolio-level analytics.
- MVP does not include predictive cost, risk escalation, resource shortage, or health trend models.
- MVP does not include automated corrective action execution.
- MVP does not guarantee audit compliance without human review.
- MVP does not replace contractual, regulatory, or governance judgment.

## 7. MVP Scope

### 7.1 In Scope

- Project workspace for uploaded Project Evidence.
- PDF ingestion and text processing.
- Document classification and metadata.
- Extraction of risks, issues, milestones, decisions, owners, due dates, and action items.
- Review and correction of extracted facts.
- Document summaries and quick project insight.
- Basic health checks for missing owner, missing due date, missing escalation, inconsistent status, cost/progress inconsistency, and governance gaps.
- Anomaly queue with severity and impact prioritization.
- Executive Dashboard with health view, critical alerts, and action priorities.
- AI Assistant that answers project questions with Evidence Links.
- Executive summary and assurance report generation.
- Export-ready management output.

### 7.2 Out of Scope for MVP

- Trend analysis across multiple periods. Deferred to Product Enhancement or Advanced Intelligence.
- Predictive analytics for delay, cost escalation, resource shortage, or health trend. Deferred to Advanced Intelligence.
- Portfolio dashboard. Deferred to future development.
- Data warehouse, model store, and feature store. Deferred until the product needs historical analytics.
- Automated root-cause analysis using 5 Why, fishbone, or correlation discovery. Deferred to future development.
- Native integrations with scheduling, ERP, contract, or document management systems. [NOTE FOR PM: Integration priority should be decided after confirming target client environment.]
- Multi-project benchmarking. Deferred to portfolio-level insight.

## 8. Roadmap

### Phase 1: Prototype Validation

- Document upload.
- Data extraction.
- Basic anomaly check.
- Demo insight.

### Phase 2: Commercial MVP (Month 1-3)

- Extraction improvements.
- Summary and quick insight.
- Basic health check for anomaly and gap detection.
- Dashboard product.

### Phase 3: Product Enhancement

- Health report generation.
- Decision support system.
- Dashboard enhancement.
- PMO-ready assurance workflow.

### Phase 4: Advanced Intelligence

- Trend analysis.
- Predictive analytics.
- Portfolio-level insight.

## 9. Success Metrics

**Primary**

- **SM-1: Review cycle time reduction** - PMC/PMO users complete initial project evidence review at least 40% faster than manual review. Validates FR-4, FR-6, FR-8, FR-17, FR-18.
- **SM-2: Evidence-backed finding rate** - At least 90% of generated factual findings include usable Evidence Links. Validates FR-3, FR-7, FR-16, FR-18, NFR-1.
- **SM-3: Early warning usefulness** - At least 70% of high priority Anomalies reviewed by PMO/PMC users are accepted as valid or requiring follow-up. Validates FR-8, FR-9, FR-10, FR-11, FR-13.

**Secondary**

- **SM-4: Report preparation efficiency** - Users generate a management-ready draft report within one working session after evidence upload and review. Validates FR-17, FR-18, FR-19.
- **SM-5: Extraction correction rate** - Fewer than 25% of extracted core entities require user correction after MVP tuning. Validates FR-4, FR-5.
- **SM-6: Dashboard decision readiness** - Sponsors or steering committee users can identify top three project attention points from the dashboard without opening raw documents. Validates FR-12, FR-13, FR-14.

**Counter-metrics**

- **SM-C1: Unsupported answer rate** - Do not increase the number of AI answers without Evidence Links. Counterbalances SM-4 and speed optimization.
- **SM-C2: False high-severity rate** - Do not over-prioritize low-impact anomalies as high severity. Counterbalances SM-3.
- **SM-C3: User bypass rate** - Do not optimize report generation speed if users consistently rewrite or ignore generated outputs. Counterbalances SM-4.

## 10. Risks and Mitigations

- **Risk: Source evidence quality is inconsistent.** Mitigation: show processing status, confidence indicators, missing evidence warnings, and human review workflows.
- **Risk: AI output is treated as authoritative without review.** Mitigation: label AI-generated content, require review before export, and preserve Evidence Links.
- **Risk: Anomaly checks produce too many false positives.** Mitigation: start with explainable rule-based checks, severity rationale, user overrides, and false-positive feedback.
- **Risk: Governance requirements differ across clients.** Mitigation: make Governance Reference upload/configuration part of MVP and avoid hardcoding a single assurance standard.
- **Risk: Sensitive project documents require strict access control.** Mitigation: define RBAC, audit trail, retention, and deployment constraints before implementation.

## 11. Open Questions

1. Should the official product name be X-Assurance or X-Assistance?
2. Who is the first paying or pilot customer: internal ITB-BRIN/AISX, SKK Migas, ENI, a PMC consultancy, or a broader market segment?
3. Which document types must be supported on day one besides PDF?
4. Which language(s) must the product support for extraction, summaries, assistant answers, and reports: Indonesian, English, or both?
5. What is the required deployment model: SaaS, private cloud, on-premise, or client-managed environment?
6. What governance frameworks, SOPs, or assurance checklists must be supported for the FPSO KNH use case?
7. Which health score dimensions and weighting rules should be used for MVP?
8. What are the minimum acceptable extraction quality thresholds for risks, issues, owners, due dates, and action items?
9. What export formats are required for management outputs: PDF, DOCX, PPTX, Excel, or dashboard-only?
10. What user roles and approval permissions are required for PM, PMO, sponsor, steering committee, and PMC consultant users?
11. Should report generation be available in the Commercial MVP or Product Enhancement phase? The deck places "Report Generation" as a core capability but roadmap emphasizes it later as health report generation.

## 12. Assumptions Index

- FR-1 - PDF is the first required file type because the source deck explicitly references PDF reports.
- FR-4 - Scope change, claim, approval, cost signal, and progress signal extraction are MVP-relevant because the source deck references FPSO project documents, claims, cost, progress, and approvals.
- FR-9 - Basic inconsistency checks are feasible in MVP using document-derived facts rather than full project system integrations.
- FR-19 - PDF export is required because management-ready reporting is central and source documents are PDF-oriented.
- NFR-2 - Role-based access control is required for PMO/sponsor/committee separation.
