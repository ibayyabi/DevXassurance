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

type FindingRow = {
  domain: string;
  condition: string;
  headline: string;
  explanation: string;
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

  const { data: review } = await supabase
    .from("assurance_reviews")
    .select("id, title, reporting_period")
    .eq("project_id", projectId)
    .order("reporting_period", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: reviewDocuments } = review
    ? await supabase
        .from("assurance_review_documents")
        .select("document_id")
        .eq("review_id", review.id)
        .eq("project_id", projectId)
    : { data: [] };
  const documentIds = (reviewDocuments ?? []).map((item) => item.document_id);

  const [{ data: chunks }, { data: findings }, { data: actions }] =
    review && documentIds.length > 0
      ? await Promise.all([
          supabase
            .from("document_chunks")
            .select("chunk_text, page_number, section_label, documents(title)")
            .eq("project_id", projectId)
            .in("document_id", documentIds)
            .or(search.map((term) => `chunk_text.ilike.%${term}%`).join(","))
            .limit(5),
          supabase
            .from("assurance_findings")
            .select("domain, condition, headline, explanation")
            .eq("review_id", review.id)
            .eq("project_id", projectId),
          supabase
            .from("assurance_actions")
            .select("id, title, owner_name, priority")
            .eq("review_id", review.id)
            .eq("project_id", projectId)
            .neq("status", "completed")
            .limit(5),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }];

  const chunkRows = (chunks ?? []) as unknown as ChunkRow[];
  const findingRows = (findings ?? []) as unknown as FindingRow[];
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
    sourcePath: `/app/projects/${projectId}/dashboard`,
  }));

  const insufficientEvidence = !review || (sources.length === 0 && findingRows.length === 0);
  const llmResult = insufficientEvidence
    ? null
    : await generateAssistantAnswer(
        question,
        review.title,
        findingRows,
        sources,
        recommendations,
      );
  const answer = insufficientEvidence
    ? "The latest automatic project assessment does not have enough evidence to answer that question. Add the missing project documents and try again."
    : llmResult?.ok
      ? llmResult.content
      : `AI Advisor could not generate a reliable answer: ${llmResult?.warning ?? "the configured model was unavailable"}. No fallback answer was created.`;

  const inferredClaims = insufficientEvidence || !llmResult?.ok
      ? []
    : [
        `The answer is scoped to ${review?.title} and its organized evidence.`,
        "Method guidance is general project-assurance guidance and not a licensed reproduction of PMBOK.",
      ];

  await supabase.from("assistant_interactions").insert({
    project_id: projectId,
    assurance_review_id: review?.id ?? null,
    user_id: user.id,
    question,
    answer,
    insufficient_evidence: insufficientEvidence || !llmResult?.ok,
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
        insufficientEvidence: insufficientEvidence || !llmResult?.ok,
        sources,
        inferredClaims,
        recommendations,
      },
    ],
  };
}

async function generateAssistantAnswer(
  question: string,
  reviewTitle: string,
  findings: FindingRow[],
  sources: AssistantSource[],
  recommendations: AssistantRecommendation[],
) {
  const evidence = [
    ...findings.map(
      (finding, index) =>
        `Finding ${index + 1} [${finding.domain}, ${finding.condition}]: ${finding.headline}. ${finding.explanation}`,
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
      "You are X-Assurance AI Advisor. Write a clear management answer using four plain-text sections: Direct answer, Evidence, Next actions, and General guidance. Use short paragraphs or hyphen bullets only. Never use Markdown tables, bold markers, headings with hash characters, or decorative separators. Project claims must come only from supplied review evidence. Never claim a comparison that is not present. Never invent an owner, due date, threshold, or project fact. If an owner or due date is absent, say it is not assigned. If evidence is weak, state exactly what is missing. Keep general method guidance separate and do not pretend to quote PMBOK.",
    user: `Assurance Review: ${reviewTitle}\nQuestion: ${question}\n\nReview evidence and findings:\n${evidence.slice(0, 12000)}\n\nGeneral method guidance:\n- Confirm scope and reporting period before comparing performance.\n- Trace every finding to evidence.\n- Assign an accountable owner and due date to material actions.\n- Escalate exceptions according to approved governance thresholds.`,
  });

  return response;
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
