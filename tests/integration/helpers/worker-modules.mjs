// Loads the worker modules under test into throwaway ESM next to their sources,
// the same seam pattern the phase6 worker tests use, so tests can exercise the
// real parser -> extraction -> job path without a build step.
//
// The compiler resolves the whole module graph: every relative import that
// points to a TypeScript file in the repo is transpiled recursively and its
// specifier rewritten to the compiled file URL — so services can be split into
// multiple modules without touching this helper or the per-test compile sites.
import { readFileSync, unlinkSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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

const TSC = { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } };

// Compile one TypeScript file and recursively compile every relative import
// that resolves to a .ts source. Returns { target, deps } for the entry; all
// compiled modules are written next to their sources and their import
// specifiers rewritten to file URLs.
function compileGraph(entryPath, compiled) {
  const abs = resolve(entryPath);
  if (compiled.has(abs)) return compiled.get(abs);
  const target = join(dirname(abs), `.worker-module-${randomUUID()}.mjs`);
  compiled.set(abs, { target, deps: [] }); // cycle guard: reserve before recursing
  const source = readFileSync(abs, "utf8");
  const out = ts.transpileModule(source, TSC).outputText;
  // Rewrite relative specifiers that resolve to a .ts sibling/source: transpile
  // the dependency and point the import at its compiled URL.
  const deps = [];
  const rewritten = out.replace(
    /(from\s*|import\s*\(\s*)(['"])(\.\.?\/[^'"]+)(\2)/g,
    (full, prefix, quote, specifier) => {
      const base = resolve(dirname(abs), specifier);
      const depPath = [`${base}.ts`, base].find(
        (candidate) => existsSync(candidate) && candidate.endsWith(".ts"),
      );
      if (!depPath) return full; // bare or non-TS import: leave untouched
      const dep = compileGraph(depPath, compiled);
      deps.push(dep.target);
      return `${prefix}${quote}${dep.target}${quote}`;
    },
  );
  writeFileSync(target, rewritten);
  const entry = { target, deps };
  compiled.set(abs, entry);
  return entry;
}

export async function loadWorkerModules(repoRoot = REPO_ROOT) {
  const compiled = new Map();
  const roots = [];
  for (const [key, relative] of Object.entries(SOURCES)) {
    roots.push({ key, entry: compileGraph(join(repoRoot, relative), compiled) });
  }
  // Write depth-first: dependencies land before their importers.
  const written = new Set();
  const writeTree = (entry) => {
    if (written.has(entry.target)) return;
    written.add(entry.target);
    for (const dep of entry.deps ?? []) writeTree({ target: dep });
    writeFileSync(entry.target, readFileSync(entry.target));
  };
  for (const { entry } of roots) writeTree(entry);
  const href = (entry) => pathToFileURL(entry.target).href;
  const byKey = Object.fromEntries(roots.map(({ key, entry }) => [key, entry]));

  try {
    const parser = await import(href(byKey.parser));
    const extraction = await import(href(byKey.extraction));
    const job = await import(href(byKey.job));
    return {
      parseDocumentBuffer: parser.parseDocumentBuffer,
      extractDocumentGroups: extraction.extractDocumentGroups,
      processDocumentJob: job.processDocumentJob,
      extraction,
    };
  } finally {
    for (const { target } of compiled.values()) {
      try { unlinkSync(target); } catch {}
    }
  }
}

// Shared compile entry for per-test compile sites: compiles a module graph and
// returns the compiled entry URL plus the map, so inline test harnesses can
// rewrite import specifiers without duplicating the transpile logic.
export function compileModuleGraph(entryPath) {
  const compiled = new Map();
  const entry = compileGraph(resolve(entryPath), compiled);
  for (const { target } of compiled.values()) {
    writeFileSync(target, readFileSync(target));
  }
  return { entry, compiled };
}
