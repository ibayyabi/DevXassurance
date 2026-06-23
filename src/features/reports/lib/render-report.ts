import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import PDFDocument from "pdfkit";

import { reportTypeLabels, type ReportType } from "@/features/reports/lib/constants";

export type RenderReportInput = {
  projectName: string;
  reportType: ReportType;
  reportingPeriod: string;
  generatedAt: Date;
  sections: Record<string, string>;
  evidenceCounts: Record<string, number>;
};

const sectionLabels: Record<string, string> = {
  project_health: "Project Health",
  key_findings: "Key Findings",
  critical_risks: "Critical Risks",
  recommended_actions: "Recommended Actions",
};

export async function renderReportPdf(input: RenderReportInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ margin: 52, size: "A4" });
    const chunks: Buffer[] = [];

    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);

    document
      .fontSize(18)
      .fillColor("#0f172a")
      .text("Project Assurance Report", { continued: false });
    document.moveDown(0.4);
    document.fontSize(11).fillColor("#334155");
    document.text(`Project: ${input.projectName}`);
    document.text(`Report type: ${reportTypeLabels[input.reportType]}`);
    document.text(`Reporting period: ${input.reportingPeriod}`);
    document.text(`Generated: ${input.generatedAt.toLocaleString("en-GB")}`);

    document.moveDown(1);
    Object.entries(input.sections).forEach(([key, value]) => {
      document.fontSize(13).fillColor("#0f172a").text(sectionLabels[key] ?? titleCase(key), {
        underline: false,
      });
      document.moveDown(0.25);
      document.fontSize(10.5).fillColor("#334155").text(cleanReportText(value), {
        lineGap: 3,
      });
      document.moveDown(0.8);
    });

    document.addPage();
    document.fontSize(14).fillColor("#0f172a").text("Evidence Appendix");
    document.moveDown(0.5);
    Object.entries(input.evidenceCounts).forEach(([key, value]) => {
      document
        .fontSize(10.5)
        .fillColor("#334155")
        .text(`${titleCase(key)}: ${value}`);
    });

    document.end();
  });
}

export async function renderReportDocx(input: RenderReportInput): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({
      text: "Project Assurance Report",
      heading: HeadingLevel.TITLE,
    }),
    new Paragraph({ text: `Project: ${input.projectName}` }),
    new Paragraph({ text: `Report type: ${reportTypeLabels[input.reportType]}` }),
    new Paragraph({ text: `Reporting period: ${input.reportingPeriod}` }),
    new Paragraph({ text: `Generated: ${input.generatedAt.toLocaleString("en-GB")}` }),
    new Paragraph({ text: "" }),
  ];

  Object.entries(input.sections).forEach(([key, value]) => {
    children.push(
      new Paragraph({
        text: sectionLabels[key] ?? titleCase(key),
        heading: HeadingLevel.HEADING_2,
      }),
      ...paragraphsFromText(value),
      new Paragraph({ text: "" }),
    );
  });

  children.push(
    new Paragraph({
      text: "Evidence Appendix",
      heading: HeadingLevel.HEADING_2,
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: Object.entries(input.evidenceCounts).map(
        ([key, value]) =>
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph(titleCase(key))] }),
              new TableCell({ children: [new Paragraph(String(value))] }),
            ],
          }),
      ),
    }),
  );

  const document = new Document({
    sections: [{ children }],
  });

  return Buffer.from(await Packer.toBuffer(document));
}

function paragraphsFromText(value: string) {
  return cleanReportText(value)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(
      (line) =>
        new Paragraph({
          children: [new TextRun(line)],
          spacing: { after: 120 },
        }),
    );
}

function cleanReportText(value: string) {
  return value.trim() || "No evidence-backed content available.";
}

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
