export type ParsedSourceLocation = Record<string, string | number>;

// One spreadsheet cell's structural identity: its exact cell, the column label
// from the table header, the readable value, and the normalized date when the
// cell is date-formatted. The worker proves a value's or date's column from this
// metadata instead of trusting where a fragment sits in row text.
export type ParsedSourceCell = {
  sheetName: string;
  row: number;
  column: string;
  cell: string;
  label: string | null;
  value: string;
  rawValue: string;
  dateIso: string | null;
};

export type ParsedSourceReference = {
  sourceId: string;
  chunkIndex: number;
  text: string;
  modelText: string;
  sourceLocation?: ParsedSourceLocation;
  cell?: ParsedSourceCell;
  rowCells?: ParsedSourceCell[];
};

export type ParsedChunk = {
  chunkIndex: number;
  chunkText: string;
  pageNumber?: number;
  sectionLabel?: string;
  sourceLocation?: ParsedSourceLocation;
  sourceReferences?: ParsedSourceReference[];
  formulaCells?: FormulaCell[];
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

// One spreadsheet cell's own evidence: label context, exact cell locator, and
// the cell's literal text. A formula cell keeps its formula/cache disclaimer, so
// a cell reference never presents a formula as a literal value.
export type SourceCellReference = {
  text: string;
  modelText: string;
  location: ParsedSourceLocation;
  cell?: ParsedSourceCell;
};

export type SourceBlock = {
  text: string;
  kind: "heading" | "paragraph" | "table-header" | "table-row";
  location: ParsedSourceLocation;
  groupKey?: string;
  sectionLabel?: string;
  continuation?: string;
  modelText?: string;
  formulaCells?: FormulaCell[];
  cellReferences?: SourceCellReference[];
  rowCells?: ParsedSourceCell[];
};

export type FormulaCell = {
  sheetName: string;
  cellReference: string;
  formula: string;
  formulaCacheStatus: FormulaCacheStatus;
  formulaCacheType: WorkbookCell["formulaCacheType"];
  formulaCacheRaw: string | null;
  cacheProvenance: "stored_cached_result" | null;
  rowStart: number;
  rowEnd: number;
};

export type FormulaCacheStatus =
  | "not_formula"
  | "cached_value"
  | "cached_empty"
  | "missing_cache"
  | "cached_error"
  | "unknown";

export type WorkbookCell = {
  reference: string;
  value: string;
  formula: string;
  numberFormat?: string;
  dateFormat: boolean;
  textual: boolean;
  formulaCacheStatus: FormulaCacheStatus;
  formulaCacheType: "number" | "string" | "boolean" | "error" | null;
  formulaCacheRaw: string | null;
};

export type ZipTextReader = {
  file(path: string): { async(type: "text"): Promise<string> } | null;
  files: Record<string, unknown>;
};
