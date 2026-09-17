#!/usr/bin/env node
/**
 * The command line.
 *
 * This is the only file in the project that touches the world outside a byte
 * array: it reads files, writes one, and prints text. Everything it says about
 * a file it read comes from `verifier/**`, which is pure, so the command line
 * cannot become a second, quieter opinion about what the bytes mean — and the
 * clock, which the verifier may not read and the producer does not read, is
 * read here or nowhere.
 *
 * `verify` reports a verdict. `seal`, `edit`, `inspect` and `cite` do not: they
 * write a file or describe one, and a refusal from any of them carries a reason
 * code from the same vocabulary a verdict prints.
 *
 * Exit codes:
 *   0  VERIFIED       every check passed, or the command did what it said
 *   1  INCOMPLETE     nothing failed, and at least one requirement was not established
 *   2  BROKEN         at least one requirement was violated
 *  64  EX_USAGE       the command line was not understood
 *  65  EX_DATAERR     the input was refused, and the refusal has a reason code
 *  66  EX_NOINPUT     a named file could not be read
 *  73  EX_CANTCREAT   the output file could not be created
 *
 * @module cli/charter
 */

import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { citationItem } from '../producer/cite.js';
import { edit } from '../producer/edit.js';
import { generateKeyPair } from '../producer/key.js';
import { isKeyFile, SCRYPT_LOG_N, SCRYPT_R } from '../producer/keyfile.js';
import { readCharter } from '../producer/read.js';
import { seal } from '../producer/seal.js';
import { utf8Decode, utf8Encode } from '../verifier/bytes.js';
import { FORMAT } from '../verifier/manifest.js';
import { RefusalError } from '../verifier/refuse.js';
import { REASON } from '../verifier/status.js';
import { verify } from '../verifier/verify.js';

const EXIT_USAGE = 64;
const EXIT_REFUSED = 65;
const EXIT_NO_INPUT = 66;
const EXIT_NO_OUTPUT = 73;

/**
 * The length below which a passphrase is reported as short.
 *
 * A warning and never a refusal, because this project can say what a passphrase costs to
 * guess and cannot say what one is worth: length is the lever, entropy is not
 * measurable from here, and refusing a deliberate eleven-character passphrase would be
 * this tool pretending to a judgement it does not have. Twelve is the floor the sibling
 * project's own audit records it enforcing, which makes it a number with a precedent
 * rather than a number invented here.
 */
const SHORT_PASSPHRASE = 12;

const HELP = `  charter verify <file.charter> [--all] [--json]
  charter seal <content.md> --key <key.pem> -o <out.charter> [options]
  charter edit <file.charter> <content.md> --key <key.pem> -o <out.charter> [options]
  charter inspect <file.charter>
  charter open <file.charter> [-o <out.md>] [--force]
  charter cite <file.charter> [--title <text>] [--accessed <YYYY-MM-DD>]
  charter keygen -o <key.pem> [--encrypt] [--force]
  charter --help`;

const USAGE = `charter — verify, open, seal, edit, inspect and cite .charter documents

Usage:
${HELP}

Verify:
  --all   list every check, not only the ones that did not pass
  --json  print the verdict as JSON, and nothing else

Seal:
  --key <file>      the Ed25519 private key, as a PKCS#8 PEM file or a
                    passphrase-protected key file written by "charter keygen
                    --encrypt" (required)
  --passphrase-file <file>
                    the passphrase for a protected key: read from the first line
                    of this file. CHARTER_PASSPHRASE in the environment is read
                    when this is not given, and the command prompts for one when
                    there is a terminal to prompt on. A passphrase passed on the
                    command line itself is refused, because a shell keeps it
  -o, --out <file>  the artifact to write (required)
  --title <text>    the title to record; without it the title is read out of
                    the document, or taken from the content file's name
  --author <name>   the signer's name; without it the manifest says "unknown"
  --created-at <t>  the time to record, as YYYY-MM-DDTHH:MM:SSZ
  --now             record the current time instead; the one flag that reads a
                    clock, and without it or --created-at the file states no time
  --summary <text>  the first entry's summary
  --force           overwrite an output file that already exists
  --json            print what was written as JSON

Edit (append one revision to an artifact):
  the first name is the artifact being extended, the second is the new revision
  of the document; every flag is the seal's, and each one applies to the entry
  this edit writes rather than to the claims the file already carries:
  --key <file>      the key the artifact carries (required; any other key is
                    refused, because every entry of a file names the one key it
                    carries)
  -o, --out <file>  the artifact to write (required; the input may be the output
                    when --force is passed)
  --title <text>    a new title; without it the artifact keeps the title it has
  --author <name>   the name for this entry; without it the artifact's own name
  --created-at <t>  the time to record for this entry, as YYYY-MM-DDTHH:MM:SSZ
  --now             record the current time instead
  --summary <text>  this entry's summary; without it the entry says none was given
  --force           overwrite an output file that already exists
  --json            print what was written as JSON

  the earlier entries are copied byte for byte: an edit adds a line, and does not
  rewrite, re-sign or reflow the history it was handed.

Open (write out the document a file carries):
  -o, --out <file>  the file to write; without it the document goes to standard
                    output, and a shell that redirects output may transcode it, so
                    a named file is the way to be sure the bytes are the bytes
  --force           overwrite an output file that already exists

  what is written is the content entry this verifier read, not a second unzip of
  the container. The exit code says whether the bytes were written; the verdict is
  printed beside them, because a document that does not verify is still a document,
  and which one you were handed is yours to know.

Cite:
  --title <text>    state the title rather than deriving it from the document
  --accessed <date> the day the citation is made, YYYY-MM-DD; default: today, UTC

Keygen:
  -o, --out <file>  the key file to write (required)
  --encrypt         write a passphrase-protected key file rather than a plain
                    PKCS#8 PEM; the passphrase is read the way seal reads one, so
                    --passphrase-file, CHARTER_PASSPHRASE, or a prompt. Only a
                    file written this way is worth anything to someone who
                    finds it, and it is worth exactly what the passphrase is
  --passphrase-file <file>
                    the passphrase, on the first line of this file; passing it
                    implies --encrypt
  --force           overwrite an output file that already exists

Inspect prints what a file claims and never a verdict; run verify for one.

Exit codes:
  0  VERIFIED, or the command did what it said
  1  INCOMPLETE  nothing failed, and at least one requirement was not established
  2  BROKEN      at least one requirement was violated
 64 the command line was not understood
 65 the input was refused, with a reason code
 66 a named file could not be read
 73 the output file could not be created
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
 * Read a command line into options and names.
 *
 * One reader for every verb, so a flag no verb knows is refused the same way
 * everywhere, and so that no verb can quietly accept a flag it does not use.
 * `--help` is handled before this runs; anything else beginning with `-` has to
 * be in the verb's list of flags.
 *
 * @param {string[]} argv everything after the subcommand
 * @param {Record<string, 'flag' | 'value'>} spec the flags this verb takes
 * @returns {{ options: Record<string, string | boolean>, names: string[] } | { error: string }}
 */
function readArguments(argv, spec) {
  /** @type {Record<string, string | boolean>} */
  const options = {};
  /** @type {string[]} */
  const names = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('-')) {
      names.push(arg);
      continue;
    }
    const kind = spec[arg];
    if (kind === undefined) return { error: `unknown option: ${arg}` };
    if (kind === 'flag') {
      options[arg] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('-')) return { error: `${arg} needs a value` };
    options[arg] = value;
    index += 1;
  }
  return { options, names };
}

/**
 * The one name a verb acts on.
 *
 * @param {string[]} names the positional arguments
 * @param {string} missing what to say when none was given
 * @param {string} tooMany what to say before naming the two that were given
 * @returns {{ name: string } | { error: string }}
 */
function oneName(names, missing, tooMany) {
  if (names.length === 0) return { error: missing };
  if (names.length > 1) return { error: `${tooMany}: ${names[0]} and ${names[1]}` };
  return { name: names[0] };
}

/**
 * Read the flags of `charter verify`.
 *
 * @param {string[]} argv everything after the subcommand
 * @returns {{ file: string, all: boolean, json: boolean } | { error: string }}
 */
function parseVerify(argv) {
  const parsed = readArguments(argv, { '--all': 'flag', '--json': 'flag' });
  if ('error' in parsed) return parsed;
  const file = oneName(parsed.names, 'no file was named', 'only one file may be verified at a time, and two were named');
  if ('error' in file) return file;
  return { file: file.name, all: parsed.options['--all'] === true, json: parsed.options['--json'] === true };
}

/**
 * Report a refusal: the reason code first, so a caller reads the same vocabulary
 * a verdict prints, then the prose.
 *
 * @param {string} verb
 * @param {string} reason_code one of `REASON`'s values
 * @param {string} detail what is wrong, in prose
 * @param {number} exit_code
 * @returns {number} the exit code, so a caller can `return refusal(...)`
 */
function refusal(verb, reason_code, detail, exit_code) {
  process.stderr.write(`charter ${verb}: ${reason_code}: ${detail}\n`);
  return exit_code;
}

/**
 * The command line was not understood. Nothing was read, so nothing is claimed.
 *
 * @param {string} message
 * @returns {number}
 */
function usageError(message) {
  process.stderr.write(`${message}\n\n${USAGE}`);
  return EXIT_USAGE;
}

/**
 * @param {string} path
 * @returns {Promise<{ ok: true, bytes: Uint8Array } | { ok: false, detail: string }>}
 */
async function readFileBytes(path) {
  try {
    return { ok: true, bytes: new Uint8Array(await readFile(path)) };
  } catch (cause) {
    return { ok: false, detail: cause instanceof Error ? cause.message : 'unknown error' };
  }
}

/**
 * @param {string} path
 * @returns {Promise<boolean>} whether something is already at this path
 */
async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} path
 * @param {Uint8Array} bytes
 * @param {number} [mode] the permission bits to ask for; a platform may ignore them
 * @returns {Promise<{ ok: true } | { ok: false, detail: string }>}
 */
async function writeOutput(path, bytes, mode = 0o644) {
  try {
    await writeFile(path, bytes, { mode });
    return { ok: true };
  } catch (cause) {
    return { ok: false, detail: cause instanceof Error ? cause.message : 'unknown error' };
  }
}

/**
 * Run a producer call and turn its refusal into an exit code.
 *
 * A refusal is a writer saying no with a name from the shared vocabulary, and
 * that is the only kind of failure this turns into a code. The class is the
 * shared one rather than the producer's `ProducerError`, because a seal writes
 * through code that lives in `verifier/**` — the ZIP writer — and a refusal
 * from there is still a refusal, with the same reason code, that a caller has
 * to be able to branch on. Anything else is a defect in this project and is
 * allowed to reach the top of the process, where a stack trace says so instead
 * of an exit code hiding it.
 *
 * @template T
 * @param {string} verb
 * @param {() => Promise<T>} work
 * @returns {Promise<{ ok: true, value: T } | { ok: false, code: number }>}
 */
async function produce(verb, work) {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    if (error instanceof RefusalError) {
      return { ok: false, code: refusal(verb, error.reason_code, error.detail, EXIT_REFUSED) };
    }
    throw error;
  }
}

/**
 * The current time, in the one form this format carries: UTC, second precision.
 * This is the only clock read in the project outside the tests.
 *
 * @returns {string}
 */
function nowUtcSeconds() {
  return `${new Date().toISOString().slice(0, 19)}Z`;
}

/**
 * @param {string} path
 * @param {string} verb
 * @returns {Promise<{ bytes: Uint8Array, text: string } | { code: number }>}
 */
async function readTextFile(path, verb) {
  const input = await readFileBytes(path);
  if (!input.ok) {
    return { code: refusal(verb, REASON.MISSING, `${path} could not be read: ${input.detail}`, EXIT_NO_INPUT) };
  }
  const decoded = utf8Decode(input.bytes);
  if (!decoded.ok) {
    return { code: refusal(verb, REASON.DECODE_ERROR, `${path} is not valid UTF-8, so it is not the text this command reads`, EXIT_REFUSED) };
  }
  return { bytes: input.bytes, text: decoded.text };
}

/**
 * One line from standard input, with echo off when there is a terminal to turn it off on.
 *
 * Resolves `null` when the input ends before a line is complete, which is what a closed
 * or empty standard input does — and that has to resolve rather than wait, because a
 * command that hangs for input nobody will type is worse than one that refuses.
 *
 * `process.stdin.setRawMode` exists only where there is a terminal. With a pipe the
 * bytes arrive as they were written and the newline ends the line, which is also how
 * this is tested.
 *
 * @returns {Promise<string | null>}
 */
function readPassphraseLine() {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const interactive = stdin.isTTY === true && typeof stdin.setRawMode === 'function';
    if (interactive) process.stderr.write('passphrase: ');
    let text = '';
    const finish = (value) => {
      stdin.removeListener('data', onData);
      stdin.removeListener('end', onEnd);
      if (interactive) {
        stdin.setRawMode(false);
        process.stderr.write('\n');
      }
      stdin.pause();
      resolve(value);
    };
    const onEnd = () => finish(null);
    const onData = (chunk) => {
      for (const character of String(chunk)) {
        if (character === '\n' || character === '\r') return finish(text);
        if (character === '\u0003') {
          // Ctrl-C at a prompt is a person changing their mind, not a refusal to
          // report: the shell's own convention for that is what happens.
          process.stderr.write('\n');
          process.exit(130);
        }
        if (character === '\u007f' || character === '\b') {
          text = text.slice(0, -1);
          continue;
        }
        text += character;
      }
      return undefined;
    };
    stdin.on('data', onData);
    stdin.on('end', onEnd);
    if (interactive) stdin.setRawMode(true);
    stdin.resume();
  });
}

/**
 * The passphrase to open a key file with, from wherever this command allows one to come.
 *
 * Three sources, in this order, and no fourth:
 *
 *   1. `--passphrase-file <path>` — the first line of the file, less one line ending.
 *      The first line rather than the whole file, because that is what a file written
 *      by `echo` or by an editor holds, and because a passphrase with a newline in it
 *      cannot be typed at a prompt;
 *   2. `CHARTER_PASSPHRASE` in the environment;
 *   3. a line from standard input, which is the terminal when there is one, and a pipe
 *      when there is not.
 *
 * A prompt is refused rather than attempted when standard input is a terminal but
 * standard error is not: the question would be written where nobody can see it and the
 * command would wait for an answer to a question that was never asked in front of
 * anybody. That is not a hypothetical — it is what this command did, once, for five
 * minutes, before the guard was added.
 *
 * **A passphrase given on the command line is refused**, in `main()`, before any verb
 * sees it: an argument is kept by the shell's history and is readable from the process
 * list by anything running as the same user, and both of those outlive the command.
 * Refusing it centrally is what makes the rule hold for every verb at once.
 *
 * @param {{ options: Record<string, string | boolean> }} parsed
 * @param {string} verb
 * @returns {Promise<{ passphrase: string } | { code: number }>}
 */
async function passphraseFrom(parsed, verb) {
  const file = parsed.options['--passphrase-file'];
  if (typeof file === 'string') {
    const read = await readTextFile(file, verb);
    if (!('text' in read)) return read;
    const first = read.text.split('\n')[0].replace(/\r$/, '');
    if (first === '') {
      return {
        code: refusal(
          verb,
          REASON.MALFORMED,
          `${file} holds no passphrase on its first line, and an empty passphrase is not one: it would be the same as writing the key in the clear`,
          EXIT_REFUSED,
        ),
      };
    }
    return { passphrase: first };
  }

  const fromEnvironment = process.env.CHARTER_PASSPHRASE;
  if (typeof fromEnvironment === 'string' && fromEnvironment !== '') {
    return { passphrase: fromEnvironment };
  }

  // A prompt nobody can see is worse than a refusal. With standard error redirected, the
  // question goes into a file and the command then waits for an answer that was never
  // asked in front of anybody — and waits until it is killed. This guard exists because
  // that happened while this feature was being built: `charter seal --key <armored> -o x
  // 2> log` sat for five minutes with the prompt in `log`.
  if (process.stdin.isTTY === true && process.stderr.isTTY !== true) {
    return {
      code: refusal(
        verb,
        REASON.MISSING,
        'a passphrase was needed and standard error is redirected, so a prompt would have gone where nobody can read it; pass --passphrase-file <file> or set CHARTER_PASSPHRASE instead of answering a question that cannot be shown',
        EXIT_NO_INPUT,
      ),
    };
  }

  const typed = await readPassphraseLine();
  if (typed === null || typed === '') {
    return {
      code: refusal(
        verb,
        REASON.MISSING,
        'no passphrase was given and none could be read: pass --passphrase-file <file> or set CHARTER_PASSPHRASE, or run this where there is a terminal to prompt on',
        EXIT_NO_INPUT,
      ),
    };
  }
  return { passphrase: typed };
}

/** What each place a title can come from is called, in a report. */
const TITLE_ORIGIN_WORDS = Object.freeze({
  stated: 'stated on the command line',
  'title-element': 'read out of a <title> element in the document',
  heading: 'read out of the first Markdown heading in the document',
  'content-file-name': "the name of the content file, which is not part of the document",
});


/**
 * `charter verify <file.charter> [--all] [--json]`
 *
 * @param {string[]} argv everything after the subcommand
 * @returns {Promise<number>}
 */
async function runVerify(argv) {
  const parsed = parseVerify(argv);
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

/** The flags `charter seal` takes. */
/**
 * The flags `seal` and `edit` share: they write the same kind of record, and the
 * only difference between the two command lines is which entry the flags describe.
 */
const WRITE_FLAGS = Object.freeze({
  '--key': 'value',
  '--passphrase-file': 'value',
  '-o': 'value',
  '--out': 'value',
  '--title': 'value',
  '--author': 'value',
  '--created-at': 'value',
  '--summary': 'value',
  '--now': 'flag',
  '--force': 'flag',
  '--json': 'flag',
});

/**
 * What a seal wrote, and what it does not mean.
 *
 * The report names the time the file states and says when it states none, and
 * it says where the title came from whenever the title was not stated: a person
 * reading a manifest has to be able to tell a claim the tool was given from a
 * claim the tool derived.
 *
 * @param {string} path
 * @param {number} size
 * @param {object} claims
 * @returns {string}
 */
function sealReport(path, size, claims) {
  /** @type {string[]} */
  const out = [];
  out.push(`sealed  ${path}  (${size} byte(s))`);
  out.push('');
  out.push(`  format          ${claims.format}`);
  out.push(`  title           ${claims.title}`);
  if (claims.title_origin !== 'stated') {
    out.push(`                  (${TITLE_ORIGIN_WORDS[claims.title_origin] ?? claims.title_origin})`);
  }
  out.push(`  author          ${claims.author_name}`);
  out.push(`  key id          ${claims.key_id}`);
  out.push(`  created         ${claims.created_at}${claims.time_stated ? '' : '  (no time stated: pass --now or --created-at to state one)'}`);
  out.push(`  content sha256  ${claims.content_sha256}`);
  out.push(`  entries         1  (${claims.action})`);
  out.push('');
  out.push('  what a sealed file does not mean:');
  out.push('    a seal is a claim made with the key above, and nothing is checked on the way');
  out.push('    out. run `charter verify <file>` for a verdict, and read the limits it prints.');
  out.push('');
  return `${out.join('\n')}\n`;
}

/**
 * `charter seal <content.md> --key <key.pem> -o <out.charter> [options]`
 *
 * @param {string[]} argv everything after the subcommand
 * @returns {Promise<number>}
 */
async function runSeal(argv) {
  const parsed = readArguments(argv, WRITE_FLAGS);
  if ('error' in parsed) return usageError(`charter seal: ${parsed.error}`);

  const content = oneName(parsed.names, 'no content file was named', 'only one document may be sealed at a time, and two were named');
  if ('error' in content) return usageError(`charter seal: ${content.error}`);

  const keyPath = parsed.options['--key'];
  if (typeof keyPath !== 'string') return usageError('charter seal: no key was named; pass --key <key.pem>');
  const outPath = parsed.options['-o'] ?? parsed.options['--out'];
  if (typeof outPath !== 'string') return usageError('charter seal: no output file was named; pass -o <out.charter>');
  const stated = parsed.options['--created-at'];
  if (parsed.options['--now'] === true && typeof stated === 'string') {
    return usageError('charter seal: --now and --created-at state two different times; pass one of them');
  }

  const contentFile = await readFileBytes(content.name);
  if (!contentFile.ok) {
    return refusal('seal', REASON.MISSING, `${content.name} could not be read: ${contentFile.detail}`, EXIT_NO_INPUT);
  }
  const keyFile = await readTextFile(keyPath, 'seal');
  if (!('text' in keyFile)) return keyFile.code;

  // A passphrase is asked for only when the key file is one that needs it. A PEM is
  // read exactly as it always was, and prompting for a passphrase over a key that has
  // none would be asking a question with no answer.
  let passphrase;
  if (isKeyFile(keyFile.text)) {
    const resolved = await passphraseFrom(parsed, 'seal');
    if ('code' in resolved) return resolved.code;
    passphrase = resolved.passphrase;
  }

  // The output is looked at before the work, so a refusal costs nothing and no
  // file is left half-written. `EXTRA` is this vocabulary's name for "something
  // is already there that this call did not put there", and a seal does not
  // overwrite a record unless it was told to.
  if (parsed.options['--force'] !== true && (await exists(outPath))) {
    return refusal('seal', REASON.EXTRA, `${outPath} already exists; pass --force to overwrite it`, EXIT_NO_OUTPUT);
  }

  const text = (name) => (typeof parsed.options[name] === 'string' ? parsed.options[name] : undefined);
  const produced = await produce('seal', () =>
    seal({
      content: contentFile.bytes,
      key: keyFile.text,
      passphrase,
      content_name: basename(content.name),
      title: text('--title'),
      author: text('--author'),
      created_at: typeof stated === 'string' ? stated : parsed.options['--now'] === true ? nowUtcSeconds() : undefined,
      summary: text('--summary'),
    }),
  );
  if (!produced.ok) return produced.code;

  // A path that cannot hold a file at all — a directory, a denied permission —
  // is not a well-formed output, which is what MALFORMED means here.
  const written = await writeOutput(outPath, produced.value.bytes);
  if (!written.ok) return refusal('seal', REASON.MALFORMED, `${outPath} could not be written: ${written.detail}`, EXIT_NO_OUTPUT);

  if (parsed.options['--json'] === true) {
    process.stdout.write(`${JSON.stringify({ file: outPath, bytes: produced.value.bytes.length, ...produced.value.claims }, null, 2)}\n`);
  } else {
    process.stdout.write(sealReport(outPath, produced.value.bytes.length, produced.value.claims));
  }
  return 0;
}

/**
 * What an edit wrote, and which claims it left alone.
 *
 * A person reading this has to be able to tell the claims the new entry makes
 * from the claims the file already carried, so the report names the artifact it
 * extended and how many entries that artifact had, says beside each claim that
 * this edit did not restate it, and prints the line the new entry commits to.
 *
 * @param {string} artifactPath the artifact that was extended
 * @param {string} path
 * @param {number} size
 * @param {object} claims
 * @returns {string}
 */
function editReport(artifactPath, path, size, claims) {
  /** @type {string[]} */
  const out = [];
  out.push(`edited  ${path}  (${size} byte(s))`);
  out.push('');
  out.push(`  from            ${artifactPath}  (${claims.entries_before} entr${claims.entries_before === 1 ? 'y' : 'ies'})`);
  out.push(`  format          ${claims.format}`);
  out.push(`  title           ${claims.title}${claims.title_stated ? '  (stated by this edit)' : '  (unchanged)'}`);
  out.push(`  author          ${claims.author_name}${claims.author_name_stated ? '  (stated by this edit)' : '  (unchanged)'}`);
  out.push(`  key id          ${claims.key_id}`);
  out.push(`  created         ${claims.created_at}`);
  out.push(`  content sha256  ${claims.content_sha256}`);
  out.push(`  was             ${claims.previous_content_sha256}`);
  out.push(`  entries         ${claims.entries}  (one more, and it is an ${claims.action})`);
  out.push(`  parent          ${claims.parent}`);
  out.push(`  summary         ${claims.summary}${claims.summary_stated ? '' : '  (no summary stated)'}`);
  out.push(`  entry time      ${claims.timestamp}${claims.time_stated ? '' : '  (no time stated: pass --now or --created-at to state one)'}`);
  out.push('');
  out.push('  what an edit does not mean:');
  out.push('    the earlier entries are the bytes the file already held, copied unchanged.');
  out.push('    the new entry is a claim made with the key above, and nothing was checked');
  out.push('    on the way out. run `charter verify <file>` for a verdict.');
  out.push('');
  return `${out.join('\n')}\n`;
}

/**
 * `charter edit <file.charter> <content.md> --key <key.pem> -o <out.charter> [options]`
 *
 * @param {string[]} argv everything after the subcommand
 * @returns {Promise<number>}
 */
async function runEdit(argv) {
  const parsed = readArguments(argv, WRITE_FLAGS);
  if ('error' in parsed) return usageError(`charter edit: ${parsed.error}`);

  if (parsed.names.length !== 2) {
    return usageError('charter edit: name the artifact to extend and the new revision of the document, in that order');
  }
  const artifactPath = parsed.names[0];
  const contentPath = parsed.names[1];

  const keyPath = parsed.options['--key'];
  if (typeof keyPath !== 'string') return usageError('charter edit: no key was named; pass --key <key.pem>');
  const outPath = parsed.options['-o'] ?? parsed.options['--out'];
  if (typeof outPath !== 'string') return usageError('charter edit: no output file was named; pass -o <out.charter>');
  const stated = parsed.options['--created-at'];
  if (parsed.options['--now'] === true && typeof stated === 'string') {
    return usageError('charter edit: --now and --created-at state two different times; pass one of them');
  }

  const artifact = await readFileBytes(artifactPath);
  if (!artifact.ok) {
    return refusal('edit', REASON.MISSING, `${artifactPath} could not be read: ${artifact.detail}`, EXIT_NO_INPUT);
  }
  const contentFile = await readFileBytes(contentPath);
  if (!contentFile.ok) {
    return refusal('edit', REASON.MISSING, `${contentPath} could not be read: ${contentFile.detail}`, EXIT_NO_INPUT);
  }
  const keyFile = await readTextFile(keyPath, 'edit');
  if (!('text' in keyFile)) return keyFile.code;

  // A passphrase is asked for only when the key file is one that needs it, as in a seal.
  let passphrase;
  if (isKeyFile(keyFile.text)) {
    const resolved = await passphraseFrom(parsed, 'edit');
    if ('code' in resolved) return resolved.code;
    passphrase = resolved.passphrase;
  }

  // As in a seal: the output is looked at before the work, so an edit that would
  // overwrite a file it was not told to overwrite costs nothing and writes none.
  if (parsed.options['--force'] !== true && (await exists(outPath))) {
    return refusal('edit', REASON.EXTRA, `${outPath} already exists; pass --force to overwrite it`, EXIT_NO_OUTPUT);
  }

  const text = (name) => (typeof parsed.options[name] === 'string' ? parsed.options[name] : undefined);
  const produced = await produce('edit', () =>
    edit({
      artifact: artifact.bytes,
      content: contentFile.bytes,
      key: keyFile.text,
      passphrase,
      title: text('--title'),
      author: text('--author'),
      created_at: typeof stated === 'string' ? stated : parsed.options['--now'] === true ? nowUtcSeconds() : undefined,
      summary: text('--summary'),
    }),
  );
  if (!produced.ok) return produced.code;

  const written = await writeOutput(outPath, produced.value.bytes);
  if (!written.ok) return refusal('edit', REASON.MALFORMED, `${outPath} could not be written: ${written.detail}`, EXIT_NO_OUTPUT);

  if (parsed.options['--json'] === true) {
    process.stdout.write(`${JSON.stringify({ file: outPath, bytes: produced.value.bytes.length, ...produced.value.claims }, null, 2)}\n`);
  } else {
    process.stdout.write(editReport(artifactPath, outPath, produced.value.bytes.length, produced.value.claims));
  }
  return 0;
}


/**
 * What a file claims, in the words of the file.
 *
 * @param {string} path
 * @param {number} size
 * @param {object} claims the artifact summary the verifier read
 * @param {boolean} implemented whether this build implements the declared version
 * @returns {string}
 */
function inspectReport(path, size, claims, implemented) {
  /** @type {string[]} */
  const out = [];
  out.push(`${path}  (${size} byte(s))`);
  out.push('');
  out.push('  the file claims:');
  out.push(`    format          ${claims.format}`);
  out.push(
    implemented
      ? `                    (the version this build implements)`
      : `                    (this build implements ${FORMAT}, so its rules were not applied)`,
  );
  out.push(`    title           ${claims.title}`);
  out.push(`    author          ${claims.author_name}`);
  out.push(`    key id          ${claims.author_key_id}`);
  out.push(`    created         ${claims.created_at}`);
  out.push(`    content sha256  ${claims.head_content_sha256}`);
  out.push(`    entries         ${claims.entries === null ? 'unreadable' : claims.entries}`);
  out.push('');
  out.push('  every line above is what the file says about itself. inspect checks nothing:');
  out.push('  run `charter verify` for a verdict, and it will print what it could not establish.');
  out.push('');
  return `${out.join('\n')}\n`;
}

/**
 * `charter inspect <file.charter>`
 *
 * The claims normally come from `verifier/verify.js`, which is the only reader
 * in this project, so `inspect` cannot disagree with `verify` about what a file
 * says. The one question inspect answers that verify does not is whether the
 * declared format is one this build implements, and that answer is read from the
 * check that decides it rather than from a comparison written here.
 *
 * A file that declares a version this build does not implement has no summary in
 * the verdict, because the verifier deliberately applies no version's rules to
 * it — including reading its manifest fields. Describing such a file is the most
 * useful thing inspect can do with it, so the claims are read directly then, with
 * the producer's own reader, and the report says the rules were not applied.
 *
 * @param {string[]} argv everything after the subcommand
 * @returns {Promise<number>}
 */
async function runInspect(argv) {
  const parsed = readArguments(argv, {});
  if ('error' in parsed) return usageError(`charter inspect: ${parsed.error}`);
  const file = oneName(parsed.names, 'no file was named', 'only one file may be inspected at a time, and two were named');
  if ('error' in file) return usageError(`charter inspect: ${file.error}`);

  const input = await readFileBytes(file.name);
  if (!input.ok) {
    return refusal('inspect', REASON.MISSING, `${file.name} could not be read: ${input.detail}`, EXIT_NO_INPUT);
  }

  const result = await verify(input.bytes);
  const formatCheck = result.checks.find((check) => check.id === 'L0.FORMAT.IDENTIFIER');
  const implemented = formatCheck !== undefined && formatCheck.status === 'PASS';

  /** @type {object | null} */
  let claims = result.artifact;
  if (claims === null) {
    const read = await readCharter(input.bytes);
    if (!read.ok) {
      const blocker = result.checks.find((check) => check.status === 'FAIL' || check.status === 'UNSUPPORTED');
      const detail = blocker === undefined ? `${read.reason_code}: ${read.detail}` : `${blocker.id}: ${blocker.detail}`;
      return refusal('inspect', read.reason_code, `${file.name}: nothing in this file could be read as a manifest (${detail})`, EXIT_REFUSED);
    }
    claims = {
      format: read.claims.format,
      title: read.claims.title,
      created_at: read.claims.created_at,
      author_name: read.claims.author_name,
      author_key_id: read.claims.author_key_id,
      head_content_sha256: read.claims.content_sha256,
      entries: read.claims.entries,
    };
  }

  process.stdout.write(inspectReport(file.name, input.bytes.length, claims, implemented));
  return 0;
}

/**
 * `charter cite <file.charter> [--title <text>] [--accessed <date>]`
 *
 * The item is CSL-JSON and nothing else: what a reference manager reads is the
 * whole output, so `cite` prints no prose of its own. A file whose manifest
 * cannot be read has no claims to cite, and that is a refusal rather than an
 * item with empty fields.
 *
 * @param {string[]} argv everything after the subcommand
 * @returns {Promise<number>}
 */
async function runCite(argv) {
  const parsed = readArguments(argv, { '--title': 'value', '--accessed': 'value' });
  if ('error' in parsed) return usageError(`charter cite: ${parsed.error}`);
  const file = oneName(parsed.names, 'no file was named', 'only one file may be cited at a time, and two were named');
  if ('error' in file) return usageError(`charter cite: ${file.error}`);

  const input = await readFileBytes(file.name);
  if (!input.ok) {
    return refusal('cite', REASON.MISSING, `${file.name} could not be read: ${input.detail}`, EXIT_NO_INPUT);
  }

  const read = await readCharter(input.bytes);
  if (!read.ok) return refusal('cite', read.reason_code, `${file.name}: ${read.detail}`, EXIT_REFUSED);

  const accessed = typeof parsed.options['--accessed'] === 'string' ? parsed.options['--accessed'] : new Date().toISOString().slice(0, 10);
  const produced = await produce('cite', () =>
    citationItem({
      claims: read.claims,
      content: read.content,
      artifact: input.bytes,
      title: typeof parsed.options['--title'] === 'string' ? parsed.options['--title'] : undefined,
      accessed,
    }),
  );
  if (!produced.ok) return produced.code;

  process.stdout.write(`${JSON.stringify(produced.value, null, 2)}\n`);
  return 0;
}

/**
 * What `open` wrote, and what the verifier said about the file it came from.
 *
 * The verdict goes to stderr and the document to stdout, because they are for
 * different readers: one is for a pipe, the other is for the person watching it,
 * and a report mixed into a document would corrupt the only thing this verb exists
 * to produce.
 *
 * @param {string} file the artifact as it was named
 * @param {object} result the verdict from `verifier/verify.js`
 * @param {number} bytes how many bytes of content were written
 * @param {string | null} outPath the file written, or null for standard output
 * @returns {string}
 */
function openReport(file, result, bytes, outPath) {
  /** @type {string[]} */
  const out = [];
  out.push(`  ${bytes} byte(s) written ${outPath === null ? 'to standard output' : `to ${outPath}`}`);
  out.push(`  ${pad(result.verdict, 11)}${file}: ${result.summary.pass} of ${result.summary.total} checks passed`);
  if (result.verdict === 'VERIFIED') {
    out.push('  so this is the document the manifest declares. what a passing verdict does not mean');
    out.push('  is not a short list, and `charter verify` prints all five statements of it.');
  } else {
    out.push('  so these are the bytes the container holds, and this file does not verify: run');
    out.push('  `charter verify` for what did not check out.');
  }
  out.push('');
  return `${out.join('\n')}\n`;
}


/**
 * `charter open <file.charter> [-o <out.md>] [--force]`
 *
 * Writes out the bytes of the content entry, so the document a file carries can
 * be read without a second unzip of the container — which is otherwise the only
 * way to get it, and a way that checks nothing at all.
 *
 * What it will not do is hand over an entry it cannot justify calling *the
 * document*. A container whose manifest cannot be read, whose format this build
 * does not implement, or which holds no content entry is refused: in each of those
 * the entry names have no fixed meaning, so calling one of them the document would
 * be a guess rather than a reading.
 *
 * The verdict is printed beside what was written, and it is not a gate. A tampered
 * document still comes out, with `BROKEN` next to it, because recovering a document
 * from a damaged container is a real thing to need and the alternative is a tool
 * that keeps someone's own document from them.
 *
 * @param {string[]} argv everything after the subcommand
 * @returns {Promise<number>}
 */
async function runOpen(argv) {
  const parsed = readArguments(argv, { '-o': 'value', '--out': 'value', '--force': 'flag' });
  if ('error' in parsed) return usageError(`charter open: ${parsed.error}`);
  const file = oneName(parsed.names, 'no file was named', 'only one file may be opened at a time, and two were named');
  if ('error' in file) return usageError(`charter open: ${file.error}`);

  const input = await readFileBytes(file.name);
  if (!input.ok) {
    return refusal('open', REASON.MISSING, `${file.name} could not be read: ${input.detail}`, EXIT_NO_INPUT);
  }

  const read = await readCharter(input.bytes);
  if (!read.ok) {
    return refusal(
      'open',
      read.reason_code,
      `${file.name}: nothing in this file could be read as a manifest, so nothing in it can be named as the document (${read.detail})`,
      EXIT_REFUSED,
    );
  }

  const result = await verify(input.bytes);
  const formatCheck = result.checks.find((check) => check.id === 'L0.FORMAT.IDENTIFIER');
  if (formatCheck === undefined || formatCheck.status !== 'PASS') {
    return refusal(
      'open',
      REASON.UNSUPPORTED_FEATURE,
      `${file.name} declares ${read.claims.format}, and this build implements charter/0.1: the entry names this format fixes mean nothing under another version, so no entry is written out as the document`,
      EXIT_REFUSED,
    );
  }

  if (read.content === null) {
    return refusal(
      'open',
      REASON.MISSING,
      `${file.name} holds no readable content entry, so there is no document to write out`,
      EXIT_REFUSED,
    );
  }

  const named = parsed.options['-o'] ?? parsed.options['--out'];
  const outPath = typeof named === 'string' ? named : null;
  if (outPath !== null && parsed.options['--force'] !== true && (await exists(outPath))) {
    return refusal(
      'open',
      REASON.EXTRA,
      `${outPath} already exists, and a document that is overwritten is one nobody asked to lose; pass --force to overwrite it`,
      EXIT_NO_OUTPUT,
    );
  }

  if (outPath === null) {
    process.stdout.write(read.content);
  } else {
    const written = await writeOutput(outPath, read.content);
    if (!written.ok) {
      return refusal('open', REASON.MALFORMED, `${outPath} could not be written: ${written.detail}`, EXIT_NO_OUTPUT);
    }
  }

  process.stderr.write(openReport(file.name, result, read.content.length, outPath));
  return 0;
}

/**
 * What keygen wrote, and what it is for.
 *
 * @param {string} path
 * @param {object} pair
 * @returns {string}
 */
function keygenReport(path, pair, passphrase = undefined) {
  /** @type {string[]} */
  const out = [];
  out.push(pair.encrypted ? `wrote  ${path}  (Ed25519 private key, encrypted with a passphrase)` : `wrote  ${path}  (Ed25519 private key, PKCS#8 PEM, not encrypted)`);
  out.push('');
  out.push(`  key id  ${pair.key_id}`);
  out.push('');
  out.push('  this file is the private key. a .charter file carries only the public key, so');
  out.push('  anyone holding this file can sign as you, and nobody can recover it from an');
  out.push('  artifact.');
  out.push('');
  if (pair.encrypted) {
    out.push('  the passphrase is the whole of the protection: this file can be attacked');
    out.push('  offline by anyone who has it, and nothing in it can stop them, so the only');
    out.push('  thing between it and your signature is what each guess costs — scrypt at');
    out.push(`  ${SCRYPT_LOG_N} as log2(N), which is ${Math.round((128 * (2 ** SCRYPT_LOG_N) * SCRYPT_R) / (1024 * 1024))} MiB and about a third of a second per attempt here.`);
    out.push('  Length is the lever you have: a longer passphrase is the only thing that makes');
    out.push('  that number matter. Keep the file where a private key belongs, and pass');
    out.push('  `--passphrase-file <file>` or set CHARTER_PASSPHRASE when you sign with it.');
    if (typeof passphrase === 'string' && passphrase.length < SHORT_PASSPHRASE) {
      out.push('');
      out.push(`  note: that passphrase is ${passphrase.length} characters. This command does not refuse it —`);
      out.push('  the format cannot measure how much a passphrase is worth — but at this cost a');
      out.push('  short one is a short search.');
    }
  } else {
    out.push('  this file is not encrypted, so anyone who can read it can sign as you. To write');
    out.push('  one that is, pass `--encrypt` (which asks for a passphrase), or');
    out.push('  `--passphrase-file <file>`, and read the note it prints.');
  }
  out.push('');
  return `${out.join('\n')}\n`;
}

/**
 * `charter keygen -o <key.pem> [--encrypt] [--force]`
 *
 * Key generation is here for one reason: the key file `seal --key` reads has to
 * come from somewhere, and the other way to make one — `openssl genpkey
 * -algorithm ed25519` — is a tool the user may not have. This writes one file
 * and no store, no lookup, and no copy: a key still belongs to whoever holds it.
 *
 * @param {string[]} argv everything after the subcommand
 * @returns {Promise<number>}
 */
async function runKeygen(argv) {
  const parsed = readArguments(argv, { '-o': 'value', '--out': 'value', '--force': 'flag', '--encrypt': 'flag', '--passphrase-file': 'value' });
  if ('error' in parsed) return usageError(`charter keygen: ${parsed.error}`);
  if (parsed.names.length > 0) {
    return usageError(`charter keygen: keygen writes one file and was given a name it does not act on: ${parsed.names[0]}`);
  }
  const outPath = parsed.options['-o'] ?? parsed.options['--out'];
  if (typeof outPath !== 'string') return usageError('charter keygen: no output file was named; pass -o <key.pem>');

  if (parsed.options['--force'] !== true && (await exists(outPath))) {
    return refusal(
      'keygen',
      REASON.EXTRA,
      `${outPath} already exists, and a key that is overwritten is a key that is lost; pass --force to overwrite it`,
      EXIT_NO_OUTPUT,
    );
  }

  // Whether a key file is encrypted is decided by the command that was typed and not by
  // the environment: `--encrypt` asks for it and `--passphrase-file` implies it, and
  // `CHARTER_PASSPHRASE` alone does not. An environment variable that changed the shape
  // of a generated file would mean two people running the same command on two machines
  // got two different kinds of key, which is the sort of surprise this project spends
  // its tests preventing.
  const encrypt = parsed.options['--encrypt'] === true || typeof parsed.options['--passphrase-file'] === 'string';
  /** @type {string | undefined} */
  let passphrase;
  if (encrypt) {
    const resolved = await passphraseFrom(parsed, 'keygen');
    if ('code' in resolved) return resolved.code;
    passphrase = resolved.passphrase;
  }

  const produced = await produce('keygen', () => generateKeyPair(passphrase === undefined ? {} : { passphrase }));
  if (!produced.ok) return produced.code;

  const written = await writeOutput(outPath, utf8Encode(produced.value.private_text), 0o600);
  if (!written.ok) return refusal('keygen', REASON.MALFORMED, `${outPath} could not be written: ${written.detail}`, EXIT_NO_OUTPUT);

  process.stdout.write(keygenReport(outPath, produced.value, passphrase));
  return 0;
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
  const [command, ...rest] = argv;
  if (rest.includes('--help') || rest.includes('-h')) {
    process.stdout.write(USAGE);
    return 0;
  }

  // Refused centrally rather than inside a verb, so that the rule holds for all of them
  // at once and no later verb can forget it. A passphrase on a command line is kept by
  // the shell's history and is readable from the process list by anything running as
  // the same user, and both of those outlive the command by a long time.
  if (rest.includes('--passphrase')) {
    process.stderr.write(
      "charter: --passphrase is refused: a passphrase on a command line is kept by the shell's\n" +
        'history and is readable from the process list, and both outlive the command.\n' +
        'Pass --passphrase-file <file>, or set CHARTER_PASSPHRASE, or let the command\n' +
        'prompt for one at a terminal.\n',
    );
    return EXIT_USAGE;
  }

  if (command === 'verify') return runVerify(rest);
  if (command === 'seal') return runSeal(rest);
  if (command === 'edit') return runEdit(rest);
  if (command === 'inspect') return runInspect(rest);
  if (command === 'open') return runOpen(rest);
  if (command === 'cite') return runCite(rest);
  if (command === 'keygen') return runKeygen(rest);
  process.stderr.write(`charter: unknown command: ${command}\n\n${USAGE}`);
  return EXIT_USAGE;
}

process.exitCode = await main();


