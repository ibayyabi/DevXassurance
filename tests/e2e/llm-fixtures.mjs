const DIMENSIONS = ["overall", "schedule", "cost", "risk", "governance", "audit_readiness"];

export function fixtureModelResponse(requestBody, requestPath) {
  const messages = requestBody?.messages;
  const prompt = Array.isArray(messages) ? messages.find((message) => message?.role === "user")?.content : null;
  if (typeof prompt !== "string") throw new Error("Fixture provider received no user prompt.");

  let result;
  if (prompt.startsWith("Extract grounded project assurance intelligence")) {
    result = extractionFixture(prompt);
  } else if (prompt.startsWith("Extract comparable Schedule, Progress, and Risk values")) {
    result = reviewFixture(prompt);
  } else if (prompt.includes("current_verified_sources")) {
    result = advisorFixture(prompt);
  } else {
    throw new Error("Fixture provider received an unsupported prompt shape.");
  }

  const content = JSON.stringify(result);
  if (requestPath === "/v1/chat/completions") {
    return { choices: [{ message: { role: "assistant", content } }] };
  }
  return { model: requestBody.model, message: { role: "assistant", content }, done: true };
}

function extractionFixture(prompt) {
  const chunksJson = between(prompt, "SOURCE_CHUNKS_JSON=", "\n\nRequired JSON schema");
  const chunks = JSON.parse(chunksJson);
  const source = chunks.find((chunk) => typeof chunk.text === "string" && chunk.text.trim());
  if (!source) throw new Error("Fixture provider received no source chunk.");
  const excerpt = source.text.slice(0, 450).trim();
  if (!excerpt) throw new Error("Fixture provider received an empty source excerpt.");
  const fullText = chunks.map((chunk) => chunk.text).join("\n");
  const type = documentType(fullText);
  const date = fullText.match(/(?:document date|date)\s*:\s*(20\d{2}-\d{2}-\d{2})/iu)?.[1] ?? null;
  const period = fullText.match(/reporting period\s*:\s*(20\d{2})-(\d{2})(?:-\d{2})?/iu);
  const workstream = fullText.match(/workstream\s*:\s*([^\n.]{1,200})/iu)?.[1]?.trim() ?? null;
  const role = type === "approved_baseline" ? "baseline" : type === "progress_report" ? "current" : "supporting";
  return {
    facts: [],
    summary: {
      summary_text: "The generated evidence was reviewed with source-backed citations; unsupported values were not inferred.",
      confidence: 0.9,
      quality_warning: null,
      sources: [{ evidence_chunk_index: source.chunk_index, excerpt }],
    },
    health_snapshots: DIMENSIONS.map((dimension) => ({
      dimension,
      score: null,
      status: "insufficient_evidence",
      evidence_coverage: 0,
      status_text: "No verified comparison was inferred from this document alone.",
      source_summary: "This single source does not establish a verified project health comparison.",
      snapshot_date: null,
      evidence_chunk_index: null,
      excerpt: null,
    })),
    alerts: [],
    actions: [],
    document_suggestions: {
      suggested_document_type: type,
      suggested_document_date: date,
      detected_reporting_period: period ? `${period[1]}-${period[2]}-01` : null,
      suggested_workstream: workstream,
      suggested_evidence_role: role,
      classification_confidence: 0.9,
      classification_reason: "Generated fixture classification follows labels present in the supplied synthetic source.",
      evidence_chunk_index: source.chunk_index,
      excerpt,
    },
  };
}

function documentType(text) {
  const value = text.toLowerCase();
  if (/approved project baseline|approved baseline|baseline document/u.test(value)) return "approved_baseline";
  if (/monthly progress report|progress report|project status report/u.test(value)) return "progress_report";
  if (/cost report/u.test(value)) return "cost_report";
  if (/risk register/u.test(value)) return "risk_register";
  if (/decision record/u.test(value)) return "decision_record";
  if (/issue log/u.test(value)) return "issue_log";
  return "other";
}

function reviewFixture(prompt) {
  const baseline = between(prompt, "BASELINE EVIDENCE:\n", "\n\nCURRENT EVIDENCE:");
  const current = prompt.slice(prompt.indexOf("\n\nCURRENT EVIDENCE:") + "\n\nCURRENT EVIDENCE:\n".length);
  const baselineMilestone = baseline.match(/^.*(?:milestone|readiness review).*20\d{2}-\d{2}-\d{2}.*$/imu);
  const currentMilestone = current.match(/^.*(?:milestone|readiness review).*20\d{2}-\d{2}-\d{2}.*$/imu);
  const baselineRisk = baseline.match(/^.*no open critical or high risks.*$/imu);
  const currentRisk = current.match(/^.*no open critical or high risks.*$/imu);
  if (!baselineRisk || !currentRisk) throw new Error("Fixture review requires explicit synthetic risk evidence.");
  const extractDate = (line) => line?.match(/20\d{2}-\d{2}-\d{2}/u)?.[0] ?? null;
  const milestoneName = "Operational readiness review";
  // Baseline and current milestones stay in separate lists; the application
  // matches them by label. Cost evidence is not extracted here; Budget uses
  // persisted cost observations and a reviewer-accepted baseline.
  const baselinePercent = baseline.match(/(\d{1,3})%\s*(?:complete|completion)/iu);
  const currentPercent = current.match(/(\d{1,3})%\s*(?:complete|completion)/iu);
  return {
    schedule: {
      baseline_milestones: baselineMilestone
        ? [{
            label: milestoneName,
            date: extractDate(baselineMilestone[0]),
            period_label: null,
            as_of_date: null,
            excerpt: baselineMilestone[0].trim(),
          }]
        : [],
      current_milestones: currentMilestone
        ? [{
            label: milestoneName,
            date: extractDate(currentMilestone[0]),
            period_label: null,
            as_of_date: null,
            excerpt: currentMilestone[0].trim(),
          }]
        : [],
      confidence: 0.9,
    },
    progress: {
      observations: [
        ...(baselinePercent
          ? [{ role: "baseline", scope_level: "project", scope_label: null, percent: Number(baselinePercent[1]), period_label: null, as_of_date: null, excerpt: baselinePercent[0].trim() }]
          : []),
        ...(currentPercent
          ? [{ role: "current", scope_level: "project", scope_label: null, percent: Number(currentPercent[1]), period_label: null, as_of_date: null, excerpt: currentPercent[0].trim() }]
          : []),
      ],
      confidence: 0.9,
    },
    risk: {
      has_current_evidence: true,
      open_critical_count: 0,
      open_high_count: 0,
      high_risks_missing_owner_or_mitigation: 0,
      increased_risk_count: 0,
      new_high_risk_count: 0,
      max_mitigation_overdue_days: 0,
      baseline_excerpt: baselineRisk[0].trim(),
      current_excerpt: currentRisk[0].trim(),
      confidence: 0.9,
    },
  };
}

function advisorFixture(prompt) {
  const payload = JSON.parse(prompt);
  const sources = Array.isArray(payload.current_verified_sources) ? payload.current_verified_sources : [];
  const source = sources.find((item) => typeof item.source_id === "string" && typeof item.excerpt === "string");
  if (!source) throw new Error("Fixture Advisor response requires a freshly retrieved source.");
  const requestedMilestone = /operational readiness review/iu.test(payload.question ?? "");
  const milestoneSentence = requestedMilestone
    ? source.excerpt.split(/[\r\n]+|(?<=[.!?])\s+/u).find((sentence) => /operational readiness review/iu.test(sentence))
    : null;
  const date = requestedMilestone
    ? milestoneSentence?.match(/20\d{2}-\d{2}-\d{2}/u)?.[0]
    : source.excerpt.match(/20\d{2}-\d{2}-\d{2}/u)?.[0];
  const text = date
    ? `The verified source records a project milestone date of ${date}.`
    : `The verified source ${source.document_title} contains evidence relevant to this question.`;
  return {
    claims: [{ text, citations: [{ source_id: source.source_id, excerpt: source.excerpt.slice(0, 500) }] }],
    method_guidance: [],
  };
}

function between(value, start, end) {
  const from = value.indexOf(start);
  if (from < 0) throw new Error("Fixture provider prompt is missing a required evidence section.");
  const first = from + start.length;
  const last = value.indexOf(end, first);
  if (last < 0) throw new Error("Fixture provider prompt is missing an evidence-section boundary.");
  return value.slice(first, last);
}
