#!/usr/bin/env node
/**
 * The differential probe: two implementations, one input, one answer.
 *
 * This is the program that found the places `SPEC.md` was silent, and it is
 * re-runnable. For each of the 20 hand-built artifacts under `out/` it asks two
 * programs the same question and compares the answers:
 *
 *   - the reference command line (`node cli/charter.js verify <file> --json`),
 *     taken as a black box;
 *   - the Python implementation (`python -m charter_verify <file> --json`),
 *     written from the specification by a reader who did not read `verifier/**`;
 *   - and the record, which says what each of them said, so a regression in
 *     either one is caught rather than merely disagreed with.
 *
 * The comparison is the one the conformance kit makes: the verdict, the exit
 * code, the failing checks with their reason codes, the unsupported checks with
 * theirs, and the number of checks that were never reached. Prose is not
 * compared, because SPEC.md 10 allows a detail to be reworded between releases.
 *
 * # One runtime may be missing, and that is not a failure
 *
 * The reference leg needs Node — which is running this file — and the Python leg
 * needs an interpreter. A machine without one skips that leg, says so in as many
 * words, and still exits 0, because a probe that fails hard when a language is
 * not installed is a probe nobody runs.
 *
 * Usage: node vectors/probe/run.js
 *
 * @module vectors/probe/run
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

/** @returns {number} the exit code */
function main() {
  /** @type {any} */
  let record;
  try {
    record = JSON.parse(readFileSync(RECORD_PATH, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    console.error(`vectors/probe/run.js: ${RECORD_PATH} could not be read (${detail})`);
    console.error('Build the probe first: python implementations/python/tools/probe.py --build');
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

    /** @type {string} */
    let summary = `${entry.expected.verdict.padEnd(11)} reference agrees`;
    if (python !== null) {
      const mine = ask([python, '-m', 'charter_verify'], join(ROOT, 'implementations', 'python'), file);
      if (!mine.ok) {
        problems.push(`${name}: the Python implementation could not be asked (${mine.detail})`);
        summary = `${entry.expected.verdict.padEnd(11)} python could not be asked`;
      } else {
        const pythonAnswer = tally(mine.answer);
        problems.push(...differences(name, 'the Python implementation', pythonAnswer, entry.expected));
        problems.push(...differences(name, 'the Python implementation', pythonAnswer, reference));
        summary = `${entry.expected.verdict.padEnd(11)} reference agrees, python agrees`;
      }
    }
    console.log(`${name.padEnd(widest)}  ${summary}`);
  }

  for (const problem of problems) console.error(`  ${problem}`);
  console.log('');
  if (problems.length === 0) {
    console.log(
      `${record.cases.length} probe(s), and every answer is the one the record states${
        python === null ? ', through the reference alone' : ', through both implementations'
      }.`,
    );
    return 0;
  }
  console.log(`${problems.length} difference(s) across ${record.cases.length} probe(s).`);
  return 1;
}

process.exitCode = main();
