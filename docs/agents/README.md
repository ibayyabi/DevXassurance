# Agent workflows

Use this guide to choose whether to continue approved work or shape a new objective.

## Continue the PMO assurance tickets

Start with [the PMO handoff](../../.scratch/pmo-assurance-pipeline/README.md). It records the current and desired pipeline, domain terms, ticket dependencies, and acceptance criteria.

Follow the ticket frontier, not just its `Status` line:

- Start with **01 — Project-Level Budget Assurance**.
- After 01 is resolved, **02 — WBS Cost and Scope Comparison** and **04 — Risk Snapshot Comparison** can start.
- **03 — Schedule and Progress Assurance** waits for 01 and 02.
- **05 — Cut Over Assurance** waits for 01–04.

Before implementation, read the ticket and its blockers, then change its `Status` from `ready-for-agent` to `claimed`. Use `/skill:implement <ticket-path>` for one ticket. For coordinated implementation of the full spec and task graph, use `/skill:implement-spec <feature-README-or-spec-path>` and point it to the associated ticket files. Resolve a ticket only after every acceptance criterion passes and verification evidence is recorded in its `## Comments` section.

## Start a new objective

For a new FE, BE, UX, or architecture objective, start with `/skill:grill-with-docs` and describe the goal, affected users, constraints, and what a useful outcome looks like. The skill interviews across the decisions that can be settled now and records durable domain terms and decisions in `CONTEXT.md` and `docs/adr/` as they crystallize. Stop at shared understanding if the work is still exploratory.

Once the objective is settled:

1. Use `/skill:to-spec` to turn the agreed conversation into a spec. It synthesizes settled decisions; it is not the interview step.
2. Use `/skill:to-tickets` when the work needs multiple independently verifiable slices. Review and approve the ticket sizes and blockers before they are published as Markdown files under `.scratch/<feature>/issues/`.
3. Use `/skill:implement` for an approved ticket, or `/skill:implement-spec` for the complete approved task graph.

Example starting prompt:

> `/skill:grill-with-docs I want to improve the project dashboard for PMO reviewers. Help me agree on the user problem, expected behavior, and boundaries before planning implementation.`

For a backend objective, replace “project dashboard” with the worker, API, or data behavior to improve. The process is the same; the domain questions and acceptance criteria change with the objective.

## Skills available in this repository

Repository skills live together in `.agents/skills/`: six selected Matt Pocock workflows (`grill-with-docs`, `handoff`, `implement`, `implement-spec`, `to-spec`, and `to-tickets`), plus the project `ponytail` and `ui-skills` guidance. The `grill-with-docs` router expects the agent runtime to provide `grilling` and `domain-modeling`; implementation workflows may also call runtime `tdd` and `code-review`. Those supporting skills are intentionally not vendored in this repository.

The local Markdown tracker and triage conventions are in [`issue-tracker.md`](issue-tracker.md) and [`triage-labels.md`](triage-labels.md).