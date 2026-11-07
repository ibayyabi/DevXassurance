# Handoff: layout-drift table in a real PMO workbook (blocks cost extraction)

**From:** LLM-optimization stream (`opencode-go-experiment`)
**To:** parser stream owner (`parser/document-22`)
**Evidence file:** `DOKUMEN ASLI/Pengajuan Pembelian Hardware 2 Oktober 2026_bahasan meeting 16oct.xlsx` (real PMO document, committed to the working tree, not tracked in git)
**Live-run artifacts:** `.local-evaluation/final-testing/live-asli-cost/` (two gated attempts, full ledgers)

## The concrete case

Sheet **Master Hardware** (sheet1, 33 non-empty rows) declares a 10-column header at row 1:

```
A=Kode Komponen | B=Nama Komponen | C=PIC | D=Kode Hardware | E=No. Hardware |
F=Nama Hardware | G=Spesifikasi | H=Qty | I=Satuan | J=Asal
```

Rows 2–4 follow this layout. **From row 5 the row layout drifts** — fields shift into the wrong columns (verbatim from the sheet XML, read independently of the pipeline parser):

| Row | Header says A=Kode Komponen, but A5 = | Header says I=Satuan, but I5 = |
|---|---|---|
| 5 | `Kamera Pengawasan` (component *name*) | `2,357,276.00` (a *price*) |
| 6 | `Kamera Pengawasan` | — (price `11,950,000.00` sits in G6 "Spesifikasi") |

So the table declares one schema and its rows follow (at least) two different implicit layouts, with no separator row. This matches the open "headerless tables" class you flagged, with the twist that a header exists — it is the **row layout** that stops matching it.

## How it fails downstream (measured, not assumed)

Through the full production pipeline (extraction schema `/43`, parser `/22`, live `glm-5.3-flash`, two gated attempts totaling ~565k tokens, artifacts preserved):

- 8 chunk groups; group prompts 29k–41k chars (~7–10k input tokens each — the densest family measured so far)
- **All 8 groups fail closed** in both attempts, including after the one-request correction loop. No fabricated values ever publish (the fail-closed validator holds), so the cost domain on this real document yields a silent gap.
- The exact first-attempt validator rejection strings were not captured (only run-level lastError); a cheap capture re-run can recover them if you want them for your baseline harness.

Why the model cannot win here: the drift means a value's column role is unprovable. When the model attributes `2,357,276.00` to any semantic column, the evidence does not support the attribution, and the validator correctly refuses. Prompt iteration was already tried (verbatim-value rules, milestone role rules in `/43`) and is insufficient — this is structural.

## What the extraction layer needs from a fix

Whatever the parser decides, the downstream contract needs one of:

1. **Column roles proven** (as today) for rows that match their header — current behavior, keep, or
2. **Rows explicitly marked "layout drift / no column attribution"**: render the raw cells to the model without column-role labels, plus a parser warning (surfaced to review). The model may then read values as unattributed evidence; the validator will keep refusing column-role claims on those rows — the data stays visible, the semantics stay honest.

What would break the contract: silently re-inferring column meanings (e.g., "I-column with a 7-digit number is probably a price") and feeding the model the inferred roles as proven. That converts a guess into a validated-looking claim.

## Suggested direction (your call as owner)

The conservative option that fits the architecture: **detect layout drift per row** (value-type pattern vs the header's declared columns — e.g., the "Satuan" column suddenly carrying a 7-digit number across consecutive rows), then render those rows without column-role labels and emit a `layout_drift` parser warning. Your `tools/xlsx-parser-baseline/` harness plus this real file are exactly the rig to develop and verify it; expect a `PARSER_VERSION` bump and one extraction schema note on my side (group keys re-partition automatically since they bind chunk texts).

## Re-verification I will run after your fix (offline except the last)

1. Full integration suite (315+ tests) + tsc + lint
2. Both corpus sweeps (30 real files + 48 fixture workbooks) — deterministic derivation counts must hold
3. A live gate on this Pengajuan file (~300k tokens, budgeted separately) to prove cost observations finally publish and survive the validator

Artifacts: my two attempt ledgers live in `.local-evaluation/final-testing/live-asli-cost/`; the raw-XML drift dump method is in `.scratch/opencode-go-experiment/` (python probes).
