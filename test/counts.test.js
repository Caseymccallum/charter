/**
 * The numbers these documents state about the present, read back off the disk.
 *
 * Every count in this project's prose — 56 artifacts, 28 adversarial cases, 27
 * Phase 1 cases, 37 rows in the adversarial table, one artifact a tool wrote, 18
 * test files — is a claim, and until
 * this file existed nothing checked one. The cost of that showed up twice in one
 * pass. `README.md` said "148 tests" for a suite that had run 166 since `edit`
 * landed, and `SPEC.md` section 13's accounting of the kit that the same section
 * tells a reader to replay summed to 54 of its 56 artifacts: the ceiling case
 * moved the Phase 1 count to 27, and `produced-two-entries` was in no group at
 * all. Both were numbers nobody had read back.
 *
 * The first version of this file then made the same mistake in a smaller way, and
 * the mistake is worth naming because it is the reason the last rule below exists.
 * It stated its rule over "this project's prose" and then read five documents:
 * `README.md`, `SPEC.md`, `docs/first-user.md`, and the two kit READMEs. Three
 * documents that state counts about the present were read by nothing —
 * `editor/README.md` ("all 56 artifacts in the conformance kit"),
 * `implementations/python/README.md` (five counts, including the kit's and the
 * probe's) and `test/adversarial.md` ("Totals: 37 cases"). The set of documents
 * the rule applied to was never enumerated, so nothing could notice what it had
 * left out; a rule about *what* to check is not complete until it says *where*.
 *
 * Four rules decide what belongs here.
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
 * 4. **The set of documents the rules apply to is itself checked.** Rules 1 to 3
 *    say which numbers to check and how; none of them says where to look, and a
 *    reading list that can only grow by somebody remembering to add to it leaves
 *    everything else unread in silence. So every Markdown document in this
 *    repository is discovered from the directory tree, and each one is either a
 *    document a claim above reads or one of the two named in `NOT_READ` with its
 *    reason. A document that is neither is a finding, and that is the check that
 *    would have caught the three this file left out.
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

import { REGISTRY } from './declarations.js';

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
 * The class each row of the audit's own table ends in.
 *
 * `docs/spec-declarations.md` is the document that asked what holds each
 * declaration to the document, and its own totals are the kind of number this
 * file exists to read back: how many list-shaped claims there are, how many a
 * test holds, and how many nothing does. The last cell of each row is the
 * classification, so the table can be counted without a second copy of it here.
 *
 * A row is `**none**` when nothing reads the document for that claim, and
 * `not applicable` when there is no code copy to hold the document to. Anything
 * else names a test, and a named test is a claim held.
 *
 * @returns {string[]} the last cell of every row, in the table's order
 */
function declarationRows() {
  /** @type {string[]} */
  const rows = [];
  for (const line of read('docs', 'spec-declarations.md').split('\n')) {
    if (!line.startsWith('| ')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 6) continue;
    if (cells[0] === '#' || /^-+$/.test(cells[0])) continue;
    rows.push(cells[5]);
  }
  return rows;
}

/** The audit's rows, and what each of them ends in. */
const DECLARATIONS = declarationRows();
const NO_CODE_COPY = DECLARATIONS.filter((cell) => cell === 'not applicable').length;
const UNHELD = DECLARATIONS.filter((cell) => cell.startsWith('**none**')).length;

/**
 * What a stated number is checked against: a record, a directory, a file, or
 * the table of a document.
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
  'adversarial rows': adversarialRows().length,
  'tool-written artifacts': TOOL_WRITTEN.length,
  'test files': TEST_FILES.length,
  'editor page bytes': statSync(join(ROOT, 'editor', 'index.html')).size,
  'declarations audited': DECLARATIONS.length,
  'declarations held': DECLARATIONS.length - NO_CODE_COPY - UNHELD,
  'declarations unheld': UNHELD,
  'declarations with no code copy': NO_CODE_COPY,
  'declarations registered': REGISTRY.length,
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
  { file: 'editor/README.md', pattern: /asks it for all (\d+) artifacts in the conformance kit/, counts: ['kit artifacts'] },
  { file: 'test/adversarial.md', pattern: /Totals: (\d+) cases, \d+ pass, \d+ fail/, counts: ['adversarial rows'] },
  { file: 'implementations/python/README.md', pattern: /the probe's record the same (\d+) questions/, counts: ['probe artifacts'] },
  { file: 'implementations/python/README.md', pattern: /asks them about (\d+) hand-mutated containers/, counts: ['corpus artifacts'] },
  { file: 'implementations/python/README.md', pattern: /\*\*(\d+) fixtures, \d+ matched exactly\.\*\*/, counts: ['kit recorded answers'] },
  { file: 'implementations/python/README.md', pattern: /reference CLI's output for all (\d+) fixtures/, counts: ['kit recorded answers'] },
  { file: 'implementations/python/README.md', pattern: /and (\d+) hand-built artifacts that the kit does not/, counts: ['probe artifacts'] },
  {
    file: 'README.md',
    pattern: /(\d+) claims, (\d+) held, (\d+) held by nothing/,
    counts: ['declarations audited', 'declarations held', 'declarations unheld'],
  },
  {
    file: 'docs/spec-declarations.md',
    pattern: /List-shaped claims in `SPEC\.md` \| \*\*(\d+)\*\*/,
    counts: ['declarations audited'],
  },
  {
    file: 'docs/spec-declarations.md',
    pattern: /with a code copy, held to the document by a test \| \*\*(\d+)\*\*/,
    counts: ['declarations held'],
  },
  {
    file: 'docs/spec-declarations.md',
    pattern: /with a code copy, held by nothing \| \*\*(\d+)\*\*/,
    counts: ['declarations unheld'],
  },
  {
    file: 'docs/spec-declarations.md',
    pattern: /with no code copy at all \| \*\*(\d+)\*\*/,
    counts: ['declarations with no code copy'],
  },
  {
    // The announcement is read like any other document here, because it makes
    // the same kind of claim: a number about the present, in prose, addressed to
    // a stranger who has no way to check it. It is also the document whose
    // argument is that these numbers can be checked by anyone, so leaving its own
    // numbers unchecked would be the one thing it must not do.
    file: 'docs/announcing-charter.md',
    pattern: /a kit of (\d+) artifacts with (\d+) recorded answers, (\d+) hand-built cases,\s+and (\d+) deliberately corrupted containers/,
    counts: ['kit artifacts', 'kit recorded answers', 'probe artifacts', 'corpus artifacts'],
  },
  {
    file: 'docs/announcing-charter.md',
    pattern: /a registry of (\d+) declarations/,
    counts: ['declarations registered'],
  },
]);

/**
 * Every Markdown document in this repository, discovered from the tree rather
 * than listed here.
 *
 * Discovery is the point: a list written by hand is a list that can forget, and
 * the three documents this file used to leave out were left out by exactly that
 * mechanism. `node_modules/` and `.git/` are skipped because neither is a
 * document this project writes — the first is not checked in and the second is
 * not prose. Paths are normalized to `/` so that the same names come out on
 * Windows and on a POSIX machine.
 *
 * @type {string[]}
 */
const DOCUMENTS = readdirSync(ROOT, { recursive: true })
  .map((entry) => String(entry).replaceAll('\\', '/'))
  .filter((path) => path.endsWith('.md') && !path.startsWith('node_modules/') && !path.startsWith('.git/'))
  .sort();

/**
 * The documents this file reads no count out of, and why each is not one.
 *
 * Both are here for one reason, which is that a count about the present is what
 * this file checks and neither states one. An entry has to give a reason rather
 * than just a name: "not read" is the thing that went unnoticed for three
 * documents, and a name without a reason is how it would go unnoticed again.
 *
 * @type {Record<string, string>}
 */
const NOT_READ = Object.freeze({
  'CHANGELOG.md':
    'a record of what was true when a pass closed: a count inside it is history, and rewriting one to match today would falsify the record rather than check it',
  'NAMING.md':
    'a naming convention, which argues about what a name should be and states no count about the tree at all',
  'docs/first-visitor.md':
    'an audit of what a stranger arriving from the announcement meets: it quotes the README, names where each sentence sits by line, and states no count about the tree at all',
});

/** The documents a claim above reads a count out of, which rule 4 is stated over. */
const READ = Object.freeze([...new Set(CLAIMS.map((claim) => claim.file))].sort());

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

/**
 * Rule 4, which is the rule this file exists in its present form for.
 *
 * Rules 1 to 3 say which numbers to check and how, and a rule about *what* is not
 * complete until it says *where*: the first version read five documents, and the
 * three it left out stated counts that nothing checked. The remedy was to discover
 * the documents from the tree and name the exempt ones with a reason, and that
 * remedy sat here as two declarations — `DOCUMENTS` and `NOT_READ` — that no test
 * consumed. So the rule was prose for a pass: a new document could have been added
 * with a count in it and the suite would have stayed green while reading none of it.
 *
 * The data was right when the check was finally written, and the check passed on its
 * first run, which is the point worth keeping: what was missing was the assertion,
 * not the list. A rule that nothing runs is not a rule, and this is the file whose
 * business that is — `test/spec.test.js` states the same thing from the other side
 * ("a rule that no check enforces is not a rule").
 */
test('every document is either read for a count or named as one that states none', () => {
  const exempt = Object.keys(NOT_READ);
  for (const file of READ) {
    assert.ok(
      DOCUMENTS.includes(file),
      `${file} is named as a document a claim reads a count out of, and there is no such Markdown document in this repository`,
    );
  }
  assert.deepEqual(
    [...READ, ...exempt].sort(),
    DOCUMENTS,
    'the documents this file reads a count out of, plus the ones it says state none, are not the Markdown documents this repository holds: a document in neither list is read by nothing, which is how the three this file left out went unnoticed',
  );
  const both = READ.filter((file) => exempt.includes(file));
  assert.deepEqual(
    both,
    [],
    `a document is read for a count and excused from being read at the same time: ${both.join(', ')} — the reason beside it is not a reason`,
  );
  for (const [file, reason] of Object.entries(NOT_READ)) {
    assert.ok(
      typeof reason === 'string' && reason.includes(' ') && reason.length >= 40,
      `${file} is excused from these rules with "${reason}", and an excuse has to give a reason rather than a name: "not read" is the thing that went unnoticed for three documents`,
    );
  }
});
