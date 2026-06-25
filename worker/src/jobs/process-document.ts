import { parseDocumentBuffer } from "../services/document-parser";

export type ProcessDocumentJob = {
  jobId: string;
  projectId: string;
  documentId: string;
  fileName: string;
  title?: string | null;
  documentType?: string | null;
  documentDate?: string | null;
  fileBuffer: ArrayBuffer;
};

export async function processDocumentJob(job: ProcessDocumentJob) {
  const result = await parseDocumentBuffer(job.fileName, job.fileBuffer);

  if (!result.ok) {
    return {
      jobId: job.jobId,
      projectId: job.projectId,
      documentId: job.documentId,
      status: "failed" as const,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
    };
  }

  const chunks = result.chunks.map((chunk) => chunk.chunkText);
  const snapshotDate = normalizeSnapshotDate(job.documentDate) ?? todayIsoDate();
  const llmOutput = await extractWithLlm(job, chunks);
  const fallbackFacts = extractPrototypeFacts(job, chunks);
  const fallbackSummary = buildPrototypeSummary(job, chunks);
  const fallbackHealth = buildHealthSnapshots(chunks, snapshotDate);
  const fallbackAlerts = buildAlerts(chunks);
  const fallbackActions = buildActions(chunks);

  return {
    jobId: job.jobId,
    projectId: job.projectId,
    documentId: job.documentId,
    status: "completed" as const,
    chunks: result.chunks.map((chunk) => ({
      chunk_index: chunk.chunkIndex,
      chunk_text: chunk.chunkText,
      page_number: chunk.pageNumber ?? null,
      section_label: chunk.sectionLabel ?? null,
        parser_metadata: result.parserMetadata,
      })),
    facts: llmOutput?.facts.length ? llmOutput.facts : fallbackFacts,
    summary: llmOutput?.summary ?? fallbackSummary,
    health_snapshots: llmOutput?.health_snapshots.length
      ? llmOutput.health_snapshots.map((snapshot) => ({
          ...snapshot,
          snapshot_date: snapshot.snapshot_date ?? snapshotDate,
        }))
      : fallbackHealth,
    alerts: llmOutput?.alerts.length ? llmOutput.alerts : fallbackAlerts,
    actions: llmOutput?.actions.length ? llmOutput.actions : fallbackActions,
    anomalies: buildAnomalies(
      job,
      llmOutput?.alerts.length ? llmOutput.alerts : fallbackAlerts,
      llmOutput?.facts.length ? llmOutput.facts : fallbackFacts,
    ),
    parserMetadata: {
      ...result.parserMetadata,
      llmProvider: llmOutput?.provider ?? "rule_fallback",
      llmModel: llmOutput?.model ?? null,
      llmWarning: llmOutput?.warning ?? null,
    },
  };
}

type LlmExtraction = {
  provider: string;
  model: string;
  warning?: string;
  facts: ReturnType<typeof extractPrototypeFacts>;
  summary: {
    summary_text: string;
    confidence: number;
    quality_warning: string | null;
  } | null;
  health_snapshots: {
    dimension: string;
    score: number | null;
    status: string;
    evidence_coverage: number;
    status_text: string;
    source_summary: string;
    snapshot_date?: string | null;
  }[];
  alerts: ReturnType<typeof buildAlerts>;
  actions: {
    title: string;
    owner_name: string | null;
    priority: "low" | "medium" | "high";
    status: string;
  }[];
};

async function extractWithLlm(
  job: ProcessDocumentJob,
  chunks: string[],
): Promise<LlmExtraction | null> {
  const provider = process.env.XASS_LLM_PROVIDER ?? "ollama";
  const sourceText = chunks.join("\n\n").slice(0, 18000);

  if (!sourceText) {
    return null;
  }

  if (provider === "ollama") {
    return extractWithOllama(job, sourceText);
  }

  if (provider === "ollama_cloud") {
    return extractWithOllamaCloud(job, sourceText);
  }

  if (provider === "openai-compatible") {
    return extractWithOpenAiCompatible(job, sourceText, provider);
  }

  return null;
}

async function extractWithOllama(
  job: ProcessDocumentJob,
  sourceText: string,
): Promise<LlmExtraction | null> {
  const baseUrl = process.env.OLLAMA_BASE_URL;
  const model = process.env.OLLAMA_MODEL ?? "qwen2.5:3b";

  if (!baseUrl) {
    return null;
  }

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          {
            role: "system",
            content:
              "You are X-Assurance, an AI Project Assurance analyst for PMO documents. Use only the supplied document text. Return valid JSON only.",
          },
          {
            role: "user",
            content: buildLlmPrompt(job, sourceText),
          },
        ],
        options: {
          temperature: 0.1,
        },
      }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      message?: { content?: string };
      response?: string;
    };
    const raw = payload.message?.content ?? payload.response ?? "";
    const parsed = parseJsonObject(raw);

    if (!parsed) {
      return null;
    }

    return normalizeLlmExtraction(parsed, "ollama", model);
  } catch {
    return null;
  }
}

async function extractWithOllamaCloud(
  job: ProcessDocumentJob,
  sourceText: string,
): Promise<LlmExtraction | null> {
  const model = process.env.OLLAMA_CLOUD_MODEL ?? "gpt-oss:20b";
  const baseUrl = process.env.OLLAMA_CLOUD_BASE_URL ?? "https://ollama.com/api";
  const apiKey = process.env.OLLAMA_API_KEY;

  if (!apiKey) {
    return null;
  }

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          {
            role: "system",
            content:
              "You are X-Assurance, an AI Project Assurance analyst for PMO documents. Use only the supplied document text. Return valid JSON only.",
          },
          {
            role: "user",
            content: buildLlmPrompt(job, sourceText),
          },
        ],
        format: "json",
        options: {
          temperature: 0.1,
        },
      }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      message?: { content?: string };
      response?: string;
    };
    const raw = payload.message?.content ?? payload.response ?? "";
    const parsed = parseJsonObject(raw);

    if (!parsed) {
      return null;
    }

    return normalizeLlmExtraction(parsed, "ollama_cloud", model);
  } catch {
    return null;
  }
}

async function extractWithOpenAiCompatible(
  job: ProcessDocumentJob,
  sourceText: string,
  provider: "openai-compatible",
): Promise<LlmExtraction | null> {
  const model =
    process.env.XASS_CLOUD_LLM_MODEL ?? "gpt-oss:20b";
  const baseUrl =
    process.env.XASS_CLOUD_LLM_BASE_URL ?? "https://ollama.com/v1";
  const apiKey =
    process.env.XASS_CLOUD_LLM_API_KEY ?? process.env.OLLAMA_API_KEY;

  if (!apiKey) {
    return null;
  }

  try {
    const response = await fetch(
      `${baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You are X-Assurance, an AI Project Assurance analyst for PMO documents. Use only the supplied document text. Return valid JSON only.",
            },
            {
              role: "user",
              content: buildLlmPrompt(job, sourceText),
            },
          ],
        }),
      },
    );

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = payload.choices?.[0]?.message?.content ?? "";
    const parsed = parseJsonObject(raw);

    if (!parsed) {
      return null;
    }

    return normalizeLlmExtraction(parsed, provider, model);
  } catch {
    return null;
  }
}

function buildLlmPrompt(job: ProcessDocumentJob, sourceText: string) {
  return `Analyze this project assurance document and extract grounded data for the X-Assurance prototype.

Rules:
- Use only the supplied document text.
- Do not invent numbers, owners, dates, or risks.
- Classify project health primarily with PMO judgment from the supplied text, not keyword matching.
- Always return one health snapshot for each dimension: overall, schedule, cost, risk, governance, audit_readiness.
- Use "green" when the document provides limited but meaningful project evidence and no material adverse signal is found.
- Use "amber" when evidence shows manageable concern, uncertainty, weak control, moderate delay, cost pressure, or an item needing management attention.
- Use "red" only for material adverse signals such as blocked delivery, severe delay, high or critical unresolved risk, major cost overrun, missing critical approval, or failed control.
- Use "insufficient_evidence" only when the document has no meaningful evidence for that dimension, is unreadable, or is unrelated to project assurance.
- When evidence is thin but not adverse, prefer a low-confidence green status over insufficient_evidence. Explain the limitation in status_text and source_summary.
- Return JSON only. No markdown.

Document metadata:
- title: ${job.title ?? job.fileName}
- file_name: ${job.fileName}
- document_type: ${job.documentType ?? "unknown"}
- document_date: ${job.documentDate ?? "unknown"}

Return exactly this JSON shape:
{
  "facts": [
    {
      "fact_type": "risk" | "issue" | "milestone" | "decision" | "owner_action",
      "extracted_text": "short extracted fact",
      "original_value": "source value or sentence",
      "confidence": 0.0,
      "evidence_chunk_index": 0,
      "excerpt": "short source excerpt"
    }
  ],
  "summary": {
    "summary_text": "grounded executive summary",
    "confidence": 0.0,
    "quality_warning": null
  },
  "health_snapshots": [
    {
      "dimension": "overall" | "schedule" | "cost" | "risk" | "governance" | "audit_readiness",
      "score": 0,
      "status": "green" | "amber" | "red" | "insufficient_evidence",
      "evidence_coverage": 0.0,
      "status_text": "short status rationale with confidence caveat when evidence is thin",
      "snapshot_date": "YYYY-MM-DD or null",
      "source_summary": "source evidence summary"
    }
  ],
  "alerts": [
    {
      "severity": "low" | "medium" | "high" | "critical",
      "impacted_area": "Schedule",
      "explanation": "grounded alert",
      "evidence_count": 1,
      "recommended_action": "specific next action"
    }
  ],
  "actions": [
    {
      "title": "specific recommended action",
      "owner_name": null,
      "priority": "low" | "medium" | "high",
      "status": "open"
    }
  ]
}

Document text:
${sourceText}`;
}

function parseJsonObject(raw: string) {
  const cleaned = raw
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeLlmExtraction(
  value: Record<string, unknown>,
  provider: string,
  model: string,
): LlmExtraction {
  const facts = Array.isArray(value.facts)
    ? value.facts.map(normalizeLlmFact).filter((fact) => fact !== null)
    : [];
  const healthSnapshots = Array.isArray(value.health_snapshots)
    ? value.health_snapshots
        .map(normalizeLlmHealthSnapshot)
        .filter((snapshot) => snapshot !== null)
    : [];
  const alerts = Array.isArray(value.alerts)
    ? value.alerts.map(normalizeLlmAlert).filter((alert) => alert !== null)
    : [];
  const actions = Array.isArray(value.actions)
    ? value.actions.map(normalizeLlmAction).filter((action) => action !== null)
    : [];

  return {
    provider,
    model,
    facts,
    summary: normalizeLlmSummary(value.summary),
    health_snapshots: healthSnapshots,
    alerts,
    actions,
  };
}

function normalizeLlmFact(value: unknown) {
  if (!isRecord(value)) return null;
  const factType = stringValue(value.fact_type);
  const extractedText = stringValue(value.extracted_text);

  if (
    !["risk", "issue", "milestone", "decision", "owner_action"].includes(
      factType,
    ) ||
    !extractedText
  ) {
    return null;
  }

  if (
    (factType === "risk" || factType === "issue") &&
    isBenignAssuranceText(extractedText)
  ) {
    return null;
  }

  return {
    fact_type: factType as
      | "risk"
      | "issue"
      | "milestone"
      | "decision"
      | "owner_action",
    extracted_text: extractedText,
    original_value: stringValue(value.original_value) || extractedText,
    confidence: boundedNumber(value.confidence, 0.65),
    evidence_chunk_index: Number.isInteger(value.evidence_chunk_index)
      ? Number(value.evidence_chunk_index)
      : 0,
    excerpt: stringValue(value.excerpt) || extractedText.slice(0, 280),
  };
}

function normalizeLlmSummary(value: unknown) {
  if (!isRecord(value)) return null;
  const summaryText = stringValue(value.summary_text);

  if (!summaryText) return null;

  return {
    summary_text: summaryText,
    confidence: boundedNumber(value.confidence, 0.65),
    quality_warning: stringValue(value.quality_warning) || null,
  };
}

function normalizeLlmHealthSnapshot(value: unknown) {
  if (!isRecord(value)) return null;
  const dimension = stringValue(value.dimension);
  const status = stringValue(value.status);
  const validDimensions = [
    "overall",
    "schedule",
    "cost",
    "risk",
    "governance",
    "audit_readiness",
  ];
  const validStatuses = ["green", "amber", "red", "insufficient_evidence"];

  if (!validDimensions.includes(dimension) || !validStatuses.includes(status)) {
    return null;
  }

  const normalizedScore = normalizeHealthScore(value.score, status);

  return {
    dimension,
    score: value.score === null ? null : normalizedScore,
    status,
    evidence_coverage: boundedNumber(value.evidence_coverage, 0.5),
    status_text: stringValue(value.status_text) || status,
    snapshot_date: normalizeSnapshotDate(stringValue(value.snapshot_date)),
    source_summary:
      stringValue(value.source_summary) || "Generated by LLM extraction.",
  };
}

function normalizeLlmAlert(value: unknown) {
  if (!isRecord(value)) return null;
  const severity = stringValue(value.severity);
  const explanation = stringValue(value.explanation);

  if (
    !["low", "medium", "high", "critical"].includes(severity) ||
    !explanation
  ) {
    return null;
  }

  if (severity === "low" && isBenignAssuranceText(explanation)) {
    return null;
  }

  return {
    severity: severity as "low" | "medium" | "high" | "critical",
    impacted_area: stringValue(value.impacted_area) || "Document intelligence",
    explanation,
    evidence_count: Math.max(0, Number(value.evidence_count ?? 1)),
    recommended_action:
      stringValue(value.recommended_action) ||
      "Review the source evidence and assign an owner.",
  };
}

function normalizeLlmAction(value: unknown) {
  if (!isRecord(value)) return null;
  const title = stringValue(value.title);
  const priority = stringValue(value.priority) || "medium";

  if (
    !title ||
    !["low", "medium", "high"].includes(priority) ||
    (priority === "low" && isGenericBenignAction(title))
  ) {
    return null;
  }

  return {
    title,
    owner_name: stringValue(value.owner_name) || null,
    priority: priority as "low" | "medium" | "high",
    status: "open",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function boundedNumber(value: unknown, fallback: number, max = 1) {
  const number = Number(value);

  if (!Number.isFinite(number)) return fallback;

  return Math.max(0, Math.min(max, number));
}

function normalizeHealthScore(value: unknown, status: string) {
  const number = Number(value);

  if (status === "insufficient_evidence") return null;

  const normalized =
    Number.isFinite(number) && number > 0 && number <= 1
      ? Math.round(number * 100)
      : Number.isFinite(number)
        ? Math.round(number)
        : null;

  if (status === "green") {
    return Math.max(80, Math.min(100, normalized ?? 88));
  }

  if (status === "amber") {
    return Math.max(50, Math.min(79, normalized ?? 68));
  }

  if (status === "red") {
    return Math.max(0, Math.min(49, normalized ?? 42));
  }

  return null;
}

function extractPrototypeFacts(job: ProcessDocumentJob, chunks: string[]) {
  const facts: {
    fact_type: "risk" | "issue" | "milestone" | "decision" | "owner_action";
    extracted_text: string;
    original_value: string;
    confidence: number;
    evidence_chunk_index: number;
    excerpt: string;
  }[] = [];

  for (const [index, chunk] of chunks.entries()) {
    const sentences = splitSentences(chunk);

    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();
      const factType = inferFactType(lower, job.documentType);

      if (!factType) {
        continue;
      }

      facts.push({
        fact_type: factType,
        extracted_text: sentence,
        original_value: sentence,
        confidence: 0.72,
        evidence_chunk_index: index,
        excerpt: sentence.slice(0, 280),
      });

      if (facts.length >= 12) {
        return facts;
      }
    }
  }

  if (facts.length === 0 && chunks[0]) {
    facts.push({
      fact_type: defaultFactType(job.documentType),
      extracted_text: chunks[0].slice(0, 320),
      original_value: chunks[0].slice(0, 320),
      confidence: 0.55,
      evidence_chunk_index: 0,
      excerpt: chunks[0].slice(0, 280),
    });
  }

  return facts;
}

function buildPrototypeSummary(job: ProcessDocumentJob, chunks: string[]) {
  const combined = chunks.join(" ");
  const source = combined.slice(0, 1200);

  return {
    summary_text: source
      ? `${job.title ?? job.fileName}: ${source}`
      : `${job.title ?? job.fileName} was parsed, but no summary text was available.`,
    confidence: source ? 0.68 : 0.25,
    quality_warning: source
      ? "Prototype summary generated by local rule-based worker. Validate before executive use."
      : "No extractable source text was available.",
  };
}

function buildHealthSnapshots(chunks: string[], snapshotDate: string) {
  const text = chunks.join(" ").toLowerCase();
  const overallStatus = inferHealthStatus(text, "overall");
  const scheduleStatus = inferHealthStatus(text, "schedule");
  const costStatus = inferHealthStatus(text, "cost");
  const riskStatus = inferHealthStatus(text, "risk");
  const governanceStatus = inferHealthStatus(text, "governance");
  const auditReadinessStatus = inferHealthStatus(text, "audit_readiness");

  return [
    {
      dimension: "overall",
      score: scoreForStatus(overallStatus),
      status: overallStatus,
      evidence_coverage: chunks.length > 0 ? 0.7 : 0.1,
      status_text: statusTextForStatus(overallStatus, "overall"),
      snapshot_date: snapshotDate,
      source_summary: "Generated from uploaded document text.",
    },
    {
      dimension: "schedule",
      score: scoreForStatus(scheduleStatus),
      status: scheduleStatus,
      evidence_coverage: chunks.length > 0 ? 0.65 : 0.1,
      status_text: statusTextForStatus(scheduleStatus, "schedule"),
      snapshot_date: snapshotDate,
      source_summary: "Prototype schedule assessment.",
    },
    {
      dimension: "cost",
      score: scoreForStatus(costStatus),
      status: costStatus,
      evidence_coverage: chunks.length > 0 ? 0.55 : 0.1,
      status_text: statusTextForStatus(costStatus, "cost"),
      snapshot_date: snapshotDate,
      source_summary: "Prototype cost assessment.",
    },
    {
      dimension: "risk",
      score: scoreForStatus(riskStatus),
      status: riskStatus,
      evidence_coverage: chunks.length > 0 ? 0.6 : 0.1,
      status_text: statusTextForStatus(riskStatus, "risk"),
      snapshot_date: snapshotDate,
      source_summary: "Prototype risk assessment.",
    },
    {
      dimension: "governance",
      score: scoreForStatus(governanceStatus),
      status: governanceStatus,
      evidence_coverage: chunks.length > 0 ? 0.5 : 0.1,
      status_text: statusTextForStatus(governanceStatus, "governance"),
      snapshot_date: snapshotDate,
      source_summary: "Prototype governance assessment.",
    },
    {
      dimension: "audit_readiness",
      score: scoreForStatus(auditReadinessStatus),
      status: auditReadinessStatus,
      evidence_coverage: chunks.length > 0 ? 0.5 : 0.1,
      status_text: statusTextForStatus(auditReadinessStatus, "audit readiness"),
      snapshot_date: snapshotDate,
      source_summary: "Prototype audit readiness assessment.",
    },
  ];
}

function inferHealthStatus(
  text: string,
  dimension:
    | "overall"
    | "schedule"
    | "cost"
    | "risk"
    | "governance"
    | "audit_readiness",
) {
  const scoped =
    dimension === "overall"
      ? text
      : extractRelevantText(text, dimension);

  if (!scoped.trim()) {
    return text.trim() ? "green" : "insufficient_evidence";
  }

  if (/\b(red|critical|severe|blocked)\b|high risk|major delay|overrun|over budget|behind by \d{2,}|variance.*\d{2,}%|approval missing|control failure|failed control/.test(scoped)) {
    return "red";
  }

  if (/\b(amber|at risk|warning|moderate)\b|delay|behind|slip|late|overdue|variance|forecast above|forecast exceeds|management attention|needs mitigation|weak control|unresolved/.test(scoped)) {
    return "amber";
  }

  if (/\b(green|on track|stable|within budget|low risk|compliant|complete)\b/.test(scoped)) {
    return "green";
  }

  return "green";
}

function extractRelevantText(text: string, dimension: string) {
  const keywords: Record<string, RegExp> = {
    schedule: /schedule|milestone|timeline|delay|behind|slip|late|overdue/g,
    cost: /cost|budget|forecast|variance|overrun|over budget/g,
    risk: /risk|issue|blocker|critical|high|impact|probability/g,
    governance: /governance|approval|decision|steering|committee|control|change request|stage gate/g,
    audit_readiness: /audit|evidence|readiness|compliance|control|traceability|approval|source/g,
  };
  const matcher = keywords[dimension];

  if (!matcher?.test(text)) return text;

  return splitSentences(text)
    .filter((sentence) => {
      matcher.lastIndex = 0;
      return matcher.test(sentence.toLowerCase());
    })
    .join(" ");
}

function scoreForStatus(
  status: "green" | "amber" | "red" | "insufficient_evidence",
) {
  if (status === "green") return 88;
  if (status === "amber") return 68;
  if (status === "insufficient_evidence") return null;
  return 42;
}

function statusTextForStatus(
  status: "green" | "amber" | "red" | "insufficient_evidence",
  dimension: string,
) {
  if (status === "green") return `Evidence indicates ${dimension} is stable.`;
  if (status === "amber") return `Evidence indicates ${dimension} needs attention.`;
  if (status === "insufficient_evidence") {
    return `Evidence is not sufficient to classify ${dimension}.`;
  }
  return `Evidence indicates ${dimension} is materially off track.`;
}

function buildAlerts(chunks: string[]) {
  const text = chunks.join(" ");
  const sentences = splitSentences(text);
  const alertSentence = sentences.find((sentence) =>
    /delay|behind|overdue|overrun|critical|blocker|high risk/i.test(sentence),
  );

  if (!alertSentence) {
    return [];
  }

  return [
    {
      severity: /critical|blocker|high risk/i.test(alertSentence)
        ? "high"
        : "medium",
      impacted_area: inferImpactedArea(alertSentence),
      explanation: alertSentence,
      evidence_count: 1,
      recommended_action: "Review this signal, confirm the owner, and record the mitigation plan.",
    },
  ];
}

function buildActions(chunks: string[]) {
  const alerts = buildAlerts(chunks);

  if (alerts.length === 0) {
    return [
      {
        title: "Review extracted document intelligence and confirm evidence quality.",
        owner_name: null,
        priority: "medium",
        status: "open",
      },
    ];
  }

  return alerts.map((alert) => ({
    title: alert.recommended_action,
    owner_name: null,
    priority: alert.severity === "high" ? "high" : "medium",
    status: "open",
  }));
}

function buildAnomalies(
  job: ProcessDocumentJob,
  alerts: ReturnType<typeof buildAlerts>,
  facts: ReturnType<typeof extractPrototypeFacts>,
) {
  const alertAnomalies = alerts.map((alert) => ({
    category: normalizeAnomalyCategory(alert.impacted_area),
    missing_field: null,
    severity: alert.severity,
    title: alert.impacted_area
      ? `${alert.impacted_area} signal requires review`
      : "Document intelligence signal requires review",
    affected_item: alert.explanation.slice(0, 240),
    explanation: alert.explanation,
    impact:
      "Evidence indicates a potential assurance concern that should be reviewed against project controls.",
    impact_rating:
      alert.severity === "critical" || alert.severity === "high"
        ? "High"
        : alert.severity === "medium"
          ? "Medium"
          : "Low",
    recommended_action: alert.recommended_action,
    suggested_owners: [],
    evidence_count: alert.evidence_count,
    absence_type: "not_applicable",
    rationale:
      "Generated from document-processing alert output so dashboard and anomaly views use the same evidence signal.",
  }));

  const accountabilityAnomalies = facts
    .filter((fact) => shouldFlagMissingOwner(fact))
    .slice(0, 3)
    .map((fact) => ({
      category: "accountability",
      missing_field: "owner",
      severity: "high" as const,
      title: `Missing owner for ${fact.fact_type}`,
      affected_item: fact.extracted_text.slice(0, 240),
      explanation:
        "The extracted risk or issue does not include a confirmed accountable owner.",
      impact:
        "An unowned project signal may delay mitigation, escalation, or management action.",
      impact_rating: "High",
      recommended_action:
        "Assign an owner and confirm the next mitigation or escalation step.",
      suggested_owners: [],
      evidence_count: 1,
      absence_type: "not_found_in_evidence",
      rationale:
        "Generated by document-processing accountability check for extracted risk and issue facts.",
    }));

  const anomalies = [...alertAnomalies, ...accountabilityAnomalies];

  if (anomalies.length > 0) {
    return anomalies.slice(0, 8);
  }

  return [
    {
      category: "governance",
      missing_field: "review",
      severity: "medium" as const,
      title: "Document intelligence review required",
      affected_item: job.title ?? job.fileName,
      explanation:
        "The document was processed, but no explicit anomaly signal was extracted.",
      impact:
        "A human reviewer should confirm whether the document introduces assurance concerns.",
      impact_rating: "Medium",
      recommended_action:
        "Review extracted facts and confirm whether any risk, issue, or governance gap should be tracked.",
      suggested_owners: [],
      evidence_count: facts.length,
      absence_type: "not_applicable",
      rationale:
        "Generated as a review prompt to keep document processing visible in the anomaly workflow.",
    },
  ];
}

function shouldFlagMissingOwner(
  fact: ReturnType<typeof extractPrototypeFacts>[number],
) {
  if (fact.fact_type !== "risk" && fact.fact_type !== "issue") {
    return false;
  }

  const text = `${fact.extracted_text} ${fact.original_value} ${fact.excerpt}`.toLowerCase();

  if (
    /\b(owner|owned|assigned|responsible|closed|retired|resolved|complete|completed|approved|green|on track|within budget|under budget|low risk|no high risk|no open|passed)\b/.test(text)
  ) {
    return false;
  }

  return /\b(risk|issue|blocker|delay|overdue|critical|high|missing|unassigned|no owner|not assigned|blocked|failed|failure)\b/.test(text);
}

function isBenignAssuranceText(value: string) {
  const text = value.toLowerCase();

  if (
    /\b(on track|ahead of schedule|completed on track|within budget|under budget|below budget|low risk|no high risk|no material delay|retired|closed|resolved|passed|green|complete|completed|approved)\b/.test(text)
  ) {
    return true;
  }

  return false;
}

function isGenericBenignAction(value: string) {
  const text = value.toLowerCase();

  if (
    /\b(continue|monitor|review and adjust|review and update|review extracted|keep weekly|maintain weekly|validate current progress|no specific recommended action)\b/.test(text)
  ) {
    return true;
  }

  return false;
}

function normalizeAnomalyCategory(area: string) {
  if (/cost|budget|forecast|overrun|variance/i.test(area)) return "cost";
  if (/schedule|delay|late|milestone|timeline/i.test(area)) return "schedule";
  if (/scope|change/i.test(area)) return "scope";
  if (/governance|approval|audit|readiness/i.test(area)) return "governance";
  if (/owner|accountability|action/i.test(area)) return "accountability";
  return "risk";
}

function inferFactType(
  lowerSentence: string,
  documentType?: string | null,
): "risk" | "issue" | "milestone" | "decision" | "owner_action" | null {
  if (/risk|threat|exposure|mitigation|probability|impact/.test(lowerSentence)) {
    return "risk";
  }
  if (/issue|blocker|overdue|delay|late|slip|problem/.test(lowerSentence)) {
    return "issue";
  }
  if (/milestone|target|deadline|baseline|planned|actual/.test(lowerSentence)) {
    return "milestone";
  }
  if (/approved|decision|agreed|steering|committee/.test(lowerSentence)) {
    return "decision";
  }
  if (/owner|action|assign|responsible|follow up|due/.test(lowerSentence)) {
    return "owner_action";
  }

  return documentType ? defaultFactType(documentType) : null;
}

function defaultFactType(
  documentType?: string | null,
): "risk" | "issue" | "milestone" | "decision" | "owner_action" {
  if (documentType === "risk_register") return "risk";
  if (documentType === "issue_log") return "issue";
  if (documentType === "schedule") return "milestone";
  if (documentType === "approval" || documentType === "meeting_minutes") {
    return "decision";
  }
  return "owner_action";
}

function inferImpactedArea(sentence: string) {
  if (/cost|budget|forecast|overrun|variance/i.test(sentence)) return "Cost";
  if (/risk|issue|blocker|critical/i.test(sentence)) return "Risk";
  if (/delay|behind|overdue|schedule|late|slip/i.test(sentence)) {
    return "Schedule";
  }
  return "Document intelligence";
}

function splitSentences(text: string) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 30)
    .slice(0, 80);
}

function normalizeSnapshotDate(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  return value;
}

function todayIsoDate() {
  const parts = new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "2-digit",
    timeZone: process.env.TZ ?? "Asia/Jakarta",
    year: "numeric",
  }).formatToParts(new Date());
  const valueByType = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return `${valueByType.year}-${valueByType.month}-${valueByType.day}`;
}
