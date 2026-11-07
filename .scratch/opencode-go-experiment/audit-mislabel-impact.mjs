// Mislabel impact audit (offline, zero tokens): scan every stored live-run
// summary for published facts whose extracted_text carries a percentage or a
// numeric metric while typed as risk/issue/decision/owner_action — the
// documented false-negative class of the milestone-only semantic guard.
import { readFileSync, readdirSync } from "node:fs";

const ROOTS = [
  ".local-evaluation/final-testing/live-asli-stage1",
  ".local-evaluation/final-testing/live-asli-stage2",
  ".local-evaluation/final-testing/live-asli-cost",
  ".local-evaluation/final-testing/live-asli-density1",
  ".local-evaluation/final-testing/live-workbook-gate",
  ".local-evaluation/final-testing/live",
];
const rows = [];
for (const root of ROOTS) {
  let summary;
  try { summary = JSON.parse(readFileSync(`${root}/live-run-summary.json`, "utf8")); } catch { continue; }
  for (const [doc, o] of Object.entries(summary.outcomes ?? {})) {
    for (const fact of o.facts ?? []) {
      const text = fact.extracted_text ?? "";
      const hasPercent = /\d+(?:[.,]\d+)?\s*(?:%|persen|percent)/i.test(text);
      if (hasPercent && fact.fact_type !== "milestone") {
        rows.push({ doc: doc.slice(0, 40), type: fact.fact_type, text: text.slice(0, 110) });
      }
    }
  }
}
console.log(`percent-carrying facts typed non-milestone: ${rows.length}`);
for (const r of rows) console.log(`- [${r.type}] "${r.text}" (${r.doc})`);
