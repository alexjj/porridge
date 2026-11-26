// Reading files out of a ZIP without loading all of it: the directory at the
// end of the file says where each file is, so only the parts asked for are
// read (a micro.blog archive can be hundreds of megabytes). Deflated files are
// unpacked with the browser's own DecompressionStream.

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

const read = async (blob: Blob, start: number, end: number) => new DataView(await blob.slice(start, end).arrayBuffer());

/** The files in a ZIP, by name. Throws if `blob` isn't a ZIP. */
export async function listZip(blob: Blob): Promise<Map<string, ZipEntry>> {
  // The end-of-directory record is in the last 22 bytes, or up to 64 KB earlier with a comment.
  const tailStart = Math.max(0, blob.size - 22 - 0xffff);
  const tail = await read(blob, tailStart, blob.size);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("This file isn't a ZIP archive.");
  let count = tail.getUint16(eocd + 10, true);
  let dirSize = tail.getUint32(eocd + 12, true);
  let dirOffset = tail.getUint32(eocd + 16, true);
  // ZIP64 (over 4 GB, or very many files): the real numbers are in another record.
  if (dirOffset === 0xffffffff || count === 0xffff) {
    const loc = eocd - 20;
    if (loc >= 0 && tail.getUint32(loc, true) === ZIP64_LOCATOR) {
      const at = Number(tail.getBigUint64(loc + 8, true));
      const rec = await read(blob, at, at + 56);
      if (rec.getUint32(0, true) !== ZIP64_EOCD) throw new Error("This ZIP archive is damaged.");
      count = Number(rec.getBigUint64(32, true));
      dirSize = Number(rec.getBigUint64(40, true));
      dirOffset = Number(rec.getBigUint64(48, true));
    }
  }

  const dir = await read(blob, dirOffset, dirOffset + dirSize);
  const names = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  let p = 0;
  for (let n = 0; n < count && p + 46 <= dir.byteLength; n++) {
    if (dir.getUint32(p, true) !== CENTRAL) throw new Error("This ZIP archive is damaged.");
    const method = dir.getUint16(p + 10, true);
    let compressedSize = dir.getUint32(p + 20, true);
    let size = dir.getUint32(p + 24, true);
    const nameLen = dir.getUint16(p + 28, true);
    const extraLen = dir.getUint16(p + 30, true);
    const commentLen = dir.getUint16(p + 32, true);
    let offset = dir.getUint32(p + 42, true);
    const name = names.decode(new Uint8Array(dir.buffer, dir.byteOffset + p + 46, nameLen));
    // ZIP64 sizes and offset, for whichever were too big.
    let e = p + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = dir.getUint16(e, true);
      const len = dir.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) (size = Number(dir.getBigUint64(q, true))), (q += 8);
        if (compressedSize === 0xffffffff) (compressedSize = Number(dir.getBigUint64(q, true))), (q += 8);
        if (offset === 0xffffffff) offset = Number(dir.getBigUint64(q, true));
      }
      e += 4 + len;
    }
    if (!name.endsWith("/")) entries.set(name, { name, method, compressedSize, size, offset });
    p = extraEnd + commentLen;
  }
  return entries;
}

/** One file's contents. */
export async function readZipEntry(blob: Blob, entry: ZipEntry, type = ""): Promise<Blob> {
  const header = await read(blob, entry.offset, entry.offset + 30);
  if (header.getUint32(0, true) !== LOCAL) throw new Error(`${entry.name}: this ZIP archive is damaged.`);
  const start = entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  const data = blob.slice(start, start + entry.compressedSize);
  if (entry.method === 0) return new Blob([data], { type });
  if (entry.method !== 8) throw new Error(`${entry.name} is compressed in a way this browser can't open.`);
  const stream = data.stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Blob([await new Response(stream).arrayBuffer()], { type });
}
