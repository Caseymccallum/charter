#!/usr/bin/env node
/**
 * Serve the repository on loopback, so a browser will load the editor.
 *
 * This is a courier, not a server the editor needs: `editor/index.html` is a
 * static page with no build step, and the only thing it asks the network for is
 * its own modules — which a browser refuses to fetch from a `file://` page
 * ("Access to script at 'file:///...' from origin 'null' has been blocked by
 * CORS policy: Cross origin requests are only supported for protocol schemes:
 * chrome, chrome-extension, chrome-untrusted, data, http, https, isolated-app",
 * measured in Chrome 153.0.8010.37, and true of every browser that implements
 * modules). Files and mime types are the whole of it: nothing is proxied,
 * nothing is written, nothing leaves this machine, and the process ends when
 * you stop it.
 *
 * Usage:
 *   node editor/serve.mjs              serve the repository, open the editor
 *   node editor/serve.mjs --no-open    serve it and print the URL only
 *   node editor/serve.mjs --port 8080  serve on a port of your choosing
 *
 * `test/editor.test.js` calls `serveRepository` for the same reason a reader
 * does: this is how a file in this repository reaches a browser, and a test that
 * served it a second, subtly different way would be testing that way.
 *
 * @module editor/serve
 */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.pem': 'text/plain; charset=utf-8',
  '.charter': 'application/octet-stream',
};

/**
 * The file a request is for, or null when it is outside the repository.
 * `normalize` collapses `..` before the result is checked, so a request cannot
 * climb out of the tree this process was started in.
 *
 * @param {string} urlPath
 * @returns {string | null}
 */
function fileFor(urlPath) {
  let path;
  try {
    path = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  const wanted = normalize(join(ROOT, path === '/' ? '/editor/index.html' : path.endsWith('/') ? `${path}index.html` : path));
  const inside = wanted === ROOT || wanted.startsWith(`${ROOT}${sep}`);
  return inside ? wanted : null;
}

/**
 * Start the courier.
 *
 * @param {{ port?: number }} [options]
 * @returns {Promise<{ server: import('node:http').Server, origin: string, url: string, close: () => Promise<void> }>}
 */
export async function serveRepository(options = {}) {
  const server = createServer((request, response) => {
    const file = fileFor(request.url ?? '/');
    /** @type {Buffer} */
    let body;
    try {
      if (file === null) throw new Error('outside the repository');
      body = readFileSync(file);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(`not found: ${request.url ?? '/'}\n`);
      return;
    }
    response.writeHead(200, {
      'content-type': TYPES[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    response.end(body);
  });
  await new Promise((listening) => server.listen(options.port ?? 0, '127.0.0.1', listening));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    server,
    origin: `http://127.0.0.1:${port}`,
    url: `http://127.0.0.1:${port}/editor/`,
    close: () => new Promise((done) => server.close(() => done(undefined))),
  };
}

/**
 * @param {string[]} argv
 * @param {string} name
 * @returns {string | null} the value after `--name`, or null
 */
function option(argv, name) {
  const at = argv.indexOf(name);
  return at < 0 || at === argv.length - 1 ? null : argv[at + 1];
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const served = await serveRepository({ port: Number(option(process.argv, '--port') ?? 0) });
  console.log(`charter editor  ${served.url}`);
  console.log(`serving         ${ROOT}`);
  console.log('                (static files only: no dependency, no build, nothing sent anywhere; ctrl-c stops it)');
  if (!process.argv.includes('--no-open')) {
    const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', served.url]] : process.platform === 'darwin' ? ['open', [served.url]] : ['xdg-open', [served.url]];
    try {
      spawn(/** @type {string} */ (opener[0]), /** @type {string[]} */ (opener[1]), { stdio: 'ignore', detached: true }).unref();
    } catch {
      console.log('open it yourself: the URL above');
    }
  }
}
