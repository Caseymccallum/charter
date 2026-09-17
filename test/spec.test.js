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
 * The other list here is section 12's command block, and it went stale the same
 * way. `cli/charter.js` dispatches six verbs and section 12 showed five, because
 * the block was written before `edit` landed: the document described a command
 * line nobody has, and nothing read it back. So the verbs are taken from three
 * places — the dispatch table, the usage block the command line prints, and
 * section 12's command lines — and all three have to be the same set.
 *
 * Section 3.7's table of ceilings is the third declaration of this kind: nine
 * numbers the section calls published behaviour, held in three places at once —
 * the table, `verifier/limits.js`, and the Python reading's own module. The
 * table's second column states each ceiling in the units a person reads it in
 * ("256 MiB", "100,000", "65,535 bytes"), and its first column is prose
 * ("Whole file", "One entry, compressed") that no document turns into a name.
 * So the three lists are compared **by position**, which puts the table's order
 * under the same claim as its numbers; a row-by-row mapping would leave a
 * reordered table passing.
 *
 * The field lists of sections 5 and 7 are the fourth: the six fields of a
 * manifest, the one field of its `content` object, the four of its `author`, the
 * seven of a provenance entry, the two of that entry's `author`, and the closed
 * enumeration an `action` must be one of. Each is declared in the document, held
 * as an array in `verifier/manifest.js` or `verifier/provenance.js`, and held
 * again as a tuple in the port's `documents.py` — and those arrays are not
 * decoration: `findUnknownField` is handed them, so one of them growing a name
 * is `EXTRA_FIELDS` accepting a field the document forbids. Here the three
 * copies are compared as sets, because the three orders differ, and the two
 * sentences that state the counts ("these six", "exactly these seven") are read
 * against the rows beneath them.
 *
 * @module test/spec
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LIMITS } from '../verifier/limits.js';
import { MANIFEST_AUTHOR_FIELDS, MANIFEST_CONTENT_FIELDS, MANIFEST_FIELDS } from '../verifier/manifest.js';
import { ACTIONS, ENTRY_AUTHOR_FIELDS, ENTRY_FIELDS } from '../verifier/provenance.js';
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

/** The source of the command line, which two of the three verb lists live in. */
const CLI = readFileSync(join(ROOT, 'cli', 'charter.js'), 'utf8');

/**
 * The verbs the command line can be asked to run, read from its dispatch table.
 *
 * @returns {string[]}
 */
function dispatchedVerbs() {
  return [...CLI.matchAll(/if \(command === '([a-z]+)'\)/g)].map((match) => match[1]).sort();
}

/**
 * The verbs the command line states in its own usage text.
 *
 * @returns {string[]}
 */
function usageVerbs() {
  const block = /const HELP = `([\s\S]*?)`;/.exec(CLI);
  assert.notEqual(block, null, 'cli/charter.js states its usage in a `HELP` constant, and this test reads that block');
  return [...new Set([...block[1].matchAll(/^ {2}charter ([a-z]+)/gm)].map((match) => match[1]))].sort();
}

/**
 * The verbs section 12's command lines name.
 *
 * @returns {string[]}
 */
function documentedVerbs() {
  const running = section('12. Running it');
  return [...new Set([...running.matchAll(/node cli\/charter\.js ([a-z]+)/g)].map((match) => match[1]))].sort();
}

test('the verbs section 12 shows are the verbs the command line dispatches', () => {
  const dispatched = dispatchedVerbs();
  assert.ok(dispatched.length > 0, 'cli/charter.js dispatches verbs in a table this test can read');
  for (const [what, list] of [['its own usage text', usageVerbs()], ['section 12', documentedVerbs()]]) {
    const missing = dispatched.filter((verb) => !list.includes(verb));
    assert.deepEqual(
      missing,
      [],
      `cli/charter.js dispatches ${missing.join(', ')} and ${what} never names ${missing.length === 1 ? 'it' : 'them'}, so the document shows a command line nobody has`,
    );
    const invented = list.filter((verb) => !dispatched.includes(verb));
    assert.deepEqual(invented, [], `${what} names ${invented.join(', ')}, and the command line dispatches no such command`);
  }
});

/**
 * The `settled by` column of section 10.2, row by row.
 *
 * @returns {{ id: string, settled: string }[]}
 */
function ownerRows() {
  const start = VERDICTS.indexOf('### 10.2 One requirement, one owner');
  const end = VERDICTS.indexOf('### 10.3');
  assert.notEqual(start, -1, 'SPEC.md section 10.2 is the table this test reads');
  assert.notEqual(end, -1, 'SPEC.md section 10.3 is where the column is explained');
  return VERDICTS.slice(start, end)
    .split('\n')
    .filter((line) => /^\|\s*`L[0-2]\./.test(line))
    .map((line) => {
      const cells = line.split('|').map((cell) => cell.trim());
      return { id: cells[1].replaceAll('`', ''), settled: cells[4] };
    });
}

/**
 * The cases one cell of the column names, with the kind of case each is.
 *
 * @param {string} settled
 * @returns {{ kind: string, name: string }[]}
 */
function settledBy(settled) {
  return settled.split(';').flatMap((group) => {
    const named = [...group.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    const [kind, ...cases] = named;
    return cases.map((name) => ({ kind, name }));
  });
}

test('every row of section 10.2 names the cases that check it', () => {
  const records = {
    fixture: new Set(JSON.parse(readFileSync(join(ROOT, 'vectors', 'expected.json'), 'utf8')).cases.map((entry) => entry.name)),
    probe: new Set(JSON.parse(readFileSync(join(ROOT, 'vectors', 'probe', 'expected.json'), 'utf8')).cases.map((entry) => entry.name)),
    corpus: new Set(JSON.parse(readFileSync(join(ROOT, 'vectors', 'container', 'expected.json'), 'utf8')).cases.map((entry) => entry.name)),
  };
  const rows = ownerRows();
  assert.deepEqual(rows.map((row) => row.id), [...CHECK_IDS], 'the table is the registry, in the registry’s order');
  /** @type {Record<string, number>} */
  const totals = { fixture: 0, probe: 0, corpus: 0 };
  for (const row of rows) {
    assert.ok(row.settled.startsWith('`'), `${row.id}: every row names where it is settled`);
    const cases = settledBy(row.settled);
    assert.ok(cases.length > 0, `${row.id}: the column names at least one case`);
    for (const { kind, name } of cases) {
      assert.ok(Object.keys(records).includes(kind), `${row.id}: ${kind} is not one of the three kinds of case`);
      assert.ok(
        records[kind].has(name),
        `${row.id}: ${kind} has no case named ${name}, so the column would be claiming a case that does not exist`,
      );
    }
    for (const kind of new Set(cases.map((entry) => entry.kind))) totals[kind] += 1;
    assert.equal(row.settled.includes('prose'), false, `${row.id}: no row is prose alone`);
  }
  const stated = VERDICTS.match(/\*\*(\d+) rows settled by a kit fixture, (\d+) by a probe case, (\d+) by a\ncorpus case, and none by prose alone\*\*/);
  assert.notEqual(stated, null, 'section 10.3 states the column’s totals, and this test reads that sentence');
  assert.equal(Number(stated[1]), totals.fixture, 'the stated fixture total is the column’s fixture total');
  assert.equal(Number(stated[2]), totals.probe, 'the stated probe total is the column’s probe total');
  assert.equal(Number(stated[3]), totals.corpus, 'the stated corpus total is the column’s corpus total');
});

/**
 * Section 3.7's table: the ceilings the format publishes.
 *
 * The first column is prose ("Whole file", "One entry, compressed") and the
 * second is a number with a unit ("256 MiB", "65,535 bytes"), so neither column
 * can be matched against a name in `verifier/limits.js` — there is no string in
 * this table that says `MAX_ARCHIVE_BYTES`. What the three copies share is their
 * **order**: the table lists the ceilings in the order the module declares them
 * and the port declares them again. That order is what this reads, and the
 * values are compared through it.
 *
 * @returns {{ what: string, value: number }[]}
 */
function limitsTable() {
  const spec = readFileSync(join(ROOT, 'SPEC.md'), 'utf8');
  const at = spec.indexOf('\n### 3.7');
  assert.notEqual(at, -1, 'SPEC.md has a section 3.7, where the published ceilings are tabulated');
  const rest = spec.slice(at + 1);
  const end = rest.search(/\n#{2,3} /);
  /** @type {{ what: string, value: number }[]} */
  const rows = [];
  for (const line of (end === -1 ? rest : rest.slice(0, end)).split('\n')) {
    if (!line.startsWith('| ')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 2) continue;
    if (/^-+$/.test(cells[1]) || cells[0] === 'Dimension') continue;
    rows.push({ what: cells[0], value: measure(cells[1]) });
  }
  assert.ok(rows.length > 0, "section 3.7's table has rows, and this test reads them");
  return rows;
}

/**
 * A size a document states as text, as a number.
 *
 * Units are allowed because the table uses them: `256 MiB` is 268435456, and a
 * bare `64` is 64. A cell this cannot read is a defect in this reader rather
 * than in the document, so it fails here, where the cell is named.
 *
 * @param {string} cell
 * @returns {number}
 */
function measure(cell) {
  const found = /([\d,_]+)\s*(KiB|MiB|GiB|TiB|bytes?)?/i.exec(cell);
  assert.notEqual(found, null, `"${cell}" states no size this reader can read`);
  const scale = { kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 };
  const unit = (found[2] ?? '').toLowerCase();
  return Number(found[1].replace(/[,_]/g, '')) * (scale[unit] ?? 1);
}

/**
 * The Python port's copy of the same nine ceilings, in its own names.
 *
 * The port is a second reading and not a second declaration: it may name its
 * constants differently, and it does, so this reads its values and not its
 * names. A name the port has and the table does not would be a tenth ceiling,
 * and the length comparison is what would say so.
 *
 * @returns {number[]}
 */
function portLimits() {
  const source = readFileSync(join(ROOT, 'implementations', 'python', 'charter_verify', 'limits.py'), 'utf8');
  /** @type {number[]} */
  const values = [];
  for (const line of source.split('\n')) {
    const found = /^([A-Z][A-Z0-9_]*)\s*(?::\s*\w+)?\s*=\s*(.+)$/.exec(line.trim());
    if (found) values.push(evaluate(found[2]));
  }
  assert.ok(values.length > 0, "the port's limits.py declares constants, and this test reads them");
  return values;
}

/**
 * A Python constant's value, as a number.
 *
 * The port writes its ceilings as arithmetic, because that is how the numbers
 * are read: `256 * 1024 * 1024` says 256 MiB where `268435456` says nothing a
 * person can check. A reader that took only bare digits would find four of the
 * nine and quietly pass on the rest, which is the failure this avoids. The
 * grammar is multiplication, addition and parentheses; a value written some
 * other way fails here, naming itself, rather than being skipped.
 *
 * @param {string} expression the text to the right of the `=`
 * @returns {number}
 */
function evaluate(expression) {
  const text = expression.replace(/_/g, '').replace(/\s+/g, '');
  assert.match(text, /^[\d*+()]+$/, `"${expression}" is not arithmetic this reader can evaluate`);
  let at = 0;
  const number = () => {
    const start = at;
    while (at < text.length && text[at] >= '0' && text[at] <= '9') at += 1;
    assert.ok(at > start, `"${expression}" has an operator with no number beside it`);
    return Number(text.slice(start, at));
  };
  const factor = () => {
    if (text[at] !== '(') return number();
    at += 1;
    const value = sum();
    assert.equal(text[at], ')', `"${expression}" has a parenthesis this reader did not close`);
    at += 1;
    return value;
  };
  const product = () => {
    let value = factor();
    while (text[at] === '*') {
      at += 1;
      value *= factor();
    }
    return value;
  };
  function sum() {
    let value = product();
    while (text[at] === '+') {
      at += 1;
      value += product();
    }
    return value;
  }
  const value = sum();
  assert.equal(at, text.length, `"${expression}" has text this reader did not read`);
  return value;
}

test("section 3.7 tabulates the ceilings verifier/limits.js declares, row by row", () => {
  const table = limitsTable();
  const names = Object.keys(LIMITS);
  const declared = Object.values(LIMITS);
  assert.equal(
    declared.length,
    table.length,
    `section 3.7 tabulates ${table.length} ceilings and verifier/limits.js declares ${declared.length}`,
  );
  table.forEach((row, index) => {
    assert.equal(
      declared[index],
      row.value,
      `section 3.7's row ${index + 1} ("${row.what}") states ${row.value} and ${names[index]} is ${declared[index]}`,
    );
  });
});

test('the port declares the same ceilings, in the same order', () => {
  const table = limitsTable();
  const port = portLimits();
  assert.equal(
    port.length,
    table.length,
    `the port declares ${port.length} ceilings and section 3.7 tabulates ${table.length}`,
  );
  table.forEach((row, index) => {
    assert.equal(
      port[index],
      row.value,
      `section 3.7's row ${index + 1} ("${row.what}") states ${row.value} and the port's constant for it is ${port[index]}`,
    );
  });
});

/**
 * The table a counting sentence introduces, and the number its word states.
 *
 * The sentence is the anchor and its word is part of the claim: section 5 says
 * "no other field than these six" and section 7 says "exactly these seven
 * fields". Each states a count, and the table under it is that count made
 * concrete. Both are read here, so a table that grew a row while its sentence
 * stayed put fails in this file rather than nowhere.
 *
 * @param {string} text the section to search
 * @param {string} prefix the sentence, up to but not including its number word
 * @param {string} after what follows that word, e.g. `":"`
 * @returns {{ stated: number, rows: string[][] }}
 */
function tableRows(text, prefix, after) {
  const at = text.indexOf(prefix);
  assert.notEqual(at, -1, `SPEC.md no longer says "${prefix}", and this test reads the table under it`);
  const rest = text.slice(at + prefix.length).trimStart();
  const word = /^([a-z]+)/.exec(rest);
  assert.notEqual(word, null, `"${prefix}" is no longer followed by a number word`);
  assert.equal(
    rest.slice(word[1].length).startsWith(after),
    true,
    `"${prefix} ${word[1]}" is no longer followed by "${after}"`,
  );
  assert.ok(word[1] in FIELD_WORDS, `"${word[1]}" is a number word this test cannot read`);
  /** @type {string[][]} */
  const rows = [];
  for (const line of rest.split('\n')) {
    if (!line.startsWith('| ')) {
      if (rows.length > 0) break;
      continue;
    }
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 2 || /^-+$/.test(cells[1])) continue;
    rows.push(cells);
  }
  assert.ok(rows.length > 0, `the table under "${prefix}" has rows, and this test reads them`);
  return { stated: FIELD_WORDS[word[1]], rows: rows.slice(1) };
}

/** The number each word a counting sentence here could use states. */
const FIELD_WORDS = Object.freeze({
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
 * Every name between backticks in a string.
 *
 * @param {string} text
 * @returns {string[]}
 */
function backticked(text) {
  return [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

/**
 * Every name between double quotes in a string.
 *
 * @param {string} text
 * @returns {string[]}
 */
function quoted(text) {
  return [...text.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

/**
 * What sections 5 and 7 say each object carries, by list name.
 *
 * One read yields six lists, and nothing in them is transcribed. Section 5's one
 * table names the six fields of a manifest, and two of its rows describe the
 * objects nested inside it — a `content` object "whose only field is `sha256`"
 * and an `author` object "with exactly `name`, `algorithm`, `key_id`,
 * `public_key`". Section 7's table names the seven fields of an entry, and its
 * `author` and `action` rows do the same for that nested object and for the
 * closed enumeration an action must be one of.
 *
 * @returns {Record<string, string[]>}
 */
function declaredFields() {
  const five = tableRows(section('5. `manifest.json`'), 'no other field than these', ':');
  const seven = tableRows(section('7. `provenance.jsonl`'), 'each object carrying exactly these', ' fields:');
  const sentence = (table, name) => {
    const found = table.rows.find((cells) => backticked(cells[0]).includes(name));
    assert.notEqual(found, undefined, `the table has no row for \`${name}\`, and this test reads that row's sentence`);
    return found[1];
  };
  return {
    'manifest fields': five.rows.map((cells) => backticked(cells[0])[0]),
    'manifest content fields': backticked(sentence(five, 'content')),
    'manifest author fields': backticked(sentence(five, 'author')),
    'entry fields': seven.rows.map((cells) => backticked(cells[0])[0]),
    'entry author fields': backticked(sentence(seven, 'author')),
    'entry actions': quoted(sentence(seven, 'action')),
  };
}

/**
 * The Python port's six copies of the same lists, from `documents.py`.
 *
 * The port is a third reading, and it names its constants differently again, so
 * this reads values and not names. Each is a tuple of double-quoted strings, and
 * one of them is written across several lines, which is why the pattern closes
 * on the closing parenthesis rather than on the line.
 *
 * @returns {Record<string, string[]>}
 */
function portFields() {
  const source = readFileSync(join(ROOT, 'implementations', 'python', 'charter_verify', 'documents.py'), 'utf8');
  const read = (name) => {
    const found = new RegExp(`^${name}\\s*=\\s*\\(([^)]*)\\)`, 'ms').exec(source);
    assert.notEqual(found, null, `documents.py no longer declares ${name}, and this test reads it`);
    return quoted(found[1]);
  };
  return {
    'manifest fields': read('MANIFEST_FIELDS'),
    'manifest content fields': read('CONTENT_FIELDS'),
    'manifest author fields': read('AUTHOR_FIELDS'),
    'entry fields': read('ENTRY_FIELDS'),
    'entry author fields': read('ENTRY_AUTHOR_FIELDS'),
    'entry actions': read('ACTIONS'),
  };
}

test('the field lists sections 5 and 7 declare are the lists the verifiers enforce', () => {
  const declared = declaredFields();
  /** @type {Record<string, readonly string[]>} */
  const enforced = {
    'manifest fields': MANIFEST_FIELDS,
    'manifest content fields': MANIFEST_CONTENT_FIELDS,
    'manifest author fields': MANIFEST_AUTHOR_FIELDS,
    'entry fields': ENTRY_FIELDS,
    'entry author fields': ENTRY_AUTHOR_FIELDS,
    'entry actions': ACTIONS,
  };
  const port = portFields();
  const sorted = (names) => [...names].sort();
  for (const what of Object.keys(declared)) {
    assert.deepEqual(
      sorted(enforced[what]),
      sorted(declared[what]),
      `${what}: the document declares [${sorted(declared[what])}] and the verifier enforces [${sorted(enforced[what])}]`,
    );
    assert.deepEqual(
      sorted(port[what]),
      sorted(declared[what]),
      `${what}: the document declares [${sorted(declared[what])}] and the port reads [${sorted(port[what])}]`,
    );
  }
});

test('the number each of those sentences states is the number of rows under it', () => {
  const five = tableRows(section('5. `manifest.json`'), 'no other field than these', ':');
  const seven = tableRows(section('7. `provenance.jsonl`'), 'each object carrying exactly these', ' fields:');
  assert.equal(
    five.rows.length,
    five.stated,
    `section 5 states ${five.stated} fields and tabulates ${five.rows.length}`,
  );
  assert.equal(
    seven.rows.length,
    seven.stated,
    `section 7 states ${seven.stated} fields and tabulates ${seven.rows.length}`,
  );
});

