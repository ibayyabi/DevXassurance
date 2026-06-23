export type AssistantSource = {
  documentTitle: string;
  excerpt: string;
  pageNumber: number | null;
  sectionLabel: string | null;
  confidence: number | null;
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
