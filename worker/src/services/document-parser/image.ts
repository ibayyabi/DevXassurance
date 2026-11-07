import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { PARSER_VERSION, execFileAsync, normalizeText } from "./common";
import { chunkSourceBlocks } from "./chunking";
import { paragraphBlocks } from "./text-csv";
import {
  OCR_BACKEND,
  OCR_ENGINE,
  OCR_MODEL,
  OCR_MODEL_SIZE,
  OCR_ROUTE,
  OcrError,
  isMissingExecutable,
  readOcrPayload,
  type OcrRun,
} from "./ocr";
import type { ParseResult } from "./types";

export async function recognizeImages(imagePaths: string[]): Promise<OcrRun> {
  if (!imagePaths.length) {
    throw new OcrError("ocr_failed", "No image paths were supplied to the OCR helper.");
  }

  let stdout: string;
  try {
    const python =
      process.env.XASS_OCR_PYTHON?.trim() ||
      join(process.cwd(), ".venv-ocr", "bin", "python");
    const helper = join(process.cwd(), "worker", "ocr", "ppocr.py");
    const result = await execFileAsync(
      python,
      [helper, "--json", "--images", ...imagePaths],
      {
        timeout: imagePaths.length * 120_000 + 120_000,
        maxBuffer: 10_000_000,
        encoding: "utf8",
      },
    );
    stdout = result.stdout;
  } catch (error) {
    const failed = readOcrPayload(
      typeof error === "object" && error !== null && "stdout" in error
        ? String(error.stdout)
        : undefined,
    );
    if (failed && failed.ok === false) {
      throw new OcrError(failed.errorCode, failed.errorMessage);
    }
    if (isMissingExecutable(error)) {
      throw new OcrError(
        "ocr_unavailable",
        "Local PP-OCRv6 runtime is unavailable; install the OCR virtualenv and dependencies (see worker/README.md).",
      );
    }
    throw new OcrError(
      "ocr_failed",
      "Local PP-OCRv6 OCR failed while reading the document images.",
    );
  }

  const payload = readOcrPayload(stdout);
  if (
    !payload ||
    payload.ok !== true ||
    payload.route !== OCR_ROUTE ||
    !payload.runtimeVersions ||
    typeof payload.runtimeVersions.rapidocr !== "string" ||
    typeof payload.runtimeVersions.onnxruntime !== "string" ||
    !payload.modelSha256 ||
    typeof payload.modelSha256.detector !== "string" ||
    typeof payload.modelSha256.recognizer !== "string" ||
    typeof payload.modelSha256.classifier !== "string" ||
    !Array.isArray(payload.results) ||
    payload.results.length !== imagePaths.length ||
    payload.results.some(
      (entry, index) =>
        !entry ||
        typeof entry !== "object" ||
        entry.index !== index ||
        typeof entry.text !== "string",
    )
  ) {
    throw new OcrError("ocr_failed", "Local PP-OCRv6 OCR returned an invalid response.");
  }
  return {
    texts: payload.results.map((entry) => entry.text),
    route: payload.route,
    runtimeVersions: payload.runtimeVersions,
    modelSha256: payload.modelSha256,
  };
}

export async function parseImageDocument(
  fileName: string,
  buffer: ArrayBuffer,
): Promise<ParseResult> {
  let temporaryDirectory: string | undefined;
  try {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "xass-image-ocr-"));
    const extension = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
    const imagePath = join(temporaryDirectory, `image${extension}`);
    await writeFile(imagePath, new Uint8Array(buffer));
    const ocr = await recognizeImages([imagePath]);
    const text = normalizeText(ocr.texts[0] ?? "");
    if (!text) {
      return {
        ok: false,
        errorCode: "ocr_no_text",
        errorMessage: "OCR found no readable text in the image.",
      };
    }

    const chunks = chunkSourceBlocks(
      paragraphBlocks(text, { kind: "image", imageName: fileName, ocr: OCR_ENGINE }),
    );
    return {
      ok: true,
      chunks,
      parserMetadata: {
        parser: OCR_ENGINE,
        parserVersion: PARSER_VERSION,
        fileName,
        textLength: text.length,
        ocrEngine: OCR_ENGINE,
        ocrModel: OCR_MODEL,
        ocrModelSize: OCR_MODEL_SIZE,
        ocrBackend: OCR_BACKEND,
        ocrRoute: ocr.route,
        ocrRuntimeVersions: ocr.runtimeVersions,
        ocrModelSha256: ocr.modelSha256,
        warnings: ["Image text was extracted using local PP-OCRv6 (tiny) OCR."],
      },
    };
  } catch (error) {
    return {
      ok: false,
      errorCode: error instanceof OcrError ? error.code : "ocr_failed",
      errorMessage:
        error instanceof OcrError
          ? error.message
          : "The image could not be read by local PP-OCRv6 OCR.",
    };
  } finally {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
