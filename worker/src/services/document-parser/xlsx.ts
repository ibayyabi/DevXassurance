import { posix } from "node:path";
import { DOMParser, type Element } from "@xmldom/xmldom";

import {
  OfficePackageError,
  PARSER_VERSION,
  classifyFormulaCache,
  columnLetters,
  columnNumber,
  elementText,
  excelSerialToIsoDate,
  loadOfficePackage,
  parseXml,
  percentFormattedDisplayValue,
} from "./common";
import { chunkSourceBlocks } from "./chunking";
import type {
  FormulaCell,
  ParseResult,
  ParsedSourceCell,
  ParsedSourceLocation,
  SourceBlock,
  SourceCellReference,
  WorkbookCell,
  ZipTextReader,
} from "./types";

// A key-value row whose key names the artifact's own subject (for example
// "Subsystem" or "Work Package"). Read only as a document-level fallback when
// the workbook declares exactly one such value.
const SUBJECT_KEY_CUE = /\b(?:sub[\s-]?system|component|work\s*package|discipline|package|scope)\b/i;
const SHEET_TITLE_CUE =
  /\b(?:project|program(?:me)?|progress|weekly|monthly|periodic|report|status|subcontractor|contractor|work\s*package|scope|overview|dashboard|schedule|plan|minutes)\b/i;
const TITLE_METADATA_VALUE_CUE =
  /^(?:(?:as[\s-]?of|(?:report|cut[\s-]?off|document|issued|effective)\s+date|(?:reporting\s+)?period|week|month|revision|version|prepared\s+by|project|workstream)\s*(?:[:#=-]\s*|\s+)\S.*|w(?:eek)?\s*[-#]?\s*\d{1,2}|(?:19|20)\d{2}(?:[-/]\d{1,2}){0,2})$/iu;

// A weekly Gantt's first header row is a grid of week/period labels or
// date-formatted serials, optionally with a WBS-style caption. A second header
// row is accepted only when that grid is proven and the candidate row still
// looks like labels; otherwise the row may be the first data row, so it stays
// data (fail closed) instead of being consumed and lost.
const WEEK_HEADER_LABEL = /^(?:w(?:eek)?\s*[-#]?\s*\d{1,3}(?:\s*(?:19|20)\d{2})?|(?:19|20)\d{2}(?:[-/]\d{1,2}){0,2}|\d{1,2}[-/]\d{1,2}(?:[-/]\d{2,4})?|q[1-4](?:\s*(?:19|20)?\d{2})?|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:[.,]?\s+\d{2,4})?|(?:week|month|period|minggu|pekan|bulan|sprint|cycle)\s+[\w./-]+)$/iu;
const WEEK_HEADER_CAPTION = /^(?:wbs|no\.?|id|code|task|activity|item|phase|work\s*package|description|deliverable)$/iu;
const DATA_LIKE_LABEL = /^(?:[-+]?(?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d+)?\s*%?|(?:rp|idr|usd|eur|sgd|myr)\s*[\d.,]+|[$€£]\s*[\d.,]+)$/iu;
const DATA_LIKE_LABEL_MAX_LENGTH = 60;
// A period band needs at least this many dated columns, with gaps within this
// many days of the median gap (week starts, or month starts of 28-31 days).
const PERIOD_BAND_MIN_COLUMNS = 3;
const PERIOD_BAND_GAP_TOLERANCE_DAYS = 3;

export async function parseXlsxDocument(
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
    // Workbook-declared subject labels and each sheet's own title block: the
    // worker's fallback proof for a component scope when the cited row has no
    // scope column and the workbook declares exactly one subject.
    const workbookSubjects: Array<{
      value: string;
      key: string;
      sheetName: string;
      keyCell: string;
      valueCell: string;
    }> = [];
    const sheetTitles: Record<string, { text: string; cell: string }> = {};

    for (const sheet of sheets) {
      const xml = await zip.file(sheet.path)?.async("text");
      if (!xml) throw new Error(`The XLSX workbook is missing worksheet "${sheet.name}".`);
      const document = parseXml(xml, parser);
      const merges = Array.from(document.getElementsByTagNameNS("*", "mergeCell"))
        .map((cell) => cell.getAttribute("ref"))
        .filter((reference): reference is string => Boolean(reference));
      const rows = Array.from(document.getElementsByTagNameNS("*", "row")).map((row, index) => ({
        number: Number(row.getAttribute("r")) || index + 1,
        cells: Array.from(row.getElementsByTagNameNS("*", "c"))
          .map((cell) => readWorkbookCell(cell, sharedStrings, numberFormats))
          .filter((cell) => cell.value || cell.formula || cell.formulaCacheStatus !== "not_formula"),
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
        // A weekly Gantt may put a week/date header row above the WBS header
        // row. Two headers are accepted only when the first row is proven to be
        // a week/period grid or a merged group-header row, and the second row
        // still reads as labels; a row that could be the first data row stays
        // data rather than being lost.
        if (tableRows.length >= 3) {
          const isPeriodHeaderCell = (cell: WorkbookCell) =>
            Boolean(
              cell.dateFormat &&
              cell.value &&
              excelSerialToIsoDate(cell.value, date1904),
            ) || WEEK_HEADER_LABEL.test(cell.value.trim());
          const hasDateHeaderCell = (cell: WorkbookCell) =>
            Boolean(
              cell.dateFormat &&
              cell.value &&
              excelSerialToIsoDate(cell.value, date1904),
            );
          const isWeekHeaderRow = tableRows[0].cells.every((cell) =>
            isPeriodHeaderCell(cell) ||
            (
              cell.textual &&
              !cell.formula &&
              WEEK_HEADER_CAPTION.test(cell.value.trim())
            ),
          ) && tableRows[0].cells.filter(isPeriodHeaderCell).length >= 2;
          const isTextHeaderRow = tableRows[0].cells.every((cell) =>
            cell.textual && !cell.formula && Boolean(cell.value.trim()),
          );
          const hasGroupedHeader = merges.some((merge) => {
            const [start, end] = merge.split(":");
            const startRow = Number(start?.match(/\d+$/)?.[0]);
            const startColumn = columnNumber(start ?? "");
            const endColumn = columnNumber(end ?? "");
            return startRow === tableRows[0].number &&
              startColumn !== null &&
              endColumn !== null &&
              endColumn > startColumn &&
              tableRows[0].cells.some((cell) => cell.reference === start);
          });
          const isHeaderLabelCell = (cell: WorkbookCell) => {
            const text = cell.value.trim();
            return cell.textual &&
              !cell.formula &&
              Boolean(text) &&
              text.length <= DATA_LIKE_LABEL_MAX_LENGTH &&
              !DATA_LIKE_LABEL.test(text);
          };
          // A weekly Gantt may place field labels (WBS, Deliverable, ...)
          // beside the week/date cells they continue rather than above the
          // whole row. Accept that staggered subtitle only under a proven
          // week-header row, and only for date cells in a column the first
          // header row already labelled; any other cell must be a label.
          const firstHeaderColumns = new Set(
            tableRows[0].cells
              .map((cell) => columnNumber(cell.reference))
              .filter((column) => column > 0),
          );
          const isPeriodContinuationCell = (cell: WorkbookCell) =>
            firstHeaderColumns.has(columnNumber(cell.reference)) &&
            hasDateHeaderCell(cell);
          // Structural period band: a first row of plain labels where every band
          // column has a date-valued cell directly below it, and those dates
          // ascend at an even interval (week or month starts). No label naming
          // pattern is needed. A data row's dates are not evenly spaced, so the
          // spacing proof keeps the first record from being taken for a header.
          const secondRowDateByColumn = new Map<number, number>();
          for (const cell of tableRows[1].cells) {
            const column = columnNumber(cell.reference);
            if (
              column > 0 &&
              cell.dateFormat &&
              !cell.textual &&
              !cell.formula &&
              excelSerialToIsoDate(cell.value, date1904)
            ) secondRowDateByColumn.set(column, Number(cell.value));
          }
          const bandDateSerials = [...secondRowDateByColumn.entries()]
            .sort(([left], [right]) => left - right)
            .map(([, serial]) => serial);
          const bandGaps = bandDateSerials.slice(1).map((serial, index) => serial - bandDateSerials[index]);
          const medianBandGap = [...bandGaps].sort((left, right) => left - right)[Math.floor(bandGaps.length / 2)];
          const isEvenlySpacedAscending = bandDateSerials.length >= PERIOD_BAND_MIN_COLUMNS &&
            bandGaps.every((gap) => gap > 0 && Math.abs(gap - medianBandGap) <= PERIOD_BAND_GAP_TOLERANCE_DAYS);
          const isDateBandedHeaderRow =
            isEvenlySpacedAscending &&
            tableRows[0].cells.every(
              (cell) => isHeaderLabelCell(cell) && secondRowDateByColumn.has(columnNumber(cell.reference)),
            );
          const isPeriodBand = isWeekHeaderRow || isDateBandedHeaderRow;
          const isPlainLabelRow = tableRows[1].cells.every(isHeaderLabelCell);
          const subtitleLabelCells = tableRows[1].cells.filter(isHeaderLabelCell);
          const subtitleLabels = subtitleLabelCells.map((cell) =>
            cell.value.trim().toLocaleLowerCase(),
          );
          const hasSubtitleFieldLabel = subtitleLabelCells.some(
            (cell) => !firstHeaderColumns.has(columnNumber(cell.reference)),
          );
          const isStaggeredWeekLabelRow =
            isPeriodBand &&
            tableRows[1].cells.every(
              (cell) => isHeaderLabelCell(cell) || isPeriodContinuationCell(cell),
            ) &&
            hasSubtitleFieldLabel &&
            new Set(subtitleLabels).size === subtitleLabels.length;
          if (
            (
              isPeriodBand ||
              (
                hasGroupedHeader &&
                isTextHeaderRow &&
                !tableRows[0].cells.some(hasDateHeaderCell)
              )
            ) &&
            (isPlainLabelRow || isStaggeredWeekLabelRow) &&
            tableRows[2].cells.some((cell) => !cell.textual)
          ) headerCount = 2;
        }

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
        const headerLabels = [...headers.values()];
        const formulaCellsForRow = (row: typeof tableRows[number]): FormulaCell[] =>
          row.cells.flatMap((cell) =>
            cell.formulaCacheStatus === "not_formula" ? [] : [{
              sheetName: sheet.name,
              cellReference: cell.reference,
              formula: cell.formula,
              formulaCacheStatus: cell.formulaCacheStatus,
              formulaCacheType: cell.formulaCacheType,
              formulaCacheRaw: cell.formulaCacheRaw,
              cacheProvenance: cell.formulaCacheStatus === "cached_value" ? "stored_cached_result" : null,
              rowStart: row.number,
              rowEnd: row.number,
            }],
          );
        for (const row of tableRows) {
          for (const cell of row.cells) {
            if (
              cell.formulaCacheStatus === "missing_cache" ||
              cell.formulaCacheStatus === "cached_empty" ||
              cell.formulaCacheStatus === "cached_error" ||
              cell.formulaCacheStatus === "unknown"
            ) {
              warnings.push(`Sheet "${sheet.name}" cell ${cell.reference} has formula "${cell.formula}" with formula cache status "${cell.formulaCacheStatus}"; recalculate and save the workbook in a spreadsheet application before using the result, and do not treat the missing or cached-empty result as zero or as project evidence.`);
            }
          }
        }
        const headerText = [...headers.entries()]
          .sort(([left], [right]) => left - right)
          .map(([column, label]) => `${columnLetters(column)}: ${label}`)
          .join(" | ");
        // A sheet title must be a title-like literal in a structurally separate
        // pre-table row, never the first label in an ordinary table header.
        const firstRow = tableRows[0];
        const firstCell = firstRow.cells[0];
        const repeatedMergedTitle = firstRow.cells.length > 1 && merges.some((merge) => {
          const [start, end] = merge.split(":");
          const startRow = Number(start?.match(/\d+$/)?.[0]);
          const endRow = Number(end?.match(/\d+$/)?.[0]);
          const startColumn = columnNumber(start ?? "");
          const endColumn = columnNumber(end ?? "");
          return start === firstCell.reference &&
            startRow === firstRow.number &&
            endRow === firstRow.number &&
            endColumn > startColumn &&
            firstRow.cells.every((cell) => {
              const column = columnNumber(cell.reference);
              return column >= startColumn &&
                column <= endColumn &&
                cell.textual &&
                !cell.formula &&
                cell.value.trim() === firstCell.value.trim();
            });
        });
        const hasExplicitTitleMetadata = firstRow.cells.length > 1 &&
          firstRow.cells.slice(1).every((cell) =>
            !cell.formula && (
              (cell.textual && TITLE_METADATA_VALUE_CUE.test(cell.value.trim())) ||
              (cell.dateFormat && Boolean(excelSerialToIsoDate(cell.value, date1904)))
            )
          );
        const titleCellCandidate =
          firstRow.cells.length === 1 || repeatedMergedTitle || hasExplicitTitleMetadata
            ? firstCell
            : undefined;
        const standaloneTitle =
          tableIndex === 0 &&
          titleCellCandidate !== undefined &&
          titleCellCandidate.textual &&
          !titleCellCandidate.formula &&
          SHEET_TITLE_CUE.test(titleCellCandidate.value) &&
          (
            hasExplicitTitleMetadata ||
            (tableRows.length === 1 && tables.length > 1) ||
            (
              tableRows.length >= 3 &&
              tableRows[1].cells.length > 1 &&
              tableRows[1].cells.every((cell) => cell.textual) &&
              tableRows[2].cells.some((cell) => !cell.textual)
            )
          )
            ? { row: firstRow, cell: titleCellCandidate }
            : undefined;
        const titleCell = tableRows
          .slice(0, headerCount)
          .flatMap((row) => row.cells.map((cell) => ({ row, cell })))
          .find(({ cell }) => cell.textual && !cell.formula && cell.value.trim());
        const titleCellText = titleCell
          ? `${columnLetters(columnNumber(titleCell.cell.reference) ?? 0) || "Cell"}: ${titleCell.cell.value}`
          : null;
        const sheetTitleText = standaloneTitle
          ? `${columnLetters(columnNumber(standaloneTitle.cell.reference) ?? 0) || "Cell"}: ${standaloneTitle.cell.value}`
          : null;
        if (!(sheet.name in sheetTitles) && standaloneTitle && sheetTitleText) {
          sheetTitles[sheet.name] = { text: sheetTitleText, cell: standaloneTitle.cell.reference };
        }
        const titleCellReferences: SourceCellReference[] =
          titleCell && titleCellText
            ? [{
                text: titleCellText,
                modelText: titleCellText,
                location: {
                  kind: "xlsx",
                  sheetName: sheet.name,
                  tableNumber: tableIndex,
                  rowStart: titleCell.row.number,
                  rowEnd: titleCell.row.number,
                  cellRangeStart: titleCell.cell.reference,
                  cellRangeEnd: titleCell.cell.reference,
                },
                cell: {
                  sheetName: sheet.name,
                  row: titleCell.row.number,
                  column: columnLetters(columnNumber(titleCell.cell.reference) ?? 0),
                  cell: titleCell.cell.reference,
                  label: null,
                  value: titleCell.cell.value,
                  rawValue: titleCell.cell.value,
                  dateIso: null,
                },
              }]
            : [];
        blocks.push({
          text: headerText,
          kind: "table-header",
          formulaCells: tableRows.slice(0, headerCount).flatMap(formulaCellsForRow),
          location: {
            kind: "xlsx",
            sheetName: sheet.name,
            tableNumber: tableIndex,
            rowStart: tableRows[0].number,
            rowEnd: tableRows[headerCount - 1].number,
            cellRangeStart: headerCells[0].reference,
            cellRangeEnd: headerCells[headerCells.length - 1].reference,
          },
          cellReferences: titleCellReferences,
          groupKey: `sheet:${sheet.name}:table:${tableIndex}`,
          sectionLabel: sheet.name,
        });
        for (const diagnostic of diagnoseTableAmbiguity(sheet.name, tableRows, headerCount, merges, headerLabels)) {
          warnings.push(diagnostic);
        }
        const { driftRows, warning: driftWarning } = detectLayoutDriftRows(sheet.name, tableRows, headerCount, headers);
        if (driftWarning) warnings.push(driftWarning);

        for (const row of tableRows.slice(headerCount)) {
          const driftedRow = driftRows.has(row.number);
          const cells = row.cells.map((cell) => {
            const column = columnNumber(cell.reference);
            // A drifted row's column role is unprovable: the cell renders with
            // the column-letter prefix instead of the header label so the model
            // sees raw evidence, never an attribution the worker cannot prove.
            const label = driftedRow ? undefined : headers.get(column);
            const labelText = label ? `${label}: ` : `${columnLetters(column) || "Cell"}: `;
            // A date number format makes a cell a date serial only when it holds
            // a number (or nothing). Text in a date-formatted cell - an ISO date
            // string, a header label, a word - is literal content: it is never
            // converted and never reported as an invalid Excel serial.
            const dateSerialCell = cell.dateFormat && !(cell.textual && Boolean(cell.value.trim()));
            const isoDate = dateSerialCell && cell.value
              ? excelSerialToIsoDate(cell.value, date1904)
              : undefined;
            const invalidDate = dateSerialCell && cell.value && !isoDate;
            const formulaStatus = cell.formulaCacheStatus;
            const isFormula = formulaStatus !== "not_formula";
            const formulaCacheTag = isFormula ? `; formula cache: ${formulaStatus}` : "";
            const formulaValueText = formulaStatus === "missing_cache"
              ? " (no cached value)"
              : formulaStatus === "cached_empty"
                ? " (cached value: empty)"
                : formulaStatus === "cached_error"
                  ? ` (cached error: ${cell.formulaCacheRaw ?? cell.value ?? "unknown error"})`
                  : formulaStatus === "unknown"
                    ? " (formula cache status unknown)"
                    : formulaStatus === "cached_value"
                      ? ` (stored cached result: ${cell.value}; freshness not established)`
                      : "";
            const displayValue = percentFormattedDisplayValue(cell, isoDate) ?? cell.value;
            // The raw value, number format, and cache disclaimer stay in an
            // annotation appended after the readable text. The readable cell text
            // the model is shown (modelText) is therefore always a contiguous
            // substring of the canonical cell/row text a citation must match, so
            // a model can cite exactly what it was given.
            const annotation = cell.numberFormat || isFormula
              ? ` [raw value: ${cell.value}; number format: ${cell.numberFormat ?? "none"}${isoDate ? `; ISO date: ${isoDate}` : invalidDate ? `; Needs Review: invalid Excel serial ${cell.value}` : dateSerialCell ? "; Needs Review: no cached date value" : ""}${formulaCacheTag}]`
              : "";
            const compactValue = cell.formula
              ? `${cell.formula}${formulaValueText}${formulaCacheTag}`
              : isoDate ?? displayValue;
            const compactFormat = dateSerialCell
              ? isoDate
                ? ""
                : ` [date format: ${cell.numberFormat ?? "unknown"}; Needs Review: ${invalidDate ? `invalid Excel serial ${cell.value}` : "no cached date value"}${formulaCacheTag}]`
              : cell.numberFormat && cell.numberFormat !== "General" && !cell.dateFormat
                ? ` [number format: ${cell.numberFormat}${formulaCacheTag}]`
                : isFormula
                  ? ` [formula cache: ${formulaStatus}]`
                  : "";
            const modelCellText = `${labelText}${compactValue}${compactFormat}`;
            return {
              text: `${modelCellText}${annotation}`,
              modelText: modelCellText,
              annotation,
              sourceCell: {
                sheetName: sheet.name,
                row: row.number,
                column: columnLetters(column),
                cell: cell.reference,
                label: label ?? null,
                value: compactValue,
                rawValue: cell.value,
                dateIso: isoDate ?? null,
              } satisfies ParsedSourceCell,
            };
          });
          const modelText = cells.map((cell) => cell.modelText).join(" | ");
          // The row keeps every annotation after its readable text so the row
          // reference stays citable against exactly what the model was shown.
          const text = `${modelText}${cells.map((cell) => cell.annotation).filter(Boolean).join("")}`;
          const rowCells = cells.map((cell) => cell.sourceCell);
          // A key-value row declares a workbook subject only when its cue and
          // exactly one literal value share the row; multiple candidates or a
          // formula result are ambiguous evidence, not a scope declaration.
          const keyCell = row.cells[0];
          const subjectCells = row.cells.slice(1).filter(
            (cell) => cell.value.trim() || cell.formulaCacheStatus !== "not_formula",
          );
          const subjectCell = subjectCells.length === 1 &&
              subjectCells[0].textual &&
              !subjectCells[0].formula
            ? subjectCells[0]
            : undefined;
          const subjectValue = subjectCell?.value.trim();
          if (
            !driftedRow &&
            keyCell?.textual &&
            !keyCell.formula &&
            SUBJECT_KEY_CUE.test(keyCell.value) &&
            subjectCell &&
            subjectValue &&
            !workbookSubjects.some(
              (subject) =>
                subject.value === subjectValue && subject.sheetName === sheet.name,
            )
          ) {
            workbookSubjects.push({
              value: subjectValue,
              key: keyCell.value.trim(),
              sheetName: sheet.name,
              keyCell: keyCell.reference,
              valueCell: subjectCell.reference,
            });
          }
          if (row.cells.some((cell) => cell.dateFormat)) {
            warnings.push(`Sheet "${sheet.name}" contains date-formatted raw values; recognized dates are normalized and invalid or unavailable values need review.`);
          }
          const rowLocation: ParsedSourceLocation = {
            kind: "xlsx",
            sheetName: sheet.name,
            tableNumber: tableIndex,
            rowStart: row.number,
            rowEnd: row.number,
            cellRangeStart: row.cells[0].reference,
            cellRangeEnd: row.cells[row.cells.length - 1].reference,
          };
          blocks.push({
            text,
            modelText,
            kind: "table-row",
            formulaCells: formulaCellsForRow(row),
            location: rowLocation,
            rowCells,
            cellReferences: row.cells.map((cell, cellIndex) => ({
              text: cells[cellIndex].text,
              modelText: cells[cellIndex].modelText,
              location: {
                ...rowLocation,
                cellRangeStart: cell.reference,
                cellRangeEnd: cell.reference,
              },
              cell: cells[cellIndex].sourceCell,
            })),
            groupKey: `sheet:${sheet.name}:table:${tableIndex}`,
            sectionLabel: sheet.name,
            ...(driftedRow ? { layoutDrift: true } : {}),
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
        subjects: workbookSubjects,
        sheetTitles,
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

  return Array.from(parseXml(xml, parser).getElementsByTagNameNS("*", "si")).map((item) =>
    Array.from(item.getElementsByTagNameNS("*", "t"))
      .map((textNode) => textNode.textContent ?? "")
      .join(""),
  );
}

async function readWorkbookNumberFormats(zip: ZipTextReader, parser: DOMParser) {
  const xml = await zip.file("xl/styles.xml")?.async("text");
  if (!xml) return [];
  const styles = parseXml(xml, parser);
  const customFormats = new Map(
    Array.from(styles.getElementsByTagNameNS("*", "numFmt")).map((format) => [
      format.getAttribute("numFmtId"),
      format.getAttribute("formatCode"),
    ]),
  );
  // Built-in formats that change how a raw value must be read. Dates drive
  // normalization; percent formats prove a stored fraction is a percentage.
  // Every other built-in stays unrecognized so its number format is never
  // guessed from the display.
  const builtinFormats: Record<string, string> = {
    "9": "0%",
    "10": "0.00%",
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
  return Array.from(styles.getElementsByTagNameNS("*", "cellXfs")[0]?.getElementsByTagNameNS("*", "xf") ?? [])
    .map((style) => {
      const id = style.getAttribute("numFmtId");
      const format = customFormats.get(id ?? "") ?? builtinFormats[id ?? ""];
      return {
        format,
        date: Boolean(format && /[yd]/i.test(format.replace(/"[^"]*"|\[[^\]]*\]/g, ""))),
      };
    });
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
      relationships.getElementsByTagNameNS("*", "Relationship"),
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

  const sheets = Array.from(workbook.getElementsByTagNameNS("*", "sheet"))
    .map((sheet, index) => ({
      name: sheet.getAttribute("name") || `Sheet ${index + 1}`,
      path:
        pathsById.get(
          sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ??
          sheet.getAttributeNS("http://purl.oclc.org/ooxml/officeDocument/relationships", "id") ?? "",
        ) ??
        `xl/worksheets/sheet${index + 1}.xml`,
    }));
  const date1904 = ["1", "true"].includes(
    workbook.getElementsByTagNameNS("*", "workbookPr")[0]?.getAttribute("date1904")?.toLowerCase() ?? "",
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
): WorkbookCell {
  const type = cell.getAttribute("t");
  const valueNode = cell.getElementsByTagNameNS("*", "v")[0] ?? null;
  const rawValue = valueNode?.textContent ?? "";
  const formulaNode = cell.getElementsByTagNameNS("*", "f")[0] ?? null;
  const formula = formulaNode?.textContent ?? "";
  const value = type === "s" ? sharedStrings[Number(rawValue)] ?? ""
    : type === "inlineStr" ? elementText(cell, "t")
    : type === "b" ? rawValue === "1" ? "TRUE" : "FALSE"
    : rawValue;
  const format = numberFormats[Number(cell.getAttribute("s"))];
  const formulaCache = classifyFormulaCache(Boolean(formulaNode), type, valueNode, rawValue);
  return {
    reference: cell.getAttribute("r") ?? "",
    value,
    formula,
    numberFormat: format?.format,
    dateFormat: format?.date ?? false,
    textual: ["s", "inlineStr", "str"].includes(type ?? "") || type === "b",
    ...formulaCache,
  };
}

// Conservative deterministic ambiguity diagnostics. One indicator alone does not
// force an LLM call; the parser keeps the raw block and flags the group so the
// bounded group-extraction path may treat it as a candidate interpretation only.
type AmbiguityReason =
  | "multi_row_header"
  | "merged_header"
  | "key_value_shape"
  | "date_period_columns"
  | "duplicate_header"
  | "non_square_header"
  | "unresolved_formula_columns"
  | "inconsistent_cell_types";

const AMBIGUITY_PERIOD_PATTERN = /(week|month|quarter|period|w\d+|m\d+|q\d+|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
// Formula cache problems remain review diagnostics, not candidate triggers.
const AMBIGUITY_TRIGGER_REASONS: Partial<Record<AmbiguityReason, true>> = {
  multi_row_header: true,
  key_value_shape: true,
  date_period_columns: true,
  duplicate_header: true,
  non_square_header: true,
  inconsistent_cell_types: true,
};

function diagnoseTableAmbiguity(
  sheetName: string,
  tableRows: { number: number; cells: WorkbookCell[] }[],
  headerCount: number,
  merges: string[],
  headerLabels: string[],
): string[] {
  const reasons = new Set<AmbiguityReason>();
  const headerRows = tableRows.slice(0, headerCount);
  const dataRows = tableRows.slice(headerCount);
  const headerColumns = new Set<number>();
  for (const row of headerRows) {
    for (const cell of row.cells) {
      const column = columnNumber(cell.reference);
      if (column) headerColumns.add(column);
    }
  }
  const dataColumns = new Set<number>();
  for (const row of dataRows) {
    for (const cell of row.cells) {
      const column = columnNumber(cell.reference);
      if (column) dataColumns.add(column);
    }
  }

  if (headerCount > 1) {
    const firstColumns = new Set(headerRows[0].cells.map((cell) => columnNumber(cell.reference)));
    if (headerRows.slice(1).some((row) => {
      const columns = new Set(row.cells.map((cell) => columnNumber(cell.reference)));
      return columns.size !== firstColumns.size || [...columns].some((column) => !firstColumns.has(column));
    })) reasons.add("multi_row_header");
  }
  if (merges.length && headerRows.some((row) => row.cells.some((cell) =>
    merges.some((merge) => merge.split(":")[0] === cell.reference),
  ))) reasons.add("merged_header");
  if (dataRows.length && dataRows.every((row) => row.cells.length <= 1)) reasons.add("key_value_shape");
  if (headerLabels.filter((label) => AMBIGUITY_PERIOD_PATTERN.test(label)).length > 1) reasons.add("date_period_columns");
  const mergeCovers = (reference: string, merge: string) => {
    const [start, end] = merge.split(":");
    const referenceColumn = columnNumber(reference);
    const startColumn = columnNumber(start ?? "");
    const endColumn = columnNumber(end ?? "");
    const referenceRow = Number(reference.match(/\d+$/)?.[0]);
    const startRow = Number(start?.match(/\d+$/)?.[0]);
    const endRow = Number(end?.match(/\d+$/)?.[0]);
    return referenceColumn !== null &&
      startColumn !== null &&
      endColumn !== null &&
      referenceRow >= startRow &&
      referenceRow <= endRow &&
      referenceColumn >= Math.min(startColumn, endColumn) &&
      referenceColumn <= Math.max(startColumn, endColumn);
  };
  for (const row of headerRows) {
    const referencesByLabel = new Map<string, string[]>();
    for (const cell of row.cells) {
      const label = cell.value.trim().toLocaleLowerCase();
      if (!label) continue;
      const references = referencesByLabel.get(label) ?? [];
      references.push(cell.reference);
      referencesByLabel.set(label, references);
    }
    const duplicated = [...referencesByLabel.values()].some(
      (references) =>
        references.length > 1 &&
        // One merged header legitimately repeats the same value across its own
        // range; repeating it in unrelated columns is an ambiguous mapping.
        !merges.some((merge) => references.every((reference) => mergeCovers(reference, merge))),
    );
    if (duplicated) {
      reasons.add("duplicate_header");
      break;
    }
  }
  if (headerColumns.size > 0 && dataColumns.size > 0 && ![...dataColumns].every((column) => headerColumns.has(column))) {
    reasons.add("non_square_header");
  }
  const dataTypesByColumn = new Map<number, Set<string>>();
  for (const row of dataRows) {
    for (const cell of row.cells) {
      if (["missing_cache", "cached_empty", "cached_error", "unknown"].includes(cell.formulaCacheStatus)) continue;
      const column = columnNumber(cell.reference);
      if (!column) continue;
      const type = cell.formulaCacheStatus === "cached_value"
        ? cell.formulaCacheType ?? "unknown"
        : cell.textual ? "text" : "number";
      const types = dataTypesByColumn.get(column) ?? new Set<string>();
      types.add(type);
      dataTypesByColumn.set(column, types);
    }
  }
  if ([...dataTypesByColumn.values()].some((types) => types.size > 1)) reasons.add("inconsistent_cell_types");
  const unresolvedColumns = new Set<number>();
  for (const row of dataRows) {
    for (const cell of row.cells) {
      if (["missing_cache", "cached_empty", "cached_error", "unknown"].includes(cell.formulaCacheStatus)) {
        const column = columnNumber(cell.reference);
        if (column) unresolvedColumns.add(column);
      }
    }
  }
  if (unresolvedColumns.size) reasons.add("unresolved_formula_columns");

  if (!reasons.size) return [];
  const rowStart = tableRows[0].number;
  const rowEnd = tableRows[tableRows.length - 1].number;
  const cellRangeStart = tableRows[0].cells[0]?.reference ?? "";
  const cellRangeEnd = tableRows[tableRows.length - 1].cells[tableRows[tableRows.length - 1].cells.length - 1]?.reference ?? "";
  const triggers = [...reasons].filter((reason) => AMBIGUITY_TRIGGER_REASONS[reason] === true);
  if (!triggers.length) return [];
  return [`Sheet "${sheetName}" table rows ${rowStart}-${rowEnd} (${cellRangeStart}-${cellRangeEnd}) has candidate ambiguity indicators: ${triggers.join(", ")}; row/column mapping is kept as raw evidence and may need a candidate interpretation review.`];
}

// Layout drift: a table can declare one header and then stop following it. A
// real procurement workbook drifted mid-table, so prices landed in text
// columns (Satuan, Spesifikasi) while the header kept claiming those columns
// were units and specifications. A drifted row's column role is unprovable:
// rendering it with header labels would feed the model an attribution the
// worker cannot prove, and every extraction group on that table fails closed.
// Instead, drifted rows are detected per row and rendered without column-role
// labels - their values stay visible as raw, unattributed evidence and a
// layout_drift warning surfaces the table for review. Detection is
// conservative: the column-class profile is anchored on the data rows closest
// to the header (the rows the header was written for), a labelled column whose
// anchor cells hold no non-empty value is a wildcard, unresolved formula
// caches are skipped the way ambiguity diagnostics skip them, and an anchor
// that cannot agree with its own profile disables detection for the table.
const LAYOUT_DRIFT_ANCHOR_ROWS = 3;
const LAYOUT_DRIFT_MIN_DATA_ROWS = 3;
const LAYOUT_DRIFT_MIN_PROFILED_COLUMNS = 2;
const LAYOUT_DRIFT_MIN_CONFLICTS = 2;
// A currency/percent/thousands-formatted number inside a text-profiled column
// is the strongest drift signature (a price in a unit or specification column).
const CURRENCY_LIKE_NUMBER_FORMAT = /(?:rp|idr|usd|eur|sgd|myr|[$€£%])|#,##/i;

type LayoutDriftCellClass = "empty" | "text" | "number" | "date";

function layoutDriftCellClass(cell: WorkbookCell): LayoutDriftCellClass {
  if (
    cell.formulaCacheStatus === "cached_error" ||
    cell.formulaCacheType === "error" ||
    ["missing_cache", "cached_empty", "unknown"].includes(cell.formulaCacheStatus)
  ) return "empty";
  if (cell.dateFormat) return "date";
  if (cell.formulaCacheStatus === "cached_value") {
    if (cell.formulaCacheType === "number") return "number";
    return cell.formulaCacheType === "string" || cell.formulaCacheType === "boolean" ? "text" : "empty";
  }
  if (!cell.value.trim()) return "empty";
  return cell.textual ? "text" : "number";
}

function layoutDriftConflictScore(
  cells: WorkbookCell[],
  profile: Map<number, LayoutDriftCellClass>,
): number {
  let score = 0;
  for (const cell of cells) {
    const column = columnNumber(cell.reference);
    if (!column) continue;
    const expected = profile.get(column);
    if (!expected) continue;
    const actual = layoutDriftCellClass(cell);
    if (actual === "empty" || actual === expected) continue;
    // Calendar structure is not column-role evidence: week/Gantt columns
    // legitimately mix dates, notes, and empty cells, and a wrong date claim
    // is already refused fail-closed by the record-date gates. Date-profiled
    // columns are wildcards and date-valued cells never conflict.
    if (actual === "date" || expected === "date") continue;
    score += actual === "number" &&
      expected === "text" &&
      CURRENCY_LIKE_NUMBER_FORMAT.test(cell.numberFormat ?? "")
      ? 2
      : 1;
  }
  return score;
}

function detectLayoutDriftRows(
  sheetName: string,
  tableRows: { number: number; cells: WorkbookCell[] }[],
  headerCount: number,
  headers: Map<number, string>,
): { driftRows: Set<number>; warning: string | null } {
  const driftRows = new Set<number>();
  if (headers.size < LAYOUT_DRIFT_MIN_PROFILED_COLUMNS) return { driftRows, warning: null };
  // A title banner repeated across every column declares no per-column roles
  // (a real Gantt title row labels A1:DI1 with one project title), so no row
  // can drift against it - ordinary grid variety would be flagged instead.
  // Ambiguity diagnostics already surface such headers for review.
  if (new Set(headers.values()).size < 2) return { driftRows, warning: null };
  const dataRows = tableRows.slice(headerCount);
  if (dataRows.length < LAYOUT_DRIFT_MIN_DATA_ROWS) return { driftRows, warning: null };

  // Profile: per labelled column, the modal cell class across the anchor rows;
  // ties resolve toward the class encountered first, i.e. the row closest to
  // the header. Only labelled columns are profiled - the declared layout is
  // exactly what the header claims, and cells in unlabelled columns carry no
  // column role to protect in the first place.
  const anchorRows = dataRows.slice(0, Math.min(LAYOUT_DRIFT_ANCHOR_ROWS, dataRows.length));
  const classVotes = new Map<number, Map<LayoutDriftCellClass, number>>();
  for (const row of anchorRows) {
    for (const cell of row.cells) {
      const column = columnNumber(cell.reference);
      if (!column || !headers.has(column)) continue;
      const value = layoutDriftCellClass(cell);
      if (value === "empty") continue;
      const votes = classVotes.get(column) ?? new Map<LayoutDriftCellClass, number>();
      votes.set(value, (votes.get(value) ?? 0) + 1);
      classVotes.set(column, votes);
    }
  }
  const profile = new Map<number, LayoutDriftCellClass>();
  for (const [column, votes] of classVotes) {
    let best: LayoutDriftCellClass | undefined;
    let bestCount = 0;
    for (const [value, count] of votes) {
      if (count > bestCount) {
        best = value;
        bestCount = count;
      }
    }
    if (best) profile.set(column, best);
  }
  if (profile.size < LAYOUT_DRIFT_MIN_PROFILED_COLUMNS) return { driftRows, warning: null };

  // Anchor rows that disagree with their own profile mean the header-adjacent
  // rows do not share one layout; detection stays off for this table.
  for (const row of anchorRows) {
    if (layoutDriftConflictScore(row.cells, profile) >= LAYOUT_DRIFT_MIN_CONFLICTS) {
      return { driftRows, warning: null };
    }
  }

  for (const row of dataRows) {
    if (layoutDriftConflictScore(row.cells, profile) >= LAYOUT_DRIFT_MIN_CONFLICTS) {
      driftRows.add(row.number);
    }
  }
  if (!driftRows.size) return { driftRows, warning: null };

  const driftedRowNumbers = [...driftRows].sort((left, right) => left - right);
  const rowRanges: string[] = [];
  let runStart = driftedRowNumbers[0];
  let previous = runStart;
  for (const rowNumber of driftedRowNumbers.slice(1)) {
    if (rowNumber === previous + 1) {
      previous = rowNumber;
      continue;
    }
    rowRanges.push(runStart === previous ? `${runStart}` : `${runStart}-${previous}`);
    runStart = rowNumber;
    previous = rowNumber;
  }
  rowRanges.push(runStart === previous ? `${runStart}` : `${runStart}-${previous}`);
  const driftedRowByNumber = new Map(dataRows.map((row) => [row.number, row]));
  const firstDrifted = driftedRowByNumber.get(driftedRowNumbers[0])!;
  const lastDrifted = driftedRowByNumber.get(driftedRowNumbers[driftedRowNumbers.length - 1])!;
  const cellRangeStart = firstDrifted.cells[0]?.reference ?? "";
  const cellRangeEnd = lastDrifted.cells[lastDrifted.cells.length - 1]?.reference ?? "";
  return {
    driftRows,
    warning:
      `Sheet "${sheetName}" table rows ${rowRanges.join(", ")} (${cellRangeStart}-${cellRangeEnd}) has layout drift indicators (layout_drift): ${driftRows.size} ${driftRows.size === 1 ? "row no longer matches" : "rows no longer match"} the declared header columns; their values are kept as raw unattributed evidence without column-role labels and may need a review.`,
  };
}
