export const maxArchiveMembers = 250;
export const maxExpandedArchiveBytes = 200 * 1024 * 1024;

export function isSafeArchiveMemberPath(name: string) {
  const normalized = name.replaceAll("\\", "/");
  const segments = normalized.split("/");
  return !normalized.startsWith("/") &&
    !/^[a-zA-Z]:/.test(normalized) &&
    !segments.some((segment) => segment === "." || segment === "..");
}

export function inspectZipDirectory(
  bytes: Buffer,
  limits: {
    maxMembers?: number;
    maxEntryExpandedBytes?: number;
    maxExpandedBytes?: number;
  } = {},
) {
  const maxMembers = limits.maxMembers ?? maxArchiveMembers;
  const maxEntryExpandedBytes = limits.maxEntryExpandedBytes ?? maxExpandedArchiveBytes;
  const maxExpandedBytes = limits.maxExpandedBytes ?? maxExpandedArchiveBytes;
  const start = Math.max(0, bytes.length - 65_557);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= start; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0) throw new Error("invalid-zip");
  const commentLength = bytes.readUInt16LE(end + 20);
  if (end + 22 + commentLength !== bytes.length) throw new Error("invalid-zip");
  const count = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  const directoryOffset = bytes.readUInt32LE(end + 16);
  if (count === 0xffff || directoryOffset === 0xffffffff || directorySize === 0xffffffff || count > maxMembers) throw new Error("zip-limit");
  if (directoryOffset + directorySize > end) throw new Error("invalid-zip");
  let offset = directoryOffset;
  let totalExpanded = 0;
  for (let index = 0; index < count; index += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error("invalid-zip");
    const flags = bytes.readUInt16LE(offset + 8);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const expandedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    if ((flags & 0x41) !== 0 || expandedSize === 0xffffffff || compressedSize === 0xffffffff) throw new Error("encrypted-or-zip64");
    if (expandedSize > maxEntryExpandedBytes) throw new Error("zip-limit");
    totalExpanded += expandedSize;
    if (totalExpanded > maxExpandedBytes) throw new Error("zip-limit");
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== directoryOffset + directorySize) throw new Error("invalid-zip");
}

const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

export function verifyZipMemberChecksum(bytes: Uint8Array, expected: number) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  if (((crc ^ 0xffffffff) >>> 0) !== (expected >>> 0)) throw new Error("member-corrupt");
}
type ZipMemberSource = {
  _data?: { uncompressedSize?: number };
  nodeStream(type?: "nodebuffer"): NodeJS.ReadableStream;
};
type DestroyableReadable = NodeJS.ReadableStream & { destroy(): void };

export function readZipMember(entry: ZipMemberSource, limit: number, memberLimit: number): Promise<Buffer> {
  if (!Number.isSafeInteger(limit) || limit <= 0) return Promise.reject(new Error("expanded-size-limit"));
  if (!Number.isSafeInteger(memberLimit) || memberLimit <= 0) return Promise.reject(new Error("member-size-limit"));
  const declaredSize = entry._data?.uncompressedSize;
  if (typeof declaredSize !== "number" || !Number.isSafeInteger(declaredSize) || declaredSize < 0) {
    return Promise.reject(new Error("member-corrupt"));
  }
  if (declaredSize > memberLimit) return Promise.reject(new Error("member-size-limit"));
  if (declaredSize > limit) return Promise.reject(new Error("expanded-size-limit"));
  const stream = entry.nodeStream("nodebuffer") as DestroyableReadable;
  const chunks: Buffer[] = [];
  let size = 0;
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      stream.destroy();
      reject(new Error(message));
    };
    stream.on("data", (chunk: Buffer) => {
      if (settled) return;
      size += chunk.byteLength;
      if (size > limit) {
        fail(size > memberLimit ? "member-size-limit" : "expanded-size-limit");
        return;
      }
      chunks.push(chunk);
    });
    stream.on("error", () => fail("member-corrupt"));
    stream.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, size));
    });
  });
}

export function markDuplicateContent(contentHash: string, seenHashes: Set<string>) {
  const duplicate = seenHashes.has(contentHash);
  seenHashes.add(contentHash);
  return duplicate;
}

export function hasEvidenceSignature(bytes: Uint8Array, fileName: string) {
  const extension = fileName.toLowerCase().split(".").at(-1);
  const starts = (...values: number[]) =>
    values.every((value, index) => bytes[index] === value);
  if (extension === "pdf") return starts(0x25, 0x50, 0x44, 0x46, 0x2d);
  if (extension === "png") return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (extension === "jpg" || extension === "jpeg") return starts(0xff, 0xd8, 0xff);
  if (extension === "bmp") return starts(0x42, 0x4d);
  if (extension === "webp") {
    return bytes.length >= 12 &&
      starts(0x52, 0x49, 0x46, 0x46) &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  }
  if (extension === "ppt") {
    return starts(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
  }
  if (extension === "tif" || extension === "tiff") {
    return starts(0x49, 0x49, 0x2a, 0x00) || starts(0x4d, 0x4d, 0x00, 0x2a);
  }
  if (["docx", "xlsx", "pptx"].includes(extension ?? "")) {
    return starts(0x50, 0x4b, 0x03, 0x04);
  }
  return !bytes.includes(0);
}
