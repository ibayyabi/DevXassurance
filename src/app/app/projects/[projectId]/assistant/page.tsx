import { Suspense } from "react";

import { AssistantChat } from "@/features/assistant/components/assistant-chat";
import { requireProjectMembership } from "@/features/projects/lib/queries";

export default function AssistantPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  return (
    <Suspense fallback={<AssistantLoading />}>
      <AssistantContent params={params} />
    </Suspense>
  );
}

async function AssistantContent({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await requireProjectMembership(projectId);
  const provider = process.env.XASS_LLM_PROVIDER ?? "ollama";
  const aiRuntime = {
    provider,
    model:
      provider === "ollama"
        ? (process.env.OLLAMA_MODEL ?? "qwen2.5:3b")
        : provider === "ollama_cloud"
          ? (process.env.OLLAMA_CLOUD_MODEL ?? "gpt-oss:20b")
          : (process.env.XASS_CLOUD_LLM_MODEL ?? "gpt-oss:20b"),
    configured:
      provider === "ollama"
        ? Boolean(process.env.OLLAMA_BASE_URL)
        : provider === "ollama_cloud"
          ? Boolean(process.env.OLLAMA_API_KEY)
          : Boolean(
              process.env.XASS_CLOUD_LLM_API_KEY ?? process.env.OLLAMA_API_KEY,
            ),
  };

  return (
    <div>
      <div className="mb-5">
        <p className="text-sm font-medium text-blue-700">AI Assistant</p>
        <h2 className="mt-1 text-2xl font-semibold text-slate-950">
          Project Assurance Q&A
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Ask project-scoped questions and validate answers against evidence sources.
        </p>
      </div>
      <AssistantChat projectId={projectId} aiRuntime={aiRuntime} />
    </div>
  );
}

function AssistantLoading() {
  return (
    <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
      <div className="h-[620px] rounded-lg bg-white shadow-sm" />
      <div className="h-[620px] rounded-lg bg-white shadow-sm" />
    </div>
  );
}
