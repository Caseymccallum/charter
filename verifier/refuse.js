/**
 * The writing half's one way of refusing.
 *
 * The reading path never throws to say something is wrong: it records a result
 * for a check, with a reason code, and `verifier/result.js` refuses an id, a
 * status or a code that the registry does not hold. A writer cannot do that. It
 * is handed a value the format cannot carry, and it has to stop rather than
 * write a file. The one thing it must not do while stopping is invent a name
 * for what went wrong: a producer with a private set of failure names is a
 * second vocabulary for one format, and a caller who had to learn both would
 * confuse them eventually.
 *
 * So a refusal carries a `reason_code` from `verifier/status.js` — the same
 * vocabulary a verdict prints — and `refuse()` checks the code against that
 * vocabulary at the moment it is used, which is the writing half of the rule
 * `verifier/result.js` enforces for check ids.
 *
 * # Two names, and why
 *
 * `RefusalError` is the shared class, so that code which cannot say who refused
 * still has one name to catch. `producer/errors.js` extends it with
 * `ProducerError`, and a caller that wants to tell a refusal made by the
 * producer from one made by a shared writer can ask. Both statements are true
 * when the producer's ZIP writer refuses: the writer refused, and the producer
 * refused.
 *
 * @module verifier/refuse
 */

import { REASON } from './status.js';

const VOCABULARY = new Set(Object.values(REASON));

/**
 * @param {unknown} value
 * @returns {boolean} whether this is a reason code the format defines
 */
export function isReasonCode(value) {
  return typeof value === 'string' && VOCABULARY.has(value);
}

/**
 * A writer saying no, with a name from the shared vocabulary.
 *
 * Extends `Error` rather than `TypeError`: not every refusal is a type error. A
 * key of the wrong algorithm and a document that is not UTF-8 are both
 * well-typed inputs this format has no way to write, and they are reported as
 * such.
 */
export class RefusalError extends Error {
  /**
   * @param {string} reason_code from the vocabulary in `verifier/status.js`
   * @param {string} detail what is wrong, in prose, for a person
   * @param {string} [path] the field or entry the refusal is about
   */
  constructor(reason_code, detail, path = '') {
    if (!isReasonCode(reason_code)) {
      throw new TypeError(`a writer refused with "${reason_code}", which is not a reason code this format defines`);
    }
    super(detail);
    this.name = 'RefusalError';
    /** @type {string} */
    this.reason_code = reason_code;
    /** @type {string} */
    this.detail = detail;
    /** @type {string} */
    this.path = path;
  }
}

/**
 * @param {string} reason_code one of `REASON`'s values
 * @param {string} detail what is wrong, in prose
 * @param {string} [path] the field or entry the refusal is about
 * @returns {never}
 */
export function refuse(reason_code, detail, path = '') {
  throw new RefusalError(reason_code, detail, path);
}
