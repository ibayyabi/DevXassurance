import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import JSZip from "jszip";

const source = readFileSync("src/features/documents/lib/zip-safety.ts", "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { inspectZipDirectory, isSafeArchiveMemberPath, markDuplicateContent, verifyZipMemberChecksum, hasEvidenceSignature, readZipMember } = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);

test("ZIP preflight accepts a bounded archive", async () => {
  const zip = new JSZip();
  zip.file("reports/monthly.csv", "period,cost\n2026-09,12");
  inspectZipDirectory(await zip.generateAsync({ type: "nodebuffer" }));
});
test("generated JSZip members stream within bounds and match the central-directory CRC", async () => {
  const content = "Synthetic evidence member.";
  const zip = new JSZip();
  zip.file("reports/safe.txt", content);
  const archiveBytes = await zip.generateAsync({ type: "nodebuffer" });
  inspectZipDirectory(archiveBytes);
  const archive = await JSZip.loadAsync(archiveBytes);
  const entry = archive.file("reports/safe.txt");
  assert.ok(entry);
  const expectedChecksum = entry._data?.crc32;
  assert.equal(typeof expectedChecksum, "number", "generated ZIP should expose its central-directory CRC");
  const memberBytes = await readZipMember(entry, 128, 128);
  verifyZipMemberChecksum(memberBytes, expectedChecksum);
  assert.equal(memberBytes.toString(), content);
  const corruptBytes = Buffer.from(memberBytes);
  corruptBytes[0] ^= 1;
  assert.throws(() => verifyZipMemberChecksum(corruptBytes, expectedChecksum), /member-corrupt/);
});

test("declared ZIP expansion is rejected before opening the member stream", async () => {
  const zip = new JSZip();
  zip.file("report.txt", "x".repeat(128));
  const archive = await JSZip.loadAsync(await zip.generateAsync({ type: "nodebuffer" }));
  const entry = archive.file("report.txt");
  assert.ok(entry);
  let opened = false;
  const guardedEntry = {
    _data: entry._data,
    nodeStream(type) {
      opened = true;
      return entry.nodeStream(type);
    },
  };
  await assert.rejects(readZipMember(guardedEntry, 64, 128), /expanded-size-limit/);
  await assert.rejects(readZipMember(guardedEntry, 64, 64), /member-size-limit/);
  assert.equal(opened, false);
});
test("generated ZIP member streams stop at per-member and archive expansion limits", async () => {
  const zip = new JSZip();
  zip.file("report.txt", "x".repeat(128));
  const archive = await JSZip.loadAsync(await zip.generateAsync({ type: "nodebuffer" }));
  const entry = archive.file("report.txt");
  assert.ok(entry);
  await assert.rejects(readZipMember(entry, 64, 128), /expanded-size-limit/);
  await assert.rejects(readZipMember(entry, 64, 64), /member-size-limit/);
});

test("ZIP preflight rejects archives above the member limit", async () => {
  const zip = new JSZip();
  for (let index = 0; index < 251; index += 1) zip.file(`member-${index}.txt`, "x");
  const bytes = await zip.generateAsync({ type: "nodebuffer" });
  assert.throws(() => inspectZipDirectory(bytes), /zip-limit/);
});

test("Office package preflight rejects pathological central directories before member loading", async () => {
  const officePackage = new JSZip();
  for (let index = 0; index < 251; index += 1) officePackage.file(`word/member-${index}.xml`, "x");
  const bytes = await officePackage.generateAsync({ type: "nodebuffer" });
  assert.throws(() => inspectZipDirectory(bytes), /zip-limit/);
});

test("archive member paths reject traversal and absolute paths", () => {
  assert.equal(isSafeArchiveMemberPath("reports/weekly.csv"), true);
  assert.equal(isSafeArchiveMemberPath("../outside.csv"), false);
  assert.equal(isSafeArchiveMemberPath("C:\\temp\\outside.csv"), false);
  assert.equal(isSafeArchiveMemberPath("/tmp/outside.csv"), false);
});

test("ZIP preflight rejects corrupt archives", () => {
  assert.throws(() => inspectZipDirectory(Buffer.from("not a zip")), /invalid-zip/);
});
test("member checksums reject corrupt contents", () => {
  verifyZipMemberChecksum(Buffer.from("hello"), 0x3610a686);
  assert.throws(() => verifyZipMemberChecksum(Buffer.from("hell0"), 0x3610a686), /member-corrupt/);
});

test("identical member content is detected for a duplicate warning", () => {
  const seenHashes = new Set();
  assert.equal(markDuplicateContent("sha256:same", seenHashes), false);
  assert.equal(markDuplicateContent("sha256:same", seenHashes), true);
  assert.equal(seenHashes.size, 1);
});

test("file signatures must match declared evidence formats", () => {
  assert.equal(hasEvidenceSignature(Buffer.from("%PDF-1.7"), "report.pdf"), true);
  assert.equal(hasEvidenceSignature(Buffer.from("<html>"), "report.pdf"), false);
  assert.equal(hasEvidenceSignature(Buffer.from([0x50, 0x4b, 0x03, 0x04]), "sheet.xlsx"), true);
  assert.equal(hasEvidenceSignature(Buffer.from("plain text"), "report.txt"), true);
});
