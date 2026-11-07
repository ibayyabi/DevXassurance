import { PARSER_VERSION, normalizeText } from "./common";
import { chunkSourceBlocks } from "./chunking";
import type { ParseResult, ParsedSourceLocation, SourceBlock } from "./types";

export async function parseTextDocument(
  fileName: string,
  buffer: ArrayBuffer,
  extension: ".txt" | ".csv",
): Promise<ParseResult> {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return {
      ok: false,
      errorCode: "invalid_text_encoding",
      errorMessage: "The text file is not valid UTF-8.",
    };
  }

  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) {
    return {
      ok: false,
      errorCode: "invalid_text_content",
      errorMessage: "The text file contains binary control characters.",
    };
  }

  const normalized = normalizeText(text);
  if (!normalized) {
    return {
      ok: false,
      errorCode: "empty_document",
      errorMessage: "The document contains no readable text.",
    };
  }

  const blocks =
    extension === ".csv"
      ? csvBlocks(normalized)
      : paragraphBlocks(normalized, { kind: "text" });
  if (!blocks) {
    return {
      ok: false,
      errorCode: "csv_malformed",
      errorMessage: "The CSV file contains an unterminated quoted field.",
    };
  }

  const chunks = chunkSourceBlocks(blocks);
  return {
    ok: true,
    chunks,
    parserMetadata: {
      parser: extension === ".csv" ? "csv-records" : "plain-text",
      parserVersion: PARSER_VERSION,
      fileName,
      textLength: normalized.length,
      warnings: [],
    },
  };
}


export function isHeadingText(text: string) {
  const firstLine = text.split("\n")[0]?.trim() ?? "";
  return firstLine.length > 0 && firstLine.length <= 80 && !/[.!?]$/.test(firstLine);
}

export function paragraphBlocks(
  text: string,
  location: ParsedSourceLocation,
  groupKey = "document",
  initialSectionLabel?: string,
): SourceBlock[] {
  const paragraphs = normalizeText(text)
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const blocks: SourceBlock[] = [];
  let sectionLabel = initialSectionLabel;
  let lineNumber = 1;

  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index];
    const isHeading = isHeadingText(paragraph);
    if (isHeading) sectionLabel = paragraph.split("\n")[0].trim();
    const paragraphLocation: ParsedSourceLocation = {
      ...location,
      paragraphStart: index + 1,
      paragraphEnd: index + 1,
    };
    if (location.kind === "text") {
      paragraphLocation.lineStart = lineNumber;
      paragraphLocation.lineEnd = lineNumber + paragraph.split("\n").length - 1;
    }

    blocks.push({
      text: paragraph,
      kind: isHeading ? "heading" : "paragraph",
      location: paragraphLocation,
      groupKey,
      sectionLabel,
    });
    lineNumber += paragraph.split("\n").length + 1;
  }
  return blocks;
}

export function csvBlocks(text: string): SourceBlock[] | null {
  const records: string[] = [];
  let start = 0;
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '"') {
      if (inQuotes && text[index + 1] === '"') {
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (text[index] === "\n" && !inQuotes) {
      const record = text.slice(start, index).replace(/\r$/, "").trim();
      if (record) records.push(record);
      start = index + 1;
    }
  }
  if (inQuotes) return null;
  const finalRecord = text.slice(start).replace(/\r$/, "").trim();
  if (finalRecord) records.push(finalRecord);

  return records.map((record, index): SourceBlock => ({
    text: record,
    kind: index === 0 ? "table-header" : "table-row",
    location: {
      kind: "csv",
      rowStart: index + 1,
      rowEnd: index + 1,
    },
    groupKey: "csv",
  }));
}
