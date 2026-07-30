import { redirect } from "next/navigation";

export default async function LegacyAssurancePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  redirect(`/app/projects/${projectId}/documents`);
}
