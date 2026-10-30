import { readFileSync } from "node:fs";
import React from "react";
import * as icons from "lucide-react";
import ts from "typescript";

const compile = (file) => ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const constants = {};
new Function("exports", compile("src/features/documents/lib/constants.ts"))(constants);
const exports = {};
const dependencies = {
  react: React,
  "lucide-react": icons,
  "@/components/ui/button": { Button: ({ children, ...props }) => React.createElement("button", { ...props, variant: undefined, size: undefined }, children) },
  "@/features/documents/lib/constants": constants,
};
new Function("require", "exports", "React", compile("src/features/documents/components/fact-review.tsx"))((name) => dependencies[name], exports, React);
export const factReview = exports;

export const facts = Array.from({ length: 22 }, (_, index) => ({
  id: `fact-${index}`, factType: ["risk", "milestone", "decision"][index % 3],
  documentId: `doc-${index % 2}`, documentTitle: `Document ${index % 2}`, documentProcessingStatus: "completed",
  extractedText: index === 0 ? "Total cost: IDR 125,000,000. Delivery is at risk." : `Extracted item ${index}`,
  originalValue: `Original wording ${index}`, editedValue: null, confidence: 0.8, confirmationState: "ai_extracted",
  evidenceLinks: [{ id: `link-${index}`, documentId: `doc-${index % 2}`, documentTitle: `Document ${index % 2}`, chunkId: "chunk-1", location: "Costs · Rows 2–8", excerpt: "Original source excerpt", confidence: 0.8 }],
}));
