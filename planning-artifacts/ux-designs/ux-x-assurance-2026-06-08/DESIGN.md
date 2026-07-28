---
title: X-Assurance Design
status: superseded-for-recovery
created: 2026-06-08
updated: 2026-07-21
superseded_by: ../../product-recovery/phase-3-usable-mvp-spec.md
sources:
  - ../../prds/prd-x-assistance-2026-06-08/prd.md
  - ../../architecture.md
  - user-supplied screenshots in chat: Dashboard, Document Intelligence, Anomaly Detection, AI Assistant, Report Generation
tokens:
  colors:
    brand:
      navy_950: "#00194f"
      navy_900: "#002464"
      blue_700: "#0057ff"
      blue_600: "#0b63f6"
      blue_50: "#eef5ff"
    surface:
      page: "#f6f8fc"
      panel: "#ffffff"
      panel_muted: "#f8fafc"
      border: "#d9e2ef"
      divider: "#e7edf5"
    text:
      primary: "#071a44"
      secondary: "#42526e"
      muted: "#64748b"
      inverse: "#ffffff"
    status:
      success: "#009951"
      success_bg: "#e7f7ef"
      warning: "#ff7a00"
      warning_bg: "#fff3e5"
      danger: "#ff1f2d"
      danger_bg: "#fff0f1"
      info: "#0057ff"
      info_bg: "#eef5ff"
      governance: "#6d3df5"
      audit: "#0097a7"
  typography:
    family:
      sans: "Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    size:
      xs: "11px"
      sm: "12px"
      base: "14px"
      md: "16px"
      lg: "20px"
      xl: "24px"
    weight:
      regular: 400
      medium: 500
      semibold: 600
      bold: 700
  rounded:
    sm: "6px"
    md: "8px"
    lg: "10px"
  spacing:
    xs: "4px"
    sm: "8px"
    md: "12px"
    lg: "16px"
    xl: "24px"
  components:
    nav:
      width_expanded: "208px"
      width_collapsed: "72px"
    card:
      radius: "{rounded.md}"
      border: "1px solid {colors.surface.border}"
    button:
      radius: "{rounded.sm}"
      primary_bg: "{colors.brand.blue_700}"
---

# X-Assurance Design

> **Recovery notice:** The density and component guidance in this file are superseded where they conflict with [`phase-3-usable-mvp-spec.md`](../../product-recovery/phase-3-usable-mvp-spec.md). Existing brand colors and reusable visual tokens remain references, not requirements to preserve the old screen layout.

## Brand & Style

X-Assurance should feel like a serious project assurance cockpit: calm, evidence-led, executive-ready, and designed for repeated daily use by PMO, PMC, sponsor, and steering committee users. The interface should not feel like a marketing site once the user is authenticated. It should prioritize scanability, confidence, traceability, and fast escalation.

The visual language is enterprise SaaS with a project control tone: dark navy navigation, white analytical panels, compact metric cards, semantic severity color, and restrained blue accents for primary actions. The product should look credible enough for management review while staying dense enough for consultants and PMO users doing real work.

## Colors

Use navy as the persistent shell color and blue as the primary action color. White panels sit on a very light cool page background. Status color must carry meaning consistently:

- Green means healthy, under budget, compliant, resolved, or favorable.
- Orange means amber, attention needed, medium severity, or warning.
- Red means high risk, critical anomaly, overdue, or failed.
- Purple means governance.
- Teal means audit readiness or evidence assurance.
- Blue means navigation, selected state, neutral information, or primary action.

Do not use a one-note blue-only palette. The app depends on semantic contrast between schedule, cost, risk, governance, and audit readiness.

## Typography

Use Inter or the closest available system sans. Text should be compact, legible, and stable across dense dashboard surfaces.

- Product name in top bar: 20-24px bold.
- Page title: 16-20px semibold.
- Section heading: 13-14px semibold.
- Metric value: 20-24px semibold/bold.
- Table/list text: 11-13px regular/medium.
- Helper text: 11-12px muted.

Avoid oversized headings inside the authenticated app. The dashboard should read as an operating surface, not a landing page.

## Layout & Spacing

The authenticated app uses a fixed left sidebar, top bar, and full-width content canvas. The content area uses responsive grids with 12-16px gaps and compact panel padding.

Primary desktop layout:

- Top bar: product name, notification, user avatar/name/role, menu.
- Sidebar: Dashboard, Documents, Anomalies, AI Assistant, Reports, Collapse.
- Main content: page title, project selector/context, filters/date controls, page-specific panels.

Panels should be aligned to a predictable grid. Use 8px radius for most cards and controls. Avoid nested decorative cards; only nest panels when a detail inspector is functionally distinct, as in the Anomaly detail pane.

## Elevation & Depth

Use subtle borders and low shadow only to separate panels from the page background. The app should feel crisp, not glossy.

- Navigation selected item may use a blue gradient or solid blue treatment.
- Cards use white fill, light border, and optional subtle shadow.
- Modal/drawer overlays should use clear background scrim and sharp hierarchy.

## Shapes

Default radius is 8px. Icon buttons and compact tags may use 6px. Avoid large rounded pill shapes except for status badges where the badge is short and semantically meaningful.

## Components

### App Shell

The shell is persistent across authenticated pages. Sidebar active state uses blue fill and white icon/text. Inactive items use white text with reduced opacity. The collapse control remains at the bottom.

### Metric Cards

Metric cards show an icon, label, value, and short trend/status phrase. Values use semantic color. Each card must work with missing data by showing "Insufficient evidence" or a neutral placeholder rather than a fake score.

### Charts

Charts should be clean and evidence-oriented. Use green/orange/red bands for health trend thresholds. Tooltips show date, score, status, and evidence coverage when available.

### Lists and Tables

Lists use compact rows with leading semantic icon, title, subtype, metadata, and status/severity badge. Rows should support progressive disclosure into detail panes.

### Evidence and Source Items

Evidence source rows include document icon/type, document title, short supporting excerpt, location metadata such as page/sheet, confidence score, and source category badge.

### Chat

AI Assistant messages use a two-column rhythm: assistant messages aligned left with assistant icon, user prompts aligned right with user avatar. Every assistant answer includes a collapsible source control when factual claims are present.

### Reports

Report Generation uses a three-column workspace: report type selector, report preview, and settings/evidence panel. Export buttons use document/action icons and should remain secondary until report generation is ready.

## Do's and Don'ts

Do:

- Keep density high but organized.
- Use semantic status colors consistently.
- Show evidence and confidence near AI-generated content.
- Keep role/project context visible.
- Prefer icon + label navigation for core modules.
- Use compact filters, date range controls, and status badges.

Don't:

- Hide evidence links behind generic "AI result" text.
- Use marketing-style hero treatment inside the authenticated app.
- Use frontend-only role controls.
- Let red/orange/green appear as decoration rather than status.
- Use oversized cards or large empty whitespace on operational screens.
- Use AI sparkle styling as the primary visual identity.
