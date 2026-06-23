---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments:
  - planning-artifacts/prds/prd-x-assistance-2026-06-08/prd.md
  - planning-artifacts/prds/prd-x-assistance-2026-06-08/addendum.md
workflowType: architecture
lastStep: 8
status: complete
completedAt: 2026-06-08
project_name: X-Assurance / X-Assistance
user_name: kasyf
date: 2026-06-08
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Step 1: Workflow Initialization

Architecture workflow initialized from the current PRD and addendum.

**Input documents loaded:**

- `planning-artifacts/prds/prd-x-assistance-2026-06-08/prd.md`
- `planning-artifacts/prds/prd-x-assistance-2026-06-08/addendum.md`

**Initial user stack proposal:**

- React as frontend base.
- Supabase as application backend/data platform.
- n8n for AI workflow orchestration.

**Initial architecture stance:**

Supabase + React/Next.js + n8n is acceptable for prototype and Commercial MVP if n8n is treated as an orchestration layer, not the system of record or sole owner of product rules. Core project state, permissions, audit trail, evidence provenance, extracted facts, findings, reports, and user edits should remain in Supabase/Postgres or versioned backend code.

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
The PRD defines 19 functional requirements across project evidence ingestion, information extraction, document summarization, anomaly detection, executive dashboarding, AI assistant behavior, and report generation. The UX input adds a required landing/login flow, role-based access, per-user project assignment, and five authenticated product modules: Dashboard, Documents, Anomalies, AI Assistant, and Reports.

Architecturally, the product needs:

- A multi-project application model where users only see assigned projects.
- Role-aware navigation and permissions for PM, PMO, sponsor, steering committee, and PMC consultant users.
- Document upload, storage, parsing, chunking, embedding, and extraction workflows.
- Durable AI job status tracking.
- Evidence links from generated insight back to source documents.
- Reviewable extracted facts, anomalies, recommendations, and reports.
- Dashboard read models optimized for executive overview cards, trend charts, critical alerts, and recommended actions.

**Non-Functional Requirements:**
The most important NFRs are evidence traceability, permission boundaries, human review, explainability, audit trail, and model behavior controls. These should shape the architecture more than UI convenience.

**Scale & Complexity:**

- Primary domain: full-stack web application with AI-assisted document intelligence.
- Complexity level: medium-high for MVP; enterprise-sensitive if deployed for oil-and-gas/government project data.
- Estimated architectural components: frontend, auth/access layer, database, storage, vector search, AI orchestration, worker service, rules engine, report generation, audit log, governance configuration.

### Technical Constraints & Dependencies

The proposed stack is acceptable for prototype and Commercial MVP if responsibilities stay clear:

- React/Next.js owns the product UI.
- Supabase owns auth, database, storage, RLS, project data, evidence metadata, extracted facts, findings, reports, and audit state.
- n8n orchestrates AI/document workflows but does not become the system of record.
- Business-critical rules such as permission checks, health scoring, severity logic, and audit provenance should live in versioned backend code or database-controlled logic.

### Cross-Cutting Concerns Identified

- Role-based access control and project membership.
- Multi-project data isolation.
- Evidence provenance for every AI-generated claim.
- Long-running background jobs for document parsing, OCR, embedding, extraction, anomaly detection, and report generation.
- Human review and correction loops.
- Sensitive document storage and retention.
- AI answer grounding and hallucination control.
- Dashboard performance for executive summary views.
- Exportable reports with evidence appendices.
- Future path for predictive analytics and portfolio dashboards without redesigning the MVP data model.

### Early Architecture Decision Candidates

#### ADR-001: Frontend Application Framework

Use React with Next.js rather than plain React.

#### ADR-002: System of Record

Use Supabase/Postgres as the system of record.

#### ADR-003: AI Workflow Orchestration

Use n8n to orchestrate AI/document workflows, but not as the system of record.

#### ADR-004: Document and AI Processing Boundary

Introduce a separate worker/service boundary for heavy processing, even if n8n coordinates it.

#### ADR-005: Evidence Provenance as a First-Class Data Model

Model Evidence Links, source excerpts, extraction runs, and generated claims explicitly in the database.

#### ADR-006: Rules and Health Scoring Ownership

Keep health scoring, anomaly severity, permission checks, and report provenance in versioned application/backend logic, not only in n8n workflows.

## Starter Template Evaluation

### Primary Technology Domain

Full-stack web application with AI-assisted document intelligence.

The product needs a public landing/login surface, an authenticated role-based application, per-user project workspaces, document upload, dashboard modules, AI assistant interaction, anomaly review, and report generation.

### Starter Options Considered

#### Option 1: Next.js official starter

Provides a clean Next.js foundation with TypeScript, Tailwind CSS, ESLint, App Router, Turbopack, and import alias support.

**Strengths:**

- Clean baseline.
- Flexible architecture.
- Strong fit for landing page plus authenticated app routing.

**Weaknesses:**

- Supabase auth/storage/RLS setup must be added manually.
- More initial integration work.

#### Option 2: Supabase `with-supabase` Next.js template

Provides a Next.js app preconfigured for Supabase, including cookie-based auth, TypeScript, and Tailwind CSS.

**Strengths:**

- Best fit for the selected Supabase system-of-record direction.
- Faster path to authenticated project workspaces.
- Reduces auth integration risk early.

**Weaknesses:**

- Still needs app-specific RBAC, project membership, RLS policies, schema, storage rules, and AI job architecture.
- UI system still needs to be added.

#### Option 3: Create T3 App

Provides a typesafe Next.js stack with optional tRPC, Prisma/Drizzle, Tailwind, and auth patterns.

**Strengths:**

- Strong TypeScript developer experience.
- Good for custom backend-heavy TypeScript applications.

**Weaknesses:**

- Less aligned with Supabase as the core platform.
- May introduce redundant backend/database abstractions for this MVP.

### Selected Starter: Supabase `with-supabase` Next.js Template

**Rationale for Selection:**
Use the Supabase template because the architecture already leans on Supabase Auth, Postgres, Storage, RLS, and pgvector. Starting from the official Supabase/Next.js template reduces early auth friction and keeps the app aligned with Supabase conventions.

**Initialization Command:**

```bash
npx create-next-app -e with-supabase x-assurance
cd x-assurance
npx shadcn@latest init
```

**Architectural Decisions Provided by Starter:**

**Language & Runtime:**

- TypeScript.
- Next.js App Router.
- React application model.

**Styling Solution:**

- Tailwind CSS from the Supabase template.
- shadcn/ui added for dashboard-grade components.

**Build Tooling:**

- Next.js build and development tooling.
- Turbopack-compatible development path from current Next.js defaults.

**Authentication Foundation:**

- Supabase cookie-based auth starter setup.
- Must be extended with role-based project access and RLS policies.

**Code Organization:**

- Public routes for landing/login.
- Authenticated app routes for dashboard, documents, anomalies, assistant, and reports.
- Supabase client/server utilities.
- App-specific modules should be organized by product domain, not only by UI route.

**Development Experience:**

- Fast local Next.js development.
- Supabase integration from the start.
- shadcn/ui components copied into the codebase for direct ownership and customization.

**Note:**
Project initialization using this command should be the first implementation story. The second implementation story should define the Supabase schema, RLS policies, and seed roles/projects before any AI workflow is added.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**

- Use Supabase/Postgres as the system of record.
- Use Supabase Auth with project membership and role-based access.
- Use Supabase Storage for uploaded project evidence and generated reports.
- Use explicit evidence provenance tables for documents, chunks, extracted facts, generated claims, findings, and reports.
- Use n8n only as workflow orchestration, with Supabase storing job state and outputs.
- Use a separate worker/service boundary for heavy document and AI processing.

**Important Decisions (Shape Architecture):**

- Use Next.js App Router for public and authenticated app routes.
- Use shadcn/ui for dashboard-grade UI components.
- Use pgvector inside Supabase/Postgres for MVP vector retrieval.
- Use versioned backend/rules code for health scoring, anomaly severity, permission checks, and report provenance.
- Use async job records for ingestion, extraction, embedding, anomaly detection, and report generation.

**Deferred Decisions (Post-MVP):**

- Portfolio analytics architecture.
- Predictive analytics model serving.
- Data warehouse / feature store.
- Native integrations with ERP, scheduling, contract, or DMS systems.
- Enterprise SSO until pilot deployment requirements are confirmed.

### Data Architecture

**Decision:** Supabase/Postgres is the system of record.

**Rationale:** The product is evidence-heavy and permission-sensitive. Relational modeling fits users, roles, projects, documents, extracted facts, anomalies, recommendations, reports, and audit events.

**Core data domains:**

- `profiles`
- `organizations`
- `projects`
- `project_members`
- `documents`
- `document_chunks`
- `extraction_runs`
- `extracted_facts`
- `evidence_links`
- `anomalies`
- `recommendations`
- `reports`
- `audit_events`
- `ai_jobs`

**Vector strategy:** Use Supabase pgvector for document chunk embeddings in MVP. Store embedding model name and embedding dimensions on the embedding records to avoid model mismatch issues.

**Migration approach:** Use Supabase migrations from the beginning. Schema, RLS policies, functions, and seed data should be versioned.

**Caching strategy:** Defer external caching for MVP. Use dashboard read models/materialized views only if query performance becomes an issue.

### Authentication & Security

**Decision:** Use Supabase Auth plus Postgres Row Level Security.

**Authorization model:**

- Users belong to organizations.
- Users are assigned to projects through `project_members`.
- Role is project-scoped, not only global.
- Suggested roles: `admin`, `pmc_consultant`, `pmo_reviewer`, `project_manager`, `sponsor`, `steering_committee`.

**Rationale:** The UX requires each user to see only their own assigned projects. RLS is the natural enforcement point for project isolation.

**Security rules:**

- Never trust frontend role checks alone.
- All project-scoped tables require RLS.
- Storage objects must be path-scoped by organization/project and checked through policies.
- n8n should use service credentials only for workflow execution, never end-user authorization.
- User-visible data returned from workflow outputs must be written back through controlled service paths.

### API & Communication Patterns

**Decision:** Use Next.js server actions/API routes for product operations; use n8n webhooks/internal calls for background workflow triggers.

**Patterns:**

- Frontend creates upload/job records through authenticated app routes.
- Supabase Storage stores files.
- App creates an `ai_jobs` record.
- n8n or worker picks up the job, processes documents, writes outputs back to Supabase.
- Frontend subscribes/polls job status from Supabase.

**API style:** Internal app APIs can be route handlers/server actions. External public API is out of scope for MVP.

**Error handling:** All AI workflows must write structured job states: `queued`, `processing`, `needs_review`, `completed`, `failed`, `cancelled`.

**Rate limiting:** Defer advanced rate limiting for MVP, but protect upload, assistant, and report generation endpoints with basic per-user/project limits before pilot.

### Frontend Architecture

**Decision:** Use Next.js App Router with route groups for public and authenticated surfaces.

**Proposed route structure:**

- `/` landing page.
- `/login`
- `/app/projects`
- `/app/projects/[projectId]/dashboard`
- `/app/projects/[projectId]/documents`
- `/app/projects/[projectId]/anomalies`
- `/app/projects/[projectId]/assistant`
- `/app/projects/[projectId]/reports`

**State management:** Start with server data fetching and local React state. Add TanStack Query only if client-side caching and job status polling become complex.

**Component architecture:** Organize by product domain:

- `features/dashboard`
- `features/documents`
- `features/anomalies`
- `features/assistant`
- `features/reports`
- `features/projects`
- `components/ui`

**UX implication:** Sidebar navigation should be project-scoped. Role controls should affect visible actions, not just visible routes.

### Infrastructure & Deployment

**Decision:** Use a deployment model that keeps the product app, Supabase, n8n, and worker boundary independently deployable.

**MVP deployment candidate:**

- Next.js on Vercel or similar.
- Supabase hosted project for Auth/Postgres/Storage/pgvector.
- n8n self-hosted or managed with queue mode when workflows grow.
- Worker service in Python/FastAPI or Node.js, depending on document/OCR tooling choice.

**n8n production constraint:** If n8n uses queue mode, use Redis and workers. Do not rely on filesystem binary storage in queue mode.

**Observability:** Minimum viable logs should cover upload events, job transitions, workflow failures, AI output generation, user edits, and report exports.

### Decision Impact Analysis

**Implementation Sequence:**

1. Initialize Next.js/Supabase/shadcn app.
2. Define Supabase schema, migrations, RLS, and seed roles/projects.
3. Build landing/login/project selection shell.
4. Build authenticated project layout and sidebar modules.
5. Implement document upload/storage/job creation.
6. Add n8n/worker ingestion pipeline.
7. Add extracted facts and evidence links.
8. Add anomaly detection and review queue.
9. Add dashboard read model.
10. Add AI Assistant retrieval and answer provenance.
11. Add report generation/export.

**Cross-Component Dependencies:**

- RLS must exist before real project data is added.
- Evidence provenance schema must exist before AI extraction/reporting.
- Job model must exist before n8n workflows are connected.
- Dashboard depends on extracted facts, anomalies, recommendations, and report state.
- AI Assistant depends on document chunks, embeddings, evidence links, and project-scoped authorization.

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

**Critical Conflict Points Identified:**
The main conflict risks are database naming, RLS policy assumptions, route organization, Supabase client usage, API response format, AI job status handling, evidence provenance structure, error handling, and UI state patterns.

### Naming Patterns

**Database Naming Conventions:**

- Use `snake_case` for table names and columns.
- Use plural table names: `projects`, `documents`, `extracted_facts`.
- Use `id` as the primary key column.
- Use `{table_singular}_id` for foreign keys: `project_id`, `document_id`, `organization_id`.
- Use timestamp columns as `created_at`, `updated_at`, `deleted_at`.
- Use enum/status fields as lowercase snake_case strings.

**Examples:**

- Good: `project_members`, `document_chunks`, `ai_jobs`
- Avoid: `ProjectMembers`, `documentChunks`, `tbl_documents`

**API Naming Conventions:**

- Use route paths that mirror product domains.
- Use lowercase kebab-case for URL segments.
- Use `projectId` in frontend route params because Next.js route params are JavaScript-facing.
- Use `project_id` in database and JSON persisted to Supabase.

**Examples:**

- `/app/projects/[projectId]/documents`
- `/api/projects/[projectId]/documents`
- `/api/projects/[projectId]/ai-jobs`

**Code Naming Conventions:**

- React components: `PascalCase`.
- Component files: `PascalCase.tsx` for reusable components.
- Feature modules and utility files: `kebab-case.ts` or descriptive lowercase folders.
- Functions and variables: `camelCase`.
- Database fields in TypeScript types should match Supabase generated types.

### Structure Patterns

**Project Organization:**

- Organize product code by feature/domain, not only by technical type.
- Keep shared UI primitives in `components/ui`.
- Keep domain components in `features/{domain}`.
- Keep Supabase utilities in `lib/supabase`.
- Keep validation schemas in `lib/validation` or inside the owning feature when feature-specific.
- Keep AI/rules helpers out of UI components.

**Suggested domains:**

- `features/projects`
- `features/dashboard`
- `features/documents`
- `features/anomalies`
- `features/assistant`
- `features/reports`
- `features/auth`

**Testing Pattern:**

- Co-locate unit/component tests beside the file when practical: `component.test.tsx`.
- Put integration/e2e tests in top-level `tests/`.
- RLS policy tests should live with Supabase/database test assets when introduced.

### Format Patterns

**API Response Formats:**
Use a consistent response wrapper for app-owned API routes:

```ts
type ApiSuccess<T> = {
  data: T;
  error: null;
};

type ApiFailure = {
  data: null;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};
```

**Data Exchange Formats:**

- Persisted database JSON uses `snake_case`.
- Frontend local objects may use `camelCase` only when not directly representing database rows.
- Dates crossing boundaries use ISO 8601 strings.
- Money/cost values must store numeric amount and currency separately.
- AI-generated text must store provenance metadata beside the generated content.

### Communication Patterns

**AI Job Status Pattern:**
Use the same status vocabulary everywhere:

- `queued`
- `processing`
- `needs_review`
- `completed`
- `failed`
- `cancelled`

**Event/Audit Naming:**
Use dot-separated lowercase event names:

- `document.uploaded`
- `document.processed`
- `fact.corrected`
- `anomaly.reviewed`
- `report.exported`
- `ai_job.failed`

**Event Payloads:**
Audit/event payloads must include:

- `actor_user_id`
- `organization_id`
- `project_id`
- affected entity ID
- event type
- timestamp
- metadata JSON

### Process Patterns

**Error Handling Patterns:**

- User-facing errors must be short, actionable, and not expose service secrets or internal stack traces.
- Workflow errors must be written to `ai_jobs.error_code` and `ai_jobs.error_message`.
- AI output uncertainty must be represented in the product UI, not hidden in logs.
- Failed AI jobs should be retryable unless the error is caused by unsupported input.

**Loading State Patterns:**

- Use route-level loading for page transitions.
- Use component-level skeletons for dashboard cards and document lists.
- Use job status indicators for document processing and report generation.
- Do not block the whole project workspace because one document is processing.

**Evidence Provenance Pattern:**
Any generated claim, summary, anomaly, assistant answer, or report section must reference one of:

- source document
- document chunk
- extracted fact
- governance reference
- explicit inference marker

Generated text without provenance must be treated as draft-only and not management-ready.

### Enforcement Guidelines

**All AI Agents MUST:**

- Use Supabase/Postgres as the system of record.
- Respect project-scoped authorization and RLS assumptions.
- Preserve Evidence Links for factual AI outputs.
- Use the shared AI job status vocabulary.
- Keep n8n orchestration separate from business-critical rule ownership.
- Avoid creating new naming conventions without updating this architecture document.

**Pattern Enforcement:**

- Schema changes must use migrations.
- New project-scoped tables must include RLS policies.
- New AI outputs must include provenance fields.
- New workflow states must be added to this document before implementation.
- New feature folders should follow the existing `features/{domain}` pattern.

### Pattern Examples

**Good Examples:**

- `documents.project_id`
- `document_chunks.document_id`
- `ai_jobs.status = 'processing'`
- `audit_events.event_type = 'document.uploaded'`
- `/app/projects/[projectId]/anomalies`

**Anti-Patterns:**

- Storing project files outside Supabase Storage without a document record.
- Returning AI assistant answers without Evidence Links.
- Adding role checks only in React components.
- Encoding health score rules only inside n8n workflows.
- Using both `projectId` and `project_id` interchangeably in persisted JSON.

## Project Structure & Boundaries

### Complete Project Directory Structure

```text
x-assurance/
├── README.md
├── package.json
├── next.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.mjs
├── components.json
├── middleware.ts
├── .env.example
├── .gitignore
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   │   ├── 0001_initial_schema.sql
│   │   ├── 0002_rls_policies.sql
│   │   ├── 0003_storage_policies.sql
│   │   └── 0004_seed_demo_data.sql
│   ├── functions/
│   │   └── README.md
│   └── seed.sql
├── workflows/
│   ├── n8n/
│   │   ├── document-ingestion.workflow.json
│   │   ├── extraction-and-summary.workflow.json
│   │   ├── anomaly-detection.workflow.json
│   │   └── report-generation.workflow.json
│   └── README.md
├── worker/
│   ├── README.md
│   ├── pyproject.toml
│   ├── .env.example
│   └── src/
│       ├── main.py
│       ├── jobs/
│       │   ├── ingest_document.py
│       │   ├── extract_facts.py
│       │   ├── generate_embeddings.py
│       │   ├── detect_anomalies.py
│       │   └── generate_report.py
│       ├── services/
│       │   ├── supabase_client.py
│       │   ├── document_parser.py
│       │   ├── embedding_service.py
│       │   ├── llm_service.py
│       │   └── report_renderer.py
│       └── rules/
│           ├── health_score.py
│           └── anomaly_severity.py
├── public/
│   └── assets/
├── src/
│   ├── app/
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── login/
│   │   │   └── page.tsx
│   │   ├── auth/
│   │   │   └── callback/
│   │   │       └── route.ts
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   └── projects/
│   │   │       ├── page.tsx
│   │   │       └── [projectId]/
│   │   │           ├── layout.tsx
│   │   │           ├── dashboard/
│   │   │           │   └── page.tsx
│   │   │           ├── documents/
│   │   │           │   └── page.tsx
│   │   │           ├── anomalies/
│   │   │           │   └── page.tsx
│   │   │           ├── assistant/
│   │   │           │   └── page.tsx
│   │   │           └── reports/
│   │   │               └── page.tsx
│   │   └── api/
│   │       └── projects/
│   │           └── [projectId]/
│   │               ├── documents/
│   │               │   └── route.ts
│   │               ├── ai-jobs/
│   │               │   └── route.ts
│   │               ├── assistant/
│   │               │   └── route.ts
│   │               └── reports/
│   │                   └── route.ts
│   ├── components/
│   │   ├── ui/
│   │   ├── app-shell/
│   │   │   ├── AppSidebar.tsx
│   │   │   ├── TopBar.tsx
│   │   │   └── ProjectSwitcher.tsx
│   │   └── shared/
│   ├── features/
│   │   ├── auth/
│   │   ├── projects/
│   │   ├── dashboard/
│   │   ├── documents/
│   │   ├── anomalies/
│   │   ├── assistant/
│   │   └── reports/
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts
│   │   │   ├── server.ts
│   │   │   ├── middleware.ts
│   │   │   └── types.ts
│   │   ├── auth/
│   │   │   ├── require-user.ts
│   │   │   └── require-project-role.ts
│   │   ├── api/
│   │   │   ├── responses.ts
│   │   │   └── errors.ts
│   │   ├── jobs/
│   │   │   ├── create-ai-job.ts
│   │   │   └── job-status.ts
│   │   ├── rules/
│   │   │   ├── health-score.ts
│   │   │   └── anomaly-severity.ts
│   │   └── utils.ts
│   └── types/
│       ├── database.types.ts
│       ├── api.ts
│       └── domain.ts
└── tests/
    ├── e2e/
    ├── integration/
    ├── rls/
    └── fixtures/
```

### Architectural Boundaries

**API Boundaries:**

- `src/app/api/projects/[projectId]/*` owns authenticated project-scoped product operations.
- API routes must verify project membership before creating uploads, jobs, assistant queries, or reports.
- Public external API is out of scope for MVP.

**Component Boundaries:**

- `components/ui` contains shadcn/ui primitives only.
- `components/app-shell` contains shared layout/navigation.
- `features/{domain}` contains product-specific UI and domain logic.
- Feature modules may use `lib/*` but should not reach into other feature internals.

**Service Boundaries:**

- Next.js app owns user-facing requests, auth-aware routing, and job creation.
- Supabase owns data persistence, auth, storage, RLS, and vector search.
- n8n owns workflow orchestration.
- `worker/` owns heavy document/AI processing and callable business rules.

**Data Boundaries:**

- Supabase tables are the source of truth.
- Supabase Storage stores uploaded evidence and generated report files.
- `document_chunks` and embedding records power retrieval.
- `ai_jobs` is the handshake between app, n8n, and worker.
- Reports and AI outputs must store provenance.

### Requirements to Structure Mapping

**Landing/Login and Role Access**

- Routes: `src/app/page.tsx`, `src/app/login/page.tsx`
- Auth callback: `src/app/auth/callback/route.ts`
- Guards: `src/lib/auth/*`
- Middleware: `middleware.ts`
- Tables: `profiles`, `organizations`, `project_members`

**Project Selection**

- Route: `src/app/app/projects/page.tsx`
- Feature: `src/features/projects`
- Tables: `projects`, `project_members`

**Executive Dashboard**

- Route: `src/app/app/projects/[projectId]/dashboard/page.tsx`
- Feature: `src/features/dashboard`
- Tables/views: `anomalies`, `recommendations`, `reports`, dashboard read views

**Document Intelligence**

- Route: `src/app/app/projects/[projectId]/documents/page.tsx`
- API: `src/app/api/projects/[projectId]/documents/route.ts`
- Feature: `src/features/documents`
- Worker jobs: `ingest_document.py`, `extract_facts.py`, `generate_embeddings.py`
- Tables: `documents`, `document_chunks`, `extraction_runs`, `extracted_facts`, `evidence_links`

**Anomaly Detection**

- Route: `src/app/app/projects/[projectId]/anomalies/page.tsx`
- Feature: `src/features/anomalies`
- Worker jobs: `detect_anomalies.py`
- Rules: `src/lib/rules/anomaly-severity.ts`, `worker/src/rules/anomaly_severity.py`
- Tables: `anomalies`, `recommendations`, `audit_events`

**AI Assistant**

- Route: `src/app/app/projects/[projectId]/assistant/page.tsx`
- API: `src/app/api/projects/[projectId]/assistant/route.ts`
- Feature: `src/features/assistant`
- Tables: `document_chunks`, `evidence_links`, `ai_jobs`
- External: LLM provider through worker/n8n

**Report Generation**

- Route: `src/app/app/projects/[projectId]/reports/page.tsx`
- API: `src/app/api/projects/[projectId]/reports/route.ts`
- Feature: `src/features/reports`
- Worker jobs: `generate_report.py`
- Tables/storage: `reports`, Supabase Storage report files

### Integration Points

**Internal Communication:**

- UI calls Next.js routes/server actions.
- Next.js writes records to Supabase and creates `ai_jobs`.
- n8n/worker processes jobs and writes results back to Supabase.
- UI reads job status and output records from Supabase.

**External Integrations:**

- Supabase Auth/Postgres/Storage/pgvector.
- n8n workflow runtime.
- LLM provider.
- OCR/parser service if PDFs require OCR.
- Future integrations with ERP/schedule/DMS remain out of MVP scope.

**Data Flow:**

1. User uploads document.
2. App stores file in Supabase Storage and creates `documents` + `ai_jobs`.
3. n8n/worker parses, chunks, embeds, extracts facts, and writes outputs.
4. Anomaly rules generate findings and recommendations.
5. Dashboard, assistant, and reports read from structured Supabase records.
6. User corrections and report exports create audit events.

### File Organization Patterns

**Configuration Files:**

- Root config files configure Next.js, TypeScript, Tailwind, shadcn/ui, and package scripts.
- Supabase config and migrations live under `supabase/`.
- n8n workflow exports live under `workflows/n8n/`.
- Worker config lives under `worker/`.

**Source Organization:**

- `src/app` contains routes.
- `src/features` contains domain modules.
- `src/components` contains reusable UI and app shell components.
- `src/lib` contains cross-cutting utilities, auth guards, API helpers, Supabase clients, jobs, and rules.
- `src/types` contains generated and shared types.

**Test Organization:**

- `tests/e2e` for Playwright user flows.
- `tests/integration` for API and job behavior.
- `tests/rls` for Supabase policy validation.
- `tests/fixtures` for sample project documents and seeded project data.

**Asset Organization:**

- Public static assets live under `public/assets`.
- Uploaded project evidence lives in Supabase Storage, not in the repo.
- Generated reports live in Supabase Storage and are referenced by `reports`.

### Development Workflow Integration

**Development Server Structure:**

- Next.js app runs as the main local product UI.
- Supabase local development should run migrations and seed data.
- n8n can run separately for workflow testing.
- Worker can run independently for document and AI jobs.

**Build Process Structure:**

- Next.js build validates frontend/server route code.
- Supabase migrations validate database evolution.
- Worker tests validate processing and rules behavior.
- n8n workflow JSON should be exported/versioned when workflow changes are made.

**Deployment Structure:**

- Next.js app deploys independently.
- Supabase project manages database, auth, storage, and vector search.
- n8n deploys as a separate workflow service.
- Worker deploys as a separate processing service.

## Architecture Validation Results

### Coherence Validation

**Decision Compatibility:**
The architecture decisions are compatible. Next.js, Supabase, shadcn/ui, n8n, and a separate worker boundary fit together cleanly if Supabase remains the system of record and n8n remains orchestration-only.

**Pattern Consistency:**
The implementation patterns support the architectural choices. Naming conventions, project-scoped authorization, AI job status vocabulary, evidence provenance, and feature-based organization are aligned with the selected stack.

**Structure Alignment:**
The proposed project structure supports the major product modules, authenticated routing, Supabase integration, n8n workflow export, worker processing, and testing boundaries.

### Requirements Coverage Validation

**Feature Coverage:**
All major PRD feature areas have architectural support:

- Landing/login and role access.
- Project selection.
- Executive Dashboard.
- Document Intelligence.
- Anomaly Detection.
- AI Assistant.
- Report Generation.

**Functional Requirements Coverage:**
The architecture supports all 19 PRD functional requirements at the component and service-boundary level.

**Non-Functional Requirements Coverage:**

- Evidence traceability is addressed through evidence links, document chunks, extracted facts, and provenance requirements.
- Permission boundaries are addressed through Supabase Auth, project membership, and RLS.
- Human review is addressed through reviewable facts, anomalies, recommendations, and reports.
- Explainability is addressed through provenance, rule ownership, and evidence-backed outputs.
- Auditability is addressed through `audit_events`.

### Implementation Readiness Validation

**Decision Completeness:**
Most implementation-blocking decisions are documented. The main open decisions are deployment model, LLM/OCR provider, exact worker runtime, report export stack, and whether health/anomaly rules have one canonical implementation or duplicated TypeScript/Python implementations.

**Structure Completeness:**
The project structure is specific enough for implementation. It includes app routes, feature domains, Supabase migrations, n8n workflows, worker services, tests, and integration boundaries.

**Pattern Completeness:**
Patterns are strong for naming, structure, API response shape, AI job status, audit events, error handling, loading states, and evidence provenance.

### Gap Analysis Results

**Critical Gaps:**

- Deployment model is not confirmed. Hosted Supabase/Vercel may not be acceptable for sensitive oil-and-gas or government project documents.
- LLM and OCR/document parsing providers are not selected. This affects cost, privacy, latency, language support, and deployment feasibility.
- Health scoring and anomaly severity canonical ownership needs one final decision. The document currently references both TypeScript and Python rule locations; this could cause drift if not governed.

**Important Gaps:**

- No UX spine artifacts exist yet (`DESIGN.md` / `EXPERIENCE.md`), although the user supplied screenshots and UX direction.
- Report rendering/export stack is not selected.
- RLS policy testing approach is identified but not specified in detail.
- Observability and alerting are minimum-level only.

**Nice-to-Have Gaps:**

- CI/CD workflow details.
- Local development Docker Compose for Supabase/n8n/worker.
- Architecture diagram.
- Threat model for sensitive document handling.

### Validation Issues Addressed

The architecture intentionally constrains n8n to orchestration and keeps business-critical state in Supabase/Postgres. This addresses the largest risk in the user’s original stack proposal.

The architecture also makes evidence provenance first-class, which is required for the product promise of evidence-based project assurance.

The remaining issues should be resolved before enterprise deployment, but they do not block prototype architecture.

### Architecture Completeness Checklist

**Requirements Analysis**

- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped

**Architectural Decisions**

- [ ] Critical decisions documented with versions
- [x] Technology stack fully specified
- [x] Integration patterns defined
- [ ] Performance considerations addressed

**Implementation Patterns**

- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified
- [x] Process patterns documented

**Project Structure**

- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment

**Overall Status:** READY WITH MINOR GAPS

**Confidence Level:** medium

**Key Strengths:**

- Clear system-of-record boundary.
- Good fit between UX modules and project structure.
- Strong evidence provenance requirement.
- RLS/project membership model aligns with role-based project access.
- n8n is used pragmatically without letting it own critical product state.

**Areas for Future Enhancement:**

- Confirm deployment model and data residency.
- Select LLM/OCR providers.
- Finalize canonical rules ownership.
- Create UX spines using `bmad-ux`.
- Add architecture diagram and threat model.
- Specify CI/CD and local development orchestration.

### Implementation Handoff

**AI Agent Guidelines:**

- Follow all architectural decisions exactly as documented.
- Use implementation patterns consistently across all components.
- Respect project structure and boundaries.
- Do not create project-scoped tables without RLS.
- Do not create AI-generated factual outputs without provenance.
- Do not move business-critical rules exclusively into n8n.

**First Implementation Priority:**

```bash
npx create-next-app -e with-supabase x-assurance
cd x-assurance
npx shadcn@latest init
```

After initialization, define the Supabase schema, migrations, RLS policies, storage policies, and seed demo users/projects before implementing AI workflows.
