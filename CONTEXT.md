# Evidence Processing Context

Terms for the PMO evidence pipeline and OCR evaluation of project documents.

## OCR evaluation

**Human-verified OCR corpus**:
A permission-cleared, representative set of scanned evidence pages paired with human-reviewed transcriptions. It is the reference for evaluating OCR quality, not a guarantee of accuracy.
_Avoid_: Gold set (does not communicate how the reference was verified).

**OCR route**:
A fixed model-language configuration passed to the OCR detector/recognizer. The current PP-OCRv6 pilot uses `id`; this setting does not detect or report a page's language.
_Avoid_: Detected language.

**Critical OCR fields**:
Identifiers, dates, amounts, and units whose transcription errors could materially change the meaning of project evidence.

## PMO evidence

**Source document**:
An uploaded project artifact whose format and layout may vary; one document may contain evidence for multiple project-data domains.
_Avoid_: Document schema.

**Document type**:
A label describing an artifact's purpose, such as an approved baseline, finance report, or WBS progress report. It guides interpretation but does not restrict which data domains may be extracted.
_Avoid_: Extraction contract.

**Evidence contract**:
A predefined structure for one project-data domain, such as cost, schedule, WBS/progress, or risk. Any source document may provide evidence for multiple contracts.
_Avoid_: Input template.

**Supporting source**:
A document that can support a comparison field without the pipeline managing every detail of that document's subject area as its own data domain. A purchase order may support committed cost without requiring full procurement tracking.

**Section classification**:
A document can contain sections or tables with different evidence purposes; classification at that level supplements, rather than replaces, the document's primary type.

**Baseline candidate**:
Source-backed values proposed as comparison references for a project-data domain. They are not active baselines until an authorized project reviewer accepts their scope and effective date.
_Avoid_: Approved baseline.

**Baseline**:
A reviewer-accepted comparison reference for a project-data domain, scope, and effective date. It may be assembled from multiple documents and may cover only some domains.

**Baseline revision**:
An accepted baseline remains active until an authorized reviewer accepts a replacement with its source, scope, and effective date. A newer report or forecast alone does not replace it.

**Evidence gap**:
A required value that is absent from the processed scope, not processed, ambiguous, or conflicting. A gap is not zero and does not automatically block unrelated comparisons.

**Comparison level**:
Project comparisons may roll up to the project total and also compare matching WBS/work-package records. Missing or incomparable WBS evidence leaves a gap at that level without suppressing a supported project-total comparison.

**Cost baseline**:
An approved cost reference for a defined project scope and currency, with an effective version or date. It is compared with forecast total, not treated as current spend.

**Actual cost**:
Cost already incurred in a stated period or up to a stated date; it is not a forecast of total project cost.

**Committed cost**:
Cost already ordered or contractually committed; it is distinct from both paid/actual cost and forecast total.

**Cost forecast at completion**:
The project's reported estimate of total cost by project completion, with its scope and currency. It is compared with the approved cost baseline; actual and committed costs remain separate measures.

**Cost comparison record**:
Keep approved baseline, actual-to-date, committed cost, and reported EAC as separate value roles at project and WBS level when available. Compare baseline with EAC; actual and committed values do not substitute for EAC. Monthly cashflow phasing is outside the initial scope.

**Reported forecast**:
A future amount or date explicitly stated in a project source. The pipeline extracts it but does not generate a prediction; if it is absent, record an evidence gap.
_Avoid_: System-generated forecast.

**Risk snapshot**:
An item-level set of risk claims for a stated reporting period, retaining source ID/name, description, status, rating and original scale, owner, mitigation, due date, and WBS when stated. A claim that a risk is new or increased requires a comparable earlier snapshot and a matched risk identity.

**Review period**:
The PMO-selected period for one comparison. Every observation retains its own source period or as-of date; newer evidence is not silently mixed into the selected period.

**Schedule comparison**:
Compare an approved baseline date with a reported forecast date only for the same milestone or work package. Progress percentages are separate evidence and do not by themselves produce forecast dates.

**Schedule record**:
Keep baseline and reported forecast dates for the same milestone or work package. Reported progress percentages remain separate values; the initial comparison does not rebuild the activity dependency network or critical path.

**WBS mapping proposal**:
A source-backed suggestion that differently coded or named work packages refer to the same scope. It is not used for comparison until a project reviewer accepts it.

**Accepted WBS mapping**:
A project-reviewer-approved link between source work-package labels and the same WBS scope. Accepted mappings may be reused within their approved scope; new conflicting evidence requires review.

**Evidence observation**:
A value or claim extracted from a source with its original wording/value, standardized value when safe, meaning, unit, scope, period, status, and exact source location. Standardization never replaces the original.

**Risk rating**:
A likelihood, impact, or severity value retained in the scale used by its source. Comparison across different scales requires an accepted mapping.

**Field-specific source authority**:
Source authority depends on the meaning, domain, scope, period, and approval of a value. There is no single “newest document wins” rule; unclear authority remains a conflict for review.

**Eligible observation**:
A clear, source-located value that passes schema and meaning checks may be used in assessment without manual review of every row. Baselines and mappings still require reviewer acceptance; ambiguity and conflict require review.

**Assurance thresholds**:
For comparable data, Budget is on-track at variance <= 0%, needs attention above 0% through 5%, and critical above 5%. Schedule is on-track at 0 days late, needs attention at 1–14 days, and critical above 14 days. These thresholds are versioned evaluation rules.

**Currency conversion date**:
If values use different currencies, conversion uses the date relevant to the value—transaction date for actual/committed costs and reporting/as-of date for forecasts—not the file upload date. Preserve the original amount, rate, rate date, and converted amount.

**Project reporting currency**:
Each project uses a Finance/PMO-approved comparison currency and date-specific exchange rates. Preserve the source amount and currency; if an approved rate for the relevant value date is unavailable, do not calculate a cross-currency variance.

**Budget currency variance**:
Compare baseline and forecast in the project reporting currency using the rate relevant to each value. The total Budget variance includes exchange-rate movement; preserve original amounts and rates for review.
