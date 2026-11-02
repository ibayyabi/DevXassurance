import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const actionSource = fileURLToPath(
  new URL("../../src/features/assistant/actions/assistant-actions.ts", import.meta.url),
);
const advisorSource = fileURLToPath(
  new URL("../../src/features/assistant/lib/advisor.ts", import.meta.url),
);
const temporaryDirectory = mkdtempSync(join(tmpdir(), "xass-advisor-test-"));
const actionModule = join(temporaryDirectory, "assistant-actions.mjs");
const advisorModule = join(temporaryDirectory, "advisor.mjs");
const queriesMock = join(temporaryDirectory, "project-queries.mjs");
const ollamaMock = join(temporaryDirectory, "ollama.mjs");
const compile = (source) => ts.transpileModule(readFileSync(source, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

writeFileSync(advisorModule, compile(advisorSource));
writeFileSync(queriesMock, `
let context;
export function configureMembership(next) { context = next; }
export async function requireProjectMembership(projectId) {
  if (!context?.projectIds?.includes(projectId)) throw new Error('not a project member');
  return { supabase: context.supabase, user: context.user };
}
`);
writeFileSync(ollamaMock, `
let handler = async () => ({ ok: false, warning: 'not configured' });
const calls = [];
export function configureModel(next) { handler = next; calls.length = 0; }
export function modelCalls() { return calls; }
export async function runOllamaChat(input) { calls.push(input); return handler(input); }
`);
writeFileSync(
  actionModule,
  compile(actionSource)
    .replace('from "@/features/projects/lib/queries"', `from "${pathToFileURL(queriesMock).href}"`)
    .replace('from "@/features/assistant/lib/advisor"', `from "${pathToFileURL(advisorModule).href}"`)
    .replace('from "@/features/assistant/lib/types"', "from 'data:text/javascript,export {}'")
    .replace('from "@/lib/ai/ollama"', `from "${pathToFileURL(ollamaMock).href}"`),
);
let askAssistant;
let loadLatestAssistantConversation;
let configureMembership;
let configureModel;
let modelCalls;
try {
  ({ askAssistant, loadLatestAssistantConversation } = await import(pathToFileURL(actionModule).href));
  ({ configureMembership } = await import(pathToFileURL(queriesMock).href));
  ({ configureModel, modelCalls } = await import(pathToFileURL(ollamaMock).href));
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";
const USER_A = "33333333-3333-4333-8333-333333333333";
const USER_B = "44444444-4444-4444-8444-444444444444";
const CONVERSATION_A = "55555555-5555-4555-8555-555555555555";
const CONVERSATION_B = "66666666-6666-4666-8666-666666666666";
const CHUNK_A = "77777777-7777-4777-8777-777777777777";
const CHUNK_B = "88888888-8888-4888-8888-888888888888";

function sourceRow({
  chunkId = CHUNK_A,
  projectId = PROJECT_A,
  documentId = "99999999-9999-4999-8999-999999999999",
  text = "The current schedule shows delivery delayed by two weeks.",
  role = "current",
  period = "2026-06-01",
  reviewIds = ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
  rank = 0.5,
} = {}) {
  return {
    chunk_id: chunkId,
    project_id: projectId,
    document_id: documentId,
    chunk_index: 0,
    chunk_text: text,
    page_number: 3,
    section_label: "Delivery status",
    parser_metadata: { sourceLocation: { kind: "pdf", pageNumber: 3 } },
    document_title: "Schedule Review",
    document_file_name: "schedule.pdf",
    confirmed_evidence_role: role,
    confirmed_reporting_period: period,
    review_ids: reviewIds,
    rank,
  };
}

function makeSupabase({ chunks = [], interactions = [], actions = [], findings = [], reviews = [] } = {}) {
  const store = { chunks, interactions: [...interactions], actions, findings, reviews, rpcCalls: [] };
  const supabase = {
    async rpc(name, parameters) {
      store.rpcCalls.push({ name, parameters });
      const terms = (parameters.p_query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
      const ranked = store.chunks
        .filter((row) => row.project_id === parameters.p_project_id && row.chunk_text.trim())
        .filter((row) => !parameters.p_review_id || row.review_ids?.includes(parameters.p_review_id))
        .filter((row) => !parameters.p_evidence_role || row.confirmed_evidence_role === parameters.p_evidence_role)
        .map((row) => {
          const words = new Set(row.chunk_text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
          const score = terms.filter((term) => words.has(term)).length;
          return { ...row, rank: score / Math.max(terms.length, 1) };
        })
        .filter((row) => row.rank > 0)
        .sort((left, right) => right.rank - left.rank);
      return { data: ranked.slice(0, parameters.p_limit), error: null };
    },
    from(table) {
      return new FakeQuery(table, store);
    },
  };
  return { supabase, store };
}

class FakeQuery {
  constructor(table, store) {
    this.table = table;
    this.store = store;
    this.filters = [];
    this.maximum = Infinity;
    this.inserted = undefined;
    this.sortAscending = true;
  }
  select() { return this; }
  eq(key, value) { this.filters.push((row) => row[key] === value); return this; }
  neq(key, value) { this.filters.push((row) => row[key] !== value); return this; }
  in(key, values) { this.filters.push((row) => values.includes(row[key])); return this; }
  not(key, _operator, value) { this.filters.push((row) => row[key] !== value); return this; }
  order(_key, options) { this.sortAscending = options.ascending; return this; }
  limit(value) { this.maximum = value; return this; }
  insert(value) { this.inserted = value; return this; }
  maybeSingle() { return Promise.resolve(this.resolve(true)); }
  then(resolve, reject) { return Promise.resolve(this.resolve()).then(resolve, reject); }
  resolve(single = false) {
    if (this.table === "assistant_interactions" && this.inserted !== undefined) {
      this.store.interactions.push({ ...this.inserted, created_at: `2026-06-09T00:00:${String(this.store.interactions.length).padStart(2, "0")}Z` });
      return { data: null, error: null };
    }
    const records = this.table === "assistant_interactions"
      ? this.store.interactions
      : this.table === "assurance_actions"
        ? this.store.actions
          : this.table === "assurance_findings"
            ? this.store.findings
            : this.table === "assurance_reviews"
              ? this.store.reviews
              : [];
    let results = records.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.table === "assistant_interactions") {
      results = [...results].sort((left, right) =>
        (this.sortAscending ? 1 : -1) * String(left.created_at ?? "").localeCompare(String(right.created_at ?? "")),
      );
    }
    results = results.slice(0, this.maximum);
    return { data: single ? results[0] ?? null : results, error: null };
  }
}

function configure({ supabase, projectIds = [PROJECT_A], userId = USER_A }) {
  configureMembership({ supabase, projectIds, user: { id: userId } });
}

function formData(projectId, question, conversationId = CONVERSATION_A, activeReviewId = "") {
  const data = new FormData();
  data.set("projectId", projectId);
  data.set("question", question);
  data.set("conversationId", conversationId);
  if (activeReviewId) data.set("activeReviewId", activeReviewId);
  return data;
}

function modelCitingFirstSource({ user }) {
  const prompt = JSON.parse(user);
  const source = prompt.current_verified_sources[0];
  return { ok: true, provider: "ollama", model: "test", content: JSON.stringify({
    claims: [{ text: "The schedule is delayed by two weeks.", citations: [{ source_id: source.source_id, excerpt: source.excerpt }] }],
  }) };
}

test("exact and paraphrased questions use ranked project retrieval and confirmed filters", async () => {
  const { supabase, store } = makeSupabase({ chunks: [sourceRow()] });
  configure({ supabase });
  configureModel(modelCitingFirstSource);

  const exact = await askAssistant(
    { conversationId: CONVERSATION_A, messages: [] },
    formData(PROJECT_A, "schedule delivery delayed"),
  );
  assert.equal(exact.messages[0].sources[0].id, CHUNK_A);
  assert.match(exact.messages[0].answer, /\[S1\]/);
  assert.equal("confidence" in exact.messages[0].sources[0], false);

  const paraphrased = await askAssistant(
    exact,
    formData(PROJECT_A, "What is happening with the schedule during the current period in 2026-06?"),
  );
  assert.equal(paraphrased.messages.at(-1).sources[0].id, CHUNK_A);
  assert.equal(store.rpcCalls[0].name, "search_project_document_chunks");
  assert.equal(store.rpcCalls[0].parameters.p_query, "schedule delivery delayed");
  assert.equal(store.rpcCalls[1].parameters.p_evidence_role, "current");
  assert.equal(store.rpcCalls[1].parameters.p_reporting_period, "2026-06-01");
  assert.equal(store.rpcCalls[1].parameters.p_review_id, null);
  assert.equal(modelCalls().length, 2);
});

test("no-match evidence returns insufficient evidence without calling the model", async () => {
  const { supabase } = makeSupabase({ chunks: [sourceRow({ text: "Procurement submittal for electrical equipment." })] });
  configure({ supabase });
  configureModel(async () => { throw new Error("model must not be called for no-match retrieval"); });

  const result = await askAssistant(
    { conversationId: CONVERSATION_A, messages: [] },
    formData(PROJECT_A, "Does the contract include an ocean freight delay?"),
  );
  assert.equal(result.messages[0].insufficientEvidence, true);
  assert.deepEqual(result.messages[0].sources, []);
  assert.match(result.messages[0].answer, /does not contain matching evidence/);
  assert.equal(modelCalls().length, 0);
});

test("follow-ups load scoped prior turns but cite only fresh retrieval results", async () => {
  const prior = {
    project_id: PROJECT_A,
    user_id: USER_A,
    conversation_id: CONVERSATION_A,
    question: "What is the latest schedule status?",
    answer: "The previous answer said delivery was delayed.",
    insufficient_evidence: false,
    evidence_links: [sourceRow()],
    inferred_claims: [],
    recommended_action_ids: [],
    created_at: "2026-06-08T10:00:00.000Z",
  };
  const { supabase, store } = makeSupabase({
    chunks: [sourceRow({ text: "Current schedule records a two-week delay.", rank: 0.9 })],
    interactions: [prior],
  });
  configure({ supabase });
  configureModel(modelCitingFirstSource);

  const result = await askAssistant(
    { conversationId: CONVERSATION_A, messages: [] },
    formData(PROJECT_A, "Why?"),
  );
  const prompt = JSON.parse(modelCalls()[0].user);
  assert.equal(prompt.prior_conversation_context_only[0].question, prior.question);
  assert.equal(prompt.prior_conversation_context_only[0].answer, prior.answer);
  assert.deepEqual(prompt.current_verified_sources.map((source) => source.source_id), [CHUNK_A]);
  assert.equal(result.messages.at(-1).sources[0].id, CHUNK_A);
  assert.match(store.rpcCalls[0].parameters.p_query, /What is the latest schedule status\?/u);
  assert.equal(store.interactions.at(-1).conversation_id, CONVERSATION_A);
});
test("valid source IDs with forged excerpts are rejected, while exact excerpts are cited", async () => {
  const { supabase } = makeSupabase({ chunks: [sourceRow()] });
  configure({ supabase });
  configureModel(async ({ user }) => {
    const prompt = JSON.parse(user);
    return { ok: true, provider: "ollama", model: "test", content: JSON.stringify({
      claims: [{
        text: "The budget is approved.",
        citations: [{ source_id: prompt.current_verified_sources[0].source_id, excerpt: "This forged text is not in the retrieved source." }],
      }],
    }) };
  });
  const forged = await askAssistant(
    { conversationId: CONVERSATION_A, activeReviewId: null, messages: [] },
    formData(PROJECT_A, "schedule status"),
  );
  assert.equal(forged.messages[0].insufficientEvidence, true);
  assert.deepEqual(forged.messages[0].sources, []);
  assert.doesNotMatch(forged.messages[0].answer, /budget is approved/u);

  configure({ supabase });
  configureModel(modelCitingFirstSource);
  const valid = await askAssistant(
    { conversationId: CONVERSATION_A, activeReviewId: null, messages: [] },
    formData(PROJECT_A, "schedule status"),
  );
  assert.equal(valid.messages.at(-1).insufficientEvidence, false);
  assert.equal(valid.messages.at(-1).sources[0].id, CHUNK_A);
});

test("active review constrains ordinary retrieval while historical questions remain project scoped", async () => {
  const reviewId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const otherReviewId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const { supabase, store } = makeSupabase({
    chunks: [
      sourceRow({ reviewIds: [reviewId] }),
      sourceRow({ chunkId: CHUNK_B, reviewIds: [otherReviewId], text: "Historical schedule evidence from the prior review." }),
    ],
    reviews: [{ id: reviewId, project_id: PROJECT_A }],
  });
  configure({ supabase });
  configureModel(modelCitingFirstSource);

  const active = await askAssistant(
    { conversationId: CONVERSATION_A, activeReviewId: null, messages: [] },
    formData(PROJECT_A, "schedule status", CONVERSATION_A, reviewId),
  );
  assert.equal(store.rpcCalls[0].parameters.p_review_id, reviewId);
  assert.deepEqual(active.messages[0].sources.map((source) => source.id), [CHUNK_A]);

  const historical = await askAssistant(
    active,
    formData(PROJECT_A, "Compare historical schedule evidence", CONVERSATION_A, reviewId),
  );
  assert.equal(store.rpcCalls[1].parameters.p_review_id, null);
  const historicalPrompt = JSON.parse(modelCalls().at(-1).user);
  assert.deepEqual(
    new Set(historicalPrompt.current_verified_sources.map((source) => source.source_id)),
    new Set([CHUNK_A, CHUNK_B]),
  );
  assert.ok(historical.messages.at(-1).sources.length > 0);
  assert.equal(historical.activeReviewId, reviewId);
  assert.equal((await loadLatestAssistantConversation(PROJECT_A)).activeReviewId, reviewId);
});

test("a review ID from another project cannot constrain or trigger retrieval", async () => {
  const foreignReviewId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const { supabase, store } = makeSupabase({
    chunks: [sourceRow()],
    reviews: [{ id: foreignReviewId, project_id: PROJECT_B }],
  });
  configure({ supabase });
  configureModel(async () => { throw new Error("an unverified review must not call the model"); });
  const result = await askAssistant(
    { conversationId: CONVERSATION_A, activeReviewId: null, messages: [] },
    formData(PROJECT_A, "schedule status", CONVERSATION_A, foreignReviewId),
  );
  assert.equal(store.rpcCalls.length, 0);
  assert.equal(result.messages[0].insufficientEvidence, true);
  assert.equal(result.activeReviewId, null);
  assert.match(result.messages[0].answer, /active review could not be verified/u);
});
test("question length is bounded before retrieval, with the exact limit accepted", async () => {
  const { supabase, store } = makeSupabase({ chunks: [sourceRow({ text: "schedule x" })] });
  configure({ supabase });
  configureModel(modelCitingFirstSource);
  const exact = await askAssistant(
    { conversationId: CONVERSATION_A, activeReviewId: null, messages: [] },
    formData(PROJECT_A, `schedule ${"x".repeat(991)}`),
  );
  assert.equal(store.rpcCalls.length, 1);
  assert.equal(store.rpcCalls[0].parameters.p_query.length, 1000);
  assert.equal(exact.messages[0].insufficientEvidence, false, JSON.stringify(exact.messages[0]));

  const tooLong = await askAssistant(
    exact,
    formData(PROJECT_A, `schedule ${"x".repeat(992)}`),
  );
  assert.equal(store.rpcCalls.length, 1);
  assert.equal(modelCalls().length, 1);
  assert.equal(tooLong.messages.at(-1).insufficientEvidence, true);
  assert.match(tooLong.messages.at(-1).answer, /1000 characters or fewer/u);
});

test("stale model source IDs are rejected instead of displayed", async () => {
  const { supabase } = makeSupabase({ chunks: [sourceRow()] });
  configure({ supabase });
  configureModel(async () => ({
    ok: true,
    provider: "ollama",
    model: "test",
    content: JSON.stringify({
      claims: [{
        text: "A forged claim says the budget is approved.",
        citations: [{ source_id: CHUNK_B, excerpt: "The current schedule shows delivery delayed by two weeks." }],
      }],
    }),
  }));

  const result = await askAssistant(
    { conversationId: CONVERSATION_A, activeReviewId: null, messages: [] },
    formData(PROJECT_A, "schedule status"),
  );
  assert.equal(result.messages[0].insufficientEvidence, true);
  assert.deepEqual(result.messages[0].sources, []);
  assert.doesNotMatch(result.messages[0].answer, /forged claim|budget is approved/u);
  assert.match(result.messages[0].answer, /No unsupported answer was shown/u);
});

test("project, user, and conversation scopes exclude other history and source rows", async () => {
  const sameConversationOtherProject = {
    project_id: PROJECT_B, user_id: USER_A, conversation_id: CONVERSATION_A,
    question: "PROJECT B PRIVATE QUESTION", answer: "PROJECT B PRIVATE ANSWER",
    insufficient_evidence: false, evidence_links: [], inferred_claims: [], recommended_action_ids: [],
    created_at: "2026-06-09T10:00:00.000Z",
  };
  const anotherConversation = {
    ...sameConversationOtherProject,
    project_id: PROJECT_A,
    conversation_id: CONVERSATION_B,
    question: "OTHER CONVERSATION QUESTION",
    answer: "OTHER CONVERSATION ANSWER",
  };
  const anotherUser = {
    ...sameConversationOtherProject,
    project_id: PROJECT_A,
    user_id: USER_B,
    question: "OTHER USER QUESTION",
    answer: "OTHER USER ANSWER",
  };
  const { supabase, store } = makeSupabase({
    chunks: [sourceRow(), sourceRow({ chunkId: CHUNK_B, projectId: PROJECT_B, text: "Project B schedule confidential evidence." })],
    interactions: [sameConversationOtherProject, anotherConversation, anotherUser],
  });
  configure({ supabase });
  configureModel(modelCitingFirstSource);

  const result = await askAssistant(
    { conversationId: CONVERSATION_A, messages: [] },
    formData(PROJECT_A, "schedule status"),
  );
  const prompt = JSON.parse(modelCalls()[0].user);
  assert.deepEqual(prompt.prior_conversation_context_only, []);
  assert.deepEqual(prompt.current_verified_sources.map((source) => source.source_id), [CHUNK_A]);
  assert.equal(store.rpcCalls[0].parameters.p_project_id, PROJECT_A);
  assert.equal(result.messages[0].sources[0].documentId, sourceRow().document_id);

  configure({ supabase });
  const latest = await loadLatestAssistantConversation(PROJECT_A);
  assert.equal(latest.conversationId, CONVERSATION_B);
  assert.equal(latest.messages.at(-1).question, "OTHER CONVERSATION QUESTION");
  assert.ok(!latest.messages.some((message) => message.question.includes("PRIVATE")));

  await assert.rejects(
    askAssistant({ conversationId: CONVERSATION_A, messages: [] }, formData(PROJECT_B, "schedule status")),
    /not a project member/,
  );
});
