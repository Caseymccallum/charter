/**
 * The verifier is pure: bytes in, verdict out.
 *
 * This is not a style preference. A verifier that reads the clock, the file
 * system, the network, or a random source can give two answers about the same
 * bytes on two machines, which is the one thing a conformance verdict may never
 * do. The rule is enforced here because it is cheap to break by accident and
 * expensive to notice later.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const VERIFIER = join(ROOT, 'verifier');

/** @type {string[]} */
const MODULES = readdirSync(VERIFIER).filter((name) => name.endsWith('.js')).sort();

/** @type {[string, RegExp][]} */
const FORBIDDEN = [
  ['an import from a runtime module', /\bfrom\s+['"]node:/],
  ['a require call', /\brequire\s*\(/],
  ['a dynamic import', /\bimport\s*\(/],
  ['the process object', /\bprocess\./],
  ['the clock', /\bDate\.now\b|\bnew\s+Date\s*\(/],
  ['a random source', /\bMath\.random\b/],
  ['the network', /\bfetch\s*\(|XMLHttpRequest|WebSocket/],
  ['a timer', /\bsetTimeout\s*\(|\bsetInterval\s*\(|\bsetImmediate\s*\(|queueMicrotask/],
  ['the file system', /\bnode:fs\b|readFileSync|writeFileSync|createReadStream/],
];

test('the verifier directory holds the modules it says it holds', () => {
  assert.ok(MODULES.length >= 10, `expected the verifier modules, found ${MODULES.join(', ')}`);
  for (const module of MODULES) {
    const text = readFileSync(join(VERIFIER, module), 'utf8');
    assert.ok(text.includes('@module verifier/'), `${module} must declare itself with a @module tag`);
  }
});

test('no verifier module reaches outside the verifier', () => {
  for (const module of MODULES) {
    const text = readFileSync(join(VERIFIER, module), 'utf8');
    const specifiers = [...text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    for (const specifier of specifiers) {
      assert.ok(specifier.startsWith('./'), `${module} imports ${specifier}: only relative imports are allowed`);
      const target = join(VERIFIER, specifier);
      assert.ok(readFileSync(target, 'utf8').length > 0, `${module} imports ${specifier}, which is not a module here`);
    }
  }
});

/**
 * Remove block comments, so that a rule below matches code rather than prose.
 *
 * A JSDoc type annotation such as `import('./status.js')` says what a value is;
 * it is not a dynamic import, and a rule that could not tell the difference
 * would push the author to stop documenting their types in order to pass.
 *
 * @param {string} text
 * @returns {string}
 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

test('no verifier module reads the clock, the disk, the network, or a random source', () => {
  for (const module of MODULES) {
    const text = stripComments(readFileSync(join(VERIFIER, module), 'utf8'));
    for (const [what, pattern] of FORBIDDEN) {
      const found = text.match(pattern);
      assert.equal(found, null, `${module} uses ${what}: ${found === null ? '' : found[0]}`);
    }
  }
});

/**
 * The two directions of canonical JSON are separate modules.
 *
 * This is the rule that makes `test/canonical.roundtrip.test.js` evidence rather
 * than a tautology: a reader and a writer that shared an implementation would
 * agree with each other about a rule they had both misread, and the cheapest way
 * to make a round trip pass is to make both directions the same function.
 *
 * So the boundary is asserted here rather than described: neither module may
 * mention the other's functions, the writing direction may not import the reader
 * at all, and each module's public surface is exactly the half of the rule it
 * owns. A function that moves to the wrong side of the line fails this test,
 * which is where that mistake should be caught.
 */
test('the serializer shares the specification with the reader and no code', () => {
  const reader = stripComments(readFileSync(join(VERIFIER, 'canonical.js'), 'utf8'));
  const writer = stripComments(readFileSync(join(VERIFIER, 'canonical-write.js'), 'utf8'));

  const specifiers = [...writer.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
  assert.equal(specifiers.includes('./canonical.js'), false, 'the serializer must not import the reader');
  for (const name of ['parseJsonText', 'parseJsonBytes', 'Cursor']) {
    assert.equal(writer.includes(name), false, `the serializer names ${name}, which is the reader's`);
  }
  for (const name of ['serializeCanonical', 'quoteString', 'compareByCodePoint', 'canonicalBytes', 'canonicalDocument', 'signingInput']) {
    assert.equal(reader.includes(name), false, `the reader names ${name}, which is the serializer's`);
  }

  const exported = (text) => [...text.matchAll(/^export (?:function|const|class) (\w+)/gm)].map((match) => match[1]).sort();
  assert.deepEqual(
    exported(reader),
    ['parseJsonBytes', 'parseJsonText'],
    'the reader exports the reading direction and nothing else',
  );
  assert.deepEqual(
    exported(writer),
    ['CanonicalWriteError', 'LF', 'canonicalBytes', 'canonicalDocument', 'compareByCodePoint', 'quoteString', 'serializeCanonical', 'signingInput'],
    'the serializer exports the writing direction and nothing else',
  );

  // The dependency runs one way. A verifier recomputing a signing input is a
  // caller of the writing direction, not a second writer.
  for (const name of ['verify.js', 'manifest.js', 'provenance.js']) {
    const text = readFileSync(join(VERIFIER, name), 'utf8');
    assert.ok(text.includes("from './canonical-write.js'"), `${name} must write through the serializer`);
  }
});

/**
 * The reading path may not reach a writer.
 *
 * `verifier/**` holds two modules that only a writer calls: the ZIP writer and
 * the base64url encoder. They are here because they are shared by every writer
 * this project has — the producer, and the editor that runs in a page — and a
 * directory a browser may not import cannot hold shared code. What must stay
 * true is that a verdict never depends on them: a verifier that read its own
 * writing code would be able to agree with itself about a byte sequence the
 * format does not define. So the imports are walked from the one entry point a
 * verdict comes from, and a writer on that path is a failure, not a warning.
 */
test('the reading path never reaches the writers that share this directory', () => {
  const WRITERS = ['zip-write.js', 'base64url-write.js', 'refuse.js'];
  const reachable = new Set();
  /** @type {string[]} */
  const queue = ['verify.js'];
  while (queue.length > 0) {
    const name = queue.pop();
    if (name === undefined || reachable.has(name)) continue;
    reachable.add(name);
    for (const specifier of readFileSync(join(VERIFIER, name), 'utf8').matchAll(/\bfrom\s+['"](\.\/[^'"]+)['"]/g)) {
      queue.push(specifier[1].slice(2));
    }
  }
  assert.ok(reachable.has('bytes.js'), 'the walk must actually follow imports');
  for (const writer of WRITERS) {
    assert.equal(reachable.has(writer), false, `${writer} is reachable from verify.js, so a verdict would depend on a writer`);
  }
});


test('the file system is touched by the command line and the kit, and nowhere else', () => {
  /** @type {string[]} */
  const users = [];
  for (const dir of ['cli', 'verifier', 'vectors', 'test']) {
    for (const name of readdirSync(join(ROOT, dir))) {
      if (!name.endsWith('.js') && !name.endsWith('.mjs')) continue;
      const text = readFileSync(join(ROOT, dir, name), 'utf8');
      if (/\bfrom\s+['"]node:fs/.test(text)) users.push(relative(ROOT, join(ROOT, dir, name)).replace(/\\/g, '/'));
    }
  }
  for (const user of users) {
    const allowed = user.startsWith('cli/') || user.startsWith('vectors/') || user.startsWith('test/');
    assert.ok(allowed, `${user} reads the file system, and only the command line, the kit, and the tests may`);
  }
  assert.ok(users.includes('cli/charter.js'), 'the command line is where a file becomes bytes');
});
