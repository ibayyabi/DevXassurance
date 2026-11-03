const numberPattern = /-?\d+(?:[.,]\d+)+|-?\d+/g;

function numericCandidates(token: string): number[] {
  const normalized = token.includes(",") && token.includes(".")
    ? token.lastIndexOf(",") > token.lastIndexOf(".")
      ? token.replace(/\./g, "").replace(",", ".")
      : token.replace(/,/g, "")
    : /^-?\d{1,3}([.,]\d{3})+$/.test(token)
      ? token.replace(/[.,]/g, "")
      : token.replace(",", ".");
  const value = Number(normalized);
  if (!Number.isFinite(value)) return [];
  return [...new Set([value])];
}

function unitAt(text: string, start: number, end: number): string | null {
  const before = text.slice(Math.max(0, start - 16), start);
  const after = text.slice(end, end + 24);
  const currency = before.match(/(?:\b(?:IDR|Rp\.?|USD|EUR|GBP|JPY|CNY|AUD|CAD|CHF|INR)\s*|[$€£¥]\s*)$/i)?.[0]
    ?? after.match(/^\s*(?:IDR|Rp\.?|USD|EUR|GBP|JPY|CNY|AUD|CAD|CHF|INR)(?![A-Za-z])/i)?.[0];
  if (currency) {
    const key = currency.trim().replace(/\./g, "").toUpperCase();
    return key === "RP" ? "IDR" : key;
  }
  const suffix = after.match(/^\s*(%|percent(?:age)?|persen|bps|basis\s+points?|days?|hari|weeks?|minggu|months?|bulan|years?|tahun|km|cm|mm|m²|m2|meters?|metres?|kg|g|tons?|liter|litre|liters|litres)(?![A-Za-z])/i)?.[1];
  if (!suffix) return null;
  const key = suffix.toLowerCase().replace(/\s+/g, " ");
  if (["%", "percent", "percentage", "persen"].includes(key)) return "percent";
  if (["bps", "basis point", "basis points"].includes(key)) return "basis-point";
  if (["day", "days", "hari"].includes(key)) return "day";
  if (["week", "weeks", "minggu"].includes(key)) return "week";
  if (["month", "months", "bulan"].includes(key)) return "month";
  if (["year", "years", "tahun"].includes(key)) return "year";
  if (["meter", "meters", "metre", "metres", "m2", "m²"].includes(key)) return key === "m2" || key === "m²" ? "m²" : "m";
  if (["liter", "litre", "liters", "litres"].includes(key)) return "L";
  if (key === "tons") return "ton";
  return key;
}

function numberTokens(text: string) {
  return [...text.matchAll(numberPattern)].map((match) => {
    const start = match.index!;
    const end = start + match[0].length;
    const formatRawValue = text.slice(end).match(/^\s*\[\s*raw value:\s*([^;]+);\s*number format:\s*[^;\]]*%/i)?.[1];
    const renderedRawPercent = formatRawValue !== undefined &&
      numericCandidates(match[0]).some((value) => numericCandidates(formatRawValue).includes(value));
    const rawPercent = renderedRawPercent ||
      (/\braw value:\s*$/i.test(text.slice(Math.max(0, start - 24), start)) &&
        /\bnumber format:\s*[^;\]]*%/i.test(text.slice(end, end + 48)));
    return {
      value: match[0],
      unit: rawPercent ? "percent" : unitAt(text, start, end),
      scale: rawPercent ? 100 : 1,
    };
  });
}

export function containsNumericValue(text: string): boolean {
  return numberTokens(text).length > 0;
}

export function citedTextSupportsNumericValue(valueText: string, citedText: string): boolean {
  const values = numberTokens(valueText);
  if (!values.length) return true;
  const sourceText = citedText.split(" | ").filter((segment) =>
    !/;\s*formula cache:\s*(?:missing_cache|cached_empty|cached_error|unknown)\b/i.test(segment),
  ).join(" | ");
  const citedValues = numberTokens(sourceText);
  if (!citedValues.length) return false;

  return values.every((value) => citedValues.some((cited) =>
    value.unit === cited.unit && numericCandidates(value.value).some((candidate) =>
      numericCandidates(cited.value).some((citedCandidate) => {
        const left = candidate * value.scale;
        const right = citedCandidate * cited.scale;
        return Math.abs(left - right) <= Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 4;
      }),
    ),
  ));
}
