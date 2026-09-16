/**
 * The report builder and the verdict rule.
 *
 * The properties under test are the ones the format's meaning rests on:
 * every check appears exactly once, a check that never ran is never a pass,
 * and an unrecognised thing is never a pass.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Reporter, resolve } from '../verifier/result.js';
import { CHECK_IDS, CHECK_REGISTRY, EXIT_CODE, LEVEL, REASON, STATUS, VERDICT } from '../verifier/status.js';
import { CAVEATS } from '../verifier/caveats.js';

test('the status vocabulary has exactly four values, and no pass-with-warnings', () => {
  assert.deepEqual(Object.values(STATUS).sort(), ['FAIL', 'PASS', 'SKIP', 'UNSUPPORTED']);
  assert.deepEqual(Object.values(VERDICT).sort(), ['BROKEN', 'INCOMPLETE', 'VERIFIED']);
  assert.deepEqual(EXIT_CODE, { VERIFIED: 0, INCOMPLETE: 1, BROKEN: 2 });
  assert.deepEqual(Object.values(LEVEL).sort(), ['L0', 'L1', 'L2']);
});

test('the check registry is well formed', () => {
  const ids = CHECK_REGISTRY.map((check) => check.id);
  assert.equal(new Set(ids).size, ids.length, 'check ids are unique');
  assert.deepEqual(ids, [...CHECK_IDS], 'CHECK_IDS is the registry in order');
  assert.ok(ids.length > 0);
  for (const check of CHECK_REGISTRY) {
    assert.ok(Object.values(LEVEL).includes(check.level), `${check.id} has a declared level`);
    assert.equal(typeof check.requirement, 'string');
    assert.ok(check.requirement.length > 0, `${check.id} states what it requires`);
  }
});

test('the reporter refuses anything it was not told to expect', () => {
  const reporter = new Reporter();
  assert.throws(() => reporter.set('L0.NOT.A.CHECK', STATUS.PASS, REASON.OK, 'detail'), TypeError);
  assert.throws(() => reporter.set('L0.ZIP.READABLE', 'MAYBE', REASON.OK, 'detail'), TypeError);
  assert.throws(() => reporter.set('L0.ZIP.READABLE', STATUS.PASS, 'PROBABLY', 'detail'), TypeError);
  assert.throws(() => reporter.set('L0.ZIP.READABLE', STATUS.PASS, REASON.OK, ''), TypeError);
  reporter.pass('L0.ZIP.READABLE', 'the container was read');
  assert.throws(() => reporter.pass('L0.ZIP.READABLE', 'again'), TypeError, 'a check may not be reported twice');
});

test('a verdict with a check that never ran does not exist', () => {
  const reporter = new Reporter();
  reporter.pass('L0.ZIP.READABLE', 'the container was read');
  assert.throws(() => reporter.all(), /no result recorded/);
});

test('skipUnset reaches exactly the unset checks with the given prefix', () => {
  const reporter = new Reporter();
  const skipped = reporter.skipUnset('L0.MANIFEST.', 'the manifest could not be read');
  assert.deepEqual(skipped, [
    'L0.MANIFEST.PARSE',
    'L0.MANIFEST.CANONICAL',
    'L0.MANIFEST.FIELDS',
    'L0.MANIFEST.EXTRA_FIELDS',
  ]);
  assert.equal(reporter.statusOf('L0.ZIP.READABLE'), null);
  assert.equal(reporter.statusOf('L0.MANIFEST.PARSE'), STATUS.SKIP);
  assert.equal(reporter.skipUnset('L0.MANIFEST.').length, 0);
  assert.equal(reporter.passed('L0.MANIFEST.PARSE'), false, 'a skipped check has not passed');
});

test('the verdict follows from the four statuses, and only a full pass is VERIFIED', () => {
  const all = CHECK_IDS.map((id) => ({ id, status: STATUS.PASS }));
  assert.deepEqual(resolve(all), {
    verdict: VERDICT.VERIFIED,
    exit_code: 0,
    summary: { pass: all.length, fail: 0, unsupported: 0, skip: 0, total: all.length },
  });

  const oneSkip = [{ status: STATUS.PASS }, { status: STATUS.SKIP }];
  assert.equal(resolve(oneSkip).verdict, VERDICT.INCOMPLETE);
  assert.equal(resolve(oneSkip).exit_code, 1);

  const oneUnsupported = [{ status: STATUS.PASS }, { status: STATUS.UNSUPPORTED }];
  assert.equal(resolve(oneUnsupported).verdict, VERDICT.INCOMPLETE);

  const oneFail = [{ status: STATUS.PASS }, { status: STATUS.FAIL }, { status: STATUS.SKIP }];
  assert.equal(resolve(oneFail).verdict, VERDICT.BROKEN);
  assert.equal(resolve(oneFail).exit_code, 2, 'a failure outranks everything else');

  assert.equal(resolve([]).verdict, VERDICT.INCOMPLETE, 'a check that never ran is not a check that passed');
});

test('every caveat is named, stated, and none of them is a check', () => {
  const ids = CAVEATS.map((caveat) => caveat.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length > 0);
  for (const caveat of CAVEATS) {
    assert.ok(caveat.statement.length > 0);
    assert.equal(CHECK_IDS.includes(caveat.id), false, 'a limitation must not be able to affect the exit code');
  }
});
