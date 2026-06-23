import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("assistant migration stores project-scoped interactions and provenance", () => {
  const migration = read("supabase/migrations/202606080006_assistant_interactions.sql");

  assert.match(migration, /create table public\.assistant_interactions/);
  assert.match(migration, /project_id/);
  assert.match(migration, /insufficient_evidence/);
  assert.match(migration, /evidence_links jsonb/);
  assert.match(migration, /inferred_claims/);
  assert.match(migration, /recommended_action_ids/);
  assert.match(migration, /is_project_member\(project_id\)/);
});

test("assistant action retrieves only project-scoped evidence and returns insufficient evidence when empty", () => {
  const action = read("src/features/assistant/actions/assistant-actions.ts");

  assert.match(action, /requireProjectMembership/);
  assert.match(action, /\.eq\("project_id", projectId\)/);
  assert.match(action, /document_chunks/);
  assert.match(action, /extracted_facts/);
  assert.match(action, /recommended_actions/);
  assert.match(action, /Insufficient evidence is available/);
  assert.match(action, /assistant_interactions/);
  assert.match(action, /runOllamaChat/);
});

test("assistant UI includes chat shell, source controls, suggested prompts, and recommendations", () => {
  const page = read("src/app/app/projects/[projectId]/assistant/page.tsx");
  const component = read("src/features/assistant/components/assistant-chat.tsx");

  assert.match(page, /AssistantChat/);
  assert.match(component, /Ask a question about your project/);
  assert.match(component, /Sources \(\{message\.sources\.length\}\)/);
  assert.match(component, /Evidence & Sources/);
  assert.match(component, /Page \{source\.pageNumber/);
  assert.match(component, /Why is the project Amber/);
  assert.match(component, /What should be escalated/);
  assert.match(component, /Summarize this week's risks/);
  assert.match(component, /Recommendations \/ Next Actions/);
  assert.match(component, /Owner:/);
});
