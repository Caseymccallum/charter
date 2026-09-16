/**
 * The producer's one way of refusing.
 *
 * The producer fails in ways the verifier cannot: it is handed keys, and a key
 * can be the wrong algorithm, unreadable, or absent. Every one of those
 * failures is a refusal a caller has to be able to branch on, so every refusal
 * carries a `reason_code` from `verifier/status.js` — the same vocabulary a
 * verdict prints, because a producer with a private set of failure names is a
 * second vocabulary for one format, and a caller who has to learn both will
 * confuse them eventually.
 *
 * `refuse()` checks the code against that vocabulary at the moment it is used,
 * which is the producer's half of the rule `verifier/result.js` enforces for
 * check ids: a name that is not in the registry is a bug, not a new failure.
 *
 * # `ProducerError` is a subclass, and that is on purpose
 *
 * `RefusalError` in `verifier/refuse.js` is the shared class, because the
 * producer is not the only thing in this project that writes: the ZIP writer
 * refuses from inside `verifier/**` (a page may import it, so it may not import
 * this file), and the editor refuses in the same vocabulary from a browser.
 * `ProducerError` stays, because "the producer refused" is a different fact
 * from "a writer refused": a caller that wants the narrower one can ask for it,
 * and one that wants either can catch `RefusalError`.
 *
 * @module producer/errors
 */

import { isReasonCode, RefusalError } from '../verifier/refuse.js';

/**
 * A refusal the producer can name.
 *
 * @augments RefusalError
 */
export class ProducerError extends RefusalError {
  /**
   * @param {string} reason_code from the vocabulary in `verifier/status.js`
   * @param {string} detail what is wrong, in prose, for a person
   * @param {string} [path] the field or file the refusal is about
   */
  constructor(reason_code, detail, path = '') {
    super(reason_code, detail, path);
    this.name = 'ProducerError';
  }
}

/**
 * Refuse to write, in the vocabulary the verifier reads.
 *
 * @param {string} reason_code one of `REASON`'s values
 * @param {string} detail what is wrong, in prose
 * @param {string} [path] the field or file the refusal is about
 * @returns {never}
 */
export function refuse(reason_code, detail, path = '') {
  if (!isReasonCode(reason_code)) {
    throw new TypeError(`the producer refused with "${reason_code}", which is not a reason code this format defines`);
  }
  throw new ProducerError(reason_code, detail, path);
}

/**
 * @param {unknown} cause the error a runtime call threw
 * @returns {string} one line of it, for a detail message
 */
export function describeCause(cause) {
  if (cause instanceof Error && typeof cause.message === 'string' && cause.message !== '') {
    return cause.message;
  }
  return 'the runtime gave no further detail';
}
