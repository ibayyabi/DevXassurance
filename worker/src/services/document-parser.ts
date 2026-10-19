import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import JSZip from "jszip";
import { DOMParser, type Element } from "@xmldom/xmldom";
import { GlobalWorkerOptions, getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";

import { inspectZipDirectory } from "../../../src/features/documents/lib/zip-safety";

const MAX_OFFICE_ENTRY_EXPANDED_BYTES = 25 * 1024 * 1024;
const MAX_OFFICE_PACKAGE_EXPANDED_BYTES = 100 * 1024 * 1024;
const MAX_PDF_PAGES = 200;
const MAX_PDF_TEXT_CHARACTERS = 320_000;
const MAX_PDF_PAGE_TEXT_CHARACTERS = 64_000;
const MAX_SCANNED_PDF_PAGES = 20;

class OfficePackageError extends Error {
  constructor(
    readonly code: "office_package_size_limit" | "office_package_unsupported" | "office_package_invalid",
    message: string,
  ) {
    super(message);
    this.name = "OfficePackageError";
  }
}

async function loadOfficePackage(buffer: ArrayBuffer) {
  const bytes = Buffer.from(buffer);
  try {
    inspectZipDirectory(bytes, {
      maxEntryExpandedBytes: MAX_OFFICE_ENTRY_EXPANDED_BYTES,
      maxExpandedBytes: MAX_OFFICE_PACKAGE_EXPANDED_BYTES,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (reason === "zip-limit") {
      throw new OfficePackageError(
        "office_package_size_limit",
        "This Office document exceeds the safe per-file or total expanded package size.",
      );
    }
    if (reason === "encrypted-or-zip64") {
      throw new OfficePackageError(
        "office_package_unsupported",
        "Encrypted or ZIP64 Office documents cannot be parsed safely.",
      );
    }
    throw new OfficePackageError(
      "office_package_invalid",
      "The Office document package is malformed or corrupt.",
    );
  }

  try {
    return await JSZip.loadAsync(bytes);
  } catch {
    throw new OfficePackageError(
      "office_package_invalid",
      "The Office document package is malformed or corrupt.",
    );
  }
}

async function parsePdfDocument(
  fileName: string,
  buffer: ArrayBuffer,
): Promise<ParseResult> {
  let temporaryDirectory: string | undefined;
  let document: PDFDocumentProxy | undefined;

  try {
    GlobalWorkerOptions.workerSrc = pathToFileURL(
      join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"),
    ).toString();
    const loadingTask = getDocument({
      data: new Uint8Array(buffer.slice(0)),
      useSystemFonts: true,
    });
    document = await loadingTask.promise;
    const pageCount = document.numPages;
    if (pageCount > MAX_PDF_PAGES) {
      return {
        ok: false,
        errorCode: "pdf_page_limit_exceeded",
        errorMessage: `The PDF has ${pageCount} pages; the maximum is ${MAX_PDF_PAGES}. Split the PDF into smaller evidence files and retry.`,
      };
    }
    const blocks: SourceBlock[] = [];
    const warnings: string[] = [];
    let scannedPageCount = 0;
    let totalTextLength = 0;
    let currentSectionLabel: string | undefined;

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const pageText = normalizeText(
          content.items
            .map((item) =>
              "str" in item
                ? `${item.str}${"hasEOL" in item && item.hasEOL ? "\n" : " "}`
                : "",
            )
            .join(""),
        );
        if (pageText.length > MAX_PDF_PAGE_TEXT_CHARACTERS) {
          return {
            ok: false,
            errorCode: "pdf_text_limit_exceeded",
            errorMessage: `PDF page ${pageNumber} exceeds the ${MAX_PDF_PAGE_TEXT_CHARACTERS}-character page text limit. Split the PDF and retry.`,
          };
        }
        if (totalTextLength + pageText.length > MAX_PDF_TEXT_CHARACTERS) {
          return {
            ok: false,
            errorCode: "pdf_text_limit_exceeded",
            errorMessage: `The PDF exceeds the ${MAX_PDF_TEXT_CHARACTERS}-character extracted-text limit. Split the PDF into smaller evidence files and retry.`,
          };
        }
        totalTextLength += pageText.length;
        const operators = await page.getOperatorList();
        const containsImage = operators.fnArray.some(
          (operator) =>
            operator === OPS.paintImageXObject ||
            operator === OPS.paintInlineImageXObject ||
            operator === OPS.paintImageMaskXObject,
        );

        if (pageText) {
          const pageBlocks = paragraphBlocks(
            pageText,
            { kind: "pdf", pageNumber },
            `page:${pageNumber}`,
            currentSectionLabel,
          );
          blocks.push(...pageBlocks);
          currentSectionLabel = pageBlocks.at(-1)?.sectionLabel ?? currentSectionLabel;
        } else if (containsImage) {
          if (scannedPageCount >= MAX_SCANNED_PDF_PAGES) {
            return {
              ok: false,
              errorCode: "pdf_ocr_page_limit_exceeded",
              errorMessage: `The PDF has more than ${MAX_SCANNED_PDF_PAGES} scanned pages requiring OCR. Split the PDF into smaller evidence files and retry.`,
            };
          }
          scannedPageCount += 1;
          if (!temporaryDirectory) {
            temporaryDirectory = await mkdtemp(join(tmpdir(), "xass-pdf-ocr-"));
          }

          const imagePath = await renderPdfPageWithGhostscript(
            buffer,
            pageNumber,
            temporaryDirectory,
          );
          const ocrText = normalizeText(await recognizeImage(imagePath));
          if (!ocrText) {
            return {
              ok: false,
              errorCode: "ocr_no_text",
              errorMessage: `OCR found no readable text on PDF page ${pageNumber}.`,
            };
          }
          if (ocrText.length > MAX_PDF_PAGE_TEXT_CHARACTERS) {
            return {
              ok: false,
              errorCode: "pdf_text_limit_exceeded",
              errorMessage: `OCR text on PDF page ${pageNumber} exceeds the ${MAX_PDF_PAGE_TEXT_CHARACTERS}-character page text limit.`,
            };
          }
          if (totalTextLength + ocrText.length > MAX_PDF_TEXT_CHARACTERS) {
            return {
              ok: false,
              errorCode: "pdf_text_limit_exceeded",
              errorMessage: `The PDF exceeds the ${MAX_PDF_TEXT_CHARACTERS}-character extracted-text limit. Split the PDF into smaller evidence files and retry.`,
            };
          }
          totalTextLength += ocrText.length;
          const pageBlocks = paragraphBlocks(
            ocrText,
            { kind: "pdf", pageNumber, ocr: "tesseract" },
            `page:${pageNumber}`,
            currentSectionLabel,
          );
          blocks.push(...pageBlocks);
          currentSectionLabel = pageBlocks.at(-1)?.sectionLabel ?? currentSectionLabel;
          warnings.push(`OCR was used for scanned PDF page ${pageNumber}.`);
        }
      } finally {
        page.cleanup();
      }
    }

    const chunks = chunkSourceBlocks(blocks);
    if (!chunks.length) {
      return {
        ok: false,
        errorCode: "no_extractable_text",
        errorMessage:
          "No readable text was found. Scanned pages need local Tesseract and Ghostscript OCR support.",
      };
    }

    return {
      ok: true,
      chunks,
      parserMetadata: {
        parser: "pdfjs-dist",
        parserVersion: PARSER_VERSION,
        fileName,
        scannedPageCount,
        ocrLanguage: scannedPageCount ? configuredOcrLanguage() : null,
        textLength: chunks.reduce((length, chunk) => length + chunk.chunkText.length, 0),
        warnings,
      },
    };
  } catch (error) {
    const errorCode =
      error instanceof OcrError
        ? error.code
        : typeof error === "object" &&
            error !== null &&
            "name" in error &&
            error.name === "PasswordException"
          ? "pdf_encrypted"
          : "pdf_parse_failed";

    return {
      ok: false,
      errorCode,
      errorMessage:
        errorCode === "pdf_encrypted"
          ? "The PDF is encrypted and cannot be parsed without its password."
          : error instanceof Error
            ? error.message
            : "The PDF could not be parsed by the worker.",
    };
  } finally {
    await document?.destroy();
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

const execFileAsync = promisify(execFileCallback);

export type ParsedSourceLocation = Record<string, string | number>;

export type ParsedSourceReference = {
  sourceId: string;
  chunkIndex: number;
  text: string;
  modelText: string;
  sourceLocation?: ParsedSourceLocation;
};

export type ParsedChunk = {
  chunkIndex: number;
  chunkText: string;
  pageNumber?: number;
  sectionLabel?: string;
  sourceLocation?: ParsedSourceLocation;
  sourceReferences?: ParsedSourceReference[];
};

export type ParseResult =
  | {
      ok: true;
      chunks: ParsedChunk[];
      parserMetadata: Record<string, unknown>;
    }
  | {
      ok: false;
      errorCode: string;
      errorMessage: string;
    };

type SourceBlock = {
  text: string;
  kind: "heading" | "paragraph" | "table-header" | "table-row";
  location: ParsedSourceLocation;
  groupKey?: string;
  sectionLabel?: string;
  continuation?: string;
  modelText?: string;
};

type ZipTextReader = {
  file(path: string): { async(type: "text"): Promise<string> } | null;
  files: Record<string, unknown>;
};

const PARSER_VERSION = "document-parser/5";
const MAX_CHUNK_LENGTH = 4000;
const PARAGRAPH_OVERLAP = 160;
const CHUNK_CONTEXT_BUDGET = 900;
const MAX_SOURCE_BLOCK_PART_LENGTH = MAX_CHUNK_LENGTH - CHUNK_CONTEXT_BUDGET;



export async function parseDocumentBuffer(
  fileName: string,
  buffer: ArrayBuffer,
): Promise<ParseResult> {
  if (buffer.byteLength === 0) {
    return {
      ok: false,
      errorCode: "empty_document",
      errorMessage: "The document is empty and could not be parsed.",
    };
  }

  const extensionIndex = fileName.lastIndexOf(".");
  const extension = extensionIndex < 0 ? "" : fileName.slice(extensionIndex).toLowerCase();
  if (
    [".pdf", ".docx", ".xlsx", ".pptx", ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp"].includes(extension) &&
    !hasExpectedFileSignature(extension, buffer)
  ) {
    return {
      ok: false,
      errorCode: "file_signature_mismatch",
      errorMessage: "The file contents do not match its declared file type.",
    };
  }

  if (extension === ".pdf") {
    return parsePdfDocument(fileName, buffer);
  }

  if (extension === ".txt" || extension === ".csv") {
    return parseTextDocument(fileName, buffer, extension);
  }

  if (extension === ".docx") {
    return parseDocxDocument(fileName, buffer);
  }

  if (extension === ".xlsx") {
    return parseXlsxDocument(fileName, buffer);
  }

  if (extension === ".pptx") {
    return parsePptxDocument(fileName, buffer);
  }

  if ([".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp"].includes(extension)) {
    return parseImageDocument(fileName, buffer);
  }

  return {
    ok: false,
    errorCode: "unsupported_file_type",
    errorMessage:
      "Unsupported file type. Automated extraction supports PDF, TXT, CSV, DOCX, XLSX, PPTX, and common image files including WebP.",
  };
}


async function parseTextDocument(
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


async function parseDocxDocument(
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

async function parseXlsxDocument(
  fileName: string,
  buffer: ArrayBuffer,
): Promise<ParseResult> {
  try {
    const parser = new DOMParser();
    const zip = await loadOfficePackage(buffer);
    const sharedStrings = await readSharedStrings(zip, parser);
    const numberFormats = await readWorkbookNumberFormats(zip, parser);
    const { sheets, date1904 } = await readWorkbookSheets(zip, parser);
    const blocks: SourceBlock[] = [];
    const warnings: string[] = [];

    for (const sheet of sheets) {
      const xml = await zip.file(sheet.path)?.async("text");
      if (!xml) throw new Error(`The XLSX workbook is missing worksheet "${sheet.name}".`);
      const document = parseXml(xml, parser);
      const merges = Array.from(document.getElementsByTagName("mergeCell"))
        .map((cell) => cell.getAttribute("ref"))
        .filter((reference): reference is string => Boolean(reference));
      const rows = Array.from(document.getElementsByTagName("row")).map((row, index) => ({
        number: Number(row.getAttribute("r")) || index + 1,
        cells: Array.from(row.getElementsByTagName("c"))
          .map((cell) => readWorkbookCell(cell, sharedStrings, numberFormats))
          .filter((cell) => cell.value || cell.formula),
      })).filter((row) => row.cells.length);
      if (!rows.length) continue;

      const tables: typeof rows[] = [];
      for (const row of rows) {
        if (!tables.length || row.number > tables[tables.length - 1][tables[tables.length - 1].length - 1].number + 1) {
          tables.push([]);
        }
        tables[tables.length - 1].push(row);
      }
      for (const [tableIndex, tableRows] of tables.entries()) {
        let headerCount = 1;
        if (
          tableRows.length >= 3 &&
          tableRows[0].cells.every((cell) => cell.textual) &&
          tableRows[1].cells.every((cell) => cell.textual) &&
          tableRows[2].cells.some((cell) => !cell.textual)
        ) headerCount = 2;

        const headers = new Map<number, string>();
        for (const row of tableRows.slice(0, headerCount)) {
          for (const cell of row.cells) {
            const column = columnNumber(cell.reference);
            if (!column) continue;
            let mergeAnchor = false;
            if (row === tableRows[0]) {
              for (const merge of merges) {
                const [start, end] = merge.split(":");
                if (start !== cell.reference) continue;
                mergeAnchor = true;
                for (let target = columnNumber(start); target <= columnNumber(end); target += 1) {
                  headers.set(target, cell.value);
                }
              }
            }
            if (!mergeAnchor) {
              const prior = headers.get(column);
              headers.set(column, [...(prior ? [prior] : []), cell.value].join(" / "));
            }
          }
        }

        const headerCells = tableRows.slice(0, headerCount).flatMap((row) => row.cells);
        blocks.push({
          text: [...headers.entries()]
            .sort(([left], [right]) => left - right)
            .map(([column, label]) => `${columnLetters(column)}: ${label}`)
            .join(" | "),
          kind: "table-header",
          location: {
            kind: "xlsx",
            sheetName: sheet.name,
            rowStart: tableRows[0].number,
            rowEnd: tableRows[headerCount - 1].number,
            cellRangeStart: headerCells[0].reference,
            cellRangeEnd: headerCells[headerCells.length - 1].reference,
          },
          groupKey: `sheet:${sheet.name}:table:${tableIndex}`,
          sectionLabel: sheet.name,
        });

        for (const row of tableRows.slice(headerCount)) {
          const cells = row.cells.map((cell) => {
            const column = columnNumber(cell.reference);
            const label = headers.get(column);
            const labelText = label ? `${label}: ` : `${columnLetters(column) || "Cell"}: `;
            const isoDate = cell.dateFormat && cell.value
              ? excelSerialToIsoDate(cell.value, date1904)
              : undefined;
            const invalidDate = cell.dateFormat && cell.value && !isoDate;
            const value = cell.formula
              ? `${cell.formula}${cell.value ? ` (cached value: ${cell.value}${isoDate ? `; ISO date: ${isoDate}` : ""})` : " (no cached value)"}`
              : cell.value;
            const format = cell.numberFormat
              ? ` [raw value: ${cell.value}; number format: ${cell.numberFormat}${isoDate ? `; ISO date: ${isoDate}` : invalidDate ? `; Needs Review: invalid Excel serial ${cell.value}` : cell.dateFormat ? "; Needs Review: no cached date value" : ""}]`
              : "";
            const compactValue = cell.formula
              ? `${cell.formula}${cell.value ? ` (cached value: ${isoDate ?? cell.value})` : " (no cached value)"}`
              : isoDate ?? cell.value;
            const compactFormat = cell.dateFormat
              ? isoDate
                ? ""
                : ` [date format: ${cell.numberFormat ?? "unknown"}; Needs Review: ${invalidDate ? `invalid Excel serial ${cell.value}` : "no cached date value"}]`
              : cell.numberFormat && cell.numberFormat !== "General"
                ? ` [number format: ${cell.numberFormat}]`
                : "";
            return {
              text: `${labelText}${value}${format}`,
              modelText: `${labelText}${compactValue}${compactFormat}`,
            };
          });
          const text = cells.map((cell) => cell.text).join(" | ");
          const modelText = cells.map((cell) => cell.modelText).join(" | ");
          if (row.cells.some((cell) => cell.dateFormat)) {
            warnings.push(`Sheet "${sheet.name}" contains date-formatted raw values; recognized dates are normalized and invalid or unavailable values need review.`);
          }
          blocks.push({
            text,
            modelText,
            kind: "table-row",
            location: {
              kind: "xlsx",
              sheetName: sheet.name,
              rowStart: row.number,
              rowEnd: row.number,
              cellRangeStart: row.cells[0].reference,
              cellRangeEnd: row.cells[row.cells.length - 1].reference,
            },
            groupKey: `sheet:${sheet.name}:table:${tableIndex}`,
            sectionLabel: sheet.name,
          });
        }
      }
    }

    const chunks = chunkSourceBlocks(blocks);
    if (!chunks.length) {
      return {
        ok: false,
        errorCode: "no_extractable_text",
        errorMessage: "No extractable text was found in the XLSX workbook.",
      };
    }

    return {
      ok: true,
      chunks,
      parserMetadata: {
        parser: "xlsx-zip-xml",
        parserVersion: PARSER_VERSION,
        fileName,
        sheetNames: sheets.map((sheet) => sheet.name),
        textLength: chunks.reduce((length, chunk) => length + chunk.chunkText.length, 0),
        warnings: [...new Set(warnings)],
      },
    };
  } catch (error) {
    if (error instanceof OfficePackageError) {
      return { ok: false, errorCode: error.code, errorMessage: error.message };
    }
    return {
      ok: false,
      errorCode: "xlsx_parse_failed",
      errorMessage:
        error instanceof Error
          ? error.message
          : "The XLSX workbook could not be parsed by the worker.",
    };
  }
}


async function readSharedStrings(zip: ZipTextReader, parser: DOMParser) {
  const xml = await zip.file("xl/sharedStrings.xml")?.async("text");
  if (!xml) return [];

  return Array.from(parseXml(xml, parser).getElementsByTagName("si")).map((item) =>
    Array.from(item.getElementsByTagName("t"))
      .map((textNode) => textNode.textContent ?? "")
      .join(""),
  );
}

async function readWorkbookNumberFormats(zip: ZipTextReader, parser: DOMParser) {
  const xml = await zip.file("xl/styles.xml")?.async("text");
  if (!xml) return [];
  const styles = parseXml(xml, parser);
  const customFormats = new Map(
    Array.from(styles.getElementsByTagName("numFmt")).map((format) => [
      format.getAttribute("numFmtId"),
      format.getAttribute("formatCode"),
    ]),
  );
  const builtinDateFormats: Record<string, string> = {
    "14": "m/d/yy",
    "15": "d-mmm-yy",
    "16": "d-mmm",
    "17": "mmm-yy",
    "18": "h:mm AM/PM",
    "19": "h:mm:ss AM/PM",
    "20": "h:mm",
    "21": "h:mm:ss",
    "22": "m/d/yy h:mm",
  };
  return Array.from(styles.getElementsByTagName("cellXfs")[0]?.getElementsByTagName("xf") ?? [])
    .map((style) => {
      const id = style.getAttribute("numFmtId");
      const format = customFormats.get(id ?? "") ?? builtinDateFormats[id ?? ""];
      return {
        format,
        date: Boolean(format && /[yd]/i.test(format.replace(/"[^"]*"|\[[^\]]*\]/g, ""))),
      };
    });
}

function columnNumber(reference: string) {
  const letters = reference.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? "";
  return [...letters].reduce((column, letter) => column * 26 + letter.charCodeAt(0) - 64, 0);
}

function columnLetters(column: number) {
  let value = column;
  let letters = "";
  while (value > 0) {
    value -= 1;
    letters = String.fromCharCode(65 + value % 26) + letters;
    value = Math.floor(value / 26);
  }
  return letters;
}

function excelSerialToIsoDate(rawValue: string, date1904: boolean) {
  const serial = Number(rawValue);
  if (!Number.isFinite(serial) || serial < 0 || (!date1904 && Math.floor(serial) === 60)) {
    return undefined;
  }
  const day = Math.floor(serial);
  const epoch = date1904
    ? Date.UTC(1904, 0, 1)
    : Date.UTC(1899, 11, day < 60 ? 31 : 30);
  const timestamp = epoch + day * 86_400_000;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

async function readWorkbookSheets(zip: ZipTextReader, parser: DOMParser) {
  const workbookXml = await zip.file("xl/workbook.xml")?.async("text");
  if (!workbookXml) throw new Error("The XLSX package is missing its workbook index.");

  const workbook = parseXml(workbookXml, parser);
  const relationshipXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("text");
  const pathsById = new Map<string, string>();
  if (relationshipXml) {
    const relationships = parseXml(relationshipXml, parser);
    for (const relationship of Array.from(
      relationships.getElementsByTagName("Relationship"),
    )) {
      const id = relationship.getAttribute("Id");
      const target = relationship.getAttribute("Target");
      if (id && target) {
        pathsById.set(
          id,
          posix.normalize(target.startsWith("/") ? target.slice(1) : posix.join("xl", target)),
        );
      }
    }
  }

  const sheets = Array.from(workbook.getElementsByTagName("sheet"))
    .map((sheet, index) => ({
      name: sheet.getAttribute("name") || `Sheet ${index + 1}`,
      path:
        pathsById.get(sheet.getAttribute("r:id") ?? "") ??
        `xl/worksheets/sheet${index + 1}.xml`,
    }));
  const date1904 = ["1", "true"].includes(
    workbook.getElementsByTagName("workbookPr")[0]?.getAttribute("date1904")?.toLowerCase() ?? "",
  );
  return {
    sheets: sheets.length
      ? sheets
      : Object.keys(zip.files)
          .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
          .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
          .map((path) => ({
            name: path.replace(/^xl\/worksheets\//i, "").replace(/\.xml$/i, ""),
            path,
          })),
    date1904,
  };
}

function readWorkbookCell(
  cell: Element,
  sharedStrings: string[],
  numberFormats: Array<{ format?: string; date: boolean }>,
) {
  const type = cell.getAttribute("t");
  const rawValue = cell.getElementsByTagName("v")[0]?.textContent ?? "";
  const formula = cell.getElementsByTagName("f")[0]?.textContent ?? "";
  const value = type === "s" ? sharedStrings[Number(rawValue)] ?? ""
    : type === "inlineStr" ? elementText(cell, "t")
    : type === "b" ? rawValue === "1" ? "TRUE" : "FALSE"
    : rawValue;
  const format = numberFormats[Number(cell.getAttribute("s"))];
  return {
    reference: cell.getAttribute("r") ?? "",
    value,
    formula,
    numberFormat: format?.format,
    dateFormat: format?.date ?? false,
    textual: ["s", "inlineStr", "str"].includes(type ?? "") || type === "b",
  };
}

async function parsePptxDocument(fileName: string, buffer: ArrayBuffer): Promise<ParseResult> {
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

async function presentationSlidePaths(zip: ZipTextReader, parser: DOMParser) {
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

async function parseImageDocument(
  fileName: string,
  buffer: ArrayBuffer,
): Promise<ParseResult> {
  let temporaryDirectory: string | undefined;
  try {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "xass-image-ocr-"));
    const extension = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
    const imagePath = join(temporaryDirectory, `image${extension}`);
    await writeFile(imagePath, new Uint8Array(buffer));
    const text = normalizeText(await recognizeImage(imagePath));
    if (!text) {
      return {
        ok: false,
        errorCode: "ocr_no_text",
        errorMessage: "OCR found no readable text in the image.",
      };
    }

    const chunks = chunkSourceBlocks(
      paragraphBlocks(text, { kind: "image", imageName: fileName, ocr: "tesseract" }),
    );
    return {
      ok: true,
      chunks,
      parserMetadata: {
        parser: "tesseract",
        parserVersion: PARSER_VERSION,
        fileName,
        textLength: text.length,
        ocrLanguage: configuredOcrLanguage(),
        warnings: ["Image text was extracted using local Tesseract OCR."],
      },
    };
  } catch (error) {
    return {
      ok: false,
      errorCode: error instanceof OcrError ? error.code : "ocr_failed",
      errorMessage:
        error instanceof OcrError
          ? error.message
          : "The image could not be read by local Tesseract OCR.",
    };
  } finally {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function renderPdfPageWithGhostscript(
  buffer: ArrayBuffer,
  pageNumber: number,
  directory: string,
) {
  const pdfPath = join(directory, "source.pdf");
  const imagePath = join(directory, `page-${pageNumber}.png`);
  await writeFile(pdfPath, new Uint8Array(buffer));

  try {
    await execFileAsync(
      "gs",
      [
        "-q",
        "-dSAFER",
        "-dBATCH",
        "-dNOPAUSE",
        "-sDEVICE=png16m",
        "-r160",
        `-dFirstPage=${pageNumber}`,
        `-dLastPage=${pageNumber}`,
        `-sOutputFile=${imagePath}`,
        pdfPath,
      ],
      { timeout: 120_000, maxBuffer: 1_000_000 },
    );
    return imagePath;
  } catch (error) {
    if (isMissingExecutable(error)) {
      throw new OcrError(
        "ocr_unavailable",
        "Scanned PDF OCR needs local Ghostscript and Tesseract; install both to process scanned pages.",
      );
    }
    throw new OcrError("ocr_failed", `Ghostscript could not rasterize PDF page ${pageNumber}.`);
  }
}

async function recognizeImage(imagePath: string) {
  try {
    const result = await execFileAsync(
      "tesseract",
      [imagePath, "stdout", "-l", configuredOcrLanguage()],
      {
        timeout: 120_000,
        maxBuffer: 10_000_000,
        encoding: "utf8",
      },
    );
    return result.stdout;
  } catch (error) {
    if (isMissingExecutable(error)) {
      throw new OcrError(
        "ocr_unavailable",
        "Local Tesseract OCR is unavailable; install Tesseract and its language data to process images.",
      );
    }
    if (isMissingLanguageData(error)) {
      throw new OcrError(
        "ocr_language_unavailable",
        `Configured OCR language "${configuredOcrLanguage()}" is unavailable; install its Tesseract traineddata or set XASS_OCR_LANG to an installed language (for example eng or ind+eng).`,
      );
    }
    throw new OcrError(
      "ocr_failed",
      "Tesseract could not read this image; verify that the file is a supported, readable image.",
    );
  }
}

class OcrError extends Error {
  constructor(
    readonly code:
      | "ocr_unavailable"
      | "ocr_language_unavailable"
      | "ocr_failed",
    message: string,
  ) {
    super(message);
    this.name = "OcrError";
  }
}

function isMissingExecutable(error: unknown): error is Error & { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function configuredOcrLanguage() {
  return process.env.XASS_OCR_LANG?.trim() || "eng";
}

function isMissingLanguageData(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "stderr" in error &&
    /failed loading language|error opening data file|couldn't load any languages/i.test(
      String(error.stderr),
    )
  );
}

function isHeadingText(text: string) {
  const firstLine = text.split("\n")[0]?.trim() ?? "";
  return firstLine.length > 0 && firstLine.length <= 80 && !/[.!?]$/.test(firstLine);
}

function paragraphBlocks(
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

function csvBlocks(text: string): SourceBlock[] | null {
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

function chunkSourceBlocks(blocks: SourceBlock[]): ParsedChunk[] {
  const chunks: ParsedChunk[] = [];
  let group: SourceBlock[] = [];
  let groupKey = "";

  for (const block of blocks) {
    const nextGroupKey = block.groupKey ?? "document";
    if (group.length && nextGroupKey !== groupKey) {
      chunks.push(...chunkBlockGroup(group));
      group = [];
    }
    groupKey = nextGroupKey;
    group.push(block);
  }
  if (group.length) chunks.push(...chunkBlockGroup(group));
  return chunks.map((chunk, chunkIndex) => ({
    ...chunk,
    chunkIndex,
    sourceReferences: chunk.sourceReferences?.map((source, sourceIndex) => ({
      ...source,
      sourceId: `c${chunkIndex}s${sourceIndex}`,
      chunkIndex,
    })),
  }));
}

function chunkBlockGroup(blocks: SourceBlock[]): ParsedChunk[] {
  const chunks: ParsedChunk[] = [];
  let text = "";
  let sourceBlocks: SourceBlock[] = [];
  let sectionLabel = blocks.find((block) => block.sectionLabel)?.sectionLabel;
  let tableHeader: SourceBlock | undefined;

  const flush = () => {
    if (!text || !sourceBlocks.length) return;
    const sourceLocation = mergeSourceLocations(sourceBlocks);
    chunks.push({
      chunkIndex: chunks.length,
      chunkText: text.trim(),
      pageNumber:
        typeof sourceLocation.pageNumber === "number"
          ? sourceLocation.pageNumber
          : undefined,
      sectionLabel,
      sourceLocation,
      sourceReferences: sourceBlocks.map((block, sourceIndex) => ({
        sourceId: `s${chunks.length}s${sourceIndex}`,
        chunkIndex: chunks.length,
        text: block.text,
        modelText: block.modelText ?? block.text,
        sourceLocation: block.location,
      })),
    });
    text = "";
    sourceBlocks = [];
  };

  for (const block of blocks) {
    if (block.kind === "heading") {
      flush();
      sectionLabel = block.sectionLabel ?? block.text;
    } else if (block.sectionLabel) {
      sectionLabel = block.sectionLabel;
    }
    if (block.kind === "table-header") {
      const priorTable = tableHeader?.location.tableNumber;
      const nextTable = block.location.tableNumber;
      if (tableHeader && priorTable !== nextTable) flush();
      tableHeader = block;
    }

    for (const part of splitSourceBlock(block)) {
      let prefix = text
        ? ""
        : chunkContext(sectionLabel, tableHeader, part, part.continuation);
      let addition = `${text ? `${text}\n\n` : ""}${prefix ? `${prefix}\n\n` : ""}${part.text}`;

      if (text && addition.length > MAX_CHUNK_LENGTH) {
        const previous = sourceBlocks[sourceBlocks.length - 1];
        const overlap =
          previous?.kind === "paragraph"
            ? previous.text.slice(-PARAGRAPH_OVERLAP)
            : undefined;
        flush();
        prefix = chunkContext(sectionLabel, tableHeader, part, part.continuation ?? overlap);
        addition = `${prefix ? `${prefix}\n\n` : ""}${part.text}`;
      }

      text = addition;
      sourceBlocks.push(part);
    }
  }
  flush();
  return chunks;
}

function chunkContext(
  sectionLabel: string | undefined,
  tableHeader: SourceBlock | undefined,
  block: SourceBlock,
  continuation?: string,
) {
  const context: string[] = [];
  if (
    sectionLabel &&
    sectionLabel.length <= 200 &&
    block.kind !== "heading" &&
    sectionLabel !== block.text
  ) {
    context.push(sectionLabel);
  }
  if (
    block.kind === "table-row" &&
    tableHeader &&
    tableHeader.location.tableNumber === block.location.tableNumber &&
    tableHeader.text.length <= 500
  ) {
    context.push(tableHeader.text);
  }
  if (continuation) context.push(continuation);
  return context.join("\n\n");
}

function splitSourceBlock(block: SourceBlock): SourceBlock[] {
  const parts: SourceBlock[] = [];
  let remaining = block.text;
  let continuation = block.continuation;
  const modelText = block.text.length > MAX_SOURCE_BLOCK_PART_LENGTH
    ? undefined
    : block.modelText;

  while (remaining.length > MAX_SOURCE_BLOCK_PART_LENGTH) {
    let splitAt = remaining.lastIndexOf(" ", MAX_SOURCE_BLOCK_PART_LENGTH);
    if (splitAt < 1) splitAt = MAX_SOURCE_BLOCK_PART_LENGTH;
    const part = remaining.slice(0, splitAt).trimEnd();
    parts.push({ ...block, text: part, modelText, continuation });
    continuation =
      block.kind === "paragraph" ? part.slice(-PARAGRAPH_OVERLAP) : undefined;
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) parts.push({ ...block, text: remaining, modelText, continuation });
  return parts;
}

function mergeSourceLocations(blocks: SourceBlock[]): ParsedSourceLocation {
  const locations = blocks.map((block) => block.location);
  const merged: ParsedSourceLocation = { ...locations[0] };
  const keys = new Set(locations.flatMap((location) => Object.keys(location)));

  for (const key of keys) {
    const values = locations
      .map((location) => location[key])
      .filter((value): value is string | number => value !== undefined);
    if (values.length < 2) continue;
    if (typeof values[0] === "number" && values.every((value) => typeof value === "number")) {
      const numbers = values.filter((value): value is number => typeof value === "number");
      merged[key] = key.endsWith("Start") ? Math.min(...numbers) :
        key.endsWith("End") ? Math.max(...numbers) :
        key === "rowStart" || key === "paragraphStart" ? Math.min(...numbers) :
        key === "rowEnd" || key === "paragraphEnd" ? Math.max(...numbers) :
        numbers[0];
    } else if (key === "cellRangeEnd") {
      merged[key] = values[values.length - 1];
    }
  }
  return merged;
}

function parseXml(xml: string, parser = new DOMParser()) {
  const document = parser.parseFromString(xml, "application/xml");
  if (!document.documentElement || document.getElementsByTagName("parsererror").length) {
    throw new Error("The document contains malformed XML.");
  }
  return document;
}

function childElements(parent: Element) {
  return Array.from(parent.childNodes)
    .filter((child) => child.nodeType === 1)
    .map((child) => child as Element);
}

function elementText(element: Element, tagName: string) {
  return Array.from(element.getElementsByTagName(tagName))
    .map((node) => node.textContent ?? "")
    .join("");
}


function hasExpectedFileSignature(extension: string, buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  if (extension === ".pdf") {
    const signature = [0x25, 0x50, 0x44, 0x46, 0x2d];
    for (let offset = 0; offset <= Math.min(bytes.length - signature.length, 1024); offset += 1) {
      if (signature.every((byte, index) => bytes[offset + index] === byte)) return true;
    }
    return false;
  }

  if ([".docx", ".xlsx", ".pptx"].includes(extension)) {
    return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  }
  if (extension === ".png") {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (byte, index) => bytes[index] === byte,
    );
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (extension === ".tif" || extension === ".tiff") {
    return (
      (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0) ||
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 0x2a)
    );
  }
  if (extension === ".bmp") return bytes[0] === 0x42 && bytes[1] === 0x4d;
  if (extension === ".webp") {
    return bytes.length >= 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  }
  return true;
}

function normalizeText(value: string) {
  return value
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
