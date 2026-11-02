
import React, { useState, useEffect, useRef, createContext, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import { FileClock, FileText, FileCheck2, RefreshCw, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { fileKindLabel } from '@/features/documents/lib/file-types';
const {documentTypes, documentTypeLabels, statusLabels} = {"documentTypeLabels":{"unknown":"Not sure","project_plan":"Project Plan","approved_baseline":"Approved Baseline","progress_report":"Progress Report","meeting_minutes":"Meeting Minutes","decision_record":"Decision Record","procurement_request":"Procurement Request","cost_report":"Cost Report","risk_register":"Risk Register","issue_log":"Issue Log","change_record":"Change Record","approval":"Approval","technical_reference":"Technical Reference","proposal":"Proposal","other":"Other","schedule":"Schedule","claim":"Claim","governance_reference":"Governance Reference"},"documentTypes":["unknown","project_plan","approved_baseline","progress_report","meeting_minutes","decision_record","procurement_request","cost_report","risk_register","issue_log","change_record","approval","technical_reference","proposal","other","schedule","claim","governance_reference"],"factTypeLabels":{"risk":"Risks","issue":"Issues","milestone":"Milestones","decision":"Decisions","owner_action":"Owners & Actions"},"factTypes":["risk","issue","milestone","decision","owner_action"],"processingStatuses":["uploaded","queued","processing","needs_review","completed","failed","cancelled"],"statusLabels":{"uploaded":"Uploaded","queued":"Queued","processing":"Processing","needs_review":"Needs Review","completed":"Completed","failed":"Failed","cancelled":"Cancelled"}};
const roleLabels = {baseline:'Approved Baseline',current:'Current Period',supporting:'Supporting Evidence'};
window.reviewActions = [];
const deleteDocument = async data => { window.reviewActions.push({action:'delete', values:Object.fromEntries(data)}); };
const retryDocumentProcessing = async data => { window.reviewActions.push({action:'retry', values:Object.fromEntries(data)}); };
const updateDocumentClassification = async data => { window.reviewActions.push({action:'review', values:Object.fromEntries(data)}); };
var SourceNavigation = createContext(function () { });
function SourceReference(_a) {
    var documentId = _a.documentId, title = _a.title;
    var navigate = useContext(SourceNavigation);
    return React.createElement("button", { type: "button", onClick: function () { return navigate(documentId); }, className: "break-words text-left font-medium text-brand underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" }, title);
}

function DocumentLibrary({ projectId, documents, summaries, sourceRequest, }) {
    const [filters, setFilters] = useState({ type: "all", period: "all", workstream: "all", status: "all" });
    const [search, setSearch] = useState("");
    const [sort, setSort] = useState("newest");
    const [page, setPage] = useState(0);
    const focusedRequest = useRef(null);
    function updateFilters(next) {
        setFilters(next);
        setPage(0);
    }
    function clearFilters() {
        updateFilters({ type: "all", period: "all", workstream: "all", status: "all" });
        setSearch("");
    }
    const sortedDocuments = [...documents].sort((left, right) => compareArchiveDocuments(left, right, sort));
    const categoryDocuments = sortedDocuments.filter((document) => document.fileName.toLowerCase().includes(search.trim().toLowerCase()) &&
        (filters.period === "all" || document.effectiveReportingPeriod === filters.period) &&
        (filters.workstream === "all" || document.effectiveWorkstream === filters.workstream) &&
        (filters.status === "all" || document.processingStatus === filters.status));
    const filteredDocuments = categoryDocuments.filter((document) => filters.type === "all" || document.effectiveDocumentType === filters.type);
    const activeFilters = [
        search.trim() && `Filename: ${search.trim()}`,
        filters.type !== "all" && `Category: ${documentTypeLabels[filters.type]}`,
        filters.period !== "all" && `Period: ${periodLabel(filters.period)}`,
        filters.workstream !== "all" && `Workstream: ${filters.workstream}`,
        filters.status !== "all" && `State: ${statusLabels[filters.status]}`,
    ].filter(Boolean);
    const pageCount = Math.max(1, Math.ceil(filteredDocuments.length / 10));
    const currentPage = Math.min(page, pageCount - 1);
    const visibleIds = new Set(filteredDocuments.slice(currentPage * 10, (currentPage + 1) * 10).map((document) => document.id));
    useEffect(() => {
        if (!sourceRequest)
            return;
        setFilters({ type: "all", period: "all", workstream: "all", status: "all" });
        setSearch("");
    }, [sourceRequest]);
    useEffect(() => {
        if (!sourceRequest || focusedRequest.current === sourceRequest || search || Object.values(filters).some((value) => value !== "all"))
            return;
        const index = filteredDocuments.findIndex((document) => document.id === sourceRequest.documentId);
        if (index < 0)
            return;
        const sourcePage = Math.floor(index / 10);
        if (currentPage !== sourcePage) {
            setPage(sourcePage);
            return;
        }
        const target = document.getElementById(`document-${sourceRequest.documentId}`);
        const panel = target?.querySelector("dialog[data-document-details]");
        if (!target || !panel)
            return;
        document.querySelectorAll("#evidence-library dialog[open]").forEach((dialog) => dialog.close());
        target.querySelector(":scope > button")?.focus({ preventScroll: true });
        target.scrollIntoView({ block: "center" });
        panel.showModal();
        focusedRequest.current = sourceRequest;
    }, [sourceRequest, filters, search, currentPage, filteredDocuments]);
    return (React.createElement("section", { id: "evidence-library", tabIndex: -1, className: "scroll-mt-24 rounded-2xl border border-ui-border bg-surface p-5 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" },
        React.createElement("div", { className: "flex items-end justify-between gap-3 border-b border-ui-border pb-4" },
            React.createElement("div", null,
                React.createElement("h2", { className: "text-xl font-semibold text-ink" }, "Project documents"),
                React.createElement("p", { className: "mt-1 text-sm text-ink-muted" }, "Project archive. Review roles are separate from artifact type.")),
            React.createElement("p", { className: "shrink-0 whitespace-nowrap text-sm text-ink-muted", role: "status", "aria-live": "polite" },
                documents.length,
                " file",
                documents.length === 1 ? "" : "s",
                " in archive")),
        React.createElement("div", { className: "mt-4 flex flex-wrap items-end gap-2" },
            React.createElement("label", { className: "grid min-w-0 flex-1 basis-full gap-1 text-sm text-ink sm:basis-64" },
                "Search filenames",
                React.createElement(Input, { type: "search", value: search, onChange: (event) => { setSearch(event.target.value); setPage(0); }, placeholder: "Find a loaded document" })),
            React.createElement(Button, { type: "button", variant: "outline", onClick: () => updateFilters({ ...filters, status: "failed" }), "aria-pressed": filters.status === "failed" }, "Failed"),
            React.createElement(Button, { type: "button", variant: "outline", onClick: () => updateFilters({ ...filters, status: "needs_review" }), "aria-pressed": filters.status === "needs_review" }, "Needs review"),
            React.createElement(Button, { type: "button", variant: "outline", onClick: clearFilters }, "Clear filters"),
            React.createElement(Button, { type: "button", variant: "outline", onClick: clearFilters }, "All documents")),
        React.createElement("details", { className: "mt-4" },
            React.createElement("summary", { className: "cursor-pointer font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" }, "Additional filters"),
            React.createElement("div", { className: "mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" },
                React.createElement("label", { className: "grid gap-1 text-xs font-medium text-ink-muted" },
                    "Artifact type",
                    React.createElement("select", { value: filters.type, onChange: (event) => updateFilters({ ...filters, type: event.target.value }), className: "h-10 rounded-md border border-ui-border bg-surface px-3 text-sm text-ink" },
                        React.createElement("option", { value: "all" }, "All types"),
                        documentTypes.map((type) => React.createElement("option", { key: type, value: type }, documentTypeLabels[type])))),
                React.createElement("label", { className: "grid gap-1 text-xs font-medium text-ink-muted" },
                    "Reporting period",
                    React.createElement("select", { value: filters.period, onChange: (event) => updateFilters({ ...filters, period: event.target.value }), className: "h-10 rounded-md border border-ui-border bg-surface px-3 text-sm text-ink" },
                        React.createElement("option", { value: "all" }, "All periods"),
                        uniqueDocumentValues(documents, (document) => document.effectiveReportingPeriod).map((period) => React.createElement("option", { key: period, value: period }, periodLabel(period))))),
                React.createElement("label", { className: "grid gap-1 text-xs font-medium text-ink-muted" },
                    "Workstream",
                    React.createElement("select", { value: filters.workstream, onChange: (event) => updateFilters({ ...filters, workstream: event.target.value }), className: "h-10 rounded-md border border-ui-border bg-surface px-3 text-sm text-ink" },
                        React.createElement("option", { value: "all" }, "All workstreams"),
                        uniqueDocumentValues(documents, (document) => document.effectiveWorkstream).map((workstream) => React.createElement("option", { key: workstream, value: workstream }, workstream)))),
                React.createElement("label", { className: "grid gap-1 text-xs font-medium text-ink-muted" },
                    "Processing state",
                    React.createElement("select", { value: filters.status, onChange: (event) => updateFilters({ ...filters, status: event.target.value }), className: "h-10 rounded-md border border-ui-border bg-surface px-3 text-sm text-ink" },
                        React.createElement("option", { value: "all" }, "All states"),
                        Object.entries(statusLabels).map(([status, label]) => React.createElement("option", { key: status, value: status }, label)))))),
        React.createElement("div", { className: "mt-4 flex flex-wrap items-center gap-3" },
            React.createElement("label", { className: "flex min-w-0 flex-wrap items-center gap-2 text-xs font-medium text-ink-muted" },
                "Document category",
                React.createElement("select", { "aria-label": "Document category", "aria-controls": "document-results", value: filters.type, onChange: (event) => updateFilters({ ...filters, type: event.target.value }), className: "h-9 max-w-full rounded-md border border-ui-border bg-surface px-3 text-sm text-ink" },
                    React.createElement("option", { value: "all" },
                        "All categories (",
                        categoryDocuments.length,
                        ")"),
                    documentTypes.map((type) => React.createElement("option", { key: type, value: type },
                        documentTypeLabels[type],
                        " (",
                        categoryDocuments.filter((document) => document.effectiveDocumentType === type).length,
                        ")")))),
            React.createElement("label", { className: "flex min-w-0 flex-wrap items-center gap-2 text-xs font-medium text-ink-muted" },
                "Sort by",
                React.createElement("select", { "aria-label": "Sort documents", value: sort, onChange: (event) => { setSort(event.target.value); setPage(0); }, className: "h-9 max-w-full rounded-md border border-ui-border bg-surface px-3 text-sm text-ink" },
                    React.createElement("option", { value: "newest" }, "Newest uploads"),
                    React.createElement("option", { value: "name-asc" }, "Filename A to Z"),
                    React.createElement("option", { value: "name-desc" }, "Filename Z to A"),
                    React.createElement("option", { value: "type" }, "Artifact type A to Z"),
                    React.createElement("option", { value: "period-desc" }, "Reporting period newest"),
                    React.createElement("option", { value: "period-asc" }, "Reporting period oldest"),
                    React.createElement("option", { value: "status" }, "Processing state A to Z"))),
            activeFilters.length > 0 && React.createElement("p", { className: "min-w-0 break-words text-xs text-ink-muted" }, activeFilters.join(" / "))),
        documents.length > 0 && filteredDocuments.length === 0 && React.createElement("p", { className: "mt-4 text-sm text-ink-muted", role: "status" }, "No documents match these filters."),
        React.createElement("div", { id: "document-results", hidden: documents.length > 0 && filteredDocuments.length === 0, className: "mt-3 overflow-hidden rounded-lg border border-ui-border" }, documents.length === 0 ? (React.createElement("div", { className: "rounded-xl border border-dashed border-ui-border bg-base p-6" },
            React.createElement(FileClock, { className: "h-7 w-7 text-ink-muted" }),
            React.createElement("p", { className: "mt-3 font-semibold text-ink" }, "No project evidence yet"),
            React.createElement("p", { className: "mt-1 text-sm leading-6 text-ink-muted" }, "Upload evidence files to build the project archive. Assign review roles only when the review context is known."))) : (React.createElement(React.Fragment, null,
            filteredDocuments.length > 0 && (React.createElement("div", { "aria-hidden": "true", className: "hidden grid-cols-[minmax(0,1fr)_9rem_8rem_9rem] items-center gap-3 border-b border-ui-border bg-base px-3 py-2 text-xs font-medium text-ink-muted xl:grid" },
                React.createElement("span", null, "Document"),
                React.createElement("span", null, "Artifact type"),
                React.createElement("span", null, "Reporting period"),
                React.createElement("span", null, "Processing state"))),
            sortedDocuments.map((document) => (React.createElement(DocumentRow, { key: document.id, projectId: projectId, document: document, hidden: !visibleIds.has(document.id), summary: summaries.find((item) => item.selectedDocumentIds.includes(document.id)) })))))),
        React.createElement("div", { className: "mt-4 flex flex-wrap items-center justify-between gap-3" },
            React.createElement("p", { role: "status", "aria-live": "polite", className: "text-sm text-ink-muted" },
                "Showing ",
                filteredDocuments.length ? currentPage * 10 + 1 : 0,
                "\u2013",
                Math.min((currentPage + 1) * 10, filteredDocuments.length),
                " of ",
                filteredDocuments.length),
            React.createElement("nav", { "aria-label": "Document pages", className: "flex items-center gap-2" },
                React.createElement(Button, { type: "button", variant: "outline", size: "sm", disabled: currentPage === 0, onClick: () => setPage(currentPage - 1) }, "Previous"),
                React.createElement("span", { className: "text-xs text-ink-muted" },
                    "Page ",
                    currentPage + 1,
                    " of ",
                    pageCount),
                React.createElement(Button, { type: "button", variant: "outline", size: "sm", disabled: currentPage + 1 >= pageCount, onClick: () => setPage(currentPage + 1) }, "Next")))));
}
function DocumentRow({ projectId, document, summary, hidden, }) {
    const panelRef = useRef(null);
    useEffect(() => {
        if (hidden && panelRef.current?.open)
            panelRef.current.close();
    }, [hidden]);
    return (React.createElement("article", { hidden: hidden, tabIndex: -1, id: `document-${document.id}`, className: "border-b border-ui-border last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand" },
        React.createElement("button", { type: "button", "aria-haspopup": "dialog", "aria-controls": `document-panel-${document.id}`, onClick: () => panelRef.current?.showModal(), className: "grid w-full cursor-pointer text-left grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-3.5 text-sm text-ink hover:bg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand xl:grid-cols-[minmax(0,1fr)_9rem_8rem_9rem]" },
            React.createElement("span", { className: "col-span-2 flex min-w-0 items-center gap-2 xl:col-span-1" },
                React.createElement("span", { "aria-hidden": "true", className: "text-ink-muted" }, "\u203A"),
                React.createElement("span", { className: "truncate font-medium", title: document.fileName }, document.fileName)),
            React.createElement("span", { className: "min-w-0 truncate text-xs text-ink-muted" }, documentTypeLabels[document.effectiveDocumentType]),
            React.createElement("span", { className: "hidden truncate text-xs text-ink-muted xl:block" }, document.effectiveReportingPeriod ? periodLabel(document.effectiveReportingPeriod) : React.createElement("span", { "aria-label": "Reporting period not provided" }, "\u2014")),
            React.createElement("span", { className: "justify-self-end xl:justify-self-start" },
                React.createElement(StatusBadge, { status: document.processingStatus }))),
        React.createElement("dialog", { ref: panelRef, "data-document-details": true, id: `document-panel-${document.id}`, "aria-labelledby": `document-title-${document.id}`, className: "fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-full max-w-2xl overflow-y-auto overscroll-contain border-l border-ui-border bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/20" },
            React.createElement("header", { className: "sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-ui-border bg-surface p-5" },
                React.createElement("h3", { id: `document-title-${document.id}`, className: "min-w-0 text-base font-semibold text-ink [overflow-wrap:anywhere]" }, document.fileName),
                React.createElement(Button, { type: "button", variant: "outline", size: "sm", className: "shrink-0", "aria-label": "Close document details", onClick: () => panelRef.current?.close() }, "Close")),
            React.createElement("div", { className: "p-5 [overflow-wrap:anywhere]" },
                React.createElement("p", { className: "mb-4 text-sm text-ink-muted" },
                    "Processing state: ",
                    React.createElement(StatusBadge, { status: document.processingStatus })),
                React.createElement("div", { className: "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between" },
                    React.createElement("div", { className: "flex min-w-0 gap-3" },
                        React.createElement("span", { className: `rounded-xl p-2.5 ${document.processingStatus === "completed" ? "bg-status-ok-bg text-status-ok-text" : document.processingStatus === "failed" ? "bg-status-critical-bg text-status-critical-text" : "bg-status-warn-bg text-status-warn-text"}` }, document.processingStatus === "completed" ? (React.createElement(FileCheck2, { className: "h-5 w-5" })) : (React.createElement(FileText, { className: "h-5 w-5" }))),
                        React.createElement("div", { className: "min-w-0" },
                            document.title !== document.fileName && React.createElement("p", { className: "mt-1 text-sm text-ink-muted" }, document.title),
                            React.createElement("p", { className: "mt-1 text-xs leading-5 text-ink-muted" },
                                fileKindLabel(document.mimeType, document.fileName),
                                " \u00B7 ",
                                formatBytes(document.fileSize),
                                " \u00B7 ",
                                document.effectiveDocumentDate ? `Document date ${formatDate(document.effectiveDocumentDate)}` : "No document date",
                                " \u00B7 Uploaded ",
                                formatDate(document.createdAt)),
                            document.submissionId && (React.createElement("p", { className: "mt-1 text-xs text-ink-muted" },
                                "Submission ",
                                document.submissionId.slice(0, 8),
                                document.submissionBatchId && ` · Batch ${document.submissionBatchId.slice(0, 8)}`)))),
                    React.createElement("form", { action: deleteDocument, onSubmit: (event) => {
                            if (!window.confirm(`Remove "${document.title}" from this project?`)) {
                                event.preventDefault();
                            }
                        } },
                        React.createElement("input", { type: "hidden", name: "projectId", value: projectId }),
                        React.createElement("input", { type: "hidden", name: "documentId", value: document.id }),
                        React.createElement(Button, { type: "submit", size: "sm", variant: "outline", className: "border-status-critical bg-surface text-status-critical-text hover:bg-status-critical-bg hover:text-status-critical-text" },
                            React.createElement(Trash2, { className: "h-4 w-4" }),
                            "Remove"))),
                React.createElement("div", { className: "mt-4 flex flex-wrap items-center gap-2" },
                    React.createElement(MetadataBadge, { label: "Type", value: documentTypeLabels[document.effectiveDocumentType], source: metadataSource(document.confirmedDocumentType, document.suggestedDocumentType, document.documentTypeHint) }),
                    React.createElement(MetadataBadge, { label: "Evidence role", value: document.effectiveEvidenceRole ? roleLabels[document.effectiveEvidenceRole] : "Unassigned", source: metadataSource(document.confirmedEvidenceRole, document.suggestedEvidenceRole, null) }),
                    document.effectiveDocumentDate && (React.createElement(MetadataBadge, { label: "Date", value: formatDate(document.effectiveDocumentDate), source: metadataSource(document.confirmedDocumentDate, document.suggestedDocumentDate, document.documentDateHint) })),
                    document.effectiveReportingPeriod && (React.createElement(MetadataBadge, { label: "Period", value: periodLabel(document.effectiveReportingPeriod), source: metadataSource(document.confirmedReportingPeriod, document.detectedReportingPeriod, document.reportingPeriodHint) })),
                    document.effectiveWorkstream && (React.createElement(MetadataBadge, { label: "Workstream", value: document.effectiveWorkstream, source: metadataSource(document.confirmedWorkstream, document.suggestedWorkstream, document.workstreamHint) })),
                    ["uploaded", "queued", "processing"].includes(document.processingStatus) && (React.createElement("span", { className: "inline-flex items-center gap-1.5 text-xs font-medium text-status-warn-text" },
                        React.createElement(RefreshCw, { className: "h-3.5 w-3.5 animate-spin" }),
                        "Reading pending or in progress"))),
                document.processingError && (React.createElement("p", { className: "mt-3 rounded-lg bg-status-critical-bg px-3 py-2 text-sm text-status-critical-text" }, document.processingError)),
                document.reviewDetails.length > 0 && (React.createElement("div", { className: "mt-3 space-y-2" }, document.reviewDetails.map((detail) => (React.createElement("details", { key: detail.key, className: "rounded-lg border border-ui-border bg-base px-3 py-2 text-sm" },
                    React.createElement("summary", { className: "cursor-pointer font-medium text-ink" }, detail.title),
                    React.createElement("ul", { className: "mt-2 space-y-1 pl-5 text-ink-muted" },
                        detail.entries.map((entry, index) => (React.createElement("li", { key: `${detail.key}-${index}` }, entry))),
                        detail.omittedCount > 0 && (React.createElement("li", null,
                            detail.omittedCount,
                            " additional entries not shown.")))))))),
                document.processingStatus === "failed" && (React.createElement("form", { action: retryDocumentProcessing, className: "mt-3" },
                    React.createElement("input", { type: "hidden", name: "projectId", value: projectId }),
                    React.createElement("input", { type: "hidden", name: "documentId", value: document.id }),
                    React.createElement(Button, { type: "submit", size: "sm", variant: "outline", className: "border-status-critical bg-surface text-status-critical-text hover:bg-status-critical-bg" },
                        React.createElement(RefreshCw, { className: "h-4 w-4" }),
                        "Retry document processing"))),
                summary?.qualityWarning && React.createElement("p", { className: "mt-3 rounded-lg bg-status-warn-bg p-3 text-sm text-status-warn-text" },
                    "Reading limitation: ",
                    summary.qualityWarning),
                React.createElement("section", { className: "mt-3 text-sm", "aria-label": "Summary, rationale, and metadata" },
                    document.classificationReason && (React.createElement("p", { className: "mt-3 text-sm leading-6 text-ink-muted" },
                        React.createElement("span", { className: "font-medium text-ink" }, "Suggestion basis:"),
                        " ",
                        document.classificationReason)),
                    document.suggestedDocumentType && document.classificationConfidence !== null && (React.createElement("p", { className: "mt-2 text-xs text-ink-muted" },
                        "Suggestion confidence: ",
                        Math.round(document.classificationConfidence * 100),
                        "%")),
                    summary && (summary.summaryText || summary.sources.length > 0) && (React.createElement("div", { className: "mt-3 rounded-lg bg-base px-3 py-3" },
                        React.createElement("p", { className: "text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted" }, "Document summary"),
                        React.createElement("p", { className: "mt-2 text-sm leading-6 text-ink-muted" }, summary.summaryText),
                        summary.sources.length > 0 && (React.createElement("details", { className: "mt-2 text-sm" },
                            React.createElement("summary", { className: "cursor-pointer font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" },
                                "Source details (",
                                summary.sources.length,
                                ")"),
                            React.createElement("ul", { className: "mt-2 grid gap-2" }, summary.sources.map((source) => (React.createElement("li", { key: source.id, className: "rounded-md bg-surface p-2" },
                                React.createElement("p", { className: "font-medium text-ink" },
                                    React.createElement(SourceReference, { documentId: source.documentId, title: source.documentTitle })),
                                source.location && React.createElement("p", { className: "mt-1 text-sm font-medium text-ink-muted" }, source.location),
                                source.excerpt && React.createElement("p", { className: "mt-1 break-words leading-6 text-ink-muted" }, source.excerpt))))))))),
                    React.createElement("details", { className: "mt-3 text-sm" },
                        React.createElement("summary", { className: "cursor-pointer font-medium text-ink" }, document.confirmedAt ? "Edit confirmed metadata" : "Review suggestions"),
                        React.createElement("form", { action: updateDocumentClassification, className: "mt-3 grid max-w-2xl gap-3 sm:grid-cols-2" },
                            React.createElement("input", { type: "hidden", name: "projectId", value: projectId }),
                            React.createElement("input", { type: "hidden", name: "documentId", value: document.id }),
                            React.createElement("label", { className: "grid gap-1 text-xs font-medium text-ink-muted" },
                                "Artifact type",
                                React.createElement("select", { name: "documentType", defaultValue: document.confirmedDocumentType ?? document.suggestedDocumentType ?? document.documentTypeHint ?? "unknown", className: "h-10 rounded-md border border-ui-border bg-surface px-3 text-sm text-ink" }, documentTypes.map((type) => React.createElement("option", { key: type, value: type }, documentTypeLabels[type])))),
                            React.createElement("label", { className: "grid gap-1 text-xs font-medium text-ink-muted" },
                                "Evidence role (not user access)",
                                React.createElement("select", { name: "evidenceRole", defaultValue: document.confirmedEvidenceRole ?? document.suggestedEvidenceRole ?? "", className: "h-10 rounded-md border border-ui-border bg-surface px-3 text-sm text-ink" },
                                    React.createElement("option", { value: "" }, "Not assigned"),
                                    React.createElement("option", { value: "baseline" }, "Approved Baseline"),
                                    React.createElement("option", { value: "current" }, "Current Period"),
                                    React.createElement("option", { value: "supporting" }, "Supporting Evidence"))),
                            React.createElement("label", { className: "grid gap-1 text-xs font-medium text-ink-muted" },
                                "Document date",
                                React.createElement(Input, { name: "documentDate", type: "date", defaultValue: document.confirmedDocumentDate ?? document.suggestedDocumentDate ?? document.documentDateHint ?? document.documentDate ?? "", className: "h-10" })),
                            React.createElement("label", { className: "grid gap-1 text-xs font-medium text-ink-muted" },
                                "Reporting period",
                                React.createElement(Input, { name: "reportingPeriod", type: "month", defaultValue: document.confirmedReportingPeriod ?? document.detectedReportingPeriod ?? document.reportingPeriodHint ?? "", className: "h-10" })),
                            React.createElement("label", { className: "grid gap-1 text-xs font-medium text-ink-muted sm:col-span-2" },
                                "Workstream",
                                React.createElement(Input, { name: "workstream", maxLength: 120, defaultValue: document.confirmedWorkstream ?? document.suggestedWorkstream ?? document.workstreamHint ?? "", className: "h-10" })),
                            React.createElement(Button, { type: "submit", size: "sm", className: "sm:col-span-2" }, "Save review metadata"))))))));
}
function StatusBadge({ status, }) {
    const tone = status === "failed"
        ? "bg-status-critical-bg text-status-critical-text"
        : status === "completed"
            ? "bg-status-ok-bg text-status-ok-text"
            : status === "cancelled"
                ? "bg-base text-ink-muted"
                : "bg-status-warn-bg text-status-warn-text";
    return (React.createElement("span", { className: `inline-block rounded-md px-2 py-0.5 text-xs font-medium ${tone}` }, statusLabels[status]));
}
function metadataSource(confirmed, suggested, hint) {
    if (confirmed)
        return "Confirmed";
    if (suggested)
        return "Suggested";
    if (hint)
        return "User hint";
    return "Unclassified";
}
function MetadataBadge({ label, value, source }) {
    return (React.createElement("span", { className: "rounded-full bg-plan-track px-2.5 py-1 text-xs font-medium text-ink-muted" },
        label,
        ": ",
        value,
        " ",
        React.createElement("span", { className: "font-normal" },
            "\u00B7 ",
            source)));
}
function formatBytes(value) {
    if (value < 1024)
        return `${value} B`;
    if (value < 1024 * 1024)
        return `${Math.round(value / 1024)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
function formatDate(value) {
    return new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        year: "numeric",
    }).format(new Date(value));
}
function compareArchiveDocuments(left, right, sort) {
    if (sort === "newest")
        return right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id);
    const value = (document) => sort === "type" ? documentTypeLabels[document.effectiveDocumentType]
        : sort === "status" ? statusLabels[document.processingStatus]
            : sort.startsWith("period") ? document.effectiveReportingPeriod : document.fileName;
    const leftValue = value(left);
    const rightValue = value(right);
    // Absent optional periods stay last in either direction.
    if (!leftValue || !rightValue)
        return leftValue ? -1 : rightValue ? 1 : left.id.localeCompare(right.id);
    const direction = sort === "name-desc" || sort === "period-desc" ? -1 : 1;
    return direction * leftValue.localeCompare(rightValue, undefined, { numeric: true, sensitivity: "base" }) || left.id.localeCompare(right.id);
}
function uniqueDocumentValues(documents, getValue) {
    return [...new Set(documents.map(getValue).filter((value) => Boolean(value)))].sort();
}
function periodLabel(value) {
    const match = /^(\d{4})-(\d{2})$/.exec(value);
    if (!match)
        return value;
    return new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC", year: "numeric" })
        .format(new Date(`${match[1]}-${match[2]}-01T00:00:00Z`));
}

const documents = [{"id":"doc-0","projectId":"project-1","fileName":"unknown-october-report.pdf","title":"Not sure report","fileSize":2048,"mimeType":"application/pdf","createdAt":"2026-10-01T00:00:00Z","reviewDetails":[],"effectiveDocumentType":"unknown","effectiveReportingPeriod":"2026-10","effectiveWorkstream":"Design","effectiveDocumentDate":null,"effectiveEvidenceRole":null,"confirmedDocumentType":null,"suggestedDocumentType":"unknown","documentTypeHint":null,"processingStatus":"failed","processingError":"Extraction failed; retry available","classificationReason":"Type suggested from source content","classificationConfidence":0.8,"confirmedAt":null},{"id":"doc-1","projectId":"project-1","fileName":"project_plan-october-report.pdf","title":"Project Plan report","fileSize":2048,"mimeType":"application/pdf","createdAt":"2026-10-01T00:00:00Z","reviewDetails":[],"effectiveDocumentType":"project_plan","effectiveReportingPeriod":"2026-09","effectiveWorkstream":"Civil","effectiveDocumentDate":null,"effectiveEvidenceRole":null,"confirmedDocumentType":null,"suggestedDocumentType":"project_plan","documentTypeHint":null,"processingStatus":"needs_review","processingError":null,"classificationReason":"Type suggested from source content","classificationConfidence":0.8,"confirmedAt":null},{"id":"doc-2","projectId":"project-1","fileName":"approved_baseline-october-report.pdf","title":"Approved Baseline report","fileSize":2048,"mimeType":"application/pdf","createdAt":"2026-10-01T00:00:00Z","reviewDetails":[],"effectiveDocumentType":"approved_baseline","effectiveReportingPeriod":"2026-10","effectiveWorkstream":"Design","effectiveDocumentDate":null,"effectiveEvidenceRole":null,"confirmedDocumentType":null,"suggestedDocumentType":"approved_baseline","documentTypeHint":null,"processingStatus":"completed","processingError":null,"classificationReason":"Type suggested from source content","classificationConfidence":0.8,"confirmedAt":null},{"id":"doc-3","projectId":"project-1","fileName":"progress_report-october-report.pdf","title":"Progress Report report","fileSize":2048,"mimeType":"application/pdf","createdAt":"2026-10-01T00:00:00Z","reviewDetails":[],"effectiveDocumentType":"progress_report","effectiveReportingPeriod":"2026-09","effectiveWorkstream":"Civil","effectiveDocumentDate":null,"effectiveEvidenceRole":null,"confirmedDocumentType":null,"suggestedDocumentType":"progress_report","documentTypeHint":null,"processingStatus":"completed","processingError":null,"classificationReason":"Type suggested from source content","classificationConfidence":0.8,"confirmedAt":null},{"id":"doc-4","projectId":"project-1","fileName":"meeting_minutes-october-report.pdf","title":"Meeting Minutes report","fileSize":2048,"mimeType":"application/pdf","createdAt":"2026-10-01T00:00:00Z","reviewDetails":[],"effectiveDocumentType":"meeting_minutes","effectiveReportingPeriod":"2026-10","effectiveWorkstream":"Design","effectiveDocumentDate":null,"effectiveEvidenceRole":null,"confirmedDocumentType":null,"suggestedDocumentType":"meeting_minutes","documentTypeHint":null,"processingStatus":"completed","processingError":null,"classificationReason":"Type suggested from source content","classificationConfidence":0.8,"confirmedAt":null},{"id":"doc-5","projectId":"project-1","fileName":"decision_record-october-report.pdf","title":"Decision Record report","fileSize":2048,"mimeType":"application/pdf","createdAt":"2026-10-01T00:00:00Z","reviewDetails":[],"effectiveDocumentType":"decision_record","effectiveReportingPeriod":"2026-09","effectiveWorkstream":"Civil","effectiveDocumentDate":null,"effectiveEvidenceRole":null,"confirmedDocumentType":null,"suggestedDocumentType":"decision_record","documentTypeHint":null,"processingStatus":"completed","processingError":null,"classificationReason":"Type suggested from source content","classificationConfidence":0.8,"confirmedAt":null},{"id":"doc-6","projectId":"project-1","fileName":"procurement_request-october-report.pdf","title":"Procurement Request report","fileSize":2048,"mimeType":"application/pdf","createdAt":"2026-10-01T00:00:00Z","reviewDetails":[],"effectiveDocumentType":"procurement_request","effectiveReportingPeriod":"2026-10","effectiveWorkstream":"Design","effectiveDocumentDate":null,"effectiveEvidenceRole":null,"confirmedDocumentType":null,"suggestedDocumentType":"procurement_request","documentTypeHint":null,"processingStatus":"completed","processingError":null,"classificationReason":"Type suggested from source content","classificationConfidence":0.8,"confirmedAt":null},{"id":"doc-7","projectId":"project-1","fileName":"cost_report-october-report.pdf","title":"Cost Report report","fileSize":2048,"mimeType":"application/pdf","createdAt":"2026-10-01T00:00:00Z","reviewDetails":[],"effectiveDocumentType":"cost_report","effectiveReportingPeriod":"2026-09","effectiveWorkstream":"Civil","effectiveDocumentDate":null,"effectiveEvidenceRole":null,"confirmedDocumentType":null,"suggestedDocumentType":"cost_report","documentTypeHint":null,"processingStatus":"completed","processingError":null,"classificationReason":"Type suggested from source content","classificationConfidence":0.8,"confirmedAt":null},{"id":"doc-8","projectId":"project-1","fileName":"risk_register-october-report.pdf","title":"Risk Register report","fileSize":2048,"mimeType":"application/pdf","createdAt":"2026-10-01T00:00:00Z","reviewDetails":[],"effectiveDocumentType":"risk_register","effectiveReportingPeriod":"2026-10","effectiveWorkstream":"Design","effectiveDocumentDate":null,"effectiveEvidenceRole":null,"confirmedDocumentType":null,"suggestedDocumentType":"risk_register","documentTypeHint":null,"processingStatus":"completed","processingError":null,"classificationReason":"Type suggested from source content","classificationConfidence":0.8,"confirmedAt":null},{"id":"doc-9","projectId":"project-1","fileName":"issue_log-october-report.pdf","title":"Issue Log report","fileSize":2048,"mimeType":"application/pdf","createdAt":"2026-10-01T00:00:00Z","reviewDetails":[],"effectiveDocumentType":"issue_log","effectiveReportingPeriod":"2026-09","effectiveWorkstream":"Civil","effectiveDocumentDate":null,"effectiveEvidenceRole":null,"confirmedDocumentType":null,"suggestedDocumentType":"issue_log","documentTypeHint":null,"processingStatus":"completed","processingError":null,"classificationReason":"Type suggested from source content","classificationConfidence":0.8,"confirmedAt":null},{"id":"doc-10","projectId":"project-1","fileName":"change_record-october-report.pdf","title":"Change Record report","fileSize":2048,"mimeType":"application/pdf","createdAt":"2026-10-01T00:00:00Z","reviewDetails":[],"effectiveDocumentType":"change_record","effectiveReportingPeriod":"2026-10","effectiveWorkstream":"Design","effectiveDocumentDate":null,"effectiveEvidenceRole":null,"confirmedDocumentType":null,"suggestedDocumentType":"change_record","documentTypeHint":null,"processingStatus":"completed","processingError":null,"classificationReason":"Type suggested from source content","classificationConfidence":0.8,"confirmedAt":null},{"id":"doc-11","projectId":"project-1","fileName":"approval-october-report.pdf","title":"Approval report","fileSize":2048,"mimeType":"application/pdf","createdAt":"2026-10-01T00:00:00Z","reviewDetails":[],"effectiveDocumentType":"approval","effectiveReportingPeriod":"2026-09","effectiveWorkstream":"Civil","effectiveDocumentDate":null,"effectiveEvidenceRole":null,"confirmedDocumentType":null,"suggestedDocumentType":"approval","documentTypeHint":null,"processingStatus":"completed","processingError":null,"classificationReason":"Type suggested from source content","classificationConfidence":0.8,"confirmedAt":null},{"id":"doc-12","projectId":"project-1","fileName":"technical_reference-october-report.pdf","title":"Technical Reference report","fileSize":2048,"mimeType":"application/pdf","createdAt":"2026-10-01T00:00:00Z","reviewDetails":[],"effectiveDocumentType":"technical_reference","effectiveReportingPeriod":"2026-10","effectiveWorkstream":"Design","effectiveDocumentDate":null,"effectiveEvidenceRole":null,"confirmedDocumentType":null,"suggestedDocumentType":"technical_reference","documentTypeHint":null,"processingStatus":"completed","processingError":null,"classificationReason":"Type suggested from source content","classificationConfidence":0.8,"confirmedAt":null},{"id":"doc-13","projectId":"project-1","fileName":"proposal-october-report.pdf","title":"Proposal report","fileSize":2048,"mimeType":"application/pdf","createdAt":"2026-10-01T00:00:00Z","reviewDetails":[],"effectiveDocumentType":"proposal","effectiveReportingPeriod":"2026-09","effectiveWorkstream":"Civil","effectiveDocumentDate":null,"effectiveEvidenceRole":null,"confirmedDocumentType":null,"suggestedDocumentType":"proposal","documentTypeHint":null,"processingStatus":"completed","processingError":null,"classificationReason":"Type suggested from source content","classificationConfidence":0.8,"confirmedAt":null},{"id":"doc-14","projectId":"project-1","fileName":"other-october-report.pdf","title":"Other report","fileSize":2048,"mimeType":"application/pdf","createdAt":"2026-10-01T00:00:00Z","reviewDetails":[],"effectiveDocumentType":"other","effectiveReportingPeriod":"2026-10","effectiveWorkstream":"Design","effectiveDocumentDate":null,"effectiveEvidenceRole":null,"confirmedDocumentType":null,"suggestedDocumentType":"other","documentTypeHint":null,"processingStatus":"completed","processingError":null,"classificationReason":"Type suggested from source content","classificationConfidence":0.8,"confirmedAt":null},{"id":"doc-15","projectId":"project-1","fileName":"schedule-october-report.pdf","title":"Schedule report","fileSize":2048,"mimeType":"application/pdf","createdAt":"2026-10-01T00:00:00Z","reviewDetails":[],"effectiveDocumentType":"schedule","effectiveReportingPeriod":"2026-09","effectiveWorkstream":"Civil","effectiveDocumentDate":null,"effectiveEvidenceRole":null,"confirmedDocumentType":null,"suggestedDocumentType":"schedule","documentTypeHint":null,"processingStatus":"completed","processingError":null,"classificationReason":"Type suggested from source content","classificationConfidence":0.8,"confirmedAt":null},{"id":"doc-16","projectId":"project-1","fileName":"claim-october-report.pdf","title":"Claim report","fileSize":2048,"mimeType":"application/pdf","createdAt":"2026-10-01T00:00:00Z","reviewDetails":[],"effectiveDocumentType":"claim","effectiveReportingPeriod":"2026-10","effectiveWorkstream":"Design","effectiveDocumentDate":null,"effectiveEvidenceRole":null,"confirmedDocumentType":null,"suggestedDocumentType":"claim","documentTypeHint":null,"processingStatus":"completed","processingError":null,"classificationReason":"Type suggested from source content","classificationConfidence":0.8,"confirmedAt":null},{"id":"doc-17","projectId":"project-1","fileName":"governance_reference-october-report.pdf","title":"Governance Reference report","fileSize":2048,"mimeType":"application/pdf","createdAt":"2026-10-01T00:00:00Z","reviewDetails":[],"effectiveDocumentType":"governance_reference","effectiveReportingPeriod":"2026-09","effectiveWorkstream":"Civil","effectiveDocumentDate":null,"effectiveEvidenceRole":null,"confirmedDocumentType":null,"suggestedDocumentType":"governance_reference","documentTypeHint":null,"processingStatus":"completed","processingError":null,"classificationReason":"Type suggested from source content","classificationConfidence":0.8,"confirmedAt":null}];
for(let index=18;index<26;index++) documents.push({...documents[3],id:'doc-'+index,fileName:'Progress '+index+'.pdf',effectiveReportingPeriod:index===24?null:'2026-10',effectiveWorkstream:'Design',processingStatus:({18:'uploaded',19:'queued',20:'processing',21:'cancelled'})[index]||'completed'});
documents.forEach((item,index)=>item.createdAt=new Date(Date.UTC(2026,9,index+1)).toISOString());
documents[25].fileName='October-project-progress-evidence-with-a-very-long-original-filename-and-complete-source-identifiers-'.repeat(3)+'.pdf';
window.fixtureDocuments=documents;
const summaries = [{id:'summary-3',summaryText:'October progress evidence',selectedDocumentIds:['doc-25'],sources:[{id:'source-1',documentId:'doc-0',documentTitle:'Not sure report',location:'Page 4',excerpt:'Original source excerpt'}]}];
function Harness(){ const [sourceRequest,setSourceRequest]=useState(null); const [items,setItems]=useState(documents); window.replaceDocuments=setItems; return React.createElement(SourceNavigation.Provider,{value:id=>setSourceRequest({documentId:id})}, React.createElement(DocumentLibrary,{projectId:'project-1',documents:items,summaries,sourceRequest})); }
createRoot(document.getElementById('root')).render(React.createElement(Harness));
