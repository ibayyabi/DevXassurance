export type ParsedChunk = {
  chunkIndex: number;
  chunkText: string;
  pageNumber?: number;
  sectionLabel?: string;
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

type ZipTextReader = {
  file(path: string): { async(type: "text"): Promise<string> } | null;
};

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

  const extension = fileExtension(fileName);

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

  return {
    ok: false,
    errorCode: "unsupported_file_type",
    errorMessage:
      "Unsupported file type. Automated extraction supports PDF, TXT, CSV, DOCX, and XLSX files.",
  };
}

async function parsePdfDocument(
  fileName: string,
  buffer: ArrayBuffer,
): Promise<ParseResult> {
  try {
    const { pathToFileURL } = await import("node:url");
    const { join } = await import("node:path");
    const { getDocument, GlobalWorkerOptions } = await import(
      "pdfjs-dist/legacy/build/pdf.mjs"
    );
    GlobalWorkerOptions.workerSrc = pathToFileURL(
      join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"),
    ).toString();
    const loadingTask = getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
    });
    const document = await loadingTask.promise;
    const pageCount = document.numPages;
    const pageTexts: string[] = [];

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .filter(Boolean)
        .join(" ");

      pageTexts.push(pageText);
      page.cleanup();
    }

    await document.destroy();

    const text = normalizeText(pageTexts.join("\n\n"));

    if (!text) {
      return {
        ok: false,
        errorCode: "no_extractable_text",
        errorMessage:
          "No extractable text was found. Scanned PDFs need OCR before processing.",
      };
    }

    return {
      ok: true,
      chunks: chunkText(text),
      parserMetadata: {
        parser: "pdfjs-dist",
        fileName,
        pageCount,
        textLength: text.length,
      },
    };
  } catch (error) {
    return {
      ok: false,
      errorCode: "pdf_parse_failed",
      errorMessage:
        error instanceof Error
          ? error.message
          : "The PDF could not be parsed by the worker.",
    };
  }
}

function parseTextDocument(
  fileName: string,
  buffer: ArrayBuffer,
  extension: ".txt" | ".csv",
): ParseResult {
  try {
    const text = normalizeText(new TextDecoder("utf-8").decode(buffer));

    if (!text) {
      return {
        ok: false,
        errorCode: "no_extractable_text",
        errorMessage: "No extractable text was found in the document.",
      };
    }

    return {
      ok: true,
      chunks: chunkText(text),
      parserMetadata: {
        parser: extension === ".csv" ? "text/csv" : "text/plain",
        fileName,
        textLength: text.length,
      },
    };
  } catch (error) {
    return {
      ok: false,
      errorCode: "text_parse_failed",
      errorMessage:
        error instanceof Error
          ? error.message
          : "The text document could not be parsed by the worker.",
    };
  }
}

async function parseDocxDocument(
  fileName: string,
  buffer: ArrayBuffer,
): Promise<ParseResult> {
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({
      buffer: Buffer.from(buffer),
    });
    const text = normalizeText(result.value);

    if (!text) {
      return {
        ok: false,
        errorCode: "no_extractable_text",
        errorMessage: "No extractable text was found in the DOCX document.",
      };
    }

    return {
      ok: true,
      chunks: chunkText(text),
      parserMetadata: {
        parser: "mammoth",
        fileName,
        textLength: text.length,
        warnings: result.messages,
      },
    };
  } catch (error) {
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
    const JSZip = (await import("jszip")).default;
    const { DOMParser } = await import("@xmldom/xmldom");
    const parser = new DOMParser();
    const zip = await JSZip.loadAsync(Buffer.from(buffer));
    const sharedStrings = await readSharedStrings(zip, parser);
    const workbookSheetNames = await readWorkbookSheetNames(zip, parser);
    const sheetFiles = Object.keys(zip.files)
      .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const sheetTexts = await Promise.all(
      sheetFiles.map(async (sheetPath, index) => {
        const xml = await zip.file(sheetPath)?.async("text");
        if (!xml) {
          return "";
        }

        const sheetName =
          workbookSheetNames[index] ?? sheetPath.replace(/^xl\/worksheets\//i, "");
        const document = parser.parseFromString(xml, "application/xml");
        const rows = Array.from(document.getElementsByTagName("row")).map(
          (row) => {
            const cells = Array.from(row.getElementsByTagName("c")).map((cell) =>
              readWorkbookCell(cell, sharedStrings),
            );

            return cells.filter(Boolean).join(", ");
          },
        );

        return `Sheet: ${sheetName}\n${rows.filter(Boolean).join("\n")}`;
      }),
    );
    const sheetNames = workbookSheetNames.length
      ? workbookSheetNames
      : sheetFiles.map((sheetPath) =>
          sheetPath.replace(/^xl\/worksheets\//i, "").replace(/\.xml$/i, ""),
        );

    const text = normalizeText(sheetTexts.join("\n\n"));

    if (!text) {
      return {
        ok: false,
        errorCode: "no_extractable_text",
        errorMessage: "No extractable text was found in the XLSX workbook.",
      };
    }

    return {
      ok: true,
      chunks: chunkText(text),
      parserMetadata: {
        parser: "xlsx-zip-xml",
        fileName,
        sheetNames,
        textLength: text.length,
      },
    };
  } catch (error) {
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

async function readSharedStrings(
  zip: ZipTextReader,
  parser: import("@xmldom/xmldom").DOMParser,
) {
  const xml = await zip.file("xl/sharedStrings.xml")?.async("text");

  if (!xml) {
    return [];
  }

  const document = parser.parseFromString(xml, "application/xml");

  return Array.from(document.getElementsByTagName("si")).map((item) =>
    Array.from(item.getElementsByTagName("t"))
      .map((textNode) => textNode.textContent ?? "")
      .join(""),
  );
}

async function readWorkbookSheetNames(
  zip: ZipTextReader,
  parser: import("@xmldom/xmldom").DOMParser,
) {
  const xml = await zip.file("xl/workbook.xml")?.async("text");

  if (!xml) {
    return [];
  }

  const document = parser.parseFromString(xml, "application/xml");

  return Array.from(document.getElementsByTagName("sheet"))
    .map((sheet) => sheet.getAttribute("name") ?? "")
    .filter(Boolean);
}

function readWorkbookCell(
  cell: import("@xmldom/xmldom").Element,
  sharedStrings: string[],
) {
  const type = cell.getAttribute("t");
  const value = cell.getElementsByTagName("v")[0]?.textContent ?? "";

  if (type === "s") {
    return sharedStrings[Number(value)] ?? "";
  }

  if (type === "inlineStr") {
    return Array.from(cell.getElementsByTagName("t"))
      .map((textNode) => textNode.textContent ?? "")
      .join("");
  }

  if (type === "b") {
    return value === "1" ? "TRUE" : "FALSE";
  }

  return value;
}

function fileExtension(fileName: string) {
  const index = fileName.lastIndexOf(".");

  return index === -1 ? "" : fileName.slice(index).toLowerCase();
}

function normalizeText(value: string) {
  return value
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function chunkText(text: string): ParsedChunk[] {
  const maxLength = 1400;
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const chunks: ParsedChunk[] = [];
  let current = "";

  for (const paragraph of paragraphs.length ? paragraphs : [text]) {
    if (`${current}\n\n${paragraph}`.trim().length > maxLength && current) {
      chunks.push(buildChunk(chunks.length, current));
      current = paragraph;
    } else {
      current = `${current}\n\n${paragraph}`.trim();
    }
  }

  if (current) {
    chunks.push(buildChunk(chunks.length, current));
  }

  return chunks;
}

function buildChunk(index: number, text: string): ParsedChunk {
  return {
    chunkIndex: index,
    chunkText: text,
    sectionLabel: inferSectionLabel(text),
  };
}

function inferSectionLabel(text: string) {
  const firstLine = text.split("\n")[0]?.trim();

  if (!firstLine || firstLine.length > 80) {
    return undefined;
  }

  return firstLine;
}
