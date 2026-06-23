---
baseline_commit: NO_VCS
---

# Story 1.2: Public Landing and Login Entry

Status: review

## Story

As a logged-out user,
I want a landing page and login path,
so that I understand the product and can access my project workspace.

## Acceptance Criteria

1. Given a logged-out visitor, when they open `/`, then they see product name, evidence-based assurance message, trust cues, and login call to action.
2. Given a logged-out visitor, when they access protected app routes, then they are redirected to login without exposing protected project data.

## Tasks / Subtasks

- [x] Build public landing route at `/` (AC: 1)
  - [x] Use the product value proposition from PRD: evidence-based insight, early warning, executive-ready assurance.
  - [x] Include login CTA and minimal trust cues.
- [x] Build login entry route at `/login` using the Supabase auth foundation (AC: 1, 2)
  - [x] Preserve starter auth utilities instead of adding a separate auth library.
  - [x] Route successful sessions to `/app/projects`.
- [x] Protect authenticated route groups (AC: 2)
  - [x] Redirect logged-out access to `/login`.
  - [x] Avoid showing project existence, role names, or private data before auth.
- [x] Validate UX and access behavior (AC: 1, 2)
  - [x] Test logged-out `/`, `/login`, and protected `/app/projects` behavior.

## Dev Notes

- Depends on Story 1.1 application foundation.
- Use `src/app/page.tsx`, `src/app/login/page.tsx`, `src/app/auth/callback/route.ts`, and middleware/auth utilities from the starter.
- Landing should be a minimal product entry, not a large marketing site.
- Do not implement project selection UI beyond redirect target behavior; Story 1.4 owns assigned project selection.

### UX Guardrails

- Follow `DESIGN.md`: navy/blue brand direction, white panels, compact enterprise tone, Inter/system typography.
- Follow `EXPERIENCE.md`: landing introduces X-Assurance/Project Assurance and routes users to login; logged-in users continue to project selection or last active project.

### Testing Requirements

- Verify logged-out users can view `/` and `/login`.
- Verify logged-out users cannot view `/app/projects`.
- Verify login route does not expose protected data in loading/error states.

### References

- `planning-artifacts/epics.md` - Story 1.2
- `planning-artifacts/ux-designs/ux-x-assurance-2026-06-08/EXPERIENCE.md` - Landing Page, Public Surface
- `planning-artifacts/architecture.md` - Frontend Architecture, Authentication & Security

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Git baseline unavailable because repository has no commits yet; recorded `baseline_commit: NO_VCS`.
- Replaced starter home page with Project Assurance landing content and login CTA.
- Added public `/login` route using the generated Supabase `LoginForm`.
- Updated login success redirect to `/app/projects`.
- Updated proxy protection so logged-out `/app` access redirects to `/login`.
- `npm test` passed.
- `npm run lint` passed.
- `npm run build` passed.

### Completion Notes List

- Implemented a compact public landing page with product name, evidence-based assurance message, early warning/executive-ready value proposition, trust cues, and login CTA.
- Preserved the starter Supabase auth utilities and adjusted route behavior rather than introducing a new auth library.
- Kept protected app data behind `/app` auth routing; the project selection route is not rendered to logged-out users.

### File List

- `package.json`
- `src/app/page.tsx`
- `src/app/login/page.tsx`
- `src/app/auth/login/page.tsx`
- `src/app/layout.tsx`
- `src/app/protected/page.tsx`
- `src/components/auth-button.tsx`
- `src/components/login-form.tsx`
- `src/components/logout-button.tsx`
- `src/lib/supabase/proxy.ts`
- `tests/integration/epic-1-foundation.test.mjs`

### Change Log

- 2026-06-08: Implemented public landing, `/login` entry, auth redirects, and static access tests.
