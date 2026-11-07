// Measure cross-week content overlap at chunk and group level for the weekly
// workbook family (offline, zero tokens). Answers: if the group cache key were
// content-addressed per group instead of per document, how many groups of a
// next-week file would reuse the previous week's validated results?
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { loadWorkerModules, REPO_ROOT } from "../../tests/integration/helpers/worker-modules.mjs";

const SUBSYSTEMS = ["01_Alarm_Kebencanaan", "11_Pengelolaan_Utilitas", "12_BISMA"];
const SESSIONS = ["2026-10-09_w4", "2026-10-16_w5", "2026-10-23_w6", "2026-10-30_w7"];
const { parseDocumentBuffer } = await loadWorkerModules();

function textHash(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

for (const subsystem of SUBSYSTEMS) {
  const parsedBySession = {};
  for (const session of SESSIONS) {
    const rel = `demo-evidence-fixtures/smart-building-itb/sessions/${session}/${subsystem}_Subcontractor_Weekly.xlsx`;
    const buffer = readFileSync(join(REPO_ROOT, rel));
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const parsed = await parseDocumentBuffer(rel.split("/").pop(), arrayBuffer);
    if (!parsed.ok) { console.log(subsystem, session, "PARSE FAIL"); continue; }
    parsedBySession[session] = parsed;
  }
  const sessions = Object.keys(parsedBySession);
  console.log(`\n=== ${subsystem} ===`);
  for (let i = 1; i < sessions.length; i += 1) {
    const prev = parsedBySession[sessions[i - 1]];
    const curr = parsedBySession[sessions[i]];
    const prevTexts = prev.chunks.map((chunk) => chunk.chunkText);
    const currTexts = curr.chunks.map((chunk) => chunk.chunkText);
    const prevHashes = new Set(prevTexts.map(textHash));
    const identicalChunks = currTexts.filter((text) => prevHashes.has(textHash(text))).length;
    const sameCount = prevTexts.length === currTexts.length;
    // Positional equality as well (boundary stability).
    let positional = 0;
    if (sameCount) {
      for (let index = 0; index < prevTexts.length; index += 1) {
        if (prevTexts[index] === currTexts[index]) positional += 1;
      }
    }
    // Changed characters rough estimate: total length delta.
    const lenDelta = currTexts.join("").length - prevTexts.join("").length;
    console.log(
      `${sessions[i - 1]} → ${sessions[i]}: chunks ${prevTexts.length}${sameCount ? "" : `→${currTexts.length} (boundaries shifted)`}` +
      ` | identical by content: ${identicalChunks}/${currTexts.length} (${Math.round((identicalChunks / currTexts.length) * 100)}%)` +
      ` | identical positional: ${sameCount ? `${positional}/${currTexts.length}` : "n/a"}` +
      ` | total chars delta: ${lenDelta >= 0 ? "+" : ""}${lenDelta}`,
    );
  }
}
