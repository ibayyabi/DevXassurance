# X-Assurance current user journey and exploration map


As of 2026-10-26. This is an **as-is, source-inspected** guide for agents exploring the app from a user's first visit. It describes implemented routes and visible controls, not a proposed flow or a completed live usability test. Use `implementation-artifacts/ui-ux-spec.md` for UI constraints and verification criteria. Recheck the relevant code and rendered UI before changing behavior.


## Start here: the first visit


1. Open `/`. The public landing page explains evidence-based project assurance. A visitor can use **View demo** to jump to the interactive condition examples on the same page, **Sign in** to open `/login`, or **Get started** to open `/auth/sign-up` (`src/app/page.tsx`, `src/components/landing/decision-demo.tsx`). The demo is a preview; it does not create a project or process evidence.
2. A returning user signs in with work email and password. Successful sign-in opens `/app/projects`; **Forgot password?** opens `/auth/forgot-password`. A new user signs up with email and password, lands on `/auth/sign-up-success`, and follows the email confirmation path before entering the app (`src/components/login-form.tsx`, `src/components/sign-up-form.tsx`, `src/app/auth/confirm/route.ts`). `/auth/login` redirects to `/login`.
3. `/app/projects` shows projects assigned to the signed-in user and a **Create a project** form. Creating a project asks for a project name and optional organization/program name, grants the creator the Admin role, and opens that project's Overview. An existing project card opens its workspace (`src/app/app/projects/page.tsx`, `src/features/projects/actions/project-actions.ts`). Unauthenticated access to project data redirects to `/login`; project routes require membership (`src/features/projects/lib/queries.ts`).


## Project workspace: explore in user order


Use `/app/projects/{projectId}` as the route prefix. Opening the prefix redirects to `/dashboard`. The desktop sidebar and mobile navigation show **Overview**, **Evidence**, **Reports**, **AI Advisor**, **Trends**, and **Team & Settings**. The sidebar also has **Switch project**, which returns to `/app/projects` (`src/components/app-shell/app-shell.tsx`).


| Stop | Route | What a user sees and can do | Main implementation |
| --- | --- | --- | --- |
| 1. Overview | `/dashboard` | With no review, an onboarding panel directs the user to **Add project evidence**. With a review, it shows the latest condition, Budget/Schedule/Risk information, evidence count, open actions, charts, and links to **Prepare management report** or **Review evidence**. Do not infer a completed assessment from the empty state. | `src/features/dashboard/components/usable-overview.tsx` |
| 2. Evidence | `/documents` | Upload files or ZIPs, inspect batch and processing states, filter the document library by artifact type, period, workstream, and processing state, inspect a document, retry or remove it when applicable, and save reviewer classification. **Review extracted details** expands source-linked facts. | `src/features/documents/components/document-intelligence.tsx`, `upload-document-form.tsx` |
| 3. Assurance Review | `/assurance` | Choose a reporting month, then follow **Evidence → Analysis → Findings → Actions → Report**. Select completed baseline and current evidence, run analysis, inspect and confirm source-linked findings, update actions, and continue to Reports. Evidence requirements block analysis/report continuation when unmet. | `src/features/assurance/components/assurance-workspace.tsx`, `review-evidence-filters.tsx` |
| 4. Reports | `/reports` | When the review is ready, choose audience and detail level, generate a draft, inspect its evidence and wording, edit sections, approve the report, create PDF or DOCX, then download from **Recent downloads**. The page directs users back to Evidence when prerequisites are missing. | `src/features/reports/components/report-workspace.tsx` |
| 5. AI Advisor | `/assistant` | Ask a project question, use suggested questions, continue or start a conversation, and inspect **Sources used** and recommended next actions. Answers depend on retrieved project evidence and citation checks. | `src/features/assistant/components/assistant-chat.tsx` |
| 6. Trends | `/trends` | An **Under Development** page describes future multi-period comparison; it is not a working trend workflow. | `src/app/app/projects/[projectId]/trends/page.tsx` |
| 7. Team & Settings | `/members` | View project members. Authorized roles can add an existing Supabase Auth user by email, change a role, or remove a member. | `src/features/projects/components/project-members-workspace.tsx` |


Two implemented routes are **absent from the main navigation**: `/assurance` and `/anomalies`. An agent exploring only sidebar items will miss them. `/anomalies` lists detected anomalies, lets a user inspect detail, create a management action, and mark an anomaly reviewed or a false positive (`src/features/anomalies/components/anomaly-workspace.tsx`). Check current in-page links and direct route access when exploring these flows; do not assume a sidebar entry exists.


## The evidence-to-report path


```text
Landing → sign up/sign in → project selection or creation → Overview
 → Evidence upload → queued/processing → document inspection and reviewer metadata
 → Assurance Review: Evidence → Analysis → Findings → Actions → Report
 → Reports: options → draft → edits → approval → file creation → download
```


The evidence library accepts multiple files, a single file with optional metadata hints, and ZIP intake. Upload success means storage/intake succeeded; extraction can still be queued, processing, need review, or fail. The app refreshes active processing states. AI suggestions, upload hints, and reviewer-confirmed classifications are separate. A usable review needs completed approved baseline evidence and completed current-period evidence. Findings and Advisor claims should link back to exact source material. These distinctions are central to both exploration and any proposed UX change (`README.md`, `implementation-artifacts/ui-ux-spec.md`, `src/features/documents/components/*`, `src/features/assurance/components/*`).


## Branches to inspect while exploring


- **New project:** Overview has no review and routes to Evidence. Explore the no-documents library and an attempted review/report to see the blocked states.
- **Processing or failed evidence:** Observe upload batch status separately from document processing; use retry and inspect error text where available. Do not treat a queued upload as a completed extraction.
- **Ready evidence:** Confirm baseline/current roles, select evidence for a reporting month, run analysis, inspect source links, then follow actions and report output.
- **Existing project:** Switch project, inspect the latest review in Overview, use Reports or Advisor directly, and see how they react to the current evidence state.
- **Role differences:** Explore Team & Settings with a manager/admin role and a view-only role. Member management requires Admin, PMC Consultant, or Project Manager; users must already exist in Supabase Auth before being added (`src/features/projects/lib/roles.ts`, `README.md`).
- **Other paths:** Test password recovery, mobile navigation, the `/anomalies` route, and the Trends placeholder. The header notification bell is visible but has no implemented action (`src/components/app-shell/app-shell.tsx`).


## Agent exploration checklist


1. Begin at `/` and follow the visible calls to action; record where each takes the user.
2. Enter through both new-account and returning-user paths when credentials and the development environment permit.
3. Create or open a development project; note the empty Overview before uploading evidence.
4. Walk the Evidence → Assurance Review → Reports sequence with permitted demo files. Check every intermediate state and the source links, not only the final screen.
5. Explore every visible navigation item, then visit `/assurance` and `/anomalies` explicitly.
6. Check an empty, processing, failed, and ready state where possible; record the user's next available action in each.
7. Compare observed UI with this guide and `ui-ux-spec.md`; update both when implementation changes the journey.


This guide is based on the application source and existing project documentation. It does not assert that external services, email confirmation, document processing, or report export were exercised in a live environment during its creation.