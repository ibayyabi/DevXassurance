import { hasExpectedFileSignature } from "./document-parser/common";
import { parseDocxDocument } from "./document-parser/docx";
import { parseImageDocument } from "./document-parser/image";
import { parsePdfDocument } from "./document-parser/pdf";
import { parsePptxDocument } from "./document-parser/pptx";
import { parseTextDocument } from "./document-parser/text-csv";
import { parseXlsxDocument } from "./document-parser/xlsx";
import type { ParseResult } from "./document-parser/types";

export type {
  ParsedSourceLocation,
  ParsedSourceCell,
  ParsedSourceReference,
  ParsedChunk,
  ParseResult,
} from "./document-parser/types";

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
