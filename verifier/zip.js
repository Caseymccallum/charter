/**
 * A ZIP reader for the three entries a `.charter` file may contain.
 *
 * Dependency-free and browser-safe: the only platform facility used is
 * DecompressionStream, which is how a deflated entry is expanded without a
 * copy of zlib. The reader is deliberately strict about the container, because
 * a container that can hold bytes nobody accounts for can hide a second copy
 * of a file from a reader that trusts filename lookups.
 *
 * @module verifier/zip
 */

import { concat, utf8Decode } from './bytes.js';
import { crc32 } from './crc32.js';
import { LIMITS } from './limits.js';
import { REASON, STATUS } from './status.js';

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL_DIRECTORY = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

/** Stored, no compression. */
export const METHOD_STORED = 0;
/** Raw deflate. */
export const METHOD_DEFLATE = 8;

/**
 * General purpose bits the verifier tolerates.
 *
 * 0x0002 and 0x0004 are compression-level hints, 0x0800 says the name is
 * UTF-8. Anything else (encryption, a trailing data descriptor, a masked
 * header, a patched payload) is a feature this verifier does not implement and
 * is reported as UNSUPPORTED rather than ignored.
 */
const FLAGS_ALLOWED = 0x0002 | 0x0004 | 0x0800;

/**
 * The bits that change how an entry's bytes have to be read, as opposed to how
 * the writer happened to produce them. An archive that sets one of these is not
 * an archive this reader has read.
 */
const STRUCTURAL_FLAGS = 0x0001 | 0x0008 | 0x0020 | 0x0040 | 0x2000;

const FLAG_NAMES = new Map([
  [0x0001, 'encrypted'],
  [0x0008, 'data descriptor (sizes after the data)'],
  [0x0020, 'patched data'],
  [0x0040, 'strong encryption'],
  [0x2000, 'masked local header'],
  [0x4000, 'reserved bit 14'],
]);

/** The highest ZIP feature level this reader implements (2.0). */
export const MAX_VERSION_NEEDED = 20;

/**
 * The one "version made by" a charter/0.1 file may declare: 2.0 on host 0
 * (MS-DOS), which is what a tool that is not a file system writes.
 */
const VERSION_MADE_BY = 0x0014;

/**
 * The one DOS date and time a charter/0.1 file may declare.
 *
 * 1980-01-01 00:00:00 is the earliest instant a DOS date field can hold, so it
 * is that field's "no time" value rather than a reading of a clock. The format
 * fixes it because a file whose bytes are the record cannot also carry a stamp:
 * with one, the same document written twice would be two files, and a reader
 * that ignored the stamp would call both of them the same document.
 */
const DOS_DATE = 0x0021;
const DOS_TIME = 0;

const ZIP64_MARKER_16 = 0xffff;
const ZIP64_MARKER_32 = 0xffffffff;

function u16(bytes, at) {
  return bytes[at] | (bytes[at + 1] << 8);
}

function u32(bytes, at) {
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
}

function describeFlags(flags) {
  const names = [];
  for (const [bit, name] of FLAG_NAMES) {
    if ((flags & bit) !== 0) names.push(name);
  }
  const unknown = flags & ~(FLAGS_ALLOWED | STRUCTURAL_FLAGS | 0x4000);
  if (unknown !== 0) names.push(`unknown bits 0x${unknown.toString(16)}`);
  return names.length === 0 ? `0x${flags.toString(16)}` : names.join(', ');
}

/**
 * Find the end-of-central-directory record.
 *
 * Searches backwards, so the record nearest the end of the file wins. A record
 * whose declared comment would run past the end of the file is rejected, which
 * is what keeps bytes appended after the archive from being mistaken for a
 * comment.
 *
 * @param {Uint8Array} bytes
 * @param {number} searchBytes
 * @returns {{ at: number, commentLength: number } | null}
 */
function findEndOfCentralDirectory(bytes, searchBytes) {
  if (bytes.length < 22) return null;
  const lowest = Math.max(0, bytes.length - 22 - searchBytes);
  for (let at = bytes.length - 22; at >= lowest; at -= 1) {
    if (u32(bytes, at) !== SIG_EOCD) continue;
    const commentLength = u16(bytes, at + 20);
    if (at + 22 + commentLength > bytes.length) continue;
    return { at, commentLength };
  }
  return null;
}

/**
 * Parse the central directory into entry records.
 *
 * @param {Uint8Array} bytes
 * @param {{ cdOffset: number, cdSize: number, totalEntries: number }} end
 * @returns {{ ok: true, entries: object[], cursor: number } | { ok: false, reason_code: string, detail: string }}
 */
function readCentralDirectory(bytes, end) {
  const entries = [];
  let at = end.cdOffset;
  for (let index = 0; index < end.totalEntries; index += 1) {
    if (at + 46 > bytes.length) {
      return { ok: false, reason_code: REASON.MALFORMED, detail: `central directory entry ${index + 1} of ${end.totalEntries} starts past the end of the file` };
    }
    if (u32(bytes, at) !== SIG_CENTRAL_DIRECTORY) {
      return { ok: false, reason_code: REASON.MALFORMED, detail: `central directory entry ${index + 1} does not start with the central directory signature (offset ${at})` };
    }
    const flags = u16(bytes, at + 8);
    const method = u16(bytes, at + 10);
    const crc = u32(bytes, at + 16);
    const compressedSize = u32(bytes, at + 20);
    const uncompressedSize = u32(bytes, at + 24);
    const nameLength = u16(bytes, at + 28);
    const extraLength = u16(bytes, at + 30);
    const commentLength = u16(bytes, at + 32);
    const localOffset = u32(bytes, at + 42);
    const nameStart = at + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > bytes.length) {
      return { ok: false, reason_code: REASON.MALFORMED, detail: `the name of central directory entry ${index + 1} runs past the end of the file` };
    }
    const nameBytes = bytes.slice(nameStart, nameEnd);
    const decoded = utf8Decode(nameBytes);
    if (!decoded.ok) {
      return { ok: false, reason_code: REASON.DECODE_ERROR, detail: `the name of central directory entry ${index + 1} is not valid UTF-8` };
    }
    entries.push({
      index,
      name: decoded.text,
      nameBytes,
      versionMadeBy: u16(bytes, at + 4),
      versionNeeded: u16(bytes, at + 6),
      flags,
      method,
      time: u16(bytes, at + 12),
      date: u16(bytes, at + 14),
      crc32: crc,
      compressedSize,
      uncompressedSize,
      diskNumber: u16(bytes, at + 34),
      internalAttributes: u16(bytes, at + 36),
      externalAttributes: u32(bytes, at + 38),
      localOffset,
      extraLengthInCentral: extraLength,
      commentLengthInCentral: commentLength,
      centralOffset: at,
    });
    at = nameEnd + extraLength + commentLength;
  }
  return { ok: true, entries, cursor: at };
}

/**
 * Read every entry's local header and locate its data.
 *
 * @param {Uint8Array} bytes
 * @param {object[]} entries
 * @returns {{ ok: true } | { ok: false, reason_code: string, detail: string }}
 */
function locateEntryData(bytes, entries) {
  for (const entry of entries) {
    const at = entry.localOffset;
    if (at + 30 > bytes.length) {
      return { ok: false, reason_code: REASON.MALFORMED, detail: `the local header of "${entry.name}" starts past the end of the file (offset ${at})` };
    }
    if (u32(bytes, at) !== SIG_LOCAL) {
      return { ok: false, reason_code: REASON.MALFORMED, detail: `the local header of "${entry.name}" does not start with the local file header signature (offset ${at})` };
    }
    const localFlags = u16(bytes, at + 6);
    const localNameLength = u16(bytes, at + 26);
    const localExtraLength = u16(bytes, at + 28);
    if (localFlags !== entry.flags) {
      return { ok: false, reason_code: REASON.MISMATCH, detail: `"${entry.name}" declares flags 0x${entry.flags.toString(16)} in the central directory and 0x${localFlags.toString(16)} in its local header` };
    }
    // The claims a local header repeats. They are read and kept rather than
    // ignored, because a byte this reader never looks at is a byte a forged file
    // can change for free.
    entry.local = {
      versionNeeded: u16(bytes, at + 4),
      flags: localFlags,
      method: u16(bytes, at + 8),
      time: u16(bytes, at + 10),
      date: u16(bytes, at + 12),
      crc32: u32(bytes, at + 14),
      compressedSize: u32(bytes, at + 18),
      uncompressedSize: u32(bytes, at + 22),
    };
    const nameStart = at + 30;
    const nameEnd = nameStart + localNameLength;
    if (nameEnd + localExtraLength > bytes.length) {
      return { ok: false, reason_code: REASON.MALFORMED, detail: `the name or extra field of "${entry.name}" runs past the end of the file` };
    }
    const localName = bytes.slice(nameStart, nameEnd);
    if (localName.length !== entry.nameBytes.length) {
      return { ok: false, reason_code: REASON.MISMATCH, detail: `"${entry.name}" has a different name length in its local header than in the central directory` };
    }
    for (let i = 0; i < localName.length; i += 1) {
      if (localName[i] !== entry.nameBytes[i]) {
        return { ok: false, reason_code: REASON.MISMATCH, detail: `"${entry.name}" has a different name in its local header than in the central directory` };
      }
    }
    entry.dataOffset = nameEnd + localExtraLength;
    entry.dataEnd = entry.dataOffset + entry.compressedSize;
    if (entry.dataEnd > bytes.length) {
      return { ok: false, reason_code: REASON.MALFORMED, detail: `the data of "${entry.name}" ends past the end of the file (offset ${entry.dataEnd})` };
    }
    // Kept rather than forgotten: SPEC section 3.6 fixes this field at zero
    // bytes, and a length nothing compares is a length a forged file can set to
    // anything. `evaluateMetadata` is the check that reads it.
    entry.localExtraLength = localExtraLength;
  }
  return { ok: true };
}

/**
 * Check that the file is entirely accounted for: only headers, extra fields,
 * entry data, the central directory, and the end record, laid out in that
 * order, with nothing before, after, between, or overlapping.
 *
 * @param {Uint8Array} bytes
 * @param {object[]} entries
 * @param {{ at: number, commentLength: number, cdOffset: number, cdSize: number, cursor: number }} end
 * @returns {{ ok: boolean, reason_code: string, detail: string }}
 */
function evaluateLayout(bytes, entries, end) {
  let expected = 0;
  // The entries are walked in *file* order, which is not necessarily the order
  // the central directory lists them in. ZIP fixes no order for the directory,
  // and a writer that sorts its records by name produces a file whose entries
  // and whose directory ordering disagree while every byte is still exactly
  // where the format puts it. What the layout rule states is a property of the
  // byte ranges, so the ranges are what this walks.
  const inFileOrder = [...entries].sort((left, right) => left.localOffset - right.localOffset);
  for (const entry of inFileOrder) {
    if (entry.localOffset < expected) {
      return { ok: false, reason_code: REASON.MISMATCH, detail: `entry "${entry.name}" begins at offset ${entry.localOffset}, inside the range already used by the previous entry (which ends at ${expected})` };
    }
    if (entry.localOffset > expected) {
      return { ok: false, reason_code: REASON.EXTRA, detail: `${entry.localOffset - expected} byte(s) sit between the end of the previous entry (${expected}) and the start of "${entry.name}" (${entry.localOffset})` };
    }
    expected = entry.dataEnd;
  }
  if (end.cursor !== end.cdOffset + end.cdSize) {
    return { ok: false, reason_code: REASON.MISMATCH, detail: `the central directory declares ${end.cdSize} byte(s) but its entries use ${end.cursor - end.cdOffset}` };
  }
  if (end.cdOffset > expected) {
    return { ok: false, reason_code: REASON.EXTRA, detail: `${end.cdOffset - expected} byte(s) between the last entry (${expected}) and the central directory (${end.cdOffset})` };
  }
  if (end.cdOffset < expected) {
    return { ok: false, reason_code: REASON.MISMATCH, detail: `the ranges end at ${expected} and the central directory declares that it begins at ${end.cdOffset}, so the last ${expected - end.cdOffset} byte(s) of an entry's data and the directory are two claims about the same bytes` };
  }
  if (end.at !== end.cdOffset + end.cdSize) {
    return { ok: false, reason_code: REASON.EXTRA, detail: `the end record sits at ${end.at} but the central directory ends at ${end.cdOffset + end.cdSize}` };
  }
  if (end.commentLength !== 0) {
    return { ok: false, reason_code: REASON.EXTRA, detail: `the archive carries a ${end.commentLength}-byte comment, which nothing in the format accounts for` };
  }
  if (end.at + 22 !== bytes.length) {
    return { ok: false, reason_code: REASON.EXTRA, detail: `${bytes.length - (end.at + 22)} byte(s) follow the end of the archive` };
  }
  return { ok: true, reason_code: REASON.OK, detail: `every one of the ${bytes.length} bytes is accounted for` };
}

/**
 * The claims ZIP makes twice: once in the entry's local header and once in the
 * central directory. `flags` is not listed because the reader has to agree with
 * itself about flags before it can decode anything, and refuses there instead.
 */
const REPEATED_CLAIMS = Object.freeze([
  Object.freeze(['version needed', 'versionNeeded']),
  Object.freeze(['the compression method', 'method']),
  Object.freeze(['CRC-32', 'crc32']),
  Object.freeze(['the compressed size', 'compressedSize']),
  Object.freeze(['the uncompressed size', 'uncompressedSize']),
  Object.freeze(['the DOS date', 'date']),
  Object.freeze(['the DOS time', 'time']),
]);

/**
 * Read a "version made by" field the way ZIP defines it: version in the low
 * byte, tenths included, and the host system that wrote the file in the high
 * byte.
 *
 * @param {number} value
 * @returns {string}
 */
function describeMadeBy(value) {
  return `${(value & 0xff) / 10} on host ${value >> 8}`;
}

/**
 * Check every field of the container that does not describe an entry's name or
 * the bytes of its data.
 *
 * ZIP gives each entry two places to declare the same facts, and gives several
 * fields to facts charter/0.1 has no use for. Both are decided here: a field the
 * format does not define a value for has to hold the value it does define, and a
 * claim the archive makes twice has to be the same both times. A verifier that
 * read one copy and ignored the other would accept a file that says two
 * different things depending on which copy a reader happens to trust.
 *
 * Two of those fields — a header's extra field and a directory record's comment
 * — are fixed at *zero bytes* rather than at a value (SPEC section 3.6), and the
 * word for them is EXTRA rather than MISMATCH because there is no field here for
 * a value to be in: the format gives the place no meaning at all, which is what
 * section 3.3 says about a general purpose bit charter/0.1 has no room for.
 * Reading their lengths is the whole point: those bytes are exactly where a
 * ZIP64 size, an extended timestamp or a file attribute can be smuggled into a
 * file whose clock and attributes this check has just refused.
 *
 * @param {object[]} entries
 * @returns {{ ok: boolean, reason_code: string, detail: string }}
 */
function evaluateMetadata(entries) {
  for (const entry of entries) {
    if (entry.versionMadeBy !== VERSION_MADE_BY) {
      return { ok: false, reason_code: REASON.MISMATCH, detail: `"${entry.name}" declares version made by ${describeMadeBy(entry.versionMadeBy)}, and a charter/0.1 file is written by a tool rather than a file system: ${describeMadeBy(VERSION_MADE_BY)}` };
    }
    if (entry.date !== DOS_DATE || entry.time !== DOS_TIME) {
      return { ok: false, reason_code: REASON.MISMATCH, detail: `"${entry.name}" is stamped ${entry.date} at ${entry.time} in the DOS format, and charter/0.1 files carry no clock reading (the DOS epoch is date ${DOS_DATE}, time ${DOS_TIME})` };
    }
    if (entry.diskNumber !== 0) {
      return { ok: false, reason_code: REASON.MISMATCH, detail: `"${entry.name}" says it starts on disk ${entry.diskNumber}, and a charter/0.1 file holds one disk` };
    }
    if (entry.internalAttributes !== 0 || entry.externalAttributes !== 0) {
      return { ok: false, reason_code: REASON.MISMATCH, detail: `"${entry.name}" declares file attributes (internal ${entry.internalAttributes}, external ${entry.externalAttributes}), which describe a file on a disk rather than a document` };
    }
    if (entry.localExtraLength !== 0 || entry.extraLengthInCentral !== 0) {
      return { ok: false, reason_code: REASON.EXTRA, detail: `"${entry.name}" declares an extra field of ${entry.localExtraLength} byte(s) in its local header and ${entry.extraLengthInCentral} byte(s) in the directory record, and charter/0.1 gives that field no meaning: it is where ZIP puts a ZIP64 size, an extended timestamp or a file attribute, in a second spelling no check here reads` };
    }
    if (entry.commentLengthInCentral !== 0) {
      return { ok: false, reason_code: REASON.EXTRA, detail: `"${entry.name}" carries a ${entry.commentLengthInCentral}-byte comment in its directory record, and charter/0.1 gives that field no meaning either` };
    }
    for (const [what, field] of REPEATED_CLAIMS) {
      if (entry[field] !== entry.local[field]) {
        return { ok: false, reason_code: REASON.MISMATCH, detail: `"${entry.name}" declares ${what} ${entry[field]} in the central directory and ${entry.local[field]} in its local header, and the two copies of a claim have to agree` };
      }
    }
  }
  return { ok: true, reason_code: REASON.OK, detail: `all ${entries.length} entries declare the version, method, CRC-32, sizes, and DOS stamp the format fixes, twice over, and carry no extra field and no comment` };
}

/**
 * Walk the archive. This is the only function that decides whether the
 * container is legible at all; everything downstream works from its entry
 * records.
 *
 * @param {Uint8Array} bytes
 * @param {typeof LIMITS} [limits]
 * @returns {{ ok: true, entries: object[], end: object, layout: { ok: boolean, reason_code: string, detail: string }, metadata: { ok: boolean, reason_code: string, detail: string }, maxVersionNeeded: number }
 *   | { ok: false, status: string, reason_code: string, detail: string }}
 */
export function parseArchive(bytes, limits = LIMITS) {
  if (bytes.length > limits.MAX_ARCHIVE_BYTES) {
    return {
      ok: false,
      status: STATUS.FAIL,
      reason_code: REASON.LIMIT_EXCEEDED,
      detail: `the artifact is ${bytes.length} bytes, above the declared limit of ${limits.MAX_ARCHIVE_BYTES}; this verifier refuses what it cannot bound`,
    };
  }
  const found = findEndOfCentralDirectory(bytes, limits.MAX_ZIP_EOCD_SEARCH_BYTES);
  if (found === null) {
    return { ok: false, status: STATUS.FAIL, reason_code: REASON.MALFORMED, detail: `no end-of-central-directory record in the last ${limits.MAX_ZIP_EOCD_SEARCH_BYTES} bytes, so this is not a ZIP archive` };
  }
  const at = found.at;
  const cdSize = u32(bytes, at + 12);
  const cdOffset = u32(bytes, at + 16);
  const totalEntries = u16(bytes, at + 10);
  const entriesOnDisk = u16(bytes, at + 8);
  const diskNumber = u16(bytes, at + 4);
  const cdDisk = u16(bytes, at + 6);

  if (diskNumber !== 0 || cdDisk !== 0) {
    return { ok: false, status: STATUS.UNSUPPORTED, reason_code: REASON.UNSUPPORTED_FEATURE, detail: 'the archive declares more than one disk, which this verifier does not implement' };
  }
  if (totalEntries === ZIP64_MARKER_16 || entriesOnDisk === ZIP64_MARKER_16 || cdSize === ZIP64_MARKER_32 || cdOffset === ZIP64_MARKER_32) {
    return { ok: false, status: STATUS.UNSUPPORTED, reason_code: REASON.UNSUPPORTED_VERSION, detail: 'the archive uses ZIP64 extensions, which charter/0.1 does not implement' };
  }
  if (entriesOnDisk !== totalEntries) {
    return { ok: false, status: STATUS.FAIL, reason_code: REASON.MALFORMED, detail: `the end record declares ${totalEntries} entr(ies) but ${entriesOnDisk} on this disk` };
  }
  if (cdOffset + cdSize > bytes.length || cdOffset > at) {
    return { ok: false, status: STATUS.FAIL, reason_code: REASON.MALFORMED, detail: `the central directory (${cdOffset}..${cdOffset + cdSize}) does not lie inside the archive (0..${bytes.length})` };
  }

  const directory = readCentralDirectory(bytes, { cdOffset, cdSize, totalEntries });
  if (!directory.ok) {
    return { ok: false, status: STATUS.FAIL, reason_code: directory.reason_code, detail: directory.detail };
  }
  const located = locateEntryData(bytes, directory.entries);
  if (!located.ok) {
    return { ok: false, status: STATUS.FAIL, reason_code: located.reason_code, detail: located.detail };
  }

  const end = { at, commentLength: found.commentLength, cdOffset, cdSize, cursor: directory.cursor };
  let maxVersionNeeded = 0;
  for (const entry of directory.entries) {
    if (entry.versionNeeded > maxVersionNeeded) maxVersionNeeded = entry.versionNeeded;
  }
  return {
    ok: true,
    entries: directory.entries,
    end,
    layout: evaluateLayout(bytes, directory.entries, end),
    metadata: evaluateMetadata(directory.entries),
    maxVersionNeeded,
  };
}
/**
 * Decide one entry's general purpose flags.
 *
 * The two deflate level hints and the UTF-8 name flag carry no structure and are
 * tolerated. Anything else is either a feature this verifier does not implement
 * (UNSUPPORTED, because a reader that guessed would be guessing about the bytes)
 * or a bit this format has no room for (FAIL).
 *
 * @param {object} entry
 * @returns {{ ok: boolean, status: string, reason_code: string, detail: string }}
 */
export function evaluateEntryFlags(entry) {
  const offending = entry.flags & ~FLAGS_ALLOWED;
  if (offending === 0) {
    return { ok: true, status: STATUS.PASS, reason_code: REASON.OK, detail: `"${entry.name}" sets ${describeFlags(entry.flags)}` };
  }
  if ((offending & STRUCTURAL_FLAGS) !== 0) {
    return {
      ok: false,
      status: STATUS.UNSUPPORTED,
      reason_code: REASON.UNSUPPORTED_FEATURE,
      detail: `"${entry.name}" sets ${describeFlags(offending)}, a feature this verifier does not implement`,
    };
  }
  return {
    ok: false,
    status: STATUS.FAIL,
    reason_code: REASON.EXTRA,
    detail: `"${entry.name}" sets ${describeFlags(offending)}, and charter/0.1 allows only the UTF-8 name flag and the two deflate level hints`,
  };
}

/**
 * Inflate a raw deflate stream, stopping as soon as the declared ceiling is
 * passed. A stream that keeps expanding is cut off rather than followed.
 *
 * @param {Uint8Array} compressed
 * @param {number} maxBytes
 * @returns {Promise<{ ok: true, value: Uint8Array } | { ok: false, reason_code: string, detail: string }>}
 */
async function inflateRaw(compressed, maxBytes) {
  let stream;
  try {
    stream = new DecompressionStream('deflate-raw');
  } catch {
    return { ok: false, reason_code: REASON.UNSUPPORTED_FEATURE, detail: 'this runtime has no DecompressionStream with the "deflate-raw" format, so deflated entries cannot be read' };
  }
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const chunks = [];
  let total = 0;
  const finishedWriting = writer
    .write(compressed.slice())
    .then(() => writer.close())
    .catch(() => {});
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        await finishedWriting;
        return { ok: false, reason_code: REASON.LIMIT_EXCEEDED, detail: `the entry expands past the declared limit of ${maxBytes} bytes` };
      }
      chunks.push(value);
    }
  } catch {
    await finishedWriting;
    return { ok: false, reason_code: REASON.DECODE_ERROR, detail: 'the entry is not a valid raw deflate stream' };
  }
  await finishedWriting;
  return { ok: true, value: concat(chunks) };
}

/**
 * Decode one entry's bytes and check the container's own claims about them.
 *
 * The declared size and the declared CRC are reported separately from the
 * decoding itself so a verdict can say which of the three failed.
 *
 * @param {Uint8Array} bytes
 * @param {object} entry
 * @param {typeof LIMITS} [limits]
 * @returns {Promise<{ ok: true, data: Uint8Array, size_ok: boolean, crc_ok: boolean, declared_size: number, actual_size: number, declared_crc32: string, actual_crc32: string }
 *   | { ok: false, status: string, reason_code: string, detail: string }>}
 */
export async function readEntryData(bytes, entry, limits = LIMITS) {
  if (entry.compressedSize > limits.MAX_ENTRY_COMPRESSED_BYTES) {
    return { ok: false, status: STATUS.FAIL, reason_code: REASON.LIMIT_EXCEEDED, detail: `"${entry.name}" holds ${entry.compressedSize} compressed bytes, above the declared limit of ${limits.MAX_ENTRY_COMPRESSED_BYTES}` };
  }
  if (entry.uncompressedSize > limits.MAX_ENTRY_BYTES) {
    return { ok: false, status: STATUS.FAIL, reason_code: REASON.LIMIT_EXCEEDED, detail: `"${entry.name}" declares ${entry.uncompressedSize} bytes, above the declared limit of ${limits.MAX_ENTRY_BYTES}` };
  }
  const compressed = bytes.subarray(entry.dataOffset, entry.dataEnd);
  let data;
  if (entry.method === METHOD_STORED) {
    data = compressed;
  } else if (entry.method === METHOD_DEFLATE) {
    const inflated = await inflateRaw(compressed, limits.MAX_ENTRY_BYTES);
    if (!inflated.ok) {
      return { ok: false, status: STATUS.FAIL, reason_code: inflated.reason_code, detail: `"${entry.name}": ${inflated.detail}` };
    }
    data = inflated.value;
  } else {
    return { ok: false, status: STATUS.UNSUPPORTED, reason_code: REASON.UNSUPPORTED_FEATURE, detail: `"${entry.name}" uses compression method ${entry.method}, which this verifier does not implement (0 stored and 8 deflate are all that charter/0.1 defines)` };
  }
  const actualCrc = crc32(data);
  return {
    ok: true,
    data,
    size_ok: data.length === entry.uncompressedSize,
    crc_ok: actualCrc === entry.crc32,
    declared_size: entry.uncompressedSize,
    actual_size: data.length,
    declared_crc32: entry.crc32.toString(16).padStart(8, '0'),
    actual_crc32: actualCrc.toString(16).padStart(8, '0'),
  };
}


