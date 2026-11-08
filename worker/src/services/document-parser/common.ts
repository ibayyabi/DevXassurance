import { execFile } from "node:child_process";
import { promisify } from "node:util";
import JSZip from "jszip";
import { DOMParser, type Element } from "@xmldom/xmldom";

import { inspectZipDirectory } from "../../../../src/features/documents/lib/zip-safety";

import type { WorkbookCell } from "./types";

const MAX_OFFICE_ENTRY_EXPANDED_BYTES = 25 * 1024 * 1024;
const MAX_OFFICE_PACKAGE_EXPANDED_BYTES = 100 * 1024 * 1024;

// Bump whenever parsed chunk/source-reference output changes: cached extraction
// groups are keyed by this version, so older rows are never reused.
// /23: layout-drift rows render without column-role labels and carry a
// layoutDrift flag plus a layout_drift parser warning.
export const PARSER_VERSION = "document-parser/23";

export class OfficePackageError extends Error {
  constructor(
    readonly code: "office_package_size_limit" | "office_package_unsupported" | "office_package_invalid",
    message: string,
  ) {
    super(message);
    this.name = "OfficePackageError";
  }
}

export async function loadOfficePackage(buffer: ArrayBuffer) {
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

export const execFileAsync = promisify(execFile);

export function parseXml(xml: string, parser = new DOMParser()) {
  const document = parser.parseFromString(xml.startsWith("\uFEFF") ? xml.slice(1) : xml, "application/xml");
  if (!document.documentElement || document.getElementsByTagName("parsererror").length) {
    throw new Error("The document contains malformed XML.");
  }
  return document;
}

export function childElements(parent: Element) {
  return Array.from(parent.childNodes)
    .filter((child) => child.nodeType === 1)
    .map((child) => child as Element);
}

export function elementText(element: Element, tagName: string) {
  const nodes = tagName.includes(":")
    ? element.getElementsByTagName(tagName)
    : element.getElementsByTagNameNS("*", tagName);
  return Array.from(nodes)
    .map((node) => node.textContent ?? "")
    .join("");
}

export function hasExpectedFileSignature(extension: string, buffer: ArrayBuffer) {
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

export function normalizeText(value: string) {
  return value
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function columnNumber(reference: string) {
  const letters = reference.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? "";
  return [...letters].reduce((column, letter) => column * 26 + letter.charCodeAt(0) - 64, 0);
}

export function columnLetters(column: number) {
  let value = column;
  let letters = "";
  while (value > 0) {
    value -= 1;
    letters = String.fromCharCode(65 + value % 26) + letters;
    value = Math.floor(value / 26);
  }
  return letters;
}

export function excelSerialToIsoDate(rawValue: string, date1904: boolean) {
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

// Distinguishes actual numeric zero, cached empty, missing cache, cached error,
// and non-formula. Never computes formulas and never invents a result.
export function classifyFormulaCache(
  hasFormula: boolean,
  type: string | null,
  valueNode: Element | null,
  rawValue: string,
): Pick<WorkbookCell, "formulaCacheStatus" | "formulaCacheType" | "formulaCacheRaw"> {
  if (!hasFormula) {
    return {
      formulaCacheStatus: "not_formula",
      formulaCacheType: null,
      formulaCacheRaw: null,
    };
  }
  if (!valueNode) {
    return {
      formulaCacheStatus: "missing_cache",
      formulaCacheType: null,
      formulaCacheRaw: null,
    };
  }
  const cacheType = type === "b" ? "boolean"
    : type === "str" || type === "s" ? "string"
    : type === "e" ? "error"
    : type === "n" || type === null || type === undefined ? "number"
    : null;
  if (cacheType === "error") {
    return {
      formulaCacheStatus: "cached_error",
      formulaCacheType: "error",
      formulaCacheRaw: rawValue,
    };
  }
  if (cacheType === null) {
    return {
      formulaCacheStatus: "unknown",
      formulaCacheType: null,
      formulaCacheRaw: rawValue,
    };
  }
  if (rawValue === "") {
    return {
      formulaCacheStatus: "cached_empty",
      formulaCacheType: null,
      formulaCacheRaw: "",
    };
  }
  return {
    formulaCacheStatus: "cached_value",
    formulaCacheType: cacheType,
    formulaCacheRaw: rawValue,
  };
}

// True only when every numeric section of the cell format is a plain percentage
// pattern. Escaped literal `\%`, quoted `"%"`, color/condition sections, and
// currency or date formats are never treated as proven scaling; an unusual
// percent format simply leaves the stored fraction unconverted.
// ponytail: plain `[#0…]%` sections only; widen if a real workbook needs more.
export function isPercentNumberFormat(format: string): boolean {
  const sections = format
    .replace(/"[^"]*"|\[[^\]]*\]|\\./g, "")
    .split(";")
    .map((section) => section.trim())
    .filter(Boolean);
  return (
    sections.length > 0 &&
    sections.every((section) => /^[#0][#0,]*(?:\.[#0]+)?%$/.test(section))
  );
}

// A cell whose own number format is a percentage stores a fraction but displays
// a percentage. Render that exact percentage (not a rounded display value) only
// for a non-formula numeric literal whose own cell format proves scaling. The
// raw value and format stay in the same cell's annotation for provenance.
export function percentFormattedDisplayValue(
  cell: WorkbookCell,
  isoDate: string | undefined,
): string | null {
  if (cell.formula || cell.textual || isoDate || !cell.value.trim()) return null;
  const format = cell.numberFormat;
  if (!format || !isPercentNumberFormat(format)) return null;
  const numeric = Number(cell.value);
  if (!Number.isFinite(numeric)) return null;
  return `${Number((numeric * 100).toPrecision(12))}%`;
}
