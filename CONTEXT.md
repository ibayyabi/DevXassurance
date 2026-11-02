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

**Evidence-led extraction**:
Document and section labels guide interpretation but do not gate domain extraction. Clear values may enter the matching contract even when the artifact's type is uncertain; uncertain values remain marked for review rather than forced into a type.

**Grouped extraction**:
Retain the existing document-level classifier. For each existing text group, one structured model call identifies relevant section/domain evidence and extracts all relevant domain contracts together; do not add a separate section-classification call, a call per domain, or send an entire long document as one input. The domain model does not fix a vendor. If a provider quota is reached, defer/retry remaining groups when capacity returns; keep them marked not processed until handled, never as absent evidence.

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

**WBS record**:
A work package is identified by its source or canonical code, parent code when present, name, and stated deliverable or scope. Owner, acceptance criteria, and resource details are outside the initial comparison contract.

**Scope difference**:
Compare reported deliverables or WBS scope with the approved baseline using accepted WBS mappings. Show added, missing, or changed items as source-backed candidate findings; they are not approved changes automatically.

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
An item-level set of risk claims for a stated reporting period, retaining source ID/name, description, status, rating and original scale, owner, mitigation, due date, and WBS when stated. A “new” or “increased” claim requires a comparable earlier snapshot and either the exact same risk ID or a reviewer-accepted identity mapping; without a match, do not infer change.

**Review period**:
The PMO-selected period for one comparison. Every observation retains its own source period or as-of date; newer evidence is not silently mixed into the selected period.

**Schedule comparison**:
Compare an approved baseline date with a reported forecast date only for the same milestone or work package. Progress percentages are separate evidence and do not by themselves produce forecast dates.

**Schedule record**:
Keep baseline and reported forecast dates for the same milestone or work package. Reported progress percentages remain separate values; the initial comparison does not rebuild the activity dependency network or critical path.

**Progress record**:
Preserve explicitly reported progress at project or WBS level with its source period/as-of date. Do not calculate a project percentage from WBS percentages; show change across periods only when the compared scope and WBS are comparable.

**WBS mapping proposal**:
A source-backed suggestion that differently coded or named work packages refer to the same scope. It is not used for comparison until a project reviewer accepts it.

**Accepted WBS mapping**:
A project-reviewer-approved link between source work-package labels and the same WBS scope. Accepted mappings may be reused within their approved scope; new conflicting evidence requires review.

**Milestone mapping proposal**:
A source-backed suggestion that differently named milestones refer to the same project event. Use it for date comparison only after a project reviewer accepts it; identical labels may be matched directly.

**Accepted milestone mapping**:
A project-reviewer-approved link between milestone labels that refer to the same event. Reuse it within its approved project scope; conflicting evidence requires review.

**Risk identity mapping**:
A reviewer-approved link between risk identifiers that refer to the same risk. Use it to compare snapshots only within its accepted project scope; similar names alone do not prove identity.

**Evidence observation**:
A value or claim extracted from a source with its original wording/value, standardized value when safe, meaning, unit, scope, period, status, and exact source location. Standardization never replaces the original.

**Reviewer correction**:
A reviewer may correct an extracted or normalized value for use in assessment while preserving the original extraction, source wording, and source location. Record the corrected value and reviewer attribution/reason; never rewrite the source evidence.

**Change evidence**:
A source statement about a proposed, approved, or rejected project change is extracted with its stated status, effective date when given, and source location. It is supporting evidence only: it does not change the active baseline automatically, but may support a candidate reviewed through the existing baseline-approval process.

**Risk rating**:
A likelihood, impact, or severity value retained in the scale used by its source. Comparison across different scales requires an accepted mapping.

**Field-specific source authority**:
Source authority depends on the meaning, domain, scope, period, and approval of a value. There is no single “newest document wins” rule; unclear authority remains a conflict for review.

**Eligible observation**:
A clear, source-located value that passes schema and meaning checks may be used in assessment without manual review of every row. Baselines and mappings still require reviewer acceptance; ambiguity and conflict require review.

**Assurance thresholds**:
For comparable data, Budget is on-track at variance <= 0%, needs attention above 0% through 5%, and critical above 5%. Schedule is on-track at 0 days late, needs attention at 1–14 days, and critical above 14 days. These thresholds are versioned evaluation rules.

**Domain status**:
Show Budget, Schedule, and Risk separately. Do not calculate a combined project score; if a source reports an overall status, preserve it as a source claim with its citation.

**Assurance result**:
Show the evidence-backed Budget, Schedule, and Risk comparisons, project/WBS findings, scope differences, evidence gaps, and source citations on the existing Assurance page. The initial output does not add AI-generated action suggestions or a separate downloadable report.

**Assurance pipeline boundary**:
Reuse the existing upload, parser/OCR, source-located chunks, and text groups. Replace the assurance-specific classification and generic extraction with PMO-domain contracts, then update the existing Assurance result; do not maintain a permanent parallel pipeline.

**Model provider preference**:
The provider and model are not selected yet; the target is a free provider. Domain contracts and the grouped-extraction design remain independent of that choice.

**Currency comparison limit**:
Calculate a Budget variance only when the approved baseline and reported EAC use the same currency. Preserve original amounts and currencies; if they differ, mark the comparison not comparable and record an evidence gap. Currency conversion and exchange-rate handling are outside the initial scope.
