---
baseline_commit: NO_VCS
---

# Story 1.1: Initialize Product Application Foundation

Status: review

## Story

As a product team,
I want the Next.js, Supabase, and shadcn/ui foundation initialized,
so that all later product work follows the agreed architecture.

## Acceptance Criteria

1. Given an empty repository, when the project is initialized, then it uses the Supabase `with-supabase` Next.js template and shadcn/ui, and TypeScript, Tailwind, Supabase clients, middleware, and app route structure are present.
2. Given the architecture document, when folders are created, then the project uses `src/app`, `src/features`, `src/components`, `src/lib`, `supabase`, `workflows`, `worker`, and `tests` boundaries.

## Tasks / Subtasks

- [x] Initialize the application from the agreed starter template (AC: 1)
  - [x] Verify local Node.js is compatible with current Next.js requirements before running setup.
  - [x] Run `npx create-next-app -e with-supabase x-assurance` from the repository root.
  - [x] Move generated app contents into the repository root only if the command creates a nested `x-assurance/` folder and the repository root is intended to be the app root.
  - [x] Preserve the generated Supabase client/server auth utilities instead of replacing them with custom auth code.
- [x] Install and configure shadcn/ui for the generated Next.js app (AC: 1)
  - [x] Run `npx shadcn@latest init`.
  - [x] Keep shadcn/ui primitives in `src/components/ui`.
  - [x] Verify `components.json` points to the agreed aliases and Tailwind setup.
- [x] Create architecture-aligned project directories (AC: 2)
  - [x] Create `src/features/{auth,projects,dashboard,documents,anomalies,assistant,reports}`.
  - [x] Create `src/components/app-shell` and `src/components/shared`.
  - [x] Create `src/lib/{auth,api,jobs,rules,supabase}`.
  - [x] Create `src/types`.
  - [x] Create `supabase/migrations`, `supabase/functions`, `workflows/n8n`, `worker/src/{jobs,services,rules}`, and `tests/{e2e,integration,rls,fixtures}`.
- [x] Add baseline placeholder/readme files only where needed to preserve empty directories (AC: 2)
  - [x] Add `README.md` files under `workflows/`, `workflows/n8n/`, and `worker/` describing ownership boundaries.
  - [x] Do not create product database tables in this story except files/directories needed for future migrations.
- [x] Verify baseline build and repository health (AC: 1, 2)
  - [x] Run package install if not already done by the starter.
  - [x] Run the app's lint/type/build checks that are available from generated `package.json`.
  - [x] Confirm no template placeholder routes conflict with the planned public `/`, `/login`, and authenticated `/app` route structure.

## Dev Notes

This story is a foundation story. Keep it limited to project initialization, dependency setup, and directory boundaries. Do not implement login UX, project selection, RLS policies, database tables, upload flows, AI workflows, dashboard cards, or report generation here; those belong to later stories.

### Story Source

From `planning-artifacts/epics.md`:

- Epic 1 goal: users can land on the product, log in, see assigned projects, and enter a project-scoped assurance workspace with role-aware navigation.
- Story 1.1 acceptance requires the Supabase `with-supabase` Next.js template, shadcn/ui, TypeScript, Tailwind, Supabase clients, middleware, app route structure, and the architecture-defined folder boundaries.

### Architecture Compliance

Follow `planning-artifacts/architecture.md`:

- Selected starter: Supabase `with-supabase` Next.js Template.
- Initialization command:

```bash
npx create-next-app -e with-supabase x-assurance
cd x-assurance
npx shadcn@latest init
```

- Primary stack: TypeScript, Next.js App Router, React, Tailwind CSS, shadcn/ui, Supabase Auth/Postgres/Storage/pgvector.
- Supabase/Postgres remains the system of record.
- n8n is workflow orchestration only and must not be introduced into the application runtime in this story.
- Heavy document/AI processing belongs under `worker/`, but this story only establishes the boundary.
- Keep app-specific code organized by product domain, not only by route.

### Required Project Structure

Create or preserve this top-level structure:

```text
supabase/
  migrations/
  functions/
workflows/
  n8n/
worker/
  src/
    jobs/
    services/
    rules/
src/
  app/
  components/
    ui/
    app-shell/
    shared/
  features/
    auth/
    projects/
    dashboard/
    documents/
    anomalies/
    assistant/
    reports/
  lib/
    auth/
    api/
    jobs/
    rules/
    supabase/
  types/
tests/
  e2e/
  integration/
  rls/
  fixtures/
```

If the starter generates equivalent Supabase utility paths, keep the generated files and adapt by adding wrapper folders only when needed. Do not duplicate Supabase clients in multiple incompatible places.

### Naming and Format Rules

Follow `planning-artifacts/architecture.md` implementation patterns:

- Database and migration artifacts use `snake_case`.
- React components use `PascalCase`.
- Feature folders use lowercase domain names.
- Product route params use `projectId`; persisted database fields use `project_id`.
- App-owned API responses later must use `{ data, error }`, but no custom API contract is required in this story.

### UX Requirements Relevant to This Story

From `planning-artifacts/ux-designs/ux-x-assurance-2026-06-08/DESIGN.md` and `EXPERIENCE.md`:

- The app must support a public landing/login surface and authenticated project-scoped app shell in later stories.
- The visual foundation must remain compatible with Tailwind/shadcn and the DESIGN.md token direction: navy shell, white panels, semantic status colors, compact enterprise density, Inter/system typography, and 8px default card radius.
- Preserve `src/components/ui` for shadcn primitives so later app shell and dashboard components have a stable component base.

### Latest Technical Information

- Next.js official installation docs currently state a minimum Node.js version of 20.9.0 for automatic installation.
- Supabase Auth with Next.js docs specify `npx create-next-app -e with-supabase` for a preconfigured Next.js app.
- shadcn/ui docs specify `npx shadcn@latest init` for adding shadcn/ui to an existing app.

### Implementation Boundaries

Do not:

- Create all database schema upfront.
- Build login/project pages beyond whatever the starter generates.
- Add n8n workflows beyond empty/versioned workflow directory placeholders.
- Implement Supabase RLS policies in this story.
- Add AI/LLM, OCR, document parsing, upload, or report logic.
- Replace the starter's Supabase SSR/cookie auth utilities with older auth-helper patterns.

Do:

- Keep generated starter code working.
- Create the folder boundaries required by architecture.
- Add minimal readme/placeholders for empty non-app directories.
- Ensure the initial app can build or at least run the starter's available validation commands.

### Testing Requirements

Run the validation scripts provided by generated `package.json`, prioritizing:

- dependency installation success
- lint
- type check if available
- build if available

If a check is unavailable, note it in completion notes rather than inventing a passing result. If a check fails due to missing environment variables, document the exact missing variables and add/update `.env.example`.

### References

- `planning-artifacts/epics.md` - Epic 1, Story 1.1
- `planning-artifacts/architecture.md` - Starter Template Evaluation, Core Architectural Decisions, Project Structure & Boundaries, Implementation Patterns & Consistency Rules
- `planning-artifacts/ux-designs/ux-x-assurance-2026-06-08/DESIGN.md` - token system and component direction
- `planning-artifacts/ux-designs/ux-x-assurance-2026-06-08/EXPERIENCE.md` - public/authenticated IA and app shell requirements
- Next.js docs: https://nextjs.org/docs/app/getting-started/installation
- Supabase Next.js auth quickstart: https://supabase.com/docs/guides/auth/quickstarts/nextjs
- shadcn/ui CLI docs: https://ui.shadcn.com/docs/cli

## Project Structure Notes

- This repository currently contains planning artifacts only. This story is expected to introduce the application codebase.
- There are no previous implemented stories, so no previous dev-agent file patterns exist yet.
- Because this is the first story, any directory/file patterns created here become precedent for later stories. Keep them aligned with the architecture document.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Node.js version check passed: v22.11.0.
- npm version check passed: 10.9.0.
- Git baseline unavailable because repository has no commits yet; recorded `baseline_commit: NO_VCS`.
- `npx create-next-app -e with-supabase x-assurance` completed and installed dependencies.
- Moved generated starter contents from nested `x-assurance/` into the repository root.
- `npx shadcn@latest init` detected existing `components.json` from the starter and left it in place.
- Updated `tsconfig.json` and `components.json` aliases/configuration after moving app code under `src/`.
- Added explicit ESLint ignores for generated build output and converted Tailwind plugin import to ESM.
- `npm run lint` passed.
- `npm run build` passed.

### Completion Notes List

- Initialized the Supabase Next.js starter with TypeScript, Tailwind, shadcn/ui primitives, Supabase SSR clients, root `proxy.ts`, and App Router auth/protected routes.
- Established the architecture boundaries under `src/`, `supabase/`, `workflows/`, `worker/`, and `tests/` using README and `.gitkeep` placeholders where no implementation belongs yet.
- Kept this story limited to foundation work. No product database schema, RLS policies, project UX, uploads, AI workflows, or report logic were introduced.
- Validation note: `npm run build` provides the available TypeScript validation. There is no separate type-check or test script in the generated `package.json`.
- Environment note: scaffold/npm emitted Node engine warnings for some latest CLI/transitive packages because local Node is v22.11.0. Validation still passed; upgrade to Node v22.13.0+ or v24 before sustained development.

### File List

- `.env.example`
- `.gitignore`
- `README.md`
- `components.json`
- `eslint.config.mjs`
- `implementation-artifacts/1-1-initialize-product-application-foundation.md`
- `next.config.ts`
- `package-lock.json`
- `package.json`
- `postcss.config.mjs`
- `proxy.ts`
- `src/app/auth/confirm/route.ts`
- `src/app/auth/error/page.tsx`
- `src/app/auth/forgot-password/page.tsx`
- `src/app/auth/login/page.tsx`
- `src/app/auth/sign-up/page.tsx`
- `src/app/auth/sign-up-success/page.tsx`
- `src/app/auth/update-password/page.tsx`
- `src/app/favicon.ico`
- `src/app/globals.css`
- `src/app/layout.tsx`
- `src/app/opengraph-image.png`
- `src/app/page.tsx`
- `src/app/protected/layout.tsx`
- `src/app/protected/page.tsx`
- `src/app/twitter-image.png`
- `src/components/app-shell/.gitkeep`
- `src/components/auth-button.tsx`
- `src/components/deploy-button.tsx`
- `src/components/env-var-warning.tsx`
- `src/components/forgot-password-form.tsx`
- `src/components/hero.tsx`
- `src/components/login-form.tsx`
- `src/components/logout-button.tsx`
- `src/components/next-logo.tsx`
- `src/components/shared/.gitkeep`
- `src/components/sign-up-form.tsx`
- `src/components/supabase-logo.tsx`
- `src/components/theme-switcher.tsx`
- `src/components/tutorial/code-block.tsx`
- `src/components/tutorial/connect-supabase-steps.tsx`
- `src/components/tutorial/fetch-data-steps.tsx`
- `src/components/tutorial/sign-up-user-steps.tsx`
- `src/components/tutorial/tutorial-step.tsx`
- `src/components/ui/badge.tsx`
- `src/components/ui/button.tsx`
- `src/components/ui/card.tsx`
- `src/components/ui/checkbox.tsx`
- `src/components/ui/dropdown-menu.tsx`
- `src/components/ui/input.tsx`
- `src/components/ui/label.tsx`
- `src/components/update-password-form.tsx`
- `src/features/anomalies/.gitkeep`
- `src/features/assistant/.gitkeep`
- `src/features/auth/.gitkeep`
- `src/features/dashboard/.gitkeep`
- `src/features/documents/.gitkeep`
- `src/features/projects/.gitkeep`
- `src/features/reports/.gitkeep`
- `src/lib/api/.gitkeep`
- `src/lib/auth/.gitkeep`
- `src/lib/jobs/.gitkeep`
- `src/lib/rules/.gitkeep`
- `src/lib/supabase/client.ts`
- `src/lib/supabase/middleware.ts`
- `src/lib/supabase/proxy.ts`
- `src/lib/supabase/server.ts`
- `src/lib/utils.ts`
- `src/types/.gitkeep`
- `supabase/functions/.gitkeep`
- `supabase/migrations/.gitkeep`
- `tailwind.config.ts`
- `tests/e2e/.gitkeep`
- `tests/fixtures/.gitkeep`
- `tests/integration/.gitkeep`
- `tests/rls/.gitkeep`
- `tsconfig.json`
- `worker/README.md`
- `worker/src/jobs/.gitkeep`
- `worker/src/rules/.gitkeep`
- `worker/src/services/.gitkeep`
- `workflows/README.md`
- `workflows/n8n/README.md`

### Change Log

- 2026-06-08: Implemented Story 1.1 foundation scaffold, architecture directories, placeholders, and passing lint/build validation.
