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
