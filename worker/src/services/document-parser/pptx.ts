import { posix } from "node:path";
import { DOMParser } from "@xmldom/xmldom";

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
import type { ParseResult, SourceBlock, ZipTextReader } from "./types";

export async function parsePptxDocument(fileName: string, buffer: ArrayBuffer): Promise<ParseResult> {
  try {
    const zip = await loadOfficePackage(buffer);
    const parser = new DOMParser();
    const slidePaths = await presentationSlidePaths(zip, parser);
    const blocks: SourceBlock[] = [];

    for (let index = 0; index < slidePaths.length; index += 1) {
      const slideNumber = index + 1;
      const xml = await zip.file(slidePaths[index])?.async("text");
      if (!xml) continue;
      const slide = parseXml(xml, parser);
      let sectionLabel: string | undefined;

      const shapeTree = slide.getElementsByTagName("p:spTree")[0];
      if (!shapeTree) continue;
      let tableNumber = 0;

      for (const shape of childElements(shapeTree)) {
        if (shape.nodeName.endsWith(":sp")) {
          const placeholder = shape.getElementsByTagName("p:ph")[0]?.getAttribute("type");
          const isTitle = placeholder === "title" || placeholder === "ctrTitle";
          for (const paragraph of Array.from(shape.getElementsByTagName("a:p"))) {
            const text = elementText(paragraph, "a:t").trim();
            if (!text) continue;
            const heading = isTitle || (!sectionLabel && isHeadingText(text));
            if (heading) sectionLabel = text;
            blocks.push({
              text,
              kind: heading ? "heading" : "paragraph",
              location: { kind: "pptx", slideNumber },
              groupKey: `slide:${slideNumber}`,
              sectionLabel,
            });
          }
        } else if (shape.nodeName.endsWith(":graphicFrame")) {
          const rows = Array.from(shape.getElementsByTagName("a:tr"));
          if (rows.length) {
            tableNumber += 1;
            rows.forEach((row, rowIndex) => {
              const text = childElements(row)
                .filter((cell) => cell.nodeName.endsWith(":tc"))
                .map((cell) => elementText(cell, "a:t").trim())
                .filter(Boolean)
                .join(" | ");
              if (!text) return;
              blocks.push({
                text,
                kind: rowIndex === 0 ? "table-header" : "table-row",
                location: { kind: "pptx", slideNumber, tableNumber, rowStart: rowIndex + 1, rowEnd: rowIndex + 1 },
                groupKey: `slide:${slideNumber}`,
                sectionLabel,
              });
            });
            continue;
          }

          for (const paragraph of Array.from(shape.getElementsByTagName("a:p"))) {
            const text = elementText(paragraph, "a:t").trim();
            if (!text) continue;
            const heading = !sectionLabel && isHeadingText(text);
            if (heading) sectionLabel = text;
            blocks.push({
              text,
              kind: heading ? "heading" : "paragraph",
              location: { kind: "pptx", slideNumber },
              groupKey: `slide:${slideNumber}`,
              sectionLabel,
            });
          }
        }
      }

    }
    const chunks = chunkSourceBlocks(blocks);
    if (!chunks.length) {
      return {
        ok: false,
        errorCode: "no_extractable_text",
        errorMessage: "No extractable text was found in the PPTX presentation.",
      };
    }
    return {
      ok: true,
      chunks,
      parserMetadata: {
        parser: "pptx-zip-xml",
        parserVersion: PARSER_VERSION,
        fileName,
        slideCount: slidePaths.length,
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
      errorCode: "pptx_parse_failed",
      errorMessage:
        error instanceof Error
          ? error.message
          : "The PPTX presentation could not be parsed by the worker.",
    };
  }
}

export async function presentationSlidePaths(zip: ZipTextReader, parser: DOMParser) {
  const availableSlides = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const presentationXml = await zip.file("ppt/presentation.xml")?.async("text");
  const relationshipsXml = await zip.file("ppt/_rels/presentation.xml.rels")?.async("text");
  if (!presentationXml || !relationshipsXml) {
    throw new Error("The PPTX package is missing its presentation index or relationships.");
  }

  const presentation = parseXml(presentationXml, parser);
  const relationships = parseXml(relationshipsXml, parser);
  const pathsById = new Map<string, string>();
  for (const relationship of Array.from(
    relationships.getElementsByTagName("Relationship"),
  )) {
    const id = relationship.getAttribute("Id");
    const target = relationship.getAttribute("Target");
    if (id && target) {
      pathsById.set(
        id,
        posix.normalize(target.startsWith("/") ? target.slice(1) : posix.join("ppt", target)),
      );
    }
  }

  const ordered = Array.from(presentation.getElementsByTagName("p:sldId"))
    .map((slide) => pathsById.get(slide.getAttribute("r:id") ?? ""))
    .filter((path): path is string => Boolean(path && zip.file(path)));
  if (!ordered.length && availableSlides.length) {
    throw new Error("The PPTX package has no valid slide relationships.");
  }
  return ordered;
}

