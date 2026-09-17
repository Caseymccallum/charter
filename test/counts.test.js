/**
 * The numbers these documents state about the present, read back off the disk.
 *
 * Every count in this project's prose — 56 artifacts, 28 adversarial cases, 27
 * Phase 1 cases, one artifact a tool wrote, 18 test files — is a claim, and until
 * this file existed nothing checked one. The cost of that showed up twice in one
 * pass. `README.md` said "148 tests" for a suite that had run 166 since `edit`
 * landed, and `SPEC.md` section 13's accounting of the kit that the same section
 * tells a reader to replay summed to 54 of its 56 artifacts: the ceiling case
 * moved the Phase 1 count to 27, and `produced-two-entries` was in no group at
 * all. Both were numbers nobody had read back.
 *
 * Three rules decide what belongs here.
 *
 * 1. **A number is checked against what holds it, not against a second copy of
 *    itself.** The kit's count is `vectors/expected.json` and the files beside it;
 *    the adversarial count is the rows of `test/adversarial.md` that name a
 *    fixture Phase 1 does not; the page's size is the page.
 * 2. **A claim about the present, not about a run.** `CHANGELOG.md` records what
 *    was true when a pass closed, so a count inside it is history, and rewriting
 *    one to match today would falsify a record rather than check it. This file
 *    reads none of it. `docs/first-user.md` is read for one present-tense claim
 *    only: the size of the page it says it served.
 * 3. **A number nobody can measure has to be stated as the number a command
 *    prints.** The number of *tests* is not on disk; `npm test`, `npm run probe`,
 *    `npm run sweep` and the Python leg print theirs, so the documents state those
 *    beside the command rather than as a fact to be trusted, and this file leaves
 *    them alone. The number of test *files* is on disk, so that one, and the name
 *    of every one of them, is checked — which is how a test file added by a pass
 *    that never mentioned it becomes a finding.
 *
 * A phrase that stops matching fails the test rather than going quietly
 * unchecked: this file reads these sentences, so a rewrite has to tell it where
 * they went. That is the arrangement `test/spec.test.js` has with section 10, for
 * the same reason.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/**
 * A file of this repository, as the bytes on disk spell it.
 *
 * @param {...string} parts path segments, from the repository root
 * @returns {string}
 */
function read(...parts) {
  return readFileSync(join(ROOT, ...parts), 'utf8');
}

/**
 * The artifacts in one of the kit's directories, by name and in one order.
 *
 * @param {...string} parts path segments of the directory, from the root
 * @returns {string[]}
 */
function artifacts(...parts) {
  return readdirSync(join(ROOT, ...parts))
    .filter((name) => name.endsWith('.charter'))
    .sort();
}

const KIT = JSON.parse(read('vectors', 'expected.json'));
const PROBE = JSON.parse(read('vectors', 'probe', 'expected.json'));
const CORPUS = JSON.parse(read('vectors', 'container', 'expected.json'));
const KIT_FILES = artifacts('vectors', 'out');
const PROBE_FILES = artifacts('vectors', 'probe', 'out');
const CORPUS_FILES = artifacts('vectors', 'container', 'out');

/** The test files in `test/`, which is the only count of them that is on disk. */
const TEST_FILES = readdirSync(HERE)
  .filter((name) => name.endsWith('.test.js'))
  .sort();

/**
 * The case each row of `test/adversarial.md` is about, in the table's own order.
 *
 * `test/adversarial.test.js` replays the same rows and reads the same six
 * columns; this is a second reader of that table, deliberately not a shared one,
 * because a parser two files shared would be a parser neither of them checked.
 *
 * @returns {string[]}
 */
function adversarialRows() {
  /** @type {string[]} */
  const rows = [];
  for (const line of read('test', 'adversarial.md').split('\n')) {
    if (!line.startsWith('| ')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 6) continue;
    if (cells[0] === 'Case' || /^-+$/.test(cells[0])) continue;
    rows.push(cells[0]);
  }
  return rows;
}

/**
 * A level-2 section of SPEC.md, by the text of its heading.
 *
 * @param {string} heading e.g. `"13. The conformance kit"`
 * @returns {string} the section's text, without the heading that follows it
 */
function section(heading) {
  const spec = read('SPEC.md');
  const start = spec.indexOf(`\n## ${heading}\n`);
  assert.notEqual(start, -1, `SPEC.md has a section headed "${heading}"`);
  const rest = spec.slice(start + 1);
  const end = rest.indexOf('\n## ', 1);
  return end === -1 ? rest : rest.slice(0, end);
}

const KIT_SECTION = section('13. The conformance kit');

/**
 * The names section 13 lists as Phase 1, read from the paragraph that lists them.
 *
 * The paragraph is bracketed by two sentences: the count it declares, and the
 * sentence that hands the rest of the kit to the adversarial pass. Every name
 * backticked between them is meant to be a case in the record, and a name that is
 * not one fails here rather than being quietly dropped from the count.
 *
 * @param {string[]} cases the record's names, used to tell a case from a word
 * @returns {string[]}
 */
function phase1Names(cases) {
  const marker = 'The 27 Phase 1 cases are the ways an artifact can be wrong.';
  const end = 'The 28 that follow are the **adversarial pass**';
  const at = KIT_SECTION.indexOf(marker);
  const until = KIT_SECTION.indexOf(end);
  assert.notEqual(
    at,
    -1,
    `SPEC.md section 13 no longer opens its accounting with "${marker}" — this test reads that sentence, so it has to be told where it went`,
  );
  assert.ok(until > at, `SPEC.md section 13 no longer hands the rest of the kit on with "${end}"`);
  const listed = [...KIT_SECTION.slice(at, until).matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  const notCases = listed.filter((name) => !cases.includes(name));
  assert.equal(
    notCases.length,
    0,
    `section 13's Phase 1 paragraph names something that is not a case in the record: ${notCases.join(', ')}`,
  );
  return listed;
}

/**
 * The artifact section 13 says a later pass added, read from the sentence that
 * says so.
 *
 * @returns {string[]}
 */
function toolWrittenNames() {
  const pattern = /One artifact is neither\. \*\*`([^`]+)`\*\* is/;
  const found = pattern.exec(KIT_SECTION);
  assert.notEqual(
    found,
    null,
    `SPEC.md section 13 no longer states "${pattern}" — this test reads that sentence, so it has to be told where it went`,
  );
  return [found[1]];
}

/** The record's case names, which every other count here is a count of. */
const CASES = KIT.cases.map((entry) => entry.name);

/** The 27 the paragraph lists, the 28 the table names beyond them, and the one. */
const PHASE_1 = phase1Names(CASES);
const ADVERSARIAL = adversarialRows().filter((name) => !PHASE_1.includes(name));
const TOOL_WRITTEN = toolWrittenNames();

/**
 * What a stated number is checked against: a record, a directory, or a file.
 *
 * @type {Record<string, number>}
 */
const MEASURED = Object.freeze({
  'kit artifacts': KIT_FILES.length,
  'kit recorded answers': KIT.cases.length,
  'probe artifacts': PROBE_FILES.length,
  'corpus artifacts': CORPUS_FILES.length,
  'phase 1 cases': PHASE_1.length,
  'adversarial cases': ADVERSARIAL.length,
  'tool-written artifacts': TOOL_WRITTEN.length,
  'test files': TEST_FILES.length,
  'editor page bytes': statSync(join(ROOT, 'editor', 'index.html')).size,
});

/**
 * Every count a document states about the present, and what it counts.
 *
 * `counts` names the measured values the pattern's capture groups must equal, in
 * order. A number in a pattern that is not captured is a number this file cannot
 * measure — the count of tests a run performs — and it is left to the run that
 * prints it.
 *
 * @type {{ file: string, pattern: RegExp, counts: string[] }[]}
 */
const CLAIMS = Object.freeze([
  { file: 'README.md', pattern: /replay (\d+) artifacts against (\d+) recorded answers/, counts: ['kit artifacts', 'kit recorded answers'] },
  { file: 'README.md', pattern: /npm run probe\s+# (\d+) more artifacts/, counts: ['probe artifacts'] },
  { file: 'README.md', pattern: /npm run corpus\s+# (\d+) mutated containers/, counts: ['corpus artifacts'] },
  { file: 'README.md', pattern: /npm run kit:python\s+# the same (\d+) answers/, counts: ['kit recorded answers'] },
  { file: 'README.md', pattern: /the conformance kit: an independent builder, (\d+) artifacts/, counts: ['kit artifacts'] },
  { file: 'README.md', pattern: /the differential probe: (\d+) more artifacts/, counts: ['probe artifacts'] },
  { file: 'README.md', pattern: /the same idea one level down: (\d+) hand-mutated containers/, counts: ['corpus artifacts'] },
  { file: 'README.md', pattern: /its own replay of the same (\d+) answers/, counts: ['kit recorded answers'] },
  { file: 'README.md', pattern: /(\d+) of those (\d+) artifacts are the \*\*adversarial pass\*\*/, counts: ['adversarial cases', 'kit artifacts'] },
  { file: 'README.md', pattern: /\| `test\/` \| \d+ tests in (\d+) files/, counts: ['test files'] },
  { file: 'vectors/probe/README.md', pattern: /The conformance kit is (\d+) artifacts with recorded answers/, counts: ['kit artifacts'] },
  { file: 'vectors/probe/README.md', pattern: /out\/\*\.charter\s+the (\d+) artifacts/, counts: ['probe artifacts'] },
  {
    file: 'vectors/container/README.md',
    pattern: /The conformance kit holds (\d+) artifacts and the differential probe holds (\d+) more/,
    counts: ['kit artifacts', 'probe artifacts'],
  },
  { file: 'vectors/container/README.md', pattern: /agree on (\d+) fixtures and \d+ field-level\s+cases/, counts: ['kit artifacts'] },
  { file: 'vectors/container/README.md', pattern: /out\/\*\.charter\s+the (\d+) artifacts/, counts: ['corpus artifacts'] },
  { file: 'SPEC.md', pattern: /replay the kit: (\d+) artifacts, (\d+) recorded answers/, counts: ['kit artifacts', 'kit recorded answers'] },
  { file: 'SPEC.md', pattern: /The (\d+) Phase 1 cases are the ways an artifact can be wrong/, counts: ['phase 1 cases'] },
  { file: 'SPEC.md', pattern: /The (\d+) that follow are the \*\*adversarial pass\*\*/, counts: ['adversarial cases'] },
  {
    file: 'SPEC.md',
    pattern: /The (\d+) \+ (\d+) \+ (\d+) above are the (\d+) artifacts/,
    counts: ['phase 1 cases', 'adversarial cases', 'tool-written artifacts', 'kit artifacts'],
  },
  { file: 'docs/first-user.md', pattern: /GET \/editor\/index\.html` with 200 and ([\d,]+) bytes/, counts: ['editor page bytes'] },
]);

test('each record describes the artifacts beside it', () => {
  const records = [
    { what: 'the kit', cases: KIT.cases, files: KIT_FILES },
    { what: 'the probe', cases: PROBE.cases, files: PROBE_FILES },
    { what: 'the corpus', cases: CORPUS.cases, files: CORPUS_FILES },
  ];
  for (const { what, cases, files } of records) {
    assert.equal(
      cases.length,
      files.length,
      `${what}: the record holds ${cases.length} case(s) and the directory holds ${files.length} artifact(s)`,
    );
    const recorded = cases.map((entry) => entry.file.split('/').at(-1)).sort();
    assert.deepEqual(recorded, files, `${what}: the artifacts the record names are the artifacts on disk`);
  }
});

test('every count a document states about the present is the count on disk', () => {
  for (const { file, pattern, counts } of CLAIMS) {
    const found = pattern.exec(read(file));
    assert.notEqual(
      found,
      null,
      `${file} no longer states this as ${pattern} — this test reads that sentence, so it has to be told where it went`,
    );
    const stated = found.slice(1).map((raw) => Number(String(raw).replaceAll(',', '')));
    assert.equal(stated.length, counts.length, `${file}: ${pattern} captures ${stated.length} number(s), not ${counts.length}`);
    counts.forEach((what, index) => {
      assert.equal(stated[index], MEASURED[what], `${file} states ${stated[index]} ${what}, and ${what} is ${MEASURED[what]}`);
    });
  }
});

test('every artifact in the kit is accounted for exactly once', () => {
  const accounted = [...PHASE_1, ...ADVERSARIAL, ...TOOL_WRITTEN];
  assert.equal(
    new Set(accounted).size,
    accounted.length,
    "an artifact is in two of section 13's three groups, so one of the counts that section states is not a count of anything",
  );
  assert.deepEqual(
    [...accounted].sort(),
    [...CASES].sort(),
    'the artifacts section 13 accounts for are the artifacts the record holds: a case in neither group is a case the specification does not describe',
  );
  const adversarialAt = KIT.cases.findIndex((entry) => entry.name === 'truncated-last-byte');
  assert.notEqual(adversarialAt, -1, 'the record still holds the first case of the adversarial pass');
  for (const name of PHASE_1) {
    assert.ok(
      KIT.cases.findIndex((entry) => entry.name === name) < adversarialAt,
      `${name}: section 13 calls a case Phase 1 that the builder places after the adversarial pass`,
    );
  }
  for (const name of adversarialRows()) {
    assert.ok(CASES.includes(name), `the table names ${name}, and the record holds no such case`);
  }
});

test('the README names every test file, and every name it uses is a file', () => {
  const named = [...read('README.md').matchAll(/`([a-z0-9.-]+\.test\.js)`/g)].map((match) => match[1]);
  assert.equal(new Set(named).size, named.length, 'the README names a test file twice');
  assert.deepEqual(
    [...named].sort(),
    TEST_FILES,
    'the test files the README names are the test files in test/: a file nobody names is a file nobody can find, and a name with no file is a claim about nothing',
  );
});

test('the block that states these numbers says where each kind of number comes from', () => {
  const readme = read('README.md');
  assert.ok(
    readme.includes('two kinds of number'),
    'README.md no longer says its counts come in "two kinds of number": a reader cannot tell which of them is on disk and which is printed by the run it names',
  );
  assert.ok(
    readme.includes('`test/counts.test.js` checks the first kind'),
    'README.md no longer says which of the two kinds this file checks',
  );
});