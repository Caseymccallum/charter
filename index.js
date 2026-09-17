/**
 * The reference implementation, for a program that is not this one.
 *
 * Everything in this project so far has been for two audiences: a person at a command
 * line, and a person reading `SPEC.md`. This file is for the third one — a program that
 * wants to check a `.charter` file from inside itself: an editor plugin, a build step, a
 * repository's pre-commit hook, a preservation system's ingest queue, a page.
 *
 * # Why this file is at the root and not in `verifier/`
 *
 * `test/declarations.test.js` enforces a rule over `verifier/**`: every constant a
 * module there exports is either a claim `SPEC.md` makes a second time, named by a row
 * in the registry, or exempted with a reason. That rule is about *modules that state
 * rules*. This file states none — it names what already exists, and every name it
 * re-exports is covered by that audit where it is defined. Putting an index inside
 * `verifier/**` would have made the audit ask about a surface rather than about a
 * declaration, and the honest boundary is the directory.
 *
 * # It is pure, and that is a promise a test holds
 *
 * Nothing reachable from this file imports `node:`, reads a file, or uses a clock,
 * because everything it reaches is `verifier/**` and that directory may not. So this
 * entry point runs unchanged in a browser, in a worker, and in Deno: a page that wants
 * to show a verdict can import it and pass bytes.
 *
 * # What is here, and what is deliberately not
 *
 * Here: the verdict (`verify`), the vocabularies a caller branches on (`VERDICT`,
 * `EXIT_CODE`, `REASON`, `STATUS`), the statements a verdict prints about itself
 * (`CAVEATS`), and the numbers it refuses past (`LIMITS`).
 *
 * Not here: anything that writes. Sealing and editing need a private key, a random
 * source and a clock, which is the other half of the project and lives behind
 * `charter-cli/producer`.
 *
 * Also not here, and reachable on purpose: the modules that *walk* a container —
 * `charter-cli/verifier/zip.js`, `provenance.js`, `canonical.js`, `bytes.js` — because
 * showing a reader the document and the history inside a file means parsing a ZIP and a
 * canonical JSON log, and telling someone to write their own would be telling them to
 * disagree with this project about what the bytes are. The narrow surface above is the
 * stable one; those are available rather than promised.
 *
 * @module index
 */

export { ENTRY_CONTENT, ENTRY_MANIFEST, ENTRY_PROVENANCE, REQUIRED_ENTRIES, verify } from './verifier/verify.js';
export { ALGORITHM, FORMAT } from './verifier/manifest.js';
export { CAVEATS } from './verifier/caveats.js';
export { LIMITS } from './verifier/limits.js';
export { isReasonCode, RefusalError } from './verifier/refuse.js';
export { CHECK_IDS, CHECK_REGISTRY, EXIT_CODE, LEVEL, REASON, STATUS, VERDICT } from './verifier/status.js';