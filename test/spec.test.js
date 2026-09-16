/**
 * The specification's own vocabulary, checked against the module that declares it.
 *
 * `SPEC.md` section 10 names the reason codes and the 30 check ids, and
 * `verifier/status.js` declares the same two sets; the reporter refuses an id or
 * a code that is outside them, which is what keeps a verdict's shape fixed. That
 * makes the vocabulary the one part of the document that is also code — and the
 * part that can drift without anybody noticing. A check added to the registry and
 * never added to section 10, or a code deleted from the module and left in the
 * prose, is a specification that describes a program nobody has; the check id
 * `L0.MANIFEST.FORMAT` was exactly that for a while, because section 5's table
 * was written before section 10's registry and never updated.
 *
 * This reads SPEC.md as text, which no other test does, and compares the two
 * lists in both directions. It is deliberately strict about the *form* section 10
 * states the codes in: the sentence that declares the vocabulary is the
 * declaration, and a rewrite that loses it fails here rather than passing
 * quietly. If that sentence is ever reworded, point this test at the new wording
 * — the point of it is that the spec cannot change what it declares by accident.
 *
 * @module test/spec
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHECK_IDS, REASON } from '../verifier/status.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SPEC = readFileSync(join(ROOT, 'SPEC.md'), 'utf8');

/**
 * A level-2 section of SPEC.md, by the text of its heading.
 *
 * @param {string} heading e.g. `"10. Verdicts"`
 * @returns {string} the section's text, without the heading that follows it
 */
function section(heading) {
  const start = SPEC.indexOf(`\n## ${heading}\n`);
  assert.notEqual(start, -1, `SPEC.md has a section headed "${heading}"`);
  const rest = SPEC.slice(start + 1);
  const end = rest.indexOf('\n## ', 1);
  return end === -1 ? rest : rest.slice(0, end);
}

const VERDICTS = section('10. Verdicts');

/**
 * The reason codes section 10 declares, read from the sentence that declares them.
 *
 * @returns {string[]}
 */
function declaredReasonCodes() {
  const marker = 'A reason code is attached to every result:';
  const at = VERDICTS.indexOf(marker);
  assert.notEqual(
    at,
    -1,
    `SPEC.md section 10 no longer states its vocabulary as "${marker} <code>, <code>, ..." — this test reads that sentence, so it has to be told where the list went`,
  );
  return VERDICTS.slice(at + marker.length)
    .split('.')[0]
    .split(',')
    .map((code) => code.trim())
    .filter((code) => code.length > 0);
}

/** The check ids section 10 names, including its own subsection. */
const IDS_NAMED = Object.freeze([...new Set(VERDICTS.match(/L[0-2]\.[A-Z]+\.[A-Z0-9_]+/g) ?? [])]);

test('every reason code named in section 10 is in the shared vocabulary', () => {
  const declared = Object.values(REASON);
  for (const code of declaredReasonCodes()) {
    assert.ok(declared.includes(code), `${code} is named in section 10 and verifier/status.js does not declare it`);
  }
});

test('every reason code in the shared vocabulary is named in section 10', () => {
  const declared = declaredReasonCodes();
  for (const code of Object.values(REASON)) {
    assert.ok(declared.includes(code), `${code} is in the vocabulary and section 10 never names it, so nothing in this document says what it means`);
  }
});

test('the two lists are the same length, so neither direction can hide a code', () => {
  assert.equal(declaredReasonCodes().length, Object.values(REASON).length);
});

test('every reason code in the vocabulary can be reported by a check', () => {
  const sources = readdirSync(join(ROOT, 'verifier'))
    .filter((name) => name.endsWith('.js'))
    .map((name) => readFileSync(join(ROOT, 'verifier', name), 'utf8'))
    .join('\n');
  for (const [name, code] of Object.entries(REASON)) {
    assert.ok(
      sources.includes(`REASON.${name}`) || sources.includes(`'${code}'`),
      `${code} is declared and nothing under verifier/** can ever report it — "a rule that no check enforces is not a rule"`,
    );
  }
});

test('section 10 names every check id in the registry, and invents none', () => {
  assert.deepEqual([...IDS_NAMED].sort(), [...CHECK_IDS].sort());
  for (const id of IDS_NAMED) {
    assert.equal(CHECK_IDS.includes(id), true, `${id} is named in section 10 and is not a check in the registry`);
  }
  for (const id of CHECK_IDS) {
    assert.equal(IDS_NAMED.includes(id), true, `${id} is in the registry and section 10 never names it`);
  }
});
