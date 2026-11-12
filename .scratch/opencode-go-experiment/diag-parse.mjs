// Parse-cost diagnostic for a single evidence file. No provider calls.
//
// Reports, for one workbook:
//   A. per-sheet raw XML size and cell counts (package level)
//   B. per-sheet xmldom cost, replicating the xlsx.ts row/cell traversal
//   C. the real parseDocumentBuffer: total ms, chunks, characters to chunking
//   D. the exact post-grouping group count, by probing the ceiling at
//      document-extraction.ts:775 with the provider deliberately unconfigured
//
// The parser was split into worker/src/services/document-parser/*.ts
// (commit 8a51d58), so this no longer hand-rewrites single imports: it reuses
// compileModuleGraph from the integration helper, which resolves the whole
// module graph.
//
// Usage: node .scratch/opencode-go-experiment/diag-parse.mjs "<path to file>"

import { readFileSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compileModuleGraph } from "../../tests/integration/helpers/worker-modules.mjs";

const require = createRequire(import.meta.url);
const JSZip = require("jszip");
const { DOMParser } = require("@xmldom/xmldom");

const target = process.argv[2];
if (!target) {
  console.error('Usage: node .scratch/opencode-go-experiment/diag-parse.mjs "<path to file>"');
  process.exit(1);
}

const PARSER_SOURCE = fileURLToPath(
  new URL("../../worker/src/services/document-parser.ts", import.meta.url),
);
const EXTRACTION_SOURCE = fileURLToPath(
  new URL("../../worker/src/services/document-extraction.ts", import.meta.url),
);

const fileBytes = readFileSync(target);
const asArrayBuffer = () =>
  fileBytes.buffer.slice(fileBytes.byteOffset, fileBytes.byteOffset + fileBytes.byteLength);
const mb = (bytes) => `${(bytes / 1e6).toFixed(2)} MB`;
const ms = (value) => `${value.toFixed(0)} ms`;

// Compile a module graph, import one of its members, then clean up the
// throwaway files. A fresh compile gives fresh module-level constants, which
// section D needs to re-read XASS_EXTRACTION_MAX_GROUPS per probe.
async function withModule(source, suffix, use) {
  const { compiled } = compileModuleGraph(source);
  const entry = [...compiled].find(([path]) => path.endsWith(suffix));
  if (!entry) throw new Error(`compiled module not found: ${suffix}`);
  try {
    return await use(await import(pathToFileURL(entry[1].target).href));
  } finally {
    for (const { target: file } of compiled.values()) {
      try { unlinkSync(file); } catch {}
    }
  }
}

console.log(`file: ${target}\n`);

// ---------------------------------------------------------------- A. package
const zip = await JSZip.loadAsync(fileBytes);
const workbookXml = await zip.file("xl/workbook.xml")?.async("text");
const relsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("text");
const relTargets = new Map(
  [...(relsXml ?? "").matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]),
);
const sheets = [...(workbookXml ?? "").matchAll(/<sheet\b[^>]*\/?>/g)].map((match, index) => {
  const tag = match[0];
  const name = /name="([^"]*)"/.exec(tag)?.[1] ?? `Sheet ${index + 1}`;
  const rid = /r:id="([^"]*)"/.exec(tag)?.[1] ?? "";
  const rel = relTargets.get(rid) ?? `worksheets/sheet${index + 1}.xml`;
  return { name, path: rel.startsWith("xl/") ? rel : `xl/${rel.replace(/^\//, "")}` };
});

console.log("A. package parts");
console.log(
  `${"sheet".padEnd(24)}${"raw XML".padStart(10)}${"rows".padStart(8)}` +
  `${"cells".padStart(10)}${"with value".padStart(12)}${"merges".padStart(8)}`,
);
const sheetXml = new Map();
let rawTotal = 0;
let cellTotal = 0;
let valuedTotal = 0;
for (const sheet of sheets) {
  const xml = await zip.file(sheet.path)?.async("text");
  if (!xml) {
    console.log(`${sheet.name.padEnd(24)}${"MISSING".padStart(10)}`);
    continue;
  }
  sheetXml.set(sheet.name, xml);
  const bytes = Buffer.byteLength(xml, "utf8");
  const rows = (xml.match(/<row[ >]/g) ?? []).length;
  const cells = (xml.match(/<c[ >]/g) ?? []).length;
  const valued = (xml.match(/<(?:v|is|f)[ >]/g) ?? []).length;
  const merges = (xml.match(/<mergeCell[ >]/g) ?? []).length;
  rawTotal += bytes;
  cellTotal += cells;
  valuedTotal += valued;
  console.log(
    `${sheet.name.slice(0, 23).padEnd(24)}${mb(bytes).padStart(10)}${String(rows).padStart(8)}` +
    `${String(cells).padStart(10)}${String(valued).padStart(12)}${String(merges).padStart(8)}`,
  );
}
console.log(
  `${"TOTAL".padEnd(24)}${mb(rawTotal).padStart(10)}${"".padStart(8)}` +
  `${String(cellTotal).padStart(10)}${String(valuedTotal).padStart(12)}`,
);
console.log(
  `  ${valuedTotal} of ${cellTotal} cells carry a value ` +
  `(${((valuedTotal / cellTotal) * 100).toFixed(1)}%); the rest are styled but empty.\n`,
);

// ------------------------------------------------- B. xmldom cost per sheet
// Replicates xlsx.ts:78-86 — DOM build, then the wildcard-namespace row and
// cell traversal. Replication, not instrumentation: worker/src is untouched.
console.log("B. xmldom cost per sheet (replicates xlsx.ts:78-86)");
console.log(
  `${"sheet".padEnd(24)}${"DOM build".padStart(12)}${"row+cell walk".padStart(15)}` +
  `${"total".padStart(10)}${"us/cell".padStart(10)}`,
);
let domTotal = 0;
for (const [name, xml] of sheetXml) {
  const parser = new DOMParser();
  const buildStart = performance.now();
  const document = parser.parseFromString(xml, "application/xml");
  const build = performance.now() - buildStart;

  const walkStart = performance.now();
  const rows = Array.from(document.getElementsByTagNameNS("*", "row"));
  let seen = 0;
  for (const row of rows) {
    for (const cell of Array.from(row.getElementsByTagNameNS("*", "c"))) {
      // The two lookups readWorkbookCell does per cell (xlsx.ts:712, 714).
      cell.getElementsByTagNameNS("*", "v")[0];
      cell.getElementsByTagNameNS("*", "f")[0];
      cell.getAttribute("r");
      seen += 1;
    }
  }
  const walk = performance.now() - walkStart;
  domTotal += build + walk;
  console.log(
    `${name.slice(0, 23).padEnd(24)}${ms(build).padStart(12)}${ms(walk).padStart(15)}` +
    `${ms(build + walk).padStart(10)}` +
    `${(seen ? ((build + walk) * 1000) / seen : 0).toFixed(1).padStart(10)}`,
  );
}
console.log(`${"TOTAL".padEnd(24)}${"".padStart(27)}${ms(domTotal).padStart(10)}\n`);

// ------------------------------------------------------- C. the real parser
const parsed = await withModule(PARSER_SOURCE, "document-parser.ts", async (parser) => {
  const started = performance.now();
  const result = await parser.parseDocumentBuffer(basename(target), asArrayBuffer());
  return { result, durationMs: performance.now() - started };
});

console.log("C. parseDocumentBuffer (worker/src/jobs/process-document.ts:21 path)");
console.log(`  total parse      : ${ms(parsed.durationMs)}`);
console.log(`  ok               : ${parsed.result.ok}`);
if (!parsed.result.ok) {
  console.log(`  errorCode        : ${parsed.result.errorCode}`);
  console.log(`  errorMessage     : ${parsed.result.errorMessage}`);
  process.exit(0);
}
const chunks = parsed.result.chunks;
const chars = chunks.reduce((sum, chunk) => sum + (chunk.chunkText?.length ?? 0), 0);
console.log(`  parserVersion    : ${parsed.result.parserMetadata.parserVersion}`);
console.log(`  chunks           : ${chunks.length}  (pre-grouping count)`);
console.log(`  chars to chunking: ${chars.toLocaleString()}`);
console.log(`  share of parse in xmldom: ${((domTotal / parsed.durationMs) * 100).toFixed(0)}%`);

const perSheet = new Map();
for (const chunk of chunks) {
  const name = chunk.sourceLocation?.sheetName ?? "(none)";
  const entry = perSheet.get(name) ?? { chunks: 0, chars: 0 };
  entry.chunks += 1;
  entry.chars += chunk.chunkText?.length ?? 0;
  perSheet.set(name, entry);
}
console.log(`\n  chunks by sheet:`);
for (const [name, entry] of perSheet) {
  console.log(
    `    ${name.slice(0, 23).padEnd(24)}${String(entry.chunks).padStart(6)} chunks` +
    `${entry.chars.toLocaleString().padStart(12)} chars`,
  );
}

// ------------------------------------------------------- D. the group count
// document-extraction.ts:775 fails the document when groups.length exceeds the
// ceiling, and that check runs before configuredModelProvider (line 781) and
// before classifyDocument (line 791). With no provider configured, the two
// outcomes are distinguishable and neither reaches the network:
//   document_extraction_limit_exceeded -> the ceiling tripped
//   llm_provider_not_configured        -> it did not
// The smallest ceiling that does not trip equals groups.length exactly.
console.log(`\nD. post-grouping group count (no provider call)`);
const savedEnv = {
  provider: process.env.XASS_LLM_PROVIDER,
  ollama: process.env.OLLAMA_BASE_URL,
  ceiling: process.env.XASS_EXTRACTION_MAX_GROUPS,
};
process.env.XASS_LLM_PROVIDER = "ollama";
delete process.env.OLLAMA_BASE_URL; // guarantees configuredModelProvider throws

const noopStore = {
  loadGroups: async () => [],
  saveGroup: async () => {},
  loadDocumentRows: async () => [],
};
const job = {
  projectId: "00000000-0000-0000-0000-000000000000",
  documentId: "00000000-0000-0000-0000-000000000000",
  fileName: basename(target),
  title: basename(target),
  fileBuffer: asArrayBuffer(),
  ownsJob: () => true,
};

const probe = async (ceiling) => {
  process.env.XASS_EXTRACTION_MAX_GROUPS = String(ceiling);
  return withModule(EXTRACTION_SOURCE, "document-extraction.ts", async (extraction) => {
    const outcome = await extraction.extractDocumentGroups(
      job, chunks, parsed.result.parserMetadata, noopStore,
    );
    return outcome.ok ? "ok" : outcome.errorCode;
  });
};

try {
  const atDefault = await probe(32);
  console.log(`  ceiling 32 (the default at line 651) -> ${atDefault}`);

  // Smallest non-tripping ceiling in [1, chunks.length]; groups <= chunks.
  let low = 1;
  let high = Math.max(1, chunks.length);
  let highCode = await probe(high);
  if (highCode === "document_extraction_limit_exceeded") {
    console.log(`  group count exceeds the chunk count (${high}); unexpected, not narrowed.`);
  } else {
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (await probe(mid) === "document_extraction_limit_exceeded") low = mid + 1;
      else high = mid;
    }
    console.log(`  groups.length    : ${low}  (exact, post-buildChunkGroups)`);
    console.log(`  chunks.length    : ${chunks.length}  (pre-grouping)`);
    console.log(
      `  verdict          : at the default ceiling of 32, line 775 ` +
      `${low > 32 ? "TRIPS -> document_extraction_limit_exceeded before any provider call" : "does not trip"}`,
    );
  }
} finally {
  for (const [key, value] of [
    ["XASS_LLM_PROVIDER", savedEnv.provider],
    ["OLLAMA_BASE_URL", savedEnv.ollama],
    ["XASS_EXTRACTION_MAX_GROUPS", savedEnv.ceiling],
  ]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
