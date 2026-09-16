#!/usr/bin/env node
/**
 * The command line.
 *
 * This is the only file in the project that touches the world outside a byte
 * array: it reads a file and prints text. Everything it says about the file
 * comes from `verifier/verify.js`, which is pure, so the CLI cannot become a
 * second, quieter opinion about what the bytes mean.
 *
 * Exit codes:
 *   0  VERIFIED    every check passed
 *   1  INCOMPLETE  nothing failed, and at least one requirement was not established
 *   2  BROKEN      at least one requirement was violated
 *  64  the command line was not understood
 *  66  the named file could not be read
 *
 * @module cli/charter
 */

import { readFile } from 'node:fs/promises';
import { verify } from '../verifier/verify.js';

const EXIT_USAGE = 64;
const EXIT_NO_INPUT = 66;

const USAGE = `charter — verify a .charter document

Usage:
  charter verify <file.charter> [--all] [--json]
  charter --help

Options:
  --all   list every check, not only the ones that did not pass
  --json  print the verdict as JSON, and nothing else

Exit codes:
  0  VERIFIED    every check passed
  1  INCOMPLETE  nothing failed, and at least one requirement was not established
  2  BROKEN      at least one requirement was violated
  64 the command line was not understood
  66 the named file could not be read
`;

/**
 * @param {string} text
 * @param {number} width
 * @returns {string}
 */
function pad(text, width) {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

/**
 * Wrap prose to a width, indenting every line.
 *
 * @param {string} text
 * @param {number} width characters available after the indent
 * @param {number} indent spaces before every line
 * @returns {string[]} lines already carrying their indent
 */
function wrapped(text, width, indent) {
  const lead = ' '.repeat(indent);
  const words = text.split(' ');
  /** @type {string[]} */
  const lines = [];
  let line = '';
  for (const word of words) {
    if (line === '') {
      line = word;
    } else if (line.length + 1 + word.length <= width) {
      line += ` ${word}`;
    } else {
      lines.push(`${lead}${line}`);
      line = word;
    }
  }
  if (line !== '') lines.push(`${lead}${line}`);
  return lines;
}

/**
 * The report a person reads.
 *
 * @param {string} file the path as it was typed
 * @param {number} size bytes on disk
 * @param {object} result what the verifier returned
 * @param {boolean} all whether to list passing checks as well
 * @returns {string}
 */
function humanReport(file, size, result, all) {
  /** @type {string[]} */
  const out = [];
  out.push(`${file}  (${size} byte(s))`);
  out.push('');
  out.push(`${result.verdict}  ${file}`);
  out.push('');

  const summary = result.summary;
  out.push(
    result.verdict === 'VERIFIED'
      ? `  all ${summary.total} checks passed.`
      : `  ${summary.fail} failed, ${summary.unsupported} unsupported, ${summary.skip} not reached, ${summary.pass} passed, of ${summary.total}.`,
  );

  if (result.artifact !== null) {
    const artifact = result.artifact;
    out.push('');
    out.push(`  title          ${artifact.title}`);
    out.push(`  author         ${artifact.author_name} (${artifact.author_key_id})`);
    out.push(`  created        ${artifact.created_at}`);
    out.push(`  format         ${artifact.format}`);
    out.push(`  entries        ${artifact.entries}`);
    out.push(`  head digest    ${artifact.head_content_sha256}`);
  }

  const shown = result.checks.filter((check) => all || check.status !== 'PASS');
  out.push('');
  if (shown.length === 0) {
    out.push('  every check passed; run with --all to list them.');
  } else {
    out.push('  checks:');
    for (const check of shown) {
      out.push(`    ${pad(check.status, 11)}${check.id}  (${check.reason_code})`);
      for (const line of wrapped(check.detail, 78, 15)) out.push(line);
      out.push('');
    }
  }

  out.push('');
  out.push('  what a passing verdict does not mean:');
  for (const limitation of result.limitations) {
    const lines = wrapped(limitation.statement, 74, 0);
    out.push(`    ${pad(limitation.id, 34)}${lines[0] ?? ''}`);
    for (const line of lines.slice(1)) out.push(`${' '.repeat(38)}${line}`);
  }
  out.push('');
  return `${out.join('\n')}\n`;
}

/**
 * Read the flags of `charter verify`.
 *
 * @param {string[]} argv everything after the subcommand
 * @returns {{ file: string, all: boolean, json: boolean } | { error: string }}
 */
function parseVerify(argv) {
  let file = null;
  let all = false;
  let json = false;
  for (const arg of argv) {
    if (arg === '--all') all = true;
    else if (arg === '--json') json = true;
    else if (arg.startsWith('-')) return { error: `unknown option: ${arg}` };
    else if (file === null) file = arg;
    else return { error: `only one file may be verified at a time, and two were named: ${file} and ${arg}` };
  }
  if (file === null) return { error: 'no file was named' };
  return { file, all, json };
}

/**
 * @returns {Promise<number>} the process exit code
 */
async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    process.stdout.write(USAGE);
    return argv.length === 0 ? EXIT_USAGE : 0;
  }
  if (argv[0] !== 'verify') {
    process.stderr.write(`charter: unknown command: ${argv[0]}\n\n${USAGE}`);
    return EXIT_USAGE;
  }

  const parsed = parseVerify(argv.slice(1));
  if ('error' in parsed) {
    process.stderr.write(`charter verify: ${parsed.error}\n\n${USAGE}`);
    return EXIT_USAGE;
  }

  /** @type {Uint8Array} */
  let bytes;
  try {
    bytes = new Uint8Array(await readFile(parsed.file));
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    process.stderr.write(`charter verify: ${parsed.file} could not be read: ${detail}\n`);
    return EXIT_NO_INPUT;
  }

  const result = await verify(bytes);
  if (parsed.json) {
    process.stdout.write(`${JSON.stringify({ file: parsed.file, bytes: bytes.length, ...result }, null, 2)}\n`);
  } else {
    process.stdout.write(humanReport(parsed.file, bytes.length, result, parsed.all));
  }
  return result.exit_code;
}

process.exitCode = await main();

