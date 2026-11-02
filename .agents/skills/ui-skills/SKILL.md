---
name: ui-skills
description: Use for UI work in this repository: build or polish frontend components, layouts, responsive behavior, accessibility, design systems, or motion. Choose the smallest relevant UI skill from the UI Skills registry before implementation; skip for backend-only changes.
---

# UI Skills routing

1. This app uses Next.js and React; identify the UI concern and inspect its existing implementation before selecting a framework-specific skill.
2. Discover the smallest applicable skill set from the UI Skills registry:
   - `npx --yes ui-skills categories`
   - `npx --yes ui-skills list --category <category>`
   - `npx --yes ui-skills get <slug>` for selected skill instructions.
3. Prefer one specific skill; use up to three only when the task clearly spans multiple concerns. Load only the selected instructions and apply them to the existing project.
4. UI changes must preserve accessible interactions and be checked on the actual rendered surface when a browser is available.

The registry is fetched on demand; do not add or persist its packages as project dependencies. If the UI Skills CLI is unavailable, report that constraint and continue with the repository's existing UI patterns.
