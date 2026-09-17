/**
 * The command line: the exit code is the contract.
 *
 * A script that runs `charter verify` must be able to branch on the exit code
 * alone, and a person must be able to read the same run without a decoder. Both
 * shapes are checked here, against the artifacts in the kit.
 *
 * The last three tests here read section 12 of SPEC.md as text. One holds the verbs
 * the document shows against the verbs the table further down asks about, so a verb
 * added to the command line cannot go unasked. The other two run the mapping section
 * 12 states, verb by verb: that is a different question from the one
 * `test/spec.test.js` asks of the same section, which is that file holding the *set*
 * of verbs the document shows against the set the command line dispatches, so a verb
 * with no line in the document fails. These hold what the document says each named
 * verb does with a file argument, which is a claim that can be wrong about a verb
 * that exists — and was: section 12 gave `keygen` a use of `66` for eighteen passes,
 * because `66` means a *named file could not be read* and `keygen` reads no file.
 * No count moved when that sentence was false, which is why the assertion is a
 * process run rather than a comparison of two lists.
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHECK_IDS, EXIT_CODE, VERDICT } from '../verifier/status.js';
import { CAVEATS } from '../verifier/caveats.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CLI = join(ROOT, 'cli', 'charter.js');

/**
 * A handful of real files, in a directory of its own.
 *
 * The producer's verbs refuse *before* they do any work, so reaching one of
 * their refusals means handing them something readable to refuse about: a key
 * to read, a document to read, an artifact to append to, and an output path
 * that is already taken.
 */
const WORK = mkdtempSync(join(tmpdir(), 'charter-cli-'));
after(() => rmSync(WORK, { recursive: true, force: true }));

const KEY_PATH = join(WORK, 'key.pem');
writeFileSync(KEY_PATH, generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());

const CONTENT_PATH = join(WORK, 'draft.md');
writeFileSync(CONTENT_PATH, '# A draft\n\nA document with one section.\n');

const TAKEN_PATH = join(WORK, 'already-there.charter');
writeFileSync(TAKEN_PATH, 'a file that was here first\n');

/** A path that holds nothing, which is the same on every machine. */
const MISSING_PATH = join(WORK, 'no-such-file.charter');

/** The artifact a seal writes, used as the input an edit appends to. */
const ARTIFACT_PATH = join(WORK, 'sealed.charter');
const FIXTURE_SEAL = spawnSync(
  process.execPath,
  [CLI, 'seal', CONTENT_PATH, '--key', KEY_PATH, '-o', ARTIFACT_PATH, '--author', 'Casey', '--created-at', '2026-01-01T00:00:00Z'],
  { encoding: 'utf8' },
);
if (FIXTURE_SEAL.status !== 0) throw new Error(`the fixture seal failed, so no test here can run: ${FIXTURE_SEAL.stderr}`);

/**
 * @param {string[]} args
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function charter(args) {
  const run = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { status: run.status ?? -1, stdout: run.stdout, stderr: run.stderr };
}

/**
 * @param {string} name a case name in the kit
 * @returns {string} an absolute path to the artifact
 */
function artifact(name) {
  return join(ROOT, 'vectors', 'out', `${name}.charter`);
}

/** The specification, as text: section 12 is where the exit codes are stated. */
const SPEC = readFileSync(join(ROOT, 'SPEC.md'), 'utf8');

/**
 * A level-2 section of SPEC.md, by the text of its heading.
 *
 * @param {string} heading e.g. `"12. The command line"`
 * @returns {string} the section's text, without the heading that follows it
 */
function section(heading) {
  const start = SPEC.indexOf(`\n## ${heading}\n`);
  assert.notEqual(start, -1, `SPEC.md has a section headed "${heading}"`);
  const rest = SPEC.slice(start + 1);
  const end = rest.indexOf('\n## ', 1);
  return end === -1 ? rest : rest.slice(0, end);
}

/** The number words section 12 states its two lists with. */
const NUMBER_WORDS = Object.freeze({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 });

/**
 * The verbs section 12 says each invocation-dependent code belongs to.
 *
 * Section 12's first sentence gives `verify` the five codes of a verdict, `66`
 * among them. The sentence this reads is about the two codes that "follow the
 * invocation rather than the verb", and it names the verbs twice: the four that
 * read a file named on the command line, and the three that create one. It
 * states a count before each list, so both are read here and held against each
 * other — a list that grows by one while the number stays put is the same drift
 * as a number that moves while the list stays put.
 *
 * `test/spec.test.js` holds the *set* of verbs section 12 shows against the set
 * the command line dispatches. This holds what section 12 says each of them does
 * with a file, which is the half a reader can be wrong about while the verb still
 * exists.
 *
 * @returns {{ reads: string[], writes: string[] }}
 */
function exitMapping() {
  const pattern =
    /`66` belongs to the (\w+) that read a file named on the command line — ([^—]+)— and `73` to the (\w+) that create one: ([^.]+)\./;
  const found = pattern.exec(section('12. Running it').replace(/\s+/g, ' '));
  assert.notEqual(
    found,
    null,
    `SPEC.md section 12 no longer states its per-verb exit-code mapping as "${pattern}" — this test reads that sentence, so it has to be told where it went`,
  );
  const names = (text) => [...text.matchAll(/`([a-z]+)`/g)].map((match) => match[1]);
  const reads = names(found[2]);
  const writes = names(found[4]);
  assert.equal(NUMBER_WORDS[found[1]], reads.length, `section 12 says ${found[1]} verbs read a file named on the command line and names ${reads.length}`);
  assert.equal(NUMBER_WORDS[found[3]], writes.length, `section 12 says ${found[3]} verbs create one and names ${writes.length}`);
  return { reads, writes };
}

/**
 * The verbs section 12 shows a command for, in the order they appear there.
 *
 * This reads section 12 alone rather than sharing code with the file that holds
 * the document's verbs against the dispatcher's, for the same reason the two
 * readers of `test/adversarial.md` are not one: a parser two files shared is a
 * parser neither of them checks. What this one is for is asking the *command
 * line* about the verbs a *document* shows, so that a verb given a row in the
 * table below and never shown to a reader fails rather than going unasked.
 *
 * @returns {string[]}
 */
function shownVerbs() {
  const shown = [...section('12. Running it').matchAll(/node cli\/charter\.js ([a-z]+)/g)].map((match) => match[1]);
  return [...new Set(shown)];
}

/**
 * Every verb, asked the two questions section 12 answers, from one table.
 *
 * `missing` names a file the verb reads that is not there; `taken` names an
 * output the verb would create that already is. Both are built from the fixtures
 * above, and the keys of this table are held against the verbs section 12 names
 * in both directions, so a verb added to the command line without a line here
 * fails rather than going unasked.
 */
const VERB_CALLS = Object.freeze({
  verify: {
    missing: () => ['verify', MISSING_PATH],
    taken: () => ['verify', artifact('valid'), '-o', TAKEN_PATH],
  },
  seal: {
    missing: () => ['seal', MISSING_PATH, '--key', KEY_PATH, '-o', join(WORK, 'unwritten-seal.charter')],
    taken: () => ['seal', CONTENT_PATH, '--key', KEY_PATH, '-o', TAKEN_PATH],
  },
  edit: {
    missing: () => ['edit', MISSING_PATH, CONTENT_PATH, '--key', KEY_PATH, '-o', join(WORK, 'unwritten-edit.charter')],
    taken: () => ['edit', ARTIFACT_PATH, CONTENT_PATH, '--key', KEY_PATH, '-o', TAKEN_PATH],
  },
  inspect: {
    missing: () => ['inspect', MISSING_PATH],
    taken: () => ['inspect', artifact('valid'), '-o', TAKEN_PATH],
  },
  cite: {
    missing: () => ['cite', MISSING_PATH],
    taken: () => ['cite', artifact('valid'), '-o', TAKEN_PATH],
  },
  // keygen reads no file: the one path it acts on is the one it writes.
  keygen: {
    missing: () => ['keygen', '-o', join(WORK, 'keygen-nothing-was-here.pem')],
    taken: () => ['keygen', '-o', TAKEN_PATH],
  },
});

test('a verified artifact exits 0 and says so as JSON', () => {
  const run = charter(['verify', artifact('valid'), '--json']);
  assert.equal(run.status, EXIT_CODE.VERIFIED);
  const report = JSON.parse(run.stdout);
  assert.equal(report.verdict, VERDICT.VERIFIED);
  assert.equal(report.exit_code, 0);
  assert.equal(report.bytes, statSync(artifact('valid')).size);
  assert.deepEqual(report.checks.map((check) => check.id), [...CHECK_IDS]);
  assert.equal(report.checks.every((check) => check.status === 'PASS'), true);
});

test('a broken artifact exits 2, and an unproven one exits 1', () => {
  for (const [name, code, verdict] of [
    ['entry-edited', EXIT_CODE.BROKEN, VERDICT.BROKEN],
    ['not-a-zip', EXIT_CODE.BROKEN, VERDICT.BROKEN],
    ['unsupported-format', EXIT_CODE.INCOMPLETE, VERDICT.INCOMPLETE],
    // A method this verifier does not implement is a gap in the verifier, not a
    // defect in the file: nothing is proven false, so this exits 1 rather than 2.
    ['unreadable-manifest', EXIT_CODE.INCOMPLETE, VERDICT.INCOMPLETE],
  ]) {
    const run = charter(['verify', artifact(name), '--json']);
    assert.equal(run.status, code, `${name}: exit code`);
    assert.equal(JSON.parse(run.stdout).verdict, verdict, `${name}: verdict`);
  }
});

test('the report a person reads names the verdict, the artifact, and the boundary', () => {
  const run = charter(['verify', artifact('valid')]);
  assert.equal(run.status, EXIT_CODE.VERIFIED);
  assert.match(run.stdout, /VERIFIED/);
  assert.match(run.stdout, new RegExp(`all ${CHECK_IDS.length} checks passed`));
  for (const caveat of CAVEATS) {
    assert.ok(run.stdout.includes(caveat.id), `the limitations must travel with the verdict: ${caveat.id}`);
  }
  assert.ok(!run.stdout.includes('L0.'), 'a passing run does not make the reader read thirty check ids');
});

test('a run that did not pass names every check that did not pass', () => {
  const run = charter(['verify', artifact('entry-edited')]);
  assert.equal(run.status, EXIT_CODE.BROKEN);
  assert.match(run.stdout, /BROKEN/);
  assert.ok(run.stdout.includes('L1.PROVENANCE.SIGNATURES'), 'the failing check must be named');
  assert.ok(run.stdout.includes('L2.CHAIN.LINKS'), 'every failing check must be named');
  assert.ok(!run.stdout.includes('L0.ZIP.READABLE'), 'checks that passed are not listed unless --all is given');
});

test('--all lists every registered check and no other', () => {
  const run = charter(['verify', artifact('valid'), '--all']);
  assert.equal(run.status, EXIT_CODE.VERIFIED);
  for (const id of CHECK_IDS) {
    assert.ok(run.stdout.includes(id), `--all must list ${id}`);
  }
  const listed = run.stdout.match(/L\d\.[A-Z0-9_.]+/g) ?? [];
  for (const id of listed) {
    assert.ok(CHECK_IDS.includes(id), `${id} is not a registered check`);
  }
});

test('the command line refuses what it cannot act on', () => {
  const noArguments = charter([]);
  assert.equal(noArguments.status, 64);
  assert.match(noArguments.stdout, /Usage:/);

  const noFile = charter(['verify']);
  assert.equal(noFile.status, 64);
  assert.match(noFile.stderr, /no file was named/);

  const unknownCommand = charter(['frobnicate']);
  assert.equal(unknownCommand.status, 64);
  assert.match(unknownCommand.stderr, /unknown command/);

  const unknownOption = charter(['verify', artifact('valid'), '--deep']);
  assert.equal(unknownOption.status, 64);
  assert.match(unknownOption.stderr, /unknown option/);

  const twoFiles = charter(['verify', artifact('valid'), artifact('valid-deflate')]);
  assert.equal(twoFiles.status, 64);
  assert.match(twoFiles.stderr, /only one file/);
});

test('a file that cannot be read is not a broken artifact', () => {
  const run = charter(['verify', join(ROOT, 'vectors', 'out', 'no-such-file.charter')]);
  assert.equal(run.status, 66);
  assert.match(run.stderr, /could not be read/);
  assert.equal(run.stdout, '', 'nothing is claimed about a file that was never read');
});

test('every verb section 12 shows is a verb this file asks about, and no other', () => {
  assert.deepEqual(
    Object.keys(VERB_CALLS).sort(),
    shownVerbs().sort(),
    'the verbs section 12 shows are the verbs the table above asks: a verb added to the command line and given no row there would be asked nothing, and a row for a verb no document shows is a question about nothing',
  );
});

test('the verbs section 12 gives `66` are the verbs that exit 66 for a file they cannot read', () => {
  const { reads } = exitMapping();
  const flat = section('12. Running it').replace(/\s+/g, ' ');
  assert.match(
    flat,
    /Exit codes are five for `verify`, and they are the codes of a verdict: `0` VERIFIED, `1` INCOMPLETE, `2` BROKEN, `64` the command line was not understood, `66` the named file could not be read\./,
    'section 12 no longer gives `verify` the five codes of a verdict, `66` among them; this test reads that sentence, so it has to be told where it went',
  );
  // The four the mapping names, plus `verify` from the sentence just read: those
  // five are the verbs a path that holds nothing exits 66 for.
  const readsAFile = new Set(['verify', ...reads]);
  for (const [verb, calls] of Object.entries(VERB_CALLS)) {
    const run = charter(calls.missing());
    if (readsAFile.has(verb)) {
      assert.equal(run.status, 66, `${verb} reads a file named on the command line, so a path that holds nothing is 66 and not ${run.status}`);
      assert.match(run.stderr, /could not be read/);
    } else {
      assert.notEqual(
        run.status,
        66,
        `section 12 does not give ${verb} the code for a file that could not be read, and ${verb} exited 66`,
      );
    }
  }
});

test('the verbs section 12 says create a file are the verbs that exit 73 when it is taken', () => {
  const { writes } = exitMapping();
  for (const [verb, calls] of Object.entries(VERB_CALLS)) {
    const run = charter(calls.taken());
    if (writes.includes(verb)) {
      assert.equal(run.status, 73, `${verb} creates a file, so an output path that is already taken is 73 and not ${run.status}`);
    } else {
      assert.notEqual(
        run.status,
        73,
        `section 12 does not give ${verb} the code for an output it could not create, and ${verb} exited 73`,
      );
    }
  }
});
