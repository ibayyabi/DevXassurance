# Worker

The worker validates file signatures/content, then parses PDF, DOCX, XLSX, PPTX, CSV, TXT, and common image evidence into bounded, source-located chunks. Office and slide tables preserve their row structure; chunks retain page, sheet/row/range, slide, paragraph, or image locations in `document_chunks.parser_metadata` alongside parser version and warnings.

XLSX formula cells keep the formula, cache status, raw cached result/type, and sheet/cell locator in per-chunk `parser_metadata`; the worker never recalculates formulas. Stored caches are not freshness proof, and missing, empty, error, or unknown results require review. Unresolved formula rows cannot support extracted facts, alerts, actions, group metadata, or health status. Ambiguous worksheet groups may include a candidate-only interpretation in the existing bounded extraction request; its header, column, and observation citations resolve to parser-authored ranges and never become an approved mapping.

Image OCR uses local PP-OCRv6 tiny (RapidOCR 3.10.0 on ONNX Runtime CPU 1.31.0); scanned-PDF OCR adds Ghostscript rasterization. The configured PP-OCRv6 route is `id` for Indonesian/English text; it is fixed configuration, not language detection. Indonesian/English quality must pass the human-verified corpus before production. Missing local model assets return `ocr_model_unavailable`, and unreadable scans return `ocr_no_text`; every OCR failure fails the whole document instead of producing successful empty extraction. All scanned page images for one document go to one helper process and one engine initialization.

Local setup (localhost pilot, Python 3.11, macOS/Linux):

```bash
python3.11 -m venv .venv-ocr
.venv-ocr/bin/pip install -r worker/ocr/requirements.txt
.venv-ocr/bin/python worker/ocr/ppocr.py --prefetch
.venv-ocr/bin/python worker/ocr/ppocr.py --check
```

`--prefetch` downloads the pinned assets once and verifies their SHA-256; `--check` verifies local assets and confirms the pinned RapidOCR/ONNX Runtime package versions. JSON helper output records installed runtime versions and model hashes. The request path never downloads models and never falls back to Tesseract. Pinned assets: `PP-OCRv6_det_tiny.onnx` (`f42c0fbd294d95eac1a550e131b277dac97462c8025fa4b6c3cec1b7894bd3d5`), `PP-OCRv6_rec_tiny.onnx` (`e16e242de5937ad92609223f19bc2aff3727ee40b095f996907c24749bad251b`), and `ch_ppocr_mobile_v2.0_cls_mobile.onnx` (`e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c`).

Set `XASS_OCR_PYTHON` to override the interpreter (default `.venv-ocr/bin/python`) and `XASS_OCR_MODEL_DIR` to override the asset directory (default RapidOCR's package `models` directory). Ghostscript is required for scanned PDFs. PP-OCRv6 tiny is the localhost pilot only. Before future VPS deployment, verify text quality, CPU throughput, and memory against that host's actual limits; a model-size change additionally requires the tiny/small quality gate.

Per-document extraction starts with one document-level classifier call using the internal title, filename, parser metadata, workbook sheet names, and up to 12 bounded source references. It returns one primary artifact type plus an evidence role (`baseline`, `current`, or `supporting`); taxonomy guidance distinguishes periodic progress reports from plans, schedules, and embedded risk registers. A material filename/content mismatch is surfaced as a quality warning without overriding the content-based class. Classifications below 0.7 confidence, missing roles, invalid citations, or conflicting intake hints require review. Group extraction then handles facts and summaries; groups may suggest document date, reporting period, and workstream only, so disagreement there cannot erase the document-level artifact class. The model receives compact source references and returns source IDs; the worker resolves each ID to the exact canonical chunk excerpt and global chunk index before persistence. Summaries cite relevant sources rather than copying quotations or citing every row. Invalid optional fact rows trigger one same-model correction and, if still invalid, produce an explicit quality warning and `needs_review` rather than discarding independent valid outputs. The service-role-only `document_extraction_groups` key binds content, parser/schema versions, and chunk range; only completed exact-key groups are reused. Stored intake hints are loaded with a project-and-document-scoped lookup; AI writes suggestions only, never reviewer-confirmed values. n8n remains the queue/orchestrator and persistence path.
Quality-warning groups remain available to the current response for review but are checkpointed without a reusable result; retries re-extract them.
Checkpoint writes, lease renewals, downloads, and total worker processing log stage timings and outcomes with safe correlation IDs; database error details are not logged.
Parser, classifier, and per-group attempt timings are logged with job, project, and document IDs; group logs also include the group index and attempt number. Logs never include filenames, prompts, source text, model outputs, or credentials.


The same group request also collects PMO cost evidence, whatever the document's primary type: an approved baseline amount, actual cost to date, committed cost, and an explicitly reported estimate at completion, each at project or work-package scope. No separate call or per-domain call is added. The model copies the source value exactly and cites a source ID; it never converts, totals, or compares. The worker rejects a value that is not present in its cited source, derives `normalized_amount` and `currency` deterministically from the source wording, and leaves both null when the wording is ambiguous (a scale word such as "million", a bare `$`, or an inconsistent separator layout). Normalization supplements the source value and never replaces it. Validated observations are persisted to `cost_observations` with the chunk index, a bounded excerpt, and the chunk's page/sheet location; a re-run replaces that document's rows. Accepting a baseline for comparison is a separate reviewer decision recorded in `cost_baselines`.

The grouped extraction path runs on a free provider. Local Ollama (`XASS_LLM_PROVIDER=ollama`) is the default: free, no quota, and evidence stays on the machine. The free Ollama Cloud tier (`ollama_cloud`) is the hosted alternative and is where a quota can be reached. A quota or rate-limit response (HTTP 429, like 408 and 5xx) is a transient provider failure: the group is checkpointed as not processed with its attempt count and error, the job stays retryable, and completed groups keep their reusable cached result. A later retry re-sends only the groups that never completed. Deferred groups never become absent evidence, because the document does not reach a completed state until every group has a validated result.

The per-document extraction ceiling is 32 groups (at most 96 parser chunks or about 320,000 source characters). Larger documents fail with an actionable Needs Review error; the original file is retained and later chunks are never silently dropped. Each group summary cites one or more relevant source IDs; citation coverage for every chunk is not required. Invalid required evidence remains an explicit quality warning, never a complete high-confidence fallback.

PDF parsing is bounded to 200 pages, 64,000 extracted characters per page, and 320,000 characters total. Scanned-page OCR is limited to 20 pages per PDF. A breached limit fails the document rather than truncating it. Office ZIP packages are checked before XML expansion and limited to 25 MiB per member and 100 MiB total expanded content.

## Standalone local parser evaluation

From the repository root, run:

```bash
node tools/document-parser-eval.mjs
```

The runner calls `parseDocumentBuffer()` directly; it needs no application login, server, or database. It evaluates two selected PDFs and three representative XLSX workbooks from `SMART BUILDING/`, then rasterizes page 1 of `Komponen Wajib BGC.pdf` at 160 DPI to exercise the production PP-OCRv6 image route. Original PDF results report whether their pages also used OCR.

Requires installed Node dependencies, the local PP-OCRv6 setup above, and Ghostscript. Results go to `.local-evaluation/document-parser/`: `summary.json` contains parser versions, counts, warnings, OCR metadata, formula-cache statuses, and limits; each other JSON file contains full extracted chunks for manual review. Override the destination with `--output-dir PATH`. The output includes source text, stays local, and is git-ignored; treat it as sensitive.

This is a review harness, not an accuracy score: no ground-truth transcripts are supplied. Check OCR text and table reconstruction against the PDFs. XLSX formulas are not recalculated; cached values may be stale, and parser warnings require inspection. Any failed parse or OCR route exits non-zero.
