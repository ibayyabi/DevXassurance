import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const ts = (await import("typescript")).default;
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
for (const [src, out] of [
  ["src/features/documents/lib/zip-safety.ts", ".dbg-zip9.mjs"],
  ["src/features/documents/lib/constants.ts", ".dbg-const9.mjs"],
  ["src/features/assurance/lib/cost-evidence.ts", ".dbg-cost9.mjs"],
  ["src/features/documents/lib/source-value-validation.ts", ".dbg-svv9.mjs"],
  ["worker/src/types/guards.ts", ".dbg-guards9.mjs"],
]) writeFileSync(`worker/src/services/${out}`, compile(readFileSync(src, "utf8")));
writeFileSync("worker/src/services/.dbg-parser9.mjs", compile(readFileSync("worker/src/services/document-parser.ts", "utf8")).replace('from "../../../src/features/documents/lib/zip-safety"', `from "${pathToFileURL("worker/src/services/.dbg-zip9.mjs").href}"`));
writeFileSync("worker/src/services/.dbg-extraction9.mjs", compile(readFileSync("worker/src/services/document-extraction.ts", "utf8"))
  .replace('from "../../../src/features/documents/lib/constants"', `from "${pathToFileURL("worker/src/services/.dbg-const9.mjs").href}"`)
  .replace('from "../../../src/features/assurance/lib/cost-evidence"', `from "${pathToFileURL("worker/src/services/.dbg-cost9.mjs").href}"`)
  .replace('from "../../../src/features/documents/lib/source-value-validation"', `from "${pathToFileURL("worker/src/services/.dbg-svv9.mjs").href}"`)
  .replace('from "../types/guards"', `from "${pathToFileURL("worker/src/services/.dbg-guards9.mjs").href}"`)
  + "\nexport { adjudicateDeterministicObservations, deterministicCoverageComplete, deterministicCellClaims };\n");
console.log("generated");
