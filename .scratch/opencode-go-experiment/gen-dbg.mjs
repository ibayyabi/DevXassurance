import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const ts = (await import("typescript")).default;
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
for (const [src, out] of [
  ["src/features/documents/lib/zip-safety.ts", "worker/src/services/.dbg-zip.mjs"],
  ["src/features/documents/lib/constants.ts", "worker/src/services/.dbg-const.mjs"],
  ["src/features/assurance/lib/cost-evidence.ts", "worker/src/services/.dbg-cost.mjs"],
  ["src/features/documents/lib/source-value-validation.ts", "worker/src/services/.dbg-svv.mjs"],
  ["worker/src/types/guards.ts", "worker/src/services/.dbg-guards.mjs"],
]) writeFileSync(out, compile(readFileSync(src, "utf8")));
writeFileSync("worker/src/services/.dbg-parser.mjs", compile(readFileSync("worker/src/services/document-parser.ts", "utf8")).replace('from "../../../src/features/documents/lib/zip-safety"', `from "${pathToFileURL("worker/src/services/.dbg-zip.mjs").href}"`));
writeFileSync("worker/src/services/.dbg-extraction.mjs", compile(readFileSync("worker/src/services/document-extraction.ts", "utf8"))
  .replace('from "../../../src/features/documents/lib/constants"', `from "${pathToFileURL("worker/src/services/.dbg-const.mjs").href}"`)
  .replace('from "../../../src/features/assurance/lib/cost-evidence"', `from "${pathToFileURL("worker/src/services/.dbg-cost.mjs").href}"`)
  .replace('from "../../../src/features/documents/lib/source-value-validation"', `from "${pathToFileURL("worker/src/services/.dbg-svv.mjs").href}"`)
  .replace('from "../types/guards"', `from "${pathToFileURL("worker/src/services/.dbg-guards.mjs").href}"`)
  + "\nexport { adjudicateDeterministicObservations, deterministicCoverageComplete, deterministicCellClaims, buildChunkGroups };\n");
console.log("generated");
