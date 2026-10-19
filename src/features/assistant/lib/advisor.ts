import type { AssistantSource } from "./types";

export type AdvisorTurn = { question: string; answer: string };
export type AdvisorClaim = { text: string; sourceIds: string[] };
export type ValidatedAdvisorResponse = {
  claims: AdvisorClaim[];
  methodGuidance: string[];
  rejectedClaimCount: number;
};

const MAX_CONTEXT_TURNS = 6;
const MAX_ANSWER_CLAIMS = 8;
const MAX_CLAIM_LENGTH = 1200;
const MAX_GUIDANCE_ITEMS = 4;
const MAX_GUIDANCE_LENGTH = 500;

export function advisorSearchFilters(question: string) {
  const normalized = question.toLowerCase();
  const roleMatches = [
    { role: "baseline", pattern: /\b(baseline|approved plan|rencana dasar|rencana awal)\b/u },
    { role: "current", pattern: /\b(current period|current evidence|periode berjalan|saat ini)\b/u },
    { role: "supporting", pattern: /\b(supporting evidence|pendukung)\b/u },
  ].filter(({ pattern }) => pattern.test(normalized));
  const periods = [...question.matchAll(/\b(20\d{2})-(0[1-9]|1[0-2])(?:-\d{2})?\b/gu)];

  return {
    evidenceRole: roleMatches.length === 1 ? roleMatches[0].role : null,
    reportingPeriod: periods.length === 1 ? `${periods[0][1]}-${periods[0][2]}-01` : null,
  };
}

export function advisorRetrievalQuery(question: string, previousQuestion?: string) {
  const normalized = question.trim().toLowerCase().replace(/[?!.]+$/gu, "").trim();
  const isFollowUp = /^(why|how so|what changed|what about that|tell me more|more detail|explain|kenapa|mengapa|bagaimana|apa maksudnya|lebih lanjut|jelaskan)\b/u.test(normalized);
  return isFollowUp && previousQuestion
    ? `${previousQuestion}\n${question}`
    : question;
}

export function shouldUseActiveReview(question: string) {
  const normalized = question.toLowerCase();
  const historicalOrComparative = /\b(compare|comparison|comparative|historical|history|trend|trends|what changed|between|versus|vs|previous|earlier|before|last period|perubahan|perbandingan|riwayat|sebelumnya|periode lalu)\b/u.test(normalized);
  const explicitPeriod = /\b20\d{2}-(0[1-9]|1[0-2])(?:-\d{2})?\b/u.test(question);
  return !historicalOrComparative && !explicitPeriod;
}

export function boundedAdvisorTurns(turns: AdvisorTurn[]): AdvisorTurn[] {
  return turns.slice(-MAX_CONTEXT_TURNS).map((turn) => ({
    question: turn.question.slice(0, MAX_CLAIM_LENGTH),
    answer: turn.answer.slice(0, MAX_CLAIM_LENGTH),
  }));
}

export function validateAdvisorResponse(
  content: string,
  sources: AssistantSource[],
): ValidatedAdvisorResponse | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.claims)) return null;

  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const claims: AdvisorClaim[] = [];
  let rejectedClaimCount = 0;
  for (const item of parsed.claims.slice(0, MAX_ANSWER_CLAIMS)) {
    if (
      !isRecord(item) ||
      typeof item.text !== "string" ||
      !item.text.trim() ||
      item.text.length > MAX_CLAIM_LENGTH ||
      !Array.isArray(item.citations) ||
      item.citations.length === 0 ||
      item.citations.length > 4
    ) {
      rejectedClaimCount += 1;
      continue;
    }

    const validSourceIds: string[] = [];
    for (const citation of item.citations) {
      if (!isRecord(citation) || typeof citation.source_id !== "string" || typeof citation.excerpt !== "string") {
        rejectedClaimCount += 1;
        continue;
      }
      const source = sourceById.get(citation.source_id);
      const normalizedExcerpt = normalizeCitationText(citation.excerpt);
      if (
        !source ||
        !normalizedExcerpt ||
        normalizedExcerpt.length > 500 ||
        !normalizeCitationText(source.excerpt).includes(normalizedExcerpt)
      ) {
        rejectedClaimCount += 1;
        continue;
      }
      validSourceIds.push(source.id);
    }
    if (validSourceIds.length === 0) {
      rejectedClaimCount += 1;
      continue;
    }
    claims.push({
      text: item.text.trim(),
      sourceIds: [...new Set(validSourceIds)],
    });
  }

  const methodGuidance = Array.isArray(parsed.method_guidance)
    ? parsed.method_guidance
        .filter((item): item is string => typeof item === "string" && Boolean(item.trim()) && item.length <= MAX_GUIDANCE_LENGTH)
        .slice(0, MAX_GUIDANCE_ITEMS)
        .map((item) => item.trim())
    : [];

  return { claims, methodGuidance, rejectedClaimCount };
}

function normalizeCitationText(value: string) {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}


export function formatCitedAnswer(
  claims: AdvisorClaim[],
  sources: AssistantSource[],
): string {
  const labels = new Map(sources.map((source, index) => [source.id, `S${index + 1}`]));
  return claims
    .map((claim) => `${claim.text} ${claim.sourceIds.map((id) => `[${labels.get(id)}]`).join(" ")}`)
    .join("\n\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
