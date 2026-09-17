/**
 * The field kinds, and the one thing a kind does not do: measure a string.
 *
 * `verifier/schema.js` declares the kinds, `verifier/manifest.js` and
 * `verifier/provenance.js` say which kind each field has, and SPEC.md section
 * 10's head states the rule that keeps the two readers out of the checks that
 * read the values: a check reports a defect only when the requirement in its own
 * row does not hold, FIELDS answers whether a field is present and holds the JSON
 * kind the tables name, and the spelling of a string inside it belongs to the
 * check that uses the value.
 *
 * That rule is prose in three sections of SPEC.md, which is exactly the kind of
 * rule that drifts. Three times in this format's history a reader measured a
 * string a check had not read yet — an uppercase digest, an absent digest, and
 * (the last time) an empty `content_sha256`, an empty signature and an uppercase
 * `parent` — and each time two implementations that were both "right" disagreed
 * about the answer. So this test reads the two readers as text and holds them to
 * the rule: every kind they use is declared, no field whose string another check
 * reads carries a spelling kind or `non_empty`, and the fields that *do* carry
 * `non_empty` are exactly the fields no other check reads.
 *
 * The other half is behaviour, through the two readers' own entry points: an
 * arbitrary string in an owned field is accepted, and an empty string in an
 * unowned field is not.
 *
 * @module test/schema
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readManifest } from '../verifier/manifest.js';
import { readEntry } from '../verifier/provenance.js';
import { readField } from '../verifier/schema.js';
import { REASON } from '../verifier/status.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/**
 * A file under `verifier/`, as text.
 *
 * @param {string} name
 * @returns {string}
 */
function source(name) {
  return readFileSync(join(ROOT, 'verifier', name), 'utf8');
}

const SCHEMA = source('schema.js');
const READERS = ['manifest.js', 'provenance.js'];

/**
 * The kinds the schema declares, read from the sentence that declares them.
 *
 * @returns {string[]}
 */
function declaredKinds() {
  const marker = ' * @property {string} kind one of: ';
  const at = SCHEMA.indexOf(marker);
  assert.notEqual(
    at,
    -1,
    `verifier/schema.js no longer states its kinds as "${marker.trim()}" — this test reads that sentence, so it has to be told where the list went`,
  );
  return SCHEMA.slice(at + marker.length)
    .split('\n')[0]
    .split(',')
    .map((kind) => kind.trim());
}

/** Every declared kind, with a value it accepts and one it refuses. */
const SAMPLES = Object.freeze({
  null: { right: [null], wrong: 'x', code: REASON.MALFORMED },
  boolean: { right: [true], wrong: 'x', code: REASON.MALFORMED },
  array: { right: [[]], wrong: 'x', code: REASON.MALFORMED },
  object: { right: [{}], wrong: 'x', code: REASON.MALFORMED },
  integer: { right: [1, 0, -1], wrong: 1.5, code: REASON.MALFORMED },
  string: { right: ['', 'x', 'a string of any spelling'], wrong: 1, code: REASON.MALFORMED },
  string_or_null: { right: [null, '', 'x'], wrong: 1, code: REASON.MALFORMED },
  enum: { right: ['ed25519'], wrong: 'rsa', code: REASON.UNKNOWN_FIELD, values: ['ed25519'] },
  hex: { right: ['0'.repeat(64)], wrong: '0'.repeat(63), code: REASON.NON_CANONICAL_ENCODING, hex_length: 32 },
  base64url: { right: ['A'.repeat(43)], wrong: 'A'.repeat(42), code: REASON.NON_CANONICAL_ENCODING, byte_length: 32 },
  timestamp: { right: ['2026-01-01T00:00:00Z'], wrong: '2026-01-01', code: REASON.MALFORMED },
});

const REASONS = new Set(Object.values(REASON));

test('every kind the schema declares is implemented, and each refuses the wrong kind', () => {
  for (const kind of declaredKinds()) {
    const sample = SAMPLES[kind];
    assert.notEqual(sample, undefined, `${kind} is declared and this test has no value to ask it about`);
    const spec = { kind, ...sample };
    for (const value of sample.right) {
      const read = readField({ field: value }, 'field', spec, 'a document');
      assert.equal(read.ok, true, `${kind} refused ${JSON.stringify(value)}: ${read.detail ?? ''}`);
    }
    const refused = readField({ field: sample.wrong }, 'field', spec, 'a document');
    assert.equal(refused.ok, false, `${kind} accepted ${JSON.stringify(sample.wrong)}`);
    assert.equal(refused.reason_code, sample.code, `${kind} refused the wrong kind with the wrong code`);
    assert.ok(REASONS.has(refused.reason_code), `${refused.reason_code} is not in the declared vocabulary`);
  }
});

test('this test covers every declared kind and invents none', () => {
  assert.deepEqual(declaredKinds().sort(), Object.keys(SAMPLES).sort());
});

test('an absent field is MISSING whatever its kind, and an unknown kind is a bug', () => {
  const absent = readField({}, 'field', { kind: 'string' }, 'a document');
  assert.equal(absent.ok, false);
  assert.equal(absent.reason_code, REASON.MISSING);
  assert.throws(() => readField({ field: 'x' }, 'field', { kind: 'no such kind' }, 'a document'), TypeError);
});


/**
 * The fields whose string another check reads, and the check that reads it.
 *
 * SPEC.md sections 5 and 7 name these one by one, and section 10's head is the
 * rule: FIELDS answers presence and JSON kind, and the spelling belongs to the
 * check that uses the value.
 */
const OWNED = Object.freeze({
  format: 'L0.FORMAT.IDENTIFIER',
  sha256: 'L0.CONTENT.HASH',
  public_key: 'L1.MANIFEST.KEY_ID',
  signature: 'L1.MANIFEST.SIGNATURE and L1.PROVENANCE.SIGNATURES',
  parent: 'L2.CHAIN.LINKS',
  content_sha256: 'L0.PROVENANCE.CONTENT_HASH_FORMAT',
});

/**
 * The fields no other check reads, so their shape is the whole requirement.
 *
 * `title` and `author.name` are "a non-empty string" in section 5's table, and
 * `summary`, an entry's `author.name` and an entry's `author.key_id` in section
 * 7's, and nobody else asks about them — which is why `non_empty` is on those
 * fields and on no others.
 */
const UNOWNED = Object.freeze(['title', 'name', 'key_id', 'summary']);

/**
 * Every `readField` call in a reader, as the key it reads and the spec it passes.
 *
 * @param {string} name
 * @returns {{ key: string, spec: string }[]}
 */
function fieldSpecs(name) {
  const pattern = /^\s*const \w+ = readField\([^']*'([a-z_0-9]+)',\s*\{([^}]*)\}/gm;
  const found = [];
  for (const match of source(name).matchAll(pattern)) {
    found.push({ key: match[1], spec: match[2] });
  }
  return found;
}

const SPECS = READERS.flatMap((name) => fieldSpecs(name).map((one) => ({ ...one, file: name })));

test('the readers still read the fields their tables name', () => {
  assert.equal(SPECS.length, 20, `expected the manifest's eleven fields and the log's nine, found ${SPECS.length}`);
  for (const key of Object.keys(OWNED).concat(UNOWNED)) {
    assert.ok(SPECS.some((one) => one.key === key), `${key} is not read by either reader any more`);
  }
});

test('the readers use only kinds the schema declares', () => {
  const declared = declaredKinds();
  for (const { key, spec, file } of SPECS) {
    const kind = /kind:\s*'([a-z_]+)'/.exec(spec);
    assert.notEqual(kind, null, `${file} reads ${key} with no kind`);
    assert.ok(declared.includes(kind[1]), `${file} reads ${key} as a ${kind[1]}, and the schema does not declare that kind`);
  }
});

test('a field whose string another check reads carries no spelling kind', () => {
  for (const { key, spec, file } of SPECS) {
    const owner = OWNED[key];
    if (owner === undefined) continue;
    for (const measured of ['non_empty', 'hex', 'hex_or_null', 'base64url']) {
      assert.ok(
        !spec.includes(measured),
        `${file} measures ${key} with ${measured}, and ${owner} is the check that reads it — a string measured in two places is a defect two implementations can disagree about (SPEC.md section 10)`,
      );
    }
  }
});

test('only a field no other check reads may be non-empty', () => {
  const measured = SPECS.filter((one) => one.spec.includes('non_empty')).map((one) => one.key);
  assert.deepEqual([...new Set(measured)].sort(), [...UNOWNED].sort());
});

/** A manifest whose fields are all present, with the owned ones empty. */
const MANIFEST = Object.freeze({
  format: 'charter/0.1',
  title: 'A title',
  created_at: '2026-01-01T00:00:00Z',
  content: { sha256: '' },
  author: { name: 'Casey', algorithm: 'ed25519', key_id: `ed25519:${'0'.repeat(64)}`, public_key: '' },
  signature: '',
});

/** An entry whose fields are all present, with the owned ones empty. */
const ENTRY = Object.freeze({
  timestamp: '2026-01-01T00:00:00Z',
  action: 'create',
  summary: 'Initial draft.',
  author: { name: 'Casey', key_id: `ed25519:${'0'.repeat(64)}` },
  parent: '',
  content_sha256: '',
  signature: '',
});

/**
 * A value with one field replaced, at a path of one or two steps.
 *
 * @param {object} value
 * @param {string[]} path
 * @param {unknown} replacement
 * @returns {object}
 */
function replaced(value, path, replacement) {
  const copy = structuredClone(value);
  let holder = copy;
  for (const key of path.slice(0, -1)) holder = holder[key];
  holder[path[path.length - 1]] = replacement;
  return copy;
}

test('both readers accept an empty string in every field whose value another check reads', () => {
  const manifest = readManifest(MANIFEST);
  assert.equal(manifest.ok, true, `an empty digest, key and signature are strings: ${manifest.detail ?? ''}`);
  const entry = readEntry(ENTRY, 1);
  assert.equal(entry.ok, true, `an empty digest, signature and parent are strings: ${entry.detail ?? ''}`);
});

test('both readers refuse an empty string in the fields they own', () => {
  for (const path of [['title'], ['author', 'name'], ['author', 'key_id']]) {
    const read = readManifest(replaced(MANIFEST, path, ''));
    assert.equal(read.ok, false, `the manifest accepted an empty ${path.join('.')}`);
    assert.equal(read.reason_code, REASON.MALFORMED, `an empty ${path.join('.')} is not a misspelling`);
  }
  for (const path of [['summary'], ['author', 'name'], ['author', 'key_id']]) {
    const read = readEntry(replaced(ENTRY, path, ''), 1);
    assert.equal(read.ok, false, `the log accepted an empty ${path.join('.')}`);
    assert.equal(read.reason_code, REASON.MALFORMED, `an empty ${path.join('.')} is not a misspelling`);
  }
});

test('an arbitrary string in an owned field is the reading check\'s business, not the reader\'s', () => {
  for (const path of [['content', 'sha256'], ['signature'], ['author', 'public_key']]) {
    assert.equal(readManifest(replaced(MANIFEST, path, 'not the one spelling')).ok, true, path.join('.'));
  }
  for (const path of [['parent'], ['content_sha256'], ['signature']]) {
    assert.equal(readEntry(replaced(ENTRY, path, 'not the one spelling'), 1).ok, true, path.join('.'));
  }
});

test('a wrong JSON kind is still MALFORMED wherever it sits', () => {
  for (const path of [['content', 'sha256'], ['signature'], ['author', 'public_key']]) {
    const read = readManifest(replaced(MANIFEST, path, 1));
    assert.equal(read.ok, false, path.join('.'));
    assert.equal(read.reason_code, REASON.MALFORMED, path.join('.'));
  }
  for (const path of [['parent'], ['content_sha256'], ['signature'], ['author', 'key_id']]) {
    const read = readEntry(replaced(ENTRY, path, 1), 1);
    assert.equal(read.ok, false, path.join('.'));
    assert.equal(read.reason_code, REASON.MALFORMED, path.join('.'));
  }
  const parent = readEntry(replaced(ENTRY, ['parent'], 1), 1);
  assert.equal(parent.path, 'provenance line 1.parent', `a refusal says where it was: ${parent.path}`);
});

