#!/usr/bin/env node
/**
 * The container corpus: two implementations, one artifact at a time.
 *
 * `tools/corpus.py` is the author's program: it mutates `vectors/out/valid.charter`
 * one structure at a time, asks both implementations what they make of each
 * artifact, and records both answers. This is the reader's program. It builds
 * nothing and knows nothing about how the artifacts were made: it reads
 * `expected.json`, reads each `.charter` file the record names, asks both
 * implementations the same question, and reports where an answer is not the one
 * the record carries.
 *
 *   - the reference command line (`node cli/charter.js verify <file> --json`),
 *     taken as a black box;
 *   - the Python implementation (`python -m charter_verify <file> --json`),
 *     written from the specification by a reader who did not read `verifier/**`;
 *   - and the record, which says what each of them said.
 *
 * # A recorded disagreement is a finding, not a failure
 *
 * Each case carries its own answer for each implementation, so this replay fails
 * when an implementation has *moved* — when a case that agreed now disagrees, or
 * a recorded disagreement changed hands — and it reports a case whose record says
 * the two disagree as a finding rather than as a failure. That is what the corpus
 * is: a finding tool first. The first run of these 26 cases produced eleven
 * disagreements, every one of them was settled in SPEC.md section 3 and then
 * fixed in whichever implementation was wrong, and the record keeps both answers
 * so that a later reader can see what changed.
 *
 * The comparison is the one the conformance kit makes: the verdict, the exit
 * code, the failing checks with their reason codes, the unsupported checks with
 * theirs, and the number of checks that were never reached. Prose is not
 * compared. Each artifact's length and SHA-256 are checked first, so "this file
 * is not the one the record describes" and "this answer is wrong" stay two
 * different claims.
 *
 * # One runtime may be missing, and that is not a failure
 *
 * The reference leg needs Node — which is running this file — and the Python leg
 * needs an interpreter. A machine without one skips that leg, says so, and still
 * exits 0.
 *
 * Usage: node vectors/container/run.js
 *
 * @module vectors/container/run
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const RECORD_PATH = join(HERE, 'expected.json');

/**
 * @param {Uint8Array} bytes
 * @returns {string} lowercase hex SHA-256
 */
function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * The five things a verdict is compared by.
 *
 * @param {{ verdict: string, exit_code: number, checks: import('../../verifier/status.js').CheckResult[] }} answer
 * @returns {{ verdict: string, exit_code: number, fail: Record<string, string>, unsupported: Record<string, string>, skips: number }}
 */
function tally(answer) {
  /** @type {Record<string, string>} */
  const fail = {};
  /** @type {Record<string, string>} */
  const unsupported = {};
  let skips = 0;
  for (const check of answer.checks) {
    if (check.status === 'FAIL') fail[check.id] = check.reason_code;
    else if (check.status === 'UNSUPPORTED') unsupported[check.id] = check.reason_code;
    else if (check.status === 'SKIP') skips += 1;
  }
  return { verdict: answer.verdict, exit_code: answer.exit_code, fail, unsupported, skips };
}

/**
 * Run one implementation over one file and read its JSON.
 *
 * @param {string[]} command
 * @param {string} cwd
 * @param {string} file
 * @returns {{ ok: true, answer: object } | { ok: false, detail: string }}
 */
function ask(command, cwd, file) {
  const completed = spawnSync(command[0], [...command.slice(1), file, '--json'], { cwd, encoding: 'utf8' });
  if (completed.error !== undefined) return { ok: false, detail: String(completed.error.message ?? completed.error) };
  if (![0, 1, 2].includes(completed.status ?? -1)) {
    return { ok: false, detail: `exited ${completed.status}: ${String(completed.stderr).trim().slice(0, 200)}` };
  }
  try {
    return { ok: true, answer: JSON.parse(String(completed.stdout)) };
  } catch {
    return { ok: false, detail: `printed no JSON: ${String(completed.stdout).slice(0, 120)}` };
  }
}

/**
 * The Python interpreter this machine has, or null.
 *
 * @returns {string | null}
 */
function findPython() {
  for (const candidate of ['python', 'python3', 'py']) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (probe.status === 0) return candidate;
  }
  return null;
}

/**
 * Where one answer differs from what it is compared with.
 *
 * @param {string} name
 * @param {string} leg
 * @param {object} seen
 * @param {object} stated
 * @returns {string[]}
 */
function differences(name, leg, seen, stated) {
  /** @type {string[]} */
  const problems = [];
  if (seen.verdict !== stated.verdict) problems.push(`${name}: ${leg} says ${seen.verdict}, and the record says ${stated.verdict}`);
  if (seen.exit_code !== stated.exit_code) problems.push(`${name}: ${leg} exits ${seen.exit_code}, and the record says ${stated.exit_code}`);
  for (const [what, seenMap, statedMap] of [
    ['failing', seen.fail, stated.fail],
    ['unsupported', seen.unsupported, stated.unsupported],
  ]) {
    for (const [id, code] of Object.entries(statedMap)) {
      if (seenMap[id] === undefined) problems.push(`${name}: ${leg} does not report ${id}, and the record says it is a ${what} check with ${code}`);
      else if (seenMap[id] !== code) problems.push(`${name}: ${leg} reports ${id}=${seenMap[id]}, and the record says ${what} ${code}`);
    }
    for (const id of Object.keys(seenMap)) {
      if (statedMap[id] === undefined) problems.push(`${name}: ${leg} reports ${id}=${seenMap[id]}, and the record does not`);
    }
  }
  if (seen.skips !== stated.skips) problems.push(`${name}: ${leg} leaves ${seen.skips} check(s) unreached, and the record says ${stated.skips}`);
  return problems;
}


/**
 * The five things, as one short line, for the per-case report.
 *
 * @param {object} answer
 * @returns {string}
 */
function describe(answer) {
  return `${answer.verdict.padEnd(11)} skip=${String(answer.skips).padEnd(2)}`;
}

/** @returns {number} the exit code */
function main() {
  /** @type {any} */
  let record;
  try {
    record = JSON.parse(readFileSync(RECORD_PATH, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    console.error(`vectors/container/run.js: ${RECORD_PATH} could not be read (${detail})`);
    console.error('Build the corpus first: python implementations/python/tools/corpus.py --build');
    return 1;
  }

  const python = findPython();
  console.log(
    python === null
      ? 'the Python leg is skipped: no interpreter was found (tried python, python3, py). The reference leg still runs, and every answer is still compared with the record.'
      : `the Python leg runs ${python} -m charter_verify`,
  );
  console.log('');

  /** @type {string[]} */
  const problems = [];
  let widest = 0;
  for (const entry of record.cases) widest = Math.max(widest, String(entry.name).length);
  let recorded = 0;

  for (const entry of record.cases) {
    const name = String(entry.name);
    const file = join(HERE, String(entry.file));
    /** @type {Buffer} */
    let bytes;
    try {
      bytes = readFileSync(file);
    } catch (error) {
      problems.push(`${name}: ${entry.file} could not be read (${error instanceof Error ? error.message : 'unknown error'})`);
      console.log(`${name.padEnd(widest)}  unreadable`);
      continue;
    }
    if (bytes.length !== entry.bytes || sha256Hex(bytes) !== entry.sha256) {
      problems.push(`${name}: the file on disk is not the one the record describes (${bytes.length} bytes, sha256 ${sha256Hex(bytes)})`);
    }

    const theirs = ask(['node', 'cli/charter.js', 'verify'], ROOT, file);
    if (!theirs.ok) {
      problems.push(`${name}: the reference could not be asked (${theirs.detail})`);
      console.log(`${name.padEnd(widest)}  the reference could not be asked`);
      continue;
    }
    const reference = tally(theirs.answer);
    problems.push(...differences(name, 'the reference', reference, entry.expected));

    let summary = `${describe(entry.expected)} reference agrees`;
    if (entry.agreement === false) {
      recorded += 1;
      summary += '; the record states a disagreement, and both answers are in it';
    }
    if (python !== null) {
      const mine = ask([python, '-m', 'charter_verify'], join(ROOT, 'implementations', 'python'), file);
      if (!mine.ok) {
        problems.push(`${name}: the Python implementation could not be asked (${mine.detail})`);
        summary = `${describe(entry.expected)} python could not be asked`;
      } else {
        problems.push(...differences(name, 'the Python implementation', tally(mine.answer), entry.port));
        summary += ', python agrees';
      }
    }
    console.log(`${name.padEnd(widest)}  ${summary}`);
  }

  for (const problem of problems) console.error(`  ${problem}`);
  console.log('');
  if (problems.length === 0) {
    console.log(
      `${record.cases.length} case(s), and every answer is the one the record states${
        python === null ? ', through the reference alone' : ', through both implementations'
      }; ${recorded} of them the record holds as a disagreement between the two.`,
    );
    return 0;
  }
  console.log(`${problems.length} difference(s) across ${record.cases.length} case(s).`);
  return 1;
}

process.exitCode = main();

