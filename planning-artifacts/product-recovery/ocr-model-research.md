# OCR engine research: local CPU options for XAss

**Research date:** 2026-10-20  
**Scope:** Local OCR alternatives to the worker's Tesseract CLI path, focusing on CPU-bound scanned project evidence in English and Bahasa Indonesia. This is a source-based shortlist, not a benchmark result.

## Executive recommendation

Keep tuned Tesseract as the control, and run a CPU pilot of **PP-OCRv6 tiny/small via RapidOCR's ONNX Runtime CPU backend** plus **PP-OCRv5 mobile** as a measured comparator. Current PaddleOCR/RapidOCR docs list PP-OCRv6 multilingual routes for both English (`en`) and Indonesian (`id`); the tiny and small models are compact on disk, but XAss runtime and memory are unmeasured. PP-OCRv5 publishes CPU module timings and has a Latin-script recognizer that explicitly lists Indonesian, but its English recognizer is separate. Neither vendor figures nor model size proves an accuracy or resource win over this worker. Measure the exact model, runtime and footprint on XAss's deployment target before selecting one.

For mixed English/Indonesian pages, PP-OCRv6 is the candidate with a documented multilingual route covering both languages. PP-OCRv5's English and Latin-script recognizers are separate; its Latin model's supported-language list does not list English, so assess them separately or test a deterministic routing strategy. Do not choose a recognizer per page using knowledge of ground truth. RapidOCR is an integration/runtime, not a separate recognition model.

Neither OCR candidate alone solves document layout or table reconstruction. The current parser treats OCR as page text and chunks paragraphs. If preserving table cell relationships is required, evaluate a separate layout/table stage or restrict claims to text transcription.

## Current XAss path and constraints

Repository behavior was checked in [`worker/src/services/document-parser.ts`](../../worker/src/services/document-parser.ts) and [`worker/README.md`](../../worker/README.md):

- `recognizeImage()` starts local `tesseract <image> stdout -l <configured-language>` with a 120-second timeout; `XASS_OCR_LANG` defaults to `eng`, and README documents `ind+eng` after installing both language files. Missing executable/language, read failures, and no-text conditions remain explicit errors rather than successful empty extraction.
- For PDFs, pdf.js extracts text per page. OCR runs only when the page has **no extracted text** and image operators are present. A mixed page with some selectable text plus scanned/image-only regions is therefore not OCRed: the parser accepts the native text branch and skips the image content. This is a coverage limitation to test, not a claim that every mixed page loses evidence.
- Ghostscript rasterizes OCR pages to PNG using `-r160`; Tesseract documentation recommends input DPI of at least 300 for best results. That mismatch is a plausible quality/latency trade-off worth measuring, not proof 160 DPI caused any particular error.
- There is no explicit preprocessing step in the Tesseract invocation or PDF raster route. Tesseract performs internal Leptonica processing, but its official guide notes that skew, resolution, binarization, noise, borders, and layout/segmentation can degrade results. Some external preprocessing could help; more processing can also add latency and damage information, so test it selectively.
- OCR is bounded to 20 scanned PDF pages; PDF text limits and failure behavior are already explicit. Page locators are preserved, but OCR provenance is hard-coded to `tesseract` in page metadata and image metadata. A migration must update those labels and preserve page/image location, warnings, resource limits, and failure-as-failure behavior.
- The observed session shell had Tesseract 5.5.3 / Leptonica 1.87.0 with NEON; `tesseract --list-langs` listed `eng`, `osd`, and `snum`, but not `ind`. This is a local environment observation, not proof every deployed worker lacks Indonesian data; the documented `ind+eng` setup needs confirmation in deployment.
- Existing OCR test coverage in [`tests/integration/phase6-document-parser.test.mjs`](../../tests/integration/phase6-document-parser.test.mjs#L56-L59) uses synthetic `OCR SOURCE 4821` content and checks substring presence, locators, configured language and missing-language handling (test block at lines 466–514). This is functional smoke coverage, not CER/WER, numeric fidelity, mixed-language, or table-accuracy evaluation, and it does not establish quality at production 160 DPI.

The available tests therefore establish basic OCR plumbing, not OCR quality.

Tesseract invocations omit a page segmentation option and use the executable's default (normally PSM 3); test candidate PSM settings as baseline tuning rather than model changes. Tesseract 5's official quality guide describes Adaptive Otsu and Sauvola binarization options.

 
## Candidates


| Candidate | Language fit / text scope | Footprint and CPU evidence | Operational shape / license | Assessment |
|---|---|---|---|---|
| **Tesseract, tuned (`tessdata_fast` vs `tessdata_best`)** | Official language data includes `eng` and `ind`. Supports OCR text; layout/segmentation remains engine-level rather than document table reconstruction. | Official data docs describe `fast` as fastest/smaller integer LSTM and `best` as slowest/most accurate on Google's evaluation data; exact files vary by language, and these are qualitative claims, not XAss results. Model files can be inspected/downloaded per language; do not treat full application install size as just traineddata. | Already deployed as an external local executable, no new Node runtime. `tessdata_fast` / `tessdata_best` model repositories and Tesseract engine use Apache-2.0; verify package/distribution composition in deployment. Tesseract's own guidance covers PSM, image preparation and table limitations. | **Keep as control and low-cost baseline.** First compare the faster `tessdata_fast` against `tessdata_best` for `eng+ind`, set suitable page segmentation only when content warrants it, and measure 300-DPI rendering. Low migration risk; may still perform poorly on particular layouts/scans. |
| **PaddleOCR PP-OCRv5 mobile + RapidOCR / ONNX Runtime CPU** | PaddleOCR lists `latin_PP-OCRv5_mobile_rec` for Indonesian and many other Latin-script languages, with 3,111 Latin-script recognition images but no Indonesian-only score. English uses a separate `en_PP-OCRv5_mobile_rec`; no joint English/Indonesian route is documented. Detector is separate; official PP-OCRv5 mobile detector is 4.7 MB and 79.0 H-mean on Paddle's stated evaluation. | Official Paddle tables list 14 MB for the Latin mobile recognizer, 21.20 ms CPU standard / 5.32 ms high-performance for recognition, and 57.77 / 28.15 ms for detector; Paddle states these are model inference times excluding pre/postprocessing. The CPU test platform is Intel Xeon Gold 6271C; its benchmarks should not be projected to XAss hardware or compared directly to Tesseract. Nominal detector+recognizer weight sum is about 18.7 MB, excluding runtime, labels/configuration, allocator, and intermediate tensors. No official peak-RAM figure found. | RapidOCR is Apache-2.0 at repository level; it offers local offline inference and several language bindings, but its Python package is the documented path and model licenses should be checked individually (`python/MODEL_LICENSES.md`). Use Python sidecar/process or implement direct ONNX Runtime integration in Node; neither is as drop-in as CLI Tesseract. RapidOCR docs explicitly route PP-OCRv5 Latin recognizer models to ONNX Runtime. | **Include as the PP-OCRv5 comparator.** Useful for Indonesian and has published CPU module measurements; English/Indonesian mixed-page quality and end-to-end resource cost remain unmeasured. Table structure remains out of scope. |
| **PaddleOCR PP-OCRv5 mobile directly** | Same model support as above. Official general pipeline separates optional orientation/unwarping, text detection, and recognition into modules. | Same published figures; PP-OCR is not just one 14 MB model. Its official table lists detector and recognizer independently, and optional preprocessors add models/time/memory. | PaddleOCR is Apache-2.0 project; requires PaddlePaddle/PaddleX ecosystem and Python-oriented APIs for practical integration. A local process service from Node is possible but adds packaging, lifecycle, and operational complexity. | Include as a fallback implementation only if RapidOCR ONNX conversion/runtime loses quality or needs an unsupported model. Avoid deploying the full Paddle stack without a measured benefit. |
| **PP-OCRv6 tiny/small + RapidOCR / ONNX Runtime CPU** | Current PaddleOCR/RapidOCR docs list multilingual routes for both English (`en`) and Indonesian (`id`); the tiny route omits Japanese, not these two languages. | PaddleOCR lists tiny detector/recognizer at 1.9/4.4 MB and small at 9.6/20.4 MB. It publishes no CPU timing values for these models in the current pipeline table. PP-OCRv6 scores use an internal multi-scenario set, unlike PP-OCRv5's general evaluation set; do not compare their accuracy percentages. No XAss RAM/latency result exists. | RapidOCR routes PP-OCRv6 models to ONNX Runtime. Pin the package release, model route and artifact hashes; review licenses for the exact models. | **Include in the first CPU pilot**, especially for mixed English/Indonesian pages. Tiny is the smallest model; small is a second quality/resource point. Measure both on XAss's target CPU. |
| **EasyOCR (`id` + English; PyTorch CPU)** | Official config includes Indonesian (`id`) in its Latin languages; README says English is compatible with every language and permits `gpu=False`. The documented route is suitable to test as `Reader(["id", "en"], gpu=False)`. | CPU is supported, but EasyOCR publishes no comparable CPU latency, peak-RAM, or total-footprint numbers for this workload. PyTorch runtime means do not assume Tesseract-like resource use. | Separate Python/PyTorch dependency and model downloads; project is Apache-2.0. | Useful independent engine-family comparator when CPU budget is flexible; not the lightest first choice. |
| **Cloud OCR / vision APIs** | Managed document OCR and multimodal vision can offer layout/table/document features, depending on service and API. | Network latency, per-page billing, quota, and provider-side compute are not comparable with local CPU/memory envelope. No controlled comparison has been run. | Requires credentials/network, data processing agreement and retention/residency review for project documents; adds external service and failure modes. | **Out of envelope.** Keep as a separately authorized exception or human-review route, not a local-engine replacement candidate. |

### What the sourced performance numbers do—and do not—mean

Paddle's published milliseconds are per-module model-inference figures, exclude pre- and postprocessing, and use stated Intel Xeon/NVIDIA test hardware. Recognition scores concern specific recognition datasets; text detector H-mean is a different metric from character/word accuracy. The Latin 84.7% is over Latin-script images and does not establish Indonesian/English page transcription accuracy. These numbers cannot be compared to one another as a unified end-to-end score, much less to this installation of Tesseract. Vendor/project benchmarks are useful for choosing candidates, not for asserting an accuracy winner.

No universal accuracy guarantee follows from OCR model claims. A same-resource benchmark on a permitted, representative XAss document set is mandatory before selection.

## Recommended experiment

### 1. Freeze baseline and corpus

Create a versioned, access-controlled evaluation set of representative scanned images and PDF pages, with human-verified transcription and locators. Do not put unauthorized project evidence in a public benchmark. Stratify at minimum by:

- English, Indonesian, genuinely mixed-language pages, names/acronyms/numerals;
- clean and degraded scans, low contrast/noise, skew/rotation, small type, stamps/annotations;
- single-column prose, multi-column/layout complexity, forms, and tables;
- standalone image input, image-only PDF page, native-text PDF, and mixed native-text-plus-image PDF page.

Split by source document (not random lines/pages) into tuning and held-out sets to avoid leakage. Lock exact OS/container, CPU model/cores, memory limit, concurrency, versions, model assets and image inputs. The actual deployment target is not documented yet; select it before setting RAM/latency thresholds.

### 2. Compare bounded candidates on identical pixels

Run these variants with identical page-image inputs and language-appropriate settings:

1. Current Tesseract settings as the control.
2. Tesseract with pinned `tessdata_fast`, then `tessdata_best`, `eng+ind`, LSTM mode, and justified page segmentation settings.
3. Tesseract at the current 160 DPI versus a 300 DPI render; isolate this factor rather than attributing all differences to the OCR engine.
4. PP-OCRv5 mobile detector + Latin-script recognizer through RapidOCR ONNX Runtime CPU, with English-only pages separately run against its English model.
5. PP-OCRv6 tiny and small detector/recognizer routes through RapidOCR ONNX Runtime CPU; include mixed English/Indonesian pages because the documented route covers both.
6. If evaluating a language router, define it before held-out testing and route from observable page signals only; never select per-page models using ground truth. Do not treat PP-OCRv5's English and Latin models as a documented joint-language model.
7. A limited preprocessing ablation (deskew and/or contrast/binarization) with identical OCR engines, since preprocessing is a separate factor.

For mixed-content PDFs, separately measure parser behavior/coverage. Add page OCR alongside native text only when a deterministic policy and deduplication/provenance handling is defined; do not let a model change silently drop native text.

### 3. Report quality, resources and failure behavior

Measure at page and document level: Unicode-normalized CER and WER; exact match for critical identifiers, dates, amounts and units; line/region detection precision/recall; reading-order errors; table cell/header/context preservation; missed text regions; source locator correctness; empty/no-text false success; and language-stratified results. OCR confidence is a review signal, not a calibrated probability without calibration data.

Measure cold-start and warm end-to-end p50/p95 latency per page and 20-page document, throughput at expected concurrency, peak RSS, model/runtime/package disk footprint, CPU utilization, and temporary raster storage. Include PDF rendering, decode, preprocessing, inference, and postprocessing. Also record offline startup/model availability, failure/error classification, timeouts, deterministic output behavior, and model download/hash verification. Reproduce each metric over repeated runs; publish paired differences and confidence intervals/bootstrap intervals at document level.

### 4. Quality gates and choice

Set thresholds with the product/evidence owners before opening held-out results. At minimum require:

- no regression beyond a pre-agreed margin in overall CER/WER or any language stratum;
- improvement or non-inferiority on the high-risk fields and table/header coverage, with no material increase in missed regions;
- explicit success criteria for mixed pages and image-only pages;
- peak RSS, cold/warm latency, storage and concurrency within the actual worker/container budget;
- every unavailable executable/model, OCR timeout, and unusable/no-text result remains a failure/Needs Review outcome, never a successful empty parse;
- page/image provenance and OCR engine/model/version are truthful and stable.

If PP-OCRv5 improves relevant quality within budget, migrate behind a pinned local OCR executable/service boundary and retain Tesseract only if an agreed quality/coverage fallback has demonstrable value. If quality is a tie or resource burden is worse, keep tuned Tesseract. If neither meets gates, address image/render coverage and preprocessing before expanding the model list.

## Integration and rollout notes

The least disruptive first experiment is an external local process from Node, like the current executable boundary, using a small JSON contract for text, boxes, confidence, engine/model version, and errors. RapidOCR's straightforward interface is Python; a sidecar requires pinned Python/package/runtime versions, model download or vendoring, offline startup, health and timeout handling, and operational monitoring. Direct ONNX Runtime in Node removes the sidecar but means owning preprocessing, detector/recognizer decoding, text ordering, and model-specific behavior—more code than the initial test should introduce. Prefer the sidecar only if the benchmark justifies deployment complexity.

Migration should change OCR metadata currently labeled `tesseract`, retain page/image locators and warning semantics, preserve the scanned-page/character bounds, and report model identity. Keep Ghostscript and PDF handling independent of OCR choice. A genuine OCR-engine failure must remain failure rather than being swallowed as empty text. Add mixed-page coverage as its own behavior change, since simply swapping the recognizer cannot address the current OCR skip condition.

## Sources

### Repository

- XAss PDF text extraction, image-operator test, scan-page limit, OCR gating, page metadata, errors and provenance: [`worker/src/services/document-parser.ts`](../../worker/src/services/document-parser.ts#L68-L249).
- PDF raster resolution and Tesseract CLI invocation/timeout/language defaults: [`worker/src/services/document-parser.ts`](../../worker/src/services/document-parser.ts#L1073-L1177).
- Image OCR path and metadata: [`worker/src/services/document-parser.ts`](../../worker/src/services/document-parser.ts#L1025-L1071).
- Operator setup and runtime expectations: [`worker/README.md`](../../worker/README.md#L5-L15), [`README.md`](../../README.md#L17-L20).
- Existing synthetic OCR smoke assertions and environment checks: [`tests/integration/phase6-document-parser.test.mjs`](../../tests/integration/phase6-document-parser.test.mjs#L56-L59) and [OCR assertions](../../tests/integration/phase6-document-parser.test.mjs#L466-L514).

### Official engine and model sources

- Tesseract, [Improving the quality of the output](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html): DPI, binarization, noise, skew, borders, PSM and documented table limitations.
- Tesseract, [Command-Line Usage](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html): default page segmentation mode and CLI behavior.
- Tesseract, [Traineddata files](https://tesseract-ocr.github.io/tessdoc/Data-Files.html): official `tessdata_fast` / `tessdata_best` trade-offs, LSTM engine compatibility, `eng` and `ind` language data. The docs describe model sets as released in 2017; verify versions/maintenance status and selected files when pinning.
- PaddleOCR, [PP-OCRv5 multilingual recognition](https://paddlepaddle.github.io/PaddleOCR/main/en/version3.x/algorithm/PP-OCRv5/PP-OCRv5_multi_languages.html): Latin model language coverage, Indonesian `id`, language list, recognition data/accuracy and dataset sizes.
- PaddleOCR, [OCR pipeline and module model benchmarks](https://paddlepaddle.github.io/PaddleOCR/main/en/version3.x/pipeline_usage/OCR.html): detector and recognizer sizes/CPU timings, test CPU, module separation, preprocessing modules, and benchmark caveats.
- PaddleOCR, [official GitHub repository and license](https://github.com/PaddlePaddle/PaddleOCR): project source and license.
- RapidOCR, [official repository](https://github.com/RapidAI/RapidOCR): ONNX Runtime CPU installation/use, offline deployment, multi-language/multi-platform overview and Apache-2.0 license.
- RapidOCR, [model list and routing](https://rapidai.github.io/RapidOCRDocs/main/model_list/): PP-OCRv5/v6 ONNX routes, supported language codes and model selection/version requirements.
- RapidOCR, [model license inventory](https://github.com/RapidAI/RapidOCR/blob/main/python/MODEL_LICENSES.md): model-specific license verification point; review actual bundled model before release.
- EasyOCR, [official README](https://github.com/JaidedAI/EasyOCR): Indonesian language availability, English compatibility, CPU mode (`gpu=False`), PyTorch implementation notes, installation and license.
- EasyOCR, [official language/model configuration](https://github.com/JaidedAI/EasyOCR/blob/master/easyocr/config.py): Indonesian (`id`) is in the Latin language set.
