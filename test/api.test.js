/**
 * The surface a program that is not this one uses.
 *
 * Two entry points exist now — the root `index.js` for reading and
 * `producer/index.js` for writing — and until this file existed nothing held either one
 * still. A function could be renamed, a vocabulary dropped, and every other test here
 * would pass: they all call the modules directly, the way the command line does, and none
 * of them is an outside caller.
 *
 * So the surface is written down twice on purpose, once here and once in `README.md`,
 * and this file compares them. A name that disappears from the module fails the run,
 * which is what a stability promise has to cost. The same shape as the README's test
 * count, and for the same reason: a list in prose that nothing reads back is a claim
 * that decays.
 *
 * @module test/api
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as charter from '../index.js';
import * as producer from '../producer/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PACKAGE = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/**
 * The names `README.md` documents for one entry point.
 *
 * Read out of the README rather than listed here, because the README is what an
 * integrator actually reads and a second copy in a test would agree with the first only
 * until someone edited one of them. This is the arrangement `test/spec.test.js` has with
 * `SPEC.md`: the document states the surface, the code is held to the statement, and a
 * name that moved has to be moved in both places or the run fails.
 *
 * @param {string} entry the package's own name for the entry point
 * @returns {string[]} the documented names, sorted
 */
function documentedSurface(entry) {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const row = new RegExp(`^\\| \`${entry.replace(/[/\\]/g, '\\$&')}\` \\|([^\\n]*)\\|$`, 'm').exec(readme);
  assert.notEqual(
    row,
    null,
    `README.md has a row naming \`${entry}\` and the names it exports; this test reads that row, so it has to be told where the row went`,
  );
  const names = [.../** @type {RegExpExecArray} */ (row)[1].matchAll(/`([A-Za-z_][A-Za-z0-9_]*)`/g)].map((match) => match[1]);
  assert.ok(
    names.length >= 5,
    `the row for \`${entry}\` names ${names.length} exports, which is too few to be the documented surface: an empty or missing list would make this test pass without asking anything`,
  );
  return names.sort();
}

/**
 * The two entry points, as modules, held to what `README.md` documents.
 *
 * There is no list of names in this file on purpose. The list lives in the README, where
 * an integrator reads it, and `documentedSurface()` takes it from there: a test with its
 * own copy would agree with the README only until somebody edited one of the two.
 */

test('the reading surface is the one the documentation names, and nothing else', () => {
  assert.deepEqual(
    Object.keys(charter).sort(),
    documentedSurface('charter-cli'),
    'the names `charter-cli` exports are the names README.md documents: a name removed from the module breaks a caller, and a name added without documentation is one nobody was told about',
  );
});

test('the writing surface is the one the documentation names, and nothing else', () => {
  assert.deepEqual(
    Object.keys(producer).sort(),
    documentedSurface('charter-cli/producer'),
    'the names `charter-cli/producer` exports are the names README.md documents',
  );
});

test('the reading surface reads, and the writing surface writes', () => {
  assert.equal(typeof charter.verify, 'function', 'the one thing a reader does is verify');
  for (const name of ['STATUS', 'VERDICT', 'EXIT_CODE', 'LEVEL', 'REASON', 'LIMITS']) {
    assert.equal(Object.isFrozen(charter[name]), true, `${name} is a vocabulary a caller branches on, so it is frozen`);
  }
  assert.equal(Array.isArray(charter.CAVEATS), true, 'the caveats are a list, in the order a verdict prints them');
  assert.equal(charter.FORMAT, 'charter/0.1', 'the identifier a caller records is the one this build implements');

  for (const name of ['seal', 'edit', 'loadKey', 'generateKeyPair', 'openKeyFile', 'sealKeyFile', 'readCharter', 'citationItem']) {
    assert.equal(typeof producer[name], 'function', `producer exports ${name} as a function`);
  }
  assert.equal(
    producer.isKeyFile('-----BEGIN CHARTER ENCRYPTED KEY-----\nAA==\n-----END CHARTER ENCRYPTED KEY-----\n'),
    true,
    'and `isKeyFile` answers without a passphrase',
  );
});

test('verify resolves with a verdict for bytes it cannot read, rather than throwing', async () => {
  // The property an integrator has to know before writing a loop over a directory: a file
  // too broken to parse is a *verdict*, not an exception. Nothing this verifier is handed
  // makes it throw, so a caller branches on `result.verdict` and does not have to wrap
  // every call in a try — which is why the documentation fixes the shape of the return
  // value rather than the shape of an error.
  const result = await charter.verify(new Uint8Array([0x01, 0x02, 0x03, 0x04]));
  assert.equal(result.verdict, charter.VERDICT.BROKEN, 'four bytes that are not a container are BROKEN, and not an exception');
  assert.equal(
    result.checks.find((check) => check.id === 'L0.ZIP.READABLE').status,
    'FAIL',
    'and the check that failed says so, with its reason code',
  );
  assert.equal(result.summary.total, charter.CHECK_IDS.length, 'every check is accounted for even when none of them ran');
  assert.equal(result.limitations.length, charter.CAVEATS.length, 'and the caveats still travel with it');
});

/**
 * Every file a module imports, walking the graph the way the editor's test walks it.
 *
 * Comments are stripped before the specifiers are read, and that is not tidiness: the
 * first version of this function walked `producer/**` and tried to open a file called
 * "a writer refused", because `producer/errors.js` explains the difference between a
 * refusal from the producer and one from a writer *in prose*, using the word `from`
 * before a quoted phrase. A rule that matched prose would push the next author to stop
 * explaining things, which is the failure the editor's own static checks call out.
 *
 * @param {string} entry an absolute path
 * @returns {Set<string>} every module reached, entry included
 */
function closureOf(entry) {
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {string[]} */
  const queue = [entry];
  while (queue.length > 0) {
    const file = /** @type {string} */ (queue.pop());
    if (seen.has(file)) continue;
    seen.add(file);
    const code = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^[ \t]*\/\/.*$/gm, ' ');
    for (const match of code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      if (specifier.startsWith('node:')) {
        seen.add(specifier);
        continue;
      }
      queue.push(resolve(dirname(file), specifier));
    }
  }
  return seen;
}

test('the reading entry point is pure and the writing one is not, which is why there are two', () => {
  // A page, a worker and a Deno program import the reading surface and need nothing else:
  // `verifier/**` may not read a file, use a clock or import a runtime module, and
  // `test/purity.test.js` holds that from the inside. This asks it from the outside, which
  // is the question an integrator asks, and it asks about the *closure* rather than the
  // file, because the promise is about everything an import reaches.
  const reading = closureOf(join(ROOT, 'index.js'));
  assert.deepEqual(
    [...reading].filter((name) => name.startsWith('node:')),
    [],
    'the reading surface reaches no runtime module, so it runs in a browser unchanged',
  );
  assert.ok(reading.size >= 10, `the walk found ${reading.size} modules, which is too few to have walked the graph`);

  // And the writing surface does need one. Not a failure, but the boundary: a producer
  // signs with a private key and draws random bytes, and Node is where those come from.
  const writing = closureOf(join(ROOT, 'producer', 'index.js'));
  assert.equal(
    [...writing].some((name) => name === 'node:crypto'),
    true,
    'the writing surface reaches node:crypto, which is the whole reason it is a separate entry point',
  );
});

test('the package map exposes what is documented, and keeps the rest out', () => {
  // `exports` is the difference between a package and a directory of files. With it, what
  // an integrator may import is a decision this project made; without one, everything on
  // disk was importable and nothing was promised. The cost is that an unlisted path stops
  // working, which is why the map names what is reachable.
  assert.equal(PACKAGE.exports['.'], './index.js', 'the bare import is the reading surface');
  assert.equal(PACKAGE.exports['./producer'], './producer/index.js', 'the writing surface has its own entry');
  assert.equal(PACKAGE.exports['./verifier/*'], './verifier/*', 'the modules that walk a container stay reachable');
  assert.equal(
    Object.keys(PACKAGE.exports).some((key) => key.startsWith('./cli')),
    false,
    'the command line is a program and not an import, so it is not exported',
  );

  // Every target resolves to a file, and every entry file is in what a publish ships: an
  // `exports` map pointing at a file `files` leaves out is a package that installs and
  // then cannot be imported at all.
  for (const target of [PACKAGE.exports['.'], PACKAGE.exports['./producer'], PACKAGE.exports['./SPEC.md']]) {
    assert.equal(readFileSync(join(ROOT, target), 'utf8').length > 0, true, `${target} exists and is not empty`);
  }
  for (const shipped of [PACKAGE.exports['.'], PACKAGE.exports['./producer']]) {
    // `exports` names a target with `./` and `files` names a path without it, and a
    // *directory* in `files` covers everything under it. Both spellings are correct and
    // neither is the thing under test: what is being asked is whether a publish would
    // carry the file the map points at.
    const named = /** @type {string} */ (shipped).replace(/^\.\//, '');
    const covered = PACKAGE.files.includes(named) || PACKAGE.files.includes(`${named.split('/')[0]}/`);
    assert.ok(
      covered,
      `${named} is shipped by package.json \`files\`, or a publish would carry an entry point that is not there`,
    );
  }
  assert.ok(PACKAGE.files.includes('SPEC.md'), 'and the specification travels with the implementation, because it is half of what this is');
});