import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { GlobalWorkerOptions, getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";

import { PARSER_VERSION, normalizeText } from "./common";
import { chunkSourceBlocks } from "./chunking";
import { paragraphBlocks } from "./text-csv";
import {
  OCR_BACKEND,
  OCR_ENGINE,
  OCR_MODEL,
  OCR_MODEL_SIZE,
  OcrError,
  renderPdfPageWithGhostscript,
} from "./ocr";
import { recognizeImages } from "./image";
import type { ParseResult, SourceBlock } from "./types";

const MAX_PDF_PAGES = 200;
const MAX_PDF_TEXT_CHARACTERS = 320_000;
const MAX_PDF_PAGE_TEXT_CHARACTERS = 64_000;
const MAX_SCANNED_PDF_PAGES = 20;


type PdfPageEntry =
  | { pageNumber: number; text: string }
  | { pageNumber: number; imagePath: string };

export async function parsePdfDocument(
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
    const pageEntries: PdfPageEntry[] = [];

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
        if (pageText) {
          pageEntries.push({ pageNumber, text: pageText });
          continue;
        }
        const operators = await page.getOperatorList();
        const containsImage = operators.fnArray.some(
          (operator) =>
            operator === OPS.paintImageXObject ||
            operator === OPS.paintInlineImageXObject ||
            operator === OPS.paintImageMaskXObject,
        );
        if (!containsImage) continue;
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
        pageEntries.push({ pageNumber, imagePath });
      } finally {
        page.cleanup();
      }
    }

    // One helper process and one engine initialization for every scanned page.
    const ocr = scannedPageCount
      ? await recognizeImages(
          pageEntries.flatMap((entry) => ("imagePath" in entry ? [entry.imagePath] : [])),
        )
      : undefined;

    let scannedIndex = 0;
    for (const entry of pageEntries) {
      let text: string;
      if ("text" in entry) {
        text = entry.text;
      } else {
        text = normalizeText(ocr?.texts[scannedIndex] ?? "");
        scannedIndex += 1;
        if (!text) {
          return {
            ok: false,
            errorCode: "ocr_no_text",
            errorMessage: `OCR found no readable text on PDF page ${entry.pageNumber}.`,
          };
        }
        warnings.push(`OCR was used for scanned PDF page ${entry.pageNumber}.`);
      }
      if (text.length > MAX_PDF_PAGE_TEXT_CHARACTERS) {
        return {
          ok: false,
          errorCode: "pdf_text_limit_exceeded",
          errorMessage: `PDF page ${entry.pageNumber} exceeds the ${MAX_PDF_PAGE_TEXT_CHARACTERS}-character page text limit. Split the PDF and retry.`,
        };
      }
      if (totalTextLength + text.length > MAX_PDF_TEXT_CHARACTERS) {
        return {
          ok: false,
          errorCode: "pdf_text_limit_exceeded",
          errorMessage: `The PDF exceeds the ${MAX_PDF_TEXT_CHARACTERS}-character extracted-text limit. Split the PDF into smaller evidence files and retry.`,
        };
      }
      totalTextLength += text.length;
      const pageBlocks = paragraphBlocks(
        text,
        "text" in entry
          ? { kind: "pdf", pageNumber: entry.pageNumber }
          : { kind: "pdf", pageNumber: entry.pageNumber, ocr: OCR_ENGINE },
        `page:${entry.pageNumber}`,
        currentSectionLabel,
      );
      blocks.push(...pageBlocks);
      currentSectionLabel = pageBlocks.at(-1)?.sectionLabel ?? currentSectionLabel;
    }

    const chunks = chunkSourceBlocks(blocks);
    if (!chunks.length) {
      return {
        ok: false,
        errorCode: "no_extractable_text",
        errorMessage:
          "No readable text was found. Scanned pages need local PP-OCRv6 and Ghostscript OCR support.",
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
        ocrEngine: scannedPageCount ? OCR_ENGINE : null,
        ocrModel: scannedPageCount ? OCR_MODEL : null,
        ocrModelSize: scannedPageCount ? OCR_MODEL_SIZE : null,
        ocrBackend: scannedPageCount ? OCR_BACKEND : null,
        ocrRoute: scannedPageCount ? ocr?.route ?? null : null,
        ocrRuntimeVersions: scannedPageCount ? ocr?.runtimeVersions ?? null : null,
        ocrModelSha256: scannedPageCount ? ocr?.modelSha256 ?? null : null,
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
