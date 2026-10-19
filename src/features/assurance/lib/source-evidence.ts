export type SourceChunk = { document_id: string; chunk_text: string; page_number: number | null; section_label?: string | null; parser_metadata?: Record<string, unknown> | null; documents?: { title: string } | { title: string }[] | null };
export type VerifiedSource = { role: "baseline" | "current"; excerpt: string; documentId: string; documentTitle: string; pageNumber: number | null; sectionLabel: string | null; sourceLocation: Record<string, string | number> | null };

export function verifySourceExcerpt(role: "baseline" | "current", excerpt: string, chunks: readonly SourceChunk[], allowedDocumentIds: ReadonlySet<string>): VerifiedSource | null {
  const normalized = excerpt.trim();
  if (!normalized) return null;
  const source = chunks.find((chunk) => allowedDocumentIds.has(chunk.document_id) && chunk.chunk_text.includes(normalized));
  const related = source && (Array.isArray(source.documents) ? source.documents[0] : source.documents);
  const metadata = source?.parser_metadata?.sourceLocation;
  const sourceLocation = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? Object.fromEntries(Object.entries(metadata).filter((entry): entry is [string, string | number] => typeof entry[1] === "string" || typeof entry[1] === "number"))
    : null;
  return source ? { role, excerpt: normalized, documentId: source.document_id, documentTitle: related?.title ?? "Source document", pageNumber: source.page_number, sectionLabel: source.section_label ?? null, sourceLocation } : null;
}
