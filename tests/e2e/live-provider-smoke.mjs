import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd());
const ts = require("typescript");
const extractionSource = fileURLToPath(
  new URL("../../worker/src/services/document-extraction.ts", import.meta.url),
);
const guardSource = fileURLToPath(
  new URL("../../worker/src/types/guards.ts", import.meta.url),
);
const constantsSource = fileURLToPath(
  new URL("../../src/features/documents/lib/constants.ts", import.meta.url),
);
const costEvidenceSource = fileURLToPath(
  new URL("../../src/features/assurance/lib/cost-evidence.ts", import.meta.url),
);
const tempDir = mkdtempSync(join(tmpdir(), "xass-live-provider-smoke-"));

try {
  const guardModule = join(tempDir, "guards.mjs");
  const constantsModule = join(tempDir, "constants.mjs");
  const costEvidenceModule = join(tempDir, "cost-evidence.mjs");
  const extractionModule = join(tempDir, "document-extraction.mjs");
  const compile = (source) => ts.transpileModule(readFileSync(source, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  writeFileSync(guardModule, compile(guardSource));
  writeFileSync(constantsModule, compile(constantsSource));
  writeFileSync(costEvidenceModule, compile(costEvidenceSource));
  writeFileSync(
    extractionModule,
    compile(extractionSource)
      .replace(
        'from "../types/guards"',
        `from "${pathToFileURL(guardModule).href}"`,
      )
      .replace(
        'from "../../../src/features/documents/lib/constants"',
        `from "${pathToFileURL(constantsModule).href}"`,
      )
      .replace(
        'from "../../../src/features/assurance/lib/cost-evidence"',
        `from "${pathToFileURL(costEvidenceModule).href}"`,
      ),
  );
  const { extractDocumentGroups } = await import(pathToFileURL(extractionModule).href);
  const source = `SYNTHETIC PROJECT STATUS REPORT\nDocument date: 2026-03-10.\nReporting period: 2026-03-01.\nWorkstream: Civil works.\nThe approved forecast cost is USD 487000.\nThe operational readiness review is scheduled for 2026-04-18.`;
  const encoded = new TextEncoder().encode(source);
  const bytes = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
  const outcome = await extractDocumentGroups({
    projectId: "00000000-0000-4000-8000-000000000001",
    documentId: "00000000-0000-4000-8000-000000000002",
    fileName: "synthetic-live-provider-smoke.txt",
    fileBuffer: bytes,
  }, [{ chunkIndex: 0, chunkText: source, sectionLabel: "SYNTHETIC PROJECT STATUS REPORT" }], {
    parserVersion: "live-provider-smoke-v1",
  }, {
    async loadGroups() { return []; },
    async saveGroup() {},
  });

  if (outcome.ok) {
    console.log("Live provider smoke: strict extraction completed for generated synthetic evidence.");
  } else {
    console.error(`Live provider smoke: strict extraction failed visibly (code: ${outcome.errorCode}).`);
    process.exitCode = 1;
  }
} catch (error) {
  const code = error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : "smoke_runner_error";
  console.error(`Live provider smoke: could not run safely (code: ${code}).`);
  process.exitCode = 1;
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
