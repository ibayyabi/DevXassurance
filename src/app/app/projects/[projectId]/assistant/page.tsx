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

  return <AssistantChat projectId={projectId} />;
}

function AssistantLoading() {
  return (
    <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
      <div className="h-[620px] rounded-lg bg-surface shadow-sm" />
      <div className="h-[620px] rounded-lg bg-surface shadow-sm" />
    </div>
  );
}
