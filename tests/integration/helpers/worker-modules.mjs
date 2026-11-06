// Loads the worker modules under test into throwaway ESM next to their sources,
// the same seam pattern the phase6 worker tests use, so tests can exercise the
// real parser -> extraction -> job path without a build step.
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const ts = require("typescript");

export const REPO_ROOT = dirname(
  dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
);

const SOURCES = {
  parser: "worker/src/services/document-parser.ts",
  extraction: "worker/src/services/document-extraction.ts",
  job: "worker/src/jobs/process-document.ts",
  zipSafety: "src/features/documents/lib/zip-safety.ts",
  guards: "worker/src/types/guards.ts",
  constants: "src/features/documents/lib/constants.ts",
  costEvidence: "src/features/assurance/lib/cost-evidence.ts",
  sourceValue: "src/features/documents/lib/source-value-validation.ts",
};

export async function loadWorkerModules(repoRoot = REPO_ROOT) {
  const compiled = {};
  for (const [key, relative] of Object.entries(SOURCES)) {
    const source = join(repoRoot, relative);
    const target = join(dirname(source), `.worker-module-${randomUUID()}.mjs`);
    compiled[key] = {
      target,
      code: ts.transpileModule(readFileSync(source, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText,
    };
  }
  const href = (key) => pathToFileURL(compiled[key].target).href;
  const rewrite = (key, replacements) => {
    let code = compiled[key].code;
    for (const [from, to] of replacements) code = code.replace(from, `from "${href(to)}"`);
    writeFileSync(compiled[key].target, code);
  };
  writeFileSync(compiled.zipSafety.target, compiled.zipSafety.code);
  writeFileSync(compiled.constants.target, compiled.constants.code);
  writeFileSync(compiled.costEvidence.target, compiled.costEvidence.code);
  writeFileSync(compiled.sourceValue.target, compiled.sourceValue.code);
  writeFileSync(compiled.guards.target, compiled.guards.code);
  rewrite("parser", [['from "../../../src/features/documents/lib/zip-safety"', "zipSafety"]]);
  rewrite("extraction", [
    ['from "../../../src/features/documents/lib/constants"', "constants"],
    ['from "../../../src/features/assurance/lib/cost-evidence"', "costEvidence"],
    ['from "../../../src/features/documents/lib/source-value-validation"', "sourceValue"],
    ['from "../types/guards"', "guards"],
  ]);
  rewrite("job", [
    ['from "../services/document-parser"', "parser"],
    ['from "../services/document-extraction"', "extraction"],
  ]);

  try {
    const parser = await import(href("parser"));
    const extraction = await import(href("extraction"));
    const job = await import(href("job"));
    return {
      parseDocumentBuffer: parser.parseDocumentBuffer,
      extractDocumentGroups: extraction.extractDocumentGroups,
      processDocumentJob: job.processDocumentJob,
    };
  } finally {
    for (const { target } of Object.values(compiled)) unlinkSync(target);
  }
}
