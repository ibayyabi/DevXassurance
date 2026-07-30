import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const evidenceRoot = path.join(
  root,
  "demo-evidence-fixtures",
  "realistic-pmo-cases",
);
const previewRoot = path.join(root, "tmp", "demo-workbooks", "previews");

const palette = {
  ink: "#0F172A",
  muted: "#475569",
  blue: "#1D4ED8",
  blueSoft: "#EFF6FF",
  line: "#CBD5E1",
  surface: "#F8FAFC",
  white: "#FFFFFF",
  green: "#047857",
  amber: "#B45309",
  red: "#B91C1C",
};

const scenariosPayload = JSON.parse(
  await fs.readFile(path.join(evidenceRoot, "scenarios.json"), "utf8"),
);

await fs.mkdir(previewRoot, { recursive: true });

for (const scenario of scenariosPayload.scenarios) {
  const folder = path.join(evidenceRoot, scenario.folder);
  await fs.mkdir(folder, { recursive: true });
  await buildCostWorkbook(scenario, folder);
  await buildRiskWorkbook(scenario, folder);
  await buildIssueWorkbook(scenario, folder);
}

await new Promise((resolve) => setTimeout(resolve, 250));
for (const scenario of scenariosPayload.scenarios) {
  const folder = path.join(evidenceRoot, scenario.folder);
  for (const file of await fs.readdir(folder)) {
    if (file.endsWith(".inspect.ndjson")) {
      await fs.rm(path.join(folder, file), { force: true });
    }
  }
}

console.log(
  `Created and verified ${scenariosPayload.scenarios.length * 3} PMO workbooks.`,
);

async function buildCostWorkbook(scenario, folder) {
  const workbook = Workbook.create();
  const latest = scenario.periods.at(-1);
  const summary = workbook.worksheets.add("Cost Summary");
  const details = workbook.worksheets.add("Cost Details");

  configureSheet(summary);
  configureSheet(details);

  summary.mergeCells("A1:F1");
  summary.getRange("A1").values = [["Cost Forecast Report"]];
  summary.mergeCells("A2:F2");
  summary.getRange("A2").values = [[scenario.project]];
  summary.getRange("A4:B9").values = [
    ["Field", "Value"],
    ["Reporting period", latest.label],
    ["Approved baseline budget", scenario.baseline_budget],
    ["Current forecast at completion", latest.forecast_cost],
    ["Current actual cost", latest.actual_cost],
    ["Forecast variance", null],
  ];
  summary.getRange("B9").formulas = [["=B7-B6"]];
  summary.getRange("D4:F4").values = [["Condition", "Rule", "Evidence note"]];
  summary.getRange("D5:F7").values = [
    [
      latest.expected.budget_condition.replaceAll("_", " "),
      "Critical only when forecast variance is above 5%",
      latest.narrative,
    ],
    ["Currency", scenario.currency, "Values are forecast-at-completion evidence"],
    ["Source", "Cost report", "Use with the approved baseline document"],
  ];

  styleTitle(summary, "A1:F1", "A2:F2");
  styleHeader(summary.getRange("A4:B4"));
  styleHeader(summary.getRange("D4:F4"));
  styleBody(summary.getRange("A5:B9"));
  styleBody(summary.getRange("D5:F7"));
  summary.getRange("B6:B9").format.numberFormat = '"$"#,##0;[Red]("$"#,##0);-';
  summary.getRange("A1:F9").format.wrapText = true;
  summary.getRange("A:A").format.columnWidth = 29;
  summary.getRange("B:B").format.columnWidth = 22;
  summary.getRange("C:C").format.columnWidth = 3;
  summary.getRange("D:D").format.columnWidth = 19;
  summary.getRange("E:E").format.columnWidth = 34;
  summary.getRange("F:F").format.columnWidth = 48;
  summary.getRange("A1:F9").format.autofitRows();
  summary.freezePanes.freezeRows(4);

  details.mergeCells("A1:H1");
  details.getRange("A1").values = [[`${scenario.project} | ${latest.label}`]];
  const headers = [
    "Cost item",
    "Planned cost USD",
    "Actual cost USD",
    "Forecast cost USD",
    "Forecast variance USD",
    "Variance %",
    "Status",
    "Evidence note",
  ];
  details.getRange("A3:H3").values = [headers];
  const rows = scenario.cost_rows.map((row) => [
    row[0],
    row[1],
    row[2],
    row[3],
    null,
    null,
    row[4],
    row[5],
  ]);
  details.getRange(`A4:H${3 + rows.length}`).values = rows;
  for (let index = 0; index < rows.length; index += 1) {
    const row = 4 + index;
    details.getRange(`E${row}`).formulas = [[`=D${row}-B${row}`]];
    details.getRange(`F${row}`).formulas = [[`=IF(B${row}=0,0,E${row}/B${row})`]];
  }
  const totalRow = 4 + rows.length;
  details.getRange(`A${totalRow}:H${totalRow}`).values = [[
    "Total",
    null,
    null,
    null,
    null,
    null,
    "",
    "",
  ]];
  details.getRange(`B${totalRow}`).formulas = [[`=SUM(B4:B${totalRow - 1})`]];
  details.getRange(`C${totalRow}`).formulas = [[`=SUM(C4:C${totalRow - 1})`]];
  details.getRange(`D${totalRow}`).formulas = [[`=SUM(D4:D${totalRow - 1})`]];
  details.getRange(`E${totalRow}`).formulas = [[`=SUM(E4:E${totalRow - 1})`]];
  details.getRange(`F${totalRow}`).formulas = [[`=IF(B${totalRow}=0,0,E${totalRow}/B${totalRow})`]];

  styleTitle(details, "A1:H1");
  styleHeader(details.getRange("A3:H3"));
  styleBody(details.getRange(`A4:H${totalRow}`));
  details.getRange(`A${totalRow}:H${totalRow}`).format = {
    fill: palette.blueSoft,
    font: { bold: true, color: palette.ink },
    borders: { preset: "doubleBottom", style: "thin", color: palette.blue },
  };
  details.getRange(`B4:E${totalRow}`).format.numberFormat = '"$"#,##0;[Red]("$"#,##0);-';
  details.getRange(`F4:F${totalRow}`).format.numberFormat = "0.0%";
  details.getRange("A:A").format.columnWidth = 27;
  details.getRange("B:F").format.columnWidth = 18;
  details.getRange("G:G").format.columnWidth = 17;
  details.getRange("H:H").format.columnWidth = 42;
  details.getRange(`A1:H${totalRow}`).format.wrapText = true;
  details.getRange(`A1:H${totalRow}`).format.autofitRows();
  details.freezePanes.freezeRows(3);

  await verifyAndExport(
    workbook,
    folder,
    "03_cost_report.xlsx",
    scenario.id,
    ["Cost Summary", "Cost Details"],
    ["Cost Summary!A1:F9", `Cost Details!A1:H${totalRow}`],
  );
}

async function buildRiskWorkbook(scenario, folder) {
  const workbook = Workbook.create();
  const latest = scenario.periods.at(-1);
  const risk = latest.risk;
  const summary = workbook.worksheets.add("Risk Summary");
  const register = workbook.worksheets.add("Risk Register");
  configureSheet(summary);
  configureSheet(register);

  summary.mergeCells("A1:F1");
  summary.getRange("A1").values = [["Current Risk Summary"]];
  summary.mergeCells("A2:F2");
  summary.getRange("A2").values = [[`${scenario.project} | ${latest.label}`]];
  summary.getRange("A4:B10").values = [
    ["Risk measure", "Current count"],
    ["Open critical risks", risk.open_critical_count],
    ["Open high risks", risk.open_high_count],
    ["High risks missing owner or mitigation", risk.high_risks_missing_owner_or_mitigation],
    ["Increased risks", risk.increased_risk_count],
    ["New high risks", risk.new_high_risk_count],
    ["Maximum mitigation overdue days", risk.max_mitigation_overdue_days],
  ];
  summary.getRange("D4:F4").values = [["Condition", "Management decision", "Evidence rule"]];
  summary.getRange("D5:F6").values = [
    [
      latest.expected.risk_condition.replaceAll("_", " "),
      latest.decision,
      "Counts represent explicit open risks for this reporting period",
    ],
    ["Reporting period", latest.label, "Do not infer zero from missing evidence"],
  ];
  styleTitle(summary, "A1:F1", "A2:F2");
  styleHeader(summary.getRange("A4:B4"));
  styleHeader(summary.getRange("D4:F4"));
  styleBody(summary.getRange("A5:B10"));
  styleBody(summary.getRange("D5:F6"));
  summary.getRange("A:A").format.columnWidth = 39;
  summary.getRange("B:B").format.columnWidth = 18;
  summary.getRange("C:C").format.columnWidth = 3;
  summary.getRange("D:D").format.columnWidth = 20;
  summary.getRange("E:E").format.columnWidth = 45;
  summary.getRange("F:F").format.columnWidth = 38;
  summary.getRange("A1:F10").format.wrapText = true;
  summary.getRange("A1:F10").format.autofitRows();
  summary.freezePanes.freezeRows(4);

  register.mergeCells("A1:I1");
  register.getRange("A1").values = [[`${scenario.project} | ${latest.label}`]];
  register.getRange("A3:I3").values = [[
    "Risk ID",
    "Risk description",
    "Probability",
    "Impact",
    "Severity",
    "Mitigation plan",
    "Owner",
    "Mitigation due date",
    "Status",
  ]];
  register.getRange(`A4:I${3 + scenario.risk_rows.length}`).values = scenario.risk_rows;
  styleTitle(register, "A1:I1");
  styleHeader(register.getRange("A3:I3"));
  styleBody(register.getRange(`A4:I${3 + scenario.risk_rows.length}`));
  register.getRange("A:A").format.columnWidth = 12;
  register.getRange("B:B").format.columnWidth = 46;
  register.getRange("C:E").format.columnWidth = 15;
  register.getRange("F:F").format.columnWidth = 48;
  register.getRange("G:G").format.columnWidth = 22;
  register.getRange("H:H").format.columnWidth = 20;
  register.getRange("I:I").format.columnWidth = 14;
  register.getRange(`A1:I${3 + scenario.risk_rows.length}`).format.wrapText = true;
  register.getRange(`A1:I${3 + scenario.risk_rows.length}`).format.autofitRows();
  register.freezePanes.freezeRows(3);
  register.getRange(`E4:E${3 + scenario.risk_rows.length}`).conditionalFormats.add(
    "containsText",
    { text: "Critical", format: { fill: "#FEE2E2", font: { bold: true, color: palette.red } } },
  );
  register.getRange(`E4:E${3 + scenario.risk_rows.length}`).conditionalFormats.add(
    "containsText",
    { text: "High", format: { fill: "#FEF3C7", font: { bold: true, color: palette.amber } } },
  );

  await verifyAndExport(
    workbook,
    folder,
    "04_risk_register.xlsx",
    scenario.id,
    ["Risk Summary", "Risk Register"],
    ["Risk Summary!A1:F10", `Risk Register!A1:I${3 + scenario.risk_rows.length}`],
  );
}

async function buildIssueWorkbook(scenario, folder) {
  const workbook = Workbook.create();
  const latest = scenario.periods.at(-1);
  const sheet = workbook.worksheets.add("Issue Log");
  const metadata = workbook.worksheets.add("Project Metadata");
  configureSheet(sheet);
  configureSheet(metadata);

  sheet.mergeCells("A1:G1");
  sheet.getRange("A1").values = [["Current Issue Log"]];
  sheet.mergeCells("A2:G2");
  sheet.getRange("A2").values = [[`${scenario.project} | ${latest.label}`]];
  sheet.getRange("A4:G4").values = [[
    "Issue ID",
    "Issue description",
    "Owner",
    "Due date",
    "Status",
    "Severity",
    "Current note",
  ]];
  sheet.getRange(`A5:G${4 + scenario.issue_rows.length}`).values = scenario.issue_rows;
  styleTitle(sheet, "A1:G1", "A2:G2");
  styleHeader(sheet.getRange("A4:G4"));
  styleBody(sheet.getRange(`A5:G${4 + scenario.issue_rows.length}`));
  sheet.getRange("A:A").format.columnWidth = 12;
  sheet.getRange("B:B").format.columnWidth = 45;
  sheet.getRange("C:C").format.columnWidth = 22;
  sheet.getRange("D:D").format.columnWidth = 17;
  sheet.getRange("E:F").format.columnWidth = 15;
  sheet.getRange("G:G").format.columnWidth = 42;
  sheet.getRange(`A1:G${4 + scenario.issue_rows.length}`).format.wrapText = true;
  sheet.getRange(`A1:G${4 + scenario.issue_rows.length}`).format.autofitRows();
  sheet.freezePanes.freezeRows(4);

  metadata.getRange("A1:B6").values = [
    ["Field", "Value"],
    ["Project", scenario.project],
    ["Organization", scenario.organization],
    ["Reporting period", latest.label],
    ["Purpose", "Open project issues supporting the automatic assessment"],
    ["Management decision", latest.decision],
  ];
  styleHeader(metadata.getRange("A1:B1"));
  styleBody(metadata.getRange("A2:B6"));
  metadata.getRange("A:A").format.columnWidth = 26;
  metadata.getRange("B:B").format.columnWidth = 70;
  metadata.getRange("A1:B6").format.wrapText = true;
  metadata.getRange("A1:B6").format.autofitRows();
  metadata.freezePanes.freezeRows(1);

  await verifyAndExport(
    workbook,
    folder,
    "05_issue_log.xlsx",
    scenario.id,
    ["Issue Log", "Project Metadata"],
    [`Issue Log!A1:G${4 + scenario.issue_rows.length}`, "Project Metadata!A1:B6"],
  );
}

function configureSheet(sheet) {
  sheet.showGridLines = false;
}

function styleTitle(sheet, titleRange, subtitleRange) {
  sheet.getRange(titleRange).format = {
    fill: palette.white,
    font: { bold: true, color: palette.ink, size: 20 },
    verticalAlignment: "center",
  };
  sheet.getRange(titleRange).format.rowHeight = 34;
  if (subtitleRange) {
    sheet.getRange(subtitleRange).format = {
      fill: palette.white,
      font: { bold: true, color: palette.blue, size: 12 },
      verticalAlignment: "center",
    };
    sheet.getRange(subtitleRange).format.rowHeight = 24;
  }
}

function styleHeader(range) {
  range.format = {
    fill: palette.blue,
    font: { bold: true, color: palette.white },
    borders: { preset: "all", style: "thin", color: palette.blue },
    verticalAlignment: "center",
    wrapText: true,
  };
  range.format.rowHeight = 26;
}

function styleBody(range) {
  range.format = {
    fill: palette.white,
    font: { color: palette.ink },
    borders: {
      insideHorizontal: { style: "thin", color: palette.line },
      bottom: { style: "thin", color: palette.line },
    },
    verticalAlignment: "center",
    wrapText: true,
  };
}

async function verifyAndExport(
  workbook,
  folder,
  fileName,
  scenarioId,
  sheetNames,
  inspectRanges,
) {
  for (let index = 0; index < sheetNames.length; index += 1) {
    const inspect = await workbook.inspect({
      kind: "table",
      range: inspectRanges[index],
      include: "values,formulas",
      tableMaxRows: 20,
      tableMaxCols: 12,
    });
    if (!inspect.ndjson || inspect.ndjson.includes("#REF!")) {
      throw new Error(`Workbook verification failed for ${fileName} ${sheetNames[index]}`);
    }

    const preview = await workbook.render({
      sheetName: sheetNames[index],
      autoCrop: "all",
      scale: 1,
      format: "png",
    });
    const previewName = `${scenarioId}-${path.parse(fileName).name}-${index + 1}.png`;
    await fs.writeFile(
      path.join(previewRoot, previewName),
      new Uint8Array(await preview.arrayBuffer()),
    );
  }

  const errors = await workbook.inspect({
    kind: "match",
    searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
    options: { useRegex: true, maxResults: 100 },
    summary: `formula error scan for ${fileName}`,
  });
  if (errors.ndjson && /#REF!|#DIV\/0!|#VALUE!|#NAME\?|#N\/A/.test(errors.ndjson)) {
    throw new Error(`Formula error detected in ${fileName}: ${errors.ndjson}`);
  }

  const output = await SpreadsheetFile.exportXlsx(workbook);
  const outputPath = path.join(folder, fileName);
  await output.save(outputPath);
  await fs.rm(`${outputPath}.inspect.ndjson`, { force: true });
}
