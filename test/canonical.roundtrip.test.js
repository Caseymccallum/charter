/**
 * The canonical round trip, in both directions.
 *
 * Direction 1 is evidence, not hypothesis. The committed artifacts were built
 * before this test existed, and their bytes are recorded in
 * `vectors/expected.json` with a SHA-256. So for every document a fixture holds,
 * this file takes the bytes, reads them to a value with the reader, writes the
 * value back with the serializer, and requires the result to be byte-identical
 * to what it started with. Neither implementation can have shaped those bytes,
 * which is what makes their agreement worth something. If a fixture is not a
 * fixed point under this pair, the fixture and one of the two directions
 * disagree about what canonical means — and the fixture is the evidence, so the
 * disagreement is the finding.
 *
 * Direction 2 is the hypothesis: a generator makes values with the awkward parts
 * (astral characters, keys whose orders disagree, integers at the edge of the
 * safe range, empty containers, nesting to the limit), and requires
 * value → bytes → value to be the identity and bytes → value → bytes to be
 * idempotent. This is the direction that finds a defect in the serializer rather
 * than in the specification.
 *
 * Neither direction trusts the other's reading of the spec: the bytes are
 * compared, never the values alone, and the verdict the verifier already reached
 * about each fixture is checked *against* the round trip's answer. When the two
 * disagree — a document the verifier passed that this test cannot re-write, or a
 * document the verifier refused as NON_CANONICAL that this test reproduces
 * exactly — the test fails, because that is a defect in one of them and neither
 * is allowed to hide it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HOSTILE_TEXT } from './corpus.js';
import { bytesEqual, concat, utf8Encode } from '../verifier/bytes.js';
import { CanonicalWriteError, compareByCodePoint, LF, serializeCanonical } from '../verifier/canonical-write.js';
import { parseJsonBytes, parseJsonText } from '../verifier/canonical.js';
import { LIMITS } from '../verifier/limits.js';
import { splitLines } from '../verifier/provenance.js';
import { REASON, STATUS, VERDICT } from '../verifier/status.js';
import { ENTRY_MANIFEST, ENTRY_PROVENANCE, verify } from '../verifier/verify.js';
import { parseArchive, readEntryData } from '../verifier/zip.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = join(HERE, '..', 'vectors');
const RECORD = JSON.parse(readFileSync(join(KIT, 'expected.json'), 'utf8'));

/** The check that decides whether a document's bytes are canonical. */
const CANONICAL_CHECK = {
  [ENTRY_MANIFEST]: 'L0.MANIFEST.CANONICAL',
  [ENTRY_PROVENANCE]: 'L0.PROVENANCE.CANONICAL',
};

/**
 * @param {Uint8Array} bytes
 * @returns {string} lowercase hex SHA-256, the way the record states it
 */
function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * @param {{ checks: import('../verifier/status.js').CheckResult[] }} result
 * @param {string} id
 * @returns {import('../verifier/status.js').CheckResult}
 */
function check(result, id) {
  const found = result.checks.find((candidate) => candidate.id === id);
  assert.ok(found !== undefined, `${id} is not in this verdict`);
  return found;
}

/**
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 * @returns {string} the first place two byte sequences differ, in prose
 */
function firstDifference(a, b) {
  const limit = Math.min(a.length, b.length);
  for (let i = 0; i < limit; i += 1) {
    if (a[i] !== b[i]) {
      return `byte ${i}: 0x${a[i].toString(16).padStart(2, '0')} where the canonical form has 0x${b[i].toString(16).padStart(2, '0')}`;
    }
  }
  if (a.length === b.length) return 'identical';
  return a.length > b.length
    ? `the first ${limit} bytes agree, and then the document has ${a.length - b.length} byte(s) more`
    : `the first ${limit} bytes agree, and then the document stops ${b.length - a.length} byte(s) short`;
}

/**
 * Every JSON document a container holds, with the bytes it was found in.
 *
 * A canonical document is one canonical value and one LF, so each provenance
 * line is compared as the document it is — line plus its terminator — rather
 * than as a bare line. The ZIP reader and the line splitter are the verifier's
 * own, so a fixture whose container this walk cannot read is a fixture whose
 * container the verifier could not read either; that is checked below, not
 * assumed.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<{ ok: true, documents: { where: string, bytes: Uint8Array }[] }
 *   | { ok: false, reason_code: string, detail: string }>}
 */
async function documentsIn(bytes) {
  const archive = parseArchive(bytes);
  if (!archive.ok) {
    return { ok: false, reason_code: archive.reason_code, detail: archive.detail };
  }
  const documents = [];
  for (const entry of archive.entries) {
    if (entry.name !== ENTRY_MANIFEST && entry.name !== ENTRY_PROVENANCE) continue;
    const read = await readEntryData(bytes, entry);
    if (!read.ok) return { ok: false, reason_code: read.reason_code, detail: read.detail };
    if (entry.name === ENTRY_MANIFEST) {
      documents.push({ where: ENTRY_MANIFEST, bytes: read.data, check: CANONICAL_CHECK[entry.name] });
      continue;
    }
    const split = splitLines(read.data);
    if (!split.ok) return { ok: false, reason_code: split.reason_code, detail: split.detail };
    for (let index = 0; index < split.lines.length; index += 1) {
      documents.push({
        where: `${ENTRY_PROVENANCE} line ${index + 1}`,
        bytes: concat([split.lines[index], LF]),
        check: CANONICAL_CHECK[entry.name],
      });
    }
  }
  return { ok: true, documents };
}

/**
 * What the round trip says about one document.
 *
 * The expected bytes are built with `serializeCanonical` plus one LF rather than
 * with `canonicalDocument`, so that the rule under test is stated here in full:
 * a document is one canonical value and exactly one terminator. `canonicalDocument`
 * is checked against this rule in `test/canonical-write.test.js`.
 *
 * @param {Uint8Array} bytes the whole document, terminator included
 * @returns {{ kind: 'unreadable', reason_code: string, detail: string }
 *   | { kind: 'readable', value: unknown, canonical: Uint8Array, identical: boolean }}
 */
function roundTrip(bytes) {
  const parsed = parseJsonBytes(bytes);
  if (!parsed.ok) return { kind: 'unreadable', reason_code: parsed.reason_code, detail: parsed.detail };
  const canonical = utf8Encode(`${serializeCanonical(parsed.value)}\n`);
  return { kind: 'readable', value: parsed.value, canonical, identical: bytesEqual(bytes, canonical) };
}

/**
 * The rule this file exists to state, in one place so that every test in it
 * states the same one.
 *
 * A document's bytes are either exactly what the serializer writes for their
 * value, or they are not, and the verifier's canonical check has to say the same
 * thing. Three statuses count as agreement, and each one has to be visible in the
 * report rather than folded into a pass:
 *
 *   - `fixed`: the bytes are reproduced exactly and the check passed;
 *   - `abstained`: the bytes are reproduced exactly and the check was skipped,
 *     because the artifact declares a version this verifier does not implement
 *     and it therefore never applied charter/0.1's rule to them;
 *   - `not-fixed`: the bytes are not the canonical form of their value and the
 *     check refused them as NON_CANONICAL.
 *
 * @param {{ verdict: string, checks: import('../verifier/status.js').CheckResult[] }} result
 * @param {string} name the fixture or case being checked, for messages
 * @param {{ where: string, bytes: Uint8Array, check: string }} document
 * @param {ReturnType<typeof roundTrip>} trip
 * @returns {{ kind: 'fixed' | 'abstained' | 'not-fixed', row: Record<string, unknown> }}
 */
function agreement(result, name, document, trip) {
  assert.equal(trip.kind, 'readable', `${name} ${document.where}: the round trip must have read this document`);
  const canonical = check(result, document.check);
  const where = `${name} ${document.where}`;

  if (trip.identical) {
    assert.ok(
      canonical.status === STATUS.PASS || canonical.status === STATUS.SKIP,
      `${where}: the round trip reproduces these bytes exactly, and ${document.check} is ${canonical.status} (${canonical.reason_code})`,
    );
    if (canonical.status === STATUS.PASS) return { kind: 'fixed', row: { name, where: document.where } };
    assert.notEqual(result.verdict, VERDICT.VERIFIED, `${where}: a skipped check cannot be part of a pass`);
    return { kind: 'abstained', row: { name, where: document.where, reason_code: canonical.reason_code } };
  }

  assert.equal(canonical.status, STATUS.FAIL, `${where}: the bytes are not the canonical form of their value, and ${document.check} is ${canonical.status}`);
  assert.equal(canonical.reason_code, REASON.NON_CANONICAL, `${where}: bytes that are not canonical must be refused as NON_CANONICAL`);
  return {
    kind: 'not-fixed',
    row: {
      name,
      where: document.where,
      bytes: document.bytes.length,
      canonical: trip.canonical.length,
      difference: firstDifference(document.bytes, trip.canonical),
    },
  };
}

/**
 * The fixtures whose bytes are deliberately not canonical.
 *
 * A list, not a filter. A fixture that stops being a fixed point has to be added
 * here on purpose with a reason next to it, and one that starts being a fixed
 * point has to be taken out — so a change in what the format calls canonical
 * cannot pass unnoticed behind a count of "not fixed points".
 *
 * Each of these is a thing the format does *not* claim to accept: the value in
 * it is readable, and its bytes are refused by name.
 */
const NOT_CANONICAL_BY_DESIGN = [
  'manifest-no-trailing-newline', // one canonical value, and no terminator
  'manifest-pretty-printed', // whitespace between tokens
  'manifest-spaced', // whitespace between tokens, on one line
  'manifest-two-trailing-newlines', // two terminators where the format allows one
  'noncanonical-manifest', // keys in insertion order rather than code point order
];

/**
 * The index of the first occurrence of `needle` in `haystack`, or -1.
 *
 * @param {Uint8Array} haystack
 * @param {Uint8Array} needle
 * @returns {number}
 */
function indexOfBytes(haystack, needle) {
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * A copy of `bytes` with the character at `at` case-flipped, so the length is
 * unchanged and nothing in the container shifts. The flip is checked to be a
 * flip: an edit that wrote the same byte back would prove nothing.
 *
 * @param {Uint8Array} bytes
 * @param {number} at
 * @returns {Uint8Array}
 */
function flipCaseOf(bytes, at) {
  const letter = String.fromCharCode(bytes[at]);
  assert.match(letter, /[A-Za-z]/, `byte ${at} of the fixture is ${JSON.stringify(letter)}, and this forgery needs a letter`);
  const copy = bytes.slice();
  copy[at] ^= 0x20;
  assert.notEqual(copy[at], bytes[at], 'the flip must change the byte');
  return copy;
}

/** The accepted artifact, and the byte offsets inside it that a forgery edits. */
function forgeryTargets() {
  const valid = new Uint8Array(readFileSync(join(KIT, 'out', 'valid.charter')));
  const title = utf8Encode('"title":"');
  const titleAt = indexOfBytes(valid, title);
  assert.notEqual(titleAt, -1, 'the accepted artifact names a title');
  const contentAt = indexOfBytes(valid, utf8Encode('# '));
  assert.notEqual(contentAt, -1, 'the accepted artifact has content that starts with a heading marker');
  return { valid, title: titleAt + title.length, content: contentAt + 2 };
}

/**
 * @param {{ checks: import('../verifier/status.js').CheckResult[] }} result
 * @returns {string[]} the failing checks as `ID=REASON`, in registry order
 */
function blamed(result) {
  return result.checks.filter((candidate) => candidate.status === STATUS.FAIL).map((candidate) => `${candidate.id}=${candidate.reason_code}`);
}

/**
 * Whether every code unit of `text` can be encoded as UTF-8: a surrogate is fine
 * only in a pair.
 *
 * Stated here rather than imported, so that the test has its own statement of the
 * rule and not the module's. A test that asked the serializer whether the
 * serializer was right would agree with it.
 *
 * @param {string} text
 * @returns {boolean}
 */
function isEncodable(text) {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

test('every string in the hostile corpus survives the trip from a value to bytes and back, or is refused by name', () => {
  const REASONS = new Set(Object.values(REASON));
  let readable = 0;
  let refused = 0;

  for (const text of HOSTILE_TEXT) {
    const label = JSON.stringify(text.length > 40 ? `${text.slice(0, 40)}…` : text);

    // Reading 1: the entry as a document. Whatever the reader accepts must be
    // writable, and what is written must read back as the same value.
    const parsed = parseJsonText(text);
    if (parsed.ok) {
      readable += 1;
      const document = utf8Encode(`${serializeCanonical(parsed.value)}\n`);
      const again = parseJsonBytes(document);
      assert.equal(again.ok, true, `${label}: the canonical form of an accepted value must be readable`);
      assert.equal(serializeCanonical(again.value), serializeCanonical(parsed.value), `${label}: the canonical form must read back as the same value`);
    } else {
      refused += 1;
      assert.ok(REASONS.has(parsed.reason_code), `${label}: ${parsed.reason_code} is not in the vocabulary`);
    }

    // Reading 2: the entry as a string value, which is the half the reader never
    // sees. A string is either written exactly or refused because UTF-8 cannot
    // hold it, and those two cases have to be exactly the strings that are
    // encodable — no third case, and no string that comes back changed.
    if (isEncodable(text)) {
      const document = parseJsonText(`${serializeCanonical({ s: text })}\n`);
      assert.equal(document.ok, true, `${label}: a written string must be readable`);
      assert.equal(document.value.s, text, `${label}: a string must come back exactly as it went in`);
    } else {
      let error = null;
      try {
        serializeCanonical({ s: text });
      } catch (caught) {
        error = caught;
      }
      assert.ok(error instanceof CanonicalWriteError, `${label}: a string UTF-8 cannot hold must be refused, never written as U+FFFD`);
      assert.equal(error.reason_code, REASON.MALFORMED, `${label}: wrong reason code`);
    }
  }

  assert.ok(readable > 0, 'the corpus holds values the reader accepts');
  assert.ok(refused > 0, 'the corpus holds values the reader refuses');
});

test('a forged artifact is refused, and the forged document is still a fixed point: canonical form is reproducibility, not integrity', async () => {
  const { valid, title, content } = forgeryTargets();
  const cases = [
    // A byte inside a signed JSON string, and a byte inside the content. Both keep
    // the length, so neither moves a document's bytes out of canonical form.
    ['a title character, edited in place', flipCaseOf(valid, title)],
    ['a content byte, flipped in place', flipCaseOf(valid, content)],
  ];

  for (const [what, forged] of cases) {
    assert.equal(forged.length, valid.length, `${what}: the forgery must not change the size of the file`);
    const result = await verify(forged);
    assert.notEqual(result.verdict, VERDICT.VERIFIED, `${what}: a hand-forged artifact must not verify`);

    const found = await documentsIn(forged);
    assert.equal(found.ok, true, `${what}: a same-length edit leaves the container walkable`);

    // The finding: the canonical form says nothing about whether the document is
    // the one the author wrote. The bytes of the forged document are exactly what
    // the serializer writes for the (forged) value, so the canonical check passes
    // — and something else has to catch the edit.
    for (const document of found.documents) {
      const trip = roundTrip(document.bytes);
      assert.equal(trip.kind, 'readable', `${what} ${document.where}: the document must still be readable`);
      assert.equal(trip.identical, true, `${what} ${document.where}: a same-length edit inside a string keeps the document canonical`);
      assert.equal(agreement(result, what, document, trip).kind, 'fixed', `${what} ${document.where}: the canonical check must have passed`);
    }
    assert.ok(
      !blamed(result).some((entry) => entry.startsWith('L0.MANIFEST.CANONICAL')),
      `${what}: the canonical check is not what catches a hand edit: ${blamed(result).join(', ')}`,
    );
    // The container's own CRC-32 is what catches a hand edit of a stored entry,
    // before any signature is checked. That layering is the point.
    assert.ok(
      blamed(result).some((entry) => entry.startsWith('L0.ZIP.CRC32')),
      `${what}: the ZIP's own CRC-32 must catch a hand edit, and this verdict blames ${blamed(result).join(', ')}`,
    );
    assert.ok(blamed(result).length >= 2, `${what}: a forged byte is caught more than once, and this verdict blames ${blamed(result).join(', ')}`);
  }
});

test('a container the round trip cannot walk is a container the verifier refuses, for the same reason', async () => {
  const { valid } = forgeryTargets();

  const truncated = valid.slice(0, Math.floor(valid.length * 0.6));
  const cut = await verify(truncated);
  const found = await documentsIn(truncated);
  assert.equal(found.ok, false, 'a truncated artifact has no central directory to walk');
  assert.notEqual(cut.verdict, VERDICT.VERIFIED, 'a truncated artifact must not verify');
  assert.ok(
    blamed(cut).some((entry) => entry.endsWith(`=${found.reason_code}`)),
    `the walk refused the container as ${found.reason_code}, and the verdict blames ${blamed(cut).join(', ')}`,
  );

  // The opposite shape: the container is still walkable and the documents in it are
  // untouched, so the round trip reaches them and finds them canonical — and the
  // artifact is refused anyway, because bytes follow the central directory and the
  // format has no rule for them.
  const appended = concat([valid, new Uint8Array(16)]);
  const grown = await verify(appended);
  const reached = await documentsIn(appended);
  assert.equal(reached.ok, true, 'appending bytes leaves the central directory findable');
  for (const document of reached.documents) {
    const trip = roundTrip(document.bytes);
    assert.equal(agreement(grown, '16 bytes appended', document, trip).kind, 'fixed', `16 bytes appended ${document.where}`);
  }
  assert.notEqual(grown.verdict, VERDICT.VERIFIED, 'an artifact with bytes after its central directory must not verify');
  assert.ok(
    blamed(grown).some((entry) => entry.startsWith('L0.ZIP.LAYOUT')),
    `the verdict must blame the layout, and it blames ${blamed(grown).join(', ')}`,
  );
});

test('every document in every recorded artifact is a fixed point, unless the verdict says its bytes are not canonical', async () => {
  /** @type {{ name: string, where: string, bytes: number, canonical: number, difference: string }[]} */
  const notFixed = [];
  /** @type {{ name: string, where: string, reason_code: string, detail: string }[]} */
  const unreachable = [];
  /** @type {{ name: string, where: string, reason_code: string }[]} */
  const abstained = [];
  let artifacts = 0;
  let documents = 0;
  let identical = 0;

  for (const recorded of RECORD.cases) {
    const name = String(recorded.name);
    const bytes = new Uint8Array(readFileSync(join(KIT, String(recorded.file))));
    // "Whose bytes are recorded" is the qualification, and this is the record
    // making good on it: the file on disk is the file the SHA-256 describes.
    assert.equal(bytes.length, recorded.bytes, `${name}: the file on disk is not the size the record describes`);
    assert.equal(sha256Hex(bytes), recorded.sha256, `${name}: the file on disk is not the file the record describes`);
    artifacts += 1;

    const result = await verify(bytes);
    // A refusal is either a FAIL or an UNSUPPORTED: this format has two words for
    // "this was not established", and the record is the arbiter of which one a
    // given artifact gets. What is not allowed is a verdict that accepted the
    // artifact while the round trip could not reach a document in it.
    const blamed = result.checks
      .filter((candidate) => candidate.status === STATUS.FAIL || candidate.status === STATUS.UNSUPPORTED)
      .map((candidate) => candidate.reason_code);
    /**
     * @param {string} reason_code
     * @param {string} where
     */
    const blames = (reason_code, where) => {
      assert.notEqual(result.verdict, VERDICT.VERIFIED, `${name}: the verifier passed this artifact, and the round trip could not reach ${where}`);
      assert.ok(
        blamed.includes(reason_code),
        `${name}: the round trip stopped at ${where} with ${reason_code}, and the verdict blames ${blamed.join(', ') || 'nothing'}`,
      );
    };

    const found = await documentsIn(bytes);
    if (!found.ok) {
      unreachable.push({ name, where: 'the container', reason_code: found.reason_code, detail: found.detail });
      blames(found.reason_code, 'the container');
      continue;
    }

    for (const document of found.documents) {
      const trip = roundTrip(document.bytes);
      if (trip.kind === 'unreadable') {
        unreachable.push({ name, where: document.where, reason_code: trip.reason_code, detail: trip.detail });
        blames(trip.reason_code, document.where);
        continue;
      }

      documents += 1;
      const verdict = agreement(result, name, document, trip);
      if (verdict.kind === 'fixed') identical += 1;
      else if (verdict.kind === 'abstained') abstained.push(verdict.row);
      else notFixed.push(verdict.row);

      // No document the reader accepts may be one the writer cannot write, and
      // what the writer writes has to read back as the same value. This half of
      // the property holds even for the fixtures whose bytes are not canonical,
      // which is what makes it a statement about the pair rather than about the
      // fixtures.
      const again = roundTrip(trip.canonical);
      assert.equal(again.kind, 'readable', `${name} ${document.where}: the canonical form of an accepted value must be readable`);
      assert.equal(again.identical, true, `${name} ${document.where}: the canonical form must itself be a fixed point`);
      assert.deepEqual(again.value, trip.value, `${name} ${document.where}: the canonical form must read back as the same value`);
    }
  }

  assert.equal(artifacts, RECORD.cases.length, 'every recorded case was replayed');
  assert.ok(documents > 0, 'at least one document was reached');

  const report = [
    `${artifacts} artifact(s), ${documents} document(s) reached: ${identical} fixed point(s), ${notFixed.length} not.`,
    ...notFixed.map((row) => `  not a fixed point: ${row.name} ${row.where} — ${row.bytes} bytes where the canonical form is ${row.canonical}; ${row.difference}`),
    ...abstained.map((row) => `  a fixed point the verifier did not rule on: ${row.name} ${row.where} — ${row.reason_code}`),
    ...unreachable.map((row) => `  not reached: ${row.name} ${row.where} — ${row.reason_code}: ${row.detail}`),
  ].join('\n');

  assert.deepEqual(
    [...new Set(notFixed.map((row) => row.name))].sort(),
    NOT_CANONICAL_BY_DESIGN,
    `the fixtures whose bytes are not the canonical form of their value changed:\n${report}`,
  );
});

test('keys order by code point, and the two orders are told apart in both directions', () => {
  const astral = '\u{1f600}'; // U+1F600: two UTF-16 code units, four UTF-8 bytes
  const bmp = '\uFFFF'; // U+FFFF: one UTF-16 code unit, three UTF-8 bytes
  // The two orders disagree, which is the only reason this pair can tell them
  // apart at all. `Array#sort` with no comparator is UTF-16 order.
  assert.deepEqual([astral, bmp].sort(), [astral, bmp], 'UTF-16 order puts the astral key first');
  assert.deepEqual([astral, bmp].sort(compareByCodePoint), [bmp, astral], 'code point order puts U+FFFF first');

  const value = { [astral]: 1, [bmp]: 2 };
  const written = serializeCanonical(value);
  assert.equal(written, `{"${bmp}":2,"${astral}":1}`);

  // Direction 1: a document in UTF-16 order holds the same value in the wrong
  // bytes. The reader tolerates the order, so it can say "wrong bytes" instead of
  // "not JSON", and the round trip re-writes it into the one right byte sequence.
  const utf16 = roundTrip(utf8Encode(`{"${astral}":1,"${bmp}":2}\n`));
  assert.equal(utf16.kind, 'readable', 'key order is tolerated while reading');
  assert.equal(utf16.identical, false, 'a document in the other order is not the canonical bytes');
  assert.equal(new TextDecoder().decode(utf16.canonical), `${written}\n`);
  // Same value, two byte sequences: which is exactly why the format fixes one.
  assert.equal(serializeCanonical(utf16.value), written, 'the other order reads to the same value');

  // Direction 2: the canonical document is a fixed point and reads back as the value.
  const canonical = roundTrip(utf8Encode(`${written}\n`));
  assert.equal(canonical.identical, true);
  assert.equal(serializeCanonical(canonical.value), written);

  // Three keys, so the order is an ordering and not a swap, including the empty
  // key, which sorts first.
  const many = { '': 0, z: 1, [astral]: 2, [bmp]: 3, '\uE000': 4 };
  const keys = Object.keys(many);
  assert.notDeepEqual([...keys].sort(), [...keys].sort(compareByCodePoint), 'the two orders disagree on this set');
  const manyWritten = `${serializeCanonical(many)}\n`;
  const manyTrip = roundTrip(utf8Encode(manyWritten));
  assert.equal(manyTrip.identical, true, 'a multi-key document must be a fixed point');
  assert.equal(`${serializeCanonical(manyTrip.value)}\n`, manyWritten, 'the value must survive the round trip whole');
  assert.deepEqual([...Object.keys(manyTrip.value)].sort(compareByCodePoint), [...keys].sort(compareByCodePoint), 'and no key may be lost');
});

test('the empty object, the empty array and the empty string are values, in both directions', () => {
  const value = { o: {}, a: [], s: '', nested: { o: {}, a: [[]] } };
  const document = `${serializeCanonical(value)}\n`;
  assert.equal(document, '{"a":[],"nested":{"a":[[]],"o":{}},"o":{},"s":""}\n');
  const trip = roundTrip(utf8Encode(document));
  assert.equal(trip.identical, true);
  assert.equal(`${serializeCanonical(trip.value)}\n`, document);
  for (const one of ['{}', '[]', '""']) {
    assert.equal(roundTrip(utf8Encode(`${one}\n`)).identical, true, `${one} must be a fixed point`);
  }
  // An empty container is a value, and it is not the same value as an absent
  // field: writing `{}` for a missing field is how a canonical rule loses a
  // distinction that a signature was supposed to cover.
  assert.notEqual(serializeCanonical({ o: {} }), serializeCanonical({}));
  assert.notEqual(serializeCanonical({ a: [] }), serializeCanonical({}));
});

test('the safe-integer edge is written in both directions, and one past it is refused in both', () => {
  assert.equal(Number.MAX_SAFE_INTEGER, 9007199254740991, 'the edge is where the format says it is, not where a double happens to be exact');
  for (const edge of [Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, 0, -1, 1, 2 ** 31]) {
    const trip = roundTrip(utf8Encode(`${serializeCanonical({ n: edge })}\n`));
    assert.equal(trip.identical, true, `${edge} must be a fixed point`);
    assert.equal(trip.value.n, edge, `${edge} must read back exactly`);
  }
  // There is no canonical spelling for a number the format cannot carry, so both
  // directions refuse it: the writer refuses the value, the reader refuses the text.
  for (const [value, text] of [
    [Number.MAX_SAFE_INTEGER + 1, '9007199254740992'],
    [Number.MIN_SAFE_INTEGER - 1, '-9007199254740992'],
  ]) {
    assert.throws(() => serializeCanonical(value), CanonicalWriteError, `${value} must be refused as a value`);
    const refused = parseJsonText(text);
    assert.equal(refused.ok, false, `${text} must be refused as text`);
    assert.equal(refused.reason_code, REASON.NUMBER_OUT_OF_RANGE);
  }
});


test('a value one direction refuses is refused by the other, with the same reason code', () => {
  /** @param {number} depth */
  const nested = (depth) => {
    let value = 1;
    for (let i = 0; i < depth; i += 1) value = [value];
    return value;
  };
  const nestText = (depth) => `${'['.repeat(depth)}1${']'.repeat(depth)}`;

  // Each row is one rule, stated in the two directions it has to hold in: a value
  // the writer will not write, and the text a reader would refuse if it arrived as
  // bytes. The reason code has to be the same one, or a producer that reports why
  // it could not write a document would use a different word than the verifier
  // that refuses it.
  const rows = [
    ['a float', { a: 1.5 }, '{"a":1.5}', REASON.NON_INTEGER_NUMBER],
    ['negative zero', { a: -0 }, '{"a":-0}', REASON.NON_INTEGER_NUMBER],
    ['an integer past the safe range', { n: Number.MAX_SAFE_INTEGER + 1 }, '{"n":9007199254740992}', REASON.NUMBER_OUT_OF_RANGE],
    ['an integer below the safe range', { n: Number.MIN_SAFE_INTEGER - 1 }, '{"n":-9007199254740992}', REASON.NUMBER_OUT_OF_RANGE],
    ['an unpaired surrogate, as a value or as an escape', { a: '\ud800' }, '{"a":"\\ud800"}', REASON.MALFORMED],
    ['a lone low surrogate', { a: '\udc00' }, '{"a":"\\udc00"}', REASON.MALFORMED],
    ['a value that is not a JSON value at all', undefined, 'undefined', REASON.MALFORMED],
    ['nesting past the declared ceiling', nested(LIMITS.MAX_JSON_DEPTH + 1), nestText(LIMITS.MAX_JSON_DEPTH + 1), REASON.MALFORMED],
  ];

  for (const [what, value, text, reason_code] of rows) {
    let written = null;
    try {
      serializeCanonical(value);
    } catch (error) {
      written = error instanceof CanonicalWriteError ? error.reason_code : `${error.name}: ${error.message}`;
    }
    const read = parseJsonText(text);
    assert.equal(written, reason_code, `${what}: the writer must refuse it as ${reason_code}, and it said ${written}`);
    assert.equal(read.ok, false, `${what}: the reader must refuse ${text}`);
    assert.equal(read.reason_code, reason_code, `${what}: the reader refused ${text} as ${read.reason_code}`);
  }

  // And the same ceiling from the other side: one level inside it, both directions
  // accept, so the boundary is a boundary and not a blanket refusal.
  const inside = nested(LIMITS.MAX_JSON_DEPTH);
  assert.equal(serializeCanonical(inside), nestText(LIMITS.MAX_JSON_DEPTH));
  assert.equal(parseJsonText(nestText(LIMITS.MAX_JSON_DEPTH)).ok, true);
});

/**
 * A deterministic generator, so that a failure here is reproducible from the seed.
 * Nothing under `verifier/**` may reach for a random source, and a property test
 * that used one would report a failure nobody else could see.
 *
 * @param {number} seed
 * @returns {() => unknown} a function producing values nested up to four deep
 */
function generator(seed) {
  let state = seed >>> 0;
  /** @returns {number} in [0, 1) */
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  /** @param {unknown[]} list */
  const pick = (list) => list[Math.floor(next() * list.length) % list.length];
  const integers = [
    0, 1, -1, 2, -2, 7, -7, 10, -10, 63, 64, 127, 128, 255, 256, 1000, -1000,
    2 ** 31, -(2 ** 31), Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1, Number.MIN_SAFE_INTEGER + 1,
  ];
  const strings = [
    '', 'a', 'A', 'z', 'Z', 'é', '—', '😀', '\uFFFF', '\uE000', '\u{10000}', '\u{1F600}', '\u0080', '\u00ff',
    '"', '\\', '/', '\t', '\n', '\r', '\b', '\f', '\u0000', '\u001f', '\u0020', '\u007f',
    'quote"inside', 'back\\slash', 'slash/there', 'café — naïve 😀', '  spaced  ',
  ];
  /** @param {number} depth @returns {unknown} */
  const value = (depth) => {
    const choice = next();
    if (depth >= 4 || choice < 0.45) return pick([null, true, false, ...integers, ...strings, ...strings, ...strings]);
    if (choice < 0.72) {
      const items = [];
      const count = Math.floor(next() * 4);
      for (let i = 0; i < count; i += 1) items.push(value(depth + 1));
      return items;
    }
    /** @type {Record<string, unknown>} */
    const object = {};
    const count = Math.floor(next() * 4);
    for (let i = 0; i < count; i += 1) object[pick(strings)] = value(depth + 1);
    return object;
  };
  return () => value(0);
}


test('a generated value survives value → bytes → value and bytes → value → bytes', () => {
  /** The shapes this property is worth having over, counted so that the test can
   * tell a generator that produced them from one that quietly did not. */
  const covered = { astral: false, edgeInteger: false, emptyObject: false, emptyArray: false, emptyString: false, controlCharacter: false, nested: false, nonAscii: false };

  const generate = generator(0x5eed);
  const twice = generator(0x5eed);
  const written = [];

  for (let round = 0; round < 2000; round += 1) {
    const value = generate();
    // The generator is the same function of its seed: a failure reported here has
    // to be reproducible by whoever reads it.
    assert.equal(serializeCanonical(twice()), serializeCanonical(value), `round ${round}: the generator must be a function of its seed`);

    const text = serializeCanonical(value);
    written.push(text);
    const document = utf8Encode(`${text}\n`);
    // value → bytes → value: the identity, compared through the canonical text
    // rather than through `deepEqual`. Canonical text is the stronger comparison:
    // it is byte-exact, key order cannot hide a difference in it (the writer sorts
    // keys), and it needs no JSON round trip to reconcile the two sides — the
    // reader's objects have a null prototype by design, and the reader and the
    // writer never call `JSON.parse` or `JSON.stringify` at all, so a comparison
    // that flattens both sides through them would be checking a third
    // implementation's opinion of the value.
    const trip = roundTrip(document);
    assert.equal(trip.kind, 'readable', `round ${round}: ${text} must be readable`);
    assert.equal(serializeCanonical(trip.value), text, `round ${round}: ${text} must read back as the same value`);
    // bytes → value → bytes: idempotent, and the canonical form is its own bytes.
    assert.equal(trip.identical, true, `round ${round}: ${text} must be its own canonical bytes`);

    const asText = text;
    if (/[\u{10000}-\u{10FFFF}]/u.test(asText)) covered.astral = true;
    if (asText.includes('9007199254740991') || asText.includes('-9007199254740991')) covered.edgeInteger = true;
    if (asText.includes('{}')) covered.emptyObject = true;
    if (asText.includes('[]')) covered.emptyArray = true;
    if (asText.includes('""')) covered.emptyString = true;
    if (asText.includes('\\u0000') || asText.includes('\\u001f') || asText.includes('\\n') || asText.includes('\\t')) covered.controlCharacter = true;
    if (asText.includes('[[') || asText.includes('{"')) covered.nested = true;
    if (asText.includes('é') || asText.includes('—')) covered.nonAscii = true;
  }

  for (const [shape, seen] of Object.entries(covered)) {
    assert.equal(seen, true, `the generator never produced ${shape}, so this run says nothing about it`);
  }
  assert.ok(new Set(written).size > 500, `the generated values must be varied: ${new Set(written).size} distinct of 2000`);
});

