export type AssistantSource = {
  id: string;
  documentId: string;
  chunkIndex: number;
  documentTitle: string;
  excerpt: string;
  pageNumber: number | null;
  sectionLabel: string | null;
  sourceLocation: Record<string, string | number> | null;
  reportingPeriod: string | null;
  evidenceRole: string | null;
  reviewIds: string[];
  retrievalRank: number;
};

export type AssistantRecommendation = {
  id: string;
  title: string;
  ownerName: string | null;
  priority: "low" | "medium" | "high";
  sourcePath: string;
};

export type AssistantAnswer = {
  question: string;
  answer: string;
  insufficientEvidence: boolean;
  sources: AssistantSource[];
  inferredClaims: string[];
  recommendations: AssistantRecommendation[];
};
