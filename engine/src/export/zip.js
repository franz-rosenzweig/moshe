// A minimal ZIP writer, for the formats that are ZIPs underneath: DOCX, EPUB
// and TextPack. Files are stored, not compressed, which every reader
// accepts and which EPUB requires of its first file anyway; the documents are
// small, and a DEFLATE here would be the largest thing in the exporter.
//
// EPUB asks that `mimetype` be the first entry, stored, with no extra field:
// entries are written in the order given and never carry an extra field, so
// putting it first is enough. A name that is not plain ASCII is marked as
// UTF-8 (general purpose bit 11); a plain one is left unmarked, as the EPUB
// spec's own examples are.

const encoder = new TextEncoder();

let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c >>> 0;
  }
  return CRC_TABLE;
}

/** The CRC-32 (the ZIP and PNG one) of some bytes. */
export function crc32(bytes) {
  const t = crcTable();
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** A date as MS-DOS's time and date words, which is how ZIP keeps them. */
function dosTime(d) {
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * A ZIP archive of some files, stored.
 * @param {{name: string, data?: Uint8Array|string}[]} entries  in order; a name ending in / is a folder
 * @param {{date?: Date}} [opts]  the files' modification time (now by default)
 * @returns {Uint8Array}
 */
export function createZip(entries, opts = {}) {
  const { time, date } = dosTime(opts.date || new Date());
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = encoder.encode(e.name);
    const data = typeof e.data === 'string' ? encoder.encode(e.data) : e.data || new Uint8Array(0);
    const folder = e.name.endsWith('/');
    const flags = /[^\x20-\x7E]/u.test(e.name) ? 0x0800 : 0;
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034B50, true);
    lv.setUint16(4, 20, true);                // version needed: 2.0
    lv.setUint16(6, flags, true);
    lv.setUint16(8, 0, true);                 // method: stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);      // compressed size
    lv.setUint32(22, data.length, true);      // size
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);                // no extra field
    local.set(name, 30);
    locals.push(local, data);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014B50, true);
    cv.setUint16(4, 0x0314, true);            // made by: Unix, 2.0 (so the permissions below are read)
    cv.setUint16(6, 20, true);
    cv.setUint16(8, flags, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true);                // extra
    cv.setUint16(32, 0, true);                // comment
    cv.setUint16(34, 0, true);                // disk
    cv.setUint16(36, 0, true);                // internal attributes
    cv.setUint32(38, ((folder ? 0o40755 : 0o100644) << 16 | (folder ? 0x10 : 0)) >>> 0, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054B50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + end.length);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) { out.set(part, at); at += part.length; }
  return out;
}
