# X-Assurance UI/UX: As-Is Constraints and Verification Criteria


This document is a working reference for agents modifying the X-Assurance interface. It records the product behavior, UI structure, design conventions, known UX gaps, and verification requirements as of 2026-10-26.


It is not a claim that the current design is complete or that known gaps should be preserved. When a requested change conflicts with this document, follow the user's request and update this reference to reflect the new state.


The purpose of this document is to help agents make changes that are consistent with the existing product, preserve evidence integrity, improve usability, and can be verified against explicit acceptance criteria.


For a route-by-route walkthrough from the public landing page through the project workspace, see `implementation-artifacts/current-user-journey.md`.


## Product and User Journey


X-Assurance is an evidence-based project assurance application.


The core user journey is:


1. Select a project.
2. Upload project evidence.
3. Wait for document processing.
4. Review and confirm extracted evidence.
5. Run an assurance review.
6. Inspect findings and recommended actions.
7. Prepare, review, and approve a report.
8. Generate and export the report.


The three assessed domains are Budget, Schedule, and Risk.


The UI must distinguish a supported condition from missing, incomplete, unconfirmed, or failed evidence. Do not display a reassuring score, a completed analysis state, or a successful assurance outcome when the required evidence is absent or processing has failed.


Uploaded files can be queued, processing, completed, in need of review, or failed. An upload can succeed while subsequent extraction or analysis fails. Keep upload, processing, review, and analysis states distinct.


AI suggestions, intake hints, extracted metadata, and reviewer confirmations are separate concepts. Do not present suggested or extracted metadata as confirmed fact unless the applicable confirmation process has been completed.


Findings and AI Advisor answers must remain traceable to their source evidence. When evidence is insufficient, the interface must communicate uncertainty instead of presenting unsupported conclusions.


An assurance review requires at least:
- One completed and approved baseline document.
- One completed current-period document.


When these requirements are not met, the UI must clearly explain what is missing and guide the user to Evidence. The review must not proceed as though its prerequisites have been satisfied.


Reports depend on a completed review and its findings. The UI must distinguish report generation, draft review, approval, file creation, and download as separate stages.


## Current Information Architecture


### Public and Authentication Routes


- Public landing page: `src/app/page.tsx`
- Authentication screens: `src/app/login` and `src/app/auth/*`


### Project Selection and Application Shell


- Project selection: `src/app/app/projects/page.tsx`
- Project shell: `src/components/app-shell/app-shell.tsx`


The visible application navigation currently includes:
- Overview
- Evidence
- Reports
- AI Advisor
- Trends
- Team & Settings


The shell has a collapsible desktop sidebar and horizontally scrollable mobile navigation.


### Feature Routes and Components


- Overview: `src/features/dashboard/components/usable-overview.tsx`
- Evidence intake and document library: `src/features/documents/components/*`
- Assurance review: `src/features/assurance/components/*`
- AI Advisor: `src/features/assistant/components/*`
- Reports: `src/features/reports/components/*`


Additional routes exist for:
- Assurance Review: `/assurance`
- Anomalies: `/anomalies`


The existence of a route does not mean that users can discover it from the main navigation. Evaluate navigation changes against the actual user journey and existing route behavior.


Before modifying a route or component, inspect the current implementation and its dependencies. Do not assume that a route, component, API, or interaction behaves as expected merely because its name suggests that behavior.


## Visual System to Preserve


Unless a redesign is explicitly requested, preserve the existing visual system.


### Typography and Components


- Use the existing Geist font.
- Use existing Tailwind utility classes and design tokens.
- Reuse shadcn-style primitives in `src/components/ui`.
- Reuse Lucide icons.
- Prefer extending existing components over introducing parallel component patterns.
- Maintain consistent spacing, typography, border treatments, and interaction states across related screens.


Do not introduce a new component library, typography system, or styling convention without a clear requirement.


### Color and Theme


Color tokens are defined in `src/app/globals.css` and mapped in `tailwind.config.ts`.


The foundation uses light neutral colors:
- `base`
- `surface`
- `ink`
- `ink-muted`
- `ui-border`
- `brand`


The dark sidebar is a structural element of the current interface.


Green, amber, and red are reserved for meaningful status and severity indicators. Always pair status colors with text labels or other accessible indicators. Color alone must not communicate a critical state.


The application currently forces light theme in `src/app/layout.tsx`. Do not imply that dark mode is supported merely because a theme-switching component exists.


### Layout and Interaction


- Preserve the spacious editorial layout used by the public landing page.
- Use bordered cards, compact status indicators, and clear primary actions in workspaces.
- Maintain consistent visual hierarchy between page titles, section headings, descriptions, and actions.
- Preserve responsive layouts and keyboard focus indicators.
- Provide accessible labels for inputs and icon-only controls.
- Announce important asynchronous status changes and errors where appropriate.
- Respect reduced-motion preferences.
- Avoid unnecessary decoration that competes with evidence, findings, or primary actions.


## Evidence Integrity and Status Semantics


Evidence integrity is a core product requirement, not merely a visual preference.


### Document Lifecycle


Distinguish the following states wherever applicable:


- **Uploaded:** The file has been accepted by the application.
- **Queued:** The file is waiting to be processed.
- **Processing:** Extraction or analysis is underway.
- **Completed:** The relevant processing operation has finished successfully.
- **Needs review:** Reviewer attention or confirmation is required.
- **Approved:** The required reviewer approval has been recorded.
- **Failed:** The relevant operation did not complete successfully.


Use the actual application state to determine which labels are displayed. Do not treat these states as interchangeable.


In particular:
- Upload success does not imply processing success.
- Processing completion does not imply reviewer approval.
- Extracted metadata does not imply confirmed metadata.
- An uploaded file does not automatically satisfy review readiness.
- A queued document must not be labeled Ready or Analyzed.
- A failed extraction or analysis must not be hidden behind an overall success message.


If the implementation uses additional lifecycle states, preserve their meaning and map them to user-facing language without losing important distinctions.


### AI Suggestions and Reviewer Confirmation


AI suggestions, extracted information, and reviewer-confirmed information must remain distinguishable.


The UI must not:
- Present AI-generated metadata as confirmed fact.
- Imply that a reviewer has approved information when no approval exists.
- Hide uncertainty caused by incomplete or conflicting evidence.
- Display findings without an appropriate connection to supporting evidence.
- Claim that an assurance analysis succeeded when required processing failed.


Where applicable, expose the source document, relevant evidence location, or citation that supports a finding or Advisor response.


When evidence is insufficient, explain what is missing and how the user can address it.


### Review Readiness


Review readiness must be based on actual document and approval states.


Before starting an assurance review, make the required baseline and current-period evidence visible.


If a prerequisite is missing, incomplete, failed, unavailable, or unapproved:
- Explain the specific blocker.
- Identify the action required to resolve it.
- Provide a direct path to the relevant Evidence workflow.
- Prevent the UI from implying that a valid review can proceed.


Do not infer readiness solely from the number of uploaded documents.


## Interaction and Content Constraints


### Empty, Blocked, Processing, and Error States


Every major state should help the user understand what is happening and what to do next.


- **Empty:** Explain what the feature does and how to get started.
- **Blocked:** Identify the unmet prerequisite and provide a way to resolve it.
- **Queued:** Explain that processing has not finished.
- **Processing:** Communicate that work is underway without implying completion.
- **Needs review:** Identify the information requiring reviewer attention.
- **Failed:** Explain the failure when possible and provide an appropriate recovery action.
- **Completed:** Confirm only the operation that actually succeeded.


Do not show a generic success state when only part of a workflow has completed.


When an operation fails, preserve valid user input and completed work wherever possible. Provide retry behavior when supported by the underlying implementation.


### Evidence Intake


- Make document upload actions easy to find.
- Explain what kinds of evidence the user should provide.
- Communicate processing status and failure on a per-file basis.
- Preserve existing per-file upload feedback and retry behavior for failed files.
- Explain the next step after upload and processing.
- Do not imply that uploading alone completes the assurance workflow.


### Document Library


- Keep document type, reporting period, review role, processing state, and approval state distinguishable.
- Make it clear whether a document is a baseline or current-period document when that distinction applies.
- Keep filtering and document actions understandable.
- Where filters are available, consider providing a clear-filters action and filename search when these improve document discovery.
- Avoid showing a filtered empty state that could be mistaken for an empty document library.


### Assurance Review


- Make prerequisites visible before analysis begins.
- Identify the baseline and current-period documents selected for the review.
- Communicate missing or unavailable documents before proceeding.
- Distinguish review execution from successful review completion.
- Show findings and recommendations only when supported by available analysis results.
- Keep findings traceable to their supporting evidence.
- Provide actionable explanations for blocked or failed reviews.


### Reports


The report workflow consists of separate stages:


1. Generate the report.
2. Review its contents.
3. Approve it when required.
4. Create the export file.
5. Download the file.


Do not imply that a draft has been approved or that an export file exists before the corresponding operation succeeds.


If report generation or file creation fails, explain the failure and preserve the existing report data wherever possible.


### AI Advisor


- Keep responses connected to source evidence through links or citations.
- Communicate uncertainty when evidence is incomplete or insufficient.
- Avoid presenting unsupported conclusions as established project facts.
- Distinguish evidence-based findings from suggestions or interpretations.
- Provide useful paths to relevant evidence when users need to investigate a claim.


### Navigation


Navigation should reflect the actual workflow and the actions users need to perform.


Evaluate whether Assurance Review and Anomalies should be included in the main navigation, considering:
- Their importance to the core journey.
- Their relationship to existing navigation items.
- Whether users can discover them at the appropriate point in the workflow.
- Their relevance to different project states and user roles.


Do not add navigation items without verifying that the destination works and that its placement is appropriate.


### Notifications and Controls


Every enabled interactive control should have a meaningful action.


If a button is visible and enabled, it must not behave as a decorative element. If the action is unavailable, disable the control when appropriate and explain why.


The notification bell is currently an enabled button without a visible action. This is a known UX gap to investigate.


### Content and Microcopy


Use concise, direct, task-oriented language.


- Prefer clear descriptions over exaggerated product claims.
- Explain what the system actually does.
- Distinguish automatic processing from reviewer responsibilities.
- Avoid implying certainty when the underlying evidence does not support it.
- Make action labels describe the action users will perform.
- Provide helpful instructions without overwhelming users with unnecessary technical details.


## Overview Onboarding Requirements


The Overview page should guide users into the evidence-based assurance workflow.


The current empty state uses the headline:


> Upload the project files. AI handles the rest.


This wording is engaging but can overstate automation because document selection, evidence confirmation, and report review may still require user action.


When improving the Overview page, retain a clear primary action while making the actual workflow and responsibilities understandable.


### Required Behavior


- Explain that users should upload relevant project evidence.
- Identify the evidence needed to begin an assurance review, including an approved baseline document and a current-period document.
- Distinguish uploaded evidence from processed, reviewed, and approved evidence.
- Show review readiness based on actual document states.
- Provide a clear next action after upload and processing.
- Guide users to Evidence when required documents are missing or need attention.
- Avoid presenting a completed analysis or reassuring assessment when the project has not been reviewed.
- Communicate blocked or failed states without implying that the workflow succeeded.


### Recommended UX Direction


Use progressive disclosure rather than presenting every requirement at once.


The Overview page should answer three questions:


1. What should I do next?
2. What evidence or action is required?
3. What will happen after I complete this step?


The primary action should reflect the current project state. For example, a project with no evidence may prompt the user to add evidence, while a project with sufficient approved evidence may direct the user toward the assurance review.


These are behavioral examples, not fixed requirements for specific button labels. Follow the actual application state and existing route behavior.


## Responsive Design and Accessibility


The application must remain usable across desktop and mobile viewports.


### Responsive Behavior


- Preserve the collapsible desktop sidebar.
- Ensure mobile navigation remains discoverable and usable.
- Prevent unintended horizontal page overflow.
- Keep primary actions visible and reachable.
- Ensure cards, filters, tables, and forms adapt to narrower screens.
- Preserve access to essential information when layouts change.
- Avoid hiding important status labels or evidence actions on mobile.


### Accessibility


- Provide meaningful labels for form fields.
- Provide accessible names for icon-only buttons.
- Maintain visible keyboard focus indicators.
- Support keyboard navigation through interactive elements.
- Use appropriate semantic structure for headings, forms, and controls.
- Ensure status and severity are not conveyed by color alone.
- Announce important asynchronous errors and status changes where appropriate.
- Respect reduced-motion preferences.
- Ensure text and controls have sufficient contrast.


Accessibility improvements should use existing project conventions and components where possible.


## Acceptance Criteria and Verification


Treat a UI change as complete only when the applicable criteria below have been verified.


### Functional Correctness


- Primary actions perform the expected operation.
- Links and navigation lead to the correct destinations.
- Loading, success, empty, blocked, and error states reflect the actual application state.
- Form validation provides useful feedback.
- Retry actions work when supported.
- No enabled control is left without a meaningful action.


### Evidence Integrity


- Missing, incomplete, failed, or unconfirmed evidence is never presented as approved or analyzed.
- AI suggestions remain distinguishable from reviewer-confirmed information.
- Review readiness reflects actual prerequisite states.
- Findings remain traceable to supporting evidence.
- Reports are not presented as approved or exported before the relevant operations succeed.


### Workflow Continuity


- Each major screen provides a clear next action or explains why the user cannot proceed.
- Users can recover from errors without losing valid work wherever possible.
- Missing prerequisites direct users to the appropriate resolution path.
- Successful completion of one stage leads naturally to the next relevant stage.
- Empty and blocked states explain the requirements for continuing.


### Visual Consistency


- Changes reuse existing design tokens and UI primitives unless a deliberate redesign is requested.
- Typography, spacing, colors, and component treatments remain consistent with the established design system.
- Status colors retain their intended meaning.
- New components do not unnecessarily duplicate existing functionality.


### Accessibility


- Inputs have labels.
- Icon-only controls have accessible names.
- Keyboard focus is visible.
- Important status changes and errors are communicated accessibly.
- The affected interface remains usable without relying solely on color.
- Reduced-motion preferences are respected where applicable.


### Responsive Behavior


- Validate the affected screen at representative desktop and mobile widths.
- Confirm that primary actions remain accessible.
- Check navigation, cards, filters, forms, and tables for unintended overflow.
- Verify that important evidence states and status labels remain visible.


### Regression Checks


- Verify the affected route and its primary interactions.
- Test relevant loading, success, empty, blocked, and error states.
- Check related navigation and dependent workflows.
- Confirm that unrelated workflows continue to work when they are within the scope of the change.
- Check browser and terminal errors when the implementation or behavior indicates a possible runtime issue.


### Verification Evidence


When reporting a completed change, state:
- Which files or components were changed.
- Which routes and interactions were tested.
- Which viewport sizes were checked.
- Which relevant states were verified.
- Any failures, limitations, or unresolved issues.
- Which behaviors remain untested.


Do not claim that a UI change has been verified when only its source code has been inspected.


Distinguish between implemented, tested, and confirmed behavior. If an interaction could not be tested because a dependency, service, account, or environment was unavailable, state that limitation explicitly.


## Known As-Is UX Gaps


The following observations describe the interface as of 2026-10-26. They are not requirements to preserve the current behavior.


### Navigation


- Assurance Review is not listed in the main application navigation.
- Anomalies is not listed in the main application navigation.


### Notifications


- The header notification bell is an enabled button without a visible action.


### Onboarding


- Some onboarding copy suggests that AI handles the entire workflow automatically, even though evidence selection and reviewer confirmation may still be required.


### Evidence Intake


- Upload status ends at `Queued` without an immediate next-step link in the upload form.


### Document Discovery


- The document library has four filters but no visible clear-filters control or filename search.


### Verification


- The original design reference was created from source inspection rather than a comprehensive live usability test.
- Current visual and behavioral observations must be verified against the running application before declaring a related UX change complete.


## Implementation Guidance for Agents


Before making a change:


1. Read the relevant components and their dependencies.
2. Inspect existing design tokens, shared components, and route structure.
3. Identify the current behavior and the user problem being addressed.
4. Determine which evidence states, user roles, and workflows are affected.
5. Establish the relevant acceptance criteria before implementation.


During implementation:


1. Follow existing project conventions.
2. Reuse shared components where appropriate.
3. Preserve the distinction between uploaded, processed, reviewed, and approved evidence.
4. Keep status feedback consistent with the actual application state.
5. Avoid unrelated refactoring unless it is necessary for the requested change.
6. Preserve responsive behavior and accessibility.


After implementation:


1. Run the available relevant checks.
2. Inspect the actual rendered UI.
3. Test the affected interactions and applicable states.
4. Check for unintended regressions.
5. Update this document if the implemented behavior changes any of the recorded as-is constraints or known UX gaps.
6. Report the verification performed and any remaining limitations.


The goal is not merely to produce a visually consistent interface. It is to ensure that X-Assurance communicates project evidence, uncertainty, review readiness, and report status accurately while helping users move through the assurance workflow with minimal confusion.