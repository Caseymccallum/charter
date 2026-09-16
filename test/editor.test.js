/**
 * The editor: a page that makes the format's claim visible, and the rules it is
 * held to for being allowed to be one.
 *
 * Two halves, and they are different kinds of evidence.
 *
 * The first half is static and always runs: what the page imports, what it may
 * not import, and what it may not reach for. The editor is the format's second
 * browser-safe consumer, so the rule `test/purity.test.js` states for the first
 * one is stated here for this one — imports only from `verifier/**`, no `node:`
 * module, no network, no store, no dynamic code — with one addition: the page
 * itself may name no external resource, so a reader can see that it has nowhere
 * to send anything.
 *
 * The second half runs the page in a real browser, and is skipped cleanly when
 * this machine has none. It asks the same 54 artifacts of the browser's copy of
 * the verifier and compares every check status with the reference's, drives the
 * read pane on four fixtures, seals a document and compares the bytes the page
 * wrote with the bytes the command line writes for the same inputs, and asserts
 * that the only requests the page made were for its own files.
 *
 * @module test/editor
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serveRepository } from '../editor/serve.mjs';
import { generateKeyPair } from '../producer/key.js';
import { verify } from '../verifier/verify.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const EDITOR = join(ROOT, 'editor');
const FIXTURES = join(ROOT, 'vectors');
const RECORD = JSON.parse(readFileSync(join(FIXTURES, 'expected.json'), 'utf8'));

const PAGE = readFileSync(join(EDITOR, 'index.html'), 'utf8');
const MODULE = readFileSync(join(EDITOR, 'editor.js'), 'utf8');

/**
 * Strip comments and string literals, so that a rule matches code rather than
 * prose. The editor's messages name words like `localStorage` on purpose — "not
 * written to localStorage" is the page telling the truth — and a rule that could
 * not tell a promise from a call would push the next author to delete the
 * promise in order to pass.
 *
 * @param {string} text
 * @returns {string}
 */
function codeOnly(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

/** Every script body in the page, which is the code the editor ships. */
function pageScripts() {
  return [...PAGE.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]).join('\n');
}

/** @type {[string, RegExp][]} */
const FORBIDDEN = [
  ['the network', /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|serviceWorker|\bcaches\b/],
  ['a store', /localStorage|sessionStorage|indexedDB|document\.cookie/],
  ['dynamic code', /\beval\s*\(|new\s+Function\s*\(/],
  ['a timer', /\bsetTimeout\s*\(|\bsetInterval\s*\(|requestAnimationFrame/],
  ['a runtime module', /\bfrom\s+['"]node:/],
  ['the producer', /\.\.\/producer\//],
  ['a dynamic import', /\bimport\s*\(/],
  ['the file system', /\bnode:fs\b|readFileSync|writeFileSync/],
  ['a random source', /\bMath\.random\b/],
];

test('the editor imports the verifier — and the writers in it — and nothing else', () => {
  const specifiers = [...MODULE.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
  assert.ok(specifiers.length >= 10, `expected the editor's imports, found ${specifiers.length}`);
  for (const specifier of specifiers) {
    assert.ok(specifier.startsWith('../verifier/'), `editor/editor.js imports ${specifier}: only ../verifier/** is allowed`);
    assert.ok(existsSync(join(EDITOR, specifier)), `editor/editor.js imports ${specifier}, which is not a file`);
  }
  // The editor writes a container and encodes keys and signatures, so both
  // writers must be the shared ones rather than copies of them.
  for (const shared of ['../verifier/zip-write.js', '../verifier/base64url-write.js', '../verifier/canonical-write.js', '../verifier/verify.js']) {
    assert.ok(specifiers.includes(shared), `the editor must take ${shared} from the verifier`);
  }

  // The same rule for everything the editor reaches: a browser cannot load a
  // `node:` module, so one anywhere in the closure is a page that does not open.
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {string[]} */
  const queue = specifiers.map((specifier) => resolve(EDITOR, specifier));
  while (queue.length > 0) {
    const file = /** @type {string} */ (queue.pop());
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of readFileSync(file, 'utf8').matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      assert.ok(!specifier.startsWith('node:'), `${file} imports ${specifier}, which a browser cannot load`);
      assert.ok(specifier.startsWith('./'), `${file} imports ${specifier}: the verifier's modules are relative`);
      queue.push(resolve(dirname(file), specifier));
    }
  }
  assert.ok(seen.size >= 15, `expected the editor's whole import closure, found ${seen.size} modules`);
});

test('the editor reaches for nothing outside the page', () => {
  for (const [where, text] of [['editor/editor.js', codeOnly(MODULE)], ['editor/index.html (scripts)', codeOnly(pageScripts())]]) {
    for (const [what, pattern] of FORBIDDEN) {
      const found = text.match(pattern);
      assert.equal(found, null, `${where} uses ${what}: ${found === null ? '' : found[0]}`);
    }
  }

  // The page names its own file and a data: URL, and nothing else, so there is
  // nowhere for it to send anything even if it wanted to.
  for (const match of PAGE.matchAll(/\b(?:src|href)\s*=\s*"([^"]*)"/g)) {
    const target = match[1];
    const own = target.startsWith('./') || target.startsWith('../') || target.startsWith('data:') || target.startsWith('#');
    assert.ok(own, `editor/index.html names ${target}, which is not a file in this repository`);
  }
  assert.equal(/@import|url\(\s*['"]?https?:/.test(PAGE), false, 'the page pulls in nothing from outside');
  assert.ok(PAGE.includes('href="data:,"'), 'the favicon is a data: URL, so not even a favicon request is made');
});

test('the editor is served by one courier, and the courier is the only node: file', () => {
  const names = readdirSync(EDITOR);
  assert.deepEqual(names.filter((name) => name.endsWith('.js') || name.endsWith('.mjs')).sort(), ['editor.js', 'serve.mjs']);
  const couriers = names.filter((name) => /\bfrom\s+['"]node:/.test(readFileSync(join(EDITOR, name), 'utf8')));
  assert.deepEqual(couriers, ['serve.mjs'], 'the page may not import a runtime module; the courier that hands it to a browser may');
  assert.ok(names.includes('index.html'), 'the page is editor/index.html');
  const readme = readFileSync(join(EDITOR, 'README.md'), 'utf8');
  assert.ok(readme.includes('demonstration'), 'the README says what this is: a demonstration');
  assert.ok(readme.includes('serve.mjs'), 'the README says how to open it');
});

/* -------------------------- the browser, if there is one ------------------- */

/**
 * A browser on this machine, or null.
 *
 * `CHARTER_BROWSER` overrides everything, which is how a reader with a browser
 * in an unusual place runs these tests. Otherwise the two browsers that ship
 * with a typical Windows or macOS machine are looked for by name. Nothing is
 * downloaded and nothing is installed: a machine without one skips the tests
 * below and says so.
 *
 * @returns {string | null}
 */
function findBrowser() {
  /** @type {(string | undefined)[]} */
  const candidates = [process.env.CHARTER_BROWSER, process.env.CHROME_PATH];
  const programFiles = process.env.PROGRAMFILES ?? '';
  const programFilesX86 = process.env['PROGRAMFILES(X86)'] ?? '';
  const local = process.env.LOCALAPPDATA ?? '';
  if (process.platform === 'win32') {
    candidates.push(
      join(programFiles, 'Google/Chrome/Application/chrome.exe'),
      join(programFilesX86, 'Google/Chrome/Application/chrome.exe'),
      join(local, 'Google/Chrome/Application/chrome.exe'),
      join(programFilesX86, 'Microsoft/Edge/Application/msedge.exe'),
      join(programFiles, 'Microsoft/Edge/Application/msedge.exe'),
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    );
  } else {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge');
  }
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate !== '' && existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Open a page in a headless browser and talk to it the way its dev tools do.
 *
 * The DevTools Protocol over the WebSocket that Node has had since 22: no
 * dependency, no `puppeteer`, and nothing to install. Every call this returns
 * runs in the page, which is the point — the tests below are asking a browser,
 * not a simulation of one.
 *
 * @param {string} browser
 * @param {string} url
 * @param {string} downloads
 * @returns {Promise<object>}
 */
async function openBrowser(browser, url, downloads) {
  const profile = mkdtempSync(join(tmpdir(), 'charter-editor-profile-'));
  const child = spawn(
    browser,
    ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, url],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const port = await new Promise((found, failed) => {
    const started = Date.now();
    const timer = setInterval(() => {
      let value;
      try {
        value = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim();
      } catch {
        if (Date.now() - started > 30000) {
          clearInterval(timer);
          failed(new Error(`${browser} never wrote DevToolsActivePort`));
        }
        return;
      }
      if (value === '') return;
      clearInterval(timer);
      found(Number(value));
    }, 200);
  });

  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((entry) => entry.type === 'page');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((open) => socket.addEventListener('open', open));

  /** @type {Map<number, (message: any) => void>} */
  const pending = new Map();
  /** @type {string[]} */
  const errors = [];
  let next = 0;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      errors.push(`${message.params.entry.source}: ${message.params.entry.text}`);
    }
    if (message.method === 'Runtime.exceptionThrown') {
      errors.push(`exception: ${message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text}`);
    }
    const waiting = pending.get(message.id);
    if (waiting !== undefined) {
      pending.delete(message.id);
      waiting(message);
    }
  });
  const send = (method, params = {}) =>
    new Promise((answered) => {
      next += 1;
      pending.set(next, answered);
      socket.send(JSON.stringify({ id: next, method, params }));
    });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });

  // A browser may start with a blank tab before the one it was asked for, and
  // the blank tab is an opaque origin with no `crypto.subtle` at all — the very
  // thing this page needs. So the page is asked for by name and waited for.
  await send('Page.navigate', { url });
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const here = await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
    if (here.result?.result?.value === url) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  /**
   * @param {string} expression
   * @returns {Promise<any>}
   */
  async function evaluate(expression) {
    const answered = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    const thrown = answered.result?.exceptionDetails;
    if (thrown !== undefined) throw new Error(`the page threw: ${thrown.exception?.description ?? thrown.text}`);
    return answered.result.result.value;
  }

  const version = await send('Browser.getVersion');
  return {
    evaluate,
    errors,
    send,
    product: version.result.product,
    jsVersion: version.result.jsVersion,
    close: async () => {
      socket.close();
      child.kill();
    },
  };
}

/**
 * The five things the kit compares, out of a verdict.
 *
 * @param {{ checks: import('../verifier/status.js').CheckResult[] }} result
 * @returns {{ fail: Record<string, string>, unsupported: Record<string, string>, skips: number }}
 */
function tally(result) {
  /** @type {Record<string, string>} */
  const fail = {};
  /** @type {Record<string, string>} */
  const unsupported = {};
  let skips = 0;
  for (const check of result.checks) {
    if (check.status === 'FAIL') fail[check.id] = check.reason_code;
    else if (check.status === 'UNSUPPORTED') unsupported[check.id] = check.reason_code;
    else if (check.status === 'SKIP') skips += 1;
  }
  return { fail, unsupported, skips };
}

/**
 * Drop bytes onto the page as a file and wait for the verdict about them.
 *
 * The file is made with the browser's own `File` and `DataTransfer` and sent
 * through the page's own drop handler, so this drives the editor a person drives
 * it. Everything it reports is read out of the DOM.
 *
 * @param {object} browser
 * @param {string} name
 * @param {Buffer} bytes
 * @returns {Promise<any>}
 */
function drop(browser, name, bytes) {
  const encoded = JSON.stringify(bytes.toString('base64'));
  const label = JSON.stringify(name);
  return browser.evaluate(`(async () => {
    const bytes = Uint8Array.from(atob(${encoded}), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], ${label}));
    document.getElementById('dropzone').dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (document.getElementById('document-name').textContent.startsWith(${label})) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return {
      name: document.getElementById('document-name').textContent,
      verdict: document.querySelector('.verdict')?.textContent ?? null,
      counts: document.querySelector('.counts')?.textContent ?? null,
      reasons: document.querySelector('.reasons')?.textContent ?? null,
      checks: document.querySelectorAll('#checks .check').length,
      failed: [...document.querySelectorAll('#checks .check-fail .id')].map((node) => node.textContent),
      skipped: document.querySelectorAll('#checks .check-skip').length,
      caveats: [...document.querySelectorAll('#caveats .caveat-id')].map((node) => node.textContent),
      caveatText: document.getElementById('caveats').textContent,
      entries: [...document.querySelectorAll('#entries tr')].map((row) => [...row.children].map((cell) => cell.textContent.trim())),
      entriesNote: document.getElementById('entries-note').textContent,
      content: document.querySelector('#content pre')?.textContent ?? null,
      contentText: document.getElementById('content').textContent,
      contentNote: document.getElementById('content-note').textContent,
      json: document.querySelector('#json pre')?.textContent ?? null,
    };
  })()`);
}

/** @type {string | null | undefined} */
let pythonPath;

/**
 * The Python implementation, when this machine has one.
 *
 * The tests that use it are skipped rather than failed when it is absent: a
 * reader who cloned this repository to look at the format should not need a
 * second language installed to run its test suite.
 *
 * @returns {string | null}
 */
function pythonFor() {
  if (pythonPath !== undefined) return pythonPath;
  for (const candidate of ['python', 'python3', 'py']) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (probe.status === 0) {
      pythonPath = candidate;
      return candidate;
    }
  }
  pythonPath = null;
  return null;
}

/**
 * The file the page offered, once the browser has finished writing it. A file
 * still in flight carries Chrome's `.crdownload` suffix, so it is not a file yet.
 *
 * @param {string} directory
 * @returns {Promise<string | null>}
 */
async function waitForDownload(directory) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const files = readdirSync(directory).filter((name) => !name.endsWith('.crdownload'));
    if (files.length > 0) return join(directory, files[0]);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

const BROWSER = findBrowser();

test('the editor in a real browser', { timeout: 300000 }, async (t) => {
  if (BROWSER === null) {
    t.skip('no browser found: set CHARTER_BROWSER to the path of one to run these tests');
    return;
  }

  /** @type {string[]} */
  const requests = [];
  const served = await serveRepository();
  served.server.on('request', (request) => requests.push(request.url ?? '/'));
  const downloads = mkdtempSync(join(tmpdir(), 'charter-editor-downloads-'));
  const browser = await openBrowser(BROWSER, served.url, downloads);

  t.after(async () => {
    await browser.close();
    await served.close();
  });

  /** Wait until the page has wired itself up. */
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await browser.evaluate("document.getElementById('w-time-readout').textContent !== ''")) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const ready = await browser.evaluate("document.getElementById('w-time-readout').textContent !== ''");
  assert.equal(ready, true, 'the page never wired itself up, so its module did not run');
  t.diagnostic(`browser: ${browser.product} (${browser.jsVersion})`);

  await t.test("the browser's copy of the verifier reproduces every recorded verdict", async () => {
    for (const entry of RECORD.cases) {
      const bytes = readFileSync(join(FIXTURES, entry.file));
      const encoded = JSON.stringify(bytes.toString('base64'));
      const seen = await browser.evaluate(`(async () => {
        const bytes = Uint8Array.from(atob(${encoded}), (c) => c.charCodeAt(0));
        const { verify } = await import('/verifier/verify.js');
        const result = await verify(bytes);
        const fail = {};
        const unsupported = {};
        let skips = 0;
        for (const check of result.checks) {
          if (check.status === 'FAIL') fail[check.id] = check.reason_code;
          else if (check.status === 'UNSUPPORTED') unsupported[check.id] = check.reason_code;
          else if (check.status === 'SKIP') skips += 1;
        }
        return {
          verdict: result.verdict,
          exit_code: result.exit_code,
          fail,
          unsupported,
          skips,
          statuses: result.checks.map((check) => check.id + '=' + check.status),
          limitations: result.limitations.length,
        };
      })()`);
      const reference = await verify(new Uint8Array(bytes));
      const mine = tally(reference);
      assert.equal(seen.verdict, entry.expected.verdict, `${entry.name}: verdict`);
      assert.equal(seen.exit_code, entry.expected.exit_code, `${entry.name}: exit code`);
      assert.deepEqual(seen.fail, entry.expected.fail, `${entry.name}: failing checks`);
      assert.deepEqual(seen.unsupported, entry.expected.unsupported, `${entry.name}: unsupported checks`);
      assert.equal(seen.skips, entry.expected.skips, `${entry.name}: checks not reached`);
      assert.deepEqual(seen.fail, mine.fail, `${entry.name}: the browser and this runtime disagree about a failure`);
      assert.deepEqual(seen.unsupported, mine.unsupported, `${entry.name}: the browser and this runtime disagree about an unsupported check`);
      assert.deepEqual(seen.statuses, reference.checks.map((check) => `${check.id}=${check.status}`), `${entry.name}: every check status must match`);
      assert.equal(seen.limitations, reference.limitations.length, `${entry.name}: the caveats travel with the verdict`);
    }
  });

  await t.test('the read pane shows what a file claims beside whether the claim holds', async () => {
    const valid = await drop(browser, 'valid.charter', readFileSync(join(FIXTURES, 'out/valid.charter')));
    assert.equal(valid.verdict, 'VERIFIED');
    assert.equal(valid.checks, 30, 'every check is listed, not only the ones that failed');
    assert.equal(valid.entries.length, 2, 'both provenance entries are listed');
    assert.ok((valid.content ?? '').includes('Charter'), 'the document is shown beside the verdict');
    assert.equal(valid.caveats.length, 5, 'what a VERIFIED verdict does not mean is shown with it');
    assert.notEqual(valid.json, null, 'the verdict is available in the shape --json prints');

    const tampered = await drop(browser, 'content-tampered.charter', readFileSync(join(FIXTURES, 'out/content-tampered.charter')));
    assert.equal(tampered.verdict, 'BROKEN');
    assert.deepEqual(tampered.failed, ['L0.CONTENT.HASH'], 'the failing check is named');
    assert.ok((tampered.reasons ?? '').includes('L0.CONTENT.HASH (MISMATCH)'), 'and its reason code is beside it');

    const broke = await drop(browser, 'not-a-zip.charter', readFileSync(join(FIXTURES, 'out/not-a-zip.charter')));
    assert.equal(broke.verdict, 'BROKEN');
    assert.deepEqual(broke.failed, ['L0.ZIP.READABLE']);
    assert.equal(broke.skipped, 29, 'a file with no container has 29 checks that never ran, and the page shows them');
    assert.ok(`${broke.contentText}`.includes('could not be read'), 'the page says why there is nothing to show');

    // The case the format's credibility rests on: nothing fails, and the page
    // has to say what that does not mean.
    const rewritten = await drop(browser, 'history-rewritten.charter', readFileSync(join(FIXTURES, 'out/history-rewritten.charter')));
    assert.equal(rewritten.verdict, 'VERIFIED');
    assert.ok(rewritten.caveatText.includes('KEY_HOLDER_CAN_REWRITE_HISTORY'), 'the rewriting caveat is in the UI, not only in the JSON');
    assert.ok(rewritten.caveatText.includes('replace the last entry'), 'and it says what it means');
    assert.ok(rewritten.caveatText.includes('TIMESTAMPS_ARE_CLAIMS'), 'so is the one about timestamps');
    assert.ok(rewritten.entriesNote.includes('TIMESTAMPS_ARE_CLAIMS'), 'the history pane repeats it where the timestamps are');
    assert.equal(rewritten.entries.every((row) => row[row.length - 1] === 'judged'), true, 'every entry of a file that verifies is shown as judged');

    const reordered = await drop(browser, 'log-reordered.charter', readFileSync(join(FIXTURES, 'out/log-reordered.charter')));
    assert.equal(reordered.verdict, 'BROKEN');
    assert.equal(reordered.entries.every((row) => row[row.length - 1].startsWith('not judged')), true, 'entries under a failed chain check are not shown as judged');
  });

  await t.test('a document sealed in the page is the document the command line seals', async () => {
    const work = mkdtempSync(join(tmpdir(), 'charter-editor-seal-'));
    const key = await generateKeyPair();
    const keyPath = join(work, 'key.pem');
    writeFileSync(keyPath, key.private_pem);
    const contentText = '# A browser-sealed draft\n\nSealed in a page, with Web Crypto, by the editor.\n';
    const contentPath = join(work, 'draft.md');
    writeFileSync(contentPath, contentText, 'utf8');
    const fixed = { title: 'A browser-sealed draft', author: 'Casey', summary: 'Sealed in a page.' };

    const page = await browser.evaluate(`(async () => {
      const set = (id, value) => { const node = document.getElementById(id); node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })); };
      set('w-key-text', ${JSON.stringify(key.private_pem)});
      set('w-content', ${JSON.stringify(contentText)});
      set('w-title', ${JSON.stringify(fixed.title)});
      set('w-author', ${JSON.stringify(fixed.author)});
      set('w-summary', ${JSON.stringify(fixed.summary)});
      await new Promise((resolve) => setTimeout(resolve, 300));
      const readout = document.getElementById('w-key-readout').textContent;
      const time = document.getElementById('w-time-readout').textContent;
      document.getElementById('seal').click();
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const message = document.getElementById('w-message');
        if (message.className.includes('message-done') || message.className.includes('message-fail')) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return {
        readout,
        time,
        messageClass: document.getElementById('w-message').className,
        message: document.getElementById('w-message').textContent,
        name: document.getElementById('document-name').textContent,
        verdict: document.querySelector('.verdict')?.textContent ?? null,
        json: document.querySelector('#json pre')?.textContent ?? null,
      };
    })()`);

    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.ok(page.readout.includes(key.key_id), `the page derives the same key id: ${page.readout}`);
    assert.equal(page.messageClass, 'message message-done', `the seal refused: ${page.message}`);
    assert.ok(page.time.includes('1980-01-01T00:00:00Z'), 'with no time stated, the page says which instant the file will carry');

    const downloaded = await waitForDownload(downloads);
    assert.notEqual(downloaded, null, 'the page offered no file to download');
    const bytes = readFileSync(/** @type {string} */ (downloaded));
    assert.ok(bytes.length > 0, 'the download is not empty');

    // The page's own verdict on what it wrote, against this runtime's.
    const shown = JSON.parse(/** @type {string} */ (page.json));
    const reference = await verify(new Uint8Array(bytes));
    assert.equal(shown.verdict, reference.verdict, 'the page and this runtime disagree about the file it just wrote');
    assert.equal(shown.verdict, 'VERIFIED', 'a file sealed by the page must verify');
    assert.deepEqual(shown.summary, reference.summary, 'the page and this runtime disagree about the counts');
    assert.deepEqual(
      shown.checks.map((check) => `${check.id}=${check.status}=${check.reason_code}`),
      reference.checks.map((check) => `${check.id}=${check.status}=${check.reason_code}`),
      'the page and this runtime disagree about a check',
    );
    assert.deepEqual(
      shown.limitations.map((caveat) => caveat.id),
      reference.limitations.map((caveat) => caveat.id),
      'the page and this runtime disagree about the caveats',
    );

    // The strongest statement available: two writers, on two runtimes, produce
    // the same file from the same inputs.
    const cliPath = join(work, 'cli.charter');
    const sealed = spawnSync(
      process.execPath,
      ['cli/charter.js', 'seal', contentPath, '--key', keyPath, '-o', cliPath, '--title', fixed.title, '--author', fixed.author, '--summary', fixed.summary],
      { cwd: ROOT, encoding: 'utf8' },
    );
    assert.equal(sealed.status, 0, `charter seal refused: ${sealed.stdout}${sealed.stderr}`);
    const cliBytes = readFileSync(cliPath);
    assert.equal(
      cliBytes.equals(bytes),
      true,
      `the page and the command line wrote different bytes (${bytes.length} against ${cliBytes.length}) for the same content, key and stated metadata`,
    );

    // And the Python reading of the same file agrees too, where it is installed.
    const python = pythonFor();
    if (python === null) {
      t.diagnostic('the Python implementation was not found, so the browser-made file was read by one implementation rather than two');
      return;
    }
    const read = spawnSync(python, ['-m', 'charter_verify', /** @type {string} */ (downloaded), '--json'], { cwd: join(ROOT, 'implementations', 'python'), encoding: 'utf8' });
    assert.equal(read.status, 0, `the Python verifier exited ${read.status}: ${read.stderr.slice(0, 400)}`);
    const theirs = JSON.parse(read.stdout);
    assert.equal(theirs.verdict, 'VERIFIED', 'the Python implementation must agree about a file the page sealed');
    assert.deepEqual(theirs.summary, reference.summary, 'the Python implementation disagrees about the counts');
  });

  await t.test('the page made no request beyond its own files, and threw nothing', async () => {
    const foreign = requests.filter((path) => !path.startsWith('/editor/') && !path.startsWith('/verifier/'));
    assert.deepEqual(foreign, [], 'the page asked for something that is not its own code');
    assert.equal(requests.includes('/favicon.ico'), false, 'not even a favicon is requested');
    assert.deepEqual(browser.errors, [], 'the page logged an error');
  });
});
