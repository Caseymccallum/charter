#!/usr/bin/env node
/**
 * Replay the conformance kit: the recorded answers, checked against the
 * artifacts on disk.
 *
 * This is the reader's program, not the author's. It builds nothing and it
 * knows nothing about how the artifacts were made: it reads `expected.json`,
 * reads each `.charter` file the record names, and asks the verifier for a
 * verdict. A case passes when the verdict, the exit code, the set of failing
 * checks with their reason codes, the set of unsupported checks, and the number
 * of checks that were never reached all match the record exactly.
 *
 * The recorded digest is compared first. If the bytes on disk are not the bytes
 * the record describes, the replay says so and keeps going, because "this file
 * has been swapped" and "this verdict is wrong" are two different claims, and a
 * reader needs to know which one they are looking at.
 *
 * Usage: node vectors/run.js
 *
 * @module vectors/run
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RECORD_PATH = join(HERE, 'expected.json');

/**
 * @param {Uint8Array} bytes
 * @returns {string} lowercase hex SHA-256
 */
function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * What a verdict says, in the three shapes the record compares.
 *
 * @param {import('../verifier/status.js').CheckResult[]} checks
 * @returns {{ fail: Record<string, string>, unsupported: Record<string, string>, skips: number }}
 */
function tally(checks) {
  /** @type {Record<string, string>} */
  const fail = {};
  /** @type {Record<string, string>} */
  const unsupported = {};
  let skips = 0;
  for (const check of checks) {
    if (check.status === 'FAIL') fail[check.id] = check.reason_code;
    else if (check.status === 'UNSUPPORTED') unsupported[check.id] = check.reason_code;
    else if (check.status === 'SKIP') skips += 1;
  }
  return { fail, unsupported, skips };
}

/**
 * @param {string} name
 * @param {Record<string, string>} seen
 * @param {Record<string, string>} stated
 * @param {string} label 'FAIL' or 'UNSUPPORTED', for the message
 * @returns {string[]}
 */
function compareReasons(name, seen, stated, label) {
  /** @type {string[]} */
  const problems = [];
  for (const [id, code] of Object.entries(stated)) {
    if (seen[id] === undefined) {
      problems.push(`${name}: ${id} must be ${label} and is not`);
    } else if (seen[id] !== code) {
      problems.push(`${name}: ${id} carries reason ${seen[id]}, and the record says it must be ${code}`);
    }
  }
  for (const id of Object.keys(seen)) {
    if (stated[id] === undefined) {
      problems.push(`${name}: ${id} is ${label} (${seen[id]}), and the record does not expect it to be`);
    }
  }
  return problems;
}


/**
 * Compare one replayed verdict with the answer the record states.
 *
 * @param {object} recorded one case from `expected.json`
 * @param {{ verdict: string, exit_code: number, checks: import('../verifier/status.js').CheckResult[] }} result
 * @returns {string[]} the ways in which the verdict is not the recorded one
 */
function compare(recorded, result) {
  const name = String(recorded.name);
  const stated = recorded.expected;
  /** @type {string[]} */
  const problems = [];

  if (result.verdict !== stated.verdict) {
    problems.push(`${name}: verdict is ${result.verdict}, and the record says it must be ${stated.verdict}`);
  }
  if (result.exit_code !== stated.exit_code) {
    problems.push(`${name}: exit code is ${result.exit_code}, and the record says it must be ${stated.exit_code}`);
  }

  const seen = tally(result.checks);
  problems.push(...compareReasons(name, seen.fail, stated.fail, 'FAIL'));
  problems.push(...compareReasons(name, seen.unsupported, stated.unsupported, 'UNSUPPORTED'));
  if (seen.skips !== stated.skips) {
    const ids = result.checks.filter((check) => check.status === 'SKIP').map((check) => check.id);
    problems.push(`${name}: ${seen.skips} check(s) were never reached, and the record says ${stated.skips}: ${ids.join(', ')}`);
  }
  return problems;
}

/**
 * A one-line account of what a verdict did, for the column beside the name.
 *
 * @param {{ verdict: string, checks: import('../verifier/status.js').CheckResult[] }} result
 * @returns {string}
 */
function describe(result) {
  const seen = tally(result.checks);
  const parts = [result.verdict];
  const failed = Object.entries(seen.fail).map(([id, code]) => `${id} (${code})`);
  if (failed.length > 0) parts.push(`fail: ${failed.join(', ')}`);
  if (seen.skips > 0) parts.push(`skips: ${seen.skips}`);
  return parts.join('  ');
}

/**
 * @returns {Promise<number>} the exit code
 */
async function main() {
  const { verify } = await import(pathToFileURL(join(HERE, '..', 'verifier', 'verify.js')).href);

  /** @type {any} */
  let record;
  try {
    record = JSON.parse(readFileSync(RECORD_PATH, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    console.error(`vectors/run.js: ${RECORD_PATH} could not be read (${detail})`);
    console.error('Build the kit first: node vectors/build.js');
    return 1;
  }
  if (!Array.isArray(record.cases) || record.cases.length === 0) {
    console.error('vectors/run.js: the record holds no cases, so there is nothing to replay');
    return 1;
  }

  /** @type {string[]} */
  const problems = [];
  let widest = 0;
  for (const recorded of record.cases) widest = Math.max(widest, String(recorded.name).length);

  for (const recorded of record.cases) {
    const name = String(recorded.name);
    /** @type {Uint8Array} */
    let bytes;
    try {
      bytes = new Uint8Array(readFileSync(join(HERE, String(recorded.file))));
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown error';
      problems.push(`${name}: ${recorded.file} could not be read (${detail})`);
      console.log(`${name.padEnd(widest)}  unreadable`);
      continue;
    }

    const digest = sha256Hex(bytes);
    if (bytes.length !== recorded.bytes || digest !== recorded.sha256) {
      problems.push(`${name}: the file on disk is not the one the record describes (${bytes.length} bytes, sha256 ${digest}; the record says ${recorded.bytes} bytes, sha256 ${recorded.sha256})`);
    }

    const result = await verify(bytes);
    problems.push(...compare(recorded, result));
    console.log(`${name.padEnd(widest)}  ${describe(result)}`);
  }

  for (const problem of problems) console.error(`  ${problem}`);
  if (problems.length === 0) {
    console.log(`\n${record.cases.length} case(s) replayed, and every verdict is the one the record states.`);
    return 0;
  }
  console.log(`\n${problems.length} mismatch(es) across ${record.cases.length} case(s).`);
  return 1;
}

process.exitCode = await main();
