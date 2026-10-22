// Reading a ZIP archive: DOCX, TextPack and EPUB are ZIPs underneath. The
// central directory at the archive's end says what is in it and where; each
// entry is stored or DEFLATE-compressed, and the DEFLATE is undone by the
// platform's own DecompressionStream('deflate-raw') (Safari 16.4+, Chrome,
// Node 22), so there is no decompressor here. Every entry's CRC-32 is checked,
// so a damaged file says so instead of importing garbage. ZIP64 archives
// (more than 65,535 entries or 4 GB) are read too; split, encrypted and
// otherwise compressed archives are refused with a plain message.
import { crc32 } from '../export/zip.js';

export class ZipError extends Error {}

const MAX_ENTRY = 1 << 30;       // 1 GB: more than a document holds, less than a zip bomb wants

// the old DOS code page names are in when an archive does not mark them as UTF-8
const CP437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

function decodeName(bytes, utf8Flag) {
  if (!utf8Flag) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {
      let s = '';
      for (const b of bytes) s += b < 0x80 ? String.fromCharCode(b) : CP437[b - 0x80];
      return s;
    }
  }
  return new TextDecoder().decode(bytes);
}

/** A DEFLATE stream undone, which must come to `size` bytes. */
async function inflate(data, size, name) {
  if (typeof DecompressionStream !== 'function') throw new ZipError('this browser cannot read compressed ZIP files (it has no DecompressionStream)');
  let ds;
  try { ds = new DecompressionStream('deflate-raw'); } catch { throw new ZipError('this browser cannot read compressed ZIP files (no deflate-raw)'); }
  const writer = ds.writable.getWriter();
  writer.write(data).catch(() => {});
  writer.close().catch(() => {});
  const reader = ds.readable.getReader();
  const out = new Uint8Array(size);
  let at = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (at + value.length > size) throw new ZipError(`${name} is larger than the archive says: the file is damaged`);
      out.set(value, at);
      at += value.length;
    }
  } catch (e) {
    reader.cancel().catch(() => {});
    if (e instanceof ZipError) throw e;
    throw new ZipError(`${name} could not be decompressed: the file is damaged`);
  }
  if (at !== size) throw new ZipError(`${name} is shorter than the archive says: the file is damaged`);
  return out;
}

/** The central directory's place, from the end record (or its ZIP64 form). */
function findDirectory(bytes, v) {
  const n = bytes.length;
  if (n < 22) throw new ZipError('not a ZIP archive (too short)');
  const stop = Math.max(0, n - 22 - 0xFFFF);
  for (let i = n - 22; i >= stop; i--) {
    if (v.getUint32(i, true) !== 0x06054B50) continue;
    const disk = v.getUint16(i + 4, true), cdDisk = v.getUint16(i + 6, true);
    let count = v.getUint16(i + 10, true);
    let size = v.getUint32(i + 12, true), offset = v.getUint32(i + 16, true);
    if (count === 0xFFFF || size === 0xFFFFFFFF || offset === 0xFFFFFFFF) {
      // ZIP64: a locator just before the end record points at the larger record
      const loc = i - 20;
      if (loc < 0 || v.getUint32(loc, true) !== 0x07064B50) throw new ZipError('a ZIP64 archive without its locator: the file is damaged');
      const at = Number(v.getBigUint64(loc + 8, true));
      if (at + 56 > n || v.getUint32(at, true) !== 0x06064B50) throw new ZipError('a ZIP64 archive whose directory record is missing: the file is damaged');
      count = Number(v.getBigUint64(at + 32, true));
      size = Number(v.getBigUint64(at + 40, true));
      offset = Number(v.getBigUint64(at + 48, true));
      return { count, size, offset };
    }
    if (disk !== 0 || cdDisk !== 0) throw new ZipError('a ZIP archive split across several files cannot be read');
    if (offset + size > i) continue;     // the signature was in a comment
    return { count, size, offset };
  }
  throw new ZipError('not a ZIP archive');
}

/**
 * The files in a ZIP archive.
 * @param {Uint8Array|ArrayBuffer} input
 * @param {{filter?: (name: string) => boolean}} [opts]  only the entries the filter keeps are
 *   decompressed and checked (the others are not read at all)
 * @returns {Promise<Map<string, Uint8Array>>}  by name, folders left out
 * @throws {ZipError} when the archive is damaged (CRC-32, sizes, structure) or uses what cannot be read
 */
export async function unzip(input, opts = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dir = findDirectory(bytes, v);
  const entries = [];
  let i = dir.offset;
  for (let k = 0; k < dir.count; k++) {
    if (i + 46 > bytes.length || v.getUint32(i, true) !== 0x02014B50) throw new ZipError('the ZIP archive\'s directory is damaged');
    const flags = v.getUint16(i + 8, true), method = v.getUint16(i + 10, true);
    const crc = v.getUint32(i + 16, true);
    let csize = v.getUint32(i + 20, true), size = v.getUint32(i + 24, true);
    const nlen = v.getUint16(i + 28, true), elen = v.getUint16(i + 30, true), clen = v.getUint16(i + 32, true);
    let local = v.getUint32(i + 42, true);
    const name = decodeName(bytes.subarray(i + 46, i + 46 + nlen), flags & 0x0800);
    // ZIP64's sizes and offset, for those the directory marks as too large for it
    for (let e = i + 46 + nlen; e + 4 <= i + 46 + nlen + elen;) {
      const id = v.getUint16(e, true), len = v.getUint16(e + 2, true);
      if (id === 0x0001) {
        let p = e + 4;
        if (size === 0xFFFFFFFF) { size = Number(v.getBigUint64(p, true)); p += 8; }
        if (csize === 0xFFFFFFFF) { csize = Number(v.getBigUint64(p, true)); p += 8; }
        if (local === 0xFFFFFFFF) { local = Number(v.getBigUint64(p, true)); p += 8; }
      }
      e += 4 + len;
    }
    entries.push({ name, flags, method, crc, csize, size, local });
    i += 46 + nlen + elen + clen;
  }
  const out = new Map();
  await Promise.all(entries.map(async (e) => {
    if (e.name.endsWith('/') || (opts.filter && !opts.filter(e.name))) return;
    if (e.flags & 0x0001) throw new ZipError(`${e.name} is encrypted: the archive needs a password`);
    if (e.local + 30 > bytes.length || v.getUint32(e.local, true) !== 0x04034B50) throw new ZipError(`${e.name}: the archive is damaged`);
    const start = e.local + 30 + v.getUint16(e.local + 26, true) + v.getUint16(e.local + 28, true);
    if (start + e.csize > bytes.length) throw new ZipError(`${e.name} is cut short: the file is incomplete`);
    if (e.size > MAX_ENTRY) throw new ZipError(`${e.name} is too large to read (${Math.round(e.size / 1048576)} MB)`);
    const raw = bytes.subarray(start, start + e.csize);
    let data;
    if (e.method === 0) {
      if (e.csize !== e.size) throw new ZipError(`${e.name}: its sizes disagree, the archive is damaged`);
      data = raw;
    } else if (e.method === 8) data = await inflate(raw, e.size, e.name);
    else {
      const what = { 9: 'Deflate64', 12: 'BZIP2', 14: 'LZMA', 93: 'Zstandard', 95: 'XZ', 99: 'AES encryption' }[e.method] || `method ${e.method}`;
      throw new ZipError(`${e.name} is compressed with ${what}, which cannot be read here: save the archive again with ordinary (Deflate) compression`);
    }
    if (crc32(data) !== e.crc) throw new ZipError(`${e.name} fails its CRC-32 check: the file is damaged`);
    out.set(e.name, data);
  }));
  // in the archive's order, whatever order the decompression finished in
  return new Map(entries.filter((e) => out.has(e.name)).map((e) => [e.name, out.get(e.name)]));
}
