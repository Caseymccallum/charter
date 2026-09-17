/**
 * The one reader that walks the declaration registry.
 *
 * `test/declarations.js` is the table: one row per declaration `SPEC.md` makes
 * that `verifier/**` states a second time. This file is the only thing that
 * walks it, and it does two jobs.
 *
 * **It checks every row.** For each one it reads the claim out of `SPEC.md`
 * using the row's locator, reads the constants the row names out of their
 * modules, and compares them by the row's `compare`. A row that cannot find its
 * anchor fails with the anchor quoted, so a reworded sentence reports where it
 * went rather than reading nothing.
 *
 * **It checks the table itself.** That is the half that makes this a mechanism.
 * Every constant exported by `verifier/**` is either named by some row or listed
 * in `EXEMPT` with a reason, and the check runs in both directions: a constant
 * added to a module without a row fails, a row naming a constant that no longer
 * exists fails, and an exemption for a constant that is registered — or gone —
 * fails. The audit that produced this file found its fourteen gaps by grepping
 * for five prose shapes, and the next declaration will not use one of them. The
 * enforcement half does not grep.
 *
 * @module test/declarations.test
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { CHECK_IDS } from '../verifier/status.js';
import { EXEMPT, REGISTRY } from './declarations.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SPEC = readFileSync(join(ROOT, 'SPEC.md'), 'utf8');
const VERIFIER = join(ROOT, 'verifier');

/**
 * A level-2 section of `SPEC.md`, without the heading.
 *
 * @param {string} heading e.g. "3.3 Compression and flags"
 * @returns {string}
 */
function section(heading) {
  for (const marker of ['## ', '### ']) {
    const start = SPEC.indexOf(`\n${marker}${heading}\n`);
    if (start === -1) continue;
    const rest = SPEC.slice(start + 1);
    const end = rest.search(/\n#{2,3} /);
    return end === -1 ? rest : rest.slice(0, end);
  }
  assert.fail(`SPEC.md has a section headed "${heading}", and a row of the registry reads it`);
  return '';
}

/**
 * The text a row's locator points at: what follows its anchor, up to `end`.
 *
 * @param {{ section: string, anchor: string, end?: string }} locator
 * @returns {string}
 */
function claimText(locator) {
  const text = section(locator.section);
  const at = text.indexOf(locator.anchor);
  assert.notEqual(
    at,
    -1,
    `section "${locator.section}" no longer says "${locator.anchor}", and a row of the registry reads that sentence`,
  );
  const rest = text.slice(at + locator.anchor.length);
  if (locator.end === undefined) return rest;
  const end = rest.indexOf(locator.end);
  assert.notEqual(end, -1, `the claim anchored at "${locator.anchor}" no longer ends with "${locator.end}"`);
  return rest.slice(0, end);
}

/**
 * The rows of the table that follows an anchor, as arrays of cells.
 *
 * The anchor has to sit before the table's header — in the sentence that
 * introduces it, or at the start of the header's own line. An anchor placed
 * inside the header would leave the header out of `rows`, and the first row
 * dropped here would be the table's first *claim* rather than its title.
 *
 * @param {string} text
 * @param {string} anchor
 * @returns {string[][]} every row but the header
 */
function rowsAfter(text, anchor) {
  const at = text.indexOf(anchor);
  assert.notEqual(at, -1, `SPEC.md no longer says "${anchor}", and a row of the registry reads the table under it`);
  /** @type {string[][]} */
  const rows = [];
  for (const line of text.slice(at).split('\n')) {
    if (!line.startsWith('| ')) {
      if (rows.length > 0) break;
      continue;
    }
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 2 || /^-+$/.test(cells[1])) continue;
    rows.push(cells);
  }
  assert.ok(rows.length > 0, `the table under "${anchor}" has rows, and this row of the registry reads them`);
  return rows.slice(1);
}

/** Every name between backticks. @param {string} text @returns {string[]} */
function backticked(text) {
  return [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

/** Every bare name in a comma-separated list. @param {string} text @returns {string[]} */
function listed(text) {
  return text
    .replace(/[.\s]+$/, '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

/**
 * A token from the document, as the value it means.
 *
 * The document states sizes in the units a person reads (`256 MiB`), codes in
 * hex (`0x0014`), and enumerations in quotes (`"create"`), so a row's spec side
 * has to be normalized before it can be compared with a constant.
 *
 * @param {string} token
 * @returns {number | string}
 */
function valueOf(token) {
  const text = token.trim().replace(/^"|"$/g, '');
  if (/^0x[0-9a-f]+$/i.test(text)) return Number.parseInt(text, 16);
  if (/^\d+$/.test(text)) return Number(text);
  const measured = /^([\d,]+)\s*(KiB|MiB|GiB|TiB|bytes?)?$/i.exec(text);
  if (measured !== null) {
    const scale = { kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 };
    const unit = (measured[2] ?? '').toLowerCase();
    return Number(measured[1].replaceAll(',', '')) * (scale[unit] ?? 1);
  }
  return text;
}

/** The number each word a counting sentence here could use states. */
const WORDS = Object.freeze({
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
});

/**
 * The number an adjective states, read back from the word itself.
 *
 * @param {string} sentence the text the counting word ends
 * @returns {number}
 */
function wordToNumber(sentence) {
  const word = /([A-Za-z]+)[^A-Za-z]*$/.exec(sentence);
  assert.notEqual(word, null, `"${sentence}" does not end in a word this reader can read`);
  const found = WORDS[word[1].toLowerCase()];
  assert.notEqual(found, undefined, `"${word[1]}" is a counting word this reader cannot read`);
  return found;
}

/**
 * The top-level items of a list that follows an anchor.
 *
 * @param {string} text the section
 * @param {string} anchor
 * @param {RegExp} marker what a list item starts with
 * @returns {number}
 */
function itemsAfter(text, anchor, marker) {
  const at = text.indexOf(anchor);
  assert.notEqual(at, -1, `SPEC.md no longer says "${anchor}", and a row of the registry counts the list under it`);
  let counted = 0;
  let started = false;
  for (const line of text.slice(at).split('\n')) {
    if (marker.test(line)) {
      counted += 1;
      started = true;
      continue;
    }
    if (started && (line.trim() === '' || /^#{2,} /.test(line))) break;
  }
  assert.ok(counted > 0, `the list under "${anchor}" has items, and this row of the registry counts them`);
  return counted;
}

/**
 * What a row's locator says the document states.
 *
 * A read either yields the values the document lists, or the count it states
 * together with the number of items it states them over. Both directions matter
 * for a counted claim: a sentence that says "three" over two items is wrong even
 * if the code agrees with one of the two numbers.
 *
 * @param {{ section: string, anchor?: string, end?: string, read: string, arg?: string }} locator
 * @returns {{ values: (number | string)[], count?: number, items?: number }}
 */
function specSide(locator) {
  const text = section(locator.section);
  switch (locator.read) {
    case 'table-names':
      return { values: rowsAfter(text, locator.anchor).map((cells) => backticked(cells[Number(locator.arg) - 1])[0]) };
    case 'table-column':
      return { values: rowsAfter(text, locator.anchor).map((cells) => valueOf(cells[Number(locator.arg) - 1])) };
    case 'table-unique':
      return { values: [...new Set(rowsAfter(text, locator.anchor).map((cells) => cells[Number(locator.arg) - 1]))] };
    case 'table-ids':
      return { values: rowsAfter(text, locator.anchor).map((cells) => backticked(cells[1])[0]) };
    case 'measures':
      return { values: rowsAfter(text, locator.anchor).map((cells) => valueOf(cells[1])) };
    case 'row-value': {
      const row = rowsAfter(text, locator.anchor).find(
        (cells) => cells[0] === locator.arg || backticked(cells[0]).includes(locator.arg),
      );
      assert.notEqual(row, undefined, `the table under "${locator.anchor}" has no row for \`${locator.arg}\``);
      return { values: backticked(row[1]).map(valueOf) };
    }
    case 'row-zero': {
      // Section 3.6's table states a value two ways: as a backticked number for
      // the fields that hold one, and as prose for the two fields fixed at
      // nothing ("none: the field is zero bytes long"). Both are one claim, and
      // a row that read only the first spelling would report the other two as
      // an empty list — a claim the code could then disagree with and pass.
      const row = rowsAfter(text, locator.anchor).find(
        (cells) => cells[0] === locator.arg || backticked(cells[0]).includes(locator.arg),
      );
      assert.notEqual(row, undefined, `the table under "${locator.anchor}" has no row for \`${locator.arg}\``);
      const named = backticked(row[1]).map(valueOf);
      if (named.length > 0) return { values: named };
      assert.match(
        row[1],
        /zero bytes|none:/,
        `the "${locator.arg}" row states neither a number nor that the field is zero bytes long`,
      );
      return { values: [0] };
    }
    case 'names':
      return { values: backticked(claimText(locator)).map(valueOf) };
    case 'quoted':
      return { values: [...claimText(locator).matchAll(/"([^"]+)"/g)].map((match) => match[1]) };
    case 'numbers':
      return { values: [...claimText(locator).matchAll(/0x[0-9a-fA-F]+|\d+/g)].map((match) => valueOf(match[0])) };
    case 'word': {
      const word = /^[A-Za-z][\w-]*/.exec(claimText(locator).trimStart());
      assert.notEqual(word, null, `the anchor "${locator.anchor}" is no longer followed by a word`);
      return { values: [word[0]] };
    }
    case 'sentence-names':
      return { values: listed(claimText(locator)) };
    case 'section-ids':
      return { values: [...new Set(text.match(/L[0-2]\.[A-Z]+\.[A-Z0-9_]+/g) ?? [])] };
    case 'count-rows': {
      const rest = text.slice(text.indexOf(locator.anchor) + locator.anchor.length).trimStart();
      const word = /^([A-Za-z]+)/.exec(rest);
      assert.notEqual(word, null, `the anchor "${locator.anchor}" is no longer followed by a counting word`);
      const count = WORDS[word[1].toLowerCase()];
      assert.notEqual(count, undefined, `"${word[1]}" is a counting word this reader cannot read`);
      return { values: [], count, items: rowsAfter(text, locator.anchor).length };
    }
    case 'count-before': {
      const at = text.indexOf(locator.anchor);
      assert.notEqual(at, -1, `SPEC.md no longer says "${locator.anchor}", and a row of the registry counts the list under it`);
      return { values: [], count: wordToNumber(text.slice(0, at)), items: itemsAfter(text, locator.anchor, /^\d+\. /) };
    }
    case 'count-bullets': {
      const at = text.indexOf(locator.anchor);
      assert.notEqual(at, -1, `SPEC.md no longer says "${locator.anchor}", and a row of the registry counts the list under it`);
      return { values: [], count: wordToNumber(text.slice(0, at)), items: itemsAfter(text, locator.anchor, /^- /) };
    }
    default:
      throw new Error(`the registry uses a read this reader does not have: ${locator.read}`);
  }
}

/**
 * The members of a constant, whatever shape it is written in.
 *
 * A declaration may be an array of names, a frozen record of them, or a single
 * value, and a comparison should not have to care: a status vocabulary is a
 * record of four strings, and four strings is what it holds.
 *
 * @param {unknown} value
 * @returns {unknown[]}
 */
function membersOf(value) {
  if (Array.isArray(value)) return value;
  if (value !== null && typeof value === 'object') return Object.values(value);
  return [value];
}

/**
 * Every constant `verifier/**` exports, by name, with the module it came from.
 *
 * Discovered from the tree rather than listed, for the same reason the audit
 * discovered the documents: a list written by hand is a list that can forget.
 * Only a constant is a declaration; a function is a mechanism, and the registry
 * is about what the document says.
 *
 * @returns {Promise<Map<string, { key: string, value: unknown }>>}
 */
async function exportedConstants() {
  /** @type {Map<string, { key: string, value: unknown }>} */
  const found = new Map();
  for (const file of readdirSync(VERIFIER).filter((name) => name.endsWith('.js')).sort()) {
    const key = `verifier/${file}`;
    const module = await import(pathToFileURL(join(ROOT, key)).href);
    const source = readFileSync(join(ROOT, key), 'utf8');
    for (const [, name] of source.matchAll(/^export (?:const|let|var|function|class) ([A-Za-z_$][\w$]*)/gm)) {
      if (typeof module[name] === 'function') continue;
      assert.equal(
        found.has(name),
        false,
        `${name} is exported by ${key} and by ${found.get(name)?.key}, so a row naming it would not say which module declares it`,
      );
      found.set(name, { key, value: module[name] });
    }
  }
  return found;
}

/**
 * What a row's constants say, as a flat list of members.
 *
 * A row that filters names a claim about the members of a register rather than
 * about one constant — section 6 names the checks the registry must hold for
 * content, and the comparison is against the register filtered to that level.
 *
 * @param {{ exports: string[], filter?: string }} row
 * @param {Map<string, { key: string, value: unknown }>} constants
 * @returns {unknown[]}
 */
function codeSide(row, constants) {
  if (row.filter !== undefined) return CHECK_IDS.filter((id) => id.startsWith(row.filter));
  /** @type {unknown[]} */
  const values = [];
  for (const name of row.exports) {
    const entry = constants.get(name);
    assert.notEqual(entry, undefined, `the registry names ${name} and verifier/** does not export it`);
    values.push(...membersOf(entry.value));
  }
  return values;
}

/**
 * Hold one row's two sides together, and say which row and which claim failed.
 *
 * @param {import('./declarations.js').Declaration} row
 * @param {{ values: (number | string)[], count?: number, items?: number }} spec
 * @param {unknown[]} code
 */
function hold(row, spec, code) {
  const where = `${row.id} — ${row.what}`;
  const sorted = (list) => list.map(String).sort();
  switch (row.compare) {
    case 'set':
      assert.deepEqual(sorted(code), sorted(spec.values), `${where}\nthe document lists [${sorted(spec.values)}] and the code holds [${sorted(code)}]`);
      return;
    case 'values':
      assert.deepEqual(code, spec.values, `${where}\nthe document states [${spec.values}] in order and the code holds [${code}]`);
      return;
    case 'ids':
      assert.deepEqual(
        code.map((member) => /** @type {{ id: string }} */ (member).id),
        spec.values,
        `${where}\nthe document lists ${spec.values.length} ids in an order the code does not have`,
      );
      return;
    case 'count':
      assert.equal(spec.count, spec.items, `${where}\nthe sentence states ${spec.count} and ${spec.items} item(s) are under it`);
      assert.equal(code.length, spec.count, `${where}\nthe sentence states ${spec.count} and the code holds ${code.length}`);
      return;
    case 'bullets':
      assert.equal(spec.count, spec.items, `${where}\nthe sentence states ${spec.count} and ${spec.items} item(s) are under it`);
      return;
    case 'bits': {
      const mask = Number(code[0]);
      let union = 0;
      for (const bit of spec.values) union |= Number(bit);
      for (const bit of spec.values) {
        assert.ok((mask & Number(bit)) !== 0, `${where}\nthe document names ${bit} and 0x${mask.toString(16)} does not hold it`);
      }
      assert.equal(mask, union, `${where}\nthe document names 0x${union.toString(16)} and the code holds 0x${mask.toString(16)}`);
      return;
    }
    case 'member':
      for (const member of code) {
        assert.ok(
          spec.values.includes(Number(member)) || spec.values.includes(member),
          `${where}\nthe constant is ${member}, and the document does not name it among [${spec.values}]`,
        );
      }
      return;
    default:
      throw new Error(`${row.id} uses a comparison this reader does not have: ${row.compare}`);
  }
}

/** Every constant the verifier exports, and every name the registry binds. */
const CONSTANTS = await exportedConstants();
const REGISTERED = new Set(REGISTRY.flatMap((row) => row.exports));

test('every declaration in the registry is what the document says and what the code holds', () => {
  assert.ok(REGISTRY.length > 0, 'the registry has rows');
  const ids = REGISTRY.map((row) => row.id);
  assert.equal(new Set(ids).size, ids.length, `a row id appears twice: ${ids.join(', ')}`);
  for (const row of REGISTRY) {
    hold(row, specSide(row.spec), codeSide(row, CONSTANTS));
  }
});

test('every constant verifier/** exports is registered or exempted, in both directions', () => {
  const exempt = new Set(Object.keys(EXEMPT));

  const unaccounted = [];
  for (const [name, entry] of CONSTANTS) {
    if (REGISTERED.has(name) || exempt.has(`${entry.key}#${name}`)) continue;
    unaccounted.push(`${entry.key}#${name}`);
  }
  assert.deepEqual(
    unaccounted,
    [],
    `these constants are exported by verifier/** and neither registered nor exempted: ${unaccounted.join(', ')}. A declaration the registry does not know about is a declaration nothing holds to the document, and the audit that produced this file found its gaps by grepping for shapes the next one will not use`,
  );

  for (const name of REGISTERED) {
    assert.ok(CONSTANTS.has(name), `the registry names ${name} and no module under verifier/** exports it`);
  }

  for (const [key, reason] of Object.entries(EXEMPT)) {
    const [file, name] = key.split('#');
    const entry = CONSTANTS.get(name);
    assert.notEqual(entry, undefined, `${key} is exempted and no module exports ${name}`);
    assert.equal(entry.key, file, `${key} names ${file}, and ${name} is exported by ${entry.key}`);
    assert.equal(REGISTERED.has(name), false, `${key} is exempted and registered at the same time, so the reason beside it is not a reason`);
    assert.ok(
      typeof reason === 'string' && reason.includes(' ') && reason.length >= 40,
      `${key} is exempted with "${reason}", and an exemption has to give a reason rather than a name`,
    );
  }
});
