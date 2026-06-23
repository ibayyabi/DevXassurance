export const processableEvidenceMimeTypes = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
] as const;

export const supportedEvidenceMimeTypes = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export const supportedEvidenceExtensions = [
  ".pdf",
  ".docx",
  ".xlsx",
  ".csv",
  ".txt",
  ".ppt",
  ".pptx",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
] as const;

export const evidenceFileAccept = [
  ...supportedEvidenceMimeTypes,
  ...supportedEvidenceExtensions,
].join(",");

export function isSupportedEvidenceFile(file: File) {
  const mimeType = normalizedMimeType(file);
  const extension = fileExtension(file.name);

  return (
    supportedEvidenceMimeTypes.includes(
      mimeType as (typeof supportedEvidenceMimeTypes)[number],
    ) ||
    supportedEvidenceExtensions.includes(
      extension as (typeof supportedEvidenceExtensions)[number],
    )
  );
}

export function isProcessableEvidenceFile(file: File) {
  const mimeType = normalizedMimeType(file);
  const extension = fileExtension(file.name);

  return (
    processableEvidenceMimeTypes.includes(
      mimeType as (typeof processableEvidenceMimeTypes)[number],
    ) || [".pdf", ".docx", ".xlsx", ".csv", ".txt"].includes(extension)
  );
}

export function normalizedMimeType(file: File) {
  return file.type || mimeFromExtension(file.name) || "application/octet-stream";
}

export function fileKindLabel(mimeType: string, fileName?: string) {
  const extension = fileName ? fileExtension(fileName).replace(".", "") : "";

  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.includes("word") || extension === "doc" || extension === "docx") {
    return "Word";
  }
  if (
    mimeType.includes("spreadsheet") ||
    mimeType.includes("excel") ||
    ["xls", "xlsx"].includes(extension)
  ) {
    return "Spreadsheet";
  }
  if (mimeType === "text/csv" || extension === "csv") return "CSV";
  if (mimeType === "text/plain" || extension === "txt") return "Text";
  if (
    mimeType.includes("presentation") ||
    ["ppt", "pptx"].includes(extension)
  ) {
    return "Presentation";
  }
  if (mimeType.startsWith("image/")) return "Image";

  return extension ? extension.toUpperCase() : "File";
}

function fileExtension(fileName: string) {
  const index = fileName.lastIndexOf(".");
  return index === -1 ? "" : fileName.slice(index).toLowerCase();
}

function mimeFromExtension(fileName: string) {
  const extension = fileExtension(fileName);

  if (extension === ".pdf") return "application/pdf";
  if (extension === ".docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (extension === ".xlsx") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (extension === ".csv") return "text/csv";
  if (extension === ".txt") return "text/plain";
  if (extension === ".ppt") return "application/vnd.ms-powerpoint";
  if (extension === ".pptx") {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";

  return null;
}
