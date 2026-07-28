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

test("AI Advisor is scoped to the latest Assurance Review and fails honestly", () => {
  const action = read("src/features/assistant/actions/assistant-actions.ts");

  assert.match(action, /requireProjectMembership/);
  assert.match(action, /\.eq\("project_id", projectId\)/);
  assert.match(action, /document_chunks/);
  assert.match(action, /assurance_reviews/);
  assert.match(action, /assurance_review_documents/);
  assert.match(action, /assurance_findings/);
  assert.match(action, /assurance_actions/);
  assert.match(action, /latest automatic project assessment/);
  assert.match(action, /No fallback answer was created/);
  assert.match(action, /assistant_interactions/);
  assert.match(action, /runOllamaChat/);
  assert.match(action, /assurance_review_id/);
});

test("assistant UI includes chat shell, source controls, suggested prompts, and recommendations", () => {
  const page = read("src/app/app/projects/[projectId]/assistant/page.tsx");
  const component = read("src/features/assistant/components/assistant-chat.tsx");

  assert.match(page, /AssistantChat/);
  assert.match(component, /Ask about budget, deadlines, risk, or next actions/);
  assert.match(component, /Direct answer/);
  assert.match(component, /Sources used/);
  assert.match(component, /source\.pageNumber/);
  assert.match(component, /current forecast compare with the approved budget/);
  assert.match(component, /most important project condition/);
  assert.match(component, /evidence is still missing/i);
  assert.match(component, /Next actions/);
  assert.match(component, /Owner not assigned/);
  assert.match(component, /startTransition/);
  assert.match(component, /pendingQuestion/);
  assert.match(component, /ThinkingBubble/);
  assert.match(component, /role="status"/);
  assert.match(component, /Reviewing the latest assessment and source documents/);
  assert.match(component, /conversation\.scrollTo/);
  assert.match(component, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(component, /window\.setTimeout/);
  assert.doesNotMatch(component, /AI Runtime/);
  assert.doesNotMatch(component, /Provider/);
});
