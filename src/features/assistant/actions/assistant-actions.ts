"use server";

import { requireProjectMembership } from "@/features/projects/lib/queries";
import type {
  AssistantAnswer,
  AssistantRecommendation,
  AssistantSource,
} from "@/features/assistant/lib/types";
import { runOllamaChat } from "@/lib/ai/ollama";

export type AssistantActionState = {
  messages: AssistantAnswer[];
};

type ChunkRow = {
  chunk_text: string;
  page_number: number | null;
  section_label: string | null;
  documents: { title: string } | null;
};

type FactRow = {
  fact_type: string;
  extracted_text: string;
  confidence: number;
};

type ActionRow = {
  id: string;
  title: string;
  owner_name: string | null;
  priority: "low" | "medium" | "high";
  source_path: string | null;
};

export async function askAssistant(
  previousState: AssistantActionState,
  formData: FormData,
): Promise<AssistantActionState> {
  const projectId = String(formData.get("projectId") ?? "");
  const question = String(formData.get("question") ?? "").trim();

  if (!projectId || !question) {
    return previousState;
  }

  const { supabase, user } = await requireProjectMembership(projectId);
  const search = buildSearchTerms(question);

  const [{ data: chunks }, { data: facts }, { data: actions }] =
    await Promise.all([
      supabase
        .from("document_chunks")
        .select("chunk_text, page_number, section_label, documents(title)")
        .eq("project_id", projectId)
        .or(search.map((term) => `chunk_text.ilike.%${term}%`).join(","))
        .limit(4),
      supabase
        .from("extracted_facts")
        .select("fact_type, extracted_text, confidence")
        .eq("project_id", projectId)
        .or(search.map((term) => `extracted_text.ilike.%${term}%`).join(","))
        .limit(5),
      supabase
        .from("recommended_actions")
        .select("id, title, owner_name, priority, source_path")
        .eq("project_id", projectId)
        .limit(3),
    ]);

  const chunkRows = (chunks ?? []) as unknown as ChunkRow[];
  const factRows = (facts ?? []) as unknown as FactRow[];
  const actionRows = (actions ?? []) as unknown as ActionRow[];

  const sources: AssistantSource[] = chunkRows.map((chunk) => ({
    documentTitle: chunk.documents?.title ?? "Source document",
    excerpt: chunk.chunk_text.slice(0, 360),
    pageNumber: chunk.page_number,
    sectionLabel: chunk.section_label,
    confidence: 0.78,
  }));

  const recommendations: AssistantRecommendation[] = actionRows.map((action) => ({
    id: action.id,
    title: action.title,
    ownerName: action.owner_name,
    priority: action.priority,
    sourcePath: action.source_path ?? `/app/projects/${projectId}/anomalies`,
  }));

  const insufficientEvidence = sources.length === 0 && factRows.length === 0;
  const llmAnswer = insufficientEvidence
    ? null
    : await generateAssistantAnswer(
        question,
        factRows,
        sources,
        recommendations,
      );
  const answer = insufficientEvidence
    ? "Insufficient evidence is available in this project workspace to answer that question. Upload and process relevant documents or add reviewed findings before relying on an answer."
    : llmAnswer ?? buildAnswer(question, factRows, sources);

  const inferredClaims = insufficientEvidence
    ? []
    : [
        llmAnswer
          ? `Generated with ${configuredLlmLabel()} using retrieved project evidence.`
          : "Generated with grounded fallback logic because the configured LLM response was unavailable.",
      ];

  await supabase.from("assistant_interactions").insert({
    project_id: projectId,
    user_id: user.id,
    question,
    answer,
    insufficient_evidence: insufficientEvidence,
    evidence_links: sources,
    inferred_claims: inferredClaims,
    recommended_action_ids: recommendations.map((recommendation) => recommendation.id),
  });

  return {
    messages: [
      ...previousState.messages,
      {
        question,
        answer,
        insufficientEvidence,
        sources,
        inferredClaims,
        recommendations,
      },
    ],
  };
}

async function generateAssistantAnswer(
  question: string,
  facts: FactRow[],
  sources: AssistantSource[],
  recommendations: AssistantRecommendation[],
) {
  const evidence = [
    ...facts.map(
      (fact, index) =>
        `Fact ${index + 1} [${fact.fact_type}, confidence ${fact.confidence}]: ${fact.extracted_text}`,
    ),
    ...sources.map(
      (source, index) =>
        `Source ${index + 1} [${source.documentTitle}${source.pageNumber ? ` page ${source.pageNumber}` : ""}]: ${source.excerpt}`,
    ),
    ...recommendations.map(
      (recommendation, index) =>
        `Recommendation ${index + 1} [${recommendation.priority}]: ${recommendation.title} Owner: ${recommendation.ownerName ?? "unassigned"}`,
    ),
  ].join("\n");

  const response = await runOllamaChat({
    system:
      "You are X-Assurance, a project assurance assistant. Answer only from supplied evidence. If evidence is weak, say what is missing. Keep the response concise and actionable.",
    user: `Question: ${question}\n\nProject evidence:\n${evidence.slice(0, 12000)}`,
  });

  return response.ok ? response.content : null;
}

function configuredLlmLabel() {
  const provider = process.env.XASS_LLM_PROVIDER ?? "ollama";
  const model =
    provider === "ollama"
      ? (process.env.OLLAMA_MODEL ?? "qwen2.5:3b")
      : provider === "ollama_cloud"
        ? (process.env.OLLAMA_CLOUD_MODEL ?? "gpt-oss:20b")
        : (process.env.XASS_CLOUD_LLM_MODEL ?? "gpt-oss:20b");

  return `${provider} (${model})`;
}

function buildSearchTerms(question: string) {
  const terms = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 3)
    .slice(0, 5);

  return terms.length > 0 ? terms : ["project"];
}

function buildAnswer(
  question: string,
  facts: FactRow[],
  sources: AssistantSource[],
) {
  const factText = facts
    .map((fact) => `${fact.fact_type}: ${fact.extracted_text}`)
    .join(" ");
  const sourceText = sources.map((source) => source.excerpt).join(" ");
  const evidence = [factText, sourceText].filter(Boolean).join(" ");

  return `Based on project-scoped evidence for "${question}", the strongest available signal is: ${evidence.slice(0, 900)}${evidence.length > 900 ? "..." : ""}`;
}
