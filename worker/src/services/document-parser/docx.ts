import {
  OfficePackageError,
  PARSER_VERSION,
  childElements,
  elementText,
  loadOfficePackage,
  parseXml,
} from "./common";
import { chunkSourceBlocks } from "./chunking";
import { isHeadingText } from "./text-csv";
import type { ParseResult, SourceBlock } from "./types";

export async function parseDocxDocument(
  fileName: string,
  buffer: ArrayBuffer,
): Promise<ParseResult> {
  try {
    const zip = await loadOfficePackage(buffer);
    const xml = await zip.file("word/document.xml")?.async("text");
    if (!xml) {
      return {
        ok: false,
        errorCode: "docx_malformed",
        errorMessage: "The DOCX package is missing its document content.",
      };
    }

    const document = parseXml(xml);
    const body = document.getElementsByTagName("w:body")[0];
    if (!body) {
      return {
        ok: false,
        errorCode: "docx_malformed",
        errorMessage: "The DOCX document has no readable body.",
      };
    }

    const styles = new Map<string, string>();
    const stylesXml = await zip.file("word/styles.xml")?.async("text");
    if (stylesXml) {
      const stylesDocument = parseXml(stylesXml);
      for (const style of Array.from(stylesDocument.getElementsByTagName("w:style"))) {
        const id = style.getAttribute("w:styleId")?.toLowerCase();
        const name = style.getElementsByTagName("w:name")[0]?.getAttribute("w:val");
        if (id) styles.set(id, name ?? id);
      }
    }

    const blocks: SourceBlock[] = [];
    let paragraphNumber = 0;
    let tableNumber = 0;
    let sectionLabel: string | undefined;

    for (const child of childElements(body)) {
      if (child.nodeName.endsWith(":p")) {
        paragraphNumber += 1;
        const text = elementText(child, "w:t");
        if (!text) continue;

        const styleId =
          child.getElementsByTagName("w:pStyle")[0]?.getAttribute("w:val")?.toLowerCase() ?? "";
        const styleName = styles.get(styleId) ?? styleId;
        const isHeading =
          /^(heading(?:\s*\d+)?|title|subtitle)$/i.test(styleName) ||
          isHeadingText(text);
        if (isHeading) sectionLabel = text;
        blocks.push({
          text,
          kind: isHeading ? "heading" : "paragraph",
          location: {
            kind: "docx",
            paragraphStart: paragraphNumber,
            paragraphEnd: paragraphNumber,
          },
          groupKey: "document",
          sectionLabel,
        });
        continue;
      }

      if (child.nodeName.endsWith(":tbl")) {
        tableNumber += 1;
        const rows = Array.from(child.getElementsByTagName("w:tr"));
        let firstRow = true;
        let rowNumber = 0;
        for (const row of rows) {
          rowNumber += 1;
          const text = childElements(row)
            .filter((cell) => cell.nodeName.endsWith(":tc"))
            .map((cell) => elementText(cell, "w:t"))
            .filter(Boolean)
            .join(" | ");
          if (!text) continue;
          blocks.push({
            text,
            kind: firstRow ? "table-header" : "table-row",
            location: {
              kind: "docx",
              tableNumber,
              rowStart: rowNumber,
              rowEnd: rowNumber,
            },
            groupKey: "document",
            sectionLabel,
          });
          firstRow = false;
        }
      }
    }

    const chunks = chunkSourceBlocks(blocks);
    if (!chunks.length) {
      return {
        ok: false,
        errorCode: "no_extractable_text",
        errorMessage: "No extractable text was found in the DOCX document.",
      };
    }

    return {
      ok: true,
      chunks,
      parserMetadata: {
        parser: "docx-xml",
        parserVersion: PARSER_VERSION,
        fileName,
        textLength: chunks.reduce((length, chunk) => length + chunk.chunkText.length, 0),
        warnings: [],
      },
    };
  } catch (error) {
    if (error instanceof OfficePackageError) {
      return { ok: false, errorCode: error.code, errorMessage: error.message };
    }
    return {
      ok: false,
      errorCode: "docx_parse_failed",
      errorMessage:
        error instanceof Error
          ? error.message
          : "The DOCX document could not be parsed by the worker.",
    };
  }
}
