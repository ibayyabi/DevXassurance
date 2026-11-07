import type {
  ParsedChunk,
  ParsedSourceLocation,
  ParsedSourceReference,
  SourceBlock,
  SourceCellReference,
} from "./types";

const MAX_CHUNK_LENGTH = 4000;
// Growth ceiling per chunk: retained row references always fit, then cell
// references are added row by row. Cells left uncovered stay citable through
// their row reference, which keeps the conservative row+column guard in play.
// ponytail: fixed cap; make it adaptive per group if prompt size ever binds.
const MAX_SOURCE_REFERENCES_PER_CHUNK = 120;
const PARAGRAPH_OVERLAP = 160;
const CHUNK_CONTEXT_BUDGET = 900;
const MAX_SOURCE_BLOCK_PART_LENGTH = MAX_CHUNK_LENGTH - CHUNK_CONTEXT_BUDGET;

export function chunkSourceBlocks(blocks: SourceBlock[]): ParsedChunk[] {
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

  // Row references are mandatory for provenance, so the per-chunk budget must
  // be checked before adding a block; otherwise many retained row references
  // could grow a chunk past the reference cap. A block that is itself wider
  // than the remaining budget starts a fresh chunk instead of losing rows.
  const referenceCount = () =>
    sourceBlocks.reduce(
      (count, block) => count + 1 + (block.cellReferences?.length ?? 0),
      0,
    );
  const flush = () => {
    if (!text || !sourceBlocks.length) return;
    const sourceLocation = mergeSourceLocations(sourceBlocks);
    const sourceReferences: ParsedSourceReference[] = [];
    const addReference = (
      reference: Pick<
        ParsedSourceReference,
        "text" | "modelText" | "sourceLocation" | "cell" | "rowCells"
      >,
    ) => {
      sourceReferences.push({
        sourceId: `s${chunks.length}s${sourceReferences.length}`,
        chunkIndex: chunks.length,
        ...reference,
      });
    };
    for (const block of sourceBlocks) {
      // The row/table reference is retained first so row-level relations and
      // range citations keep working; per-cell references follow.
      addReference({
        text: block.text,
        modelText: block.modelText ?? block.text,
        sourceLocation: block.location,
        rowCells: block.rowCells,
      });
      const cellReferences = block.cellReferences ?? [];
      if (sourceReferences.length + cellReferences.length > MAX_SOURCE_REFERENCES_PER_CHUNK) {
        continue;
      }
      for (const cell of cellReferences) {
        addReference({
          text: cell.text,
          modelText: cell.modelText,
          sourceLocation: cell.location,
          cell: cell.cell,
          rowCells: block.rowCells,
        });
      }
    }
    chunks.push({
      chunkIndex: chunks.length,
      chunkText: text.trim(),
      pageNumber:
        typeof sourceLocation.pageNumber === "number"
          ? sourceLocation.pageNumber
          : undefined,
      sectionLabel,
      sourceLocation,
      formulaCells: sourceBlocks.flatMap((block) => block.formulaCells ?? []),
      sourceReferences,
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

      if (
        text &&
        (
          addition.length > MAX_CHUNK_LENGTH ||
          referenceCount() + 1 + (part.cellReferences?.length ?? 0) > MAX_SOURCE_REFERENCES_PER_CHUNK
        )
      ) {
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

type SplitPartRange = { start: number; end: number };

// Splits long block text at cell boundaries when the block carries per-cell
// references, otherwise at word boundaries. Ranges are half-open offsets into
// the unsplit block text so each cell's own span can be assigned to exactly one
// part. A " | " is consumed only when it lies exactly between two located cell
// tokens; the same characters inside a cell's own text are literal content.
function splitBlockRanges(
  text: string,
  limit: number,
  cellSpans: ReadonlyArray<{ start: number; end: number }>,
): SplitPartRange[] {
  const separators = cellSpans.flatMap((span, index) => {
    const next = cellSpans[index + 1];
    return next && next.start === span.end + 3 && text.slice(span.end, next.start) === " | "
      ? [span.end]
      : [];
  });
  const ranges: SplitPartRange[] = [];
  let start = 0;
  while (start < text.length) {
    if (text.length - start <= limit) {
      ranges.push({ start, end: text.length });
      break;
    }
    const boundary = start + limit;
    let cut = -1;
    for (const separator of separators) {
      if (separator <= start) continue;
      if (separator > boundary) break;
      cut = separator;
    }
    let next = cut > start ? cut + 3 : -1;
    if (cut <= start) {
      cut = text.lastIndexOf(" ", boundary);
      next = cut > start ? cut + 1 : -1;
    }
    if (cut <= start) {
      cut = boundary;
      next = boundary;
    }
    ranges.push({ start, end: cut });
    start = next;
  }
  return ranges;
}

// Locates each cell's model-visible text once, in reference order. A duplicate
// token is matched at the next position, and a token that cannot be located is
// left out instead of being guessed.
function locateCellSpans(block: SourceBlock) {
  const spans = new Map<SourceCellReference, { start: number; end: number }>();
  let cursor = 0;
  for (const reference of block.cellReferences ?? []) {
    const token = reference.modelText;
    if (!token) continue;
    const index = block.text.indexOf(token, cursor);
    if (index === -1) continue;
    spans.set(reference, { start: index, end: index + token.length });
    cursor = index + token.length;
  }
  return spans;
}

function splitSourceBlock(block: SourceBlock): SourceBlock[] {
  if (block.text.length <= MAX_SOURCE_BLOCK_PART_LENGTH) return [block];

  const cellSpans = block.cellReferences?.length ? locateCellSpans(block) : new Map();
  const ranges = splitBlockRanges(
    block.text,
    MAX_SOURCE_BLOCK_PART_LENGTH,
    [...cellSpans.values()].sort((left, right) => left.start - right.start),
  );
  const parts: SourceBlock[] = [];
  let continuation = block.continuation;
  ranges.forEach((range, index) => {
    const text = block.text.slice(range.start, range.end).trim();
    if (!text) return;
    // A per-cell locator is retained only when the whole cell token lies inside
    // this part; a cell crossing the boundary stays row-level/review instead of
    // being attributed to a part that does not contain its evidence.
    const contained = (block.cellReferences ?? []).filter((reference) => {
      const span = cellSpans.get(reference);
      return span !== undefined && span.start >= range.start && span.end <= range.end;
    });
    const cellReferences: SourceCellReference[] | undefined = cellSpans.size
      ? contained.map((reference) => {
        const span = cellSpans.get(reference)!;
        const exactText = block.text.slice(span.start, span.end);
        return {
          text: exactText,
          modelText: reference.modelText,
          location: reference.location,
          cell: reference.cell,
        };
      })
      : undefined;
    const rowCells = cellSpans.size
      ? contained.flatMap((reference) => (reference.cell ? [reference.cell] : []))
      : undefined;
    parts.push({
      ...block,
      text,
      modelText: undefined,
      cellReferences,
      rowCells,
      continuation,
    });
    continuation =
      block.kind === "paragraph" && index < ranges.length - 1
        ? text.slice(-PARAGRAPH_OVERLAP)
        : undefined;
  });
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
