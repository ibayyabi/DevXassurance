// Offline probe: does the CURRENT working tree still accept a fact with
// fact_type "milestone" whose content is only a progress percentage
// ("Progress pekerjaan: 5%")? Replays the saved synthetic response through the
// real extractDocumentGroups seam with a mock provider. No network, no model.
import { readFile } from "node:fs/promises";
import { loadWorkerModules } from "../../tests/integration/helpers/worker-modules.mjs";

const dir = ".local-evaluation/production-live-diagnostic";
const saved = JSON.parse(await readFile(`${dir}/response-1.json`, "utf8"));
const { extractDocumentGroups } = await loadWorkerModules();

const text =
  "Weekly report. Progress pekerjaan: 5%. RISK R-1: Tower crane delivery is Open and rated High.";
const job = {
  jobId: "probe-milestone-fact",
  projectId: "probe",
  documentId: "synthetic",
  fileName: "synthetic.txt",
  fileBuffer: new TextEncoder().encode(text).buffer,
};

const savedFetch = globalThis.fetch;
process.env.XASS_LLM_PROVIDER = "ollama";
process.env.OLLAMA_BASE_URL = "http://probe.invalid";
process.env.OLLAMA_MODEL = "probe";

const reply = (value) =>
  new Response(
    JSON.stringify({ message: { content: typeof value === "string" ? value : JSON.stringify(value) } }),
    { status: 200 },
  );

// A milestone fact that is really a progress percent (the reported bug), plus
// a well-formed risk fact, replayed verbatim from the saved live response.
const analysisWithMilestoneFact = typeof saved === "string" ? saved : JSON.stringify(saved);
// A control: the same risk fact, but the progress stated correctly as a
// milestone with explicit milestone wording (should stay acceptable).
const analysisWithTrueMilestone = JSON.stringify({
  ...JSON.parse(analysisWithMilestoneFact),
  facts: [
    {
      fact_type: "milestone",
      extracted_text: "Menara crane selesai dipasang pada 3 Februari 2026",
      original_value: "Menara crane selesai dipasang pada 3 Februari 2026",
      confidence: 0.9,
      source_id: "chunk_0",
    },
  ],
});

async function run(analysisBody) {
  let ai = 0;
  const rows = new Map();
  globalThis.fetch = async (_url, init) => {
    const prompt = JSON.parse(init.body).messages[1].content;
    if (prompt.startsWith("Classify the entire document")) {
      const refs = JSON.parse(/^SOURCE_REFERENCES_JSON=(.+)$/m.exec(prompt)[1]);
      return reply({
        document_suggestions: {
          suggested_document_type: "progress_report",
          suggested_evidence_role: "current",
          classification_confidence: 0.9,
          classification_reason: "Synthetic weekly report.",
          source_id: refs[0].source_id,
        },
        quality_warning: null,
      });
    }
    if (prompt.startsWith("Create a concise whole-document assurance summary")) {
      const input = JSON.parse(/^EXECUTIVE_SUMMARY_INPUT_JSON=(.+)$/m.exec(prompt)[1]);
      return reply({
        summary_text: "- Synthetic weekly report.",
        confidence: 0.9,
        source_indexes: [input.sources[0].source_index],
      });
    }
    const isAnalysis = prompt.includes("Task: analyze this bounded group");
    const isDomain =
      prompt.startsWith("Extract grounded project assurance intelligence") &&
      !prompt.includes("narrative assurance signals");
    if (isDomain) {
      return reply({
        cost_observations: [],
        assurance_observations: {
          milestones: [],
          progress: [],
          risk_snapshots: [],
          risk_register_statements: [],
        },
      });
    }
    return reply(isAnalysis && ai++ === 0 ? analysisBody : analysisBody);
  };
  const result = await extractDocumentGroups(
    job,
    [{ chunkIndex: 0, chunkText: text, sectionLabel: "Synthetic" }],
    { parserVersion: "probe-milestone-v1" },
    {
      async loadGroups() {
        return [...rows.values()];
      },
      async saveGroup(row) {
        rows.set(row.groupKey, row);
      },
    },
  );
  return {
    ok: result.ok,
    facts: result.ok
      ? result.extraction.facts.map(({ fact_type, extracted_text, original_value }) => ({
          fact_type,
          extracted_text,
          original_value,
        }))
      : null,
    warnings: result.ok ? result.extraction.quality_warnings : null,
    checkpoints: [...rows.values()].map(({ status, lastError }) => ({ status, lastError })),
  };
}

try {
  const bugReplay = await run(analysisWithMilestoneFact);
  const control = await run(analysisWithTrueMilestone);
  console.log(
    JSON.stringify(
      {
        question:
          "Does the current validator reject a fact typed milestone whose content is only a progress percent?",
        bug_replay: bugReplay,
        control_true_milestone: control,
        network_calls: 0,
      },
      null,
      2,
    ),
  );
  const bugFacts = bugReplay.facts ?? [];
  const acceptedBugFact = bugFacts.find(
    (fact) => fact.fact_type === "milestone" && /progress pekerjaan/i.test(fact.extracted_text),
  );
  console.log(
    acceptedBugFact
      ? `\nVERDICT: GAP CONFIRMED — the milestone-typed progress fact is still published (checkpoints: ${JSON.stringify(bugReplay.checkpoints)}).`
      : `\nVERDICT: handled — the milestone-typed progress fact is not published as-is (facts: ${JSON.stringify(bugFacts)}; warnings: ${JSON.stringify(bugReplay.warnings)}).`,
  );
} finally {
  globalThis.fetch = savedFetch;
  delete process.env.XASS_LLM_PROVIDER;
  delete process.env.OLLAMA_BASE_URL;
  delete process.env.OLLAMA_MODEL;
}
