/**
 * The ZIP writer: the container of a `.charter` file, written to SPEC.md
 * section 3.
 *
 * ZIP gives a writer a great deal of freedom, and charter/0.1 takes all of it
 * away: three entries, no ZIP64, no comment, no extra field, no data
 * descriptor, and every metadata field fixed at one value. This writer writes
 * that one shape and nothing else, so there is no option here that a caller
 * could use to write something the verifier refuses.
 *
 * # Every entry is stored, and that is the point
 *
 * Section 3.3 allows an entry to be stored (method 0) or raw-deflated (method
 * 8), and this writer stores. Deflate is produced by zlib, and zlib's output is
 * not the same everywhere: it changes with the library's version. A sealed file
 * whose entries were compressed would therefore have bytes that depend on the
 * compressing library, and "the same content and the same key produce the same
 * bytes" would be true only within one runtime. Section 3.6 fixes the DOS stamp
 * for exactly that reason — a file whose bytes are the record cannot also carry
 * a reading of a clock — and a compressor is a second clock.
 *
 * Stored entries have no such freedom: the entry's bytes are the bytes, on
 * every machine, in every build. The reader implements deflate because readers
 * meet files from everywhere; the producer does not write it because the
 * producer writes one file.
 *
 * # Why one writer lives here
 *
 * This module is not part of a verdict: nothing the reading path imports can
 * reach it, and `test/purity.test.js` walks the imports of `verify.js` and
 * refuses the run if it ever does. It sits in this directory because the
 * container's shape is defined by the *reader* — every field below is one this
 * directory's reader checks, and `METHOD_STORED` is read out of it — and
 * because the only writers this project has are the one that shells out a file
 * and the one that runs in a page. A second writer, in a directory that a
 * browser may not import, would be a second place for the container's rules to
 * be written down.
 *
 * @module verifier/zip-write
 */

import { concat, utf8Encode } from './bytes.js';
import { crc32 } from './crc32.js';
import { LIMITS } from './limits.js';
import { refuse } from './refuse.js';
import { REASON } from './status.js';
import { METHOD_STORED } from './zip.js';

/** Version 2.0, host 0 (MS-DOS): written by a tool rather than by a file system. */
export const VERSION_MADE_BY = 0x0014;
/** Version needed to extract: 2.0, the last level before ZIP64. */
export const VERSION_NEEDED = 20;
/** The one general purpose bit charter/0.1 expects: the entry name is UTF-8. */
export const FLAG_UTF8_NAME = 0x0800;
/** 1980-01-01 is the earliest instant a DOS date field can hold, and means no time. */
export const DOS_DATE = 0x0021;
export const DOS_TIME = 0;

const SIGNATURE_LOCAL = 0x04034b50;
const SIGNATURE_CENTRAL = 0x02014b50;
const SIGNATURE_END = 0x06054b50;

/** The end record's entry counts are 16 bits wide. */
const MAX_ENTRIES = 0xffff;

/**
 * @param {number} value
 * @returns {Uint8Array} two bytes, little endian, as ZIP writes them
 */
function u16(value) {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

/**
 * @param {number} value
 * @returns {Uint8Array} four bytes, little endian, as ZIP writes them
 */
function u32(value) {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
}

/**
 * Write an archive of the shape charter/0.1 requires.
 *
 * The entries are written in the order they are given, the central directory
 * follows them immediately, and the end record follows that. Nothing precedes
 * the first local header and nothing follows the end record, which is what
 * `L0.ZIP.LAYOUT` checks.
 *
 * @param {{ name: string, data: Uint8Array }[]} entries
 * @param {typeof LIMITS} [limits]
 * @returns {Uint8Array}
 */
export function zipStore(entries, limits = LIMITS) {
  if (!Array.isArray(entries) || entries.length === 0) {
    refuse(REASON.MALFORMED, 'a charter holds three entries, and this call was given none to write');
  }
  if (entries.length > MAX_ENTRIES) {
    refuse(REASON.LIMIT_EXCEEDED, `the archive would hold ${entries.length} entries, and the end record can only count ${MAX_ENTRIES}`);
  }

  /** @type {Uint8Array[]} */
  const body = [];
  /** @type {Uint8Array[]} */
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    if (typeof entry.name !== 'string' || entry.name === '') {
      refuse(REASON.MALFORMED, 'an entry name is a non-empty string, and one of these is not');
    }
    if (!(entry.data instanceof Uint8Array)) {
      refuse(REASON.MALFORMED, `"${entry.name}" was handed ${typeof entry.data}, not bytes`);
    }
    const nameBytes = utf8Encode(entry.name);
    if (nameBytes.length > limits.MAX_ZIP_NAME_BYTES) {
      refuse(REASON.LIMIT_EXCEEDED, `the entry name "${entry.name}" is ${nameBytes.length} bytes, above the declared limit of ${limits.MAX_ZIP_NAME_BYTES}`, entry.name);
    }
    if (entry.data.length > limits.MAX_ENTRY_BYTES) {
      refuse(
        REASON.LIMIT_EXCEEDED,
        `"${entry.name}" holds ${entry.data.length} bytes, above the declared limit of ${limits.MAX_ENTRY_BYTES} for one entry`,
        entry.name,
      );
    }

    const checksum = crc32(entry.data);
    const size = entry.data.length;
    const header = concat([
      u32(SIGNATURE_LOCAL),
      u16(VERSION_NEEDED),
      u16(FLAG_UTF8_NAME),
      u16(METHOD_STORED),
      u16(DOS_TIME),
      u16(DOS_DATE),
      u32(checksum),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
    ]);
    body.push(header, entry.data);

    central.push(
      concat([
        u32(SIGNATURE_CENTRAL),
        u16(VERSION_MADE_BY),
        u16(VERSION_NEEDED),
        u16(FLAG_UTF8_NAME),
        u16(METHOD_STORED),
        u16(DOS_TIME),
        u16(DOS_DATE),
        u32(checksum),
        u32(size),
        u32(size),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBytes,
      ]),
    );

    offset += header.length + size;
  }

  const directory = concat(central);
  const end = concat([
    u32(SIGNATURE_END),
    u16(0),
    u16(0),
    u16(central.length),
    u16(central.length),
    u32(directory.length),
    u32(offset),
    u16(0),
  ]);
  const bytes = concat([...body, directory, end]);

  if (bytes.length > limits.MAX_ARCHIVE_BYTES) {
    refuse(
      REASON.LIMIT_EXCEEDED,
      `the artifact would be ${bytes.length} bytes, above the declared limit of ${limits.MAX_ARCHIVE_BYTES}; an artifact this verifier would refuse to read is not one this producer writes`,
    );
  }
  return bytes;
}
