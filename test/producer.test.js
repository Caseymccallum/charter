/**
 * The producer: a sealed file, and every way it can be made to lie.
 *
 * The primary test in this file is not a unit test. It is `charter seal`, then
 * `charter verify`, then `VERIFIED` with exit 0 — end to end, through the
 * committed command line, because the two halves of this project are two
 * implementations of one specification and the only thing worth asserting is
 * that they agree.
 *
 * The rest of the file takes a sealed file apart: determinism as a byte
 * comparison, the canonical bytes of the manifest and the log against the
 * values they carry, the signature over the *shared* signing input rather than
 * a lookalike, every single-byte change and every truncation, and the tamper
 * cases whose reason codes are compared with the ones the conformance kit
 * already records for the same attacks on a hand-built file.
 *
 * Everything here runs the command line the way a person does — a separate
 * process, reading and writing real files — except where a producer module is
 * asserted directly, which is the only way to see a value the CLI never prints.
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LATER_ACTION, NO_SUMMARY_STATED, edit } from '../producer/edit.js';
import { ProducerError, refuse } from '../producer/errors.js';
import { loadKey, signBytes } from '../producer/key.js';
import { readCharter } from '../producer/read.js';
import { FIRST_ACTION, seal } from '../producer/seal.js';
import { deriveTitle, titleFromPath, TITLE_ORIGINS } from '../producer/title.js';
import { decodeBase64Url } from '../verifier/base64url.js';
import { encodeBase64Url } from '../verifier/base64url-write.js';
import { concat, toHex, utf8Encode } from '../verifier/bytes.js';
import { parseJsonBytes } from '../verifier/canonical.js';
import { canonicalDocument, LF, signingInput } from '../verifier/canonical-write.js';
import { sha256 } from '../verifier/digest.js';
import { LIMITS } from '../verifier/limits.js';
import { ACTIONS, parseLine, splitLines } from '../verifier/provenance.js';
import { RefusalError } from '../verifier/refuse.js';
import { REASON } from '../verifier/status.js';
import { verify } from '../verifier/verify.js';
import { zipStore } from '../verifier/zip-write.js';
import { parseArchive, readEntryData } from '../verifier/zip.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CLI = join(ROOT, 'cli', 'charter.js');

/** A directory of its own, removed when this file is done with it. */
const WORK = mkdtempSync(join(tmpdir(), 'charter-producer-'));
after(() => rmSync(WORK, { recursive: true, force: true }));

/** The key every seal in this file uses, made here rather than committed. */
const KEY_PATH = join(WORK, 'test-key.pem');
writeFileSync(KEY_PATH, generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());

/** The hand-written document the brief asks to be sealed: Markdown, and small. */
const MARKDOWN =
  '# Charter: a sealed draft\n\nA document that carries its own history.\n\n## Purpose\n\nOne file holds a document and the account of how it got there.\n';
const CONTENT_PATH = join(WORK, 'draft.md');
writeFileSync(CONTENT_PATH, Buffer.from(MARKDOWN, 'utf8'));
const KEY_TEXT = readFileSync(KEY_PATH, 'utf8');

/** The one instant every seal in this file states, so that bytes are comparable. */
const AT = '2026-01-01T00:00:00Z';

/**
 * The second revision of the same document: what a later entry writes.
 *
 * It is the same document with one section added, because that is what an edit
 * is. The file carries the new revision, and the digest of the old one survives
 * only inside the entry that named it.
 */
const SECOND_MARKDOWN =
  '# Charter: a sealed draft\n\nA document that carries its own history.\n\n## Purpose\n\nOne file holds a document and the account of how it got there.\n\n## History\n\nA second entry says what changed.\n';
const SECOND_PATH = join(WORK, 'draft-2.md');
writeFileSync(SECOND_PATH, Buffer.from(SECOND_MARKDOWN, 'utf8'));

/**
 * @param {string[]} args
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function charter(args) {
  const run = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { status: run.status ?? -1, stdout: run.stdout, stderr: run.stderr };
}

/**
 * Seal the hand-written document, the way a person would.
 *
 * @param {string} out
 * @param {string[]} [extra] further flags
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function sealTo(out, extra = []) {
  return charter(['seal', CONTENT_PATH, '--key', KEY_PATH, '-o', out, '--author', 'Casey', '--created-at', AT, ...extra]);
}

/**
 * The failing checks of a verdict, as `vectors/expected.json` states them:
 * check id to reason code.
 *
 * @param {import('../verifier/status.js').CheckResult[]} checks
 * @returns {Record<string, string>}
 */
function failing(checks) {
  /** @type {Record<string, string>} */
  const fail = {};
  for (const check of checks) {
    if (check.status === 'FAIL') fail[check.id] = check.reason_code;
  }
  return fail;
}

/**
 * What the conformance kit records for one adversarial case.
 *
 * @param {string} name
 * @returns {{ verdict: string, exit_code: number, fail: Record<string, string>, unsupported: Record<string, string>, skips: number }}
 */
function recorded(name) {
  const record = JSON.parse(readFileSync(join(ROOT, 'vectors', 'expected.json'), 'utf8'));
  const found = record.cases.find((entry) => entry.name === name);
  assert.ok(found !== undefined, `the kit has no case named ${name}`);
  return found.expected;
}

/**
 * @param {Uint8Array} bytes
 * @param {number} at
 * @returns {Uint8Array} a copy with one bit of one byte changed
 */
function flipBit(bytes, at) {
  const out = Uint8Array.from(bytes);
  out[at] ^= 0x01;
  return out;
}

/**
 * One entry of a sealed file, read with the verifier's own container reader.
 *
 * @param {Uint8Array} bytes
 * @param {string} name
 * @returns {Promise<Uint8Array>}
 */
async function entryBytes(bytes, name) {
  const archive = parseArchive(bytes);
  assert.equal(archive.ok, true, 'a sealed file must be an archive the verifier can walk');
  const entry = archive.entries.find((one) => one.name === name);
  assert.ok(entry !== undefined, `the sealed file must hold ${name}`);
  const read = await readEntryData(bytes, entry);
  assert.equal(read.ok, true, `"${name}" must decode`);
  return read.data;
}

/**
 * One entry's record out of an archive, for the offsets a tamper needs.
 *
 * @param {Uint8Array} bytes
 * @param {string} name
 * @returns {object}
 */
function entryRecord(bytes, name) {
  const archive = parseArchive(bytes);
  assert.equal(archive.ok, true);
  const entry = archive.entries.find((one) => one.name === name);
  assert.ok(entry !== undefined, `the sealed file must hold ${name}`);
  return entry;
}

test('seal writes a file the verifier accepts, end to end', () => {
  const out = join(WORK, 'end-to-end.charter');
  const produced = sealTo(out);
  assert.equal(produced.status, 0, produced.stderr);

  const verified = charter(['verify', out, '--json']);
  assert.equal(verified.status, 0, verified.stderr);
  const report = JSON.parse(verified.stdout);
  assert.equal(report.verdict, 'VERIFIED');
  assert.equal(
    report.checks.every((check) => check.status === 'PASS'),
    true,
    'every check must pass on a freshly sealed file',
  );
  assert.equal(report.artifact.title, 'Charter: a sealed draft', 'the title is read out of the document');
  assert.equal(report.artifact.author_name, 'Casey');
  assert.equal(report.artifact.entries, 1);
  assert.equal(report.artifact.format, 'charter/0.1');
});

test('a sealed file holds the bytes that were sealed, in a container the format fixes', async () => {
  const out = join(WORK, 'entries.charter');
  assert.equal(sealTo(out).status, 0);
  const bytes = new Uint8Array(readFileSync(out));

  const archive = parseArchive(bytes);
  assert.equal(archive.ok, true);
  assert.deepEqual(
    archive.entries.map((entry) => entry.name),
    ['manifest.json', 'content.md', 'provenance.jsonl'],
  );
  assert.equal(archive.metadata.ok, true, archive.metadata.detail);
  for (const entry of archive.entries) {
    assert.equal(entry.method, 0, `"${entry.name}" must be stored`);
  }
  assert.deepEqual(await entryBytes(bytes, 'content.md'), utf8Encode(MARKDOWN), 'content.md is the document byte for byte');
});

test('seal is deterministic: two runs with the same inputs produce the same bytes', () => {
  const first = join(WORK, 'determinism-1.charter');
  const second = join(WORK, 'determinism-2.charter');
  const third = join(WORK, 'determinism-3.charter');
  for (const path of [first, second]) {
    const run = sealTo(path);
    assert.equal(run.status, 0, run.stderr);
  }

  const one = readFileSync(first);
  const two = readFileSync(second);
  assert.ok(one.length > 1000, `a sealed file is more than a header, and this one is ${one.length} bytes`);
  assert.equal(one.length, two.length, 'two seals of the same inputs must be the same length');
  assert.deepEqual(one, two, 'two seals of the same inputs must be the same bytes, byte for byte');

  // The comparison above means something only if a different input changes the
  // bytes, so one byte-affecting argument is changed and the bytes must differ.
  const other = charter(['seal', CONTENT_PATH, '--key', KEY_PATH, '-o', third, '--author', 'Casey', '--created-at', '2026-01-02T00:00:00Z']);
  assert.equal(other.status, 0, other.stderr);
  assert.notDeepEqual(readFileSync(third), one, 'a different stated time is a different record');
});

test('seal writes the canonical bytes, and signs the shared signing input', async () => {
  const sealed = await seal({
    content: utf8Encode(MARKDOWN),
    key: KEY_TEXT,
    content_name: 'draft.md',
    author: 'Casey',
    created_at: AT,
  });
  const loaded = await loadKey(KEY_TEXT);

  const manifestBytes = await entryBytes(sealed.bytes, 'manifest.json');
  const parsed = parseJsonBytes(manifestBytes);
  assert.equal(parsed.ok, true, 'the manifest must parse');
  assert.deepEqual(manifestBytes, canonicalDocument(parsed.value), 'manifest.json is the canonical form of its value plus one LF');
  // Ed25519 is deterministic, so signing the writer's signing input again must
  // reproduce the signature in the file exactly. That is what says the producer
  // signed the bytes `verifier/canonical-write.js` defines, and not a lookalike.
  assert.equal(parsed.value.signature, encodeBase64Url(signBytes(loaded, signingInput(parsed.value, 'signature'))));

  const logBytes = await entryBytes(sealed.bytes, 'provenance.jsonl');
  const lines = splitLines(logBytes);
  assert.equal(lines.ok, true, 'provenance.jsonl must split into lines');
  assert.equal(lines.lines.length, 1, 'a seal writes one entry');
  const line = parseLine(lines.lines[0], 1);
  assert.equal(line.ok, true, 'the entry must parse');
  assert.deepEqual(logBytes, canonicalDocument(line.value), 'the entry is the canonical form of its value plus the one LF that closes it');
  assert.equal(line.value.signature, encodeBase64Url(signBytes(loaded, signingInput(line.value, 'signature'))));
  assert.equal(line.value.parent, null, 'the first entry declares no parent');
  assert.equal(line.value.content_sha256, parsed.value.content.sha256, 'the head describes the content the manifest declares');
  assert.equal(line.value.author.key_id, parsed.value.author.key_id);
  assert.equal(line.value.author.key_id, loaded.key_id);
});

test('the action a seal writes is one the reader defines', async () => {
  assert.ok(ACTIONS.includes(FIRST_ACTION), `${FIRST_ACTION} is not an action verifier/provenance.js defines`);
  const sealed = await seal({ content: utf8Encode(MARKDOWN), key: KEY_TEXT, created_at: AT });
  const lines = splitLines(await entryBytes(sealed.bytes, 'provenance.jsonl'));
  assert.equal(lines.ok, true);
  const line = parseLine(lines.lines[0], 1);
  assert.equal(line.ok, true);
  assert.equal(line.value.action, FIRST_ACTION);
  assert.equal(line.value.summary, sealed.claims.summary);
});

/** The canonical manifest writes the signature field as `"signature":"`. */
const SIGNATURE_MARKER = '"signature":"';

/**
 * @param {Uint8Array} haystack
 * @param {Uint8Array | string} needle
 * @param {number} [from]
 * @returns {number} the first offset of `needle`, or -1
 */
function indexOfSequence(haystack, needle, from = 0) {
  const parts = typeof needle === 'string' ? utf8Encode(needle) : needle;
  outer: for (let at = from; at + parts.length <= haystack.length; at += 1) {
    for (let index = 0; index < parts.length; index += 1) {
      if (haystack[at + index] !== parts[index]) continue outer;
    }
    return at;
  }
  return -1;
}

/**
 * Change one character of the first signature in an entry's own bytes.
 *
 * The character is changed to another character of the *same* alphabet on
 * purpose. The attack being built is a signature that is well formed and wrong
 * — the one `bad-manifest-signature` and `entry-edited` record — and not a
 * signature that is malformed, which is a different case in the kit.
 *
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
function changeSignatureCharacter(data) {
  const at = indexOfSequence(data, SIGNATURE_MARKER);
  assert.ok(at >= 0, 'the entry holds no signature field');
  const first = at + SIGNATURE_MARKER.length;
  const changed = Uint8Array.from(data);
  changed[first] = changed[first] === 0x41 ? 0x42 : 0x41;
  return changed;
}

/**
 * Rebuild a sealed file around changed entries, with the container repaired.
 *
 * This is the attack the kit's fixtures build, and the one an attacker holding a
 * ZIP tool would build: the archive is *correct* — sizes, CRC-32, and every
 * metadata field agree with the bytes it holds — and one document inside it
 * lies. Rebuilding with the producer's own writer is what makes the comparison
 * with those fixtures possible, because a byte changed in place is a different
 * attack: see the test below, where the container's own checksum is what notices
 * first.
 *
 * @param {Uint8Array} bytes the sealed file
 * @param {Record<string, (data: Uint8Array) => Uint8Array>} changes one entry name to the change made
 * @returns {Promise<Uint8Array>}
 */
async function rebuildWith(bytes, changes) {
  const archive = parseArchive(bytes);
  assert.equal(archive.ok, true);
  const entries = [];
  for (const record of archive.entries) {
    const read = await readEntryData(bytes, record);
    assert.equal(read.ok, true, `"${record.name}" must decode out of the sealed file`);
    const change = changes[record.name];
    entries.push({ name: record.name, data: change === undefined ? read.data : change(read.data) });
  }
  assert.deepEqual(
    Object.keys(changes).sort(),
    entries.map((entry) => entry.name).filter((name) => changes[name] !== undefined).sort(),
    'every entry named in the changes must be an entry this file holds',
  );
  return zipStore(entries);
}

test('a tampered sealed file is refused with the reason codes the kit records for the same attack', async () => {
  const out = join(WORK, 'tamper.charter');
  assert.equal(sealTo(out).status, 0);
  const original = new Uint8Array(readFileSync(out));

  // The document's bytes change and the archive is written correctly around
  // them: `content-tampered`, and the content digest is the check that catches
  // it. Every other check — the chain, the signatures, the container — still
  // holds, which is the whole point of the digest.
  const contentTampered = await rebuildWith(original, { 'content.md': (data) => flipBit(data, 0) });
  const contentResult = await verify(contentTampered);
  assert.equal(contentResult.verdict, 'BROKEN');
  assert.deepEqual(failing(contentResult.checks), recorded('content-tampered').fail);

  // One character of the manifest's signature: `bad-manifest-signature`.
  const manifestTampered = await rebuildWith(original, { 'manifest.json': changeSignatureCharacter });
  const manifestResult = await verify(manifestTampered);
  assert.equal(manifestResult.verdict, 'BROKEN');
  assert.deepEqual(failing(manifestResult.checks), recorded('bad-manifest-signature').fail);

  // One character of the entry's own signature: `entry-edited`, which changes an
  // entry and leaves the signature stale. The kit's fixture has two entries, so
  // its stale signature also breaks the *next* entry's link; a single-entry
  // artifact has no next entry, and that is the one structural difference.
  assert.equal(recorded('entry-edited').fail['L2.CHAIN.LINKS'], 'MISMATCH', 'the kit case has a second entry, so its link breaks too');
  const expectedEntry = { ...recorded('entry-edited').fail };
  delete expectedEntry['L2.CHAIN.LINKS'];
  const entryTampered = await rebuildWith(original, { 'provenance.jsonl': changeSignatureCharacter });
  const entryResult = await verify(entryTampered);
  assert.equal(entryResult.verdict, 'BROKEN');
  assert.deepEqual(failing(entryResult.checks), expectedEntry);
});

test('a byte changed in place is caught by the container as well, and still refused', async () => {
  const out = join(WORK, 'tamper-in-place.charter');
  assert.equal(sealTo(out).status, 0);
  const original = new Uint8Array(readFileSync(out));
  const contentAt = entryRecord(original, 'content.md').dataOffset;

  // One bit of one byte of content.md, with nothing repaired. Entries are
  // stored, so the bytes the CRC-32 covers are exactly the bytes that changed:
  // the container notices before any document check does, and the digest the
  // `content-tampered` fixture is about fails as well. The verdict is the same
  // — a richer set of reasons is not a weaker refusal.
  const inPlace = flipBit(original, contentAt);
  assert.equal(inPlace.length, original.length, 'a one-bit change does not change the size');
  const result = await verify(inPlace);
  assert.equal(result.verdict, 'BROKEN');
  const seen = failing(result.checks);
  assert.equal(seen['L0.CONTENT.HASH'], 'MISMATCH', 'the digest check the kit records for this edit must fail');
  assert.equal(seen['L0.ZIP.CRC32'], 'MISMATCH', 'and the entry the bytes are in does not match its own declared CRC-32');
});

test('no single-byte change to a sealed file is verified', async () => {
  const out = join(WORK, 'sweep-bytes.charter');
  assert.equal(sealTo(out).status, 0);
  const bytes = new Uint8Array(readFileSync(out));

  let accepted = 0;
  for (let at = 0; at < bytes.length; at += 1) {
    const result = await verify(flipBit(bytes, at));
    if (result.verdict === 'VERIFIED') accepted += 1;
  }
  assert.equal(accepted, 0, `${accepted} of ${bytes.length} single-byte change(s) were accepted`);
});

test('every truncation of a sealed file is refused', async () => {
  const out = join(WORK, 'sweep-truncations.charter');
  assert.equal(sealTo(out).status, 0);
  const bytes = new Uint8Array(readFileSync(out));

  const from = Math.max(0, bytes.length - 512);
  for (let at = from; at < bytes.length; at += 1) {
    const result = await verify(bytes.subarray(0, at));
    assert.notEqual(result.verdict, 'VERIFIED', `a file cut at ${at} of ${bytes.length} bytes was accepted`);
  }
});

test('seal then inspect prints the key id the verdict agrees with, and no verdict', () => {
  const out = join(WORK, 'inspect.charter');
  assert.equal(sealTo(out).status, 0);

  const inspected = charter(['inspect', out]);
  assert.equal(inspected.status, 0, inspected.stderr);
  const verdict = JSON.parse(charter(['verify', out, '--json']).stdout);

  assert.ok(inspected.stdout.includes(verdict.artifact.author_key_id), 'inspect must print the key id the verdict reports');
  assert.ok(inspected.stdout.includes(verdict.artifact.head_content_sha256), 'inspect must print the content hash');
  assert.ok(inspected.stdout.includes(`entries         ${verdict.artifact.entries}`), 'inspect must print the entry count');
  assert.equal(
    /\b(VERIFIED|INCOMPLETE|BROKEN|PASS|FAIL|UNSUPPORTED|SKIP)\b/.test(inspected.stdout),
    false,
    'inspect describes a file and never judges it',
  );
});

test('inspect describes a version it does not implement, and refuses what it cannot describe', () => {
  const unsupported = charter(['inspect', join(ROOT, 'vectors', 'out', 'unsupported-format.charter')]);
  assert.equal(unsupported.status, 0, unsupported.stderr);
  assert.ok(unsupported.stdout.includes('this build implements charter/0.1'), 'inspect must say whether it implements the declared version');
  assert.equal(/\b(VERIFIED|INCOMPLETE|BROKEN|PASS|FAIL|UNSUPPORTED|SKIP)\b/.test(unsupported.stdout), false);

  const nothing = charter(['inspect', join(ROOT, 'vectors', 'out', 'not-a-zip.charter')]);
  assert.equal(nothing.status, 65, nothing.stderr);
  const code = (nothing.stderr.match(/^charter inspect: ([A-Z_]+): /) ?? [])[1];
  assert.ok(Object.values(REASON).includes(code), `inspect refused with ${code}, which is not a reason code of the format`);
  assert.equal(nothing.stdout, '', 'nothing is described about a file whose claims could not be read');
});

test('seal then cite produces CSL-JSON whose identifier is the claim hash', () => {
  const out = join(WORK, 'cite.charter');
  assert.equal(sealTo(out).status, 0);
  const verdict = JSON.parse(charter(['verify', out, '--json']).stdout);

  const cited = charter(['cite', out, '--accessed', '2026-09-16']);
  assert.equal(cited.status, 0, cited.stderr);
  const item = JSON.parse(cited.stdout);
  assert.equal(item.id, verdict.artifact.head_content_sha256, 'the identifier is the claim hash');
  assert.equal(item.type, 'manuscript');
  assert.equal(item.title, 'Charter: a sealed draft', 'the title is read out of the document');
  assert.deepEqual(item.author, [{ literal: 'Casey' }]);
  assert.deepEqual(item.issued, [[2026, 1, 1]], 'the issued date is the time the file states');
  assert.deepEqual(item.accessed, [[2026, 9, 16]], 'the access date is the day the citation was made');
  assert.equal(item.custom.charter.key_id, verdict.artifact.author_key_id);
  assert.equal(item.custom.charter.format, 'charter/0.1');
  assert.equal(item.custom.charter.entries, 1);
  assert.equal(item.custom.charter.title_source, 'derived');
  assert.equal(item.custom.charter.title_origin, 'heading');
  assert.match(item.custom.charter.artifact_sha256, /^[0-9a-f]{64}$/);
  assert.ok(item.note.includes(verdict.artifact.head_content_sha256), 'the note names the claim it cites');

  const stated = JSON.parse(charter(['cite', out, '--accessed', '2026-09-16', '--title', 'A stated title']).stdout);
  assert.equal(stated.title, 'A stated title');
  assert.equal(stated.custom.charter.title_source, 'asserted', 'a stated title is marked as asserted, not derived');
  assert.equal(stated.custom.charter.title_origin, 'stated');
});

test('the claims the producer reads are the claims the verdict reports', async () => {
  for (const name of ['valid', 'valid-deflate', 'history-rewritten', 'empty-content']) {
    const bytes = new Uint8Array(readFileSync(join(ROOT, 'vectors', 'out', `${name}.charter`)));
    const read = await readCharter(bytes);
    const result = await verify(bytes);
    assert.equal(read.ok, true, `${name}: readCharter refused a file the kit holds`);
    assert.ok(result.artifact !== null, `${name}: the verdict read no artifact`);
    assert.equal(read.claims.format, result.artifact.format, `${name}: format`);
    assert.equal(read.claims.title, result.artifact.title, `${name}: title`);
    assert.equal(read.claims.created_at, result.artifact.created_at, `${name}: created_at`);
    assert.equal(read.claims.author_name, result.artifact.author_name, `${name}: author`);
    assert.equal(read.claims.author_key_id, result.artifact.author_key_id, `${name}: key id`);
    assert.equal(read.claims.content_sha256, result.artifact.head_content_sha256, `${name}: content digest`);
    assert.equal(read.claims.entries, result.artifact.entries, `${name}: entry count`);
  }
});

/* ------------------------ what the producer refuses ------------------------ */

/** Content that is not UTF-8: the bytes of the file are the content, and these are not text. */
const BAD_UTF8_PATH = join(WORK, 'not-utf8.md');
writeFileSync(BAD_UTF8_PATH, Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a]));
/** The same document, with the byte order mark the format refuses. */
const BOM_PATH = join(WORK, 'with-bom.md');
writeFileSync(BOM_PATH, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(MARKDOWN, 'utf8')]));
/** A private key of an algorithm charter/0.1 does not define. */
const EC_KEY_PATH = join(WORK, 'p-256.pem');
writeFileSync(EC_KEY_PATH, generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
/** A file with a key's shape and no key in it. */
const JUNK_KEY_PATH = join(WORK, 'not-a-key.pem');
writeFileSync(JUNK_KEY_PATH, '-----BEGIN PRIVATE KEY-----\nnot a key at all\n-----END PRIVATE KEY-----\n');
const MISSING_PATH = join(WORK, 'no-such-file.md');

/**
 * A refusal is a reason code from the format's vocabulary, an exit code, and
 * nothing written.
 *
 * @param {string} verb
 * @param {{ status: number, stderr: string }} run
 * @param {string} code
 * @param {number} exit
 * @returns {void}
 */
function assertRefusal(verb, run, code, exit) {
  assert.equal(run.status, exit, `${verb} must exit ${exit}, and exited ${run.status}: ${run.stderr}`);
  assert.equal(run.stderr.startsWith(`charter ${verb}: ${code}: `), true, `${verb} must refuse with ${code}: ${run.stderr}`);
  assert.ok(Object.values(REASON).includes(code), `${code} is not a reason code of the format`);
}

test('seal refuses content and keys it cannot write, each with a reason code', () => {
  const cases = [
    ['content that is not UTF-8', BAD_UTF8_PATH, KEY_PATH, 'DECODE_ERROR'],
    ['content with a byte order mark', BOM_PATH, KEY_PATH, 'NON_CANONICAL'],
    ['a key of another algorithm', CONTENT_PATH, EC_KEY_PATH, 'UNSUPPORTED_FEATURE'],
    ['a key file that holds no key', CONTENT_PATH, JUNK_KEY_PATH, 'MALFORMED'],
  ];
  for (const [what, content, key, code] of cases) {
    const out = join(WORK, `refused-${code}.charter`);
    const run = charter(['seal', content, '--key', key, '-o', out, '--created-at', AT]);
    assertRefusal('seal', run, code, 65);
    assert.equal(existsSync(out), false, `${what}: a refusal must write nothing`);
  }
});

test('seal refuses a file it cannot read, an output it cannot create, and nothing else', () => {
  const missingContent = charter(['seal', MISSING_PATH, '--key', KEY_PATH, '-o', join(WORK, 'never.charter')]);
  assertRefusal('seal', missingContent, 'MISSING', 66);
  const missingKey = charter(['seal', CONTENT_PATH, '--key', MISSING_PATH, '-o', join(WORK, 'never.charter')]);
  assertRefusal('seal', missingKey, 'MISSING', 66);
  assert.equal(existsSync(join(WORK, 'never.charter')), false);

  const taken = join(WORK, 'taken.charter');
  const wasThere = 'not a charter, and not this command to replace';
  writeFileSync(taken, wasThere);
  assertRefusal('seal', sealTo(taken), 'EXTRA', 73);
  assert.equal(readFileSync(taken, 'utf8'), wasThere, 'the file that was there is still there');
  assert.equal(sealTo(taken, ['--force']).status, 0, 'and --force overwrites it');

  const directory = join(WORK, 'a-directory');
  mkdirSync(directory, { recursive: true });
  // Something is already there, and it is not a file this command may write:
  // the first refusal is about what is in the way, and --force gets past it and
  // meets the second, which is that a directory cannot hold it.
  assertRefusal('seal', sealTo(directory), 'EXTRA', 73);
  assertRefusal('seal', sealTo(directory, ['--force']), 'MALFORMED', 73);
});

test('seal refuses a stated time that is not the form the format fixes', () => {
  const out = join(WORK, 'bad-time.charter');
  const run = charter(['seal', CONTENT_PATH, '--key', KEY_PATH, '-o', out, '--created-at', '2026-01-01 00:00:00']);
  assertRefusal('seal', run, 'MALFORMED', 65);
  assert.match(run.stderr, /YYYY-MM-DDTHH:MM:SSZ/);
  assert.equal(existsSync(out), false);
});

test('cite refuses a date that is not a date, rather than writing one', () => {
  const out = join(WORK, 'cite-date.charter');
  assert.equal(sealTo(out).status, 0);
  const run = charter(['cite', out, '--accessed', '2026-02-30']);
  assertRefusal('cite', run, 'MALFORMED', 65);
  assert.equal(run.stdout, '', 'a refused citation prints no item');
});

test('the producer verbs refuse a command line they do not understand', () => {
  const cases = [
    [['seal', CONTENT_PATH, '-o', join(WORK, 'x.charter'), '--created-at', AT], 'no key was named'],
    [['seal', CONTENT_PATH, '--key', KEY_PATH, '--created-at', AT], 'no output file was named'],
    [['seal', CONTENT_PATH, CONTENT_PATH, '--key', KEY_PATH, '-o', join(WORK, 'x.charter')], 'only one document may be sealed'],
    [['seal', CONTENT_PATH, '--key', KEY_PATH, '-o', join(WORK, 'x.charter'), '--deep'], 'unknown option'],
    [['seal', CONTENT_PATH, '--key', KEY_PATH, '-o', join(WORK, 'x.charter'), '--now', '--created-at', AT], 'two different times'],
    [['seal'], 'no content file was named'],
    [['inspect'], 'no file was named'],
    [['cite'], 'no file was named'],
    [['keygen'], 'no output file was named'],
  ];
  for (const [args, message] of cases) {
    const run = charter(args);
    assert.equal(run.status, 64, `${args.join(' ')} must exit 64: ${run.stderr}`);
    assert.ok(run.stderr.includes(message), `${args.join(' ')}: ${run.stderr}`);
    assert.ok(run.stderr.includes('Usage:'), 'a command line that was not understood prints the usage');
  }
});

test('keygen writes a key that seals a file the verifier accepts', () => {
  const keyPath = join(WORK, 'generated.pem');
  const created = charter(['keygen', '-o', keyPath]);
  assert.equal(created.status, 0, created.stderr);
  const reported = (created.stdout.match(/ed25519:[0-9a-f]{64}/) ?? [])[0];
  assert.ok(reported !== undefined, created.stdout);
  assert.equal(readFileSync(keyPath, 'utf8').startsWith('-----BEGIN PRIVATE KEY-----'), true, 'the key is PKCS#8 PEM');

  const out = join(WORK, 'generated.charter');
  const sealed = charter(['seal', CONTENT_PATH, '--key', keyPath, '-o', out, '--created-at', AT]);
  assert.equal(sealed.status, 0, sealed.stderr);
  assert.equal(charter(['verify', out]).status, 0);
  const verdict = JSON.parse(charter(['verify', out, '--json']).stdout);
  assert.equal(verdict.artifact.author_key_id, reported, 'the key the keygen report named is the key the verdict finds');

  assertRefusal('keygen', charter(['keygen', '-o', keyPath]), 'EXTRA', 73);
  assert.equal(charter(['keygen', '-o', keyPath, '--force']).status, 0);
});

test('--now states the sealing time, and the file still verifies', () => {
  const out = join(WORK, 'now.charter');
  const before = Date.now();
  // `--now` instead of `--created-at`: the two state a time and nothing may
  // state two of them, which is asserted below.
  const run = charter(['seal', CONTENT_PATH, '--key', KEY_PATH, '-o', out, '--now']);
  const after = Date.now();
  assert.equal(run.status, 0, run.stderr);

  const report = JSON.parse(charter(['seal', CONTENT_PATH, '--key', KEY_PATH, '-o', join(WORK, 'now-json.charter'), '--now', '--json']).stdout);
  assert.equal(report.time_stated, true, 'a stated time is reported as stated');
  assert.match(report.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, 'the clock is read at second precision, in UTC');
  const stated = Date.parse(report.created_at);
  assert.ok(stated >= before - 2000 && stated <= after + 2000, `${report.created_at} is not the time this test ran`);
  assert.equal(charter(['verify', out]).status, 0);
});

test('a seal that states no time says so, and one that states a time keeps it', () => {
  const unstated = JSON.parse(charter(['seal', CONTENT_PATH, '--key', KEY_PATH, '-o', join(WORK, 'unstated.charter'), '--json']).stdout);
  assert.equal(unstated.time_stated, false);
  assert.equal(unstated.created_at, '1980-01-01T00:00:00Z', 'the value that means no time is the instant the DOS stamp means');

  const stated = JSON.parse(charter(['seal', CONTENT_PATH, '--key', KEY_PATH, '-o', join(WORK, 'stated.charter'), '--created-at', AT, '--json']).stdout);
  assert.equal(stated.time_stated, true);
  assert.equal(stated.created_at, AT);
});

/* ------------------- the rules the producer is itself held to ------------------- */

const PRODUCER_DIR = join(ROOT, 'producer');
const PRODUCER_MODULES = readdirSync(PRODUCER_DIR).filter((name) => name.endsWith('.js')).sort();

test('the producer directory holds the modules it says it holds', () => {
  assert.ok(PRODUCER_MODULES.length >= 5, `expected the producer modules, found ${PRODUCER_MODULES.join(', ')}`);
  for (const module of PRODUCER_MODULES) {
    const text = readFileSync(join(PRODUCER_DIR, module), 'utf8');
    assert.ok(text.includes('@module producer/'), `${module} must declare itself with a @module tag`);
  }
  // The modules that need what the format defines take it from the verifier
  // rather than restating it, which is what keeps one specification in one
  // place. The ZIP writer and the base64url writer are not in this list anymore
  // because they are not in this directory anymore: both moved to `verifier/**`
  // when a second writer — the editor, which runs in a page — had to import
  // them, and a directory a browser may not import cannot hold shared code.
  for (const module of ['seal.js', 'edit.js', 'read.js', 'key.js', 'cite.js']) {
    const text = readFileSync(join(PRODUCER_DIR, module), 'utf8');
    assert.ok(text.includes("from '../verifier/"), `${module} must take the format from verifier/**, not restate it`);
  }
});

test('the producer touches nothing but a key, and the command line does the rest', () => {
  const FORBIDDEN = [
    ['the file system', /\bnode:fs\b/],
    ['the process object', /\bprocess\./],
    ['the clock', /\bDate\.now\b|\bnew\s+Date\s*\(/],
    ['a random source', /\bMath\.random\b/],
    ['the network', /\bfetch\s*\(|XMLHttpRequest|WebSocket/],
    ['a timer', /\bsetTimeout\s*\(|\bsetInterval\s*\(/],
  ];
  for (const module of PRODUCER_MODULES) {
    const text = readFileSync(join(PRODUCER_DIR, module), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
    for (const [what, pattern] of FORBIDDEN) {
      const found = text.match(pattern);
      assert.equal(found, null, `producer/${module} uses ${what}: ${found === null ? '' : found[0]}`);
    }
    for (const specifier of [...text.matchAll(/\bfrom\s+['"](node:[^'"]+)['"]/g)].map((match) => match[1])) {
      assert.equal(specifier, 'node:crypto', `producer/${module} imports ${specifier}, and the producer's one runtime dependency is node:crypto`);
    }
  }
});

test('a refusal carries a reason code of the format, and no other name', () => {
  /** @type {unknown} */
  let error = null;
  try {
    refuse(REASON.MISSING, 'a detail');
  } catch (thrown) {
    error = thrown;
  }
  assert.ok(error instanceof ProducerError);
  assert.equal(error.reason_code, REASON.MISSING);
  assert.equal(error.detail, 'a detail');
  assert.throws(() => refuse('NOT_A_REASON_CODE', 'a detail'), TypeError, 'a refusal may not invent a name');
});

test('the producer writes base64url the reader accepts, at every length', () => {
  for (let length = 1; length <= 72; length += 1) {
    const bytes = new Uint8Array(length);
    for (let at = 0; at < length; at += 1) bytes[at] = (at * 37 + length * 11 + 5) & 0xff;
    const text = encodeBase64Url(bytes);
    assert.equal(text.includes('='), false, `length ${length}: canonical base64url is unpadded`);
    assert.equal(/^[A-Za-z0-9_-]+$/.test(text), true, `length ${length}: ${text} is not the URL-safe alphabet`);
    const decoded = decodeBase64Url(text);
    assert.equal(decoded.ok, true, `length ${length}: the reader refused what the producer wrote`);
    assert.deepEqual(decoded.value, bytes, `length ${length}`);
  }
});

test('a title is read from where a document carries one, and never invented', () => {
  assert.deepEqual(deriveTitle(utf8Encode('<head><title>Captured Title</title></head>\n\n# Not this one\n')), {
    title: 'Captured Title',
    origin: TITLE_ORIGINS.ELEMENT,
  });
  assert.deepEqual(deriveTitle(utf8Encode('# Heading Title\n\nBody.\n')), { title: 'Heading Title', origin: TITLE_ORIGINS.HEADING });
  assert.deepEqual(deriveTitle(utf8Encode('#### Fourth level ##\n')), { title: 'Fourth level', origin: TITLE_ORIGINS.HEADING });
  assert.deepEqual(deriveTitle(utf8Encode('#  Collapsed   spaces \n')), { title: 'Collapsed spaces', origin: TITLE_ORIGINS.HEADING });
  assert.equal(deriveTitle(utf8Encode('####### seven hashes are not a heading\n')), null);
  assert.equal(deriveTitle(utf8Encode('Just a paragraph.\n')), null);
  assert.equal(deriveTitle(new Uint8Array([0xff, 0xfe])), null, 'bytes that are not UTF-8 carry no title this can read');
  assert.equal(titleFromPath(join('notes', 'draft.md')), 'draft');
  assert.equal(titleFromPath('C:\\notes\\draft.md'), 'draft');
  assert.equal(titleFromPath('Makefile'), 'Makefile', 'a name with no extension is the title');
  assert.equal(titleFromPath('.gitignore'), '.gitignore', 'a leading dot is not an extension');
});

test('a seal records where its title came from', async () => {
  const plain = utf8Encode('No heading here, only prose.\n');
  const fromPath = await seal({ content: plain, key: KEY_TEXT, content_name: join('notes', 'draft.md'), created_at: AT });
  assert.equal(fromPath.claims.title, 'draft');
  assert.equal(fromPath.claims.title_origin, TITLE_ORIGINS.FILE_NAME);

  const stated = await seal({ content: plain, key: KEY_TEXT, content_name: 'draft.md', title: 'A stated title', created_at: AT });
  assert.equal(stated.claims.title, 'A stated title');
  assert.equal(stated.claims.title_origin, TITLE_ORIGINS.STATED);

  const captured = await seal({ content: utf8Encode('<title>From the capture</title>\n'), key: KEY_TEXT, created_at: AT });
  assert.equal(captured.claims.title, 'From the capture');
  assert.equal(captured.claims.title_origin, TITLE_ORIGINS.ELEMENT);
});

test('the producer refuses to write an artifact the verifier would refuse to read', async () => {
  /** @type {unknown} */
  let error = null;
  try {
    await seal({ content: utf8Encode(MARKDOWN), key: KEY_TEXT, created_at: AT }, { limits: { ...LIMITS, MAX_JSON_DOCUMENT_BYTES: 64 } });
  } catch (thrown) {
    error = thrown;
  }
  assert.ok(error instanceof ProducerError, 'a manifest above the declared ceiling must be refused');
  assert.equal(error.reason_code, REASON.LIMIT_EXCEEDED);
  assert.equal(error.path, 'manifest.json');

  // The ZIP writer's refusal is the shared one, not the producer's: the writer
  // lives in `verifier/**` and may not import the producer's error class. Both
  // are refusals with a reason code from the same vocabulary, which is the
  // property that matters; which class it is says who refused.
  assert.throws(
    () => zipStore([{ name: 'content.md', data: new Uint8Array(8) }], { ...LIMITS, MAX_ENTRY_BYTES: 4 }),
    RefusalError,
    'an entry above the declared ceiling is refused rather than written',
  );
  assert.ok(new ProducerError(REASON.MISSING, 'a detail') instanceof RefusalError, 'the producer adds a name to the shared refusal rather than replacing it');
});

/**
 * The second half of the producer: a history with more than one entry in it.
 *
 * These are the seal tests' shape — through the committed command line, then read
 * back with the verifier's own reader — because the claim is the same one: the
 * two implementations of this specification agree about the bytes between them.
 * The rules are section 15.6's, and the mistake they are written to make
 * impossible is a producer that gets one wrong by being *helpful*: refusing a
 * time the format allows, reflowing a line it was handed, or dropping a field a
 * file carried because writing it back without the field was easier.
 */

test('seal, then edit, then verify: a document with a history, end to end', () => {
  const first = join(WORK, 'history-1.charter');
  const second = join(WORK, 'history-2.charter');
  assert.equal(sealTo(first).status, 0);

  const edited = charter(['edit', first, SECOND_PATH, '--key', KEY_PATH, '-o', second, '--summary', 'Add a History section.', '--created-at', '2026-01-02T09:30:00Z']);
  assert.equal(edited.status, 0, edited.stderr);

  const verified = charter(['verify', second, '--json']);
  assert.equal(verified.status, 0, verified.stderr);
  const report = JSON.parse(verified.stdout);
  assert.equal(report.verdict, 'VERIFIED');
  assert.equal(report.checks.every((check) => check.status === 'PASS'), true, 'every check must pass on an edited file');
  assert.equal(report.artifact.entries, 2, 'the file records two revisions');
  assert.equal(report.artifact.title, 'Charter: a sealed draft', 'the title the seal recorded is the title an edit keeps');
  assert.equal(report.artifact.author_name, 'Casey');
  assert.equal(report.artifact.format, 'charter/0.1');
});

test('an edit appends a line and copies the lines it was handed, byte for byte', async () => {
  const first = join(WORK, 'copy-1.charter');
  const second = join(WORK, 'copy-2.charter');
  const third = join(WORK, 'copy-3.charter');
  assert.equal(sealTo(first).status, 0);
  assert.equal(charter(['edit', first, SECOND_PATH, '--key', KEY_PATH, '-o', second, '--created-at', '2026-01-02T09:30:00Z']).status, 0);
  assert.equal(charter(['edit', second, CONTENT_PATH, '--key', KEY_PATH, '-o', third, '--created-at', '2026-01-03T11:00:00Z']).status, 0);

  const one = await entryBytes(new Uint8Array(readFileSync(first)), 'provenance.jsonl');
  const two = await entryBytes(new Uint8Array(readFileSync(second)), 'provenance.jsonl');
  const three = await entryBytes(new Uint8Array(readFileSync(third)), 'provenance.jsonl');
  assert.ok(three.length > two.length && two.length > one.length, 'each edit adds bytes and removes none');
  assert.deepEqual(three.subarray(0, two.length), two, 'the third log begins with the second log, byte for byte');
  assert.deepEqual(two.subarray(0, one.length), one, 'the second log begins with the first log, byte for byte');

  const lines = splitLines(three);
  assert.equal(lines.ok, true);
  assert.equal(lines.lines.length, 3);
  const entries = lines.lines.map((line, index) => {
    const read = parseLine(line, index + 1);
    assert.equal(read.ok, true);
    return read.value;
  });
  assert.deepEqual(entries.map((entry) => entry.action), ['create', 'edit', 'edit']);
  assert.equal(entries[0].parent, null, 'the chain still starts where it said it started');
  // A link is the digest of the line before it as it stands in the file, which is
  // the value the verifier's own chain check recomputes.
  assert.equal(entries[1].parent, toHex(await sha256(concat([lines.lines[0], LF]))));
  assert.equal(entries[2].parent, toHex(await sha256(concat([lines.lines[1], LF]))));
  assert.equal(entries[1].content_sha256, toHex(await sha256(utf8Encode(SECOND_MARKDOWN))), 'the second entry signs over the revision that was current then');
  assert.equal(entries[2].content_sha256, toHex(await sha256(utf8Encode(MARKDOWN))), 'and editing back is a third entry, not a rewrite of the second');
});

test('an edit is deterministic: the same artifact, document and arguments produce the same bytes', () => {
  const base = join(WORK, 'edit-determinism-base.charter');
  const one = join(WORK, 'edit-determinism-1.charter');
  const two = join(WORK, 'edit-determinism-2.charter');
  const other = join(WORK, 'edit-determinism-3.charter');
  assert.equal(sealTo(base).status, 0);

  const args = (out) => ['edit', base, SECOND_PATH, '--key', KEY_PATH, '-o', out, '--summary', 'Add a History section.', '--created-at', '2026-01-02T09:30:00Z'];
  for (const out of [one, two]) assert.equal(charter(args(out)).status, 0);
  assert.deepEqual(readFileSync(one), readFileSync(two), 'two edits of the same inputs must be the same bytes, byte for byte');

  assert.equal(charter(['edit', base, SECOND_PATH, '--key', KEY_PATH, '-o', other, '--created-at', '2026-01-02T09:30:01Z']).status, 0);
  assert.notDeepEqual(readFileSync(other), readFileSync(one), 'a different stated time is a different record');
});

test('the action an edit writes is one the reader defines, and a summary nobody stated says so', async () => {
  assert.ok(ACTIONS.includes(LATER_ACTION), `${LATER_ACTION} is not an action verifier/provenance.js defines`);
  const sealed = await seal({ content: utf8Encode(MARKDOWN), key: KEY_TEXT, author: 'Casey', created_at: AT });
  const edited = await edit({ artifact: sealed.bytes, content: utf8Encode(SECOND_MARKDOWN), key: KEY_TEXT, created_at: '2026-01-02T09:30:00Z' });

  const lines = splitLines(await entryBytes(edited.bytes, 'provenance.jsonl'));
  assert.equal(lines.ok, true);
  assert.equal(lines.lines.length, 2);
  const last = parseLine(lines.lines[1], 2);
  assert.equal(last.ok, true);
  assert.equal(last.value.action, LATER_ACTION);
  assert.equal(last.value.summary, NO_SUMMARY_STATED, 'an edit does not put a sentence in a signed record that nobody wrote');
  assert.equal(last.value.author.name, 'Casey', "with no stated name the entry carries the artifact's own name");
  assert.equal(last.value.timestamp, '2026-01-02T09:30:00Z');
  assert.equal(last.value.content_sha256, edited.claims.content_sha256);

  // And it is signed over the shared signing input, as a seal's entry is.
  const loaded = await loadKey(KEY_TEXT);
  assert.equal(last.value.signature, encodeBase64Url(signBytes(loaded, signingInput(last.value, 'signature'))));
});

test("an edit that states a time earlier than its parent's is written, and verifies", async () => {
  const base = join(WORK, 'earlier-base.charter');
  const out = join(WORK, 'earlier.charter');
  assert.equal(sealTo(base).status, 0);

  const run = charter(['edit', base, SECOND_PATH, '--key', KEY_PATH, '-o', out, '--created-at', '2025-12-31T23:59:59Z']);
  assert.equal(run.status, 0, `nothing in the format witnesses time, so an earlier instant is not a defect: ${run.stderr}`);

  const verified = charter(['verify', out, '--json']);
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).verdict, 'VERIFIED');

  const lines = splitLines(await entryBytes(new Uint8Array(readFileSync(out)), 'provenance.jsonl'));
  const last = parseLine(lines.lines[1], 2);
  assert.equal(last.value.timestamp, '2025-12-31T23:59:59Z', 'the entry states the time it was given');
  assert.equal(
    recorded('entry-with-earlier-timestamp').verdict,
    'VERIFIED',
    'and the kit requires the same shape to be VERIFIED, which is why the producer may not refuse it',
  );
});

test("an edit with a key that is not the artifact's key is refused, and writes nothing", () => {
  const base = join(WORK, 'other-key-base.charter');
  const out = join(WORK, 'other-key.charter');
  const stranger = join(WORK, 'stranger.pem');
  writeFileSync(stranger, generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
  assert.equal(sealTo(base).status, 0);

  const run = charter(['edit', base, SECOND_PATH, '--key', stranger, '-o', out]);
  assert.equal(run.status, 65, run.stderr);
  assert.equal(run.stderr.startsWith(`charter edit: ${REASON.MISMATCH}: `), true, run.stderr);
  assert.equal(existsSync(out), false, 'a refused edit writes no file');
  assert.equal(charter(['verify', base]).status, 0, 'the artifact it refused to extend is untouched');
});

test('an edit refuses an artifact it cannot read, and one with no line to commit to', async () => {
  const base = join(WORK, 'unreadable-base.charter');
  assert.equal(sealTo(base).status, 0);
  const sealed = new Uint8Array(readFileSync(base));

  const damaged = join(WORK, 'unreadable.charter');
  writeFileSync(damaged, flipBit(sealed, 0));
  const refused = charter(['edit', damaged, SECOND_PATH, '--key', KEY_PATH, '-o', join(WORK, 'unreadable-out.charter')]);
  assert.equal(refused.status, 65, refused.stderr);
  assert.match(refused.stderr, /^charter edit: [A-Z_]+: /, 'the refusal carries a reason code, not a check id');
  assert.equal(existsSync(join(WORK, 'unreadable-out.charter')), false);

  const absent = charter(['edit', join(WORK, 'not-here.charter'), SECOND_PATH, '--key', KEY_PATH, '-o', join(WORK, 'absent-out.charter')]);
  assert.equal(absent.status, 66, absent.stderr);
  assert.equal(absent.stderr.startsWith(`charter edit: ${REASON.MISSING}: `), true, absent.stderr);

  // A log with no entry records nothing, so there is no line for an edit to
  // commit to: the file is readable, and it is not a place a history can be
  // appended to.
  const emptyPath = join(WORK, 'empty-log.charter');
  writeFileSync(emptyPath, await rebuildWith(sealed, { 'provenance.jsonl': () => new Uint8Array(0) }));
  const empty = charter(['edit', emptyPath, SECOND_PATH, '--key', KEY_PATH, '-o', join(WORK, 'empty-log-out.charter')]);
  assert.equal(empty.status, 65, empty.stderr);
  assert.equal(empty.stderr.startsWith(`charter edit: ${REASON.MISSING}: `), true, empty.stderr);

  // And a file that carries no log at all is refused the same way. They are two
  // different files — one holds an empty log and one holds none, which section 7
  // gives two different checks — and one answer from the producer, because in
  // neither is there a line to commit to.
  const archive = parseArchive(sealed);
  assert.equal(archive.ok, true);
  const withoutLog = [];
  for (const record of archive.entries) {
    const read = await readEntryData(sealed, record);
    if (record.name !== 'provenance.jsonl') withoutLog.push({ name: record.name, data: read.data });
  }
  const absentLogPath = join(WORK, 'absent-log.charter');
  writeFileSync(absentLogPath, zipStore(withoutLog));
  const absentLog = charter(['edit', absentLogPath, SECOND_PATH, '--key', KEY_PATH, '-o', join(WORK, 'absent-log-out.charter')]);
  assert.equal(absentLog.status, 65, absentLog.stderr);
  assert.equal(absentLog.stderr.startsWith(`charter edit: ${REASON.MISSING}: `), true, absentLog.stderr);
});

test('an edit refuses a manifest field charter/0.1 gives no rule to, rather than dropping it', async () => {
  const base = join(WORK, 'unknown-field-base.charter');
  assert.equal(sealTo(base).status, 0);
  const sealed = new Uint8Array(readFileSync(base));
  const manifest = parseJsonBytes(await entryBytes(sealed, 'manifest.json'));
  assert.equal(manifest.ok, true);

  // A well-formed field this format does not define, written canonically beside
  // the ones it does. A writer that read the file and wrote it back would drop
  // it — and a dropped claim is not the same deed as one never made.
  const widened = canonicalDocument({ ...manifest.value, rights: 'all of them' });
  const artifactPath = join(WORK, 'unknown-field.charter');
  writeFileSync(artifactPath, await rebuildWith(sealed, { 'manifest.json': () => widened }));

  const run = charter(['edit', artifactPath, SECOND_PATH, '--key', KEY_PATH, '-o', join(WORK, 'unknown-field-out.charter')]);
  assert.equal(run.status, 65, run.stderr);
  assert.equal(run.stderr.startsWith(`charter edit: ${REASON.UNKNOWN_FIELD}: `), true, run.stderr);
  assert.ok(run.stderr.includes('rights'), `the refusal must name the field it would have dropped: ${run.stderr}`);
});

test('an edit refuses a format this build does not implement', async () => {
  const base = join(WORK, 'other-format-base.charter');
  assert.equal(sealTo(base).status, 0);
  const sealed = new Uint8Array(readFileSync(base));

  // The declared identifier is changed to another one of the same length, so the
  // container's sizes, offsets and CRC-32s still agree with its bytes and the
  // only thing wrong with the file is what it declares.
  const manifest = await entryBytes(sealed, 'manifest.json');
  const at = indexOfSequence(manifest, 'charter/0.1');
  assert.ok(at >= 0, 'the manifest must declare the format');
  const changed = Uint8Array.from(manifest);
  changed[at + 'charter/0.'.length] = 0x39; // 0.1 becomes 0.9
  const artifactPath = join(WORK, 'other-format.charter');
  writeFileSync(artifactPath, await rebuildWith(sealed, { 'manifest.json': () => changed }));

  const run = charter(['edit', artifactPath, SECOND_PATH, '--key', KEY_PATH, '-o', join(WORK, 'other-format-out.charter')]);
  assert.equal(run.status, 65, run.stderr);
  assert.equal(run.stderr.startsWith(`charter edit: ${REASON.UNSUPPORTED_FEATURE}: `), true, run.stderr);

  // The reader says the same thing about the same file, which is the point of
  // refusing it here: the format gate reports UNSUPPORTED with the code section
  // 14 fixes for an identifier this build does not implement, and a verdict with
  // an unestablished format is INCOMPLETE rather than a pass.
  const verified = charter(['verify', artifactPath, '--json']);
  assert.equal(verified.status, 1, verified.stderr);
  const verdict = JSON.parse(verified.stdout);
  assert.equal(verdict.verdict, 'INCOMPLETE');
  const gate = verdict.checks.find((check) => check.id === 'L0.FORMAT.IDENTIFIER');
  assert.deepEqual(
    { status: gate.status, reason_code: gate.reason_code },
    { status: 'UNSUPPORTED', reason_code: REASON.UNSUPPORTED_VERSION },
  );
});

test("an artifact carrying a fourth entry, or two of one name, is refused with the entry set's own codes", async () => {
  const base = join(WORK, 'entry-set-base.charter');
  assert.equal(sealTo(base).status, 0);
  const sealed = new Uint8Array(readFileSync(base));

  const archive = parseArchive(sealed);
  assert.equal(archive.ok, true);
  const entries = [];
  for (const record of archive.entries) {
    const read = await readEntryData(sealed, record);
    entries.push({ name: record.name, data: read.data });
  }

  // A fourth entry is content the file carries and a charter/0.1 writer has no
  // room for, so an edit could only drop it — which is the same deed as dropping
  // a manifest field, and it is refused the same way.
  const extraPath = join(WORK, 'entry-set-extra.charter');
  writeFileSync(extraPath, zipStore([...entries, { name: 'notes.txt', data: utf8Encode('notes\n') }]));
  const extra = charter(['edit', extraPath, SECOND_PATH, '--key', KEY_PATH, '-o', join(WORK, 'entry-set-extra-out.charter')]);
  assert.equal(extra.status, 65, extra.stderr);
  assert.equal(extra.stderr.startsWith(`charter edit: ${REASON.EXTRA}: `), true, extra.stderr);
  assert.ok(extra.stderr.includes('notes.txt'), extra.stderr);

  const content = entries.find((entry) => entry.name === 'content.md');
  assert.ok(content !== undefined);
  const duplicatePath = join(WORK, 'entry-set-duplicate.charter');
  writeFileSync(duplicatePath, zipStore([...entries, { name: 'content.md', data: content.data }]));
  const duplicate = charter(['edit', duplicatePath, SECOND_PATH, '--key', KEY_PATH, '-o', join(WORK, 'entry-set-duplicate-out.charter')]);
  assert.equal(duplicate.status, 65, duplicate.stderr);
  assert.equal(duplicate.stderr.startsWith(`charter edit: ${REASON.DUPLICATE}: `), true, duplicate.stderr);
});

test('an edit copies the entries and writes the container: a container defect is not carried forward, and a history defect is not repaired', async () => {
  const base = join(WORK, 'not-a-repair-base.charter');
  const containerDefect = join(WORK, 'not-a-repair-container.charter');
  const output = join(WORK, 'not-a-repair-edited.charter');
  assert.equal(sealTo(base).status, 0);
  const sealed = new Uint8Array(readFileSync(base));

  // The first local header declares a feature level one above what section 3.2
  // fixes, in one copy only. A reader refuses that file; the producer reads it —
  // the entries are all there — and writes a container of its own, because the
  // container's fixed fields are the writer's, and the entry bytes are not.
  const damaged = flipBit(sealed, 4);
  writeFileSync(containerDefect, damaged);
  const before = await verify(damaged);
  assert.equal(before.verdict, 'BROKEN');
  assert.equal(failing(before.checks)['L0.ZIP.METADATA'], 'MISMATCH');

  const run = charter(['edit', containerDefect, SECOND_PATH, '--key', KEY_PATH, '-o', output, '--created-at', '2026-01-02T09:30:00Z']);
  assert.equal(run.status, 0, run.stderr);
  const after = await verify(new Uint8Array(readFileSync(output)));
  assert.equal(after.verdict, 'VERIFIED', 'the container this producer writes is the container section 3 fixes');

  // And the history is the same history: the log the file carried is the log the
  // new file carries, byte for byte, with one new line after it.
  const carried = await entryBytes(sealed, 'provenance.jsonl');
  const written = await entryBytes(new Uint8Array(readFileSync(output)), 'provenance.jsonl');
  assert.deepEqual(written.subarray(0, carried.length), carried);

  // The other half, and the half that matters: a defect in the *history* is not
  // repaired either. One character of the first entry's signature, then an edit,
  // and the file is still broken in the same way — because an edit is not a
  // verdict, and the line it was handed is the line it copies.
  const stalePath = join(WORK, 'not-a-repair-stale.charter');
  writeFileSync(stalePath, await rebuildWith(sealed, { 'provenance.jsonl': changeSignatureCharacter }));
  const staleOutput = join(WORK, 'not-a-repair-stale-edited.charter');
  const editedStale = charter(['edit', stalePath, SECOND_PATH, '--key', KEY_PATH, '-o', staleOutput, '--created-at', '2026-01-02T09:30:00Z']);
  assert.equal(editedStale.status, 0, `the file was readable, so the line was written: ${editedStale.stderr}`);
  const staleAfter = await verify(new Uint8Array(readFileSync(staleOutput)));
  assert.equal(staleAfter.verdict, 'BROKEN');
  assert.equal(
    failing(staleAfter.checks)['L1.PROVENANCE.SIGNATURES'],
    'MISMATCH',
    'the stale signature is still stale: the producer copied the line rather than repairing it',
  );
});

test('an edited file keeps what the first entry declared, and a stated title replaces the title', async () => {
  const base = join(WORK, 'keeps-base.charter');
  const kept = join(WORK, 'keeps-edited.charter');
  const retitled = join(WORK, 'keeps-retitled.charter');
  assert.equal(sealTo(base).status, 0);
  assert.equal(charter(['edit', base, SECOND_PATH, '--key', KEY_PATH, '-o', kept, '--created-at', '2026-01-02T09:30:00Z']).status, 0);
  assert.equal(charter(['edit', base, SECOND_PATH, '--key', KEY_PATH, '-o', retitled, '--title', 'A stated title']).status, 0);

  const before = await readCharter(new Uint8Array(readFileSync(base)));
  const after = await readCharter(new Uint8Array(readFileSync(kept)));
  assert.equal(before.ok, true);
  assert.equal(after.ok, true);
  assert.equal(after.claims.title, before.claims.title, 'an edit does not rename the document behind the author');
  assert.equal(after.claims.author_name, before.claims.author_name);
  assert.equal(after.claims.author_key_id, before.claims.author_key_id);
  assert.equal(after.claims.created_at, before.claims.created_at, "the creation time is the first revision's, and stays");
  assert.equal(after.claims.entries, 2);
  assert.notEqual(after.claims.content_sha256, before.claims.content_sha256, 'the head describes the revision this edit wrote');

  const stated = await readCharter(new Uint8Array(readFileSync(retitled)));
  assert.equal(stated.ok, true);
  assert.equal(stated.claims.title, 'A stated title', 'a stated title is the one claim this edit replaces');
  assert.equal(charter(['verify', retitled]).status, 0);
});

test('a change to an earlier line breaks the link the next entry declared', async () => {
  const base = join(WORK, 'link-base.charter');
  const out = join(WORK, 'link.charter');
  assert.equal(sealTo(base).status, 0);
  assert.equal(charter(['edit', base, SECOND_PATH, '--key', KEY_PATH, '-o', out, '--created-at', '2026-01-02T09:30:00Z']).status, 0);
  const bytes = new Uint8Array(readFileSync(out));

  // One character of the *first* entry's summary, inside the string, so the line
  // still parses and the only thing that changed is the bytes the second entry
  // committed to. That is the attack the chain exists to notice, and it is only
  // visible in a file with more than one entry.
  const raw = await entryBytes(bytes, 'provenance.jsonl');
  const inside = indexOfSequence(raw, 'Initial draft.');
  assert.ok(inside >= 0, 'a seal writes that summary by default');
  const record = entryRecord(bytes, 'provenance.jsonl');
  const result = await verify(flipBit(bytes, record.dataOffset + inside));
  assert.equal(result.verdict, 'BROKEN');
  const seen = failing(result.checks);
  assert.equal(seen['L2.CHAIN.LINKS'], 'MISMATCH', 'a link covers the line as it stands, so changing line 1 breaks it');
  assert.equal(seen['L1.PROVENANCE.SIGNATURES'], 'MISMATCH', 'and the signature over that line no longer covers it');
});

test('no single-byte change to an edited file is verified, and every truncation is refused', async () => {
  const base = join(WORK, 'edited-sweep-base.charter');
  const out = join(WORK, 'edited-sweep.charter');
  assert.equal(sealTo(base).status, 0);
  assert.equal(charter(['edit', base, SECOND_PATH, '--key', KEY_PATH, '-o', out, '--created-at', '2026-01-02T09:30:00Z']).status, 0);
  const bytes = new Uint8Array(readFileSync(out));

  let accepted = 0;
  for (let at = 0; at < bytes.length; at += 1) {
    const result = await verify(flipBit(bytes, at));
    if (result.verdict === 'VERIFIED') accepted += 1;
  }
  assert.equal(accepted, 0, `${accepted} of ${bytes.length} single-byte change(s) were accepted`);

  const from = Math.max(0, bytes.length - 512);
  for (let at = from; at < bytes.length; at += 1) {
    const result = await verify(bytes.subarray(0, at));
    assert.notEqual(result.verdict, 'VERIFIED', `a file cut at ${at} of ${bytes.length} bytes was accepted`);
  }
});
