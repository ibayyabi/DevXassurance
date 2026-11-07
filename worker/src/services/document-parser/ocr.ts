import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { execFileAsync } from "./common";

export const OCR_ENGINE = "rapidocr";
export const OCR_MODEL = "PP-OCRv6";
export const OCR_MODEL_SIZE = "tiny";
export const OCR_BACKEND = "onnxruntime-cpu";
export const OCR_ROUTE = "id";




export async function renderPdfPageWithGhostscript(
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
        "Scanned PDF OCR needs local Ghostscript and PP-OCRv6; install Ghostscript and the PP-OCRv6 runtime to process scanned pages.",
      );
    }
    throw new OcrError("ocr_failed", `Ghostscript could not rasterize PDF page ${pageNumber}.`);
  }
}

export type OcrRun = {
  texts: string[];
  route: string;
  runtimeVersions: { rapidocr: string; onnxruntime: string };
  modelSha256: { detector: string; recognizer: string; classifier: string };
};

export type OcrPayload =
  | {
      ok: true;
      results: Array<{ index: number; text: string }>;
      route: string;
      runtimeVersions: { rapidocr: string; onnxruntime: string };
      modelSha256: { detector: string; recognizer: string; classifier: string };
    }
  | { ok: false; errorCode: OcrErrorCode; errorMessage: string };

export function readOcrPayload(stdout: string | undefined): OcrPayload | undefined {
  if (!stdout) return undefined;
  try {
    return JSON.parse(stdout) as OcrPayload;
  } catch {
    return undefined;
  }
}


export type OcrErrorCode =
  | "ocr_unavailable"
  | "ocr_model_unavailable"
  | "ocr_failed";

export class OcrError extends Error {
  constructor(
    readonly code: OcrErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OcrError";
  }
}

export function isMissingExecutable(error: unknown): error is Error & { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

