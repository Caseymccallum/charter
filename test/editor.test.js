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
 * this machine has none. It asks the same 56 artifacts of the browser's copy of
 * the verifier and compares every check status with the reference's, drives the
 * read pane on four fixtures, seals a document and compares the bytes the page
 * wrote with the bytes the command line writes for the same inputs, and asserts
 * that the only requests the page made were for its own files.
 *
 * Between them is the courier, and it is a third kind of evidence: not what the
 * page contains and not what a browser does with it, but what `editor/serve.mjs`
 * answers when the bytes of a hostile request reach it. The rule it implements —
 * the resolved path has to be inside the repository, and the check is on the
 * resolved path rather than on the request — is the boundary that makes serving
 * this tree safe at all, and it is stated in the courier's own prose and in
 * `docs/first-user.md`; this half asks the socket instead, because a boundary
 * that only prose describes is a boundary nobody has measured.
 *
 * @module test/editor
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
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

/* -------------------------------- the courier ------------------------------ */

/**
 * The bytes a chunked response carries, without the chunk framing.
 *
 * HTTP/1.1 lets a response with no `content-length` describe its body in
 * chunks, and `editor/serve.mjs` does: `response.end(body)` with no length set
 * is answered as `transfer-encoding: chunked`. A reader that stopped at the end
 * of the header block would hand the assertions below a body beginning with a
 * hex length rather than with the file — which is what this test did until the
 * page's own bytes were compared and the difference turned out to be an
 * artifact of the reader rather than of the courier.
 *
 * @param {Buffer} body the bytes after the header block
 * @returns {Buffer}
 */
function decodeChunked(body) {
  /** @type {Buffer[]} */
  const parts = [];
  let at = 0;
  while (at < body.length) {
    const lineEnd = body.indexOf('\r\n', at);
    if (lineEnd === -1) break;
    const size = Number.parseInt(body.subarray(at, lineEnd).toString('utf8').split(';')[0].trim(), 16);
    if (!Number.isFinite(size) || size === 0) break;
    parts.push(body.subarray(lineEnd + 2, lineEnd + 2 + size));
    at = lineEnd + 2 + size + 2;
  }
  return Buffer.concat(parts);
}

/**
 * One raw HTTP request, over a socket, and the whole response.
 *
 * The target is written into the request line by hand rather than handed to
 * `fetch` or to `node:http`, because both normalize `..` on the way out: asking
 * one of them for `/vectors/../../package.json` puts `/package.json` on the
 * wire, which is a different question from the one a hostile client asks and an
 * easier one to answer correctly. The rule under test is what the courier does
 * with the bytes that actually reach it, so the bytes are written here.
 *
 * The body is de-chunked when the response says it is chunked, because this
 * returns *the file* and not the transfer of it: what a reader is handed back
 * has to be comparable with the bytes on disk for the assertions below to mean
 * anything.
 *
 * @param {number} port
 * @param {string} target
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: Buffer }>}
 */
function rawGet(port, target) {
  return new Promise((done, failed) => {
    const socket = connect(port, '127.0.0.1');
    /** @type {Buffer[]} */
    const chunks = [];
    socket.on('error', failed);
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('end', () => {
      const whole = Buffer.concat(chunks);
      const bodyAt = whole.indexOf('\r\n\r\n');
      const head = whole.subarray(0, bodyAt).toString('utf8').split('\r\n');
      /** @type {Record<string, string>} */
      const headers = {};
      for (const line of head.slice(1)) {
        const at = line.indexOf(':');
        if (at > 0) headers[line.slice(0, at).toLowerCase()] = line.slice(at + 1).trim();
      }
      const body = whole.subarray(bodyAt + 4);
      done({
        status: Number(head[0].split(' ')[1]),
        headers,
        body: headers['transfer-encoding'] === 'chunked' ? decodeChunked(body) : body,
      });
    });
    socket.end(`GET ${target} HTTP/1.1\r\nhost: 127.0.0.1:${port}\r\nconnection: close\r\n\r\n`);
  });
}

test('the courier hands out this repository, and refuses to climb out of it', async (t) => {
  const served = await serveRepository();
  t.after(() => served.close());

  const address = served.server.address();
  const bound = typeof address === 'object' && address !== null ? address : null;
  const port = bound?.port ?? 0;

  // Bound to loopback, and to `127.0.0.1` rather than to every interface: a
  // courier listening on `0.0.0.0` would be one that hands this repository to
  // whatever can reach the machine.
  assert.equal(bound?.address, '127.0.0.1', 'the courier listens on loopback and not on the network');
  assert.equal(served.origin, `http://127.0.0.1:${port}`);
  assert.equal(served.url, `${served.origin}/editor/`);

  // What it serves: the page, asked for at the root, at the directory the URL
  // names, and by name. A directory asks for its `index.html`; all three are the
  // same bytes, which are the bytes on disk.
  const page = readFileSync(join(EDITOR, 'index.html'));
  for (const target of ['/', '/editor/', '/editor/index.html']) {
    const answer = await rawGet(port, target);
    assert.equal(answer.status, 200, `${target} is a file in this repository`);
    assert.equal(answer.headers['content-type'], 'text/html; charset=utf-8', `${target}`);
    assert.ok(answer.body.equals(page), `${target} answers with the page, byte for byte`);
    assert.equal(
      answer.headers['cache-control'],
      'no-store',
      `${target}: nothing is cached, so the page a reader sees is the page on disk`,
    );
  }

  // The types that matter: `text/javascript` is what makes a browser run the
  // module the page imports, and a `.charter` file is bytes rather than text.
  for (const [target, type] of [
    ['/editor/editor.js', 'text/javascript; charset=utf-8'],
    ['/SPEC.md', 'text/markdown; charset=utf-8'],
    ['/vectors/out/valid.charter', 'application/octet-stream'],
  ]) {
    const answer = await rawGet(port, target);
    assert.equal(answer.status, 200, target);
    assert.equal(answer.headers['content-type'], type, target);
  }
  const artifact = await rawGet(port, '/vectors/out/valid.charter');
  assert.ok(
    artifact.body.equals(readFileSync(join(FIXTURES, 'out', 'valid.charter'))),
    'an artifact is served as the bytes on disk, not re-encoded on the way out',
  );

  // What it refuses, and one thing about *why* it refuses that is easy to get
  // wrong. Every target below comes back 404, and not one of them is refused
  // because the boundary caught it: `/etc/passwd` resolves to `ROOT/etc/passwd`
  // and `/C:/Windows/win.ini` to a name no process ever created, so they are
  // missing files inside the tree rather than escapes from it. A courier with
  // the boundary deleted answers every one of them the same 404. These are the
  // ordinary case — a request for something that is not there — and they are
  // kept because that is what most hostile traffic is.
  for (const target of [
    '/%zz',
    '/C:/Windows/win.ini',
    '/etc/passwd',
    '/editor/index.html%00.txt',
    '/verifier/',
    '/no-such-file.md',
  ]) {
    const answer = await rawGet(port, target);
    assert.equal(answer.status, 404, `${target} is refused`);
    assert.equal(answer.headers['content-type'], 'text/plain; charset=utf-8', target);
    assert.ok(answer.body.toString('utf8').startsWith('not found: '), `${target}: the refusal names the target it refused`);
  }

  // The case that separates the boundary from a missing file, and the reason
  // this half of the test exists at all. A file is written outside the tree —
  // in this machine's temp directory — and asked for through the `..` segments
  // that reach it from here. It *exists*, so a courier that resolved a request
  // and served whatever it landed on would hand it over; the boundary is the
  // only thing that can refuse it. Deleting the `inside` check in
  // `editor/serve.mjs` leaves every 404 above unchanged and turns this one into
  // a 200, which is how this test was measured before it was trusted.
  const outside = join(tmpdir(), `charter-courier-${process.pid}.txt`);
  writeFileSync(outside, 'this file is not in the repository\n');
  t.after(() => rmSync(outside, { force: true }));
  const escape = relative(ROOT, outside).split(sep).join('/');
  assert.ok(
    escape.startsWith('../'),
    `temp is not reachable from ${ROOT} by going up (it would be ${escape}), so this test cannot ask the question it is here to ask`,
  );
  const refused = await rawGet(port, `/${escape}`);
  assert.equal(refused.status, 404, `a file that exists outside the repository is refused: /${escape}`);
  assert.equal(
    refused.body.toString('utf8').includes('not in the repository'),
    false,
    'the refusal does not carry the bytes it refused to serve',
  );

  // And the other side of the same rule, which is what makes it a rule about the
  // resolved path rather than a substring check on the request. There is a
  // `package.json` in this repository; a `..` that walks out and back in is not
  // an escape, and is served. Both of these are behavior the courier's own prose
  // claims about itself, asked of the socket instead of read as a sentence.
  assert.equal((await rawGet(port, '/package.json')).status, 200, 'the repository has a package.json');
  assert.equal(
    (await rawGet(port, `/../${basename(ROOT)}/package.json`)).status,
    200,
    'a `..` that resolves back inside the tree is served: the check is on the resolved path, not on the request',
  );
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
 * The test context is taken rather than the caller taking the cleanup, because
 * this function owns a directory and a process from the moment it makes them, and
 * a browser that never becomes reachable has no handle for a caller to close: the
 * only place that can clean up after a failure here is here.
 *
 * @param {import('node:test').TestContext} t
 * @param {string} browser
 * @param {string} url
 * @param {string} downloads
 * @returns {Promise<object>}
 */
async function openBrowser(t, browser, url, downloads) {
  const profile = mkdtempSync(join(tmpdir(), 'charter-editor-profile-'));

  /**
   * Remove the profile, once the last process holding it has let go.
   *
   * The browser's helpers keep their files open for a moment after the browser
   * reports itself done, and a directory something still holds cannot be removed
   * on Windows, so this polls rather than trying once. It does not throw: a temp
   * directory that could not be removed is a leak worth knowing about, but it is
   * not a fact about charter, and it must not fail this suite nor keep the
   * courier in the caller from being closed after it.
   *
   * @returns {Promise<void>}
   */
  async function removeProfile() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        return;
      } catch {
        await new Promise((done) => setTimeout(done, 250));
      }
    }
  }

  /**
   * The process this file spawned — Chrome's launcher, which is not its browser.
   *
   * Held in a `let` so the hook below can be registered before it exists: that
   * hook is what cleans up when spawning or connecting fails, and a hook naming a
   * binding still in its temporal dead zone throws instead of cleaning.
   *
   * @type {import('node:child_process').ChildProcess | null}
   */
  let child = null;
  /** Set once a handle has gone back to the caller, which then owns all of this. */
  let handedBack = false;

  // Registered before anything can throw, because a hook registered after the
  // work that fails is a cleanup the failure skips. This function can fail in
  // five places: a browser that never writes DevToolsActivePort, one whose
  // devtools endpoint never answers, a response that is not JSON, no page target
  // among the targets, and a socket that never opens. Until a handle goes back,
  // this hook ends the browser and removes the directory; afterwards `close`
  // does, and this steps aside.
  t.after(async () => {
    if (handedBack) return;
    if (child !== null && child.exitCode === null && child.signalCode === null) child.kill();
    await removeProfile();
  });

  // Nothing is piped to or from the browser. Its output is read by nothing, and a
  // browser that outlives the test holding a pipe it inherited keeps the runner
  // waiting on a handle it cannot close — a hang, in place of the exit it should
  // have been.
  child = spawn(
    browser,
    ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, url],
    { stdio: 'ignore' },
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
  handedBack = true;
  return {
    evaluate,
    errors,
    send,
    product: version.result.product,
    jsVersion: version.result.jsVersion,
    close: async () => {
      // The process this file spawned is Chrome's launcher, not its browser: it
      // exits as soon as the browser process is up, so killing it reaches
      // nothing. What is left running is the browser itself — a renderer, a GPU
      // process and a crash handler under it — holding the profile open and
      // outliving the test. Asking the browser to close over the same protocol
      // this file already speaks is what ends that whole tree; a browser that is
      // never ended is a leaked profile of tens of megabytes per run, and a
      // leaked process tree, for the life of the machine.
      //
      // Asked with a deadline: a browser that is already gone does not answer,
      // and a test that waits for an answer that never comes does not finish.
      await Promise.race([
        send('Browser.close').catch(() => {}),
        new Promise((done) => setTimeout(done, 5000)),
      ]);
      socket.close();
      if (child.exitCode === null && child.signalCode === null) {
        const ended = new Promise((done) => child.once('exit', done));
        child.kill();
        await ended;
      }
      await removeProfile();
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

/**
 * Whether this runtime has the global a browser is driven through.
 *
 * The page is driven over the DevTools Protocol, which is a WebSocket, and Node
 * has exposed one as a global only since 22. A runtime without it is not a
 * failure of this project: the floor declared for the format is Node 20.12
 * (SPEC section 12), which is what the *verifier* needs, and a runtime that
 * verifies a charter correctly should not be told its suite is broken because it
 * cannot also drive Chrome. So the browser tests skip there, the way they skip on
 * a machine with no browser installed at all.
 */
const DRIVABLE = typeof WebSocket === 'function';

test('the editor in a real browser', { timeout: 300000 }, async (t) => {
  if (BROWSER === null) {
    t.skip('no browser found: set CHARTER_BROWSER to the path of one to run these tests');
    return;
  }
  if (!DRIVABLE) {
    t.skip(`driving a browser needs the WebSocket global, which ${process.version} does not have: Node 22 or later runs these tests`);
    return;
  }

  /** @type {string[]} */
  const requests = [];
  const served = await serveRepository();
  served.server.on('request', (request) => requests.push(request.url ?? '/'));
  const downloads = mkdtempSync(join(tmpdir(), 'charter-editor-downloads-'));

  /**
   * The browser, once it is up.
   *
   * Held in a `let` so the hook below can be registered before the browser is
   * opened: opening it can fail, and a hook registered under the line that throws
   * never runs — and a courier that is never closed is a listening server, which
   * is a run that does not end.
   *
   * @type {object | null}
   */
  let browser = null;
  t.after(async () => {
    if (browser !== null) await browser.close();
    await served.close();
    rmSync(downloads, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  browser = await openBrowser(t, BROWSER, served.url, downloads);

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
    // This directory holds a private key, so it is the one temp directory here
    // that must not outlive the test that made it.
    t.after(() => rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
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
