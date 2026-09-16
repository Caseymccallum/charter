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
