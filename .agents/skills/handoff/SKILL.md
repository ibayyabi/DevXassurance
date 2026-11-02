---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save to the temporary directory of the user's OS (`$TMPDIR`, else `/tmp`; `%TEMP%` on Windows) - not the current workspace.

Include a "suggested skills" section in the document, naming which skills the next agent should call the Skill tool for.

## Suggested skills for this repository

Pick the smallest relevant set from `.agents/skills/`. Name each as `/skill:<slug>` so the recipient can invoke it:

- Single approved ticket: `implement`.
- Full multi-ticket task graph: `implement-spec`.
- New objective: `grill-with-docs`; after agreement, use `to-spec` and `to-tickets` when a spec and tickets are needed.
- UI work: `ui-skills`; coding work: `ponytail`.
- Use `handoff` to prepare a handoff when another agent will continue.

The runtime must provide supporting `grilling`, `domain-modeling`, `tdd`, or `code-review` skills when a workflow calls them. Include only skills relevant to the next task.

Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.
