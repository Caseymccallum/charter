/**
 * The adversarial table, replayed.
 *
 * `test/adversarial.md` states, for each way a `.charter` file can be made to
 * lie, the verdict the specification says it must produce. This file is what
 * makes that statement a claim rather than a paragraph: every row names a
 * fixture in `vectors/out/`, and the row fails unless the verifier produces the
 * verdict, the reason codes, and the findings the row states.
 *
 * The division of labour between this file and the kit is deliberate.
 * `vectors/expected.json` is the author's record and holds the checks that were
 * never reached; this file is the reader's cross-check of the record against the
 * specification in prose. A row that agrees with itself in both places is worth
 * more than either alone.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CAVEATS } from '../verifier/caveats.js';
import { EXIT_CODE, VERDICT } from '../verifier/status.js';
import { verify } from '../verifier/verify.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const TABLE = join(HERE, 'adversarial.md');
const KIT = join(ROOT, 'vectors');
const RECORD = JSON.parse(readFileSync(join(KIT, 'expected.json'), 'utf8'));

/** The caveat that must travel with the re-signing case. */
const REWRITE_CAVEAT = 'KEY_HOLDER_CAN_REWRITE_HISTORY';

/**
 * @typedef {Object} Row
 * @property {string} name
 * @property {string} mutation
 * @property {string} status
 * @property {string} reason
 * @property {string} actual
 * @property {string} pass
 */

/**
 * Read the table out of the document, so the document is the source of truth.
 *
 * @returns {{ rows: Row[], totals: { cases: number, pass: number, fail: number } }}
 */
function readTable() {
  const text = readFileSync(TABLE, 'utf8');
  /** @type {Row[]} */
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('| ')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 6) continue;
    if (cells[0] === 'Case' || /^-+$/.test(cells[0])) continue;
    rows.push({ name: cells[0], mutation: cells[1], status: cells[2], reason: cells[3], actual: cells[4], pass: cells[5] });
  }
  const totals = /^Totals: (\d+) cases, (\d+) pass, (\d+) fail\.$/m.exec(text);
  assert.ok(totals !== null, 'the table must state its totals on one line: "Totals: N cases, N pass, N fail."');
  return {
    rows,
    totals: { cases: Number(totals[1]), pass: Number(totals[2]), fail: Number(totals[3]) },
  };
}

/**
 * What a verdict found, written the way the table writes it: the failing checks
 * as `ID=REASON_CODE` in registry order, and any check this verifier could not
 * perform after them, because a thing that was never established is not a pass.
 *
 * @param {{ checks: import('../verifier/status.js').CheckResult[] }} result
 * @returns {string}
 */
function findings(result) {
  const failed = result.checks.filter((check) => check.status === 'FAIL').map((check) => `${check.id}=${check.reason_code}`);
  const unsupported = result.checks
    .filter((check) => check.status === 'UNSUPPORTED')
    .map((check) => `${check.id}=${check.reason_code}`);
  const parts = failed.length === 0 ? [] : [failed.join(', ')];
  if (unsupported.length > 0) parts.push(`unsupported: ${unsupported.join(', ')}`);
  return parts.length === 0 ? '-' : parts.join(' | ');
}

/**
 * @param {string} name
 * @returns {Uint8Array}
 */
function fixture(name) {
  return new Uint8Array(readFileSync(join(KIT, 'out', `${name}.charter`)));
}

const TABLE_TEXT = readTable();


test('every row of the adversarial table is a committed fixture with the verdict it states', async () => {
  const names = new Set(RECORD.cases.map((entry) => entry.name));
  for (const row of TABLE_TEXT.rows) {
    assert.ok(names.has(row.name), `${row.name}: the table names a case the kit does not hold`);
    const result = await verify(fixture(row.name));
    const found = findings(result);
    assert.equal(result.verdict, row.status, `${row.name}: the table says ${row.status}, the verifier says ${result.verdict}`);
    assert.equal(found, row.reason, `${row.name}: the table says "${row.reason}", the verifier found "${found}"`);
    assert.equal(row.actual, row.reason, `${row.name}: the recorded Actual column disagrees with the Expected column`);
    assert.equal(row.pass, 'pass', `${row.name}: the recorded Pass column is not "pass"`);
  }
});

test('the table counts what it holds', () => {
  const { rows, totals } = TABLE_TEXT;
  const passing = rows.filter((row) => row.pass === 'pass').length;
  assert.equal(totals.cases, rows.length, 'the totals line counts the rows');
  assert.equal(totals.pass, passing, 'the totals line counts the passing rows');
  assert.equal(totals.fail, rows.length - passing, 'the totals line counts the failing rows');
  assert.ok(rows.length >= 29, `the table is the adversarial pass, not a sample: ${rows.length} row(s)`);
});

test('no truncation of a valid artifact is ever accepted', async () => {
  const original = fixture('valid');
  /** @type {string[]} */
  const accepted = [];
  for (let keep = original.length - 1; keep >= original.length - 512 && keep >= 0; keep -= 1) {
    const result = await verify(original.subarray(0, keep));
    if (result.verdict === VERDICT.VERIFIED) accepted.push(`${keep} bytes`);
    else assert.notEqual(findings(result), '-', `a file of ${keep} bytes is not VERIFIED and found nothing`);
  }
  assert.deepEqual(accepted, [], `a prefix of a valid file was accepted: ${accepted.join(', ')}`);
});

test('the key holder rewriting the whole log is VERIFIED, with the caveat printed', async () => {
  const result = await verify(fixture('history-rewritten'));
  assert.equal(result.verdict, VERDICT.VERIFIED, 'rewriting and re-signing everything is not detectable, and the spec says so');
  assert.equal(result.exit_code, 0);
  assert.equal(result.summary.fail + result.summary.unsupported + result.summary.skip, 0, 'and no check was left unproven');
  const caveat = result.limitations.find((limitation) => limitation.id === REWRITE_CAVEAT);
  assert.ok(caveat !== undefined, `${REWRITE_CAVEAT} must travel with the verdict`);
  assert.match(caveat.statement, /re-sign/, 'the caveat must say what the gap is');

  // And it has to travel as far as a person, not only as far as a data structure.
  const run = spawnSync(process.execPath, [join(ROOT, 'cli', 'charter.js'), 'verify', join(KIT, 'out', 'history-rewritten.charter')], {
    encoding: 'utf8',
  });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /VERIFIED/);
  assert.ok(run.stdout.includes(REWRITE_CAVEAT), 'the human report must print the caveat that qualifies the verdict');
});

test('a rewritten log and a freshly written one are the same bytes to this verifier, and the caveats say so', async () => {
  // The strongest statement of the gap: an artifact whose history was rewritten
  // end to end is indistinguishable from one that was written that way. Both are
  // VERIFIED, check for check, and both carry the same caveats.
  const rewritten = await verify(fixture('history-rewritten'));
  const written = await verify(fixture('valid'));
  assert.equal(rewritten.verdict, written.verdict);
  assert.deepEqual(
    rewritten.checks.map((check) => check.status),
    written.checks.map((check) => check.status),
  );
  assert.deepEqual(
    rewritten.limitations.map((limitation) => limitation.id),
    CAVEATS.map((limitation) => limitation.id),
  );
});
