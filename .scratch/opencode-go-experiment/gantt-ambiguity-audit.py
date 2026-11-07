#!/usr/bin/env python3
"""Independently verify Workplan & Gantt candidate-ambiguity warnings.

Reads only the pristine OOXML snapshot and the runner's stored parser warnings.
A workbook is expected to carry the Workplan warning when its header is a
genuine two-row block: a week grid (W1..Wn) above a field-label row that also
holds dates in the same week-grid columns. No warning is treated as success;
the check is whether the warning matches the raw table shape.
"""

import argparse
import glob
import json
import os
import re
import sys

HEADER_FIELDS = {
    "WBS",
    "Deliverable / Acceptance Criteria",
    "Baseline Finish",
    "% Complete",
    "Milestone",
}
WEEK_PATTERN = re.compile(r"^W\d+$")
WORKPLAN_WARNING = re.compile(
    r'^Sheet "Workplan & Gantt" table rows .* candidate ambiguity indicators: (.*);'
)


def cell_value(cell):
    return str(cell.get("value") or "").strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, help="WBS runner output root")
    parser.add_argument("--ooxml-root", required=True, help="OOXML reader output root")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    workbooks = []
    for output_path in sorted(glob.glob(os.path.join(args.root, "*", "*.xlsx.json"))):
        with open(output_path, encoding="utf-8") as handle:
            runner = json.load(handle)
        session = os.path.basename(os.path.dirname(output_path))
        file_name = runner["workbook"]["file"]
        ooxml_path = os.path.join(args.ooxml_root, session, f"{file_name}.ooxml.json")
        with open(ooxml_path, encoding="utf-8") as handle:
            ooxml = json.load(handle)
        sheet = next(
            (item for item in ooxml["sheets"] if item["name"] == "Workplan & Gantt"),
            None,
        )
        if sheet is None:
            raise SystemExit(f"missing Workplan sheet in {ooxml_path}")

        warnings = [
            warning
            for warning in runner.get("parse", {}).get("warnings", [])
            if warning.startswith('Sheet "Workplan & Gantt" table rows')
        ]
        ambiguity = [warning for warning in warnings if "candidate ambiguity" in warning]
        split_ambiguity = []
        other_ambiguity = []
        indicator_sets = []
        ranges = []
        for warning in ambiguity:
            match = WORKPLAN_WARNING.match(warning)
            reason_set = set()
            if match:
                reason_set = {part.strip() for part in match.group(1).split(",")}
                ranges.append(re.search(r"table rows ([^ ]+)", warning).group(1))
            indicator_sets.extend(sorted(reason_set))
            if {"multi_row_header", "date_period_columns"} <= reason_set:
                split_ambiguity.append(warning)
            else:
                other_ambiguity.append(warning)

        row3 = sheet["rows"].get("3", {}).get("cells", {})
        row4 = sheet["rows"].get("4", {}).get("cells", {})
        week_columns = sorted(
            {
                re.sub(r"\d+", "", cell_key)
                for cell_key, cell in row3.items()
                if WEEK_PATTERN.match(cell_value(cell))
            }
        )
        row4_labels = {
            cell_value(cell) for cell in row4.values() if cell_value(cell)
        }
        # A genuine split header: W1..Wn on row 3, the same columns carry dates
        # on row 4, and the field-label row contains all comparison labels.
        split_header = (
            len(week_columns) >= 2
            and all(f"{column}4" in row4 for column in week_columns)
            and HEADER_FIELDS.issubset(row4_labels)
        )
        workbooks.append(
            {
                "session": session,
                "file": file_name,
                "workplan_ambiguity_warnings": len(ambiguity),
                "split_header_warnings": len(split_ambiguity),
                "other_ambiguity_warnings": len(other_ambiguity),
                "indicators": indicator_sets,
                "table_ranges": ranges,
                "independent_week_grid_columns": len(week_columns),
                "independent_split_header": split_header,
                "expected_warning": split_header,
                "warning_matches_shape": bool(split_ambiguity) == split_header,
            }
        )

    flagged = [item for item in workbooks if item["split_header_warnings"]]
    unflagged = [item for item in workbooks if not item["split_header_warnings"]]
    mismatches = [item for item in workbooks if not item["warning_matches_shape"]]
    false_positive = [item for item in flagged if not item["independent_split_header"]]
    false_negative = [item for item in unflagged if item["independent_split_header"]]
    indicator_shapes = sorted(
        {
            ",".join(item["indicators"])
            for item in flagged
        }
    )
    other_warning_items = [
        {
            "session": item["session"],
            "file": item["file"],
            "other_ambiguity_warnings": item["other_ambiguity_warnings"],
        }
        for item in workbooks
        if item["other_ambiguity_warnings"]
    ]
    summary = {
        "kind": "gantt-ambiguity-audit",
        "workbooks": len(workbooks),
        "flagged_workplan_tables": len(flagged),
        "unflagged_workplan_tables": len(unflagged),
        "mismatches": len(mismatches),
        "false_positives": len(false_positive),
        "false_negatives": len(false_negative),
        "indicator_shapes": indicator_shapes,
        "flagged_ranges": sorted({range for item in flagged for range in item["table_ranges"]}),
        "other_workplan_ambiguity_workbooks": other_warning_items,
        "flagged": flagged,
        "mismatch_details": mismatches,
    }
    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, "gantt-ambiguity-audit.json"), "w", encoding="utf-8") as handle:
        json.dump(summary, handle, indent=2)
    print(json.dumps({key: summary[key] for key in summary if key not in ("flagged", "mismatch_details")}, indent=2))
    return 0 if not mismatches else 1


if __name__ == "__main__":
    sys.exit(main())
