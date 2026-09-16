/**
 * The command line: the exit code is the contract.
 *
 * A script that runs `charter verify` must be able to branch on the exit code
 * alone, and a person must be able to read the same run without a decoder. Both
 * shapes are checked here, against the artifacts in the kit.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHECK_IDS, EXIT_CODE, VERDICT } from '../verifier/status.js';
import { CAVEATS } from '../verifier/caveats.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CLI = join(ROOT, 'cli', 'charter.js');

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
